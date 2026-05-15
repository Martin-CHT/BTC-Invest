/**
 * AI integrace – Groq (OpenAI-kompatibilní API) a Google Gemini.
 * Oba endpointy podporují CORS pro volání přímo z prohlížeče.
 *
 * Pozn.: API klíče se posílají z prohlížeče. To je OK pro single-user lokální
 * aplikaci, ale klíče se nikdy nesmějí commitovat ani publikovat.
 */

function buildPrompt(ctx) {
  const { asset, currency, currentPrice, sma200, mayer, zScore, multiplier,
          plan, recommendation, history12mPctChange } = ctx;

  return `Jsi investiční poradce specializovaný na kryptoměny a DCA (Dollar Cost Averaging) strategie.
Mluv česky, stručně, věcně. Nedávej finanční záruky, jen analytický pohled.

KONTEXT:
- Asset: ${asset}
- Aktuální cena: ${formatMoney(currentPrice, currency)}
- 200denní klouzavý průměr: ${formatMoney(sma200, currency)}
- Mayer Multiple: ${mayer.toFixed(2)} (historický medián ≈ 1.4)
- Z-score log-ceny za 365 dní: ${zScore.toFixed(2)}
- Vývoj ceny za 12 měsíců: ${history12mPctChange > 0 ? '+' : ''}${history12mPctChange.toFixed(1)} %

PLÁN UŽIVATELE:
- Celkový budget: ${formatMoney(plan.totalBudget, plan.currency)} na ${plan.period}
- Interval: ${plan.interval}
- Doposud investováno: ${formatMoney(recommendation.spent, plan.currency)}
- Zbývá k investování: ${formatMoney(recommendation.remaining, plan.currency)}
- Zbývá intervalů: ${recommendation.intervalsRemaining}

MATEMATICKÝ MODEL ZNAMENÁ:
- Doporučená částka pro tento interval: ${formatMoney(recommendation.suggested, plan.currency)}
- Multiplikátor vůči rovnoměrnému DCA: ${multiplier.toFixed(2)}×

POŽADAVEK:
Vrať max 4 krátké body (každý 1-2 věty):
1. Tvůj pohled na aktuální situaci trhu
2. Souhlas/nesouhlas s doporučenou částkou + případná úprava
3. Klíčové riziko, na které dát pozor
4. Konkrétní investiční rada (např. rozdělit nákup, čekat na úroveň…)

Neopakuj data z kontextu, jdi rovnou k analýze. Žádný úvod ani závěr.`;
}

function formatMoney(value, currency) {
  return new Intl.NumberFormat('cs-CZ', { maximumFractionDigits: 0 }).format(value) + ' ' + currency;
}

/**
 * Volání Groq API (OpenAI-kompatibilní /chat/completions).
 */
export async function askGroq({ apiKey, model, ctx }) {
  if (!apiKey) throw new Error('Chybí Groq API klíč');
  const prompt = buildPrompt(ctx);

  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.5,
      max_tokens: 600,
    }),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`Groq ${res.status}: ${errText.slice(0, 200)}`);
  }
  const data = await res.json();
  return data.choices?.[0]?.message?.content?.trim() || '(prázdná odpověď)';
}

/**
 * Volání Google Gemini API.
 */
export async function askGemini({ apiKey, model, ctx }) {
  if (!apiKey) throw new Error('Chybí Gemini API klíč');
  const prompt = buildPrompt(ctx);

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.5, maxOutputTokens: 600 },
    }),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`Gemini ${res.status}: ${errText.slice(0, 200)}`);
  }
  const data = await res.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  return text?.trim() || '(prázdná odpověď)';
}
