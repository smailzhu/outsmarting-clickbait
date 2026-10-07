// Runtime i18n resolver honoring a user "Interface language" override (uiLang).
// Loaded as a classic script (content_scripts / popup / options) and imported
// for side-effects by the background module. Reads globalThis.DebaitMessages
// (messages.gen.js). Falls back to the browser UI language ("auto"), then en.
(() => {
  const M = globalThis.DebaitMessages || { en: {}, zh_TW: {} };
  const browserLang = () => {
    const ui = ((chrome.i18n && chrome.i18n.getUILanguage && chrome.i18n.getUILanguage()) || "en").toLowerCase();
    return (ui.startsWith("zh-tw") || ui.startsWith("zh-hant") || ui === "zh-hk") && M.zh_TW ? "zh_TW" : "en";
  };
  const pick = (uiLang) => (uiLang && uiLang !== "auto" && M[uiLang]) ? uiLang : browserLang();
  function applyMsg(entry, subs) {
    if (!entry) return "";
    let m = entry.message;
    const ph = entry.placeholders || {};
    for (const name in ph) m = m.replace(new RegExp("\\$" + name + "\\$", "gi"), ph[name].content);
    const arr = Array.isArray(subs) ? subs : (subs != null ? [subs] : []);
    return m.replace(/\$(\d+)/g, (_, d) => (arr[d - 1] != null ? String(arr[d - 1]) : ""));
  }
  let LANG = browserLang();
  async function init() {
    try { const r = await chrome.storage.sync.get({ uiLang: "" }); LANG = pick(r.uiLang); }
    catch { LANG = browserLang(); }
    return LANG;
  }
  function t(key, subs) {
    const entry = (M[LANG] && M[LANG][key]) || (M.en && M.en[key]);
    return applyMsg(entry, subs) || key;
  }
  const verdict = (v) => {
    const r = t("verdict_" + v);
    return r === "verdict_" + v ? (v || "") : r;
  };
  function apply(root) {
    root = root || document;
    root.querySelectorAll("[data-i18n]").forEach((el) => { const m = t(el.dataset.i18n); if (m) el.textContent = m; });
    root.querySelectorAll("[data-i18n-ph]").forEach((el) => { const m = t(el.dataset.i18nPh); if (m) el.placeholder = m; });
  }
  globalThis.DebaitI18n = { init, t, verdict, apply, get lang() { return LANG; } };
})();
