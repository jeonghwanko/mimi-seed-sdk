import { existsSync, readFileSync } from 'node:fs';
import { serviceAccountPathForPackage } from '../auth/playstore-auth.js';
import { readServiceAccountKeyFile } from '../iam/key-files.js';

/**
 * jenkins_upload_playstore_sa 가 올릴 Play 서비스 계정 JSON 을 고른다.
 *
 * - explicitPath 가 있으면 iam_create_key 가 저장한 키 파일(~/.mimi-seed/keys/ 안만 허용)을 읽는다.
 * - 없으면 패키지별 등록 SA(~/.mimi-seed/play-service-accounts/<pkg>.json)를 읽는다. 그 파일이
 *   없으면 `found: false` 로 경로만 돌려준다 — register 가 "먼저 setup_playstore_connection" 을 안내한다.
 *
 * clientEmail 은 안내문용이다. JSON 이 깨져 있어도 업로드 자체는 막지 않는다 (예전 동작 그대로).
 */
export type PlayServiceAccountSource =
  | { found: false; path: string }
  | { found: true; raw: string; clientEmail: string };

export function loadPlayServiceAccountForUpload(
  packageName: string,
  explicitPath?: string,
): PlayServiceAccountSource {
  const saPath = explicitPath ?? serviceAccountPathForPackage(packageName);
  if (!explicitPath && !existsSync(saPath)) return { found: false, path: saPath };

  const raw = explicitPath ? readServiceAccountKeyFile(explicitPath) : readFileSync(saPath, 'utf-8');
  let clientEmail = '(파싱 실패)';
  try {
    clientEmail = (JSON.parse(raw) as { client_email?: string }).client_email ?? clientEmail;
  } catch { /* ignore */ }
  return { found: true, raw, clientEmail };
}
