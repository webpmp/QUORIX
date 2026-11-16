export type StudyId =
  | 'ma3'
  | 'ema9'
  | 'ema20'
  | 'sma50'
  | 'vwap'
  | 'bb'
  | 'psar'
  | 'levels'
  | 'volume'
  | 'volMa'
  | 'atr'
  | 'obv'
  | 'rsi'
  | 'macd'
  | 'stoch'
  | 'cci'
  | 'adx'
  | 'roc';

export type StudyCategory = 'overlay' | 'volume_volatility' | 'momentum';

export interface StudyDefinition {
  id: StudyId;
  code: string;
  name: string;
  category: StudyCategory;
  placement: 'OVERLAY' | 'SUB-PANEL' | 'VOLUME OVERLAY';
  color: string;
  bgClass: string;
  textClass: string;
  description: string;
}

export const STUDIES_STORAGE_KEY = 'quorix_gp_studies_v1';
export const DEFAULT_STUDY_IDS: StudyId[] = ['ma3', 'volume', 'rsi'];

export const STUDY_CATALOG: StudyDefinition[] = [
  // Price Overlays
  {
    id: 'ma3',
    code: '3MA',
    name: '3-Period Simple Moving Average',
    category: 'overlay',
    placement: 'OVERLAY',
    color: '#ff9900',
    bgClass: 'bg-[#ff9900]',
    textClass: 'text-[#ff9900]',
    description: 'Fast 3-bar simple moving average tracking immediate short-term price slope.',
  },
  {
    id: 'ema9',
    code: '9 EMA',
    name: '9-Period Exponential Moving Average',
    category: 'overlay',
    placement: 'OVERLAY',
    color: '#38bdf8',
    bgClass: 'bg-[#38bdf8]',
    textClass: 'text-[#38bdf8]',
    description: 'Responsive short-term EMA weighted toward recent closes for momentum entries.',
  },
  {
    id: 'ema20',
    code: '20 EMA',
    name: '20-Period Exponential Moving Average',
    category: 'overlay',
    placement: 'OVERLAY',
    color: '#f472b6',
    bgClass: 'bg-[#f472b6]',
    textClass: 'text-[#f472b6]',
    description: 'Dynamic intermediate trend support/resistance benchmark (pairs with 9 EMA).',
  },
  {
    id: 'sma50',
    code: '50 SMA',
    name: '50-Period Simple Moving Average',
    category: 'overlay',
    placement: 'OVERLAY',
    color: '#eab308',
    bgClass: 'bg-[#eab308]',
    textClass: 'text-[#eab308]',
    description: 'Classic medium-term institutional trendline across the active timeframe.',
  },
  {
    id: 'vwap',
    code: 'VWAP',
    name: 'Volume-Weighted Average Price',
    category: 'overlay',
    placement: 'OVERLAY',
    color: '#2dd4bf',
    bgClass: 'bg-[#2dd4bf]',
    textClass: 'text-[#2dd4bf]',
    description: 'Session-reset benchmark weighting typical price by cumulative share volume.',
  },
  {
    id: 'bb',
    code: 'BB (20,2)',
    name: 'Bollinger Bands (20, 2σ)',
    category: 'overlay',
    placement: 'OVERLAY',
    color: '#60a5fa',
    bgClass: 'bg-[#60a5fa]',
    textClass: 'text-[#60a5fa]',
    description: '20-bar SMA envelope with ±2 standard deviation upper and lower volatility bands.',
  },
  {
    id: 'psar',
    code: 'PSAR',
    name: 'Parabolic SAR (0.02, 0.2)',
    category: 'overlay',
    placement: 'OVERLAY',
    color: '#fbbf24',
    bgClass: 'bg-[#fbbf24]',
    textClass: 'text-[#fbbf24]',
    description: 'Trailing stop-and-reverse dots above/below candles indicating trend shifts.',
  },
  {
    id: 'levels',
    code: 'HI/LO/PC',
    name: 'Window High / Low & Prev Close',
    category: 'overlay',
    placement: 'OVERLAY',
    color: '#94a3b8',
    bgClass: 'bg-[#94a3b8]',
    textClass: 'text-[#94a3b8]',
    description: 'Horizontal reference lines for visible high, low, and previous close.',
  },

  // Volume & Volatility Studies
  {
    id: 'volume',
    code: 'VOLUME',
    name: 'Volume Histogram',
    category: 'volume_volatility',
    placement: 'SUB-PANEL',
    color: '#00ff00',
    bgClass: 'bg-[#00ff00]',
    textClass: 'text-[#00ff00]',
    description: 'Bar-by-bar share volume colored green on up closes and red on down closes.',
  },
  {
    id: 'volMa',
    code: 'VOL MA(20)',
    name: 'Volume 20-Period Moving Average',
    category: 'volume_volatility',
    placement: 'VOLUME OVERLAY',
    color: '#ff9900',
    bgClass: 'bg-[#ff9900]',
    textClass: 'text-[#ff9900]',
    description: '20-bar average line on the Volume panel to spot unusual volume spikes.',
  },
  {
    id: 'atr',
    code: 'ATR (14)',
    name: 'Average True Range (14)',
    category: 'volume_volatility',
    placement: 'SUB-PANEL',
    color: '#f59e0b',
    bgClass: 'bg-[#f59e0b]',
    textClass: 'text-[#f59e0b]',
    description: 'Wilder volatility gauge measuring average price range per bar in dollars.',
  },
  {
    id: 'obv',
    code: 'OBV',
    name: 'On-Balance Volume',
    category: 'volume_volatility',
    placement: 'SUB-PANEL',
    color: '#06b6d4',
    bgClass: 'bg-[#06b6d4]',
    textClass: 'text-[#06b6d4]',
    description: 'Cumulative volume flow adding up-bar volume and subtracting down-bar volume.',
  },

  // Momentum & Trend Oscillators
  {
    id: 'rsi',
    code: 'RSI (14)',
    name: 'Relative Strength Index (14)',
    category: 'momentum',
    placement: 'SUB-PANEL',
    color: '#9b59b6',
    bgClass: 'bg-[#9b59b6]',
    textClass: 'text-[#9b59b6]',
    description: 'Wilder momentum oscillator scaled 0–100 with 70 Overbought and 30 Oversold zones.',
  },
  {
    id: 'macd',
    code: 'MACD',
    name: 'MACD (12, 26, 9)',
    category: 'momentum',
    placement: 'SUB-PANEL',
    color: '#38bdf8',
    bgClass: 'bg-[#38bdf8]',
    textClass: 'text-[#38bdf8]',
    description: '12/26 EMA spread, 9-bar signal line, and divergence histogram around zero.',
  },
  {
    id: 'stoch',
    code: 'STOCH',
    name: 'Slow Stochastic (14, 3, 3)',
    category: 'momentum',
    placement: 'SUB-PANEL',
    color: '#22d3ee',
    bgClass: 'bg-[#22d3ee]',
    textClass: 'text-[#22d3ee]',
    description: '%K and %D momentum lines (0–100) highlighting 80 OB / 20 OS turning points.',
  },
  {
    id: 'cci',
    code: 'CCI (20)',
    name: 'Commodity Channel Index (20)',
    category: 'momentum',
    placement: 'SUB-PANEL',
    color: '#a3e635',
    bgClass: 'bg-[#a3e635]',
    textClass: 'text-[#a3e635]',
    description: 'Cyclical deviation from 20-bar typical price mean with +100 / -100 thresholds.',
  },
  {
    id: 'adx',
    code: 'ADX / DMI',
    name: 'ADX & Directional Movement (14)',
    category: 'momentum',
    placement: 'SUB-PANEL',
    color: '#e4e4e7',
    bgClass: 'bg-[#e4e4e7]',
    textClass: 'text-[#e4e4e7]',
    description: 'Measures trend strength (ADX) alongside bullish (+DI) and bearish (-DI) pressure.',
  },
  {
    id: 'roc',
    code: 'ROC (12)',
    name: 'Rate of Change (12)',
    category: 'momentum',
    placement: 'SUB-PANEL',
    color: '#ec4899',
    bgClass: 'bg-[#ec4899]',
    textClass: 'text-[#ec4899]',
    description: 'Percentage price change vs. 12 bars ago plotted around a 0.0% baseline.',
  },
];

