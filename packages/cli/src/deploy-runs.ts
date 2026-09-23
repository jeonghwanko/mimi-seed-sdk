export type DeployRunAction = "start" | "building" | "ready" | "failed";
export type DeployRunFailureReason = "build_failed" | "build_unknown" | "metadata_missing" | "sync_failed" | "cancelled";

export interface DeployRunRequest {
  action: DeployRunAction;
  runId: string;
  appId: string;
  platform: "android" | "ios";
  versionCode?: number;
  buildNumber?: number;
  version?: string;
  fromRef?: string;
  toRef?: string;
  reason?: DeployRunFailureReason;
}

export interface DeployRun {
  jobId: string;
  appId: string;
  platform: "android" | "ios";
  status: string;
  versionCode?: number | null;
  jenkinsBuildNumber?: number | null;
  version?: string | null;
  fromRef?: string | null;
  toRef?: string | null;
}

function parseRun(value: unknown): DeployRun {
  if (!value || typeof value !== "object") throw new Error(M().invalidResponse);
  const run = value as Record<string, unknown>;
  const jobId = run.jobId ?? run.id;
  if (typeof jobId !== "string" || !jobId || typeof run.appId !== "string" || !run.appId ||
      (run.platform !== "android" && run.platform !== "ios") || typeof run.status !== "string" ||
      (run.versionCode != null && (!Number.isSafeInteger(run.versionCode) || (run.versionCode as number) < 1)) ||
      (run.jenkinsBuildNumber != null && (!Number.isSafeInteger(run.jenkinsBuildNumber) || (run.jenkinsBuildNumber as number) < 1)) ||
      (run.fromRef != null && typeof run.fromRef !== "string") ||
      (run.toRef != null && typeof run.toRef !== "string")) {
    throw new Error(M().invalidResponse);
  }
  return { ...run, jobId } as DeployRun;
}

export async function updateDeployRun(webBase: string, token: string, request: DeployRunRequest): Promise<DeployRun> {
  const res = await fetch(new URL("/api/deploy/runs", webBase), {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(request),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(M().updateFailed(res.status));
  return parseRun(await res.json());
}

export async function getDeployRun(webBase: string, token: string, runId: string): Promise<DeployRun> {
  const url = new URL("/api/deploy", webBase);
  url.searchParams.set("jobId", runId);
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(M().lookupFailed(res.status));
  return parseRun(await res.json());
}
import { catalog } from "./i18n.js";

const M = catalog({
  invalidResponse: "배포 기록 응답이 올바르지 않습니다.",
  updateFailed: (status: number) => `배포 기록 갱신 실패 (${status}). 웹 콘솔에서 상태를 확인하세요.`,
  lookupFailed: (status: number) => `배포 기록 조회 실패 (${status}). 웹 콘솔에서 상태를 확인하세요.`,
}, {
  invalidResponse: "Invalid deployment run response.",
  updateFailed: (status: number) => `Deployment record update failed (${status}). Check its status in the web console.`,
  lookupFailed: (status: number) => `Deployment record lookup failed (${status}). Check its status in the web console.`,
});
