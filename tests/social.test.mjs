import assert from "node:assert/strict";
import test from "node:test";
import handler from "../functions/follows/src/main.js";

const base = "/v1/databases/db/collections";
const paths = Object.fromEntries(["users", "posts", "comments", "notifications", "follows"]
  .map((name) => [name, `${base}/${name}/documents`]));
const clone = (value) => value === undefined ? undefined : structuredClone(value);

function setup(t) {
  for (const [key, value] of Object.entries({
    APPWRITE_FUNCTION_API_ENDPOINT: "https://appwrite.example.test/v1",
    APPWRITE_FUNCTION_PROJECT_ID: "project",
    FOLLOWS_DATABASE_ID: "db", FOLLOWS_USERS_COLLECTION_ID: "users",
    SOCIAL_POSTS_COLLECTION_ID: "posts",
  })) {
    const previous = process.env[key];
    process.env[key] = value;
    t.after(() => previous === undefined ? delete process.env[key] : process.env[key] = previous);
  }
  const tables = Object.fromEntries(Object.keys(paths).map((name) => [name, new Map()]));
  const versions = new Map();
  const transactions = new Map();
  const calls = [];
  let sequence = 0;
  let onCommit;
  let onStage;
  let transactionsAvailable = true;
  const seed = (table, id, data) => {
    tables[table].set(id, { $id: id, $createdAt: "2026-01-01T00:00:00.000Z", ...clone(data) });
    const key = `${table}/${id}`;
    versions.set(key, (versions.get(key) ?? 0) + 1);
  };
  for (const account of ["alice", "bob", "carol", "owner"]) {
    seed("users", `${account}-profile`, {
      accountId: account, name: account, username: account, imageUrl: "",
      email: `${account}@private.test`, liked: [],
    });
  }
  seed("posts", "post", { creator: clone(tables.users.get("owner-profile")), likes: [] });
  seed("posts", "other-post", { creator: clone(tables.users.get("owner-profile")), likes: [] });
  const missing = () => Response.json({ type: "document_not_found" }, { status: 404 });
  const conflict = () => Response.json({ type: "transaction_conflict", message: "PRIVATE" }, { status: 409 });
  function record(tx, table, id) {
    const key = `${table}/${id}`;
    if (tx && !tx.versions.has(key)) tx.versions.set(key, versions.get(key));
    return clone(tx?.changes.has(key) ? tx.changes.get(key) : tables[table].get(id));
  }
  function stage(tx, table, id, value) {
    const key = `${table}/${id}`;
    if (tx) {
      if (!tx.versions.has(key)) tx.versions.set(key, versions.get(key));
      tx.changes.set(key, clone(value));
    } else if (value) seed(table, id, value);
    else { tables[table].delete(id); versions.set(key, (versions.get(key) ?? 0) + 1); }
  }
  t.mock.method(globalThis, "fetch", async (input, init = {}) => {
    const url = new URL(input);
    const method = init.method ?? "GET";
    const headers = new Headers(init.headers);
    const data = init.body ? JSON.parse(init.body) : undefined;
    calls.push({ url, method, headers, data });
    const jwt = headers.get("X-Appwrite-JWT");
    if (url.pathname === "/v1/account") {
      assert.equal(headers.has("X-Appwrite-Key"), false);
      return ["alice", "bob", "carol", "owner"].includes(jwt)
        ? Response.json({ $id: jwt }) : Response.json({ message: "PRIVATE" }, { status: 401 });
    }
    if (jwt) {
      assert.equal(headers.has("X-Appwrite-Key"), false);
      if (jwt === "carol" || !url.pathname.startsWith(paths.posts)) return missing();
      const post = tables.posts.get(url.pathname.split("/").at(-1));
      return post ? Response.json({ $id: post.$id }) : missing();
    }
    assert.equal(headers.get("X-Appwrite-Key"), "runtime-key");
    if (url.pathname === "/v1/databases/transactions") {
      if (!transactionsAvailable) return Response.json({ message: "PRIVATE" }, { status: 404 });
      const id = `tx-${++sequence}`;
      transactions.set(id, { changes: new Map(), versions: new Map() });
      return Response.json({ $id: id }, { status: 201 });
    }
    if (url.pathname.startsWith("/v1/databases/transactions/")) {
      const id = url.pathname.split("/").at(-1);
      const tx = transactions.get(id);
      assert.ok(tx, "transaction exists");
      if (data.rollback) { transactions.delete(id); return Response.json({ $id: id }); }
      assert.equal(data.commit, true);
      if (onCommit) await onCommit();
      if ([...tx.versions].some(([key, version]) => versions.get(key) !== version)) return conflict();
      for (const [key, value] of tx.changes) {
        const [table, recordId] = key.split("/");
        stage(null, table, recordId, value);
        // Model Appwrite's existing two-way relationship, not a new likes store.
        if (table === "posts") for (const profile of tables.users.values()) {
          const liked = new Set(profile.liked ?? []);
          if (value.likes.includes(profile.$id)) liked.add(recordId); else liked.delete(recordId);
          profile.liked = [...liked];
        }
      }
      transactions.delete(id);
      return Response.json({ $id: id, status: "committed" });
    }
    const entry = Object.entries(paths).find(([, path]) => url.pathname === path || url.pathname.startsWith(`${path}/`));
    assert.ok(entry, `${method} ${url.pathname}`);
    const [table, path] = entry;
    const txId = data?.transactionId ?? url.searchParams.get("transactionId");
    const tx = txId ? transactions.get(txId) : null;
    if (txId) assert.ok(tx);
    const id = url.pathname === path ? undefined : url.pathname.split("/").at(-1);
    if (method === "GET" && id) {
      if (table === "posts") {
        assert.deepEqual(JSON.parse(url.searchParams.get("queries[0]")), {
          method: "select", values: ["$id", "creator.$id", "creator.accountId", "likes.$id"],
        }, "admin post reads must expand relationships explicitly");
      }
      const value = record(tx, table, id);
      return value ? Response.json(value) : missing();
    }
    if (method === "GET") {
      const queries = [...url.searchParams].filter(([key]) => key.startsWith("queries["))
        .map(([, value]) => JSON.parse(value));
      let rows = [...tables[table].values()].map(clone);
      for (const q of queries) {
        if (q.method === "equal") rows = rows.filter((row) => q.values.includes(row[q.attribute]));
        if (q.method === "isNull") rows = rows.filter((row) => row[q.attribute] == null);
        if (q.method === "lessThanEqual") rows = rows.filter((row) => row[q.attribute] <= q.values[0]);
      }
      const total = rows.length;
      const orders = queries.filter((q) => ["orderAsc", "orderDesc"].includes(q.method));
      rows.sort((a, b) => {
        for (const q of orders) {
          const comparison = a[q.attribute].localeCompare(b[q.attribute]);
          if (comparison) return q.method === "orderAsc" ? comparison : -comparison;
        }
        return 0;
      });
      const cursor = queries.find((q) => q.method === "cursorAfter");
      if (cursor) {
        const index = rows.findIndex((row) => row.$id === cursor.values[0]);
        assert.ok(index >= 0, "cursor belongs to filtered page");
        rows = rows.slice(index + 1);
      }
      const count = queries.find((q) => q.method === "limit")?.values[0] ?? 25;
      const selection = queries.find((q) => q.method === "select");
      rows = rows.slice(0, count);
      if (selection) rows = rows.map((row) => Object.fromEntries(selection.values.map((key) => [key, row[key]])));
      return Response.json({ total, documents: rows });
    }
    if (method === "POST") {
      assert.deepEqual(data.permissions, [], "private social documents have no client permissions");
      if (record(tx, table, data.documentId)) return conflict();
      const value = { $id: data.documentId, $createdAt: `2026-02-01T00:00:${String(sequence % 60).padStart(2, "0")}.000Z`, ...data.data };
      stage(tx, table, data.documentId, value);
      return Response.json(value, { status: 201 });
    }
    const previous = record(tx, table, id);
    if (!previous) return missing();
    if (method === "PATCH") {
      if (onStage) await onStage(table, id);
      const value = { ...previous, ...data.data };
      stage(tx, table, id, value);
      return Response.json(value);
    }
    assert.equal(method, "DELETE");
    stage(tx, table, id, null);
    return new Response(null, { status: 204 });
  });
  const invoke = (body, actor = "alice") => handler({
    req: { method: "POST", headers: { "x-appwrite-user-jwt": actor, "x-appwrite-key": "runtime-key" }, bodyJson: body },
    res: { json: (data, status = 200) => ({ status, data }) }, error: () => {},
  });
  return { tables, seed, invoke, calls,
    setOnCommit: (fn) => onCommit = fn, setOnStage: (fn) => onStage = fn,
    disableTransactions: () => transactionsAvailable = false };
}

