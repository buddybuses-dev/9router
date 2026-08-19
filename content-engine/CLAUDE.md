# CLAUDE.md

Guidance for Claude Code working in this repository.

## What this is

A 24/7 short-form content pipeline. It sources vetted Whop products, writes UGC scripts
with Claude, renders vertical video, and publishes to YouTube Shorts, Instagram Reels
and TikTok — driven entirely by scheduled GitHub Actions.

## The one idea to understand first

**The queue is the database.** Every content item is a single JSON file under
`queue/<stage>/`, and moving between stages is a file move that git records. There is
no external database, no state service, and no dashboard. This is why the pipeline is
cheap to run forever and why its entire history is inspectable with `git log`.

Consequences worth holding onto:

- Any stage can be re-run safely; they are all idempotent.
- Workflows commit the queue back to the branch, so they share a `content-queue`
  concurrency group and must never run in parallel.
- Debugging is `cat` and `jq`, not log aggregation.

## Flow

```
config/whop.sources.json
  → 1-source   → queue/01-brief      (vetted product becomes a brief)
  → 2-script   → queue/03-render     (Claude writes script + 3 platform captions)
  → 3-render   → queue/04-ready      (video file produced or claimed)
  → 4-publish  → queue/05-published  (YouTube + Instagram + TikTok)
  → 5-stats                          (performance written back onto the item)
```

`queue/02-script/` exists for symmetry but is transient — scripting writes straight
through to `03-render`. An item sitting in `02-script` means something crashed mid-write.

## Layout

| Path | Role |
| --- | --- |
| `config/` | All tunable behaviour. Voice, cadence, platform limits, source list. |
| `lib/` | Shared plumbing: queue, HTTP retry, LLM, env, TTS, media hosting. |
| `pipeline/` | One file per stage. Each is an entry point with its own npm script. |
| `sources/` | Where content ideas come from. Whop today. |
| `renderers/` | How a script becomes a video. `manual` and `ffmpeg`. |
| `publishers/` | One file per platform. |
| `.claude/skills/` | Task-specific guidance — read the relevant one before working in an area. |

## Conventions

- Plain JavaScript, ESM, Node 20+. No TypeScript, no build step.
- **No new dependencies without a reason that survives scrutiny.** The only runtime
  dependency is `@anthropic-ai/sdk`; everything else uses Node built-ins. This is what
  keeps CI installs fast and the supply chain small.
- Behaviour belongs in `config/`, not in code. If you find yourself editing a prompt in
  `pipeline/2-script.js` to change the channel's tone, edit `channel.config.json` instead.
- Every credential is read through `lib/env.js`. `required()` throws with a message
  naming the variable and pointing at `docs/SETUP.md`; never read `process.env` directly.
- Errors move an item to `99-failed` with the reason attached. Never swallow an error
  and never delete a failed item — triage is a human decision.
- `DRY_RUN=1` must keep every stage from touching an external service. Any new code
  path that spends money or posts publicly has to honour it.

## Model usage

`lib/llm.js` is the only place that calls a model. It defaults to `claude-opus-5` with
adaptive thinking and structured outputs, and can be pointed at a local 9router gateway
with `LLM_BASE_URL` for runs on station D. Add generative steps there, not inline.

## Safety rails that must not be weakened

- `appendDisclosure()` prepends the affiliate disclosure **after** generation, so the
  model cannot reword or drop it. Do not move disclosure into the prompt.
- `bannedClaimPatterns` are checked against all generated text. They exist to keep the
  accounts alive; extend them, do not relax them.
- Cadence limits are enforced inside `4-publish.js`, not by the cron schedule, so a
  manual run cannot exceed them.
