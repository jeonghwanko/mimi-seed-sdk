// 인터랙티브 setup bin 의 출력 언어.
//
// CLI 쪽 `packages/cli/src/settings.ts` 의 resolveLang 과 **같은 규칙**이어야 한다:
//   MIMI_SEED_LANG 환경변수 > ~/.mimi-seed/settings.json { lang } > 'ko'.
//
// 환경변수가 1순위인 이유: CLI 마법사가 이 패키지의 setup bin 을 spawn 할 때 MIMI_SEED_LANG 을
// 물려준다. 마법사와 자식 프로세스의 언어가 어긋나면 온보딩 도중에 언어가 뒤섞인다.
//
// MCP 도구의 description / 도구 출력 텍스트는 여기 대상이 아니다 — 그건 사람이 아니라 LLM 이
// 읽는 인터페이스다. 이 모듈은 **터미널에 찍히는 사람용 문자열**에만 쓴다.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export type Lang = 'ko' | 'en';
export const DEFAULT_LANG: Lang = 'ko';

export function isLang(v: unknown): v is Lang {
  return v === 'ko' || v === 'en';
}

/** 우선순위: 환경변수 > ~/.mimi-seed/settings.json > 기본값(ko). 파일이 없거나 깨져도 ko 로 폴백. */
export function resolveLang(home: string = os.homedir()): Lang {
  const env = process.env.MIMI_SEED_LANG?.toLowerCase();
  if (isLang(env)) return env;
  try {
    const raw = fs.readFileSync(path.join(home, '.mimi-seed', 'settings.json'), 'utf-8');
    const saved = (JSON.parse(raw) as { lang?: unknown }).lang;
    if (isLang(saved)) return saved;
  } catch {
    // 파일 없음 / 권한 없음 / JSON 깨짐 — 전부 기본값으로.
  }
  return DEFAULT_LANG;
}
