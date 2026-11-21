/* Точка входа: шапка, вкладки, горячие клавиши, события.
   Первый экран не блокируется восстановлением конструктора. */
import { $, $$, on, esc } from './core/utils.js';
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

function fatal(err) {
  console.error(err);
  const m = document.querySelector('main');
  if (!m) return;
  m.insertAdjacentHTML('afterbegin',
    `<div class="notice boot-error">
       <svg class="ic"><use href="#i-help"/></svg>
       <div><b>Приложение запустилось не полностью.</b><br>
         ${esc(String(err?.message || err))}<br>
         Проверьте, что все файлы проекта сохранены целиком, и перезагрузите страницу.
         <div style="margin-top:10px"><button class="btn btn-primary btn-sm" id="boot-reload">Перезагрузить</button></div>
       </div>
     </div>`);
  $('#boot-reload')?.addEventListener('click', () => location.reload());
}

function boot() {
  store.load();
  toast.init($('#toasts'));
  modals.init($('#modal-root'));
  lightbox.init($('#lightbox-root'));
  fx.init($('#fx-canvas'));
  sfx.init();

  library.init($('#screen-library'));
  trainer.init($('#screen-train'));
  /* черновик и медиа конструктора восстанавливаем в фоне */
  constructor.init($('#screen-construct')).catch(e => {
    console.warn('Конструктор:', e);
    toast.warn('Черновик конструктора восстановлен не полностью');
  });

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
  on('progress', d => library.refresh(d));
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

try { boot(); } catch (e) { fatal(e); }