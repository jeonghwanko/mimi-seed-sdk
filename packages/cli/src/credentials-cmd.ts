// `mimi-seed credentials status|mode|encrypt|decrypt` — 저장된 자격증명의 암호화 (docs/design/credential-encryption.md 2단계).
//
// 모드는 settings.json 의 credentialStore 에 저장된다(쓰기는 CLI 만 — settings.ts). 실제 암호화는 core 의 writer 가
// 쓸 때마다 하고, 여기는 모드를 바꾸고 · 지금 있는 파일을 한꺼번에 바꾸고 · 상태를 보여준다.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import kleur from "kleur";
import { catalog } from "#core/lang.js";
import { writeCredentialFile } from "#core/atomic-write.js";
import { obtainDataKey, lookupDataKey } from "#core/credential-keystore.js";
import {
  CREDENTIAL_STORE_ENV,
  clearKeyIdMarker,
  credentialStoreReport,
  isCredentialStoreMode,
  rewriteCredentialFiles,
} from "#core/credential-store.js";
import { writeSettings } from "./settings.js";
import { printCommandHelp } from "./help.js";

/**
 * 봉투를 읽는 첫 버전의 하한 — 0.24.0 이 reader 없이 배포된 마지막 버전이고, 그 다음 릴리스부터 모든 reader 가 봉투를
 * 연다(1단계). CLI 자신의 버전을 기준으로 삼으면 CLI 를 올릴 때마다 reader 가 있는 0.25 고정까지 "옛 버전"이 된다.
 */
export const FIRST_ENVELOPE_READER = "0.24.1";

const M = catalog(
  {
    modeLabel: { file: "평문 (file)", keychain: "암호화 (keychain)", auto: "가능하면 암호화 (auto)" },
    header: "자격증명 저장",
    configured: (mode: string, explicit: boolean) => `설정: ${mode}${explicit ? "" : " — 기본값"}`,
    effective: (mode: string) => `적용: ${mode}`,
    upgraded: "  (이 컴퓨터는 이미 암호화를 시작했으므로 평문으로 내려가지 않습니다)",
    envWins: (env: string) => `  (${env} 환경 변수가 settings.json 보다 우선합니다)`,
    store: (backend: string, state: string) => `키 저장소: ${backend} — ${state}`,
    storeState: { ok: "사용 가능", absent: "키 없음(첫 암호화 때 만듭니다)", unavailable: "닿지 못함" },
    counts: (enc: number, plain: number, locked: number, bad: number) =>
      `파일: 암호화 ${enc} · 평문 ${plain}${locked ? ` · 잠김 ${locked}` : ""}${bad ? ` · 손상 ${bad}` : ""}`,
    lockedLine: (file: string, reason: string) => `  ✗ ${file} — ${reason}`,
    plainHint: "평문 파일을 지금 암호화하려면: mimi-seed credentials encrypt",
    badMode: (v: string) => `알 수 없는 모드: ${v} — file, keychain, auto 중 하나`,
    pinned: (where: string, version: string) =>
      `${where} 에 Mimi Seed MCP 서버가 ${version} 으로 고정돼 있습니다. 그 버전은 암호화된 자격증명을 읽지 못합니다 — @latest 로 바꾸거나 0.24.0 보다 높은 버전으로 올린 뒤 다시 실행하세요 (무시하려면 --force).`,
    envOverrides: (env: string, value: string) => `주의: ${env}=${value} 가 설정돼 있어 그 값이 이 설정보다 우선합니다. 바꾼 모드를 쓰려면 환경 변수를 지우세요.`,
    storeNeeded: (backend: string, why: string) => `${backend}에 닿지 못해 암호화를 켤 수 없습니다: ${why}`,
    modeSaved: (mode: string) => `저장 모드를 ${mode}(으)로 바꿨습니다. 앞으로 쓰는 자격증명에 적용됩니다.`,
    modeFileNote: "이미 암호화된 파일은 그대로 남고, 키가 있는 한 계속 읽힙니다. 평문으로 되돌리려면: mimi-seed credentials decrypt",
    encryptNeedsMode: "먼저 암호화 모드를 켜세요: mimi-seed credentials mode keychain (또는 auto)",
    decryptNeedsMode: "먼저 평문 모드로 바꾸세요: mimi-seed credentials mode file",
    converted: (n: number, what: string) => `${n}개 파일을 ${what}했습니다.`,
    encryptedWord: "암호화",
    decryptedWord: "평문으로 되돌",
    nothing: "바꿀 파일이 없습니다.",
    skipped: (file: string, reason: string) => `  건너뜀: ${file} — ${reason}`,
    markerCleared: "남은 암호화 파일이 없어 암호화 표식(.data-key.id)을 지웠습니다.",
  },
  {
    modeLabel: { file: "plaintext (file)", keychain: "encrypted (keychain)", auto: "encrypted when possible (auto)" },
    header: "Credential storage",
    configured: (mode: string, explicit: boolean) => `Configured: ${mode}${explicit ? "" : " — default"}`,
    effective: (mode: string) => `In effect: ${mode}`,
    upgraded: "  (this machine has already encrypted, so it does not go back to plaintext)",
    envWins: (env: string) => `  (the ${env} environment variable wins over settings.json)`,
    store: (backend: string, state: string) => `Key store: ${backend} — ${state}`,
    storeState: { ok: "available", absent: "no key yet (created on the first encrypted save)", unavailable: "unreachable" },
    counts: (enc: number, plain: number, locked: number, bad: number) =>
      `Files: ${enc} encrypted · ${plain} plaintext${locked ? ` · ${locked} locked` : ""}${bad ? ` · ${bad} damaged` : ""}`,
    lockedLine: (file: string, reason: string) => `  ✗ ${file} — ${reason}`,
    plainHint: "To encrypt the plaintext files now: mimi-seed credentials encrypt",
    badMode: (v: string) => `Unknown mode: ${v} — use file, keychain, or auto`,
    pinned: (where: string, version: string) =>
      `${where} pins the Mimi Seed MCP server to ${version}, which cannot read encrypted credentials. Change it to @latest or a version newer than 0.24.0, then run this again (--force to ignore).`,
    envOverrides: (env: string, value: string) => `Note: ${env}=${value} is set and wins over this setting. Unset it to use the mode you just chose.`,
    storeNeeded: (backend: string, why: string) => `Cannot turn on encryption: ${backend} could not be reached: ${why}`,
    modeSaved: (mode: string) => `Storage mode set to ${mode}. It applies to credentials saved from now on.`,
    modeFileNote: "Files already encrypted stay encrypted and keep working while the key exists. To turn them back into plaintext: mimi-seed credentials decrypt",
    encryptNeedsMode: "Turn on an encrypting mode first: mimi-seed credentials mode keychain (or auto)",
    decryptNeedsMode: "Switch to plaintext mode first: mimi-seed credentials mode file",
    converted: (n: number, what: string) => `${n} file(s) ${what}.`,
    encryptedWord: "encrypted",
    decryptedWord: "turned back into plaintext",
    nothing: "No files to change.",
    skipped: (file: string, reason: string) => `  skipped: ${file} — ${reason}`,
    markerCleared: "No encrypted files remain, so the encryption marker (.data-key.id) was removed.",
  },
);