export interface EnrichableBar {
  date: string;
  timestamp?: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  rsi?: number;
  ma3?: number;
  ema9?: number;
  ema20?: number;
  sma50?: number;
  vwap?: number;
  bbUpper?: number;
  bbMid?: number;
  bbLower?: number;
  psar?: number;
  psarUp?: boolean;
  volMa?: number;
  atr?: number;
  obv?: number;
  macd?: number;
  macdSignal?: number;
  macdHist?: number;
  stochK?: number;
  stochD?: number;
  cci?: number;
  adx?: number;
  plusDi?: number;
  minusDi?: number;
  roc?: number;
}

function roundNum(val: number, decimals = 3): number {
  return parseFloat(val.toFixed(decimals));
}

function computeEMAArray(values: number[], period: number): Array<number | undefined> {
  const out = new Array<number | undefined>(values.length).fill(undefined);
  if (values.length === 0) return out;
  const k = 2 / (period + 1);
  if (values.length < period) {
    let ema = values[0];
    out[0] = ema;
    for (let i = 1; i < values.length; i++) {
      ema = values[i] * k + ema * (1 - k);
      out[i] = ema;
    }
    return out;
  }

  let seedSum = 0;
  for (let i = 0; i < period; i++) {
    seedSum += values[i];
  }
  let ema = seedSum / period;
  out[period - 1] = ema;
  for (let i = period; i < values.length; i++) {
    ema = values[i] * k + ema * (1 - k);
    out[i] = ema;
  }
  return out;
}

