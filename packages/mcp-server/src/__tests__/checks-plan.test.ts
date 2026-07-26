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
  checkPlayStoreRisks: vi.fn(),
  checkAppStoreRisks: vi.fn(),
}));

vi.mock('../appstore/tools.js', () => ({ apiGet: mocks.apiGet }));
vi.mock('../playstore/tools.js', () => ({
  withEdit: mocks.withEdit,
  publisher: mocks.publisher,
}));
vi.mock('../checks/risks.js', () => ({
  checkPlayStoreRisks: mocks.checkPlayStoreRisks,
  checkAppStoreRisks: mocks.checkAppStoreRisks,
}));

import { buildPlayStoreReleasePlan, buildAppStoreReleasePlan } from '../checks/plan.js';

const auth = {} as OAuth2Client;
const PKG = 'com.example.app';

/** withEdit(auth, pkg, fn) — 실제 구현처럼 콜백에 editId 를 넘겨 실행한다. */
function editSucceeds(tracks: unknown, listing: unknown) {
  mocks.publisher.mockReturnValue({
    edits: {
      tracks: { list: vi.fn().mockResolvedValue(tracks) },
      listings: { get: vi.fn().mockResolvedValue(listing) },
    },
  });
  mocks.withEdit.mockImplementation(
    async (_a: unknown, _p: unknown, fn: (editId: string) => Promise<unknown>) => fn('edit-1'),
  );
}

const trackWith = (versionCodes: string[], status = 'draft') => ({
  data: { tracks: [{ track: 'production', releases: [{ versionCodes, status }] }] },
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.checkPlayStoreRisks.mockResolvedValue([]);
  mocks.checkAppStoreRisks.mockResolvedValue([]);
});

describe('buildPlayStoreReleasePlan', () => {
  it('빌드 도착 + 위험 0 이면 제출 단계가 pending 이고 비가역 표시가 붙는다', async () => {
    editSucceeds(trackWith(['42']), { data: { title: 'My App' } });

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

  it('블로커가 있으면 제출 단계를 pending 으로 열어주지 않는다', async () => {
    editSucceeds(trackWith(['42']), { data: { title: 'My App' } });
    mocks.checkPlayStoreRisks.mockResolvedValue([
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
    editSucceeds(trackWith([]), { data: { title: 'My App' } });

    const plan = await buildPlayStoreReleasePlan({
      auth, packageName: PKG, track: 'production', language: 'ko-KR',
    });

    expect(plan).toContain('⛔ production 트랙에 release 없음');
    expect(plan).toMatch(/⛔ production 트랙 release status 변경/);
  });

  it('지정한 versionCode 가 트랙에 없으면 blocked (다른 코드가 있어도)', async () => {
    editSucceeds(trackWith(['41']), { data: { title: 'My App' } });

    const plan = await buildPlayStoreReleasePlan({
      auth, packageName: PKG, versionCode: '42', track: 'production', language: 'ko-KR',
    });

    expect(plan).toContain('⛔ production 트랙에 versionCode 42 없음');
  });

  it('인증/조회 실패는 blocked 로 끝나고 이후 단계를 만들지 않는다', async () => {
    mocks.withEdit.mockRejectedValue(new Error('403 permission denied'));

    const plan = await buildPlayStoreReleasePlan({
      auth, packageName: PKG, track: 'production', language: 'ko-KR',
    });

    expect(plan).toContain('⛔ Google Play 인증 또는 트랙 조회 실패');
    expect(plan).toContain('403 permission denied');
    // 조회가 안 됐는데 제출 단계를 그려주면 에이전트가 그걸 따라간다.
    expect(plan).not.toContain('release status 변경');
    expect(mocks.checkPlayStoreRisks).not.toHaveBeenCalled();
  });

  it('경고만 있으면 blocked 가 아니라 pending 이다', async () => {
    editSucceeds(trackWith(['42']), { data: { title: 'My App' } });
    mocks.checkPlayStoreRisks.mockResolvedValue([
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
  const versionsResponse = {
    data: [{ id: 'v-1', attributes: { versionString: '1.3.0', appStoreState: 'PREPARE_FOR_SUBMISSION' } }],
  };

  it('버전 + 빌드 연결 + 위험 0 이면 제출이 pending', async () => {
    mocks.apiGet
      .mockResolvedValueOnce(versionsResponse)
      .mockResolvedValueOnce({ data: { id: 'build-1' } });

    const plan = await buildAppStoreReleasePlan({ appId: '1234567890', versionString: '1.3.0' });

    expect(plan).toContain('☑︎ 편집 가능한 버전 발견 (1.3.0, state=PREPARE_FOR_SUBMISSION)');
    expect(plan).toContain('☑︎ 버전에 빌드 연결됨');
    expect(plan).toMatch(/◻︎ 심사 제출 \(reviewSubmissions v2\) ⚠️ 비가역/);
    expect(plan).toContain('appstore_submit_for_review (versionId=v-1)');
  });

  it('빌드가 안 붙어 있으면 위험이 0이어도 제출은 blocked', async () => {
    mocks.apiGet
      .mockResolvedValueOnce(versionsResponse)
      .mockResolvedValueOnce({ data: null });

    const plan = await buildAppStoreReleasePlan({ appId: '1234567890' });

    expect(plan).toContain('⛔ 버전에 빌드 미연결');
    expect(plan).toMatch(/⛔ 심사 제출/);
  });

  it('편집 가능한 버전이 없으면 blocked', async () => {
    mocks.apiGet.mockResolvedValueOnce({ data: [] });

    const plan = await buildAppStoreReleasePlan({ appId: '1234567890', versionString: '9.9.9' });

    expect(plan).toContain('⛔ 편집 가능한 9.9.9 버전 없음');
    expect(plan).toMatch(/⛔ 심사 제출/);
  });

  it('블로커가 있으면 빌드가 붙어 있어도 제출은 blocked', async () => {
    mocks.apiGet
      .mockResolvedValueOnce(versionsResponse)
      .mockResolvedValueOnce({ data: { id: 'build-1' } });
    mocks.checkAppStoreRisks.mockResolvedValue([
      { code: 'NO_SCREENSHOT', level: 'blocker', title: '스크린샷 없음', detail: '필수' },
    ]);

    const plan = await buildAppStoreReleasePlan({ appId: '1234567890' });

    expect(plan).toMatch(/⛔ 심사 제출/);
    expect(plan).toContain('블로커 해결 후 가능');
  });
});

describe('플랜 응답의 계약', () => {
  it('TodoWrite 지시문과 비가역 도구 경고가 항상 붙는다', async () => {
    editSucceeds(trackWith(['42']), { data: { title: 'My App' } });

    const plan = await buildPlayStoreReleasePlan({
      auth, packageName: PKG, track: 'production', language: 'ko-KR',
    });

    // 이 문구가 사라지면 에이전트가 확인 없이 제출 도구로 직행할 수 있다 — agent-guide 의 계약.
    expect(plan).toContain('📋 [AI 지시 — 호출자 에이전트 전용]');
    expect(plan).toContain('사용자가 진행에 명시적으로 동의하기 전엔 ⚠️ 비가역 도구를 호출하지 마세요');
    expect(plan).toContain('appstore_submit_for_review');
  });
});
