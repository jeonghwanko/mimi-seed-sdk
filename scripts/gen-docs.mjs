#!/usr/bin/env node
// tool-manifest.json 에서 파생되는 문서 조각을 생성한다 — 손으로 맞추던 사실을 더는 손으로 맞추지 않는다.
//
//   입력: packages/mcp-server/tool-manifest.json (사실: 도구·도메인·개수·W/D·폐기 별칭)
//         scripts/docs-spec.mjs                  (표현: 영어 라벨·대표 도구·메모·`select:` 배치)
//   출력: 아래 파일들의 `<!-- generated:<id>:start … -->` ~ `<!-- generated:<id>:end -->` 사이만 다시 쓴다.
//         마커 밖의 사람이 쓴 산문은 건드리지 않는다.
//           docs/domain/tool-catalog.md    총계 · Counts by domain 표 · 도메인별 도구 목록(W/D·메모·별칭)
//           README.md · README.ko.md · packages/mcp-server/README.md   도구 목록 제목의 도메인 수 + 개수 표
//           docs/agent-guide.md            §0 `select:` 배치 표
//
//   node scripts/gen-docs.mjs          # 생성 블록 갱신 (npm run plugin:sync 가 가장 먼저 부른다)
//   node scripts/gen-docs.mjs --check  # CI: 낡은 블록·빠진 마커·스펙 오류가 있으면 exit 1 (plugin:check)
//
// 결정적 출력: 순서는 manifest/스펙 순서만 따르고, 내부적으로 LF 로 만든다. 파일에 쓸 때는 그 파일의 기존
// 줄바꿈(Windows autocrlf 체크아웃이면 CRLF)을 유지하고, 비교는 줄바꿈을 정규화한 뒤 한다 — 그래서 OS 와
// 무관하게 같은 결과가 커밋된다(git 이 LF 로 저장).

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as spec from './docs-spec.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MANIFEST = 'packages/mcp-server/tool-manifest.json';
const CATALOG = 'docs/domain/tool-catalog.md';
const GUIDE = 'docs/agent-guide.md';
const WRAP = 116; // 카탈로그 불릿 줄바꿈 폭 (도구 항목 경계에서만 끊는다)

const MARKER = /^<!-- generated:([a-z0-9:-]+):(start|end)\b.*-->$/;

// ── 모델 ──────────────────────────────────────────────────────────────────────

export function buildModel(manifest, errors, domainSpec = spec.domains) {
  const domainIds = Object.keys(manifest.domains);
  const deprecated = manifest.deprecated ?? {};
  const domainOf = new Map();
  const kind = new Map();
  for (const [id, d] of Object.entries(manifest.domains)) {
    for (const t of d.tools) {
      domainOf.set(t, id);
      kind.set(t, (d.destructive ?? []).includes(t) ? 'D' : (d.write ?? []).includes(t) ? 'W' : 'R');
    }
  }
  const counted = [...domainOf.keys()].length;
  if (manifest.total !== counted) {
    errors.push(`${MANIFEST}: total ${manifest.total} ≠ 실제 도구 수 ${counted} — total 을 고치세요`);
  }

  // 스펙의 도메인 순서 = 표 순서. manifest 와 키 집합이 같아야 한다.
  const order = Object.keys(domainSpec);
  for (const id of domainIds) {
    if (!domainSpec[id]) errors.push(`scripts/docs-spec.mjs domains: 새 도메인 "${id}" — en 라벨과 highlights 를 추가하세요`);
  }
  for (const id of order) {
    if (!manifest.domains[id]) errors.push(`scripts/docs-spec.mjs domains: manifest 에 없는 도메인 "${id}" — 지우세요`);
  }
  return {
    manifest,
    order: order.filter((id) => manifest.domains[id]),
    deprecated,
    domainOf,
    kind,
    tools: (id) => manifest.domains[id].tools,
  };
}

