// Copies the browser-safe shared modules into the extension folder, since an
// unpacked extension can only load files inside its own directory.
// Run: npm run sync
import { copyFileSync } from "node:fs";
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
