// Lightweight, dependency-free article extraction.
// Fetches a URL and pulls out a best-effort "main text" + the original <title>.
// This is deliberately simple (no headless browser / Readability) so the
// prototype runs anywhere with zero install. Good enough to feed an LLM.

const UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36 debait/0.1";

export async function fetchHtml(url, { timeoutMs = 20000 } = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: { "user-agent": UA, accept: "text/html,*/*" },
      redirect: "follow",
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
    return await res.text();
  } finally {
    clearTimeout(t);
  }
}

function pick(re, html) {
  const m = html.match(re);
  return m ? decodeEntities(stripTags(m[1])).trim() : "";
}

function stripTags(s) {
  return s.replace(/<[^>]*>/g, " ");
}

function decodeEntities(s) {
  const named = {
    "&amp;": "&",
    "&lt;": "<",
    "&gt;": ">",
    "&quot;": '"',
    "&#39;": "'",
    "&apos;": "'",
    "&nbsp;": " ",
  };
  return s
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&[a-z]+;/gi, (m) => named[m] ?? m);
}

// Extract readable text + metadata from raw HTML.
export function extractArticle(html, url = "") {
  const originalTitle =
    pick(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']*)["']/i, html) ||
    pick(/<title[^>]*>([\s\S]*?)<\/title>/i, html);

  const description =
    pick(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i, html) ||
    pick(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']*)["']/i, html);

  // Remove non-content elements entirely.
  let body = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<nav[\s\S]*?<\/nav>/gi, " ")
    .replace(/<footer[\s\S]*?<\/footer>/gi, " ")
    .replace(/<header[\s\S]*?<\/header>/gi, " ")
    .replace(/<aside[\s\S]*?<\/aside>/gi, " ")
    .replace(/<form[\s\S]*?<\/form>/gi, " ");

  // Prefer an <article> block if present.
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

export async function loadArticle(url, opts) {
  const html = await fetchHtml(url, opts);
  return extractArticle(html, url);
}
