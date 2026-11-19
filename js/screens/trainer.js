/* Тренировка: порции, повторы ошибок, серия, подсказки, результаты. */
import { $, esc, cardKey, shuffle, fmtTime, plural, emit, hintHtml, explainHtml } from '../core/utils.js';
import * as store from '../core/store.js';
import { settings } from '../core/store.js';
import * as media from '../core/media.js';
import { play } from '../core/sfx.js';
import * as fx from '../core/fx.js';
import * as toast from '../ui/toast.js';
import * as modals from '../ui/modals.js';

let root = null, S = null;
export const hasSession = () => !!S && !S.done;

export function init(el) { root = el; bind(); render(); }

export function start(deck) {
  if (S?.autoTimer) clearTimeout(S.autoTimer);
  const learned = new Set(store.getProgress(deck.id).learned);
  const idxs = deck.cards.map((_, i) => i);
  const remaining = shuffle(idxs.filter(i => !learned.has(cardKey(deck.cards[i]))));
  if (!remaining.length) {
    S = { deck, learned, done: true, already: true };
    render(); return;
  }
  const batch = settings.batch > 0 ? settings.batch : remaining.length;
  const portion = remaining.slice(0, batch), reserve = remaining.slice(batch);
  const order = new Map();
  for (const i of idxs) {
    const ord = deck.cards[i].answers.map((_, j) => j);
    order.set(i, settings.shuffle ? shuffle(ord) : ord);
  }
  S = {
    deck, learned, portion, reserve, repeat: new Set(), current: portion[0], order,
    selected: new Set(), phase: 'question', reveal: null, hintShown: false, hintCounted: false,
    autoTimer: null, done: false, already: false, total: remaining.length,
    stats: { errors: 0, perCard: {}, streak: 0, best: 0, closed: 0, hints: 0, start: Date.now() }
  };
  render(); play('flip');
}

const cur = () => S.deck.cards[S.current];
const isMulti = () => cur().answers.filter(a => a.correct).length > 1;
const firstLine = t => t.split('\n')[0];

function bind() {
  root.addEventListener('click', e => {
    const optEl = e.target.closest('.opt[data-opt]');
    if (optEl && !optEl.classList.contains('static')) {
      if (e.target.closest('.audio-player,[data-lightbox],a,button')) return;
      choose(+optEl.dataset.opt);
      return;
    }
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    switch (btn.dataset.act) {
      case 'check': check(); break;
      case 'next': next(); break;
      case 'skip': if (S && !S.done && S.phase === 'question') reveal(false, true); break;
      case 'hint': toggleHint(); break;
      case 'exit': if (S?.autoTimer) clearTimeout(S.autoTimer); S = null; emit('navigate', { tab: 'library' }); render(); break;
      case 'reset': resetProgress(); break;
      case 'replay': replay(); break;
      case 'to-library': emit('navigate', { tab: 'library' }); break;
      case 'to-constructor': emit('navigate', { tab: 'construct' }); break;
      case 'review': modals.review(S.deck.cards[+btn.dataset.i], S.deck.id); break;
      case 'pick': emit('navigate', { tab: 'library' }); break;
    }
  });
  root.addEventListener('keydown', e => {
    const o = e.target.closest('.opt[data-opt]');
    if (o && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault(); e.stopPropagation();
      choose(+o.dataset.opt);
    }
  });
}

function choose(i) {
  if (!S || S.done || S.phase !== 'question') return;
  if (isMulti()) {
    if (S.selected.has(i)) S.selected.delete(i); else S.selected.add(i);
    play('select');
    root.querySelectorAll('.opt[data-opt]').forEach(el => {
      const on = S.selected.has(+el.dataset.opt);
      el.classList.toggle('selected', on);
      el.setAttribute('aria-pressed', String(on));
    });
    const n = $('#check-n', root), b = $('#check-btn', root);
    if (n) n.textContent = S.selected.size;
    if (b) b.disabled = S.selected.size === 0;
  } else {
    S.selected = new Set([i]);
    check();
  }
}

function check() {
  if (!S || S.done || S.phase !== 'question' || !S.selected.size) return;
  const correct = new Set(cur().answers.map((a, j) => a.correct ? j : -1).filter(j => j >= 0));
  const ok = S.selected.size === correct.size && [...S.selected].every(j => correct.has(j));
  reveal(ok, false);
}

