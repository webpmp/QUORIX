![QUORIX Terminal](./assets/quorix-gp.png)

# QUORIX Terminal

A retro CRT-styled financial market terminal built with React, TypeScript, Tailwind CSS, and an Express backend proxy. QUORIX integrates live equity/index market data, Federal Reserve Economic Data (FRED), Polymarket prediction markets, institutional ownership data, multi-source financial news, and AI-assisted research grounded with live market context.

---

## Features

- **Command-Driven Terminal UI**: Execute ticker and module commands directly from the top command bar (`AAPL GP`, `NVDA DES`, `ECO`, `CRNC`, `POLY`, `INST`, `NEWS`, `BWRITE`, `SETT`, `HELP`) or select shortcuts from the left sidebar.
- **Interactive Price, Volume & RSI Charting (`GP`)**:
  - Candlestick, Line, and Area chart modes with toggleable `3MA`, `VOLUME`, and `RSI (6)` studies.
  - Multi-timeframe OHLCV intervals (`5m`, `15m`, `30m`, `1h`, `1D`, `1W`, `1M`).
  - Responsive 1:1 pixel-matched SVG scaling via `ResizeObserver` for undistorted axes and dynamic tick spacing.
- **Historical Pricing (`HP`), Security Analytics (`DES`), and Analyst Consensus (`ANR`)**: Live fundamentals, historical OHLCV tables, and AI-grounded company/analyst research.
- **FRED Macroeconomic & FX Suite (`ECO`, `CRNC`)**:
  - Real-time U.S. and global macroeconomic indicators, including GDP, CPI, unemployment, Fed Funds, Treasury yields, industrial production, and retail sales.
  - Upcoming FOMC and economic release calendars via the St. Louis Fed FRED API.
  - Live foreign exchange rates powered by FRED FX series (`EUR/USD`, `USD/JPY`, `GBP/USD`, `USD/CHF`, `USD/CAD`, `AUD/USD`, `USD/CNY`, etc.).
- **Polymarket Screener (`POLY`)**: Live event probabilities, volume, liquidity, and arbitrage/spread monitoring via the Polymarket Gamma API.
- **Institutional Activity Monitor (`INST`)**: Explore institutional ownership and Form 13F filing activity using 3spread data.
  - Search institutional holdings by ticker, CUSIP, or issuer.
  - Track position changes, including new positions, increases, decreases, exits, and unchanged holdings.
  - Identify institutional accumulation across multiple reporting periods.
  - Review institutional investor profiles, portfolio metrics, and reported holdings.
  - Data is based on quarterly SEC Form 13F disclosures and is delayed. Filings may be reported up to 45 days after quarter-end and do not represent real-time trading activity.
- **Real-Time Multi-Source News Hub & Ticker (`NEWS`)**: Aggregates live financial headlines from NYT Top Stories, NewsAPI, and NewsData.io with auto-scrolling tape and 60-second refresh.
- **Ask QUORIX (`BWRITE`)**: Server-side `@google/genai` (Gemini) analyst assistant enriched with Google Search grounding, live equity quotes, and FRED macro snapshots.
- **Customizable Workspace (`SETT`)**:
  - Resizable left sidebar split between **Terminal Commands** and **Tracked Equities** (persisted to `localStorage`).
  - World market clocks (`GMT`, `NY`, `LDN`, `TYO`) with IANA timezone/DST accuracy.
  - Runtime API key management for supported integrations.

---

## Graph Price (`GP`) Studies & Indicators

Click **STUDIES** in the Graph Price (`GP`) toolbar to toggle any of the **18** built-in technical studies. Selections persist automatically. Defaults: `3MA`, `VOLUME`, `RSI (14)`.

### Price Overlays

- **3MA**: *3-Period Simple Moving Average* (`OVERLAY`): Fast 3-bar simple moving average tracking immediate short-term price slope.
- **9 EMA**: *9-Period Exponential Moving Average* (`OVERLAY`): Responsive short-term EMA weighted toward recent closes for momentum entries.
- **20 EMA**: *20-Period Exponential Moving Average* (`OVERLAY`): Dynamic intermediate trend support/resistance benchmark (pairs with `9 EMA`).
- **50 SMA**: *50-Period Simple Moving Average* (`OVERLAY`): Classic medium-term institutional trendline across the active timeframe.
- **VWAP**: *Volume-Weighted Average Price* (`OVERLAY`): Session-reset benchmark weighting typical price by cumulative share volume.
- **BB (20,2)**: *Bollinger Bands (20, 2σ)* (`OVERLAY`): 20-bar SMA envelope with ±2 standard deviation upper and lower volatility bands.
- **PSAR**: *Parabolic SAR (0.02, 0.2)* (`OVERLAY`): Trailing stop-and-reverse dots above/below candles indicating trend shifts.
- **HI/LO/PC**: *Window High / Low & Prev Close* (`OVERLAY`): Horizontal reference lines for visible high, low, and previous close.

