// Jenkins 빌드 실행·추적 — jenkins_trigger_build / jenkins_get_queue_item / jenkins_get_build_status.
//
// 트리거는 **로컬 영속 at-most-once 발송**이다 (Jenkins 쪽 exactly-once 가 아니다). 호출자가 준 request_id 마다
// ~/.mimi-seed/jenkins-build-requests/<key>/ 디렉터리를 mkdir 로 원자적으로 예약하고, 그 안의 receipt.json 에
// 결과를 남긴다. POST 를 보낼 수 있는 시점부터는 예약을 지우지 않는다 — POST 직후 프로세스가 죽어도 같은
// request_id 재호출이 재전송이 되면 안 된다. POST 전에 실패하면(receipt 저장·crumb 조회) 예약을 풀고 던진다.
// receipt 에는 HMAC 지문과 제한된 응답 메타데이터만 남긴다. 파라미터 원문·토큰은 절대 저장하지 않는다.
//
// confirm 가드와의 관계: 이 도구는 manifest 의 destructive 이고 레지스트라가 confirm 을 주입한다. confirm 없는
// 호출은 핸들러까지 오지 않으므로(= triggerBuild 가 불리지 않으므로) request_id 를 예약하지도, receipt 를 쓰지도
// 않는다. dry-run 으로 본 인자 그대로 confirm: true 를 붙여 부르면 그때 처음 한 번 예약·발송된다.

