// 사람이 읽는 터미널 출력의 언어 — CLI 와 mcp-server setup bin 이 **같은 이 함수**로 고른다.
//
// 우선순위: MIMI_SEED_LANG 환경변수 > ~/.mimi-seed/settings.json { lang } > 시스템 로캘(ko* 면 'ko', 그 외 'en').
//
// 환경변수가 1순위인 이유: CLI 마법사가 mcp-server 의 setup bin 을 spawn 할 때 MIMI_SEED_LANG 을
// 물려준다(cli/src/mcp-bin.ts). 마법사와 자식 프로세스의 언어가 어긋나면 온보딩 도중에 언어가
// 뒤섞인다 — 예전엔 두 패키지가 이 규칙을 각자 들고 있었다.
//
// 마지막 단계가 시스템 로캘인 이유: 설정 없이 `npx mimi-seed check --local` 을 처음 돌린 영어권 사용자가
// 한국어 보고서를 받지 않도록. 로캘이 없거나 C/POSIX 면 영어다.
//
// MCP 도구의 description / 도구 출력 텍스트는 여기 대상이 아니다 — 그건 사람이 아니라 LLM 이
// 읽는 인터페이스다. settings.json 의 **쓰기**는 CLI(settings.ts)가 소유한다.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export type Lang = 'ko' | 'en';
/** 로캘로도 정할 수 없을 때(C/POSIX, 알 수 없는 로캘)의 언어. */
export const DEFAULT_LANG: Lang = 'en';

export function isLang(v: unknown): v is Lang {
  return v === 'ko' || v === 'en';
}

/** ~/.mimi-seed/settings.json 경로. */
export function settingsPath(home: string = os.homedir()): string {
  return path.join(home, '.mimi-seed', 'settings.json');
}

/**
 * 시스템 로캘의 언어. POSIX 우선순위(LC_ALL > LC_MESSAGES > LANG)를 따르고, 셋 다 없으면(Windows 등)
 * Intl 이 보고하는 사용자 로캘을 본다. 한국어 로캘만 'ko', 나머지는 전부 'en'.
 */
export function systemLang(env: NodeJS.ProcessEnv = process.env): Lang {
  for (const key of ['LC_ALL', 'LC_MESSAGES', 'LANG'] as const) {
    const value = env[key]?.trim();
    if (!value) continue;
    if (/^(?:C|POSIX)(?:[._@]|$)/i.test(value)) return DEFAULT_LANG;
    return /^ko(?:[_.@-]|$)/i.test(value) ? 'ko' : 'en';
  }
  try {
    return /^ko(?:-|$)/i.test(Intl.DateTimeFormat().resolvedOptions().locale) ? 'ko' : 'en';
  } catch {
    return DEFAULT_LANG;
  }
}

/** 우선순위: 환경변수 > ~/.mimi-seed/settings.json > 시스템 로캘. 파일이 없거나 깨져도 로캘로 폴백. */
export function resolveLang(home: string = os.homedir()): Lang {
  const env = process.env.MIMI_SEED_LANG?.toLowerCase();
  if (isLang(env)) return env;
  try {
    const saved = (JSON.parse(fs.readFileSync(settingsPath(home), 'utf-8')) as { lang?: unknown } | null)?.lang;
    if (isLang(saved)) return saved;
  } catch {
    // 파일 없음 / 권한 없음 / JSON 깨짐 — 전부 로캘로.
  }
  return systemLang();
}
