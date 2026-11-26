import fs from 'node:fs';
import path from 'node:path';
import { catalog } from '#core/lang.js';

/** Labels and issues returned by screenshot_validate. Spec labels are getters so they read the language at call time. */
const S = catalog(
  {
    ipadPro129Gen3: 'iPad Pro 12.9" (3세대+)',
    ipadPro129Gen2: 'iPad Pro 12.9" (2세대)',
    phone: '전화 스크린샷',
    sevenInch: '7인치 태블릿 스크린샷',
    tenInch: '10인치 태블릿 스크린샷',
    featureGraphic: '특성 그래픽',
    missing: '파일 없음',
    unreadable: 'PNG/JPEG가 아니거나 읽기 실패',
    appTooLarge: (maxMb: number) => `파일 크기 초과 (최대 ${maxMb}MB)`,
    resolutionMismatch: (label: string, expected: string, actual: string) => `해상도 불일치 (${label}): 필요 ${expected}, 현재 ${actual}`,
    unknownResolution: (actual: string) => `알 수 없는 해상도 ${actual} — Apple 스펙과 일치하지 않음`,
    over50mb: '파일 크기 50MB 초과',
    unknownImageType: (imageType: string, valid: string) => `알 수 없는 imageType: ${imageType}. 유효값: ${valid}`,
    playTooLarge: (sizeMb: string, maxMb: string) => `파일 크기 초과: ${sizeMb}MB (최대 ${maxMb}MB)`,
    widthOut: (w: number, min: number, max: number) => `너비 범위 초과: ${w}px (${min}~${max}px 필요)`,
    heightOut: (h: number, min: number, max: number) => `높이 범위 초과: ${h}px (${min}~${max}px 필요)`,
    aspectOut: (ar: string, min: number, max: number) => `종횡비 범위 초과: ${ar} (${min}~${max} 필요)`,
    summary: (platform: string, passed: number, total: number) => `📐 ${platform} 스크린샷 검증: ${passed}/${total} 통과\n`,
  },
  {
    ipadPro129Gen3: 'iPad Pro 12.9" (3rd gen+)',
    ipadPro129Gen2: 'iPad Pro 12.9" (2nd gen)',
    phone: 'Phone screenshots',
    sevenInch: '7-inch tablet screenshots',
    tenInch: '10-inch tablet screenshots',
    featureGraphic: 'Feature graphic',
    missing: 'File not found',
    unreadable: 'Not a PNG/JPEG, or failed to read',
    appTooLarge: (maxMb: number) => `File size exceeded (max ${maxMb}MB)`,
    resolutionMismatch: (label: string, expected: string, actual: string) => `Resolution mismatch (${label}): required ${expected}, actual ${actual}`,
    unknownResolution: (actual: string) => `Unknown resolution ${actual} — does not match any Apple spec`,
    over50mb: 'File size over 50MB',
    unknownImageType: (imageType: string, valid: string) => `Unknown imageType: ${imageType}. Valid values: ${valid}`,
    playTooLarge: (sizeMb: string, maxMb: string) => `File size exceeded: ${sizeMb}MB (max ${maxMb}MB)`,
    widthOut: (w: number, min: number, max: number) => `Width out of range: ${w}px (${min}~${max}px required)`,
    heightOut: (h: number, min: number, max: number) => `Height out of range: ${h}px (${min}~${max}px required)`,
    aspectOut: (ar: string, min: number, max: number) => `Aspect ratio out of range: ${ar} (${min}~${max} required)`,
    summary: (platform: string, passed: number, total: number) => `📐 ${platform} screenshot validation: ${passed}/${total} passed\n`,
  },
);

export interface ScreenshotSpec {
  label: string;
  width: number;
  height: number;
  minWidth?: number;
  maxWidth?: number;
  minHeight?: number;
  maxHeight?: number;
  maxBytes: number;
}

export interface ValidationResult {
  filePath: string;
  fileName: string;
  valid: boolean;
  issues: string[];
  info: { sizeBytes: number; detectedWidth?: number; detectedHeight?: number };
  matchedSpec?: string;
}

