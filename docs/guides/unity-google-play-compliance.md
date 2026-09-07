# Unity Google Play release check

Inspect a Unity project’s mobile identifiers and Android policy evidence from repository files.

```bash
npx -y mimi-seed@latest check --local
```

Start from the folder containing ProjectSettings. Generated Gradle values, plugin dependencies and special device categories can require checking the exported Android project and final build.

Connect store checks: `npx mimi-seed init`.

[Official reference](https://docs.unity3d.com/Manual/android-BuildProcess.html) · [CI and repeat checks](../user-guide/release-doctor-ci.md) · [Validation examples](../user-guide/release-doctor-validation.md)

A repository scan does not guarantee store approval. Commercial use requires a separate license.

