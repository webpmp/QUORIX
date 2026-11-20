export type ApiKeyId =
  | 'ALPHA_VANTAGE_API_KEY'
  | 'NYT_API_KEY'
  | 'NEWS_API_KEY'
  | 'NEWSDATA_API_KEY'
  | 'FRED_API_KEY'
  | '3SPREAD_API_KEY';

export type CredentialSource = 'environment' | 'runtime' | 'none';

export interface ApiCredentialStatus {
  configured: boolean;
  source: CredentialSource;
  maskedValue: string;
}

export interface ApiKeysStatusResponsePayload {
  maskedKeys: Record<ApiKeyId, string>;
  credentials: Record<ApiKeyId, ApiCredentialStatus>;
}

export interface ApiKeyValidationResult {
  ok: boolean;
  skipped?: boolean;
  value?: string;
  error?: string;
}

export const API_KEY_IDS: readonly ApiKeyId[] = [
  'ALPHA_VANTAGE_API_KEY',
  'NYT_API_KEY',
  'NEWS_API_KEY',
  'NEWSDATA_API_KEY',
  'FRED_API_KEY',
  '3SPREAD_API_KEY',
] as const;

export const API_KEY_LABELS: Record<ApiKeyId, string> = {
  ALPHA_VANTAGE_API_KEY: 'Alpha Vantage API key',
  NYT_API_KEY: 'New York Times Business API key',
  NEWS_API_KEY: 'News API key',
  NEWSDATA_API_KEY: 'Newsdata.io API key',
  FRED_API_KEY: 'FRED API key',
  '3SPREAD_API_KEY': '3SPREAD API key',
};

export const MASKED_KEY_PLACEHOLDER = '••••••••';
export const MAX_API_KEY_LENGTH = 256;

const PLACEHOLDER_KEYS = new Set([
  'MY_ALPHA_VANTAGE_API_KEY',
  'MY_NYT_API_KEY',
  'MY_NEWS_API_KEY',
  'MY_NEWSDATA_API_KEY',
  'MY_FRED_API_KEY',
  'MY_3SPREAD_API_KEY',
  'MY_THREESPREAD_API_KEY',
  'MY_GEMINI_API_KEY',
]);

// Server-side in-memory store ONLY. Never persisted to files, databases, or browser storage.
const runtimeApiKeys: Record<ApiKeyId, string> = {
  ALPHA_VANTAGE_API_KEY: '',
  NYT_API_KEY: '',
  NEWS_API_KEY: '',
  NEWSDATA_API_KEY: '',
  FRED_API_KEY: '',
  '3SPREAD_API_KEY': '',
};

const CONTROL_OR_NEWLINE_REGEX = /[\r\n\u0000-\u001F\u007F]/;

export function isMaskedKeyPlaceholder(raw: unknown): boolean {
  if (typeof raw !== 'string') return false;
  const trimmed = raw.trim();
  if (!trimmed) return false;
  return (
    trimmed === MASKED_KEY_PLACEHOLDER ||
    trimmed.includes('••••') ||
    trimmed.includes('●●●●')
  );
}

/**
 * Normalizes a credential read from server environment variables.
 * Strips surrounding quotes sometimes added in .env files and ignores placeholders.
 */
export function normalizeEnvApiKey(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  if (CONTROL_OR_NEWLINE_REGEX.test(raw)) return '';
  let cleaned = raw.trim();
  if (
    cleaned.length >= 2 &&
    ((cleaned.startsWith('"') && cleaned.endsWith('"')) ||
      (cleaned.startsWith("'") && cleaned.endsWith("'")))
  ) {
    cleaned = cleaned.slice(1, -1).trim();
  }
  if (!cleaned || cleaned.length > MAX_API_KEY_LENGTH || PLACEHOLDER_KEYS.has(cleaned)) {
    return '';
  }
  return cleaned;
}

/**
 * Validates a credential submitted via SYSTEM SETTINGS or diagnostic tests.
 * - Trims leading and trailing spaces.
 * - Rejects newlines and ASCII control characters without mutating or echoing values.
 * - Enforces a maximum length of 256 characters.
 * - Preserves all valid special characters used by API providers.
 */
export function validateApiKeyInput(
  raw: unknown,
  fieldLabel = 'API key'
): ApiKeyValidationResult {
  if (raw === undefined || raw === null) {
    return { ok: true, skipped: true };
  }
  if (typeof raw !== 'string') {
    return {
      ok: false,
      error: `Invalid ${fieldLabel}: expected a text value.`,
    };
  }
  if (isMaskedKeyPlaceholder(raw)) {
    return { ok: true, skipped: true };
  }
  if (CONTROL_OR_NEWLINE_REGEX.test(raw)) {
    return {
      ok: false,
      error: `Invalid ${fieldLabel}: newline and control characters are not allowed.`,
    };
  }

  const trimmed = raw.trim();
  if (trimmed.length > MAX_API_KEY_LENGTH) {
    return {
      ok: false,
      error: `Invalid ${fieldLabel}: exceeds maximum length of ${MAX_API_KEY_LENGTH} characters.`,
    };
  }
  if (!trimmed || PLACEHOLDER_KEYS.has(trimmed)) {
    return { ok: true, skipped: false, value: '' };
  }
  return { ok: true, skipped: false, value: trimmed };
}

