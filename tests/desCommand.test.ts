import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseCommandLineInput } from '../src/utils/commandParser';
import { runExistingApiFallback } from '../server';

console.log('--- Testing DES Command and Routing ---');

// 1. Check direct DES commands
const desAapl = parseCommandLineInput('DES AAPL');
assert.deepEqual(desAapl, {
  type: 'TICKER_SCREEN',
  screen: 'DES',
  ticker: 'AAPL',
});

const desMsft = parseCommandLineInput('DES MSFT');
assert.deepEqual(desMsft, {
  type: 'TICKER_SCREEN',
  screen: 'DES',
  ticker: 'MSFT',
});

const desNvda = parseCommandLineInput('DES NVDA');
assert.deepEqual(desNvda, {
  type: 'TICKER_SCREEN',
  screen: 'DES',
  ticker: 'NVDA',
});

// 2. Case-insensitivity
const desLower = parseCommandLineInput('des goog');
assert.deepEqual(desLower, {
  type: 'TICKER_SCREEN',
  screen: 'DES',
  ticker: 'GOOG',
});

// 3. Reversed ticker-command format "<TICKER> DES"
const aaplDes = parseCommandLineInput('AAPL DES');
assert.deepEqual(aaplDes, {
  type: 'TICKER_SCREEN',
  screen: 'DES',
  ticker: 'AAPL',
});

// 4. Standalone DES command (navigating without ticker)
const desStandalone = parseCommandLineInput('DES');
assert.deepEqual(desStandalone, {
  type: 'SCREEN',
  screen: 'DES',
});

// 5. Aliases "SECURITY ANALYTICS AAPL" or "SECURITY AAPL"
const secAapl = parseCommandLineInput('SECURITY AAPL');
assert.deepEqual(secAapl, {
  type: 'TICKER_SCREEN',
  screen: 'DES',
  ticker: 'AAPL',
});

// 6. When-issued / missing profile ticker fallback test
test('runExistingApiFallback handles DES screen with no profile cleanly without dumping benchmarks or FRED data', async () => {
  const desRes = await runExistingApiFallback({
    command: 'HONAV DES',
    ticker: 'HONAV',
    screen: 'DES',
  });
  assert.equal(
    desRes.output.includes('No company profile available for HONAV yet.'),
    true,
    'DES output must contain short clean notice'
  );
  assert.equal(
    desRes.output.includes('LIVE CROSS-ASSET BENCHMARKS'),
    false,
    'DES output must not contain market-wide benchmarks'
  );
  assert.equal(
    desRes.output.includes('LIVE FRED MACROECONOMIC'),
    false,
    'DES output must not contain FRED dump'
  );

  // Other callers (e.g. ASK) still retain benchmarks
  const askRes = await runExistingApiFallback({
    command: 'HONAV',
    screen: 'ASK',
  });
  assert.equal(
    askRes.output.includes('LIVE CROSS-ASSET BENCHMARKS'),
    true,
    'Non-DES callers like ASK must keep working and retain benchmarks'
  );
});

console.log('✓ All DES command parsing tests passed!');
