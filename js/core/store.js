/* Состояние: настройки, прогресс, свои колоды, черновик конструктора.
   persist=true → localStorage; persist=false → только память. */
import { debounce, emit, deepClone } from './utils.js';
import * as idb from './idb.js';

const KEY = 'zubrilka.v1';
const DEFAULTS = {
  settings: { batch: 20, shuffle: false, sound: true, persist: true },
  progress: {}, decks: [], draft: null, lastTab: 'library'
};

export const state = deepClone(DEFAULTS);
export const settings = state.settings;
let quotaWarned = false;

export function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return;
    const d = JSON.parse(raw);
    Object.assign(state.settings, d.settings || {});
    state.progress = d.progress || {};
    state.decks = Array.isArray(d.decks) ? d.decks : [];
    state.draft = d.draft || null;
    state.lastTab = d.lastTab || 'library';
  } catch (e) { console.warn('Не удалось прочитать сохранение:', e); }
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

/* ── прогресс по колодам ── */
const blank = () => ({ learned: [], errors: {}, best: 0 });
export const getProgress = id => state.progress[id] || blank();

export function markLearned(id, key) {
  const p = state.progress[id] ||= blank();
  if (!p.learned.includes(key)) p.learned.push(key);
  p.updated = Date.now();
  save();
}
export function mergeErrors(id, map) {
  const p = state.progress[id] ||= blank();
  for (const [k, n] of Object.entries(map)) p.errors[k] = (p.errors[k] || 0) + n;
  save();
}
export function setBest(id, v) {
  const p = state.progress[id] ||= blank();
  p.best = Math.max(p.best || 0, v);
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