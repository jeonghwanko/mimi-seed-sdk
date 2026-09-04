import type { OAuth2Client } from 'google-auth-library';
import { google } from '../lib/googleapis-lite.js';
import { getBillingInfo } from '../billing/tools.js';

const FREE_DAILY_FETCHES = 100_000;
const FIRST_PAID_TIER_END = 10_000_000;
const REMOTE_CONFIG_BASE = 'https://firebaseremoteconfig.googleapis.com/v1';

interface OptionalResult<T> {
  available: boolean;
  data?: T;
  error?: string;
}

interface RemoteConfigTemplate {
  parameters?: Record<string, unknown>;
  parameterGroups?: Record<string, unknown>;
  conditions?: unknown[];
  version?: {
    versionNumber?: string;
    updateTime?: string;
    updateUser?: { email?: string };
    updateOrigin?: string;
    updateType?: string;
  };
}

interface ExperimentList {
  experiments?: Array<{
    name?: string;
    state?: string;
    startTime?: string;
    endTime?: string;
    lastUpdateTime?: string;
    definition?: unknown;
  }>;
  nextPageToken?: string;
}

interface RolloutList {
  rollouts?: Array<{
    name?: string;
    state?: string;
    startTime?: string;
    endTime?: string;
    lastUpdateTime?: string;
    definition?: unknown;
  }>;
  nextPageToken?: string;
}

interface PagedItems<T> {
  items: T[];
  pages: number;
  truncated: boolean;
}

export function countStates(items: Array<{ state?: string }>): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const item of items) {
    const state = item.state ?? 'UNSPECIFIED';
    counts[state] = (counts[state] ?? 0) + 1;
  }
  return counts;
}

