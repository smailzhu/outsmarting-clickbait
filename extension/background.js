// Service worker: holds settings, performs the CORS-free LLM call, and wires
// up the context menu. Content scripts cannot call arbitrary APIs due to page
// CORS, so they delegate here.

const DEFAULTS = { base: "https://api.openai.com/v1", model: "gpt-4o-mini", key: "" };

async function settings() {
  const s = await chrome.storage.sync.get(DEFAULTS);
  return { ...DEFAULTS, ...s };
}

async function complete(prompt) {
  const { base, model, key } = await settings();
  if (!key) throw new Error("No API key set. Open the extension Options and paste your OpenAI key.");
  const res = await fetch(`${base}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      messages: [
        { role: "system", content: "You are a precise editor. Respond with exactly the requested format, nothing else." },
        { role: "user", content: prompt },
      ],
    }),
  });
  if (!res.ok) throw new Error(`API ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = await res.json();
  return data.choices?.[0]?.message?.content ?? "";
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === "debait:complete") {
    complete(msg.prompt)
      .then((text) => sendResponse({ ok: true, text }))
      .catch((e) => sendResponse({ ok: false, error: e.message }));
    return true; // async
  }
});

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({ id: "debait-run", title: "debait this page", contexts: ["page", "selection"] });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === "debait-run" && tab?.id) {
    chrome.tabs.sendMessage(tab.id, { type: "debait:run" });
  }
});
