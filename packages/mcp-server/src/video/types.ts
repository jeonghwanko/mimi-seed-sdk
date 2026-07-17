export type VideoAspectRatio = '9:16' | '16:9' | '1:1';
export type VideoAssetKind = 'image' | 'video' | 'audio';
export type VideoAssetSource = 'stock' | 'generated' | 'user-owned' | 'licensed' | 'reference-only';

export interface VideoScenePlan {
  id: string;
  durationSec: number;
  narration: string;
  onScreenText: string;
  visualPrompt: string;
  searchQuery: string;
}

export interface VideoProject {
  version: 1;
  projectId: string;
  title: string;
  story: string;
  language: string;
  createdAt: string;
  settings: {
    aspectRatio: VideoAspectRatio;
    width: number;
    height: number;
    fps: number;
    targetDurationSec: number;
    style?: string;
  };
  scenes: VideoScenePlan[];
}

export interface VideoAsset {
  id: string;
  kind: VideoAssetKind;
  sourceType: VideoAssetSource;
  path: string;
  sourceUrl?: string;
  license: string;
  author?: string;
  attribution?: string;
  sha256: string;
  allowedForRendering: boolean;
  createdAt: string;
  provider?: string;
  prompt?: string;
}

export interface VideoAssetManifest {
  version: 1;
  projectId: string;
  assets: VideoAsset[];
}

export interface VideoTimelineScene {
  id: string;
  assetId: string;
  durationSec: number;
  onScreenText?: string;
  narration?: string;
}

export interface VideoTimeline {
  version: 1;
  projectId: string;
  createdAt: string;
  width: number;
  height: number;
  fps: number;
  totalDurationSec: number;
  scenes: VideoTimelineScene[];
  audioAssetId?: string;
}

export type VideoJobStatus = 'queued' | 'running' | 'completed' | 'failed';

export interface VideoRenderJob {
  id: string;
  status: VideoJobStatus;
  createdAt: string;
  updatedAt: string;
  projectDir: string;
  outputPath: string;
  logPath: string;
  pid?: number;
  exitCode?: number | null;
  error?: string;
}
