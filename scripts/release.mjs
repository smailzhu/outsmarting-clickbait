// Prepare a release: keep the version in lockstep across package.json and the
// extension manifest, then build the upload zip — so the git tag, the manifest
// version, and the packaged asset never drift.
//
// Usage:
//   npm run release                 # bump patch (0.1.0 -> 0.1.1)
//   npm run release -- minor        # 0.1.0 -> 0.2.0
//   npm run release -- major        # 0.1.0 -> 1.0.0
//   npm run release -- 1.2.3        # set an exact version
//   npm run release -- 1.2.3 --dry  # show the plan, change nothing
//
// It does NOT commit/tag/push — it prints the exact commands for you to run.
import { readFileSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const pkgPath = join(root, "package.json");
const manifestPath = join(root, "extension", "manifest.json");

const args = process.argv.slice(2);
const dry = args.includes("--dry");
const spec = args.find((a) => a !== "--dry") || "patch";

// Chrome manifest versions are 1–4 dot-separated integers (0–65535). No semver
// pre-release suffixes allowed.
const VERSION_RE = /^\d{1,5}(\.\d{1,5}){0,3}$/;

function readJson(p) { return JSON.parse(readFileSync(p, "utf8")); }
function writeJson(p, obj) { writeFileSync(p, JSON.stringify(obj, null, 2) + "\n"); }

const pkg = readJson(pkgPath);
const manifest = readJson(manifestPath);
const current = pkg.version;

function bump(v, kind) {
  const parts = v.split(".").map((n) => parseInt(n, 10));
  while (parts.length < 3) parts.push(0);
  let [maj, min, pat] = parts;
  if (kind === "major") return `${maj + 1}.0.0`;
  if (kind === "minor") return `${maj}.${min + 1}.0`;
  if (kind === "patch") return `${maj}.${min}.${pat + 1}`;
  return null;
}

let next;
if (["patch", "minor", "major"].includes(spec)) next = bump(current, spec);
else if (VERSION_RE.test(spec)) next = spec;
else {
  console.error(`Invalid version "${spec}". Use patch|minor|major or X.Y.Z (dot-separated integers).`);
  process.exit(1);
}
if (!VERSION_RE.test(next)) { console.error(`Computed invalid version "${next}".`); process.exit(1); }
if (pkg.version !== manifest.version) {
  console.warn(`! package.json (${pkg.version}) and manifest (${manifest.version}) differ; both will be set to ${next}.`);
}

console.log(`debait release: ${current} -> ${next}${dry ? "  (dry run)" : ""}`);

if (dry) {
  console.log("Would update: package.json, extension/manifest.json");
  console.log("Would run:    npm run pack");
  process.exit(0);
}

// Warn (don't block) if there are unrelated uncommitted changes.
try {
  const dirty = execSync("git status --porcelain", { cwd: root }).toString().trim();
  if (dirty) console.warn("! Working tree has uncommitted changes; the version bump will be mixed in.\n" + dirty);
} catch { /* not a git repo / git missing — ignore */ }

pkg.version = next;
manifest.version = next;
writeJson(pkgPath, pkg);
writeJson(manifestPath, manifest);
console.log("Updated package.json + extension/manifest.json");

// Build the upload zip (pack re-syncs shared/ -> extension/ first).
execSync("node scripts/pack.mjs", { cwd: root, stdio: "inherit" });

const zip = `dist/debait-extension-v${next}.zip`;
console.log(`
Next steps (review, then run):

  git add package.json extension/manifest.json extension/
  git commit -m "release: v${next}"
  git tag v${next}
  git push origin HEAD --tags
  gh release create v${next} ${zip} -t "debait v${next}" -n "debait v${next}"
`);
