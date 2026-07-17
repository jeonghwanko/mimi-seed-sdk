import { randomUUID } from 'node:crypto';
import {
  closeSync,
  createWriteStream,
  mkdirSync,
  openSync,
  readSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { once } from 'node:events';
import path from 'node:path';
import { writeJsonAtomic } from './files.js';
import { loadProject, registerAsset } from './project.js';
import type { VideoAsset } from './types.js';

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`❌ ${name} 환경변수가 필요합니다.`);
  return value;
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const text = await response.text();
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  if (!response.ok) {
    const message = typeof body === 'object' && body !== null && 'error' in body
      ? JSON.stringify((body as { error: unknown }).error)
      : String(body).slice(0, 500);
    throw new Error(`외부 API 요청 실패 (${response.status}): ${message}`);
  }
  return body as T;
}

export interface YouTubeReference {
  videoId: string;
  title: string;
  description: string;
  channelTitle: string;
  publishedAt: string;
  thumbnailUrl?: string;
  url: string;
  duration?: string;
  viewCount?: string;
  likeCount?: string;
  license?: string;
  sourceType: 'reference-only';
  allowedForRendering: false;
  untrustedExternalText: true;
  query: string;
}

function sanitizeExternalText(value: string | undefined, maxLength: number): string {
  return (value ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').slice(0, maxLength);
}

interface YouTubeSearchResponse {
  items?: Array<{
    id?: { videoId?: string };
    snippet?: {
      title?: string;
      description?: string;
      channelTitle?: string;
      publishedAt?: string;
      thumbnails?: { high?: { url?: string }; medium?: { url?: string } };
    };
  }>;
}

interface YouTubeVideosResponse {
  items?: Array<{
    id?: string;
    contentDetails?: { duration?: string };
    statistics?: { viewCount?: string; likeCount?: string };
    status?: { license?: string };
  }>;
}

export interface ResearchYouTubeInput {
  projectDir: string;
  queries?: string[];
  maxResultsPerQuery?: number;
  regionCode?: string;
  publishedAfter?: string;
  creativeCommonsOnly?: boolean;
  order?: 'relevance' | 'viewCount' | 'date';
}

export async function researchYouTube(input: ResearchYouTubeInput): Promise<YouTubeReference[]> {
  const project = loadProject(input.projectDir);
  const key = requireEnv('YOUTUBE_API_KEY');
  const queries = (input.queries?.length ? input.queries : project.scenes.map((scene) => scene.searchQuery))
    .filter(Boolean)
    .slice(0, 5);
  if (queries.length === 0) throw new Error('검색어가 없습니다. queries를 전달하거나 프로젝트 장면에 searchQuery를 추가하세요.');

  const references: YouTubeReference[] = [];
  for (const query of queries) {
    const params = new URLSearchParams({
      key,
      part: 'snippet',
      type: 'video',
      q: query,
      maxResults: String(Math.min(Math.max(input.maxResultsPerQuery ?? 5, 1), 10)),
      order: input.order ?? 'relevance',
      videoDuration: 'short',
      safeSearch: 'moderate',
    });
    if (input.regionCode) params.set('regionCode', input.regionCode);
    if (input.publishedAfter) params.set('publishedAfter', input.publishedAfter);
    if (input.creativeCommonsOnly) params.set('videoLicense', 'creativeCommon');
    const search = await fetchJson<YouTubeSearchResponse>(`https://www.googleapis.com/youtube/v3/search?${params}`);
    const ids = (search.items ?? []).map((item) => item.id?.videoId).filter((id): id is string => !!id);
    if (ids.length === 0) continue;

    const detailParams = new URLSearchParams({
      key,
      part: 'contentDetails,statistics,status',
      id: ids.join(','),
    });
    const details = await fetchJson<YouTubeVideosResponse>(`https://www.googleapis.com/youtube/v3/videos?${detailParams}`);
    const detailById = new Map((details.items ?? []).map((item) => [item.id, item]));
    for (const item of search.items ?? []) {
      const videoId = item.id?.videoId;
      if (!videoId) continue;
      const detail = detailById.get(videoId);
      references.push({
        videoId,
        title: sanitizeExternalText(item.snippet?.title, 300),
        description: sanitizeExternalText(item.snippet?.description, 1_000),
        channelTitle: sanitizeExternalText(item.snippet?.channelTitle, 200),
        publishedAt: item.snippet?.publishedAt ?? '',
        thumbnailUrl: item.snippet?.thumbnails?.high?.url ?? item.snippet?.thumbnails?.medium?.url,
        url: `https://www.youtube.com/watch?v=${videoId}`,
        duration: detail?.contentDetails?.duration,
        viewCount: detail?.statistics?.viewCount,
        likeCount: detail?.statistics?.likeCount,
        license: detail?.status?.license,
        sourceType: 'reference-only',
        allowedForRendering: false,
        untrustedExternalText: true,
        query,
      });
    }
  }

  const outputPath = path.join(path.resolve(input.projectDir), 'research', 'youtube.json');
  mkdirSync(path.dirname(outputPath), { recursive: true });
  writeJsonAtomic(outputPath, { generatedAt: new Date().toISOString(), references });
  return references;
}

export interface PexelsVideoResult {
  id: number;
  width: number;
  height: number;
  duration: number;
  pageUrl: string;
  author?: string;
  authorUrl?: string;
  previewImage?: string;
  downloadUrl?: string;
  downloadWidth?: number;
  downloadHeight?: number;
  license: 'Pexels License';
  attribution: string;
  query: string;
}

interface PexelsSearchResponse {
  videos?: Array<{
    id: number;
    width: number;
    height: number;
    duration: number;
    url: string;
    image?: string;
    user?: { name?: string; url?: string };
    video_files?: Array<{ link?: string; width?: number; height?: number; file_type?: string }>;
  }>;
}

function bestPexelsFile(files: NonNullable<PexelsSearchResponse['videos']>[number]['video_files'] = []) {
  const mp4s = files.filter((file) => file.link && file.file_type === 'video/mp4');
  return mp4s.sort((a, b) => ((b.width ?? 0) * (b.height ?? 0)) - ((a.width ?? 0) * (a.height ?? 0)))[0];
}

export interface SearchStockInput {
  projectDir: string;
  queries?: string[];
  orientation?: 'landscape' | 'portrait' | 'square';
  perQuery?: number;
}

export async function searchStock(input: SearchStockInput): Promise<PexelsVideoResult[]> {
  const project = loadProject(input.projectDir);
  const key = requireEnv('PEXELS_API_KEY');
  const queries = (input.queries?.length ? input.queries : project.scenes.map((scene) => scene.searchQuery))
    .filter(Boolean)
    .slice(0, 10);
  if (queries.length === 0) throw new Error('검색어가 없습니다.');

  const results: PexelsVideoResult[] = [];
  for (const query of queries) {
    const params = new URLSearchParams({
      query,
      per_page: String(Math.min(Math.max(input.perQuery ?? 5, 1), 15)),
    });
    if (input.orientation) params.set('orientation', input.orientation);
    const data = await fetchJson<PexelsSearchResponse>(`https://api.pexels.com/v1/videos/search?${params}`, {
      headers: { Authorization: key },
    });
    for (const video of data.videos ?? []) {
      const selected = bestPexelsFile(video.video_files);
      results.push({
        id: video.id,
        width: video.width,
        height: video.height,
        duration: video.duration,
        pageUrl: video.url,
        author: sanitizeExternalText(video.user?.name, 200),
        authorUrl: video.user?.url,
        previewImage: video.image,
        downloadUrl: selected?.link,
        downloadWidth: selected?.width,
        downloadHeight: selected?.height,
        license: 'Pexels License',
        attribution: `Video by ${video.user?.name ?? 'Pexels creator'} on Pexels`,
        query,
      });
    }
  }
  const outputPath = path.join(path.resolve(input.projectDir), 'research', 'pexels.json');
  mkdirSync(path.dirname(outputPath), { recursive: true });
  writeJsonAtomic(outputPath, { generatedAt: new Date().toISOString(), results });
  return results;
}

const PEXELS_MEDIA_HOSTS = new Set([
  'videos.pexels.com',
  'images.pexels.com',
  'static-videos.pexels.com',
]);

function validatePexelsUrl(value: string): URL {
  const url = new URL(value);
  if (url.protocol !== 'https:' || !PEXELS_MEDIA_HOSTS.has(url.hostname)) {
    throw new Error(`허용되지 않은 Pexels 미디어 URL입니다: ${url.hostname}`);
  }
  return url;
}

async function fetchPexelsMedia(value: string): Promise<Response> {
  let current = validatePexelsUrl(value);
  for (let redirects = 0; redirects <= 3; redirects += 1) {
    const response = await fetch(current, { redirect: 'manual' });
    if (![301, 302, 303, 307, 308].includes(response.status)) return response;
    const location = response.headers.get('location');
    if (!location) throw new Error('Pexels 리디렉션 응답에 Location 헤더가 없습니다.');
    await response.body?.cancel();
    current = validatePexelsUrl(new URL(location, current).toString());
  }
  throw new Error('Pexels 자산 리디렉션이 3회를 초과했습니다.');
}

async function downloadLimited(response: Response, destination: string, maxBytes: number): Promise<void> {
  if (!response.body) throw new Error('다운로드 응답에 본문이 없습니다.');
  const tempPath = `${destination}.${randomUUID()}.tmp`;
  const writer = createWriteStream(tempPath, { flags: 'wx' });
  const reader = response.body.getReader();
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new Error(`자산이 ${Math.round(maxBytes / 1024 / 1024)}MB 제한을 초과합니다.`);
      }
      if (!writer.write(Buffer.from(value))) await once(writer, 'drain');
    }
    writer.end();
    await once(writer, 'finish');
    renameSync(tempPath, destination);
  } catch (error) {
    writer.destroy();
    try {
      unlinkSync(tempPath);
    } catch {
      // The partial file may already be gone.
    }
    throw error;
  } finally {
    reader.releaseLock();
  }
}

