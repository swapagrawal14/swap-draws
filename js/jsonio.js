/* SwapDraws — jsonio.js
   Import & export hand-authored JSON "scripts": describe scenes as data,
   get a whiteboard animation. Also accepts .swapdraws project backups.
   Script format v1 — see README.md for the full schema. */
(function () {
  const SD = (window.SD = window.SD || {});
  const U = SD.util;

  const STYLES = ['draw', 'drawfill', 'chalk', 'sketch', 'handwrite', 'typewriter', 'scan', 'chunks', 'spiral', 'radial', 'wipe', 'fade', 'pop', 'slide', 'rise', 'none'];
  const EXITS = ['none', 'fade', 'shrink', 'slide', 'dissolve', 'erase'];
  const DIRS = ['ltr', 'rtl', 'ttb', 'btt', 'center', 'random'];
  const EASES = ['linear', 'easeIn', 'easeOut', 'easeInOut', 'bounceSoft'];
  const TRANSITIONS = ['none', 'fade', 'erase', 'zoom', 'wipe-left', 'wipe-right', 'wipe-up', 'wipe-down', 'slide-left', 'slide-right', 'slide-up', 'slide-down'];
  const HANDS = ['inherit', 'none', 'hand1', 'hand2', 'hand3', 'hand4'];
  const FONTS = ['Caveat', 'Patrick Hand', 'Permanent Marker', 'Shadows Into Light Two', 'Kalam', 'Nunito', 'DM Sans', 'Merriweather', 'Space Mono'];

  const fail = (msg) => { throw new Error(msg); };
  const camelize = (s) => String(s).replace(/[-_ ]([a-z])/g, (_, c) => c.toUpperCase());
  const libMatch = (lib, id) => (lib[id] ? id : (lib[camelize(id)] ? camelize(id) : null));

  /* ───────── value helpers ───────── */
  const num = (v) => (typeof v === 'number' && isFinite(v));
  const posN = (v, total, dflt = 0.5) => {
    if (v === 'center') return total / 2;
    if (v === 'left' || v === 'top') return total * 0.25;
    if (v === 'right' || v === 'bottom') return total * 0.75;
    if (num(v)) return (Math.abs(v) <= 1 ? v * total : v);
    return total * dflt;
  };
  const sizeN = (v, total, dfltFrac) => (!num(v) ? total * dfltFrac : (Math.abs(v) <= 1 ? v * total : v));

  /* ───────── script → project ───────── */
  async function buildProject(spec, warn) {
    const S = SD.state, E = SD.engine;
    const name = typeof spec.name === 'string' && spec.name.trim() ? spec.name.trim().slice(0, 80) : 'JSON storyboard';

    // build into a detached project object — the live project is swapped
    // only once everything exists, so no bus event ever sees an empty scene list
    const cw0 = spec.canvas || {};
    const aspect = ['16:9', '9:16', '1:1', '4:3'].includes(cw0.aspect) ? cw0.aspect : '16:9';
    const res = [720, 1080, 2160].includes(+cw0.resolution) ? +cw0.resolution : 1080;
    const p = { id: U.uid('prj'), name, created: Date.now(), modifiedAt: Date.now(), activeSceneIdx: 0, canvas: {}, scenes: [], _cv: 1 };
    S.setCanvasAspect(p, aspect, res);
    const CW = p.canvas.width, CH = p.canvas.height;

    if (!Array.isArray(spec.scenes) || !spec.scenes.length) fail('Script needs a "scenes" array with at least one scene.');

    const mkCommon = (l, o, idx) => {
      const a = l.anim;
      if (o.name != null) l.name = String(o.name).slice(0, 40) || l.name;
      if (num(o.rot)) l.rot = o.rot;
      if (num(o.opacity)) l.opacity = U.clamp(o.opacity, 0, 100);
      if (o.flipX) l.flipX = true; if (o.flipY) l.flipY = true;
      if (o.hidden || o.visible === false) l.visible = false;
      l.start = num(o.delay) ? Math.max(0, o.delay) : (num(o.start) ? Math.max(0, o.start) : 0);
      if (num(o.duration)) l.duration = U.clamp(o.duration, 0.1, 600);
      if (o.style != null) { if (STYLES.includes(o.style)) a.style = o.style; else warn.push(`layer ${idx}: unknown style "${o.style}" → draw`); }
      if (o.dir != null && DIRS.includes(o.dir)) a.dir = o.dir;
      if (o.easing != null && EASES.includes(o.easing)) a.easing = o.easing;
      const ink = o.ink || o.color;
      if (ink) a.strokeColor = String(ink);
      if (num(o.strokeWidth)) a.strokeWidth = U.clamp(o.strokeWidth, 1, 60);
      if (o.fillReveal != null) a.fillReveal = !!o.fillReveal;
      if (o.rainbow != null) a.rainbow = !!o.rainbow;
      if (num(o.jitter)) a.jitter = U.clamp(o.jitter, 0, 100);
      if (o.sfx != null) a.sfx = !!o.sfx;
      if (o.hand != null && HANDS.includes(o.hand)) a.hand = o.hand;
      if (o.handRotate != null) a.handRotate = !!o.handRotate;
      if (o.algo != null && ['edge', 'adaptive', 'chroma', 'log'].includes(o.algo)) a.algo = o.algo;
      if (num(o.sensitivity)) a.sensitivity = U.clamp(o.sensitivity, 0, 1);
      if (o.exit && EXITS.includes(o.exit.style)) { a.exitStyle = o.exit.style; if (num(o.exit.duration)) a.exitDur = o.exit.duration; }
    };

    const place = (l, o) => {
      // explicit w/h → fit content proportionally; then position center-x/y by x/y
      if (num(o.w) || num(o.h)) {
        const tw = num(o.w) ? sizeN(o.w, CW, 0.2) : 0, th = num(o.h) ? sizeN(o.h, CH, 0.2) : 0;
        const sc = tw && th ? Math.min(tw / l.w, th / l.h) : (tw ? tw / l.w : th / l.h);
        l.w = Math.max(10, Math.round(l.w * sc)); l.h = Math.max(10, Math.round(l.h * sc));
      }
      l.x = Math.round(posN(o.x, CW) - l.w / 2);
      l.y = Math.round(posN(o.y, CH) - l.h / 2);
    };

    const buildText = (o, idx) => {
      const size = sizeN(o.size, CH, 0.14);
      const l = S.baseLayer('text', 0, 0, 40, 20, o.name || 'Text');
      l.text = {
        content: String(o.text ?? o.content ?? ''),
        font: FONTS.includes(o.font) ? o.font : (o.font ? (warn.push(`layer ${idx}: unknown font "${o.font}" → Caveat`), 'Caveat') : 'Caveat'),
        size: Math.round(U.clamp(size, 8, CH)),
        bold: o.bold !== false, italic: !!o.italic,
        color: String(o.color || o.ink || '#222831'),
        align: ['left', 'center', 'right'].includes(o.align) ? o.align : 'center',
        lineH: num(o.lineH) ? U.clamp(o.lineH, 0.8, 3) : 1.25,
        spacing: num(o.spacing) ? o.spacing : 0,
        underline: ['none', 'line', 'squiggle', 'highlight'].includes(o.underline) ? o.underline : 'none',
      };
      const L = E.textLayout(l);
      l.w = Math.max(24, Math.ceil(L.w)); l.h = Math.max(18, Math.ceil(L.h));
      l.anim.style = o.style || 'handwrite';
      l.anim.strokeColor = l.text.color;
      return l;
    };

    const buildIcon = (o, idx) => {
      const iconId = libMatch(SD.tools.ICONS, String(o.icon || ''));
      if (!iconId) { warn.push(`layer ${idx}: unknown icon "${o.icon}" → skipped`); return null; }
      const sz = Math.round(sizeN(o.size, CW, 0.16));
      const l = S.baseLayer('icon', 0, 0, sz, sz, o.name || ('Icon ' + iconId));
      l.icon = { iconId, color: String(o.color || o.ink || '#222831'), sw: num(o.sw) ? U.clamp(o.sw, 0.4, 8) : 2 };
      l.anim.style = o.style || 'draw';
      l.anim.strokeColor = l.icon.color;
      return l;
    };

    const buildShape = (o, idx) => {
      const shapeId = libMatch(SD.tools.SHAPES, String(o.shape || ''));
      if (!shapeId) { warn.push(`layer ${idx}: unknown shape "${o.shape}" → skipped`); return null; }
      const w = Math.round(sizeN(o.size, CW, 0.22)), h = Math.round(w * (13 / 22));
      const l = S.baseLayer('shape', 0, 0, w, h, o.name || SD.tools.SHAPES[shapeId].name);
      const fill = typeof o.fill === 'string' ? o.fill : (o.fill === true ? String(o.color || '#ffd166') : 'none');
      l.shape = { shapeId, stroke: String(o.color || o.ink || '#222831'), fill, sw: num(o.strokeWidth) ? U.clamp(o.strokeWidth, 1, 40) : Math.max(4, Math.round(CW / 240)) };
      l.anim.style = o.style || 'draw';
      l.anim.strokeColor = l.shape.stroke;
      return l;
    };

    const buildSvg = async (o, idx) => {
      let svgObj = null;
      try {
        let text;
        if (String(o.src).startsWith('data:image/svg+xml')) text = decodeURIComponent(String(o.src).split(',')[1] || '');
        else text = await (await fetch(String(o.src))).text();
        svgObj = await SD.tools.importSVG(new File([text], 'script.svg', { type: 'image/svg+xml' }));
      } catch (e) { warn.push(`layer ${idx}: SVG could not be loaded (${e.message || 'fetch failed'}) — skipped`); return null; }
      const { w, h } = (() => { const m = Math.min(CW * 0.55 / svgObj.vbW, CH * 0.55 / svgObj.vbH, 2); return { w: Math.round(svgObj.vbW * m), h: Math.round(svgObj.vbH * m) }; })();
      const l = S.baseLayer('svg', 0, 0, w, h, o.name || 'SVG');
      l.svg = svgObj;
      l.anim.fillReveal = svgObj.hasFills;
      return l;
    };

    const buildImage = async (o, idx) => {
      let reg = null;
      try {
        const src = String(o.src);
        if (src.startsWith('data:')) reg = await SD.assets.registerDataURL(src);
        else { const blob = await (await fetch(src)).blob(); reg = await SD.assets.registerImage(new File([blob], o.name || 'image.png', { type: blob.type || 'image/png' })); }
      } catch (e) { warn.push(`layer ${idx}: image could not be loaded (${e.message || 'fetch failed'}) — skipped`); return null; }
      const m = Math.min(CW * 0.6 / reg.width, CH * 0.6 / reg.height, 1.5);
      const l = S.baseLayer('image', 0, 0, Math.round(reg.width * m), Math.round(reg.height * m), o.name || 'Image');
      l.image = { assetId: reg.id, nw: reg.width, nh: reg.height };
      l.anim.style = o.style || 'drawfill';
      return l;
    };

    const buildAudio = async (o, idx) => {
      if (!o.src) { warn.push(`layer ${idx}: audio layer needs a "src" (data-URL or URL) — skipped`); return null; }
      let reg = null;
      try {
        const src = String(o.src);
        if (src.startsWith('data:')) reg = await SD.assets.registerAudioDataURL(src, { name: o.name || 'Audio clip' });
        else { const blob = await (await fetch(src)).blob(); reg = await SD.assets.registerAudio(blob, { name: o.name || 'Audio clip' }); }
        if (!reg.duration) throw new Error('could not read audio duration');
      } catch (e) { warn.push(`layer ${idx}: audio could not be loaded (${e.message || 'fetch failed'}) — skipped`); return null; }
      const l = S.baseLayer('audio', 0, 0, 0, 0, o.name || 'Audio clip');
      l.audio = {
        assetId: reg.id,
        volume: U.clamp(num(o.volume) ? o.volume : 1, 0, 1),
        loop: !!o.loop,
        mediaDuration: Math.round(reg.duration * 100) / 100,
      };
      l.duration = U.clamp(num(o.duration) ? o.duration : reg.duration, 0.1, 600);
      return l;
    };

    const buildDrawing = (o, idx) => {
      if (!Array.isArray(o.strokes) || !o.strokes.length) { warn.push(`layer ${idx}: drawing has no strokes — skipped`); return null; }
      const norm = !!o.normalized;
      const strokes = [];
      let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
      for (const s of o.strokes) {
        if (!Array.isArray(s.pts) || s.pts.length < 4) continue;
        const pts = s.pts.map((v, i) => (norm ? v * (i % 2 ? CH : CW) : +v));
        for (let i = 0; i < pts.length; i += 2) { x0 = Math.min(x0, pts[i]); y0 = Math.min(y0, pts[i + 1]); x1 = Math.max(x1, pts[i]); y1 = Math.max(y1, pts[i + 1]); }
        strokes.push({ color: String(s.color || o.ink || '#222831'), width: num(s.width) ? U.clamp(s.width, 1, 80) : 7, alpha: num(s.alpha) ? U.clamp(s.alpha, 0.05, 1) : 1, pts });
      }
      if (!strokes.length) { warn.push(`layer ${idx}: drawing had no valid strokes — skipped`); return null; }
      const pad = 26; x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad);
      const l = S.baseLayer('drawing', x0, y0, (x1 + pad) - x0, (y1 + pad) - y0, o.name || 'Drawing');
      l.drawing = { strokes: strokes.map((s) => ({ color: s.color, width: s.width, alpha: s.alpha, pts: s.pts.map((v, i) => i % 2 ? v - y0 : v - x0) })) };
      l._jsonNoRepos = true; // keep authored coordinates
      return l;
    };

    // scenes
    let layerCount = 0;
    for (let si = 0; si < spec.scenes.length; si++) {
      const ss = spec.scenes[si] || {};
      const scene = S.newScene(ss.name || `Scene ${si + 1}`);
      // background: 'chalk' | '#1e2622' | {type:'chalk'} | {color:'#1e2622'}
      let bg = typeof ss.background === 'string' ? ss.background : (ss.background || {});
      if (typeof bg === 'string') bg = E.BG_DEFS[bg] ? { type: bg } : (/^#|^rgb|^hsl/i.test(bg) ? { color: bg } : { type: bg });
      if (bg.type) { if (E.BG_DEFS[bg.type]) scene.background.type = bg.type; else warn.push(`scene ${si + 1}: unknown background "${bg.type}" → white`); }
      if (bg.color && bg.color !== 'auto') { scene.background.type = 'color'; scene.background.color = String(bg.color); }
      if (ss.hand != null && HANDS.includes(ss.hand) && ss.hand !== 'inherit') scene.defaultHand = ss.hand;
      const tr = typeof ss.transition === 'string' ? { type: ss.transition } : (ss.transition || null);
      if (tr && tr.type) scene.transition.type = TRANSITIONS.includes(tr.type) ? tr.type : (warn.push(`scene ${si + 1}: unknown transition "${tr.type}" → fade`), 'fade');
      if (tr && num(tr.duration)) scene.transition.duration = U.clamp(tr.duration, 0.1, 5);
      if (num(ss.hold)) scene.holdAfter = U.clamp(ss.hold, 0, 15);
      if (ss.camera && Array.isArray(ss.camera.keys)) {
        scene.camera.enabled = ss.camera.enabled !== false && ss.camera.keys.length >= 1;
        scene.camera.keys = ss.camera.keys.filter((k) => num(k.t)).map((k) => ({ t: U.clamp(k.t, 0, 3600), x: num(k.x) ? k.x : 0.5, y: num(k.y) ? k.y : 0.5, zoom: num(k.zoom) ? U.clamp(k.zoom, 0.4, 4) : 1 }));
      }

      const layers = Array.isArray(ss.layers) ? ss.layers : [];
      let cursor = 0;
      for (let li = 0; li < layers.length; li++) {
        const o = layers[li] || {};
        let l = null;
        const type = o.type || (o.text != null ? 'text' : null);
        if (type === 'text') l = buildText(o, `${si + 1}.${li + 1}`);
        else if (type === 'icon') l = buildIcon(o, `${si + 1}.${li + 1}`);
        else if (type === 'shape') l = buildShape(o, `${si + 1}.${li + 1}`);
        else if (type === 'svg') l = await buildSvg(o, `${si + 1}.${li + 1}`);
        else if (type === 'image' || type === 'img') l = await buildImage(o, `${si + 1}.${li + 1}`);
        else if (type === 'drawing' || type === 'draw') l = buildDrawing(o, `${si + 1}.${li + 1}`);
        else if (type === 'audio' || type === 'sound') l = await buildAudio(o, `${si + 1}.${li + 1}`);
        else { warn.push(`scene ${si + 1}, layer ${li + 1}: unknown type "${o.type ?? '(missing)'}" — skipped`); continue; }
        if (!l) continue;
        mkCommon(l, o, `${si + 1}.${li + 1}`);
        if (!l._jsonNoRepos) place(l, o);
        delete l._jsonNoRepos;
        // sequencing: unless a delay was authored, chain layers in order.
        // audio underlays start with the scene and never shift the visual chain.
        if (!num(o.delay) && !num(o.start)) { l.start = l.type === 'audio' ? 0 : Math.round(cursor * 100) / 100; }
        if (!num(o.duration) && o.duration !== 0) l.duration = E.estimateDuration(p, l);
        if (l.type !== 'audio') cursor = l.start + l.duration + 0.25;
        scene.layers.push(l);
        layerCount++;
      }
      if (ss.autoCamera && scene.layers.length) {
        scene.camera = { enabled: true, keys: E.autoCamera(p, scene) };
      }
      p.scenes.push(scene);
    }
    if (!p.scenes.length) fail('No scenes could be built from this script.');
    if (!layerCount) warn.push('No layers were created — check the "layers" arrays.');

    // optional full-track voiceover: "voiceover": "<data-URL>" | {src, volume, start, name}
    if (spec.voiceover != null) {
      const vo = typeof spec.voiceover === 'string' ? { src: spec.voiceover } : (spec.voiceover || {});
      try {
        if (!vo.src) throw new Error('missing "src"');
        const src = String(vo.src);
        let reg;
        if (src.startsWith('data:')) reg = await SD.assets.registerAudioDataURL(src, { name: vo.name || 'Voiceover' });
        else { const blob = await (await fetch(src)).blob(); reg = await SD.assets.registerAudio(blob, { name: vo.name || 'Voiceover' }); }
        if (!reg.duration) throw new Error('could not read audio duration');
        p.voiceover = {
          assetId: reg.id,
          volume: U.clamp(num(vo.volume) ? vo.volume : 1, 0, 1),
          start: num(vo.start) ? Math.max(0, vo.start) : 0,
          name: (vo.name || reg.name || 'Voiceover'),
          mediaDuration: Math.round(reg.duration * 100) / 100,
        };
      } catch (e) { warn.push(`voiceover could not be loaded (${e.message || 'fetch failed'}) — ignored`); }
    }

    // atomic swap-in of the fully built project
    await S.createProject(name);
    S.project.scenes = p.scenes;
    S.project.canvas = p.canvas;
    S.project.voiceover = p.voiceover || null;
    S.project.name = name;
    S.project.activeSceneIdx = 0;
    S.project._cv++;
    S._undo = []; S._redo = []; S.editTime = 0; S.selection = new Set();
    await S.afterLoad('import');
    S.saveNow();
    return { name, scenes: p.scenes.length, layers: layerCount };
  }

  /* ───────── entry points ───────── */
  async function importFile(file) {
    let payload;
    try { payload = JSON.parse(await file.text()); }
    catch (e) { U.toast('That file is not valid JSON (' + e.message.slice(0, 80) + ')', 'bad'); return false; }
    // project backup round-trip
    if (payload && payload.app === 'swapdraws' && payload.project) return SD.state.importProjectFile(file);
    const warn = [];
    try {
      const res = await buildProject(payload, warn);
      if (warn.length) { console.warn('[SwapDraws JSON import]', warn); U.toast(`Imported "${res.name}" — ${res.scenes} scenes · ${res.layers} layers (${warn.length} warning${warn.length > 1 ? 's' : ''}, see console)`, 'ok'); }
      else U.toast(`Imported "${res.name}" — ${res.scenes} scenes · ${res.layers} layers 🎬`, 'ok');
      return true;
    } catch (e) {
      console.error('[SwapDraws JSON import]', e);
      U.toast('Import failed: ' + e.message, 'bad');
      return false;
    }
  }

  /* compact readable-script export of the current project (editable round trip) */
  function exportScript() {
    const p = SD.state.project, CW = p.canvas.width, CH = p.canvas.height;
    const px = (v, t) => Math.round((v / t) * 1000) / 1000;
    const audioSrc = (assetId) => {
      const meta = SD.assets.audioMetaSync(assetId);
      return (meta && meta.dataURL) || '(embedded audio — use project backup for fidelity)';
    };
    const layerOut = (l) => {
      if (l.type === 'audio' && l.audio) {
        return {
          type: 'audio', name: l.name, src: audioSrc(l.audio.assetId),
          delay: l.start, duration: Math.round(l.duration * 100) / 100,
          volume: l.audio.volume, loop: l.audio.loop || undefined,
        };
      }
      const o = { type: l.type, name: l.name, x: px(l.x + l.w / 2, CW), y: px(l.y + l.h / 2, CH), style: l.anim.style, delay: l.start, duration: Math.round(l.duration * 100) / 100 };
      if (l.anim.hand !== 'inherit') o.hand = l.anim.hand;
      if (l.type === 'text') Object.assign(o, { text: l.text.content, font: l.text.font, size: l.text.size, color: l.text.color, bold: l.text.bold, italic: l.text.italic, align: l.text.align, underline: l.text.underline });
      if (l.type === 'icon') Object.assign(o, { icon: l.icon.iconId, color: l.icon.color, sw: l.icon.sw });
      if (l.type === 'shape') Object.assign(o, { shape: l.shape.shapeId, color: l.shape.stroke, fill: l.shape.fill, strokeWidth: l.shape.sw });
      if (l.type === 'drawing') o.strokes = l.drawing.strokes;
      if (l.type === 'image') o.src = '(embedded image — use project backup for fidelity)';
      return o;
    };
    const spec = {
      swapdraws: 1, name: p.name,
      canvas: { aspect: p.canvas.aspect === 'custom' ? '16:9' : p.canvas.aspect, resolution: p.canvas.res },
      voiceover: p.voiceover ? {
        src: audioSrc(p.voiceover.assetId),
        volume: p.voiceover.volume, start: p.voiceover.start || undefined,
        name: p.voiceover.name,
      } : undefined,
      scenes: p.scenes.map((s) => ({
        name: s.name, background: { type: s.background.type, color: s.background.color },
        transition: { type: s.transition.type, duration: s.transition.duration }, hold: s.holdAfter,
        hand: s.defaultHand,
        camera: s.camera && s.camera.enabled ? { enabled: true, keys: s.camera.keys } : undefined,
        layers: s.layers.map(layerOut),
      })),
    };
    U.download(new Blob([JSON.stringify(spec, null, 2)], { type: 'application/json' }), (p.name || 'project').replace(/\s+/g, '-').toLowerCase() + '.script.json');
    U.toast('Readable script JSON downloaded', 'ok');
  }

  /* sample script — showcases the format using live library ids */
  function sampleScript() {
    const icons = Object.keys(SD.tools.ICONS);
    const icon = icons.includes('rocket') ? 'rocket' : icons[0];
    const shp = Object.keys(SD.tools.SHAPES);
    const shape = shp.find((s) => /curly/i.test(s)) || shp.find((s) => /arrowright/i.test(s)) || shp[0];
    return {
      swapdraws: 1,
      name: 'My JSON Video',
      canvas: { aspect: '16:9', resolution: 1080 },
      scenes: [
        {
          name: 'Intro', background: 'dots', hand: 'hand1',
          transition: { type: 'fade', duration: 0.6 }, hold: 0.6,
          layers: [
            { type: 'text', text: 'Made from pure JSON!', font: 'Caveat', size: 0.15, color: '#222831', y: 0.4, style: 'handwrite', underline: 'squiggle' },
            { type: 'text', text: 'no clicks needed at all', font: 'Patrick Hand', size: 0.06, bold: false, color: '#5b6572', y: 0.6, style: 'handwrite', delay: 2.2 },
            { type: 'icon', icon, color: '#e85d3d', x: 0.82, y: 0.32, size: 0.13, style: 'draw', delay: 3.2, duration: 1.4 },
          ],
        },
        {
          name: 'Idea', background: 'chalk', hand: 'hand3',
          transition: { type: 'wipe-left', duration: 0.7 }, hold: 0.8,
          camera: { enabled: true, keys: [{ t: 0, x: 0.3, y: 0.55, zoom: 1.7 }, { t: 2.6, x: 0.6, y: 0.5, zoom: 1.7 }, { t: 5, x: 0.5, y: 0.5, zoom: 1 }] },
          layers: [
            { type: 'text', text: 'Edit → import → export', font: 'Patrick Hand', size: 0.09, color: '#f4f2e8', x: 0.3, y: 0.55, style: 'chalk', duration: 2.4 },
            { type: 'shape', shape, color: '#ffd166', x: 0.63, y: 0.45, size: 0.18, style: 'draw', delay: 2.6, duration: 1.4, handRotate: true },
          ],
        },
        {
          name: 'Outro', background: 'white', transition: { type: 'zoom', duration: 0.8 }, hold: 1,
          layers: [
            { type: 'text', text: 'Thanks for watching!', font: 'Caveat', size: 0.16, color: '#222831', y: 0.5, style: 'handwrite', underline: 'highlight', duration: 2 },
          ],
        },
      ],
    };
  }
  function downloadSample() {
    U.download(new Blob([JSON.stringify(sampleScript(), null, 2)], { type: 'application/json' }), 'sample.swapdraws.json');
    U.toast('Sample script downloaded — try importing it back!', 'ok');
  }

  SD.jsonio = { importFile, exportScript, sampleScript, downloadSample, FORMAT_VERSION: 1 };
})();
