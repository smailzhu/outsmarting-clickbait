// Service worker: holds settings, performs the CORS-free multi-provider LLM
// call, and wires up the context menu. Content scripts can't call arbitrary
// APIs (page CORS), so they delegate here.
//
// providers.js is synced from ../shared/providers.js via `npm run sync`.

import { resolveProvider, callProvider, PROVIDERS } from "./providers.js";

const DEFAULTS = { provider: "openai", base: "", model: "", key: "" };

async function settings() {
  const s = await chrome.storage.sync.get(DEFAULTS);
  return { ...DEFAULTS, ...s };
}

async function complete(prompt) {
  const s = await settings();
  if (!PROVIDERS[s.provider]) throw new Error(`Unknown provider "${s.provider}".`);
  const cfg = resolveProvider({ provider: s.provider, base: s.base, model: s.model, key: s.key });
  if (!cfg.key) throw new Error(`No API key set for "${s.provider}". Open Options and paste your key.`);
  // browser:true adds Anthropic's direct-browser-access header when needed.
  return callProvider(cfg, prompt, { browser: true });
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === "debait:complete") {
    complete(msg.prompt)
      .then((text) => sendResponse({ ok: true, text }))
      .catch((e) => sendResponse({ ok: false, error: e.message }));
    return true; // async
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