import { createHash, createHmac, randomBytes, randomUUID } from 'node:crypto';
import { linkSync, mkdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { z } from 'zod';
import { CREDENTIAL_DIR_MODE, writeCredentialFile, writeCredentialJson } from '#core/atomic-write.js';
import type { JenkinsConfig } from './config.js';
import { authHeaders, isStrictJobPath, jobUrl, requestCrumb } from './http.js';
import { fetchWithTimeout } from '../lib/http.js';
import { encodePathSegment } from '../lib/url-path.js';

export const buildJobSchema = z
  .string()
  .min(1)
  .max(1024)
  .refine(isStrictJobPath, '잡 경로에는 빈 세그먼트, . 또는 .., 백슬래시, 제어 문자를 쓸 수 없습니다.');
export const buildIdSchema = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
export const requestIdSchema = z.string().min(1).max(128).regex(/^[A-Za-z0-9_-]+$/, 'request_id 는 영숫자·_·- 만 쓸 수 있습니다 (최대 128자).');
export const buildParametersSchema = z.record(z.string().min(1), z.string());

export const triggerBuildSchema = z.object({
  job: buildJobSchema,
  request_id: requestIdSchema,
  parameters: buildParametersSchema.optional(),
});
type TriggerInput = z.infer<typeof triggerBuildSchema>;

const receiptSchema = z.object({
  fingerprint: z.string(),
  // pending: 예약 후 POST 결과를 아직 못 적었다 (진행 중이거나, 오래됐으면 도중에 죽었다).
  state: z.enum(['pending', 'unknown', 'queued', 'rejected']),
  reserved_at: z.number().int().nonnegative().optional(),
  queue_id: buildIdSchema.optional(),
  http_status: z.number().int().optional(),
});
type Receipt = z.infer<typeof receiptSchema>;

/**
 * 예약이 이보다 젊으면 결과가 없는 재호출을 `pending`(다른 호출이 처리 중)으로, 더 오래됐으면 `unknown`
 * (도중에 죽음)으로 본다. crumb 조회(1회, 60초) + POST(1회, 60초) 최악 소요보다 넉넉하게 잡는다.
 */
export const PENDING_WINDOW_MS = 3 * 60_000;

const hash = (text: string) => createHash('sha256').update(text).digest('hex');

/** 예약·receipt 가 사는 곳. os.homedir() 를 호출 시점에 읽는다 (테스트가 HOME 을 바꾼다). */
export function buildRequestsDir(): string {
  return path.join(os.homedir(), '.mimi-seed', 'jenkins-build-requests');
}

/**
 * 파라미터 지문용 설치별 비밀 키 (~/.mimi-seed/jenkins-build-requests/.key, 0600).
 *
 * 지문을 평문 sha256 으로 두면 짧은 파라미터(버전 번호·브랜치 이름)는 receipt 만 보고 사전 대입으로 되찾을 수
 * 있다. 그래서 HMAC 으로 소금 친다. 처음 쓸 때 공용 writer 로 temp 에 쓰고 link(2) 로 "없을 때만" 게시한다 —
 * 두 프로세스가 동시에 만들어도 한 키만 살아남고, 진 쪽은 이긴 키를 다시 읽는다 (각자 다른 키로 지문을 만들면
 * 같은 요청이 "다른 파라미터" 로 거절된다). 키가 사라지면 기존 예약의 재호출은 지문 불일치로 거절된다 — 다시
 * 보내지는 않는다. 예약 디렉터리 이름은 키와 무관한 sha256 이라 키를 지워도 중복 발송이 풀리지 않는다.
 */
export function fingerprintKey(): Buffer {
  const file = path.join(buildRequestsDir(), '.key');
  const read = (): Buffer => {
    const text = readFileSync(file, 'utf8').trim();
    if (!/^[0-9a-f]{64}$/.test(text)) {
      throw new Error(`Jenkins 빌드 요청 키 파일이 손상됐습니다 (${path.basename(file)}). 빌드를 요청하지 않았습니다.`);
    }
    return Buffer.from(text, 'hex');
  };
  try {
    return read();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  const temp = `${file}.${process.pid}.${randomUUID()}.new`;
  writeCredentialFile(temp, `${randomBytes(32).toString('hex')}\n`);
  try {
    linkSync(temp, file);
  } catch (error) {
    // EEXIST = 다른 프로세스가 먼저 만들었다 → 그 키를 쓴다. 하드링크를 못 거는 파일시스템이면 그냥 게시한다.
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') writeCredentialFile(file, readFileSync(temp));
  } finally {
    rmSync(temp, { force: true });
  }
  return read();
}

function root(cfg: JenkinsConfig): string {
  if (!cfg.username?.trim() || !cfg.token?.trim()) throw new Error('Jenkins 사용자와 API Token 설정이 필요합니다.');
  const url = new URL(cfg.url);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error('Jenkins URL은 인증정보·쿼리·fragment 없는 HTTP(S) 주소여야 합니다.');
  }
  return url.href.replace(/\/+$/, '');
}

const queueUrlOf = (base: string, queueId: number) => `${base}/queue/item/${encodePathSegment(queueId)}/`;

const MESSAGES: Record<Receipt['state'], string | undefined> = {
  pending:
    '같은 request_id 의 요청을 다른 호출이 방금 예약해 처리 중입니다. 잠시 뒤 같은 request_id 로 다시 호출해 결과를 확인하세요. '
    + '새 request_id 로 재시도하지 마세요.',
  unknown:
    '접수 여부 불명입니다. 자동 재전송하지 않습니다. Jenkins에서 접수 여부를 확인하세요. 같은 request_id 재호출도 POST하지 않습니다.',
  rejected: 'Jenkins가 요청을 거절했습니다. 권한·잡·파라미터를 확인하세요. 수정 후 새 요청에만 새 request_id를 사용하세요.',
  queued: undefined,
};

function result(receipt: Receipt, base: string, requestId: string, replayed: boolean) {
  const message = MESSAGES[receipt.state];
  return {
    request_id: requestId,
    state: receipt.state,
    replayed,
    ...(receipt.queue_id !== undefined && { queue_id: receipt.queue_id, queue_url: queueUrlOf(base, receipt.queue_id) }),
    ...(receipt.http_status !== undefined && { http_status: receipt.http_status }),
    ...(message && { message }),
  };
}

/** 결과 기록을 저장하지 못했을 때 — 로컬 경로·원인 문자열은 싣지 않는다. */
function notPersistedMessage(receipt: Receipt): string {
  if (receipt.state === 'queued') {
    return 'Jenkins 빌드는 큐에 들어갔습니다 — 다시 트리거하지 마세요. queue_id 를 jenkins_get_queue_item 으로 추적하세요. '
      + '(로컬 결과 기록 저장 실패: 같은 request_id 재호출은 pending/unknown 으로 보이지만 재전송하지 않습니다.) '
      + 'The build WAS queued — do not retrigger; track queue_id with jenkins_get_queue_item. '
      + '(The local result record could not be saved; replays of this request_id report pending/unknown and never re-send.)';
  }
  return `${MESSAGES[receipt.state] ?? ''} 로컬 결과 기록을 저장하지 못했습니다 — 새 request_id 로 재시도하지 마세요. `
    + 'The local result record could not be saved — do not retry with a new request_id.';
}

/** 이미 예약된 request_id 재호출 — 기록을 돌려주고 POST 하지 않는다. */
function replay(dir: string, file: string, fingerprint: string, base: string, requestId: string) {
  let receipt: Receipt | null = null;
  try {
    receipt = receiptSchema.parse(JSON.parse(readFileSync(file, 'utf8')));
  } catch {
    // 다른 호출이 아직 예약 중이거나, 도중에 죽어 기록이 없거나 잘렸다 — 아래에서 나이로 가른다.
  }
  if (receipt && receipt.fingerprint !== fingerprint) {
    throw new Error('같은 request_id에 다른 잡/파라미터를 사용할 수 없습니다. 새 요청이면 새 request_id를 쓰세요.');
  }
  if (receipt && receipt.state !== 'pending') return result(receipt, base, requestId, true);
  let since = receipt?.reserved_at;
  if (since === undefined) {
    try {
      since = statSync(dir).mtimeMs;
    } catch {
      since = undefined;
    }
  }
  const young = since !== undefined && Date.now() - since < PENDING_WINDOW_MS;
  return result({ fingerprint, state: young ? 'pending' : 'unknown' }, base, requestId, true);
}

/** Location 경로 끝의 `/queue/item/<id>/` 에서 ID 만 꺼낸다 — 컨텍스트 경로를 바꾸는 리버스 프록시도 허용. */
function queueIdFromLocation(location: string, base: string): number | undefined {
  const url = new URL(location, `${base}/`);
  if (!['http:', 'https:'].includes(url.protocol) || url.search || url.hash || url.username || url.password) return undefined;
  const match = /\/queue\/item\/(\d+)\/?$/.exec(url.pathname);
  const id = match ? Number(match[1]) : NaN;
  return buildIdSchema.safeParse(id).success ? id : undefined;
}

/**
 * Local durable at-most-once dispatch, not Jenkins-side exactly-once delivery.
 * Keep reservations indefinitely once the POST may have been sent: a crash after POST must never become a retry.
 * Only an HMAC fingerprint and bounded response metadata are stored, never parameters or tokens.
 * Once the POST may have been sent this function never throws — it always returns what it knows.
 */
export async function triggerBuild(cfg: JenkinsConfig, input: TriggerInput) {
  const args = triggerBuildSchema.parse(input);
  const base = root(cfg);
  const parameters = Object.entries(args.parameters ?? {}).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  mkdirSync(buildRequestsDir(), { recursive: true, mode: CREDENTIAL_DIR_MODE });
  const fingerprint = createHmac('sha256', fingerprintKey())
    .update(JSON.stringify([args.job, args.parameters !== undefined, parameters]))
    .digest('hex');
  const key = hash(JSON.stringify([base, cfg.username, args.request_id]));
  const dir = path.join(buildRequestsDir(), key);
  const file = path.join(dir, 'receipt.json');
  try {
    // mkdir 는 원자적이다 — 동시에 같은 request_id 를 보낸 두 호출 중 하나만 여기를 통과한다.
    mkdirSync(dir, { mode: CREDENTIAL_DIR_MODE });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    return replay(dir, file, fingerprint, base, args.request_id);
  }

  // ── POST 전: 실패하면 아무것도 보내지 않았으므로 예약을 풀고 던진다 (같은 request_id 로 재시도 가능). ──
  const release = () => {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // 못 지우면 예약이 남는다 — 재호출은 pending/unknown 으로 보일 뿐 재전송하지 않는다 (안전한 쪽).
    }
  };
  const reservedAt = Date.now();
  let crumb: Record<string, string>;
  try {
    writeCredentialJson(file, { fingerprint, state: 'pending', reserved_at: reservedAt } satisfies Receipt);
    // API 토큰 인증은 보통 crumb 이 면제지만, 켜 둔 서버도 있다. 인증 헤더를 단 채 리다이렉트를 따라가지 않는다.
    const crumbResult = await requestCrumb({ ...cfg, url: base }, { redirect: 'manual', maxAttempts: 1 });
    if (crumbResult.kind === 'failed') {
      throw new Error(
        `Jenkins CSRF crumb 조회 실패${crumbResult.status ? ` (HTTP ${crumbResult.status})` : ''} — 빌드를 요청하지 않았습니다. `
        + '인증·서버 상태를 확인한 뒤 같은 request_id 로 다시 시도해도 됩니다.',
      );
    }
    crumb = crumbResult.kind === 'ok' ? crumbResult.headers : {};
  } catch (error) {
    release();
    throw error;
  }

  // ── 여기부터 POST 가 Jenkins 에 닿았을 수 있다: 절대 던지지 않는다. ─────────────────────
  let receipt: Receipt = { fingerprint, state: 'unknown', reserved_at: reservedAt };
  try {
    // No POST retry and no redirects (307/308 could otherwise replay the request at another URL).
    const endpoint = args.parameters === undefined ? 'build' : 'buildWithParameters';
    const response = await fetchWithTimeout(
      `${jobUrl({ ...cfg, url: base }, args.job)}/${encodePathSegment(endpoint)}`,
      {
        method: 'POST',
        redirect: 'manual',
        headers: { ...authHeaders(cfg), ...crumb, 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams(parameters).toString(),
      },
      { maxAttempts: 1 },
    );
    receipt = { ...receipt, http_status: response.status };
    if (response.status === 201) {
      const location = response.headers.get('location');
      // Jenkins can advertise a different host or context path behind a reverse proxy.
      // Extract only the ID; subsequent requests always use the configured base.
      const queueId = location ? queueIdFromLocation(location, base) : undefined;
      if (queueId !== undefined) receipt = { ...receipt, state: 'queued', queue_id: queueId };
    } else if ([400, 401, 403, 404, 405, 422].includes(response.status)) {
      receipt = { ...receipt, state: 'rejected' };
    }
  } catch {
    // Network error, timeout, or a malformed response. Provider messages can echo secrets — keep only safe metadata.
  }
  try {
    writeCredentialJson(file, receipt);
  } catch {
    return { ...result(receipt, base, args.request_id, false), persisted: false, message: notPersistedMessage(receipt) };
  }
  return result(receipt, base, args.request_id, false);
}

async function readJson(cfg: JenkinsConfig, url: string): Promise<{ missing: boolean; data?: unknown }> {
  let response: Response;
  try {
    response = await fetchWithTimeout(url, { headers: authHeaders(cfg), redirect: 'manual' });
  } catch {
    throw new Error('Jenkins 조회 연결 실패/시간 초과. 연결 상태를 확인한 뒤 조회만 재시도하세요.');
  }
  if (response.status === 404) return { missing: true };
  if (!response.ok) throw new Error(`Jenkins 조회 실패 (HTTP ${response.status}). 인증·권한·서버 상태를 확인하세요.`);
  try {
    return { missing: false, data: await response.json() };
  } catch {
    throw new Error('Jenkins JSON 응답을 읽을 수 없습니다.');
  }
}

const queueSchema = z.object({
  id: buildIdSchema,
  cancelled: z.boolean().optional(),
  blocked: z.boolean().optional(),
  buildable: z.boolean().optional(),
  stuck: z.boolean().optional(),
  why: z.string().nullable().optional(),
  executable: z.object({ number: buildIdSchema }).nullable().optional(),
});

export async function getQueueItem(cfg: JenkinsConfig, queueId: number) {
  buildIdSchema.parse(queueId);
  const queueUrl = queueUrlOf(root(cfg), queueId);
  const response = await readJson(cfg, `${queueUrl}api/json?tree=id,cancelled,blocked,buildable,stuck,why,executable[number]`);
  if (response.missing) {
    return {
      queue_id: queueId,
      state: 'unavailable',
      message: '큐 항목이 만료됐거나 없습니다. 이미 기록한 빌드 번호로 조회하세요. 재트리거하거나 lastBuild로 추정하지 마세요.',
    };
  }
  const data = queueSchema.safeParse(response.data);
  if (!data.success || data.data.id !== queueId) throw new Error('Jenkins 큐 응답 형식 또는 ID가 일치하지 않습니다.');
  const item = data.data;
  return {
    queue_id: queueId,
    queue_url: queueUrl,
    state: item.cancelled ? 'cancelled' : item.executable ? 'started' : 'queued',
    ...(!item.cancelled && item.executable && { build_number: item.executable.number }),
    blocked: item.blocked ?? false,
    buildable: item.buildable ?? false,
    stuck: item.stuck ?? false,
    why: item.why?.slice(0, 1000) ?? null,
  };
}

const buildSchema = z.object({
  number: buildIdSchema,
  building: z.boolean(),
  result: z.enum(['SUCCESS', 'FAILURE', 'UNSTABLE', 'ABORTED', 'NOT_BUILT']).nullable(),
  timestamp: z.number().nonnegative().optional(),
  duration: z.number().nonnegative().optional(),
});

export async function getBuildStatus(cfg: JenkinsConfig, job: string, buildNumber: number) {
  buildJobSchema.parse(job);
  buildIdSchema.parse(buildNumber);
  const buildUrl = `${jobUrl({ ...cfg, url: root(cfg) }, job)}/${encodePathSegment(buildNumber)}/`;
  const response = await readJson(cfg, `${buildUrl}api/json?tree=number,building,result,timestamp,duration`);
  if (response.missing) return { job, build_number: buildNumber, state: 'unavailable', build_url: buildUrl };
  const data = buildSchema.safeParse(response.data);
  if (!data.success || data.data.number !== buildNumber) throw new Error('Jenkins 빌드 응답 형식 또는 번호가 일치하지 않습니다.');
  return { job, build_number: buildNumber, build_url: buildUrl, ...data.data };
}
