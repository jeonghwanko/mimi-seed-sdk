import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerFirebaseTools } from './registers/firebase.js';
import { registerAdmobTools } from './registers/admob.js';
import { registerPlaystoreTools } from './registers/playstore.js';
import { registerIamTools } from './registers/iam.js';
import { registerBillingTools } from './registers/billing.js';
import { registerAppstoreTools } from './registers/appstore.js';
import { registerChecksTools } from './registers/checks.js';
import { registerAiTools } from './registers/ai.js';
import { registerBigqueryTools } from './registers/bigquery.js';
import { registerAuthTools } from './registers/auth.js';
import { registerCiTools } from './registers/ci.js';
import { registerInstagramTools } from './registers/instagram.js';
import { registerThreadsTools } from './registers/threads.js';
import { registerFacebookTools } from './registers/facebook.js';
import { registerGoogleAdsTools } from './registers/googleads.js';
import { registerGscTools } from './registers/gsc.js';
import { registerGa4Tools } from './registers/ga4.js';
import { registerJenkinsTools } from './registers/jenkins.js';
import { registerAndroidTools } from './registers/android.js';
import { registerVideoTools } from './registers/video.js';
import { registerYouTubeTools } from './registers/youtube.js';
import { registerTikTokBusinessTools } from './registers/tiktok.js';
import { registerPrompts } from './prompts.js';
import { registerResources } from './resources.js';
import { readToolManifest } from './lib/package-root.js';
import { resolveToolsets } from './lib/toolsets.js';
import { createToolRegistrar } from './lib/tool-registrar.js';

/**
 * 서버 조립 단일 지점 — stdio 엔트리(index.ts)와 tool-manifest 스모크 테스트
 * (src/__tests__/tool-manifest.test.ts)가 공유한다. 새 register 모듈은 반드시
 * 여기(index.ts 가 아니라)에 추가해야 테스트가 tool-manifest.json 과의 드리프트를 잡는다.
 */
export function buildServer(version: string, options: { env?: NodeJS.ProcessEnv } = {}): McpServer {
  // serverInfo.name 은 'mimi-seed-local' — 웹 콘솔의 Remote HTTP MCP(mimi-seed-web)와
  // 핸드셰이크 수준에서 구분한다. 클라이언트 표시명/도구 네임스페이스(mcp__mimi-seed__*)는
  // 등록 키(.mcp.json / claude mcp add 의 이름)에서 오므로 이 값 변경은 호환성에 영향 없음.
  const server = new McpServer({
    name: 'mimi-seed-local',
    version,
  });

  // 도구는 McpServer 에 직접이 아니라 레지스트라를 거쳐 등록한다 — manifest(SSOT)에서
  // annotations · confirm 가드 · toolset 필터 · 폐기 별칭을 붙인다 (lib/tool-registrar.ts).
  // prompts / resources 는 McpServer 를 그대로 쓴다.
  const manifest = readToolManifest();
  const toolsets = resolveToolsets(options.env ?? process.env, manifest);
  for (const warning of toolsets.warnings) console.error(`[mimi-seed] ${warning}`);
  const registrar = createToolRegistrar(server, { manifest, toolsets });

  registerFirebaseTools(registrar);
  registerAdmobTools(registrar);
  registerPlaystoreTools(registrar);
  registerIamTools(registrar);
  registerBillingTools(registrar);
  registerAppstoreTools(registrar);
  registerChecksTools(registrar);
  registerAiTools(registrar);
  registerBigqueryTools(registrar);
  registerAuthTools(registrar);
  registerCiTools(registrar);
  registerInstagramTools(registrar);
  registerThreadsTools(registrar);
  registerFacebookTools(registrar);
  registerGoogleAdsTools(registrar);
  registerGscTools(registrar);
  registerGa4Tools(registrar);
  registerJenkinsTools(registrar);
  registerAndroidTools(registrar);
  registerVideoTools(registrar);
  registerYouTubeTools(registrar);
  registerTikTokBusinessTools(registrar);
  registerPrompts(server);
  registerResources(server);

  return server;
}
