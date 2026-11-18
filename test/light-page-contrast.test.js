import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

function declarations(source) {
  return Object.fromEntries(source.split(";").filter((part) => part.trim()).map((part) => {
    const colon = part.indexOf(":");
    assert.ok(colon > 0, `Expected CSS declaration: ${part}`);
    return [part.slice(0, colon).trim(), part.slice(colon + 1).trim()];
  }));
}

function pageStyles(file) {
  const html = readFileSync(new URL(`../extension/${file}`, import.meta.url), "utf8");
  const css = html.match(/<style>([\s\S]*?)<\/style>/)?.[1];
  assert.ok(css, `${file} stylesheet exists`);
  // These small embedded stylesheets use flat declarations (including inside media rules).
  const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((match) => ({
    selector: match[1].trim(), properties: declarations(match[2]),
  }));
  const inline = [...html.matchAll(/<[^>]+\bstyle="([^"]*)"[^>]*>/g)].map((match) => ({
    tag: match[0], properties: declarations(match[1]),
  }));
  return {
    html, css, rules, inline,
    rule(selector) {
      const matches = rules.filter((rule) => rule.selector === selector);
      assert.ok(matches.length > 0, `${file}: ${selector} rule exists`);
      // The short-height media rules repeat Save bar geometry, not its palette.
      return Object.assign({}, ...matches.map((rule) => rule.properties));
    },
  };
}

function luminance(color) {
  assert.match(color, /^#(?:[\da-f]{3}|[\da-f]{6})$/i, "Expected actual opaque hex color");
  const hex = color.length === 4 ? [...color.slice(1)].map((digit) => digit.repeat(2)).join("") : color.slice(1);
  const [r, g, b] = hex.match(/../g).map((part) => parseInt(part, 16) / 255)
    .map((value) => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(foreground, background, minimum, label) {
  const a = luminance(foreground), b = luminance(background);
  const ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
  assert.ok(ratio >= minimum, `${label}: ${foreground} on ${background} = ${ratio.toFixed(3)}:1; needs ${minimum}:1`);
}

function borderColor(border) {
  assert.match(border, /^1px solid #[\da-f]{3,6}$/i, "Keep existing field/border geometry");
  return border.split(/\s+/).at(-1);
}

const options = pageStyles("options.html");
const popup = pageStyles("popup.html");

for (const [name, page] of [["options.html", options], ["popup.html", popup]]) {
  test(`${name} actual CSS defines the light surface and AA normal text/link colors`, () => {
    const body = page.rule("body"), link = page.rule("a");
    assert.equal(body.background, "#fff");
    assert.equal(body.color, "#111");
    assert.equal(link.color, "#0969da");
    contrast(body.color, body.background, 4.5, `${name} normal text`);
    contrast(link.color, body.background, 4.5, `${name} links`);
  });

  test(`${name} actual button palette, native focus, link underlines and forced colors stay unchanged`, () => {
    const button = page.rule("button");
    assert.equal(button.background, "#58a6ff");
    assert.equal(button.color, "#001");
    contrast(button.color, button.background, 4.5, `${name} enabled button text`);
    for (const { properties } of [...page.rules, ...page.inline]) {
      for (const property of Object.keys(properties)) {
        assert.doesNotMatch(property, /^(?:outline(?:-.*)?|text-decoration(?:-.*)?|forced-color-adjust|color-scheme)$/,
          `${name} must not override native focus, underlines or browser colors`);
      }
    }
    assert.doesNotMatch(page.css, /:focus|forced-colors|prefers-color-scheme/);
  });
}

test("options.html actual hint and all normal field borders meet light-surface contrast", () => {
  const surface = options.rule("body").background;
  const hint = options.rule(".hint").color;
  assert.equal(hint, "#666");
  contrast(hint, surface, 4.5, "Settings hints");
  const inputBorder = borderColor(options.rule("input").border);
  assert.equal(inputBorder, "#767676");
  contrast(inputBorder, surface, 3, "Settings input boundary");

  const fields = [...options.html.matchAll(/<(input|select|textarea)\b[^>]*>/g)];
  assert.equal(fields.length, 10, "Check every current editable field");
  const inlineIds = [];
  for (const [tag, type] of fields) {
    const id = tag.match(/\bid="([^"]+)"/)?.[1];
    assert.ok(id, "Every field has an ID");
    const inline = declarations(tag.match(/\bstyle="([^"]*)"/)?.[1] || "");
    if (type !== "input") {
      assert.ok(inline.border, `${id} must retain its inline border`);
      inlineIds.push(id);
    }
    const color = inline.border ? borderColor(inline.border) : inputBorder;
    assert.equal(color, "#767676", `${id} normal border palette`);
    contrast(color, surface, 3, `${id} field boundary`);
  }
  assert.deepEqual(inlineIds, ["uiLang", "provider", "customInstructions"]);
});

test("options.html actual status/marker/Discard and decorative Save bar palettes stay unchanged", () => {
  const surface = options.rule("body").background;
  const saveBar = options.rule("#saveBar");
  assert.equal(saveBar.background, "#fff");
  assert.equal(saveBar["border-top"], "1px solid #ccc", "Save bar divider is decorative, not a field boundary");
  const discard = options.rule("#discard");
  assert.equal(discard.background, "#fff");
  assert.equal(discard.color, "#333");
  assert.equal(discard.border, "1px solid #777");
  contrast(discard.color, discard.background, 4.5, "Discard text");
  contrast(borderColor(discard.border), discard.background, 3, "Discard boundary");

  for (const [selector, expected] of [
    ["#status", "#333"],
    ['#status[data-state="warning"]', "#92400e"],
    ['#status[data-state="success"]', "#167343"],
    ['#status[data-state="error"]', "#b42318"],
    ['#connectionStatus[data-state="success"]', "#167343"],
    ['#connectionStatus[data-state="error"]', "#b42318"],
    [".field-modified", "#92400e"],
    [".field-modified-note", "#92400e"],
  ]) {
    const color = options.rule(selector).color;
    assert.equal(color, expected, `${selector} palette`);
    contrast(color, surface, 4.5, `${selector} text`);
  }
  const modifiedBorder = options.rule('[data-modified="true"]')["border-color"];
  assert.equal(modifiedBorder, "#b45309 !important");
  contrast(modifiedBorder.replace(/\s*!important$/, ""), surface, 3, "Modified field boundary");
});

test("popup.html actual usage hint palette stays unchanged and meets AA normal-text contrast", () => {
  const color = popup.rule(".usage").color;
  assert.equal(color, "#4b5563");
  contrast(color, popup.rule("body").background, 4.5, "Popup usage hints");
});
