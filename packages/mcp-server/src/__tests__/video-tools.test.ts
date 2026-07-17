import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { addLocalAsset, buildTimeline, loadTimeline, registerAsset, __testing as projectTesting } from '../video/project.js';
import { __testing as providerTesting } from '../video/providers.js';
import { buildFfmpegPlan, formatSrt, __testing as renderTesting } from '../video/render.js';
import { __testing as researchTesting } from '../video/research.js';
import type { VideoProject, VideoTimeline } from '../video/types.js';

const dirs: string[] = [];
const PROJECT_ID = '00000000-0000-4000-8000-000000000001';

function fixtureProject(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'mimi-seed-video-'));
  dirs.push(dir);
  mkdirSync(path.join(dir, 'assets', 'local'), { recursive: true });
  mkdirSync(path.join(dir, 'render'), { recursive: true });
  mkdirSync(path.join(dir, '.jobs'), { recursive: true });
  const project: VideoProject = {
    version: 1,
    projectId: PROJECT_ID,
    title: 'Test',
    story: 'A test story',
    language: 'ko',
    createdAt: new Date(0).toISOString(),
    settings: {
      aspectRatio: '9:16',
      width: 1080,
      height: 1920,
      fps: 30,
      targetDurationSec: 5,
    },
    scenes: [{
      id: 'scene-1',
      durationSec: 5,
      narration: '',
      onScreenText: '',
      visualPrompt: 'test visual',
      searchQuery: 'test',
    }],
  };
  writeFileSync(path.join(dir, 'project.json'), JSON.stringify(project));
  writeFileSync(path.join(dir, 'assets.json'), JSON.stringify({ version: 1, projectId: PROJECT_ID, assets: [] }));
  return dir;
}

afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

describe('video project provenance', () => {
  it('normalizes adversarial scene weights to the exact target without sub-second scenes', () => {
    const scenes = projectTesting.normalizeScenes([
      { durationSec: 10_000 },
      { durationSec: 1 },
      { durationSec: 1 },
      { durationSec: 1 },
      { durationSec: 1 },
      { durationSec: 1 },
    ], 5);
    expect(scenes).toHaveLength(5);
    expect(scenes.reduce((sum, scene) => sum + scene.durationSec, 0)).toBe(5);
    expect(scenes.every((scene) => scene.durationSec >= 1)).toBe(true);
  });

  it('copies a user-owned asset and builds a renderable timeline', () => {
    const projectDir = fixtureProject();
    const source = path.join(projectDir, 'source.png');
    writeFileSync(source, Buffer.from('fake image'));
    const asset = addLocalAsset({
      projectDir,
      filePath: source,
      kind: 'image',
      sourceType: 'user-owned',
      license: 'Owned by test user',
    });
    const timeline = buildTimeline(projectDir, [{
      id: 'scene-1',
      assetId: asset.id,
      durationSec: 5,
      onScreenText: 'Hello',
    }]);
    expect(timeline.totalDurationSec).toBe(5);
    expect(timeline.scenes[0].assetId).toBe(asset.id);
  });

  it('rejects a reference-only asset from the timeline', () => {
    const projectDir = fixtureProject();
    const filePath = path.join(projectDir, 'reference.mp4');
    writeFileSync(filePath, Buffer.from('reference'));
    const asset = registerAsset(projectDir, {
      id: 'reference-1',
      kind: 'video',
      sourceType: 'reference-only',
      path: filePath,
      sourceUrl: 'https://example.com/reference',
      license: 'Research only',
      allowedForRendering: false,
    });
    expect(() => buildTimeline(projectDir, [{ id: 'scene-1', assetId: asset.id, durationSec: 5 }]))
      .toThrow('렌더링이 허용되지 않은 자산');
  });

  it('rejects a stale timeline after the project identity changes', () => {
    const projectDir = fixtureProject();
    const source = path.join(projectDir, 'source.png');
    writeFileSync(source, Buffer.from('fake image'));
    const asset = addLocalAsset({
      projectDir,
      filePath: source,
      kind: 'image',
      sourceType: 'user-owned',
      license: 'Owned by test user',
    });
    buildTimeline(projectDir, [{ id: 'scene-1', assetId: asset.id, durationSec: 5 }]);
    const projectPath = path.join(projectDir, 'project.json');
    const project = JSON.parse(readFileSync(projectPath, 'utf8'));
    project.projectId = '00000000-0000-4000-8000-000000000002';
    writeFileSync(projectPath, JSON.stringify(project));
    expect(() => loadTimeline(projectDir)).toThrow('다른 프로젝트에 속합니다');
  });
});

