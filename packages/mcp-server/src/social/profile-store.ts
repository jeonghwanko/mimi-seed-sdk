import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  lookupProjectManifest,
  isValidSocialProfileId,
  manifestSocialProfile,
  type SocialPlatform,
} from '#core/project-manifest.js';
import { writeCredentialJson } from '#core/atomic-write.js';
import { catalog } from '#core/lang.js';

const M = catalog(
  {
    invalidId:
      '소셜 프로필 ID가 올바르지 않습니다. ' +
      '영문자·숫자로 시작하는 1~64자의 영문자/숫자/점/밑줄/하이픈만 사용할 수 있습니다.',
    notObject: '객체 형식이 아닙니다.',
    unreadable: (file: string, msg: string) => `기존 소셜 프로필 파일을 읽을 수 없어 덮어쓰지 않았습니다: ${file} ` + `(${msg})`,
    profile: (id: string) => `프로필 '${id}'`,
    defaultProfile: '기본 프로필',
    manifestInvalid: (file: string) =>
      `프로젝트 매니페스트를 읽을 수 없어 어느 소셜 계정을 쓸지 정할 수 없습니다: ${file}. ` +
      '기본 계정으로 대신 게시하지 않습니다 — 파일을 고치거나, profile 인자로 프로필을 직접 지정하세요.',
  },
  {
    invalidId:
      'Invalid social profile ID. ' +
      'Use 1–64 characters of letters, digits, dots, underscores, or hyphens, starting with a letter or digit.',
    notObject: 'It is not an object.',
    unreadable: (file: string, msg: string) => `Could not read the existing social profile file, so it was not overwritten: ${file} (${msg})`,
    profile: (id: string) => `profile '${id}'`,
    defaultProfile: 'default profile',
    manifestInvalid: (file: string) =>
      `Cannot read the project manifest, so the social account to use is unknown: ${file}. ` +
      'Not falling back to the default account — fix the file, or pass the profile argument explicitly.',
  },
);

export interface SocialConfigOptions {
  /** 명시하면 프로젝트 매니페스트 매핑보다 우선한다. */
  profile?: string;
  /** 매니페스트 상향 탐색 시작점. 기본값은 현재 작업 디렉터리. */
  startDir?: string;
  /** 테스트 및 격리 실행용 홈 디렉터리. */
  homeDir?: string;
}

export interface SocialConfigTarget {
  filePath: string;
  profile: string | null;
}

type SocialProfileDocument = Partial<Record<SocialPlatform, unknown>>;

function validateProfileId(profile: string): string {
  if (!isValidSocialProfileId(profile)) {
    throw new Error(
      M().invalidId,
    );
  }
  return profile;
}

export function resolveSocialConfigTarget(
  platform: SocialPlatform,
  options: SocialConfigOptions = {},
): SocialConfigTarget {
  const homeDir = options.homeDir ?? os.homedir();
  const root = path.join(homeDir, '.mimi-seed');
  let profile: string | null = null;

  if (options.profile !== undefined) {
    profile = validateProfileId(options.profile);
  } else {
    // 매니페스트가 깨졌으면 기본 계정으로 폴백하지 않는다 — 그 파일이 다른 프로필을 지정했을 수 있다(다른 계정에 게시).
    // 매니페스트의 socialProfiles 값이 잘못된 경우(manifestSocialProfile 이 throw)와 같은 취급이다.
    const lookup = lookupProjectManifest(options.startDir ?? process.cwd());
    if (lookup.state === 'invalid') throw new Error(M().manifestInvalid(lookup.filePath));
    if (lookup.state === 'ok') profile = manifestSocialProfile(lookup.loaded.manifest, platform);
  }

  return profile
    ? { profile, filePath: path.join(root, 'social-profiles', `${profile}.json`) }
    : { profile: null, filePath: path.join(root, `${platform}.json`) };
}

export function loadSocialPlatformConfig<T>(
  platform: SocialPlatform,
  options: SocialConfigOptions = {},
): T | null {
  const target = resolveSocialConfigTarget(platform, options);
  try {
    const parsed = JSON.parse(fs.readFileSync(target.filePath, 'utf-8')) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    if (target.profile) {
      return ((parsed as SocialProfileDocument)[platform] as T | undefined) ?? null;
    }
    return parsed as T;
  } catch {
    // 깨진 설정은 '미설정' — 대상 파일이 이미 정해져 다른 계정으로 넘어가지 않고, 깨진 파일은 mimi_seed_status 가 보고한다
    return null;
  }
}

export function saveSocialPlatformConfig<T extends object>(
  platform: SocialPlatform,
  config: T,
  options: SocialConfigOptions = {},
): SocialConfigTarget {
  const target = resolveSocialConfigTarget(platform, options);

  let value: T | SocialProfileDocument = config;
  if (target.profile) {
    let existing: SocialProfileDocument = {};
    if (fs.existsSync(target.filePath)) {
      try {
        const parsed = JSON.parse(fs.readFileSync(target.filePath, 'utf-8')) as unknown;
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
          throw new Error(M().notObject);
        }
        existing = parsed;
      } catch (error) {
        throw new Error(
          M().unreadable(target.filePath, error instanceof Error ? error.message : String(error)),
          { cause: error },
        );
      }
    }
    value = { ...existing, [platform]: config };
  }

  writeCredentialJson(target.filePath, value);
  return target;
}

export function socialTargetLabel(target: SocialConfigTarget): string {
  return target.profile ? M().profile(target.profile) : M().defaultProfile;
}
