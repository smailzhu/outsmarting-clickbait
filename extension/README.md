# debait — Chromium extension (MV3)

> **New in v0.3.0 (GitHub/source release; store rollout is separate):** Custom / OpenAI-compatible
> requires an explicit base URL and model; key optional. Keyless remote HTTP
> sends article content and prompts **UNENCRYPTED**. Trust the endpoint operator.
> See the [custom setup, security and userscript compatibility guide](../docs/custom-provider.md).
> Userscript custom is limited to Tampermonkey ≥4.18 on Chromium with the
> DOM-isolated sandbox and CORS-compatible direct Fetch; no GM/page fallback.


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

## Settings changes (source / development builds)

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
`keys` entries. These changes are source/development behavior, not a claim of a
store rollout.

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

## Preview before you click (source / development builds)

New local state defaults to Shift hold-and-move; Settings can select Alt + hover
or Hover without a modifier after explicit Save. Eligible links show a tooltip
with an honest title, score, substance verdict, worth-clicking assessment and
summary before you open them.
Targets are fetched without executing their JavaScript. Unreadable, paywalled or
thin pages may show metadata or an error. Broad HTTP(S) host access is required
for target fetching. One AI preview at a time, a configurable interval (default
1.5 seconds), daily cap (default 200) and 429 cooldown protect AI quota, but do
not prevent every linked-site contact. Both cap and interval allow 0/unlimited.

## Hover consent and cancellation (v0.4.0)

This source feature is **extension-only**, not a store-rollout claim. Choose
**Shift + hover**, **Alt + hover**, or **Hover without a modifier** in Settings,
then **Save**. New local state without visible saved configuration starts Shift;
existing raw configuration visible at first initialization keeps Alt, and saved
legacy literal `false` keeps Hover without a modifier. Unsaved edits/failed Saves
never change content policy; Discard restores the loaded or successfully saved
selection.
The userscript remains separately **Alt+hover**; manual/right-click is independent.

Missing or invalid local AI configuration shows plain Settings guidance before
any target fetch, provider call or preview quota work; this transient outcome is
not cached. With **Hover without a modifier**, each otherwise eligible,
movement/dwell-qualified link hover may show the setup tooltip until configured.
There is no scanning, preloading, automatic Settings opening or linked-site
contact for this outcome. Keyless providers can pass local preflight and still
fail generically on hover when unreachable; saving settings does not validate a
key. The manual right-click link action shares the dismissible setup outcome.
The owner confirmed the main Shift checks on Windows/Edge, and three-locale
setup-tooltip layout passed in Chromium. Advanced lifecycle, failure-injection,
and assistive-technology coverage remain incomplete; see
[documented verification risks](../docs/hover-activation.md).

Hold Shift and **move physically over a link**. Pressing Shift alone NEVER starts
preview, even at dwell 0, while typing, or with a resting pointer. Alt alone can
start on a recorded stationary link only on a trusted fresh release/repress,
nonrepeat, with readable noneditable focus and no observed shortcut/composition.
Shift/Alt movement uses only the selected key (mixed modifiers remain allowed).
Observed typing/composition or focus entering editable/uncertain contexts cancels
Shift interests and keyboard-origin Alt, without reviving movement credit.
Deliberate subsequent new Shift movement can start again even in editable focus.
No key interception or focus movement: hover, do not click. **Shift+click may open
a new window**; Alt release can expose menus. Shift does not remove every OS shortcut.

Preferences resolve exact case-sensitive `hoverActivation: shift|alt|none` first;
any malformed present canonical value safely requires Shift, not Hover without a
modifier. Without
canonical, legacy `requireAltForHover` literal false means none; every other present
value means Alt. Explicit Save writes canonical plus the legacy mirror
`requireAltForHover: mode !== "none"` together. Older builds interpret saved Shift
as Alt. Legacy-only updates cannot override a present canonical preference.

