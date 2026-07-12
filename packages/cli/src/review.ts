import { createInterface } from "node:readline/promises";
import Anthropic from "@anthropic-ai/sdk";
import kleur from "kleur";
import { getEffectiveConfig } from "./config.js";
import { catalog } from "./i18n.js";
import { mcpCall } from "./mcp-client.js";

// 이 명령 전용 문구. 공통 문구(setup/doctor/auth)는 i18n.ts 의 `t()` 에 있다.
// 톤/감정 **키**(friendly, bug_report, ...)는 --tone 값이자 detectSentiment 의 반환값이라 번역하지 않는다.
// 번역하는 건 그 키가 가리키는 LLM 지시문뿐이다.
const M = catalog(
  {
    toneGuides: {
      friendly: "친근하고 따뜻하게. 이모지 1~2개 사용. 감사 인사로 시작.",
      professional: "정중하고 공식적으로. 문제를 인정하고 해결책을 제시.",
      empathetic: "공감을 먼저 표현. 불편을 충분히 인정한 후 해결 의지를 보여줌.",
      brief: "2~3문장으로 간결하게. 핵심 응답만.",
    },
    sentimentPrompts: {
      positive: "긍정적인 리뷰. 감사 인사와 함께 앞으로도 좋은 경험을 제공하겠다는 의지를 표현.",
      negative:
        "부정적인 리뷰. 먼저 불편을 사과하고, 문제 해결 의지를 보여줘. 가능하면 지원 채널로 유도.",
      neutral: "중립적인 리뷰. 피드백에 감사하고 개선 노력을 약속.",
      bug_report: "버그 리포트. 문제를 확인했음을 알리고, 수정 예정임을 전달.",
      feature_request: "기능 요청. 피드백에 감사하고, 검토하겠다고 약속.",
    },
    localeNames: { ko: "한국어", en: "영어", ja: "일본어", "en-US": "영어", "zh-TW": "번체중국어" },

    // Claude 프롬프트
    starsLabel: (stars: string, rating: number) => `별점: ${stars} (${rating}/5)\n`,
    defaultDeveloper: "개발팀",
    defaultApp: "앱",
    system: (langName: string, toneGuide: string, developer: string) =>
      `앱 개발자를 대신해 스토어 리뷰에 답변하는 전문가. ${langName}로 150자 이내로 답변. ${toneGuide} 개발자 이름: ${developer}`,
    userPrompt: (app: string, stars: string, text: string, sentimentPrompt: string) =>
      `앱: ${app}\n${stars}리뷰: "${text}"\n\n지침: ${sentimentPrompt}\n\nJSON으로만 응답: { "reply": "답변 텍스트" }`,
    parseFailed: "AI 응답 파싱 실패",

    // cmdReview
    title: "mimi-seed review — 리뷰 답변 생성\n\n",
    noApiKey: "ANTHROPIC_API_KEY가 설정되지 않았습니다.\n",
    noApiKeyHint: "활성화: export ANTHROPIC_API_KEY=sk-ant-...\n",
    textRequired: "--text <리뷰 내용> 이 필요합니다.\n",
    enterReview: "리뷰 내용을 입력하세요 (여러 줄: Ctrl+D로 완료):\n",
    noInput: "입력 없음. 종료.\n",
    meta: (stars: string, tone: string, language: string) =>
      `별점: ${stars}  tone: ${tone}  언어: ${language}\n\n`,
    generating: "🤖 Claude AI로 답변 생성 중...\n",
    hdrReply: "─── 제안 답변 ─────────────────────────\n",
    draftWarning: "\n⚠ 이 답변은 AI가 생성한 초안입니다. 게시 전 반드시 검토하세요.\n\n",
    postPrompt: "이 답변을 Play Store에 게시할까요? [y/N]: ",
    skipped: "건너뜀.\n",
    needAccount: "Mimi Seed 계정 연결 필요. `mimi-seed init` 실행.\n",
    idsRequired: "--review-id 와 --package-name 이 필요합니다.\n",
    packagePrompt: "패키지명 (예: com.example.app): ",
    reviewIdPrompt: "리뷰 ID: ",
    notEnoughInfo: "정보 부족. 취소.\n",
    posting: "Play Store에 게시 중...\n",
    postFailed: (msg: string) => `게시 실패: ${msg}\n`,
    posted: "✓ 답변 게시 완료\n",
  },
  {
    toneGuides: {
      friendly: "Warm and friendly. Use 1-2 emoji. Open with a thank-you.",
      professional: "Polite and formal. Acknowledge the issue and offer a solution.",
      empathetic:
        "Lead with empathy. Fully acknowledge the frustration, then show a commitment to fix it.",
      brief: "Keep it to 2-3 sentences. Only the essential response.",
    },
    sentimentPrompts: {
      positive:
        "A positive review. Say thank you and commit to keeping the experience great.",
      negative:
        "A negative review. Apologize for the trouble first, then show a commitment to fixing it. Point to a support channel if you can.",
      neutral: "A neutral review. Thank them for the feedback and promise to keep improving.",
      bug_report: "A bug report. Confirm the issue is known and say a fix is coming.",
      feature_request: "A feature request. Thank them for the feedback and promise to consider it.",
    },
    localeNames: {
      ko: "Korean",
      en: "English",
      ja: "Japanese",
      "en-US": "English",
      "zh-TW": "Traditional Chinese",
    },

    // Claude prompt
    starsLabel: (stars: string, rating: number) => `Rating: ${stars} (${rating}/5)\n`,
    defaultDeveloper: "the dev team",
    defaultApp: "the app",
    system: (langName: string, toneGuide: string, developer: string) =>
      `You reply to app store reviews on behalf of the app's developer. Reply in ${langName}, in 150 characters or fewer. ${toneGuide} Developer name: ${developer}`,
    userPrompt: (app: string, stars: string, text: string, sentimentPrompt: string) =>
      `App: ${app}\n${stars}Review: "${text}"\n\nGuidance: ${sentimentPrompt}\n\nRespond with JSON only: { "reply": "the reply text" }`,
    parseFailed: "Failed to parse the AI response",

    // cmdReview
    title: "mimi-seed review — generate a review reply\n\n",
    noApiKey: "ANTHROPIC_API_KEY is not set.\n",
    noApiKeyHint: "Enable it: export ANTHROPIC_API_KEY=sk-ant-...\n",
    textRequired: "--text <review body> is required.\n",
    enterReview: "Paste the review (multi-line: finish with Ctrl+D):\n",
    noInput: "Nothing entered. Exiting.\n",
    meta: (stars: string, tone: string, language: string) =>
      `Rating: ${stars}  tone: ${tone}  language: ${language}\n\n`,
    generating: "🤖 Generating a reply with Claude AI...\n",
    hdrReply: "─── Suggested reply ───────────────────\n",
    draftWarning: "\n⚠ This reply is an AI-generated draft. Always review it before posting.\n\n",
    postPrompt: "Post this reply to Play Store? [y/N]: ",
    skipped: "Skipped.\n",
    needAccount: "A Mimi Seed account is required. Run `mimi-seed init`.\n",
    idsRequired: "--review-id and --package-name are required.\n",
    packagePrompt: "Package name (e.g. com.example.app): ",
    reviewIdPrompt: "Review ID: ",
    notEnoughInfo: "Not enough information. Cancelled.\n",
    posting: "Posting to Play Store...\n",
    postFailed: (msg: string) => `Failed to post: ${msg}\n`,
    posted: "✓ Reply posted\n",
  },
);

