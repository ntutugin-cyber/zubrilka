/* Библиотека: мгновенный список из манифеста, фоновая догрузка XML
   с очередью, таймаутами, повтором и видимым прогрессом; страницы по 24 колоды. */
import { $, esc, uid, slug, cardKey, emit, download, plural, on } from '../core/utils.js';
import * as store from '../core/store.js';
import * as xml from '../core/xml.js';
import * as media from '../core/media.js';
import * as idb from '../core/idb.js';
import { buildZip } from '../core/zip.js';
import { play } from '../core/sfx.js';
import * as toast from '../ui/toast.js';
import * as modals from '../ui/modals.js';
import * as trainer from './trainer.js';
import * as constructor from './constructor.js';

const PAGE = 24;
const CONC = (matchMedia('(max-width:760px)').matches || (navigator.hardwareConcurrency || 4) <= 4) ? 3 : 5;
const sleep = ms => new Promise(r => setTimeout(r, ms));

let root = null;
let manifest = [];
let items = [], byId = new Map();
let q = '', sort = 'title';
let shown = { ready: PAGE, mine: PAGE };
let manifestState = 'idle';        // idle | loading | ready | error | file
let manifestError = '';
let queue = [], workers = 0;
let visible = true, uiRaf = null, searchTimer = null;

/* ── загрузка текста с таймаутом и повтором ── */
async function fetchText(url, ms = 12000, tries = 2) {
  let last;
  for (let a = 0; a < tries; a++) {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), ms);
    try {
      const r = await fetch(url, { signal: ac.signal });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return await r.text();
    } catch (e) {
      last = e;
      if (a < tries - 1) await sleep(450 * (a + 1));
    } finally { clearTimeout(t); }
  }
  throw last;
}

const learnedOf = deck => {
  const set = new Set(store.getProgress(deck.id).learned);
  return deck.cards.filter(c => set.has(cardKey(c))).length;
};

export function init(el) {
  root = el;
  visible = !root.hidden;
  renderShell();
  bind();
  rebuild();
  renderGrids();
  new MutationObserver(() => {
    const v = !root.hidden;
    if (v && !visible) renderGrids();
    visible = v;
  }).observe(root, { attributes: true, attributeFilter: ['hidden'] });
  on('progress', d => onProgress(d));
  void loadManifest();
}

export function refresh(detail) {
  if (detail?.deckId) { onProgress(detail); return; }
  rebuild();
  if (visible) renderGrids(); else scheduleUI();
}

function onProgress(d) {
  const it = d?.deckId ? byId.get(d.deckId) : null;
  if (it?.deck) {
    it.learned = learnedOf(it.deck);
    if (visible) paint(it);
    scheduleUI();
  } else if (visible) renderGrids();
}

/* ── модели ── */
function rebuild() {
  const prev = new Map(items.map(i => [i.id + '|' + i.sig, i]));
  const ready = manifest.map(d => {
    const sig = d.path;
    const old = prev.get(d.id + '|' + sig);
    return old || {
      id: d.id, kind: 'ready', sig, path: d.path,
      title: d.title || d.id, desc: d.description || '',
      emoji: d.emoji || '📚', accent: d.accent || 'violet', tags: d.tags || [],
      count: Number.isFinite(d.count) ? d.count : null,
      status: 'idle', deck: null, xmlText: null, error: null, learned: 0, promise: null
    };
  });
  const mine = store.listDecks().map(rec => {
    const sig = String(rec.updated || rec.created || 0) + ':' + rec.xml.length;
    const old = prev.get(rec.id + '|' + sig);
    return old || {
      id: rec.id, kind: 'mine', sig, rec,
      title: rec.title, desc: 'Своя колода · обновлена ' + new Date(rec.updated || rec.created || Date.now()).toLocaleDateString('ru-RU'),
      emoji: '🗂️', accent: 'lime', tags: ['моя колода'], count: null,
      status: 'idle', deck: null, xmlText: rec.xml, error: null, learned: 0, promise: null
    };
  });
  items = [...ready, ...mine];
  byId = new Map(items.map(i => [i.id, i]));
  queue = items.filter(i => i.status === 'idle');
  pump();
}

