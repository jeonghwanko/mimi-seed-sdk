import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as jobs from '../jenkins/jobs.js';
import { createItemUrl, jobUrl } from '../jenkins/http.js';
import type { JenkinsConfig } from '../jenkins/config.js';

const cfg: JenkinsConfig = {
  url: 'https://jenkins.example.com',
  username: 'admin',
  token: 'tok',
};

// 뒤에 슬래시가 붙은 URL 도 같은 결과를 내야 한다.
const trailingSlashCfg: JenkinsConfig = { ...cfg, url: 'https://jenkins.example.com/' };

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  globalThis.fetch = fetchMock as unknown as typeof fetch;
});

afterEach(() => {
  vi.restoreAllMocks();
});

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function textResponse(body: string, status = 200): Response {
  return new Response(body, { status });
}

/** getCrumb 이 첫 fetch 를 소비한다. 쓰기 계열 테스트는 이걸 먼저 큐잉해야 한다. */
function mockCrumb() {
  fetchMock.mockResolvedValueOnce(
    jsonResponse({ crumbRequestField: 'Jenkins-Crumb', crumb: 'abc123' }),
  );
}

describe('http.ts — URL 계산', () => {
  it('루트 잡의 URL', () => {
    expect(jobUrl(cfg, 'penguinrun')).toBe('https://jenkins.example.com/job/penguinrun');
  });

  it('폴더 안 잡은 세그먼트마다 /job/ 이 붙는다', () => {
    expect(jobUrl(cfg, 'vir-game/client')).toBe(
      'https://jenkins.example.com/job/vir-game/job/client',
    );
  });

  it('URL 끝의 슬래시를 정규화한다', () => {
    expect(jobUrl(trailingSlashCfg, 'penguinrun')).toBe(
      'https://jenkins.example.com/job/penguinrun',
    );
  });

  it('특수문자는 세그먼트 단위로 인코딩된다', () => {
    expect(jobUrl(cfg, 'my job')).toBe('https://jenkins.example.com/job/my%20job');
  });

  it('createItem 은 루트 잡이면 Jenkins 루트에 POST 한다', () => {
    expect(createItemUrl(cfg, 'penguinrun')).toBe(
      'https://jenkins.example.com/createItem?name=penguinrun',
    );
  });

  it('createItem 은 폴더 안 잡이면 부모 폴더에 POST 하고 leaf 만 name 으로 넘긴다', () => {
    expect(createItemUrl(cfg, 'vir-game/client')).toBe(
      'https://jenkins.example.com/job/vir-game/createItem?name=client',
    );
  });

  it('빈 잡 이름은 거부한다', () => {
    expect(() => jobUrl(cfg, '')).toThrow(/비어/);
    expect(() => createItemUrl(cfg, '/')).toThrow(/비어/);
  });
});

describe('listJobs', () => {
  it('루트를 조회하고 jobs 배열을 반환한다', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ jobs: [{ name: 'penguinrun', url: 'u', color: 'blue' }] }),
    );
    const list = await jobs.listJobs(cfg);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://jenkins.example.com/api/json?tree=jobs[name,url,color]',
      expect.any(Object),
    );
    expect(list).toEqual([{ name: 'penguinrun', url: 'u', color: 'blue' }]);
  });

  it('folder 를 주면 폴더 URL 을 조회한다', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ jobs: [] }));
    await jobs.listJobs(cfg, 'vir-game');
    expect(fetchMock).toHaveBeenCalledWith(
      'https://jenkins.example.com/job/vir-game/api/json?tree=jobs[name,url,color]',
      expect.any(Object),
    );
  });

  it('jobs 키가 없으면 빈 배열', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({}));
    expect(await jobs.listJobs(cfg)).toEqual([]);
  });

  it('실패하면 상태코드와 본문을 담아 throw', async () => {
    fetchMock.mockResolvedValueOnce(textResponse('nope', 500));
    await expect(jobs.listJobs(cfg)).rejects.toThrow(/조회 실패 \(500\): nope/);
  });
});

describe('jobExists', () => {
  it('200 이면 true', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ name: 'penguinrun' }));
    expect(await jobs.jobExists(cfg, 'penguinrun')).toBe(true);
  });

  it('404 면 false', async () => {
    fetchMock.mockResolvedValueOnce(textResponse('not found', 404));
    expect(await jobs.jobExists(cfg, 'penguinrun')).toBe(false);
  });

  it('401/500 은 "없음" 으로 삼키지 않고 throw 한다', async () => {
    fetchMock.mockResolvedValueOnce(textResponse('bad credentials', 401));
    await expect(jobs.jobExists(cfg, 'penguinrun')).rejects.toThrow(
      /존재 확인 실패: penguinrun \(401\): bad credentials/,
    );

    fetchMock.mockResolvedValueOnce(textResponse('boom', 500));
    await expect(jobs.jobExists(cfg, 'penguinrun')).rejects.toThrow(/\(500\): boom/);
  });
});

