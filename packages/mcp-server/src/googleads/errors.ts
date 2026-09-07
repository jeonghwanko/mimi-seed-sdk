/** Preserve provider diagnostics without exposing authentication material. */
export function googleAdsError(status: number, body: string, secrets: string[]): Error {
  let message = `Google Ads API ${status}`;
  try {
    const parsed = JSON.parse(body);
    const error = (Array.isArray(parsed) ? parsed[0] : parsed)?.error;
    if (typeof error?.message === 'string') message += `: ${error.message}`;
    for (const detail of Array.isArray(error?.details) ? error.details : []) {
      for (const item of Array.isArray(detail.errors) ? detail.errors : []) {
        const codes = item.errorCode && typeof item.errorCode === 'object'
          ? Object.entries(item.errorCode).map(([key, value]) => `${key}=${String(value)}`).join(', ')
          : '';
        message += `\n${codes}${typeof item.message === 'string' ? `: ${item.message}` : ''}`;
      }
      for (const item of Array.isArray(detail.fieldViolations) ? detail.fieldViolations : []) {
        message += `\n${String(item.field ?? '')}: ${String(item.description ?? '')}`;
      }
      if (typeof detail.requestId === 'string') message += `\nrequestId=${detail.requestId}`;
    }
  } catch {
    // HTML/proxy bodies can contain arbitrary data; do not echo them.
    message += ': non-JSON response';
  }
  for (const secret of secrets.filter(Boolean).sort((a, b) => b.length - a.length)) {
    message = message.split(secret).join('[REDACTED]');
  }
  return new Error(message.slice(0, 4000));
}
