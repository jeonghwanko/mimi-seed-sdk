import { z } from 'zod';
import { apiGet } from './client.js';
import { V1_BASE } from './http.js';
import { catalog } from '#core/lang.js';

const M = catalog(
  {
    nextLinkMismatch: 'App Store Connect의 다음 페이지 링크가 요청한 리소스와 일치하지 않습니다.',
    responseBody: '응답 본문',
    badShape: (field: string) => `App Store Connect 응답 형식 오류 (${field}).`,
  },
  {
    nextLinkMismatch: 'The App Store Connect next-page link does not match the requested resource.',
    responseBody: 'response body',
    badShape: (field: string) => `Unexpected App Store Connect response format (${field}).`,
  },
);

export const appStoreResourceRef = z.object({ id: z.string().min(1), type: z.string().min(1) });
export const appStoreToOne = z.object({ data: appStoreResourceRef.nullable() });

export function includedAppStoreResource<T>(
  included: readonly unknown[] | null | undefined,
  ref: z.infer<typeof appStoreResourceRef>,
  schema: z.ZodType<T>,
): T | undefined {
  const matches = included?.filter((resource) => resource !== null && typeof resource === 'object'
    && 'id' in resource && resource.id === ref.id && 'type' in resource && resource.type === ref.type);
  return matches?.length === 1 ? schema.safeParse(matches[0]).data : undefined;
}

export const appStorePagination = z.object({
  links: z.object({ next: z.string().nullish() }).nullish(),
  meta: z.object({ paging: z.object({
    total: z.number().int().nonnegative().optional(),
    limit: z.number().int().nonnegative().optional(),
    nextCursor: z.string().nullish(),
  }).optional() }).optional(),
});

export function appStoreNextPagePath(path: string, next: string): string {
  const endpoint = new URL(`${V1_BASE}${path}`);
  const url = new URL(next, endpoint);
  if (url.origin !== endpoint.origin || url.pathname !== endpoint.pathname
      || url.username || url.password || url.hash || !url.search) {
    throw new Error(M().nextLinkMismatch);
  }
  return `${path}${url.search}`;
}

export function pageIsIncomplete(page: z.infer<typeof appStorePagination>, count: number): boolean {
  return Boolean(page.links?.next || page.meta?.paging?.nextCursor) || (page.meta?.paging?.total ?? 0) > count;
}

export async function getAppStoreResponse<T>(schema: z.ZodType<T>, path: string, params?: Record<string, string>): Promise<T> {
  const response = schema.safeParse(await apiGet<unknown>(path, params));
  if (!response.success) {
    const field = response.error.issues[0]?.path.join('.') || M().responseBody;
    throw new Error(M().badShape(field));
  }
  return response.data;
}
