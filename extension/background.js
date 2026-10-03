// Service worker: settings, CORS-free multi-provider LLM calls, context menu,
// and link PREVIEW (debait a page before you open it).
//
// providers.js / prompt.esm.js / extract.js are synced from ../shared via
// `npm run sync`.

import { resolveProvider, callProvider, PROVIDERS } from "./providers.js";
import { buildPrompt, parseResult } from "./prompt.esm.js";
import { extractArticle } from "./extract.js";

const DEFAULTS = { provider: "openai", base: "", model: "", key: "" };

async function settings() {
  const s = await chrome.storage.sync.get(DEFAULTS);
  return { ...DEFAULTS, ...s };
}

async function complete(prompt) {
  const s = await settings();
  if (!PROVIDERS[s.provider]) throw new Error(`Unknown provider "${s.provider}".`);
  const cfg = resolveProvider({ provider: s.provider, base: s.base, model: s.model, key: s.key });
  if (!cfg.key && s.provider !== "ollama") throw new Error(`No API key set for "${s.provider}". Open Options and paste your key.`);
  return callProvider(cfg, prompt, { browser: true });
}

// ---- preview: fetch a target URL, extract, debait, cache ------------------
const CACHE = new Map(); // url -> { at, result }
const CACHE_TTL = 30 * 60 * 1000; // 30 min
const inflight = new Map(); // url -> Promise

async function fetchAndExtract(url) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 15000);
  try {
    const res = await fetch(url, { redirect: "follow", signal: ctrl.signal, credentials: "omit" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const ct = res.headers.get("content-type") || "";
    if (!/text\/html|application\/xhtml/i.test(ct) && ct) throw new Error(`not HTML (${ct.split(";")[0]})`);
    return extractArticle(await res.text(), url);
  } finally {
    clearTimeout(t);
  }
}

async function preview(url) {
  const hit = CACHE.get(url);
  if (hit && Date.now() - hit.at < CACHE_TTL) return hit.result;
  if (inflight.has(url)) return inflight.get(url);

  const p = (async () => {
    const article = await fetchAndExtract(url);
    if (!article.text || article.text.length < 200) {
      // Too little to judge from the body — likely JS-rendered/paywalled.
      return { thin_fetch: true, originalTitle: article.originalTitle, description: article.description, url };
    }
    const result = parseResult(await complete(buildPrompt(article)));
    return { ...result, originalTitle: article.originalTitle, url };
  })();

  inflight.set(url, p);
  try {
    const result = await p;
    CACHE.set(url, { at: Date.now(), result });
    return result;
  } finally {
    inflight.delete(url);
  }
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === "debait:complete") {
    complete(msg.prompt).then((text) => sendResponse({ ok: true, text })).catch((e) => sendResponse({ ok: false, error: e.message }));
    return true;
  }
  if (msg?.type === "debait:preview") {
    preview(msg.url).then((result) => sendResponse({ ok: true, result })).catch((e) => sendResponse({ ok: false, error: e.message }));
    return true;
  }
});

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({ id: "debait-run", title: "debait this page", contexts: ["page", "selection"] });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === "debait-run" && tab?.id) {
    chrome.tabs.sendMessage(tab.id, { type: "debait:run" });
  }
});
