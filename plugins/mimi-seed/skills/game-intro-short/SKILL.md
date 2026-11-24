---
name: game-intro-short
description: Create or revise game Shorts and short gameplay trailers from real gameplay. Use when a game introduction needs a verified player decision, payoff or match result, or when localizing gameplay, captions and narration together.
---

# Game Intro Short

## Capture a moment worth showing

1. Confirm the game, capture source or build, target language, and delivery format. Check that the build is current for the requested release. Capture a new run if existing footage shows an older build or the wrong UI language.
2. Pick one visible decision and payoff. Show the move that opens a new area, the choice that saves a run, or the play that wins a match. Start on gameplay with a short question or setup. Show the input, result and reward in that order, with enough time to read the screen.
3. For a comparison, start from the same game state and vary the relevant choice. Use matching crops and timing. Show both outcomes. For an AI match, verify who played each run and who won against the replay, game events or recorded result. Show the win you describe. State a series score only when you have verified the included matches.
4. If the user shares a reference, watch it and identify the framing, cut timing, or reveal you can adapt. Capture the user's game or use footage they have rights to publish.

## Edit and localize

- Plan the shots around the actual footage. Start with a legible shot at the key moment. Crop or enlarge the HUD change, move, or reward when it would be too small on a phone. For a top/bottom comparison, keep the key UI visible in both panels and show both outcomes before cutting away.
- Use 9:16 when delivering a vertical Short. Match the requested game UI, captions, narration and, when in scope, publishing copy. Re-record gameplay after changing the in-game language. If the game lacks that locale, report which language viewers will see.
- Write narration to match what viewers can see. If the user requests ElevenLabs, use their existing connection, check the available allowance and select a voice for the target language. Review the exported speech for timing, pronunciation and consistency with the gameplay. Leave room for informative game audio.
- Keep a production note with the build or capture source, timecodes for the decisive input and result, and the evidence behind any comparison or match claim.

## Render, review, and deliver

- For Mimi Seed rendering, use [video-create-publish](../video-create-publish/SKILL.md) for the storyboard, local asset registration, timeline, rendering and validation. Register the selected gameplay clips as local assets with their provenance. When the timeline cannot express a comparison layout or HUD crop, compose that beat locally from the recorded clips before registering it.
- Review the actual export with audio. Check the opening frame, the decisive input, each payoff and the last frame. Confirm the crop and captions are readable on a phone. Validate the MP4's aspect ratio, duration, H.264/yuv420p video and AAC audio with `video_validate` or local media inspection.
- Deliver the MP4 and note the source build, output language and verified outcome. When the user asks to publish, use the destination's account and channel settings and follow the publishing workflow in [video-create-publish](../video-create-publish/SKILL.md) for YouTube. Verify the observed publication state and link.
