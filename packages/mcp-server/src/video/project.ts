import { createHash, randomUUID } from 'node:crypto';
import {
  closeSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  openSync,
  readSync,
  statSync,
  unlinkSync,
} from 'node:fs';
import path from 'node:path';
import { parseJsonResponse, requireApiKey } from '../ai/client.js';
import { readJson, requireAbsolutePath, writeJsonAtomic } from './files.js';
import { assetManifestSchema, assetSchema, parseFile, projectSchema, timelineSchema } from './schemas.js';
import type {
  VideoAspectRatio,
  VideoAsset,
  VideoAssetKind,
  VideoAssetManifest,
  VideoAssetSource,
  VideoProject,
  VideoScenePlan,
  VideoTimeline,
  VideoTimelineScene,
} from './types.js';

const PROJECT_FILE = 'project.json';
const ASSET_FILE = 'assets.json';
const TIMELINE_FILE = 'timeline.json';

function dimensions(aspectRatio: VideoAspectRatio): { width: number; height: number } {
  if (aspectRatio === '16:9') return { width: 1920, height: 1080 };
  if (aspectRatio === '1:1') return { width: 1080, height: 1080 };
  return { width: 1080, height: 1920 };
}

function normalizeScenes(raw: Partial<VideoScenePlan>[], targetDurationSec: number): VideoScenePlan[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new Error('AI가 유효한 장면 목록을 만들지 못했습니다. 다시 시도하세요.');
  }
  const maxScenes = Math.min(12, Math.max(1, Math.floor(targetDurationSec)));
  const scenes = raw.slice(0, maxScenes).map((scene, index) => ({
    id: scene.id?.trim() || `scene-${index + 1}`,
    durationSec: Number.isFinite(scene.durationSec) && Number(scene.durationSec) > 0 ? Number(scene.durationSec) : 1,
    narration: scene.narration?.trim() || '',
    onScreenText: scene.onScreenText?.trim() || '',
    visualPrompt: scene.visualPrompt?.trim() || '',
    searchQuery: scene.searchQuery?.trim() || scene.visualPrompt?.trim() || '',
  }));
  const weightTotal = scenes.reduce((sum, scene) => sum + scene.durationSec, 0);
  const distributable = targetDurationSec - scenes.length;
  const normalized = scenes.map((scene) => ({
    ...scene,
    durationSec: Math.round((1 + distributable * (scene.durationSec / weightTotal)) * 10) / 10,
  }));
  const roundedTotal = normalized.reduce((sum, scene) => sum + scene.durationSec, 0);
  const adjustmentIndex = normalized.reduce(
    (best, scene, index) => scene.durationSec > normalized[best].durationSec ? index : best,
    0,
  );
  normalized[adjustmentIndex].durationSec = Math.round(
    (normalized[adjustmentIndex].durationSec + targetDurationSec - roundedTotal) * 10,
  ) / 10;
  return normalized;
}

export interface PlanStoryInput {
  projectDir: string;
  title: string;
  story: string;
  language: string;
  aspectRatio: VideoAspectRatio;
  targetDurationSec: number;
  style?: string;
  overwrite?: boolean;
}

