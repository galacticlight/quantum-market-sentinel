# Quantum Market Sentinel

A futuristic, open market-intelligence dashboard with volatility regimes, a correlation network, entropy, Hurst exponents, momentum, anomaly alerts, lexicon news sentiment, and a composite **Sentinel risk score**. It covers equities, indices, crypto, FX and macro.

**Live:** https://galacticlight.github.io/quantum-market-sentinel/

> **Not financial advice.** For informational and educational purposes only. Not financial, investment, or tax advice. Data may be delayed or inaccurate. Signals describe past data and do not predict returns. Do your own research.

Built by Galacticlight with Grok Bots (Researcher, Distinguished Engineer, QA, coordinator).

## Architecture

```
watchlist.json ──► scripts/fetch-data.mjs ──► public/data/snapshot.json ──► Vite + TypeScript site ──► GitHub Pages
                     ├ scripts/metrics.mjs   (vol regime, entropy, Hurst, momentum, z / robust z,
                     │                        60d correlations, Mantegna MST, PCA absorption ratio, sentinel score)
                     └ scripts/sentiment.mjs (lexicon headline scoring with negation)
```

- **Scheduled refresh:** `.github/workflows/deploy.yml` runs every 3 hours on weekdays, once a day on weekends, on every push to `main`, and on manual dispatch. It fetches data, computes metrics, builds, and deploys to Pages. Nothing is committed back to the repo.
- **Graceful failure:** raw series are kept in `.cache/` and carried between runs with `actions/cache`. If a source fails, the last good series for that asset is reused and flagged in `snapshot.status`, and the page header shows how many sources are stale.
- **Published data is derived:** the snapshot contains computed metrics, a 90-point sparkline, and headline + link only. It does not contain full raw price histories or article text.
- **No secrets.** Every source is keyless. If you ever add a keyed source, read it from an optional env var (for example `COINGECKO_DEMO_KEY`) set as a GitHub Actions secret, and never ship it to the browser.
- **Security:** the workflow defaults to `contents: read`, and only the deploy job gets `pages: write` and `id-token: write`. All actions are pinned to commit SHAs, checkout does not persist credentials, and `npm audit` is clean.
- **Front end:** vanilla TypeScript, d3 (force graph, gauge, scatter), Canvas 2D (starfield and the Quantum Sentiment Constellation), and KaTeX for formulas. Motion respects `prefers-reduced-motion` and has a Pause button. Sortable table headers are keyboard buttons, network nodes are focusable, and colors meet WCAG AA contrast on the dark theme.

## Panels

| Panel | What it shows |
|---|---|
| Sentinel | 0–100 composite stress score (gauge), its five components, anomaly alerts |
| Watchlist | Last, 1D/1M change, 90-day sparkline, 20D realized vol, regime, momentum, Hurst, entropy, z |
| Quantum Sentiment Constellation | Six focus tickers orbit a news pulse. Hue and radius follow blended live news + momentum, links follow \|ρ\|, size follows market cap. Adapted from the project's first `index.html` prototype. |
| Correlation network | d3 force graph, spring length d = √(2(1−ρ)), with MST edges plus strong \|ρ\| ≥ 0.6 edges |
| Regime map | Hurst × entropy scatter colored by volatility regime |
| News pulse | Latest headlines with lexicon sentiment and ticker tags |
| Research dossier | Researcher bot's sourced point-in-time snapshot for TSLA, NVDA, SEV, PLTR, AMZN, SPCX (`src/dossier.json`) |
| Methods | Every formula rendered with KaTeX |

## Data sources and terms

