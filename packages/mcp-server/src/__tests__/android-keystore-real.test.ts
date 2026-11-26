import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { generateKeystore, isKeytoolAvailable } from '../android/keystore.js';

/**
 * 실제 keytool 로 돌리는 통합 테스트 (android-keystore.test.ts 는 child_process 를 모킹한다).
 * 모킹으로는 "spawnSync 처럼 스레드를 막지 않는다"를 증명할 수 없다 — 여기서 진짜 JVM 을 띄워 확인한다.
 * GitHub 러너(ubuntu · macOS · Windows)에는 JDK 가 있다. keytool 이 없는 개발 머신에서는 건너뛴다.
 */
function hasRealKeytool(): boolean {
  try {
    execFileSync('keytool', ['-help'], { stdio: 'ignore', timeout: 20_000 });
    return true;
  } catch {
    return false;
  }
}

// 전용 tmp — 공용 tmp 를 쓰면 병렬로 도는 다른 테스트가 이 파일의 임시 폴더를 보거나 지울 수 있다.
let privateTmp: string;
const strays = () => fs.readdirSync(privateTmp).filter((f) => f.startsWith('mimi-seed-ks-'));

describe.skipIf(!hasRealKeytool())('generateKeystore — 실제 keytool', () => {
  beforeEach(() => {
    privateTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'keystore-real-test-'));
    for (const key of ['TMPDIR', 'TEMP', 'TMP']) vi.stubEnv(key, privateTmp);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    fs.rmSync(privateTmp, { recursive: true, force: true });
  });

  it('사용 가능으로 판정한다', async () => {
    expect(await isKeytoolAvailable()).toBe(true);
  });

  it('유효한 JKS 를 만들고, 그동안 이벤트 루프가 계속 돈다', async () => {
    // 생성이 **끝나기 전에** 돈 타이머만 센다. spawnSync 였다면 호출이 끝난 뒤 밀린 타이머가 한 번 도는 게
    // 전부다(대조 실험: 1회) — 그래서 "0 보다 크다"로는 아무것도 증명하지 못한다. JVM 기동 + RSA 2048 은
    // 수백 ms 라 10ms 간격이면 수십 번 돈다.
    let pending = true;
    let ticksWhilePending = 0;
    const timer = setInterval(() => { if (pending) ticksWhilePending += 1; }, 10);
    try {
      const ks = await generateKeystore({ appName: 'ExampleApp', org: 'Example Org', country: 'US' });
      pending = false;
      const bytes = Buffer.from(ks.keystoreBase64, 'base64');
      // JKS 매직 넘버 0xFEEDFEED — keytool 이 진짜 키스토어를 썼다.
      expect(bytes.subarray(0, 4).toString('hex')).toBe('feedfeed');
    } finally {
      pending = false;
      clearInterval(timer);
    }
    expect(ticksWhilePending).toBeGreaterThanOrEqual(5);
    expect(strays()).toEqual([]);
  }, 90_000);
});
