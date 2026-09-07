# Expo release readiness check

Start in the Expo app directory and inspect Android/iOS identifiers and available policy evidence without store credentials.

```bash
npx -y mimi-seed@latest check --local
```

Static app configuration is inspected without executing app.config code. Dynamic values can require a manual check. A clean local scan does not validate EAS builds, store metadata or approval.

Connect store checks: `npx mimi-seed init`.

[Official reference](https://docs.expo.dev/workflow/configuration/) · [CI and repeat checks](../user-guide/release-doctor-ci.md) · [Validation examples](../user-guide/release-doctor-validation.md)

A repository scan does not guarantee store approval. Commercial use requires a separate license.