function hasMp4Signature(filePath: string): boolean {
  const fd = openSync(filePath, 'r');
  const header = Buffer.alloc(12);
  try {
    const read = readSync(fd, header, 0, header.length, 0);
    return read >= 12 && header.subarray(4, 8).toString('ascii') === 'ftyp';
  } finally {
    closeSync(fd);
  }
}

export interface DownloadStockSelection {
  id: number;
  downloadUrl: string;
  pageUrl: string;
  author?: string;
  attribution?: string;
}

export async function downloadStockAssets(
  projectDir: string,
  selections: DownloadStockSelection[],
): Promise<VideoAsset[]> {
  loadProject(projectDir);
  if (selections.length === 0 || selections.length > 5) throw new Error('한 번에 1~5개 자산을 선택하세요.');
  const assets: VideoAsset[] = [];
  for (const selection of selections) {
    const url = validatePexelsUrl(selection.downloadUrl);
    const response = await fetchPexelsMedia(url.toString());
    if (!response.ok) throw new Error(`Pexels 자산 다운로드 실패 (${response.status}): ${selection.id}`);
    const contentType = response.headers.get('content-type')?.split(';')[0].trim().toLowerCase();
    if (contentType !== 'video/mp4' && contentType !== 'application/octet-stream') {
      throw new Error(`Pexels 자산이 MP4 응답이 아닙니다: ${contentType ?? 'unknown'}`);
    }
    const length = Number(response.headers.get('content-length') ?? 0);
    if (length > 100 * 1024 * 1024) throw new Error(`자산이 100MB 제한을 초과합니다: ${selection.id}`);
    const id = `pexels-${selection.id}-${randomUUID().slice(0, 8)}`;
    const destination = path.join(path.resolve(projectDir), 'assets', 'stock', `${id}.mp4`);
    mkdirSync(path.dirname(destination), { recursive: true });
    await downloadLimited(response, destination, 100 * 1024 * 1024);
    if (!hasMp4Signature(destination)) {
      unlinkSync(destination);
      throw new Error(`Pexels 자산이 유효한 MP4 시그니처를 갖지 않습니다: ${selection.id}`);
    }
    assets.push(registerAsset(projectDir, {
      id,
      kind: 'video',
      sourceType: 'stock',
      path: destination,
      sourceUrl: selection.pageUrl,
      license: 'Pexels License',
      author: selection.author,
      attribution: selection.attribution ?? `Video by ${selection.author ?? 'Pexels creator'} on Pexels`,
      allowedForRendering: true,
      provider: 'pexels',
    }));
  }
  return assets;
}

