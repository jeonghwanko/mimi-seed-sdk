import path from 'node:path';
import os from 'node:os';
import { writeCredentialJson } from '#core/atomic-write.js';
import { catalog } from '#core/lang.js';

const CONFIG_DIR = path.join(os.homedir(), '.mimi-seed');
const CI_CONFIG_PATH = path.join(CONFIG_DIR, 'ci.json');

const M = catalog(
  { notConfigured: 'CI 설정이 없습니다.\n' + 'ci_save_config 도구로 먼저 설정해주세요.\n' + '예시:\n' },
  { notConfigured: 'CI is not configured.\n' + 'Configure it first with the ci_save_config tool.\n' + 'Example:\n' },
);

// ci.json 의 모양은 CLI 와 공유한다 — 두 패키지가 모두 쓰는 문서화된 예외다(pitfalls §12).
import type { CiConfig } from '#core/ci.js';
import { assertCredentialFileReadable } from '../lib/json-file.js';
import { readCredentialFileSync } from '#core/credential-read.js';
export type { CiConfig, CiProvider } from '#core/ci.js';

export function loadCiConfig(): CiConfig | null {
  try {
    return JSON.parse(readCredentialFileSync(CI_CONFIG_PATH)) as CiConfig;
  } catch {
    // 읽을 수 없으면 '미설정' — 깨진 파일은 requireCiConfig · mimi_seed_status 가 json-file 로 따로 진단한다
    return null;
  }
}

export function saveCiConfig(config: CiConfig): void {
  writeCredentialJson(CI_CONFIG_PATH, config);
}

export function requireCiConfig(): CiConfig {
  const cfg = loadCiConfig();
  if (!cfg) {
    assertCredentialFileReadable(CI_CONFIG_PATH, 'ci_save_config');
    throw new Error(
      M().notConfigured +
      '  GitHub: ci_save_config(provider="github", token=<GitHub token>, owner="my-org", repo="my-app")\n' +
      '  GitLab: ci_save_config(provider="gitlab", token=<GitLab token>, owner="my-group", repo="my-app")',
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
