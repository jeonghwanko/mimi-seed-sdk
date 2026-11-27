import { createHash } from 'node:crypto';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { catalog } from '#core/lang.js';

/**
 * 사람 승인 게이트 — 위험한 호출을 **실행 직전에 사용자에게 직접** 묻는다 (MCP form elicitation).
 *
 * 왜: `confirm: true` 는 모델이 채우는 인자다. 스토어 리뷰·SNS 댓글·Drive 문서처럼 도구가 읽어 온 외부 텍스트에
 * 숨은 지시(프롬프트 인젝션)를 모델이 따르면, 사람이 보지 않은 채 preview → confirm 두 번 호출로 출시·IAM 키
 * 생성·공개 게시가 나간다. elicitation 은 서버가 클라이언트 UI 에 직접 띄우는 대화상자라 모델이 대신 답할 수 없다.
 * 무엇을 묻는지는 레지스트라가 정한다 (확인 플래그가 true 인 호출 + manifest `approval` 도구의 모든 호출).
 *
 * 모드 (`MIMI_SEED_APPROVAL`):
 * - `auto` (기본) — 클라이언트가 form elicitation 을 지원하면 묻고, 지원하지 않으면 예전처럼 실행한다.
 * - `required` — 물을 수 없는 클라이언트에서는 실행을 거부한다. **알 수 없는 값도 이것** — 보안 설정의 오타가
 *   조용히 느슨한 쪽으로 풀리면 안 된다.
 * - `off` — 묻지 않는다. 사람이 없는 자동화(예약 실행·헤드리스)용 — 그 대가로 이 게이트도 없다.
 */

export type ApprovalMode = 'auto' | 'required' | 'off';

export const APPROVAL_ENV = 'MIMI_SEED_APPROVAL';

/** 사용자가 답할 시간. SDK 기본 60초는 미리보기를 읽고 판단하기엔 짧다. */
export const APPROVAL_TIMEOUT_MS = 10 * 60 * 1000;

/**
 * 거절·취소·시간 초과된 **같은 호출**(도구 + 인자)은 이 시간 동안 대화상자 없이 거부한다. 인젝션된 에이전트가
 * 같은 요청을 반복해 사용자가 지쳐 승인하게 만드는 것(approval fatigue)을 막는다. 인자를 바꾼 호출은 다시 묻는다.
 */
export const DECLINE_COOLDOWN_MS = 5 * 60 * 1000;

