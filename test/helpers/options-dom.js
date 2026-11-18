// A deliberately small connected HTML seam for the real options/i18n scripts.
// textContent replaces children (including IDs), unlike the flat event harness.
export function parseOptionsHtml(html, createElement) {
  const root = createElement("#document", {}), stack = [root];
  const decode = (text) => text.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"');
  for (const match of html.matchAll(/<!--[\s\S]*?-->|<![^>]*>|<\/([\w-]+)\s*>|<([\w-]+)([^>]*)>|([^<]+)/g)) {
    if (match[1]) { stack.pop(); continue; }
    if (match[2]) {
      const attrs = Object.fromEntries([...match[3].matchAll(/([^\s=/>]+)(?:\s*=\s*"([^"]*)")?/g)].map((m) => [m[1], decode(m[2] || "")]));
      const node = createElement(match[2], attrs);
      node.parentElement = stack.at(-1); stack.at(-1).children.push(node);
      if (!["meta", "input", "br", "hr", "img", "link"].includes(match[2])) stack.push(node);
    } else if (match[4]) stack.at(-1).children.push({ textContent: decode(match[4]), parentElement: stack.at(-1) });
  }
  function walk(node) { return [node, ...(node.children || []).flatMap(walk)]; }
  root.querySelectorAll = (selector) => walk(root).filter((node) => selector === "[data-i18n]" ? node.hasAttribute?.("data-i18n")
    : selector === "[data-i18n-ph]" ? node.hasAttribute?.("data-i18n-ph") : false);
  root.getElementById = (id) => walk(root).find((node) => node.getAttribute?.("id") === id);
  root.elements = () => walk(root).filter((node) => node.tagName);
  return root;
}
