// lassoSelection.js — Selezione "lazo" libera per Mosaica Desktop Pro
// =====================================================================
// Permette di selezionare più oggetti tracciando un poligono libero col
// mouse. Al rilascio del tasto sinistro:
//   • gli oggetti il cui CENTRO è dentro il poligono vengono raggruppati
//     in una fabric.ActiveSelection (selezione multipla nativa di Fabric);
//   • lo strumento si AUTO-DISATTIVA (così il bottone torna pronto al
//     prossimo utilizzo, senza dover cliccarlo di nuovo per uscire).
//
// Convenzioni del progetto:
//   • Modulo caricato via <script> tag (no Web Worker, no ES module).
//   • Variabili "let" top-level NON sono on window — espongo solo le
//     API pubbliche tramite window.* in fondo al file.
//   • Compatibile con freehand / acquerello / gomma: se uno di quegli
//     strumenti è attivo all'attivazione del lazo, viene spento.

let isLassoMode = false;
let isLassoDrawing = false;
let lassoPoints = []; // punti in coordinate canvas (logiche, NON schermo)

// Backup dello stato del canvas per ripristinarlo al deactivate
let prevCanvasSelection = true;
let prevCanvasDefaultCursor = "default";
let prevCanvasHoverCursor = "move";

// Soglie
const LASSO_MIN_POINT_DISTANCE = 2; // px canvas: evita densità eccessiva
const LASSO_MIN_POINTS = 3; // sotto questo numero, nessuna selezione

// Default calibrato per mosaici con tessere piccole (≤10-15 mm²) e fughe
// di 2-3 mm: tracciando a mano libera tra le fughe è impossibile non
// "sfiorare" le tessere da selezionare, quindi serve un valore molto
// permissivo. L'utente può ritoccarlo dal popover (right-click sul
// pulsante #lassoSelectBtn) e il valore viene persistito in
// calibration.json sotto `lassoContainmentThreshold`.
const LASSO_CONTAINMENT_THRESHOLD = 0.2;

// Range consentito (clamp di sicurezza sia per UI che per API)
const LASSO_THRESHOLD_MIN = 0.05;
const LASSO_THRESHOLD_MAX = 1.0;

// Bootstrap: garantisci sempre un valore sano su window prima del load
// asincrono dal calibration store.
if (typeof window.LASSO_CONTAINMENT_THRESHOLD !== "number") {
  window.LASSO_CONTAINMENT_THRESHOLD = LASSO_CONTAINMENT_THRESHOLD;
}

// ============================================================
//  Util
// ============================================================
function _canvas() {
  return window.canvas || null;
}

// Point-in-polygon classico (ray casting). Funziona anche con poligoni
// non convessi (cioè con il lazo che si autointerseca o ha rientranze).
function pointInPolygon(pt, polygon) {
  let inside = false;
  const x = pt.x,
    y = pt.y;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].x,
      yi = polygon[i].y;
    const xj = polygon[j].x,
      yj = polygon[j].y;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

// AABB (bounding box allineato agli assi) di un poligono dato come array
// di {x,y} in coordinate canvas logiche.
function polygonAabb(polygon) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (let i = 0; i < polygon.length; i++) {
    const p = polygon[i];
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, minY, maxX, maxY };
}

// Due AABB si sovrappongono?
function aabbIntersect(a, b) {
  return !(a.maxX < b.minX || a.minX > b.maxX || a.maxY < b.minY || a.minY > b.maxY);
}

// AABB assoluto (coord. canvas logiche) di un oggetto Fabric, già post-
// trasformazioni (angle, scale, flip). getBoundingRect(true, true) =
// absolute=true, calculate=true → ignora viewportTransform e ricalcola
// da zero senza usare la cache.
function objectAabb(obj) {
  try {
    const r = obj.getBoundingRect(true, true);
    return { minX: r.left, minY: r.top, maxX: r.left + r.width, maxY: r.top + r.height };
  } catch (e) {
    return null;
  }
}