test("comments are account-authenticated, idempotent and emit only safe public fields", async (t) => {
  const { invoke, tables } = setup(t);
  const body = { action: "createComment", postId: "post", content: "  hello  ", requestId: "comment-request-1", authorId: "owner" };
  const first = await invoke(body);
  assert.equal(first.status, 200);
  assert.equal(first.data.comment.content, "hello");
  assert.equal(first.data.comment.author.$id, "alice-profile");
  assert.equal(first.data.comment.canDelete, true);
  assert.equal(first.data.comment.author.email, undefined);
  assert.equal(first.data.comment.author.accountId, undefined);
  assert.equal([...tables.comments.values()][0].authorId, "alice");
  assert.deepEqual(await invoke(body), first);
  assert.equal(tables.comments.size, 1);
  assert.equal(tables.notifications.size, 1);
  assert.equal([...tables.notifications.values()][0].recipientId, "owner");
  assert.equal((await invoke({ ...body, content: "different" })).status, 422);
});

test("nested replies group under one root and notify parent plus distinct post author", async (t) => {
  const { invoke, tables } = setup(t);
  const root = (await invoke({ action: "createComment", postId: "post", content: "root", requestId: "root-request-1" })).data.comment;
  const reply = (await invoke({ action: "createComment", postId: "post", content: "reply", parentId: root.$id, requestId: "reply-request-1" }, "bob")).data.comment;
  const nested = (await invoke({ action: "createComment", postId: "post", content: "nested", parentId: reply.$id, requestId: "nested-request-1" })).data.comment;
  assert.equal(reply.rootId, root.$id);
  assert.equal(nested.rootId, root.$id);
  assert.equal(nested.parentId, reply.$id);
  const nestedAlerts = [...tables.notifications.values()].filter((n) => n.commentId === nested.$id);
  assert.deepEqual(nestedAlerts.map((n) => [n.recipientId, n.type]).sort(), [["bob", "reply"], ["owner", "comment"]]);
  assert.ok([...tables.notifications.values()].every((n) => n.actorId !== n.recipientId));
  assert.equal((await invoke({ action: "getComment", commentId: root.$id })).data.comment.replyCount, 2);
  assert.deepEqual((await invoke({ action: "listComments", postId: "post", rootId: root.$id })).data.comments.map((c) => c.$id).sort(), [reply.$id, nested.$id].sort());
  assert.equal((await invoke({ action: "createComment", postId: "other-post", content: "wrong post", parentId: root.$id, requestId: "wrong-request-1" })).status, 400);
});

