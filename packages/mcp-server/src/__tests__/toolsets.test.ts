import { describe, expect, it } from 'vitest';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { readToolManifest } from '../lib/package-root.js';
import { describeToolsets, resolveToolsets } from '../lib/toolsets.js';
import { buildServer } from '../server.js';

/**
 * MIMI_SEED_TOOLSETS 필터 — 기본값(미설정)이 "전부"인 것이 가장 중요한 계약이다.
 * 여기가 깨지면 설정을 안 건드린 기존 사용자의 도구가 사라진다.
 */
const manifest = readToolManifest();
const allDomains = Object.keys(manifest.domains);

describe('resolveToolsets', () => {
  it('미설정이면 전체 도메인 (기존 동작과 동일)', () => {
    const sel = resolveToolsets({}, manifest);
    expect(sel.all).toBe(true);
    expect([...sel.enabled].sort()).toEqual([...allDomains].sort());
    expect(sel.warnings).toEqual([]);
  });

  it('도메인 키 + 그룹 키를 펼치고, alwaysOn(auth·checks)은 항상 켠다', () => {
    const sel = resolveToolsets({ MIMI_SEED_TOOLSETS: 'store, ci' }, manifest);
    const expected = new Set([...manifest.toolsets!.store, 'ci', ...manifest.alwaysOn!]);
    expect(new Set(sel.enabled)).toEqual(expected);
    expect(sel.all).toBe(false);
  });

  it('EXCLUDE 는 include 결과에서 빼지만 alwaysOn 은 못 뺀다', () => {
    const sel = resolveToolsets({ MIMI_SEED_TOOLSETS_EXCLUDE: 'social,media,auth' }, manifest);
    for (const d of [...manifest.toolsets!.social, ...manifest.toolsets!.media]) expect(sel.enabled.has(d)).toBe(false);
    expect(sel.enabled.has('auth')).toBe(true);
    expect(sel.enabled.has('playstore')).toBe(true);
  });

  it('모르는 키는 경고 후 무시한다', () => {
    const sel = resolveToolsets({ MIMI_SEED_TOOLSETS: 'playstore,nope' }, manifest);
    expect(sel.enabled.has('playstore')).toBe(true);
    expect(sel.warnings.join('\n')).toMatch(/"nope"/);
  });

  it('include 가 전부 오타면 거의 빈 서버 대신 전체를 켠다', () => {
    const sel = resolveToolsets({ MIMI_SEED_TOOLSETS: 'plystore' }, manifest);
    expect(sel.all).toBe(true);
    expect(sel.warnings.length).toBe(2);
  });

  it('all 키워드', () => {
    expect(resolveToolsets({ MIMI_SEED_TOOLSETS: 'all' }, manifest).all).toBe(true);
  });

  it('describeToolsets — mimi_seed_status 한 줄', () => {
    expect(describeToolsets(resolveToolsets({}, manifest), manifest)).toMatch(/^all \(/);
    const line = describeToolsets(resolveToolsets({ MIMI_SEED_TOOLSETS: 'gsc' }, manifest), manifest);
    expect(line).toContain('gsc');
    expect(line).toContain('MIMI_SEED_TOOLSETS');
  });
});

describe('buildServer 가 toolset 을 존중한다', () => {
  async function listNames(env: NodeJS.ProcessEnv) {
    const server = buildServer('0.0.0-test', { env });
    const [ct, st] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'toolsets-test', version: '0' });
    await Promise.all([server.connect(st), client.connect(ct)]);
    try {
      return (await client.listTools()).tools.map((t) => t.name);
    } finally {
      await client.close();
      await server.close();
    }
  }

  it('선택한 도메인 + alwaysOn 의 도구만 노출한다', async () => {
    const names = await listNames({ MIMI_SEED_TOOLSETS: 'gsc' });
    const expected = ['gsc', ...manifest.alwaysOn!].flatMap((d) => manifest.domains[d].tools);
    expect(names.sort()).toEqual(expected.sort());
  });

  it('기본값은 manifest 전체', async () => {
    expect((await listNames({})).length).toBe(manifest.total);
  });
});
