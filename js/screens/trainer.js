/* Тренировка: порции, повторы, серия, подсказки, «Не знаю» (N).
   Карточка считается выученной после N верных ответов (цель меняется на лету).
   На вопросе видно: сколько верных осталось, сколько уже верно и сколько мимо. */
import { $, esc, cardKey, shuffle, clamp, fmtTime, plural, emit, on, hintHtml, explainHtml } from '../core/utils.js';
import * as store from '../core/store.js';
import { settings } from '../core/store.js';
import * as media from '../core/media.js';
import { play } from '../core/sfx.js';
import * as fx from '../core/fx.js';
import * as toast from '../ui/toast.js';
import * as modals from '../ui/modals.js';

let root = null, S = null;
let lastGoal = settings.goal, lastShuffle = settings.shuffle;

export const hasSession = () => !!S && !S.done;

export function init(el) {
  root = el;
  lastGoal = settings.goal; lastShuffle = settings.shuffle;
  bind();
  on('settings', onSettings);
  render();
}

const goalNow = () => Math.max(1, Math.min(9, Number(settings.goal) || 1));
const cur = () => S.deck.cards[S.current];
const isMulti = () => cur().answers.filter(a => a.correct).length > 1;
const firstLine = t => t.split('\n')[0];

function statOf(i) {
  const k = cardKey(S.deck.cards[i]);
  let c = S.counts.get(k);
  if (!c) { c = store.getCard(S.deck.id, k); S.counts.set(k, c); }
  return c;
}
const remainingOf = i => Math.max(0, goalNow() - statOf(i).ok);
const masteredOf = i => remainingOf(i) === 0;

export function start(deck) {
  const learned = new Set(store.getProgress(deck.id).learned);
  const idxs = deck.cards.map((_, i) => i);
  const need = shuffle(idxs.filter(i => !learned.has(cardKey(deck.cards[i]))));
  if (!need.length) {
    S = { deck, learned, counts: new Map(), done: true, already: true, baseMastered: idxs.length };
    render(); return;
  }
  const batch = settings.batch > 0 ? settings.batch : need.length;
  const order = new Map();
  for (const i of idxs) {
    const ord = deck.cards[i].answers.map((_, j) => j);
    order.set(i, settings.shuffle ? shuffle(ord) : ord);
  }
  S = {
    deck, learned, counts: new Map(), order,
    portion: need.slice(0, batch), reserve: need.slice(batch),
    repeat: new Set(), current: need[0],
    selected: new Set(), phase: 'question', reveal: null,
    hintShown: false, hintCounted: false, done: false, already: false,
    baseMastered: idxs.length - need.length,
    stats: { errors: 0, perCard: {}, streak: 0, best: 0, hints: 0, start: Date.now() }
  };
  render(); play('flip');
}

/* ── настройки на лету: цель и перемешивание ── */
function onSettings(s) {
  if (!S) { lastGoal = s.goal; lastShuffle = s.shuffle; return; }
  if (!S.done) {
    if (s.shuffle !== lastShuffle) {
      for (let i = 0; i < S.deck.cards.length; i++) {
        const ord = S.deck.cards[i].answers.map((_, j) => j);
        S.order.set(i, s.shuffle ? shuffle(ord) : ord);
      }
    }
    if (s.goal !== lastGoal) rebuildQueue();
  }
  lastGoal = s.goal; lastShuffle = s.shuffle;
  render();
}

