// Pure, dependency-free, browser-safe HTML -> article extraction.
// No fetch, no DOM -> usable in an MV3 service worker (which has neither
// DOMParser nor a document). Shared by the CLI and the extension.
//
// Tag scanning uses case-insensitive regexes with forward lastIndex (linear,
// no catastrophic backtracking) and tracks nesting depth. We deliberately do
// NOT lowercase a copy of the source for indexing: some code points change
// LENGTH under toLowerCase() (e.g. "\u0130".toLowerCase() === "i\u0307"),
// which would desync offsets. Known limitation: a literal "</tag>" embedded in
// an attribute value can truncate a block early; acceptable for a heuristic
// extractor whose output is only fed to an LLM (and always HTML-escaped in UI).

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

// A single regex that matches either an opening <tag ...> start or a closing
// </tag> for the given tag name. Used to walk balanced (nesting-aware) blocks.
function tokenRe(tag) {
  return new RegExp(`<${tag}(?=[\\s/>])|</${tag}\\s*>`, "gi");
}
const isClose = (tok) => tok[1] === "/";

// Remove every balanced <tag>...</tag> block (nesting-aware). An unbalanced
// opener drops the remainder (matches browser-ish "swallow to EOF" behaviour).
function stripBlocks(src, tag) {
  const re = tokenRe(tag);
  let out = "";
  let i = 0; // copy cursor
  let blockStart = -1;
  let depth = 0;
  let m;
  while ((m = re.exec(src))) {
    if (depth === 0 && !isClose(m[0])) {
      out += src.slice(i, m.index); // keep text before the block
      blockStart = m.index;
      depth = 1;
    } else if (isClose(m[0])) {
      if (depth > 0) {
        depth--;
        if (depth === 0) { out += " "; i = re.lastIndex; blockStart = -1; }
      }
    } else {
      depth++; // nested opener
    }
  }
  out += blockStart === -1 ? src.slice(i) : ""; // unbalanced opener: drop rest
  return out;
}

// Raw-text elements (script/style): their content is CDATA-like, so a literal
// "<script>" inside the text is NOT a nested element. Content ends at the first
// closing tag; no depth counting.
function stripRawText(src, tag) {
  const openRe = new RegExp(`<${tag}(?=[\\s/>])`, "gi");
  const closeRe = new RegExp(`</${tag}\\s*>`, "gi");
  let out = "";
  let i = 0;
  let m;
  while ((m = openRe.exec(src))) {
    if (m.index < i) continue;
    out += src.slice(i, m.index) + " ";
    closeRe.lastIndex = openRe.lastIndex;
    const c = closeRe.exec(src);
    if (!c) { i = src.length; break; } // unclosed raw text -> drop to EOF
    i = c.index + c[0].length;
    openRe.lastIndex = i;
  }
  out += src.slice(i);
  return out;
}

// Return the first balanced <tag>...</tag> block (nesting-aware), or null.
function firstBlock(src, tag) {
  const re = tokenRe(tag);
  let start = -1;
  let depth = 0;
  let m;
  while ((m = re.exec(src))) {
    if (!isClose(m[0])) {
      if (depth === 0) start = m.index;
      depth++;
    } else if (depth > 0) {
      depth--;
      if (depth === 0) return src.slice(start, re.lastIndex);
    }
  }
  return null;
}

// Match a <meta ...> tag while skipping '>' that appears inside quoted
// attribute values.
const META_TAG = /<meta\b(?:[^>"']|"[^"]*"|'[^']*')*>/gi;

// Parse a tag string's attributes into a lowercased-key map, quote-aware so a
// '>' or an attr-like substring inside a quoted value is not mis-parsed.
function parseAttrs(tag) {
  const attrs = {};
  const re = /([-\w:]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/g;
  let m;
  while ((m = re.exec(tag))) {
    const name = m[1].toLowerCase();
    if (!(name in attrs)) attrs[name] = m[2] ?? m[3] ?? m[4] ?? "";
  }
  return attrs;
}

// Find a <meta> tag whose attribute `attr` equals `val`, return its decoded
// content. Uses real attribute parsing (quote-aware), so `data-name`/values
// containing `content=...` can't produce false matches.
function metaContent(html, attr, val) {
  const want = val.toLowerCase();
  let m;
  META_TAG.lastIndex = 0;
  while ((m = META_TAG.exec(html))) {
    const attrs = parseAttrs(m[0]);
    if ((attrs[attr] || "").toLowerCase() === want && attrs.content !== undefined) {
      return decodeEntities(attrs.content).trim();
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

  // 1. Remove scripts/styles everywhere (raw-text: first close wins, no nesting).
  let body = stripRawText(stripRawText(stripRawText(html, "script"), "style"), "noscript");

  // 2. Remove clearly non-content chrome BEFORE selecting the main region, so a
  //    teaser <article> nested inside an <aside>/<nav> doesn't win over the real
  //    story. (header/footer handled after, to preserve an article's own lead.)
  body = stripBlocks(stripBlocks(stripBlocks(body, "nav"), "aside"), "form");

  // 3. Prefer a main content region; keep its own <header>/lead.
  const region = firstBlock(body, "article") || firstBlock(body, "main");
  const scoped = Boolean(region);
  if (scoped) body = region;

  // 4. Only drop page-level header/footer when NOT scoped to article/main.
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
