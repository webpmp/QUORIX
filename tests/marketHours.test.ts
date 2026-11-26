import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isUSMarketHoliday,
  isUSMarketEarlyClose,
  getMarketTimeDetails,
  getMarketStatusBadgeStyle,
} from '../src/utils/marketHours.ts';

// Helper to construct a UTC date that maps to a specific Eastern Time
// When DST is active (EDT), UTC is ET + 4 hours.
// When standard time is active (EST), UTC is ET + 5 hours.
function createETDate(
  year: number,
  month: number,
  day: number,
  hourET: number,
  minuteET: number = 0
): Date {
  // Use ISO string formatting with explicit America/New_York offset calculation via Date
  // An easy and robust way is to start with an approximate UTC time, then compute the offset
  const approx = new Date(Date.UTC(year, month - 1, day, hourET + 5, minuteET));
  const etStr = approx.toLocaleString('en-US', { timeZone: 'America/New_York', timeZoneName: 'short' });
  const isEDT = etStr.includes('EDT');
  const offsetHours = isEDT ? 4 : 5;
  return new Date(Date.UTC(year, month - 1, day, hourET + offsetHours, minuteET));
}

test('Scenario 1: Normal weekday during regular trading hours displays INDEX TAPE', () => {
  // Wednesday, October 15, 2025 at 11:30 AM ET
  const date = createETDate(2025, 10, 15, 11, 30);
  const details = getMarketTimeDetails(date);

  assert.equal(details.status, 'INDEX TAPE');
  assert.equal(details.isCoreHours, true);
  assert.equal(details.isPreMarket, false);
  assert.equal(details.isAfterHours, false);
  assert.equal(details.isMarketClosed, false);

  const style = getMarketStatusBadgeStyle(details.status);
  assert.equal(style.text, 'INDEX TAPE');
  assert.match(style.className, /bg-\[#ff9900\]/);
});

test('Scenario 2: Normal weekday before market open displays PRE-MARKET', () => {
  // Wednesday, October 15, 2025 at 8:15 AM ET
  const date = createETDate(2025, 10, 15, 8, 15);
  const details = getMarketTimeDetails(date);

  assert.equal(details.status, 'PRE-MARKET');
  assert.equal(details.isCoreHours, false);
  assert.equal(details.isPreMarket, true);
  assert.equal(details.isAfterHours, false);
  assert.equal(details.isMarketClosed, false);

  const style = getMarketStatusBadgeStyle(details.status);
  assert.equal(style.text, 'PRE-MARKET');
  assert.match(style.className, /text-amber-400/);
});

test('Scenario 3: Normal weekday after market close displays AFTER HOURS', () => {
  // Wednesday, October 15, 2025 at 5:00 PM ET
  const date = createETDate(2025, 10, 15, 17, 0);
  const details = getMarketTimeDetails(date);

  assert.equal(details.status, 'AFTER HOURS');
  assert.equal(details.isCoreHours, false);
  assert.equal(details.isPreMarket, false);
  assert.equal(details.isAfterHours, true);
  assert.equal(details.isMarketClosed, false);

  const style = getMarketStatusBadgeStyle(details.status);
  assert.equal(style.text, 'AFTER HOURS');
  assert.match(style.className, /text-indigo-400/);
});

test('Scenario 4: Thanksgiving Day is MARKET CLOSED all day', () => {
  // Thanksgiving 2025: Thursday, November 27, 2025
  assert.equal(isUSMarketHoliday(2025, 11, 27), true);

  // During would-be regular hours (11:00 AM ET)
  const dateMidday = createETDate(2025, 11, 27, 11, 0);
  const details = getMarketTimeDetails(dateMidday);

  assert.equal(details.status, 'MARKET CLOSED');
  assert.equal(details.isHoliday, true);
  assert.equal(details.isCoreHours, false);
  assert.equal(details.isPreMarket, false);
  assert.equal(details.isAfterHours, false);
  assert.equal(details.isMarketClosed, true);

  const style = getMarketStatusBadgeStyle(details.status);
  assert.equal(style.text, 'MARKET CLOSED');
});

test('Scenario 5: Friday after Thanksgiving (Black Friday) early closure session', () => {
  // Friday after Thanksgiving 2025: November 28, 2025
  assert.equal(isUSMarketEarlyClose(2025, 11, 28), true);

  // 10:30 AM ET: regular session (INDEX TAPE)
  const morning = createETDate(2025, 11, 28, 10, 30);
  const morningDetails = getMarketTimeDetails(morning);
  assert.equal(morningDetails.status, 'INDEX TAPE');
  assert.equal(morningDetails.isCoreHours, true);
  assert.equal(morningDetails.isEarlyClose, true);

  // 1:00 PM ET: early close boundary -> transitions to AFTER HOURS
  const atClose = createETDate(2025, 11, 28, 13, 0);
  const atCloseDetails = getMarketTimeDetails(atClose);
  assert.equal(atCloseDetails.status, 'AFTER HOURS');
  assert.equal(atCloseDetails.isCoreHours, false);
  assert.equal(atCloseDetails.isAfterHours, true);

  // 2:30 PM ET: AFTER HOURS continues
  const afternoon = createETDate(2025, 11, 28, 14, 30);
  const afternoonDetails = getMarketTimeDetails(afternoon);
  assert.equal(afternoonDetails.status, 'AFTER HOURS');
  assert.equal(afternoonDetails.isCoreHours, false);
  assert.equal(afternoonDetails.isAfterHours, true);

  // 8:01 PM ET: closed overnight
  const night = createETDate(2025, 11, 28, 20, 1);
  const nightDetails = getMarketTimeDetails(night);
  assert.equal(nightDetails.status, 'MARKET CLOSED');
});

test('Scenario 6: Christmas Day is MARKET CLOSED', () => {
  // Christmas 2025: Thursday, December 25, 2025
  assert.equal(isUSMarketHoliday(2025, 12, 25), true);

  const date = createETDate(2025, 12, 25, 14, 0);
  const details = getMarketTimeDetails(date);

  assert.equal(details.status, 'MARKET CLOSED');
  assert.equal(details.isHoliday, true);
  assert.equal(details.isMarketClosed, true);
});

test('Scenario 7: Saturday and Sunday are MARKET CLOSED', () => {
  // Saturday, October 18, 2025 at 12:00 PM ET
  const sat = createETDate(2025, 10, 18, 12, 0);
  const satDetails = getMarketTimeDetails(sat);
  assert.equal(satDetails.status, 'MARKET CLOSED');
  assert.equal(satDetails.isWeekend, true);
  assert.equal(satDetails.isMarketClosed, true);

  // Sunday, October 19, 2025 at 12:00 PM ET
  const sun = createETDate(2025, 10, 19, 12, 0);
  const sunDetails = getMarketTimeDetails(sun);
  assert.equal(sunDetails.status, 'MARKET CLOSED');
  assert.equal(sunDetails.isWeekend, true);
  assert.equal(sunDetails.isMarketClosed, true);
});

test('Scenario 8: Weekday holiday observed when actual date falls on a weekend', () => {
  // In 2021, July 4 fell on Sunday -> observed on Monday, July 5, 2021
  assert.equal(isUSMarketHoliday(2021, 7, 5), true);
  const obsMonday = createETDate(2021, 7, 5, 11, 0);
  const obsDetails = getMarketTimeDetails(obsMonday);
  assert.equal(obsDetails.status, 'MARKET CLOSED');
  assert.equal(obsDetails.isHoliday, true);

  // In 2021, Juneteenth (June 19) fell on Saturday; in 2022 it was first observed by NYSE on Monday, June 20, 2022
  assert.equal(isUSMarketHoliday(2022, 6, 20), true);
  const juneMonday = createETDate(2022, 6, 20, 11, 0);
  assert.equal(getMarketTimeDetails(juneMonday).status, 'MARKET CLOSED');

  // When Christmas falls on Sunday (e.g. 2022-12-25), Monday Dec 26 is observed
  assert.equal(isUSMarketHoliday(2022, 12, 26), true);
  const xmasObserved = createETDate(2022, 12, 26, 10, 0);
  assert.equal(getMarketTimeDetails(xmasObserved).status, 'MARKET CLOSED');
});

test('Scenario 9: Daylight saving time transition maintains accurate Eastern Time calculations', () => {
  // US DST starts 2nd Sunday in March, ends 1st Sunday in November
  // Example 2025:
  // - March 9, 2025: DST begins (clocks forward, UTC-4 EDT)
  // - Monday, March 10, 2025 (EDT): 9:30 AM ET should be INDEX TAPE
  const postSpringForward = createETDate(2025, 3, 10, 9, 35);
  const springDetails = getMarketTimeDetails(postSpringForward);
  assert.equal(springDetails.status, 'INDEX TAPE');
  assert.match(springDetails.easternTimeString, /2025-03-10 09:35 ET/);

  // - November 2, 2025: DST ends (clocks back, UTC-5 EST)
  // - Monday, November 3, 2025 (EST): 9:30 AM ET should be INDEX TAPE
  const postFallBack = createETDate(2025, 11, 3, 9, 35);
  const fallDetails = getMarketTimeDetails(postFallBack);
  assert.equal(fallDetails.status, 'INDEX TAPE');
  assert.match(fallDetails.easternTimeString, /2025-11-03 09:35 ET/);
});

test('Good Friday and other floating US market holidays', () => {
  // Good Friday 2025 is April 18, 2025
  assert.equal(isUSMarketHoliday(2025, 4, 18), true);
  const gf2025 = createETDate(2025, 4, 18, 12, 0);
  assert.equal(getMarketTimeDetails(gf2025).status, 'MARKET CLOSED');

  // Martin Luther King Jr Day 2025: 3rd Monday in Jan = Jan 20, 2025
  assert.equal(isUSMarketHoliday(2025, 1, 20), true);

  // Presidents Day 2025: 3rd Monday in Feb = Feb 17, 2025
  assert.equal(isUSMarketHoliday(2025, 2, 17), true);

  // Memorial Day 2025: Last Monday in May = May 26, 2025
  assert.equal(isUSMarketHoliday(2025, 5, 26), true);

  // Labor Day 2025: 1st Monday in Sep = Sep 1, 2025
  assert.equal(isUSMarketHoliday(2025, 9, 1), true);
});

test('Verified early close calendar rules for July 3 and Christmas Eve', () => {
  // 2024: July 4 was Thursday. July 3 was Wednesday -> scheduled 1:00 PM early close
  assert.equal(isUSMarketEarlyClose(2024, 7, 3), true);

  // 2024: Dec 25 was Wednesday. Dec 24 was Tuesday -> scheduled 1:00 PM early close
  assert.equal(isUSMarketEarlyClose(2024, 12, 24), true);

  // 2021: July 4 was Sunday (observed Mon July 5). July 3 was Saturday -> NOT an early close day
  assert.equal(isUSMarketEarlyClose(2021, 7, 3), false);

  // 2022: Dec 25 was Sunday. Dec 24 was Saturday -> NOT an early close day
  assert.equal(isUSMarketEarlyClose(2022, 12, 24), false);

  // 2023: Dec 25 was Monday. Dec 24 was Sunday -> Dec 24 is NOT an early close day
  assert.equal(isUSMarketEarlyClose(2023, 12, 24), false);
});
