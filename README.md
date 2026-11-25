![QUORIX Terminal](./assets/quorix-gp-v1.png)

# QUORIX Terminal

A retro CRT-styled financial market terminal built with React, TypeScript, Tailwind CSS, and an Express backend proxy. QUORIX integrates live equity/index market data, Federal Reserve Economic Data (FRED), Polymarket prediction markets, institutional ownership data, multi-source financial news, portfolio risk analysis, correlation analysis, and AI-assisted research grounded with live market context.

---

## Features & Application Modules

The QUORIX terminal interface is organized into dedicated modules, accessible directly via the top command prompt or from the left sidebar's **Terminal Commands** menu:

1. **Ask QUORIX (`ASK`)**: AI financial and macro analyst assistant powered by Google Gemini (`@google/genai`) with Google Search grounding, live equity quotes, and FRED macroeconomic snapshots (legacy alias: `BWRITE`).
2. **News Hub (`NEWS`)**: Real-time multi-source financial news aggregator combining Yahoo Finance ticker news, New York Times Top Stories, NewsAPI, and NewsData.io feeds with an auto-scrolling bottom ticker tape and customizable ticker filtering.
3. **Graph Price (`GP`)**: Interactive candlestick, line, and area charts with multi-timeframe OHLCV intervals (`5m` to `1M`), responsive SVG scaling, built-in technical studies, and SEC Forms 3, 4, and 5 insider ownership reports.
4. **Correlation Analyzer (`CORR`)**: Multi-asset correlation matrix and pairwise relationship analyzer to detect market co-movement, overlapping asset exposures, and portfolio diversification boundaries.
5. **Portfolio Risk Monitor (`PRM`)**: Portfolio exposure and downside risk evaluation, including concentration metrics, sector/industry allocations, position sizing, volatility assessments, and stress-test scenarios.
6. **Historical Pricing (`HP`)**: Comprehensive tabular archive of historical OHLCV pricing, intraday bars, volume analysis, and earnings reporting dates.
7. **Security Analytics (`DES`)**: Core corporate biography, financial valuation metrics, capital structure, and fundamental profile powered by live market feeds and AI synthesis.
8. **Analyst Recs (`ANR`)**: Wall Street consensus price targets, analyst recommendation distributions (Strong Buy, Buy, Hold, Underperform, Sell), and street sentiment breakdown.
9. **Institutional Activity Monitor (`INST`)**: Deep Form 13F ownership analytics powered by 3spread, including institutional holdings search, position changes (new, increased, decreased, sold out), multi-period accumulation screening, and institutional investor profiles.
10. **Currencies FX (`CRNC`)**: Foreign exchange intelligence and cross-rates powered by St. Louis Fed FRED H.10 currency series (`EUR/USD`, `USD/JPY`, `GBP/USD`, `USD/CHF`, `USD/CAD`, `AUD/USD`, `USD/CNY`, etc.).
11. **Economic Indicator (`ECO`)**: Comprehensive macroeconomic dashboard tracking GDP, CPI, PCE, unemployment, Fed Funds, Treasury yields, industrial production, and upcoming FOMC/economic release schedules via FRED.
12. **Polymarket Screener (`POLY`)**: Real-time prediction market event screener, monitoring prediction probabilities, volume, liquidity, and cross-market implied probabilities via the Polymarket Gamma API.
13. **System Settings (`SETT`)**: Terminal configuration workspace for managing API credentials at runtime, inspecting masked key statuses, verifying environment overrides, and diagnostic testing.
14. **User Manual (`HELP`)**: Built-in CLI reference guide, navigation shortcuts, syntax rules, and terminal capability documentation.

---

## Module Documentation

The documentation below details each module in the exact order it appears in the QUORIX left sidebar navigation.

### 1. Ask QUORIX (`ASK`)

The Ask QUORIX workspace (`ASK` or `BWRITE`) provides conversational market and macro analysis using Google Gemini (`@google/genai`).

