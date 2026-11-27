import { test } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";

import { setupPanel as setup } from "./helpers/panel-page.js";
import { createWorker } from "./helpers/hover-worker.js";
import { loadPreviewLocale, setupOnly, maliciousSetup } from "./helpers/preview-locales.js";

test("extension: right-click link uses the preview path and displays a dismissible result", async () => {
  const page = setup("extension");
  const run = vm.runInContext('runLink("https://example.com/story")', page.context);
  await page.flush();
  assert.equal(page.pending.length, 1);
  assert.equal(page.pending[0].args[0].type, "debait:preview");
  assert.equal(page.pending[0].args[0].url, "https://example.com/story");
  page.finishPreview(0, { originalTitle: "Link title", honest_title: "Link substance", summary: "Summary", clickbait_score: 40 });
  await run;
  const html = page.content().innerHTML;
  assert.ok(html.includes("Link title"));
  assert.ok(html.includes("Link substance"));
  assert.equal((html.match(/class="x"/g) || []).length, 1);
  page.close();
  assert.equal(page.hosts.size, 0);
});

test("extension: link quota/fallback/error states all stay dismissible", async () => {
  for (const result of [
    { capped: true, used: 200, cap: 200 }, { rate_limited: true, retryIn: 30 },
    { throttled: true }, { stale: true }, { setup_required: true }, { thin_fetch: true, description: "<metadata>" },
    { parse_error: true, raw: "<invalid>" },
  ]) {
    const page = setup("extension");
    const run = vm.runInContext('runLink("https://example.com/story")', page.context);
    await page.flush();
    page.finishPreview(0, result);
    await run;
    assert.equal((page.content().innerHTML.match(/class="x"/g) || []).length, 1);
    assert.ok(!page.content().innerHTML.includes("<metadata>"));
    assert.ok(!page.content().innerHTML.includes("<invalid>"));
    page.close();
    assert.equal(page.hosts.size, 0);
  }
  const page = setup("extension");
  const run = vm.runInContext('runLink("https://example.com/story")', page.context);
  await page.flush();
  page.finish(0, new Error("API 429 <failure>"));
  await run;
  assert.ok(page.content().innerHTML.includes("API 429 &lt;failure&gt;"));
  page.close();
  assert.equal(page.hosts.size, 0);
});

test("extension: link dismissal suppresses late success and invalid URLs make no request", async () => {
  const page = setup("extension");
  const run = vm.runInContext('runLink("https://example.com/story")', page.context);
  await page.flush();
  page.close();
  page.finishPreview(0, { honest_title: "Too late" });
  await run;
  assert.equal(page.hosts.size, 0);
  await vm.runInContext('runLink("javascript:alert(1)")', page.context);
  assert.equal(page.pending.length, 1);
  assert.ok(page.content().innerHTML.includes("linkInvalid"));
});

for (const outcome of ["success", "error"]) {
  test(`userscript: settings change and late ${outcome} cannot reopen a dismissed panel`, async () => {
    const page = setup("userscript");
    let generation = 0;
    page.context.snapshot = () => ({ generation });
    page.context.stale = (s) => s.generation !== generation;
    const run = vm.runInContext("run()", page.context);
    await page.flush();
    page.close();
    generation++;
    page.finish(0, outcome === "error" ? new Error("late error") : { honest_title: "Late title" });
    await run;
    assert.equal(page.hosts.size, 0);
  });

  test(`userscript: settings change and late ${outcome} cannot overwrite a newer panel`, async () => {
    const page = setup("userscript");
    let generation = 0;
    page.context.snapshot = () => ({ generation });
    page.context.stale = (s) => s.generation !== generation;
    const older = vm.runInContext("run()", page.context);
    await page.flush();
    generation++;
    const newer = vm.runInContext("run()", page.context);
    await page.flush();
    page.finish(1, { honest_title: "Newer title" });
    await newer;
    page.finish(0, outcome === "error" ? new Error("late error") : { honest_title: "Older title" });
    await older;
    assert.ok(page.content().innerHTML.includes("Newer title"));
    assert.ok(!page.content().innerHTML.includes("errStale"));
  });
}

