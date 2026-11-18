import { test } from "node:test";
import assert from "node:assert/strict";
import { setupPanel } from "./helpers/panel-page.js";

const kinds = ["extension", "userscript"];
const event = { isTrusted: true, key: "Escape" };
const neutral = { uncertain: false, overlay: false, fullscreen: false, neutralFocus: true, panelPath: false, launcherFocus: false };
const eventVetoes = [{ isTrusted: false }, { isTrusted: undefined }, { key: "Enter" }, { repeat: true }, { defaultPrevented: true }, { isComposing: true }, { keyCode: 229 }, ...["altKey", "ctrlKey", "metaKey", "shiftKey"].map((k) => ({ [k]: true }))];
const activeKeys = (p) => p.window.listeners.get("keydown")?.size || 0;
const open = (p) => p.api.render("Reading", p.api.safeSourceUrl(p.context.location.href));
const panelPath = (p) => ({ composedPath: () => [p.content().closeButton, p.content(), p.hosts.get("debait-panel-host").shadowRoot, p.hosts.get("debait-panel-host"), p.document.body, p.document, p.window] });

for (const kind of kinds) {
  test(`${kind} actual pure Escape predicate: every event/context veto has priority`, () => {
    const p = setupPanel(kind, { full: true }), predicate = p.api.shouldClosePanelOnEscape;
    assert.equal(predicate(event, neutral), true);
    for (const patch of eventVetoes) assert.equal(predicate({ ...event, ...patch }, neutral), false);
    for (const eligible of ["panelPath", "neutralFocus", "launcherFocus"]) {
      const context = { ...neutral, neutralFocus: false, [eligible]: true };
      assert.equal(predicate(event, context), eligible !== "launcherFocus" || kind === "userscript");
      for (const veto of ["uncertain", "fullscreen", "overlay"]) assert.equal(predicate(event, { ...context, [veto]: true }), false);
    }
    assert.equal(predicate(event, { ...neutral, neutralFocus: false }), false); assert.equal(predicate(event, null), false);
  });

  test(`${kind} complete runtime event eligibility, no scans on unrelated keys and no interception`, () => {
    for (const patch of eventVetoes) {
      const p = setupPanel(kind, { full: true }); open(p);
      Object.defineProperty(p.document, "activeElement", { get() { throw new Error("should not read focus"); } });
      p.key(patch); assert.ok(p.content()); assert.equal(activeKeys(p), 1); p.close(); assert.equal(activeKeys(p), 0);
    }
    for (const patch of [{ composedPath: undefined }, { composedPath() { throw new Error("path"); } }, { composedPath: () => null }, { composedPath: () => [] }, { composedPath: () => [null] }, { composedPath: () => ["not a node"] }]) {
      const p = setupPanel(kind, { full: true }); open(p); p.key(patch); assert.ok(p.content());
    }
    const p = setupPanel(kind, { full: true }); open(p); p.key(); assert.equal(p.content(), undefined);
    const before = p.window.added.length; p.key(); assert.equal(p.window.added.length, before);
  });

  test(`${kind} actual runtime focus matrix only neutral/document/panel paths qualify`, () => {
    for (const focused of ["body", "root", "null", "panel", "nested-panel"]) {
      const p = setupPanel(kind, { full: true }); open(p);
      if (focused === "root") p.document.activeElement = p.document.documentElement;
      if (focused === "null") p.document.activeElement = null;
      if (focused === "panel" || focused === "nested-panel") {
        p.document.activeElement = p.hosts.get("debait-panel-host");
        p.document.activeElement.shadowRoot.activeElement = p.content().closeButton;
        if (focused === "nested-panel") {
          const nested = p.node("nested-control"), root = nested.attachShadow(); const input = p.node("input"); root.appendChild(input); root.activeElement = input;
          p.content().appendChild(nested); p.document.activeElement.shadowRoot.activeElement = nested;
        }
      }
      p.key(focused.includes("panel") ? panelPath(p) : {}); assert.equal(p.content(), undefined, focused);
    }
    for (const tag of ["button", "a", "div", "input", "textarea", "select", "contenteditable", "textbox", "searchbox", "combobox", "listbox", "menu", "menuitem", "grid", "tree", "slider"]) {
      const p = setupPanel(kind, { full: true }); open(p); const control = p.node(["contenteditable", "textbox", "searchbox", "combobox", "listbox", "menu", "menuitem", "grid", "tree", "slider"].includes(tag) ? "div" : tag);
      if (tag === "contenteditable") control.setAttribute("contenteditable", "true"); else control.setAttribute("role", tag);
      p.document.body.appendChild(control); p.document.activeElement = control; p.key(); assert.ok(p.content(), tag); assert.equal(control.focusCalls, 0);
    }
    for (const mode of ["open-editable", "closed", "cycle", "budget", "access", "shadow-access"]) {
      const p = setupPanel(kind, { full: true }); open(p); const control = p.node("page-widget"); p.document.body.appendChild(control); p.document.activeElement = control;
      if (mode === "access") Object.defineProperty(p.document, "activeElement", { get() { throw new Error("focus access"); } });
      else if (mode === "shadow-access") Object.defineProperty(control, "shadowRoot", { get() { throw new Error("shadow access"); } });
      else if (mode !== "closed") {
        const root = control.attachShadow(); root.activeElement = p.node("input");
        if (mode === "cycle") root.activeElement = control;
        if (mode === "budget") { let at = control; for (let i = 0; i < 100; i++) { const deep = p.node("open-widget"); at.attachShadow().activeElement = deep; at = deep; } at.attachShadow(); }
      }
      p.key(panelPath(p)); // uncertainty must veto even a panel path
      if (mode === "open-editable") { assert.equal(p.content(), undefined); }
      else assert.ok(p.content(), mode);
    }
  });

  test(`${kind} document/fullscreen/dialog/modal/popover/open-shadow veto neutral and panel paths`, () => {
    for (const path of [false, true]) for (const overlay of ["dialog", "modal", "stale-modal", "popover", "shadow-dialog", "fullscreen", "fullscreen-error", "unsupported-popover", "traversal-error", "cycle", "root-cycle", "node-budget", "root-budget"]) {
      const p = setupPanel(kind, { full: true }); open(p); const el = p.node("div"); p.document.body.appendChild(el);
      if (overlay === "dialog") { el.tagName = "DIALOG"; el.setAttribute("open", ""); }
      if (overlay === "modal" || overlay === "stale-modal") { el.setAttribute("aria-modal", "true"); if (overlay === "stale-modal") el.setAttribute("hidden", ""); }
      if (overlay === "popover") el.popoverOpen = true;
      if (overlay === "shadow-dialog") { const root = el.attachShadow(), dialog = p.node("dialog"); dialog.setAttribute("open", ""); root.appendChild(dialog); }
      if (overlay === "fullscreen") p.document.fullscreenElement = el;
      if (overlay === "fullscreen-error") Object.defineProperty(p.document, "fullscreenElement", { get() { throw new Error("fullscreen access"); } });
      if (overlay === "unsupported-popover") { const matches = el.matches; el.matches = (selector) => { if (selector === ":popover-open") throw new Error("unsupported selector"); return matches.call(el, selector); }; }
      if (overlay === "traversal-error") Object.defineProperty(el, "children", { get() { throw new Error("children access"); } });
      if (overlay === "cycle") el.children.push(el);
      if (overlay === "root-cycle") { const root = el.attachShadow(), child = p.node("div"); root.appendChild(child); child.shadowRoot = root; }
      if (overlay === "node-budget") for (let i = 0; i < 10000; i++) el.appendChild(p.node("div"));
      if (overlay === "root-budget") for (let i = 0; i < 100; i++) el.appendChild(p.node("div")).attachShadow();
      p.key(path ? panelPath(p) : {}); assert.ok(p.content(), `${path}/${overlay}`); p.close(); assert.equal(activeKeys(p), 0);
    }
    // The panel host/subtree is excluded before selectors are read.
    const p = setupPanel(kind, { full: true }); open(p); p.content().setAttribute("aria-modal", "true"); p.content().popoverOpen = true;
    p.key(panelPath(p)); assert.equal(p.content(), undefined);
  });

  test(`${kind} one bubble listener per owner; rerender/close/reopen/external removal/replacement detach`, () => {
    const p = setupPanel(kind, { full: true });
    const keyAdds = () => p.window.added.filter((e) => e.type === "keydown");
    const keyRemoves = () => p.window.removed.filter((e) => e.type === "keydown");
    assert.equal(activeKeys(p), 0); open(p); assert.equal(keyAdds().length, 1); assert.equal(keyAdds()[0].phase, false);
    for (let i = 0; i < 3; i++) open(p);
    assert.equal(keyAdds().length, 1); assert.equal(p.document.added.filter((e) => e.type === "keydown").length, 0);
    p.close(); p.api.closePanel(); assert.equal(activeKeys(p), 0); assert.equal(keyRemoves().length, 1);
    open(p); const removed = p.hosts.get("debait-panel-host"); removed.remove(); p.key(); assert.equal(activeKeys(p), 0); assert.equal(p.content(), undefined);
    open(p); p.hosts.get("debait-panel-host").remove(); open(p); assert.equal(activeKeys(p), 1);
    const owner = p.hosts.get("debait-panel-host"); owner.id = "externally-replaced";
    const replacement = p.node("div"); replacement.id = "debait-panel-host"; p.document.body.appendChild(replacement);
    p.key(); assert.equal(activeKeys(p), 0); assert.equal(replacement.isConnected, true);
    assert.equal(owner.isConnected, false, "Dropped panel owner must not leave an orphan");
    replacement.remove(); open(p); assert.equal(activeKeys(p), 1); p.api.closePanel(); assert.equal(activeKeys(p), 0);
    assert.equal(keyAdds().length, keyRemoves().length);
  });

  test(`${kind} replaced-owner close buttons dismiss only their own panel`, () => {
    const p = setupPanel(kind, { full: true }); open(p);
    const older = p.hosts.get("debait-panel-host"), oldClose = older.__content.closeButton;
    older.id = "old-owned-panel";
    const foreign = p.node("div"); foreign.id = "debait-panel-host"; p.document.body.appendChild(foreign);
    open(p);
    assert.equal(older.isConnected, false, "Rerender removes stale owned host");
    const newer = p.document.body.children.find((el) => el !== foreign && el.id === "debait-panel-host");
    assert.ok(newer?.isConnected);
    oldClose.click();
    assert.equal(newer.isConnected, true, "Old close handler does not dismiss current owner");
    newer.__content.closeButton.click();
    assert.equal(newer.isConnected, false);
    assert.equal(foreign.isConnected, true, "Never remove a page-owned element");
    assert.equal(activeKeys(p), 0);
  });

  test(`${kind} earlier document/window prevention wins; tooltip untouched; no focus changes`, () => {
    const p = setupPanel(kind, { full: true });
    p.window.addEventListener("keydown", (e) => { e.defaultPrevented = true; }, false);
    open(p); const tip = p.node("div"); tip.id = "debait-tooltip"; p.document.body.appendChild(tip);
    p.key(); assert.ok(p.content()); assert.equal(tip.isConnected, true);
    p.close(); assert.equal(tip.isConnected, true);
    const q = setupPanel(kind, { full: true }); q.document.addEventListener("keydown", (e) => { e.defaultPrevented = true; }); open(q); q.key(); assert.ok(q.content());
    assert.equal(p.document.body.focusCalls + p.document.documentElement.focusCalls, 0);
  });

  for (const error of [false, true]) test(`${kind} Escape during overlapping/loading requests suppresses late success/error (error=${error})`, async () => {
    const p = setupPanel(kind, { full: true }); const a = p.api.run(); await p.flush();
    p.context.location.href = "https://b.example/story"; const b = p.api.run(); await p.flush();
    p.key(); assert.equal(p.content(), undefined); assert.equal(activeKeys(p), 0);
    p.finish(1, error ? new Error("B late") : { honest_title: "B" }); await b;
    p.finish(0, error ? new Error("A late") : { honest_title: "A" }); await a;
    assert.equal(p.content(), undefined); assert.equal(activeKeys(p), 0); assert.equal(p.pending.length, 2);
  });
}

