import { execFileSync } from "node:child_process";

export interface GitCommit {
  hash: string;
  message: string;
  date: string;
  author: string;
}

export function isGitRepo(cwd: string): boolean {
  try {
    execFileSync("git", ["rev-parse", "--git-dir"], { cwd, stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

export function getLatestTag(cwd: string): string | null {
  try {
    return execFileSync("git", ["describe", "--tags", "--abbrev=0"], { cwd, stdio: "pipe" })
      .toString()
      .trim();
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
    out = execFileSync("git", ["log", `--max-count=${limit}`, `--format=${format}`, range, "--"], {
      cwd,
      stdio: "pipe",
    }).toString();
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