- **Search Grounding**: Enriches prompts with live Google Search web grounding to capture breaking news and market-moving events.
- **Context Awareness**: Automatically pulls in quote data, price action, and macroeconomic context for the currently selected security or topic.
- **Macro Integration**: Combines Federal Reserve economic indicators and current market stats into AI synthesis.
- **Quick Prompts**: Supports natural language inquiries directly from the command bar (e.g., `Give me a brief analysis of NVDA`).

### 2. News Hub (`NEWS`)

The News Hub provides a consolidated, real-time stream of financial and market news from multiple independent wire services and news organizations.

- **Multi-Source Aggregation**: Synthesizes headlines from Yahoo Finance (ticker-specific coverage), The New York Times Business Top Stories, NewsAPI, and NewsData.io.
- **Broad-Market vs. Ticker-Filtered Modes**:
  - Entering `NEWS` displays the unfiltered broad-market business feed across macro, industry, and world finance.
  - Entering `NEWS <TICKER>` (e.g., `NEWS META`) filters the feed using the Balanced relevance algorithm to display stories specifically relevant to that company.
  - Clicking **SHOW ALL** returns the workspace to the broad-market news stream while preserving the global active ticker context.
- **Live News Ticker Tape**: A continuous, auto-scrolling news ticker at the bottom of the screen displays real-time headlines with source indicators and hover-to-pause capability.

### 3. Graph Price (`GP`)

Graph Price is the primary technical analysis and chart workspace in QUORIX. It includes interactive charting, technical indicators, and SEC insider ownership disclosures.

#### Technical Studies & Indicators

Click **STUDIES** in the Graph Price (`GP`) toolbar to toggle technical indicators. Selections persist automatically in local state. Defaults: `3MA`, `VOLUME`, `RSI (14)`.

##### Price Overlays
- **3MA**: *3-Period Simple Moving Average* (`OVERLAY`): Fast 3-bar simple moving average tracking immediate short-term price slope.
- **9 EMA**: *9-Period Exponential Moving Average* (`OVERLAY`): Responsive short-term EMA weighted toward recent closes for momentum entries.
- **20 EMA**: *20-Period Exponential Moving Average* (`OVERLAY`): Dynamic intermediate trend support/resistance benchmark (pairs with `9 EMA`).
- **50 SMA**: *50-Period Simple Moving Average* (`OVERLAY`): Classic medium-term institutional trendline across the active timeframe.
- **VWAP**: *Volume-Weighted Average Price* (`OVERLAY`): Session-reset benchmark weighting typical price by cumulative share volume.
- **BB (20,2)**: *Bollinger Bands (20, 2σ)* (`OVERLAY`): 20-bar SMA envelope with ±2 standard deviation upper and lower volatility bands.
- **PSAR**: *Parabolic SAR (0.02, 0.2)* (`OVERLAY`): Trailing stop-and-reverse dots above/below candles indicating trend shifts.
- **HI/LO/PC**: *Window High / Low & Prev Close* (`OVERLAY`): Horizontal reference lines for visible high, low, and previous close.

##### Volume & Volatility
- **VOLUME**: *Volume Histogram* (`SUB-PANEL`): Bar-by-bar share volume colored green on up closes and red on down closes.
- **VOL MA(20)**: *Volume 20-Period Moving Average* (`VOLUME OVERLAY`): 20-bar average line on the Volume panel to spot unusual volume spikes.
- **ATR (14)**: *Average True Range (14)* (`SUB-PANEL`): Wilder volatility gauge measuring average price range per bar in dollars.
- **OBV**: *On-Balance Volume* (`SUB-PANEL`): Cumulative volume flow adding up-bar volume and subtracting down-bar volume.

