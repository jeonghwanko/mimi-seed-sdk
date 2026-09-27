import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { encodePathSegment } from '../lib/url-path.js';

/**
 * REST 경로 인코딩 가드 (2026-09 보안 점검).
 *
 * App Store Connect 클라이언트는 호출자가 준 ID 를 `/appScreenshots/${screenshotId}` 처럼
 * 그대로 경로에 넣었다. `../` 가 섞인 ID 는 URL 정규화를 거쳐 **다른 리소스에 DELETE** 를
 * 보낼 수 있었다. 53곳을 한 번에 고쳤지만, 다음 도구 추가 때 raw `${id}` 가 돌아오는 게
 * 이 결함의 기본 경로다 — 그래서 모양으로 막는다.
 *
 * 규칙: 아래 provider 디렉터리에서 `/${...}` 형태의 경로 삽입은 `encodePathSegment(…)`
 * (또는 이미 인코딩된 `encodeURIComponent(…)`) 여야 한다. 대문자 상수(`API_VERSION` 등)와
 * 아래 허용 목록만 예외다.
 */

const srcRoot = fileURLToPath(new URL('../', import.meta.url));

/** 호출자 입력으로 raw REST 경로를 만드는 provider 클라이언트들. */
const PROVIDER_DIRS = [
  'appstore',
  'ci',
  'facebook',
  'googleads',
  'instagram',
  'jenkins',
  'social',
  'threads',
  'tiktok-business',
  'video',
  'youtube',
];

/** 경로 삽입이지만 인코딩하면 안 되거나 이미 인코딩된 값. 사유를 남길 것. */
const ALLOWED: Array<{ file: string; expr: string; why: string }> = [
  { file: 'ci/gitlab.ts', expr: 'cfg.repo', why: '`encodeURIComponent(`${owner}/${repo}`)` 안쪽 — 통째로 인코딩된다' },
  { file: 'ci/gitlab.ts', expr: 'projectId(cfg)', why: 'projectId() 가 이미 인코딩한 값을 돌려준다' },
  { file: 'jenkins/http.ts', expr: 'suffix', why: '호출부가 만든 고정 경로 접미사 (잡 경로는 세그먼트별로 인코딩)' },
  { file: 'jenkins/http.ts', expr: "segments.map((s) => `job/${encodeURIComponent(s)", why: '세그먼트별 인코딩' },
  { file: 'instagram/api.ts', expr: 'parsed.error.error_subcode', why: '에러 메시지 문자열이지 URL 이 아니다' },
  { file: 'threads/api.ts', expr: 'parsed.error.error_subcode', why: '에러 메시지 문자열이지 URL 이 아니다' },
];

const INTERPOLATION = /\/\$\{(?!encodePathSegment\(|encodeURIComponent\()([^}]*)\}/g;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return full.endsWith('.ts') ? [full] : [];
  });
}

describe('provider 클라이언트 — 경로 세그먼트 인코딩', () => {
  const files = PROVIDER_DIRS.flatMap((d) => sourceFiles(path.join(srcRoot, d)));

  it('스캔 대상을 실제로 찾았다', () => {
    expect(files.length).toBeGreaterThan(30);
  });

  it('호출자 입력이 인코딩 없이 경로 세그먼트로 들어가지 않는다', () => {
    const offenders: string[] = [];
    for (const file of files) {
      const rel = path.relative(srcRoot, file).replaceAll(path.sep, '/');
      readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
        for (const match of line.matchAll(INTERPOLATION)) {
          const expr = match[1];
          if (/^[A-Z][A-Z0-9_]*$/.test(expr)) continue; // 모듈 상수
          if (ALLOWED.some((a) => a.file === rel && a.expr === expr)) continue;
          offenders.push(`${rel}:${i + 1} \${${expr}}`);
        }
      });
    }
    expect(offenders, `encodePathSegment(…) 로 감싸세요 (lib/url-path.ts):\n${offenders.join('\n')}`).toEqual([]);
  });

  it('허용 목록이 낡지 않았다 (지운 코드의 예외가 남아 있지 않다)', () => {
    for (const a of ALLOWED) {
      const text = readFileSync(path.join(srcRoot, a.file), 'utf8');
      expect(text, `${a.file} 에 \${${a.expr}} 가 더는 없다 — 허용 목록에서 지우세요`).toContain(`/\${${a.expr}`);
    }
  });
});

