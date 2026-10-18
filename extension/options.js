// Stores provider + base + model + a per-provider key map so switching
// providers keeps each key. The active `key` mirrors the current provider's key
// for the background worker.
const DEFAULTS = {
  provider: "openai", base: "", model: "", key: "", keys: {}, language: "",
  previewDwellMs: 500, previewMinIntervalMs: 1500, dailyCap: 200, customInstructions: "", uiLang: "",
};
const intOr = (v, d) => { if (v === "" || v == null) return d; const n = Math.round(Number(v)); return Number.isFinite(n) && n >= 0 ? n : d; };

async function renderUsage(cap) {
  const today = new Date().toISOString().slice(0, 10);
  const { debaitUsage } = await chrome.storage.local.get({ debaitUsage: { day: "", count: 0 } });
  const used = debaitUsage.day === today ? debaitUsage.count : 0;
  $("usage").textContent = `${t("usagePrefix")} ${used}` + (cap > 0 ? ` / ${cap}` : ` ${t("usageNoCap")}`);
}
const $ = (id) => document.getElementById(id);
const t = (k, subs) => globalThis.DebaitI18n.t(k, subs);
function applyI18n() {
  globalThis.DebaitI18n.apply();
  document.documentElement.lang = globalThis.DebaitI18n.lang === "zh_TW" ? "zh-TW" : "en";
  renderConnectionStatus();
}

const CONNECTION_MESSAGES = {
  success: "connectionSuccess", missing_key: "connectionMissingKey", settings: "connectionSettings",
  auth: "connectionAuth", access: "connectionAccess", quota: "connectionQuota",
  model: "connectionModel", http: "connectionHttp", response: "connectionResponse",
  empty: "connectionEmpty", budget: "connectionBudget", timeout: "connectionTimeout", network: "connectionNetwork",
  busy: "connectionBusy", denied: "connectionDenied", testing: "connectionTesting",
};
let connectionResult = null;
let testingConnection = false;
const connectionValues = () => Object.fromEntries(
  ["provider", "key", "base", "model"].map((id) => [id, $(id).value.trim()])
);
function renderConnectionStatus() {
  const el = $("connectionStatus");
  el.textContent = connectionResult ? t(CONNECTION_MESSAGES[connectionResult.code] || "connectionNetwork",
    [String(connectionResult.status || "")]) : "";
  el.dataset.state = connectionResult?.ok ? "success" : connectionResult?.code === "testing" ? "pending" : "error";
}
for (const id of ["provider", "key", "base", "model"]) {
  $(id).addEventListener("input", () => { connectionResult = null; renderConnectionStatus(); });
}
$("testConnection").addEventListener("click", async () => {
  if (testingConnection) return;
  const values = connectionValues();
  testingConnection = true;
  $("testConnection").disabled = true;
  connectionResult = { ok: false, code: "testing" };
  renderConnectionStatus();
  try {
    const result = await chrome.runtime.sendMessage({ type: "debait:testConnection", settings: values });
    // A success for old credentials must not be shown for newly edited fields.
    if (JSON.stringify(values) === JSON.stringify(connectionValues())) {
      connectionResult = result?.code && CONNECTION_MESSAGES[result.code] ? result : { ok: false, code: "network" };
    }
  } catch {
    if (JSON.stringify(values) === JSON.stringify(connectionValues())) connectionResult = { ok: false, code: "network" };
  } finally {
    testingConnection = false;
    $("testConnection").disabled = false;
    renderConnectionStatus();
  }
});

let state = { ...DEFAULTS };

async function load() {
  state = { ...DEFAULTS, ...(await chrome.storage.sync.get(DEFAULTS)) };
  await globalThis.DebaitI18n.init();
  applyI18n();
  $("uiLang").value = state.uiLang || "";
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
  $("testConnection").disabled = false;
}

$("provider").addEventListener("change", () => {
  // Save current field into the key map, then show the newly selected provider's key.
  state.keys[state.provider] = $("key").value.trim();
  state.provider = $("provider").value;
  $("key").value = state.keys[state.provider] || "";
  connectionResult = null;
  renderConnectionStatus();
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
    uiLang: $("uiLang").value,
    previewDwellMs: intOr($("previewDwellMs").value, 500),
    previewMinIntervalMs: intOr($("previewMinIntervalMs").value, 1500),
    dailyCap: intOr($("dailyCap").value, 200),
  });
  await globalThis.DebaitI18n.init();
  applyI18n();
  await renderUsage(intOr($("dailyCap").value, 200));
  $("status").textContent = t("optSaved");
  setTimeout(() => ($("status").textContent = ""), 1500);
});

// Contact link assembled at runtime so the full plaintext address never appears
// in the page source (deters email-harvesting bots that don't execute JS).
(() => {
  const el = document.getElementById("reportLink");
  if (!el) return;
  const at = String.fromCharCode(64), dot = String.fromCharCode(46);
  const addr = ["cusp", "preacher", "blot"].join("-") + at + "duck" + dot + "com";
  el.textContent = addr;
  el.href = "mailto:" + addr + "?subject=" + encodeURIComponent("debait issue report");
})();

load();
