import { createInterface } from "node:readline/promises";
import Anthropic from "@anthropic-ai/sdk";
import kleur from "kleur";
import { getEffectiveConfig } from "./config.js";
import { catalog } from "./i18n.js";
import { mcpCall } from "./mcp-client.js";
import { isGitRepo, getLatestTag, getGitLog, formatCommitsForPrompt } from "./git.js";

// 이 명령 전용 문구. 공통 문구(setup/doctor/auth)는 i18n.ts 의 `t()` 에 있다.
// LLM 프롬프트도 여기 있다 — 사람이 읽는 결과물(릴리즈 노트)의 언어를 정하기 때문.
// JSON 키(concise/detailed/marketing/localized)는 파싱 계약이라 번역하지 않는다.
const M = catalog(
  {
    // Claude 프롬프트
    localeHint: (l: string) => `"${l}": "해당 언어로 번역된 간결한 버전"`,
    system:
      "앱 스토어 릴리즈 노트 전문 카피라이터입니다. 커밋 내역을 사용자 친화적인 언어로 변환합니다. 항상 유효한 JSON으로만 응답하세요.",
    userPrompt: (commitsText: string, localeList: string) =>
      `다음 커밋 내역으로 릴리즈 노트를 3가지 톤으로 작성하세요:\n\n${commitsText}\n\nJSON:\n{\n  "concise": "간결한 버전 (3줄 이내, 불릿)",\n  "detailed": "상세 버전 (5개 이내, 불릿)",\n  "marketing": "마케팅 버전 (열정적 톤)",\n  "localized": {\n    ${localeList}\n  }\n}`,
    parseFailed: "AI 응답 파싱 실패",

    // 템플릿 폴백
    marketingTemplate: (items: string) =>
      `새로운 업데이트가 준비됐습니다!\n\n${items}\n\n지금 바로 업데이트하세요.`,

    // cmdNotes
    title: "mimi-seed notes — 릴리즈 노트 생성\n\n",
    notGitRepo: "Git 저장소가 아닙니다.\n",
    range: (from: string, to: string) => `범위: ${from} → ${to}\n`,
    recentCommits: (limit: number) => `최근 ${limit}개 커밋\n`,
    noCommits: "커밋을 찾을 수 없습니다.\n",
    analyzing: (n: number) => `커밋 ${n}개 분석 중...\n\n`,
    generating: "🤖 Claude AI로 생성 중...\n",
    aiFailed: (msg: string) => `AI 생성 실패, 템플릿 사용: ${msg}\n`,
    noApiKey: "ANTHROPIC_API_KEY 없음 — 자동 포맷팅 사용\n",
    noApiKeyHint: "AI 생성 활성화: export ANTHROPIC_API_KEY=sk-ant-...\n\n",
    hdrConcise: "─── 간결한 버전 ───────────────────────\n",
    hdrDetailed: "─── 상세 버전 ─────────────────────────\n",
    hdrMarketing: "─── 마케팅 버전 ───────────────────────\n",
    hdrLocalized: "─── 다국어 ────────────────────────────\n",
    needAccount: "Mimi Seed 계정 연결 필요. `mimi-seed init` 실행.\n",
    choosePrompt: "적용할 버전 [1=간결/2=상세/3=마케팅/Enter=건너뜀]: ",
    skipped: "건너뜀.\n",
    listAppsFailed: (msg: string) => `앱 목록 조회 실패: ${msg}\n`,
    noApps: "등록된 앱이 없습니다.\n",
    toneToAllLocales: "선택한 톤을 모든 로케일에 적용합니다 (자동 번역 미적용).\n",
    applying: "Play Store에 적용 중...\n",
    applyFailed: (locale: string, msg: string) => `${locale} 적용 실패: ${msg}\n`,
    applied: (locale: string) => `✓ ${locale} 적용됨\n`,
  },
  {
    // Claude prompt
    localeHint: (l: string) => `"${l}": "the concise version, translated into that language"`,
    system:
      "You are an expert app store release-notes copywriter. You turn commit history into user-friendly language. Always respond with valid JSON only.",
    userPrompt: (commitsText: string, localeList: string) =>
      `Write release notes in 3 tones from the following commit history:\n\n${commitsText}\n\nJSON:\n{\n  "concise": "concise version (3 bullets max)",\n  "detailed": "detailed version (5 bullets max)",\n  "marketing": "marketing version (enthusiastic tone)",\n  "localized": {\n    ${localeList}\n  }\n}`,
    parseFailed: "Failed to parse the AI response",

    // Template fallback
    marketingTemplate: (items: string) =>
      `A new update is here!\n\n${items}\n\nUpdate now.`,

    // cmdNotes
    title: "mimi-seed notes — generate release notes\n\n",
    notGitRepo: "Not a git repository.\n",
    range: (from: string, to: string) => `Range: ${from} → ${to}\n`,
    recentCommits: (limit: number) => `Last ${limit} commit(s)\n`,
    noCommits: "No commits found.\n",
    analyzing: (n: number) => `Analyzing ${n} commit(s)...\n\n`,
    generating: "🤖 Generating with Claude AI...\n",
    aiFailed: (msg: string) => `AI generation failed, falling back to the template: ${msg}\n`,
    noApiKey: "No ANTHROPIC_API_KEY — using automatic formatting\n",
    noApiKeyHint: "Enable AI generation: export ANTHROPIC_API_KEY=sk-ant-...\n\n",
    hdrConcise: "─── Concise ───────────────────────────\n",
    hdrDetailed: "─── Detailed ──────────────────────────\n",
    hdrMarketing: "─── Marketing ─────────────────────────\n",
    hdrLocalized: "─── Localized ─────────────────────────\n",
    needAccount: "A Mimi Seed account is required. Run `mimi-seed init`.\n",
    choosePrompt: "Which version? [1=concise/2=detailed/3=marketing/Enter=skip]: ",
    skipped: "Skipped.\n",
    listAppsFailed: (msg: string) => `Failed to list apps: ${msg}\n`,
    noApps: "No apps registered.\n",
    toneToAllLocales:
      "Applying the selected tone to every locale (no automatic translation).\n",
    applying: "Applying to Play Store...\n",
    applyFailed: (locale: string, msg: string) => `${locale} failed to apply: ${msg}\n`,
    applied: (locale: string) => `✓ ${locale} applied\n`,
  },
);

