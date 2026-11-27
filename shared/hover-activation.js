// Extension-only raw preference policy. Defaults are not installation evidence.
(() => {
  const MODES = Object.freeze(["shift", "alt", "none"]);
  const EVIDENCE_FIELDS = Object.freeze(["provider", "profiles", "keys", "key", "base", "model", "language", "customInstructions", "uiLang", "previewDwellMs", "previewMinIntervalMs", "dailyCap"]);
  const SYNC_FIELDS = Object.freeze(["hoverActivation", "requireAltForHover", ...EVIDENCE_FIELDS]);
  const PROVENANCE_KEY = "hoverActivationProvenanceV1";
  const owns = (raw, field) => Object.prototype.hasOwnProperty.call(raw, field);
  const fields = (area) => area === "sync" ? SYNC_FIELDS : area === "local" ? [PROVENANCE_KEY] : [];
  function classify(rawSync) {
    return SYNC_FIELDS.some((field) => owns(rawSync, field)) ? "existing" : "fresh";
  }
  function resolve(rawSync, rawLocal) {
    if (owns(rawSync, "hoverActivation")) return MODES.includes(rawSync.hoverActivation) ? rawSync.hoverActivation : "shift";
    if (owns(rawSync, "requireAltForHover")) return rawSync.requireAltForHover === false ? "none" : "alt";
    if (!owns(rawLocal, PROVENANCE_KEY)) return null;
    return rawLocal[PROVENANCE_KEY] === "existing" ? "alt" : "shift";
  }
  function createState() {
    const area = (keys) => ({ raw: {}, known: Object.fromEntries(keys.map((key) => [key, false])), revisions: Object.fromEntries(keys.map((key) => [key, 0])), revision: 0 });
    return { sync: area(SYNC_FIELDS), local: area([PROVENANCE_KEY]), epoch: 0 };
  }
  function beginRead(state, area) {
    return { area, revisions: { ...state[area].revisions }, epoch: state.epoch };
  }
  function copyArea(state, area) {
    const previous = state[area];
    return { ...state, [area]: { ...previous, raw: { ...previous.raw }, known: { ...previous.known }, revisions: { ...previous.revisions } } };
  }
  function mergeRead(state, area, token, raw) {
    if (token.area !== area || (area === "local" && token.epoch !== state.epoch)) return state;
    const next = copyArea(state, area), target = next[area];
    for (const field of fields(area)) {
      if (target.revisions[field] > token.revisions[field]) continue;
      target.known[field] = true;
      if (owns(raw, field)) target.raw[field] = raw[field];
      else delete target.raw[field];
    }
    return next;
  }
  function applyChanges(state, area, changes) {
    const recognized = fields(area).filter((field) => owns(changes, field));
    if (!recognized.length) return state;
    const next = copyArea(state, area), target = next[area];
    target.revision++;
    for (const field of recognized) {
      target.known[field] = true;
      target.revisions[field] = target.revision;
      if (owns(changes[field], "newValue")) target.raw[field] = changes[field].newValue;
      else {
        delete target.raw[field];
        if (area === "local" && field === PROVENANCE_KEY) next.epoch++;
      }
    }
    return next;
  }
  function policy(state) {
    const { raw, known } = state.sync;
    const canonical = known.hoverActivation && owns(raw, "hoverActivation");
    const legacy = known.hoverActivation && !owns(raw, "hoverActivation") && known.requireAltForHover;
    const fallback = legacy && !owns(raw, "requireAltForHover") && state.local.known[PROVENANCE_KEY] && owns(state.local.raw, PROVENANCE_KEY);
    const ready = !!(known.previewDwellMs && (canonical || (legacy && owns(raw, "requireAltForHover")) || fallback));
    let dwellMs = 500;
    if (known.previewDwellMs && owns(raw, "previewDwellMs")) {
      try { const n = Number(raw.previewDwellMs); if (Number.isFinite(n) && n >= 0) dwellMs = n; } catch { /* Malformed values retain the safe dwell. */ }
    }
    return { ready, mode: ready ? resolve(raw, state.local.raw) : "shift", dwellMs };
  }
  globalThis.DebaitHoverActivation = Object.freeze({ MODES, EVIDENCE_FIELDS, SYNC_FIELDS, PROVENANCE_KEY, classify, resolve, createState, beginRead, mergeRead, applyChanges, policy });
})();
