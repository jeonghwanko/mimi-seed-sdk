import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const CONFIG_DIR = path.join(os.homedir(), '.mimi-seed');
const CI_CONFIG_PATH = path.join(CONFIG_DIR, 'ci.json');

export type CiProvider = 'github' | 'gitlab';

export interface CiConfig {
  provider: CiProvider;
  token: string;
  owner: string;
  repo: string;
  host?: string; // GitLab self-hosted: e.g. https://gitlab.example.com
}

export function loadCiConfig(): CiConfig | null {
  try {
    return JSON.parse(fs.readFileSync(CI_CONFIG_PATH, 'utf-8')) as CiConfig;
  } catch {
    return null;
  }
}

export function saveCiConfig(config: CiConfig): void {
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
  }
  fs.writeFileSync(CI_CONFIG_PATH, JSON.stringify(config, null, 2), { mode: 0o600 });
}

export function requireCiConfig(): CiConfig {
  const cfg = loadCiConfig();
  if (!cfg) {
    throw new Error(
      'CI 설정이 없습니다.\n' +
      'ci_save_config 도구로 먼저 설정해주세요.\n' +
      '예시:\n' +
      '  GitHub: ci_save_config(provider="github", token="ghp_...", owner="my-org", repo="my-app")\n' +
      '  GitLab: ci_save_config(provider="gitlab", token="glpat-...", owner="my-group", repo="my-app")',
    );
  }
  return cfg;
}

export interface NormalizedBuild {
  id: number | string;
  name?: string;
  workflow?: string;
  status: string; // pending | running | success | failed | cancelled
  branch: string;
  commit?: string;
  url: string;
  createdAt: string;
  updatedAt: string;
}
