import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import {
  CREDENTIALS,
  credById,
  detectAll,
  isSatisfied,
  missingRequired,
  planSetup,
} from '../credentials.js';

// 픽스처 홈 — detect 는 순수 fs 검사라 임시 디렉토리로 완전히 통제된다.
let home: string;

function writeCred(name: string, content: unknown): void {
  const dir = path.join(home, '.mimi-seed');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, name), JSON.stringify(content));
}

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'mimi-cred-'));
  // stubEnv 는 afterEach 의 unstubAllEnvs 로 복원된다 — delete 하면 개발자의 실제 환경변수와
  // 같은 워커를 쓰는 다른 테스트 파일까지 오염시킨다.
  vi.stubEnv('ANTHROPIC_API_KEY', '');
  vi.stubEnv('MIMI_SEED_TOKEN', '');
});

afterEach(() => {
  fs.rmSync(home, { recursive: true, force: true });
  vi.unstubAllEnvs();
});

describe('detectAll', () => {
  it('빈 홈에서는 아무것도 감지하지 않는다', () => {
    const d = detectAll(home);
    expect([...d.values()].every((v) => !v.present)).toBe(true);
  });

  it('파일이 있으면 감지하고 detail 을 채운다', () => {
    writeCred('tokens.json', { access_token: 'x' });
    writeCred('appstore.json', { keyId: 'ABC123' });
    writeCred('jenkins.json', { url: 'http://j', username: 'u', token: 't' });
    writeCred('google-ads.json', { developerToken: 'd', customerId: '1234567890' });

    const d = detectAll(home);
    expect(d.get('oauth')!.present).toBe(true);
    expect(d.get('appstore')).toEqual({ present: true, detail: 'keyId ABC123' });
    expect(d.get('jenkins')).toEqual({ present: true, detail: 'http://j' });
    expect(d.get('googleads')).toEqual({ present: true, detail: '1234567890' });
  });

  // Play SA 는 기본 파일과 패키지별 디렉토리 양쪽을 봐야 한다 — 한쪽만 보면 오진한다.
  it('Play SA: 기본 파일로 감지', () => {
    writeCred('play-service-account.json', { client_email: 'sa@x' });
    expect(detectAll(home).get('playstore')!.present).toBe(true);
  });

  it('Play SA: 패키지별 디렉토리로도 감지', () => {
    const dir = path.join(home, '.mimi-seed', 'play-service-accounts');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'com.example.app.json'), '{}');
    expect(detectAll(home).get('playstore')!.present).toBe(true);
  });

  it('CI: ci.json 의 provider 로 github / gitlab 을 구분한다', () => {
    writeCred('ci.json', { provider: 'gitlab', owner: 'grp', repo: 'app', token: 't' });
    const d = detectAll(home);
    expect(d.get('gitlab')).toEqual({ present: true, detail: 'grp/app' });
    expect(d.get('github')!.present).toBe(false);
  });

  it('anthropic 은 환경변수에서 읽는다', () => {
    expect(detectAll(home).get('anthropic')!.present).toBe(false);
    process.env.ANTHROPIC_API_KEY = 'sk-ant-x';
    expect(detectAll(home).get('anthropic')!.present).toBe(true);
  });

  it('MIMI_SEED_TOKEN 이 있으면 config.json 없이도 mimiseed 는 연결로 본다 (CI 모드)', () => {
    process.env.MIMI_SEED_TOKEN = 'tok';
    expect(detectAll(home).get('mimiseed')!.present).toBe(true);
  });

  it('Meta 토큰의 만료/임박 상태를 expiresAt 으로 감지한다', () => {
    writeCred('facebook.json', {
      pageAccessToken: 'EAA_TEST',
      pageId: 'page-1',
      pageName: 'Page',
      expiresAt: new Date(Date.now() - 60_000).toISOString(),
    });
    writeCred('instagram.json', {
      accessToken: 'IGAA_TEST',
      userId: 'ig-1',
      username: 'ig-user',
      expiresAt: new Date(Date.now() + 3 * 86_400_000).toISOString(),
    });
    writeCred('threads.json', {
      accessToken: 'TH_TEST',
      userId: 'th-1',
      username: 'th-user',
      expiresAt: new Date(Date.now() + 30 * 86_400_000).toISOString(),
    });

    const d = detectAll(home);
    expect(d.get('facebook')).toMatchObject({ present: true, freshness: 'expired', daysRemaining: 0 });
    expect(d.get('instagram')).toMatchObject({ present: true, freshness: 'expiring', daysRemaining: 3 });
    expect(d.get('threads')).toMatchObject({ present: true, freshness: 'fresh', daysRemaining: 30 });
  });
});

describe('isSatisfied — fallback', () => {
  it('Play SA 가 없어도 OAuth 가 있으면 동작하는 것으로 본다', () => {
    writeCred('tokens.json', { access_token: 'x' });
    const d = detectAll(home);
    expect(d.get('playstore')!.present).toBe(false);
    expect(isSatisfied(credById('playstore'), d)).toBe(true); // OAuth 폴백
    expect(isSatisfied(credById('bigquery'), d)).toBe(true);
  });

  it('OAuth 도 없으면 폴백이 성립하지 않는다', () => {
    const d = detectAll(home);
    expect(isSatisfied(credById('playstore'), d)).toBe(false);
  });
});

