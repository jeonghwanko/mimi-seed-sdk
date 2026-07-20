// 프로젝트 매니페스트(.mimi-seed.json) 리더.
//
// 프로젝트 루트에 커밋된 `.mimi-seed.json` 이 "이 저장소를 mimi-seed 로 다루려면
// 어떤 서비스 연결이 필요한가"를 선언한다. mimi_seed_status(MCP)와 mimi-seed doctor(CLI)가
// 이 파일을 읽어, 범용 9종 스캔 대신 "이 프로젝트에서 너한테 빠진 것 + 정확한 셋업 명령"을 보여준다.
//
// 팀 온보딩 목적: 새 팀원이 clone → mimi_seed_status 호출 → 안내 따라가기 만으로
// 자기 머신에 필요한 자격증명을 채울 수 있게 한다.

import fs from 'node:fs';
import path from 'node:path';

export const MANIFEST_FILENAME = '.mimi-seed.json';
export const SOCIAL_PROFILE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

export type SocialPlatform = 'instagram' | 'threads';

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
 * startDir 에서 위로 올라가며 첫 번째 `.mimi-seed.json` 을 찾는다.
 * MCP stdio 서버의 cwd 는 보통 프로젝트 루트지만, 하위 폴더에서 실행돼도 잡히게 상향 탐색한다.
 * maxDepth 로 홈 디렉터리 밖까지 무한 상승하는 것을 방지.
 */
export function findProjectManifest(
  startDir: string = process.cwd(),
  maxDepth = 8,
): LoadedManifest | null {
  let dir = path.resolve(startDir);
  for (let i = 0; i <= maxDepth; i++) {
    const candidate = path.join(dir, MANIFEST_FILENAME);
    if (fs.existsSync(candidate)) {
      const parsed = safeParse(candidate);
      if (parsed) return { manifest: parsed, filePath: candidate };
      return null; // 파일은 있으나 형식 오류 — 상위로 더 올라가지 않는다(의도 명확).
    }
    const parent = path.dirname(dir);
    if (parent === dir) break; // 루트 도달
    dir = parent;
  }
  return null;
}

function safeParse(filePath: string): ProjectManifest | null {
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    const obj = JSON.parse(raw) as ProjectManifest;
    if (obj && typeof obj === 'object') return obj;
    return null;
  } catch {
    return null;
  }
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

/** 매니페스트에 지정된 플랫폼 프로필. 잘못된 값은 조용히 무시하지 않고 오류로 막는다. */
export function manifestSocialProfile(
  m: ProjectManifest,
  platform: SocialPlatform,
): string | null {
  const value = m.socialProfiles?.[platform];
  if (value === undefined) return null;
  if (typeof value !== 'string' || !isValidSocialProfileId(value)) {
    throw new Error(
      `${MANIFEST_FILENAME}의 socialProfiles.${platform} 값이 올바르지 않습니다. ` +
      '영문자·숫자로 시작하는 1~64자의 영문자/숫자/점/밑줄/하이픈만 사용할 수 있습니다.',
    );
  }
  return value;
}
