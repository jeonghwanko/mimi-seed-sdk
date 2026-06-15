import type { JenkinsConfig } from './config.js';

export interface JenkinsCredentialSummary {
  id: string;
  displayName: string;
  typeName: string;
}

function basicAuth(username: string, token: string): string {
  return 'Basic ' + Buffer.from(`${username}:${token}`).toString('base64');
}

function credentialsBase(url: string): string {
  return `${url.replace(/\/$/, '')}/credentials/store/system/domain/_`;
}

async function credentialExists(cfg: JenkinsConfig, id: string): Promise<boolean> {
  const res = await fetch(`${credentialsBase(cfg.url)}/${encodeURIComponent(id)}/api/json`, {
    headers: { Authorization: basicAuth(cfg.username, cfg.token) },
  });
  return res.ok;
}

export async function listCredentials(cfg: JenkinsConfig): Promise<JenkinsCredentialSummary[]> {
  const res = await fetch(`${credentialsBase(cfg.url)}/api/json?depth=1`, {
    headers: { Authorization: basicAuth(cfg.username, cfg.token) },
  });
  if (!res.ok) throw new Error(`Jenkins credentials 조회 실패 (${res.status})`);
  const data = (await res.json()) as {
    credentials?: Array<{ id: string; displayName: string; typeName: string }>;
  };
  return (data.credentials ?? []).map((c) => ({
    id: c.id,
    displayName: c.displayName,
    typeName: c.typeName,
  }));
}

export async function upsertSecretText(
  cfg: JenkinsConfig,
  id: string,
  secret: string,
  description = '',
): Promise<'created' | 'updated'> {
  const payload = JSON.stringify({
    '': '0',
    credentials: {
      scope: 'GLOBAL',
      id,
      description,
      secret,
      'stapler-class': 'org.jenkinsci.plugins.plaincredentials.impl.StringCredentialsImpl',
      '$class': 'org.jenkinsci.plugins.plaincredentials.impl.StringCredentialsImpl',
    },
  });
  const base = credentialsBase(cfg.url);
  const exists = await credentialExists(cfg, id);
  const endpoint = exists
    ? `${base}/${encodeURIComponent(id)}/updateSubmit`
    : `${base}/createCredentials`;

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: basicAuth(cfg.username, cfg.token),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ json: payload }).toString(),
  });
  if (!res.ok && res.status !== 302) {
    throw new Error(`Jenkins credential ${exists ? 'update' : 'create'} 실패 (${res.status})`);
  }
  return exists ? 'updated' : 'created';
}

export async function upsertSecretFile(
  cfg: JenkinsConfig,
  id: string,
  fileBase64: string,
  fileName: string,
  description = '',
): Promise<'created' | 'updated'> {
  const payload = JSON.stringify({
    '': '0',
    credentials: {
      scope: 'GLOBAL',
      id,
      description,
      fileName,
      secretBytes: fileBase64,
      'stapler-class': 'org.jenkinsci.plugins.plaincredentials.impl.FileCredentialsImpl',
      '$class': 'org.jenkinsci.plugins.plaincredentials.impl.FileCredentialsImpl',
    },
  });
  const base = credentialsBase(cfg.url);
  const exists = await credentialExists(cfg, id);
  const endpoint = exists
    ? `${base}/${encodeURIComponent(id)}/updateSubmit`
    : `${base}/createCredentials`;

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: basicAuth(cfg.username, cfg.token),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ json: payload }).toString(),
  });
  if (!res.ok && res.status !== 302) {
    throw new Error(`Jenkins secret file credential ${exists ? 'update' : 'create'} 실패 (${res.status})`);
  }
  return exists ? 'updated' : 'created';
}

export async function deleteCredential(cfg: JenkinsConfig, id: string): Promise<void> {
  const res = await fetch(`${credentialsBase(cfg.url)}/${encodeURIComponent(id)}/doDelete`, {
    method: 'POST',
    headers: { Authorization: basicAuth(cfg.username, cfg.token) },
  });
  if (!res.ok && res.status !== 302) {
    throw new Error(`Jenkins credential 삭제 실패 (${res.status})`);
  }
}
