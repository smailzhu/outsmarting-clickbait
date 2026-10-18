import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const files = {
  en: "../extension/_locales/en/messages.json",
  zh_TW: "../extension/_locales/zh_TW/messages.json",
  "nan-Hanlo": "../locales-extra/nan-Hanlo/messages.json",
};

test("connection-test messages exist in all three locales and the runtime table", async () => {
  for (const [lang, path] of Object.entries(files)) {
    const messages = JSON.parse(readFileSync(new URL(path, import.meta.url), "utf8"));
    const context = vm.createContext({
      chrome: {
        i18n: { getUILanguage: () => "en" },
        storage: { sync: { get: async () => ({ uiLang: lang }) } },
      },
    });
    for (const source of ["messages.gen.js", "i18n-runtime.js"]) {
      vm.runInContext(readFileSync(new URL(`../extension/${source}`, import.meta.url), "utf8"), context);
    }
    await context.DebaitI18n.init();
    for (const [key, entry] of Object.entries(messages).filter(([key]) => key.startsWith("connection"))) {
      const translated = context.DebaitI18n.t(key, ["503"]);
      assert.ok(translated && translated !== key, `${lang}/${key} missing`);
      if (key === "connectionHttp") {
        assert.ok(translated.includes("503"));
        assert.ok(!translated.includes("$STATUS$"));
      } else {
        assert.equal(translated, entry.message, `${lang}/${key} generated table is stale`);
      }
    }
  }
});
