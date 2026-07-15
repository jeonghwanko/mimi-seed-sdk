import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// 온보딩 문서(docs/credentials · troubleshooting · from-source)를 코드에 묶는다.
// docs-drift.test.ts 가 tool-manifest ↔ tool-catalog 를 지키는 것과 같은 역할.
//
// 특히 #1: 새 auth 에러 코드를 추가하면서 복구 문서를 안 쓰면 여기서 깨진다.

const repoRoot = fileURLToPath(new URL('../../../../', import.meta.url));
const read = (rel: string) => readFileSync(path.join(repoRoot, rel), 'utf8');

const DOC_PAIRS = [
  ['docs/credentials.md', 'docs/credentials.ko.md'],
  ['docs/troubleshooting.md', 'docs/troubleshooting.ko.md'],
  ['docs/from-source.md', 'docs/from-source.ko.md'],
] as const;

const USER_GUIDE_PAIRS = [
  ['docs/user-guide/README.md', 'docs/user-guide/README.ko.md'],
  ['docs/user-guide/getting-started.md', 'docs/user-guide/getting-started.ko.md'],
  ['docs/user-guide/accounts.md', 'docs/user-guide/accounts.ko.md'],
  ['docs/user-guide/build-ci.md', 'docs/user-guide/build-ci.ko.md'],
  ['docs/user-guide/release-readiness.md', 'docs/user-guide/release-readiness.ko.md'],
  ['docs/user-guide/deploy.md', 'docs/user-guide/deploy.ko.md'],
  ['docs/user-guide/stores.md', 'docs/user-guide/stores.ko.md'],
  ['docs/user-guide/cloud-operations.md', 'docs/user-guide/cloud-operations.ko.md'],
  ['docs/user-guide/social.md', 'docs/user-guide/social.ko.md'],
  ['docs/user-guide/team-security.md', 'docs/user-guide/team-security.ko.md'],
] as const;

/** 마법사가 docs/credentials.md#<anchor> 로 딥링크한다 — 앵커는 API 다. */
const CREDENTIAL_ANCHORS = [
  'google-oauth',
  'app-store-connect',
  'play-service-account',
  'bigquery',
  'jenkins',
  'ci-github-gitlab',
  'google-ads',
  'facebook',
  'instagram',
  'threads',
  'cloud-pat',
  'anthropic-api-key',
  'android-keystore',
];

