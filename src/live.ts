// Live prices in the browser + news refresh. No secrets ship in this file.
// Crypto: Coinbase Exchange public WebSocket (keyless), CoinGecko /simple/price REST fallback.
// Stocks/FX: optional "bring your own" Finnhub key stored only in this browser's localStorage.
import type { Snap, News } from './main';
import { scoreHeadline } from '../scripts/sentiment.mjs';

const $ = (s: string) => document.querySelector(s) as HTMLElement | null;
const CB: Record<string, string> = { BTC: 'BTC-USD', ETH: 'ETH-USD', SOL: 'SOL-USD' };
const FH_FX: Record<string, string> = { EURUSD: 'OANDA:EUR_USD', USDJPY: 'OANDA:USD_JPY' };
const FH_KEY = 'qms.finnhubKey';
let lastTick = 0, mode: 'off' | 'crypto' | 'crypto+stocks' | 'poll' = 'off';
const ago = (t: number) => { const s = Math.round((Date.now() - t) / 1000); return s < 5 ? 'just now' : s < 60 ? `${s}s ago` : s < 3600 ? `${Math.round(s / 60)} min ago` : `${Math.round(s / 3600)} h ago`; };

function indicator() {
  const el = $('#live'), tx = $('#live-text'); if (!el || !tx) return;
  const on = mode !== 'off' && Date.now() - lastTick < 120000;
  el.className = 'live ' + (on ? 'on' : 'off');
  tx.textContent = on ? `LIVE · ${mode === 'poll' ? 'crypto (polling)' : mode} · last tick ${new Date(lastTick).toLocaleTimeString()}` : document.hidden ? 'Paused (tab hidden)' : mode === 'off' ? 'Snapshot (live feed offline)' : 'Connecting…';
}

