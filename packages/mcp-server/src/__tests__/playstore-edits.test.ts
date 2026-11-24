import { beforeEach, expect, it, vi } from 'vitest';
import type { OAuth2Client } from 'google-auth-library';
import { listTracks, withEdit } from '../playstore/tools.js';

const api = vi.hoisted(() => ({
  insert: vi.fn(),
  commit: vi.fn(),
  delete: vi.fn(),
  list: vi.fn(),
}));

vi.mock('../lib/googleapis-lite.js', () => ({
  google: {
    androidpublisher: () => ({
      edits: { insert: api.insert, commit: api.commit, delete: api.delete, tracks: { list: api.list } },
    }),
  },
}));

const auth = {} as OAuth2Client;
const app = 'com.example.app';
const otherApp = 'com.example.other';

function signal() {
  let send!: () => void;
  const received = new Promise<void>((resolve) => { send = resolve; });
  return { received, send };
}

beforeEach(() => {
  vi.resetAllMocks();
  let nextEdit = 0;
  api.insert.mockImplementation(() => ({ data: { id: `edit-${++nextEdit}` } }));
  api.commit.mockResolvedValue({});
  api.delete.mockResolvedValue({});
  api.list.mockResolvedValue({ data: { tracks: [] } });
});

it('동일 앱의 읽기 edit은 다른 인증 객체를 써도 쓰기 커밋이 끝날 때까지 기다린다', async () => {
  const commitStarted = signal();
  const finishCommit = signal();
  api.commit.mockImplementationOnce(async () => {
    commitStarted.send();
    await finishCommit.received;
  });

  const write = withEdit(auth, app, async () => 'written', true);
  await commitStarted.received;
  const secondAuth = {} as OAuth2Client;
  const read = listTracks(secondAuth, app);
  try {
    await listTracks(auth, otherApp);
    expect(api.insert.mock.calls.map(([params]) => params.packageName)).toEqual([app, otherApp]);
    expect(api.list).not.toHaveBeenCalledWith(expect.objectContaining({ packageName: app }));
  } finally {
    finishCommit.send();
    await Promise.all([write, read]);
  }
  expect(await write).toBe('written');
  expect(api.insert).toHaveBeenLastCalledWith({ auth: secondAuth, packageName: app });
  expect(api.list).toHaveBeenLastCalledWith({ auth: secondAuth, packageName: app, editId: 'edit-3' });
});

it('같은 앱의 다음 edit은 실패한 읽기의 정리가 끝난 뒤에도 실행된다', async () => {
  const cleanupStarted = signal();
  const finishCleanup = signal();
  api.list.mockRejectedValueOnce(new Error('read failed'));
  api.delete.mockImplementationOnce(async () => {
    cleanupStarted.send();
    await finishCleanup.received;
    throw new Error('cleanup failed');
  });

  const first = expect(listTracks(auth, app)).rejects.toThrow('read failed');
  await cleanupStarted.received;
  const second = listTracks(auth, app);
  const third = listTracks(auth, app);
  try {
    await listTracks(auth, otherApp);
    expect(api.insert.mock.calls.map(([params]) => params.packageName)).toEqual([app, otherApp]);
  } finally {
    finishCleanup.send();
    await Promise.all([first, second, third]);
  }
  expect(api.list.mock.calls.filter(([params]) => params.packageName === app).map(([params]) => params.editId))
    .toEqual(['edit-1', 'edit-3', 'edit-4']);
  expect(api.delete.mock.invocationCallOrder[2]).toBeLessThan(api.insert.mock.invocationCallOrder[3]);
});

it('커밋 전에 쓰기가 실패하면 edit을 폐기한 후 다음 작업을 시작한다', async () => {
  const failed = withEdit(auth, app, async () => { throw new Error('write failed'); }, true);
  const next = listTracks(auth, app);

  await expect(failed).rejects.toThrow('write failed');
  await expect(next).resolves.toEqual([]);
  expect(api.commit).not.toHaveBeenCalled();
  expect(api.delete).toHaveBeenNthCalledWith(1, { auth, packageName: app, editId: 'edit-1' });
  expect(api.delete.mock.invocationCallOrder[0]).toBeLessThan(api.insert.mock.invocationCallOrder[1]);
});
