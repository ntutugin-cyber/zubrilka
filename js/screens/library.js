/* Библиотека: готовые колоды из decks/index.json, свои колоды, импорт файлов/папок. */
import { $, esc, uid, slug, cardKey, emit, download, plural } from '../core/utils.js';
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

let root = null;
let libDecks = [];
const customCache = new Map();
let q = '', sort = 'title';

export function init(el) {
  root = el;
  renderShell();
  bind();
  renderGrids();
  void loadManifest();
}
export function refresh() { renderGrids(); }

function renderShell() {
  root.innerHTML =
    `<div class="hero">
       <div class="hero-left">
         <span class="eyebrow mono">тренажёр карточек · xml · офлайн</span>
         <h1>Зубри до <span class="grad-text">автоматизма</span>.</h1>
         <p class="hero-sub">Загрузи колоду с вопросами, картинками и звуком — и преврати знания в рефлексы. Порции, повторы ошибок и статистика уже внутри.</p>
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
     <input type="file" id="lib-files" multiple accept=".xml,image/*,audio/*" hidden>
     <input type="file" id="lib-dir" webkitdirectory hidden>
     <section class="deck-section">
       <div class="sec-head"><h2>Готовые колоды</h2><span class="chip" id="ready-count">0</span></div>
       <div class="deck-grid" id="grid-ready"></div>
     </section>
     <section class="deck-section">
       <div class="sec-head"><h2>Мои колоды</h2><span class="chip" id="mine-count">0</span></div>
       <div class="deck-grid" id="grid-mine"></div>
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

async function loadManifest() {
  if (location.protocol === 'file:') { showNotice('file'); return; }
  try {
    const resp = await fetch('decks/index.json', { cache: 'no-cache' });
    if (!resp.ok) throw new Error(String(resp.status));
    const man = await resp.json();
    libDecks = (man.decks || []).map(d => ({ ...d, deck: null, error: null, xmlText: null }));
    renderGrids();
    await Promise.all(libDecks.map(async d => {
      try {
        const url = new URL('decks/' + d.path, location.href);
        const r = await fetch(url);
        if (!r.ok) throw new Error(String(r.status));
        const text = await r.text();
        const parsed = xml.parse(text);
        d.deck = { id: d.id, title: parsed.title || d.title, cards: parsed.cards, source: 'library' };
        d.xmlText = text;
        d.count = parsed.cards.length;
        media.setBase(d.id, url);
      } catch { d.error = 'Не удалось загрузить'; }
    }));
    renderGrids();
  } catch { showNotice('manifest'); }
}

function showNotice(kind) {
  $('#lib-notice', root).innerHTML = kind === 'file'
    ? `<div class="notice"><svg class="ic"><use href="#i-help"/></svg><div>
         Вы открыли файл напрямую (<b>file://</b>) — готовые колоды из папки <b>decks/</b> так не загружаются.
         Запустите локальный сервер в папке проекта: <code>python -m http.server 8080</code>
         или <code>node tools/serve.mjs</code>, затем откройте <code>http://localhost:8080</code>.
         Импорт своих файлов и конструктор работают и без сервера.</div></div>`
    : `<div class="notice"><svg class="ic"><use href="#i-help"/></svg><div>
         Не найден <b>decks/index.json</b> — список готовых колод недоступен.
         Добавьте манифест (или выполните <code>node tools/build-manifest.mjs</code>) — см. README.
         Свои колоды можно импортировать кнопками выше.</div></div>`;
}

const learnedCount = deck => {
  const set = new Set(store.getProgress(deck.id).learned);
  return deck.cards.filter(c => set.has(cardKey(c))).length;
};

function parseCustom(rec) {
  let c = customCache.get(rec.id);
  if (!c || c.xml !== rec.xml) {
    try {
      const p = xml.parse(rec.xml);
      c = { xml: rec.xml, deck: { id: rec.id, title: p.title, cards: p.cards, source: 'custom' }, error: null };
    } catch { c = { xml: rec.xml, deck: null, error: 'XML повреждён' }; }
    customCache.set(rec.id, c);
  }
  return c;
}

function viewModels() {
  const ready = libDecks.map(d => ({
    id: d.id, kind: 'ready',
    title: d.deck?.title || d.title || d.id,
    desc: d.description || '',
    emoji: d.emoji || '📚', accent: d.accent || 'violet', tags: d.tags || [],
    deck: d.deck, error: d.error, xmlText: d.xmlText
  }));
  const mine = store.listDecks().map(rec => {
    const p = parseCustom(rec);
    return {
      id: rec.id, kind: 'mine',
      title: p.deck?.title || rec.title,
      desc: 'Своя колода · обновлена ' + new Date(rec.updated || rec.created || Date.now()).toLocaleDateString('ru-RU'),
      emoji: '🗂️', accent: 'lime', tags: ['моя колода'],
      deck: p.deck, error: p.error, xmlText: rec.xml, rec
    };
  });
  return { ready, mine };
}

const pctOf = m => m.deck?.cards.length ? learnedCount(m.deck) / m.deck.cards.length : 0;

function applyView(list) {
  let l = list;
  if (q) {
    const nq = q.toLowerCase();
    l = l.filter(m => (m.title + ' ' + m.desc + ' ' + m.tags.join(' ')).toLowerCase().includes(nq));
  }
  if (sort === 'title') l = [...l].sort((a, b) => a.title.localeCompare(b.title, 'ru'));
  else if (sort === 'progress') l = [...l].sort((a, b) => pctOf(b) - pctOf(a));
  else l = [...l].sort((a, b) => (b.deck?.cards.length || 0) - (a.deck?.cards.length || 0));
  return l;
}

function deckCardHtml(m) {
  const total = m.deck?.cards.length || 0;
  const learned = m.deck ? learnedCount(m.deck) : 0;
  const pct = total ? Math.round(learned / total * 100) : 0;
  const CIRC = 106.8;
  return `<article class="deck-card acc-${m.accent}" data-id="${esc(m.id)}" data-kind="${m.kind}">
    <div class="dc-top"><div class="dc-emoji">${m.emoji}</div>
      <div class="dc-tt"><h3>${esc(m.title)}</h3><p>${esc(m.desc)}</p></div></div>
    <div class="dc-chips">
      <span class="chip">${total} ${plural(total, 'карточка', 'карточки', 'карточек')}</span>
      ${m.tags.map(t => `<span class="chip chip-tag">${esc(t)}</span>`).join('')}
      ${m.error ? `<span class="chip chip-err">${esc(m.error)}</span>` : ''}
    </div>
    <div class="dc-progress">
      <svg viewBox="0 0 44 44" class="ring" aria-hidden="true">
        <circle cx="22" cy="22" r="17" class="ring-track"/>
        <circle cx="22" cy="22" r="17" class="ring-fill" stroke-dasharray="${CIRC}" stroke-dashoffset="${(CIRC * (1 - pct / 100)).toFixed(1)}"/>
      </svg>
      <span class="mono dc-plabel">${learned}/${total} · ${pct}%</span>
      ${pct === 100 && total ? '<span class="chip chip-done">выучено 🎓</span>' : ''}
    </div>
    <div class="dc-actions">
      <button class="btn btn-primary btn-sm dc-learn" data-act="learn" ${!m.deck ? 'disabled' : ''}><svg class="ic"><use href="#i-play"/></svg>Учить</button>
      <button class="btn btn-icon btn-ghost" data-act="edit" title="Открыть в конструкторе" ${!m.deck ? 'disabled' : ''}><svg class="ic"><use href="#i-pencil"/></svg></button>
      <button class="btn btn-icon btn-ghost" data-act="xml" title="XML-код" ${!m.xmlText ? 'disabled' : ''}><svg class="ic"><use href="#i-code"/></svg></button>
      <button class="btn btn-icon btn-ghost" data-act="zip" title="Скачать XML + медиа (.zip)" ${!m.deck ? 'disabled' : ''}><svg class="ic"><use href="#i-box"/></svg></button>
      ${m.kind === 'mine' ? '<button class="btn btn-icon btn-danger-ghost" data-act="del" title="Удалить колоду"><svg class="ic"><use href="#i-trash"/></svg></button>' : ''}
    </div>
  </article>`;
}

function renderGrids() {
  if (!root) return;
  const { ready, mine } = viewModels();
  const rv = applyView(ready), mv = applyView(mine);
  $('#ready-count', root).textContent = rv.length;
  $('#mine-count', root).textContent = mv.length;
  $('#grid-ready', root).innerHTML = rv.length
    ? rv.map(deckCardHtml).join('')
    : `<div class="empty-card"><svg class="ic"><use href="#i-cards"/></svg><span>${q ? 'Ничего не найдено по запросу' : 'Готовые колоды не найдены'}</span></div>`;
  $('#grid-mine', root).innerHTML = mv.length
    ? mv.map(deckCardHtml).join('')
    : `<div class="empty-card"><svg class="ic"><use href="#i-folder"/></svg>
        <span>${q ? 'Ничего не найдено' : 'Здесь появятся ваши колоды: импорт XML, демо или собранные в конструкторе'}</span>
        <button class="btn btn-ghost btn-sm" data-act="files"><svg class="ic"><use href="#i-upload"/></svg>Импортировать XML</button></div>`;
  updateStats(ready, mine);
}

function updateStats(ready, mine) {
  const all = [...ready, ...mine].filter(m => m.deck);
  const cards = all.reduce((s, m) => s + m.deck.cards.length, 0);
  const learned = all.reduce((s, m) => s + learnedCount(m.deck), 0);
  $('#st-decks', root).textContent = ready.length + mine.length;
  $('#st-cards', root).textContent = cards;
  $('#st-learned', root).textContent = learned;
}

function findModel(id, kind) {
  const { ready, mine } = viewModels();
  return (kind === 'ready' ? ready : mine).find(m => m.id === id);
}

async function prepareDeck(m) {
  if (m.kind === 'mine') await media.loadFromIDB(m.id);
  return m.deck;
}

async function exportZip(m) {
  if (!m.deck) return;
  if (m.kind === 'mine') await media.loadFromIDB(m.id);
  const { items, missing } = await media.gatherBlobs(m.id, media.collectNames(m.deck.cards));
  const text = m.xmlText || xml.serialize({ title: m.title, cards: m.deck.cards });
  const blob = await buildZip([
    { name: 'deck.xml', data: text },
    ...items.map(i => ({ name: 'media/' + i.name, data: i.blob }))
  ]);
  download(blob, slug(m.title) + '.zip');
  toast.success(missing.length ? `Архив готов (без ${missing.length} медиафайлов)` : 'Архив XML + медиа готов');
}

async function deleteCustom(id) {
  const rec = store.getDeck(id);
  if (!rec) return;
  if (!await modals.confirmAction({
    title: 'Удалить колоду?',
    text: `Колода «${rec.title}» и её медиа будут удалены из браузера. Прогресс по ней тоже станет неактуален.`,
    ok: 'Удалить'
  })) return;
  const blobs = await idb.getByDeck(id);
  store.removeDeck(id);
  await idb.deleteDeck(id);
  media.release(id);
  customCache.delete(id);
  renderGrids();
  toast.show('Колода удалена', {
    type: 'warn', timeout: 6000,
    action: { label: 'Вернуть', fn: async () => { store.upsertDeck(rec); await idb.putMany(id, blobs); renderGrids(); } }
  });
}

/* ── импорт ── */
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
  play('learn');
  let msg = `Колода «${title}»: +${merged.cards.length} ${plural(merged.cards.length, 'карточка', 'карточки', 'карточек')}`;
  if (merged.skipped) msg += `, дубликатов пропущено: ${merged.skipped}`;
  if (mediaItems.length) msg += `, медиа: ${mediaItems.length}`;
  toast.success(msg, { timeout: 6000 });
  if (errors.length) toast.warn('Часть файлов пропущена: ' + errors.join(' · ').slice(0, 180), { timeout: 7000 });
  renderGrids();
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
          if (h.kind === 'file') {
            const f = await h.getFile();
            out.push({ name, blob: f, path: path + name });
          } else await walk(h, path + name + '/');
        }
      };
      await walk(dir, '');
      if (out.length) await importFiles(out);
      else toast.warn('Папка пуста');
    } catch (e) {
      if (e?.name !== 'AbortError') $('#lib-dir', root).click();
    }
  } else $('#lib-dir', root).click();
}

/* ── демо-колода: картинки и звук генерируются на лету ── */
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
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 80"><rect width="120" height="80" rx="10" fill="#8f6bff"/><circle cx="40" cy="40" r="16" fill="#ffb43a"/><rect x="70" y="24" width="34" height="32" rx="6" fill="#3fd9ff"/></svg>`;
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
    { question: 'Где почитать про формат XML-колод?', media: [],
      answers: [
        { text: 'В README проекта и в блоке «Формат XML» ниже', correct: true, media: [] },
        { text: 'Нигде, формат секретный', correct: false, media: [] }],
      hint: 'Документация: https://developer.mozilla.org/ru/docs/Web/XML и README.md в корне проекта.',
      explanation: 'Ссылки в подсказках превращаются в плитки-кнопки. Откройте README — там полный разбор формата.' }
  ];
  const id = 'my-' + uid(), title = 'Демо · как это работает';
  const items = [
    { name: 'demo-shapes.svg', blob: new Blob([svg], { type: 'image/svg+xml' }) },
    { name: 'demo-signal.wav', blob: makeWav() }
  ];
  media.registerFiles(id, items);
  await media.persistFiles(id, items);
  store.upsertDeck({ id, title, xml: xml.serialize({ title, cards }), created: Date.now(), updated: Date.now() });
  renderGrids();
  toast.success('Демо-колода добавлена в «Мои колоды»');
  play('learn');
}

