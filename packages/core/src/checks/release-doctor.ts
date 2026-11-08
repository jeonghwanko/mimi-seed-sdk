import fs from 'node:fs/promises';
import path from 'node:path';
import { type BillingComplianceResult, checkBillingCompliance, reactNativeIapUpgradeTarget } from './billing.js';
import { stripGradleComments } from './gradle-text.js';
import { repositoryRoot } from './lockfile.js';
import { fcmFindings } from './release-doctor/fcm.js';
import { CONVENTION_SOURCE_FILE, MAX_SOURCE_FILES, UNRESOLVED_CODES, walk } from './release-doctor/files.js';
import { appliedGradleScripts, repositoryRootFiles } from './release-doctor/gradle-apply.js';
import { iosXcodeFindings } from './release-doctor/ios-xcode.js';
import { REACT_NATIVE_CATALOG, appliesOnlyAndroidLibraryPlugin, detectProject, isOneAppWithExtensions, specializedAndroidModules } from './release-doctor/project.js';
import { TARGET_SDK_SOURCE, type TargetSdkModuleVerdict, type TargetSdkToken, everyProjectBlocks, targetPolicy, targetSdkFindings } from './release-doctor/target-sdk.js';
import type { ProjectFile, ReleaseDoctorFinding, ReleaseDoctorReport, ReleaseDoctorSeverity } from './release-doctor/types.js';
import { isWithin, moduleDir, unique } from './release-doctor/util.js';

export type { TargetSdkModuleVerdict, TargetSdkToken } from './release-doctor/target-sdk.js';
export type { ReleaseDoctorSeverity, ReleaseDoctorFinding, ReleaseDoctorReport } from './release-doctor/types.js';

/** Evidence rows with the ones below the submission minimum first (they are what a blocker is about). */
function billingEvidenceRows(billing: BillingComplianceResult) {
  const minimum = billing.policy.minimumSupportedMajor;
  const failing = (row: BillingComplianceResult['evidence'][number]) =>
    minimum !== null && row.version !== undefined && Number.parseInt(row.version, 10) < minimum;
  return [...billing.evidence.filter(failing), ...billing.evidence.filter((row) => !failing(row))];
}

function billingEvidenceText(billing: BillingComplianceResult): string {
  const rows = billingEvidenceRows(billing).map((row) => {
    const what = row.expression
      ? `${row.expression}${row.version && !row.expression.includes(row.version) ? ` = ${row.version}` : ''}`
      : `${row.module}:${row.version ?? '?'}`;
    return `${row.file} (${what})`;
  });
  return rows.length > 3 ? `${rows.slice(0, 3).join('; ')}; +${rows.length - 3}` : rows.join('; ');
}