export const APPSTORE_SPECS: Record<string, ScreenshotSpec> = {
  'APP_IPHONE_69': { label: 'iPhone 6.9"', width: 1320, height: 2868, maxBytes: 50 * 1024 * 1024 },
  'APP_IPHONE_67': { label: 'iPhone 6.7"', width: 1290, height: 2796, maxBytes: 50 * 1024 * 1024 },
  'APP_IPHONE_65': { label: 'iPhone 6.5"', width: 1242, height: 2688, maxBytes: 50 * 1024 * 1024 },
  'APP_IPHONE_61': { label: 'iPhone 6.1"', width: 1170, height: 2532, maxBytes: 50 * 1024 * 1024 },
  'APP_IPHONE_58': { label: 'iPhone 5.8"', width: 1125, height: 2436, maxBytes: 50 * 1024 * 1024 },
  'APP_IPHONE_55': { label: 'iPhone 5.5"', width: 1242, height: 2208, maxBytes: 50 * 1024 * 1024 },
  'APP_IPAD_PRO_3GEN_129': { get label() { return S().ipadPro129Gen3; }, width: 2064, height: 2752, maxBytes: 50 * 1024 * 1024 },
  'APP_IPAD_PRO_3GEN_11': { label: 'iPad Pro 11"', width: 1668, height: 2388, maxBytes: 50 * 1024 * 1024 },
  'APP_IPAD_PRO_129': { get label() { return S().ipadPro129Gen2; }, width: 2048, height: 2732, maxBytes: 50 * 1024 * 1024 },
  'APP_DESKTOP': { label: 'Mac', minWidth: 1280, maxWidth: 2560, minHeight: 800, maxHeight: 1600, width: 1440, height: 900, maxBytes: 50 * 1024 * 1024 },
};

export const PLAYSTORE_SPECS = {
  phoneScreenshots:     { get label() { return S().phone; }, minWidth: 320,  maxWidth: 3840, minHeight: 320,  maxHeight: 3840, minAspect: 0.5, maxAspect: 2.0, maxBytes: 8 * 1024 * 1024 },
  sevenInchScreenshots: { get label() { return S().sevenInch; }, minWidth: 320,  maxWidth: 3840, minHeight: 320,  maxHeight: 3840, minAspect: 0.5, maxAspect: 2.0, maxBytes: 8 * 1024 * 1024 },
  tenInchScreenshots:   { get label() { return S().tenInch; }, minWidth: 1080, maxWidth: 7680, minHeight: 1080, maxHeight: 7680, minAspect: 0.5, maxAspect: 2.0, maxBytes: 8 * 1024 * 1024 },
  featureGraphic:       { get label() { return S().featureGraphic; }, minWidth: 1024, maxWidth: 1024, minHeight: 500,  maxHeight: 500,  minAspect: 2.048, maxAspect: 2.048, maxBytes: 1024 * 1024 },
};

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47];

function readPngDimensions(filePath: string): { width: number; height: number } | null {
  try {
    const fd = fs.openSync(filePath, 'r');
    const buf = Buffer.alloc(24);
    fs.readSync(fd, buf, 0, 24, 0);
    fs.closeSync(fd);
    if (PNG_SIGNATURE.some((b, i) => buf[i] !== b)) return null;
    return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  } catch { return null; }
}

function readJpegDimensions(filePath: string): { width: number; height: number } | null {
  try {
    // JPEG SOF markers typically appear within the first 64KB
    const fd = fs.openSync(filePath, 'r');
    const chunk = Buffer.alloc(65536);
    const bytesRead = fs.readSync(fd, chunk, 0, chunk.length, 0);
    fs.closeSync(fd);
    const data = chunk.subarray(0, bytesRead);
    if (data[0] !== 0xFF || data[1] !== 0xD8) return null;
    let i = 2;
    while (i < data.length - 8) {
      if (data[i] !== 0xFF) break;
      const marker = data[i + 1];
      const length = data.readUInt16BE(i + 2);
      if (marker === 0xC0 || marker === 0xC2) {
        return { height: data.readUInt16BE(i + 5), width: data.readUInt16BE(i + 7) };
      }
      i += 2 + length;
    }
    return null;
  } catch { return null; }
}

function getImageDimensions(filePath: string): { width: number; height: number } | null {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.png') return readPngDimensions(filePath);
  if (ext === '.jpg' || ext === '.jpeg') return readJpegDimensions(filePath);
  return null;
}