const A = catalog(
  {
    title: (title: string) => `⚠️ 실행 승인 요청 — ${title}`,
    intro: 'AI 에이전트가 되돌리기 어렵거나 외부에 공개되거나 자격증명을 다루는 작업을 실행하려 한다. 아래 인자가 의도한 것과 같을 때만 승인한다.',
    args: '실행 인자 (문자열은 따옴표·이스케이프 그대로 표시):',
    none: '(없음)',
    truncated: '⚠️ 일부 값이 너무 길어 가운데를 생략했다. 생략된 부분을 확인할 수 없다면 거절한다.',
    approveTitle: '이 작업 실행을 승인합니다',
    approveDescription: '체크하고 확인을 눌러야 실행된다. 거절·취소·체크 해제면 아무것도 바뀌지 않는다.',
    declined: (name: string) =>
      `⛔ 사용자가 \`${name}\` 실행을 승인하지 않아 아무것도 바꾸지 않았다. 자동으로 다시 시도하지 말고, 사용자에게 어떻게 할지 물을 것.`,
    failed: (name: string, reason: string) =>
      `⛔ \`${name}\` 실행 승인을 받지 못해 아무것도 바꾸지 않았다 (${reason}). 자동으로 다시 시도하지 말 것.`,
    cooldown: (name: string, minutes: number) =>
      `⛔ 같은 \`${name}\` 요청을 사용자가 방금 승인하지 않아 다시 묻지 않고 거부했다 (${minutes}분 후 다시 물을 수 있다). 다시 시도하지 말고 사용자에게 물을 것.`,
    busy: (name: string) =>
      `⛔ 다른 승인 요청이 이미 사용자 앞에 열려 있어 \`${name}\` 은(는) 실행하지 않았다. 앞의 요청이 끝난 뒤 사용자에게 물을 것.`,
    unsupported: (name: string, env: string) =>
      `⛔ \`${name}\` 은(는) 사용자 직접 승인이 필요한데, 이 MCP 클라이언트는 승인 대화상자(elicitation)를 지원하지 않는다 (${env}=required). ` +
      `아무것도 바꾸지 않았다. 지원하는 클라이언트에서 실행하거나, 사용자가 ${env} 설정을 바꿔야 한다.`,
    badMode: (env: string, value: string) =>
      `[mimi-seed] ${env}="${value}" 은(는) 알 수 없는 값이라 가장 엄격한 required 로 동작한다 (auto · required · off).`,
    status: (mode: ApprovalMode, can: boolean) =>
      mode === 'off'
        ? 'off — 확정 작업도 묻지 않는다 (무인 실행 설정)'
        : can
          ? `${mode} — 확정 작업마다 이 클라이언트에서 승인 대화상자를 띄운다`
          : mode === 'required'
            ? 'required — 이 클라이언트는 승인 대화상자를 지원하지 않아 확정 작업을 거부한다'
            : 'auto — 이 클라이언트는 승인 대화상자를 지원하지 않아 에이전트의 confirm 만으로 실행한다 (사람 확인 없음)',
  },
  {
    title: (title: string) => `⚠️ Approval needed — ${title}`,
    intro: 'An AI agent is about to run an action that is hard to undo, publishes externally, or handles credentials. Approve only if the arguments below are what you intended.',
    args: 'Arguments (strings shown quoted and escaped):',
    none: '(none)',
    truncated: '⚠️ Some values were too long and their middle is omitted. Decline if you cannot check the omitted part.',
    approveTitle: 'I approve running this action',
    approveDescription: 'It runs only if this is checked and you confirm. Declining, cancelling, or leaving it unchecked changes nothing.',
    declined: (name: string) =>
      `⛔ The user did not approve \`${name}\`, so nothing was changed. Do not retry automatically — ask the user how to proceed.`,
    failed: (name: string, reason: string) =>
      `⛔ Could not get approval for \`${name}\`, so nothing was changed (${reason}). Do not retry automatically.`,
    cooldown: (name: string, minutes: number) =>
      `⛔ The user just did not approve this same \`${name}\` request, so it was refused without asking again (it can be asked again in ${minutes} min). Do not retry — ask the user.`,
    busy: (name: string) =>
      `⛔ Another approval request is already open in front of the user, so \`${name}\` did not run. Ask the user after that one is answered.`,
    unsupported: (name: string, env: string) =>
      `⛔ \`${name}\` needs the user's direct approval, but this MCP client does not support approval dialogs (elicitation) (${env}=required). ` +
      `Nothing was changed. Run it from a client that supports them, or the user must change ${env}.`,
    badMode: (env: string, value: string) =>
      `[mimi-seed] Unknown ${env}="${value}"; using the strictest mode, required (auto · required · off).`,
    status: (mode: ApprovalMode, can: boolean) =>
      mode === 'off'
        ? 'off — confirmed actions are not asked about (unattended setting)'
        : can
          ? `${mode} — every confirmed action opens an approval dialog in this client`
          : mode === 'required'
            ? 'required — this client has no approval dialog, so confirmed actions are refused'
            : 'auto — this client has no approval dialog, so the agent’s confirm alone runs them (no human check)',
  },
);

let warnedValue: string | undefined;

export function approvalMode(env: NodeJS.ProcessEnv = process.env): ApprovalMode {
  const raw = env[APPROVAL_ENV]?.trim().toLowerCase();
  if (!raw) return 'auto';
  if (raw === 'auto' || raw === 'required' || raw === 'off') return raw;
  if (warnedValue !== raw) {
    warnedValue = raw;
    // stdout 은 MCP 프로토콜 전용 — 진단은 stderr.
    process.stderr.write(`${A().badMode(APPROVAL_ENV, raw)}\n`);
  }
  return 'required';
}

