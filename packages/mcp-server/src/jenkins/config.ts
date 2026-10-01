import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { writeCredentialJson } from '#core/atomic-write.js';
import type { JenkinsConfig } from '#core/jenkins.js';

const CONFIG_DIR = path.join(os.homedir(), '.mimi-seed');
const JENKINS_CONFIG_PATH = path.join(CONFIG_DIR, 'jenkins.json');

// jenkins.json 의 모양은 이 파일을 읽는 CLI 와 공유한다 (#core/jenkins.js).
export type { JenkinsConfig } from '#core/jenkins.js';

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
  const existing = loadJenkinsConfig() ?? {};
  const merged = { ...existing, ...stripUndefined(config) };
  writeCredentialJson(JENKINS_CONFIG_PATH, merged);
}

function stripUndefined<T extends object>(o: T): Partial<T> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;
}

function isPrivateIPv4(host: string): boolean {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  return a === 10
    || a === 127
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 168)
    || (a === 169 && b === 254)
    || (a === 100 && b >= 64 && b <= 127); // CGNAT — Tailscale 등 사설 오버레이망
}

function isPrivateHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host === '::1') return true;
  if (isPrivateIPv4(host)) return true;
  if (/^(fc|fd)[0-9a-f]{2}:/.test(host) || /^fe80:/.test(host)) return true; // IPv6 ULA / link-local
  if (!host.includes('.')) return true; // 단일 라벨 호스트명 — 사내 DNS
  return /\.(local|lan|internal|intranet|home\.arpa|ts\.net)$/.test(host);
}

/**
 * 평문 http 로 공인 호스트에 붙으면 API 토큰이 네트워크에 그대로 실린다.
 * 사내망(LAN/Tailscale) 컨트롤러는 http 가 흔하고 정당하므로 **막지 않고** 경고만 한다.
 */
export function jenkinsUrlWarning(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'http:' || isPrivateHost(parsed.hostname)) return null;
  return `⚠️ ${parsed.host} 는 사설망 주소가 아닌데 http 입니다 — API 토큰이 암호화 없이 전송됩니다. 가능하면 https URL 을 쓰세요.`;
}

export function requireJenkinsConfig(): JenkinsConfig {
  const cfg = loadJenkinsConfig();
  if (!cfg) {
    throw new Error(
      'Jenkins 설정이 없습니다.\n' +
      'jenkins_save_config 도구로 먼저 설정해주세요.\n' +
      '예시:\n' +
      '  jenkins_save_config(url="https://jenkins.example.com", username="admin", token=<Jenkins API token>)',
    );
  }
  return cfg;
}
