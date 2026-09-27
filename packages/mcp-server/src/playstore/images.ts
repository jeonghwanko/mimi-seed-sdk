// Play 리스팅 이미지 (feature graphic / 스크린샷 등).
// playstore/tools.ts 가 이 모듈을 그대로 re-export 한다 — 호출부는 tools.js 경로를 계속 쓴다.

import type { OAuth2Client, JWT } from 'google-auth-library';
import fs from 'node:fs';
import { mediaUploadOptions } from '../lib/google-timeouts.js';
import { publisher, withEdit } from './edits.js';

export type PlayImageType =
  | 'featureGraphic'
  | 'icon'
  | 'phoneScreenshots'
  | 'promoGraphic'
  | 'sevenInchScreenshots'
  | 'tenInchScreenshots'
  | 'tvBanner'
  | 'tvScreenshots'
  | 'wearScreenshots';

function mimeTypeFor(filePath: string): string {
  const ext = filePath.toLowerCase().split('.').pop() ?? '';
  if (ext === 'png') return 'image/png';
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg';
  if (ext === 'webp') return 'image/webp';
  return 'application/octet-stream';
}

// ─── 이미지 (feature graphic / phone screenshots / etc.) ───

export async function listImages(
  auth: OAuth2Client | JWT,
  packageName: string,
  language: string,
  imageType: PlayImageType,
) {
  return withEdit(auth, packageName, async (editId) => {
    const res = await publisher().edits.images.list({
      auth, packageName, editId, language, imageType,
    });
    return res.data.images ?? [];
  });
}

export async function uploadImage(
  auth: OAuth2Client | JWT,
  packageName: string,
  language: string,
  imageType: PlayImageType,
  filePath: string,
) {
  if (!fs.existsSync(filePath)) throw new Error(`File not found: ${filePath}`);
  return withEdit(
    auth,
    packageName,
    async (editId) => {
      const res = await publisher().edits.images.upload({
        auth, packageName, editId, language, imageType,
        media: {
          mimeType: mimeTypeFor(filePath),
          body: fs.createReadStream(filePath),
        },
      }, mediaUploadOptions());
      return res.data.image;
    },
    true,
  );
}

export async function deleteAllImages(
  auth: OAuth2Client | JWT,
  packageName: string,
  language: string,
  imageType: PlayImageType,
) {
  return withEdit(
    auth,
    packageName,
    async (editId) => {
      await publisher().edits.images.deleteall({
        auth, packageName, editId, language, imageType,
      });
      return { ok: true, imageType };
    },
    true,
  );
}

/**
 * 한 edit 세션 내에서 기존 이미지 전체 삭제 + 새 이미지 순서대로 업로드 + commit.
 * phoneScreenshots처럼 여러 장 교체 시 효율적 (단일 edit).
 */
export async function replaceImages(
  auth: OAuth2Client | JWT,
  packageName: string,
  language: string,
  imageType: PlayImageType,
  filePaths: string[],
) {
  for (const p of filePaths) {
    if (!fs.existsSync(p)) throw new Error(`File not found: ${p}`);
  }
  return withEdit(
    auth,
    packageName,
    async (editId) => {
      await publisher().edits.images.deleteall({
        auth, packageName, editId, language, imageType,
      });
      const uploaded: Array<{ id?: string | null; url?: string | null; sha256?: string | null }> = [];
      for (const filePath of filePaths) {
        const res = await publisher().edits.images.upload({
          auth, packageName, editId, language, imageType,
          media: {
            mimeType: mimeTypeFor(filePath),
            body: fs.createReadStream(filePath),
          },
        }, mediaUploadOptions());
        uploaded.push(res.data.image ?? {});
      }
      return { imageType, count: uploaded.length, uploaded };
    },
    true,
  );
}
