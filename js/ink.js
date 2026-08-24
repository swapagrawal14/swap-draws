/* SwapDraws — ink.js : image analysis
   Edge detection (Canny-lite / adaptive / chroma / LoG), ink-map → pen-stroke
   tracing, and ordered reveal-point generators used by all animation styles. */
(function () {
  const SD = (window.SD = window.SD || {});
  const U = SD.util;

  /* ── grayscale + optional downscale ─────────────────────────── */
  function lumaOf(data, W, H) {
    const lum = new Float32Array(W * H);
    for (let i = 0; i < W * H; i++) {
      const a = data[i * 4 + 3];
      // composite transparent pixels onto white (typical board)
      const ar = a / 255;
      lum[i] = (0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2]) * ar + 255 * (1 - ar);
    }
    return lum;
  }

  /* ── ALG 1 · edge: gaussian → sobel → NMS → hysteresis ─────── */
  function detectEdge(data, W, H, mask, sens) {
    const lum = lumaOf(data, W, H);
    // 3x3 gaussian blur with clamped borders (avoids a fake frame edge)
    const blur = new Float32Array(W * H);
    for (let y = 0; y < H; y++) {
      const y0 = Math.max(0, y - 1) * W, y1 = y * W, y2 = Math.min(H - 1, y + 1) * W;
      for (let x = 0; x < W; x++) {
        const x0 = Math.max(0, x - 1), x2 = Math.min(W - 1, x + 1);
        blur[y1 + x] = (lum[y0 + x0] + 2 * lum[y0 + x] + lum[y0 + x2] + 2 * lum[y1 + x0] + 4 * lum[y1 + x] + 2 * lum[y1 + x2] + lum[y2 + x0] + 2 * lum[y2 + x] + lum[y2 + x2]) / 16;
      }
    }
    const mag = new Float32Array(W * H), dir = new Uint8Array(W * H);
    let maxMag = 1e-6;
    for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
      const i = y * W + x;
      const gx = -blur[i - W - 1] - 2 * blur[i - 1] - blur[i + W - 1] + blur[i - W + 1] + 2 * blur[i + 1] + blur[i + W + 1];
      const gy = -blur[i - W - 1] - 2 * blur[i - W] - blur[i - W + 1] + blur[i + W - 1] + 2 * blur[i + W] + blur[i + W + 1];
      const m = Math.hypot(gx, gy);
      mag[i] = m; if (m > maxMag) maxMag = m;
      const a = Math.atan2(gy, gx) * 180 / Math.PI;
      dir[i] = (a > -22.5 && a <= 22.5) || a > 157.5 || a <= -157.5 ? 0 : (a > 22.5 && a <= 67.5) || (a > -157.5 && a <= -112.5) ? 1 : (a > 67.5 && a <= 112.5) || (a > -112.5 && a <= -67.5) ? 2 : 3;
    }
    const hiFrac = 0.22 - sens * 0.13;   // sensitivity raises edge-catching
    const hi = maxMag * Math.max(0.06, hiFrac), lo = hi * 0.45;
    const strong = new Uint8Array(W * H);
    for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
      const i = y * W + x;
      const m = mag[i]; if (m < lo) continue;
      // non-max suppression along gradient direction
      let n1 = 0, n2 = 0;
      if (dir[i] === 0) { n1 = mag[i - 1]; n2 = mag[i + 1]; }
      else if (dir[i] === 1) { n1 = mag[i - W + 1]; n2 = mag[i + W - 1]; }
      else if (dir[i] === 2) { n1 = mag[i - W]; n2 = mag[i + W]; }
      else { n1 = mag[i - W - 1]; n2 = mag[i + W + 1]; }
      if (m >= n1 && m >= n2) strong[i] = m >= hi ? 2 : 1;
    }
    // hysteresis: weak edges kept only if connected to strong
    const ink = new Uint8Array(W * H);
    const stack = [];
    for (let i = 0; i < W * H; i++) if (strong[i] === 2) { ink[i] = 1; stack.push(i); }
    while (stack.length) {
      const i = stack.pop(), x = i % W, y = (i / W) | 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const ni = ny * W + nx;
        if (!ink[ni] && strong[ni] === 1) { ink[ni] = 1; stack.push(ni); }
      }
    }
    return ink;
  }

  /* ── ALG 2 · adaptive: local mean threshold via integral image ── */
  function detectAdaptive(data, W, H, mask, sens) {
    const lum = lumaOf(data, W, H);
    const R = Math.max(3, Math.round(15 - sens * 9));
    const ratio = 0.82 - sens * 0.32;
    const II = new Float64Array((W + 1) * (H + 1));
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++)
      II[(y + 1) * (W + 1) + (x + 1)] = lum[y * W + x] + II[y * (W + 1) + (x + 1)] + II[(y + 1) * (W + 1) + x] - II[y * (W + 1) + x];
    const boxMean = (x, y, r) => {
      const x1 = Math.max(0, x - r), y1 = Math.max(0, y - r);
      const x2 = Math.min(W, x + r + 1), y2 = Math.min(H, y + r + 1);
      const n = (x2 - x1) * (y2 - y1);
      return (II[y2 * (W + 1) + x2] - II[y1 * (W + 1) + x2] - II[y2 * (W + 1) + x1] + II[y1 * (W + 1) + x1]) / n;
    };
    const ink = new Uint8Array(W * H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const m = boxMean(x, y, R);
      if (m > 24 && lum[y * W + x] < m * ratio) ink[y * W + x] = 1;
    }
    return ink;
  }

  /* ── ALG 3 · chroma: max RGB distance to neighbors + NMS ────── */
  function detectChroma(data, W, H, mask, sens) {
    const T = 150 - sens * 115;
    const grad = new Float32Array(W * H);
    for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
      const i4 = (y * W + x) * 4;
      const pr = data[i4], pg = data[i4 + 1], pb = data[i4 + 2];
      let maxD = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const ni = ((y + dy) * W + (x + dx)) * 4;
        const dr = pr - data[ni], dg = pg - data[ni + 1], db = pb - data[ni + 2];
        const d = dr * dr + dg * dg + db * db;
        if (d > maxD) maxD = d;
      }
      grad[y * W + x] = Math.sqrt(maxD);
    }
    const ink = new Uint8Array(W * H);
    for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
      const i = y * W + x;
      if (grad[i] < T) continue;
      let isMax = true;
      for (let dy = -1; dy <= 1 && isMax; dy++) for (let dx = -1; dx <= 1 && isMax; dx++) {
        if (grad[(y + dy) * W + (x + dx)] > grad[i]) isMax = false;
      }
      if (isMax) ink[i] = 1;
    }
    return ink;
  }

  /* ── ALG 4 · log: gaussian blur → laplacian → zero-crossings ── */
  function detectLoG(data, W, H, mask, sens) {
    const sigma = 0.9 + sens * 2.0;
    const floor = 26 - sens * 20;
    const lum = lumaOf(data, W, H);
    // separable gaussian
    const kr = Math.max(1, Math.round(sigma * 2));
    const k = new Float32Array(kr * 2 + 1);
    let ks = 0;
    for (let i = -kr; i <= kr; i++) { k[i + kr] = Math.exp(-(i * i) / (2 * sigma * sigma)); ks += k[i + kr]; }
    for (let i = 0; i < k.length; i++) k[i] /= ks;
    const tmp = new Float32Array(W * H), blur = new Float32Array(W * H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      let s = 0;
      for (let i = -kr; i <= kr; i++) s += lum[y * W + U.clamp(x + i, 0, W - 1)] * k[i + kr];
      tmp[y * W + x] = s;
    }
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      let s = 0;
      for (let i = -kr; i <= kr; i++) s += tmp[U.clamp(y + i, 0, H - 1) * W + x] * k[i + kr];
      blur[y * W + x] = s;
    }
    const ink = new Uint8Array(W * H);
    for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
      const i = y * W + x;
      const center = blur[i];
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const n = blur[i + dy * W + dx];
        if ((center < 0) !== (n < 0) && Math.abs(center - n) > floor) { ink[i] = 1; dy = 2; break; }
      }
    }
    return ink;
  }

  const DETECTORS = { edge: detectEdge, adaptive: detectAdaptive, chroma: detectChroma, log: detectLoG };

  /* ── thickness filter: drop pixels inside thick filled blobs ── */
  /* ── Zhang–Suen thinning: binary mask → 1px centerline skeleton ──
     Text glyphs traced along their medial axis look genuinely hand-written
     (tracing both edges of every glyph produces zig-zag hash marks and
     cross-leaps between the two contour sides). */
  function skeletonize(inkSrc, W, H, maxIter = 60) {
    const img = inkSrc.slice();
    const P = (x, y) => img[y * W + x];
    let changed = true, iter = 0;
    while (changed && iter++ < maxIter) {
      changed = false;
      for (let phase = 0; phase < 2; phase++) {
        const kill = [];
        for (let y = 1; y < H - 1; y++) {
          for (let x = 1; x < W - 1; x++) {
            if (!P(x, y)) continue;
            const p2 = P(x, y - 1), p3 = P(x + 1, y - 1), p4 = P(x + 1, y), p5 = P(x + 1, y + 1),
              p6 = P(x, y + 1), p7 = P(x - 1, y + 1), p8 = P(x - 1, y), p9 = P(x - 1, y - 1);
            const B = p2 + p3 + p4 + p5 + p6 + p7 + p8 + p9;
            if (B < 2 || B > 6) continue;
            const seq = [p2, p3, p4, p5, p6, p7, p8, p9, p2];
            let A = 0;
            for (let k = 0; k < 8; k++) if (!seq[k] && seq[k + 1]) A++;
            if (A !== 1) continue;
            if (phase === 0) {
              if (p2 * p4 * p6 !== 0) continue;
              if (p4 * p6 * p8 !== 0) continue;
            } else {
              if (p2 * p4 * p8 !== 0) continue;
              if (p2 * p6 * p8 !== 0) continue;
            }
            kill.push(y * W + x);
          }
        }
        if (kill.length) { changed = true; for (const i of kill) img[i] = 0; }
      }
    }
    return img;
  }

  function countInk(ink) { let n = 0; for (let i = 0; i < ink.length; i++) n += ink[i]; return n; }

  function thicknessFilter(ink, W, H, maxT) {
    const out = new Uint8Array(W * H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (!ink[i]) continue;
      let h = 1; while (x + h < W && ink[y * W + x + h]) h++;
      let h2 = 1; while (x - h2 >= 0 && ink[y * W + (x - h2)]) h2++;
      if (h + h2 - 1 > maxT) {
        let v = 1; while (y + v < H && ink[(y + v) * W + x]) v++;
        let v2 = 1; while (y - v2 >= 0 && ink[(y - v2) * W + x]) v2++;
        if (v + v2 - 1 > maxT) continue;
      }
      out[i] = 1;
    }
    return out;
  }

  /* ── trace ink map into ordered polyline strokes ──────────────
     Greedy nearest-neighbor walking with grid hashing. Produces
     organic, hand-following paths: each stroke drawn start→end,
     pen lifts between strokes. */
  function traceStrokes(ink, W, H, opts = {}) {
    const maxJump = opts.maxJump || 3;          // px within same stroke
    const minLen = opts.minLen || 5;            // discard shorter strokes
    const visited = new Uint8Array(W * H);
    const cell = 8;
    const gw = Math.ceil(W / cell), gh = Math.ceil(H / cell);
    const grid = new Array(gw * gh);
    const pts = [];
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      if (!ink[y * W + x]) continue;
      const p = [x, y]; pts.push(p);
      const gi = ((y / cell) | 0) * gw + ((x / cell) | 0);
      (grid[gi] = grid[gi] || []).push(p);
    }
    const neighborCells = (x, y, r) => {
      const out = [];
      const cx = (x / cell) | 0, cy = (y / cell) | 0;
      for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
        const nx = cx + dx, ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= gw || ny >= gh) continue;
        const g = grid[ny * gw + nx];
        if (g) out.push(...g);
      }
      return out;
    };
    const strokes = [];
    // Seed scanning top-left → bottom-right for organic reading flow
    for (const p of pts) {
      const pi = p[1] * W + p[0];
      if (visited[pi]) continue;
      // start a stroke
      const path = [p[0], p[1]];
      visited[pi] = 1;
      let cur = p;
      // walk forward
      let alive = true;
      while (alive) {
        alive = false;
        const cand = neighborCells(cur[0], cur[1], 1);
        let best = null, bestD = maxJump * maxJump;
        for (const q of cand) {
          if (visited[q[1] * W + q[0]]) continue;
          const d = (q[0] - cur[0]) ** 2 + (q[1] - cur[1]) ** 2;
          if (d <= bestD) { best = q; bestD = d; }
        }
        if (best) {
          visited[best[1] * W + best[0]] = 1;
          path.push(best[0], best[1]);
          cur = best; alive = true;
        }
      }
      if (path.length >= 4) {
        let len = 0;
        for (let i = 2; i < path.length; i += 2) len += Math.hypot(path[i] - path[i - 2], path[i + 1] - path[i - 1]);
        if (len >= minLen) strokes.push({ pts: new Float32Array(path), len });
      }
    }
    return strokes;
  }

  /* order strokes so text reads naturally: line by line, left to right */
  /* Natural pen-flow ordering for text: start at the top-left stroke, then
     greedily walk to the nearest stroke end (reversing strokes when their tail
     is closer than their head) with a left→right bias. Skeleton branches split
     glyphs into multiple strokes, so naive x-sorting scatters pieces across the
     line; greedy sequencing keeps the hand moving like real writing. */
  function orderForText(strokes, lineH) {
    if (!strokes.length) return strokes;
    const lastP = (s) => { const n = s.pts.length / 2; return { x: s.pts[(n - 1) * 2], y: s.pts[(n - 1) * 2 + 1] }; };
    const reverse = (s) => {
      const arr = s.pts, n = arr.length / 2;
      for (let i = 0, j = n - 1; i < j; i++, j--) {
        const tx = arr[i * 2], ty = arr[i * 2 + 1];
        arr[i * 2] = arr[j * 2]; arr[i * 2 + 1] = arr[j * 2 + 1];
        arr[j * 2] = tx; arr[j * 2 + 1] = ty;
      }
    };
    // greedy nearest-next sequencing within one text line, left→right bias
    const seqLine = (input) => {
      const pool = input.slice();
      // seed: leftmost among strokes reaching the line's top zone
      let minY = Infinity;
      for (const s of pool) if (s.pts[1] < minY) minY = s.pts[1];
      let seed = 0, sx = Infinity;
      for (let i = 0; i < pool.length; i++) {
        if (pool[i].pts[1] <= minY + lineH * 0.8 && pool[i].pts[0] < sx) { sx = pool[i].pts[0]; seed = i; }
      }
      const out = [];
      let pen = { x: sx - 1, y: minY };
      if (seed !== 0) { const t = pool[0]; pool[0] = pool[seed]; pool[seed] = t; }
      while (pool.length) {
        let bi = 0, bc = Infinity, brev = false;
        for (let i = 0; i < pool.length; i++) {
          const s = pool[i];
          const n = s.pts.length / 2;
          const f = { x: s.pts[0], y: s.pts[1] }, l = lastP(s);
          const bias = 0.3;
          const c0 = Math.hypot(f.x - pen.x, f.y - pen.y) - bias * Math.min(60, Math.max(0, f.x - pen.x));
          const c1 = Math.hypot(l.x - pen.x, l.y - pen.y) - bias * Math.min(60, Math.max(0, l.x - pen.x));
          const c = Math.min(c0, c1);
          if (c < bc) { bc = c; bi = i; brev = c1 < c0; }
        }
        const s = pool.splice(bi, 1)[0];
        if (brev) reverse(s);
        pen = lastP(s);
        out.push(s);
      }
      return out;
    };
    // cluster strokes into text lines: sort by start-y, split on gaps > 0.6 lineH
    const sorted = strokes.slice().sort((a, b) => a.pts[1] - b.pts[1]);
    const clusters = [[sorted[0]]];
    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i].pts[1] - sorted[i - 1].pts[1] > lineH * 0.6) clusters.push([]);
      clusters[clusters.length - 1].push(sorted[i]);
    }
    const out = [];
    for (const c of clusters) out.push(...seqLine(c));
    return out;
  }

  /* finalize strokes: per-stroke cumulative lengths + global running total */
  function finalizeStrokes(strokes, scale) {
    let total = 0;
    const out = strokes.map((s) => {
      const n = s.pts.length / 2;
      const pts = scale !== 1 ? new Float32Array(n * 2) : s.pts;
      if (scale !== 1) for (let i = 0; i < s.pts.length; i++) pts[i] = s.pts[i] * scale;
      const cum = new Float32Array(n);
      let d = 0;
      for (let i = 1; i < n; i++) d += Math.hypot(pts[i * 2] - pts[i * 2 - 2], pts[i * 2 + 1] - pts[i * 2 - 1]), cum[i] = d;
      const st = { pts, cum, len: scale !== 1 ? s.len * scale : s.len, start: total };
      total += st.len;
      return st;
    });
    return { strokes: out, totalLen: total };
  }

  /* ── main: content canvas → ink plan ────────────────────────── */
  function buildInkPlan(contentCanvas, opts = {}) {
    const algo = opts.algo || 'edge';
    const sens = U.clamp(opts.sensitivity ?? 0.5, 0, 1);
    const maxDim = opts.detectSize || 640;
    const cw = contentCanvas.width, ch = contentCanvas.height;
    const scale = Math.min(1, maxDim / Math.max(cw, ch));
    const dw = Math.max(4, Math.round(cw * scale)), dh = Math.max(4, Math.round(ch * scale));
    const dc = U.makeCanvas(dw, dh);
    const dctx = dc.getContext('2d', { willReadFrequently: true });
    dctx.drawImage(contentCanvas, 0, 0, dw, dh);
    const data = dctx.getImageData(0, 0, dw, dh).data;

    let preSkelCount = 0;
    if (opts.fillAlpha) {
      // exact glyph fill from the alpha channel (perfect for text / flat art)
      let inkA = new Uint8Array(dw * dh);
      const th = opts.alphaThresh ?? 128;
      for (let i = 0; i < dw * dh; i++) inkA[i] = data[i * 4 + 3] > th ? 1 : 0;
      preSkelCount = countInk(inkA);
      ink = inkA;
    } else {
      const detect = DETECTORS[algo] || detectEdge;
      ink = detect(data, dw, dh, null, sens);
      const maxT = Math.round((5 + sens * 7) * (opts.thicknessScale || 1));
      if (algo !== 'log') ink = thicknessFilter(ink, dw, dh, maxT);
    }
    if (opts.skeleton) {
      if (!preSkelCount) preSkelCount = countInk(ink);
      ink = skeletonize(ink, dw, dh);
    }

    const skel = !!opts.skeleton;
    let strokes = traceStrokes(ink, dw, dh, { maxJump: skel ? 2 : 3, minLen: skel ? 4 : 6 });
    if (opts.order === 'text') strokes = orderForText(strokes, (opts.textLineH ? opts.textLineH * scale : Math.max(12, dh / 8)));
    else if (opts.order === 'ltr') strokes = strokes.slice().sort((a, b) => a.pts[0] - b.pts[0]);
    else if (opts.order === 'rtl') strokes = strokes.slice().sort((a, b) => b.pts[0] - a.pts[0]);
    else if (opts.order === 'ttb') strokes = strokes.slice().sort((a, b) => a.pts[1] - b.pts[1]);
    else if (opts.order === 'btt') strokes = strokes.slice().sort((a, b) => b.pts[1] - a.pts[1]);
    else if (opts.order === 'random') { const rnd = U.mulberry32(42); strokes = strokes.slice(); for (let i = strokes.length - 1; i > 0; i--) { const j = (rnd() * (i + 1)) | 0; [strokes[i], strokes[j]] = [strokes[j], strokes[i]]; } }
    const inv = 1 / scale;
    const fin = finalizeStrokes(strokes, inv);
    fin.ink = ink; fin.dw = dw; fin.dh = dh; fin.scale = scale;
    if (skel) {
      // average glyph thickness (fill area / skeleton length) → natural pen width
      const skelLen = countInk(ink);
      const avgT = preSkelCount / Math.max(1, skelLen);   // detect px
      fin.strokeW = Math.max(1.5, Math.min(140, avgT / scale * 0.96));
    }
    return fin;
  }

  /* ── ordered reveal points (dab circles) for fill/mask styles ── */
  function revealOrder(w, h, opts = {}) {
    const step = opts.step || Math.max(10, Math.min(w, h) / 26);
    const r = step * 0.85;
    const type = opts.type || 'serpentine';
    const rnd = U.mulberry32(opts.seed || 7);
    const pts = [];
    if (type === 'spiral' || type === 'radial' || type === 'iris') {
      const cx = w / 2, cy = h / 2;
      const maxR = Math.hypot(cx, cy) + step;
      if (type === 'spiral') {
        const turns = Math.ceil(maxR / (step * 0.9));
        const total = turns * Math.PI * 2;
        const n = Math.ceil(total * (maxR / 2) / (step * 0.8)) + 20;
        for (let i = 0; i <= n; i++) {
          const t = i / n;
          const ang = t * total;
          const rr = t * maxR;
          pts.push({ x: cx + Math.cos(ang) * rr, y: cy + Math.sin(ang) * rr, r: r * 1.15 });
        }
      } else {
        for (let rr = step; rr <= maxR; rr += step * 0.9) {
          const n = Math.max(8, Math.ceil((Math.PI * 2 * rr) / (step * 0.8)));
          for (let i = 0; i < n; i++) {
            const a = (i / n) * Math.PI * 2;
            pts.push({ x: cx + Math.cos(a) * rr, y: cy + Math.sin(a) * rr, r: r * 1.15 });
          }
        }
      }
    } else if (type === 'scatter') {
      for (let y = step / 2; y < h; y += step) for (let x = step / 2; x < w; x += step)
        pts.push({ x: x + (rnd() - 0.5) * step * 0.5, y: y + (rnd() - 0.5) * step * 0.5, r });
      for (let i = pts.length - 1; i > 0; i--) { const j = (rnd() * (i + 1)) | 0; [pts[i], pts[j]] = [pts[j], pts[i]]; }
    } else if (type === 'ltr' || type === 'rtl' || type === 'ttb' || type === 'btt') {
      const horiz = type === 'ltr' || type === 'rtl';
      const rev = type === 'rtl' || type === 'btt';
      if (horiz) {
        for (let x = step / 2; x < w; x += step) for (let y = step / 2; y < h; y += step * 0.9) pts.push({ x, y, r });
        if (rev) pts.reverse();
      } else {
        for (let y = step / 2; y < h; y += step) for (let x = step / 2; x < w; x += step * 0.9) pts.push({ x, y, r });
        if (rev) pts.reverse();
      }
    } else { // serpentine
      let row = 0;
      for (let y = step / 2; y < h; y += step, row++) {
        const xs = [];
        for (let x = step / 2; x < w; x += step * 0.9) xs.push(x);
        if (row % 2) xs.reverse();
        for (const x of xs) pts.push({ x, y, r });
      }
    }
    return pts;
  }

  /* chunked tiles for the "chunk jump" style */
  function tileOrder(w, h, opts = {}) {
    const cols = opts.cols || 5, rows = opts.rows || 4;
    const rnd = U.mulberry32(opts.seed || 11);
    const tiles = [];
    for (let ty = 0; ty < rows; ty++) for (let tx = 0; tx < cols; tx++)
      tiles.push({ x: (tx * w) / cols, y: (ty * h) / rows, w: w / cols, h: h / rows });
    for (let i = tiles.length - 1; i > 0; i--) { const j = (rnd() * (i + 1)) | 0; [tiles[i], tiles[j]] = [tiles[j], tiles[i]]; }
    return tiles;
  }

  SD.ink = { DETECTORS, detectEdge, traceStrokes, finalizeStrokes, buildInkPlan, revealOrder, tileOrder, thicknessFilter, skeletonize };
})();
