// Core: turn an extracted article into an "honest" title + summary + a
// clickbait assessment. This is the heart of the "outsmart clickbait" idea:
// the LLM reads the whole thing and reports substance, not bait.

import { customError } from "../shared/providers.js";
import { complete, chooseBackend } from "./llm.js";
import { buildPrompt, parseResult } from "../shared/prompt.js";

export { buildPrompt, parseResult };

export async function debait(article, opts = {}) {
  const backend = opts.backend || chooseBackend();
  const prompt = buildPrompt(article, { language: opts.language, customInstructions: opts.instructions });
  const raw = await complete(prompt, { ...opts, backend });
  const result = parseResult(raw);
  if (backend === "custom" && (!result || typeof result !== "object" || Array.isArray(result) || result.parse_error)) throw customError("response");
  return result;
}
