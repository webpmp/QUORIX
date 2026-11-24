# QUORIX Terminal Design System & Style Standard

This document outlines the typography, contrast, color, and density standards established by the **Portfolio Risk Monitor (PRM)** standard across all QUORIX Terminal screens.

---

## 1. Typography Scale

All text in the application adheres to the following floor scale. Arbitrary pixel font sizes (`text-[9px]`, `text-[10px]`, etc.) are forbidden outside justified test or canvas scenarios:

| Category | Token / Class | Size | Typical Usages |
|---|---|---|---|
| **Labels & Captions** | `--text-label` / `text-xs` | 12px (0.75rem) | Table column headers, card titles, metadata, pill tags, badges |
| **Body & Table Cells** | `--text-body` / `text-[13px]` | 13px (0.8125rem) | Table row cells, description paragraphs, form inputs, dialog copy |
| **Headline / Stat Numbers** | Values (`text-sm`, `text-base`, `text-lg`) | 14px–20px | Financial metrics, dollar values, percentages, ticker symbols |

---

## 2. Text Tiers & Contrast Standard

All text on near-black backgrounds (`#010101`, `#050505`, `#080808`, `#0a0a0a`) must meet or exceed a **4.5:1** contrast ratio:

- **Primary Text Tier:** Near-white (`#ffffff`, `text-zinc-100`, `text-zinc-200`) for active data, metrics, and key headings.
- **Secondary Text Tier:** High-contrast gray (`text-zinc-300`, `text-zinc-400`). **Do not use `text-zinc-500`, `text-zinc-600`, `text-gray-500`, or `text-gray-600` on dark surfaces**.
- **Status Colors:**
  - **Positive / Buy / Low Risk:** `#00ff00`
  - **Warning / Moderate Risk / Highlights:** `#ff9900`
  - **Negative / High Risk / Losses:** `#ff4444`
  - **Selected / Informational:** `#3498db`

---

## 3. Borders & Dividers

Faint, invisible borders on dark surfaces have been unified to semantic border tokens:

- **Subtle Borders (`border-subtle`):** `#3a3a3a` (used on cards, panels, inputs, buttons).
- **Dividers (`border-divider`):** `#2e2e2e` (used for table row separators, internal section lines).

---

## 4. Interactive Buttons & Navigation Pills

- Minimum height of **32px** (`min-h-8`).
- Font size of **12px** (`text-xs`).
- Bold uppercase typography with consistent focus and hover states (`hover:border-[#ff9900]`, `focus-visible:ring-1`).

---

## 5. Density & High-Density Screens

For dense financial data (such as the Correlation Matrix in `CORR`, 13F Holdings in `INST`, Sector Breakdown in `SECT`, and Order Tables in `POLY`):

1. **Do not shrink text** below the 12px label / 13px cell standard to fit columns.
2. Use horizontal scroll wrappers (`overflow-x-auto`) or column wrapping (`whitespace-nowrap` on figures, `truncate` on company names).
3. Ensure numerical data is tabular (`tabular-nums font-mono`).

---

## 6. Regression Testing

Run the automated typography and contrast check:
```bash
npm run check:typography
```
This check ensures no arbitrary `<12px` font classes or low-contrast gray text classes are introduced into the codebase.
