import type { ToolRegistrar } from '../lib/tool-registrar.js';
import { z } from 'zod';
import { requireCiConfig, saveCiConfig } from '../ci/config.js';
import * as github from '../ci/github.js';
import * as gitlab from '../ci/gitlab.js';
import { textResult } from '../lib/mcp-response.js';
import { catalog } from '#core/lang.js';

const M = catalog(
  {
    saved: (provider: string) => `✅ CI 설정 저장 완료 (${provider})`,
    repo: (r: string) => `   저장소: ${r}`,
    savedNext: 'ci_list_workflows 로 사용 가능한 워크플로를 확인하세요.',
    needWorkflow: 'GitHub 빌드 트리거에는 workflow 파라미터가 필요합니다. (예: "deploy.yml")',
    triggeredNoRun: '✅ 빌드 트리거 완료. run_id 조회 불가 — 잠시 후 ci_list_recent_builds로 확인하세요.',
    triggered: '✅ 빌드 트리거 완료',
    status: (v: string) => `   상태: ${v}`,
    branch: (v: string) => `   브랜치: ${v}`,
    commit: (v: string) => `   커밋: ${v}`,
    workflow: (v: string) => `   워크플로: ${v}`,
    created: (v: string) => `   생성: ${v}`,
    updated: (v: string) => `   갱신: ${v}`,
    checkProgress: (id: string | number) => `ci_get_build_status(run_id="${id}") 로 진행 상황을 확인하세요.`,
    buildHead: (emoji: string, id: string | number, status: string) => `${emoji} 빌드 #${id} — ${status}`,
    noBuilds: '최근 빌드 없음.',
    recent: (n: number, body: string) => `최근 빌드 ${n}개:\n\n${body}`,
    locale: 'ko-KR',
    cancelled: (id: string) => `⛔ 빌드 #${id} 취소 요청 완료.\nci_get_build_status(run_id="${id}") 로 상태를 확인하세요.`,
  },
  {
    saved: (provider: string) => `✅ CI configuration saved (${provider})`,
    repo: (r: string) => `   Repository: ${r}`,
    savedNext: 'Check the available workflows with ci_list_workflows.',
    needWorkflow: 'Triggering a GitHub build requires the workflow parameter. (e.g. "deploy.yml")',
    triggeredNoRun: '✅ Build triggered. Could not get the run_id — check with ci_list_recent_builds shortly.',
    triggered: '✅ Build triggered',
    status: (v: string) => `   Status: ${v}`,
    branch: (v: string) => `   Branch: ${v}`,
    commit: (v: string) => `   Commit: ${v}`,
    workflow: (v: string) => `   Workflow: ${v}`,
    created: (v: string) => `   Created: ${v}`,
    updated: (v: string) => `   Updated: ${v}`,
    checkProgress: (id: string | number) => `Check progress with ci_get_build_status(run_id="${id}").`,
    buildHead: (emoji: string, id: string | number, status: string) => `${emoji} Build #${id} — ${status}`,
    noBuilds: 'No recent builds.',
    recent: (n: number, body: string) => `Recent builds (${n}):\n\n${body}`,
    locale: 'en-US',
    cancelled: (id: string) => `⛔ Cancel requested for build #${id}.\nCheck its status with ci_get_build_status(run_id="${id}").`,
  },
);

