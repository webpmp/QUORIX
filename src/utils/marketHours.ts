/**
 * US Stock Market (NYSE / Nasdaq) Hours & Calendar Utility
 *
 * Implements official market hours, full-day holidays, observed holidays,
 * and scheduled early market closures (1:00 PM Eastern Time).
 *
 * Market Statuses:
 * - INDEX TAPE: Regular trading session (9:30 AM - 4:00 PM ET, or 9:30 AM - 1:00 PM ET on early close days)
 * - PRE-MARKET: 4:00 AM - 9:30 AM ET on valid trading days
 * - AFTER HOURS: After regular trading session until 8:00 PM ET (4:00 PM - 8:00 PM ET, or 1:00 PM - 8:00 PM ET on early close days)
 * - MARKET CLOSED: Weekends, full-day holidays, observed holidays, and overnight (8:00 PM - 4:00 AM ET)
 */

export type MarketStatus = 'INDEX TAPE' | 'PRE-MARKET' | 'AFTER HOURS' | 'MARKET CLOSED';

export interface MarketTimeDetails {
  status: MarketStatus;
  isCoreHours: boolean;
  isPreMarket: boolean;
  isAfterHours: boolean;
  isMarketClosed: boolean;
  isWeekend: boolean;
  isHoliday: boolean;
  isEarlyClose: boolean;
  easternTimeString: string;
}

/**
 * Calculates Western Christian Easter Sunday for any given year using the Anonymous Gregorian algorithm.
 */
function getEasterSunday(year: number): { month: number; day: number } {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31); // 3 = March, 4 = April
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return { month, day };
}

/**
 * Calculates Good Friday (the Friday before Easter Sunday).
 */
function getGoodFriday(year: number): { month: number; day: number } {
  const easter = getEasterSunday(year);
  // Subtract 2 days from Easter Sunday
  const date = new Date(Date.UTC(year, easter.month - 1, easter.day - 2));
  return { month: date.getUTCMonth() + 1, day: date.getUTCDate() };
}

/**
 * Finds the date of the nth weekday of a month (e.g. 3rd Monday in January).
 * weekday: 0 = Sun, 1 = Mon, ..., 6 = Sat
 * n: 1, 2, 3, 4, etc.
 */
function getNthWeekdayOfMonth(year: number, month: number, weekday: number, n: number): number {
  let count = 0;
  for (let day = 1; day <= 31; day++) {
    const d = new Date(Date.UTC(year, month - 1, day));
    if (d.getUTCMonth() !== month - 1) break;
    if (d.getUTCDay() === weekday) {
      count++;
      if (count === n) return day;
    }
  }
  return 1;
}

/**
 * Finds the last occurrence of a weekday in a month (e.g. last Monday in May).
 */
function getLastWeekdayOfMonth(year: number, month: number, weekday: number): number {
  let lastDay = 1;
  for (let day = 1; day <= 31; day++) {
    const d = new Date(Date.UTC(year, month - 1, day));
    if (d.getUTCMonth() !== month - 1) break;
    if (d.getUTCDay() === weekday) {
      lastDay = day;
    }
  }
  return lastDay;
}

/**
 * Applies US market weekend observation rule for fixed-date holidays:
 * - If holiday falls on Saturday -> observed on Friday preceding (day - 1)
 * - If holiday falls on Sunday -> observed on Monday following (day + 1)
 * - If holiday falls on Monday-Friday -> observed on actual day
 */
function getObservedFixedHoliday(year: number, month: number, day: number): { year: number; month: number; day: number } {
  const d = new Date(Date.UTC(year, month - 1, day));
  const dow = d.getUTCDay();
  if (dow === 6) {
    // Saturday -> Friday before
    const prev = new Date(Date.UTC(year, month - 1, day - 1));
    return { year: prev.getUTCFullYear(), month: prev.getUTCMonth() + 1, day: prev.getUTCDate() };
  } else if (dow === 0) {
    // Sunday -> Monday after
    const next = new Date(Date.UTC(year, month - 1, day + 1));
    return { year: next.getUTCFullYear(), month: next.getUTCMonth() + 1, day: next.getUTCDate() };
  }
  return { year, month, day };
}

/**
 * Checks whether the given date (in ET) is an official full-day US stock market holiday.
 *
 * Official NYSE / Nasdaq Holidays:
 * 1. New Year's Day (Jan 1, observed)
 * 2. Martin Luther King, Jr. Day (3rd Monday in January)
 * 3. Washington's Birthday / Presidents' Day (3rd Monday in February)
 * 4. Good Friday (Friday before Easter)
 * 5. Memorial Day (Last Monday in May)
 * 6. Juneteenth National Independence Day (June 19, observed, instituted 2021/first observed by exchanges 2022)
 * 7. Independence Day (July 4, observed)
 * 8. Labor Day (1st Monday in September)
 * 9. Thanksgiving Day (4th Thursday in November)
 * 10. Christmas Day (Dec 25, observed)
 */
