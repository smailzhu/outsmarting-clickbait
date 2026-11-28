# Hover activation — v0.4.0 behavior and remaining risks

This feature is included in the v0.4.0 GitHub release and the
[Chrome Web Store v0.4.0 listing](https://chromewebstore.google.com/detail/pcjbpicieggjfjldoekdeglnjhcdhjla?hl=en),
whose public version was verified on **2026-11-28**. Future GitHub publication
does not automatically update Chrome Web Store installations; updates require
separate submission and approval. The extension
supports Shift, Alt, and ordinary hover; the userscript retains its separate Alt behavior.

The owner authorized release with the documented remaining risks below after
confirming the main Shift checks on Windows/Edge. Test-package provenance remains
recorded separately; release publication is not a claim that every native check
has passed.

## Saved policy and local provenance

- Canonical sync `hoverActivation` accepts exactly `shift`, `alt`, `none`. A present
  malformed canonical resolves Shift, never none. Otherwise literal legacy
  `requireAltForHover: false` is none, any other present legacy value is Alt.
- With both preferences absent, local `hoverActivationProvenanceV1` fresh means
  Shift, existing means Alt, malformed present means Shift. Missing is UNKNOWN:
  automatic fallback stays disabled. Dwell must also be known (absent -> 500).
- First successful local classification uses raw own presence of either preference
  or exactly provider/profiles/keys/key/base/model/language/customInstructions/
  uiLang/previewDwellMs/previewMinIntervalMs/dailyCap. Empty/malformed values count;
  default-merged dictionaries and usage/unlisted UI metadata do not count.
- Options and worker share exclusive extension-origin Web Lock
  `debait-hover-provenance-v1`. Marker write completes and a fresh raw local read
  confirms presence before automatic provider migration persistence. Content never
  initializes provenance or acquires a webpage lock. No secrets copied or logged.
- This is LOCAL first-successful snapshot history, not global installation history.
  Fresh ignores later evidence-only writes, including automatic profile migration.
  Published 0.3.0 Save had **no legacy hover preference** (that field came from
  the v0.4.0 release). If its evidence-only sync arrives after fresh classification,
  mode stays Shift: explicitly choose Alt and Save to sync an authoritative preference.
- Another device/reinstall/local clear uses the then-visible snapshot: configuration
  visible -> existing; settled empty -> fresh. Sync clear keeps local fallback.
  Local removal invalidates its epoch and cached writer token, cancels fallback
  interests and locks Options; no automatic reinitialization/repair from events.
  Genuine subsequent Settings load/worker startup may initialize. Explicit known
  preferences remain independently authoritative in content. Full settled clear
  then initialization is fresh. Reload after destructive operations settle.
- Lock serializes participating new initializers, not remote sync, older builds or
  external clears. A clear during an already-invoked migration/Save is not atomic
  across areas; completed immutable Save is still authoritative, with Options locked
  for reload, not rolled back. No historical provenance recovery is promised.
- Missing locks, failed acquisition/read/write or invalidated epoch: worker skips
  ONLY persistent migration, memoizes the skip and continues manual analysis with
  existing in-memory provider normalization. Genuine provider/migration-write errors
  keep their original error envelopes. Options remains locked with localized reload
  guidance (all edits/Save/Discard/Test Connection), even with explicit canonical.
  Missing fallback disables auto-hover silently; manual/right-click remains available.
  Malformed present marker is preserved, passes the barrier and falls back Shift.
- Explicit Save writes canonical plus `requireAltForHover: mode !== "none"` in one
  existing payload, not the local marker. Older builds interpret Shift as Alt.
  Legacy-only changes cannot override canonical; deliberate canonical removal exposes
  current legacy/fallback. Load never writes activation preferences; permitted local
  metadata and existing four-field profile migration are separate load-time writes.

## Gestures, costs and cancellation

Hold Shift and **move physically over a link**. Shift keydown never starts, uses or
revives prior movement credit: resting-pointer Shift, typing/Shift+Tab/Arrow and
chords are not stationary activation at dwell 0 or 500. First positional sample is
baseline only; child/layout changes at equal screen coordinates are not new credit.

Alt retains only a trusted fresh up->down nonrepeat stationary route over a recorded
eligible link, with readable noneditable focus and no observed held shortcut,
Shift/Ctrl/Meta/AltGraph or composition/IME. Future keys cannot be predicted: a later
chord cancels before dispatch only if delivered before that timer/checkpoint; once
dispatched we claim withdrawal/no continued tooltip, not retroactive zero contact.
Movement in all modes remains selected-key-only, including mixed Alt+Shift/Ctrl/Meta.
None has no keyboard start and ignores incidental keyboard/editable-focus rules.

Observed trusted non-modifier/navigation/composition events cancel all Shift
interests and keyboard-origin Alt; other modifier chords cancel keyboard-origin
Alt only. Focus entering editable/uncertain context cancels those interests. Alt
keyboard rechecks focus at dwell/reply/observer; Shift movement has no standing
editable-focus veto, so later deliberate new movement is allowed without revival.
Ordinary readable element focus/blur is not window blur. Lifecycle loss resets both
modifiers/chord/composition state. Selected-key release cancels every hover stage;
unrelated release does not. No preventDefault/stopPropagation or focus movement.
Hover rather than click: Shift+click may open a new window; Alt release may expose
browser menus. Shift does not eliminate every OS/browser shortcut.

Hover without a modifier automatically contacts linked sites and sends extracted page text to
the chosen AI endpoint: quota/privacy/cost apply even at dwell 0. Cancellation only
withdraws that hover owner under existing queued IPC/dispatch semantics, not manual
owners of shared preparation. It cannot refund sites already contacted, sent work
or reservations. No scanning/preloading, transport/IPC/quota or provider-policy
changes. After non-activation settings/mirrors have settled, mode-only Save preserves
worker generation, successful URL cache timestamp/TTL, fetch/provider calls and
usage. First Save that normalizes key-map/provider fields may invalidate cache;
worker restart loses its in-memory cache. Neither case is exempted from existing
invalidation policy.

## Evidence and remaining verification

Parent primitive probe (not worker-generated): Chromium **159.0.8154.6**, Linux
under Xvfb, same secure `chrome-extension://` worker/Options origin. Both expose
Web Locks; worker-held lock blocked Options, then Options-held lock blocked worker,
and waiters acquired after release. Evidence `/tmp/debait-extension-weblocks-evidence.json`.
This proves supported Chromium primitives, **not physical Windows Edge 158** or
native Shift intent/OS behavior. Node VM source-runtime regressions prove logic
only. No browser install or paid API calls by this implementation worker.

The following is the full verification checklist. It is not an all-passed report.
The owner confirmed the main Shift checks on Windows with Microsoft Edge
158.0.4370.33 (Official build, 64-bit): physical Shift+movement previews, release
without browser-menu focus jump, no stationary Shift typing/navigation previews,
and expected cancellation. The exact Windows version and exhaustive mixed-focus
matrix were not supplied. The owner explicitly authorized v0.4.0 publication
with the incomplete checks and compatibility risks documented.

Additional evidence: 907 automated tests pass; a real Chromium 159/Xvfb run
passed 28 earlier preview checks, a focused Shift run passed 17 checks, and
three-locale setup feedback was verified to cause no article fetch, provider call,
or usage write. Chromium/CDP input is not physical Windows keyboard proof.

Remaining checks include:

- [ ] Shift hold + physical movement + release, first baseline and child traversal,
      stationary Shift alone/typing/Tab/Arrow at dwell **0 and 500**, zero requests.
- [ ] Shift/Ctrl/Meta/Alt mixed stationary chords never start Shift; deliberately
      mixed-modifier movement uses the selected key. Shift+click new-window caveat.
- [ ] Legacy fresh Alt stationary positive/release-repress, duplicate/repeat veto,
      editable/readonly/disabled/input/textarea/select/designMode/open-shadow and
      closed/iframe/uncertain focus veto, observed shortcuts/AltGraph/composition.
- [ ] Shift movement and Alt keyboard typing/focus transitions cancel dwell,
      connected and completed/error state; later deliberate Shift movement works;
      ordinary readable element focus/blur doesn't masquerade as window loss.
- [ ] None with neither/either/both modifiers, owned panel keys, right-click manual,
      pointerdown/click/contextmenu, text selection, scroll and foreground loss.
- [ ] Actual extension-origin Web Locks in BOTH native MV3 worker and Options,
      mutual exclusion both directions, startup/fresh migration before second tab.
- [ ] Inject barrier failure: Options edits/Save/Discard/Test stay locked with reload
      guidance; manual works in memory without profile/activation persistence;
      authoritative saved content preferences still work with known dwell.
- [ ] Marker removal/clear/load races: settled reload, no repair/auto-retry,
      preserved drafts, invoked Save completion remains baseline while locked.
- [ ] Saved mode-only edit preserves warm cache after baseline mirrors settle and
      cancels hover without losing a manual owner; record native IPC timing limits.

Only the Windows/Edge checks expressly reported by the owner are treated as
confirmed. Natural worker suspension, confirmed bfcache, injected storage/lock
failures in Windows Edge, full screen-reader/high-contrast/zoom and mixed-focus
coverage, other stable browser versions, and live AI compatibility remain
incompletely verified. Automated fixtures and local mocks cover logic and do not
replace those native checks.

Known limits: cancellation cannot undo already-contacted sites or dispatched AI
requests; a persisted reservation may consume a preview attempt even if later
canceled. Local provenance reflects the first visible configuration snapshot,
not global cross-device history. Locks cannot serialize older builds, remote sync
arrival or destructive external clears; initialization failure may leave Settings
locked and fallback hover disabled until reload, while manual analysis remains
available. Cache lives in worker memory. Shift+click may open a window; Alt can
activate browser menus. Taiwanese Han-Lo translations remain native-review drafts.

These remaining risks are disclosed rather than marked passed. The release owner
accepted proceeding with v0.4.0; future reports of failures should add focused
regression tests and a new versioned release, not mutate earlier release assets.
