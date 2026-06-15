import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const CONFIG_DIR = path.join(os.homedir(), '.mimi-seed');
const JENKINS_CONFIG_PATH = path.join(CONFIG_DIR, 'jenkins.json');

export interface JenkinsConfig {
  url: string;        // Jenkins 기본 URL (e.g. https://jenkins.example.com)
  username: string;   // Jenkins 사용자 ID
  token: string;      // Jenkins API Token
}

export function loadJenkinsConfig(): JenkinsConfig | null {
  try {
    return JSON.parse(fs.readFileSync(JENKINS_CONFIG_PATH, 'utf-8')) as JenkinsConfig;
  } catch {
    return null;
  }
}

export function saveJenkinsConfig(config: JenkinsConfig): void {
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
  }
  fs.writeFileSync(JENKINS_CONFIG_PATH, JSON.stringify(config, null, 2), { mode: 0o600 });
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
