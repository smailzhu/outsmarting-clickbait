// Upload (and optionally publish) the extension to the Chrome Web Store via the
// official Web Store API. Dependency-free (Node 20+ fetch). Safe by default:
// uploads a new draft package; only publishes with --publish.
//
// NOTE: these Web Store API v1.1 endpoints are supported until 2026-10-15;
// plan to migrate when Google ships the successor.
//
// What it CANNOT do: edit the store listing text, screenshots, or privacy/
// permission disclosures — those are dashboard-only.
//
// One-time setup (do this yourself; the tokens are secrets):
//   1. In Google Cloud Console: create a project, enable "Chrome Web Store API".
//   2. Create an OAuth 2.0 Client ID (type: Desktop app). Note client id + secret.
//   3. Get a refresh token once (interactive consent) — see PUBLISHING.md.
//   4. Export the secrets as env vars and run this script. NEVER commit them.
//
// Env:
//   CWS_CLIENT_ID, CWS_CLIENT_SECRET, CWS_REFRESH_TOKEN   (required)
//   CWS_EXTENSION_ID   (default: this item's id)
//
// Usage:
//   npm run publish:cws            # upload the current dist zip as a draft
//   npm run publish:cws -- --publish   # upload AND submit for review/publish
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const doPublish = process.argv.includes("--publish");

const CLIENT_ID = process.env.CWS_CLIENT_ID;
const CLIENT_SECRET = process.env.CWS_CLIENT_SECRET;
const REFRESH_TOKEN = process.env.CWS_REFRESH_TOKEN;
const EXTENSION_ID = process.env.CWS_EXTENSION_ID || "pcjbpicieggjfjldoekdeglnjhcdhjla";

for (const [k, v] of [["CWS_CLIENT_ID", CLIENT_ID], ["CWS_CLIENT_SECRET", CLIENT_SECRET], ["CWS_REFRESH_TOKEN", REFRESH_TOKEN]]) {
  if (!v) { console.error(`Missing env ${k}. See PUBLISHING.md for the one-time setup.`); process.exit(1); }
}

const version = JSON.parse(readFileSync(join(root, "extension", "manifest.json"), "utf8")).version;
const zipPath = join(root, "dist", `debait-extension-v${version}.zip`);
if (!existsSync(zipPath)) { console.error(`Missing ${zipPath}. Run \`npm run pack\` first.`); process.exit(1); }

async function accessToken() {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: CLIENT_ID, client_secret: CLIENT_SECRET,
      refresh_token: REFRESH_TOKEN, grant_type: "refresh_token",
    }),
  });
  const data = await res.json();
  if (!res.ok || !data.access_token) throw new Error(`OAuth token error: ${JSON.stringify(data)}`);
  return data.access_token;
}

async function api(url, token, opts = {}) {
  const res = await fetch(url, {
    ...opts,
    headers: { authorization: `Bearer ${token}`, "x-goog-api-version": "2", ...(opts.headers || {}) },
  });
  const text = await res.text();
  let data; try { data = JSON.parse(text); } catch { data = { raw: text }; }
  if (!res.ok) throw new Error(`API ${res.status}: ${text.slice(0, 400)}`);
  return data;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));


(async () => {
  console.log(`debait publish: item ${EXTENSION_ID}, v${version}${doPublish ? " (upload + PUBLISH)" : " (upload draft only)"}`);
  const token = await accessToken();

  const zip = readFileSync(zipPath);
  console.log(`Uploading ${(zip.length / 1024).toFixed(1)} KB ...`);
  let up = await api(
    `https://www.googleapis.com/upload/chromewebstore/v1.1/items/${EXTENSION_ID}?uploadType=media`,
    token, { method: "PUT", body: zip });
  console.log("Upload state:", up.uploadState);
  // Processing can be async: poll the draft until it settles.
  for (let i = 0; i < 30 && up.uploadState === "IN_PROGRESS"; i++) {
    await sleep(2000);
    up = await api(`https://www.googleapis.com/chromewebstore/v1.1/items/${EXTENSION_ID}?projection=DRAFT`, token);
  }
  if (up.uploadState !== "SUCCESS") {
    console.error(`Upload not successful (${up.uploadState}):`, JSON.stringify(up.itemError || up));
    process.exit(1);
  }

  if (!doPublish) {
    console.log("Draft uploaded. Review it in the dashboard, then publish (or rerun with --publish).");
    return;
  }
  const pub = await api(
    `https://www.googleapis.com/chromewebstore/v1.1/items/${EXTENSION_ID}/publish`,
    token, { method: "POST", headers: { "content-length": "0" } });
  const status = Array.isArray(pub.status) ? pub.status : [];
  console.log("Publish status:", JSON.stringify(status), pub.statusDetail ? JSON.stringify(pub.statusDetail) : "");
  // "OK" (live) and "ITEM_PENDING_REVIEW" (submitted) are both success.
  if (!status.includes("OK") && !status.includes("ITEM_PENDING_REVIEW")) {
    console.error("Publish did not succeed.");
    process.exit(1);
  }
})().catch((e) => { console.error(e.message); process.exit(1); });
