import { createInterface } from "node:readline/promises";
import Anthropic from "@anthropic-ai/sdk";
import kleur from "kleur";
import { getEffectiveConfig } from "./config.js";
import { catalog } from "./i18n.js";
import { mcpCall, MCP_WRITE_TIMEOUT_MS } from "./mcp-client.js";
import { isGitRepo, getLatestTag, getGitLog, formatCommitsForPrompt } from "./git.js";
import { AI_MODEL, RELEASE_NOTES_MAX_TOKENS, RELEASE_NOTE_TONES, type ReleaseNoteTone } from "#core/ai.js";

// 이 명령 전용 문구. 공통 문구(setup/doctor/auth)는 i18n.ts 의 `t()` 에 있다.
// LLM 프롬프트도 여기 있다 — 사람이 읽는 결과물(릴리즈 노트)의 언어를 정하기 때문.
// JSON 키(concise/detailed/marketing/localized)는 파싱 계약이라 번역하지 않는다 — 프롬프트의 JSON 뼈대는
// #core/ai.js 의 RELEASE_NOTE_TONES 로 조립하고(buildReleaseNotesPrompt), 번역하는 건 각 톤의 설명뿐이다.
const M = catalog(
  {
    // Claude 프롬프트
    localeHint: (l: string) => `"${l}": "해당 언어로 번역된 간결한 버전"`,
    system:
      "앱 스토어 릴리즈 노트 전문 카피라이터입니다. 커밋 내역을 사용자 친화적인 언어로 변환합니다. 항상 유효한 JSON으로만 응답하세요.",
    toneHints: {
      concise: "간결한 버전 (3줄 이내, 불릿)",
      detailed: "상세 버전 (5개 이내, 불릿)",
      marketing: "마케팅 버전 (열정적 톤)",
    } satisfies Record<ReleaseNoteTone, string>,
    userPrompt: (toneCount: number, commitsText: string, skeleton: string) =>
      `다음 커밋 내역으로 릴리즈 노트를 ${toneCount}가지 톤으로 작성하세요:\n\n${commitsText}\n\nJSON:\n${skeleton}`,
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
    invalidLimit: (value: string) => `--limit 은 1 이상의 정수여야 합니다: ${value}\n`,
    invalidRef: (ref: string) => `'-' 로 시작하는 ref 는 쓸 수 없습니다 (git 옵션으로 읽힘): ${ref}\n`,
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
    toneHints: {
      concise: "concise version (3 bullets max)",
      detailed: "detailed version (5 bullets max)",
      marketing: "marketing version (enthusiastic tone)",
    },
    userPrompt: (toneCount: number, commitsText: string, skeleton: string) =>
      `Write release notes in ${toneCount} tones from the following commit history:\n\n${commitsText}\n\nJSON:\n${skeleton}`,
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
    invalidLimit: (value: string) => `--limit must be a positive integer: ${value}\n`,
    invalidRef: (ref: string) => `A ref cannot start with '-' (git would read it as an option): ${ref}\n`,
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

/** 인자 해석. 잘못된 `--limit` · `-` 로 시작하는 ref 는 "커밋 없음" 으로 조용히 넘기지 않고 오류로 돌려준다. */
function parseArgs(argv: string[]): NotesArgs | { error: string } {
  const args: NotesArgs = { to: "HEAD", locales: ["ko", "en-US"], apply: false, noInteractive: false, limit: 30 };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--from" && argv[i + 1]) args.from = argv[++i];
    if (argv[i] === "--to" && argv[i + 1]) args.to = argv[++i];
    if (argv[i] === "--locale" && argv[i + 1]) args.locales = argv[++i].split(",").map((l) => l.trim());
    if (argv[i] === "--apply") args.apply = true;
    if (argv[i] === "--no-interactive") args.noInteractive = true;
    if (argv[i] === "--limit" && argv[i + 1]) {
      const raw = argv[++i];
      if (!/^\d+$/.test(raw) || Number(raw) < 1) return { error: M().invalidLimit(raw) };
      args.limit = Number(raw);
    }
  }
  for (const ref of [args.from, args.to]) if (ref?.startsWith("-")) return { error: M().invalidRef(ref) };
  return args;
}

async function promptUser(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question(question);
  rl.close();
  return answer.trim();
}

// 톤 키는 #core/ai.js 의 RELEASE_NOTE_TONES — 응답 JSON 파싱 계약이라 mcp-server 와 같아야 한다.
type ReleaseNotesResult = Record<ReleaseNoteTone, string> & { localized: Record<string, string> };

/**
 * Claude 에 보낼 사용자 프롬프트. JSON 뼈대의 톤 키는 RELEASE_NOTE_TONES 에서 나온다 — 여기 키를 손으로
 * 적으면 core 의 톤 목록이 바뀌어도 프롬프트만 옛 키를 요구하게 된다(파싱은 새 키를 기대하는데).
 */
export function buildReleaseNotesPrompt(commitsText: string, locales: string[]): string {
  const m = M();
  const toneHints: Record<ReleaseNoteTone, string> = m.toneHints;
  const localeList = locales.map((l) => m.localeHint(l)).join(",\n    ");
  const skeleton = [
    "{",
    ...RELEASE_NOTE_TONES.map((tone) => `  "${tone}": "${toneHints[tone]}",`),
    `  "localized": {\n    ${localeList}\n  }`,
    "}",
  ].join("\n");
  return m.userPrompt(RELEASE_NOTE_TONES.length, commitsText, skeleton);
}

async function generateWithClaude(commitsText: string, locales: string[]): Promise<ReleaseNotesResult> {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const response = await client.messages.create({
    model: AI_MODEL,
    // mcp-server 의 generateReleaseNotes 기본값과 같은 상수 — 낮으면 다국어 JSON 이 한쪽 경로에서만 잘린다.
    max_tokens: RELEASE_NOTES_MAX_TOKENS,
    system: M().system,
    messages: [{
      role: "user",
      content: buildReleaseNotesPrompt(commitsText, locales),
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

export const __testing = { parseArgs };

export async function cmdNotes(argv: string[]): Promise<void> {
  const parsed = parseArgs(argv);
  if ("error" in parsed) {
    process.stderr.write(kleur.red(parsed.error));
    process.exit(1);
  }
  const args = parsed;
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

  // 최신 태그는 refs/tags/ 로 한정한다 — 같은 이름의 브랜치와 헷갈리지 않고, 레포 태그가 `-` 로
  // 시작해도 git 옵션으로 읽히지 않는다.
  const fromForGit = args.from ?? (latestTag ? `refs/tags/${latestTag}` : undefined);
  const commits = getGitLog(cwd, { from: fromForGit, to: args.to, limit: args.limit });
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
    }, { timeoutMs: MCP_WRITE_TIMEOUT_MS });
    process.stdout.write(
      r.isError ? kleur.red(M().applyFailed(locale, r.text)) : kleur.green(M().applied(locale)),
    );
  }
}
