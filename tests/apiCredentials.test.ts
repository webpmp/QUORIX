import assert from 'node:assert/strict';
import test from 'node:test';
import {
  API_KEY_IDS,
  MASKED_KEY_PLACEHOLDER,
  clearAllRuntimeApiKeys,
  getActiveApiKey,
  getApiKeysStatusPayload,
  getCredentialSource,
  getEnvApiKey,
  redactErrorMessage,
  redactSecrets,
  setRuntimeApiKey,
  validateApiKeyInput,
  type ApiKeyId,
} from '../src/server/apiCredentials';

const ENV_VARS_TO_RESTORE = [
  'ALPHA_VANTAGE_API_KEY',
  'NYT_API_KEY',
  'NEWS_API_KEY',
  'NEWSDATA_API_KEY',
  'FRED_API_KEY',
  '3SPREAD_API_KEY',
  'THREESPREAD_API_KEY',
] as const;

function snapshotEnv(): Record<string, string | undefined> {
  const snap: Record<string, string | undefined> = {};
  for (const key of ENV_VARS_TO_RESTORE) {
    snap[key] = process.env[key];
  }
  return snap;
}

function restoreEnv(snap: Record<string, string | undefined>): void {
  for (const key of ENV_VARS_TO_RESTORE) {
    if (snap[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = snap[key];
    }
  }
}

function clearTestEnv(): void {
  for (const key of ENV_VARS_TO_RESTORE) {
    delete process.env[key];
  }
}

test('environment credentials strictly take precedence over runtime keys for all 6 providers', () => {
  const saved = snapshotEnv();
  try {
    clearTestEnv();
    clearAllRuntimeApiKeys();

    for (const id of API_KEY_IDS) {
      const runtimeVal = `rt_${id}_secret_123`;
      const envVal = `env_${id}_secret_999`;

      // Runtime works when env is absent
      const r1 = setRuntimeApiKey(id, runtimeVal);
      assert.equal(r1.blockedByEnv, false);
      assert.equal(getActiveApiKey(id), runtimeVal);
      assert.equal(getCredentialSource(id), 'runtime');

      // Setting env overrides runtime immediately
      process.env[id] = envVal;
      assert.equal(getEnvApiKey(id), envVal);
      assert.equal(getActiveApiKey(id), envVal);
      assert.equal(getCredentialSource(id), 'environment');

      // Runtime updates or clears are blocked while env is present
      const r2 = setRuntimeApiKey(id, 'attacker_override_key');
      assert.equal(r2.blockedByEnv, true);
      assert.equal(r2.updated, false);
      assert.equal(getActiveApiKey(id), envVal);

      const r3 = setRuntimeApiKey(id, '');
      assert.equal(r3.blockedByEnv, true);
      assert.equal(getActiveApiKey(id), envVal);
    }
  } finally {
    clearAllRuntimeApiKeys();
    restoreEnv(saved);
  }
});

test('3SPREAD preserves THREESPREAD_API_KEY compatibility alias and prioritizes 3SPREAD_API_KEY', () => {
  const saved = snapshotEnv();
  try {
    clearTestEnv();
    clearAllRuntimeApiKeys();

    process.env.THREESPREAD_API_KEY = 'legacy_alias_secret_abc';
    assert.equal(getActiveApiKey('3SPREAD_API_KEY'), 'legacy_alias_secret_abc');
    assert.equal(getCredentialSource('3SPREAD_API_KEY'), 'environment');

    const blocked = setRuntimeApiKey('3SPREAD_API_KEY', 'runtime_attempt');
    assert.equal(blocked.blockedByEnv, true);
    assert.equal(getActiveApiKey('3SPREAD_API_KEY'), 'legacy_alias_secret_abc');

    process.env['3SPREAD_API_KEY'] = 'primary_env_secret_xyz';
    assert.equal(getActiveApiKey('3SPREAD_API_KEY'), 'primary_env_secret_xyz');
  } finally {
    clearAllRuntimeApiKeys();
    restoreEnv(saved);
  }
});

test('getApiKeysStatusPayload never discloses any characters of saved credentials', () => {
  const saved = snapshotEnv();
  try {
    clearTestEnv();
    clearAllRuntimeApiKeys();

    const envSecret = 'ENV_SUPER_SECRET_TOKEN_987654';
    const rtSecret = 'RT_UNIQUE_SECRET_KEY_123456';
    process.env.FRED_API_KEY = envSecret;
    setRuntimeApiKey('ALPHA_VANTAGE_API_KEY', rtSecret);

    const payload = getApiKeysStatusPayload();
    const serialized = JSON.stringify(payload);

    assert.equal(payload.credentials.FRED_API_KEY.configured, true);
    assert.equal(payload.credentials.FRED_API_KEY.source, 'environment');
    assert.equal(payload.credentials.FRED_API_KEY.maskedValue, MASKED_KEY_PLACEHOLDER);
    assert.equal(payload.maskedKeys.FRED_API_KEY, MASKED_KEY_PLACEHOLDER);

    assert.equal(payload.credentials.ALPHA_VANTAGE_API_KEY.configured, true);
    assert.equal(payload.credentials.ALPHA_VANTAGE_API_KEY.source, 'runtime');
    assert.equal(payload.credentials.ALPHA_VANTAGE_API_KEY.maskedValue, MASKED_KEY_PLACEHOLDER);

    assert.equal(payload.credentials.NYT_API_KEY.configured, false);
    assert.equal(payload.credentials.NYT_API_KEY.source, 'none');
    assert.equal(payload.credentials.NYT_API_KEY.maskedValue, '');

    // Ensure no prefix or suffix characters leak anywhere in the response
    assert.equal(serialized.includes('ENV'), false);
    assert.equal(serialized.includes('987'), false);
    assert.equal(serialized.includes('654'), false);
    assert.equal(serialized.includes('RT_'), false);
    assert.equal(serialized.includes('123'), false);
    assert.equal(serialized.includes('456'), false);
  } finally {
    clearAllRuntimeApiKeys();
    restoreEnv(saved);
  }
});

test('validateApiKeyInput trims spaces, preserves valid special chars, and rejects newlines/control chars/oversized keys without echoing values', () => {
  const validSpecial = '  pub_live-9A8b.7c/+=:123  ';
  const okRes = validateApiKeyInput(validSpecial, 'Newsdata.io API key');
  assert.equal(okRes.ok, true);
  assert.equal(okRes.skipped, false);
  assert.equal(okRes.value, 'pub_live-9A8b.7c/+=:123');

  const maskedSkip = validateApiKeyInput(MASKED_KEY_PLACEHOLDER, 'FRED API key');
  assert.equal(maskedSkip.ok, true);
  assert.equal(maskedSkip.skipped, true);

  const newlineSecret = 'secret_key_line1\nX-Injected: true';
  const newlineRes = validateApiKeyInput(newlineSecret, 'News API key');
  assert.equal(newlineRes.ok, false);
  assert.equal(newlineRes.error?.includes('secret_key_line1'), false);
  assert.equal(newlineRes.error?.includes('X-Injected'), false);

  const ctrlSecret = 'secret_with_null\u0000byte';
  const ctrlRes = validateApiKeyInput(ctrlSecret, '3SPREAD API key');
  assert.equal(ctrlRes.ok, false);
  assert.equal(ctrlRes.error?.includes('secret_with_null'), false);

  const longSecret = 'A'.repeat(257);
  const longRes = validateApiKeyInput(longSecret, 'Alpha Vantage API key');
  assert.equal(longRes.ok, false);
  assert.equal(longRes.error?.includes('AAAA'), false);
});

test('redactSecrets and redactErrorMessage strip raw keys, URL-encoded keys, query params, and auth headers', () => {
  const saved = snapshotEnv();
  try {
    clearTestEnv();
    clearAllRuntimeApiKeys();

    const secretWithChars = 'sk_test+abc/123=xyz';
    process.env.NEWS_API_KEY = secretWithChars;

    const leaked = `GET https://api.example.com/v1?api_key=${encodeURIComponent(
      secretWithChars
    )}&apikey=otherKey999 failed with Authorization: Bearer ${secretWithChars} and X-Api-Key: headerSecret456`;

    const redacted = redactSecrets(leaked);
    assert.equal(redacted.includes(secretWithChars), false);
    assert.equal(redacted.includes(encodeURIComponent(secretWithChars)), false);
    assert.equal(redacted.includes('otherKey999'), false);
    assert.equal(redacted.includes('headerSecret456'), false);
    assert.ok(redacted.includes('[REDACTED]'));

    const errMsg = redactErrorMessage(
      new Error(`Fetch failed for https://api.nytimes.com/svc?api-key=nytSecretVal12345`),
      'Fallback'
    );
    assert.equal(errMsg.includes('nytSecretVal12345'), false);
    assert.ok(errMsg.includes('api-key=[REDACTED]'));
  } finally {
    clearAllRuntimeApiKeys();
    restoreEnv(saved);
  }
});
