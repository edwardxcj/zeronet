import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";
import { postSaveErrorMessage } from "../src/lib/postErrors.ts";

let fixtureId = 0;
async function loadPostApi(t, { storage = {}, databases = {} } = {}) {
  const key = `__zeronet_post_upload_${fixtureId++}`;
  globalThis[key] = {
    appwriteConfig: { url: "https://example.test/v1", databaseId: "db", postCollectionId: "posts", storageId: "photos" },
    account: {}, avatars: {},
    storage: { getFileView: (_bucket, id) => new URL(`https://example.test/v1/storage/buckets/photos/files/${id}/view`), ...storage },
    databases,
  };
  t.after(() => { delete globalThis[key]; });
  const asModule = (source) => `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;
  const configUrl = asModule(`export const {appwriteConfig,account,avatars,storage,databases}=globalThis[${JSON.stringify(key)}];`);
  const socialUrl = asModule('export function setPostLike(){throw new Error("Unexpected social mutation")}');
  const apiUrl = new URL("../src/lib/appwrite/api.ts", import.meta.url);
  const source = await readFile(apiUrl, "utf8");
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
  });
  const executable = outputText.replace(/from "([^"]+)"/g, (_match, specifier) => {
    if (specifier === "./config") return `from "${configUrl}"`;
    if (specifier === "./social") return `from "${socialUrl}"`;
    if (specifier === "appwrite") return `from "${new URL("../node_modules/appwrite/dist/esm/sdk.js", import.meta.url)}"`;
    if (!specifier.startsWith(".")) throw new Error(`Unexpected import ${specifier}`);
    return `from "${new URL(`${specifier}.ts`, apiUrl)}"`;
  });
  return import(asModule(executable));
}

test("create uses SDK 13's real fifth-argument progress and finishes with a separate database phase", async (t) => {
  const progress = [];
  const file = new File(["photo"], "photo.jpg", { type: "image/jpeg" });
  let document;
  const api = await loadPostApi(t, {
    storage: { createFile: async (bucket, _id, selected, permissions, onProgress) => {
      assert.equal(bucket, "photos");
      assert.equal(selected, file);
      assert.equal(permissions, undefined);
      assert.equal(typeof onProgress, "function");
      onProgress({ progress: 37.5 });
      return { $id: "image-1" };
    } },
    databases: { createDocument: async (_db, _collection, id, data) => {
      assert.deepEqual(progress.at(-1), { phase: "saving" });
      document = data;
      return { $id: id, ...data };
    } },
  });
  const post = await api.createPost({ userId: "person-1", caption: "A photo", location: "Sydney", tags: "art, night", file: [file], onProgress: (value) => progress.push(value) });
  assert.ok(post);
  assert.deepEqual(progress, [
    { phase: "uploading" }, { phase: "uploading", percent: 37.5 },
    { phase: "uploading", percent: 100 }, { phase: "saving" },
  ]);
  assert.equal(document.creator, "person-1");
  assert.equal(document.imageId, "image-1");
  assert.deepEqual(document.tags, ["art", "night"]);
  assert.equal("onProgress" in document, false);
  assert.equal("likes" in document, false);
});

test("a small upload without SDK intermediate callbacks stays indeterminate until it really completes", async (t) => {
  const progress = [];
  const api = await loadPostApi(t, {
    storage: { createFile: async () => {
      assert.deepEqual(progress, [{ phase: "uploading" }]);
      return { $id: "small-image" };
    } },
  });
  await api.uploadFile(new File(["small"], "small.jpg"), (value) => progress.push(value));
  assert.deepEqual(progress, [{ phase: "uploading" }, { phase: "uploading", percent: 100 }]);
});

test("editing text keeps the published image and social relationships without an upload", async (t) => {
  const progress = [];
  const imageUrl = new URL("https://example.test/image.jpg");
  let data;
  const api = await loadPostApi(t, {
    storage: { createFile: async () => { assert.fail("Unchanged image must not upload"); } },
    databases: { updateDocument: async (_db, _collection, id, next) => {
      data = next;
      return { $id: id, ...next, likes: ["person-2"], save: [{ $id: "save-1" }] };
    } },
  });
  const updated = await api.updatePost({ postId: "post-1", caption: "Updated caption", location: "Perth", tags: "new", imageId: "image-existing", imageUrl, file: [], onProgress: (value) => progress.push(value) });
  assert.deepEqual(progress, [{ phase: "saving" }]);
  assert.equal(data.imageId, "image-existing");
  assert.equal(data.imageUrl, imageUrl);
  assert.equal("likes" in data, false);
  assert.equal("save" in data, false);
  assert.deepEqual(updated.likes, ["person-2"]);
});

test("upload failure never reports completion or writes a post", async (t) => {
  t.mock.method(console, "log", () => {});
  const progress = [];
  let writes = 0;
  const api = await loadPostApi(t, {
    storage: { createFile: async () => { throw new TypeError("Connection interrupted"); } },
    databases: { createDocument: async () => { writes++; } },
  });
  await assert.rejects(api.createPost({ userId: "person-1", caption: "Keep my draft", file: [new File(["photo"], "photo.jpg")], onProgress: (value) => progress.push(value) }), TypeError);
  assert.equal(writes, 0);
  assert.deepEqual(progress, [{ phase: "uploading" }]);
});

test("size-limit failures survive upload and post wrappers and show a safe actionable message", async (t) => {
  t.mock.method(console, "log", () => {});
  const error = { code: 400, type: "storage_invalid_file_size", message: "private bucket configuration" };
  const api = await loadPostApi(t, {
    storage: { createFile: async () => { throw error; } },
  });
  const file = new File(["photo"], "photo.jpg");
  for (const request of [
    () => api.uploadFile(file),
    () => api.createPost({ userId: "person-1", caption: "Keep my draft", file: [file] }),
    () => api.updatePost({ postId: "post-1", caption: "Keep my draft", imageId: "old-image", imageUrl: new URL("https://example.test/old.jpg"), file: [file] }),
  ]) {
    await assert.rejects(request(), (received) => received === error);
  }
  for (const action of ["Create", "Update"]) {
    assert.equal(postSaveErrorMessage(error, action), "This photo exceeds the upload size limit. Choose a smaller image and try again. Your draft is still here.");
    assert.doesNotMatch(postSaveErrorMessage(error, action), /private|\d+\s*(mb|kb)/i);
  }
});

test("document write failures reject and unknown server details never reach the form message", async (t) => {
  t.mock.method(console, "log", () => {});
  const error = { code: 403, type: "general_unauthorized_scope", message: "secret internal server details" };
  const api = await loadPostApi(t, {
    storage: { createFile: async () => ({ $id: "new-image" }) },
    databases: {
      createDocument: async () => { throw error; },
      updateDocument: async () => { throw error; },
    },
  });
  await assert.rejects(api.createPost({ userId: "person-1", caption: "Draft", file: [new File(["photo"], "photo.jpg")] }), (received) => received === error);
  await assert.rejects(api.updatePost({ postId: "post-1", caption: "Draft", imageId: "old-image", imageUrl: new URL("https://example.test/old.jpg"), file: [] }), (received) => received === error);
  for (const value of [error, new TypeError("secret internal server details"), null, undefined]) {
    assert.match(postSaveErrorMessage(value, "Create"), /publish.*still here.*Try again/);
    assert.match(postSaveErrorMessage(value, "Update"), /save.*still here.*Try again/);
    assert.doesNotMatch(postSaveErrorMessage(value, "Create"), /secret|internal|server details/);
  }
});
