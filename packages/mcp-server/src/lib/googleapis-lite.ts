/**
 * googleapis 서브패스 로더 — MCP 서버 기동 시간 방어벽.
 *
 * `import { google } from 'googleapis'` 는 import 시점에 400여 개 API 클라이언트를
 * 전부 로드해 그것만으로 ~19초를 쓴다. 그 결과 MCP 서버 기동(21~36초)이 Claude Code 의
 * MCP 연결 타임아웃을 상습 초과해, 세션에서 mimi-seed 도구가 아예 등록되지 않는
 * 사고가 났다 (2026-07-24). 실제 사용하는 API 만 서브패스로 로드하면 ~1.4초대다.
 *
 * 그런데 그 ~1.4초도 **기동 시점에** 전부 나갔다. 서브패스를 정적 import 하면
 * 도구를 하나도 호출하지 않아도 googleapis 공통 런타임(google-auth-library 등)이
 * 딸려 온다. 콜드 캐시(Windows 실시간 검사 등)에서는 이게 25초까지 튀어
 * 기본 5초 연결 타임아웃을 다시 넘겼다 (2026-08-22).
 *
 * 그래서 지금은 **첫 사용 시점까지 미룬다**:
 * - googleapis 는 `type: module` 도 `exports` 맵도 없는 순수 CJS 라
 *   `createRequire` 로 **동기** 로드가 가능하다. 그래서 `google.admob(...)` 같은
 *   기존 호출부를 async 로 바꿀 필요가 전혀 없다 — 소비자 코드는 그대로다.
 * - 타입은 `typeof import(...)` 로 얻는다. 타입 위치의 import 는 런타임에 완전히
 *   지워지므로 기동 비용이 0 이다. 절대 값 import 로 바꾸지 말 것 — 그 순간 이 파일의
 *   존재 이유가 사라진다.
 *
 * 규칙:
 * - 새 Google API 가 필요하면 아래 `google` 객체에 getter 한 줄을 추가한다.
 * - 다른 파일에서 `from 'googleapis'` 값 import 는 금지 — 반드시 이 모듈을 거친다.
 */
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

/** 서브패스 모듈 캐시 — require 자체도 캐시하지만 Map 조회가 더 싸다. */
const cache = new Map<string, Record<string, unknown>>();

/**
 * googleapis 서브패스를 첫 호출 시점에 동기 로드한다.
 * 첫 호출이 공통 런타임까지 함께 지불하고(~1.1초), 이후 다른 서브패스는 ~20ms 다.
 */
function sub(name: string): Record<string, unknown> {
  let mod = cache.get(name);
  if (mod === undefined) {
    mod = require(`googleapis/build/src/apis/${name}/index.js`) as Record<string, unknown>;
    cache.set(name, mod);
  }
  return mod;
}

export type { youtube_v3 } from 'googleapis/build/src/apis/youtube/index.js';

/**
 * 기존 `google.<api>(...)` 호출부와 100% 동일하게 동작하는 지연 로딩 네임스페이스.
 * 각 프로퍼티는 getter 라서, 실제로 그 API 를 쓰는 도구가 호출될 때까지 아무것도 로드하지 않는다.
 */
export const google = {
  // auth 는 AuthPlus 인스턴스. 어느 서브패스든 같은 걸 내보내지만,
  // 기존 동작과 동일하게 firebase 서브패스에서 가져온다.
  get auth(): typeof import('googleapis/build/src/apis/firebase/index.js').auth {
    return sub('firebase').auth as typeof import('googleapis/build/src/apis/firebase/index.js').auth;
  },
  get admob(): typeof import('googleapis/build/src/apis/admob/index.js').admob {
    return sub('admob').admob as typeof import('googleapis/build/src/apis/admob/index.js').admob;
  },
  get analyticsadmin(): typeof import('googleapis/build/src/apis/analyticsadmin/index.js').analyticsadmin {
    return sub('analyticsadmin').analyticsadmin as typeof import('googleapis/build/src/apis/analyticsadmin/index.js').analyticsadmin;
  },
  get analyticsdata(): typeof import('googleapis/build/src/apis/analyticsdata/index.js').analyticsdata {
    return sub('analyticsdata').analyticsdata as typeof import('googleapis/build/src/apis/analyticsdata/index.js').analyticsdata;
  },
  get androidpublisher(): typeof import('googleapis/build/src/apis/androidpublisher/index.js').androidpublisher {
    return sub('androidpublisher').androidpublisher as typeof import('googleapis/build/src/apis/androidpublisher/index.js').androidpublisher;
  },
  get bigquery(): typeof import('googleapis/build/src/apis/bigquery/index.js').bigquery {
    return sub('bigquery').bigquery as typeof import('googleapis/build/src/apis/bigquery/index.js').bigquery;
  },
  get billingbudgets(): typeof import('googleapis/build/src/apis/billingbudgets/index.js').billingbudgets {
    return sub('billingbudgets').billingbudgets as typeof import('googleapis/build/src/apis/billingbudgets/index.js').billingbudgets;
  },
  get cloudbilling(): typeof import('googleapis/build/src/apis/cloudbilling/index.js').cloudbilling {
    return sub('cloudbilling').cloudbilling as typeof import('googleapis/build/src/apis/cloudbilling/index.js').cloudbilling;
  },
  get cloudresourcemanager(): typeof import('googleapis/build/src/apis/cloudresourcemanager/index.js').cloudresourcemanager {
    return sub('cloudresourcemanager').cloudresourcemanager as typeof import('googleapis/build/src/apis/cloudresourcemanager/index.js').cloudresourcemanager;
  },
  get firebase(): typeof import('googleapis/build/src/apis/firebase/index.js').firebase {
    return sub('firebase').firebase as typeof import('googleapis/build/src/apis/firebase/index.js').firebase;
  },
  get iam(): typeof import('googleapis/build/src/apis/iam/index.js').iam {
    return sub('iam').iam as typeof import('googleapis/build/src/apis/iam/index.js').iam;
  },
  get searchconsole(): typeof import('googleapis/build/src/apis/searchconsole/index.js').searchconsole {
    return sub('searchconsole').searchconsole as typeof import('googleapis/build/src/apis/searchconsole/index.js').searchconsole;
  },
  get serviceusage(): typeof import('googleapis/build/src/apis/serviceusage/index.js').serviceusage {
    return sub('serviceusage').serviceusage as typeof import('googleapis/build/src/apis/serviceusage/index.js').serviceusage;
  },
  get youtube(): typeof import('googleapis/build/src/apis/youtube/index.js').youtube {
    return sub('youtube').youtube as typeof import('googleapis/build/src/apis/youtube/index.js').youtube;
  },
};
