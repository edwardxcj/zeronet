import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const source = await readFile(new URL("../src/lib/postLoginDestination.ts", import.meta.url), "utf8");
const { outputText } = ts.transpileModule(source, { compilerOptions: {
  target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022,
} });
const { postLoginDestination } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString("base64")}`);

test("login returns to a shared post including its linked comment", () => {
  assert.equal(postLoginDestination({ from: "/posts/6af54191c0909efdff9b?comment=abc#comments" }), "/posts/6af54191c0909efdff9b?comment=abc#comments");
});

test("external, malformed and unrelated login destinations return safely to Home", () => {
  for (const from of ["https://example.com", "//example.com/posts/abc", "/\\example.com/posts/abc", "javascript:alert(1)", "/posts/%2F%2Fexample.com", "/sign-in", "/create-post", "/posts/abc\n", "", null]) {
    assert.equal(postLoginDestination({ from }), "/", JSON.stringify(from));
  }
  for (const state of [undefined, null, "bad", {}, { from: {} }]) assert.equal(postLoginDestination(state), "/");
});
