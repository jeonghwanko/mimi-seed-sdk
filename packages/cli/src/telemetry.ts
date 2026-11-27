import { consoleBase } from "#core/console-url.js";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHmac, randomUUID } from "node:crypto";
import { catalog } from "./i18n.js";
import { fetchWithTimeout } from "./lib/http.js";
import { writeCredentialJson } from "#core/atomic-write.js";
import type { ReleaseDoctorReport } from "#core/checks/release-doctor.js";
import { version } from "../package.json";

const M = catalog(
  {
    notice: "선택적 사용량 측정은 꺼져 있습니다. 안내: mimi-seed telemetry --help\n",
    enabled: "사용량 측정 켜짐. 임의 설치 ID·프로젝트 해시·버전·OS·결과 코드·실행시간을 전송합니다. 끄기: mimi-seed telemetry off\n",
    disabled: "사용량 측정 꺼짐. MIMI_SEED_TELEMETRY=0으로도 끌 수 있습니다.\n",
    invalid: "사용법: mimi-seed telemetry on|off|status\n",
    noConsole: "사용량 측정은 팀 콘솔로만 보냅니다 — 켜려면 먼저 MIMI_SEED_WEB_BASE 에 팀 콘솔 주소를 지정하세요. 아무것도 바꾸지 않았습니다.\n",
  },
  {
    notice: "Optional usage measurement is off. Learn more: mimi-seed telemetry --help\n",
    enabled: "Usage measurement enabled: random installation ID, project hash, version, OS, result codes and duration. Disable: mimi-seed telemetry off\n",
    disabled: "Usage measurement disabled. MIMI_SEED_TELEMETRY=0 also disables it.\n",
    invalid: "Usage: mimi-seed telemetry on|off|status\n",
    noConsole: "Usage measurement is sent only to a team console — set MIMI_SEED_WEB_BASE to your team console first. Nothing was changed.\n",
  },
);

interface Consent { enabled: boolean; webBase?: string; installationId?: string; salt?: string }
const location = () => path.join(os.homedir(), ".mimi-seed", "telemetry.json");
function readConsent(webBase: string): Consent {
  try {
    const saved = JSON.parse(fs.readFileSync(location(), "utf8")) as Consent;
    // Consent and pseudonymous identifiers belong to the collector the user selected.
    return saved.webBase === webBase ? saved : { enabled: false };
  }
  catch { return { enabled: false }; }
}
// installationId + salt 는 프로젝트 해시를 역산하는 열쇠라 자격증명처럼 0600 으로 쓴다.
function writeConsent(value: Consent): void {
  writeCredentialJson(location(), value);
}
export function telemetryEnabled(): boolean {
  const webBase = consoleBase(process.env.MIMI_SEED_WEB_BASE);
  if (!webBase) return false;
  if (process.env.MIMI_SEED_TELEMETRY !== undefined) return process.env.MIMI_SEED_TELEMETRY === "1";
  return readConsent(webBase).enabled === true;
}
// 콘솔이 없으면 켤 방법도 없다 — 켜라는 안내를 매 실행마다 보이지 않는다.
export function telemetryNotice(): string {
  if (!consoleBase(process.env.MIMI_SEED_WEB_BASE)) return "";
  return telemetryEnabled() ? "" : M().notice;
}
export function cmdTelemetry(argv: string[]): void {
  const action = argv[0] ?? "status";
  if (argv.length > 1 || !["on", "off", "status"].includes(action)) {
    process.stderr.write(M().invalid); process.exitCode = 2; return;
  }
  const webBase = consoleBase(process.env.MIMI_SEED_WEB_BASE);
  if (action === "on" && !webBase) {
    // 예전엔 아무것도 쓰지 않고 "꺼짐" 만 찍은 채 0 으로 끝났다 — 켠 줄 알게 만들었다.
    process.stderr.write(M().noConsole); process.exitCode = 1; return;
  }
  if (action === "on" && webBase) {
    const consent = readConsent(webBase);
    writeConsent({ webBase, enabled: true, installationId: consent.installationId ?? randomUUID(), salt: consent.salt ?? randomUUID() });
  }
  if (action === "off") writeConsent({ enabled: false });
  process.stdout.write(telemetryEnabled() ? M().enabled : M().disabled);
}

export type UsageOutcome = "completed" | "failed" | "incomplete";
function frameworkAt(root: string): string {
  if (fs.existsSync(path.join(root, "ProjectSettings", "ProjectSettings.asset"))) return "unity";
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    if (deps.expo) return "expo";
    if (deps["react-native"]) return "react-native";
  } catch { /* Only a category leaves this function. */ }
  return "native-or-unknown";
}
export function usageRun(command: "check" | "setup", projectPath: string):
  (outcome: UsageOutcome, report?: ReleaseDoctorReport) => Promise<void> {
  const baseUrl = consoleBase(process.env.MIMI_SEED_WEB_BASE);
  if (!baseUrl || !telemetryEnabled()) return async () => {};
  try {
    const consent = readConsent(baseUrl);
    const installationId = consent.installationId ?? randomUUID();
    const salt = consent.salt ?? randomUUID();
    // 저장은 이 콘솔에 대한 사용자 동의가 있을 때만. MIMI_SEED_TELEMETRY=1 로 한 번 켠 실행이 다른 콘솔의 동의
    // 파일을 이 콘솔 것(enabled:false)으로 덮어써, 원래 콘솔로 돌아가면 "꺼짐" 이 되던 문제를 막는다.
    if (consent.enabled && (!consent.installationId || !consent.salt)) {
      writeConsent({ webBase: baseUrl, enabled: true, installationId, salt });
    }
    let normalized = path.resolve(projectPath);
    try { normalized = fs.realpathSync(normalized); } catch { /* A failed check can still be measured. */ }
    if (process.platform === "win32") normalized = normalized.toLowerCase();
    const base = {
      schema: 1, installationId,
      projectId: createHmac("sha256", salt).update(normalized).digest("hex"),
      runId: randomUUID(), version, os: process.platform,
      ci: Boolean(process.env.CI), command,
      framework: frameworkAt(normalized),
    };
    const started = Date.now();
    return async (outcome, report) => {
      if (!telemetryEnabled() || consoleBase(process.env.MIMI_SEED_WEB_BASE) !== baseUrl) return;
      // Explicit allowlist projection: never spread a report, credential, error, or path into a payload.
      const payload = {
        ...base, outcome, durationMs: Math.min(86_400_000, Math.max(0, Date.now() - started)),
        platforms: report?.platforms ?? [],
        codes: [...new Set(report?.findings.map(f => f.code).filter(c => /^[a-zA-Z0-9_]{1,80}$/.test(c)) ?? [])].slice(0, 60),
      };
      try {
        await fetchWithTimeout(`${baseUrl}/api/sdk-usage`, {
          method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify(payload), redirect: "error",
        }, 800);
      } catch { /* Measurement must never change the command's result or delay it indefinitely. */ }
    };
  } catch { return async () => {}; }
}