function log(msg = ""): void {
  process.stdout.write(msg + "\n");
}

/**
 * MCP 서버를 특정 버전으로 고정한 등록. 등록은 보통 `@latest` 라 문제없지만, 손으로 `@0.24.0` 처럼 고정했다면 그
 * 서버는 봉투를 읽지 못해 "토큰 없음"으로만 보인다(설계 §5). 이 CLI 와 같은 릴리스부터 reader 가 들어 있으므로
 * CLI 버전보다 낮은 고정을 찾는다. 읽기 실패는 '고정 없음' — 이 점검은 안내용이다.
 */
export function findOldMcpPins(
  home: string = os.homedir(),
  cwd: string = process.cwd(),
  floor: string = FIRST_ENVELOPE_READER,
): Array<{ where: string; version: string }> {
  const candidates = [
    path.join(home, ".claude.json"),
    path.join(home, ".codex", "config.toml"),
    path.join(home, ".cursor", "mcp.json"),
    path.join(cwd, ".mcp.json"),
  ];
  const found: Array<{ where: string; version: string }> = [];
  for (const file of candidates) {
    let text: string;
    try {
      text = fs.readFileSync(file, "utf8");
    } catch {
      // 그 클라이언트 설정이 없다 — 고정도 없다
      continue;
    }
    // 버전 고정은 `@0.24.0`(정확히) · `@0.24`(0.24.x) · `@~0.24.0`(0.24.x) · `@^0.24.0`(0.x 에선 0.24.x, 1 이상에선 그 메이저)
    // 꼴로 온다. npx 가 실제로 받는 건 그 범위의 **최신**이므로, 범위의 가장 높은 버전으로 판정한다 — `@0.24` 는 0.24.1 이
    // 배포돼 있으면 reader 가 있는 버전을 받는다.
    for (const match of text.matchAll(/@yoonion\/mimi-seed-mcp@([\^~]?)(\d+)(?:\.(\d+))?(?:\.(\d+))?(?![\w.])/g)) {
      const [, range, major, minor, patch] = match;
      const caretMajor = range === "^" && major !== "0";
      const version = [major, caretMajor ? "999" : (minor ?? "999"), range || patch === undefined ? "999" : patch].join(".");
      if (compareVersions(version, floor) < 0) found.push({ where: file, version: match[0].slice(match[0].lastIndexOf("@") + 1) });
    }
  }
  return found;
}