export function isUSMarketHoliday(year: number, month: number, day: number): boolean {
  // 1. New Year's Day (Jan 1 observed)
  // Note: If Jan 1 falls on Saturday, Dec 31 of prior year is NOT observed as an exchange holiday
  // under NYSE Rule 7.2 (if holiday is Saturday, market is closed Friday EXCEPT when holiday is Jan 1).
  const nyObserved = getObservedFixedHoliday(year, 1, 1);
  if (nyObserved.year === year && nyObserved.month === month && nyObserved.day === day) {
    // Avoid closing Dec 31 if Jan 1 is Saturday
    const jan1Dow = new Date(Date.UTC(year, 0, 1)).getUTCDay();
    if (!(jan1Dow === 6 && month === 12 && day === 31)) {
      return true;
    }
  }

  // 2. Martin Luther King, Jr. Day: 3rd Monday in January
  if (month === 1 && day === getNthWeekdayOfMonth(year, 1, 1, 3)) {
    return true;
  }

  // 3. Washington's Birthday (Presidents' Day): 3rd Monday in February
  if (month === 2 && day === getNthWeekdayOfMonth(year, 2, 1, 3)) {
    return true;
  }

  // 4. Good Friday
  const goodFriday = getGoodFriday(year);
  if (month === goodFriday.month && day === goodFriday.day) {
    return true;
  }

  // 5. Memorial Day: Last Monday in May
  if (month === 5 && day === getLastWeekdayOfMonth(year, 5, 1)) {
    return true;
  }

  // 6. Juneteenth National Independence Day (June 19, observed - established 2022 for NYSE/Nasdaq)
  if (year >= 2022) {
    const juneObserved = getObservedFixedHoliday(year, 6, 19);
    if (juneObserved.month === month && juneObserved.day === day) {
      return true;
    }
  }

  // 7. Independence Day: July 4 (observed)
  const july4Observed = getObservedFixedHoliday(year, 7, 4);
  if (july4Observed.month === month && july4Observed.day === day) {
    return true;
  }

  // 8. Labor Day: 1st Monday in September
  if (month === 9 && day === getNthWeekdayOfMonth(year, 9, 1, 1)) {
    return true;
  }

  // 9. Thanksgiving Day: 4th Thursday in November
  if (month === 11 && day === getNthWeekdayOfMonth(year, 11, 4, 4)) {
    return true;
  }

  // 10. Christmas Day: Dec 25 (observed)
  const xmasObserved = getObservedFixedHoliday(year, 12, 25);
  if (xmasObserved.month === month && xmasObserved.day === day) {
    return true;
  }

  return false;
}

/**
 * Checks whether the given date (in ET) is an officially scheduled early market close (1:00 PM ET).
 *
 * Official NYSE / Nasdaq Early Close Rules:
 * 1. Day after Thanksgiving (Black Friday, 4th Friday in November): 1:00 PM ET early close.
 * 2. Day before Independence Day (July 3): Closes early (1:00 PM ET) ONLY when July 4 falls on a weekday
 *    (Tuesday, Wednesday, Thursday, Friday). If July 4 is Sunday (observed Monday July 5) or Saturday (observed Friday July 3),
 *    July 3 is NOT an early close day (if July 4 is Saturday, July 3 is fully closed as the observed holiday).
 * 3. Christmas Eve (December 24): Closes early (1:00 PM ET) ONLY if Christmas (Dec 25) falls on a Tuesday through Friday
 *    (meaning Dec 24 is a Monday through Thursday). If Christmas falls on a weekend or Monday, Dec 24 is NOT an early close.
 */
export function isUSMarketEarlyClose(year: number, month: number, day: number): boolean {
  // 1. Day after Thanksgiving (Black Friday)
  // Thanksgiving is the 4th Thursday of November; Black Friday is the following day.
  const thanksgivingDay = getNthWeekdayOfMonth(year, 11, 4, 4);
  if (month === 11 && day === thanksgivingDay + 1) {
    return true;
  }

  // 2. Day before Independence Day (July 3)
  // Only closes early if July 4 falls on a Tuesday, Wednesday, Thursday, or Friday.
  if (month === 7 && day === 3) {
    const july4Dow = new Date(Date.UTC(year, 6, 4)).getUTCDay(); // 0 = Sun, 1 = Mon, ..., 6 = Sat
    // If July 4 is Tuesday (2), Wednesday (3), Thursday (4), or Friday (5), July 3 is an early close (1:00 PM ET)
    if (july4Dow >= 2 && july4Dow <= 5) {
      return true;
    }
  }

  // 3. Christmas Eve (December 24)
  // Closes early ONLY when Christmas (Dec 25) is Tuesday through Friday (so Dec 24 is Monday through Thursday).
  if (month === 12 && day === 24) {
    const xmasDow = new Date(Date.UTC(year, 11, 25)).getUTCDay();
    if (xmasDow >= 2 && xmasDow <= 5) {
      return true;
    }
  }

  return false;
}

interface ParsedETTime {
  year: number;
  month: number;
  day: number;
  dayOfWeek: number;
  hours: number;
  minutes: number;
  totalMinutes: number;
  dateString: string;
}

/**
 * Extracts accurate Eastern Time date and time components regardless of local timezone or DST.
 */
