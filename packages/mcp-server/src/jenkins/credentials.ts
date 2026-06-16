import type { JenkinsConfig } from './config.js';

export interface JenkinsCredentialSummary {
  id: string;
  displayName: string;
  typeName: string;
}

const FILE_CLASS = 'org.jenkinsci.plugins.plaincredentials.impl.FileCredentialsImpl';
const TEXT_CLASS = 'org.jenkinsci.plugins.plaincredentials.impl.StringCredentialsImpl';

function basicAuth(username: string, token: string): string {
  return 'Basic ' + Buffer.from(`${username}:${token}`).toString('base64');
}

// 도메인(_ = 전역) 레벨 — 목록 조회 / createCredentials 의 베이스
function storeBase(url: string): string {
  return `${url.replace(/\/$/, '')}/credentials/store/system/domain/_`;
}

// 개별 credential 레벨 — 반드시 /credential/<id> 세그먼트 필요 (조회/업데이트/삭제)
function credentialBase(url: string, id: string): string {
  return `${storeBase(url)}/credential/${encodeURIComponent(id)}`;
}

/**
 * CSRF crumb (best-effort). crumb issuer 비활성이거나 API 토큰으로 면제되면 빈 객체.
 * 구버전 Jenkins / 비밀번호 인증 환경에서 POST 403 방지.
 */
async function getCrumb(cfg: JenkinsConfig): Promise<Record<string, string>> {
  try {
    const res = await fetch(`${cfg.url.replace(/\/$/, '')}/crumbIssuer/api/json`, {
      headers: { Authorization: basicAuth(cfg.username, cfg.token) },
    });
    if (!res.ok) return {};
    const data = (await res.json()) as { crumbRequestField?: string; crumb?: string };
    if (data.crumbRequestField && data.crumb) {
      return { [data.crumbRequestField]: data.crumb };
    }
    return {};
  } catch {
    return {};
  }
}

async function credentialExists(cfg: JenkinsConfig, id: string): Promise<boolean> {
  const res = await fetch(`${credentialBase(cfg.url, id)}/api/json`, {
    headers: { Authorization: basicAuth(cfg.username, cfg.token) },
  });
  return res.ok;
}

export async function listCredentials(cfg: JenkinsConfig): Promise<JenkinsCredentialSummary[]> {
  const res = await fetch(`${storeBase(cfg.url)}/api/json?depth=1`, {
    headers: { Authorization: basicAuth(cfg.username, cfg.token) },
  });
  if (!res.ok) throw new Error(`Jenkins credentials 조회 실패 (${res.status})`);
  const data = (await res.json()) as {
    credentials?: Array<{ id: string; displayName: string; typeName: string }>;
  };
  return (data.credentials ?? []).map((c) => ({
    id: c.id,
    displayName: c.displayName,
    typeName: c.typeName,
  }));
}

export async function upsertSecretText(
  cfg: JenkinsConfig,
  id: string,
  secret: string,
  description = '',
): Promise<'created' | 'updated'> {
  const exists = await credentialExists(cfg, id);
  const payload = {
    credentials: {
      scope: 'GLOBAL',
      id,
      description,
      secret,
      $class: TEXT_CLASS,
      'stapler-class': TEXT_CLASS,
    },
  };
  const endpoint = exists
    ? `${credentialBase(cfg.url, id)}/updateSubmit`
    : `${storeBase(cfg.url)}/createCredentials`;
  const crumb = await getCrumb(cfg);

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: basicAuth(cfg.username, cfg.token),
      'Content-Type': 'application/x-www-form-urlencoded',
      ...crumb,
    },
    body: new URLSearchParams({ json: JSON.stringify(payload) }).toString(),
  });
  if (!res.ok && res.status !== 302) {
    throw new Error(`Jenkins credential ${exists ? 'update' : 'create'} 실패 (${res.status})`);
  }
  return exists ? 'updated' : 'created';
}

/**
 * Secret File credential 생성/교체. Jenkins는 파일을 multipart 로 받고
 * json 본문이 "file": "<필드명>" 으로 참조한다 (secretBytes JSON 직접 입력은 불가).
 */
export async function upsertSecretFile(
  cfg: JenkinsConfig,
  id: string,
  fileBase64: string,
  fileName: string,
  description = '',
): Promise<'created' | 'updated'> {
  const exists = await credentialExists(cfg, id);
  const payload = {
    credentials: {
      scope: 'GLOBAL',
      id,
      description,
      file: 'file0',
      $class: FILE_CLASS,
      'stapler-class': FILE_CLASS,
    },
  };

  const form = new FormData();
  form.append('json', JSON.stringify(payload));
  const bytes = Buffer.from(fileBase64, 'base64');
  form.append('file0', new Blob([bytes]), fileName);

  const endpoint = exists
    ? `${credentialBase(cfg.url, id)}/updateSubmit`
    : `${storeBase(cfg.url)}/createCredentials`;
  const crumb = await getCrumb(cfg);

  // Content-Type 은 fetch 가 multipart boundary 와 함께 자동 설정 — 수동 지정 금지
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: basicAuth(cfg.username, cfg.token),
      ...crumb,
    },
    body: form,
  });
  if (!res.ok && res.status !== 302) {
    throw new Error(`Jenkins secret file credential ${exists ? 'update' : 'create'} 실패 (${res.status})`);
  }
  return exists ? 'updated' : 'created';
}

export async function deleteCredential(cfg: JenkinsConfig, id: string): Promise<void> {
  const crumb = await getCrumb(cfg);
  const res = await fetch(`${credentialBase(cfg.url, id)}/doDelete`, {
    method: 'POST',
    headers: {
      Authorization: basicAuth(cfg.username, cfg.token),
      ...crumb,
    },
  });
  if (!res.ok && res.status !== 302) {
    throw new Error(`Jenkins credential 삭제 실패 (${res.status})`);
  }
}
