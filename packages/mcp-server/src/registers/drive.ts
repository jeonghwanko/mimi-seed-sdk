import type { ToolRegistrar } from '../lib/tool-registrar.js';
import { z } from 'zod';
import { GOOGLE_PROFILE_ID, getStoredTokens } from '../auth/google-auth.js';
import { DRIVE_FILE_SCOPE } from '../auth/scopes.js';
import { DRIVE_AUTH_HINT, driveJwt, getDriveServiceAccount, type DriveAuthSource } from '../auth/drive-auth.js';
import { requireAuth } from '../helpers.js';
import { jsonResult, errorResult } from '../lib/mcp-response.js';
import * as drive from '../drive/tools.js';

interface DriveAuth {
  client: drive.DriveClient;
  source: DriveAuthSource;
  clientEmail: string | null;
}

/**
 * Drive 인증 해석: Drive 서비스 계정(환경 변수 > 파일)이 있으면 그것, 없으면 Google OAuth(drive.file).
 * 서비스 계정은 공유받은 기존 폴더·공유 드라이브를 다룰 수 있고, OAuth drive.file 은
 * mimi-seed 가 만든 파일·폴더만 다룬다.
 */
async function resolveDriveAuth(profile?: string): Promise<DriveAuth> {
  const sa = getDriveServiceAccount();
  if (sa) return { client: driveJwt(sa.key), source: sa.source, clientEmail: sa.key.client_email ?? null };
  if (!getStoredTokens(profile)) throw new Error(DRIVE_AUTH_HINT);
  return { client: await requireAuth(DRIVE_FILE_SCOPE, profile), source: 'user-oauth', clientEmail: null };
}

/** 인증 → 호출 → JSON. Drive 오류는 driveError 로 원인별 안내를 붙인다. */
async function withDrive<T>(profile: string | undefined, run: (client: drive.DriveClient) => Promise<T>) {
  let auth: DriveAuth;
  try {
    auth = await resolveDriveAuth(profile);
  } catch (e) {
    return errorResult(e instanceof Error ? e.message : String(e));
  }
  try {
    return jsonResult({ authSource: auth.source, ...((await run(auth.client)) as object) });
  } catch (e) {
    return errorResult(drive.driveError(e, auth.source, auth.clientEmail).message);
  }
}

const profile = z.string().regex(GOOGLE_PROFILE_ID).optional()
  .describe('Google 로그인 프로필 (OAuth 사용 시). Drive 서비스 계정이 설정돼 있으면 무시된다.');
const driveId = (what: string) => z.string().regex(drive.DRIVE_ID_RE).describe(what);
const absPath = z.string().min(1).describe('올릴 로컬 파일의 절대 경로');

