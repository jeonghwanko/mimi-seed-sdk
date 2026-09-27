import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// `mimi-seed --version` 은 예전에 "알 수 없는 명령" 을 찍고 exit 1 로 끝났다 — CI 스크립트와
// 사용자가 설치 버전을 확인하는 가장 흔한 방법이 실패했다. 라우터(src/index.ts)를 실제로 실행해 확인한다.
const cliRoot = fileURLToPath(new URL("../..", import.meta.url));
const entry = fileURLToPath(new URL("../index.ts", import.meta.url));
const { version } = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")) as { version: string };

function run(arg: string) {
  return spawnSync(process.execPath, ["--import", "tsx", entry, arg], {
    cwd: cliRoot,
    encoding: "utf8",
    env: { ...process.env, MIMI_SEED_TELEMETRY: "0", NO_COLOR: "1" },
    timeout: 60_000,
  });
}

describe("mimi-seed --version", () => {
  it.each(["--version", "-v", "version"])("%s 는 버전만 출력하고 0 으로 끝난다", (arg) => {
    const result = run(arg);
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout.trim()).toBe(version);
  }, 60_000);
});
