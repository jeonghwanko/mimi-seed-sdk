/**
 * google-auth-library 지연 로더 — googleapis-lite 와 같은 목적, 같은 기법.
 *
 * `import { JWT } from 'google-auth-library'` 는 그 자체로 ~0.6초다. 문제는 이게
 * helpers.ts → 12개 register 로 전파돼, 도구를 하나도 호출하지 않아도 MCP 기동 때
 * 무조건 지불된다는 점이다. 콜드 캐시에서는 이런 항목들이 합쳐져 기동이 25초까지 튀고,
 * Claude Code 의 기본 5초 MCP 연결 타임아웃을 넘겨 서버가 통째로 등록되지 않는다.
 *
 * google-auth-library 는 `type: module` 도 `exports` 맵도 없는 순수 CJS 라
 * `createRequire` 로 **동기** 로드가 된다. 덕분에 `getServiceAccountClient()` 처럼
 * 이미 동기인 함수를 async 로 바꾸지 않고도 지연 로딩이 가능하다.
 *
 * 규칙:
 * - `JWT` 를 **값으로** 쓰려면 이 파일의 `newJWT()` 를 쓴다.
 * - 타입만 필요하면 `import type { JWT } from 'google-auth-library'` — 타입 import 는
 *   런타임에 지워지므로 기동 비용이 0 이고 그대로 써도 된다.
 * - 다른 파일에서 `import { JWT } from 'google-auth-library'` (값 import) 는 금지.
 */
import { createRequire } from 'node:module';
import type { JWT, JWTOptions } from 'google-auth-library';

const require = createRequire(import.meta.url);

let cached: typeof import('google-auth-library') | undefined;

function lib(): typeof import('google-auth-library') {
  cached ??= require('google-auth-library') as typeof import('google-auth-library');
  return cached;
}

/** `new JWT(opts)` 와 동일. 첫 호출에서만 google-auth-library 를 로드한다. */
export function newJWT(opts: JWTOptions): JWT {
  return new (lib().JWT)(opts);
}