/** 이름이 실재하고(폐기 별칭 아님), 필요하면 특정 도메인 소속인지 검사한다. */
function checkTool(model, errors, where, name, { domain, allowDeprecated = false } = {}) {
  if (!model.domainOf.has(name)) {
    errors.push(`${where}: 등록되지 않은 도구 "${name}" (오타·개명·삭제 잔재) — scripts/docs-spec.mjs 를 고치세요`);
    return false;
  }
  if (!allowDeprecated && model.deprecated[name]) {
    errors.push(`${where}: 폐기 별칭 "${name}" 대신 정식 이름 "${model.deprecated[name]}" 을 쓰세요`);
    return false;
  }
  if (domain && model.domainOf.get(name) !== domain) {
    errors.push(`${where}: "${name}" 은 ${model.domainOf.get(name)} 도메인 도구 — ${domain} 자리에 둘 수 없습니다`);
    return false;
  }
  return true;
}

// ── 렌더러: tool-catalog.md ────────────────────────────────────────────────────

const code = (s) => `\`${s}\``;
const RANK = { R: 0, W: 1, D: 2 };

function toolRef(model, name) {
  const extra = [];
  if (model.deprecated[name]) extra.push(`**deprecated alias** → ${code(model.deprecated[name])}`);
  if (spec.catalog.notes[name]) extra.push(spec.catalog.notes[name]);
  return extra.length ? `${code(name)} (${extra.join('; ')})` : code(name);
}

/** 불릿 하나: 항목 경계(` · `)에서만 WRAP 폭으로 줄바꿈하고 연속 줄은 두 칸 들여쓴다. */
function bullet(prefix, items, after) {
  const lines = [];
  let line = `- ${prefix} ${items[0]}`;
  for (const item of items.slice(1)) {
    if (`${line} · ${item}`.length > WRAP) {
      lines.push(`${line} ·`);
      line = `  ${item}`;
    } else {
      line = `${line} · ${item}`;
    }
  }
  if (after) {
    if (`${line} ${after}`.length > WRAP) {
      lines.push(line);
      line = `  ${after}`;
    } else {
      line = `${line} ${after}`;
    }
  }
  lines.push(line);
  return lines.join('\n');
}

function groupBullet(model, tools, label, after) {
  const sorted = [...tools].sort((a, b) => RANK[model.kind.get(a)] - RANK[model.kind.get(b)]);
  const first = model.kind.get(sorted[0]);
  const prefix = first === 'R' ? (label ? `Read (${label}):` : 'Read:') : `**${first}**${label ? ` ${label}:` : ''}`;
  let current = first;
  const items = sorted.map((t) => {
    const k = model.kind.get(t);
    const ref = toolRef(model, t);
    if (k === current) return ref;
    current = k;
    return `**${k}** ${ref}`;
  });
  return bullet(prefix, items, after);
}

function renderSection(model, errors, id, section) {
  const where = `docs-spec catalog.sections.${id}`;
  const layout = [...(section.layout ?? ['R', 'W', 'D'])];
  const grouped = new Set();
  for (const entry of layout) {
    if (typeof entry === 'string') continue;
    for (const t of entry.tools) {
      if (!checkTool(model, errors, where, t, { domain: id })) continue;
      if (grouped.has(t)) errors.push(`${where}: "${t}" 가 두 묶음에 있습니다`);
      grouped.add(t);
    }
  }
  for (const k of ['R', 'W', 'D']) if (!layout.includes(k)) layout.push(k); // 나머지는 언제나 어딘가에 나온다

  const rest = (k) => model.tools(id).filter((t) => !grouped.has(t) && model.kind.get(t) === k);
  const bullets = [];
  for (const entry of layout) {
    if (typeof entry === 'string') {
      const tools = rest(entry);
      if (tools.length) bullets.push(groupBullet(model, tools, undefined, undefined));
    } else {
      const tools = entry.tools.filter((t) => model.domainOf.get(t) === id);
      if (tools.length) bullets.push(groupBullet(model, tools, entry.label, entry.after));
    }
  }
  const n = model.tools(id).length;
  const impl = section.impl ? ` · impl ${code(section.impl)}` : '';
  return [`## ${spec.domains[id].en} — ${code(`registers/${id}.ts`)} (${n})${impl}`, '', ...bullets].join('\n');
}

