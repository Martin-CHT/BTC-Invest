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
  applyStateToUI();
  $('#startDate').value = state.plan?.startDate || todayISO();
  refresh();
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function populateAssets() {
  const sel = $('#assetSelect');
  sel.innerHTML = '';
  const all = [...DEFAULT_ASSETS, ...(state.customAssets || [])];
  // unique
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
  $('#displayCurrency').value = state.settings.displayCurrency;
  $('#groqModel').textContent = state.settings.groqModel;
  $('#geminiModel').textContent = state.settings.geminiModel;
  renderCustomAssetsList();
  renderHistory();
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
    if (lastContext) updateMathView(); // přepočítat
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

  // Auto-fill startDate if empty
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

  // Načti cenu když uživatel změní datum nebo měnu
  $('#invDate').addEventListener('change', updateInvPrice);
  $('#invCurrency').addEventListener('change', updateInvPrice);

  $('#investmentModal').addEventListener('close', (e) => {
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
  const currentPrice = lastContext?.currentPrice;
  let sumAmount = 0, sumBTC = 0, sumCurrent = 0;
  const sorted = [...state.investments].sort((a, b) => a.date.localeCompare(b.date));
  for (const inv of sorted) {
    const current = currentPrice ? inv.coinsReceived * currentPrice : null;
    const pnl = current != null ? current - inv.amount : null;
    sumAmount += inv.amount;
    sumBTC += inv.coinsReceived;
    if (current != null) sumCurrent += current;

    const mayer = lastContext?.history
      ? mayerAtDate(lastContext.history, inv.priceAtBuy, inv.date)
      : null;

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${formatDate(inv.date)}</td>
      <td>${fmtMoney(inv.amount, inv.currency)}</td>
      <td>${fmtMoney(inv.priceAtBuy, inv.currency)}</td>
      <td>${inv.coinsReceived.toFixed(8)}</td>
      <td>${mayer != null ? mayer.toFixed(2) : '—'}</td>
      <td>${current != null ? fmtMoney(current, inv.currency) : '—'}</td>
      <td class="${pnl > 0 ? 'pnl-pos' : pnl < 0 ? 'pnl-neg' : ''}">${pnl != null ? fmtSignedMoney(pnl, inv.currency) : '—'}</td>
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
  $('#sumAmount').textContent = fmtMoney(sumAmount, state.plan?.currency || 'CZK');
  $('#sumBTC').textContent = sumBTC.toFixed(8);
  $('#sumCurrent').textContent = currentPrice ? fmtMoney(sumCurrent, state.plan?.currency || 'CZK') : '—';
  const totalPnl = sumCurrent - sumAmount;
  $('#sumPnl').innerHTML = currentPrice
    ? `<span class="${totalPnl > 0 ? 'pnl-pos' : totalPnl < 0 ? 'pnl-neg' : ''}">${fmtSignedMoney(totalPnl, state.plan?.currency || 'CZK')}</span>`
    : '—';
}

function mayerAtDate(history, price, dateStr) {
  // Najdi index nejbližšího dne
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
  return price / (sum / 200);
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

// --- Main refresh: načte data, spočítá vše, překreslí ---
async function refresh() {
  if (!state.plan) {
    $('#recoBody').innerHTML = '<p class="muted">Vytvoř plán, abys viděl doporučení.</p>';
    $('#priceTicker').textContent = '—';
    return;
  }
  const plan = state.plan;
  const curLower = plan.currency.toLowerCase();

  try {
    $('#priceTicker').textContent = '… načítám';
    const [priceData, history] = await Promise.all([
      getCurrentPrice(plan.asset, ['usd', 'czk']),
      getHistory(plan.asset, curLower, 365),
    ]);
    const currentPrice = priceData[curLower];
    const change24h = priceData.change24h;

    $('#priceTicker').textContent = `${fmtMoney(currentPrice, plan.currency)} (${change24h >= 0 ? '+' : ''}${change24h.toFixed(2)}%)`;
    $('#priceTicker').className = 'ticker ' + (change24h >= 0 ? 'up' : 'down');

    const prices = history.map((h) => h.price);
    const metrics = computeMetrics(prices, currentPrice, state.settings.sensitivity);
    const reco = computeRecommendation({
      plan,
      investments: state.investments.filter((i) => i.currency === plan.currency),
      multiplier: metrics.multiplier,
    });

    const history12mPctChange = ((currentPrice - prices[0]) / prices[0]) * 100;

    lastContext = {
      asset: plan.asset,
      currency: plan.currency,
      currentPrice,
      sma200: metrics.sma200,
      mayer: metrics.mayer,
      zScore: metrics.zScore,
      multiplier: metrics.multiplier,
      verdict: metrics.verdict,
      plan,
      recommendation: reco,
      history,
      history12mPctChange,
    };

    renderRecommendation(reco, metrics, plan);
    updateMathView();
    renderChart($('#priceChart'), { history, investments: state.investments, currency: plan.currency });
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
