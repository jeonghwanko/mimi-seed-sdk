import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { withClient } from './helpers.js';
import { loadProject, savePlan } from '../video/project.js';
import { requireAbsolutePath } from '../video/files.js';
import { assColor } from '../video/captions.js';
import { hexColorSchema } from '../video/schemas.js';
import { assertFfmpegPath, getRenderJob, validateVideo } from '../video/render.js';
import { loadPostPlan, publishPlannedVideo } from '../tiktok-business/posting.js';
import { parseJsonResponse, requireApiKey } from '../ai/client.js';
import { formatReviewReply } from '../ai/review.js';
import { formatGeneratedNotes } from '../ai/notes.js';

/**
 * English output of the video, TikTok Business, and AI generator paths. The Korean text is covered by the
 * per-module tests (vitest pins MIMI_SEED_LANG=ko); here the same code paths run with MIMI_SEED_LANG=en.
 */

const HANGUL = /[가-힣]/;
const dirs: string[] = [];

beforeEach(() => {
  vi.stubEnv('MIMI_SEED_LANG', 'en');
});

afterEach(() => {
  vi.unstubAllEnvs();
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

function errorOf(fn: () => unknown): string {
  try {
    fn();
  } catch (error) {
    return (error as Error).message;
  }
  throw new Error('expected a throw');
}

async function rejectionOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    return (error as Error).message;
  }
  throw new Error('expected a rejection');
}

function expectEnglish(message: string, phrase: string): void {
  expect(message).not.toMatch(HANGUL);
  expect(message).toContain(phrase);
}

describe('video output (en)', () => {
  it('project and file errors are English', () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'mimi-seed-video-en-'));
    dirs.push(dir);
    expectEnglish(errorOf(() => requireAbsolutePath('relative/dir', 'projectDir')), 'must be an absolute path');
    expectEnglish(errorOf(() => loadProject(dir)), 'Video project not found');
    const mismatch = errorOf(() => savePlan({
      projectDir: dir,
      title: 'T',
      story: 'S',
      language: 'en',
      aspectRatio: '9:16',
      targetDurationSec: 10,
      scenes: [{ durationSec: 3 }],
    }));
    expectEnglish(mismatch, 'Video project file validation failed');
    expect(mismatch).toContain('differs from targetDurationSec');
  });

  it('schema, caption, and render errors are English', () => {
    const parsed = hexColorSchema.safeParse('red');
    expect(parsed.success).toBe(false);
    expectEnglish(parsed.error!.issues[0].message, '#RRGGBB format');
    expectEnglish(errorOf(() => assColor('nope')), 'Invalid color format');
    expectEnglish(errorOf(() => assertFfmpegPath('relative/ffmpeg')), 'not a local absolute path');
    const dir = mkdtempSync(path.join(os.tmpdir(), 'mimi-seed-video-en-'));
    dirs.push(dir);
    expectEnglish(errorOf(() => getRenderJob(dir, '00000000-0000-4000-8000-000000000000')), 'Render job not found');
  });

  it('validateVideo rejects a missing file in English', async () => {
    expectEnglish(await rejectionOf(validateVideo('/nonexistent/video.mp4')), 'must be an existing absolute path');
  });
});

describe('TikTok Business output (en)', () => {
  it('plan and publish guards are English', async () => {
    expectEnglish(errorOf(() => loadPostPlan('bad')), 'Invalid planId format');
    expectEnglish(await rejectionOf(publishPlannedVideo('0'.repeat(32), false)), 'explicit approval');
  });
});

describe('AI generator output (en)', () => {
  it('missing API key and parse failure are English', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', '');
    expectEnglish(await rejectionOf(requireApiKey()), 'environment variable is required');
    expectEnglish(errorOf(() => parseJsonResponse('no json')), 'Failed to parse the AI response');
  });

  it('review reply and release-note framing are English', () => {
    const reply = formatReviewReply({ suggested: 'Thanks!', tone: 'friendly', language: 'en', note: 'n' });
    expectEnglish(reply, 'Suggested reply');
    const notes = formatGeneratedNotes({
      tones: [{ name: 'concise', text: 'Fixes.' }],
      localized: { ja: 'x' },
      rawCommitsUsed: 2,
    });
    expectEnglish(notes, '2 commits analyzed');
    expect(notes).toContain('Concise');
    expect(notes).toContain('Localized');
  });
});

describe('register schema messages (en)', () => {
  it('video and TikTok URL/path validators reply in English', async () => {
    const texts = await withClient(async (client) => {
      const video = await client.callTool({
        name: 'video_synthesize_research',
        arguments: { projectDir: '/tmp/none', observations: [{ referenceUrl: 'ftp://example.com/x', notes: 'n' }] },
      });
      const tiktok = await client.callTool({
        name: 'tiktok_business_plan_video_post',
        arguments: { sourceFilePath: 'relative.mp4', videoUrl: 'http://example.com/v.mp4' },
      });
      const text = (r: typeof video) => (r.content as Array<{ text: string }>).map((c) => c.text).join('\n');
      return { video: text(video), tiktok: text(tiktok) };
    }, { lang: 'en' });
    expectEnglish(texts.video, 'Only HTTP(S) URLs are allowed.');
    expectEnglish(texts.tiktok, 'Only absolute paths are allowed.');
    expect(texts.tiktok).toContain('Only HTTPS URLs are allowed.');
  });
});
