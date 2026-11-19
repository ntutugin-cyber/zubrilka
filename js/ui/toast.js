import { esc } from '../core/utils.js';

const ICONS = { info: 'i-sparkle', success: 'i-check', warn: 'i-help', error: 'i-x' };
let root = null;

export function init(el) { root = el; }

export function show(msg, { type = 'info', timeout = 4500, action } = {}) {
  const t = document.createElement('div');
  t.className = 'toast t-' + type;
  t.innerHTML =
    `<svg class="ic t-ic"><use href="#${ICONS[type] || ICONS.info}"/></svg>
     <div class="t-msg">${esc(msg)}</div>
     ${action ? `<button class="t-act">${esc(action.label)}</button>` : ''}
     <button class="t-x" aria-label="Закрыть"><svg class="ic"><use href="#i-x"/></svg></button>`;
  root.append(t);
  while (root.children.length > 4) root.firstChild.remove();
  const kill = () => { t.classList.add('out'); setTimeout(() => t.remove(), 250); };
  const timer = setTimeout(kill, timeout);
  t.querySelector('.t-x').onclick = () => { clearTimeout(timer); kill(); };
  if (action) t.querySelector('.t-act').onclick = () => { clearTimeout(timer); kill(); action.fn(); };
  return t;
}

export const success = (m, o) => show(m, { ...o, type: 'success' });
export const warn = (m, o) => show(m, { ...o, type: 'warn' });
export const error = (m, o) => show(m, { ...o, type: 'error' });