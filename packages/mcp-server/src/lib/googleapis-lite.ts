/**
 * 사용하는 Google API 만 지연 로드한다 — MCP 서버 기동 시간 방어벽.
 *
 * 예전에는 `googleapis` 메타 패키지(API 300여 개)의 서브패스를 `require` 했다.
 * 기동 때 전부 로드하지는 않았지만, 설치 용량이 그 메타 패키지 전체(~200MB)였다.
 * 지금은 실제로 쓰는 API 의 `@googleapis/<api>` 패키지만 의존한다. 각 패키지는
 * `type: module` 도 `exports` 맵도 없는 순수 CJS 라 `createRequire` 로 동기 로드가
 * 되고, `google.admob(...)` 같은 기존 호출부를 async 로 바꿀 필요가 없다.
 *
 * 최신 `@googleapis/*` 는 `engines.node >=22` 다. Node 하한은 `.nvmrc`(20) 이므로
 * `googleapis-common` ^8 (googleapis ~178 과 같은 세대) 을 쓰는 마지막 버전으로
 * 고정한다. 올리려면 Node 하한과 함께 손수 올린다 — docs/domain/external-apis.md.
 *
 * 타입은 `typeof import('@googleapis/...')` 로 얻는다. 타입 위치의 import 는
 * 런타임에 완전히 지워지므로 기동 비용이 0 이다. 절대 값 import 로 바꾸지 말 것
 * — 그 순간 이 파일의 존재 이유가 사라진다.
 *
 * 규칙:
 * - 새 Google API 가 필요하면 `PACKAGES` 와 아래 `google` 객체에 getter 를 추가한다.
 * - 다른 파일에서 `@googleapis/*` 또는 `googleapis` 값 import 는 금지 — 반드시 이 모듈을 거친다.
 */
import { createRequire } from 'node:module';
import { GOOGLEAPIS_DEFAULT_OPTIONS } from './google-timeouts.js';

const require = createRequire(import.meta.url);

/**
 * 런타임 모듈 이름. `youtubeAnalytics` 처럼 camelCase 인 getter 는
 * npm 패키지 `@googleapis/youtubeanalytics` 로 대응한다.
 */
const PACKAGES = {
  firebase: '@googleapis/firebase',
  admob: '@googleapis/admob',
  analyticsadmin: '@googleapis/analyticsadmin',
  analyticsdata: '@googleapis/analyticsdata',
  androidpublisher: '@googleapis/androidpublisher',
  drive: '@googleapis/drive',
  bigquery: '@googleapis/bigquery',
  billingbudgets: '@googleapis/billingbudgets',
  cloudbilling: '@googleapis/cloudbilling',
  cloudresourcemanager: '@googleapis/cloudresourcemanager',
  iam: '@googleapis/iam',
  monitoring: '@googleapis/monitoring',
  searchconsole: '@googleapis/searchconsole',
  serviceusage: '@googleapis/serviceusage',
  youtube: '@googleapis/youtube',
  youtubeAnalytics: '@googleapis/youtubeanalytics',
} as const;

type ApiName = keyof typeof PACKAGES;

/** 패키지 모듈 캐시 — require 자체도 캐시하지만 Map 조회가 더 싸다. */
const cache = new Map<string, Record<string, unknown>>();

/**
 * `@googleapis/<api>` 를 첫 호출 시점에 동기 로드한다.
 * 첫 호출이 공통 런타임(googleapis-common, google-auth-library)까지 함께 지불하고,
 * 이후 다른 API 는 이미 로드된 공통 모듈 위에서 훨씬 싸다.
 */
function sub(name: ApiName): Record<string, unknown> {
  let mod = cache.get(name);
  if (mod === undefined) {
    mod = require(PACKAGES[name]) as Record<string, unknown>;
    cache.set(name, mod);
  }
  return mod;
}

export type { youtube_v3 } from '@googleapis/youtube';
export type { drive_v3 } from '@googleapis/drive';
export type { youtubeAnalytics_v2 } from '@googleapis/youtubeanalytics';

