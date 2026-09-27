import { readFileSync } from 'node:fs';

/**
 * 패키지 루트의 파일을 읽는다 (없거나 못 읽으면 throw).
 * src/lib/ 와 dist/lib/ 모두 패키지 루트에서 두 단계 아래라 `../../` 가 같은 곳을 가리킨다 —
 * dev(tsx)·vitest·배포본(npm) 어디서 실행해도 동일하게 동작한다.
 * 개별 `new URL('../..', import.meta.url)` 복사본을 만들지 말고 이 헬퍼를 쓸 것
 * (빌드 레이아웃이 바뀌면 여기 한 곳만 고치면 된다).
 */
export function readPackageRootText(relativePath: string): string {
  return readFileSync(new URL(`../../${relativePath}`, import.meta.url), 'utf8');
}

export type DomainEntry = {
  /** 사람이 읽는 도메인 이름 (예: "Google Play") */
  label: string;
  /** 이 도메인을 쓰기 위해 필요한 자격증명 + 연결 명령 힌트 */
  credential: string;
  /** 도메인이 하는 일 한 줄 요약 */
  summary: string;
  tools: string[];
  /**
   * 원격/로컬 상태를 바꾸지만 파괴적이지 않은 도구 (카탈로그의 **W**).
   * 여기에도 destructive 에도 없는 도구는 읽기 전용(readOnlyHint: true)이다.
   */
  write?: string[];
  /**
   * 비가역·외부 공개·삭제·덮어쓰기 도구 (카탈로그의 **D**). write 와 겹치지 않는다 —
   * destructive 는 write 를 함의한다. 레지스트라가 confirm 가드를 강제한다.
   */
  destructive?: string[];
  /** 외부 서비스를 호출하지 않는 도구 (openWorldHint: false). 나머지는 모두 open-world. */
  local?: string[];
  /**
   * destructive 중 자기 confirm 류 파라미터(confirm / confirmPublish / confirmVisible)가 **모든 파괴적 경로**를
   * 막는 도구. 레지스트라는 이 도구들에만 confirm 가드 주입을 생략한다.
   */
  ownGate?: string[];
  /** 같은 인자로 반복 호출해도 추가 효과가 없는 **쓰기** 도구. 읽기 도구는 자동으로 idempotent. */
  idempotent?: string[];
};

/** tool-manifest.json 의 형태 — 도구 인벤토리 + 도메인 메타데이터의 SSOT. */
export type ToolManifest = {
  total: number;
  domains: Record<string, DomainEntry>;
  /** MIMI_SEED_TOOLSETS 편의 그룹 → 도메인 키 목록. `all` 은 내장 키워드라 여기 없다. */
  toolsets?: Record<string, string[]>;
  /**
   * 등록 파일(도메인)과 별개로 다른 toolset 키에도 속하는 도구 — 예: video.ts 가 등록하는 YouTube 업로드는
   * `youtube` 로도 켜진다. 값은 도메인 키 목록.
   */
  alsoInToolsets?: Record<string, string[]>;
  /** toolset 필터와 무관하게 항상 켜지는 도메인. */
  alwaysOn?: string[];
  /**
   * 폐기 예정 별칭 → 정식 도구. 별칭은 자기 도메인 `tools` 에 계속 남아(개수 정합)
   * 정식 도구의 스키마·핸들러로 등록되고, 설명에 [DEPRECATED …] 접두가 붙는다.
   */
  deprecated?: Record<string, string>;
};

/** tool-manifest.json 을 읽고 최소 형태를 검증한다. 손상/형태이상이면 throw. */
export function readToolManifest(): ToolManifest {
  const manifest = JSON.parse(readPackageRootText('tool-manifest.json')) as ToolManifest;
  if (
    typeof manifest?.total !== 'number' ||
    typeof manifest?.domains !== 'object' ||
    manifest.domains === null
  ) {
    throw new Error('tool-manifest.json 의 형태가 예상과 다릅니다');
  }
  return manifest;
}
