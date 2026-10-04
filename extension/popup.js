// Apply localized strings (data-i18n = textContent).
for (const el of document.querySelectorAll("[data-i18n]")) {
  const m = chrome.i18n.getMessage(el.dataset.i18n);
  if (m) el.textContent = m;
}
document.documentElement.lang = (chrome.i18n.getUILanguage && chrome.i18n.getUILanguage()) || "en";

document.getElementById("go").addEventListener("click", async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.id) chrome.tabs.sendMessage(tab.id, { type: "debait:run" });
  window.close();
});
document.getElementById("opts").addEventListener("click", (e) => {
  e.preventDefault();
  chrome.runtime.openOptionsPage();
});
