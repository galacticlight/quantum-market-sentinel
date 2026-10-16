import './style.css';
import 'katex/dist/katex.min.css';
import katex from 'katex';
import * as d3 from 'd3';
import dossier from './dossier.json';

type M = { last: number; asOf: string; ch1d: number | null; ch5d: number | null; ch21d: number | null; vol20: number | null; volPct: number; regime: string; entropy: number | null; hurst: number | null; momentum: number | null; z: number | null; robustZ: number | null; anomaly: boolean; spark: number[] };
type Asset = { id: string; name: string; class: string; source: string; symbol: string };
type News = { title: string; link: string; source: string; date: string | null; score: number; label: string; tags: string[] };
type Edge = { a: string; b: string; rho: number; d: number; mst?: boolean };
type Snap = { generatedAt: string; assets: Asset[]; metrics: Record<string, M>; news: News[]; correlation: { window: number; edges: Edge[] }; sentinel: { score: number; level: string; components: Record<string, number>; weights: Record<string, number>; avgNewsSentiment: number; absorptionRatio: number; absorptionK: number }; status: { id: string; ok: boolean; stale?: boolean }[] };

const $ = <T extends Element = HTMLElement>(s: string) => document.querySelector(s) as T;
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const safeUrl = (u: string) => (/^https:\/\//.test(u) ? u : '#');
const pct = (x: number | null, d = 1) => (x == null ? '–' : `${x >= 0 ? '+' : ''}${(x * 100).toFixed(d)}%`);
const fx = (x: number | null, d = 2) => (x == null ? '–' : x.toFixed(d));
const cls = (x: number | null) => (x == null ? '' : x >= 0 ? 'pos' : 'neg');
const reduce = matchMedia('(prefers-reduced-motion: reduce)');
let motion = !reduce.matches;
const motionListeners: (() => void)[] = [];
const motionBtn = $('#motion') as HTMLButtonElement;
const syncBtn = () => { motionBtn.textContent = motion ? 'Pause motion' : 'Play motion'; motionBtn.setAttribute('aria-pressed', String(!motion)); };
motionBtn.onclick = () => { motion = !motion; syncBtn(); motionListeners.forEach((f) => f()); };
syncBtn();
const FOCUS = ['TSLA', 'NVDA', 'SEV', 'PLTR', 'AMZN', 'SPCX'];

/* ---------- starfield background ---------- */
function stars() {
  const c = $('#stars') as HTMLCanvasElement, g = c.getContext('2d')!;
  let pts: { x: number; y: number; z: number }[] = [];
  const size = () => { c.width = innerWidth * devicePixelRatio; c.height = innerHeight * devicePixelRatio; pts = Array.from({ length: 160 }, () => ({ x: Math.random() * c.width, y: Math.random() * c.height, z: Math.random() })); };
  size(); addEventListener('resize', size);
  const frame = () => {
    g.clearRect(0, 0, c.width, c.height);
    for (const p of pts) { if (motion) { p.y += 0.15 + p.z * 0.5; if (p.y > c.height) p.y = 0; } g.fillStyle = `rgba(${150 + p.z * 100},${200 + p.z * 55},255,${0.25 + p.z * 0.6})`; g.fillRect(p.x, p.y, 1 + p.z * 1.6, 1 + p.z * 1.6); }
    if (motion) requestAnimationFrame(frame);
  };
  frame(); motionListeners.push(() => motion && frame());
}

/* ---------- sentinel gauge ---------- */
function sentinel(s: Snap) {
  const S = s.sentinel, color = { green: '#3dffa8', watch: '#00f0ff', amber: '#ffc24d', red: '#ff5c7a' }[S.level] || '#00f0ff';
  const w = 260, r = 105, svg = d3.select('#gauge').append('svg').attr('viewBox', `0 0 ${w} ${w}`).attr('role', 'img').attr('aria-label', `Sentinel risk score ${S.score} out of 100, level ${S.level}`);
  const defs = svg.append('defs'); const f = defs.append('filter').attr('id', 'glow'); f.append('feGaussianBlur').attr('stdDeviation', 4).attr('result', 'b'); const fm = f.append('feMerge'); fm.append('feMergeNode').attr('in', 'b'); fm.append('feMergeNode').attr('in', 'SourceGraphic');
  const g = svg.append('g').attr('transform', `translate(${w / 2},${w / 2})`);
  const arc = d3.arc<number>().innerRadius(r - 16).outerRadius(r).startAngle(-Math.PI * 0.75).cornerRadius(8);
  g.append('path').attr('d', arc.endAngle(Math.PI * 0.75)(0)!).attr('fill', 'rgba(255,255,255,.08)');
  const fg = g.append('path').attr('fill', color).attr('filter', 'url(#glow)');
  const target = -Math.PI * 0.75 + (S.score / 100) * Math.PI * 1.5;
  if (motion) fg.transition().duration(1600).ease(d3.easeCubicOut).attrTween('d', () => (t) => arc.endAngle(-Math.PI * 0.75 + (target + Math.PI * 0.75) * t)(0)!); else fg.attr('d', arc.endAngle(target)(0)!);
  g.append('text').attr('text-anchor', 'middle').attr('dy', '0.1em').style('font-size', '58px').style('fill', color).style('filter', 'url(#glow)').text(S.score);
  g.append('text').attr('text-anchor', 'middle').attr('dy', '2.4em').style('font-size', '13px').style('fill', '#a3aed0').text(`/ 100 · ${S.level.toUpperCase()}`);
  const words: Record<string, string> = { green: 'Calm conditions: low stress across the watchlist.', watch: 'Mostly calm, with a few stress readings worth watching.', amber: 'Elevated stress: several risk components are high.', red: 'High stress: volatility, correlation and anomalies are clustering.' };
  $('#sent-text').innerHTML = `${words[S.level]} The score blends five components (0 = calm, 1 = stressed) with fixed weights. PCA absorption ratio (top ${S.absorptionK} factors): <strong class="num">${(S.absorptionRatio * 100).toFixed(0)}%</strong>. Average headline sentiment: <strong class="num">${fx(S.avgNewsSentiment, 3)}</strong>.`;
  $('#components').innerHTML = Object.entries(S.components).map(([k, v]) => `<li><span>${k} <small class="num">×${S.weights[k]}</small></span><span class="bar" role="img" aria-label="${k} ${(v * 100).toFixed(0)} percent"><i style="width:${(v * 100).toFixed(0)}%"></i></span><span class="num">${v.toFixed(2)}</span></li>`).join('');
  const al = s.assets.filter((a) => s.metrics[a.id].anomaly || s.metrics[a.id].regime === 'turbulent');
  $('#alerts').innerHTML = al.length ? al.map((a) => { const m = s.metrics[a.id]; return `<li><strong>${esc(a.id)}</strong> ${m.anomaly ? `last move z = <span class="num">${fx(m.z)}</span>, robust z = <span class="num">${fx(m.robustZ)}</span>` : ''} ${m.regime === 'turbulent' ? '· turbulent volatility regime' : ''}</li>`; }).join('') : '<li>No anomalies: no asset has |z| ≥ 2.5, |robust z| ≥ 3, or a turbulent regime.</li>';
}

/* ---------- watchlist ---------- */
function spark(v: number[]) {
  const w = 110, h = 28, x = d3.scaleLinear([0, v.length - 1], [0, w]), y = d3.scaleLinear(d3.extent(v) as [number, number], [h - 2, 2]);
  const up = v.at(-1)! >= v[0];
  return `<svg width="${w}" height="${h}" aria-hidden="true"><path d="${d3.line<number>((_, i) => x(i), (d) => y(d))(v)}" fill="none" stroke="${up ? '#3dffa8' : '#ff5c7a'}" stroke-width="1.5"/></svg>`;
}
function watchlist(s: Snap) {
  const cols: [string, string, (a: Asset) => number | string | null][] = [
    ['id', 'Asset', (a) => a.id], ['class', 'Class', (a) => a.class], ['last', 'Last', (a) => s.metrics[a.id].last], ['ch1d', '1D', (a) => s.metrics[a.id].ch1d], ['ch21d', '1M', (a) => s.metrics[a.id].ch21d],
    ['spark', '90D', () => null], ['vol20', 'Vol 20D', (a) => s.metrics[a.id].vol20], ['regime', 'Regime', (a) => s.metrics[a.id].volPct], ['momentum', 'Momentum', (a) => s.metrics[a.id].momentum], ['hurst', 'Hurst', (a) => s.metrics[a.id].hurst], ['entropy', 'Entropy', (a) => s.metrics[a.id].entropy], ['z', 'z', (a) => s.metrics[a.id].z]];
  let sortKey = 'class', dir = 1, filter = 'all';
  const classes = ['all', ...new Set(s.assets.map((a) => a.class))];
  $('#classFilter').innerHTML = classes.map((c) => `<button class="btn" data-c="${c}" aria-pressed="${c === 'all'}">${c}</button>`).join('');
  $('#classFilter').onclick = (e) => { const b = (e.target as HTMLElement).closest('button'); if (!b) return; filter = b.dataset.c!; document.querySelectorAll('#classFilter button').forEach((x) => x.setAttribute('aria-pressed', String(x === b))); render(); };
  const thead = $('#wl thead');
  const render = () => {
    thead.innerHTML = '<tr>' + cols.map(([k, l]) => (k === 'spark' ? `<th>${l}</th>` : `<th aria-sort="${sortKey === k ? (dir > 0 ? 'ascending' : 'descending') : 'none'}"><button data-k="${k}">${l}${sortKey === k ? (dir > 0 ? ' ▲' : ' ▼') : ''}</button></th>`)).join('') + '</tr>';
    const get = cols.find((c) => c[0] === sortKey)![2];
    const rows = s.assets.filter((a) => filter === 'all' || a.class === filter).sort((a, b) => { const x = get(a), y = get(b); return (x == null ? 1 : y == null ? -1 : x > y ? 1 : x < y ? -1 : 0) * dir; });
    $('#wl tbody').innerHTML = rows.map((a) => { const m = s.metrics[a.id], rate = a.class === 'macro';
      const ch = (x: number | null) => (rate ? (x == null ? '–' : `${x >= 0 ? '+' : ''}${(x * 100).toFixed(0)} bp`) : pct(x));
      return `<tr><td><strong>${esc(a.id)}</strong><br><small style="color:var(--muted)">${esc(a.name)}</small></td><td>${a.class}</td><td class="num">${m.last.toLocaleString(undefined, { maximumFractionDigits: m.last < 10 ? 4 : 2 })}${rate ? '%' : ''}</td><td class="num ${cls(m.ch1d)}">${ch(m.ch1d)}</td><td class="num ${cls(m.ch21d)}">${ch(m.ch21d)}</td><td>${spark(m.spark.filter((x) => x != null))}</td><td class="num">${m.vol20 == null ? '–' : (m.vol20 * 100).toFixed(0) + '%'}</td><td><span class="chip ${m.regime}">${m.regime}</span></td><td class="num ${cls(m.momentum)}">${fx(m.momentum)}</td><td class="num">${fx(m.hurst)}</td><td class="num">${fx(m.entropy)}</td><td class="num ${m.anomaly ? 'neg' : ''}">${fx(m.z)}${m.anomaly ? ' ⚠' : ''}</td></tr>`; }).join('');
  };
  thead.onclick = (e) => { const b = (e.target as HTMLElement).closest('button'); if (!b) return; const k = b.dataset.k!; dir = sortKey === k ? -dir : 1; sortKey = k; render(); (thead.querySelector(`button[data-k="${k}"]`) as HTMLElement)?.focus(); };
  render();
}

/* ---------- constellation (from the original index.html, now data-driven) ---------- */
function constellation(s: Snap) {
  const c = $('#con') as HTMLCanvasElement, g = c.getContext('2d')!;
  const comp = new Map(dossier.companies.map((x: any) => [x.ticker, x]));
  const rho = new Map(s.correlation.edges.map((e) => [[e.a, e.b].sort().join('|'), e.rho]));
  const items = FOCUS.filter((t) => s.metrics[t]).map((t, i) => {
    const m = s.metrics[t], d: any = comp.get(t);
    const news = s.news.filter((n) => n.tags.includes(t)); const ns = news.length ? d3.mean(news, (n) => n.score)! : 0;
    const blend = Math.tanh(0.6 * (m.momentum ?? 0) + 0.4 * ns);
    const cap = d?.market_cap?.value ?? 5e10;
    return { t, i, blend, size: 10 + Math.max(0, Math.log10(cap) - 7) * 4.5, hue: 60 + blend * 90 > 0 ? 60 + blend * 90 : 0, pulse: i, angle: (i / FOCUS.length) * Math.PI * 2 - Math.PI / 2, x: 0, y: 0, nNews: news.length };
  });
  $('#con-list').innerHTML = items.map((p) => `<li><strong>${p.t}</strong> blended signal <span class="num ${cls(p.blend)}">${p.blend.toFixed(2)}</span> · ${p.nNews} tagged headline${p.nNews === 1 ? '' : 's'}</li>`).join('');
  let W = 0, H = 0;
  const size = () => { const r = c.getBoundingClientRect(); W = r.width; H = r.height; c.width = W * devicePixelRatio; c.height = H * devicePixelRatio; g.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0); };
  size(); new ResizeObserver(size).observe(c);
  let running = false;
  const frame = () => {
    g.fillStyle = motion ? 'rgba(3,3,12,.22)' : 'rgb(3,3,12)'; g.fillRect(0, 0, W, H);
    const cx = W / 2, cy = H / 2, R = Math.min(W, H) * 0.38;
    for (const p of items) { if (motion) p.angle += 0.0012 * (1 + (1 - p.blend)); const rr = R * (0.75 - 0.3 * p.blend); p.x = cx + Math.cos(p.angle) * rr; p.y = cy + Math.sin(p.angle) * rr; }
    for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++) { const r = Math.abs(rho.get([items[i].t, items[j].t].sort().join('|')) ?? 0); g.strokeStyle = `rgba(0,240,255,${0.05 + r * 0.6})`; g.lineWidth = 0.5 + r * 2.5; g.beginPath(); g.moveTo(items[i].x, items[i].y); g.lineTo(items[j].x, items[j].y); g.stroke(); }
    for (const p of items) { g.strokeStyle = 'rgba(179,136,255,.18)'; g.lineWidth = 1; g.beginPath(); g.moveTo(cx, cy); g.lineTo(p.x, p.y); g.stroke(); }
    const t = performance.now() / 1000;
    for (const p of items) {
      const sz = p.size + (motion ? Math.sin(t * 2 + p.pulse) * 2.5 : 0), gr = g.createRadialGradient(p.x, p.y, 0, p.x, p.y, sz * 1.8);
      gr.addColorStop(0, `hsla(${p.hue},100%,72%,.95)`); gr.addColorStop(0.45, `hsla(${p.hue},100%,55%,.55)`); gr.addColorStop(1, `hsla(${p.hue},100%,50%,0)`);
      g.fillStyle = gr; g.beginPath(); g.arc(p.x, p.y, sz * 1.8, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#fff'; g.font = 'bold 12px ui-monospace,monospace'; g.textAlign = 'center'; g.fillText(p.t, p.x, p.y + 4);
    }
    const ps = 18 + (motion ? Math.sin(t * 2.5) * 7 : 0), cg = g.createRadialGradient(cx, cy, 0, cx, cy, ps * 2);
    cg.addColorStop(0, 'rgba(0,240,255,.8)'); cg.addColorStop(1, 'rgba(0,240,255,0)'); g.fillStyle = cg; g.beginPath(); g.arc(cx, cy, ps * 2, 0, Math.PI * 2); g.fill();
    g.fillStyle = 'rgba(160,240,255,.9)'; g.font = '10px ui-monospace,monospace'; g.fillText(`NEWS PULSE · ${s.news.length}`, cx, cy + 46);
    if (motion && running) requestAnimationFrame(frame);
  };
  new IntersectionObserver((e) => { running = e[0].isIntersecting; if (running) frame(); }).observe(c);
  motionListeners.push(() => frame());
  frame();
}

