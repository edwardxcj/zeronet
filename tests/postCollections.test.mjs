import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

let fixtureId = 0;
async function loadPostCollections(t, listDocuments = async () => assert.fail("Unexpected database read")) {
  const key = `__zeronet_post_collections_${fixtureId++}`;
  globalThis[key] = {
    appwriteConfig: { databaseId: "database", postCollectionId: "posts", url: "https://example.test/v1" },
    databases: {
      listDocuments,
      getDocument: async () => assert.fail("Collected posts must not issue per-post or per-author reads"),
    },
  };
  t.after(() => { delete globalThis[key]; });
  const asModule = (source) => `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;
  const configUrl = asModule(`export const { databases, appwriteConfig } = globalThis[${JSON.stringify(key)}];`);
  const sourceUrl = new URL("../src/lib/appwrite/postCollections.ts", import.meta.url);
  const { outputText } = ts.transpileModule(await readFile(sourceUrl, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 },
  });
  const executable = outputText.replace(/from "([^"]+)"/g, (_match, specifier) => {
    if (specifier === "./config") return `from "${configUrl}"`;
    if (specifier === "appwrite") return `from "${new URL("../node_modules/appwrite/dist/esm/sdk.js", import.meta.url)}"`;
    if (!specifier.startsWith(".")) throw new Error(`Unexpected import ${specifier}`);
    return `from "${new URL(`${specifier}.ts`, sourceUrl)}"`;
  });
  return import(asModule(executable));
}

function requestedIds(queries) {
  const prefix = 'equal("$id",';
  const query = queries.find((value) => value.startsWith(prefix));
  assert.ok(query, "Only the requested post IDs should be queried");
  return JSON.parse(query.slice(prefix.length, -1));
}

test("saved IDs retain newest-first order while both collections accept ID references and skip deleted relations", async (t) => {
  const { collectedPostIds } = await loadPostCollections(t);
  const profile = {
    $id: "viewer",
    name: "Viewer name",
    save: [
      { $id: "save-1", post: "saved-2" },
      { $id: "save-2", post: { $id: "saved-1", creator: undefined } },
      { $id: "save-deleted", post: null },
      null,
      "unexpanded-save-record",
      { $id: "save-duplicate", post: { $id: "saved-2" } },
      { $id: "save-empty", post: "" },
      { $id: "save-latest", post: "saved-3" },
    ],
    liked: ["liked-2", { $id: "liked-1", creator: "author-id" }, null, "", {}, { $id: "liked-2" }],
  };
  assert.deepEqual(collectedPostIds(profile, "saved"), ["saved-3", "saved-2", "saved-1"]);
  assert.deepEqual(collectedPostIds(profile, "liked"), ["liked-2", "liked-1"]);
  assert.deepEqual(collectedPostIds(null, "saved"), []);
  assert.deepEqual(collectedPostIds({ save: null, liked: null }, "liked"), []);
  assert.equal(profile.save[0].$id, "save-1", "Extraction must preserve records used to remove a save");
});

test("53 collected posts use bounded batches and canonical authors, preserving order without N+1 reads", async (t) => {
  const ids = Array.from({ length: 53 }, (_, index) => `post-${String(index).padStart(2, "0")}`);
  const rows = ids.map(($id, index) => ({
    $id,
    caption: `Current caption ${index}`,
    imageUrl: `https://example.test/v1/storage/buckets/photos/files/photo-${index}/preview?project=p&width=400`,
    creator: {
      $id: `author-${index}`,
      name: `Real author ${index}`,
      imageUrl: `https://example.test/v1/storage/buckets/avatars/files/avatar-${index}/preview?project=p&quality=60`,
    },
  }));
  const canonical = new Map(rows.map((row) => [row.$id, row]));
  canonical.delete("post-27"); // Deleted or unreadable posts are omitted by the backend.
  const reads = [];
  const api = await loadPostCollections(t, async (database, collection, queries) => {
    assert.equal(database, "database");
    assert.equal(collection, "posts");
    const requested = requestedIds(queries);
    reads.push(requested);
    assert.ok(requested.length > 0 && requested.length <= 25);
    assert.ok(queries.includes(`limit(${requested.length})`));
    return {
      // Deliberately return a different order and an unrelated row.
      documents: [...requested].reverse().flatMap((id) => canonical.has(id) ? [canonical.get(id)] : [])
        .concat({ $id: "unrequested-post", creator: { $id: "viewer", name: "Viewer name" } }),
      total: canonical.size,
    };
  });
  const staleProfile = {
    $id: "viewer", name: "Viewer name",
    save: ids.map((id, index) => ({ $id: `save-${index}`, post: { $id: id, caption: "Stale nested caption" } })),
  };
  const input = [...api.collectedPostIds(staleProfile, "saved"), ids[0], ids[30]];
  const expectedIds = [...ids].reverse();
  const posts = await api.getCollectedPosts(input);
  assert.equal(reads.length, 3, "Authors should arrive with three post batches rather than per-card reads");
  assert.deepEqual(reads.flat(), expectedIds, "Every unique requested ID must be included exactly once");
  assert.deepEqual(posts.map((post) => post.$id), expectedIds.filter((id) => id !== "post-27"));
  for (const post of posts) {
    const index = Number(post.$id.slice("post-".length));
    assert.equal(post.caption, `Current caption ${index}`);
    assert.equal(post.creator.name, `Real author ${index}`);
    assert.equal(post.imageUrl, `https://example.test/v1/storage/buckets/photos/files/photo-${index}/view?project=p`);
    assert.equal(post.creator.imageUrl, `https://example.test/v1/storage/buckets/avatars/files/avatar-${index}/view?project=p`);
  }
  assert.match(rows[0].imageUrl, /\/preview\?/);
  assert.equal(staleProfile.save[0].post.creator, undefined);
});

test("liked ID references resolve their real authors and a genuinely missing creator remains missing", async (t) => {
  const canonical = [
    { $id: "liked-a", creator: { $id: "author-a", name: "Author A", imageUrl: "https://example.test/a.jpg" } },
    { $id: "liked-b", creator: { $id: "author-b", name: "Author B", imageUrl: "https://example.test/b.jpg" } },
    { $id: "liked-orphan", creator: null },
  ];
  const api = await loadPostCollections(t, async (_database, _collection, queries) => {
    const ids = requestedIds(queries);
    return { documents: canonical.filter((post) => ids.includes(post.$id)), total: canonical.length };
  });
  const profile = { $id: "viewer", name: "Viewer name", liked: ["liked-b", { $id: "liked-a", creator: "unexpanded-author" }, "liked-orphan"] };
  const posts = await api.getCollectedPosts(api.collectedPostIds(profile, "liked"));
  assert.deepEqual(posts.map((post) => post.creator?.name ?? null), ["Author B", "Author A", null]);
  assert.equal(posts[0].creator.imageUrl, "https://example.test/b.jpg");
  assert.equal(posts[2].creator, null);
});

test("empty collections do not read posts and batch failures reject instead of returning a partial collection", async (t) => {
  const error = new TypeError("Post collection read failed");
  let reads = 0;
  const api = await loadPostCollections(t, async () => {
    reads++;
    if (reads === 1) return { documents: [{ $id: "post-0", creator: { name: "Author" } }], total: 1 };
    throw error;
  });
  assert.deepEqual(await api.getCollectedPosts([]), []);
  assert.equal(reads, 0);
  await assert.rejects(api.getCollectedPosts(Array.from({ length: 42 }, (_, index) => `post-${index}`)), (received) => received === error);
  assert.equal(reads, 2);
});
