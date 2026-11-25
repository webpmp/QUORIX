import assert from 'node:assert/strict';
import { parseCommandLineInput } from '../src/utils/commandParser';

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

console.log('✓ All DES command parsing tests passed!');
