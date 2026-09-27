// 서비스 계정 키 파일 보관소 — ~/.mimi-seed/keys/.
//
// iam_create_key 는 예전에 개인키가 든 JSON 전체를 도구 응답으로 돌려줬다. 그 순간 영구
// 자격증명이 모델 대화 기록(그리고 클라이언트 로그·동기화된 채팅)에 평문으로 남는다.
// 이제 키는 0600 파일로만 존재하고, 소비자(playstore_register_service_account,
// playstore_verify_service_account, jenkins_upload_playstore_sa)는 그 **경로**를 받는다.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { writeCredentialFile } from '#core/atomic-write.js';
import { resolveInsideDir } from '../lib/path-containment.js';

/** 호출 시점에 계산한다 — 테스트가 홈 디렉터리를 바꿀 수 있어야 한다. */
export function serviceAccountKeysDir(): string {
  return path.join(os.homedir(), '.mimi-seed', 'keys');
}

function fileSafe(value: string, fallback: string): string {
  const cleaned = value.replace(/[^A-Za-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 64);
  return cleaned || fallback;
}

/** 원본 바이트 그대로 저장한다 — 재직렬화하면 private_key 의 개행이 깨질 수 있다. */
export function saveServiceAccountKey(json: string, clientEmail: string | undefined, keyId: string | null): string {
  const localPart = fileSafe((clientEmail ?? '').split('@')[0] ?? '', 'service-account');
  const id = fileSafe(keyId ?? '', `key-${Date.now()}`);
  const filePath = path.join(serviceAccountKeysDir(), `${localPart}-${id}.json`);
  writeCredentialFile(filePath, json);
  return filePath;
}

/** ~/.mimi-seed/keys/ 안의 .json 만 읽는다. 그 밖의 경로는 거부. */
export function readServiceAccountKeyFile(filePath: string): string {
  const real = resolveInsideDir(serviceAccountKeysDir(), filePath, {
    label: '서비스 계정 키',
    extensions: ['.json'],
  });
  return fs.readFileSync(real, 'utf8');
}

/**
 * 도구 입력 → SA JSON 원문. 문자열(기존 호환)과 키 파일 경로 중 정확히 하나를 받는다.
 * 경로 쪽을 권장한다 — 문자열로 넘기면 개인키가 도구 호출 인자로 대화에 남는다.
 */
export function resolveServiceAccountJsonInput(input: { json?: string; jsonPath?: string }): string {
  if (input.json && input.jsonPath) {
    throw new Error('serviceAccountJson 과 serviceAccountJsonPath 중 하나만 주세요.');
  }
  if (input.jsonPath) return readServiceAccountKeyFile(input.jsonPath);
  if (input.json) return input.json;
  throw new Error(
    'serviceAccountJsonPath(권장 — iam_create_key 가 돌려준 ~/.mimi-seed/keys/ 경로) 또는 serviceAccountJson 이 필요합니다.',
  );
}
