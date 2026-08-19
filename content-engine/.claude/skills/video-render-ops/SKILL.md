---
name: video-render-ops
description: Produce the actual video file for a scripted item. Use when choosing or switching renderers, setting up b-roll and voice, debugging ffmpeg output, or when items pile up in queue/03-render without becoming videos.
---

# Getting a script to a finished vertical video

Stage 3 has two strategies. `RENDERER` picks one.

## `manual` (default)

The pipeline waits for you to drop an export into `media/inbox/<item-id>.mp4`. Cut it
in whatever you already use — Crayo, Descript, OpenCut, CapCut.

Items with no file yet **stay in `03-render` and are not errors**. That is the normal
state while you are editing. The stage logs `waiting on media` with the exact filename
to use. Only a corrupt or truncated file (under 100 KB) throws.

The filename must match the item id exactly. `ls queue/03-render/` gives you the list.

## `ffmpeg` (fully automated)

Assembles the video with no human in the loop:

1. ElevenLabs synthesizes the voiceover from `script.voiceover`
2. `ffprobe` measures the real audio length
3. Beat timings are **scaled to that real length**, so captions never run past the audio
4. A b-roll clip is picked deterministically from `media/broll/` by hashing the item id
5. ffmpeg cover-crops to 1080×1920, burns in captions, mixes music under the voice

Requirements: at least one vertical clip in `media/broll/` that you have the rights to
use, `ELEVENLABS_API_KEY`, and `ELEVENLABS_VOICE_ID`. ffmpeg and ffprobe are
preinstalled on GitHub's ubuntu runners.

The b-roll pick is deterministic on purpose — re-running an item reproduces the same
video instead of quietly producing a different one.

## Tuning the look

- `CAPTION_FONT_SIZE` (default 64) — captions are centre-aligned with `MarginV=260`,
  which keeps them clear of TikTok's and Reels' bottom UI. Raising the font without
  raising the margin will push text under the interface.
- `MUSIC_VOLUME` (default 0.08) — the first file in `media/music/` is used as the bed.
  Above roughly 0.15 it starts competing with the voice.

## When rendering fails

- **"media/broll/ has no video files"** — the ffmpeg renderer has nothing to work with.
  Add clips, or switch back to `RENDERER=manual`.
- **Captions out of sync** — check that the beats' `seconds` are roughly proportional
  to their spoken length. The renderer scales the total, but it cannot fix a beat
  budgeted 2 seconds for a 9-second sentence.
- **Encode succeeds, video is silent** — the voiceover synthesized but did not mix.
  Check that `script.voiceover` is not empty; an empty string produces a valid but
  silent MP3.

## Adding a third renderer

Create `renderers/<name>.js` exporting `name`, `render(item)` and `waitingHint(item)`,
then register it in `renderers/index.js`. `render` returns a media descriptor, or
`null` to mean "not ready yet, leave the item alone" — never throw for that case.
