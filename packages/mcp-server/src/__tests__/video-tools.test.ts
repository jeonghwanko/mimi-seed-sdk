import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { addLocalAsset, buildTimeline, loadTimeline, registerAsset, savePlan, __testing as projectTesting } from '../video/project.js';
import { __testing as providerTesting } from '../video/providers.js';
import { formatAss, resolveCaptionStyle } from '../video/captions.js';
import { buildFfmpegPlan, __testing as renderTesting } from '../video/render.js';
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

  it('saves an agent-authored plan without any AI API key', () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'mimi-seed-video-plan-'));
    dirs.push(dir);
    const project = savePlan({
      projectDir: dir,
      title: '무료 쇼츠',
      story: '구독 토큰만으로 만든 영상',
      language: 'ko',
      aspectRatio: '9:16',
      targetDurationSec: 10,
      scenes: [
        { durationSec: 4, onScreenText: '이건 **무료**', visualPrompt: 'a coffee bean sprouting' },
        { durationSec: 6, narration: '결론', visualPrompt: 'sunrise over a farm' },
      ],
    });
    expect(project.scenes).toHaveLength(2);
    expect(project.scenes[0].id).toBe('scene-1');
    expect(project.scenes[1].searchQuery).toBe('sunrise over a farm');
    expect(JSON.parse(readFileSync(path.join(dir, 'project.json'), 'utf8')).title).toBe('무료 쇼츠');
    // 길이 합계가 target과 다르면 스키마가 거부한다
    expect(() => savePlan({
      projectDir: dir,
      title: 'x',
      story: 'y',
      language: 'ko',
      aspectRatio: '9:16',
      targetDurationSec: 10,
      scenes: [{ durationSec: 3 }],
      overwrite: true,
    })).toThrow('영상 프로젝트 파일 검증 실패');
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
  it('writes ASS captions and produces a single-process FFmpeg plan', () => {
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
    expect(plan.args.join(' ')).toContain('subtitles=render/captions-job-1.ass');
    expect(plan.args.join(' ')).not.toContain('force_style');
    const ass = readFileSync(plan.subtitlePath!, 'utf8');
    expect(ass).toContain('PlayResX: 1080');
    expect(ass).toContain('PlayResY: 1920');
  });

  function captionTimeline(scenes: VideoTimeline['scenes'], overrides?: Partial<VideoTimeline>): VideoTimeline {
    return {
      version: 1,
      projectId: PROJECT_ID,
      createdAt: new Date(0).toISOString(),
      width: 1080,
      height: 1920,
      fps: 30,
      totalDurationSec: scenes.reduce((sum, scene) => sum + scene.durationSec, 0),
      scenes,
      ...overrides,
    };
  }

  it('formats cumulative caption ranges in ASS time', () => {
    const timeline = captionTimeline([
      { id: 'one', assetId: 'a', durationSec: 1.25, onScreenText: 'One' },
      { id: 'two', assetId: 'b', durationSec: 2.75, onScreenText: 'Two' },
    ]);
    const ass = formatAss(timeline, resolveCaptionStyle(1080, 1920));
    expect(ass).toContain('Dialogue: 0,0:00:01.25,0:00:04.00,Caption');
  });

  it('applies shorts defaults: bold outline style, lower-middle placement, no opaque box', () => {
    const style = resolveCaptionStyle(1080, 1920);
    expect(style.fontSizePx).toBe(81);
    expect(style.position).toBe('lower-middle');
    const ass = formatAss(captionTimeline([
      { id: 'one', assetId: 'a', durationSec: 2, onScreenText: '첫 장면' },
    ]), style);
    // BorderStyle=1(외곽선), Alignment=2, MarginV=1920*0.28=538
    expect(ass).toMatch(/Style: Caption,Malgun Gothic,81,&H00FFFFFF,&H00FFFFFF,&H00000000,&H80000000,-1,0,0,0,100,100,0,0,1,4,0,2,97,97,538,1/);
    expect(ass).toContain('{\\fad(120,80)}');
  });

  it('renders **keyword** markup as a highlight color run', () => {
    const ass = formatAss(captionTimeline([
      { id: 'one', assetId: 'a', durationSec: 2, onScreenText: '이건 **진짜** 무료' },
    ]), resolveCaptionStyle(1080, 1920));
    expect(ass).toContain('{\\1c&H0000D4FF&}진짜{\\1c&H00FFFFFF&}');
    expect(ass).not.toContain('**');
  });

  it('renders the box preset with a translucent box for tutorials', () => {
    const style = resolveCaptionStyle(1080, 1920, { preset: 'box' });
    const ass = formatAss(captionTimeline([
      { id: 'one', assetId: 'a', durationSec: 2, onScreenText: '단계 1' },
    ]), style);
    expect(ass).toMatch(/,3,\d+,0,2,/); // BorderStyle=3
    expect(ass).toContain('&H50000000');
  });

  it('sanitizes caption control syntax instead of passing it to libass', () => {
    const ass = formatAss(captionTimeline([{
      id: 'one',
      assetId: 'a',
      durationSec: 1,
      onScreenText: '<font>{\\an8}x</font>\n\\N주입',
    }]), resolveCaptionStyle(1080, 1920));
    expect(ass).not.toContain('<font>');
    expect(ass).not.toContain('{\\an8}');
    expect(ass).toContain('｛＼an8｝');
    expect(ass).toContain('＼N주입');
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