describe('video render planning', () => {
  it('writes SRT timing and produces a single-process FFmpeg plan', () => {
    const projectDir = fixtureProject();
    const source = path.join(projectDir, 'source.png');
    writeFileSync(source, Buffer.from('fake image'));
    const asset = addLocalAsset({
      projectDir,
      filePath: source,
      kind: 'image',
      sourceType: 'user-owned',
      license: 'Owned by test user',
    });
    buildTimeline(projectDir, [
      { id: 'scene-1', assetId: asset.id, durationSec: 2.5, onScreenText: '첫 장면' },
      { id: 'scene-2', assetId: asset.id, durationSec: 2.5, onScreenText: '둘째 장면' },
    ]);
    const plan = buildFfmpegPlan(projectDir, path.join(projectDir, 'render', 'out.mp4'), 'job-1');
    expect(plan.args).toContain('-filter_complex');
    expect(plan.args.join(' ')).toContain('concat=n=2');
    expect(plan.args.join(' ')).toContain('subtitles=render/captions-job-1.srt');
  });

  it('formats cumulative subtitle ranges', () => {
    const timeline: VideoTimeline = {
      version: 1,
      projectId: PROJECT_ID,
      createdAt: new Date(0).toISOString(),
      width: 1080,
      height: 1920,
      fps: 30,
      totalDurationSec: 4,
      scenes: [
        { id: 'one', assetId: 'a', durationSec: 1.25, onScreenText: 'One' },
        { id: 'two', assetId: 'b', durationSec: 2.75, onScreenText: 'Two' },
      ],
    };
    expect(formatSrt(timeline)).toContain('00:00:01,250 --> 00:00:04,000');
  });

  it('sanitizes subtitle control syntax instead of passing it to libass', () => {
    const timeline: VideoTimeline = {
      version: 1,
      projectId: PROJECT_ID,
      createdAt: new Date(0).toISOString(),
      width: 1080,
      height: 1920,
      fps: 30,
      totalDurationSec: 1,
      scenes: [{
        id: 'one',
        assetId: 'a',
        durationSec: 1,
        onScreenText: '<font>{\\an8}x</font>\n\n2\n00:00:00,000 --> 99:00:00,000',
      }],
    };
    const srt = formatSrt(timeline);
    expect(srt).not.toContain('<font>');
    expect(srt).not.toContain('--> 99:');
    expect(srt).toContain('｛\\an8｝');
  });

  it('rejects a hand-edited timeline before values reach FFmpeg filters', () => {
    const projectDir = fixtureProject();
    const source = path.join(projectDir, 'source.png');
    writeFileSync(source, Buffer.from('fake image'));
    const asset = addLocalAsset({
      projectDir,
      filePath: source,
      kind: 'image',
      sourceType: 'user-owned',
      license: 'Owned by test user',
    });
    buildTimeline(projectDir, [{ id: 'scene-1', assetId: asset.id, durationSec: 5 }]);
    const timelinePath = path.join(projectDir, 'timeline.json');
    const tampered = JSON.parse(readFileSync(timelinePath, 'utf8'));
    tampered.scenes[0].durationSec = '1;movie=attacker';
    writeFileSync(timelinePath, JSON.stringify(tampered));
    expect(() => loadTimeline(projectDir)).toThrow('영상 프로젝트 파일 검증 실패');
  });

  it('keeps a recent queued render lock instead of treating the startup window as stale', () => {
    const projectDir = fixtureProject();
    const jobId = '00000000-0000-4000-8000-000000000020';
    const outputPath = path.join(projectDir, 'render', 'same.mp4');
    const logPath = path.join(projectDir, '.jobs', `${jobId}.log`);
    writeFileSync(path.join(projectDir, '.jobs', `${jobId}.json`), JSON.stringify({
      id: jobId,
      status: 'queued',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      projectDir,
      outputPath,
      logPath,
    }));
    const lockPath = `${outputPath}.render.lock`;
    writeFileSync(lockPath, jobId);
    expect(() => renderTesting.acquireOutputLock(
      lockPath,
      projectDir,
      '00000000-0000-4000-8000-000000000021',
    )).toThrow('이미 실행 중');
  });
});

describe('provider boundaries', () => {
  it('accepts only official HTTPS Pexels media hosts', () => {
    expect(providerTesting.validatePexelsUrl('https://videos.pexels.com/video.mp4').hostname)
      .toBe('videos.pexels.com');
    expect(() => providerTesting.validatePexelsUrl('https://example.com/video.mp4'))
      .toThrow('허용되지 않은 Pexels');
    expect(() => providerTesting.validatePexelsUrl('http://videos.pexels.com/video.mp4'))
      .toThrow('허용되지 않은 Pexels');
  });

  it('allowlists research citations to collected references and direct observations', () => {
    const urls = researchTesting.urlsFromResearch(
      { references: [{ url: 'https://www.youtube.com/watch?v=allowed' }] },
      { results: [{ pageUrl: 'https://www.pexels.com/video/allowed' }] },
      [{ referenceUrl: 'https://example.com/observed', notes: 'watched by user' }],
    );
    expect([...urls]).toEqual(expect.arrayContaining([
      'https://www.youtube.com/watch?v=allowed',
      'https://www.pexels.com/video/allowed',
      'https://example.com/observed',
    ]));
    expect(urls.has('https://hallucinated.example')).toBe(false);
  });

  it('checks MP4 signatures without loading the whole file', () => {
    const projectDir = fixtureProject();
    const valid = path.join(projectDir, 'valid.mp4');
    const invalid = path.join(projectDir, 'invalid.mp4');
    writeFileSync(valid, Buffer.from([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d]));
    writeFileSync(invalid, Buffer.from('not an mp4'));
    expect(providerTesting.hasMp4Signature(valid)).toBe(true);
    expect(providerTesting.hasMp4Signature(invalid)).toBe(false);
  });
});