function reveal(ok, skipped) {
  const card = cur(), key = cardKey(card), i = S.current;
  S.phase = 'reveal';
  S.reveal = { ok, skipped, chosen: new Set(S.selected) };
  if (ok) {
    S.stats.closed++; S.stats.streak++;
    S.stats.best = Math.max(S.stats.best, S.stats.streak);
    S.learned.add(key);
    store.markLearned(S.deck.id, key);
    S.repeat.delete(i);
    S.portion.shift();
    play(S.stats.perCard[i] ? 'learn' : 'correct');
  } else {
    S.stats.errors++;
    S.stats.perCard[i] = (S.stats.perCard[i] || 0) + 1;
    S.stats.streak = 0;
    S.repeat.add(i);
    S.portion.push(S.portion.shift());
    play('wrong');
  }
  render();
  if (ok) {
    fx.burstAt($('#train-paper', root), S.stats.perCard[i] ? 34 : 22);
    S.autoTimer = setTimeout(() => {
      if (S && !S.done && S.phase === 'reveal' && S.reveal?.ok) next();
    }, 1100);
  }
  emit('progress');
}

function next() {
  if (!S || S.done || S.phase !== 'reveal') return;
  clearTimeout(S.autoTimer); S.autoTimer = null;
  if (!S.portion.length && S.reserve.length) {
    const batch = settings.batch > 0 ? settings.batch : S.reserve.length;
    S.portion = S.reserve.splice(0, batch);
    toast.show(`Новая порция: ${S.portion.length} ${plural(S.portion.length, 'карточка', 'карточки', 'карточек')}`, { timeout: 2500 });
    play('flip');
  }
  if (!S.portion.length) { finish(); return; }
  S.current = S.portion[0];
  S.selected = new Set();
  S.phase = 'question'; S.reveal = null; S.hintShown = false; S.hintCounted = false;
  render();
}

function finish() {
  S.done = true;
  S.time = Date.now() - S.stats.start;
  const errByKey = {};
  for (const [i, n] of Object.entries(S.stats.perCard))
    errByKey[cardKey(S.deck.cards[+i])] = n;
  store.mergeErrors(S.deck.id, errByKey);
  store.setBest(S.deck.id, S.stats.best);
  render();
  fx.celebrate();
  setTimeout(() => play('fanfare'), 250);
  emit('progress');
}

function toggleHint() {
  if (!S || S.done) return;
  const panel = $('#hint-panel', root);
  if (!panel) return;
  S.hintShown = !S.hintShown;
  panel.hidden = !S.hintShown;
  const btn = root.querySelector('[data-act="hint"]');
  btn?.setAttribute('aria-pressed', String(S.hintShown));
  if (S.hintShown) {
    play('hint');
    if (!S.hintCounted) { S.hintCounted = true; S.stats.hints++; }
  }
}

async function resetProgress() {
  if (!S) return;
  if (await modals.confirmAction({
    title: 'Сбросить прогресс колоды?',
    text: `Все отметки «выучено» и ошибки колоды «${S.deck.title}» будут очищены.`,
    ok: 'Сбросить'
  })) {
    if (S.autoTimer) clearTimeout(S.autoTimer);
    store.resetDeckProgress(S.deck.id);
    S = null; render();
    toast.success('Прогресс колоды сброшен');
  }
}

async function replay() {
  if (!S) return;
  const deck = S.deck;
  if (await modals.confirmAction({
    title: 'Пройти ещё раз?',
    text: 'Прогресс этой колоды будет сброшен, и все карточки вернутся в работу.',
    ok: 'Начать заново', danger: false
  })) {
    store.resetDeckProgress(deck.id);
    start(deck);
  }
}

/* ── клавиатура (вызывается из main) ── */
export function handleKey(e) {
  if (!S || S.done) return false;
  const m = /^(Digit|Numpad)([1-9])$/.exec(e.code);
  if (m && S.phase === 'question') {
    const pos = +m[2] - 1, ord = S.order.get(S.current);
    if (pos < ord.length) { e.preventDefault(); choose(ord[pos]); }
    return true;
  }
  if (e.code === 'KeyH') { e.preventDefault(); toggleHint(); return true; }
  if (e.key === 'Enter') {
    if (S.phase === 'reveal') { e.preventDefault(); next(); }
    else if (S.phase === 'question' && isMulti() && S.selected.size) { e.preventDefault(); check(); }
    return true;
  }
  return false;
}

