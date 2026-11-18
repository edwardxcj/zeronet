import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";
import {
  authErrorMessage,
  isAuthPath,
  SignupProfileError,
} from "../src/lib/authErrors.ts";
import {
  CompleteProfileValidation,
  ForgotPasswordValidation,
  ResetPasswordValidation,
  SignupValidation,
} from "../src/lib/validation/index.ts";

let fixtureId = 0;

async function loadAuthApi(t, { account = {}, databases = {} } = {}) {
  if (!("window" in globalThis)) {
    globalThis.window = { location: { origin: "https://zeronet.example.test" } };
    t.after(() => { delete globalThis.window; });
  }
  const profile = { $id: "account-1", accountId: "account-1", name: "Test", email: "test@example.test" };
  const config = {
    account: {
      create: async () => ({ ...profile, $id: "account-1" }),
      createEmailSession: async () => ({ $id: "session-1" }),
      get: async () => ({ ...profile, $id: "account-1" }),
      ...account,
    },
    databases: {
      listDocuments: async () => ({ documents: [], total: 0 }),
      createDocument: async (_db, _collection, id, data) => ({ $id: id, ...data }),
      ...databases,
    },
    avatars: { getInitials: () => new URL("https://example.test/avatar.svg") },
    storage: {},
    appwriteConfig: {
      url: "https://example.test/v1",
      databaseId: "database-1",
      userCollectionId: "users-1",
    },
  };
  const key = `__zeronet_auth_fixture_${fixtureId++}`;
  globalThis[key] = config;
  t.after(() => { delete globalThis[key]; });
  const configSource = `
    const config = globalThis[${JSON.stringify(key)}];
    export const { account, databases, avatars, storage, appwriteConfig } = config;
  `;
  const configUrl = `data:text/javascript;base64,${Buffer.from(configSource).toString("base64")}`;
  const socialUrl = `data:text/javascript;base64,${Buffer.from(
    'export function setPostLike() { throw new Error("Unexpected social call in an auth test"); }'
  ).toString("base64")}`;
  const apiUrl = new URL("../src/lib/appwrite/api.ts", import.meta.url);
  const source = await readFile(apiUrl, "utf8");
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
  });
  const executable = outputText.replace(/from "([^"]+)"/g, (_match, specifier) => {
    if (specifier === "./config") return `from "${configUrl}"`;
    if (specifier === "./social") return `from "${socialUrl}"`;
    if (specifier === "appwrite") {
      return `from "${new URL("../node_modules/appwrite/dist/esm/sdk.js", import.meta.url)}"`;
    }
    if (!specifier.startsWith(".")) throw new Error(`Unexpected import ${specifier}`);
    return `from "${new URL(`${specifier}.ts`, apiUrl)}"`;
  });
  return import(`data:text/javascript;base64,${Buffer.from(executable).toString("base64")}`);
}

test("failed login rejects the real error and shows a safe actionable message", async (t) => {
  const failure = { code: 401, type: "user_invalid_credentials", message: "private upstream details" };
  const api = await loadAuthApi(t, {
    account: { createEmailSession: async () => { throw failure; } },
  });
  await assert.rejects(api.signInAccount({ email: "a@example.test", password: "incorrect" }),
    (error) => error === failure);
  const message = authErrorMessage(failure, "signin");
  assert.match(message, /email or password/i);
  assert.doesNotMatch(message, /private upstream/);
});

test("a profile write failure preserves the created account and retries only profile setup", async (t) => {
  let accountCreates = 0;
  let writes = 0;
  const api = await loadAuthApi(t, {
    account: { create: async () => {
      accountCreates++;
      return { $id: "account-1", name: "Test", email: "test@example.test" };
    } },
    databases: { createDocument: async (_db, _collection, id, data) => {
      writes++;
      assert.equal(id, "account-1");
      if (writes === 1) throw new TypeError("Network request failed");
      return { $id: id, ...data };
    } },
  });
  const user = { name: "Test", username: "tester", email: "test@example.test", password: "long-password" };
  await assert.rejects(api.createUserAccount(user), (error) =>
    error instanceof SignupProfileError && error.accountId === "account-1");
  const profile = await api.completeSignupProfile(user, "account-1");
  assert.equal(profile.accountId, "account-1");
  assert.equal(accountCreates, 1);
  assert.equal(writes, 2);
});

test("profile retry reuses a committed profile when its earlier response was lost", async (t) => {
  const saved = { $id: "account-1", accountId: "account-1", username: "tester" };
  let writes = 0;
  const api = await loadAuthApi(t, {
    databases: {
      listDocuments: async () => ({ total: 1, documents: [saved] }),
      createDocument: async () => { writes++; throw new Error("unexpected write"); },
    },
  });
  assert.deepEqual(await api.completeSignupProfile({ name: "Test", username: "tester" }), saved);
  assert.equal(writes, 0);
});

test("password recovery uses the exact app origin and SDK 13 confirmation arguments", async (t) => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { location: { origin: "https://zeronet.example.test" } },
  });
  t.after(() => {
    if (descriptor) Object.defineProperty(globalThis, "window", descriptor);
    else delete globalThis.window;
  });
  const requests = [];
  const api = await loadAuthApi(t, {
    account: {
      createRecovery: async (...args) => { requests.push(args); },
      updateRecovery: async (...args) => { requests.push(args); },
    },
  });
  await api.requestPasswordRecovery("test@example.test");
  await api.confirmPasswordRecovery("account-1", "secret-1", "new-password", "new-password");
  assert.deepEqual(requests, [
    ["test@example.test", "https://zeronet.example.test/reset-password"],
    ["account-1", "secret-1", "new-password", "new-password"],
  ]);
});