/** The Release Doctor finding for a Billing result, with the evidence in both languages and a status-specific action. */
function billingFinding(billing: BillingComplianceResult): ReleaseDoctorFinding {
  const versions = billing.detectedVersions.join(', ');
  const evidence = billingEvidenceText(billing);
  const minimum = billing.policy.minimumSupportedMajor;
  const schedule = (major: number | null) => billing.policy.knownSchedule.find((row) => row.major === major);
  const status = billing.status as Exclude<BillingComplianceResult['status'], 'not_used'>;
  const iapTarget = minimum === null ? undefined : reactNativeIapUpgradeTarget(minimum);
  const iapBelow = minimum !== null && billing.evidence.some((row) => row.wrapper?.name === 'react-native-iap'
    && row.version !== undefined && Number.parseInt(row.version, 10) < minimum);
  const belowMajors = minimum === null ? [] : [...new Set(billing.detectedVersions
    .map((version) => Number.parseInt(version, 10))
    .filter((major) => Number.isFinite(major) && major < minimum))].sort((left, right) => left - right);

  const copy = {
    pass: {
      title: 'Google Play Billing version is supported',
      koTitle: 'Google Play Billing 버전 기준 충족',
      koDetail: `감지된 Billing Library ${versions}은 현재 제출 기준을 충족합니다.`,
      action: undefined,
      koAction: undefined,
    },
    warning: {
      title: 'Google Play Billing Library is supported, but its major is next to be deprecated',
      koTitle: 'Google Play Billing Library는 지원되지만 다음 지원 종료 대상',
      koDetail: `감지된 Billing Library ${versions}은 현재 지원되지만 다음 지원 종료 대상입니다.`,
      action: billing.actions.join(' ') || undefined,
      koAction: schedule(minimum) ? `${schedule(minimum)!.submissionDeadline} 전에 업그레이드를 계획하세요.` : undefined,
    },
    blocker: {
      title: 'Google Play Billing Library is below the submission minimum',
      koTitle: 'Google Play Billing Library가 제출 최소 버전 미달',
      koDetail: `감지된 Billing Library ${billing.detectedVersions.filter((version) => Number.parseInt(version, 10) < (minimum ?? 0)).join(', ')}은 현재 제출 최소 major ${minimum}보다 낮습니다.`,
      action: billing.actions.join(' '),
      koAction: [
        '새 앱이나 업데이트를 제출하기 전에 지원되는 Billing Library로 업그레이드하세요.',
        iapBelow && iapTarget
          ? `react-native-iap가 Billing을 간접적으로 포함합니다: ${iapTarget.version} 이상(Billing ${iapTarget.billing})으로 올리세요. major 업그레이드이므로 마이그레이션 가이드를 따르세요.`
          : '',
        ...belowMajors.map((major) => schedule(major)
          ? `Billing Library ${major}: 기본 마감일 ${schedule(major)!.submissionDeadline}, 연장 마감일 ${schedule(major)!.extensionDeadline}(Play Console에서 연장을 받은 경우에만).`
          : `Billing Library ${major}: 마감일이 내장된 공식 표보다 이르므로 유효한 연장이 있다고 가정하지 마세요.`),
      ].filter(Boolean).join(' '),
    },
    unresolved: billing.policy.scheduleCurrent
      ? {
        title: 'Google Play Billing version could not be resolved locally',
        koTitle: 'Google Play Billing 버전을 로컬에서 확정하지 못함',
        koDetail: 'Billing 의존성은 찾았지만 버전을 정적으로 확정하지 못했습니다.',
        action: billing.actions.join(' '),
        koAction: '보고된 Gradle/version catalog 표현식을 확인하거나 선언된 IAP 패키지를 설치한 뒤 다시 검사하세요.',
      }
      : {
        title: 'Google Play Billing policy table needs a refresh',
        koTitle: 'Google Play Billing 정책표 갱신 필요',
        koDetail: `내장된 공식 일정은 Billing Library ${billing.policy.latestKnownMajor}에서 끝나므로 현재 정책을 출처에서 다시 확인해야 합니다.`,
        action: billing.actions.join(' '),
        koAction: '공식 Billing 지원 중단 표를 확인하고, 이 결과를 믿기 전에 Mimi Seed를 업데이트하세요.',
      },
  }[status];

  return {
    code: `BILLING_${status.toUpperCase()}`,
    severity: status === 'blocker' ? 'blocker' : status === 'pass' ? 'info' : 'warning',
    title: copy.title,
    detail: `${billing.summary} Evidence: ${evidence}.`,
    action: copy.action,
    file: billingEvidenceRows(billing)[0]?.file,
    sourceUrl: billing.policy.sourceUrl,
    ko: {
      title: copy.koTitle,
      detail: `${copy.koDetail} 근거: ${evidence}.`,
      action: copy.koAction,
    },
  };
}

export interface ReleaseDoctorScanOptions {
  /** Upper bound on source files read for FCM evidence (tests lower it). */
  maxSourceFiles?: number;
}

