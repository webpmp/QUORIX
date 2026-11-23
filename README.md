![QUORIX Terminal](./assets/quorix-gp-v1.png)

# QUORIX Terminal

A retro CRT-styled financial market terminal built with React, TypeScript, Tailwind CSS, and an Express backend proxy. QUORIX integrates live equity/index market data, Federal Reserve Economic Data (FRED), Polymarket prediction markets, institutional ownership data, multi-source financial news, portfolio risk analysis, correlation analysis, and AI-assisted research grounded with live market context.

---

## Features

- **Command-Driven Terminal UI**: Execute ticker and module commands directly from the top command bar (`AAPL GP`, `NVDA DES`, `ECO`, `CRNC`, `POLY`, `INST`, `PRM`, `CORR`, `NEWS`, `BWRITE`, `SETT`, `HELP`) or select shortcuts from the left sidebar.
- **Interactive Price, Volume & RSI Charting (`GP`)**:
  - Candlestick, Line, and Area chart modes with toggleable technical studies and indicators.
  - Multi-timeframe OHLCV intervals (`5m`, `15m`, `30m`, `1h`, `1D`, `1W`, `1M`).
  - Responsive SVG scaling via `ResizeObserver` for undistorted axes and dynamic tick spacing.
  - Configurable price overlays, volume indicators, volatility studies, and momentum/trend analysis.
  - **Insider Ownership Reports**: Review SEC insider ownership disclosures through Forms 3, 4, and 5, including initial statements of beneficial ownership, changes in beneficial ownership, and annual statements of beneficial ownership.
- **Historical Pricing (`HP`), Security Analytics (`DES`), and Analyst Consensus (`ANR`)**: Live fundamentals, historical OHLCV tables, and AI-grounded company/analyst research.
- **FRED Macroeconomic & FX Suite (`ECO`, `CRNC`)**:
  - U.S. and global macroeconomic indicators, including GDP, CPI, unemployment, Fed Funds, Treasury yields, industrial production, and retail sales.
  - Upcoming FOMC and economic release calendars via the St. Louis Fed FRED API.
  - Foreign exchange rates powered by FRED FX series (`EUR/USD`, `USD/JPY`, `GBP/USD`, `USD/CHF`, `USD/CAD`, `AUD/USD`, `USD/CNY`, etc.).
- **Polymarket Screener (`POLY`)**: Live event probabilities, volume, liquidity, and arbitrage/spread monitoring via the Polymarket Gamma API.
- **Institutional Activity Monitor (`INST`)**: Explore institutional ownership and Form 13F filing activity using 3spread data.
  - Search institutional holdings by ticker, CUSIP, or issuer.
  - Track position changes, including new positions, increases, decreases, exits, and unchanged holdings.
  - Identify institutional accumulation across multiple reporting periods.
  - Review institutional investor profiles, portfolio metrics, and reported holdings.
  - Data is based on quarterly SEC Form 13F disclosures and is delayed. Filings may be reported up to 45 days after quarter-end and do not represent real-time trading activity.
- **Portfolio Risk Monitor (`PRM`)**: Consolidated portfolio exposure and downside risk analysis.
  - Review portfolio concentration and allocation across individual positions.
  - Analyze sector and industry exposure to identify concentration risks.
  - Evaluate position sizing and portfolio allocation.
  - Assess volatility and portfolio diversification.
  - Examine potential downside risk scenarios.
  - Identify excessive exposure and potential portfolio vulnerabilities.
  - Supports manual portfolio entry, CSV import, and integration with existing portfolio data.
- **Correlation Analyzer (`CORR`)**: Analyze relationships between securities and identify correlation patterns across a selected group of assets.
  - Compare price movements and correlation between selected securities.
  - Evaluate how closely securities move together or in opposite directions.
  - Identify overlapping exposures and potential diversification limitations.
  - Support portfolio research and risk assessment through cross-asset correlation analysis.
- **Real-Time Multi-Source News Hub & Ticker (`NEWS`)**: Aggregates financial headlines from Yahoo Finance, NYT Top Stories, NewsAPI, and NewsData.io with an auto-scrolling ticker and periodic refresh.
- **Ask QUORIX (`BWRITE`)**: Server-side `@google/genai` (Gemini) analyst assistant enriched with Google Search grounding, live equity quotes, and FRED macro snapshots.
- **Customizable Workspace (`SETT`)**:
  - Resizable left sidebar split between **Terminal Commands** and **Tracked Equities** (persisted to `localStorage`).
  - World market clocks (`GMT`, `NY`, `LDN`, `TYO`) with IANA timezone/DST accuracy.
  - Runtime API key management for supported integrations.

---

## Graph Price (`GP`) Studies & Indicators

Click **STUDIES** in the Graph Price (`GP`) toolbar to toggle the built-in technical studies. Selections persist automatically. Defaults: `3MA`, `VOLUME`, `RSI (14)`.

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

### Insider Ownership Reports

Graph Price (`GP`) also provides access to SEC insider ownership disclosures:

