# API Key Registration Guide

This guide details how to obtain API credentials from official provider portals for all integrations supported by the QUORIX terminal.

---

## Supported Providers & Registration Details

### 1. Google Gemini (`GEMINI_API_KEY`)
- **Portal**: [Google AI Studio](https://aistudio.google.com/apikey)
- **Account Steps**: Sign in with your Google account.
- **Key Generation**: Click **Create API key**, select or create a Google Cloud project, and copy the generated key.
- **QUORIX Features**: Powers Ask QUORIX (`ASK`), terminal analysis prompts, and AI synthesis in Security Analytics (`DES`) and Analyst Recs (`ANR`).
- **Status**: Recommended. Without this key, AI features display a prompt instructing you to configure `GEMINI_API_KEY`, while standard fundamental and analyst data fall back to live market feeds.

### 2. Federal Reserve Economic Data (`FRED_API_KEY`)
- **Portal**: [St. Louis Fed FRED Account API Keys](https://fredaccount.stlouisfed.org/apikeys) (documentation at [FRED API Docs](https://fred.stlouisfed.org/docs/api/api_key.html))
- **Account Steps**: Create a free user account on the St. Louis Fed website.
- **Key Generation**: Navigate to **My Account** > **API Keys**, request a key, and provide a brief description of your application.
- **QUORIX Features**: Powers the Economic Indicator (`ECO`) dashboard, upcoming FOMC/macro release calendar, and foreign exchange rates in Currencies (`CRNC`).
- **Status**: Recommended. Without this key, economic and currency feeds prompt for key configuration.

### 3. 3spread (`3SPREAD_API_KEY` or `THREESPREAD_API_KEY`)
- **Portal**: [3spread Sign Up](https://www.3spread.com/auth/signup) (homepage at [3spread.com](https://3spread.com/))
- **Account Steps**: Register for a 3spread account.
- **Key Generation**: Access the 3spread dashboard to retrieve your Community tier or developer API key.
- **QUORIX Features**: Powers the Institutional Activity Monitor (`INST`), including Form 13F institutional holdings search, position changes, multi-period accumulation screening, and institutional manager profiles.
- **Status**: Required for `INST`. Both `3SPREAD_API_KEY` and the compatibility alias `THREESPREAD_API_KEY` are supported.
- **Distinction**: 3spread provides quarterly SEC Form 13F institutional data. It is completely separate from the SEC Form 3/4/5 insider ownership reports displayed in Graph Price (`GP`), which require no API key.

### 4. New York Times Developer Network (`NYT_API_KEY`)
- **Portal**: [NYT Developer Network](https://developer.nytimes.com/)
- **Account Steps**: Create a developer account on the NYT Developer Portal.
- **Key Generation**: Navigate to **My Apps** > **New App**, name your application, and enable the **Top Stories API**. Copy the generated API key.
- **QUORIX Features**: Enriches the News Hub (`NEWS`) and the bottom scrolling news ticker with curated New York Times Business Top Stories.
- **Status**: Optional. If omitted, News Hub continues to aggregate headlines from other active news sources.

### 5. NewsAPI (`NEWS_API_KEY`)
- **Portal**: [NewsAPI Registration](https://newsapi.org/register)
- **Account Steps**: Register for a developer account at NewsAPI.org.
- **Key Generation**: The API key is provided on your account dashboard immediately after registration.
- **QUORIX Features**: Supplies global corporate and business headlines to News Hub (`NEWS`) and the bottom news ticker crawl.
- **Status**: Optional.

### 6. NewsData.io (`NEWSDATA_API_KEY`)
- **Portal**: [NewsData.io Registration](https://newsdata.io/register)
- **Account Steps**: Sign up for an account at Newsdata.io.
- **Key Generation**: Obtain your API key from the API dashboard.
- **QUORIX Features**: Ingests real-time financial and market news for News Hub (`NEWS`) and the bottom news ticker.
- **Status**: Optional.

### 7. Alpha Vantage (`ALPHA_VANTAGE_API_KEY`)
- **Portal**: [Alpha Vantage API Key Claim](https://www.alphavantage.co/support/#api-key)
- **Account Steps**: Enter your email address and organization type on the claim form.
- **Key Generation**: A free API key is generated instantly on the page.
- **QUORIX Features**: Serves as a fallback data provider for equity quotes and historical intraday pricing in Graph Price (`GP`).
- **Status**: Optional. Primary market quotes, charts, and volume data are served via Yahoo Finance without requiring an API key.

---

## Uncredentialed Data Out-of-the-Box

The following core terminal features require **no user API credentials**:
- **Yahoo Finance**: Real-time equity quotes, multi-timeframe OHLCV historical bars, technical indicator feeds, and company search news.
- **Polymarket Gamma API**: Live prediction market probability spreads, volume, and liquidity.
- **SEC EDGAR**: Corporate insider ownership filings (Forms 3, 4, and 5) displayed in Graph Price (`GP`).
- **Company Logos**: Multi-tier logo delivery via Parqet SVG CDN, Financial Modeling Prep (FMP) PNG CDN, and local retro monogram fallback.