// Campiona un set di punti rappresentativi dell'oggetto in coordinate
// canvas ASSOLUTE. Per un mosaico ci servono punti densi attorno e dentro
// la forma reale della tessera, non solo il suo centro:
//   • centro geometrico (1 punto)
//   • 4 angoli del bbox ORIENTATO  (aCoords: tl, tr, br, bl) — segue
//     correttamente rotazione e scale dell'oggetto
//   • 4 punti medi sui lati del bbox orientato
//   • per Polygon / Polyline / Triangle: i vertici reali trasformati nel
//     sistema canvas (limitati a max ~16 campioni per non esplodere su
//     forme con centinaia di vertici)
function sampleObjectPoints(obj) {
  const pts = [];

  try {
    const c = obj.getCenterPoint();
    pts.push({ x: c.x, y: c.y });
  } catch (e) {}

  const ac = obj.aCoords;
  if (ac && ac.tl && ac.tr && ac.bl && ac.br) {
    pts.push({ x: ac.tl.x, y: ac.tl.y });
    pts.push({ x: ac.tr.x, y: ac.tr.y });
    pts.push({ x: ac.br.x, y: ac.br.y });
    pts.push({ x: ac.bl.x, y: ac.bl.y });
    pts.push({ x: (ac.tl.x + ac.tr.x) * 0.5, y: (ac.tl.y + ac.tr.y) * 0.5 });
    pts.push({ x: (ac.tr.x + ac.br.x) * 0.5, y: (ac.tr.y + ac.br.y) * 0.5 });
    pts.push({ x: (ac.br.x + ac.bl.x) * 0.5, y: (ac.br.y + ac.bl.y) * 0.5 });
    pts.push({ x: (ac.bl.x + ac.tl.x) * 0.5, y: (ac.bl.y + ac.tl.y) * 0.5 });
  }

  if (
    (obj.type === "polygon" || obj.type === "polyline" || obj.type === "triangle") &&
    Array.isArray(obj.points) && obj.points.length > 0 &&
    typeof obj.calcTransformMatrix === "function"
  ) {
    try {
      const m = obj.calcTransformMatrix();
      const off = obj.pathOffset || { x: 0, y: 0 };
      // Sotto-campiona se ci sono troppi vertici (tessere irregolari del
      // mosaico raramente superano i 20 lati, ma forme custom potrebbero).
      const step = Math.max(1, Math.ceil(obj.points.length / 16));
      for (let i = 0; i < obj.points.length; i += step) {
        const p = obj.points[i];
        const lx = p.x - off.x;
        const ly = p.y - off.y;
        const wx = m[0] * lx + m[2] * ly + m[4];
        const wy = m[1] * lx + m[3] * ly + m[5];
        pts.push({ x: wx, y: wy });
      }
    } catch (e) { /* fallback silenzioso: il bbox orientato è già sufficiente */ }
  }

  return pts;
}

// L'oggetto va incluso nella selezione del lazo?
// 1) broad-phase AABB (rapida, scarta tessere fuori area)
// 2) narrow-phase: % di punti campionati che cadono dentro il poligono
//    deve essere >= threshold.
function objectInsideLasso(obj, polygon, polyAabb, threshold) {
  // Forza aggiornamento di aCoords / bounding rect in caso un'operazione
  // precedente li abbia lasciati stale (es. transform appena conclusa).
  if (typeof obj.setCoords === "function") {
    try { obj.setCoords(); } catch (e) {}
  }

  const oa = objectAabb(obj);
  if (!oa) return false;
  if (!aabbIntersect(oa, polyAabb)) return false;

  const samples = sampleObjectPoints(obj);
  if (samples.length === 0) return false;

  let inside = 0;
  for (let i = 0; i < samples.length; i++) {
    if (pointInPolygon(samples[i], polygon)) inside++;
  }
  return (inside / samples.length) >= threshold;
}

