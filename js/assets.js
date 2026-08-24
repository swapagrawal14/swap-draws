/* SwapDraws — assets.js : hand artwork config, image asset store (IndexedDB), font loading */
(function () {
  const SD = (window.SD = window.SD || {});
  const U = SD.util;

  /* ────────────────────────────────────────────────
     Hand artwork. Adapted from Inkplainer (Apache 2.0) — see assets/hands/LICENSE-inkplainer-assets.
     Each entry: 1080p file, natural size, and the pen-tip coordinate inside the image.
     drawScale: drawn height = canvasHeight * drawScale (matches whiteboard-style proportions).
     ──────────────────────────────────────────────── */
  const HANDS = {
    none: { name: 'No hand', none: true },
    hand1: { name: 'Pen', file: 'assets/hands/hand1-1080p.png', w: 648, h: 1152, tipX: 325, tipY: 1, penAngle: -90 },
    hand2: { name: 'Marker', file: 'assets/hands/hand2-1080p.png', w: 648, h: 1152, tipX: 249, tipY: 0, penAngle: -90 },
    hand3: { name: ' pencil', file: 'assets/hands/hand3-1080p.png', w: 648, h: 1152, tipX: 196, tipY: 0, penAngle: -90 },
    hand4: { name: 'Stylus', file: 'assets/hands/hand4-1080p.png', w: 648, h: 1152, tipX: 140, tipY: 904, penAngle: 120 },
  };
  // vertical (9:16) variants — pens point up-left; nibs measured at the extreme corner
  const HANDS_V = {
    hand1: { file: 'assets/hands/hand1vertical-1080p.png', w: 1080, h: 1920, tipX: 20, tipY: 8, penAngle: -118 },
    hand2: { file: 'assets/hands/hand2vertical-1080p.png', w: 1080, h: 1920, tipX: 14, tipY: 12, penAngle: -118 },
    hand3: { file: 'assets/hands/hand3vertical-1080p.png', w: 1080, h: 1920, tipX: 8, tipY: 4, penAngle: -118 },
    hand4: { file: 'assets/hands/hand4vertical-1080p.png', w: 648, h: 1152, tipX: 140, tipY: 904, penAngle: 120 },
  };

  const handImgs = {}; // cache: key -> {img, conf}
  function handConf(style, portrait) {
    const base = HANDS[style];
    if (!base || base.none) return null;
    const v = portrait ? HANDS_V[style] : null;
    return v ? { ...base, ...v } : base;
  }
  function handKey(style, portrait) { return style + (portrait ? '|v' : ''); }

  async function loadHand(style, portrait) {
    const conf = handConf(style, portrait);
    if (!conf) return null;
    const key = handKey(style, portrait);
    if (handImgs[key]) return handImgs[key];
    const img = new Image();
    img.src = conf.file;
    await new Promise((res) => { img.onload = res; img.onerror = res; });
    handImgs[key] = img.naturalWidth ? { img, conf } : null;
    return handImgs[key];
  }
  function getHandSync(style, portrait) {
    const h = handImgs[handKey(style, portrait)];
    return h || null;
  }
  async function preloadHands() {
    const jobs = [];
    for (const s of Object.keys(HANDS)) if (!HANDS[s].none) { jobs.push(loadHand(s, false)); jobs.push(loadHand(s, true)); }
    await Promise.all(jobs);
  }

  /* ────────────────────────────────────────────────
     IndexedDB blob store for user images
     ──────────────────────────────────────────────── */
  let dbPromise = null;
  function db() {
    if (!dbPromise) dbPromise = new Promise((res, rej) => {
      const req = indexedDB.open('swapdraws', 1);
      req.onupgradeneeded = () => { if (!req.result.objectStoreNames.contains('assets')) req.result.createObjectStore('assets'); };
      req.onsuccess = () => res(req.result);
      req.onerror = () => rej(req.error);
    });
    return dbPromise;
  }
  async function idbPut(key, blob) {
    const d = await db();
    return new Promise((res, rej) => {
      const tx = d.transaction('assets', 'readwrite');
      tx.objectStore('assets').put(blob, key);
      tx.oncomplete = res; tx.onerror = () => rej(tx.error);
    });
  }
  async function idbGet(key) {
    const d = await db();
    return new Promise((res, rej) => {
      const req = d.transaction('assets').get(key);
      req.onsuccess = () => res(req.result || null);
      req.onerror = () => rej(req.error);
    });
  }
  async function idbDel(key) {
    const d = await db();
    return new Promise((res) => {
      const tx = d.transaction('assets', 'readwrite');
      tx.objectStore('assets').delete(key);
      tx.oncomplete = res; tx.onerror = res;
    });
  }

  const imgCache = new Map(); // assetId -> HTMLImageElement (loaded)
  const pending = new Map();

  /** register a user image (blob). returns {id, width, height} */
  async function registerImage(blob) {
    const id = U.uid('img');
    await idbPut(id, blob);
    const img = await blobToImage(blob);
    imgCache.set(id, img);
    return { id, width: img.naturalWidth, height: img.naturalHeight };
  }
  function blobToImage(blob) {
    return new Promise((res, rej) => {
      const url = URL.createObjectURL(blob);
      const img = new Image();
      img.onload = () => { URL.revokeObjectURL(url); res(img); };
      img.onerror = (e) => { URL.revokeObjectURL(url); rej(e); };
      img.src = url;
    });
  }
  /** get a loaded HTMLImageElement for an asset id (cached). */
  async function getImage(id) {
    if (imgCache.has(id)) return imgCache.get(id);
    if (pending.has(id)) return pending.get(id);
    const p = (async () => {
      const blob = await idbGet(id);
      if (!blob) throw new Error('missing asset ' + id);
      const img = await blobToImage(blob);
      imgCache.set(id, img);
      pending.delete(id);
      return img;
    })();
    pending.set(id, p);
    return p;
  }
  function getImageSync(id) { return imgCache.get(id) || null; }
  async function deleteImage(id) { imgCache.delete(id); await idbDel(id); }

  /** rehydrate from project file import: store a dataURL as an asset */
  async function registerDataURL(dataURL) {
    const blob = await (await fetch(dataURL)).blob();
    return registerImage(blob);
  }

  /* ────────────────────────────────────────────────
     Audio assets (JSON voiceovers + per-scene clips).
     Blobs live in the same IndexedDB 'assets' store as images;
     HTMLAudioElements / decoded bytes are cached per asset id.
     ──────────────────────────────────────────────── */
  const audioCache = new Map(); // assetId -> { blob, meta:{name,mime,dataURL,duration}, el?, objURL?, bytes? }

  function probeAudioDuration(rec) {
    return new Promise((res, rej) => {
      const url = rec.objURL || (rec.objURL = URL.createObjectURL(rec.blob));
      const a = new Audio();
      a.preload = 'metadata';
      const to = setTimeout(() => finish(new Error('audio metadata timeout')), 5000);
      function finish(err, d) { clearTimeout(to); err ? rej(err) : res(d); }
      a.onloadedmetadata = () => (isFinite(a.duration) && a.duration > 0 ? finish(null, a.duration) : finish(new Error('unreadable audio duration')));
      a.onerror = () => finish(new Error('unsupported or corrupt audio'));
      a.src = url;
    });
  }

  /** register an audio blob. returns {id, duration, name} — throws if unreadable */
  async function registerAudio(blob, opts = {}) {
    const id = U.uid('aud');
    const rec = { blob, meta: { name: opts.name || 'Audio', mime: blob.type || 'audio/mpeg', dataURL: opts.dataURL || null, duration: 0 } };
    audioCache.set(id, rec);
    try { rec.meta.duration = await probeAudioDuration(rec); }
    catch (e) { audioCache.delete(id); throw e; }
    await idbPut(id, blob);
    return { id, duration: rec.meta.duration, name: rec.meta.name };
  }
  /** register audio from a data-URL (JSON scripts). keeps the dataURL for readable re-export */
  async function registerAudioDataURL(dataURL, opts = {}) {
    const blob = await (await fetch(dataURL)).blob();
    return registerAudio(blob, { ...opts, dataURL });
  }
  /** restore from a project backup: carries saved meta (name/duration) */
  async function registerAudioStored(dataURL, meta = {}) {
    const blob = await (await fetch(dataURL)).blob();
    const id = U.uid('aud');
    const rec = { blob, meta: { name: meta.name || 'Audio', mime: blob.type || 'audio/mpeg', dataURL, duration: +(meta.duration) || 0 } };
    audioCache.set(id, rec);
    await idbPut(id, blob);
    if (!rec.meta.duration) rec.meta.duration = await probeAudioDuration(rec).catch(() => 0);
    return { id, duration: rec.meta.duration, name: rec.meta.name };
  }
  /** load (or lazily restore from IDB) an audio record */
  async function loadAudioRec(id) {
    if (audioCache.has(id)) return audioCache.get(id);
    const blob = await idbGet(id);
    if (!blob) throw new Error('missing audio asset ' + id);
    const rec = { blob, meta: { name: 'Audio', mime: blob.type || 'audio/mpeg', dataURL: null, duration: 0 } };
    audioCache.set(id, rec);
    rec.meta.duration = await probeAudioDuration(rec).catch(() => 0);
    return rec;
  }
  /** cached HTMLAudioElement for app playback */
  async function ensureAudio(id) {
    const rec = await loadAudioRec(id);
    if (!rec.el) { const el = new Audio(); el.preload = 'auto'; el.src = rec.objURL || (rec.objURL = URL.createObjectURL(rec.blob)); rec.el = el; }
    return rec.el;
  }
  function audioElSync(id) { const rec = audioCache.get(id); return (rec && rec.el) || null; }
  function audioMetaSync(id) { const rec = audioCache.get(id); return rec ? rec.meta : null; }
  /** raw bytes for WebAudio decodeAudioData at export time */
  async function audioArrayBuffer(id) {
    const rec = await loadAudioRec(id);
    if (!rec.bytes) rec.bytes = await rec.blob.arrayBuffer();
    return rec.bytes;
  }

  /* ── fonts ── */
  const UI_FONTS = [
    { family: 'Caveat', label: 'Caveat · handwritten', weights: '600' },
    { family: 'Patrick Hand', label: 'Patrick Hand · natural', weights: '400' },
    { family: 'Permanent Marker', label: 'Permanent Marker · bold', weights: '400' },
    { family: 'Shadows Into Light Two', label: 'Shadows · light hand', weights: '400' },
    { family: 'Kalam', label: 'Kalam · casual pen', weights: '400' },
    { family: 'Nunito', label: 'Nunito · friendly sans', weights: '700' },
    { family: 'DM Sans', label: 'DM Sans · clean sans', weights: '500' },
    { family: 'Merriweather', label: 'Merriweather · serif', weights: '700' },
    { family: 'Space Mono', label: 'Space Mono · typewriter', weights: '400' },
  ];
  async function ensureFontsLoaded() {
    try {
      const jobs = [];
      for (const f of UI_FONTS) {
        jobs.push(document.fonts.load(`${f.weights} 40px "${f.family}"`));
        jobs.push(document.fonts.load(`italic ${f.weights} 40px "${f.family}"`));
      }
      jobs.push(document.fonts.load('900 40px "Nunito"'));
      await Promise.race([Promise.all(jobs), new Promise((r) => setTimeout(r, 3500))]);
    } catch (e) { /* offline font fallback is fine */ }
  }

  SD.assets = {
    HANDS, handConf, loadHand, getHandSync, preloadHands,
    registerImage, getImage, getImageSync, deleteImage, registerDataURL, blobToImage,
    registerAudio, registerAudioDataURL, registerAudioStored,
    ensureAudio, audioElSync, audioMetaSync, audioArrayBuffer, loadAudioRec,
    UI_FONTS, ensureFontsLoaded,
  };
})();
