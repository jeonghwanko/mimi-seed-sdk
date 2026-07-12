// Jenkins 설정의 **정본은 ~/.mimi-seed/jenkins.json** (mcp-server 의 jenkins/config.ts 가 쓴다).
//
// 과거 CLI 는 `deploy setup-jenkins` 로 ~/.mimi-seed/config.json 의 `jenkins` 키에 따로 썼고,
// MCP 는 jenkins.json 에 썼다. 두 설정은 서로를 못 봐서, CLI 로 설정한 사용자에게 MCP 의
// jenkins_* 도구가 "미설정"이라 답했다. 이 모듈이 그 이중화를 봉합한다.
//
// CLI 는 이 파일을 **읽기만** 한다. 쓰기는 mimi-seed-jenkins-auth bin(= mcp-server)이 소유한다.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

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

  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  // mode 를 생성 시점에 준다 — 나중에 chmod 하면 그 사이 world-readable 창이 열린다.
  fs.writeFileSync(jenkinsPath, JSON.stringify(migrated, null, 2), { mode: 0o600 });

  // config.json 은 Mimi Seed PAT 를 들고 있다. writeFileSync 는 먼저 truncate 하므로
  // 그 사이에 죽으면 토큰이 통째로 날아간다 — temp + rename 으로 원자적으로 바꾼다.
  delete legacy.jenkins;
  const tmp = `${legacyPath}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(legacy, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, legacyPath);

  return true;
}

export const JENKINS_CONFIG_LOCATION = JENKINS_PATH;
export const LEGACY_CONFIG_LOCATION = LEGACY_PATH;
