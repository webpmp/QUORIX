import assert from 'node:assert/strict';
import { COMMAND_DEFINITIONS } from '../src/utils/commandParser';
import { TICKER_STOP_WORDS, extractTickersFromCommand } from '../server';

console.log('--- Testing TICKER_STOP_WORDS and Command-Aware Ticker Extraction ---');

// 1. Assert every registered command code is in the stop-word set
for (const cmd of COMMAND_DEFINITIONS) {
  const code = cmd.code.toUpperCase();
  assert.ok(
    TICKER_STOP_WORDS.has(code),
    `Expected command code "${code}" to be present in TICKER_STOP_WORDS`
  );
}
console.log(`✓ All ${COMMAND_DEFINITIONS.length} registered command codes are present in TICKER_STOP_WORDS`);

// 2. Assert AI and QI are NOT in the stop-word set (AI is real ticker C3.ai)
assert.ok(!TICKER_STOP_WORDS.has('AI'), 'Expected AI to not be in TICKER_STOP_WORDS');
assert.ok(!TICKER_STOP_WORDS.has('QI'), 'Expected QI to not be in TICKER_STOP_WORDS');
console.log('✓ Verified AI and QI are permitted (not in TICKER_STOP_WORDS)');

// 3. Assert extraction from free-text queries
const corrResult = extractTickersFromCommand('run CORR on NVDA and AMD');
assert.deepStrictEqual(
  corrResult.sort(),
  ['AMD', 'NVDA'],
  `Expected ['AMD', 'NVDA'], got: ${JSON.stringify(corrResult)}`
);

const instResult = extractTickersFromCommand('open INST for AAPL');
assert.deepStrictEqual(
  instResult,
  ['AAPL'],
  `Expected ['AAPL'], got: ${JSON.stringify(instResult)}`
);

const prmResult = extractTickersFromCommand('show PRM');
assert.deepStrictEqual(
  prmResult,
  [],
  `Expected [], got: ${JSON.stringify(prmResult)}`
);
console.log('✓ Successfully extracted real tickers from free-text queries while filtering out command codes');

console.log('All TICKER_STOP_WORDS tests passed successfully!');