interface OpenAIImageResponse {
  data?: Array<{ b64_json?: string }>;
}

export interface GenerateImageInput {
  projectDir: string;
  prompt: string;
  name?: string;
  model?: 'gpt-image-2' | 'gpt-image-1.5' | 'gpt-image-1' | 'gpt-image-1-mini';
  quality?: 'low' | 'medium' | 'high' | 'auto';
  size?: '1024x1024' | '1024x1536' | '1536x1024';
}

export async function generateImage(input: GenerateImageInput): Promise<VideoAsset> {
  const project = loadProject(input.projectDir);
  const key = requireEnv('OPENAI_API_KEY');
  const size = input.size ?? (project.settings.aspectRatio === '9:16'
    ? '1024x1536'
    : project.settings.aspectRatio === '16:9' ? '1536x1024' : '1024x1024');
  const data = await fetchJson<OpenAIImageResponse>('https://api.openai.com/v1/images/generations', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: input.model ?? 'gpt-image-2',
      prompt: input.prompt,
      n: 1,
      size,
      quality: input.quality ?? 'medium',
      output_format: 'png',
    }),
  });
  const base64 = data.data?.[0]?.b64_json;
  if (!base64) throw new Error('이미지 생성 응답에 이미지 데이터가 없습니다.');
  const bytes = Buffer.from(base64, 'base64');
  const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (bytes.length === 0 || bytes.length > 50 * 1024 * 1024 || !bytes.subarray(0, 8).equals(pngSignature)) {
    throw new Error('이미지 생성 응답이 유효한 50MB 이하 PNG가 아닙니다.');
  }
  const id = `openai-${randomUUID()}`;
  const safeName = (input.name ?? id).replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || id;
  const destination = path.join(
    path.resolve(input.projectDir),
    'assets',
    'generated',
    `${safeName}-${id.slice(-8)}.png`,
  );
  mkdirSync(path.dirname(destination), { recursive: true });
  const tempPath = `${destination}.${randomUUID()}.tmp`;
  try {
    writeFileSync(tempPath, bytes, { flag: 'wx' });
    renameSync(tempPath, destination);
  } catch (error) {
    try {
      unlinkSync(tempPath);
    } catch {
      // The temp file may not have been created.
    }
    throw error;
  }
  return registerAsset(input.projectDir, {
    id,
    kind: 'image',
    sourceType: 'generated',
    path: destination,
    license: 'OpenAI generated output; use subject to OpenAI terms and applicable law',
    allowedForRendering: true,
    provider: input.model ?? 'gpt-image-2',
    prompt: input.prompt,
  });
}

export const __testing = { bestPexelsFile, validatePexelsUrl, hasMp4Signature, sanitizeExternalText };
