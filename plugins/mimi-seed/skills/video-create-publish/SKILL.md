---
name: video-create-publish
description: Create, render, validate, and optionally publish polished short-form videos and YouTube Shorts with Mimi Seed. Use for story-to-video production, vertical social videos, carousel-to-video adaptations, visual-quality revisions, or YouTube upload/status work. Prefer Runway web video generation with existing subscription credits, with Grok web subscription as the fallback; use an agent-authored storyboard and local rendering.
---

# Video Create Publish

Produce an intentional video rather than a slideshow of generated cards. Preserve asset provenance and publish only when explicitly authorized.

## Workflow

1. Check scope and connection.
   - Separate create/render from upload/publication; treat public or unlisted upload as irreversible.
   - Load required deferred schemas in one batch, then call `mimi_seed_status`.
   - For production, load `video_save_plan` (or `video_plan_from_story`), research/asset tools actually needed, `video_build_timeline`, `video_render`, `video_job_status`, and `video_validate`.
   - For YouTube, also load `youtube_get_content_insights` when planning from channel performance, plus `youtube_upload_video`, `youtube_get_video_status`, `youtube_update_video_privacy`, and `mimi_seed_auth_start`.

   - When using content insights, compare the current and equal-length preceding period, separate facts from hypotheses, and choose one experiment with evidence IDs and a measurable success metric. Treat insufficient data as a blocker to naming a winner; do not infer CTR or retention, and compare upload ages before interpreting view differences.
   - Save the agent-authored hook/storyboard with `video_save_plan`, recording the evidence rationale in the story or a sidecar production note. The insights read has no AI API cost and does not generate a storyboard.

2. Create the editorial and shot plan — subscription-only by default.
   - Default to the zero-API-cost path: author the storyboard yourself (you are the subscription-billed model) and save it with `video_save_plan`. Call `video_plan_from_story` only when the user explicitly wants it and `ANTHROPIC_API_KEY` is configured — it bills a metered API key.
   - Define the audience, single takeaway, first-second hook, CTA, target aspect ratio, and maximum duration. Scene `durationSec` values must sum exactly to `targetDurationSec`.
   - Plan shots as wide/medium/detail or scene/object/UI beats. Do not reuse one still for several consecutive scenes.
   - Read [references/visual-quality.md](references/visual-quality.md) before selecting fonts, writing captions, cropping people, or adapting carousel art to video.

3. Source assets — Runway web first, Grok web as the fallback.
   - For generated video clips, use the user's existing Runway web subscription and available credits by default. Use the existing Grok web subscription when Runway is unavailable, its allowance is exhausted, or a clip does not meet the shot plan. A user's explicit provider choice overrides this default. Do not generate the same shot on both services routinely.
   - Use the signed-in web UI through available browser tools; inspect the current allowance and any displayed generation cost before submitting. Existing credits may be consumed for an authorized production task. Do not purchase credits, upgrade a plan, enable overage, or silently switch to a metered API. Web subscriptions and API billing are separate. If both existing allowances are unavailable, save the shot prompts and report the blocker.
   - There is no native Runway/Grok generation adapter in the SDK. Do not invent MCP tool names or treat a web subscription as an API key. When browser access is unavailable, prepare the prompts for the user to generate and export the clips through the selected web service.
   - Save exported clips under the video project's assets directory and register each with `video_add_local_asset`. Record the actual provider, prompt, available model name, and ownership/license basis in the asset's supported provenance fields (for example, license/attribution) or a sidecar production note. Use `sourceType: "user-owned"` only when the user's rights support it; otherwise use `licensed` with the actual license. Never invent license terms or declare all generated media royalty-free.
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
