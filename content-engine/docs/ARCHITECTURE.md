# Architecture

## The decision everything else follows from

**State lives in git as JSON files, not in a database.**

Each content item is one file. Its location is its state. Advancing a stage is a file
move plus a commit.

What this buys:

- **No infrastructure.** No database to pay for, patch, back up, or lose access to.
  The pipeline's operating cost is the API calls and nothing else.
- **Free audit trail.** `git log -p queue/05-published/<id>.json` shows every change an
  item ever went through, including who or what made it.
- **Trivial debugging.** The state is `cat`-able. There is no query language between
  you and the answer.
- **Idempotency by construction.** A stage reads a directory and writes a directory.
  Re-running it is safe by default rather than by discipline.

What it costs, honestly:

- **No concurrency.** Two workflows writing the queue would conflict, so they share a
  `content-queue` concurrency group and run strictly one at a time. At a cadence of a
  few posts a day this costs nothing.
- **It does not scale to thousands of items.** At roughly 10,000 items the directory
  reads get slow. That is far beyond what a single channel produces, and the migration
  path (SQLite behind `lib/store.js`) is a contained change to one module.

## Stage boundaries

Each stage is an independent entry point with one job, and they communicate only
through the queue. No stage imports another. That is why a scripting failure cannot
block a finished video from publishing, and why any stage can be run by hand.

| Stage | Reads | Writes | External calls |
| --- | --- | --- | --- |
| `1-source` | `config/whop.sources.json` | `01-brief` | Whop API (optional) |
| `2-script` | `01-brief` | `03-render` | Anthropic |
| `3-render` | `03-render` | `04-ready` | ElevenLabs (ffmpeg mode only) |
| `4-publish` | `04-ready` | `05-published` | YouTube, Instagram, TikTok, GitHub |
| `5-stats` | `05-published` | `05-published` | YouTube, Instagram |

## Where the safety lives

Three rails are deliberately placed in code rather than in prompts or schedules,
because all three protect things that are expensive to lose.

**Disclosure** is appended after generation (`appendDisclosure`). A model asked to
include a disclosure will occasionally reword or omit it. A string concatenation will not.

**Claim filtering** (`findBannedClaims`) runs as a regex gate over all generated text.
The banned patterns are the claims that get accounts restricted — guarantees, risk-free
framing, money multiples.

**Cadence** is enforced inside `4-publish.js`, not by cron. Cron decides when the stage
*may* run; the stage decides whether it *should*. This is why a manual
`workflow_dispatch` cannot push the channel past its daily limit.

## Error philosophy

An error moves an item to `99-failed` with `stage`, `reason` and `message` attached, and
never deletes anything the item has earned. Triage is a human decision, so the pipeline's
job is to preserve enough context to make that decision, not to guess.

Two things that deliberately are *not* errors:

- The manual renderer finding no file. It returns `null`, and the item stays put. With
  `RENDERER=manual` this is the normal state most of the time.
- A partial publish. Platforms that succeeded are recorded immediately; the item
  advances, and the failed platforms retry on the next run because their result slot is
  still empty. This is what makes re-running publish safe.

## Extension points

- **A second marketplace** — add `sources/<name>.js` returning the normalised product
  shape, and call it from `1-source.js`. Nothing downstream changes.
- **A different renderer** — add `renderers/<name>.js` exporting `name`, `render(item)`
  and `waitingHint(item)`, and register it. Return `null` for "not ready".
- **A fourth platform** — add `publishers/<name>.js` exporting `platform` and
  `publish(item, spec)`, register it, and add its limits to `config/platforms.json`.
  The publish loop, cadence and retry logic all pick it up automatically.
