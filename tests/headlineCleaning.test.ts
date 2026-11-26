import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanHeadline, cleanTitle, decodeHtmlEntities } from '../src/components/NewsCard';

test('cleanHeadline: "Tesla\'s Self-Driving Expansion in Europe Faces a Crucial Test" stays intact', () => {
  const title = "Tesla's Self-Driving Expansion in Europe Faces a Crucial Test";
  const result = cleanHeadline(title);
  assert.equal(result, "Tesla's Self-Driving Expansion in Europe Faces a Crucial Test");
  assert.equal(cleanTitle(title), "Tesla's Self-Driving Expansion in Europe Faces a Crucial Test");
});

test('cleanHeadline: Hyphenated words ("Pre-Market", "Year-End", "Real-Time", "AI-Powered") stay intact', () => {
  const title = "Pre-Market Movers: Year-End Real-Time Rally for AI-Powered Stocks";
  assert.equal(cleanHeadline(title), "Pre-Market Movers: Year-End Real-Time Rally for AI-Powered Stocks");
});

test('cleanHeadline: "Stocks Rally on Pre-Market Gains - Reuters" becomes "Stocks Rally on Pre-Market Gains"', () => {
  const title = "Stocks Rally on Pre-Market Gains - Reuters";
  assert.equal(cleanHeadline(title, "Reuters"), "Stocks Rally on Pre-Market Gains");
  assert.equal(cleanHeadline(title), "Stocks Rally on Pre-Market Gains");
});

test('cleanHeadline: "Fed Holds Rates — Bloomberg" strips the source suffix', () => {
  const title = "Fed Holds Rates — Bloomberg";
  assert.equal(cleanHeadline(title, "Bloomberg News"), "Fed Holds Rates");
  assert.equal(cleanHeadline(title), "Fed Holds Rates");
});

test('cleanHeadline: Titles with en dash or pipe source separator strip the source suffix', () => {
  const titleEnDash = "Oil Drops Amid Inventory Build – Wall Street Journal";
  assert.equal(cleanHeadline(titleEnDash, "Wall Street Journal"), "Oil Drops Amid Inventory Build");
  assert.equal(cleanHeadline(titleEnDash), "Oil Drops Amid Inventory Build");

  const titlePipe = "Tech Sector Leads Early Session Gains | Associated Press";
  assert.equal(cleanHeadline(titlePipe, "Associated Press"), "Tech Sector Leads Early Session Gains");
  assert.equal(cleanHeadline(titlePipe), "Tech Sector Leads Early Session Gains");
});

test('cleanHeadline: Titles with no separator are unchanged', () => {
  const title = "Global Markets Steady After Mixed Inflation Data";
  assert.equal(cleanHeadline(title), "Global Markets Steady After Mixed Inflation Data");
  assert.equal(cleanHeadline(title, "Reuters"), "Global Markets Steady After Mixed Inflation Data");
});

test('cleanHeadline: Titles with a spaced dash in the middle keep everything except the final source', () => {
  const title = "Apple - Services Growth Slows - CNBC";
  assert.equal(cleanHeadline(title, "CNBC"), "Apple - Services Growth Slows");
  assert.equal(cleanHeadline(title), "Apple - Services Growth Slows");
});

test('cleanHeadline: Titles with special characters display correctly', () => {
  const rawTitle = "S&amp;P 500 Hits Record &mdash; Analysts&#39; &quot;Top Picks&quot; Gain - Reuters";
  const result = cleanHeadline(rawTitle, "Reuters");
  assert.equal(result, 'S&P 500 Hits Record — Analysts\' "Top Picks" Gain');
});

test('cleanHeadline: Source matching prevents stripping legitimate content when source does not match', () => {
  const title = "Company Update - Chapter 11";
  // "Chapter 11" is not Reuters
  assert.equal(cleanHeadline(title, "Reuters"), "Company Update - Chapter 11");
});

test('cleanHeadline: Handles composite source names like Zacks / Yahoo Finance', () => {
  const title = "Tesla's Self-Driving Expansion in Europe Faces a Crucial Test - Zacks";
  assert.equal(cleanHeadline(title, "Zacks / Yahoo Finance"), "Tesla's Self-Driving Expansion in Europe Faces a Crucial Test");
});

test('decodeHtmlEntities: Decodes common entities, numeric and hex entities', () => {
  assert.equal(decodeHtmlEntities('&amp; &quot; &#39; &#039; &apos; &lt; &gt; &nbsp; &#65; &#x42;'), '& " \' \' \' < >   A B');
  assert.equal(decodeHtmlEntities(''), '');
});
