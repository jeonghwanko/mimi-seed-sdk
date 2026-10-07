import type { JWT, OAuth2Client } from 'google-auth-library';
import { createHash } from 'node:crypto';
import { createReadStream, statSync } from 'node:fs';
import path from 'node:path';
import { google, type drive_v3 } from '../lib/googleapis-lite.js';
import { mediaUploadOptions } from '../lib/google-timeouts.js';
import {
  authReauthMessage,
  extractHttpStatus,
  googleErrorDetail,
  rawMessage,
  withCause,
} from '../lib/google-errors.js';
import type { DriveAuthSource } from '../auth/drive-auth.js';

/**
 * Google Drive v3 래퍼 — 파일·폴더 조회, 업로드, 내용 갱신, 이름 변경·이동, 휴지통.
 *
 * 모든 호출에 supportsAllDrives 를 싣는다. 서비스 계정은 자기 저장 공간이 없어서 실제로는
 * 공유 드라이브 안에서 일하는 경우가 대부분인데, 이 플래그가 빠지면 공유 드라이브 파일이
 * "없는 파일"(404)로 보인다.
 */

export type DriveClient = OAuth2Client | JWT;

export const FOLDER_MIME = 'application/vnd.google-apps.folder';

const FIELDS =
  'id,name,mimeType,size,md5Checksum,createdTime,modifiedTime,parents,driveId,trashed,webViewLink,description';

/**
 * Drive 파일·폴더 ID. 영숫자·밑줄·하이픈만 허용한다 — 이 값은 files.list 의 q 문자열 안에
 * 그대로 들어가므로, 따옴표가 섞이면 질의가 다른 뜻이 된다. 'root' 는 내 드라이브 최상위 별칭.
 */
export const DRIVE_ID_RE = /^(root|[A-Za-z0-9_-]{10,200})$/;

function assertDriveId(id: string, what: string): void {
  if (!DRIVE_ID_RE.test(id)) throw new Error(`${what} 형식이 올바르지 않아: 영숫자·_·- 만 쓰는 Drive ID 여야 해.`);
}

/** files.list q 문자열 리터럴 이스케이프 (\ 와 ' ). */
export function escapeQueryValue(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

function drive(auth: DriveClient) {
  return google.drive({ version: 'v3', auth: auth });
}

export interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  isFolder: boolean;
  size: number | null;
  md5Checksum: string | null;
  createdTime: string | null;
  modifiedTime: string | null;
  parents: string[];
  driveId: string | null;
  trashed: boolean;
  webViewLink: string | null;
  description: string | null;
}

function toFile(f: drive_v3.Schema$File): DriveFile {
  return {
    id: f.id ?? '',
    name: f.name ?? '',
    mimeType: f.mimeType ?? '',
    isFolder: f.mimeType === FOLDER_MIME,
    size: f.size != null ? Number(f.size) : null,
    md5Checksum: f.md5Checksum ?? null,
    createdTime: f.createdTime ?? null,
    modifiedTime: f.modifiedTime ?? null,
    parents: f.parents ?? [],
    driveId: f.driveId ?? null,
    trashed: f.trashed === true,
    webViewLink: f.webViewLink ?? null,
    description: f.description ?? null,
  };
}

/**
 * Drive 에러를 "무엇을 고칠지"가 보이는 메시지로. 서비스 계정과 OAuth(drive.file) 는
 * 같은 404 라도 원인이 달라 안내를 나눈다.
 */
