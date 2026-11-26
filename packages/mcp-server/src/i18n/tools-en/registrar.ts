import { CONFIRM_PARAM_DESCRIPTION, GUARD_DESCRIPTION } from '../../lib/tool-registrar.js';

/** 레지스트라가 붙이는 문구 — 파괴적 도구의 가드 안내와 주입하는 `confirm` 파라미터. */
export default {
  [GUARD_DESCRIPTION]:
    '⚠️ Safety guard: when confirm is omitted or false, nothing changes and only a dry-run preview is returned. Call again with confirm: true after the user explicitly approves.',
  [CONFIRM_PARAM_DESCRIPTION]:
    'Runs for real only when explicitly true. Omitted or false returns only a dry-run preview (prevents irreversible or public mistakes).',
} satisfies Record<string, string>;
