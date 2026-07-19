---
name: video-create-publish
description: Create, render, validate, and optionally publish polished short-form videos and YouTube Shorts with Mimi Seed. Use for story-to-video production, vertical social videos, carousel-to-video adaptations, visual-quality revisions, or YouTube upload/status work where typography, human-safe cropping, motion design, asset provenance, and publish confirmation matter.
---

# Video Create Publish

Produce an intentional video rather than a slideshow of generated cards. Preserve asset provenance and publish only when explicitly authorized.

## Workflow

1. Check scope and connection.
   - Separate create/render from upload/publication; treat public or unlisted upload as irreversible.
   - Load required deferred schemas in one batch, then call `mimi_seed_status`.
   - For production, load `video_plan_from_story`, research/asset tools actually needed, `video_build_timeline`, `video_render`, `video_job_status`, and `video_validate`.
   - For YouTube, also load `youtube_upload_video`, `youtube_get_video_status`, `youtube_update_video_privacy`, and `mimi_seed_auth_start`.

2. Create the editorial and shot plan.
   - Define the audience, single takeaway, first-second hook, CTA, target aspect ratio, and maximum duration.
   - Plan shots as wide/medium/detail or scene/object/UI beats. Do not reuse one still for several consecutive scenes.
   - Read [references/visual-quality.md](references/visual-quality.md) before selecting fonts, cropping people, or adapting carousel art to video.

3. Source assets safely.
   - Treat YouTube research as reference-only metadata, never renderable media.
   - Use licensed stock, generated images, or user-owned local assets with the correct ownership/license basis.
   - Preview paid stock downloads and image generation before confirmation.
   - Generate art without text; render Korean type deterministically in the editing/rendering layer.

4. Build a video-native timeline.
   - Use `video_build_timeline` only after every selected asset passes provenance checks.
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
