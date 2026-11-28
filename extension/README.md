# debait — Chromium extension (MV3)

> **v0.4.0 is live on the [Chrome Web Store](https://chromewebstore.google.com/detail/pcjbpicieggjfjldoekdeglnjhcdhjla?hl=en) and GitHub.**
> Public store version verified **2026-11-28**; Edge Add-ons publication is unverified.
> Future releases require separate store submission. Custom endpoints require an
> explicit base URL/model; keys may be optional. Read the
> [custom endpoint security guide](../docs/custom-provider.md) before use.


Adds a toolbar button + right-click "debait this page" that reads the current
article and overlays an honest title, summary, key points, and a clickbait score.

## Install from the Chrome Web Store (recommended for Chrome)

Open [debait on the Chrome Web Store](https://chromewebstore.google.com/detail/pcjbpicieggjfjldoekdeglnjhcdhjla?hl=en)
and click **Add to Chrome**. Pin debait from the extensions menu, then open
**Options** to choose a provider and enter your own API key, or use a configured
local model. Store installation does not require Developer mode.

## Install manually (unpacked / development builds)

**Get the files** — either download **`debait-extension-v*.zip`** from the
[latest release](https://github.com/smailzhu/outsmarting-clickbait/releases/latest)
and unzip it, or clone the repo and use this `extension/` folder.

1. Open `chrome://extensions` (or `edge://extensions`, `brave://extensions`).
2. Enable **Developer mode**.
3. Click **Load unpacked** and select the folder containing `manifest.json`
   (the unzipped release folder, or this `extension/` folder).
4. Open the extension's **Options**, pick a **provider** (OpenAI, Anthropic,
   Gemini, Groq, OpenRouter, DeepSeek, xAI, Mistral, Together, NVIDIA, or local Ollama),
   enter its API key if required (optionally override base URL / model), and Save.
   For **Custom / OpenAI-compatible**, explicitly enter the API base URL and model;
   its key is optional. See [custom endpoint setup](../docs/custom-provider.md).
   Key/base/model profiles are remembered per provider, so you can switch freely.
5. Visit any article → click the toolbar icon or right-click → *debait this page*.

## Test your provider connection

In **Options**, select a provider and enter its key if required (local Ollama and
Custom / OpenAI-compatible endpoints may be keyless).
Click **Test connection** below the model field. It tests the **current form
values**, including unsaved base-URL/model overrides, without saving them.

The button sends **one small generation request** using the same provider API
format as analysis, with a bounded output budget, model-specific Gemini thinking
controls where supported, and a 20-second timeout. No
article content or custom instructions are sent. It may consume quota or incur
provider charges; connection tests are **not covered by the hover-preview daily
cap**. The button is disabled while a test is running.

A successful test means the selected model returned text; it does not guarantee
future quota, accurate summaries, or support for every model-specific feature.
Errors distinguish missing keys, authentication/access failures, quota/rate
limits, unavailable models/endpoints, empty responses, and network/timeouts.
If a thinking model exhausts the test's output budget before returning text,
that result is shown separately and does not establish that the key is invalid.
In particular, **429 does not necessarily mean the key is invalid**—check the
provider's billing credits and limits.

## Settings changes

Settings require explicit **Save**; there is no autosave. An unsaved-change
indicator and sticky Save/Discard bar help keep changes visible. At viewport
heights of 360px or less the bar scrolls normally instead, so it may not stay
visible. **Discard changes** restores this page's loaded or last successfully
persisted normalized settings, including all provider profiles and intentionally
empty credentials, not defaults or another tab/device's later writes. A failed
Save leaves the previous baseline authoritative; a successful write advances it.
Discard is available only with unsaved changes once loading finishes, and is
locked while saving. Save remains available even when the page is clean.

**Test connection is not Save**: a successful test reminds you to Save when the
tested connection differs from the saved active configuration. Save and Discard
are available during a Test; while saving, the form stays locked through the
display refresh. Discard makes no settings-storage reads/writes or API calls and
does not undo requests, costs or quota already incurred. It invalidates pending
Test feedback even for non-connection edits, without canceling the request; Test
stays busy until that request settles. Valid settled results remain if the
restored active connection tuple is unchanged; changed-tuple results are cleared.

With unsaved changes, leaving/reloading may trigger the browser's generic
confirmation. It requires user activation and is not guaranteed (for example on
crashes, forced termination or mobile). Confirming exit loses page-local edits;
use Discard to restore the saved baseline without leaving this page.
Mail/GitHub links may open another context without unloading Settings and may
not prompt. Closing during a pending write still risks losing unsaved work.

A write failure keeps changes on the page for another Save attempt (including
quota failures); a rejected write that partially applied remains conservatively
unsaved. A refresh warning means settings **already persisted**. Discard preserves
that warning and does not retry the secondary locale/usage display refresh.
Unsaved interface-language choices are not applied; Discard restores the selector
only. Usage is last-read information and stays untouched: after a failed refresh
it may show an older cap/count than the restored fields, and malformed initial
caps may display differently from the normalized fields (even as unlimited).
Reload reruns the existing display refresh against stored state, but does not
repair malformed stored inputs; correct those via Save. An unresolved
storage/refresh promise can leave the form locked.

Each page compares against its own loaded/saved baseline, not live sync: another
Options tab or synced device may overwrite settings, and full Save is
last-writer-wins, including dormant profiles. Clearing an authoritative profile
prevents legacy mirrors from restoring it, but does not erase dormant legacy
`keys` entries. Chrome Web Store v0.4.0 is confirmed live as of 2026-11-28;
future GitHub releases do not automatically update store installations.

## Right-click menu

- Right-click the page → **debait this page** to analyze the page already open.
- Right-click an HTTP/HTTPS link → **debait this link** to analyze its target
  **without opening it**. The result appears in the normal closable panel.

The link action reuses the hover-preview cache, minimum request interval, daily
cap, and 429 cooldown; cached answers require no additional AI request. It has
same limitations as hover previews: target JavaScript is not executed, and
unreadable/blocked targets may show metadata or an error instead.

Menu labels follow **Options → Interface language** (including 繁體中文 and the
台語 draft). No additional extension permissions are required. Restricted browser
pages such as `chrome://` cannot display the panel. The native menu integration
is for the extension; it is not a Tampermonkey feature.

## Preview before you click

New local state defaults to Shift hold-and-move; Settings can select Alt + hover
or Hover without a modifier after explicit Save. Eligible links show a tooltip
with an honest title, score, substance verdict, worth-clicking assessment and
summary before you open them.
Targets are fetched without executing their JavaScript. Unreadable, paywalled or
thin pages may show metadata or an error. Broad HTTP(S) host access is required
for target fetching. One AI preview at a time, a configurable interval (default
1.5 seconds), daily cap (default 200) and 429 cooldown reduce AI requests, but do
not prevent every linked-site contact. Both cap and interval allow 0/unlimited.

## Hover settings and cancellation (v0.4.0)

Choose **Shift + hover**, **Alt + hover**, or **Hover without a modifier**, then
Save. Shift requires pointer movement; its keydown alone never starts a preview.
Ordinary hover can transmit content and consume quota without another click.
Unsaved/failed changes do not apply. The first positional event may establish a
baseline; move again if an initial hover does not start. The page must be visible
and focused. Shift+click can open a window and Alt can activate browser menus.

Leaving, scrolling, changing/removing a link or losing foreground focus withdraws
that hover's interest. Shared work continues if another hover/manual owner needs
it. Cancellation races with dispatch: it cannot undo linked-site contact, AI
requests already sent, costs or committed usage reservations. Successful nonstale
results may be cached for 30 minutes in worker memory, including after dismissal.

Missing local configuration shows setup guidance before site/provider/quota work.
A saved key isn't necessarily valid—use Test connection, with the caveats above.

For exact default migration, local metadata, cancellation ownership and validation
limits, see [docs/hover-activation.md](../docs/hover-activation.md). Existing visible
settings may preserve Alt/none rather than adopting Shift. Browser lifecycle,
assistive technology and every live endpoint have not been exhaustively verified.
This feature is extension-only; the userscript's Alt behavior is separate.

## How it works

```
content.js     — extract current page (DOM), overlay panel, saved-mode hover tooltip
prompt.js      — shared prompt/parse for content script (globalThis.DebaitPrompt)
prompt.esm.js  — same logic as an ES module for the service worker (synced)
extract.js     — pure HTML→text extractor for the worker (synced; no DOM needed)
providers.js   — multi-provider request builder (synced from ../shared)
background.js  — settings, CORS-free API call, + link preview (fetch+extract+cache)
popup/options  — trigger + provider/key settings (chrome.storage.sync)
```

Synced files come from `../shared/*` via `npm run sync` — edit the shared copy, not these.

`host_permissions` is `https://*/*` + `http://*/*` — required so the content
script can run on any page (hover detection + overlay) and the background
worker can fetch the target of a hovered link and reach any provider API /
local Ollama. Only `storage` and `contextMenus` API permissions are requested.

Content scripts can't call arbitrary APIs (page CORS), so the actual LLM request
runs in the background service worker, which has `host_permissions`.

## Limitations

- Analyzes the **current** page's DOM, plus **link previews** of individual
  linked targets (see above). Auto-annotating *every* link in a feed is out of
  scope — one LLM call per link (cost + rate limits); a caching backend proxy
  would be the way to do that.
- Preview fetches do not execute target JavaScript. Dynamic/paywalled pages may
  be unreadable. Text under 200 characters produces target metadata/title
  instead of an AI assessment; HTTP or network failures show errors.
- Most hosted named providers need your own API key; article text is sent only to the provider you configure.
  Keys are stored in `chrome.storage.sync` (synced to your browser profile).
- Branded icons are bundled in `extension/icons/` and declared in the manifest.

## Packaging for distribution

Branded icons live in `extension/icons/` and are declared in the manifest
(`icons` + `action.default_icon`). To build a publishable zip:

```bash
npm run pack   # -> dist/debait-extension-v<version>.zip
```

`pack` re-syncs the shared modules first, then writes a dependency-free zip
(Node `zlib`). Load it unpacked for testing, or upload the zip to the Chrome Web
Store / Edge Add-ons.

See [publishing/version instructions](../PUBLISHING.md). The bundled V1 upload CLI
is outdated; package generation still works, but store submission should use the
dashboard until the V2 client is implemented and reviewed.
