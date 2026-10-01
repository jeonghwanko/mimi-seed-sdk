import path from "node:path";

/**
 * Windows `PATH` 의 디렉터리 중 **절대경로만**. `.` · 상대경로 항목을 따르면 현재 폴더(분석 대상 레포)에 놓인
 * 같은 이름의 실행 파일을 고르게 된다. 따옴표로 감싼 항목은 그 안의 `;` 를 구분자로 보지 않는다.
 * 펼쳐지지 않은 `%VAR%` 항목은 절대경로가 아니라 자연히 빠진다.
 */
export function absoluteWindowsPathDirs(env: NodeJS.ProcessEnv = process.env): string[] {
  const key = Object.keys(env).find((k) => k.toLowerCase() === "path");
  const value = key ? env[key] ?? "" : "";
  const dirs: string[] = [];
  let current = "";
  let quoted = false;
  for (const c of value + ";") {
    if (c === '"') quoted = !quoted;
    else if (c === ";" && !quoted) {
      const dir = current.trim();
      if (dir && path.win32.isAbsolute(dir) && !/^[\\/](?![\\/])/.test(dir)) dirs.push(dir);
      current = "";
    } else current += c;
  }
  return dirs;
}