for (const kind of ["extension", "userscript"]) {
  test(`${kind}: loading, error, malformed output and successful panels all have one accessible close button`, async () => {
    const page = setup(kind);
    const run = vm.runInContext("run()", page.context);
    await page.flush();
    const assertClose = () => {
      const html = page.content().innerHTML;
      assert.equal((html.match(/class="x"/g) || []).length, 1);
      assert.ok(html.includes('<button type="button"'));
      assert.ok(html.includes('aria-label="Close &quot;panel&quot;"'));
      assert.equal(typeof page.content().closeButton.click, "function");
    };
    assertClose();
    page.finish(0, new Error('API 429 <bad>'));
    await run;
    assertClose();
    assert.ok(page.content().innerHTML.includes("API 429 &lt;bad&gt;"));
    page.close();
    assert.equal(page.hosts.size, 0);
    vm.runInContext('renderResult({originalTitle:"Title"}, {parse_error:true,raw:"bad"})', page.context);
    assertClose();
    vm.runInContext('renderResult({originalTitle:"Title"}, {honest_title:"Honest",summary:"Body",clickbait_score:10})', page.context);
    assertClose();
    page.close();
    assert.equal(page.hosts.size, 0);
  });

  for (const outcome of ["success", "error"]) {
    test(`${kind}: dismissed loading panel stays closed after a late ${outcome}`, async () => {
      const page = setup(kind);
      const run = vm.runInContext("run()", page.context);
      await page.flush();
      page.close();
      page.finish(0, outcome === "error" ? new Error("late error") : { honest_title: "Late title" });
      await run;
      assert.equal(page.hosts.size, 0);
    });
  }

  test(`${kind}: old request cannot overwrite a newer panel`, async () => {
    const page = setup(kind);
    const older = vm.runInContext("run()", page.context);
    await page.flush();
    const newer = vm.runInContext("run()", page.context);
    await page.flush();
    page.finish(1, { honest_title: "Newer title" });
    await newer;
    page.finish(0, { honest_title: "Older title" });
    await older;
    assert.ok(page.content().innerHTML.includes("Newer title"));
    assert.ok(!page.content().innerHTML.includes("Older title"));
  });
}

for (const lang of ["en", "zh_TW", "nan-Hanlo"]) test(`extension: setup ${lang} manual panel priority, real escaping and unchanged source action`, async () => {
  for (const overrides of [{}, maliciousSetup]) {
    const p = setup("extension", { full: true }); const i18n = await loadPreviewLocale(p, lang, overrides);
    const run = p.api.runLink("https://article.example/a"); await p.flush(); p.finishPreview(0, setupOnly()); await run;
    const content = p.content(), html = content.innerHTML;
    assert.ok(content.textContent.includes(i18n.t("tipSetupHeading"))); assert.ok(content.textContent.includes(i18n.t("tipSetupBody")));
    assert.ok(!html.includes("tipSetupHeading")); assert.ok(!html.includes("tipSetupBody"));
    assert.equal(content.querySelectorAll("button").length, 1); assert.equal(content.querySelectorAll("a").length, 1);
    for (const tag of ["img", "svg"]) assert.equal(content.querySelectorAll(tag).length, 0);
    assert.equal(content.querySelectorAll(".source").length, 1);
    const link = content.querySelector(".source-open"); assert.equal(link.href, "https://article.example/a");
    assert.equal(link.target, "_blank"); assert.equal(link.rel, "noopener noreferrer"); assert.equal(p.navigations.length, 0);
    if (overrides === maliciousSetup) { assert.ok(html.includes("&lt;img")); assert.ok(html.includes("&amp;")); }
    p.close(); assert.equal(p.hosts.size, 0);
  }
});
test("extension: worker no-fetch setup result reaches dismissible manual link panel", async () => {
  const worker = createWorker({ initial: { provider: "openai", profiles: { openai: { key: "" } } } });
  const page = setup("extension", { full: true }); const i18n = await loadPreviewLocale(page, "en");
  page.context.chrome.runtime.sendMessage = ({ type, url }) => { assert.equal(type, "debait:preview"); return worker.manual(url); };
  await page.api.runLink("https://article.example/a");
  assert.ok(page.content().textContent.includes(i18n.t("tipSetupBody"))); assert.equal(worker.fetchCalls.length, 0);
  assert.equal(worker.providerCalls.length, 0); assert.equal(worker.count(), 0); assert.equal(worker.inspect.CACHE.size, 0);
  page.close(); assert.equal(page.hosts.size, 0);
});
test("extension: late setup cannot reopen dismissed manual panel or overwrite newer result", async () => {
  const p = setup("extension", { full: true });
  const dismissed = p.api.runLink("https://article.example/a"); await p.flush(); p.close(); p.finishPreview(0, setupOnly()); await dismissed;
  assert.equal(p.hosts.size, 0);
  const old = p.api.runLink("https://article.example/a"); await p.flush(); const fresh = p.api.runLink("https://article.example/b"); await p.flush();
  p.finishPreview(2, { honest_title: "Fresh title" }); await fresh; p.finishPreview(1, setupOnly()); await old;
  assert.ok(p.content().innerHTML.includes("Fresh title")); assert.ok(!p.content().innerHTML.includes("tipSetupHeading"));
});