function computeSMAArray(values: number[], period: number): Array<number | undefined> {
  const out = new Array<number | undefined>(values.length).fill(undefined);
  if (values.length < period) return out;
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= period) sum -= values[i - period];
    if (i >= period - 1) {
      out[i] = sum / period;
    }
  }
  return out;
}

export function computeWilderRSIArray(closes: number[], period = 14): number[] {
  const out = new Array<number>(closes.length).fill(50);
  if (closes.length < 2) return out;

  const initLen = Math.min(period, closes.length - 1);
  let avgGain = 0;
  let avgLoss = 0;

  for (let i = 1; i <= initLen; i++) {
    const ch = closes[i] - closes[i - 1];
    if (ch > 0) avgGain += ch;
    else avgLoss += Math.abs(ch);
  }
  avgGain /= initLen;
  avgLoss /= initLen;

  for (let i = 1; i < closes.length; i++) {
    if (i < initLen) {
      let sg = 0;
      let sl = 0;
      for (let k = 1; k <= i; k++) {
        const ch = closes[k] - closes[k - 1];
        if (ch > 0) sg += ch;
        else sl += Math.abs(ch);
      }
      const ag = sg / i;
      const al = sl / i;
      out[i] = al === 0 ? (ag > 0 ? 100 : 50) : roundNum(100 - 100 / (1 + ag / al), 2);
    } else {
      if (i > initLen) {
        const ch = closes[i] - closes[i - 1];
        const g = ch > 0 ? ch : 0;
        const l = ch < 0 ? Math.abs(ch) : 0;
        avgGain = (avgGain * (period - 1) + g) / period;
        avgLoss = (avgLoss * (period - 1) + l) / period;
      }
      out[i] = avgLoss === 0 ? (avgGain > 0 ? 100 : 50) : roundNum(100 - 100 / (1 + avgGain / avgLoss), 2);
    }
  }
  return out;
}

/**
 * Computes all technical studies chronologically over a continuous array of OHLCV bars.
 * Call BEFORE window slicing so indicators are accurately pre-warmed.
 */
