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

No dependencies. Needs Node ≥ 20.

```bash
git clone <this-repo>
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

### Backends

The LLM backend is auto-selected:

| Condition | Backend |
|-----------|---------|
| `OPENAI_API_KEY` is set | OpenAI-compatible Chat Completions API |
| otherwise | the [`codex`](https://developers.openai.com/codex) CLI via `codex exec` |

Override with env vars:

```bash
DEBAIT_BACKEND=openai   # force backend: openai | codex
DEBAIT_MODEL=gpt-4o-mini
OPENAI_BASE_URL=https://api.openai.com/v1   # for compatible gateways
```

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

## Test

```bash
npm test
```

## License

MIT
