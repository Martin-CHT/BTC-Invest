/**
 * Smart DCA algoritmus.
 *
 * Kombinuje dva ověřené přístupy:
 *  1) Mayer Multiple = cena / 200d SMA (medián historicky ≈ 1.4)
 *  2) Z-score log-ceny za 1 rok (statistická odchylka od průměru)
 *
 * Výstupem je multiplikátor 0.2× – 2.5×, kterým se škáluje plánovaná částka
 * na jeden interval. Pokud je BTC levné (Mayer < 1, z < 0), kupujeme víc.
 * Pokud je drahé (Mayer > 2, z > 1), kupujeme zlomek.
 */

const TARGET_MAYER = 1.4;
const SMA_WINDOW = 200;
const MIN_MULT = 0.2;
const MAX_MULT = 2.5;

export function sma(prices, window) {
  if (prices.length < window) return prices.reduce((a, b) => a + b, 0) / prices.length;
  let sum = 0;
  for (let i = prices.length - window; i < prices.length; i++) sum += prices[i];
  return sum / window;
}

export function logMean(prices) {
  const logs = prices.map((p) => Math.log(p));
  return logs.reduce((a, b) => a + b, 0) / logs.length;
}

export function logStd(prices) {
  const logs = prices.map((p) => Math.log(p));
  const mean = logs.reduce((a, b) => a + b, 0) / logs.length;
  const variance = logs.reduce((a, b) => a + (b - mean) ** 2, 0) / logs.length;
  return Math.sqrt(variance);
}

/**
 * Vrátí metriky a multiplikátor pro aktuální cenu.
 * @param {number[]} historyPrices – pole historických cen (denní, chronologicky)
 * @param {number} currentPrice
 * @param {number} sensitivity – 0.5 (jemný) – 3.0 (agresivní), default 1.5
 */
export function computeMetrics(historyPrices, currentPrice, sensitivity = 1.5) {
  const smaValue = sma(historyPrices, SMA_WINDOW);
  const mayer = currentPrice / smaValue;

  const mu = logMean(historyPrices);
  const sigma = logStd(historyPrices) || 0.0001;
  const z = (Math.log(currentPrice) - mu) / sigma;

  // Mayer-based factor: cheaper = higher factor
  const mayerFactor = Math.pow(TARGET_MAYER / mayer, sensitivity);

  // Z-score adjustment: blízko 1 pro z=0, klesá k 0.5 pro z=+2, roste k 1.5 pro z=-2
  const zAdjust = Math.exp(-z * 0.25);

  const rawMult = mayerFactor * zAdjust;
  const multiplier = Math.max(MIN_MULT, Math.min(MAX_MULT, rawMult));

  return {
    sma200: smaValue,
    mayer,
    zScore: z,
    multiplier,
    verdict: classify(mayer, z),
  };
}

function classify(mayer, z) {
  if (mayer < 0.8 || z < -1.5) return { label: 'Silný nákup', tag: 'tag-buy', reason: 'BTC je výrazně pod historickým průměrem' };
  if (mayer < 1.0 || z < -0.5) return { label: 'Nákup', tag: 'tag-buy', reason: 'BTC je mírně pod průměrem' };
  if (mayer < 1.8 && z < 1.0) return { label: 'Držet plán', tag: 'tag-hold', reason: 'BTC se pohybuje v normálním pásmu' };
  if (mayer < 2.4 || z < 2.0) return { label: 'Opatrnost', tag: 'tag-skip', reason: 'BTC je nad průměrem – kupovat zlomek' };
  return { label: 'Drahé – vyčkat', tag: 'tag-danger', reason: 'BTC je extrémně nadhodnocené' };
}

/**
 * Spočítá doporučenou částku pro aktuální interval.
 *
 * @param {Object} args
 * @param {Object} args.plan – { totalBudget, currency, period, interval, startDate }
 * @param {Array} args.investments – už zaznamenané investice
 * @param {number} args.multiplier – z computeMetrics
 * @param {Date} args.now – aktuální datum (default new Date())
 */
export function computeRecommendation({ plan, investments, multiplier, now = new Date() }) {
  const intervalDays = INTERVAL_DAYS[plan.interval];
  const periodDays = PERIOD_DAYS[plan.period];
  const totalIntervals = Math.max(1, Math.floor(periodDays / intervalDays));

  const start = new Date(plan.startDate);
  const end = new Date(start.getTime() + periodDays * 86400000);

  const isOver = now > end;
  const elapsedDays = Math.max(0, Math.floor((now - start) / 86400000));
  const intervalsElapsed = Math.min(totalIntervals, Math.floor(elapsedDays / intervalDays) + 1);
  const intervalsRemaining = Math.max(1, totalIntervals - intervalsElapsed + 1);

  const spent = investments
    .filter((i) => new Date(i.date) >= start && new Date(i.date) <= end)
    .reduce((sum, i) => sum + i.amount, 0);
  const remaining = Math.max(0, plan.totalBudget - spent);

  const basePerInterval = remaining / intervalsRemaining;
  const rawSuggested = basePerInterval * multiplier;
  const suggested = Math.min(rawSuggested, remaining);

  return {
    suggested: Math.round(suggested),
    basePerInterval: Math.round(basePerInterval),
    multiplier,
    remaining: Math.round(remaining),
    spent: Math.round(spent),
    totalIntervals,
    intervalsElapsed: Math.min(intervalsElapsed, totalIntervals),
    intervalsRemaining,
    isOver,
    nextIntervalDate: nextIntervalDate(start, intervalDays, now),
  };
}

function nextIntervalDate(start, intervalDays, now) {
  const elapsedDays = Math.floor((now - start) / 86400000);
  const intervalsElapsed = Math.floor(elapsedDays / intervalDays);
  return new Date(start.getTime() + (intervalsElapsed + 1) * intervalDays * 86400000);
}

export const PERIOD_DAYS = {
  week: 7,
  month: 30,
  quarter: 90,
  year: 365,
};

export const INTERVAL_DAYS = {
  daily: 1,
  weekly: 7,
  biweekly: 14,
  monthly: 30,
};

export const PERIOD_LABEL = {
  week: '1 týden',
  month: '1 měsíc',
  quarter: '3 měsíce',
  year: '1 rok',
};

export const INTERVAL_LABEL = {
  daily: 'denně',
  weekly: 'týdně',
  biweekly: 'každých 14 dní',
  monthly: 'měsíčně',
};
