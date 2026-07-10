import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const auth = vi.hoisted(() => ({
  getAuthHeaders: vi.fn(),
}));

vi.mock('../appstore/auth.js', () => ({
  getAuthHeaders: auth.getAuthHeaders,
}));

import {
  updateProductReviewNote,
  uploadProductReviewScreenshot,
  type AppStoreProductType,
} from '../appstore/product-review.js';

const tempDirs: string[] = [];

beforeEach(() => {
  vi.clearAllMocks();
  auth.getAuthHeaders.mockResolvedValue({ Authorization: 'Bearer test-token' });
});

afterEach(() => {
  vi.unstubAllGlobals();
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('updateProductReviewNote', () => {
  it.each([
    ['consumable', 'https://api.appstoreconnect.apple.com/v2/inAppPurchases/123', 'inAppPurchases'],
    ['subscription', 'https://api.appstoreconnect.apple.com/v1/subscriptions/123', 'subscriptions'],
  ] as const)('%s 상품의 reviewNote를 올바른 API로 PATCH', async (productType, expectedUrl, resourceType) => {
    const fetchMock = vi.fn(async () => jsonResponse({ data: { attributes: { state: 'READY_TO_SUBMIT' } } }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await updateProductReviewNote({
      internalId: '123',
      productType,
      reviewNote: '상점 > 보석 상품을 탭하면 구매 화면이 열립니다.',
    });

    expect(result.state).toBe('READY_TO_SUBMIT');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(expectedUrl);
    expect(init.method).toBe('PATCH');
    expect(JSON.parse(String(init.body))).toEqual({
      data: {
        type: resourceType,
        id: '123',
        attributes: { reviewNote: '상점 > 보석 상품을 탭하면 구매 화면이 열립니다.' },
      },
    });
  });
});

describe('uploadProductReviewScreenshot', () => {
  it.each([
    [
      'consumable',
      'inAppPurchaseAppStoreReviewScreenshots',
      'inAppPurchaseV2',
      'inAppPurchases',
    ],
    [
      'subscription',
      'subscriptionAppStoreReviewScreenshots',
      'subscription',
      'subscriptions',
    ],
  ] as const)(
    '%s 스크린샷을 reserve → chunk upload → commit → verify',
    async (productType, resourceType, relationship, relatedType) => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mimi-iap-review-'));
      tempDirs.push(dir);
      const filePath = path.join(dir, 'review.png');
      const bytes = Buffer.from('review-screenshot-bytes');
      fs.writeFileSync(filePath, bytes);

      const apiPath = `/${resourceType}`;
      const uploadUrl = 'https://upload.example.test/chunk';
      const fetchMock = vi.fn(async (url: string | URL, init?: RequestInit) => {
        const value = String(url);
        if (value === uploadUrl) return new Response('', { status: 200 });
        if (value.endsWith(apiPath) && init?.method === 'POST') {
          return jsonResponse({
            data: {
              id: 'shot-1',
              attributes: {
                uploadOperations: [{
                  method: 'PUT',
                  url: uploadUrl,
                  length: bytes.length,
                  offset: 0,
                  requestHeaders: [{ name: 'Content-Type', value: 'image/png' }],
                }],
              },
            },
          }, 201);
        }
        if (value.endsWith(`${apiPath}/shot-1`) && init?.method === 'PATCH') {
          return jsonResponse({ data: { id: 'shot-1' } });
        }
        if (value.endsWith(`${apiPath}/shot-1`) && init?.method === 'GET') {
          return jsonResponse({
            data: { id: 'shot-1', attributes: { assetDeliveryState: { state: 'COMPLETE' } } },
          });
        }
        throw new Error(`unexpected request: ${init?.method} ${value}`);
      });
      vi.stubGlobal('fetch', fetchMock);

      const result = await uploadProductReviewScreenshot({
        internalId: 'product-1',
        productType: productType as AppStoreProductType,
        filePath,
      });

      expect(result).toMatchObject({ id: 'shot-1', state: 'COMPLETE', verified: true });
      const reserveCall = fetchMock.mock.calls.find(([, init]) => init?.method === 'POST');
      expect(reserveCall).toBeDefined();
      const reserveBody = JSON.parse(String(reserveCall?.[1]?.body));
      expect(reserveBody.data.type).toBe(resourceType);
      expect(reserveBody.data.attributes.fileSize).toBe(bytes.length);
      expect(reserveBody.data.relationships[relationship].data).toEqual({
        type: relatedType,
        id: 'product-1',
      });
    },
  );

  it('상대 경로를 거부', async () => {
    await expect(uploadProductReviewScreenshot({
      internalId: 'product-1',
      productType: 'consumable',
      filePath: 'review.png',
    })).rejects.toThrow(/절대 경로/);
  });

  it('uploadOperations가 비어 있으면 reservation을 정리', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mimi-iap-review-'));
    tempDirs.push(dir);
    const filePath = path.join(dir, 'review.png');
    fs.writeFileSync(filePath, Buffer.from('image'));

    const fetchMock = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      if (init?.method === 'POST') {
        return jsonResponse({ data: { id: 'orphan-1', attributes: { uploadOperations: [] } } }, 201);
      }
      if (init?.method === 'DELETE') return new Response('', { status: 204 });
      throw new Error(`unexpected request: ${init?.method}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(uploadProductReviewScreenshot({
      internalId: 'product-1',
      productType: 'consumable',
      filePath,
    })).rejects.toThrow(/uploadOperations/);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1][1]?.method).toBe('DELETE');
    expect(String(fetchMock.mock.calls[1][0])).toContain('/orphan-1');
  });
});
