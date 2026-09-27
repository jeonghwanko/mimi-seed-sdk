import type { ToolRegistrar } from '../lib/tool-registrar.js';
import { z } from 'zod';
import {
  jenkinsUrlWarning, loadJenkinsConfig, requireJenkinsConfig, saveJenkinsConfig, type JenkinsConfig,
} from '../jenkins/config.js';
import * as creds from '../jenkins/credentials.js';
import * as jobs from '../jenkins/jobs.js';
import * as builds from '../jenkins/builds.js';
import { jsonResult, textResult } from '../lib/mcp-response.js';
import { SIGNING_SECRET_FIELDS, resolveKeystoreInput, resolveSecretInput } from '../android/keystore-store.js';
import {
  ambiguousDefaultIdNote, existingCredentialPreview, jenkinsConfiguredLines, jenkinsNotConfiguredLines,
} from '../jenkins/messages.js';

/** 기존 id 교체 dry-run — 무엇을 덮어쓰게 되는지(id·종류·설명)와 모호한 기본 id 경고를 싣는다. */
async function existingPreview(cfg: JenkinsConfig, id: string, requested: creds.CredentialKind) {
  const note = ambiguousDefaultIdNote(id);
  return textResult(existingCredentialPreview(id, await creds.inspectCredential(cfg, id), requested, note ? [note] : []));
}

