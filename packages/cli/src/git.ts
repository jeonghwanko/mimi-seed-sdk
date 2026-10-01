import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

export interface GitCommit {
  hash: string;
  message: string;
  date: string;
  author: string;
}

/**
 * 실행할 git. Windows 는 이름만 주면 현재 폴더(= 분석 대상 레포)의 git.exe 를 PATH 보다 먼저 찾으므로,
 * PATH 의 절대경로 디렉터리에서만 git.exe 를 고른다. 못 찾으면 null — git 이 없는 것으로 다룬다.
 */
export function gitBinary(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
  exists: (file: string) => boolean = fs.existsSync,
): string | null {
  if (platform !== "win32") return "git";
  for (const entry of (env.PATH ?? env.Path ?? "").split(";")) {
    const dir = entry.trim().replace(/^"(.*)"$/, "$1");
    if (!dir || !path.win32.isAbsolute(dir)) continue;
    const candidate = path.win32.join(dir, "git.exe");
    if (exists(candidate)) return candidate;
  }
  return null;
}

function git(cwd: string, args: string[]): string {
  const bin = gitBinary();
  if (!bin) throw new Error("git not found on PATH");
  return execFileSync(bin, args, { cwd, stdio: "pipe" }).toString();
}

export function isGitRepo(cwd: string): boolean {
  try {
    git(cwd, ["rev-parse", "--git-dir"]);
    return true;
  } catch {
    return false;
  }
}

export function getLatestTag(cwd: string): string | null {
  try {
    return git(cwd, ["describe", "--tags", "--abbrev=0"]).trim();
  } catch {
    return null;
  }
}

export function getGitLog(
  cwd: string,
  opts: { from?: string; to?: string; limit?: number } = {},
): GitCommit[] {
  const { from, to = "HEAD", limit = 30 } = opts;
  // ref 는 --from/--to 인자나 레포의 태그 이름에서 온다. 태그 이름엔 `$(…)`·`;`·`|` 가 허용되므로
  // 셸을 거치지 않는다. `-` 로 시작하면 git 이 옵션(`--output=…`)으로 읽으니 여기서 거부한다 —
  // `--end-of-options` 는 git 2.24+ 라 그 전 버전에선 조용히 커밋 0개가 된다. 끝의 `--` 는 경로와 구분.
  if (from?.startsWith("-") || to.startsWith("-")) return [];
  const range = from ? `${from}..${to}` : to;
  const format = "%H\x1f%s\x1f%ci\x1f%an";

  let out: string;
  try {
    out = git(cwd, ["log", `--max-count=${limit}`, `--format=${format}`, range, "--"]);
  } catch {
    return [];
  }

  return out
    .split("\n")
    .filter((l) => l.trim())
    .map((line) => {
      const [hash, message, date, author] = line.split("\x1f");
      return { hash: hash?.slice(0, 8) ?? "", message: message ?? "", date: date ?? "", author: author ?? "" };
    })
    .filter((c) => c.hash && c.message);
}

export function formatCommitsForPrompt(commits: GitCommit[]): string {
  return commits.map((c) => `- ${c.message} (${c.author}, ${c.date.slice(0, 10)})`).join("\n");
}
