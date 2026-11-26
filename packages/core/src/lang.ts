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
// mcp-server 도 이 함수로 언어를 고른다: 도구 · 파라미터 설명(lib/tool-text.ts — 원문 한국어, en 이면
// i18n/tools-en 번역표), 도구 메뉴 리소스, 인증 에러 문구(auth/errors.ts 의 authText())와 OAuth 콜백 페이지.
// 도구가 **돌려주는** 텍스트도 catalog()(아래)로 언어를 따른다 — mcp-server output-i18n.test.ts 가 src 전체에서
// ko 블록 밖 한국어를 막는다(출력이 아닌 한국어 — AI 프롬프트 등 — 만 이유와 함께 예외).
// settings.json 의 **쓰기**는 CLI(settings.ts)가 소유한다.

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
    // Intl 이 로캘을 못 내면(ICU 없는 빌드 등) 기본 언어로 — 언어는 문구 선택일 뿐이다
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

/**
 * 파일별 ko/en 문구 카탈로그 — CLI 와 mcp-server 가 같은 이 함수를 쓴다.
 *
 *   const M = catalog(
 *     { title: '배포', done: (n: number) => `${n}개 완료` },
 *     { title: 'Deploy', done: (n: number) => `${n} done` },
 *   );
 *   log(M().title);
 *
 * `en` 은 `ko` 와 같은 타입이어야 하므로 키를 빠뜨리면 **컴파일이 깨진다**. 언어는 `M()` 을 부를 때 읽는다
 * (모듈 로드 시점이 아니라) — 설정이 바뀌면 다음 호출부터 반영된다. "카탈로그를 안 거친 하드코딩 한국어"는
 * 컴파일러가 못 잡으므로 각 패키지의 i18n 커버리지 테스트가 i18n-scan.ts 로 잡는다.
 */
export function catalog<T extends object>(ko: T, en: NoInfer<T>): () => T {
  return () => (resolveLang() === 'en' ? en : ko);
}
