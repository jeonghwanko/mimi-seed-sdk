import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { readFileSync, unlinkSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export interface GeneratedKeystore {
  keystoreBase64: string;
  storePassword: string;
  keyAlias: string;
  keyPassword: string;
}

function randomPassword(len = 20): string {
  // alphanumeric — avoid quoting/escape issues in shell / Gradle properties
  return randomBytes(32).toString('base64url').replace(/[^a-zA-Z0-9]/g, '').slice(0, len);
}

export function isKeytoolAvailable(): boolean {
  const cmd = process.platform === 'win32' ? 'where' : 'which';
  const result = spawnSync(cmd, ['keytool'], { encoding: 'utf-8' });
  return result.status === 0;
}

export function generateKeystore(opts: {
  appName: string;
  org?: string;
  country?: string;
}): GeneratedKeystore {
  const storePassword = randomPassword(20);
  const keyPassword = randomPassword(20);
  const keyAlias = 'upload';
  // 조직명 기본값은 앱 이름 자체다. 예전엔 한 사설 조직명이 박혀 있어서 이 도구로 만든
  // **모든 사용자의 서명 키**에 남의 조직이 들어갔다. 지역(L/ST)도 Seoul 로 고정돼 있었는데,
  // X.500 에서 선택 항목이므로 값을 지어내는 대신 뺀다 (C 는 사용자가 고를 수 있다).
  const org = opts.org ?? opts.appName;
  const country = opts.country ?? 'KR';
  const dname = `CN=${opts.appName}, OU=Engineering, O=${org}, C=${country}`;

  const keystorePath = join(tmpdir(), `mimi-seed-ks-${Date.now()}.jks`);
  try {
    const result = spawnSync(
      'keytool',
      [
        '-genkeypair', '-v',
        '-keystore', keystorePath,
        '-keyalg', 'RSA',
        '-keysize', '2048',
        '-validity', '10000',
        '-alias', keyAlias,
        '-storepass', storePassword,
        '-keypass', keyPassword,
        '-dname', dname,
        '-storetype', 'JKS',
      ],
      { stdio: 'pipe', encoding: 'buffer' },
    );

    if (result.status !== 0) {
      const stderr = result.stderr?.toString('utf-8') ?? '';
      throw new Error(`keytool 실패:\n${stderr}`);
    }

    const keystoreBuffer = readFileSync(keystorePath);
    return {
      keystoreBase64: keystoreBuffer.toString('base64'),
      storePassword,
      keyAlias,
      keyPassword,
    };
  } finally {
    if (existsSync(keystorePath)) unlinkSync(keystorePath);
  }
}
