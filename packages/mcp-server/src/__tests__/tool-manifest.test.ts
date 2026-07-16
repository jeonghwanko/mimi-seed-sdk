import { describe, it, expect } from 'vitest';
import { readToolManifest } from '../lib/package-root.js';
import { withClient } from './helpers.js';

// tool-manifest.json = 등록 도구 인벤토리 + 도메인 메타데이터의 SSOT.
// 이 테스트는 실제 McpServer 를 기동해(boot smoke test) 등록된 도구 목록을
// manifest 와 diff 한다 — 도구 추가/삭제/개명이 manifest 갱신 없이 머지되는 것을 막고,
// register 모듈이 server.ts 에서 빠지는 사고(과거 문서 카운트 드리프트의 근본 원인)도 잡는다.
const manifest = readToolManifest();

const manifestNames = Object.values(manifest.domains).flatMap((d) => d.tools);

describe('tool-manifest (boot smoke test)', () => {
  it('manifest 자체 정합성 — total 일치, 도메인 간 중복 없음, 메타데이터 완비', () => {
    expect(manifest.total).toBe(manifestNames.length);
    const dupes = manifestNames.filter((n, i) => manifestNames.indexOf(n) !== i);
    expect(dupes, `manifest 내 중복 도구: ${dupes.join(', ')}`).toEqual([]);

    // 도메인 메타데이터는 mimi-seed://tools/catalog 리소스가 그대로 서빙한다 —
    // 도메인을 추가하면 label/credential/summary 도 함께 채울 것.
    const incomplete = Object.entries(manifest.domains)
      .filter(([, d]) => !d.label?.trim() || !d.credential?.trim() || !d.summary?.trim())
      .map(([id]) => id);
    expect(
      incomplete,
      `label/credential/summary 가 비어 있는 도메인 — tool-manifest.json 을 채우세요: ${incomplete.join(', ')}`,
    ).toEqual([]);
  });

  it('실제 서버 등록 목록 == manifest (추가/삭제/개명 시 tool-manifest.json 갱신 필수)', async () => {
    await withClient(async (client) => {
      const { tools } = await client.listTools();
      const live = tools.map((t) => t.name);

      const liveSet = new Set(live);
      expect(liveSet.size, '서버에 중복 이름으로 등록된 도구가 있음').toBe(live.length);

      const missing = manifestNames.filter((n) => !liveSet.has(n));
      const untracked = live.filter((n) => !manifestNames.includes(n));
      expect(
        missing,
        `manifest 에는 있는데 서버에 등록 안 된 도구 (register 모듈이 server.ts 에서 빠졌거나 개명됨): ${missing.join(', ')}`,
      ).toEqual([]);
      expect(
        untracked,
        `서버에 등록됐는데 manifest 에 없는 도구 — tool-manifest.json 에 추가하세요: ${untracked.join(', ')}`,
      ).toEqual([]);
    });
  });

  it('모든 도구에 비어 있지 않은 설명이 있다', async () => {
    await withClient(async (client) => {
      const { tools } = await client.listTools();
      const noDesc = tools.filter((t) => !t.description?.trim()).map((t) => t.name);
      expect(noDesc, `설명 없는 도구: ${noDesc.join(', ')}`).toEqual([]);
    });
  });
});
