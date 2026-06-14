#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { registerFirebaseTools } from './registers/firebase.js';
import { registerAdmobTools } from './registers/admob.js';
import { registerPlaystoreTools } from './registers/playstore.js';
import { registerIamTools } from './registers/iam.js';
import { registerAppstoreTools } from './registers/appstore.js';
import { registerChecksTools } from './registers/checks.js';
import { registerAiTools } from './registers/ai.js';
import { registerBigqueryTools } from './registers/bigquery.js';
import { registerAuthTools } from './registers/auth.js';
import { registerCiTools } from './registers/ci.js';
import { registerInstagramTools } from './registers/instagram.js';
import { registerFacebookTools } from './registers/facebook.js';
import { registerGoogleAdsTools } from './registers/googleads.js';
import { registerPrompts } from './prompts.js';
import { registerResources } from './resources.js';

// dist/index.js 기준 ../package.json — npm 패키지 루트의 버전을 단일 출처로 사용.
// 하드코딩하면 publish 때마다 serverInfo.version 이 드리프트하므로 런타임에 읽는다.
const { version } = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
) as { version: string };

const server = new McpServer({
  name: 'mimi-seed',
  version,
});

registerFirebaseTools(server);
registerAdmobTools(server);
registerPlaystoreTools(server);
registerIamTools(server);
registerAppstoreTools(server);
registerChecksTools(server);
registerAiTools(server);
registerBigqueryTools(server);
registerAuthTools(server);
registerCiTools(server);
registerInstagramTools(server);
registerFacebookTools(server);
registerGoogleAdsTools(server);
registerPrompts(server);
registerResources(server);

// `npx -y @yoonion/mimi-seed-mcp <subcommand>` 처리.
// npx는 스코프 패키지의 basename(`mimi-seed-mcp`)을 매치해 이 bin을 실행하므로,
// 추가 인자(`mimi-seed-auth` 등)는 여기 argv로 흘러들어온다. 이전엔 MCP 서버가
// stdin을 기다리며 영구 hang 됐다 — 이제 sub-CLI로 위임한다.
const SUBCOMMANDS: Record<string, () => Promise<unknown>> = {
  'mimi-seed-auth': () => import('./auth/cli.js'),
  'mimi-seed-playstore-auth': () => import('./auth/playstore-setup-cli.js'),
  'mimi-seed-appstore-auth': () => import('./appstore/setup-cli.js'),
  'mimi-seed-bigquery-auth': () => import('./auth/bigquery-setup-cli.js'),
};

async function main() {
  const sub = process.argv[2];
  if (sub && SUBCOMMANDS[sub]) {
    // argv에서 subcommand 토큰 제거 후 sub-CLI 모듈 import — 모듈 top-level이 main() 실행
    process.argv.splice(2, 1);
    await SUBCOMMANDS[sub]();
    return;
  }
  if (sub && !sub.startsWith('-')) {
    console.error(
      [
        `❌ Unknown subcommand: ${sub}`,
        '',
        'Available:',
        ...Object.keys(SUBCOMMANDS).map((k) => `  npx -y @yoonion/mimi-seed-mcp ${k}`),
        '',
        'Or run the MCP server (no args):',
        '  npx -y @yoonion/mimi-seed-mcp',
      ].join('\n'),
    );
    process.exit(2);
  }

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error('MCP server error:', err);
  process.exit(1);
});
