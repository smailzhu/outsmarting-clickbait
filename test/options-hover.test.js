import { test } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";
import { createPage, deferred, editableControls, lockedControls } from "./helpers/options-page.js";
import { createContent, flush } from "./helpers/content-page.js";
import { createHoverStorage } from "./helpers/hover-storage.js";
const K = "hoverActivationProvenanceV1";
const state = (page, expression) => vm.runInContext(expression, page.context);
for (const [initial, expected] of [
  [{}, "shift"], [{ provider: "openai" }, "alt"], [{ requireAltForHover: false }, "none"],
  ...[true, null, undefined, "false", 0, [], {}].map((value) => [{ requireAltForHover: value }, "alt"]),
  ...["shift", "alt", "none"].map((value) => [{ hoverActivation: value, requireAltForHover: false }, value]),
  ...["SHIFT", " shift ", "", null, undefined, {}, false].map((value) => [{ hoverActivation: value, requireAltForHover: false }, "shift"]),
]) test(`options.js raw select migration ${JSON.stringify(initial)}`, async () => {
  const p = createPage({ initial });
  assert.equal(p.nodes.hoverActivation.disabled, true);
  await flush(); assert.equal(p.nodes.hoverActivation.value, expected); assert.equal(p.nodes.hoverActivation.disabled, false);
  assert.equal(p.nodes.status.textContent, ""); assert.equal(p.nodes.hoverActivationModified.hidden, true);
  assert.ok(p.writes.every((write) => !Object.hasOwn(write, "hoverActivation") && !Object.hasOwn(write, "requireAltForHover")));
  const writes = p.writes.length;
  const mode = expected === "none" ? "alt" : "none";
  await p.selectActivation(mode);
  assert.equal(p.nodes.hoverActivationModified.hidden, false); assert.equal(p.nodes.hoverActivation.dataset.modified, "true");
  assert.ok(p.nodes.hoverActivation.getAttribute("aria-describedby").includes("hoverActivationWarning hoverActivationModified"));
  assert.equal(p.window.listeners.get("beforeunload").size, 1); assert.equal(p.writes.length, writes);
  await p.nodes.discard.click(); assert.equal(p.nodes.hoverActivation.value, expected); assert.equal(p.writes.length, writes);
  await p.selectActivation(mode); await p.nodes.save.click();
  assert.equal(p.store.hoverActivation, mode); assert.equal(p.store.requireAltForHover, mode !== "none");
  assert.equal(p.attempts.at(-1).data.hoverActivation, mode); assert.equal(p.attempts.at(-1).data.requireAltForHover, mode !== "none");
  assert.equal(p.nodes.hoverActivationModified.hidden, true);
  await p.selectActivation(expected); await p.nodes.discard.click(); assert.equal(p.nodes.hoverActivation.value, mode);
});
test("options.js unexpected browser-rejected select value normalizes to Shift, never none", async () => {
  const p = createPage({ initial: { hoverActivation: "none" } }); await flush();
  await p.selectActivation("SHIFT"); assert.equal(p.nodes.hoverActivation.value, "");
  assert.equal(state(p, "buildDraft().hoverActivation"), "shift");
  await p.nodes.save.click(); assert.equal(p.store.hoverActivation, "shift"); assert.equal(p.store.requireAltForHover, true);
  await p.selectActivation("none"); await p.nodes.discard.click(); assert.equal(p.nodes.hoverActivation.value, "shift");
});
test("options.js unsaved/failed select Save cannot change saved content policy", async () => {
  let fail = false;
  const backend = createHoverStorage({ sync: { hoverActivation: "alt" }, beforeSet: (area) => { if (area === "sync" && fail) throw new Error("write"); } });
  const p = createPage({ sharedStorage: backend }); await flush(); const c = createContent({ sharedStorage: backend }); await flush(); const a = c.anchor();
  await p.selectActivation("none"); c.mouse("mouseover", a); c.mouse("mousemove", a, { screenX: 11 }); assert.equal(c.timers.length, 0);
  fail = true; await p.nodes.save.click(); assert.equal(p.nodes.status.textContent, "optSaveFailed"); assert.equal(p.nodes.hoverActivation.value, "none");
  assert.equal(backend.sync.hoverActivation, "alt"); c.mouse("mousemove", a, { screenX: 12 }); assert.equal(c.timers.length, 0);
  fail = false; await p.nodes.save.click(); c.mouse("mousemove", a, { screenX: 12 }); assert.equal(c.timers.length, 0);
  c.mouse("mousemove", a, { screenX: 13 }); assert.equal(c.timers.length, 1);
});
test("options.js immutable mode Save preserves disabled live edit, failed draft and refresh-warning precedence", async () => {
  const wait = deferred(); let writes = 0, inits = 0;
  const p = createPage({ beforeWrite: () => ++writes > 1 ? wait.promise : undefined, beforeI18n: () => { if (++inits > 1) throw new Error("refresh"); } });
  await flush(); await p.selectActivation("none"); p.nodes.save.focus(); const run = p.nodes.save.click();
  assert.ok(editableControls.every((id) => p.nodes[id].disabled));
  p.nodes.hoverActivation.value = "shift"; await p.nodes.hoverActivation.dispatch("change");
  assert.equal(p.attempts.at(-1).data.hoverActivation, "none");
  wait.resolve(); await run;
  assert.equal(p.store.hoverActivation, "none"); assert.equal(p.nodes.hoverActivation.value, "shift"); assert.equal(p.nodes.status.textContent, "optUnsaved");
  await p.selectActivation("none"); assert.equal(p.nodes.status.textContent, "optSavedRefreshWarning"); assert.equal(p.window.listeners.get("beforeunload").size, 0);
});
test("options.js marker removal locks controls preserving drafts; invoked Save completion remains authoritative", async () => {
  const wait = deferred(); let writes = 0;
  const p = createPage({ beforeWrite: () => ++writes > 1 ? wait.promise : undefined }); await flush();
  await p.selectActivation("none"); const run = p.nodes.save.click();
  await p.backend.storage.local.remove([K]); assert.ok(lockedControls.every((id) => p.nodes[id].disabled));
  assert.equal(p.nodes.status.textContent, "optHoverInitFailed");
  wait.resolve(); await run;
  assert.equal(p.store.hoverActivation, "none"); assert.equal(state(p, "baseline.hoverActivation"), "none");
  assert.equal(p.nodes.status.textContent, "optHoverInitFailed"); assert.ok(lockedControls.every((id) => p.nodes[id].disabled));
  const attempts = p.backend.attempts.length; await p.selectActivation("shift"); await p.nodes.save.dispatch("click"); await p.nodes.discard.dispatch("click"); await p.nodes.testConnection.dispatch("click");
  assert.equal(p.backend.attempts.length, attempts); assert.equal(p.messages.length, 0);
});
test("options.js events during migration/i18n/usage establish latest policy baseline, later external edits leave draft alone", async () => {
  for (const stage of ["beforeWrite", "beforeI18n", "beforeUsage"]) {
    const wait = deferred(); const p = createPage({ [stage]: () => wait.promise }); await flush();
    p.backend.emit({ hoverActivation: { newValue: "none" }, previewDwellMs: { newValue: 0 } }, "sync");
    wait.resolve(); await flush();
    assert.equal(p.nodes.hoverActivation.value, "none"); assert.equal(p.nodes.previewDwellMs.value, "0"); assert.equal(p.nodes.status.textContent, "");
    await p.selectActivation("shift"); await p.backend.storage.sync.set({ hoverActivation: "alt" });
    assert.equal(p.nodes.hoverActivation.value, "shift"); await p.nodes.discard.click(); assert.equal(p.nodes.hoverActivation.value, "none");
  }
});
test("hover-locales: actual select labels/warning/reload guidance and popup mode-neutral hint in all languages", () => {
  const html = readFileSync(new URL("../extension/options.html", import.meta.url), "utf8");
  assert.match(html, /<select[^>]+id="hoverActivation"[^>]+disabled[^>]+aria-describedby="hoverActivationWarning"/);
  assert.deepEqual([...html.matchAll(/<option value="(shift|alt|none)"/g)].map((m) => m[1]), ["shift", "alt", "none"]);
  const fallbackLabels = [...html.matchAll(/<option value="(?:shift|alt|none)"[^>]*>([^<]*)<\/option>/g)].map((m) => m[1]);
  assert.deepEqual(fallbackLabels, ["Shift + hover", "Alt + hover", "Hover without a modifier"]);
  for (const label of fallbackLabels) assert.doesNotMatch(label, /new|default|legacy|新預設|舊版|新|舊/i);
  const warning = html.match(/<p[^>]+id="hoverActivationWarning"[^>]*>([^<]*)<\/p>/)[1];
  for (const word of ["Hover without a modifier", "linked sites", "quota", "cost", "sync profile", "Save", "0 ms", "Shift", "Alt"]) assert.ok(warning.includes(word), word);
  assert.ok(!html.includes('type="checkbox"')); assert.ok(!html.includes('role="alert"'));
  for (const file of ["../extension/_locales/en/messages.json", "../extension/_locales/zh_TW/messages.json", "../locales-extra/nan-Hanlo/messages.json"]) {
    const data = JSON.parse(readFileSync(new URL(file, import.meta.url), "utf8"));
    const expected = file.includes("/en/") ? ["Shift + hover", "Alt + hover", "Hover without a modifier"]
      : file.includes("/zh_TW/") ? ["Shift + 懸停", "Alt + 懸停", "不按修飾鍵懸停"]
      : ["Shift + 停佇頂懸", "Alt + 停佇頂懸", "免按修飾鍵、停佇頂懸"];
    for (const [index, key] of ["optHoverActivationShift", "optHoverActivationAlt", "optHoverActivationNone"].entries()) {
      assert.equal(data[key].message, expected[index]);
      assert.doesNotMatch(data[key].message, /new|default|legacy|新預設|舊版|新|舊/i);
    }
    assert.ok(data.optHoverActivationWarning.message.includes(expected[2]));
    assert.ok(!Object.hasOwn(data, "optRequireAlt"));
    for (const word of ["Shift", "Alt", "AI", "0", ...(file.includes("/en/") ? ["linked sites", "quota", "cost", "sync profile", "Save"] : ["連結網站", "配額", "費用", "同步", "儲存"])]) assert.ok(data.optHoverActivationWarning.message.includes(word), `${file}: ${word}`);
    assert.ok(!data.popupHintLinks.message.includes("Alt"));
  }
});

for (const lang of ["en", "zh_TW", "nan-Hanlo"]) test(`options.js ${lang} activation warning remains visible through every choice`, async () => {
  const p = createPage({ initial: { uiLang: lang }, realI18n: true }); await flush();
  const warning = p.nodes.hoverActivationWarning, saved = warning.textContent;
  for (const mode of ["shift", "alt", "none"]) {
    await p.selectActivation(mode);
    assert.equal(warning.hidden, false); assert.equal(warning.textContent, saved);
    for (let n = warning; n; n = n.parentElement) assert.equal(n.hidden, false);
  }
});
