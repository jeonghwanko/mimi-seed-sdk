// 경로 봉쇄 — 호출자가 준 파일 경로를 "이 디렉터리 안의 파일"로만 받아들인다.
//
// 비밀값을 대화 기록에 싣지 않으려고 도구들이 "값" 대신 "파일 경로"를 받게 됐다
// (iam_create_key → ~/.mimi-seed/keys/, android_generate_keystore → ~/.mimi-seed/keystores/).
// 경로를 받는 순간 그 도구는 임의 파일을 읽어 Jenkins 등 외부로 보내는 통로가 될 수 있으므로,
// 우리가 직접 쓴 디렉터리 안쪽만 허용한다. 심볼릭 링크로 빠져나가는 경우까지 막으려고
// 양쪽 모두 realpath 로 비교한다.

import fs from 'node:fs';
import path from 'node:path';

export function resolveInsideDir(
  baseDir: string,
  candidate: string,
  options: { label: string; extensions?: string[] },
): string {
  if (!path.isAbsolute(candidate)) {
    throw new Error(`${options.label} 경로는 절대경로여야 합니다: ${candidate}`);
  }
  let base: string;
  let real: string;
  try {
    base = fs.realpathSync(baseDir);
  } catch {
    throw new Error(`${options.label}: ${baseDir} 가 없습니다 — 이 도구가 만든 파일만 사용할 수 있습니다.`);
  }
  try {
    real = fs.realpathSync(candidate);
  } catch {
    throw new Error(`${options.label} 파일이 없습니다: ${candidate}`);
  }
  const rel = path.relative(base, real);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error(`${options.label} 파일은 ${baseDir} 안에 있어야 합니다: ${candidate}`);
  }
  if (!fs.statSync(real).isFile()) {
    throw new Error(`${options.label} 경로가 파일이 아닙니다: ${candidate}`);
  }
  if (options.extensions && !options.extensions.includes(path.extname(real).toLowerCase())) {
    throw new Error(`${options.label} 파일 확장자는 ${options.extensions.join(', ')} 중 하나여야 합니다: ${candidate}`);
  }
  return real;
}