export function driveError(e: unknown, source?: DriveAuthSource, clientEmail?: string | null): Error {
  const text = rawMessage(e);
  const detail = googleErrorDetail(e);
  const status = extractHttpStatus(e);
  const both = `${text} ${detail ?? ''}`;
  const tail = detail && !text.includes(detail) ? `\nGoogle API: ${detail}` : `\nGoogle API: ${text}`;
  const isSa = source === 'service-account' || source === 'service-account-env';

  const reauth = authReauthMessage(both);
  if (reauth && !isSa) return withCause(new Error(reauth), e);

  if (/storageQuotaExceeded|do not have storage quota/i.test(both)) {
    return withCause(
      new Error(
        [
          '❌ 서비스 계정은 자기 저장 공간이 없어서 "내 드라이브"에는 파일을 만들 수 없어.',
          '→ 공유 드라이브 안의 폴더에 올리거나(서비스 계정을 공유 드라이브 멤버로 추가),',
          '  사용자 OAuth(mimi-seed-auth --domains drive)를 써.',
        ].join('\n') + tail,
      ),
      e,
    );
  }
  if (status === 404 || /notFound|File not found/i.test(both)) {
    const lines = isSa
      ? [
          `❌ 파일·폴더를 찾을 수 없어 — 없거나 서비스 계정${clientEmail ? `(${clientEmail})` : ''}과 공유되지 않았어.`,
          '→ Drive 에서 대상 폴더(또는 공유 드라이브)를 이 서비스 계정 이메일과 공유해 (편집자 이상).',
        ]
      : [
          '❌ 파일·폴더를 찾을 수 없어.',
          '→ OAuth(drive.file) 권한은 mimi-seed 가 만든 파일·폴더만 볼 수 있어.',
          '  기존 폴더를 다루려면 Drive 서비스 계정을 써: npx -y @yoonion/mimi-seed-mcp mimi-seed-drive-auth',
        ];
    return withCause(new Error(lines.join('\n') + tail), e);
  }
  if (status === 403 || /insufficientFilePermissions|forbidden|permission/i.test(both)) {
    return withCause(
      new Error(
        [
          '❌ 이 파일·폴더에 쓸 권한이 없어.',
          isSa
            ? '→ 폴더 공유 권한을 "편집자"(공유 드라이브는 "콘텐츠 관리자") 이상으로 올려.'
            : '→ 이 Google 계정의 권한을 확인하거나 Drive 서비스 계정을 써.',
        ].join('\n') + tail,
      ),
      e,
    );
  }
  return withCause(new Error(`❌ Google Drive 오류: ${text}${detail && !text.includes(detail) ? `\nGoogle API: ${detail}` : ''}`), e);
}

export interface ListFilesInput {
  folderId?: string;
  nameContains?: string;
  mimeType?: string;
  includeTrashed?: boolean;
  pageSize?: number;
  pageToken?: string;
}

/** files.list 의 q 문자열 조립 (테스트가 이스케이프를 고정한다). */
export function buildListQuery(input: ListFilesInput): string {
  const q: string[] = [];
  if (input.folderId) {
    assertDriveId(input.folderId, 'folderId');
    q.push(`'${input.folderId}' in parents`);
  }
  if (input.nameContains) q.push(`name contains '${escapeQueryValue(input.nameContains)}'`);
  if (input.mimeType) q.push(`mimeType = '${escapeQueryValue(input.mimeType)}'`);
  if (!input.includeTrashed) q.push('trashed = false');
  return q.join(' and ');
}

export async function listFiles(auth: DriveClient, input: ListFilesInput) {
  const pageSize = Math.min(Math.max(Math.trunc(input.pageSize ?? 100), 1), 1000);
  const res = await drive(auth).files.list({
    q: buildListQuery(input) || undefined,
    pageSize,
    pageToken: input.pageToken,
    orderBy: 'folder,name',
    fields: `nextPageToken, files(${FIELDS})`,
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
    corpora: 'allDrives',
  });
  return { files: (res.data.files ?? []).map(toFile), nextPageToken: res.data.nextPageToken ?? null };
}

export async function getFile(auth: DriveClient, fileId: string): Promise<DriveFile> {
  assertDriveId(fileId, 'fileId');
  const res = await drive(auth).files.get({ fileId, fields: FIELDS, supportsAllDrives: true });
  return toFile(res.data);
}

/** 부모 폴더 안에서 이름이 정확히 같은 항목(휴지통 제외). 폴더만 찾을지 선택. */
async function findChildByName(
  auth: DriveClient,
  parentId: string,
  name: string,
  kind: 'folder' | 'file',
): Promise<DriveFile | null> {
  const mime = kind === 'folder' ? `mimeType = '${FOLDER_MIME}'` : `mimeType != '${FOLDER_MIME}'`;
  const res = await drive(auth).files.list({
    q: `'${parentId}' in parents and name = '${escapeQueryValue(name)}' and ${mime} and trashed = false`,
    pageSize: 2,
    fields: `files(${FIELDS})`,
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
    corpora: 'allDrives',
  });
  const hit = res.data.files?.[0];
  return hit ? toFile(hit) : null;
}

