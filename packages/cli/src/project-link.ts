import fs from "node:fs/promises";
import path from "node:path";
import type { AppHint } from "./detect.js";
import { catalog } from "./i18n.js";

export const PROJECT_LINK_FILENAME = ".mimi-seed-link.json";

const M = catalog({
  lookupFailed: (status: number) => `프로젝트 앱 연결 조회 실패 (${status}). --app <id>로 지정하세요.`,
  invalidResponse: "프로젝트 앱 연결 응답이 올바르지 않습니다.",
  mismatch: "저장된 프로젝트 앱 연결이 현재 계정·앱과 다릅니다. 연결 파일을 확인하세요.",
  invalidFile: "프로젝트 앱 연결 파일이 올바르지 않습니다.",
}, {
  lookupFailed: (status: number) => `Project app lookup failed (${status}). Specify --app <id>.`,
  invalidResponse: "Invalid project app lookup response.",
  mismatch: "Saved project app link differs from the current account or app. Check the link file.",
  invalidFile: "Invalid project app link file.",
});

export interface ProjectLink {
  schema: 1;
  webBase: string;
  appId: string;
  packageName?: string;
  bundleId?: string;
}

function base(value: string): string {
  return value.replace(/\/+$/, "");
}

function isLink(value: unknown): value is ProjectLink {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const link = value as Record<string, unknown>;
  return link.schema === 1 && typeof link.webBase === "string" && !!link.webBase &&
    typeof link.appId === "string" && !!link.appId &&
    (link.packageName === undefined || typeof link.packageName === "string") &&
    (link.bundleId === undefined || typeof link.bundleId === "string");
}

export async function findProjectLink(cwd: string): Promise<ProjectLink | null> {
  let dir = path.resolve(cwd);
  for (let depth = 0; depth <= 8; depth++) {
    const file = path.join(dir, PROJECT_LINK_FILENAME);
    try {
      const parsed: unknown = JSON.parse(await fs.readFile(file, "utf8"));
      if (!isLink(parsed)) throw new Error(M().invalidFile);
      return parsed;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

export function resolveLinkedAppId(link: ProjectLink | null, webBase: string, explicitAppId?: string): string | undefined {
  if (!link) return explicitAppId;
  if (base(link.webBase) !== base(webBase) || (explicitAppId && explicitAppId !== link.appId)) {
    throw new Error(M().mismatch);
  }
  return link.appId;
}

export function validateProjectIdentity(link: ProjectLink | null, hints: AppHint[]): void {
  if (!link || hints.length === 0) return;
  if (!hints.every(hint =>
    (!hint.packageName || hint.packageName === link.packageName) &&
    (!hint.bundleId || hint.bundleId === link.bundleId))) {
    throw new Error(M().mismatch);
  }
}

export async function linkProject(
  cwd: string,
  webBase: string,
  token: string,
  hint: AppHint,
): Promise<ProjectLink> {
  const res = await fetch(new URL("/api/deploy/link", webBase), {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ packageName: hint.packageName, bundleId: hint.bundleId }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(M().lookupFailed(res.status));
  const value: unknown = await res.json();
  const app = (value && typeof value === "object" && "app" in value) ? value.app : null;
  if (!app || typeof app !== "object" || !("id" in app) || typeof app.id !== "string" || !app.id ||
      (hint.packageName && (!("packageName" in app) || app.packageName !== hint.packageName)) ||
      (hint.bundleId && (!("bundleId" in app) || app.bundleId !== hint.bundleId))) {
    throw new Error(M().invalidResponse);
  }
  const link: ProjectLink = {
    schema: 1,
    webBase: base(webBase),
    appId: app.id,
    ...(hint.packageName ? { packageName: hint.packageName } : {}),
    ...(hint.bundleId ? { bundleId: hint.bundleId } : {}),
  };
  const existing = await findProjectLink(cwd);
  if (existing && (existing.appId !== link.appId || base(existing.webBase) !== link.webBase ||
      existing.packageName !== link.packageName || existing.bundleId !== link.bundleId)) {
    throw new Error(M().mismatch);
  }
  if (!existing) {
    await fs.writeFile(path.join(cwd, PROJECT_LINK_FILENAME), `${JSON.stringify(link, null, 2)}\n`, { mode: 0o600, flag: "wx" });
  }
  const ignorePath = path.join(cwd, ".gitignore");
  const ignore = await fs.readFile(ignorePath, "utf8").catch((error: NodeJS.ErrnoException) => {
    if (error.code !== "ENOENT") throw error;
    return "";
  });
  if (!ignore.split(/\r?\n/).includes(PROJECT_LINK_FILENAME)) {
    await fs.appendFile(ignorePath, `${ignore && !ignore.endsWith("\n") ? "\n" : ""}${PROJECT_LINK_FILENAME}\n`);
  }
  return link;
}
