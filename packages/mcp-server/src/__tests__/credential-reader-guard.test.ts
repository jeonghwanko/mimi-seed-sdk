/**
 * 자격증명 reader 가드 — docs/design/credential-encryption.md §4.4.
 *
 * 암호화(2단계)가 켜지면 자격증명 파일은 봉투가 된다. 봉투도 형식상 정상 JSON 이라, `JSON.parse(readFileSync(…))`
 * 로 직접 읽는 로더는 깨지지 않고 **엉뚱한 객체**(봉투 필드)를 자격증명으로 받는다 — "토큰 없음"이나 이상한 API 오류로
 * 보일 뿐 원인은 안 보인다. 그래서 자격증명 파일은 core 의 readCredentialFileSync / readCredentialFile /
 * readJsonFile 로만 읽는다. 이 테스트가 두 방향에서 막는다:
 *
 *  1. 자격증명 writer(writeCredentialJson/File 를 부르는 모듈)는 자기 파일의 주인이다 — 원시 읽기가 없어야 한다.
 *  2. 암호화 대상 파일 이름을 문자열로 가진 모듈이 원시 읽기를 하면 실패한다.
 *
 * 예외는 이유와 함께 아래 목록에만 둔다. 범위 밖 파일(keys/ · keystores/ · 영수증)은 §6 에서 평문으로 남기로 했다.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const packagesRoot = fileURLToPath(new URL('../../../', import.meta.url));
const ROOTS = ['mcp-server/src', 'cli/src', 'core/src'];

/** §6 "In scope (encrypted)" — 따옴표·경로 구분자에 붙은 문자열로만 찾는다(app.config.json 같은 오탐 방지). */
const IN_SCOPE = [
  'tokens.json', 'credentials.json', 'google-profiles', 'appstore.json', 'play-service-account.json',
  'play-service-accounts', 'bigquery-service-account.json', 'drive-service-account.json', 'facebook.json',
  'instagram.json', 'threads.json', 'social-profiles', 'tiktok-business.json', 'google-ads.json', 'jenkins.json',
  'ci.json', 'config.json', 'meta-apps.json',
];

/** 원시 읽기를 해도 되는 모듈 — 반드시 이유와 함께. (packages/ 기준 경로) */
const ALLOWED: Record<string, string> = {
  'mcp-server/src/iam/key-files.ts': 'keys/ 는 사용자가 SDK 밖(gcloud·CI)에서 쓰는 파일이라 평문으로 남는다 (§6)',
  'mcp-server/src/android/keystore-store.ts': 'keystores/ 는 Gradle·CI 가 직접 읽어 평문으로 남는다 (§6)',
  'mcp-server/src/jenkins/builds.ts': '빌드 요청 영수증과 HMAC 키 — 비밀 자격증명이 아니다 (§6)',
  'cli/src/telemetry.ts': '사용량 측정 동의 파일 — 비밀이 아니다 (§6)',
  'core/src/credential-read.ts': '봉투를 여는 구현 그 자체',
  'core/src/credential-store.ts': 'settings.json(모드)과 .data-key.id(kid 표식)를 읽는다 — 둘 다 비밀이 아니다',
  'core/src/credential-keystore.ts': 'Windows DPAPI 로 보호된 데이터 키 파일 — 자격증명이 아니라 키 저장소다',
  'cli/src/mcp-config.ts': 'MCP 클라이언트 설정 파일을 읽는다. config.json 은 안내 문구에만 나온다',
  'cli/src/credentials-cmd.ts': 'MCP 클라이언트 설정(.claude.json 등)에서 버전 고정을 찾는다 — 자격증명은 core 의 rewriteCredentialFiles 로 읽는다',
  'cli/src/jenkins-project.ts': '프로젝트의 .mimi-seed.json 을 읽는다. jenkins.json 은 출처 표시 문자열이다',
};

const RAW_READ = /\breadFile(?:Sync)?\s*\(/;

function sourceFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== '__tests__') walk(full);
      } else if (entry.name.endsWith('.ts')) {
        out.push(full);
      }
    }
  };
  for (const root of ROOTS) walk(path.join(packagesRoot, root));
  return out;
}

/** 주석 줄을 뺀 코드 — 주석에 적힌 파일 이름·readFileSync 는 판정에 넣지 않는다. */
function codeOf(text: string): string {
  return text.split('\n').filter((line) => !/^\s*(?:\/\/|\*|\/\*)/.test(line))
    .map((line) => line.replace(/\s\/\/.*$/, '')).join('\n');
}

const rel = (file: string) => path.relative(packagesRoot, file).split(path.sep).join('/');

describe('자격증명 reader 가드', () => {
  const files = sourceFiles().map((file) => ({ file: rel(file), code: codeOf(fs.readFileSync(file, 'utf8')) }));

  it('자격증명 writer 는 자기 파일을 원시 읽기로 읽지 않는다', () => {
    const offenders = files
      .filter(({ code }) => /writeCredential(?:Json|File)\s*\(/.test(code) && RAW_READ.test(code))
      .map(({ file }) => file)
      .filter((file) => !(file in ALLOWED));
    expect(offenders).toEqual([]);
  });

  it('암호화 대상 파일 이름을 가진 모듈은 원시 읽기를 하지 않는다', () => {
    const named = new RegExp(`['"\`/](?:${IN_SCOPE.map((name) => name.replace(/[.-]/g, '\\$&')).join('|')})['"\`/]`);
    const offenders = files
      .filter(({ code }) => named.test(code) && RAW_READ.test(code))
      .map(({ file }) => file)
      .filter((file) => !(file in ALLOWED));
    expect(offenders).toEqual([]);
  });

  it('예외 목록에 더는 원시 읽기를 하지 않는 모듈이 남아 있지 않다', () => {
    const stale = Object.keys(ALLOWED).filter((file) => {
      const found = files.find((entry) => entry.file === file);
      return !found || !RAW_READ.test(found.code);
    });
    expect(stale).toEqual([]);
  });
});
