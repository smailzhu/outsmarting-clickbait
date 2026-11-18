import { test } from "node:test";
import assert from "node:assert/strict";
import { setupPanel } from "./helpers/panel-page.js";

function assertSource(p, raw, open = false) {
  const source = p.api.safeSourceUrl(raw), content = p.content();
  assert.equal(content.querySelectorAll(".source").length, source ? 1 : 0);
  assert.equal(content.querySelectorAll(".source-open").length, source && open ? 1 : 0);
  if (!source) return;
  assert.equal(content.querySelector(".source-host").textContent, `Source: ${source.host}`);
  assert.equal(content.querySelector(".source-host").getAttribute("title"), null);
  if (open) {
    const a = content.querySelector(".source-open");
    assert.equal(a.href, source.href); assert.equal(a.target, "_blank"); assert.equal(a.rel, "noopener noreferrer");
    assert.equal(a.textContent, "Open requested article");
    assert.equal(a.getAttribute("aria-label"), `Open requested article on ${source.host} (new tab)`);
    assert.equal(a.getAttribute("onclick"), null); assert.equal(a.getAttribute("title"), null);
  }
}
for (const kind of ["extension", "userscript"]) {
  test(`${kind} actual safeSourceUrl exact raw controls, lengths and canonical navigation contract`, () => {
    const { api } = setupPanel(kind, { full: true });
    for (const raw of ["https://example.com/story", "http://example.com:8080/story?q=1#part", "https://例子.台灣/path", "http://[::1]:8080/", 'https://example.com/a"<&?q="&<>#frag', "https://example.com/" + "a".repeat(2028)]) {
      const source = api.safeSourceUrl(raw), url = new URL(raw); assert.ok(source, raw);
      assert.ok(Object.isFrozen(source)); assert.equal(source.href, url.href); assert.equal(source.host, url.hostname);
    }
    for (const raw of [null, undefined, 1, {}, [], "", "/relative", "example.com", "javascript:alert(1)", "data:text/plain,x", "file:///tmp/a", "https://", "https://user:pass@example.com/story", "https://user@example.com/", "https://example.com/" + "a".repeat(2029)]) assert.equal(api.safeSourceUrl(raw), null, String(raw));
    // Test the real functions, not a copied regular expression. Includes parser stripping.
    for (const code of [...Array.from({ length: 32 }, (_, i) => i), ...Array.from({ length: 33 }, (_, i) => i + 127), 32, 160, 5760, ...Array.from({ length: 11 }, (_, i) => i + 8192), 8232, 8233, 8239, 8287, 12288, 65279]) {
      assert.equal(api.safeSourceUrl(`https://example.com/a${String.fromCharCode(code)}b`), null, `U+${code.toString(16)}`);
    }
  });

  test(`${kind} current-page states retain captured domain only across SPA await and hostile result fields`, async () => {
    for (const outcome of [{ honest_title: '<img src="x" onerror="x">', summary: "<script>bad</script>", url: "javascript:alert(1)" }, { parse_error: true, raw: "<bad>" }, null, new Error("<failure>")]) {
      const p = setupPanel(kind, { full: true }); const raw = p.context.location.href;
      const run = p.api.run(); await p.flush(); assertSource(p, raw);
      p.context.location.href = "https://changed.example/new?private=1"; p.finish(0, outcome); await run;
      assertSource(p, raw); assert.equal(p.content().querySelector("img"), null); assert.equal(p.content().querySelector("script"), null);
      assert.ok(!p.content().textContent.includes("changed.example"));
      if (kind === "extension") assert.equal(p.messages[0].article.url, raw);
      else assert.ok(p.pending[0].args[0].data.includes(raw));
    }
  });

  for (const oldError of [false, true]) test(`${kind} overlapping A/B sources: B wins and close suppresses both late responses (error=${oldError})`, async () => {
    for (const close of [false, true]) {
      const p = setupPanel(kind, { full: true });
      p.context.location.href = "https://a.example/story"; const a = p.api.run(); await p.flush();
      p.context.location.href = "https://b.example/story"; const b = p.api.run(); await p.flush(); assertSource(p, "https://b.example/story");
      if (close) p.close();
      p.finish(1, { honest_title: "B title" }); await b;
      p.finish(0, oldError ? new Error("A failure") : { honest_title: "A title" }); await a;
      if (close) assert.equal(p.content(), undefined);
      else { assertSource(p, "https://b.example/story"); assert.ok(p.content().innerHTML.includes("B title")); }
    }
  });

  test(`${kind} repeated render replaces source DOM rather than accumulating; null hides decoration only`, () => {
    const p = setupPanel(kind), raw = 'https://example.com/a"<&?q="&<>#frag', source = p.api.safeSourceUrl(raw);
    for (let i = 0; i < 4; i++) {
      p.api.render("loading", source, kind === "extension"); assertSource(p, raw, kind === "extension");
      p.api.renderResult({ originalTitle: "Title" }, { honest_title: "Result", url: "https://evil.example/" }, source, kind === "extension");
      assertSource(p, raw, kind === "extension"); assert.equal(p.content().querySelector(".source").children.length, kind === "extension" ? 2 : 1);
    }
    p.api.render("Result", null, true); assertSource(p, null); assert.equal(p.content().innerHTML.includes("Result"), true);
  });
}

