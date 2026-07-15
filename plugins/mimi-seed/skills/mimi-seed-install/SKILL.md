---
name: mimi-seed-install
description: mimi-seed-sdk 를 소스(git clone)에서 설치한다 — 두 패키지 install·build·npm link → Claude Code MCP + Codex marketplace/plugin 등록 → 언어 선택 + 계정 연결(mimi-seed setup)까지. Use when the user has cloned mimi-seed-sdk and asks to install / set it up from source, or when `mimi-seed` is not on PATH in a checkout of this repo.
---

# mimi-seed 소스 설치

`git clone` 한 mimi-seed-sdk 체크아웃을 **동작하는 설치 상태**로 만든다.

배포판(npm/플러그인)을 쓰려는 사용자에게는 이 스킬을 쓰지 않는다 — 그건 README 의 30초 설치가 맞다.
이 스킬은 **소스에서 돌리려는 경우**(코드 수정, 미배포 기능 사용)에만 쓴다.

## 0. 사전 확인

```bash
node -v          # .nvmrc 기준 20 이상이어야 함
```

리포 루트인지 확인한다 (`packages/cli` 와 `packages/mcp-server` 가 보여야 함). 아니면 사용자에게
clone 위치를 묻는다.

## 1. 설치 (한 명령)

```bash
npm run setup
```

이게 하는 일 — `scripts/install.mjs`:

1. `packages/mcp-server` → `npm install` → `npm run build` → `npm link`
2. `packages/cli` → `npm install` → `npm run build` → `npm link`
3. `claude mcp add mimi-seed-dev -- mimi-seed-mcp`
4. Codex marketplace 동기화 → `codex plugin marketplace add` → `codex plugin add mimi-seed@yoonion`

> 이 리포는 npm 워크스페이스가 **아니다.** 두 패키지를 각각 설치·빌드해야 하고, 루트
> `package.json` 은 그 부트스트랩 스크립트만 들고 있다.

링크 없이 빌드만 하려면 `npm run install:all`.

## 2. MCP·플러그인 등록 확인

`claude mcp add` 가 성공했으면 사용자에게 **새 세션을 시작해야** 도구가 보인다고 알린다 —
도구 목록은 세션 시작 시점에 읽는다. 이건 흔한 함정이라 반드시 짚어준다.

Codex 플러그인 설치가 성공했어도 **새 대화**를 시작해야 스킬과 도구가 보인다. MCP 등록만 성공하고
플러그인 설치가 빠진 상태를 설치 완료로 판단하지 않는다.

등록이 실패했다면(예: `claude` CLI 없음) 명령만 출력하고 직접 실행하도록 안내한다:

```bash
claude mcp add mimi-seed-dev -- mimi-seed-mcp
```

Codex 등록이 실패했다면 다음을 안내한다:

```bash
npm run plugin:sync
codex plugin marketplace add .
codex plugin add mimi-seed@yoonion
```

## 3. 언어 + 계정 연결

설치가 끝나면 사용자에게 **터미널에서** 다음을 실행하라고 안내한다:

```bash
mimi-seed setup
```

첫 실행이면 언어를 먼저 묻고(기본 한국어), 그다음 가진 계정을 순서대로 연결한다.

⚠️ **이 명령을 네가 대신 실행하지 마라.** 대화형이라 토큰·비밀번호를 사용자가 직접 입력해야 하고,
에이전트 세션에서 spawn 하면 입력을 받을 수 없다. 명령을 알려주고 결과를 기다린다.

언어만 따로 바꾸려면: `mimi-seed lang en` / `mimi-seed lang ko`.

## 4. 검증

```bash
mimi-seed doctor
```

12개 자격증명 상태 + Node·Git·앱 감지를 보고한다. 여기서 ✓ 가 뜨면 설치 완료다.

## 소스를 고친 뒤

`npm link` 는 `src/` 가 아니라 `dist/` 를 링크한다. **소스를 수정하면 그 패키지에서 다시 빌드**해야
링크된 바이너리에 반영된다:

```bash
cd packages/cli && npm run build     # 또는 packages/mcp-server
```

MCP 서버를 고쳤다면 빌드 후 **세션 재시작**까지 필요하다.
스킬·문서·`.mcp.json`·`.codex-plugin`을 고쳤다면 `npm run plugin:sync`와
`npm run plugin:check`를 실행한 뒤 Codex 플러그인을 다시 설치한다.

## 되돌리기

```bash
npm unlink -g mimi-seed
npm unlink -g @yoonion/mimi-seed-mcp
claude mcp remove mimi-seed-dev
```

## 더 읽을 것

- 설치의 세부·Windows 주의사항: [`docs/from-source.md`](../../docs/from-source.md)
- 각 계정 토큰을 어디서 받는지: [`docs/credentials.md`](../../docs/credentials.md)
- 설치가 안 될 때: [`docs/troubleshooting.md`](../../docs/troubleshooting.md)
