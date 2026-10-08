import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { OAuth2Client } from 'google-auth-library';

/**
 * Drive 래퍼. 위험한 지점은 셋이다 — files.list q 문자열 주입, 같은 이름 파일의 소리 없는
 * 중복 생성, 공유 드라이브 플래그 누락(서비스 계정 파일이 404 로 보임).
 */

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  get: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
}));

vi.mock('../lib/googleapis-lite.js', () => ({
  google: {
    drive: () => ({ files: { list: mocks.list, get: mocks.get, create: mocks.create, update: mocks.update } }),
  },
}));

import {
  buildListQuery,
  createFolder,
  driveError,
  escapeQueryValue,
  guessMimeType,
  inspectLocalFile,
  listFiles,
  trashFile,
  updateFileContent,
  updateFileMetadata,
  uploadFile,
  FOLDER_MIME,
} from '../drive/tools.js';

const auth = {} as OAuth2Client;
const FOLDER = 'folderId_0123456789';
const FILE = 'fileId_0123456789AB';
const dir = mkdtempSync(path.join(tmpdir(), 'drive-test-'));
const local = path.join(dir, 'clip.mp4');
writeFileSync(local, 'hello video');
const localMd5 = createHash('md5').update('hello video').digest('hex');

afterAll(() => rmSync(dir, { recursive: true, force: true }));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.list.mockResolvedValue({ data: { files: [] } });
});

describe('질의 조립', () => {
  it('이름·MIME 값의 따옴표와 역슬래시를 이스케이프한다', () => {
    expect(escapeQueryValue("a'b\\c")).toBe("a\\'b\\\\c");
    expect(buildListQuery({ folderId: FOLDER, nameContains: "it's" })).toBe(
      `'${FOLDER}' in parents and name contains 'it\\'s' and trashed = false`,
    );
  });

  it('폴더 ID 에 따옴표가 섞이면 질의 전에 거부한다', () => {
    expect(() => buildListQuery({ folderId: "x' or '1'='1" })).toThrow(/형식/);
  });

  it('includeTrashed 면 휴지통 조건을 빼고, root 별칭을 허용한다', () => {
    expect(buildListQuery({ folderId: 'root', includeTrashed: true })).toBe(`'root' in parents`);
  });
});

describe('listFiles', () => {
  it('공유 드라이브를 포함해 조회하고 pageSize 를 1~1000 으로 자른다', async () => {
    mocks.list.mockResolvedValue({ data: { files: [{ id: FILE, name: 'a', mimeType: FOLDER_MIME }], nextPageToken: 'n' } });
    const res = await listFiles(auth, { pageSize: 5000 });
    expect(mocks.list).toHaveBeenCalledWith(expect.objectContaining({
      pageSize: 1000, supportsAllDrives: true, includeItemsFromAllDrives: true, corpora: 'allDrives',
    }));
    expect(res.files[0]).toMatchObject({ id: FILE, isFolder: true });
    expect(res.nextPageToken).toBe('n');
  });
});

describe('createFolder', () => {
  it('같은 이름 폴더가 있으면 만들지 않고 그것을 돌려준다', async () => {
    mocks.list.mockResolvedValue({ data: { files: [{ id: FILE, name: '영상', mimeType: FOLDER_MIME }] } });
    const res = await createFolder(auth, { name: ' 영상 ', parentId: FOLDER });
    expect(res.status).toBe('exists');
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.list.mock.calls[0][0].q).toContain(`name = '영상'`);
  });

  it('없으면 부모 아래 폴더를 만든다', async () => {
    mocks.create.mockResolvedValue({ data: { id: FILE, name: '영상', mimeType: FOLDER_MIME, parents: [FOLDER] } });
    const res = await createFolder(auth, { name: '영상', parentId: FOLDER });
    expect(res.status).toBe('created');
    expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({
      requestBody: { name: '영상', mimeType: FOLDER_MIME, parents: [FOLDER] },
      supportsAllDrives: true,
    }));
  });

  it('reuseExisting=false 면 조회 없이 만든다', async () => {
    mocks.create.mockResolvedValue({ data: { id: FILE, name: 'x', mimeType: FOLDER_MIME } });
    await createFolder(auth, { name: 'x', reuseExisting: false });
    expect(mocks.list).not.toHaveBeenCalled();
  });
});