/* ---------- correlation network ---------- */
function network(s: Snap) {
  const svg = d3.select<SVGSVGElement, unknown>('#net'), box = (svg.node() as SVGSVGElement).getBoundingClientRect(), W = box.width, H = box.height;
  svg.attr('viewBox', `0 0 ${W} ${H}`);
  const color = d3.scaleOrdinal<string>().domain(['equity', 'index', 'crypto', 'fx', 'macro']).range(['#00f0ff', '#b388ff', '#ffc24d', '#3dffa8', '#ff8ad8']);
  const nodes: any[] = s.assets.map((a) => ({ id: a.id, cls: a.class }));
  const links: any[] = s.correlation.edges.filter((e) => e.mst || Math.abs(e.rho) >= 0.6).map((e) => ({ source: e.a, target: e.b, ...e }));
  const defs = svg.append('defs'); const f = defs.append('filter').attr('id', 'nglow'); f.append('feGaussianBlur').attr('stdDeviation', 3).attr('result', 'b'); const fm = f.append('feMerge'); fm.append('feMergeNode').attr('in', 'b'); fm.append('feMergeNode').attr('in', 'SourceGraphic');
  const link = svg.append('g').selectAll('line').data(links).join('line').attr('stroke', (d) => (d.rho >= 0 ? '#00f0ff' : '#ff5c7a')).attr('stroke-opacity', (d) => (d.mst ? 0.85 : 0.18)).attr('stroke-width', (d) => 0.6 + Math.abs(d.rho) * 3);
  const node = svg.append('g').selectAll<SVGGElement, any>('g').data(nodes).join('g').attr('class', 'node').attr('tabindex', 0).attr('role', 'button').attr('aria-label', (d) => `${d.id}, ${d.cls}`);
  node.append('circle').attr('r', 11).attr('fill', (d) => color(d.cls)).attr('fill-opacity', 0.85).attr('filter', 'url(#nglow)').attr('stroke', '#05060f').attr('stroke-width', 1.5);
  node.append('text').attr('dy', -16).attr('text-anchor', 'middle').text((d) => d.id);
  const sim = d3.forceSimulation(nodes).force('link', d3.forceLink(links).id((d: any) => d.id).distance((d: any) => 40 + d.d * 110).strength((d: any) => (d.mst ? 0.7 : 0.08))).force('charge', d3.forceManyBody().strength(-260)).force('center', d3.forceCenter(W / 2, H / 2)).force('collide', d3.forceCollide(24))
    .force('x', d3.forceX(W / 2).strength(0.04)).force('y', d3.forceY(H / 2).strength(0.06));
  const tick = () => { nodes.forEach((n) => { n.x = Math.max(20, Math.min(W - 20, n.x)); n.y = Math.max(24, Math.min(H - 12, n.y)); }); link.attr('x1', (d) => d.source.x).attr('y1', (d) => d.source.y).attr('x2', (d) => d.target.x).attr('y2', (d) => d.target.y); node.attr('transform', (d) => `translate(${d.x},${d.y})`); };
  sim.on('tick', tick);
  if (!motion) { sim.stop(); for (let i = 0; i < 300; i++) sim.tick(); tick(); }
  node.call(d3.drag<SVGGElement, any>().on('start', (e, d) => { if (!e.active) sim.alphaTarget(0.3).restart(); d.fx = d.x; d.fy = d.y; }).on('drag', (e, d) => { d.fx = e.x; d.fy = e.y; if (!motion) { sim.tick(); tick(); } }).on('end', (e, d) => { if (!e.active) sim.alphaTarget(0); d.fx = d.fy = null; }));
  const show = (d: any) => { const es = s.correlation.edges.filter((e) => e.a === d.id || e.b === d.id).sort((x, y) => Math.abs(y.rho) - Math.abs(x.rho)).slice(0, 5); $('#net-detail').textContent = `${d.id}: strongest links ${es.map((e) => `${e.a === d.id ? e.b : e.a} ρ=${e.rho.toFixed(2)}`).join(', ')}`; link.attr('stroke-opacity', (l: any) => (l.source.id === d.id || l.target.id === d.id ? 1 : l.mst ? 0.25 : 0.06)); };
  node.on('click', (_, d) => show(d)).on('keydown', (e, d) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); show(d); } }).on('focus', (_, d) => show(d));
  $('#corr-tbl tbody').innerHTML = [...s.correlation.edges].sort((a, b) => Math.abs(b.rho) - Math.abs(a.rho)).slice(0, 15).map((e) => `<tr><td>${e.a} – ${e.b}</td><td class="num ${cls(e.rho)}">${e.rho.toFixed(2)}</td><td class="num">${e.d.toFixed(2)}</td></tr>`).join('');
}