export function getEasternTimeComponents(date: Date = new Date()): ParsedETTime {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    weekday: 'short',
    hour: 'numeric',
    minute: 'numeric',
    hour12: false,
  });

  const parts = dtf.formatToParts(date);
  let year = date.getUTCFullYear();
  let month = 1;
  let day = 1;
  let hours = 0;
  let minutes = 0;
  let weekdayStr = '';

  for (const part of parts) {
    if (part.type === 'year') year = parseInt(part.value, 10);
    else if (part.type === 'month') month = parseInt(part.value, 10);
    else if (part.type === 'day') day = parseInt(part.value, 10);
    else if (part.type === 'hour') {
      const h = parseInt(part.value, 10);
      // In hour12: false, 24 can occasionally appear for midnight in some ICU environments
      hours = h === 24 ? 0 : h;
    } else if (part.type === 'minute') minutes = parseInt(part.value, 10);
    else if (part.type === 'weekday') weekdayStr = part.value;
  }

  const weekdayMap: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };
  const dayOfWeek = weekdayMap[weekdayStr] ?? 0;
  const totalMinutes = hours * 60 + minutes;

  const dateString = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')} ${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')} ET`;

  return {
    year,
    month,
    day,
    dayOfWeek,
    hours,
    minutes,
    totalMinutes,
    dateString,
  };
}

/**
 * Determines comprehensive US Stock Market status for a given point in time.
 */
export function getMarketTimeDetails(now: Date = new Date()): MarketTimeDetails {
  const et = getEasternTimeComponents(now);

  const isWeekend = et.dayOfWeek === 0 || et.dayOfWeek === 6;
  const isHoliday = !isWeekend && isUSMarketHoliday(et.year, et.month, et.day);
  const isEarlyClose = !isWeekend && !isHoliday && isUSMarketEarlyClose(et.year, et.month, et.day);

  // If weekend or holiday, market is full-day closed
  if (isWeekend || isHoliday) {
    return {
      status: 'MARKET CLOSED',
      isCoreHours: false,
      isPreMarket: false,
      isAfterHours: false,
      isMarketClosed: true,
      isWeekend,
      isHoliday,
      isEarlyClose: false,
      easternTimeString: et.dateString,
    };
  }

  // Pre-market: 4:00 AM to 9:30 AM ET (240 to 570 minutes)
  const isPreMarket = et.totalMinutes >= 4 * 60 && et.totalMinutes < 9 * 60 + 30;

  // Regular/Core Hours:
  // Standard day: 9:30 AM to 4:00 PM ET (570 to 960 minutes)
  // Early-close day: 9:30 AM to 1:00 PM ET (570 to 780 minutes)
  const closeMinutes = isEarlyClose ? 13 * 60 : 16 * 60;
  const isCoreHours = et.totalMinutes >= 9 * 60 + 30 && et.totalMinutes < closeMinutes;

  // After Hours:
  // From close until 8:00 PM ET (closeMinutes to 1200 minutes)
  const isAfterHours = et.totalMinutes >= closeMinutes && et.totalMinutes < 20 * 60;

  // Overnight or outside trading windows (e.g. 12:00 AM - 4:00 AM or 8:00 PM - 11:59 PM)
  const isMarketClosed = !isPreMarket && !isCoreHours && !isAfterHours;

  let status: MarketStatus = 'MARKET CLOSED';
  if (isCoreHours) {
    status = 'INDEX TAPE';
  } else if (isPreMarket) {
    status = 'PRE-MARKET';
  } else if (isAfterHours) {
    status = 'AFTER HOURS';
  }

  return {
    status,
    isCoreHours,
    isPreMarket,
    isAfterHours,
    isMarketClosed,
    isWeekend: false,
    isHoliday: false,
    isEarlyClose,
    easternTimeString: et.dateString,
  };
}

/**
 * Returns consistent, distinctive styling for the 4 market status states.
 * Preserves the exact default dimensions and typography of the original badge:
 * `text-xs px-1.5 py-0.5 font-extrabold uppercase rounded-sm`
 */
export function getMarketStatusBadgeStyle(status: MarketStatus): { text: string; className: string } {
  switch (status) {
    case 'INDEX TAPE':
      return {
        text: 'INDEX TAPE',
        className: 'text-xs bg-[#ff9900] text-black px-1.5 py-0.5 font-extrabold uppercase rounded-sm',
      };
    case 'PRE-MARKET':
      return {
        text: 'PRE-MARKET',
        className: 'text-xs bg-amber-500/20 text-amber-400 border border-amber-500/30 px-1.5 py-0.5 font-extrabold uppercase rounded-sm',
      };
    case 'AFTER HOURS':
      return {
        text: 'AFTER HOURS',
        className: 'text-xs bg-indigo-500/20 text-indigo-400 border border-indigo-500/30 px-1.5 py-0.5 font-extrabold uppercase rounded-sm',
      };
    case 'MARKET CLOSED':
    default:
      return {
        text: 'MARKET CLOSED',
        className: 'text-xs bg-red-950/80 text-red-400 border border-red-800/60 px-1.5 py-0.5 font-extrabold uppercase rounded-sm',
      };
  }
}
