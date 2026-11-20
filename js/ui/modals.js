/* Менеджер модалок + confirm + настройки + правило + просмотр XML + разбор карточки. */
import { $, $$, esc, download, cardKey, plural, hintHtml, explainHtml } from '../core/utils.js';
import * as store from '../core/store.js';
import { settings, RULE, LADDER } from '../core/store.js';
import * as media from '../core/media.js';
import { play } from '../core/sfx.js';
import * as toast from './toast.js';

let root = null, count = 0;
export function init(el) { root = el; }
export const isOpen = () => count > 0;

export function open({ title, body, footer, wide = false, onClose, locked = false }) {
  const prev = document.activeElement;
  count++;
  const ov = document.createElement('div');
  ov.className = 'modal-overlay';
  ov.innerHTML =
    `<div class="modal${wide ? ' wide' : ''}" role="dialog" aria-modal="true" aria-label="${esc(title)}" tabindex="-1">
       <div class="modal-head"><h3>${esc(title)}</h3>
         <button class="btn btn-icon btn-ghost m-x" aria-label="Закрыть"><svg class="ic"><use href="#i-x"/></svg></button>
       </div>
       <div class="modal-body"></div>
       ${footer ? '<div class="modal-foot"></div>' : ''}
     </div>`;
  const bodyEl = ov.querySelector('.modal-body');
  if (typeof body === 'string') bodyEl.innerHTML = body;
  else if (body) bodyEl.append(body);
  const footEl = ov.querySelector('.modal-foot');
  if (footer && footEl) {
    if (typeof footer === 'string') footEl.innerHTML = footer;
    else footEl.append(footer);
  }
  root.append(ov);
  const dlg = ov.querySelector('.modal');
  let closed = false;

  const close = () => {
    if (closed) return;
    closed = true; count--;
    ov.classList.add('closing');
    setTimeout(() => ov.remove(), 200);
    document.removeEventListener('keydown', onKey, true);
    prev?.focus?.();
    onClose?.();
  };
  const onKey = e => {
    if (root.lastElementChild !== ov) return;
    if (e.key === 'Escape') {
      e.stopImmediatePropagation();
      if (!locked) close();
    } else if (e.key === 'Tab') {
      const f = $$('button,[href],input,select,textarea,[tabindex]:not([tabindex="-1"])', dlg)
        .filter(x => !x.disabled && x.offsetParent !== null);
      if (!f.length) return;
      const first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  };
  document.addEventListener('keydown', onKey, true);
  ov.addEventListener('pointerdown', e => { if (e.target === ov && !locked) close(); });
  ov.querySelector('.m-x').onclick = close;
  requestAnimationFrame(() => {
    ov.classList.add('in');
    (dlg.querySelector('input,select,textarea,button:not(.m-x)') || dlg).focus();
  });
  return { close, el: ov, body: bodyEl, footer: footEl };
}

export function confirmAction({ title = 'Подтвердите', text, ok = 'Удалить', cancel = 'Отмена', danger = true }) {
  return new Promise(res => {
    let done = false;
    const m = open({
      title,
      body: `<p class="confirm-text">${esc(text)}</p>`,
      footer: `<button class="btn btn-ghost c-no">${esc(cancel)}</button>
               <button class="btn ${danger ? 'btn-danger' : 'btn-primary'} c-yes">${esc(ok)}</button>`,
      onClose: () => { if (!done) res(false); }
    });
    m.footer.querySelector('.c-no').onclick = () => { done = true; res(false); m.close(); };
    m.footer.querySelector('.c-yes').onclick = () => { done = true; res(true); m.close(); };
  });
}

/* ── как считается «выучено» ── */
export function ruleModal() {
  const ladder = LADDER.map(v => `<span class="lad-step${v === RULE.cap ? ' cap' : ''}">${v}</span>`)
    .join('<span class="lad-arrow">→</span>');
  const body =
    `<div class="rule-body">
       <div class="rule-ladder">${ladder}<span class="lad-cap">максимум ${RULE.cap}</span></div>
       <ul class="rule-list">
         <li><b>Первый показ.</b> Ответили верно с первого раза — карточка выучена и больше не появляется.</li>
         <li><b>Ошибка или «Не знаю».</b> Серия «подряд» по этой карточке обнуляется, а требование <b>удваивается</b>: было 1 — станет 2, было 2 — станет 4, и так далее до ${RULE.cap}.</li>
         <li><b>Нужны именно подряд.</b> ${RULE.cap} верных с одной ошибкой посередине — это не ${RULE.cap} подряд: серия начнётся заново, а требование снова вырастет.</li>
         <li><b>Другие карточки не мешают.</b> Между повторами одной карточки идут остальные — серия считается только по ней.</li>
         <li><b>Всё сохраняется.</b> Требования и серии хранятся по каждой карточке; «сбросить прогресс» возвращает всё к одному верному ответу.</li>
       </ul>
       <div class="rule-eg">
         <div class="eg-row"><span class="chip chip-ok">✓ верно</span><span>новая карточка → <b>выучена</b>, больше не показывается</span></div>
         <div class="eg-row"><span class="chip chip-bad">✗ мимо</span><span>требование 1 → <b>2</b>, подряд 0/2</span></div>
         <div class="eg-row"><span class="chip chip-ok">✓ ✓</span><span>два верных подряд → <b>выучена</b></span></div>
         <div class="eg-row"><span class="chip chip-ok">✓</span><span class="chip chip-bad">✗</span><span>подряд обнулён, требование 2 → <b>4</b></span></div>
         <div class="eg-row"><span class="chip chip-bad">✗ ✗</span><span>требование 4 → 8 → <b>15</b> (дальше не растёт)</span></div>
       </div>
     </div>`;
  const m = open({ title: 'Как считается «выучено»', wide: true, body, footer: '<button class="btn btn-primary r-done">Понятно</button>' });
  m.footer.querySelector('.r-done').onclick = m.close;
}

const toggleRow = (id, label, desc, on_) =>
  `<div class="set-row">
     <div class="set-info"><label for="set-${id}">${label}</label><p>${desc}</p></div>
     <label class="switch"><input type="checkbox" id="set-${id}"${on_ ? ' checked' : ''}>
       <span class="sw-track"><span class="sw-knob"></span></span></label>
   </div>`;

export function settingsModal() {
  const s = settings;
  const body = document.createElement('div');
  body.className = 'settings-form';
  body.innerHTML =
    `<div class="set-row">
       <div class="set-info"><label for="set-batch">Порция карточек за подход</label>
         <p>Сколько карточек брать в работу одновременно. Остальные ждут в запасе.</p></div>
       <select id="set-batch" class="select">${[10, 20, 30, 50, 100, 0].map(v =>
         `<option value="${v}"${s.batch === v ? ' selected' : ''}>${v || 'все сразу'}</option>`).join('')}</select>
     </div>
     <div class="set-row">
       <div class="set-info"><label>Правило выучивания</label>
         <p>Первый верный ответ закрывает карточку. Ошибка или «Не знаю» обнуляет «подряд» и удваивает требование: ${LADDER.join(' → ')}.</p></div>
       <button class="btn btn-ghost btn-sm" id="set-rule"><svg class="ic"><use href="#i-help"/></svg>Подробнее</button>
     </div>` +
    toggleRow('shuffle', 'Перемешивать варианты ответов',
      'Если выключено (по умолчанию) — варианты идут в порядке из XML: важно для карточек «варианты 1 и 4».', s.shuffle) +
    toggleRow('sound', 'Звуковое сопровождение',
      'Сигналы: верный ответ, ошибка, выученная карточка, фанфары в конце.', s.sound) +
    toggleRow('persist', 'Сохранять прогресс, колоды и медиа',
      'localStorage + IndexedDB. Выключите — всё хранится до закрытия вкладки, старые записи и медиа удалятся.', s.persist) +
    `<div class="set-danger"><button class="btn btn-danger" id="set-reset">
       <svg class="ic"><use href="#i-rotate"/></svg>Сбросить весь прогресс</button></div>`;

  const m = open({ title: 'Настройки', body, footer: '<button class="btn btn-primary m-done">Готово</button>' });
  body.querySelector('#set-batch').onchange = e => { store.setSetting('batch', +e.target.value); play('tick'); };
  body.querySelector('#set-rule').onclick = () => ruleModal();

  for (const k of ['shuffle', 'sound', 'persist']) {
    body.querySelector('#set-' + k).onchange = async e => {
      if (k === 'persist' && !e.target.checked) {
        const ok = await confirmAction({
          title: 'Отключить сохранение?',
          text: 'Сохранённые колоды, прогресс и медиа будут удалены из браузера. Текущая сессия продолжит работать в памяти.',
          ok: 'Отключить и удалить'
        });
        if (!ok) { e.target.checked = true; return; }
      }
      store.setSetting(k, e.target.checked);
      if (k === 'sound' && e.target.checked) play('select');
      if (k === 'persist') toast.show(
        e.target.checked ? 'Сохранение включено' : 'Сохранение отключено — данные только в памяти',
        { type: e.target.checked ? 'success' : 'warn' });
    };
  }
  body.querySelector('#set-reset').onclick = async () => {
    if (await confirmAction({
      title: 'Сбросить весь прогресс?',
      text: 'Все требования, серии «подряд» и отметки «выучено» по всем колодам будут очищены. Сами колоды останутся.',
      ok: 'Сбросить'
    })) { store.resetAllProgress(); toast.success('Прогресс сброшен'); }
  };
  m.footer.querySelector('.m-done').onclick = m.close;
}

export async function copyText(t) {
  try { await navigator.clipboard.writeText(t); toast.success('Скопировано в буфер'); }
  catch {
    const ta = document.createElement('textarea');
    ta.value = t; document.body.append(ta); ta.select();
    try { document.execCommand('copy'); toast.success('Скопировано'); }
    catch { toast.error('Не удалось скопировать'); }
    ta.remove();
  }
}

export function xmlView(title, text, filename = 'deck.xml') {
  const m = open({
    title, wide: true,
    body: `<pre class="code-block"><code>${esc(text)}</code></pre>`,
    footer: `<button class="btn btn-ghost x-copy"><svg class="ic"><use href="#i-copy"/></svg>Копировать</button>
             <button class="btn btn-primary x-dl"><svg class="ic"><use href="#i-download"/></svg>Скачать</button>`
  });
  m.footer.querySelector('.x-copy').onclick = () => copyText(text);
  m.footer.querySelector('.x-dl').onclick = () =>
    download(new Blob([text], { type: 'application/xml' }), filename);
}

export function review(card, deckId) {
  const body = document.createElement('div');
  body.className = 'paper review-paper';
  const multi = card.answers.filter(a => a.correct).length > 1;
  const st = store.getCard(deckId, cardKey(card));
  const rem = Math.max(0, st.need - st.run);
  const ladder = `<div class="m-ladder">${LADDER.map(v =>
    `<span class="lad-step${v === st.need ? ' active' : (v < st.need ? ' passed' : '')}">${v}</span>`)
    .join('<span class="lad-arrow">→</span>')}</div>`;
  const track = st.need <= 8
    ? `<div class="m-pips" aria-hidden="true">${Array.from({ length: st.need }, (_, k) =>
        `<span class="pip${k < st.run ? ' on' : ''}"></span>`).join('')}</div>`
    : `<div class="m-track"><div class="m-bar"><i style="width:${Math.round(st.run / st.need * 100)}%"></i></div>
         <span class="m-run mono">${st.run}/${st.need}</span></div>`;

  body.innerHTML =
    `<div class="paper-head"><span class="mono">РАЗБОР КАРТОЧКИ</span>
       ${multi ? '<span class="chip chip-multi">несколько ответов</span>' : ''}</div>
     <div class="mastery">${ladder}
       <div class="m-row">${track}
         ${st.done
           ? '<div class="m-left done"><b>выучено 🎓</b><span>больше не появится</span></div>'
           : `<div class="m-left"><b>осталось подряд: ${rem}</b><span>из ${st.need}</span></div>`}
         <div class="m-counts">
           <span class="chip chip-ok">✓ верно: ${st.ok}</span>
           <span class="chip chip-bad" title="Неверных: ${Math.max(0, st.bad - st.skip)}">✗ мимо: ${st.bad}</span>
           ${st.skip ? `<span class="chip chip-amber" title="Нажали «Не знаю»">🤷 ${st.skip}</span>` : ''}
         </div>
       </div>
       <p class="m-note">${st.done
         ? `Закрыта: ${st.run} ${plural(st.run, 'верный ответ', 'верных ответа', 'верных ответов')} подряд.`
         : `Нужно ${st.need} верных подряд; следующая ошибка поднимет требование до ${Math.min(RULE.cap, st.need * RULE.mult)}.`}</p>
     </div>
     <div class="paper-question">${esc(card.question)}</div>
     <div class="q-media" data-qm></div>
     <div class="opts">${card.answers.map(a =>
       `<div class="opt static${a.correct ? ' is-correct' : ''}">
          <span class="opt-body"><span class="opt-text">${esc(a.text)}</span>
            ${a.media?.length ? `<span class="opt-media" data-m="${esc(a.media.join('|'))}"></span>` : ''}</span>
          ${a.correct ? '<svg class="ic opt-mark"><use href="#i-check"/></svg>' : ''}
        </div>`).join('')}</div>
     ${card.hint ? `<div class="hint-panel">${hintHtml(card.hint)}</div>` : ''}
     ${card.explanation ? `<div class="explain-panel">${explainHtml(card.explanation)}</div>` : ''}`;
  open({ title: 'Разбор карточки', wide: true, body });
  media.renderInto(body.querySelector('[data-qm]'), deckId, card.media);
  body.querySelectorAll('.opt-media').forEach(el =>
    media.renderInto(el, deckId, el.dataset.m.split('|'), { small: true }));
}