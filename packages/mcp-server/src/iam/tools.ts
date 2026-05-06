import { google } from 'googleapis';
import type { OAuth2Client } from 'google-auth-library';

/**
 * Google Cloud IAM + Cloud Resource Manager 래퍼.
 *
 * 사용자가 mimi-seed-mcp로 "서비스 계정 만들기 → JSON 키 발급 → Cloud IAM
 * 역할 부여"를 자동화할 때 쓰는 도구들. (Play Console의 'View financial
 * data' 권한은 여기서 부여하는 Cloud IAM 역할과는 별개 — 그건 Play Console
 * Users and permissions에서 androidpublisher.users API 또는 수동으로.)
 */

const iam = () => google.iam('v1');
const crm = () => google.cloudresourcemanager('v1');

// ─── 서비스 계정 조회 ───

export async function listServiceAccounts(auth: OAuth2Client, projectId: string) {
  const res = await iam().projects.serviceAccounts.list({
    auth,
    name: `projects/${projectId}`,
    pageSize: 100,
  });
  return (res.data.accounts ?? []).map((a) => ({
    email: a.email,
    displayName: a.displayName,
    uniqueId: a.uniqueId,
    disabled: a.disabled ?? false,
  }));
}

// ─── 서비스 계정 생성 ───

export async function createServiceAccount(
  auth: OAuth2Client,
  projectId: string,
  accountId: string,
  displayName: string,
) {
  const res = await iam().projects.serviceAccounts.create({
    auth,
    name: `projects/${projectId}`,
    requestBody: {
      accountId,
      serviceAccount: { displayName },
    },
  });
  return {
    email: res.data.email,
    uniqueId: res.data.uniqueId,
    displayName: res.data.displayName,
    projectId: res.data.projectId,
  };
}

// ─── 키 발급 (JSON 다운로드) ───

export async function createServiceAccountKey(
  auth: OAuth2Client,
  serviceAccountEmail: string,
) {
  const res = await iam().projects.serviceAccounts.keys.create({
    auth,
    name: `projects/-/serviceAccounts/${serviceAccountEmail}`,
    requestBody: {
      keyAlgorithm: 'KEY_ALG_RSA_2048',
      privateKeyType: 'TYPE_GOOGLE_CREDENTIALS_FILE',
    },
  });
  // privateKeyData는 base64로 인코딩된 JSON 전체 — 디코딩해서 반환.
  // 주의: 이 JSON은 영구 자격증명이므로 절대 로그에 남기거나 원격으로 보내면 안 됨.
  const privateKeyData = res.data.privateKeyData;
  if (!privateKeyData) throw new Error('No privateKeyData in response');
  const jsonString = Buffer.from(privateKeyData, 'base64').toString('utf-8');
  // 파싱해서 필드 일부만 미리보기로 노출 + 전체 JSON도 함께 반환
  const parsed: Record<string, unknown> = JSON.parse(jsonString);
  return {
    keyId: res.data.name?.split('/').pop() ?? null,
    clientEmail: parsed.client_email as string | undefined,
    projectId: parsed.project_id as string | undefined,
    json: jsonString,
  };
}

// ─── 키 목록 ───

export async function listServiceAccountKeys(auth: OAuth2Client, serviceAccountEmail: string) {
  const res = await iam().projects.serviceAccounts.keys.list({
    auth,
    name: `projects/-/serviceAccounts/${serviceAccountEmail}`,
  });
  return (res.data.keys ?? []).map((k) => ({
    id: k.name?.split('/').pop() ?? null,
    keyType: k.keyType, // 'USER_MANAGED' | 'SYSTEM_MANAGED'
    validBeforeTime: k.validBeforeTime,
    validAfterTime: k.validAfterTime,
  }));
}

// ─── 프로젝트 IAM 정책에 역할 바인딩 추가 ───

/**
 * 프로젝트의 IAM 정책을 read-modify-write 해서 member에게 role 부여.
 * 이미 같은 (role, member) 바인딩이 있으면 no-op.
 *
 * member 예:
 *   'serviceAccount:my-sa@my-project.iam.gserviceaccount.com'
 *   'user:alice@example.com'
 *   'group:admins@example.com'
 *
 * 자주 쓰는 role 예:
 *   'roles/iam.serviceAccountUser'         — 서비스 계정으로 위임 가능
 *   'roles/iam.serviceAccountTokenCreator' — 서비스 계정의 단기 토큰 발급
 *   'roles/editor' / 'roles/owner'         — 광범위 (조심)
 */
export async function addProjectIamPolicyBinding(
  auth: OAuth2Client,
  projectId: string,
  member: string,
  role: string,
): Promise<{ added: boolean; role: string; member: string; etag: string | null | undefined }> {
  const current = await crm().projects.getIamPolicy({
    auth,
    resource: projectId,
    requestBody: {},
  });
  const policy = current.data;
  const bindings = policy.bindings ?? [];
  const existing = bindings.find((b) => b.role === role);

  let added = false;
  if (existing) {
    const members = existing.members ?? [];
    if (!members.includes(member)) {
      existing.members = [...members, member];
      added = true;
    }
  } else {
    bindings.push({ role, members: [member] });
    added = true;
  }

  if (!added) {
    return { added: false, role, member, etag: policy.etag };
  }

  const updated = await crm().projects.setIamPolicy({
    auth,
    resource: projectId,
    requestBody: { policy: { bindings, etag: policy.etag } },
  });
  return { added: true, role, member, etag: updated.data.etag };
}
