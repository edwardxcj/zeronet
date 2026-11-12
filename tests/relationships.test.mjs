import assert from "node:assert/strict";
import test from "node:test";
import {
  relationshipDocuments,
  relationshipId,
  relationshipIds,
} from "../src/lib/appwrite/relationships.ts";

test("a profile still renders legacy posts whose nested likes were not expanded", () => {
  const legacyPost = { $id: "old-post", likes: null };
  const newerPost = { $id: "new-post", likes: [{ $id: "user-1" }] };
  const posts = relationshipDocuments([legacyPost, null, "missing-post", newerPost]);

  assert.deepEqual(posts, [legacyPost, newerPost]);
  assert.equal(relationshipIds(posts[0].likes), undefined);
  assert.deepEqual(relationshipIds(posts[1].likes), ["user-1"]);
});

test("known empty likes can be edited while unavailable or partial likes cannot", () => {
  assert.deepEqual(relationshipIds([]), []);
  assert.deepEqual(relationshipIds(["user-1", { $id: "user-2" }]), ["user-1", "user-2"]);
  assert.equal(relationshipIds(undefined), undefined);
  assert.equal(relationshipIds([{ $id: "user-1" }, null]), undefined);
});

test("save records may contain a post ID, an expanded post, or a deleted relation", () => {
  assert.equal(relationshipId("post-1"), "post-1");
  assert.equal(relationshipId({ $id: "post-1" }), "post-1");
  assert.equal(relationshipId(null), undefined);
  assert.deepEqual(relationshipDocuments(null), []);
});
