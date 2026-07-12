// `mimi-seed auth ...` 서브명령 — 로컬 자격증명의 통합 front door.
// 실제 로직은 @yoonion/mimi-seed-mcp 의 mimi-seed-*-auth CLI들에 있고,
// 이 래퍼는 npx 로 호출해 stdio 그대로 패스스루한다 (mcp-bin.ts).
// 사용자가 mimi-seed 한 패키지만 알고 있어도 모든 인증 사이클을 돌릴 수 있게 해준다.
//
// 자격증명 **목록**은 여기 없다 — credentials.ts 레지스트리가 SSOT 다 (setup/doctor 와 공유).

import kleur from "kleur";
import { CREDENTIALS, credLabel, detectAll, isSatisfied } from "./credentials.js";
import { MCP_PKG, runMcpBin } from "./mcp-bin.js";
import { t } from "./i18n.js";

function log(msg: string): void {
  process.stdout.write(msg + "\n");
}

function printAuthHelp(): void {
  log(`${kleur.bold("mimi-seed auth")} — 로컬 자격증명 인증/관리

${kleur.bold("Google OAuth (Firebase / AdMob / Play):")}
  ${kleur.cyan("mimi-seed auth login")}      브라우저로 로그인 (이미 있으면 자동 refresh 시도)
  ${kleur.cyan("mimi-seed auth status")}     현재 OAuth 토큰 상태
  ${kleur.cyan("mimi-seed auth refresh")}    refresh_token으로 갱신만 시도 (브라우저 X)
  ${kleur.cyan("mimi-seed auth logout")}     OAuth 토큰 삭제

${kleur.bold("플랫폼별 자격증명:")}
  ${kleur.cyan("mimi-seed auth appstore")}   App Store Connect API 키 (appstore.json)
  ${kleur.cyan("mimi-seed auth playstore")}  Play 서비스 계정 JSON 등록
  ${kleur.cyan("mimi-seed auth bigquery")}   BigQuery 서비스 계정 (Crashlytics export 등)

${kleur.bold("빌드 / 마케팅:")}
  ${kleur.cyan("mimi-seed auth jenkins")}    Jenkins 연결 (jenkins.json)
  ${kleur.cyan("mimi-seed auth ci")}         GitHub Actions / GitLab CI (ci.json)
  ${kleur.cyan("mimi-seed auth googleads")}  Google Ads (google-ads.json)
  ${kleur.cyan("mimi-seed auth facebook")}   Facebook 페이지
  ${kleur.cyan("mimi-seed auth instagram")}  Instagram

${kleur.bold("전체 상태:")}
  ${kleur.cyan("mimi-seed auth status --all")}  모든 자격증명 보유 여부 한눈에

${kleur.bold("한 번에 다 연결:")}
  ${kleur.cyan("mimi-seed setup")}             안내를 따라가며 순서대로 연결 (권장)

${kleur.bold("login 옵션:")}
  --no-browser     URL 자동 오픈 안 함 (직접 복붙)
  --timeout <초>   콜백 대기 시간 (기본 600)
  --force          기존 토큰 무시하고 강제 재로그인

${kleur.dim(`내부적으로 ${MCP_PKG} 의 mimi-seed-*-auth CLI를 호출합니다.`)}`);
}

function printAllCredStatus(): void {
  log(kleur.bold(t().auth.statusTitle + "  ") + kleur.dim("(~/.mimi-seed)"));
  const detected = detectAll();
  for (const spec of CREDENTIALS) {
    const d = detected.get(spec.id)!;
    const mark = d.present
      ? kleur.green("✓")
      : isSatisfied(spec, detected)
        ? kleur.yellow("~") // 폴백(OAuth 등)으로 동작은 하는 상태
        : spec.requirement === "optional"
          ? kleur.dim("·")
          : kleur.red("✗");
    const tail = d.present ? kleur.dim(d.detail ?? "") : kleur.dim(`→ ${spec.fix}`);
    log(`  ${mark} ${credLabel(spec).padEnd(24)} ${tail}`);
  }
  log(kleur.dim("\n  한 번에 연결: mimi-seed setup"));
}

export async function cmdAuth(args: string[]): Promise<void> {
  const sub = args[0];
  const rest = args.slice(1);

  if (sub === "--help" || sub === "-h" || sub === "help") {
    printAuthHelp();
    return;
  }

  // status --all: 4개 자격증명 파일 존재 여부 요약 (네트워크 호출 없음)
  if (sub === "status" && rest.includes("--all")) {
    printAllCredStatus();
    return;
  }

  // 자격증명별 셋업 CLI 위임 (각자 별도 bin — 쓰기·검증은 mcp-server 가 소유한다)
  if (sub === "appstore") return void exitWith(await runMcpBin("mimi-seed-appstore-auth", rest));
  if (sub === "playstore") return void exitWith(await runMcpBin("mimi-seed-playstore-auth", rest));
  if (sub === "bigquery") return void exitWith(await runMcpBin("mimi-seed-bigquery-auth", rest));
  if (sub === "jenkins") return void exitWith(await runMcpBin("mimi-seed-jenkins-auth", rest));
  if (sub === "googleads") return void exitWith(await runMcpBin("mimi-seed-googleads-auth", rest));
  if (sub === "facebook") return void exitWith(await runMcpBin("mimi-seed-social-auth", ["facebook"]));
  if (sub === "instagram") return void exitWith(await runMcpBin("mimi-seed-social-auth", ["instagram"]));

  // CI(ci.json)는 CLI 가 직접 소유하는 유일한 자격증명 — setup 마법사의 항목 하나만 돌린다.
  if (sub === "ci") {
    const { cmdSetup } = await import("./setup.js");
    await cmdSetup(["--only", "github,gitlab", "--reconnect", "github,gitlab"]);
    return;
  }

  // 기본 Google OAuth (mimi-seed-auth)
  let mcpArgs: string[];
  switch (sub) {
    case undefined:
    case "login":
      mcpArgs = rest;
      break;
    case "status":
      mcpArgs = ["--status", ...rest];
      break;
    case "refresh":
      mcpArgs = ["--refresh", ...rest];
      break;
    case "logout":
      mcpArgs = ["--logout", ...rest];
      break;
    default:
      log(kleur.red(t().auth.unknownSub(sub ?? "")));
      printAuthHelp();
      process.exit(1);
  }

  exitWith(await runMcpBin("mimi-seed-auth", mcpArgs));
}

function exitWith(code: number): void {
  if (code !== 0) process.exit(code);
}
