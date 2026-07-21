import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { V1_BASE, V2_BASE, apiRequest, authHeadersOrThrow } from './http.js';

export type { AppStoreProductType } from './http.js';
import type { AppStoreProductType } from './http.js';

interface UploadOperation {
  method: string;
  url: string;
  length: number;
  offset: number;
  requestHeaders: Array<{ name: string; value: string }>;
}

interface ReviewScreenshotResponse {
  data: {
    id: string;
    attributes?: {
      uploadOperations?: UploadOperation[];
      assetDeliveryState?: { state?: string };
    };
  };
}

function productResource(productType: AppStoreProductType) {
  if (productType === 'subscription') {
    return { base: V1_BASE, type: 'subscriptions', path: '/subscriptions' };
  }
  return { base: V2_BASE, type: 'inAppPurchases', path: '/inAppPurchases' };
}

function reviewScreenshotResource(productType: AppStoreProductType) {
  if (productType === 'subscription') {
    return {
      type: 'subscriptionAppStoreReviewScreenshots',
      path: '/subscriptionAppStoreReviewScreenshots',
      relationship: 'subscription',
      relatedType: 'subscriptions',
    };
  }
  return {
    type: 'inAppPurchaseAppStoreReviewScreenshots',
    path: '/inAppPurchaseAppStoreReviewScreenshots',
    relationship: 'inAppPurchaseV2',
    relatedType: 'inAppPurchases',
  };
}

/** 기존 IAP/구독 상품의 App Review 노트를 수정한다. */
export async function updateProductReviewNote(args: {
  internalId: string;
  productType: AppStoreProductType;
  reviewNote: string;
}): Promise<{ internalId: string; productType: AppStoreProductType; state?: string }> {
  const { internalId, productType, reviewNote } = args;
  const resource = productResource(productType);
  const authHeaders = await authHeadersOrThrow();
  const result = await apiRequest<{
    data?: { attributes?: { state?: string } };
  }>(resource.base, `${resource.path}/${internalId}`, authHeaders, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      data: {
        type: resource.type,
        id: internalId,
        attributes: { reviewNote },
      },
    }),
  });

  return { internalId, productType, state: result.data?.attributes?.state };
}

async function uploadChunks(buffer: Buffer, operations: UploadOperation[]): Promise<void> {
  for (const operation of operations) {
    const uploadUrl = new URL(operation.url);
    if (uploadUrl.protocol !== 'https:') {
      throw new Error(`HTTPS가 아닌 업로드 URL은 거부해: ${uploadUrl.protocol}`);
    }
    if (
      operation.offset < 0 ||
      operation.length <= 0 ||
      operation.offset + operation.length > buffer.length
    ) {
      throw new Error(
        `잘못된 업로드 청크 범위: offset=${operation.offset}, ` +
          `length=${operation.length}, fileSize=${buffer.length}`,
      );
    }
    const chunk = buffer.subarray(operation.offset, operation.offset + operation.length);
    const headers: Record<string, string> = {};
    for (const header of operation.requestHeaders) headers[header.name] = header.value;
    const response = await fetch(operation.url, {
      method: operation.method,
      headers,
      body: new Uint8Array(chunk),
    });
    if (!response.ok) {
      const body = await response.text();
      throw new Error(
        `청크 업로드 실패 (offset=${operation.offset}, length=${operation.length}): ` +
          `${response.status} ${body}`,
      );
    }
  }
}

/**
 * 기존 IAP/구독 상품에 App Review 스크린샷을 reserve → upload → commit 한다.
 * App Store Connect API는 상품당 심사용 스크린샷 하나를 허용한다.
 */
export async function uploadProductReviewScreenshot(args: {
  internalId: string;
  productType: AppStoreProductType;
  filePath: string;
}): Promise<{
  id: string;
  internalId: string;
  productType: AppStoreProductType;
  fileName: string;
  fileSize: number;
  state?: string;
  verified: boolean;
}> {
  const { internalId, productType, filePath } = args;
  if (!path.isAbsolute(filePath)) {
    throw new Error(`절대 경로가 필요해: ${filePath}`);
  }
  if (!fs.existsSync(filePath)) {
    throw new Error(`파일이 존재하지 않아: ${filePath}`);
  }

  const buffer = fs.readFileSync(filePath);
  const fileName = path.basename(filePath);
  const fileSize = buffer.length;
  if (!/\.(png|jpe?g)$/i.test(fileName)) {
    throw new Error(`PNG/JPG 파일만 업로드할 수 있어: ${fileName}`);
  }
  if (fileSize === 0) {
    throw new Error(`빈 파일은 업로드할 수 없어: ${fileName}`);
  }
  const checksum = crypto.createHash('md5').update(buffer).digest('hex');
  const resource = reviewScreenshotResource(productType);
  const authHeaders = await authHeadersOrThrow();

  const reserved = await apiRequest<ReviewScreenshotResponse>(V1_BASE, resource.path, authHeaders, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      data: {
        type: resource.type,
        attributes: { fileName, fileSize },
        relationships: {
          [resource.relationship]: {
            data: { type: resource.relatedType, id: internalId },
          },
        },
      },
    }),
  });

  const screenshotId = reserved.data.id;
  const operations = reserved.data.attributes?.uploadOperations ?? [];
  if (operations.length === 0) {
    await apiRequest(V1_BASE, `${resource.path}/${screenshotId}`, authHeaders, {
      method: 'DELETE',
    }).catch(() => undefined);
    throw new Error('uploadOperations가 비어있음 — Apple API 응답 형식 확인 필요.');
  }

  try {
    await uploadChunks(buffer, operations);
    await apiRequest(V1_BASE, `${resource.path}/${screenshotId}`, authHeaders, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        data: {
          type: resource.type,
          id: screenshotId,
          attributes: { uploaded: true, sourceFileChecksum: checksum },
        },
      }),
    });
  } catch (error) {
    // 완료되지 않은 reservation이 남지 않도록 best-effort 정리.
    await apiRequest(V1_BASE, `${resource.path}/${screenshotId}`, authHeaders, {
      method: 'DELETE',
    }).catch(() => undefined);
    throw error;
  }

  let state: string | undefined;
  let verified = false;
  try {
    const confirmed = await apiRequest<ReviewScreenshotResponse>(
      V1_BASE,
      `${resource.path}/${screenshotId}`,
      authHeaders,
      { method: 'GET' },
    );
    state = confirmed.data.attributes?.assetDeliveryState?.state;
    verified = true;
  } catch {
    // commit 성공 후 확인 GET만 실패하면 재업로드를 유도하지 않는다.
  }

  return { id: screenshotId, internalId, productType, fileName, fileSize, state, verified };
}
