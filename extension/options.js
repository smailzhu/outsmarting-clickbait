// Per-provider profiles own key/base/model, including intentional empty fields.
// Active mirrors and the legacy key map remain compatible with older consumers.
const DEFAULTS = {
  provider: "openai", base: "", model: "", key: "", keys: {}, profiles: {}, language: "",
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
  renderProviderHints();
}
function renderProviderHints() {
  const custom = $("provider").value === "custom";
  for (const id of ["baseHint", "modelHint"]) {
    if ($(id)) $(id).textContent = t(custom ? "customRequiredHint" : "optOverrideHint");
  }
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
let settingsReady = false;
const SETTINGS_CONTROLS = ["uiLang", "provider", "key", "base", "model", "language", "customInstructions",
  "previewDwellMs", "previewMinIntervalMs", "dailyCap", "save", "testConnection"];
function setSettingsReady(ready) {
  settingsReady = ready;
  for (const id of SETTINGS_CONTROLS) $(id).disabled = !ready;
  $("testConnection").disabled = !ready || testingConnection;
}
setSettingsReady(false);
let connectionGeneration = 0;
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
  $(id).addEventListener("input", () => { connectionGeneration++; connectionResult = null; renderConnectionStatus(); });
}
$("testConnection").addEventListener("click", async () => {
  if (!settingsReady || testingConnection) return;
  const values = connectionValues();
  const generation = connectionGeneration;
  testingConnection = true;
  $("testConnection").disabled = true;
  connectionResult = { ok: false, code: "testing" };
  renderConnectionStatus();
  try {
    const result = await chrome.runtime.sendMessage({ type: "debait:testConnection", settings: values });
    // A success for old credentials must not be shown for newly edited fields.
    if (generation === connectionGeneration && JSON.stringify(values) === JSON.stringify(connectionValues())) {
      connectionResult = result?.code && CONNECTION_MESSAGES[result.code] ? result : { ok: false, code: "network" };
    }
  } catch {
    if (generation === connectionGeneration && JSON.stringify(values) === JSON.stringify(connectionValues())) connectionResult = { ok: false, code: "network" };
  } finally {
    testingConnection = false;
    $("testConnection").disabled = !settingsReady;
    renderConnectionStatus();
  }
});

let state = { ...DEFAULTS };

async function load() {
  const stored = { ...DEFAULTS, ...(await chrome.storage.sync.get(DEFAULTS)) };
  state = globalThis.DebaitProfiles.migrate(stored, ["openai", "anthropic", "gemini", "groq", "openrouter", "deepseek", "xai", "mistral", "together", "nvidia", "ollama", "custom"]);
  if (JSON.stringify(stored) !== JSON.stringify(state)) await chrome.storage.sync.set({
    profiles: state.profiles, key: state.key, base: state.base, model: state.model,
  });
  await globalThis.DebaitI18n.init();
  applyI18n();
  $("uiLang").value = state.uiLang || "";
  $("provider").value = state.provider;
  renderProviderHints();
  $("base").value = state.base || "";
  $("model").value = state.model || "";
  $("language").value = state.language || "";
  $("customInstructions").value = state.customInstructions || "";
  $("previewDwellMs").value = state.previewDwellMs;
  $("previewMinIntervalMs").value = state.previewMinIntervalMs;
  $("dailyCap").value = state.dailyCap;
  $("key").value = state.profiles[state.provider].key;
  await renderUsage(state.dailyCap);
  setSettingsReady(true);
}

$("provider").addEventListener("change", () => {
  if (!settingsReady) {
    $("provider").value = state.provider;
    return;
  }
  // Keep outgoing unsaved fields page-local; switching itself never writes.
  connectionGeneration++;
  state.profiles[state.provider] = Object.fromEntries(["key", "base", "model"].map((id) => [id, $(id).value.trim()]));
  state.provider = $("provider").value;
  renderProviderHints();
  for (const id of ["key", "base", "model"]) $(id).value = state.profiles[state.provider][id];
  connectionResult = null;
  renderConnectionStatus();
});

$("save").addEventListener("click", async () => {
  if (!settingsReady) return;
  const provider = $("provider").value;
  const key = $("key").value.trim();
  state.keys[provider] = key;
  state.profiles[provider] = { key, base: $("base").value.trim(), model: $("model").value.trim() };
  await chrome.storage.sync.set({
    provider,
    key, // active provider's key, used by background.js
    keys: state.keys,
    profiles: state.profiles,
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

load().catch(() => {
  setSettingsReady(false);
  $("status").textContent = t("optLoadFailed");
});
