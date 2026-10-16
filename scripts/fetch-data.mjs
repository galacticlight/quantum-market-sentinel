// Fetches free, keyless market data and writes public/data/snapshot.json.
// On any per-source failure, the last good series for that asset is reused.
import fs from 'node:fs/promises';
import { computeAll } from './metrics.mjs';
import { scoreHeadline } from './sentiment.mjs';

const OUT = new URL('../public/data/snapshot.json', import.meta.url);
const CACHE = new URL('../.cache/series.json', import.meta.url);
const cfg = JSON.parse(await fs.readFile(new URL('../watchlist.json', import.meta.url), 'utf8'));
let prev = null;
try { prev = JSON.parse(await fs.readFile(CACHE, 'utf8')); } catch {}
const UA = 'Mozilla/5.0 (compatible; QuantumMarketSentinel/1.0; +https://github.com/galacticlight/quantum-market-sentinel)';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function get(url, tries = 3) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(20000) });
      if (r.ok) return r;
      if (r.status === 429) await sleep(5000 * (i + 1));
    } catch {}
    await sleep(1500 * (i + 1));
  }
  throw new Error('fetch failed: ' + url);
}
const day = (ms) => new Date(ms).toISOString().slice(0, 10);

async function yahoo(sym) {
  const r = await get(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?range=1y&interval=1d`);
  const j = await r.json(); const res = j.chart.result[0];
  const ts = res.timestamp, c = res.indicators.quote[0].close;
  return ts.map((t, i) => [day(t * 1000), c[i]]).filter((p) => p[1] != null);
}
async function coingecko(id) {
  const r = await get(`https://api.coingecko.com/api/v3/coins/${id}/market_chart?vs_currency=usd&days=365&interval=daily`);
  const j = await r.json(); const m = new Map();
  for (const [t, p] of j.prices) m.set(day(t), p);
  return [...m.entries()];
}
async function fred(id) {
  const r = await get(`https://fred.stlouisfed.org/graph/fredgraph.csv?id=${id}`);
  const rows = (await r.text()).trim().split('\n').slice(1).map((l) => l.split(','));
  const cutoff = day(Date.now() - 400 * 864e5);
  return rows.filter(([d, v]) => d >= cutoff && v && v !== '.').map(([d, v]) => [d, +v]);
}
const SRC = { yahoo, coingecko, fred };

const series = {}; const status = [];
for (const a of cfg.assets) {
  try {
    const s = await SRC[a.source](a.symbol);
    if (s.length < 30) throw new Error('too few points');
    series[a.id] = s; status.push({ id: a.id, ok: true });
  } catch (e) {
    const old = prev?.series?.[a.id];
    if (old) series[a.id] = old;
    status.push({ id: a.id, ok: false, stale: !!old, error: String(e.message || e) });
  }
  if (a.source === 'coingecko') await sleep(2500);
}

function parseRss(xml, source) {
  const items = [];
  for (const m of xml.matchAll(/<item[\s\S]*?<\/item>/g)) {
    const it = m[0];
    const tag = (t) => (it.match(new RegExp(`<${t}[^>]*>([\\s\\S]*?)</${t}>`)) || [])[1] || '';
    const clean = (s) => s.replace(/<!\[CDATA\[|\]\]>/g, '').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim();
    const title = clean(tag('title')); const link = clean(tag('link'));
    if (!title || !/^https:\/\//.test(link)) continue;
    const date = new Date(clean(tag('pubDate')) || Date.now());
    items.push({ title, link, source, date: isNaN(date) ? null : date.toISOString() });
  }
  return items;
}
let news = [];
for (const f of cfg.feeds) {
  try { news.push(...parseRss(await (await get(f.url)).text(), f.name)); status.push({ id: 'feed:' + f.name, ok: true }); }
  catch (e) { status.push({ id: 'feed:' + f.name, ok: false, error: String(e.message || e) }); }
}
if (!news.length && prev?.news) news = prev.news;
const tickers = cfg.assets.filter((a) => a.class === 'equity' || a.class === 'crypto');
news = [...new Map(news.map((n) => [n.title, n])).values()]
  .sort((a, b) => (b.date || '').localeCompare(a.date || '')).slice(0, 60)
  .map((n) => ({ ...n, ...scoreHeadline(n.title), tags: tickers.filter((a) => new RegExp(`\\b(${a.id}|${a.name})\\b`, 'i').test(n.title)).map((a) => a.id) }));

if (!Object.keys(series).length) { console.error('No data at all; keeping previous snapshot.'); process.exit(prev ? 0 : 1); }
await fs.mkdir(new URL('../.cache/', import.meta.url), { recursive: true });
await fs.writeFile(CACHE, JSON.stringify({ series, news }));
const snapshot = { generatedAt: new Date().toISOString(), status, assets: cfg.assets.filter((a) => series[a.id]).map(({ id, name, class: cls, source, symbol }) => ({ id, name, class: cls, source, symbol })), news, ...computeAll(cfg.assets.filter((a) => series[a.id]), series, news) };
await fs.mkdir(new URL('../public/data/', import.meta.url), { recursive: true });
await fs.writeFile(OUT, JSON.stringify(snapshot));
console.log(`ok: ${status.filter((s) => s.ok).length}/${status.length} sources, ${news.length} headlines, sentinel=${snapshot.sentinel.score}`);