/**
 * 기존 `google.<api>(...)` 호출부와 100% 동일하게 동작하는 지연 로딩 네임스페이스.
 * 각 프로퍼티는 getter 라서, 실제로 그 API 를 쓰는 도구가 호출될 때까지 아무것도 로드하지 않는다.
 */
export const google = {
  /**
   * googleapis-common 이 읽는 전역 옵션 — 타임아웃·재시도 기본값 (google-timeouts.ts 참고).
   * `google.<api>(...)` 호출의 context.google 이 이 객체이므로 이름을 바꾸면 적용이 끊긴다.
   */
  _options: GOOGLEAPIS_DEFAULT_OPTIONS,
  // auth 는 AuthPlus 인스턴스. 어느 패키지든 같은 걸 내보내지만,
  // 기존 동작과 동일하게 firebase 패키지에서 가져온다.
  get auth(): typeof import('@googleapis/firebase').auth {
    return sub('firebase').auth as typeof import('@googleapis/firebase').auth;
  },
  get admob(): typeof import('@googleapis/admob').admob {
    return sub('admob').admob as typeof import('@googleapis/admob').admob;
  },
  get analyticsadmin(): typeof import('@googleapis/analyticsadmin').analyticsadmin {
    return sub('analyticsadmin').analyticsadmin as typeof import('@googleapis/analyticsadmin').analyticsadmin;
  },
  get analyticsdata(): typeof import('@googleapis/analyticsdata').analyticsdata {
    return sub('analyticsdata').analyticsdata as typeof import('@googleapis/analyticsdata').analyticsdata;
  },
  get androidpublisher(): typeof import('@googleapis/androidpublisher').androidpublisher {
    return sub('androidpublisher').androidpublisher as typeof import('@googleapis/androidpublisher').androidpublisher;
  },
  get drive(): typeof import('@googleapis/drive').drive {
    return sub('drive').drive as typeof import('@googleapis/drive').drive;
  },
  get bigquery(): typeof import('@googleapis/bigquery').bigquery {
    return sub('bigquery').bigquery as typeof import('@googleapis/bigquery').bigquery;
  },
  get billingbudgets(): typeof import('@googleapis/billingbudgets').billingbudgets {
    return sub('billingbudgets').billingbudgets as typeof import('@googleapis/billingbudgets').billingbudgets;
  },
  get cloudbilling(): typeof import('@googleapis/cloudbilling').cloudbilling {
    return sub('cloudbilling').cloudbilling as typeof import('@googleapis/cloudbilling').cloudbilling;
  },
  get cloudresourcemanager(): typeof import('@googleapis/cloudresourcemanager').cloudresourcemanager {
    return sub('cloudresourcemanager').cloudresourcemanager as typeof import('@googleapis/cloudresourcemanager').cloudresourcemanager;
  },
  get firebase(): typeof import('@googleapis/firebase').firebase {
    return sub('firebase').firebase as typeof import('@googleapis/firebase').firebase;
  },
  get iam(): typeof import('@googleapis/iam').iam {
    return sub('iam').iam as typeof import('@googleapis/iam').iam;
  },
  get monitoring(): typeof import('@googleapis/monitoring').monitoring {
    return sub('monitoring').monitoring as typeof import('@googleapis/monitoring').monitoring;
  },
  get searchconsole(): typeof import('@googleapis/searchconsole').searchconsole {
    return sub('searchconsole').searchconsole as typeof import('@googleapis/searchconsole').searchconsole;
  },
  get serviceusage(): typeof import('@googleapis/serviceusage').serviceusage {
    return sub('serviceusage').serviceusage as typeof import('@googleapis/serviceusage').serviceusage;
  },
  get youtube(): typeof import('@googleapis/youtube').youtube {
    return sub('youtube').youtube as typeof import('@googleapis/youtube').youtube;
  },
  get youtubeAnalytics(): typeof import('@googleapis/youtubeanalytics').youtubeAnalytics {
    return sub('youtubeAnalytics').youtubeAnalytics as typeof import('@googleapis/youtubeanalytics').youtubeAnalytics;
  },
};