export function validateAppStoreScreenshots(filePaths: string[], expectedDisplayType?: string): ValidationResult[] {
  return filePaths.map((filePath) => {
    const fileName = path.basename(filePath);
    const issues: string[] = [];

    if (!fs.existsSync(filePath)) {
      return { filePath, fileName, valid: false, issues: [S().missing], info: { sizeBytes: 0 } };
    }

    const sizeBytes = fs.statSync(filePath).size;
    const dims = getImageDimensions(filePath);
    const info: ValidationResult['info'] = { sizeBytes, detectedWidth: dims?.width, detectedHeight: dims?.height };

    if (!dims) {
      return { filePath, fileName, valid: false, issues: [S().unreadable], info };
    }

    let matchedSpec: string | undefined;

    if (expectedDisplayType && APPSTORE_SPECS[expectedDisplayType]) {
      const spec = APPSTORE_SPECS[expectedDisplayType];
      if (sizeBytes > spec.maxBytes) issues.push(S().appTooLarge(spec.maxBytes / 1024 / 1024 | 0));
      const wOk = spec.minWidth ? dims.width >= spec.minWidth && dims.width <= (spec.maxWidth ?? Infinity) : dims.width === spec.width;
      const hOk = spec.minHeight ? dims.height >= spec.minHeight && dims.height <= (spec.maxHeight ?? Infinity) : dims.height === spec.height;
      if (!wOk || !hOk) {
        const expected = spec.minWidth ? `${spec.minWidth}~${spec.maxWidth}×${spec.minHeight}~${spec.maxHeight}` : `${spec.width}×${spec.height}`;
        issues.push(S().resolutionMismatch(spec.label, expected, `${dims.width}×${dims.height}`));
      } else {
        matchedSpec = spec.label;
      }
    } else {
      for (const [key, spec] of Object.entries(APPSTORE_SPECS)) {
        // check both portrait and landscape orientations
        const fw = dims.width, fh = dims.height;
        const matches = (w: number, h: number) =>
          spec.minWidth ? (w >= spec.minWidth && w <= (spec.maxWidth ?? Infinity) && h >= (spec.minHeight ?? 0) && h <= (spec.maxHeight ?? Infinity))
                        : (w === spec.width && h === spec.height) || (w === spec.height && h === spec.width);
        if (matches(fw, fh)) { matchedSpec = `${key} (${spec.label})`; break; }
      }
      if (!matchedSpec) {
        issues.push(S().unknownResolution(`${dims.width}×${dims.height}`));
      }
      if (sizeBytes > 50 * 1024 * 1024) issues.push(S().over50mb);
    }

    return { filePath, fileName, valid: issues.length === 0, issues, info, matchedSpec };
  });
}

export function validatePlayStoreScreenshots(filePaths: string[], imageType = 'phoneScreenshots'): ValidationResult[] {
  if (!(imageType in PLAYSTORE_SPECS)) {
    return filePaths.map((fp) => ({
      filePath: fp, fileName: path.basename(fp), valid: false,
      issues: [S().unknownImageType(imageType, Object.keys(PLAYSTORE_SPECS).join(', '))],
      info: { sizeBytes: 0 },
    }));
  }

  const spec = PLAYSTORE_SPECS[imageType as keyof typeof PLAYSTORE_SPECS];

  return filePaths.map((filePath) => {
    const fileName = path.basename(filePath);
    const issues: string[] = [];

    if (!fs.existsSync(filePath)) {
      return { filePath, fileName, valid: false, issues: [S().missing], info: { sizeBytes: 0 } };
    }

    const sizeBytes = fs.statSync(filePath).size;
    if (sizeBytes > spec.maxBytes) {
      issues.push(S().playTooLarge((sizeBytes / 1024 / 1024).toFixed(1), (spec.maxBytes / 1024 / 1024).toFixed(0)));
    }

    const dims = getImageDimensions(filePath);
    const info: ValidationResult['info'] = { sizeBytes, detectedWidth: dims?.width, detectedHeight: dims?.height };

    if (!dims) return { filePath, fileName, valid: false, issues: [S().unreadable, ...issues], info };

    if (dims.width < spec.minWidth || dims.width > spec.maxWidth) {
      issues.push(S().widthOut(dims.width, spec.minWidth, spec.maxWidth));
    }
    if (dims.height < spec.minHeight || dims.height > spec.maxHeight) {
      issues.push(S().heightOut(dims.height, spec.minHeight, spec.maxHeight));
    }
    const ar = dims.width / dims.height;
    if (ar < spec.minAspect || ar > spec.maxAspect) {
      issues.push(S().aspectOut(ar.toFixed(2), spec.minAspect, spec.maxAspect));
    }

    return { filePath, fileName, valid: issues.length === 0, issues, info };
  });
}

export function formatValidationResults(results: ValidationResult[], platform: string): string {
  const passed = results.filter((r) => r.valid).length;
  const lines: string[] = [S().summary(platform, passed, results.length)];
  for (const r of results) {
    const dims = r.info.detectedWidth ? ` (${r.info.detectedWidth}×${r.info.detectedHeight})` : '';
    const size = ` ${(r.info.sizeBytes / 1024).toFixed(0)}KB`;
    lines.push(`${r.valid ? '✅' : '❌'} ${r.fileName}${dims}${size}`);
    if (r.matchedSpec) lines.push(`   → ${r.matchedSpec}`);
    for (const issue of r.issues) lines.push(`   ⚠ ${issue}`);
  }
  return lines.join('\n');
}
