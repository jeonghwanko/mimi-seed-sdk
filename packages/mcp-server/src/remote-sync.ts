import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { getAppStoreCredentials, type AppStoreCredentials } from './appstore/auth.js';
import { fetchWithTimeout } from './lib/http.js';
import {
  getServiceAccountJson,
  listRegisteredServiceAccounts,
} from './auth/playstore-auth.js';
import { isValidAndroidPackageName } from './lib/package-name.js';

interface RemoteConfig {
  token: string;
  endpoint: string;
  webBase: string;
}

export interface RemoteSyncOptions {
  confirm?: boolean;
  includeAppStore?: boolean;
  includePlayStore?: boolean;
  packageNames?: string[];
}

export interface RemoteSyncDependencies {
  getConfig(): RemoteConfig | null;
  getAppStoreCredentials(): AppStoreCredentials | null;
  listPackageNames(): string[];
  getServiceAccountJson(packageName: string): string | null;
  callRemote(
    config: RemoteConfig,
    tool: string,
    args: Record<string, unknown>,
  ): Promise<{ text: string; isError: boolean }>;
}

function getRemoteConfig(): RemoteConfig | null {
  const envToken = process.env.MIMI_SEED_TOKEN;
  if (envToken) {
    const webBase = process.env.MIMI_SEED_WEB_BASE ?? 'https://mimi-seed.pryzm.gg';
    return { token: envToken, endpoint: `${webBase}/api/mcp`, webBase };
  }
  try {
    const configPath = path.join(os.homedir(), '.mimi-seed', 'config.json');
    const parsed = JSON.parse(fs.readFileSync(configPath, 'utf8')) as Partial<RemoteConfig>;
    if (!parsed.token || !parsed.endpoint) return null;
    const webBase = parsed.webBase ?? parsed.endpoint.replace(/\/api\/mcp\/?$/, '');
    return { token: parsed.token, endpoint: parsed.endpoint, webBase };
  } catch {
    return null;
  }
}

async function callRemote(
  config: RemoteConfig,
  tool: string,
  args: Record<string, unknown>,
): Promise<{ text: string; isError: boolean }> {
  let response: Response;
  try {
    response = await fetchWithTimeout(config.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        Authorization: `Bearer ${config.token}`,
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: tool, arguments: args },
      }),
    }, 30_000);
  } catch {
    return { text: '원격 MCP 네트워크 연결 실패', isError: true };
  }
  if (!response.ok) {
    return { text: `원격 MCP HTTP ${response.status}`, isError: true };
  }

  const raw = await response.text();
  let payloadRaw = raw;
  if ((response.headers.get('content-type') ?? '').includes('text/event-stream')) {
    const data = raw
      .split('\n')
      .map((line) => line.trim())
      .find((line) => line.startsWith('data:'));
    if (!data) return { text: '원격 MCP 응답을 읽지 못했습니다.', isError: true };
    payloadRaw = data.slice(5).trim();
  }
  try {
    const payload = JSON.parse(payloadRaw) as {
      error?: { message?: string };
      result?: { isError?: boolean; content?: Array<{ type?: string; text?: string }> };
    };
    if (payload.error) return { text: payload.error.message ?? '원격 MCP 오류', isError: true };
    return {
      text: (payload.result?.content ?? [])
        .filter((item) => item.type === 'text')
        .map((item) => item.text ?? '')
        .join('\n'),
      isError: payload.result?.isError === true,
    };
  } catch {
    return { text: '원격 MCP 응답 형식이 올바르지 않습니다.', isError: true };
  }
}

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/**
 * 비밀값(ASC .p8, SA 개인키)을 보낼 원격 엔드포인트 검사. `~/.mimi-seed/config.json` 이나
 * `MIMI_SEED_WEB_BASE` 가 조작되면 평문 http 나 임의 호스트로 키가 나간다 — https 만 허용하고,
 * 로컬 개발 서버(루프백)만 http 를 봐준다.
 */
export function checkRemoteEndpoint(
  endpoint: string,
): { ok: true; host: string } | { ok: false; reason: string } {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return { ok: false, reason: 'URL 형식이 아닙니다' };
  }
  if (url.username || url.password) {
    return { ok: false, reason: 'URL 에 사용자 정보가 들어 있습니다' };
  }
  if (url.protocol === 'https:') return { ok: true, host: url.host };
  if (url.protocol === 'http:' && LOOPBACK_HOSTS.has(url.hostname)) {
    return { ok: true, host: `${url.host} (로컬 http)` };
  }
  return { ok: false, reason: `https 가 아닙니다 (${url.protocol}//${url.host})` };
}