interface ReviewArgs {
  text?: string;
  rating?: number;
  tone: string;
  language: string;
  appName?: string;
  developerName?: string;
  apply: boolean;
  reviewId?: string;
  packageName?: string;
  noInteractive: boolean;
}

function parseArgs(argv: string[]): ReviewArgs {
  const args: ReviewArgs = { tone: "friendly", language: "ko", apply: false, noInteractive: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--text" && argv[i + 1]) args.text = argv[++i];
    if (argv[i] === "--rating" && argv[i + 1]) args.rating = parseInt(argv[++i], 10);
    if (argv[i] === "--tone" && argv[i + 1]) args.tone = argv[++i];
    if (argv[i] === "--language" && argv[i + 1]) args.language = argv[++i];
    if (argv[i] === "--app-name" && argv[i + 1]) args.appName = argv[++i];
    if (argv[i] === "--developer-name" && argv[i + 1]) args.developerName = argv[++i];
    if (argv[i] === "--apply") args.apply = true;
    if (argv[i] === "--review-id" && argv[i + 1]) args.reviewId = argv[++i];
    if (argv[i] === "--package-name" && argv[i + 1]) args.packageName = argv[++i];
    if (argv[i] === "--no-interactive") args.noInteractive = true;
  }
  return args;
}

async function promptUser(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question(question);
  rl.close();
  return answer.trim();
}