function pump() {
  while (workers < CONC && queue.length) {
    const it = queue.shift();
    if (it.status !== 'idle') continue;
    workers++;
    loadItem(it).catch(() => {}).finally(() => { workers--; scheduleUI(); pump(); });
  }
  if (!workers && !queue.length && manifestState === 'ready') {
    scheduleUI();
    if (visible) renderGrids();
  }
}

async function loadItem(it) {
  if (it.status === 'ready') return it.deck;
  it.status = 'loading'; it.error = null;
  paint(it); scheduleUI();
  try {
    let text, parsed;
    if (it.kind === 'ready') {
      const url = new URL('decks/' + it.path, location.href);
      text = await fetchText(url);
      parsed = xml.parse(text);
      media.setBase(it.id, url);
    } else {
      await sleep(0);
      text = it.rec.xml;
      parsed = xml.parse(text);
    }
    it.xmlText = text;
    it.deck = { id: it.id, title: parsed.title || it.title, cards: parsed.cards, source: it.kind === 'ready' ? 'library' : 'custom' };
    it.title = it.deck.title;
    it.count = parsed.cards.length;
    it.learned = learnedOf(it.deck);
    it.status = 'ready';
  } catch (e) {
    it.status = 'error';
    it.error = e?.name === 'AbortError' ? 'таймаут загрузки' : String(e?.message || 'ошибка').slice(0, 70);
  }
  paint(it); scheduleUI();
  return it.deck;
}

function ensureDeck(it) {
  if (it.status === 'ready') return Promise.resolve(it.deck);
  if (it.promise) return it.promise;
  it.promise = loadItem(it).then(d => {
    if (!d) throw new Error(it.error || 'колода не загружена');
    return d;
  }).finally(() => { it.promise = null; });
  return it.promise;
}

/* ── манифест ── */
async function loadManifest() {
  if (location.protocol === 'file:') { manifestState = 'file'; showNotice('file'); renderLoadPanel(); return; }
  manifestState = 'loading'; renderLoadPanel(); renderGrids();
  try {
    const text = await fetchText(new URL('decks/index.json', location.href), 10000, 2);
    const man = JSON.parse(text);
    manifest = Array.isArray(man.decks) ? man.decks : [];
    manifestState = 'ready'; manifestError = '';
    $('#lib-notice', root).innerHTML = '';
    rebuild(); renderGrids(); scheduleUI();
  } catch (e) {
    manifestState = 'error';
    manifestError = e?.name === 'AbortError' ? 'сервер не ответил вовремя' : String(e?.message || e);
    showNotice('manifest'); renderLoadPanel(); renderGrids();
  }
}

function showNotice(kind) {
  $('#lib-notice', root).innerHTML = kind === 'file'
    ? `<div class="notice"><svg class="ic"><use href="#i-help"/></svg><div>
         Вы открыли файл напрямую (<b>file://</b>) — готовые колоды из папки <b>decks/</b> так не загружаются.
         Запустите локальный сервер в папке проекта: <code>python -m http.server 8080</code>
         или <code>node tools/serve.mjs</code>, затем откройте <code>http://localhost:8080</code>.
         Импорт своих файлов и конструктор работают и без сервера.</div></div>`
    : `<div class="notice"><svg class="ic"><use href="#i-help"/></svg><div>
         Не удалось прочитать <b>decks/index.json</b> (${esc(manifestError)}).
         Проверьте, что сервер запущен из корня проекта, и нажмите «Повторить».
         Свои колоды можно импортировать кнопками выше.</div></div>`;
}

