// Google API 에러 친절화 (Firebase / Cloud Resource Manager / 공용 OAuth).
// raw GaxiosError dump 대신 "무엇을 어떻게 고칠지"를 즉시 보여준다.
// 인식 못 한 에러는 원본을 그대로 보존한다.

const REAUTH = '터미널에서 재로그인:\n  npx -y @yoonion/mimi-seed-mcp mimi-seed-auth';

export function extractHttpStatus(e: unknown): number | undefined {
  if (e && typeof e === 'object') {
    const any = e as { code?: unknown; status?: unknown; response?: { status?: unknown } };
    if (typeof any.code === 'number') return any.code;
    if (typeof any.status === 'number') return any.status;
    if (any.response && typeof any.response.status === 'number') return any.response.status;
  }
  return undefined;
}

export function rawMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === 'string') return e;
  try {
    return JSON.stringify(e);
  } catch {
    return String(e);
  }
}

/**
 * Google API 에러에서 구조화된 실제 사유를 추출한다. GaxiosError는
 * `response.data.error.{message,errors[].reason}` 에 진짜 원인을 담는데,
 * 친절화 레이어가 이를 버리고 일반 메시지("권한 없음")로 덮으면, 권한이 멀쩡한데도
 * 권한 문제로 오진하게 된다 (예: 같은 SA로 이미지 업로드는 되는데 listings.update만 403).
 * 추출 실패 시 undefined.
 */
export function googleErrorDetail(e: unknown): string | undefined {
  if (!e || typeof e !== 'object') return undefined;
  const any = e as {
    errors?: Array<{ reason?: string; message?: string }>;
    response?: { data?: { error?: { message?: unknown; errors?: Array<{ reason?: string; message?: string }> } } };
  };
  const apiErr = any.response?.data?.error;
  const parts: string[] = [];
  if (apiErr?.message) parts.push(String(apiErr.message));
  const reasons = apiErr?.errors ?? any.errors;
  if (Array.isArray(reasons)) {
    for (const r of reasons) {
      const bit = [r?.reason, r?.message].filter(Boolean).join(': ');
      if (bit && !parts.some((p) => p.includes(bit))) parts.push(bit);
    }
  }
  const joined = parts.join(' | ').trim();
  return joined.length ? joined : undefined;
}

/** invalid_grant / 만료 refresh_token / 부족 scope → 재로그인 안내 메시지. 아니면 null. */
export function authReauthMessage(text: string): string | null {
  if (/invalid_grant|invalid_rapt|rapt_required|unauthorized_client|ACCESS_TOKEN_SCOPE_INSUFFICIENT|insufficient.*scope/i.test(text)) {
    return ['❌ Google 인증이 만료됐거나 권한이 부족해요.', '', REAUTH].join('\n');
  }
  return null;
}

function extractActivationUrl(text: string): string | undefined {
  const m = text.match(/https?:\/\/console\.(?:developers|cloud)\.google\.com\/\S+/);
  return m?.[0]?.replace(/[).,'"]+$/, '');
}

export function withCause(err: Error, cause: unknown): Error {
  (err as Error & { cause?: unknown }).cause = cause;
  return err;
}

/**
 * Firebase / GCP 에러를 친절 메시지로 변환. 신규 사용자가 가장 자주 만나는
 * 'API 미활성화 / 프로젝트 없음 / billing / 권한' 케이스에 다음 행동을 붙인다.
 */
export function friendlyGoogleError(e: unknown): Error {
  const text = rawMessage(e);
  const status = extractHttpStatus(e);

  const reauth = authReauthMessage(text);
  if (reauth) return withCause(new Error(reauth), e);

  if (/SERVICE_DISABLED|has not been used in project|is disabled|accessNotConfigured/i.test(text)) {
    const url = extractActivationUrl(text);
    return withCause(
      new Error(
        [
          '❌ 필요한 Google API가 비활성화돼 있어요.',
          url ? `→ 활성화: ${url}` : '→ Google Cloud Console에서 해당 API를 활성화한 뒤 다시 시도하세요.',
        ].join('\n'),
      ),
      e,
    );
  }
  if (/BILLING_DISABLED|billing.*(disabled|not enabled|required)/i.test(text)) {
    return withCause(
      new Error('❌ 결제(billing)가 비활성화된 프로젝트예요.\n→ Google Cloud Console → 결제 에서 결제 계정을 연결하세요.'),
      e,
    );
  }
  if (status === 404 || /NOT_FOUND|not found/i.test(text)) {
    return withCause(
      new Error('❌ 프로젝트/리소스를 찾을 수 없어요.\n→ firebase_list_projects 로 유효한 projectId를 확인하세요.'),
      e,
    );
  }
  if (status === 403 || /PERMISSION_DENIED|forbidden|permission/i.test(text)) {
    return withCause(
      new Error('❌ 권한 부족 — 이 Google 계정이 해당 프로젝트에 접근 권한이 있는지 확인하세요.'),
      e,
    );
  }
  return e instanceof Error ? e : new Error(text);
}