/* ---------- Hurst × entropy scatter ---------- */
function scatter(s: Snap) {
  const svg = d3.select('#scatter'), box = (svg.node() as SVGSVGElement).getBoundingClientRect(), W = box.width, H = box.height, m = { l: 50, r: 20, t: 20, b: 44 };
  svg.attr('viewBox', `0 0 ${W} ${H}`);
  const pts = s.assets.map((a) => ({ a, m: s.metrics[a.id] })).filter((p) => p.m.hurst != null && p.m.entropy != null);
  const x = d3.scaleLinear(d3.extent([...pts.map((p) => p.m.hurst!), 0.4, 0.7]) as [number, number], [m.l, W - m.r]).nice();
  const y = d3.scaleLinear(d3.extent([...pts.map((p) => p.m.entropy!), 0.5, 0.9]) as [number, number], [H - m.b, m.t]).nice();
  const ax = svg.append('g').attr('transform', `translate(0,${H - m.b})`).call(d3.axisBottom(x).ticks(6)); const ay = svg.append('g').attr('transform', `translate(${m.l},0)`).call(d3.axisLeft(y).ticks(5));
  [ax, ay].forEach((a) => a.selectAll('line,path').attr('stroke', '#5a6690'));
  svg.append('line').attr('x1', x(0.5)).attr('x2', x(0.5)).attr('y1', m.t).attr('y2', H - m.b).attr('stroke', '#b388ff').attr('stroke-dasharray', '4 4').attr('opacity', 0.6);
  svg.append('text').attr('x', x(0.5) + 6).attr('y', m.t + 12).style('fill', '#a3aed0').text('H = 0.5 random walk');
  svg.append('text').attr('x', W / 2).attr('y', H - 8).attr('text-anchor', 'middle').style('fill', '#a3aed0').text('Hurst exponent →  (left: mean-reverting · right: trending)');
  svg.append('text').attr('transform', `translate(14,${H / 2}) rotate(-90)`).attr('text-anchor', 'middle').style('fill', '#a3aed0').text('Normalized entropy');
  const col: Record<string, string> = { calm: '#3dffa8', normal: '#00f0ff', elevated: '#ffc24d', turbulent: '#ff5c7a' };
  const g = svg.append('g').selectAll('g').data(pts).join('g').attr('transform', (p) => `translate(${x(p.m.hurst!)},${y(p.m.entropy!)})`);
  g.append('circle').attr('r', 7).attr('fill', 'rgba(5,6,15,.8)').attr('stroke', (p) => col[p.m.regime]).attr('stroke-width', 2.5);
  g.append('text').attr('x', 10).attr('dy', 4).text((p) => p.a.id);
  g.append('title').text((p) => `${p.a.id}: H=${p.m.hurst} entropy=${p.m.entropy} regime=${p.m.regime}`);
}

