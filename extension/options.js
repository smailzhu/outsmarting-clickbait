// Stores provider + base + model + a per-provider key map so switching
// providers keeps each key. The active `key` mirrors the current provider's key
// for the background worker.
const DEFAULTS = {
  provider: "openai", base: "", model: "", key: "", keys: {}, language: "",
  previewDwellMs: 500, previewMinIntervalMs: 1500, dailyCap: 200, customInstructions: "",
};
const intOr = (v, d) => { if (v === "" || v == null) return d; const n = Math.round(Number(v)); return Number.isFinite(n) && n >= 0 ? n : d; };

async function renderUsage(cap) {
  const today = new Date().toISOString().slice(0, 10);
  const { debaitUsage } = await chrome.storage.local.get({ debaitUsage: { day: "", count: 0 } });
  const used = debaitUsage.day === today ? debaitUsage.count : 0;
  $("usage").textContent = `${t("usagePrefix")} ${used}` + (cap > 0 ? ` / ${cap}` : ` ${t("usageNoCap")}`);
}
const $ = (id) => document.getElementById(id);

// Apply localized UI strings (data-i18n = textContent).
for (const el of document.querySelectorAll("[data-i18n]")) {
  const m = chrome.i18n.getMessage(el.dataset.i18n);
  if (m) el.textContent = m;
}
for (const el of document.querySelectorAll("[data-i18n-ph]")) {
  const m = chrome.i18n.getMessage(el.dataset.i18nPh);
  if (m) el.placeholder = m;
}
document.documentElement.lang = (chrome.i18n.getUILanguage && chrome.i18n.getUILanguage()) || "en";
const t = (k) => chrome.i18n.getMessage(k) || k;

let state = { ...DEFAULTS };

async function load() {
  state = { ...DEFAULTS, ...(await chrome.storage.sync.get(DEFAULTS)) };
  $("provider").value = state.provider;
  $("base").value = state.base || "";
  $("model").value = state.model || "";
  $("language").value = state.language || "";
  $("customInstructions").value = state.customInstructions || "";
  $("previewDwellMs").value = state.previewDwellMs;
  $("previewMinIntervalMs").value = state.previewMinIntervalMs;
  $("dailyCap").value = state.dailyCap;
  $("key").value = state.keys?.[state.provider] || state.key || "";
  await renderUsage(state.dailyCap);
}

$("provider").addEventListener("change", () => {
  // Save current field into the key map, then show the newly selected provider's key.
  state.keys[state.provider] = $("key").value.trim();
  state.provider = $("provider").value;
  $("key").value = state.keys[state.provider] || "";
});

$("save").addEventListener("click", async () => {
  const provider = $("provider").value;
  const key = $("key").value.trim();
  state.keys[provider] = key;
  await chrome.storage.sync.set({
    provider,
    key, // active provider's key, used by background.js
    keys: state.keys,
    base: $("base").value.trim(),
    model: $("model").value.trim(),
    language: $("language").value.trim(),
    customInstructions: $("customInstructions").value.trim(),
    previewDwellMs: intOr($("previewDwellMs").value, 500),
    previewMinIntervalMs: intOr($("previewMinIntervalMs").value, 1500),
    dailyCap: intOr($("dailyCap").value, 200),
  });
  await renderUsage(intOr($("dailyCap").value, 200));
  $("status").textContent = t("optSaved");
  setTimeout(() => ($("status").textContent = ""), 1500);
});

load();
