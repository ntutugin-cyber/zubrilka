/* Полноэкранный просмотр: колесо/щипок — зум, перетаскивание, dblclick, Esc. */
import { clamp, esc } from '../core/utils.js';

let root = null, active = null;
export const isOpen = () => !!active;

export function init(el) {
  root = el;
  document.addEventListener('click', e => {
    const img = e.target.closest('img[data-lightbox]');
    if (img) { e.preventDefault(); e.stopPropagation(); open(img.dataset.lightbox, img.alt); }
  });
}

function open(url, alt) {
  if (active) active.close();
  const ov = document.createElement('div');
  ov.className = 'lb';
  ov.innerHTML =
    `<div class="lb-bar">
       <button class="btn btn-icon lb-out" title="Уменьшить"><svg class="ic"><use href="#i-zoom-out"/></svg></button>
       <span class="lb-pct mono">100%</span>
       <button class="btn btn-icon lb-in" title="Увеличить"><svg class="ic"><use href="#i-zoom-in"/></svg></button>
       <button class="btn btn-icon lb-fit" title="Сбросить масштаб"><svg class="ic"><use href="#i-expand"/></svg></button>
       <button class="btn btn-icon lb-x" title="Закрыть (Esc)"><svg class="ic"><use href="#i-x"/></svg></button>
     </div>
     <div class="lb-stage"><img src="${url}" alt="${esc(alt || '')}" draggable="false"></div>
     <div class="lb-hint mono">колесо / щипок — масштаб · перетаскивание — перенос · двойной клик — приблизить/сбросить · Esc — закрыть</div>`;
  root.append(ov);

  const stage = ov.querySelector('.lb-stage'),
        img = ov.querySelector('img'),
        pct = ov.querySelector('.lb-pct');
  let s = 1, tx = 0, ty = 0;
  const pointers = new Map();
  let pinch0 = null, pan0 = null;
  const ac = new AbortController();
  const sig = { signal: ac.signal };

  const apply = (smooth = false) => {
    img.classList.toggle('smooth', smooth);
    img.style.transform = `translate(${tx}px,${ty}px) scale(${s})`;
    pct.textContent = Math.round(s * 100) + '%';
  };
  const center = () => {
    const r = stage.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  };
  const zoomAt = (cx, cy, ns, smooth = false) => {
    ns = clamp(ns, .2, 8);
    const c = center();
    const px = (cx - c.x - tx) / s, py = (cy - c.y - ty) / s;
    tx = cx - c.x - px * ns; ty = cy - c.y - py * ns; s = ns;
    apply(smooth);
  };

  stage.addEventListener('wheel', e => {
    e.preventDefault();
    zoomAt(e.clientX, e.clientY, s * Math.exp(-e.deltaY * .0015));
  }, { passive: false, signal: ac.signal });

  stage.addEventListener('pointerdown', e => {
    stage.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinch0 = { d: Math.hypot(a.x - b.x, a.y - b.y), s, mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2, tx, ty };
      pan0 = null;
    } else {
      pan0 = { x: e.clientX, y: e.clientY, tx, ty };
    }
    img.classList.add('grabbing');
  }, sig);

  stage.addEventListener('pointermove', e => {
    if (!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 2 && pinch0) {
      const [a, b] = [...pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      const ns = clamp(pinch0.s * d / pinch0.d, .2, 8);
      const c = center();
      const px = (pinch0.mx - c.x - pinch0.tx) / pinch0.s,
            py = (pinch0.my - c.y - pinch0.ty) / pinch0.s;
      const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      tx = mx - c.x - px * ns; ty = my - c.y - py * ns; s = ns;
      apply();
    } else if (pan0) {
      tx = pan0.tx + (e.clientX - pan0.x);
      ty = pan0.ty + (e.clientY - pan0.y);
      apply();
    }
  }, sig);

  const up = e => {
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinch0 = null;
    if (pointers.size === 1) {
      const [p] = [...pointers.values()];
      pan0 = { x: p.x, y: p.y, tx, ty };
    } else if (!pointers.size) { pan0 = null; img.classList.remove('grabbing'); }
  };
  stage.addEventListener('pointerup', up, sig);
  stage.addEventListener('pointercancel', up, sig);

  stage.addEventListener('dblclick', e => {
    if (s > 1.05) { s = 1; tx = ty = 0; apply(true); }
    else zoomAt(e.clientX, e.clientY, 2.5, true);
  }, sig);

  ov.querySelector('.lb-in').onclick = () => { const c = center(); zoomAt(c.x, c.y, s * 1.3, true); };
  ov.querySelector('.lb-out').onclick = () => { const c = center(); zoomAt(c.x, c.y, s / 1.3, true); };
  ov.querySelector('.lb-fit').onclick = () => { s = 1; tx = ty = 0; apply(true); };

  const close = () => {
    ac.abort();
    document.removeEventListener('keydown', onKey, true);
    ov.classList.add('closing');
    setTimeout(() => ov.remove(), 180);
    active = null;
  };
  const onKey = e => { if (e.key === 'Escape') { e.stopImmediatePropagation(); close(); } };
  document.addEventListener('keydown', onKey, true);
  ov.querySelector('.lb-x').onclick = close;

  active = { close };
  apply();
}