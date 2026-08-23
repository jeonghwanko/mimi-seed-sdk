import type { VideoCaptionStyle, VideoTimeline } from './types.js';

/**
 * 쇼츠 자막 스타일 시스템 — SRT + force_style(Arial 18px) 하드코딩을 대체한다.
 *
 * 기본 preset 'shorts'는 2026 숏폼 표준(Bold Highlight 스타일)을 따른다:
 * 굵은 고딕 + 흰 글자 + 검정 외곽선(불투명 박스 없음), 9:16에서는 하단-중앙 1/3 배치,
 * `**단어**` 마크업으로 문장당 키워드 1개만 하이라이트 컬러.
 * 'box' preset은 튜토리얼용 반투명 박스 자막(Subtitle Block 스타일)이다.
 */

export type CaptionPosition = 'lower' | 'lower-middle' | 'center';

export interface ResolvedCaptionStyle {
  fontName: string;
  fontSizePx: number;
  textColor: string;
  outlineColor: string;
  highlightColor: string;
  position: CaptionPosition;
  boxed: boolean;
}

export function resolveCaptionStyle(
  width: number,
  height: number,
  style?: VideoCaptionStyle,
): ResolvedCaptionStyle {
  const preset = style?.preset ?? 'shorts';
  const vertical = height > width;
  return {
    // Malgun Gothic은 어떤 Windows에도 있는 폴백. 스킬은 설치된 굵은 고딕(Pretendard 등)을 우선 지정한다.
    fontName: style?.fontName ?? 'Malgun Gothic',
    // 세로 쇼츠 기준 height의 4.2% ≈ 81px(1080×1920) — 숏폼 권장(55~75pt)과 한국어 예능 자막(72~96px) 사이.
    fontSizePx: style?.fontSizePx ?? Math.round(height * (vertical ? 0.042 : 0.055)),
    textColor: style?.textColor ?? '#FFFFFF',
    outlineColor: style?.outlineColor ?? '#000000',
    highlightColor: style?.highlightColor ?? '#FFD400',
    position: style?.position ?? (preset === 'shorts' && vertical ? 'lower-middle' : 'lower'),
    boxed: preset === 'box',
  };
}

/** #RRGGBB → ASS &HAABBGGRR. alpha 00=불투명, FF=투명. */
export function assColor(hex: string, alpha = '00'): string {
  const match = /^#([0-9a-fA-F]{2})([0-9a-fA-F]{2})([0-9a-fA-F]{2})$/.exec(hex);
  if (!match) throw new Error(`잘못된 색상 형식입니다(#RRGGBB): ${hex}`);
  const [, r, g, b] = match;
  return `&H${alpha}${b}${g}${r}`.toUpperCase();
}

/** ASS 태그·마크업 주입을 막는다. `**`는 하이라이트 마크업으로 살려둔다. */
function sanitizeCaptionText(value: string): string {
  return value
    .replace(/\r/g, '')
    .replace(/\n{2,}/g, '\n')
    .replace(/\\/g, '＼')
    .replace(/</g, '＜')
    .replace(/>/g, '＞')
    .replace(/{/g, '｛')
    .replace(/}/g, '｝')
    .trim();
}

function assTime(seconds: number): string {
  const cs = Math.max(0, Math.round(seconds * 100));
  const hours = Math.floor(cs / 360_000);
  const minutes = Math.floor((cs % 360_000) / 6_000);
  const secs = Math.floor((cs % 6_000) / 100);
  const centis = cs % 100;
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${hours}:${pad(minutes)}:${pad(secs)}.${pad(centis)}`;
}

/** `**단어**` → 하이라이트 컬러 런. 줄바꿈은 \N. */
function renderEventText(raw: string, style: ResolvedCaptionStyle): string {
  const primary = assColor(style.textColor);
  const highlight = assColor(style.highlightColor);
  return sanitizeCaptionText(raw)
    .replace(/\*\*([^*\n]+)\*\*/g, `{\\1c${highlight}&}$1{\\1c${primary}&}`)
    .replace(/\n/g, '\\N');
}

export function formatAss(timeline: VideoTimeline, style: ResolvedCaptionStyle): string {
  const { width, height } = timeline;
  const vertical = height > width;
  const alignment = style.position === 'center' ? 5 : 2;
  const marginX = Math.round(width * 0.09);
  const marginV = style.position === 'center'
    ? 0
    : style.position === 'lower-middle'
      ? Math.round(height * 0.28)
      : Math.round(height * (vertical ? 0.12 : 0.08));
  // 한글은 받침 내부 공간이 좁아 외곽선을 폰트 크기의 5.5%로 제한한다. box는 outline 값이 패딩이 된다.
  const outlinePx = style.boxed
    ? Math.round(style.fontSizePx * 0.25)
    : Math.max(2, Math.round(style.fontSizePx * 0.055));
  const outlineColour = style.boxed ? assColor(style.outlineColor, '50') : assColor(style.outlineColor);

  const events: string[] = [];
  let cursor = 0;
  for (const scene of timeline.scenes) {
    const start = cursor;
    cursor += scene.durationSec;
    const text = renderEventText(scene.onScreenText ?? '', style);
    if (!text) continue;
    events.push(`Dialogue: 0,${assTime(start)},${assTime(cursor)},Caption,,0,0,0,{\\fad(120,80)}${text}`);
  }
  if (events.length === 0) return '';

  return [
    '[Script Info]',
    'ScriptType: v4.00+',
    `PlayResX: ${width}`,
    `PlayResY: ${height}`,
    'WrapStyle: 0',
    'ScaledBorderAndShadow: yes',
    '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    `Style: Caption,${style.fontName},${style.fontSizePx},${assColor(style.textColor)},${assColor(style.textColor)},${outlineColour},&H80000000,-1,0,0,0,100,100,0,0,${style.boxed ? 3 : 1},${outlinePx},0,${alignment},${marginX},${marginX},${marginV},1`,
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Text',
    ...events,
    '',
  ].join('\n');
}

export const __testing = { sanitizeCaptionText, assTime, renderEventText };
