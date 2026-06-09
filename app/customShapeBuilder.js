// ════════════════════════════════════════════════════════════════════════════
//  customShapeBuilder.js  —  FASE 2B (core)
//  ────────────────────────────────────────────────────────────────────────────
//  Core del builder di forme non standard. In Fase 2B il core diventa estensibile:
//  espone window.CSB (conversioni mm/coordinate, dimensioni foglio, hook di
//  disegno ed eventi) così il modulo immagine di riferimento vive in un file
//  separato (csb-image.js) senza appesantire il core.
//
//  NOVITÀ FASE 2B:
//   • AGGANCIO MODULO IMMAGINE via window.CSB.background.* (no-op se assente):
//       - l'immagine è disegnata SOTTO la griglia, clippata al foglio;
//       - la griglia chiede al modulo il colore consigliato (gridColorHint) e si
//         adatta: immagine chiara → griglia scura (blu, distinguibile dai tratti
//         neri); immagine scura → griglia chiara (ciano);
//       - in "modalità modifica immagine" gli eventi del mouse sono delegati al
//         modulo (sposta/scala), e il tracciamento vertici è sospeso.
//   • ARROTONDAMENTO PER-VERTICE: oltre allo slider globale "Tutti gli angoli"
//     (invariato), si può selezionare un singolo vertice (click) e arrotondare
//     solo quello con lo slider "Angolo selezionato". Raggio memorizzato per
//     vertice (state.cornerRadii).
//
//  FASI PRECEDENTI (mantenute): modale a schermo intero adattivo; carta in mm
//  reali (A4 estendibile); griglia/righelli LOD; colore+opacità forma; blocco
//  inserimento per fogli > A4; export Polygon/Path compatibile Fabric 5.1–5.3.
//
//  Compatibilità: Fabric.js v5.1.0 → v5.3.0
// ════════════════════════════════════════════════════════════════════════════

