import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { existingAppSigningPlanLines, newAppSigningPlanLines } from '../android/messages.js';

/**
 * android_signing_setup 계획 문구 — 에이전트가 그대로 따라 한다. 예전 기존 앱 계획은
 * `keystore_base64=…` / `secret=…` 를 넘기라고 해서 keystore 와 비밀번호가 대화 기록에 남았다.
 * 이제는 사용자가 파일을 ~/.mimi-seed/keystores/<패키지>/ 에 두고, 도구에는 경로만 넘긴다.
 */
const dir = path.join('/home/u', '.mimi-seed', 'keystores', 'com.example.shop');
const keystorePath = path.join(dir, 'upload.jks');
const secretsPath = path.join(dir, 'signing.json');

function expectPathBased(text: string) {
  expect(text).not.toMatch(/keystore_base64\s*=/);
  expect(text).not.toMatch(/\bsecret\s*=/);
  expect(text).toContain(`keystore_path="${keystorePath}"`);
  for (const field of ['storePassword', 'keyAlias', 'keyPassword']) {
    expect(text).toContain(`secret_file="${secretsPath}", secret_field="${field}"`);
  }
}

describe('existingAppSigningPlanLines', () => {
  const text = existingAppSigningPlanLines('com.example.shop', 'shop', '✅ Jenkins 연결됨', dir).join('\n');

  it('비밀값 대신 keystores 폴더의 파일 경로를 넘기라고 안내한다', () => {
    expectPathBased(text);
    expect(text).toContain(`폴더를 만든다: ${dir}`);
    expect(text).toContain(`→ ${keystorePath}`);
    expect(text).toContain(`→ ${secretsPath}`);
    expect(text).toContain('"storePassword"');
    expect(text).toContain('대화에 붙여넣지 않는다');
  });

  it('고유한 접두사면 id 충돌 경고가 없다', () => {
    expect(text).toContain('shop-android-keystore');
    expect(text).not.toContain('⚠️');
  });

  it('흔한 접두사(app)면 id 충돌을 경고한다', () => {
    const generic = existingAppSigningPlanLines('com.example.app', 'app', 'x', dir).join('\n');
    expect(generic).toMatch(/⚠️ .*"app"/);
  });
});

describe('newAppSigningPlanLines', () => {
  const base = {
    packageName: 'com.example.shop',
    prefix: 'shop',
    appStatus: 'new' as const,
    playNote: '',
    jenkinsStatus: 'x',
    jenkinsConfigured: true,
    keystoreDir: dir,
  };

  it('keytool 이 없어도 비밀값을 대화로 받지 않는다', () => {
    expectPathBased(newAppSigningPlanLines({ ...base, keytoolOk: false }).join('\n'));
  });

  it('keytool 이 있으면 android_generate_keystore 가 만든 경로를 쓰라고 한다', () => {
    const text = newAppSigningPlanLines({ ...base, keytoolOk: true }).join('\n');
    expect(text).toContain('android_generate_keystore(app_name="shop")');
    expect(text).not.toMatch(/keystore_base64\s*=|\bsecret\s*=/);
  });
});
