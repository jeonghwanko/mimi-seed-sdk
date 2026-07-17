import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export function writeJsonAtomic(filePath: string, value: unknown): void {
  mkdirSync(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  try {
    writeFileSync(tempPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
    renameSync(tempPath, filePath);
  } catch (error) {
    try {
      unlinkSync(tempPath);
    } catch {
      // The temp file may not have been created or may already have been renamed.
    }
    throw error;
  }
}

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
