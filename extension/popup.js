// Apply localized strings honoring the user's interface-language override.
(async () => {
  await globalThis.DebaitI18n.init();
  globalThis.DebaitI18n.apply();
  document.documentElement.lang = globalThis.DebaitI18n.lang === "zh_TW" ? "zh-TW" : "en";
})();

document.getElementById("go").addEventListener("click", async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.id) chrome.tabs.sendMessage(tab.id, { type: "debait:run" });
  window.close();
});
document.getElementById("opts").addEventListener("click", (e) => {
  e.preventDefault();
  chrome.runtime.openOptionsPage();
});
