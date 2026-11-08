// Release Doctor Firebase Cloud Messaging legacy API / firebase-admin topic check.
// Internal to Release Doctor — import the public API (scanReleaseDoctor, report types) from ../release-doctor.js.

import path from 'node:path';
import { lockedPackageVersion, lockfileDirectories, readText } from '../lockfile.js';
import type { ProjectFile, ReleaseDoctorFinding } from './types.js';
import { unique } from './util.js';

// Firebase Cloud Messaging legacy surfaces.
// - Legacy HTTP/XMPP send (fcm/send) was deprecated 2023-06-20 and shut down from 2024-07-22; the replacement is
//   the HTTP v1 API.
// - Instance ID server APIs (iid.googleapis.com, incl. legacy topic management) and device group management
//   (fcm.googleapis.com/fcm/notification and its aliases) are decommissioned 2027-09-29 (FCM troubleshooting FAQ).
// - firebase-admin (Node) 14.5.0 moved subscribeToTopic/unsubscribeFromTopic off Instance ID onto the FCM v1 topic
//   subscription API and added deprecated *Legacy escape hatches that still use Instance ID. The FAQ lists Node
//   Admin SDK <= 14.4.0 as impacted. firebase-admin 14.x declares engines.node >= 22.
const FCM_LEGACY_SEND_SOURCE = 'https://firebase.google.com/docs/cloud-messaging/send/v1-api';

const FCM_DEPRECATION_SOURCE = 'https://firebase.google.com/docs/cloud-messaging/troubleshooting#fcm-26-deprecation';

const FCM_INSTANCE_ID_DECOMMISSION = '2027-09-29';

const FIREBASE_ADMIN_TOPICS_SOURCE = 'https://github.com/firebase/firebase-admin-node/releases/tag/v14.5.0';

const FIREBASE_ADMIN_TOPICS_VERSION = [14, 5, 0] as const;

const FIREBASE_ADMIN_14_NODE = '22';

const FCM_LEGACY_SEND = /\b(?:fcm\.googleapis\.com\/fcm\/send|gcm-http\.googleapis\.com\/gcm\/send)\b/;

const FCM_INSTANCE_ID = /\biid\.googleapis\.com\b/;

const FCM_DEVICE_GROUP = /\bfcm\.googleapis\.com\/(?:fcm\/|gcm\/|iid\/)?notification\b/;

const FCM_LEGACY_TOPIC_METHOD = /\b(?:subscribeToTopicLegacy|unsubscribeFromTopicLegacy)\b/;

export const FCM_HINT = new RegExp([FCM_LEGACY_SEND, FCM_INSTANCE_ID, FCM_DEVICE_GROUP, FCM_LEGACY_TOPIC_METHOD]
  .map((re) => re.source).join('|'));

