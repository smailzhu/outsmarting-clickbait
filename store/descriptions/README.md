# Store descriptions — copy/paste source

These plain-text files contain the complete detailed description. Copy their
contents (not the text of this README) into the store dashboard:

| Copy | File | Where to use it |
|------|------|-----------------|
| English | [en.txt](en.txt) | English detailed-description field |
| 繁體中文 | [zh-TW.txt](zh-TW.txt) | Chinese (Traditional) detailed-description field |
| 台語（漢羅）draft | [nan-Hanlo.txt](nan-Hanlo.txt) | Native-speaker review first; channels that support Taiwanese text |

On GitHub, open a file and select **Raw** to copy without Markdown formatting.
English and Traditional Chinese are the current store-listing languages. The
Taiwanese in-app interface uses a custom locale; it does **not** imply that the
Chrome Web Store dashboard provides a Taiwanese listing-language slot. Do not
replace a Traditional Chinese listing with Taiwanese text under the wrong locale.

The name, short summary, and other submission fields remain in
[../STORE_LISTING.md](../STORE_LISTING.md). These description files deliberately
avoid long provider-brand lists (the prior Yellow Argon keyword-spam finding).

These descriptions match the **v0.2.0** feature set.

All three descriptions include:
- The API-key/local-model requirement and possible provider fees.
- **Test connection** for unsaved settings: one small potentially billable request,
  without article content or custom instructions.
- Current-page analysis, deliberate **Alt+hover** preview, and **right-click link previews**.
- Closable loading/error/result panels that stay closed after late responses.
- Separate interface/output-language settings and custom instructions.
- Shared **preview-only** cache and usage controls; manual current-page analysis
  and connection tests are outside those controls.
- The 12,000-character extracted-text limit, preview fallback/errors, and AI accuracy caveats.
- The transmitted URL/title/meta description/text/instructions and Chrome Sync storage.

This is a **listing-text update only**: paste and save the revised descriptions
in the dashboard and follow its review/submission flow. It does not modify the
extension ZIP, bump its version, change repository visibility, or update a release.
Store approval is discretionary; revised copy is not a guarantee of approval.
