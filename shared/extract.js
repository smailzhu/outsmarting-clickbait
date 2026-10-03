// Pure, dependency-free, browser-safe HTML -> article extraction.
// No fetch, no DOM -> usable in an MV3 service worker (which has neither
// DOMParser nor a document). Shared by the CLI and the extension.

function stripTags(s) {
  return s.replace(/<[^>]*>/g, " ");
}

const NAMED = {
  "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"',
  "&#39;": "'", "&apos;": "'", "&nbsp;": " ",
};

export function decodeEntities(s) {
  return s
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&[a-z]+;/gi, (m) => NAMED[m] ?? m);
}

function pick(re, html) {
  const m = html.match(re);
  return m ? decodeEntities(stripTags(m[1])).trim() : "";
}

// Extract readable text + metadata from raw HTML.
export function extractArticle(html, url = "") {
  const originalTitle =
    pick(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']*)["']/i, html) ||
    pick(/<title[^>]*>([\s\S]*?)<\/title>/i, html);

  const description =
    pick(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i, html) ||
    pick(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']*)["']/i, html);

  let body = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<nav[\s\S]*?<\/nav>/gi, " ")
    .replace(/<footer[\s\S]*?<\/footer>/gi, " ")
    .replace(/<header[\s\S]*?<\/header>/gi, " ")
    .replace(/<aside[\s\S]*?<\/aside>/gi, " ")
    .replace(/<form[\s\S]*?<\/form>/gi, " ");

  const article = body.match(/<article[\s\S]*?<\/article>/i);
  if (article) body = article[0];

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