/* ── каркас ── */
function renderShell() {
  root.innerHTML =
    `<div class="hero">
       <div class="hero-left">
         <span class="eyebrow mono">тренажёр карточек · xml · офлайн</span>
         <h1>Зубри до <span class="grad-text">автоматизма</span>.</h1>
         <p class="hero-sub">Загрузи колоду с вопросами, картинками и звуком — и преврати знания в рефлексы. Первый верный ответ закрывает карточку, ошибка удваивает требование.</p>
         <div class="hero-stats">
           <div class="hstat"><b id="st-decks">0</b><span>колод</span></div>
           <div class="hstat"><b id="st-cards">0</b><span>карточек</span></div>
           <div class="hstat"><b id="st-learned">0</b><span>выучено</span></div>
         </div>
       </div>
       <div class="hero-cards" aria-hidden="true">
         <div class="mini-card mc1">?</div><div class="mini-card mc2">✓</div><div class="mini-card mc3">★</div>
       </div>
     </div>
     <div class="lib-toolbar">
       <label class="search-box"><svg class="ic"><use href="#i-search"/></svg>
         <input id="lib-q" type="search" placeholder="Поиск колоды…" autocomplete="off"></label>
       <select id="lib-sort" class="select" title="Сортировка">
         <option value="title">По названию</option>
         <option value="progress">По прогрессу</option>
         <option value="size">По размеру</option>
       </select>
       <div class="toolbar-actions">
         <button class="btn btn-ghost" data-act="folder"><svg class="ic"><use href="#i-folder"/></svg>Открыть папку</button>
         <button class="btn btn-ghost" data-act="files"><svg class="ic"><use href="#i-upload"/></svg>Выбрать файлы</button>
         <button class="btn btn-ghost" data-act="demo"><svg class="ic"><use href="#i-sparkle"/></svg>Демо-колода</button>
         <button class="btn btn-ghost" data-act="template"><svg class="ic"><use href="#i-download"/></svg>Шаблон XML</button>
       </div>
     </div>
     <div class="dropzone" id="lib-drop" tabindex="0" role="button" aria-label="Загрузить XML и медиа">
       <svg class="ic dz-ic"><use href="#i-upload"/></svg>
       <b>Перетащите сюда .xml и медиафайлы — или папку целиком</b>
       <span class="mono">картинки и звук подхватятся автоматически · несколько xml = одна колода · дубликаты пропускаются</span>
     </div>
     <div id="lib-notice"></div>
     <div id="lib-load"></div>
     <input type="file" id="lib-files" multiple accept=".xml,image/*,audio/*" hidden>
     <input type="file" id="lib-dir" webkitdirectory hidden>
     <section class="deck-section">
       <div class="sec-head"><h2>Готовые колоды</h2><span class="chip" id="ready-count">0</span></div>
       <div class="deck-grid" id="grid-ready"></div>
       <div id="more-ready"></div>
     </section>
     <section class="deck-section">
       <div class="sec-head"><h2>Мои колоды</h2><span class="chip" id="mine-count">0</span></div>
       <div class="deck-grid" id="grid-mine"></div>
       <div id="more-mine"></div>
     </section>
     <details class="format-ref">
       <summary><svg class="ic"><use href="#i-code"/></svg>Формат XML
         <button class="btn btn-sm btn-ghost fmt-copy" type="button"><svg class="ic"><use href="#i-copy"/></svg>Копировать</button></summary>
       <pre class="code-block"><code>${esc(xml.TEMPLATE)}</code></pre>
       <p class="fmt-note">Дубликат = карточка с тем же вопросом и тем же набором вариантов (пропускается при импорте).
       Медиа: media="a.png|b.mp3" — файлы ищутся рядом с XML и в подпапке media/.
       Несколько правильных ответов: correct="true" у нескольких &lt;answer&gt;.</p>
     </details>`;
}

/* ── панель загрузки ── */
function renderLoadPanel() {
  const box = $('#lib-load', root);
  if (!box) return;
  if (manifestState === 'file') { box.innerHTML = ''; return; }
  if (manifestState === 'loading') {
    box.innerHTML = `<div class="load-panel">
      <div class="lp-head"><span class="lp-spin"></span><b>Читаю список колод…</b><span class="mono">decks/index.json</span></div>
      <div class="lp-bar indet"><i></i></div>
      <p class="lp-note mono">интерфейс уже работает — импорт и конструктор доступны</p></div>`;
    return;
  }
  if (manifestState === 'error') {
    box.innerHTML = `<div class="load-panel error">
      <div class="lp-head"><svg class="ic"><use href="#i-help"/></svg><b>Список колод не загрузился</b>
        <span class="mono">${esc(manifestError)}</span></div>
      <div class="lp-actions"><button class="btn btn-primary btn-sm" data-act="reload-manifest"><svg class="ic"><use href="#i-rotate"/></svg>Повторить</button></div>
    </div>`;
    return;
  }
  const total = items.length;
  const done = items.filter(i => i.status === 'ready' || i.status === 'error').length;
  const failed = items.filter(i => i.status === 'error').length;
  if (!total) { box.innerHTML = ''; return; }
  const pct = Math.round(done / total * 100);
  if (done < total) {
    box.innerHTML = `<div class="load-panel">
      <div class="lp-head"><span class="lp-spin"></span><b>Загружаю колоды…</b>
        <span class="mono">${done} / ${total} · ${pct}%</span></div>
      <div class="lp-bar"><i style="width:${pct}%"></i></div>
      <p class="lp-note mono">можно начинать: любая колода откроется сразу, остальные догрузятся в фоне</p></div>`;
  } else if (failed) {
    box.innerHTML = `<div class="load-panel error">
      <div class="lp-head"><svg class="ic"><use href="#i-help"/></svg><b>Загружено ${total - failed} из ${total}</b>
        <span class="mono">${failed} с ошибкой</span></div>
      <div class="lp-actions"><button class="btn btn-primary btn-sm" data-act="retry-all"><svg class="ic"><use href="#i-rotate"/></svg>Повторить неудачные</button></div>
    </div>`;
  } else {
    box.innerHTML = `<div class="load-panel done">
      <div class="lp-head"><svg class="ic"><use href="#i-check"/></svg><b>Все колоды загружены</b>
        <span class="mono">${total} ${plural(total, 'колода', 'колоды', 'колод')}</span></div></div>`;
  }
}

