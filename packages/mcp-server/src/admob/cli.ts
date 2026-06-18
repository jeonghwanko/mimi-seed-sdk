#!/usr/bin/env node
// mimi-seed-admob — AdMob sub-CLI (계정/앱/광고단위 조회 + v1beta 생성).
// 사용자 진입점은 `mimi-seed admob <subcommand>`.
// ⚠️ create-* 는 AdMob v1beta(Limited Access)라 계정 allowlist 미승인 시 403 → 콘솔 수동 폴백.
import { requireAuth } from '../helpers.js';
import * as admob from './tools.js';
import { runDomainCli, requireFlag, flag, CliUsageError } from '../lib/cli-args.js';

const HELP = `
  💰 mimi-seed-admob — AdMob attach

  사용법:
    mimi-seed admob accounts
        AdMob 계정 목록 (accountId 확인 — accounts/pub-XXXX)

    mimi-seed admob apps --account <id>
    mimi-seed admob ad-units --account <id>
        등록된 앱 / 광고 단위 목록

    mimi-seed admob create-app --account <id> --platform <ANDROID|IOS> --name <displayName>
                               [--store-id com.x.y | 123456789]
        앱 등록 (store-id 주면 스토어 링크). ⚠️ v1beta Limited Access — 403 가능

    mimi-seed admob create-ad-unit --account <id> --app <appId> --name <name>
                                   --format <BANNER|INTERSTITIAL|REWARDED|REWARDED_INTERSTITIAL|APP_OPEN|NATIVE>
        광고 단위 생성. ⚠️ v1beta Limited Access — 403 가능

  인증: npx -y @yoonion/mimi-seed-mcp mimi-seed-auth
`;

const AD_FORMATS = ['BANNER', 'INTERSTITIAL', 'REWARDED', 'REWARDED_INTERSTITIAL', 'APP_OPEN', 'NATIVE'];

runDomainCli({
  binName: 'mimi-seed-admob',
  argv: process.argv.slice(2),
  help: HELP,
  handlers: {
    accounts: async () => admob.listAccounts(await requireAuth()),
    apps: async (p) => admob.listApps(await requireAuth(), requireFlag(p, 'account')),
    'ad-units': async (p) => admob.listAdUnits(await requireAuth(), requireFlag(p, 'account')),
    'create-app': async (p) => {
      const platform = requireFlag(p, 'platform').toUpperCase();
      if (platform !== 'ANDROID' && platform !== 'IOS') {
        throw new CliUsageError('--platform 은 ANDROID | IOS 여야 합니다.');
      }
      return admob.createApp(
        await requireAuth(),
        requireFlag(p, 'account'),
        platform,
        requireFlag(p, 'name'),
        flag(p, 'store-id'),
      );
    },
    'create-ad-unit': async (p) => {
      const format = requireFlag(p, 'format').toUpperCase();
      if (!AD_FORMATS.includes(format)) {
        throw new CliUsageError(`--format 은 ${AD_FORMATS.join(' | ')} 중 하나여야 합니다.`);
      }
      return admob.createAdUnit(
        await requireAuth(),
        requireFlag(p, 'account'),
        requireFlag(p, 'app'),
        requireFlag(p, 'name'),
        format as admob.AdFormat,
      );
    },
  },
});
