import { requireApiKey, parseJsonResponse, LOCALE_NAMES } from './client.js';

export interface CommitEntry {
  hash?: string;
  message: string;
  author?: string;
  date?: string;
}

export interface ReleaseNotesTone {
  name: string;
  text: string;
}

export interface GeneratedReleaseNotes {
  tones: ReleaseNotesTone[];
  localized: Record<string, string>;
  rawCommitsUsed: number;
}

const TONE_DESCRIPTIONS: Record<string, string> = {
  concise: '간결한 버전 (3줄 이내, 불릿 포인트, 사용자 혜택 중심)',
  detailed: '상세 버전 (주요 변경사항 5~8개, 불릿 포인트, 구체적 기능 설명)',
  marketing: '마케팅 버전 (감탄사 포함, 가치 제안 강조, 업데이트를 기대하게 만드는 톤)',
};

function commitsToText(commits: CommitEntry[]): string {
  return commits
    .map((c) => {
      const meta = [c.author, c.date?.slice(0, 10)].filter(Boolean).join(', ');
      return `- ${c.message}${meta ? ` (${meta})` : ''}`;
    })
    .join('\n');
}

export async function generateReleaseNotesFromCommits(
  commits: CommitEntry[],
  opts: { appName?: string; tones?: string[]; locales?: string[]; maxTokens?: number } = {},
): Promise<GeneratedReleaseNotes> {
  const client = requireApiKey();
  const { appName = '앱', tones = ['concise', 'detailed', 'marketing'], locales = [], maxTokens = 2000 } = opts;

  const commitsText = commitsToText(commits.slice(0, 50));
  const localeList = locales.length > 0
    ? locales.map((l) => `"${l}": "${LOCALE_NAMES[l] ?? l}로 번역된 간결한 버전"`).join(',\n    ')
    : '';

  const prompt = `다음은 "${appName}" 앱의 git 커밋 내역입니다.
사용자 친화적인 릴리즈 노트를 작성해주세요. 기술 용어 대신 사용자 경험 위주로 서술하세요.

커밋 내역:
${commitsText}

다음 JSON 형식으로 응답하세요 (한국어 기본):
{
  "tones": [
    ${tones.map((t) => `{ "name": "${t}", "text": "${TONE_DESCRIPTIONS[t] ?? t}" }`).join(',\n    ')}
  ]${localeList ? `,\n  "localized": {\n    ${localeList}\n  }` : ''}
}

각 tone의 "text" 필드에 실제 릴리즈 노트 내용을 채워주세요.`;

  const response = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: maxTokens,
    system: '앱 스토어 릴리즈 노트 전문 카피라이터입니다. 커밋 내역을 사용자 친화적인 언어로 변환합니다. 항상 유효한 JSON으로만 응답하세요.',
    messages: [{ role: 'user', content: prompt }],
  });

  const text = response.content[0].type === 'text' ? response.content[0].text : '';
  const parsed = parseJsonResponse<{ tones?: ReleaseNotesTone[]; localized?: Record<string, string> }>(text);

  return {
    tones: parsed.tones ?? [],
    localized: parsed.localized ?? {},
    rawCommitsUsed: commits.length,
  };
}

export function formatGeneratedNotes(result: GeneratedReleaseNotes): string {
  const toneLabels: Record<string, string> = { concise: '간결한 버전', detailed: '상세 버전', marketing: '마케팅 버전' };
  const lines: string[] = [`🤖 AI 릴리즈 노트 생성 완료 (커밋 ${result.rawCommitsUsed}개 분석)\n`];

  for (const tone of result.tones) {
    lines.push(`─── ${toneLabels[tone.name] ?? tone.name} ───`);
    lines.push(tone.text);
    lines.push('');
  }

  if (Object.keys(result.localized).length > 0) {
    lines.push('─── 다국어 ───');
    for (const [locale, text] of Object.entries(result.localized)) {
      lines.push(`[${locale}]`);
      lines.push(text);
      lines.push('');
    }
  }

  return lines.join('\n');
}