function cleanName(name: string, what: string): string {
  const trimmed = name.trim();
  if (!trimmed) throw new Error(`${what} 이 비어 있어.`);
  if (trimmed.length > 255) throw new Error(`${what} 은 255자 이하여야 해.`);
  return trimmed;
}

export interface CreateFolderInput {
  name: string;
  parentId?: string;
  /** 같은 이름의 폴더가 부모 안에 이미 있으면 새로 만들지 않고 그것을 돌려준다 (기본 true). */
  reuseExisting?: boolean;
}

export async function createFolder(auth: DriveClient, input: CreateFolderInput) {
  const name = cleanName(input.name, '폴더 이름');
  const parentId = input.parentId ?? 'root';
  assertDriveId(parentId, 'parentId');
  if (input.reuseExisting !== false) {
    const existing = await findChildByName(auth, parentId, name, 'folder');
    if (existing) return { status: 'exists' as const, folder: existing };
  }
  const res = await drive(auth).files.create({
    requestBody: { name, mimeType: FOLDER_MIME, parents: [parentId] },
    fields: FIELDS,
    supportsAllDrives: true,
  });
  return { status: 'created' as const, folder: toFile(res.data) };
}

const MIME_BY_EXT: Record<string, string> = {
  '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.mov': 'video/quicktime', '.webm': 'video/webm', '.mkv': 'video/x-matroska',
  '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.wav': 'audio/wav', '.ogg': 'audio/ogg',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp',
  '.svg': 'image/svg+xml', '.pdf': 'application/pdf', '.zip': 'application/zip', '.json': 'application/json',
  '.txt': 'text/plain', '.md': 'text/markdown', '.csv': 'text/csv', '.html': 'text/html',
  '.srt': 'application/x-subrip', '.vtt': 'text/vtt',
};

/** 확장자 → MIME. 모르면 application/octet-stream (Drive 가 Google 문서로 변환하지 않는다). */
export function guessMimeType(filePath: string): string {
  return MIME_BY_EXT[path.extname(filePath).toLowerCase()] ?? 'application/octet-stream';
}

export interface LocalFile {
  path: string;
  size: number;
  mimeType: string;
}

/** 업로드할 로컬 파일 점검 — 절대 경로, 일반 파일, 비어 있지 않음. */
export function inspectLocalFile(filePath: string, mimeType?: string): LocalFile {
  if (!path.isAbsolute(filePath)) throw new Error('filePath 는 절대 경로여야 해.');
  let size: number;
  try {
    const stat = statSync(filePath);
    if (!stat.isFile()) throw new Error('not-a-file');
    size = stat.size;
  } catch (e) {
    if (e instanceof Error && e.message === 'not-a-file') throw new Error(`파일이 아니야: ${filePath}`, { cause: e });
    throw new Error(`파일을 읽을 수 없어: ${filePath}`, { cause: e });
  }
  if (size === 0) throw new Error(`빈 파일은 올리지 않아: ${filePath}`);
  return { path: filePath, size, mimeType: mimeType ?? guessMimeType(filePath) };
}

/** 로컬 파일 MD5 — 업로드 결과의 md5Checksum 과 비교해 전송 무결성을 확인한다. */
export function md5OfFile(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('md5');
    createReadStream(filePath)
      .on('data', (chunk) => hash.update(chunk))
      .on('error', reject)
      .on('end', () => resolve(hash.digest('hex')));
  });
}

async function verified(local: LocalFile, remote: DriveFile): Promise<boolean | null> {
  if (!remote.md5Checksum) return null; // Google 문서 형식 등은 체크섬이 없다
  return (await md5OfFile(local.path)) === remote.md5Checksum;
}

