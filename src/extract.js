// Fetch wrapper around the pure, browser-safe extractor in shared/extract.js.

import { extractArticle, decodeEntities } from "../shared/extract.js";

export { extractArticle, decodeEntities };

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

export async function loadArticle(url, opts) {
  const html = await fetchHtml(url, opts);
  return extractArticle(html, url);
}
