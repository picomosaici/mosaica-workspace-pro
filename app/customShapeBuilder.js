// ════════════════════════════════════════════════════════════════════════════
//  customShapeBuilder.js
//  ────────────────────────────────────────────────────────────────────────────
//  Modale per creare forme personalizzate (non standard) tracciando
//  click-per-click i vertici di un poligono. Una volta chiusa la forma,
//  l'utente può:
//    • Spostare ogni vertice trascinando la sua maniglia.
//    • Curvare singoli segmenti (Bézier quadratica) trascinando la
//      maniglia rotonda azzurra che compare a metà di ogni lato.
//      Doppio-click o tasto destro sulla maniglia di una curva
//      attiva → riportano il segmento dritto.
//
//  Sull'area di disegno è disponibile:
//    • Zoom (rotella mouse, centrato sul cursore — range 25%–800%).
//    • Pan (Alt + trascinamento, come per il canvas principale).
//    • Bottoni Zoom ⊕ / ⊖ / ⟲ in header.
//    • Righelli mm reali (top + left) calcolati con la stessa
//      calibrazione del canvas principale (px2mm/mm2px).
//    • Indicatore mm della posizione del cursore in status bar.
//
//  Modello di interazione (fase "drawing"):
//   • 1° click  → primo vertice. La linea segue il mouse senza tenere premuto.
//   • 2° click  → fine prima linea, parte la seconda dal punto fissato.
//   • N° click  → … fino a chiudere la forma.
//   • Chiusura  → click sul primo vertice (snap visivo entro CLOSE_SNAP_PX)
//                 OPPURE tasto Invio (con almeno 3 vertici).
//
//  Modello di interazione (fase "editing"):
//   • Maniglie a forma di punto su ogni vertice (drag → sposta vertice).
//   • Maniglie a forma di pallino azzurro su ogni segmento (drag → curva
//     il segmento; doppio-click o tasto destro → reset a retta).
//
//  Inserimento nel canvas:
//   • Pulsante "Inserisci nel canvas" → crea un fabric.Polygon (forme
//     a soli lati dritti) oppure un fabric.Path (almeno un segmento
//     curvato) con __shapeType = "custom" e lo posiziona nel centro
//     geometrico della porzione di canvas EFFETTIVAMENTE visibile
//     (stessa logica di #addShapeBtn).
//   • La forma diventa un cittadino di Mosaica a tutti gli effetti:
//     menu radiale, maniglie azzurre, save/load, undo/redo, duplica,
//     export ecc. funzionano automaticamente perché le proprietà
//     __shape / __shapeType / customId sono già nella whitelist di
//     autoSave.js e di pushState, e perché Fabric ricostruisce sia
//     Polygon sia Path nativamente al loadFromJSON.
//
//  Compatibilità: Fabric.js v5.1.0+
// ════════════════════════════════════════════════════════════════════════════

