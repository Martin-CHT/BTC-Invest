const KEY = 'btc-invest:v1';

const defaultState = {
  plan: null,
  investments: [],
  settings: {
    groqKey: '',
    groqModel: 'llama-3.3-70b-versatile',
    geminiKey: '',
    geminiModel: 'gemini-2.5-flash',
    displayCurrency: 'CZK',
    sensitivity: 1.5,
  },
  customAssets: [],
};

export function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return structuredClone(defaultState);
    const parsed = JSON.parse(raw);
    return {
      ...structuredClone(defaultState),
      ...parsed,
      settings: { ...defaultState.settings, ...(parsed.settings || {}) },
    };
  } catch (err) {
    console.error('storage.load failed', err);
    return structuredClone(defaultState);
  }
}

export function save(state) {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch (err) {
    console.error('storage.save failed', err);
  }
}

export function clearAll() {
  localStorage.removeItem(KEY);
}

export function exportJSON() {
  const state = load();
  return JSON.stringify(state, null, 2);
}

export function importJSON(text) {
  const parsed = JSON.parse(text);
  if (typeof parsed !== 'object' || parsed === null) throw new Error('Invalid JSON');
  save({ ...structuredClone(defaultState), ...parsed });
}
