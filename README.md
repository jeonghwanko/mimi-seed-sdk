# mimi-seed SDK

> **Mimi Seed** 앱 출시 운영 콘솔의 오픈 SDK — CLI + MCP Server

[![npm cli](https://img.shields.io/npm/v/mimi-seed?label=mimi-seed&color=F59E0B)](https://www.npmjs.com/package/mimi-seed)
[![npm mcp](https://img.shields.io/npm/v/%40yoonion%2Fmimi-seed-mcp?label=%40yoonion%2Fmimi-seed-mcp&color=F59E0B)](https://www.npmjs.com/package/@yoonion/mimi-seed-mcp)
[![license](https://img.shields.io/badge/license-PolyForm--NC--1.0.0-blue)](LICENSE)

**Live:** <https://mimi-seed.pryzm.gg>

---

## 패키지 구성

| 패키지 | 역할 |
|--------|------|
| [`packages/cli`](packages/cli) — npm `mimi-seed` | `npx mimi-seed init` 한 줄로 현재 프로젝트를 Mimi Seed에 연결 |
| [`packages/mcp-server`](packages/mcp-server) — npm `@yoonion/mimi-seed-mcp` | Claude Code / Claude Desktop에서 바로 쓰는 MCP 서버 |

---

## CLI — `mimi-seed`

```bash
npx mimi-seed init     # 프로젝트 감지 → 브라우저 로그인 → PAT 발급 → MCP 등록 안내
npx mimi-seed status   # 현재 연결 상태 + 앱 목록
npx mimi-seed logout   # 로컬 설정 삭제
```

- Expo / Gradle / iOS Info.plist / pbxproj 자동 감지
- `~/.mimi-seed/config.json` 에 토큰 저장 (mode 0600)
- 환경변수: `MIMI_SEED_TOKEN`, `MIMI_SEED_WEB_BASE`

---

## MCP Server — `@yoonion/mimi-seed-mcp`

Claude Code 또는 Claude Desktop에서 Mimi Seed를 MCP 도구로 직접 사용.

### Claude Code (Remote MCP)

```bash
claude mcp add --transport http mimi-seed https://mimi-seed.pryzm.gg/api/mcp \
  --header "Authorization: Bearer <PAT>"
```

PAT 발급: <https://mimi-seed.pryzm.gg/workspace/api-tokens>

### Claude Desktop (Local MCP)

```bash
npm install -g @yoonion/mimi-seed-mcp
mimi-seed-auth          # Google OAuth → ~/.mimi-seed/tokens.json
mimi-seed-appstore-auth # App Store Connect 키 설정
```

`~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "mimi-seed": {
      "command": "mimi-seed-mcp",
      "args": []
    }
  }
}
```

### 제공 도구 (16개)

| 분류 | 도구 |
|------|------|
| 앱 | `list_apps` `get_app` `sync_apps` |
| 진단·점수 | `get_readiness` `get_blockers` `diagnose_integration` |
| Copy | `list_drafts` |
| Screenshot | `list_screenshots` `publish_screenshots` |
| 릴리즈 | `list_recent_releases` `get_release_checklist` `mark_checklist_item` |
| 활동 | `list_activities` |
| 시크릿 | `register_integration` `list_integrations` `delete_integration` |

---

## 라이선스

[PolyForm Noncommercial License 1.0.0](LICENSE) — 비상업적 사용만 허용.

Required Notice: Copyright 2026 Pryzm GG (<https://mimi-seed.pryzm.gg>)
