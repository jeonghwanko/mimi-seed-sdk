import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import * as firebase from '../firebase/tools.js';
import { requireAuth } from '../helpers.js';

export function registerFirebaseTools(server: McpServer) {
  server.tool(
    'firebase_list_projects',
    '내 Firebase 프로젝트 목록 조회',
    {},
    async () => {
      const auth = requireAuth();
      const projects = await firebase.listProjects(auth);
      return { content: [{ type: 'text', text: JSON.stringify(projects, null, 2) }] };
    },
  );

  server.tool(
    'firebase_get_project',
    'Firebase 프로젝트 상세 정보 조회',
    { projectId: z.string().describe('Firebase 프로젝트 ID') },
    async ({ projectId }) => {
      const auth = requireAuth();
      const project = await firebase.getProject(auth, projectId);
      return { content: [{ type: 'text', text: JSON.stringify(project, null, 2) }] };
    },
  );

  server.tool(
    'firebase_list_android_apps',
    'Firebase 프로젝트의 Android 앱 목록',
    { projectId: z.string().describe('Firebase 프로젝트 ID') },
    async ({ projectId }) => {
      const auth = requireAuth();
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
      const auth = requireAuth();
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
      const auth = requireAuth();
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
      const auth = requireAuth();
      const result = await firebase.deleteAndroidApp(auth, projectId, appId);
      return { content: [{ type: 'text', text: `삭제 완료: ${JSON.stringify(result)}` }] };
    },
  );

  server.tool(
    'firebase_list_ios_apps',
    'Firebase 프로젝트의 iOS 앱 목록',
    { projectId: z.string().describe('Firebase 프로젝트 ID') },
    async ({ projectId }) => {
      const auth = requireAuth();
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
      const auth = requireAuth();
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
      const auth = requireAuth();
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
      const auth = requireAuth();
      const result = await firebase.deleteIosApp(auth, projectId, appId);
      return { content: [{ type: 'text', text: `삭제 완료: ${JSON.stringify(result)}` }] };
    },
  );

  server.tool(
    'firebase_list_web_apps',
    'Firebase 프로젝트의 Web 앱 목록',
    { projectId: z.string().describe('Firebase 프로젝트 ID') },
    async ({ projectId }) => {
      const auth = requireAuth();
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
      const auth = requireAuth();
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
      const auth = requireAuth();
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
      const auth = requireAuth();
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
      const auth = requireAuth();
      const result = await firebase.enableService(auth, projectId, serviceId);
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    },
  );

  server.tool(
    'firebase_enable_common_services',
    'Firebase 기본 서비스 일괄 활성화 (Firestore, Auth, Storage, FCM 등)',
    { projectId: z.string().describe('프로젝트 ID') },
    async ({ projectId }) => {
      const auth = requireAuth();
      const results = await firebase.enableCommonServices(auth, projectId);
      return { content: [{ type: 'text', text: JSON.stringify(results, null, 2) }] };
    },
  );

  server.tool(
    'firebase_list_enabled_services',
    '프로젝트에서 활성화된 GCP 서비스 목록',
    { projectId: z.string().describe('프로젝트 ID') },
    async ({ projectId }) => {
      const auth = requireAuth();
      const services = await firebase.listEnabledServices(auth, projectId);
      return { content: [{ type: 'text', text: JSON.stringify(services, null, 2) }] };
    },
  );
}