// È un oggetto che il lazo PUÒ includere nella selezione?
// Usa il backup `__lassoPrevSelectable` perché durante il lazo TUTTI gli
// oggetti hanno selectable=false (forzato da activateLasso per impedire
// drag accidentali) — quindi il "selectable corrente" non è affidabile.
function isSelectableForLasso(obj) {
  if (!obj) return false;
  if (obj.__isBackground === true) return false; // texture carta + sfondo utente
  if (obj.excludeFromExport === true && obj.selectable === false) return false;
  // Recupera lo stato pre-lazo
  const wasSelectable = typeof obj.__lassoPrevSelectable !== "undefined" ? obj.__lassoPrevSelectable : obj.selectable;
  if (wasSelectable === false) return false; // oggetti lock-ati dall'utente
  return true;
}

// ============================================================
//  Disegno overlay del lazo sul contextTop di Fabric
// ============================================================
function drawLassoOverlay() {
  const canvas = _canvas();
  if (!canvas) return;
  const ctx = canvas.contextTop;
  if (!ctx) return;
  canvas.clearContext(ctx);
  if (lassoPoints.length < 2) return;

  ctx.save();

  // Allinea il context alle coordinate "world" del canvas:
  //   transform = viewportTransform * retinaScaling
  // (Fabric scrive su contextTop con queste coordinate, quindi le
  //  riapplichiamo manualmente per disegnare in coord logiche.)
  const retina = typeof canvas.getRetinaScaling === "function" ? canvas.getRetinaScaling() : 1;
  const vpt = canvas.viewportTransform || [1, 0, 0, 1, 0, 0];
  ctx.setTransform(
    vpt[0] * retina,
    vpt[1] * retina,
    vpt[2] * retina,
    vpt[3] * retina,
    vpt[4] * retina,
    vpt[5] * retina
  );

  // Compensazione visiva: il div #paper applica uno scale CSS,
  // quindi normalizzo linewidth e dash per mantenere apparenza
  // costante a qualsiasi zoom.
  const cssScale = window.view && typeof window.view.scale === "number" ? window.view.scale : 1;
  const k = 1 / Math.max(0.1, cssScale);

  ctx.beginPath();
  ctx.moveTo(lassoPoints[0].x, lassoPoints[0].y);
  for (let i = 1; i < lassoPoints.length; i++) {
    ctx.lineTo(lassoPoints[i].x, lassoPoints[i].y);
  }
  // Chiusura visiva al punto iniziale (anteprima della selezione)
  ctx.closePath();

  ctx.fillStyle = "rgba(43, 108, 255, 0.10)";
  ctx.fill();

  ctx.lineWidth = 1.6 * k;
  ctx.strokeStyle = "rgba(43, 108, 255, 0.95)";
  ctx.setLineDash([8 * k, 5 * k]);
  ctx.stroke();

  ctx.restore();
}

function clearLassoOverlay() {
  const canvas = _canvas();
  if (!canvas) return;
  const ctx = canvas.contextTop;
  if (ctx) canvas.clearContext(ctx);
}

// ============================================================
//  Event handlers (mouse:down / move / up del canvas Fabric)
// ============================================================
function onLassoMouseDown(opt) {
  const canvas = _canvas();
  if (!canvas) return;
  if (!isLassoMode) return;
  if (canvas.isDrawingMode) return;
  const e = opt.e;
  // Solo tasto sinistro (button 0)
  if (e && typeof e.button === "number" && e.button !== 0) return;

  isLassoDrawing = true;
  lassoPoints = [];
  const p = canvas.getPointer(e);
  lassoPoints.push({ x: p.x, y: p.y });

  // Pulisci eventuale selezione corrente (così la nuova selezione del
  // lazo sostituisce, non si somma).
  if (canvas.getActiveObject && canvas.getActiveObject()) {
    canvas.discardActiveObject();
  }

  drawLassoOverlay();
}

