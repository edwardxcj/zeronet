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
const users = `${documents}/test-users/documents`;
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
    if (typeof failure === "function") return failure(url, init);
    if (failure) return Response.json(failure.body, { status: failure.status });

    if (url.pathname.startsWith(`${documents}/test-users/documents/`)) {
      const profile = profiles.get(url.pathname.split("/").at(-1));
      return profile
        ? Response.json(profile)
        : Response.json(absent, { status: 404 });
    }
    if (url.pathname === `${documents}/test-users/documents`) {
      const queries = [...url.searchParams.values()].map((query) => JSON.parse(query));
      const filter = queries.find((query) => query.method === "equal");
      const selection = queries.find((query) => query.method === "select");
      const limit = queries.find((query) => query.method === "limit");
      const cursor = queries.find((query) => query.method === "cursorAfter");
      assert.equal(filter.attribute, "accountId");
      assert.ok(filter.values.length <= 25);
      assert.equal(limit.values[0], 100);
      assert.deepEqual(selection.values, ["$id", "accountId", "name", "username", "imageUrl"]);
      const matches = [...profiles]
        .filter(([, profile]) => filter.values.includes(profile.accountId))
        .map(([id, profile]) => ({ $id: id, ...profile }))
        .sort((left, right) => left.$id.localeCompare(right.$id));
      const start = cursor ? matches.findIndex((profile) => profile.$id === cursor.values[0]) + 1 : 0;
      assert.ok(!cursor || start > 0);
      return Response.json({ total: matches.length, documents: matches.slice(start, start + limit.values[0]) });
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
      const filter = queries.find((query) => query.method === "equal");
      const limit = queries.find((query) => query.method === "limit");
      const select = queries.find((query) => query.method === "select");
      const cursor = queries.find((query) => query.method === "cursorAfter");
      const order = queries.find((query) => query.method === "orderAsc");
      assert.equal(filter.method, "equal");
      assert.ok(["followerId", "followingId"].includes(filter.attribute));
      assert.equal(limit.method, "limit");
      const matches = [...records]
        .filter(([, record]) => record[filter.attribute] === filter.values[0])
        .map(([id, record]) => ({ $id: id, ...record }));
      if (order) {
        assert.equal(order.attribute, "$id");
        matches.sort((left, right) => left.$id.localeCompare(right.$id));
      }
      let start = 0;
      if (cursor) {
        assert.equal(cursor.method, "cursorAfter");
        start = matches.findIndex((record) => record.$id === cursor.values[0]) + 1;
        assert.ok(start > 0);
      }
      let page = matches.slice(start, start + limit.values[0]);
      if (select) {
        assert.ok(["followerId", "followingId"].includes(select.values[1]));
        assert.equal(select.values[0], "$id");
        page = page.map((record) =>
          Object.fromEntries(select.values.map((field) => [field, record[field]]))
        );
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

test("counts use the target account and existing counterpart profiles", async (t) => {
  const { records, profiles, invoke } = setup(t);
  profiles.set("a-profile", { accountId: "a" });
  profiles.set("b-profile", { accountId: "b" });
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
  const { records, profiles, calls, invoke } = setup(t);
  const accountIds = Array.from({ length: 103 }, (_, index) => `followed-${index}`);
  for (const [index, followingId] of accountIds.entries()) {
    records.set(`edge-${String(index).padStart(3, "0")}`, { followerId: actorAccount, followingId });
    profiles.set(`profile-${index}`, { accountId: followingId });
  }
  records.set("someone-else", { followerId: "other-account", followingId: "private-account" });
  records.set("zz-duplicate", { followerId: actorAccount, followingId: accountIds[0] });
  records.set("zz-ghost", { followerId: actorAccount, followingId: "deleted-account" });
  records.set("zz-self", { followerId: actorAccount, followingId: actorAccount });

  const result = await invoke({
    action: "listFollowing",
    followerId: "other-account",
    targetId: targetProfile,
  });

  assert.equal(result.status, 200);
  assert.deepEqual(result.data, { accountIds });
  const edgeReads = calls.filter(({ url }) => url.pathname === follows);
  assert.equal(edgeReads.length, 2);
  assert.deepEqual(JSON.parse(edgeReads[1].url.searchParams.get("queries[4]")), {
    method: "cursorAfter",
    values: ["edge-099"],
  });
  const profileReads = calls.filter(({ url }) => url.pathname === users);
  assert.equal(profileReads.length, 5);
  assert.ok(calls.every(({ method, url }) => method === "GET" &&
    ["/v1/account", follows, users].includes(url.pathname)));
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

test("connection lists resolve the target account and expose only public profiles", async (t) => {
  const { records, profiles, calls, invoke } = setup(t);
  profiles.set("member-profile", {
    accountId: "member-account",
    name: "Member",
    username: "member",
    imageUrl: "https://images.example.test/avatar.png",
    email: "private@example.test",
    bio: "private field for this response",
  });
  profiles.set("incoming-profile", {
    accountId: "incoming-account",
    name: null,
    username: null,
    imageUrl: null,
    email: "another-private@example.test",
  });
  records.set("outgoing", { followerId: targetAccount, followingId: "member-account" });
  records.set("incoming", { followerId: "incoming-account", followingId: targetAccount });
  records.set("unrelated", { followerId: actorAccount, followingId: "unrelated-account" });

  assert.deepEqual(await invoke({
    action: "listConnections",
    targetId: targetProfile,
    direction: "following",
    accountId: actorAccount,
  }), {
    status: 200,
    data: {
      profiles: [{
        $id: "member-profile",
        name: "Member",
        username: "member",
        imageUrl: "https://images.example.test/avatar.png",
      }],
      nextCursor: null,
    },
  });
  assert.deepEqual(await invoke({
    action: "listConnections",
    targetId: targetProfile,
    direction: "followers",
  }), {
    status: 200,
    data: {
      profiles: [{
        $id: "incoming-profile",
        name: "ZeroNet member",
        username: "",
        imageUrl: "",
      }],
      nextCursor: null,
    },
  });
  assert.ok(calls.every(({ method }) => method === "GET"));
});

test("connection pages advance by edges even when every profile on a page was deleted", async (t) => {
  const { records, profiles, calls, invoke } = setup(t);
  for (let index = 0; index < 21; index++) {
    const suffix = index.toString().padStart(2, "0");
    records.set(`edge-${suffix}`, {
      followerId: `member-${suffix}`,
      followingId: targetAccount,
    });
  }
  profiles.set("surviving-profile", {
    accountId: "member-20",
    name: "Surviving member",
    username: "survivor",
    imageUrl: "",
  });
  const request = {
    action: "listConnections",
    targetId: targetProfile,
    direction: "followers",
  };
  assert.deepEqual(await invoke(request), {
    status: 200,
    data: { profiles: [], nextCursor: "edge-19" },
  });
  assert.deepEqual(await invoke({ ...request, cursor: "edge-19" }), {
    status: 200,
    data: {
      profiles: [{
        $id: "surviving-profile",
        name: "Surviving member",
        username: "survivor",
        imageUrl: "",
      }],
      nextCursor: null,
    },
  });
  const edgeQueries = calls.filter(({ url }) => url.pathname === follows);
  assert.equal(edgeQueries.length, 2);
  assert.deepEqual(JSON.parse(edgeQueries[1].url.searchParams.get("queries[4]")), {
    method: "cursorAfter",
    values: ["edge-19"],
  });
});

test("connection list validates direction and cursor before reading private data", async (t) => {
  const { calls, invoke } = setup(t);
  const request = {
    action: "listConnections",
    targetId: targetProfile,
    direction: "followers",
  };
  for (const body of [
    { ...request, direction: "both" },
    { ...request, cursor: "../another-collection" },
    { ...request, cursor: "" },
    { ...request, targetId: "" },
  ]) {
    assert.deepEqual(await invoke(body), {
      status: 400,
      data: { error: "Invalid follow request." },
    });
  }
  assert.equal(calls.length, 0);
  assert.equal((await invoke(request, { token: "forged" })).status, 401);
  assert.deepEqual(calls.map(({ url }) => url.pathname), ["/v1/account"]);
});

test("an empty connection list returns a terminal cursor without querying profiles", async (t) => {
  const { calls, invoke } = setup(t);
  assert.deepEqual(await invoke({
    action: "listConnections",
    targetId: targetProfile,
    direction: "following",
  }), {
    status: 200,
    data: { profiles: [], nextCursor: null },
  });
  assert.deepEqual(calls.map(({ url }) => url.pathname), [
    "/v1/account",
    `${documents}/test-users/documents/${targetProfile}`,
    follows,
  ]);
});

test("counts include valid accounts beyond the first 100-edge page with batched profile reads", async (t) => {
  const { records, profiles, calls, invoke } = setup(t);
  for (const [direction, count] of [["incoming", 137], ["outgoing", 127]]) {
    for (let index = 0; index < count; index++) {
      const suffix = String(index).padStart(3, "0");
      const accountId = `${direction}-${suffix}`;
      profiles.set(`${direction}-profile-${suffix}`, { accountId });
      records.set(`${direction}-edge-${suffix}`, direction === "incoming"
        ? { followerId: accountId, followingId: targetAccount }
        : { followerId: targetAccount, followingId: accountId });
    }
  }
  assert.deepEqual(await invoke({ action: "get", targetId: targetProfile, includeCounts: true }), {
    status: 200,
    data: { following: false, counts: { followers: 137, following: 127 } },
  });
  const edgeReads = calls.filter(({ url }) => url.pathname === follows);
  const profileReads = calls.filter(({ url }) => url.pathname === users);
  assert.equal(edgeReads.length, 4);
  assert.equal(profileReads.length, 12, "Use one lookup per account batch, not one per follow edge");
  assert.ok(profileReads.every(({ url }) => JSON.parse(url.searchParams.get("queries[0]")).values.length <= 25));
  assert.ok(calls.every(({ method }) => method === "GET"));
});

test("dangling incoming and outgoing edges produce zero counts and empty lists without deleting records", async (t) => {
  const { records, calls, invoke } = setup(t);
  records.set("incoming-ghost", { followerId: "deleted-qa-account", followingId: actorAccount });
  records.set("outgoing-ghost", { followerId: actorAccount, followingId: "deleted-member-account" });
  const original = [...records];
  assert.deepEqual(await invoke({ action: "get", targetId: "self-profile", includeCounts: true }), {
    status: 200,
    data: { following: false, counts: { followers: 0, following: 0 } },
  });
  for (const direction of ["followers", "following"]) {
    assert.deepEqual(await invoke({ action: "listConnections", targetId: "self-profile", direction }), {
      status: 200, data: { profiles: [], nextCursor: null },
    });
  }
  assert.deepEqual(await invoke({ action: "listFollowing" }), { status: 200, data: { accountIds: [] } });
  assert.deepEqual([...records], original);
  assert.ok(calls.every(({ method }) => method === "GET"));
});

test("real follows survive ghosts, duplicate pairs, malformed counterpart IDs and self edges", async (t) => {
  const { records, profiles, calls, invoke } = setup(t);
  profiles.set("kimberley-profile", { accountId: "kimberley-account", name: "Kimberley", username: "hah" });
  profiles.set("babycat-profile", { accountId: "babycat-account", name: "babycat", username: "babycat" });
  for (const [id, followerId, followingId] of [
    ["incoming-real", "kimberley-account", actorAccount],
    ["incoming-duplicate", "kimberley-account", actorAccount],
    ["incoming-ghost", "deleted-qa-account", actorAccount],
    ["incoming-invalid", "../invalid-account", actorAccount],
    ["outgoing-real-1", actorAccount, "kimberley-account"],
    ["outgoing-real-2", actorAccount, "babycat-account"],
    ["outgoing-duplicate", actorAccount, "kimberley-account"],
    ["outgoing-ghost", actorAccount, "deleted-qa-account"],
    ["outgoing-invalid", actorAccount, null],
    ["self-edge", actorAccount, actorAccount],
  ]) records.set(id, { followerId, followingId });
  const original = [...records];
  assert.deepEqual(await invoke({ action: "get", targetId: "self-profile", includeCounts: true }), {
    status: 200, data: { following: false, counts: { followers: 1, following: 2 } },
  });
  const incoming = await invoke({ action: "listConnections", targetId: "self-profile", direction: "followers" });
  const outgoing = await invoke({ action: "listConnections", targetId: "self-profile", direction: "following" });
  assert.deepEqual(incoming.data.profiles.map((profile) => profile.name), ["Kimberley"]);
  assert.deepEqual(outgoing.data.profiles.map((profile) => profile.name).sort(), ["Kimberley", "babycat"]);
  const following = await invoke({ action: "listFollowing" });
  assert.equal(following.status, 200);
  assert.deepEqual(following.data.accountIds.sort(), ["babycat-account", "kimberley-account"]);
  assert.deepEqual([...records], original, "Reads must preserve genuine and stale records alike");
  assert.ok(calls.every(({ method }) => method === "GET"));
});

test("profile lookup failures are errors instead of fabricated zero counts or empty lists", async (t) => {
  const { records, fail, log, invoke } = setup(t);
  records.set("incoming-ghost", { followerId: "missing-profile", followingId: actorAccount });
  records.set("outgoing-ghost", { followerId: actorAccount, followingId: "missing-profile" });
  fail.set(`GET ${users}`, { status: 503, body: { message: apiKey } });
  for (const body of [
    { action: "get", targetId: "self-profile", includeCounts: true },
    { action: "listFollowing" },
    { action: "listConnections", targetId: "self-profile", direction: "followers" },
  ]) {
    assert.deepEqual(await invoke(body), {
      status: 500, data: { error: "Follows is temporarily unavailable." },
    });
  }
  assert.ok(log.every((message) => !message.includes(apiKey)));
  fail.set(`GET ${users}`, () => Response.json({ documents: null }));
  assert.equal((await invoke({ action: "get", targetId: "self-profile", includeCounts: true })).status, 500);
});

test("edge pagination rejects repeated pages rather than looping or returning partial follow data", async (t) => {
  const { fail, calls, invoke } = setup(t);
  fail.set(`GET ${follows}`, () => Response.json({
    documents: Array.from({ length: 100 }, (_, index) => ({
      $id: `edge-${String(index).padStart(3, "0")}`,
      followingId: `member-${index}`,
    })),
    total: 1000,
  }));
  assert.deepEqual(await invoke({ action: "listFollowing" }), {
    status: 500, data: { error: "Follows is temporarily unavailable." },
  });
  assert.equal(calls.filter(({ url }) => url.pathname === follows).length, 2);
  assert.equal(calls.filter(({ url }) => url.pathname === users).length, 0);
});

test("duplicate legacy profiles cannot hide another real connection behind a profile page limit", async (t) => {
  const { records, profiles, calls, invoke } = setup(t);
  records.set("incoming-a", { followerId: "duplicate-account", followingId: actorAccount });
  records.set("incoming-b", { followerId: "later-account", followingId: actorAccount });
  records.set("incoming-ghost", { followerId: "missing-account", followingId: actorAccount });
  for (let index = 0; index < 101; index++) {
    profiles.set(`duplicate-profile-${String(index).padStart(3, "0")}`, { accountId: "duplicate-account" });
  }
  profiles.set("z-later-profile", { accountId: "later-account", name: "Real member" });
  assert.deepEqual(await invoke({ action: "get", targetId: "self-profile", includeCounts: true }), {
    status: 200, data: { following: false, counts: { followers: 2, following: 0 } },
  });
  assert.equal(calls.filter(({ url }) => url.pathname === users).length, 2);
});

test("profile pagination rejects an upstream repeated page instead of looping with a missing account", async (t) => {
  const { records, fail, calls, invoke } = setup(t);
  records.set("outgoing-real", { followerId: actorAccount, followingId: "real-account" });
  records.set("outgoing-ghost", { followerId: actorAccount, followingId: "missing-account" });
  fail.set(`GET ${users}`, () => Response.json({ documents: Array.from({ length: 100 }, (_, index) => ({
    $id: `profile-${String(index).padStart(3, "0")}`, accountId: "real-account",
  })) }));
  assert.deepEqual(await invoke({ action: "listFollowing" }), {
    status: 500, data: { error: "Follows is temporarily unavailable." },
  });
  assert.equal(calls.filter(({ url }) => url.pathname === users).length, 2);
});
