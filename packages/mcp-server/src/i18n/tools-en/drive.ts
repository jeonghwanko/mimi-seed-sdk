/** drive 도구 · 파라미터 설명의 영어 — 키는 한국어 원문 (lib/tool-text.ts). 원문을 고치면 키도 고친다. */
export default {
  '현재 Google Drive 인증 상태 — Drive 서비스 계정(환경 변수/파일) 또는 Google OAuth(drive.file) 중 무엇이 쓰이는지 확인':
    'Current Google Drive authentication status — shows whether a Drive service account (environment variable/file) or Google OAuth (drive.file) is in use',
  'Google 로그인 프로필 (OAuth 사용 시). Drive 서비스 계정이 설정돼 있으면 무시된다.':
    'Google sign-in profile (when using OAuth). Ignored if a Drive service account is configured.',
  'Google Drive 파일·폴더 목록 조회 — 폴더 ID, 이름 일부, MIME 형식으로 거른다. 공유 드라이브 포함, 기본으로 휴지통 제외.':
    'List Google Drive files and folders — filter by folder ID, partial name, or MIME type. Includes shared drives; excludes trash by default.',
  '이 폴더 바로 아래만 조회 (폴더 ID 또는 "root")':
    'List only items directly under this folder (folder ID or "root")',
  '이름에 포함된 문자열':
    'String contained in the name',
  'MIME 형식 일치 (폴더는 application/vnd.google-apps.folder)':
    'Exact MIME type match (folders are application/vnd.google-apps.folder)',
  '휴지통 항목 포함 (기본 false)':
    'Include trashed items (default false)',
  '페이지 크기 (기본 100)':
    'Page size (default 100)',
  'Google Drive 파일·폴더 하나의 메타데이터(이름, MIME, 크기, MD5, 부모, 링크, 수정 시각) 조회':
    'Get the metadata of one Google Drive file or folder (name, MIME, size, MD5, parents, links, modified time)',
  '파일 또는 폴더 ID':
    'File or folder ID',
  'Google Drive 폴더 생성. 부모 안에 같은 이름의 폴더가 이미 있으면 새로 만들지 않고 그 폴더를 돌려준다(status=exists).':
    'Create a Google Drive folder. If a folder with the same name already exists in the parent, returns that folder instead of creating a new one (status=exists).',
  '폴더 이름':
    'Folder name',
  '부모 폴더 ID (기본 "root" — 내 드라이브 최상위)':
    'Parent folder ID (default "root" — top level of My Drive)',
  '같은 이름 폴더 재사용 (기본 true). false 면 항상 새로 만든다.':
    'Reuse an existing folder with the same name (default true). If false, always creates a new one.',
  '로컬 파일을 Google Drive 폴더에 새 파일로 업로드 (재개 가능 업로드, 완료 후 MD5 대조). 같은 폴더에 같은 이름이 있으면 기본으로 거부한다 — 내용 교체는 drive_update_file_content.':
    'Upload a local file as a new file into a Google Drive folder (resumable upload, MD5 verified on completion). By default, refuses if the same name already exists in the folder — to replace content, use drive_update_file_content.',
  '올릴 로컬 파일의 절대 경로':
    'Absolute path of the local file to upload',
  '올릴 폴더 ID (기본 "root")':
    'Destination folder ID (default "root")',
  'Drive 에서 쓸 이름 (기본: 로컬 파일 이름)':
    'Name to use in Drive (default: the local file name)',
  'MIME 형식 (기본: 확장자로 추정)':
    'MIME type (default: inferred from the extension)',
  '같은 이름이 있을 때: error(기본) 또는 create_new(하나 더 만든다)':
    'When the same name exists: error (default) or create_new (creates another one)',
  '기존 Drive 파일의 내용을 로컬 파일로 교체 — 같은 fileId·공유 링크를 유지하고, Drive 가 이전 버전을 버전 기록에 보관한다. 완료 후 MD5 대조.':
    'Replace the content of an existing Drive file with a local file — keeps the same fileId and sharing link, and Drive keeps the previous version in its version history. MD5 verified on completion.',
  '내용을 바꿀 파일 ID':
    'ID of the file whose content to replace',
  'Drive 파일·폴더의 이름·설명 변경 또는 다른 폴더로 이동. 하나 이상 지정해야 한다.':
    'Change the name or description of a Drive file or folder, or move it to another folder. At least one must be specified.',
  '대상 파일 또는 폴더 ID':
    'Target file or folder ID',
  '새 이름':
    'New name',
  '새 설명':
    'New description',
  '옮겨 갈 폴더 ID':
    'ID of the folder to move to',
  'Drive 파일·폴더를 휴지통으로 이동 (영구 삭제 아님 — Drive 휴지통에서 30일 안에 되살릴 수 있다).':
    'Move a Drive file or folder to the trash (not a permanent delete — it can be restored from the Drive trash within 30 days).',
  '휴지통으로 보낼 파일 또는 폴더 ID':
    'ID of the file or folder to move to the trash',
} satisfies Record<string, string>;