function detectSentiment(text: string): string {
  const lower = text.toLowerCase();
  if (["버그", "오류", "안됨", "crash", "bug", "error", "broken"].some((w) => lower.includes(w))) return "bug_report";
  if (["추가", "원해", "있으면", "wish", "feature", "add", "would like"].some((w) => lower.includes(w))) return "feature_request";
  if (["별로", "실망", "짜증", "terrible", "worst", "awful"].some((w) => lower.includes(w))) return "negative";
  if (["좋아", "최고", "훌륭", "great", "excellent", "love", "perfect"].some((w) => lower.includes(w))) return "positive";
  return "neutral";
}

async function generateReply(opts: ReviewArgs & { text: string }): Promise<string> {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const m = M();
  const toneGuides: Record<string, string> = m.toneGuides;
  const sentimentPrompts: Record<string, string> = m.sentimentPrompts;
  const localeNames: Record<string, string> = m.localeNames;

  const sentiment = detectSentiment(opts.text);
  const toneGuide = toneGuides[opts.tone] ?? toneGuides.friendly;
  const sentimentPrompt = sentimentPrompts[sentiment] ?? sentimentPrompts.neutral;
  const stars =
    opts.rating !== undefined
      ? m.starsLabel(`${"★".repeat(opts.rating)}${"☆".repeat(5 - opts.rating)}`, opts.rating)
      : "";
  const langName = localeNames[opts.language] ?? opts.language;

  const response = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 500,
    system: m.system(langName, toneGuide, opts.developerName ?? m.defaultDeveloper),
    messages: [{
      role: "user",
      content: m.userPrompt(opts.appName ?? m.defaultApp, stars, opts.text, sentimentPrompt),
    }],
  });

  const raw = response.content[0].type === "text" ? response.content[0].text : "";
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) throw new Error(m.parseFailed);
  const parsed = JSON.parse(match[0]) as { reply: string };
  return parsed.reply;
}

export async function cmdReview(argv: string[]): Promise<void> {
  const args = parseArgs(argv);

  process.stdout.write(kleur.bold(M().title));

  if (!process.env.ANTHROPIC_API_KEY) {
    process.stdout.write(kleur.red(M().noApiKey));
    process.stdout.write(kleur.dim(M().noApiKeyHint));
    process.exit(1);
  }

  let reviewText = args.text;
  if (!reviewText) {
    if (args.noInteractive) {
      process.stdout.write(kleur.red(M().textRequired));
      process.exit(1);
    }
    process.stdout.write(kleur.dim(M().enterReview));
    reviewText = await promptUser("> ");
    if (!reviewText) {
      process.stdout.write(kleur.yellow(M().noInput));
      process.exit(0);
    }
  }

  if (args.rating !== undefined) {
    const stars = "★".repeat(args.rating) + "☆".repeat(5 - args.rating);
    process.stdout.write(kleur.dim(M().meta(stars, args.tone, args.language)));
  }

  process.stdout.write(M().generating);
  const reply = await generateReply({ ...args, text: reviewText });

  process.stdout.write("\n" + kleur.bold(M().hdrReply));
  process.stdout.write(reply + "\n");
  process.stdout.write(kleur.dim(M().draftWarning));

  const shouldPrompt = !args.apply && !args.noInteractive && process.stdout.isTTY;
  if (!args.apply && !shouldPrompt) return;

  let doApply = args.apply;
  if (shouldPrompt) {
    const ans = await promptUser(M().postPrompt);
    doApply = ans.toLowerCase() === "y";
  }

  if (!doApply) {
    process.stdout.write(kleur.dim(M().skipped));
    return;
  }

  const cfg = await getEffectiveConfig();
  if (!cfg) {
    process.stdout.write(kleur.yellow(M().needAccount));
    return;
  }

  let reviewId = args.reviewId;
  let packageName = args.packageName;

  if (!reviewId || !packageName) {
    if (args.noInteractive) {
      process.stdout.write(kleur.red(M().idsRequired));
      process.exit(1);
    }
    if (!packageName) packageName = await promptUser(M().packagePrompt);
    if (!reviewId) reviewId = await promptUser(M().reviewIdPrompt);
  }

  if (!reviewId || !packageName) {
    process.stdout.write(kleur.yellow(M().notEnoughInfo));
    return;
  }

  process.stdout.write(M().posting);
  const r = await mcpCall(cfg.endpoint, cfg.token, "playstore_reply_review", {
    package_name: packageName,
    review_id: reviewId,
    reply_text: reply,
  });

  process.stdout.write(r.isError ? kleur.red(M().postFailed(r.text)) : kleur.green(M().posted));
}