export function setupLive(s: Snap) {
  const prevClose: Record<string, number> = {};
  for (const a of s.assets) { const sp = s.metrics[a.id].spark.filter((x) => x != null); prevClose[a.id] = a.class === 'crypto' ? sp.at(-2)! : sp.at(-1)!; }
  // equities: snapshot last is today's (or last) close; 1D change compares against the previous close
  for (const a of s.assets) if (a.class !== 'crypto') { const sp = s.metrics[a.id].spark.filter((x) => x != null); prevClose[a.id] = sp.at(-2)!; }
  const pending = new Map<string, number>();
  const apply = (id: string, price: number) => { if (!s.metrics[id] || !isFinite(price)) return; pending.set(id, price); lastTick = Date.now(); };
  // batch DOM writes to at most one per second (keeps TBT/CPU low)
  setInterval(() => {
    if (document.hidden) return;
    for (const [id, p] of pending) {
      const m = s.metrics[id], old = m.last; m.last = +p.toFixed(6); m.ch1d = prevClose[id] ? p / prevClose[id] - 1 : m.ch1d;
      const cell = document.querySelector(`[data-live-last="${id}"]`) as HTMLElement | null, ch = document.querySelector(`[data-live-ch="${id}"]`) as HTMLElement | null;
      if (cell && p !== old) {
        cell.textContent = p.toLocaleString(undefined, { maximumFractionDigits: p < 10 ? 4 : 2 });
        cell.classList.remove('flash-up', 'flash-down'); void cell.offsetWidth; cell.classList.add(p > old ? 'flash-up' : 'flash-down');
        cell.setAttribute('aria-label', `${id} ${cell.textContent}, ${p > old ? 'up' : 'down'} tick`);
      }
      if (ch && m.ch1d != null) { ch.textContent = `${m.ch1d >= 0 ? '+' : ''}${(m.ch1d * 100).toFixed(1)}%`; ch.className = `num ${m.ch1d >= 0 ? 'pos' : 'neg'}`; }
    }
    pending.clear(); indicator();
  }, 1000);

  /* ---- crypto: Coinbase WS, CoinGecko fallback ---- */
  const cryptoIds = s.assets.filter((a) => CB[a.id]).map((a) => a.id);
  let ws: WebSocket | null = null, wsFails = 0, pollTimer = 0;
  const geckoIds = s.assets.filter((a) => a.class === 'crypto' && a.source === 'coingecko');
  const poll = async () => {
    if (document.hidden || !geckoIds.length) return;
    try {
      const r = await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${geckoIds.map((a) => a.symbol).join(',')}&vs_currencies=usd`, { cache: 'no-store' });
      const j = await r.json(); for (const a of geckoIds) if (j[a.symbol]?.usd) apply(a.id, j[a.symbol].usd);
      if (mode === 'off') mode = 'poll';
    } catch { /* keep snapshot */ }
  };
  const startPoll = () => { if (!pollTimer) { poll(); pollTimer = window.setInterval(poll, 60000); } }; // 1 call/min: well under CoinGecko's public limit
  const stopPoll = () => { clearInterval(pollTimer); pollTimer = 0; };
  const connect = () => {
    if (!cryptoIds.length || document.hidden) return;
    try { ws = new WebSocket('wss://ws-feed.exchange.coinbase.com'); } catch { startPoll(); return; }
    ws.onopen = () => { wsFails = 0; stopPoll(); mode = fh ? 'crypto+stocks' : 'crypto'; ws!.send(JSON.stringify({ type: 'subscribe', product_ids: cryptoIds.map((i) => CB[i]), channels: ['ticker'] })); };
    ws.onmessage = (e) => { try { const m = JSON.parse(e.data); if (m.type === 'ticker') { const id = cryptoIds.find((i) => CB[i] === m.product_id); if (id) apply(id, +m.price); } } catch {} };
    ws.onclose = () => { ws = null; if (document.hidden) return; wsFails++; startPoll(); if (wsFails < 6) setTimeout(connect, Math.min(60000, 2000 * 2 ** wsFails)); };
    ws.onerror = () => ws?.close();
  };

  /* ---- optional: Finnhub WS for stocks/FX with the visitor's own free key ---- */
  let fh: WebSocket | null = null;
  const fhSyms = () => s.assets.filter((a) => a.class === 'equity' || FH_FX[a.id] || ['SPY', 'QQQ'].includes(a.id)).map((a) => [a.id, FH_FX[a.id] || a.symbol] as const);
  const connectFh = () => {
    const key = localStorage.getItem(FH_KEY); if (!key || document.hidden) return;
    fh = new WebSocket(`wss://ws.finnhub.io?token=${encodeURIComponent(key)}`);
    const map = new Map(fhSyms().map(([id, sym]) => [sym, id]));
    fh.onopen = () => { mode = 'crypto+stocks'; for (const sym of map.keys()) fh!.send(JSON.stringify({ type: 'subscribe', symbol: sym })); };
    fh.onmessage = (e) => { try { const m = JSON.parse(e.data); if (m.type === 'trade') for (const t of m.data) { const id = map.get(t.s); if (id) apply(id, t.p); } } catch {} };
    fh.onclose = () => { fh = null; };
  };
  const keyForm = $('#fh-form') as HTMLFormElement | null;
  if (keyForm) {
    const inp = keyForm.querySelector('input') as HTMLInputElement, st = $('#fh-status')!;
    st.textContent = localStorage.getItem(FH_KEY) ? 'A key is saved in this browser.' : 'No key saved: stocks and FX show snapshot prices.';
    keyForm.onsubmit = (e) => { e.preventDefault(); const v = inp.value.trim(); if (v) { localStorage.setItem(FH_KEY, v); inp.value = ''; st.textContent = 'Saved in this browser only. Connecting…'; fh?.close(); connectFh(); } };
    ($('#fh-clear') as HTMLButtonElement).onclick = () => { localStorage.removeItem(FH_KEY); fh?.close(); st.textContent = 'Key removed from this browser.'; };
  }

  const start = () => { connect(); connectFh(); };
  const stop = () => { ws?.close(); ws = null; fh?.close(); fh = null; stopPoll(); };
  document.addEventListener('visibilitychange', () => { if (document.hidden) stop(); else start(); indicator(); });
  start(); indicator();
}

/* ---------- news refresh ---------- */
const COOLDOWN = 60000; // also respects GDELT's 1 request / 5 s guidance
export function setupNewsRefresh(s: Snap, render: () => void) {
  const btn = $('#news-refresh') as HTMLButtonElement, st = $('#news-status')!;
  let last = Date.parse(s.generatedAt), busy = false, nextOk = 0;
  const label = () => { st.textContent = busy ? st.textContent : `Updated ${ago(last)}`; };
  setInterval(label, 15000); label();
  const tickers = s.assets.filter((a) => a.class === 'equity' || a.class === 'crypto');
  const tag = (t: string) => tickers.filter((a) => new RegExp(`\\b(${a.id}|${a.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})\\b`, 'i').test(t)).map((a) => a.id);
  const merge = (items: News[]) => {
    const seen = new Set(s.news.map((n) => n.title.toLowerCase())); let added = 0;
    for (const n of items) { const k = n.title.toLowerCase(); if (!seen.has(k)) { seen.add(k); (n as any).fresh = true; s.news.push(n); added++; } }
    s.news.sort((a, b) => (b.date || '').localeCompare(a.date || '')); s.news.splice(80);
    return added;
  };
  btn.onclick = async () => {
    if (busy) return;
    if (Date.now() < nextOk) { st.textContent = `Please wait ${Math.ceil((nextOk - Date.now()) / 1000)}s before refreshing again.`; return; }
    busy = true; nextOk = Date.now() + COOLDOWN; btn.disabled = true; btn.setAttribute('aria-busy', 'true'); st.textContent = 'Refreshing headlines…';
    s.news.forEach((n) => delete (n as any).fresh);
    const results = await Promise.allSettled([
      // 1) latest deployed snapshot (cache-busted): picks up a newer scheduled/manual run
      fetch(`${import.meta.env.BASE_URL}data/snapshot.json?t=${Date.now()}`, { cache: 'no-store' }).then((r) => r.json()).then((j: Snap) => j.news.map((n) => ({ ...n }))),
      // 2) GDELT DOC 2.0 (keyless, CORS *): headlines from the last 6 hours for the focus tickers + markets
      fetch('https://api.gdeltproject.org/api/v2/doc/doc?' + new URLSearchParams({ query: '(Tesla OR Nvidia OR Palantir OR Amazon OR SpaceX OR "Aptera" OR "stock market" OR "Wall Street" OR bitcoin) sourcelang:english', mode: 'artlist', format: 'json', maxrecords: '40', sort: 'datedesc', timespan: '6h' }), { cache: 'no-store' })
        .then((r) => { if (!r.ok) throw new Error('GDELT ' + r.status); return r.json(); })
        .then((j: any) => (j.articles || []).filter((a: any) => /^https:\/\//.test(a.url) && a.title).map((a: any): News => {
          const d = a.seendate?.replace(/^(\d{4})(\d\d)(\d\d)T(\d\d)(\d\d)(\d\d)Z$/, '$1-$2-$3T$4:$5:$6Z');
          return { title: a.title, link: a.url, source: `${a.domain} via GDELT`, date: d || null, ...scoreHeadline(a.title), tags: tag(a.title) };
        })),
    ]);
    let added = 0; const failed: string[] = [];
    results.forEach((r, i) => { if (r.status === 'fulfilled') added += merge(r.value); else failed.push(i ? 'GDELT' : 'snapshot'); });
    busy = false; btn.removeAttribute('aria-busy'); setTimeout(() => (btn.disabled = false), COOLDOWN);
    if (failed.length === 2) { st.textContent = 'Couldn’t reach news sources. Showing the last headlines. Try again in a minute.'; st.className = 'err'; return; }
    last = Date.now(); render();
    st.className = 'ok'; st.textContent = `${added ? `${added} new headline${added === 1 ? '' : 's'} added and scored` : 'No new headlines'}${failed.length ? ` (${failed[0]} unavailable)` : ''} · updated just now`;
  };
}