export async function scanReleaseDoctor(
  projectPath: string,
  now = new Date(),
  options: ReleaseDoctorScanOptions = {},
): Promise<ReleaseDoctorReport> {
  const maxSourceFiles = options.maxSourceFiles ?? MAX_SOURCE_FILES;
  const root = path.resolve(projectPath);
  let stat;
  try {
    stat = await fs.stat(root);
  } catch {
    throw new Error(`Project path does not exist or is not readable: ${root}`);
  }
  if (!stat.isDirectory()) throw new Error(`Project path is not a directory: ${root}`);

  const { files, fcmSources, sourceScanTruncated, conventionTruncated } = await walk(root, maxSourceFiles);
  const reactNativeCatalog = path.join(root, 'node_modules', 'react-native', 'gradle', 'libs.versions.toml');
  try {
    files.push({
      absolute: reactNativeCatalog,
      relative: REACT_NATIVE_CATALOG,
      text: await fs.readFile(reactNativeCatalog, 'utf8'),
    });
  } catch {
    // The package may not be installed; the report will keep the indirect expression unresolved.
  }
  const repo = await repositoryRoot(root);
  if (repo && repo !== root && isWithin(repo, root)) files.push(...await repositoryRootFiles(root, repo));
  const detected = await detectProject(files, root);
  const platforms: Array<'android' | 'ios'> = [];
  if (detected.android) platforms.push('android');
  if (detected.ios) platforms.push('ios');

  const findings: ReleaseDoctorFinding[] = [];
  let targetSdkModules: TargetSdkModuleVerdict[] | undefined;
  let targetSdkTokens: TargetSdkToken[] | undefined;
  if (platforms.length === 0) {
    findings.push({
      code: 'NO_MOBILE_PROJECT',
      severity: 'blocker',
      title: 'No Android or iOS app project was detected',
      detail: 'Release Doctor could not find an Expo config, Android Gradle app, Xcode project, or iOS Info.plist.',
      action: 'Run this command from the mobile app repository root.',
      ko: {
        title: 'Android 또는 iOS 앱 프로젝트를 찾지 못함',
        detail: 'Expo 설정, Android Gradle 앱, Xcode 프로젝트, iOS Info.plist를 찾지 못했습니다.',
        action: '모바일 앱 저장소의 루트에서 다시 실행하세요.',
      },
    });
  }

  if (detected.android) {
    if (detected.androidPackageNames.length === 0) {
      const expressions = unique(detected.androidPackageExpressions.map((row) => `${row.expression} (${row.file})`));
      const listed = expressions.length > 3 ? `${expressions.slice(0, 3).join(', ')}, +${expressions.length - 3}` : expressions.join(', ');
      findings.push({
        code: 'ANDROID_PACKAGE_UNRESOLVED',
        severity: 'warning',
        title: 'Android application ID could not be resolved',
        detail: listed
          ? `The app module sets applicationId through an expression Release Doctor cannot evaluate statically: ${listed}. The Target API and Billing checks still ran.`
          : 'The Android project was detected, but no literal applicationId or Expo android.package was found.',
        action: 'Confirm the release variant applicationId before connecting Google Play.',
        file: detected.androidPackageExpressions[0]?.file,
        ko: {
          title: 'Android application ID를 확정하지 못함',
          detail: listed
            ? `앱 모듈이 정적으로 계산할 수 없는 표현식으로 applicationId를 지정합니다: ${listed}. Target API와 Billing 검사는 그대로 실행했습니다.`
            : 'Android 프로젝트는 감지했지만 applicationId 또는 Expo android.package의 문자열 값을 찾지 못했습니다.',
          action: 'Google Play 연결 전에 릴리스 variant의 applicationId를 확인하세요.',
        },
      });
    } else {
      findings.push({
        code: 'ANDROID_PACKAGE_FOUND',
        severity: 'info',
        title: 'Android application ID detected',
        detail: detected.androidPackageNames.join(', '),
        ko: {
          title: 'Android application ID 감지 완료',
          detail: detected.androidPackageNames.join(', '),
        },
      });
      if (detected.androidPackageNames.length > 1) {
        findings.push({
          code: 'MULTIPLE_ANDROID_APPLICATION_IDS',
          severity: 'warning',
          title: 'Multiple Android application IDs share this scan scope',
          detail: 'Repository-wide Target API and Billing evidence may belong to different apps or variants.',
          action: 'Run Release Doctor with --path set to one mobile app root before treating blockers as app-specific.',
          ko: {
            title: '검사 범위에 Android application ID가 여러 개 있음',
            detail: '저장소 전체에서 찾은 Target API와 Billing 근거가 서로 다른 앱 또는 variant에 속할 수 있습니다.',
            action: '블로커를 특정 앱의 결과로 판단하기 전에 --path로 모바일 앱 루트를 하나만 지정해 다시 검사하세요.',
          },
        });
      }
    }
    // Wear OS / TV / Automotive / XR minimums differ from phones, so those modules are left out of the generic rule
    // — per module: a phone app next to its Wear OS module is still checked.
    const specialized = specializedAndroidModules(detected.manifests, detected.androidAppModules);
    const generalModules = detected.androidAppModules.filter((module) => !specialized.has(module));
    const specializedList = [...specialized].map((module) => (module === '.' ? '(root)' : module)).sort().join(', ');
    if (specialized.size > 0 && generalModules.length === 0) {
      findings.push({
        code: 'TARGET_SDK_SPECIALIZED_APP_REVIEW',
        severity: 'warning',
        title: 'Specialized Android app type needs a category-specific Target API check',
        detail: `Wear OS, Android TV, Android Automotive OS, or Android XR evidence was found (${specializedList}). Their submission minimums differ from general mobile apps, so Release Doctor did not apply the generic API ${targetPolicy(now).minimum ?? ''} rule.`,
        action: 'Confirm the app category and its current Target API requirement in the official table.',
        sourceUrl: TARGET_SDK_SOURCE,
        ko: {
          title: '특수 Android 앱 유형은 카테고리별 Target API 확인 필요',
          detail: `Wear OS, Android TV, Android Automotive OS 또는 Android XR 근거를 찾았습니다(${specializedList}). 일반 모바일 앱과 제출 최소값이 달라 API ${targetPolicy(now).minimum ?? ''} 기준을 적용하지 않았습니다.`,
          action: '앱 카테고리와 해당 Target API 요구사항을 공식 표에서 확인하세요.',
        },
      });
    } else {
      const scoped = detected.gradleFiles.filter((file) =>
        file.relative.endsWith('libs.versions.toml') || !specialized.has(moduleDir(file.relative)));
      const limit = repo && isWithin(repo, root) ? repo : root;
      const applied = await appliedGradleScripts(scoped, root, limit, files);
      // Each judged app module with the scripts it applies; its targetSdk is evaluated on its own.
      const settingsDirs = files
        .filter((file) => /(?:^|\/)settings\.gradle(?:\.kts)?$/.test(file.relative))
        .map((file) => path.dirname(file.absolute));
      const buildRootOf = (file: ProjectFile) => settingsDirs
        .filter((dir) => isWithin(dir, file.absolute))
        .sort((left, right) => right.length - left.length)[0];
      const projectScript = (dir: string) => files.find((candidate) =>
        /(?:^|\/)build\.gradle(?:\.kts)?$/.test(candidate.relative) && path.dirname(candidate.absolute) === dir);
      const thirdPartyNotes: Array<{ reference: string; reason: string; installHint: boolean }> = [];
      const judged = await Promise.all(detected.appGradleFiles
        .filter((file) => !specialized.has(moduleDir(file.relative)))
        .map(async (file) => {
          // The root project of the module's build (nearest settings directory) and the scripts it applies.
          const buildRoot = buildRootOf(file);
          const rootScript = buildRoot === undefined ? undefined : projectScript(buildRoot);
          const rootText = rootScript && rootScript.absolute !== file.absolute
            ? { ...rootScript, text: stripGradleComments(rootScript.text) }
            : undefined;
          // Parent projects between the build root and the module (their extra properties are visible to it).
          const hierarchy: ProjectFile[] = [];
          for (let dir = path.dirname(path.dirname(file.absolute)); buildRoot !== undefined && dir !== buildRoot && isWithin(buildRoot, dir); dir = path.dirname(dir)) {
            const parent = projectScript(dir);
            if (parent) hierarchy.push({ ...parent, text: stripGradleComments(parent.text) });
          }
          // An `apply from:` the scanner cannot follow, in the module or its build root, leaves the module unresolved.
          // A third-party package script that cannot be read is noted instead, like a binary plugin.
          const unfollowed: string[] = [];
          const scripts = [file, ...await appliedGradleScripts([file], root, limit, files, unfollowed, thirdPartyNotes)];
          const inherited = rootText ? [rootText, ...await appliedGradleScripts([rootText], root, limit, files, unfollowed, thirdPartyNotes)] : [];
          // Scripts the build root applies inside subprojects { … } / allprojects { … } run in this module.
          const ranges = rootText ? everyProjectBlocks(rootText.text) : [];
          const everyProjectText = rootText && ranges.length > 0
            ? ranges.map(([open, close]) => rootText.text.slice(open, close + 1)).join('\n')
            : undefined;
          const everyProject = rootText && everyProjectText !== undefined
            ? (await appliedGradleScripts([{ ...rootText, text: everyProjectText }], root, limit, files))
              .map((applied) => inherited.find((candidate) => candidate.absolute === applied.absolute) ?? applied)
            : [];
          return { file, scripts, inherited, hierarchy, everyProject, unfollowed: unique(unfollowed) };
        }));
      // The net's scope: every Gradle script and convention-plugin source found, each out-of-scope one with why.
      const exclusion = (file: ProjectFile, text: string): string | undefined => {
        if (file.outside) return 'outside';
        if (file.sample && detected.shippedOnly) return 'sample';
        if (specialized.has(moduleDir(file.relative))) return 'specialized';
        if (appliesOnlyAndroidLibraryPlugin(text)) return 'library';
        return undefined;
      };
      const netFiles = files
        .filter((file) => /\.gradle(?:\.kts)?$/.test(file.relative) || (file.convention && CONVENTION_SOURCE_FILE.test(file.relative)))
        .map((file) => ({ ...file, text: stripGradleComments(file.text) }));
      // A script only out-of-scope projects `apply from:` (a library-only `gradle/android-library.gradle`) is out too.
      const referrers = new Map<string, Array<string | undefined>>();
      for (const file of netFiles.filter((candidate) => /(?:^|\/)build\.gradle(?:\.kts)?$/.test(candidate.relative))) {
        const reason = exclusion(file, file.text);
        for (const applied of await appliedGradleScripts([file], root, limit, files)) {
          referrers.set(applied.absolute, [...referrers.get(applied.absolute) ?? [], reason]);
        }
      }
      const rootScripts = new Map<string, Promise<ProjectFile[]>>();
      const rootScriptsOf = (file: ProjectFile): Promise<ProjectFile[]> => {
        const buildRoot = buildRootOf(file);
        if (buildRoot === undefined) return Promise.resolve([]);
        if (!rootScripts.has(buildRoot)) {
          const script = projectScript(buildRoot);
          const text = script ? { ...script, text: stripGradleComments(script.text) } : undefined;
          rootScripts.set(buildRoot, text
            ? appliedGradleScripts([text], root, limit, files).then((applied) => [text, ...applied])
            : Promise.resolve([]));
        }
        return rootScripts.get(buildRoot)!;
      };
      const net = await Promise.all(netFiles.map(async (file) => {
        const viaReferrers = referrers.get(file.absolute);
        const excluded = exclusion(file, file.text)
          ?? (viaReferrers && viaReferrers.every(Boolean) ? viaReferrers[0] : undefined);
        // The build root's scripts give the net the extra properties an unattributed script sees.
        return { file, excluded, inherited: (await rootScriptsOf(file)).filter((script) => script.absolute !== file.absolute) };
      }));
      const targetSdk = targetSdkFindings(
        [...scoped, ...applied], now, detected.targetSdkEvidence, detected.resolveCatalogs, detected.properties, judged, net,
        conventionTruncated,
      );
      findings.push(...targetSdk.findings);
      targetSdkModules = targetSdk.modules;
      targetSdkTokens = targetSdk.tokens;
      const notRead = [...new Map(thirdPartyNotes.map((note) => [note.reference, note])).values()];
      if (notRead.length > 0) {
        const listed = notRead.slice(0, 3).map((note) => `${note.reference}: ${note.reason}`).join('; ')
          + (notRead.length > 3 ? `; +${notRead.length - 3}` : '');
        const install = notRead.some((note) => note.installHint);
        findings.push({
          code: 'TARGET_SDK_THIRD_PARTY_SCRIPTS_NOT_READ',
          severity: 'info',
          title: 'Some third-party Gradle scripts were not read',
          detail: `Gradle scripts of JavaScript packages (node_modules/) are read when they can be found and otherwise treated like binary Gradle plugins, which Release Doctor does not read either. These were not read: ${listed}.`,
          ...(install ? { action: 'Install the JavaScript dependencies (npm, yarn, or pnpm install) and re-run to read the scripts of packages that are not installed.' } : {}),
          ko: {
            title: '읽지 않은 서드파티 Gradle 스크립트가 있음',
            detail: `JavaScript 패키지(node_modules/)의 Gradle 스크립트는 찾을 수 있으면 읽고, 찾을 수 없으면 Release Doctor가 읽지 않는 바이너리 Gradle 플러그인처럼 다룹니다. 다음 스크립트는 읽지 않았습니다: ${listed}.`,
            ...(install ? { action: '설치되지 않은 패키지의 스크립트를 읽으려면 JavaScript 의존성을 설치(npm, yarn 또는 pnpm install)한 뒤 다시 실행하세요.' } : {}),
          },
        });
      }
      if (specialized.size > 0) {
        findings.push({
          code: 'TARGET_SDK_SPECIALIZED_APP_REVIEW',
          severity: 'info',
          title: 'A Wear OS, TV, Automotive, or XR module needs its own Target API check',
          detail: `${specializedList} declares a specialized form factor whose submission minimum differs from phones, so it was left out of the check above; the other app modules (${generalModules.join(', ')}) were checked against the general rule.`,
          action: 'Confirm that module\'s Target API requirement in the official table.',
          sourceUrl: TARGET_SDK_SOURCE,
          ko: {
            title: 'Wear OS·TV·Automotive·XR 모듈은 별도 Target API 확인 필요',
            detail: `${specializedList} 모듈은 휴대전화와 제출 최소값이 다른 특수 기기용이라 위 검사에서 제외했습니다. 나머지 앱 모듈(${generalModules.join(', ')})은 일반 기준으로 검사했습니다.`,
            action: '해당 모듈의 Target API 요구사항을 공식 표에서 확인하세요.',
          },
        });
      }
    }

    // A real app kept in a demo/ or sample/ folder would otherwise be dropped silently: say which excluded app
    // modules would fail the general rule.
    const minimum = targetPolicy(now).minimum;
    const failingSamples = detected.sampleAppGradleFiles.flatMap((file) => {
      const verdict = targetSdkFindings([file], now, [], detected.resolveCatalogs, detected.properties, [{ file, scripts: [file] }]).findings[0];
      return verdict?.code === 'TARGET_SDK_BELOW_MINIMUM' ? [`${moduleDir(file.relative)} (${verdict.title.match(/targetSdk (\d+)/)?.[1]})`] : [];
    });
    if (failingSamples.length > 0 && minimum !== null) {
      const listed = failingSamples.length > 3 ? `${failingSamples.slice(0, 3).join(', ')}, +${failingSamples.length - 3}` : failingSamples.join(', ');
      findings.push({
        code: 'TARGET_SDK_SAMPLE_APPS_NOT_CHECKED',
        severity: 'info',
        title: 'App modules in example, sample, demo, or test folders were not judged',
        detail: `These app modules sit in example/sample/demo/test folders, so they were treated as sample apps and left out of the Target API verdict, but their targetSdk is below ${minimum}: ${listed}.`,
        action: `If one of them is published to Google Play, raise its targetSdk to ${minimum} or newer, or scan it on its own with --path.`,
        file: detected.sampleAppGradleFiles[0]?.relative,
        sourceUrl: TARGET_SDK_SOURCE,
        ko: {
          title: 'example·sample·demo·test 폴더의 앱 모듈은 판정하지 않음',
          detail: `다음 앱 모듈은 example/sample/demo/test 폴더에 있어 샘플 앱으로 보고 Target API 판정에서 제외했지만 targetSdk가 ${minimum} 미만입니다: ${listed}.`,
          action: `이 중 Google Play에 배포하는 앱이 있다면 targetSdk를 ${minimum} 이상으로 올리거나 --path로 그 앱만 따로 검사하세요.`,
        },
      });
    }

    const billing = await checkBillingCompliance(root, now);
    if (billing.status !== 'not_used') findings.push(billingFinding(billing));
  }

  if (detected.ios) {
    if (detected.iosBundleIds.length === 0) {
      const expressions = unique(detected.iosBundleIdExpressions.map((row) => `${row.expression} (${row.file})`));
      const listed = expressions.length > 3 ? `${expressions.slice(0, 3).join(', ')}, +${expressions.length - 3}` : expressions.join(', ');
      findings.push({
        code: 'IOS_BUNDLE_ID_UNRESOLVED',
        severity: 'warning',
        title: 'iOS bundle identifier could not be resolved',
        detail: listed
          ? `PRODUCT_BUNDLE_IDENTIFIER is set through build-setting variables that no .xcconfig or XcodeGen file in scope resolves: ${listed}.`
          : 'The iOS project was detected, but no literal bundle identifier was found in Expo config, Info.plist, or project.pbxproj.',
        action: 'Confirm PRODUCT_BUNDLE_IDENTIFIER for the release configuration before connecting App Store Connect.',
        file: detected.iosBundleIdExpressions[0]?.file,
        ko: {
          title: 'iOS bundle identifier를 확정하지 못함',
          detail: listed
            ? `PRODUCT_BUNDLE_IDENTIFIER가 검사 범위의 .xcconfig나 XcodeGen 파일로 해석되지 않는 빌드 설정 변수로 지정되어 있습니다: ${listed}.`
            : 'iOS 프로젝트는 감지했지만 Expo 설정, Info.plist, project.pbxproj에서 문자열 bundle identifier를 찾지 못했습니다.',
          action: 'App Store Connect 연결 전에 릴리스 구성의 PRODUCT_BUNDLE_IDENTIFIER를 확인하세요.',
        },
      });
    } else {
      findings.push({
        code: 'IOS_BUNDLE_ID_FOUND',
        severity: 'info',
        title: 'iOS bundle identifier detected',
        detail: detected.iosBundleIds.join(', '),
        ko: {
          title: 'iOS bundle identifier 감지 완료',
          detail: detected.iosBundleIds.join(', '),
        },
      });
      // One app plus its `<app>.<suffix>` extensions, widgets, and watch app is a single release, not several.
      if (detected.iosBundleIds.length > 1 && !isOneAppWithExtensions(detected.iosBundleIds)) {
        findings.push({
          code: 'MULTIPLE_IOS_BUNDLE_IDS',
          severity: 'warning',
          title: 'Multiple iOS bundle identifiers share this scan scope',
          detail: 'The identifiers may represent multiple apps, extensions, or release targets in the same repository.',
          action: 'Confirm which identifier belongs to the release target; use --path to narrow a monorepo scan.',
          ko: {
            title: '검사 범위에 iOS bundle identifier가 여러 개 있음',
            detail: '같은 저장소의 여러 앱, extension 또는 출시 타깃 식별자가 함께 감지됐을 수 있습니다.',
            action: '출시 타깃의 식별자를 확인하고, 모노레포라면 --path로 검사 범위를 좁히세요.',
          },
        });
      }
    }
    // Pins in demo/ count only when the iOS app itself lives there.
    findings.push(...iosXcodeFindings(detected.hasIosAppOutsideDemo ? files.filter((file) => !file.demo) : files, now));
  }

  findings.push(...await fcmFindings(files, detected.hasAppOutsideDemo ? fcmSources.filter((file) => !file.demo) : fcmSources, root, now));

  const counts = findings.reduce<Record<ReleaseDoctorSeverity, number>>(
    (result, finding) => ({ ...result, [finding.severity]: result[finding.severity] + 1 }),
    { blocker: 0, warning: 0, info: 0 },
  );

  return {
    projectPath: root,
    checkedAt: now.toISOString(),
    platforms,
    identifiers: {
      androidPackageNames: detected.androidPackageNames,
      iosBundleIds: detected.iosBundleIds,
    },
    counts,
    findings,
    ...(targetSdkModules ? { targetSdkModules } : {}),
    ...(targetSdkTokens ? { targetSdkTokens } : {}),
    coverage: {
      checked: [
        'mobile project and app identifier detection',
        ...(detected.android ? ['Android targetSdk policy', 'Google Play Billing dependency policy'] : []),
        ...(detected.ios ? ['App Store Connect Xcode / SDK minimum (pinned build tooling)'] : []),
        sourceScanTruncated
          ? `Firebase Cloud Messaging legacy API usage (first ${maxSourceFiles} source files)`
          : 'Firebase Cloud Messaging legacy API usage',
      ],
      unresolved: unique(findings.filter((finding) => UNRESOLVED_CODES.has(finding.code)).map((finding) => finding.code)),
      requiresStoreConnection: [
        'store listing metadata and screenshots',
        'uploaded build availability and processing state',
        'App Store age-rating answers and Google Play declarations',
        'review submission and rollout status',
      ],
    },
  };
}
