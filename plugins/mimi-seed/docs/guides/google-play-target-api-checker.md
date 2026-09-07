# Google Play Target API checker

Check the target SDK resolved from your Android, Expo or Unity repository before preparing a submission.

```bash
npx -y mimi-seed@latest check --local
```

The report links the evidence file and Google’s policy source. Unresolved framework-managed values produce a warning; resolve the actual release build before making a submission decision.

Connect store checks: `npx mimi-seed init`.

[Official reference](https://support.google.com/googleplay/android-developer/answer/11926878) · [CI and repeat checks](../user-guide/release-doctor-ci.md) · [Validation examples](../user-guide/release-doctor-validation.md)

A repository scan does not guarantee store approval. Commercial use requires a separate license.

