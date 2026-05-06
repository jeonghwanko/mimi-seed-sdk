import { execSync } from "node:child_process";

export interface GitCommit {
  hash: string;
  message: string;
  date: string;
  author: string;
}

export function isGitRepo(cwd: string): boolean {
  try {
    execSync("git rev-parse --git-dir", { cwd, stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

export function getLatestTag(cwd: string): string | null {
  try {
    return execSync("git describe --tags --abbrev=0", { cwd, stdio: "pipe" })
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
  const range = from ? `${from}..${to}` : to;
  const format = "%H\x1f%s\x1f%ci\x1f%an";
  const limitFlag = `--max-count=${limit}`;

  let out: string;
  try {
    out = execSync(`git log ${limitFlag} --format="${format}" ${range}`, {
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
