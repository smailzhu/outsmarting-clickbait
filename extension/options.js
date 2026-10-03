const DEFAULTS = { base: "https://api.openai.com/v1", model: "gpt-4o-mini", key: "" };
const $ = (id) => document.getElementById(id);

async function load() {
  const s = await chrome.storage.sync.get(DEFAULTS);
  $("key").value = s.key || "";
  $("base").value = s.base || DEFAULTS.base;
  $("model").value = s.model || DEFAULTS.model;
}

$("save").addEventListener("click", async () => {
  await chrome.storage.sync.set({
    key: $("key").value.trim(),
    base: $("base").value.trim() || DEFAULTS.base,
    model: $("model").value.trim() || DEFAULTS.model,
  });
  $("status").textContent = "Saved ✓";
  setTimeout(() => ($("status").textContent = ""), 1500);
});

load();