export function registerCiTools(server: ToolRegistrar) {
  server.tool(
    'ci_save_config',
    [
      'GitHub Actions 또는 GitLab CI 연결 설정을 저장합니다.',
      '저장 위치: ~/.mimi-seed/ci.json (mode 0600).',
      'GitHub: provider="github", token=<GitHub token> (repo+workflow 스코프 필요)',
      'GitHub Enterprise: host="https://github.example.com" 추가',
      'GitLab.com: provider="gitlab", token=<GitLab token>',
      'Self-hosted GitLab: host="https://gitlab.example.com" 추가',
    ].join(' '),
    {
      provider: z.enum(['github', 'gitlab']).describe('CI 프로바이더'),
      token: z.string().describe('Personal Access Token'),
      owner: z.string().describe('GitHub org/user 또는 GitLab namespace'),
      repo: z.string().describe('저장소 이름 (경로 없이 repo명만)'),
      host: z.string().optional().describe('GitHub Enterprise 또는 GitLab self-hosted URL'),
    },
    async ({ provider, token, owner, repo, host }) => {
      const config = { provider, token, owner, repo, host };
      saveCiConfig(config);
      return textResult([
        M().saved(provider),
        M().repo(`${owner}/${repo}`),
        host ? `   Host: ${host}` : '',
        '',
        M().savedNext,
      ].filter(Boolean));
    },
  );

  server.tool(
    'ci_list_workflows',
    [
      'GitHub Actions 워크플로 목록 또는 GitLab 파이프라인 스케줄/트리거 목록을 조회합니다.',
      'ci_trigger_build의 workflow 파라미터에 파일명(deploy.yml)을 사용하세요.',
    ].join(' '),
    {},
    async () => {
      const cfg = requireCiConfig();
      const result = cfg.provider === 'github'
        ? await github.listWorkflows(cfg)
        : await gitlab.listWorkflows(cfg);
      return textResult(JSON.stringify(result, null, 2));
    },
  );

  server.tool(
    'ci_trigger_build',
    [
      '빌드를 트리거합니다.',
      'GitHub: workflow 필수 (파일명 "deploy.yml" 또는 숫자 ID). workflow_dispatch 트리거가 설정된 워크플로만 실행 가능.',
      'GitLab: workflow 불필요 — ref(브랜치)만 지정하면 .gitlab-ci.yml 즉시 실행.',
      '완료 직후 최신 빌드 정보를 반환합니다. run_id를 ci_get_build_status에 사용하세요.',
    ].join(' '),
    {
      ref: z.string().default('main').describe('브랜치 또는 태그 (기본: main)'),
      workflow: z.string().optional().describe('GitHub 전용: 워크플로 파일명 또는 ID (예: deploy.yml)'),
      inputs: z.record(z.string(), z.string()).optional().describe('워크플로 입력값 (GitHub inputs / GitLab variables)'),
    },
    async ({ ref, workflow, inputs }) => {
      const cfg = requireCiConfig();

      let result;
      if (cfg.provider === 'github') {
        if (!workflow) throw new Error(M().needWorkflow);
        result = await github.triggerBuild(cfg, workflow, ref, inputs ?? {});
      } else {
        result = await gitlab.triggerBuild(cfg, ref, inputs ?? {});
      }

      if (!result) {
        return textResult(M().triggeredNoRun);
      }

      return textResult([
        M().triggered,
        `   run_id: ${result.id}`,
        M().status(result.status),
        M().branch(result.branch),
        result.commit ? M().commit(result.commit) : '',
        `   URL: ${result.url}`,
        '',
        M().checkProgress(result.id),
      ].filter(Boolean));
    },
  );

  server.tool(
    'ci_get_build_status',
    '특정 빌드(GitHub Actions run / GitLab pipeline)의 현재 상태를 조회합니다.',
    {
      run_id: z.string().describe('빌드 ID (ci_trigger_build 또는 ci_list_recent_builds 반환값)'),
    },
    async ({ run_id }) => {
      const cfg = requireCiConfig();
      const build = cfg.provider === 'github'
        ? await github.getBuildStatus(cfg, run_id)
        : await gitlab.getBuildStatus(cfg, run_id);

      const statusEmoji: Record<string, string> = {
        pending: '⏳', running: '🔄', success: '✅', failed: '❌', cancelled: '⛔',
      };
      const emoji = statusEmoji[build.status] ?? '❓';

      return textResult([
        M().buildHead(emoji, build.id, build.status.toUpperCase()),
        build.workflow ? M().workflow(build.workflow) : '',
        M().branch(build.branch),
        build.commit ? M().commit(build.commit) : '',
        M().created(build.createdAt),
        M().updated(build.updatedAt),
        `   URL: ${build.url}`,
      ].filter(Boolean));
    },
  );

  server.tool(
    'ci_list_recent_builds',
    '최근 빌드 목록을 조회합니다. 특정 브랜치나 워크플로로 필터링 가능.',
    {
      workflow: z.string().optional().describe('GitHub 전용: 워크플로 파일명 또는 ID'),
      ref: z.string().optional().describe('GitLab 전용: 브랜치 필터'),
      limit: z.number().int().min(1).max(50).default(10).describe('최대 개수 (기본: 10)'),
    },
    async ({ workflow, ref, limit }) => {
      const cfg = requireCiConfig();
      const builds = cfg.provider === 'github'
        ? await github.listRecentBuilds(cfg, workflow, limit)
        : await gitlab.listRecentBuilds(cfg, ref, limit);

      if (builds.length === 0) {
        return textResult(M().noBuilds);
      }

      const statusEmoji: Record<string, string> = {
        pending: '⏳', running: '🔄', success: '✅', failed: '❌', cancelled: '⛔',
      };

      const lines = builds.map((b) => {
        const emoji = statusEmoji[b.status] ?? '❓';
        const parts = [
          `${emoji} #${b.id}`,
          b.workflow ? `[${b.workflow}]` : '',
          b.branch,
          b.commit ? `@${b.commit}` : '',
          `→ ${b.status}`,
          `(${new Date(b.createdAt).toLocaleString(M().locale)})`,
        ].filter(Boolean);
        return parts.join(' ');
      });

      return textResult(M().recent(builds.length, lines.join('\n')));
    },
  );

  server.tool(
    'ci_cancel_build',
    '진행 중인 빌드를 취소합니다. (GitHub Actions run / GitLab pipeline)',
    {
      run_id: z.string().describe('빌드 ID (ci_trigger_build 또는 ci_list_recent_builds 반환값)'),
    },
    async ({ run_id }) => {
      const cfg = requireCiConfig();
      if (cfg.provider === 'github') {
        await github.cancelBuild(cfg, run_id);
      } else {
        await gitlab.cancelBuild(cfg, run_id);
      }
      return textResult(M().cancelled(run_id));
    },
  );
}
