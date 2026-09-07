# mimi-seed

Find mobile release risks before connecting store accounts.

```bash
npx -y mimi-seed@latest check --local
```

Run in an Expo, React Native, Android, iOS or Unity app repository. Requires Node 20+.
Release Doctor reports identifiers, Target API and detectable Play Billing evidence with suggested actions.
Unresolved evidence remains a warning. A local pass does not guarantee store approval.

The checker is bundled; it does not install the full MCP server. Optional usage measurement is off by
default. See `mimi-seed telemetry --help` and the [privacy notice](https://mimi-seed.pryzm.gg/privacy/sdk-usage).

## Next steps

- Connect store checks: `npx mimi-seed init`, then `npx mimi-seed setup`.
- Repeat in CI: `npx mimi-seed check --local --fail-on-blocker`.
- Switch output language: `mimi-seed lang en`.
- Full options: `mimi-seed <command> --help`.

[Claude Code / Codex installation](https://github.com/jeonghwanko/mimi-seed-sdk#30-second-setup)
· [CI workflow and badge](https://github.com/jeonghwanko/mimi-seed-sdk/blob/main/docs/user-guide/release-doctor-ci.md)
· [Validation examples](https://mimi-seed.pryzm.gg/guides/validation-examples)

## Commands

| Command | Purpose |
|---|---|
| check | Local or connected release readiness |
| init | Connect the app and create agent context |
| setup | Guided account setup |
| telemetry | Optional usage measurement consent |
| doctor | Diagnose the environment and connections |
| notes | Generate release notes from Git history |
| review | Draft review replies |
| deploy | Orchestrate CI and store operations |
| auth | Manage individual connections |
| lang | Select English or Korean |

## 한국어

앱 저장소에서 위 명령을 실행하면 로그인 없이 출시 위험을 점검합니다.
[한국어 사용 가이드](https://github.com/jeonghwanko/mimi-seed-sdk/blob/main/README.ko.md)를 참고하세요.

## License

Licensed under [PolyForm Noncommercial](https://github.com/jeonghwanko/mimi-seed-sdk/blob/main/LICENSE).
Commercial use requires a separate license.
