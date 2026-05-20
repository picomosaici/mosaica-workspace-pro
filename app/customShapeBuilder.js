// ════════════════════════════════════════════════════════════════════════════
//  customShapeBuilder.js
//  ────────────────────────────────────────────────────────────────────────────
//  Modale per creare forme personalizzate (non standard) tracciando
//  click-per-click i vertici di un poligono. Una volta chiusa la forma,
//  l'utente può manipolare ogni singolo vertice trascinando una maniglia
//  prima di inserire la forma nel canvas di Mosaica.
//
//  Modello di interazione (fase "drawing"):
//   • 1° click  → primo vertice. La linea segue il mouse senza tenere premuto.
//   • 2° click  → fine prima linea, parte la seconda dal punto fissato.
//   • N° click  → … fino a chiudere la forma.
//   • Chiusura  → click sul primo vertice (snap visivo entro CLOSE_SNAP_PX)
//                 OPPURE tasto Invio (con almeno 3 vertici).
//
//  Modello di interazione (fase "editing"):
//   • Maniglie a forma di punto su ogni vertice.
//   • Drag su una maniglia → il vertice corrispondente si sposta, i due
//     lati che lo formano si allungano e si inclinano di conseguenza.
//
//  Inserimento nel canvas:
//   • Pulsante "Inserisci nel canvas" → crea un fabric.Polygon con
//     __shapeType = "custom" e lo posiziona nel centro geometrico della
//     porzione di canvas EFFETTIVAMENTE visibile (stessa logica di
//     #addShapeBtn).
//   • La forma diventa un cittadino di Mosaica a tutti gli effetti:
//     menu radiale, maniglie azzurre, save/load, undo/redo, duplica,
//     export ecc. funzionano automaticamente perché le proprietà
//     __shape / __shapeType / customId sono già nella whitelist di
//     autoSave.js e di pushState.
//
//  Compatibilità: Fabric.js v5.1.0+
// ════════════════════════════════════════════════════════════════════════════