/* ── рендер ── */
function optHtml(a, j, pos) {
  const sel = S.selected.has(j), rv = S.reveal;
  let cls = 'opt';
  if (sel) cls += ' selected';
  if (rv) {
    if (a.correct) cls += ' is-correct' + (!rv.chosen.has(j) && !rv.ok ? ' is-missed' : '');
    else if (rv.chosen.has(j)) cls += ' is-wrong';
  }
  const mark = rv ? (a.correct ? 'check' : (rv.chosen.has(j) ? 'x' : '')) : '';
  return `<div class="${cls}" role="button" tabindex="${rv ? -1 : 0}" data-opt="${j}" aria-pressed="${sel}">
    <span class="key mono">${pos + 1}</span>
    <span class="opt-body"><span class="opt-text">${esc(a.text)}</span>
      ${a.media?.length ? `<span class="opt-media" data-m="${esc(a.media.join('|'))}"></span>` : ''}</span>
    ${mark ? `<svg class="ic opt-mark"><use href="#i-${mark}"/></svg>` : ''}
  </div>`;
}

function render() {
  if (!root) return;
  if (!S) {
    root.innerHTML =
      `<div class="empty-state">
         <svg class="ic es-icon"><use href="#i-cards"/></svg>
         <h3>Колода не выбрана</h3>
         <p>Выберите колоду в библиотеке или соберите свою в конструкторе — и начинайте зубрить.</p>
         <button class="btn btn-primary btn-lg" data-act="pick"><svg class="ic"><use href="#i-folder"/></svg>Выбрать колоду</button>
       </div>`;
    return;
  }
  if (S.done) { root.innerHTML = resultsHtml(); return; }

  const d = S.deck, card = cur(), multi = isMulti(), ord = S.order.get(S.current);
  const learnedTotal = d.cards.filter(c => S.learned.has(cardKey(c))).length;
  const pct = Math.round(learnedTotal / d.cards.length * 100);

  root.innerHTML =
    `<div class="train-top">
       <button class="btn btn-icon btn-ghost" data-act="exit" title="К библиотеке"><svg class="ic"><use href="#i-arrow-l"/></svg></button>
       <div class="tt-title"><b>${esc(d.title)}</b>
         <span class="mono">порция ${settings.batch || 'все'} · ${settings.shuffle ? 'варианты перемешаны' : 'порядок из XML'}</span></div>
       <div class="tt-counters">
         <span class="chip chip-cyan" title="Карточек в текущей порции">в порции: ${S.portion.length}</span>
         <span class="chip chip-amber" title="Ошиблись — вернутся на повтор">на повторе: ${S.repeat.size}</span>
         <span class="chip" title="Ждут своей очереди">в запасе: ${S.reserve.length}</span>
         <span class="chip chip-streak${S.stats.streak >= 3 ? ' hot' : ''}" title="Верных подряд"><svg class="ic"><use href="#i-flame"/></svg>${S.stats.streak}</span>
         <button class="btn btn-icon btn-ghost" data-act="reset" title="Сбросить прогресс колоды"><svg class="ic"><use href="#i-rotate"/></svg></button>
       </div>
     </div>
     <div class="train-progress"><div class="tp-fill" style="width:${pct}%"></div></div>
     <div class="tp-label mono"><span>выучено ${learnedTotal} из ${d.cards.length}</span><span>${pct}%</span></div>
     <div class="stage"><div class="card-stack">
       <div class="paper enter${S.reveal && !S.reveal.ok ? ' shake' : ''}" id="train-paper">
         <span class="card-tape" aria-hidden="true"></span>
         ${S.reveal ? `<span class="stamp ${S.reveal.ok ? 'ok' : S.reveal.skipped ? 'skip' : 'bad'}">${S.reveal.ok ? 'Верно!' : S.reveal.skipped ? 'Ответ' : 'Мимо'}</span>` : ''}
         <div class="paper-head">
           <span class="mono">выучено ${S.stats.closed} / ${S.total}${S.repeat.has(S.current) ? ' · на повторе' : ''}</span>
           ${multi ? '<span class="chip chip-multi">несколько ответов</span>' : ''}
         </div>
         <div class="paper-question">${esc(card.question)}</div>
         <div class="q-media" id="q-media"></div>
         <div class="opts">${ord.map((j, pos) => optHtml(card.answers[j], j, pos)).join('')}</div>
         ${multi && S.phase === 'question' ? '<p class="multi-note mono">отметьте все верные и нажмите «Проверить»</p>' : ''}
         ${card.hint ? `<div class="hint-panel" id="hint-panel"${S.hintShown ? '' : ' hidden'}>${hintHtml(card.hint)}</div>` : ''}
         ${S.reveal && card.explanation ? `<div class="explain-panel">${explainHtml(card.explanation)}</div>` : ''}
         <div class="paper-actions">
           ${S.phase === 'question' ? `
             ${card.hint ? `<button class="btn btn-paper" data-act="hint" aria-pressed="${S.hintShown}"><svg class="ic"><use href="#i-bulb"/></svg>Подсказка <kbd>H</kbd></button>` : ''}
             <button class="btn btn-paper" data-act="skip"><svg class="ic"><use href="#i-help"/></svg>Не знаю</button>
             ${multi ? `<button class="btn btn-primary" data-act="check" id="check-btn" disabled><svg class="ic"><use href="#i-check"/></svg>Проверить (<span id="check-n">0</span>)</button>` : ''}
           ` : `<button class="btn btn-next" data-act="next">Дальше <svg class="ic"><use href="#i-arrow-r"/></svg></button>`}
         </div>
         <div class="kbd-line mono">клавиши: <kbd>1–9</kbd> ответ · <kbd>H</kbd> подсказка · <kbd>Enter</kbd> ${S.phase === 'question' ? 'проверить' : 'дальше'} · клик по фото — полный экран</div>
         <span class="sr-only" role="status">${S.reveal ? (S.reveal.ok ? 'Верно, карточка выучена' : 'Неверно, правильные варианты подсвечены') : ''}</span>
       </div>
     </div></div>`;

  media.renderInto($('#q-media', root), d.id, card.media);
  root.querySelectorAll('.opt-media').forEach(el =>
    media.renderInto(el, d.id, el.dataset.m.split('|'), { small: true }));
}

