import type { JenkinsConfig } from './config.js';
import { authHeaders, getCrumb } from './http.js';
import { fetchWithTimeout, HTTP_TRANSFER_TIMEOUT_MS } from '../lib/http.js';

export interface JenkinsCredentialSummary {
  id: string;
  displayName: string;
  typeName: string;
}

const FILE_CLASS = 'org.jenkinsci.plugins.plaincredentials.impl.FileCredentialsImpl';
const TEXT_CLASS = 'org.jenkinsci.plugins.plaincredentials.impl.StringCredentialsImpl';

// 도메인(_ = 전역) 레벨 — 목록 조회 / createCredentials 의 베이스
function storeBase(url: string): string {
  return `${url.replace(/\/$/, '')}/credentials/store/system/domain/_`;
}

// 개별 credential 레벨 — 반드시 /credential/<id> 세그먼트 필요 (조회/업데이트/삭제)
function credentialBase(url: string, id: string): string {
  return `${storeBase(url)}/credential/${encodeURIComponent(id)}`;
}

/**
 * 기존 credential 의 Java class. 없으면 null, 있는데 메타데이터를 못 읽으면 빈 문자열.
 *
 * boolean(존재 여부)만으로는 부족하다 — id 가 같고 **종류가 다른** credential 을
 * upsert 하면 기존 값이 통째로 사라진다. 예: Secret text 로 앱 키를 넣어둔 id 에
 * Play SA 파일을 올리면 앱 키가 소멸한다. `_class` 는 Jenkins 가 주는 Java 클래스명이라
 * 표시 이름(typeName)과 달리 로케일에 흔들리지 않는다.
 */
async function credentialClass(cfg: JenkinsConfig, id: string): Promise<string | null> {
  const res = await fetchWithTimeout(`${credentialBase(cfg.url, id)}/api/json`, {
    headers: authHeaders(cfg),
  });
  if (!res.ok) return null;
  try {
    return ((await res.json()) as { _class?: string })._class ?? '';
  } catch {
    return '';
  }
}

/** id 가 이미 **다른 종류**로 쓰이고 있으면 덮어쓰지 않고 멈춘다. */
function assertSameKind(id: string, existing: string | null, wanted: string, label: string): void {
  if (existing === null || existing === '' || existing === wanted) return;
  throw new Error(
    [
      `Jenkins credential "${id}" 가 이미 다른 종류로 존재합니다.`,
      `   기존: ${existing}`,
      `   요청: ${label}`,
      '',
      '덮어쓰면 기존 값이 사라집니다. 다른 id 를 쓰거나, 정말 교체하려면 먼저 삭제하세요.',
      'jenkins_list_credentials 로 현재 목록을 확인할 수 있습니다.',
    ].join('\n'),
  );
}

export async function listCredentials(cfg: JenkinsConfig): Promise<JenkinsCredentialSummary[]> {
  const res = await fetchWithTimeout(`${storeBase(cfg.url)}/api/json?depth=1`, {
    headers: authHeaders(cfg),
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
  const existingClass = await credentialClass(cfg, id);
  assertSameKind(id, existingClass, TEXT_CLASS, 'Secret text');
  const exists = existingClass !== null;
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

  const res = await fetchWithTimeout(endpoint, {
    method: 'POST',
    headers: {
      ...authHeaders(cfg),
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
  const existingClass = await credentialClass(cfg, id);
  assertSameKind(id, existingClass, FILE_CLASS, 'Secret file');
  const exists = existingClass !== null;
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
  const res = await fetchWithTimeout(
    endpoint,
    {
      method: 'POST',
      headers: {
        ...authHeaders(cfg),
        ...crumb,
      },
      body: form,
    },
    HTTP_TRANSFER_TIMEOUT_MS,
  );
  if (!res.ok && res.status !== 302) {
    throw new Error(`Jenkins secret file credential ${exists ? 'update' : 'create'} 실패 (${res.status})`);
  }
  return exists ? 'updated' : 'created';
}

export async function deleteCredential(cfg: JenkinsConfig, id: string): Promise<void> {
  const crumb = await getCrumb(cfg);
  const res = await fetchWithTimeout(`${credentialBase(cfg.url, id)}/doDelete`, {
    method: 'POST',
    headers: {
      ...authHeaders(cfg),
      ...crumb,
    },
  });
  if (!res.ok && res.status !== 302) {
    throw new Error(`Jenkins credential 삭제 실패 (${res.status})`);
  }
}
