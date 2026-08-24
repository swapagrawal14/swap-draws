/* SwapDraws — stage.js : main editing surface — view transforms, selection,
   move/resize/rotate handles with snapping, inline text edit, drawing mode,
   playback preview loop. */
(function () {
  const SD = (window.SD = window.SD || {});
  const U = SD.util;
  const A = () => SD.state;
  const E = () => SD.engine;

  const ST = {
    canvas: null, ctx: null,
    scale: 1,              // css px per world px (composed stageScale)
    baseScale: 1,          // "fit" scale
    zoomFactor: 1,
    needsFrame: true,
    drag: null,            // active drag session
    drawing: null,         // drawing-mode session
    textEdit: null,
    lastFrameT: 0,
    rafId: null,
    spaceDown: false,
  };

  /* ── boot ── */
  function init() {
    ST.canvas = U.$('#stageCanvas');
    window.addEventListener('resize', () => { layout(); scheduleFrame(); });
    U.$('#stageZoomIn').addEventListener('click', () => zoomStep(1.25));
    U.$('#stageZoomOut').addEventListener('click', () => zoomStep(0.8));
    U.$('#stageFit').addEventListener('click', fit);
    U.$('#stageZoomLabel').addEventListener('click', fit);
    const scroller = U.$('#stageScroller');
    scroller.addEventListener('wheel', (e) => {
      if (e.ctrlKey || e.metaKey) { e.preventDefault(); zoomStep(e.deltaY < 0 ? 1.12 : 0.89, e); }
    }, { passive: false });

    ST.canvas.addEventListener('pointerdown', onPointerDown);
    ST.canvas.addEventListener('dblclick', onDblClick);
    window.addEventListener('pointermove', onPointerMove, { passive: false });
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('keydown', (e) => { if (e.code === 'Space' && e.target === document.body) ST.spaceDown = true; });
    window.addEventListener('keyup', (e) => { if (e.code === 'Space') ST.spaceDown = false; });

    U.bus.on('change', () => scheduleFrame());
    U.bus.on('selection', () => scheduleFrame());
    U.bus.on('layer-ready', () => scheduleFrame());
    U.bus.on('time', () => scheduleFrame());
    U.bus.on('project-loaded', () => { fit(); });
    bindTextOverlay();
  }

  /* ── layout / zoom ── */
  function layout() {
    const p = A().project; if (!p) return;
    const disp = displayScale();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const cssW = Math.max(40, p.canvas.width * disp), cssH = Math.max(40, p.canvas.height * disp);
    ST.canvas.style.width = cssW + 'px';
    ST.canvas.style.height = cssH + 'px';
    ST.canvas.width = Math.round(cssW * dpr);
    ST.canvas.height = Math.round(cssH * dpr);
    ST.dpr = dpr;
    U.$('#stageZoomLabel').textContent = Math.round(disp * 100) + '%';
    U.$('#hudCanvasSize').textContent = `${p.canvas.width} × ${p.canvas.height}`;
    scheduleFrame();
  }
  function displayScale() { return ST.baseScale * ST.zoomFactor; }
  function fit() {
    const p = A().project; if (!p) return;
    const scroller = U.$('#stageScroller');
    const r = scroller.getBoundingClientRect();
    const availW = Math.max(120, r.width - 60), availH = Math.max(120, r.height - 60);
    ST.baseScale = Math.min(availW / p.canvas.width, availH / p.canvas.height);
    ST.zoomFactor = 1;
    layout();
  }
  function zoomStep(f, ev) {
    ST.zoomFactor = U.clamp(ST.zoomFactor * f, 0.15, 8);
    layout();
  }
  function worldFromEvent(e) {
    const r = ST.canvas.getBoundingClientRect();
    const s = displayScale();
    return { x: (e.clientX - r.left) / s, y: (e.clientY - r.top) / s };
  }
  function cssFromWorld(x, y) {
    const r = ST.canvas.getBoundingClientRect();
    const s = displayScale();
    return { x: r.left + x * s, y: r.top + y * s };
  }

  /* ── frame scheduling ── */
  function scheduleFrame() {
    if (ST.rafId) return;
    ST.rafId = requestAnimationFrame(() => { ST.rafId = null; frame(); });
    updateEmptyHint();
  }
  function updateEmptyHint() {
    const s = A().project && A().scene();
    U.$('#stageEmpty').hidden = !(s && s.layers.length === 0 && !ST.drawing);
    const name = s ? s.name : '';
    const el = U.$('#hudSceneName'); if (el) el.textContent = name;
  }

  function frame() {
    const S = A(), p = S.project; if (!p || !ST.canvas) return;
    const ctx = ST.canvas.getContext('2d');
    const s = displayScale();
    ctx.setTransform(ST.dpr, 0, 0, ST.dpr, 0, 0);
    ctx.clearRect(0, 0, ST.canvas.width / ST.dpr, ST.canvas.height / ST.dpr);
    ctx.save();
    ctx.scale(s, s);
    E().renderSceneFrame(p, p.activeSceneIdx, S.editTime, ctx, { editMode: !playState.playing });
    ctx.restore();

    // overlays in world space
    ctx.save();
    ctx.scale(s, s);
    if (S.playing) { /* clean preview: no editing overlays */ }
    else if (U.$('#optGrid')?.checked) drawGridOverlay(ctx, p);
    if (!S.playing && U.$('#optSafe')?.checked) drawSafeOverlay(ctx, p);
    if (!S.playing && ST.drag && ST.drag.guides) drawGuides(ctx, ST.drag.guides);
    ctx.restore();

    // drawing session on top
    if (ST.drawing) {
      ctx.save(); ctx.scale(s, s);
      drawSessionPreview(ctx, ST.drawing);
      ctx.restore();
    }
    // selection chrome in css space
    if (!S.playing && !ST.drawing) drawSelection(ctx, s);
    // marquee in css space
    const m = ST.marquee;
    if (m) {
      const d = U.$('#marqueeDiv');
      const r = ST.canvas.parentElement.getBoundingClientRect();
      const a = cssFromWorld(Math.min(m.x0, m.x1), Math.min(m.y0, m.y1));
      const b = cssFromWorld(Math.max(m.x0, m.x1), Math.max(m.y0, m.y1));
      const pr = ST.canvas.getBoundingClientRect();
      d.hidden = false;
      d.style.left = (a.x - pr.left) + 'px'; d.style.top = (a.y - pr.top) + 'px';
      d.style.width = (b.x - a.x) + 'px'; d.style.height = (b.y - a.y) + 'px';
    } else U.$('#marqueeDiv').hidden = true;
  }

  function drawGridOverlay(ctx, p) {
    const step = p.canvas.width / 24;
    ctx.strokeStyle = 'rgba(120,140,190,.14)';
    ctx.lineWidth = 1 / displayScale();
    ctx.beginPath();
    for (let x = step; x < p.canvas.width; x += step) { ctx.moveTo(x, 0); ctx.lineTo(x, p.canvas.height); }
    for (let y = step; y < p.canvas.height; y += step) { ctx.moveTo(0, y); ctx.lineTo(p.canvas.width, y); }
    ctx.stroke();
  }
  function drawSafeOverlay(ctx, p) {
    const mX = p.canvas.width * 0.05, mY = p.canvas.height * 0.05;
    ctx.strokeStyle = 'rgba(230,120,120,.5)';
    ctx.setLineDash([10, 8]);
    ctx.lineWidth = 1.5 / displayScale();
    ctx.strokeRect(mX, mY, p.canvas.width - mX * 2, p.canvas.height - mY * 2);
    ctx.setLineDash([]);
  }
  function drawGuides(ctx, guides) {
    ctx.strokeStyle = '#ff5bbd';
    ctx.lineWidth = 1.2 / displayScale();
    ctx.setLineDash([6, 5]);
    ctx.beginPath();
    const p = A().project;
    for (const g of guides) {
      if (g.axis === 'v') { ctx.moveTo(g.pos, 0); ctx.lineTo(g.pos, p.canvas.height); }
      else { ctx.moveTo(0, g.pos); ctx.lineTo(p.canvas.width, g.pos); }
    }
    ctx.stroke();
    ctx.setLineDash([]);
  }

  /* ── selection chrome (handles) ── */
  function handlePositions(l) {
    // layer corners in world coords honoring rotation around center
    const cx = l.x + l.w / 2, cy = l.y + l.h / 2;
    const rot = (l.rot || 0) * Math.PI / 180, cos = Math.cos(rot), sin = Math.sin(rot);
    const map = (ux, uy) => ({ x: cx + ux * cos - uy * sin, y: cy + ux * sin + uy * cos });
    const hw = l.w / 2, hh = l.h / 2;
    return {
      tl: map(-hw, -hh), tr: map(hw, -hh), br: map(hw, hh), bl: map(-hw, hh),
      rot: map(0, -hh - 34 / displayScale()), cx, cy, rotRad: rot,
    };
  }
  function drawSelection(ctx, s) {
    const S = A();
    const sel = S.selectedLayers();
    if (!sel.length) return;
    ctx.save();
    for (const l of sel) {
      const H = handlePositions(l);
      ctx.strokeStyle = 'rgba(91,140,255,.9)';
      ctx.lineWidth = 1.5;
      ctx.setLineDash(l.locked ? [5, 4] : []);
      ctx.beginPath();
      ctx.moveTo(H.tl.x * s, H.tl.y * s); ctx.lineTo(H.tr.x * s, H.tr.y * s);
      ctx.lineTo(H.br.x * s, H.br.y * s); ctx.lineTo(H.bl.x * s, H.bl.y * s);
      ctx.closePath(); ctx.stroke();
      ctx.setLineDash([]);
      if (sel.length === 1 && !l.locked) {
        for (const k of ['tl', 'tr', 'br', 'bl']) {
          ctx.fillStyle = '#fff';
          ctx.strokeStyle = '#5b8cff';
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.arc(H[k].x * s, H[k].y * s, 5, 0, Math.PI * 2);
          ctx.fill(); ctx.stroke();
        }
        // rotate handle
        ctx.beginPath();
        ctx.moveTo(H.cx * s, H.cy * s - (l.h / 2) * s);
        ctx.lineTo(H.rot.x * s, H.rot.y * s);
        ctx.stroke();
        ctx.fillStyle = '#5b8cff';
        ctx.beginPath(); ctx.arc(H.rot.x * s, H.rot.y * s, 6, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#fff';
        ctx.font = '9px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText('↻', H.rot.x * s, H.rot.y * s + 0.5);
      }
    }
    ctx.restore();
  }
  function hitHandle(l, w) {
    const H = handlePositions(l);
    const tol = 9 / displayScale();
    if (Math.hypot(w.x - H.rot.x, w.y - H.rot.y) < tol + 3) return 'rotate';
    for (const k of ['tl', 'tr', 'br', 'bl']) if (Math.hypot(w.x - H[k].x, w.y - H[k].y) < tol) return k;
    return null;
  }
  function worldToLayerLocal(l, w) {
    const cx = l.x + l.w / 2, cy = l.y + l.h / 2;
    const rot = -(l.rot || 0) * Math.PI / 180, cos = Math.cos(rot), sin = Math.sin(rot);
    const dx = w.x - cx, dy = w.y - cy;
    return { x: dx * cos - dy * sin, y: dx * sin + dy * cos };
  }
  function pointInLayer(l, w) {
    const p = worldToLayerLocal(l, w);
    return Math.abs(p.x) <= l.w / 2 + 2 / displayScale() && Math.abs(p.y) <= l.h / 2 + 2 / displayScale();
  }
  function layerAt(w) {
    const s = A().scene();
    for (let i = s.layers.length - 1; i >= 0; i--) {
      const l = s.layers[i];
      if (l.visible === false) continue;
      if (pointInLayer(l, w)) return l;
    }
    return null;
  }

  /* ── pointer interactions ── */
  function onPointerDown(e) {
    const S = A();
    if (!S.project) return;
    if (ST.drawing) { drawingPointer(e, 'down'); return; }
    if (ST.textEdit) commitTextEdit();
    ST.canvas.setPointerCapture(e.pointerId);
    const w = worldFromEvent(e);
    const sel = S.selectedLayers();
    // handle hit for single selection
    if (sel.length === 1 && !sel[0].locked) {
      const h = hitHandle(sel[0], w);
      if (h) {
        ST.drag = { kind: h, layerId: sel[0].id, startW: w, orig: { ...pick(sel[0], ['x', 'y', 'w', 'h', 'rot']) }, moved: false };
        return;
      }
    }
    const hit = layerAt(w);
    if (hit) {
      if (e.shiftKey || e.ctrlKey || e.metaKey) {
        if (S.selection.has(hit.id)) S.selection.delete(hit.id); else S.selection.add(hit.id);
        U.bus.emit('selection');
      } else if (!S.selection.has(hit.id)) {
        S.selection = new Set([hit.id]);
        U.bus.emit('selection');
      }
      if (!hit.locked) {
        ST.drag = { kind: 'move', startW: w, orig: null, layers: new Map(), moved: false };
        for (const l of S.selectedLayers()) ST.drag.layers.set(l.id, { x: l.x, y: l.y });
      }
    } else {
      if (!e.shiftKey) { S.selection.clear(); U.bus.emit('selection'); }
      ST.marquee = { x0: w.x, y0: w.y, x1: w.x, y1: w.y, additive: e.shiftKey };
      ST.drag = { kind: 'marquee', startW: w, moved: false };
    }
  }

  function pick(o, ks) { const r = {}; for (const k of ks) r[k] = o[k]; return r; }

  function onPointerMove(e) {
    const S = A();
    if (!S.project) return;
    if (ST.drawing) { if (e.buttons) drawingPointer(e, 'move'); return; }
    const w = worldFromEvent(e);
    const d = ST.drag;
    if (!d) { hoverCursor(e, w); return; }
    if (d.kind === 'marquee' && ST.marquee) {
      ST.marquee.x1 = w.x; ST.marquee.y1 = w.y;
      scheduleFrame();
      return;
    }
    const l = S.layer(d.layerId);
    if (d.kind === 'move') {
      const dx = w.x - d.startW.x, dy = w.y - d.startW.y;
      if (!d.moved && Math.hypot(dx, dy) > 2 / displayScale()) { d.moved = true; A().pushHistory('move'); }
      if (!d.moved) return;
      const guidesOn = U.$('#optGuides')?.checked;
      let snapDX = 0, snapDY = 0;
      d.guides = null;
      for (const [id, orig] of d.layers) {
        const ll = S.layer(id); if (!ll || ll.locked) continue;
        let nx = orig.x + dx, ny = orig.y + dy;
        if (guidesOn && d.layers.size === 1) {
          const snap = computeSnap(ll, nx, ny);
          nx = snap.x; ny = snap.y; d.guides = snap.guides;
        }
        ll.x = Math.round(nx); ll.y = Math.round(ny);
      }
      A().touch({ transient: true });
      scheduleFrame();
    } else if (d.kind === 'rotate' && l) {
      if (!d.moved) { d.moved = true; A().pushHistory('rotate'); }
      const cx = l.x + l.w / 2, cy = l.y + l.h / 2;
      const a0 = Math.atan2(d.startW.y - cy, d.startW.x - cx);
      const a1 = Math.atan2(w.y - cy, w.x - cx);
      let deg = d.orig.rot + (a1 - a0) * 180 / Math.PI;
      if (e.shiftKey) deg = Math.round(deg / 15) * 15;
      l.rot = Math.round(((deg + 180) % 360 + 360) % 360 - 180);
      A().touch({ transient: true });
      scheduleFrame();
    } else if (l && ['tl', 'tr', 'br', 'bl'].includes(d.kind)) {
      if (!d.moved) { d.moved = true; A().pushHistory('resize'); }
      const local = worldToLayerLocal(l, w);
      const ax = Math.abs(local.x) * 2, ay = Math.abs(local.y) * 2;
      let nw = Math.max(8, d.kind.includes('t') || d.kind.includes('b') ? ax : d.orig.w);
      let nh = Math.max(8, d.kind.includes('l') || d.kind.includes('r') ? ay : d.orig.h);
      if (['tl', 'tr', 'br', 'bl'].includes(d.kind)) { nw = Math.max(8, ax); nh = Math.max(8, ay); }
      if (e.shiftKey) { const ratio = d.orig.w / d.orig.h; if (nw / nh > ratio) nw = nh * ratio; else nh = nw / ratio; }
      // anchor opposite corner: scale around center is simpler & predictable
      l.w = Math.round(nw); l.h = Math.round(nh);
      SD.engine.invalidateLayer(l);
      A().touch({ transient: true });
      scheduleFrame();
    }
  }

  function computeSnap(l, nx, ny) {
    const p = A().project;
    const tol = 7 / displayScale();
    const guides = [];
    const cx = nx + l.w / 2, cy = ny + l.h / 2;
    // canvas center + thirds
    const vLines = [p.canvas.width / 2, p.canvas.width / 3, p.canvas.width * 2 / 3, 0, p.canvas.width];
    const hLines = [p.canvas.height / 2, p.canvas.height / 3, p.canvas.height * 2 / 3, 0, p.canvas.height];
    // other layers
    for (const o of A().scene().layers) {
      if (o.id === l.id) continue;
      vLines.push(o.x, o.x + o.w, o.x + o.w / 2);
      hLines.push(o.y, o.y + o.h, o.y + o.h / 2);
    }
    let bx = null, by = null;
    const cands = [[cx, l.w / 2], [nx, 0], [nx + l.w, l.w]];
    for (const v of vLines) for (const [pos] of [[cx, 0], [nx, 0], [nx + l.w, 0]]) { }
    // center snap
    for (const v of vLines) { if (Math.abs(cx - v) < tol) { bx = v - cx; guides.push({ axis: 'v', pos: v }); break; } }
    if (bx === null) for (const v of vLines) { if (Math.abs(nx - v) < tol) { bx = v - nx; guides.push({ axis: 'v', pos: v }); break; } }
    for (const v of hLines) { if (Math.abs(cy - v) < tol) { by = v - cy; guides.push({ axis: 'h', pos: v }); break; } }
    if (by === null) for (const v of hLines) { if (Math.abs(ny - v) < tol) { by = v - ny; guides.push({ axis: 'h', pos: v }); break; } }
    return { x: nx + (bx || 0), y: ny + (by || 0), guides };
  }

  function hoverCursor(e, w) {
    const S = A();
    const sel = S.selectedLayers();
    let cursor = '';
    if (sel.length === 1 && !sel[0].locked) {
      const h = hitHandle(sel[0], w);
      if (h === 'rotate') cursor = 'grab';
      else if (h === 'tl' || h === 'br') cursor = 'nwse-resize';
      else if (h === 'tr' || h === 'bl') cursor = 'nesw-resize';
    }
    if (!cursor && layerAt(w)) cursor = 'move';
    ST.canvas.style.cursor = cursor || 'default';
  }

  function onPointerUp(e) {
    const d = ST.drag;
    if (ST.drawing) { drawingPointer(e, 'up'); return; }
    if (!d) return;
    if (d.kind === 'marquee' && ST.marquee) {
      const m = ST.marquee;
      const x0 = Math.min(m.x0, m.x1), x1 = Math.max(m.x0, m.x1);
      const y0 = Math.min(m.y0, m.y1), y1 = Math.max(m.y0, m.y1);
      if (x1 - x0 > 4 || y1 - y0 > 4) {
        const S = A();
        if (!m.additive) S.selection.clear();
        for (const l of S.scene().layers) {
          if (l.visible === false) continue;
          if (l.x < x1 && l.x + l.w > x0 && l.y < y1 && l.y + l.h > y0) S.selection.add(l.id);
        }
        U.bus.emit('selection');
      }
      ST.marquee = null;
    }
    if (d.moved) { A().saveNow(); U.bus.emit('change', {}); }
    ST.drag = null;
    scheduleFrame();
  }

  /* ── inline text editing ── */
  function bindTextOverlay() {
    const ta = U.$('#textEditOverlay');
    ta.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Escape') commitTextEdit();
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); commitTextEdit(); }
    });
    ta.addEventListener('blur', commitTextEdit);
  }
  function onDblClick(e) {
    const S = A();
    if (!S.project || ST.drawing) return;
    const w = worldFromEvent(e);
    const l = layerAt(w);
    if (l && l.type === 'text') startTextEdit(l);
  }
  function startTextEdit(l) {
    const ta = U.$('#textEditOverlay');
    ST.textEdit = { layerId: l.id };
    const s = displayScale();
    ta.hidden = false;
    ta.style.left = l.x * s + 'px';
    ta.style.top = l.y * s + 'px';
    ta.style.width = Math.max(80, l.w * s) + 'px';
    ta.style.font = `${l.text.italic ? 'italic ' : ''}${l.text.bold ? '700' : '400'} ${l.text.size * s}px "${l.text.font}"`;
    ta.style.color = l.text.color;
    ta.value = l.text.content;
    ta.style.height = 'auto';
    setTimeout(() => { ta.focus(); ta.select(); ta.style.height = Math.max(40, ta.scrollHeight) + 'px'; }, 0);
  }
  function commitTextEdit() {
    if (!ST.textEdit) return;
    const ta = U.$('#textEditOverlay');
    const l = A().layer(ST.textEdit.layerId);
    const val = ta.value;
    ta.hidden = true;
    ST.textEdit = null;
    if (l && val !== l.text.content) {
      A().mutate('edit text', () => {
        l.text.content = val;
        autoSizeTextLayer(l);
        SD.engine.invalidateLayer(l);
      }, { structure: true });
    }
  }
  function autoSizeTextLayer(l) {
    const L = SD.engine.textLayout(l);
    l.w = Math.max(20, Math.round(L.w));
    l.h = Math.max(16, Math.round(L.h));
  }
  ST.autoSizeTextLayer = autoSizeTextLayer;

  /* ── drawing mode ── */
  function startDrawing() {
    const S = A();
    S.selection.clear(); U.bus.emit('selection');
    ST.drawing = {
      tool: 'pen', strokes: [], current: null,
      color: U.$('#drawColor').value, width: +U.$('#drawWidth').value,
    };
    U.$('#drawToolbar').hidden = false;
    ST.canvas.style.cursor = 'crosshair';
    scheduleFrame();
  }
  function setDrawTool(tool) {
    if (!ST.drawing) return;
    ST.drawing.tool = tool;
    U.$$('.dtool[data-dtool]').forEach((b) => b.classList.toggle('active', b.dataset.dtool === tool));
  }
  function drawingPointer(e, phase) {
    const dr = ST.drawing;
    if (!dr) return;
    dr.color = U.$('#drawColor').value;
    dr.width = +U.$('#drawWidth').value;
    const w = worldFromEvent(e);
    if (phase === 'down') {
      if (dr.tool === 'eraserStroke') { eraseStrokeAt(w); return; }
      dr.current = { tool: dr.tool, color: drawColor(), width: drawWidth(), alpha: drawAlpha(), pts: [w.x, w.y], t: performance.now() };
      dr.strokes.push(dr.current);
    } else if (phase === 'move' && dr.current) {
      if (SD.tools.appendPoint(dr.current.pts, w.x, w.y, 2.2 / displayScale() > 2 ? 2.2 / displayScale() : 2)) scheduleFrame();
    } else if (phase === 'up') {
      if (dr.current) {
        dr.current.pts = SD.tools.simplifyStroke(dr.current.pts, 1.1);
        dr.current = null;
        scheduleFrame();
      }
    }
  }
  function drawColor() { const t = ST.drawing.tool; return ST.drawing.color; }
  function drawWidth() { const t = ST.drawing.tool; return t === 'highlighter' ? ST.drawing.width * 3.2 : t === 'marker' ? ST.drawing.width * 1.7 : ST.drawing.width; }
  function drawAlpha() { return ST.drawing.tool === 'highlighter' ? 0.45 : 1; }
  function eraseStrokeAt(w) {
    const dr = ST.drawing;
    const tol = 14 / displayScale();
    for (let i = dr.strokes.length - 1; i >= 0; i--) {
      const s = dr.strokes[i];
      for (let j = 0; j < s.pts.length; j += 2) {
        if (Math.hypot(s.pts[j] - w.x, s.pts[j + 1] - w.y) < tol + s.width / 2) { dr.strokes.splice(i, 1); break; }
      }
    }
    scheduleFrame();
  }
  function drawSessionPreview(ctx, dr) {
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    for (const s of dr.strokes) {
      ctx.strokeStyle = s.color;
      ctx.globalAlpha = s.alpha;
      ctx.lineWidth = s.width;
      ctx.beginPath();
      ctx.moveTo(s.pts[0], s.pts[1]);
      for (let i = 2; i < s.pts.length; i += 2) ctx.lineTo(s.pts[i], s.pts[i + 1]);
      if (s.pts.length === 2) ctx.lineTo(s.pts[0] + 0.1, s.pts[1]);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }
  function finishDrawing(commit = true) {
    const dr = ST.drawing;
    if (!dr) return;
    ST.drawing = null;
    U.$('#drawToolbar').hidden = true;
    ST.canvas.style.cursor = '';
    if (!commit || !dr.strokes.length) { scheduleFrame(); return; }
    // compute bbox → create layer
    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    for (const s of dr.strokes) for (let i = 0; i < s.pts.length; i += 2) {
      x0 = Math.min(x0, s.pts[i]); y0 = Math.min(y0, s.pts[i + 1]);
      x1 = Math.max(x1, s.pts[i]); y1 = Math.max(y1, s.pts[i + 1]);
    }
    const pad = 26;
    x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad);
    x1 += pad; y1 += pad;
    const l = SD.state.baseLayer('drawing', x0, y0, x1 - x0, y1 - y0, 'Drawing');
    l.drawing = { strokes: dr.strokes.map((s) => ({ color: s.color, width: s.width, alpha: s.alpha, pts: s.pts.map((v, i) => i % 2 ? v - y0 : v - x0) })), };
    l.duration = 3;
    SD.state.addLayer(l);
    SD.state.mutate('auto duration', () => { l.duration = SD.engine.estimateDuration(SD.state.project, l); }, { history: false, structure: true });
    U.toast('Drawing added — it will replay stroke by stroke', 'ok');
    scheduleFrame();
  }

  /* ── playback ── */
  let playState = { playing: false, lastT: 0, raf: null };
  function play(fromTime) {
    const S = A();
    if (fromTime != null) S.editTime = fromTime;
    if (playState.playing) return;
    playState.playing = true; S.playing = true;
    playState.lastT = performance.now();
    U.bus.emit('playstate', true);
    const dur = E().sceneDuration(S.project, S.scene());
    if (S.editTime >= dur - 0.05) S.editTime = 0;
    const tick = (now) => {
      if (!playState.playing) return;
      const dt = (now - playState.lastT) / 1000;
      playState.lastT = now;
      S.editTime += dt;
      const d = E().sceneDuration(S.project, S.scene());
      if (S.editTime >= d) { S.editTime = d; pause(); U.bus.emit('time'); return; }
      E().syncAudio(S.project, S.project.activeSceneIdx, S.editTime, true);
      U.bus.emit('time');
      playState.raf = requestAnimationFrame(tick);
    };
    playState.raf = requestAnimationFrame(tick);
  }
  function pause() {
    playState.playing = false; A().playing = false;
    if (playState.raf) cancelAnimationFrame(playState.raf);
    playState.raf = null;
    try { E().syncAudio(A().project, A().project.activeSceneIdx, A().editTime, false); } catch {}
    U.bus.emit('playstate', false);
    scheduleFrame();
  }
  function stop() { pause(); A().editTime = 0; U.bus.emit('time'); }
  function toggle() { playState.playing ? pause() : play(); }

  SD.stage = {
    init, fit, layout, scheduleFrame, displayScale, worldFromEvent, cssFromWorld,
    play, pause, stop, toggle,
    get isPlaying() { return playState.playing; },
    startDrawing, finishDrawing, setDrawTool,
    get isDrawing() { return !!ST.drawing; },
    get drawingSession() { return ST.drawing; },
    autoSizeTextLayer, pointInLayer, handlePositions,
  };
})();
