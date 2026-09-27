// Play 앱 세부정보(개발자 연락처·기본 언어)와 스토어 리스팅.
// playstore/tools.ts 가 이 모듈을 그대로 re-export 한다 — 호출부는 tools.js 경로를 계속 쓴다.

import type { OAuth2Client, JWT } from 'google-auth-library';
import { extractHttpStatus } from '../lib/google-errors.js';
import { publisher, withEdit } from './edits.js';

// ─── 앱 목록 ───

export async function getAppDetails(auth: OAuth2Client | JWT, packageName: string) {
  return withEdit(auth, packageName, async (editId) => {
    const details = await publisher().edits.details.get({
      auth,
      packageName,
      editId,
    });
    return details.data;
  });
}

// ─── 앱 세부정보(개발자 연락처·기본 언어) 수정 ───
//
// edits.details = 스토어 리스팅(제목·설명)과 별개인 개발자 연락처(이메일/전화/웹사이트)
// 와 기본 언어. patch 로 부분 갱신 — 넘긴 필드만 교체하고 나머지 연락처는 보존한다
// (update=PUT 은 전체 치환이라 미지정 필드가 지워질 수 있어 patch 사용). edit → commit.
export async function updateAppDetails(
  auth: OAuth2Client | JWT,
  packageName: string,
  data: { contactEmail?: string; contactPhone?: string; contactWebsite?: string; defaultLanguage?: string },
) {
  return withEdit(
    auth,
    packageName,
    async (editId) => {
      const updated = await publisher().edits.details.patch({
        auth,
        packageName,
        editId,
        requestBody: data,
      });
      return updated.data;
    },
    true, // commit
  );
}

// ─── 스토어 리스팅 조회 ───

export async function getListing(auth: OAuth2Client | JWT, packageName: string, language: string = 'ko-KR') {
  return withEdit(auth, packageName, async (editId) => {
    const listing = await publisher().edits.listings.get({
      auth,
      packageName,
      editId,
      language,
    });
    return listing.data;
  });
}

// ─── 스토어 리스팅 수정 ───

export async function updateListing(
  auth: OAuth2Client | JWT,
  packageName: string,
  language: string,
  data: { title?: string; shortDescription?: string; fullDescription?: string },
) {
  // ⚠️ edits.listings.update 는 리소스를 **통째로 교체**한다(PUT). requestBody 에 없는 필드는
  // 지워진다 — 특히 `video`(스토어 프로모 영상)는 이 함수의 시그니처에 아예 없으므로,
  // "제목만 바꾸기"가 조용히 앱의 프로모 영상을 삭제한다. patch 는 넘긴 필드만 부분 갱신한다.
  //
  // undefined 를 걸러내는 이유: 호출자가 title 만 준 경우 { shortDescription: undefined } 가
  // 그대로 실려 나가면 patch 라도 해당 필드를 비우려는 의도로 해석될 여지가 있다.
  const requestBody = Object.fromEntries(
    Object.entries(data).filter(([, v]) => v !== undefined),
  );
  return withEdit(
    auth,
    packageName,
    async (editId) => {
      try {
        const updated = await publisher().edits.listings.patch({
          auth,
          packageName,
          editId,
          language,
          requestBody,
        });
        return updated.data;
      } catch (error) {
        // PATCH only works when the locale already exists. A missing translation returns
        // 404 even though the package and edit are valid. In that case a complete PUT is
        // the documented create-or-replace operation for the new locale.
        if (extractHttpStatus(error) !== 404) throw error;

        const { title, shortDescription, fullDescription } = data;
        if (!title || !shortDescription || !fullDescription) {
          throw new Error(
            `Google Play ${language} 리스팅이 아직 없어요. 새 언어를 만들려면 title, shortDescription, fullDescription을 모두 보내야 해요.`,
            { cause: error },
          );
        }

        const created = await publisher().edits.listings.update({
          auth,
          packageName,
          editId,
          language,
          requestBody: { title, shortDescription, fullDescription },
        });
        return created.data;
      }
    },
    true, // commit
  );
}
