/* SwapDraws — engine.js : deterministic scene renderer.
   Every layer animation is a pure function of time → exact scrubbing,
   reliable export, and smooth preview all share this one engine.
   Styles: draw · drawfill · chalk · sketch · handwrite · typewriter ·
   scan · chunks · spiral · radial · wipe · fade · pop · slide · rise · none */
(function () {
  const SD = (window.SD = window.SD || {});
  const U = SD.util;

  /* ═══════════════ defaults ═══════════════ */
  function defaultAnim() {
    return {
      style: 'draw', dir: 'ltr', easing: 'linear',
      strokeColor: '#222831', strokeWidth: 6,
      fillReveal: true, rainbow: false,
      jitter: 0, sfx: false,
      hand: 'inherit', handRotate: false,
      exitStyle: 'none', exitDur: 0.7,
      algo: 'edge', sensitivity: 0.5,
    };
  }

  /* ═══════════════ layer content canvases ═══════════════ */
  function contentKey(layer) {
    return [layer.type, layer._cv || 0, layer.w, layer.h, layer.type === 'text' ? JSON.stringify(layer.text) : '',
      layer.type === 'shape' ? JSON.stringify([layer.shape.shapeId, layer.shape.sw, layer.shape.stroke, layer.shape.fill]) : '',
      layer.type === 'icon' ? JSON.stringify([layer.icon.iconId, layer.icon.color, layer.icon.sw]) : ''].join('|');
  }

  function layerContent(project, layer) {
    const key = contentKey(layer);
    if (layer._content && layer._contentKey === key) return layer._content;
    const c = buildContent(project, layer);
    layer._content = c; layer._contentKey = key; layer._plan = null; // content change kills plan
    return c;
  }

  function buildContent(project, layer) {
    const w = Math.max(2, Math.round(layer.w)), h = Math.max(2, Math.round(layer.h));
    const c = U.makeCanvas(w, h);
    const ctx = c.getContext('2d', { willReadFrequently: true });
    if (layer.type === 'image') {
      const img = SD.assets.getImageSync(layer.image.assetId);
      if (img) ctx.drawImage(img, 0, 0, w, h);
      else { placeholder(ctx, w, h); SD.assets.getImage(layer.image.assetId).then(() => { layer._cv = (layer._cv || 0) + 1; U.bus.emit('layer-ready', layer); }).catch(() => {}); }
    } else if (layer.type === 'svg') {
      if (layer.svg.contentURL && layer.svg._img) ctx.drawImage(layer.svg._img, 0, 0, w, h);
      else if (layer.svg.contentURL) {
        const img = new Image();
        img.onload = () => { layer.svg._img = img; layer._cv = (layer._cv || 0) + 1; U.bus.emit('layer-ready', layer); };
        img.src = layer.svg.contentURL;
        placeholder(ctx, w, h);
      }
    } else if (layer.type === 'text') {
      renderTextContent(ctx, layer, w, h);
    } else if (layer.type === 'drawing') {
      renderDrawingContent(ctx, layer);
    } else if (layer.type === 'shape') {
      SD.tools.renderShape(ctx, layer);
    } else if (layer.type === 'icon') {
      SD.tools.renderIcon(ctx, layer);
    }
    return c;
  }

  function placeholder(ctx, w, h) {
    ctx.fillStyle = '#cfd6e0'; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#8a94a6'; ctx.font = `600 ${Math.max(12, Math.min(w, h) / 10)}px "DM Sans", sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('loading…', w / 2, h / 2);
  }

  /* ── text layout (shared by content + typewriter + measurements) ── */
  function textLayout(layer) {
    const t = layer.text;
    const meas = U.makeCanvas(8, 8).getContext('2d');
    const fontStr = `${t.italic ? 'italic ' : ''}${t.bold ? '700' : '400'} ${t.size}px "${t.font}"`;
    meas.font = fontStr;
    const lines = String(t.content || ' ').split('\n');
    let maxW = 1;
    const laid = [];
    const spacing = t.spacing || 0;
    lines.forEach((line, li) => {
      let x = 0;
      const chars = [];
      for (const ch of line) {
        const w0 = meas.measureText(ch).width;
        chars.push({ ch, x, w: w0 });
        x += w0 + spacing;
      }
      const lineW = Math.max(1, x - (line.length ? spacing : 0));
      maxW = Math.max(maxW, lineW);
      laid.push({ line, chars, w: lineW, li });
    });
    const lh = t.size * (t.lineH || 1.25);
    const pad = Math.ceil(t.size * 0.16) + 6;
    return { laid, fontStr, lh, maxW, pad, w: maxW + pad * 2, h: lines.length * lh + pad * 2, totalChars: laid.reduce((a, l) => a + l.chars.length, 0) };
  }

  function renderTextContent(ctx, layer, w, h) {
    const t = layer.text;
    const L = textLayout(layer);
    ctx.clearRect(0, 0, w, h);
    ctx.font = L.fontStr;
    ctx.fillStyle = t.color;
    ctx.textBaseline = 'alphabetic';
    for (const line of L.laid) {
      let x0 = L.pad;
      if (t.align === 'center') x0 = L.pad + (L.maxW - line.w) / 2;
      else if (t.align === 'right') x0 = L.pad + (L.maxW - line.w);
      const y = L.pad + t.size * 0.82 + line.li * L.lh;
      for (const ch of line.chars) ctx.fillText(ch.ch, x0 + ch.x, y);
    }
  }

  function renderDrawingContent(ctx, layer) {
    ctx.clearRect(0, 0, layer.w, layer.h);
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    for (const s of layer.drawing.strokes) {
      ctx.strokeStyle = s.color;
      ctx.globalAlpha = s.alpha ?? 1;
      ctx.lineWidth = s.width;
      ctx.beginPath();
      const p = s.pts;
      ctx.moveTo(p[0], p[1]);
      for (let i = 2; i < p.length; i += 2) ctx.lineTo(p[i], p[i + 1]);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  /* ═══════════════ plan building (strokes & reveal orders) ═══════════════ */
  function planKey(layer) {
    const a = layer.anim;
    return [contentKey(layer), a.style, a.dir, a.algo, a.sensitivity, a.strokeWidth, layer.type === 'text' && layer.text ? layer.text.underline : ''].join('|');
  }

  function planFor(project, layer) {
    const key = planKey(layer);
    if (layer._plan && layer._planKey === key) return layer._plan;
    const plan = buildPlan(project, layer);
    layer._plan = plan; layer._planKey = key;
    return plan;
  }

  function buildPlan(project, layer) {
    const content = layerContent(project, layer);
    const a = layer.anim;
    const plan = { content, strokes: [], totalLen: 0, dabs: null, tiles: null, text: null, w: content.width, h: content.height };
    const style = a.style;

    if (layer.type === 'drawing') {
      // replay the user's own strokes with their colors & widths
      let total = 0;
      plan.strokes = layer.drawing.strokes.map((s) => {
        const n = s.pts.length / 2;
        const cum = new Float32Array(n);
        let d = 0;
        for (let i = 1; i < n; i++) { d += Math.hypot(s.pts[i * 2] - s.pts[i * 2 - 2], s.pts[i * 2 + 1] - s.pts[i * 2 - 1]); cum[i] = d; }
        const st = { pts: new Float32Array(s.pts), cum, len: d, start: total, color: s.color, width: s.width, alpha: s.alpha ?? 1 };
        total += d;
        return st;
      });
      plan.totalLen = total;
    } else if (layer.type === 'shape' || layer.type === 'icon') {
      const vec = layer.type === 'shape' ? SD.tools.shapeStrokes(layer) : SD.tools.iconStrokes(layer);
      let total = 0;
      plan.strokes = vec.map((v) => {
        const n = v.pts.length / 2;
        const cum = new Float32Array(n);
        let d = 0;
        for (let i = 1; i < n; i++) { d += Math.hypot(v.pts[i * 2] - v.pts[i * 2 - 2], v.pts[i * 2 + 1] - v.pts[i * 2 - 1]); cum[i] = d; }
        const st = { pts: new Float32Array(v.pts), cum, len: d, start: total, color: v.color, width: v.width, alpha: v.alpha ?? 1 };
        total += d;
        return st;
      });
      plan.totalLen = total;
    } else if (layer.type === 'svg' && layer.svg.strokes && layer.svg.strokes.length) {
      // traced SVG path data — real pen order from the file
      const sx = layer.w / layer.svg.vbW, sy = layer.h / layer.svg.vbH;
      let total = 0;
      plan.strokes = layer.svg.strokes.map((v) => {
        const n = v.pts.length / 2;
        const pts = new Float32Array(n * 2);
        for (let i = 0; i < n; i++) { pts[i * 2] = v.pts[i * 2] * sx; pts[i * 2 + 1] = v.pts[i * 2 + 1] * sy; }
        const cum = new Float32Array(n);
        let d = 0;
        for (let i = 1; i < n; i++) { d += Math.hypot(pts[i * 2] - pts[i * 2 - 2], pts[i * 2 + 1] - pts[i * 2 - 1]); cum[i] = d; }
        const st = { pts, cum, len: d, start: total, color: v.color, width: (v.width || a.strokeWidth) * Math.max(sx, sy) };
        total += d;
        return st;
      });
      plan.totalLen = total;
    } else {
      // raster content (image / text) → detect & trace
      const order = layer.type === 'text' ? 'text' : (a.dir === 'random' ? 'random' : a.dir);
      let inkPlan;
      if (layer.type === 'text') {
        // text: skeletonize the exact glyph fill → genuine handwriting strokes
        const tl = textLayout(layer);
        inkPlan = SD.ink.buildInkPlan(content, { order, fillAlpha: true, skeleton: true, textLineH: tl.lh || undefined });
        if (inkPlan.strokeW) for (const st of inkPlan.strokes) st.width = inkPlan.strokeW;
      } else {
        inkPlan = SD.ink.buildInkPlan(content, { algo: a.algo, sensitivity: a.sensitivity, order });
      }
      plan.strokes = inkPlan.strokes;
      plan.totalLen = inkPlan.totalLen;
      if (layer.type === 'text') {
        plan.text = textLayout(layer);
        plan.accentStrokes = underlineStrokes(plan, layer); // drawn over the revealed color at the end
      }
    }
    return plan;
  }

  function underlineStrokes(plan, layer) {
    const t = layer.text;
    if (!t || t.underline === 'none') return [];
    const L = plan.text;
    const y = L.h - L.pad * 0.5;
    const pts = [];
    if (t.underline === 'squiggle') {
      const amp = t.size * 0.06, wl = t.size * 0.28;
      for (let x = L.pad; x <= L.w - L.pad; x += 3) pts.push(x, y + Math.sin((x - L.pad) / wl * Math.PI * 2) * amp);
    } else if (t.underline === 'highlight') {
      const hy = L.pad + (L.laid.length * L.lh) / 2;
      for (let x = L.pad; x <= L.w - L.pad; x += 4) pts.push(x, hy);
      const len = Math.max(1, L.w - L.pad * 2);
      return [{ pts: new Float32Array(pts), cum: cumOf(pts), len, start: 0, width: L.laid.length * L.lh * 0.72, alpha: 0.42, color: t.color, highlight: true }];
    } else {
      for (let x = L.pad; x <= L.w - L.pad; x += 4) pts.push(x, y);
    }
    const len = Math.max(1, L.w - L.pad * 2);
    return [{ pts: new Float32Array(pts), cum: cumOf(pts), len, start: 0, width: Math.max(2, t.size * 0.05), color: t.color, alpha: 1 }];
  }
  function cumOf(pts) {
    const n = pts.length / 2, cum = new Float32Array(n);
    let d = 0;
    for (let i = 1; i < n; i++) { d += Math.hypot(pts[i * 2] - pts[i * 2 - 2], pts[i * 2 + 1] - pts[i * 2 - 1]); cum[i] = d; }
    return cum;
  }

  /* ═══════════════ incremental stroke painter ═══════════════ */
  function strokeColorFor(layer, stroke, distAlong) {
    if (stroke.color) return stroke.color;
    const a = layer.anim;
    if (a.rainbow) return U.hsl((distAlong * 0.35) % 360, 85, 55);
    return a.strokeColor;
  }

  /** draw stroke segments of plan into ctx until `limit` px of total path length; from `fromDist` (skip earlier) */
  function paintStrokes(ctx, plan, layer, fromDist, limit, opts = {}) {
    const a = layer.anim;
    const jit = (opts.jitter ?? a.jitter) / 100 * 3;
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    for (let si = 0; si < plan.strokes.length; si++) {
      const s = plan.strokes[si];
      const sEnd = s.start + s.len;
      if (sEnd <= fromDist || s.len <= 0) continue;
      if (s.start >= limit) break;
      const localFrom = Math.max(0, fromDist - s.start);
      const localTo = Math.min(s.len, limit - s.start);
      if (localTo <= localFrom) continue;
      const pts = s.pts, n = s.cum.length;
      // binary search the index range
      let i0 = bisect(s.cum, localFrom), i1 = bisect(s.cum, localTo);
      ctx.strokeStyle = strokeColorFor(layer, s, s.start);
      ctx.globalAlpha = (s.alpha ?? 1) * (opts.alpha ?? 1);
      ctx.lineWidth = s.width || a.strokeWidth;
      const rndSeed = U.hashStr(layer.id + ':' + si);
      const rnd = U.mulberry32(rndSeed);
      ctx.beginPath();
      ctx.moveTo(pts[i0 * 2], pts[i0 * 2 + 1]);
      for (let i = Math.max(1, i0); i <= i1 && i < n; i++) {
        const jx = jit ? (rnd() - 0.5) * jit : 0, jy = jit ? (rnd() - 0.5) * jit : 0;
        ctx.lineTo(pts[i * 2] + jx, pts[i * 2 + 1] + jy);
      }
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
  }
  function bisect(cum, v) {
    let lo = 0, hi = cum.length - 1;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (cum[mid] < v) lo = mid + 1; else hi = mid; }
    return lo;
  }

  /** point + tangent at `distAlong` total path distance */
  function headAt(plan, distAlong) {
    if (!plan.strokes.length || plan.totalLen <= 0) return null;
    distAlong = U.clamp(distAlong, 0, plan.totalLen - 0.001);
    for (const s of plan.strokes) {
      if (distAlong > s.start + s.len) continue;
      const local = distAlong - s.start;
      const i = Math.min(bisect(s.cum, local), s.cum.length - 1);
      const i0 = Math.max(0, i - 1), i1 = Math.min(s.cum.length - 1, i + 1);
      return {
        x: s.pts[i * 2], y: s.pts[i * 2 + 1],
        angle: Math.atan2(s.pts[i1 * 2 + 1] - s.pts[i0 * 2 + 1], s.pts[i1 * 2] - s.pts[i0 * 2]),
        stroke: s,
      };
    }
    const last = plan.strokes[plan.strokes.length - 1];
    const n = last.cum.length;
    return { x: last.pts[(n - 1) * 2], y: last.pts[(n - 1) * 2 + 1], angle: 0, stroke: last };
  }

  /* ═══════════════ style renderers ═══════════════ */
  /* Each returns {head:{x,y,angle}|null, still:boolean} — head feeds the hand overlay */

  function getProg(layer, plan) {
    // persistent progress canvas for incremental styles, keyed per plan object
    if (!plan._prog) {
      plan._prog = U.makeCanvas(plan.w, plan.h);
      plan._progP = -1;
      plan._progCtx = plan._prog.getContext('2d', { willReadFrequently: true });
    }
    return plan;
  }

  function drawStrokesTo(layer, plan, dist) {
    const P = getProg(layer, plan);
    const ctx = P._progCtx;
    if (P._progP < 0 || dist < P._progP - 0.5) { ctx.clearRect(0, 0, plan.w, plan.h); P._progP = 0; }
    if (dist > P._progP) paintStrokes(ctx, plan, layer, P._progP, dist);
    P._progP = dist;
    return P._prog;
  }

  function dabList(plan, optKey) {
    if (!plan._dabLists) plan._dabLists = {};
    let d = plan._dabLists[optKey];
    if (!d) { d = SD.ink.revealOrder(plan.w, plan.h, DAB_ORDERS[optKey](plan)); plan._dabLists[optKey] = d; }
    return d;
  }
  function dabMaskTo(plan, count, optKey) {
    if (!plan._masks) plan._masks = {};
    let M = plan._masks[optKey];
    if (!M) {
      M = plan._masks[optKey] = { canvas: U.makeCanvas(plan.w, plan.h), ctx: null, p: -1 };
      M.ctx = M.canvas.getContext('2d', { willReadFrequently: true });
    }
    const dabs = dabList(plan, optKey);
    count = Math.min(count, dabs.length);
    if (M.p < 0 || count < M.p) { M.ctx.clearRect(0, 0, plan.w, plan.h); M.p = 0; }
    if (count > M.p) {
      const c = M.ctx;
      c.fillStyle = '#fff';
      c.beginPath();
      for (let i = M.p; i < count; i++) {
        const d = dabs[i];
        c.moveTo(d.x + d.r, d.y);
        c.arc(d.x, d.y, d.r, 0, Math.PI * 2);
      }
      c.fill();
      M.p = count;
    }
    return M;
  }
  const DAB_ORDERS = {
    spiral: (p) => ({ type: 'spiral' }),
    radial: (p) => ({ type: 'radial' }),
    scatter: (p) => ({ type: 'scatter' }),
    fill: (p) => ({ type: 'serpentine', step: Math.max(12, Math.min(p.w, p.h) / 22) }),
    ltr: (p) => ({ type: 'ltr' }), rtl: (p) => ({ type: 'rtl' }), ttb: (p) => ({ type: 'ttb' }), btt: (p) => ({ type: 'btt' }),
  };

  /** stateless: content visible through a dab mask at progress */
  function paintMaskedContent(ctx, plan, layer, dabKey, p) {
    const dabs = dabList(plan, dabKey);
    const M = dabMaskTo(plan, Math.ceil(dabs.length * U.clamp(p, 0, 1)), dabKey);
    if (!plan._maskedBuf) { plan._maskedBuf = U.makeCanvas(plan.w, plan.h); plan._maskedCtx = plan._maskedBuf.getContext('2d'); }
    const b = plan._maskedCtx;
    b.clearRect(0, 0, plan.w, plan.h);
    b.globalCompositeOperation = 'source-over';
    b.drawImage(plan.content, 0, 0);
    b.globalCompositeOperation = 'destination-in';
    b.drawImage(M.canvas, 0, 0);
    b.globalCompositeOperation = 'source-over';
    ctx.drawImage(plan._maskedBuf, 0, 0);
    const d = dabs[Math.max(0, Math.min(dabs.length - 1, Math.ceil(dabs.length * p) - 1))];
    return d ? { x: d.x, y: d.y, angle: 0 } : null;
  }

  /** stateless tiles count helper */
  function tilesFor(plan) {
    if (!plan._tiles) plan._tiles = SD.ink.tileOrder(plan.w, plan.h, { cols: 5, rows: 4 });
    return plan._tiles;
  }

  const DRAW_PORTION = 0.72; // for draw styles: how much of p is stroke-drawing
  const ACCENT_PORTION = 0.22; // underline/highlight swipe at the end (text layers)

  /* accessory plan for text underline/highlight accents */
  function accentPlan(layer, plan) {
    if (!plan._accentPlan) {
      let total = 0;
      for (const s of plan.accentStrokes) { s.start = total; total += s.len; }
      plan._accentPlan = { strokes: plan.accentStrokes, totalLen: total, w: plan.w, h: plan.h };
    }
    return plan._accentPlan;
  }
  function paintAccentTo(layer, plan, ap) {
    const acc = accentPlan(layer, plan);
    if (!plan._accentCanvas) {
      plan._accentCanvas = U.makeCanvas(plan.w, plan.h);
      plan._accentP = -1;
      plan._accentCtx = plan._accentCanvas.getContext('2d');
    }
    const c = plan._accentCtx;
    const dist = U.clamp(ap, 0, 1) * acc.totalLen;
    if (plan._accentP < 0 || dist < plan._accentP - 0.5) { c.clearRect(0, 0, plan.w, plan.h); plan._accentP = 0; }
    if (dist > plan._accentP) paintStrokes(c, acc, layer, plan._accentP, dist);
    plan._accentP = dist;
    return plan._accentCanvas;
  }
  function drawAccentFull(layer, plan, ctx) {
    if (!plan.accentStrokes || !plan.accentStrokes.length) return;
    ctx.drawImage(paintAccentTo(layer, plan, 1), 0, 0);
  }

  const styles = {
    none(layer, plan, p, ctx) { ctx.drawImage(plan.content, 0, 0); return {}; },

    draw(layer, plan, p, ctx) {
      const a = layer.anim;
      const hasAccent = layer.type === 'text' && plan.accentStrokes && plan.accentStrokes.length;
      const reveal = a.fillReveal;
      const accentP = hasAccent ? ACCENT_PORTION : 0;
      const split = (reveal ? DRAW_PORTION : 1) * (1 - accentP);
      let out;
      if (p < split) {
        const dist = U.clamp(p / split, 0, 1) * plan.totalLen;
        ctx.drawImage(drawStrokesTo(layer, plan, dist), 0, 0);
        out = { head: headAt(plan, dist) };
      } else {
        if (reveal) {
          const q = U.smoothstep(U.clamp((p - split) / (1 - split - accentP), 0, 1));
          ctx.globalAlpha = 1 - q; ctx.drawImage(drawStrokesTo(layer, plan, plan.totalLen), 0, 0);
          ctx.globalAlpha = q; ctx.drawImage(plan.content, 0, 0);
          ctx.globalAlpha = 1;
        } else {
          ctx.drawImage(drawStrokesTo(layer, plan, plan.totalLen), 0, 0);
        }
        if (hasAccent) {
          const ap = U.clamp((p - (1 - accentP)) / accentP, 0, 1);
          if (ap > 0) {
            ctx.drawImage(paintAccentTo(layer, plan, ap), 0, 0);
            out = { head: headAt(accentPlan(layer, plan), ap * accentPlan(layer, plan).totalLen) };
          }
        }
      }
      return out || {};
    },

    drawfill(layer, plan, p, ctx) {
      const split = 0.6;
      const dp = U.clamp(p / split, 0, 1);
      const dist = dp * plan.totalLen;
      ctx.drawImage(drawStrokesTo(layer, plan, dist), 0, 0);
      if (p >= split) {
        const q = (p - split) / (1 - split);
        paintMaskedContent(ctx, plan, layer, 'fill', U.smoothstep(q));
        if (q > 0.97) { ctx.save(); ctx.globalAlpha = (q - 0.97) / 0.03; ctx.drawImage(plan.content, 0, 0); ctx.restore(); }
        if (q < 1) { // redraw outlines crisply on top of partial fill
          ctx.globalAlpha = Math.max(0, 1 - q * 0.6);
          ctx.drawImage(drawStrokesTo(layer, plan, plan.totalLen), 0, 0);
          ctx.globalAlpha = 1;
        } else ctx.drawImage(plan.content, 0, 0);
        return {};
      }
      return { head: headAt(plan, dist) };
    },

    chalk(layer, plan, p, ctx) {
      // two-pass jittered stroke = chalk texture
      const dist = p * plan.totalLen;
      const P = getProg(layer, plan);
      const c = P._progCtx;
      if (P._progP < 0 || dist < P._progP - 0.5) { c.clearRect(0, 0, plan.w, plan.h); P._progP = 0; }
      if (dist > P._progP) {
        paintStrokes(c, plan, layer, P._progP, dist, { jitter: Math.max(layer.anim.jitter, 28), alpha: 0.92 });
        paintStrokes(c, plan, layer, P._progP, dist, { jitter: 55, alpha: 0.35 });
      }
      P._progP = dist;
      ctx.save();
      if (layer.anim.fillReveal && p > 0.8) {
        const q = U.smoothstep((p - 0.8) / 0.2);
        ctx.globalAlpha = 1 - q; ctx.drawImage(P._prog, 0, 0);
        ctx.globalAlpha = q; ctx.drawImage(plan.content, 0, 0);
      } else ctx.drawImage(P._prog, 0, 0);
      ctx.restore();
      if (p < 0.98) return { head: headAt(plan, dist) };
      return {};
    },

    sketch(layer, plan, p, ctx) {
      // pass 1: loose light lines · pass 2: confident dark lines · optional settle to color
      const a = layer.anim;
      const p1 = U.clamp(p / 0.5, 0, 1), p2 = U.clamp((p - 0.4) / 0.5, 0, 1);
      const P = plan._sketchBuf || (plan._sketchBuf = U.makeCanvas(plan.w, plan.h));
      const c = P.getContext('2d');
      c.clearRect(0, 0, plan.w, plan.h);
      if (p1 > 0) paintStrokes(c, plan, layer, 0, p1 * plan.totalLen, { jitter: 60, alpha: 0.28 });
      if (p2 > 0) paintStrokes(c, plan, layer, 0, p2 * plan.totalLen, { jitter: 10, alpha: 1 });
      if (a.fillReveal && p > 0.9) {
        const q = (p - 0.9) / 0.1;
        ctx.drawImage(P, 0, 0);
        ctx.globalAlpha = q; ctx.drawImage(plan.content, 0, 0); ctx.globalAlpha = 1;
      } else ctx.drawImage(P, 0, 0);
      if (p < 0.9) return { head: headAt(plan, plan.totalLen * (p < 0.4 ? p1 : p2)) };
      return {};
    },

    handwrite(layer, plan, p, ctx) { return styles.draw(layer, plan, p, ctx); },

    typewriter(layer, plan, p, ctx, tSec) {
      const L = plan.text || (plan.text = textLayout(layer));
      const n = Math.floor(p * L.totalChars);
      const t = layer.text;
      ctx.font = L.fontStr;
      ctx.fillStyle = t.color;
      ctx.textBaseline = 'alphabetic';
      let count = 0, caret = null;
      outer: for (const line of L.laid) {
        let x0 = L.pad;
        if (t.align === 'center') x0 = L.pad + (L.maxW - line.w) / 2;
        else if (t.align === 'right') x0 = L.pad + (L.maxW - line.w);
        const y = L.pad + t.size * 0.82 + line.li * L.lh;
        for (const ch of line.chars) {
          if (count >= n) { caret = { x: x0 + ch.x, y, size: t.size }; break outer; }
          ctx.fillText(ch.ch, x0 + ch.x, y);
          count++;
          caret = { x: x0 + ch.x + ch.w + (t.spacing || 0), y, size: t.size };
        }
      }
      // blinking caret
      if (caret && p < 1 && (tSec * 2.2) % 1 < 0.75) {
        ctx.fillRect(caret.x + 1, caret.y - caret.size * 0.85, Math.max(2, caret.size * 0.045), caret.size * 0.95);
      }
      // underline/highlight swipe in the last stretch
      if (plan.accentStrokes && plan.accentStrokes.length && p > 0.85) {
        ctx.drawImage(paintAccentTo(layer, plan, (p - 0.85) / 0.15), 0, 0);
      }
      return caret && p < 1 ? { head: { x: caret.x, y: caret.y - caret.size * 0.4, angle: 0 }, noHand: true } : {};
    },

    scan(layer, plan, p, ctx) {
      const a = layer.anim;
      const horiz = a.dir === 'ltr' || a.dir === 'rtl' || a.dir === 'random' || a.dir === 'center';
      const rev = a.dir === 'rtl' || a.dir === 'btt';
      ctx.save();
      ctx.beginPath();
      let head;
      if (horiz) {
        const x = rev ? plan.w * (1 - p) : plan.w * p;
        if (rev) ctx.rect(x, 0, plan.w - x, plan.h); else ctx.rect(0, 0, x, plan.h);
        head = { x, y: plan.h / 2, angle: rev ? Math.PI : 0 };
      } else {
        const y = rev ? plan.h * (1 - p) : plan.h * p;
        if (rev) ctx.rect(0, y, plan.w, plan.h - y); else ctx.rect(0, 0, plan.w, y);
        head = { x: plan.w / 2, y, angle: rev ? -Math.PI / 2 : Math.PI / 2 };
      }
      ctx.clip();
      ctx.drawImage(plan.content, 0, 0);
      ctx.restore();
      // scan glow line
      if (p > 0 && p < 1) {
        ctx.save();
        ctx.strokeStyle = U.rgba(layer.anim.strokeColor, 0.55);
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        if (horiz) { ctx.moveTo(head.x, 0); ctx.lineTo(head.x, plan.h); } else { ctx.moveTo(0, head.y); ctx.lineTo(plan.w, head.y); }
        ctx.stroke();
        ctx.restore();
      }
      return p < 1 ? { head } : {};
    },

    chunks(layer, plan, p, ctx) {
      const tiles = tilesFor(plan);
      const n = tiles.length;
      for (let i = 0; i < n; i++) {
        const t0 = (i / n) * 0.82;
        const q = U.clamp((p - t0) / 0.12, 0, 1);
        if (q <= 0) continue;
        const t = tiles[i];
        ctx.save();
        ctx.globalAlpha = q;
        const grow = U.lerp(0.6, 1, U.applyEase('bounceSoft', q));
        ctx.translate(t.x + t.w / 2, t.y + t.h / 2);
        ctx.scale(grow, grow);
        ctx.drawImage(plan.content, t.x, t.y, t.w, t.h, -t.w / 2, -t.h / 2, t.w, t.h);
        ctx.restore();
      }
      const i = Math.min(n - 1, Math.floor(p * n));
      const t = tiles[i];
      return p < 1 ? { head: { x: t.x + t.w / 2, y: t.y + t.h / 2, angle: 0 } } : {};
    },

    spiral(layer, plan, p, ctx) { const head = paintMaskedContent(ctx, plan, layer, 'spiral', U.smoothstep(p)); return p < 1 ? { head } : {}; },
    radial(layer, plan, p, ctx) { const head = paintMaskedContent(ctx, plan, layer, 'radial', U.smoothstep(p)); return p < 1 ? { head } : {}; },

    wipe(layer, plan, p, ctx) {
      const a = layer.anim;
      const horiz = a.dir === 'ltr' || a.dir === 'rtl' || a.dir === 'center' || a.dir === 'random';
      const rev = a.dir === 'rtl' || a.dir === 'btt';
      const len = horiz ? plan.w : plan.h;
      const feather = Math.min(plan.w, plan.h) * 0.12 + 20;
      const v = p * (len + feather); // visible frontier incl. feather
      if (!plan._wipeBuf) { plan._wipeBuf = U.makeCanvas(plan.w, plan.h); plan._wipeCtx = plan._wipeBuf.getContext('2d'); }
      const b = plan._wipeCtx;
      b.clearRect(0, 0, plan.w, plan.h);
      b.globalCompositeOperation = 'source-over';
      b.drawImage(plan.content, 0, 0);
      b.globalCompositeOperation = 'destination-in';
      // alpha mask: fully visible behind frontier, feathered edge at frontier
      const x0 = rev ? len - v : v - feather, x1 = rev ? len - v + feather : v;
      let g;
      if (horiz) g = b.createLinearGradient(rev ? plan.w : 0, 0, rev ? 0 : plan.w, 0);
      else g = b.createLinearGradient(0, rev ? plan.h : 0, 0, rev ? 0 : plan.h);
      const s0 = U.clamp(x0 / len, 0, 1), s1 = U.clamp(x1 / len, 0, 1);
      g.addColorStop(0, 'rgba(255,255,255,1)');
      g.addColorStop(s0, 'rgba(255,255,255,1)');
      g.addColorStop(s1, 'rgba(255,255,255,0)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      b.fillStyle = g;
      b.fillRect(0, 0, plan.w, plan.h);
      b.globalCompositeOperation = 'source-over';
      ctx.drawImage(plan._wipeBuf, 0, 0);
      const headPos = horiz ? { x: rev ? plan.w - v : v, y: plan.h / 2 } : { x: plan.w / 2, y: rev ? plan.h - v : v };
      return p < 1 ? { head: { ...headPos, angle: 0 } } : {};
    },

    fade(layer, plan, p, ctx) { ctx.globalAlpha = U.smoothstep(p); ctx.drawImage(plan.content, 0, 0); ctx.globalAlpha = 1; return {}; },

    pop(layer, plan, p, ctx) {
      const q = U.clamp(p, 0, 1);
      const s = q < 0.7 ? U.smoothstep(q / 0.7) * 1.06 : 1.06 - (q - 0.7) / 0.3 * 0.06;
      ctx.save();
      ctx.translate(plan.w / 2, plan.h / 2);
      ctx.scale(s, s);
      ctx.globalAlpha = U.clamp(q * 2.5, 0, 1);
      ctx.drawImage(plan.content, -plan.w / 2, -plan.h / 2);
      ctx.restore();
      return {};
    },

    slide(layer, plan, p, ctx) {
      const a = layer.anim;
      const e = U.applyEase('easeOut', p);
      const off = (1 - e);
      let dx = 0, dy = 0;
      if (a.dir === 'rtl') dx = plan.w * off; else if (a.dir === 'ttb') dy = -plan.h * off; else if (a.dir === 'btt') dy = plan.h * off; else dx = -plan.w * off;
      ctx.globalAlpha = U.clamp(p * 3, 0, 1);
      ctx.drawImage(plan.content, dx, dy);
      ctx.globalAlpha = 1;
      return p < 0.85 ? { head: { x: dx + plan.w / 2, y: dy + plan.h / 2, angle: 0 } } : {};
    },

    rise(layer, plan, p, ctx) {
      const e = U.applyEase('easeOut', p);
      ctx.globalAlpha = U.clamp(p * 2.5, 0, 1);
      ctx.drawImage(plan.content, 0, plan.h * 0.25 * (1 - e));
      ctx.globalAlpha = 1;
      return {};
    },
  };

  /* exit animations (applied during scene tail) */
  function applyExit(layer, plan, exitP, ctx) {
    const style = layer.anim.exitStyle;
    if (exitP <= 0 || style === 'none') return;
    if (style === 'fade') { ctx.globalAlpha = 1 - exitP; }
    else if (style === 'shrink') {
      const s = 1 - exitP;
      ctx.translate(plan.w / 2, plan.h / 2); ctx.scale(Math.max(0.001, s), Math.max(0.001, s)); ctx.translate(-plan.w / 2, -plan.h / 2);
      ctx.globalAlpha = 1 - exitP * exitP;
    } else if (style === 'slide') { ctx.translate(plan.w * exitP, 0); ctx.globalAlpha = 1 - exitP * 0.4; }
    else if (style === 'dissolve' || style === 'erase') {
      ctx.globalAlpha = 1 - U.smoothstep(exitP);
    }
  }

  /* ═══════════════ camera ═══════════════ */
  function evalCamera(project, scene, t) {
    const cam = scene.camera;
    const neutral = { x: 0.5, y: 0.5, zoom: 1 };
    if (!cam || !cam.enabled || !cam.keys || !cam.keys.length) return neutral;
    const keys = cam.keys.slice().sort((a, b) => a.t - b.t);
    if (t <= keys[0].t) return { x: keys[0].x, y: keys[0].y, zoom: keys[0].zoom };
    const last = keys[keys.length - 1];
    if (t >= last.t) return { x: last.x, y: last.y, zoom: last.zoom };
    for (let i = 0; i < keys.length - 1; i++) {
      const k0 = keys[i], k1 = keys[i + 1];
      if (t >= k0.t && t <= k1.t) {
        const p = U.smoothstep((t - k0.t) / Math.max(0.001, k1.t - k0.t));
        return { x: U.lerp(k0.x, k1.x, p), y: U.lerp(k0.y, k1.y, p), zoom: U.lerp(k0.zoom, k1.zoom, p) };
      }
    }
    return neutral;
  }

  /* auto-generate camera keys from layers: focus each layer while it draws, zoom out at end */
  function autoCamera(project, scene) {
    const keys = [];
    const cw = project.canvas.width, ch = project.canvas.height;
    const layers = scene.layers.filter((l) => l.visible !== false && l.type !== 'audio');
    if (!layers.length) return keys;
    keys.push({ t: 0, x: 0.5, y: 0.5, zoom: 1 });
    for (const l of layers.sort((a, b) => a.start - b.start)) {
      const cx = (l.x + l.w / 2) / cw, cy = (l.y + l.h / 2) / ch;
      const zoom = U.clamp(Math.min(cw / (l.w * 1.9), ch / (l.h * 1.9)), 1.15, 3);
      const t = l.start + Math.min(0.35, l.duration * 0.2);
      keys.push({ t: Math.max(0.01, t), x: U.clamp(cx, 0, 1), y: U.clamp(cy, 0, 1), zoom });
    }
    const end = sceneDuration(project, scene) - (scene.holdAfter || 0.8) * 0.4;
    keys.push({ t: Math.max(keys[keys.length - 1].t + 0.5, end - 1.2), x: 0.5, y: 0.5, zoom: 1 });
    return keys;
  }

  /* ═══════════════ backgrounds ═══════════════ */
  const BG_DEFS = {
    white: { name: 'White', color: '#fdfcf9', ink: '#222831' },
    black: { name: 'Black', color: '#14161c', ink: '#f2f4f8' },
    chalk: { name: 'Chalkboard', color: '#1e2622', ink: '#f4f2e8' },
    blueprint: { name: 'Blueprint', color: '#123f63', ink: '#eaf4ff' },
    kraft: { name: 'Kraft', color: '#c8a87b', ink: '#4a3721' },
    neon: { name: 'Neon dark', color: '#0a0c16', ink: '#41f2e8' },
    grid: { name: 'Grid paper', color: '#fdfcf9', ink: '#222831', grid: 'rgba(80,120,200,.18)' },
    dots: { name: 'Dot paper', color: '#fdfcf9', ink: '#222831', dots: 'rgba(80,120,200,.25)' },
    ruled: { name: 'Ruled', color: '#fdfcf9', ink: '#222831', ruled: 'rgba(80,120,200,.22)' },
    color: { name: 'Custom', color: '#f7f3ea', ink: '#222831' },
  };

  function sceneBgColor(scene) {
    const def = BG_DEFS[scene.background.type] || BG_DEFS.white;
    return scene.background.type === 'color' ? (scene.background.color || '#f7f3ea') : def.color;
  }

  function backgroundCanvas(project, scene) {
    const key = [project.canvas.width, project.canvas.height, scene.background.type, scene.background.color].join('|');
    if (scene._bg && scene._bgKey === key) return scene._bg;
    const cw = project.canvas.width, ch = project.canvas.height;
    const c = U.makeCanvas(cw, ch);
    const ctx = c.getContext('2d');
    const type = scene.background.type;
    ctx.fillStyle = sceneBgColor(scene);
    ctx.fillRect(0, 0, cw, ch);
    const def = BG_DEFS[type];
    if (def && def.grid) { drawGrid(ctx, cw, ch, 46 * (cw / 1920), def.grid, 'lines'); }
    if (def && def.dots) { drawGrid(ctx, cw, ch, 42 * (cw / 1920), def.dots, 'dots'); }
    if (def && def.ruled) { drawRuled(ctx, cw, ch, 52 * (cw / 1920), def.ruled); }
    if (type === 'blueprint') drawGrid(ctx, cw, ch, 60 * (cw / 1920), 'rgba(255,255,255,.14)', 'lines', 1.5);
    if (type === 'chalk') {
      drawGrid(ctx, cw, ch, 0, '', 'chalk');
      speckle(ctx, cw, ch, 900, 'rgba(255,255,255,.028)');
      smudges(ctx, cw, ch, 7, 'rgba(255,255,255,.04)');
    }
    if (type === 'kraft') { speckle(ctx, cw, ch, 2600, 'rgba(90,60,20,.05)'); speckle(ctx, cw, ch, 1600, 'rgba(255,240,210,.05)'); }
    if (type === 'neon') vignette(ctx, cw, ch, 'rgba(70,120,255,.10)');
    scene._bg = c; scene._bgKey = key;
    return c;
  }
  function drawGrid(ctx, w, h, step, color, mode, lw = 1) {
    if (mode === 'chalk') return;
    ctx.strokeStyle = color; ctx.lineWidth = lw;
    if (mode === 'dots') {
      ctx.fillStyle = color;
      for (let y = step; y < h; y += step) for (let x = step; x < w; x += step) { ctx.beginPath(); ctx.arc(x, y, lw, 0, Math.PI * 2); ctx.fill(); }
      return;
    }
    ctx.beginPath();
    for (let x = step; x < w; x += step) { ctx.moveTo(x, 0); ctx.lineTo(x, h); }
    for (let y = step; y < h; y += step) { ctx.moveTo(0, y); ctx.lineTo(w, y); }
    ctx.stroke();
  }
  function drawRuled(ctx, w, h, step, color) {
    ctx.strokeStyle = color; ctx.lineWidth = 1;
    ctx.beginPath();
    for (let y = step * 2; y < h; y += step) { ctx.moveTo(0, y); ctx.lineTo(w, y); }
    ctx.stroke();
    ctx.strokeStyle = 'rgba(230,90,90,.25)';
    ctx.beginPath(); ctx.moveTo(step * 1.6, 0); ctx.lineTo(step * 1.6, h); ctx.stroke();
  }
  function speckle(ctx, w, h, n, color) {
    const rnd = U.mulberry32(9);
    ctx.fillStyle = color;
    for (let i = 0; i < n; i++) ctx.fillRect(rnd() * w, rnd() * h, 1.5, 1.5);
  }
  function smudges(ctx, w, h, n, color) {
    const rnd = U.mulberry32(31);
    for (let i = 0; i < n; i++) {
      const x = rnd() * w, y = rnd() * h, r1 = (0.08 + rnd() * 0.2) * Math.min(w, h), r2 = r1 * (0.25 + rnd() * 0.4);
      const g = ctx.createRadialGradient(x, y, 0, x, y, r1);
      g.addColorStop(0, color); g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.save(); ctx.translate(x, y); ctx.scale(1, r2 / r1); ctx.translate(-x, -y);
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r1, 0, Math.PI * 2); ctx.fill(); ctx.restore();
    }
  }
  function vignette(ctx, w, h, color) {
    const g = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.35, w / 2, h / 2, Math.max(w, h) * 0.72);
    g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, color);
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
  }

  /* ═══════════════ durations & timing ═══════════════ */
  function contentEnd(scene) { return scene.layers.reduce((m, l) => Math.max(m, (l.start || 0) + (l.duration || 0)), 0); }
  function exitTail(scene) {
    return scene.layers.reduce((m, l) => (l.anim && l.anim.exitStyle !== 'none' ? Math.max(m, l.anim.exitDur || 0.7) : m), 0);
  }
  function sceneDuration(project, scene) {
    const hold = scene.holdAfter ?? 0.8;
    return Math.max(0.8, contentEnd(scene) + Math.max(hold, exitTail(scene)));
  }
  function sceneStarts(project) {
    const starts = []; let acc = 0;
    for (const s of project.scenes) { starts.push(acc); acc += sceneDuration(project, s); }
    return starts;
  }
  function projectDuration(project) {
    return project.scenes.reduce((a, s) => a + sceneDuration(project, s), 0);
  }
  function timeToScene(project, t) {
    const starts = sceneStarts(project);
    for (let i = starts.length - 1; i >= 0; i--) {
      if (t >= starts[i] - 1e-6) return { idx: i, local: t - starts[i], start: starts[i] };
    }
    return { idx: 0, local: t, start: 0 };
  }

  /* estimate draw-on duration from path length */
  const PEN_SPEED = 1500; // px per second for full-length drawing
  function estimateDuration(project, layer) {
    if (layer.type === 'audio') return U.clamp(layer.duration || (layer.audio && layer.audio.mediaDuration) || 1, 0.1, 600);
    const plan = planFor(project, layer);
    const a = layer.anim;
    if (a.style === 'typewriter') return U.clamp((plan.text ? plan.text.totalChars : 10) / 9, 0.6, 30);
    if (a.style === 'fade' || a.style === 'pop' || a.style === 'none') return a.style === 'none' ? 0.01 : 0.8;
    if (a.style === 'slide' || a.style === 'rise') return 1.1;
    if (a.style === 'scan' || a.style === 'wipe') return U.clamp(Math.max(layer.w, layer.h) / 900 + 0.6, 0.8, 6);
    if (a.style === 'chunks') return 2.2;
    if (a.style === 'spiral' || a.style === 'radial') return 2.6;
    const est = plan.totalLen / PEN_SPEED;
    return U.clamp(est, 0.8, 15);
  }

  /* ═══════════════ scene rendering ═══════════════ */
  function drawHandOverlay(ctx, layer, head, tSec, opts) {
    if (!head || opts.showHand === false) return;
    const a = layer.anim;
    const handStyle = a.hand === 'inherit' ? (opts.defaultHand || 'hand1') : a.hand;
    if (handStyle === 'none') return;
    const H = SD.assets.getHandSync(handStyle, opts.portrait);
    if (!H) return;
    const conf = H.conf;
    const drawH = opts.canvasH * 1.0667;
    const s = drawH / conf.h;
    const drawW = conf.w * s;
    let rot = 0;
    if (a.handRotate && head.angle !== undefined) {
      const pen = (conf.penAngle ?? -90) * Math.PI / 180;
      rot = U.clamp(head.angle - pen, -0.45, 0.45);
    }
    // subtle life tremor
    const rnd = U.mulberry32((tSec * 30) | 0);
    const tx = head.x + (rnd() - 0.5) * 2.2, ty = head.y + (rnd() - 0.5) * 2.2;
    ctx.save();
    ctx.translate(tx, ty);
    ctx.rotate(rot);
    ctx.drawImage(H.img, -conf.tipX * s, -conf.tipY * s, drawW, drawH);
    ctx.restore();
  }

  /** render one layer at scene-local time into ctx (ctx is in scene coords) */
  function renderLayer(ctx, project, scene, layer, t, opts) {
    if (layer.visible === false) return null;
    if (layer.type === 'audio') return null; // audio layers are heard, not drawn
    const start = layer.start || 0, dur = Math.max(0.01, layer.duration || 1);
    const cEnd = contentEnd(scene);
    const plan = planFor(project, layer);
    const a = layer.anim;
    const p = U.clamp((t - start) / dur, 0, 1);

    // exit progress (during the tail after all content finished)
    let exitP = 0;
    if (a.exitStyle !== 'none' && t > cEnd) exitP = U.clamp((t - cEnd) / Math.max(0.01, a.exitDur || 0.7), 0, 1);
    if (exitP >= 1) return null;

    ctx.save();
    // layer transform
    ctx.translate(layer.x + layer.w / 2, layer.y + layer.h / 2);
    if (layer.rot) ctx.rotate(layer.rot * Math.PI / 180);
    if (layer.flipX || layer.flipY) ctx.scale(layer.flipX ? -1 : 1, layer.flipY ? -1 : 1);
    ctx.globalAlpha *= (layer.opacity ?? 100) / 100;
    ctx.translate(-layer.w / 2, -layer.h / 2);
    if (exitP > 0) applyExit(layer, plan, exitP, ctx);

    let head = null;
    const styleFn = styles[a.style] || styles.draw;
    if (t < start) {
      // edit-mode ghost: show where the not-yet-animated layer will land
      if (opts.editMode) {
        ctx.globalAlpha *= 0.32;
        ctx.drawImage(plan.content, 0, 0);
      }
      ctx.restore();
      return null;
    }
    if (p >= 1) {
      // steady state: if a "strokes only" style, keep strokes as the still
      if ((a.style === 'draw' || a.style === 'handwrite') && !a.fillReveal) ctx.drawImage(drawStrokesTo(layer, plan, plan.totalLen), 0, 0);
      else if (a.style === 'chalk' && !a.fillReveal) ctx.drawImage(drawStrokesTo(layer, plan, plan.totalLen), 0, 0);
      else if (a.style === 'sketch' && !a.fillReveal) ctx.drawImage(drawStrokesTo(layer, plan, plan.totalLen), 0, 0);
      else ctx.drawImage(plan.content, 0, 0);
      drawAccentFull(layer, plan, ctx);
    } else if (p > 0) {
      const eased = U.applyEase(a.easing, p);
      const res = styleFn(layer, plan, eased, ctx, t);
      if (res && res.head) head = res.head;
    }
    ctx.restore();

    // hand rides at the current head position (transform to scene coords)
    if (head && !head.noHand && exitP <= 0 && opts.showHand !== false) {
      const world = localToWorld(layer, head.x, head.y);
      ctx.save();
      drawHandOverlay(ctx, layer, { x: world.x, y: world.y, angle: (head.angle || 0) + (layer.rot || 0) * Math.PI / 180 }, t, opts);
      ctx.restore();
    }
    return head;
  }

  function localToWorld(layer, x, y) {
    const cx = layer.x + layer.w / 2, cy = layer.y + layer.h / 2;
    let lx = x - layer.w / 2, ly = y - layer.h / 2;
    if (layer.flipX) lx = -lx;
    if (layer.flipY) ly = -ly;
    if (layer.rot) {
      const r = layer.rot * Math.PI / 180, cos = Math.cos(r), sin = Math.sin(r);
      const rx = lx * cos - ly * sin, ry = lx * sin + ly * cos;
      lx = rx; ly = ry;
    }
    return { x: cx + lx, y: cy + ly };
  }

  /** full scene frame at scene-local time t */
  function renderSceneFrame(project, sceneIdx, t, ctx, opts = {}) {
    const scene = project.scenes[sceneIdx];
    const cw = project.canvas.width, ch = project.canvas.height;
    ctx.save();
    ctx.clearRect(0, 0, cw, ch);
    ctx.drawImage(backgroundCanvas(project, scene), 0, 0);
    const cam = evalCamera(project, scene, t);
    const portrait = ch > cw;
    ctx.save();
    if (cam.zoom !== 1 || cam.x !== 0.5 || cam.y !== 0.5) {
      ctx.translate(cw / 2, ch / 2);
      ctx.scale(cam.zoom, cam.zoom);
      ctx.translate(-cam.x * cw, -cam.y * ch);
    }
    const ropts = { showHand: opts.showHand !== false && !opts.editMode ? true : opts.showHand, defaultHand: scene.defaultHand || 'hand1', portrait, canvasH: ch, editMode: opts.editMode };
    if (opts.editMode) ropts.showHand = false;
    // layers sequentially
    ctx.save();
    if (scene.background.type === 'neon') { ctx.shadowColor = 'rgba(70,240,230,.55)'; }
    for (const layer of scene.layers) renderLayer(ctx, project, scene, layer, t, ropts);
    ctx.restore();
    ctx.restore();
    ctx.restore();
    return { camera: cam };
  }

  /* ── transitions ── */
  function frameCanvasOf(project, sceneIdx, t, reuse) {
    const cw = project.canvas.width, ch = project.canvas.height;
    const c = reuse || U.makeCanvas(cw, ch);
    renderSceneFrame(project, sceneIdx, t, c.getContext('2d'), { showHand: false });
    return c;
  }

  function renderProjectFrame(project, t, ctx, opts = {}) {
    const cw = project.canvas.width, ch = project.canvas.height;
    const { idx, local } = timeToScene(project, t);
    const scene = project.scenes[idx];
    const tr = scene.transition || { type: 'none', duration: 0 };
    if (idx > 0 && tr.type !== 'none' && tr.duration > 0 && local < tr.duration) {
      const p = U.smoothstep(local / tr.duration);
      const prevIdx = idx - 1;
      const prevDur = sceneDuration(project, project.scenes[prevIdx]);
      const A = frameCanvasOf(project, prevIdx, prevDur, project._transA ? project._transA : (project._transA = U.makeCanvas(cw, ch)));
      const B = frameCanvasOf(project, idx, local, project._transB ? project._transB : (project._transB = U.makeCanvas(cw, ch)));
      ctx.clearRect(0, 0, cw, ch);
      const type = tr.type;
      if (type === 'fade' || type === 'erase') {
        ctx.globalAlpha = 1; ctx.drawImage(A, 0, 0);
        ctx.globalAlpha = p; ctx.drawImage(B, 0, 0); ctx.globalAlpha = 1;
      } else if (type.startsWith('wipe')) {
        ctx.drawImage(A, 0, 0);
        ctx.save(); ctx.beginPath();
        if (type === 'wipe-left') ctx.rect(cw * (1 - p), 0, cw * p, ch);
        else if (type === 'wipe-right') ctx.rect(0, 0, cw * p, ch);
        else if (type === 'wipe-up') ctx.rect(0, ch * (1 - p), cw, ch * p);
        else ctx.rect(0, 0, cw, ch * p);
        ctx.clip(); ctx.drawImage(B, 0, 0); ctx.restore();
      } else if (type.startsWith('slide')) {
        let ax = 0, ay = 0, bx = 0, by = 0;
        if (type === 'slide-left') { ax = -cw * p; bx = cw * (1 - p); }
        else if (type === 'slide-right') { ax = cw * p; bx = -cw * (1 - p); }
        else if (type === 'slide-up') { ay = -ch * p; by = ch * (1 - p); }
        else { ay = ch * p; by = -ch * (1 - p); }
        ctx.drawImage(A, ax, ay); ctx.drawImage(B, bx, by);
      } else if (type === 'zoom') {
        ctx.save();
        ctx.globalAlpha = 1 - p * 0.7;
        ctx.translate(cw / 2, ch / 2); ctx.scale(1 + p * 0.35, 1 + p * 0.35); ctx.drawImage(A, -cw / 2, -ch / 2);
        ctx.restore();
        ctx.save();
        ctx.globalAlpha = p;
        ctx.translate(cw / 2, ch / 2); ctx.scale(1.25 - p * 0.25, 1.25 - p * 0.25); ctx.drawImage(B, -cw / 2, -ch / 2);
        ctx.restore();
      } else ctx.drawImage(B, 0, 0);
      return { idx, local };
    }
    renderSceneFrame(project, idx, local, ctx, opts);
    return { idx, local };
  }

  /* ═══════════════ exports of the module ═══════════════ */
  /* ═══════════════ playback audio sync (HTMLAudioElements vs playhead) ═══════════════ */
  const pbEls = new Map(); // layerId | 'voiceover' -> HTMLAudioElement

  function driveAudioEl(key, conf, rel) {
    const mediaDur = conf.mediaDuration || 0;
    if (!conf.loop && mediaDur > 0 && rel >= mediaDur) { pauseAudioKey(key); return; }
    let el = SD.assets.audioElSync(conf.assetId);
    if (!el) { SD.assets.ensureAudio(conf.assetId).then(() => { if (SD.assets.audioElSync(conf.assetId)) SD.assets.audioElSync(conf.assetId).volume = U.clamp(conf.volume ?? 1, 0, 1); }).catch(() => {}); return; }
    el.volume = U.clamp(conf.volume ?? 1, 0, 1);
    el.loop = !!conf.loop;
    const dur = el.duration || mediaDur;
    pbEls.set(key, el);
    if (dur > 0) {
      const want = conf.loop ? (rel % dur) : rel;
      if (Math.abs(el.currentTime - want) > 0.15 || (el.paused && want > 0.02 && el.currentTime === 0)) {
        try { el.currentTime = Math.min(want, Math.max(0, dur - 0.04)); } catch {}
      }
    }
    if (el.paused) el.play().catch(() => {});
  }
  function pauseAudioKey(key) {
    const el = pbEls.get(key);
    if (el) { try { el.pause(); } catch {} }
  }
  /** keep audio aligned with the playhead: call each playback tick, and with playing=false on pause/stop */
  function syncAudio(project, sceneIdx, localT, playing) {
    if (!project || !project.scenes) return;
    const active = new Set();
    const scene = project.scenes[sceneIdx];
    if (playing && scene) {
      for (const l of scene.layers) {
        if (l.type !== 'audio' || !l.audio || l.visible === false) continue;
        const key = l.id, rel = localT - (l.start || 0);
        if (rel >= 0 && rel < Math.max(0.01, l.duration || 0)) { active.add(key); driveAudioEl(key, l.audio, rel); }
        else pauseAudioKey(key);
      }
      const vo = project.voiceover;
      if (vo && vo.assetId) {
        const gRel = (sceneStarts(project)[sceneIdx] + localT) - (vo.start || 0);
        const vDur = vo.mediaDuration || 0;
        if (gRel >= 0 && (!vDur || gRel < vDur)) { active.add('voiceover'); driveAudioEl('voiceover', vo, gRel); }
        else pauseAudioKey('voiceover');
      }
    }
    for (const [key] of pbEls) if (!active.has(key)) pauseAudioKey(key);
  }
  function stopAllAudio() { for (const [key] of pbEls) pauseAudioKey(key); }

  SD.engine = {
    defaultAnim, BG_DEFS, sceneBgColor, backgroundCanvas,
    layerContent, planFor, estimateDuration,
    evalCamera, autoCamera,
    contentEnd, sceneDuration, sceneStarts, projectDuration, timeToScene,
    syncAudio, stopAllAudio,
    renderSceneFrame, renderProjectFrame, renderLayer, localToWorld,
    styles, textLayout, headAt, paintStrokes, drawStrokesTo,
    invalidateLayer(layer) { layer._content = null; layer._plan = null; },
    invalidateScene(scene) { scene._bg = null; scene.layers.forEach((l) => SD.engine.invalidateLayer(l)); },
  };
})();
