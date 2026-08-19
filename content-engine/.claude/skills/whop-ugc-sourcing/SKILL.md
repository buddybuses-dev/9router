---
name: whop-ugc-sourcing
description: Vet and add Whop products to the content pipeline's source list. Use when adding new products to promote, reviewing what the channel is sourcing, deciding whether a product is worth a video, or when stage 1 (source) produces nothing or produces the wrong things.
---

# Sourcing Whop products worth a video

Sourcing is the only stage where a bad decision cannot be fixed downstream. A great
script for a product that does not deserve one still costs the channel trust.

## Where sourcing comes from

`config/whop.sources.json` has two inputs:

- `manualProducts` — products you vetted yourself. **This is the one that matters.**
- Whop API sync (`WHOP_API_KEY`) — keeps titles and prices current for products you
  have API access to. It does not discover anything new.

There is no marketplace-wide scraper, on purpose. Whop exposes no public discovery API
to third parties, and a storefront scraper breaks constantly and sits on the wrong side
of their terms. Breadth comes from vetting more products, not from crawling harder.

## The vetting bar

Add a product only when you can answer all four:

1. **What is actually inside?** Not the sales page — the thing a member receives in
   week one. If you cannot describe it in one concrete sentence, you cannot script it.
2. **Who is it genuinely not for?** Every honest UGC video names this. If you cannot,
   you do not know the product well enough.
3. **Is the price defensible out loud?** You will say the number on camera.
4. **Would you still recommend it with no commission?** If no, skip it. One regretted
   promotion costs more reach than ten good ones earn.

## Adding a product

```json
{
  "id": "stable-unique-id",
  "name": "Product name as it appears on Whop",
  "url": "https://whop.com/the-product",
  "affiliateUrl": "your affiliate link, or empty",
  "priceLabel": "$29/mo",
  "angleNotes": "The specific thing you noticed that a video could be built on.",
  "enabled": true
}
```

`angleNotes` is the highest-leverage field in the whole repo. It is handed straight to
the scriptwriter as your vetting notes. "Good community" produces a generic video.
"The onboarding is three videos and a spreadsheet, and the spreadsheet is the actual
product" produces one worth watching.

`id` must be stable — it is how the pipeline knows it has already made a video for
this product. Changing it re-briefs the product from scratch.

## Exclusions

`exclude.keywords` blocks whole categories. The defaults block signals, picks, and
gambling — categories where an honest 40-second review is not possible and where all
three platforms' ad policies are hostile. Extend it rather than relying on remembering.

## When sourcing produces nothing

Check in this order:

1. Is anything `enabled: true` in `manualProducts`? A fresh clone has nothing enabled.
2. Is the queue at `maxQueueDepth`? Stage 1 refuses to source into a full queue — that
   is working as designed, not a bug. Clear the backlog first.
3. Was every candidate already seen? Sourcing is idempotent; a product already anywhere
   in `queue/` is never re-briefed. `skippedAsSeen` in the log tells you this happened.
