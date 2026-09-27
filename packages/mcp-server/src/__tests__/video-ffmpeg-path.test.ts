import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * ffmpegPath 는 임의 실행 파일이 아니다 (2026-09 보안 점검).
 *
 * video_render / video_validate / tiktok_business_plan_video_post 는 ffmpegPath 를 받아
 * 그대로 execFile 했다 — `/bin/sh` 나 받은 스크립트를 넘기면 그게 실행됐다. 이제 파일 이름이
 * ffmpeg(.exe) 인 경로만 받고, 검사는 **실행 전에** 끝난다.
 */

const mocks = vi.hoisted(() => ({ execFile: vi.fn(), spawn: vi.fn() }));
vi.mock('node:child_process', async (original) => {
  const actual = await original<typeof import('node:child_process')>();
  return { ...actual, execFile: mocks.execFile, spawn: mocks.spawn };
});

import { assertFfmpegPath, validateVideo } from '../video/render.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mimi-ffmpeg-path-'));
const video = path.join(tmp, 'clip.mp4');
fs.writeFileSync(video, 'not really a video');

afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));
beforeEach(() => vi.clearAllMocks());

describe('assertFfmpegPath', () => {
  it.each([
    '/usr/local/bin/ffmpeg',
    'C:\\tools\\ffmpeg\\bin\\ffmpeg.exe',
    'C:\\tools\\ffmpeg\\bin\\FFMPEG.EXE',
    'ffmpeg',
  ])('ffmpeg 실행 파일 %s 은 통과', (p) => {
    expect(assertFfmpegPath(p)).toBe(p);
  });

  it.each([
    '/bin/sh',
    'C:\\Windows\\System32\\cmd.exe',
    '/tmp/ffmpeg.sh',
    '/tmp/ffmpeg-evil',
    '/tmp/ffmpeg/../sh',
    '/opt/ffprobe',
    'powershell',
  ])('ffmpeg 가 아닌 %s 은 거부', (p) => {
    expect(() => assertFfmpegPath(p)).toThrow(/ffmpeg 실행 파일/);
  });
});

describe('validateVideo', () => {
  it('허용되지 않은 ffmpegPath 면 아무것도 실행하지 않는다', async () => {
    await expect(validateVideo(video, '/bin/sh')).rejects.toThrow(/ffmpeg 실행 파일/);
    expect(mocks.execFile).not.toHaveBeenCalled();
  });

  it('환경변수가 설정돼 있어도 잘못된 인자를 조용히 무시하지 않는다', async () => {
    vi.stubEnv('MIMI_SEED_FFPROBE_PATH', '/usr/bin/ffprobe');
    try {
      await expect(validateVideo(video, '/bin/sh')).rejects.toThrow(/ffmpeg 실행 파일/);
      expect(mocks.execFile).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('정상 ffmpegPath 면 같은 폴더의 ffprobe 를 실행한다', async () => {
    mocks.execFile.mockImplementation((_cmd: string, _args: string[], _opts: unknown, cb: (e: unknown, r: unknown) => void) => {
      cb(null, { stdout: JSON.stringify({ streams: [{ codec_type: 'video', codec_name: 'h264', pix_fmt: 'yuv420p' }] }), stderr: '' });
    });
    const ffmpeg = path.join(tmp, 'bin', 'ffmpeg');
    const r = await validateVideo(video, ffmpeg);
    expect(r.valid).toBe(true);
    expect(mocks.execFile.mock.calls[0][0]).toBe(path.join(tmp, 'bin', 'ffprobe'));
  });
});
