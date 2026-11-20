import { redactSecrets, validateApiKeyInput } from './apiCredentials';

export type DiagnosticProviderId =
  | 'ALPHA_VANTAGE'
  | 'NYT'
  | 'NEWS_API'
  | 'NEWSDATA'
  | 'FRED'
  | '3SPREAD';

export const DIAGNOSTIC_PROVIDER_IDS: readonly DiagnosticProviderId[] = [
  'ALPHA_VANTAGE',
  'NYT',
  'NEWS_API',
  'NEWSDATA',
  'FRED',
  '3SPREAD',
] as const;

export const DIAGNOSTIC_PROVIDER_SET: ReadonlySet<string> = new Set(DIAGNOSTIC_PROVIDER_IDS);

export interface DiagnosticTestResult {
  ok: boolean;
  status: 'CONNECTED' | 'FAILED';
  message: string;
  latencyMs: number;
}

const DIAGNOSTIC_TIMEOUT_MS = 10_000;

export function normalizeDiagnosticKey(raw?: unknown): string {
  const result = validateApiKeyInput(raw, 'API key');
  if (!result.ok || result.skipped) return '';
  return result.value || '';
}

/**
 * Redacts any occurrence of API keys, auth headers, or sensitive query parameters
 * from error output so diagnostic messages never expose credentials to browser clients or logs.
 */
export function sanitizeDiagnosticMessage(rawMessage: string, secretKey?: string): string {
  return redactSecrets(rawMessage, {
    extraSecrets: secretKey ? [secretKey] : [],
    maxLength: 220,
  });
}

