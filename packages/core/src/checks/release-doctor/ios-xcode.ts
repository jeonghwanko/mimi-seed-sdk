// Release Doctor iOS Xcode/SDK pin check against the App Store Connect upload minimums.
// Internal to Release Doctor — import the public API (scanReleaseDoctor, report types) from ../release-doctor.js.

import path from 'node:path';
import type { ProjectFile, ReleaseDoctorFinding } from './types.js';
import { isXcodeCloudScript, isXcodePinFile, stripComments } from './util.js';

// Apple's App Store Connect upload minimums. Each row cites the Apple Developer news post that announced it.
// Apple announces the next minimum each spring, so the table is treated as stale from April 1 of the year after
// the newest row — add the new row before then instead of letting Release Doctor guess.
const IOS_SDK_POLICY = [
  {
    effectiveDate: '2025-04-24',
    minimumXcode: 16,
    sdk: 'iOS 18',
    sourceUrl: 'https://developer.apple.com/news/?id=9s0rgdy9',
  },
  {
    effectiveDate: '2026-04-28',
    minimumXcode: 26,
    sdk: 'iOS 26',
    sourceUrl: 'https://developer.apple.com/news/?id=ueeok6yw',
  },
] as const;

const IOS_SDK_POLICY_SOURCE = 'https://developer.apple.com/news/upcoming-requirements/';

// App Store Connect release notes: beta Xcode builds are accepted for TestFlight only; App Store submission needs
// a release or Release Candidate Xcode.
const IOS_BETA_TOOLS_NOTE = {
  en: 'TestFlight also accepts builds from beta Xcode releases, but App Store submission requires a release or Release Candidate (RC) Xcode.',
  ko: 'TestFlight는 베타 Xcode로 만든 빌드도 받지만, App Store 제출에는 정식 또는 RC(Release Candidate) Xcode가 필요합니다.',
} as const;

interface XcodeEvidence {
  file: string;
  /** What was found, as written in the file (for the report). */
  raw: string;
  /** Xcode major version, when the evidence names one. */
  major?: number;
  beta: boolean;
  /** From the repository root, outside the scanned --path: it may build a different app, so it never decides. */
  outside?: boolean;
}

function xcodeEvidence(file: string, raw: string, version: string): XcodeEvidence {
  // Accepts `26.2`, `v26.2`, `Xcode_26.0`, `xcode-26`, `26.0-beta`.
  const major = version.replace(/^\s*xcode[\s_-]?/i, '').match(/^\D{0,3}?(\d+)(?:\.\d+)*/)?.[1];
  return {
    file,
    raw: raw.trim(),
    major: major ? Number.parseInt(major, 10) : undefined,
    beta: /beta/i.test(version),
  };
}

function easXcodeEvidence(file: ProjectFile): XcodeEvidence[] {
  let json: unknown;
  try {
    json = JSON.parse(file.text);
  } catch {
    return [];
  }
  const build = (json as { build?: unknown })?.build;
  if (!build || typeof build !== 'object') return [];
  const profiles = new Map(Object.entries(build as Record<string, unknown>)
    .filter((entry): entry is [string, Record<string, unknown>] => Boolean(entry[1]) && typeof entry[1] === 'object'));

  // A profile inherits everything from its `extends` chain; `ios` is merged one level deep.
  function effective(name: string, seen = new Set<string>()): Record<string, unknown> {
    const profile = profiles.get(name);
    if (!profile || seen.has(name)) return {};
    seen.add(name);
    const parent = typeof profile.extends === 'string' ? effective(profile.extends, seen) : {};
    const parentIos = parent.ios && typeof parent.ios === 'object' ? parent.ios as Record<string, unknown> : {};
    const ownIos = profile.ios && typeof profile.ios === 'object' ? profile.ios as Record<string, unknown> : {};
    return { ...parent, ...profile, ios: { ...parentIos, ...ownIos } };
  }

  // Profiles that other profiles extend are shared bases, not builds of their own.
  const bases = new Set([...profiles.values()]
    .map((profile) => profile.extends)
    .filter((value): value is string => typeof value === 'string'));
  const storeProfiles = [...profiles.keys()]
    .filter((name) => !bases.has(name))
    .map((name) => [name, effective(name)] as const)
    .filter(([, profile]) => {
      const ios = profile.ios as Record<string, unknown>;
      return profile.developmentClient !== true
        && profile.distribution !== 'internal'
        && ios.simulator !== true;
    });

  const result: XcodeEvidence[] = [];
  for (const [name, profile] of storeProfiles) {
    const ios = profile.ios as Record<string, unknown>;
    const image = typeof ios.image === 'string' ? ios.image : undefined;
    if (!image) {
      result.push({ file: file.relative, raw: `build.${name}: no ios.image (EAS selects the image automatically)`, beta: false });
      continue;
    }
    // EAS iOS image names embed the Xcode version, e.g. macos-sequoia-15.6-xcode-26.2. Aliases such as
    // auto, default, latest, or sdk-NN move with every Expo SDK release, so they stay unresolved.
    const xcode = image.match(/xcode-(\d+(?:\.\d+)*)/i);
    result.push(xcode
      ? xcodeEvidence(file.relative, `build.${name}.ios.image: ${image}`, xcode[1])
      : { file: file.relative, raw: `build.${name}.ios.image: ${image}`, beta: false });
  }
  return result;
}