/**
 * googleapis 리소스 문자열 가드 (2026-09 적대적 재검토).
 *
 * googleapis 는 name/parent/resource/projectId 를 예약 확장 `{+name}` 으로 경로에 넣어 `/` 를
 * 인코딩하지 않는다. `projects/${projectId}/androidApps/${appId}` 에 appId=`../../B/androidApps/Z`
 * 를 주면 **다른 프로젝트의 앱**에 `:remove` 가 나갔다. 인코딩은 답이 아니므로(Google 이 디코딩하지
 * 않는다) 검증한다: 세그먼트는 `resourceSegment(…)`, `prefix/id` 정규화는 `resourceName(…)`.
 */
const GOOGLE_DIRS = ['admob', 'bigquery', 'billing', 'firebase', 'ga4', 'gsc', 'iam', 'playstore', 'youtube'];
const GOOGLE_ALLOWED: Array<{ file: string; expr: string; why: string }> = [
  { file: 'firebase/remote-config.ts', expr: 'encodedProject', why: 'encodePathSegment() 결과 (raw REST, googleapis 아님)' },
  { file: 'firebase/remote-config.ts', expr: 'encodedNamespace', why: 'encodePathSegment() 결과 (raw REST, googleapis 아님)' },
  { file: 'playstore/statistics.ts', expr: 'resource', why: 'metricSet enum 에서 고른 고정 리소스명' },
  { file: 'playstore/messages.ts', expr: 'packageName', why: '사람용 안내문의 로컬 저장 경로 표시 (API 리소스 이름 아님, 스키마에서 이미 검증된 패키지명)' },
];
const GOOGLE_INTERPOLATION = /\/\$\{(?!resourceSegment\(|encodePathSegment\(|encodeURIComponent\()([^}]*)\}/g;

describe('googleapis 리소스 이름 — 세그먼트 검증', () => {
  const files = GOOGLE_DIRS.flatMap((d) => sourceFiles(path.join(srcRoot, d)));

  it('스캔 대상을 실제로 찾았다', () => {
    expect(files.length).toBeGreaterThan(15);
  });

  it('호출자 값이 검증 없이 리소스 문자열 세그먼트로 들어가지 않는다', () => {
    const offenders: string[] = [];
    for (const file of files) {
      const rel = path.relative(srcRoot, file).replaceAll(path.sep, '/');
      readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
        for (const match of line.matchAll(GOOGLE_INTERPOLATION)) {
          const expr = match[1];
          if (/^[A-Z][A-Z0-9_]*$/.test(expr)) continue;
          if (GOOGLE_ALLOWED.some((a) => a.file === rel && a.expr === expr)) continue;
          offenders.push(`${rel}:${i + 1} \${${expr}}`);
        }
      });
    }
    expect(offenders, `resourceSegment(…) / resourceName(…) 로 검증하세요 (lib/resource-id.ts):\n${offenders.join('\n')}`).toEqual([]);
  });

  it('`prefix/` 로 시작하면 통과시키는 옛 정규화 패턴이 남아 있지 않다', () => {
    // `id.startsWith('accounts/') ? id : \`accounts/${id}\`` 는 'accounts/../../x' 를 그대로 통과시켰다.
    const offenders = files
      .filter((file) => /startsWith\('[a-zA-Z]+\/'\)\s*\?/.test(readFileSync(file, 'utf8')))
      .map((file) => path.relative(srcRoot, file));
    expect(offenders, 'resourceName(value, collection) 을 쓰세요').toEqual([]);
  });
});

describe('encodePathSegment', () => {
  it('슬래시와 특수문자를 인코딩해 세그먼트를 못 벗어나게 한다', () => {
    expect(encodePathSegment('../appScreenshotSets/123')).toBe('..%2FappScreenshotSets%2F123');
    expect(encodePathSegment('a?b#c')).toBe('a%3Fb%23c');
    expect(encodePathSegment(42)).toBe('42');
  });

  it.each(['', '.', '..'])('점 세그먼트 %j 는 거부한다 (인코딩해도 정규화로 상위 경로가 된다)', (value) => {
    expect(() => encodePathSegment(value)).toThrow(/경로 세그먼트/);
  });

  it('인코딩된 경로는 URL 정규화 후에도 원래 리소스를 가리킨다', () => {
    const url = new URL(`https://api.example.test/v1/appScreenshots/${encodePathSegment('../apps/1')}`);
    expect(url.pathname).toBe('/v1/appScreenshots/..%2Fapps%2F1');
  });
});
