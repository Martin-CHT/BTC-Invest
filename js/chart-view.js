/**
 * Vykreslení grafu ceny + 200d SMA + markerů investic.
 * Předpokládá globální Chart (Chart.js načtený přes CDN v index.html).
 */

let chartInstance = null;

export function renderChart(canvas, { history, investments, currency }) {
  const ctx = canvas.getContext('2d');

  const labels = history.map((p) => formatDate(p.date));
  const prices = history.map((p) => p.price);
  const smaSeries = rolling200(prices);

  // Investice: pole stejné délky jako labels, null jinde, cena v dni nákupu na správném indexu.
  // (Index-based je spolehlivější než {x: labelString, y: ...} na kategorické ose.)
  const labelTimes = history.map((p) => p.date.getTime());
  const oldestT = labelTimes[0];
  const newestT = labelTimes[labelTimes.length - 1] + 86400000; // +1 den tolerance
  const investmentSeries = new Array(labels.length).fill(null);
  const investmentMeta = new Array(labels.length).fill(null); // pro tooltip
  for (const inv of investments) {
    const t = parseLocalDate(inv.date).getTime();
    if (t < oldestT - 86400000 || t > newestT) continue;
    let bestIdx = 0;
    let bestDiff = Math.abs(labelTimes[0] - t);
    for (let i = 1; i < labelTimes.length; i++) {
      const d = Math.abs(labelTimes[i] - t);
      if (d < bestDiff) { bestIdx = i; bestDiff = d; }
    }
    investmentSeries[bestIdx] = prices[bestIdx];
    investmentMeta[bestIdx] = inv;
  }

  if (chartInstance) chartInstance.destroy();

  chartInstance = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: `Cena (${currency})`,
          data: prices,
          borderColor: '#f7931a',
          backgroundColor: 'rgba(247,147,26,0.08)',
          fill: true,
          pointRadius: 0,
          borderWidth: 2,
          tension: 0.05,
        },
        {
          label: '200d SMA',
          data: smaSeries,
          borderColor: '#60a5fa',
          backgroundColor: 'transparent',
          borderDash: [5, 4],
          pointRadius: 0,
          borderWidth: 1.5,
        },
        {
          label: 'Investice',
          data: investmentSeries,
          backgroundColor: '#2dd4bf',
          borderColor: 'transparent',
          pointBackgroundColor: '#2dd4bf',
          pointBorderColor: '#2dd4bf',
          pointRadius: 7,
          pointHoverRadius: 9,
          pointStyle: 'triangle',
          showLine: false,
          spanGaps: false,
        },
      ],
    },
    options: {
      responsive: true,
      interaction: { mode: 'index', intersect: false },
      scales: {
        x: {
          grid: { color: 'rgba(255,255,255,0.05)' },
          ticks: {
            color: '#8b95a3',
            maxTicksLimit: 12,
            autoSkip: true,
          },
        },
        y: {
          grid: { color: 'rgba(255,255,255,0.05)' },
          ticks: {
            color: '#8b95a3',
            callback: (v) => formatShortMoney(v, currency),
          },
        },
      },
      plugins: {
        legend: {
          labels: { color: '#e4e8ed', boxWidth: 14, font: { size: 11 } },
        },
        tooltip: {
          backgroundColor: '#232b35',
          borderColor: '#2c3540',
          borderWidth: 1,
          titleColor: '#e4e8ed',
          bodyColor: '#e4e8ed',
          filter: (item) => item.parsed.y != null,
          callbacks: {
            label: (ctx) => {
              const base = `${ctx.dataset.label}: ${formatMoney(ctx.parsed.y, currency)}`;
              if (ctx.dataset.label === 'Investice') {
                const inv = investmentMeta[ctx.dataIndex];
                if (inv) {
                  return [
                    `📅 ${formatDateCs(inv.date)}`,
                    `💰 Vklad: ${formatMoney(inv.amount, inv.currency)}`,
                    `📈 Cena BTC: ${formatMoney(ctx.parsed.y, currency)}`,
                    `₿ Získáno: ${inv.coinsReceived.toFixed(8)} BTC`,
                  ];
                }
              }
              return base;
            },
          },
        },
      },
    },
  });
}

function rolling200(prices) {
  const out = new Array(prices.length).fill(null);
  let sum = 0;
  const win = 200;
  for (let i = 0; i < prices.length; i++) {
    sum += prices[i];
    if (i >= win) sum -= prices[i - win];
    if (i >= win - 1) out[i] = sum / win;
  }
  return out;
}

function formatMoney(v, currency) {
  if (v == null) return '—';
  return new Intl.NumberFormat('cs-CZ', { maximumFractionDigits: 0 }).format(v) + ' ' + currency;
}

function formatDate(d) {
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  return `${day}.${month}.${String(d.getFullYear()).slice(2)}`;
}

function formatDateCs(dateStr) {
  const d = parseLocalDate(dateStr);
  return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}`;
}

// "2026-05-18" → Date v LOKÁLNÍ TZ (ne UTC), aby se den nepřevracel přes půlnoc.
function parseLocalDate(s) {
  if (s instanceof Date) return s;
  const [y, m, d] = String(s).split('-').map(Number);
  return new Date(y, m - 1, d);
}

function formatShortMoney(v, currency) {
  if (v == null) return '—';
  if (Math.abs(v) >= 1_000_000) return (v / 1_000_000).toFixed(1) + 'M';
  if (Math.abs(v) >= 1_000) return (v / 1_000).toFixed(0) + 'k';
  return v.toFixed(0);
}