- **Form 3**: Initial statement of beneficial ownership filed when an individual becomes a reporting insider.
- **Form 4**: Statement of changes in beneficial ownership reporting insider transactions, including acquisitions and dispositions of securities.
- **Form 5**: Annual statement of changes in beneficial ownership covering reportable transactions not previously reported or eligible for deferred reporting.

These filings provide visibility into reported insider ownership and transaction activity. SEC insider disclosures reflect reported transactions and should not be interpreted as confirmation of future stock performance or investment recommendations.

---

## Portfolio Risk Monitor (`PRM`)

The Portfolio Risk Monitor provides a consolidated view of portfolio exposure and potential downside risk.

### Portfolio Analysis

- **Portfolio Concentration**: Identify positions that represent disproportionate portions of total portfolio value.
- **Sector & Industry Exposure**: Evaluate allocation across sectors and industries to identify concentration and overlapping exposures.
- **Position Sizing & Allocation**: Review individual position weights and overall portfolio distribution.
- **Volatility Analysis**: Examine portfolio and position-level volatility.
- **Portfolio Diversification**: Evaluate how portfolio holdings are distributed across different assets and market exposures.
- **Downside Risk Scenarios**: Assess potential portfolio vulnerabilities under adverse market conditions.
- **Excessive Exposure Identification**: Highlight positions, sectors, or industries that may create elevated portfolio risk.

### Portfolio Input Methods

- Manual portfolio entry.
- CSV portfolio import.
- Integration with existing portfolio data.

The Portfolio Risk Monitor is an analytical tool for evaluating portfolio composition and potential risk. Its outputs are not investment advice or guarantees of future performance.

---

## Correlation Analyzer (`CORR`)

The Correlation Analyzer evaluates relationships between securities to help identify shared market behavior, overlapping exposure, and diversification opportunities.

### Correlation Analysis

- Compare relationships between selected securities.
- Identify positively and negatively correlated assets.
- Evaluate how securities move relative to one another.
- Identify holdings with potentially overlapping market exposure.
- Support portfolio diversification and risk analysis.

Correlation measures historical relationships and does not guarantee that securities will maintain the same relationships under future market conditions.

---

## Tech Stack

- **Frontend**: React 19, TypeScript, Vite, Tailwind CSS v4, Lucide Icons, Motion
- **Backend**: Node.js, Express (`server.ts`), Vite dev middleware
- **AI & Data Integrations**:
  - **Market Quotes & OHLCV History**: Yahoo Finance and Alpha Vantage
  - **Macroeconomic Data & FX**: Federal Reserve Economic Data (FRED API)
  - **Prediction Markets**: Polymarket Gamma API
  - **Institutional Holdings**: 3spread API (SEC Form 13F data)
  - **Insider Ownership Reports**: SEC Forms 3, 4, and 5
  - **Financial News**: Yahoo Finance, New York Times API, NewsAPI, NewsData.io
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
        ├── Workspace.tsx      # Screen router and terminal module navigation
        ├── ChartWidget.tsx    # Responsive SVG price charts, technical studies & insider reports
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

Copy `.env.example` to a local `.env` file and populate the keys for the integrations you want to enable:

```bash
cp .env.example .env
```

| Variable | Provider / Purpose | Required |
| --- | --- | --- |
| `ALPHA_VANTAGE_API_KEY` | Alpha Vantage, equity quote fallback and market data | Optional |
| `NYT_API_KEY` | New York Times Business, Top Stories business headlines | Optional |
| `NEWS_API_KEY` | NewsAPI, global corporate and business news headlines | Optional |
| `NEWSDATA_API_KEY` | NewsData.io, real-time market event feeds | Optional |
| `FRED_API_KEY` | FRED (St. Louis Fed), `ECO` macro data, release calendar, and `CRNC` FX rates | Recommended |
| `3SPREAD_API_KEY` | 3spread, institutional holdings and Form 13F data in `INST` (`THREESPREAD_API_KEY` is also supported as a compatibility alias) | Required for INST |
| `GEMINI_API_KEY` | Google Gemini API key for `BWRITE` (Ask QUORIX) and AI-grounded company/news analysis | Recommended |
| `APP_URL` | Hosted application URL | Optional |

Yahoo Finance news and SEC insider ownership reports are documented as data sources. No additional API key is listed here for those sources.

### Credential Storage & Precedence

- **Environment variables are the recommended configuration method** for integrations requiring credentials (`ALPHA_VANTAGE_API_KEY`, `NYT_API_KEY`, `NEWS_API_KEY`, `NEWSDATA_API_KEY`, `FRED_API_KEY`, and `3SPREAD_API_KEY` / `THREESPREAD_API_KEY`).
- **In-memory runtime settings (`SETT`)**: Keys entered through the terminal's **SYSTEM SETTINGS (`SETT`)** screen are held strictly in Node.js server process memory, never written to local files, databases, browser `localStorage`/`sessionStorage`, or frontend build output. Runtime-entered keys are cleared when the server restarts.
- **Environment precedence**: Environment-provided credentials always take precedence over credentials entered through `SETT` and cannot be overwritten or cleared from the UI.
- **Zero partial key disclosure**: Settings API responses return only a fixed mask (`••••••••`) and source indicator (`environment`, `runtime`, or `none`), never actual key characters.

