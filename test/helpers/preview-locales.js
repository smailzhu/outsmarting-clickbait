import vm from "node:vm";
import { readFileSync } from "node:fs";

// Load the real runtime and escaping consumers; overrides only replace localized
// text, never esc or the rendering functions.
export async function loadPreviewLocale(page, lang, overrides = {}) {
  page.context.chrome.storage.sync.get = async () => ({ uiLang: lang });
  for (const file of ["messages.gen.js", "i18n-runtime.js"]) {
    vm.runInContext(readFileSync(new URL(`../../extension/${file}`, import.meta.url), "utf8"), page.context);
  }
  for (const [key, message] of Object.entries(overrides)) page.context.DebaitMessages[lang][key] = { message };
  await page.context.DebaitI18n.init();
  return page.context.DebaitI18n;
}
export const setupOnly = () => new Proxy({ setup_required: true }, {
  get(target, key) {
    if (key !== "setup_required") throw new Error(`setup branch read unexpected field ${String(key)}`);
    return target[key];
  },
});
export const maliciousSetup = {
  tipSetupHeading: '<img src="x" onerror="alert(1)"> "Heading" & <a href="https://injected.example">action</a>',
  tipSetupBody: '<svg onload="alert(2)"></svg> \'Body\' & <button onclick="alert(3)">settings</button>',
};
