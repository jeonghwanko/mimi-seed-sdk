import fs from 'node:fs/promises';
import path from 'node:path';
import { checkBillingCompliance } from './billing.js';

const SKIP_DIRS = new Set([
  '.git',
  '.gradle',
  '.idea',
  '.next',
  '.expo',
  'build',
  'dist',
  'node_modules',
  'Pods',
  'DerivedData',
]);

const TARGET_SDK_POLICY = [
  { effectiveDate: '2025-08-31', minimum: 35 },
  { effectiveDate: '2026-08-31', minimum: 36 },
] as const;

const TARGET_SDK_SOURCE = 'https://support.google.com/googleplay/android-developer/answer/11926878';

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
  coverage: {
    checked: string[];
    requiresStoreConnection: string[];
  };
}

interface ProjectFile {
  absolute: string;
  relative: string;
  text: string;
}

async function walk(root: string, maxDepth = 7): Promise<ProjectFile[]> {
  const files: ProjectFile[] = [];
  async function visit(dir: string, depth: number): Promise<void> {
    if (depth > maxDepth) return;
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const absolute = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) await visit(absolute, depth + 1);
        continue;
      }
      if (!entry.isFile() || !isRelevantFile(entry.name)) continue;
      try {
        files.push({
          absolute,
          relative: path.relative(root, absolute).replace(/\\/g, '/'),
          text: await fs.readFile(absolute, 'utf8'),
        });
      } catch {
        // Unreadable files are ignored; other evidence can still produce a useful partial report.
      }
    }
  }
  await visit(root, 0);
  return files;
}

function isRelevantFile(name: string): boolean {
  return name === 'app.json'
    || name === 'app.config.json'
    || /^app\.config\.(?:js|cjs|mjs|ts)$/.test(name)
    || name === 'build.gradle'
    || name === 'build.gradle.kts'
    || name === 'libs.versions.toml'
    || name === 'gradle.properties'
    || name === 'AndroidManifest.xml'
    || name === 'Info.plist'
    || name === 'project.pbxproj'
    || name === 'package.json';
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))].sort();
}