function compareVersions(left: readonly number[], right: readonly number[]): number {
  for (let index = 0; index < Math.max(left.length, right.length); index++) {
    const difference = (left[index] ?? 0) - (right[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

function parseExactVersion(value: string): number[] | undefined {
  const match = value.trim().match(/^v?(\d+)\.(\d+)\.(\d+)/);
  return match ? match.slice(1, 4).map((part) => Number.parseInt(part, 10)) : undefined;
}

/**
 * True when no version allowed by the npm range reaches `target` (its highest satisfiable version is lower),
 * false when some allowed version reaches it, undefined when the range is not a plain semver range.
 */
function rangeStaysBelow(range: string, target: readonly number[]): boolean | undefined {
  const alternatives = range.split('||').map((part) => part.trim());
  for (const alternative of alternatives) {
    if (alternative === '' || alternative === '*' || /^(?:x|X|latest)$/.test(alternative)) return false;
    let upper: { version: number[]; inclusive: boolean } | undefined;
    const tighten = (candidate: { version: number[]; inclusive: boolean }) => {
      if (!upper || compareVersions(candidate.version, upper.version) < 0) upper = candidate;
    };
    const hyphen = alternative.match(/^(\S+)\s+-\s+(\S+)$/);
    const comparators = hyphen
      ? [`>=${hyphen[1]}`, `<=${hyphen[2]}`]
      : alternative.replace(/(>=|<=|>|<|=|\^|~)\s+/g, '$1').split(/\s+/);
    for (const comparator of comparators) {
      const match = comparator.match(/^(\^|~|>=|<=|>|<|=|v)?(\d+|[xX*])(?:\.(\d+|[xX*]))?(?:\.(\d+|[xX*]))?(?:[-+][\w.-]*)?$/);
      if (!match) return undefined;
      const [, operator = '', majorPart, minorPart, patchPart] = match;
      const wild = (part?: string) => part === undefined || /^[xX*]$/.test(part);
      if (wild(majorPart)) {
        if (operator === '<' || operator === '<=') return undefined;
        continue;
      }
      const major = Number.parseInt(majorPart, 10);
      const minor = wild(minorPart) ? undefined : Number.parseInt(minorPart, 10);
      const patch = wild(patchPart) ? undefined : Number.parseInt(patchPart, 10);
      const partialCeiling = () => minor === undefined
        ? { version: [major + 1, 0, 0], inclusive: false }
        : patch === undefined
          ? { version: [major, minor + 1, 0], inclusive: false }
          : { version: [major, minor, patch], inclusive: true };
      if (operator === '>' || operator === '>=') continue;
      if (operator === '<') tighten({ version: [major, minor ?? 0, patch ?? 0], inclusive: false });
      else if (operator === '<=' || operator === '' || operator === '=' || operator === 'v') tighten(partialCeiling());
      else if (operator === '~') tighten(minor === undefined ? partialCeiling() : { version: [major, minor + 1, 0], inclusive: false });
      else if (operator === '^') {
        tighten(major > 0 || minor === undefined
          ? { version: [major + 1, 0, 0], inclusive: false }
          : minor > 0 || patch === undefined
            ? { version: [0, minor + 1, 0], inclusive: false }
            : { version: [0, 0, patch + 1], inclusive: false });
      }
    }
    if (!upper) return false;
    const reaches = upper.inclusive
      ? compareVersions(upper.version, target) >= 0
      : compareVersions(upper.version, target) > 0;
    if (reaches) return false;
  }
  return true;
}

interface FirebaseAdminEvidence {
  file: string;
  version: string;
  source: 'installed' | 'lockfile' | 'declared';
  major?: number;
}

async function firebaseAdminEvidence(files: ProjectFile[], root: string): Promise<FirebaseAdminEvidence[]> {
  const result: FirebaseAdminEvidence[] = [];
  for (const file of files.filter((candidate) => /(?:^|\/)package\.json$/.test(candidate.relative)
    && !candidate.relative.split('/').includes('node_modules'))) {
    let manifest: Record<string, unknown>;
    try {
      manifest = JSON.parse(file.text) as Record<string, unknown>;
    } catch {
      continue;
    }
    const declared = ['dependencies', 'devDependencies']
      .map((key) => manifest[key])
      .map((group) => (group && typeof group === 'object' ? (group as Record<string, unknown>)['firebase-admin'] : undefined))
      .find((value): value is string => typeof value === 'string');
    if (!declared) continue;
    const packageDir = path.dirname(file.absolute);
    // Ancestors up to the scan root, then on to the repository root (a --path into a workspace monorepo).
    const directories = await lockfileDirectories(packageDir, root);

    // 1. The installed copy (hoisted installs put it in an ancestor's node_modules).
    let resolved: FirebaseAdminEvidence | undefined;
    for (const directory of directories) {
      const text = await readText(path.join(directory, 'node_modules', 'firebase-admin', 'package.json'));
      if (!text) continue;
      try {
        const version = (JSON.parse(text) as { version?: unknown }).version;
        if (typeof version === 'string' && parseExactVersion(version)) {
          resolved = { file: file.relative, version, source: 'installed' };
          break;
        }
      } catch {
        // Keep looking.
      }
    }
    // 2. The nearest lockfile's resolution.
    if (!resolved) {
      for (const directory of directories) {
        const version = (await lockedPackageVersion('firebase-admin', packageDir, directory, declared))?.version;
        if (version && parseExactVersion(version)) {
          resolved = { file: file.relative, version, source: 'lockfile' };
          break;
        }
      }
    }
    if (resolved) {
      if (compareVersions(parseExactVersion(resolved.version)!, FIREBASE_ADMIN_TOPICS_VERSION) < 0) {
        result.push({ ...resolved, major: parseExactVersion(resolved.version)![0] });
      }
      continue;
    }
    // 3. The declared range, flagged only when no version it allows reaches 14.5.0.
    if (rangeStaysBelow(declared, FIREBASE_ADMIN_TOPICS_VERSION) === true) {
      const major = declared.match(/\d+/)?.[0];
      result.push({ file: file.relative, version: declared, source: 'declared', major: major ? Number.parseInt(major, 10) : undefined });
    }
  }
  return result;
}

function listFiles(files: ProjectFile[]): string {
  const names = unique(files.map((file) => file.relative));
  return names.length > 3 ? `${names.slice(0, 3).join(', ')} (+${names.length - 3})` : names.join(', ');
}

export async function fcmFindings(
  files: ProjectFile[],
  sources: ProjectFile[],
  root: string,
  now: Date,
): Promise<ReleaseDoctorFinding[]> {
  const findings: ReleaseDoctorFinding[] = [];
  const today = now.toISOString().slice(0, 10);
  const decommissioned = today >= FCM_INSTANCE_ID_DECOMMISSION;
  const scheduled = decommissioned ? 'decommissioned' : 'decommissions';
  const scheduledKo = decommissioned ? '종료했습니다' : '종료합니다';

  const legacySend = sources.filter((file) => FCM_LEGACY_SEND.test(file.text));
  if (legacySend.length > 0) {
    findings.push({
      code: 'FCM_LEGACY_SEND_API',
      severity: 'warning',
      title: 'Code calls the shut-down legacy FCM send endpoint',
      detail: `Found fcm/send in ${listFiles(legacySend)}. Firebase deprecated the legacy HTTP and XMPP send APIs in June 2023 and began shutting them down on 2024-07-22, so these push requests no longer deliver.`,
      action: 'Send through the FCM HTTP v1 API (projects.messages.send) or a Firebase Admin SDK instead.',
      file: legacySend[0].relative,
      sourceUrl: FCM_LEGACY_SEND_SOURCE,
      ko: {
        title: '종료된 레거시 FCM 발송 엔드포인트를 호출하는 코드',
        detail: `${listFiles(legacySend)}에서 fcm/send를 찾았습니다. Firebase는 레거시 HTTP·XMPP 발송 API를 2023년 6월 지원 중단하고 2024-07-22부터 종료했으므로 이 푸시 요청은 전달되지 않습니다.`,
        action: 'FCM HTTP v1 API(projects.messages.send) 또는 Firebase Admin SDK로 발송하세요.',
      },
    });
  }

  const instanceId = sources.filter((file) => FCM_INSTANCE_ID.test(file.text));
  if (instanceId.length > 0) {
    findings.push({
      code: 'FCM_INSTANCE_ID_API',
      severity: decommissioned ? 'warning' : 'info',
      title: decommissioned
        ? 'Code calls the decommissioned Instance ID server API'
        : 'Code calls the deprecated Instance ID server API',
      detail: `Found iid.googleapis.com in ${listFiles(instanceId)}. Firebase ${scheduled} the Instance ID server APIs (token info, legacy topic management, batch import) on ${FCM_INSTANCE_ID_DECOMMISSION}.`,
      action: 'Manage topics with the FCM topic subscription API, and validate tokens with an FCM v1 send using validate_only.',
      file: instanceId[0].relative,
      sourceUrl: FCM_DEPRECATION_SOURCE,
      ko: {
        title: decommissioned
          ? '종료된 Instance ID 서버 API를 호출하는 코드'
          : '지원 중단된 Instance ID 서버 API를 호출하는 코드',
        detail: `${listFiles(instanceId)}에서 iid.googleapis.com을 찾았습니다. Firebase는 Instance ID 서버 API(토큰 정보, 레거시 토픽 관리, 일괄 가져오기)를 ${FCM_INSTANCE_ID_DECOMMISSION}에 ${scheduledKo}.`,
        action: '토픽은 FCM 토픽 구독 API로 관리하고, 토큰 검증은 validate_only를 켠 FCM v1 발송으로 대체하세요.',
      },
    });
  }

  const deviceGroup = sources.filter((file) => FCM_DEVICE_GROUP.test(file.text));
  if (deviceGroup.length > 0) {
    findings.push({
      code: 'FCM_DEVICE_GROUP_API',
      severity: decommissioned ? 'warning' : 'info',
      title: decommissioned
        ? 'Code calls the decommissioned FCM device group management API'
        : 'Code calls the deprecated FCM device group management API',
      detail: `Found fcm/notification in ${listFiles(deviceGroup)}. Firebase ${scheduled} device group management and device group tokens on ${FCM_INSTANCE_ID_DECOMMISSION}.`,
      action: 'Send to individual registration tokens (or topics) with the FCM v1 API, following Firebase\'s guide for migrating off device groups.',
      file: deviceGroup[0].relative,
      sourceUrl: FCM_DEPRECATION_SOURCE,
      ko: {
        title: decommissioned
          ? '종료된 FCM 기기 그룹 관리 API를 호출하는 코드'
          : '지원 중단된 FCM 기기 그룹 관리 API를 호출하는 코드',
        detail: `${listFiles(deviceGroup)}에서 fcm/notification을 찾았습니다. Firebase는 기기 그룹 관리와 기기 그룹 토큰을 ${FCM_INSTANCE_ID_DECOMMISSION}에 ${scheduledKo}.`,
        action: 'Firebase의 기기 그룹 이전 가이드에 따라 FCM v1 API로 개별 등록 토큰(또는 토픽)에 발송하세요.',
      },
    });
  }

  const legacyTopic = sources.filter((file) => FCM_LEGACY_TOPIC_METHOD.test(file.text));
  if (legacyTopic.length > 0) {
    findings.push({
      code: 'FCM_LEGACY_TOPIC_METHODS',
      severity: decommissioned ? 'warning' : 'info',
      title: 'Code uses the deprecated firebase-admin *Legacy topic methods',
      detail: `Found subscribeToTopicLegacy / unsubscribeFromTopicLegacy in ${listFiles(legacyTopic)}. These escape hatches keep using the Instance ID API, which Firebase ${scheduled} on ${FCM_INSTANCE_ID_DECOMMISSION}.`,
      action: 'Call subscribeToTopic / unsubscribeFromTopic instead; since firebase-admin 14.5.0 they use the FCM v1 topic subscription API.',
      file: legacyTopic[0].relative,
      sourceUrl: FIREBASE_ADMIN_TOPICS_SOURCE,
      ko: {
        title: '지원 중단된 firebase-admin *Legacy 토픽 메서드를 사용하는 코드',
        detail: `${listFiles(legacyTopic)}에서 subscribeToTopicLegacy / unsubscribeFromTopicLegacy를 찾았습니다. 이 메서드는 Instance ID API를 계속 사용하며, Firebase는 이 API를 ${FCM_INSTANCE_ID_DECOMMISSION}에 ${scheduledKo}.`,
        action: 'subscribeToTopic / unsubscribeFromTopic을 사용하세요. firebase-admin 14.5.0부터 FCM v1 토픽 구독 API를 사용합니다.',
      },
    });
  }

  const outdated = await firebaseAdminEvidence(files, root);
  if (outdated.length > 0) {
    const first = outdated[0];
    const sourceLabel = { installed: 'installed', lockfile: 'lockfile', declared: 'declared range' }[first.source];
    const sourceLabelKo = { installed: '설치됨', lockfile: 'lockfile', declared: '선언 범위' }[first.source];
    const nodeNote = first.major !== undefined && first.major < 14;
    findings.push({
      code: 'FIREBASE_ADMIN_LEGACY_TOPIC_TRANSPORT',
      severity: decommissioned ? 'warning' : 'info',
      title: 'firebase-admin before 14.5.0 manages topics through the Instance ID API',
      detail: `${first.file} uses firebase-admin ${first.version} (${sourceLabel}). From 14.5.0, subscribeToTopic / unsubscribeFromTopic use the FCM v1 topic subscription API; earlier versions call the Instance ID API, which Firebase ${scheduled} on ${FCM_INSTANCE_ID_DECOMMISSION}. Only topic subscription calls are affected.`,
      action: `Upgrading firebase-admin to 14.5.0 or later is the migration; the method names stay the same. Run your topic subscription tests after upgrading.${nodeNote ? ` firebase-admin 14 requires Node.js ${FIREBASE_ADMIN_14_NODE} or later.` : ''}`,
      file: first.file,
      sourceUrl: FCM_DEPRECATION_SOURCE,
      ko: {
        title: 'firebase-admin 14.5.0 이전 버전은 Instance ID API로 토픽을 관리함',
        detail: `${first.file}의 firebase-admin 버전은 ${first.version}(${sourceLabelKo})입니다. 14.5.0부터 subscribeToTopic / unsubscribeFromTopic은 FCM v1 토픽 구독 API를 쓰고, 이전 버전은 Instance ID API를 호출합니다. Firebase는 이 API를 ${FCM_INSTANCE_ID_DECOMMISSION}에 ${scheduledKo}. 토픽 구독 호출만 영향을 받습니다.`,
        action: `firebase-admin을 14.5.0 이상으로 올리는 것이 마이그레이션입니다. 메서드 이름은 그대로이며, 업그레이드 후 토픽 구독 테스트를 실행하세요.${nodeNote ? ` firebase-admin 14는 Node.js ${FIREBASE_ADMIN_14_NODE} 이상이 필요합니다.` : ''}`,
      },
    });
  }

  return findings;
}
