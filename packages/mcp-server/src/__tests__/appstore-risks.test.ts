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

  it('프로젝트의 소셜 기능 사실과 ASC 연령등급 응답 불일치를 blocker로 만든다', async () => {
    mocks.apiGet.mockImplementation(async (path: string) => {
      if (path === '/apps/1234567890/appStoreVersions') return { data: [{ id: 'version-1' }] };
      if (path === '/appStoreVersions/version-1/appStoreVersionLocalizations') return { data: [] };
      if (path === '/appStoreVersions/version-1/relationships/build') return { data: { id: 'build-1' } };
      if (path === '/apps/1234567890/appInfos') {
        return { data: [{ id: 'info-1', attributes: { state: 'PREPARE_FOR_SUBMISSION' } }] };
      }
      if (path === '/appInfos/info-1/appInfoLocalizations') {
        return { data: [{ attributes: { privacyPolicyUrl: 'https://example.com/privacy' } }] };
      }
      if (path === '/appInfos/info-1/ageRatingDeclaration') {
        return { data: { attributes: { userGeneratedContent: true, socialMedia: false, socialMediaAgeRestricted: false } } };
      }
      throw new Error(`unexpected path: ${path}`);
    });

    const risks = await checkAppStoreRisks('1234567890', { socialMedia: true });
    expect(risks).toContainEqual(expect.objectContaining({
      code: 'SOCIAL_MEDIA_CAPABILITY_MISMATCH',
      level: 'blocker',
    }));
    expect(risks).toContainEqual(expect.objectContaining({
      code: 'UGC_WITHOUT_SOCIAL_MEDIA',
      level: 'warning',
    }));
  });
});