function bind() {
  $('#lib-q', root).addEventListener('input', e => { q = e.target.value.trim(); renderGrids(); });
  $('#lib-sort', root).addEventListener('change', e => { sort = e.target.value; renderGrids(); });

  $('#lib-files', root).addEventListener('change', e => {
    const files = [...e.target.files];
    e.target.value = '';
    if (files.length) importFiles(files.map(f => ({ name: f.name, blob: f, path: f.webkitRelativePath || f.name })));
  });
  $('#lib-dir', root).addEventListener('change', e => {
    const files = [...e.target.files];
    e.target.value = '';
    if (files.length) importFiles(files.map(f => ({ name: f.name, blob: f, path: f.webkitRelativePath || f.name })));
  });

  const zone = $('#lib-drop', root);
  const dragDepth = { n: 0 };
  root.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('dragover'); });
  root.addEventListener('dragenter', e => { e.preventDefault(); dragDepth.n++; zone.classList.add('dragover'); });
  root.addEventListener('dragleave', () => { if (--dragDepth.n <= 0) { dragDepth.n = 0; zone.classList.remove('dragover'); } });
  root.addEventListener('drop', async e => {
    e.preventDefault();
    dragDepth.n = 0; zone.classList.remove('dragover');
    const items = [...(e.dataTransfer?.items || [])].filter(i => i.kind === 'file');
    const entries = items.map(i => i.webkitGetAsEntry?.()).filter(Boolean);
    if (entries.length) {
      const out = [];
      for (const en of entries) await readEntry(en, out);
      if (out.length) await importFiles(out);
    } else if (e.dataTransfer?.files.length) {
      await importFiles([...e.dataTransfer.files].map(f => ({ name: f.name, blob: f })));
    }
  });
  zone.addEventListener('click', () => $('#lib-files', root).click());
  zone.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); $('#lib-files', root).click(); } });

  root.addEventListener('click', async e => {
    const fmtCopy = e.target.closest('.fmt-copy');
    if (fmtCopy) { e.preventDefault(); e.stopPropagation(); modals.copyText(xml.TEMPLATE); return; }
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const act = btn.dataset.act;
    if (act === 'folder') { await pickFolder(); return; }
    if (act === 'files') { $('#lib-files', root).click(); return; }
    if (act === 'demo') { await loadDemo(); return; }
    if (act === 'template') {
      download(new Blob([xml.TEMPLATE], { type: 'application/xml' }), 'zubrilka-template.xml');
      toast.success('Шаблон XML скачан');
      return;
    }
    const cardEl = btn.closest('.deck-card');
    if (!cardEl) return;
    const m = findModel(cardEl.dataset.id, cardEl.dataset.kind);
    if (!m) return;
    switch (act) {
      case 'learn': {
        const deck = await prepareDeck(m);
        if (deck) { trainer.start(deck); emit('navigate', { tab: 'train' }); }
        break;
      }
      case 'edit': {
        const deck = await prepareDeck(m);
        if (deck) { await constructor.loadDeck(deck, { copy: m.kind === 'ready' }); emit('navigate', { tab: 'construct' }); }
        break;
      }
      case 'xml':
        modals.xmlView(m.title, m.xmlText || xml.serialize({ title: m.title, cards: m.deck.cards }), slug(m.title) + '.xml');
        break;
      case 'zip': await exportZip(m); break;
      case 'del': await deleteCustom(m.id); break;
    }
  });
}