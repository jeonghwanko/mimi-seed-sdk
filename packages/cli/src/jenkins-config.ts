// Jenkins 설정의 **정본은 ~/.mimi-seed/jenkins.json** (mcp-server 의 jenkins/config.ts 가 쓴다).
//
// 과거 CLI 는 `deploy setup-jenkins` 로 ~/.mimi-seed/config.json 의 `jenkins` 키에 따로 썼고,
// MCP 는 jenkins.json 에 썼다. 두 설정은 서로를 못 봐서, CLI 로 설정한 사용자에게 MCP 의
// jenkins_* 도구가 "미설정"이라 답했다. 이 모듈이 그 이중화를 봉합한다.
//
// CLI 는 이 파일을 **읽기만** 한다. 쓰기는 mimi-seed-jenkins-auth bin(= mcp-server)이 소유한다.
// 유일한 예외가 아래 `migrateLegacyJenkins` — CLI 가 예전에 config.json 에 써 둔 값을 옮기는
// 1회성 이관이고, jenkins.json 이 **없을 때만** 만든다(정본을 덮어쓰지 않는다). 새 값을 받아
// 검증하는 writer 가 아니므로 "자격증명 하나당 writer 하나" 규칙의 두 번째 writer 가 아니다.
// 셸아웃으로 대체할 수 없는 이유: setup bin 은 대화형 전용이라 이관할 값을 넘길 방법이 없다.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { writeCredentialJson } from "./lib/atomic-write.js";

const CONFIG_DIR = path.join(os.homedir(), ".mimi-seed");
const JENKINS_PATH = path.join(CONFIG_DIR, "jenkins.json");
const LEGACY_PATH = path.join(CONFIG_DIR, "config.json");

export interface JenkinsConfig {
  url: string;
  username: string; // 레거시 config.json 에서는 `user` 였다 — 마이그레이션에서 리네임한다.
  token: string;
  jobAndroid?: string;
  jobIos?: string;
}

export function loadJenkinsConfig(home = os.homedir()): JenkinsConfig | null {
  try {
    const p = path.join(home, ".mimi-seed", "jenkins.json");
    return JSON.parse(fs.readFileSync(p, "utf-8")) as JenkinsConfig;
  } catch {
    return null;
  }
}

/**
 * 레거시 config.json.jenkins → jenkins.json 1회성 이관.
 *
 * - jenkins.json 이 이미 있으면 아무것도 하지 않는다 (정본이 이긴다 — 덮어쓰지 않는다).
 * - 이관 후 config.json 에서 레거시 키를 제거해 두 번 실행해도 no-op 이 되게 한다.
 *
 * @returns 이관했으면 true.
 */
export function migrateLegacyJenkins(home = os.homedir()): boolean {
  const dir = path.join(home, ".mimi-seed");
  const jenkinsPath = path.join(dir, "jenkins.json");
  const legacyPath = path.join(dir, "config.json");

  if (fs.existsSync(jenkinsPath)) return false;

  let legacy: Record<string, unknown>;
  try {
    legacy = JSON.parse(fs.readFileSync(legacyPath, "utf-8")) as Record<string, unknown>;
  } catch {
    return false;
  }

  const j = legacy.jenkins as
    | { url?: string; user?: string; username?: string; token?: string; jobAndroid?: string; jobIos?: string }
    | undefined;
  if (!j?.url || !j?.token) return false;

  const migrated: JenkinsConfig = {
    url: j.url,
    username: j.username ?? j.user ?? "admin", // 필드명 리네임: user → username
    token: j.token,
    ...(j.jobAndroid ? { jobAndroid: j.jobAndroid } : {}),
    ...(j.jobIos ? { jobIos: j.jobIos } : {}),
  };

  // 둘 다 원자적 0600. jenkins.json 은 처음 나타나는 순간부터 0600 이고, config.json 은
  // Mimi Seed PAT 를 들고 있어 truncate 중에 죽으면 토큰이 통째로 날아가므로 temp + rename.
  // (예전 고정 temp 이름 `config.json.tmp` 는 동시 실행 두 개가 서로의 temp 를 덮어썼다.)
  writeCredentialJson(jenkinsPath, migrated);

  delete legacy.jenkins;
  writeCredentialJson(legacyPath, legacy);

  return true;
}

export const JENKINS_CONFIG_LOCATION = JENKINS_PATH;
export const LEGACY_CONFIG_LOCATION = LEGACY_PATH;
