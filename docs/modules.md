# Module Documentation

The documentation below details each module in the exact order it appears in the QUORIX left sidebar navigation.

---

### 1. Ask QUORIX (`ASK`)

The Ask QUORIX workspace (`ASK` or `BWRITE`) provides conversational market and macro analysis using Google Gemini (`@google/genai`).

- **Search Grounding**: Enriches prompts with live Google Search web grounding to capture breaking news and market-moving events.
- **Context Awareness**: Automatically pulls in quote data, price action, and macroeconomic context for the currently selected security or topic.
- **Macro Integration**: Combines Federal Reserve economic indicators and current market stats into AI synthesis.
- **Quick Prompts**: Supports natural language inquiries directly from the command bar (e.g., `Give me a brief analysis of NVDA`).

<!-- TODO: screenshot of ASK module with search grounding -->

---

### 2. News Hub (`NEWS`)

The News Hub provides a consolidated, real-time stream of financial and market news from multiple independent wire services and news organizations.

- **Multi-Source Aggregation**: Synthesizes headlines from Yahoo Finance (ticker-specific coverage), The New York Times Business Top Stories, NewsAPI, and NewsData.io.
- **Broad-Market vs. Ticker-Filtered Modes**:
  - Entering `NEWS` displays the unfiltered broad-market business feed across macro, industry, and world finance.
  - Entering `NEWS <TICKER>` (e.g., `NEWS META`) filters the feed using the Balanced relevance algorithm to display stories specifically relevant to that company.
  - Clicking **SHOW ALL** returns the workspace to the broad-market news stream while preserving the global active ticker context.
- **Live News Ticker Tape**: A continuous, auto-scrolling news ticker at the bottom of the screen displays real-time headlines with source indicators and hover-to-pause capability.

<!-- TODO: screenshot of News Hub with ticker filter -->

---

### 3. Graph Price (`GP`)

Graph Price is the primary technical analysis and chart workspace in QUORIX. It includes interactive charting, technical indicators, company logo header display, and SEC insider ownership disclosures.

- **Company Logo Header**: Real-time equity logo rendered alongside ticker symbol, corporate name, and exchange.

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

<!-- TODO: screenshot of Graph Price with studies and insider transactions -->

---

### 4. Correlation Analyzer (`CORR`)

The Correlation Analyzer evaluates statistical price movement relationships between securities to identify shared market behavior, redundant risk, and diversification opportunities.

- **Cross-Asset Correlation Matrix**: Compares daily returns across a custom basket of equities, indices, and assets.
- **Directional Relationships**: Distinguishes between strongly positive correlations (co-moving assets), neutral correlations, and negative correlations (hedging assets).
- **Overlapping Exposure Detection**: Identifies assets that appear diversified on the surface but share high correlation coefficients.
- **Historical Basis**: Computes rolling correlation coefficients based on historical price series. Historical correlation does not guarantee identical relationships during future volatility regimes.

<!-- TODO: screenshot of Correlation Analyzer matrix -->

---

### 5. Portfolio Risk Monitor (`PRM`)

The Portfolio Risk Monitor provides institutional-grade portfolio risk decomposition, exposure diagnostics, and downside scenario analysis.

- **Portfolio Concentration**: Pinpoints individual positions representing disproportionate percentages of net portfolio value.
- **Sector & Industry Exposure**: Evaluates allocation across GICS sectors and industries to reveal inadvertent concentration.
- **Position Sizing & Weights**: Inspects individual portfolio weights against diversification guidelines.
- **Volatility & Diversification Scoring**: Evaluates portfolio-level volatility, weighted beta, and effective diversification benefits.
- **Downside Risk & Stress Testing**: Analyzes potential portfolio drawdowns across historical market shock scenarios.
- **Input Methods**: Supports interactive manual position entry, CSV portfolio file upload, and saved portfolio configurations.

<!-- TODO: screenshot of Portfolio Risk Monitor dashboard -->

---

### 6. Historical Pricing (`HP`)

Historical Pricing provides an expansive, tabular view of historical market pricing, volume history, and corporate reporting milestones.

