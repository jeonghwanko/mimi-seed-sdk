import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';

// 구현은 lib/atomic-write.ts 로 승격됐다 — 같은 원자성 보장이 자격증명 writer 에도 필요했는데
// video/ 안에 갇혀 있어서 아무도 쓰지 못하고 있었다. video 쪽 호출부를 위해 이름만 재수출한다.
export { writeJsonAtomic } from '../lib/atomic-write.js';

export function readJson(filePath: string, maxBytes = 20 * 1024 * 1024): unknown {
  try {
    const size = statSync(filePath).size;
    if (size > maxBytes) {
      throw new Error(`JSON 파일이 ${Math.round(maxBytes / 1024 / 1024)}MB 제한을 초과합니다 (${size} bytes).`);
    }
    return JSON.parse(readFileSync(filePath, 'utf8')) as unknown;
  } catch (error) {
    throw new Error(`JSON 파일을 읽거나 파싱할 수 없습니다: ${filePath}`, { cause: error });
  }
}

export function requireAbsolutePath(value: string, label: string): string {
  if (!path.isAbsolute(value)) throw new Error(`${label}은 절대경로여야 합니다.`);
  return path.resolve(value);
}
