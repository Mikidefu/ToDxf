/*
 * Interfaccia: caricamento immagine, parametri, anteprima con zoom e download del DXF.
 */
(function () {
  'use strict';
  const NS = window.ToDxf;
  const $ = (id) => document.getElementById(id);
  const STORAGE_KEY = 'todxf-settings-v1';

  const el = {
    file: $('file'), drop: $('drop'), dropText: $('dropText'), fileInfo: $('fileInfo'),
    threshold: $('threshold'), autoThreshold: $('autoThreshold'), invert: $('invert'),
    blur: $('blur'), despeckle: $('despeckle'), maxRes: $('maxRes'),
    smooth: $('smooth'), simplify: $('simplify'), prune: $('prune'), pruneField: $('pruneField'),
    widthMm: $('widthMm'), dpi: $('dpi'), dpiHint: $('dpiHint'),
    widthField: $('widthField'), dpiField: $('dpiField'), sizeResult: $('sizeResult'),
    download: $('download'), canvas: $('canvas'), stage: $('stage'), empty: $('empty'),
    busy: $('busy'), status: $('status'), zoomLevel: $('zoomLevel'),
  };
  const ctx = el.canvas.getContext('2d');

  const outputs = {
    threshold: (v) => String(Math.round(v)),
    blur: (v) => String(v),
    despeckle: (v) => v + ' px²',
    smooth: (v) => String(v),
    simplify: (v) => Number(v).toFixed(1) + ' px',
    prune: (v) => v + ' px',
  };

  const state = {
    name: '',
    image: null,
    origW: 0,
    origH: 0,
    fileDpi: null,
    source: null, // canvas con l'immagine alla risoluzione di lavoro
    imageData: null,
    binary: null, // canvas bianco/nero
    result: null,
    ms: 0,
    view: { s: 1, ox: 0, oy: 0 },
    url: null,
  };

  // ---------------------------------------------------------------- impostazioni
  const radio = (name) => document.querySelector(`input[name="${name}"]:checked`).value;
  const setRadio = (name, value) => {
    const r = document.querySelector(`input[name="${name}"][value="${value}"]`);
    if (r) r.checked = true;
  };

  function settings() {
    return {
      mode: radio('mode'),
      autoThreshold: el.autoThreshold.checked,
      threshold: +el.threshold.value,
      invert: el.invert.checked,
      blur: +el.blur.value,
      despeckle: +el.despeckle.value,
      maxRes: +el.maxRes.value,
      smooth: +el.smooth.value,
      simplify: +el.simplify.value,
      prune: +el.prune.value,
      sizeMode: radio('sizeMode'),
      widthMm: +el.widthMm.value,
      dpi: +el.dpi.value,
      bg: radio('bg'),
    };
  }

  function saveSettings() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(settings()));
    } catch (e) { /* archiviazione non disponibile */ }
  }

  function restoreSettings() {
    let s = null;
    try {
      s = JSON.parse(localStorage.getItem(STORAGE_KEY));
    } catch (e) { /* ignora */ }
    if (!s) return;
    for (const r of ['mode', 'sizeMode', 'bg']) if (s[r]) setRadio(r, s[r]);
    for (const k of ['threshold', 'blur', 'despeckle', 'maxRes', 'smooth', 'simplify', 'prune', 'widthMm', 'dpi']) {
      if (s[k] !== undefined && s[k] !== null) el[k].value = s[k];
    }
    el.autoThreshold.checked = s.autoThreshold !== false;
    el.invert.checked = !!s.invert;
  }

  function syncControls() {
    const s = settings();
    for (const k in outputs) $(k + 'Out').textContent = outputs[k](el[k].value);
    el.threshold.disabled = s.autoThreshold;
    el.pruneField.hidden = s.mode !== 'centerline';
    el.widthField.hidden = s.sizeMode !== 'width';
    el.dpiField.hidden = s.sizeMode !== 'dpi';
    el.dpiHint.textContent = state.fileDpi
      ? `Il file dichiara ${state.fileDpi} DPI.`
      : state.name ? 'Il file non dichiara i DPI.' : '';
    updateSize();
  }

  // ---------------------------------------------------------------- dimensioni
  function sizeMm() {
    if (!state.origW) return null;
    const s = settings();
    const w = s.sizeMode === 'dpi' ? (state.origW * 25.4) / (s.dpi || 1) : s.widthMm;
    if (!(w > 0) || !isFinite(w)) return null;
    return { w, h: (w * state.origH) / state.origW };
  }

  function updateSize() {
    const sz = sizeMm();
    el.sizeResult.textContent = sz ? `${fmtMm(sz.w)} × ${fmtMm(sz.h)} mm` : '—';
    el.download.disabled = !(sz && state.result && state.result.paths.length);
  }

  const fmtMm = (v) => (v >= 100 ? v.toFixed(1) : v.toFixed(2)).replace('.', ',');

  // ---------------------------------------------------------------- caricamento
  const ACCEPT = /\.(jpe?g|png|webp|bmp|gif|avif|svg|ico)$/i;

  async function loadFile(file) {
    if (!file) return;
    if (!(file.type.startsWith('image/') || ACCEPT.test(file.name))) {
      showFileError(`"${file.name}" non è un'immagine supportata.`);
      return;
    }
    const buffer = await file.arrayBuffer();
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.src = url;
    try {
      await img.decode();
    } catch (e) {
      URL.revokeObjectURL(url);
      showFileError(`Impossibile leggere "${file.name}". Il browser non supporta questo formato o il file è danneggiato.`);
      return;
    }
    if (state.url) URL.revokeObjectURL(state.url);
    state.url = url;
    state.name = file.name || 'immagine';
    state.origW = img.naturalWidth || 1000;
    state.origH = img.naturalHeight || 1000;
    state.fileDpi = NS.detectDpi(buffer);
    state.image = img;
    if (state.fileDpi) el.dpi.value = state.fileDpi;

    el.fileInfo.classList.remove('error');
    el.fileInfo.textContent = `${state.name} · ${state.origW} × ${state.origH} px`;
    el.dropText.innerHTML = 'Cambia immagine<br><small>trascina, clicca o incolla</small>';
    el.empty.hidden = true;
    prepareSource();
    syncControls();
    fitView();
    scheduleProcess(0);
  }

  function showFileError(msg) {
    el.fileInfo.textContent = msg;
    el.fileInfo.classList.add('error');
  }

  /** Ridisegna l'immagine alla risoluzione di lavoro (su fondo bianco). */
  function prepareSource() {
    if (!state.image) return;
    const maxRes = settings().maxRes;
    const scale = Math.min(maxRes / Math.max(state.origW, state.origH), 4);
    const w = Math.max(1, Math.round(state.origW * scale));
    const h = Math.max(1, Math.round(state.origH * scale));
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const g = c.getContext('2d', { willReadFrequently: true });
    g.fillStyle = '#fff';
    g.fillRect(0, 0, w, h);
    g.imageSmoothingEnabled = true;
    g.imageSmoothingQuality = 'high';
    g.drawImage(state.image, 0, 0, w, h);
    state.source = c;
    state.imageData = g.getImageData(0, 0, w, h);
  }

  // ---------------------------------------------------------------- elaborazione
  let timer = 0;
  function scheduleProcess(delay = 150) {
    if (!state.imageData) return;
    clearTimeout(timer);
    el.busy.hidden = false;
    timer = setTimeout(() => requestAnimationFrame(() => setTimeout(runProcess, 0)), delay);
  }

  function runProcess() {
    const s = settings();
    const t0 = performance.now();
    try {
      state.result = NS.vectorize(state.imageData, s);
    } catch (e) {
      console.error(e);
      el.status.textContent = 'Errore durante la vettorizzazione: ' + e.message;
      el.busy.hidden = true;
      return;
    }
    state.ms = performance.now() - t0;
    if (s.autoThreshold) {
      el.threshold.value = Math.round(state.result.threshold);
      $('thresholdOut').textContent = Math.round(state.result.threshold);
    }
    buildBinaryCanvas();
    el.busy.hidden = true;
    updateStatus();
    updateSize();
    render();
  }

  function buildBinaryCanvas() {
    const { bin, width: w, height: h } = state.result;
    const c = state.binary && state.binary.width === w && state.binary.height === h ? state.binary : document.createElement('canvas');
    c.width = w;
    c.height = h;
    const g = c.getContext('2d');
    const id = g.createImageData(w, h);
    for (let i = 0, p = 0; i < bin.length; i++, p += 4) {
      const v = bin[i] ? 20 : 255;
      id.data[p] = id.data[p + 1] = id.data[p + 2] = v;
      id.data[p + 3] = 255;
    }
    g.putImageData(id, 0, 0);
    state.binary = c;
  }

  function updateStatus() {
    const r = state.result;
    if (!r) return;
    const s = settings();
    const kind = s.mode === 'centerline' ? 'singola linea' : 'doppia linea';
    const closed = r.paths.filter((p) => p.closed).length;
    el.status.textContent =
      `${kind} · ${r.paths.length} vettori (${closed} chiusi, ${r.paths.length - closed} aperti) · ` +
      `${r.points.toLocaleString('it-IT')} punti · lavoro ${r.width}×${r.height} px · ${Math.round(state.ms)} ms`;
    if (!r.paths.length) {
      el.status.textContent += ' — nessun vettore: prova a cambiare soglia o a invertire.';
    }
  }

  // ---------------------------------------------------------------- anteprima
  function resizeCanvas() {
    const r = el.stage.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    el.canvas.width = Math.max(1, Math.round(r.width * dpr));
    el.canvas.height = Math.max(1, Math.round(r.height * dpr));
    render();
  }

  function fitView() {
    if (!state.source) return;
    const r = el.stage.getBoundingClientRect();
    const w = state.source.width, h = state.source.height;
    const s = Math.min((r.width - 40) / w, (r.height - 40) / h);
    state.view.s = s > 0 ? s : 1;
    state.view.ox = (r.width - w * state.view.s) / 2;
    state.view.oy = (r.height - h * state.view.s) / 2;
    render();
  }

  function zoomAt(factor, cx, cy) {
    const v = state.view;
    const ns = Math.min(Math.max(v.s * factor, 0.02), 80);
    v.ox = cx - ((cx - v.ox) * ns) / v.s;
    v.oy = cy - ((cy - v.oy) * ns) / v.s;
    v.s = ns;
    render();
  }

  function render() {
    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, el.canvas.width, el.canvas.height);
    if (!state.source) return;
    const v = state.view;
    const w = state.source.width, h = state.source.height;
    el.zoomLevel.textContent = Math.round(v.s * 100) + '%';

    ctx.setTransform(dpr * v.s, 0, 0, dpr * v.s, dpr * v.ox, dpr * v.oy);
    ctx.fillStyle = '#fff';
    ctx.shadowColor = 'rgba(0,0,0,.18)';
    ctx.shadowBlur = 12;
    ctx.fillRect(0, 0, w, h);
    ctx.shadowBlur = 0;

    const bg = radio('bg');
    ctx.imageSmoothingEnabled = v.s < 3;
    if (bg === 'original') {
      ctx.globalAlpha = 0.4;
      ctx.drawImage(state.source, 0, 0);
      ctx.globalAlpha = 1;
    } else if (bg === 'binary' && state.binary) {
      ctx.globalAlpha = 0.3;
      ctx.drawImage(state.binary, 0, 0);
      ctx.globalAlpha = 1;
    }

    const r = state.result;
    if (!r || r.width !== w) return;
    const centerline = radio('mode') === 'centerline';
    ctx.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue(centerline ? '--vec-center' : '--vec-outline').trim();
    ctx.lineWidth = 1.4 / v.s;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.beginPath();
    for (const p of r.paths) {
      const pts = p.pts;
      ctx.moveTo(pts[0], pts[1]);
      for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i], pts[i + 1]);
      if (p.closed) ctx.closePath();
    }
    ctx.stroke();

    // Da vicino mostra i nodi dei vettori
    if (v.s >= 5) {
      ctx.fillStyle = ctx.strokeStyle;
      const d = 3 / v.s;
      for (const p of r.paths) {
        for (let i = 0; i < p.pts.length; i += 2) ctx.fillRect(p.pts[i] - d / 2, p.pts[i + 1] - d / 2, d, d);
      }
    }
  }

  // ---------------------------------------------------------------- download
  function downloadDxf() {
    const r = state.result;
    const sz = sizeMm();
    if (!r || !sz) return;
    const centerline = settings().mode === 'centerline';
    const dxf = NS.buildDxf(r.paths, {
      scale: sz.w / r.width,
      height: r.height,
      layer: centerline ? 'SINGOLA_LINEA' : 'DOPPIA_LINEA',
    });
    const base = state.name.replace(/\.[^.]+$/, '') || 'disegno';
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([dxf], { type: 'application/dxf' }));
    a.download = `${base}_${centerline ? 'singola' : 'doppia'}.dxf`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }

  // ---------------------------------------------------------------- eventi
  const reprocessIds = ['threshold', 'autoThreshold', 'invert', 'blur', 'despeckle', 'smooth', 'simplify', 'prune'];
  for (const id of reprocessIds) {
    el[id].addEventListener('input', () => {
      syncControls();
      saveSettings();
      scheduleProcess();
    });
  }
  el.maxRes.addEventListener('change', () => {
    saveSettings();
    prepareSource();
    fitView();
    scheduleProcess(0);
  });
  document.querySelectorAll('input[name="mode"]').forEach((r) =>
    r.addEventListener('change', () => {
      syncControls();
      saveSettings();
      scheduleProcess(0);
    })
  );
  document.querySelectorAll('input[name="sizeMode"]').forEach((r) =>
    r.addEventListener('change', () => {
      syncControls();
      saveSettings();
    })
  );
  document.querySelectorAll('input[name="bg"]').forEach((r) =>
    r.addEventListener('change', () => {
      saveSettings();
      render();
    })
  );
  for (const id of ['widthMm', 'dpi']) {
    el[id].addEventListener('input', () => {
      updateSize();
      saveSettings();
    });
  }

  el.file.addEventListener('change', () => loadFile(el.file.files[0]));
  el.drop.addEventListener('dragover', (e) => {
    e.preventDefault();
    el.drop.classList.add('over');
  });
  el.drop.addEventListener('dragleave', () => el.drop.classList.remove('over'));
  // si può trascinare l'immagine ovunque nella pagina
  document.addEventListener('dragover', (e) => e.preventDefault());
  document.addEventListener('drop', (e) => {
    e.preventDefault();
    el.drop.classList.remove('over');
    const f = e.dataTransfer && e.dataTransfer.files[0];
    if (f) loadFile(f);
  });
  document.addEventListener('paste', (e) => {
    const items = (e.clipboardData && e.clipboardData.items) || [];
    for (const it of items) {
      if (it.kind === 'file' && it.type.startsWith('image/')) {
        const f = it.getAsFile();
        loadFile(new File([f], f.name && f.name !== 'image.png' ? f.name : 'incollata.png', { type: f.type }));
        e.preventDefault();
        return;
      }
    }
  });
  el.download.addEventListener('click', downloadDxf);

  // zoom e spostamento
  $('zoomIn').addEventListener('click', () => {
    const r = el.stage.getBoundingClientRect();
    zoomAt(1.25, r.width / 2, r.height / 2);
  });
  $('zoomOut').addEventListener('click', () => {
    const r = el.stage.getBoundingClientRect();
    zoomAt(0.8, r.width / 2, r.height / 2);
  });
  $('zoomFit').addEventListener('click', fitView);
  el.canvas.addEventListener('dblclick', fitView);
  el.canvas.addEventListener(
    'wheel',
    (e) => {
      if (!state.source) return;
      e.preventDefault();
      const r = el.canvas.getBoundingClientRect();
      zoomAt(Math.exp(-e.deltaY * 0.0015), e.clientX - r.left, e.clientY - r.top);
    },
    { passive: false }
  );
  let drag = null;
  el.canvas.addEventListener('pointerdown', (e) => {
    if (!state.source) return;
    drag = { x: e.clientX, y: e.clientY, ox: state.view.ox, oy: state.view.oy };
    el.canvas.setPointerCapture(e.pointerId);
    el.canvas.classList.add('dragging');
  });
  el.canvas.addEventListener('pointermove', (e) => {
    if (!drag) return;
    state.view.ox = drag.ox + e.clientX - drag.x;
    state.view.oy = drag.oy + e.clientY - drag.y;
    render();
  });
  const endDrag = () => {
    drag = null;
    el.canvas.classList.remove('dragging');
  };
  el.canvas.addEventListener('pointerup', endDrag);
  el.canvas.addEventListener('pointercancel', endDrag);

  new ResizeObserver(resizeCanvas).observe(el.stage);

  restoreSettings();
  syncControls();
  resizeCanvas();

  window.ToDxfApp = { loadFile };
})();
