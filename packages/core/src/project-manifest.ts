// 프로젝트 매니페스트(.mimi-seed.json) 리더.
//
// 프로젝트 루트에 커밋된 `.mimi-seed.json` 이 "이 저장소를 mimi-seed 로 다루려면
// 어떤 서비스 연결이 필요한가"를 선언한다. mimi_seed_status(MCP)와 mimi-seed doctor(CLI)가
// 이 파일을 읽어, 범용 9종 스캔 대신 "이 프로젝트에서 너한테 빠진 것 + 정확한 셋업 명령"을 보여준다.
//
// 팀 온보딩 목적: 새 팀원이 clone → mimi_seed_status 호출 → 안내 따라가기 만으로
// 자기 머신에 필요한 자격증명을 채울 수 있게 한다.
//
// 두 패키지가 **이 한 리더**를 쓴다 (예전엔 cli 에 손으로 복제한 최소 리더가 따로 있었고,
// manifest-schema-parity 테스트가 두 사본의 스키마를 텍스트로 비교했다).

import fs from 'node:fs';
import path from 'node:path';

export const MANIFEST_FILENAME = '.mimi-seed.json';
export const SOCIAL_PROFILE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

export type SocialPlatform = 'instagram' | 'threads' | 'facebook';

/** 매니페스트가 인지하는 서비스 id. status 매칭 로직이 이 키를 기준으로 동작한다. */
export type ManifestServiceId =
  | 'oauth'
  | 'bigquery'
  | 'playstore'
  | 'appstore'
  | 'jenkins';

export interface ManifestService {
  /** 이 프로젝트에서 필수인지. false(선택)면 미설정이어도 ❌ 대신 정보 표기. */
  required?: boolean;
  /** 사람이 읽을 한 줄 설명. status 출력에 그대로 표시. */
  note?: string;
  // 서비스별 식별자 — status 힌트에 그대로 끼워 넣어 "정확한 명령"을 만든다.
  projectId?: string;   // bigquery GCP project
  dataset?: string;     // bigquery dataset
  packageName?: string; // playstore package
  keyId?: string;       // appstore ASC key id
  issuerId?: string;    // appstore issuer id
  url?: string;         // jenkins url
  jobAndroid?: string;
  jobIos?: string;
  /** 이 서비스가 워크스페이스 공유 시크릿(provider)으로도 제공되는 경우 그 provider id. */
  workspaceProvider?: string;
}

export interface ProjectManifest {
  project?: string;
  displayName?: string;
  description?: string;
  services?: Partial<Record<ManifestServiceId, ManifestService>>;
  /** 플랫폼별로 ~/.mimi-seed/social-profiles/<id>.json 을 선택한다. */
  socialProfiles?: Partial<Record<SocialPlatform, string>>;
}

export interface LoadedManifest {
  manifest: ProjectManifest;
  /** 실제로 읽은 파일 절대 경로. */
  filePath: string;
}

/**
 * `.mimi-seed.json` 탐색 결과 — 없음 / 정상 / **깨짐**.
 *
 * 예전엔 깨진 파일(JSON 문법 오류 · 객체 아님 · 읽기 실패)도 null 이 되어 "매니페스트 없음"과 구분되지 않았다.
 * 그러면 팀이 선언한 요구사항 점검이 조용히 사라지고, 소셜 게시는 매니페스트가 지정한 프로필 대신 기본 계정으로
 * 폴백한다(다른 계정에 게시). 사람에게 보이는 쪽은 `invalid` 를 알리고, 게시 경로는 막아야 한다.
 * `reason` 은 언어 중립 코드다 — 문구는 각 패키지가 자기 언어로 만든다.
 */
export type ManifestLookup =
  | { state: 'missing' }
  | { state: 'ok'; loaded: LoadedManifest }
  | { state: 'invalid'; filePath: string; reason: 'unreadable' | 'invalid-json' | 'not-an-object' };

