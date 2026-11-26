// AdMob API 에러 친절화. playstore/errors.ts 와 같은 역할.
//
// 핵심 케이스: 토큰도 admob 스코프도 정상인데 AdMob 이 요청을 거부하는 경우.
// AdMob 은 로그인한 Google 계정이 어떤 AdMob 계정의 사용자도 아니면 401 UNAUTHENTICATED
// ("Request is missing required authentication credential") 를 돌려준다 — 메시지만 보면
// 토큰이 안 붙은 것처럼 읽혀 SDK 버그나 만료로 오진하게 된다. 실제 해법은 "AdMob 계정에
// 등록된 Google 계정으로 다시 로그인" 이므로, 지금 로그인한 계정을 이름으로 보여 준다.
// 인식 못 한 에러는 원본을 그대로 보존한다.

import { extractHttpStatus, authReauthMessage, withCause, googleErrorDetail, rawMessage } from '../lib/google-errors.js';
import { catalog } from '#core/lang.js';

const M = catalog(
  {
    relogin: [
      'AdMob 계정에 사용자로 등록된 Google 계정으로 다시 로그인하세요 (계정 선택 화면에서 그 계정을 고르면 됩니다):',
      '  mimi_seed_auth_start(domains=["admob"])',
      '  또는 터미널: npx -y @yoonion/mimi-seed-mcp mimi-seed-auth --domains admob',
      'ℹ️ 기본 로그인은 한 계정만 담습니다. 다른 계정으로 바꾸면 그 계정 기준으로 권한이 다시 잡히니,',
      '   다른 도구에 필요한 권한 도메인이 있으면 domains 에 함께 넣으세요. 결과는 mimi_seed_auth_status 로 확인합니다.',
    ],
    current: (email: string) => `현재 로그인 계정(${email})`,
    currentGoogle: '현재 로그인한 Google 계정',
    unauth: (who: string) => `❌ ${who}으로는 AdMob 에 접근할 수 없어요 (401).`,
    unauthWhy: '토큰과 admob 권한은 유효합니다. AdMob 은 이 계정이 어떤 AdMob 계정의 사용자도 아닐 때 이렇게 거부합니다.',
    forbidden: (who: string) => `❌ AdMob 403 — ${who}에 이 작업 권한이 없어요.`,
    reason: (d: string) => `Google 사유: ${d}`,
    checkRole: '→ AdMob 콘솔 → 설정 → 사용자 에서 이 계정의 역할을 확인하거나, 권한 있는 계정으로 다시 로그인하세요.',
  },
  {
    relogin: [
      'Log in again with the Google account registered as a user of the AdMob account (pick that account on the account chooser):',
      '  mimi_seed_auth_start(domains=["admob"])',
      '  or in a terminal: npx -y @yoonion/mimi-seed-mcp mimi-seed-auth --domains admob',
      'ℹ️ The default login holds a single account. Switching accounts resets permissions to that account,',
      '   so include in domains any permission domains other tools need. Check the result with mimi_seed_auth_status.',
    ],
    current: (email: string) => `the current login account (${email})`,
    currentGoogle: 'the currently logged-in Google account',
    unauth: (who: string) => `❌ AdMob cannot be accessed with ${who} (401).`,
    unauthWhy: 'The token and the admob permission are valid. AdMob rejects like this when the account is not a user of any AdMob account.',
    forbidden: (who: string) => `❌ AdMob 403 — ${who} does not have permission for this operation.`,
    reason: (d: string) => `Google reason: ${d}`,
    checkRole: "→ Check this account's role under AdMob console → Settings → Users, or log in again with an account that has permission.",
  },
);


function accountLabel(accountEmail: string | null | undefined): string {
  return accountEmail ? M().current(accountEmail) : M().currentGoogle;
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
        M().unauth(accountLabel(accountEmail)),
        M().unauthWhy,
        '',
        M().relogin.join('\n'),
      ].join('\n')),
      e,
    );
  }
  if (status === 403 || /PERMISSION_DENIED/i.test(text)) {
    const detail = googleErrorDetail(e);
    const lines = [M().forbidden(accountLabel(accountEmail))];
    if (detail) lines.push(M().reason(detail));
    lines.push(
      M().checkRole,
      '',
      M().relogin.join('\n'),
    );
    return withCause(new Error(lines.join('\n')), e);
  }
  return e instanceof Error ? e : new Error(text);
}