(function initCustomShapeBuilder() {
  // ── i18n helper (con fallback) ──
  function __ct(key, params, fallback) {
    try {
      if (window.i18n && typeof window.i18n.t === "function") {
        const v = window.i18n.t(key, params);
        if (v === key && fallback != null) return fallback;
        return v;
      }
    } catch (_) {}
    let s = (fallback != null ? String(fallback) : key);
    if (params) {
      s = s.replace(/\{(\w+)\}/g, (m, k) =>
        Object.prototype.hasOwnProperty.call(params, k) ? String(params[k]) : m
      );
    }
    return s;
  }

  // ───────────────────── Costanti UI ─────────────────────────────────────
  const RULER_SIZE = 24;                 // spessore dei righelli (px CSS)
  const VERTEX_DOT_RADIUS = 4;           // pallini vertici in fase drawing (screen px)
  const HANDLE_RADIUS = 8;               // maniglie vertice in fase editing (screen px)
  const CURVE_HANDLE_RADIUS = 6;         // maniglia curva in fase editing (screen px)
  const HANDLE_HIT_RADIUS = 12;          // tolleranza click sulle maniglie vertice (screen px)
  const CURVE_HIT_RADIUS = 10;           // tolleranza click sulle maniglie curva (screen px)
  const CLOSE_SNAP_PX = 12;              // distanza per snap di chiusura (screen px)
  const MIN_VERTEX_DISTANCE_WORLD = 2;   // distanza minima tra vertici consecutivi (world px)
  const SHAPE_FILL = "rgba(0, 5, 255, 0.79)"; // coerente con addShapeBtn / dblclick

  // Limite di zoom-IN assoluto (precisione fine sulle maniglie). Il limite di
  // zoom-OUT è DINAMICO: dipende dalla dimensione del foglio (per poter sempre
  // "adattare alla vista" anche un foglio enorme). Vedi computeZoomLimits().
  const MAX_ZOOM = 12;                   // 1200%
  const FIT_MARGIN = 0.92;               // il foglio occupa il 92% del viewport al fit

  // Cella minima a schermo (px) sotto cui un livello di griglia viene saltato.
  const MIN_GRID_CELL_PX = 6;

  // Preset foglio (mm). "custom" gestito a parte.
  const PAPER_PRESETS = {
    A5: { w: 148, h: 210 },
    A4: { w: 210, h: 297 },
    A3: { w: 297, h: 420 },
    A2: { w: 420, h: 594 },
    A1: { w: 594, h: 841 },
    A0: { w: 841, h: 1189 }
  };
  const DEFAULT_PAPER = { w: 210, h: 297, preset: "A4" };

  // ───────────────────── Stato del builder ───────────────────────────────
  const state = {
    // ── Forme sul foglio ──────────────────────────────────────────────────
    // Si possono creare quante forme si vuole ("software nel software" per la
    // posa palladiana). Ogni forma è un oggetto COMPLETO e INDIPENDENTE:
    //   { vertices:[{x,y}], curves:[{x,y}|null], cornerRadii:[mm],
    //     cornerRadiusMm, fillColorHex, fillAlpha, closed }
    // Coordinate in WORLD px del foglio. La forma "attiva" (in disegno o in
    // modifica) è state.shapes[state.activeIndex].
    shapes: [],
    activeIndex: -1,          // indice forma attiva (-1 = nessuna selezionata)

    // Interazione — riferita alla forma ATTIVA
    mouseX: -1, mouseY: -1,   // ultime coord WORLD del cursore
    mouseInside: false,
    snappingToFirst: false,
    draggingVertex: -1, hoverVertex: -1,
    draggingCurve: -1,  hoverCurve: -1,
    selectedVertex: -1,       // vertice selezionato nella forma attiva (raggio singolo)

    // Spostamento di una forma chiusa (drag del corpo)
    movingShape: -1,          // indice forma in trascinamento, o -1
    hoverShape: -1,           // forma chiusa sotto il cursore (evidenziazione/cursore)
    moveLastWorld: null,      // ultimo punto WORLD durante il move

    // Foglio (carta) in mm reali
    paper: { wMm: DEFAULT_PAPER.w, hMm: DEFAULT_PAPER.h, preset: DEFAULT_PAPER.preset, unit: "mm" },

    // Preferenze aspetto per le NUOVE forme (ultime usate; persistono tra aperture)
    defaults: { fillColorHex: "#0005ff", fillAlpha: 0.79, cornerRadiusMm: 0 },

    // Viewport dinamico (dimensione CSS dell'area di disegno, ricalcolata a runtime)
    vp: { w: 800, h: 600 },

    // Viewport interno (pan + zoom)
    view: { x: 0, y: 0, scale: 1 },
    minZoom: 0.05,            // ricalcolato dinamicamente da computeZoomLimits()
    panning: false,
    panLast: { x: 0, y: 0 }
  };

  // ───────────────────── Forma attiva: accessor & factory ────────────────
  function activeShape() {
    return (state.activeIndex >= 0 && state.activeIndex < state.shapes.length)
      ? state.shapes[state.activeIndex] : null;
  }
  function isDrawing() { const s = activeShape(); return !!s && !s.closed; }
  function isEditing() { const s = activeShape(); return !!s && s.closed; }

  // Crea una nuova forma vuota "in disegno", ereditando le preferenze d'aspetto.
  function newShapeObject() {
    return {
      vertices: [],
      curves: [],
      cornerRadii: [],
      cornerRadiusMm: state.defaults.cornerRadiusMm || 0,
      fillColorHex: state.defaults.fillColorHex || "#0005ff",
      fillAlpha: (typeof state.defaults.fillAlpha === "number") ? state.defaults.fillAlpha : 0.79,
      closed: false
    };
  }
  function resetDragHover() {
    state.draggingVertex = -1; state.hoverVertex = -1;
    state.draggingCurve = -1;  state.hoverCurve = -1;
    state.movingShape = -1;    state.hoverShape = -1;
    state.moveLastWorld = null;
  }

  // Riferimenti DOM (popolati alla prima apertura)
  let modalEl = null;
  let stageEl = null;             // container (righelli + canvas), flessibile
  let previewCanvas = null;
  let ctx = null;
  let rulerTopCanvas = null;
  let rulerLeftCanvas = null;
  let rulerCtxT = null;
  let rulerCtxL = null;
  let insertBtn = null;
  let resetBtn = null;
  let undoVertexBtn = null;
  let newShapeBtn = null;
  let deleteShapeBtn = null;
  let savePalladianaBtn = null;
  let openPalladianaBtn = null;
  let zoomInBtn = null;
  let zoomOutBtn = null;
  let zoomResetBtn = null;
  let fitBtn = null;
  let zoomLabel = null;
  let statusEl = null;
  let mmCursorEl = null;
  let paperSelect = null;
  let paperWInput = null;
  let paperHInput = null;
  let paperApplyBtn = null;
  let paperUnitSelect = null;
  let paperAreaLabel = null;
  let paperSizeLabel = null;
  let fillColorInput = null;
  let fillAlphaInput = null;
  let fillAlphaLabel = null;
  let cornerRadiusInput = null;
  let cornerRadiusLabel = null;
  let cornerOneInput = null;
  let cornerOneLabel = null;
  let imageToolsEl = null;
  let dpr = 1;
  let resizeRaf = 0;

  // ───────────────────── Helpers conversione mm ──────────────────────────
  // Usano le funzioni globali px2mm/mm2px del renderer se disponibili, così i
  // righelli del modale parlano la STESSA lingua del canvas principale.
  function _px2mm(px) { return (typeof px2mm === "function") ? px2mm(px) : px; }
  function _mm2px(mm) { return (typeof mm2px === "function") ? mm2px(mm) : mm; }

  // Dimensione del foglio in px world (dipende dalla calibrazione corrente)
  function paperPxW() { return _mm2px(state.paper.wMm); }
  function paperPxH() { return _mm2px(state.paper.hMm); }

  // ───────────────────── Helpers geometria ───────────────────────────────
  function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }

  // Coordinate WORLD ↔ SCREEN (entrambi px del viewport, PRIMA del DPR)
  function worldToScreenX(wx) { return wx * state.view.scale + state.view.x; }
  function worldToScreenY(wy) { return wy * state.view.scale + state.view.y; }
  function screenToWorldX(sx) { return (sx - state.view.x) / state.view.scale; }
  function screenToWorldY(sy) { return (sy - state.view.y) / state.view.scale; }

  // Bezier quadratica
  function quadAt(A, P, B, t) {
    const omt = 1 - t;
    return {
      x: omt * omt * A.x + 2 * omt * t * P.x + t * t * B.x,
      y: omt * omt * A.y + 2 * omt * t * P.y + t * t * B.y
    };
  }
  function quadMid(A, P, B) {
    return { x: 0.25 * A.x + 0.5 * P.x + 0.25 * B.x,
             y: 0.25 * A.y + 0.5 * P.y + 0.25 * B.y };
  }
  function controlFromMid(A, M, B) {
    return { x: 2 * M.x - 0.5 * A.x - 0.5 * B.x,
             y: 2 * M.y - 0.5 * A.y - 0.5 * B.y };
  }
  function curveHandlePos(i) {
    const sh = activeShape(); if (!sh) return null;
    const n = sh.vertices.length;
    if (n < 2) return null;
    const A = sh.vertices[i];
    const B = sh.vertices[(i + 1) % n];
    const P = sh.curves[i];
    if (P) return quadMid(A, P, B);
    return { x: 0.5 * (A.x + B.x), y: 0.5 * (A.y + B.y) };
  }

  function findVertexAt(worldP) {
    const sh = activeShape(); if (!sh) return -1;
    const tolWorld = HANDLE_HIT_RADIUS / state.view.scale;
    for (let i = 0; i < sh.vertices.length; i++) {
      if (dist(worldP, sh.vertices[i]) <= tolWorld) return i;
    }
    return -1;
  }
  function findCurveHandleAt(worldP) {
    const sh = activeShape(); if (!sh) return -1;
    const tolWorld = CURVE_HIT_RADIUS / state.view.scale;
    const n = sh.vertices.length;
    if (n < 2) return -1;
    for (let i = 0; i < n; i++) {
      const h = curveHandlePos(i);
      if (h && dist(worldP, h) <= tolWorld) return i;
    }
    return -1;
  }
  function isCloseSnapActive() {
    if (!isDrawing()) return false;
    const sh = activeShape();
    if (!sh || sh.vertices.length < 3) return false;
    if (!state.mouseInside) return false;
    const tolWorld = CLOSE_SNAP_PX / state.view.scale;
    return dist({ x: state.mouseX, y: state.mouseY }, sh.vertices[0]) <= tolWorld;
  }

  // ───────────────────── Hit-test del CORPO di una forma chiusa ──────────
  // Ray-casting sul poligono dei vertici (approx. delle curve: sufficiente per
  // selezione/spostamento). Ritorna true se worldP è dentro la forma.
  function pointInPolygon(worldP, verts) {
    const n = verts.length;
    if (n < 3) return false;
    let inside = false;
    for (let i = 0, j = n - 1; i < n; j = i++) {
      const xi = verts[i].x, yi = verts[i].y;
      const xj = verts[j].x, yj = verts[j].y;
      const intersect = ((yi > worldP.y) !== (yj > worldP.y)) &&
        (worldP.x < (xj - xi) * (worldP.y - yi) / ((yj - yi) || 1e-9) + xi);
      if (intersect) inside = !inside;
    }
    return inside;
  }
  // Indice della forma chiusa più "in alto" (ultima disegnata) il cui corpo
  // contiene worldP, oppure -1. Itera dall'ultima alla prima (z-order).
  function shapeAtPoint(worldP) {
    for (let k = state.shapes.length - 1; k >= 0; k--) {
      const sh = state.shapes[k];
      if (sh.closed && sh.vertices.length >= 3 && pointInPolygon(worldP, sh.vertices)) return k;
    }
    return -1;
  }

  // ───────────────────── Aspetto forma: colore + fillet angoli ───────────
  // rgba di riempimento da hex + alpha di UNA forma.
  function fillOf(sh) {
    const hex = ((sh && sh.fillColorHex) || "#0005ff").replace("#", "");
    const r = parseInt(hex.substring(0, 2), 16) || 0;
    const g = parseInt(hex.substring(2, 4), 16) || 0;
    const b = parseInt(hex.substring(4, 6), 16) || 0;
    const a = Math.max(0, Math.min(1, (sh && typeof sh.fillAlpha === "number") ? sh.fillAlpha : 0.79));
    return `rgba(${r}, ${g}, ${b}, ${a})`;
  }
  // Riempimento della forma attiva (compat. con il codice esistente).
  function currentFill() { return fillOf(activeShape()); }

  // Un foglio è "entro A4" se sta dentro un A4 in QUALSIASI orientamento.
  function isWithinA4() {
    const w = state.paper.wMm, h = state.paper.hMm;
    const A = PAPER_PRESETS.A4; // 210 × 297
    const fits = (w <= A.w + 0.5 && h <= A.h + 0.5) || (w <= A.h + 0.5 && h <= A.w + 0.5);
    return fits;
  }

  // Indica se il vertice i della forma ATTIVA è "vivo" (entrambi i lati adiacenti
  // dritti → arrotondabile).
  function isVertexLive(i) {
    const sh = activeShape(); if (!sh) return false;
    const n = sh.vertices.length;
    if (n < 3) return false;
    const prevSeg = (i - 1 + n) % n;
    return !sh.curves[prevSeg] && !sh.curves[i];
  }

  // Genera la sequenza di comandi che descrive il CONTORNO EFFETTIVO della forma
  // chiusa, tenendo conto delle curve dell'utente E dell'arrotondamento degli
  // angoli vivi. `cornerPxArr` è un array (un raggio in px per ogni vertice).
  // Restituisce array di { t:'M'|'L'|'Q', x, y, cx?, cy? } in coordinate WORLD.
  // Usata sia per il render (canvas) sia per l'export (SVG).
  //
  // Un vertice è "vivo" (quindi arrotondabile) solo se ENTRAMBI i lati adiacenti
  // sono dritti (nessuna curva utente). Il raccordo è una Bézier quadratica con
  // control point = vertice originale (stesso meccanismo già usato per le curve,
  // così l'export resta un semplice comando Q, compatibile Fabric 5.1–5.3).
  function effectiveCommands(verts, curves, cornerPxArr) {
    const n = verts.length;
    if (n < 3) return [];

    function fillet(i) {
      const r = (cornerPxArr && cornerPxArr[i]) || 0;
      if (!(r > 0)) return null;
      const prevSeg = (i - 1 + n) % n;   // lato che ARRIVA in i
      const nextSeg = i;                 // lato che PARTE da i
      if (curves[prevSeg] || curves[nextSeg]) return null; // vertice non vivo
      const V = verts[i];
      const A = verts[(i - 1 + n) % n];
      const B = verts[(i + 1) % n];
      const dA = dist(A, V), dB = dist(B, V);
      if (dA < 1e-3 || dB < 1e-3) return null;
      const t = Math.min(r, dA * 0.5, dB * 0.5);
      if (t <= 1e-3) return null;
      const ux = (A.x - V.x) / dA, uy = (A.y - V.y) / dA;
      const wx = (B.x - V.x) / dB, wy = (B.y - V.y) / dB;
      return {
        T1: { x: V.x + ux * t, y: V.y + uy * t }, // ingresso (sul lato prev)
        T2: { x: V.x + wx * t, y: V.y + wy * t }, // uscita (sul lato next)
        V
      };
    }

    const fps = new Array(n);
    for (let i = 0; i < n; i++) fps[i] = fillet(i);

    const cmds = [];
    const start = fps[0] ? fps[0].T2 : verts[0];
    cmds.push({ t: "M", x: start.x, y: start.y });

    for (let i = 0; i < n; i++) {
      const b = (i + 1) % n;
      const cv = curves[i];
      if (cv) {
        cmds.push({ t: "Q", cx: cv.x, cy: cv.y, x: verts[b].x, y: verts[b].y });
      } else {
        const fpb = fps[b];
        if (fpb) {
          cmds.push({ t: "L", x: fpb.T1.x, y: fpb.T1.y });
          cmds.push({ t: "Q", cx: fpb.V.x, cy: fpb.V.y, x: fpb.T2.x, y: fpb.T2.y });
        } else {
          cmds.push({ t: "L", x: verts[b].x, y: verts[b].y });
        }
      }
    }
    return cmds;
  }

  // Array dei raggi (px) per vertice di UNA forma.
  function cornerPxArrayFor(sh) {
    return (sh && sh.cornerRadii ? sh.cornerRadii : []).map((mm) => _mm2px(mm || 0));
  }
  // Compat.: raggi della forma attiva.
  function cornerPxArray() { return cornerPxArrayFor(activeShape()); }

  // Traccia il contorno effettivo sul context (NON chiama begin/closePath).
  function traceShapePath(c2d, cmds) {
    for (let i = 0; i < cmds.length; i++) {
      const c = cmds[i];
      if (c.t === "M") c2d.moveTo(c.x, c.y);
      else if (c.t === "L") c2d.lineTo(c.x, c.y);
      else if (c.t === "Q") c2d.quadraticCurveTo(c.cx, c.cy, c.x, c.y);
    }
  }
  function hasAnyFilletOf(sh) { return !!sh && sh.cornerRadii.some((r) => r > 0); }
  function hasAnyFillet() { return hasAnyFilletOf(activeShape()); }

  // ───────────────────── LOD: scelta passo griglia/righelli ──────────────
  // Restituisce il passo "fine" in mm (potenza di 10: 1, 10, 100, 1000…) tale
  // che a schermo una cella di quel passo sia >= MIN_GRID_CELL_PX. I livelli
  // medio/maggiore sono fine×5 e fine×10. Così la griglia resta sempre leggibile
  // qualunque sia lo zoom o la dimensione del foglio, senza esplosione di linee.
  function pickFineStepMm() {
    const pxPerMmScreen = _mm2px(1) * state.view.scale; // px schermo per 1 mm
    if (!isFinite(pxPerMmScreen) || pxPerMmScreen <= 0) return 1;
    let s = 1; // mm
    // sali finché 1 cella fine non è abbastanza grande
    while (s * pxPerMmScreen < MIN_GRID_CELL_PX) s *= 10;
    // scendi se siamo super-zoomati e anche 1 mm è enorme (non sotto 1 mm:
    // per i mosaici il mm è la risoluzione minima utile).
    return s;
  }

  // Formattazione lunghezza per le etichette dei righelli (mm/cm/m)
  function fmtLen(mm) {
    const a = Math.abs(mm);
    if (a >= 1000 && mm % 1000 === 0) return (mm / 1000) + " m";
    if (a >= 1000) return (mm / 1000).toFixed(2) + " m";
    if (a >= 10 && mm % 10 === 0 && a < 1000) return (mm / 10) + " cm";
    return mm + "";
  }

  // ───────────────────── Limiti zoom dinamici + fit ──────────────────────
  function fitScale() {
    const pw = paperPxW(), ph = paperPxH();
    if (pw <= 0 || ph <= 0) return 1;
    const availW = Math.max(50, state.vp.w);
    const availH = Math.max(50, state.vp.h);
    return Math.min(availW / pw, availH / ph) * FIT_MARGIN;
  }
  function computeZoomLimits() {
    // Si deve poter zoomare-out fino a metà del fit (per "respirare" attorno al
    // foglio) e zoomare-in fino a MAX_ZOOM. Non lasciamo mai minZoom > fit.
    const fs = fitScale();
    state.minZoom = Math.min(fs * 0.5, 0.05, fs); // sempre <= fit
    if (!isFinite(state.minZoom) || state.minZoom <= 0) state.minZoom = 0.0001;
  }
  function clampZoom(s) {
    return Math.max(state.minZoom, Math.min(MAX_ZOOM, s));
  }
  function fitPaper() {
    computeZoomLimits();
    const s = clampZoom(fitScale());
    state.view.scale = s;
    // centra il foglio nel viewport
    state.view.x = (state.vp.w - paperPxW() * s) / 2;
    state.view.y = (state.vp.h - paperPxH() * s) / 2;
  }

  // ───────────────────── Render del foglio + griglia ─────────────────────
  function render() {
    if (!ctx) return;
    const pw = paperPxW(), ph = paperPxH();
    const scale = state.view.scale;

    // Reset trasformazione e applica DPR
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    // Sfondo del viewport (area "fuori foglio")
    ctx.fillStyle = "#262626";
    ctx.fillRect(0, 0, state.vp.w, state.vp.h);

    // Applica trasformazione di view (pan + zoom)
    ctx.translate(state.view.x, state.view.y);
    ctx.scale(scale, scale);

    // Ombra leggera del foglio (in screen px convertiti in world)
    ctx.save();
    ctx.shadowColor = "rgba(0,0,0,0.45)";
    ctx.shadowBlur = 18 / scale;
    ctx.shadowOffsetY = 6 / scale;
    ctx.fillStyle = "#fafafa";
    ctx.fillRect(0, 0, pw, ph);
    ctx.restore();

    // Immagine di riferimento (hook modulo csb-image.js) — SOTTO la griglia,
    // clippata ai bordi del foglio. Se nessun modulo è agganciato è un no-op.
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, pw, ph);
    ctx.clip();
    try { CSB.background.draw(ctx); } catch (_) {}
    ctx.restore();

    // ─────────── Griglia mm adattiva (LOD), solo range visibile ──────────
    drawGrid(pw, ph, scale);

    // Cornice "foglio"
    ctx.strokeStyle = "rgba(0,0,0,0.40)";
    ctx.lineWidth = 1 / scale;
    ctx.strokeRect(0.5 / scale, 0.5 / scale, pw - 1 / scale, ph - 1 / scale);

    // ─────────── Disegno di TUTTE le forme del foglio ───────────────────
    // Prima i corpi (riempimento + bordo) di tutte le forme, in z-order; poi
    // l'overlay interattivo della SOLA forma attiva (linea di disegno, maniglie).
    // CULLING: si saltano le forme il cui bounding-box è interamente fuori dal
    // viewport visibile (cruciale con fogli km/m e migliaia di forme).
    const margWorld = (HANDLE_HIT_RADIUS + 4) / scale; // piccolo margine di sicurezza
    const visMinX = screenToWorldX(0) - margWorld;
    const visMaxX = screenToWorldX(state.vp.w) + margWorld;
    const visMinY = screenToWorldY(0) - margWorld;
    const visMaxY = screenToWorldY(state.vp.h) + margWorld;

    for (let k = 0; k < state.shapes.length; k++) {
      const sh = state.shapes[k];
      const verts = sh.vertices;
      const nn = verts.length;
      if (nn < 2) continue;

      // Bounding-box della forma (in world) + reject se fuori vista. Include i
      // punti di controllo delle curve: un lato bombato può sporgere oltre i vertici.
      let bMinX = Infinity, bMinY = Infinity, bMaxX = -Infinity, bMaxY = -Infinity;
      for (let i = 0; i < nn; i++) {
        const v = verts[i];
        if (v.x < bMinX) bMinX = v.x; if (v.x > bMaxX) bMaxX = v.x;
        if (v.y < bMinY) bMinY = v.y; if (v.y > bMaxY) bMaxY = v.y;
        const c = sh.curves[i];
        if (c) {
          if (c.x < bMinX) bMinX = c.x; if (c.x > bMaxX) bMaxX = c.x;
          if (c.y < bMinY) bMinY = c.y; if (c.y > bMaxY) bMaxY = c.y;
        }
      }
      if (bMaxX < visMinX || bMinX > visMaxX || bMaxY < visMinY || bMinY > visMaxY) continue;

      const isActive = (k === state.activeIndex);
      const isHover = (k === state.hoverShape);

      const eff = (sh.closed && nn >= 3)
        ? effectiveCommands(verts, sh.curves, cornerPxArrayFor(sh))
        : null;

      // Traccia il contorno UNA sola volta, poi fill (se chiusa) + bordo.
      ctx.beginPath();
      if (eff) {
        traceShapePath(ctx, eff);
        ctx.closePath();
        ctx.fillStyle = fillOf(sh);
        ctx.fill();
      } else {
        ctx.moveTo(verts[0].x, verts[0].y);
        for (let i = 1; i < nn; i++) ctx.lineTo(verts[i].x, verts[i].y);
      }
      // Attiva → bordo blu marcato; hover (non attiva) → ciano; altre → blu tenue.
      ctx.strokeStyle = isActive ? "#1e3a8a" : (isHover ? "#0ea5e9" : "#3b5bb5");
      ctx.lineWidth = (isActive ? 2 : (isHover ? 2 : 1.5)) / scale;
      ctx.lineJoin = "round";
      ctx.stroke();
    }

    // ─────────── Overlay interattivo della forma ATTIVA ─────────────────
    const act = activeShape();
    const av = act ? act.vertices : [];
    const an = av.length;

    // Linea agganciata al mouse (mentre si disegna la forma attiva)
    if (act && !act.closed && an >= 1 && state.mouseInside) {
      const last = av[an - 1];
      const snapping = isCloseSnapActive();
      const tx = snapping ? av[0].x : state.mouseX;
      const ty = snapping ? av[0].y : state.mouseY;
      ctx.beginPath();
      ctx.moveTo(last.x, last.y);
      ctx.lineTo(tx, ty);
      ctx.strokeStyle = snapping ? "#16a34a" : "#2b6cff";
      ctx.lineWidth = (snapping ? 2.5 : 2) / scale;
      const dash = snapping ? [] : [6 / scale, 4 / scale];
      ctx.setLineDash(dash);
      ctx.stroke();
      ctx.setLineDash([]);
      state.snappingToFirst = snapping;
    } else {
      state.snappingToFirst = false;
    }

    // Maniglie curve (solo forma attiva, chiusa)
    if (act && act.closed && an >= 3) {
      for (let i = 0; i < an; i++) {
        const h = curveHandlePos(i);
        if (!h) continue;
        const curved = !!act.curves[i];
        const hot = i === state.draggingCurve || i === state.hoverCurve;
        const r = (hot ? CURVE_HANDLE_RADIUS + 2 : CURVE_HANDLE_RADIUS) / scale;
        ctx.beginPath();
        ctx.arc(h.x, h.y, r, 0, Math.PI * 2);
        ctx.fillStyle = curved ? "#f59e0b" : "rgba(30, 144, 255, 0.55)";
        ctx.fill();
        ctx.lineWidth = 1.2 / scale;
        ctx.strokeStyle = curved ? "#7c2d12" : "#0a3a6e";
        ctx.stroke();
      }
    }

    // Maniglie / pallini vertici (solo forma attiva)
    for (let i = 0; i < an; i++) {
      const p = av[i];
      const isFirst = i === 0;
      const drawingNow = !act.closed;
      const isHoverClose = drawingNow && isFirst && state.snappingToFirst;
      const isSelected = act.closed && i === state.selectedVertex;
      let radius, fill, stroke;
      if (act.closed) {
        const hot = i === state.draggingVertex || i === state.hoverVertex;
        radius = HANDLE_RADIUS / scale;
        fill = hot ? "#00c8ff" : "#1e90ff";
        stroke = "#002244";
      } else {
        radius = (isHoverClose ? HANDLE_RADIUS : VERTEX_DOT_RADIUS) / scale;
        fill = isHoverClose ? "#16a34a" : isFirst ? "#22c55e" : "#1e90ff";
        stroke = "#002244";
      }
      if (isSelected) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, radius + 4 / scale, 0, Math.PI * 2);
        ctx.lineWidth = 2 / scale;
        ctx.strokeStyle = "#fbbf24";
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
      ctx.fillStyle = fill;
      ctx.fill();
      ctx.lineWidth = 1.5 / scale;
      ctx.strokeStyle = stroke;
      ctx.stroke();
    }

    // Overlay del modulo immagine (maniglie sposta/scala) — in SCREEN space,
    // sopra tutto. No-op se nessun modulo è agganciato o non in modalità modifica.
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    try { CSB.background.drawOverlay(ctx); } catch (_) {}
  }

  // Sceglie i 3 colori della griglia (fine/medio/maggiore) in base alla
  // luminanza dell'eventuale immagine di sfondo:
  //   • nessuna immagine (foglio bianco) → griglia scura quasi-nera (come Fase 2A)
  //   • immagine CHIARA (es. foglio bianco con linee/scritte nere, scala di grigi)
  //       → griglia SCURA, ma con tinta blu (non nero puro) così resta distinguibile
  //         dai tratti neri del disegno
  //   • immagine SCURA → griglia CHIARA (ciano tenue)
  // Le opacità su immagine sono più alte che su foglio bianco, per leggibilità.
  function gridColors() {
    let hint = null;
    try { hint = CSB.background.gridColorHint(); } catch (_) { hint = null; }
    if (!hint) {
      return {
        fine: "rgba(0,0,0,0.11)", mid: "rgba(0,0,0,0.20)", major: "rgba(0,0,0,0.36)"
      };
    }
    if (hint.dark) {
      // griglia scura (tinta blu) su immagine chiara
      const c = "25,55,120";
      return {
        fine: `rgba(${c},0.30)`, mid: `rgba(${c},0.48)`, major: `rgba(${c},0.70)`
      };
    }
    // griglia chiara (ciano tenue) su immagine scura
    const c = "200,235,255";
    return {
      fine: `rgba(${c},0.28)`, mid: `rgba(${c},0.46)`, major: `rgba(${c},0.68)`
    };
  }

  // Disegna la griglia mm adattiva, limitata alla porzione di foglio visibile.
  // Il colore si adatta all'eventuale immagine di sfondo (vedi gridColors()).
  function drawGrid(pw, ph, scale) {
    const pxPerMm = _mm2px(1);
    if (!(pxPerMm > 0 && isFinite(pxPerMm))) return;

    const fine = pickFineStepMm();      // mm
    const mid = fine * 5;               // mm
    const major = fine * 10;            // mm
    const lineW = 1 / scale;

    // Range mm visibile sul foglio (clamp ai bordi del foglio)
    const wMm = state.paper.wMm, hMm = state.paper.hMm;
    const x0 = Math.max(0, _px2mm(screenToWorldX(0)));
    const x1 = Math.min(wMm, _px2mm(screenToWorldX(state.vp.w)));
    const y0 = Math.max(0, _px2mm(screenToWorldY(0)));
    const y1 = Math.min(hMm, _px2mm(screenToWorldY(state.vp.h)));
    if (x1 < x0 || y1 < y0) return;

    const startX = Math.floor(x0 / fine) * fine;
    const startY = Math.floor(y0 / fine) * fine;

    // Helper: disegna le verticali con un dato passo/colore, saltando i multipli
    // di "skip" (per non sovrascrivere il livello superiore).
    function vlines(stepMm, color, skipMm) {
      ctx.strokeStyle = color;
      ctx.lineWidth = lineW;
      for (let m = Math.floor(x0 / stepMm) * stepMm; m <= x1 + 1e-6; m += stepMm) {
        if (m < 0 || m > wMm) continue;
        if (skipMm && Math.abs(m % skipMm) < 1e-6) continue;
        const x = _mm2px(m);
        ctx.beginPath();
        ctx.moveTo(x, _mm2px(Math.max(0, y0)));
        ctx.lineTo(x, _mm2px(Math.min(hMm, y1)));
        ctx.stroke();
      }
    }
    function hlines(stepMm, color, skipMm) {
      ctx.strokeStyle = color;
      ctx.lineWidth = lineW;
      for (let m = Math.floor(y0 / stepMm) * stepMm; m <= y1 + 1e-6; m += stepMm) {
        if (m < 0 || m > hMm) continue;
        if (skipMm && Math.abs(m % skipMm) < 1e-6) continue;
        const y = _mm2px(m);
        ctx.beginPath();
        ctx.moveTo(_mm2px(Math.max(0, x0)), y);
        ctx.lineTo(_mm2px(Math.min(wMm, x1)), y);
        ctx.stroke();
      }
    }

    const gc = gridColors();
    // Livello FINE — solo se la cella resta ben visibile
    if (fine * pxPerMm * scale >= MIN_GRID_CELL_PX) {
      vlines(fine, gc.fine, mid);
      hlines(fine, gc.fine, mid);
    }
    // Livello MEDIO
    if (mid * pxPerMm * scale >= MIN_GRID_CELL_PX) {
      vlines(mid, gc.mid, major);
      hlines(mid, gc.mid, major);
    }
    // Livello MAGGIORE
    vlines(major, gc.major, 0);
    hlines(major, gc.major, 0);

    // evita warning "unused" su startX/startY (servono a documentare l'allineamento)
    void startX; void startY;
  }

  // ───────────────────── Render dei righelli (LOD) ───────────────────────
  function renderRulers() {
    if (!rulerCtxT || !rulerCtxL) return;
    const pxPerMm = _mm2px(1);
    if (!isFinite(pxPerMm) || pxPerMm <= 0) return;

    const fine = pickFineStepMm();
    const mid = fine * 5;
    const major = fine * 10;
    // Etichette: ogni "major" se c'è spazio, altrimenti ogni major×5
    const majorPxScreen = _mm2px(major) * state.view.scale;
    const labelStepMm = majorPxScreen >= 46 ? major : major * 5;

    // ── Ruler superiore ───────────────────────────────────────
    const wT = state.vp.w, hT = RULER_SIZE;
    rulerCtxT.setTransform(dpr, 0, 0, dpr, 0, 0);
    rulerCtxT.clearRect(0, 0, wT, hT);
    rulerCtxT.fillStyle = "#171717";
    rulerCtxT.fillRect(0, 0, wT, hT);
    rulerCtxT.strokeStyle = "#3a3a3a";
    rulerCtxT.lineWidth = 1;
    rulerCtxT.beginPath(); rulerCtxT.moveTo(0, hT - 0.5); rulerCtxT.lineTo(wT, hT - 0.5); rulerCtxT.stroke();
    rulerCtxT.font = "10px system-ui, sans-serif";
    rulerCtxT.textAlign = "left";
    rulerCtxT.textBaseline = "alphabetic";

    const xMinMm = _px2mm(screenToWorldX(0));
    const xMaxMm = _px2mm(screenToWorldX(wT));
    for (let m = Math.floor(xMinMm / fine) * fine; m <= xMaxMm; m += fine) {
      const sx = worldToScreenX(_mm2px(m));
      if (sx < -2 || sx > wT + 2) continue;
      const isMajor = Math.abs(m % major) < 1e-6;
      const isMid = Math.abs(m % mid) < 1e-6;
      const len = isMajor ? hT * 0.70 : isMid ? hT * 0.45 : hT * 0.25;
      rulerCtxT.beginPath();
      rulerCtxT.strokeStyle = isMajor ? "#9fd6ff" : "#6b7d7d";
      rulerCtxT.lineWidth = isMajor ? 1.2 : 1;
      rulerCtxT.moveTo(sx + 0.5, hT);
      rulerCtxT.lineTo(sx + 0.5, hT - len);
      rulerCtxT.stroke();
      if (Math.abs(m % labelStepMm) < 1e-6) {
        rulerCtxT.fillStyle = "#cfe";
        rulerCtxT.fillText(fmtLen(m), sx + 2, 10);
      }
    }

    // ── Ruler sinistro ────────────────────────────────────────
    const wL = RULER_SIZE, hL = state.vp.h;
    rulerCtxL.setTransform(dpr, 0, 0, dpr, 0, 0);
    rulerCtxL.clearRect(0, 0, wL, hL);
    rulerCtxL.fillStyle = "#171717";
    rulerCtxL.fillRect(0, 0, wL, hL);
    rulerCtxL.strokeStyle = "#3a3a3a";
    rulerCtxL.lineWidth = 1;
    rulerCtxL.beginPath(); rulerCtxL.moveTo(wL - 0.5, 0); rulerCtxL.lineTo(wL - 0.5, hL); rulerCtxL.stroke();
    rulerCtxL.font = "10px system-ui, sans-serif";
    rulerCtxL.textAlign = "center";
    rulerCtxL.textBaseline = "middle";

    const yMinMm = _px2mm(screenToWorldY(0));
    const yMaxMm = _px2mm(screenToWorldY(hL));
    for (let m = Math.floor(yMinMm / fine) * fine; m <= yMaxMm; m += fine) {
      const sy = worldToScreenY(_mm2px(m));
      if (sy < -2 || sy > hL + 2) continue;
      const isMajor = Math.abs(m % major) < 1e-6;
      const isMid = Math.abs(m % mid) < 1e-6;
      const len = isMajor ? wL * 0.70 : isMid ? wL * 0.45 : wL * 0.25;
      rulerCtxL.beginPath();
      rulerCtxL.strokeStyle = isMajor ? "#9fd6ff" : "#6b7d7d";
      rulerCtxL.lineWidth = isMajor ? 1.2 : 1;
      rulerCtxL.moveTo(wL, sy + 0.5);
      rulerCtxL.lineTo(wL - len, sy + 0.5);
      rulerCtxL.stroke();
      if (Math.abs(m % labelStepMm) < 1e-6) {
        rulerCtxL.save();
        rulerCtxL.translate(wL / 2 - 5, sy);
        rulerCtxL.rotate(-Math.PI / 2);
        rulerCtxL.fillStyle = "#cfe";
        rulerCtxL.fillText(fmtLen(m), 0, 0);
        rulerCtxL.restore();
      }
    }
  }

  function renderAll() {
    render();
    renderRulers();
  }

  // Coalescenza: più mousemove ravvicinati producono UN solo redraw per frame
  // (~60fps). Lo stato (cursore, hover) si aggiorna comunque subito; qui si
  // batcha solo il disegno, che è la parte costosa con molte forme.
  let renderRaf = 0;
  function scheduleRenderAll() {
    if (renderRaf) return;
    renderRaf = requestAnimationFrame(() => {
      renderRaf = 0;
      renderAll();
      updateUI();
    });
  }

  // ───────────────────── Layout (dimensiona i canvas) ────────────────────
  // Calcola la dimensione del viewport in base allo stage e (ri)dimensiona tutti
  // i canvas in HiDPI. Va richiamata all'apertura e a ogni resize della finestra.
  function layout(doFit) {
    if (!stageEl) return;
    const rect = stageEl.getBoundingClientRect();
    const vw = Math.max(120, Math.floor(rect.width) - RULER_SIZE);
    const vh = Math.max(120, Math.floor(rect.height) - RULER_SIZE);
    state.vp.w = vw;
    state.vp.h = vh;

    dpr = Math.max(1, window.devicePixelRatio || 1);

    // Preview
    previewCanvas.style.left = RULER_SIZE + "px";
    previewCanvas.style.top = RULER_SIZE + "px";
    previewCanvas.style.width = vw + "px";
    previewCanvas.style.height = vh + "px";
    previewCanvas.width = Math.round(vw * dpr);
    previewCanvas.height = Math.round(vh * dpr);

    // Ruler top
    rulerTopCanvas.style.left = RULER_SIZE + "px";
    rulerTopCanvas.style.top = "0px";
    rulerTopCanvas.style.width = vw + "px";
    rulerTopCanvas.style.height = RULER_SIZE + "px";
    rulerTopCanvas.width = Math.round(vw * dpr);
    rulerTopCanvas.height = Math.round(RULER_SIZE * dpr);

    // Ruler left
    rulerLeftCanvas.style.left = "0px";
    rulerLeftCanvas.style.top = RULER_SIZE + "px";
    rulerLeftCanvas.style.width = RULER_SIZE + "px";
    rulerLeftCanvas.style.height = vh + "px";
    rulerLeftCanvas.width = Math.round(RULER_SIZE * dpr);
    rulerLeftCanvas.height = Math.round(vh * dpr);

    computeZoomLimits();
    if (doFit) fitPaper();
    else {
      // mantieni lo zoom ma assicura che resti nei limiti
      state.view.scale = clampZoom(state.view.scale);
    }
    renderAll();
    updateUI();
  }

  function onWindowResize() {
    if (!modalEl || modalEl.style.display === "none") return;
    if (resizeRaf) cancelAnimationFrame(resizeRaf);
    resizeRaf = requestAnimationFrame(() => { resizeRaf = 0; layout(false); });
  }

  // ───────────────────── Aggiornamento UI ────────────────────────────────
  function countClosed() {
    let c = 0;
    for (const sh of state.shapes) if (sh.closed && sh.vertices.length >= 3) c++;
    return c;
  }

  function updateUI() {
    const withinA4 = isWithinA4();
    const act = activeShape();
    const closedCount = countClosed();

    if (insertBtn) {
      // ≤A4: inserisce TUTTE le forme chiuse del foglio. >A4: solo palladiana.
      const enabled = withinA4 && closedCount >= 1;
      insertBtn.disabled = !enabled;
      insertBtn.style.opacity = enabled ? "1" : "0.4";
      insertBtn.style.cursor = enabled ? "pointer" : "not-allowed";
      insertBtn.title = withinA4
        ? (closedCount > 1
            ? __ct("csb.insert.titleMany", { count: closedCount }, `Inserisci tutte le ${closedCount} forme nel canvas del mosaico`)
            : __ct("csb.insert.titleOne", null, "Inserisci la forma nel canvas del mosaico"))
        : __ct("csb.insert.titleDisabled", null, "Fogli più grandi di A4 → solo progetto palladiana (inserimento disabilitato)");
      insertBtn.textContent = (withinA4 && closedCount > 1)
        ? __ct("csb.insert.btnMany", { count: closedCount }, `✅ Inserisci ${closedCount} forme`)
        : __ct("csb.insert.btn", null, "✅ Inserisci nel canvas");
    }
    if (undoVertexBtn) {
      const enabled = isDrawing() && act && act.vertices.length > 0;
      undoVertexBtn.disabled = !enabled;
      undoVertexBtn.style.opacity = enabled ? "1" : "0.4";
      undoVertexBtn.style.cursor = enabled ? "pointer" : "not-allowed";
    }
    if (newShapeBtn) {
      // Si può iniziare una nuova forma se non si è nel mezzo di una incompleta.
      const blocked = isDrawing() && act && act.vertices.length > 0 && act.vertices.length < 3;
      newShapeBtn.disabled = false; // sempre cliccabile; se bloccato avvisa con toast
      newShapeBtn.style.opacity = blocked ? "0.6" : "1";
      newShapeBtn.style.cursor = "pointer";
    }
    if (deleteShapeBtn) {
      const enabled = !!act;
      deleteShapeBtn.disabled = !enabled;
      deleteShapeBtn.style.opacity = enabled ? "1" : "0.4";
      deleteShapeBtn.style.cursor = enabled ? "pointer" : "not-allowed";
    }
    if (savePalladianaBtn) {
      const enabled = closedCount >= 1;
      savePalladianaBtn.disabled = !enabled;
      savePalladianaBtn.style.opacity = enabled ? "1" : "0.4";
      savePalladianaBtn.style.cursor = enabled ? "pointer" : "not-allowed";
      savePalladianaBtn.title = enabled
        ? __ct("csb.modal.savePalTitle", null, "Salva il foglio come progetto palladiana (.mspp.json)")
        : __ct("csb.save.titleDisabled", null, "Chiudi almeno una forma per poter salvare il progetto palladiana");
    }

    if (cornerRadiusLabel) cornerRadiusLabel.textContent = (act ? act.cornerRadiusMm : state.defaults.cornerRadiusMm) + " mm";

    // Slider "Angolo selezionato": attivo solo su un vertice vivo selezionato.
    if (cornerOneInput) {
      const sel = state.selectedVertex;
      const editing = isEditing();
      const radii = act ? act.cornerRadii : [];
      const hasSel = editing && sel >= 0 && sel < radii.length;
      const live = hasSel && isVertexLive(sel);
      cornerOneInput.disabled = !live;
      cornerOneInput.style.opacity = live ? "1" : "0.4";
      cornerOneInput.style.cursor = live ? "pointer" : "not-allowed";
      if (hasSel) cornerOneInput.value = radii[sel] || 0;
      if (cornerOneLabel) {
        if (!editing) cornerOneLabel.textContent = "—";
        else if (!hasSel) cornerOneLabel.textContent = __ct("csb.label.none", null, "nessuno");
        else if (!live) cornerOneLabel.textContent = __ct("csb.label.curvedSide", { v: sel + 1 }, `V${sel + 1}: lato curvo`);
        else cornerOneLabel.textContent = `V${sel + 1}: ${radii[sel] || 0} mm`;
      }
    }
    if (zoomLabel) zoomLabel.textContent = Math.round(state.view.scale * 100) + "%";
    if (paperSizeLabel) {
      paperSizeLabel.textContent =
        `${state.paper.preset !== "custom" ? state.paper.preset + " · " : ""}${state.paper.wMm}×${state.paper.hMm} mm` +
        (withinA4 ? "" : __ct("csb.paper.palladianaOnly", null, "  (solo palladiana)"));
    }
    if (statusEl) {
      const total = closedCount;
      const pall = withinA4 ? "" : __ct("csb.status.palladianaWarn", null, " ⚠️ Foglio palladiana (>A4): usa 💾 Salva palladiana — l'inserimento nel mosaico è disattivato.");
      const prefix = total > 0 ? __ct("csb.status.shapesOnSheet", { total }, `Forme sul foglio: ${total}. `) : "";
      if (isDrawing()) {
        const n = act ? act.vertices.length : 0;
        if (n === 0) statusEl.textContent = prefix + __ct("csb.status.placeFirst", null, "Clicca sul foglio per piazzare il 1° vertice.") + pall;
        else if (n < 3) statusEl.textContent = prefix + __ct("csb.status.placeN", { n }, `${n} vertice/i piazzati. Continua a cliccare per tracciare i lati.`) + pall;
        else statusEl.textContent = prefix + __ct("csb.status.closeHint", { n }, `${n} vertici. Chiudi la forma cliccando sul 1° vertice (verde) o premi Invio.`) + pall;
      } else if (isEditing()) {
        const cn = act.curves.filter(Boolean).length;
        statusEl.textContent = prefix +
          __ct("csb.status.editHead", { v: act.vertices.length, c: cn }, `Forma selezionata (${act.vertices.length} vertici, ${cn} curva/e). `) +
          __ct("csb.status.editBody", null, `Trascina il corpo per spostarla, i vertici per modellarla, le maniglie a metà lato per curvare. `) +
          __ct("csb.status.editFoot", null, `➕ Nuova forma (o doppio click) · 🗑/Canc per eliminarla.`) + pall;
      } else {
        statusEl.textContent = prefix +
          "Clicca una forma per selezionarla e spostarla/modificarla; doppio click sul vuoto (o ➕ Nuova forma) per disegnarne una." + pall;
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
  // Allinea i 3 controlli aspetto (colore/opacità/tutti-angoli) alla forma
  // attiva, o ai default se nessuna è attiva.
  function syncShapeControls() {
    const a = activeShape();
    const col = a ? a.fillColorHex : state.defaults.fillColorHex;
    const alp = a ? a.fillAlpha : state.defaults.fillAlpha;
    const cr  = a ? a.cornerRadiusMm : state.defaults.cornerRadiusMm;
    if (fillColorInput) fillColorInput.value = col || "#0005ff";
    if (fillAlphaInput) fillAlphaInput.value = Math.round((typeof alp === "number" ? alp : 0.79) * 100);
    if (fillAlphaLabel) fillAlphaLabel.textContent = Math.round((typeof alp === "number" ? alp : 0.79) * 100) + "%";
    if (cornerRadiusInput) cornerRadiusInput.value = cr || 0;
  }

  // "Ricomincia": svuota TUTTO il foglio e riparte con una forma vuota in disegno.
  function resetState() {
    state.shapes = [newShapeObject()];
    state.activeIndex = 0;
    state.selectedVertex = -1;
    resetDragHover();
    state.snappingToFirst = false;
    fitPaper();
    syncShapeControls();
    renderAll();
    updateUI();
  }

  // Chiude la forma ATTIVA (in disegno) e la lascia selezionata in modifica.
  function closeShape() {
    const sh = activeShape();
    if (!sh || sh.closed || sh.vertices.length < 3) return;
    sh.closed = true;
    const n = sh.vertices.length;
    sh.curves = new Array(n).fill(null);
    // I raggi per-vertice partono dal valore "Tutti gli angoli" della forma.
    sh.cornerRadii = new Array(n).fill(sh.cornerRadiusMm || 0);
    state.selectedVertex = -1;
    resetDragHover();
    renderAll();
    updateUI();
  }

  function undoLastVertex() {
    const sh = activeShape();
    if (!isDrawing() || !sh || sh.vertices.length === 0) return;
    sh.vertices.pop();
    renderAll();
    updateUI();
  }

  // ➕ Inizia una nuova forma. Se quella attiva è in disegno con ≥3 vertici la
  // chiude prima (così non si perde); se è incompleta (<3) avvisa e non procede.
  function startNewShape() {
    const sh = activeShape();
    if (isDrawing() && sh && sh.vertices.length > 0 && sh.vertices.length < 3) {
      if (typeof flashToast === "function")
        flashToast(__ct("csb.toast.completeFirst", null, "Completa la forma corrente (almeno 3 vertici) o annullala prima di iniziarne un'altra"));
      return;
    }
    if (isDrawing() && sh && sh.vertices.length >= 3) closeShape();
    // Se la forma attiva è vuota e in disegno, riusala invece di crearne un'altra.
    if (isDrawing() && sh && sh.vertices.length === 0) {
      // già pronta una forma vuota in disegno: niente da fare
    } else {
      state.shapes.push(newShapeObject());
      state.activeIndex = state.shapes.length - 1;
    }
    state.selectedVertex = -1;
    resetDragHover();
    syncShapeControls();
    renderAll();
    updateUI();
  }

  // Seleziona una forma chiusa (per modifica/spostamento).
  function selectShape(index) {
    if (index < 0 || index >= state.shapes.length) return;
    state.activeIndex = index;
    state.selectedVertex = -1;
    syncShapeControls();
  }

  // 🗑 Elimina la forma attiva. Se era l'unica, ne crea una vuota in disegno.
  function deleteActiveShape() {
    if (state.activeIndex < 0) return;
    state.shapes.splice(state.activeIndex, 1);
    state.activeIndex = -1;
    state.selectedVertex = -1;
    resetDragHover();
    if (state.shapes.length === 0) {
      state.shapes.push(newShapeObject());
      state.activeIndex = 0;
    }
    syncShapeControls();
    renderAll();
    updateUI();
  }

  // ───────────────────── Dimensione foglio ───────────────────────────────
  // Unità di misura selezionabili per le dimensioni PERSONALIZZATE. Internamente
  // il foglio resta SEMPRE in mm (state.paper.wMm/hMm); l'unità serve solo per
  // l'input/visualizzazione e per il calcolo dell'area.
  const UNIT_TO_MM = { mm: 1, cm: 10, m: 1000, km: 1000000 };
  function unitToMm(v, unit) { return v * (UNIT_TO_MM[unit] || 1); }
  function mmToUnit(mm, unit) { return mm / (UNIT_TO_MM[unit] || 1); }

  // Numero "pulito": intero quando possibile, altrimenti fino a 3 decimali.
  function fmtNum(n) {
    if (!isFinite(n)) return "0";
    const r = Math.round(n);
    if (Math.abs(n - r) < 1e-9) return String(r);
    return String(parseFloat(n.toFixed(3)));
  }

  // Area del foglio (mm²) formattata nell'unità quadrata più leggibile, in italiano.
  function formatPaperArea(wMm, hMm) {
    const aMm2 = wMm * hMm;
    const units = [
      { u: "km²", f: 1e12 },
      { u: "m²",  f: 1e6 },
      { u: "cm²", f: 1e2 },
      { u: "mm²", f: 1 }
    ];
    let chosen = units[units.length - 1];
    for (const cand of units) { if (aMm2 / cand.f >= 1) { chosen = cand; break; } }
    const val = aMm2 / chosen.f;
    const txt = (val >= 1000)
      ? Math.round(val).toLocaleString("it-IT")
      : parseFloat(val.toPrecision(4)).toLocaleString("it-IT");
    return txt + " " + chosen.u;
  }

  // Riallinea TUTTI i controlli del foglio allo stato: dimensioni mostrate
  // nell'unità scelta, selettori sincronizzati, riquadro area aggiornato.
  function syncPaperInputs() {
    const u = state.paper.unit || "mm";
    if (paperUnitSelect) paperUnitSelect.value = u;
    if (paperWInput) paperWInput.value = fmtNum(mmToUnit(state.paper.wMm, u));
    if (paperHInput) paperHInput.value = fmtNum(mmToUnit(state.paper.hMm, u));
    if (paperSelect) paperSelect.value = state.paper.preset;
    if (paperAreaLabel) paperAreaLabel.textContent = __ct("csb.paper.areaLabel", null, "Area foglio: ") + formatPaperArea(state.paper.wMm, state.paper.hMm);
  }

  function applyPaperSize(wMm, hMm, preset) {
    wMm = Math.max(10, Math.min(2000000, Math.round(wMm))); // 10 mm … 2 km
    hMm = Math.max(10, Math.min(2000000, Math.round(hMm)));
    state.paper.wMm = wMm;
    state.paper.hMm = hMm;
    state.paper.preset = preset || "custom";
    syncPaperInputs();
    fitPaper();
    renderAll();
    updateUI();
  }

  function onPaperPresetChange() {
    const key = paperSelect.value;
    if (key === "custom") { syncPaperInputs(); return; } // resta come stanno gli input
    const p = PAPER_PRESETS[key];
    if (!p) return;
    state.paper.unit = "mm"; // i preset A5…A0 sono definiti in mm
    applyPaperSize(p.w, p.h, key);
  }
  function onPaperApply() {
    const u = (paperUnitSelect && paperUnitSelect.value) || state.paper.unit || "mm";
    state.paper.unit = u;
    // Accetta sia punto che virgola come separatore decimale (input italiano).
    const w = parseFloat(String(paperWInput.value).replace(",", "."));
    const h = parseFloat(String(paperHInput.value).replace(",", "."));
    if (!isFinite(w) || !isFinite(h)) return;
    applyPaperSize(unitToMm(w, u), unitToMm(h, u), "custom");
  }
  // Cambio unità: stesso foglio reale, solo ri-visualizzato nella nuova unità.
  function onPaperUnitChange() {
    state.paper.unit = (paperUnitSelect && paperUnitSelect.value) || "mm";
    syncPaperInputs();
  }

  // ───────────────────── Zoom / Pan ──────────────────────────────────────
  function setZoomCentered(newScale, screenX, screenY) {
    const clamped = clampZoom(newScale);
    if (clamped === state.view.scale) return;
    const wx = screenToWorldX(screenX);
    const wy = screenToWorldY(screenY);
    state.view.scale = clamped;
    state.view.x = screenX - wx * state.view.scale;
    state.view.y = screenY - wy * state.view.scale;
    renderAll();
    updateUI();
  }
  function zoomByFactor(factor, screenX, screenY) {
    const sx = (screenX != null) ? screenX : state.vp.w / 2;
    const sy = (screenY != null) ? screenY : state.vp.h / 2;
    setZoomCentered(state.view.scale * factor, sx, sy);
  }
  function resetZoom() { fitPaper(); renderAll(); updateUI(); }

  // ───────────────────── Event handlers preview ──────────────────────────
  function getPreviewScreen(e) {
    const rect = previewCanvas.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) * state.vp.w) / rect.width,
      y: ((e.clientY - rect.top) * state.vp.h) / rect.height
    };
  }
  function getPreviewWorld(e) {
    const s = getPreviewScreen(e);
    return { x: screenToWorldX(s.x), y: screenToWorldY(s.y), sx: s.x, sy: s.y };
  }

  function onPreviewMouseDown(e) {
    const isPan = (e.button === 0 && e.altKey) || e.button === 1;
    if (isPan) {
      e.preventDefault();
      state.panning = true;
      state.panLast.x = e.clientX;
      state.panLast.y = e.clientY;
      previewCanvas.style.cursor = "grabbing";
      return;
    }
    if (e.button !== 0) return;

    const p = getPreviewWorld(e);
    const screen = { x: p.sx, y: p.sy };

    // In "modalità modifica immagine" il modulo immagine cattura gli eventi:
    // il tracciamento dei vertici è sospeso finché non si ri-blocca l'immagine.
    if (CSB.background.isActive()) {
      let handled = false;
      try { handled = CSB.background.onMouseDown(p, screen, e); } catch (_) {}
      if (handled) { renderAll(); return; }
      return; // in modalità immagine non si disegna comunque
    }

    if (isDrawing()) {
      const sh = activeShape();
      if (sh.vertices.length >= 3) {
        const tolWorld = CLOSE_SNAP_PX / state.view.scale;
        if (dist(p, sh.vertices[0]) <= tolWorld) { closeShape(); return; }
      }
      const nx = Math.max(0, Math.min(paperPxW(), p.x));
      const ny = Math.max(0, Math.min(paperPxH(), p.y));
      if (sh.vertices.length > 0) {
        const last = sh.vertices[sh.vertices.length - 1];
        if (dist({ x: nx, y: ny }, last) < MIN_VERTEX_DISTANCE_WORLD) return;
      }
      sh.vertices.push({ x: nx, y: ny });
      renderAll();
      updateUI();
      return;
    }

    // Editing/idle: prima le maniglie della forma attiva (vertici, curve)…
    if (isEditing()) {
      const idxV = findVertexAt(p);
      if (idxV !== -1) {
        state.draggingVertex = idxV;
        state.selectedVertex = idxV;   // selezione per il raggio singolo
        previewCanvas.style.cursor = "grabbing";
        renderAll();
        updateUI();
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

    // …poi il CORPO di una forma chiusa → selezionala e inizia lo spostamento.
    const hitK = shapeAtPoint(p);
    if (hitK !== -1) {
      selectShape(hitK);
      state.movingShape = hitK;
      state.moveLastWorld = { x: p.x, y: p.y };
      previewCanvas.style.cursor = "grabbing";
      renderAll();
      updateUI();
      return;
    }

    // Spazio vuoto: prima deseleziona il vertice, poi la forma (→ nessuna attiva).
    if (isEditing() && state.selectedVertex !== -1) {
      state.selectedVertex = -1;
      renderAll();
      updateUI();
      return;
    }
    if (state.activeIndex !== -1) {
      state.activeIndex = -1;
      state.selectedVertex = -1;
      resetDragHover();
      syncShapeControls();
      renderAll();
      updateUI();
    }
  }

  function onPreviewMouseMove(e) {
    if (state.panning) {
      const dx = e.clientX - state.panLast.x;
      const dy = e.clientY - state.panLast.y;
      state.panLast.x = e.clientX;
      state.panLast.y = e.clientY;
      const rect = previewCanvas.getBoundingClientRect();
      state.view.x += (state.vp.w / rect.width) * dx;
      state.view.y += (state.vp.h / rect.height) * dy;
      scheduleRenderAll();
      return;
    }

    const p = getPreviewWorld(e);
    state.mouseX = p.x;
    state.mouseY = p.y;
    state.mouseInside = true;

    // Modalità modifica immagine: il modulo gestisce drag/scale e il cursore.
    if (CSB.background.isActive()) {
      let handled = false;
      try { handled = CSB.background.onMouseMove(p, { x: p.sx, y: p.sy }, e); } catch (_) {}
      const cur = (function () { try { return CSB.background.cursorFor(p, { x: p.sx, y: p.sy }, e); } catch (_) { return null; } })();
      previewCanvas.style.cursor = cur || "default";
      scheduleRenderAll();
      return;
    }

    // Spostamento di una forma chiusa (drag del corpo): trasla vertici+curve,
    // tenendo l'intera forma dentro i bordi del foglio (clamp sul bounding box).
    if (state.movingShape !== -1 && state.moveLastWorld) {
      const sh = state.shapes[state.movingShape];
      if (sh) {
        let dx = p.x - state.moveLastWorld.x;
        let dy = p.y - state.moveLastWorld.y;
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const v of sh.vertices) {
          if (v.x < minX) minX = v.x; if (v.x > maxX) maxX = v.x;
          if (v.y < minY) minY = v.y; if (v.y > maxY) maxY = v.y;
        }
        const pw = paperPxW(), ph = paperPxH();
        if (minX + dx < 0) dx = -minX;
        if (maxX + dx > pw) dx = pw - maxX;
        if (minY + dy < 0) dy = -minY;
        if (maxY + dy > ph) dy = ph - maxY;
        for (const v of sh.vertices) { v.x += dx; v.y += dy; }
        for (const c of sh.curves) { if (c) { c.x += dx; c.y += dy; } }
        state.moveLastWorld = { x: p.x, y: p.y };
      }
      previewCanvas.style.cursor = "grabbing";
    } else if (isEditing() && state.draggingVertex !== -1) {
      const sh = activeShape();
      const v = sh.vertices[state.draggingVertex];
      v.x = Math.max(0, Math.min(paperPxW(), p.x));
      v.y = Math.max(0, Math.min(paperPxH(), p.y));
    } else if (isEditing() && state.draggingCurve !== -1) {
      const sh = activeShape();
      const i = state.draggingCurve;
      const n = sh.vertices.length;
      const A = sh.vertices[i];
      const B = sh.vertices[(i + 1) % n];
      const M = { x: p.x, y: p.y };
      const P = controlFromMid(A, M, B);
      const pw = paperPxW(), ph = paperPxH();
      P.x = Math.max(-pw, Math.min(2 * pw, P.x));
      P.y = Math.max(-ph, Math.min(2 * ph, P.y));
      sh.curves[i] = P;
    } else if (isDrawing()) {
      if (isCloseSnapActive()) previewCanvas.style.cursor = "pointer";
      else previewCanvas.style.cursor = e.altKey ? "grab" : "crosshair";
    } else {
      // Editing senza drag, oppure idle: hover sulle maniglie della forma attiva
      // o sul corpo di una forma (per indicare "selezionabile/spostabile").
      let cursor = e.altKey ? "grab" : "default";
      state.hoverVertex = -1; state.hoverCurve = -1; state.hoverShape = -1;
      if (isEditing()) {
        const idxV = findVertexAt(p);
        if (idxV !== -1) { state.hoverVertex = idxV; cursor = "grab"; }
        else {
          const idxC = findCurveHandleAt(p);
          if (idxC !== -1) { state.hoverCurve = idxC; cursor = "grab"; }
        }
      }
      if (state.hoverVertex === -1 && state.hoverCurve === -1) {
        const hk = shapeAtPoint(p);
        if (hk !== -1) { state.hoverShape = hk; cursor = "move"; }
      }
      previewCanvas.style.cursor = cursor;
    }

    scheduleRenderAll();
  }

  function onPreviewMouseUp() {
    if (state.panning) {
      state.panning = false;
      previewCanvas.style.cursor = isDrawing() ? "crosshair" : "default";
      return;
    }
    if (CSB.background.isActive()) {
      try { CSB.background.onMouseUp(); } catch (_) {}
      renderAll();
      return;
    }
    let changed = false;
    if (state.movingShape !== -1) { state.movingShape = -1; state.moveLastWorld = null; changed = true; }
    if (state.draggingVertex !== -1) { state.draggingVertex = -1; changed = true; }
    if (state.draggingCurve !== -1) { state.draggingCurve = -1; changed = true; }
    if (changed) { previewCanvas.style.cursor = "default"; renderAll(); updateUI(); }
  }

  function onPreviewMouseLeave() {
    state.mouseInside = false;
    state.snappingToFirst = false;
    if (!state.panning) {
      if (state.draggingVertex !== -1) state.draggingVertex = -1;
      if (state.draggingCurve !== -1) state.draggingCurve = -1;
      if (state.movingShape !== -1) { state.movingShape = -1; state.moveLastWorld = null; }
    }
    renderAll();
    updateUI();
  }

  function onPreviewWheel(e) {
    e.preventDefault();
    const screen = getPreviewScreen(e);
    const f = Math.exp(-e.deltaY * 0.0015);
    setZoomCentered(state.view.scale * f, screen.x, screen.y);
  }

  function onPreviewDblClick(e) {
    const p = getPreviewWorld(e);
    // In modifica immagine il doppio click non avvia forme.
    if (CSB.background.isActive()) return;

    // 1) Su una maniglia di curva (forma attiva) → raddrizza il lato.
    if (isEditing()) {
      const sh = activeShape();
      const idxC = findCurveHandleAt(p);
      if (idxC !== -1 && sh.curves[idxC]) {
        sh.curves[idxC] = null;
        renderAll(); updateUI();
        return;
      }
    }
    // 2) Non stai disegnando e il doppio click è su area libera (non su un
    //    vertice né sul corpo di una forma) → inizia una NUOVA forma.
    if (!isDrawing()) {
      const onVertex = isEditing() && findVertexAt(p) !== -1;
      const onBody = shapeAtPoint(p) !== -1;
      if (!onVertex && !onBody) {
        startNewShape();
      }
    }
  }

  function onPreviewContextMenu(e) {
    e.preventDefault();
    if (!isEditing()) return;
    const sh = activeShape();
    const p = getPreviewWorld(e);
    const idxC = findCurveHandleAt(p);
    if (idxC !== -1 && sh.curves[idxC]) {
      sh.curves[idxC] = null;
      renderAll(); updateUI();
    }
  }

  function onPreviewKeyDown(e) {
    if (!modalEl || modalEl.style.display === "none") return;
    // Non rubare i tasti mentre si scrive nei campi dimensione foglio
    const tag = (e.target && e.target.tagName) ? e.target.tagName.toLowerCase() : "";
    const typing = tag === "input" || tag === "select" || tag === "textarea";

    if (!typing && (e.key === "+" || (e.key === "=" && !e.shiftKey))) { e.preventDefault(); zoomByFactor(1.2); return; }
    if (!typing && (e.key === "-" || e.key === "_")) { e.preventDefault(); zoomByFactor(1 / 1.2); return; }
    if (!typing && e.key === "0") { e.preventDefault(); resetZoom(); return; }

    if (e.key === "Enter") {
      if (typing) return;
      if (isDrawing() && activeShape() && activeShape().vertices.length >= 3) { e.preventDefault(); closeShape(); }
      else if (insertBtn && !insertBtn.disabled) { e.preventDefault(); insertShapeIntoCanvas(); }
      return;
    }
    if (e.key === "Backspace") {
      if (typing) return;
      // In disegno: annulla l'ultimo vertice. Altrimenti niente (no cancellazioni accidentali).
      if (isDrawing() && activeShape() && activeShape().vertices.length > 0) { e.preventDefault(); undoLastVertex(); }
      return;
    }
    if (e.key === "Delete") {
      if (typing) return;
      // In disegno: annulla l'ultimo vertice. In modifica/idle: elimina la forma attiva.
      if (isDrawing() && activeShape() && activeShape().vertices.length > 0) { e.preventDefault(); undoLastVertex(); }
      else if (activeShape()) { e.preventDefault(); deleteActiveShape(); }
      return;
    }
    if (!typing && (e.key === "n" || e.key === "N")) { e.preventDefault(); startNewShape(); return; }
    if (e.key === "Escape") { e.preventDefault(); closeModal(); return; }
  }

  // ───────────────────── Costruzione path SVG (per Path) ─────────────────
  function buildPathString(points, curves, cornerPxArr) {
    const f = (v) => (Math.abs(v) < 1e-6 ? 0 : v).toFixed(3);
    const cmds = effectiveCommands(points, curves, cornerPxArr);
    const parts = [];
    for (let i = 0; i < cmds.length; i++) {
      const c = cmds[i];
      if (c.t === "M") parts.push(`M ${f(c.x)} ${f(c.y)}`);
      else if (c.t === "L") parts.push(`L ${f(c.x)} ${f(c.y)}`);
      else if (c.t === "Q") parts.push(`Q ${f(c.cx)} ${f(c.cy)} ${f(c.x)} ${f(c.y)}`);
    }
    parts.push("Z");
    return parts.join(" ");
  }
  function hasAnyCurveOf(sh) { return !!sh && sh.curves.some((c) => !!c); }
  function hasAnyCurve() { return hasAnyCurveOf(activeShape()); }

  // ───────────────────── Inserimento nel canvas Fabric ───────────────────
  // Costruisce un oggetto Fabric (Polygon o Path) da UNA forma chiusa, centrato
  // su (leftPx, topPx) nel canvas del mosaico. Coordinate locali = punti relativi
  // al centroide della forma. Restituisce l'oggetto (non ancora aggiunto).
  function buildFabricFromShape(sh, leftPx, topPx) {
    const verts = sh.vertices;
    let cxL = 0, cyL = 0;
    verts.forEach((p) => { cxL += p.x; cyL += p.y; });
    cxL /= verts.length; cyL /= verts.length;
    const pts = verts.map((p) => ({ x: p.x - cxL, y: p.y - cyL }));
    const ctrls = sh.curves.map((c) => c ? ({ x: c.x - cxL, y: c.y - cyL }) : null);
    const cornerPxArr = cornerPxArrayFor(sh);
    const fill = fillOf(sh);
    const curved = hasAnyCurveOf(sh);
    const filleted = hasAnyFilletOf(sh);

    let shape;
    // Polygon solo con spigoli vivi e lati dritti; con curve o angoli arrotondati
    // serve un Path (comandi Q), compatibile Fabric 5.1–5.3.
    if (!curved && !filleted) {
      shape = new fabric.Polygon(pts, {
        left: leftPx, top: topPx, originX: "center", originY: "center",
        fill: fill, selectable: true, hasControls: true, hasBorders: true, objectCaching: false
      });
    } else {
      const pathStr = buildPathString(pts, ctrls, cornerPxArr);
      shape = new fabric.Path(pathStr, {
        left: leftPx, top: topPx, originX: "center", originY: "center",
        fill: fill, selectable: true, hasControls: true, hasBorders: true, objectCaching: false
      });
    }
    shape.__shapeType = "custom";
    shape.__shape = {
      type: "custom",
      hasCurves: curved,
      cornerRadii_mm: sh.cornerRadii.slice(),
      fill: fill,
      points_mm: pts.map((p) => ({ x: _px2mm(p.x), y: _px2mm(p.y) })),
      curves_mm: ctrls.map((c) => c ? ({ x: _px2mm(c.x), y: _px2mm(c.y) }) : null)
    };
    shape.customId = (typeof generateUID === "function")
      ? generateUID()
      : ("custom_" + Date.now() + "_" + Math.floor(Math.random() * 1e6));
    try {
      shape.setControlsVisibility({
        tl: true, tr: true, bl: true, br: true,
        ml: true, mr: true, mt: true, mb: true, mtr: true
      });
    } catch (_) {}
    return shape;
  }

  function insertShapeIntoCanvas() {
    if (typeof canvas === "undefined" || !canvas) return;
    if (canvas.isDrawingMode) {
      if (typeof flashToast === "function") flashToast(__ct("csb.toast.disablePenInsert", null, "Disattiva penna/acquerello prima di inserire la forma"));
      return;
    }
    // I fogli più grandi di A4 sono destinati alla posa palladiana: l'inserimento
    // diretto nel canvas del mosaico è disabilitato (gestione tramite salva/apri
    // progetto palladiana — Fase 2C).
    if (!isWithinA4()) {
      if (typeof flashToast === "function")
        flashToast(__ct("csb.toast.biggerThanA4", null, "Foglio più grande di A4: inserimento disabilitato. Usa il salvataggio progetto palladiana."));
      return;
    }
    const closed = state.shapes.filter((s) => s.closed && s.vertices.length >= 3);
    if (closed.length === 0) return;

    // Centro del GRUPPO di forme (bounding box) per mantenere le posizioni
    // relative quando le portiamo nel canvas del mosaico.
    let gMinX = Infinity, gMinY = Infinity, gMaxX = -Infinity, gMaxY = -Infinity;
    for (const sh of closed) for (const v of sh.vertices) {
      if (v.x < gMinX) gMinX = v.x; if (v.x > gMaxX) gMaxX = v.x;
      if (v.y < gMinY) gMinY = v.y; if (v.y > gMaxY) gMaxY = v.y;
    }
    const groupCx = (gMinX + gMaxX) / 2;
    const groupCy = (gMinY + gMaxY) / 2;

    const cs = getComputedStyle(document.documentElement);
    const cssVar = (name) => parseFloat(cs.getPropertyValue(name)) || 0;
    const leftMargin = cssVar("--leftbar-w") + cssVar("--texturepanel-w");
    const topMargin = cssVar("--topbar-h") + cssVar("--bgbar-h");
    const rightMargin = cssVar("--inspector-w");
    const bottomMargin = cssVar("--statusbar-h");
    const screenCx = leftMargin + (window.innerWidth - leftMargin - rightMargin) / 2;
    const screenCy = topMargin + (window.innerHeight - topMargin - bottomMargin) / 2;
    const viewObj = (typeof view !== "undefined" && view) ? view : { x: 0, y: 0, scale: 1 };
    const targetCx = (screenCx - viewObj.x) / viewObj.scale;
    const targetCy = (screenCy - viewObj.y) / viewObj.scale;

    let last = null;
    for (const sh of closed) {
      let scx = 0, scy = 0;
      sh.vertices.forEach((p) => { scx += p.x; scy += p.y; });
      scx /= sh.vertices.length; scy /= sh.vertices.length;
      const leftPx = targetCx + (scx - groupCx);
      const topPx = targetCy + (scy - groupCy);
      const obj = buildFabricFromShape(sh, leftPx, topPx);
      canvas.add(obj);
      if (typeof applyHandlePreset === "function") applyHandlePreset(obj);
      if (typeof updateHandlesSpacing === "function") updateHandlesSpacing(obj);
      last = obj;
    }
    if (last) canvas.setActiveObject(last);
    canvas.requestRenderAll();

    if (typeof positionRadial === "function") positionRadial();
    if (typeof updateMeasureOverlay === "function") {
      requestAnimationFrame(() => requestAnimationFrame(updateMeasureOverlay));
    }
    if (typeof flashToast === "function")
      flashToast(closed.length > 1 ? __ct("csb.toast.shapesInserted", { count: closed.length }, `✅ ${closed.length} forme inserite`) : __ct("csb.toast.shapeInserted", null, "✅ Forma personalizzata inserita"));

    closeModal();
  }

  // ───────────────────── Progetto palladiana (.mspp.json) ────────────────
  // File SEPARATO dai progetti mosaico (.msp.json), così non si confondono mai.
  // Le coordinate sono salvate in mm REALI → il file è indipendente dalla
  // calibrazione corrente (in apertura si riconvertono in px con mm2px attuale).
  const PALLADIANA_FILE_TYPE = "mosaica-palladiana";

  // Arrotonda a 0,001 mm (1 micron): elimina il rumore dei float e riduce molto
  // la dimensione del file con migliaia di forme, senza perdita pratica.
  function r3(n) { return Math.round(n * 1000) / 1000; }

  function serializePalladiana() {
    const shapes = state.shapes
      .filter((s) => s.closed && s.vertices.length >= 3)
      .map((s) => ({
        vertices_mm: s.vertices.map((p) => ({ x: r3(_px2mm(p.x)), y: r3(_px2mm(p.y)) })),
        curves_mm: s.curves.map((c) => c ? ({ x: r3(_px2mm(c.x)), y: r3(_px2mm(c.y)) }) : null),
        cornerRadii: s.cornerRadii.map((v) => r3(v || 0)),
        cornerRadiusMm: r3(s.cornerRadiusMm || 0),
        fillColorHex: s.fillColorHex || "#0005ff",
        fillAlpha: (typeof s.fillAlpha === "number") ? r3(s.fillAlpha) : 0.79,
        closed: true
      }));
    return {
      type: PALLADIANA_FILE_TYPE,
      version: 1,
      app: "Mosaica Workspace Pro",
      savedAt: new Date().toISOString(),
      paper: {
        wMm: state.paper.wMm, hMm: state.paper.hMm,
        preset: state.paper.preset, unit: state.paper.unit || "mm"
      },
      view: { x: r3(state.view.x), y: r3(state.view.y), scale: r3(state.view.scale) },
      shapes
    };
  }

  // Ricostruisce lo stato del foglio da un oggetto palladiana già parsato.
  // Ritorna true se il caricamento è andato a buon fine.
  function deserializePalladiana(data) {
    if (!data || data.type !== PALLADIANA_FILE_TYPE || !Array.isArray(data.shapes)) return false;

    // Foglio (imposta prima l'unità, poi le dimensioni in mm)
    if (data.paper && isFinite(data.paper.wMm) && isFinite(data.paper.hMm)) {
      state.paper.unit = data.paper.unit || "mm";
      applyPaperSize(data.paper.wMm, data.paper.hMm, data.paper.preset || "custom");
    }

    // Forme: mm → px (calibrazione corrente)
    state.shapes = data.shapes.map((s) => {
      const verts = (s.vertices_mm || []).map((p) => ({ x: _mm2px(p.x), y: _mm2px(p.y) }));
      const n = verts.length;
      let curves = (s.curves_mm || []).map((c) => c ? ({ x: _mm2px(c.x), y: _mm2px(c.y) }) : null);
      let radii = Array.isArray(s.cornerRadii) ? s.cornerRadii.slice() : [];
      // Normalizza le lunghezze a n (robustezza contro file manomessi/parziali)
      if (curves.length !== n) { const a = new Array(n).fill(null); for (let i = 0; i < Math.min(n, curves.length); i++) a[i] = curves[i]; curves = a; }
      if (radii.length !== n) { const a = new Array(n).fill(0); for (let i = 0; i < Math.min(n, radii.length); i++) a[i] = radii[i]; radii = a; }
      return {
        vertices: verts,
        curves,
        cornerRadii: radii,
        cornerRadiusMm: s.cornerRadiusMm || 0,
        fillColorHex: s.fillColorHex || "#0005ff",
        fillAlpha: (typeof s.fillAlpha === "number") ? s.fillAlpha : 0.79,
        closed: true
      };
    }).filter((s) => s.vertices.length >= 3);

    state.activeIndex = -1;       // nessuna selezionata: si vede tutto il layout
    state.selectedVertex = -1;
    resetDragHover();

    // Vista (zoom/pan) opzionale; se assente o non valida, fit del foglio.
    if (data.view && isFinite(data.view.scale) && data.view.scale > 0) {
      computeZoomLimits();
      state.view.scale = clampZoom(data.view.scale);
      state.view.x = isFinite(data.view.x) ? data.view.x : state.view.x;
      state.view.y = isFinite(data.view.y) ? data.view.y : state.view.y;
    } else {
      fitPaper();
    }

    syncShapeControls();
    renderAll();
    updateUI();
    return true;
  }

  async function savePalladianaProject() {
    if (!window.palladianaAPI || typeof window.palladianaAPI.save !== "function") {
      if (typeof flashToast === "function") flashToast(__ct("csb.toast.palSaveUnavail", null, "Salvataggio palladiana non disponibile (riavvia l'app dopo l'aggiornamento)"));
      return;
    }
    const closedCount = state.shapes.filter((s) => s.closed && s.vertices.length >= 3).length;
    if (closedCount === 0) {
      if (typeof flashToast === "function") flashToast(__ct("csb.toast.noShapeToSave", null, "Nessuna forma da salvare: chiudi almeno una forma"));
      return;
    }
    const data = serializePalladiana();
    try {
      // JSON compatto (senza indentazione): a parità di contenuto pesa molto meno
      // con migliaia di forme. Il file non è pensato per modifica a mano.
      const res = await window.palladianaAPI.save({ content: JSON.stringify(data) });
      if (res && res.path) {
        if (typeof flashToast === "function") flashToast(__ct("csb.toast.palSaved", null, "💾 Progetto palladiana salvato: ") + (res.filename || ""));
      }
    } catch (e) {
      if (typeof flashToast === "function") flashToast(__ct("csb.toast.palSaveErr", null, "Errore nel salvataggio del progetto palladiana"));
    }
  }

  async function openPalladianaProject() {
    if (!window.palladianaAPI || typeof window.palladianaAPI.openDialog !== "function") {
      if (typeof flashToast === "function") flashToast(__ct("csb.toast.palOpenUnavail", null, "Apertura palladiana non disponibile (riavvia l'app dopo l'aggiornamento)"));
      return;
    }
    try {
      const res = await window.palladianaAPI.openDialog();
      if (!res || !res.content) return;
      let data = null;
      try { data = JSON.parse(res.content); } catch (_) { data = null; }
      if (!data || data.type !== PALLADIANA_FILE_TYPE) {
        if (typeof flashToast === "function") flashToast(__ct("csb.toast.notPalladiana", null, "Questo non è un progetto palladiana (.mspp.json)"));
        return;
      }
      const ok = deserializePalladiana(data);
      if (ok && typeof flashToast === "function") flashToast(__ct("csb.toast.palLoaded", null, "📂 Progetto palladiana caricato: ") + (res.filename || ""));
    } catch (e) {
      if (typeof flashToast === "function") flashToast(__ct("csb.toast.palOpenErr", null, "Errore nell'apertura del progetto palladiana"));
    }
  }

  // ───────────────────── Modale: costruzione DOM (fullscreen) ────────────
  function buildModalDOM() {
    if (modalEl) return;

    modalEl = document.createElement("div");
    modalEl.id = "customShapeBuilderModal";
    modalEl.style.cssText = `
      display: none;
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.88);
      z-index: 20003;
      align-items: stretch;
      justify-content: stretch;
      padding: 14px;
      box-sizing: border-box;
    `;

    const btnBase = "border:0; border-radius:6px; color:#fff; cursor:pointer; font-size:13px;";
    const iconBtn = "width:32px; height:32px; background:#333; border:0; border-radius:6px; color:#fff; cursor:pointer; font-size:16px; line-height:1;";

    modalEl.innerHTML = `
      <div id="csbPanel" style="
        background:#1f1f1f;
        padding:14px 16px;
        border-radius:12px;
        width:100%;
        height:100%;
        max-width:100%;
        max-height:100%;
        box-sizing:border-box;
        color:#eee;
        box-shadow:0 15px 50px rgba(0,0,0,0.8);
        display:flex;
        flex-direction:column;
        gap:10px;
        overflow:hidden;
      ">
        <!-- Header -->
        <div style="display:flex; justify-content:space-between; align-items:center; gap:12px; flex-wrap:wrap;">
          <h3 style="margin:0; font-size:17px; white-space:nowrap;" data-i18n="csb.modal.title">✏️ Crea forma personalizzata</h3>

          <!-- Controlli dimensione foglio -->
          <div style="display:flex; align-items:center; gap:6px; flex-wrap:wrap; font-size:12px; color:#bcd;">
            <span style="opacity:0.8;" data-i18n="csb.modal.paper">Foglio:</span>
            <select id="csbPaperPreset" data-i18n-title="csb.modal.paperPreset" title="Preset foglio"
                    style="background:#161616; color:#cfe; border:1px solid #333; border-radius:6px; padding:5px 6px; font-size:12px;">
              <option value="A5">A5</option>
              <option value="A4" selected>A4</option>
              <option value="A3">A3</option>
              <option value="A2">A2</option>
              <option value="A1">A1</option>
              <option value="A0">A0</option>
              <option value="custom" data-i18n="csb.modal.custom">Personalizzato</option>
            </select>
            <input id="csbPaperW" data-i18n-title="csb.modal.width" type="number" min="0" step="any" title="Larghezza"
                   style="width:74px; background:#161616; color:#cfe; border:1px solid #333; border-radius:6px; padding:5px 6px; font-size:12px;"/>
            <span style="opacity:0.6;">×</span>
            <input id="csbPaperH" data-i18n-title="csb.modal.height" type="number" min="0" step="any" title="Altezza"
                   style="width:74px; background:#161616; color:#cfe; border:1px solid #333; border-radius:6px; padding:5px 6px; font-size:12px;"/>
            <select id="csbPaperUnit" data-i18n-title="csb.modal.unit" title="Unità di misura per le dimensioni personalizzate"
                    style="background:#161616; color:#cfe; border:1px solid #333; border-radius:6px; padding:5px 6px; font-size:12px;">
              <option value="mm" selected>mm</option>
              <option value="cm">cm</option>
              <option value="m">m</option>
              <option value="km">km</option>
            </select>
            <button id="csbPaperApply" data-i18n="csb.modal.apply" data-i18n-title="csb.modal.applyPaper" title="Applica dimensioni foglio"
                    style="padding:6px 10px; background:#3a6ea5; ${btnBase}">Applica</button>
            <span id="csbPaperArea" data-i18n-title="csb.modal.paperArea" title="Area del foglio applicato"
                  style="opacity:0.85; padding-left:6px; white-space:nowrap;"></span>
          </div>

          <!-- Zoom + chiudi -->
          <div style="display:flex; align-items:center; gap:6px;">
            <button id="csbZoomOut" data-i18n-title="csb.modal.zoomOut" title="Zoom out (−)" style="${iconBtn}">−</button>
            <span id="csbZoomLabel" data-i18n-title="csb.modal.zoomLevel" title="Livello zoom"
                  style="min-width:52px; text-align:center; font-size:12px; color:#cfe; background:#161616; padding:6px 6px; border-radius:6px; border:1px solid #333;">100%</span>
            <button id="csbZoomIn" data-i18n-title="csb.modal.zoomIn" title="Zoom in (+)" style="${iconBtn}">+</button>
            <button id="csbFit" data-i18n-title="csb.modal.fit" title="Adatta alla vista (0)" style="${iconBtn}">⤢</button>
            <button id="csbCloseX" data-i18n-title="csb.modal.close" title="Chiudi (Esc)"
                    style="background:none; border:none; color:#aaa; font-size:26px; cursor:pointer; line-height:1; margin-left:6px;">×</button>
          </div>
        </div>

        <!-- Status -->
        <div id="csbStatus" style="
          font-size:13px; line-height:1.4; background:#161616; border:1px solid #333;
          border-radius:6px; padding:7px 10px; color:#cfe; min-height:16px;
        "></div>

        <!-- Strumenti forma: colore, opacità, arrotondamento angoli -->
        <div style="display:flex; align-items:center; gap:16px; flex-wrap:wrap; font-size:12px; color:#bcd;">
          <span style="display:flex; align-items:center; gap:6px;">
            <span style="opacity:0.8;" data-i18n="csb.modal.color">Colore</span>
            <input id="csbFillColor" data-i18n-title="csb.modal.colorTitle" type="color" value="#0005ff" title="Colore di riempimento"
                   style="width:34px; height:26px; padding:0; border:1px solid #333; border-radius:6px; background:#161616; cursor:pointer;"/>
          </span>
          <span style="display:flex; align-items:center; gap:8px;">
            <span style="opacity:0.8;" data-i18n="csb.modal.opacity">Opacità</span>
            <input id="csbFillAlpha" data-i18n-title="csb.modal.opacityTitle" type="range" min="0" max="100" value="79" title="Opacità riempimento"
                   style="width:110px; cursor:pointer;"/>
            <span id="csbFillAlphaLabel" style="min-width:38px; color:#9fd6ff; font-family: ui-monospace, Menlo, monospace;">79%</span>
          </span>
          <span style="display:flex; align-items:center; gap:8px;">
            <span style="opacity:0.8;" data-i18n="csb.modal.allCorners">Tutti gli angoli</span>
            <input id="csbCornerRadius" data-i18n-title="csb.modal.allCornersTitle" type="range" min="0" max="60" step="1" value="0" title="Arrotonda tutti gli angoli vivi (mm)"
                   style="width:130px; cursor:pointer;"/>
            <span id="csbCornerLabel" style="min-width:42px; color:#9fd6ff; font-family: ui-monospace, Menlo, monospace;">0 mm</span>
          </span>
          <span style="display:flex; align-items:center; gap:8px;">
            <span style="opacity:0.8;" data-i18n="csb.modal.selCorner">Angolo selezionato</span>
            <input id="csbCornerOne" data-i18n-title="csb.modal.selCornerTitle" type="range" min="0" max="60" step="1" value="0" disabled
                   title="Seleziona un vertice sul foglio, poi arrotonda solo quello"
                   style="width:130px; cursor:not-allowed; opacity:0.4;"/>
            <span id="csbCornerOneLabel" data-i18n="csb.label.none" style="min-width:88px; color:#fbbf24; font-family: ui-monospace, Menlo, monospace;">nessuno</span>
          </span>
          <span id="csbImageTools" style="display:flex; align-items:center; gap:8px;"></span>
        </div>

        <!-- Stage (occupa tutto lo spazio rimasto) -->
        <div id="csbStage" style="
          position:relative; flex:1 1 auto; min-height:0;
          background:#161616; border:1px solid #444; border-radius:6px; overflow:hidden;
        ">
          <!-- Angolo top-left -->
          <div style="
            position:absolute; left:0; top:0; width:${RULER_SIZE}px; height:${RULER_SIZE}px;
            background:#0f0f0f; border-right:1px solid #3a3a3a; border-bottom:1px solid #3a3a3a;
            z-index:2; font-size:9px; color:#7a8a8a; display:flex; align-items:center; justify-content:center;
          ">mm</div>
          <canvas id="csbRulerTop" style="position:absolute; left:${RULER_SIZE}px; top:0; display:block;"></canvas>
          <canvas id="csbRulerLeft" style="position:absolute; left:0; top:${RULER_SIZE}px; display:block;"></canvas>
          <canvas id="csbPreview" tabindex="0"
                  style="position:absolute; left:${RULER_SIZE}px; top:${RULER_SIZE}px; background:#262626; cursor:crosshair; display:block;"></canvas>
        </div>

        <!-- Riga info + footer -->
        <div style="display:flex; justify-content:space-between; align-items:center; font-size:11px; color:#888; gap:10px; flex-wrap:wrap;">
          <span data-i18n="csb.footer.help">
            Click = vertice · Invio = chiudi (≥3) · doppio click area libera = nuova forma (o N) ·
            trascina il corpo = sposta · Canc = elimina forma · rotella = zoom · Alt+drag = pan ·
            doppio click / tasto destro su una curva = raddrizzala
          </span>
          <span style="display:flex; gap:14px; align-items:center;">
            <span id="csbPaperSize" style="color:#9fd6ff; font-family: ui-monospace, Menlo, monospace;"></span>
            <span id="csbMmCursor" style="color:#cfe; font-family: ui-monospace, Menlo, monospace;"></span>
          </span>
        </div>

        <div style="display:flex; gap:10px; justify-content:flex-end; flex-wrap:wrap;">
          <span style="display:flex; gap:10px; margin-right:auto;">
            <button id="csbSavePalladiana" data-i18n="csb.modal.savePal" data-i18n-title="csb.modal.savePalTitle" title="Salva il foglio come progetto palladiana (.mspp.json)" style="padding:9px 14px; background:#4a5a3a; ${btnBase}">💾 Salva palladiana</button>
            <button id="csbOpenPalladiana" data-i18n="csb.modal.openPal" data-i18n-title="csb.modal.openPalTitle" title="Apri un progetto palladiana (.mspp.json)" style="padding:9px 14px; background:#3a5a5a; ${btnBase}">📂 Apri palladiana</button>
          </span>
          <button id="csbUndoVertex" data-i18n="csb.modal.undoVertex" data-i18n-title="csb.modal.undoVertexTitle" title="Rimuovi ultimo vertice (Backspace)" style="padding:9px 14px; background:#444; ${btnBase}">↶ Vertice</button>
          <button id="csbNewShape" data-i18n="csb.modal.newShape" data-i18n-title="csb.modal.newShapeTitle" title="Inizia una nuova forma sul foglio (N)" style="padding:9px 14px; background:#3a6ea5; ${btnBase}">➕ Nuova forma</button>
          <button id="csbDeleteShape" data-i18n="csb.modal.deleteShape" data-i18n-title="csb.modal.deleteShapeTitle" title="Elimina la forma selezionata (Canc)" style="padding:9px 14px; background:#8a3a3a; ${btnBase}">🗑 Elimina forma</button>
          <button id="csbReset" data-i18n="csb.modal.reset" data-i18n-title="csb.modal.resetTitle" title="Svuota il foglio e ricomincia" style="padding:9px 14px; background:#555; ${btnBase}">🔄 Ricomincia</button>
          <button id="csbCancel" data-i18n="csb.modal.cancel" style="padding:9px 18px; background:#555; ${btnBase}">Annulla</button>
          <button id="csbInsert" data-i18n="csb.insert.btn" disabled style="padding:9px 22px; background:#2e8b57; ${btnBase} font-weight:600; opacity:0.4; cursor:not-allowed;">✅ Inserisci nel canvas</button>
        </div>
      </div>
    `;

    document.body.appendChild(modalEl);
    // Traduce il guscio statico del modale (data-i18n / data-i18n-title)
    try { if (window.i18n && window.i18n.applyTranslations) window.i18n.applyTranslations(modalEl); } catch (_) {}

    // Riferimenti
    stageEl = modalEl.querySelector("#csbStage");
    previewCanvas = modalEl.querySelector("#csbPreview");
    rulerTopCanvas = modalEl.querySelector("#csbRulerTop");
    rulerLeftCanvas = modalEl.querySelector("#csbRulerLeft");
    insertBtn = modalEl.querySelector("#csbInsert");
    resetBtn = modalEl.querySelector("#csbReset");
    undoVertexBtn = modalEl.querySelector("#csbUndoVertex");
    newShapeBtn = modalEl.querySelector("#csbNewShape");
    deleteShapeBtn = modalEl.querySelector("#csbDeleteShape");
    savePalladianaBtn = modalEl.querySelector("#csbSavePalladiana");
    openPalladianaBtn = modalEl.querySelector("#csbOpenPalladiana");
    zoomInBtn = modalEl.querySelector("#csbZoomIn");
    zoomOutBtn = modalEl.querySelector("#csbZoomOut");
    fitBtn = modalEl.querySelector("#csbFit");
    zoomLabel = modalEl.querySelector("#csbZoomLabel");
    statusEl = modalEl.querySelector("#csbStatus");
    mmCursorEl = modalEl.querySelector("#csbMmCursor");
    paperSelect = modalEl.querySelector("#csbPaperPreset");
    paperWInput = modalEl.querySelector("#csbPaperW");
    paperHInput = modalEl.querySelector("#csbPaperH");
    paperApplyBtn = modalEl.querySelector("#csbPaperApply");
    paperUnitSelect = modalEl.querySelector("#csbPaperUnit");
    paperAreaLabel = modalEl.querySelector("#csbPaperArea");
    paperSizeLabel = modalEl.querySelector("#csbPaperSize");
    fillColorInput = modalEl.querySelector("#csbFillColor");
    fillAlphaInput = modalEl.querySelector("#csbFillAlpha");
    fillAlphaLabel = modalEl.querySelector("#csbFillAlphaLabel");
    cornerRadiusInput = modalEl.querySelector("#csbCornerRadius");
    cornerRadiusLabel = modalEl.querySelector("#csbCornerLabel");
    cornerOneInput = modalEl.querySelector("#csbCornerOne");
    cornerOneLabel = modalEl.querySelector("#csbCornerOneLabel");
    imageToolsEl = modalEl.querySelector("#csbImageTools");

    ctx = previewCanvas.getContext("2d");
    rulerCtxT = rulerTopCanvas.getContext("2d");
    rulerCtxL = rulerLeftCanvas.getContext("2d");

    // Eventi preview
    previewCanvas.addEventListener("mousedown", onPreviewMouseDown);
    previewCanvas.addEventListener("mousemove", onPreviewMouseMove);
    window.addEventListener("mouseup", onPreviewMouseUp);
    previewCanvas.addEventListener("mouseleave", onPreviewMouseLeave);
    previewCanvas.addEventListener("wheel", onPreviewWheel, { passive: false });
    previewCanvas.addEventListener("dblclick", onPreviewDblClick);
    previewCanvas.addEventListener("contextmenu", onPreviewContextMenu);

    // Tastiera + resize
    document.addEventListener("keydown", onPreviewKeyDown);
    window.addEventListener("resize", onWindowResize);

    // Pulsanti
    modalEl.querySelector("#csbCloseX").addEventListener("click", closeModal);
    modalEl.querySelector("#csbCancel").addEventListener("click", closeModal);
    resetBtn.addEventListener("click", resetState);
    undoVertexBtn.addEventListener("click", undoLastVertex);
    newShapeBtn.addEventListener("click", startNewShape);
    deleteShapeBtn.addEventListener("click", deleteActiveShape);
    if (savePalladianaBtn) savePalladianaBtn.addEventListener("click", savePalladianaProject);
    if (openPalladianaBtn) openPalladianaBtn.addEventListener("click", openPalladianaProject);
    insertBtn.addEventListener("click", insertShapeIntoCanvas);
    zoomInBtn.addEventListener("click", () => zoomByFactor(1.2));
    zoomOutBtn.addEventListener("click", () => zoomByFactor(1 / 1.2));
    fitBtn.addEventListener("click", resetZoom);

    // Controlli foglio
    paperSelect.addEventListener("change", onPaperPresetChange);
    paperApplyBtn.addEventListener("click", onPaperApply);
    if (paperUnitSelect) paperUnitSelect.addEventListener("change", onPaperUnitChange);
    paperWInput.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); onPaperApply(); } });
    paperHInput.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); onPaperApply(); } });

    // Controlli forma (colore / opacità / angoli) — agiscono sulla forma ATTIVA
    // e aggiornano anche i "default" così le NUOVE forme ereditano l'ultima scelta.
    fillColorInput.addEventListener("input", () => {
      const val = fillColorInput.value;
      state.defaults.fillColorHex = val;
      const a = activeShape(); if (a) a.fillColorHex = val;
      renderAll();
    });
    fillAlphaInput.addEventListener("input", () => {
      const val = Math.max(0, Math.min(1, (parseFloat(fillAlphaInput.value) || 0) / 100));
      state.defaults.fillAlpha = val;
      const a = activeShape(); if (a) a.fillAlpha = val;
      if (fillAlphaLabel) fillAlphaLabel.textContent = Math.round(val * 100) + "%";
      renderAll();
    });
    cornerRadiusInput.addEventListener("input", () => {
      const val = Math.max(0, parseInt(cornerRadiusInput.value, 10) || 0);
      state.defaults.cornerRadiusMm = val;
      const a = activeShape();
      if (a) {
        a.cornerRadiusMm = val;
        // "Tutti gli angoli": sovrascrive i raggi per-vertice (comportamento Fase 2A).
        if (a.cornerRadii.length) a.cornerRadii.fill(val);
      }
      renderAll();
      updateUI();
    });
    cornerOneInput.addEventListener("input", () => {
      const a = activeShape(); if (!a) return;
      const sel = state.selectedVertex;
      if (sel < 0 || sel >= a.cornerRadii.length) return;
      a.cornerRadii[sel] = Math.max(0, parseInt(cornerOneInput.value, 10) || 0);
      renderAll();
      updateUI();
    });

    // Inizializza valori controlli forma dai default (nessuna forma attiva ancora)
    fillColorInput.value = state.defaults.fillColorHex;
    fillAlphaInput.value = Math.round(state.defaults.fillAlpha * 100);
    if (fillAlphaLabel) fillAlphaLabel.textContent = Math.round(state.defaults.fillAlpha * 100) + "%";
    cornerRadiusInput.value = state.defaults.cornerRadiusMm;
    cornerOneInput.value = 0;

    // Aggancio del modulo immagine (csb-image.js), se presente: gli passiamo i
    // riferimenti del modale così può costruire i suoi controlli nella toolbar.
    try {
      CSB.background.onModalBuilt({
        modalEl, imageToolsEl, previewCanvas, stageEl
      });
    } catch (_) {}

    // Inizializza valori input foglio (dimensioni nell'unità scelta + area)
    syncPaperInputs();

    // Click sul backdrop chiude
    modalEl.addEventListener("click", (e) => { if (e.target === modalEl) closeModal(); });
  }

  // ───────────────────── Open / Close modale ─────────────────────────────
  function openModal() {
    if (typeof canvas !== "undefined" && canvas && canvas.isDrawingMode) {
      if (typeof flashToast === "function") flashToast(__ct("csb.toast.disablePenCreate", null, "Disattiva penna/acquerello per creare una forma"));
      return;
    }
    buildModalDOM();
    modalEl.style.display = "flex";

    // Stato pulito: una forma vuota in disegno, nessun residuo.
    state.shapes = [newShapeObject()];
    state.activeIndex = 0;
    state.selectedVertex = -1;
    resetDragHover();
    state.snappingToFirst = false;
    syncShapeControls();

    try { CSB.background.onOpen(); } catch (_) {}

    // Layout + fit dopo che il pannello è nel DOM e ha dimensioni reali
    requestAnimationFrame(() => {
      layout(true);
      try { previewCanvas.focus({ preventScroll: true }); } catch (_) {}
    });
  }

  function closeModal() {
    if (!modalEl) return;
    modalEl.style.display = "none";
    state.shapes = [];
    state.activeIndex = -1;
    state.selectedVertex = -1;
    resetDragHover();
    state.panning = false;
    try { CSB.background.onClose(); } catch (_) {}
  }

  // ───────────────────── API pubblica (aggancio moduli) ──────────────────
  // Espone al modulo immagine (csb-image.js) le conversioni di coordinate, le
  // dimensioni del foglio e gli hook di disegno/eventi. `background` contiene
  // implementazioni NO-OP di default: se csb-image.js è caricato, le sovrascrive.
  const CSB = {
    // Conversioni & info (lette al volo, sempre aggiornate)
    screenToWorld: (sx, sy) => ({ x: screenToWorldX(sx), y: screenToWorldY(sy) }),
    worldToScreen: (wx, wy) => ({ x: worldToScreenX(wx), y: worldToScreenY(wy) }),
    getPaperPx: () => ({ w: paperPxW(), h: paperPxH() }),
    getViewScale: () => state.view.scale,
    getDpr: () => dpr,
    mm2px: (mm) => _mm2px(mm),
    px2mm: (px) => _px2mm(px),
    requestRender: () => { renderAll(); },
    requestRenderAndUI: () => { renderAll(); updateUI(); },

    // Hook del modulo immagine (default no-op). Il core li chiama sempre come
    // CSB.background.xxx(...), così il modulo può sovrascrivere i singoli metodi
    // o sostituire l'intero oggetto `background`.
    background: {
      isActive: () => false,
      draw: (_ctx) => {},          // disegno immagine in coord WORLD (sotto la griglia)
      drawOverlay: (_ctx) => {},   // maniglie in coord SCREEN (sopra tutto)
      gridColorHint: () => null,   // null | { dark: boolean }
      onMouseDown: (_w, _s, _e) => false,
      onMouseMove: (_w, _s, _e) => false,
      onMouseUp: () => false,
      cursorFor: (_w, _s, _e) => null,
      onModalBuilt: (_refs) => {},
      onOpen: () => {},
      onClose: () => {}
    }
  };
  window.CSB = CSB;

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