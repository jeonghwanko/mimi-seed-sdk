import { z } from 'zod';
import { apiGet } from './client.js';

export const appStorePagination = z.object({
  links: z.object({ next: z.string().nullish() }).nullish(),
  meta: z.object({ paging: z.object({
    total: z.number().int().nonnegative().optional(),
    nextCursor: z.string().nullish(),
  }).optional() }).optional(),
});

export function pageIsIncomplete(page: z.infer<typeof appStorePagination>, count: number): boolean {
  return Boolean(page.links?.next || page.meta?.paging?.nextCursor) || (page.meta?.paging?.total ?? 0) > count;
}

export async function getAppStoreResponse<T>(schema: z.ZodType<T>, path: string, params?: Record<string, string>): Promise<T> {
  const response = schema.safeParse(await apiGet<unknown>(path, params));
  if (!response.success) {
    const field = response.error.issues[0]?.path.join('.') || '응답 본문';
    throw new Error(`App Store Connect 응답 형식 오류 (${field}).`);
  }
  return response.data;
}