function ciXcodeEvidence(file: ProjectFile): XcodeEvidence[] {
  const result: XcodeEvidence[] = [];
  const groovy = file.relative.endsWith('Jenkinsfile');
  const text = stripComments(file.text, { slash: groovy, hash: !groovy });
  if (file.relative.endsWith('.xcode-version')) {
    const line = text.split(/\r?\n/).map((value) => value.trim()).find(Boolean);
    if (line) result.push(xcodeEvidence(file.relative, line, line));
    return result;
  }
  // maxim-lobanov/setup-xcode and similar actions.
  for (const match of text.matchAll(/\bxcode-version:\s*['"]?([^'"\s,}]+)['"]?/g)) {
    result.push(xcodeEvidence(file.relative, match[0], match[1]));
  }
  // fastlane actions that select or assert an Xcode version.
  for (const match of text.matchAll(/\b(?:xcversion|xcodes|ensure_xcode_version)\b\s*\(?\s*version:\s*['"]([^'"]+)['"]/g)) {
    result.push(xcodeEvidence(file.relative, match[0], match[1]));
  }
  // Codemagic `environment: xcode: 16.2` (or latest / edge).
  if (/codemagic\.ya?ml$/.test(file.relative)) {
    for (const match of text.matchAll(/^\s*xcode:\s*['"]?([^'"\s]+)['"]?/gm)) {
      result.push(xcodeEvidence(file.relative, match[0], match[1]));
    }
  }
  // GitLab hosted macOS runners: `image: macos-26-xcode-26` (the image name embeds the Xcode version).
  if (file.relative.endsWith('.gitlab-ci.yml')) {
    for (const match of text.matchAll(/\bmacos-[\w.]+-xcode-(\d+(?:\.\d+)*)\b/g)) {
      result.push(xcodeEvidence(file.relative, `image: ${match[0]}`, match[1]));
    }
  }
  // xcode-select / DEVELOPER_DIR paths such as /Applications/Xcode_16.2.app or /Applications/Xcode-beta.app.
  for (const match of text.matchAll(/\/Applications\/Xcode([^/\s'"]*)\.app/g)) {
    const suffix = match[1];
    const version = suffix.match(/\d+(?:\.\d+)*/)?.[0];
    result.push(version
      ? { ...xcodeEvidence(file.relative, match[0], version), beta: /beta/i.test(suffix) }
      : { file: file.relative, raw: match[0], beta: /beta/i.test(suffix) });
  }
  // A macOS runner without an Xcode pin builds with whatever the runner image defaults to.
  if (result.length === 0 && /(?:^|\/)\.github\/workflows\//.test(file.relative)) {
    const runner = text.match(/\bruns-on:\s*['"]?(macos-[\w.-]+)/);
    if (runner) result.push({ file: file.relative, raw: `runs-on: ${runner[1]} (runner image default Xcode)`, beta: false });
  }
  return result;
}

function collectXcodeEvidence(files: ProjectFile[]): XcodeEvidence[] {
  const evidence: XcodeEvidence[] = [];
  const xcodeCloudDirs = new Set<string>();
  for (const file of files) {
    const name = path.posix.basename(file.relative);
    if (!isXcodePinFile(name, file.relative)) continue;
    if (isXcodeCloudScript(file.relative)) {
      // One row per ci_scripts/ folder: Xcode Cloud picks Xcode in the App Store Connect workflow, not in the repo.
      const dir = path.posix.dirname(file.relative);
      if (!xcodeCloudDirs.has(dir)) {
        xcodeCloudDirs.add(dir);
        evidence.push({ file: file.relative, raw: 'Xcode Cloud custom build script; the Xcode version is set in the App Store Connect workflow', beta: false, outside: file.outside });
      }
      continue;
    }
    const rows = name === 'eas.json' ? easXcodeEvidence(file) : ciXcodeEvidence(file);
    evidence.push(...rows.map((row) => ({ ...row, outside: file.outside })));
  }
  return evidence;
}

function iosSdkPolicy(now: Date) {
  const today = now.toISOString().slice(0, 10);
  const current = [...IOS_SDK_POLICY].filter((row) => row.effectiveDate <= today).at(-1);
  const refreshFrom = `${Number(IOS_SDK_POLICY.at(-1)!.effectiveDate.slice(0, 4)) + 1}-04-01`;
  return { current, scheduleCurrent: today < refreshFrom };
}

function describePins(rows: XcodeEvidence[]): string {
  const shown = rows.slice(0, 4).map((row) => `${row.file} (${row.raw})`).join('; ');
  return rows.length > 4 ? `${shown}; +${rows.length - 4}` : shown;
}

export function iosXcodeFindings(files: ProjectFile[], now: Date): ReleaseDoctorFinding[] {
  const policy = iosSdkPolicy(now);
  if (!policy.scheduleCurrent) {
    return [{
      code: 'IOS_SDK_POLICY_REFRESH_REQUIRED',
      severity: 'warning',
      title: 'App Store Xcode / SDK minimum table needs a refresh',
      detail: 'The embedded App Store Connect upload minimums are no longer current enough for a definitive result.',
      action: 'Check the current Apple SDK minimum requirement before uploading to App Store Connect.',
      sourceUrl: IOS_SDK_POLICY_SOURCE,
      ko: {
        title: 'App Store Xcode / SDK 최소 요건표 갱신 필요',
        detail: '내장된 App Store Connect 업로드 최소 요건만으로는 현재 기준을 확정할 수 없습니다.',
        action: 'App Store Connect에 업로드하기 전에 Apple의 최신 SDK 최소 요건을 확인하세요.',
      },
    }];
  }
  // Before the first recorded requirement there is no minimum to check against.
  if (!policy.current) return [];

  const { minimumXcode, sdk, effectiveDate, sourceUrl } = policy.current;
  const allEvidence = collectXcodeEvidence(files);
  // The verdict comes from evidence inside the scanned path. CI files read from the repository root (outside a
  // --path) may build another app, so they can neither make nor cancel a verdict; when they are all there is, they
  // are only cited for the user to check.
  const evidence = allEvidence.filter((row) => !row.outside);
  const outside = allEvidence.filter((row) => row.outside);
  if (evidence.length === 0 && outside.length > 0) {
    const listed = describePins(outside);
    return [{
      code: 'IOS_XCODE_UNRESOLVED',
      severity: 'info',
      title: 'The Xcode version used for iOS release builds could not be resolved locally',
      detail: `No Xcode pin was found inside the scanned path. CI files at the repository root name: ${listed}. They may build a different app, so Release Doctor does not judge from them. ${IOS_BETA_TOOLS_NOTE.en}`,
      action: `Confirm the job that archives this app uses Xcode ${minimumXcode} or later with the ${sdk} SDK (run \`xcodebuild -version\` on the build machine).`,
      file: outside[0].file,
      sourceUrl,
      ko: {
        title: 'iOS 릴리스 빌드의 Xcode 버전을 로컬에서 확정하지 못함',
        detail: `검사 경로 안에서는 Xcode 고정값을 찾지 못했습니다. 저장소 루트의 CI 파일에 있는 값: ${listed}. 다른 앱을 빌드하는 job일 수 있어 이것만으로 판정하지 않습니다. ${IOS_BETA_TOOLS_NOTE.ko}`,
        action: `이 앱을 archive하는 job이 Xcode ${minimumXcode} 이상과 ${sdk} SDK를 쓰는지 빌드 머신에서 \`xcodebuild -version\`으로 확인하세요.`,
      },
    }];
  }
  const resolved = evidence.filter((row): row is XcodeEvidence & { major: number } => row.major !== undefined);

  if (resolved.length === 0) {
    const listed = describePins(evidence);
    return [{
      code: 'IOS_XCODE_UNRESOLVED',
      severity: 'info',
      title: 'The Xcode version used for iOS release builds could not be resolved locally',
      detail: `${listed
        ? `Xcode evidence was found but names no fixed version: ${listed}.`
        : 'No pinned Xcode version was found in .xcode-version, GitHub Actions, GitLab CI, Jenkinsfile, fastlane, Codemagic, or eas.json; the build uses whatever Xcode the build machine selects.'} ${IOS_BETA_TOOLS_NOTE.en}`,
      action: `Confirm the release build uses Xcode ${minimumXcode} or later with the ${sdk} SDK (run \`xcodebuild -version\` on the build machine), or pin the version in CI.`,
      file: evidence[0]?.file,
      sourceUrl,
      ko: {
        title: 'iOS 릴리스 빌드의 Xcode 버전을 로컬에서 확정하지 못함',
        detail: `${listed
          ? `Xcode 관련 설정은 찾았지만 고정된 버전이 없습니다: ${listed}.`
          : '.xcode-version, GitHub Actions, GitLab CI, Jenkinsfile, fastlane, Codemagic, eas.json에서 고정된 Xcode 버전을 찾지 못했습니다. 빌드 머신에서 선택된 Xcode가 그대로 사용됩니다.'} ${IOS_BETA_TOOLS_NOTE.ko}`,
        action: `릴리스 빌드가 Xcode ${minimumXcode} 이상과 ${sdk} SDK를 쓰는지 빌드 머신에서 \`xcodebuild -version\`으로 확인하거나 CI에 버전을 고정하세요.`,
      },
    }];
  }

  const sorted = [...resolved].sort((left, right) => left.major - right.major);
  const below = sorted.filter((row) => row.major < minimumXcode);
  const meeting = sorted.filter((row) => row.major >= minimumXcode);
  const unresolved = evidence.filter((row) => row.major === undefined);
  const lowest = sorted[0];

  // A definite blocker needs every piece of Xcode evidence to be a resolved pin below the minimum. A newer pin, or an
  // unpinned/auto-selected build (EAS without ios.image, an unpinned macOS runner), may be the one that uploads;
  // mixed evidence usually means a compatibility job, an unused variable, or a secondary lane.
  if (below.length > 0 && meeting.length === 0 && unresolved.length === 0) {
    return [{
      code: 'IOS_XCODE_BELOW_MINIMUM',
      severity: 'blocker',
      title: `Xcode ${lowest.major} is below the App Store Connect upload minimum`,
      detail: `Since ${effectiveDate}, apps uploaded to App Store Connect must be built with Xcode ${minimumXcode} or later using the ${sdk} SDK. Every pinned Xcode found is older: ${describePins(below)}.`,
      action: `Build the release with Xcode ${minimumXcode} or later and update the pinned version in ${lowest.file}.`,
      file: lowest.file,
      sourceUrl,
      ko: {
        title: `Xcode ${lowest.major}은 App Store Connect 업로드 최소 기준 미달`,
        detail: `${effectiveDate}부터 App Store Connect에 업로드하는 앱은 Xcode ${minimumXcode} 이상과 ${sdk} SDK로 빌드해야 합니다. 감지된 Xcode 고정값이 모두 이보다 낮습니다: ${describePins(below)}.`,
        action: `Xcode ${minimumXcode} 이상으로 릴리스 빌드를 만들고 ${lowest.file}의 고정 버전을 올리세요.`,
      },
    }];
  }

  if (below.length > 0) {
    return [{
      code: 'IOS_XCODE_MIXED_PINS',
      severity: 'warning',
      title: `A pinned Xcode is below the App Store Connect upload minimum (Xcode ${minimumXcode}), next to other Xcode evidence`,
      detail: [
        `Below the minimum: ${describePins(below)}.`,
        meeting.length ? `At or above it: ${describePins(meeting)}.` : '',
        unresolved.length ? `No fixed version (auto-selected or unpinned): ${describePins(unresolved)}.` : '',
        'Release Doctor cannot tell which job or lane uploads to App Store Connect.',
      ].filter(Boolean).join(' '),
      action: `Make sure the job that archives and uploads the release uses Xcode ${minimumXcode} or later; older pins are fine only for test or compatibility jobs.`,
      file: below[0].file,
      sourceUrl,
      ko: {
        title: `다른 Xcode 근거와 함께 App Store Connect 업로드 최소 기준(Xcode ${minimumXcode}) 미달 고정값이 있음`,
        detail: [
          `기준 미달: ${describePins(below)}.`,
          meeting.length ? `기준 충족: ${describePins(meeting)}.` : '',
          unresolved.length ? `고정 버전 없음(자동 선택 또는 미고정): ${describePins(unresolved)}.` : '',
          '어느 job 또는 lane이 App Store Connect에 업로드하는지는 저장소만으로 알 수 없습니다.',
        ].filter(Boolean).join(' '),
        action: `릴리스를 archive·업로드하는 job이 Xcode ${minimumXcode} 이상을 쓰는지 확인하세요. 낮은 버전은 테스트나 호환성 job에서만 괜찮습니다.`,
      },
    }];
  }

  const beta = resolved.some((row) => row.beta);
  return [{
    code: 'IOS_XCODE_OK',
    severity: 'info',
    title: `Xcode ${lowest.major} meets the App Store Connect upload minimum`,
    detail: `The lowest pinned Xcode found is at least Xcode ${minimumXcode} (${sdk} SDK).${beta ? ` ${IOS_BETA_TOOLS_NOTE.en}` : ''}`,
    file: lowest.file,
    sourceUrl,
    ko: {
      title: `Xcode ${lowest.major}은 App Store Connect 업로드 최소 기준 충족`,
      detail: `감지된 가장 낮은 Xcode 고정 버전이 Xcode ${minimumXcode}(${sdk} SDK) 이상입니다.${beta ? ` ${IOS_BETA_TOOLS_NOTE.ko}` : ''}`,
    },
  }];
}
