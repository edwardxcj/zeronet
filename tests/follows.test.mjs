import assert from "node:assert/strict";
import test from "node:test";
import handler from "../functions/follows/src/main.js";

const endpoint = "https://appwrite.example.test/v1";
const project = "example-project";
const jwt = "verified-by-appwrite";
const apiKey = "private-runtime-key";
const actorAccount = "actor-account";
const targetAccount = "target-account";
const targetProfile = "target-profile";
const documents = "/v1/databases/test-database/collections";
const follows = `${documents}/follows/documents`;
const absent = { type: "document_not_found" };

function setup(t) {
  const config = {
    APPWRITE_FUNCTION_API_ENDPOINT: endpoint,
    APPWRITE_FUNCTION_PROJECT_ID: project,
    FOLLOWS_DATABASE_ID: "test-database",
    FOLLOWS_USERS_COLLECTION_ID: "test-users",
  };
  for (const [key, value] of Object.entries(config)) {
    const original = process.env[key];
    process.env[key] = value;
    t.after(() => {
      if (original === undefined) delete process.env[key];
      else process.env[key] = original;
    });
  }

  const records = new Map();
  const profiles = new Map([
    [targetProfile, { accountId: targetAccount }],
    ["self-profile", { accountId: actorAccount }],
  ]);
  const calls = [];
  const log = [];
  const fail = new Map();
  t.mock.method(globalThis, "fetch", async (input, init = {}) => {
    const url = new URL(input);
    const headers = new Headers(init.headers);
    const method = init.method ?? "GET";
    calls.push({ url, headers, method });
    assert.equal(url.origin, new URL(endpoint).origin);
    assert.equal(headers.get("X-Appwrite-Project"), project);

    if (url.pathname === "/v1/account") {
      assert.equal(headers.has("X-Appwrite-Key"), false);
      return headers.get("X-Appwrite-JWT") === jwt
        ? Response.json({ $id: actorAccount })
        : Response.json({ message: "Private upstream auth details" }, { status: 401 });
    }

    assert.equal(headers.get("X-Appwrite-Key"), apiKey);
    assert.equal(headers.has("X-Appwrite-JWT"), false);
    const failure = fail.get(`${method} ${url.pathname}`);
    if (failure) return Response.json(failure.body, { status: failure.status });

    if (url.pathname.startsWith(`${documents}/test-users/documents/`)) {
      const profile = profiles.get(url.pathname.split("/").at(-1));
      return profile
        ? Response.json(profile)
        : Response.json(absent, { status: 404 });
    }
    if (url.pathname === follows && method === "POST") {
      const { documentId, data, permissions } = JSON.parse(init.body);
      assert.deepEqual(permissions, []);
      assert.match(documentId, /^[a-f0-9]{36}$/);
      if (records.has(documentId)) {
        return Response.json({ type: "document_already_exists" }, { status: 409 });
      }
      records.set(documentId, data);
      return Response.json({ $id: documentId, ...data }, { status: 201 });
    }
    if (url.pathname === follows) {
      const queries = [...url.searchParams.values()].map((query) => JSON.parse(query));
      const [filter, limit, select, cursor] = queries;
      assert.equal(filter.method, "equal");
      assert.ok(["followerId", "followingId"].includes(filter.attribute));
      assert.equal(limit.method, "limit");
      const matches = [...records]
        .filter(([, record]) => record[filter.attribute] === filter.values[0])
        .map(([id, record]) => ({ $id: id, ...record }));
      let start = 0;
      if (cursor) {
        assert.equal(cursor.method, "cursorAfter");
        start = matches.findIndex((record) => record.$id === cursor.values[0]) + 1;
        assert.ok(start > 0);
      }
      let page = matches.slice(start, start + limit.values[0]);
      if (select) {
        assert.deepEqual(select, { method: "select", values: ["$id", "followingId"] });
        page = page.map(({ $id, followingId }) => ({ $id, followingId }));
      }
      return Response.json({ total: matches.length, documents: page });
    }
    if (url.pathname.startsWith(`${follows}/`)) {
      const id = url.pathname.split("/").at(-1);
      const record = records.get(id);
      if (!record) return Response.json(absent, { status: 404 });
      if (method === "DELETE") {
        records.delete(id);
        return new Response(null, { status: 204 });
      }
      return Response.json({ $id: id, ...record });
    }
    assert.fail(`Unexpected Appwrite request: ${method} ${url.pathname}`);
  });
  const invoke = (body, { token = jwt, method = "POST", raw = false } = {}) =>
    handler({
      req: {
        method,
        headers: { "x-appwrite-user-jwt": token, "x-appwrite-key": apiKey },
        ...(raw ? { bodyText: body } : { bodyJson: body }),
      },
      res: { json: (data, status = 200) => ({ status, data }) },
      error: (message) => log.push(message),
    });
  return { records, profiles, calls, log, fail, invoke };
}

