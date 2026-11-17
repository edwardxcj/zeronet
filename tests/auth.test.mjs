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
  const apiUrl = new URL("../src/lib/appwrite/api.ts", import.meta.url);
  const source = await readFile(apiUrl, "utf8");
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
  });
  const executable = outputText.replace(/from "([^"]+)"/g, (_match, specifier) => {
    if (specifier === "./config") return `from "${configUrl}"`;
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