function rebuildQueue() {
  const learned = new Set(store.getProgress(S.deck.id).learned);
  S.learned = learned;
  S.counts = new Map();
  const need = S.deck.cards.map((_, i) => i).filter(i => !learned.has(cardKey(S.deck.cards[i])));
  const keep = S.phase === 'reveal' || need.includes(S.current);
  const head = keep ? S.current : null;
  const others = shuffle(need.filter(i => i !== S.current));
  const list = head != null ? [head, ...others] : others;
  const batch = Math.max(settings.batch > 0 ? settings.batch : list.length, head != null ? 1 : 0);
  S.portion = list.slice(0, batch);
  S.reserve = list.slice(S.portion.length);
  S.repeat = new Set([...S.repeat].filter(i => list.includes(i)));
  if (!S.portion.length) { finish(); return; }
  if (head == null) {
    S.current = S.portion[0];
    S.phase = 'question'; S.reveal = null; S.selected = new Set();
    S.hintShown = false; S.hintCounted = false;
  }
}

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
      case 'skip': skip(); break;
      case 'hint': toggleHint(); break;
      case 'goal-dec': setGoal(goalNow() - 1); break;
      case 'goal-inc': setGoal(goalNow() + 1); break;
      case 'exit': S = null; emit('navigate', { tab: 'library' }); render(); break;
      case 'reset': resetProgress(); break;
      case 'replay': replay(); break;
      case 'to-library': emit('navigate', { tab: 'library' }); break;
      case 'to-constructor': emit('navigate', { tab: 'construct' }); break;
      case 'review': modals.review(S.deck.cards[+btn.dataset.i], S.deck.id); break;
      case 'pick': emit('navigate', { tab: 'library' }); break;
    }
  });
  root.addEventListener('keydown', e => {
    if (!S || S.done || S.phase !== 'question') return;
    const o = e.target.closest('.opt[data-opt]');
    if (o && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault(); e.stopPropagation();
      choose(+o.dataset.opt);
    }
  });
}

function setGoal(v) {
  const g = clamp(v, 1, 9);
  if (g === goalNow()) return;
  store.setSetting('goal', g);
  play('tick');
  toast.show(`Цель: ${g} ${plural(g, 'верный ответ', 'верных ответа', 'верных ответов')} на карточку`, { timeout: 2200 });
}

