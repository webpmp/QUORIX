# Privacy Policy

## Self-Hosted Application
QUORIX is designed to run locally as a self-hosted application. When you install and launch QUORIX on your computer or local network, your user interface and the local Node.js backend proxy execute in your own environment. 

While the application does not transmit your data to any centralized QUORIX server, it does communicate directly with external third-party service providers across the internet to fetch market data, news feeds, economic indicators, prediction market statistics, and AI research answers.

## API Credentials
You can provide API keys for third-party services either through environment variables (in a local `.env` file) or at runtime via the System Settings interface.

- **Environment variables:** Stored as plain text in your local environment and read by the local server process upon startup.
- **Runtime settings:** Keys entered into the System Settings screen are sent to the local Node.js server process and held in memory during the running session. They are not persisted to a database or written to disk.
- **Security:** API credentials are not encrypted by QUORIX. They reside in plain text within your local environment or server process memory.
- **Transmission:** When QUORIX requests data on your behalf, the appropriate API key is transmitted over HTTPS to that specific third-party provider's servers.

## Third-Party Providers and Data Transmission
QUORIX connects directly to external services to deliver features. When you use these features, relevant request parameters are transmitted to the respective service providers:

- **Google Gemini:** If you use Ask QUORIX (`ASK`), your search prompts and relevant market context are sent to Google to generate AI responses and perform search grounding.
- **Market & Financial Data (Yahoo Finance, Alpha Vantage):** Ticker symbols and query parameters are sent to fetch stock prices, historical bars, and financial metrics. Alpha Vantage requests include your Alpha Vantage API key if configured.
- **Economic & FX Data (FRED):** Economic series identifiers and your FRED API key are transmitted to the Federal Reserve Bank of St. Louis.
- **Institutional Holdings (3spread):** Ticker symbols, CUSIP identifiers, and your 3spread API key are sent to 3spread to retrieve Form 13F and insider activity data.
- **News Providers (New York Times, NewsAPI, Newsdata.io, Yahoo Finance RSS):** Search terms, category filters, and respective API keys are sent to these providers to retrieve headlines and articles.
- **Prediction Markets (Polymarket):** Market queries and category filters are transmitted to Polymarket's public Gamma API.

QUORIX does not control how third-party providers handle, log, or retain data sent to their endpoints. Please review the respective privacy policies and terms of each external provider for details on their data handling practices.

## Local Storage, Cookies, and Tracking
- **Local Storage:** QUORIX uses browser `localStorage` solely to save your local UI preferences on your device. This includes your tracked equities watchlist, portfolio holdings entered in the Portfolio Risk Monitor, chart study settings, recent search history, font sizes, and layout pane dimensions.
- **Cookies & Sessions:** QUORIX does not set user-tracking cookies or maintain user accounts. The local proxy server temporarily caches session cookies required by Yahoo Finance in server memory to authenticate public quote requests.
- **Analytics & Telemetry:** QUORIX does not contain analytics packages, tracking pixels, telemetry probes, or third-party advertising trackers.

## Changes
This Privacy Policy may be updated as QUORIX continues to evolve as an open-source prototype.
