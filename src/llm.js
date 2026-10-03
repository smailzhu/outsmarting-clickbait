// Pluggable LLM backend.
//
// Backends, auto-selected:
//   1. a provider (openai, anthropic, gemini, groq, openrouter, deepseek, xai,
//      mistral, together, ollama) — if its API key env var is set, or forced.
//   2. "codex" — otherwise, shells out to the `codex exec` CLI if present.
//
// Env:
//   DEBAIT_PROVIDER=<id>     force provider (see shared/providers.js)
//   DEBAIT_BACKEND=codex     force the codex CLI
//   DEBAIT_MODEL / DEBAIT_BASE_URL   override model / base for the provider
//   <PROVIDER>_API_KEY       e.g. OPENAI_API_KEY, ANTHROPIC_API_KEY, GEMINI_API_KEY

import { spawn } from "node:child_process";
import { PROVIDERS, resolveProvider, callProvider, listModels as providerListModels } from "../shared/providers.js";

function providerConfig(providerId) {
  const def = PROVIDERS[providerId];
  if (!def) throw new Error(`Unknown provider: ${providerId}`);
  const cfg = resolveProvider({
    provider: providerId,
    base: process.env.DEBAIT_BASE_URL,
    model: process.env.DEBAIT_MODEL,
    key: process.env[def.keyEnv] || process.env.DEBAIT_API_KEY,
  });
  if (!cfg.key && providerId !== "ollama") {
    throw new Error(`No API key for "${providerId}". Set ${def.keyEnv} (or DEBAIT_API_KEY).`);
  }
  return cfg;
}

// List the model IDs available to the configured key for a provider.
export async function listModels(providerId = chooseBackend()) {
  if (providerId === "codex") {
    throw new Error("The codex backend has no model list. Pick a provider: --models <provider> or DEBAIT_PROVIDER.");
  }
  return providerListModels(providerConfig(providerId));
}

// Returns "codex" or a provider id.
export function chooseBackend() {
  if (process.env.DEBAIT_BACKEND === "codex") return "codex";
  if (process.env.DEBAIT_PROVIDER) return process.env.DEBAIT_PROVIDER.toLowerCase();
  // Pick the first provider whose key env var is present.
  for (const [id, def] of Object.entries(PROVIDERS)) {
    if (process.env[def.keyEnv]) return id;
  }
  return "codex";
}

export async function complete(prompt, { backend = chooseBackend() } = {}) {
  if (backend === "codex") return completeCodex(prompt);
  return completeProvider(prompt, backend);
}

async function completeProvider(prompt, providerId) {
  return callProvider(providerConfig(providerId), prompt);
}

// Shell out to the Codex CLI in non-interactive mode.
function completeCodex(prompt) {
  return new Promise((resolve, reject) => {
    const args = ["exec", "--skip-git-repo-check"];
    const child = spawn("codex", args, { stdio: ["pipe", "pipe", "pipe"] });
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("error", (e) =>
      reject(new Error(`Failed to run codex: ${e.message}. Is the codex CLI installed?`))
    );
    child.on("close", (code) => {
      if (code !== 0) return reject(new Error(`codex exited ${code}: ${err}`));
      resolve(extractCodexAnswer(out));
    });
    child.stdin.write(prompt);
    child.stdin.end();
  });
}

// `codex exec` prints a banner, streamed logs, then the final answer, then a
// "tokens used" footer. We grab the final answer block heuristically.
function extractCodexAnswer(raw) {
  const lines = raw.split("\n");
  const footerIdx = lines.findIndex((l) => /^tokens used/i.test(l.trim()));
  const body = footerIdx >= 0 ? lines.slice(0, footerIdx) : lines;
  // The final "codex" marker precedes the final answer.
  let lastMarker = -1;
  for (let i = 0; i < body.length; i++) {
    if (body[i].trim() === "codex") lastMarker = i;
  }
  const answer = (lastMarker >= 0 ? body.slice(lastMarker + 1) : body).join("\n");
  return answer.trim();
}
