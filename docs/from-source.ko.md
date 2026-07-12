# 소스에서 실행하기

리포를 clone 한 사람을 위한 문서 — 코드를 고치려는 경우, 또는 아직 배포되지 않은 코드를 돌려보려는 경우.

그냥 **쓰기만** 할 거라면 이 문서는 필요 없다. npm 이나 플러그인 마켓플레이스로 설치하면 된다
([README](../README.ko.md), 30초).

---

## 0. 이 리포의 구조 (먼저 읽을 것)

**루트에 `package.json` 도, npm 워크스페이스도, 루트 lockfile 도 없다.** 두 패키지는 **각각 따로** 설치·빌드한다.
의도한 구조지만, 다음을 뜻한다:

> 루트에서 `npm install` 을 해도 **아무 일도 일어나지 않는다.** 패키지마다 한 번씩, 총 두 번 설치한다.

| 패키지 | npm 이름 | 정체 |
|---|---|---|
| `packages/cli` | `mimi-seed` | `mimi-seed` 명령 |
| `packages/mcp-server` | `@yoonion/mimi-seed-mcp` | 로컬 stdio MCP 서버 + `mimi-seed-*-auth` 설정 바이너리들 |

---

## 1. 사전 조건

- **Node 20+.** `.nvmrc` 가 SSOT 다 — 리포 루트에서 `nvm use`.
- Git.
- Android 서명을 건드릴 때**만** JDK(`keytool`).

---

## 2. Clone 후 빌드

두 패키지를 순서대로. PowerShell 7 과 POSIX 셸 양쪽에서 그대로 동작한다:

```bash
git clone https://github.com/jeonghwanko/mimi-seed-sdk.git
cd mimi-seed-sdk

cd packages/mcp-server && npm install && npm run build && npm test
cd ../cli              && npm install && npm run build && npm test
```

---

## 3. 체크아웃에서 CLI 실행하기

두 가지 방법. 하나 고르면 된다.

### (a) 일회성 — 빌드도 전역 설치도 없이

`packages/cli` 안에서. `--` 는 인자를 npm 너머로 넘기기 위한 것이다:

```bash
npm run dev -- doctor
npm run dev -- setup
```

TypeScript 를 `tsx` 로 바로 실행하므로 다시 빌드할 게 없다. 빠른 반복에 적합.

### (b) 개발 클론 — `mimi-seed` 가 내 체크아웃을 가리키게

`mimi-seed-update` 스킬이 **이미 감지·업데이트를 지원하는** "개발 클론" 설치 형태다. 정작 만드는 법은 지금껏
어디에도 없었다:

```bash
cd packages/cli        && npm run build && npm link
cd ../mcp-server       && npm run build && npm link
```

이제 `mimi-seed`, `mimi-seed-mcp`, `mimi-seed-auth` 등이 전부 작업 트리를 가리킨다.

확인 — 이 화살표가 정확히 update 스킬이 찾는 신호다:

```bash
npm ls -g --depth=0
#   mimi-seed@x.y.z -> .../mimi-seed-sdk/packages/cli
```

**CLI 만이 아니라 MCP 서버도 link 해야 한다.** CLI 는 자격증명마다 `mimi-seed-*-auth` 바이너리로 셸아웃하는데,
`PATH` 에 이미 있으면 그걸 쓰고 없을 때만 `npx`(= **배포판**을 받아옴)로 폴백한다. 즉 `packages/cli` 만 link 하면
`mimi-seed setup` 이 네 체크아웃이 아니라 **릴리스된** setup 바이너리를 돌린다. 일부러 배포판을 쓰고 싶으면
`MIMI_SEED_FORCE_NPX=1`.

되돌리기:

```bash
npm unlink -g mimi-seed
npm unlink -g @yoonion/mimi-seed-mcp
```

> ⚠️ **`npm link` 는 `src/` 가 아니라 `dist/` 를 링크한다.** 소스를 고칠 때마다 `npm run build` 를 다시 돌려야
> 한다. 안 그러면 링크된 바이너리가 조용히 **직전 빌드**를 계속 실행하고, 이미 고친 코드를 붙잡고 디버깅하게 된다.

---

## 4. 체크아웃 MCP 서버를 Claude Code 에 등록

설치된 `mimi-seed` 와 충돌하지 않도록 **다른 이름**(`mimi-seed-dev`)을 쓴다. 등록 후엔 **새 세션을 시작**해야
한다 — 도구 목록은 시작할 때 읽는다.

**전역 링크(3b)를 했다면** — 경로가 안 들어가므로 틀릴 여지가 없다:

```bash
claude mcp add mimi-seed-dev -- mimi-seed-mcp
```

**아니라면** 빌드된 진입 파일을 **절대경로**로 가리킨다:

```powershell
# PowerShell, 리포 루트에서
claude mcp add mimi-seed-dev -- node "$PWD\packages\mcp-server\dist\index.js"
```

```bash
# bash / zsh, 리포 루트에서
claude mcp add mimi-seed-dev -- node "$(pwd)/packages/mcp-server/dist/index.js"
```

> `$(pwd)` 는 이식성이 없다 — bash·zsh·PowerShell 7 에선 되지만 **`cmd.exe` 에선 안 된다**(거기선 `%CD%`).
> Windows 에서 링크된 bare 바이너리 이름이 spawn 되지 않으면(npm link 는 `.cmd` 셰임을 설치한다) 위의 절대경로
> `node …\dist\index.js` 형태로 폴백하면 항상 동작한다.

Codex 는 같은 command/args 를 `~/.codex/config.toml` 에 넣는다 —
[`domain/skills-plugins.md`](domain/skills-plugins.md) 참고.

---

## 5. 체크아웃에서 첫 인증

```bash
mimi-seed setup          # 링크했다면 (3b)
npm run dev -- setup     # 또는 packages/cli 안에서
```

마법사가 모든 자격증명을 순회하며 각 토큰을 어디서 받는지 알려준다
([`credentials.ko.md`](credentials.ko.md)).

> ⚠️ **소스에서 돌려도 Google 로그인은 자립적이지 않다.** OAuth 클라이언트 id/secret 을 로그인 시점에 Mimi Seed
> 웹 콘솔에서 받아온다. 오프라인·폐쇄망·자체호스팅이라면 자체 클라이언트를 지정해야 한다:
>
> ```bash
> export MIMI_SEED_GOOGLE_CLIENT_ID=...
> export MIMI_SEED_GOOGLE_CLIENT_SECRET=...
> ```
>
> **Desktop app** 유형 OAuth 클라이언트로 만들고, 루프백 리다이렉트 포트는 **9876**.
> → [`troubleshooting.ko.md#config-fetch-failed`](troubleshooting.ko.md#config-fetch-failed)

---

## 6. 수정 → 검증 루프

고친 패키지 안에서:

```bash
npm run build && npm test
```

CLI 는 타입체크를 따로 돌려야 한다. `tsup` 은 타입을 **검사하지 않는다**:

```bash
cd packages/cli && npx tsc --noEmit
```

도구를 추가·개명하는가? 인벤토리는 테스트로 강제된다 — [`../CONTRIBUTING.md`](../CONTRIBUTING.md) 의 도구 등록
체크리스트와 [`domain/_index.md`](domain/_index.md) 온톨로지를 볼 것.