describe('uploadFile', () => {
  it('같은 이름 파일이 있으면 기본으로 거부하고 교체 도구를 안내한다', async () => {
    mocks.list.mockResolvedValue({ data: { files: [{ id: FILE, name: 'clip.mp4', mimeType: 'video/mp4' }] } });
    await expect(uploadFile(auth, { filePath: local, parentId: FOLDER })).rejects.toThrow(/drive_update_file_content/);
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it('업로드 후 MD5 를 대조한다', async () => {
    mocks.create.mockResolvedValue({ data: { id: FILE, name: 'clip.mp4', mimeType: 'video/mp4', md5Checksum: localMd5 } });
    const res = await uploadFile(auth, { filePath: local, parentId: FOLDER });
    expect(res.verified).toBe(true);
    const [params] = mocks.create.mock.calls[0];
    expect(params.requestBody).toEqual({ name: 'clip.mp4', parents: [FOLDER] });
    expect(params.media.mimeType).toBe('video/mp4');
  });

  it('체크섬이 다르면 verified=false', async () => {
    mocks.create.mockResolvedValue({ data: { id: FILE, name: 'clip.mp4', md5Checksum: 'deadbeef' } });
    const res = await uploadFile(auth, { filePath: local, onConflict: 'create_new' });
    expect(res.verified).toBe(false);
    expect(mocks.list).not.toHaveBeenCalled();
  });
});

describe('inspectLocalFile', () => {
  it('상대 경로·없는 파일·빈 파일을 거부한다', () => {
    expect(() => inspectLocalFile('clip.mp4')).toThrow(/절대 경로/);
    expect(() => inspectLocalFile(path.join(dir, 'none.mp4'))).toThrow(/읽을 수 없어/);
    const empty = path.join(dir, 'empty.srt');
    writeFileSync(empty, '');
    expect(() => inspectLocalFile(empty)).toThrow(/빈 파일/);
    expect(() => inspectLocalFile(dir)).toThrow(/파일이 아니야/);
  });

  it('확장자로 MIME 을 추정하고 모르면 octet-stream', () => {
    expect(guessMimeType('/a/b.SRT')).toBe('application/x-subrip');
    expect(guessMimeType('/a/b.unknown')).toBe('application/octet-stream');
  });
});

describe('updateFileContent', () => {
  it('폴더에는 내용을 올리지 않는다', async () => {
    mocks.get.mockResolvedValue({ data: { id: FILE, name: 'f', mimeType: FOLDER_MIME } });
    await expect(updateFileContent(auth, { fileId: FILE, filePath: local })).rejects.toThrow(/폴더/);
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it('같은 fileId 에 새 내용을 올리고 전후를 돌려준다', async () => {
    mocks.get.mockResolvedValue({ data: { id: FILE, name: 'clip.mp4', mimeType: 'video/mp4', md5Checksum: 'old' } });
    mocks.update.mockResolvedValue({ data: { id: FILE, name: 'clip.mp4', mimeType: 'video/mp4', md5Checksum: localMd5 } });
    const res = await updateFileContent(auth, { fileId: FILE, filePath: local });
    expect(res.before.md5Checksum).toBe('old');
    expect(res.verified).toBe(true);
    expect(mocks.update.mock.calls[0][0]).toMatchObject({ fileId: FILE, supportsAllDrives: true });
  });
});

describe('updateFileMetadata', () => {
  it('바꿀 항목이 없으면 거부한다', async () => {
    await expect(updateFileMetadata(auth, { fileId: FILE })).rejects.toThrow(/하나도 없어/);
  });

  it('이동은 기존 부모를 빼고 새 부모를 넣는다', async () => {
    mocks.get.mockResolvedValue({ data: { id: FILE, name: 'a', parents: ['oldParent_012345'] } });
    mocks.update.mockResolvedValue({ data: { id: FILE, name: 'b', parents: [FOLDER] } });
    await updateFileMetadata(auth, { fileId: FILE, name: 'b', moveToFolderId: FOLDER });
    expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({
      requestBody: { name: 'b' }, addParents: FOLDER, removeParents: 'oldParent_012345',
    }));
  });

  it('이미 그 폴더에 있으면 부모를 건드리지 않는다', async () => {
    mocks.get.mockResolvedValue({ data: { id: FILE, name: 'a', parents: [FOLDER] } });
    mocks.update.mockResolvedValue({ data: { id: FILE, name: 'a', parents: [FOLDER] } });
    await updateFileMetadata(auth, { fileId: FILE, moveToFolderId: FOLDER });
    expect(mocks.update.mock.calls[0][0].addParents).toBeUndefined();
  });
});

describe('trashFile', () => {
  it('영구 삭제가 아니라 trashed=true 로 옮긴다', async () => {
    mocks.get.mockResolvedValue({ data: { id: FILE, name: 'a' } });
    mocks.update.mockResolvedValue({ data: { id: FILE, name: 'a', trashed: true } });
    const res = await trashFile(auth, FILE);
    expect(res.after.trashed).toBe(true);
    expect(mocks.update.mock.calls[0][0].requestBody).toEqual({ trashed: true });
  });
});

describe('driveError', () => {
  const apiError = (code: number, reason: string, message: string) =>
    Object.assign(new Error(message), { code, response: { status: code, data: { error: { code, message, errors: [{ reason }] } } } });

  it('서비스 계정 저장 용량 오류는 공유 드라이브를 안내한다', () => {
    const msg = driveError(apiError(403, 'storageQuotaExceeded', 'Service Accounts do not have storage quota.'), 'service-account').message;
    expect(msg).toMatch(/공유 드라이브/);
  });

  it('404 는 서비스 계정이면 공유를, OAuth 면 drive.file 범위를 안내한다', () => {
    const e = apiError(404, 'notFound', 'File not found: x.');
    const sa = '<service-account>@<project>.iam.gserviceaccount.com';
    expect(driveError(e, 'service-account', sa).message).toContain(sa);
    expect(driveError(e, 'service-account', sa).message).toMatch(/공유/);
    expect(driveError(e, 'user-oauth').message).toMatch(/drive\.file/);
  });
});