describe('missingRequired', () => {
  it('Play SA 는 필수가 아니다 (OAuth 로 대부분의 Play 작업이 된다)', () => {
    // 이 단언이 깨지면 doctor 와 mimi_seed_status 가 다시 갈라진 것이다.
    expect(credById('playstore').requirement).toBe('optional');

    process.env.MIMI_SEED_TOKEN = 'tok';
    writeCred('tokens.json', { access_token: 'x' });
    const missing = missingRequired(detectAll(home), ['android']);
    expect(missing.map((s) => s.id)).toEqual([]);
  });

  it('iOS 프로젝트에서는 App Store Connect 가 필수다', () => {
    process.env.MIMI_SEED_TOKEN = 'tok';
    writeCred('tokens.json', { access_token: 'x' });
    const missing = missingRequired(detectAll(home), ['ios']);
    expect(missing.map((s) => s.id)).toEqual(['appstore']);
  });

  it('Android 전용 프로젝트에서는 App Store Connect 를 요구하지 않는다', () => {
    process.env.MIMI_SEED_TOKEN = 'tok';
    writeCred('tokens.json', { access_token: 'x' });
    expect(missingRequired(detectAll(home), ['android'])).toEqual([]);
  });

  it('OAuth 와 클라우드 계정은 항상 필수다', () => {
    const missing = missingRequired(detectAll(home), []);
    expect(missing.map((s) => s.id).sort()).toEqual(['mimiseed', 'oauth']);
  });
});

describe('planSetup', () => {
  it('이미 연결된 항목은 제외한다 (멱등 — 재실행하면 남은 것만 묻는다)', () => {
    writeCred('tokens.json', { access_token: 'x' });
    const plan = planSetup(detectAll(home));
    expect(plan.map((s) => s.id)).not.toContain('oauth');
  });

  it('--reconnect 는 이미 연결돼 있어도 다시 포함한다', () => {
    writeCred('tokens.json', { access_token: 'x' });
    const plan = planSetup(detectAll(home), { reconnect: ['oauth'] });
    expect(plan.map((s) => s.id)).toContain('oauth');
  });

  it('만료됐거나 7일 안에 만료되는 Meta 토큰은 자동으로 다시 포함한다', () => {
    writeCred('facebook.json', {
      pageAccessToken: 'EAA_TEST',
      pageId: 'page-1',
      expiresAt: new Date(Date.now() - 60_000).toISOString(),
    });
    writeCred('instagram.json', {
      accessToken: 'IGAA_TEST',
      userId: 'ig-1',
      expiresAt: new Date(Date.now() + 2 * 86_400_000).toISOString(),
    });
    writeCred('threads.json', {
      accessToken: 'TH_TEST',
      userId: 'th-1',
      expiresAt: new Date(Date.now() + 30 * 86_400_000).toISOString(),
    });

    const ids = planSetup(detectAll(home)).map((s) => s.id);
    expect(ids).toContain('facebook');
    expect(ids).toContain('instagram');
    expect(ids).not.toContain('threads');
  });

  it('--only 는 지정한 것만 남긴다', () => {
    const plan = planSetup(detectAll(home), { only: ['jenkins', 'facebook'] });
    expect(plan.map((s) => s.id)).toEqual(['jenkins', 'facebook']);
  });

  it('core → ci → marketing 순, 그 안에서 필수 먼저', () => {
    const groups = planSetup(detectAll(home)).map((s) => s.group);
    const order = { core: 0, ci: 1, marketing: 2 };
    for (let i = 1; i < groups.length; i++) {
      expect(order[groups[i]]).toBeGreaterThanOrEqual(order[groups[i - 1]]);
    }
    const core = planSetup(detectAll(home)).filter((s) => s.group === 'core');
    expect(core[0].requirement).not.toBe('optional'); // 필수가 앞에
  });

  it('플랫폼이 안 맞으면 platform 전용 항목은 묻지 않는다', () => {
    const plan = planSetup(detectAll(home), { platforms: ['android'] });
    expect(plan.map((s) => s.id)).not.toContain('appstore');
  });
});

describe('레지스트리 불변식', () => {
  it('id 가 유일하다', () => {
    const ids = CREDENTIALS.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('모든 항목에 obtain(발급 안내)과 fix(복구 명령)가 있다 — obtain 은 ko/en 양쪽', () => {
    for (const spec of CREDENTIALS) {
      expect(spec.obtain.ko.length, `${spec.id}: obtain.ko 비어 있음`).toBeGreaterThan(0);
      expect(spec.obtain.en.length, `${spec.id}: obtain.en 비어 있음`).toBeGreaterThan(0);
      expect(spec.fix, `${spec.id}: fix 비어 있음`).toBeTruthy();
    }
  });

  // 지역화 누락은 타입으로는 못 잡는다 (빈 문자열도 string 이다) — 값으로 막는다.
  it('모든 항목에 label 이 ko/en 양쪽 다 있다', () => {
    for (const spec of CREDENTIALS) {
      expect(spec.label.ko, `${spec.id}: label.ko 비어 있음`).toBeTruthy();
      expect(spec.label.en, `${spec.id}: label.en 비어 있음`).toBeTruthy();
    }
  });

  // 이 테스트가 두 패키지 사이의 계약이다: 마법사가 부르는 bin 이 실제로 발행돼 있어야 한다.
  it('모든 mcp-bin 이 mcp-server 의 package.json bin 에 실재한다', () => {
    const pkg = JSON.parse(
      readFileSync(new URL('../../../mcp-server/package.json', import.meta.url), 'utf8'),
    ) as { bin: Record<string, string> };
    const published = new Set(Object.keys(pkg.bin));

    const used = CREDENTIALS.filter((c) => c.setup.kind === 'mcp-bin').map(
      (c) => (c.setup as { bin: string }).bin,
    );
    expect(used.length).toBeGreaterThan(0);
    const orphan = used.filter((b) => !published.has(b));
    expect(orphan, `mcp-server 에 없는 bin: ${orphan.join(', ')}`).toEqual([]);
  });
});