### Volume & Volatility

- **VOLUME**: *Volume Histogram* (`SUB-PANEL`): Bar-by-bar share volume colored green on up closes and red on down closes.
- **VOL MA(20)**: *Volume 20-Period Moving Average* (`VOLUME OVERLAY`): 20-bar average line on the Volume panel to spot unusual volume spikes.
- **ATR (14)**: *Average True Range (14)* (`SUB-PANEL`): Wilder volatility gauge measuring average price range per bar in dollars.
- **OBV**: *On-Balance Volume* (`SUB-PANEL`): Cumulative volume flow adding up-bar volume and subtracting down-bar volume.

### Momentum & Trend

- **RSI (14)**: *Relative Strength Index (14)* (`SUB-PANEL`): Wilder momentum oscillator scaled 0–100 with 70 Overbought and 30 Oversold zones.
- **MACD**: *MACD (12, 26, 9)* (`SUB-PANEL`): 12/26 EMA spread, 9-bar signal line, and divergence histogram around zero.
- **STOCH**: *Slow Stochastic (14, 3, 3)* (`SUB-PANEL`): `%K` and `%D` momentum lines (0–100) highlighting 80 OB / 20 OS turning points.
- **CCI (20)**: *Commodity Channel Index (20)* (`SUB-PANEL`): Cyclical deviation from 20-bar typical price mean with `+100` / `-100` thresholds.
- **ADX / DMI**: *ADX & Directional Movement (14)* (`SUB-PANEL`): Measures trend strength (`ADX`) alongside bullish (`+DI`) and bearish (`-DI`) pressure.
- **ROC (12)**: *Rate of Change (12)* (`SUB-PANEL`): Percentage price change vs. 12 bars ago plotted around a `0.0%` baseline.

---

## Tech Stack

- **Frontend**: React 19, TypeScript, Vite, Tailwind CSS v4, Lucide Icons, Motion
- **Backend**: Node.js, Express (`server.ts`), Vite dev middleware
- **AI & Data Integrations**:
  - **Market Quotes & OHLCV History**: Yahoo Finance and Alpha Vantage
  - **Macroeconomic Data & FX**: Federal Reserve Economic Data (FRED API)
  - **Prediction Markets**: Polymarket Gamma API
  - **Institutional Holdings**: 3spread API (SEC Form 13F data)
  - **Financial News**: New York Times API, NewsAPI, NewsData.io
  - **AI Analyst & Search Grounding**: Google Gemini (`@google/genai`)

---

## Project Structure

```text
├── server.ts                  # Express backend & API proxy routes (port 3000)
├── index.html                 # App entry point
├── package.json               # Scripts & dependencies
├── .env.example               # Environment variable template
├── vite.config.ts             # Vite configuration
└── src/
    ├── App.tsx                # Root terminal layout, command parser & live polling
    ├── data.ts                # Tracked equities & index tape symbol definitions
    ├── types.ts               # Shared TypeScript interfaces
    └── components/
        ├── Header.tsx         # Market clocks, branding & CLI command bar
        ├── CommandPanel.tsx   # Resizable Terminal Commands & Tracked Equities sidebar
        ├── TickerTape.tsx     # Live scrolling index/equity/commodity/crypto tape
        ├── NewsTicker.tsx     # Live multi-source scrolling news ticker
        ├── Workspace.tsx      # Screen router (BWRITE, GP, HP, DES, ANR, ECO, CRNC, POLY, INST, NEWS, SETT, HELP)
        ├── ChartWidget.tsx    # Responsive SVG Candlestick/Line/Area, Volume & RSI charts
        ├── PolymarketScreen.tsx # Live Polymarket screener
        └── BeepGenerator.ts   # Retro terminal Web Audio feedback
```

---

## Getting Started

### Prerequisites

- **Node.js** (v20+ recommended)
- **npm** (or `bun`)

### 1. Clone & Install Dependencies

```bash
git clone <your-repo-url>
cd <repo-directory>
npm install
```

### 2. Configure Environment Variables

Copy `.env.example` to `.env` and populate the keys for the integrations you want to enable:

```bash
cp .env.example .env
```

| Variable | Purpose | Required |
| --- | --- | --- |
| `GEMINI_API_KEY` | Google Gemini API key for `BWRITE` (Ask QUORIX) and AI-grounded company/news analysis | Recommended |
| `FRED_API_KEY` | St. Louis Fed FRED API key for `ECO` macro data, release calendar, and `CRNC` FX rates | Recommended |
| `ALPHA_VANTAGE_API_KEY` | Alpha Vantage API key for equity fundamentals and fallback quote lookup | Optional |
| `NYT_API_KEY` | New York Times Top Stories API key for live business headlines | Optional |
| `NEWS_API_KEY` | NewsAPI key for corporate and equity news | Optional |
| `NEWSDATA_API_KEY` | NewsData.io API key for real-time market events | Optional |
| `THREESPREAD_API_KEY` | 3spread API key for institutional holdings and Form 13F data in `INST` | Required for INST |
| `APP_URL` | Hosted application URL | Optional |