function onLassoMouseMove(opt) {
  const canvas = _canvas();
  if (!canvas) return;
  if (!isLassoMode || !isLassoDrawing) return;
  const e = opt.e;
  const p = canvas.getPointer(e);
  const last = lassoPoints[lassoPoints.length - 1];
  if (last) {
    const dx = p.x - last.x;
    const dy = p.y - last.y;
    if (dx * dx + dy * dy < LASSO_MIN_POINT_DISTANCE * LASSO_MIN_POINT_DISTANCE) {
      return; // troppo vicino → ignora
    }
  }
  lassoPoints.push({ x: p.x, y: p.y });
  drawLassoOverlay();
}

function onLassoMouseUp(opt) {
  const canvas = _canvas();
  if (!canvas) return;
  if (!isLassoMode) return;

  // Click singolo senza drag: auto-disattiva e basta
  if (!isLassoDrawing) {
    deactivateLasso();
    return;
  }
  isLassoDrawing = false;
  clearLassoOverlay();

  // Raccogli oggetti con la nuova logica AABB + campionamento, calibrata
  // per mosaici (tessere piccole e fitte). Vedi objectInsideLasso().
  let toSelect = [];
  if (lassoPoints.length >= LASSO_MIN_POINTS) {
    const polyAabb = polygonAabb(lassoPoints);
    const threshold = (typeof window.LASSO_CONTAINMENT_THRESHOLD === "number" &&
                       window.LASSO_CONTAINMENT_THRESHOLD > 0 &&
                       window.LASSO_CONTAINMENT_THRESHOLD <= 1)
      ? window.LASSO_CONTAINMENT_THRESHOLD
      : LASSO_CONTAINMENT_THRESHOLD;
    const objs = canvas.getObjects ? canvas.getObjects() : [];
    toSelect = objs.filter((obj) => {
      if (!isSelectableForLasso(obj)) return false;
      try {
        return objectInsideLasso(obj, lassoPoints, polyAabb, threshold);
      } catch (err) {
        return false;
      }
    });
  }

  lassoPoints = [];

  // IMPORTANTE: disattiva il lazo PRIMA di settare la selezione, così
  // setActiveObject() lavora con selectable/evented già ripristinati
  // (altrimenti l'ActiveSelection sarebbe inerte).
  deactivateLasso();

  if (toSelect.length === 1) {
    canvas.setActiveObject(toSelect[0]);
    canvas.requestRenderAll();
  } else if (toSelect.length > 1) {
    const sel = new fabric.ActiveSelection(toSelect, { canvas });
    canvas.setActiveObject(sel);
    canvas.requestRenderAll();
    if (typeof window.flashToast === "function") {
      window.flashToast(`🎯 Lazo: ${toSelect.length} oggetti selezionati`);
    }
  } else {
    canvas.requestRenderAll();
    if (typeof window.flashToast === "function") {
      window.flashToast("Lazo: nessun oggetto incluso");
    }
  }
}

// Riapplica l'overlay dopo ogni render di Fabric: se qualche operazione
// esterna provoca canvas.renderAll() durante il tracciamento, il
// contextTop viene pulito da Fabric e il lazo sparirebbe. Questo listener
// è la safety net per ridisegnarlo subito dopo.
function onAfterRenderRedrawLasso() {
  if (isLassoMode && isLassoDrawing && lassoPoints.length >= 2) {
    drawLassoOverlay();
  }
}

