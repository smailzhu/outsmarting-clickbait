# Publishing the extension from the CLI

> Uses the Chrome Web Store API **v1.1** (supported until 2026-10-15; migrate when Google ships the successor).

The Chrome Web Store has a **publishing API**, so you can upload a new package and
publish from the command line (or CI) with `scripts/publish.mjs` (dependency-free).

**What it automates:** uploading the packaged `.zip` and (optionally) submitting it
for publish.
**What it does NOT:** the listing text, screenshots, and privacy/permission
disclosures — those are editable only in the dashboard.

## One-time setup (you must do this; the tokens are secrets)

1. **Google Cloud Console** → create a project → **APIs & Services → Library** →
   enable **“Chrome Web Store API”**.
2. **APIs & Services → Credentials → Create credentials → OAuth client ID** →
   application type **Desktop app**. Note the **Client ID** and **Client secret**.
   (You may need to configure the OAuth consent screen and add yourself as a test
   user.)
3. **Get a refresh token once** (interactive consent). Use a **loopback redirect**
   (Google no longer supports the old `oob` flow). The redirect URI must be
   **identical** in the auth URL and the token exchange.
   - Open this URL in a browser (replace `CLIENT_ID`) and approve access:
     ```
     https://accounts.google.com/o/oauth2/auth?response_type=code&scope=https://www.googleapis.com/auth/chromewebstore&access_type=offline&prompt=consent&redirect_uri=http://localhost:8818&client_id=CLIENT_ID
     ```
     The browser will redirect to `http://localhost:8818/?code=...` (the page may
     fail to load — that's fine; copy the `code` value from the address bar).
   - Exchange the `code` for a refresh token (same `redirect_uri`):
     ```bash
     curl -s https://oauth2.googleapis.com/token \
       -d client_id=CLIENT_ID -d client_secret=CLIENT_SECRET \
       -d code=THE_CODE -d grant_type=authorization_code \
       -d redirect_uri=http://localhost:8818
     ```
   - Save the `refresh_token` from the response.

## Use it

```bash
export CWS_CLIENT_ID=...          # from step 2
export CWS_CLIENT_SECRET=...
export CWS_REFRESH_TOKEN=...      # from step 3
# CWS_EXTENSION_ID defaults to this item's id; override if needed.

npm run pack                      # build dist/debait-extension-v<version>.zip
npm run publish:cws               # upload as a DRAFT (safe default)
npm run publish:cws -- --publish  # upload AND submit for publish
```

## Security

- **Never commit** the client secret or refresh token. Use env vars locally, or
  encrypted **GitHub Actions secrets** in CI.
- The refresh token = long-lived access to publish this item. Treat it like a
  password; revoke it in Google Cloud if leaked.

## CI (optional)

You can publish on a tag by adding a workflow that runs `npm run pack` then
`npm run publish:cws` with the three `CWS_*` values stored as repo **Secrets**.
Keep it a separate, manually-triggered or tag-gated workflow so a routine push
never publishes.

## Other stores

Edge Add-ons and Firefox AMO have their own publishing APIs. A multi-store tool
like `PlasmoHQ/bpp` (Browser Platform Publisher) can target Chrome + Edge + Firefox
from one CI step if you later want that.