| Data | Source | Key | Terms / notes |
|---|---|---|---|
| Equities, indices, FX, gold | Yahoo Finance chart endpoint `query1.finance.yahoo.com/v8/finance/chart` | none | Unofficial, undocumented endpoint. Yahoo's terms restrict use to personal, non-commercial purposes. Data is delayed. Polite request volume, about 20 calls per run. **Replace this source before any commercial use.** |
| Crypto | CoinGecko public API `/coins/{id}/market_chart` | none | [API Terms](https://www.coingecko.com/en/api_terms): "Powered by CoinGecko" attribution is required (shown in the footer), cached data must be refreshed at least every 24h (the schedule does this), and access must not be resold or redistributed. An optional Demo key is a future improvement. |
| Macro (DGS10, T10Y2Y, DFF) | FRED® `fredgraph.csv` download | none | FRED terms of use apply, with citation "Federal Reserve Bank of St. Louis". Only public-domain US government series are used. ICE BofA series were deliberately left out because they are third-party copyrighted. |
| Live crypto ticks | Coinbase Exchange public market-data WebSocket | none | Public market data; display only. |
| On-demand headlines | GDELT DOC 2.0 API | none | Free; cite GDELT. Max 1 request per 5 s. |
| Headlines | MarketWatch, WSJ Markets, CNBC Markets, Federal Reserve RSS | none | Only the headline, source, link and date are stored, with no article text. Links go to the publisher. |
| Research dossier | Researcher bot snapshot (2026-10-15) | n/a | Each figure carries its original source URL. Stooq was evaluated and dropped because it now serves a bot challenge. |

**Data use:** the site shows a visible notice that third-party data is for personal, non-commercial, informational use only and must not be redistributed.

**Under consideration:** a more permissively licensed equities/FX source to replace the Yahoo endpoint. Candidates are ECB reference rates via Frankfurter for FX, SEC EDGAR for fundamentals, or a keyed free tier such as Alpha Vantage through an optional `ALPHAVANTAGE_KEY` secret. Each provider's own terms will be checked before switching.

Code is MIT licensed. Third-party data remains the property of its providers.

## Edit the watchlist

Edit `watchlist.json`:

```json
{ "id": "AAPL", "name": "Apple", "class": "equity", "source": "yahoo", "symbol": "AAPL" }
```

- `class`: `equity | index | crypto | fx | macro`. Macro series are treated as rates, so they use differences instead of log returns.
- `source`: `yahoo` (Yahoo chart symbol, e.g. `^GSPC`, `EURUSD=X`), `coingecko` (coin id, e.g. `bitcoin`), or `fred` (series id, e.g. `DGS10`).
- `feeds`: add or remove RSS feeds (`name`, `url`).

Push to `main` and the workflow rebuilds. The constellation's focus tickers are `FOCUS` in `src/main.ts`, and the dossier lives in `src/dossier.json`.

## Local development

Requires **Node.js ≥ 20.19** (declared in `package.json` `engines`; Vite 8 needs 20.19+ or 22.12+). CI uses Node 22.

```bash
npm ci
npm run fetch   # writes public/data/snapshot.json (and .cache/series.json)
npm run dev     # http://localhost:5173/quantum-market-sentinel/
npm run build
```

## Live prices and news refresh (in the browser)

| Assets | Live source | How |
|---|---|---|
| BTC, ETH, SOL | [Coinbase Exchange public WebSocket](https://docs.cdp.coinbase.com/exchange/websocket-feed/overview) `wss://ws-feed.exchange.coinbase.com`, `ticker` channel | Keyless. The UI updates at most once per second, with a green/red flash on each change. |
| Crypto fallback | CoinGecko `/simple/price` (CORS `*`) | Polled once a minute only while the WebSocket is down. |
| Stocks, SPY/QQQ, EUR/USD, USD/JPY | Optional: [Finnhub](https://finnhub.io) WebSocket with **the visitor's own free key** | Pasted into the "Live stock and FX prices" panel, stored only in that browser's `localStorage`, and sent only to Finnhub. No key is committed or deployed. |
| Indices (^GSPC, ^NDX, ^VIX), DXY, gold, FRED macro | none | These show the scheduled snapshot prices. |

- The header shows **LIVE · last tick hh:mm:ss**, or "Snapshot" or "Paused (tab hidden)". All feeds disconnect while the tab is hidden and reconnect, with backoff, when it's visible again.
- **Why stocks aren't live by default:** Yahoo has no CORS, and every real-time stock feed found (Finnhub, Alpaca, Polygon, Twelve Data) needs a secret key. A static Pages site can't hold a secret. A shared live stock feed would need a small proxy, for example a free Cloudflare Worker holding a Finnhub key as a Worker secret. Its URL would go in `connect-src`, and the Worker would need its own account.
- **Refresh news button:** fetches in parallel (1) the latest deployed `snapshot.json` with cache-busting, which picks up any newer scheduled or manual run, and (2) [GDELT DOC 2.0](https://blog.gdeltproject.org/gdelt-doc-2-0-api-debuts/) (keyless, CORS `*`) for focus-ticker and market headlines from the last 6 hours. New headlines are de-duplicated, scored in the browser with the same lexicon (`scripts/sentiment.mjs`), tagged, and marked "new". The button has a 60 s cooldown (GDELT asks for at most 1 request every 5 s) and shows loading, success and error states plus "updated X ago".
- **Owner refresh:** in GitHub, go to **Actions → Refresh data and deploy → Run workflow** (`workflow_dispatch`). This re-runs the full fetch and redeploys. Nothing in the browser can trigger it, because that would need a token.

## Freshness, security and accessibility

- **Stale-data warning:** the header turns amber if any source fell back to last good data, or if the snapshot is older than 24 h on market days (72 h across weekends and Mondays).
- **CSP** (meta tag): `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self' https://api.coingecko.com wss://ws-feed.exchange.coinbase.com https://api.gdeltproject.org wss://ws.finnhub.io; object-src 'none'; base-uri 'self'; form-action 'none'`. KaTeX and d3 run under it with no violations. Inline styles are needed for d3 and KaTeX layout.
- **Performance:** space is reserved with skeletons to avoid layout shift. Below-the-fold panels (constellation, network, regimes, news, dossier, KaTeX) render lazily when scrolled near, KaTeX is code-split, and the starfield starts when the browser is idle.
- A custom `404.html` is included.

## Known limitations

- The lexicon sentiment is deliberately simple. It misses sarcasm and context, and ticker tagging matches symbols and names only.
- Volatility regimes use a realized-vol percentile, not GARCH or an HMM. Hurst R/S on about 250 points is noisy.
- The Yahoo endpoint is unofficial and may break or be withdrawn at any time.
