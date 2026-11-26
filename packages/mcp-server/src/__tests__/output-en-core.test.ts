import { afterEach, describe, expect, it, vi } from 'vitest';
import { CONFIRM_PREVIEW_MARKER, confirmPreview, previewValue } from '../lib/tool-registrar.js';
import { appStoreAuthHint, playAuthHint } from '../helpers.js';

// 공통 경로의 출력이 언어를 따른다 — 파괴적 도구 dry-run preview(모든 D 도구 첫 호출)와 스토어 인증 안내.
// 언어는 호출할 때 읽으므로, 같은 프로세스에서 env 만 바꿔도 다음 호출부터 바뀐다.
afterEach(() => { vi.unstubAllEnvs(); });

const HANGUL = /[가-힣]/;
const text = (r: ReturnType<typeof confirmPreview>) => (r.content[0] as { text: string }).text;

describe('dry-run preview', () => {
  it('영어 모드: 한글 없이 같은 구조(마커 · 인자 · confirm 안내)', () => {
    vi.stubEnv('MIMI_SEED_LANG', 'en');
    const out = text(confirmPreview('store_delete', { packageName: 'com.example.app', token: 'secret-value' }));
    expect(out).not.toMatch(HANGUL);
    expect(out.startsWith(CONFIRM_PREVIEW_MARKER)).toBe(true);
    expect(out).toContain('packageName: com.example.app');
    expect(out).toContain('token: (redacted)'); // 비밀 가림은 언어와 무관
    expect(out).toContain('`confirm: true`');
  });

  it('인자가 없으면 (none), 긴 값은 영어 단위로 줄인다', () => {
    vi.stubEnv('MIMI_SEED_LANG', 'en');
    expect(text(confirmPreview('store_delete', {}))).toContain('(none)');
    expect(previewValue('note', 'x'.repeat(250))).toMatch(/\(250 chars\)$/);
  });

  it('한국어 모드는 원문 그대로', () => {
    vi.stubEnv('MIMI_SEED_LANG', 'ko');
    const out = text(confirmPreview('store_delete', {}));
    expect(out).toContain('아직 실행하지 않았다');
    expect(previewValue('note', 'x'.repeat(250))).toMatch(/\(250자\)$/);
  });
});

describe('스토어 인증 안내', () => {
  it('영어 모드에는 한글이 없고 복구 명령은 그대로다', () => {
    vi.stubEnv('MIMI_SEED_LANG', 'en');
    expect(playAuthHint()).not.toMatch(HANGUL);
    expect(playAuthHint()).toContain('npx -y @yoonion/mimi-seed-mcp mimi-seed-playstore-auth');
    expect(appStoreAuthHint()).not.toMatch(HANGUL);
    expect(appStoreAuthHint()).toContain('npx -y @yoonion/mimi-seed-mcp mimi-seed-appstore-auth');
  });

  it('언어는 호출할 때 읽는다', () => {
    vi.stubEnv('MIMI_SEED_LANG', 'ko');
    expect(playAuthHint()).toMatch(HANGUL);
    vi.stubEnv('MIMI_SEED_LANG', 'en');
    expect(playAuthHint()).not.toMatch(HANGUL);
  });
});
