import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { OAuth2Client } from 'google-auth-library';

const api = vi.hoisted(() => ({ insert: vi.fn(), commit: vi.fn(), delete: vi.fn(), get: vi.fn(), update: vi.fn() }));
vi.mock('../lib/googleapis-lite.js', () => ({ google: { androidpublisher: () => ({ edits: {
  insert: api.insert, commit: api.commit, delete: api.delete,
  tracks: { get: api.get, update: api.update },
} }) } }));
import { promoteRelease, submitRelease } from '../playstore/tools.js';
const auth = {} as OAuth2Client;
const oldRelease = { name: 'old', versionCodes: ['10'], status: 'completed' };
const target = { name: 'new', versionCodes: ['11'], status: 'draft', userFraction: 0.2,
  releaseNotes: [{ language: 'en-US', text: 'Bug fixes.' }] };

beforeEach(() => {
  vi.resetAllMocks();
  api.insert.mockResolvedValue({ data: { id: 'edit-1' } });
  api.commit.mockResolvedValue({ data: {} });
  api.get.mockResolvedValue({ data: { releases: [structuredClone(target), structuredClone(oldRelease)] } });
  api.update.mockImplementation(async ({ requestBody }: { requestBody: unknown }) => ({ data: requestBody }));
});

describe('Play 릴리스 제출', () => {
  it('기존 draft를 completed로 바꾸면 completed는 대상 하나이고 노트를 보존한다', async () => {
    await submitRelease(auth, 'com.example.app', 'production', '11', 'completed');
    expect(api.update.mock.calls[0][0].requestBody.releases).toEqual([
      { name: target.name, versionCodes: ['11'], status: 'completed', releaseNotes: target.releaseNotes },
    ]);
    expect(api.commit).toHaveBeenCalledOnce();
  });
  it('대상이 없으면 트랙 쓰기와 커밋을 하지 않는다', async () => {
    await expect(submitRelease(auth, 'com.example.app', 'production', '99')).rejects.toThrow('99');
    expect(api.update).not.toHaveBeenCalled();
    expect(api.commit).not.toHaveBeenCalled();
  });
  it('draft 변경은 다른 릴리스를 유지한다', async () => {
    await submitRelease(auth, 'com.example.app', 'production', '11', 'draft');
    expect(api.update.mock.calls[0][0].requestBody.releases).toEqual([target, oldRelease]);
  });
  it('심사 자동 전송 거부를 커밋 성공과 구분해 반환한다', async () => {
    api.commit.mockRejectedValueOnce(new Error('Please set changesNotSentForReview to true.')).mockResolvedValueOnce({ data: {} });
    const result = await submitRelease(auth, 'com.example.app', 'production', '11');
    expect(result).toMatchObject({ committed: true, changesNotSentForReview: true });
    expect(result.nextAction).toContain('Play Console');
  });
  it('커밋 실패를 성공으로 반환하지 않는다', async () => {
    api.commit.mockRejectedValue(new Error('Permission denied'));
    await expect(submitRelease(auth, 'com.example.app', 'production', '11')).rejects.toThrow('Permission denied');
  });
});

describe('Play 트랙 승격', () => {
  it.each([true, false])('대상 draft 존재=%s 에 관계없이 completed 승격은 대상 하나로 교체한다', async (exists) => {
    api.get.mockResolvedValueOnce({ data: { releases: [target] } })
      .mockResolvedValueOnce({ data: { releases: exists ? [target, oldRelease] : [oldRelease] } });
    await promoteRelease(auth, 'com.example.app', 'internal', 'production', '11');
    expect(api.update.mock.calls[0][0].requestBody.releases).toEqual([
      { name: target.name, versionCodes: ['11'], status: 'completed', releaseNotes: target.releaseNotes },
    ]);
    expect(api.commit).toHaveBeenCalledOnce();
  });
  it('draft 승격은 기존 completed를 유지한다', async () => {
    await promoteRelease(auth, 'com.example.app', 'internal', 'production', '11', { status: 'draft' });
    expect(api.update.mock.calls[0][0].requestBody.releases).toHaveLength(2);
    expect(api.update.mock.calls[0][0].requestBody.releases[1]).toEqual(oldRelease);
  });
  it('같은 트랙 승격은 API 호출 전에 거부한다', async () => {
    await expect(promoteRelease(auth, 'com.example.app', 'production', 'production', '11')).rejects.toThrow('같아');
    expect(api.insert).not.toHaveBeenCalled();
  });
});
