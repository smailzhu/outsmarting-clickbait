import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { isOptionsSender } from "../extension/connection-test.js";

test("background rejects page senders and serializes Settings connection tests", async () => {
  let listener;
  let settle;
  let calls = 0;
  const runtime = {
    id: "test-extension", getURL: (path) => `chrome-extension://test-extension/${path}`,
    onMessage: { addListener: (fn) => { listener = fn; } },
    onInstalled: { addListener() {} },
  };
  const context = vm.createContext({
    chrome: { runtime, storage: { onChanged: { addListener() {} } },
      contextMenus: { onClicked: { addListener() {} } } },
    isOptionsSender,
    testConnection: () => {
      calls++;
      return new Promise((resolve) => { settle = resolve; });
    },
  });
  // Evaluate the actual worker listener with imports replaced by test doubles.
  const source = readFileSync(new URL("../extension/background.js", import.meta.url), "utf8")
    .replace(/^import .*;\r?\n/gm, "");
  vm.runInContext(source, context);
  const request = { type: "debait:testConnection", settings: { key: "unsaved" } };
  const sender = { id: runtime.id, url: runtime.getURL("options.html") };
  const answers = [];
  listener(request, { id: runtime.id, url: "https://page.example/" }, (r) => answers.push(r));
  assert.equal(answers.at(-1).code, "denied");
  assert.equal(calls, 0);
  assert.equal(listener(request, sender, (r) => answers.push(r)), true);
  assert.equal(calls, 1);
  listener(request, sender, (r) => answers.push(r));
  assert.equal(answers.at(-1).code, "busy");
  assert.equal(calls, 1);
  settle({ ok: true, code: "success" });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(answers.at(-1).code, "success");
  // Guard is released after completion, so another explicit test can run.
  assert.equal(listener(request, sender, (r) => answers.push(r)), true);
  assert.equal(calls, 2);
  settle({ ok: false, code: "quota" });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(answers.at(-1).code, "quota");
});
