import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const CONFIG_DIR = path.join(os.homedir(), '.mimi-seed');
const JENKINS_CONFIG_PATH = path.join(CONFIG_DIR, 'jenkins.json');

export interface JenkinsConfig {
  url: string;        // Jenkins 기본 URL (e.g. https://jenkins.example.com)
  username: string;   // Jenkins 사용자 ID
  token: string;      // Jenkins API Token
  // 아래 둘은 CLI(mimi-seed deploy)가 빌드를 트리거할 잡 이름. MCP 도구는 쓰지 않지만
  // 설정 파일은 하나(jenkins.json)뿐이므로 여기서 함께 들고 간다.
  jobAndroid?: string;
  jobIos?: string;
}

export function loadJenkinsConfig(): JenkinsConfig | null {
  try {
    return JSON.parse(fs.readFileSync(JENKINS_CONFIG_PATH, 'utf-8')) as JenkinsConfig;
  } catch {
    return null;
  }
}

/**
 * jenkins.json 저장 — **기존 값 위에 병합한다** (통째로 덮어쓰지 않는다).
 *
 * 이 파일에는 두 종류의 필드가 산다: 연결 정보(url/username/token)는 MCP 도구
 * `jenkins_save_config` 가, 빌드 잡 이름(jobAndroid/jobIos)은 CLI 의 setup 이 쓴다.
 * 통째로 덮어쓰면 한쪽이 다른 쪽 값을 지운다 — 예전에 Jenkins 설정이 config.json 과
 * jenkins.json 으로 갈라졌던 것과 같은 종류의 사고다. undefined 인 필드는 건드리지 않는다.
 */
export function saveJenkinsConfig(config: Partial<JenkinsConfig> & Pick<JenkinsConfig, 'url' | 'username' | 'token'>): void {
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
  }
  const existing = loadJenkinsConfig() ?? {};
  const merged = { ...existing, ...stripUndefined(config) };
  fs.writeFileSync(JENKINS_CONFIG_PATH, JSON.stringify(merged, null, 2), { mode: 0o600 });
}

function stripUndefined<T extends object>(o: T): Partial<T> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;
}

export function requireJenkinsConfig(): JenkinsConfig {
  const cfg = loadJenkinsConfig();
  if (!cfg) {
    throw new Error(
      'Jenkins 설정이 없습니다.\n' +
      'jenkins_save_config 도구로 먼저 설정해주세요.\n' +
      '예시:\n' +
      '  jenkins_save_config(url="https://jenkins.example.com", username="admin", token="11abc...")',
    );
  }
  return cfg;
}
