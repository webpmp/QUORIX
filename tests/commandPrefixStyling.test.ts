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

// 1.1 Verify CON command prefix extraction and politician argument styling
const conPelosi = extractRecognizedCommandPrefix('CON Pelosi');
assert(conPelosi !== null, 'Failed to recognize CON Pelosi prefix');
assert.equal(conPelosi.prefix, 'CON');
assert.equal(conPelosi.remainder, ' Pelosi');
assert.equal(conPelosi.commandCode, 'CON');

const conNancy = extractRecognizedCommandPrefix('CON Nancy Pelosi');
assert(conNancy !== null, 'Failed to recognize multi-word CON Nancy Pelosi prefix');
assert.equal(conNancy.prefix, 'CON');
assert.equal(conNancy.remainder, ' Nancy Pelosi');
assert.equal(conNancy.commandCode, 'CON');

const conLower = extractRecognizedCommandPrefix('con Nancy Pelosi');
assert(conLower !== null, 'Failed to recognize lowercase con prefix');
assert.equal(conLower.prefix, 'con');
assert.equal(conLower.remainder, ' Nancy Pelosi');
assert.equal(conLower.commandCode, 'CON');

const conStandalone = extractRecognizedCommandPrefix('CON');
assert(conStandalone !== null, 'Failed to recognize standalone CON prefix');
assert.equal(conStandalone.prefix, 'CON');
assert.equal(conStandalone.remainder, '');
assert.equal(conStandalone.commandCode, 'CON');

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

// 6. Caret and Trailing-Space Helper Tests
const { formatCommandInput, parseCommandLineInput } = await import('../src/utils/commandParser');

// (a) Selecting a command sets the input value to "<CODE> "
assert.equal(formatCommandInput('ECO'), 'ECO ');
assert.equal(formatCommandInput('CORR'), 'CORR ');
assert.equal(formatCommandInput('INST'), 'INST ');
assert.equal(formatCommandInput('PRM'), 'PRM ');
assert.equal(formatCommandInput('GP'), 'GP ');
assert.equal(formatCommandInput('  GP  '), 'GP ');

// (b) Parser treats "ECO " and "ECO" identically
const parsedNoSpace = parseCommandLineInput('ECO');
const parsedWithSpace = parseCommandLineInput('ECO ');
assert.deepStrictEqual(parsedWithSpace, parsedNoSpace);
assert.equal(parsedWithSpace.type, 'SCREEN');
assert.equal(parsedWithSpace.screen, 'ECO');

// (c) Commands with trailing space submit and parse without errors for all 14 commands
for (const code of ALL_14_COMMANDS) {
  const p1 = parseCommandLineInput(code);
  const p2 = parseCommandLineInput(`${code} `);
  assert.deepStrictEqual(p2, p1, `Trailing space mismatch for command: ${code}`);
}

// (d) Ticker commands with trailing space parse identically
const pCorr1 = parseCommandLineInput('CORR AAPL MSFT');
const pCorr2 = parseCommandLineInput('CORR AAPL MSFT ');
assert.deepStrictEqual(pCorr2, pCorr1);

// (e) Prefix match detects trailing space for overhang styling
const prefixNoSpace = extractRecognizedCommandPrefix('ECO');
assert(prefixNoSpace !== null);
assert.equal(prefixNoSpace.remainder, '');

const prefixWithSpace = extractRecognizedCommandPrefix('ECO ');
assert(prefixWithSpace !== null);
assert.equal(prefixWithSpace.remainder, ' ');
assert.equal(/^\s/.test(prefixWithSpace.remainder), true);

console.log('✓ All 14 command prefix styling and caret spacing tests passed!');