export async function planStory(input: PlanStoryInput): Promise<VideoProject> {
  const projectDir = requireAbsolutePath(input.projectDir, 'projectDir');
  const projectPath = path.join(projectDir, PROJECT_FILE);
  if (existsSync(projectPath) && !input.overwrite) {
    throw new Error(`이미 영상 프로젝트가 있습니다: ${projectPath}\noverwrite=true로 명시해야 덮어씁니다.`);
  }

  const client = requireApiKey();
  const response = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 3000,
    system: [
      '당신은 숏폼 영상 스토리보드 디렉터입니다.',
      '사용자의 이야기에서 핵심 메시지를 보존하고 장면별 시각 계획을 만드세요.',
      '반드시 설명이나 마크다운 없이 유효한 JSON만 반환하세요.',
    ].join(' '),
    messages: [{
      role: 'user',
      content: [
        `제목: ${input.title}`,
        `언어: ${input.language}`,
        `목표 길이: ${input.targetDurationSec}초`,
        `화면비: ${input.aspectRatio}`,
        input.style ? `스타일: ${input.style}` : '',
        '',
        '이야기:',
        input.story,
        '',
        '다음 JSON 형식으로 3~12개 장면을 만드세요:',
        '{"scenes":[{"id":"scene-1","durationSec":5,"narration":"...","onScreenText":"...","visualPrompt":"...","searchQuery":"..."}]}',
        'onScreenText는 짧게, visualPrompt는 이미지 생성용, searchQuery는 스톡 영상 검색용 영문 검색어로 작성하세요.',
      ].filter(Boolean).join('\n'),
    }],
  });
  const text = response.content[0]?.type === 'text' ? response.content[0].text : '';
  const parsed = parseJsonResponse<{ scenes?: Partial<VideoScenePlan>[] }>(text);
  const dims = dimensions(input.aspectRatio);
  const project = parseFile(projectSchema, {
    version: 1,
    projectId: randomUUID(),
    title: input.title,
    story: input.story,
    language: input.language,
    createdAt: new Date().toISOString(),
    settings: {
      aspectRatio: input.aspectRatio,
      ...dims,
      fps: 30,
      targetDurationSec: input.targetDurationSec,
      style: input.style,
    },
    scenes: normalizeScenes(parsed.scenes ?? [], input.targetDurationSec),
  }, 'AI가 생성한 영상 프로젝트');

  mkdirSync(projectDir, { recursive: true });
  mkdirSync(path.join(projectDir, 'assets', 'stock'), { recursive: true });
  mkdirSync(path.join(projectDir, 'assets', 'generated'), { recursive: true });
  mkdirSync(path.join(projectDir, 'assets', 'local'), { recursive: true });
  mkdirSync(path.join(projectDir, 'research'), { recursive: true });
  mkdirSync(path.join(projectDir, 'render'), { recursive: true });
  mkdirSync(path.join(projectDir, '.jobs'), { recursive: true });
  if (existsSync(projectPath) && input.overwrite) {
    const archiveDir = path.join(projectDir, '.history', `${Date.now()}-${project.projectId}`);
    mkdirSync(archiveDir, { recursive: true });
    for (const name of [PROJECT_FILE, ASSET_FILE, TIMELINE_FILE]) {
      const source = path.join(projectDir, name);
      if (existsSync(source)) copyFileSync(source, path.join(archiveDir, name));
    }
    const oldTimeline = path.join(projectDir, TIMELINE_FILE);
    if (existsSync(oldTimeline)) unlinkSync(oldTimeline);
  }
  writeJsonAtomic(projectPath, project);
  writeJsonAtomic(path.join(projectDir, ASSET_FILE), {
    version: 1,
    projectId: project.projectId,
    assets: [],
  } satisfies VideoAssetManifest);
  return project;
}

export function loadProject(projectDir: string): VideoProject {
  const dir = requireAbsolutePath(projectDir, 'projectDir');
  const filePath = path.join(dir, PROJECT_FILE);
  if (!existsSync(filePath)) throw new Error(`영상 프로젝트를 찾을 수 없습니다: ${filePath}`);
  return parseFile(projectSchema, readJson(filePath), filePath);
}

export function loadAssets(projectDir: string): VideoAssetManifest {
  const dir = requireAbsolutePath(projectDir, 'projectDir');
  const project = loadProject(dir);
  const filePath = path.join(dir, ASSET_FILE);
  if (!existsSync(filePath)) return { version: 1, projectId: project.projectId, assets: [] };
  const manifest = parseFile(assetManifestSchema, readJson(filePath), filePath);
  if (manifest.projectId !== project.projectId) {
    throw new Error('assets.json이 현재 project.json과 다른 프로젝트에 속합니다. 프로젝트를 다시 계획하거나 자산 매니페스트를 복구하세요.');
  }
  return manifest;
}

export function sha256File(filePath: string): string {
  const hash = createHash('sha256');
  const fd = openSync(filePath, 'r');
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  try {
    let bytesRead = 0;
    do {
      bytesRead = readSync(fd, buffer, 0, buffer.length, null);
      if (bytesRead > 0) hash.update(buffer.subarray(0, bytesRead));
    } while (bytesRead > 0);
  } finally {
    closeSync(fd);
  }
  return hash.digest('hex');
}

export function registerAsset(projectDir: string, asset: Omit<VideoAsset, 'createdAt' | 'sha256'>): VideoAsset {
  const dir = requireAbsolutePath(projectDir, 'projectDir');
  loadProject(dir);
  if (!path.isAbsolute(asset.path) || !existsSync(asset.path) || !statSync(asset.path).isFile()) {
    throw new Error(`자산 파일은 존재하는 절대경로여야 합니다: ${asset.path}`);
  }
  const entry = parseFile(assetSchema, {
    ...asset,
    path: path.resolve(asset.path),
    sha256: sha256File(asset.path),
    createdAt: new Date().toISOString(),
  }, '등록할 영상 자산');
  const manifest = loadAssets(dir);
  manifest.assets = [...manifest.assets.filter((item) => item.id !== entry.id), entry];
  writeJsonAtomic(path.join(dir, ASSET_FILE), manifest);
  return entry;
}

