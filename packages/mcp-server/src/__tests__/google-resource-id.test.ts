import { describe, expect, it, vi } from 'vitest';
import type { OAuth2Client } from 'google-auth-library';
import { notDotSegment, resourceName, resourceSegment } from '../lib/resource-id.js';
import { deleteAndroidApp } from '../firebase/tools.js';
import { createServiceAccountKey } from '../iam/tools.js';
import { listTables } from '../bigquery/tools.js';
import { listApps } from '../admob/tools.js';
import { normalizePropertyName } from '../ga4/tools.js';
import { normalizeBillingAccount } from '../billing/tools.js';

/**
 * googleapis 예약 확장(`{+name}`) 우회 (2026-09 적대적 재검토에서 실측).
 *
 *   firebase_delete_android_app({ projectId: 'A', appId: '../../B/androidApps/Z' })
 *     → POST /v1beta1/projects/B/androidApps/Z:remove
 *
 * 실제 googleapis 를 쓰고 auth.request 만 가짜로 둬서, **요청이 나가기 전에** 막히는지와
 * 정상 ID 가 원래 URL 을 만드는지를 둘 다 확인한다.
 */

function fakeAuth() {
  const request = vi.fn(async (opts: { url: string }) => ({
    data: { privateKeyData: Buffer.from('{}').toString('base64') },
    headers: new Headers(), status: 200, statusText: 'OK', config: opts,
  }));
  return { auth: { request } as unknown as OAuth2Client, request };
}

describe('resourceSegment / resourceName', () => {
  it.each(['my-project', '1:123456:android:abc123', 'domain.com:project', 'sa@my-project.iam.gserviceaccount.com', 'analytics_123456789'])(
    '정상 ID %s 통과',
    (id) => expect(resourceSegment(id)).toBe(id),
  );

  it.each(['../x', '..', '.', '', 'a/b', 'a\\b', 'a?b', 'a#b', 'a%2Fb', 'a b'])('%j 거부', (id) => {
    expect(() => resourceSegment(id)).toThrow(/형식/);
  });

  it('prefix 정규화는 나머지가 한 세그먼트일 때만 통과', () => {
    expect(resourceName('123', 'properties')).toBe('properties/123');
    expect(resourceName(' properties/123 ', 'properties')).toBe('properties/123');
    expect(() => resourceName('properties/1/../../accounts/2', 'properties')).toThrow();
    expect(() => normalizePropertyName('properties/../accounts/9')).toThrow();
    expect(() => normalizeBillingAccount('billingAccounts/../../projects/x')).toThrow();
  });

  it('단순 확장 파라미터는 점 세그먼트만 막는다', () => {
    expect(notDotSegment('sc-domain:example.com')).toBe('sc-domain:example.com');
    expect(() => notDotSegment('..')).toThrow();
  });
});

describe('googleapis 호출 — 요청 전에 막힌다', { timeout: 60_000 }, () => {
  it('firebase deleteAndroidApp: 다른 프로젝트로 가는 appId', async () => {
    const { auth, request } = fakeAuth();
    await expect(deleteAndroidApp(auth, 'A', '../../B/androidApps/Z')).rejects.toThrow(/형식/);
    expect(request).not.toHaveBeenCalled();

    await deleteAndroidApp(auth, 'my-project', '1:123:android:abc');
    expect(new URL(request.mock.calls[0][0].url).pathname)
      .toBe('/v1beta1/projects/my-project/androidApps/1:123:android:abc:remove');
  });

  it('iam createServiceAccountKey: 경로를 거슬러 오르는 이메일', async () => {
    const { auth, request } = fakeAuth();
    await expect(createServiceAccountKey(auth, '../../../v1/projects/x/serviceAccounts/y')).rejects.toThrow(/형식/);
    expect(request).not.toHaveBeenCalled();
  });

  it('bigquery listTables: {+projectId}/{+datasetId} 우회', async () => {
    const { auth, request } = fakeAuth();
    await expect(listTables(auth, 'p', '../../other/datasets/d')).rejects.toThrow(/데이터셋/);
    await expect(listTables(auth, '../x', 'd')).rejects.toThrow(/프로젝트/);
    expect(request).not.toHaveBeenCalled();
  });

  it('admob listApps: accounts/ 접두사 뒤의 우회', async () => {
    const { auth, request } = fakeAuth();
    await expect(listApps(auth, 'accounts/pub-1/../../x')).rejects.toThrow(/AdMob/);
    expect(request).not.toHaveBeenCalled();
  });
});