async function optionalRequest<T>(auth: OAuth2Client, url: string): Promise<OptionalResult<T>> {
  try {
    const response = await auth.request<T>({ url });
    return { available: true, data: response.data };
  } catch (error) {
    return {
      available: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function optionalPagedRequest<T>(
  auth: OAuth2Client,
  url: string,
  field: 'experiments' | 'rollouts',
): Promise<OptionalResult<PagedItems<T>>> {
  try {
    const items: T[] = [];
    let pageToken: string | undefined;
    let pages = 0;
    do {
      const requestUrl = new URL(url);
      requestUrl.searchParams.set('pageSize', '100');
      if (pageToken) requestUrl.searchParams.set('pageToken', pageToken);
      const response = await auth.request<ExperimentList | RolloutList>({ url: requestUrl.toString() });
      const data = response.data as Record<string, unknown>;
      items.push(...((data[field] as T[] | undefined) ?? []));
      pageToken = data.nextPageToken as string | undefined;
      pages += 1;
    } while (pageToken && pages < 10);
    return { available: true, data: { items, pages, truncated: Boolean(pageToken) } };
  } catch (error) {
    return {
      available: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function numericPoint(point: { value?: { int64Value?: string | null; doubleValue?: number | null } }): number {
  const raw = point.value?.int64Value ?? point.value?.doubleValue ?? 0;
  const value = typeof raw === 'string' ? Number.parseInt(raw, 10) : raw;
  return Number.isFinite(value) ? value : 0;
}

export function estimateRemoteConfigDailyCost(fetches: number): number {
  if (fetches <= FREE_DAILY_FETCHES) return 0;
  const firstPaid = Math.min(fetches, FIRST_PAID_TIER_END) - FREE_DAILY_FETCHES;
  const secondPaid = Math.max(0, fetches - FIRST_PAID_TIER_END);
  return firstPaid * 0.000006 + secondPaid * 0.000001;
}

export function remoteConfigUsageLevel(fetches: number): 'ok' | 'warning' | 'critical' {
  const ratio = fetches / FREE_DAILY_FETCHES;
  if (ratio >= 1) return 'critical';
  if (ratio >= 0.8) return 'warning';
  return 'ok';
}

async function fetchDailyUsage(
  auth: OAuth2Client,
  projectId: string,
  days: number,
): Promise<OptionalResult<Array<{ date: string; fetches: number }>>> {
  try {
    const end = new Date();
    const start = new Date(end.getTime() - days * 86_400_000);
    const monitoring = google.monitoring('v3');
    const response = await monitoring.projects.timeSeries.list({
      auth,
      name: `projects/${projectId}`,
      filter: 'metric.type="firebaseremoteconfig.googleapis.com/project/fetch_request_count"',
      'interval.startTime': start.toISOString(),
      'interval.endTime': end.toISOString(),
      'aggregation.alignmentPeriod': '86400s',
      'aggregation.perSeriesAligner': 'ALIGN_SUM',
      'aggregation.crossSeriesReducer': 'REDUCE_SUM',
      view: 'FULL',
      pageSize: Math.max(days + 2, 10),
    });
    const points = (response.data.timeSeries ?? [])
      .flatMap((series) => series.points ?? [])
      .map((point) => ({
        date: (point.interval?.endTime ?? end.toISOString()).slice(0, 10),
        fetches: numericPoint(point),
      }));
    const byDate = new Map<string, number>();
    for (const point of points) byDate.set(point.date, (byDate.get(point.date) ?? 0) + point.fetches);
    const rows = [...byDate.entries()]
      .map(([date, fetches]) => ({ date, fetches }))
      .sort((a, b) => a.date.localeCompare(b.date));
    return { available: true, data: rows };
  } catch (error) {
    return {
      available: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function getRemoteConfigOverview(
  auth: OAuth2Client,
  input: { projectId: string; namespace?: string; days?: number },
) {
  const namespace = input.namespace ?? 'firebase';
  const days = Math.min(Math.max(input.days ?? 7, 1), 30);
  const encodedProject = encodeURIComponent(input.projectId);
  const encodedNamespace = encodeURIComponent(namespace);
  const parent = `${REMOTE_CONFIG_BASE}/projects/${encodedProject}/namespaces/${encodedNamespace}`;

  const [template, experiments, rollouts, usage, billing] = await Promise.all([
    optionalRequest<RemoteConfigTemplate>(
      auth,
      `${parent}/remoteConfig`,
    ),
    optionalPagedRequest<NonNullable<ExperimentList['experiments']>[number]>(
      auth,
      `${parent}/experiments`,
      'experiments',
    ),
    optionalPagedRequest<NonNullable<RolloutList['rollouts']>[number]>(
      auth,
      `${parent}/rollouts`,
      'rollouts',
    ),
    fetchDailyUsage(auth, input.projectId, days),
    getBillingInfo(auth, input.projectId)
      .then((data) => ({ available: true, data } as const))
      .catch((error: unknown) => ({
        available: false,
        error: error instanceof Error ? error.message : String(error),
      } as const)),
  ]);

  const daily = usage.data ?? [];
  const latest = daily.at(-1);
  const peak = daily.reduce<typeof daily[number] | undefined>(
    (current, point) => !current || point.fetches > current.fetches ? point : current,
    undefined,
  );
  const withUsageProjection = (point: typeof daily[number]) => ({
    ...point,
    utilizationPercent: Number(((point.fetches / FREE_DAILY_FETCHES) * 100).toFixed(2)),
    level: remoteConfigUsageLevel(point.fetches),
    projectedStandardDailyCostUsd: Number(estimateRemoteConfigDailyCost(point.fetches).toFixed(4)),
  });
  const summarizeExperiment = (item: NonNullable<ExperimentList['experiments']>[number]) => ({
    name: item.name,
    displayName: (item.definition as { displayName?: string } | undefined)?.displayName,
    state: item.state,
    startTime: item.startTime,
    endTime: item.endTime,
    lastUpdateTime: item.lastUpdateTime,
  });
  const summarizeRollout = (item: NonNullable<RolloutList['rollouts']>[number]) => ({
    name: item.name,
    displayName: (item.definition as { displayName?: string } | undefined)?.displayName,
    state: item.state,
    startTime: item.startTime,
    endTime: item.endTime,
    lastUpdateTime: item.lastUpdateTime,
  });
  const activeExperiments = experiments.data?.items
    .filter((item) => item.state === 'RUNNING')
    .map(summarizeExperiment) ?? [];
  const activeRollouts = rollouts.data?.items
    .filter((item) => item.state === 'RUNNING')
    .map(summarizeRollout) ?? [];
  const recentExperiments = [...(experiments.data?.items ?? [])]
    .sort((left, right) => (right.lastUpdateTime ?? right.endTime ?? right.startTime ?? '')
      .localeCompare(left.lastUpdateTime ?? left.endTime ?? left.startTime ?? ''))
    .slice(0, 20)
    .map(summarizeExperiment);
  const recentRollouts = [...(rollouts.data?.items ?? [])]
    .sort((left, right) => (right.lastUpdateTime ?? right.endTime ?? right.startTime ?? '')
      .localeCompare(left.lastUpdateTime ?? left.endTime ?? left.startTime ?? ''))
    .slice(0, 20)
    .map(summarizeRollout);

  return {
    projectId: input.projectId,
    namespace,
    pricingPolicy: {
      effectiveDate: '2026-09-01',
      noCostDailyFetches: FREE_DAILY_FETCHES,
      firstPaidTier: { from: 100_001, to: FIRST_PAID_TIER_END, usdPerRequest: 0.000006 },
      secondPaidTier: { from: FIRST_PAID_TIER_END + 1, usdPerRequest: 0.000001 },
      transitionNotice: 'Existing projects can have a plan-specific transition grace period; this tool reports projected standard pricing and does not infer whether a grace period applies.',
      sourceUrl: 'https://firebase.google.com/docs/remote-config/pricing',
    },
    billing: billing.available
      ? {
          available: true,
          plan: billing.data.billingEnabled ? 'blaze' : 'spark',
          billingEnabled: billing.data.billingEnabled,
        }
      : billing,
    usage: usage.available
      ? {
          available: true,
          metric: 'firebaseremoteconfig.googleapis.com/project/fetch_request_count',
          days: daily,
          latest: latest ? withUsageProjection(latest) : null,
          peak: peak ? withUsageProjection(peak) : null,
        }
      : usage,
    template: template.available
      ? {
          available: true,
          version: template.data?.version ?? null,
          parameterCount: Object.keys(template.data?.parameters ?? {}).length,
          parameterGroupCount: Object.keys(template.data?.parameterGroups ?? {}).length,
          conditionCount: template.data?.conditions?.length ?? 0,
        }
      : template,
    experiments: experiments.available
      ? {
          available: true,
          total: experiments.data?.items.length ?? 0,
          stateCounts: countStates(experiments.data?.items ?? []),
          active: activeExperiments,
          recent: recentExperiments,
          pages: experiments.data?.pages ?? 0,
          truncated: experiments.data?.truncated ?? false,
        }
      : experiments,
    rollouts: rollouts.available
      ? {
          available: true,
          total: rollouts.data?.items.length ?? 0,
          stateCounts: countStates(rollouts.data?.items ?? []),
          active: activeRollouts,
          recent: recentRollouts,
          pages: rollouts.data?.pages ?? 0,
          truncated: rollouts.data?.truncated ?? false,
        }
      : rollouts,
    warnings: [
      ...(peak && remoteConfigUsageLevel(peak.fetches) !== 'ok'
        ? [`Peak daily fetch usage is ${remoteConfigUsageLevel(peak.fetches)} at ${peak.fetches.toLocaleString()} requests on ${peak.date}.`]
        : []),
      ...(peak && peak.fetches >= FREE_DAILY_FETCHES && billing.available && !billing.data.billingEnabled
        ? ['Spark projects risk throttling above 100,000 daily fetches after the applicable grace period; upgrade to Blaze for uninterrupted overage.']
        : []),
      ...(!usage.available ? ['Cloud Monitoring usage is unavailable; no fetch count was estimated.'] : []),
      ...(!billing.available ? ['Billing plan could not be verified; cost/throttling interpretation is incomplete.'] : []),
      ...(experiments.data?.truncated ? ['Experiment list exceeded 1,000 items and was truncated.'] : []),
      ...(rollouts.data?.truncated ? ['Rollout list exceeded 1,000 items and was truncated.'] : []),
    ],
  };
}