async function safeParseJson(res: Response): Promise<any> {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

export async function runProviderConnectionTest(params: {
  provider: DiagnosticProviderId;
  apiKey: string;
  fetchImpl?: typeof fetch;
}): Promise<DiagnosticTestResult> {
  const { provider, fetchImpl = fetch } = params;
  const key = normalizeDiagnosticKey(params.apiKey);
  const startedAt = Date.now();
  const elapsed = () => Math.max(1, Date.now() - startedAt);

  if (!key) {
    return {
      ok: false,
      status: 'FAILED',
      message: 'No API key configured for this provider. Enter a valid key and retry.',
      latencyMs: elapsed(),
    };
  }

  try {
    switch (provider) {
      case 'ALPHA_VANTAGE': {
        const url = `https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol=AAPL&apikey=${encodeURIComponent(key)}`;
        const res = await fetchImpl(url, {
          method: 'GET',
          headers: { Accept: 'application/json' },
          signal: AbortSignal.timeout(DIAGNOSTIC_TIMEOUT_MS),
        });
        const data = await safeParseJson(res);
        if (!res.ok) {
          return {
            ok: false,
            status: 'FAILED',
            message: `Alpha Vantage returned HTTP ${res.status}.`,
            latencyMs: elapsed(),
          };
        }
        if (typeof data?.['Error Message'] === 'string') {
          return {
            ok: false,
            status: 'FAILED',
            message: sanitizeDiagnosticMessage(data['Error Message'], key),
            latencyMs: elapsed(),
          };
        }
        const notice = data?.Note || data?.Information;
        if (typeof notice === 'string') {
          const lower = notice.toLowerCase();
          const friendly = lower.includes('rate limit') || lower.includes('requests per')
            ? 'Alpha Vantage rate limit reached. Wait for quota reset and retry.'
            : lower.includes('invalid') || lower.includes('demo')
            ? 'Invalid or demo Alpha Vantage API key.'
            : sanitizeDiagnosticMessage(notice, key);
          return {
            ok: false,
            status: 'FAILED',
            message: friendly,
            latencyMs: elapsed(),
          };
        }
        const quote = data?.['Global Quote'];
        const price = Number(quote?.['05. price']);
        if (quote && Number.isFinite(price) && price > 0) {
          const pctRaw = String(quote['10. change percent'] || '').trim();
          const pctSuffix = pctRaw ? ` (${pctRaw})` : '';
          return {
            ok: true,
            status: 'CONNECTED',
            message: `Authenticated with Alpha Vantage. Retrieved AAPL quote: $${price.toFixed(2)}${pctSuffix}.`,
            latencyMs: elapsed(),
          };
        }
        return {
          ok: false,
          status: 'FAILED',
          message: 'Alpha Vantage returned an empty quote payload. Verify the configured API key.',
          latencyMs: elapsed(),
        };
      }

      case 'NYT': {
        const url = `https://api.nytimes.com/svc/topstories/v2/business.json?api-key=${encodeURIComponent(key)}`;
        const res = await fetchImpl(url, {
          method: 'GET',
          headers: { Accept: 'application/json' },
          signal: AbortSignal.timeout(DIAGNOSTIC_TIMEOUT_MS),
        });
        const data = await safeParseJson(res);
        if (res.status === 401 || res.status === 403) {
          return {
            ok: false,
            status: 'FAILED',
            message: 'Invalid or unauthorized New York Times API key.',
            latencyMs: elapsed(),
          };
        }
        if (res.status === 429) {
          return {
            ok: false,
            status: 'FAILED',
            message: 'New York Times API rate limit reached. Retry shortly.',
            latencyMs: elapsed(),
          };
        }
        if (!res.ok) {
          const fault = data?.fault?.faultstring || `HTTP ${res.status}`;
          return {
            ok: false,
            status: 'FAILED',
            message: `NY Times API error: ${sanitizeDiagnosticMessage(fault, key)}`,
            latencyMs: elapsed(),
          };
        }
        if (data?.status === 'OK' && Array.isArray(data?.results)) {
          return {
            ok: true,
            status: 'CONNECTED',
            message: `Authenticated with NY Times Business API (${data.results.length} top stories reachable).`,
            latencyMs: elapsed(),
          };
        }
        return {
          ok: false,
          status: 'FAILED',
          message: 'Unexpected response format from New York Times API.',
          latencyMs: elapsed(),
        };
      }

      case 'NEWS_API': {
        const url = 'https://newsapi.org/v2/top-headlines?category=business&country=us&pageSize=1';
        const res = await fetchImpl(url, {
          method: 'GET',
          headers: {
            'X-Api-Key': key,
            Accept: 'application/json',
          },
          signal: AbortSignal.timeout(DIAGNOSTIC_TIMEOUT_MS),
        });
        const data = await safeParseJson(res);
        if (
          res.status === 401 ||
          res.status === 403 ||
          data?.code === 'apiKeyInvalid' ||
          data?.code === 'apiKeyDisabled' ||
          data?.code === 'apiKeyMissing'
        ) {
          return {
            ok: false,
            status: 'FAILED',
            message: 'Invalid or unauthorized News API key.',
            latencyMs: elapsed(),
          };
        }
        if (res.status === 429 || data?.code === 'rateLimited') {
          return {
            ok: false,
            status: 'FAILED',
            message: 'News API rate limit reached. Retry after quota reset.',
            latencyMs: elapsed(),
          };
        }
        if (!res.ok || data?.status !== 'ok') {
          const msg = data?.message || `News API returned HTTP ${res.status}.`;
          return {
            ok: false,
            status: 'FAILED',
            message: sanitizeDiagnosticMessage(msg, key),
            latencyMs: elapsed(),
          };
        }
        const total = typeof data?.totalResults === 'number' ? data.totalResults : 0;
        return {
          ok: true,
          status: 'CONNECTED',
          message: `Authenticated with News API (${total.toLocaleString()} US business headlines available).`,
          latencyMs: elapsed(),
        };
      }

      case 'NEWSDATA': {
        const url = `https://newsdata.io/api/1/news?apikey=${encodeURIComponent(key)}&category=business&language=en&size=1`;
        const res = await fetchImpl(url, {
          method: 'GET',
          headers: { Accept: 'application/json' },
          signal: AbortSignal.timeout(DIAGNOSTIC_TIMEOUT_MS),
        });
        const data = await safeParseJson(res);
        if (res.status === 401 || res.status === 403) {
          return {
            ok: false,
            status: 'FAILED',
            message: 'Invalid or unauthorized Newsdata.io API key.',
            latencyMs: elapsed(),
          };
        }
        if (res.status === 429) {
          return {
            ok: false,
            status: 'FAILED',
            message: 'Newsdata.io API rate limit reached. Retry shortly.',
            latencyMs: elapsed(),
          };
        }
        if (!res.ok || data?.status !== 'success') {
          const errDetail =
            data?.results?.message ||
            data?.message ||
            `Newsdata.io returned HTTP ${res.status}.`;
          return {
            ok: false,
            status: 'FAILED',
            message: sanitizeDiagnosticMessage(errDetail, key),
            latencyMs: elapsed(),
          };
        }
        const total =
          typeof data?.totalResults === 'number'
            ? data.totalResults
            : Array.isArray(data?.results)
            ? data.results.length
            : 0;
        return {
          ok: true,
          status: 'CONNECTED',
          message: `Authenticated with Newsdata.io (${total.toLocaleString()} business news records accessible).`,
          latencyMs: elapsed(),
        };
      }

      case 'FRED': {
        const url = `https://api.stlouisfed.org/fred/series/observations?series_id=DFF&api_key=${encodeURIComponent(key)}&file_type=json&sort_order=desc&limit=1`;
        const res = await fetchImpl(url, {
          method: 'GET',
          headers: { Accept: 'application/json' },
          signal: AbortSignal.timeout(DIAGNOSTIC_TIMEOUT_MS),
        });
        const data = await safeParseJson(res);
        if (res.status === 401 || res.status === 403) {
          return {
            ok: false,
            status: 'FAILED',
            message: 'Invalid or unauthorized FRED API key.',
            latencyMs: elapsed(),
          };
        }
        if (res.status === 429) {
          return {
            ok: false,
            status: 'FAILED',
            message: 'FRED API rate limit reached. Retry shortly.',
            latencyMs: elapsed(),
          };
        }
        if (!res.ok) {
          const errMsg = typeof data?.error_message === 'string' ? data.error_message : `FRED returned HTTP ${res.status}.`;
          const friendly = /api_key/i.test(errMsg)
            ? 'Invalid FRED API key. Verify your 32-character St. Louis Fed key.'
            : sanitizeDiagnosticMessage(errMsg, key);
          return {
            ok: false,
            status: 'FAILED',
            message: friendly,
            latencyMs: elapsed(),
          };
        }
        if (Array.isArray(data?.observations)) {
          const latest = data.observations[0];
          const detail =
            latest?.date && latest?.value && latest.value !== '.'
              ? `Latest DFF observation: ${latest.value}% (${latest.date}).`
              : 'Macroeconomic series endpoint reachable.';
          return {
            ok: true,
            status: 'CONNECTED',
            message: `Authenticated with St. Louis Fed FRED API. ${detail}`,
            latencyMs: elapsed(),
          };
        }
        return {
          ok: false,
          status: 'FAILED',
          message: 'Unexpected response payload from FRED API.',
          latencyMs: elapsed(),
        };
      }

      case '3SPREAD': {
        const url = 'https://api.3spread.com/v1/data-as-of';
        const res = await fetchImpl(url, {
          method: 'GET',
          headers: {
            apikey: key,
            Accept: 'application/json',
          },
          signal: AbortSignal.timeout(DIAGNOSTIC_TIMEOUT_MS),
        });
        const data = await safeParseJson(res);
        if (res.status === 401 || res.status === 403) {
          return {
            ok: false,
            status: 'FAILED',
            message: 'Invalid or unauthorized 3spread API key.',
            latencyMs: elapsed(),
          };
        }
        if (res.status === 429) {
          return {
            ok: false,
            status: 'FAILED',
            message: '3spread API rate limit reached. Retry shortly.',
            latencyMs: elapsed(),
          };
        }
        if (!res.ok) {
          const upstreamMsg =
            data?.error?.message ||
            data?.detail ||
            data?.message ||
            `3spread API returned HTTP ${res.status}.`;
          return {
            ok: false,
            status: 'FAILED',
            message: sanitizeDiagnosticMessage(upstreamMsg, key),
            latencyMs: elapsed(),
          };
        }

        const families = data?.families;
        let ihFamily: any = null;
        if (Array.isArray(families)) {
          ihFamily = families.find((f) => /institutional[_-]?holdings|13f/i.test(String(f?.family || '')));
        } else if (families && typeof families === 'object') {
          for (const [k, v] of Object.entries(families)) {
            if (/institutional[_-]?holdings|13f/i.test(k)) {
              ihFamily = v;
              break;
            }
          }
        }
        const latestPeriod = ihFamily?.period_of_report_max || ihFamily?.latest_period_of_report || null;
        const filingCount = typeof ihFamily?.filing_count === 'number' ? ihFamily.filing_count : null;
        const suffixParts: string[] = [];
        if (latestPeriod) suffixParts.push(`latest 13F period ${String(latestPeriod).slice(0, 10)}`);
        if (filingCount !== null) suffixParts.push(`${filingCount.toLocaleString()} filings indexed`);
        const suffix = suffixParts.length > 0 ? ` (${suffixParts.join(', ')}).` : '.';

        return {
          ok: true,
          status: 'CONNECTED',
          message: `Authenticated with 3spread Form 13F API${suffix}`,
          latencyMs: elapsed(),
        };
      }
    }
  } catch (err: any) {
    if (err?.name === 'TimeoutError' || err?.name === 'AbortError') {
      return {
        ok: false,
        status: 'FAILED',
        message: 'Connection test timed out after 10 seconds.',
        latencyMs: elapsed(),
      };
    }
    return {
      ok: false,
      status: 'FAILED',
      message: `Connection failed: ${sanitizeDiagnosticMessage(err?.message || 'Unable to reach provider.', key)}`,
      latencyMs: elapsed(),
    };
  }
}
