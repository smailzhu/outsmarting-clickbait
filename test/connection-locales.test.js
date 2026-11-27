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

function assertLocaleParity(tables, generated) {
  const keys = Object.keys(tables.en).sort();
  assert.deepEqual(Object.keys(generated).sort(), Object.keys(tables).sort());
  for (const [lang, table] of Object.entries(tables)) {
    assert.deepEqual(Object.keys(table).sort(), keys, `${lang} source keys`);
    assert.deepEqual(Object.keys(generated[lang]).sort(), keys, `${lang} generated keys`);
    for (const key of keys) assert.deepEqual(generated[lang][key], table[key], `${lang}/${key} full entry`);
  }
}
function localeTables() {
  const tables = Object.fromEntries(Object.entries(files).map(([lang, path]) => [lang, JSON.parse(readFileSync(new URL(path, import.meta.url), "utf8"))]));
  const context = vm.createContext({});
  vm.runInContext(readFileSync(new URL("../extension/messages.gen.js", import.meta.url), "utf8"), context);
  return { tables, generated: JSON.parse(JSON.stringify(context.DebaitMessages)) };
}
test("all locale source keys and full generated entries including placeholders are synced", () => {
  const { tables, generated } = localeTables();
  assertLocaleParity(tables, generated);
});
test("locale parity rejects removed new keys, stale entries and changed placeholders", () => {
  for (const mutate of [
    (generated) => { delete generated.en.optDiscard; },
    (generated) => { delete generated.zh_TW.optFieldModified; },
    (generated) => { generated["nan-Hanlo"].optOtherProvidersModified.message = "stale"; },
    (generated) => { generated["nan-Hanlo"].optDiscardHint.message = "stale"; },
    (generated) => { delete generated.zh_TW.optDiscarded; },
    (generated) => { generated.zh_TW.connectionSaveReminder.message = "stale"; },
    (generated) => { generated.en.connectionHttp.placeholders = {}; },
  ]) {
    const { tables, generated } = localeTables();
    mutate(generated);
    assert.throws(() => assertLocaleParity(tables, generated));
  }
});

test("real i18n init falls back internally on storage rejection rather than throwing to Settings", async () => {
  const context = vm.createContext({ chrome: {
    i18n: { getUILanguage: () => "zh-TW" },
    storage: { sync: { get: async () => { throw new Error("fixture private read error"); } } },
  } });
  for (const source of ["messages.gen.js", "i18n-runtime.js"]) vm.runInContext(readFileSync(new URL(`../extension/${source}`, import.meta.url), "utf8"), context);
  await assert.doesNotReject(context.DebaitI18n.init());
  assert.equal(context.DebaitI18n.lang, "zh_TW");
  const messages = JSON.parse(readFileSync(new URL(files.zh_TW, import.meta.url), "utf8"));
  assert.equal(context.DebaitI18n.t("optSaveFailed"), messages.optSaveFailed.message);
});

for (const lang of Object.keys(files)) test(`options.js Discard labels, page-local hint and neutral announcement use real ${lang} runtime translations`, async () => {
  const { createPage } = await import("./helpers/options-page.js");
  const context = vm.createContext({ chrome: {
    i18n: { getUILanguage: () => "en" }, storage: { sync: { get: async () => ({ uiLang: lang }) } },
  } });
  for (const source of ["messages.gen.js", "i18n-runtime.js"]) vm.runInContext(readFileSync(new URL(`../extension/${source}`, import.meta.url), "utf8"), context);
  await context.DebaitI18n.init(); assert.equal(context.DebaitI18n.lang, lang);
  const messages = JSON.parse(readFileSync(new URL(files[lang], import.meta.url), "utf8"));
  const page = createPage({ initial: { key: "saved-key", uiLang: lang }, applyStaticLabels: true,
    translate: (key, _lang, subs) => context.DebaitI18n.t(key, subs) });
  await page.flush(); await page.edit("language", "Japanese"); await page.nodes.discard.dispatch("click");
  for (const [id, key] of [["discard", "optDiscard"], ["discardHint", "optDiscardHint"], ["status", "optDiscarded"]]) {
    assert.ok(messages[key].message && messages[key].message !== key);
    assert.equal(page.nodes[id].textContent, messages[key].message, `${lang}/${key}`);
    if (lang !== "en") assert.notEqual(messages[key].message, JSON.parse(readFileSync(new URL(files.en, import.meta.url), "utf8"))[key].message);
  }
  assert.equal(page.nodes.status.dataset.state, "neutral"); assert.equal(page.nodes.uiLang.value, lang);
  // Source/layout contract only: no claim of physical three-language wrapping.
  const html = readFileSync(new URL("../extension/options.html", import.meta.url), "utf8");
  assert.match(html, /#saveBar \{[^}]*flex-wrap: wrap/); assert.match(html, /#status \{[^}]*overflow-wrap: anywhere/);
  assert.match(html, /@media \(max-height: 360px\)[\s\S]*?#saveBar \{ position: static; \}/);
});

for (const [lang, path] of Object.entries(files)) test(`field marker messages in ${lang} are nonempty, generic and exactly generated`, async () => {
  const { tables, generated } = localeTables();
  for (const key of ["optFieldModified", "optOtherProvidersModified"]) {
    const entry = tables[lang][key];
    assert.ok(entry.message.trim()); assert.equal(entry.placeholders, undefined);
    assert.doesNotMatch(entry.message, /\$|https?:|\b(?:openai|gemini|anthropic)\b|\d/i);
    assert.deepEqual(generated[lang][key], entry);
    if (lang !== "en") assert.notEqual(entry.message, tables.en[key].message);
  }
  assert.equal(JSON.parse(readFileSync(new URL(path, import.meta.url), "utf8")).optOtherProvidersModified.message, generated[lang].optOtherProvidersModified.message);
});

for (const [lang, path] of Object.entries(files)) test(`setup guidance ${lang} exists, is translated and matches generated runtime`, async () => {
  const messages = JSON.parse(readFileSync(new URL(path, import.meta.url), "utf8"));
  const context = vm.createContext({ chrome: { i18n: { getUILanguage: () => "en" }, storage: { sync: { get: async () => ({ uiLang: lang }) } } } });
  for (const source of ["messages.gen.js", "i18n-runtime.js"]) vm.runInContext(readFileSync(new URL(`../extension/${source}`, import.meta.url), "utf8"), context);
  await context.DebaitI18n.init();
  for (const key of ["tipSetupHeading", "tipSetupBody"]) {
    assert.ok(messages[key].message.trim()); assert.equal(context.DebaitI18n.t(key), messages[key].message);
    assert.notEqual(context.DebaitI18n.t(key), key); assert.doesNotMatch(messages[key].message, /https?:|valid key|sk-|\$|onclick|onerror/);
    if (lang !== "en") assert.notEqual(messages[key].message, JSON.parse(readFileSync(new URL(files.en, import.meta.url), "utf8"))[key].message);
  }
});
