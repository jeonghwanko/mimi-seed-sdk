import { fetchWithTimeout } from '../lib/http.js';
import { billingVersionFromPom, type BillingTransitiveResolver } from './billing.js';

export const resolveOpenIapBilling: BillingTransitiveResolver = async (openIapVersion) => {
  const pomUrl = `https://repo.maven.apache.org/maven2/io/github/hyochan/openiap/openiap-google/${openIapVersion}/openiap-google-${openIapVersion}.pom`;
  const response = await fetchWithTimeout(pomUrl, {}, { timeoutMs: 15_000, maxAttempts: 2 });
  if (!response.ok) return null;
  return billingVersionFromPom(await response.text());
};
