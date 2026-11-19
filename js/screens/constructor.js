/* Конструктор: форма карточки, список колоды, drag-сортировка, экспорт. */
import { $, esc, uid, slug, deepClone, plural, debounce, emit, download } from '../core/utils.js';
import * as store from '../core/store.js';
import * as xml from '../core/xml.js';
import * as media from '../core/media.js';
import * as idb from '../core/idb.js';
import { buildZip } from '../core/zip.js';
import { play } from '../core/sfx.js';
import * as toast from '../ui/toast.js';
import * as modals from '../ui/modals.js';
import * as trainer from './trainer.js';

let root = null;
const blankForm = () => ({
  question: '', qMedia: [],
  answers: [{ text: '', correct: false, media: [] }, { text: '', correct: false, media: [] }],
  hint: '', explanation: ''
});
let C = { deckId: null, title: '', cards: [], edit: null, form: blankForm() };
let dragI = null;

const saveDraft = debounce(() =>
  store.setDraft({ deckId: C.deckId, title: C.title, cards: C.cards, form: C.form }), 400);

export async function init(el) {
  root = el;
  renderShell();
  bind();
  const d = store.getDraft();
  if (d) C = { deckId: d.deckId || null, title: d.title || '', cards: d.cards || [], edit: null, form: d.form || blankForm() };
  const items = await idb.getByDeck('draft');
  if (items.length) media.registerFiles('draft', items);
  renderAll();
}

function renderShell() {
  root.innerHTML =
    `<div class="build-grid">
       <div class="panel" id="c-form-panel"></div>
       <div class="panel">
         <div class="panel-head"><h2>Колода</h2><span class="chip chip-done" id="c-count">0 карточек</span></div>
         <input type="text" id="c-title" class="deck-title-input" placeholder="Название темы" maxlength="120">
         <div class="card-list" id="c-list"></div>
         <div class="deck-foot">
           <button class="btn btn-primary" data-act="deck-learn"><svg class="ic"><use href="#i-play"/></svg>Учить!</button>
           <button class="btn btn-ghost" data-act="deck-save" title="Сохранить в «Мои колоды»"><svg class="ic"><use href="#i-folder"/></svg>В библиотеку</button>
           <button class="btn btn-ghost btn-icon" data-act="deck-zip" title="Скачать XML + медиа (.zip)"><svg class="ic"><use href="#i-box"/></svg></button>
           <button class="btn btn-ghost btn-icon" data-act="deck-xml" title="Скачать XML"><svg class="ic"><use href="#i-download"/></svg></button>
           <button class="btn btn-ghost btn-icon" data-act="deck-code" title="Показать XML"><svg class="ic"><use href="#i-code"/></svg></button>
           <button class="btn btn-danger-ghost btn-icon" data-act="deck-clear" title="Очистить колоду"><svg class="ic"><use href="#i-trash"/></svg></button>
         </div>
       </div>
     </div>`;
}

const mediaChips = (names, scope) => (names || []).map((n, idx) =>
  `<span class="chip chip-media"><svg class="ic"><use href="#i-${media.kindOf(n) === 'audio' ? 'music' : 'image'}"/></svg>${esc(n.split('/').pop())}<button class="chip-x" data-act="rm-media" data-scope="${scope}" data-idx="${idx}" aria-label="Убрать файл">×</button></span>`
).join('');

const answerRow = (a, i, total) =>
  `<div class="answer-row${a.correct ? ' is-correct' : ''}" data-row="${i}">
     <button class="correct-toggle${a.correct ? ' on' : ''}" data-act="toggle-correct" aria-pressed="${a.correct}" title="Правильный ответ"><svg class="ic"><use href="#i-check"/></svg></button>
     <div class="answer-main">
       <textarea data-af="${i}" rows="2" placeholder="Вариант ответа…">${esc(a.text)}</textarea>
       <div class="attach-row">
         <button class="btn btn-sm btn-ghost" data-act="attach-a">📎 медиа</button>
         <span class="chips">${mediaChips(a.media, 'a' + i)}</span>
         ${total > 1 ? `<button class="btn btn-icon btn-sm btn-danger-ghost row-del" data-act="del-answer" title="Удалить вариант"><svg class="ic"><use href="#i-trash"/></svg></button>` : ''}
       </div>
     </div>
   </div>`;