function renderTable(model, errors, name, table) {
  const lines = [`| Domain (file) | ${table.header} |`, '|---|---|'];
  for (const [id, rowNote] of table.rows) {
    if (!model.manifest.domains[id]) {
      errors.push(`docs-spec catalog.tables.${name}: manifest 에 없는 도메인 "${id}"`);
      continue;
    }
    const items = [];
    for (const k of ['R', 'W', 'D']) {
      for (const t of model.tools(id).filter((x) => model.kind.get(x) === k)) {
        const ref = toolRef(model, t);
        if (ref.includes('|')) errors.push(`docs-spec catalog.notes.${t}: 표 안에 들어가는 메모에 "|" 를 쓸 수 없습니다`);
        items.push(k === 'R' ? ref : `**${k}** ${ref}`);
      }
    }
    const label = `${spec.domains[id].en} (${code(`${id}.ts`)})${rowNote ? ` ${rowNote}` : ''}`;
    lines.push(`| ${label} | ${items.join(' · ')} |`);
  }
  return lines.join('\n');
}

function catalogBlocks(model, errors) {
  const { sections, tables, notes } = spec.catalog;
  const blocks = new Map();
  const total = model.order.reduce((sum, id) => sum + model.tools(id).length, 0);

  blocks.set('catalog-total', `**${total} tools across ${model.order.length} domains** — per-domain counts below.`);
  blocks.set(
    'catalog-counts',
    [
      '| Domain | Register file | Tools |',
      '|--------|---------------|------:|',
      ...model.order.map((id) => `| ${spec.domains[id].en} | ${code(`registers/${id}.ts`)} | ${model.tools(id).length} |`),
      `| **Total** | **${model.order.length} modules** | **${total}** |`,
    ].join('\n'),
  );

  // 모든 도메인은 섹션이나 표 행 중 정확히 한 곳에.
  const placed = new Map();
  const place = (id, at) => {
    if (placed.has(id)) errors.push(`docs-spec catalog: "${id}" 가 ${placed.get(id)} 와 ${at} 두 곳에 있습니다`);
    placed.set(id, at);
  };
  for (const id of Object.keys(sections)) place(id, `sections.${id}`);
  for (const [name, t] of Object.entries(tables)) for (const [id] of t.rows) place(id, `tables.${name}`);
  for (const id of model.order) {
    if (!placed.has(id)) {
      errors.push(
        `docs-spec catalog: 도메인 "${id}" 가 카탈로그 어디에도 없습니다 — catalog.sections 에 추가하고 ` +
          `${CATALOG} 에 <!-- generated:catalog-domain:${id}:start/end --> 마커를 넣거나, catalog.tables 의 한 행으로 두세요`,
      );
    }
  }
  for (const t of Object.keys(notes)) checkTool(model, errors, `docs-spec catalog.notes`, t, { allowDeprecated: true });

  for (const [id, section] of Object.entries(sections)) {
    if (!model.manifest.domains[id]) {
      errors.push(`docs-spec catalog.sections: manifest 에 없는 도메인 "${id}"`);
      continue;
    }
    blocks.set(`catalog-domain:${id}`, renderSection(model, errors, id, section));
  }
  for (const [name, table] of Object.entries(tables)) blocks.set(`catalog-table:${name}`, renderTable(model, errors, name, table));
  return blocks;
}

// ── 렌더러: README 도구 표 ────────────────────────────────────────────────────

