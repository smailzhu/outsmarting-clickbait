// Pluggable LLM backend.
//
// Two backends, auto-selected:
//   1. "openai"  — if OPENAI_API_KEY is set, calls an OpenAI-compatible
//                  chat completions endpoint (OPENAI_BASE_URL overridable).
//   2. "codex"   — otherwise, shells out to the `codex exec` CLI if present.
//
// Override explicitly with DEBAIT_BACKEND=openai|codex.

import { spawn } from "node:child_process";

export function chooseBackend() {
  const forced = process.env.DEBAIT_BACKEND;
  if (forced) return forced;
  if (process.env.OPENAI_API_KEY) return "openai";
  return "codex";
}

export async function complete(prompt, { backend = chooseBackend() } = {}) {
  if (backend === "openai") return completeOpenAI(prompt);
  if (backend === "codex") return completeCodex(prompt);
  throw new Error(`Unknown backend: ${backend}`);
}

async function completeOpenAI(prompt) {
  const base = process.env.OPENAI_BASE_URL || "https://api.openai.com/v1";
  const model = process.env.DEBAIT_MODEL || "gpt-4o-mini";
  const res = await fetch(`${base}/chat/completions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      messages: [
        {
          role: "system",
          content:
            "You are a precise editor. You always respond with the exact format requested, nothing else.",
        },
        { role: "user", content: prompt },
      ],
    }),
  });
  if (!res.ok) {
    throw new Error(`OpenAI API error ${res.status}: ${await res.text()}`);
  }
  const data = await res.json();
  return data.choices?.[0]?.message?.content ?? "";
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
