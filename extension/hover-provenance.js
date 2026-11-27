// Writer contexts only: serialize first local classification before evidence writes.
(() => {
  const H = globalThis.DebaitHoverActivation;
  let state = H.createState(), attempt = null, attemptedEpoch = null, success = null;
  const present = () => state.local.known[H.PROVENANCE_KEY] && Object.prototype.hasOwnProperty.call(state.local.raw, H.PROVENANCE_KEY);
  chrome.storage.onChanged.addListener((changes, area) => {
    state = H.applyChanges(state, area, changes);
  });
  function isApplicable(token) {
    return !!token && token === success && token.epoch === state.epoch && present();
  }
  function ensureInitialized() {
    if (isApplicable(success)) return Promise.resolve(success);
    // Removal invalidates old attempts; only a genuine consumer load may retry
    // in a new epoch. Requests never call this helper outside the migration cache.
    if (attempt && attemptedEpoch === state.epoch) return attempt;
    const epoch = state.epoch;
    attemptedEpoch = epoch;
    const applicable = () => { if (state.epoch !== epoch) throw new Error("Hover provenance epoch changed"); };
    async function read(area) {
      const token = H.beginRead(state, area);
      const raw = await chrome.storage[area].get(area === "sync" ? H.SYNC_FIELDS : [H.PROVENANCE_KEY]);
      applicable();
      state = H.mergeRead(state, area, token, raw);
    }
    attempt = (async () => {
      if (typeof globalThis.navigator?.locks?.request !== "function") throw new Error("Hover provenance lock unavailable");
      const token = await navigator.locks.request("debait-hover-provenance-v1", { mode: "exclusive" }, async () => {
        applicable();
        await read("local");
        if (!present()) {
          await read("sync");
          applicable();
          if (!present()) {
            const classification = H.classify(state.sync.raw);
            // No await between the epoch/presence check and this write invocation.
            await chrome.storage.local.set({ [H.PROVENANCE_KEY]: classification });
            applicable();
            await read("local");
          }
        }
        applicable();
        if (!present()) throw new Error("Hover provenance not durable");
        return Object.freeze({ epoch });
      });
      applicable();
      if (!present()) throw new Error("Hover provenance not durable");
      success = token;
      return success;
    })();
    return attempt;
  }
  globalThis.DebaitHoverProvenance = Object.freeze({ ensureInitialized, isApplicable });
})();
