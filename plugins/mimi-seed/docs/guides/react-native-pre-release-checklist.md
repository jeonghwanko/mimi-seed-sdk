# React Native pre-release checklist

Check detectable native configuration before packaging a React Native release.

```bash
npx -y mimi-seed@latest check --local
```

Review identifiers, target SDK evidence and Billing findings, then validate signing, the uploaded build, privacy declarations and store metadata separately. Add the local check to CI only after reviewing its first report.

Connect store checks: `npx mimi-seed init`.

[Official reference](https://reactnative.dev/docs/signed-apk-android) · [CI and repeat checks](../user-guide/release-doctor-ci.md) · [Validation examples](../user-guide/release-doctor-validation.md)

A repository scan does not guarantee store approval. Commercial use requires a separate license.