// ============================================================
//  Attivazione / disattivazione
// ============================================================
function activateLasso() {
  const canvas = _canvas();
  if (!canvas) return;
  if (isLassoMode) return;

  // 1) Spegni altri strumenti modali (penna / gomma / acquerello).
  //    Cliccare il loro pulsante è il modo più affidabile perché
  //    freehandDrawing.js usa state interno non esposto.
  try {
    const wb = document.getElementById("watercolorBtn");
    const eb = document.getElementById("eraserBtn");
    const fb = document.getElementById("freehandBtn");
    if (wb && wb.classList.contains("active")) wb.click();
    if (eb && eb.classList.contains("active")) eb.click();
    if (fb && fb.classList.contains("active")) fb.click();
  } catch (err) {}

  // 2) Backup stato canvas
  prevCanvasSelection = canvas.selection;
  prevCanvasDefaultCursor = canvas.defaultCursor;
  prevCanvasHoverCursor = canvas.hoverCursor;

  // 3) Disabilita la selezione a rettangolo nativa di Fabric e il
  //    drag/selezione degli oggetti durante il tracciamento del lazo.
  canvas.selection = false;
  canvas.defaultCursor = "crosshair";
  canvas.hoverCursor = "crosshair";

  if (canvas.getObjects) {
    canvas.getObjects().forEach((o) => {
      if (!o) return;
      o.__lassoPrevSelectable = o.selectable;
      o.__lassoPrevEvented = o.evented;
      o.selectable = false;
      o.evented = false;
    });
  }

  // 4) Discarda selezione corrente per partire puliti
  if (canvas.getActiveObject && canvas.getActiveObject()) {
    canvas.discardActiveObject();
  }

  // 5) Aggancia gli event handler
  canvas.on("mouse:down", onLassoMouseDown);
  canvas.on("mouse:move", onLassoMouseMove);
  canvas.on("mouse:up", onLassoMouseUp);
  canvas.on("after:render", onAfterRenderRedrawLasso);

  isLassoMode = true;

  // 6) UI feedback
  const btn = document.getElementById("lassoSelectBtn");
  if (btn) btn.classList.add("active");
  const selectBtn = document.getElementById("selectToolBtn");
  if (selectBtn) selectBtn.classList.remove("active");

  canvas.requestRenderAll();
  if (typeof window.flashToast === "function") {
    window.flashToast("🎯 Lazo attivato — trascina per selezionare");
  }
}

function deactivateLasso() {
  const canvas = _canvas();
  if (!canvas) return;
  if (!isLassoMode) return;

  // 1) Rimuovi handler
  canvas.off("mouse:down", onLassoMouseDown);
  canvas.off("mouse:move", onLassoMouseMove);
  canvas.off("mouse:up", onLassoMouseUp);
  canvas.off("after:render", onAfterRenderRedrawLasso);

  // 2) Ripristina selectable / evented di ogni oggetto rispettando il
  //    backup (così non sblocchiamo per sbaglio oggetti che l'utente
  //    aveva lock-ato dal menu radiale).
  if (canvas.getObjects) {
    canvas.getObjects().forEach((o) => {
      if (!o) return;
      if (typeof o.__lassoPrevSelectable !== "undefined") {
        o.selectable = o.__lassoPrevSelectable;
        delete o.__lassoPrevSelectable;
      } else {
        o.selectable = true;
      }
      if (typeof o.__lassoPrevEvented !== "undefined") {
        o.evented = o.__lassoPrevEvented;
        delete o.__lassoPrevEvented;
      } else {
        o.evented = true;
      }
    });
  }

  // 3) Ripristina stato canvas
  canvas.selection = prevCanvasSelection;
  canvas.defaultCursor = prevCanvasDefaultCursor;
  canvas.hoverCursor = prevCanvasHoverCursor;

  // 4) Reset stato modulo
  isLassoMode = false;
  isLassoDrawing = false;
  lassoPoints = [];
  clearLassoOverlay();

  // 5) UI feedback: spegni il pulsante lazo, riaccendi il "Seleziona"
  //    default se nessun altro tool è on.
  const btn = document.getElementById("lassoSelectBtn");
  if (btn) btn.classList.remove("active");
  try {
    const fb = document.getElementById("freehandBtn");
    const eb = document.getElementById("eraserBtn");
    const wb = document.getElementById("watercolorBtn");
    const anyOn =
      (fb && fb.classList.contains("active")) ||
      (eb && eb.classList.contains("active")) ||
      (wb && wb.classList.contains("active"));
    const selectBtn = document.getElementById("selectToolBtn");
    if (selectBtn && !anyOn) selectBtn.classList.add("active");
  } catch (err) {}
}

