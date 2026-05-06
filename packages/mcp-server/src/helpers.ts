import { getAuthenticatedClient, ensureFreshAccessToken } from './auth/google-auth.js';
import { getServiceAccountClient, getServiceAccountJson } from './auth/playstore-auth.js';
import { getAppStoreCredentials } from './appstore/auth.js';

export { ensureFreshAccessToken };

export function requireAuth() {
  const client = getAuthenticatedClient();
  if (!client) {
    throw new Error(
      [
        '❌ Google 계정이 연결되지 않았어.',
        '',
        '터미널에서 이것만 실행하면 돼:',
        '',
        '  npx -y @yoonion/mimi-seed-mcp mimi-seed-auth',
        '',
        '브라우저가 열리면 Google 로그인 → 끝.',
        '그 다음에 다시 물어봐줘.',
      ].join('\n')
    );
  }
  return client;
}

export const PLAY_AUTH_HINT = [
  '❌ Google Play 서비스 계정이 연결되지 않았어.',
  '',
  '터미널에서 이것만 실행하면 돼:',
  '',
  '  npx -y @yoonion/mimi-seed-mcp mimi-seed-playstore-auth',
  '',
  '서비스 계정 JSON 파일 경로를 입력하면 저장 완료.',
  '그 다음에 다시 물어봐줘.',
].join('\n');

export const APPSTORE_AUTH_HINT = [
  '❌ App Store Connect 인증이 설정되지 않았어.',
  '',
  '터미널에서 이것만 실행하면 돼:',
  '',
  '  npx -y @yoonion/mimi-seed-mcp mimi-seed-appstore-auth',
  '',
  'Issuer ID, Key ID, .p8 파일 경로를 입력하면 저장 완료.',
  '그 다음에 다시 물어봐줘.',
].join('\n');

export function requirePlayStoreAuth(packageName?: string) {
  const client = getServiceAccountClient(packageName);
  if (!client) throw new Error(PLAY_AUTH_HINT);
  return client;
}

export function requireServiceAccountJson(packageName?: string): string {
  const json = getServiceAccountJson(packageName);
  if (!json) throw new Error(PLAY_AUTH_HINT);
  return json;
}

export function requireAppStoreCreds() {
  const creds = getAppStoreCredentials();
  if (!creds) throw new Error(APPSTORE_AUTH_HINT);
  return creds;
}
