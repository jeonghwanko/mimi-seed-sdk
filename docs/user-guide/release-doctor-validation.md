# Release Doctor Validation Baseline

Before inviting pilot users, the scanner was run against five public upstream repositories. These are
preflight fixtures, not customer validation. The next milestone is five independent user-owned projects.

| Upstream fixture | Commit | Expected result | Observed result |
|---|---|---|---|
| `expo/expo-template-default` | `7537d91` | Expo Android + iOS; identifiers unresolved in the untouched template | Both platforms detected; unresolved identifier and Target API warnings |
| `react-native-community/template` | `ed3802b` | Native Android + iOS; Android Target API resolved | Both platforms detected; Android Target API passed; dynamic iOS identifier warned |
| `android/architecture-samples` | `ee66e15` | Android app; version-catalog Target API detected | Android detected; API 35 reported as below the 2026 submission minimum |
| `flutter/samples` `form_app` | `463e365` | Flutter Android + iOS; test targets excluded | Both platforms and release identifiers detected; Flutter-managed Target API warned as unresolved |
| `spring-guides/gs-gradle` | `878317c` | Non-mobile Gradle project | Rejected as no mobile project |

The core repository scan completed in under 100 ms per fixture on the validation machine. That excludes npx
installation time, which remains the largest first-run usability risk and is measured separately in the pilot.
The bundled CLI path no longer launches a second MCP-package installation.

This baseline checks platform classification and static policy evidence only. It does not test private source,
store credentials, uploaded builds, metadata, or review submission behavior.

## Pre-pilot rehearsal

A second preflight ran the published 0.21.3 CLI against 12 public open-source apps (native Android, native iOS,
bare React Native, Expo, Flutter, and Kotlin Multiplatform, several of them monorepos scanned with `--path`). The
"after" column is the fix branch measured on the same 12 repositories the fixes were developed against, so it shows
that those cases are fixed, not how the scanner does on projects it has not seen; the pilot measures that. Like the
baseline above, it does not count toward the five independent pilot projects.

| | First run | After the fixes |
|---|---|---|
| Platform detection | 12/12 | 12/12 |
| Warnings that were false positives | 12 of 17 | 0 of 4 |
| Blockers | 1 correct but citing an example app's file, 1 Billing blocker missed | 2 correct, citing the app's own file |
| App identifiers correct (Android / iOS) | 9/10 · 6/9 | 10/10 · 9/9 |

The false positives came from Wear OS modules switching off the phone app's Target API check, example apps and
extensions counted as extra apps, and identifiers or targetSdk values that a static scan can resolve but did not
(`$(VAR)` bundle IDs, version catalogs, `gradle.properties`, `apply from:` scripts, Expo build properties). The
missed blocker was a `react-native-iap` release whose bundled Billing Library had passed its deadline. The
remaining warnings are real: two multi-app repositories and two targetSdk values that live outside the repository's
static files. One repository's `devEngines` declaration stopped `npx` before the CLI ran; the
[pilot guide](release-doctor-pilot.md) describes the workaround.

## Known limits of the Target API check

Release Doctor reads build files; it does not run Gradle. It reports a targetSdk as resolved only when every
setting it found was understood, so the limits below make a result *unresolved* (a `NEEDS CHECK` warning) more
often than they make it wrong. Where a limit can hide a setting, it says so.

- **Binary and Maven Gradle plugins are not read.** A published plugin that sets targetSdk is invisible; convention
  plugins built inside the repository (buildSrc/, build-logic/, `includeBuild(…)` roots) are read.
- **Third-party package scripts** (`apply from:` into node_modules/, React Native's `project(':pkg').projectDir…`,
  `@sentry/react-native` 8's `buildscript.sourceFile` shim, Expo's `node --print` form) are read when they can be
  found. When they cannot, they are listed in an info item instead of being read, like binary plugins; install the
  JavaScript dependencies and re-run to read them.
- **Repository-owned `apply from:` that cannot be followed** — a URL, a computed path, an optional or git-ignored
  local file (for example a signing script only CI has), or a path outside the repository — makes the app module
  unresolved.
- **Included builds** given by a computed `includeBuild(…)` path, or living under node_modules/, are not read. The
  project walk stops at directory depth 7 (convention builds are read at any depth, within a per-build budget; a
  build too large to read completely makes the result unresolved).
- **Dead or conditional code counts.** A setting inside an `if`, a disabled branch, or code that never runs is
  treated as live; the lowest value wins.
- **Cross-project configuration** is recognised in its common shapes (`subprojects`, `allprojects`, `project(':x')`,
  `afterEvaluate`, `plugins.withId`); other ways of reaching another project's `android` block are not modelled.
- **Values computed outside the repository** stay unresolved: Flutter's `flutter.targetSdkVersion` (from the Flutter
  SDK) and properties that only CI passes (`-Px=…`, `ORG_GRADLE_PROJECT_x`).
- **Unity Gradle templates:** a `**TARGETSDKVERSION**` placeholder is filled from ProjectSettings; a literal value
  written in the template counts as the app's.
- **The Gradle reader is a lexer with heuristics,** not a Groovy or Kotlin compiler. Shapes it does not model are
  reported as unresolved rather than guessed; for example, a Groovy method whose opening brace is on its own line
  (Allman style) leaves the names used inside it unresolved.
