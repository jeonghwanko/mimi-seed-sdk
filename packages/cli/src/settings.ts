// 사용자 환경설정 — `~/.mimi-seed/settings.json`.
//
// 자격증명이 아니라 **취향**을 담는다 (지금은 언어 하나). 자격증명 파일들과 분리해 둔 이유:
// logout/재인증으로 토큰을 지워도 언어 설정은 남아야 하고, 이 파일은 비밀이 아니다.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export type Lang = "ko" | "en";
export const DEFAULT_LANG: Lang = "ko";

export interface Settings {
  lang?: Lang;
}

function settingsPath(home: string): string {
  return path.join(home, ".mimi-seed", "settings.json");
}

export function readSettings(home: string = os.homedir()): Settings {
  try {
    return JSON.parse(fs.readFileSync(settingsPath(home), "utf-8")) as Settings;
  } catch {
    return {};
  }
}

export function writeSettings(next: Settings, home: string = os.homedir()): void {
  const dir = path.join(home, ".mimi-seed");
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const merged = { ...readSettings(home), ...next };
  fs.writeFileSync(settingsPath(home), JSON.stringify(merged, null, 2));
}

/** 언어가 아직 한 번도 선택되지 않았는가 (= setup 이 물어봐야 하는가). */
export function isLangUnset(home: string = os.homedir()): boolean {
  return !process.env.MIMI_SEED_LANG && !readSettings(home).lang;
}

export function isLang(v: unknown): v is Lang {
  return v === "ko" || v === "en";
}

/**
 * 우선순위: 환경변수 > settings.json > 기본값(ko).
 *
 * 환경변수를 1순위로 두는 이유: CLI 가 mcp-server 의 setup bin 을 spawn 할 때 이 값을 물려줘서,
 * 마법사와 그 자식 프로세스의 언어가 어긋나지 않게 한다 (mcp-bin.ts).
 */
export function resolveLang(home: string = os.homedir()): Lang {
  const env = process.env.MIMI_SEED_LANG?.toLowerCase();
  if (isLang(env)) return env;
  const saved = readSettings(home).lang;
  if (isLang(saved)) return saved;
  return DEFAULT_LANG;
}
