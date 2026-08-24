/* SwapDraws — util.js : helpers, easing, RNG, events, DOM */
(function () {
  const SD = (window.SD = window.SD || {});

  const U = {
    // ── ids ──
    uid: (p = 'id') => p + '_' + Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4),

    // ── math ──
    clamp: (v, a, b) => Math.max(a, Math.min(b, v)),
    lerp: (a, b, t) => a + (b - a) * t,
    dist: (x1, y1, x2, y2) => Math.hypot(x2 - x1, y2 - y1),
    smoothstep: (t) => t * t * (3 - 2 * t),

    // ── easing (input 0..1 → 0..1) ──
    ease: {
      linear: (t) => t,
      easeIn: (t) => t * t * t,
      easeOut: (t) => 1 - Math.pow(1 - t, 3),
      easeInOut: (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
      bounceSoft: (t) => { // gentle overshoot at the end
        if (t >= 1) return 1;
        const c = 0.18;
        return t < 1 - c ? U.smoothstep(t / (1 - c)) * 0.98 : 0.98 + Math.sin(((t - (1 - c)) / c) * Math.PI) * 0.02 + (t - (1 - c)) / c * 0.02;
      },
    },
    applyEase: (name, t) => (U.ease[name] || U.ease.linear)(U.clamp(t, 0, 1)),

    // ── seeded RNG ──
    mulberry32(seed) {
      let a = seed >>> 0;
      return function () {
        a |= 0; a = (a + 0x6d2b79f5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
    },
    hashStr(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; },

    // ── color ──
    hexToRgb(hex) {
      const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
      if (!m) return { r: 0, g: 0, b: 0 };
      const n = parseInt(m[1], 16);
      return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
    },
    rgba(hex, a) { const { r, g, b } = U.hexToRgb(hex); return `rgba(${r},${g},${b},${a})`; },
    lumaOf(hex) { const { r, g, b } = U.hexToRgb(hex); return 0.299 * r + 0.587 * g + 0.114 * b; },
    isLightColor(hex) { return U.lumaOf(hex) > 140; },
    hsl: (h, s, l, a = 1) => `hsla(${h},${s}%,${l}%,${a})`,

    // ── misc ──
    debounce(fn, ms) { let t; return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); }; },
    deepClone(o) { return JSON.parse(JSON.stringify(o)); },
    fmtTime(s) {
      s = Math.max(0, s || 0);
      const m = Math.floor(s / 60), sec = s - m * 60;
      return `${m}:${sec < 10 ? '0' : ''}${sec.toFixed(1)}`;
    },
    fmtBytes(b) {
      if (b < 1024) return b + ' B';
      if (b < 1048576) return (b / 1024).toFixed(1) + ' KB';
      return (b / 1048576).toFixed(2) + ' MB';
    },
    escapeHtml(s) { return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); },

    // ── DOM ──
    $(sel, root) { return (root || document).querySelector(sel); },
    $$(sel, root) { return Array.from((root || document).querySelectorAll(sel)); },
    el(tag, attrs, ...children) {
      const e = document.createElement(tag);
      if (attrs) for (const [k, v] of Object.entries(attrs)) {
        if (k === 'class') e.className = v;
        else if (k === 'html') e.innerHTML = v;
        else if (k.startsWith('on') && typeof v === 'function') e.addEventListener(k.slice(2), v);
        else if (v !== null && v !== undefined) e.setAttribute(k, v);
      }
      for (const c of children.flat()) if (c != null) e.append(c.nodeType ? c : document.createTextNode(c));
      return e;
    },
    download(blob, filename) {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = filename;
      document.body.appendChild(a); a.click();
      setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 4000);
    },
    toast(msg, kind = '', ms = 2600) {
      const t = U.el('div', { class: 'toast ' + kind }, msg);
      U.$('#toasts').append(t);
      setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 350); }, ms);
    },

    // canvas helper
    makeCanvas(w, h) {
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(w)); c.height = Math.max(1, Math.round(h));
      return c;
    },
  };

  // ── tiny event bus ──
  const listeners = {};
  U.bus = {
    on(ev, fn) { (listeners[ev] = listeners[ev] || []).push(fn); return () => U.bus.off(ev, fn); },
    off(ev, fn) { const l = listeners[ev]; if (l) { const i = l.indexOf(fn); if (i >= 0) l.splice(i, 1); } },
    emit(ev, data) { (listeners[ev] || []).slice().forEach((fn) => { try { fn(data); } catch (e) { console.error('[bus]', ev, e); } }); },
  };

  SD.util = U;
})();
