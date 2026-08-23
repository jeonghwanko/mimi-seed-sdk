# Visual quality gate

Use this gate for every vertical video, especially when adapting 4:5 carousel art to 9:16.

## Typography

- Inventory project and system fonts before layout. Record the exact font files used.
- Define a two-role system: a distinctive Korean display face for hooks and a restrained body/caption face. Use no more than two families and three weights.
- Do not use Malgun Gothic, Gulim, Dotum, Arial, or an unspecified default as the display face. Accept them only as an emergency body fallback and report the fallback.
- Prefer a licensed project font. When only Windows Korean fonts exist, pair `NotoSerifKR-VF` Bold/Black for display with `NotoSansKR-VF` Medium/Bold for body instead of mixing in Malgun Gothic.
- For text designed into artwork on a 1080px-wide vertical video, start at 88px for a hook, 58px for sub-copy, and 42px for minor labels. Shorten copy before shrinking. Burned captions follow the "Burned captions" section below instead.
- Break lines by meaning, not character count. Keep a headline to two lines when possible and avoid single-word orphan lines.
- Set deliberate line height and tracking; do not let library defaults determine either. Use contrast, scale, and spacing before adding pills, outlines, or decorative English labels.
- Never ask an image model to render final Korean text.

## Burned captions (shorts style)

The renderer burns `onScreenText` as ASS captions. Defaults follow the dominant 2026 short-form
grammar: bold face, white fill, black outline at 5.5% of the font size (no opaque box), subtle
fade-in, lower-middle third placement on 9:16 (clear of the Shorts bottom UI and right-side
buttons), font size ≈ 4.2% of frame height (81px at 1080×1920).

- **Density**: 3–5 words per screen, at most 2 lines. Four or more lines reads as a wall. Break
  lines by meaning with `\n`, never by character count.
- **Highlight**: exactly one keyword per caption via `**keyword**` (default `#FFD400` yellow).
  A fully highlighted sentence is the same as no highlight. Numbers and the payoff word are the
  best highlight targets.
- **Not every scene gets text.** Caption the hook, the evidence, and the CTA; let at least one
  scene breathe. A caption on every beat is a lecture, not a short.
- **Font**: inventory installed fonts and pass a bold Korean display gothic as
  `captionStyle.fontName` (Pretendard, S-Core Dream, 검은고딕 in preference order). The built-in
  fallback is Malgun Gothic Bold — usable for captions, but report the fallback. Never rely on
  thin/regular weights for burned captions.
- **Presets**: `shorts` (default) for outline captions with highlights; `box` for tutorial/step
  content that needs a translucent subtitle block. Do not use `box` for hook-driven shorts.
- **Position**: keep the default `lower-middle` on 9:16. Override to `center` only for a
  single-scene title card; `lower` sits closer to platform UI and is for 16:9/1:1.
- **QC**: on the contact sheet, verify captions against this section — size, line count,
  highlight count, and that no caption collides with faces or platform UI.

## Human-safe cropping

1. Preview the source at original resolution.
2. Record the intended people, face/eye focal points, and subject bounds before cropping.
3. Produce a separate crop for every target aspect ratio. Never reuse a 4:5 crop for 9:16 or vice versa.
4. Keep the complete face and chin, with roughly 6–12% headroom. Do not cut at the neck or through facial features.
5. If `cover` cannot preserve the important subject, use `contain` with a designed background, a blur extension, generative expansion, or a new asset. Do not accept a headless torso.
6. For multiple people, preserve every person named or implied by the scene unless the shot plan explicitly isolates one.
7. Inspect the rendered frame again; source-safe coordinates can still fail after masks, overlays, or zoom animation.

## Composition and motion

- Establish one visual hierarchy per frame: hook, evidence, or CTA. Avoid equal-weight blocks.
- Keep key text and faces away from top/bottom platform UI zones; use at least 96px side margins and generous vertical safe zones.
- Use at least three shot scales across the whole video and at least two motion types.
- A static image with identical zoom on every scene is a draft, not a final short.
- Put the promised result or conflict in the first second. Avoid logo-first intros.
- Animate to explain: follow a receipt, reveal a missed discount, change a counter, or demonstrate the product action. Decorative motion alone does not count.
- Keep CTA branding brief and behavior-specific; show what to do next rather than ending on a logo alone.

## Review record

Save a contact sheet and a small review manifest beside the final video containing:

- display/body font files and weights;
- target aspect ratio and safe-zone values;
- each human scene with face reviewed `true` and crop method;
- motion types used;
- original-resolution frames inspected;
- final codec/duration validation result.

Fail the visual review if any required field is absent or merely inferred from a thumbnail.
