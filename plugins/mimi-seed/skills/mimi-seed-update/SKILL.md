---
name: mimi-seed-update
description: mimi-seed를 최신 버전으로 올린다 — MCP 서버(@yoonion/mimi-seed-mcp) · 스킬 번들(플러그인) · CLI(mimi-seed). 설치 형태(플러그인 / 전역 npm / npx 등록 / 개발 클론)를 먼저 판별해 그에 맞는 명령만 실행하고, "설치된 버전"이 아니라 "실제로 돌고 있는 버전"을 검증한다. Use when the user asks to update or upgrade mimi-seed, when a newly released MCP tool does not show up, or when mimi-seed tools look stale or missing.
---

# mimi-seed-update

mimi-seed는 업데이트 대상이 **세 개**다. 셋은 버전도 배포 경로도 다르다.

| 대상 | 패키지 / 채널 | 여기에 뭐가 들어있나 |
|---|---|---|
| **MCP 서버** | `@yoonion/mimi-seed-mcp` (npm) | **도구 전부**. 새 도구는 여기서만 온다 |
| **스킬 번들** | Claude Code 플러그인 `mimi-seed@yoonion` (git 마켓플레이스) | `skills/` — 이 문서를 포함한 스킬들 |
| **CLI** | `mimi-seed` (npm) | `mimi-seed init` / `deploy` 등 터미널 명령 |

"업데이트했는데 새 도구가 안 보인다"의 원인은 거의 항상 (1) 셋 중 **엉뚱한 걸** 올렸거나, (2) 올렸지만 **옛 서버 프로세스가 그대로 돌고 있어서**다.

## 원칙

**설치된 버전이 아니라 돌고 있는 버전을 검증한다.** 업데이트 명령이 성공해도 세션이 옛 MCP 프로세스를 물고 있거나 npx가 캐시된 구버전을 재사용하면 도구는 그대로다. 마지막 검증 단계(4번)를 건너뛰지 않는다.

## 1. 최신 버전과 설치 형태 판별

```bash
npm view @yoonion/mimi-seed-mcp version   # 최신 서버 버전 (도구는 이 패키지에 있다)
npm view mimi-seed version                # 최신 CLI 버전
npm ls -g --depth=0                       # 전역 설치본과 그 버전
claude plugin list                        # 플러그인으로 설치했는지
```

그리고 MCP가 **어떤 형태로 등록**되어 있는지 본다 (`~/.claude.json`의 `mcpServers`, 프로젝트 `.mcp.json`, 또는 플러그인 번들):

| 형태 | 판별 신호 | 업데이트는 |
|---|---|---|
| 플러그인 | `claude plugin list`에 `mimi-seed@yoonion` | 2A |
| 전역 npm 설치 | 등록 args가 `node <전역 node_modules>/@yoonion/mimi-seed-mcp/dist/index.js` | 2B |
| npx 등록 | 등록 args가 `npx -y @yoonion/mimi-seed-mcp` | 2C |
| 개발 클론 | `npm ls -g` 출력에 `mimi-seed@x.y.z -> ...\mimi-seed-sdk\packages\cli` 같은 화살표(심볼릭 링크) | 2D |

형태를 확정하기 전에 아무 명령이나 실행하지 않는다. 전역 설치본을 쓰는 사람에게 플러그인 명령을 시키면 아무 일도 안 일어난 채 "업데이트했다"고 착각하게 된다.

## 2. 형태별 업데이트

### A. 플러그인 설치

```bash
claude plugin marketplace update yoonion
claude plugin update mimi-seed@yoonion
```

이걸로 **스킬과 매니페스트는** 최신이 된다. 하지만 **MCP 서버는 아직 옛것일 수 있다** — 플러그인이 번들하는 `.mcp.json`은 `npx -y @yoonion/mimi-seed-mcp`로 버전을 고정하지 않아서, npx가 캐시된 구버전을 재사용할 수 있다. 반드시 **2C(캐시)** 까지 처리하고 3번으로 간다.

서드파티 마켓플레이스는 자동 업데이트가 기본 **off**다. `/plugin` → Marketplaces 탭에서 auto-update를 켜두면 다음 세션 시작 때 자동 갱신된다.

### B. 전역 npm 설치

```bash
npm install -g @yoonion/mimi-seed-mcp@latest   # 도구
npm install -g mimi-seed@latest                # CLI도 쓴다면 (별개 패키지, 별개 버전)
```

### C. npx 등록 (플러그인 번들과 `claude mcp add` 공통)

npx는 캐시(`_npx`)에 있는 버전을 재사용할 수 있어, 등록만으로 최신이 보장되지 않는다. 둘 중 하나:

- 등록 args에 버전을 박는다 → `npx -y @yoonion/mimi-seed-mcp@latest` (매 기동 시 레지스트리 조회 = 시작이 느려지고 오프라인에서 취약)
- 또는 npx 캐시를 비운다 → macOS/Linux `rm -rf ~/.npm/_npx`, Windows `%LocalAppData%\npm-cache\_npx` 삭제

### D. 개발 클론 (메인테이너)

전역 `mimi-seed`가 SDK 클론으로 링크된 상태. npm 재설치가 아니라 클론을 당긴다.

```bash
cd <mimi-seed-sdk 클론>
git pull
cd packages/mcp-server && npm install && npm run build
```

새 버전 **퍼블리시는 이 스킬의 범위가 아니다.** `main` 푸시 시 `ci.yml`이 package.json 버전이 올라가 있으면 npm publish를 자동 수행한다.

## 3. 적용 — 새 서버를 실제로 띄운다

| 설치 형태 | 적용 |
|---|---|
| 플러그인 | `/reload-plugins` — 세션 재시작 없이 스킬·플러그인 MCP 서버까지 다시 로드 |
| `~/.claude.json` / 프로젝트 `.mcp.json` 등록 | **세션 재시작** |

## 4. 검증 (건너뛰지 말 것)

1. `mimi_seed_status` 호출 — 서버가 응답하는지, 서비스 연결이 그대로인지.
2. 최신 버전에서 새로 추가된 도구가 실제로 잡히는지 확인한다: `ToolSearch(query="select:<신규 도구명>")`. 스키마가 로드되면 새 서버가 돌고 있는 것이다. 안 잡히면 옛 프로세스이거나 npx 캐시다 → 2C·3번을 다시 한다.
3. 전역 설치라면 `npm ls -g --depth=0`의 버전이 `npm view @yoonion/mimi-seed-mcp version`과 같은지 대조한다.

인증 파일(`~/.mimi-seed/`)은 업데이트가 건드리지 않는다. 재인증 신호가 나올 때만 `mimi-seed-auth`를 안내한다.

## 함정

- **"업데이트했는데 새 도구가 없다"** → 십중팔구 세션 미재시작 또는 npx 캐시. 재설치를 반복하지 말고 3·4번을 확인한다.
- **CLI를 올려도 도구는 안 늘어난다.** 도구는 `@yoonion/mimi-seed-mcp`에 있다. `mimi-seed`(CLI)는 별개 패키지이고 버전도 따로 논다.
- **스킬만 최신, 서버는 구버전** (2A의 함정). 스킬 문구는 새 도구를 설명하는데 그 도구가 없는 상태가 되어 디버깅이 꼬인다.
