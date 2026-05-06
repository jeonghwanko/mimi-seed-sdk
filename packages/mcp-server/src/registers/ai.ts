import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { generateReleaseNotesFromCommits, formatGeneratedNotes } from '../ai/notes.js';
import { generateReviewReply, formatReviewReply } from '../ai/review.js';

export function registerAiTools(server: McpServer) {
  server.tool(
    'generate_release_notes_from_commits',
    [
      'git 커밋 내역을 받아 Claude AI로 앱 스토어용 릴리즈 노트를 생성합니다.',
      '3가지 톤(간결/상세/마케팅)과 다국어 버전을 동시에 생성합니다.',
      'ANTHROPIC_API_KEY 환경변수가 필요합니다.',
      'commits: [{ message, author?, date? }] 형태로 전달하세요.',
      'locales: 다국어 생성할 로케일 배열 (예: ["ko", "en-US", "ja"])',
      '생성 후 playstore_update_release_notes 또는 appstore_update_whats_new로 적용하세요.',
    ].join(' '),
    {
      commits: z.array(z.object({
        message: z.string(),
        hash: z.string().optional(),
        author: z.string().optional(),
        date: z.string().optional(),
      })).describe('git 커밋 배열'),
      appName: z.string().optional().describe('앱 이름 (프롬프트 맥락용)'),
      locales: z.array(z.string()).optional().describe('다국어 로케일 목록 (예: ["ko", "en-US", "ja"])'),
    },
    async ({ commits, appName, locales }) => {
      const result = await generateReleaseNotesFromCommits(commits, {
        appName,
        locales: locales ?? [],
      });
      const text = formatGeneratedNotes(result);
      return { content: [{ type: 'text', text }] };
    },
  );

  server.tool(
    'generate_review_reply',
    [
      'Play Store / App Store 리뷰에 대한 AI 답변 초안을 생성합니다.',
      'ANTHROPIC_API_KEY 환경변수가 필요합니다.',
      'tone: friendly(친근) / professional(정중) / empathetic(공감) / brief(간결) — 기본: friendly',
      'language: ko / en / ja / zh 등 — 기본: ko',
      '⚠ 생성된 답변은 초안입니다. 게시 전 반드시 검토하세요.',
      '답변 게시는 playstore_reply_to_review 도구를 사용하세요.',
    ].join(' '),
    {
      reviewText: z.string().describe('리뷰 원문'),
      rating: z.number().min(1).max(5).optional().describe('별점 (1~5)'),
      appName: z.string().optional().describe('앱 이름'),
      tone: z.enum(['friendly', 'professional', 'empathetic', 'brief']).optional().describe('답변 톤'),
      language: z.string().optional().describe('답변 언어 코드 (기본: ko)'),
      developerName: z.string().optional().describe('개발자/팀 이름'),
    },
    async ({ reviewText, rating, appName, tone, language, developerName }) => {
      const result = await generateReviewReply({
        reviewText,
        rating,
        appName,
        tone: tone ?? 'friendly',
        language: language ?? 'ko',
        developerName,
      });
      const text = formatReviewReply(result);
      return { content: [{ type: 'text', text }] };
    },
  );
}