test("soft-delete preserves thread deep links and only the author may delete", async (t) => {
  const { invoke } = setup(t);
  const comment = (await invoke({ action: "createComment", postId: "post", content: "root", requestId: "delete-request-1" })).data.comment;
  assert.equal((await invoke({ action: "deleteComment", commentId: comment.$id }, "bob")).status, 403);
  assert.equal((await invoke({ action: "deleteComment", commentId: comment.$id })).status, 200);
  assert.equal((await invoke({ action: "deleteComment", commentId: comment.$id })).status, 200);
  const tombstone = (await invoke({ action: "getComment", commentId: comment.$id })).data.comment;
  assert.equal(tombstone.deleted, true);
  assert.equal(tombstone.content, "");
  assert.equal(tombstone.canDelete, false);
  assert.equal((await invoke({ action: "listComments", postId: "post" })).data.comments[0].$id, comment.$id);
});

test("comment pagination and direct lookup reach roots older than the first page", async (t) => {
  const { invoke, seed } = setup(t);
  for (let i = 0; i < 23; i++) seed("comments", `comment-${String(i).padStart(2, "0")}`, {
    postId: "post", authorId: "bob", content: `${i}`, deleted: false, parentId: null, rootId: null,
  });
  const first = (await invoke({ action: "listComments", postId: "post" })).data;
  assert.equal(first.comments.length, 20);
  assert.equal(first.nextCursor, "comment-19");
  const second = (await invoke({ action: "listComments", postId: "post", cursor: first.nextCursor })).data;
  assert.equal(second.comments.length, 3);
  assert.equal(second.nextCursor, null);
  assert.equal((await invoke({ action: "getComment", commentId: "comment-22" })).data.comment.content, "22");
});

