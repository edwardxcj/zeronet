import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

import {
  captureHomeScroll,
  readHomeView,
  rememberHomeFeed,
  rememberHomeScroll,
  restoreHomeScroll,
  uniqueFeedPosts,
} from "../src/lib/homeFeedState.ts";

let fixtureId = 0;
async function loadHomeFeed(t, listDocuments) {
  const key = `__zeronet_home_feed_${fixtureId++}`;
  globalThis[key] = {
    databases: { listDocuments },
    appwriteConfig: { databaseId: "database", postCollectionId: "posts", url: "https://images.example.test/v1" },
  };
  t.after(() => { delete globalThis[key]; });
  const configUrl = `data:text/javascript;base64,${Buffer.from(
    `export const { databases, appwriteConfig } = globalThis[${JSON.stringify(key)}];`
  ).toString("base64")}`;
  const sourceUrl = new URL("../src/lib/appwrite/homeFeed.ts", import.meta.url);
  const { outputText } = ts.transpileModule(await readFile(sourceUrl, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 },
  });
  const executable = outputText.replace(/from "([^"]+)"/g, (_match, specifier) => {
    if (specifier === "./config") return `from "${configUrl}"`;
    if (specifier === "appwrite") return `from "${new URL("../node_modules/appwrite/dist/esm/sdk.js", import.meta.url)}"`;
    return `from "${new URL(`${specifier}.ts`, sourceUrl)}"`;
  });
  return import(`data:text/javascript;base64,${Buffer.from(executable).toString("base64")}`);
}

test("Home uses stable20-post cursor pages even with tied dates, new posts and updated likes", async (t) => {
  const documents = Array.from({ length: 45 }, (_, index) => ({
    $id: `post-${String(index).padStart(2, "0")}`,
    $createdAt: index < 25 ? "2026-01-01T00:00:00.000Z" : "2026-01-02T00:00:00.000Z",
    $updatedAt: "2026-01-02T00:00:00.000Z",
    imageUrl: "https://images.example.test/v1/storage/buckets/photos/files/image/preview?project=p&width=400",
  }));
  const originalIds = documents.map((post) => post.$id).sort();
  const cursors = [];
  const { getHomeFeedPage } = await loadHomeFeed(t, async (database, collection, encoded) => {
    assert.equal(database, "database");
    assert.equal(collection, "posts");
    assert.deepEqual(encoded.slice(0, 3), [
      'orderDesc("$createdAt")',
      'orderDesc("$id")',
      "limit(20)",
    ]);
    const cursorQuery = encoded.find((query) => query.startsWith("cursorAfter("));
    const cursor = cursorQuery ? JSON.parse(cursorQuery.slice("cursorAfter(".length, -1)) : undefined;
    cursors.push(cursor);
    const ordered = [...documents].sort((a, b) => b.$createdAt.localeCompare(a.$createdAt) || b.$id.localeCompare(a.$id));
    const start = cursor ? ordered.findIndex((post) => post.$id === cursor) + 1 : 0;
    assert.ok(!cursor || start > 0);
    return { documents: ordered.slice(start, start + 20), total: documents.length };
  });

  const first = await getHomeFeedPage(null);
  assert.equal(first.documents.length, 20);
  assert.equal(first.nextCursor, first.documents.at(-1).$id);
  assert.equal(first.documents[0].imageUrl, "https://images.example.test/v1/storage/buckets/photos/files/image/view?project=p");
  documents[0].$updatedAt = "2027-01-01T00:00:00.000Z";
  documents.push({ $id: "new-post", $createdAt: "2026-02-01T00:00:00.000Z" });
  const second = await getHomeFeedPage(first.nextCursor);
  const third = await getHomeFeedPage(second.nextCursor);
  assert.equal(second.documents.length, 20);
  assert.equal(third.documents.length, 5);
  assert.equal(third.nextCursor, undefined);
  assert.deepEqual(cursors, [undefined, first.nextCursor, second.nextCursor]);
  assert.deepEqual(uniqueFeedPosts([first, second, third]).map((post) => post.$id).sort(), originalIds);
});

test("Home pagination propagates failures and rejects a cursor that did not advance", async (t) => {
  const failure = new Error("Network unavailable");
  const failed = await loadHomeFeed(t, async () => { throw failure; });
  await assert.rejects(failed.getHomeFeedPage(null), (error) => error === failure);
  const repeated = await loadHomeFeed(t, async () => ({ documents: [{ $id: "same-cursor" }], total: 1 }));
  await assert.rejects(repeated.getHomeFeedPage("same-cursor"), /did not advance/);
});

test("overlapping refreshed feed pages render each post once without mutating cached pages", () => {
  const first = { $id: "first", caption: "newest version" };
  const pages = [{ documents: [first, { $id: "second" }] }, { documents: [{ $id: "second" }, { $id: "third" }] }];
  assert.deepEqual(uniqueFeedPosts(pages).map((post) => post.$id), ["first", "second", "third"]);
  assert.equal(uniqueFeedPosts(pages)[0], first);
  assert.equal(pages[1].documents.length, 2);
});

test("selected feed and saved position survive navigation separately for each viewer and feed", () => {
  const viewer = "home-state-viewer";
  rememberHomeScroll(viewer, "all", { top: 1800, pages: 3, anchorId: "older-post", anchorOffset: -40 });
  rememberHomeFeed(viewer, "following");
  rememberHomeScroll(viewer, "following", { top: 650, pages: 2, anchorId: "followed-post", anchorOffset: -80 });
  const returning = readHomeView(viewer);
  assert.equal(returning.feed, "following");
  assert.equal(returning.positions.all.top, 1800);
  assert.equal(returning.positions.all.pages, 3);
  assert.equal(returning.positions.following.top, 650);
  assert.deepEqual(readHomeView("another-home-viewer"), {
    feed: "all", positions: { all: { top: 0, pages: 1 }, following: { top: 0, pages: 1 } },
  });
  returning.positions.all.top = 0;
  assert.equal(readHomeView(viewer).positions.all.top, 1800, "callers cannot mutate another saved view");
});

test("restoration anchors the visible post after earlier content changes and falls back after deletion", () => {
  let precedingHeight = 0;
  const container = {
    scrollTop: 800,
    getBoundingClientRect: () => ({ top: 100, bottom: 900 }),
    querySelectorAll: () => cards,
  };
  const cards = [0, 1, 2].map((index) => ({
    dataset: { homePost: `post-${index}` },
    getBoundingClientRect: () => ({
      top: 100 + precedingHeight + index * 700 - container.scrollTop,
      bottom: 100 + precedingHeight + (index + 1) * 700 - container.scrollTop,
    }),
  }));
  const saved = captureHomeScroll(container, 3);
  assert.deepEqual(saved, { top: 800, pages: 3, anchorId: "post-1", anchorOffset: -100 });
  precedingHeight = 120;
  container.scrollTop = 0;
  restoreHomeScroll(container, saved);
  assert.equal(container.scrollTop, 920, "earlier loaded content should not move the visible anchor");
  container.querySelectorAll = () => [];
  container.scrollTop = 0;
  restoreHomeScroll(container, saved);
  assert.equal(container.scrollTop, 800);
});
