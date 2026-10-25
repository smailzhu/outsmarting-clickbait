// Presence, not truthiness, determines ownership. An existing profile is
// authoritative even when empty; obsolete mirrors must never refill it.
(function (root) {
  const owns = (obj, key) => Object.prototype.hasOwnProperty.call(obj || {}, key);
  const text = (value) => typeof value === "string" ? value.trim() : "";
  const normalize = (profile) => Object.fromEntries(["key", "base", "model"].map((field) => [field, text(profile?.[field])]));
  function migrate(settings, providerIds) {
    const active = settings.provider || "openai";
    const profiles = { ...settings.profiles };
    for (const id of providerIds) {
      if (owns(profiles, id)) { profiles[id] = normalize(profiles[id]); continue; }
      profiles[id] = {
        key: owns(settings.keys, id) ? text(settings.keys[id]) : id === active ? text(settings.key) : "",
        base: id === active ? text(settings.base) : "",
        model: id === active ? text(settings.model) : "",
      };
    }
    return { ...settings, profiles, ...normalize(profiles[active]) };
  }
  root.DebaitProfiles = { migrate, normalize, owns };
})(globalThis);