describe('온보딩 문서 ↔ 코드', () => {
  it('EN / KO 문서가 모두 존재한다', () => {
    for (const pair of [...DOC_PAIRS, ...USER_GUIDE_PAIRS]) {
      for (const f of pair) {
        expect(existsSync(path.join(repoRoot, f)), `${f} 없음`).toBe(true);
      }
    }
  });

  it('사용자 가이드 홈이 모든 작업 문서로 연결되고 빌드 책임 경계를 설명한다', () => {
    for (const [en, ko] of [USER_GUIDE_PAIRS[0]]) {
      const enDoc = read(en);
      const koDoc = read(ko);
      for (const [enPage, koPage] of USER_GUIDE_PAIRS.slice(1)) {
        expect(enDoc, `${en} 에 ${enPage} 링크 없음`).toContain(path.basename(enPage));
        expect(koDoc, `${ko} 에 ${koPage} 링크 없음`).toContain(path.basename(koPage));
      }
      expect(enDoc).toContain('does not compile `.aab` or `.ipa`');
      expect(koDoc).toContain('`.aab`나 `.ipa`를 직접 컴파일하지 않는다');
    }
  });

  it('Codex 원격 설정 문서가 PAT 평문 대신 환경변수 계약을 안내한다', () => {
    for (const f of USER_GUIDE_PAIRS[9]) {
      const doc = read(f);
      expect(doc).toContain('mcp_servers.mimi-seed-remote');
      expect(doc).toContain('bearer_token_env_var = "MIMI_SEED_TOKEN"');
    }
  });

  // ① 가장 ROI 높은 가드 — errors.ts 의 AuthErrorCode 유니온이 SSOT.
  it('모든 AuthErrorCode 가 troubleshooting 문서(EN·KO 양쪽)에 나온다', () => {
    const src = read('packages/mcp-server/src/auth/errors.ts');
    const union = src.match(/export type AuthErrorCode =([\s\S]*?);/)?.[1];
    expect(union, 'AuthErrorCode 유니온을 파싱하지 못했습니다').toBeTruthy();

    const codes = [...union!.matchAll(/'([A-Z_]+)'/g)].map((m) => m[1]);
    expect(codes.length).toBeGreaterThan(10);

    for (const [en, ko] of [DOC_PAIRS[1]]) {
      const enDoc = read(en);
      const koDoc = read(ko);
      const missingEn = codes.filter((c) => !enDoc.includes(c));
      const missingKo = codes.filter((c) => !koDoc.includes(c));
      expect(
        missingEn,
        `${en} 에 복구 안내가 없는 에러 코드: ${missingEn.join(', ')}`,
      ).toEqual([]);
      expect(
        missingKo,
        `${ko} 에 복구 안내가 없는 에러 코드: ${missingKo.join(', ')}`,
      ).toEqual([]);
    }
  });

  // ② 마법사의 링크 계약 + "EN 만 고치고 KO 잊음" 방지.
  it('credentials 문서의 앵커가 EN·KO 양쪽에 존재한다', () => {
    for (const f of DOC_PAIRS[0]) {
      const doc = read(f);
      const missing = CREDENTIAL_ANCHORS.filter((a) => !doc.includes(`<a id="${a}"></a>`));
      expect(missing, `${f} 에 없는 앵커: ${missing.join(', ')}`).toEqual([]);
    }
  });

  // ③ 이미 4갈래로 드리프트한 적 있는 사실 — 테스트만이 통일을 유지시킨다.
  it('Node 하한이 .nvmrc / 두 package.json / 문서에서 일치한다', () => {
    const nvmrc = read('.nvmrc').trim();
    expect(nvmrc).toMatch(/^\d+$/);

    // 루트도 포함한다 — scripts/install.mjs 가 .nvmrc 로 Node 를 검사하고 루트 engines 로도
    // 걸러지므로, 여기서 어긋나면 clone 직후 설치가 엉뚱한 이유로 막힌다.
    for (const pkg of [
      'package.json',
      'packages/cli/package.json',
      'packages/mcp-server/package.json',
    ]) {
      const engines = (JSON.parse(read(pkg)) as { engines?: { node?: string } }).engines?.node;
      expect(engines, `${pkg} 에 engines.node 없음`).toBeTruthy();
      const floor = engines!.match(/(\d+)/)?.[1];
      expect(floor, `${pkg} 의 engines.node(${engines}) 가 .nvmrc(${nvmrc}) 와 다름`).toBe(nvmrc);
    }

    // 산문에 적힌 "Node 20+" 표기도 같은 값이어야 한다.
    for (const f of ['README.md', 'README.ko.md', 'CONTRIBUTING.md', 'docs/from-source.md', 'docs/from-source.ko.md']) {
      for (const m of read(f).matchAll(/Node[.\s]*(?:\.js)?\s*(\d+)\+/g)) {
        expect(m[1], `${f} 의 "Node ${m[1]}+" 가 .nvmrc(${nvmrc}) 와 다름`).toBe(nvmrc);
      }
    }
  });

  // ④ 사용자 문서는 서로 촘촘히 링크한다 — 깨진 링크가 1순위 부패 지점.
  it('문서의 상대 링크가 실제 파일로 해석된다', () => {
    const files = [
      ...DOC_PAIRS.flat(),
      ...USER_GUIDE_PAIRS.flat(),
      '.codex-plugin/README.md',
      'README.md',
      'README.ko.md',
    ];
    const broken: string[] = [];

    for (const f of files) {
      const dir = path.dirname(path.join(repoRoot, f));
      for (const m of read(f).matchAll(/\]\(([^)#\s]+\.md)(?:#[^)]*)?\)/g)) {
        const target = m[1];
        if (/^https?:/.test(target)) continue;
        if (!existsSync(path.resolve(dir, target))) broken.push(`${f} → ${target}`);
      }
    }
    expect(broken, `깨진 상대 링크: ${broken.join(' · ')}`).toEqual([]);
  });
});
