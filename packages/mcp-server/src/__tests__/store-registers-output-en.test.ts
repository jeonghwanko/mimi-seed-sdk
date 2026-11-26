import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { withClient } from './helpers.js';
import {
  dataSafetyDryRunLines,
  playConnectionSetupLines,
  recoveryActionsText,
  recoveryCreateDryRunLines,
  registeredServiceAccountsLines,
  serviceAccountRegisterAbortedLines,
  serviceAccountVerificationLines,
} from '../playstore/messages.js';
import { buildTargeting } from '../playstore/tools.js';
import { readDataSafetyCsv } from '../playstore/data-safety.js';
import { unzip } from '../playstore/financials.js';

// Batch C of the output i18n work: App Store / Play register handlers and the playstore/ domain modules.
// Each case drives a path that returns before any network call.
const HANGUL = /[가-힣]/;

beforeEach(() => vi.stubEnv('MIMI_SEED_LANG', 'en'));
afterEach(() => vi.unstubAllEnvs());

function textOf(result: unknown): string {
  return ((result as { content: Array<{ text?: string }> }).content).map((c) => c.text ?? '').join('\n');
}

describe('Play Store domain output in English', () => {
  it('service account verification troubleshooting', () => {
    const forbidden = serviceAccountVerificationLines(
      { ok: false, stage: 'api', httpStatus: 403, message: 'denied' } as unknown as Parameters<typeof serviceAccountVerificationLines>[0],
      'com.example.app',
    ).join('\n');
    expect(forbidden).not.toMatch(HANGUL);
    expect(forbidden).toContain('Users and permissions');
    expect(forbidden).toContain('**Wait ~5 minutes**');

    const parse = serviceAccountVerificationLines(
      { ok: false, stage: 'parse', message: 'bad' } as unknown as Parameters<typeof serviceAccountVerificationLines>[0],
      'com.example.app',
    ).join('\n');
    expect(parse).not.toMatch(HANGUL);
    expect(serviceAccountRegisterAbortedLines('auth', 'x').join('\n')).toContain('skipVerify=true');
  });

  it('setup, listing, data safety, and recovery summaries', () => {
    const texts = [
      playConnectionSetupLines('com.example.app', 'sa@example.iam.gserviceaccount.com').join('\n'),
      registeredServiceAccountsLines({ perPackage: [], default: null }).join('\n'),
      dataSafetyDryRunLines('com.example.app', 'a,b\n1,2').join('\n'),
      recoveryActionsText([{ id: '1', status: 'DRAFT', createTime: 't', targeting: {} }]),
      recoveryCreateDryRunLines('com.example.app', { allUsers: true }).join('\n'),
    ];
    for (const text of texts) expect(text).not.toMatch(HANGUL);
    expect(texts[0]).toContain('**Users and permissions → Invite new users**');
    expect(texts[2]).toContain('overwrites the entire existing data safety submission');
    expect(texts[4]).toContain('confirm: true');
  });

  it('input validation errors', () => {
    expect(() => buildTargeting({})).toThrow(/targeting is empty/);
    expect(() => buildTargeting({ allUsers: true, versionCodes: ['1'] })).toThrow(/cannot be combined/);
    expect(() => readDataSafetyCsv({})).toThrow(/Either csvPath or csv/);
    expect(() => unzip(Buffer.from('not a zip'))).toThrow(/Not a ZIP file/);
  });
});

describe('store register handlers in English', () => {
  const cases: Array<[string, Record<string, unknown>, string]> = [
    [
      'playstore_update_release_notes',
      { packageName: 'com.example.app', track: 'beta', versionCode: '5', language: 'en-US', text: 'x', syncTracks: ['alpha'] },
      'cannot be used together — no API call made',
    ],
    ['playstore_deploy_recovery_action', { packageName: 'com.example.app', appRecoveryId: '7' }, 'A remote update goes out to the targeted users'],
    ['playstore_cancel_recovery_action', { packageName: 'com.example.app', appRecoveryId: '7' }, 'are not reverted'],
    ['appstore_attach_build', { versionId: 'v1', buildId: 'b1', minBuildNumber: 3 }, 'no API call made'],
    ['appstore_update_whats_new', { versionId: 'v1', locale: 'en-US', whatsNew: '<b>x</b>' }, 'pre-validation failed'],
    ['appstore_notify_beta_testers', { buildId: 'b1' }, 'about to notify all testers'],
    ['appstore_set_territory_availability', { territories: [{ id: 't1', available: false }] }, 'available=false'],
    ['appstore_add_beta_testers', { groupId: 'g1', testers: [{ email: 'a@example.com' }] }, 'Invitation emails are sent immediately'],
    ['appstore_set_beta_group_build', { groupId: 'g1', buildId: 'b1', action: 'add' }, 'distributed to testers'],
    ['appstore_delete_preview', { previewId: 'p1' }, 'about to delete preview p1'],
    ['appstore_upload_screenshot', { localizationId: 'l1', placementGroup: 'x', displayType: 'APP_IPHONE_67', filePath: '/tmp/a.png' }, 'Specify only one of'],
  ];

  it('return English text without calling a store API', async () => {
    await withClient(async (client) => {
      for (const [name, args, phrase] of cases) {
        const text = textOf(await client.callTool({ name, arguments: args }));
        expect(text, name).not.toMatch(HANGUL);
        expect(text, name).toContain(phrase);
      }
    });
  });

  it('keep the Korean source text in Korean mode', async () => {
    vi.stubEnv('MIMI_SEED_LANG', 'ko');
    await withClient(async (client) => {
      const text = textOf(await client.callTool({
        name: 'playstore_deploy_recovery_action',
        arguments: { packageName: 'com.example.app', appRecoveryId: '7' },
      }));
      expect(text).toBe('🛑 dry-run — 복구 액션 7 를 배포할 참이다. 대상 사용자에게 원격 업데이트가 나간다. confirm: true 로 다시 호출.');
    });
  });
});
