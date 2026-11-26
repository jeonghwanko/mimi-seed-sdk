// 사용자 환경설정 — `~/.mimi-seed/settings.json`.
//
// 자격증명이 아니라 **취향**을 담는다 (지금은 언어 하나). 자격증명 파일들과 분리해 둔 이유:
// logout/재인증으로 토큰을 지워도 언어 설정은 남아야 하고, 이 파일은 비밀이 아니다.
//
// 이 파일의 **쓰기**는 CLI 만 한다. 언어를 고르는 규칙(resolveLang)은 mcp-server 의 setup bin 과
// 같아야 하므로 packages/core 의 `#core/lang.js` 한 곳에 있다.

import fs from "node:fs";
import os from "node:os";
import { settingsPath, type Lang } from "#core/lang.js";
import { writeJsonAtomic } from "#core/atomic-write.js";

export interface Settings {
  lang?: Lang;
}

export function readSettings(home: string = os.homedir()): Settings {
  try {
    return JSON.parse(fs.readFileSync(settingsPath(home), "utf-8")) as Settings;
  } catch {
    // 없거나 깨진 settings.json 은 '언어 미선택' — 다음 writeSettings 가 새 선택으로 덮어쓴다. 함께 사라질 수 있는
    // credentialStore 는 core 가 .data-key.id 표식으로 지킨다: 한 번 암호화한 컴퓨터는 설정이 사라져도 평문으로 내려가지 않는다
    return {};
  }
}

export function writeSettings(next: Settings, home: string = os.homedir()): void {
  const merged = { ...readSettings(home), ...next };
  // 비밀은 아니라 0600 을 강제하지 않지만, 두 패키지가 읽는 파일이라 잘린 JSON 은 남기지 않는다.
  writeJsonAtomic(settingsPath(home), merged, { dirMode: 0o700 });
}

/** 언어가 아직 한 번도 선택되지 않았는가 (= setup 이 물어봐야 하는가). */
export function isLangUnset(home: string = os.homedir()): boolean {
  return !process.env.MIMI_SEED_LANG && !readSettings(home).lang;
}
