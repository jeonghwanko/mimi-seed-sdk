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
  const org = opts.org ?? 'Supervlabs';
  const country = opts.country ?? 'KR';
  const dname = `CN=${opts.appName}, OU=Engineering, O=${org}, L=Seoul, ST=Seoul, C=${country}`;

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
