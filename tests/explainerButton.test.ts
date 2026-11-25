import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ExplainerButton } from '../src/components/ExplainerButton';

console.log('--- Testing ExplainerButton Component ---');

const testLabel = 'How do I use the CORR Workspace?';
const testText = 'Step 1: Select assets. Step 2: Choose lookback period. Step 3: View correlation matrix.';

const html = renderToStaticMarkup(
  React.createElement(ExplainerButton, {
    label: testLabel,
    text: testText,
  })
);

// 1. Asserts that it renders a button with that aria-label
assert.ok(
  html.includes(`aria-label="${testLabel}"`),
  `Expected button to have aria-label="${testLabel}", got: ${html}`
);

// 2. Asserts that the explainer text is present in data-tooltip-text
assert.ok(
  html.includes('data-tooltip-text='),
  'Expected data-tooltip-text attribute to be present'
);
assert.ok(
  html.includes('Step 1: Select assets.'),
  'Expected explainer text to be present in data-tooltip-text'
);

// 3. Asserts that old lucide-info class is NOT present, and lucide-book-open is present instead
assert.ok(
  !html.includes('lucide-info'),
  'Expected lucide-info icon class to NOT be present on ExplainerButton'
);
assert.ok(
  html.includes('lucide-book-open'),
  'Expected lucide-book-open icon class to be present on ExplainerButton'
);

// 4. Asserts that styling classes match the standard
assert.ok(html.includes('bg-[#0c0c0c]'), 'Expected bg-[#0c0c0c]');
assert.ok(html.includes('border-[#333]'), 'Expected border-[#333]');
assert.ok(html.includes('cursor-help'), 'Expected cursor-help');
assert.ok(html.includes('p-1.5'), 'Expected p-1.5 padding');

console.log('✓ All ExplainerButton tests passed successfully!');
