import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

/**
 * @deprecated Jenkins 설정의 정본은 `~/.mimi-seed/jenkins.json` 이다 (`jenkins-config.ts`).
 * 이 형태는 예전 `deploy setup-jenkins` 가 config.json 안에 쓰던 것으로, 읽기(마이그레이션)용으로만 남긴다.
 * 새 코드는 `jenkins-config.ts` 의 `JenkinsConfig` 를 쓸 것 — 필드명도 `user` 가 아니라 `username` 이다.
 */
export interface LegacyJenkinsConfig {
  url: string;
  token: string;
  jobAndroid?: string;
  jobIos?: string;
  user?: string;
}

export interface MimiSeedConfig {
  token: string;
  prefix: string;
  endpoint: string; // MCP endpoint
  webBase: string; // https://mimi-seed.pryzm.gg
  createdAt: string;
  /** @deprecated → `~/.mimi-seed/jenkins.json`. `migrateLegacyJenkins()` 가 1회 이관한다. */
  jenkins?: LegacyJenkinsConfig;
}

const CONFIG_DIR = path.join(os.homedir(), ".mimi-seed");
const CONFIG_PATH = path.join(CONFIG_DIR, "config.json");

export async function readConfig(): Promise<MimiSeedConfig | null> {
  try {
    const txt = await fs.readFile(CONFIG_PATH, "utf8");
    return JSON.parse(txt) as MimiSeedConfig;
  } catch {
    return null;
  }
}

export async function writeConfig(cfg: MimiSeedConfig): Promise<void> {
  await fs.mkdir(CONFIG_DIR, { recursive: true });
  await fs.writeFile(CONFIG_PATH, JSON.stringify(cfg, null, 2));
  // Unix계열에서만 파일 권한 600 적용 (Windows는 ACL 기반으로 mode 무시)
  if (process.platform !== "win32") {
    await fs.chmod(CONFIG_PATH, 0o600);
  }
}

export async function deleteConfig(): Promise<void> {
  await fs.rm(CONFIG_PATH, { force: true });
}

export const CONFIG_LOCATION = CONFIG_PATH;

export async function getEffectiveConfig(): Promise<MimiSeedConfig | null> {
  const envToken = process.env.MIMI_SEED_TOKEN;
  if (envToken) {
    const webBase = process.env.MIMI_SEED_WEB_BASE ?? "https://mimi-seed.pryzm.gg";
    return {
      token: envToken,
      prefix: envToken.slice(0, 8),
      endpoint: `${webBase}/api/mcp`,
      webBase,
      createdAt: new Date().toISOString(),
    };
  }
  return readConfig();
}