/* ---------- news ---------- */
function news(s: Snap) {
  let f = 'all';
  const counts = d3.rollup(s.news, (v) => v.length, (n) => n.label);
  $('#newsFilter').innerHTML = ['all', 'positive', 'neutral', 'negative'].map((k) => `<button class="btn" data-f="${k}" aria-pressed="${k === 'all'}">${k} (${k === 'all' ? s.news.length : counts.get(k) ?? 0})</button>`).join('');
  const render = () => { $('#newslist').innerHTML = s.news.filter((n) => f === 'all' || n.label === f).map((n) => `<li><span class="s-${n.label} num">${n.score >= 0 ? '+' : ''}${n.score.toFixed(2)}<br><small>${n.label}</small></span><span><a href="${esc(safeUrl(n.link))}" rel="noopener noreferrer" target="_blank">${esc(n.title)}</a><br><span class="src">${esc(n.source)}${n.date ? ' · ' + new Date(n.date).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : ''}${n.tags.length ? ' · ' + n.tags.map(esc).join(', ') : ''}</span></span></li>`).join('') || '<li>No headlines in this filter.</li>'; };
  $('#newsFilter').onclick = (e) => { const b = (e.target as HTMLElement).closest('button'); if (!b) return; f = b.dataset.f!; document.querySelectorAll('#newsFilter button').forEach((x) => x.setAttribute('aria-pressed', String(x === b))); render(); };
  render();
}

