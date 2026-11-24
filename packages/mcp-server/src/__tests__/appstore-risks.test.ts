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
  function screenshotPlacement(id: string, state = 'PARENT_PREPARE_FOR_SUBMISSION') {
    return {
      type: 'appAssetLibraryPlacements',
      id,
      attributes: { placementType: 'APP_SCREENSHOT', state },
      relationships: { image: { data: { type: 'appAssetLibraryImages', id: `image-${id}` } } },
    };
  }

  function screenshotAsset(placementId: string, state = 'PREPARE_FOR_SUBMISSION') {
    return { type: 'appAssetLibraryImages', id: `image-${placementId}`, attributes: { state } };
  }

  function mediaLocale(locale: string, placementId?: string, screenshotSets: { id: string }[] = []) {
    return {
      id: `loc-${locale}`,
      attributes: { locale, description: 'Description', keywords: 'example', whatsNew: 'Notes' },
      relationships: {
        placements: { data: placementId ? [{ type: 'appAssetLibraryPlacements', id: placementId }] : [] },
        appScreenshotSets: { data: screenshotSets },
      },
    };
  }

  function legacyScreenshotPage(state: string) {
    const image = { id: 'image-legacy', type: 'appScreenshots' };
    return {
      data: [{ id: 'set-en', relationships: { appScreenshots: { data: [image] } } }],
      included: [{ ...image, attributes: { assetDeliveryState: { state } } }],
    };
  }

  const linkedBuild = { id: 'build-1', type: 'builds' };
  const validBuild = { ...linkedBuild, attributes: { processingState: 'VALID' } };
  const versionWithBuild = {
    id: 'version-1',
    attributes: { appVersionState: 'PREPARE_FOR_SUBMISSION', platform: 'IOS' },
    relationships: { build: { data: linkedBuild } },
  };

  function mockReadinessResponse(pathOverride?: string, response?: unknown, extra: Record<string, unknown> = {}) {
    const responses: Record<string, unknown> = {
      '/apps/1234567890/appStoreVersions': { data: [versionWithBuild], included: [validBuild] },
      '/appStoreVersions/version-1/appStoreVersionLocalizations': {
        data: [mediaLocale('en-US', 'placement-en')],
        included: [screenshotPlacement('placement-en'), screenshotAsset('placement-en')],
      },
      '/appStoreVersions/version-1/build': { data: validBuild },
      '/apps/1234567890/appInfos': { data: [{ id: 'info-1', attributes: { state: 'PREPARE_FOR_SUBMISSION' } }] },
      '/appInfos/info-1/appInfoLocalizations': { data: [{ attributes: { privacyPolicyUrl: 'https://example.com/privacy' } }] },
      '/appInfos/info-1/ageRatingDeclaration': { data: { attributes: { socialMedia: false, socialMediaAgeRestricted: false } } },
      ...extra,
    };
    mocks.apiGet.mockImplementation(async (path: string) => {
      if (path === pathOverride) return response;
      if (path in responses) return responses[path];
      throw new Error(`unexpected path: ${path}`);
    });
  }

  it('로케일 보완 조회를 최대 4개씩 진행하고 원래 로케일 순서를 유지한다', async () => {
    const locales = ['en-US', 'ko', 'ja', 'it', 'de-DE'];
    const pending = new Map<string, () => void>();
    const started: string[] = [];
    mockReadinessResponse('/appStoreVersions/version-1/appStoreVersionLocalizations', {
      data: locales.map((locale) => mediaLocale(locale, `placement-${locale}`)),
    });
    const base = mocks.apiGet.getMockImplementation();
    mocks.apiGet.mockImplementation(async (path: string) => {
      const match = /^\/appStoreVersionLocalizations\/loc-(.+)\/placements$/.exec(path);
      if (!match) return base?.(path);
      const locale = match[1];
      started.push(locale);
      await new Promise<void>((resolve) => { pending.set(locale, resolve); });
      return { data: [] };
    });

    const check = checkAppStoreRisks('1234567890', { versionId: 'version-1' });
    await vi.waitFor(() => expect(started).toEqual(locales.slice(0, 4)));
    pending.get('it')?.();
    await vi.waitFor(() => expect(started).toEqual(locales));
    for (const locale of [...locales].reverse()) pending.get(locale)?.();
    await expect(check).resolves.toEqual(locales.map((locale) => expect.objectContaining({ code: `NO_SCREENSHOTS_${locale}` })));
  });

  it('로케일 목록 응답이 오기 전에 앱 정책 보완 조회를 시작한다', async () => {
    const locsPath = '/appStoreVersions/version-1/appStoreVersionLocalizations';
    let finishLocalizations!: (value: unknown) => void;
    const localizations = new Promise((resolve) => { finishLocalizations = resolve; });
    mockReadinessResponse(locsPath, localizations);

    const check = checkAppStoreRisks('1234567890', { versionId: 'version-1' });
    try {
      await vi.waitFor(() => {
        const paths = mocks.apiGet.mock.calls.map(([path]) => path);
        expect(paths).toContain('/appInfos/info-1/appInfoLocalizations');
        expect(paths).toContain('/appInfos/info-1/ageRatingDeclaration');
      });
    } finally {
      finishLocalizations({ data: [] });
      await check;
    }
  });

  it.each([
    ['/apps/1234567890/appStoreVersions', { meta: {} }, 'API_ERROR_VERSIONS'],
    ['/apps/1234567890/appStoreVersions', { data: [], meta: { paging: { nextCursor: 'next' } } }, 'API_ERROR_VERSIONS_INCOMPLETE'],
    ['/appStoreVersions/version-1/appStoreVersionLocalizations', { data: [null] }, 'API_ERROR_LOCALIZATIONS'],
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

  const policyLocalization = { type: 'appInfoLocalizations', id: 'loc-policy' };
  const ageDeclaration = { type: 'ageRatingDeclarations', id: 'decl-1' };
  const appInfoWithPolicy = {
    id: 'info-1',
    attributes: { state: 'PREPARE_FOR_SUBMISSION' },
    relationships: {
      appInfoLocalizations: { data: [policyLocalization] },
      ageRatingDeclaration: { data: ageDeclaration },
    },
  };
  const includedPolicy = { ...policyLocalization, attributes: { privacyPolicyUrl: 'https://example.com/privacy' } };
  const includedAge = {
    ...ageDeclaration,
    attributes: { socialMedia: false, socialMediaAgeRestricted: false, userGeneratedContent: false },
  };

  it('선택한 앱 정보에 정책과 연령등급이 포함되면 한 번의 조회로 점검한다', async () => {
    mockReadinessResponse('/apps/1234567890/appInfos', {
      data: [appInfoWithPolicy],
      included: [includedPolicy, includedAge],
    });

    await expect(checkAppStoreRisks('1234567890', { versionId: 'version-1' })).resolves.toEqual([]);
    const appInfoCalls = mocks.apiGet.mock.calls.filter(([path]) => path.includes('/appInfos'));
    expect(appInfoCalls).toEqual([['/apps/1234567890/appInfos', expect.objectContaining({
      include: 'appInfoLocalizations,ageRatingDeclaration',
      'limit[appInfoLocalizations]': '10',
      'fields[appInfos]': 'state,appInfoLocalizations,ageRatingDeclaration',
    })]]);
  });

  it.each([
    ['연령 확인 응답 누락', [{
      ...ageDeclaration,
      attributes: { socialMedia: true, socialMediaAgeRestricted: true },
    }]],
    ['연령등급 리소스 중복', [includedAge, includedAge]],
    ['연령등급 리소스 미포함', []],
  ])('%s 때 연령등급만 개별 조회하고 그 결과를 사용한다', async (_reason, ageResources) => {
    mockReadinessResponse('/apps/1234567890/appInfos', {
      data: [appInfoWithPolicy],
      included: [includedPolicy, ...ageResources],
    }, {
      '/appInfos/info-1/ageRatingDeclaration': {
        data: { attributes: { socialMedia: true, socialMediaAgeRestricted: true, ageAssurance: false } },
      },
    });

    const risks = await checkAppStoreRisks('1234567890', { versionId: 'version-1' });
    expect(risks).toEqual([expect.objectContaining({ code: 'SOCIAL_MEDIA_AGE_ASSURANCE_MISSING', level: 'blocker' })]);
    const paths = mocks.apiGet.mock.calls.map(([path]) => path);
    expect(paths.filter((path) => path.startsWith('/appInfos/'))).toEqual(['/appInfos/info-1/ageRatingDeclaration']);
  });

  it('다른 앱 정보에 연결된 개인정보처리방침이 포함되어도 선택한 레코드를 개별 조회한다', async () => {
    const draft = {
      ...appInfoWithPolicy,
      relationships: { ...appInfoWithPolicy.relationships, appInfoLocalizations: { data: [] } },
    };
    const live = {
      id: 'live-info',
      attributes: { state: 'READY_FOR_DISTRIBUTION' },
      relationships: { appInfoLocalizations: { data: [policyLocalization] } },
    };
    mockReadinessResponse('/apps/1234567890/appInfos', {
      data: [live, draft],
      included: [includedPolicy, includedAge],
    }, {
      '/appInfos/info-1/appInfoLocalizations': { data: [] },
    });

    const risks = await checkAppStoreRisks('1234567890', { versionId: 'version-1' });
    expect(risks).toEqual([expect.objectContaining({ code: 'NO_PRIVACY', level: 'blocker' })]);
    const paths = mocks.apiGet.mock.calls.map(([path]) => path);
    expect(paths.filter((path) => path.startsWith('/appInfos/'))).toEqual(['/appInfos/info-1/appInfoLocalizations']);
  });

  it('위험 점검은 교체·운영·심사 레코드보다 편집 가능한 앱 정보를 사용한다', async () => {
    mockReadinessResponse('/apps/1234567890/appInfos', {
      data: [
        { id: 'replaced-info', attributes: { state: 'REPLACED_WITH_NEW_INFO' } },
        { id: 'live-info', attributes: { state: 'READY_FOR_DISTRIBUTION' } },
        { id: 'review-info', attributes: { state: 'WAITING_FOR_REVIEW' } },
        { id: 'info-1', attributes: { state: 'PREPARE_FOR_SUBMISSION' } },
      ],
    });
    await expect(checkAppStoreRisks('1234567890', { versionId: 'version-1' })).resolves.toEqual([]);
    const paths = mocks.apiGet.mock.calls.map(([path]) => path);
    expect(paths.filter((path) => path.startsWith('/appInfos/'))).toEqual([
      '/appInfos/info-1/appInfoLocalizations',
      '/appInfos/info-1/ageRatingDeclaration',
    ]);
  });

  it.each([
    ['IOS', { privacyPolicyText: 'Apple TV privacy notice' }, 'NO_PRIVACY'],
    ['MAC_OS', { privacyPolicyText: 'Apple TV privacy notice' }, 'NO_PRIVACY'],
    ['TV_OS', { privacyPolicyUrl: 'https://example.com/privacy' }, 'NO_PRIVACY'],
    ['TV_OS', { privacyPolicyText: 'Apple TV privacy notice' }, undefined],
  ] as const)('%s의 실제 개인정보처리방침 필드를 확인한다 (%j)', async (platform, attributes, code) => {
    mockReadinessResponse('/apps/1234567890/appInfos', {
      data: [appInfoWithPolicy],
      included: [{ ...includedPolicy, attributes }, includedAge],
    }, {
      '/apps/1234567890/appStoreVersions': {
        data: [{ ...versionWithBuild, attributes: { ...versionWithBuild.attributes, platform } }],
        included: [validBuild],
      },
      '/appInfos/info-1/appInfoLocalizations': { data: [{ attributes }] },
    });

    const risks = await checkAppStoreRisks('1234567890', { versionId: 'version-1' });
    expect(risks).toEqual(code ? [expect.objectContaining({ code, level: 'blocker' })] : []);
    const paths = mocks.apiGet.mock.calls.map(([path]) => path);
    expect(paths.includes('/appInfos/info-1/appInfoLocalizations')).toBe(Boolean(code));
  });

  it('같은 앱 정보 ID에 서로 다른 상태가 반환되면 포함 정책을 확인된 것으로 처리하지 않는다', async () => {
    mockReadinessResponse('/apps/1234567890/appInfos', {
      data: [appInfoWithPolicy, { ...appInfoWithPolicy, attributes: { state: 'READY_FOR_DISTRIBUTION' } }],
      included: [includedPolicy, includedAge],
    });
    const risks = await checkAppStoreRisks('1234567890', { versionId: 'version-1' });
    expect(risks).toEqual([expect.objectContaining({ code: 'API_ERROR_APP_INFO_LINKAGE' })]);
    expect(mocks.apiGet.mock.calls.some(([path]) => path.startsWith('/appInfos/'))).toBe(false);
  });

  it('앱 정보 레코드가 여러 개의 초안이면 개인정보와 연령등급 점검을 중단한다', async () => {
    mockReadinessResponse('/apps/1234567890/appInfos', {
      data: [
        { id: 'info-1', attributes: { state: 'PREPARE_FOR_SUBMISSION' } },
        { id: 'other-info', attributes: { state: 'DEVELOPER_REJECTED' } },
      ],
    });
    const risks = await checkAppStoreRisks('1234567890', { versionId: 'version-1' });
    expect(risks).toEqual([expect.objectContaining({ code: 'API_ERROR_APP_INFO_LINKAGE', level: 'warning' })]);
    expect(mocks.apiGet.mock.calls.some(([path]) => path.startsWith('/appInfos/'))).toBe(false);
  });

  it('개인정보 목록의 현재 페이지에서 정책을 확인하면 점검을 완료한다', async () => {
    mockReadinessResponse('/appInfos/info-1/appInfoLocalizations', {
      data: [{ attributes: { privacyPolicyUrl: 'https://example.com/privacy' } }],
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
    mocks.apiGet.mockResolvedValueOnce({ data: [{ id: 'other-version' }, { ...versionWithBuild, id: 'target-version' }] });

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
      include: 'placements,appScreenshotSets',
      'limit[placements]': '50',
      'limit[appScreenshotSets]': '1',
      'fields[appStoreVersionLocalizations]': 'locale,description,whatsNew,keywords,placements,appScreenshotSets',
      'fields[appAssetLibraryPlacements]': 'placementType,state,image',
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

  it('MCP 출시 플랜이 실제 위험 점검까지 실행해도 버전과 빌드를 한 번만 조회한다', async () => {
    mockReadinessResponse();
    await withClient(async (client) => {
      const result = await client.callTool({
        name: 'appstore_plan_release',
        arguments: { appId: '1234567890', versionId: 'version-1' },
      });
      expect(result.isError).toBeFalsy();
      expect(JSON.stringify(result.content)).toContain('◻︎ 심사 제출');
    }, { env: { MIMI_SEED_TOOLSETS: 'appstore' } });
    const paths = mocks.apiGet.mock.calls.map(([path]) => path);
    expect(paths.filter((path) => path === '/apps/1234567890/appStoreVersions')).toHaveLength(1);
    expect(paths.filter((path) => path.endsWith('/build'))).toHaveLength(0);
  });

  it.each([
    ['API_ERROR_VERSIONS_AMBIGUOUS', {
      data: [versionWithBuild, {
        ...versionWithBuild,
        id: 'mac-version',
        attributes: { ...versionWithBuild.attributes, platform: 'MAC_OS' },
      }],
    }],
    ['API_ERROR_VERSIONS_INCOMPLETE', { data: [versionWithBuild], meta: { paging: { total: 2 } } }],
    ['API_ERROR_VERSIONS_INCOMPLETE', {
      data: [{ ...versionWithBuild, attributes: { platform: 'IOS' } }],
    }],
    ['API_ERROR_VERSIONS_INCOMPLETE', {
      data: [{ ...versionWithBuild, attributes: { appVersionState: 'PREPARE_FOR_SUBMISSION' } }],
    }],
  ] as const)('버전 대상을 검증할 수 없으면 하위 조회를 시작하지 않는다 (%s)', async (code, response) => {
    mockReadinessResponse('/apps/1234567890/appStoreVersions', response);
    await expect(checkAppStoreRisks('1234567890'))
      .resolves.toEqual([expect.objectContaining({ code, level: 'warning' })]);
    expect(mocks.apiGet).toHaveBeenCalledTimes(1);
  });

  it('동일한 빌드의 포함 응답이 충돌하면 상세 상태를 사용한다', async () => {
    mockReadinessResponse('/apps/1234567890/appStoreVersions', {
      data: [versionWithBuild],
      included: [{ ...linkedBuild, attributes: { processingState: 'FAILED' } }, validBuild],
    }, {
      '/appStoreVersions/version-1/build': { data: { ...linkedBuild, attributes: { processingState: 'FAILED' } } },
    });

    const risks = await checkAppStoreRisks('1234567890');
    expect(risks).toEqual([expect.objectContaining({ code: 'BUILD_NOT_READY' })]);
    expect(mocks.apiGet.mock.calls.map(([path]) => path)).toContain('/appStoreVersions/version-1/build');
  });

  it('연결된 빌드가 included에 없으면 해당 버전의 빌드만 상세 조회한다', async () => {
    mockReadinessResponse('/apps/1234567890/appStoreVersions', {
      data: [versionWithBuild],
      included: [{ ...validBuild, id: 'unrelated-build' }],
    });
    await expect(checkAppStoreRisks('1234567890', { versionId: 'version-1' })).resolves.toEqual([]);
    expect(mocks.apiGet).toHaveBeenCalledWith('/appStoreVersions/version-1/build', { 'fields[builds]': 'processingState,version' });
  });

  it.each([
    { data: { ...validBuild, id: 'some-other-build' } },
    { data: { ...validBuild, attributes: {} } },
    { data: null },
  ])('상세 응답으로 목록의 빌드를 확인할 수 없으면 점검 미완료로 표시한다 (%j)', async (detail) => {
    mockReadinessResponse('/apps/1234567890/appStoreVersions', {
      data: [versionWithBuild],
      included: [],
    }, { '/appStoreVersions/version-1/build': detail });
    const risks = await checkAppStoreRisks('1234567890', { versionId: 'version-1' });
    expect(risks).toEqual([expect.objectContaining({ code: 'API_ERROR_BUILD', level: 'warning' })]);
    expect(formatRisks(risks, 'App Store')).toContain('점검 미완료');
  });

  it('처리 실패한 연결 빌드는 단독 위험 점검에서도 제출 차단 사유다', async () => {
    mockReadinessResponse('/apps/1234567890/appStoreVersions', {
      data: [versionWithBuild],
      included: [{ ...linkedBuild, attributes: { processingState: 'FAILED' } }],
    });
    const risks = await checkAppStoreRisks('1234567890', { versionId: 'version-1' });
    expect(risks).toEqual([expect.objectContaining({ code: 'BUILD_NOT_READY', level: 'blocker', detail: expect.stringContaining('FAILED') })]);
    expect(mocks.apiGet.mock.calls.map(([path]) => path)).not.toContain('/appStoreVersions/version-1/build');
  });

  it('대상 버전의 첨부 조회가 실패하면 다른 버전의 빌드로 제출 가능을 표시하지 않는다', async () => {
    mocks.apiGet.mockImplementation(async (path: string) => {
      if (path === '/apps/1234567890/appStoreVersions') return { data: [{ id: 'target-version', attributes: versionWithBuild.attributes, relationships: {} }] };
      if (path.endsWith('/build')) throw new Error('attachment forbidden');
      if (path === '/builds') return { data: [{ id: 'other-build' }] };
      if (path.endsWith('/appStoreVersionLocalizations')) return {
        data: [mediaLocale('en-US', 'placement-en')],
        included: [screenshotPlacement('placement-en'), screenshotAsset('placement-en')],
      };
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
        'filter[appVersionState]':
          'PREPARE_FOR_SUBMISSION,DEVELOPER_REJECTED,METADATA_REJECTED,REJECTED',
      }),
    );
  });

  it('한 번의 로컬라이제이션 조회에서 각 로케일의 배치만 판정한다', async () => {
    mockReadinessResponse('/appStoreVersions/version-1/appStoreVersionLocalizations', {
      data: [
        mediaLocale('ko', 'placement-ko'),
        mediaLocale('en-US'),
        mediaLocale('ja', 'placement-ja'),
      ],
      included: [
        screenshotPlacement('placement-ko'),
        screenshotAsset('placement-ko'),
        screenshotPlacement('placement-ja', 'ASSET_PROCESSING'),
      ],
    });
    const risks = await checkAppStoreRisks('1234567890');
    expect(risks.map(({ code }) => code)).toEqual([
      'NO_SCREENSHOTS_en-US', 'SCREENSHOTS_NOT_READY_ja',
    ]);
    expect(mocks.apiGet.mock.calls.filter(([path]) => /\/(placements|appScreenshotSets)$/.test(path))).toHaveLength(0);
  });

  it.each([
    ['SCREENSHOTS_NOT_READY_en-US', [screenshotAsset('placement-en', 'FAILED')]],
    ['API_ERROR_SCREENSHOTS_en-US', []],
  ] as const)('배치 상태만으로 통과시키지 않고 연결된 원본 상태를 확인한다 (%s)', async (code, assets) => {
    const loc = mediaLocale('en-US', 'placement-en');
    const placement = screenshotPlacement('placement-en', 'ACTIVE');
    mockReadinessResponse('/appStoreVersions/version-1/appStoreVersionLocalizations', {
      data: [{ ...loc, relationships: { placements: loc.relationships.placements } }],
      included: [placement],
    }, {
      '/appStoreVersionLocalizations/loc-en-US/placements': { data: [placement], included: assets },
    });

    const risks = await checkAppStoreRisks('1234567890');
    expect(risks).toEqual([expect.objectContaining({ code })]);
    expect(mocks.apiGet.mock.calls.map(([path]) => path)).toContain('/appStoreVersionLocalizations/loc-en-US/placements');
  });

  it('불완전한 배치 관계만 별도 조회하고 로케일 목록 불완전을 표시한다', async () => {
    mockReadinessResponse('/appStoreVersions/version-1/appStoreVersionLocalizations', {
      data: [mediaLocale('en-US', 'missing-from-included')],
      links: { next: 'https://example.com/localizations?page=2' },
    }, {
      '/appStoreVersionLocalizations/loc-en-US/placements': {
        data: [screenshotPlacement('placement-en', 'ACTIVE')], included: [screenshotAsset('placement-en')],
      },
    });

    const risks = await checkAppStoreRisks('1234567890');
    expect(risks.map(({ code }) => code)).toEqual(['API_ERROR_LOCALIZATIONS_INCOMPLETE']);
    expect(mocks.apiGet).toHaveBeenCalledWith('/appStoreVersionLocalizations/loc-en-US/placements', expect.anything());
  });

  it.each([
    [{ data: [{ id: 'set-en', relationships: { appScreenshots: { data: [] } } }] }, 'NO_SCREENSHOTS_en-US'],
    [legacyScreenshotPage('UPLOAD_COMPLETE'), 'SCREENSHOTS_NOT_READY_en-US'],
    [legacyScreenshotPage('COMPLETE'), undefined],
    [{ data: [], meta: { paging: { total: 1 } } }, 'API_ERROR_SCREENSHOTS_en-US'],
  ] as const)('기존 세트의 실제 이미지와 처리 상태를 조회한다 (%j)', async (legacy, expected) => {
    mockReadinessResponse('/appStoreVersions/version-1/appStoreVersionLocalizations', {
      data: [mediaLocale('en-US', undefined, [{ id: 'set-en' }])],
    }, { '/appStoreVersionLocalizations/loc-en-US/appScreenshotSets': legacy });
    const risks = await checkAppStoreRisks('1234567890');
    expect(risks.map(({ code }) => code)).toEqual(expected ? [expected] : []);
  });

  it('프로젝트의 소셜 기능 사실과 ASC 연령등급 응답 불일치를 blocker로 만든다', async () => {
    mocks.apiGet.mockImplementation(async (path: string) => {
      if (path === '/apps/1234567890/appStoreVersions') return { data: [{ id: 'version-1', attributes: versionWithBuild.attributes }] };
      if (path === '/appStoreVersions/version-1/appStoreVersionLocalizations') return { data: [] };
      if (path === '/appStoreVersions/version-1/build') return { data: validBuild };
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
      if (path === '/apps/1234567890/appStoreVersions') return { data: [{ id: 'version-1', attributes: versionWithBuild.attributes }] };
      if (path === '/appStoreVersions/version-1/appStoreVersionLocalizations') return { data: [] };
      if (path === '/appStoreVersions/version-1/build') return { data: validBuild };
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
      if (path === '/apps/1234567890/appStoreVersions') return { data: [{ id: 'version-1', attributes: versionWithBuild.attributes }] };
      if (path === '/appStoreVersions/version-1/appStoreVersionLocalizations') return { data: [] };
      if (path === '/appStoreVersions/version-1/build') return { data: validBuild };
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
