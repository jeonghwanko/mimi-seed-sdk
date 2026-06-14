/**
 * App Store Connect API 에러 친절화.
 *
 * Apple은 표준 JSON 에러 응답을 내려준다:
 *   { "errors": [{ "code": "...", "title": "...", "detail": "...",
 *                  "source": { "pointer": "/data/attributes/whatsNew" } }] }
 *
 * 실제 거부 사례에서 자주 만나는 코드별 hint 를 첨가해
 * "App Store API 409: { errors: [...] }" 같은 raw dump 대신
 * 무엇을 고쳐야 하는지 즉시 보이게 한다.
 *
 * 비표준 body (HTML, plain text, 빈 응답 등) 는 폴백으로 원본 보존.
 */

/** Apple JSON Error response 구조 (단일 errors 배열). */
interface AppleError {
  id?: string;
  code?: string;
  status?: string;
  title?: string;
  detail?: string;
  source?: { pointer?: string; parameter?: string };
}

interface AppleErrorPayload {
  errors?: AppleError[];
}

/** Apple 에러 코드 → 친절한 hint (실측 거부 사례 기반). */
const CODE_HINTS: Record<string, string> = {
  // What's New / localization 텍스트 검증 실패
  INVALID_CHARACTERS:
    'HTML 태그·금지 문자가 포함됐어요. 제출 전 lib/text-validators.ts 로 사전 검증 권장.',
  // 버전 상태가 편집 불가 (READY_FOR_SALE / WAITING_FOR_REVIEW 등)
  ENTITY_STATE_INVALID:
    '버전 상태가 편집 가능 단계가 아니에요 (이미 심사중/출시됨). 새 versionString 으로 appstore_create_version 필요할 수 있어요.',
  // 필수 필드 누락
  ENTITY_ERROR_ATTRIBUTE_REQUIRED:
    '필수 필드가 빠졌어요 — source.pointer 위치 확인.',
  // 길이 / 형식 위반
  ENTITY_ERROR_ATTRIBUTE_INVALID:
    '필드 값이 정책 위반(길이/형식). source.pointer 위치 확인.',
  // 빌드 attach 시 빌드를 못 찾음
  NOT_FOUND:
    '대상 리소스를 찾을 수 없어요 — id/versionId/buildId 가 유효한지, 동일 앱 소속인지 확인.',
  // 권한 부족 (API Key role 문제)
  FORBIDDEN_ERROR:
    'API Key 권한 부족 — App Store Connect > Users and Access 에서 키 role 확인.',
  // submit 직후 cancel 시도 (큐 진입 후)
  STATE_ERROR:
    '현재 상태에서 허용되지 않는 작업. cancel_review 라면 큐 진입 후라서 불가 — 새 versionString 으로 우회.',
  // JWT 거부 — 잘못된 자격증명
  NOT_AUTHORIZED:
    'API 키가 거부됐어요 — issuerId/keyId/.p8 조합 불일치 가능. appstore_verify_credentials 로 진단하고 mimi-seed auth appstore 로 재등록.',
};

/** Apple 표준 에러 응답 파싱 시도. 실패하면 null 반환. */
function parseAppleErrorBody(body: string): AppleError[] | null {
  if (!body) return null;
  try {
    const parsed: AppleErrorPayload = JSON.parse(body);
    if (Array.isArray(parsed?.errors) && parsed.errors.length > 0) {
      return parsed.errors;
    }
    return null;
  } catch {
    return null;
  }
}

/** 단일 Apple error → 한 줄 사람용 표기. */
function formatAppleError(e: AppleError): string {
  const code = e.code ?? 'UNKNOWN';
  const detail = e.detail ?? e.title ?? '(no detail)';
  const pointer = e.source?.pointer ?? e.source?.parameter;
  const hint = e.code ? CODE_HINTS[e.code] : undefined;
  const parts = [`[${code}] ${detail}`];
  if (pointer) parts.push(`@ ${pointer}`);
  if (hint) parts.push(`\n  💡 ${hint}`);
  return parts.join(' ');
}

/**
 * App Store API 응답 (status + raw body) 을 친절한 Error 로 변환.
 *
 * - 표준 Apple JSON: `App Store API {status}: [CODE] detail @ pointer 💡 hint` 형식.
 *   여러 errors 가 있으면 줄바꿈으로 나열.
 * - 비표준 body: 기존 형식(`App Store API {status}: {body}`) 그대로 보존.
 *
 * `Error.cause` 에 원본 `{ status, body, parsedErrors }` 첨부 — 호출자가 코드별 분기 필요 시 사용.
 */
export function friendlyAppStoreError(status: number, body: string): Error {
  const errors = parseAppleErrorBody(body);
  let message: string;
  if (errors) {
    const formatted = errors.map(formatAppleError).join('\n');
    message = `App Store API ${status}:\n${formatted}`;
  } else {
    message = `App Store API ${status}: ${body}`;
  }
  const err = new Error(message);
  // 원본 보존 — 호출자 코드별 retry 분기용.
  (err as Error & { cause?: unknown }).cause = { status, body, parsedErrors: errors ?? undefined };
  return err;
}

// ── 테스트용 export ────────────────────────────────────────────
export const __testing = {
  CODE_HINTS,
  parseAppleErrorBody,
  formatAppleError,
};