function toggleLasso() {
  if (isLassoMode) deactivateLasso();
  else activateLasso();
}

// ============================================================
//  Persistenza soglia + popover impostazioni
// ============================================================

// Carica la soglia dal calibration store (file userData/calibration.json
// gestito dal main process via calibrationStore.js). Se il campo non c'è
// o è fuori range, manteniamo il default.
async function _loadLassoThreshold() {
  if (!window.calibrationAPI || typeof window.calibrationAPI.load !== "function") return;
  try {
    const data = await window.calibrationAPI.load();
    const v = data && data.lassoContainmentThreshold;
    if (typeof v === "number" && v >= LASSO_THRESHOLD_MIN && v <= LASSO_THRESHOLD_MAX) {
      window.LASSO_CONTAINMENT_THRESHOLD = v;
      _refreshLassoSettingsUI(v);
    }
  } catch (err) {
    console.warn("[lassoSelection] load soglia fallito:", err);
  }
}

// Salva la soglia in calibration.json facendo MERGE non distruttivo:
// load → sovrascrivi solo la chiave nostra → save. Questo evita di
// cancellare altri campi (es. calibrationFactor scritto da renderer.js).
async function _saveLassoThreshold(value) {
  if (!window.calibrationAPI || typeof window.calibrationAPI.save !== "function") return;
  let payload = {};
  if (typeof window.calibrationAPI.load === "function") {
    try { payload = (await window.calibrationAPI.load()) || {}; } catch (e) { payload = {}; }
  }
  payload.lassoContainmentThreshold = value;
  try {
    await window.calibrationAPI.save(payload);
  } catch (err) {
    console.warn("[lassoSelection] save soglia fallito:", err);
  }
}

// API pubblica: setta la soglia, applica immediato + (opz.) persiste.
function setLassoThreshold(value, opts) {
  const v = Math.max(LASSO_THRESHOLD_MIN, Math.min(LASSO_THRESHOLD_MAX, Number(value)));
  if (!isFinite(v)) return;
  window.LASSO_CONTAINMENT_THRESHOLD = v;
  if (!opts || opts.persist !== false) {
    _saveLassoThreshold(v);
  }
  _refreshLassoSettingsUI(v);
  return v;
}

function getLassoThreshold() {
  return typeof window.LASSO_CONTAINMENT_THRESHOLD === "number"
    ? window.LASSO_CONTAINMENT_THRESHOLD
    : LASSO_CONTAINMENT_THRESHOLD;
}

// ----- UI: popover impostazioni (slider + reset) ----------------------
function _refreshLassoSettingsUI(value) {
  const slider = document.getElementById("lassoThresholdSlider");
  const display = document.getElementById("lassoThresholdValue");
  if (slider && Math.abs(parseFloat(slider.value) - value) > 1e-6) {
    slider.value = String(value);
  }
  if (display) {
    display.textContent = `${value.toFixed(2)} (${Math.round(value * 100)}%)`;
  }
}

function _positionLassoPopoverNear(btn, pop) {
  if (!btn || !pop) return;
  const r = btn.getBoundingClientRect();
  pop.style.left = `${Math.round(r.left)}px`;
  pop.style.top = `${Math.round(r.bottom + 6)}px`;
  pop.style.visibility = "hidden";
  pop.style.display = "block";
  // Correzione anti-clipping orizzontale
  const pr = pop.getBoundingClientRect();
  if (pr.right > window.innerWidth - 8) {
    pop.style.left = `${Math.max(8, window.innerWidth - pr.width - 8)}px`;
  }
  // Correzione anti-clipping verticale (se non c'è spazio sotto il
  // bottone, apri sopra di esso).
  if (pr.bottom > window.innerHeight - 8) {
    pop.style.top = `${Math.max(8, r.top - pr.height - 6)}px`;
  }
  pop.style.visibility = "visible";
}