test("follow uses the verified account and resolves a profile ID to its account ID", async (t) => {
  const { records, invoke } = setup(t);
  const action = { action: "set", targetId: targetProfile, following: true };
  const expected = { status: 200, data: { following: true } };
  assert.deepEqual(await invoke({ ...action, followerId: "spoofed-account" }), expected);
  assert.deepEqual([...records.values()], [{
    followerId: actorAccount,
    followingId: targetAccount,
  }]);
  const documentId = [...records.keys()][0];
  assert.deepEqual(await invoke(action), expected);
  assert.deepEqual([...records.keys()], [documentId]);
  assert.deepEqual(await invoke({ action: "get", targetId: targetProfile }), expected);
});

test("unfollow is idempotent and preserves another person's follow", async (t) => {
  const { records, invoke } = setup(t);
  records.set("someone-else", { followerId: "other-account", followingId: targetAccount });
  await invoke({ action: "set", targetId: targetProfile, following: true });
  const action = { action: "set", targetId: targetProfile, following: false };
  const expected = { status: 200, data: { following: false } };
  assert.deepEqual(await invoke(action), expected);
  assert.deepEqual(await invoke(action), expected);
  assert.deepEqual([...records.keys()], ["someone-else"]);
  assert.deepEqual(await invoke({ action: "get", targetId: targetProfile }), expected);
});

test("counts use the target account and report totals beyond the returned page", async (t) => {
  const { records, invoke } = setup(t);
  records.set("incoming-1", { followerId: "a", followingId: targetAccount });
  records.set("incoming-2", { followerId: "b", followingId: targetAccount });
  records.set("outgoing", { followerId: targetAccount, followingId: "a" });
  const action = { action: "get", targetId: targetProfile, includeCounts: true };
  assert.deepEqual(await invoke(JSON.stringify(action), { raw: true }), {
    status: 200,
    data: { following: false, counts: { followers: 2, following: 1 } },
  });
  assert.deepEqual(await invoke({ ...action, targetId: "self-profile" }), {
    status: 200,
    data: { following: false, counts: { followers: 0, following: 0 } },
  });
});

test("invalid requests and missing credentials cannot touch Appwrite data", async (t) => {
  const { calls, invoke } = setup(t);
  const action = { action: "set", targetId: targetProfile, following: true };
  for (const [body, opts, status] of [
    [action, { token: null }, 401],
    [action, { method: "GET" }, 405],
    ["{", { raw: true }, 400],
    [{ ...action, targetId: "../other" }, {}, 400],
    [{ ...action, following: "true" }, {}, 400],
    [{ action: "get", targetId: targetProfile, includeCounts: "true" }, {}, 400],
  ]) {
    assert.equal((await invoke(body, opts)).status, status);
  }
  assert.equal(calls.length, 0);
  assert.deepEqual(await invoke(action, { token: "forged" }), {
    status: 401,
    data: { error: "Sign in to use follows." },
  });
  assert.deepEqual(calls.map(({ url }) => url.pathname), ["/v1/account"]);
});

test("missing profiles and self-follow cannot write records", async (t) => {
  const { calls, records, invoke } = setup(t);
  const action = { action: "set", following: true };
  assert.equal((await invoke({ ...action, targetId: "missing-profile" })).status, 404);
  assert.equal((await invoke({ ...action, targetId: "self-profile" })).status, 400);
  assert.ok(calls.every(({ method }) => method === "GET"));
  assert.equal(records.size, 0);
});

test("upstream failures return a sanitized error instead of a fabricated status", async (t) => {
  const { fail, log, invoke } = setup(t);
  fail.set(`POST ${follows}`, { status: 403, body: { message: apiKey } });
  const action = { action: "set", targetId: targetProfile, following: true };
  assert.deepEqual(await invoke(action), {
    status: 500,
    data: { error: "Follows is temporarily unavailable." },
  });
  assert.ok(log.length > 0);
  assert.ok(log.every((message) => !message.includes(apiKey)));
});

test("listing follows uses the verified account and returns IDs across cursor pages", async (t) => {
  const { records, calls, invoke } = setup(t);
  const accountIds = Array.from({ length: 103 }, (_, index) => `followed-${index}`);
  for (const [index, followingId] of accountIds.entries()) {
    records.set(`edge-${index}`, { followerId: actorAccount, followingId });
  }
  records.set("someone-else", { followerId: "other-account", followingId: "private-account" });
  records.set("duplicate", { followerId: actorAccount, followingId: accountIds[0] });

  const result = await invoke({
    action: "listFollowing",
    followerId: "other-account",
    targetId: targetProfile,
  });

  assert.equal(result.status, 200);
  assert.deepEqual(result.data, { accountIds });
  assert.deepEqual(calls.map(({ url }) => url.pathname), ["/v1/account", follows, follows]);
  assert.deepEqual(JSON.parse(calls[2].url.searchParams.get("queries[3]")), {
    method: "cursorAfter",
    values: ["edge-99"],
  });
});

test("listing follows returns an empty list or rejects an unauthorized session", async (t) => {
  const { calls, invoke } = setup(t);
  const action = { action: "listFollowing" };
  assert.deepEqual(await invoke(action, { token: "forged" }), {
    status: 401,
    data: { error: "Sign in to use follows." },
  });
  assert.deepEqual(calls.map(({ url }) => url.pathname), ["/v1/account"]);
  assert.deepEqual(await invoke(action), { status: 200, data: { accountIds: [] } });
});
