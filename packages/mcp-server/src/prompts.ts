import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

export function registerPrompts(server: McpServer) {
  server.prompt(
    'deploy',
    '앱 출시 전 체크 → 릴리즈 노트 생성 → 스토어 적용까지 한 번에 진행',
    {
      packageName: z.string().optional().describe('Android 패키지명 (Play Store 출시 시)'),
      appId: z.string().optional().describe('App Store 앱 ID (iOS 출시 시)'),
      version: z.string().optional().describe('출시 버전 (예: 1.4.0)'),
      locales: z.string().optional().describe('릴리즈 노트 언어 쉼표 구분 (기본: ko,en-US)'),
    },
    async ({ packageName, appId, version, locales }) => ({
      messages: [{
        role: 'user',
        content: {
          type: 'text',
          text: [
            `${packageName ?? appId ?? '앱'} 출시를 진행해줘.${version ? ` 버전: ${version}` : ''}`,
            '',
            '다음 순서로 진행해:',
            '1. playstore_check_submission_risks 또는 appstore_check_submission_risks 로 블로커 먼저 확인',
            '2. 블로커 있으면 목록 보여주고 수정 방법 제안. 없으면 다음 단계로',
            '3. git log 최근 커밋을 가져와 generate_release_notes_from_commits 로 릴리즈 노트 생성',
            `   언어: ${locales ?? 'ko,en-US'} / 톤: 간결·상세·마케팅 3가지`,
            '4. 생성된 노트 보여주고 적용 여부 확인 (비가역 — 반드시 동의 받을 것)',
            '5. 확인 후 playstore_update_release_notes 또는 appstore_update_whats_new 로 적용',
            '6. 최종 Readiness 상태 요약',
          ].join('\n'),
        },
      }],
    }),
  );

  server.prompt(
    'health',
    '전체 연결 상태 스캔 + 앱 출시 준비도 요약',
    {},
    async () => ({
      messages: [{
        role: 'user',
        content: {
          type: 'text',
          text: [
            '현재 Mimi Seed 연결 상태와 앱 출시 준비도를 요약해줘.',
            '',
            '확인 순서:',
            '1. mimi_seed_status 호출 — 9개 서비스 전체 연결 상태 스캔',
            '2. ❌ 필수 항목(Google OAuth / Play SA / App Store)이 있으면 먼저 설정 안내',
            '3. firebase_list_projects 로 연결된 Firebase 프로젝트 확인 (OAuth 연결 시)',
            '4. playstore_check_submission_risks / appstore_check_submission_risks 로 블로커 점검',
            '5. 다음 권장 액션 제안 (블로커 수정 / 릴리즈 노트 생성 / 출시 실행)',
          ].join('\n'),
        },
      }],
    }),
  );

  server.prompt(
    'review-inbox',
    '미답변 스토어 리뷰 조회 → AI 답변 초안 생성',
    {
      packageName: z.string().optional().describe('Android 패키지명'),
      appId: z.string().optional().describe('App Store 앱 ID'),
      tone: z.enum(['friendly', 'professional', 'empathetic', 'brief']).optional().describe('답변 톤 (기본: empathetic)'),
    },
    async ({ packageName, appId, tone }) => ({
      messages: [{
        role: 'user',
        content: {
          type: 'text',
          text: [
            `${packageName ?? appId ?? '등록된 앱'} 의 최근 스토어 리뷰를 가져와서 답변 초안을 작성해줘.`,
            '',
            '진행 순서:',
            '1. playstore_list_reviews 또는 appstore_list_reviews 로 최근 리뷰 조회',
            '2. 미답변 리뷰를 별점 낮은 순으로 정렬',
            '3. 각 리뷰에 generate_review_reply 로 답변 초안 생성',
            `   톤: ${tone ?? 'empathetic'}`,
            '4. 초안 보여주고 게시 여부 확인 (비가역 — 반드시 동의 받을 것)',
            '5. 확인 후 playstore_reply_review 로 게시',
            '',
            '⚠️ AI 생성 답변은 초안입니다. 게시 전 반드시 검토하세요.',
          ].join('\n'),
        },
      }],
    }),
  );
}
