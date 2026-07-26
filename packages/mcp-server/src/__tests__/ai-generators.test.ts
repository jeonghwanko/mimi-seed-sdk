import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

/**
 * AI 생성기의 **결정적인 부분**만 본다 — 모델 응답 품질이 아니라, 우리가 통제하는
 * 프롬프트 조립·파싱·폴백이다. 여기서 조용히 틀리면 사용자는 "AI 가 이상하게 썼네"로
 * 오해하고 원인을 못 찾는다.
 */

const mocks = vi.hoisted(() => ({ create: vi.fn() }));

vi.mock('@anthropic-ai/sdk', () => ({
  default: class {
    messages = { create: mocks.create };
  },
}));

import { generateReviewReply, formatReviewReply } from '../ai/review.js';
import { generateReleaseNotesFromCommits, formatGeneratedNotes } from '../ai/notes.js';
import { requireApiKey, parseJsonResponse } from '../ai/client.js';

const reply = (text: string) => ({ content: [{ type: 'text', text }] });

beforeEach(() => {
  vi.clearAllMocks();
  process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
});
afterEach(() => {
  delete process.env.ANTHROPIC_API_KEY;
});

describe('requireApiKey', () => {
  it('키가 없으면 설정 방법을 알려주고 멈춘다', () => {
    delete process.env.ANTHROPIC_API_KEY;
    expect(() => requireApiKey()).toThrow(/ANTHROPIC_API_KEY/);
  });
});

describe('parseJsonResponse', () => {
  it('설명 문장에 둘러싸인 JSON 도 꺼낸다 (모델이 자주 이렇게 답한다)', () => {
    expect(parseJsonResponse('네, 여기 있습니다:\n{ "reply": "고마워요" }\n필요하면 말씀하세요.')).toEqual({
      reply: '고마워요',
    });
  });

  it('JSON 이 아예 없으면 조용히 빈 값을 만들지 않고 멈춘다', () => {
    expect(() => parseJsonResponse('죄송합니다, 답변할 수 없습니다.')).toThrow(/파싱 실패/);
  });
});

describe('generateReviewReply', () => {
  /** 마지막 호출의 system + user 프롬프트. */
  function prompts() {
    const arg = mocks.create.mock.calls.at(-1)![0] as {
      system: string;
      messages: Array<{ content: string }>;
    };
    return { system: arg.system, user: arg.messages[0].content };
  }

  it('버그 키워드가 있으면 버그 리포트 지침을 넣는다', async () => {
    mocks.create.mockResolvedValue(reply('{"reply":"수정 중입니다"}'));

    await generateReviewReply({ reviewText: '업데이트 후 자꾸 crash 나요' });

    expect(prompts().user).toContain('버그 리포트입니다');
  });

  it('칭찬 리뷰는 긍정 지침으로 간다', async () => {
    mocks.create.mockResolvedValue(reply('{"reply":"감사합니다"}'));

    await generateReviewReply({ reviewText: '정말 최고예요' });

    expect(prompts().user).toContain('긍정적인 리뷰입니다');
  });

  it('분류에 걸리지 않으면 중립으로 떨어진다', async () => {
    mocks.create.mockResolvedValue(reply('{"reply":"피드백 감사합니다"}'));

    await generateReviewReply({ reviewText: '그냥 그래요' });

    expect(prompts().user).toContain('중립적인 리뷰입니다');
  });

  it('tone / language / developerName 이 system 프롬프트에 반영된다', async () => {
    mocks.create.mockResolvedValue(reply('{"reply":"Thanks"}'));

    await generateReviewReply({
      reviewText: 'ok',
      tone: 'brief',
      language: 'en',
      developerName: 'Example Team',
    });

    const { system } = prompts();
    expect(system).toContain('영어로');
    expect(system).toContain('2~3문장으로 간결하게');
    expect(system).toContain('Example Team');
  });

  it('모르는 tone 은 friendly 로 폴백한다 (프롬프트에 undefined 를 흘리지 않는다)', async () => {
    mocks.create.mockResolvedValue(reply('{"reply":"hi"}'));

    await generateReviewReply({ reviewText: 'ok', tone: 'nonexistent' });

    expect(prompts().system).toContain('친근하고 따뜻하게');
    expect(prompts().system).not.toContain('undefined');
  });

  it('별점을 주면 별 표기를 함께 보낸다', async () => {
    mocks.create.mockResolvedValue(reply('{"reply":"감사합니다"}'));

    await generateReviewReply({ reviewText: 'ok', rating: 4 });

    expect(prompts().user).toContain('★★★★☆ (4/5)');
  });

  it('결과에 사람이 검토하라는 경고를 항상 붙인다', async () => {
    mocks.create.mockResolvedValue(reply('{"reply":"초안입니다"}'));

    const r = await generateReviewReply({ reviewText: 'ok' });

    expect(r.suggested).toBe('초안입니다');
    expect(r.note).toMatch(/검토/);
    // 게시 전 확인을 요구하는 문구가 사라지면 에이전트가 그대로 올릴 수 있다.
    expect(formatReviewReply(r)).toContain('playstore_reply_review');
  });
});

