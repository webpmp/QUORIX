# Architecture & Backend API Reference

This document provides a detailed overview of the QUORIX repository layout and backend API proxy routes.

---

## Detailed Project Structure

```text
├── server.ts                  # Express backend & API proxy routes (port 3000)
├── index.html                 # App entry point
├── package.json               # Scripts & dependencies
├── .env.example               # Environment variable template
├── vite.config.ts             # Vite configuration
├── docs/                      # Extended technical documentation
│   ├── modules.md             # In-depth module documentation
│   ├── api-keys.md            # API key registration guide
│   └── architecture.md        # Architecture & backend API reference
└── src/
    ├── App.tsx                # Root terminal layout, global state & command router
    ├── data.ts                # Tracked equities & index tape symbol definitions
    ├── types.ts               # Shared TypeScript interfaces
    ├── utils/
    │   ├── commandParser.ts   # CLI command parser, screen aliases & prefix matching
    │   ├── reportFormatting.tsx # Structured DES and ANR parsing and layout renderers
    │   ├── gpNewsRelevance.ts # Balanced relevance scoring for GRAPH PRICE & NEWS HUB
    │   ├── institutionalActivity.ts # 13F data transformers & helpers
    │   └── equityValidation.ts# Equity validation & quote normalization
    └── components/
        ├── Header.tsx         # Market clocks, branding & CLI command bar
        ├── CommandPanel.tsx   # Left sidebar: Terminal Commands & Tracked Equities
        ├── CompanyLogo.tsx    # Multi-tier company logo component with fallback monogram
        ├── TickerTape.tsx     # Scrolling index/equity/commodity/crypto tape
        ├── NewsTicker.tsx     # Scrolling multi-source news crawl
        ├── Workspace.tsx      # Central screen router and workspace renderer
        ├── ChartWidget.tsx    # Responsive SVG charts, technical studies & insider reports
        ├── PolymarketScreen.tsx # Live Polymarket screener
        ├── CurrenciesScreen.tsx # FX intelligence workspace
        ├── InstitutionalActivityScreen.tsx # 13F institutional ownership monitor
        ├── PortfolioRiskMonitorScreen.tsx  # PRM portfolio risk workspace
        ├── CorrelationAnalyzerScreen.tsx   # Multi-security correlation matrix
        ├── StickyScreenHeader.tsx # Responsive sticky screen header container
        └── BeepGenerator.ts   # Retro terminal Web Audio feedback
```

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

### Congressional Trading Disclosures (House Clerk & STOCK Act)
The Congressional Trading feed (`CONGRESS` tab in `INST`) ingests Periodic Transaction Reports (PTRs) from the Office of the Clerk of the U.S. House of Representatives. Disclosures are cached locally at `.cache/congress-trades.json` with a 6-hour TTL:
- `GET /api/congress/trades` - Filterable and paginated congressional trade feed (filters: party, type, owner, ticker, politician, assetGroup, date range)
- `GET /api/congress/status` - Ingestion backfill progress, last updated timestamp, stale indicator, and document counts
- **Data Source**: House Clerk Public Disclosure Index (`financial-pdfs/{year}FD.zip`) and document archives (`ptr-pdfs/{year}/{docid}.pdf`).
- **Enrichment**: Curated subset of `unitedstates/congress-legislators` (CC0 1.0 Universal Public Domain) providing bioguide IDs, party affiliation, and district matching.
- **Controls & UI**: Unified with the main INST header controls — the header `REFRESH` button triggers a sync with "UP TO DATE" status confirmation and disabled spinner during active ingestion. Header timestamp reflects the Congress cache state with an amber `STALE` badge when older than 24 hours. Table columns include `NOTIFIED`, `FILED`, and `GAP` with tooltips explaining the 30-day notification / 45-day overall statutory deadlines.
- **Data Notice**: Disclosures arrive up to 45 days after execution. Amounts are statutory ranges, not exact figures. Sourced for personal, non-commercial research under Title I of the Ethics in Government Act (5 U.S.C. app. § 105). Senate disclosures are excluded due to commercial use restrictions under 5 U.S.C. app. § 105(c).

### Insider Ownership Disclosures (SEC EDGAR)
Graph Price (`GP`) retrieves public SEC insider ownership disclosures (Forms 3, 4, and 5) directly from SEC EDGAR. These filings provide transparency into reported transactions by corporate insiders and do not require user API credentials.

### Portfolio Risk & Correlation Calculations
The Portfolio Risk Monitor (`PRM`) and Correlation Analyzer (`CORR`) perform server- and client-side analytical calculations over historical returns and user portfolio inputs to derive risk decomposition, beta, concentration, and correlation coefficients.
