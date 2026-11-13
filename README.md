# QUORIX Terminal

A retro CRT-styled financial market terminal built with React, TypeScript, Tailwind CSS, and an Express backend proxy. QUORIX integrates live equity/index market data, Federal Reserve Economic Data (FRED), Polymarket prediction markets, multi-source financial news, and AI-assisted research grounded with live market context.

---

## Features

- **Command-Driven Terminal UI**: Execute ticker and module commands directly from the top command bar (`AAPL GP`, `NVDA DES`, `ECO`, `CRNC`, `POLY`, `NEWS`, `BWRITE`, `SETT`, `HELP`) or select shortcuts from the left sidebar.
- **Interactive Price, Volume & RSI Charting (`GP`)**:
  - Candlestick, Line, and Area chart modes with toggleable `3MA`, `VOLUME`, and `RSI (6)` studies.
  - Multi-timeframe OHLCV intervals (`5m`, `15m`, `30m`, `1h`, `1D`, `1W`, `1M`).
  - Responsive 1:1 pixel-matched SVG scaling via `ResizeObserver` for undistorted axes and dynamic tick spacing.
- **Historical Pricing (`HP`), Security Analytics (`DES`), and Analyst Consensus (`ANR`)**: Live fundamentals, historical OHLCV tables, and AI-grounded company/analyst research.
- **FRED Macroeconomic & FX Suite (`ECO`, `CRNC`)**:
  - Real-time U.S. & global macroeconomic indicators (GDP, CPI, Unemployment, Fed Funds, Treasury yields, industrial production, retail sales) and upcoming FOMC/economic release calendars via the St. Louis Fed **FRED API**.
  - Live foreign exchange rates powered by FRED FX series (`EUR/USD`, `USD/JPY`, `GBP/USD`, `USD/CHF`, `USD/CAD`, `AUD/USD`, `USD/CNY`, etc.).
- **Polymarket Screener (`POLY`)**: Live event probabilities, volume, liquidity, and arbitrage/spread monitoring via the Polymarket Gamma API.
- **Real-Time Multi-Source News Hub & Ticker (`NEWS`)**: Aggregates live financial headlines from NYT Top Stories, NewsAPI, and NewsData.io with auto-scrolling tape and 60-second refresh.
- **Ask QUORIX (`BWRITE`)**: Server-side `@google/genai` (Gemini) analyst assistant enriched with Google Search grounding, live equity quotes, and FRED macro snapshots.
- **Customizable Workspace (`SETT`)**:
  - Resizable left sidebar split between **Terminal Commands** and **Tracked Equities** (persisted to `localStorage`).
  - World market clocks (`GMT`, `NY`, `LDN`, `TYO`) with IANA timezone/DST accuracy.
  - Secure runtime API key management panel (`SETT`) with Save and Cancel controls.

---

## Tech Stack

- **Frontend**: React 19, TypeScript, Vite, Tailwind CSS v4, Lucide Icons, Motion
- **Backend**: Node.js, Express (`server.ts`), Vite dev middleware
- **AI & Data Integrations**:
  - **Market Quotes & OHLCV History**: Yahoo Finance & Alpha Vantage
  - **Macroeconomic Data & FX**: Federal Reserve Economic Data (FRED API)
  - **Prediction Markets**: Polymarket Gamma API
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
        ├── Workspace.tsx      # Screen router (BWRITE, GP, HP, DES, ANR, ECO, CRNC, NEWS, SETT, HELP)
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
| `GEMINI_API_KEY` | Google Gemini API key for `BWRITE` (Ask QUORIX) & AI-grounded company/news analysis | Recommended |
| `FRED_API_KEY` | St. Louis Fed FRED API key for `ECO` macro data, release calendar & `CRNC` FX rates | Recommended |
| `ALPHA_VANTAGE_API_KEY` | Alpha Vantage API key for equity fundamentals & fallback quote lookup | Optional |
| `NYT_API_KEY` | New York Times Top Stories API key for live business headlines | Optional |
| `NEWS_API_KEY` | NewsAPI key for corporate and equity news | Optional |
| `NEWSDATA_API_KEY` | NewsData.io API key for real-time market events | Optional |
| `APP_URL` | Hosted application URL | Optional |

> **Tip**: API keys for Alpha Vantage, NYT, NewsAPI, NewsData.io, and FRED can also be configured at runtime inside the terminal via the **`SETT`** screen.

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
| `BWRITE` | Ask QUORIX | AI financial & macro analyst with Search Grounding |
| `NEWS` | News Hub | Live multi-source financial news feed |
| `GP` | Graph Price | Interactive OHLCV candlestick/line/area + Volume & RSI charts |
| `HP` | Historical Pricing | Tabular OHLCV historical price archive |
| `DES` | Security Analytics | Core company overview, valuation metrics & bio |
| `ANR` | Analyst Recs | Street consensus estimates & rating breakdown |
| `CRNC` | Currencies (FX) | Live foreign exchange rates via FRED |
| `ECO` | Economic Indicator | Macroeconomic dashboard & release calendar via FRED |
| `POLY` | Polymarket Screener | Real-time prediction market odds & spreads |
| `SETT` | System Settings | Configure API keys at runtime |
| `HELP` | User Manuals | Command syntax & shortcut guide |

**Chained Commands**: Prefix a ticker symbol with a screen command, e.g. `NVDA GP`, `TSLA DES`, `BTC HP`, or type a ticker symbol (`AAPL`) to switch the active security.

---

## Backend API Endpoints

The Express server (`server.ts`) proxies external requests to protect credentials and normalize responses:

- `GET /api/alpha-vantage/quote` — Live market quote & fundamentals lookup
- `GET /api/market/history` — Multi-interval historical OHLCV bars
- `GET /api/fred/economics` — FRED macroeconomic series & upcoming release dates
- `GET /api/fred/currencies` — FRED FX exchange rate series
- `GET /api/polymarket/events` — Polymarket active events & odds
- `GET /api/news/ticker` — Aggregated live business & market headlines
- `POST /api/terminal/analyze` — Gemini AI terminal analysis with market/FRED grounding
- `GET /api/settings/keys` & `POST /api/settings/keys` — Runtime API key status and configuration
