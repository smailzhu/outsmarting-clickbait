// Stores provider + base + model + a per-provider key map so switching
// providers keeps each key. The active `key` mirrors the current provider's key
// for the background worker.
const DEFAULTS = { provider: "openai", base: "", model: "", key: "", keys: {}, language: "" };
const $ = (id) => document.getElementById(id);

let state = { ...DEFAULTS };

async function load() {
  state = { ...DEFAULTS, ...(await chrome.storage.sync.get(DEFAULTS)) };
  $("provider").value = state.provider;
  $("base").value = state.base || "";
  $("model").value = state.model || "";
  $("language").value = state.language || "";
  $("key").value = state.keys?.[state.provider] || state.key || "";
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
  });
  $("status").textContent = "Saved ✓";
  setTimeout(() => ($("status").textContent = ""), 1500);
});

load();