(function initCustomShapeBuilder() {
  // ───────────────────── Costanti UI ─────────────────────────────────────
  const PREVIEW_W = 640;                 // dimensione logica del viewport (px)
  const PREVIEW_H = 460;
  // La "carta" (world) ha le stesse dimensioni del viewport iniziale: a
  // scale=1 e pan (0,0), world e viewport coincidono. Lo zoom-out permette
  // di vederla per intero anche se i righelli stanno fuori dal margine.
  const WORLD_W = PREVIEW_W;
  const WORLD_H = PREVIEW_H;

  const RULER_SIZE = 22;                 // spessore dei righelli (px CSS)
  const VERTEX_DOT_RADIUS = 4;           // pallini vertici in fase drawing (screen px)
  const HANDLE_RADIUS = 8;               // maniglie vertice in fase editing (screen px)
  const CURVE_HANDLE_RADIUS = 6;         // maniglia curva in fase editing (screen px)
  const HANDLE_HIT_RADIUS = 12;          // tolleranza click sulle maniglie vertice (screen px)
  const CURVE_HIT_RADIUS = 10;           // tolleranza click sulle maniglie curva (screen px)
  const CLOSE_SNAP_PX = 12;              // distanza per snap di chiusura (screen px)
  const MIN_VERTEX_DISTANCE_WORLD = 4;   // distanza minima tra vertici consecutivi (world px)
  const SHAPE_FILL = "rgba(0, 5, 255, 0.79)"; // coerente con addShapeBtn / dblclick

  // Limiti zoom — più ampi del canvas principale perché qui si lavora su
  // uno spazio piccolo e serve precisione fine per posizionare le maniglie.
  const MIN_ZOOM = 0.25;                 // 25%
  const MAX_ZOOM = 8;                    // 800%

  // ───────────────────── Stato del builder ───────────────────────────────
  const state = {
    phase: "drawing",         // 'drawing' | 'editing'
    vertices: [],             // [{x, y}, ...] in coordinate WORLD del preview
    curves: [],               // [{x,y} | null, ...] control point per segmento i→(i+1)%n
    mouseX: -1,               // ultime coord WORLD del cursore
    mouseY: -1,
    mouseClientX: -1,         // ultime coord CLIENT (per pan)
    mouseClientY: -1,
    mouseInside: false,
    snappingToFirst: false,
    draggingVertex: -1,       // indice vertice in drag (editing), -1 se nessuno
    hoverVertex: -1,
    draggingCurve: -1,        // indice segmento la cui maniglia curva è in drag, -1 se nessuno
    hoverCurve: -1,
    // Viewport (pan + zoom interno al modale)
    view: { x: 0, y: 0, scale: 1 },
    panning: false,
    panLast: { x: 0, y: 0 }
  };

  // Riferimenti DOM (popolati alla prima apertura)
  let modalEl = null;
  let stageEl = null;             // container (righelli + canvas)
  let previewCanvas = null;
  let ctx = null;
  let rulerTopCanvas = null;
  let rulerLeftCanvas = null;
  let rulerCtxT = null;
  let rulerCtxL = null;
  let insertBtn = null;
  let resetBtn = null;
  let undoVertexBtn = null;
  let zoomInBtn = null;
  let zoomOutBtn = null;
  let zoomResetBtn = null;
  let zoomLabel = null;
  let statusEl = null;
  let mmCursorEl = null;
  let dpr = 1;

  // ───────────────────── Helpers geometria ───────────────────────────────
  function dist(a, b) {
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    return Math.hypot(dx, dy);
  }

  // Coordinate di trasformazione: WORLD ↔ SCREEN (entrambi in px del preview,
  // PRIMA del DPR). Lo state.view.x/y sono in px screen, lo scale è puro.
  function worldToScreenX(wx) { return wx * state.view.scale + state.view.x; }
  function worldToScreenY(wy) { return wy * state.view.scale + state.view.y; }
  function screenToWorldX(sx) { return (sx - state.view.x) / state.view.scale; }
  function screenToWorldY(sy) { return (sy - state.view.y) / state.view.scale; }

  // Bezier quadratica: punto a t per (A, P, B)
  function quadAt(A, P, B, t) {
    const omt = 1 - t;
    return {
      x: omt * omt * A.x + 2 * omt * t * P.x + t * t * B.x,
      y: omt * omt * A.y + 2 * omt * t * P.y + t * t * B.y
    };
  }
  // Midpoint (t=0.5) della Bezier quadratica
  function quadMid(A, P, B) {
    return {
      x: 0.25 * A.x + 0.5 * P.x + 0.25 * B.x,
      y: 0.25 * A.y + 0.5 * P.y + 0.25 * B.y
    };
  }
  // Control point da "voglio che a t=0.5 la curva passi per M"
  function controlFromMid(A, M, B) {
    return {
      x: 2 * M.x - 0.5 * A.x - 0.5 * B.x,
      y: 2 * M.y - 0.5 * A.y - 0.5 * B.y
    };
  }

  // Per ogni segmento i, restituisce il punto su cui mostrare la maniglia curva.
  // (= midpoint del segmento dritto se curve[i]=null, oppure midpoint della curva
  // se curve[i] è un control point.)
  function curveHandlePos(i) {
    const n = state.vertices.length;
    if (n < 2) return null;
    const A = state.vertices[i];
    const B = state.vertices[(i + 1) % n];
    const P = state.curves[i];
    if (P) return quadMid(A, P, B);
    return { x: 0.5 * (A.x + B.x), y: 0.5 * (A.y + B.y) };
  }

  // Hit test (le distanze sono in SCREEN px, ma confrontiamo con punti WORLD
  // moltiplicando per scale dove serve)
  function findVertexAt(worldP) {
    const tolWorld = HANDLE_HIT_RADIUS / state.view.scale;
    for (let i = 0; i < state.vertices.length; i++) {
      if (dist(worldP, state.vertices[i]) <= tolWorld) return i;
    }
    return -1;
  }
  function findCurveHandleAt(worldP) {
    const tolWorld = CURVE_HIT_RADIUS / state.view.scale;
    const n = state.vertices.length;
    if (n < 2) return -1;
    for (let i = 0; i < n; i++) {
      // In fase drawing la maniglia curva è disponibile solo per gli edge GIÀ
      // chiusi (cioè in editing, dove c'è anche l'edge di chiusura n-1 → 0).
      // Qui findCurveHandleAt è chiamato solo in fase editing, quindi tutti
      // gli edge contano.
      const h = curveHandlePos(i);
      if (h && dist(worldP, h) <= tolWorld) return i;
    }
    return -1;
  }

  function isCloseSnapActive() {
    if (state.phase !== "drawing") return false;
    if (state.vertices.length < 3) return false;
    if (!state.mouseInside) return false;
    const tolWorld = CLOSE_SNAP_PX / state.view.scale;
    return dist({ x: state.mouseX, y: state.mouseY }, state.vertices[0]) <= tolWorld;
  }

  // ───────────────────── Helpers conversione mm ──────────────────────────
  // Usano le funzioni globali px2mm/mm2px del renderer se disponibili,
  // così i righelli del modale parlano la STESSA lingua del canvas principale.
  function _px2mm(px) {
    if (typeof px2mm === "function") return px2mm(px);
    return px;
  }
  function _mm2px(mm) {
    if (typeof mm2px === "function") return mm2px(mm);
    return mm;
  }

  // ───────────────────── Render del preview ──────────────────────────────
  function render() {
    if (!ctx) return;

    // Reset trasformazione e applica DPR
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    // Sfondo del viewport (area "fuori carta")
    ctx.fillStyle = "#2a2a2a";
    ctx.fillRect(0, 0, PREVIEW_W, PREVIEW_H);

    // Applica trasformazione di view (pan + zoom)
    ctx.translate(state.view.x, state.view.y);
    ctx.scale(state.view.scale, state.view.scale);

    // Sfondo "carta"
    ctx.fillStyle = "#fafafa";
    ctx.fillRect(0, 0, WORLD_W, WORLD_H);

    // Griglia in mm: linee leggere ogni 5 mm, più scure ogni 10 mm.
    // Dimensione 1 mm in px world (= mm2px(1) perché world è in px logici).
    const pxPerMm = _mm2px(1);
    if (pxPerMm > 0 && isFinite(pxPerMm)) {
      const mmMaxX = _px2mm(WORLD_W);
      const mmMaxY = _px2mm(WORLD_H);

      // Spessore costante a schermo: 1px / scale
      const lineW = 1 / state.view.scale;
      // ── tick ogni 1 mm: solo se ben visibili (≥4 px screen)
      if (pxPerMm * state.view.scale >= 4) {
        ctx.strokeStyle = "rgba(0,0,0,0.04)";
        ctx.lineWidth = lineW;
        for (let m = 1; m <= mmMaxX; m++) {
          if (m % 5 === 0) continue;
          const x = m * pxPerMm;
          ctx.beginPath();
          ctx.moveTo(x, 0);
          ctx.lineTo(x, WORLD_H);
          ctx.stroke();
        }
        for (let m = 1; m <= mmMaxY; m++) {
          if (m % 5 === 0) continue;
          const y = m * pxPerMm;
          ctx.beginPath();
          ctx.moveTo(0, y);
          ctx.lineTo(WORLD_W, y);
          ctx.stroke();
        }
      }
      // ── tick ogni 5 mm
      ctx.strokeStyle = "rgba(0,0,0,0.09)";
      ctx.lineWidth = lineW;
      for (let m = 5; m <= mmMaxX; m += 5) {
        if (m % 10 === 0) continue;
        const x = m * pxPerMm;
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, WORLD_H);
        ctx.stroke();
      }
      for (let m = 5; m <= mmMaxY; m += 5) {
        if (m % 10 === 0) continue;
        const y = m * pxPerMm;
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(WORLD_W, y);
        ctx.stroke();
      }
      // ── tick ogni 10 mm
      ctx.strokeStyle = "rgba(0,0,0,0.18)";
      ctx.lineWidth = lineW;
      for (let m = 10; m <= mmMaxX; m += 10) {
        const x = m * pxPerMm;
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, WORLD_H);
        ctx.stroke();
      }
      for (let m = 10; m <= mmMaxY; m += 10) {
        const y = m * pxPerMm;
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(WORLD_W, y);
        ctx.stroke();
      }
    }

    // Cornice "carta"
    ctx.strokeStyle = "rgba(0,0,0,0.35)";
    ctx.lineWidth = 1 / state.view.scale;
    ctx.strokeRect(0.5 / state.view.scale, 0.5 / state.view.scale,
                   WORLD_W - 1 / state.view.scale, WORLD_H - 1 / state.view.scale);

    const v = state.vertices;
    const n = v.length;

    // Riempimento (solo in editing, con almeno 3 vertici)
    if (state.phase === "editing" && n >= 3) {
      ctx.beginPath();
      ctx.moveTo(v[0].x, v[0].y);
      for (let i = 0; i < n; i++) {
        const next = v[(i + 1) % n];
        const c = state.curves[i];
        if (c) ctx.quadraticCurveTo(c.x, c.y, next.x, next.y);
        else ctx.lineTo(next.x, next.y);
      }
      ctx.closePath();
      ctx.fillStyle = SHAPE_FILL;
      ctx.fill();
    }

    // Bordo della forma (in drawing: solo segmenti già piazzati, sempre dritti)
    if (n >= 2) {
      ctx.beginPath();
      ctx.moveTo(v[0].x, v[0].y);
      if (state.phase === "editing") {
        for (let i = 0; i < n; i++) {
          const next = v[(i + 1) % n];
          const c = state.curves[i];
          if (c) ctx.quadraticCurveTo(c.x, c.y, next.x, next.y);
          else ctx.lineTo(next.x, next.y);
        }
      } else {
        for (let i = 1; i < n; i++) ctx.lineTo(v[i].x, v[i].y);
      }
      ctx.strokeStyle = "#1e3a8a";
      ctx.lineWidth = 2 / state.view.scale;
      ctx.stroke();
    }

    // Linea agganciata al mouse (solo fase drawing, dopo il 1° click)
    if (state.phase === "drawing" && n >= 1 && state.mouseInside) {
      const last = v[n - 1];
      const snapping = isCloseSnapActive();
      const tx = snapping ? v[0].x : state.mouseX;
      const ty = snapping ? v[0].y : state.mouseY;

      ctx.beginPath();
      ctx.moveTo(last.x, last.y);
      ctx.lineTo(tx, ty);
      ctx.strokeStyle = snapping ? "#16a34a" : "#2b6cff";
      ctx.lineWidth = (snapping ? 2.5 : 2) / state.view.scale;
      const dash = snapping ? [] : [6 / state.view.scale, 4 / state.view.scale];
      ctx.setLineDash(dash);
      ctx.stroke();
      ctx.setLineDash([]);
      state.snappingToFirst = snapping;
    } else {
      state.snappingToFirst = false;
    }

    // ─────────── Maniglie curve (solo in editing) ──────────────
    if (state.phase === "editing" && n >= 3) {
      for (let i = 0; i < n; i++) {
        const h = curveHandlePos(i);
        if (!h) continue;
        const curved = !!state.curves[i];
        const active = i === state.draggingCurve || i === state.hoverCurve;
        const r = (active ? CURVE_HANDLE_RADIUS + 2 : CURVE_HANDLE_RADIUS) / state.view.scale;

        ctx.beginPath();
        ctx.arc(h.x, h.y, r, 0, Math.PI * 2);
        ctx.fillStyle = curved ? "#f59e0b" : "rgba(30, 144, 255, 0.55)";
        ctx.fill();
        ctx.lineWidth = 1.2 / state.view.scale;
        ctx.strokeStyle = curved ? "#7c2d12" : "#0a3a6e";
        ctx.stroke();
      }
    }

    // ─────────── Maniglie / pallini vertici ────────────────────
    for (let i = 0; i < n; i++) {
      const p = v[i];
      const isFirst = i === 0;
      const isHoverClose = state.phase === "drawing" && isFirst && state.snappingToFirst;

      let radius, fill, stroke;
      if (state.phase === "editing") {
        const active = i === state.draggingVertex || i === state.hoverVertex;
        radius = HANDLE_RADIUS / state.view.scale;
        fill = active ? "#00c8ff" : "#1e90ff";
        stroke = "#002244";
      } else {
        radius = (isHoverClose ? HANDLE_RADIUS : VERTEX_DOT_RADIUS) / state.view.scale;
        fill = isHoverClose ? "#16a34a" : isFirst ? "#22c55e" : "#1e90ff";
        stroke = "#002244";
      }

      ctx.beginPath();
      ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
      ctx.fillStyle = fill;
      ctx.fill();
      ctx.lineWidth = 1.5 / state.view.scale;
      ctx.strokeStyle = stroke;
      ctx.stroke();
    }
  }

  // ───────────────────── Render dei righelli mm ──────────────────────────
  function renderRulers() {
    if (!rulerCtxT || !rulerCtxL) return;
    const pxPerMm = _mm2px(1);
    if (!isFinite(pxPerMm) || pxPerMm <= 0) return;

    // ── Ruler superiore ───────────────────────────────────────
    const wT = PREVIEW_W;
    const hT = RULER_SIZE;
    rulerCtxT.setTransform(dpr, 0, 0, dpr, 0, 0);
    rulerCtxT.fillStyle = "#161616";
    rulerCtxT.fillRect(0, 0, wT, hT);
    rulerCtxT.strokeStyle = "#3a3a3a";
    rulerCtxT.lineWidth = 1;
    rulerCtxT.beginPath();
    rulerCtxT.moveTo(0, hT - 0.5);
    rulerCtxT.lineTo(wT, hT - 0.5);
    rulerCtxT.stroke();

    rulerCtxT.fillStyle = "#cfe";
    rulerCtxT.font = "10px system-ui, sans-serif";
    rulerCtxT.textAlign = "left";
    rulerCtxT.textBaseline = "alphabetic";
    rulerCtxT.strokeStyle = "#9aa";

    // Determina mm visibili: per ogni pixel x del viewport calcola mm = px2mm(worldX)
    // ma in pratica disegniamo iterando sui multipli di mm.
    const stepPxScreen = pxPerMm * state.view.scale; // 1 mm a schermo
    const labelEvery = stepPxScreen >= 28 ? 5 : stepPxScreen >= 10 ? 10 : stepPxScreen >= 4 ? 25 : 50;

    // Trova range mm visibili
    const mmStartX = Math.floor(_px2mm(screenToWorldX(0)));
    const mmEndX = Math.ceil(_px2mm(screenToWorldX(PREVIEW_W)));

    for (let m = mmStartX; m <= mmEndX; m++) {
      const wx = _mm2px(m);
      const sx = worldToScreenX(wx);
      if (sx < -2 || sx > wT + 2) continue;
      const isMajor = m % 10 === 0;
      const isMid = m % 5 === 0;
      const len = isMajor ? hT * 0.7 : isMid ? hT * 0.45 : hT * 0.25;
      rulerCtxT.beginPath();
      rulerCtxT.strokeStyle = isMajor ? "#cfe" : "#7a8a8a";
      rulerCtxT.lineWidth = isMajor ? 1.2 : 1;
      rulerCtxT.moveTo(sx + 0.5, hT);
      rulerCtxT.lineTo(sx + 0.5, hT - len);
      rulerCtxT.stroke();
      if (m % labelEvery === 0) {
        rulerCtxT.fillStyle = "#cfe";
        rulerCtxT.fillText(String(m), sx + 2, 10);
      }
    }

    // ── Ruler sinistro ────────────────────────────────────────
    const wL = RULER_SIZE;
    const hL = PREVIEW_H;
    rulerCtxL.setTransform(dpr, 0, 0, dpr, 0, 0);
    rulerCtxL.fillStyle = "#161616";
    rulerCtxL.fillRect(0, 0, wL, hL);
    rulerCtxL.strokeStyle = "#3a3a3a";
    rulerCtxL.lineWidth = 1;
    rulerCtxL.beginPath();
    rulerCtxL.moveTo(wL - 0.5, 0);
    rulerCtxL.lineTo(wL - 0.5, hL);
    rulerCtxL.stroke();

    rulerCtxL.font = "10px system-ui, sans-serif";
    rulerCtxL.textAlign = "center";
    rulerCtxL.textBaseline = "middle";

    const mmStartY = Math.floor(_px2mm(screenToWorldY(0)));
    const mmEndY = Math.ceil(_px2mm(screenToWorldY(PREVIEW_H)));

    for (let m = mmStartY; m <= mmEndY; m++) {
      const wy = _mm2px(m);
      const sy = worldToScreenY(wy);
      if (sy < -2 || sy > hL + 2) continue;
      const isMajor = m % 10 === 0;
      const isMid = m % 5 === 0;
      const len = isMajor ? wL * 0.7 : isMid ? wL * 0.45 : wL * 0.25;
      rulerCtxL.beginPath();
      rulerCtxL.strokeStyle = isMajor ? "#cfe" : "#7a8a8a";
      rulerCtxL.lineWidth = isMajor ? 1.2 : 1;
      rulerCtxL.moveTo(wL, sy + 0.5);
      rulerCtxL.lineTo(wL - len, sy + 0.5);
      rulerCtxL.stroke();
      if (m % labelEvery === 0) {
        rulerCtxL.save();
        rulerCtxL.translate(wL / 2 - 5, sy);
        rulerCtxL.rotate(-Math.PI / 2);
        rulerCtxL.fillStyle = "#cfe";
        rulerCtxL.fillText(String(m), 0, 0);
        rulerCtxL.restore();
      }
    }
  }

  function renderAll() {
    render();
    renderRulers();
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
    if (zoomLabel) zoomLabel.textContent = Math.round(state.view.scale * 100) + "%";
    if (statusEl) {
      if (state.phase === "drawing") {
        const n = state.vertices.length;
        if (n === 0) statusEl.textContent = "Clicca sul preview per piazzare il 1° vertice.";
        else if (n < 3) statusEl.textContent = `${n} vertice/i piazzati. Continua a cliccare per tracciare i lati.`;
        else statusEl.textContent = `${n} vertici. Chiudi la forma cliccando sul 1° vertice (verde) oppure premi Invio.`;
      } else {
        const cn = state.curves.filter(Boolean).length;
        statusEl.textContent =
          `Forma chiusa (${state.vertices.length} vertici, ${cn} curva/e). ` +
          `Trascina i vertici per modellare, le maniglie azzurre a metà lato per curvare ` +
          `(doppio click su una curva = torna dritta).`;
      }
    }
    if (mmCursorEl) {
      if (state.mouseInside) {
        const mx = _px2mm(state.mouseX).toFixed(1);
        const my = _px2mm(state.mouseY).toFixed(1);
        mmCursorEl.textContent = `x: ${mx} mm  y: ${my} mm`;
      } else {
        mmCursorEl.textContent = "";
      }
    }
  }

  // ───────────────────── Stato: helper di mutazione ──────────────────────
  function resetState() {
    state.phase = "drawing";
    state.vertices = [];
    state.curves = [];
    state.draggingVertex = -1;
    state.hoverVertex = -1;
    state.draggingCurve = -1;
    state.hoverCurve = -1;
    state.snappingToFirst = false;
    resetView();
    renderAll();
    updateUI();
  }

  function resetView() {
    state.view = { x: 0, y: 0, scale: 1 };
  }

  function closeShape() {
    if (state.vertices.length < 3) return;
    state.phase = "editing";
    // Inizializza l'array curves con un null per ogni segmento (n segmenti = n vertici per forma chiusa)
    state.curves = new Array(state.vertices.length).fill(null);
    state.draggingVertex = -1;
    state.hoverVertex = -1;
    state.draggingCurve = -1;
    state.hoverCurve = -1;
    renderAll();
    updateUI();
  }

  function undoLastVertex() {
    if (state.phase !== "drawing" || state.vertices.length === 0) return;
    state.vertices.pop();
    renderAll();
    updateUI();
  }

  // ───────────────────── Zoom / Pan ──────────────────────────────────────
  function setZoomCentered(newScale, screenX, screenY) {
    const clamped = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, newScale));
    if (clamped === state.view.scale) return;
    // Punto world sotto al cursore prima dello zoom
    const wx = screenToWorldX(screenX);
    const wy = screenToWorldY(screenY);
    state.view.scale = clamped;
    // Riposiziona pan in modo che (wx, wy) resti sotto a (screenX, screenY)
    state.view.x = screenX - wx * state.view.scale;
    state.view.y = screenY - wy * state.view.scale;
    renderAll();
    updateUI();
  }

  function zoomByFactor(factor, screenX, screenY) {
    const sx = (screenX != null) ? screenX : PREVIEW_W / 2;
    const sy = (screenY != null) ? screenY : PREVIEW_H / 2;
    setZoomCentered(state.view.scale * factor, sx, sy);
  }

  function resetZoom() {
    resetView();
    renderAll();
    updateUI();
  }

  // ───────────────────── Event handlers preview ──────────────────────────
  // Coordinate SCREEN del preview (px CSS, già normalizzate sul viewport)
  function getPreviewScreen(e) {
    const rect = previewCanvas.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) * PREVIEW_W) / rect.width,
      y: ((e.clientY - rect.top) * PREVIEW_H) / rect.height
    };
  }
  // Coordinate WORLD del preview
  function getPreviewWorld(e) {
    const s = getPreviewScreen(e);
    return { x: screenToWorldX(s.x), y: screenToWorldY(s.y), sx: s.x, sy: s.y };
  }

  function onPreviewMouseDown(e) {
    // Pan con Alt + tasto sinistro, o con tasto centrale (rotella premuta)
    const isPan = (e.button === 0 && e.altKey) || e.button === 1;
    if (isPan) {
      e.preventDefault();
      state.panning = true;
      state.panLast.x = e.clientX;
      state.panLast.y = e.clientY;
      previewCanvas.style.cursor = "grabbing";
      return;
    }
    if (e.button !== 0) return; // solo tasto sinistro per il resto

    const p = getPreviewWorld(e);

    if (state.phase === "drawing") {
      // Snap di chiusura sul primo vertice (≥3 vertici)
      if (state.vertices.length >= 3) {
        const tolWorld = CLOSE_SNAP_PX / state.view.scale;
        if (dist(p, state.vertices[0]) <= tolWorld) {
          closeShape();
          return;
        }
      }
      // Limita il vertice ai bounds della "carta"
      const nx = Math.max(0, Math.min(WORLD_W, p.x));
      const ny = Math.max(0, Math.min(WORLD_H, p.y));
      // Aggiungi vertice — ma rifiuta se troppo vicino al precedente
      if (state.vertices.length > 0) {
        const last = state.vertices[state.vertices.length - 1];
        if (dist({ x: nx, y: ny }, last) < MIN_VERTEX_DISTANCE_WORLD) return;
      }
      state.vertices.push({ x: nx, y: ny });
      renderAll();
      updateUI();
      return;
    }

    if (state.phase === "editing") {
      // Priorità: prima maniglie VERTICE (sui bordi del segmento), poi maniglie CURVA (in mezzo).
      const idxV = findVertexAt(p);
      if (idxV !== -1) {
        state.draggingVertex = idxV;
        previewCanvas.style.cursor = "grabbing";
        renderAll();
        return;
      }
      const idxC = findCurveHandleAt(p);
      if (idxC !== -1) {
        state.draggingCurve = idxC;
        previewCanvas.style.cursor = "grabbing";
        renderAll();
        return;
      }
    }
  }

  function onPreviewMouseMove(e) {
    state.mouseClientX = e.clientX;
    state.mouseClientY = e.clientY;

    // Pan in corso
    if (state.panning) {
      const dx = e.clientX - state.panLast.x;
      const dy = e.clientY - state.panLast.y;
      state.panLast.x = e.clientX;
      state.panLast.y = e.clientY;
      // dx/dy sono in px schermo client; previewCanvas è scalato secondo CSS,
      // ma usiamo le sue dimensioni CSS = PREVIEW_W/H, quindi 1:1 fino a quando
      // l'utente non zooma via CSS la finestra. Usiamo il fattore del bounding rect.
      const rect = previewCanvas.getBoundingClientRect();
      const sx = (PREVIEW_W / rect.width) * dx;
      const sy = (PREVIEW_H / rect.height) * dy;
      state.view.x += sx;
      state.view.y += sy;
      renderAll();
      return;
    }

    const p = getPreviewWorld(e);
    state.mouseX = p.x;
    state.mouseY = p.y;
    state.mouseInside = true;

    if (state.phase === "editing") {
      if (state.draggingVertex !== -1) {
        const v = state.vertices[state.draggingVertex];
        v.x = Math.max(0, Math.min(WORLD_W, p.x));
        v.y = Math.max(0, Math.min(WORLD_H, p.y));
      } else if (state.draggingCurve !== -1) {
        // L'utente trascina la maniglia (= midpoint della curva).
        // Calcola il control point P che fa passare la Bézier per il punto trascinato.
        const i = state.draggingCurve;
        const n = state.vertices.length;
        const A = state.vertices[i];
        const B = state.vertices[(i + 1) % n];
        const M = { x: p.x, y: p.y };
        const P = controlFromMid(A, M, B);
        // Limita il control point per evitare che esca completamente fuori carta
        // — è permesso ma con un margine generoso (×2 della carta).
        P.x = Math.max(-WORLD_W, Math.min(2 * WORLD_W, P.x));
        P.y = Math.max(-WORLD_H, Math.min(2 * WORLD_H, P.y));
        state.curves[i] = P;
      } else {
        const idxV = findVertexAt(p);
        if (idxV !== -1) {
          state.hoverVertex = idxV;
          state.hoverCurve = -1;
          previewCanvas.style.cursor = "grab";
        } else {
          const idxC = findCurveHandleAt(p);
          state.hoverVertex = -1;
          state.hoverCurve = idxC;
          previewCanvas.style.cursor = idxC !== -1 ? "grab" : (e.altKey ? "grab" : "default");
        }
      }
    } else {
      if (isCloseSnapActive()) previewCanvas.style.cursor = "pointer";
      else previewCanvas.style.cursor = e.altKey ? "grab" : "crosshair";
    }

    renderAll();
    updateUI();
  }

  function onPreviewMouseUp() {
    if (state.panning) {
      state.panning = false;
      // Ripristina cursore in base allo stato
      previewCanvas.style.cursor = state.phase === "drawing" ? "crosshair" : "default";
      return;
    }
    if (state.phase === "editing") {
      let changed = false;
      if (state.draggingVertex !== -1) { state.draggingVertex = -1; changed = true; }
      if (state.draggingCurve !== -1) { state.draggingCurve = -1; changed = true; }
      if (changed) {
        previewCanvas.style.cursor = "default";
        renderAll();
      }
    }
  }

  function onPreviewMouseLeave() {
    state.mouseInside = false;
    state.snappingToFirst = false;
    // Non interrompiamo il pan se l'utente esce: il mouseup window lo chiude.
    if (!state.panning) {
      if (state.draggingVertex !== -1) state.draggingVertex = -1;
      if (state.draggingCurve !== -1) state.draggingCurve = -1;
    }
    renderAll();
    updateUI();
  }

  function onPreviewWheel(e) {
    // Zoom centrato sul cursore
    e.preventDefault();
    const screen = getPreviewScreen(e);
    const f = Math.exp(-e.deltaY * 0.0015);
    setZoomCentered(state.view.scale * f, screen.x, screen.y);
  }

  function onPreviewDblClick(e) {
    // Doppio click su una maniglia curva → reset segmento a retta
    if (state.phase !== "editing") return;
    const p = getPreviewWorld(e);
    const idxC = findCurveHandleAt(p);
    if (idxC !== -1 && state.curves[idxC]) {
      state.curves[idxC] = null;
      renderAll();
      updateUI();
    }
  }

  function onPreviewContextMenu(e) {
    // Tasto destro su maniglia curva → reset segmento a retta (e niente menu nativo)
    e.preventDefault();
    if (state.phase !== "editing") return;
    const p = getPreviewWorld(e);
    const idxC = findCurveHandleAt(p);
    if (idxC !== -1 && state.curves[idxC]) {
      state.curves[idxC] = null;
      renderAll();
      updateUI();
    }
  }

  function onPreviewKeyDown(e) {
    if (!modalEl || modalEl.style.display === "none") return;

    // Zoom da tastiera: + / - / 0
    if (e.key === "+" || (e.key === "=" && e.shiftKey === false)) {
      e.preventDefault();
      zoomByFactor(1.2);
      return;
    }
    if (e.key === "-" || e.key === "_") {
      e.preventDefault();
      zoomByFactor(1 / 1.2);
      return;
    }
    if (e.key === "0") {
      e.preventDefault();
      resetZoom();
      return;
    }

    if (e.key === "Enter") {
      if (state.phase === "drawing" && state.vertices.length >= 3) {
        e.preventDefault();
        closeShape();
      } else if (state.phase === "editing" && insertBtn && !insertBtn.disabled) {
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

    if (e.key === "Escape") {
      e.preventDefault();
      closeModal();
      return;
    }
  }

  // ───────────────────── Costruzione path SVG (per Path) ─────────────────
  function buildPathString(points, curves) {
    // points e curves sono in coordinate world. n vertici, n segmenti (forma chiusa).
    const n = points.length;
    const f = (v) => (Math.abs(v) < 1e-6 ? 0 : v).toFixed(3);
    const parts = [`M ${f(points[0].x)} ${f(points[0].y)}`];
    for (let i = 0; i < n; i++) {
      const b = points[(i + 1) % n];
      const c = curves[i];
      if (c) parts.push(`Q ${f(c.x)} ${f(c.y)} ${f(b.x)} ${f(b.y)}`);
      else parts.push(`L ${f(b.x)} ${f(b.y)}`);
    }
    parts.push("Z");
    return parts.join(" ");
  }

  function hasAnyCurve() {
    return state.curves.some((c) => !!c);
  }

  // ───────────────────── Inserimento nel canvas Fabric ───────────────────
  function insertShapeIntoCanvas() {
    if (state.phase !== "editing" || state.vertices.length < 3) return;
    if (typeof canvas === "undefined" || !canvas) return;
    if (canvas.isDrawingMode) {
      if (typeof flashToast === "function") flashToast("Disattiva penna/acquerello prima di inserire la forma");
      return;
    }

    // Copia i dati e centra sul centroide dei VERTICI (semplice ed efficace
    // anche in presenza di curve: il centroide del bbox del path verrà
    // gestito da Fabric tramite pathOffset / originX/Y='center').
    const raw = state.vertices.map((p) => ({ x: p.x, y: p.y }));
    let cxLocal = 0, cyLocal = 0;
    raw.forEach((p) => { cxLocal += p.x; cyLocal += p.y; });
    cxLocal /= raw.length;
    cyLocal /= raw.length;
    const pts = raw.map((p) => ({ x: p.x - cxLocal, y: p.y - cyLocal }));
    // Anche i control point delle curve vanno traslati nello stesso sistema centrato
    const ctrls = state.curves.map((c) => c ? ({ x: c.x - cxLocal, y: c.y - cyLocal }) : null);

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

    let shape;
    const curved = hasAnyCurve();

    if (!curved) {
      // ── fabric.Polygon (retrocompatibile: nessuna curva = comportamento storico) ─
      shape = new fabric.Polygon(pts, {
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
    } else {
      // ── fabric.Path (almeno una curva) ───────────────────────────────
      const pathStr = buildPathString(pts, ctrls);
      shape = new fabric.Path(pathStr, {
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
    }

    // Marcatori "anagrafici" per save/load, radial, inspector, duplica.
    shape.__shapeType = "custom";
    shape.__shape = {
      type: "custom",
      // Persistiamo punti e (eventuali) control point delle curve in mm così
      // su una macchina con calibrazione diversa la forma viene ricostruita
      // a misura reale. Il rendering di Fabric usa già le coordinate px
      // del Polygon/Path; questi dati sono "metadati" utili a future re-build.
      hasCurves: curved,
      points_mm: pts.map((p) => ({ x: _px2mm(p.x), y: _px2mm(p.y) })),
      curves_mm: ctrls.map((c) => c ? ({ x: _px2mm(c.x), y: _px2mm(c.y) }) : null)
    };
    shape.customId = (typeof generateUID === "function") ? generateUID() : ("custom_" + Date.now());

    // Maniglie visibili come per le altre forme.
    try {
      shape.setControlsVisibility({
        tl: true, tr: true, bl: true, br: true,
        ml: true, mr: true, mt: true, mb: true,
        mtr: true
      });
    } catch (_) {}

    canvas.add(shape);
    if (typeof applyHandlePreset === "function") applyHandlePreset(shape);
    if (typeof updateHandlesSpacing === "function") updateHandlesSpacing(shape);
    canvas.setActiveObject(shape);
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

    // Dimensione totale stage = righelli (top+left) + preview
    const stageW = RULER_SIZE + PREVIEW_W;
    const stageH = RULER_SIZE + PREVIEW_H;

    modalEl.innerHTML = `
      <div style="
        background: #1f1f1f;
        padding: 20px 22px;
        border-radius: 12px;
        width: ${stageW + 44}px;
        max-width: 95vw;
        max-height: 95vh;
        overflow: auto;
        color: #eee;
        box-shadow: 0 15px 50px rgba(0,0,0,0.8);
      ">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px; gap:10px;">
          <h3 style="margin:0; font-size:17px; flex:1;">✏️ Crea forma personalizzata</h3>
          <div style="display:flex; align-items:center; gap:6px;">
            <button id="csbZoomOut" title="Zoom out (−)"
                    style="width:30px; height:30px; background:#333; border:0; border-radius:6px; color:#fff; cursor:pointer; font-size:16px; line-height:1;">−</button>
            <span id="csbZoomLabel" title="Livello zoom"
                  style="min-width:48px; text-align:center; font-size:12px; color:#cfe; background:#161616; padding:5px 6px; border-radius:6px; border:1px solid #333;">100%</span>
            <button id="csbZoomIn" title="Zoom in (+)"
                    style="width:30px; height:30px; background:#333; border:0; border-radius:6px; color:#fff; cursor:pointer; font-size:16px; line-height:1;">+</button>
            <button id="csbZoomReset" title="Ripristina zoom (0)"
                    style="width:30px; height:30px; background:#333; border:0; border-radius:6px; color:#fff; cursor:pointer; font-size:14px; line-height:1;">⟲</button>
            <button id="csbCloseX" title="Chiudi (Esc)"
                    style="background:none; border:none; color:#aaa; font-size:26px; cursor:pointer; line-height:1; margin-left:6px;">×</button>
          </div>
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
          <div id="csbStage" style="
            position: relative;
            width: ${stageW}px;
            height: ${stageH}px;
            background: #161616;
            border: 1px solid #444;
            border-radius: 6px;
            overflow: hidden;
          ">
            <!-- Angolo top-left -->
            <div style="
              position:absolute; left:0; top:0;
              width:${RULER_SIZE}px; height:${RULER_SIZE}px;
              background:#0f0f0f; border-right:1px solid #3a3a3a; border-bottom:1px solid #3a3a3a;
              z-index:2; font-size:9px; color:#7a8a8a;
              display:flex; align-items:center; justify-content:center;
            ">mm</div>
            <!-- Ruler top -->
            <canvas id="csbRulerTop"
                    width="${PREVIEW_W}" height="${RULER_SIZE}"
                    style="position:absolute; left:${RULER_SIZE}px; top:0;
                           width:${PREVIEW_W}px; height:${RULER_SIZE}px;
                           display:block;"></canvas>
            <!-- Ruler left -->
            <canvas id="csbRulerLeft"
                    width="${RULER_SIZE}" height="${PREVIEW_H}"
                    style="position:absolute; left:0; top:${RULER_SIZE}px;
                           width:${RULER_SIZE}px; height:${PREVIEW_H}px;
                           display:block;"></canvas>
            <!-- Preview -->
            <canvas id="csbPreview"
                    width="${PREVIEW_W}" height="${PREVIEW_H}"
                    style="position:absolute; left:${RULER_SIZE}px; top:${RULER_SIZE}px;
                           width:${PREVIEW_W}px; height:${PREVIEW_H}px;
                           background:#2a2a2a; cursor:crosshair; display:block;"
                    tabindex="0"></canvas>
          </div>
        </div>

        <div style="
          margin-top:8px;
          display:flex;
          justify-content:space-between;
          align-items:center;
          font-size:11px;
          color:#888;
          line-height:1.4;
          gap:10px;
          flex-wrap:wrap;
        ">
          <span>
            Click = vertice · Invio = chiudi (≥3) · Backspace = annulla vertice ·
            rotella = zoom · Alt+drag = pan · doppio click / tasto destro su una curva = raddrizzala
          </span>
          <span id="csbMmCursor" style="color:#cfe; font-family: ui-monospace, Menlo, monospace;"></span>
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
    stageEl = modalEl.querySelector("#csbStage");
    previewCanvas = modalEl.querySelector("#csbPreview");
    rulerTopCanvas = modalEl.querySelector("#csbRulerTop");
    rulerLeftCanvas = modalEl.querySelector("#csbRulerLeft");
    insertBtn = modalEl.querySelector("#csbInsert");
    resetBtn = modalEl.querySelector("#csbReset");
    undoVertexBtn = modalEl.querySelector("#csbUndoVertex");
    zoomInBtn = modalEl.querySelector("#csbZoomIn");
    zoomOutBtn = modalEl.querySelector("#csbZoomOut");
    zoomResetBtn = modalEl.querySelector("#csbZoomReset");
    zoomLabel = modalEl.querySelector("#csbZoomLabel");
    statusEl = modalEl.querySelector("#csbStatus");
    mmCursorEl = modalEl.querySelector("#csbMmCursor");

    // Setup DPR per nitidezza su HiDPI — applicato a TUTTI i canvas
    dpr = Math.max(1, window.devicePixelRatio || 1);
    previewCanvas.width = PREVIEW_W * dpr;
    previewCanvas.height = PREVIEW_H * dpr;
    previewCanvas.style.width = PREVIEW_W + "px";
    previewCanvas.style.height = PREVIEW_H + "px";
    ctx = previewCanvas.getContext("2d");

    rulerTopCanvas.width = PREVIEW_W * dpr;
    rulerTopCanvas.height = RULER_SIZE * dpr;
    rulerTopCanvas.style.width = PREVIEW_W + "px";
    rulerTopCanvas.style.height = RULER_SIZE + "px";
    rulerCtxT = rulerTopCanvas.getContext("2d");

    rulerLeftCanvas.width = RULER_SIZE * dpr;
    rulerLeftCanvas.height = PREVIEW_H * dpr;
    rulerLeftCanvas.style.width = RULER_SIZE + "px";
    rulerLeftCanvas.style.height = PREVIEW_H + "px";
    rulerCtxL = rulerLeftCanvas.getContext("2d");

    // Eventi preview
    previewCanvas.addEventListener("mousedown", onPreviewMouseDown);
    previewCanvas.addEventListener("mousemove", onPreviewMouseMove);
    window.addEventListener("mouseup", onPreviewMouseUp);
    previewCanvas.addEventListener("mouseleave", onPreviewMouseLeave);
    previewCanvas.addEventListener("wheel", onPreviewWheel, { passive: false });
    previewCanvas.addEventListener("dblclick", onPreviewDblClick);
    previewCanvas.addEventListener("contextmenu", onPreviewContextMenu);

    // Tastiera globale (Invio / Backspace / Esc / + / − / 0)
    document.addEventListener("keydown", onPreviewKeyDown);

    // Pulsanti
    modalEl.querySelector("#csbCloseX").addEventListener("click", closeModal);
    modalEl.querySelector("#csbCancel").addEventListener("click", closeModal);
    resetBtn.addEventListener("click", resetState);
    undoVertexBtn.addEventListener("click", undoLastVertex);
    insertBtn.addEventListener("click", insertShapeIntoCanvas);
    zoomInBtn.addEventListener("click", () => zoomByFactor(1.2));
    zoomOutBtn.addEventListener("click", () => zoomByFactor(1 / 1.2));
    zoomResetBtn.addEventListener("click", resetZoom);

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
    // mette il focus al preview così Invio/Backspace/+/−/0 funzionano subito
    try { previewCanvas.focus({ preventScroll: true }); } catch (_) {}
    renderAll();
    updateUI();
  }

  function closeModal() {
    if (!modalEl) return;
    modalEl.style.display = "none";
    // svuotiamo lo stato così la prossima apertura riparte pulita
    state.phase = "drawing";
    state.vertices = [];
    state.curves = [];
    state.draggingVertex = -1;
    state.hoverVertex = -1;
    state.draggingCurve = -1;
    state.hoverCurve = -1;
    state.panning = false;
    resetView();
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