function renderForm() {
  const f = C.form;
  $('#c-form-panel', root).innerHTML =
    `<div class="panel-head"><h2>${C.edit != null ? 'Карточка #' + (C.edit + 1) : 'Новая карточка'}</h2>
       ${C.edit != null ? '<button class="btn btn-sm btn-ghost" data-act="cancel-edit">Отменить правку</button>' : '<span class="chip chip-multi">конструктор</span>'}</div>
     <div class="field"><label>Вопрос</label>
       <textarea data-f="question" rows="3" placeholder="Текст вопроса…">${esc(f.question)}</textarea>
       <div class="attach-row"><button class="btn btn-sm btn-ghost" data-act="attach-q">📎 файл к вопросу</button>
         <span class="chips">${mediaChips(f.qMedia, 'q')}</span></div></div>
     <div class="field"><label>Варианты ответа · отметьте правильные (можно несколько)</label>
       <div class="answers">${f.answers.map((a, i) => answerRow(a, i, f.answers.length)).join('')}</div>
       <button class="btn btn-add" data-act="add-answer">＋ Добавить вариант</button>
       <p class="field-note">Кружок = правильный ответ; правильных может быть несколько. Поля многострочные, 📎 прикрепляет картинки и звук.</p></div>
     <div class="field"><label>Подсказка (если не знаешь ответ)</label>
       <textarea data-f="hint" rows="2" placeholder="Ссылки https://… станут плитками">${esc(f.hint)}</textarea></div>
     <div class="field"><label>Пояснение (показывается после ответа)</label>
       <textarea data-f="explanation" rows="2" placeholder="Почему этот ответ правильный…">${esc(f.explanation)}</textarea></div>
     <div class="form-error" id="c-err" hidden></div>
     <div class="form-actions">
       <button class="btn btn-primary" data-act="submit">${C.edit != null ? 'Сохранить карточку' : '＋ Добавить в колоду'}</button>
       <button class="btn btn-ghost" data-act="clear-form">Очистить форму</button>
     </div>`;
}

function renderList() {
  const list = $('#c-list', root);
  $('#c-count', root).textContent =
    `${C.cards.length} ${plural(C.cards.length, 'карточка', 'карточки', 'карточек')}`;
  if (!C.cards.length) {
    list.innerHTML = '<div class="list-empty">Колода пока пуста.<br>Соберите карточки слева — или загрузите XML в библиотеке.</div>';
  } else {
    list.innerHTML = C.cards.map((c, i) => {
      const multi = c.answers.filter(a => a.correct).length;
      const mCount = (c.media?.length || 0) + c.answers.reduce((s, a) => s + (a.media?.length || 0), 0);
      return `<div class="card-item" draggable="true" data-i="${i}">
        <svg class="ic ci-grip"><use href="#i-grip"/></svg>
        <span class="ci-num">${String(i + 1).padStart(2, '0')}</span>
        <div class="ci-body">
          <div class="ci-q">${esc(c.question.split('\n')[0])}</div>
          <div class="ci-badges">
            <span class="chip">${c.answers.length} вар.</span>
            ${multi > 1 ? `<span class="chip chip-multi">✓${multi}</span>` : ''}
            ${mCount ? `<span class="chip chip-cyan">🖼 ${mCount}</span>` : ''}
            ${c.hint ? '<span class="chip chip-amber">💡</span>' : ''}
          </div>
        </div>
        <div class="ci-actions">
          <button class="btn btn-icon btn-sm btn-ghost" data-act="card-edit" title="Редактировать"><svg class="ic"><use href="#i-pencil"/></svg></button>
          <button class="btn btn-icon btn-sm btn-danger-ghost" data-act="card-del" title="Удалить"><svg class="ic"><use href="#i-trash"/></svg></button>
        </div>
      </div>`;
    }).join('');
  }
  for (const act of ['deck-learn', 'deck-save', 'deck-zip', 'deck-xml', 'deck-code', 'deck-clear']) {
    const b = root.querySelector(`[data-act="${act}"]`);
    if (b) b.disabled = !C.cards.length;
  }
}

function renderAll() {
  $('#c-title', root).value = C.title;
  renderForm(); renderList();
}

function pickFiles() {
  return new Promise(res => {
    const inp = document.createElement('input');
    inp.type = 'file'; inp.multiple = true; inp.accept = 'image/*,audio/*,.svg';
    inp.onchange = () => res([...inp.files]);
    inp.click();
  });
}

async function attach(target) {
  const files = await pickFiles();
  if (!files.length) return;
  media.registerFiles('draft', files);
  await media.persistFiles('draft', files.map(f => ({ name: f.name, blob: f })));
  const names = files.map(f => f.name);
  if (target === 'q') C.form.qMedia.push(...names);
  else C.form.answers[+target.slice(1)].media.push(...names);
  play('tick'); renderForm(); saveDraft();
}

