// CLI 가 호출하는 Claude 모델의 SSOT.
//
// 예전엔 이 모델 id 가 두 패키지 6개 파일에 리터럴로 흩어져 있었다 — 모델을 바꾸려면
// 6곳을 고쳐야 했고, 하나를 빠뜨려도 알려주는 게 없었다.
//
// mcp-server 에는 같은 역할의 상수가 `src/ai/client.ts` 에 따로 있다 (두 패키지는 서로를
// import 하지 않는다). 두 값이 같아야 CLI 경로와 MCP 경로가 같은 모델을 쓴다 —
// mcp-server 의 `ai-model-parity.test.ts` 가 그 일치를 강제한다.
export const CLI_AI_MODEL = "claude-haiku-4-5-20251001";