export function compareVersions(a: string, b: string): number {
  const pa = a.split(/[.-]/).slice(0, 3).map((n) => Number.parseInt(n, 10) || 0);
  const pb = b.split(/[.-]/).slice(0, 3).map((n) => Number.parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pa[i] - pb[i];
  return 0;
}

function printStatus(): void {
  const m = M();
  const report = credentialStoreReport();
  log(kleur.bold(m.header));
  log(m.configured(m.modeLabel[report.configured], report.explicit));
  log(m.effective(m.modeLabel[report.effective]));
  if (report.effective !== report.configured) log(kleur.dim(m.upgraded));
  if (process.env[CREDENTIAL_STORE_ENV]?.trim()) log(kleur.dim(m.envWins(CREDENTIAL_STORE_ENV)));
  // 키 저장소는 쓸 일이 있을 때(암호화 모드 · 이미 암호화한 컴퓨터)만 조회한다 — 평문 사용자에게 키체인 프로세스를 띄우지 않는다.
  if (report.effective !== "file" || report.keyId || report.files.some((f) => f.state !== "plaintext")) {
    const store = lookupDataKey();
    log(m.store(store.backend, m.storeState[store.state] + (store.state === "unavailable" ? ` (${store.reason})` : "")));
  }
  const count = (state: string) => report.files.filter((f) => f.state === state).length;
  log(m.counts(count("encrypted"), count("plaintext"), count("locked"), count("invalid")));
  for (const f of report.files) if (f.state === "locked" || f.state === "invalid") log(kleur.red(m.lockedLine(f.file, f.reason ?? "")));
  if (report.effective !== "file" && count("plaintext") > 0) log(kleur.dim(m.plainHint));
}

function fail(message: string): never {
  log(kleur.red(message));
  process.exit(1);
}

function setMode(value: string | undefined, force: boolean): void {
  const m = M();
  if (!isCredentialStoreMode(value)) fail(m.badMode(value ?? ""));
  if (value !== "file") {
    const pins = force ? [] : findOldMcpPins();
    if (pins.length > 0) fail(pins.map((pin) => m.pinned(pin.where, pin.version)).join("\n"));
    if (value === "keychain") {
      // 켜는 순간 저장소를 확인한다 — 다음 토큰 갱신에서 처음 실패하면 원인이 멀어진다. 키가 없으면 여기서 만든다.
      const key = obtainDataKey();
      if (key.state !== "ok") fail(m.storeNeeded(key.backend, key.state === "unavailable" ? key.reason : "no key"));
    }
  }
  writeSettings({ credentialStore: value });
  log(kleur.green(m.modeSaved(m.modeLabel[value])));
  const env = process.env[CREDENTIAL_STORE_ENV]?.trim().toLowerCase();
  if (isCredentialStoreMode(env) && env !== value) log(kleur.yellow(m.envOverrides(CREDENTIAL_STORE_ENV, env)));
  if (value === "file") log(kleur.dim(m.modeFileNote));
  else log(kleur.dim(m.plainHint));
}

function convert(target: "encrypted" | "plaintext"): void {
  const m = M();
  const report = credentialStoreReport();
  if (target === "encrypted") {
    if (report.effective === "file") fail(m.encryptNeedsMode);
    // auto 라도 저장소가 없으면 writer 가 평문으로 쓴다 — "암호화했다"고 말하기 전에 키를 확보한다.
    const key = obtainDataKey();
    if (key.state !== "ok") fail(m.storeNeeded(key.backend, key.state === "unavailable" ? key.reason : "no key"));
  } else if (report.effective !== "file") {
    const env = process.env[CREDENTIAL_STORE_ENV]?.trim().toLowerCase();
    fail(isCredentialStoreMode(env) && env !== "file" ? m.envOverrides(CREDENTIAL_STORE_ENV, env) : m.decryptNeedsMode);
  }
  const result = rewriteCredentialFiles(target, (file, text) => writeCredentialFile(file, text));
  log(result.converted.length > 0
    ? kleur.green(m.converted(result.converted.length, target === "encrypted" ? m.encryptedWord : m.decryptedWord))
    : m.nothing);
  for (const s of result.skipped) log(kleur.yellow(m.skipped(s.file, s.reason)));
  if (target === "plaintext" && result.skipped.length === 0
    && !credentialStoreReport().files.some((f) => f.state !== "plaintext")) {
    clearKeyIdMarker();
    log(kleur.dim(m.markerCleared));
  }
  if (result.skipped.length > 0) process.exitCode = 1;
}

export async function cmdCredentials(args: string[]): Promise<void> {
  const [sub, ...rest] = args;
  switch (sub) {
    case undefined:
    case "status":
      printStatus();
      return;
    case "mode":
      setMode(rest.find((a) => !a.startsWith("-"))?.toLowerCase(), rest.includes("--force"));
      return;
    case "encrypt":
      convert("encrypted");
      return;
    case "decrypt":
      convert("plaintext");
      return;
    default:
      printCommandHelp("credentials");
      if (sub !== "--help" && sub !== "-h") process.exitCode = 1;
  }
}