/**
 * Resolves an environment-provided credential for the given provider.
 * For 3SPREAD, checks 3SPREAD_API_KEY first and falls back to THREESPREAD_API_KEY.
 */
export function getEnvApiKey(id: ApiKeyId): string {
  if (id === '3SPREAD_API_KEY') {
    return (
      normalizeEnvApiKey(process.env['3SPREAD_API_KEY']) ||
      normalizeEnvApiKey(process.env.THREESPREAD_API_KEY)
    );
  }
  return normalizeEnvApiKey(process.env[id]);
}

export function getRuntimeApiKey(id: ApiKeyId): string {
  return runtimeApiKeys[id] || '';
}

/**
 * Returns the active credential using strict precedence:
 * 1. Environment variable always takes precedence.
 * 2. Runtime key entered via SYSTEM SETTINGS is used only when no env key is configured.
 */
export function getActiveApiKey(id: ApiKeyId): string {
  return getEnvApiKey(id) || getRuntimeApiKey(id);
}

export function getCredentialSource(id: ApiKeyId): CredentialSource {
  if (getEnvApiKey(id)) return 'environment';
  if (getRuntimeApiKey(id)) return 'runtime';
  return 'none';
}

/**
 * Updates an in-memory runtime API key ONLY if no environment credential is configured.
 * Clearing a runtime key never disables an environment-provided credential.
 */
export function setRuntimeApiKey(
  id: ApiKeyId,
  validatedKey: string
): { updated: boolean; blockedByEnv: boolean } {
  if (getEnvApiKey(id)) {
    return { updated: false, blockedByEnv: true };
  }
  const previous = runtimeApiKeys[id];
  runtimeApiKeys[id] = validatedKey;
  return { updated: previous !== validatedKey, blockedByEnv: false };
}

/**
 * Resets all in-memory runtime keys (useful for tests).
 */
export function clearAllRuntimeApiKeys(): void {
  for (const id of API_KEY_IDS) {
    runtimeApiKeys[id] = '';
  }
}

/**
 * Builds the safe settings status response.
 * Never returns any actual characters from any configured API credential.
 */
export function getApiKeysStatusPayload(): ApiKeysStatusResponsePayload {
  const maskedKeys = {} as Record<ApiKeyId, string>;
  const credentials = {} as Record<ApiKeyId, ApiCredentialStatus>;

  for (const id of API_KEY_IDS) {
    const source = getCredentialSource(id);
    const configured = source !== 'none';
    const maskedValue = configured ? MASKED_KEY_PLACEHOLDER : '';
    maskedKeys[id] = maskedValue;
    credentials[id] = {
      configured,
      source,
      maskedValue,
    };
  }

  return { maskedKeys, credentials };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function collectActiveSecrets(extraSecrets: string[] = []): string[] {
  const secrets = new Set<string>();
  for (const id of API_KEY_IDS) {
    const envVal = getEnvApiKey(id);
    if (envVal && envVal.length >= 4) secrets.add(envVal);
    const runtimeVal = getRuntimeApiKey(id);
    if (runtimeVal && runtimeVal.length >= 4) secrets.add(runtimeVal);
  }
  const geminiKey = normalizeEnvApiKey(process.env.GEMINI_API_KEY || process.env.API_KEY);
  if (geminiKey && geminiKey.length >= 4) secrets.add(geminiKey);
  for (const extra of extraSecrets) {
    if (typeof extra === 'string' && extra.trim().length >= 4) {
      secrets.add(extra.trim());
    }
  }
  return Array.from(secrets);
}

/**
 * Redacts all known credentials, sensitive query parameters, and auth headers
 * from log messages, upstream provider errors, and API error responses.
 */
export function redactSecrets(
  rawMessage: unknown,
  options: { extraSecrets?: string[]; maxLength?: number } = {}
): string {
  const { extraSecrets = [], maxLength } = options;
  let text = String(rawMessage ?? '').replace(/[\u0000-\u001F\u007F]/g, ' ').trim();
  if (!text) return '';

  const secrets = collectActiveSecrets(extraSecrets);
  for (const secret of secrets) {
    text = text.replace(new RegExp(escapeRegExp(secret), 'gi'), '[REDACTED]');
    const encoded = encodeURIComponent(secret);
    if (encoded !== secret) {
      text = text.replace(new RegExp(escapeRegExp(encoded), 'gi'), '[REDACTED]');
    }
  }

  // Redact sensitive URL query parameters
  text = text.replace(
    /([?&](?:api[_-]?key|apikey|access[_-]?token|token|secret|key)=)[^&\s"'<>]+/gi,
    '$1[REDACTED]'
  );

  // Redact Authorization / API key headers if echoed in error strings
  text = text.replace(
    /\b((?:authorization|x-api-key|apikey|api-key)\s*[:=]\s*(?:bearer\s+)?)[^\s,"';}]+/gi,
    '$1[REDACTED]'
  );

  if (typeof maxLength === 'number' && maxLength > 3 && text.length > maxLength) {
    text = `${text.slice(0, maxLength - 3)}...`;
  }

  return text;
}

export function redactErrorMessage(
  err: unknown,
  fallback = 'Unexpected server error.',
  options: { extraSecrets?: string[]; maxLength?: number } = {}
): string {
  const raw =
    err instanceof Error
      ? err.message
      : typeof err === 'string'
      ? err
      : fallback;
  const sanitized = redactSecrets(raw || fallback, options);
  return sanitized || fallback;
}
