/* SwapDraws — tour.js : welcome overlay, guided tour, help modal */
(function () {
  const SD = (window.SD = window.SD || {});
  const U = SD.util;
  const $ = (id) => U.$('#' + id);

  const STEPS = [
    { el: null, title: 'Welcome to SwapDraws 👋', text: 'Turn images, text, icons and SVGs into hand-drawn whiteboard videos — right in your browser. Let me show you around in 30 seconds.' },
    { el: '[data-tour="content"]', title: '① Add content', text: 'Drop images (SVGs get traced path-by-path!), add text with handwritten fonts, pick from 50+ icons, annotation shapes, or draw freehand on the board.' },
    { el: '[data-tour="animate"]', title: '② Choreograph', text: 'Select a layer, then choose how it appears: hand-drawn outlines, chalk, sketch passes, scanner, spiral, typewriter and more — each with its own ink color, wobble and hand style.' },
    { el: '[data-tour="timeline"]', title: '③ Direct the timeline', text: 'Drag layer bars to retime them, pull the edges to change duration, overlap bars to draw things together. Scrub the playhead to preview any exact frame.' },
    { el: '[data-tour="camera"]', title: '④ Move the camera', text: 'Add camera keyframes for cinematic pans & zooms — or hit “Auto-focus layers” and let SwapDraws direct the camera for you.' },
    { el: '[data-tour="scenes"]', title: '⑤ Chain scenes', text: 'Build multi-scene stories with transitions, title cards and outro cards. Each scene has its own board, background style and camera path.' },
    { el: '[data-tour="export"]', title: '⑥ Export 🎬', text: 'Record to WebM/MP4 with optional microphone voiceover, background music and pencil-scratch sound — or export a looping GIF and PNG stills. No watermark, ever.' },
  ];

  let step = 0;
  let hole = null;

  function init() {
    $('tourSkip').addEventListener('click', end);
    $('tourNext').addEventListener('click', () => { step++; if (step >= STEPS.length) end(); else show(); });
    $('tourOverlay').addEventListener('click', (e) => { if (e.target === $('tourOverlay')) end(); });
    $('btnTour').addEventListener('click', () => start(true));
    $('btnHelp').addEventListener('click', () => { $('helpModal').hidden = false; });
    U.$$('[data-close]').forEach((b) => b.addEventListener('click', () => { $(b.dataset.close).hidden = true; }));
    // welcome
    $('welCreate').addEventListener('click', async () => {
      await SD.state.createProject($('welName').value.trim() || 'Untitled Project');
      $('welcomeOverlay').hidden = true;
      if (!SD.state.loadPrefs().toured) start(true);
    });
    U.$$('#welTemplates .tpl').forEach((t) => t.addEventListener('click', async () => {
      await SD.state.createProject($('welName').value.trim() || tplName(t.dataset.tpl), { template: t.dataset.tpl });
      $('welcomeOverlay').hidden = true;
      if (!SD.state.loadPrefs().toured) start(true);
    }));
    // welcome: JSON storyboard / project import + sample script
    $('welImport')?.addEventListener('click', () => $('welImpInput').click());
    $('welImpInput')?.addEventListener('change', async (e) => {
      const f = e.target.files[0]; e.target.value = '';
      if (!f) return;
      const ok = await SD.jsonio.importFile(f);
      if (ok) { $('welcomeOverlay').hidden = true; if (!SD.state.loadPrefs().toured) start(true); }
    });
    $('welSample')?.addEventListener('click', () => SD.jsonio.downloadSample());
  }
  function tplName(t) { return { blank: 'Untitled Project', explainer: 'My Explainer', social: 'Social Short', chalk: 'Chalkboard Class' }[t] || 'Untitled Project'; }

  function start(force) {
    step = 0;
    $('tourOverlay').hidden = false;
    show();
    SD.state.savePrefs({ toured: true });
  }
  function show() {
    const s = STEPS[step];
    $('tourStep').textContent = `Step ${step + 1} of ${STEPS.length}`;
    $('tourTitle').textContent = s.title;
    $('tourText').textContent = s.text;
    $('tourNext').textContent = step === STEPS.length - 1 ? 'Start creating ✨' : 'Next →';
    $('tourDots').innerHTML = STEPS.map((_, i) => `<i class="${i === step ? 'on' : ''}"></i>`).join('');
    if (hole) hole.remove();
    const ov = $('tourOverlay');
    const card = $('tourCard');
    if (s.el && U.$(s.el)) {
      const r = U.$(s.el).getBoundingClientRect();
      hole = U.el('div', { class: 'hole' });
      hole.style.cssText = `left:${r.left - 8}px;top:${r.top - 8}px;width:${r.width + 16}px;height:${r.height + 16}px;`;
      ov.appendChild(hole);
      // place card beside it
      const vw = innerWidth, vh = innerHeight;
      let x = r.left + r.width / 2 - 160, y = r.bottom + 20;
      if (y + 220 > vh) y = r.top - 230;
      if (y < 10) y = Math.min(vh - 240, Math.max(10, r.top));
      x = U.clamp(x, 10, vw - 340);
      card.style.left = x + 'px'; card.style.top = y + 'px'; card.style.right = 'auto'; card.style.bottom = 'auto';
    } else {
      card.style.left = '50%'; card.style.top = '50%';
      card.style.transform = 'translate(-50%,-50%)';
      setTimeout(() => { card.style.transform = ''; }, 400);
    }
  }
  function end() { $('tourOverlay').hidden = true; if (hole) { hole.remove(); hole = null; } }

  /* ── welcome overlay with recent projects ── */
  function showWelcomeIfNeeded() {
    const recents = SD.state.listProjects();
    const wrap = $('welRecent');
    wrap.innerHTML = '';
    if (recents.length) {
      for (const meta of recents.slice(0, 6)) {
        const card = U.el('button', { class: 'proj-card' });
        card.innerHTML = `${meta.thumb ? `<img src="${meta.thumb}" alt="">` : '<img alt="" src="data:image/gif;base64,R0lGODlhAQABAAAAACw=" style="background:var(--panel-3)">'}
          <div class="pc-body"><div class="pc-name">${U.escapeHtml(meta.name)}</div>
          <div class="pc-meta">${new Date(meta.modifiedAt).toLocaleDateString()} · ${meta.w}×${meta.h}</div></div>`;
        card.addEventListener('click', async () => {
          $('welcomeOverlay').hidden = true;
          await SD.state.openProject(meta.id);
        });
        wrap.appendChild(card);
      }
    } else wrap.innerHTML = '<div class="empty-mini">Nothing yet — your projects auto-save here.</div>';
    $('welcomeOverlay').hidden = false;
  }

  SD.tour = { init, start, showWelcomeIfNeeded };
})();
