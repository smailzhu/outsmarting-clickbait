// Per-provider profiles own key/base/model, including intentional empty fields.
// Active mirrors and the legacy key map remain compatible with older consumers.
const DEFAULTS = {
  provider: "openai", base: "", model: "", key: "", keys: {}, profiles: {}, language: "",
  previewDwellMs: 500, previewMinIntervalMs: 1500, dailyCap: 200, customInstructions: "", uiLang: "",
};
const intOr = (v, d) => { if (v === "" || v == null) return d; const n = Math.round(Number(v)); return Number.isFinite(n) && n >= 0 ? n : d; };
const $ = (id) => document.getElementById(id);
const t = (k, subs) => globalThis.DebaitI18n.t(k, subs);
const clone = (value) => structuredClone(value);
function frozenCopy(value) {
  const copy = clone(value);
  function freeze(object) {
    for (const child of Object.values(object)) if (child && typeof child === "object") freeze(child);
    return Object.freeze(object);
  }
  return freeze(copy);
}
const trimmed = (value) => typeof value === "string" ? value.trim() : "";
const normalizeProfile = (profile) => Object.fromEntries(["key", "base", "model"].map((id) => [id, trimmed(profile?.[id])]));

let draftProfiles = {};
let draftProvider = DEFAULTS.provider;
let baseline = null;
let committed = null;
let settingsReady = false;
let saving = false;
let testingConnection = false;
let loadFailed = false;
let dirty = false;
let saveFailed = false;
let savedRefreshWarning = false;
let savedFlash = false;
let flashTimer = null;
let flashToken = 0;
let unloadAttached = false;
let connectionResult = null;
let testedTuple = null;
let connectionGeneration = 0;
const SETTINGS_CONTROLS = ["uiLang", "provider", "key", "base", "model", "language", "customInstructions",
  "previewDwellMs", "previewMinIntervalMs", "dailyCap", "save", "testConnection"];

// The editable projection is shared by load, comparison and Save. Mirrors never
// participate; sorted profile ids make insertion order irrelevant to comparison.
function buildDraft() {
  const profiles = Object.fromEntries(Object.keys(draftProfiles).sort().map((id) => [id, normalizeProfile(draftProfiles[id])]));
  profiles[draftProvider] = normalizeProfile(Object.fromEntries(["key", "base", "model"].map((id) => [id, $(id).value])));
  return {
    provider: $("provider").value, uiLang: $("uiLang").value,
    language: $("language").value.trim(), customInstructions: $("customInstructions").value.trim(),
    previewDwellMs: intOr($("previewDwellMs").value, 500),
    previewMinIntervalMs: intOr($("previewMinIntervalMs").value, 1500),
    dailyCap: intOr($("dailyCap").value, 200), profiles,
  };
}
function canonical(snapshot) {
  return JSON.stringify({
    provider: snapshot.provider, uiLang: snapshot.uiLang, language: snapshot.language, customInstructions: snapshot.customInstructions,
    previewDwellMs: snapshot.previewDwellMs, previewMinIntervalMs: snapshot.previewMinIntervalMs, dailyCap: snapshot.dailyCap,
    profiles: Object.fromEntries(Object.keys(snapshot.profiles).sort().map((id) => [id, normalizeProfile(snapshot.profiles[id])])),
  });
}
function renderControls() {
  for (const id of SETTINGS_CONTROLS) $(id).disabled = !settingsReady || saving || (id === "testConnection" && testingConnection);
  setText($("save"), t(saving ? "optSaving" : "optSave"));
}
function setSettingsReady(ready) {
  settingsReady = ready;
  renderControls();
}
function setText(el, text) {
  if (el.textContent !== text) el.textContent = text;
}
function renderSaveStatus() {
  const key = loadFailed ? "optLoadFailed" : saving ? "optSaving" : saveFailed ? "optSaveFailed" : dirty ? "optUnsaved"
    : savedRefreshWarning ? "optSavedRefreshWarning" : savedFlash ? "optSaved" : null;
  setText($("status"), key ? t(key) : "");
  $("status").dataset.state = loadFailed || saveFailed || (!saving && !dirty && savedRefreshWarning) ? "error"
    : key === "optSaved" ? "success" : "neutral";
}
function warnBeforeUnload(event) {
  event.preventDefault();
  event.returnValue = "";
}
function recomputeDirty() {
  if (!settingsReady) return;
  dirty = canonical(buildDraft()) !== canonical(baseline);
  const desired = settingsReady && dirty;
  if (desired !== unloadAttached) {
    window[desired ? "addEventListener" : "removeEventListener"]("beforeunload", warnBeforeUnload);
    unloadAttached = desired;
  }
  renderSaveStatus();
}
function invalidateSavedFlash() {
  flashToken++;
  if (flashTimer !== null) clearTimeout(flashTimer);
  flashTimer = null;
  savedFlash = false;
}
function startSavedFlashTimer() {
  const token = flashToken;
  flashTimer = setTimeout(() => {
    if (token !== flashToken) return;
    flashTimer = null;
    savedFlash = false;
    renderSaveStatus();
  }, 1500);
}

