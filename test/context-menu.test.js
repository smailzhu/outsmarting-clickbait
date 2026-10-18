import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

function worker() {
  const created = [], sent = [], updated = [], events = {};
  let optionsOpened = 0;
  const on = (name) => ({ addListener: (fn) => { events[name] = fn; } });
  const context = vm.createContext({ URL,
    DebaitI18n: { init: async () => {}, t: (key) => `translated:${key}` },
    chrome: {
      runtime: { onMessage: on("message"), onInstalled: on("install"), openOptionsPage: () => { optionsOpened++; } },
      contextMenus: {
        create: (item) => created.push(item),
        update: async (id, item) => updated.push({ id, ...item }),
        onClicked: on("click"),
      },
      storage: { onChanged: on("change") },
      tabs: { sendMessage: async (...args) => { sent.push(args); } },
    },
  });
  const src = readFileSync(new URL("../extension/background.js", import.meta.url), "utf8").replace(/^import .*;\r?\n/gm, "");
  vm.runInContext(src, context);
  return { created, sent, updated, events, context, optionsOpened: () => optionsOpened };
}

test("context menus include localized page and HTTP(S)-only link actions", async () => {
  const w = worker();
  await w.events.install({ reason: "update" });
  assert.equal(w.created.length, 2);
  const page = w.created.find((item) => item.id === "debait-run");
  const link = w.created.find((item) => item.id === "debait-link");
  assert.equal(page.title, "translated:ctxDebaitPage");
  assert.equal(link.title, "translated:ctxDebaitLink");
  assert.deepEqual(Array.from(link.contexts), ["link"]);
  assert.deepEqual(Array.from(link.targetUrlPatterns), ["https://*/*", "http://*/*"]);
  assert.equal(w.optionsOpened(), 0);
});

test("page/link actions target one top-frame panel without opening the target", () => {
  const w = worker();
  w.events.click({ menuItemId: "debait-run" }, { id: 7 });
  w.events.click({ menuItemId: "debait-link", linkUrl: "https://example.com/story" }, { id: 7 });
  assert.equal(w.sent.length, 2);
  assert.equal(w.sent[0][1].type, "debait:run");
  assert.equal(w.sent[1][1].type, "debait:runLink");
  assert.equal(w.sent[1][1].url, "https://example.com/story");
  assert.equal(w.sent[1][2].frameId, 0);
  for (const linkUrl of ["javascript:alert(1)", "file:///tmp/x", "mailto:a@example.com", "invalid", undefined]) {
    w.events.click({ menuItemId: "debait-link", linkUrl }, { id: 7 });
  }
  w.events.click({ menuItemId: "debait-link", linkUrl: "https://example.com" }, undefined);
  w.events.click({ menuItemId: "other" }, { id: 7 });
  assert.equal(w.sent.length, 2);
});

test("both context menu titles update when interface language changes", async () => {
  const w = worker();
  await w.events.change({ uiLang: { newValue: "zh_TW" } }, "sync");
  assert.equal(w.updated.length, 2);
  assert.equal(w.updated[0].title, "translated:ctxDebaitPage");
  assert.equal(w.updated[1].title, "translated:ctxDebaitLink");
  await w.events.change({ key: { newValue: "secret" } }, "sync");
  assert.equal(w.updated.length, 2);
});

test("restricted tabs fail quietly instead of navigating or throwing", async () => {
  const w = worker();
  vm.runInContext('chrome.tabs.sendMessage = async () => { throw new Error("No receiving end"); }', w.context);
  w.events.click({ menuItemId: "debait-link", linkUrl: "https://example.com" }, { id: 7 });
  await new Promise((r) => setImmediate(r));
});
