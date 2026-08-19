---
name: pipeline-triage
description: Diagnose and fix a stalled or failing content pipeline. Use when items land in queue/99-failed, a scheduled workflow fails, the health check opens an issue, or the channel has stopped publishing.
---

# Triage

## First: where is it stuck?

```bash
npm run health
```

This prints queue depth per stage and every blocking problem, and exits non-zero when
the channel is about to go dark. Run it before reading any logs — it usually names the
problem directly.

## Reading the queue

The queue is the state, and it is plain JSON on disk:

| Stage | Meaning | Normal to sit here? |
| --- | --- | --- |
| `01-brief` | Sourced, not yet scripted | Minutes to hours |
| `02-script` | Transient; scripting writes straight through to render | No — an item here means a crash mid-write |
| `03-render` | Scripted, waiting on video | **Yes**, with `RENDERER=manual` |
| `04-ready` | Video done, waiting for a posting slot | Yes — this is your runway |
| `05-published` | Live | Permanent |
| `99-failed` | Needs a decision | No |

Every item carries a `history` array. `jq '.history' queue/99-failed/<id>.json` gives
you the whole life of that item in order.

## Failed items

`item.error` records `stage`, `reason`, and `message`. The common ones:

- **`script validation failed twice`** — the model could not meet the platform limits
  even after a correction pass. Almost always a thin brief: `angleNotes` is vague, so
  the model padded. Fix the notes in `config/whop.sources.json` and re-source, rather
  than retrying the same brief.
- **`script generation error`** — an API problem. Check `ANTHROPIC_API_KEY` is set and
  has quota. Safe to retry as-is.
- **`render error`** — read `message`. Missing b-roll and truncated exports are the
  two usual causes.
- **`all platforms failed`** — every publisher threw. Almost always expired
  credentials; check the platform-specific token first, not the code.

To retry an item, move it back to the stage it failed in:

```bash
mv queue/99-failed/<id>.json queue/03-render/
```

`retry()` in `lib/store.js` does this properly, including clearing `item.error`.

## Workflow-level problems

- **Two workflows raced on the queue** — should not happen; they share the
  `content-queue` concurrency group. If it did, the commit steps rebase and retry.
- **Push rejected** — the commit steps `git pull --rebase --autostash` before pushing.
  A persistent failure means someone force-pushed the branch.
- **Schedules stopped firing** — GitHub disables cron in repositories with no activity
  for 60 days. The pipeline commits regularly, so this only bites a pipeline that was
  already broken. Re-enable it in the Actions tab.
- **Nothing publishes but no error** — read the publish log for `daily cadence reached`
  or `too soon since last post`. Those are limits doing their job, not failures.

## The failure mode that costs the most

A pipeline that silently stops. `health.yml` runs daily and opens a single tracking
issue labelled `pipeline-health` when the channel is about to go dark. If that issue
is open, treat it as the highest-priority item in the repo — a dark channel loses
distribution far faster than it regains it.
