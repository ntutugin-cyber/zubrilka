/* Медиа: реестр файлов колоды, резолв (локальные файлы → http рядом с XML → media/),
   objectURL-кэш, рендер картинок и аудиоплеера. */
import * as idb from './idb.js';
import { settings } from './store.js';
import { esc, uid } from './utils.js';

const regs = new Map();   // deckId → { files:Map(name→Blob), base:URL|null }
const cache = new Map();  // deckId|name → { url, kind, blob } | { missing:true }
const pending = new Map();

const IMG = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'avif', 'bmp'];
const AUD = ['mp3', 'ogg', 'wav', 'm4a', 'aac', 'flac'];
export const kindOf = n => {
  const e = String(n).split('.').pop().toLowerCase();
  return IMG.includes(e) ? 'image' : AUD.includes(e) ? 'audio' : null;
};

const reg = id => {
  let r = regs.get(id);
  if (!r) { r = { files: new Map(), base: null }; regs.set(id, r); }
  return r;
};

/* items: File[] или [{name, blob, path?}] */
export function registerFiles(id, items) {
  const r = reg(id);
  for (const it of items || []) {
    const blob = it.blob || it;
    const name = it.name || blob.name;
    if (!name || !blob) continue;
    r.files.set(name, blob);
    const base = name.split('/').pop();
    if (!r.files.has(base)) r.files.set(base, blob);
    if (it.path && it.path !== name) r.files.set(it.path, blob);
  }
}

export function setBase(id, url) { reg(id).base = url; }
export const getFiles = id => reg(id).files;

export function copyFiles(from, to) {
  const items = [], seen = new Set();
  for (const [name, blob] of reg(from).files) {
    if (seen.has(blob)) continue;
    seen.add(blob);
    items.push({ name: blob.name || name.split('/').pop(), blob });
  }
  registerFiles(to, items);
  return items;
}

export async function loadFromIDB(id) {
  const items = await idb.getByDeck(id);
  if (items.length) registerFiles(id, items);
  return items;
}
export async function persistFiles(id, items) {
  if (!settings.persist || !items?.length) return;
  await idb.putMany(id, items);
}

function findLocal(r, name) {
  if (r.files.has(name)) return r.files.get(name);
  const base = name.split('/').pop();
  if (r.files.has(base)) return r.files.get(base);
  for (const [k, b] of r.files)
    if (k.endsWith('/' + name) || k.endsWith('/' + base)) return b;
  return null;
}

export async function resolve(id, name) {
  const key = id + '|' + name;
  if (cache.has(key)) return cache.get(key);
  if (pending.has(key)) return pending.get(key);
  const p = (async () => {
    const r = reg(id);
    let blob = findLocal(r, name);
    if (!blob && r.base) {
      const base = name.split('/').pop();
      for (const cand of [name, 'media/' + base, base]) {
        try {
          const resp = await fetch(new URL(cand, r.base));
          if (resp.ok) { blob = await resp.blob(); break; }
        } catch { /* пробуем следующий путь */ }
      }
    }
    const res = blob
      ? { url: URL.createObjectURL(blob), kind: kindOf(name) || 'image', blob }
      : { missing: true };
    cache.set(key, res);
    return res;
  })();
  pending.set(key, p);
  try { return await p; } finally { pending.delete(key); }
}

export function release(id) {
  for (const [k, v] of [...cache]) {
    if (k.startsWith(id + '|')) {
      if (v.url) URL.revokeObjectURL(v.url);
      cache.delete(k);
    }
  }
  regs.delete(id);
}

export function collectNames(cards) {
  const set = new Set();
  for (const c of cards || []) {
    (c.media || []).forEach(n => set.add(n));
    for (const a of c.answers || []) (a.media || []).forEach(n => set.add(n));
  }
  return [...set];
}

export async function gatherBlobs(id, names) {
  const items = [], missing = [], seen = new Set();
  for (const n of names || []) {
    const base = n.split('/').pop();
    if (seen.has(base)) continue;
    seen.add(base);
    const r = await resolve(id, n);
    if (r.blob) items.push({ name: base, blob: r.blob });
    else missing.push(base);
  }
  return { items, missing };
}

/* Рендер медиа в контейнер. Токен защищает от устаревших асинхронных вставок. */
export async function renderInto(container, id, names, opts = {}) {
  if (!container || !names?.length) return;
  const token = uid();
  container.dataset.mtok = token;
  for (const name of names) {
    const r = await resolve(id, name);
    if (!container.isConnected || container.dataset.mtok !== token) return;
    const base = name.split('/').pop();
    if (r.missing) {
      container.insertAdjacentHTML('beforeend',
        `<span class="media-missing">⚠ файл не найден: ${esc(base)}</span>`);
      continue;
    }
    if (r.kind === 'image') {
      const fig = document.createElement('figure');
      fig.className = 'media-fig' + (opts.small ? ' small' : '');
      fig.innerHTML = `<img src="${r.url}" alt="${esc(base)}" loading="lazy" data-lightbox="${r.url}">`;
      container.append(fig);
    } else {
      container.append(buildAudio(r.url, base));
    }
  }
}

let currentAudio = null;
const fmt = s => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

function buildAudio(url, name) {
  const wrap = document.createElement('div');
  wrap.className = 'audio-player';
  wrap.innerHTML =
    `<button class="ap-play" type="button" aria-label="Воспроизвести ${esc(name)}"><svg class="ic"><use href="#i-play"/></svg></button>
     <div class="ap-body"><span class="ap-name">${esc(name)}</span><div class="ap-track"><div class="ap-fill"></div></div></div>
     <span class="ap-time">0:00</span><audio preload="metadata" src="${url}"></audio>`;
  const audio = wrap.querySelector('audio'), btn = wrap.querySelector('.ap-play'),
        use = btn.querySelector('use'), fill = wrap.querySelector('.ap-fill'),
        time = wrap.querySelector('.ap-time');
  btn.addEventListener('click', e => {
    e.stopPropagation();
    if (audio.paused) {
      if (currentAudio && currentAudio !== audio) currentAudio.pause();
      currentAudio = audio;
      audio.play().catch(() => {});
    } else audio.pause();
  });
  const setIcon = playing => {
    use.setAttribute('href', playing ? '#i-pause' : '#i-play');
    wrap.classList.toggle('playing', playing);
  };
  audio.addEventListener('play', () => setIcon(true));
  audio.addEventListener('pause', () => setIcon(false));
  audio.addEventListener('ended', () => { setIcon(false); fill.style.width = '0%'; time.textContent = '0:00'; });
  audio.addEventListener('timeupdate', () => {
    if (audio.duration) {
      fill.style.width = (audio.currentTime / audio.duration * 100) + '%';
      time.textContent = fmt(audio.currentTime);
    }
  });
  return wrap;
}