##### Momentum & Trend
- **RSI (14)**: *Relative Strength Index (14)* (`SUB-PANEL`): Wilder momentum oscillator scaled 0–100 with 70 Overbought and 30 Oversold zones.
- **MACD**: *MACD (12, 26, 9)* (`SUB-PANEL`): 12/26 EMA spread, 9-bar signal line, and divergence histogram around zero.
- **STOCH**: *Slow Stochastic (14, 3, 3)* (`SUB-PANEL`): `%K` and `%D` momentum lines (0–100) highlighting 80 OB / 20 OS turning points.
- **CCI (20)**: *Commodity Channel Index (20)* (`SUB-PANEL`): Cyclical deviation from 20-bar typical price mean with `+100` / `-100` thresholds.
- **ADX / DMI**: *ADX & Directional Movement (14)* (`SUB-PANEL`): Measures trend strength (`ADX`) alongside bullish (`+DI`) and bearish (`-DI`) pressure.
- **ROC (12)**: *Rate of Change (12)* (`SUB-PANEL`): Percentage price change vs. 12 bars ago plotted around a `0.0%` baseline.

##### Insider Ownership Reports
Graph Price (`GP`) displays direct SEC insider ownership filings below the chart:
- **Form 3**: Initial statement of beneficial ownership filed when an individual becomes a corporate insider (director, officer, or 10%+ owner).
- **Form 4**: Statement of changes in beneficial ownership documenting insider trades (open-market purchases, sales, option exercises, and grants).
- **Form 5**: Annual statement of changes in beneficial ownership reporting transactions exempt from prior Form 4 reporting or eligible for deferred reporting.

*Note: SEC insider disclosures reflect reported filings and should not be interpreted as confirmation of future stock performance or investment recommendations. Insider reports do not require an API key.*

### 4. Correlation Analyzer (`CORR`)

The Correlation Analyzer evaluates statistical price movement relationships between securities to identify shared market behavior, redundant risk, and diversification opportunities.

- **Cross-Asset Correlation Matrix**: Compares daily returns across a custom basket of equities, indices, and assets.
- **Directional Relationships**: Distinguishes between strongly positive correlations (co-moving assets), neutral correlations, and negative correlations (hedging assets).
- **Overlapping Exposure Detection**: Identifies assets that appear diversified on the surface but share high correlation coefficients.
- **Historical Basis**: Computes rolling correlation coefficients based on historical price series. Historical correlation does not guarantee identical relationships during future volatility regimes.

### 5. Portfolio Risk Monitor (`PRM`)

The Portfolio Risk Monitor provides institutional-grade portfolio risk decomposition, exposure diagnostics, and downside scenario analysis.

- **Portfolio Concentration**: Pinpoints individual positions representing disproportionate percentages of net portfolio value.
- **Sector & Industry Exposure**: Evaluates allocation across GICS sectors and industries to reveal inadvertent concentration.
- **Position Sizing & Weights**: Inspects individual portfolio weights against diversification guidelines.
- **Volatility & Diversification Scoring**: Evaluates portfolio-level volatility, weighted beta, and effective diversification benefits.
- **Downside Risk & Stress Testing**: Analyzes potential portfolio drawdowns across historical market shock scenarios.
- **Input Methods**: Supports interactive manual position entry, CSV portfolio file upload, and saved portfolio configurations.

### 6. Historical Pricing (`HP`)

Historical Pricing provides an expansive, tabular view of historical market pricing, volume history, and corporate reporting milestones.

- **Tabular OHLCV Log**: Browse open, high, low, close, volume, and percentage change records by session or intraday bar.
- **Earnings Highlights**: Integrates historical earnings report dates and announcement timing directly into the price history log.
- **Data Export & Analysis**: Allows traders to inspect historical volatility, gap behavior, and price levels across multi-year lookback windows.

### 7. Security Analytics (`DES`)

Security Analytics (`DES`) acts as the company descriptive bio and fundamentals dashboard for the selected equity.

- **Corporate Profile**: Displays sector, industry, corporate headquarters, executive leadership, and business description.
- **Valuation & Fundamentals**: Summarizes key metrics including market capitalization, P/E ratio, enterprise value, beta, 52-week ranges, dividend yield, and average volume.
- **AI Synthesis**: Synthesizes corporate disclosures and market positioning into an executive overview.

