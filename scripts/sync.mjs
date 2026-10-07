// Copies the browser-safe shared modules into the extension folder, since an
// unpacked extension can only load files inside its own directory.
// Run: npm run sync
import { copyFileSync, readFileSync, writeFileSync } from "node:fs";
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

// Generate a single embedded message table from the _locales JSON so the UI can
// honor a user-selected interface language (overriding the browser locale).
const en = JSON.parse(readFileSync(join(root, "extension/_locales/en/messages.json"), "utf8"));
const zh_TW = JSON.parse(readFileSync(join(root, "extension/_locales/zh_TW/messages.json"), "utf8"));
const genPath = join(root, "extension/messages.gen.js");
const gen = `// AUTO-GENERATED from extension/_locales by \`npm run sync\` — do not edit.\nglobalThis.DebaitMessages = ${JSON.stringify({ en, zh_TW })};\n`;
writeFileSync(genPath, gen);
console.log("generated extension/messages.gen.js");
