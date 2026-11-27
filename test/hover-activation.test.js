import { test } from "node:test";
import assert from "node:assert/strict";
import "../shared/hover-activation.js";
const H = globalThis.DebaitHoverActivation, K = H.PROVENANCE_KEY;
const read = (state, area, raw) => H.mergeRead(state, area, H.beginRead(state, area), raw);
function freeze(state) {
  for (const area of ["sync", "local"]) { for (const key of ["raw", "known", "revisions"]) Object.freeze(state[area][key]); Object.freeze(state[area]); }
  return Object.freeze(state);
}
test("hover-activation.js exact closed constants, raw evidence and no storage side effects", () => {
  assert.deepEqual(H.MODES, ["shift", "alt", "none"]);
  assert.deepEqual(H.EVIDENCE_FIELDS, ["provider", "profiles", "keys", "key", "base", "model", "language", "customInstructions", "uiLang", "previewDwellMs", "previewMinIntervalMs", "dailyCap"]);
  assert.deepEqual(H.SYNC_FIELDS, ["hoverActivation", "requireAltForHover", ...H.EVIDENCE_FIELDS]);
  assert.equal(K, "hoverActivationProvenanceV1");
  assert.equal(H.classify({}), "fresh");
  for (const field of H.SYNC_FIELDS) for (const value of [undefined, null, "", {}, [], false]) assert.equal(H.classify({ [field]: value }), "existing", field);
  for (const field of ["debaitUsage", "usageCount", "unknown", "popupHint", "uiTheme"]) assert.equal(H.classify({ [field]: "noise" }), "fresh");
});
test("hover-activation.js exact canonical precedence, legacy fail-safe and missing/malformed provenance", () => {
  assert.equal(H.resolve({}, {}), null);
  for (const value of ["fresh", "existing", "Fresh", " existing ", null, undefined, {}, ""]) assert.equal(H.resolve({}, { [K]: value }), value === "existing" ? "alt" : "shift");
  for (const value of [false, true, null, undefined, "false", 0, {}, []]) assert.equal(H.resolve({ requireAltForHover: value }, { [K]: "fresh" }), value === false ? "none" : "alt");
  for (const value of [...H.MODES, "Shift", " shift ", "", null, undefined, false, {}, []]) assert.equal(H.resolve({ hoverActivation: value, requireAltForHover: false }, { [K]: "existing" }), H.MODES.includes(value) ? value : "shift");
});
test("hover-activation.js immutable per-field independent-area reads preserve newer events/removals", () => {
  let state = freeze(H.createState());
  const syncToken = H.beginRead(state, "sync"), localToken = H.beginRead(state, "local");
  state = H.applyChanges(state, "sync", { hoverActivation: { newValue: "none" }, provider: { newValue: null } });
  const previous = freeze(state);
  state = H.mergeRead(state, "sync", syncToken, { hoverActivation: "alt", provider: "openai", previewDwellMs: 0 });
  assert.equal(previous.sync.known.previewDwellMs, false);
  assert.equal(state.sync.raw.hoverActivation, "none"); assert.equal(state.sync.raw.provider, null);
  assert.deepEqual(H.policy(state), { ready: true, mode: "none", dwellMs: 0 });
  state = H.mergeRead(state, "local", localToken, { [K]: "existing" });
  state = H.applyChanges(state, "sync", { hoverActivation: {}, requireAltForHover: { newValue: false }, previewDwellMs: {} });
  assert.equal(Object.hasOwn(state.sync.raw, "hoverActivation"), false);
  assert.deepEqual(H.policy(state), { ready: true, mode: "none", dwellMs: 500 });
  assert.equal(H.mergeRead(state, "sync", localToken, { hoverActivation: "alt" }), state);
  const oldLocal = H.beginRead(state, "local");
  state = H.applyChanges(state, "local", { [K]: {} });
  assert.equal(state.epoch, 1);
  assert.equal(H.mergeRead(state, "local", oldLocal, { [K]: "existing" }), state);
  assert.equal(H.applyChanges(state, "local", { debaitUsage: { newValue: {} } }), state);
});
test("hover-activation.js readiness requires known dwell and complete precedence, not evidence", () => {
  for (const mode of H.MODES) {
    let state = H.applyChanges(H.createState(), "sync", { hoverActivation: { newValue: mode } });
    assert.equal(H.policy(state).ready, false);
    state = H.applyChanges(state, "sync", { previewDwellMs: {} });
    assert.deepEqual(H.policy(state), { ready: true, mode, dwellMs: 500 });
  }
  let state = H.applyChanges(H.createState(), "sync", { requireAltForHover: { newValue: false }, previewDwellMs: { newValue: 0 } });
  state = read(state, "local", { [K]: "fresh" });
  assert.equal(H.policy(state).ready, false, "unknown canonical cannot be bypassed");
  state = H.applyChanges(state, "sync", { hoverActivation: {} });
  assert.equal(H.policy(state).mode, "none");
  state = H.applyChanges(state, "sync", { requireAltForHover: {} });
  assert.equal(H.policy(state).mode, "shift");
  state = H.applyChanges(state, "local", { [K]: {} });
  assert.equal(H.policy(state).ready, false);
  state = H.applyChanges(state, "sync", { profiles: { newValue: {} } });
  assert.equal(H.policy(state).ready, false);
});
for (const [value, expected] of [[undefined, 500], [null, 0], ["", 0], [0, 0], ["20", 20], [-1, 500], [Infinity, 500], ["bad", 500], [{}, 500]]) test(`hover-activation.js dwell sanitizer ${String(value)}`, () => {
  let state = read(H.createState(), "sync", { hoverActivation: "shift", previewDwellMs: value });
  assert.equal(H.policy(state).dwellMs, expected);
});