async function renderUsage(cap) {
  const today = new Date().toISOString().slice(0, 10);
  const { debaitUsage } = await chrome.storage.local.get({ debaitUsage: { day: "", count: 0 } });
  const used = debaitUsage.day === today ? debaitUsage.count : 0;
  $("usage").textContent = `${t("usagePrefix")} ${used}` + (cap > 0 ? ` / ${cap}` : ` ${t("usageNoCap")}`);
}
function applyI18n() {
  globalThis.DebaitI18n.apply();
  document.documentElement.lang = globalThis.DebaitI18n.lang === "zh_TW" ? "zh-TW" : "en";
  renderProviderHints();
  renderControls();
  renderSaveStatus();
  renderConnectionStatus();
}
function renderProviderHints() {
  const custom = $("provider").value === "custom";
  for (const id of ["baseHint", "modelHint"]) {
    if ($(id)) setText($(id), t(custom ? "customRequiredHint" : "optOverrideHint"));
  }
}
const CONNECTION_MESSAGES = {
  success: "connectionSuccess", missing_key: "connectionMissingKey", settings: "connectionSettings",
  auth: "connectionAuth", access: "connectionAccess", quota: "connectionQuota",
  model: "connectionModel", http: "connectionHttp", response: "connectionResponse",
  empty: "connectionEmpty", budget: "connectionBudget", timeout: "connectionTimeout", network: "connectionNetwork",
  busy: "connectionBusy", denied: "connectionDenied", testing: "connectionTesting",
};
const connectionValues = () => Object.fromEntries(
  ["provider", "key", "base", "model"].map((id) => [id, $(id).value.trim()])
);
function renderConnectionStatus() {
  const el = $("connectionStatus");
  let text = connectionResult ? t(CONNECTION_MESSAGES[connectionResult.code] || "connectionNetwork", [String(connectionResult.status || "")]) : "";
  const activeTuple = baseline && { provider: baseline.provider, ...normalizeProfile(baseline.profiles[baseline.provider]) };
  if (testedTuple && JSON.stringify(testedTuple) !== JSON.stringify(activeTuple)) text += " " + t("connectionSaveReminder");
  setText(el, text);
  el.dataset.state = connectionResult?.ok ? "success" : connectionResult?.code === "testing" ? "pending" : "error";
}
function clearConnectionResult() {
  connectionGeneration++;
  connectionResult = null;
  testedTuple = null;
  renderConnectionStatus();
}
setSettingsReady(false);
for (const id of SETTINGS_CONTROLS.filter((id) => !["provider", "save", "testConnection"].includes(id))) {
  for (const type of ["input", "change"]) $(id).addEventListener(type, () => {
    if (!settingsReady || saving) return;
    invalidateSavedFlash();
    if (["key", "base", "model"].includes(id)) clearConnectionResult();
    recomputeDirty();
  });
}
$("provider").addEventListener("input", () => {
  if (!settingsReady || saving) { $("provider").value = draftProvider; return; }
  // A select fires input before change, while outgoing fields are still visible.
  invalidateSavedFlash();
  renderSaveStatus();
  clearConnectionResult();
});
$("provider").addEventListener("change", () => {
  if (!settingsReady || saving) { $("provider").value = draftProvider; return; }
  invalidateSavedFlash();
  draftProfiles = { ...draftProfiles, [draftProvider]: normalizeProfile(Object.fromEntries(["key", "base", "model"].map((id) => [id, $(id).value]))) };
  draftProvider = $("provider").value;
  for (const id of ["key", "base", "model"]) $(id).value = draftProfiles[draftProvider][id];
  renderProviderHints();
  clearConnectionResult();
  recomputeDirty();
});
$("testConnection").addEventListener("click", async () => {
  if (!settingsReady || saving || testingConnection) return;
  const values = connectionValues();
  const generation = connectionGeneration;
  testingConnection = true;
  connectionResult = { ok: false, code: "testing" };
  testedTuple = null;
  renderControls();
  renderConnectionStatus();
  try {
    const result = await chrome.runtime.sendMessage({ type: "debait:testConnection", settings: values });
    // Both generation and value equality are required, even after edit-and-revert.
    if (generation === connectionGeneration && JSON.stringify(values) === JSON.stringify(connectionValues())) {
      connectionResult = result?.code && CONNECTION_MESSAGES[result.code] ? result : { ok: false, code: "network" };
      testedTuple = connectionResult.ok && connectionResult.code === "success" ? clone(values) : null;
    }
  } catch {
    if (generation === connectionGeneration && JSON.stringify(values) === JSON.stringify(connectionValues())) {
      connectionResult = { ok: false, code: "network" };
      testedTuple = null;
    }
  } finally {
    testingConnection = false;
    renderControls();
    renderConnectionStatus();
  }
});