export function enrichBarsWithStudies<T extends EnrichableBar>(bars: T[], timeZone = 'America/New_York'): T[] {
  const n = bars.length;
  if (n === 0) return bars;

  const closes = bars.map((b) => b.close);
  const volumes = bars.map((b) => b.volume || 0);

  const ma3Arr = computeSMAArray(closes, 3);
  const ema9Arr = computeEMAArray(closes, 9);
  const ema20Arr = computeEMAArray(closes, 20);
  const sma50Arr = computeSMAArray(closes, 50);
  const volMaArr = computeSMAArray(volumes, 20);
  const rsiArr = computeWilderRSIArray(closes, 14);

  // MACD (12, 26, 9)
  const ema12 = computeEMAArray(closes, 12);
  const ema26 = computeEMAArray(closes, 26);
  const macdLineRaw: Array<number | undefined> = new Array(n).fill(undefined);
  const validMacdIndices: number[] = [];
  const validMacdValues: number[] = [];
  for (let i = 0; i < n; i++) {
    if (typeof ema12[i] === 'number' && typeof ema26[i] === 'number') {
      const m = (ema12[i] as number) - (ema26[i] as number);
      macdLineRaw[i] = m;
      validMacdIndices.push(i);
      validMacdValues.push(m);
    }
  }
  const macdSignalCompressed = computeEMAArray(validMacdValues, 9);
  const macdSignalArr: Array<number | undefined> = new Array(n).fill(undefined);
  for (let j = 0; j < validMacdIndices.length; j++) {
    macdSignalArr[validMacdIndices[j]] = macdSignalCompressed[j];
  }

  // Bollinger Bands (20, 2)
  const bbMidArr = computeSMAArray(closes, 20);
  const bbUpperArr: Array<number | undefined> = new Array(n).fill(undefined);
  const bbLowerArr: Array<number | undefined> = new Array(n).fill(undefined);
  for (let i = 19; i < n; i++) {
    const mid = bbMidArr[i];
    if (typeof mid === 'number') {
      let sqSum = 0;
      for (let k = i - 19; k <= i; k++) {
        const diff = closes[k] - mid;
        sqSum += diff * diff;
      }
      const std = Math.sqrt(sqSum / 20);
      bbUpperArr[i] = mid + 2 * std;
      bbLowerArr[i] = mid - 2 * std;
    }
  }

  // Session-reset VWAP
  const vwapArr: Array<number | undefined> = new Array(n).fill(undefined);
  let cumPV = 0;
  let cumV = 0;
  let lastSessionDay = '';
  for (let i = 0; i < n; i++) {
    const b = bars[i];
    let dayKey = '';
    if (typeof b.timestamp === 'number') {
      try {
        dayKey = new Date(b.timestamp * 1000).toLocaleDateString('en-US', { timeZone });
      } catch {
        dayKey = new Date(b.timestamp * 1000).toLocaleDateString('en-US');
      }
    }
    if (dayKey && dayKey !== lastSessionDay) {
      cumPV = 0;
      cumV = 0;
      lastSessionDay = dayKey;
    }
    const tp = (b.high + b.low + b.close) / 3;
    if (b.volume > 0) {
      cumPV += tp * b.volume;
      cumV += b.volume;
    }
    if (cumV > 0) {
      vwapArr[i] = cumPV / cumV;
    }
  }

  // Parabolic SAR (step=0.02, maxStep=0.20)
  const psarArr: Array<number | undefined> = new Array(n).fill(undefined);
  const psarUpArr: Array<boolean> = new Array(n).fill(true);
  if (n >= 2) {
    const step = 0.02;
    const maxStep = 0.2;
    let isUp = bars[1].close >= bars[0].close;
    let af = step;
    let ep = isUp ? Math.max(bars[0].high, bars[1].high) : Math.min(bars[0].low, bars[1].low);
    let sar = isUp ? bars[0].low : bars[0].high;
    psarArr[0] = sar;
    psarUpArr[0] = isUp;

    for (let i = 1; i < n; i++) {
      sar = sar + af * (ep - sar);
      if (isUp) {
        if (i >= 1) sar = Math.min(sar, bars[i - 1].low);
        if (i >= 2) sar = Math.min(sar, bars[i - 2].low);
        if (bars[i].low < sar) {
          isUp = false;
          sar = ep;
          ep = bars[i].low;
          af = step;
        } else {
          if (bars[i].high > ep) {
            ep = bars[i].high;
            af = Math.min(maxStep, af + step);
          }
        }
      } else {
        if (i >= 1) sar = Math.max(sar, bars[i - 1].high);
        if (i >= 2) sar = Math.max(sar, bars[i - 2].high);
        if (bars[i].high > sar) {
          isUp = true;
          sar = ep;
          ep = bars[i].high;
          af = step;
        } else {
          if (bars[i].low < ep) {
            ep = bars[i].low;
            af = Math.min(maxStep, af + step);
          }
        }
      }
      psarArr[i] = sar;
      psarUpArr[i] = isUp;
    }
  }

  // ATR (14) & ADX / DMI (14)
  const trArr = new Array<number>(n).fill(0);
  const plusDmArr = new Array<number>(n).fill(0);
  const minusDmArr = new Array<number>(n).fill(0);
  trArr[0] = bars[0].high - bars[0].low;
  for (let i = 1; i < n; i++) {
    const upMove = bars[i].high - bars[i - 1].high;
    const downMove = bars[i - 1].low - bars[i].low;
    plusDmArr[i] = upMove > downMove && upMove > 0 ? upMove : 0;
    minusDmArr[i] = downMove > upMove && downMove > 0 ? downMove : 0;
    trArr[i] = Math.max(
      bars[i].high - bars[i].low,
      Math.abs(bars[i].high - bars[i - 1].close),
      Math.abs(bars[i].low - bars[i - 1].close)
    );
  }

  const atrArr: Array<number | undefined> = new Array(n).fill(undefined);
  const plusDiArr: Array<number | undefined> = new Array(n).fill(undefined);
  const minusDiArr: Array<number | undefined> = new Array(n).fill(undefined);
  const adxArr: Array<number | undefined> = new Array(n).fill(undefined);

  const adxPeriod = 14;
  if (n > adxPeriod) {
    let smTr = 0;
    let smPlusDm = 0;
    let smMinusDm = 0;
    for (let i = 1; i <= adxPeriod; i++) {
      smTr += trArr[i];
      smPlusDm += plusDmArr[i];
      smMinusDm += minusDmArr[i];
    }
    const dxSeries: Array<{ idx: number; val: number }> = [];
    for (let i = adxPeriod; i < n; i++) {
      if (i > adxPeriod) {
        smTr = smTr - smTr / adxPeriod + trArr[i];
        smPlusDm = smPlusDm - smPlusDm / adxPeriod + plusDmArr[i];
        smMinusDm = smMinusDm - smMinusDm / adxPeriod + minusDmArr[i];
      }
      const atrVal = smTr / adxPeriod;
      atrArr[i] = atrVal;
      const pDi = smTr > 0 ? (100 * smPlusDm) / smTr : 0;
      const mDi = smTr > 0 ? (100 * smMinusDm) / smTr : 0;
      plusDiArr[i] = pDi;
      minusDiArr[i] = mDi;
      const diSum = pDi + mDi;
      const dx = diSum > 0 ? (100 * Math.abs(pDi - mDi)) / diSum : 0;
      dxSeries.push({ idx: i, val: dx });
    }
    if (dxSeries.length >= adxPeriod) {
      let adx = 0;
      for (let k = 0; k < adxPeriod; k++) adx += dxSeries[k].val;
      adx /= adxPeriod;
      adxArr[dxSeries[adxPeriod - 1].idx] = adx;
      for (let k = adxPeriod; k < dxSeries.length; k++) {
        adx = (adx * (adxPeriod - 1) + dxSeries[k].val) / adxPeriod;
        adxArr[dxSeries[k].idx] = adx;
      }
    }
  } else {
    // Graceful early ATR if < 15 bars
    let sumTr = 0;
    for (let i = 0; i < n; i++) {
      sumTr += trArr[i];
      atrArr[i] = sumTr / (i + 1);
    }
  }

  // OBV
  const obvArr = new Array<number>(n).fill(0);
  for (let i = 1; i < n; i++) {
    if (bars[i].close > bars[i - 1].close) obvArr[i] = obvArr[i - 1] + (bars[i].volume || 0);
    else if (bars[i].close < bars[i - 1].close) obvArr[i] = obvArr[i - 1] - (bars[i].volume || 0);
    else obvArr[i] = obvArr[i - 1];
  }

  // Slow Stochastic (14, 3, 3)
  const rawK: Array<number | undefined> = new Array(n).fill(undefined);
  for (let i = 13; i < n; i++) {
    let hi = -Infinity;
    let lo = Infinity;
    for (let k = i - 13; k <= i; k++) {
      if (bars[k].high > hi) hi = bars[k].high;
      if (bars[k].low < lo) lo = bars[k].low;
    }
    const span = hi - lo;
    rawK[i] = span > 0 ? ((bars[i].close - lo) / span) * 100 : 50;
  }
  const stochKArr: Array<number | undefined> = new Array(n).fill(undefined);
  for (let i = 15; i < n; i++) {
    const a = rawK[i - 2];
    const b = rawK[i - 1];
    const c = rawK[i];
    if (typeof a === 'number' && typeof b === 'number' && typeof c === 'number') {
      stochKArr[i] = (a + b + c) / 3;
    }
  }
  const stochDArr: Array<number | undefined> = new Array(n).fill(undefined);
  for (let i = 17; i < n; i++) {
    const a = stochKArr[i - 2];
    const b = stochKArr[i - 1];
    const c = stochKArr[i];
    if (typeof a === 'number' && typeof b === 'number' && typeof c === 'number') {
      stochDArr[i] = (a + b + c) / 3;
    }
  }

  // CCI (20)
  const tpArr = bars.map((b) => (b.high + b.low + b.close) / 3);
  const tpSma20 = computeSMAArray(tpArr, 20);
  const cciArr: Array<number | undefined> = new Array(n).fill(undefined);
  for (let i = 19; i < n; i++) {
    const mean = tpSma20[i];
    if (typeof mean === 'number') {
      let devSum = 0;
      for (let k = i - 19; k <= i; k++) {
        devSum += Math.abs(tpArr[k] - mean);
      }
      const meanDev = devSum / 20;
      cciArr[i] = meanDev > 0 ? (tpArr[i] - mean) / (0.015 * meanDev) : 0;
    }
  }

  // ROC (12)
  const rocArr: Array<number | undefined> = new Array(n).fill(undefined);
  for (let i = 12; i < n; i++) {
    const prev = bars[i - 12].close;
    if (prev > 0) {
      rocArr[i] = ((bars[i].close - prev) / prev) * 100;
    }
  }

  for (let i = 0; i < n; i++) {
    const bar = bars[i];
    bar.rsi = rsiArr[i];
    if (typeof ma3Arr[i] === 'number') bar.ma3 = roundNum(ma3Arr[i] as number, 3);
    if (typeof ema9Arr[i] === 'number') bar.ema9 = roundNum(ema9Arr[i] as number, 3);
    if (typeof ema20Arr[i] === 'number') bar.ema20 = roundNum(ema20Arr[i] as number, 3);
    if (typeof sma50Arr[i] === 'number') bar.sma50 = roundNum(sma50Arr[i] as number, 3);
    if (typeof vwapArr[i] === 'number') bar.vwap = roundNum(vwapArr[i] as number, 3);
    if (typeof bbUpperArr[i] === 'number') bar.bbUpper = roundNum(bbUpperArr[i] as number, 3);
    if (typeof bbMidArr[i] === 'number') bar.bbMid = roundNum(bbMidArr[i] as number, 3);
    if (typeof bbLowerArr[i] === 'number') bar.bbLower = roundNum(bbLowerArr[i] as number, 3);
    if (typeof psarArr[i] === 'number') {
      bar.psar = roundNum(psarArr[i] as number, 3);
      bar.psarUp = psarUpArr[i];
    }
    if (typeof volMaArr[i] === 'number') bar.volMa = Math.round(volMaArr[i] as number);
    if (typeof atrArr[i] === 'number') bar.atr = roundNum(atrArr[i] as number, 3);
    bar.obv = Math.round(obvArr[i]);
    if (typeof macdLineRaw[i] === 'number') bar.macd = roundNum(macdLineRaw[i] as number, 3);
    if (typeof macdSignalArr[i] === 'number') {
      bar.macdSignal = roundNum(macdSignalArr[i] as number, 3);
      if (typeof macdLineRaw[i] === 'number') {
        bar.macdHist = roundNum((macdLineRaw[i] as number) - (macdSignalArr[i] as number), 3);
      }
    }
    if (typeof stochKArr[i] === 'number') bar.stochK = roundNum(stochKArr[i] as number, 2);
    if (typeof stochDArr[i] === 'number') bar.stochD = roundNum(stochDArr[i] as number, 2);
    if (typeof cciArr[i] === 'number') bar.cci = roundNum(cciArr[i] as number, 2);
    if (typeof adxArr[i] === 'number') bar.adx = roundNum(adxArr[i] as number, 2);
    if (typeof plusDiArr[i] === 'number') bar.plusDi = roundNum(plusDiArr[i] as number, 2);
    if (typeof minusDiArr[i] === 'number') bar.minusDi = roundNum(minusDiArr[i] as number, 2);
    if (typeof rocArr[i] === 'number') bar.roc = roundNum(rocArr[i] as number, 2);
  }

  return bars;
}
