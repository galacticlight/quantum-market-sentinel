const mean = (a) => a.reduce((s, x) => s + x, 0) / (a.length || 1);
const std = (a) => { const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / Math.max(1, a.length - 1)); };
const r4 = (x) => (x == null || !isFinite(x) ? null : +x.toFixed(4));
const isRate = (a) => a.class === 'macro';
// returns: log returns for prices, first differences for rates/spreads
function rets(vals, rate) { const r = []; for (let i = 1; i < vals.length; i++) r.push(rate ? vals[i] - vals[i - 1] : Math.log(vals[i] / vals[i - 1])); return r; }

export function entropy(r, bins = 12) {
  if (r.length < 10) return null;
  const lo = Math.min(...r), hi = Math.max(...r), w = (hi - lo) / bins || 1, c = new Array(bins).fill(0);
  r.forEach((x) => c[Math.min(bins - 1, Math.floor((x - lo) / w))]++);
  let H = 0; c.forEach((k) => { if (k) { const p = k / r.length; H -= p * Math.log2(p); } });
  return H / Math.log2(bins);
}
export function hurst(r) {
  // Rescaled-range (R/S) over window sizes; slope of log(R/S) vs log(n)
  const xs = [], ys = [];
  for (let n = 8; n <= Math.floor(r.length / 2); n = Math.floor(n * 1.5)) {
    const rs = [];
    for (let s = 0; s + n <= r.length; s += n) {
      const seg = r.slice(s, s + n), m = mean(seg); let cum = 0, mx = -Infinity, mn = Infinity;
      seg.forEach((x) => { cum += x - m; mx = Math.max(mx, cum); mn = Math.min(mn, cum); });
      const sd = std(seg); if (sd > 0) rs.push((mx - mn) / sd);
    }
    if (rs.length) { xs.push(Math.log(n)); ys.push(Math.log(mean(rs))); }
  }
  if (xs.length < 3) return null;
  const mx = mean(xs), my = mean(ys);
  return xs.reduce((s, x, i) => s + (x - mx) * (ys[i] - my), 0) / xs.reduce((s, x) => s + (x - mx) ** 2, 0);
}
function pearson(a, b) { const ma = mean(a), mb = mean(b); let n = 0, da = 0, db = 0; for (let i = 0; i < a.length; i++) { n += (a[i] - ma) * (b[i] - mb); da += (a[i] - ma) ** 2; db += (b[i] - mb) ** 2; } return da && db ? n / Math.sqrt(da * db) : 0; }

