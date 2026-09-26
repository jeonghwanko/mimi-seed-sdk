// AdMob API 에러 친절화. playstore/errors.ts 와 같은 역할.
//
// 핵심 케이스: 토큰도 admob 스코프도 정상인데 AdMob 이 요청을 거부하는 경우.
// AdMob 은 로그인한 Google 계정이 어떤 AdMob 계정의 사용자도 아니면 401 UNAUTHENTICATED
// ("Request is missing required authentication credential") 를 돌려준다 — 메시지만 보면
// 토큰이 안 붙은 것처럼 읽혀 SDK 버그나 만료로 오진하게 된다. 실제 해법은 "AdMob 계정에
// 등록된 Google 계정으로 다시 로그인" 이므로, 지금 로그인한 계정을 이름으로 보여 준다.
// 인식 못 한 에러는 원본을 그대로 보존한다.

import { extractHttpStatus, authReauthMessage, withCause, googleErrorDetail, rawMessage } from '../lib/google-errors.js';

const RELOGIN = [
  'AdMob 계정에 사용자로 등록된 Google 계정으로 다시 로그인하세요 (계정 선택 화면에서 그 계정을 고르면 됩니다):',
  '  mimi_seed_auth_start(domains=["admob"])',
  '  또는 터미널: npx -y @yoonion/mimi-seed-mcp mimi-seed-auth --domains admob',
  'ℹ️ 기본 로그인은 한 계정만 담습니다. 다른 계정으로 바꾸면 그 계정 기준으로 권한이 다시 잡히니,',
  '   다른 도구에 필요한 권한 도메인이 있으면 domains 에 함께 넣으세요. 결과는 mimi_seed_auth_status 로 확인합니다.',
].join('\n');

function accountLabel(accountEmail: string | null | undefined): string {
  return accountEmail ? `현재 로그인 계정(${accountEmail})` : '현재 로그인한 Google 계정';
}

export function friendlyAdmobError(e: unknown, accountEmail?: string | null): Error {
  const text = rawMessage(e);
  const status = extractHttpStatus(e);

  // 스코프 부족·refresh 만료는 공통 재로그인 안내가 정확하다.
  const reauth = authReauthMessage(text);
  if (reauth) return withCause(new Error(reauth), e);

  if (status === 401 || /UNAUTHENTICATED|missing required authentication credential/i.test(text)) {
    return withCause(
      new Error([
        `❌ ${accountLabel(accountEmail)}으로는 AdMob 에 접근할 수 없어요 (401).`,
        '토큰과 admob 권한은 유효합니다. AdMob 은 이 계정이 어떤 AdMob 계정의 사용자도 아닐 때 이렇게 거부합니다.',
        '',
        RELOGIN,
      ].join('\n')),
      e,
    );
  }
  if (status === 403 || /PERMISSION_DENIED/i.test(text)) {
    const detail = googleErrorDetail(e);
    const lines = [`❌ AdMob 403 — ${accountLabel(accountEmail)}에 이 작업 권한이 없어요.`];
    if (detail) lines.push(`Google 사유: ${detail}`);
    lines.push(
      '→ AdMob 콘솔 → 설정 → 사용자 에서 이 계정의 역할을 확인하거나, 권한 있는 계정으로 다시 로그인하세요.',
      '',
      RELOGIN,
    );
    return withCause(new Error(lines.join('\n')), e);
  }
  return e instanceof Error ? e : new Error(text);
}
