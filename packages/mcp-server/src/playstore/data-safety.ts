import fs from 'node:fs';
import path from 'node:path';
import type { OAuth2Client, JWT } from 'google-auth-library';
import { publisher } from './edits.js';
import { catalog } from '#core/lang.js';

const M = catalog(
  {
    needInput: 'csvPath 또는 csv 중 하나는 필요하다.',
    notAbsolute: (p: string) => `csvPath 는 절대경로여야 한다: ${p}`,
    empty: 'safetyLabels CSV 가 비어 있다.',
    notCsv: 'CSV 로 보이지 않는다 — Play Console 에서 받은 데이터 안전 CSV 원문을 그대로 넣을 것.',
  },
  {
    needInput: 'Either csvPath or csv is required.',
    notAbsolute: (p: string) => `csvPath must be an absolute path: ${p}`,
    empty: 'The safetyLabels CSV is empty.',
    notCsv: 'This does not look like CSV — pass the data safety CSV downloaded from Play Console, unmodified.',
  },
);

/**
 * playstore_upload_data_safety 의 입력 해석 — CSV 원문(csv) 또는 절대경로(csvPath) 중 하나.
 *
 * 파일 IO 는 register 가 아니라 여기서 한다. 친절 에러 프록시(wrapDomain)를 거치지 않고
 * 직접 호출되므로, 입력 오류와 파일 읽기 오류(ENOENT 등)는 원문 그대로 올라간다.
 */
export function readDataSafetyCsv(input: { csv?: string; csvPath?: string }): string {
  const { csv, csvPath } = input;
  if (!csv && !csvPath) throw new Error(M().needInput);
  if (!csv && csvPath && !path.isAbsolute(csvPath)) {
    throw new Error(M().notAbsolute(csvPath));
  }
  return csv ?? fs.readFileSync(csvPath as string, 'utf8');
}

// ─── 데이터 안전(Safety Labels) 선언 ───
//
// 오랫동안 Console 전용이라고 알려졌지만 API 가 생겼다 (POST applications/{pkg}/dataSafety).
// 입력은 **Play Console 이 내려주는 CSV 원문**이고, 기존 제출을 통째로 덮어쓴다 —
// 부분 갱신이 아니므로 항상 최신 전체 CSV 를 보내야 한다.
// 콘텐츠 등급·타깃 연령 설문은 여전히 API 가 없다 (Console 전용).

export async function uploadDataSafety(
  auth: OAuth2Client | JWT,
  packageName: string,
  safetyLabelsCsv: string,
): Promise<{ packageName: string; bytes: number; lines: number }> {
  const csv = safetyLabelsCsv.trim();
  if (!csv) throw new Error(M().empty);
  if (!csv.includes(',')) {
    throw new Error(M().notCsv);
  }

  await publisher().applications.dataSafety({
    auth,
    packageName,
    requestBody: { safetyLabels: csv },
  });

  return { packageName, bytes: Buffer.byteLength(csv, 'utf8'), lines: csv.split('\n').length };
}
