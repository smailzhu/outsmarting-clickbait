// Copies the browser-safe shared modules into the extension folder, since an
// unpacked extension can only load files inside its own directory.
// Run: npm run sync
import { copyFileSync, readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const copies = [
  ["shared/providers.js", "extension/providers.js"],
  ["shared/prompt.js", "extension/prompt.esm.js"],
  ["shared/extract.js", "extension/extract.js"],
];

for (const [from, to] of copies) {
  copyFileSync(join(root, from), join(root, to));
  console.log(`synced ${from} -> ${to}`);
}

// Generate a single embedded message table so the UI can honor a user-selected
// interface language (overriding the browser locale). Auto-discovers locales
// from extension/_locales/ (Chrome-native: en, zh_TW) AND locales-extra/
// (custom-only locales like Taiwanese that aren't valid Chrome UI locales).
// Add a new locale = drop in a folder; no code change needed.
function localeDirs(base) {
  try {
    return readdirSync(base)
      .filter((n) => { try { return statSync(join(base, n, "messages.json")).isFile(); } catch { return false; } })
      .sort();
  } catch { return []; }
}
const table = {};
for (const base of [join(root, "extension/_locales"), join(root, "locales-extra")]) {
  for (const name of localeDirs(base)) {
    table[name] = JSON.parse(readFileSync(join(base, name, "messages.json"), "utf8"));
  }
}
const genPath = join(root, "extension/messages.gen.js");
const gen = `// AUTO-GENERATED from _locales + locales-extra by \`npm run sync\` — do not edit.\nglobalThis.DebaitMessages = ${JSON.stringify(table)};\n`;
writeFileSync(genPath, gen);
console.log(`generated extension/messages.gen.js (${Object.keys(table).join(", ")})`);
