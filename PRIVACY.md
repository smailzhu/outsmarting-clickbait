# Privacy Policy — debait

> **New in v0.3.0 (GitHub/source release; store rollout is separate):** Custom / OpenAI-compatible
> requires an explicit base URL and model; key optional. Keyless remote HTTP
> sends article content and prompts **UNENCRYPTED**. Trust the endpoint operator.
> See the [custom setup, security and userscript compatibility guide](docs/custom-provider.md).
> Userscript custom is limited to Tampermonkey ≥4.18 on Chromium with the
> DOM-isolated sandbox and CORS-compatible direct Fetch; no GM/page fallback.


_Last updated: 2026_

**debait** ("the extension") is an open-source tool that summarizes web articles
and rates how clickbait-y they are. This policy explains what it does and does
not do with your data.

## The short version

- There is **no debait server**. The developer operates no backend and receives
  **no data** from you whatsoever.
- The extension sends page text **only to the AI provider you choose and
  configure** (with a key where required; custom endpoints can be keyless).
- Your API key and settings are stored by your browser via `chrome.storage.sync`,
  which may sync them across your own signed-in Chrome profile (Google
  infrastructure). They are never sent to the developer.

## What data is processed

| Data | Where it goes | Why |
|------|---------------|-----|
| The **URL**, **title**, **meta description**, and **visible text** (capped at ~12,000 characters) of a page you **debait** or **link preview** | Sent directly from your browser to the **AI provider you configured** | So the model can summarize it and rate clickbait |
| Your **API key**, chosen **provider/model/language**, **hover preference**, and **limits** | Stored in `chrome.storage.sync` (your browser; may sync across your own signed-in browsers) | To call the provider on your behalf and remember preferences |
| A per-day **attempt/reservation count** for previews | Stored in `chrome.storage.local` (your device) | To enforce your daily cap |

The extension does **not** collect, transmit, sell, or share: browsing history,
personal identifiers, analytics, telemetry, or any data to the developer or any
third party for analytics. Link previews contact the selected linked site and
send extracted page content only to the AI endpoint you configure; the browser
may sync settings through its own infrastructure as described above.

## When network requests happen

- A request to an **AI provider** happens only when you click **Analyze this
  page**, use the **debait this page** context menu, hover a link (Alt required
  by default; optional after explicit Save), or click
  **Test connection** in Settings. You can also explicitly right-click an
  HTTP/HTTPS link and choose **debait this link**; this uses the same target-fetch
  and AI-preview flow as hover preview, with the same preview usage controls.
- **Test connection** uses the currently entered provider, model, API base URL,
  and key without saving them. It sends one small fixed test prompt—not article
  content or custom instructions—to that endpoint and uses the key to authenticate.
  It may consume provider quota or incur a usage charge. Tests are not included
  in the daily hover-preview cap.
- To preview a link, the extension fetches **that link's target page** (the same
  page you were about to click). This uses broad host access
  (`https://*/*`, `http://*/*`) solely to retrieve the page you asked about; no
  page-wide link scanning or preloading is performed. The linked site can receive
  ordinary request/network metadata even if no AI request follows.

## Hover consent and cancellation (source / development builds)

This source feature is **extension-only**, not a claim of store rollout. In
Settings, **Require Alt for hover previews (default)** starts checked; only a
saved literal `false` turns it off. Edit the checkbox and press **Save** to apply
it. Loading, unsaved edits and failed Saves do not change the saved preference.
It syncs to other browsers signed into the same sync profile. The userscript's
native Alt hover and menu remain unchanged; right-click **debait this link**
remains an independent manual panel action with the same cache and usage limits.

With the checkbox off, ordinary movement-qualified hover can contact a linked
site and send its URL, title, description and extracted text to your AI endpoint,
using quota and potentially costing money. Keep a comfortable dwell (500 ms is
the default): low dwell, including **0 ms**, can start a preview as soon as the
pointer rests on a link. Zero still uses an asynchronous timer, not a hidden
minimum. Linked-site fetching occurs before the existing AI throttle checks;
limits can be set to 0 (unlimited), and cannot prevent all site contacts.

Hover requires a **visible, focused page** and browser-trusted input. First entry
at cold start or after focus restoration only establishes a screen-position
baseline; further physical movement may be needed. In required mode, a fresh
nonrepeat Alt keydown on an eligible stationary link also starts one dwell.
Child transitions do not restart it. Alt release cancels required-mode hover,
not off-mode hover. After scroll, click/right-click, DOM cancellation or a saved
hover-preference change, move the pointer again for automatic hover, or press
Alt freshly in required mode. Lifecycle/settings changes never auto-retry.
Equal browser-reported screen coordinates cannot start another automatic dwell,
even if client coordinates or the link beneath the pointer change. Off mode still
trusts browser boundary events after changed screen coordinates; this is **not
hardware-action attestation**, and trusted events alone are not proof of intent.

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
and OS Alt behavior require browser checks; Node fixtures do not attest them.

## Your controls

- Set, change, or remove your API key anytime in the extension **Options**.
- Set a **daily cap** (including `0` = unlimited) and rate limits in Options.
- Remove the extension to delete all stored settings.

## Limited Use

debait's use of information received from its features complies with the Chrome
Web Store **Limited Use** requirements: data is used only to provide the
user-facing summarization/clickbait-scoring feature, is transferred only to the
AI provider the user configures (never to the developer), is never sold, and is
never used for advertising, creditworthiness, or any unrelated purpose.

## Third-party providers

When you configure a provider, your use of that provider is governed by **its**
privacy policy and terms. Review the policy of whichever provider you enable.

## Contact

No GitHub account needed — email the author at **cusp-preacher-blot [at] duck [dot] com**
(replace “[at]” with “@” and “[dot]” with “.”). You can also open an issue at
<https://github.com/smailzhu/outsmarting-clickbait/issues>.