test("extension actual runLink keeps exact preview gate/payload even when source decoration rejects input", async () => {
  for (const raw of ["https://example.com/story?q=1#part", "https://user:pass@example.com/story", "https://example.com/" + "a".repeat(2030), " https://example.com/story", "https://example.com/a b", "https://example.com/a\tb", "https://example.com/a\nb"]) {
    for (const result of [{ honest_title: "Result", url: "javascript:alert(1)" }, { stale: true }, { capped: true, used: 1, cap: 1 }, { rate_limited: true, retryIn: 5 }, { throttled: true }, { thin_fetch: true, description: "<meta>" }, { parse_error: true, raw: "<parse>" }, null, new Error("preview error")]) {
      const p = setupPanel("extension", { full: true }); const run = p.api.runLink(raw);
      assertSource(p, raw, true); await p.flush(); assert.equal(p.pending.length, 1);
      assert.deepEqual(JSON.parse(JSON.stringify(p.pending[0].args[0])), { type: "debait:preview", url: new URL(raw).href });
      if (result instanceof Error) p.finish(0, result); else p.finishPreview(0, result);
      await run; assertSource(p, raw, true);
    }
  }
  for (const raw of ["not a URL", "javascript:alert(1)", "file:///a"]) {
    const p = setupPanel("extension", { full: true }); await p.api.runLink(raw);
    assert.equal(p.pending.length, 0); assertSource(p, null); assert.ok(p.content().innerHTML.includes("errGeneric"));
  }
});

test("extension storage failure/missing completion response and preview missing response retain snapshot", async () => {
  for (const mode of ["storage", "complete", "preview"]) {
    const p = setupPanel("extension", { full: true });
    if (mode === "storage") p.context.chrome.storage.sync.get = async () => { throw new Error("storage failure"); };
    const raw = p.context.location.href, run = mode === "preview" ? p.api.runLink(raw) : p.api.run(); await p.flush();
    if (mode !== "storage") p.pending[0].resolve(undefined); await run; assertSource(p, raw, mode === "preview");
  }
});

test("userscript actual configuration changes/errors preserve original source but cannot overwrite/reopen", async () => {
  for (const lateError of [false, true]) {
    const p = setupPanel("userscript", { full: true }), raw = p.context.location.href;
    const run = p.api.run(); await p.flush(); p.store.language = "Changed";
    p.finish(0, lateError ? new Error("late") : { honest_title: "stale" }); await run;
    assertSource(p, raw); assert.ok(p.content().innerHTML.includes("Settings changed"));
  }
  const p = setupPanel("userscript", { full: true }); p.store.key_openai = ""; p.store.profiles.openai.key = "";
  await p.api.run(); assertSource(p, p.context.location.href); assert.equal(p.pending.length, 0);
});

