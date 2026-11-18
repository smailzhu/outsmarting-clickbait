import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const script = readFileSync(new URL("../extension/options.js", import.meta.url), "utf8");
const start = script.indexOf("function renderSaveStatus() {");
const end = script.indexOf("function warnBeforeUnload", start);
assert.ok(start >= 0 && end > start, "Expected production status renderer");

function statusFor(flags = {}) {
  const status = { textContent: "", dataset: {} };
  const context = vm.createContext({
    loadFailed: false, saving: false, saveFailed: false, dirty: false,
    savedRefreshWarning: false, discardedNotice: false, savedFlash: false, ...flags,
    $: () => status, t: (key) => key,
    setText: (el, text) => { el.textContent = text; },
  });
  vm.runInContext(script.slice(start, end) + "\nrenderSaveStatus();", context);
  return status;
}

test("unsaved settings use amber warning state and retain their text label", () => {
  const status = statusFor({ dirty: true });
  assert.equal(status.dataset.state, "warning");
  assert.equal(status.textContent, "optUnsaved");
});

test("saving stays neutral, successful saves green, and save failures red", () => {
  for (const [flags, state, text] of [
    [{ saving: true, dirty: true }, "neutral", "optSaving"],
    [{ savedFlash: true }, "success", "optSaved"],
    [{ saveFailed: true, dirty: true }, "error", "optSaveFailed"],
    [{ loadFailed: true }, "error", "optLoadFailed"],
    [{ savedRefreshWarning: true }, "error", "optSavedRefreshWarning"],
    [{}, "neutral", ""],
  ]) {
    const status = statusFor(flags);
    assert.equal(status.dataset.state, state);
    assert.equal(status.textContent, text);
  }
});

test("amber CSS has accessible contrast against the white Save bar", () => {
  const html = readFileSync(new URL("../extension/options.html", import.meta.url), "utf8");
  assert.match(html, /#status\[data-state="warning"\] \{ color: #92400e; \}/);
  assert.match(html, /id="status"[^>]*role="status"[^>]*aria-live="polite"/);
  const linear = (value) => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  const [r, g, b] = [0x92, 0x40, 0x0e].map((value) => linear(value / 255));
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const contrast = 1.05 / (luminance + 0.05);
  assert.ok(contrast >= 4.5, `Amber text must meet AA normal-text contrast: ${contrast}`);
});

test("options.js neutral Discard notice obeys status priority without hiding refresh failures", () => {
  for (const [flags, state, text] of [
    [{ discardedNotice: true }, "neutral", "optDiscarded"],
    [{ discardedNotice: true, savedFlash: true }, "neutral", "optDiscarded"],
    [{ discardedNotice: true, savedRefreshWarning: true }, "error", "optSavedRefreshWarning"],
    [{ discardedNotice: true, dirty: true, savedRefreshWarning: true }, "warning", "optUnsaved"],
    [{ discardedNotice: true, saveFailed: true, dirty: true }, "error", "optSaveFailed"],
    [{ discardedNotice: true, saving: true, dirty: true, savedRefreshWarning: true }, "neutral", "optSaving"],
    [{ discardedNotice: true, loadFailed: true, saving: true }, "error", "optLoadFailed"],
  ]) {
    const status = statusFor(flags);
    assert.equal(status.dataset.state, state); assert.equal(status.textContent, text);
  }
});
