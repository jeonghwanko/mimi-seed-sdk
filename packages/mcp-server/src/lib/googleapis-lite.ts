/**
 * googleapis 서브패스 로더 — MCP 서버 기동 시간 방어벽.
 *
 * `import { google } from 'googleapis'` 는 import 시점에 400여 개 API 클라이언트를
 * 전부 로드해 그것만으로 ~19초를 쓴다. 그 결과 MCP 서버 기동(21~36초)이 Claude Code 의
 * MCP 연결 타임아웃(30초)을 상습 초과해, 세션에서 mimi-seed 도구가 아예 등록되지 않는
 * 사고가 났다 (2026-07-24). 실제 사용하는 API 만 서브패스로 로드하면 ~1초대다.
 *
 * - 새 Google API 가 필요하면 여기에 import 한 줄 + google 객체에 한 줄 추가한다.
 * - 다른 파일에서 `from 'googleapis'` 값 import 는 금지 — 반드시 이 모듈을 거친다.
 *   (googleapis 는 exports map 이 없어 서브패스 import 가 공식적으로 가능하다.)
 * - `auth` 는 AuthPlus 인스턴스라 `google.auth.OAuth2` 등 기존 사용처가 그대로 동작한다.
 */
import { admob } from 'googleapis/build/src/apis/admob/index.js';
import { analyticsadmin } from 'googleapis/build/src/apis/analyticsadmin/index.js';
import { analyticsdata } from 'googleapis/build/src/apis/analyticsdata/index.js';
import { androidpublisher } from 'googleapis/build/src/apis/androidpublisher/index.js';
import { bigquery } from 'googleapis/build/src/apis/bigquery/index.js';
import { cloudresourcemanager } from 'googleapis/build/src/apis/cloudresourcemanager/index.js';
import { auth, firebase } from 'googleapis/build/src/apis/firebase/index.js';
import { iam } from 'googleapis/build/src/apis/iam/index.js';
import { searchconsole } from 'googleapis/build/src/apis/searchconsole/index.js';
import { serviceusage } from 'googleapis/build/src/apis/serviceusage/index.js';
import { youtube } from 'googleapis/build/src/apis/youtube/index.js';

export type { youtube_v3 } from 'googleapis/build/src/apis/youtube/index.js';

export const google = {
  auth,
  admob,
  analyticsadmin,
  analyticsdata,
  androidpublisher,
  bigquery,
  cloudresourcemanager,
  firebase,
  iam,
  searchconsole,
  serviceusage,
  youtube,
};