for (const lang of ["en", "zh-TW", "nan"]) test(`userscript real ${lang} source/link locale parity`, () => {
  const p = setupPanel("userscript", { full: true, lang });
  for (const key of ["sourceLabel", "openRequestedArticle", "openRequestedArticleAria"]) {
    const text = p.api.t(key, "example.com"); assert.notEqual(text, key); assert.ok(text.trim()); assert.ok(!text.includes("$1"));
    if (key !== "openRequestedArticle") assert.ok(text.includes("example.com"));
  }
});

test("extension link A/B immutable requested sources survive late success/error and Escape dismissal", async () => {
  for (const close of [false, true]) for (const error of [false, true]) {
    const p = setupPanel("extension", { full: true });
    const a = p.api.runLink("https://a.example/article?original=1"); await p.flush();
    const b = p.api.runLink("https://b.example/article?original=2"); await p.flush();
    assertSource(p, "https://b.example/article?original=2", true);
    if (close) p.key();
    if (error && close) p.finish(1, new Error("B late")); else p.finishPreview(1, { honest_title: "B", url: "https://MODEL_KEY@evil.example/?secret=1" });
    await b;
    if (error) p.finish(0, new Error("A late")); else p.finishPreview(0, { honest_title: "A", url: "https://evil.example/" });
    await a;
    if (close) assert.equal(p.content(), undefined);
    else { assertSource(p, "https://b.example/article?original=2", true); assert.ok(!p.content().textContent.includes("evil.example")); }
    assert.equal(p.pending.length, 2);
  }
});

// Compare the actual userscript table via its runtime with source/generated
// extension translations, rather than merely checking nonempty strings.
test("panel locale values/placeholders match all three source and generated tables", async () => {
  const { readFileSync } = await import("node:fs"), { default: vm } = await import("node:vm");
  for (const [lang, native, path] of [["en", "en", "../extension/_locales/en/messages.json"], ["zh_TW", "zh-TW", "../extension/_locales/zh_TW/messages.json"], ["nan-Hanlo", "nan", "../locales-extra/nan-Hanlo/messages.json"]]) {
    const source = JSON.parse(readFileSync(new URL(path, import.meta.url), "utf8"));
    const context = vm.createContext({ chrome: { storage: { sync: { get: async () => ({ uiLang: lang }) } } } });
    for (const file of ["messages.gen.js", "i18n-runtime.js"]) vm.runInContext(readFileSync(new URL(`../extension/${file}`, import.meta.url), "utf8"), context);
    await context.DebaitI18n.init(); const p = setupPanel("userscript", { full: true, lang: native });
    for (const key of ["sourceLabel", "openRequestedArticle", "openRequestedArticleAria"]) {
      assert.equal(p.api.t(key, "example.com"), context.DebaitI18n.t(key, ["example.com"]));
      assert.equal(source[key].message.match(/\$\d/g)?.join() || "", key === "openRequestedArticle" ? "" : "$1");
    }
  }
});

test("userscript current-page renderer cannot acquire an article-link action even with openRequested true", () => {
  const p = setupPanel("userscript", { full: true });
  p.api.render("Result", p.api.safeSourceUrl("https://example.com/requested"), true);
  assertSource(p, "https://example.com/requested", false);
});

test("extension explicit source-anchor click creates navigation intent only; no automatic navigation or extra message", async () => {
  const p = setupPanel("extension", { full: true }), raw = "https://example.com/article?existing=token#section";
  const run = p.api.runLink(raw); await p.flush(); assert.equal(p.navigations.length, 0);
  p.content().querySelector(".source-open").click();
  assert.deepEqual(p.navigations, [{ href: raw, target: "_blank", rel: "noopener noreferrer" }]);
  assert.equal(p.pending.length, 1); assert.equal(p.writes.length, 0); assert.ok(p.content().innerHTML.includes("panelReading"));
  p.finishPreview(0, { honest_title: "Result", url: "javascript:MODEL_SECRET" }); await run;
  assert.equal(p.navigations.length, 1); assert.equal(p.pending.length, 1); assertSource(p, raw, true);
});