export function computeAll(assets, series, news) {
  const metrics = {};
  for (const a of assets) {
    const s = series[a.id], v = s.map((p) => p[1]), rate = isRate(a), r = rets(v, rate);
    const ann = Math.sqrt(a.class === 'crypto' ? 365 : 252);
    const vol20 = std(r.slice(-20)) * ann;
    const vols = []; for (let i = 20; i <= r.length; i++) vols.push(std(r.slice(i - 20, i)) * ann);
    const pct = vols.filter((x) => x <= vol20).length / vols.length;
    const regime = pct > 0.9 ? 'turbulent' : pct > 0.65 ? 'elevated' : pct < 0.25 ? 'calm' : 'normal';
    const last = v.at(-1), ch = (k) => (v.length > k ? (rate ? last - v.at(-1 - k) : last / v.at(-1 - k) - 1) : null);
    const w = r.slice(-61, -1), z = (r.at(-1) - mean(w)) / (std(w) || 1);
    const med = (x) => { const s = [...x].sort((p, q) => p - q), k = s.length >> 1; return s.length % 2 ? s[k] : (s[k - 1] + s[k]) / 2; };
    const md = med(w), mad = med(w.map((x) => Math.abs(x - md))), rz = (r.at(-1) - md) / (1.4826 * mad || 1);
    const mom = v.length > 64 ? (rate ? last - v.at(-64) : Math.log(last / v.at(-64))) / ((std(r.slice(-63)) || 1) * Math.sqrt(63)) : null;
    metrics[a.id] = { last: r4(last), asOf: s.at(-1)[0], ch1d: r4(ch(1)), ch5d: r4(ch(5)), ch21d: r4(ch(21)), vol20: rate ? null : r4(vol20), volPct: r4(pct), regime, entropy: r4(entropy(r.slice(-250))), hurst: r4(hurst(r.slice(-250))), momentum: r4(mom), z: r4(z), robustZ: r4(rz), anomaly: Math.abs(z) >= 2.5 || Math.abs(rz) >= 3, spark: v.slice(-90).map(r4) };
  }
  // Rolling 60-day correlation on dates common to each pair (crypto trades weekends; aligned on shared dates)
  const ids = assets.map((a) => a.id), maps = {}; for (const a of assets) maps[a.id] = new Map(series[a.id]);
  const edges = [], W = 60;
  for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) {
    const A = assets[i], B = assets[j], dates = series[A.id].map((p) => p[0]).filter((d) => maps[B.id].has(d)).slice(-(W + 1));
    if (dates.length < 30) continue;
    const ra = rets(dates.map((d) => maps[A.id].get(d)), isRate(A)), rb = rets(dates.map((d) => maps[B.id].get(d)), isRate(B));
    const rho = pearson(ra, rb); edges.push({ a: A.id, b: B.id, rho: r4(rho), d: r4(Math.sqrt(2 * (1 - rho))), n: ra.length });
  }
  // Mantegna minimum spanning tree on d_ij (Kruskal)
  const parent = Object.fromEntries(ids.map((i) => [i, i])), find = (x) => (parent[x] === x ? x : (parent[x] = find(parent[x])));
  for (const e of [...edges].sort((p, q) => p.d - q.d)) { const ra = find(e.a), rb = find(e.b); if (ra !== rb) { parent[ra] = rb; e.mst = true; } }
  const risky = assets.filter((a) => a.class !== 'macro' && a.id !== 'VIX'), M = risky.map((a) => metrics[a.id]);
  const riskyIds = new Set(risky.map((a) => a.id));
  const avgAbsCorr = mean(edges.filter((e) => riskyIds.has(e.a) && riskyIds.has(e.b)).map((e) => Math.abs(e.rho)));
  const volC = mean(M.map((m) => m.volPct ?? 0.5));
  const breadth = M.filter((m) => (m.momentum ?? 0) < 0).length / (M.length || 1);
  const anom = Math.min(1, M.filter((m) => m.anomaly).length / Math.max(1, M.length * 0.2));
  // PCA absorption ratio on the risky-asset correlation matrix (power iteration + deflation)
  const rIds = risky.map((a) => a.id), key = (x, y) => (x < y ? x + '|' + y : y + '|' + x), em = new Map(edges.map((e) => [key(e.a, e.b), e.rho]));
  const C = rIds.map((x) => rIds.map((y) => (x === y ? 1 : em.get(key(x, y)) ?? 0))), n = C.length, lams = [];
  const K = Math.max(1, Math.round(n / 5));
  for (let k = 0; k < K; k++) { let v = new Array(n).fill(1 / Math.sqrt(n)), lam = 0; for (let it = 0; it < 200; it++) { const u = C.map((row) => row.reduce((s, c, j) => s + c * v[j], 0)); lam = Math.hypot(...u); v = u.map((x) => x / (lam || 1)); } lams.push(lam); for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) C[i][j] -= lam * v[i] * v[j]; }
  const absorption = lams.reduce((s, x) => s + x, 0) / n;
  const sent = mean(news.map((n) => n.score)), sentC = Math.min(1, Math.max(0, 0.5 - sent));
  const comps = { volatility: volC, correlation: Math.min(1, 0.5 * avgAbsCorr / 0.6 + 0.5 * absorption), breadth, anomalies: anom, sentiment: sentC };
  const weights = { volatility: 0.3, correlation: 0.2, breadth: 0.2, anomalies: 0.15, sentiment: 0.15 };
  const score = Math.round(100 * Object.keys(weights).reduce((s, k) => s + weights[k] * comps[k], 0));
  return { metrics, correlation: { window: W, edges }, sentinel: { score, level: score >= 70 ? 'red' : score >= 50 ? 'amber' : score >= 30 ? 'watch' : 'green', components: Object.fromEntries(Object.entries(comps).map(([k, v]) => [k, r4(v)])), weights, avgNewsSentiment: r4(sent), absorptionRatio: r4(absorption), absorptionK: K } };
}