function choose(i) {
  if (!S || S.done || S.phase !== 'question') return;
  if (isMulti()) {
    if (S.selected.has(i)) S.selected.delete(i); else S.selected.add(i);
    play('select');
    root.querySelectorAll('.opt[data-opt]').forEach(el => {
      const on_ = S.selected.has(+el.dataset.opt);
      el.classList.toggle('selected', on_);
      el.setAttribute('aria-pressed', String(on_));
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

function skip() {
  if (!S || S.done || S.phase !== 'question') return;
  reveal(false, true);
}

function reveal(ok, skipped) {
  const i = S.current, key = cardKey(cur());
  const st = { ...statOf(i) };
  if (ok) st.ok++; else { st.bad++; if (skipped) st.skip++; }
  S.counts.set(key, store.setCard(S.deck.id, key, st));

  S.phase = 'reveal';
  S.reveal = { ok, skipped, chosen: new Set(S.selected) };

  if (ok) {
    S.stats.streak++;
    S.stats.best = Math.max(S.stats.best, S.stats.streak);
    if (masteredOf(i)) { S.learned.add(key); play('learn'); }
    else play('correct');
  } else {
    S.stats.errors++;
    S.stats.perCard[i] = (S.stats.perCard[i] || 0) + 1;
    S.stats.streak = 0;
    S.repeat.add(i);
    play('wrong');
  }
  render();
  if (ok) fx.burstAt($('#train-paper', root), masteredOf(i) ? 34 : 18);
  root.querySelector('[data-act="next"]')?.focus({ preventScroll: true });
  emit('progress');
}

function next() {
  if (!S || S.done || S.phase !== 'reveal') return;
  const i = S.current;
  if (masteredOf(i)) {
    S.learned.add(cardKey(S.deck.cards[i]));
    S.repeat.delete(i);
    S.portion.shift();
  } else {
    S.portion.push(S.portion.shift());
  }
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

function sessionNumbers() {
  const masteredNow = S.deck.cards.filter(c => S.learned.has(cardKey(c))).length;
  const closed = Math.max(0, masteredNow - S.baseMastered);
  const total = Math.max(closed, S.deck.cards.length - S.baseMastered);
  return { closed, total, masteredNow };
}

function finish() {
  S.done = true;
  S.time = Date.now() - S.stats.start;
  const errByKey = {};
  for (const [i, n] of Object.entries(S.stats.perCard)) errByKey[cardKey(S.deck.cards[+i])] = n;
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
  root.querySelector('[data-act="hint"]')?.setAttribute('aria-pressed', String(S.hintShown));
  if (S.hintShown) {
    play('hint');
    if (!S.hintCounted) { S.hintCounted = true; S.stats.hints++; }
  }
}

async function resetProgress() {
  if (!S) return;
  if (await modals.confirmAction({
    title: 'Сбросить прогресс колоды?',
    text: `Все счётчики «верно / мимо» и отметки «выучено» колоды «${S.deck.title}» будут очищены.`,
    ok: 'Сбросить'
  })) {
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
    text: 'Счётчики этой колоды будут сброшены, и все карточки вернутся в работу.',
    ok: 'Начать заново', danger: false
  })) {
    store.resetDeckProgress(deck.id);
    start(deck);
  }
}

/* ── клавиатура: 1–9 ответ, H подсказка, N «не знаю», Enter проверить/дальше ── */
export function handleKey(e) {
  if (!S || S.done) return false;
  const m = /^(Digit|Numpad)([1-9])$/.exec(e.code);
  if (m && S.phase === 'question') {
    const pos = +m[2] - 1, ord = S.order.get(S.current);
    if (pos < ord.length) { e.preventDefault(); choose(ord[pos]); }
    return true;
  }
  if (e.code === 'KeyH') { e.preventDefault(); toggleHint(); return true; }
  if (e.code === 'KeyN') { e.preventDefault(); skip(); return true; }
  if (e.key === 'Enter') {
    if (S.phase === 'reveal') { e.preventDefault(); next(); }
    else if (S.phase === 'question' && isMulti() && S.selected.size) { e.preventDefault(); check(); }
    return true;
  }
  return false;
}

/* ── блоки статистики карточки ── */
function masteryHtml(i) {
  const st = statOf(i), goal = goalNow(), rem = Math.max(0, goal - st.ok);
  const pips = goal <= 8
    ? `<div class="m-pips" aria-hidden="true">${Array.from({ length: goal }, (_, k) =>
        `<span class="pip${k < st.ok ? ' on' : (k === st.ok ? ' next' : '')}"></span>`).join('')}</div>`
    : `<div class="m-pips m-pips-num mono" aria-hidden="true"><b>${st.ok}</b>/${goal}</div>`;
  const left = rem > 0
    ? `<div class="m-left"><b>осталось ${rem}</b><span>${plural(rem, 'верный ответ', 'верных ответа', 'верных ответов')} до «выучено»</span></div>`
    : `<div class="m-left done"><b>выучено 🎓</b><span>цель достигнута</span></div>`;
  const wrong = Math.max(0, st.bad - st.skip);
  const badTitle = `Неверных ответов: ${wrong} · «Не знаю»: ${st.skip}`;
  return `<div class="mastery">${pips}${left}
    <div class="m-counts">
      <span class="chip chip-ok" title="Сколько раз вы ответили на эту карточку верно">✓ верно: ${st.ok}</span>
      <span class="chip chip-bad" title="${esc(badTitle)}">✗ мимо: ${st.bad}</span>
      ${st.skip ? `<span class="chip chip-amber" title="Сколько раз нажали «Не знаю»">🤷 ${st.skip}</span>` : ''}
    </div>
  </div>`;
}

function verdictHtml() {
  const st = statOf(S.current), rem = Math.max(0, goalNow() - st.ok);
  const tail = `${rem} ${plural(rem, 'верный ответ', 'верных ответа', 'верных ответов')}`;
  if (S.reveal.ok) {
    return rem === 0
      ? `<div class="verdict ok"><svg class="ic"><use href="#i-trophy"/></svg>Карточка выучена: ${st.ok} ${plural(st.ok, 'верный ответ', 'верных ответа', 'верных ответов')}!</div>`
      : `<div class="verdict ok"><svg class="ic"><use href="#i-check"/></svg>Верно! До «выучено» осталось ещё ${tail}.</div>`;
  }
  if (S.reveal.skipped)
    return `<div class="verdict skip"><svg class="ic"><use href="#i-help"/></svg>Ответ показан. Карточка вернётся в очередь — до «выучено» ещё ${tail}.</div>`;
  return `<div class="verdict bad"><svg class="ic"><use href="#i-x"/></svg>Мимо. Карточка вернётся в очередь — до «выучено» ещё ${tail}.</div>`;
}

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
  const { closed, total, masteredNow } = sessionNumbers();
  const pct = Math.round(masteredNow / d.cards.length * 100);
  const goal = goalNow();
  const mastered = masteredOf(S.current);
  const stampCls = S.reveal ? (S.reveal.ok ? (mastered ? 'ok' : 'ok') : S.reveal.skipped ? 'skip' : 'bad') : '';
  const stampTxt = S.reveal ? (S.reveal.ok ? (mastered ? 'Выучено!' : 'Верно!') : S.reveal.skipped ? 'Ответ' : 'Мимо') : '';
  const status = S.reveal
    ? (S.reveal.ok
        ? (mastered ? 'Верно, карточка выучена' : `Верно. Осталось ${remainingOf(S.current)} верных ответов`)
        : 'Неверно, правильные варианты подсвечены')
    : `Осталось ${remainingOf(S.current)} верных ответов до выучивания`;

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
         <div class="goal-step" role="group" aria-label="Сколько верных ответов нужно, чтобы карточка считалась выученной">
           <button class="gs-btn" data-act="goal-dec" title="Меньше верных ответов для «выучено»" ${goal <= 1 ? 'disabled' : ''} aria-label="Уменьшить цель">−</button>
           <span class="gs-val mono" title="Столько раз нужно ответить верно (не обязательно подряд)">цель: <b>${goal}</b> ✓</span>
           <button class="gs-btn" data-act="goal-inc" title="Больше верных ответов для «выучено»" ${goal >= 9 ? 'disabled' : ''} aria-label="Увеличить цель">+</button>
         </div>
         <button class="btn btn-icon btn-ghost" data-act="reset" title="Сбросить прогресс колоды"><svg class="ic"><use href="#i-rotate"/></svg></button>
       </div>
     </div>
     <div class="train-progress"><div class="tp-fill" style="width:${pct}%"></div></div>
     <div class="tp-label mono"><span>выучено ${masteredNow} из ${d.cards.length}</span><span>${pct}%</span></div>
     <div class="stage"><div class="card-stack">
       <div class="paper enter${S.reveal && !S.reveal.ok ? ' shake' : ''}" id="train-paper">
         <span class="card-tape" aria-hidden="true"></span>
         ${S.reveal ? `<span class="stamp ${stampCls}">${stampTxt}</span>` : ''}
         <div class="paper-head">
           <span class="mono">закрыто ${closed} / ${total}${S.repeat.has(S.current) ? ' · на повторе' : ''}</span>
           ${multi ? '<span class="chip chip-multi">несколько ответов</span>' : ''}
         </div>
         ${masteryHtml(S.current)}
         <div class="paper-question">${esc(card.question)}</div>
         <div class="q-media" id="q-media"></div>
         <div class="opts">${ord.map((j, pos) => optHtml(card.answers[j], j, pos)).join('')}</div>
         ${multi && S.phase === 'question' ? '<p class="multi-note mono">отметьте все верные и нажмите «Проверить»</p>' : ''}
         ${card.hint ? `<div class="hint-panel" id="hint-panel"${S.hintShown ? '' : ' hidden'}>${hintHtml(card.hint)}</div>` : ''}
         ${S.reveal ? verdictHtml() : ''}
         ${S.reveal && card.explanation ? `<div class="explain-panel">${explainHtml(card.explanation)}</div>` : ''}
         <div class="paper-actions">
           ${S.phase === 'question' ? `
             ${card.hint ? `<button class="btn btn-paper" data-act="hint" aria-pressed="${S.hintShown}"><svg class="ic"><use href="#i-bulb"/></svg>Подсказка <kbd>H</kbd></button>` : ''}
             <button class="btn btn-paper" data-act="skip"><svg class="ic"><use href="#i-help"/></svg>Не знаю <kbd>N</kbd></button>
             ${multi ? `<button class="btn btn-primary" data-act="check" id="check-btn" disabled><svg class="ic"><use href="#i-check"/></svg>Проверить (<span id="check-n">0</span>)</button>` : ''}
           ` : `<button class="btn btn-next" data-act="next">${mastered ? 'Дальше' : 'Ещё раз потом — дальше'} <svg class="ic"><use href="#i-arrow-r"/></svg></button>`}
         </div>
         <div class="kbd-line mono">клавиши: <kbd>1–9</kbd> ответ · <kbd>H</kbd> подсказка · <kbd>N</kbd> не знаю · <kbd>Enter</kbd> ${S.phase === 'question' ? 'проверить' : 'дальше'} · клик по фото — полный экран</div>
         <span class="sr-only" role="status">${esc(status)}</span>
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
      <p class="res-sub">Все карточки «${esc(S.deck.title)}» набрали нужное число верных ответов. Хотите освежить память — пройдите заново.</p>
      <div class="res-actions">
        <button class="btn btn-primary btn-lg" data-act="replay"><svg class="ic"><use href="#i-rotate"/></svg>Пройти ещё раз</button>
        <button class="btn btn-ghost btn-lg" data-act="to-library">Другая колода</button>
      </div>
    </div>`;
  }
  const st = S.stats;
  const { closed } = sessionNumbers();
  const attempts = closed + st.errors;
  const acc = attempts ? Math.round(closed / attempts * 100) : 100;
  const perfect = st.errors === 0;
  const stumbles = Object.entries(st.perCard).sort((a, b) => b[1] - a[1]);
  const tile = (v, label, a) => `<div class="res-tile acc-${a}"><b>${v}</b><span>${label}</span></div>`;
  return `<div class="results">
    <div class="trophy-wrap"><svg class="ic trophy"><use href="#i-trophy"/></svg></div>
    <h1 class="res-title">ВСЁ <span class="grad-text">ВЫУЧЕНО!</span></h1>
    ${perfect
      ? '<div class="perfect-badge"><svg class="ic"><use href="#i-sparkle"/></svg>Ни одной ошибки — все карточки с первого раза!</div>'
      : '<p class="res-sub">Колода закрыта. Ошибки — это карта того, что стоит повторить завтра.</p>'}
    <div class="res-stats">
      ${tile(closed, 'карточек', 'cyan')}
      ${tile(st.errors, 'ошибок', st.errors ? 'magenta' : 'lime')}
      ${tile(acc + '%', 'точность', 'violet')}
      ${tile(st.best, 'лучшая серия', 'amber')}
      ${tile(fmtTime(S.time), 'время', 'cyan')}
    </div>
    <p class="sp-note mono">цель подхода: ${goalNow()} ${plural(goalNow(), 'верный ответ', 'верных ответа', 'верных ответов')} на карточку</p>
    ${stumbles.length ? `<div class="stumble-panel">
      <h3><svg class="ic"><use href="#i-eye"/></svg>Где вы запинались</h3>
      <p class="sp-note mono">по убыванию ошибок · нажмите, чтобы посмотреть разбор и счётчики</p>
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