### `.env` Configuration & GitHub Safety

- Create your local `.env` file by copying `.env.example` (`cp .env.example .env`).
- `.env` (and all `.env.*` variants) is excluded from Git via `.gitignore`, along with local database files (`*.db`, `*.sqlite*`), private keys (`*.pem`, `*.key`), and local credential folders (`secrets/`, `credentials/`, `.local/`).
- `.env.example` must contain **placeholder values only** and remains tracked in Git as a template.
- **Never commit actual API credentials** to GitHub or place real keys in `README.md`, source files, or committed configuration files.
- Never prefix API credentials with `VITE_` or expose them to browser code.

### Configuring the 3spread API

The Institutional Activity Monitor (`INST`) requires a 3spread API key.

1. Create an account with [3spread](https://3spread.com/) and obtain an API key.
2. Add your key to your local `.env` file using either `3SPREAD_API_KEY` or the `THREESPREAD_API_KEY` compatibility alias:

```bash
3SPREAD_API_KEY=your_3spread_api_key
# Compatibility alias also supported:
# THREESPREAD_API_KEY=your_3spread_api_key
```

3. Save the file and restart the QUORIX server, or configure a session-only runtime key via **`SETT`** when no environment key is set.

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

Type any command into the top `>` prompt and press **Enter** or click **EXEC**.

| Command | Module | Description |
| --- | --- | --- |
| `BWRITE` | Ask QUORIX | AI financial and macro analyst with Search Grounding |
| `NEWS` | News Hub | Multi-source financial news feed |
| `GP` | Graph Price | Interactive OHLCV charts, technical studies, and insider ownership reports |
| `HP` | Historical Pricing | Tabular OHLCV historical price archive |
| `DES` | Security Analytics | Core company overview, valuation metrics, and bio |
| `ANR` | Analyst Recs | Street consensus estimates and rating breakdown |
| `CRNC` | Currencies (FX) | Foreign exchange rates via FRED |
| `ECO` | Economic Indicator | Macroeconomic dashboard and release calendar via FRED |
| `POLY` | Polymarket Screener | Prediction market odds, volume, liquidity, and spreads |
| `INST` | Institutional Activity Monitor | Institutional holdings, 13F position changes, accumulation screening, and investor profiles |
| `PRM` | Portfolio Risk Monitor | Portfolio concentration, allocation, exposure, volatility, diversification, and downside risk |
| `CORR` | Correlation Analyzer | Analyze correlation relationships and overlapping exposures between securities |
| `SETT` | System Settings | Configure supported API keys at runtime |
| `HELP` | User Manuals | Command syntax and shortcut guide |

### Portfolio Risk Monitor examples

- `PRM` opens the Portfolio Risk Monitor.
- `AAPL PRM` opens the Portfolio Risk Monitor with the active security context set to Apple, where supported.
- `PRM` supports manual portfolio entry, CSV import, and existing portfolio integration.

### Correlation Analyzer examples

- `CORR` opens the Correlation Analyzer.
- Use the analyzer to compare selected securities and evaluate correlation relationships.

### Institutional Activity Monitor examples

- `INST` opens the Institutional Activity Monitor.
- `AAPL INST` opens the monitor for Apple.
- `INST NVDA` opens the monitor for NVIDIA.
- `13F` is an alternate command for the institutional activity screen.

### Chained Commands

Prefix a ticker symbol with a screen command, e.g. `NVDA GP`, `TSLA DES`, `BTC HP`, or type a ticker symbol (`AAPL`) to switch the active security.

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

The Institutional Activity Monitor uses server-side 3spread API integration. The server handles authentication using the `3SPREAD_API_KEY` (or compatibility alias `THREESPREAD_API_KEY`) environment variable, falling back to an optional in-memory runtime key configured via `SETT` when no environment variable is set.

- `GET /v1/data-as-of` - Available data reporting date
- `GET /v1/coverage/by-issuer/{cik_or_ticker}` - Issuer coverage lookup
- `GET /v1/beneficial-ownership` - Beneficial ownership data
- `GET /v1/institutional-holdings` - Institutional holdings data
- `GET /v1/institutional-holdings/{filing_id}` - Filing details
- `GET /v1/institutional-holdings/holdings` - Holdings records

### Insider Ownership Data

Graph Price (`GP`) provides access to SEC insider ownership disclosures through Forms 3, 4, and 5. These filings document initial beneficial ownership and subsequent changes in insider holdings.

### Portfolio Risk & Correlation Analysis

The Portfolio Risk Monitor (`PRM`) and Correlation Analyzer (`CORR`) provide portfolio exposure, risk, and security relationship analysis. Refer to the application implementation for the specific data integrations and calculation methods used by these modules.

**Disclosure timing:** Institutional holdings are based on quarterly SEC Form 13F filings. Managers may report holdings up to 45 days after quarter-end. The data reflects reported filing information, not real-time trading activity or investment recommendations.