// `mimi-seed lang [ko|en]` — CLI 출력 언어.
//
// 저장 위치는 ~/.mimi-seed/settings.json (settings.ts). 환경변수 MIMI_SEED_LANG 가 있으면 그게 이긴다.
// setup 마법사가 첫 실행 때 물어보므로, 이 명령은 "나중에 바꾸기" 용이다.

import kleur from "kleur";
import { t } from "./i18n.js";
import { isLang, resolveLang, writeSettings } from "./settings.js";

function log(msg: string): void {
  process.stdout.write(msg + "\n");
}

export async function cmdLang(args: string[]): Promise<void> {
  const arg = args[0]?.toLowerCase();

  if (!arg) {
    log(t().lang.current(resolveLang()));
    if (process.env.MIMI_SEED_LANG) {
      log(kleur.dim("  (MIMI_SEED_LANG)"));
    }
    return;
  }

  if (arg === "--help" || arg === "-h") {
    log(t().lang.usage);
    return;
  }

  if (!isLang(arg)) {
    log(kleur.red(t().lang.invalid(arg)));
    process.exit(1);
  }

  writeSettings({ lang: arg });
  // 방금 고른 언어로 확인 메시지를 내보낸다 (t() 는 호출 시점에 언어를 읽으므로 env 도 갱신).
  process.env.MIMI_SEED_LANG = arg;
  log(kleur.green(t().lang.saved(arg)));
}