function updateStats() {
  const cards = items.reduce((s, i) => s + (i.count || 0), 0);
  const learned = items.reduce((s, i) => s + (i.learned || 0), 0);
  const d = $('#st-decks', root), c = $('#st-cards', root), l = $('#st-learned', root);
  if (d) d.textContent = items.length;
  if (c) c.textContent = cards;
  if (l) l.textContent = learned;
}

function scheduleUI() {
  if (uiRaf) return;
  uiRaf = requestAnimationFrame(() => { uiRaf = null; renderLoadPanel(); updateStats(); });
}

/* ── карточки ── */
function cardHtml(it) {
  const total = it.count;
  const pct = total ? Math.round(it.learned / total * 100) : 0;
  const CIRC = 106.8;
  const loading = it.status === 'loading' || it.status === 'idle';
  const countChip = total != null
    ? `<span class="chip">${total} ${plural(total, 'карточка', 'карточки', 'карточек')}</span>`
    : `<span class="chip sk-chip"><span class="mini-spin"></span>читаю…</span>`;
  const progress = it.deck
    ? `<svg viewBox="0 0 44 44" class="ring" aria-hidden="true">
         <circle cx="22" cy="22" r="17" class="ring-track"/>
         <circle cx="22" cy="22" r="17" class="ring-fill" stroke-dasharray="${CIRC}" stroke-dashoffset="${(CIRC * (1 - pct / 100)).toFixed(1)}"/>
       </svg><span class="mono dc-plabel">${it.learned}/${total} · ${pct}%</span>
       ${pct === 100 && total ? '<span class="chip chip-done">выучено 🎓</span>' : ''}`
    : `<span class="sk sk-ring"></span><span class="sk sk-line"></span>`;
  return `<article class="deck-card acc-${it.accent}" data-id="${esc(it.id)}" data-kind="${it.kind}">
    <div class="dc-top"><div class="dc-emoji">${it.emoji}</div>
      <div class="dc-tt"><h3>${esc(it.title)}</h3><p>${esc(it.desc)}</p></div></div>
    <div class="dc-chips">${countChip}
      ${it.tags.map(t => `<span class="chip chip-tag">${esc(t)}</span>`).join('')}
      ${it.status === 'error' ? `<span class="chip chip-err" title="${esc(it.error || '')}">не загрузилось</span>` : ''}
    </div>
    <div class="dc-progress">${progress}</div>
    <div class="dc-actions">
      <button class="btn btn-primary btn-sm dc-learn" data-act="learn"><svg class="ic"><use href="#i-play"/></svg>Учить</button>
      <button class="btn btn-icon btn-ghost" data-act="edit" title="Открыть в конструкторе"><svg class="ic"><use href="#i-pencil"/></svg></button>
      <button class="btn btn-icon btn-ghost" data-act="xml" title="XML-код" ${!it.xmlText ? 'disabled' : ''}><svg class="ic"><use href="#i-code"/></svg></button>
      <button class="btn btn-icon btn-ghost" data-act="zip" title="Скачать XML + медиа (.zip)"><svg class="ic"><use href="#i-box"/></svg></button>
      ${it.status === 'error' ? `<button class="btn btn-icon btn-ghost" data-act="retry" title="Загрузить снова"><svg class="ic"><use href="#i-rotate"/></svg></button>` : ''}
      ${it.kind === 'mine' ? '<button class="btn btn-icon btn-danger-ghost" data-act="del" title="Удалить колоду"><svg class="ic"><use href="#i-trash"/></svg></button>' : ''}
    </div>
    ${loading ? '<span class="dc-loadline" aria-hidden="true"></span>' : ''}
  </article>`;
}

