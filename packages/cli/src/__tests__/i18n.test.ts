import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resolveLang, isLangUnset, readSettings, writeSettings, DEFAULT_LANG } from '../settings.js';
import { t } from '../i18n.js';
import { CREDENTIALS, credLabel, credObtain } from '../credentials.js';

let home: string;

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'mimi-lang-'));
  vi.stubEnv('MIMI_SEED_LANG', '');
});

afterEach(() => {
  fs.rmSync(home, { recursive: true, force: true });
  vi.unstubAllEnvs();
});

describe('언어 설정', () => {
  it('기본값은 한국어', () => {
    expect(DEFAULT_LANG).toBe('ko');
    expect(resolveLang(home)).toBe('ko');
  });

  it('settings.json 에 저장하고 읽는다', () => {
    writeSettings({ lang: 'en' }, home);
    expect(readSettings(home).lang).toBe('en');
    expect(resolveLang(home)).toBe('en');
  });

  // CLI 가 setup bin 을 spawn 할 때 MIMI_SEED_LANG 을 물려준다 — 그 우선순위가 지켜져야
  // 마법사(영어)와 자식 프롬프트(한국어)가 어긋나지 않는다.
  it('환경변수가 settings.json 을 이긴다', () => {
    writeSettings({ lang: 'ko' }, home);
    vi.stubEnv('MIMI_SEED_LANG', 'en');
    expect(resolveLang(home)).toBe('en');
  });

  it('알 수 없는 값은 무시하고 기본값으로', () => {
    vi.stubEnv('MIMI_SEED_LANG', 'jp');
    expect(resolveLang(home)).toBe('ko');
  });

  it('isLangUnset — 한 번도 안 골랐을 때만 true (= setup 이 물어봐야 할 때)', () => {
    expect(isLangUnset(home)).toBe(true);
    writeSettings({ lang: 'ko' }, home);
    expect(isLangUnset(home)).toBe(false);
  });

  it('settings.json 이 깨져 있어도 죽지 않는다', () => {
    fs.mkdirSync(path.join(home, '.mimi-seed'), { recursive: true });
    fs.writeFileSync(path.join(home, '.mimi-seed', 'settings.json'), '{ broken');
    expect(resolveLang(home)).toBe('ko');
  });

  it('writeSettings 는 기존 키를 보존한다', () => {
    writeSettings({ lang: 'en' }, home);
    writeSettings({}, home);
    expect(readSettings(home).lang).toBe('en');
  });
});

describe('카탈로그', () => {
  it('언어에 따라 다른 문자열이 나온다', () => {
    vi.stubEnv('MIMI_SEED_LANG', 'ko');
    const ko = t().setup.statusTitle;
    vi.stubEnv('MIMI_SEED_LANG', 'en');
    const en = t().setup.statusTitle;
    expect(ko).not.toBe(en);
    expect(en).toBe('Connection status');
  });

  // t() 가 모듈 로드 시점이 아니라 호출 시점에 언어를 읽어야, 마법사가 첫 질문에서
  // 언어를 고른 직후부터 그 언어로 출력된다.
  it('언어를 바꾸면 같은 프로세스 안에서 즉시 반영된다', () => {
    vi.stubEnv('MIMI_SEED_LANG', 'ko');
    expect(t().doctor.secEnv).toBe('로컬 환경');
    vi.stubEnv('MIMI_SEED_LANG', 'en');
    expect(t().doctor.secEnv).toBe('Environment');
  });
});

describe('자격증명 레지스트리 — 양쪽 언어', () => {
  it('12개 모두 label / obtain 이 두 언어로 채워져 있다', () => {
    for (const spec of CREDENTIALS) {
      expect(spec.label.ko, `${spec.id}: label.ko`).toBeTruthy();
      expect(spec.label.en, `${spec.id}: label.en`).toBeTruthy();
      expect(spec.obtain.ko.length, `${spec.id}: obtain.ko`).toBeGreaterThan(0);
      expect(spec.obtain.en.length, `${spec.id}: obtain.en`).toBeGreaterThan(0);
    }
  });

  it('credLabel / credObtain 이 활성 언어를 따른다', () => {
    const appstore = CREDENTIALS.find((c) => c.id === 'appstore')!;
    expect(credLabel(appstore, 'ko')).toBe(appstore.label.ko);
    expect(credLabel(appstore, 'en')).toBe(appstore.label.en);
    expect(credObtain(appstore, 'en')).toEqual(appstore.obtain.en);
  });

  it('영어 obtain 이 한국어를 그대로 복사한 게 아니다 (실제로 번역돼 있다)', () => {
    const hasHangul = (s: string) => /[가-힣]/.test(s);
    for (const spec of CREDENTIALS) {
      expect(
        spec.obtain.en.some(hasHangul),
        `${spec.id}: obtain.en 에 한글이 남아 있음`,
      ).toBe(false);
      expect(hasHangul(spec.label.en), `${spec.id}: label.en 에 한글이 남아 있음`).toBe(false);
    }
  });
});
