// Lightweight lexicon sentiment, inspired by Loughran–McDonald finance word lists (own small list, not the LM dictionary).
const POS = 'beat beats surge surges soar soars rally rallies gain gains jump jumps rise rises record upgrade upgraded strong growth profit profits boom bullish optimism rebound recover recovers recovery outperform tops wins win approval approved expands expansion breakthrough boost boosts higher climbs climb raises raised hike-free'.split(' ');
const NEG = 'miss misses plunge plunges slump slumps fall falls drop drops tumble tumbles crash crashes downgrade downgraded weak loss losses bearish fear fears recession inflation layoffs layoff cut cuts lawsuit probe fraud default bankruptcy warns warning risk risks selloff sell-off slide slides lower sinks sink tariff tariffs crisis volatile volatility concern concerns delay delays recall halts shutdown'.split(' ');
const NEGATE = new Set(['not', 'no', 'never', "isn't", "doesn't", "won't", 'without']);
const P = new Set(POS), N = new Set(NEG);
export function scoreHeadline(text) {
  const w = text.toLowerCase().match(/[a-z'-]+/g) || [];
  let pos = 0, neg = 0;
  w.forEach((t, i) => { const flip = NEGATE.has(w[i - 1]) || NEGATE.has(w[i - 2]); if (P.has(t)) flip ? neg++ : pos++; else if (N.has(t)) flip ? pos++ : neg++; });
  const score = (pos - neg) / Math.sqrt(pos + neg + 1); // bounded-ish in [-1.5,1.5]
  return { pos, neg, score: +score.toFixed(3), label: score > 0.2 ? 'positive' : score < -0.2 ? 'negative' : 'neutral' };
}