- **Company Logo Header**: Displays corporate logo alongside the ticker historical price log title.
- **Tabular OHLCV Log**: Browse open, high, low, close, volume, and percentage change records by session or intraday bar.
- **Earnings Highlights**: Integrates historical earnings report dates and announcement timing directly into the price history log.
- **Data Export & Analysis**: Allows traders to inspect historical volatility, gap behavior, and price levels across multi-year lookback windows.

<!-- TODO: screenshot of Historical Pricing with logo and earnings indicators -->

---

### 7. Security Analytics (`DES`)

Security Analytics (`DES`) acts as the company descriptive bio and fundamentals dashboard for the selected equity.

- **Fixed Header & Company Logo**: Features a fixed top title bar, corporate logo display (`[LOGO] COMPANY NAME (TICKER)`), and scrollable body.
- **Corporate Profile**: Displays sector, industry, corporate headquarters, executive leadership, and business description.
- **Structured Typography & Metric Grid**: Formatted using structured label/value responsive grids and clean typography rather than raw monospace text.
- **Live Quote Matrix**: A four-card quote strip (`Last Price`, `Day Range`, `Previous Close`, `Trading Volume`) positioned directly above the Market & Valuation Metrics section.
- **Valuation & Fundamentals**: Summarizes key metrics including market capitalization, P/E ratio, enterprise value, beta, 52-week ranges, dividend yield, revenue, margins, and free cash flow.
- **Executive Roster & Headlines**: Structured executive personnel breakdown and recent news headline feed.

<!-- TODO: screenshot of DES screen with company logo, quote strip, and structured layout -->

---

### 8. Analyst Recs (`ANR`)

The Analyst Recommendations screen aggregates sell-side equity research ratings and price target consensus.

- **Company Logo Header**: Features corporate logo display with company title.
- **Consensus Rating Summary**: Calculates the aggregate street rating (Strong Buy, Moderate Buy, Hold, Moderate Sell, Strong Sell) with color-coded rating badges.
- **Structured Rating Breakdown Table**: Renders an interactive, tabular consensus breakdown across historical reporting periods (`0m`, `-1m`, `-2m`, `-3m`) with tabular numbers and sentiment highlights.
- **Price Target Distribution**: Displays the mean, median, high, and low 12-month analyst price targets alongside implied upside/downside percentages.
- **Key Fundamental Drivers**: Structured label/value list of revenue growth, earnings growth, margins, and forward valuation multiples.

<!-- TODO: screenshot of ANR consensus table and target distribution -->

---

### 9. Institutional Activity Monitor (`INST`)

The Institutional Activity Monitor provides visibility into institutional ownership patterns, quarterly SEC Form 13F filings, and institutional accumulation trends powered by the **3spread** API.

- **Issuer Summary Header with Company Logo**: Features a prominent 48×48 company logo alongside the issuer name, ticker, and CUSIP summary.
- **Institutional Holdings Search**: Search institutional positions by ticker symbol, CUSIP, or issuer name.
- **Position Changes**: Review quarter-over-quarter institutional movements:
  - New positions established.
  - Increased positions (additions).
  - Decreased positions (trims).
  - Exited positions (full liquidations).
  - Unchanged holdings.
- **Multi-Period Accumulation Screener**: Identify securities experiencing sustained institutional accumulation across consecutive reporting cycles.
- **Investor Profiles**: Inspect institutional investment managers, total 13F portfolio values, top holdings, and concentration metrics.
- **Sector Rotation Analysis**: Evaluate institutional cohort capital rotation across all 11 GICS sectors.
- **Congressional Trading Monitor (`CONGRESS` Tab)**: Feed of U.S. House of Representatives STOCK Act Periodic Transaction Reports (PTRs).
  - **Parsed Digital Filings**: Full transaction extraction including ticker symbol, raw asset description, transaction type (Buy, Sell, Exchange), execution date (`TX DATE`), notification date (`NOTIFIED`), filing date (`FILED`), reporting gap days (`GAP`), amount range, and owner type.
  - **Single Header Refresh & Unified Timestamp**: Controlled exclusively by the main INST header `REFRESH` button and header timestamp (showing updated time with amber `STALE` indicator when > 24 hours old).
  - **Date Anomaly Indicators**: Dates as filed that occur in the future or after disclosure dates feature a focused amber warning icon with an accessible tooltip detailing the exact filed date and reason.
  - **Derivative Identification**: Call and put options are highlighted with dedicated purple `OPTION` badges.
  - **Scanned Filing Links**: Direct links to official House Clerk PDF records for paper filings without embedded text streams.
  - **Legislator Enrichment**: Enriched with party affiliation and district details via `unitedstates/congress-legislators` (CC0 Public Domain).
  - **Asset Grouping & Filtering**: Filter between Equities & ETFs and Fixed Income & Other, or filter by specific ticker, party, owner, and date ranges.
  - **Compliance & Legal Notice**: Sourced under Title I of the Ethics in Government Act (5 U.S.C. app. § 105). Disclosures arrive up to 45 days after trade execution (members must report within 30 days of notification and no later than 45 days after the trade). Amounts are statutory ranges, not exact figures. Disclosed transactions are public records and imply no wrongdoing. Not investment advice. Disclosures do not require a 3spread API key. Sourced exclusively from the U.S. House of Representatives; U.S. Senate disclosures are excluded.
