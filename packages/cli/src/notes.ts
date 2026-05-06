import { createInterface } from "node:readline/promises";
import Anthropic from "@anthropic-ai/sdk";
import kleur from "kleur";
import { getEffectiveConfig } from "./config.js";
import { mcpCall } from "./mcp-client.js";
import { isGitRepo, getLatestTag, getGitLog, formatCommitsForPrompt } from "./git.js";

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

  const localeList = locales.map((l) => `"${l}": "해당 언어로 번역된 간결한 버전"`).join(",\n    ");

  const response = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 1500,
    system: "앱 스토어 릴리즈 노트 전문 카피라이터입니다. 커밋 내역을 사용자 친화적인 언어로 변환합니다. 항상 유효한 JSON으로만 응답하세요.",
    messages: [{
      role: "user",
      content: `다음 커밋 내역으로 릴리즈 노트를 3가지 톤으로 작성하세요:\n\n${commitsText}\n\nJSON:\n{\n  "concise": "간결한 버전 (3줄 이내, 불릿)",\n  "detailed": "상세 버전 (5개 이내, 불릿)",\n  "marketing": "마케팅 버전 (열정적 톤)",\n  "localized": {\n    ${localeList}\n  }\n}`,
    }],
  });

  const text = response.content[0].type === "text" ? response.content[0].text : "";
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("AI 응답 파싱 실패");
  return JSON.parse(match[0]) as ReleaseNotesResult;
}

function generateTemplate(commits: { message: string }[], locales: string[]): ReleaseNotesResult {
  const items = commits.slice(0, 10).map((c) => {
    const msg = c.message.replace(/^(feat|fix|chore|docs|refactor|style|test|perf|ci|build)(\([^)]+\))?:\s*/i, "").trim();
    return `• ${msg.charAt(0).toUpperCase() + msg.slice(1)}`;
  });
  const concise = items.slice(0, 3).join("\n");
  const detailed = items.join("\n");
  const marketing = `새로운 업데이트가 준비됐습니다!\n\n${items.slice(0, 5).join("\n")}\n\n지금 바로 업데이트하세요.`;
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

  process.stdout.write(kleur.bold("mimi-seed notes — 릴리즈 노트 생성\n\n"));

  if (!isGitRepo(cwd)) {
    process.stdout.write(kleur.red("Git 저장소가 아닙니다.\n"));
    process.exit(1);
  }

  const latestTag = getLatestTag(cwd);
  const fromRef = args.from ?? latestTag ?? undefined;
  process.stdout.write(kleur.dim(fromRef ? `범위: ${fromRef} → ${args.to}\n` : `최근 ${args.limit}개 커밋\n`));

  const commits = getGitLog(cwd, { from: fromRef, to: args.to, limit: args.limit });
  if (commits.length === 0) {
    process.stdout.write(kleur.yellow("커밋을 찾을 수 없습니다.\n"));
    process.exit(0);
  }

  process.stdout.write(kleur.dim(`커밋 ${commits.length}개 분석 중...\n\n`));

  let result: ReleaseNotesResult;
  if (process.env.ANTHROPIC_API_KEY) {
    process.stdout.write("🤖 Claude AI로 생성 중...\n");
    try {
      result = await generateWithClaude(formatCommitsForPrompt(commits), args.locales);
    } catch (e) {
      process.stdout.write(kleur.yellow(`AI 생성 실패, 템플릿 사용: ${(e as Error).message}\n`));
      result = generateTemplate(commits, args.locales);
    }
  } else {
    process.stdout.write(kleur.dim("ANTHROPIC_API_KEY 없음 — 자동 포맷팅 사용\n") + kleur.dim("AI 생성 활성화: export ANTHROPIC_API_KEY=sk-ant-...\n\n"));
    result = generateTemplate(commits, args.locales);
  }

  process.stdout.write(kleur.bold("─── 간결한 버전 ───────────────────────\n"));
  process.stdout.write(result.concise + "\n\n");
  process.stdout.write(kleur.bold("─── 상세 버전 ─────────────────────────\n"));
  process.stdout.write(result.detailed + "\n\n");
  process.stdout.write(kleur.bold("─── 마케팅 버전 ───────────────────────\n"));
  process.stdout.write(result.marketing + "\n\n");

  if (Object.keys(result.localized).length > 0) {
    process.stdout.write(kleur.bold("─── 다국어 ────────────────────────────\n"));
    for (const [locale, text] of Object.entries(result.localized)) {
      process.stdout.write(kleur.dim(`[${locale}]\n`) + text + "\n\n");
    }
  }

  const shouldPrompt = !args.apply && !args.noInteractive && process.stdout.isTTY;

  if (!args.apply && !shouldPrompt) return;

  const cfg = await getEffectiveConfig();
  if (!cfg) {
    process.stdout.write(kleur.yellow("Mimi Seed 계정 연결 필요. `mimi-seed init` 실행.\n"));
    return;
  }

  let selectedText = result.concise;
  if (shouldPrompt) {
    const choice = await promptUser("적용할 버전 [1=간결/2=상세/3=마케팅/Enter=건너뜀]: ");
    if (!choice) { process.stdout.write(kleur.dim("건너뜀.\n")); return; }
    if (choice === "2") selectedText = result.detailed;
    else if (choice === "3") selectedText = result.marketing;
  }

  const appsResult = await mcpCall(cfg.endpoint, cfg.token, "list_apps", {});
  if (appsResult.isError) {
    process.stdout.write(kleur.red(`앱 목록 조회 실패: ${appsResult.text}\n`));
    return;
  }

  const app = parseFirstApp(appsResult.text);
  if (!app) {
    process.stdout.write(kleur.yellow("등록된 앱이 없습니다.\n"));
    return;
  }

  process.stdout.write("Play Store에 적용 중...\n");
  for (const locale of args.locales) {
    const r = await mcpCall(cfg.endpoint, cfg.token, "apply_release_notes", {
      app_id: app.id,
      platform: "android",
      locale,
      text: result.localized[locale] ?? selectedText,
    });
    process.stdout.write(r.isError ? kleur.red(`${locale} 적용 실패: ${r.text}\n`) : kleur.green(`✓ ${locale} 적용됨\n`));
  }
}
