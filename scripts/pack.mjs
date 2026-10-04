// Package the Chromium extension into a loadable/publishable .zip.
// Dependency-free: uses Node's zlib (DEFLATE) + a minimal ZIP writer.
// Run: npm run pack   ->   dist/debait-extension-v<version>.zip
import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { deflateRawSync } from "node:zlib";
import { fileURLToPath } from "node:url";
import { dirname, join, relative } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const extDir = join(root, "extension");

// Keep the committed extension/ copies in sync with shared/ before packaging.
await import("./sync.mjs");

const version = JSON.parse(readFileSync(join(extDir, "manifest.json"), "utf8")).version;

// --- collect files (skip junk) --------------------------------------------
const SKIP = new Set([".DS_Store", "Thumbs.db"]);
function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue;
    const abs = join(dir, name);
    if (statSync(abs).isDirectory()) out.push(...walk(abs));
    else out.push(abs);
  }
  return out;
}
const files = walk(extDir).sort();

// --- minimal ZIP writer (store deflate-raw entries) -----------------------
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

const localParts = [];
const central = [];
let offset = 0;
const DOS_TIME = 0, DOS_DATE = 0x21; // fixed (1980-01-01) for reproducible builds

for (const abs of files) {
  const name = relative(extDir, abs).split("\\").join("/");
  const nameBuf = Buffer.from(name, "utf8");
  const data = readFileSync(abs);
  const crc = crc32(data);
  const comp = deflateRawSync(data, { level: 9 });

  const lfh = Buffer.alloc(30);
  lfh.writeUInt32LE(0x04034b50, 0);
  lfh.writeUInt16LE(20, 4);          // version needed
  lfh.writeUInt16LE(0x0800, 6);      // flags: UTF-8 names
  lfh.writeUInt16LE(8, 8);           // method: deflate
  lfh.writeUInt16LE(DOS_TIME, 10);
  lfh.writeUInt16LE(DOS_DATE, 12);
  lfh.writeUInt32LE(crc, 14);
  lfh.writeUInt32LE(comp.length, 18);
  lfh.writeUInt32LE(data.length, 22);
  lfh.writeUInt16LE(nameBuf.length, 26);
  lfh.writeUInt16LE(0, 28);
  localParts.push(lfh, nameBuf, comp);

  const cdh = Buffer.alloc(46);
  cdh.writeUInt32LE(0x02014b50, 0);
  cdh.writeUInt16LE(20, 4);          // version made by
  cdh.writeUInt16LE(20, 6);          // version needed
  cdh.writeUInt16LE(0x0800, 8);
  cdh.writeUInt16LE(8, 10);
  cdh.writeUInt16LE(DOS_TIME, 12);
  cdh.writeUInt16LE(DOS_DATE, 14);
  cdh.writeUInt32LE(crc, 16);
  cdh.writeUInt32LE(comp.length, 20);
  cdh.writeUInt32LE(data.length, 24);
  cdh.writeUInt16LE(nameBuf.length, 28);
  cdh.writeUInt32LE(offset, 42);     // local header offset
  central.push(Buffer.concat([cdh, nameBuf]));

  offset += lfh.length + nameBuf.length + comp.length;
}

const centralBuf = Buffer.concat(central);
const eocd = Buffer.alloc(22);
eocd.writeUInt32LE(0x06054b50, 0);
eocd.writeUInt16LE(files.length, 8);
eocd.writeUInt16LE(files.length, 10);
eocd.writeUInt32LE(centralBuf.length, 12);
eocd.writeUInt32LE(offset, 16);

const zip = Buffer.concat([...localParts, centralBuf, eocd]);
mkdirSync(join(root, "dist"), { recursive: true });
const outPath = join(root, "dist", `debait-extension-v${version}.zip`);
writeFileSync(outPath, zip);
console.log(`Packed ${files.length} files -> ${relative(root, outPath)} (${(zip.length / 1024).toFixed(1)} KB)`);
