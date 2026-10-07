// Service worker: settings, CORS-free multi-provider LLM calls, context menu,
// and link PREVIEW (debait a page before you open it).
//
// providers.js / prompt.esm.js / extract.js are synced from ../shared via
// `npm run sync`.

import { resolveProvider, callProvider, PROVIDERS } from "./providers.js";
import { buildPrompt, parseResult } from "./prompt.esm.js";
import { extractArticle } from "./extract.js";

const DEFAULTS = {
  provider: "openai", base: "", model: "", key: "", language: "",
  // Preview rate controls (see Options). 0 = unlimited.
  previewMinIntervalMs: 1500,
  dailyCap: 200,
  customInstructions: "",
};

async function settings() {
  const s = await chrome.storage.sync.get(DEFAULTS);
  return { ...DEFAULTS, ...s };
}

async function complete(prompt) {
  const s = await settings();
  if (!PROVIDERS[s.provider]) throw new Error(chrome.i18n.getMessage("errUnknownProvider", [s.provider]));
  const cfg = resolveProvider({ provider: s.provider, base: s.base, model: s.model, key: s.key });
  if (!cfg.key && s.provider !== "ollama") throw new Error(chrome.i18n.getMessage("errNoKey", [s.provider]));
  return callProvider(cfg, prompt, { browser: true });
}

// ---- preview: fetch a target URL, extract, debait, cache ------------------
const CACHE = new Map(); // url -> { at, result }
const CACHE_TTL = 30 * 60 * 1000; // 30 min
const inflight = new Map(); // url -> Promise

// Rate limiting so bursty hovering can't exceed provider quota (esp. free
// tiers): one LLM preview at a time, a min spacing between them, a per-day cap,
// and a cooldown after a 429 (respecting the provider's retry delay).
let previewBusy = false;
let lastPreviewAt = 0;
let cooldownUntil = 0;

function backoffMsFrom(message) {
  const m = /ret[-_ ]?(?:delay|after)"?\s*[:=]\s*"?(\d+)\s*s?/i.exec(String(message || ""));
  const secs = m ? Number(m[1]) : 0;
  return Math.min(Math.max(secs * 1000 || 30000, 5000), 5 * 60 * 1000); // 5s..5min
}

const todayKey = () => new Date().toISOString().slice(0, 10); // UTC YYYY-MM-DD

// Per-day LLM call counter, persisted in storage.local (survives SW restarts).
async function getUsage() {
  const { debaitUsage } = await chrome.storage.local.get({ debaitUsage: { day: "", count: 0 } });
  if (debaitUsage.day !== todayKey()) return { day: todayKey(), count: 0 };
  return debaitUsage;
}
async function bumpUsage() {
  const u = await getUsage();
  const next = { day: u.day, count: u.count + 1 };
  await chrome.storage.local.set({ debaitUsage: next });
  return next;
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
  const cacheKey = [url, s.provider, s.model, s.base, s.language, s.customInstructions].join("\n");

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
    // Per-day cap: a hard stop so the tool can never silently burn through a
    // paid quota / daily free-tier allowance.
    if (s.dailyCap > 0) {
      const u = await getUsage();
      if (u.count >= s.dailyCap) {
        return { capped: true, used: u.count, cap: s.dailyCap, originalTitle: article.originalTitle, url };
      }
    }
    // Throttle the actual LLM call: skip (don't queue) rapid bursts so sweeping
    // across a feed can't fire dozens of calls. The user can re-hover to retry.
    const now = Date.now();
    if (previewBusy || now - lastPreviewAt < (s.previewMinIntervalMs || 0)) {
      return { throttled: true, originalTitle: article.originalTitle, url };
    }
    previewBusy = true;
    lastPreviewAt = now;
    try {
      // Count only if we will actually call the provider (missing key fails before any network call).
      if (s.key || s.provider === "ollama") await bumpUsage();
      const result = parseResult(await complete(buildPrompt(article, { language: s.language, customInstructions: s.customInstructions })));
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
    // Only cache real answers — not transient throttle/cooldown/cap markers.
    if (!result.throttled && !result.rate_limited && !result.capped) CACHE.set(cacheKey, { at: Date.now(), result });
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

chrome.runtime.onInstalled.addListener((details) => {
  chrome.contextMenus.create({ id: "debait-run", title: chrome.i18n.getMessage("ctxDebaitPage"), contexts: ["page", "selection"] });
  // First install only: open Options so the user can set a provider + API key
  // (the extension can't do anything until a key is configured). Not on updates.
  if (details.reason === "install") {
    chrome.runtime.openOptionsPage?.();
  }
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === "debait-run" && tab?.id) {
    // Tab may lack a content script (chrome:// pages, etc.) - ignore failure.
    chrome.tabs.sendMessage(tab.id, { type: "debait:run" }).catch(() => {});
  }
});
