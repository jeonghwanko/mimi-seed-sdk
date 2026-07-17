import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  apiGet: vi.fn(),
  withEdit: vi.fn(),
  publisher: vi.fn(),
}));

vi.mock('../appstore/tools.js', () => ({ apiGet: mocks.apiGet }));
vi.mock('../playstore/tools.js', () => ({
  withEdit: mocks.withEdit,
  publisher: mocks.publisher,
}));

import { checkAppStoreRisks } from '../checks/risks.js';

beforeEach(() => vi.clearAllMocks());

describe('checkAppStoreRisks', () => {
  it('Apple이 실제 편집을 허용하는 거부 상태를 조회한다', async () => {
    mocks.apiGet.mockResolvedValue({ data: [] });

    await checkAppStoreRisks('1234567890');

    expect(mocks.apiGet).toHaveBeenCalledWith(
      '/apps/1234567890/appStoreVersions',
      expect.objectContaining({
        'filter[appStoreState]':
          'PREPARE_FOR_SUBMISSION,DEVELOPER_REJECTED,METADATA_REJECTED,REJECTED',
      }),
    );
  });

  it('각 로케일의 스크린샷을 따로 검사한다', async () => {
    mocks.apiGet.mockImplementation(async (path: string) => {
      if (path === '/apps/1234567890/appStoreVersions') {
        return { data: [{ id: 'version-1' }] };
      }
      if (path === '/appStoreVersions/version-1/appStoreVersionLocalizations') {
        return {
          data: [
            {
              id: 'loc-ko',
              attributes: {
                locale: 'ko',
                description: '설명',
                whatsNew: '새로운 기능',
                keywords: '날씨',
              },
            },
            {
              id: 'loc-en',
              attributes: {
                locale: 'en-US',
                description: 'Description',
                whatsNew: 'What is new',
                keywords: 'weather',
              },
            },
          ],
        };
      }
      if (path === '/appStoreVersionLocalizations/loc-ko/appScreenshotSets') {
        return { data: [{ id: 'set-ko' }] };
      }
      if (path === '/appStoreVersionLocalizations/loc-en/appScreenshotSets') {
        return { data: [] };
      }
      if (path === '/appStoreVersions/version-1/relationships/build') {
        return { data: { type: 'builds', id: 'build-1' } };
      }
      if (path === '/apps/1234567890/appInfos') return { data: [] };
      throw new Error(`unexpected path: ${path}`);
    });

    const risks = await checkAppStoreRisks('1234567890');

    expect(risks).toContainEqual(
      expect.objectContaining({ code: 'NO_SCREENSHOTS_en-US', level: 'blocker' }),
    );
    expect(risks.some((risk) => risk.code === 'NO_SCREENSHOTS_ko')).toBe(false);
  });
});