describe('getJobConfig', () => {
  it('config.xml 원문을 그대로 반환한다', async () => {
    fetchMock.mockResolvedValueOnce(textResponse('<flow-definition/>'));
    const xml = await jobs.getJobConfig(cfg, 'penguinrun');
    expect(fetchMock).toHaveBeenCalledWith(
      'https://jenkins.example.com/job/penguinrun/config.xml',
      expect.any(Object),
    );
    expect(xml).toBe('<flow-definition/>');
  });

  it('404 면 잡 이름을 담아 throw', async () => {
    fetchMock.mockResolvedValueOnce(textResponse('missing', 404));
    await expect(jobs.getJobConfig(cfg, 'ghost')).rejects.toThrow(/ghost.*404/s);
  });
});

describe('createJob', () => {
  it('createItem 에 XML 을 POST 하고 crumb 을 함께 보낸다', async () => {
    mockCrumb();
    fetchMock.mockResolvedValueOnce(textResponse('', 200));

    await jobs.createJob(cfg, 'penguinrun', '<flow-definition/>');

    const [url, init] = fetchMock.mock.calls[1];
    expect(url).toBe('https://jenkins.example.com/createItem?name=penguinrun');
    expect(init.method).toBe('POST');
    expect(init.body).toBe('<flow-definition/>');
    expect(init.headers['Content-Type']).toBe('application/xml');
    expect(init.headers['Jenkins-Crumb']).toBe('abc123');
    expect(init.headers['Authorization']).toMatch(/^Basic /);
  });

  it('crumb issuer 가 없어도(404) 그냥 진행한다', async () => {
    fetchMock.mockResolvedValueOnce(textResponse('no crumb', 404));
    fetchMock.mockResolvedValueOnce(textResponse('', 200));

    await expect(jobs.createJob(cfg, 'penguinrun', '<x/>')).resolves.toBeUndefined();
    const [, init] = fetchMock.mock.calls[1];
    expect(init.headers['Jenkins-Crumb']).toBeUndefined();
  });

  it('이미 존재하면 Jenkins 400 본문을 에러에 담는다', async () => {
    mockCrumb();
    fetchMock.mockResolvedValueOnce(textResponse('A job already exists with the name', 400));
    await expect(jobs.createJob(cfg, 'penguinrun', '<x/>')).rejects.toThrow(
      /생성 실패: penguinrun \(400\): A job already exists/,
    );
  });
});

describe('updateJob', () => {
  it('기존 잡의 config.xml 에 POST 한다', async () => {
    mockCrumb();
    fetchMock.mockResolvedValueOnce(textResponse('', 200));

    await jobs.updateJob(cfg, 'vir-game/client', '<flow-definition/>');

    const [url, init] = fetchMock.mock.calls[1];
    expect(url).toBe('https://jenkins.example.com/job/vir-game/job/client/config.xml');
    expect(init.method).toBe('POST');
    expect(init.body).toBe('<flow-definition/>');
  });

  it('잡이 없으면 throw', async () => {
    mockCrumb();
    fetchMock.mockResolvedValueOnce(textResponse('not found', 404));
    await expect(jobs.updateJob(cfg, 'ghost', '<x/>')).rejects.toThrow(
      /수정 실패: ghost \(404\): not found/,
    );
  });
});

describe('upsertJob', () => {
  it('존재하면 update 경로를 탄다', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ name: 'penguinrun' })); // jobExists
    mockCrumb();
    fetchMock.mockResolvedValueOnce(textResponse('', 200)); // updateJob

    expect(await jobs.upsertJob(cfg, 'penguinrun', '<x/>')).toBe('updated');
    expect(fetchMock.mock.calls[2][0]).toBe(
      'https://jenkins.example.com/job/penguinrun/config.xml',
    );
  });

  it('없으면 create 경로를 탄다', async () => {
    fetchMock.mockResolvedValueOnce(textResponse('nf', 404)); // jobExists
    mockCrumb();
    fetchMock.mockResolvedValueOnce(textResponse('', 200)); // createJob

    expect(await jobs.upsertJob(cfg, 'penguinrun', '<x/>')).toBe('created');
    expect(fetchMock.mock.calls[2][0]).toBe(
      'https://jenkins.example.com/createItem?name=penguinrun',
    );
  });
});
