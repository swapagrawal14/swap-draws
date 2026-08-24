/* SwapDraws — panels.js : left & right panel UI — scenes, design presets,
   camera controls, content upload/libraries, animation controls, layers inspector */
(function () {
  const SD = (window.SD = window.SD || {});
  const U = SD.util;
  const A = () => SD.state;
  const E = () => SD.engine;

  /* ── animation styles catalog ── */
  const ANIM_STYLES = [
    ['draw', 'Outline draw', 'M3 16 C6 8 10 6 13 10 C15 12.5 12 15 9 13 M16 8 L21 3 M16 8 L18 10 L21 3'],
    ['drawfill', 'Draw + color', 'M3 14 C6 8 10 7 13 10 M15 12 h6 M18 9 v6'],
    ['chalk', 'Chalk', 'M3 12 C7 6 12 18 17 10 M6 15.5 h1 M12 5.5 h1'],
    ['sketch', 'Sketch', 'M3 15 L9 6 L13 14 L17 5 L21 15 M5 17 H19'],
    ['handwrite', 'Handwrite', 'M4 14 c1-6 4-8 5-4 s-2 6-3 4 1-5 4-5 3 7 6 4 c1-1 2-3 4-3'],
    ['typewriter', 'Typewriter', 'M5 5 V16 M5 10.5 H9 M13 5 V16 M13 5 H17 M13 16 H17'],
    ['scan', 'Scanner', 'M4 4 H20 V18 H4 Z M12 4 V18 M12 4 L14 4'],
    ['chunks', 'Chunks', 'M4 4 H10 V10 H4 Z M14 4 H20 V10 H14 Z M9 13 H15 V19 H9 Z'],
    ['spiral', 'Spiral', 'M12 12 c1-1 3 1 2 3 s-5 2-6-1 1-7 5-7 8 5 6 9'],
    ['radial', 'Radial', 'M12 12 m-8 0 a8 8 0 1 0 0.01 0 M12 12 m-4.5 0 a4.5 4.5 0 1 0 0.01 0 M12 12 h.01'],
    ['wipe', 'Wipe', 'M4 4 H20 V18 H4 Z M12 4 L4 18 M18 4 L10 18'],
    ['fade', 'Fade', 'M4 6 H10 V12 H4 Z M14 6 H20 V12 H14 Z M9 12 H15 V18 H9 Z'],
    ['pop', 'Pop', 'M12 4 L14 9 L19 10 L15 13 L16 18 L12 15 L8 18 L9 13 L5 10 L10 9 Z'],
    ['slide', 'Slide in', 'M3 12 H15 M9 6 L15 12 L9 18 M17 4 H21 V20 H17'],
    ['rise', 'Rise', 'M12 20 V8 M7 13 L12 8 L17 13 M5 20 H19'],
    ['none', 'Instant', 'M7 5 L12 12 L7 19 M12 5 L17 12 L12 19'],
  ];

  const STYLE_PRESETS = [
    { id: 'white', name: 'Whiteboard', bg: 'white', ink: '#222831', hand: 'hand1', style: 'draw', sw: ['#fdfcf9', '#222831'] },
    { id: 'chalk', name: 'Chalkboard', bg: 'chalk', ink: '#f4f2e8', hand: 'hand3', style: 'chalk', jitter: 30, sw: ['#1e2622', '#f4f2e8'] },
    { id: 'blueprint', name: 'Blueprint', bg: 'blueprint', ink: '#eaf4ff', hand: 'hand2', style: 'draw', sw: ['#123f63', '#eaf4ff'] },
    { id: 'kraft', name: 'Kraft paper', bg: 'kraft', ink: '#4a3721', hand: 'hand1', style: 'draw', sw: ['#c8a87b', '#4a3721'] },
    { id: 'neon', name: 'Neon night', bg: 'neon', ink: '#41f2e8', hand: 'hand4', style: 'draw', sw: ['#0a0c16', '#41f2e8'] },
    { id: 'notebook', name: 'Notebook', bg: 'grid', ink: '#2b2b40', hand: 'hand1', style: 'handwrite', sw: ['#fdfcf9', '#2b2b40'] },
  ];

  /* thumbnails debounce */
  const refreshThumbsSoon = U.debounce(refreshLayerThumbs, 250);
  const refreshSceneThumbsSoon = U.debounce(refreshSceneThumbs, 350);

  function init() {
    bindTabs();
    bindScenesTab();
    bindDesignTab();
    bindCameraTab();
    bindContentTab();
    bindAnimateTab();
    bindLayersTab();
    bindGlobalDropPaste();

    U.bus.on('structure', () => { rebuildSceneList(); rebuildLayerList(); SD.timeline.rebuild(); });
    U.bus.on('selection', () => { syncAnimPanel(); syncTransformBox(); syncLayerListSelection(); });
    U.bus.on('change', (opts) => {
      if (opts && opts.transient) { syncTransformValues(); return; }
      rebuildSceneList(); rebuildLayerList();
      if (!opts || !opts.transient) { syncAnimPanel(); syncTransformBox(); syncDesignTab(); syncCameraTab(); }
    });
    U.bus.on('project-loaded', () => { syncAll(); });
  }
  function syncAll() {
    rebuildSceneList(); rebuildLayerList();
    syncAnimPanel(); syncTransformBox(); syncDesignTab(); syncCameraTab();
    SD.timeline.rebuild(); SD.stage.layout(); SD.stage.scheduleFrame();
  }

  /* ═══════ tabs ═══════ */
  function bindTabs() {
    U.$$('.ptab').forEach((btn) => btn.addEventListener('click', () => {
      const panel = btn.closest('.side-panel');
      U.$$('.ptab', panel).forEach((b) => b.classList.toggle('active', b === btn));
      U.$$('.ppane', panel).forEach((p) => p.classList.toggle('active', p.dataset.ppane === btn.dataset.ptab));
    }));
  }
  function openRightTab(name) {
    const panel = U.$('#rightPanel');
    U.$$('.ptab', panel).forEach((b) => b.classList.toggle('active', b.dataset.ptab === name));
    U.$$('.ppane', panel).forEach((p) => p.classList.toggle('active', p.dataset.ppane === name));
  }

  /* ═══════ scenes ═══════ */
  function bindScenesTab() {
    U.$('#btnAddScene').addEventListener('click', () => { A().addScene(); });
    U.$('#btnDupScene').addEventListener('click', () => A().duplicateScene(A().project.activeSceneIdx));
    U.$('#btnDelScene').addEventListener('click', () => A().deleteScene(A().project.activeSceneIdx));
    U.$('#btnAddTitleCard').addEventListener('click', () => addCard('title'));
    U.$('#btnAddOutro').addEventListener('click', () => addCard('outro'));
    const scene = () => A().scene();
    U.$('#sceneTransition').addEventListener('change', (e) => A().mutate('transition', () => { scene().transition.type = e.target.value; }));
    U.$('#sceneTransDur').addEventListener('change', (e) => A().mutate('transition', () => { scene().transition.duration = U.clamp(+e.target.value || 0.7, 0.2, 3); }));
    U.$('#sceneHold').addEventListener('change', (e) => A().mutate('hold', () => { scene().holdAfter = U.clamp(+e.target.value || 0.8, 0, 10); }, { structure: true }));
  }

  function sceneThumbCanvas(scene, idx) {
    const p = A().project;
    const scale = 128 / p.canvas.width;
    const c = U.makeCanvas(128, p.canvas.height * scale);
    const ctx = c.getContext('2d');
    ctx.save(); ctx.scale(scale, scale);
    try {
      const dur = E().sceneDuration(p, scene);
      E().renderSceneFrame(p, idx, Math.min(1.6, dur * 0.65), ctx, { showHand: false });
    } catch (e) { /* ignore */ }
    ctx.restore();
    return c;
  }
  function rebuildSceneList() {
    const S = A();
    if (!S.project) return;
    const wrap = U.$('#sceneList');
    wrap.innerHTML = '';
    S.project.scenes.forEach((scene, i) => {
      const card = U.el('div', { class: 'scene-card' + (i === S.project.activeSceneIdx ? ' active' : '') });
      card.append(
        U.el('div', { class: 'scene-num' }, String(i + 1)),
        U.el('canvas', { class: 'scene-thumb', width: 96, height: 54 }),
        U.el('div', { class: 'scene-info' },
          U.el('div', { class: 'scene-name' }, scene.name),
          U.el('div', { class: 'scene-meta' }, `${scene.layers.length} layers · ${U.fmtTime(E().sceneDuration(S.project, scene))}`))
      );
      const th = U.$('canvas.scene-thumb', card);
      const ctx = th.getContext('2d');
      try { ctx.drawImage(sceneThumbCanvas(scene, i), 0, 0, th.width, th.height); } catch (e) {}
      card.addEventListener('click', () => S.setActiveScene(i));
      card.addEventListener('dblclick', () => {
        const name = prompt('Scene name:', scene.name);
        if (name) S.mutate('rename scene', () => { scene.name = name; }, { structure: true });
      });
      wrap.appendChild(card);
    });
    // sync scene settings inputs
    const s = S.scene();
    U.$('#sceneTransition').value = s.transition.type;
    U.$('#sceneTransDur').value = s.transition.duration;
    U.$('#sceneHold').value = s.holdAfter ?? 0.8;
  }
  function refreshSceneThumbs() { rebuildSceneList(); }

  function makeTextLayer(content, opts = {}) {
    const p = A().project;
    const ink = opts.color || E().BG_DEFS[A().scene().background.type]?.ink || '#222831';
    const l = A().baseLayer('text', 0, 0, 40, 20, opts.name || 'Text');
    l.text = { content, font: opts.font || 'Caveat', size: opts.size || Math.round(p.canvas.height * (opts.sizeFrac || 0.16)), bold: opts.bold !== false, italic: false, color: ink, align: 'center', lineH: 1.25, spacing: 0, underline: opts.underline || 'none' };
    SD.stage.autoSizeTextLayer(l);
    l.x = Math.round(p.canvas.width / 2 - l.w / 2 + (opts.dx || 0));
    l.y = Math.round(p.canvas.height * (opts.yFrac ?? 0.5) - l.h / 2 + (opts.dy || 0));
    l.anim.style = opts.style || 'handwrite';
    l.anim.strokeColor = ink;
    l.duration = U.clamp(l.text.content.length / 8, 1, 4);
    return l;
  }
  function addCard(kind) {
    const S = A();
    const s = S.addScene();
    S.mutate(kind + ' card', () => {
      if (kind === 'title') {
        s.name = 'Title';
        const t = makeTextLayer('Your Title Here', { name: 'Title', yFrac: 0.46, underline: 'none' });
        const sub = makeTextLayer('a short subtitle that explains it', { name: 'Subtitle', sizeFrac: 0.07, yFrac: 0.68, font: 'Patrick Hand', bold: false });
        s.layers.push(t, sub);
        t.start = 0.2; sub.start = 0.2 + t.duration + 0.3;
      } else {
        s.name = 'Outro';
        const t = makeTextLayer('Thanks for watching!', { name: 'Thanks', yFrac: 0.5, underline: 'squiggle' });
        s.layers.push(t); t.start = 0.2;
        s.transition.type = 'zoom';
      }
      S.project.activeSceneIdx = S.project.scenes.length - 1;
    }, { structure: true });
    U.toast(kind === 'title' ? 'Title card added — double-click the text to edit' : 'Outro card added', 'ok');
  }

  /* ═══════ design ═══════ */
  function bindDesignTab() {
    U.$$('#aspectChips .chip').forEach((chip) => chip.addEventListener('click', () => {
      const asp = chip.dataset.asp;
      const S = A();
      if (asp === 'custom') { U.$('#customCanvasRow').style.display = ''; return A().touch({}); }
      S.mutate('canvas aspect', () => { S.setCanvasAspect(S.project, asp, S.project.canvas.res); SD.engine.invalidateScene(S.scene()); }, { structure: true });
    }));
    U.$('#canvasRes').addEventListener('change', (e) => {
      const S = A();
      S.mutate('canvas res', () => { S.setCanvasRes(S.project, +e.target.value); SD.engine.invalidateScene(S.scene()); }, { structure: true });
    });
    const applyCustom = () => {
      const S = A();
      const w = U.clamp(+U.$('#canvasW').value || 1920, 320, 4096);
      const h = U.clamp(+U.$('#canvasH').value || 1080, 320, 4096);
      S.mutate('canvas custom', () => { S.project.canvas.aspect = 'custom'; S.project.canvas.width = w; S.project.canvas.height = h; SD.engine.invalidateScene(S.scene()); }, { structure: true });
    };
    U.$('#canvasW').addEventListener('change', applyCustom);
    U.$('#canvasH').addEventListener('change', applyCustom);

    // style presets
    const grid = U.$('#stylePresets');
    for (const pr of STYLE_PRESETS) {
      const card = U.el('button', { class: 'preset-card', title: `Apply ${pr.name} look to this scene (bg, ink, hand, style)` });
      card.append(
        U.el('div', { class: 'preset-swatch', style: `background:${pr.sw[0]}` }),
        U.el('div', { class: 'preset-name', style: `background:${pr.sw[1]};color:${pr.sw[0]}` }, pr.name));
      card.addEventListener('click', () => applyStylePreset(pr));
      grid.appendChild(card);
    }
    // bg presets
    const bgrid = U.$('#bgPresets');
    for (const [type, def] of Object.entries(E().BG_DEFS)) {
      const sw = U.el('button', { class: 'bg-swatch', 'data-bg': type, title: def.name });
      sw.style.background = def.color;
      if (def.grid) sw.style.backgroundImage = 'repeating-linear-gradient(0deg, rgba(80,120,200,.3) 0 1px, transparent 1px 8px), repeating-linear-gradient(90deg, rgba(80,120,200,.3) 0 1px, transparent 1px 8px)';
      if (type === 'blueprint') sw.style.backgroundImage = 'repeating-linear-gradient(0deg, rgba(255,255,255,.25) 0 1px, transparent 1px 8px), repeating-linear-gradient(90deg, rgba(255,255,255,.25) 0 1px, transparent 1px 8px)';
      if (type === 'ruled') sw.style.backgroundImage = 'repeating-linear-gradient(0deg, rgba(80,120,200,.35) 0 1px, transparent 1px 7px)';
      sw.appendChild(U.el('span', {}, def.name));
      sw.addEventListener('click', () => {
        const S = A();
        S.mutate('background', () => { S.scene().background.type = type; SD.engine.invalidateScene(S.scene()); });
        syncDesignTab();
      });
      bgrid.appendChild(sw);
    }
    U.$('#bgColor').addEventListener('input', (e) => {
      const S = A();
      S.mutate('bg color', () => { S.scene().background.color = e.target.value; S.scene().background.type = 'color'; SD.engine.invalidateScene(S.scene()); }, { history: false });
      U.$('#bgColorHex').value = e.target.value;
    });
    U.$('#bgColorHex').addEventListener('change', (e) => {
      const v = e.target.value.trim();
      if (!/^#[0-9a-f]{6}$/i.test(v)) return;
      const S = A();
      S.mutate('bg color', () => { S.scene().background.color = v; S.scene().background.type = 'color'; SD.engine.invalidateScene(S.scene()); });
    });
    ['optGuides', 'optGrid', 'optSafe'].forEach((id) => U.$('#' + id).addEventListener('change', () => SD.stage.scheduleFrame()));
  }

  function applyStylePreset(pr) {
    const S = A();
    S.mutate('style preset', () => {
      const s = S.scene();
      s.background.type = pr.bg;
      s.defaultHand = pr.hand;
      for (const l of s.layers) {
        l.anim.strokeColor = pr.ink;
        l.anim.jitter = pr.jitter || 0;
        if (['image', 'svg', 'text'].includes(l.type)) l.anim.style = pr.style === 'handwrite' && l.type !== 'text' ? 'draw' : pr.style;
        if (l.type === 'text') { l.text.color = pr.ink; SD.engine.invalidateLayer(l); }
        if (l.type === 'icon') { l.icon.color = pr.ink; SD.engine.invalidateLayer(l); }
      }
      SD.engine.invalidateScene(s);
    }, { structure: true });
    U.toast(`“${pr.name}” style applied to the scene`, 'ok');
  }

  function syncDesignTab() {
    const S = A();
    if (!S.project) return;
    const c = S.project.canvas;
    U.$$('#aspectChips .chip').forEach((ch) => ch.classList.toggle('active', ch.dataset.asp === c.aspect));
    U.$('#customCanvasRow').style.display = c.aspect === 'custom' ? '' : 'none';
    U.$('#canvasW').value = c.width; U.$('#canvasH').value = c.height;
    U.$('#canvasRes').value = c.res;
    U.$$('#bgPresets .bg-swatch').forEach((b) => b.classList.toggle('active', b.dataset.bg === S.scene().background.type));
    U.$('#bgColorRow').style.display = S.scene().background.type === 'color' ? '' : 'none';
    U.$('#bgColor').value = S.scene().background.color || '#f7f3ea';
    U.$('#bgColorHex').value = S.scene().background.color || '#f7f3ea';
  }

  /* ═══════ camera ═══════ */
  function bindCameraTab() {
    U.$('#camEnable').addEventListener('change', (e) => {
      const S = A();
      S.mutate('camera toggle', () => {
        S.scene().camera.enabled = e.target.checked;
        if (e.target.checked && S.scene().camera.keys.length === 0) {
          S.scene().camera.keys.push({ t: 0, x: 0.5, y: 0.5, zoom: 1 });
        }
      }, { structure: true });
    });
    U.$('#camAddKf').addEventListener('click', () => {
      const S = A();
      const scene = S.scene();
      if (!scene.camera.enabled) { U.toast('Enable camera moves first', 'bad'); return; }
      S.mutate('add cam key', () => {
        const t = +S.editTime.toFixed(2);
        const cur = E().evalCamera(S.project, scene, S.editTime);
        scene.camera.keys = scene.camera.keys.filter((k) => Math.abs(k.t - t) > 0.06);
        scene.camera.keys.push({ t, x: +cur.x.toFixed(3), y: +cur.y.toFixed(3), zoom: 2 });
        scene.camera.keys.sort((a, b) => a.t - b.t);
      }, { structure: true });
      U.toast('Camera key added at playhead (2× zoom)', 'ok');
    });
    U.$('#camAuto').addEventListener('click', () => {
      const S = A();
      S.mutate('auto camera', () => {
        S.scene().camera.enabled = true;
        S.scene().camera.keys = E().autoCamera(S.project, S.scene());
      }, { structure: true });
      U.toast('Camera auto-focus generated ✨', 'ok');
    });
    U.$('#camFitBtn').addEventListener('click', () => {
      const S = A();
      const scene = S.scene();
      if (!scene.camera.enabled) { U.toast('Enable camera moves first', 'bad'); return; }
      S.mutate('end wide key', () => {
        const end = E().sceneDuration(S.project, scene) - (scene.holdAfter || 0.8) * 0.5;
        scene.camera.keys.push({ t: +Math.max(0.2, end - 0.8).toFixed(2), x: 0.5, y: 0.5, zoom: 1 });
        scene.camera.keys.sort((a, b) => a.t - b.t);
      }, { structure: true });
    });
    U.$('#camClear').addEventListener('click', () => {
      const S = A();
      S.mutate('clear cam', () => { S.scene().camera.keys = []; }, { structure: true });
    });
    U.bus.on('structure', syncCameraTab);
  }
  function syncCameraTab() {
    const S = A();
    if (!S.project) return;
    const cam = S.scene().camera;
    U.$('#camEnable').checked = !!cam.enabled;
    const list = U.$('#camKfList');
    list.innerHTML = '';
    if (!cam.enabled || !cam.keys.length) { list.innerHTML = '<div class="empty-mini">No keys yet — camera stays wide.</div>'; return; }
    for (const kf of cam.keys.slice().sort((a, b) => a.t - b.t)) {
      const row = U.el('div', { class: 'kf-row' });
      row.append(
        U.el('span', { class: 'dia' }, '◆'),
        U.el('span', { class: 'vals' }, `@${kf.t.toFixed(2)}s · x${(kf.x * 100).toFixed(0)}/y${(kf.y * 100).toFixed(0)} · ${kf.zoom.toFixed(2)}×`),
        U.el('button', { class: 'del', title: 'Delete key' }, '×'));
      U.$('.del', row).addEventListener('click', () => {
        S.mutate('delete cam key', () => { cam.keys.splice(cam.keys.indexOf(kf), 1); }, { structure: true });
      });
      list.appendChild(row);
    }
  }

  /* ═══════ content uploads & libraries ═══════ */
  function bindContentTab() {
    const dz = U.$('#dropZone');
    dz.addEventListener('click', () => U.$('#fileInput').click());
    dz.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') U.$('#fileInput').click(); });
    U.$('#fileInput').addEventListener('change', (e) => { handleFiles(e.target.files); e.target.value = ''; });

    U.$('#btnAddText').addEventListener('click', addTextLayer);
    U.$('#btnAddDraw').addEventListener('click', () => { SD.stage.startDrawing(); });
    U.$('#btnAddShape').addEventListener('click', () => toggleLib('shapePanel', buildShapeGrid));
    U.$('#btnAddIcon').addEventListener('click', () => toggleLib('iconPanel', buildIconGrid));
    U.$$('[data-close]').forEach((b) => b.addEventListener('click', () => { const p = U.$('#' + b.dataset.close); if (p) p.hidden = true; }));
    U.$('#iconSearch').addEventListener('input', U.debounce(buildIconGrid, 150));
  }
  function toggleLib(id, builder) {
    const p = U.$('#' + id);
    p.hidden = !p.hidden;
    if (!p.hidden) builder();
  }

  async function handleFiles(files, dropPos) {
    const S = A();
    for (const file of files) {
      try {
        if (file.type === 'application/json' || /\.(json|swapdraws)$/i.test(file.name)) await SD.jsonio.importFile(file);
        else if (file.type === 'image/svg+xml' || /\.svg$/i.test(file.name)) await addSvgLayer(file, dropPos);
        else if (file.type.startsWith('image/')) await addImageLayer(file, dropPos);
        else U.toast(`Skipped ${file.name} (unsupported)`, 'bad');
      } catch (e) { console.error(e); U.toast(`Couldn't read ${file.name}`, 'bad'); }
    }
  }

  function placeLayerSize(nw, nh) {
    const p = A().project;
    const maxW = p.canvas.width * 0.55, maxH = p.canvas.height * 0.55;
    const s = Math.min(1, maxW / nw, maxH / nh);
    return { w: nw * s, h: nh * s };
  }
  function cascadePos(w, h, dropPos) {
    const p = A().project;
    const n = A().scene().layers.length;
    if (dropPos) return { x: U.clamp(dropPos.x - w / 2, 0, p.canvas.width - w), y: U.clamp(dropPos.y - h / 2, 0, p.canvas.height - h) };
    return {
      x: U.clamp(p.canvas.width / 2 - w / 2 + (n % 5) * 36 - 72, 0, p.canvas.width - w),
      y: U.clamp(p.canvas.height / 2 - h / 2 + (n % 5) * 36 - 72, 0, p.canvas.height - h),
    };
  }

  async function addImageLayer(file, dropPos) {
    const reg = await SD.assets.registerImage(file);
    const S = A();
    const { w, h } = placeLayerSize(reg.width, reg.height);
    const pos = cascadePos(w, h, dropPos);
    const l = S.baseLayer('image', pos.x, pos.y, w, h, file.name.replace(/\.\w+$/, '').slice(0, 24) || 'Image');
    l.image = { assetId: reg.id, nw: reg.width, nh: reg.height };
    S.addLayer(l);
    S.mutate('auto duration', () => { l.duration = E().estimateDuration(S.project, l); }, { history: false, structure: true });
    return l;
  }

  async function addSvgLayer(file, dropPos) {
    const svg = await SD.tools.importSVG(file);
    const S = A();
    const { w, h } = placeLayerSize(svg.vbW, svg.vbH);
    const pos = cascadePos(w, h, dropPos);
    const l = S.baseLayer('svg', pos.x, pos.y, w, h, (file.name || 'SVG').replace(/\.\w+$/, '').slice(0, 24));
    l.svg = svg;
    l.anim.fillReveal = svg.hasFills;
    S.addLayer(l);
    S.mutate('auto duration', () => { l.duration = E().estimateDuration(S.project, l); }, { history: false, structure: true });
    U.toast('SVG added — its real paths will be traced by hand ✒', 'ok');
    return l;
  }

  function addTextLayer() {
    const l = makeTextLayer('Double-click to edit', { name: 'Text', yFrac: 0.5 });
    A().addLayer(l);
    openRightTab('layers');
    setTimeout(() => U.$('#txtContent')?.focus(), 50);
  }

  function buildShapeGrid() {
    const grid = U.$('#shapeGrid');
    grid.innerHTML = '';
    for (const [id, def] of Object.entries(SD.tools.SHAPES)) {
      const svg = `<svg viewBox="0 0 100 60" style="width:70%;height:70%">${def.gen(100, 60).map((p) => `<path d="${p.d}" fill="${p.fill ? 'rgba(120,140,190,.25)' : 'none'}" stroke="currentColor" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>`).join('')}</svg>`;
      const btn = U.el('button', { class: 'lib-item', title: def.name, html: svg });
      btn.addEventListener('click', () => addShapeLayer(id));
      grid.appendChild(btn);
    }
  }
  function addShapeLayer(shapeId) {
    const S = A();
    const p = S.project;
    const ink = E().BG_DEFS[S.scene().background.type]?.ink || '#222831';
    const w = Math.round(p.canvas.width * 0.22), h = Math.round(p.canvas.width * 0.13);
    const pos = cascadePos(w, h);
    const l = S.baseLayer('shape', pos.x, pos.y, w, h, SD.tools.SHAPES[shapeId].name);
    l.shape = { shapeId, stroke: ink, fill: 'none', sw: Math.max(4, Math.round(p.canvas.width / 240)) };
    l.anim.style = 'draw';
    l.anim.strokeColor = ink;
    l.duration = 1.6;
    S.addLayer(l);
  }

  function buildIconGrid() {
    const grid = U.$('#iconGrid');
    const q = (U.$('#iconSearch').value || '').toLowerCase();
    grid.innerHTML = '';
    for (const [id, def] of Object.entries(SD.tools.ICONS)) {
      if (q && !id.toLowerCase().includes(q) && !def.tags.includes(q)) continue;
      const svg = `<svg viewBox="0 0 24 24" style="width:60%;height:60%">${def.d.map((d) => `<path d="${d}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`).join('')}</svg>`;
      const btn = U.el('button', { class: 'lib-item', title: id, html: svg });
      btn.addEventListener('click', () => addIconLayer(id));
      grid.appendChild(btn);
    }
    if (!grid.children.length) grid.innerHTML = '<div class="empty-mini" style="grid-column:1/-1">No matching icons</div>';
  }
  function addIconLayer(iconId) {
    const S = A();
    const p = S.project;
    const ink = E().BG_DEFS[S.scene().background.type]?.ink || '#222831';
    const sz = Math.round(p.canvas.width * 0.14);
    const pos = cascadePos(sz, sz);
    const l = S.baseLayer('icon', pos.x, pos.y, sz, sz, 'Icon ' + iconId);
    l.icon = { iconId, color: ink, sw: 2 };
    l.anim.style = 'draw';
    l.anim.strokeColor = ink;
    l.duration = 2;
    S.addLayer(l);
  }

  /* ═══════ animate panel ═══════ */
  function bindAnimateTab() {
    // style grid
    const grid = U.$('#animStyleGrid');
    for (const [id, name, d] of ANIM_STYLES) {
      const btn = U.el('button', { class: 'astyle', 'data-style': id, title: name });
      btn.innerHTML = `<svg viewBox="0 0 24 20"><path d="${d}" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg><span>${name}</span>`;
      btn.addEventListener('click', () => {
        const l = A().firstSelected(); if (!l) return;
        A().updateAnim(l.id, { style: id }, 'anim style');
        if (id === 'typewriter' && l.type !== 'text') { l.anim.fillReveal = false; }
        A().mutate('auto duration', () => { l.duration = E().estimateDuration(A().project, l); }, { history: false, structure: true });
        syncAnimPanel();
      });
      grid.appendChild(btn);
    }
    // hands row
    const handRow = U.$('#handRow');
    const hands = [['inherit', 'Scene'], ['none', 'None'], ['hand1', 'Pen'], ['hand2', 'Marker'], ['hand3', 'Pencil'], ['hand4', 'Stylus']];
    for (const [id, label] of hands) {
      const btn = U.el('button', { class: 'hand-opt' + (id === 'none' || id === 'inherit' ? ' none' : ''), 'data-hand': id, title: label });
      if (id === 'inherit') btn.innerHTML = `<span>▣</span>${label}`;
      else if (id === 'none') btn.innerHTML = `<span>🚫</span>${label}`;
      else btn.innerHTML = `<img src="assets/hands/${id}-1080p.png" alt="${label}">${label}`;
      btn.addEventListener('click', () => {
        const l = A().firstSelected(); if (!l) return;
        A().updateAnim(l.id, { hand: id }, 'hand');
        syncAnimPanel();
      });
      handRow.appendChild(btn);
    }

    const bindAnim = (id, key, parse = (v) => v, event = 'change') => {
      U.$('#' + id).addEventListener(event, (e) => {
        const l = A().firstSelected(); if (!l) return;
        A().updateAnim(l.id, { [key]: parse(e.target.type === 'checkbox' ? e.target.checked : e.target.value) }, 'anim', { history: event === 'change' });
        if (event === 'change') syncAnimPanel(); else syncAnimLabels();
      });
    };
    bindAnim('animDir', 'dir');
    bindAnim('animEasing', 'easing');
    bindAnim('inkAlgo', 'algo');
    // duration & start live on the layer itself, not the anim config:
    U.$('#animDur').addEventListener('focus', () => { const l = A().firstSelected(); if (l) A().pushHistory('duration'); });
    U.$('#animDur').addEventListener('input', (e) => { const l = A().firstSelected(); if (l) { l.duration = U.clamp(+e.target.value || 2, 0.2, 600); A().touch({ transient: true }); SD.timeline.rebuild(); } });
    U.$('#animDelay').addEventListener('focus', () => { const l = A().firstSelected(); if (l) A().pushHistory('delay'); });
    U.$('#animDelay').addEventListener('input', (e) => { const l = A().firstSelected(); if (l) { l.start = U.clamp(+e.target.value || 0, 0, 600); A().touch({ transient: true }); SD.timeline.rebuild(); } });
    bindAnim('strokeColor', 'strokeColor', (v) => v, 'input');
    bindAnim('strokeWidth', 'strokeWidth', (v) => U.clamp(+v || 6, 1, 40), 'input');
    bindAnim('fillReveal', 'fillReveal');
    bindAnim('rainbowPen', 'rainbow');
    bindAnim('optSfx', 'sfx');
    bindAnim('handRotate', 'handRotate');
    bindAnim('exitStyle', 'exitStyle');
    bindAnim('exitDur', 'exitDur', (v) => U.clamp(+v || 0.7, 0.2, 5));
    U.$('#animJitter').addEventListener('input', (e) => { const l = A().firstSelected(); if (l) { l.anim.jitter = +e.target.value; A().touch({ transient: true }); syncAnimLabels(); } });
    U.$('#animJitter').addEventListener('change', (e) => { const l = A().firstSelected(); if (l) A().updateAnim(l.id, { jitter: +e.target.value }, 'jitter'); });
    U.$('#inkSens').addEventListener('input', (e) => { const l = A().firstSelected(); if (l) { l.anim.sensitivity = +e.target.value / 100; A().touch({ transient: true }); syncAnimLabels(); } });
    U.$('#inkSens').addEventListener('change', (e) => {
      const l = A().firstSelected(); if (!l) return;
      l.anim.sensitivity = +e.target.value / 100;
      A().pushHistory('sensitivity');
      SD.engine.invalidateLayer(l);
      A().touch({});
    });
    U.$('#btnAutoDur').addEventListener('click', () => {
      const l = A().firstSelected(); if (!l) return;
      A().mutate('auto duration', () => { l.duration = E().estimateDuration(A().project, l); }, { structure: true });
      syncAnimPanel();
    });
    U.$('#btnApplyAll').addEventListener('click', () => {
      const S = A(); const src = S.firstSelected(); if (!src) return;
      S.mutate('apply anim all', () => {
        for (const l of S.scene().layers) if (l !== src) { l.anim = U.deepClone(src.anim); SD.engine.invalidateLayer(l); }
      });
      U.toast('Animation setup copied to all layers', 'ok');
    });
    U.$('#btnResetAnim').addEventListener('click', () => {
      const l = A().firstSelected(); if (!l) return;
      A().mutate('reset anim', () => { l.anim = E().defaultAnim(); SD.engine.invalidateLayer(l); });
      syncAnimPanel();
    });
  }

  function syncAnimLabels() {
    const l = A().firstSelected(); if (!l) return;
    U.$('#jitterVal').textContent = Math.round(l.anim.jitter) + '%';
    U.$('#inkSensVal').textContent = Math.round(l.anim.sensitivity * 100) + '%';
  }

  function syncAnimPanel() {
    const S = A();
    const l = S.firstSelected();
    U.$('#animEmpty').style.display = l ? 'none' : '';
    U.$('#animControls').hidden = !l;
    if (!l) return;
    const a = l.anim;
    U.$$('#animStyleGrid .astyle').forEach((b) => b.classList.toggle('active', b.dataset.style === a.style));
    U.$('#animDir').value = a.dir;
    U.$('#animDur').value = +l.duration.toFixed(1);
    U.$('#animDelay').value = +l.start.toFixed(1);
    U.$('#animEasing').value = a.easing;
    U.$('#strokeColor').value = a.strokeColor;
    U.$('#strokeWidth').value = a.strokeWidth;
    U.$('#animJitter').value = a.jitter;
    U.$('#fillReveal').checked = a.fillReveal;
    U.$('#rainbowPen').checked = a.rainbow;
    U.$('#optSfx').checked = a.sfx;
    U.$('#inkAlgo').value = a.algo;
    U.$('#inkSens').value = Math.round(a.sensitivity * 100);
    U.$('#inkRow').style.display = ['image', 'text', 'svg'].includes(l.type) && l.type !== 'svg' ? '' : 'none';
    U.$$('#handRow .hand-opt').forEach((b) => b.classList.toggle('active', b.dataset.hand === a.hand));
    U.$('#handRotate').checked = a.handRotate;
    U.$('#exitStyle').value = a.exitStyle;
    U.$('#exitDur').value = a.exitDur;
    // typewriter only for text
    U.$$('#animStyleGrid .astyle').forEach((b) => {
      if (b.dataset.style === 'typewriter') b.style.opacity = l.type === 'text' ? '' : '0.35';
      if (b.dataset.style === 'handwrite') b.style.opacity = l.type === 'text' ? '' : '0.35';
    });
    syncAnimLabels();
  }

  /* ═══════ layers panel ═══════ */
  function bindLayersTab() {
    U.$('#btnDupLayer').addEventListener('click', () => A().duplicateSelected());
    U.$('#btnDelLayer').addEventListener('click', () => {
      const S = A();
      if (S.selection.size) S.removeLayers(new Set(S.selection));
    });
    U.$('#btnLayerUp').addEventListener('click', () => { const l = A().firstSelected(); if (l) A().reorder(l.id, +1); });
    U.$('#btnLayerDown').addEventListener('click', () => { const l = A().firstSelected(); if (l) A().reorder(l.id, -1); });

    // transform box
    const tf = { tfX: 'x', tfY: 'y', tfW: 'w', tfH: 'h', tfR: 'rot', tfO: 'opacity' };
    for (const [id, key] of Object.entries(tf)) {
      const input = U.$('#' + id);
      input.addEventListener('focus', () => A().pushHistory('transform'));
      input.addEventListener('input', () => {
        const l = A().firstSelected(); if (!l) return;
        let v = +input.value || 0;
        if (key === 'opacity') v = U.clamp(v, 0, 100);
        if (key === 'w' || key === 'h') v = Math.max(1, v);
        l[key] = v;
        if (key === 'w' || key === 'h') SD.engine.invalidateLayer(l);
        A().touch({ transient: true });
      });
      input.addEventListener('change', () => { A().touch({}); A().saveNow(); });
    }
    U.$('#tfFlipX').addEventListener('click', () => { const l = A().firstSelected(); if (l) A().updateLayer(l.id, { flipX: !l.flipX }, 'flip'); });
    U.$('#tfFlipY').addEventListener('click', () => { const l = A().firstSelected(); if (l) A().updateLayer(l.id, { flipY: !l.flipY }, 'flip'); });

    // text box
    bindText();
  }

  function bindText() {
    // font select
    const sel = U.$('#txtFont');
    for (const f of SD.assets.UI_FONTS) sel.appendChild(U.el('option', { value: f.family, style: `font-family:"${f.family}"` }, f.label));
    const tmut = (label, fn, opts = {}) => {
      const l = A().firstSelected(); if (!l || l.type !== 'text') return;
      A().mutate(label, () => {
        fn(l);
        if (opts.resize !== false) SD.stage.autoSizeTextLayer(l);
        SD.engine.invalidateLayer(l);
      }, opts);
    };
    U.$('#txtContent').addEventListener('focus', () => A().pushHistory('text'));
    U.$('#txtContent').addEventListener('input', (e) => {
      const l = A().firstSelected(); if (!l || l.type !== 'text') return;
      l.text.content = e.target.value;
      SD.stage.autoSizeTextLayer(l);
      SD.engine.invalidateLayer(l);
      A().touch({ transient: true });
    });
    U.$('#txtFont').addEventListener('change', (e) => tmut('font', (l) => { l.text.font = e.target.value; }));
    U.$('#txtSize').addEventListener('change', (e) => tmut('size', (l) => { l.text.size = U.clamp(+e.target.value || 40, 8, 900); }));
    U.$('#txtColor').addEventListener('input', (e) => {
      const l = A().firstSelected(); if (!l || l.type !== 'text') return;
      l.text.color = e.target.value; l.anim.strokeColor = e.target.value;
      SD.engine.invalidateLayer(l); A().touch({ transient: true });
    });
    U.$('#txtBold').addEventListener('click', () => tmut('bold', (l) => { l.text.bold = !l.text.bold; }));
    U.$('#txtItalic').addEventListener('click', () => tmut('italic', (l) => { l.text.italic = !l.text.italic; }));
    U.$('#txtAlignL').addEventListener('click', () => tmut('align', (l) => { l.text.align = 'left'; }));
    U.$('#txtAlignC').addEventListener('click', () => tmut('align', (l) => { l.text.align = 'center'; }));
    U.$('#txtAlignR').addEventListener('click', () => tmut('align', (l) => { l.text.align = 'right'; }));
    U.$('#txtLineH').addEventListener('change', (e) => tmut('lineH', (l) => { l.text.lineH = U.clamp(+e.target.value || 1.25, 0.8, 3); }));
    U.$('#txtSpacing').addEventListener('change', (e) => tmut('spacing', (l) => { l.text.spacing = U.clamp(+e.target.value || 0, -10, 100); }));
    U.$('#txtUnderline').addEventListener('change', (e) => tmut('underline', (l) => { l.text.underline = e.target.value; }, { structure: true }));
  }

  function rebuildLayerList() {
    const S = A();
    if (!S.project) return;
    const wrap = U.$('#layerList');
    wrap.innerHTML = '';
    const scene = S.scene();
    if (!scene.layers.length) { wrap.innerHTML = '<div class="empty-mini">No layers yet — add content from the Content tab.</div>'; return; }
    const TYPE_ICON = { image: '🖼', svg: '✒️', text: 'T', drawing: '✏', shape: '➤', icon: '★' };
    scene.layers.forEach((l, idx) => {
      const row = U.el('div', { class: 'layer-row' + (S.selection.has(l.id) ? ' selected' : '') + (l.visible === false ? ' hidden-l' : ''), 'data-id': l.id });
      const thumb = U.el('div', { class: 'layer-thumb' });
      row.appendChild(thumb);
      row.appendChild(U.el('div', { class: 'layer-info' },
        U.el('div', { class: 'layer-name' }, (idx + 1) + '. ' + l.name),
        U.el('div', { class: 'layer-meta' }, U.el('span', {}, animShortName(l.anim.style)), U.el('span', {}, `${l.start.toFixed(1)}s +${l.duration.toFixed(1)}s`))));
      const btns = U.el('div', { class: 'layer-btns' });
      const vis = U.el('button', { class: 'lmini', title: l.visible === false ? 'Show' : 'Hide', html: l.visible === false ? eyeOffSvg() : eyeSvg() });
      vis.addEventListener('click', (e) => { e.stopPropagation(); A().updateLayer(l.id, { visible: l.visible === false }, 'visibility', { structure: true }); rebuildLayerList(); });
      const lock = U.el('button', { class: 'lmini', title: l.locked ? 'Unlock' : 'Lock' }, l.locked ? '🔒' : '🔓');
      lock.addEventListener('click', (e) => { e.stopPropagation(); A().updateLayer(l.id, { locked: !l.locked }, 'lock'); });
      btns.append(vis, lock);
      row.appendChild(btns);
      row.addEventListener('click', (e) => {
        if (e.shiftKey || e.ctrlKey || e.metaKey) {
          S.selection.has(l.id) ? S.selection.delete(l.id) : S.selection.add(l.id);
        } else S.selection = new Set([l.id]);
        U.bus.emit('selection');
      });
      row.addEventListener('dblclick', () => {
        const name = prompt('Layer name:', l.name);
        if (name) A().mutate('rename', () => { l.name = name; }, { structure: true });
      });
      wrap.appendChild(row);
    });
    refreshThumbsSoon();
  }
  function eyeSvg() { return '<svg viewBox="0 0 24 24"><path d="M2.5 12 C5.5 6.5 8.8 4.5 12 4.5 C15.2 4.5 18.5 6.5 21.5 12 C18.5 17.5 15.2 19.5 12 19.5 C8.8 19.5 5.5 17.5 2.5 12 Z"/><circle cx="12" cy="12" r="3"/></svg>'; }
  function eyeOffSvg() { return '<svg viewBox="0 0 24 24"><path d="M4 4 L20 20"/><path d="M9.9 5.2 C10.6 4.9 11.3 4.7 12 4.7 C15.2 4.7 18.5 6.7 21.5 12 C20.7 13.5 19.7 14.8 18.6 15.9 M14.1 18.9 C13.4 19.2 12.7 19.3 12 19.3 C8.8 19.3 5.5 17.3 2.5 12 C3.3 10.5 4.3 9.2 5.4 8.1"/></svg>'; }
  function animShortName(id) { const f = ANIM_STYLES.find((s) => s[0] === id); return f ? f[1] : id; }

  function refreshLayerThumbs() {
    const S = A();
    if (!S.project) return;
    U.$$('.layer-row', U.$('#layerList')).forEach((row) => {
      const l = S.layer(row.dataset.id);
      if (!l) return;
      const box = U.$('.layer-thumb', row);
      try {
        const content = E().layerContent(S.project, l);
        const c = U.makeCanvas(34, 34);
        c.getContext('2d').drawImage(content, 0, 0, 34, 34);
        box.innerHTML = '';
        box.appendChild(c);
      } catch (e) { /* keep old */ }
    });
  }
  U.bus.on('layer-ready', refreshThumbsSoon);

  function syncLayerListSelection() {
    const S = A();
    U.$$('.layer-row', U.$('#layerList')).forEach((row) => row.classList.toggle('selected', S.selection.has(row.dataset.id)));
  }

  function syncTransformBox() {
    const S = A();
    const l = S.firstSelected();
    U.$('#transformBox').style.display = l ? '' : 'none';
    U.$('#textBox').hidden = !(l && l.type === 'text');
    if (!l) return;
    syncTransformValues();
    if (l.type === 'text') {
      U.$('#txtContent').value = l.text.content;
      U.$('#txtFont').value = l.text.font;
      U.$('#txtSize').value = Math.round(l.text.size);
      U.$('#txtColor').value = l.text.color;
      U.$('#txtBold').classList.toggle('on', l.text.bold);
      U.$('#txtItalic').classList.toggle('on', l.text.italic);
      U.$('#txtAlignL').classList.toggle('on', l.text.align === 'left');
      U.$('#txtAlignC').classList.toggle('on', l.text.align === 'center');
      U.$('#txtAlignR').classList.toggle('on', l.text.align === 'right');
      U.$('#txtLineH').value = l.text.lineH;
      U.$('#txtSpacing').value = l.text.spacing;
      U.$('#txtUnderline').value = l.text.underline;
    }
  }
  function syncTransformValues() {
    const l = A().firstSelected();
    if (!l) return;
    const set = (id, v) => { const el = U.$('#' + id); if (document.activeElement !== el) el.value = v; };
    set('tfX', Math.round(l.x)); set('tfY', Math.round(l.y));
    set('tfW', Math.round(l.w)); set('tfH', Math.round(l.h));
    set('tfR', Math.round(l.rot)); set('tfO', Math.round(l.opacity));
  }

  /* ═══════ global drop & paste ═══════ */
  function bindGlobalDropPaste() {
    const veil = U.$('#dropVeil');
    let dragDepth = 0;
    window.addEventListener('dragenter', (e) => {
      if ([...(e.dataTransfer?.types || [])].includes('Files')) { dragDepth++; veil.hidden = false; }
    });
    window.addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; veil.hidden = true; } });
    window.addEventListener('dragover', (e) => e.preventDefault());
    window.addEventListener('drop', (e) => {
      e.preventDefault();
      dragDepth = 0; veil.hidden = true;
      if (!e.dataTransfer.files.length) return;
      let pos = null;
      const stageRect = SD.stage && U.$('#stageCanvas') ? U.$('#stageCanvas').getBoundingClientRect() : null;
      if (stageRect && e.clientX >= stageRect.left && e.clientX <= stageRect.right && e.clientY >= stageRect.top && e.clientY <= stageRect.bottom) {
        pos = SD.stage.worldFromEvent(e);
      }
      handleFiles([...e.dataTransfer.files], pos);
    });
    window.addEventListener('paste', (e) => {
      if (/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName || '')) return;
      const items = [...(e.clipboardData?.items || [])];
      const img = items.find((it) => it.type.startsWith('image/'));
      if (img) {
        const file = img.getAsFile();
        if (file) { handleFiles([file]); U.toast('Pasted image added', 'ok'); }
      }
    });
  }

  SD.panels = { init, syncAll, rebuildLayerList, rebuildSceneList, openRightTab, makeTextLayer, handleFiles, ANIM_STYLES, STYLE_PRESETS };
})();
