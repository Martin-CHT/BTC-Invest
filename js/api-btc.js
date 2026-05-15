/**
 * CoinGecko API client – BTC (a další coiny) ceny v CZK/USD + roční historie.
 * Free tier: ~10-30 requestů/min, žádný API klíč nepotřeba.
 */

const BASE = 'https://api.coingecko.com/api/v3';

const cache = new Map();
const TTL_MS = 5 * 60 * 1000;

async function fetchCached(url, opts = {}) {
  const now = Date.now();
  const hit = cache.get(url);
  if (hit && now - hit.ts < TTL_MS) return hit.data;

  const res = await fetch(url, opts);
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`CoinGecko ${res.status}: ${text || res.statusText}`);
  }
  const data = await res.json();
  cache.set(url, { ts: now, data });
  return data;
}

/**
 * Aktuální cena assetu ve více měnách najednou.
 * @param {string} coinId – CoinGecko ID (např. 'bitcoin')
 * @param {string[]} vsCurrencies
 */
export async function getCurrentPrice(coinId = 'bitcoin', vsCurrencies = ['usd', 'czk']) {
  const url = `${BASE}/simple/price?ids=${coinId}&vs_currencies=${vsCurrencies.join(',')}&include_24hr_change=true`;
  const data = await fetchCached(url);
  if (!data[coinId]) throw new Error(`Coin "${coinId}" nenalezen`);
  return {
    usd: data[coinId].usd,
    czk: data[coinId].czk,
    change24h: data[coinId].usd_24h_change ?? 0,
  };
}

/**
 * Historický vývoj ceny – posledních N dní.
 * Vrací pole {date: Date, price: number} v dané měně.
 * @param {string} coinId
 * @param {string} vsCurrency – 'usd' nebo 'czk'
 * @param {number} days
 */
export async function getHistory(coinId = 'bitcoin', vsCurrency = 'usd', days = 365) {
  const url = `${BASE}/coins/${coinId}/market_chart?vs_currency=${vsCurrency}&days=${days}&interval=daily`;
  const data = await fetchCached(url);
  if (!Array.isArray(data.prices)) throw new Error('Chybný formát historie');
  return data.prices.map(([ts, price]) => ({
    date: new Date(ts),
    price,
  }));
}

/**
 * Cena BTC k danému datu (nejbližší den z historie).
 */
export async function getPriceAt(coinId, vsCurrency, date) {
  const history = await getHistory(coinId, vsCurrency, 365);
  const target = new Date(date).getTime();
  let best = history[0];
  let bestDiff = Math.abs(history[0].date.getTime() - target);
  for (const point of history) {
    const diff = Math.abs(point.date.getTime() - target);
    if (diff < bestDiff) {
      best = point;
      bestDiff = diff;
    }
  }
  return best.price;
}

/**
 * Seznam podporovaných assets pro výběr.
 * Defaultní + uživatelské.
 */
export const DEFAULT_ASSETS = [
  { id: 'bitcoin', label: 'Bitcoin (BTC)' },
  { id: 'ethereum', label: 'Ethereum (ETH)' },
  { id: 'solana', label: 'Solana (SOL)' },
];