Fallback uses **local first-successful snapshot provenance**, not global install
history. A non-secret, write-once local `hoverActivationProvenanceV1` marker is set
under an extension-origin exclusive Web Lock before Options/background automatic
four-field profile migration. Load can write this metadata and existing provider
migration, but NEVER either activation preference. Raw own saved preferences or
provider/profiles/keys/key/base/model/language/customInstructions/uiLang/dwell/
interval/cap classify existing regardless of emptiness; defaults/unrelated usage
are not evidence. Fresh stays Shift after automatic migration and later evidence-
only sync. In particular published **0.3.0 Save had no legacy hover preference**:
if its evidence-only configuration arrives AFTER this device classified fresh,
it stays Shift; choose Alt and Save explicitly to sync an authoritative preference.
Another device/reinstall/local clear classifies its then-visible snapshot anew.

Sync-only clear keeps local fallback. Local-only clear leaves explicit sync
preferences authoritative but missing fallback UNKNOWN; genuine Settings reload
or worker startup can classify again. Full clear with settled empty storage is
fresh. Marker removal cancels fallback hover and locks Options, without automatic
retry/revival/repair. Reload after storage operations settle; external clear during
an already-invoked migration/Save is not cross-area atomic or guaranteed safe.
Malformed present markers are preserved and require Shift. Missing Web Locks,
failed read/write/lock or invalidated epoch skips ONLY worker persistent migration;
manual/right-click/current-page analysis still uses existing in-memory provider
normalization. Options editing/Save/Discard/Test Connection stays disabled with
reload guidance. Automatic fallback hover stays silently disabled without known
provenance; explicit known preference plus known dwell can still work independently.
No polling, per-request retries, secret logging or fallback preference writes.

With **Hover without a modifier**, ordinary movement-qualified hover can contact
a linked site and send its URL, title, description and extracted text to your AI endpoint,
using quota and potentially costing money. Keep a comfortable dwell (500 ms is
the default): low dwell, including **0 ms**, can start as soon as eligible movement
rests on a link; 0 is not a cost/privacy bypass and still uses an async timer.
Fetching precedes AI throttle checks; unlimited limits cannot prevent all contacts.
This choice syncs to your sync profile and applies only after Save.

Hover requires a **visible, focused page**, known saved mode/dwell and trusted
input. First positional sample only establishes a screen-position baseline;
child/layout events at equal screen coordinates never start/restart a dwell.
Selected-key release cancels dwell, connected work and displayed success/error;
unrelated release does not. None ignores incidental modifier/typing/focus rules.
Lifecycle/settings changes consume movement credit and never auto-start/retry.
Move again, or use guarded fresh Alt in legacy mode. Browser-reported screen
movement is **not hardware-action attestation** or a prediction of future keys.

Moving away, changing/removing the link, scroll, pointerdown/contextmenu, blur,
hidden visibility and pagehide withdraw only that hover port's interest. The
worker aborts target preparation if its last owner leaves before AI dispatch;
another hover or manual owner of the same URL keeps shared work alive. It checks
interest after awaited preparation and before provider invocation. This is
**worker-observed cancellation**: a disconnect still in IPC transit can lose the
dispatch race. It cannot undo a linked-site contact, a sent AI request or cost.
Cancellation during a durable quota reservation can still consume one unit and
the interval slot even with no AI call; no rollback/refund is promised. After
dispatch, work continues: successful, nonstale results can be cached for 30 minutes
even after all hover owners leave, so a later same-configuration cache hit needs
no new target fetch, AI request or quota. Errors/stale/canceled-pre-dispatch jobs
are not cached; successful thin-fetch metadata stays free and cacheable.

No link scanning or preloading is added. One active hover observes subtree
removals and href changes during dwell, preparation and displayed results,
validating one captured anchor and relevant records. Document-wide mutation
observation can still cost CPU on busy pages. Native Chromium port lifetime,
service-worker suspension/reload, bfcache, layout-event behavior, accessibility
and physical Windows/Edge Shift/Alt behavior require browser checks; Node fixtures do not attest them.

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
- Preview works on **server-rendered** pages only; JS-rendered/paywalled targets
  fall back to the link's meta description.
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