async function load() {
  const stored = { ...DEFAULTS, ...(await chrome.storage.sync.get(DEFAULTS)) };
  const state = globalThis.DebaitProfiles.migrate(stored, ["openai", "anthropic", "gemini", "groq", "openrouter", "deepseek", "xai", "mistral", "together", "nvidia", "ollama", "custom"]);
  draftProvider = state.provider;
  draftProfiles = clone(state.profiles);
  if (JSON.stringify(stored) !== JSON.stringify(state)) await chrome.storage.sync.set({
    profiles: state.profiles, key: state.key, base: state.base, model: state.model,
  });
  await globalThis.DebaitI18n.init();
  applyI18n();
  $("uiLang").value = state.uiLang || "";
  $("provider").value = state.provider;
  renderProviderHints();
  for (const id of ["key", "base", "model", "language", "customInstructions"]) $(id).value = state[id] || "";
  for (const id of ["previewDwellMs", "previewMinIntervalMs", "dailyCap"]) $(id).value = state[id];
  await renderUsage(state.dailyCap);
  baseline = frozenCopy(buildDraft());
  const active = baseline.profiles[baseline.provider];
  committed = frozenCopy({ ...state, ...clone(baseline), ...active, keys: clone(state.keys) });
  setSettingsReady(true);
  recomputeDirty();
}

$("save").addEventListener("click", async () => {
  if (!settingsReady || saving) return;
  const restoreSaveFocus = document.activeElement === $("save");
  const snapshot = frozenCopy(buildDraft());
  const { provider, profiles } = snapshot;
  // A stored provider removed from the dropdown becomes an empty select value.
  // Preserve its dormant profile and use an empty active mirror rather than
  // throwing before the Save error boundary.
  const active = normalizeProfile(profiles[provider]);
  const payload = clone({
    provider, key: active.key, keys: { ...committed.keys, [provider]: active.key }, profiles,
    base: active.base, model: active.model, language: snapshot.language,
    customInstructions: snapshot.customInstructions, uiLang: snapshot.uiLang,
    previewDwellMs: snapshot.previewDwellMs, previewMinIntervalMs: snapshot.previewMinIntervalMs, dailyCap: snapshot.dailyCap,
  });
  saving = true;
  invalidateSavedFlash();
  saveFailed = false;
  savedRefreshWarning = false;
  renderControls();
  renderSaveStatus();
  let refreshSucceeded = false;
  try {
    try {
      await chrome.storage.sync.set(payload);
    } catch {
      saveFailed = true;
      return;
    }
    // Persistence is authoritative before the secondary display refresh starts.
    committed = frozenCopy(payload);
    baseline = frozenCopy(snapshot);
    draftProfiles = clone(snapshot.profiles);
    recomputeDirty();
    renderConnectionStatus();
    try {
      await globalThis.DebaitI18n.init();
      applyI18n();
      await renderUsage(payload.dailyCap);
      savedFlash = true;
      refreshSucceeded = true;
    } catch {
      savedRefreshWarning = true;
    }
  } finally {
    saving = false;
    renderControls();
    recomputeDirty();
    renderSaveStatus();
    renderConnectionStatus();
    const focused = document.activeElement;
    if (restoreSaveFocus && (!focused || focused === document.body || focused.disabled)) $("save").focus();
    if (refreshSucceeded) startSavedFlashTimer();
  }
});

// Layout-only measurement: no settings or draft values are exposed here.
const saveBar = $("saveBar");
const measureSaveBar = () => document.documentElement.style.setProperty("--save-bar-height", `${saveBar.getBoundingClientRect().height}px`);
measureSaveBar();
if (typeof ResizeObserver !== "undefined") new ResizeObserver(measureSaveBar).observe(saveBar);

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
  loadFailed = true;
  setSettingsReady(false);
  renderSaveStatus();
});
