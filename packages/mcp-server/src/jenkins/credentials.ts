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
  /** 표시용 종류 이름 (예: "Secret file"). `Accept-Language: en` 으로 요청하지만 번역돼 올 수도 있다. */
  typeName: string;
  displayName: string;
  description: string;
}

/**
 * credential 의 종류. 알려진 구현은 짧은 키로, 모르는 구현 클래스는 클래스명 그대로 쓴다
 * (어느 쪽이든 요청 종류와 다르면 "다른 종류" 다).
 */
export type CredentialKind = string;
export const KIND_STRING = 'string';
export const KIND_FILE = 'file';

const WRAPPER_MARKER = 'CredentialsWrapper';

/** Java 구현 클래스 → 종류. */
const CLASS_KINDS: Record<string, CredentialKind> = {
  [TEXT_CLASS]: KIND_STRING,
  [FILE_CLASS]: KIND_FILE,
  'com.cloudbees.plugins.credentials.impl.UsernamePasswordCredentialsImpl': 'usernamePassword',
  'com.cloudbees.jenkins.plugins.sshcredentials.impl.BasicSSHUserPrivateKey': 'ssh',
  'com.cloudbees.plugins.credentials.impl.CertificateCredentialsImpl': 'certificate',
  'org.jenkinsci.plugins.github_branch_source.GitHubAppCredentials': 'githubApp',
  'org.jenkinsci.plugins.docker.commons.credentials.DockerServerCredentials': 'x509ClientCertificate',
  'com.cloudbees.jenkins.plugins.awscredentials.AWSCredentialsImpl': 'aws',
};

/** Jenkins 의 영어 표시 이름(Descriptor displayName, 소문자 비교) → 종류. 옛 이름도 함께 둔다. */
const TYPE_NAME_KINDS: Record<string, CredentialKind> = {
  'secret text': KIND_STRING,
  'secret file': KIND_FILE,
  'username with password': 'usernamePassword',
  'ssh username with private key': 'ssh',
  'certificate': 'certificate',
  'github app': 'githubApp',
  'x.509 client certificate': 'x509ClientCertificate',
  'docker host certificate authentication': 'x509ClientCertificate',
  'aws credentials': 'aws',
};

const KIND_LABELS: Record<string, string> = {
  [KIND_STRING]: 'Secret text',
  [KIND_FILE]: 'Secret file',
  'usernamePassword': 'Username with password',
  ssh: 'SSH Username with private key',
  certificate: 'Certificate',
  githubApp: 'GitHub App',
  x509ClientCertificate: 'X.509 Client Certificate',
  aws: 'AWS Credentials',
};

/** 사람이 읽는 종류 이름. */
export function kindLabel(kind: CredentialKind): string {
  return KIND_LABELS[kind] ?? kind;
}

// typeName 을 로케일에 흔들리지 않게 받으려고 영어를 요청한다 (Jenkins 는 Accept-Language 로 표시 이름을 번역한다).
function metadataHeaders(cfg: JenkinsConfig): Record<string, string> {
  return { ...authHeaders(cfg), 'Accept-Language': 'en' };
}

/**
 * 기존 credential 의 메타데이터. 없으면 null. 본문을 못 읽으면 빈 필드로 채운다 (존재 자체는 확정).
 * 존재 확인과 교체 dry-run 표시가 같은 엔드포인트(`/credential/<id>/api/json`)를 쓴다.
 */