test("userscript identity-owned launcher only qualifies after every safety veto; spoofed ID never qualifies", () => {
  for (const mode of ["owned", "spoof", "guard", "fullscreen", "dialog", "modal", "popover", "shadow-dialog", "selector-error", "budget", "synthetic", "modifier", "composing", "path-error"]) {
    const p = setupPanel("userscript", { full: true, spoofLauncher: mode === "guard" }); open(p);
    let b = p.document.getElementById("debait-btn");
    if (mode === "spoof") { b = p.node("button"); b.id = "debait-btn"; p.document.body.appendChild(b); }
    p.document.activeElement = b;
    const overlay = p.node("div"); p.document.body.appendChild(overlay);
    if (mode === "fullscreen") p.document.fullscreenElement = overlay;
    if (mode === "dialog") { overlay.tagName = "DIALOG"; overlay.setAttribute("open", ""); }
    if (mode === "modal") overlay.setAttribute("aria-modal", "true");
    if (mode === "popover") overlay.popoverOpen = true;
    if (mode === "shadow-dialog") { const dialog = p.node("dialog"); dialog.setAttribute("open", ""); overlay.attachShadow().appendChild(dialog); }
    if (mode === "selector-error") overlay.matches = () => { throw new Error("selector"); };
    if (mode === "budget") for (let i = 0; i < 100; i++) overlay.appendChild(p.node("div")).attachShadow();
    p.key(mode === "synthetic" ? { isTrusted: false } : mode === "modifier" ? { shiftKey: true } : mode === "composing" ? { isComposing: true } : mode === "path-error" ? { composedPath() { throw new Error("path"); } } : {});
    assert.equal(!!p.content(), mode !== "owned", mode); assert.equal(b.focusCalls, 0);
  }
});

