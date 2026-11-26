import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { catalog } from '#core/lang.js';

const M = catalog(
  {
    tooLarge: (mb: number, size: number) => `JSON 파일이 ${mb}MB 제한을 초과합니다 (${size} bytes).`,
    unreadable: (filePath: string) => `JSON 파일을 읽거나 파싱할 수 없습니다: ${filePath}`,
    notAbsolute: (label: string) => `${label}은 절대경로여야 합니다.`,
  },
  {
    tooLarge: (mb: number, size: number) => `The JSON file exceeds the ${mb}MB limit (${size} bytes).`,
    unreadable: (filePath: string) => `Cannot read or parse the JSON file: ${filePath}`,
    notAbsolute: (label: string) => `${label} must be an absolute path.`,
  },
);

// 구현은 packages/core 의 atomic-write.ts 로 승격됐다 — 같은 원자성 보장이 자격증명 writer 에도 필요했는데
// video/ 안에 갇혀 있어서 아무도 쓰지 못하고 있었다. video 쪽 호출부를 위해 이름만 재수출한다.
export { writeJsonAtomic } from '#core/atomic-write.js';

export function readJson(filePath: string, maxBytes = 20 * 1024 * 1024): unknown {
  try {
    const size = statSync(filePath).size;
    if (size > maxBytes) {
      throw new Error(M().tooLarge(Math.round(maxBytes / 1024 / 1024), size));
    }
    return JSON.parse(readFileSync(filePath, 'utf8')) as unknown;
  } catch (error) {
    throw new Error(M().unreadable(filePath), { cause: error });
  }
}

export function requireAbsolutePath(value: string, label: string): string {
  if (!path.isAbsolute(value)) throw new Error(M().notAbsolute(label));
  return path.resolve(value);
}