function submitForm() {
  const f = C.form;
  const question = f.question.trim();
  const answers = f.answers
    .map(a => ({ text: a.text.trim(), correct: a.correct, media: [...a.media] }))
    .filter(a => a.text || a.media.length);
  const errs = [];
  if (!question) errs.push('Впишите вопрос');
  if (!answers.length) errs.push('Добавьте хотя бы один вариант ответа');
  else if (!answers.some(a => a.correct)) errs.push('Отметьте кружком хотя бы один правильный вариант');
  const errEl = $('#c-err', root);
  if (errs.length) {
    errEl.textContent = errs.join(' · ');
    errEl.hidden = false;
    play('wrong');
    return;
  }
  const card = { question, media: [...f.qMedia], answers, hint: f.hint.trim(), explanation: f.explanation.trim() };
  if (C.edit != null) { C.cards[C.edit] = card; C.edit = null; toast.success('Карточка обновлена'); }
  else { C.cards.push(card); toast.success('Карточка добавлена в колоду'); }
  play('correct');
  C.form = blankForm();
  renderForm(); renderList(); saveDraft();
}

async function saveDeck(silent) {
  if (!C.cards.length) { toast.warn('В колоде нет карточек'); return null; }
  const title = C.title.trim() || 'Моя колода';
  const id = C.deckId || ('my-' + uid());
  const text = xml.serialize({ title, cards: C.cards });
  const files = media.getFiles('draft');
  const items = [], seen = new Set();
  for (const n of media.collectNames(C.cards)) {
    const b = files.get(n) || files.get(n.split('/').pop());
    const base = n.split('/').pop();
    if (b && !seen.has(base)) { seen.add(base); items.push({ name: base, blob: b }); }
  }
  media.registerFiles(id, items);
  await media.persistFiles(id, items);
  const prev = store.getDeck(id);
  store.upsertDeck({ id, title, xml: text, created: prev?.created || Date.now(), updated: Date.now() });
  C.deckId = id; C.title = title;
  $('#c-title', root).value = title;
  saveDraft();
  if (!silent) toast.success('Колода сохранена в «Мои колоды»');
  return { id, title, cards: deepClone(C.cards), source: 'custom' };
}

async function exportZip() {
  if (!C.cards.length) return;
  const title = C.title.trim() || 'Моя колода';
  const { items, missing } = await media.gatherBlobs('draft', media.collectNames(C.cards));
  const blob = await buildZip([
    { name: 'deck.xml', data: xml.serialize({ title, cards: C.cards }) },
    ...items.map(i => ({ name: 'media/' + i.name, data: i.blob }))
  ]);
  download(blob, slug(title) + '.zip');
  toast.success(missing.length ? `Архив готов (без ${missing.length} медиафайлов)` : 'Архив XML + медиа готов');
}