export function registerJenkinsTools(server: ToolRegistrar) {
  // ── 0. 상태 확인 (항상 첫 번째로 호출) ─────────────────────────────────────
  server.tool(
    'jenkins_status',
    [
      '⭐ Jenkins 관련 작업을 시작하기 전에 반드시 이 도구를 먼저 호출하세요.',
      '현재 Jenkins 연결 설정(~/.mimi-seed/jenkins.json) 유무를 확인합니다.',
      '설정이 없으면 사용자에게 Jenkins URL / 사용자 ID / API Token을 물어본 뒤',
      'jenkins_save_config를 호출해 저장하세요.',
      'API Token 발급: Jenkins 대시보드 → [사용자 이름] → 설정 → API Token → "Add new Token".',
      '로컬 Jenkins 없이 회사·외부 서버도 URL만 맞으면 연결 가능합니다.',
    ].join(' '),
    {},
    async () => {
      const cfg = loadJenkinsConfig();
      if (!cfg) {
        return textResult(jenkinsNotConfiguredLines());
      }
      return textResult(jenkinsConfiguredLines(cfg));
    },
  );

  // ── 1. 설정 저장 ───────────────────────────────────────────────────────────
  server.tool(
    'jenkins_save_config',
    [
      'Jenkins 서버 연결 설정을 저장합니다 (~/.mimi-seed/jenkins.json, mode 0600).',
      '이 도구를 호출하기 전에 사용자에게 URL / username / token을 먼저 확인하세요.',
      '로컬 Jenkins가 없어도 회사·원격 서버의 URL을 그대로 사용할 수 있습니다.',
      'API Token 발급: Jenkins 대시보드 → [사용자 이름] → 설정 → API Token → "Add new Token".',
      '저장 후 jenkins_list_credentials 로 연결을 검증하세요.',
    ].join(' '),
    {
      url: z.string().url().describe('Jenkins 기본 URL (예: https://jenkins.company.com)'),
      username: z.string().describe('Jenkins 사용자 ID'),
      token: z.string().describe('Jenkins API Token'),
    },
    async ({ url, username, token }) => {
      saveJenkinsConfig({ url, username, token });
      const warning = jenkinsUrlWarning(url);
      return textResult([
        '✅ Jenkins 설정 저장 완료',
        `   URL:    ${url}`,
        `   사용자: ${username}`,
        ...(warning ? ['', warning] : []),
        '',
        '이제 jenkins_list_credentials 로 연결이 잘 됐는지 확인하세요.',
      ]);
    },
  );

  // ── 2. Credential 목록 ─────────────────────────────────────────────────────
  server.tool(
    'jenkins_list_credentials',
    [
      'Jenkins에 등록된 credential 목록을 조회합니다 (id / displayName / type).',
      '설정이 없으면 jenkins_status를 먼저 호출해 연결 정보를 확인하세요.',
    ].join(' '),
    {},
    async () => {
      const cfg = requireJenkinsConfig();
      const list = await creds.listCredentials(cfg);
      if (list.length === 0) {
        return textResult('등록된 Jenkins credential 없음.');
      }
      const lines = list.map((c) => `• ${c.id}  [${c.typeName}]  ${c.displayName}`);
      return textResult(`Jenkins credentials (${list.length}개):\n\n${lines.join('\n')}`);
    },
  );

  // ── 3. Secret Text ─────────────────────────────────────────────────────────
  server.tool(
    'jenkins_create_credential',
    [
      'Jenkins에 Secret Text credential을 생성하거나 업데이트합니다.',
      '비밀번호, API 키, 앱 시크릿 등 문자열 값에 사용하세요.',
      '새 id 는 바로 생성한다. 같은 id 가 이미 있으면 기존 값을 되돌릴 수 없게 덮어쓰므로',
      'confirm 생략/false 면 아무것도 바꾸지 않고 "이미 존재" dry-run 만 반환 — 사용자 승인 후 confirm: true 로 재호출.',
      '설정이 없으면 jenkins_status를 먼저 호출하세요.',
    ].join(' '),
    {
      id: z.string().describe('Credential ID (예: my-app-android-key-password)'),
      secret: z.string().optional().describe('저장할 비밀값. secret_file 과 둘 중 하나'),
      secret_file: z
        .string()
        .optional()
        .describe('권장 — android_generate_keystore 가 만든 signing.json 절대경로 (~/.mimi-seed/keystores/ 안만 허용). 비밀값이 대화에 남지 않음'),
      secret_field: z
        .enum(SIGNING_SECRET_FIELDS)
        .optional()
        .describe('secret_file 에서 꺼낼 필드 (storePassword / keyPassword / keyAlias)'),
      description: z.string().optional().describe('설명 (선택)'),
      confirm: z.boolean().optional().describe('같은 id 가 이미 있을 때만 필요. true 면 기존 값을 교체'),
    },
    async ({ id, secret, secret_file, secret_field, description, confirm }) => {
      const value = resolveSecretInput({ secret, secretFile: secret_file, secretField: secret_field });
      const cfg = requireJenkinsConfig();
      const result = await creds.upsertSecretText(cfg, id, value, description ?? '', { allowReplace: confirm === true });
      if (result === 'exists') return existingPreview(cfg, id, creds.KIND_STRING);
      return textResult(`✅ Jenkins credential ${result}: \`${id}\``);
    },
  );

  // ── 4. Secret File (keystore) ──────────────────────────────────────────────
  server.tool(
    'jenkins_upload_keystore',
    [
      'Jenkins에 Android keystore 파일을 Secret File credential로 업로드합니다.',
      'keystore_base64에 .jks/.p12 파일을 base64로 인코딩한 값을 전달하세요.',
      '새 id 는 바로 생성한다. 같은 id 가 이미 있으면 기존 keystore 를 되돌릴 수 없게 교체하므로',
      'confirm 생략/false 면 아무것도 바꾸지 않고 "이미 존재" dry-run 만 반환 — 사용자 승인 후 confirm: true 로 재호출.',
      '설정이 없으면 jenkins_status를 먼저 호출하세요.',
    ].join(' '),
    {
      id: z.string().describe('Credential ID (예: my-app-android-keystore)'),
      keystore_base64: z.string().optional().describe('keystore 파일 내용을 base64로 인코딩한 값. keystore_path 와 둘 중 하나'),
      keystore_path: z
        .string()
        .optional()
        .describe('권장 — android_generate_keystore 가 만든 keystore 절대경로 (~/.mimi-seed/keystores/ 안만 허용)'),
      file_name: z.string().default('keystore.jks').describe('파일명 (기본: keystore.jks)'),
      description: z.string().optional().describe('설명 (선택)'),
      confirm: z.boolean().optional().describe('같은 id 가 이미 있을 때만 필요. true 면 기존 keystore 를 교체'),
    },
    async ({ id, keystore_base64, keystore_path, file_name, description, confirm }) => {
      const keystore = resolveKeystoreInput({ base64: keystore_base64, path: keystore_path });
      const cfg = requireJenkinsConfig();
      const result = await creds.upsertSecretFile(cfg, id, keystore, file_name, description ?? '', {
        allowReplace: confirm === true,
      });
      if (result === 'exists') return existingPreview(cfg, id, creds.KIND_FILE);
      return textResult(`✅ Jenkins keystore credential ${result}: \`${id}\` (${file_name})`);
    },
  );

  // ── 5. 삭제 ───────────────────────────────────────────────────────────────
  server.tool(
    'jenkins_delete_credential',
    [
      'Jenkins credential을 삭제합니다. 비가역 작업입니다.',
      '설정이 없으면 jenkins_status를 먼저 호출하세요.',
    ].join(' '),
    {
      id: z.string().describe('삭제할 Credential ID'),
    },
    async ({ id }) => {
      const cfg = requireJenkinsConfig();
      await creds.deleteCredential(cfg, id);
      return textResult(`🗑 Jenkins credential 삭제 완료: \`${id}\``);
    },
  );

  // ── 6. 잡 목록 ─────────────────────────────────────────────────────────────
  server.tool(
    'jenkins_list_jobs',
    [
      'Jenkins 잡 목록을 조회합니다 (이름 / URL / 상태색).',
      'folder를 주면 그 폴더 안만 조회합니다. 재귀하지 않고 한 단계만 봅니다.',
      '설정이 없으면 jenkins_status를 먼저 호출하세요.',
    ].join(' '),
    {
      folder: z.string().optional().describe('폴더 경로 (예: team-folder). 생략하면 루트'),
    },
    async ({ folder }) => {
      const cfg = requireJenkinsConfig();
      const list = await jobs.listJobs(cfg, folder);
      if (list.length === 0) {
        return textResult('잡 없음.');
      }
      const lines = list.map((j) => `• ${j.name}${j.color ? `  [${j.color}]` : '  [folder]'}`);
      return textResult(`Jenkins jobs (${list.length}개):\n\n${lines.join('\n')}`);
    },
  );

  // ── 7. 잡 config.xml 조회 ──────────────────────────────────────────────────
  server.tool(
    'jenkins_get_job_config',
    [
      '잡의 config.xml 원문을 가져옵니다.',
      '잡을 수정하기 전에 현재 설정을 확인하거나 백업할 때 사용하세요.',
      '폴더 안의 잡은 "folder/job" 형태로 경로를 넘깁니다.',
    ].join(' '),
    {
      job: z.string().describe('잡 경로 (예: my-app, team-folder/my-app)'),
    },
    async ({ job }) => {
      const cfg = requireJenkinsConfig();
      const xml = await jobs.getJobConfig(cfg, job);
      return textResult(xml);
    },
  );

  // ── 8. 잡 생성 ─────────────────────────────────────────────────────────────
  server.tool(
    'jenkins_create_job',
    [
      'config.xml 로 새 Jenkins 잡을 생성합니다 (createItem).',
      '같은 이름의 잡이 이미 있으면 실패합니다. 덮어쓰려면 overwrite=true 를 주거나 jenkins_update_job 을 쓰세요.',
      '폴더 안에 만들려면 job 에 "folder/name" 을 넘깁니다 (폴더는 미리 존재해야 합니다).',
      'config_xml 은 Pipeline job 이면 flow-definition 루트 엘리먼트를 갖는 XML 전문입니다.',
    ].join(' '),
    {
      job: z.string().describe('잡 경로 (예: my-app, team-folder/my-app)'),
      config_xml: z.string().describe('잡 정의 config.xml 전문'),
      overwrite: z.boolean().default(false).describe('이미 존재하면 덮어쓸지 여부 (기본 false)'),
    },
    async ({ job, config_xml, overwrite }) => {
      const cfg = requireJenkinsConfig();
      if (overwrite) {
        const result = await jobs.upsertJob(cfg, job, config_xml);
        return textResult(`✅ Jenkins 잡 ${result}: \`${job}\``);
      }
      if (await jobs.jobExists(cfg, job)) {
        return textResult(`⚠️ 잡 \`${job}\` 이(가) 이미 존재합니다. jenkins_update_job 을 쓰거나 overwrite=true 로 다시 호출하세요.`);
      }
      await jobs.createJob(cfg, job, config_xml);
      return textResult(`✅ Jenkins 잡 created: \`${job}\``);
    },
  );

  // ── 9. 잡 수정 ─────────────────────────────────────────────────────────────
  server.tool(
    'jenkins_update_job',
    [
      '기존 Jenkins 잡의 config.xml 을 통째로 교체합니다.',
      '잡이 없으면 실패합니다 (생성은 jenkins_create_job).',
      '기존 설정이 사라지므로 jenkins_get_job_config 로 먼저 백업하는 것을 권장합니다.',
    ].join(' '),
    {
      job: z.string().describe('잡 경로 (예: my-app, team-folder/my-app)'),
      config_xml: z.string().describe('교체할 config.xml 전문'),
    },
    async ({ job, config_xml }) => {
      const cfg = requireJenkinsConfig();
      await jobs.updateJob(cfg, job, config_xml);
      return textResult(`✅ Jenkins 잡 updated: \`${job}\``);
    },
  );

  // ── 10. 빌드 실행 ──────────────────────────────────────────────────────────
  server.tool(
    'jenkins_trigger_build',
    [
      'Jenkins 잡 빌드를 실행합니다 (배포·출시 잡일 수 있음). 사용자가 승인한 잡/파라미터만 전달하세요.',
      'request_id 는 논리적 요청마다 새로 만들고, dry-run 으로 본 인자와 불확실한 응답의 재호출에는 반드시 같은 값을 쓰세요.',
      'dry-run(confirm 생략)은 request_id 를 예약하지도 기록하지도 않습니다 — confirm: true 호출이 처음 한 번만 POST 합니다.',
      '로컬 영속 기록(~/.mimi-seed/jenkins-build-requests/)으로 같은 request_id 의 중복 POST 를 막습니다 (다른 PC·기록 삭제까지는 보장하지 않음).',
      'state=unknown 이면 Jenkins 에서 접수 여부를 확인하고 새 request_id 로 재시도하지 마세요.',
      '반환된 queue_id 를 jenkins_get_queue_item 으로 추적하세요.',
      'parameters 생략은 /build, 빈 객체를 포함해 지정하면 /buildWithParameters 입니다. 자격증명 값은 파라미터에 넣지 마세요.',
    ].join(' '),
    {
      job: builds.buildJobSchema.describe('잡 경로 (예: my-app, team-folder/my-app)'),
      request_id: builds.requestIdSchema.describe('이 논리적 빌드 요청의 고유 ID (영숫자·_·-, 최대 128자). 재호출에는 같은 값'),
      parameters: builds.buildParametersSchema
        .optional()
        .describe('빌드 파라미터 (문자열 값). 생략하면 파라미터 없는 /build'),
    },
    async (args) => jsonResult(await builds.triggerBuild(requireJenkinsConfig(), args)),
  );

  // ── 11. 큐 항목 조회 ───────────────────────────────────────────────────────
  server.tool(
    'jenkins_get_queue_item',
    [
      '트리거 응답의 정확한 queue_id 로 대기 사유·취소·배정된 build_number 를 조회합니다.',
      'state=started 가 되면 원래 job 과 build_number 를 저장하고 jenkins_get_build_status 를 쓰세요.',
      'unavailable 은 만료/없음이며 재트리거하지 마세요. lastBuild 로 번호를 추정하지 않습니다.',
    ].join(' '),
    { queue_id: builds.buildIdSchema.describe('jenkins_trigger_build 가 반환한 Jenkins 큐 ID') },
    async ({ queue_id }) => jsonResult(await builds.getQueueItem(requireJenkinsConfig(), queue_id)),
  );

  // ── 12. 빌드 상태 조회 ─────────────────────────────────────────────────────
  server.tool(
    'jenkins_get_build_status',
    '큐에서 배정받은 정확한 job 과 build_number 의 building/result 를 조회합니다. 빌드를 새로 실행하지 않습니다.',
    {
      job: builds.buildJobSchema.describe('원래 빌드 잡 경로 (예: team-folder/my-app)'),
      build_number: builds.buildIdSchema.describe('jenkins_get_queue_item 이 반환한 빌드 번호'),
    },
    async ({ job, build_number }) => jsonResult(await builds.getBuildStatus(requireJenkinsConfig(), job, build_number)),
  );
}
