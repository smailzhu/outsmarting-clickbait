import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

// Small DOM double exercising the real panel rendering and async run functions
// without installing a DOM/browser dependency. Browser layout is not simulated.
function setup(kind) {
  const hosts = new Map();
  const label = 'Close "panel"';
  const document = {
    getElementById: (id) => hosts.get(id),
    createElement: () => ({
      style: {}, className: "", innerHTML: "",
      attachShadow() {
        const root = {
          host: this, children: [],
          append(...children) { for (const child of children) { child.root = this; this.children.push(child); } },
          querySelector() {
            const content = this.children.find((el) => el.className === "wrap");
            return content?.innerHTML.includes('class="x"') ? content.closeButton : undefined;
          },
        };
        this.shadowRoot = root;
        return root;
      },
      getRootNode() { return this.root; },
      closeButton: { addEventListener(_event, handler) { this.click = handler; } },
      remove() { hosts.delete(this.id); },
    }),
    body: { appendChild(host) { hosts.set(host.id, host); } },
  };
  const pending = [];
  const request = (...args) => new Promise((resolve, reject) => pending.push({ resolve, reject, args }));
  const context = vm.createContext({
    document, URL,
    t: (key) => key === "closeTitle" ? label : key,
    verdict: (value) => value,
    extractPage: () => ({ text: "body", originalTitle: "Original" }),
    buildPrompt: () => "prompt", callProvider: request,
    parseResult: JSON.parse, CFG: {},
    DebaitI18n: { init: async () => {}, t: (key) => key === "closeTitle" ? label : key, verdict: (v) => v },
    DebaitPrompt: { buildPrompt: () => "prompt", parseResult: JSON.parse },
    chrome: { storage: { sync: { get: async () => ({}) } }, runtime: { sendMessage: request } },
  });
  const source = readFileSync(new URL(kind === "extension" ? "../extension/content.js" : "../userscript/debait.user.js", import.meta.url), "utf8");
  const start = source.indexOf('const PANEL_ID = "debait-panel-host";');
  const end = kind === "extension" ? source.indexOf("chrome.runtime.onMessage.addListener", start) :
    source.indexOf("// ---- Alt+hover link preview", start);
  assert.ok(start >= 0 && end > start);
  vm.runInContext(source.slice(start, end), context);
  const content = () => hosts.get("debait-panel-host")?.__content;
  const close = () => content().closeButton.click();
  const finish = (index, result) => {
    if (result instanceof Error) pending[index].reject(result);
    else pending[index].resolve(kind === "extension" ? { ok: true, text: JSON.stringify(result) } : JSON.stringify(result));
  };
  const finishPreview = (index, result) => pending[index].resolve({ ok: true, result });
  return { context, hosts, pending, content, close, finish, finishPreview, flush: () => new Promise((r) => setImmediate(r)) };
}

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
    { throttled: true }, { thin_fetch: true, description: "<metadata>" },
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