for (const kind of kinds) test(`${kind} exact root/node budgets allow completed boundary scans; Escape ignored for nested page editing without panel path`, () => {
  for (const budget of ["roots", "nodes"]) {
    const p = setupPanel(kind, { full: true }); open(p);
    // document + 99 open roots, or exactly 10,000 visited elements including
    // html/body/our skipped host/identity-owned userscript launcher.
    if (budget === "roots") for (let i = 0; i < 99; i++) p.document.body.appendChild(p.node("div")).attachShadow();
    else for (let i = 0; i < 10000 - (kind === "userscript" ? 4 : 3); i++) p.document.body.appendChild(p.node("div"));
    p.key(); assert.equal(p.content(), undefined, budget);
  }
  const p = setupPanel(kind, { full: true }); open(p);
  const widget = p.node("open-widget"); p.document.body.appendChild(widget); const inner = p.node("open-inner"), input = p.node("textarea");
  widget.attachShadow().appendChild(inner); inner.attachShadow().appendChild(input);
  widget.shadowRoot.activeElement = inner; inner.shadowRoot.activeElement = input; p.document.activeElement = widget;
  p.key({ composedPath: () => [input, inner.shadowRoot, inner, widget.shadowRoot, widget, p.document.body, p.document] });
  assert.ok(p.content());
});