export async function describeCredential(cfg: JenkinsConfig, id: string): Promise<ExistingCredential | null> {
  const res = await fetchWithTimeout(`${credentialBase(cfg.url, id)}/api/json`, {
    headers: metadataHeaders(cfg),
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

// 루트 요소 이름 — Java 정규 클래스명 모양(점이 하나 이상)만 받는다. 로그인 페이지 같은 HTML(`<html>`)은 걸러진다.
const XML_ROOT = /^\s*(?:<\?xml[^>]*\?>\s*)?(?:<!--[\s\S]*?-->\s*)*<([A-Za-z_][\w$]*(?:\.[\w$]+)+)[\s/>]/;

/**
 * `/credential/<id>/config.xml` 의 루트 요소 = 실제 구현 클래스. 비밀값은 Jenkins 가 가려서 주고, 여기서는 루트
 * 요소 이름만 읽고 본문은 버린다. 권한·플러그인 차이로 못 읽으면 null (판정 불가로 남긴다).
 */
async function classFromConfigXml(cfg: JenkinsConfig, id: string): Promise<string | null> {
  try {
    const res = await fetchWithTimeout(`${credentialBase(cfg.url, id)}/config.xml`, { headers: metadataHeaders(cfg) });
    if (!res.ok) return null;
    const match = XML_ROOT.exec((await res.text()).slice(0, 4096));
    const cls = match?.[1];
    return cls && !cls.includes(WRAPPER_MARKER) ? cls : null;
  } catch {
    return null;
  }
}

/**
 * 기존 credential 의 **종류**. 판단 못 하면 null.
 *
 * boolean(존재 여부)만으로는 부족하다 — id 가 같고 **종류가 다른** credential 을
 * upsert 하면 기존 값이 통째로 사라진다. 예: Secret text 로 앱 키를 넣어둔 id 에
 * Play SA 파일을 올리면 앱 키가 소멸한다.
 *
 * `/credential/<id>/api/json` 의 `_class` 는 credential 구현 클래스가 아니라 그것을 감싼
 * `CredentialsStoreAction$CredentialsWrapper` 일 수 있다. 그래서 순서대로 본다:
 * 1. 래퍼가 아닌 `_class` (모르는 클래스도 그대로 종류로 쓴다),
 * 2. 영어 typeName (Accept-Language: en 으로 요청),
 * 3. config.xml 루트 요소.
 * 셋 다 안 되면 null — 막지는 않지만 dry-run 이 "종류를 확인하지 못했다" 고 말한다.
 */
async function resolveKind(cfg: JenkinsConfig, info: ExistingCredential): Promise<CredentialKind | null> {
  if (info.className && !info.className.includes(WRAPPER_MARKER)) return CLASS_KINDS[info.className] ?? info.className;
  const byName = TYPE_NAME_KINDS[info.typeName.trim().toLowerCase()];
  if (byName) return byName;
  const cls = await classFromConfigXml(cfg, info.id);
  return cls ? (CLASS_KINDS[cls] ?? cls) : null;
}

/** 기존 credential 의 메타데이터 + 종류(판정 불가면 null). 없으면 null. */
export async function inspectCredential(
  cfg: JenkinsConfig,
  id: string,
): Promise<{ info: ExistingCredential; kind: CredentialKind | null } | null> {
  const info = await describeCredential(cfg, id);
  if (info === null) return null;
  return { info, kind: await resolveKind(cfg, { ...info, id }) };
}

/** id 가 이미 **다른 종류**로 쓰이고 있으면 confirm 과 무관하게 덮어쓰지 않고 멈춘다. */
function assertSameKind(id: string, existing: ExistingCredential, kind: CredentialKind | null, wanted: CredentialKind): void {
  if (kind === null || kind === wanted) return;
  const shown = existing.typeName || existing.className || kind;
  throw new Error(
    [
      `Jenkins credential "${id}" 가 이미 다른 종류로 존재합니다. / already exists as a different kind.`,
      `   기존 / existing:  ${shown} (${kindLabel(kind)})`,
      `   요청 / requested: ${kindLabel(wanted)}`,
      '',
      '덮어쓰면 기존 값이 사라집니다. 다른 id 를 쓰거나, 정말 교체하려면 먼저 삭제하세요.',
      'Replacing it would destroy the existing value — use a different id, or delete it first.',
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
  const existing = await inspectCredential(cfg, id);
  if (existing) assertSameKind(id, existing.info, existing.kind, KIND_STRING);
  const exists = existing !== null;
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
  const existing = await inspectCredential(cfg, id);
  if (existing) assertSameKind(id, existing.info, existing.kind, KIND_FILE);
  const exists = existing !== null;
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
