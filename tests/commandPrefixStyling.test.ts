import assert from 'node:assert/strict';
import {
  COMMAND_DEFINITIONS,
  COMMAND_ALIAS_MAP,
  extractRecognizedCommandPrefix,
} from '../src/utils/commandParser';

console.log('--- Testing Command Prefix Extraction for Visual Styling ---');

// The 14 official global terminal commands specified in requirements:
const ALL_14_COMMANDS = [
  'ASK',
  'NEWS',
  'GP',
  'CORR',
  'PRM',
  'HP',
  'DES',
  'ANR',
  'INST',
  'CRNC',
  'ECO',
  'POLY',
  'SETT',
  'HELP',
];

// 1. Verify all 14 commands are recognized standalone and with ticker arguments
for (const code of ALL_14_COMMANDS) {
  // Standalone
  const resStandalone = extractRecognizedCommandPrefix(code);
  assert(resStandalone !== null, `Failed to recognize standalone command: ${code}`);
  assert.equal(resStandalone.prefix, code);
  assert.equal(resStandalone.remainder, '');
  assert.equal(resStandalone.commandCode, code);

  // With ticker argument
  const withArg = `${code} AAPL`;
  const resWithArg = extractRecognizedCommandPrefix(withArg);
  assert(resWithArg !== null, `Failed to recognize command with argument: ${withArg}`);
  assert.equal(resWithArg.prefix, code);
  assert.equal(resWithArg.remainder, ' AAPL');
  assert.equal(resWithArg.commandCode, code);

  // Lowercase
  const lowerWithArg = `${code.toLowerCase()} msft`;
  const resLower = extractRecognizedCommandPrefix(lowerWithArg);
  assert(resLower !== null, `Failed to recognize lowercase command: ${lowerWithArg}`);
  assert.equal(resLower.prefix, code.toLowerCase());
  assert.equal(resLower.remainder, ' msft');
  assert.equal(resLower.commandCode, code);
}

// 2. Multi-word command aliases (e.g., "GRAPH PRICE AAPL", "SECURITY ANALYTICS NVDA")
const multiWordRes = extractRecognizedCommandPrefix('GRAPH PRICE AAPL');
assert(multiWordRes !== null);
assert.equal(multiWordRes.prefix, 'GRAPH PRICE');
assert.equal(multiWordRes.remainder, ' AAPL');
assert.equal(multiWordRes.commandCode, 'GP');

// 3. ECO release categories
const ecoCpi = extractRecognizedCommandPrefix('ECO CPI');
assert(ecoCpi !== null);
assert.equal(ecoCpi.prefix, 'ECO');
assert.equal(ecoCpi.remainder, ' CPI');
assert.equal(ecoCpi.commandCode, 'ECO');

// 4. Unknown commands and plain ticker symbols should NOT be matched
assert.equal(extractRecognizedCommandPrefix('AAPL'), null);
assert.equal(extractRecognizedCommandPrefix('UNKNOWN AAPL'), null);
assert.equal(extractRecognizedCommandPrefix(''), null);
assert.equal(extractRecognizedCommandPrefix('APPLE'), null);
assert.equal(extractRecognizedCommandPrefix('WHAT IS CPI?'), null);

// 5. Commands embedded as substrings of words should NOT match prefix
// e.g. "GPRO AAPL" should NOT match "GP"
assert.equal(extractRecognizedCommandPrefix('GPRO AAPL'), null);
// "NEWSPAPER AAPL" should NOT match "NEWS"
assert.equal(extractRecognizedCommandPrefix('NEWSPAPER AAPL'), null);
// "ASKS" should NOT match "ASK"
assert.equal(extractRecognizedCommandPrefix('ASKS'), null);

console.log('✓ All 14 command prefix styling tests passed!');