export function registerDriveTools(server: ToolRegistrar): void {
  server.tool(
    'drive_auth_status',
    '현재 Google Drive 인증 상태 — Drive 서비스 계정(환경 변수/파일) 또는 Google OAuth(drive.file) 중 무엇이 쓰이는지 확인',
    { profile },
    async ({ profile }) => {
      try {
        const sa = getDriveServiceAccount();
        if (sa) {
          return jsonResult({
            authenticated: true,
            source: sa.source,
            clientEmail: sa.key.client_email,
            note: '대상 폴더나 공유 드라이브를 이 이메일과 공유해야 접근할 수 있다.',
          });
        }
      } catch (e) {
        return errorResult(e instanceof Error ? e.message : String(e));
      }
      const granted = getStoredTokens(profile)?.scope?.split(' ') ?? null;
      if (granted?.includes(DRIVE_FILE_SCOPE)) {
        return jsonResult({
          authenticated: true,
          source: 'user-oauth',
          scope: DRIVE_FILE_SCOPE,
          note: 'drive.file 권한은 mimi-seed 가 만든 파일·폴더만 다룬다. 기존 폴더는 Drive 서비스 계정을 쓴다.',
        });
      }
      return jsonResult({ authenticated: false, hint: DRIVE_AUTH_HINT });
    },
  );

  server.tool(
    'drive_list_files',
    'Google Drive 파일·폴더 목록 조회 — 폴더 ID, 이름 일부, MIME 형식으로 거른다. 공유 드라이브 포함, 기본으로 휴지통 제외.',
    {
      folderId: driveId('이 폴더 바로 아래만 조회 (폴더 ID 또는 "root")').optional(),
      nameContains: z.string().max(255).optional().describe('이름에 포함된 문자열'),
      mimeType: z.string().max(255).optional().describe('MIME 형식 일치 (폴더는 application/vnd.google-apps.folder)'),
      includeTrashed: z.boolean().optional().describe('휴지통 항목 포함 (기본 false)'),
      pageSize: z.number().int().min(1).max(1000).optional().describe('페이지 크기 (기본 100)'),
      pageToken: z.string().optional().describe('이전 응답의 nextPageToken'),
      profile,
    },
    async ({ profile, ...input }) => withDrive(profile, (c) => drive.listFiles(c, input)),
  );

  server.tool(
    'drive_get_file',
    'Google Drive 파일·폴더 하나의 메타데이터(이름, MIME, 크기, MD5, 부모, 링크, 수정 시각) 조회',
    { fileId: driveId('파일 또는 폴더 ID'), profile },
    async ({ fileId, profile }) => withDrive(profile, async (c) => ({ file: await drive.getFile(c, fileId) })),
  );

  server.tool(
    'drive_create_folder',
    'Google Drive 폴더 생성. 부모 안에 같은 이름의 폴더가 이미 있으면 새로 만들지 않고 그 폴더를 돌려준다(status=exists).',
    {
      name: z.string().min(1).max(255).describe('폴더 이름'),
      parentId: driveId('부모 폴더 ID (기본 "root" — 내 드라이브 최상위)').optional(),
      reuseExisting: z.boolean().optional().describe('같은 이름 폴더 재사용 (기본 true). false 면 항상 새로 만든다.'),
      profile,
    },
    async ({ profile, ...input }) => withDrive(profile, (c) => drive.createFolder(c, input)),
  );

  server.tool(
    'drive_upload_file',
    '로컬 파일을 Google Drive 폴더에 새 파일로 업로드 (재개 가능 업로드, 완료 후 MD5 대조). ' +
      '같은 폴더에 같은 이름이 있으면 기본으로 거부한다 — 내용 교체는 drive_update_file_content.',
    {
      filePath: absPath,
      parentId: driveId('올릴 폴더 ID (기본 "root")').optional(),
      name: z.string().min(1).max(255).optional().describe('Drive 에서 쓸 이름 (기본: 로컬 파일 이름)'),
      mimeType: z.string().max(255).optional().describe('MIME 형식 (기본: 확장자로 추정)'),
      onConflict: z.enum(['error', 'create_new']).optional()
        .describe('같은 이름이 있을 때: error(기본) 또는 create_new(하나 더 만든다)'),
      profile,
    },
    async ({ profile, ...input }) => withDrive(profile, (c) => drive.uploadFile(c, input)),
  );

  server.tool(
    'drive_update_file_content',
    '기존 Drive 파일의 내용을 로컬 파일로 교체 — 같은 fileId·공유 링크를 유지하고, Drive 가 이전 버전을 버전 기록에 보관한다. 완료 후 MD5 대조.',
    {
      fileId: driveId('내용을 바꿀 파일 ID'),
      filePath: absPath,
      mimeType: z.string().max(255).optional().describe('MIME 형식 (기본: 확장자로 추정)'),
      profile,
    },
    async ({ profile, ...input }) => withDrive(profile, (c) => drive.updateFileContent(c, input)),
  );

  server.tool(
    'drive_update_file_metadata',
    'Drive 파일·폴더의 이름·설명 변경 또는 다른 폴더로 이동. 하나 이상 지정해야 한다.',
    {
      fileId: driveId('대상 파일 또는 폴더 ID'),
      name: z.string().min(1).max(255).optional().describe('새 이름'),
      description: z.string().max(4000).optional().describe('새 설명'),
      moveToFolderId: driveId('옮겨 갈 폴더 ID').optional(),
      profile,
    },
    async ({ profile, ...input }) => withDrive(profile, (c) => drive.updateFileMetadata(c, input)),
  );

  server.tool(
    'drive_trash_file',
    'Drive 파일·폴더를 휴지통으로 이동 (영구 삭제 아님 — Drive 휴지통에서 30일 안에 되살릴 수 있다).',
    { fileId: driveId('휴지통으로 보낼 파일 또는 폴더 ID'), profile },
    async ({ fileId, profile }) => withDrive(profile, (c) => drive.trashFile(c, fileId)),
  );
}
