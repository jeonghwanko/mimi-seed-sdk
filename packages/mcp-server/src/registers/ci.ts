import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { requireCiConfig, saveCiConfig } from '../ci/config.js';
import * as github from '../ci/github.js';
import * as gitlab from '../ci/gitlab.js';

export function registerCiTools(server: McpServer) {
  server.tool(
    'ci_save_config',
    [
      'GitHub Actions 또는 GitLab CI 연결 설정을 저장합니다.',
      '저장 위치: ~/.mimi-seed/ci.json (mode 0600).',
      'GitHub: provider="github", token="ghp_..." (repo+workflow 스코프 필요)',
      'GitHub Enterprise: host="https://github.example.com" 추가',
      'GitLab.com: provider="gitlab", token="glpat-..."',
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
      return {
        content: [{
          type: 'text',
          text: [
            `✅ CI 설정 저장 완료 (${provider})`,
            `   저장소: ${owner}/${repo}`,
            host ? `   Host: ${host}` : '',
            '',
            'ci_list_workflows 로 사용 가능한 워크플로를 확인하세요.',
          ].filter(Boolean).join('\n'),
        }],
      };
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
      return {
        content: [{
          type: 'text',
          text: JSON.stringify(result, null, 2),
        }],
      };
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
      inputs: z.record(z.string()).optional().describe('워크플로 입력값 (GitHub inputs / GitLab variables)'),
    },
    async ({ ref, workflow, inputs }) => {
      const cfg = requireCiConfig();

      let result;
      if (cfg.provider === 'github') {
        if (!workflow) throw new Error('GitHub 빌드 트리거에는 workflow 파라미터가 필요합니다. (예: "deploy.yml")');
        result = await github.triggerBuild(cfg, workflow, ref, inputs ?? {});
      } else {
        result = await gitlab.triggerBuild(cfg, ref, inputs ?? {});
      }

      if (!result) {
        return {
          content: [{
            type: 'text',
            text: '✅ 빌드 트리거 완료. run_id 조회 불가 — 잠시 후 ci_list_recent_builds로 확인하세요.',
          }],
        };
      }

      return {
        content: [{
          type: 'text',
          text: [
            `✅ 빌드 트리거 완료`,
            `   run_id: ${result.id}`,
            `   상태: ${result.status}`,
            `   브랜치: ${result.branch}`,
            result.commit ? `   커밋: ${result.commit}` : '',
            `   URL: ${result.url}`,
            '',
            `ci_get_build_status(run_id="${result.id}") 로 진행 상황을 확인하세요.`,
          ].filter(Boolean).join('\n'),
        }],
      };
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

      return {
        content: [{
          type: 'text',
          text: [
            `${emoji} 빌드 #${build.id} — ${build.status.toUpperCase()}`,
            build.workflow ? `   워크플로: ${build.workflow}` : '',
            `   브랜치: ${build.branch}`,
            build.commit ? `   커밋: ${build.commit}` : '',
            `   생성: ${build.createdAt}`,
            `   갱신: ${build.updatedAt}`,
            `   URL: ${build.url}`,
          ].filter(Boolean).join('\n'),
        }],
      };
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
        return { content: [{ type: 'text', text: '최근 빌드 없음.' }] };
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
          `(${new Date(b.createdAt).toLocaleString('ko-KR')})`,
        ].filter(Boolean);
        return parts.join(' ');
      });

      return {
        content: [{
          type: 'text',
          text: `최근 빌드 ${builds.length}개:\n\n${lines.join('\n')}`,
        }],
      };
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
      return {
        content: [{
          type: 'text',
          text: `⛔ 빌드 #${run_id} 취소 요청 완료.\nci_get_build_status(run_id="${run_id}") 로 상태를 확인하세요.`,
        }],
      };
    },
  );
}
