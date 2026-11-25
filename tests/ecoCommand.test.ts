import assert from 'node:assert/strict';
import { parseCommandLineInput } from '../src/utils/commandParser';
import {
  normalizeEcoCategory,
  filterFredReleasesByCategory,
  ECO_RELEASE_CATEGORIES,
} from '../src/utils/ecoReleaseFilter';
import type { FredReleaseDate } from '../src/types';

console.log('--- Testing ECO Command and Release Filtering ---');

// 1. Verify normalizeEcoCategory resolves all 15 supported categories
const expectedCategories = [
  'CPI',
  'PPI',
  'PCE',
  'FOMC',
  'GDP',
  'NFP',
  'CLAIMS',
  'JOLTS',
  'RETAIL',
  'DURABLE',
  'INDPRO',
  'HOUSING',
  'SOFR',
  'RATES',
  'VIX',
];

for (const cat of expectedCategories) {
  assert.equal(
    normalizeEcoCategory(cat),
    cat,
    `normalizeEcoCategory(${cat}) should return ${cat}`
  );
  assert.equal(
    normalizeEcoCategory(cat.toLowerCase()),
    cat,
    `normalizeEcoCategory(${cat.toLowerCase()}) should case-insensitively return ${cat}`
  );
}

// Check aliases / alternative tokens
assert.equal(normalizeEcoCategory('PAYROLLS'), 'NFP');
assert.equal(normalizeEcoCategory('JOBLESS CLAIMS'), 'CLAIMS');
assert.equal(normalizeEcoCategory('H15'), 'RATES');
assert.equal(normalizeEcoCategory('TREASURY'), 'RATES');
assert.equal(normalizeEcoCategory('INVALID_NAME'), null);

// 2. Test parseCommandLineInput for ECO commands
const parsedEco = parseCommandLineInput('ECO');
assert.deepEqual(parsedEco, { type: 'SCREEN', screen: 'ECO' });

const parsedEcoLower = parseCommandLineInput('eco');
assert.deepEqual(parsedEcoLower, { type: 'SCREEN', screen: 'ECO' });

const parsedMacro = parseCommandLineInput('MACRO');
assert.deepEqual(parsedMacro, { type: 'SCREEN', screen: 'ECO' });

// Verify all 15 category commands
for (const cat of expectedCategories) {
  const result = parseCommandLineInput(`ECO ${cat}`);
  assert.deepEqual(
    result,
    { type: 'TICKER_SCREEN', ticker: cat, screen: 'ECO' },
    `parseCommandLineInput("ECO ${cat}") failed`
  );

  // Case-insensitive
  const resultLower = parseCommandLineInput(`eco ${cat.toLowerCase()}`);
  assert.deepEqual(
    resultLower,
    { type: 'TICKER_SCREEN', ticker: cat, screen: 'ECO' },
    `parseCommandLineInput("eco ${cat.toLowerCase()}") failed`
  );
}

// 3. Test invalid ECO category produces INVALID_COMMAND with error message
const invalidRes = parseCommandLineInput('ECO INVALID_CAT');
assert.equal(invalidRes.type, 'INVALID_COMMAND');
if (invalidRes.type === 'INVALID_COMMAND') {
  assert.equal(invalidRes.screen, 'ECO');
  assert(invalidRes.error.includes('Unrecognized release category'));
}

