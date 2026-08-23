---
name: video-create-publish
description: Create, render, validate, and optionally publish polished short-form videos and YouTube Shorts with Mimi Seed. Use for story-to-video production, vertical social videos, carousel-to-video adaptations, visual-quality revisions, or YouTube upload/status work where typography, shorts-style burned captions, human-safe cropping, motion design, asset provenance, and publish confirmation matter. Defaults to a zero-API-cost path (agent-authored storyboard via video_save_plan, codex CLI image generation) that runs on subscription tokens only.
---

# Video Create Publish

Produce an intentional video rather than a slideshow of generated cards. Preserve asset provenance and publish only when explicitly authorized.

## Workflow

1. Check scope and connection.
   - Separate create/render from upload/publication; treat public or unlisted upload as irreversible.
   - Load required deferred schemas in one batch, then call `mimi_seed_status`.
   - For production, load `video_save_plan` (or `video_plan_from_story`), research/asset tools actually needed, `video_build_timeline`, `video_render`, `video_job_status`, and `video_validate`.
   - For YouTube, also load `youtube_upload_video`, `youtube_get_video_status`, `youtube_update_video_privacy`, and `mimi_seed_auth_start`.

2. Create the editorial and shot plan — subscription-only by default.
   - Default to the zero-API-cost path: author the storyboard yourself (you are the subscription-billed model) and save it with `video_save_plan`. Call `video_plan_from_story` only when the user explicitly wants it and `ANTHROPIC_API_KEY` is configured — it bills a metered API key.
   - Define the audience, single takeaway, first-second hook, CTA, target aspect ratio, and maximum duration. Scene `durationSec` values must sum exactly to `targetDurationSec`.
   - Plan shots as wide/medium/detail or scene/object/UI beats. Do not reuse one still for several consecutive scenes.
   - Read [references/visual-quality.md](references/visual-quality.md) before selecting fonts, writing captions, cropping people, or adapting carousel art to video.

3. Source assets safely — prefer subscription/free providers.
   - Treat YouTube research as reference-only metadata, never renderable media. `video_synthesize_research` bills `ANTHROPIC_API_KEY`; on the free path, synthesize the brief yourself.
   - Generated images: `video_generate_image` bills the metered `OPENAI_API_KEY`. On the free path, generate through the local `codex` CLI instead (ChatGPT subscription; its `image_generation` feature is stable):
     `codex exec -s workspace-write -C "<projectDir>" "이미지 생성 도구로 <scene visualPrompt>를 1024x1536 세로 이미지로 생성해 assets/generated/<scene-id>.png 로 저장해줘. 이미지 안에 글자는 넣지 마."`
     Then register each file with `video_add_local_asset` (`sourceType: "user-owned"`, license noting it was generated with the user's own Codex subscription). For 9:16 output keep subjects centered — the renderer cover-crops roughly 9% off each side of a 1024×1536 frame.
   - Stock (`video_search_stock_assets`/`video_download_stock_assets`) uses the free Pexels API tier; preview downloads before confirmation.
   - Generate art without text; render Korean type deterministically in the rendering layer.

4. Build a video-native timeline with shorts-grade captions.
   - Use `video_build_timeline` only after every selected asset passes provenance checks.
   - `onScreenText` is burned as styled captions (bold face, white fill, black outline, lower-middle third on 9:16 — the current dominant short-form style). Write it like captions, not paragraphs: 3–5 words per screen, at most 2 lines, break lines by meaning with `\n`.
   - Highlight exactly one keyword per caption with `**keyword**` (rendered in the highlight color, default `#FFD400`). Never wrap a whole sentence.
   - Not every scene needs text — reserve captions for hook, evidence, and CTA beats; a silent breathing scene is part of the rhythm.
   - `captionStyle`: inventory installed fonts first and pass a distinctive bold Korean gothic as `fontName` (e.g. Pretendard, S-Core Dream, 검은고딕) when available; the default falls back to Malgun Gothic Bold — acceptable, but report the fallback. Use `preset: "box"` only for tutorial/step content that needs a translucent subtitle block.
   - Use at least two purposeful motion devices such as subject-aware pan, text reveal, object animation, match cut, progress change, or product/UI capture.
   - Avoid applying the same center zoom to every scene. Keep transitions brief and let narration determine scene duration.

5. Render and review.
   - Preview the timeline, then call `video_render` only after confirmation when the tool requires it.
   - Poll `video_job_status`; do not assume a timed-out render failed.
   - Create a frame contact sheet covering the opening frame, every scene boundary, densest caption, and CTA.
   - Inspect all human-containing frames at original resolution. Reject headless bodies, clipped faces, cut chins, unsafe headroom, hidden product details, illegible type, or captions under platform UI.

6. Validate.
   - Run `video_validate` on the final absolute path.
   - Require H.264/yuv420p video, usable audio, intended aspect ratio, duration, and no validation issues.
   - Review the whole video with sound. A valid codec is not a visual-quality pass.

7. Upload only with authority.
   - Default YouTube uploads to private. Use public/unlisted plus `confirmVisible=true` only after same-turn explicit authorization.
   - Set `shortsOnly=true` for a Shorts request and declare realistic synthetic media accurately.
   - After upload, poll `youtube_get_video_status` until processing succeeds and verify the final privacy state.

## Failure rules

- Stop before rendering if a human crop has not been visually reviewed or asset provenance is missing.
- Stop before upload on expired YouTube auth, an unresolved validation issue, or a mismatched channel.
- If upload times out, reconcile with channel state before retrying; never create a duplicate automatically.
- Do not call a static-card sequence “finished video” unless the user explicitly requested a slideshow.