#### Configuring the 3spread API

The Institutional Activity Monitor (`INST`) requires a 3spread API key.

1. Create an account with [3spread](https://3spread.com/) and obtain an API key.
2. Open the project's `.env` file.
3. Add your key:

```bash
THREESPREAD_API_KEY=your_3spread_api_key
```

4. Save the file and restart the QUORIX server.

**Security requirements:**

- Keep `THREESPREAD_API_KEY` in the server-side environment.
- Do not prefix the variable with `VITE_`.
- Do not expose the key in frontend code, browser requests, or client-side configuration.
- Do not commit your `.env` file or publish your API key.
- The 3spread key is configured through the server environment, not through the terminal's `SETT` screen.

> **Tip:** API keys for Alpha Vantage, NYT, NewsAPI, NewsData.io, and FRED can also be configured at runtime inside the terminal via the **`SETT`** screen.

### 3. Run in Development Mode

Starts the Express server with Vite middleware on **http://localhost:3000**:

```bash
npm run dev
```

### 4. Type-Check, Build & Run in Production

```bash
# Run TypeScript type check
npm run lint

# Build frontend (Vite) and bundle server (esbuild)
npm run build

# Start production server
npm start
```

---

## Terminal Commands Reference

Type any command into the top `>` prompt and press **Enter** or click **EXEC**:

| Command | Module | Description |
| --- | --- | --- |
| `BWRITE` | Ask QUORIX | AI financial and macro analyst with Search Grounding |
| `NEWS` | News Hub | Live multi-source financial news feed |
| `GP` | Graph Price | Interactive OHLCV candlestick/line/area + Volume & RSI charts |
| `HP` | Historical Pricing | Tabular OHLCV historical price archive |
| `DES` | Security Analytics | Core company overview, valuation metrics, and bio |
| `ANR` | Analyst Recs | Street consensus estimates and rating breakdown |
| `CRNC` | Currencies (FX) | Live foreign exchange rates via FRED |
| `ECO` | Economic Indicator | Macroeconomic dashboard and release calendar via FRED |
| `POLY` | Polymarket Screener | Real-time prediction market odds and spreads |
| `INST` | Institutional Activity Monitor | Institutional holdings, 13F position changes, accumulation screening, and investor profiles |
| `SETT` | System Settings | Configure supported API keys at runtime |
| `HELP` | User Manuals | Command syntax and shortcut guide |

**Institutional Activity Monitor examples:**

- `INST` opens the Institutional Activity Monitor.
- `AAPL INST` opens the monitor for Apple.
- `INST NVDA` opens the monitor for NVIDIA.
- `13F` is an alternate command for the institutional activity screen.

**Chained Commands**: Prefix a ticker symbol with a screen command, e.g. `NVDA GP`, `TSLA DES`, `BTC HP`, or type a ticker symbol (`AAPL`) to switch the active security.

---

## Backend API Endpoints

The Express server (`server.ts`) proxies external requests to protect credentials and normalize responses.

### Market, Economic, and News Data

- `GET /api/alpha-vantage/quote` - Live market quote and fundamentals lookup
- `GET /api/market/history` - Multi-interval historical OHLCV bars
- `GET /api/fred/economics` - FRED macroeconomic series and upcoming release dates
- `GET /api/fred/currencies` - FRED FX exchange rate series
- `GET /api/polymarket/events` - Polymarket active events and odds
- `GET /api/news/ticker` - Aggregated live business and market headlines
- `POST /api/terminal/analyze` - Gemini AI terminal analysis with market/FRED grounding
- `GET /api/settings/keys` and `POST /api/settings/keys` - Runtime API key status and configuration

### Institutional Activity Data

The Institutional Activity Monitor uses server-side 3spread API integration. The server handles authentication using the `THREESPREAD_API_KEY` environment variable.

- `GET /v1/data-as-of` - Available data reporting date
- `GET /v1/coverage/by-issuer/{cik_or_ticker}` - Issuer coverage lookup
- `GET /v1/beneficial-ownership` - Beneficial ownership data
- `GET /v1/institutional-holdings` - Institutional holdings data
- `GET /v1/institutional-holdings/{filing_id}` - Filing details
- `GET /v1/institutional-holdings/holdings` - Holdings records

**Disclosure timing:** Institutional holdings are based on quarterly SEC Form 13F filings. Managers may report holdings up to 45 days after quarter-end. The data reflects reported filing information, not real-time trading activity or investment recommendations.