/* ---------- research dossier ---------- */
function dossierPanel(s: Snap) {
  $('#dos-note').textContent = `${dossier.note} Seed as of ${dossier.asOf}. Live columns come from the latest automated refresh.`;
  const money = (v: number | null | undefined) => (v == null ? 'n/a' : v >= 1e12 ? `$${(v / 1e12).toFixed(2)}T` : v >= 1e9 ? `$${(v / 1e9).toFixed(1)}B` : v >= 1e6 ? `$${(v / 1e6).toFixed(0)}M` : `$${v}`);
  const src = (x: any) => { const u = Array.isArray(x) ? x[0] : x; return typeof u === 'string' && u.startsWith('https://') ? ` <a href="${esc(u)}" rel="noopener noreferrer" target="_blank" aria-label="source">↗</a>` : ''; };
  $('#dos').innerHTML = dossier.companies.map((c: any) => { const m = s.metrics[c.ticker];
    return `<article class="card"><div class="tk">${esc(c.ticker)}</div><small>${esc(c.name)} · ${esc(c.listing_status)}</small>
    <dl><dt>Seed close</dt><dd>$${c.price.value}${src(c.price.source)}</dd>${m ? `<dt>Live last (${m.asOf})</dt><dd>$${m.last}</dd>` : ''}
    <dt>Market cap</dt><dd>${money(c.market_cap?.value)}${src(c.market_cap?.source)}</dd><dt>P/E (TTM)</dt><dd>${c.pe?.ttm ?? 'n/a'}</dd>
    <dt>YTD</dt><dd class="${cls(c.perf?.ytd ?? c.perf?.ytd_approx ?? null)}">${c.perf?.ytd ?? c.perf?.ytd_approx ?? 'n/a'}%</dd>
    <dt>Research composite</dt><dd>${c.sentiment.score}/100 · ${esc(c.sentiment.label)}</dd></dl>
    <small>${esc(c.sentiment.reasoning || '')}</small>
    <ul>${(c.news || []).slice(0, 3).map((n: any) => `<li><a href="${esc(safeUrl(n.url))}" rel="noopener noreferrer" target="_blank">${esc(n.headline)}</a> <small>${esc(n.source)} · ${esc(n.date)}</small></li>`).join('')}</ul></article>`; }).join('');
}

