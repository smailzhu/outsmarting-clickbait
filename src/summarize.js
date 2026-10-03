// Core: turn an extracted article into an "honest" title + summary + a
// clickbait assessment. This is the heart of the "outsmart clickbait" idea:
// the LLM reads the whole thing and reports substance, not bait.

import { complete } from "./llm.js";

const MAX_CHARS = 12000; // keep prompts cheap; clickbait pieces are short anyway

export function buildPrompt({ originalTitle, description, text, url }) {
  const body = text.slice(0, MAX_CHARS);
  return `You are given a web article. Read it and report its actual substance,
ignoring any sensational framing. Judge it the way a skeptical editor would.

Respond with ONLY a JSON object (no markdown fences, no prose) of this shape:
{
  "honest_title": "a plain, accurate headline with no hype or curiosity gap",
  "summary": "2-4 sentences covering the real takeaways. If there is no real content, say so plainly.",
  "key_points": ["concrete point 1", "concrete point 2"],
  "clickbait_score": 0,
  "clickbait_signals": ["which manipulative techniques are used, if any"],
  "substance_verdict": "one of: substantial | thin | empty",
  "worth_clicking": true
}

Rules:
- clickbait_score is 0 (honest) to 100 (pure bait).
- "worth_clicking" is whether a reader learns anything beyond what your summary already tells them.
- Do not repeat false claims as fact; attribute them ("the article claims...").
- Be terse and dispassionate.

URL: ${url || "(unknown)"}
ORIGINAL TITLE: ${originalTitle || "(none)"}
META DESCRIPTION: ${description || "(none)"}

ARTICLE TEXT:
"""
${body || "(no extractable text — the page may be JS-rendered or paywalled)"}
"""`;
}

export function parseResult(raw) {
  // Be forgiving: strip code fences, grab the outermost JSON object.
  let s = raw.trim().replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
  const start = s.indexOf("{");
  const end = s.lastIndexOf("}");
  if (start >= 0 && end > start) s = s.slice(start, end + 1);
  try {
    return JSON.parse(s);
  } catch {
    return { parse_error: true, raw };
  }
}

export async function debait(article, opts = {}) {
  const prompt = buildPrompt(article);
  const raw = await complete(prompt, opts);
  return parseResult(raw);
}
