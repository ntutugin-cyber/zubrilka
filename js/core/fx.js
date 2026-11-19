/* Конфетти: один canvas, один rAF-цикл, живёт только пока есть частицы. */
const COLORS = ['#8f6bff', '#ff4fa3', '#a8e830', '#ffb43a', '#3fd9ff', '#ff5063'];
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
let cv, cx, parts = [], raf = null, W = 0, H = 0;

export function init(canvas) {
  cv = canvas; cx = cv.getContext('2d');
  resize();
  addEventListener('resize', resize);
}
function resize() {
  const dpr = Math.min(devicePixelRatio || 1, 2);
  W = innerWidth; H = innerHeight;
  cv.width = W * dpr; cv.height = H * dpr;
  cx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function spawn(x, y, n, spread = Math.PI * 2, base = -Math.PI / 2, power = 9) {
  for (let i = 0; i < n; i++) {
    const a = base + (Math.random() - .5) * spread;
    const v = power * (.4 + Math.random() * .9);
    parts.push({
      x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v,
      g: .22 + Math.random() * .12, rot: Math.random() * 6.3, vr: (Math.random() - .5) * .3,
      s: 4 + Math.random() * 6, c: COLORS[(Math.random() * COLORS.length) | 0],
      life: 1, decay: .012 + Math.random() * .012, shape: Math.random() < .35 ? 'c' : 'r'
    });
  }
  if (parts.length > 500) parts.splice(0, parts.length - 500);
  if (!raf) raf = requestAnimationFrame(loop);
}

function loop() {
  cx.clearRect(0, 0, W, H);
  parts = parts.filter(p => p.life > 0 && p.y < H + 40);
  for (const p of parts) {
    p.vy += p.g; p.vx *= .985; p.vy *= .99;
    p.x += p.vx; p.y += p.vy; p.rot += p.vr; p.life -= p.decay;
    cx.save();
    cx.globalAlpha = Math.max(p.life, 0);
    cx.translate(p.x, p.y); cx.rotate(p.rot);
    cx.fillStyle = p.c;
    if (p.shape === 'c') { cx.beginPath(); cx.arc(0, 0, p.s / 2, 0, 6.3); cx.fill(); }
    else cx.fillRect(-p.s / 2, -p.s / 2, p.s, p.s * .6);
    cx.restore();
  }
  if (parts.length) raf = requestAnimationFrame(loop);
  else { raf = null; cx.clearRect(0, 0, W, H); }
}

export function burst(x, y, n = 26) { if (!reduced) spawn(x, y, n); }
export function burstAt(el, n = 24) {
  if (reduced || !el) return;
  const r = el.getBoundingClientRect();
  spawn(r.left + r.width / 2, r.top + 40, n, Math.PI * 1.2, -Math.PI / 2, 8);
}
export function celebrate() {
  if (reduced) return;
  spawn(W * .5, H * .35, 60, Math.PI * 2, 0, 10);
  setTimeout(() => spawn(W * .15, H * .7, 50, Math.PI * .9, -Math.PI / 2, 13), 150);
  setTimeout(() => spawn(W * .85, H * .7, 50, Math.PI * .9, -Math.PI / 2, 13), 320);
  setTimeout(() => spawn(W * .5, H * .2, 40, Math.PI * 2, 0, 8), 550);
}