/* ---------- formulas ---------- */
function formulas() {
  const F: [string, string, string][] = [
    ['Log return', 'r_t = \\ln\\frac{P_t}{P_{t-1}}', 'Rates and spreads (FRED series) use first differences instead.'],
    ['Realized volatility & regime', '\\sigma_{20} = \\sqrt{A}\\,\\operatorname{sd}(r_{t-19..t}),\\quad q = \\hat F(\\sigma_{20})', 'A = 252 (365 for crypto). q is the percentile of today’s σ within the past year: calm < 0.25 ≤ normal ≤ 0.65 < elevated ≤ 0.9 < turbulent.'],
    ['Shannon entropy', 'H = -\\frac{1}{\\log_2 B}\\sum_{b=1}^{B} p_b \\log_2 p_b', 'Return histogram over 250 days in B = 12 bins; 1 = maximally disordered.'],
    ['Hurst exponent (R/S)', '\\mathbb{E}\\!\\left[\\tfrac{R(n)}{S(n)}\\right] \\propto n^{H}', 'Slope of log R/S vs log n. H > 0.5 trending, H < 0.5 mean-reverting.'],
    ['Momentum', 'M = \\frac{\\ln(P_t/P_{t-63})}{\\sigma_{63}\\sqrt{63}}', 'A volatility-scaled 3-month trend (a t-statistic of the drift).'],
    ['Anomaly z-scores', 'z = \\frac{r_t-\\mu_{60}}{\\sigma_{60}},\\quad z^{\\ast} = \\frac{r_t-\\tilde r}{1.4826\\,\\mathrm{MAD}}', 'Flag when |z| ≥ 2.5 or robust |z*| ≥ 3.'],
    ['Correlation distance', '\\rho_{ij} = \\operatorname{corr}_{60}(r_i,r_j),\\quad d_{ij} = \\sqrt{2(1-\\rho_{ij})}', 'Aligned on shared trading dates; the network shows the Mantegna minimum spanning tree.'],
    ['Absorption ratio', 'AR = \\frac{\\sum_{k=1}^{\\lceil n/5\\rceil}\\lambda_k}{\\sum_{k=1}^{n}\\lambda_k}', 'Share of correlation-matrix variance in the top eigenvectors. High AR means markets move as one, so the system is fragile.'],
    ['Lexicon sentiment', 's = \\frac{n_{+}-n_{-}}{\\sqrt{n_{+}+n_{-}+1}}', 'Finance word lists with two-word negation flipping. Positive above 0.2, negative below −0.2.'],
    ['Sentinel score', 'S = 100\\sum_k w_k c_k,\\quad c_k\\in[0,1]', 'Components: volatility percentile (0.3), correlation and AR (0.2), negative-momentum breadth (0.2), anomaly share (0.15), and inverted news sentiment (0.15).'],
    ['Research composite (dossier)', 'S = 50 + 50\\tanh(0.4N + 0.35F + 0.25M)', 'From the Researcher’s seed file. N, F, M are analyst-judged inputs in [−1, 1], not fitted.'],
    ['News polarity with decay', 'N = \\frac{\\sum_i p_i r_i e^{-a_i/\\tau}}{\\sum_i r_i e^{-a_i/\\tau}},\\ \\tau = 7\\text{d}', 'Method used in the research dossier; r_i is source reliability.'],
  ];
  $('#formulas').innerHTML = F.map(([t, tex, p]) => `<article><h3>${t}</h3>${katex.renderToString(tex, { displayMode: true, throwOnError: false, output: 'htmlAndMathml' })}<p>${p}</p></article>`).join('');
}

async function main() {
  stars(); formulas();
  try {
    const r = await fetch(`${import.meta.env.BASE_URL}data/snapshot.json`, { cache: 'no-cache' });
    const s: Snap = await r.json();
    const stale = s.status.filter((x) => !x.ok).length;
    $('#updated').textContent = `Updated ${new Date(s.generatedAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}${stale ? ` · ${stale} source(s) using last good data` : ''}`;
    sentinel(s); watchlist(s); constellation(s); network(s); scatter(s); news(s); dossierPanel(s);
  } catch (e) { $('#updated').textContent = 'Data unavailable right now; showing methods only.'; console.error(e); }
}
main();