- **Disclosure Timing**: Institutional holdings reflect quarterly SEC Form 13F filings. Institutional investment managers have up to 45 days after the end of each calendar quarter to file Form 13F with the SEC. Data reflects filed holdings, not real-time trading activity.

<!-- TODO: screenshot of INST with 48px logo and holdings table -->

---

### 10. Currencies FX (`CRNC`)

The Currencies screen provides foreign exchange market intelligence, cross-rates, and central bank FX series powered by Federal Reserve Economic Data (FRED).

- **Major Crosses**: Tracks currency pairs including `EUR/USD`, `USD/JPY`, `GBP/USD`, `USD/CHF`, `USD/CAD`, `AUD/USD`, and `USD/CNY`.
- **H.10 Daily Rates**: Connects directly to the Federal Reserve Board's H.10 release for official foreign exchange rates.
- **Historical FX Trajectories**: Chart and inspect multi-year currency strength trends and volatility.

<!-- TODO: screenshot of Currencies FX dashboard -->

---

### 11. Economic Indicator (`ECO`)

The Economic Indicator workspace delivers macro surveillance by connecting to the Federal Reserve Bank of St. Louis FRED database.

- **Core Macro Dashboard**: Track critical economic indicators:
  - **Inflation**: Consumer Price Index (CPI), Core CPI, Personal Consumption Expenditures (PCE).
  - **Labor**: Nonfarm Payrolls (NFP), Unemployment Rate, Initial Jobless Claims, JOLTS.
  - **Growth & Output**: Real GDP, Industrial Production, Retail Sales, Durable Goods.
  - **Monetary & Rates**: Effective Federal Funds Rate, Treasury Yields (2Y, 10Y, 30Y), 10Y–2Y Yield Curve Spread, SOFR.
- **FRED Release Calendar**: Interactive calendar tracking upcoming economic releases and FOMC policy announcements.

<!-- TODO: screenshot of ECO macro calendar and indicator grid -->

---

### 12. Polymarket Screener (`POLY`)

The Polymarket Screener surfaces live predictive market odds, trading volume, liquidity, and probability spreads powered by the decentralized Polymarket Gamma API.

- **Real-Time Probabilities**: Monitor market-implied odds on political events, economic outcomes, interest rate decisions, and tech milestones.
- **Volume & Liquidity**: Screen active markets by 24-hour volume, total market liquidity, and open interest.
- **Search & Ticker Linking**: Filter prediction events by ticker symbol or keyword to discover markets relevant to active securities.

<!-- TODO: screenshot of Polymarket screener -->

---

### 13. System Settings (`SETT`)

System Settings provides security-focused management of API integrations, connection diagnostics, and session credentials.

- **Credential Status Monitoring**: Inspect which API integrations are active, whether credentials originate from the server environment (`.env`) or session runtime memory, and check masked status indicators.
- **Runtime Key Configuration**: Add or update API credentials in server process memory without modifying files on disk. Runtime keys are never written to disk or browser storage and expire when the server process stops.
- **Environment Precedence**: Credentials defined in `.env` are protected by the backend and cannot be overwritten by runtime inputs.

<!-- TODO: screenshot of System Settings credential manager -->

---

### 14. User Manual (`HELP`)

The User Manual provides terminal syntax rules, keyboard navigation reference, screen alias dictionaries, and CLI command formatting guidelines.