/**
 * startDir 에서 위로 올라가며 첫 번째 `.mimi-seed.json` 을 찾는다.
 * MCP stdio 서버의 cwd 는 보통 프로젝트 루트지만, 하위 폴더에서 실행돼도 잡히게 상향 탐색한다.
 * maxDepth 로 홈 디렉터리 밖까지 무한 상승하는 것을 방지. 깨진 파일을 만나면 상위로 더 올라가지 않는다 —
 * 그 파일이 이 프로젝트의 의도이므로, 상위 폴더의 다른 매니페스트로 대신하지 않는다.
 */
export function lookupProjectManifest(startDir: string = process.cwd(), maxDepth = 8): ManifestLookup {
  let dir = path.resolve(startDir);
  for (let i = 0; i <= maxDepth; i++) {
    const candidate = path.join(dir, MANIFEST_FILENAME);
    if (fs.existsSync(candidate)) return parseManifest(candidate);
    const parent = path.dirname(dir);
    if (parent === dir) break; // 루트 도달
    dir = parent;
  }
  return { state: 'missing' };
}

/**
 * 정상 매니페스트만 돌려준다 (없음 · 깨짐은 null). 깨짐을 알려야 하는 호출자는 lookupProjectManifest 를 쓴다.
 */
export function findProjectManifest(
  startDir: string = process.cwd(),
  maxDepth = 8,
): LoadedManifest | null {
  const result = lookupProjectManifest(startDir, maxDepth);
  return result.state === 'ok' ? result.loaded : null;
}

function parseManifest(filePath: string): ManifestLookup {
  let raw: string;
  try {
    raw = fs.readFileSync(filePath, 'utf-8');
  } catch {
    return { state: 'invalid', filePath, reason: 'unreadable' };
  }
  let obj: unknown;
  try {
    obj = JSON.parse(raw);
  } catch {
    return { state: 'invalid', filePath, reason: 'invalid-json' };
  }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return { state: 'invalid', filePath, reason: 'not-an-object' };
  return { state: 'ok', loaded: { manifest: obj, filePath } };
}

/** 매니페스트 services 를 [id, service] 배열로. 없으면 빈 배열. */
export function manifestServiceEntries(
  m: ProjectManifest,
): Array<[ManifestServiceId, ManifestService]> {
  const svc = m.services ?? {};
  return (Object.keys(svc) as ManifestServiceId[])
    .filter((k) => svc[k] != null)
    .map((k) => [k, svc[k] as ManifestService]);
}

/** 파일명으로 안전하게 사용할 수 있는 공개 프로필 id인지 확인한다. */
export function isValidSocialProfileId(value: string): boolean {
  return SOCIAL_PROFILE_ID_PATTERN.test(value);
}

/**
 * socialProfiles 검증 실패 문구. **검증 규칙은 하나**지만 문구는 소비자마다 다르다 — MCP 도구
 * 출력(LLM 이 읽는다)은 한국어 기본값을, CLI 는 자기 출력 언어의 문구를 넘긴다.
 */
export interface SocialProfileMessages {
  notAnObject: string;
  invalidId: (platform: SocialPlatform) => string;
}

export const SOCIAL_PROFILE_MESSAGES_KO: SocialProfileMessages = {
  notAnObject: `${MANIFEST_FILENAME}의 socialProfiles는 객체여야 합니다.`,
  invalidId: (platform) =>
    `${MANIFEST_FILENAME}의 socialProfiles.${platform} 값이 올바르지 않습니다. ` +
    '영문자·숫자로 시작하는 1~64자의 영문자/숫자/점/밑줄/하이픈만 사용할 수 있습니다.',
};

/** 매니페스트에 지정된 플랫폼 프로필. 잘못된 값은 조용히 무시하지 않고 오류로 막는다. */
export function manifestSocialProfile(
  m: ProjectManifest,
  platform: SocialPlatform,
  messages: SocialProfileMessages = SOCIAL_PROFILE_MESSAGES_KO,
): string | null {
  const profiles = m.socialProfiles as unknown;
  if (profiles === undefined) return null;
  if (!profiles || typeof profiles !== 'object' || Array.isArray(profiles)) {
    throw new Error(messages.notAnObject);
  }
  const value = (profiles as Partial<Record<SocialPlatform, unknown>>)[platform];
  if (value === undefined) return null;
  if (typeof value !== 'string' || !isValidSocialProfileId(value)) {
    throw new Error(messages.invalidId(platform));
  }
  return value;
}
