// 프로젝트 매니페스트(.mimi-seed.json) 리더 — CLI 판.
// mcp-server 패키지의 동명 리더와 스키마를 공유하지만, cli 는 mcp-server 를 의존하지 않으므로
// (별도 npm 패키지) 최소 리더를 여기 둔다. 스키마 변경 시 양쪽을 함께 수정할 것.

import fs from "node:fs";
import path from "node:path";

export const MANIFEST_FILENAME = ".mimi-seed.json";

export type SocialPlatform = "instagram" | "threads";

export type ManifestServiceId =
  | "oauth"
  | "bigquery"
  | "playstore"
  | "appstore"
  | "jenkins";

export interface ManifestService {
  required?: boolean;
  note?: string;
  projectId?: string;
  dataset?: string;
  packageName?: string;
  keyId?: string;
  issuerId?: string;
  url?: string;
  workspaceProvider?: string;
}

export interface ProjectManifest {
  project?: string;
  displayName?: string;
  description?: string;
  services?: Partial<Record<ManifestServiceId, ManifestService>>;
  socialProfiles?: Partial<Record<SocialPlatform, string>>;
}

export function isValidSocialProfileId(value: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(value);
}

export function manifestSocialProfile(
  m: ProjectManifest,
  platform: SocialPlatform,
): string | null {
  const profiles = m.socialProfiles as unknown;
  if (profiles === undefined) return null;
  if (!profiles || typeof profiles !== "object" || Array.isArray(profiles)) {
    throw new Error(`${MANIFEST_FILENAME} socialProfiles must be an object`);
  }
  const value = (profiles as Partial<Record<SocialPlatform, unknown>>)[platform];
  if (value === undefined) return null;
  if (typeof value !== "string" || !isValidSocialProfileId(value)) {
    throw new Error(
      `${MANIFEST_FILENAME} socialProfiles.${platform} must be a safe 1-64 character profile id`,
    );
  }
  return value;
}

export interface LoadedManifest {
  manifest: ProjectManifest;
  filePath: string;
}

/** startDir 에서 위로 올라가며 첫 `.mimi-seed.json` 을 찾는다. */
export function findProjectManifest(
  startDir: string = process.cwd(),
  maxDepth = 8,
): LoadedManifest | null {
  let dir = path.resolve(startDir);
  for (let i = 0; i <= maxDepth; i++) {
    const candidate = path.join(dir, MANIFEST_FILENAME);
    if (fs.existsSync(candidate)) {
      try {
        const obj = JSON.parse(fs.readFileSync(candidate, "utf-8")) as ProjectManifest;
        if (obj && typeof obj === "object") return { manifest: obj, filePath: candidate };
      } catch {
        /* 형식 오류 — null */
      }
      return null;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

export function manifestServiceEntries(
  m: ProjectManifest,
): Array<[ManifestServiceId, ManifestService]> {
  const svc = m.services ?? {};
  return (Object.keys(svc) as ManifestServiceId[])
    .filter((k) => svc[k] != null)
    .map((k) => [k, svc[k] as ManifestService]);
}
