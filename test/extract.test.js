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

test("buildPrompt embeds the article and asks for JSON", () => {
  const a = extractArticle(html);
  const p = buildPrompt(a);
  assert.match(p, /ONLY a JSON object/);
  assert.match(p, /clickbait_score/);
  assert.match(p, /AI tools could summarize articles/i);
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