describe('generateReleaseNotesFromCommits', () => {
  const commits = [{ message: 'feat: 로그인 추가', author: 'a', date: '2026-07-01T00:00:00Z' }];

  it('요청한 톤만 프롬프트에 넣는다', async () => {
    mocks.create.mockResolvedValue(reply('{"tones":[]}'));

    await generateReleaseNotesFromCommits(commits, { tones: ['concise'] });

    const prompt = (mocks.create.mock.calls.at(-1)![0] as { messages: Array<{ content: string }> })
      .messages[0].content;
    expect(prompt).toContain('"name": "concise"');
    expect(prompt).not.toContain('"name": "marketing"');
  });

  it('locales 를 안 주면 localized 블록을 아예 넣지 않는다', async () => {
    mocks.create.mockResolvedValue(reply('{"tones":[]}'));

    await generateReleaseNotesFromCommits(commits, {});

    const prompt = (mocks.create.mock.calls.at(-1)![0] as { messages: Array<{ content: string }> })
      .messages[0].content;
    expect(prompt).not.toContain('localized');
  });

  it('모델이 tones 를 빼먹어도 빈 배열로 안전하게 돌려준다', async () => {
    mocks.create.mockResolvedValue(reply('{"localized":{}}'));

    const r = await generateReleaseNotesFromCommits(commits, {});

    expect(r.tones).toEqual([]);
    expect(r.localized).toEqual({});
    expect(r.rawCommitsUsed).toBe(1);
  });

  it('커밋 50개를 넘으면 잘라 보낸다 (프롬프트 폭주 방지)', async () => {
    mocks.create.mockResolvedValue(reply('{"tones":[]}'));
    const many = Array.from({ length: 60 }, (_, i) => ({ message: `commit-${i}` }));

    const r = await generateReleaseNotesFromCommits(many, {});

    const prompt = (mocks.create.mock.calls.at(-1)![0] as { messages: Array<{ content: string }> })
      .messages[0].content;
    expect(prompt).toContain('commit-49');
    expect(prompt).not.toContain('commit-50');
    // 분석한 커밋 수는 자르기 전 기준으로 보고한다.
    expect(r.rawCommitsUsed).toBe(60);
  });
});

describe('formatGeneratedNotes', () => {
  it('톤 라벨을 한국어로 붙이고 다국어 블록을 뒤에 둔다', () => {
    const out = formatGeneratedNotes({
      tones: [{ name: 'concise', text: '- 로그인 추가' }],
      localized: { en: '- Added login' },
      rawCommitsUsed: 3,
    });

    expect(out).toContain('커밋 3개 분석');
    expect(out).toContain('─── 간결한 버전 ───');
    expect(out).toContain('[en]');
    expect(out.indexOf('간결한 버전')).toBeLessThan(out.indexOf('다국어'));
  });

  it('다국어가 없으면 빈 섹션을 만들지 않는다', () => {
    const out = formatGeneratedNotes({ tones: [], localized: {}, rawCommitsUsed: 0 });
    expect(out).not.toContain('다국어');
  });
});
