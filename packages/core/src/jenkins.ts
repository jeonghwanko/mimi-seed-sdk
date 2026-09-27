// `~/.mimi-seed/jenkins.json` 의 모양 — mcp-server 가 쓰고(jenkins_save_config · mimi-seed-jenkins-auth),
// CLI 가 읽는다(`mimi-seed deploy` 의 잡 트리거). 파일은 하나라 모양도 한 곳에 둔다.

export interface JenkinsConfig {
  url: string; // Jenkins 기본 URL (e.g. https://jenkins.example.com)
  username: string; // Jenkins 사용자 ID (레거시 CLI config.json 에서는 `user` 였다)
  token: string; // Jenkins API Token
  // 아래 둘은 CLI(mimi-seed deploy)가 빌드를 트리거할 잡 이름. MCP 도구는 쓰지 않지만
  // 설정 파일은 하나뿐이므로 여기서 함께 들고 간다.
  jobAndroid?: string;
  jobIos?: string;
}
