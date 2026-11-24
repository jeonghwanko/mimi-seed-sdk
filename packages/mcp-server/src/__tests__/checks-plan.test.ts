import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { OAuth2Client } from 'google-auth-library';

/**
 * 배포 플랜 빌더 — read-only 지만 **에이전트가 무엇을 호출할지**를 결정하는 문서다.
 * 여기서 blocker 를 pending 으로 잘못 표시하면 그 다음 호출은 실제 스토어 제출이다.
 *
 * 특히 지키는 것:
 *   - 비가역 단계는 블로커가 하나라도 있으면 반드시 'blocked'
 *   - 조회 실패는 조용히 통과하지 않고 blocked 로 끝나며 그 뒤 단계를 만들지 않는다
 *   - 비가역 표시(⚠️)와 TodoWrite 지시문이 응답에서 사라지지 않는다
 */

const mocks = vi.hoisted(() => ({
  apiGet: vi.fn(),
  withEdit: vi.fn(),
  publisher: vi.fn(),
  checkPlayStoreRisksInEdit: vi.fn(),
  checkAppStoreVersionRisks: vi.fn(),
}));

vi.mock('../appstore/client.js', async (original) => ({
  ...(await original<typeof import('../appstore/client.js')>()),
  apiGet: mocks.apiGet,
}));
vi.mock('../playstore/tools.js', () => ({
  withEdit: mocks.withEdit,
  publisher: mocks.publisher,
}));
vi.mock('../checks/risks.js', async (original) => ({
  ...(await original<typeof import('../checks/risks.js')>()),
  checkPlayStoreRisksInEdit: mocks.checkPlayStoreRisksInEdit,
  checkAppStoreVersionRisks: mocks.checkAppStoreVersionRisks,
}));

import { buildPlayStoreReleasePlan, buildAppStoreReleasePlan } from '../checks/plan.js';

const auth = {} as OAuth2Client;
const PKG = 'com.example.app';

/** withEdit(auth, pkg, fn) — 실제 구현처럼 콜백에 editId 를 넘겨 실행한다. */
function editSucceeds(tracks: unknown) {
  const list = vi.fn().mockResolvedValue(tracks);
  mocks.publisher.mockReturnValue({
    edits: {
      tracks: { list },
    },
  });
  mocks.withEdit.mockImplementation(
    async (_a: unknown, _p: unknown, fn: (editId: string) => Promise<unknown>) => fn('edit-1'),
  );
  return list;
}

const trackWith = (versionCodes: string[], status = 'draft') => ({
  data: { tracks: [{ track: 'production', releases: [{ versionCodes, status }] }] },
});

beforeEach(() => {
  vi.resetAllMocks();
  mocks.checkPlayStoreRisksInEdit.mockResolvedValue([]);
  mocks.checkAppStoreVersionRisks.mockResolvedValue([]);
});