// 4. Test filterFredReleasesByCategory
const mockReleases: FredReleaseDate[] = [
  { releaseId: 10, releaseName: 'Consumer Price Index', date: '2026-05-12', pressRelease: true },
  { releaseId: 44, releaseName: 'Producer Price Index', date: '2026-05-13', pressRelease: true },
  { releaseId: 54, releaseName: 'Personal Income and Outlays', date: '2026-05-29', pressRelease: true },
  { releaseId: 25, releaseName: 'FOMC Statement', date: '2026-05-06', pressRelease: true },
  { releaseId: 53, releaseName: 'Gross Domestic Product', date: '2026-05-28', pressRelease: true },
  { releaseId: 50, releaseName: 'Employment Situation', date: '2026-05-08', pressRelease: true },
  { releaseId: 298, releaseName: 'Unemployment Insurance Weekly Claims Report', date: '2026-05-14', pressRelease: true },
  { releaseId: 52, releaseName: 'Job Openings and Labor Turnover Survey', date: '2026-05-05', pressRelease: true },
  { releaseId: 9, releaseName: 'Advance Monthly Sales for Retail and Food Services', date: '2026-05-15', pressRelease: true },
  { releaseId: 45, releaseName: 'Manufacturers Shipments, Inventories, and Orders', date: '2026-05-27', pressRelease: true },
  { releaseId: 13, releaseName: 'Industrial Production and Capacity Utilization', date: '2026-05-15', pressRelease: true },
  { releaseId: 26, releaseName: 'New Residential Construction', date: '2026-05-19', pressRelease: true },
  { releaseId: 433, releaseName: 'Secured Overnight Financing Rate Data', date: '2026-05-15', pressRelease: false },
  { releaseId: 18, releaseName: 'Selected Interest Rates (Daily) - H.15', date: '2026-05-15', pressRelease: false },
  { releaseId: 204, releaseName: 'CBOE Volatility Index', date: '2026-05-15', pressRelease: false },
  { releaseId: 999, releaseName: 'Random Unrelated Report', date: '2026-05-15', pressRelease: false },
];

// Null or empty category returns all releases
assert.equal(filterFredReleasesByCategory(mockReleases, null).length, mockReleases.length);
assert.equal(filterFredReleasesByCategory(mockReleases, '').length, mockReleases.length);

// Each category filters appropriately
const cpiMatches = filterFredReleasesByCategory(mockReleases, 'CPI');
assert.equal(cpiMatches.length, 1);
assert.equal(cpiMatches[0].releaseId, 10);

const claimsMatches = filterFredReleasesByCategory(mockReleases, 'CLAIMS');
assert.equal(claimsMatches.length, 1);
assert.equal(claimsMatches[0].releaseId, 298);

const fomcMatches = filterFredReleasesByCategory(mockReleases, 'FOMC');
assert.equal(fomcMatches.length, 1);
assert.equal(fomcMatches[0].releaseId, 25);

// 5. Test filter query matching behavior as used in Workspace RELEASE input
function filterReleasesWithQuery(releases: FredReleaseDate[], query: string): FredReleaseDate[] {
  const normalizedQuery = query.trim().toLowerCase();
  const matchedCategory = normalizeEcoCategory(query);
  return releases.filter((rel) => {
    if (!normalizedQuery) return true;
    if (matchedCategory) {
      const meta = ECO_RELEASE_CATEGORIES[matchedCategory];
      if (meta.releaseIds.includes(rel.releaseId)) return true;
      const lowerName = rel.releaseName.toLowerCase();
      if (meta.terms.some((term) => lowerName.includes(term))) return true;
    }
    return (
      rel.releaseName.toLowerCase().includes(normalizedQuery) ||
      rel.date.includes(normalizedQuery) ||
      String(rel.releaseId).includes(normalizedQuery)
    );
  });
}

// Check synchronized filter value from "ECO CPI" -> input populated with "CPI"
const inputFilteredCpi = filterReleasesWithQuery(mockReleases, 'CPI');
assert.equal(inputFilteredCpi.length, 1);
assert.equal(inputFilteredCpi[0].releaseId, 10);

// Check manual query "gdp"
const inputFilteredGdp = filterReleasesWithQuery(mockReleases, 'gdp');
assert.equal(inputFilteredGdp.length, 1);
assert.equal(inputFilteredGdp[0].releaseId, 53);

// Check manual query for part of release name "Weekly Claims"
const inputFilteredPartial = filterReleasesWithQuery(mockReleases, 'Weekly Claims');
assert.equal(inputFilteredPartial.length, 1);
assert.equal(inputFilteredPartial[0].releaseId, 298);

// Check empty input -> all releases
assert.equal(filterReleasesWithQuery(mockReleases, '').length, mockReleases.length);

console.log('✓ All ECO command and release filter tests passed!');
