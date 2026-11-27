import registrar from './registrar.js';
import admob from './admob.js';
import ai from './ai.js';
import android from './android.js';
import appstore from './appstore.js';
import auth from './auth.js';
import bigquery from './bigquery.js';
import billing from './billing.js';
import checks from './checks.js';
import ci from './ci.js';
import facebook from './facebook.js';
import firebase from './firebase.js';
import ga4 from './ga4.js';
import googleads from './googleads.js';
import gsc from './gsc.js';
import naver from './naver.js';
import iam from './iam.js';
import instagram from './instagram.js';
import jenkins from './jenkins.js';
import playstore from './playstore.js';
import crosspost from './crosspost.js';
import threads from './threads.js';
import tiktok from './tiktok.js';
import video from './video.js';
import youtube from './youtube.js';
import drive from './drive.js';

/**
 * 도구 설명 영어 번역표 — 도메인별 파일을 합친다. 키는 한국어 원문, 값은 영어 (lib/tool-text.ts).
 * 여러 도구가 공유하는 원문은 처음 쓰는 도메인 파일에 한 번만 둔다. 완전성 · 낡은 키 · 식별자 보존은
 * tool-text-en.test.ts 가 확인한다.
 */
export const TOOL_TEXT_EN_SOURCES: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  registrar,
  admob,
  ai,
  android,
  appstore,
  auth,
  bigquery,
  billing,
  checks,
  ci,
  facebook,
  firebase,
  ga4,
  googleads,
  gsc,
  naver,
  iam,
  instagram,
  jenkins,
  playstore,
  crosspost,
  threads,
  tiktok,
  video,
  youtube,
  drive,
};

export const TOOL_TEXT_EN: Readonly<Record<string, string>> = Object.assign({}, ...Object.values(TOOL_TEXT_EN_SOURCES));