### 8. Analyst Recs (`ANR`)

The Analyst Recommendations screen aggregates sell-side equity research ratings and price target consensus.

- **Consensus Rating**: Calculates the aggregate street rating (Strong Buy, Moderate Buy, Hold, Moderate Sell, Strong Sell).
- **Price Target Distribution**: Displays the mean, median, high, and low 12-month analyst price targets alongside implied upside/downside percentages.
- **Analyst Coverage Count**: Shows the number of participating research analysts and rating distribution trends.

### 9. Institutional Activity Monitor (`INST`)

The Institutional Activity Monitor provides visibility into institutional ownership patterns, quarterly SEC Form 13F filings, and institutional accumulation trends powered by the **3spread** API.

- **Institutional Holdings Search**: Search institutional positions by ticker symbol, CUSIP, or issuer name.
- **Position Changes**: Review quarter-over-quarter institutional movements:
  - New positions established.
  - Increased positions (additions).
  - Decreased positions (trims).
  - Exited positions (full liquidations).
  - Unchanged holdings.
- **Multi-Period Accumulation Screener**: Identify securities experiencing sustained institutional accumulation across consecutive reporting cycles.
- **Investor Profiles**: Inspect institutional investment managers, total 13F portfolio values, top holdings, and concentration metrics.
- **Disclosure Timing**: Institutional holdings reflect quarterly SEC Form 13F filings. Institutional investment managers have up to 45 days after the end of each calendar quarter to file Form 13F with the SEC. Data reflects filed holdings, not real-time trading activity.

### 10. Currencies FX (`CRNC`)

The Currencies screen provides foreign exchange market intelligence, cross-rates, and central bank FX series powered by Federal Reserve Economic Data (FRED).

- **Major Crosses**: Tracks currency pairs including `EUR/USD`, `USD/JPY`, `GBP/USD`, `USD/CHF`, `USD/CAD`, `AUD/USD`, and `USD/CNY`.
- **H.10 Daily Rates**: Connects directly to the Federal Reserve Board's H.10 release for official foreign exchange rates.
- **Historical FX Trajectories**: Chart and inspect multi-year currency strength trends and volatility.

### 11. Economic Indicator (`ECO`)

The Economic Indicator workspace delivers macro surveillance by connecting to the Federal Reserve Bank of St. Louis FRED database.

- **Core Macro Dashboard**: Track critical economic indicators:
  - **Inflation**: Consumer Price Index (CPI), Core CPI, Personal Consumption Expenditures (PCE).
  - **Labor**: Nonfarm Payrolls (NFP), Unemployment Rate, Initial Jobless Claims, JOLTS.
  - **Growth & Output**: Real GDP, Industrial Production, Retail Sales, Durable Goods.
  - **Monetary & Rates**: Effective Federal Funds Rate, Treasury Yields (2Y, 10Y, 30Y), 10Y–2Y Yield Curve Spread, SOFR.
- **FRED Release Calendar**: Interactive calendar tracking upcoming economic releases and FOMC policy announcements.

### 12. Polymarket Screener (`POLY`)

The Polymarket Screener surfaces live predictive market odds, trading volume, liquidity, and probability spreads powered by the decentralized Polymarket Gamma API.

- **Real-Time Probabilities**: Monitor market-implied odds on political events, economic outcomes, interest rate decisions, and tech milestones.
- **Volume & Liquidity**: Screen active markets by 24-hour volume, total market liquidity, and open interest.
- **Search & Ticker Linking**: Filter prediction events by ticker symbol or keyword to discover markets relevant to active securities.

### 13. System Settings (`SETT`)

System Settings provides security-focused management of API integrations, connection diagnostics, and session credentials.

