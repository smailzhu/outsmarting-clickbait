# Packaging and publishing

## Current status: bundled CLI is outdated

**Do not rely on `npm run publish:cws` for current store submissions.**
`scripts/publish.mjs` still uses Chrome Web Store API V1 endpoints. Google's
[official V1 reference](https://developer.chrome.com/docs/webstore/api/v1)
states that support ended on **October 15, 2026**. The supported successor,
[Chrome Web Store API V2](https://developer.chrome.com/docs/webstore/api), already
exists and supports OAuth and service accounts.

The old script is retained for historical reference, not as a tested V2 client.
Migrating its endpoints, upload-processing checks and publish-status handling
requires a separately reviewed implementation. This documentation update does
not migrate the script or establish whether retired endpoints still respond.

## Publish using the dashboard

1. Run tests and build a release package:
   ```bash
   npm test
   npm run pack
   ```
2. Upload `dist/debait-extension-v<version>.zip` to the store dashboard.
3. Use the matching copy in [store/STORE_LISTING.md](store/STORE_LISTING.md) and
   [store/descriptions/](store/descriptions/). Review privacy declarations and
   real screenshots before submitting.
4. Submit for review. Creating a GitHub release does not publish to a store.

For an already-published extension, use a higher manifest version for a new
package. Preserve old GitHub tags and assets rather than replacing them.

## Prepare a new version

```bash
npm run release -- minor       # or patch, major, or an exact version
npm run release -- 0.5.0 --dry  # preview without changing files
```

The helper updates **package.json and extension/manifest.json**, synchronizes
shared code and builds the ZIP. It prints commit/tag/push/release commands; it
does not execute them.

**Userscript versioning is separate:** if you are releasing the userscript,
update its `// @version` header in `userscript/debait.user.js` before the release
commit. The helper does not update this header automatically. Check all intended
version fields and run tests after preparing a release.

## Future API automation

Follow Google's [V2 API documentation](https://developer.chrome.com/docs/webstore/api)
and [OAuth setup guidance](https://developer.chrome.com/docs/webstore/using-api).
Do not reuse the retired V1 endpoint examples from older instructions.
Keep client secrets, refresh tokens and service-account credentials out of source
control and public logs. Use private environment variables or CI secrets.

Any automated publication should be a separate explicit action, not a side effect
of routine pushes, test runs, or package builds. Never paste publishing credentials
into issue reports or public documentation.

## Other stores

Edge Add-ons uses Microsoft Partner Center and its own publication API. Test the
package in Edge and verify Microsoft's current listing/image requirements; Chrome
approval does not imply Edge approval.

Firefox AMO requires a separately compatible build and validation. This repo does
not currently establish a Firefox extension release; userscript support has its
own [manager and transport restrictions](userscript/README.md).
