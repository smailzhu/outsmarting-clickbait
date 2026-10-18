import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const html = readFileSync(new URL("../extension/popup.html", import.meta.url), "utf8");
const hintKeys = ["popupHintAnalyze", "popupHintLinks", "popupHintSetup"];

test("popup instructions appear between Analyze and Settings without changing actions", () => {
  const analyze = html.indexOf('id="go"');
  const settings = html.indexOf('id="opts"');
  for (const key of hintKeys) {
    const position = html.indexOf(`data-i18n="${key}"`);
    assert.ok(position > analyze && position < settings, `${key} should appear below Analyze`);
  }
  assert.ok(html.includes('src="popup.js"'));
});

for (const [lang, source] of [
  ["en", "../extension/_locales/en/messages.json"],
  ["zh_TW", "../extension/_locales/zh_TW/messages.json"],
  ["nan-Hanlo", "../locales-extra/nan-Hanlo/messages.json"],
]) {
  test(`popup instructions honor the ${lang} interface-language setting`, async () => {
    const messages = JSON.parse(readFileSync(new URL(source, import.meta.url), "utf8"));
    const hints = hintKeys.map((key) => ({ dataset: { i18n: key }, textContent: "" }));
    const actions = { go: { addEventListener() {} }, opts: { addEventListener() {} } };
    const context = vm.createContext({
      document: {
        documentElement: {},
        querySelectorAll: (selector) => selector === "[data-i18n]" ? hints : [],
        getElementById: (id) => actions[id],
      },
      chrome: {
        i18n: { getUILanguage: () => "en-US" },
        storage: { sync: { get: async () => ({ uiLang: lang }) } },
      },
    });
    for (const file of ["messages.gen.js", "i18n-runtime.js", "popup.js"]) {
      vm.runInContext(readFileSync(new URL(`../extension/${file}`, import.meta.url), "utf8"), context);
    }
    await new Promise((resolve) => setImmediate(resolve));
    for (const [index, key] of hintKeys.entries()) {
      assert.ok(messages[key]?.message, `${lang}/${key} missing from source`);
      assert.equal(hints[index].textContent, messages[key].message, `${lang}/${key} is untranslated or stale`);
    }
    assert.ok(hints[1].textContent.includes("Alt"));
    assert.ok(hints[2].textContent.includes("API"));
  });
}
