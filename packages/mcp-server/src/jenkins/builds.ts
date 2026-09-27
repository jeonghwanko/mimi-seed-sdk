// Jenkins 빌드 실행·추적 — jenkins_trigger_build / jenkins_get_queue_item / jenkins_get_build_status.
//
// 트리거는 **로컬 영속 at-most-once 발송**이다 (Jenkins 쪽 exactly-once 가 아니다). 호출자가 준 request_id 마다
// ~/.mimi-seed/jenkins-build-requests/<key>/ 디렉터리를 mkdir 로 원자적으로 예약하고, 그 안의 receipt.json 에
// 결과를 남긴다. 예약은 지우지 않는다 — POST 직후 프로세스가 죽어도 같은 request_id 재호출이 재전송이 되면 안 된다.
// receipt 에는 해시와 제한된 응답 메타데이터만 남긴다. 파라미터 원문·토큰은 절대 저장하지 않는다.
//
// confirm 가드와의 관계: 이 도구는 manifest 의 destructive 이고 레지스트라가 confirm 을 주입한다. confirm 없는
// 호출은 핸들러까지 오지 않으므로(= triggerBuild 가 불리지 않으므로) request_id 를 예약하지도, receipt 를 쓰지도
// 않는다. dry-run 으로 본 인자 그대로 confirm: true 를 붙여 부르면 그때 처음 한 번 예약·발송된다.

import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { z } from 'zod';
import { CREDENTIAL_DIR_MODE, writeCredentialJson } from '#core/atomic-write.js';
import type { JenkinsConfig } from './config.js';
import { authHeaders, isStrictJobPath, jobUrl } from './http.js';
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
  state: z.enum(['unknown', 'queued', 'rejected']),
  queue_id: buildIdSchema.optional(),
  http_status: z.number().int().optional(),
});
type Receipt = z.infer<typeof receiptSchema>;

const hash = (text: string) => createHash('sha256').update(text).digest('hex');

/** 예약·receipt 가 사는 곳. os.homedir() 를 호출 시점에 읽는다 (테스트가 HOME 을 바꾼다). */
export function buildRequestsDir(): string {
  return path.join(os.homedir(), '.mimi-seed', 'jenkins-build-requests');
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

function result(receipt: Receipt, base: string, requestId: string, replayed: boolean) {
  return {
    request_id: requestId,
    state: receipt.state,
    replayed,
    ...(receipt.queue_id !== undefined && { queue_id: receipt.queue_id, queue_url: queueUrlOf(base, receipt.queue_id) }),
    ...(receipt.http_status !== undefined && { http_status: receipt.http_status }),
    ...(receipt.state === 'unknown' && {
      message: '접수 여부 불명입니다. 자동 재전송하지 않습니다. Jenkins에서 접수 여부를 확인하세요. 같은 request_id 재호출도 POST하지 않습니다.',
    }),
    ...(receipt.state === 'rejected' && {
      message: 'Jenkins가 요청을 거절했습니다. 권한·잡·파라미터를 확인하세요. 수정 후 새 요청에만 새 request_id를 사용하세요.',
    }),
  };
}

/**
 * Local durable at-most-once dispatch, not Jenkins-side exactly-once delivery.
 * Keep reservations indefinitely: a crash after POST must never become a retry.
 * Only hashes and bounded response metadata are stored, never parameters or tokens.
 */
export async function triggerBuild(cfg: JenkinsConfig, input: TriggerInput) {
  const args = triggerBuildSchema.parse(input);
  const base = root(cfg);
  const parameters = Object.entries(args.parameters ?? {}).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const fingerprint = hash(JSON.stringify([args.job, args.parameters !== undefined, parameters]));
  const key = hash(JSON.stringify([base, cfg.username, args.request_id]));
  const dir = path.join(buildRequestsDir(), key);
  mkdirSync(path.dirname(dir), { recursive: true, mode: CREDENTIAL_DIR_MODE });
  const file = path.join(dir, 'receipt.json');
  try {
    // mkdir 는 원자적이다 — 동시에 같은 request_id 를 보낸 두 호출 중 하나만 여기를 통과한다.
    mkdirSync(dir, { mode: CREDENTIAL_DIR_MODE });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    let receipt: Receipt;
    try {
      receipt = receiptSchema.parse(JSON.parse(readFileSync(file, 'utf8')));
    } catch {
      // Another process may be reserving it, or a crash left an incomplete record. Fail closed.
      return result({ fingerprint, state: 'unknown' }, base, args.request_id, true);
    }
    if (receipt.fingerprint !== fingerprint) {
      throw new Error('같은 request_id에 다른 잡/파라미터를 사용할 수 없습니다. 새 요청이면 새 request_id를 쓰세요.', { cause: error });
    }
    return result(receipt, base, args.request_id, true);
  }
  const save = (receipt: Receipt) => writeCredentialJson(file, receipt);
  let receipt: Receipt = { fingerprint, state: 'unknown' };
  save(receipt); // Must succeed before any network side effect.
  try {
    // Config uses API tokens, which Jenkins exempts from CSRF crumbs. No POST retry
    // and no redirects (307/308 could otherwise replay the request at another URL).
    const endpoint = args.parameters === undefined ? 'build' : 'buildWithParameters';
    const response = await fetchWithTimeout(
      `${jobUrl({ ...cfg, url: base }, args.job)}/${encodePathSegment(endpoint)}`,
      {
        method: 'POST',
        redirect: 'manual',
        headers: { ...authHeaders(cfg), 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams(parameters).toString(),
      },
      { maxAttempts: 1 },
    );
    receipt.http_status = response.status;
    if (response.status === 201) {
      const location = response.headers.get('location');
      if (location) {
        const url = new URL(location, `${base}/`);
        const prefix = `${new URL(base).pathname.replace(/\/$/, '')}/queue/item/`;
        const suffix = url.pathname.startsWith(prefix) ? url.pathname.slice(prefix.length) : '';
        const id = /^\d+\/$/.test(suffix) ? Number(suffix.slice(0, -1)) : NaN;
        // Jenkins can advertise a different hostname behind a reverse proxy.
        // Extract only the ID; subsequent requests always use the configured base.
        if (
          buildIdSchema.safeParse(id).success
          && ['http:', 'https:'].includes(url.protocol)
          && !url.search && !url.hash && !url.username && !url.password
        ) {
          receipt = { fingerprint, state: 'queued', queue_id: id, http_status: 201 };
        }
      }
    } else if ([400, 401, 403, 404, 405, 422].includes(response.status)) {
      receipt.state = 'rejected';
    }
  } catch {
    // Provider/network messages can echo secrets. Preserve only safe metadata.
  }
  save(receipt);
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