describe('buildPlayStoreReleasePlan', () => {
  it('빌드 도착 + 위험 0 이면 제출 단계가 pending 이고 비가역 표시가 붙는다', async () => {
    editSucceeds(trackWith(['42']));

    const plan = await buildPlayStoreReleasePlan({
      auth, packageName: PKG, versionCode: '42', track: 'production', language: 'ko-KR',
    });

    expect(plan).toContain('☑︎ production 트랙에 versionCode 42 도착 확인');
    expect(plan).toContain('☑︎ 제출 위험 점검 통과 (블로커 0)');
    expect(plan).toMatch(/◻︎ production 트랙 release status 변경 \(draft → completed\) ⚠️ 비가역/);
    expect(plan).toContain('진행률: ☑︎ 3  ◻︎ 2  ⛔ 0');
    // 블로커 0 이면 경고 배너는 나오지 않는다 (있으면 헛경보).
    expect(plan).not.toContain('⚠️  블로커');
  });

  it('버전 생략 시 확인한 최신 코드 하나로 점검과 노트 적용 대상을 고정한다', async () => {
    const snapshot = trackWith(['41', '45', '42']).data.tracks;
    const list = editSucceeds({ data: { tracks: snapshot } });
    const plan = await buildPlayStoreReleasePlan({ auth, packageName: PKG, track: 'production', language: 'ko-KR' });

    expect(mocks.withEdit).toHaveBeenCalledTimes(1);
    expect(list).toHaveBeenCalledExactlyOnceWith({ auth, packageName: PKG, editId: 'edit-1' });
    expect(mocks.checkPlayStoreRisksInEdit).toHaveBeenCalledExactlyOnceWith(
      auth, PKG, 'edit-1', 'ko-KR', { track: 'production', versionCode: '45' }, snapshot,
    );
    expect(plan).toContain('playstore_update_release_notes (track=production, versionCode=45)');
    expect(plan).toContain('playstore_submit_release (track=production, versionCode=45)');
  });

  it('블로커가 있으면 제출 단계를 pending 으로 열어주지 않는다', async () => {
    editSucceeds(trackWith(['42']));
    mocks.checkPlayStoreRisksInEdit.mockResolvedValue([
      { code: 'NO_SCREENSHOT', level: 'blocker', title: '스크린샷 없음', detail: '최소 2장 필요' },
    ]);

    const plan = await buildPlayStoreReleasePlan({
      auth, packageName: PKG, track: 'production', language: 'ko-KR',
    });

    expect(plan).toMatch(/⛔ production 트랙 release status 변경/);
    expect(plan).toContain('블로커 해결 후 가능');
    expect(plan).toContain('[NO_SCREENSHOT] 스크린샷 없음');
  });

  it('트랙에 릴리즈가 없으면 빌드 단계와 제출 단계가 모두 blocked', async () => {
    editSucceeds(trackWith([]));

    const plan = await buildPlayStoreReleasePlan({
      auth, packageName: PKG, track: 'production', language: 'ko-KR',
    });

    expect(plan).toContain('⛔ production 트랙에 release 없음');
    expect(plan).toMatch(/⛔ production 트랙 release status 변경/);
  });

  it('지정한 versionCode 가 트랙에 없으면 blocked (다른 코드가 있어도)', async () => {
    editSucceeds(trackWith(['41']));

    const plan = await buildPlayStoreReleasePlan({
      auth, packageName: PKG, versionCode: '42', track: 'production', language: 'ko-KR',
    });

    expect(plan).toContain('⛔ production 트랙에 versionCode 42 없음');
  });

  it('인증/조회 실패는 blocked 로 끝나고 이후 단계를 만들지 않는다', async () => {
    editSucceeds({}).mockRejectedValue(new Error('403 permission denied'));

    const plan = await buildPlayStoreReleasePlan({
      auth, packageName: PKG, track: 'production', language: 'ko-KR',
    });

    expect(plan).toContain('⛔ Google Play 인증 또는 트랙 조회 실패');
    expect(plan).toContain('403 permission denied');
    // 조회가 안 됐는데 제출 단계를 그려주면 에이전트가 그걸 따라간다.
    expect(plan).not.toContain('release status 변경');
    expect(mocks.checkPlayStoreRisksInEdit).not.toHaveBeenCalled();
  });

  it('경고만 있으면 blocked 가 아니라 pending 이다', async () => {
    editSucceeds(trackWith(['42']));
    mocks.checkPlayStoreRisksInEdit.mockResolvedValue([
      { code: 'SHORT_DESC', level: 'warning', title: '짧은 설명 미흡', detail: '개선 권장' },
    ]);

    const plan = await buildPlayStoreReleasePlan({
      auth, packageName: PKG, versionCode: '42', track: 'production', language: 'ko-KR',
    });

    expect(plan).toMatch(/◻︎ 제출 위험 1건 \(블로커 0 \/ 경고 1\)/);
    expect(plan).toMatch(/◻︎ production 트랙 release status 변경/);
  });
});

