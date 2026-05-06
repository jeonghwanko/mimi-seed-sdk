import { createInterface } from "node:readline/promises";
import Anthropic from "@anthropic-ai/sdk";
import kleur from "kleur";
import { getEffectiveConfig } from "./config.js";
import { mcpCall } from "./mcp-client.js";

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

const TONE_GUIDES: Record<string, string> = {
  friendly:     "친근하고 따뜻하게. 이모지 1~2개 사용. 감사 인사로 시작.",
  professional: "정중하고 공식적으로. 문제를 인정하고 해결책을 제시.",
  empathetic:   "공감을 먼저 표현. 불편을 충분히 인정한 후 해결 의지를 보여줌.",
  brief:        "2~3문장으로 간결하게. 핵심 응답만.",
};

const SENTIMENT_PROMPTS: Record<string, string> = {
  positive:        "긍정적인 리뷰. 감사 인사와 함께 앞으로도 좋은 경험을 제공하겠다는 의지를 표현.",
  negative:        "부정적인 리뷰. 먼저 불편을 사과하고, 문제 해결 의지를 보여줘. 가능하면 지원 채널로 유도.",
  neutral:         "중립적인 리뷰. 피드백에 감사하고 개선 노력을 약속.",
  bug_report:      "버그 리포트. 문제를 확인했음을 알리고, 수정 예정임을 전달.",
  feature_request: "기능 요청. 피드백에 감사하고, 검토하겠다고 약속.",
};

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
  const sentiment = detectSentiment(opts.text);
  const toneGuide = TONE_GUIDES[opts.tone] ?? TONE_GUIDES.friendly;
  const sentimentPrompt = SENTIMENT_PROMPTS[sentiment] ?? SENTIMENT_PROMPTS.neutral;
  const stars = opts.rating !== undefined ? `별점: ${"★".repeat(opts.rating)}${"☆".repeat(5 - opts.rating)} (${opts.rating}/5)\n` : "";
  const LOCALE_NAMES: Record<string, string> = { ko: "한국어", en: "영어", ja: "일본어", "en-US": "영어", "zh-TW": "번체중국어" };
  const langName = LOCALE_NAMES[opts.language] ?? opts.language;

  const response = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 500,
    system: `앱 개발자를 대신해 스토어 리뷰에 답변하는 전문가. ${langName}로 150자 이내로 답변. ${toneGuide} 개발자 이름: ${opts.developerName ?? "개발팀"}`,
    messages: [{
      role: "user",
      content: `앱: ${opts.appName ?? "앱"}\n${stars}리뷰: "${opts.text}"\n\n지침: ${sentimentPrompt}\n\nJSON으로만 응답: { "reply": "답변 텍스트" }`,
    }],
  });

  const raw = response.content[0].type === "text" ? response.content[0].text : "";
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("AI 응답 파싱 실패");
  const parsed = JSON.parse(match[0]) as { reply: string };
  return parsed.reply;
}

export async function cmdReview(argv: string[]): Promise<void> {
  const args = parseArgs(argv);

  process.stdout.write(kleur.bold("mimi-seed review — 리뷰 답변 생성\n\n"));

  if (!process.env.ANTHROPIC_API_KEY) {
    process.stdout.write(kleur.red("ANTHROPIC_API_KEY가 설정되지 않았습니다.\n"));
    process.stdout.write(kleur.dim("활성화: export ANTHROPIC_API_KEY=sk-ant-...\n"));
    process.exit(1);
  }

  let reviewText = args.text;
  if (!reviewText) {
    if (args.noInteractive) {
      process.stdout.write(kleur.red("--text <리뷰 내용> 이 필요합니다.\n"));
      process.exit(1);
    }
    process.stdout.write(kleur.dim("리뷰 내용을 입력하세요 (여러 줄: Ctrl+D로 완료):\n"));
    reviewText = await promptUser("> ");
    if (!reviewText) {
      process.stdout.write(kleur.yellow("입력 없음. 종료.\n"));
      process.exit(0);
    }
  }

  if (args.rating !== undefined) {
    const stars = "★".repeat(args.rating) + "☆".repeat(5 - args.rating);
    process.stdout.write(kleur.dim(`별점: ${stars}  tone: ${args.tone}  언어: ${args.language}\n\n`));
  }

  process.stdout.write("🤖 Claude AI로 답변 생성 중...\n");
  const reply = await generateReply({ ...args, text: reviewText });

  process.stdout.write("\n" + kleur.bold("─── 제안 답변 ─────────────────────────\n"));
  process.stdout.write(reply + "\n");
  process.stdout.write(kleur.dim("\n⚠ 이 답변은 AI가 생성한 초안입니다. 게시 전 반드시 검토하세요.\n\n"));

  const shouldPrompt = !args.apply && !args.noInteractive && process.stdout.isTTY;
  if (!args.apply && !shouldPrompt) return;

  let doApply = args.apply;
  if (shouldPrompt) {
    const ans = await promptUser("이 답변을 Play Store에 게시할까요? [y/N]: ");
    doApply = ans.toLowerCase() === "y";
  }

  if (!doApply) {
    process.stdout.write(kleur.dim("건너뜀.\n"));
    return;
  }

  const cfg = await getEffectiveConfig();
  if (!cfg) {
    process.stdout.write(kleur.yellow("Mimi Seed 계정 연결 필요. `mimi-seed init` 실행.\n"));
    return;
  }

  let reviewId = args.reviewId;
  let packageName = args.packageName;

  if (!reviewId || !packageName) {
    if (args.noInteractive) {
      process.stdout.write(kleur.red("--review-id 와 --package-name 이 필요합니다.\n"));
      process.exit(1);
    }
    if (!packageName) packageName = await promptUser("패키지명 (예: com.example.app): ");
    if (!reviewId) reviewId = await promptUser("리뷰 ID: ");
  }

  if (!reviewId || !packageName) {
    process.stdout.write(kleur.yellow("정보 부족. 취소.\n"));
    return;
  }

  process.stdout.write("Play Store에 게시 중...\n");
  const r = await mcpCall(cfg.endpoint, cfg.token, "playstore_reply_review", {
    package_name: packageName,
    review_id: reviewId,
    reply_text: reply,
  });

  process.stdout.write(r.isError ? kleur.red(`게시 실패: ${r.text}\n`) : kleur.green("✓ 답변 게시 완료\n"));
}
