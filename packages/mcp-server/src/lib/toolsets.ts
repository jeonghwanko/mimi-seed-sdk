import type { ToolManifest } from './package-root.js';

/**
 * MIMI_SEED_TOOLSETS — 노출할 도구 도메인을 고른다.
 *
 * 150+ 개 도구를 전부 노출하면 lazy-load 가 없는 클라이언트(Cursor 등)는 도구 목록만으로
 * 컨텍스트를 크게 쓰고, 도구 수 상한이 있는 클라이언트는 아예 잘린다. 그래서 필요한
 * 도메인만 켤 수 있게 한다. 기본값(미설정)은 전부 — 기존 동작과 같다.
 *
 * - `MIMI_SEED_TOOLSETS`         쉼표 구분. manifest 도메인 키(`playstore`) 또는 manifest
 *                                 `toolsets` 의 그룹 키(`store`), 그리고 내장 키워드 `all`.
 * - `MIMI_SEED_TOOLSETS_EXCLUDE` 같은 문법. include 결과에서 뺀다.
 * - manifest `alwaysOn`(auth · checks)은 어떤 설정이든 켜져 있다 — 상태 진단과 로그인이
 *   없으면 나머지 도메인을 쓸 수 없다.
 * - 도구 단위 판정: 도구는 자기 도메인 + manifest `alsoInToolsets` 의 도메인들에 속한다. 그중 하나라도
 *   include 되면 켜지고, 하나라도 exclude 되면 꺼진다 (alwaysOn 소속이면 항상 켜짐). 예: video.ts 가 등록하는
 *   `youtube_upload_video` 는 `youtube` 로도 켜지고, android.ts 의 `jenkins_upload_playstore_sa` 는 `jenkins` 로도 켜진다.
 * - 모르는 키는 stderr 경고 후 무시한다. include 에 유효한 키가 하나도 없으면(오타 등)
 *   조용히 거의 빈 서버가 되는 대신 전부를 켠다.
 */
export const TOOLSETS_ENV = 'MIMI_SEED_TOOLSETS';
export const TOOLSETS_EXCLUDE_ENV = 'MIMI_SEED_TOOLSETS_EXCLUDE';

export interface ToolsetSelection {
  /** 켜진 도메인 키 집합 (alwaysOn 포함). 도메인 밖 도구의 소속(alsoInToolsets)은 isToolEnabled 가 본다. */
  enabled: ReadonlySet<string>;
  /** 이 도구를 등록할지 — 소속 도메인 중 하나가 include 되고 어느 것도 exclude 되지 않았으면 true. */
  isToolEnabled(name: string): boolean;
  /** 모든 도메인이 켜져 있는가 (기본값). */
  all: boolean;
  /** 사용자가 준 원문 (정규화된 키 목록). */
  include: string[];
  exclude: string[];
  /** 무시한 키 등 사용자에게 보여줄 경고. */
  warnings: string[];
}

function parseList(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

/** 키 하나를 도메인 목록으로 펼친다. 모르는 키면 null. */
function expandKey(key: string, manifest: ToolManifest): string[] | null {
  const domains = Object.keys(manifest.domains);
  if (key === 'all') return domains;
  if (manifest.domains[key]) return [key];
  const group = manifest.toolsets?.[key];
  if (group) return group.filter((d) => manifest.domains[d]);
  return null;
}

export function resolveToolsets(
  env: NodeJS.ProcessEnv,
  manifest: ToolManifest,
): ToolsetSelection {
  const allDomains = Object.keys(manifest.domains);
  const alwaysOn = (manifest.alwaysOn ?? []).filter((d) => manifest.domains[d]);
  const include = parseList(env[TOOLSETS_ENV]);
  const exclude = parseList(env[TOOLSETS_EXCLUDE_ENV]);
  const warnings: string[] = [];

  const expand = (keys: string[], envName: string): Set<string> => {
    const out = new Set<string>();
    for (const key of keys) {
      const domains = expandKey(key, manifest);
      if (domains === null) {
        warnings.push(`${envName}: 알 수 없는 toolset "${key}" — 무시함 (도메인 키 또는 그룹: ${knownKeys(manifest).join(', ')})`);
        continue;
      }
      for (const d of domains) out.add(d);
    }
    return out;
  };

  let included = include.length > 0 ? expand(include, TOOLSETS_ENV) : new Set(allDomains);
  if (include.length > 0 && included.size === 0) {
    warnings.push(`${TOOLSETS_ENV}: 유효한 toolset 이 없어 전체 도메인을 켭니다.`);
    included = new Set(allDomains);
  }
  const excluded = expand(exclude, TOOLSETS_EXCLUDE_ENV);
  const always = new Set(alwaysOn);

  const enabled = new Set([...included].filter((d) => !excluded.has(d)));
  for (const d of always) enabled.add(d);

  // 도구 → 소속 도메인들 (등록 도메인 + alsoInToolsets).
  const membership = new Map<string, string[]>();
  for (const [domain, entry] of Object.entries(manifest.domains)) {
    for (const tool of entry.tools) membership.set(tool, [domain, ...(manifest.alsoInToolsets?.[tool] ?? [])]);
  }
  const isToolEnabled = (name: string): boolean => {
    const domains = membership.get(name) ?? [];
    if (domains.some((d) => always.has(d))) return true;
    if (domains.some((d) => excluded.has(d))) return false;
    return domains.some((d) => included.has(d));
  };

  return {
    enabled,
    isToolEnabled,
    // exclude 된 도메인이 있으면 다른 도메인 소속 도구(alsoInToolsets)도 빠질 수 있어 'all' 이 아니다.
    all: allDomains.every((d) => enabled.has(d)) && [...excluded].every((d) => always.has(d)),
    include,
    exclude,
    warnings,
  };
}

/** 사용자가 쓸 수 있는 키 전체 (경고 메시지·문서용). */
export function knownKeys(manifest: ToolManifest): string[] {
  return ['all', ...Object.keys(manifest.toolsets ?? {}), ...Object.keys(manifest.domains)];
}

/** mimi_seed_status 한 줄 요약. */
export function describeToolsets(selection: ToolsetSelection, manifest: ToolManifest): string {
  if (selection.all) return `all (${Object.keys(manifest.domains).length} domains)`;
  const on = Object.keys(manifest.domains).filter((d) => selection.enabled.has(d));
  return `${on.join(', ')} — ${TOOLSETS_ENV}/${TOOLSETS_EXCLUDE_ENV} 로 제한됨`;
}
