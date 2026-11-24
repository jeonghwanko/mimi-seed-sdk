import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  apiGet: vi.fn(),
  withEdit: vi.fn(),
  publisher: vi.fn(),
  requirePlayStoreAuth: vi.fn(),
}));

vi.mock('../appstore/client.js', async (original) => ({
  ...(await original<typeof import('../appstore/client.js')>()),
  apiGet: mocks.apiGet,
}));
vi.mock('../playstore/tools.js', async (original) => ({
  ...(await original<typeof import('../playstore/tools.js')>()),
  withEdit: mocks.withEdit,
  publisher: mocks.publisher,
}));

vi.mock('../helpers.js', async (original) => ({
  ...(await original<typeof import('../helpers.js')>()),
  requirePlayStoreAuth: mocks.requirePlayStoreAuth,
  requireAuth: () => { throw new Error('OAuth unavailable'); },
}));

import { checkAppStoreRisks, formatRisks } from '../checks/risks.js';
import { withClient } from './helpers.js';

beforeEach(() => vi.resetAllMocks());

it('Play 제출 점검은 해당 앱의 서비스 계정을 사용할 수 있다', async () => {
  const serviceAccount = {};
  mocks.requirePlayStoreAuth.mockResolvedValue(serviceAccount);
  mocks.withEdit.mockResolvedValue([]);

  await withClient(async (client) => {
    const result = await client.callTool({
      name: 'playstore_check_submission_risks',
      arguments: { packageName: 'com.example.app' },
    });
    expect(result.isError).toBeFalsy();
  }, { env: { MIMI_SEED_TOOLSETS: 'playstore' } });

  expect(mocks.requirePlayStoreAuth).toHaveBeenCalledWith('com.example.app');
  expect(mocks.withEdit).toHaveBeenCalledWith(serviceAccount, 'com.example.app', expect.any(Function));
});

it('Play 출시 점검은 다른 트랙의 같은 코드와 같은 트랙의 다른 코드를 허용하지 않는다', async () => {
  const tracks = vi.fn().mockResolvedValue({
    data: { tracks: [
      { track: 'production', releases: [{ versionCodes: ['40'] }] },
      { track: 'beta', releases: [{ versionCodes: ['42'] }] },
    ] },
  });
  mocks.publisher.mockReturnValue({ edits: {
    listings: { get: vi.fn().mockResolvedValue({ data: { title: 'Sample App', shortDescription: 'Short description', fullDescription: 'A'.repeat(60) } }) },
    images: { list: vi.fn().mockResolvedValue({ data: { images: [{}, {}] } }) },
    details: { get: vi.fn().mockRejectedValue(new Error('contact lookup failed')) },
    tracks: { list: tracks },
  } });
  mocks.requirePlayStoreAuth.mockResolvedValue({});
  mocks.withEdit.mockImplementation(async (_auth, _pkg, run: (editId: string) => Promise<unknown>) => run('edit-1'));
  await withClient(async (client) => {
    const args = { packageName: 'com.example.app', track: 'production', versionCode: '42' };
    const partialArgs = await client.callTool({
      name: 'playstore_check_submission_risks',
      arguments: { packageName: args.packageName, versionCode: args.versionCode },
    });
    expect(partialArgs.isError).toBe(true);
    expect(tracks).not.toHaveBeenCalled();
    const result = await client.callTool({ name: 'playstore_check_submission_risks', arguments: args });
    const text = JSON.stringify(result.content);
    expect(text).toContain('production/42');
    expect(text).toContain('TARGET_BUILD_NOT_FOUND');
    expect(text).toContain('점검 미완료');
    expect(text).toContain('contact lookup failed');
    expect(text).not.toContain('NO_CONTACT_EMAIL');
    expect(text).not.toContain('경고 항목 검토 후 제출 가능');

    const matching = await client.callTool({
      name: 'playstore_check_submission_risks', arguments: { ...args, track: 'beta' },
    });
    expect(JSON.stringify(matching.content)).not.toContain('TARGET_BUILD_NOT_FOUND');

    tracks.mockRejectedValueOnce(new Error('track lookup failed'));
    const incomplete = await client.callTool({ name: 'playstore_check_submission_risks', arguments: args });
    expect(JSON.stringify(incomplete.content)).toContain('API_ERROR_TRACKS');
    expect(JSON.stringify(incomplete.content)).not.toContain('TARGET_BUILD_NOT_FOUND');

    tracks.mockClear();
    mocks.withEdit.mockClear();
    const plan = await client.callTool({
      name: 'playstore_plan_release',
      arguments: { packageName: args.packageName, track: 'beta' },
    });
    expect(plan.isError).toBeFalsy();
    expect(JSON.stringify(plan.content)).toContain('beta 트랙에 versionCode 42 도착 확인');
    expect(mocks.withEdit).toHaveBeenCalledTimes(1);
    expect(tracks).toHaveBeenCalledTimes(1);
  }, { env: { MIMI_SEED_TOOLSETS: 'playstore' } });
});

