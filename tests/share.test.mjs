import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const source = await readFile(new URL("../src/lib/share.ts", import.meta.url), "utf8");
const { outputText } = ts.transpileModule(source, { compilerOptions: {
  target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022,
} });
const { postShareUrl, sharePostLink } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString("base64")}`);
const url = postShareUrl("post-123");

test("shares always link to the original production post", () => {
  assert.equal(url, "https://zeronet.vercel.app/posts/post-123");
  assert.equal(new URL(postShareUrl("//example.com/?a=1")).origin, "https://zeronet.vercel.app");
  assert.throws(() => postShareUrl(""));
});

test("successful native sharing does not overwrite the clipboard", async () => {
  let payload;
  assert.equal(await sharePostLink(url, {
    share: async (data) => { payload = data; },
    copy: async () => assert.fail("Native share must not also copy"),
  }), "shared");
  assert.deepEqual(payload, { title: "ZeroNet", url });
});

test("dismissing native share is silent and does not fall back to copying", async () => {
  assert.equal(await sharePostLink(url, {
    share: async () => { throw new DOMException("Dismissed", "AbortError"); },
    copy: async () => assert.fail("Cancelled shares must not copy"),
  }), "cancelled");
});

test("unsupported or denied native sharing falls back to confirmed copying", async () => {
  let copied;
  assert.equal(await sharePostLink(url, {
    share: async () => { throw new DOMException("Unavailable", "NotAllowedError"); },
    copy: async (value) => { copied = value; },
  }), "copied");
  assert.equal(copied, url);
});

test("unavailable or denied clipboard offers manual copying without claiming success", async () => {
  assert.equal(await sharePostLink(url, {}), "manual");
  assert.equal(await sharePostLink(url, {
    copy: async () => { throw new DOMException("Denied", "NotAllowedError"); },
  }), "manual");
});