function _openLassoSettings() {
  const pop = document.getElementById("lassoSettingsPopover");
  const btn = document.getElementById("lassoSelectBtn");
  if (!pop || !btn) return;
  _refreshLassoSettingsUI(getLassoThreshold());
  _positionLassoPopoverNear(btn, pop);
  pop.setAttribute("aria-hidden", "false");
}

function _closeLassoSettings() {
  const pop = document.getElementById("lassoSettingsPopover");
  if (!pop) return;
  pop.style.display = "none";
  pop.setAttribute("aria-hidden", "true");
}

function _wireLassoSettingsUI() {
  const btn = document.getElementById("lassoSelectBtn");
  const pop = document.getElementById("lassoSettingsPopover");
  if (!btn || !pop) return;

  // Right-click sul bottone lasso → apre il popover (non attiva il lazo).
  btn.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    e.stopPropagation();
    _openLassoSettings();
  });

  const slider = pop.querySelector("#lassoThresholdSlider");
  const closeBtn = pop.querySelector("#lassoSettingsClose");
  const resetBtn = pop.querySelector("#lassoSettingsReset");

  if (slider) {
    // input: applicazione live, ZERO scrittura su disco
    slider.addEventListener("input", () => {
      setLassoThreshold(slider.value, { persist: false });
    });
    // change: solo a fine drag → 1 sola write su disco
    slider.addEventListener("change", () => {
      setLassoThreshold(slider.value, { persist: true });
    });
  }
  if (resetBtn) {
    resetBtn.addEventListener("click", () => {
      setLassoThreshold(LASSO_CONTAINMENT_THRESHOLD, { persist: true });
    });
  }
  if (closeBtn) {
    closeBtn.addEventListener("click", _closeLassoSettings);
  }

  // Click fuori → chiudi
  document.addEventListener("mousedown", (e) => {
    if (pop.getAttribute("aria-hidden") === "true") return;
    if (pop.contains(e.target)) return;
    if (e.target === btn || btn.contains(e.target)) return;
    _closeLassoSettings();
  });

  // ESC → chiudi il popover (gestito a parte rispetto all'ESC che esce
  // dal lazo: i due controlli leggono stati diversi e convivono ok).
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && pop.getAttribute("aria-hidden") === "false") {
      _closeLassoSettings();
    }
  });
}

// ================  Init ===========================================
function initLassoSelection() {
  const btn = document.getElementById("lassoSelectBtn");
  if (!btn) {
    console.warn("[lassoSelection] #lassoSelectBtn non trovato nel DOM");
    return;
  }
  btn.addEventListener("click", () => {
    toggleLasso();
  });

  // Se l'utente clicca un altro tool mentre il lazo è attivo, disattivalo
  // (così non restiamo in uno stato "ibrido" confuso).
  ["freehandBtn", "eraserBtn", "watercolorBtn", "selectToolBtn", "addShapeBtn"].forEach((id) => {
    const b = document.getElementById(id);
    if (!b) return;
    b.addEventListener("click", () => {
      if (isLassoMode) deactivateLasso();
    });
  });

  // ESC come scorciatoia per uscire dal lazo a metà tracciamento
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && isLassoMode) {
      deactivateLasso();
    }
  });

  // Popover impostazioni (slider sensibilità) + load persistente dal
  // calibration store. Il load è async ma non blocca: applica il
  // default sincrono e poi sovrascrive con il valore salvato non appena
  // arriva.
  _wireLassoSettingsUI();
  _loadLassoThreshold();

  console.log("[lassoSelection] inizializzato");
}

// ============================================================
//  Esposizioni globali
// ============================================================
window.initLassoSelection = initLassoSelection;
window.activateLasso = activateLasso;
window.deactivateLasso = deactivateLasso;
window.toggleLasso = toggleLasso;
window.isLassoMode = () => isLassoMode;
window.setLassoThreshold = setLassoThreshold;
window.getLassoThreshold = getLassoThreshold;
