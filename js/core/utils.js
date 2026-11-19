/* Утилиты: DOM, строки, ключи карточек, шина событий */
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[c]));

export const norm = s => String(s || '').trim().replace(/\s+/g, ' ').toLowerCase();

export function hash(str) {
  let h = 5381;
  for (let i = 0; i < str.length; i++) h = ((h * 33) ^ str.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

/* Ключ карточки = вопрос + набор вариантов. Он же ключ дубликата и ключ прогресса. */
export const cardKey = c =>
  hash(norm(c.question) + '§' + c.answers.map(a => norm(a.text)).sort().join('§'));

export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

export const slug = s => (String(s || '').toLowerCase()
  .replace(/[^a-zа-яё0-9]+/gi, '-').replace(/^-+|-+$/g, '').slice(0, 40)) || 'deck';

export function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

export const deepClone = o =>
  typeof structuredClone === 'function' ? structuredClone(o) : JSON.parse(JSON.stringify(o));

export function fmtTime(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function plural(n, one, few, many) {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}

export function debounce(fn, ms) {
  let t = null;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

export function download(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/* Шина событий между модулями (без циклических импортов) */
const bus = new EventTarget();
export const emit = (type, detail) => bus.dispatchEvent(new CustomEvent(type, { detail }));
export const on = (type, fn) => bus.addEventListener(type, e => fn(e.detail));

/* Подсказка: текст + ссылки-плитки */
export function linkify(text) {
  const re = /https?:\/\/[^\s<>"')\]]+/g;
  const links = [];
  let html = '', last = 0, m;
  while ((m = re.exec(text))) {
    html += esc(text.slice(last, m.index));
    const url = m[0];
    html += `<a href="${esc(url)}" target="_blank" rel="noopener">${esc(url)}</a>`;
    let host = url;
    try { host = new URL(url).hostname; } catch { /* оставляем как есть */ }
    if (!links.some(l => l.url === url)) links.push({ url, host });
    last = m.index + url.length;
  }
  html += esc(text.slice(last));
  return { html, links };
}

export function hintHtml(hint) {
  const { html, links } = linkify(hint);
  return `<div class="panel-label">подсказка</div><div class="hint-text">${html}</div>` +
    (links.length ? `<div class="link-tiles">${links.map(l =>
      `<a class="link-tile" href="${esc(l.url)}" target="_blank" rel="noopener"><svg class="ic"><use href="#i-link"/></svg>${esc(l.host)}</a>`
    ).join('')}</div>` : '');
}

export function explainHtml(text) {
  const { html } = linkify(text);
  return `<div class="panel-label">пояснение</div><div class="hint-text">${html}</div>`;
}