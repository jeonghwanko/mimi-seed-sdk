import type { JenkinsConfig } from './config.js';
import { fetchWithTimeout } from '../lib/http.js';
import { encodePathSegment } from '../lib/url-path.js';

export function basicAuth(username: string, token: string): string {
  return 'Basic ' + Buffer.from(`${username}:${token}`).toString('base64');
}

export function baseUrl(cfg: JenkinsConfig): string {
  return cfg.url.replace(/\/$/, '');
}

export function authHeaders(cfg: JenkinsConfig): Record<string, string> {
  return { Authorization: basicAuth(cfg.username, cfg.token) };
}

/**
 * CSRF crumb (best-effort). crumb issuer 비활성이거나 API 토큰으로 면제되면 빈 객체.
 * 구버전 Jenkins / 비밀번호 인증 환경에서 POST 403 방지.
 */
export async function getCrumb(cfg: JenkinsConfig): Promise<Record<string, string>> {
  try {
    const res = await fetchWithTimeout(`${baseUrl(cfg)}/crumbIssuer/api/json`, {
      headers: authHeaders(cfg),
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

/**
 * 엄격한 잡 경로 검사 — 빌드 도구(jenkins_trigger_build · jenkins_get_build_status)의 입력 스키마가 쓴다.
 *
 * jobUrl 은 세그먼트마다 encodePathSegment 로 인코딩하고 `.`/`..` 를 거부하지만, 옛 도구 호환 때문에
 * 빈 세그먼트(`a//b`, 끝의 `/`)는 조용히 버린다. 빌드를 **실행**하는 경로에서는 그런 모호함도 받지 않는다:
 * 빈·공백뿐인 세그먼트, `.`/`..`, 백슬래시(일부 프록시가 `/` 로 바꾼다), 제어 문자를 모두 거절한다.
 */
export function isStrictJobPath(jobPath: string): boolean {
  return jobPath.split('/').every(
    (segment) =>
      segment.trim().length > 0
      && segment !== '.'
      && segment !== '..'
      && !segment.includes('\\')
      && ![...segment].some((ch) => ch.charCodeAt(0) < 0x20 || ch.charCodeAt(0) === 0x7f),
  );
}

/**
 * 잡 경로를 Jenkins URL 로 바꾼다. 폴더는 `/` 로 구분한다.
 *   "my-app"              -> <base>/job/my-app
 *   "team-folder/my-app"  -> <base>/job/team-folder/job/my-app
 * 세그먼트는 encodePathSegment 로 인코딩한다 — `..` 세그먼트가 URL 정규화로 상위 경로(다른 잡)를
 * 가리키지 못하게 거부한다.
 */
export function jobUrl(cfg: JenkinsConfig, jobPath: string): string {
  const segments = jobPath.split('/').filter(Boolean);
  if (segments.length === 0) throw new Error('잡 이름이 비어 있습니다.');
  const suffix = segments.map((s) => `job/${encodePathSegment(s)}`).join('/');
  return `${baseUrl(cfg)}/${suffix}`;
}

/**
 * createItem 은 "부모 컨테이너" 에 POST 하고 leaf 이름을 쿼리로 넘긴다.
 * 루트 잡이면 부모가 Jenkins 루트, 폴더 안이면 폴더 URL.
 */
export function createItemUrl(cfg: JenkinsConfig, jobPath: string): string {
  const segments = jobPath.split('/').filter(Boolean);
  if (segments.length === 0) throw new Error('잡 이름이 비어 있습니다.');
  const leaf = segments.pop() as string;
  const parent = segments.length ? jobUrl(cfg, segments.join('/')) : baseUrl(cfg);
  return `${parent}/createItem?name=${encodeURIComponent(leaf)}`;
}

/** 실패 응답의 본문 일부를 붙여 에러를 만든다. Jenkins 는 원인을 본문에만 담는 경우가 많다. */
export async function jenkinsError(prefix: string, res: Response): Promise<Error> {
  let detail = '';
  try {
    detail = (await res.text()).trim().slice(0, 300);
  } catch {
    // 본문 없음
  }
  return new Error(`${prefix} (${res.status})${detail ? `: ${detail}` : ''}`);
}
