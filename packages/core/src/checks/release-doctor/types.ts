// Release Doctor shared types: findings, report, and the scanned ProjectFile.
// Internal to Release Doctor — import the public API (scanReleaseDoctor, report types) from ../release-doctor.js.

import type { TargetSdkModuleVerdict, TargetSdkToken } from './target-sdk.js';

export type ReleaseDoctorSeverity = 'blocker' | 'warning' | 'info';

export interface ReleaseDoctorFinding {
  code: string;
  severity: ReleaseDoctorSeverity;
  title: string;
  detail: string;
  action?: string;
  file?: string;
  sourceUrl?: string;
  ko?: {
    title: string;
    detail: string;
    action?: string;
  };
}

export interface ReleaseDoctorReport {
  projectPath: string;
  checkedAt: string;
  platforms: Array<'android' | 'ios'>;
  identifiers: {
    androidPackageNames: string[];
    iosBundleIds: string[];
  };
  counts: Record<ReleaseDoctorSeverity, number>;
  findings: ReleaseDoctorFinding[];
  /** Per judged Android app module: the targetSdk values proven, or why it is unresolved. */
  targetSdkModules?: TargetSdkModuleVerdict[];
  /**
   * Every targetSdk token in the scanned Gradle scripts and how it was classified (the fail-closed net): an
   * unrecognised in-scope token, or an unattributable one below the minimum, keeps the verdict from TARGET_SDK_OK.
   */
  targetSdkTokens?: TargetSdkToken[];
  coverage: {
    checked: string[];
    /**
     * Codes of findings for checks that ran but could not reach a verdict (a blocker could hide behind them). The
     * report is not an all-clear while this is non-empty.
     */
    unresolved: string[];
    requiresStoreConnection: string[];
  };
}

export interface ProjectFile {
  absolute: string;
  relative: string;
  text: string;
  /**
   * Inside an example, sample, demo, test, vendored, or nested-repository tree, or an app project inside a nested
   * Swift package. Such files still detect the platform, but their app identifiers and targetSdk are used only
   * when the scan finds no app outside those trees (a library repository whose only app is its example).
   */
  sample?: boolean;
  /** Read from the enclosing repository root, outside the scanned `--path` (CI files, the root version catalog). */
  outside?: boolean;
  /** Inside a demo/ or demos/ tree (a subset of `sample`). */
  demo?: boolean;
  /** A source of a Gradle convention build (buildSrc/, build-logic/, an `includeBuild(…)` root). */
  convention?: boolean;
}