test("comment counts use totals across pages, include replies and exclude soft-deleted records", async (t) => {
  const { invoke, seed, calls } = setup(t);
  for (let i = 0; i < 31; i++) seed("comments", `count-${i}`, {
    postId: "post", authorId: "alice", content: `${i}`, deleted: false,
    parentId: i ? "count-0" : null, rootId: i ? "count-0" : null,
  });
  seed("comments", "deleted", {
    postId: "post", authorId: "alice", content: "", deleted: true, parentId: null, rootId: null,
  });
  seed("comments", "elsewhere", {
    postId: "other-post", authorId: "alice", content: "other post", deleted: false, parentId: null, rootId: null,
  });
  assert.deepEqual(await invoke({ action: "commentCount", postId: "post" }), { status: 200, data: { count: 31 } });
  const countRequest = calls.find((call) => call.url.pathname === paths.comments);
  const queries = [...countRequest.url.searchParams.values()].map((value) => JSON.parse(value));
  assert.deepEqual(queries, [
    { method: "equal", attribute: "postId", values: ["post"] },
    { method: "equal", attribute: "deleted", values: [false] },
    { method: "limit", values: [1] },
  ]);
  await invoke({ action: "deleteComment", commentId: "count-0" });
  assert.equal((await invoke({ action: "commentCount", postId: "post" })).data.count, 30,
    "deleting the root must not remove its surviving replies from the count");
  await invoke({ action: "deleteComment", commentId: "count-1" });
  await invoke({ action: "deleteComment", commentId: "count-1" });
  assert.equal((await invoke({ action: "commentCount", postId: "post" })).data.count, 29);
});

test("comment counts require a valid post and verified read permission before querying private comments", async (t) => {
  const { invoke, calls } = setup(t);
  assert.deepEqual(await invoke({ action: "commentCount", postId: "post" }), { status: 200, data: { count: 0 } });
  calls.length = 0;
  assert.equal((await invoke({ action: "commentCount", postId: "../private" })).status, 400);
  assert.equal(calls.length, 0);
  assert.equal((await invoke({ action: "commentCount", postId: "post" }, "forged")).status, 401);
  assert.equal((await invoke({ action: "commentCount", postId: "post" }, "carol")).status, 404);
  assert.equal((await invoke({ action: "commentCount", postId: "missing-post" })).status, 404);
  assert.ok(calls.every((call) => call.url.pathname !== paths.comments));
});

test("likes union concurrent actors and preserve the existing inverse liked relation", async (t) => {
  const { invoke, tables } = setup(t);
  const results = await Promise.all(["alice", "bob"].map((actor) => invoke({ action: "setLike", postId: "post", shouldLike: true, userId: "owner-profile" }, actor)));
  assert.deepEqual(results.map((r) => r.status), [200, 200]);
  assert.deepEqual([...tables.posts.get("post").likes].sort(), ["alice-profile", "bob-profile"]);
  assert.deepEqual(tables.users.get("alice-profile").liked, ["post"]);
  assert.deepEqual(tables.users.get("bob-profile").liked, ["post"]);
  assert.deepEqual(tables.users.get("owner-profile").liked, []);
  assert.equal(tables.notifications.size, 2);
  await invoke({ action: "setLike", postId: "post", shouldLike: false });
  assert.deepEqual(tables.posts.get("post").likes, ["bob-profile"]);
  assert.deepEqual(tables.users.get("alice-profile").liked, []);
  assert.equal(tables.notifications.size, 1);
});

test("likes retry commit conflicts and the read-to-stage race without dropping others", async (t) => {
  const fixture = setup(t);
  const { invoke, tables, seed, setOnCommit, setOnStage } = fixture;
  let commitOnce = true;
  setOnCommit(() => {
    if (!commitOnce) return;
    commitOnce = false;
    seed("posts", "post", { ...tables.posts.get("post"), likes: ["bob-profile"] });
  });
  assert.equal((await invoke({ action: "setLike", postId: "post", shouldLike: true })).status, 200);
  assert.deepEqual(tables.posts.get("post").likes.sort(), ["alice-profile", "bob-profile"]);
  let stageOnce = true;
  setOnStage((table) => {
    if (table !== "posts" || !stageOnce) return;
    stageOnce = false;
    seed("posts", "post", { ...tables.posts.get("post"), likes: ["alice-profile", "bob-profile", "carol-profile"] });
  });
  assert.equal((await invoke({ action: "setLike", postId: "post", shouldLike: false })).status, 200);
  assert.deepEqual(tables.posts.get("post").likes.sort(), ["bob-profile", "carol-profile"]);
});