interface NotesArgs {
  from?: string;
  to: string;
  locales: string[];
  apply: boolean;
  noInteractive: boolean;
  limit: number;
}

function parseArgs(argv: string[]): NotesArgs {
  const args: NotesArgs = { to: "HEAD", locales: ["ko", "en-US"], apply: false, noInteractive: false, limit: 30 };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--from" && argv[i + 1]) args.from = argv[++i];
    if (argv[i] === "--to" && argv[i + 1]) args.to = argv[++i];
    if (argv[i] === "--locale" && argv[i + 1]) args.locales = argv[++i].split(",").map((l) => l.trim());
    if (argv[i] === "--apply") args.apply = true;
    if (argv[i] === "--no-interactive") args.noInteractive = true;
    if (argv[i] === "--limit" && argv[i + 1]) args.limit = parseInt(argv[++i], 10);
  }
  return args;
}

async function promptUser(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question(question);
  rl.close();
  return answer.trim();
}

interface ReleaseNotesResult {
  concise: string;
  detailed: string;
  marketing: string;
  localized: Record<string, string>;
}

async function generateWithClaude(commitsText: string, locales: string[]): Promise<ReleaseNotesResult> {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const localeList = locales.map((l) => M().localeHint(l)).join(",\n    ");

  const response = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 1500,
    system: M().system,
    messages: [{
      role: "user",
      content: M().userPrompt(commitsText, localeList),
    }],
  });

  const text = response.content[0].type === "text" ? response.content[0].text : "";
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error(M().parseFailed);
  return JSON.parse(match[0]) as ReleaseNotesResult;
}

function generateTemplate(commits: { message: string }[], locales: string[]): ReleaseNotesResult {
  const items = commits.slice(0, 10).map((c) => {
    const msg = c.message.replace(/^(feat|fix|chore|docs|refactor|style|test|perf|ci|build)(\([^)]+\))?:\s*/i, "").trim();
    return `• ${msg.charAt(0).toUpperCase() + msg.slice(1)}`;
  });
  const concise = items.slice(0, 3).join("\n");
  const detailed = items.join("\n");
  const marketing = M().marketingTemplate(items.slice(0, 5).join("\n"));
  const localized = Object.fromEntries(locales.map((l) => [l, concise]));
  return { concise, detailed, marketing, localized };
}

