---
name: channel-analytics
description: Read the channel's performance data and decide what to make more of. Use when reviewing which videos worked, analysing stats collected by stage 5, or deciding which Whop products deserve more coverage.
---

# Turning numbers back into decisions

Stage 5 writes stats onto the published items themselves, so the entire history lives
in `queue/05-published/*.json` and in git. There is no dashboard to log into and no
external service to keep alive.

## What is collected

- **YouTube** — views, likes, comments, batched into one API call for up to 50 videos.
- **Instagram** — views, likes, comments, shares, saves via the insights endpoint.
- **TikTok** — not collected. Their stats endpoint needs a scope most apps are not
  granted; read those in the app rather than pretending the number exists here.

Stats are overwritten on each run, so an item carries its latest snapshot, not a time
series. For trends, use git: `git log -p queue/05-published/<id>.json`.

## The only comparison worth making

Views per video are noise across different posting times and formats. The signal is
**relative performance within the same product category**, over at least five videos.

Useful queries against the queue:

```bash
# Best performers by YouTube views
jq -r '[.title, .stats.youtube.views] | @tsv' queue/05-published/*.json | sort -k2 -rn

# Saves are the strongest intent signal on Instagram — much better than likes
jq -r '[.title, .stats.instagram.saved] | @tsv' queue/05-published/*.json | sort -k2 -rn

# Which source products have produced anything at all
jq -r '.source.name' queue/05-published/*.json | sort | uniq -c | sort -rn
```

## Acting on it

The loop closes in exactly one place: `config/whop.sources.json`. A product whose
videos consistently underperform gets disabled; a category that works gets more entries
in `manualProducts`. Nothing else in the repo should change in response to stats.

Resist rewriting the voice config after one bad video. Short-form view counts have
enormous variance — a single video tells you nothing, and five tell you a little.

## What the numbers cannot tell you

Views measure distribution, not whether the video was honest or whether the viewer
who clicked through was well served. The affiliate dashboard on Whop is the only
place conversion actually shows up, and a video with modest views and real conversions
is worth more than a viral one with none.
