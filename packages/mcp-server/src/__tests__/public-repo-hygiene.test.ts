import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * 공개 저장소 위생 가드.
 *
 * CLAUDE.md / AGENTS.md 는 "예시는 플레이스홀더를 쓴다"를 규칙으로 못박아 뒀지만, 실제로는
 * 사설 프로젝트·Jenkins 잡·GA4 속성 번호가 45곳까지 쌓여 있었고 그 상당수가 **모든 MCP
 * 클라이언트에 표시되는 zod describe 문자열**이었다. 다른 규칙에는 전부 가드가 있는데
 * 이것만 없어서, 도구를 추가할 때마다 재발했다.
 *
 * 새 식별자가 새면 여기에 패턴을 추가할 것 — 목록이 아니라 **모양**을 막는 게 목적이다.
 */

const repoRoot = fileURLToPath(new URL('../../../../', import.meta.url));

const SCAN_ROOTS = ['packages/cli/src', 'packages/mcp-server/src', 'docs', 'skills'];
const SKIP_DIRS = new Set(['node_modules', 'dist', '.git']);
const SCAN_EXTENSIONS = ['.ts', '.md', '.json'];

/** 이 저장소가 쓰기로 한 플레이스홀더 어휘. 새 예시는 이 모양을 따를 것. */
const ALLOWED_PLACEHOLDER_HINTS = [
  'com.example.app',
  'my-app',
  'my-app-prod',
  'my-app-analytics',
  'team-folder',
  'analytics_123456789',
  '<packageName>',
];

interface Banned {
  label: string;
  pattern: RegExp;
  /** 이 정규식에 걸리는 줄은 플레이스홀더로 보고 통과시킨다. */
  allow?: RegExp;
  hint: string;
}

const BANNED: Banned[] = [
  {
    label: '사설 프로젝트·잡·앱 이름',
    // 과거에 실제로 새어나간 이름들. 되돌아오면 즉시 잡는다.
    pattern: /\b(penguinrun|vir-?game|ads-coffee|speakmoney|supervlabs)\b/i,
    hint: `플레이스홀더를 쓰세요: ${ALLOWED_PLACEHOLDER_HINTS.join(', ')}`,
  },
  {
    label: 'pryzm 사설 식별자',
    // mimi-seed.pryzm.gg(공개 제품 URL)와 gg.pryzm.* 을 구분한다.
    pattern: /\bgg\.pryzm\.[a-z0-9]|pryzm[-_][a-z0-9]/i,
    hint: '사설 조직/프로젝트 접두사 대신 com.example.app / my-app-* 을 쓰세요.',
  },
  {
    label: '실제로 보이는 GA4 속성 번호',
    // analytics_123456789(예시용 오름차순)만 허용하고, 그 외 9자리+ 숫자는 실데이터로 본다.
    pattern: /\banalytics_(?!123456789\b)\d{9,}\b/,
    hint: 'analytics_123456789 을 쓰세요.',
  },
  {
    label: '서비스 계정 이메일',
    pattern: /\b[a-z0-9-]+@[a-z0-9-]+\.iam\.gserviceaccount\.com\b/i,
    // 명백한 플레이스홀더만 통과 — 그 외 도메인은 실제 GCP 프로젝트로 본다.
    allow: /(example|my-project|my-sa|<project>|<service-account>|test-project)/i,
    hint: '<service-account>@<project>.iam.gserviceaccount.com 을 쓰세요.',
  },
];

function scanFiles(dir: string): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return [];
  }
  return entries.flatMap((entry) => {
    if (SKIP_DIRS.has(entry)) return [];
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) return scanFiles(full);
    return SCAN_EXTENSIONS.some((ext) => full.endsWith(ext)) ? [full] : [];
  });
}

// 이 파일 자체는 금지 패턴을 리터럴로 들고 있으므로 스캔에서 뺀다.
const SELF = fileURLToPath(import.meta.url);
const FILES = SCAN_ROOTS.flatMap((rel) => scanFiles(path.join(repoRoot, rel))).filter((f) => f !== SELF);

describe('공개 저장소 — 사설 식별자 금지', () => {
  it('스캔 대상 파일을 실제로 찾았다 (경로 오타 방지)', () => {
    expect(FILES.length).toBeGreaterThan(100);
  });

  it.each(BANNED)('$label 이 소스·문서·스킬 어디에도 없다', ({ pattern, allow, hint }) => {
    const hits: string[] = [];
    for (const file of FILES) {
      readFileSync(file, 'utf8')
        .split('\n')
        .forEach((line, i) => {
          if (pattern.test(line) && !allow?.test(line)) {
            hits.push(`${path.relative(repoRoot, file)}:${i + 1}`);
          }
        });
    }

    expect(hits, `${hint}\n  위치: ${hits.join(', ')}`).toEqual([]);
  });
});
