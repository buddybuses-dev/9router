---
name: multi-platform-publishing
description: Publish finished videos to YouTube, Instagram and TikTok, and fix publishing failures. Use when setting up platform credentials, debugging upload errors, adjusting posting cadence, or when videos sit in queue/04-ready without going out.
---

# Publishing to three platforms without double-posting

Stage 4 is the only irreversible stage. Two invariants protect it.

## Invariant 1: never double-post

Each platform's result is written back to the item **the moment it lands**, before the
next platform is attempted. A re-run after a partial failure skips platforms that
already have a `remoteId` and retries only the ones that do not.

This means a partial failure is safe to re-run, and it means you must never clear a
`publish.<platform>` block by hand unless you actually want to post again.

## Invariant 2: never exceed the channel's cadence

`channel.config.json` → `cadence` is enforced inside the stage, not by the cron
schedule. `postsPerDay` and `minMinutesBetweenPosts` are re-checked on every run, so a
manual `workflow_dispatch` cannot push the channel past its limit. One item published
to three platforms counts as **one** post.

## Platform specifics that actually matter

**YouTube** — resumable upload, two steps: open a session, then stream the file to the
returned `Location` URL. Auth is a refresh token exchanged for an access token every
run; that is the only OAuth shape that works headless. Shorts classification comes from
the video's own aspect ratio and length, not from a flag — the `#Shorts` hashtag in the
title is the only lever available, and it is appended automatically.

**Instagram** — three steps, and the middle one is where people go wrong: create a
container, **poll until `status_code` is `FINISHED`**, then publish. Publishing before
the transcode finishes fails with an error that looks unrelated. Instagram will not
accept a file upload — it fetches from a public URL, which `lib/hosting.js` provides by
uploading to a GitHub release. Needs a Business or Creator account linked to a Facebook
Page.

**TikTok** — uses `FILE_UPLOAD`, not `PULL_FROM_URL`, deliberately: `PULL_FROM_URL`
requires a domain verified in TikTok's developer console, which is another thing to
keep alive. Access tokens live 24 hours, so the refresh token is what you store as a
secret. `disclosureCommercialContent` must stay `true` for affiliate content.

## When nothing publishes

Read the log line, in this order:

- `daily cadence reached` — working as designed. Raise `postsPerDay` if you mean it.
- `too soon since last post` — same. `minMinutesBetweenPosts` is doing its job.
- `nothing ready` — the queue is empty at `04-ready`. The problem is upstream, in
  render or script.
- A platform error — the item stays in `04-ready` with the successful platforms
  recorded, and retries on the next run. No action needed unless it repeats.

If **all** platforms fail, the item goes to `99-failed` and the workflow exits non-zero.

## Turning a platform off

Set `enabled: false` in `config/platforms.json`. The publisher is skipped everywhere,
including in the health check's credential audit.
