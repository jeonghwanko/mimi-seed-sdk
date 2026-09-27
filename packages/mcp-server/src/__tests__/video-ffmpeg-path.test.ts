import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * ffmpegPath 는 임의 실행 파일이 아니다 (2026-09 보안 점검 + 적대적 재검토).
 *
 * video_render / video_validate / tiktok_business_plan_video_post 는 ffmpegPath 를 받아
 * 그대로 execFile 했다. 1차 수정(파일 이름 검사)은 `\\host\share\ffmpeg.exe` 같은 UNC·WebDAV
 * 경로를 통과시켜 원격 바이너리 실행 + NTLM 해시 유출이 가능했다. 이제
 *  - MCP 도구 스키마는 ffmpegPath 를 아예 받지 않고 (환경변수 / PATH 만),
 *  - 내부 인자는 로컬 절대경로 → realpath → 일반 파일 → 이름 ffmpeg 순으로 검사한다.
 * 검사는 파일시스템에 손대기 전(UNC 거부)과 실행 전에 끝난다.
 */

const mocks = vi.hoisted(() => ({ execFile: vi.fn(), spawn: vi.fn() }));
vi.mock('node:child_process', async (original) => {
  const actual = await original<typeof import('node:child_process')>();
  return { ...actual, execFile: mocks.execFile, spawn: mocks.spawn };
});

import { assertFfmpegPath, validateVideo } from '../video/render.js';
import { withClient } from './helpers.js';

const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'mimi-ffmpeg-path-')));
const binDir = path.join(tmp, 'bin');
fs.mkdirSync(binDir);
const exe = process.platform === 'win32' ? '.exe' : '';
const ffmpeg = path.join(binDir, `ffmpeg${exe}`);
fs.writeFileSync(ffmpeg, 'fake');
const video = path.join(tmp, 'clip.mp4');
fs.writeFileSync(video, 'not really a video');

afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));
beforeEach(() => vi.clearAllMocks());

describe('assertFfmpegPath', () => {
  it('존재하는 로컬 ffmpeg 절대경로는 realpath 로 통과', () => {
    expect(assertFfmpegPath(ffmpeg)).toBe(ffmpeg);
  });

  it.each([
    ['\\\\evil.example\\share\\ffmpeg.exe', /UNC/],
    ['//evil.example/share/ffmpeg.exe', /UNC/],
    ['\\\\evil@SSL\\DavWWWRoot\\ffmpeg.exe', /UNC/],
    ['\\\\?\\C:\\tools\\ffmpeg.exe', /UNC/],
    ['\\\\.\\C:\\tools\\ffmpeg.exe', /UNC/],
    ['ffmpeg', /절대경로/],
    ['bin/ffmpeg', /절대경로/],
    ['/bin/sh', process.platform === 'win32' ? /절대경로/ : /이름/],
    ['C:\\Windows\\System32\\cmd.exe', process.platform === 'win32' ? /이름/ : /절대경로/],
  ])('%s 는 거부', (p, why) => {
    expect(() => assertFfmpegPath(p)).toThrow(why);
  });

  it('없는 파일은 거부 (이름이 맞아도)', () => {
    expect(() => assertFfmpegPath(path.join(tmp, 'nope', `ffmpeg${exe}`))).toThrow(/파일이 없음/);
  });

  it('이름이 ffmpeg 인 디렉터리는 거부', () => {
    const dir = path.join(tmp, 'dir', `ffmpeg${exe}`);
    fs.mkdirSync(dir, { recursive: true });
    expect(() => assertFfmpegPath(dir)).toThrow(/일반 파일/);
  });

  it.runIf(process.platform !== 'win32')('다른 실행 파일을 가리키는 ffmpeg 심볼릭 링크는 거부', () => {
    const target = path.join(tmp, 'sh');
    fs.writeFileSync(target, 'fake');
    const link = path.join(tmp, 'link', 'ffmpeg');
    fs.mkdirSync(path.dirname(link));
    fs.symlinkSync(target, link);
    expect(() => assertFfmpegPath(link)).toThrow(/링크 대상/);
  });
});

describe('validateVideo', () => {
  it('허용되지 않은 ffmpegPath 면 아무것도 실행하지 않는다', async () => {
    await expect(validateVideo(video, '\\\\evil.example\\share\\ffmpeg.exe')).rejects.toThrow(/UNC/);
    expect(mocks.execFile).not.toHaveBeenCalled();
  });

  it('환경변수가 설정돼 있어도 잘못된 인자를 조용히 무시하지 않는다', async () => {
    vi.stubEnv('MIMI_SEED_FFPROBE_PATH', '/usr/bin/ffprobe');
    try {
      await expect(validateVideo(video, '//evil.example/share/ffmpeg.exe')).rejects.toThrow(/UNC/);
      expect(mocks.execFile).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('정상 ffmpegPath 면 같은 폴더의 ffprobe 를 실행한다', async () => {
    mocks.execFile.mockImplementation((_cmd: string, _args: string[], _opts: unknown, cb: (e: unknown, r: unknown) => void) => {
      cb(null, { stdout: JSON.stringify({ streams: [{ codec_type: 'video', codec_name: 'h264', pix_fmt: 'yuv420p' }] }), stderr: '' });
    });
    const r = await validateVideo(video, ffmpeg);
    expect(r.valid).toBe(true);
    expect(mocks.execFile.mock.calls[0][0]).toBe(path.join(binDir, `ffprobe${exe}`));
  });
});

describe('MCP 도구 스키마', () => {
  it('어떤 도구도 실행 파일 경로(ffmpegPath)를 인자로 받지 않는다', async () => {
    const offenders = await withClient(async (client) => {
      const { tools } = await client.listTools();
      return tools
        .filter((t) => Object.keys((t.inputSchema as { properties?: object }).properties ?? {})
          .some((k) => /ffmpeg|ffprobe/i.test(k)))
        .map((t) => t.name);
    });
    expect(offenders, 'MIMI_SEED_FFMPEG_PATH / PATH 로만 설정하세요').toEqual([]);
  });
});