function parseExpo(files: ProjectFile[]) {
  const androidPackageNames: string[] = [];
  const iosBundleIds: string[] = [];
  const platforms = new Set<string>();
  let detected = false;
  for (const file of files.filter((candidate) => /(?:^|\/)app(?:\.config)?\.(?:json|js|cjs|mjs|ts)$/.test(candidate.relative))) {
    detected = true;
    try {
      const json = JSON.parse(file.text) as Record<string, unknown>;
      const expo = ((json.expo && typeof json.expo === 'object') ? json.expo : json) as {
        android?: { package?: unknown };
        ios?: { bundleIdentifier?: unknown };
        platforms?: unknown;
      };
      if (typeof expo.android?.package === 'string') androidPackageNames.push(expo.android.package);
      if (typeof expo.ios?.bundleIdentifier === 'string') iosBundleIds.push(expo.ios.bundleIdentifier);
      if (Array.isArray(expo.platforms)) {
        for (const platform of expo.platforms) if (typeof platform === 'string') platforms.add(platform);
      }
    } catch {
      // Dynamic Expo configs are common. Resolve only obvious literal identifiers and keep the rest as warnings.
      const android = file.text.match(/\bandroid\s*:\s*\{[\s\S]{0,3000}?\bpackage\s*:\s*['"]([^'"]+)['"]/);
      const ios = file.text.match(/\bios\s*:\s*\{[\s\S]{0,3000}?\bbundleIdentifier\s*:\s*['"]([^'"]+)['"]/);
      if (android?.[1]) androidPackageNames.push(android[1]);
      if (ios?.[1]) iosBundleIds.push(ios[1]);
    }
  }
  for (const file of files.filter((candidate) => candidate.relative.endsWith('package.json'))) {
    try {
      const manifest = JSON.parse(file.text) as Record<string, unknown>;
      const groups = ['dependencies', 'devDependencies'].map((key) => manifest[key]);
      if (groups.some((group) => group && typeof group === 'object' && 'expo' in group)) detected = true;
    } catch {
      // A malformed package manifest cannot add Expo evidence.
    }
  }
  return { androidPackageNames, iosBundleIds, platforms, detected };
}

function detectProject(files: ProjectFile[]) {
  const expo = parseExpo(files);
  const gradleFiles = files.filter((file) => /build\.gradle(?:\.kts)?$/.test(file.relative));
  const pbxFiles = files.filter((file) => file.relative.endsWith('project.pbxproj'));
  const plistFiles = files.filter((file) => file.relative.endsWith('Info.plist'));

  const androidPackageNames = [...expo.androidPackageNames];
  for (const file of gradleFiles) {
    for (const match of file.text.matchAll(/\bapplicationId\s*(?:=\s*)?["']([^"']+)["']/g)) {
      androidPackageNames.push(match[1]);
    }
  }

  const iosBundleIds = [...expo.iosBundleIds];
  for (const file of pbxFiles) {
    for (const match of file.text.matchAll(/PRODUCT_BUNDLE_IDENTIFIER\s*=\s*([^;]+);/g)) {
      const value = match[1].trim().replace(/^["']|["']$/g, '');
      if (value && !value.includes('$')) iosBundleIds.push(value);
    }
  }
  for (const file of plistFiles) {
    const match = file.text.match(/<key>CFBundleIdentifier<\/key>\s*<string>([^<]+)<\/string>/);
    if (match?.[1] && !match[1].includes('$')) iosBundleIds.push(match[1]);
  }

  const expoTargetsAndroid = expo.detected && (expo.platforms.size === 0 || expo.platforms.has('android'));
  const expoTargetsIos = expo.detected && (expo.platforms.size === 0 || expo.platforms.has('ios'));
  const android = gradleFiles.length > 0
    || expo.androidPackageNames.length > 0
    || expoTargetsAndroid
    || files.some((file) => /(?:^|\/)android\//.test(file.relative));
  const ios = pbxFiles.length > 0
    || plistFiles.length > 0
    || expo.iosBundleIds.length > 0
    || expoTargetsIos
    || files.some((file) => /(?:^|\/)ios\//.test(file.relative));

  return {
    android,
    ios,
    androidPackageNames: unique(androidPackageNames),
    iosBundleIds: unique(iosBundleIds),
    gradleFiles,
  };
}

function targetPolicy(now: Date): { minimum: number | null; scheduleCurrent: boolean; effectiveDate?: string } {
  const today = now.toISOString().slice(0, 10);
  const current = [...TARGET_SDK_POLICY].filter((row) => row.effectiveDate <= today).at(-1);
  const refreshAfter = `${Number(TARGET_SDK_POLICY.at(-1)!.effectiveDate.slice(0, 4)) + 1}-08-31`;
  return {
    minimum: current?.minimum ?? null,
    scheduleCurrent: today <= refreshAfter,
    effectiveDate: current?.effectiveDate,
  };
}

function targetSdkFindings(gradleFiles: ProjectFile[], now: Date): ReleaseDoctorFinding[] {
  const evidence: Array<{ file: string; value: number }> = [];
  let hasUnresolvedExpression = false;
  for (const file of gradleFiles) {
    for (const match of file.text.matchAll(/\btargetSdk(?:Version)?\s*(?:=\s*)?(\d+)/g)) {
      evidence.push({ file: file.relative, value: Number.parseInt(match[1], 10) });
    }
    if (/\btargetSdk(?:Version)?\b/.test(file.text) && !/\btargetSdk(?:Version)?\s*(?:=\s*)?\d+/.test(file.text)) {
      hasUnresolvedExpression = true;
    }
  }

  const policy = targetPolicy(now);
  if (!policy.scheduleCurrent || policy.minimum === null) {
    return [{
      code: 'TARGET_SDK_POLICY_REFRESH_REQUIRED',
      severity: 'warning',
      title: 'Target API policy table needs a refresh',
      detail: 'The embedded Google Play Target API schedule is no longer current enough for a definitive result.',
      action: 'Check the current Google Play Target API requirement before submission.',
      sourceUrl: TARGET_SDK_SOURCE,
      ko: {
        title: 'Target API 정책표 갱신 필요',
        detail: '내장된 Google Play Target API 일정만으로는 현재 제출 요건을 확정할 수 없습니다.',
        action: '제출 전에 최신 Google Play Target API 요구사항을 확인하세요.',
      },
    }];
  }

  if (evidence.length === 0) {
    return [{
      code: 'TARGET_SDK_UNRESOLVED',
      severity: 'warning',
      title: 'Android targetSdk could not be resolved locally',
      detail: hasUnresolvedExpression
        ? 'A targetSdk expression exists, but its numeric value is defined indirectly.'
        : 'No literal targetSdk value was found in the scanned Gradle files.',
      action: `Resolve the release variant and confirm targetSdk ${policy.minimum} or newer before submission.`,
      sourceUrl: TARGET_SDK_SOURCE,
      ko: {
        title: 'Android targetSdk 값을 로컬에서 확정하지 못함',
        detail: hasUnresolvedExpression
          ? 'targetSdk 표현식은 있지만 숫자 값이 다른 파일이나 변수에 정의되어 있습니다.'
          : '검사한 Gradle 파일에서 숫자로 된 targetSdk 값을 찾지 못했습니다.',
        action: `릴리스 variant의 값을 확인해 targetSdk ${policy.minimum} 이상인지 검증하세요.`,
      },
    }];
  }

  const below = evidence.filter((row) => row.value < policy.minimum!);
  if (below.length > 0) {
    const first = below.sort((left, right) => left.value - right.value)[0];
    return [{
      code: 'TARGET_SDK_BELOW_MINIMUM',
      severity: 'blocker',
      title: `Android targetSdk ${first.value} is below the submission minimum`,
      detail: `Google Play requires targetSdk ${policy.minimum} or newer for new apps and updates after ${policy.effectiveDate}.`,
      action: `Upgrade targetSdk to ${policy.minimum} or newer and test the release build.`,
      file: first.file,
      sourceUrl: TARGET_SDK_SOURCE,
      ko: {
        title: `Android targetSdk ${first.value}은 현재 제출 기준 미달`,
        detail: `${policy.effectiveDate} 이후 신규 앱과 업데이트는 targetSdk ${policy.minimum} 이상이어야 합니다.`,
        action: `targetSdk를 ${policy.minimum} 이상으로 올리고 릴리스 빌드를 테스트하세요.`,
      },
    }];
  }

  const lowest = evidence.sort((left, right) => left.value - right.value)[0];
  return [{
    code: 'TARGET_SDK_OK',
    severity: 'info',
    title: `Android targetSdk ${lowest.value} meets the current minimum`,
    detail: `The lowest literal targetSdk found is at least ${policy.minimum}.`,
    file: lowest.file,
    sourceUrl: TARGET_SDK_SOURCE,
    ko: {
      title: `Android targetSdk ${lowest.value}은 현재 제출 기준 충족`,
      detail: `감지된 가장 낮은 targetSdk가 현재 최소값 ${policy.minimum} 이상입니다.`,
    },
  }];
}

function hasSpecializedAndroidProfile(files: ProjectFile[]): boolean {
  return files
    .filter((file) => file.relative.endsWith('AndroidManifest.xml'))
    .some((file) => /android\.hardware\.type\.(?:watch|automotive)|android\.software\.(?:leanback|xr)|LEANBACK_LAUNCHER/i.test(file.text));
}

export async function scanReleaseDoctor(projectPath: string, now = new Date()): Promise<ReleaseDoctorReport> {
  const root = path.resolve(projectPath);
  let stat;
  try {
    stat = await fs.stat(root);
  } catch {
    throw new Error(`Project path does not exist or is not readable: ${root}`);
  }
  if (!stat.isDirectory()) throw new Error(`Project path is not a directory: ${root}`);

  const files = await walk(root);
  const detected = detectProject(files);
  const platforms: Array<'android' | 'ios'> = [];
  if (detected.android) platforms.push('android');
  if (detected.ios) platforms.push('ios');

  const findings: ReleaseDoctorFinding[] = [];
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
      findings.push({
        code: 'ANDROID_PACKAGE_UNRESOLVED',
        severity: 'warning',
        title: 'Android application ID could not be resolved',
        detail: 'The Android project was detected, but no literal applicationId or Expo android.package was found.',
        action: 'Confirm the release variant applicationId before connecting Google Play.',
        ko: {
          title: 'Android application ID를 확정하지 못함',
          detail: 'Android 프로젝트는 감지했지만 applicationId 또는 Expo android.package의 문자열 값을 찾지 못했습니다.',
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
    }
    if (hasSpecializedAndroidProfile(files)) {
      findings.push({
        code: 'TARGET_SDK_SPECIALIZED_APP_REVIEW',
        severity: 'warning',
        title: 'Specialized Android app type needs a category-specific Target API check',
        detail: 'Wear OS, Android TV, Android Automotive OS, or Android XR evidence was found. Their submission minimums differ from general mobile apps, so Release Doctor did not apply the generic API 36 rule.',
        action: 'Confirm the app category and its current Target API requirement in the official table.',
        sourceUrl: TARGET_SDK_SOURCE,
        ko: {
          title: '특수 Android 앱 유형은 카테고리별 Target API 확인 필요',
          detail: 'Wear OS, Android TV, Android Automotive OS 또는 Android XR 근거를 찾았습니다. 일반 모바일 앱과 제출 최소값이 달라 API 36 기준을 일괄 적용하지 않았습니다.',
          action: '앱 카테고리와 해당 Target API 요구사항을 공식 표에서 확인하세요.',
        },
      });
    } else {
      findings.push(...targetSdkFindings(detected.gradleFiles, now));
    }

    const billing = await checkBillingCompliance(root, now);
    if (billing.status !== 'not_used') {
      const billingKoDetail = billing.status === 'pass'
        ? `감지된 Billing Library ${billing.detectedVersions.join(', ')}은 현재 제출 기준을 충족합니다.`
        : billing.status === 'blocker'
          ? `감지된 Billing Library ${billing.detectedVersions.join(', ')}은 현재 제출 최소 버전보다 낮습니다.`
          : billing.status === 'warning'
            ? `감지된 Billing Library ${billing.detectedVersions.join(', ')}은 현재 지원되지만 다음 지원 종료 대상입니다.`
            : 'Billing 의존성은 찾았지만 버전을 정적으로 확정하지 못했습니다.';
      findings.push({
        code: `BILLING_${billing.status.toUpperCase()}`,
        severity: billing.status === 'blocker' ? 'blocker' : billing.status === 'pass' ? 'info' : 'warning',
        title: billing.status === 'pass' ? 'Google Play Billing version is supported' : 'Google Play Billing needs attention',
        detail: billing.summary,
        action: billing.actions[0] ?? billing.upgrade.prompt,
        file: billing.evidence[0]?.file,
        sourceUrl: billing.policy.sourceUrl,
        ko: {
          title: billing.status === 'pass' ? 'Google Play Billing 버전 기준 충족' : 'Google Play Billing 확인 필요',
          detail: billingKoDetail,
          action: billing.actions[0]
            ? '공식 마감일과 보고된 Gradle 근거를 확인한 뒤 지원 버전으로 업그레이드하세요.'
            : 'Google Play Billing 업그레이드 Skill을 사용해 변경사항을 검토하세요.',
        },
      });
    }
  }

  if (detected.ios) {
    if (detected.iosBundleIds.length === 0) {
      findings.push({
        code: 'IOS_BUNDLE_ID_UNRESOLVED',
        severity: 'warning',
        title: 'iOS bundle identifier could not be resolved',
        detail: 'The iOS project was detected, but no literal bundle identifier was found in Expo config, Info.plist, or project.pbxproj.',
        action: 'Confirm PRODUCT_BUNDLE_IDENTIFIER for the release configuration before connecting App Store Connect.',
        ko: {
          title: 'iOS bundle identifier를 확정하지 못함',
          detail: 'iOS 프로젝트는 감지했지만 Expo 설정, Info.plist, project.pbxproj에서 문자열 bundle identifier를 찾지 못했습니다.',
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
    }
  }

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
    coverage: {
      checked: [
        'mobile project and app identifier detection',
        ...(detected.android ? ['Android targetSdk policy', 'Google Play Billing dependency policy'] : []),
      ],
      requiresStoreConnection: [
        'store listing metadata and screenshots',
        'uploaded build availability and processing state',
        'App Store age-rating answers and Google Play declarations',
        'review submission and rollout status',
      ],
    },
  };
}
