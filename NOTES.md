# Design notes: does "outsmart clickbait with AI" actually work?

The blog's thesis — *clickbait only works on humans, AI neutralizes it* — is
**sound as a reader tool, overreaching as a prediction.** This file records the
critique that shaped the prototype.

## Where the idea holds
- Clickbait exploits a **curiosity / information gap**: you must click to learn
  whether there's anything worth reading. A reliable preview closes that gap.
  `debait`'s `honest_title` + `worth_clicking` flag implement exactly this.

## Where it breaks down (and how the tool acknowledges it)
- **Speed ≠ accuracy; dispassion ≠ immunity.** A faithful summary can faithfully
  repeat false claims. → The prompt forbids asserting claims as fact
  ("attribute, don't assert") and separates `substance_verdict` from truth.
- **Economics are untouched.** The bait exists because *attention is sold to
  advertisers*. Defeating the trick for individuals doesn't kill the business
  model. A tool can't fix this; only platform/UX placement can.
- **Adversarial arms race.** Content farms optimize to be *included* in AI
  answers, inject prompt-manipulation, or write quotable-but-misleading lines.
  AI also lowers the cost of *producing* junk.
- **Second-order effects.** Summaries divert traffic from good reporting too,
  weakening the economics of the content they depend on, and concentrate
  editorial power in a few AI intermediaries.

## Honest conclusion
AI previews weaken clickbait **if** they are accurate, widely adopted, and
aligned with readers rather than platforms — none of which is guaranteed. This
prototype demonstrates the mechanism, not the cure.