function parseFirstApp(text: string): { id: string; packageName?: string; name?: string } | null {
  try {
    const apps = JSON.parse(text);
    if (Array.isArray(apps) && apps.length > 0) return apps[0] as { id: string; packageName?: string; name?: string };
  } catch { /* ignore */ }
  return null;
}

export async function cmdNotes(argv: string[]): Promise<void> {
  const args = parseArgs(argv);
  const cwd = process.cwd();

  process.stdout.write(kleur.bold(M().title));

  if (!isGitRepo(cwd)) {
    process.stdout.write(kleur.red(M().notGitRepo));
    process.exit(1);
  }

  const latestTag = getLatestTag(cwd);
  const fromRef = args.from ?? latestTag ?? undefined;
  process.stdout.write(
    kleur.dim(fromRef ? M().range(fromRef, args.to) : M().recentCommits(args.limit)),
  );

  const commits = getGitLog(cwd, { from: fromRef, to: args.to, limit: args.limit });
  if (commits.length === 0) {
    process.stdout.write(kleur.yellow(M().noCommits));
    process.exit(0);
  }

  process.stdout.write(kleur.dim(M().analyzing(commits.length)));

  let result: ReleaseNotesResult;
  if (process.env.ANTHROPIC_API_KEY) {
    process.stdout.write(M().generating);
    try {
      result = await generateWithClaude(formatCommitsForPrompt(commits), args.locales);
    } catch (e) {
      process.stdout.write(kleur.yellow(M().aiFailed((e as Error).message)));
      result = generateTemplate(commits, args.locales);
    }
  } else {
    process.stdout.write(kleur.dim(M().noApiKey) + kleur.dim(M().noApiKeyHint));
    result = generateTemplate(commits, args.locales);
  }

  process.stdout.write(kleur.bold(M().hdrConcise));
  process.stdout.write(result.concise + "\n\n");
  process.stdout.write(kleur.bold(M().hdrDetailed));
  process.stdout.write(result.detailed + "\n\n");
  process.stdout.write(kleur.bold(M().hdrMarketing));
  process.stdout.write(result.marketing + "\n\n");

  if (Object.keys(result.localized).length > 0) {
    process.stdout.write(kleur.bold(M().hdrLocalized));
    for (const [locale, text] of Object.entries(result.localized)) {
      process.stdout.write(kleur.dim(`[${locale}]\n`) + text + "\n\n");
    }
  }

  const shouldPrompt = !args.apply && !args.noInteractive && process.stdout.isTTY;

  if (!args.apply && !shouldPrompt) return;

  const cfg = await getEffectiveConfig();
  if (!cfg) {
    process.stdout.write(kleur.yellow(M().needAccount));
    return;
  }

  let selectedText = result.concise;
  let userSelectedTone = false;
  if (shouldPrompt) {
    const choice = await promptUser(M().choosePrompt);
    if (!choice) { process.stdout.write(kleur.dim(M().skipped)); return; }
    if (choice === "2") selectedText = result.detailed;
    else if (choice === "3") selectedText = result.marketing;
    userSelectedTone = true;
  }

  const appsResult = await mcpCall(cfg.endpoint, cfg.token, "list_apps", {});
  if (appsResult.isError) {
    process.stdout.write(kleur.red(M().listAppsFailed(appsResult.text)));
    return;
  }

  const app = parseFirstApp(appsResult.text);
  if (!app) {
    process.stdout.write(kleur.yellow(M().noApps));
    return;
  }

  // 사용자가 톤을 명시 선택하면 그 텍스트를 모든 로케일에 그대로 적용 (선택이 결과를 결정).
  // 비대화형 --apply 일 때만 로케일별 자동 번역(localized)을 사용.
  if (userSelectedTone && args.locales.length > 1) {
    process.stdout.write(kleur.dim(M().toneToAllLocales));
  }

  process.stdout.write(M().applying);
  for (const locale of args.locales) {
    const text = userSelectedTone ? selectedText : (result.localized[locale] ?? selectedText);
    const r = await mcpCall(cfg.endpoint, cfg.token, "apply_release_notes", {
      app_id: app.id,
      platform: "android",
      locale,
      text,
    });
    process.stdout.write(
      r.isError ? kleur.red(M().applyFailed(locale, r.text)) : kleur.green(M().applied(locale)),
    );
  }
}
