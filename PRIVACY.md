# Privacy Policy — debait

_Last updated: 2026-11-27 · Applies to the v0.4.0 extension_

Publishing a GitHub release does not automatically update a store installation.
This policy describes v0.4.0, including its optional ordinary-hover mode.

## The short version

- There is **no developer-operated debait analysis server**. Analysis requests go
  directly from your browser to the AI endpoint you choose.
- The selected page's URL, title, meta description, extracted text, and your
  custom instructions are sent to that endpoint to provide the feature.
- Your key is used to authenticate with the configured endpoint. Keys and
  preferences use browser sync storage and may synchronize across your devices.
- Hover previews may run without a modifier **if you select that mode and Save**.
  A linked website may receive a request even when no AI request follows.

## What data is processed

| Data | Destination / storage | Purpose |
|------|-----------------------|---------|
| Selected page URL, title, meta description, and the first 12,000 characters of extracted page text; custom instructions and output-language preference | Your configured AI endpoint | Generate the title suggestion, summary and clickbait assessment |
| Your AI API key | Used in requests to your configured endpoint; stored in `chrome.storage.sync` | Authenticate with your chosen service; keyless endpoints may omit it |
| Provider-specific key/base URL/model profiles, interface and output language, custom instructions, hover activation mode, and usage limits | `chrome.storage.sync` | Remember the settings you save; your browser may synchronize them |
| Daily preview attempt/reservation date and count | `chrome.storage.local` on this device | Enforce the daily preview cap |
| `hoverActivationProvenanceV1`, a local `fresh`/`existing` installation-classification marker | `chrome.storage.local` on this device | Keep hover defaults stable during initialization and preserve visible legacy preferences |
| Preview results and in-flight request state | Temporary service-worker memory, with a 30-minute result-cache lifetime | Avoid duplicate analysis requests; cache may disappear on worker restart |

The installation marker contains no key, article content, account identity, or
browsing history. Classification reflects settings visible on this device at its
first successful initialization, not a global account history. Explicitly saved
hover preferences take precedence. See [hover behavior and migration limits](docs/hover-activation.md).

The extension does not maintain a complete list of visited pages, sell user data,
or send analysis data to the developer for analytics or advertising. It has no
analytics or telemetry pipeline. **Selected URLs and website content are still
transmitted to the chosen endpoint**; content you select can contain personal,
health, financial, or other sensitive information. Avoid analyzing sensitive
pages unless you trust the endpoint and its policies.

## When requests happen

### Page analysis and manual link previews

Clicking **Analyze this page** or **debait this page** analyzes the current page.
Right-clicking an HTTP/HTTPS link and selecting **debait this link** fetches and
analyzes its target without opening it. These are explicit user actions.
Manual link previews share hover-preview caching and usage controls; manual
current-page analysis does not use the preview cap or throttle.

### Configurable hover previews

In Settings, **Hover preview activation** offers:

- **Shift + hover:** the default for newly classified installations. Hold Shift
  and move the pointer over a link; pressing Shift alone does not start a preview.
- **Alt + hover:** an available alternative; visible legacy Alt preferences are
  preserved under the migration rules. A guarded fresh stationary Alt press may
  also start a preview.
- **Hover without a modifier:** ordinary movement-qualified hover can fetch a
  linked page and send its content to your AI endpoint after the configured delay,
  without a separate click or modifier press.

Selecting a mode does not apply it until **Save** succeeds. Unsaved edits and
failed Saves do not apply a new mode. The saved mode may synchronize through your
browser's sync service. Existing no-modifier preferences are preserved where
applicable; the default is not an assurance that every existing installation
requires a modifier.

Hover requires a visible, focused page and browser-trusted input, and does not
scan or preload all page links. Very short delays, including 0 ms, can trigger
requests quickly after eligible movement. A successful cached result can avoid
another target fetch, AI request, and quota reservation. Missing local provider
configuration shows setup guidance before target fetching or preview usage.
The extension does not use that check to certify that a supplied key is valid.

