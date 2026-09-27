import fs from 'node:fs';
import path from 'node:path';

/**
 * playstore_upload_data_safety 의 입력 해석 — CSV 원문(csv) 또는 절대경로(csvPath) 중 하나.
 *
 * 파일 IO 는 register 가 아니라 여기서 한다. 친절 에러 프록시(wrapDomain)를 거치지 않고
 * 직접 호출되므로, 입력 오류와 파일 읽기 오류(ENOENT 등)는 원문 그대로 올라간다.
 */
export function readDataSafetyCsv(input: { csv?: string; csvPath?: string }): string {
  const { csv, csvPath } = input;
  if (!csv && !csvPath) throw new Error('csvPath 또는 csv 중 하나는 필요하다.');
  if (!csv && csvPath && !path.isAbsolute(csvPath)) {
    throw new Error(`csvPath 는 절대경로여야 한다: ${csvPath}`);
  }
  return csv ?? fs.readFileSync(csvPath as string, 'utf8');
}