/** `mimi_seed_status` 한 줄 — 팀이 게이트가 실제로 살아 있는지 확인할 수 있게. */
export function describeApproval(status: { mode: ApprovalMode; clientCanElicit: boolean }): string {
  return A().status(status.mode, status.clientCanElicit);
}

/** 클라이언트가 form elicitation 을 선언했는가. SDK 가 빈 `elicitation: {}` 를 `{ form: {} }` 로 정규화한다. */
export function clientCanElicit(server: McpServer): boolean {
  return Boolean(server.server.getClientCapabilities()?.elicitation?.form);
}

const refuse = (text: string): CallToolResult => ({ isError: true, content: [{ type: 'text', text }] });

/** 서버(프로세스)마다의 상태 — stdio 서버 하나는 클라이언트 하나를 섬긴다. 테스트가 서버마다 새로 만든다. */
interface GateState {
  pending: boolean;
  refusedUntil: Map<string, number>;
}
const states = new WeakMap<McpServer, GateState>();
const stateOf = (server: McpServer): GateState => {
  let s = states.get(server);
  if (!s) states.set(server, (s = { pending: false, refusedUntil: new Map() }));
  return s;
};

const callKey = (name: string, args: Record<string, unknown>) =>
  createHash('sha256').update(name).update('\0').update(JSON.stringify(args)).digest('hex');

export interface ApprovalCall {
  name: string;
  title: string;
  /** 실행 인자 원본 — 쿨다운 키에만 쓴다 (화면에는 argLines). */
  args: Record<string, unknown>;
  /** 비밀을 가리고 이스케이프한 인자 줄 (tool-registrar 의 approvalArgLines). */
  argLines: string[];
  /** 어떤 값의 가운데를 생략했는가. */
  truncated: boolean;
}

/** 승인되면 `null`, 아니면 실행 대신 돌려줄 결과. */
export async function requestHumanApproval(
  server: McpServer,
  call: ApprovalCall,
  options: { signal?: AbortSignal; mode?: ApprovalMode; now?: () => number } = {},
): Promise<CallToolResult | null> {
  const mode = options.mode ?? approvalMode();
  if (mode === 'off') return null;
  if (!clientCanElicit(server)) {
    return mode === 'required' ? refuse(A().unsupported(call.name, APPROVAL_ENV)) : null;
  }

  const m = A();
  const now = options.now ?? Date.now;
  const state = stateOf(server);
  const key = callKey(call.name, call.args);
  const until = state.refusedUntil.get(key);
  if (until !== undefined && until > now()) {
    return refuse(m.cooldown(call.name, Math.ceil((until - now()) / 60_000)));
  }
  // 대화상자는 한 번에 하나 — 동시에 여러 개를 띄워 하나쯤 승인되길 노리는 호출을 막는다.
  if (state.pending) return refuse(m.busy(call.name));

  const message = [
    m.title(call.title),
    '',
    m.intro,
    ...(call.truncated ? ['', m.truncated] : []),
    '',
    m.args,
    ...(call.argLines.length ? call.argLines : [`  ${m.none}`]),
  ].join('\n');

  state.pending = true;
  try {
    const result = await server.server.elicitInput(
      {
        mode: 'form',
        message,
        requestedSchema: {
          type: 'object',
          properties: { approve: { type: 'boolean', title: m.approveTitle, description: m.approveDescription } },
          required: ['approve'],
        },
      },
      { timeout: APPROVAL_TIMEOUT_MS, signal: options.signal },
    );
    // accept 만으로는 부족하다 — 체크박스까지 true 여야 한다 (엔터 한 번에 실행되지 않게).
    if (result.action === 'accept' && result.content?.approve === true) {
      state.refusedUntil.delete(key);
      return null;
    }
    state.refusedUntil.set(key, now() + DECLINE_COOLDOWN_MS);
    return refuse(m.declined(call.name));
  } catch (e) {
    // 지원을 선언한 클라이언트에서의 실패(타임아웃·취소·응답 오류)는 모드와 무관하게 거부한다 — 실패를 승인으로 치지 않는다.
    state.refusedUntil.set(key, now() + DECLINE_COOLDOWN_MS);
    return refuse(m.failed(call.name, e instanceof Error ? e.message : String(e)));
  } finally {
    state.pending = false;
  }
}