- **Credential Status Monitoring**: Inspect which API integrations are active, whether credentials originate from the server environment (`.env`) or session runtime memory, and check masked status indicators.
- **Runtime Key Configuration**: Add or update API credentials in server process memory without modifying files on disk. Runtime keys are never written to disk or browser storage and expire when the server process stops.
- **Environment Precedence**: Credentials defined in `.env` are protected by the backend and cannot be overwritten by runtime inputs.

### 14. User Manual (`HELP`)

The User Manual provides terminal syntax rules, keyboard navigation reference, screen alias dictionaries, and CLI command formatting guidelines.

---

## Tech Stack

- **Frontend**: React 19, TypeScript, Vite, Tailwind CSS v4, Lucide Icons, Motion
- **Backend**: Node.js, Express (`server.ts`), Vite development middleware
- **Data Providers & Integrations**:
  - **Market Quotes & OHLCV History**: Yahoo Finance (no API key required) and Alpha Vantage (optional quote fallback)
  - **Macroeconomic Data & FX**: Federal Reserve Economic Data (St. Louis Fed FRED API)
  - **Prediction Markets**: Polymarket Gamma API (no API key required)
  - **Institutional Holdings**: 3spread API (Form 13F institutional ownership)
  - **Insider Ownership Reports**: SEC Forms 3, 4, and 5 (public EDGAR disclosures)
  - **Financial News**: Yahoo Finance (no key required), New York Times Developer Network, NewsAPI, NewsData.io
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
    ├── App.tsx                # Root terminal layout, global state & command router
    ├── data.ts                # Tracked equities & index tape symbol definitions
    ├── types.ts               # Shared TypeScript interfaces
    ├── utils/
    │   ├── commandParser.ts   # CLI command parser, screen aliases & prefix matching
    │   ├── gpNewsRelevance.ts # Balanced relevance scoring for GRAPH PRICE & NEWS HUB
    │   └── equityValidation.ts# Equity validation & quote normalization
    └── components/
        ├── Header.tsx         # Market clocks, branding & CLI command bar
        ├── CommandPanel.tsx   # Left sidebar: Terminal Commands & Tracked Equities
        ├── TickerTape.tsx     # Scrolling index/equity/commodity/crypto tape
        ├── NewsTicker.tsx     # Scrolling multi-source news crawl
        ├── Workspace.tsx      # Central screen router and workspace renderer
        ├── ChartWidget.tsx    # Responsive SVG charts, technical studies & insider reports
        ├── PolymarketScreen.tsx # Live Polymarket screener
        ├── CurrenciesScreen.tsx # FX intelligence workspace
        ├── InstitutionalActivityScreen.tsx # 13F institutional ownership monitor
        ├── PortfolioRiskMonitorScreen.tsx  # PRM portfolio risk workspace
        ├── CorrelationAnalyzerScreen.tsx   # Multi-security correlation matrix
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

QUORIX is designed to run immediately with core market features available out of the box. Follow this sequence to configure your credentials:

1. **Create your local `.env` file**:
   ```bash
   cp .env.example .env
   ```
2. **Identify the integrations you want to enable**:
   - Quotes, candlestick charts, Polymarket prediction odds, and SEC Form 3/4/5 insider reports work immediately without any API keys.
   - Configure only the third-party integrations you intend to use. Features without keys will gracefully disable or run in unauthenticated mode without affecting other screens.
