#!/usr/bin/env node
import { resolveLang } from '../lib/lang.js';
import { scanReleaseDoctor, type ReleaseDoctorFinding } from './release-doctor.js';

interface Args {
  projectPath: string;
  json: boolean;
  failOnBlocker: boolean;
}

function parseArgs(argv: string[]): Args {
  let projectPath = process.cwd();
  let json = false;
  let failOnBlocker = false;
  for (const arg of argv) {
    if (arg === '--json') json = true;
    else if (arg === '--fail-on-blocker') failOnBlocker = true;
    else if (!arg.startsWith('-')) projectPath = arg;
  }
  return { projectPath, json, failOnBlocker };
}

const COPY = {
  ko: {
    title: 'Mimi Seed Release Doctor — 로그인 없는 출시 점검',
    platforms: '감지 플랫폼',
    summary: (blockers: number, warnings: number) => `결과: 블로커 ${blockers} · 경고 ${warnings}`,
    labels: { blocker: '블로커', warning: '경고', info: '확인' },
    evidence: '근거',
    action: '조치',
    source: '출처',
    connected: '스토어 연결 후 추가 검사',
    connectedChecks: [
      '스토어 등록정보와 스크린샷',
      '업로드된 빌드의 존재 여부와 처리 상태',
      'App Store 연령등급 응답과 Google Play 선언',
      '심사 제출과 단계적 출시 상태',
    ],
    ready: '로컬 검사에서 제출 차단 요인을 찾지 못했습니다.',
    partial: '이 결과는 저장소의 결정적 증거만 검사합니다. 스토어 상태는 연결 후 별도로 확인합니다.',
  },
  en: {
    title: 'Mimi Seed Release Doctor — no-login release check',
    platforms: 'Platforms',
    summary: (blockers: number, warnings: number) => `Result: ${blockers} blockers · ${warnings} warnings`,
    labels: { blocker: 'BLOCKER', warning: 'WARNING', info: 'INFO' },
    evidence: 'Evidence',
    action: 'Action',
    source: 'Source',
    connected: 'Checked after connecting stores',
    connectedChecks: undefined,
    ready: 'No submission blocker was found by the local checks.',
    partial: 'This report checks deterministic repository evidence only. Store state is checked separately after connection.',
  },
} as const;

function renderFinding(
  finding: ReleaseDoctorFinding,
  copy: typeof COPY.ko | typeof COPY.en,
  lang: 'ko' | 'en',
): string[] {
  const localized = lang === 'ko' ? finding.ko : undefined;
  const lines = [
    `[${copy.labels[finding.severity]}] ${localized?.title ?? finding.title}`,
    `  ${localized?.detail ?? finding.detail}`,
  ];
  if (finding.file) lines.push(`  ${copy.evidence}: ${finding.file}`);
  const action = localized?.action ?? finding.action;
  if (action) lines.push(`  ${copy.action}: ${action}`);
  if (finding.sourceUrl) lines.push(`  ${copy.source}: ${finding.sourceUrl}`);
  return lines;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const report = await scanReleaseDoctor(args.projectPath);
  if (args.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    const lang = resolveLang();
    const copy = COPY[lang];
    const lines = [
      '',
      copy.title,
      report.projectPath,
      `${copy.platforms}: ${report.platforms.length ? report.platforms.join(' + ') : '-'}`,
      copy.summary(report.counts.blocker, report.counts.warning),
      '',
    ];
    for (const finding of report.findings) lines.push(...renderFinding(finding, copy, lang), '');
    if (report.counts.blocker === 0) lines.push(`✓ ${copy.ready}`, '');
    const connectedChecks = copy.connectedChecks ?? report.coverage.requiresStoreConnection;
    lines.push(copy.partial, '', `${copy.connected}:`, ...connectedChecks.map((item) => `  - ${item}`), '');
    process.stdout.write(lines.join('\n'));
  }
  if (args.failOnBlocker && report.counts.blocker > 0) process.exitCode = 1;
}

main().catch((error: unknown) => {
  process.stderr.write(`Release Doctor failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 2;
});
