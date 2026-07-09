import type { JenkinsConfig } from './config.js';
import { authHeaders, baseUrl, createItemUrl, getCrumb, jenkinsError, jobUrl } from './http.js';

export interface JenkinsJobSummary {
  name: string;
  url: string;
  /** 잡 상태 색상. 폴더는 색이 없다. */
  color?: string;
}

/**
 * 잡 목록. folder 를 주면 그 폴더 안을, 없으면 루트를 조회한다.
 * 재귀하지 않는다 (한 단계만).
 */
export async function listJobs(cfg: JenkinsConfig, folder?: string): Promise<JenkinsJobSummary[]> {
  const root = folder ? jobUrl(cfg, folder) : baseUrl(cfg);
  const res = await fetch(`${root}/api/json?tree=jobs[name,url,color]`, {
    headers: authHeaders(cfg),
  });
  if (!res.ok) throw await jenkinsError('Jenkins 잡 목록 조회 실패', res);
  const data = (await res.json()) as { jobs?: JenkinsJobSummary[] };
  return data.jobs ?? [];
}

/**
 * 404 만 "없음" 으로 본다. 401/403/500 을 없음으로 삼키면 upsertJob 이 엉뚱하게
 * 생성 분기를 타므로, 그 경우는 원인을 드러내며 throw 한다.
 */
export async function jobExists(cfg: JenkinsConfig, jobPath: string): Promise<boolean> {
  const res = await fetch(`${jobUrl(cfg, jobPath)}/api/json?tree=name`, {
    headers: authHeaders(cfg),
  });
  if (res.ok) return true;
  if (res.status === 404) return false;
  throw await jenkinsError(`Jenkins 잡 존재 확인 실패: ${jobPath}`, res);
}

/** 잡의 config.xml 원문. 백업하거나 수정 전 현재 상태를 확인할 때 쓴다. */
export async function getJobConfig(cfg: JenkinsConfig, jobPath: string): Promise<string> {
  const res = await fetch(`${jobUrl(cfg, jobPath)}/config.xml`, {
    headers: authHeaders(cfg),
  });
  if (!res.ok) throw await jenkinsError(`Jenkins 잡 config 조회 실패: ${jobPath}`, res);
  return res.text();
}

/**
 * 새 잡 생성. 같은 이름이 이미 있으면 Jenkins 가 400 을 준다.
 * 폴더 안에 만들려면 jobPath 에 "folder/name" 을 넘긴다 (폴더는 미리 존재해야 함).
 */
export async function createJob(
  cfg: JenkinsConfig,
  jobPath: string,
  configXml: string,
): Promise<void> {
  const crumb = await getCrumb(cfg);
  const res = await fetch(createItemUrl(cfg, jobPath), {
    method: 'POST',
    headers: {
      ...authHeaders(cfg),
      'Content-Type': 'application/xml',
      ...crumb,
    },
    body: configXml,
  });
  if (!res.ok) throw await jenkinsError(`Jenkins 잡 생성 실패: ${jobPath}`, res);
}

/** 기존 잡의 config.xml 교체. 잡이 없으면 404. */
export async function updateJob(
  cfg: JenkinsConfig,
  jobPath: string,
  configXml: string,
): Promise<void> {
  const crumb = await getCrumb(cfg);
  const res = await fetch(`${jobUrl(cfg, jobPath)}/config.xml`, {
    method: 'POST',
    headers: {
      ...authHeaders(cfg),
      'Content-Type': 'application/xml',
      ...crumb,
    },
    body: configXml,
  });
  if (!res.ok) throw await jenkinsError(`Jenkins 잡 수정 실패: ${jobPath}`, res);
}

/** 있으면 수정, 없으면 생성. Jenkinsfile/job-config.xml 을 레포에서 밀어넣을 때 쓴다. */
export async function upsertJob(
  cfg: JenkinsConfig,
  jobPath: string,
  configXml: string,
): Promise<'created' | 'updated'> {
  if (await jobExists(cfg, jobPath)) {
    await updateJob(cfg, jobPath, configXml);
    return 'updated';
  }
  await createJob(cfg, jobPath, configXml);
  return 'created';
}