describe('checkAppStoreRisks', () => {
  function mockReadinessResponse(pathOverride: string, response: unknown) {
    const responses: Record<string, unknown> = {
      '/apps/1234567890/appStoreVersions': { data: [{ id: 'version-1' }] },
      '/appStoreVersions/version-1/appStoreVersionLocalizations': {
        data: [{
          id: 'loc-en',
          attributes: { locale: 'en-US', description: 'Description', keywords: 'example', whatsNew: 'Notes' },
          relationships: { appScreenshotSets: { data: [{ id: 'set-en' }] } },
        }],
      },
      '/appStoreVersions/version-1/relationships/build': { data: { type: 'builds', id: 'build-1' } },
      '/apps/1234567890/appInfos': { data: [{ id: 'info-1', attributes: { state: 'PREPARE_FOR_SUBMISSION' } }] },
      '/appInfos/info-1/appInfoLocalizations': { data: [{ attributes: { privacyPolicyUrl: 'https://example.com/privacy' } }] },
      '/appInfos/info-1/ageRatingDeclaration': { data: { attributes: { socialMedia: false, socialMediaAgeRestricted: false } } },
    };
    mocks.apiGet.mockImplementation(async (path: string) => {
      if (path === pathOverride) return response;
      if (path in responses) return responses[path];
      throw new Error(`unexpected path: ${path}`);
    });
  }

  it.each([
    ['/apps/1234567890/appStoreVersions', { meta: {} }, 'API_ERROR_VERSIONS'],
    ['/apps/1234567890/appStoreVersions', { data: [], meta: { paging: { nextCursor: 'next' } } }, 'API_ERROR_VERSIONS_INCOMPLETE'],
    ['/appStoreVersions/version-1/appStoreVersionLocalizations', { data: [null] }, 'API_ERROR_LOCALIZATIONS'],
    ['/appStoreVersions/version-1/relationships/build', { data: { type: 'apps', id: 'wrong-resource' } }, 'API_ERROR_BUILD_LINKAGE'],
    ['/apps/1234567890/appInfos', {
      data: [{ id: 'live-info', attributes: { state: 'READY_FOR_DISTRIBUTION' } }],
      meta: { paging: { total: 2 } },
    }, 'API_ERROR_APP_INFO_LINKAGE'],
    ['/appInfos/info-1/appInfoLocalizations', { data: [{ attributes: { privacyPolicyUrl: true } }] }, 'API_ERROR_PRIVACY'],
    ['/appInfos/info-1/appInfoLocalizations', { data: [], links: { next: 'https://example.com/next' } }, 'API_ERROR_PRIVACY'],
    ['/appInfos/info-1/ageRatingDeclaration', { data: { attributes: { socialMedia: 'false', socialMediaAgeRestricted: false } } }, 'API_ERROR_AGE_RATING_SOCIAL'],
  ] as const)('형식 오류 또는 불완전한 응답을 점검 미완료로 표시한다 (%s, %j, %s)', async (path, response, code) => {
    mockReadinessResponse(path, response);
    const risks = await checkAppStoreRisks('1234567890', { versionId: 'version-1' });
    expect(risks).toEqual([expect.objectContaining({ code, level: 'warning' })]);
    expect(formatRisks(risks, 'App Store')).toContain('점검 미완료');
    expect(formatRisks(risks, 'App Store')).not.toContain('제출 가능');
  });

  it('개인정보 목록의 현재 페이지에서 정책을 확인하면 점검을 완료한다', async () => {
    mockReadinessResponse('/appInfos/info-1/appInfoLocalizations', {
      data: [{ attributes: { privacyPolicyText: 'Privacy notice' } }],
      meta: { paging: { total: 2 } },
    });
    await expect(checkAppStoreRisks('1234567890', { versionId: 'version-1' })).resolves.toEqual([]);
  });

  it('완전한 개인정보 목록에 공백만 있으면 정책 누락으로 판정한다', async () => {
    mockReadinessResponse('/appInfos/info-1/appInfoLocalizations', {
      data: [{ attributes: { privacyPolicyUrl: ' ', privacyPolicyText: '' } }],
    });
    const risks = await checkAppStoreRisks('1234567890', { versionId: 'version-1' });
    expect(risks).toEqual([expect.objectContaining({ code: 'NO_PRIVACY', level: 'blocker' })]);
  });

  it('연령등급 응답의 null은 소셜 미디어 질문 미응답으로 판정한다', async () => {
    mockReadinessResponse('/appInfos/info-1/ageRatingDeclaration', {
      data: { attributes: { socialMedia: null, socialMediaAgeRestricted: false } },
    });
    const risks = await checkAppStoreRisks('1234567890', { versionId: 'version-1' });
    expect(risks).toEqual([expect.objectContaining({ code: 'SOCIAL_MEDIA_ANSWERS_MISSING', level: 'blocker' })]);
  });

  it('요청한 버전 ID를 검사하고 목록 첫 버전에는 접근하지 않는다', async () => {
    mocks.apiGet.mockResolvedValue({ data: [] });
    mocks.apiGet.mockResolvedValueOnce({ data: [{ id: 'other-version' }, { id: 'target-version' }] });

    await withClient(async (client) => {
      const result = await client.callTool({
        name: 'appstore_check_submission_risks',
        arguments: { appId: '1234567890', versionId: 'target-version' },
      });
      expect(result.isError).toBeFalsy();
    }, { env: { MIMI_SEED_TOOLSETS: 'appstore' } });

    expect(mocks.apiGet).toHaveBeenCalledWith('/apps/1234567890/appStoreVersions', expect.objectContaining({ 'filter[id]': 'target-version' }));
    expect(mocks.apiGet).toHaveBeenCalledWith('/appStoreVersions/target-version/appStoreVersionLocalizations', {
      limit: '200',
      include: 'appScreenshotSets',
      'limit[appScreenshotSets]': '1',
      'fields[appStoreVersionLocalizations]': 'locale,description,whatsNew,keywords,appScreenshotSets',
    });
    expect(mocks.apiGet.mock.calls.map(([path]) => path))
      .not.toContain('/appStoreVersions/other-version/appStoreVersionLocalizations');
  });

  it('요청한 버전이 앱의 편집 가능 목록에 없으면 점검을 막는다', async () => {
    mocks.apiGet.mockResolvedValue({ data: [{ id: 'other-version' }] });
    const risks = await checkAppStoreRisks('1234567890', { versionId: 'target-version' });

    expect(risks).toContainEqual(expect.objectContaining({ code: 'TARGET_VERSION_UNVERIFIED', level: 'blocker' }));
    expect(mocks.apiGet).toHaveBeenCalledTimes(1);
  });

  it('대상 버전의 첨부 조회가 실패하면 다른 버전의 빌드로 제출 가능을 표시하지 않는다', async () => {
    mocks.apiGet.mockImplementation(async (path: string) => {
      if (path === '/apps/1234567890/appStoreVersions') return { data: [{ id: 'target-version' }] };
      if (path.endsWith('/relationships/build')) throw new Error('attachment forbidden');
      if (path === '/builds') return { data: [{ id: 'other-build' }] };
      if (path.endsWith('/appStoreVersionLocalizations')) return {
        data: [{ id: 'loc-en', attributes: { description: 'Description', whatsNew: 'Notes', keywords: 'example' } }],
      };
      if (path.endsWith('/appScreenshotSets')) return { data: [{ id: 'screenshot-set' }] };
      if (path.endsWith('/appInfos')) return { data: [{ id: 'info-1' }] };
      if (path.endsWith('/appInfoLocalizations')) return { data: [{ attributes: { privacyPolicyUrl: 'https://example.com/privacy' } }] };
      if (path.endsWith('/ageRatingDeclaration')) return { data: { attributes: { socialMedia: false, socialMediaAgeRestricted: false } } };
      throw new Error(`unexpected path: ${path}`);
    });

    const risks = await checkAppStoreRisks('1234567890', { versionId: 'target-version' });
    expect(risks).toEqual([expect.objectContaining({ code: 'API_ERROR_BUILD', level: 'warning' })]);
    expect(mocks.apiGet).not.toHaveBeenCalledWith('/builds', expect.anything());
    const summary = formatRisks(risks, 'App Store');
    expect(summary).toContain('점검 미완료');
    expect(summary).not.toContain('제출 가능');
    expect(summary).not.toContain('NO_BUILD');
  });

  it('버전 또는 플랫폼을 지정하면 서버에서 필터링하고 기존 배열 응답을 반환한다', async () => {
    mocks.apiGet.mockResolvedValue({
      data: [{ id: 'target-version', attributes: { versionString: '1.2.0', platform: 'MAC_OS' } }],
    });
    await withClient(async (client) => {
      const result = await client.callTool({
        name: 'appstore_list_versions',
        arguments: { appId: '1234567890', versionString: '1.2.0', platform: 'MAC_OS' },
      });
      expect(JSON.stringify(result.content)).toContain('target-version');
      expect(mocks.apiGet).toHaveBeenLastCalledWith('/apps/1234567890/appStoreVersions', expect.objectContaining({
        'filter[versionString]': '1.2.0', 'filter[platform]': 'MAC_OS',
      }));

      await client.callTool({ name: 'appstore_list_versions', arguments: { appId: '1234567890' } });
      expect(mocks.apiGet).toHaveBeenLastCalledWith('/apps/1234567890/appStoreVersions', {
        'fields[appStoreVersions]': 'versionString,platform,appStoreState,releaseType,createdDate',
        limit: '10',
      });
    }, { env: { MIMI_SEED_TOOLSETS: 'appstore' } });
  });

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

  it('한 번의 로컬라이제이션 조회에서 스크린샷 셋을 로케일별로 판정한다', async () => {
    mocks.apiGet.mockImplementation(async (path: string) => {
      if (path === '/apps/1234567890/appStoreVersions') {
        return { data: [{ id: 'version-1' }] };
      }
      if (path === '/appStoreVersions/version-1/appStoreVersionLocalizations') {
        return {
          data: [
            {
              id: 'loc-ko',
              relationships: { appScreenshotSets: {
                data: [{ id: 'set-ko', type: 'appScreenshotSets' }],
                meta: { paging: { total: 2 } },
              } },
              attributes: {
                locale: 'ko',
                description: '설명',
                whatsNew: '새로운 기능',
                keywords: '날씨',
              },
            },
            {
              id: 'loc-en',
              relationships: { appScreenshotSets: { data: [] } },
              attributes: {
                locale: 'en-US',
                description: 'Description',
                whatsNew: 'What is new',
                keywords: 'weather',
              },
            },
          ],
          included: [{ id: 'set-ko', type: 'appScreenshotSets' }],
        };
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
    expect(mocks.apiGet.mock.calls.filter(([path]) => path.endsWith('/appScreenshotSets'))).toHaveLength(0);
  });

  it('스크린샷 셋 관계와 로케일 목록이 불완전하면 누락으로 단정하지 않는다', async () => {
    mocks.apiGet.mockImplementation(async (path: string) => {
      if (path.endsWith('/appStoreVersions')) return { data: [{ id: 'version-1' }] };
      if (path.endsWith('/appStoreVersionLocalizations')) return {
        data: [
          { id: 'loc-en', attributes: { locale: 'en-US' }, relationships: {
            appScreenshotSets: { data: [], meta: { paging: { total: 1 } } },
          } },
          { id: 'loc-ko', attributes: { locale: 'ko' }, relationships: {
            appScreenshotSets: { data: [null] },
          } },
        ],
        links: { next: 'https://example.com/localizations?page=2' },
      };
      if (path === '/appStoreVersionLocalizations/loc-en/appScreenshotSets') return { data: [{ id: 'set-en' }] };
      if (path === '/appStoreVersionLocalizations/loc-ko/appScreenshotSets') return { data: [], meta: { paging: { total: 1 } } };
      if (path.endsWith('/relationships/build')) return { data: { id: 'build-1' } };
      if (path.endsWith('/appInfos')) return { data: [] };
      throw new Error(`unexpected path: ${path}`);
    });

    const risks = await checkAppStoreRisks('1234567890');
    const codes = risks.map(({ code }) => code);
    expect(codes).toContain('API_ERROR_LOCALIZATIONS_INCOMPLETE');
    expect(codes).toContain('API_ERROR_SCREENSHOTS_ko');
    expect(codes).not.toContain('API_ERROR_SCREENSHOTS_en-US');
    expect(codes.some((code) => code.startsWith('NO_SCREENSHOTS_'))).toBe(false);
    expect(mocks.apiGet.mock.calls.filter(([path]) => path.endsWith('/appScreenshotSets'))).toHaveLength(2);
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

  it('13세 미만 소셜 기능 제한인데 연령 확인이 없으면 blocker로 만든다', async () => {
    mocks.apiGet.mockImplementation(async (path: string) => {
      if (path === '/apps/1234567890/appStoreVersions') return { data: [{ id: 'version-1' }] };
      if (path === '/appStoreVersions/version-1/appStoreVersionLocalizations') return { data: [] };
      if (path === '/appStoreVersions/version-1/relationships/build') return { data: { id: 'build-1' } };
      if (path === '/apps/1234567890/appInfos') return { data: [{ id: 'info-1', attributes: {} }] };
      if (path === '/appInfos/info-1/appInfoLocalizations') {
        return { data: [{ attributes: { privacyPolicyUrl: 'https://example.com/privacy' } }] };
      }
      if (path === '/appInfos/info-1/ageRatingDeclaration') {
        return {
          data: {
            attributes: {
              userGeneratedContent: true,
              socialMedia: true,
              socialMediaAgeRestricted: true,
              ageAssurance: false,
            },
          },
        };
      }
      throw new Error(`unexpected path: ${path}`);
    });

    const risks = await checkAppStoreRisks('1234567890');
    expect(risks).toContainEqual(expect.objectContaining({
      code: 'SOCIAL_MEDIA_AGE_ASSURANCE_MISSING',
      level: 'blocker',
    }));
  });

  it('연령등급 선언 404를 API 장애가 아니라 미응답 blocker로 판정한다', async () => {
    mocks.apiGet.mockImplementation(async (path: string) => {
      if (path === '/apps/1234567890/appStoreVersions') return { data: [{ id: 'version-1' }] };
      if (path === '/appStoreVersions/version-1/appStoreVersionLocalizations') return { data: [] };
      if (path === '/appStoreVersions/version-1/relationships/build') return { data: { id: 'build-1' } };
      if (path === '/apps/1234567890/appInfos') return { data: [{ id: 'info-1', attributes: {} }] };
      if (path === '/appInfos/info-1/appInfoLocalizations') {
        return { data: [{ attributes: { privacyPolicyUrl: 'https://example.com/privacy' } }] };
      }
      if (path === '/appInfos/info-1/ageRatingDeclaration') {
        throw Object.assign(new Error('missing declaration'), { cause: { status: 404 } });
      }
      throw new Error(`unexpected path: ${path}`);
    });

    const risks = await checkAppStoreRisks('1234567890');
    expect(risks).toContainEqual(expect.objectContaining({
      code: 'SOCIAL_MEDIA_ANSWERS_MISSING',
      level: 'blocker',
    }));
    expect(risks.some((risk) => risk.code === 'API_ERROR_AGE_RATING_SOCIAL')).toBe(false);
  });
});