function paint(it) {
  if (!visible || !root) return;
  const el = root.querySelector(`.deck-card[data-id="${CSS.escape(it.id)}"]`);
  if (el) el.outerHTML = cardHtml(it);
}

function view(kind) {
  let l = items.filter(i => i.kind === kind);
  if (q) {
    const nq = q.toLowerCase();
    l = l.filter(i => (i.title + ' ' + i.desc + ' ' + i.tags.join(' ')).toLowerCase().includes(nq));
  }
  const pct = i => i.count ? i.learned / i.count : 0;
  if (sort === 'title') l = [...l].sort((a, b) => a.title.localeCompare(b.title, 'ru'));
  else if (sort === 'progress') l = [...l].sort((a, b) => pct(b) - pct(a));
  else l = [...l].sort((a, b) => (b.count || 0) - (a.count || 0));
  return l;
}

const skeleton = () => `<div class="deck-card sk-card" aria-hidden="true">
  <div class="dc-top"><span class="sk sk-emoji"></span><div class="dc-tt"><span class="sk sk-title"></span><span class="sk sk-line"></span></div></div>
  <div class="dc-chips"><span class="sk sk-chip"></span><span class="sk sk-chip"></span></div>
  <div class="dc-progress"><span class="sk sk-ring"></span><span class="sk sk-line"></span></div>
  <div class="dc-actions"><span class="sk sk-btn"></span></div></div>`;

function renderGrids() {
  if (!root) return;
  for (const kind of ['ready', 'mine']) {
    const list = view(kind);
    const grid = $('#grid-' + kind, root);
    const more = $('#more-' + kind, root);
    $('#ready-count', root).textContent = view('ready').length;
    $('#mine-count', root).textContent = view('mine').length;
    const slice = list.slice(0, shown[kind]);
    if (kind === 'ready' && manifestState === 'loading' && !slice.length) {
      grid.innerHTML = Array.from({ length: 6 }, skeleton).join('');
    } else if (slice.length) {
      grid.innerHTML = slice.map(cardHtml).join('');
    } else {
      grid.innerHTML = kind === 'ready'
        ? `<div class="empty-card"><svg class="ic"><use href="#i-cards"/></svg><span>${q ? 'Ничего не найдено по запросу' : 'Готовые колоды не найдены'}</span></div>`
        : `<div class="empty-card"><svg class="ic"><use href="#i-folder"/></svg>
             <span>${q ? 'Ничего не найдено' : 'Здесь появятся ваши колоды: импорт XML, демо или собранные в конструкторе'}</span>
             <button class="btn btn-ghost btn-sm" data-act="files"><svg class="ic"><use href="#i-upload"/></svg>Импортировать XML</button></div>`;
    }
    const rest = list.length - slice.length;
    more.innerHTML = rest > 0
      ? `<div class="more-row"><button class="btn btn-ghost" data-act="more" data-kind="${kind}">
           Показать ещё ${Math.min(PAGE, rest)} <span class="mono">· осталось ${rest}</span></button></div>`
      : '';
  }
  updateStats();
  renderLoadPanel();
}

/* ── действия ── */
async function withBusy(btn, fn) {
  const old = btn.innerHTML;
  btn.disabled = true;
  btn.classList.add('is-busy');
  btn.innerHTML = '<span class="mini-spin"></span>Загрузка…';
  try { await fn(); }
  finally { btn.disabled = false; btn.classList.remove('is-busy'); btn.innerHTML = old; }
}

