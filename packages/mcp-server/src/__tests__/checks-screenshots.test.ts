import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';

import {
  validateAppStoreScreenshots,
  validatePlayStoreScreenshots,
  formatValidationResults,
  APPSTORE_SPECS,
} from '../checks/screenshots.js';

/**
 * 스크린샷 사전 검증기. 이게 잘못 통과시키면 사용자는 업로드를 다 마친 뒤
 * **스토어 쪽에서** 거절당한다 — 사전 검증의 존재 이유가 사라진다. 반대로 잘못
 * 막으면 멀쩡한 이미지를 못 올린다. 그래서 경계값을 양쪽으로 본다.
 */

let tmp: string;

/** 지정한 크기의 최소 유효 PNG. 헤더만 정확하면 치수 판독에는 충분하다. */
function writePng(name: string, width: number, height: number, padBytes = 0): string {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA

  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length, 0);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(zlib.crc32 ? zlib.crc32(body) >>> 0 : 0, 0);
    return Buffer.concat([len, body, crc]);
  };

  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IEND', Buffer.alloc(0)),
    Buffer.alloc(padBytes), // 파일 크기 규칙을 시험하기 위한 패딩
  ]);

  const p = path.join(tmp, name);
  fs.writeFileSync(p, png);
  return p;
}

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mimi-shotcheck-'));
});
afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

describe('validateAppStoreScreenshots', () => {
  it('스펙과 정확히 맞는 해상도를 통과시킨다', () => {
    const spec = APPSTORE_SPECS.APP_IPHONE_67;
    const [r] = validateAppStoreScreenshots([writePng('a.png', spec.width, spec.height)], 'APP_IPHONE_67');

    expect(r.valid).toBe(true);
    expect(r.issues).toEqual([]);
    expect(r.info.detectedWidth).toBe(spec.width);
  });

  it('1픽셀만 틀려도 잡아낸다 (Apple 이 정확히 일치를 요구한다)', () => {
    const spec = APPSTORE_SPECS.APP_IPHONE_67;
    const [r] = validateAppStoreScreenshots(
      [writePng('a.png', spec.width - 1, spec.height)],
      'APP_IPHONE_67',
    );

    expect(r.valid).toBe(false);
    expect(r.issues[0]).toMatch(/해상도 불일치/);
  });

  it('displayType 을 안 주면 알려진 스펙 중 하나에 맞는지 스스로 찾는다', () => {
    const spec = APPSTORE_SPECS.APP_IPHONE_65;
    const [r] = validateAppStoreScreenshots([writePng('a.png', spec.width, spec.height)]);

    expect(r.valid).toBe(true);
    expect(r.matchedSpec).toContain('APP_IPHONE_65');
  });

  it('가로/세로가 뒤집힌 것도 같은 스펙으로 인정한다 (landscape 스크린샷)', () => {
    const spec = APPSTORE_SPECS.APP_IPHONE_65;
    const [r] = validateAppStoreScreenshots([writePng('a.png', spec.height, spec.width)]);

    expect(r.valid).toBe(true);
  });

  it('어떤 스펙에도 안 맞으면 통과시키지 않는다', () => {
    const [r] = validateAppStoreScreenshots([writePng('a.png', 800, 600)]);

    expect(r.valid).toBe(false);
    expect(r.issues[0]).toMatch(/알 수 없는 해상도 800×600/);
  });

  it('Mac 은 고정 크기가 아니라 범위로 판정한다', () => {
    const inRange = validateAppStoreScreenshots([writePng('a.png', 1440, 900)], 'APP_DESKTOP')[0];
    const tooSmall = validateAppStoreScreenshots([writePng('b.png', 1000, 700)], 'APP_DESKTOP')[0];

    expect(inRange.valid).toBe(true);
    expect(tooSmall.valid).toBe(false);
  });

  it('파일이 없으면 크래시하지 않고 "파일 없음" 으로 보고한다', () => {
    const [r] = validateAppStoreScreenshots([path.join(tmp, 'missing.png')]);

    expect(r.valid).toBe(false);
    expect(r.issues).toEqual(['파일 없음']);
  });

  it('PNG/JPEG 가 아니면 치수를 지어내지 않는다', () => {
    const p = path.join(tmp, 'a.txt');
    fs.writeFileSync(p, 'not an image');

    const [r] = validateAppStoreScreenshots([p]);

    expect(r.valid).toBe(false);
    expect(r.issues[0]).toMatch(/PNG\/JPEG가 아니거나/);
    expect(r.info.detectedWidth).toBeUndefined();
  });
});

describe('validatePlayStoreScreenshots', () => {
  it('범위 안의 해상도·종횡비를 통과시킨다', () => {
    const [r] = validatePlayStoreScreenshots([writePng('a.png', 1080, 1920)], 'phoneScreenshots');
    expect(r.valid).toBe(true);
  });

  it('종횡비가 2:1 을 넘으면 잡는다', () => {
    const [r] = validatePlayStoreScreenshots([writePng('a.png', 3000, 400)], 'phoneScreenshots');

    expect(r.valid).toBe(false);
    expect(r.issues.some((i) => i.includes('종횡비'))).toBe(true);
  });

  it('너비·높이 위반을 각각 따로 보고한다 (하나만 알려주면 두 번 왕복한다)', () => {
    const [r] = validatePlayStoreScreenshots([writePng('a.png', 200, 100)], 'phoneScreenshots');

    expect(r.issues.some((i) => i.includes('너비'))).toBe(true);
    expect(r.issues.some((i) => i.includes('높이'))).toBe(true);
  });

  it('featureGraphic 은 1024×500 고정이다', () => {
    const ok = validatePlayStoreScreenshots([writePng('a.png', 1024, 500)], 'featureGraphic')[0];
    const bad = validatePlayStoreScreenshots([writePng('b.png', 1024, 512)], 'featureGraphic')[0];

    expect(ok.valid).toBe(true);
    expect(bad.valid).toBe(false);
  });

  it('파일 크기 상한을 넘으면 잡는다', () => {
    const big = writePng('a.png', 1024, 500, 1024 * 1024 + 10); // featureGraphic 상한 1MB
    const [r] = validatePlayStoreScreenshots([big], 'featureGraphic');

    expect(r.valid).toBe(false);
    expect(r.issues.some((i) => i.includes('파일 크기 초과'))).toBe(true);
  });

  it('모르는 imageType 은 조용히 통과시키지 않고 유효값을 알려준다', () => {
    const [r] = validatePlayStoreScreenshots([writePng('a.png', 1080, 1920)], 'nope');

    expect(r.valid).toBe(false);
    expect(r.issues[0]).toMatch(/알 수 없는 imageType: nope/);
    expect(r.issues[0]).toContain('phoneScreenshots');
  });
});

describe('formatValidationResults', () => {
  it('통과/실패 수를 함께 보여주고 실패 사유를 나열한다', () => {
    const results = validatePlayStoreScreenshots(
      [writePng('ok.png', 1080, 1920), writePng('bad.png', 3000, 400)],
      'phoneScreenshots',
    );

    const out = formatValidationResults(results, 'Play Store');

    expect(out).toContain('ok.png');
    expect(out).toContain('bad.png');
    expect(out).toMatch(/종횡비/);
  });
});