3. **Obtain API credentials** from the official provider portals detailed in the [API Key Acquisition Guide](#api-key-acquisition-guide).
4. **Populate the keys in `.env`**:
   Open `.env` in an editor and paste the keys into the corresponding environment variables.
5. **Save the file and start/restart the server**:
   When launching via `npm run dev`, the server reads `.env` automatically.
6. **Optional: Session-only runtime configuration**:
   If you prefer not to store credentials on disk, you can leave `.env` empty and enter credentials into **SYSTEM SETTINGS (`SETT`)** in the running terminal. Runtime keys are kept strictly in server memory and discarded on server restart.

---

## API Key Acquisition Guide

The table below lists every supported third-party API credential, its provider registration URL, and its requirement level:

| Environment Variable | Provider | Official Registration / Developer Portal | Level | Affected Features |
|---|---|---|---|---|
| `GEMINI_API_KEY` | Google AI Studio | [Google AI Studio API Keys](https://aistudio.google.com/apikey) | Recommended | Ask QUORIX (`ASK`), Security Analytics (`DES`), Analyst Recs (`ANR`) |
| `FRED_API_KEY` | Federal Reserve Bank of St. Louis | [FRED API Key Registration](https://fredaccount.stlouisfed.org/apikeys) | Recommended | Economic Indicator (`ECO`), Currencies FX (`CRNC`) |
| `3SPREAD_API_KEY` | 3spread | [3spread Registration](https://www.3spread.com/auth/signup) | Required for INST | Institutional Activity Monitor (`INST`) Form 13F holdings & accumulation |
| `NYT_API_KEY` | New York Times Developer Network | [NYT Developer Portal](https://developer.nytimes.com/) | Optional | News Hub (`NEWS`) Top Stories business headlines & news ticker crawl |
| `NEWS_API_KEY` | NewsAPI | [NewsAPI Registration](https://newsapi.org/register) | Optional | News Hub (`NEWS`) global corporate news & news ticker crawl |
| `NEWSDATA_API_KEY` | NewsData.io | [NewsData.io Registration](https://newsdata.io/register) | Optional | News Hub (`NEWS`) real-time business news & news ticker crawl |
| `ALPHA_VANTAGE_API_KEY` | Alpha Vantage | [Alpha Vantage Support / Key](https://www.alphavantage.co/support/#api-key) | Optional | Secondary quote & intraday fallback for Graph Price (`GP`) |

*Note on Uncredentialed Data: Yahoo Finance equity quotes, OHLCV charts, and news feeds, Polymarket prediction markets, and SEC Form 3, 4, and 5 insider ownership reports do NOT require a user-supplied API key.*

### Provider Registration Details

#### 1. Google Gemini (`GEMINI_API_KEY`)
- **Portal**: [Google AI Studio](https://aistudio.google.com/apikey)
- **Account Steps**: Sign in with your Google account.
- **Key Generation**: Click **Create API key**, select or create a Google Cloud project, and copy the generated key.
- **QUORIX Features**: Powers Ask QUORIX (`ASK`), terminal analysis prompts, and AI synthesis in Security Analytics (`DES`) and Analyst Recs (`ANR`).
- **Status**: Recommended. Without this key, AI features display a prompt instructing you to configure `GEMINI_API_KEY`.

#### 2. Federal Reserve Economic Data (`FRED_API_KEY`)
- **Portal**: [St. Louis Fed FRED Account API Keys](https://fredaccount.stlouisfed.org/apikeys) (documentation at [FRED API Docs](https://fred.stlouisfed.org/docs/api/api_key.html))
- **Account Steps**: Create a free user account on the St. Louis Fed website.
- **Key Generation**: Navigate to **My Account** > **API Keys**, request a key, and provide a brief description of your application.
- **QUORIX Features**: Powers the Economic Indicator (`ECO`) dashboard, upcoming FOMC/macro release calendar, and foreign exchange rates in Currencies (`CRNC`).
- **Status**: Recommended. Without this key, economic and currency feeds prompt for key configuration.

#### 3. 3spread (`3SPREAD_API_KEY` or `THREESPREAD_API_KEY`)
- **Portal**: [3spread Sign Up](https://www.3spread.com/auth/signup) (homepage at [3spread.com](https://3spread.com/))
- **Account Steps**: Register for a 3spread account.
- **Key Generation**: Access the 3spread dashboard to retrieve your Community tier or developer API key.
- **QUORIX Features**: Powers the Institutional Activity Monitor (`INST`), including Form 13F institutional holdings search, position changes, multi-period accumulation screening, and institutional manager profiles.
- **Status**: Required for `INST`. Both `3SPREAD_API_KEY` and the compatibility alias `THREESPREAD_API_KEY` are supported.
- **Distinction**: 3spread provides quarterly SEC Form 13F institutional data. It is completely separate from the SEC Form 3/4/5 insider ownership reports displayed in Graph Price (`GP`), which require no API key.

#### 4. New York Times Developer Network (`NYT_API_KEY`)
- **Portal**: [NYT Developer Network](https://developer.nytimes.com/)
- **Account Steps**: Create a developer account on the NYT Developer Portal.
- **Key Generation**: Navigate to **My Apps** > **New App**, name your application, and enable the **Top Stories API**. Copy the generated API key.
- **QUORIX Features**: Enriches the News Hub (`NEWS`) and the bottom scrolling news ticker with curated New York Times Business Top Stories.
- **Status**: Optional. If omitted, News Hub continues to aggregate headlines from other active news sources.

#### 5. NewsAPI (`NEWS_API_KEY`)
- **Portal**: [NewsAPI Registration](https://newsapi.org/register)
- **Account Steps**: Register for a developer account at NewsAPI.org.
- **Key Generation**: The API key is provided on your account dashboard immediately after registration.
- **QUORIX Features**: Supplies global corporate and business headlines to News Hub (`NEWS`) and the bottom news ticker crawl.
- **Status**: Optional.

#### 6. NewsData.io (`NEWSDATA_API_KEY`)
- **Portal**: [NewsData.io Registration](https://newsdata.io/register)
- **Account Steps**: Sign up for an account at Newsdata.io.
- **Key Generation**: Obtain your API key from the API dashboard.
- **QUORIX Features**: Ingests real-time financial and market news for News Hub (`NEWS`) and the bottom news ticker.
- **Status**: Optional.

#### 7. Alpha Vantage (`ALPHA_VANTAGE_API_KEY`)
- **Portal**: [Alpha Vantage API Key Claim](https://www.alphavantage.co/support/#api-key)
- **Account Steps**: Enter your email address and organization type on the claim form.
- **Key Generation**: A free API key is generated instantly on the page.
- **QUORIX Features**: Serves as a fallback data provider for equity quotes and historical intraday pricing in Graph Price (`GP`).
- **Status**: Optional. Primary market quotes, charts, and volume data are served via Yahoo Finance without requiring an API key.

---

### API Credential Security

- Never commit `.env` files or actual API credentials to GitHub.
- Keep real API keys in your local `.env` file or configure them through `SETT`.
- `.env.example` should contain placeholder values only.
- Never use the `VITE_` prefix for API credentials. This exposes variables to client-side code.
- If a credential is accidentally committed, revoke or rotate the key immediately.

---

### 3. Run in Development Mode

Starts the Express backend server with Vite development middleware on **http://localhost:3000** (or configured port):

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

Enter any command into the top command bar prompt (`>`) and press **Enter** or click **EXEC**. You can also click shortcuts directly in the left sidebar.

| Command | Left Sidebar Module | Description |
| --- | --- | --- |
| `ASK` | Ask QUORIX | AI financial and macro analyst with Search Grounding |
| `NEWS` | News Hub | Multi-source real-time financial news stream |
| `GP` | Graph Price | Interactive OHLCV charts, technical studies, and insider ownership reports |
| `CORR` | Correlation Analyzer | Cross-asset correlation matrix and overlapping exposure analysis |
| `PRM` | Portfolio Risk Monitor | Portfolio exposure, concentration, and downside risk stress-testing |
| `HP` | Historical Pricing | Tabular historical OHLCV pricing and earnings calendar archive |
| `DES` | Security Analytics | Corporate profile, valuation fundamentals, and executive bio |
| `ANR` | Analyst Recs | Street consensus ratings, breakdown, and price target expectations |
| `INST` | Institutional Activity | Institutional Form 13F holdings, accumulation screening, and investor profiles |
| `CRNC` | Currencies (FX) | Foreign exchange rates and cross-rate analysis via FRED |
| `ECO` | Economic Indicator | Macroeconomic indicator dashboard and release calendar via FRED |
| `POLY` | Polymarket Screener | Live prediction market odds, volumes, liquidity, and spreads |
| `SETT` | System Settings | Configure and inspect API credentials at runtime |
| `HELP` | User Manual | Command syntax guide, navigation rules, and keyboard shortcuts |

### Command Syntax & Ticker Handling

- **Single Global Active Ticker**: The terminal maintains one shared active ticker across all pages.
- **Command with Ticker**: Specifying a ticker updates the global active ticker and loads the destination page with that context:
  - `GP AAPL` sets the active ticker to Apple and displays Graph Price.
  - `NEWS META` sets the active ticker to Meta and displays Meta-filtered news.
  - `ANR GOOG` sets the active ticker to Alphabet and displays Analyst Recommendations.
  - `POLY TSLA` sets the active ticker to Tesla and displays related prediction markets.
- **Command Without Ticker**: Submitting a screen code alone inherits the current global active ticker:
  - Submitting `GP` while Meta is active displays Graph Price for Meta.
  - Submitting `ANR` while Meta is active displays Analyst Recommendations for Meta.
  - Submitting `NEWS` opens the News Hub in **broad-market mode**, displaying unfiltered world and market news while keeping Meta as the active ticker for other screens.
- **Chained Shortcuts**: You can switch tickers by entering either `<COMMAND> <TICKER>` (e.g. `GP MSFT`) or `<TICKER> <COMMAND>` (e.g. `MSFT GP`), or simply enter the ticker symbol directly (`NVDA`) to update the active security.

---

## Backend API Endpoints

The Express server (`server.ts`) acts as a secure reverse proxy for all external APIs, shielding credentials and standardizing response payloads.

### Market, Economic, and News Data
- `GET /api/alpha-vantage/quote` - Fallback equity quote and fundamentals lookup
- `GET /api/market/history` - Multi-interval historical OHLCV candlestick bars
- `GET /api/fred/economics` - FRED macroeconomic indicators and release calendar dates
- `GET /api/fred/currencies` - FRED foreign exchange currency rate series
- `GET /api/polymarket/events` - Live Polymarket active prediction events and probabilities
- `GET /api/news/ticker` - Aggregated multi-source business headlines (supports optional `ticker` parameter)
- `POST /api/terminal/analyze` - Gemini AI terminal analysis with live market and web grounding
- `GET /api/settings/keys` - Masked status and source metadata for configured API credentials
- `POST /api/settings/keys` - Update session runtime API keys in server process memory

### Institutional Activity Data (3spread)
The Institutional Activity Monitor communicates through server-side 3spread API endpoints authenticated by `3SPREAD_API_KEY` (or `THREESPREAD_API_KEY`):
- `GET /v1/data-as-of` - Latest reporting period date
- `GET /v1/coverage/by-issuer/{cik_or_ticker}` - Issuer coverage verification
- `GET /v1/beneficial-ownership` - Beneficial ownership data
- `GET /v1/institutional-holdings` - Institutional holdings overview
- `GET /v1/institutional-holdings/{filing_id}` - Detailed 13F filing contents
- `GET /v1/institutional-holdings/holdings` - Granular institutional holding positions

### Insider Ownership Disclosures (SEC EDGAR)
Graph Price (`GP`) retrieves public SEC insider ownership disclosures (Forms 3, 4, and 5) directly from SEC EDGAR. These filings provide transparency into reported transactions by corporate insiders and do not require user API credentials.

### Portfolio Risk & Correlation Calculations
The Portfolio Risk Monitor (`PRM`) and Correlation Analyzer (`CORR`) perform server- and client-side analytical calculations over historical returns and user portfolio inputs to derive risk decomposition, beta, concentration, and correlation coefficients.
