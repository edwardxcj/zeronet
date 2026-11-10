import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const source = await readFile(
  new URL("../src/lib/appwrite/imageUrls.ts", import.meta.url),
  "utf8"
);
const { outputText } = ts.transpileModule(source, {
  compilerOptions: {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ES2022,
  },
});
const { getFileViewUrl, normalizeImageUrls } = await import(
  `data:text/javascript;base64,${Buffer.from(outputText).toString("base64")}`
);

const endpoint = "https://cloud.appwrite.io/v1";
const preview =
  `${endpoint}/storage/buckets/photos/files/old-photo/preview` +
  "?width=2000&height=2000&gravity=top&quality=100&project=zeronet";
const view =
  `${endpoint}/storage/buckets/photos/files/old-photo/view` +
  "?project=zeronet";

test("legacy previews become originals while project and access parameters survive", () => {
  const url = getFileViewUrl(
    preview +
      "&token=access%2Btoken%3D&custom=keep&width=300" +
      "&borderWidth=2&borderColor=fff&borderRadius=8&opacity=0.5" +
      "&rotation=90&background=000&output=webp",
    endpoint
  );

  assert.equal(
    url,
    view + "&token=access%2Btoken%3D&custom=keep"
  );
});

test("only storage previews beneath the configured endpoint are converted", () => {
  const unchanged = [
    preview.replace("cloud.appwrite.io", "other.cloud.appwrite.io"),
    preview.replace("https:", "http:"),
    preview.replace("/v1/", "/v10/"),
    preview.replace("/v1/storage/", "/v1/other/storage/"),
    preview.replace("/preview?", "/preview/extra?"),
    preview.replace("/buckets/photos/", "/buckets//"),
    `${endpoint}/avatars/initials?name=Zero&project=zeronet`,
  ];

  for (const url of unchanged) {
    assert.equal(getFileViewUrl(url, endpoint), url);
  }
  assert.equal(getFileViewUrl(preview, endpoint + "/"), view);
  assert.equal(
    getFileViewUrl(preview.replace("/v1/", "/api/v1/"),
      "https://cloud.appwrite.io/api/v1"),
    view.replace("/v1/", "/api/v1/")
  );
});

test("existing view URLs, other image sources, and invalid input remain unchanged", () => {
  const unchanged = [
    view,
    "/assets/icons/profile-placeholder.svg",
    "/v1/storage/buckets/photos/files/old-photo/preview?project=zeronet",
    "blob:https://zeronet.vercel.app/selected-file",
    "data:image/png;base64,aW1hZ2U=",
    "https://images.example.com/photo.jpg?width=2000",
    "not a URL",
    "",
  ];

  for (const url of unchanged) {
    assert.equal(getFileViewUrl(url, endpoint), url);
  }
  assert.equal(getFileViewUrl(preview, "invalid endpoint"), preview);
});

test("all nested relationship images are normalized without changing other fields", () => {
  const input = {
    total: 1,
    documents: [{
      $id: "user-1",
      imageUrl: preview,
      caption: preview,
      creator: { imageUrl: preview },
      posts: [{ imageUrl: preview, creator: { imageUrl: preview } }],
      liked: [{ imageUrl: preview }],
      save: [{ post: { imageUrl: preview, creator: { imageUrl: preview } } }],
      optional: null,
    }],
  };
  const expected = {
    total: 1,
    documents: [{
      $id: "user-1",
      imageUrl: view,
      caption: preview,
      creator: { imageUrl: view },
      posts: [{ imageUrl: view, creator: { imageUrl: view } }],
      liked: [{ imageUrl: view }],
      save: [{ post: { imageUrl: view, creator: { imageUrl: view } } }],
      optional: null,
    }],
  };

  assert.deepEqual(normalizeImageUrls(input, endpoint), expected);
});

test("normalization copies nested API data, preserves the input, and is idempotent", () => {
  const avatar = `${endpoint}/avatars/initials?name=Zero&project=zeronet`;
  const nested = Object.freeze({ imageUrl: preview, untouched: avatar });
  const input = Object.freeze({
    imageUrl: avatar,
    posts: Object.freeze([nested]),
    omitted: undefined,
    optional: null,
    enabled: false,
  });
  const output = normalizeImageUrls(input, endpoint);

  assert.equal(input.posts[0].imageUrl, preview);
  assert.notEqual(output, input);
  assert.notEqual(output.posts, input.posts);
  assert.notEqual(output.posts[0], nested);
  assert.equal(output.posts[0].imageUrl, view);
  assert.equal(output.imageUrl, avatar);
  assert.equal(output.posts[0].untouched, avatar);
  assert.equal(output.omitted, undefined);
  assert.equal(output.optional, null);
  assert.equal(output.enabled, false);
  assert.deepEqual(normalizeImageUrls(output, endpoint), output);
});
