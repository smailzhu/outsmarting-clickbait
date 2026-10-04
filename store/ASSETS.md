# Store assets — specs & checklist

All files live in `store/` unless noted. Specs chosen to pass Chrome Web Store
(and Edge Add-ons) image requirements.

| Asset | Required size | Format | File | Status |
|-------|---------------|--------|------|--------|
| **Store icon** | 128×128 | PNG, 32-bit, transparent padding; artwork ~96×96 centered (~16px safe margin); no self-added shadow | `store/store-icon-128.png` | ✅ ready |
| **Screenshot** (≥1, ≤5) | 1280×800 (preferred) or 640×400 | PNG/JPEG, 24-bit, **no alpha** | `store/screenshot-mockup-1280x800.png` | ⚠️ **mockup** — replace with a real browser capture |
| Small promo tile (required) | 440×280 | PNG/JPEG, no alpha | `store/promo-tile-440x280.png` | ✅ ready |
| Marquee promo tile (optional, for featuring) | 1400×560 | PNG/JPEG, no alpha | `store/promo-marquee-1400x560.png` | ✅ ready |
| Toolbar/extension icons | 16/32/48/128 | PNG | `extension/icons/icon*.png` | ✅ in manifest |

## Store icon vs toolbar icon
- **Toolbar/extension icons** (`extension/icons/`) are intentionally **full-bleed**
  so they stay legible at 16px.
- The **store icon** (`store/store-icon-128.png`) has the ~16px transparent safe
  margin the Web Store recommends so it isn't oversized next to other listings.

## Screenshots to capture (real browser, then crop/resize to 1280×800, flatten)
1. Result panel on a real clickbait article (honest title, score bar, summary).
2. Alt+hover link preview tooltip over a link in a feed.
3. Toolbar popup ("Analyze this page" + Settings).
4. Options page (provider dropdown, API key, output language, daily cap).
5. (optional) 繁體中文 UI, or a low-score vs high-score comparison.

Tips: use a genuine example page, keep personal data out of frame, export PNG
without alpha (flatten onto a solid background).

## Regenerate the icons/promo art
See the ImageMagick commands in the git history (commits adding
`extension/icons/` and `store/`), or ask to re-run them.