function bind() {
  root.addEventListener('input', e => {
    const t = e.target;
    if (t.dataset.f) { C.form[t.dataset.f] = t.value; saveDraft(); }
    else if (t.dataset.af !== undefined) { C.form.answers[+t.dataset.af].text = t.value; saveDraft(); }
    else if (t.id === 'c-title') { C.title = t.value; saveDraft(); }
  });

  root.addEventListener('click', async e => {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const act = btn.dataset.act;
    const row = btn.closest('[data-row]');
    const item = btn.closest('.card-item');
    switch (act) {
      case 'attach-q': await attach('q'); break;
      case 'attach-a': await attach('a' + row.dataset.row); break;
      case 'toggle-correct': {
        const i = +row.dataset.row, a = C.form.answers[i];
        a.correct = !a.correct;
        row.classList.toggle('is-correct', a.correct);
        btn.classList.toggle('on', a.correct);
        btn.setAttribute('aria-pressed', String(a.correct));
        play('tick'); saveDraft();
        break;
      }
      case 'add-answer':
        C.form.answers.push({ text: '', correct: false, media: [] });
        renderForm(); saveDraft();
        root.querySelector(`[data-af="${C.form.answers.length - 1}"]`)?.focus();
        break;
      case 'del-answer':
        C.form.answers.splice(+row.dataset.row, 1);
        renderForm(); saveDraft();
        break;
      case 'rm-media': {
        const sc = btn.dataset.scope, idx = +btn.dataset.idx;
        if (sc === 'q') C.form.qMedia.splice(idx, 1);
        else C.form.answers[+sc.slice(1)].media.splice(idx, 1);
        renderForm(); saveDraft();
        break;
      }
      case 'submit': submitForm(); break;
      case 'clear-form': case 'cancel-edit':
        C.form = blankForm(); C.edit = null; renderForm(); saveDraft();
        break;
      case 'card-edit': {
        const i = +item.dataset.i;
        C.edit = i;
        C.form = deepClone(C.cards[i]);
        C.form.qMedia = C.form.media || [];
        renderForm(); saveDraft();
        $('#c-form-panel', root).scrollIntoView({ behavior: 'smooth', block: 'start' });
        break;
      }
      case 'card-del': {
        const i = +item.dataset.i;
        const snapshot = C.cards[i];
        C.cards.splice(i, 1);
        if (C.edit === i) { C.edit = null; C.form = blankForm(); renderForm(); }
        renderList(); saveDraft(); play('tick');
        toast.show('Карточка удалена', {
          type: 'warn',
          action: { label: 'Вернуть', fn: () => { C.cards.splice(i, 0, snapshot); renderList(); saveDraft(); } }
        });
        break;
      }
      case 'deck-learn': {
        const d = await saveDeck(true);
        if (d) { trainer.start(d); emit('navigate', { tab: 'train' }); play('flip'); }
        break;
      }
      case 'deck-save': await saveDeck(false); break;
      case 'deck-zip': await exportZip(); break;
      case 'deck-xml':
        download(new Blob([xml.serialize({ title: C.title.trim() || 'Моя колода', cards: C.cards })], { type: 'application/xml' }),
          slug(C.title || 'deck') + '.xml');
        break;
      case 'deck-code':
        modals.xmlView(C.title.trim() || 'Моя колода',
          xml.serialize({ title: C.title.trim() || 'Моя колода', cards: C.cards }),
          slug(C.title || 'deck') + '.xml');
        break;
      case 'deck-clear': {
        if (await modals.confirmAction({
          title: 'Очистить колоду?',
          text: `Все ${C.cards.length} карточек будут удалены из конструктора. Сохранённая копия в библиотеке останется.`,
          ok: 'Очистить'
        })) {
          const snap = deepClone({ cards: C.cards, title: C.title, deckId: C.deckId });
          C.cards = []; C.title = ''; C.deckId = null; C.edit = null;
          renderAll(); saveDraft();
          toast.show('Колода очищена', {
            type: 'warn',
            action: { label: 'Вернуть', fn: () => { Object.assign(C, snap); renderAll(); saveDraft(); } }
          });
        }
        break;
      }
    }
  });

  /* drag-сортировка карточек */
  root.addEventListener('dragstart', e => {
    const it = e.target.closest('.card-item');
    if (!it) return;
    dragI = +it.dataset.i;
    it.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', String(dragI));
  });
  root.addEventListener('dragover', e => {
    const it = e.target.closest('.card-item');
    if (!it || dragI == null) return;
    e.preventDefault();
    root.querySelectorAll('.card-item.drop-target').forEach(x => x.classList.remove('drop-target'));
    if (+it.dataset.i !== dragI) it.classList.add('drop-target');
  });
  root.addEventListener('drop', e => {
    const it = e.target.closest('.card-item');
    if (!it || dragI == null) return;
    e.preventDefault();
    const to = +it.dataset.i;
    if (to !== dragI) {
      const [moved] = C.cards.splice(dragI, 1);
      C.cards.splice(to, 0, moved);
      renderList(); saveDraft(); play('tick');
    }
    dragI = null;
  });
  root.addEventListener('dragend', () => {
    dragI = null;
    root.querySelectorAll('.card-item').forEach(x => x.classList.remove('dragging', 'drop-target'));
  });
}

/* Открыть колоду в конструкторе (из библиотеки). copy=true — новая своя колода. */
export async function loadDeck(deck, { copy = false } = {}) {
  let items = [];
  if (deck.source === 'custom') {
    await media.loadFromIDB(deck.id);
    items = media.copyFiles(deck.id, 'draft');
  } else {
    const g = await media.gatherBlobs(deck.id, media.collectNames(deck.cards));
    items = g.items;
    media.registerFiles('draft', items);
  }
  await media.persistFiles('draft', items);
  C = {
    deckId: copy ? null : deck.id,
    title: deck.title + (copy ? ' (копия)' : ''),
    cards: deepClone(deck.cards),
    edit: null, form: blankForm()
  };
  renderAll(); saveDraft();
  toast.success(copy ? 'Копия колоды открыта в конструкторе' : 'Колода открыта в конструкторе');
}