const defaultDependencies: RemoteSyncDependencies = {
  getConfig: getRemoteConfig,
  getAppStoreCredentials,
  listPackageNames: () =>
    listRegisteredServiceAccounts().perPackage.map((entry) => entry.packageName),
  getServiceAccountJson: (packageName) => getServiceAccountJson(packageName),
  callRemote,
};

export async function syncRemoteCredentials(
  options: RemoteSyncOptions,
  dependencies: RemoteSyncDependencies = defaultDependencies,
): Promise<string> {
  const includeAppStore = options.includeAppStore !== false;
  const includePlayStore = options.includePlayStore !== false;
  const appStore = includeAppStore ? dependencies.getAppStoreCredentials() : null;
  // 허용 목록 = 실제로 등록된 패키지별 SA. 요청 이름을 그대로 파일 경로로 쓰면
  // `../tokens` 가 ~/.mimi-seed/tokens.json(OAuth 리프레시 토큰)을 원격으로 보낸다.
  const registered = new Set(dependencies.listPackageNames().filter(isValidAndroidPackageName));
  const requestedPackages = options.packageNames?.map((name) => name.trim()).filter(Boolean);
  const candidates = includePlayStore
    ? [...new Set(requestedPackages?.length ? requestedPackages : [...registered])]
    : [];
  const rejected = candidates.filter((name) => !registered.has(name));
  const packageNames = candidates.filter((name) => registered.has(name));
  const playCredentials = packageNames
    .map((packageName) => ({ packageName, json: dependencies.getServiceAccountJson(packageName) }))
    .filter((entry): entry is { packageName: string; json: string } => Boolean(entry.json));

  const config = dependencies.getConfig();
  const endpoint = config ? checkRemoteEndpoint(config.endpoint) : null;

  const lines = [
    'Mimi Seed 로컬 → 원격 자격증명 동기화',
    `- 전송 대상: ${
      !config ? '원격 연결 정보 없음' : endpoint?.ok ? endpoint.host : `거부됨 — ${endpoint?.reason}`
    }`,
    `- App Store Connect: ${appStore ? '대상 1개' : includeAppStore ? '로컬 키 없음' : '제외'}`,
    `- Google Play: ${playCredentials.length}개 패키지${
      packageNames.length > playCredentials.length ? ` (자격증명 없는 대상 ${packageNames.length - playCredentials.length}개)` : ''
    }`,
    ...playCredentials.map((entry) => `  - ${entry.packageName}`),
    ...(rejected.length
      ? [
          `- 등록되지 않은 패키지 ${rejected.length}개 — 거부 (playstore_list_service_accounts 로 등록 목록 확인):`,
          ...rejected.map((name) => `  - ${JSON.stringify(name.slice(0, 80))}`),
        ]
      : []),
    '- Google OAuth: 복사하지 않음 (원격 웹에서 별도 동의 필요)',
  ];

  if (!options.confirm) {
    return [...lines, '', '미리보기만 수행했습니다. 원격 저장은 confirm=true일 때만 실행됩니다.'].join('\n');
  }

  if (!config) {
    return [...lines, '', '원격 연결 정보가 없습니다. 먼저 `mimi-seed init`을 실행하세요.'].join('\n');
  }
  if (!endpoint?.ok) {
    return [...lines, '', `원격 엔드포인트를 신뢰할 수 없어 전송하지 않았습니다: ${endpoint?.reason}`].join('\n');
  }
  if (rejected.length) {
    // 일부만 보내고 넘어가면 사용자는 오타를 모른 채 "동기화됨"으로 믿는다 — 통째로 멈춘다.
    return [...lines, '', '등록되지 않은 패키지명이 있어 아무것도 전송하지 않았습니다.'].join('\n');
  }

  const results: string[] = [];
  if (appStore) {
    const result = await dependencies.callRemote(config, 'import_appstore_credentials', {
      key_id: appStore.keyId,
      issuer_id: appStore.issuerId,
      private_key: appStore.privateKey,
      confirm: true,
    });
    results.push(`- App Store: ${result.isError ? '실패' : result.text}`);
  }
  for (const entry of playCredentials) {
    const result = await dependencies.callRemote(config, 'import_playstore_service_account', {
      package_name: entry.packageName,
      service_account_json: entry.json,
      confirm: true,
    });
    results.push(`- Play ${entry.packageName}: ${result.isError ? '실패' : result.text}`);
  }

  if (results.length === 0) results.push('- 동기화할 로컬 자격증명이 없습니다.');
  return [
    ...lines,
    '',
    ...results,
    '',
    `Google 사용자 권한(Firebase/AdMob/vitals): ${config.webBase}/apps 에서 "Google 플랫폼 연결" 동의 필요`,
  ].join('\n');
}
