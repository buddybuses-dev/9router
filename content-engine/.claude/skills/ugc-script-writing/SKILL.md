---
name: ugc-script-writing
description: Write or fix short-form UGC video scripts for the channel. Use when editing the scriptwriter prompt, adjusting channel voice, debugging why scripts fail validation, or hand-writing a script for an item in the queue.
---

# Writing scripts that survive the scroll

Stage 2 turns a brief into a script and three platform captions. The model does the
drafting; `config/channel.config.json` does the deciding.

## The parts, and what each is for

- **hook** — the first spoken line. It is the entire job. A viewer decides in under a
  second, and they decide on specificity: a number, a named mistake, an unexpected
  constraint. "In this video I'll show you" is a dead hook.
- **beats** — 2 to 5 of them. One idea each. `onScreen` is burned into the frame, so
  six words maximum or it will not be readable at thumb distance.
- **cta** — one line, no urgency theatre. "Link in bio if you want to look yourself"
  outperforms a countdown because it does not insult the viewer.
- **voiceover** — the full narration as one block, fed straight to TTS. It must read
  aloud naturally; the beats are for timing and captions, this is for the ear.

## Changing the voice

Edit `config/channel.config.json` → `voice`, not the prompt in `pipeline/2-script.js`.
The `do` and `dont` arrays are injected verbatim into the system prompt. Adding
`"Never open with a question"` to `dont` changes every future script.

The `dont` list exists because these are the phrases that make UGC read as an ad. Keep
it aggressive.

## Validation is the real spec

`validate()` in `pipeline/2-script.js` re-checks everything after generation. Models
drift on character counts, so the limits in `config/platforms.json` are enforced twice:
once as instruction, once as a gate. The gate is what actually protects you.

On failure the pipeline gives the model exactly one correction pass with the problems
listed. If it fails twice, the item goes to `99-failed` — that is a signal the brief
is bad, not that the model needs a third try.

## Compliance is not the model's job

`appendDisclosure()` prepends the affiliate disclosure after generation, so it cannot
be written away, reworded, or forgotten. Never move disclosure into the prompt.

`bannedClaimPatterns` in the channel config are regexes checked against every piece of
generated text. They cover the claims that get accounts restricted: guarantees,
risk-free framing, multiples of money. Add to them when you see something slip through.

## Hand-writing a script

Edit the item JSON in `queue/03-render/` directly. Fill `script` and `captions` to
match the schema in `pipeline/2-script.js`, then let stage 3 pick it up. The pipeline
does not care whether a script came from the model or from you.
