/* Состояние + правило выучивания.
   Карточка: need — сколько верных ПОДРЯД нужно, run — текущая серия по карточке,
   ok/bad/skip — всего верных / мимо / «не знаю», done — выучена (больше не появляется).
   Первый показ: need=1. Ошибка или «Не знаю»: run=0, need=min(15, need*2). */
import { debounce, emit, deepClone } from './utils.js';
import * as idb from './idb.js';

const KEY = 'zubrilka.v1';

export const RULE = { start: 1, mult: 2, cap: 15 };
export const LADDER = (() => {
  const a = [RULE.start];
  while (a[a.length - 1] < RULE.cap) a.push(Math.min(RULE.cap, a[a.length - 1] * RULE.mult));
  return a; // [1, 2, 4, 8, 15]
})();

const DEFAULTS = {
  settings: { batch: 20, shuffle: false, sound: true, persist: true },
  progress: {}, decks: [], draft: null, lastTab: 'library'
};

export const state = deepClone(DEFAULTS);
export const settings = state.settings;
let quotaWarned = false;

const blank = () => ({ cards: {}, learned: [], errors: {}, best: 0 });
const num = v => Math.max(0, Number(v) || 0);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

const normStat = s => {
  const need = clamp(Math.round(num(s?.need)) || RULE.start, RULE.start, RULE.cap);
  return {
    need,
    run: clamp(Math.round(num(s?.run)), 0, need),
    ok: num(s?.ok),
    bad: num(s?.bad),
    skip: num(s?.skip),
    done: !!s?.done
  };
};

function syncLearned(p) {
  p.cards = p.cards || {};
  p.learned = Object.keys(p.cards).filter(k => p.cards[k].done);
}

/* совместимость со старыми форматами: {learned:[],errors:{}} и {ok,bad,skip}+goal */
function migrate() {
  for (const p of Object.values(state.progress)) {
    p.cards = p.cards || {};
    const oldLearned = new Set(p.learned || []);
    for (const [k, v] of Object.entries(p.cards)) {
      if (v && typeof v.need === 'number') { p.cards[k] = normStat(v); continue; }
      const ok = num(v?.ok), bad = num(v?.bad), skip = num(v?.skip);
      const need = bad ? clamp(Math.pow(RULE.mult, bad), RULE.start, RULE.cap) : RULE.start;
      p.cards[k] = { need, run: 0, ok, bad, skip, done: oldLearned.has(k) };
    }
    for (const [k, n] of Object.entries(p.errors || {})) {
      if (!p.cards[k]) p.cards[k] = {
        need: clamp(Math.pow(RULE.mult, num(n)), RULE.start, RULE.cap),
        run: 0, ok: 0, bad: num(n), skip: 0, done: false
      };
    }
    p.errors = p.errors || {};
    p.best = num(p.best);
    syncLearned(p);
  }
}

export function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const d = JSON.parse(raw);
      Object.assign(state.settings, d.settings || {});
      delete state.settings.goal;
      state.progress = d.progress || {};
      state.decks = Array.isArray(d.decks) ? d.decks : [];
      state.draft = d.draft || null;
      state.lastTab = d.lastTab || 'library';
    }
  } catch (e) { console.warn('Не удалось прочитать сохранение:', e); }
  migrate();
}

function persistNow() {
  if (!state.settings.persist) return;
  try { localStorage.setItem(KEY, JSON.stringify(state)); }
  catch { if (!quotaWarned) { quotaWarned = true; emit('storage-error'); } }
}
export const save = debounce(persistNow, 250);

export function setSetting(k, v) {
  state.settings[k] = v;
  if (k === 'persist') {
    if (!v) { try { localStorage.removeItem(KEY); } catch { /* ok */ } idb.clearAll(); }
    else persistNow();
  } else save();
  emit('settings', state.settings);
}

/* ── прогресс ── */
export const getProgress = id => state.progress[id] || blank();
export const getCard = (deckId, key) => normStat(state.progress[deckId]?.cards?.[key]);

export function setCard(deckId, key, stat) {
  const p = state.progress[deckId] ||= blank();
  p.cards[key] = normStat(stat);
  p.updated = Date.now();
  syncLearned(p); save();
  return p.cards[key];
}

/* kind: 'ok' | 'bad' | 'skip' — единственное место, где живёт правило */
export function answerCard(deckId, key, kind) {
  const p = state.progress[deckId] ||= blank();
  const before = normStat(p.cards[key]);
  const s = { ...before };
  if (kind === 'ok') {
    s.ok++; s.run++;
    if (s.run >= s.need) s.done = true;
  } else {
    s.bad++;
    if (kind === 'skip') s.skip++;
    s.run = 0;
    s.need = Math.min(RULE.cap, s.need * RULE.mult);
    s.done = false;
  }
  const saved = setCard(deckId, key, s);
  return {
    before, stat: saved,
    learned: saved.done,
    grew: saved.need > before.need,
    atCap: saved.need >= RULE.cap,
    remaining: Math.max(0, saved.need - saved.run)
  };
}

export function markLearned(deckId, key) {
  const cur = getCard(deckId, key);
  return setCard(deckId, key, { ...cur, run: cur.need, done: true });
}

export function mergeErrors(id, map) {
  const p = state.progress[id] ||= blank();
  for (const [k, n] of Object.entries(map)) p.errors[k] = num(p.errors[k]) + num(n);
  save();
}
export function setBest(id, v) {
  const p = state.progress[id] ||= blank();
  p.best = Math.max(num(p.best), num(v));
  save();
}
export function resetDeckProgress(id) { delete state.progress[id]; save(); emit('progress'); }
export function resetAllProgress() { state.progress = {}; save(); emit('progress'); }

/* ── свои колоды ── */
export const listDecks = () => state.decks;
export const getDeck = id => state.decks.find(d => d.id === id);
export function upsertDeck(rec) {
  const i = state.decks.findIndex(d => d.id === rec.id);
  if (i >= 0) state.decks[i] = { ...state.decks[i], ...rec };
  else state.decks.unshift(rec);
  save(); emit('decks-changed');
}
export function removeDeck(id) {
  state.decks = state.decks.filter(d => d.id !== id);
  save(); emit('decks-changed');
}

/* ── черновик конструктора / вкладка ── */
export const getDraft = () => state.draft;
export function setDraft(d) { state.draft = d; save(); }
export function setLastTab(t) { state.lastTab = t; save(); }