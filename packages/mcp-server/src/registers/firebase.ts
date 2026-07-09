import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import * as firebaseRaw from '../firebase/tools.js';
import { requireAuth } from '../helpers.js';
import { friendlyGoogleError } from '../lib/google-errors.js';

// 모든 firebase tools 호출을 친절 에러로 감싸는 프록시 — 17개 핸들러에 개별
// try/catch 없이 raw GaxiosError(API 미활성화/프로젝트 없음/billing/권한)를
// "다음에 뭘 할지" 메시지로 변환. 비-Promise 반환은 그대로 통과.
const firebase: typeof firebaseRaw = new Proxy(firebaseRaw, {
  get(target, prop, receiver) {
    const orig = Reflect.get(target, prop, receiver);
    if (typeof orig !== 'function') return orig;
    return (...args: unknown[]) => {
      try {
        const out = (orig as (...a: unknown[]) => unknown)(...args);
        if (out && typeof (out as { then?: unknown }).then === 'function') {
          return (out as Promise<unknown>).catch((err) => {
            throw friendlyGoogleError(err);
          });
        }
        return out;
      } catch (err) {
        throw friendlyGoogleError(err);
      }
    };
  },
});

export function registerFirebaseTools(server: McpServer) {
  server.tool(
    'firebase_list_projects',
    '내 Firebase 프로젝트 목록 조회',
    {},
    async () => {
      const auth = await requireAuth();
      const projects = await firebase.listProjects(auth);
      return { content: [{ type: 'text', text: JSON.stringify(projects, null, 2) }] };
    },
  );

  server.tool(
    'firebase_get_project',
    'Firebase 프로젝트 상세 정보 조회',
    { projectId: z.string().describe('Firebase 프로젝트 ID') },
    async ({ projectId }) => {
      const auth = await requireAuth();
      const project = await firebase.getProject(auth, projectId);
      return { content: [{ type: 'text', text: JSON.stringify(project, null, 2) }] };
    },
  );

  server.tool(
    'firebase_create_project',
    [
      '새 GCP 프로젝트를 만들고 Firebase를 추가한다 (앱 하나당 전용 Firebase 프로젝트 컨벤션 — 기존 프로젝트에',
      '앱만 추가하려면 firebase_create_android_app/firebase_create_ios_app 사용).',
      '두 개의 long-running operation(프로젝트 생성 → Firebase 추가)을 순서대로 완료까지 폴링하므로 최악의 경우 2분 정도 걸릴 수 있다.',
      'projectId는 6-30자, 소문자로 시작, 소문자/숫자/하이픈만 가능(끝에 하이픈 금지).',
    ].join(' '),
    {
      projectId: z
        .string()
        .regex(/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/, '소문자로 시작, 소문자/숫자/하이픈 6-30자 (끝에 하이픈 불가)')
        .describe('새로 만들 GCP/Firebase 프로젝트 ID (예: pryzm-penguinrun)'),
      displayName: z.string().describe('프로젝트 표시 이름'),
      parent: z
        .string()
        .optional()
        .describe("조직/폴더 소속이 필요한 계정일 때만: 'organizations/<id>' 또는 'folders/<id>'. 생략 시 계정 기본 정책대로 생성"),
    },
    async ({ projectId, displayName, parent }) => {
      const auth = await requireAuth();
      const project = await firebase.createProject(auth, projectId, displayName, { parent });
      return {
        content: [
          {
            type: 'text',
            text: [
              `✓ Firebase 프로젝트 생성 완료: \`${project.projectId}\``,
              '',
              `**displayName**: ${project.displayName}`,
              `**projectNumber**: ${project.projectNumber}`,
              '',
              '다음 단계:',
              `1. firebase_create_android_app("${project.projectId}", packageName, displayName)`,
              `2. firebase_create_ios_app("${project.projectId}", bundleId, displayName)`,
              '3. firebase_get_android_config / firebase_get_ios_config 로 설정 파일 다운로드',
            ].join('\n'),
          },
        ],
      };
    },
  );

  server.tool(
    'firebase_list_android_apps',
    'Firebase 프로젝트의 Android 앱 목록',
    { projectId: z.string().describe('Firebase 프로젝트 ID') },
    async ({ projectId }) => {
      const auth = await requireAuth();
      const apps = await firebase.listAndroidApps(auth, projectId);
      return { content: [{ type: 'text', text: JSON.stringify(apps, null, 2) }] };
    },
  );

  server.tool(
    'firebase_create_android_app',
    'Firebase에 새 Android 앱 등록',
    {
      projectId: z.string().describe('Firebase 프로젝트 ID'),
      packageName: z.string().describe('Android 패키지명 (예: com.example.myapp)'),
      displayName: z.string().describe('앱 표시 이름'),
    },
    async ({ projectId, packageName, displayName }) => {
      const auth = await requireAuth();
      const result = await firebase.createAndroidApp(auth, projectId, packageName, displayName);
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    },
  );

  server.tool(
    'firebase_get_android_config',
    'google-services.json 다운로드',
    {
      projectId: z.string().describe('Firebase 프로젝트 ID'),
      appId: z.string().describe('Firebase 앱 ID'),
    },
    async ({ projectId, appId }) => {
      const auth = await requireAuth();
      const config = await firebase.getAndroidConfig(auth, projectId, appId);
      return { content: [{ type: 'text', text: JSON.stringify(config, null, 2) }] };
    },
  );

  server.tool(
    'firebase_delete_android_app',
    'Firebase Android 앱 삭제',
    {
      projectId: z.string().describe('Firebase 프로젝트 ID'),
      appId: z.string().describe('삭제할 Firebase 앱 ID'),
    },
    async ({ projectId, appId }) => {
      const auth = await requireAuth();
      const result = await firebase.deleteAndroidApp(auth, projectId, appId);
      return { content: [{ type: 'text', text: `삭제 완료: ${JSON.stringify(result)}` }] };
    },
  );

  server.tool(
    'firebase_list_ios_apps',
    'Firebase 프로젝트의 iOS 앱 목록',
    { projectId: z.string().describe('Firebase 프로젝트 ID') },
    async ({ projectId }) => {
      const auth = await requireAuth();
      const apps = await firebase.listIosApps(auth, projectId);
      return { content: [{ type: 'text', text: JSON.stringify(apps, null, 2) }] };
    },
  );

  server.tool(
    'firebase_create_ios_app',
    'Firebase에 새 iOS 앱 등록',
    {
      projectId: z.string().describe('Firebase 프로젝트 ID'),
      bundleId: z.string().describe('iOS Bundle ID (예: com.example.myapp)'),
      displayName: z.string().describe('앱 표시 이름'),
    },
    async ({ projectId, bundleId, displayName }) => {
      const auth = await requireAuth();
      const result = await firebase.createIosApp(auth, projectId, bundleId, displayName);
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    },
  );

  server.tool(
    'firebase_get_ios_config',
    'GoogleService-Info.plist 다운로드',
    {
      projectId: z.string().describe('Firebase 프로젝트 ID'),
      appId: z.string().describe('Firebase 앱 ID'),
    },
    async ({ projectId, appId }) => {
      const auth = await requireAuth();
      const config = await firebase.getIosConfig(auth, projectId, appId);
      return { content: [{ type: 'text', text: JSON.stringify(config, null, 2) }] };
    },
  );

  server.tool(
    'firebase_delete_ios_app',
    'Firebase iOS 앱 삭제',
    {
      projectId: z.string().describe('Firebase 프로젝트 ID'),
      appId: z.string().describe('삭제할 Firebase 앱 ID'),
    },
    async ({ projectId, appId }) => {
      const auth = await requireAuth();
      const result = await firebase.deleteIosApp(auth, projectId, appId);
      return { content: [{ type: 'text', text: `삭제 완료: ${JSON.stringify(result)}` }] };
    },
  );

  server.tool(
    'firebase_list_web_apps',
    'Firebase 프로젝트의 Web 앱 목록',
    { projectId: z.string().describe('Firebase 프로젝트 ID') },
    async ({ projectId }) => {
      const auth = await requireAuth();
      const apps = await firebase.listWebApps(auth, projectId);
      return { content: [{ type: 'text', text: JSON.stringify(apps, null, 2) }] };
    },
  );

  server.tool(
    'firebase_create_web_app',
    'Firebase에 새 Web 앱 등록',
    {
      projectId: z.string().describe('Firebase 프로젝트 ID'),
      displayName: z.string().describe('앱 표시 이름'),
    },
    async ({ projectId, displayName }) => {
      const auth = await requireAuth();
      const result = await firebase.createWebApp(auth, projectId, displayName);
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    },
  );

  server.tool(
    'firebase_get_web_config',
    'Firebase Web 설정 (firebaseConfig 객체) 조회',
    {
      projectId: z.string().describe('Firebase 프로젝트 ID'),
      appId: z.string().describe('Firebase 앱 ID'),
    },
    async ({ projectId, appId }) => {
      const auth = await requireAuth();
      const config = await firebase.getWebConfig(auth, projectId, appId);
      return { content: [{ type: 'text', text: JSON.stringify(config, null, 2) }] };
    },
  );

  server.tool(
    'firebase_delete_web_app',
    'Firebase Web 앱 삭제',
    {
      projectId: z.string().describe('Firebase 프로젝트 ID'),
      appId: z.string().describe('삭제할 Firebase 앱 ID'),
    },
    async ({ projectId, appId }) => {
      const auth = await requireAuth();
      const result = await firebase.deleteWebApp(auth, projectId, appId);
      return { content: [{ type: 'text', text: `삭제 완료: ${JSON.stringify(result)}` }] };
    },
  );

  server.tool(
    'firebase_enable_service',
    'GCP 서비스 활성화 (예: firestore.googleapis.com)',
    {
      projectId: z.string().describe('프로젝트 ID'),
      serviceId: z.string().describe('서비스 ID (예: firestore.googleapis.com)'),
    },
    async ({ projectId, serviceId }) => {
      const auth = await requireAuth();
      const result = await firebase.enableService(auth, projectId, serviceId);
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    },
  );

  server.tool(
    'firebase_enable_common_services',
    'Firebase 기본 서비스 일괄 활성화 (Firestore, Auth, Storage, FCM 등)',
    { projectId: z.string().describe('프로젝트 ID') },
    async ({ projectId }) => {
      const auth = await requireAuth();
      const results = await firebase.enableCommonServices(auth, projectId);
      return { content: [{ type: 'text', text: JSON.stringify(results, null, 2) }] };
    },
  );

  server.tool(
    'firebase_list_enabled_services',
    '프로젝트에서 활성화된 GCP 서비스 목록',
    { projectId: z.string().describe('프로젝트 ID') },
    async ({ projectId }) => {
      const auth = await requireAuth();
      const services = await firebase.listEnabledServices(auth, projectId);
      return { content: [{ type: 'text', text: JSON.stringify(services, null, 2) }] };
    },
  );

  server.tool(
    'firebase_link_analytics',
    'Firebase 프로젝트에 Google Analytics(GA4) 링크 → 앱별 measurement 자동 활성화. analyticsAccountId(그 계정에 GA4 property 신규 생성) 또는 analyticsPropertyId(기존 property 링크) 중 하나 필수. 먼저 firebase_enable_common_services 로 firebaseanalytics 활성화 권장. property 이름/web stream 까지 직접 제어하려면 ga4_create_property/ga4_create_data_stream 사용.',
    {
      projectId: z.string().describe('Firebase 프로젝트 ID'),
      analyticsAccountId: z.string().optional().describe('GA 계정 ID (신규 property 생성 위치) — 예: 123456'),
      analyticsPropertyId: z.string().optional().describe('기존 GA4 property ID 에 링크할 경우'),
    },
    async ({ projectId, analyticsAccountId, analyticsPropertyId }) => {
      const auth = await requireAuth();
      const result = await firebase.linkAnalytics(auth, projectId, { analyticsAccountId, analyticsPropertyId });
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    },
  );

  server.tool(
    'firebase_get_analytics_details',
    '프로젝트의 GA4 링크 상세 — 연결된 analyticsProperty + 앱↔data stream 매핑 조회.',
    { projectId: z.string().describe('Firebase 프로젝트 ID') },
    async ({ projectId }) => {
      const auth = await requireAuth();
      const details = await firebase.getAnalyticsDetails(auth, projectId);
      return { content: [{ type: 'text', text: JSON.stringify(details, null, 2) }] };
    },
  );
}
