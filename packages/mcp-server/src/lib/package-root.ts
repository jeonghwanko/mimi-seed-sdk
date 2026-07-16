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
};

/** tool-manifest.json 의 형태 — 도구 인벤토리 + 도메인 메타데이터의 SSOT. */
export type ToolManifest = { total: number; domains: Record<string, DomainEntry> };

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
