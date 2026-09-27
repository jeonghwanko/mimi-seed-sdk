// scripts/gen-docs.mjs 의 계약 — 실제 문서가 아니라 합성 manifest 로 규칙만 검사한다.
// (실제 문서가 최신인지는 `gen-docs --check` = plugin:check 와 docs-drift.test.ts 가 본다.)
//
//   node --test scripts/gen-docs.test.mjs

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyBlocks, buildModel, expandBatches } from './gen-docs.mjs';

const manifest = {
  total: 5,
  deprecated: { alpha_old: 'alpha_new' },
  domains: {
    alpha: { label: '알파', tools: ['alpha_list', 'alpha_new', 'alpha_old', 'alpha_extra'], write: ['alpha_new', 'alpha_old'] },
    beta: { label: '베타', tools: ['beta_get'] },
  },
};
const domains = { alpha: { en: 'Alpha', highlights: ['alpha_list'] }, beta: { en: 'Beta', highlights: ['beta_get'] } };

test('새 도구는 자기 도메인의 fallbackFor 배치에 자동으로 붙고, 폐기 별칭은 어디에도 안 붙는다', () => {
  const errors = [];
  const model = buildModel(manifest, errors, domains);
  const batches = expandBatches(model, errors, [
    { goal: 'Alpha work', tools: ['alpha_new', 'alpha_list'], fallbackFor: ['alpha'] },
    { goal: 'Beta', domains: ['beta'] },
  ]);
  assert.deepEqual(errors, []);
  assert.deepEqual(batches[0].names, ['alpha_new', 'alpha_list', 'alpha_extra']);
  assert.deepEqual(batches[1].names, ['beta_get']);
});

test('주인 배치(domains/fallbackFor)가 없는 도메인·폐기 별칭·없는 이름은 오류', () => {
  const errors = [];
  const model = buildModel(manifest, errors, domains);
  expandBatches(model, errors, [{ goal: 'Alpha', tools: ['alpha_old', 'alpha_gone'], fallbackFor: ['alpha'] }]);
  assert.ok(errors.some((e) => e.includes('"beta"') && e.includes('fallbackFor')), errors.join('\n'));
  assert.ok(errors.some((e) => e.includes('alpha_old') && e.includes('alpha_new')), errors.join('\n'));
  assert.ok(errors.some((e) => e.includes('alpha_gone')), errors.join('\n'));
});

test('스펙과 manifest 의 도메인 집합이 다르면 오류', () => {
  const errors = [];
  buildModel(manifest, errors, { alpha: domains.alpha, gamma: { en: 'Gamma', highlights: [] } });
  assert.ok(errors.some((e) => e.includes('"beta"')));
  assert.ok(errors.some((e) => e.includes('"gamma"')));
});

test('manifest.total 이 실제 도구 수와 다르면 오류', () => {
  const errors = [];
  buildModel({ ...manifest, total: 99 }, errors, domains);
  assert.ok(errors.some((e) => e.includes('total 99')));
});

test('applyBlocks: 마커 사이만 바꾸고 산문은 그대로, 낡은 블록을 보고한다', () => {
  const errors = [];
  const text = ['intro', '<!-- generated:a:start · hint -->', 'old', '<!-- generated:a:end -->', 'outro'].join('\n');
  const { text: out, stale } = applyBlocks('x.md', text, new Map([['a', 'new\nlines']]), errors);
  assert.deepEqual(errors, []);
  assert.deepEqual(stale, ['a']);
  assert.equal(out, ['intro', '<!-- generated:a:start · hint -->', 'new', 'lines', '<!-- generated:a:end -->', 'outro'].join('\n'));

  const again = applyBlocks('x.md', out, new Map([['a', 'new\nlines']]), errors);
  assert.deepEqual(again.stale, []);
  assert.equal(again.text, out);
});

test('applyBlocks: 빠진 마커·짝 없는 마커·모르는 블록은 오류', () => {
  const errors = [];
  applyBlocks('x.md', '<!-- generated:zzz:start -->\nbody\n<!-- generated:zzz:end -->', new Map([['a', 'x']]), errors);
  assert.ok(errors.some((e) => e.includes('"zzz"')));
  assert.ok(errors.some((e) => e.includes('"a"') && e.includes('마커가 없습니다')));

  const errors2 = [];
  applyBlocks('x.md', '<!-- generated:a:start -->\nbody', new Map([['a', 'x']]), errors2);
  assert.ok(errors2.some((e) => e.includes('end 마커가 없습니다')));
});
