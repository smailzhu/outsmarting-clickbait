// Pure, dependency-free, browser-safe HTML -> article extraction.
// No fetch, no DOM -> usable in an MV3 service worker (which has neither
// DOMParser nor a document). Shared by the CLI and the extension.
//
// Block removal uses indexOf-based scanning (linear) instead of lazy regex,
// which is O(n^2) on pathological input like thousands of unclosed <script>.

const MAX_HTML = 3_000_000; // hard cap on input size (defense in depth)

function stripTags(s) {
  return s.replace(/<[^>]*>/g, " ");
}

const NAMED = {
  "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"',
  "&#39;": "'", "&apos;": "'", "&nbsp;": " ",
};

// Only valid Unicode scalar values; reject surrogates / out-of-range so a bad
// numeric entity (e.g. &#1114112;) can't throw RangeError and abort extraction.
function fromCodePointSafe(cp) {
  if (!Number.isFinite(cp) || cp < 0 || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)) return "\uFFFD";
  try { return String.fromCodePoint(cp); } catch { return "\uFFFD"; }
}

export function decodeEntities(s) {
  return String(s)
    .replace(/&#(\d+);/g, (_, d) => fromCodePointSafe(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => fromCodePointSafe(parseInt(h, 16)))
    .replace(/&[a-z]+;/gi, (m) => NAMED[m] ?? m);
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Is the char after "<tag" a real tag boundary ( >, whitespace, or / )?
function isTagBoundary(ch) {
  return ch === undefined || ch === ">" || ch === "/" || /\s/.test(ch);
}

// Linear removal of <tag>...</tag> blocks (case-insensitive). Unclosed opener
// drops the remainder. No backtracking.
function stripBlocks(src, tag) {
  const lower = src.toLowerCase();
  const open = "<" + tag;
  const close = "</" + tag + ">";
  let out = "";
  let i = 0;
  for (;;) {
    let start = lower.indexOf(open, i);
    while (start !== -1 && !isTagBoundary(lower[start + open.length])) {
      start = lower.indexOf(open, start + open.length);
    }
    if (start === -1) { out += src.slice(i); break; }
    out += src.slice(i, start) + " ";
    const end = lower.indexOf(close, start);
    if (end === -1) break; // unclosed -> drop the rest
    i = end + close.length;
  }
  return out;
}

// Return the first <tag>...</tag> block (with a proper boundary), or null.
function firstBlock(src, tag) {
  const lower = src.toLowerCase();
  const open = "<" + tag;
  let start = lower.indexOf(open);
  while (start !== -1 && !isTagBoundary(lower[start + open.length])) {
    start = lower.indexOf(open, start + open.length);
  }
  if (start === -1) return null;
  const close = "</" + tag + ">";
  const end = lower.indexOf(close, start);
  if (end === -1) return null;
  return src.slice(start, end + close.length);
}

// Find a <meta> tag matching attr="val" in ANY attribute order, with EITHER
// quote style, and return its decoded content.
function metaContent(html, attr, val) {
  const metaRe = /<meta\b[^>]*>/gi;
  const attrRe = new RegExp(`${attr}\\s*=\\s*(["'])\\s*${escapeRe(val)}\\s*\\1`, "i");
  const contentRe = /content\s*=\s*(["'])([\s\S]*?)\1/i;
  let m;
  while ((m = metaRe.exec(html))) {
    if (attrRe.test(m[0])) {
      const c = m[0].match(contentRe);
      if (c) return decodeEntities(c[2]).trim();
    }
  }
  return "";
}

function titleTag(html) {
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return m ? decodeEntities(stripTags(m[1])).trim() : "";
}

// Extract readable text + metadata from raw HTML.
export function extractArticle(html, url = "") {
  html = String(html || "").slice(0, MAX_HTML);

  const originalTitle = metaContent(html, "property", "og:title") || titleTag(html);
  const description =
    metaContent(html, "name", "description") || metaContent(html, "property", "og:description");

  // Remove scripts/styles everywhere first.
  let body = stripBlocks(stripBlocks(stripBlocks(html, "script"), "style"), "noscript");

  // Prefer a main content region; keep its own <header>/lead.
  const region = firstBlock(body, "article") || firstBlock(body, "main");
  const scoped = Boolean(region);
  if (scoped) body = region;

  // Strip navigational chrome. Only drop page-level header/footer when NOT
  // scoped to an article/main, so article leads are preserved.
  body = stripBlocks(stripBlocks(stripBlocks(body, "nav"), "aside"), "form");
  if (!scoped) body = stripBlocks(stripBlocks(body, "header"), "footer");

  const text = decodeEntities(stripTags(body))
    .replace(/[ \t\r\f\v]+/g, " ")
    .replace(/\n\s*\n\s*\n+/g, "\n\n")
    .replace(/\n{2,}/g, "\n")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .join("\n")
    .trim();

  return { url, originalTitle, description, text };
}
