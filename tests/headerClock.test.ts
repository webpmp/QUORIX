import { test } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import Header from '../src/components/Header';

export function formatLocalTimeWithZoneHelper(date: Date, explicitTimeZone?: string): string {
  let tzAbbr = 'LOC';
  try {
    const opts: Intl.DateTimeFormatOptions = { timeZoneName: 'short' };
    if (explicitTimeZone) opts.timeZone = explicitTimeZone;
    const parts = new Intl.DateTimeFormat('en-US', opts).formatToParts(date);
    const found = parts.find((p) => p.type === 'timeZoneName')?.value;
    if (found) tzAbbr = found;
  } catch {
    // fallback
  }
  const timeStr = date.toLocaleTimeString('en-GB', {
    timeZone: explicitTimeZone,
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  return `${tzAbbr} ${timeStr}`;
}

test('Top Status Bar: Header renders live local clock with dynamic timezone abbreviation', () => {
  const html = renderToStaticMarkup(
    React.createElement(Header, {
      currentCommand: '',
      onCommandChange: () => {},
      onCommandSubmit: () => {},
      activeScreen: 'GP',
    })
  );

  assert.ok(html.includes('CONNECTED'), 'Header must display CONNECTED status');
  // Check for GMT, NY, LDN, TYO clocks
  assert.ok(html.includes('GMT '), 'Header must display GMT clock');
  assert.ok(html.includes('NY</span> '), 'Header must display NY clock');
  assert.ok(html.includes('LDN</span> '), 'Header must display LDN clock');
  assert.ok(html.includes('TYO</span> '), 'Header must display TYO clock');

  // Verify that the clock format includes 2-digit hour:minute:second
  const clockMatch = html.match(/\b(?:PST|PDT|EST|EDT|CST|CDT|MST|MDT|GMT[+-]?\d*|[A-Z]{3,4})\s+\d{2}:\d{2}:\d{2}\b/);
  assert.ok(clockMatch, `Expected local clock with timezone abbreviation and HH:MM:SS, found HTML: ${html.slice(0, 500)}`);
});

test('Timezone Formatting: Correctly detects PST in winter and PDT in summer for Pacific time', () => {
  const winterDate = new Date('2026-11-26T20:30:11-08:00');
  const summerDate = new Date('2026-07-01T12:00:00-07:00');

  const winterFormatted = formatLocalTimeWithZoneHelper(winterDate, 'America/Los_Angeles');
  assert.equal(winterFormatted, 'PST 20:30:11');

  const summerFormatted = formatLocalTimeWithZoneHelper(summerDate, 'America/Los_Angeles');
  assert.equal(summerFormatted, 'PDT 12:00:00');
});

test('Timezone Formatting: Automatically supports other local timezones (e.g. EST/EDT)', () => {
  const winterDate = new Date('2026-01-15T15:45:30Z');
  const summerDate = new Date('2026-07-15T15:45:30Z');

  const winterNY = formatLocalTimeWithZoneHelper(winterDate, 'America/New_York');
  assert.equal(winterNY, 'EST 10:45:30');

  const summerNY = formatLocalTimeWithZoneHelper(summerDate, 'America/New_York');
  assert.equal(summerNY, 'EDT 11:45:30');
});