test("unknown recovery emails receive the same success state while transport errors remain errors", async (t) => {
  const api = await loadAuthApi(t, {
    account: { createRecovery: async () => { throw { type: "user_not_found", code: 404 }; } },
  });
  await assert.doesNotReject(api.requestPasswordRecovery("missing@example.test"));
  assert.match(authErrorMessage({ code: 429 }, "recovery"), /wait/i);
  assert.match(authErrorMessage(new TypeError("private details"), "recovery"), /connection/i);
  assert.match(authErrorMessage({ type: "user_invalid_token", code: 401 }, "reset"), /new link/i);
});

test("recovery pages remain public and new passwords must match", () => {
  assert.equal(isAuthPath("/forgot-password"), true);
  assert.equal(isAuthPath("/reset-password/"), true);
  assert.equal(isAuthPath("/RESET-PASSWORD///"), true);
  assert.equal(isAuthPath("/Forgot-Password//"), true);
  assert.equal(isAuthPath("/SIGN-IN///"), true);
  assert.equal(isAuthPath("/profile/account-1"), false);
  assert.equal(isAuthPath("/reset-password/other"), false);
  assert.equal(ForgotPasswordValidation.safeParse({ email: " test@example.test " }).success, true);
  const mismatch = ResetPasswordValidation.safeParse({ password: "long-password", passwordAgain: "different" });
  assert.equal(mismatch.success, false);
  assert.deepEqual(mismatch.error.issues[0].path, ["passwordAgain"]);
  assert.equal(ResetPasswordValidation.safeParse({ password: "short", passwordAgain: "short" }).success, false);
  assert.equal(ResetPasswordValidation.safeParse({ password: "long-password", passwordAgain: "long-password" }).success, true);
  const profile = { name: "Test", username: "tester", email: "test@example.test", password: "" };
  assert.equal(CompleteProfileValidation.safeParse(profile).success, true);
  assert.equal(SignupValidation.safeParse(profile).success, false);
});

test("guest session checks return null without logging expected authentication failures", async (t) => {
  const log = t.mock.method(console, "log", () => {});
  const api = await loadAuthApi(t, {
    account: { get: async () => { throw { code: 401, type: "general_unauthorized_scope" }; } },
  });
  assert.equal(await api.getCurrentUser(), null);
  assert.equal(log.mock.calls.length, 0);
});

async function authProviderFixture(t) {
  const fixture = {
    states: [],
    pending: [],
    navigations: [],
    currentPath: "/",
    getCurrentUser() {
      return new Promise((resolve) => fixture.pending.push(resolve));
    },
  };
  const key = `__zeronet_auth_provider_${fixtureId++}`;
  globalThis[key] = fixture;
  t.after(() => { fixture.cleanup?.(); delete globalThis[key]; });
  const asModule = (source) =>
    `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;
  const hooks = asModule(`
    const fixture = globalThis[${JSON.stringify(key)}];
    export const createContext = (initial) => ({ Provider: "auth-provider", initial });
    export const useContext = (context) => context.initial;
    export const useCallback = (callback) => callback;
    export const useRef = (current) => ({ current });
    export const useEffect = (callback) => { fixture.cleanup = callback(); };
    export const useState = (initial) => {
      const index = fixture.states.length;
      fixture.states.push(initial);
      return [initial, (value) => {
        fixture.states[index] = typeof value === "function" ? value(fixture.states[index]) : value;
      }];
    };
  `);
  const router = asModule(`
    const fixture = globalThis[${JSON.stringify(key)}];
    export const useLocation = () => ({ pathname: fixture.currentPath });
    export const useNavigate = () => (...args) => fixture.navigations.push(args);
  `);
  const api = asModule(`
    const fixture = globalThis[${JSON.stringify(key)}];
    export const getCurrentUser = () => fixture.getCurrentUser();
  `);
  const source = await readFile(new URL("../src/context/AuthContext.tsx", import.meta.url), "utf8");
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
    },
  });
  const imports = {
    react: hooks,
    "react-router-dom": router,
    "@/lib/appwrite/api": api,
    "@/lib/authErrors": new URL("../src/lib/authErrors.ts", import.meta.url).href,
    "react/jsx-runtime": new URL("../node_modules/react/jsx-runtime.js", import.meta.url).href,
  };
  const executable = outputText.replace(/from "([^"]+)"/g, (_match, specifier) => {
    assert.ok(imports[specifier], `Unexpected auth provider import ${specifier}`);
    return `from "${imports[specifier]}"`;
  });
  const { AuthProvider } = await import(asModule(executable));
  const element = AuthProvider({ children: null });
  fixture.checkAuthUser = element.props.value.checkAuthUser;
  return fixture;
}

for (const guestFinishesFirst of [true, false]) {
  test(`an initial guest check cannot override a newer login (${guestFinishesFirst ? "guest first" : "login first"})`, async (t) => {
    const fixture = await authProviderFixture(t);
    assert.equal(fixture.pending.length, 1);
    const loginCheck = fixture.checkAuthUser();
    const profile = { $id: "signed-in", name: "Test", username: "test", email: "test@example.test" };

    if (guestFinishesFirst) {
      fixture.pending[0](null);
      await new Promise(setImmediate);
      assert.equal(fixture.states[2], true);
      assert.equal(fixture.navigations.length, 0);
    }
    fixture.pending[1](profile);
    assert.equal(await loginCheck, true);
    if (!guestFinishesFirst) fixture.pending[0](null);
    await new Promise(setImmediate);

    assert.equal(fixture.states[0].id, profile.$id);
    assert.equal(fixture.states[1], true);
    assert.equal(fixture.states[2], false);
    assert.deepEqual(fixture.navigations, []);
  });
}
