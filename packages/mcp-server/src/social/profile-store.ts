import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  findProjectManifest,
  isValidSocialProfileId,
  manifestSocialProfile,
  type SocialPlatform,
} from '../lib/project-manifest.js';

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
      '소셜 프로필 ID가 올바르지 않습니다. ' +
      '영문자·숫자로 시작하는 1~64자의 영문자/숫자/점/밑줄/하이픈만 사용할 수 있습니다.',
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
    const loaded = findProjectManifest(options.startDir ?? process.cwd());
    if (loaded) profile = manifestSocialProfile(loaded.manifest, platform);
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
    return null;
  }
}

export function saveSocialPlatformConfig<T extends object>(
  platform: SocialPlatform,
  config: T,
  options: SocialConfigOptions = {},
): SocialConfigTarget {
  const target = resolveSocialConfigTarget(platform, options);
  const dir = path.dirname(target.filePath);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });

  let value: T | SocialProfileDocument = config;
  if (target.profile) {
    let existing: SocialProfileDocument = {};
    if (fs.existsSync(target.filePath)) {
      try {
        const parsed = JSON.parse(fs.readFileSync(target.filePath, 'utf-8')) as unknown;
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
          throw new Error('객체 형식이 아닙니다.');
        }
        existing = parsed as SocialProfileDocument;
      } catch (error) {
        throw new Error(
          `기존 소셜 프로필 파일을 읽을 수 없어 덮어쓰지 않았습니다: ${target.filePath} ` +
          `(${error instanceof Error ? error.message : String(error)})`,
        );
      }
    }
    value = { ...existing, [platform]: config };
  }

  fs.writeFileSync(target.filePath, JSON.stringify(value, null, 2), { mode: 0o600 });
  if (process.platform !== 'win32') fs.chmodSync(target.filePath, 0o600);
  return target;
}

export function socialTargetLabel(target: SocialConfigTarget): string {
  return target.profile ? `프로필 '${target.profile}'` : '기본 프로필';
}