(function initCustomShapeBuilder() {
  // ───────────────────── Costanti UI ─────────────────────────────────────
  const PREVIEW_W = 640;                 // dimensione logica preview (px)
  const PREVIEW_H = 460;
  const VERTEX_DOT_RADIUS = 4;           // pallini vertici in fase drawing
  const HANDLE_RADIUS = 8;               // maniglie in fase editing
  const HANDLE_HIT_RADIUS = 12;          // tolleranza click sulle maniglie
  const CLOSE_SNAP_PX = 12;              // distanza per snap di chiusura
  const MIN_VERTEX_DISTANCE = 4;         // distanza minima tra vertici consecutivi (anti-doppio click)
  const SHAPE_FILL = "rgba(0, 5, 255, 0.79)"; // coerente con addShapeBtn / dblclick

  // ───────────────────── Stato del builder ───────────────────────────────
  const state = {
    phase: "drawing",     // 'drawing' | 'editing'
    vertices: [],         // [{x, y}, ...] in coordinate logiche del preview
    mouseX: -1,
    mouseY: -1,
    mouseInside: false,
    snappingToFirst: false,
    draggingHandle: -1,   // indice del vertice in drag (fase editing), -1 se nessuno
    hoverHandle: -1       // indice del vertice in hover (fase editing)
  };

  // Riferimenti DOM (popolati alla prima apertura)
  let modalEl = null;
  let previewCanvas = null;
  let ctx = null;
  let insertBtn = null;
  let resetBtn = null;
  let undoVertexBtn = null;
  let statusEl = null;
  let dpr = 1;

  // ───────────────────── Helpers geometria ───────────────────────────────
  function dist(a, b) {
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    return Math.hypot(dx, dy);
  }

  function findHandleAt(px, py) {
    for (let i = 0; i < state.vertices.length; i++) {
      if (dist({ x: px, y: py }, state.vertices[i]) <= HANDLE_HIT_RADIUS) return i;
    }
    return -1;
  }

  function isCloseSnapActive() {
    if (state.phase !== "drawing") return false;
    if (state.vertices.length < 3) return false;
    if (!state.mouseInside) return false;
    return dist({ x: state.mouseX, y: state.mouseY }, state.vertices[0]) <= CLOSE_SNAP_PX;
  }

  // ───────────────────── Render del preview ──────────────────────────────
  function render() {
    if (!ctx) return;
    ctx.save();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // Sfondo "carta"
    ctx.fillStyle = "#fafafa";
    ctx.fillRect(0, 0, PREVIEW_W, PREVIEW_H);

    // Griglia leggera (ogni 20px) — aiuta a "stimare" le dimensioni
    ctx.strokeStyle = "rgba(0,0,0,0.06)";
    ctx.lineWidth = 1;
    for (let x = 0; x <= PREVIEW_W; x += 20) {
      ctx.beginPath();
      ctx.moveTo(x + 0.5, 0);
      ctx.lineTo(x + 0.5, PREVIEW_H);
      ctx.stroke();
    }
    for (let y = 0; y <= PREVIEW_H; y += 20) {
      ctx.beginPath();
      ctx.moveTo(0, y + 0.5);
      ctx.lineTo(PREVIEW_W, y + 0.5);
      ctx.stroke();
    }

    const v = state.vertices;

    // Riempimento (solo in editing, e ovviamente con almeno 3 vertici)
    if (state.phase === "editing" && v.length >= 3) {
      ctx.beginPath();
      ctx.moveTo(v[0].x, v[0].y);
      for (let i = 1; i < v.length; i++) ctx.lineTo(v[i].x, v[i].y);
      ctx.closePath();
      ctx.fillStyle = SHAPE_FILL;
      ctx.fill();
    }

    // Linee tra vertici già piazzati
    if (v.length >= 2) {
      ctx.beginPath();
      ctx.moveTo(v[0].x, v[0].y);
      for (let i = 1; i < v.length; i++) ctx.lineTo(v[i].x, v[i].y);
      if (state.phase === "editing") ctx.closePath();
      ctx.strokeStyle = "#1e3a8a";
      ctx.lineWidth = 2;
      ctx.stroke();
    }

    // Linea agganciata al mouse (solo fase drawing, dopo il 1° click)
    if (state.phase === "drawing" && v.length >= 1 && state.mouseInside) {
      const last = v[v.length - 1];
      const snapping = isCloseSnapActive();
      // Target della linea: punto del mouse o snap sul primo vertice
      const tx = snapping ? v[0].x : state.mouseX;
      const ty = snapping ? v[0].y : state.mouseY;

      ctx.beginPath();
      ctx.moveTo(last.x, last.y);
      ctx.lineTo(tx, ty);
      ctx.strokeStyle = snapping ? "#16a34a" : "#2b6cff";
      ctx.lineWidth = snapping ? 2.5 : 2;
      ctx.setLineDash(snapping ? [] : [6, 4]);
      ctx.stroke();
      ctx.setLineDash([]);
      state.snappingToFirst = snapping;
    } else {
      state.snappingToFirst = false;
    }

    // Vertici / maniglie
    for (let i = 0; i < v.length; i++) {
      const p = v[i];
      const isFirst = i === 0;
      const isHoverClose = state.phase === "drawing" && isFirst && state.snappingToFirst;

      let radius, fill, stroke;
      if (state.phase === "editing") {
        const active = i === state.draggingHandle || i === state.hoverHandle;
        radius = HANDLE_RADIUS;
        fill = active ? "#00c8ff" : "#1e90ff";
        stroke = "#002244";
      } else {
        radius = isHoverClose ? HANDLE_RADIUS : VERTEX_DOT_RADIUS;
        fill = isHoverClose ? "#16a34a" : isFirst ? "#22c55e" : "#1e90ff";
        stroke = "#002244";
      }

      ctx.beginPath();
      ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
      ctx.fillStyle = fill;
      ctx.fill();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = stroke;
      ctx.stroke();
    }

    ctx.restore();
  }

  // ───────────────────── Aggiornamento UI footer ─────────────────────────
  function updateUI() {
    if (insertBtn) {
      const enabled = state.phase === "editing" && state.vertices.length >= 3;
      insertBtn.disabled = !enabled;
      insertBtn.style.opacity = enabled ? "1" : "0.4";
      insertBtn.style.cursor = enabled ? "pointer" : "not-allowed";
    }
    if (undoVertexBtn) {
      const enabled = state.phase === "drawing" && state.vertices.length > 0;
      undoVertexBtn.disabled = !enabled;
      undoVertexBtn.style.opacity = enabled ? "1" : "0.4";
      undoVertexBtn.style.cursor = enabled ? "pointer" : "not-allowed";
    }
    if (statusEl) {
      if (state.phase === "drawing") {
        const n = state.vertices.length;
        if (n === 0) statusEl.textContent = "Clicca sul preview per piazzare il 1° vertice.";
        else if (n < 3) statusEl.textContent = `${n} vertice/i piazzati. Continua a cliccare per tracciare i lati.`;
        else statusEl.textContent = `${n} vertici. Chiudi la forma cliccando sul 1° vertice (verde) oppure premi Invio.`;
      } else {
        statusEl.textContent = `Forma chiusa (${state.vertices.length} vertici). Trascina le maniglie per modificarla, poi clicca "Inserisci nel canvas".`;
      }
    }
  }

  // ───────────────────── Stato: helper di mutazione ──────────────────────
  function resetState() {
    state.phase = "drawing";
    state.vertices = [];
    state.draggingHandle = -1;
    state.hoverHandle = -1;
    state.snappingToFirst = false;
    render();
    updateUI();
  }

  function closeShape() {
    if (state.vertices.length < 3) return;
    state.phase = "editing";
    state.draggingHandle = -1;
    state.hoverHandle = -1;
    render();
    updateUI();
  }

  function undoLastVertex() {
    if (state.phase !== "drawing" || state.vertices.length === 0) return;
    state.vertices.pop();
    render();
    updateUI();
  }

  // ───────────────────── Event handlers preview ──────────────────────────
  function getPreviewPointer(e) {
    const rect = previewCanvas.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) * PREVIEW_W) / rect.width,
      y: ((e.clientY - rect.top) * PREVIEW_H) / rect.height
    };
  }

  function onPreviewMouseDown(e) {
    if (e.button !== 0) return; // solo tasto sinistro
    const p = getPreviewPointer(e);

    if (state.phase === "drawing") {
      // Snap di chiusura sul primo vertice (≥3 vertici)
      if (state.vertices.length >= 3 && dist(p, state.vertices[0]) <= CLOSE_SNAP_PX) {
        closeShape();
        return;
      }
      // Aggiungi vertice — ma rifiuta se troppo vicino al precedente
      if (state.vertices.length > 0) {
        const last = state.vertices[state.vertices.length - 1];
        if (dist(p, last) < MIN_VERTEX_DISTANCE) return;
      }
      state.vertices.push({ x: p.x, y: p.y });
      render();
      updateUI();
      return;
    }

    if (state.phase === "editing") {
      const idx = findHandleAt(p.x, p.y);
      if (idx !== -1) {
        state.draggingHandle = idx;
        render();
      }
    }
  }

  function onPreviewMouseMove(e) {
    const p = getPreviewPointer(e);
    state.mouseX = p.x;
    state.mouseY = p.y;
    state.mouseInside = true;

    if (state.phase === "editing") {
      if (state.draggingHandle !== -1) {
        // Aggiorna posizione vertice trascinato (limita ai bounds del preview)
        const v = state.vertices[state.draggingHandle];
        v.x = Math.max(0, Math.min(PREVIEW_W, p.x));
        v.y = Math.max(0, Math.min(PREVIEW_H, p.y));
      } else {
        const idx = findHandleAt(p.x, p.y);
        state.hoverHandle = idx;
        previewCanvas.style.cursor = idx !== -1 ? "grab" : "default";
      }
    } else {
      // In drawing mostriamo "crosshair" sopra il primo vertice quando saremmo per chiudere
      if (isCloseSnapActive()) previewCanvas.style.cursor = "pointer";
      else previewCanvas.style.cursor = "crosshair";
    }

    render();
  }

  function onPreviewMouseUp() {
    if (state.phase === "editing" && state.draggingHandle !== -1) {
      state.draggingHandle = -1;
      render();
    }
  }

  function onPreviewMouseLeave() {
    state.mouseInside = false;
    state.snappingToFirst = false;
    // se stavamo trascinando una maniglia e si esce, rilasciala
    if (state.draggingHandle !== -1) state.draggingHandle = -1;
    render();
  }

  function onPreviewKeyDown(e) {
    // I tasti vengono catturati solo se il modale è aperto e visibile.
    if (!modalEl || modalEl.style.display === "none") return;

    if (e.key === "Enter") {
      if (state.phase === "drawing" && state.vertices.length >= 3) {
        e.preventDefault();
        closeShape();
      } else if (state.phase === "editing" && !insertBtn.disabled) {
        e.preventDefault();
        insertShapeIntoCanvas();
      }
      return;
    }

    if (e.key === "Backspace" || e.key === "Delete") {
      if (state.phase === "drawing" && state.vertices.length > 0) {
        e.preventDefault();
        undoLastVertex();
      }
      return;
    }
  }

  // ───────────────────── Inserimento nel canvas Fabric ───────────────────
  function insertShapeIntoCanvas() {
    if (state.phase !== "editing" || state.vertices.length < 3) return;
    if (typeof canvas === "undefined" || !canvas) return;
    if (canvas.isDrawingMode) {
      if (typeof flashToast === "function") flashToast("Disattiva penna/acquerello prima di inserire la forma");
      return;
    }

    // Copia i vertici e ri-centra il poligono sul proprio centroide,
    // così originX/Y "center" funziona coerentemente con left/top centrali.
    const raw = state.vertices.map((p) => ({ x: p.x, y: p.y }));
    let cxLocal = 0, cyLocal = 0;
    raw.forEach((p) => { cxLocal += p.x; cyLocal += p.y; });
    cxLocal /= raw.length;
    cyLocal /= raw.length;
    const points = raw.map((p) => ({ x: p.x - cxLocal, y: p.y - cyLocal }));

    // ── Centro della porzione di canvas visibile ────────────────────────
    // Stessa identica logica del listener di #addShapeBtn in renderer.js.
    const cs = getComputedStyle(document.documentElement);
    const cssVar = (name) => parseFloat(cs.getPropertyValue(name)) || 0;
    const leftMargin = cssVar("--leftbar-w") + cssVar("--texturepanel-w");
    const topMargin = cssVar("--topbar-h") + cssVar("--bgbar-h");
    const rightMargin = cssVar("--inspector-w");
    const bottomMargin = cssVar("--statusbar-h");

    const screenCx = leftMargin + (window.innerWidth - leftMargin - rightMargin) / 2;
    const screenCy = topMargin + (window.innerHeight - topMargin - bottomMargin) / 2;

    // Schermo → coordinate canvas Fabric.
    const viewObj = (typeof view !== "undefined" && view) ? view : { x: 0, y: 0, scale: 1 };
    const cx = (screenCx - viewObj.x) / viewObj.scale;
    const cy = (screenCy - viewObj.y) / viewObj.scale;

    // ── Costruisci il fabric.Polygon ────────────────────────────────────
    const poly = new fabric.Polygon(points, {
      left: cx,
      top: cy,
      originX: "center",
      originY: "center",
      fill: SHAPE_FILL,
      selectable: true,
      hasControls: true,
      hasBorders: true,
      objectCaching: false
    });

    // Marcatori "anagrafici" per save/load, radial, inspector, duplica.
    poly.__shapeType = "custom";
    poly.__shape = {
      type: "custom",
      // Persistiamo i vertici in mm così su una macchina con calibrazione
      // diversa la forma viene ricostruita a misura reale. Il poligono
      // attuale è già in px, quindi convertiamo solo il payload __shape.
      points_mm: points.map((p) => ({
        x: typeof px2mm === "function" ? px2mm(p.x) : p.x,
        y: typeof px2mm === "function" ? px2mm(p.y) : p.y
      }))
    };
    poly.customId = (typeof generateUID === "function") ? generateUID() : ("custom_" + Date.now());

    // Maniglie visibili come per le altre forme.
    try {
      poly.setControlsVisibility({
        tl: true, tr: true, bl: true, br: true,
        ml: true, mr: true, mt: true, mb: true,
        mtr: true
      });
    } catch (_) {}

    canvas.add(poly);
    if (typeof applyHandlePreset === "function") applyHandlePreset(poly);
    if (typeof updateHandlesSpacing === "function") updateHandlesSpacing(poly);
    canvas.setActiveObject(poly);
    canvas.requestRenderAll();

    // Aggiornamento del menu radiale + overlay misure (positionRadial è
    // l'unica funzione "obbligatoria"; le altre sono difensive).
    if (typeof positionRadial === "function") positionRadial();
    if (typeof updateMeasureOverlay === "function") {
      requestAnimationFrame(() => requestAnimationFrame(updateMeasureOverlay));
    }

    if (typeof flashToast === "function") flashToast("✅ Forma personalizzata inserita");

    closeModal();
  }

  // ───────────────────── Modale: costruzione DOM ─────────────────────────
  function buildModalDOM() {
    if (modalEl) return;

    modalEl = document.createElement("div");
    modalEl.id = "customShapeBuilderModal";
    modalEl.style.cssText = `
      display: none;
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.85);
      z-index: 20003;
      align-items: center;
      justify-content: center;
    `;

    modalEl.innerHTML = `
      <div style="
        background: #1f1f1f;
        padding: 20px 22px;
        border-radius: 12px;
        width: ${PREVIEW_W + 44}px;
        max-width: 95vw;
        max-height: 95vh;
        overflow: auto;
        color: #eee;
        box-shadow: 0 15px 50px rgba(0,0,0,0.8);
      ">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">
          <h3 style="margin:0; font-size:17px;">✏️ Crea forma personalizzata</h3>
          <button id="csbCloseX" title="Chiudi"
                  style="background:none; border:none; color:#aaa; font-size:26px; cursor:pointer; line-height:1;">×</button>
        </div>

        <div id="csbStatus" style="
          font-size:13px;
          line-height:1.45;
          background:#161616;
          border:1px solid #333;
          border-radius:6px;
          padding:8px 10px;
          margin-bottom:10px;
          color:#cfe;
          min-height:18px;
        "></div>

        <div style="display:flex; justify-content:center;">
          <canvas id="csbPreview"
                  width="${PREVIEW_W}" height="${PREVIEW_H}"
                  style="
                    width:${PREVIEW_W}px;
                    height:${PREVIEW_H}px;
                    background:#fafafa;
                    border:1px solid #444;
                    border-radius:6px;
                    cursor:crosshair;
                    display:block;
                  "></canvas>
        </div>

        <div style="
          margin-top:8px;
          font-size:11px;
          color:#888;
          text-align:center;
          line-height:1.4;
        ">
          Click = aggiunge vertice · Invio = chiudi forma (≥3 vertici) ·
          Backspace = rimuovi ultimo vertice · trascina le maniglie per modificare.
        </div>

        <div style="margin-top:16px; display:flex; gap:10px; justify-content:flex-end; flex-wrap:wrap;">
          <button id="csbUndoVertex" title="Rimuovi ultimo vertice (Backspace)"
                  style="padding:9px 14px; background:#444; border:0; border-radius:6px; color:#fff; cursor:pointer; font-size:13px;">
            ↶ Vertice
          </button>
          <button id="csbReset" title="Ricomincia da capo"
                  style="padding:9px 14px; background:#555; border:0; border-radius:6px; color:#fff; cursor:pointer; font-size:13px;">
            🔄 Ricomincia
          </button>
          <button id="csbCancel"
                  style="padding:9px 18px; background:#555; border:0; border-radius:6px; color:#fff; cursor:pointer; font-size:13px;">
            Annulla
          </button>
          <button id="csbInsert" disabled
                  style="padding:9px 22px; background:#2e8b57; border:0; border-radius:6px; color:#fff; cursor:not-allowed; font-weight:600; font-size:13px; opacity:0.4;">
            ✅ Inserisci nel canvas
          </button>
        </div>
      </div>
    `;

    document.body.appendChild(modalEl);

    // Riferimenti agli elementi
    previewCanvas = modalEl.querySelector("#csbPreview");
    insertBtn = modalEl.querySelector("#csbInsert");
    resetBtn = modalEl.querySelector("#csbReset");
    undoVertexBtn = modalEl.querySelector("#csbUndoVertex");
    statusEl = modalEl.querySelector("#csbStatus");

    // Setup DPR per nitidezza su HiDPI
    dpr = Math.max(1, window.devicePixelRatio || 1);
    previewCanvas.width = PREVIEW_W * dpr;
    previewCanvas.height = PREVIEW_H * dpr;
    previewCanvas.style.width = PREVIEW_W + "px";
    previewCanvas.style.height = PREVIEW_H + "px";
    ctx = previewCanvas.getContext("2d");

    // Eventi preview
    previewCanvas.addEventListener("mousedown", onPreviewMouseDown);
    previewCanvas.addEventListener("mousemove", onPreviewMouseMove);
    window.addEventListener("mouseup", onPreviewMouseUp);
    previewCanvas.addEventListener("mouseleave", onPreviewMouseLeave);

    // Tastiera globale (Invio / Backspace) — attiva solo quando modale visibile
    document.addEventListener("keydown", onPreviewKeyDown);

    // Pulsanti
    modalEl.querySelector("#csbCloseX").addEventListener("click", closeModal);
    modalEl.querySelector("#csbCancel").addEventListener("click", closeModal);
    resetBtn.addEventListener("click", resetState);
    undoVertexBtn.addEventListener("click", undoLastVertex);
    insertBtn.addEventListener("click", insertShapeIntoCanvas);

    // Click sul backdrop chiude il modale
    modalEl.addEventListener("click", (e) => {
      if (e.target === modalEl) closeModal();
    });
  }

  // ───────────────────── Open / Close modale ─────────────────────────────
  function openModal() {
    // Coerenza con #addShapeBtn: se siamo in modalità disegno, niente forma.
    if (typeof canvas !== "undefined" && canvas && canvas.isDrawingMode) {
      if (typeof flashToast === "function") flashToast("Disattiva penna/acquerello per creare una forma");
      return;
    }
    buildModalDOM();
    resetState();
    modalEl.style.display = "flex";
    // mette il focus al modale così Invio/Backspace funzionano subito
    try { previewCanvas.focus({ preventScroll: true }); } catch (_) {}
    render();
    updateUI();
  }

  function closeModal() {
    if (!modalEl) return;
    modalEl.style.display = "none";
    // svuotiamo lo stato così la prossima apertura riparte pulita
    state.phase = "drawing";
    state.vertices = [];
    state.draggingHandle = -1;
    state.hoverHandle = -1;
  }

  // ───────────────────── Bind del pulsante in toolbar ────────────────────
  function bindToolbarButton() {
    const btn = document.getElementById("customShapeBtn");
    if (!btn || btn.__csbBound) return;
    btn.__csbBound = true;
    btn.addEventListener("click", openModal);
  }

  // ───────────────────── Bootstrap ───────────────────────────────────────
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bindToolbarButton);
  } else {
    bindToolbarButton();
  }

  // Esposizione opzionale per debug / API esterna
  window.openCustomShapeBuilder = openModal;
})();