async function exportZip(it) {
  const deck = await ensureDeck(it);
  if (it.kind === 'mine') await media.loadFromIDB(it.id);
  const { items: files, missing } = await media.gatherBlobs(it.id, media.collectNames(deck.cards));
  const text = it.xmlText || xml.serialize({ title: it.title, cards: deck.cards });
  const blob = await buildZip([
    { name: 'deck.xml', data: text },
    ...files.map(f => ({ name: 'media/' + f.name, data: f.blob }))
  ]);
  download(blob, slug(it.title) + '.zip');
  toast.success(missing.length ? `Архив готов (без ${missing.length} медиафайлов)` : 'Архив XML + медиа готов');
}

async function deleteCustom(id) {
  const rec = store.getDeck(id);
  if (!rec) return;
  if (!await modals.confirmAction({
    title: 'Удалить колоду?',
    text: `Колода «${rec.title}» и её медиа будут удалены из браузера.`,
    ok: 'Удалить'
  })) return;
  const blobs = await idb.getByDeck(id);
  store.removeDeck(id);
  await idb.deleteDeck(id);
  media.release(id);
  rebuild(); renderGrids();
  toast.show('Колода удалена', {
    type: 'warn', timeout: 6000,
    action: { label: 'Вернуть', fn: async () => { store.upsertDeck(rec); await idb.putMany(id, blobs); rebuild(); renderGrids(); } }
  });
}

async function importFiles(entries) {
  const xmls = [], medias = [];
  for (const it of entries) {
    const name = it.path || it.name || it.blob?.name || '';
    const base = name.split('/').pop();
    if (/\.xml$/i.test(base)) xmls.push(it);
    else if (media.kindOf(base)) medias.push(it);
  }
  if (!xmls.length) { toast.error('Не найден ни один .xml файл'); return; }
  const parsed = [], errors = [];
  for (const it of xmls) {
    try { parsed.push(xml.parse(await it.blob.text())); }
    catch (e) { errors.push((it.name || 'xml') + ': ' + e.message); }
    await sleep(0);
  }
  if (!parsed.length) { toast.error('XML не разобран: ' + errors[0]); return; }
  const merged = xml.merge(parsed);
  if (!merged.cards.length) { toast.warn('Все карточки — дубликаты, колода пуста'); return; }
  const id = 'my-' + uid();
  const title = merged.title && merged.title !== 'Без названия'
    ? merged.title : 'Импорт · ' + new Date().toLocaleDateString('ru-RU');
  const text = xml.serialize({ title, cards: merged.cards });
  const mediaItems = medias.map(m => ({ name: (m.name || m.blob.name).split('/').pop(), blob: m.blob }));
  media.registerFiles(id, medias);
  await media.persistFiles(id, mediaItems);
  store.upsertDeck({ id, title, xml: text, created: Date.now(), updated: Date.now() });
  rebuild(); renderGrids(); play('learn');
  let msg = `Колода «${title}»: +${merged.cards.length} ${plural(merged.cards.length, 'карточка', 'карточки', 'карточек')}`;
  if (merged.skipped) msg += `, дубликатов пропущено: ${merged.skipped}`;
  if (mediaItems.length) msg += `, медиа: ${mediaItems.length}`;
  toast.success(msg, { timeout: 6000 });
  if (errors.length) toast.warn('Часть файлов пропущена: ' + errors.join(' · ').slice(0, 180), { timeout: 7000 });
}

async function readEntry(entry, out, path = '') {
  if (entry.isFile) {
    const f = await new Promise((res, rej) => entry.file(res, rej));
    out.push({ name: f.name, blob: f, path: path + f.name });
  } else if (entry.isDirectory) {
    const reader = entry.createReader();
    let batch;
    do {
      batch = await new Promise((res, rej) => reader.readEntries(res, rej));
      for (const e of batch) await readEntry(e, out, path + entry.name + '/');
    } while (batch.length);
  }
}

async function pickFolder() {
  if (window.showDirectoryPicker) {
    try {
      const dir = await window.showDirectoryPicker();
      const out = [];
      const walk = async (handle, path) => {
        for await (const [name, h] of handle) {
          if (h.kind === 'file') { const f = await h.getFile(); out.push({ name, blob: f, path: path + name }); }
          else await walk(h, path + name + '/');
        }
      };
      await walk(dir, '');
      if (out.length) await importFiles(out); else toast.warn('Папка пуста');
    } catch (e) { if (e?.name !== 'AbortError') $('#lib-dir', root).click(); }
  } else $('#lib-dir', root).click();
}

