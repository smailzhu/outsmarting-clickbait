// Service worker: settings, CORS-free multi-provider LLM calls, context menu,
// and link PREVIEW (debait a page before you open it).
//
// providers.js / prompt.esm.js / extract.js are synced from ../shared via
// `npm run sync`.

import { resolveProvider, callProvider, PROVIDERS } from "./providers.js";
import { buildPrompt, parseResult } from "./prompt.esm.js";
import { extractArticle } from "./extract.js";

const DEFAULTS = { provider: "openai", base: "", model: "", key: "", language: "" };

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

// Rate limiting so bursty hovering can't exceed provider quota (esp. free
// tiers). One LLM preview at a time, min spacing between them, and a cooldown
// after a 429 (respecting the provider's retry delay when present).
const PREVIEW_MIN_INTERVAL = 1500; // ms between preview LLM calls
let previewBusy = false;
let lastPreviewAt = 0;
let cooldownUntil = 0;

function backoffMsFrom(message) {
  const m = /ret[-_ ]?(?:delay|after)"?\s*[:=]\s*"?(\d+)\s*s?/i.exec(String(message || ""));
  const secs = m ? Number(m[1]) : 0;
  return Math.min(Math.max(secs * 1000 || 30000, 5000), 5 * 60 * 1000); // 5s..5min
}

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
  const s = await settings();
  // Cache per URL *and* settings: changing provider/model/language/base must
  // not return a stale result for the same link.
  const cacheKey = [url, s.provider, s.model, s.base, s.language].join("\n");

  const hit = CACHE.get(cacheKey);
  if (hit && Date.now() - hit.at < CACHE_TTL) return hit.result;
  if (inflight.has(cacheKey)) return inflight.get(cacheKey);

  // In a provider cooldown (after a 429): don't spend another call.
  const nowOuter = Date.now();
  if (nowOuter < cooldownUntil) {
    return { rate_limited: true, retryIn: Math.ceil((cooldownUntil - nowOuter) / 1000), url };
  }

  const p = (async () => {
    const article = await fetchAndExtract(url);
    if (!article.text || article.text.length < 200) {
      // Too little to judge from the body — likely JS-rendered/paywalled.
      return { thin_fetch: true, originalTitle: article.originalTitle, description: article.description, url };
    }
    // Throttle the actual LLM call: skip (don't queue) rapid bursts so sweeping
    // across a feed can't fire dozens of calls. The user can re-hover to retry.
    const now = Date.now();
    if (previewBusy || now - lastPreviewAt < PREVIEW_MIN_INTERVAL) {
      return { throttled: true, originalTitle: article.originalTitle, url };
    }
    previewBusy = true;
    lastPreviewAt = now;
    try {
      const result = parseResult(await complete(buildPrompt(article, { language: s.language })));
      return { ...result, originalTitle: article.originalTitle, url };
    } catch (e) {
      if (/\b429\b|quota|rate|RESOURCE_EXHAUSTED/i.test(String(e && e.message))) {
        cooldownUntil = Date.now() + backoffMsFrom(e.message);
      }
      throw e;
    } finally {
      previewBusy = false;
    }
  })();

  inflight.set(cacheKey, p);
  try {
    const result = await p;
    // Only cache real answers — not transient throttle/cooldown markers.
    if (!result.throttled && !result.rate_limited) CACHE.set(cacheKey, { at: Date.now(), result });
    return result;
  } finally {
    inflight.delete(cacheKey);
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
    // Tab may lack a content script (chrome:// pages, etc.) - ignore failure.
    chrome.tabs.sendMessage(tab.id, { type: "debait:run" }).catch(() => {});
  }
});
