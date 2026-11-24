#!/usr/bin/env node

/**
 * CI / Pre-commit Typography & Contrast Guardrail for QUORIX Terminal
 * Fails if:
 * 1. Arbitrary font classes text-[Npx] (where N != 13) are used
 * 2. Dim text classes (text-zinc-500, text-zinc-600, etc.) appear in static classes, template strings, or cn/clsx calls
 * 3. Text fill/stroke colors on dark surfaces fall below ~4.5:1 contrast
 */

import fs from 'fs';
import path from 'path';

// Allowlist for strictly justified scenarios
const ALLOWLIST = [
  // PRM test assertion backward-compatibility line in PortfolioRiskMonitorScreen.tsx
  { file: 'PortfolioRiskMonitorScreen.tsx', pattern: /text-\[10px\] leading-relaxed text-zinc-400 marker:text-zinc-500/ },
  // Pre-market micro badge in CommandPanel.tsx
  { file: 'CommandPanel.tsx', pattern: /text-\[10px\] leading-tight bg-amber-500\/20/ },
];

// Helper for relative luminance and contrast ratio
function hexToRgb(hex) {
  let clean = hex.replace('#', '');
  if (clean.length === 3) {
    clean = clean.split('').map(c => c + c).join('');
  }
  return [
    parseInt(clean.slice(0, 2), 16),
    parseInt(clean.slice(2, 4), 16),
    parseInt(clean.slice(4, 6), 16),
  ];
}

function relLuminance([r, g, b]) {
  const sRGB = [r, g, b].map(v => {
    v /= 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * sRGB[0] + 0.7152 * sRGB[1] + 0.0722 * sRGB[2];
}

function contrastRatio(hex1, hex2 = '#050505') {
  const l1 = relLuminance(hexToRgb(hex1));
  const l2 = relLuminance(hexToRgb(hex2));
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

// 1. Any text-[Npx] other than the approved 13px token (text-[13px])
const ARBITRARY_FONT_RE = /\btext-\[(?!13px\])(\d+(?:\.\d+)?px)\]/g;

// 2. Dim text classes in static classes, template literals (`...`), or cn/clsx
const FORBIDDEN_DIM_TEXT_RE = /(?:class(?:Name)?\s*=\s*["'`]|`|\b(?:cn|clsx)\([^)]*)[^"'`)]*\b(text-zinc-500|text-zinc-600|text-gray-500|text-gray-600)\b/g;

// 3. SVG / Canvas text colors (fill="..." or stroke="...") on dark surfaces
const SVG_TEXT_FILL_RE = /<text[^>]*\b(?:fill|stroke)\s*=\s*["'](#[0-9a-fA-F]{3,6})["'][^>]*>/g;

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

    // Check 1: Arbitrary font sizes
    let fontMatch;
    while ((fontMatch = ARBITRARY_FONT_RE.exec(line)) !== null) {
      errors.push(`${filePath}:${idx + 1}: Found unapproved arbitrary font size "text-[${fontMatch[1]}]". Use semantic text-xs (12px) or approved token text-[13px].`);
    }

    // Check 2: Dim text classes
    let dimMatch;
    while ((dimMatch = FORBIDDEN_DIM_TEXT_RE.exec(line)) !== null) {
      errors.push(`${filePath}:${idx + 1}: Found low-contrast dim text class "${dimMatch[1]}" (use text-zinc-300 or text-zinc-400 instead).`);
    }

    // Check 3: SVG text fill contrast
    let svgMatch;
    while ((svgMatch = SVG_TEXT_FILL_RE.exec(line)) !== null) {
      const hex = svgMatch[1];
      try {
        const ratio = contrastRatio(hex, '#050505');
        if (ratio < 4.5) {
          errors.push(`${filePath}:${idx + 1}: Found low-contrast SVG text fill "${hex}" (${ratio.toFixed(2)}:1 < 4.5:1 on dark surface).`);
        }
      } catch (e) {
        // Ignore unparseable colors
      }
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
  console.error(`\nFound ${errors.length} violation(s). All text and colors must adhere to the PRM style standard (STYLE.md).\n`);
  process.exit(1);
} else {
  console.log('✅ Typography & Contrast Guardrail Passed: All screens adhere to PRM style standard.');
  process.exit(0);
}
