import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHmac, randomUUID } from "node:crypto";
import { catalog } from "./i18n.js";
import type { ReleaseDoctorReport } from "./checks/release-doctor.js";
import { version } from "../package.json";

const ENDPOINT = "https://mimi-seed.pryzm.gg/api/sdk-usage";
const M = catalog(
  {
    notice: "선택적 사용량 측정은 꺼져 있습니다. 안내: mimi-seed telemetry --help\n",
    enabled: "사용량 측정 켜짐. 임의 설치 ID·프로젝트 해시·버전·OS·결과 코드·실행시간을 전송합니다. 끄기: mimi-seed telemetry off\n",
    disabled: "사용량 측정 꺼짐. MIMI_SEED_TELEMETRY=0으로도 끌 수 있습니다.\n",
    invalid: "사용법: mimi-seed telemetry on|off|status\n",
  },
  {
    notice: "Optional usage measurement is off. Learn more: mimi-seed telemetry --help\n",
    enabled: "Usage measurement enabled: random installation ID, project hash, version, OS, result codes and duration. Disable: mimi-seed telemetry off\n",
    disabled: "Usage measurement disabled. MIMI_SEED_TELEMETRY=0 also disables it.\n",
    invalid: "Usage: mimi-seed telemetry on|off|status\n",
  },
);

interface Consent { enabled: boolean; installationId?: string; salt?: string }
const location = () => path.join(os.homedir(), ".mimi-seed", "telemetry.json");
function readConsent(): Consent {
  try { return JSON.parse(fs.readFileSync(location(), "utf8")) as Consent; }
  catch { return { enabled: false }; }
}
function writeConsent(value: Consent): void {
  const file = location();
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const temp = `${file}.${randomUUID()}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(value), { mode: 0o600 });
  fs.renameSync(temp, file);
}
export function telemetryEnabled(): boolean {
  if (process.env.MIMI_SEED_TELEMETRY !== undefined) return process.env.MIMI_SEED_TELEMETRY === "1";
  return readConsent().enabled === true;
}
export function telemetryNotice(): string { return telemetryEnabled() ? "" : M().notice; }
export function cmdTelemetry(argv: string[]): void {
  const action = argv[0] ?? "status";
  if (argv.length > 1 || !["on", "off", "status"].includes(action)) {
    process.stderr.write(M().invalid); process.exitCode = 2; return;
  }
  if (action === "on") {
    const consent = readConsent();
    writeConsent({ enabled: true, installationId: consent.installationId ?? randomUUID(), salt: consent.salt ?? randomUUID() });
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
  if (!telemetryEnabled()) return async () => {};
  try {
    const consent = readConsent();
    const installationId = consent.installationId ?? randomUUID();
    const salt = consent.salt ?? randomUUID();
    if (!consent.installationId || !consent.salt) writeConsent({ enabled: consent.enabled, installationId, salt });
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
      if (!telemetryEnabled()) return;
      // Explicit allowlist projection: never spread a report, credential, error, or path into a payload.
      const payload = {
        ...base, outcome, durationMs: Math.min(86_400_000, Math.max(0, Date.now() - started)),
        platforms: report?.platforms ?? [],
        codes: [...new Set(report?.findings.map(f => f.code).filter(c => /^[a-zA-Z0-9_]{1,80}$/.test(c)) ?? [])].slice(0, 60),
      };
      try {
        await fetch(ENDPOINT, {
          method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify(payload), signal: AbortSignal.timeout(800), redirect: "error",
        });
      } catch { /* Measurement must never change the command's result or delay it indefinitely. */ }
    };
  } catch { return async () => {}; }
}
