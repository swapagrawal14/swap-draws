/* SwapDraws — timeline.js : ruler, playhead scrub, layer bars (move/resize),
   camera keyframe lane (drag/edit/delete), auto-sequence & overlap actions */
(function () {
  const SD = (window.SD = window.SD || {});
  const U = SD.util;
  const A = () => SD.state;
  const E = () => SD.engine;

  let pxPerSec = 40;
  let built = false;
  const TYPE_ICON = { image: '🖼', svg: '✒️', text: 'T', drawing: '✏', shape: '➤', icon: '★', audio: '🔊' };

  function init() {
    U.$('#tlZoom').addEventListener('input', (e) => { pxPerSec = +e.target.value; rebuild(); });
    U.$('#tlZoomIn').addEventListener('click', () => setZoom(pxPerSec * 1.3));
    U.$('#tlZoomOut').addEventListener('click', () => setZoom(pxPerSec / 1.3));
    U.$('#tlAutoSeq').addEventListener('click', autoSequence);
    U.$('#tlOverlap').addEventListener('click', drawTogether);
    U.$('#btnPreviewScene').addEventListener('click', () => SD.stage.play(A().editTime));

    // ruler scrubbing
    const rw = U.$('#tlRulerWrap');
    let scrubbing = false;
    const scrubTo = (e) => {
      const r = rw.getBoundingClientRect();
      const x = U.clamp(e.clientX - r.left - 24, 0, r.width - 24);
      const t = x / pxPerSec;
      const S = A();
      const max = E().sceneDuration(S.project, S.scene());
      S.editTime = U.clamp(t, 0, max - 0.001);
      if (SD.stage.isPlaying) SD.stage.pause();
      U.bus.emit('time');
    };
    rw.addEventListener('pointerdown', (e) => { scrubbing = true; rw.setPointerCapture(e.pointerId); scrubTo(e); });
    rw.addEventListener('pointermove', (e) => { if (scrubbing) scrubTo(e); });
    rw.addEventListener('pointerup', () => { scrubbing = false; });

    U.bus.on('change', () => rebuild());
    U.bus.on('structure', () => rebuild());
    U.bus.on('selection', () => syncSelection());
    U.bus.on('time', () => updatePlayhead());
    U.bus.on('project-loaded', () => rebuild());
  }
  function setZoom(v) { pxPerSec = U.clamp(v, 6, 160); U.$('#tlZoom').value = pxPerSec; rebuild(); }

  /* ── rebuild all lanes ── */
  function rebuild() {
    const S = A();
    if (!S.project) return;
    built = true;
    buildRuler();
    buildCamLane();
    buildTracks();
    updatePlayhead();
  }

  function sceneDur() { const S = A(); return E().sceneDuration(S.project, S.scene()); }

  function buildRuler() {
    const c = U.$('#tlRuler');
    const wrap = U.$('#tlRulerWrap');
    const w = wrap.clientWidth || 800;
    const dpr = window.devicePixelRatio || 1;
    c.width = w * dpr; c.height = 24 * dpr;
    const ctx = c.getContext('2d');
    ctx.scale(dpr, dpr);
    const style = getComputedStyle(document.documentElement);
    ctx.clearRect(0, 0, w, 24);
    ctx.font = '9px "Space Mono", monospace';
    ctx.fillStyle = style.getPropertyValue('--text-faint') || '#77808f';
    ctx.strokeStyle = style.getPropertyValue('--line') || '#333';
    const dur = sceneDur();
    let step = 1;
    if (pxPerSec < 22) step = 5; else if (pxPerSec < 45) step = 2; else step = 1;
    const subStep = step / 5;
    ctx.beginPath();
    for (let t = 0; t <= dur + step; t += subStep) {
      const x = 24 + t * pxPerSec;
      const major = Math.abs(t / step - Math.round(t / step)) < 1e-6;
      ctx.moveTo(x + 0.5, major ? 10 : 17);
      ctx.lineTo(x + 0.5, 24);
      if (major) ctx.fillText(U.fmtTime(t), x + 3, 9);
    }
    ctx.stroke();
    U.$('#tlDuration').textContent = U.fmtTime(dur);
  }

  function buildCamLane() {
    const lane = U.$('#tlCamLane');
    lane.querySelectorAll('.tl-camkf').forEach((n) => n.remove());
    const S = A();
    const scene = S.scene();
    const cam = scene.camera;
    lane.style.display = cam && cam.enabled ? '' : 'none';
    if (!cam || !cam.enabled) return;
    for (const kf of cam.keys) {
      const el = U.el('div', { class: 'tl-camkf', title: `cam key @ ${U.fmtTime(kf.t)} · drag to move · dbl-click edits · right-click deletes` });
      el.style.left = kf.t * pxPerSec + 24 + 'px';
      el.addEventListener('pointerdown', (e) => camDragStart(e, kf, el));
      el.addEventListener('dblclick', (e) => camEdit(e, kf));
      el.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        S.mutate('delete cam key', () => { cam.keys.splice(cam.keys.indexOf(kf), 1); });
      });
      lane.appendChild(el);
    }
    lane.onclick = (e) => {
      if (e.target !== lane) return;
      const r = lane.getBoundingClientRect();
      const t = U.clamp((e.clientX - r.left - 24) / pxPerSec, 0, sceneDur());
      S.mutate('add cam key', () => {
        const cur = E().evalCamera(S.project, scene, t);
        cam.keys.push({ t: +t.toFixed(2), x: +cur.x.toFixed(3), y: +cur.y.toFixed(3), zoom: +cur.zoom.toFixed(2) });
        cam.keys.sort((a, b) => a.t - b.t);
      });
    };
  }
  function camDragStart(e, kf, el) {
    e.preventDefault(); e.stopPropagation();
    const S = A();
    S.pushHistory('move cam key');
    const x0 = e.clientX, t0 = kf.t;
    const move = (ev) => {
      kf.t = U.clamp(+(t0 + (ev.clientX - x0) / pxPerSec).toFixed(2), 0, sceneDur());
      el.style.left = kf.t * pxPerSec + 24 + 'px';
      A().touch({ transient: true });
    };
    const up = () => {
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up);
      S.mutate('sort cam keys', () => { S.scene().camera.keys.sort((a, b) => a.t - b.t); }, { history: false });
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }
  function camEdit(e, kf) {
    e.preventDefault(); e.stopPropagation();
    const S = A();
    const cur = { ...kf };
    const t = prompt('Key time (seconds):', kf.t);
    if (t === null) return;
    const zoom = prompt('Zoom (0.5 – 4):', kf.zoom);
    if (zoom === null) return;
    S.mutate('edit cam key', () => {
      kf.t = U.clamp(parseFloat(t) || cur.t, 0, sceneDur());
      kf.zoom = U.clamp(parseFloat(zoom) || cur.zoom, 0.5, 4);
      S.scene().camera.keys.sort((a, b) => a.t - b.t);
    });
  }

  function buildTracks() {
    const S = A();
    const wrap = U.$('#tlTracks');
    wrap.innerHTML = '';
    const scene = S.scene();
    scene.layers.forEach((l, idx) => {
      const row = U.el('div', { class: 'tl-lane' });
      const label = U.el('span', { class: 'lane-label' }, `${TYPE_ICON[l.type] || '▣'} ${l.name}`);
      row.appendChild(label);
      const bar = U.el('div', { class: 'tl-bar' + (S.selection.has(l.id) ? ' selected' : ''), 'data-id': l.id });
      bar.style.left = l.start * pxPerSec + 24 + 'px';
      bar.style.width = Math.max(14, l.duration * pxPerSec) + 'px';
      bar.append(U.el('span', { class: 'grip l' }), U.el('span', { class: 'bar-ic' }, TYPE_ICON[l.type] || '▣'), document.createTextNode(l.name), U.el('span', { class: 'grip r' }));
      row.appendChild(bar);
      bar.addEventListener('pointerdown', (e) => barDragStart(e, l, bar));
      bar.addEventListener('contextmenu', (e) => { e.preventDefault(); barMenu(e, l); });
      wrap.appendChild(row);
    });
  }

  function barDragStart(e, layer, bar) {
    e.preventDefault();
    const S = A();
    // selection logic
    if (e.shiftKey || e.ctrlKey || e.metaKey) {
      S.selection.has(layer.id) ? S.selection.delete(layer.id) : S.selection.add(layer.id);
      U.bus.emit('selection');
      return;
    }
    if (!S.selection.has(layer.id)) { S.selection = new Set([layer.id]); U.bus.emit('selection'); }
    const gripL = e.target.classList.contains('l'), gripR = e.target.classList.contains('r');
    const mode = gripL ? 'resize-l' : gripR ? 'resize-r' : 'move';
    S.pushHistory('timeline edit');
    const x0 = e.clientX;
    const orig = S.selectedLayers().map((l) => ({ l, start: l.start, dur: l.duration }));
    const dur0 = layer.duration, start0 = layer.start;
    bar.classList.add('dragging');
    const others = sceneEdgesExcluding(new Set(orig.map((o) => o.l.id)));
    let snapping = true;

    const move = (ev) => {
      const dt = (ev.clientX - x0) / pxPerSec;
      for (const o of orig) {
        if (mode === 'move') { o.l.start = U.clamp(snap(o.start + dt, others, dt), 0, 999); }
        else if (o.l === layer && mode === 'resize-r') o.l.duration = U.clamp(snap(dur0 + dt, others), 0.15, 600);
        else if (o.l === layer && mode === 'resize-l') {
          const ns = U.clamp(snap(start0 + dt, others), 0, start0 + dur0 - 0.15);
          o.l.start = ns; o.l.duration = U.clamp(start0 + dur0 - ns, 0.15, 600);
        }
      }
      A().touch({ transient: true });
      updateBars();
      updatePlayhead();
    };
    const up = () => {
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up);
      bar.classList.remove('dragging');
      A().touch({ structure: true });
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  function snap(t, edges, dt) {
    if (Math.abs(t) < 0.08) return 0;
    for (const e of edges) if (Math.abs(t - e) < 0.12) return e;
    if (Math.abs(t - sceneDur()) < 0.12) return sceneDur();
    return Math.round(t * 10) / 10;
  }
  function sceneEdgesExcluding(ids) {
    const edges = [0];
    for (const l of A().scene().layers) if (!ids.has(l.id)) edges.push(l.start, l.start + l.duration);
    return edges;
  }

  function updateBars() {
    const S = A();
    U.$$('.tl-bar', U.$('#tlTracks')).forEach((bar) => {
      const l = S.layer(bar.dataset.id);
      if (!l) return;
      bar.style.left = l.start * pxPerSec + 24 + 'px';
      bar.style.width = Math.max(14, l.duration * pxPerSec) + 'px';
    });
    buildRuler();
  }

  function barMenu(e, layer) {
    const S = A();
    const choice = prompt(`Layer "${layer.name}" — start=${layer.start.toFixed(1)}s dur=${layer.duration.toFixed(1)}s\nType: 'auto' = auto-duration, 'del' = delete, or new start time:`);
    if (choice === null) return;
    if (choice === 'del') { S.removeLayers(new Set([layer.id])); return; }
    if (choice === 'auto') { S.mutate('auto duration', () => { layer.duration = E().estimateDuration(S.project, layer); }, { structure: true }); return; }
    const t = parseFloat(choice);
    if (!isNaN(t)) S.mutate('set start', () => { layer.start = U.clamp(t, 0, 999); }, { structure: true });
  }

  function syncSelection() {
    const S = A();
    U.$$('.tl-bar', U.$('#tlTracks')).forEach((bar) => bar.classList.toggle('selected', S.selection.has(bar.dataset.id)));
    updatePlayhead();
  }

  function updatePlayhead() {
    const S = A();
    if (!S.project || !built) return;
    const ph = U.$('#tlPlayhead');
    ph.style.left = S.editTime * pxPerSec + 24 + 'px';
    const dur = sceneDur();
    const disp = U.$('#timeDisplay');
    const { idx } = { idx: S.project.activeSceneIdx };
    disp.textContent = `${U.fmtTime(S.editTime)} / ${U.fmtTime(dur)}`;
    buildRulerQuickTicks();
  }
  let lastRulerW = 0;
  function buildRulerQuickTicks() { /* ruler redrawn on rebuild only */ }

  /* ── actions ── */
  function autoSequence() {
    const S = A();
    S.mutate('auto sequence', () => {
      let t = 0;
      for (const l of S.scene().layers) { l.start = t; t += l.duration + 0.25; }
    }, { structure: true });
    U.toast('Layers sequenced back-to-back', 'ok');
  }
  function drawTogether() {
    const S = A();
    const sel = S.selectedLayers();
    if (!sel.length) { U.toast('Select layers first', 'bad'); return; }
    S.mutate('draw together', () => {
      const t0 = Math.min(...sel.map((l) => l.start));
      for (const l of sel) l.start = t0;
    }, { structure: true });
    U.toast(sel.length + ' layers will draw together', 'ok');
  }

  SD.timeline = { init, rebuild, setZoom, updatePlayhead };
})();
