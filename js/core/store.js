/* Состояние: настройки, per-card счётчики (верно / мимо / «не знаю»),
   прогресс, свои колоды, черновик конструктора.
   persist=true → localStorage; persist=false → только память. */
import { debounce, emit, deepClone } from './utils.js';
import * as idb from './idb.js';

const KEY = 'zubrilka.v1';
const DEFAULTS = {
  settings: { batch: 20, goal: 2, shuffle: false, sound: true, persist: true },
  progress: {}, decks: [], draft: null, lastTab: 'library'
};

export const state = deepClone(DEFAULTS);
export const settings = state.settings;
let quotaWarned = false;

const blank = () => ({ cards: {}, learned: [], errors: {}, best: 0 });
const num = v => Math.max(0, Number(v) || 0);
const normStat = s => ({ ok: num(s?.ok), bad: num(s?.bad), skip: num(s?.skip) });
const goalNow = () => Math.max(1, Math.min(9, Number(settings.goal) || 1));

/* learned — производный кэш: карточка выучена, когда верных ответов >= цели */
function syncLearned(p) {
  const g = goalNow();
  p.cards = p.cards || {};
  p.learned = Object.keys(p.cards).filter(k => p.cards[k].ok >= g);
}
function syncAll() { for (const p of Object.values(state.progress)) syncLearned(p); }

/* совместимость со старым форматом {learned:[], errors:{}} */
function migrate() {
  const g = goalNow();
  for (const p of Object.values(state.progress)) {
    if (!p.cards) {
      const cards = {};
      for (const k of p.learned || []) cards[k] = { ok: g, bad: num((p.errors || {})[k]), skip: 0 };
      for (const [k, n] of Object.entries(p.errors || {})) if (!cards[k]) cards[k] = { ok: 0, bad: num(n), skip: 0 };
      p.cards = cards;
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
  if (k === 'goal') v = Math.max(1, Math.min(9, Number(v) || 1));
  state.settings[k] = v;
  if (k === 'goal') { syncAll(); save(); }
  else if (k === 'persist') {
    if (!v) { try { localStorage.removeItem(KEY); } catch { /* ok */ } idb.clearAll(); }
    else persistNow();
  } else save();
  emit('settings', state.settings);
}

/* ── прогресс и счётчики карточек ── */
export const getProgress = id => state.progress[id] || blank();
export const getGoal = goalNow;

export function getCard(deckId, key) {
  return normStat(state.progress[deckId]?.cards?.[key]);
}

export function setCard(deckId, key, stat) {
  const p = state.progress[deckId] ||= blank();
  p.cards[key] = normStat(stat);
  p.updated = Date.now();
  syncLearned(p);
  save();
  return p.cards[key];
}

export function markLearned(deckId, key) {
  const cur = getCard(deckId, key);
  return setCard(deckId, key, { ...cur, ok: Math.max(cur.ok, goalNow()) });
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