function readmeBlocks(model, errors, cfg) {
  const rows = model.order.map((id) => {
    const d = spec.domains[id];
    const where = `docs-spec domains.${id}.highlights`;
    if (!d.en?.trim()) errors.push(`docs-spec domains.${id}: en 라벨이 비었습니다`);
    if (!d.highlights?.length) errors.push(`${where}: 대표 도구를 하나 이상 적으세요`);
    for (const t of d.highlights ?? []) checkTool(model, errors, where, t, { domain: id });
    const label = cfg.label === 'en' ? d.en : (d.ko ?? model.manifest.domains[id].label);
    const shown = cfg.bold ? `**${label}**` : label;
    return `| ${shown} | ${model.tools(id).length} | ${(d.highlights ?? []).map(code).join(cfg.separator)} |`;
  });
  return new Map([
    ['readme-tools-heading', cfg.heading.replace('{domains}', String(model.order.length))],
    ['readme-tools-table', [...cfg.header, ...rows].join('\n')],
  ]);
}

// ── 렌더러: agent-guide §0 `select:` 배치 ─────────────────────────────────────

export function expandBatches(model, errors, batchSpec = spec.batches) {
  const expanded = batchSpec.map((b, i) => {
    const where = `docs-spec batches[${i}] "${b.goal}"`;
    const names = [];
    const add = (t) => {
      if (!names.includes(t)) names.push(t);
    };
    for (const t of b.tools ?? []) if (checkTool(model, errors, where, t)) add(t);
    for (const id of b.domains ?? []) {
      if (!model.manifest.domains[id]) errors.push(`${where}: manifest 에 없는 도메인 "${id}"`);
      else model.tools(id).filter((t) => !model.deprecated[t]).forEach(add);
    }
    for (const id of b.fallbackFor ?? []) {
      if (!model.manifest.domains[id]) errors.push(`${where}: fallbackFor 에 없는 도메인 "${id}"`);
    }
    return { ...b, names };
  });

  // 새 도구가 배치에서 빠지는 일이 구조적으로 없도록: 모든 도메인은 domains/fallbackFor 로 "주인 배치"를 가진다.
  const owner = new Map();
  for (const b of expanded) for (const id of [...(b.domains ?? []), ...(b.fallbackFor ?? [])]) if (!owner.has(id)) owner.set(id, b);
  for (const id of model.order) {
    if (!owner.has(id)) errors.push(`docs-spec batches: 도메인 "${id}" 를 domains 나 fallbackFor 로 가진 배치가 없습니다 — 새 도구가 배치에서 빠집니다`);
  }
  const batched = new Set(expanded.flatMap((b) => b.names));
  for (const id of model.order) {
    const b = [...expanded].find((x) => (x.fallbackFor ?? []).includes(id));
    if (!b) continue;
    for (const t of model.tools(id)) {
      if (!model.deprecated[t] && !batched.has(t)) {
        b.names.push(t);
        batched.add(t);
      }
    }
  }
  const missing = [...model.domainOf.keys()].filter((t) => !model.deprecated[t] && !batched.has(t));
  if (missing.length) errors.push(`docs-spec batches: 어느 배치에도 없는 도구 — ${missing.join(', ')}`);
  return expanded;
}

function guideBlocks(model, errors) {
  const rows = expandBatches(model, errors).map((b) => {
    if (!b.names.length) errors.push(`docs-spec batches "${b.goal}": 빈 배치`);
    return `| ${b.goal} | \`select:${b.names.join(',')}\` |`;
  });
  return new Map([['select-batches', ['| Goal | `ToolSearch` query |', '|------|--------------------|', ...rows].join('\n')]]);
}

// ── 블록 치환 ─────────────────────────────────────────────────────────────────