export interface AddLocalAssetInput {
  projectDir: string;
  filePath: string;
  kind: VideoAssetKind;
  sourceType: Extract<VideoAssetSource, 'user-owned' | 'licensed'>;
  license: string;
  author?: string;
  attribution?: string;
}

export function addLocalAsset(input: AddLocalAssetInput): VideoAsset {
  const projectDir = requireAbsolutePath(input.projectDir, 'projectDir');
  if (!path.isAbsolute(input.filePath) || !existsSync(input.filePath)) {
    throw new Error('filePath는 존재하는 절대경로여야 합니다.');
  }
  const id = `local-${randomUUID()}`;
  const ext = path.extname(input.filePath).toLowerCase();
  const destination = path.join(projectDir, 'assets', 'local', `${id}${ext}`);
  mkdirSync(path.dirname(destination), { recursive: true });
  copyFileSync(input.filePath, destination);
  return registerAsset(projectDir, {
    id,
    kind: input.kind,
    sourceType: input.sourceType,
    path: destination,
    license: input.license,
    author: input.author,
    attribution: input.attribution,
    allowedForRendering: true,
  });
}

export function buildTimeline(
  projectDir: string,
  scenes: VideoTimelineScene[],
  audioAssetId?: string,
): VideoTimeline {
  const dir = requireAbsolutePath(projectDir, 'projectDir');
  const project = loadProject(dir);
  const manifest = loadAssets(dir);
  if (scenes.length === 0) throw new Error('타임라인에는 장면이 한 개 이상 필요합니다.');

  const byId = new Map(manifest.assets.map((asset) => [asset.id, asset]));
  for (const scene of scenes) {
    const asset = byId.get(scene.assetId);
    if (!asset) throw new Error(`등록되지 않은 assetId입니다: ${scene.assetId}`);
    if (!asset.allowedForRendering || asset.sourceType === 'reference-only') {
      throw new Error(`렌더링이 허용되지 않은 자산입니다: ${scene.assetId}`);
    }
    if (asset.kind !== 'image' && asset.kind !== 'video') {
      throw new Error(`장면에는 이미지 또는 영상 자산만 사용할 수 있습니다: ${scene.assetId}`);
    }
    if (!Number.isFinite(scene.durationSec) || scene.durationSec <= 0) {
      throw new Error(`장면 길이는 0보다 커야 합니다: ${scene.id}`);
    }
  }
  if (audioAssetId) {
    const audio = byId.get(audioAssetId);
    if (!audio || audio.kind !== 'audio' || !audio.allowedForRendering) {
      throw new Error(`사용할 수 없는 오디오 자산입니다: ${audioAssetId}`);
    }
  }

  const totalDurationSec = scenes.reduce((sum, scene) => sum + scene.durationSec, 0);
  if (totalDurationSec > 300) throw new Error(`타임라인 총 길이는 300초를 넘을 수 없습니다: ${totalDurationSec}초`);
  const timeline = parseFile(timelineSchema, {
    version: 1,
    projectId: project.projectId,
    createdAt: new Date().toISOString(),
    width: project.settings.width,
    height: project.settings.height,
    fps: project.settings.fps,
    totalDurationSec,
    scenes,
    audioAssetId,
  }, '생성할 영상 타임라인');
  writeJsonAtomic(path.join(dir, TIMELINE_FILE), timeline);
  return timeline;
}

export function loadTimeline(projectDir: string): VideoTimeline {
  const dir = requireAbsolutePath(projectDir, 'projectDir');
  const project = loadProject(dir);
  const filePath = path.join(dir, TIMELINE_FILE);
  if (!existsSync(filePath)) throw new Error(`타임라인을 찾을 수 없습니다: ${filePath}`);
  const timeline = parseFile(timelineSchema, readJson(filePath), filePath);
  if (timeline.projectId !== project.projectId) {
    throw new Error('timeline.json이 현재 project.json과 다른 프로젝트에 속합니다. 타임라인을 다시 생성하세요.');
  }
  if (
    timeline.width !== project.settings.width ||
    timeline.height !== project.settings.height ||
    timeline.fps !== project.settings.fps
  ) {
    throw new Error('timeline.json의 출력 설정이 현재 프로젝트 설정과 다릅니다. 타임라인을 다시 생성하세요.');
  }
  return timeline;
}

export const __testing = { dimensions, normalizeScenes };