test("legacy expanded likes survive while unavailable relationships cannot be cleared", async (t) => {
  const { invoke, tables, seed, calls } = setup(t);
  const creator = tables.posts.get("post").creator;
  seed("posts", "post", { creator, likes: [
    { $id: "bob-profile", email: "private" }, { $id: "carol-profile" }, { $id: "owner-profile" },
  ] });
  assert.deepEqual((await invoke({ action: "getLikes", postId: "post" })).data.likes,
    ["bob-profile", "carol-profile", "owner-profile"]);
  assert.equal((await invoke({ action: "setLike", postId: "post", shouldLike: true })).status, 200);
  assert.deepEqual(tables.posts.get("post").likes,
    ["bob-profile", "carol-profile", "owner-profile", "alice-profile"]);
  for (const likes of [null, undefined]) {
    seed("posts", "post", { creator, likes });
    const before = calls.filter((c) => c.method === "PATCH" && c.url.pathname.startsWith(paths.posts)).length;
    assert.equal((await invoke({ action: "setLike", postId: "post", shouldLike: true })).status, 500);
    const after = calls.filter((c) => c.method === "PATCH" && c.url.pathname.startsWith(paths.posts)).length;
    assert.equal(after, before, "missing relationship must never become an empty update");
  }
});

test("like and follow alerts deduplicate reads and can alert again after undo", async (t) => {
  const { invoke, tables } = setup(t);
  for (const body of [
    { action: "setLike", postId: "post", shouldLike: true },
    { action: "set", targetId: "owner-profile", following: true },
  ]) {
    assert.equal((await invoke(body)).status, 200);
    const n = [...tables.notifications.values()].find((n) => n.type === (body.action === "set" ? "follow" : "like"));
    assert.equal((await invoke({ action: "markNotificationRead", id: n.$id }, "owner")).status, 200);
    await invoke(body);
    assert.equal(tables.notifications.get(n.$id).read, true);
    await invoke({ ...body, ...(body.action === "set" ? { following: false } : { shouldLike: false }) });
    assert.equal(tables.notifications.has(n.$id), false);
    await invoke(body);
    assert.equal(tables.notifications.get(n.$id).read, false);
  }
  assert.equal(tables.notifications.size, 2);
});

test("notification lists/counts/read mutations remain recipient-private across pages", async (t) => {
  const { invoke, seed, tables } = setup(t);
  for (let i = 0; i < 24; i++) seed("notifications", `alert-${String(i).padStart(2, "0")}`, {
    recipientId: "alice", actorId: "bob", type: "follow", postId: null, commentId: null, read: false,
  });
  seed("notifications", "private", { recipientId: "bob", actorId: "owner", type: "like", read: false });
  const first = (await invoke({ action: "listNotifications", recipientId: "bob" })).data;
  assert.equal(first.notifications.length, 20);
  assert.equal(first.notifications[0].actor.email, undefined);
  assert.equal(first.notifications[0].recipientId, undefined);
  assert.equal((await invoke({ action: "listNotifications", cursor: first.nextCursor })).data.notifications.length, 4);
  assert.equal((await invoke({ action: "markNotificationRead", id: "private" })).status, 404);
  assert.equal((await invoke({ action: "listNotifications", cursor: "private" })).status, 400);
  assert.equal((await invoke({ action: "unreadCount" })).data.count, 24);
  assert.deepEqual(await invoke({ action: "markAllNotificationsRead" }), { status: 200, data: {} });
  assert.equal((await invoke({ action: "unreadCount" })).data.count, 0);
  assert.equal(tables.notifications.get("private").read, false);
});

test("post permissions and validation apply before writes, with no unsafe transaction fallback", async (t) => {
  const { invoke, tables, calls, disableTransactions } = setup(t);
  const create = { action: "createComment", postId: "post", content: "hello", requestId: "request-private-1" };
  assert.equal((await invoke(create, "carol")).status, 404);
  assert.equal((await invoke({ ...create, content: " " })).status, 400);
  assert.equal((await invoke({ ...create, content: "a".repeat(2001) })).status, 400);
  assert.equal((await invoke(create, "forged")).status, 401);
  assert.equal(tables.comments.size, 0);
  disableTransactions();
  const result = await invoke({ action: "setLike", postId: "post", shouldLike: true });
  assert.equal(result.status, 500);
  assert.ok(!JSON.stringify(result).includes("PRIVATE"));
  assert.equal(calls.filter((call) => call.method === "PATCH" && call.url.pathname.startsWith(paths.posts)).length, 0);
  assert.deepEqual(tables.posts.get("post").likes, []);
});

test("failed comment transaction never publishes half a comment or notification", async (t) => {
  const { invoke, tables, seed, setOnCommit } = setup(t);
  setOnCommit(() => {
    seed("comments", "unrelated", { postId: "post", authorId: "owner", content: "x" });
    throw new Error("upstream secret");
  });
  const result = await invoke({ action: "createComment", postId: "post", content: "hello", requestId: "atomic-request-1" });
  assert.equal(result.status, 500);
  assert.equal(tables.comments.size, 1);
  assert.ok(tables.comments.has("unrelated"));
  assert.equal(tables.notifications.size, 0);
});