describe('buildAppStoreReleasePlan', () => {
  const linkedBuild = { id: 'build-1', type: 'builds' };
  const validBuild = { ...linkedBuild, attributes: { processingState: 'VALID' } };
  const versionRow = {
    id: 'v-1',
    attributes: { versionString: '1.3.0', appVersionState: 'PREPARE_FOR_SUBMISSION', platform: 'IOS' },
    relationships: { build: { data: linkedBuild } },
  };
  const versionsResponse = { data: [versionRow], included: [validBuild] };

  it('버전 + 빌드 연결 + 위험 0 이면 제출이 pending', async () => {
    mocks.apiGet.mockResolvedValueOnce(versionsResponse);

    const plan = await buildAppStoreReleasePlan({ appId: '1234567890', versionString: '1.3.0' });

    expect(plan).toContain('☑︎ 편집 가능한 버전 발견 (1.3.0, state=PREPARE_FOR_SUBMISSION)');
    expect(plan).toContain('☑︎ 버전에 빌드 연결됨');
    expect(plan).toMatch(/◻︎ 심사 제출 \(reviewSubmissions v2\) ⚠️ 비가역/);
    expect(plan).toContain('appstore_submit_for_review (versionId=v-1)');
    expect(mocks.checkAppStoreVersionRisks).toHaveBeenCalledWith('1234567890', expect.objectContaining({ id: 'v-1', platform: 'IOS' }));
    expect(mocks.apiGet).toHaveBeenCalledTimes(1);
    expect(mocks.apiGet).toHaveBeenCalledWith('/apps/1234567890/appStoreVersions', expect.objectContaining({
      include: 'build',
      'fields[builds]': 'processingState',
    }));
  });

  it('같은 버전 문자열이 여러 플랫폼에 있으면 대상 ID가 필요하다', async () => {
    const ios = { id: 'v-ios', attributes: { ...versionRow.attributes } };
    const mac = { id: 'v-mac', attributes: { versionString: '1.3.0', platform: 'MAC_OS', appStoreState: 'METADATA_REJECTED' } };
    mocks.apiGet.mockResolvedValueOnce({ data: [ios, mac] });
    const ambiguous = await buildAppStoreReleasePlan({ appId: '1234567890', versionString: '1.3.0' });
    expect(ambiguous).toContain('App Store 버전 대상을 하나로 확정할 수 없음');
    expect(ambiguous).not.toContain('appstore_update_whats_new');
    expect(mocks.checkAppStoreVersionRisks).not.toHaveBeenCalled();

    mocks.apiGet.mockResolvedValueOnce({ data: [mac] }).mockResolvedValueOnce({ data: validBuild });
    const pinned = await buildAppStoreReleasePlan({ appId: '1234567890', versionId: 'v-mac' });
    expect(pinned).toContain('1.3.0 / MAC_OS');
    expect(pinned).toContain('appstore_submit_for_review (versionId=v-mac)');
    expect(mocks.checkAppStoreVersionRisks).toHaveBeenCalledWith('1234567890', expect.objectContaining({ id: 'v-mac', platform: 'MAC_OS' }));
    expect(mocks.apiGet).toHaveBeenCalledWith('/appStoreVersions/v-mac/build', { 'fields[builds]': 'processingState' });
    expect(mocks.apiGet).toHaveBeenCalledWith('/apps/1234567890/appStoreVersions', expect.objectContaining({
      'filter[id]': 'v-mac',
      'filter[appVersionState]': expect.stringContaining('METADATA_REJECTED'),
    }));
  });

  it('빌드가 안 붙어 있으면 위험이 0이어도 제출은 blocked', async () => {
    mocks.apiGet.mockResolvedValueOnce({ data: [{ ...versionRow, relationships: { build: { data: null } } }] });

    const plan = await buildAppStoreReleasePlan({ appId: '1234567890' });

    expect(plan).toContain('⛔ 버전에 빌드 미연결');
    expect(plan).toMatch(/⛔ 심사 제출/);
    expect(mocks.apiGet).toHaveBeenCalledTimes(1);
  });

  it.each(['PROCESSING', 'FAILED', 'INVALID'])('연결 빌드가 %s이면 제출을 막고 상세 조회를 생략한다', async (processingState) => {
    mocks.apiGet.mockResolvedValueOnce({
      data: [versionRow],
      included: [{ ...linkedBuild, attributes: { processingState } }],
    });
    const plan = await buildAppStoreReleasePlan({ appId: '1234567890', versionId: 'v-1' });
    expect(plan).toContain('⛔ 연결된 빌드 처리 미완료');
    expect(plan).toContain(processingState);
    expect(plan).toContain('⛔ 심사 제출');
    expect(mocks.apiGet).toHaveBeenCalledTimes(1);
  });

  it('두 번째 페이지가 남아 있으면 첫 페이지의 버전을 자동 선택하지 않는다', async () => {
    mocks.apiGet.mockResolvedValueOnce({ ...versionsResponse, meta: { paging: { total: 2 } } });
    const plan = await buildAppStoreReleasePlan({ appId: '1234567890' });
    expect(plan).toContain('App Store 버전 대상을 하나로 확정할 수 없음');
    expect(mocks.checkAppStoreVersionRisks).not.toHaveBeenCalled();
    expect(mocks.apiGet).toHaveBeenCalledTimes(1);
  });

  it('편집 가능한 버전이 없으면 blocked', async () => {
    mocks.apiGet.mockResolvedValueOnce({ data: [] });

    const plan = await buildAppStoreReleasePlan({ appId: '1234567890', versionString: '9.9.9' });

    expect(plan).toContain('⛔ 편집 가능한 9.9.9 버전 없음');
    expect(plan).toMatch(/⛔ 심사 제출/);
  });

  it('버전이 일치하고 빌드가 연결돼도 조회 미완료면 노트 적용과 제출을 막는다', async () => {
    mocks.apiGet.mockResolvedValueOnce(versionsResponse);
    mocks.checkAppStoreVersionRisks.mockResolvedValue([
      { code: 'API_ERROR_SCREENSHOTS_en-US', level: 'warning', title: '스크린샷 조회 실패', detail: '403' },
    ]);
    const plan = await buildAppStoreReleasePlan({ appId: '1234567890', versionString: '1.3.0' });
    expect(plan).toContain('점검 미완료');
    expect(plan).toContain("⛔ What's New");
    expect(plan).toContain('⛔ 심사 제출');
  });

  it('블로커가 있으면 빌드가 붙어 있어도 제출은 blocked', async () => {
    mocks.apiGet.mockResolvedValueOnce(versionsResponse);
    mocks.checkAppStoreVersionRisks.mockResolvedValue([
      { code: 'NO_SCREENSHOT', level: 'blocker', title: '스크린샷 없음', detail: '필수' },
    ]);

    const plan = await buildAppStoreReleasePlan({ appId: '1234567890' });

    expect(plan).toMatch(/⛔ 심사 제출/);
    expect(plan).toContain('블로커 해결 후 가능');
  });
});

describe('플랜 응답의 계약', () => {
  it('TodoWrite 지시문과 비가역 도구 경고가 항상 붙는다', async () => {
    editSucceeds(trackWith(['42']));

    const plan = await buildPlayStoreReleasePlan({
      auth, packageName: PKG, track: 'production', language: 'ko-KR',
    });

    // 이 문구가 사라지면 에이전트가 확인 없이 제출 도구로 직행할 수 있다 — agent-guide 의 계약.
    expect(plan).toContain('📋 [AI 지시 — 호출자 에이전트 전용]');
    expect(plan).toContain('사용자가 진행에 명시적으로 동의하기 전엔 ⚠️ 비가역 도구를 호출하지 마세요');
    expect(plan).toContain('appstore_submit_for_review');
  });
});
