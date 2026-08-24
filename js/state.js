/* SwapDraws — state.js : project model, CRUD, undo/redo, autosave, project files */
(function () {
  const SD = (window.SD = window.SD || {});
  const U = SD.util;

  const LS_INDEX = 'sd_projects_index';
  const LS_PREFIX = 'sd_proj_';
  const LS_AUTOSAVE = 'sd_last_open';
  const LS_UI = 'sd_ui_prefs';

  /* ── factories ── */
  function newScene(name, opts = {}) {
    return {
      id: U.uid('scn'),
      name: name || 'Scene',
      background: { type: 'white', color: '#f7f3ea' },
      defaultHand: 'hand1',
      transition: { type: 'fade', duration: 0.7 },
      holdAfter: 0.8,
      camera: { enabled: false, keys: [] },
      layers: [],
      _cv: 0,
    };
  }

  function newProject(name, opts = {}) {
    const p = {
      id: U.uid('prj'),
      name: name || 'Untitled Project',
      createdAt: Date.now(),
      modifiedAt: Date.now(),
      canvas: { width: 1920, height: 1080, aspect: '16:9', res: 1080 },
      scenes: [newScene('Scene 1')],
      activeSceneIdx: 0,
      defaultAnim: null, // reserved
      _cv: 0,
    };
    if (opts.aspect) setCanvasAspect(p, opts.aspect, opts.res || 1080);
    return p;
  }

  function setCanvasAspect(p, aspect, res) {
    res = res || p.canvas.res || 1080;
    let w, h;
    const gh = res, gw = Math.round(res * 16 / 9);
    if (aspect === '16:9') { w = Math.round(res * 16 / 9); h = res; }
    else if (aspect === '9:16') { w = Math.round(res * 9 / 16); h = res; }
    else if (aspect === '1:1') { w = res; h = res; }
    else if (aspect === '4:3') { w = Math.round(res * 4 / 3); h = res; }
    else return; // custom keeps dims
    p.canvas.aspect = aspect; p.canvas.res = res; p.canvas.width = w; p.canvas.height = h;
  }
  function setCanvasRes(p, res) {
    p.canvas.res = res;
    if (p.canvas.aspect !== 'custom') setCanvasAspect(p, p.canvas.aspect, res);
  }

  function baseLayer(type, x, y, w, h, name) {
    return {
      id: U.uid('lyr'),
      type, name: name || type,
      x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h),
      rot: 0, opacity: 100, flipX: false, flipY: false,
      visible: true, locked: false,
      start: 0, duration: 2,
      anim: SD.engine.defaultAnim(),
      _cv: 0,
    };
  }

  /* ── the store ── */
  const S = {
    project: null,
    selection: new Set(),
    editTime: 0,          // playhead (scene-local seconds)
    playing: false,
    ready: false,         // assets loaded

    scene() { return this.project.scenes[this.project.activeSceneIdx]; },
    layer(id) { return this.scene().layers.find((l) => l.id === id) || null; },
    anyLayer(id) { for (const s of this.project.scenes) { const l = s.layers.find((x) => x.id === id); if (l) return l; } return null; },
    selectedLayers() { return this.scene().layers.filter((l) => this.selection.has(l.id)); },
    firstSelected() { const l = this.selectedLayers(); return l[l.length - 1] || null; },

    /* ── history ── */
    _undo: [], _redo: [],
    pushHistory(label) {
      try {
        this._undo.push(JSON.stringify(this._serializeLight(this.project)));
        if (this._undo.length > 60) this._undo.shift();
        this._redo.length = 0;
        U.bus.emit('history');
      } catch (e) { console.warn('history failed', e); }
    },
    undo() {
      if (!this._undo.length) { U.toast('Nothing to undo'); return; }
      this._redo.push(JSON.stringify(this._serializeLight(this.project)));
      this.project = this._hydrate(JSON.parse(this._undo.pop()));
      this.afterLoad('undo');
    },
    redo() {
      if (!this._redo.length) { U.toast('Nothing to redo'); return; }
      this._undo.push(JSON.stringify(this._serializeLight(this.project)));
      this.project = this._hydrate(JSON.parse(this._redo.pop()));
      this.afterLoad('redo');
    },

    /* strip runtime caches before serializing */
    _serializeLight(p) {
      const clone = JSON.parse(JSON.stringify(p, (k, v) => (k.startsWith('_') && k !== '_cv' && k !== '_planKey' && k !== '_contentKey') || k === 'svg' && k === '_img' ? undefined : v));
      // remove runtime-only svg image ref
      for (const s of clone.scenes) for (const l of s.layers) if (l.type === 'svg' && l.svg) delete l.svg._img;
      delete clone._transA; delete clone._transB;
      return clone;
    },
    _hydrate(p) {
      p.activeSceneIdx = U.clamp(p.activeSceneIdx || 0, 0, Math.max(0, p.scenes.length - 1));
      return p;
    },

    /* ── mutations (each: history + events + autosave) ── */
    mutate(label, fn, opts = {}) {
      if (opts.history !== false) this.pushHistory(label);
      const out = fn(this.project);
      this.touch(opts);
      return out;
    },
    touch(opts = {}) {
      this.project.modifiedAt = Date.now();
      this.project._cv++;
      U.bus.emit('change', opts);
      if (opts.structure) U.bus.emit('structure');
      saveDebounced();
      saveIndicator(false);
    },

    /* ── layers ── */
    addLayer(layer, opts = {}) {
      return this.mutate('add layer', () => {
        const scene = this.scene();
        if (opts.sequence !== false) {
          const end = SD.engine.contentEnd(scene);
          layer.start = Math.max(layer.start || 0, opts.atTime != null ? opts.atTime : (end > 0 ? end + 0.25 : 0));
        }
        scene.layers.push(layer);
        this.selection = new Set([layer.id]);
        return layer;
      }, { structure: true });
    },
    updateLayer(id, patch, label = 'edit', opts = {}) {
      return this.mutate(label, () => {
        const l = this.layer(id) || this.anyLayer(id);
        if (!l) return;
        Object.assign(l, patch);
        SD.engine.invalidateLayer(l);
      }, opts);
    },
    updateAnim(id, patch, label = 'animate') {
      return this.mutate(label, () => {
        const l = this.layer(id) || this.anyLayer(id);
        if (!l) return;
        Object.assign(l.anim, patch);
      });
    },
    removeLayers(ids, label = 'delete') {
      return this.mutate(label, () => {
        const scene = this.scene();
        scene.layers = scene.layers.filter((l) => !ids.has(l.id));
        for (const id of ids) this.selection.delete(id);
      }, { structure: true });
    },
    duplicateSelected() {
      const sel = this.selectedLayers();
      if (!sel.length) return;
      const created = [];
      this.mutate('duplicate', () => {
        const scene = this.scene();
        for (const l of sel) {
          const c = U.deepClone(this._serializeLight({ scenes: [{ layers: [l] }] }).scenes[0].layers[0]);
          c.id = U.uid('lyr');
          c.name = l.name + ' copy';
          c.x += 30; c.y += 30; c.start += 0.2;
          scene.layers.push(c);
          created.push(c);
        }
      }, { structure: true });
      this.selection = new Set(created.map((c) => c.id));
      U.bus.emit('selection');
      return created;
    },
    reorder(id, dir) { // +1 forward (up in stack), -1 back
      return this.mutate('reorder', () => {
        const arr = this.scene().layers;
        const i = arr.findIndex((l) => l.id === id);
        const j = i + dir;
        if (i < 0 || j < 0 || j >= arr.length) return;
        [arr[i], arr[j]] = [arr[j], arr[i]];
      }, { structure: true });
    },

    /* ── scenes ── */
    addScene(opts = {}) {
      return this.mutate('add scene', () => {
        const s = newScene('Scene ' + (this.project.scenes.length + 1));
        if (opts.presetBg) { s.background.type = opts.presetBg; }
        this.project.scenes.push(s);
        this.project.activeSceneIdx = this.project.scenes.length - 1;
        this.selection.clear();
        return s;
      }, { structure: true });
    },
    deleteScene(idx) {
      if (this.project.scenes.length <= 1) { U.toast('A project needs at least one scene', 'bad'); return; }
      this.mutate('delete scene', () => {
        this.project.scenes.splice(idx, 1);
        this.project.activeSceneIdx = U.clamp(this.project.activeSceneIdx, 0, this.project.scenes.length - 1);
        this.selection.clear();
      }, { structure: true });
    },
    duplicateScene(idx) {
      this.mutate('duplicate scene', () => {
        const src = this.project.scenes[idx];
        const c = U.deepClone(this._serializeLight({ scenes: [src] }).scenes[0]);
        c.id = U.uid('scn');
        c.name = src.name + ' copy';
        for (const l of c.layers) l.id = U.uid('lyr');
        this.project.scenes.splice(idx + 1, 0, c);
        this.project.activeSceneIdx = idx + 1;
        this.selection.clear();
      }, { structure: true });
    },
    setActiveScene(idx) {
      if (idx === this.project.activeSceneIdx) return;
      this.project.activeSceneIdx = U.clamp(idx, 0, this.project.scenes.length - 1);
      this.selection.clear();
      this.editTime = 0;
      U.bus.emit('change', { sceneSwitch: true });
      U.bus.emit('structure');
      U.bus.emit('selection');
    },

    /* ── project lifecycle ── */
    async createProject(name, opts = {}) {
      this.project = newProject(name, opts);
      this._undo = []; this._redo = [];
      this.editTime = 0; this.selection = new Set();
      if (opts.template) applyTemplate(this.project, opts.template);
      await this.afterLoad('new');
      saveNow();
    },
    async openProject(id) {
      const raw = localStorage.getItem(LS_PREFIX + id);
      if (!raw) { U.toast('Project not found', 'bad'); return false; }
      const p = this._hydrate(JSON.parse(raw));
      this.project = p;
      this._undo = []; this._redo = [];
      this.editTime = 0; this.selection = new Set();
      saveIndicator(false, 'loading…');
      try {
        const assetIds = new Set();
        for (const s of p.scenes) for (const l of s.layers) if (l.image && l.image.assetId) assetIds.add(l.image.assetId);
        await Promise.all([...assetIds].map((a) => SD.assets.getImage(a).catch(() => null)));
      } catch (e) { console.warn(e); }
      await this.afterLoad('open');
      localStorage.setItem(LS_AUTOSAVE, id);
      return true;
    },
    async afterLoad(reason) {
      this.ready = true;
      U.bus.emit('change', { reason });
      U.bus.emit('structure');
      U.bus.emit('selection');
      U.bus.emit('history');
      saveIndicator(true);
      U.bus.emit('project-loaded', { reason });
    },
    deleteProject(id) {
      const idx = listProjects().filter((m) => m.id !== id);
      localStorage.setItem(LS_INDEX, JSON.stringify(idx));
      localStorage.removeItem(LS_PREFIX + id);
      U.bus.emit('projects');
    },
  };

  /* ── templates ── */
  function applyTemplate(p, tpl) {
    const mkText = (content, size, y, opts = {}) => {
      const l = baseLayer('text', 0, 0, 40, 20, 'Text');
      l.text = { content, font: opts.font || 'Caveat', size, bold: opts.bold !== false, italic: false, color: opts.color || '#222831', align: 'center', lineH: 1.25, spacing: 0, underline: opts.underline || 'none' };
      const L = SD.engine.textLayout(l);
      l.w = Math.max(24, Math.ceil(L.w));
      l.h = Math.max(18, Math.ceil(L.h));
      l.x = Math.round(p.canvas.width / 2 - l.w / 2);
      l.y = Math.round(y - l.h / 2);
      l.anim.style = opts.style || 'handwrite';
      l.anim.strokeColor = l.text.color;
      return l;
    };
    if (tpl === 'explainer') {
      const s1 = p.scenes[0]; s1.name = 'Title';
      const t = mkText('Your Big Idea', 190, 380); s1.layers.push(t);
      const sub = mkText('explained in 60 seconds', 84, 640, { color: '#5b6572', style: 'handwrite', font: 'Patrick Hand' });
      s1.layers.push(sub);
      t.start = 0.2; sub.start = 1.9; t.duration = 2.2; sub.duration = 1.8;
      const s2 = newScene('Content'); p.scenes.push(s2);
      const s3 = newScene('Outro'); p.scenes.push(s3);
      const th = mkText('Thanks for watching!', 150, 420, { underline: 'squiggle' });
      s3.layers.push(th); th.start = 0.2; th.duration = 2.2;
      s3.transition.type = 'zoom';
    } else if (tpl === 'social') {
      setCanvasAspect(p, '9:16', 1080);
      const t = mkText('Stop scrolling ✋', 120, 500);
      p.scenes[0].layers.push(t); t.duration = 1.6; t.start = 0.2;
    } else if (tpl === 'chalk') {
      const s = p.scenes[0];
      s.background.type = 'chalk'; s.defaultHand = 'hand3';
      const t = mkText("Today's lesson", 170, 380, { color: '#f4f2e8', underline: 'line' });
      t.anim.style = 'chalk'; t.anim.fillReveal = false; t.anim.strokeColor = '#f4f2e8';
      s.layers.push(t); t.start = 0.3; t.duration = 2.4;
    }
  }

  /* ── persistence ── */
  function projectMeta(p, thumb) {
    return { id: p.id, name: p.name, modifiedAt: p.modifiedAt, createdAt: p.createdAt, w: p.canvas.width, h: p.canvas.height, scenes: p.scenes.length, thumb: thumb || null };
  }
  function listProjects() {
    try { return JSON.parse(localStorage.getItem(LS_INDEX) || '[]'); } catch { return []; }
  }
  function makeThumb(p) {
    try {
      const scale = 220 / p.canvas.width;
      const c = U.makeCanvas(220, p.canvas.height * scale);
      const dpr = 1;
      const ctx = c.getContext('2d');
      const t = Math.min(1.5, SD.engine.projectDuration(p) * 0.55);
      // render at low res via temp canvas at full res (bg only + layers) — scale trick: render to small canvas with ctx.scale
      const { idx, local } = SD.engine.timeToScene(p, t);
      ctx.save();
      ctx.scale(scale, scale);
      SD.engine.renderSceneFrame(p, idx, local, ctx, { showHand: false });
      ctx.restore();
      return c.toDataURL('image/jpeg', 0.72);
    } catch (e) { return null; }
  }
  function saveNow() {
    if (!S.project) return;
    try {
      const p = S.project;
      const idx = listProjects().filter((m) => m.id !== p.id);
      idx.unshift(projectMeta(p, makeThumb(p)));
      localStorage.setItem(LS_INDEX, JSON.stringify(idx.slice(0, 60)));
      localStorage.setItem(LS_PREFIX + p.id, JSON.stringify(S._serializeLight(p)));
      localStorage.setItem(LS_AUTOSAVE, p.id);
      saveIndicator(true);
      U.bus.emit('projects');
    } catch (e) { console.warn('save failed', e); saveIndicator(false, 'save failed'); }
  }
  const saveDebounced = U.debounce(saveNow, 700);
  function saveIndicator(ok, txt) {
    const el = U.$('#saveIndicator');
    if (el) { el.textContent = txt || (ok ? 'saved' : 'saving…'); el.classList.toggle('dirty', !ok); }
  }

  /* ── project file import/export ── */
  async function exportProjectFile() {
    const p = S._serializeLight(S.project);
    const payload = { app: 'swapdraws', version: 1, project: p, assets: {} };
    // embed images as dataURLs so the file is self-contained
    for (const s of S.project.scenes) for (const l of s.layers) {
      if (l.image && l.image.assetId) {
        try {
          const img = await SD.assets.getImage(l.image.assetId);
          const c = U.makeCanvas(img.naturalWidth, img.naturalHeight);
          c.getContext('2d').drawImage(img, 0, 0);
          payload.assets[l.image.assetId] = c.toDataURL('image/png');
        } catch (e) { /* skip */ }
      }
    }
    U.download(new Blob([JSON.stringify(payload)], { type: 'application/json' }), (S.project.name || 'project').replace(/\s+/g, '-').toLowerCase() + '.swapdraws.json');
    U.toast('Project downloaded', 'ok');
  }
  async function importProjectFile(file) {
    try {
      const payload = JSON.parse(await file.text());
      if (!payload || payload.app !== 'swapdraws' || !payload.project) throw new Error('bad file');
      const p = payload.project;
      p.id = U.uid('prj'); // avoid id collisions
      for (const [oldId, dataURL] of Object.entries(payload.assets || {})) {
        const reg = await SD.assets.registerDataURL(dataURL);
        for (const s of p.scenes) for (const l of s.layers) if (l.image && l.image.assetId === oldId) l.image.assetId = reg.id;
      }
      S.project = S._hydrate(p);
      S._undo = []; S._redo = []; S.editTime = 0; S.selection = new Set();
      await S.afterLoad('import');
      saveNow();
      U.toast('Project imported', 'ok');
      return true;
    } catch (e) { console.error(e); U.toast('Could not import — not a SwapDraws file', 'bad'); return false; }
  }

  /* ── UI prefs (theme etc.) ── */
  function loadPrefs() { try { return JSON.parse(localStorage.getItem(LS_UI) || '{}'); } catch { return {}; } }
  function savePrefs(patch) { localStorage.setItem(LS_UI, JSON.stringify({ ...loadPrefs(), ...patch })); }

  S.saveNow = saveNow;
  S.listProjects = listProjects;
  S.exportProjectFile = exportProjectFile;
  S.importProjectFile = importProjectFile;
  S.LS_AUTOSAVE = LS_AUTOSAVE;
  S.loadPrefs = loadPrefs; S.savePrefs = savePrefs;
  S.newScene = newScene; S.baseLayer = baseLayer;
  S.setCanvasAspect = setCanvasAspect; S.setCanvasRes = setCanvasRes;

  SD.state = S;
})();
