import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { extractArticle } from "../src/extract.js";
import { buildPrompt, parseResult } from "../src/summarize.js";

const here = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(here, "..", "examples", "sample-clickbait.html"), "utf8");

test("extractArticle pulls title, description and body text", () => {
  const a = extractArticle(html, "https://example.com/x");
  assert.match(a.originalTitle, /DESTROY The Entire Media Industry/i); // og:title preferred
  assert.match(a.description, /One weird trick/i);
  assert.match(a.text, /AI tools could summarize articles/i);
  // Non-content stripped out.
  assert.doesNotMatch(a.text, /Sponsored: Buy gold/i);
  assert.doesNotMatch(a.text, /Home \| Trending/i);
});

test("extractArticle survives malformed numeric entities (no RangeError)", () => {
  const a = extractArticle("<article>hello &#1114112; world is here</article>");
  assert.match(a.text, /hello/);
  assert.match(a.text, /world is here/);
});

test("extractArticle keeps double-quoted meta content with apostrophes", () => {
  const a = extractArticle(`<meta name="description" content="It's useful"><article><p>body content that is long enough to be retained here</p></article>`);
  assert.equal(a.description, "It's useful");
});

test("extractArticle preserves an article's own <header> lead", () => {
  const a = extractArticle("<article><header><h1>Title</h1><p>Important lead</p></header><p>Remainder</p></article>");
  assert.match(a.text, /Important lead/);
  assert.match(a.text, /Remainder/);
});

test("extractArticle treats <script> as raw text (literal <script> in JS not nested)", () => {
  const a = extractArticle('<script>const x = "<script>";</script><article>Real story</article>');
  assert.equal(a.text, "Real story");
});

test("extractArticle meta parsing is quote-aware (no false attr matches)", () => {
  assert.equal(
    extractArticle(`<meta name="description" data-note="content='wrong'" content="right"><article>Body</article>`).description,
    "right"
  );
  assert.equal(
    extractArticle(`<meta data-note="name='description'" content="wrong"><meta name="description" content="right"><article>Body</article>`).description,
    "right"
  );
  // "data.name" is one attribute name, not "name".
  assert.equal(extractArticle(`<meta data.name="description" content="wrong"><article>Body</article>`).description, "");
});

test("extractArticle: a <script> written inside <style> CSS text doesn't drop content", () => {
  assert.equal(extractArticle('<style>p::after { content: "<script>"; }</style><article>Story</article>').text, "Story");
  assert.equal(extractArticle('<script>a="<style>"</script><style>b="<script>"</style><article>Keep</article>').text, "Keep");
});

test("extractArticle is near-linear on pathological unclosed <script>", () => {
  const start = Date.now();
  extractArticle("<script>".repeat(200000));
  assert.ok(Date.now() - start < 1000, "extraction should stay fast on adversarial input");
});

test("buildPrompt embeds the article and asks for JSON", () => {
  const a = extractArticle(html);
  const p = buildPrompt(a);
  assert.match(p, /ONLY a JSON object/);
  assert.match(p, /clickbait_score/);
  assert.match(p, /AI tools could summarize articles/i);
});

test("buildPrompt language: auto by default, explicit when given", () => {
  const a = extractArticle(html);
  assert.match(buildPrompt(a), /same language as the article/);
  assert.match(buildPrompt(a, { language: "auto" }), /same language as the article/);
  const p = buildPrompt(a, { language: "\u7e41\u9ad4\u4e2d\u6587" });
  assert.match(p, /in \u7e41\u9ad4\u4e2d\u6587/);
  // Structure stays English so parsing/UI don't break.
  assert.match(p, /substance_verdict" value in English/);
});

test("parseResult tolerates code fences and surrounding prose", () => {
  const r = parseResult('here you go:\n```json\n{"honest_title":"x","clickbait_score":90}\n```');
  assert.equal(r.honest_title, "x");
  assert.equal(r.clickbait_score, 90);
});

test("parseResult reports parse_error on garbage", () => {
  const r = parseResult("not json at all");
  assert.equal(r.parse_error, true);
});
