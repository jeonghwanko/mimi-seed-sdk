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

/** 이미 있는 credential 의 메타데이터 — 교체 dry-run 이 "무엇을 덮어쓰게 되는지" 보여줄 때 쓴다. 비밀값은 없다. */
export interface ExistingCredential {
  id: string;
  /** Jenkins 가 준 `_class`. */
  className: string;
  /** 표시용 종류 이름 (예: "Secret file"). 로케일에 따라 번역될 수 있다. */
  typeName: string;
  displayName: string;
  description: string;
}

/**
 * 기존 credential 의 메타데이터. 없으면 null. 본문을 못 읽으면 빈 필드로 채운다 (존재 자체는 확정).
 * 존재 확인과 교체 dry-run 표시가 같은 엔드포인트(`/credential/<id>/api/json`)를 쓴다.
 */
export async function describeCredential(cfg: JenkinsConfig, id: string): Promise<ExistingCredential | null> {
  const res = await fetchWithTimeout(`${credentialBase(cfg.url, id)}/api/json`, {
    headers: authHeaders(cfg),
  });
  if (!res.ok) return null;
  let body: Record<string, unknown> = {};
  try {
    body = ((await res.json()) as Record<string, unknown> | null) ?? {};
  } catch {
    // 메타데이터가 깨져도 "있다" 는 사실은 유지한다.
  }
  const str = (value: unknown) => (typeof value === 'string' ? value : '');
  return {
    id: str(body.id) || id,
    className: str(body._class),
    typeName: str(body.typeName),
    displayName: str(body.displayName),
    description: str(body.description),
  };
}

/**
 * 기존 credential 의 **종류**(Java class). 없으면 null, 판단 못 하면 빈 문자열.
 *
 * boolean(존재 여부)만으로는 부족하다 — id 가 같고 **종류가 다른** credential 을
 * upsert 하면 기존 값이 통째로 사라진다. 예: Secret text 로 앱 키를 넣어둔 id 에
 * Play SA 파일을 올리면 앱 키가 소멸한다.
 *
 * `/credential/<id>/api/json` 의 `_class` 는 credential 구현 클래스일 수도, 그것을 감싼
 * `CredentialsStoreAction$CredentialsWrapper` 일 수도 있다. 래퍼면 `_class` 로는 종류를 알 수 없어
 * 영어 typeName("Secret file" / "Secret text")으로만 판정하고, 그것도 아니면(번역된 이름 등) 모른다고 본다
 * — 메타데이터 부재로 정상 교체를 막지 않는다.
 */
function credentialKind(info: ExistingCredential): string {
  if (info.className && !info.className.includes('CredentialsWrapper')) return info.className;
  if (/^secret file$/i.test(info.typeName.trim())) return FILE_CLASS;
  if (/^secret text$/i.test(info.typeName.trim())) return TEXT_CLASS;
  return '';
}

async function credentialClass(cfg: JenkinsConfig, id: string): Promise<string | null> {
  const info = await describeCredential(cfg, id);
  return info === null ? null : credentialKind(info);
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

/**
 * allowReplace=false 면 같은 id 가 이미 있을 때 **아무것도 쓰지 않고** 'exists' 를 돌려준다.
 * 같은 종류의 기존 값(예: 서명 keystore)을 조용히 갈아끼우면 되돌릴 수 없으므로, MCP 도구는
 * 사용자 confirm 전에는 이 모드로 부른다. 새 id 생성은 확인 없이 진행된다.
 */
export interface UpsertOptions {
  allowReplace?: boolean;
}
export type UpsertResult = 'created' | 'updated' | 'exists';

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
  options: UpsertOptions = {},
): Promise<UpsertResult> {
  const existingClass = await credentialClass(cfg, id);
  assertSameKind(id, existingClass, TEXT_CLASS, 'Secret text');
  const exists = existingClass !== null;
  if (exists && options.allowReplace === false) return 'exists';
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
  options: UpsertOptions = {},
): Promise<UpsertResult> {
  const existingClass = await credentialClass(cfg, id);
  assertSameKind(id, existingClass, FILE_CLASS, 'Secret file');
  const exists = existingClass !== null;
  if (exists && options.allowReplace === false) return 'exists';
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