export interface UploadFileInput {
  filePath: string;
  parentId?: string;
  name?: string;
  mimeType?: string;
  /** 같은 폴더에 같은 이름이 있을 때: error(기본) — 덮어쓰기 대신 drive_update_file_content 를 안내, create_new — 하나 더 만든다. */
  onConflict?: 'error' | 'create_new';
}

export async function uploadFile(auth: DriveClient, input: UploadFileInput) {
  const local = inspectLocalFile(input.filePath, input.mimeType);
  const name = cleanName(input.name ?? path.basename(input.filePath), '파일 이름');
  const parentId = input.parentId ?? 'root';
  assertDriveId(parentId, 'parentId');
  if (input.onConflict !== 'create_new') {
    const existing = await findChildByName(auth, parentId, name, 'file');
    if (existing) {
      throw new Error(
        `같은 폴더에 "${name}" 이 이미 있어 (fileId ${existing.id}). ` +
          '내용을 바꾸려면 drive_update_file_content, 하나 더 만들려면 onConflict="create_new".',
      );
    }
  }
  const res = await drive(auth).files.create(
    {
      requestBody: { name, parents: [parentId] },
      media: { mimeType: local.mimeType, body: createReadStream(local.path) },
      fields: FIELDS,
      supportsAllDrives: true,
    },
    mediaUploadOptions(),
  );
  const file = toFile(res.data);
  return { status: 'uploaded' as const, file, local, verified: await verified(local, file) };
}

export interface UpdateContentInput {
  fileId: string;
  filePath: string;
  mimeType?: string;
}

/** 기존 파일의 내용을 로컬 파일로 교체 (같은 fileId·링크 유지, Drive 가 이전 버전을 보관). */
export async function updateFileContent(auth: DriveClient, input: UpdateContentInput) {
  const local = inspectLocalFile(input.filePath, input.mimeType);
  const before = await getFile(auth, input.fileId);
  if (before.isFolder) throw new Error('폴더에는 내용을 올릴 수 없어.');
  const res = await drive(auth).files.update(
    {
      fileId: input.fileId,
      media: { mimeType: local.mimeType, body: createReadStream(local.path) },
      fields: FIELDS,
      supportsAllDrives: true,
    },
    mediaUploadOptions(),
  );
  const after = toFile(res.data);
  return { status: 'updated' as const, before, after, local, verified: await verified(local, after) };
}

export interface UpdateMetadataInput {
  fileId: string;
  name?: string;
  description?: string;
  moveToFolderId?: string;
}

/** 이름·설명 변경, 다른 폴더로 이동. 하나 이상 바꿔야 한다. */
export async function updateFileMetadata(auth: DriveClient, input: UpdateMetadataInput) {
  if (input.name === undefined && input.description === undefined && input.moveToFolderId === undefined) {
    throw new Error('바꿀 항목(name, description, moveToFolderId)이 하나도 없어.');
  }
  const before = await getFile(auth, input.fileId);
  let addParents: string | undefined;
  let removeParents: string | undefined;
  if (input.moveToFolderId !== undefined) {
    assertDriveId(input.moveToFolderId, 'moveToFolderId');
    if (!before.parents.includes(input.moveToFolderId)) {
      addParents = input.moveToFolderId;
      removeParents = before.parents.join(',') || undefined;
    }
  }
  const requestBody: drive_v3.Schema$File = {};
  if (input.name !== undefined) requestBody.name = cleanName(input.name, '파일 이름');
  if (input.description !== undefined) requestBody.description = input.description;
  const res = await drive(auth).files.update({
    fileId: input.fileId,
    requestBody,
    addParents,
    removeParents,
    fields: FIELDS,
    supportsAllDrives: true,
  });
  return { status: 'updated' as const, before, after: toFile(res.data) };
}

/** 휴지통으로 이동 (30일 안에는 Drive 휴지통에서 되살릴 수 있다). */
export async function trashFile(auth: DriveClient, fileId: string) {
  const before = await getFile(auth, fileId);
  const res = await drive(auth).files.update({
    fileId,
    requestBody: { trashed: true },
    fields: FIELDS,
    supportsAllDrives: true,
  });
  return { status: 'trashed' as const, before, after: toFile(res.data) };
}
