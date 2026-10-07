#!/usr/bin/env node
// debait — strip the bait out of clickbait.
//
// Usage:
//   debait <url> [--json] [--backend openai|codex]
//   cat article.html | debait --stdin [--url https://...] [--json]

import { loadArticle, extractArticle } from "./extract.js";
import { debait } from "./summarize.js";
import { chooseBackend, listModels } from "./llm.js";

function parseArgs(argv) {
  const args = { _: [], flags: {} };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--json") args.flags.json = true;
    else if (a === "--stdin") args.flags.stdin = true;
    else if (a === "--url") args.flags.url = argv[++i];
    else if (a === "--backend") args.flags.backend = argv[++i];
    else if (a === "--lang") args.flags.lang = argv[++i];
    else if (a === "--instructions") args.flags.instructions = argv[++i];
    else if (a === "--models") args.flags.models = true;
    else if (a === "-h" || a === "--help") args.flags.help = true;
    else args._.push(a);
  }
  return args;
}

function readStdin() {
  return new Promise((resolve) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (c) => (data += c));
    process.stdin.on("end", () => resolve(data));
  });
}

const HELP = `debait — outsmart clickbait with an honest-title summarizer

Usage:
  debait <url> [--json] [--backend openai|codex]
  debait --stdin [--url <url>] [--json]        # read raw HTML from stdin

Backend (auto): first provider whose API key env var is set, else codex CLI.
Providers: openai, anthropic, gemini, groq, openrouter, deepseek, xai,
           mistral, together, nvidia, ollama.

  --backend <provider|codex>    force a backend (also DEBAIT_PROVIDER / DEBAIT_BACKEND=codex)
  <PROVIDER>_API_KEY            key per provider, e.g. OPENAI_API_KEY, ANTHROPIC_API_KEY,
                                GEMINI_API_KEY, GROQ_API_KEY ...
  DEBAIT_MODEL=<model>          override model
  DEBAIT_BASE_URL=<url>         override API base URL (e.g. a gateway / local server)
  --lang <language>             output language for title/summary (also DEBAIT_LANG);
                                e.g. --lang English | --lang "\u7e41\u9ad4\u4e2d\u6587" | default: auto (match article)
  --instructions <text>         extra instructions appended to the prompt (also
                                DEBAIT_INSTRUCTIONS); the JSON output shape is kept

  --models [provider]           list model IDs available to your key, then exit
                                (e.g. debait --models openai)
`;

function color(s, c) {
  if (!process.stdout.isTTY) return s;
  const codes = { red: 31, green: 32, yellow: 33, cyan: 36, dim: 2, bold: 1 };
  return `\x1b[${codes[c]}m${s}\x1b[0m`;
}

function scoreColor(n) {
  if (n >= 60) return "red";
  if (n >= 30) return "yellow";
  return "green";
}

function renderHuman(a, r) {
  if (r.parse_error) {
    console.log(color("Could not parse model output:\n", "red") + r.raw);
    return;
  }
  const bar = (n) => {
    const filled = Math.round((n / 100) * 20);
    return "█".repeat(filled) + "░".repeat(20 - filled);
  };
  const out = [];
  out.push(color("┈".repeat(60), "dim"));
  out.push(color("ORIGINAL:  ", "dim") + (a.originalTitle || "(none)"));
  out.push(color("HONEST:    ", "cyan") + color(r.honest_title || "", "bold"));
  out.push("");
  out.push(color("Clickbait  ", "dim") + color(`${bar(r.clickbait_score ?? 0)} ${r.clickbait_score ?? "?"}/100`, scoreColor(r.clickbait_score ?? 0)));
  out.push(color("Substance  ", "dim") + (r.substance_verdict || "?") + color(`   worth clicking: ${r.worth_clicking}`, "dim"));
  out.push("");
  out.push(color("Summary:", "dim"));
  out.push("  " + (r.summary || ""));
  if (Array.isArray(r.key_points) && r.key_points.length) {
    out.push("");
    out.push(color("Key points:", "dim"));
    for (const p of r.key_points) out.push("  • " + p);
  }
  if (Array.isArray(r.clickbait_signals) && r.clickbait_signals.length) {
    out.push("");
    out.push(color("Bait signals:", "dim"));
    for (const s of r.clickbait_signals) out.push("  ⚑ " + s);
  }
  out.push(color("┈".repeat(60), "dim"));
  console.log(out.join("\n"));
}

async function main() {
  const { _, flags } = parseArgs(process.argv.slice(2));

  if (flags.models) {
    const provider = flags.backend || _[0] || chooseBackend();
    try {
      const models = await listModels(provider);
      console.error(color(`Models available to your key for "${provider}":`, "dim"));
      console.log(models.join("\n"));
    } catch (e) {
      console.error(color(`Could not list models: ${e.message}`, "red"));
      process.exit(2);
    }
    return;
  }

  if (flags.help || (!_.length && !flags.stdin)) {
    console.log(HELP);
    process.exit(flags.help ? 0 : 1);
  }

  const backend = flags.backend || chooseBackend();
  let article;
  try {
    if (flags.stdin) {
      const html = await readStdin();
      article = extractArticle(html, flags.url || "");
    } else {
      article = await loadArticle(_[0]);
    }
  } catch (e) {
    console.error(color(`Failed to load article: ${e.message}`, "red"));
    process.exit(2);
  }

  if (!flags.json) {
    process.stderr.write(color(`Reading with backend "${backend}"...\n`, "dim"));
  }

  let result;
  try {
    result = await debait(article, { backend, language: flags.lang || process.env.DEBAIT_LANG, instructions: flags.instructions || process.env.DEBAIT_INSTRUCTIONS });
  } catch (e) {
    console.error(color(`Model call failed: ${e.message}`, "red"));
    process.exit(3);
  }

  if (flags.json) {
    console.log(JSON.stringify({ input: { url: article.url, originalTitle: article.originalTitle }, result }, null, 2));
  } else {
    renderHuman(article, result);
  }
}

main();