function resultsHtml() {
  if (S.already) {
    return `<div class="results">
      <div class="trophy-wrap"><svg class="ic trophy"><use href="#i-trophy"/></svg></div>
      <h1 class="res-title">Колода уже <span class="grad-text">выучена</span> 🎓</h1>
      <p class="res-sub">Все карточки «${esc(S.deck.title)}» закрыты. Хотите освежить память — пройдите заново.</p>
      <div class="res-actions">
        <button class="btn btn-primary btn-lg" data-act="replay"><svg class="ic"><use href="#i-rotate"/></svg>Пройти ещё раз</button>
        <button class="btn btn-ghost btn-lg" data-act="to-library">Другая колода</button>
      </div>
    </div>`;
  }
  const st = S.stats;
  const acc = Math.round(S.total / (S.total + st.errors) * 100);
  const perfect = st.errors === 0;
  const stumbles = Object.entries(st.perCard).sort((a, b) => b[1] - a[1]);
  const tile = (v, label, acc_) =>
    `<div class="res-tile acc-${acc_}"><b>${v}</b><span>${label}</span></div>`;
  return `<div class="results">
    <div class="trophy-wrap"><svg class="ic trophy"><use href="#i-trophy"/></svg></div>
    <h1 class="res-title">ВСЁ <span class="grad-text">ВЫУЧЕНО!</span></h1>
    ${perfect
      ? '<div class="perfect-badge"><svg class="ic"><use href="#i-sparkle"/></svg>Ни одной ошибки — все карточки с первого раза!</div>'
      : '<p class="res-sub">Колода закрыта. Ошибки — это карта того, что стоит повторить завтра.</p>'}
    <div class="res-stats">
      ${tile(st.closed, 'карточек', 'cyan')}
      ${tile(st.errors, 'ошибок', st.errors ? 'magenta' : 'lime')}
      ${tile(acc + '%', 'точность', 'violet')}
      ${tile(st.best, 'лучшая серия', 'amber')}
      ${tile(fmtTime(S.time), 'время', 'cyan')}
    </div>
    ${stumbles.length ? `<div class="stumble-panel">
      <h3><svg class="ic"><use href="#i-eye"/></svg>Где вы запинались</h3>
      <p class="sp-note mono">по убыванию ошибок · нажмите, чтобы посмотреть разбор</p>
      <div class="stumble-list">${stumbles.map(([i, n]) =>
        `<button class="stumble-row" data-act="review" data-i="${i}">
           <span class="sr-q">${esc(firstLine(S.deck.cards[+i].question))}</span>
           <span class="chip chip-err mono">×${n}</span>
         </button>`).join('')}</div>
    </div>` : ''}
    <div class="res-actions">
      <button class="btn btn-primary btn-lg" data-act="replay"><svg class="ic"><use href="#i-rotate"/></svg>Пройти ещё раз</button>
      <button class="btn btn-ghost btn-lg" data-act="to-library">Другая колода</button>
      <button class="btn btn-ghost btn-lg" data-act="to-constructor">В конструктор</button>
    </div>
  </div>`;
}