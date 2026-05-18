import * as storage from './storage.js';
import { getCurrentPrice, getHistory, getPriceAt, DEFAULT_ASSETS } from './api-btc.js';
import { computeMetrics, computeRecommendation,
         PERIOD_LABEL, INTERVAL_LABEL } from './algorithm.js';
import { askGroq, askGemini } from './ai.js';
import { renderChart } from './chart-view.js';

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

let state = storage.load();
let lastContext = null; // pro AI - drží spočítané metriky

// --- Init ---
function init() {
  populateAssets();
  wireForm();
  wireSettings();
  wireHistory();
  wireAI();
  wireHelp();
  applyStateToUI();
  $('#startDate').value = state.plan?.startDate || todayISO();
  refresh();
}

function displayCurrency() {
  return (state.settings.displayCurrency || 'USD').toUpperCase();
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function populateAssets() {
  const sel = $('#assetSelect');
  sel.innerHTML = '';
  const all = [...DEFAULT_ASSETS, ...(state.customAssets || [])];
  const seen = new Set();
  for (const a of all) {
    if (seen.has(a.id)) continue;
    seen.add(a.id);
    const opt = document.createElement('option');
    opt.value = a.id;
    opt.textContent = a.label;
    sel.appendChild(opt);
  }
}

function applyStateToUI() {
  if (state.plan) {
    $('#assetSelect').value = state.plan.asset || 'bitcoin';
    $('#budget').value = state.plan.totalBudget;
    $('#currency').value = state.plan.currency;
    $('#period').value = state.plan.period;
    $('#interval').value = state.plan.interval;
    $('#startDate').value = state.plan.startDate;
  }
  $('#sensitivity').value = state.settings.sensitivity;
  $('#sensitivityLabel').textContent = `${state.settings.sensitivity} – ${sensitivityWord(state.settings.sensitivity)}`;
  $('#groqKey').value = state.settings.groqKey || '';
  $('#geminiKey').value = state.settings.geminiKey || '';
  $('#groqModelSelect').value = state.settings.groqModel;
  $('#geminiModelSelect').value = state.settings.geminiModel;
  $('#displayCurrency').value = displayCurrency();
  $('#groqModel').textContent = state.settings.groqModel;
  $('#geminiModel').textContent = state.settings.geminiModel;
  renderCustomAssetsList();
  applyDisplayCurrencyLabels();
  renderHistory();
}

function applyDisplayCurrencyLabels() {
  const c = displayCurrency();
  $('#thPriceBTC').textContent = `Cena BTC (${c})`;
  $('#thValueNow').textContent = `Hodnota dnes (${c})`;
  $('#thPnL').textContent = `Zisk/ztráta (${c})`;
  const chartTitle = $('#chartTitle');
  if (chartTitle) {
    const assetLabel = $('#assetSelect option:checked')?.textContent || 'BTC';
    const ticker = assetLabel.split(' ')[0];
    chartTitle.innerHTML = `5. Cena ${ticker} – posledních 365 dní (${c}) <button class="help-btn" data-help="chart" type="button" title="Vysvětlivka">ⓘ</button>`;
    // Click se chytí globálním listenerem ve wireHelp() – přidávat nový tu nemusíme.
  }
}

function sensitivityWord(k) {
  if (k < 1) return 'jemná';
  if (k < 1.8) return 'střední';
  if (k < 2.5) return 'silná';
  return 'agresivní';
}

// --- Plan form ---
function wireForm() {
  $('#sensitivity').addEventListener('input', (e) => {
    const v = parseFloat(e.target.value);
    state.settings.sensitivity = v;
    $('#sensitivityLabel').textContent = `${v.toFixed(1)} – ${sensitivityWord(v)}`;
    storage.save(state);
    if (lastContext) refresh();
  });

  $('#btnSavePlan').addEventListener('click', () => {
    state.plan = readPlanFromForm();
    storage.save(state);
    $('#planStatus').textContent = '✓ Plán uložen';
    setTimeout(() => ($('#planStatus').textContent = ''), 2000);
    refresh();
  });

  $('#btnResetPlan').addEventListener('click', () => {
    if (!confirm('Smazat aktuální plán?')) return;
    state.plan = null;
    storage.save(state);
    applyStateToUI();
    refresh();
  });

  $('#btnRefresh').addEventListener('click', refresh);
  $('#btnSettings').addEventListener('click', () => $('#settingsModal').showModal());

  if (!$('#startDate').value) $('#startDate').value = todayISO();
}

function readPlanFromForm() {
  return {
    asset: $('#assetSelect').value,
    totalBudget: parseFloat($('#budget').value) || 0,
    currency: $('#currency').value,
    period: $('#period').value,
    interval: $('#interval').value,
    startDate: $('#startDate').value || todayISO(),
  };
}

// --- Settings ---
function wireSettings() {
  const modal = $('#settingsModal');

  // Změna měny přímo v selectu – okamžitě aplikovat (bez čekání na zavření).
  $('#displayCurrency').addEventListener('change', () => {
    state.settings.displayCurrency = $('#displayCurrency').value;
    storage.save(state);
    applyDisplayCurrencyLabels();
    refresh();
  });

  modal.addEventListener('close', () => {
    state.settings.groqKey = $('#groqKey').value.trim();
    state.settings.geminiKey = $('#geminiKey').value.trim();
    state.settings.groqModel = $('#groqModelSelect').value;
    state.settings.geminiModel = $('#geminiModelSelect').value;
    state.settings.displayCurrency = $('#displayCurrency').value;
    storage.save(state);
    $('#groqModel').textContent = state.settings.groqModel;
    $('#geminiModel').textContent = state.settings.geminiModel;
  });

  $('#btnAddAsset').addEventListener('click', () => {
    const id = $('#newAssetId').value.trim().toLowerCase();
    const label = $('#newAssetLabel').value.trim() || id;
    if (!id) return;
    state.customAssets = state.customAssets || [];
    if (state.customAssets.some((a) => a.id === id)) {
      toast('Asset již existuje', 'error');
      return;
    }
    state.customAssets.push({ id, label });
    storage.save(state);
    $('#newAssetId').value = '';
    $('#newAssetLabel').value = '';
    populateAssets();
    renderCustomAssetsList();
    toast('Asset přidán', 'success');
  });

  $('#btnClearAll').addEventListener('click', () => {
    if (!confirm('Opravdu vymazat všechna data (plán, investice, nastavení)?')) return;
    storage.clearAll();
    state = storage.load();
    populateAssets();
    applyStateToUI();
    refresh();
    toast('Data vymazána', 'success');
  });
}

function renderCustomAssetsList() {
  const ul = $('#customAssetsList');
  ul.innerHTML = '';
  for (const a of state.customAssets || []) {
    const li = document.createElement('li');
    li.innerHTML = `<span><b>${a.label}</b> <code>${a.id}</code></span>`;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = '✕';
    btn.title = 'Odebrat';
    btn.addEventListener('click', () => {
      state.customAssets = state.customAssets.filter((x) => x.id !== a.id);
      storage.save(state);
      populateAssets();
      renderCustomAssetsList();
    });
    li.appendChild(btn);
    ul.appendChild(li);
  }
}

// --- History (investments) ---
function wireHistory() {
  $('#btnAddInvestment').addEventListener('click', async () => {
    $('#invDate').value = todayISO();
    $('#invAmount').value = '';
    $('#invCurrency').value = state.plan?.currency || 'CZK';
    try {
      const price = await getCurrentPrice(state.plan?.asset || 'bitcoin');
      const cur = $('#invCurrency').value.toLowerCase();
      $('#invPrice').value = Math.round(price[cur]);
    } catch (e) {
      $('#invPrice').value = '';
    }
    $('#investmentModal').showModal();
  });

  $('#invDate').addEventListener('change', updateInvPrice);
  $('#invCurrency').addEventListener('change', updateInvPrice);

  $('#investmentModal').addEventListener('close', () => {
    if ($('#investmentModal').returnValue !== 'save') return;
    const amount = parseFloat($('#invAmount').value);
    const price = parseFloat($('#invPrice').value);
    const date = $('#invDate').value;
    const currency = $('#invCurrency').value;
    if (!amount || !price || !date) {
      toast('Vyplň všechna pole', 'error');
      return;
    }
    state.investments.push({
      id: crypto.randomUUID(),
      date,
      amount,
      currency,
      priceAtBuy: price,
      coinsReceived: amount / price,
      asset: state.plan?.asset || 'bitcoin',
    });
    storage.save(state);
    renderHistory();
    refresh();
    toast('Investice zaznamenána', 'success');
  });

  $('#btnExport').addEventListener('click', () => {
    const blob = new Blob([storage.exportJSON()], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `btc-invest-${todayISO()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  });

  $('#btnImport').addEventListener('click', () => $('#importFile').click());
  $('#importFile').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const text = await file.text();
      storage.importJSON(text);
      state = storage.load();
      applyStateToUI();
      refresh();
      toast('Data naimportována', 'success');
    } catch (err) {
      toast('Chyba importu: ' + err.message, 'error');
    }
    e.target.value = '';
  });
}

async function updateInvPrice() {
  try {
    const asset = state.plan?.asset || 'bitcoin';
    const cur = $('#invCurrency').value.toLowerCase();
    const date = $('#invDate').value;
    const price = await getPriceAt(asset, cur, date);
    $('#invPrice').value = Math.round(price);
  } catch (e) {
    /* nech beze změny */
  }
}

function renderHistory() {
  const tbody = $('#historyBody');
  const tfoot = $('#historyFoot');
  tbody.innerHTML = '';
  if (state.investments.length === 0) {
    tbody.innerHTML = `<tr class="empty"><td colspan="8" class="muted">Zatím žádné investice</td></tr>`;
    tfoot.hidden = true;
    return;
  }
  tfoot.hidden = false;

  const disp = displayCurrency();
  const dispLower = disp.toLowerCase();
  const priceNowDisp = lastContext?.currentPrices?.[dispLower] ?? null;
  const dispHistory = lastContext?.history ?? null;

  // Akumulátory: vklad zůstává v původní měně (CZK), zbytek v display currency.
  const sumByCcy = {};
  let sumBTC = 0;
  let sumInvestDisp = 0;
  let sumCurrentDisp = 0;

  const sorted = [...state.investments].sort((a, b) => a.date.localeCompare(b.date));
  for (const inv of sorted) {
    const priceAtBuyDisp = dispHistory ? priceAtDate(dispHistory, inv.date) : null;
    const investDisp = priceAtBuyDisp != null ? inv.coinsReceived * priceAtBuyDisp : null;
    const currentDisp = priceNowDisp != null ? inv.coinsReceived * priceNowDisp : null;
    const pnlDisp = (currentDisp != null && investDisp != null) ? currentDisp - investDisp : null;

    sumByCcy[inv.currency] = (sumByCcy[inv.currency] || 0) + inv.amount;
    sumBTC += inv.coinsReceived;
    if (investDisp != null) sumInvestDisp += investDisp;
    if (currentDisp != null) sumCurrentDisp += currentDisp;

    const mayer = dispHistory ? mayerAtDate(dispHistory, inv.date) : null;

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${formatDate(inv.date)}</td>
      <td>${fmtMoney(inv.amount, inv.currency)}</td>
      <td>${priceAtBuyDisp != null ? fmtMoney(priceAtBuyDisp, disp) : '—'}</td>
      <td>${inv.coinsReceived.toFixed(8)}</td>
      <td>${mayer != null ? mayer.toFixed(2) : '—'}</td>
      <td>${currentDisp != null ? fmtMoney(currentDisp, disp) : '—'}</td>
      <td class="${pnlDisp > 0 ? 'pnl-pos' : pnlDisp < 0 ? 'pnl-neg' : ''}">${pnlDisp != null ? fmtSignedMoney(pnlDisp, disp) : '—'}</td>
      <td class="row-actions"><button title="Smazat" data-id="${inv.id}">🗑</button></td>
    `;
    tr.querySelector('button').addEventListener('click', () => {
      if (!confirm('Smazat tuto investici?')) return;
      state.investments = state.investments.filter((i) => i.id !== inv.id);
      storage.save(state);
      renderHistory();
      refresh();
    });
    tbody.appendChild(tr);
  }

  const amountParts = Object.entries(sumByCcy).map(([c, v]) => fmtMoney(v, c));
  $('#sumAmount').textContent = amountParts.join(' + ');
  $('#sumBTC').textContent = sumBTC.toFixed(8);
  $('#sumCurrent').textContent = priceNowDisp != null ? fmtMoney(sumCurrentDisp, disp) : '—';
  const totalPnlDisp = sumCurrentDisp - sumInvestDisp;
  $('#sumPnl').innerHTML = (priceNowDisp != null && dispHistory)
    ? `<span class="${totalPnlDisp > 0 ? 'pnl-pos' : totalPnlDisp < 0 ? 'pnl-neg' : ''}">${fmtSignedMoney(totalPnlDisp, disp)}</span>`
    : '—';
}

function priceAtDate(history, dateStr) {
  const target = new Date(dateStr).getTime();
  let idx = 0;
  let bestDiff = Math.abs(history[0].date.getTime() - target);
  for (let i = 1; i < history.length; i++) {
    const d = Math.abs(history[i].date.getTime() - target);
    if (d < bestDiff) { idx = i; bestDiff = d; }
  }
  return history[idx].price;
}

function mayerAtDate(history, dateStr) {
  const target = new Date(dateStr).getTime();
  let idx = 0;
  let bestDiff = Math.abs(history[0].date.getTime() - target);
  for (let i = 1; i < history.length; i++) {
    const d = Math.abs(history[i].date.getTime() - target);
    if (d < bestDiff) { idx = i; bestDiff = d; }
  }
  if (idx < 200) return null;
  let sum = 0;
  for (let j = idx - 200; j < idx; j++) sum += history[j].price;
  return history[idx].price / (sum / 200);
}

// --- AI ---
function wireAI() {
  $('#btnAskAI').addEventListener('click', async () => {
    if (!lastContext) {
      toast('Nejdřív načti data plánu', 'error');
      return;
    }
    const ctx = lastContext;
    askGroqAndRender(ctx);
    askGeminiAndRender(ctx);
  });
}

async function askGroqAndRender(ctx) {
  const pane = $('#groqBody').parentElement;
  const body = $('#groqBody');
  pane.classList.add('loading');
  pane.classList.remove('error');
  body.innerHTML = '<p class="muted">⏳ Groq přemýšlí…</p>';
  try {
    const text = await askGroq({
      apiKey: state.settings.groqKey,
      model: state.settings.groqModel,
      ctx,
    });
    body.innerHTML = `<div class="ai-text">${escapeHtml(text)}</div>`;
  } catch (err) {
    pane.classList.add('error');
    body.innerHTML = `<p class="muted">⚠ ${escapeHtml(err.message)}</p>`;
  } finally {
    pane.classList.remove('loading');
  }
}

async function askGeminiAndRender(ctx) {
  const pane = $('#geminiBody').parentElement;
  const body = $('#geminiBody');
  pane.classList.add('loading');
  pane.classList.remove('error');
  body.innerHTML = '<p class="muted">⏳ Gemini přemýšlí…</p>';
  try {
    const text = await askGemini({
      apiKey: state.settings.geminiKey,
      model: state.settings.geminiModel,
      ctx,
    });
    body.innerHTML = `<div class="ai-text">${escapeHtml(text)}</div>`;
  } catch (err) {
    pane.classList.add('error');
    body.innerHTML = `<p class="muted">⚠ ${escapeHtml(err.message)}</p>`;
  } finally {
    pane.classList.remove('loading');
  }
}

// --- Main refresh ---
// BTC cena, SMA, Mayer, z-score, graf, historie → v displayCurrency (default USD).
// Plán/budget/doporučení → v měně plánu (typicky CZK).
async function refresh() {
  if (!state.plan) {
    $('#recoBody').innerHTML = '<p class="muted">Vytvoř plán, abys viděl doporučení.</p>';
    $('#priceTicker').textContent = '—';
    return;
  }
  const plan = state.plan;
  const disp = displayCurrency();
  const dispLower = disp.toLowerCase();

  try {
    $('#priceTicker').textContent = '… načítám';
    const [priceData, historyDisp] = await Promise.all([
      getCurrentPrice(plan.asset, ['usd', 'czk']),
      getHistory(plan.asset, dispLower, 365),
    ]);
    const priceShown = priceData[dispLower];
    const change24h = priceData.change24h;

    $('#priceTicker').textContent = `${fmtMoney(priceShown, disp)} (${change24h >= 0 ? '+' : ''}${change24h.toFixed(2)}%)`;
    $('#priceTicker').className = 'ticker ' + (change24h >= 0 ? 'up' : 'down');

    const prices = historyDisp.map((h) => h.price);
    const metrics = computeMetrics(prices, priceShown, state.settings.sensitivity);
    const reco = computeRecommendation({
      plan,
      investments: state.investments.filter((i) => i.currency === plan.currency),
      multiplier: metrics.multiplier,
    });

    const history12mPctChange = ((priceShown - prices[0]) / prices[0]) * 100;

    lastContext = {
      asset: plan.asset,
      currency: disp,
      currentPrice: priceShown,
      currentPrices: { usd: priceData.usd, czk: priceData.czk },
      sma200: metrics.sma200,
      mayer: metrics.mayer,
      zScore: metrics.zScore,
      multiplier: metrics.multiplier,
      verdict: metrics.verdict,
      plan,
      recommendation: reco,
      history: historyDisp,
      history12mPctChange,
    };

    applyDisplayCurrencyLabels();
    renderRecommendation(reco, metrics, plan);
    updateMathView();
    renderChart($('#priceChart'), { history: historyDisp, investments: state.investments, currency: disp });
    renderHistory();
  } catch (err) {
    console.error(err);
    $('#priceTicker').textContent = '⚠ Chyba';
    toast('Chyba načítání: ' + err.message, 'error');
  }
}

function renderRecommendation(reco, metrics, plan) {
  const { verdict } = metrics;
  $('#recoBody').innerHTML = `
    <div class="reco-context">
      <span class="reco-tag ${verdict.tag}">${verdict.label}</span>
      <span class="muted">${verdict.reason}</span>
    </div>
    <div class="reco-main">${fmtMoney(reco.suggested, plan.currency)}</div>
    <div class="reco-context">
      <div>📅 Další interval: <b>${formatDate(reco.nextIntervalDate.toISOString().slice(0, 10))}</b></div>
      <div>📊 Plán: ${fmtMoney(plan.totalBudget, plan.currency)} na ${PERIOD_LABEL[plan.period]}, ${INTERVAL_LABEL[plan.interval]}</div>
      <div>💰 Investováno ${fmtMoney(reco.spent, plan.currency)} / Zbývá ${fmtMoney(reco.remaining, plan.currency)}</div>
      <div>⏱ Interval ${reco.intervalsElapsed} z ${reco.totalIntervals} · rovnoměrné DCA by bylo ${fmtMoney(reco.basePerInterval, plan.currency)}</div>
      ${reco.isOver ? '<div style="color:var(--warning)">⚠ Plán už skončil – uprav datum startu nebo nastav nový plán.</div>' : ''}
    </div>
  `;
}

function updateMathView() {
  if (!lastContext) return;
  const c = lastContext;
  $('#mPrice').textContent = fmtMoney(c.currentPrice, c.currency);
  $('#mSMA').textContent = fmtMoney(c.sma200, c.currency);
  $('#mMayer').textContent = c.mayer.toFixed(2);
  $('#mZ').textContent = c.zScore.toFixed(2);
  $('#mMult').textContent = c.multiplier.toFixed(2) + '×';
  $('#mVerdict').textContent = c.verdict.label;
}

// --- Help system ---
function wireHelp() {
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('.help-btn');
    if (!btn) return;
    e.preventDefault();
    e.stopPropagation();
    openHelp(btn.dataset.help);
  });
}

function openHelp(key) {
  const content = HELP_CONTENT[key] || HELP_CONTENT.plan;
  $('#helpTitle').textContent = content.title;
  $('#helpBody').innerHTML = content.body;
  $('#helpModal').showModal();
}

const HELP_CONTENT = {
  plan: {
    title: '1. Plán investice',
    body: `
      <p>Zde nastavíš svůj DCA plán. Aplikace tě bude doprovázet po celou dobu a v každém intervalu ti řekne, kolik investovat.</p>
      <h3>Pole</h3>
      <ul>
        <li><b>Asset</b> – kterou kryptoměnu kupuješ. Default: Bitcoin. Další lze přidat v Nastavení.</li>
        <li><b>Celkový budget</b> – kolik celkem chceš investovat za zvolené období (typicky v CZK).</li>
        <li><b>Období</b> – jak dlouho bude plán běžet (týden / měsíc / kvartál / rok).</li>
        <li><b>Interval investování</b> – jak často investuješ (denně / týdně / 14 dní / měsíčně).</li>
        <li><b>Citlivost (k)</b> – jak silně algoritmus reaguje na cenové výkyvy. Viz vlastní vysvětlivka u slideru.</li>
        <li><b>Datum startu</b> – kdy plán začíná. Obvykle dnes.</li>
      </ul>
      <h3>Příklad</h3>
      <p>Budget <b>1000 CZK</b>, období <b>1 měsíc</b>, interval <b>týdně</b> = 4 intervaly po průměru 250 CZK. Aplikace tuto částku vychýlí: při levném BTC poradí investovat víc, při drahém jen zlomek.</p>
    `,
  },

  reco: {
    title: '2. Doporučení pro aktuální interval',
    body: `
      <p>Hlavní výstup aplikace: kolik právě teď investovat, abys maximalizoval efektivitu DCA.</p>
      <h3>Co která položka znamená</h3>
      <ul>
        <li><b>Barevný štítek (Verdikt)</b> – 5stupňová klasifikace trhu: <i>Silný nákup → Nákup → Držet plán → Opatrnost → Drahé – vyčkat</i>. Vychází z Mayer Multiple a z-score (sekce 3).</li>
        <li><b>Hlavní cifra (CZK)</b> – doporučená částka pro tento interval. Vzorec: <code>(zbývající budget ÷ zbývající intervaly) × multiplikátor</code>. Při levném BTC dostaneš víc než průměr, při drahém zlomek.</li>
        <li><b>📅 Další interval</b> – kdy se podle plánu znova podívat a investovat.</li>
        <li><b>📊 Plán</b> – připomenutí, co jsi zadal (celkový budget + frekvence).</li>
        <li><b>💰 Investováno / Zbývá</b> – aktuální čerpání plánu. Když v některém intervalu investuješ méně, „úspora“ se rozprostře do následujících intervalů.</li>
        <li><b>⏱ Interval N z M</b> – kolikátý interval z plánu právě probíhá. „Rovnoměrné DCA“ vedle ukazuje, kolik bys investoval bez vychylování – referenční bod, vůči kterému multiplikátor pracuje.</li>
      </ul>
      <h3>Logika</h3>
      <p>Pokud Mayer = 0.8 (BTC levné) a multiplikátor = 1.8×, tak místo rovnoměrných 250 Kč doporučí <b>450 Kč</b>. Když naopak Mayer = 2.5 (BTC drahé) a multiplikátor = 0.3×, doporučí jen <b>75 Kč</b>. Plán se vždy vejde do zbývajícího budgetu.</p>
    `,
  },

  math: {
    title: '3. Matematický model',
    body: `
      <p>Aplikace kombinuje dvě ověřené metriky používané v kryptokomunitě a statisticky vychyluje pravidelnou DCA částku.</p>
      <h3>Metriky</h3>
      <ul>
        <li><b>Cena BTC</b> – aktuální spotová cena z CoinGecko (v měně dle Nastavení).</li>
        <li><b>200d SMA</b> (Simple Moving Average) – aritmetický průměr z denních closing cen za posledních 200 dní. „Čára trendu“, kolem které cena dlouhodobě osciluje.</li>
        <li><b>Mayer Multiple</b> = <code>cena ÷ 200d SMA</code>. Slavná BTC metrika od Trace Mayera. Historický medián ≈ 1.4:
          <ul>
            <li><b>&lt; 1.0</b> – výrazně pod průměrem, historicky výborná vstupní úroveň</li>
            <li><b>1.0 – 1.8</b> – normální pásmo, klasické DCA</li>
            <li><b>1.8 – 2.4</b> – nad průměrem, opatrnost</li>
            <li><b>&gt; 2.4</b> – přehřátí, historicky často krátce před korekcí</li>
          </ul>
        </li>
        <li><b>Z-score (log)</b> – počet směrodatných odchylek, o kolik je <code>ln(aktuální cena)</code> nad/pod průměrem ln-cen za 365 dní. Statistická míra extrémnosti:
          <ul>
            <li><code>z = 0</code> – průměr roku</li>
            <li><code>z = +2</code> – top 2.5 % roku (drahé)</li>
            <li><code>z = −2</code> – bottom 2.5 % roku (levné)</li>
          </ul>
        </li>
        <li><b>Multiplikátor</b> – faktor 0.2× – 2.5×, kterým se vynásobí rovnoměrná DCA částka. Pod 1× = méně než klasické DCA, nad 1× = více.</li>
        <li><b>Verdikt</b> – slovní klasifikace odvozená z Mayer + z-score.</li>
      </ul>
      <h3>Vzorec multiplikátoru</h3>
      <p><code>multiplikátor = clamp( (1.4 / mayer)<sup>k</sup> × exp(−z × 0.25),  0.2,  2.5 )</code></p>
      <p>kde <code>k</code> je citlivost.</p>
      <h3>Poznámka k měnám</h3>
      <p>Mayer Multiple a z-score jsou <b>bezrozměrné</b> (ratio resp. počet sigma), takže jejich hodnota je stejná, ať počítáš v USD nebo CZK. Zobrazená cena a SMA jsou v měně podle Nastavení.</p>
    `,
  },

  ai: {
    title: '4. AI doporučení (Groq + Gemini)',
    body: `
      <p>Souběžně s deterministickým matematickým modelem se ptáme dvou LLM, aby přidaly kontext a alternativní pohled.</p>
      <h3>Modely</h3>
      <ul>
        <li><b>Groq</b> – velmi rychlá inference (často &lt; 1 s). Default <code>llama-3.3-70b-versatile</code>.</li>
        <li><b>Gemini</b> – Google model, výborný v dlouhém kontextu. Default <code>gemini-2.5-flash</code>.</li>
      </ul>
      <h3>Co AI dostane</h3>
      <p>Oba modely dostanou identický kontext: aktuální cenu, 200d SMA, Mayer Multiple, z-score, multiplikátor, tvůj plán, kolik už jsi investoval a kolik intervalů zbývá.</p>
      <h3>Co vrátí</h3>
      <p>4 stručné body:</p>
      <ol>
        <li>Pohled na aktuální tržní situaci</li>
        <li>Souhlas/úprava doporučené částky</li>
        <li>Klíčové riziko, na které dát pozor</li>
        <li>Konkrétní investiční rada</li>
      </ol>
      <h3>API klíče</h3>
      <p>Pro spuštění potřebuješ klíče v <b>Nastavení</b>:</p>
      <ul>
        <li><b>Groq</b>: <code>console.groq.com</code> → API Keys (zdarma, free tier)</li>
        <li><b>Gemini</b>: <code>aistudio.google.com</code> → Get API key (zdarma, free tier)</li>
      </ul>
      <p>Klíče se uloží jen do tvého <code>localStorage</code> a posílají se přímo na Groq/Gemini API. Nikam jinam.</p>
    `,
  },

  chart: {
    title: '5. Graf cenového vývoje',
    body: `
      <p>Vizualizace cen za posledních 365 dní v měně dle Nastavení.</p>
      <h3>Vrstvy v grafu</h3>
      <ul>
        <li><b>Oranžová plná čára</b> – denní cena BTC.</li>
        <li><b>Modrá čárkovaná čára</b> – 200denní klouzavý průměr (SMA). Kolem ní cena dlouhodobě osciluje.</li>
        <li><b>Tyrkysové trojúhelníky</b> – tvé zaznamenané investice, umístěné na ceně v den nákupu.</li>
      </ul>
      <h3>Jak to číst</h3>
      <p>Kdy je cena <b>pod modrou čarou</b>, Mayer Multiple je &lt; 1 → algoritmus doporučuje investovat víc. Když je výrazně <b>nad ní</b>, algoritmus utlumí. Trojúhelníky ti ukazují, jak konzistentně jsi nakupoval napříč různými cenovými úrovněmi.</p>
    `,
  },

  history: {
    title: '6. Historie investic',
    body: `
      <p>Seznam tvých zaznamenaných investic a jejich aktuální stav.</p>
      <h3>Sloupce</h3>
      <ul>
        <li><b>Datum</b> – kdy jsi investici provedl.</li>
        <li><b>Vklad</b> – kolik jsi reálně poslal (v CZK, jak vkládáš).</li>
        <li><b>Cena BTC</b> – cena BTC v den nákupu (v zobrazované měně dle Nastavení).</li>
        <li><b>Získané BTC</b> – kolik BTC jsi za vklad dostal.</li>
        <li><b>Mayer</b> – Mayer Multiple v daný den (ratio cena ÷ 200d SMA). Pomáhá retrospektivně vidět, jak „dobře“ jsi tehdy nakoupil.</li>
        <li><b>Hodnota dnes</b> – aktuální hodnota daného nákupu = získané BTC × dnešní cena.</li>
        <li><b>Zisk/ztráta</b> – P&L vůči ekvivalentu vkladu v den nákupu. Vyjádřeno v zobrazované měně.</li>
        <li><b>🗑</b> – smazání záznamu.</li>
      </ul>
      <h3>Pozn. k P&L v různých měnách</h3>
      <p>Pokud zobrazuješ v USD a vkládal jsi v CZK, P&L se počítá vůči <i>USD ekvivalentu vkladu v den nákupu</i> (získané BTC × USD cena v daný den). To je matematicky správně, protože BTC drží hodnotu v USD, ne CZK.</p>
      <h3>Export/Import</h3>
      <p>Tlačítka pro zálohu/obnovu všech dat (plán + investice + nastavení) do/z JSON souboru.</p>
    `,
  },

  sensitivity: {
    title: 'Citlivost (k) – jak ji nastavit',
    body: `
      <p>Citlivost <code>k</code> řídí, <b>jak silně algoritmus reaguje na odchylku Mayer Multiple od historického průměru</b> (≈ 1.4). Čím vyšší <code>k</code>, tím razantněji se mění doporučená částka.</p>
      <h3>Doporučené hodnoty</h3>
      <table class="table">
        <thead><tr><th>k</th><th>Charakter</th><th>Kdy použít</th></tr></thead>
        <tbody>
          <tr><td><b>0.5 – 0.9</b><br><small class="muted">jemná</small></td><td>Téměř klasické DCA, malá odchylka od průměru</td><td>Konzervativní investor; preferuješ pravidelnost před optimalizací. Vhodné pro dlouhý horizont (3+ roky).</td></tr>
          <tr><td><b>1.0 – 1.7</b><br><small class="muted">střední (default)</small></td><td>Vyvážený poměr – při levné ceně investice mírně zvýší, při drahé mírně sníží</td><td>Většina lidí. Solidní kompromis. Doporučená volba, pokud nemáš silný názor.</td></tr>
          <tr><td><b>1.8 – 2.4</b><br><small class="muted">silná</small></td><td>Razantní vychýlení; pod průměrem může multiplikátor dosáhnout 2×+, nad ním klesnout na 0.3×</td><td>Aktivní investor, který věří v mean-reversion BTC. Vyžaduje trpělivost – při dlouhotrvajícím býčím trhu budeš kupovat málo.</td></tr>
          <tr><td><b>2.5 – 3.0</b><br><small class="muted">agresivní</small></td><td>Extrémní reakce; téměř „all-in při dně, neutrácet ve špičce“</td><td>Spekulativní přístup. Vyžaduje silnou víru v cyklickou povahu BTC. Pozor: při rostoucím trendu bez korekce zůstaneš s velkou rezervou.</td></tr>
        </tbody>
      </table>
      <h3>Praktický příklad</h3>
      <p>Budget 1000 Kč/měsíc, týdně, 4 intervaly = rovnoměrné DCA 250 Kč/týden. Při Mayer = 0.7 (BTC ~30 % pod 200d SMA) bude doporučení:</p>
      <ul>
        <li><b>k = 0.5</b>: ~350 Kč (1.4× průměr)</li>
        <li><b>k = 1.5</b>: ~500 Kč (2.0× průměr)</li>
        <li><b>k = 2.5</b>: ~625 Kč (cap na 2.5×)</li>
      </ul>
      <p style="background:rgba(251,191,36,0.1);border-left:3px solid var(--warning);padding:0.55rem 0.75rem;border-radius:4px;margin-top:1rem;">⚠ <b>Vyšší k = vyšší volatilita doporučení.</b> Při silně býčím trhu mohou agresivní hodnoty vést k tomu, že na konci období zůstane velký nevyčerpaný budget. Pokud tě „nevyčerpaný budget“ irituje, drž se k = 1.0–1.5.</p>
    `,
  },
};

// --- Utils ---
function fmtMoney(v, currency) {
  return new Intl.NumberFormat('cs-CZ', { maximumFractionDigits: 0 }).format(v) + ' ' + currency;
}
function fmtSignedMoney(v, currency) {
  return (v > 0 ? '+' : '') + fmtMoney(v, currency);
}
function formatDate(dateStr) {
  const d = new Date(dateStr);
  return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}`;
}
function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
function toast(msg, type = '') {
  const t = $('#toast');
  t.textContent = msg;
  t.className = 'toast ' + type;
  t.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => (t.hidden = true), 3000);
}

init();
