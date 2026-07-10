import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
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
import { registerGscTools } from './registers/gsc.js';
import { registerGa4Tools } from './registers/ga4.js';
import { registerJenkinsTools } from './registers/jenkins.js';
import { registerAndroidTools } from './registers/android.js';
import { registerPrompts } from './prompts.js';
import { registerResources } from './resources.js';

/**
 * 서버 조립 단일 지점 — stdio 엔트리(index.ts)와 tool-manifest 스모크 테스트
 * (src/__tests__/tool-manifest.test.ts)가 공유한다. 새 register 모듈은 반드시
 * 여기(index.ts 가 아니라)에 추가해야 테스트가 tool-manifest.json 과의 드리프트를 잡는다.
 */
export function buildServer(version: string): McpServer {
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
  registerGscTools(server);
  registerGa4Tools(server);
  registerJenkinsTools(server);
  registerAndroidTools(server);
  registerPrompts(server);
  registerResources(server);

  return server;
}