### Connection test

**Test connection** sends one small fixed prompt using the current, unsaved
provider/model/base URL/key. It sends no article content or custom instructions
and does not save those form values. It may use quota or incur charges and is
outside the daily preview cap. A successful test means the endpoint returned
text, not a guarantee of future access, quota, or accuracy.

### Other explicit links

Provider setup-help links open their static official destinations only when
clicked. **Open requested article** opens the originally requested URL only when
clicked; it does not certify the final redirected destination. Email/GitHub
support links act only on a click and open the relevant external application or
site; sending an issue or email then shares whatever you choose to include.

## Website access and cancellation

Broad host access (`https://*/*`, `http://*/*`) lets the content script detect the
configured gesture and display results, lets the worker retrieve requested link
targets, and lets it reach configured provider endpoints or local services.
Target preview fetches do not execute the target page's JavaScript and omit
browser credentials. Linked sites can receive normal network metadata, including
the request URL and source IP, even if preparation is canceled before AI dispatch.

Leaving a link, changing/removing it, losing foreground focus, or navigation can
withdraw a hover's interest. The worker stops pre-dispatch preparation when no
other interested hover or manual owner remains. Cancellation is observed through
browser messaging: it can lose a race with dispatch. **It cannot undo website
contact, an AI request already sent, or its cost.** Cancellation during a durable
usage reservation can still consume one preview attempt and interval slot. No
refund is promised. Successful nonstale results from already-dispatched requests
may remain in the temporary cache even after the hover is dismissed.

Request spacing, daily caps and quota-error cooldowns reduce AI usage but cannot
guarantee staying within provider limits or prevent every linked-site contact.
Limits set to 0 disable the corresponding limit. Native browser lifecycle,
shortcut, layout and assistive-technology behavior is not universally verified.

## Storage, sync, and endpoint trust

`chrome.storage.sync` is the browser extension storage API, **not a promise of
exclusively local storage**. With browser sync enabled, Chrome may use Google's
sync infrastructure; Edge may use Microsoft's. The developer does not operate
that infrastructure or receive the synced settings.

Custom / OpenAI-compatible endpoints require an explicit API base URL and model.
Keys are optional for keyless services. Trust the endpoint operator: it receives
the submitted content. **Keyless remote HTTP is unencrypted**, so article content
and prompts may be observed or modified in transit. Keyed custom endpoints require
HTTPS except for loopback addresses. The endpoint's own privacy policy, retention,
training practices and terms govern its processing; review them before use.

## Your controls

- Change, clear, and **Save** keys, profiles, instructions, languages, activation
  mode and usage limits in Settings.
- **Discard changes** restores this Settings page's last saved snapshot, not
  factory defaults or another device's newer settings. It makes no provider
  request, storage write, or refund of requests already sent.
- Browser extension site-access controls can restrict where the extension runs,
  potentially disabling previews or endpoint access.
- Remove the extension or use the browser's extension-storage controls to remove
  local extension data. Deletion does not recall content already sent to a site,
  provider, sync service, or support channel; their policies apply separately.

## Limited Use

The developer's use of data through debait is limited to the user-facing
summarization/clickbait-scoring feature, its configuration and connection testing,
and support the user explicitly requests. The developer does not sell this data
or use it for advertising, creditworthiness, lending, or unrelated purposes.
Transfers required for the feature go to the configured AI endpoint, requested
websites, and browser sync infrastructure as disclosed above. This policy states
compliance with the Chrome Web Store User Data Policy, including Limited Use
requirements; it is not a guarantee about third-party providers' downstream use.

## Contact

No GitHub account needed — email **cusp-preacher-blot [at] duck [dot] com**
(replace “[at]” with “@” and “[dot]” with “.”), or open an issue at
<https://github.com/smailzhu/outsmarting-clickbait/issues>.

Do not include API keys, private article content, or personal information you do
not want to share in support messages. Emails and GitHub issues are processed by
the relevant service and their privacy policies, rather than by an analysis
backend operated for this extension.
