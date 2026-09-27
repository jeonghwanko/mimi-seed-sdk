// CI 프로바이더(GitHub Actions / GitLab CI) 연결의 **공유 계약** — `~/.mimi-seed/ci.json` 의 모양과
// REST base URL 규칙.
//
// ci.json 은 두 패키지가 쓰는 문서화된 예외다(CLI `mimi-seed deploy` 셋업, MCP `ci_save_config`).
// 그래서 모양이 한 곳에 있어야 하고, base URL 을 조립하는 규칙도 같아야 한다 — 다르면 "CLI 로 검증은
// 통과했는데 MCP 도구는 404" 가 된다. 클라이언트 자체(요청·폴링·에러 문구·경로 인코딩)는 두 패키지의
// 쓰임이 달라 각자 둔다: cli/src/ci-providers.ts, mcp-server/src/ci/{github,gitlab}.ts.

export type CiProvider = 'github' | 'gitlab';

export interface CiConfig {
  provider: CiProvider;
  token: string;
  owner: string;
  repo: string;
  /** GitHub Enterprise / GitLab self-hosted 의 origin (예: https://git.example.com). 없으면 공용 호스트. */
  host?: string;
}

/** GitHub REST base. Enterprise 는 `<host>/api/v3`. */
export function githubApiBase(cfg: Pick<CiConfig, 'host'>): string {
  if (cfg.host) return `${cfg.host.replace(/\/$/, '')}/api/v3`;
  return 'https://api.github.com';
}

export function githubHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'Content-Type': 'application/json',
  };
}

/** GitLab REST base (v4). self-hosted 는 `<host>/api/v4`. */
export function gitlabApiBase(cfg: Pick<CiConfig, 'host'>): string {
  return `${cfg.host ?? 'https://gitlab.com'}/api/v4`;
}

/** GitLab 은 숫자 id 대신 URL 인코딩한 `namespace/repo` 경로를 프로젝트 id 로 받는다. */
export function gitlabProjectId(cfg: Pick<CiConfig, 'owner' | 'repo'>): string {
  return encodeURIComponent(`${cfg.owner}/${cfg.repo}`);
}
