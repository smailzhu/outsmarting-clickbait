// Single source of truth for the debait prompt + result parsing.
// Pure, browser-safe ES module — no Node APIs — so it is reused by the CLI,
// the Chromium extension, and (inlined) the userscript.

export const MAX_CHARS = 12000;

// Returns the rule line controlling the OUTPUT language of the content fields.
// "auto" (or empty) => match the article's own language.
// anything else      => write content in that language (name or code: "English",
//                       "\u7e41\u9ad4\u4e2d\u6587", "es", "\u65e5\u672c\u8a9e", ...).
// JSON keys and the substance_verdict enum ALWAYS stay English so parsing/UI hold.
export function languageInstruction(language) {
  const l = String(language || "").trim();
  const target =
    !l || l.toLowerCase() === "auto" ? "the same language as the article" : l;
  return `- Write "honest_title", "summary", "key_points" and "clickbait_signals" in ${target}. Keep the JSON keys and the "substance_verdict" value in English.`;
}

export function buildPrompt({ originalTitle, description, text, url }, { language } = {}) {
  const body = (text || "").slice(0, MAX_CHARS);
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
${languageInstruction(language)}

URL: ${url || "(unknown)"}
ORIGINAL TITLE: ${originalTitle || "(none)"}
META DESCRIPTION: ${description || "(none)"}

ARTICLE TEXT:
"""
${body || "(no extractable text — the page may be JS-rendered or paywalled)"}
"""`;
}

export function parseResult(raw) {
  let s = String(raw || "").trim().replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
  const start = s.indexOf("{");
  const end = s.lastIndexOf("}");
  if (start >= 0 && end > start) s = s.slice(start, end + 1);
  try {
    return JSON.parse(s);
  } catch {
    return { parse_error: true, raw };
  }
}
