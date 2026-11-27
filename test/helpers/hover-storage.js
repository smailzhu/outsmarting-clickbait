// Realistic raw snapshots, omitted-newValue removals, structural changes and one
// extension-origin exclusive lock queue shared by independent VM contexts.
export function createHoverStorage({ sync = {}, local = {}, beforeGet, beforeSet, deferEvents = false, locks = true } = {}) {
  const stores = { sync: structuredClone(sync), local: structuredClone(local) };
  const observers = new Set(), events = [], reads = [], writes = [], attempts = [], lockCalls = [];
  let tail = Promise.resolve();
  const emit = (changes, area) => { for (const listener of [...observers]) listener(changes, area); };
  const deliver = (changes, area) => { if (!Object.keys(changes).length) return; if (deferEvents) events.push(() => emit(changes, area)); else emit(changes, area); };
  const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const storage = { onChanged: { addListener: (fn) => observers.add(fn), removeListener: (fn) => observers.delete(fn) } };
  for (const area of ["sync", "local"]) storage[area] = {
    async get(keys) {
      const source = stores[area];
      const raw = Array.isArray(keys) ? Object.fromEntries(keys.filter((key) => Object.hasOwn(source, key)).map((key) => [key, source[key]])) : { ...keys, ...source };
      const snapshot = structuredClone(raw);
      reads.push({ area, keys: structuredClone(keys), snapshot });
      await beforeGet?.(area, keys, reads.length);
      return snapshot;
    },
    async set(data) {
      const snapshot = structuredClone(data);
      attempts.push({ area, data: snapshot });
      await beforeSet?.(area, snapshot, attempts.length);
      const changes = {};
      for (const [key, value] of Object.entries(snapshot)) {
        if (!Object.hasOwn(stores[area], key) || !equal(stores[area][key], value)) changes[key] = { ...(Object.hasOwn(stores[area], key) ? { oldValue: stores[area][key] } : {}), newValue: value };
      }
      Object.assign(stores[area], snapshot);
      writes.push({ area, data: structuredClone(snapshot) });
      deliver(changes, area);
    },
    async remove(keys) {
      const changes = {};
      for (const key of keys) if (Object.hasOwn(stores[area], key)) { changes[key] = { oldValue: stores[area][key] }; delete stores[area][key]; }
      deliver(changes, area);
    },
    async clear() { await this.remove(Object.keys(stores[area])); },
  };
  const navigator = locks ? { locks: { request(name, options, callback) {
    lockCalls.push({ name, mode: options.mode, origin: "chrome-extension://fixture-extension" });
    const run = tail.then(callback);
    tail = run.catch(() => {});
    return run;
  } } } : {};
  return { storage, navigator, sync: stores.sync, local: stores.local, reads, writes, attempts, lockCalls, emit,
    flushEvents() { while (events.length) events.shift()(); } };
}