/** 파일의 생성 블록을 찾아 기대 내용과 비교/치환한다. 마커 구조 오류는 errors 로. */
export function applyBlocks(rel, text, blocks, errors) {
  const lines = text.split('\n');
  const out = [];
  const seen = new Set();
  const stale = [];
  let open = null; // { id, body: [] }
  for (const line of lines) {
    const m = line.trim().match(MARKER);
    if (!m) {
      if (open) open.body.push(line);
      else out.push(line);
      continue;
    }
    const [, id, edge] = m;
    if (edge === 'start') {
      if (open) errors.push(`${rel}: "${open.id}" 블록이 닫히기 전에 "${id}" 가 시작됩니다`);
      if (seen.has(id)) errors.push(`${rel}: 생성 블록 "${id}" 가 두 번 있습니다`);
      seen.add(id);
      out.push(line);
      open = { id, body: [] };
      continue;
    }
    if (!open || open.id !== id) {
      errors.push(`${rel}: 짝이 없는 end 마커 "${id}"`);
      out.push(line);
      continue;
    }
    if (!blocks.has(id)) {
      errors.push(`${rel}: 알 수 없는 생성 블록 "${id}" — 스펙에서 사라진 도메인/표라면 마커와 함께 지우세요`);
      out.push(...open.body);
    } else {
      const want = blocks.get(id);
      if (open.body.join('\n') !== want) stale.push(id);
      out.push(want);
    }
    out.push(line);
    open = null;
  }
  if (open) errors.push(`${rel}: "${open.id}" 블록의 end 마커가 없습니다`);
  for (const id of blocks.keys()) {
    if (!seen.has(id)) {
      errors.push(`${rel}: 생성 블록 "${id}" 의 마커가 없습니다 — <!-- generated:${id}:start --> … <!-- generated:${id}:end --> 를 넣으세요`);
    }
  }
  return { text: out.join('\n'), stale };
}

/** 대상 파일 → 기대 블록. 스펙·manifest 검증 오류는 errors 에 쌓인다. */
export function plan(errors = []) {
  const manifest = JSON.parse(readFileSync(path.join(root, MANIFEST), 'utf8'));
  const model = buildModel(manifest, errors);
  const targets = new Map();
  targets.set(CATALOG, catalogBlocks(model, errors));
  for (const cfg of spec.readmes) targets.set(cfg.file, readmeBlocks(model, errors, cfg));
  targets.set(GUIDE, guideBlocks(model, errors));
  return { model, targets };
}

// ── main ──────────────────────────────────────────────────────────────────────

function main() {
  const checkOnly = process.argv.includes('--check');
  const errors = [];
  const { targets } = plan(errors);
  const staleReport = [];
  const writes = [];

  for (const [rel, blocks] of targets) {
    const abs = path.join(root, rel);
    if (!existsSync(abs)) {
      errors.push(`${rel}: 파일이 없습니다`);
      continue;
    }
    const raw = readFileSync(abs, 'utf8');
    const eol = raw.includes('\r\n') ? '\r\n' : '\n';
    const { text, stale } = applyBlocks(rel, raw.replace(/\r\n/g, '\n'), blocks, errors);
    for (const id of stale) staleReport.push(`${rel} › ${id}`);
    if (stale.length) writes.push([abs, eol === '\n' ? text : text.replace(/\n/g, eol)]);
  }

  if (errors.length) {
    console.error('\n  ✗ gen-docs: 생성 입력(tool-manifest.json / scripts/docs-spec.mjs) 또는 마커에 문제가 있습니다:');
    for (const e of errors) console.error(`      ${e}`);
    console.error('');
    process.exitCode = 1;
    return;
  }

  if (checkOnly) {
    if (staleReport.length) {
      console.error('\n  ✗ 생성 문서 블록이 tool-manifest.json / scripts/docs-spec.mjs 와 다릅니다 (손으로 고치지 마세요):');
      for (const s of staleReport) console.error(`      ${s}`);
      console.error('\n  Fix: npm run plugin:sync\n');
      process.exitCode = 1;
    } else {
      const n = [...targets.values()].reduce((sum, b) => sum + b.size, 0);
      console.log(`  ✓ Generated doc blocks match tool-manifest.json (${n} blocks in ${targets.size} files)`);
    }
    return;
  }

  for (const [abs, text] of writes) writeFileSync(abs, text);
  if (staleReport.length) {
    console.log('  ✓ Regenerated doc blocks:');
    for (const s of staleReport) console.log(`      ${s}`);
  } else {
    console.log('  ✓ Generated doc blocks already up to date');
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();