function makeWav(notes = [523.25, 659.25, 783.99], dur = .3) {
  const sr = 22050, n = Math.floor(notes.length * dur * sr);
  const buf = new ArrayBuffer(44 + n * 2), dv = new DataView(buf);
  const ws = (o, s) => { for (let i = 0; i < s.length; i++) dv.setUint8(o + i, s.charCodeAt(i)); };
  ws(0, 'RIFF'); dv.setUint32(4, 36 + n * 2, true); ws(8, 'WAVE');
  ws(12, 'fmt '); dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 1, true);
  dv.setUint32(24, sr, true); dv.setUint32(28, sr * 2, true); dv.setUint16(32, 2, true); dv.setUint16(34, 16, true);
  ws(36, 'data'); dv.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) {
    const ni = Math.min(Math.floor(i / (dur * sr)), notes.length - 1);
    const t = (i - ni * dur * sr) / sr;
    const env = Math.min(1, t * 60) * Math.exp(-3.2 * t);
    dv.setInt16(44 + i * 2, Math.sin(2 * Math.PI * notes[ni] * t) * env * .6 * 32767, true);
  }
  return new Blob([buf], { type: 'audio/wav' });
}

async function loadDemo() {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="240" height="160" viewBox="0 0 120 80"><rect width="120" height="80" rx="10" fill="#8f6bff"/><circle cx="40" cy="40" r="16" fill="#ffb43a"/><rect x="70" y="24" width="34" height="32" rx="6" fill="#3fd9ff"/></svg>`;
  const cards = [
    { question: 'Сколько правильных ответов может быть у карточки в «Зубрилке»?', media: [],
      answers: [
        { text: 'Только один', correct: false, media: [] },
        { text: 'Один или несколько — отметьте кружками все верные', correct: true, media: [] },
        { text: 'Ровно два', correct: false, media: [] }],
      hint: 'Загляните в конструктор: кружок можно включить у нескольких вариантов.',
      explanation: 'Если верных вариантов несколько, тренировка попросит отметить все и нажать «Проверить».' },
    { question: 'Посмотрите на картинку. Какие фигуры на ней есть?', media: ['demo-shapes.svg'],
      answers: [
        { text: 'Круг', correct: true, media: [] },
        { text: 'Прямоугольник', correct: true, media: [] },
        { text: 'Треугольник', correct: false, media: [] }],
      hint: 'Клик по картинке открывает полноэкранный просмотр с зумом.',
      explanation: 'Жёлтый круг и голубой прямоугольник. Это карточка с множественным выбором и медиа.' },
    { question: 'Прослушайте сигнал. Сколько нот прозвучало?', media: ['demo-signal.wav'],
      answers: [
        { text: 'Две', correct: false, media: [] },
        { text: 'Три', correct: true, media: [] },
        { text: 'Четыре', correct: false, media: [] }],
      hint: 'До–ми–соль. Считайте удары.',
      explanation: 'Звучат три ноты: C5, E5, G5. Аудио прикрепляется так же просто, как картинки.' },
    { question: 'Что происходит после ошибки на карточке?', media: [],
      answers: [
        { text: 'Требование удваивается: 1 → 2 → 4 → 8 → 15', correct: true, media: [] },
        { text: 'Карточка исчезает навсегда', correct: false, media: [] }],
      hint: 'Подробности — кнопка «правило» в тренировке и README.md проекта.',
      explanation: 'Первый верный ответ закрывает карточку. Ошибка обнуляет «подряд» и удваивает требование, максимум 15.' }
  ];
  const id = 'my-' + uid(), title = 'Демо · как это работает';
  const files = [
    { name: 'demo-shapes.svg', blob: new Blob([svg], { type: 'image/svg+xml' }) },
    { name: 'demo-signal.wav', blob: makeWav() }
  ];
  media.registerFiles(id, files);
  await media.persistFiles(id, files);
  store.upsertDeck({ id, title, xml: xml.serialize({ title, cards }), created: Date.now(), updated: Date.now() });
  rebuild(); renderGrids();
  toast.success('Демо-колода добавлена в «Мои колоды»');
  play('learn');
}

function bind() {
  $('#lib-q', root).addEventListener('input', e => {
    q = e.target.value.trim();
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => { shown = { ready: PAGE, mine: PAGE }; renderGrids(); }, 120);
  });
  $('#lib-sort', root).addEventListener('change', e => { sort = e.target.value; renderGrids(); });

  const onFiles = e => {
    const files = [...e.target.files];
    e.target.value = '';
    if (files.length) importFiles(files.map(f => ({ name: f.name, blob: f, path: f.webkitRelativePath || f.name })));
  };
  $('#lib-files', root).addEventListener('change', onFiles);
  $('#lib-dir', root).addEventListener('change', onFiles);

  const zone = $('#lib-drop', root);
  let depth = 0;
  root.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('dragover'); });
  root.addEventListener('dragenter', e => { e.preventDefault(); depth++; zone.classList.add('dragover'); });
  root.addEventListener('dragleave', () => { if (--depth <= 0) { depth = 0; zone.classList.remove('dragover'); } });
  root.addEventListener('drop', async e => {
    e.preventDefault(); depth = 0; zone.classList.remove('dragover');
    const entries = [...(e.dataTransfer?.items || [])].filter(i => i.kind === 'file')
      .map(i => i.webkitGetAsEntry?.()).filter(Boolean);
    if (entries.length) {
      const out = [];
      for (const en of entries) await readEntry(en, out);
      if (out.length) await importFiles(out);
    } else if (e.dataTransfer?.files.length) {
      await importFiles([...e.dataTransfer.files].map(f => ({ name: f.name, blob: f })));
    }
  });
  zone.addEventListener('click', () => $('#lib-files', root).click());
  zone.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); $('#lib-files', root).click(); }
  });

  root.addEventListener('click', async e => {
    const fmtCopy = e.target.closest('.fmt-copy');
    if (fmtCopy) { e.preventDefault(); e.stopPropagation(); modals.copyText(xml.TEMPLATE); return; }
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const act = btn.dataset.act;

    if (act === 'folder') { await pickFolder(); return; }
    if (act === 'files') { $('#lib-files', root).click(); return; }
    if (act === 'demo') { await withBusy(btn, loadDemo); return; }
    if (act === 'template') {
      download(new Blob([xml.TEMPLATE], { type: 'application/xml' }), 'zubrilka-template.xml');
      toast.success('Шаблон XML скачан'); return;
    }
    if (act === 'more') { shown[btn.dataset.kind] += PAGE; renderGrids(); return; }
    if (act === 'reload-manifest') { manifest = []; rebuild(); renderGrids(); void loadManifest(); return; }
    if (act === 'retry-all') {
      for (const i of items) if (i.status === 'error') { i.status = 'idle'; i.error = null; }
      queue = items.filter(i => i.status === 'idle');
      renderGrids(); pump(); return;
    }

    const cardEl = btn.closest('.deck-card');
    if (!cardEl) return;
    const it = byId.get(cardEl.dataset.id);
    if (!it) return;

    switch (act) {
      case 'learn':
        await withBusy(btn, async () => {
          try {
            const deck = await ensureDeck(it);
            if (it.kind === 'mine') await media.loadFromIDB(it.id);
            trainer.start(deck);
            emit('navigate', { tab: 'train' });
          } catch (err) {
            toast.error('Не удалось открыть колоду: ' + (it.error || err.message));
            paint(it);
          }
        });
        break;
      case 'edit':
        await withBusy(btn, async () => {
          try {
            const deck = await ensureDeck(it);
            await constructor.loadDeck(deck, { copy: it.kind === 'ready' });
            emit('navigate', { tab: 'construct' });
          } catch (err) { toast.error('Не удалось открыть: ' + (it.error || err.message)); paint(it); }
        });
        break;
      case 'xml': {
        try {
          const deck = await ensureDeck(it);
          modals.xmlView(it.title, it.xmlText || xml.serialize({ title: it.title, cards: deck.cards }), slug(it.title) + '.xml');
        } catch (err) { toast.error('XML недоступен: ' + (it.error || err.message)); }
        break;
      }
      case 'zip': await withBusy(btn, () => exportZip(it).catch(err => toast.error('Архив не собран: ' + err.message))); break;
      case 'retry': it.status = 'idle'; it.error = null; paint(it); ensureDeck(it).catch(() => {}); break;
      case 'del': await deleteCustom(it.id); break;
    }
  });
}