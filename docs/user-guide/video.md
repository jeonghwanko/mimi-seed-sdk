# Video Production and YouTube Publishing

Mimi Seed turns a written story into a local video project — storyboard, sourced assets, timeline, rendered
MP4 — and can publish the result to your YouTube channel. Everything before publishing happens **on your
machine**: FFmpeg does the rendering, and the project folder is the source of truth.

Two boundaries decide most of what follows:

- **Reference is not media.** YouTube research collects public metadata for structure, hook, and pacing only.
  It is permanently marked reference-only and is never downloaded or rendered.
- **Publishing is irreversible.** Uploads default to private; a public or unlisted video needs an explicit,
  same-turn go-ahead.

## Prerequisites

| Capability | Needs |
|---|---|
| Storyboard, research synthesis | `ANTHROPIC_API_KEY` ([reference](../credentials.md#anthropic-api-key)) |
| Reference research on YouTube | `YOUTUBE_API_KEY` |
| Licensed stock search and download | `PEXELS_API_KEY` |
| Generated scene images | `OPENAI_API_KEY` (paid — preview first) |
| Rendering and validation | FFmpeg + ffprobe on `PATH`, or `MIMI_SEED_FFMPEG_PATH` / `MIMI_SEED_FFPROBE_PATH` |
| YouTube upload, status, privacy | Google sign-in **with the `youtube` scope** |

Each key is optional on its own — you only need the ones for the steps you actually run. Add the YouTube scope
without touching your other grants:

```bash
npx mimi-seed auth login --domains youtube
```

Re-authorizing is incremental: existing Firebase/Play/AdMob grants are kept.

## 1. Plan the video

```text
Turn this story into a vertical 30-second video project under ./marketing/launch-video.
Audience: existing users. One takeaway: the new offline mode. Show me the scene plan before anything else.
```

`video_plan_from_story` writes `project.json` plus the asset, research, and render folders. An existing
`project.json` is never overwritten without `overwrite=true`, so re-running is safe.

Decide up front — the agent should ask if you don't say: audience, the single takeaway, the first-second hook,
the call to action, aspect ratio, and maximum duration.

## 2. Research (optional, reference-only)

```text
Research how similar app-feature Shorts are structured, then synthesize a direction brief.
```

- `video_research_youtube` → `research/youtube.json`, every entry marked reference-only.
- `video_search_stock_assets` → `research/pexels.json` (search only; downloading is a separate, confirmed step).
- `video_synthesize_research` → `research/brief.json`, combining that metadata with any notes **you** made from
  actually watching something.

The synthesis tool works from titles, descriptions, and your notes. It does not watch frames or audio and must
not claim it did, so treat its output as a direction hypothesis — abstract patterns to try, plus what not to
copy — rather than proof of what works.

## 3. Source assets — provenance decides what can be rendered

| Source | Tool | Rule |
|---|---|---|
| Licensed stock | `video_download_stock_assets` | Preview first; call again with `confirm=true`. Official Pexels hosts only, 100 MB/file, 5 per call |
| Generated image | `video_generate_image` | `confirm=false` returns the plan; generation costs money, so confirm explicitly. Only the local path comes back — never image bytes |
| Your own footage | `video_add_local_asset` | Absolute path + the license/ownership basis, recorded in `assets.json` |

Only assets recorded in `assets.json` with `allowedForRendering=true` — and not reference-only — can enter a
timeline. A reference video becoming publicly viewable does not grant reuse rights.

> Generate artwork **without text** and let the render layer burn in the captions. Text drawn inside a
> generated image cannot be corrected, and Korean type in particular renders unreliably.

## 4. Build the timeline

```text
Build the timeline from the approved assets: scene order, per-scene duration, and the on-screen line for each.
```

`video_build_timeline` writes `timeline.json`. On-screen text becomes burned-in captions at render time, so
review the wording here rather than after rendering.

Aim for a video, not a slideshow: vary the motion (subject-aware pan, text reveal, object animation, match cut,
UI capture), avoid the same center zoom on every scene, keep transitions short, and let narration set scene
length. Do not reuse one still across consecutive scenes.

## 5. Render

`video_render` previews the plan first; with `confirm=true` it starts a local FFmpeg job and returns a `jobId`
immediately. Poll `video_job_status` for progress and the output's absolute path — a failed job returns the tail
of the log.

A render that outlives the MCP client's timeout is **not** a failed render. Check the job status before
starting another one.

## 6. Validate before anyone sees it

```text
Validate the finished file, then give me a contact sheet: opening frame, every scene boundary, the densest
caption, and the CTA.
```

`video_validate` runs ffprobe on the final absolute path and flags anything that is not H.264 / yuv420p, plus
duration, resolution, and audio problems.

A codec pass is not a quality pass. Inspect every frame containing a person at full resolution and reject
headless bodies, clipped faces, unsafe headroom, illegible type, or captions that would sit under the
platform's own UI. Then watch the whole thing with sound.

## 7. Publish to YouTube

```text
Upload the finished file as private. Do not make it public.
```

- `youtube_upload_video` defaults to **private**. `public` / `unlisted` additionally require `confirmVisible=true`
  and your explicit authorization in the same turn.
- Set `shortsOnly=true` for a Shorts submission, and declare realistic synthetic media accurately.
- Poll `youtube_get_video_status` until processing finishes, then confirm the privacy state is what you asked
  for. `youtube_update_video_privacy` changes it later under the same confirmation rule.

**If the upload call times out, the result is unknown.** The file streams directly, so YouTube may finish after
your client stops waiting. Check YouTube Studio for a matching recent title, or reconcile with
`youtube_get_video_status` if a `videoId` came back. Never auto-retry — that is how duplicates happen.

## Operations checklist

- Takeaway, hook, aspect ratio, and duration agreed before the storyboard
- Every asset has a recorded license or ownership basis
- No reference-only material anywhere in the timeline
- Captions proofread in `timeline.json`, not after the render
- Human frames reviewed at full resolution
- `video_validate` clean, and the whole video watched with sound
- Uploaded private first; visibility changed only on explicit request
- Final privacy state verified after processing

## Failure recovery

| Symptom | What to do |
|---|---|
| Render job never appears in `video_job_status` | Confirm FFmpeg/ffprobe are on `PATH` or set `MIMI_SEED_FFMPEG_PATH` / `MIMI_SEED_FFPROBE_PATH` |
| Render fails immediately | Read the returned log tail; most causes are a missing asset path or an unsupported source file |
| Timeline rejects an asset | Its `assets.json` entry lacks provenance or is reference-only — re-add it with `video_add_local_asset` and the license basis |
| Stock download refused | Only official Pexels media hosts are allowed, 100 MB per file and 5 files per call |
| Upload returns an auth error | `npx mimi-seed auth login --domains youtube`, then retry the upload only after checking Studio |
| Upload timed out | Check the channel first; reconcile with `youtube_get_video_status` before any retry |

## Related

- [Social publishing](social.md) — announcing the release on Facebook, Instagram, and Threads
- [Store operations](stores.md) — the store-side release the video usually accompanies
- [Credential reference](../credentials.md) — where each API key comes from
- [Agent guide](../agent-guide.md) — the exact tool call order an agent should follow
