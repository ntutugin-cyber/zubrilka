/* Точка входа: шапка, вкладки, горячие клавиши, события. */
import { $, $$, on } from './core/utils.js';
import * as store from './core/store.js';
import { settings } from './core/store.js';
import * as sfx from './core/sfx.js';
import * as fx from './core/fx.js';
import * as toast from './ui/toast.js';
import * as modals from './ui/modals.js';
import * as lightbox from './ui/lightbox.js';
import * as library from './screens/library.js';
import * as constructor from './screens/constructor.js';
import * as trainer from './screens/trainer.js';

const TABS = ['library', 'construct', 'train'];
let tab = 'library';

function switchTab(t) {
  if (!TABS.includes(t)) t = 'library';
  tab = t;
  store.setLastTab(t);
  for (const s of TABS) {
    const sec = $('#screen-' + s);
    sec.hidden = s !== t;
    if (s === t) { sec.classList.remove('enter'); void sec.offsetWidth; sec.classList.add('enter'); }
  }
  $$('.nav-btn').forEach(b => {
    const active = b.dataset.tab === t;
    b.classList.toggle('active', active);
    b.setAttribute('aria-current', active ? 'page' : 'false');
  });
  window.scrollTo({ top: 0 });
}

function syncHeader() {
  $('#chip-batch').textContent = 'порция: ' + (settings.batch || 'все');
  const sb = $('#btn-sound');
  sb.querySelector('use').setAttribute('href', settings.sound ? '#i-vol' : '#i-vol-x');
  sb.setAttribute('aria-pressed', String(settings.sound));
  sb.title = settings.sound ? 'Звук включён — выключить' : 'Звук выключен — включить';
  sb.classList.toggle('muted', !settings.sound);
}

async function boot() {
  store.load();
  toast.init($('#toasts'));
  modals.init($('#modal-root'));
  lightbox.init($('#lightbox-root'));
  fx.init($('#fx-canvas'));
  sfx.init();

  library.init($('#screen-library'));
  await constructor.init($('#screen-construct'));
  trainer.init($('#screen-train'));

  $$('.nav-btn').forEach(b => b.addEventListener('click', () => { switchTab(b.dataset.tab); sfx.play('tick'); }));
  $('#btn-sound').addEventListener('click', () => {
    store.setSetting('sound', !settings.sound);
    if (settings.sound) sfx.play('select');
  });
  $('#chip-batch').addEventListener('click', () => modals.settingsModal());
  $('#btn-settings').addEventListener('click', () => modals.settingsModal());
  $('#logo').addEventListener('click', () => switchTab('library'));

  on('navigate', d => switchTab(d.tab));
  on('settings', syncHeader);
  on('progress', () => library.refresh());
  on('decks-changed', () => library.refresh());
  on('storage-error', () => toast.warn('Не удалось сохранить данные: хранилище браузера переполнено'));

  document.addEventListener('keydown', e => {
    if (modals.isOpen() || lightbox.isOpen()) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.target.closest('input,textarea,select,[contenteditable="true"]')) return;
    if (tab === 'train') trainer.handleKey(e);
  });
  /* не даём браузеру открыть файл, если промахнулись мимо дропзоны */
  document.addEventListener('dragover', e => e.preventDefault());
  document.addEventListener('drop', e => e.preventDefault());

  syncHeader();
  switchTab(store.state.lastTab);
}

boot();