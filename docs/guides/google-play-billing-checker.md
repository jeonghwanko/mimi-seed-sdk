# Google Play Billing deadline checker

Find detectable Billing library dependencies before an Android release.

```bash
npx -y mimi-seed@latest check --local
```

Release Doctor checks supported dependency declarations, including relevant transitive framework evidence. A missing declaration does not prove billing is absent. Compare the resolved release dependency tree with the linked policy.

Connect store checks: `npx mimi-seed init`.

[Official reference](https://developer.android.com/google/play/billing/deprecation-faq) · [CI and repeat checks](../user-guide/release-doctor-ci.md) · [Validation examples](../user-guide/release-doctor-validation.md)

A repository scan does not guarantee store approval. Commercial use requires a separate license.

