# Custom / OpenAI-compatible — v0.3.0

Custom endpoints were introduced in the **v0.3.0 GitHub/source release** and are
included in **v0.4.0**. The public Chrome Web Store listing reports v0.4.0, verified
on **2026-11-28**. Edge Add-ons publication has not been verified. Future GitHub
releases still require separate store submission and approval; older installations
may need time to receive an update. Existing earlier releases remain unchanged.

## Explicit setup

- **Extension Settings:** choose **Custom / OpenAI-compatible**, fill in the API
  **base** URL (for example `http://localhost:8000/v1`) and the model ID. The API
  key is optional. Save, or use **Test connection** on the current unsaved fields.
- **CLI:** select `--backend custom` or `DEBAIT_PROVIDER=custom`; supply
  `DEBAIT_BASE_URL` and `DEBAIT_MODEL`. There is no default OpenAI endpoint/model.
- **Userscript:** choose `custom` in the provider menu, then set that provider's
  base URL, model and optional key. Read the environment restrictions below first.

```sh
# Example for a user-operated local, keyless Chat Completions server:
DEBAIT_BASE_URL=http://localhost:8000/v1 DEBAIT_MODEL=your-model \
  node src/cli.js --stdin --backend custom --json < examples/sample-clickbait.html

# Equivalent explicit environment selection:
DEBAIT_PROVIDER=custom DEBAIT_BASE_URL=http://localhost:8000/v1 \
  DEBAIT_MODEL=your-model node src/cli.js --stdin < examples/sample-clickbait.html
```

`CUSTOM_API_KEY` takes precedence over `DEBAIT_API_KEY`; both are optional. A
blank key sends **no Authorization header**. Neither variable selects custom by
itself. Native automatic key-selection order remains unchanged; an explicit
per-call/CLI backend wins, while automatic selection still checks
`DEBAIT_BACKEND=codex` before `DEBAIT_PROVIDER`.

**Model discovery is unsupported:** `debait --models custom` fails locally,
even without configuration. Custom completion and Test connection never call
`/models`. Ask your endpoint operator for a model ID.

## Endpoint trust and content transfer

The URL, title, description, extracted article text (up to 12,000 characters),
prompt and custom instructions go directly to the endpoint operator you choose.
Any configured key goes there too. There is no debait proxy/backend.

**Keyless remote HTTP is intentionally allowed, but sends article content and
prompts UNENCRYPTED. They can be observed or modified in transit. Keyless does
not mean private.** Use HTTPS where possible. Even HTTPS means trusting the
endpoint operator with article data and any key.

A configured key requires HTTPS except on parsed loopback hosts: exact
`localhost`, normalized IPv4 in `127.0.0.0/8`, or IPv6 `::1`, including ports.
`localhost.example`, `127.0.0.1.example` and other remote/non-loopback hosts are
not exceptions. Base URLs must be HTTP(S), without embedded credentials,
query parameters or fragments. Supply the API **base**, not a URL ending in
`/chat/completions`; trailing slashes are normalized. Base and model are required.

## Bounded compatibility

Custom sends one JSON `POST {base}/chat/completions` with system/user messages,
`model`, `temperature: 0.2`, and existing output controls (`max_tokens` for the
small connection test). It expects text at `choices[0].message.content` and,
for article analysis, the requested debait JSON object. The only supported
optional authentication is `Authorization: Bearer <key>`.

Some models reject temperature, token limits or these output controls. There
are **no automatic option retries**, Responses API conversion, nonstandard auth,
arbitrary headers/scripts, SDK loading or model discovery. A successful
connection test establishes only that a small completion returned text, not
that every article or model-specific feature will work. No live/paid provider
compatibility is claimed.

Custom requests omit cookies and reject redirects on the **initial** Fetch
request (including same-origin and 307/308 redirects). A single abort deadline
covers headers and the full body: 60 seconds for completions, 20 seconds for
Test connection. Errors show safe classifications/status, never upstream bodies,
raw exceptions, endpoint URLs or credentials. HTTP 429 remains a rate-limit
signal; preview cooldown uses a bounded 5-second to 5-minute delay (30 seconds
by default). There are no retries or hidden provider probes.

## Profiles, accounting and changing settings

Each provider owns its key/base/model profile. Existing native defaults and
saved settings migrate deterministically; existing or saved empty credentials
stay empty. Fresh custom settings do not borrow another provider's key/model/base.
Extension provider switching keeps outgoing unsaved fields in page-local state;
switching or testing does not save edits. Save persists all profiles and the
chosen active mirrors. Userscript menus persist the current provider's profile.

Developer note: options field markers derive from the same immutable baseline
and Save-normalized projection as dirty state (trimmed strings and rounded/default
numbers), not raw keystrokes or legacy mirrors. Visible credentials belong to the
current profile owner, which can differ from an empty select for a removed
provider. The generic other-provider note follows canonical dormant membership:
absent and authoritative-empty profiles differ, although native migration normally
fills every selectable profile and makes that structural edge unreachable.
Markers render locally without reads, writes or provider requests.

Every **preview** provider call reserves one durable usage unit before sending,
including keyless custom, Ollama, HTTP/network/timeout/parse failures and a sent call whose result becomes
stale. Invalid configuration or unavailable safe transport, cached answers,
thin articles, cap/throttle/cooldown and stale-before-reservation requests do not count. A settings change during an
awaited extension reservation cancels the send but conservatively consumes that
reserved unit (no refund/rollback). Failed reservation persistence blocks the
provider call. Usage represents preview attempts/reservations, not successful
responses.
Full-page analysis and Test connection remain outside the preview cap.
Key/profile/settings changes invalidate memory-only cache generations without
putting keys or secret-derived IDs in cache storage. Delayed old results are
discarded and loading UI is cleared; retry is explicit, never automatic.

## Userscript: supported isolated Fetch environment only

Custom is implemented for **Tampermonkey >=4.18 on Chromium with the DOM-isolated
sandbox explicitly enabled**, subject to the unverified browser checks below. The script declares `@sandbox DOM` and locally
reads `GM_info` to require Tampermonkey identity/version and
`GM_info.sandboxMode === "dom"`. Unknown/missing metadata, unsupported managers,
older versions, raw/js modes and unavailable native Fetch controls fail locally
before sending keys or article content. Required controls are checked with a
local Request/AbortController, without a network probe.

Custom uses captured isolated browser-native Fetch/Request/AbortController, not
`unsafeWindow`, page hooks or `GM_xmlhttpRequest`. **There is no GM/page-realm
fallback.** Native named-provider calls and preview article fetches still use
GM transport. The global DOM sandbox metadata change requires browser checks of
native GM calls and menus; VM regression coverage is not a browser guarantee.

**Custom endpoints must permit direct Fetch through CORS.** CORS-blocked endpoints
are incompatible with userscript custom even if the extension or CLI works.
`@connect *` does not bypass CORS for Fetch. Mixed-content, browser local-network
policy and other restrictions can also block requests. Use the extension/CLI or
a supported isolated environment and a CORS-compatible endpoint; no extra proxy
or permissions are provided to bypass restrictions.

## Manual compatibility checklist

Browser compatibility has **not** been validated by the automated code review.
Before relying on custom userscript endpoints, verify isolation, page-hook
exclusion, cookie omission, redirect-target zero requests, supported/unsupported
guidance, native GM/menu behavior, and CORS/mixed-content/local-network behavior
on your Chromium/Tampermonkey setup using local fixtures and dummy keys. The
CLI and extension transports have local-fixture and mocked test coverage;
live third-party model compatibility still depends on the endpoint. Taiwanese
translations remain draft pending native-speaker review.
