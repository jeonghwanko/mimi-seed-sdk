# App Store screenshot requirements check

Start with a local project check, then connect App Store Connect to inspect screenshot and listing readiness.

```bash
npx -y mimi-seed@latest check --local
```

Screenshot coverage is a connected-store workflow, not part of the repository-only scan. Connect the required account, then ask your MCP client to check screenshot requirements and missing slots. Review Apple’s current requirements before uploading.

Connect store checks: `npx mimi-seed init`.

[Official reference](https://developer.apple.com/help/app-store-connect/reference/screenshot-specifications/) · [CI and repeat checks](../user-guide/release-doctor-ci.md) · [Validation examples](../user-guide/release-doctor-validation.md)

A repository scan does not guarantee store approval. Commercial use requires a separate license.

