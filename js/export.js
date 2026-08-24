/* SwapDraws — export.js : WebM/MP4 recording with mic voiceover + music,
   GIF encoding (built-in GIF89a/LZW), PNG snapshots, pencil-scratch SFX */
(function () {
  const SD = (window.SD = window.SD || {});
  const U = SD.util;
  const A = () => SD.state;
  const E = () => SD.engine;

  let fmt = 'webm';
  let running = null; // active export session (for cancel)

  const $ = (id) => U.$('#' + id);

  function init() {
    // format cards
    U.$$('.fmt-card').forEach((c) => c.addEventListener('click', () => {
      if (c.classList.contains('disabled')) return;
      fmt = c.dataset.fmt;
      U.$$('.fmt-card').forEach((x) => x.classList.toggle('active', x === c));
      syncSetup();
    }));
    if (!MediaRecorder.isTypeSupported('video/mp4')) {
      $('fmtMp4').classList.add('disabled');
      $('fmtMp4').title = 'MP4 needs Chrome or Edge — use WebM instead';
    }
    $('expStart').addEventListener('click', startExport);
    $('expCancel').addEventListener('click', cancelExport);
    $('expAgain').addEventListener('click', () => show('setup'));
    $('expMic').addEventListener('change', (e) => { $('micVolRow').hidden = !e.target.checked; syncSetup(); });
    $('expMusic').addEventListener('change', (e) => { $('musicRows').hidden = !e.target.checked; syncSetup(); });
    $('expMusicPick').addEventListener('click', () => $('expMusicFile').click());
    $('expMusicFile').addEventListener('change', (e) => {
      const f = e.target.files[0];
      if (f) { musicFile = f; $('musicName').textContent = '🎵 ' + f.name; }
    });
    ['expFps', 'expQuality', 'expScale', 'expScope'].forEach((id) => $(id).addEventListener('change', syncSetup));
    $('btnSnapshot').addEventListener('click', () => snapshotPNG());
  }
  let musicFile = null;

  function show(which) {
    $('exportSetup').hidden = which !== 'setup';
    $('exportProgress').hidden = which !== 'progress';
    $('exportDone').hidden = which !== 'done';
  }

  function openDialog() {
    $('exportModal').hidden = false;
    show('setup');
    $('expName').value = (A().project.name || 'swapdraws-animation').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-').toLowerCase() || 'swapdraws-animation';
    syncSetup();
  }
  function closeDialog() {
    if (running) cancelExport();
    $('exportModal').hidden = true;
  }

  /* ── export sizing helpers ── */
  function scopeDuration(scope) {
    const p = A().project;
    if (scope === 'scene') return E().sceneDuration(p, p.scenes[p.activeSceneIdx]);
    return E().projectDuration(p);
  }
  function outDims(scale) {
    const p = A().project;
    let w = Math.round(p.canvas.width * scale), h = Math.round(p.canvas.height * scale);
    w = Math.min(w, 4096); h = Math.min(h, 4096);
    return { w: w - (w % 2), h: h - (h % 2) };
  }
  const BPS = { high: 12_000_000, medium: 6_000_000, low: 2_500_000 };

  function syncSetup() {
    const scope = $('expScope').value, scale = +$('expScale').value;
    const dur = scopeDuration(scope);
    const { w, h } = outDims(scale);
    let est = '';
    if (fmt === 'gif') est = `Estimate: ~${Math.max(1, Math.round(dur * 12))} frames @ 12fps, ~${(dur * w * h * 0.09 / 1048576).toFixed(1)} MB`;
    else if (fmt === 'png') est = `Estimate: one PNG frame at playhead, ${w}×${h}`;
    else est = `Estimate: ${U.fmtTime(dur)}s video → ~${(BPS[$('expQuality').value] * dur / 8 / 1048576).toFixed(1)} MB (${w}×${h} @ ${$('expFps').value}fps)`;
    $('expEstimate').textContent = est;
  }

  /* ═══════ PNG snapshot ═══════ */
  function snapshotPNG(t) {
    const p = A().project;
    const c = U.makeCanvas(p.canvas.width, p.canvas.height);
    E().renderProjectFrame(p, t != null ? t : currentGlobalTime(), c.getContext('2d'), { showHand: true });
    c.toBlob((b) => { U.download(b, safeName() + '.png'); U.toast('Frame saved as PNG', 'ok'); }, 'image/png');
  }
  function safeName() { return ($('expName').value || 'swapdraws-animation').replace(/[^\w\-]+/g, '-'); }
  function currentGlobalTime() {
    const S = A();
    const starts = E().sceneStarts(S.project);
    return starts[S.project.activeSceneIdx] + S.editTime;
  }

  /* ═══════ audio graph ═══════ */
  async function buildAudio(opts, durSec) {
    if (!opts.mic && !opts.music && !opts.sfxNeeded) return null;
    const AC = window.AudioContext || window.webkitAudioContext;
    const ac = new AC();
    const dest = ac.createMediaStreamDestination();
    const nodes = { ac, dest, musicEl: null, micStream: null, gains: [] };
    if (opts.mic) {
      try {
        nodes.micStream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
        const src = ac.createMediaStreamSource(nodes.micStream);
        const g = ac.createGain(); g.gain.value = opts.micVol;
        src.connect(g).connect(dest);
        nodes.gains.push(g);
      } catch (e) { U.toast('Mic unavailable — recording without voiceover', 'bad'); }
    }
    if (opts.music && musicFile) {
      const el = new Audio();
      el.src = URL.createObjectURL(musicFile);
      el.loop = opts.musicLoop;
      await new Promise((res) => { el.oncanplaythrough = res; el.onerror = res; setTimeout(res, 2500); });
      const src = ac.createMediaElementSource(el);
      const g = ac.createGain(); g.gain.value = opts.musicVol;
      src.connect(g).connect(dest);
      nodes.musicEl = el;
      nodes.gains.push(g);
    }
    if (opts.sfxNeeded) {
      // pencil scratch: looping filtered noise, gain driven per-frame
      const len = ac.sampleRate * 2;
      const buf = ac.createBuffer(1, len, ac.sampleRate);
      const d = buf.getChannelData(0);
      let last = 0;
      for (let i = 0; i < len; i++) { const w = Math.random() * 2 - 1; last = (last + 0.03 * w) / 1.03; d[i] = (w * 0.35 + last * 1.8) * 0.5; }
      const src = ac.createBufferSource();
      src.buffer = buf; src.loop = true;
      const bp = ac.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 4200; bp.Q.value = 0.9;
      const g = ac.createGain(); g.gain.value = 0;
      src.connect(bp).connect(g).connect(dest);
      src.start();
      nodes.scratchGain = g;
    }
    if (ac.state === 'suspended') await ac.resume();
    return nodes;
  }
  function stopAudio(nodes) {
    if (!nodes) return;
    try { nodes.musicEl && nodes.musicEl.pause(); } catch {}
    try { nodes.micStream && nodes.micStream.getTracks().forEach((t) => t.stop()); } catch {}
    try { nodes.ac.close(); } catch {}
  }
  function anySfxLayer(scope) {
    const p = A().project;
    const scenes = scope === 'scene' ? [p.scenes[p.activeSceneIdx]] : p.scenes;
    return scenes.some((s) => s.layers.some((l) => l.anim.sfx));
  }
  function sfxActiveAt(t, scope) {
    const p = A().project;
    const { idx } = E().timeToScene(p, t);
    const scene = p.scenes[idx];
    if (scope === 'scene' && idx !== p.activeSceneIdx) return false;
    return scene.layers.some((l) => l.anim.sfx && t > 0 && (t) >= 0 && (() => {
      const starts = E().sceneStarts(p);
      const local = t - starts[idx];
      const p2 = (local - l.start) / Math.max(0.01, l.duration);
      return p2 > 0.01 && p2 < 0.97 && ['draw', 'chalk', 'sketch', 'handwrite', 'drawfill'].includes(l.anim.style);
    })());
  }

  /* ═══════ main export ═══════ */
  async function startExport() {
    if (running) return;
    const S = A();
    if (!S.project.scenes.some((s) => s.layers.length)) { U.toast('Add some content first!', 'bad'); return; }
    SD.stage.pause();
    const scope = $('expScope').value;
    if (fmt === 'png') { snapshotPNG(); closeDialog(); return; }
    show('progress');
    try {
      if (fmt === 'gif') await exportGIF(scope);
      else await exportVideo(scope);
    } catch (e) {
      console.error(e);
      U.toast('Export failed: ' + (e.message || e), 'bad');
      show('setup');
      running = null;
    }
  }

  async function exportVideo(scope) {
    if (running) return;
    const S = A();
    const fps = +$('expFps').value;
    const scale = +$('expScale').value;
    const { w, h } = outDims(scale);
    const dur = scopeDuration(scope);
    const total = Math.max(1, Math.round(dur * fps));
    const mime = fmt === 'mp4' ? 'video/mp4' : (MediaRecorder.isTypeSupported('video/webm;codecs=vp9') ? 'video/webm;codecs=vp9' : 'video/webm');
    const bps = BPS[$('expQuality').value] * (scale >= 1.5 ? 1.6 : 1);

    const canvas = U.makeCanvas(w, h);
    const ctx = canvas.getContext('2d');
    // deterministic pacing needs requestFrame; fall back to free-running capture
    const probe = canvas.captureStream(0);
    const canReq = !!(probe.getVideoTracks()[0] && probe.getVideoTracks()[0].requestFrame);
    const stream = canReq ? probe : canvas.captureStream(fps);
    const vtrack = stream.getVideoTracks()[0];

    const audioOpts = {
      mic: $('expMic').checked, micVol: +$('micVol').value / 100,
      music: $('expMusic').checked, musicLoop: $('musicLoop').checked, musicVol: +$('musicVol').value / 100,
      sfxNeeded: anySfxLayer(scope),
    };
    let audio = null;
    try { audio = await buildAudio(audioOpts, dur); } catch (e) { console.warn(e); }
    let recStream = stream;
    if (audio && audio.dest.stream.getAudioTracks().length) {
      recStream = new MediaStream([vtrack, ...audio.dest.stream.getAudioTracks()]);
    }

    const rec = new MediaRecorder(recStream, { mimeType: mime, videoBitsPerSecond: bps, audioBitsPerSecond: 192000 });
    const chunks = [];
    rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
    const stopped = new Promise((res) => { rec.onstop = res; });

    // countdown
    $('expStatus').textContent = audioOpts.mic ? 'Get ready to narrate…' : 'Starting…';
    for (let i = 3; i >= 1; i--) { $('expStatus').textContent = `Starting in ${i}…`; await sleep(650); }
    if (running === 'cancel') throw new Error('cancelled');

    const scopeOffset = scope === 'scene' ? E().sceneStarts(S.project)[S.project.activeSceneIdx] : 0;
    const session = { cancelled: false };
    running = session;

    rec.start(250);
    if (audio && audio.musicEl) { try { audio.musicEl.currentTime = 0; audio.musicEl.play(); } catch {} }
    const t0 = performance.now();
    let frames = 0;
    const frameInterval = 1000 / fps;
    let nextSlot = performance.now();

    await new Promise((resolve, reject) => {
      const step = () => {
        if (session.cancelled) { resolve(); return; }
        if (frames >= total) { resolve(); return; }
        const t = scopeOffset + frames / fps;
        try {
          ctx.setTransform(1, 0, 0, 1, 0, 0);
          ctx.clearRect(0, 0, w, h);
          ctx.scale(w / S.project.canvas.width, h / S.project.canvas.height);
          E().renderProjectFrame(S.project, t, ctx, { showHand: true, forExport: true });
        } catch (e) { reject(e); return; }
        if (audio && audio.scratchGain) {
          const target = sfxActiveAt(t, scope) ? 0.4 : 0;
          audio.scratchGain.gain.setTargetAtTime(target, audio.ac.currentTime, 0.06);
        }
        if (vtrack.requestFrame) vtrack.requestFrame();
        frames++;
        const elapsed = performance.now() - t0;
        const pct = frames / total;
        $('expBar').style.width = (pct * 100).toFixed(1) + '%';
        const eta = elapsed / Math.max(0.01, pct) - elapsed;
        $('expStatus').textContent = `Recording frame ${frames}/${total}`;
        $('expEta').textContent = `${U.fmtTime(frames / fps)} of ${U.fmtTime(dur)} · ~${Math.ceil(eta / 1000)}s left`;
        nextSlot += frameInterval;
        const delay = Math.max(0, nextSlot - performance.now());
        setTimeout(step, delay);
      };
      step();
    });

    rec.stop();
    await stopped;
    stopAudio(audio);
    running = null;

    if (session.cancelled) { show('setup'); U.toast('Export cancelled', 'bad'); return; }
    let blob = new Blob(chunks, { type: mime.split(';')[0] });
    if (blob.type.includes('webm')) {
      try { blob = await patchWebMDuration(blob, frames / fps); } catch (e) { console.warn('webm duration patch skipped', e); }
    }
    finishExport(blob, '.' + (fmt === 'mp4' ? 'mp4' : 'webm'), `${U.fmtTime(dur)}s · ${w}×${h} @ ${fps}fps`);
  }

  /* ═══════ WebM EBML Duration patch ═══════
     MediaRecorder produces a *live* WebM stream: the Segment Info usually has
     no Duration element (and often an unknown Segment size), so players report
     an unknown duration. We compute the exact duration (frames/fps) and write
     it into the EBML Info — patching the existing Duration element in place,
     or inserting one (bumping ancestor sizes when they are not unknown). */
  async function patchWebMDuration(blob, durationSec) {
    const buf = new Uint8Array(await blob.arrayBuffer());
    const readVint = (o, keepMarker) => {
      if (o >= buf.length) return null;
      const first = buf[o];
      let len = 1;
      while (len <= 8 && !(first & (0x80 >> (len - 1)))) len++;
      if (len > 8 || o + len > buf.length) return null;
      let val = keepMarker ? first : (first & (0xFF >> len));
      for (let i = 1; i < len; i++) val = val * 256 + buf[o + i];
      return { len, val };
    };
    const isUnknown = (sz) => sz.val === Math.pow(2, 7 * sz.len) - 1;
    const ID = { Segment: 0x18538067, Info: 0x1549A966, TimecodeScale: 0x2AD7B1, Duration: 0x4489, Cluster: 0x1F43B675, Tracks: 0x1654AE6B };

    // level 0: skip EBML header, expect Segment
    let el = readVint(0, true);
    if (!el || el.val !== 0x1A45DFA3) return blob;
    const ebmlSize = readVint(el.len);
    if (!ebmlSize) return blob;
    let pos = el.len + ebmlSize.len + ebmlSize.val;
    el = readVint(pos, true);
    if (!el || el.val !== ID.Segment) return blob;
    const segSizeOff = pos + el.len;
    const segSize = readVint(segSizeOff);
    if (!segSize) return blob;
    pos = segSizeOff + segSize.len;
    const segUnknown = isUnknown(segSize);
    const segEnd = segUnknown ? buf.length : pos + segSize.val;

    // level 1: find Info (stop at first Cluster)
    let infoOff = -1, infoSize = null, infoSizeOff = 0;
    while (pos + 4 < segEnd && pos + 4 < buf.length) {
      const id = readVint(pos, true);
      if (!id) break;
      const sz = readVint(pos + id.len);
      if (!sz) break;
      if (id.val === ID.Info) { infoOff = pos + id.len + sz.len; infoSize = sz; infoSizeOff = pos + id.len; break; }
      if (id.val === ID.Cluster) break;
      if (isUnknown(sz)) break;
      pos = pos + id.len + sz.len + sz.val;
    }
    if (infoOff < 0) return blob;
    const infoUnknown = isUnknown(infoSize);
    const infoEnd = infoUnknown ? Math.min(segEnd, buf.length) : infoOff + infoSize.val;

    // inside Info: read TimecodeScale + locate Duration
    let scale = 1000000, durOff = -1, durLen = 0, tailOff = -1;
    let p = infoOff;
    while (p + 3 < infoEnd) {
      const id = readVint(p, true);
      if (!id) break;
      const sz = readVint(p + id.len);
      if (!sz) break;
      const dataOff = p + id.len + sz.len;
      if (dataOff + sz.val > buf.length) break;
      if (id.val === ID.TimecodeScale && sz.val <= 8) { let v = 0; for (let i = 0; i < sz.val; i++) v = v * 256 + buf[dataOff + i]; if (v > 0) scale = v; }
      if (id.val === ID.Duration) { durOff = dataOff; durLen = sz.val; }
      tailOff = dataOff + sz.val;
      p = tailOff;
      if (durOff >= 0) break;
    }

    const durVal = durationSec * 1e9 / scale;
    if (durOff >= 0 && (durLen === 8 || durLen === 4)) {
      const out = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
      if (durLen === 8) out.setFloat64(durOff, durVal, false); else out.setFloat32(durOff, durVal, false);
      return new Blob([buf], { type: blob.type });
    }

    // insert a new Duration element (2-byte id + 1-byte size + 8-byte double)
    if (tailOff < 0 || tailOff > infoEnd) return blob;
    const insertAt = tailOff;
    const addLen = 11;
    // Info size must be expressible in the same VINT length
    if (infoUnknown) return blob; // extremely unlikely from MediaRecorder
    const newInfoSize = infoSize.val + addLen;
    if (newInfoSize >= Math.pow(2, 7 * infoSize.len) - 1) return blob;
    const merged = new Uint8Array(buf.length + addLen);
    merged.set(buf.subarray(0, insertAt), 0);
    merged[insertAt] = 0x44; merged[insertAt + 1] = 0x89; merged[insertAt + 2] = 0x88;
    const dv = new DataView(merged.buffer);
    dv.setFloat64(insertAt + 3, durVal, false);
    merged.set(buf.subarray(insertAt), insertAt + addLen);
    // rewrite Info size (same VINT length, set marker bit)
    const len = infoSize.len;
    let tmp = newInfoSize;
    for (let i = len - 1; i >= 0; i--) { merged[infoSizeOff + i] = tmp & 0xFF; tmp >>= 8; }
    merged[infoSizeOff] |= (0x80 >> (len - 1));
    // rewrite Segment size if known and it still fits
    if (!segUnknown) {
      const newSegSize = segSize.val + addLen;
      if (newSegSize < Math.pow(2, 7 * segSize.len) - 1) {
        let t2 = newSegSize;
        for (let i = segSize.len - 1; i >= 0; i--) { merged[segSizeOff + i] = t2 & 0xFF; t2 >>= 8; }
        merged[segSizeOff] |= (0x80 >> (segSize.len - 1));
      }
    }
    return new Blob([merged], { type: blob.type });
  }

  /* ═══════ GIF ═══════ */
  async function exportGIF(scope) {
    if (running) return;
    const S = A();
    const fps = 12;
    const scale = +$('expScale').value;
    let { w, h } = outDims(scale);
    const maxW = 640;
    if (w > maxW) { h = Math.round(h * maxW / w); w = maxW; }
    h -= h % 2; w -= w % 2;
    const dur = scopeDuration(scope);
    const total = Math.max(2, Math.round(dur * fps));
    const scopeOffset = scope === 'scene' ? E().sceneStarts(S.project)[S.project.activeSceneIdx] : 0;
    const session = { cancelled: false };
    running = session;

    const canvas = U.makeCanvas(w, h);
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const enc = new GifEncoder(w, h, true);
    enc.writeHeader();
    enc.setRepeat(0);

    for (let f = 0; f < total; f++) {
      if (session.cancelled) { running = null; show('setup'); return; }
      const t = scopeOffset + f / fps;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, w, h);
      ctx.scale(w / S.project.canvas.width, h / S.project.canvas.height);
      E().renderProjectFrame(S.project, t, ctx, { showHand: true, forExport: true });
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      const img = ctx.getImageData(0, 0, w, h);
      enc.addFrame(img.data, Math.round(100 / fps), f === 0);
      if (f % 4 === 0) {
        $('expBar').style.width = ((f / total) * 100).toFixed(1) + '%';
        $('expStatus').textContent = `Encoding GIF frame ${f}/${total}`;
        $('expEta').textContent = `${U.fmtTime(f / fps)} of ${U.fmtTime(dur)}`;
        await sleep(0);
      }
    }
    const bytes = enc.finish();
    running = null;
    const blob = new Blob([bytes], { type: 'image/gif' });
    finishExport(blob, '.gif', `${total} frames · ${w}×${h} @ ${fps}fps`);
  }

  /* ── shared finish/cancel ── */
  function finishExport(blob, ext, info) {
    show('done');
    $('expDoneInfo').textContent = `${info} → ${U.fmtBytes(blob.size)}`;
    const dl = $('expDownload');
    dl.onclick = () => { U.download(blob, safeName() + ext); };
    dl.textContent = '⬇ Download ' + ext;
    $('expSaveFrame').onclick = () => {
      const p = A().project;
      const dur = scopeDuration($('expScope').value);
      snapshotPNG(scopeDuration($('expScope').value) - 0.05);
    };
  }
  function cancelExport() { if (running && running !== 'cancel') running.cancelled = true; running = running || 'cancel'; }
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  /* ═══════ GIF89a encoder (global 216-color web palette + error diffusion) ═══════ */
  function GifEncoder(w, h, dither) {
    const out = [];
    const push = (...bytes) => { for (const b of bytes) out.push(b & 255); };
    const short = (v) => push(v & 255, (v >> 8) & 255);
    // 6×6×6 web-safe palette
    const palette = [];
    for (let r = 0; r < 6; r++) for (let g = 0; g < 6; g++) for (let b = 0; b < 6; b++) palette.push(r * 51, g * 51, b * 51);
    while (palette.length < 256 * 3) palette.push(0);
    const palIndex = (r, g, b) => Math.min(5, Math.round(r / 51)) * 36 + Math.min(5, Math.round(g / 51)) * 6 + Math.min(5, Math.round(b / 51));

    function quantize(px) {
      const idx = new Uint8Array(w * h);
      if (!dither) {
        for (let i = 0; i < w * h; i++) idx[i] = palIndex(px[i * 4], px[i * 4 + 1], px[i * 4 + 2]);
        return idx;
      }
      // Floyd–Steinberg
      const buf = new Float32Array(w * h * 3);
      for (let i = 0; i < w * h; i++) { buf[i * 3] = px[i * 4]; buf[i * 3 + 1] = px[i * 4 + 1]; buf[i * 3 + 2] = px[i * 4 + 2]; }
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 3;
        const r = buf[i], g = buf[i + 1], b = buf[i + 2];
        const pi = palIndex(r, g, b);
        idx[y * w + x] = pi;
        const nr = (pi / 36 | 0) * 51, ng = ((pi % 36) / 6 | 0) * 51, nb = (pi % 6) * 51;
        const er = r - nr, eg = g - ng, eb = b - nb;
        const spread = (xx, yy, f) => {
          if (xx < 0 || xx >= w || yy >= h) return;
          const j = (yy * w + xx) * 3;
          buf[j] += er * f; buf[j + 1] += eg * f; buf[j + 2] += eb * f;
        };
        spread(x + 1, y, 7 / 16); spread(x - 1, y + 1, 3 / 16); spread(x, y + 1, 5 / 16); spread(x + 1, y + 1, 1 / 16);
      }
      return idx;
    }

    function lzw(indices, minCodeSize) {
      const bytes = [];
      let cur = 0, curBits = 0;
      const emit = (code, size) => {
        cur |= code << curBits; curBits += size;
        while (curBits >= 8) { bytes.push(cur & 255); cur >>= 8; curBits -= 8; }
      };
      const CLEAR = 1 << minCodeSize, EOI = CLEAR + 1;
      let dict, next, codeSize;
      const reset = () => { dict = new Map(); next = EOI + 1; codeSize = minCodeSize + 1; };
      reset();
      emit(CLEAR, codeSize);
      let prefix = indices[0];
      for (let i = 1; i < indices.length; i++) {
        const k = indices[i];
        const key = (prefix << 8) | k;
        if (dict.has(key)) { prefix = dict.get(key); continue; }
        emit(prefix, codeSize);
        dict.set(key, next++);
        if (next - 1 === (1 << codeSize) && codeSize < 12) codeSize++;
        if (next >= 4095) { emit(CLEAR, codeSize); reset(); }
        prefix = k;
      }
      emit(prefix, codeSize);
      emit(EOI, codeSize);
      if (curBits > 0) bytes.push(cur & 255);
      return bytes;
    }

    return {
      writeHeader() {
        for (const ch of 'GIF89a') out.push(ch.charCodeAt(0));
        short(w); short(h);
        push(0xF7, 0, 0); // GCT flag, 256 colors
        push(...palette);
      },
      setRepeat(loop) {
        push(0x21, 0xFF, 11);
        for (const ch of 'NETSCAPE2.0') out.push(ch.charCodeAt(0));
        push(3, 1); short(loop); push(0);
      },
      addFrame(rgba, delayCs, first) {
        push(0x21, 0xF9, 4, 1); short(delayCs); push(0, 0);
        push(0x2C); short(0); short(0); short(w); short(h); push(0);
        push(8); // min code size
        const data = lzw(quantize(rgba), 8);
        for (let i = 0; i < data.length; i += 255) {
          const chunk = data.slice(i, i + 255);
          push(chunk.length, ...chunk);
        }
        push(0);
      },
      finish() { push(0x3B); return new Uint8Array(out); },
    };
  }

  SD.exporter = { init, openDialog, closeDialog, snapshotPNG };
})();
