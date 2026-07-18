import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { __testing } from '../video/youtube-publish.js';

const dirs: string[] = [];

afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

describe('YouTube publishing safety', () => {
  it('public/unlisted는 명시 확인 없이는 거부하고 private는 허용한다', () => {
    expect(() => __testing.assertVisibilityConfirmed('public', false)).toThrow('confirmVisible=true');
    expect(() => __testing.assertVisibilityConfirmed('unlisted')).toThrow('confirmVisible=true');
    expect(() => __testing.assertVisibilityConfirmed('public', true)).not.toThrow();
    expect(() => __testing.assertVisibilityConfirmed('private')).not.toThrow();
  });

  it('업로드 파일은 존재하는 절대경로와 허용된 영상 확장자만 받는다', () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'mimi-seed-youtube-'));
    dirs.push(dir);
    mkdirSync(dir, { recursive: true });
    const mp4 = path.join(dir, 'short.mp4');
    const txt = path.join(dir, 'not-video.txt');
    writeFileSync(mp4, Buffer.from('video'));
    writeFileSync(txt, Buffer.from('text'));
    expect(__testing.assertUploadFile(mp4)).toMatchObject({ mimeType: 'video/mp4', size: 5 });
    expect(() => __testing.assertUploadFile('relative.mp4')).toThrow('절대경로');
    expect(() => __testing.assertUploadFile(txt)).toThrow('지원 영상 형식');
  });

  it('쇼츠는 세로/정사각형·180초 이하만 허용한다', () => {
    expect(() => __testing.assertShortsCompatible({ width: 1080, height: 1920, durationSec: 21 })).not.toThrow();
    expect(() => __testing.assertShortsCompatible({ width: 1920, height: 1080, durationSec: 21 })).toThrow('세로형');
    expect(() => __testing.assertShortsCompatible({ width: 1080, height: 1920, durationSec: 181 })).toThrow('180초');
  });

  it('YouTube 태그의 합산 500자 제한을 업로드 전에 검사한다', () => {
    expect(() => __testing.assertTags(['coffee', 'shorts'])).not.toThrow();
    expect(() => __testing.assertTags(['a'.repeat(250), 'b'.repeat(250)])).toThrow('500자');
  });
});
