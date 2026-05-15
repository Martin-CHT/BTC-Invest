# ₿ BTC Invest – chytré DCA

Webová aplikace pro **maximalizaci efektivity DCA** (Dollar Cost Averaging) investování do Bitcoinu a dalších kryptoměn. Doporučuje, kolik investovat v daném intervalu, na základě matematického modelu a AI analýzy.

## Jak to funguje

Klasické DCA = kupuj pravidelně stejnou částku bez ohledu na cenu. Tato aplikace ji **chytře vychyluje**: když je BTC levný, doporučí investovat víc; když je drahý, jen zlomek plánu.

### Matematický model

Kombinuje dvě ověřené metriky:

1. **Mayer Multiple** = aktuální cena ÷ 200denní klouzavý průměr.
   Historický medián ≈ 1.4. Pod 1 = silně podhodnocený, nad 2.4 = nadhodnocený.
2. **Z-score** logaritmu ceny za 365 dní – statistická míra, jak je aktuální cena výjimečná oproti průměru.

Výsledný **multiplikátor** v rozsahu **0.2× – 2.5×** škáluje rovnoměrnou DCA částku. Vzorec:

```
factor = clamp( (1.4 / mayer)^k × exp(-z × 0.25),  0.2,  2.5 )
```

kde `k` je citlivost (1.5 default, můžeš v UI měnit 0.5–3.0).

### AI vrstva

Souběžně s matematickým modelem se ptáme dvou LLM:

- **Groq** (llama-3.3-70b nebo Mixtral) – velmi rychlá inference
- **Google Gemini** (2.5-flash nebo pro)

Obě dostanou stejný kontext (Mayer, z-score, plán, historie) a vrátí 4 stručné body: pohled na trh, souhlas/úprava doporučení, riziko, konkrétní rada.

## Spuštění

Aplikace je čistě statická – stačí otevřít `index.html` v prohlížeči. Doporučení:

1. **VS Code + Live Server** (rozšíření) – pravý klik na `index.html` → "Open with Live Server".
2. **Python**:  `python -m http.server 8000` ve složce, pak http://localhost:8000
3. Nebo dvojklikem na `index.html` (omezení: některé funkce mohou hlásit CORS).

## API klíče

Aplikace běží zcela v prohlížeči. Klíče se ukládají do `localStorage` a posílají přímo na Groq/Gemini API. **Nikam jinam neodcházejí**, ale POZOR:

- Nepublikujte tento adresář na sdílené hostingy – kdokoli by viděl klíče.
- Pro produkční nasazení by bylo potřeba backend proxy.

### Kde získat klíče (zdarma)

- **Groq**: https://console.groq.com → API Keys (free tier, generous limity)
- **Gemini**: https://aistudio.google.com → Get API key (free tier)

CoinGecko (cenové data) **nepotřebuje klíč** – free tier ~30 req/min stačí pro běžné použití.

## Struktura

```
BTC-Invest/
├── index.html         # UI
├── css/styles.css     # styly (dark theme)
├── js/
│   ├── app.js         # hlavní orchestrace
│   ├── storage.js     # localStorage wrapper
│   ├── api-btc.js     # CoinGecko – ceny + historie
│   ├── algorithm.js   # Mayer Multiple + z-score + smart DCA
│   ├── ai.js          # Groq + Gemini
│   └── chart-view.js  # graf (Chart.js přes CDN)
└── README.md
```

## Rozšíření o další assety

V **Nastavení → Vlastní assety** přidej CoinGecko ID (např. `ethereum`, `solana`, `cardano`). Asset se objeví v selectoru. Algoritmus i graf fungují identicky.

Pro akcie/forexy by stačilo přidat další modul vedle `api-btc.js` (např. `api-stocks.js` s Alpha Vantage / Yahoo Finance) a registrovat ho v `assetSelect`. Architektura je na to připravená.

## Disclaimer

Toto **není finanční poradenství**. Doporučení slouží jako analytický pomocník, finální rozhodnutí je vždy na tobě. Krypto je vysoce volatilní – nikdy neinvestuj víc, než si můžeš dovolit ztratit.
