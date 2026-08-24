/* SwapDraws — main.js : boot, top bar wiring, projects modal, keyboard, theme */
(function () {
  const SD = (window.SD = window.SD || {});
  const U = SD.util;
  const A = () => SD.state;
  const $ = (id) => U.$('#' + id);

  async function boot() {
    // theme
    const prefs = A().loadPrefs();
    document.documentElement.dataset.theme = prefs.theme === 'light' ? 'light' : 'dark';
    syncThemeIcon();

    // init modules
    SD.stage.init();
    SD.timeline.init();
    SD.panels.init();
    SD.exporter.init();
    SD.tour.init();
    bindTopbar();
    bindKeyboard();
    bindProjectsModal();

    // preload art + fonts
    SD.assets.preloadHands();
    await SD.assets.ensureFontsLoaded();

    // open last project or welcome
    const lastId = localStorage.getItem(A().LS_AUTOSAVE);
    let opened = false;
    if (lastId && localStorage.getItem('sd_proj_' + lastId)) {
      try { opened = await A().openProject(lastId); } catch (e) { console.warn(e); opened = false; }
    }
    if (!opened) SD.tour.showWelcomeIfNeeded();
    else SD.stage.fit();

    // play button icons
    U.bus.on('playstate', (playing) => {
      U.$('.ic-play', $('btnPlay')).style.display = playing ? 'none' : '';
      U.$('.ic-pause', $('btnPlay')).style.display = playing ? '' : 'none';
    });
    // periodic backup save
    setInterval(() => { if (A().project) A().saveNow(); }, 30000);
    window.addEventListener('beforeunload', () => { if (A().project) A().saveNow(); });
  }

  /* ── top bar ── */
  function bindTopbar() {
    $('btnPlay').addEventListener('click', () => SD.stage.toggle());
    $('btnStop').addEventListener('click', () => SD.stage.stop());
    $('btnUndo').addEventListener('click', () => A().undo());
    $('btnRedo').addEventListener('click', () => A().redo());
    U.bus.on('history', () => {
      $('btnUndo').disabled = !A()._undo.length;
      $('btnRedo').disabled = !A()._redo.length;
    });
    $('btnExport').addEventListener('click', () => SD.exporter.openDialog());
    $('btnTheme').addEventListener('click', toggleTheme);
    $('projectName').addEventListener('change', (e) => {
      A().mutate('rename project', () => { A().project.name = e.target.value.trim() || 'Untitled Project'; }, { structure: true });
    });
    U.bus.on('project-loaded', () => { $('projectName').value = A().project.name; syncUndoRedo(); });
    U.bus.on('change', (o) => { if (A().project) $('projectName').value = A().project.name; });
    function syncUndoRedo() { $('btnUndo').disabled = !A()._undo.length; $('btnRedo').disabled = !A()._redo.length; }

    // drawing toolbar
    U.$$('.dtool[data-dtool]').forEach((b) => b.addEventListener('click', () => SD.stage.setDrawTool(b.dataset.dtool)));
    $('drawDone').addEventListener('click', () => SD.stage.finishDrawing(true));
    $('drawUndo').addEventListener('click', () => {
      const dr = SD.stage.drawingSession;
      if (dr && dr.strokes.length) { dr.strokes.pop(); SD.stage.scheduleFrame(); }
    });
  }

  function toggleTheme() {
    const cur = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
    document.documentElement.dataset.theme = cur;
    A().savePrefs({ theme: cur });
    syncThemeIcon();
    SD.stage.scheduleFrame();
    SD.timeline.rebuild();
  }
  function syncThemeIcon() {
    const light = document.documentElement.dataset.theme === 'light';
    U.$('.ic-sun').style.display = light ? 'none' : '';
    U.$('.ic-moon').style.display = light ? '' : 'none';
  }

  /* ── keyboard ── */
  function bindKeyboard() {
    window.addEventListener('keydown', (e) => {
      const tag = (e.target.tagName || '');
      const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(tag) || e.target.isContentEditable;
      const S = A();
      if (!S.project) return;
      const mod = e.ctrlKey || e.metaKey;

      if (mod && e.code === 'KeyZ' && !e.shiftKey) {
        e.preventDefault();
        if (SD.stage.isDrawing) { const dr = SD.stage.drawingSession; dr.strokes.pop(); SD.stage.scheduleFrame(); }
        else S.undo();
        return;
      }
      if (mod && (e.code === 'KeyY' || (e.code === 'KeyZ' && e.shiftKey))) { e.preventDefault(); S.redo(); return; }
      if (typing) return;

      if (e.code === 'Space') { e.preventDefault(); SD.stage.toggle(); }
      else if (e.code === 'Home') { SD.stage.stop(); }
      else if (mod && e.code === 'KeyE') { e.preventDefault(); SD.exporter.openDialog(); }
      else if (mod && e.code === 'KeyO') { e.preventDefault(); $('projectsModal').hidden = false; renderProjectsModal(); }
      else if (mod && e.code === 'KeyD') { e.preventDefault(); S.duplicateSelected(); }
      else if (mod && e.code === 'KeyA') { e.preventDefault(); S.selection = new Set(S.scene().layers.map((l) => l.id)); U.bus.emit('selection'); }
      else if (e.code === 'Delete' || e.code === 'Backspace') { if (S.selection.size) { e.preventDefault(); S.removeLayers(new Set(S.selection)); } }
      else if (e.code === 'Escape') {
        if (SD.stage.isDrawing) SD.stage.finishDrawing(true);
        else { S.selection.clear(); U.bus.emit('selection'); }
        closeModals();
      }
      else if (e.code === 'BracketLeft' || e.code === 'BracketRight') {
        const l = S.firstSelected();
        if (l) S.reorder(l.id, e.code === 'BracketRight' ? 1 : -1);
      }
      else if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.code)) {
        const sel = S.selectedLayers().filter((l) => !l.locked);
        if (!sel.length) return;
        e.preventDefault();
        if (!e.repeat) S.pushHistory('nudge');
        const d = (e.shiftKey ? 10 : 1);
        for (const l of sel) {
          if (e.code === 'ArrowLeft') l.x -= d;
          if (e.code === 'ArrowRight') l.x += d;
          if (e.code === 'ArrowUp') l.y -= d;
          if (e.code === 'ArrowDown') l.y += d;
        }
        S.touch({ transient: true });
      }
      else if (e.key === '?' || (e.shiftKey && e.code === 'Slash')) { e.preventDefault(); $('helpModal').hidden = !$('helpModal').hidden; }
      else if (e.code === 'Digit0') SD.stage.fit();
      else if (e.key === '+' || e.key === '=') { e.preventDefault(); U.$('#stageZoomIn').click(); }
      else if (e.key === '-') { e.preventDefault(); U.$('#stageZoomOut').click(); }
      else if (SD.stage.isDrawing) {
        if (e.code === 'KeyP') SD.stage.setDrawTool('pen');
        if (e.code === 'KeyM') SD.stage.setDrawTool('marker');
        if (e.code === 'KeyH') SD.stage.setDrawTool('highlighter');
        if (e.code === 'KeyE') SD.stage.setDrawTool('eraserStroke');
      }
    });
  }
  function closeModals() {
    ['exportModal', 'projectsModal', 'helpModal'].forEach((id) => { if (id === 'exportModal') { if (!U.$('#exportProgress').hidden) return; } $(id).hidden = true; });
    $('tourOverlay').hidden = true;
  }

  /* ── projects modal ── */
  function bindProjectsModal() {
    $('btnProjects').addEventListener('click', () => { $('projectsModal').hidden = false; renderProjectsModal(); });
    $('btnNewProject').addEventListener('click', async () => {
      const name = prompt('Project name:', 'Untitled Project');
      if (name === null) return;
      await A().createProject(name.trim() || 'Untitled Project');
      $('projectsModal').hidden = true;
    });
    $('btnImportProject').addEventListener('click', () => $('importProjInput').click());
    $('importProjInput').addEventListener('change', async (e) => {
      const f = e.target.files[0]; e.target.value = '';
      if (f) { const ok = await SD.jsonio.importFile(f); if (ok) $('projectsModal').hidden = true; }
    });
    $('btnExportProject').addEventListener('click', () => A().exportProjectFile());
    $('btnExportScript')?.addEventListener('click', () => SD.jsonio.exportScript());
    // top bar: import JSON storyboard / project from anywhere
    $('btnImportJSON')?.addEventListener('click', () => $('impJsonInput').click());
    $('impJsonInput')?.addEventListener('change', async (e) => {
      const f = e.target.files[0]; e.target.value = '';
      if (f) await SD.jsonio.importFile(f);
    });
    U.bus.on('projects', () => { if (!$('projectsModal').hidden) renderProjectsModal(); });
  }
  function renderProjectsModal() {
    const wrap = $('projList');
    const items = A().listProjects();
    wrap.innerHTML = '';
    if (!items.length) { wrap.innerHTML = '<div class="empty-mini" style="grid-column:1/-1">No saved projects yet.</div>'; return; }
    for (const meta of items) {
      const card = U.el('button', { class: 'proj-card' });
      card.innerHTML = `
        ${meta.thumb ? `<img src="${meta.thumb}" alt="">` : '<div style="height:84px;background:var(--panel-3);display:grid;place-items:center">🖼</div>'}
        <div class="pc-body"><div class="pc-name">${U.escapeHtml(meta.name)}</div>
        <div class="pc-meta">${new Date(meta.modifiedAt).toLocaleString()} · ${meta.scenes} scene${meta.scenes > 1 ? 's' : ''} · ${meta.w}×${meta.h}</div></div>
        <span class="pc-del" title="Delete project">×</span>`;
      if (A().project && A().project.id === meta.id) card.style.borderColor = 'var(--accent)';
      card.addEventListener('click', async (e) => {
        if (e.target.classList.contains('pc-del')) return;
        await A().openProject(meta.id);
        $('projectsModal').hidden = true;
      });
      U.$('.pc-del', card).addEventListener('click', (e) => {
        e.stopPropagation();
        if (confirm(`Delete "${meta.name}" forever?`)) {
          if (A().project && A().project.id === meta.id) { U.toast('Open project cannot be deleted', 'bad'); return; }
          A().deleteProject(meta.id);
          renderProjectsModal();
        }
      });
      wrap.appendChild(card);
    }
  }

  document.addEventListener('DOMContentLoaded', boot);
  document.addEventListener('DOMContentLoaded', () => {
    const b = U.$('#ssnContinue');
    if (b) b.addEventListener('click', () => { U.$('#smallScreenNote').classList.add('dismissed'); U.toast('Continuing on a small screen — panels may overlap', 'ok'); });
  });
})();
