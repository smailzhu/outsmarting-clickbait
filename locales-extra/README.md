# locales-extra

Custom UI locales that aren't valid Chrome UI-locale codes (so they can't live in
`extension/_locales/`). `npm run sync` folds these into `extension/messages.gen.js`,
and the extension's own i18n resolver (`extension/i18n-runtime.js`) uses them via
the **Options → Interface language** dropdown.

- **`nan-Hanlo/`** — Taiwanese Hokkien (台語) in Hàn-Lô (漢羅) mixed script.
  ⚠️ **DRAFT — needs native-speaker review** before publishing. Corrections are a
  single JSON file; keep the keys identical to `extension/_locales/en/messages.json`
  and keep placeholder markers (`$SECS$`, `$USED$`, `$CAP$`, `$PROVIDER$`).

To add another written form later (e.g. `nan-Hant` 漢字 or `nan-Latn` Tâi-lô):
create `locales-extra/<code>/messages.json` and add one `<option>` to the
Interface-language `<select>` in `extension/options.html`. No code change needed.
