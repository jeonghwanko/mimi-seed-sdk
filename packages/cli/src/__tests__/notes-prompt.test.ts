import { afterEach, describe, expect, it, vi } from 'vitest';
import { RELEASE_NOTE_TONES } from '#core/ai.js';
import { buildReleaseNotesPrompt } from '../notes.js';

// 릴리즈 노트 프롬프트의 JSON 키는 파싱 계약이다(응답을 Record<ReleaseNoteTone, string> 으로 읽는다).
// 예전엔 ko/en 프롬프트 문자열에 "concise"/"detailed"/"marketing" 이 손으로 박혀 있어서, core 의
// RELEASE_NOTE_TONES 가 바뀌어도 프롬프트만 옛 키를 요구할 수 있었다. 지금은 뼈대를 그 목록으로 조립한다.

afterEach(() => vi.unstubAllEnvs());

const COMMITS = '- feat: dark mode (dev, 2026-09-01)';

describe.each(['ko', 'en'] as const)('buildReleaseNotesPrompt (%s)', (lang) => {
  it('RELEASE_NOTE_TONES 의 모든 톤과 localized 를 JSON 키로 요구한다', () => {
    vi.stubEnv('MIMI_SEED_LANG', lang);
    const prompt = buildReleaseNotesPrompt(COMMITS, ['ja']);
    for (const key of [...RELEASE_NOTE_TONES, 'localized']) expect(prompt).toContain(`"${key}": `);
    expect(prompt).toContain('"ja": ');
  });
});

// 뼈대를 코드로 조립하도록 바꾼 리팩터링이 모델에 가는 텍스트를 바꾸지 않았음을 고정한다 (현재 톤 기준).
describe('buildReleaseNotesPrompt — 기존 프롬프트와 바이트 동일', () => {
  const localeKo = '"ja": "해당 언어로 번역된 간결한 버전"';
  const localeEn = '"ja": "the concise version, translated into that language"';

  it('ko', () => {
    vi.stubEnv('MIMI_SEED_LANG', 'ko');
    expect(buildReleaseNotesPrompt(COMMITS, ['ja'])).toBe(
      `다음 커밋 내역으로 릴리즈 노트를 3가지 톤으로 작성하세요:\n\n${COMMITS}\n\nJSON:\n{\n  "concise": "간결한 버전 (3줄 이내, 불릿)",\n  "detailed": "상세 버전 (5개 이내, 불릿)",\n  "marketing": "마케팅 버전 (열정적 톤)",\n  "localized": {\n    ${localeKo}\n  }\n}`,
    );
  });

  it('en (로케일 없음)', () => {
    vi.stubEnv('MIMI_SEED_LANG', 'en');
    expect(buildReleaseNotesPrompt(COMMITS, [])).toBe(
      `Write release notes in 3 tones from the following commit history:\n\n${COMMITS}\n\nJSON:\n{\n  "concise": "concise version (3 bullets max)",\n  "detailed": "detailed version (5 bullets max)",\n  "marketing": "marketing version (enthusiastic tone)",\n  "localized": {\n    \n  }\n}`,
    );
    vi.stubEnv('MIMI_SEED_LANG', 'en');
    expect(buildReleaseNotesPrompt(COMMITS, ['ja'])).toContain(localeEn);
  });
});
