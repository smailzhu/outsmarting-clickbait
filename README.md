# outsmarting-clickbait 🪝🚫

A tiny prototype of the idea from Wiwi Kuan's post
[*"Outsmarting Clickbait"* (騙點閱)](https://www.wiwi.blog/blog/outsmarting-clickbait/):

> Clickbait only works on humans. An AI can read the whole article in a second
> and hand you an honest, non-sensational title plus the actual substance — so
> the bait loses its power.

Ships in three forms from one shared prompt:

| Form | Where | Entry |
|------|-------|-------|
| **CLI** | terminal (OpenAI API or `codex` CLI) | `src/cli.js` |
| **Userscript** | Tampermonkey / Violentmonkey, any browser | [`userscript/`](userscript/) |
| **Extension** | Chromium (MV3): Chrome / Edge / Brave | [`extension/`](extension/) |

The prompt + result parsing live once in [`shared/prompt.js`](shared/prompt.js);
the browser builds reuse it. **In-browser builds require an OpenAI-compatible API
key** — the `codex` CLI backend is CLI-only.

`debait` fetches an article, reads the whole thing with an LLM, and prints:

- an **honest title** (no hype, no curiosity gap),
- a short **summary** + **key points**,
- a **clickbait score** (0–100) and the **bait techniques** detected,
- a **substance verdict** (`substantial` / `thin` / `empty`) and whether it's
  actually **worth clicking**.

## Does the underlying idea hold up?

Partly — and that nuance is baked into the tool's output. It genuinely defeats
the **curiosity-gap mechanic** for anyone who uses it (that's the honest title +
`worth_clicking` flag). What it *doesn't* do is remove the **economic
incentive** to make clickbait, guarantee truth (a faithful summary can faithfully
repeat false claims — hence the "attribute, don't assert" rule in the prompt),
or stop the adversarial arms race. See [`NOTES.md`](NOTES.md) for the full
critique that motivated the design.

## Install

### Chromium extension (Chrome / Edge / Brave)

1. Download **`debait-extension-v*.zip`** from the
   [latest release](https://github.com/smailzhu/outsmarting-clickbait/releases/latest)
   and **unzip** it. (Or clone the repo and use the `extension/` folder.)
2. Open `chrome://extensions` (or `edge://extensions`, `brave://extensions`).
3. Turn on **Developer mode**, click **Load unpacked**, and select the unzipped
   folder (the one containing `manifest.json`).
4. Click the 🪝🚫 toolbar icon → **Settings** → pick a provider, paste your
   API key, Save. Then **Analyze this page**, right-click → *debait this page*,
   or **Alt+hover** a link to preview it before clicking.

> Chromium can't install a raw `.zip` directly — load the unzipped folder as an
> unpacked extension. (Sideloaded extensions show a one-time "Developer mode"
> notice on startup; that's normal.) See [`extension/README.md`](extension/README.md).

### Userscript (Tampermonkey / Violentmonkey — any browser, incl. Firefox)

Install a userscript manager, then open
[`userscript/debait.user.js`](userscript/debait.user.js) → **Raw** — your manager
offers to install it. Set provider/key from the Tampermonkey menu.
See [`userscript/README.md`](userscript/README.md).

### CLI

No dependencies. Needs Node ≥ 20.

```bash
git clone https://github.com/smailzhu/outsmarting-clickbait.git
cd outsmarting-clickbait
npm link        # optional: puts `debait` on your PATH
```

## Usage

```bash
# From a URL
debait https://example.com/some-viral-article

# JSON output (for piping / integration)
debait https://example.com/some-viral-article --json

# From raw HTML on stdin (great for testing / paywalled pages you already have)
cat examples/sample-clickbait.html | node src/cli.js --stdin --url https://example.com/x
```

### Providers / backends

Multi-provider, from one shared layer ([`shared/providers.js`](shared/providers.js)):

| Provider | id | Wire format | Default model | Key env |
|----------|----|-------------|---------------|---------|
| OpenAI | `openai` | openai | gpt-4o-mini | `OPENAI_API_KEY` |
| Anthropic (Claude) | `anthropic` | anthropic | claude-3-5-haiku-latest | `ANTHROPIC_API_KEY` |
| Google Gemini | `gemini` | gemini | gemini-flash-latest | `GEMINI_API_KEY` |
| Groq | `groq` | openai | llama-3.3-70b-versatile | `GROQ_API_KEY` |
| OpenRouter | `openrouter` | openai | openai/gpt-4o-mini | `OPENROUTER_API_KEY` |
| DeepSeek | `deepseek` | openai | deepseek-chat | `DEEPSEEK_API_KEY` |
| xAI (Grok) | `xai` | openai | grok-3 | `XAI_API_KEY` |
| Mistral | `mistral` | openai | mistral-small-latest | `MISTRAL_API_KEY` |
| Together | `together` | openai | meta-llama/Llama-3.3-70B-Instruct-Turbo | `TOGETHER_API_KEY` |
| NVIDIA (NIM) | `nvidia` | openai | meta/llama-3.3-70b-instruct | `NVIDIA_API_KEY` |
| Ollama (local) | `ollama` | openai | llama3.1 | — |
| Codex CLI | `codex` | — (shells out) | — | — |

**CLI auto-selection:** the first provider whose key env var is set, else the
[`codex`](https://developers.openai.com/codex) CLI. Override:

```bash
debait <url> --backend anthropic        # or: DEBAIT_PROVIDER=anthropic
export ANTHROPIC_API_KEY=...             # provider key
DEBAIT_MODEL=claude-3-5-sonnet-latest    # override model
DEBAIT_BASE_URL=https://my-gateway/v1    # override base (gateways / local)
DEBAIT_BACKEND=codex                     # force the codex CLI
```

**Output language.** By default the honest title + summary come back in the
article's own language (`auto`). Force one with `--lang` / `DEBAIT_LANG`:

```bash
debait <url> --lang English
debait <url> --lang "繁體中文"      # or 日本語, Español, es, ...
DEBAIT_LANG="繁體中文" debait <url>
```
JSON keys and the `substance_verdict` enum always stay English. The extension
(Options → Output language) and userscript (menu → *set output language*) expose
the same setting.

The userscript and extension expose the same provider list in their settings.
After editing `shared/providers.js`, run `npm run sync` to copy it into the extension.

## Example

```bash
$ cat examples/sample-clickbait.html | node src/cli.js --stdin
ORIGINAL:  SHOCKING: This ONE Feature Could DESTROY The Entire Media Industry Forever
HONEST:    Developer suggests AI summaries could make clickbait less effective
Clickbait  ████████████████░░░░ 85/100
Substance  thin   worth clicking: false
Summary:   The article's only real point is that AI tools generating honest
           titles/summaries would reduce clickbait's effectiveness. The rest is
           padding and ads.
```

## How it works

```
URL ──▶ extract.js ──▶ summarize.js ──▶ llm.js ──▶ honest title + score
        (fetch +         (prompt +        (openai |
         strip HTML)      JSON parse)      codex CLI)
```

Extraction is deliberately dependency-free and heuristic (strip
`script/style/nav/aside/footer`, prefer `<article>`). For production you'd swap
in Readability + a headless browser for JS-rendered pages.

## Privacy & keys

- **Your API key stays yours.** The CLI reads it from an env var; the extension
  stores it in `chrome.storage.sync` (synced to your browser profile, not to us);
  the userscript stores it via your userscript manager. It is sent only to the
  provider endpoint you configure — there is no debait server.
- **What's sent to the provider:** the extracted article text + title of the page
  you debait (or Alt+hover-preview), so the model can summarize it. Nothing else.
- **Extension host access:** the extension requests broad host permissions
  (`https://*/*`, `http://*/*`) so the background worker can fetch the *target* of
  a hovered link for preview. It only fetches a page when you Alt+hover or run
  debait on it.
- **Cost control:** hover previews are rate-limited (one at a time, min interval)
  with a 429 backoff and a configurable **daily cap**, so bursty hovering can't
  silently exhaust a provider quota. See each surface's settings.

## Test

```bash
npm test
```

## License

MIT
