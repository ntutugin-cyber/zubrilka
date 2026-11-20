/* Звуковые сигналы на WebAudio — без аудиофайлов. Читают settings.sound. */
import { settings } from './store.js';

let ctx = null, master = null;

function ensure() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.4;
    master.connect(ctx.destination);
  }
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  return ctx;
}

export function init() {
  const unlock = () => {
    ensure();
    document.removeEventListener('pointerdown', unlock);
    document.removeEventListener('keydown', unlock);
  };
  document.addEventListener('pointerdown', unlock);
  document.addEventListener('keydown', unlock);
}

function note(f, { t = 0, d = 0.14, type = 'sine', v = 0.5, to } = {}) {
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.type = type;
  const t0 = ctx.currentTime + t;
  o.frequency.setValueAtTime(f, t0);
  if (to) o.frequency.exponentialRampToValueAtTime(to, t0 + d);
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(v, t0 + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0008, t0 + d);
  o.connect(g).connect(master);
  o.start(t0); o.stop(t0 + d + 0.06);
}

export function play(name) {
  if (!settings.sound) return;
  if (!ensure()) return;
  try {
    switch (name) {
      case 'tick':    note(1600, { d: .04, type: 'square', v: .06 }); break;
      case 'select':  note(540, { d: .06, v: .18 }); note(720, { t: .05, d: .06, v: .14 }); break;
      case 'correct': note(660, { d: .1, v: .3 }); note(880, { t: .08, d: .14, v: .3 }); note(1320, { t: .16, d: .18, type: 'triangle', v: .2 }); break;
      case 'wrong':   note(180, { d: .22, type: 'sawtooth', v: .22, to: 110 }); note(90, { t: .05, d: .25, type: 'square', v: .12, to: 60 }); break;
      case 'learn':   [523, 659, 784].forEach((f, i) => note(f, { t: i * .07, d: .12, type: 'triangle', v: .26 })); break;
      case 'flip':    note(300, { d: .09, v: .14, to: 640 }); break;
      case 'hint':    note(980, { d: .07, v: .16 }); note(1240, { t: .07, d: .09, v: .14 }); break;
      case 'fanfare':
        [523, 659, 784, 1046, 784, 1046, 1318].forEach((f, i) => note(f, { t: i * .11, d: .16, type: 'triangle', v: .3 }));
        [131, 196].forEach((f, i) => note(f, { t: i * .33, d: .3, v: .25 }));
        break;
    }
  } catch { /* звук не критичен */ }
}