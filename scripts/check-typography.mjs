#!/usr/bin/env node

/**
 * CI / Pre-commit Typography & Contrast Guardrail for QUORIX Terminal
 * Fails if arbitrary sub-12px classes or dim text classes are used outside justified allowlist.
 */

import fs from 'fs';
import path from 'path';

const ALLOWLIST = [
  // PRM test assertion backward-compatibility line in PortfolioRiskMonitorScreen.tsx
  { file: 'PortfolioRiskMonitorScreen.tsx', pattern: /text-\[10px\] leading-relaxed text-zinc-400 marker:text-zinc-500/ },
];

const FORBIDDEN_FONT_RE = /\btext-\[(?:8|8\.5|9|9\.5|10|10\.5|11|11\.5)px\]\b/g;
const FORBIDDEN_TEXT_COLOR_RE = /\b(?:text-zinc-500|text-zinc-600|text-gray-500|text-gray-600)\b/g;

let errors = [];

function checkFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const filename = path.basename(filePath);
  const lines = content.split('\n');

  lines.forEach((line, idx) => {
    // Check if line matches allowlist
    const isAllowed = ALLOWLIST.some(
      (entry) => entry.file === filename && entry.pattern.test(line)
    );
    if (isAllowed) return;

    const fontMatches = line.match(FORBIDDEN_FONT_RE);
    if (fontMatches) {
      errors.push(`${filePath}:${idx + 1}: Found forbidden sub-12px font class: ${fontMatches.join(', ')}`);
    }

    const colorMatches = line.match(FORBIDDEN_TEXT_COLOR_RE);
    if (colorMatches) {
      errors.push(`${filePath}:${idx + 1}: Found low-contrast dim text class: ${colorMatches.join(', ')} (use text-zinc-300 or text-zinc-400 instead)`);
    }
  });
}

function walk(dir) {
  const files = fs.readdirSync(dir);
  for (const f of files) {
    const fullPath = path.join(dir, f);
    const stat = fs.statSync(fullPath);
    if (stat.isDirectory()) {
      if (f !== 'node_modules' && f !== '.git' && f !== 'dist') {
        walk(fullPath);
      }
    } else if (f.endsWith('.tsx') || f.endsWith('.ts')) {
      checkFile(fullPath);
    }
  }
}

walk('src');

if (errors.length > 0) {
  console.error('\n❌ Typography & Contrast Guardrail Failed:');
  errors.forEach((err) => console.error('  ', err));
  console.error(`\nFound ${errors.length} violation(s). All text must adhere to the PRM style standard (STYLE.md).\n`);
  process.exit(1);
} else {
  console.log('✅ Typography & Contrast Guardrail Passed: All screens adhere to PRM style standard.');
  process.exit(0);
}
