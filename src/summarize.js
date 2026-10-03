// Core: turn an extracted article into an "honest" title + summary + a
// clickbait assessment. This is the heart of the "outsmart clickbait" idea:
// the LLM reads the whole thing and reports substance, not bait.

import { complete } from "./llm.js";
import { buildPrompt, parseResult } from "../shared/prompt.js";

export { buildPrompt, parseResult };

export async function debait(article, opts = {}) {
  const prompt = buildPrompt(article, { language: opts.language });
  const raw = await complete(prompt, opts);
  return parseResult(raw);
}
