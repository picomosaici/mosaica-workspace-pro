// ============================================================
//  i18n helper locale per renderer.js (Fase 4)
//  ------------------------------------------------------------
//  Wrapper sicuro intorno a window.i18n.t() con fallback al
//  testo italiano originale: se per qualsiasi motivo il modulo
//  i18n non è ancora pronto o la chiave non esiste, restituisce
//  il fallback — così l'app resta funzionante e in IT puro.
// ============================================================
function __t(key, params, fallback) {
  try {
    if (window.i18n && typeof window.i18n.t === "function") {
      const v = window.i18n.t(key, params);
      // se il motore ritorna la chiave stessa (= missing), usa fallback
      if (v === key && fallback != null) return fallback;
      return v;
    }
  } catch (_) {}
  // Fallback con interpolazione manuale {placeholder} sul testo italiano
  let s = (fallback != null ? String(fallback) : key);
  if (params) {
    s = s.replace(/\{(\w+)\}/g, (m, k) =>
      Object.prototype.hasOwnProperty.call(params, k) ? String(params[k]) : m
    );
  }
  return s;
}

// renderer.js — Mosaica Workspace Pro
// ============== DEBUG INIZIALE ==============
console.log("[renderer] check API:", {
  projectAPI: !!window.projectAPI,
  textureAPI: !!window.textureAPI,
  calibrationAPI: !!window.calibrationAPI,
  desktopAPI: !!window.desktopAPI
});
console.log("[renderer] check window.projectAPI, textureAPI, calibrationAPI, desktopAPI:", {
  projectAPI: !!window.projectAPI,
  textureAPI: !!window.textureAPI,
  calibrationAPI: !!window.calibrationAPI,
  desktopAPI: !!window.desktopAPI
});
console.log("API:", {
  projectAPI: window.projectAPI,
  textureAPI: window.textureAPI,
  calibrationAPI: window.calibrationAPI,
  desktopAPI: window.desktopAPI
});
if (window.projectAPI) {
  window.projectAPI
    .listProjects()
    .then((l) => console.log("[renderer] projects:list ok, count=", l.length, l))
    .catch((err) => console.error("[renderer] projects:list error", err));
} else {
  console.warn("[renderer] projectAPI NON disponibile — verifica preload/webPreferences/preload path");
}
// ============== UTILITIES BASE ==============
// ---------- CUSTOM CONTROLS: arrow handles, rotation lower, pointer cursor ----------
function _angleForControl(name) {
  switch (name) {
    case "tl":
      return -135;
    case "tr":
      return -45;
    case "br":
      return 45;
    case "bl":
      return 135;
    case "mt":
      return -90;
    case "mb":
      return 90;
    case "ml":
      return 180;
    case "mr":
      return 0;
    case "mtr":
      return 90; // pointer pointing down for rotation control
  }
  return 0;
}

// ── Icona SVG per la maniglia di rotazione (mtr) ──────────────────────────
// Stessa SVG usata come cursore in mouseObserver.js durante la rotazione fine
// col tasto destro: la maniglia diventa quindi un'anteprima visiva del cursore.
// Pre-caricata UNA volta a livello di modulo per non allocare un Image a ogni
// frame di render. Il colore è allineato a quello delle altre maniglie (#0400a9)
// invece del #2100FF originale del cursore, per coerenza cromatica con tl/tr/...
const _MTR_ICON_COLOR = "#0400a9";
const _MTR_ICON_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="1212" height="1212" ' +
  'viewBox="-300 -300 1212 1212">' +
  '<g fill="' +
  _MTR_ICON_COLOR +
  '">' +
  '<path d="M593.011,382.796H401.785c-10.556,0-19.123,8.567-19.123,19.123' +
  "s10.001,17.937,18.167,26.083l53.142,53.142c-39.909,33.848-91.387,54.462" +
  "-147.837,54.462c-113.665,0-207.786-82.744-226.029-191.227H2.811" +
  "c18.855,150.878,147.32,267.717,303.323,267.717c77.58,0,148.296-28.99" +
  ",202.164-76.624l54.786,54.786c10.308,10.307,19.371,22.01,29.927,22.01" +
  "s19.123-8.567,19.123-19.123V401.919C612.134,399.605,612.134,382.796" +
  ",593.011,382.796z M19.256,229.471h191.226c10.556,0,19.123-8.567,19.123" +
  "-19.123s-10.001-17.937-18.167-26.083l-53.142-53.142c39.909-33.847" +
  ",91.387-54.461,147.837-54.461c113.665,0,207.786,82.744,226.029,191.226" +
  "h77.293C590.602,117.011,462.136,0.172,306.134,0.172c-77.581" +
  ",0-148.296,28.99-202.164,76.625L49.183,22.01C38.876,11.703,29.812" +
  ",0,19.256,0S0.134,8.567,0.134,19.123v191.226C0.134,212.663,0.134" +
  ',229.471,19.256,229.471z"/>' +
  "</g>" +
  "</svg>";
const _mtrRotationIcon = new Image();
_mtrRotationIcon.src = "data:image/svg+xml;utf8," + encodeURIComponent(_MTR_ICON_SVG);
// Quando l'SVG è decodificato, forziamo un re-render: alla primissima selezione
// la maniglia potrebbe trovarsi in un frame in cui l'immagine non è ancora pronta.
_mtrRotationIcon.addEventListener("load", () => {
  if (window.canvas && typeof window.canvas.requestRenderAll === "function") {
    window.canvas.requestRenderAll();
  }
});

// ============== CUSTOM CONTROLS – FRECCE + SIMBOLO ROTAZIONE ==============
function _drawArrow(ctx, left, top, size, baseAngleDeg, objectAngleDeg = 0, fillStyle = "#0400a9") {
  ctx.save();
  ctx.translate(left, top);

  // 🔥 CONTRO-ROTATION: le frecce restano sempre orientate rispetto allo schermo
  ctx.rotate(((baseAngleDeg - objectAngleDeg) * Math.PI) / 180);

  const s = Math.max(6, size);
  ctx.beginPath();
  ctx.moveTo(-s * 0.5, -s * 0.25);
  ctx.lineTo(s * 0.25, 0);
  ctx.lineTo(-s * 0.5, s * 0.25);
  ctx.closePath();
  ctx.fillStyle = fillStyle;
  ctx.fill();
  ctx.restore();
}

["tl", "tr", "br", "bl", "mt", "mb", "ml", "mr", "mtr"].forEach((name) => {
  const ctrl = fabric.Object.prototype.controls[name];
  if (!ctrl) return;

  if (name === "mtr") {
    ctrl.__isMtr = true; // ← flag stabile (non dipende da this.name)
    ctrl.y = -0.6; // ← un poco più in su rispetto a -0.8
    ctrl.offsetY = -4; // ← offset aggiuntivo verso l'alto (in canvas px)
    ctrl.sizeX = 8; // ← hit area un filo più piccola
    ctrl.sizeY = 8;
    ctrl.cursorStyle = "grab";
  } else {
    ctrl.cursorStyle = "crosshair";
  }

  ctrl.render = function (ctx, left, top, styleOverride, fabricObject) {
    ctx.save();
    ctx.translate(left, top);

    if (this.__isMtr) {
      // ── Simbolo di rotazione: stessa icona SVG del cursore di rotazione ─────
      // (mouseObserver.js → ROTATION_CURSOR_SVG). Così quando l'utente afferra
      // questa maniglia o usa la rotazione fine col destro, vede SEMPRE la
      // stessa icona — coerenza visiva tra maniglia e cursore.
      // Compensa il livello di zoom corrente per dimensione costante a schermo
      // (40%–800%), come faceva il vecchio arco.
      const _vScale = typeof view !== "undefined" && view && view.scale ? view.scale : 1;
      const ICON = 28 / _vScale; // dimensione su schermo dell'icona (in px canvas)
      ctx.shadowColor = "rgba(0,0,0,0.55)";
      ctx.shadowBlur = 5 / _vScale;
      if (_mtrRotationIcon.complete && _mtrRotationIcon.naturalWidth > 0) {
        ctx.drawImage(_mtrRotationIcon, -ICON / 2, -ICON / 2, ICON, ICON);
      }
      // (Se l'immagine non è ancora pronta, il listener `load` su _mtrRotationIcon
      //  invocherà requestRenderAll() e questo branch verrà rieseguito al frame
      //  successivo — niente fallback necessario in pratica.)
    } else {
      const size = fabricObject.cornerSize || 12;
      const baseAngle = _angleForControl(name);
      const objAngle = fabricObject.angle || 0;
      _drawArrow(ctx, 0, 0, size, baseAngle, objAngle, "#0400a9");
    }

    ctx.restore();
  };
});

let isRestoringProject = false;
let currentProjectPath = null; // path completo dell'ultimo progetto salvato/aperto
let paperTextureRotationDeg = 0; // accumulatore rotazione texture carta (multipli di 90°)

function detectCssPpi() {
  const el = document.getElementById("cssInchDetector");
  return el?.offsetWidth || 96;
}

let CSS_PPI = detectCssPpi();
let base_MM_TO_PX = CSS_PPI / 25.4;
let calibrationFactor = 1;
let A4_MM_W = 210;
let A4_MM_H = 297;

const mm2px = (mm) => mm * base_MM_TO_PX * calibrationFactor;
const px2mm = (px) => px / (base_MM_TO_PX * calibrationFactor);

function snapAngleDeg(angleDeg, step = 1) {
  let a = ((((angleDeg + 180) % 360) + 360) % 360) - 180;
  return Math.round(a / step) * step;
}

function _centroidOfPoints(pts) {
  let cx = 0,
    cy = 0;
  pts.forEach((p) => {
    cx += p.x;
    cy += p.y;
  });
  return { x: cx / pts.length, y: cy / pts.length };
}

function flashToast(msg, opts = {}) {
  // Durata personalizzabile, minimo garantito 3000ms per leggibilità.
  // Le scorciatoie tablet/tastiera passano testi lunghi → default 3500ms.
  const duration = Math.max(3000, opts.duration || 3500);

  let t = document.getElementById("__mini_toast");
  if (!t) {
    t = document.createElement("div");
    t.id = "__mini_toast";
    document.body.appendChild(t);
  }
  // Applico SEMPRE lo style (non solo alla creazione) così se in futuro
  // qualcuno modifica regole CSS conflittuali, l'inline vince per specificità.
  // z-index 30000 = sopra appLoader (20000) e tutti i modali (≤20004).
  t.style.cssText =
    "position:fixed;right:80px;bottom:22px;" +
    "background:rgba(0,0,0,0.88);color:#fff;" +
    "padding:10px 14px;border-radius:8px;" +
    "border:1px solid rgba(255,255,255,0.14);" +
    "box-shadow:0 6px 22px rgba(0,0,0,0.55);" +
    "font-size:13px;line-height:1.35;max-width:60vw;" +
    "pointer-events:none;" +
    "z-index:30000;" +
    "transition:opacity .25s;opacity:1;";
  t.textContent = msg;

  if (window.__toastTimer) clearTimeout(window.__toastTimer);
  window.__toastTimer = setTimeout(() => {
    t.style.opacity = 0;
  }, duration);
}

function flashToastSafe(msg, opts = {}) {
  try {
    if (typeof flashToast === "function") {
      flashToast(msg, opts);
      return;
    }
    console.log("[TOAST]", msg);
  } catch (e) {
    console.log("[TOAST][ERR]", msg);
  }
}

// ====================== TOAST CENTRATO IN ALTO ======================
// Usato per avvisi importanti tipo l'uscita dal fullscreen.
// NON sostituisce flashToast (che resta in basso a destra per i feedback brevi).
function flashTopToast(msg, duration = 4500) {
  // Minimo 3000ms garantito (come il mini toast)
  duration = Math.max(3000, duration);

  let t = document.getElementById("__top_toast");
  if (!t) {
    t = document.createElement("div");
    t.id = "__top_toast";
    document.body.appendChild(t);
  }
  // Forzo z-index inline a 30001 (sopra il mini-toast a 30000 in caso
  // entrambi siano visibili) sovrascrivendo la regola CSS in index.html
  // che lo aveva a 10003. Lo applico ogni volta per blindare il valore.
  t.style.zIndex = "30001";

  t.textContent = msg;
  // forzo reflow per riattivare la transition se richiamato in rapida successione
  void t.offsetWidth;
  t.style.opacity = "1";
  if (window.__topToastTimer) clearTimeout(window.__topToastTimer);
  window.__topToastTimer = setTimeout(() => {
    t.style.opacity = "0";
  }, duration);
}

// ====================== QUALITÀ CANVAS DINAMICA (HiDPI adattivo) ======================
// Il moltiplicatore di risoluzione interna del canvas viene adattato dinamicamente
// al livello di zoom corrente, in modo che il backstore (i pixel reali del canvas)
// sia sempre ≥ alla dimensione visualizzata sullo schermo. Così l'immagine resta in
// HD piena a qualsiasi zoom (40%–800%) senza gonfiare la VRAM quando non serve.
//
// Lavoriamo "a step" (non in continuo) per evitare riallocazioni del backstore ad
// ogni tick della rotella: il quality scale cambia solo quando si supera una soglia.
//
// A4 di base ≈ 800×1130 px CSS:
//   step 2 → buffer 1600×2260  (~14 MB)  — usato per zoom  40%–150%
//   step 3 → buffer 2400×3390  (~32 MB)  — usato per zoom 150%–250%
//   step 4 → buffer 3200×4520  (~58 MB)  — usato per zoom 250%–350%
//   step 5 → buffer 4000×5650  (~90 MB)  — usato per zoom 350%–450%
//   step 6 → buffer 4800×6780  (~124 MB) — usato per zoom 450%–550%
//   step 7 → buffer 5600×7910  (~169 MB) — usato per zoom 550%–650%
//   step 8 → buffer 6400×9040  (~221 MB) — usato per zoom 650%–800%

// Limiti di zoom (usati anche dal clamp in setZoomCentered)
const MIN_ZOOM = 0.4; // 40%
const MAX_ZOOM = 8; // 800%

const MIN_QUALITY_SCALE = 2; // qualità Retina minima (sempre attiva)
const MAX_QUALITY_SCALE = 8; // basta per HD pieno fino al 800% di zoom
let currentQualityScale = MIN_QUALITY_SCALE;

// Zona morta attorno alle soglie di fascia: per cambiare fascia la scala deve
// superare la soglia di almeno questo margine. Elimina le riallocazioni ripetute
// del backstore quando lo zoom oscilla a cavallo di una soglia.
const QUALITY_HYSTERESIS = 0.15;

// Fascia "ideale" senza isteresi (vecchia logica, soglie nette).
function _idealQualityScale(viewScale) {
  if (viewScale <= 1.5) return 2; // zoom  40%–150%
  if (viewScale <= 2.5) return 3; // zoom 150%–250%
  if (viewScale <= 3.5) return 4; // zoom 250%–350%
  if (viewScale <= 4.5) return 5; // zoom 350%–450%
  if (viewScale <= 5.5) return 6; // zoom 450%–550%
  if (viewScale <= 6.5) return 7; // zoom 550%–650%
  return 8;                       // zoom 650%–800%
}

// ── 🛟 TETTO DI SICUREZZA GPU SUL BACKSTORE ─────────────────────────────────
// Questa è la causa vera del crash con schermata bianca a zoom alto
// ("GPU process exited unexpectedly: exit_code=34").
//
// In Mosaica lo zoom è una CSS transform sul #paper: il viewportTransform di
// Fabric resta SEMPRE l'identità. Di conseguenza Fabric alloca il backstore per
// TUTTO il foglio A4 alla scala qualità corrente, ANCHE se a zoom alto a schermo
// se ne vede solo un angolino. A scala 8 il backstore arriva a ~6400×9040
// (~228 MB) — e ce ne sono DUE (lower + upper canvas) → oltre 450 MB di superfici
// GPU. Su molte schede (specie integrate) questo supera il limite/timeout del
// driver (TDR/OOM) e il processo GPU muore: la finestra diventa bianca.
//
// Soluzione mirata: la scala qualità non sale mai oltre un budget di megapixel
// del backstore. A zoom molto alti l'immagine può risultare un filo meno nitida
// (upscaling CSS di un fattore piccolo, impercettibile mentre si lavora), ma il
// processo GPU non viene più spinto al collasso. Il foglio è comunque renderizzato
// a piena qualità all'export (toCanvasElement è un percorso separato).
//
// TUNABLE: alza MAX_BACKSTORE_MEGAPIXELS se la tua GPU regge di più (ogni unità in
// più aumenta la nitidezza a zoom alto ma anche la VRAM usata, ~4 MB/Mpx ×2 canvas).
//   24 Mpx  → scala max ~5 su A4 (~89 MB/superficie)  [default, sicuro]
//   32 Mpx  → scala max ~6 su A4 (~128 MB/superficie)
//   45 Mpx  → scala max ~7 su A4 (~175 MB/superficie)
const MAX_BACKSTORE_MEGAPIXELS = 24;

function _maxQualityForBudget() {
  // Dimensioni LOGICHE (CSS) attuali del foglio. Se il canvas non è ancora
  // pronto usiamo l'A4 base, così la prima scala è comunque sensata.
  const cw = (canvas && canvas.getWidth && canvas.getWidth()) || mm2px(A4_MM_W) || 794;
  const ch = (canvas && canvas.getHeight && canvas.getHeight()) || mm2px(A4_MM_H) || 1123;
  const basePx = Math.max(1, cw * ch);
  const budgetPx = MAX_BACKSTORE_MEGAPIXELS * 1e6;
  // Backstore = (cw·Q)·(ch·Q) = basePx·Q² ≤ budgetPx  →  Q ≤ √(budgetPx / basePx)
  let q = Math.floor(Math.sqrt(budgetPx / basePx));
  if (q < MIN_QUALITY_SCALE) q = MIN_QUALITY_SCALE;
  if (q > MAX_QUALITY_SCALE) q = MAX_QUALITY_SCALE;
  return q;
}

function computeQualityScale(viewScale) {
  const ideal = _idealQualityScale(viewScale);
  const cur = currentQualityScale;

  let result;
  if (ideal === cur) {
    result = cur;
  } else if (ideal > cur) {
    // La soglia tra la fascia k e la k+1 è a (k - 0.5); la fascia "cur" copre
    // l'intervallo ( cur-1.5 , cur-0.5 ]. Cambiamo fascia SOLO se abbiamo superato
    // la soglia di almeno QUALITY_HYSTERESIS, altrimenti restiamo dove siamo.
    const upBoundary = (cur - 0.5) + QUALITY_HYSTERESIS;
    result = viewScale > upBoundary ? ideal : cur;
  } else {
    const downBoundary = (cur - 1.5) - QUALITY_HYSTERESIS;
    result = viewScale < downBoundary ? ideal : cur;
  }

  // Tetto di sicurezza GPU: SEMPRE applicato come ultimo passo, anche se
  // l'isteresi vorrebbe restare più in alto. Se per qualunque motivo la scala
  // corrente fosse sopra il budget (es. foglio ingrandito dalla calibrazione),
  // questo la riporta sotto al prossimo refresh, liberando VRAM.
  const cap = _maxQualityForBudget();
  return Math.min(result, cap);
}

// Inganna Fabric: usa la nostra scala invece del devicePixelRatio dello schermo.
// Deve essere fatto PRIMA di istanziare il canvas.
fabric.devicePixelRatio = currentQualityScale;

// ============== STRISCIA CALIBRAZIONE DINAMICA ==============
const REFERENCE_MM = 50; // lunghezza teorica della striscia grigia

function updateCalibStrip() {
  const strip = document.getElementById("calibStrip");
  if (!strip) return;

  const targetPx = Math.round(mm2px(REFERENCE_MM)); // sempre esattamente 50 mm teorici
  strip.style.width = `${targetPx}px`;
  strip.style.maxWidth = "100%";
  strip.style.margin = "0 auto";
}

async function applyCalibration() {
  const measured = parseFloat(measuredInput.value);
  if (isNaN(measured) || measured <= 0) {
    flashToast(__t("toast.calib.invalidValue", null, "❌ Inserisci un valore valido (> 0)"));
    return;
  }
  updateCalibStrip();
  calibrationFactor = REFERENCE_MM / measured;

  // Salva: MERGE non distruttivo per non perdere altri campi
  // (es. lassoContainmentThreshold scritto da lassoSelection.js).
  if (window.calibrationAPI?.save) {
    try {
      const existing = (window.calibrationAPI.load ? await window.calibrationAPI.load() : null) || {};
      await window.calibrationAPI.save({ ...existing, calibrationFactor });
    } catch (e) {
      window.calibrationAPI.save({ calibrationFactor });
    }
  } else {
    localStorage.setItem("mosaica_calibration_factor", calibrationFactor);
  }

  setPaperSizeFromMM();
  applyTransform();

  if (miniValue) miniValue.textContent = `${REFERENCE_MM} mm`;
  flashToast(__t("toast.calib.applied", { factor: calibrationFactor.toFixed(4) }, `✅ Calibrazione applicata! Fattore = ${calibrationFactor.toFixed(4)}`));
}

async function resetCalibration() {
  calibrationFactor = 1;

  // Salva: MERGE non distruttivo (stesso ragionamento di applyCalibration).
  if (window.calibrationAPI?.save) {
    try {
      const existing = (window.calibrationAPI.load ? await window.calibrationAPI.load() : null) || {};
      await window.calibrationAPI.save({ ...existing, calibrationFactor: 1 });
    } catch (e) {
      window.calibrationAPI.save({ calibrationFactor: 1 });
    }
  } else {
    localStorage.setItem("mosaica_calibration_factor", 1);
  }

  measuredInput.value = "50.00";
  setPaperSizeFromMM();
  applyTransform();

  if (miniValue) miniValue.textContent = `${REFERENCE_MM} mm`;
  flashToast(__t("toast.calib.reset", null, "🔄 Calibrazione resettata a 1.0"));
}

updateCalibStrip();

// ============== GENERATORE UID ==============
let __objectUID = 0;
function generateUID() {
  return "obj_" + __objectUID;
}

// ============== RIFERIMENTI DOM ==============
const paper = document.getElementById("paper");
const workspace = document.getElementById("workspace");
const measuredInput = document.getElementById("realMeasuredMM");
const applyBtn = document.getElementById("applyCalib");
const resetBtn = document.getElementById("resetCalib");
const calibRect = document.getElementById("calibRect");
const calibPanel = document.getElementById("calibPanel");
const miniValue = document.getElementById("miniValue");
const zoomPanel = document.getElementById("zoomPanel");
const zoomInBtn = document.getElementById("zoomIn");
const zoomOutBtn = document.getElementById("zoomOut");
const zoomResetBtn = document.getElementById("zoomReset");
const zoomPercent = document.getElementById("zoomPercent");
const zoomMini = document.getElementById("zoomMini");
const projectControls = document.getElementById("projectControls");
const openProjectBtn = document.getElementById("openProjectBtn");
const saveProjectBtn = document.getElementById("saveProjectBtn");
const autoOpenCheckbox = document.getElementById("autoOpenCheckbox");
const historyPanel = document.getElementById("historyPanel");
const undoBtn = document.getElementById("undoBtn");
const redoBtn = document.getElementById("redoBtn");
const radial = document.getElementById("radialMenu");
const colorPopup = document.getElementById("colorPopup");
const colorInput = document.getElementById("colorInput");
const openColorBtn = document.getElementById("openColorBtn");
const quickColorsContainer = document.getElementById("quickColors");
const textureFile = document.getElementById("textureFile");
const overlay = document.getElementById("measureOverlay");
const mW = overlay?.querySelector(".measure-w");
const mH = overlay?.querySelector(".measure-h");
const textureGrid = document.getElementById("textureGrid");

// ============== CANVAS FABRIC ==============
const canvas = new fabric.Canvas("sheet", {
  backgroundColor: "#fff",
  selection: true,
  preserveObjectStacking: true,
  enableRetinaScaling: true
});

// Restituiscono le dimensioni REALI del buffer (es. 1600 invece di 800)
function getCanvasRealWidth() {
  return canvas.lowerCanvasEl ? canvas.lowerCanvasEl.width : canvas.getWidth();
}
function getCanvasRealHeight() {
  return canvas.lowerCanvasEl ? canvas.lowerCanvasEl.height : canvas.getHeight();
}

// Doppio click per creare quadrati
canvas.on("mouse:dblclick", function (opt) {
  if (opt.target || canvas.isDrawingMode) return;
  const pointer = canvas.getPointer(opt.e);
  const square = new fabric.Rect({
    left: pointer.x,
    top: pointer.y,
    width: 37.8,
    height: 37.8,
    fill: "rgba(0, 5, 255, 0.79)",
    originX: "center",
    originY: "center"
  });
  square.customId = generateUID();
  canvas.add(square);
  canvas.setActiveObject(square);
  canvas.requestRenderAll();
  positionRadial();
});

// ─────────────────────────────────────────────────────────────────
// Pulsante "Aggiungi forma" (toolbar sinistra, sotto Seleziona):
// crea un quadrato identico a quello del doppio click, posizionato
// nel centro geometrico della porzione di canvas visibile, indipen-
// dentemente dallo zoom e dalla posizione attuale del paper.
// ─────────────────────────────────────────────────────────────────
(function initAddShapeBtn() {
  const btn = document.getElementById("addShapeBtn");
  if (!btn) return;

  btn.addEventListener("click", () => {
    if (canvas.isDrawingMode) return;

    // Calcola il centro dell'area di canvas EFFETTIVAMENTE visibile
    // a schermo, scontando barre laterali, top-bar e status-bar
    // (lette dalle CSS variables → resta robusto se cambi i valori).
    const cs = getComputedStyle(document.documentElement);
    const v = (name) => parseFloat(cs.getPropertyValue(name)) || 0;
    const leftMargin = v("--leftbar-w") + v("--texturepanel-w");
    const topMargin = v("--topbar-h") + v("--bgbar-h");
    const rightMargin = v("--inspector-w");
    const bottomMargin = v("--statusbar-h");

    const screenCx = leftMargin + (window.innerWidth - leftMargin - rightMargin) / 2;
    const screenCy = topMargin + (window.innerHeight - topMargin - bottomMargin) / 2;

    // Schermo → coordinate canvas: il paper ha
    //   transform: translate(view.x, view.y) scale(view.scale)
    // con transform-origin 0,0, quindi l'inversa è banale.
    const cx = (screenCx - view.x) / view.scale;
    const cy = (screenCy - view.y) / view.scale;

    // Stessa identica forma del doppio click (Rect 37.8 px ≈ 10 mm
    // a calibrazione 1.0, fill blu translucido, originX/Y center).
    const square = new fabric.Rect({
      left: cx,
      top: cy,
      width: 37.8,
      height: 37.8,
      fill: "rgba(0, 5, 255, 0.79)",
      originX: "center",
      originY: "center"
    });
    square.customId = generateUID();
    canvas.add(square); // → object:added pusherà lo state da solo
    canvas.setActiveObject(square);
    canvas.requestRenderAll();
    positionRadial();
  });
})();

// ================= MULTI-SELEZIONE CTRL+CLICK =================
window.__suspendHistoryPush = false;

function isNonSelectableSystemObject(obj) {
  return !obj || obj.__isBackground === true || obj === backgroundImageObject || obj === paperTextureObject;
}

function getActiveSelectionObjects() {
  const active = canvas.getActiveObject();
  if (!active) return [];
  return active.type === "activeSelection" ? active.getObjects().slice() : [active];
}

function getRadialAnchorFromActive() {
  const active = canvas.getActiveObject();
  if (!active) return null;

  const rect = active.getBoundingRect(true, true);
  return {
    x: rect.left + rect.width / 2,
    y: rect.top + rect.height / 2,
    width: rect.width,
    height: rect.height,
    count: active.type === "activeSelection" ? active.getObjects().length : 1,
    multi: active.type === "activeSelection"
  };
}

function refreshRadialForSelection() {
  requestAnimationFrame(() => {
    const info = getRadialAnchorFromActive();
    if (!info) {
      if (typeof hideRadial === "function") hideRadial();
      return;
    }
    if (typeof positionRadial === "function") positionRadial();
  });
}

function toggleCtrlClickSelection(target) {
  if (isNonSelectableSystemObject(target)) return false;

  const active = canvas.getActiveObject();

  // Nessuna selezione attiva → seleziona l'oggetto
  if (!active) {
    canvas.setActiveObject(target);
    canvas.requestRenderAll();
    refreshRadialForSelection();
    return true;
  }

  // Selezione singola (non ActiveSelection)
  if (active.type !== "activeSelection") {
    if (active === target) {
      // Ctrl+click sullo stesso oggetto → deseleziona
      canvas.discardActiveObject();
      canvas.requestRenderAll();
      refreshRadialForSelection();
      return true;
    } else {
      // Ctrl+click su oggetto diverso → crea ActiveSelection
      const sel = new fabric.ActiveSelection([active, target], { canvas });
      canvas.setActiveObject(sel);
      canvas.requestRenderAll();
      refreshRadialForSelection();
      return true;
    }
  }

  // ActiveSelection esistente
  const objects = active.getObjects().slice();
  const idx = objects.indexOf(target);

  if (idx >= 0) {
    // Oggetto già selezionato → rimuovilo
    objects.splice(idx, 1);
    if (objects.length === 0) {
      canvas.discardActiveObject();
    } else if (objects.length === 1) {
      canvas.setActiveObject(objects[0]);
    } else {
      const sel = new fabric.ActiveSelection(objects, { canvas });
      canvas.setActiveObject(sel);
    }
  } else {
    // Nuovo oggetto → aggiungilo
    objects.push(target);
    const sel = new fabric.ActiveSelection(objects, { canvas });
    canvas.setActiveObject(sel);
  }

  canvas.requestRenderAll();
  refreshRadialForSelection();
  return true;
}

// USA LA MULTI-SELEZIONE NATIVA DI FABRIC.JS
// Non disabilitarla! Impostiamo correttamente i parametri:
canvas.selectionKey = "ctrlKey"; // Ctrl per multi-selezione
canvas.altSelectionKey = "shiftKey"; // Shift per altre funzioni se necessario
// NON impostare canvas.selectionKey = null !!

// ============== BORDINO PER-FORMA NELLE MULTI-SELEZIONI ==============
// updateHandlesSpacing imposta hasBorders=false / borderColor="transparent"
// su ogni forma toccata (per togliere il bordo nella selezione SINGOLA).
// Effetto collaterale: nelle ActiveSelection il bordino interno compariva
// solo sulle forme MAI selezionate singolarmente (mix casuale).
// Qui intercettiamo il rendering dei controlli della ActiveSelection e
// forziamo uno stile uniforme sui figli, indipendente dallo stato di
// ciascuna forma. Vale per lazo, CTRL+click e rettangolo (passano tutti
// da qui). Compatibile Fabric 5.1.0 → 5.3.0: la firma _renderControls
// (ctx, styleOverride, childrenOverride) è stabile in tutta la linea 5.x.
// Non tocca la selezione singola né i Group statici.
const MULTISEL_CHILD_BORDER_COLOR = "#00c8ff"; // stesso ciano delle maniglie
const MULTISEL_CHILD_BORDER_DASH = [5, 4];     // tratteggio: si distingue dai bordi delle tessere

(function patchActiveSelectionChildBorders() {
  if (!window.fabric || !fabric.ActiveSelection) return;
  const proto = fabric.ActiveSelection.prototype;
  const origRenderControls = proto._renderControls;

  proto._renderControls = function (ctx, styleOverride, childrenOverride) {
    const forcedChildren = Object.assign({}, childrenOverride, {
      hasBorders: true,
      hasControls: false, // i figli non mostrano maniglie (solo il wrapper)
      borderColor: MULTISEL_CHILD_BORDER_COLOR,
      borderDashArray: MULTISEL_CHILD_BORDER_DASH
    });
    return origRenderControls.call(this, ctx, styleOverride, forcedChildren);
  };
})();

// Gestore mouse:down per Ctrl+click — lascia che Fabric gestisca la selezione nativa,
// ma intercettiamo solo per aggiornare il menu radiale
canvas.on("mouse:down", (opt) => {
  const e = opt.e;
  if (!e) return;
  if (canvas.isDrawingMode) return;

  const target = opt.target;

  // Click normale su oggetto → assicurati che il radial si aggiorni
  if (target && !isNonSelectableSystemObject(target)) {
    // Lascia che Fabric gestisca la selezione, poi aggiorna il radial
    requestAnimationFrame(() => {
      refreshRadialForSelection();
    });
  }
});

canvas.on("selection:created", refreshRadialForSelection);
canvas.on("selection:updated", refreshRadialForSelection);
canvas.on("selection:cleared", () => {
  if (typeof hideRadial === "function") hideRadial();
});

// ============== VIEW E ZOOM ==============
let view = {
  x: (window.innerWidth - mm2px(A4_MM_W)) / 2,
  y: (window.innerHeight - mm2px(A4_MM_H)) / 2,
  scale: 1
};
let initialView = { ...view };

function applyTransform() {
  if (paper) paper.style.transform = `translate(${view.x}px,${view.y}px) scale(${view.scale})`;
  updateZoomUI();
}

// Adatta la risoluzione interna del canvas al livello di zoom corrente.
// Cambia solo quando il "quality step" è effettivamente diverso, e mai durante
// un tratto di freehand attivo (la riallocazione del backstore cancellerebbe il
// disegno in corso). Fabric ricalcola lower/upper/cache canvas internamente.
//
// DEBOUNCE (introdotto per fix zoom-jumps oltre il 300%):
// Durante un burst di rotella NON vogliamo riallocare il backstore ad ogni
// evento — gli step alti (≥3) implicano buffer da 32 MB fino a 221 MB, e ogni
// setDimensions blocca il main thread per decine/centinaia di ms. Durante quel
// blocco gli eventi wheel si accodano e vengono poi processati in sequenza,
// producendo un "salto" di zoom di oltre 200%. Differiamo la riallocazione di
// QUALITY_REFRESH_DEBOUNCE_MS dall'ULTIMA chiamata: durante il burst il foglio
// si scala via CSS transform (può apparire leggermente sgranato un istante),
// alla fine del burst il backstore si allinea in UNA volta al livello finale.
// Approccio standard usato da Photoshop, Figma, AutoCAD ecc.
const QUALITY_REFRESH_DEBOUNCE_MS = 80;
let __qualityRefreshTimer = null;

function refreshCanvasQualityForZoom(immediate = false) {
  // Filtro veloce: stesso step → niente da fare (no-op come prima)
  const targetQuality = computeQualityScale(view.scale);
  if (targetQuality === currentQualityScale) {
    // Annullo un eventuale timer pendente che mirava a uno step diverso ma
    // l'utente è poi tornato sullo step originale: niente refresh inutile.
    if (__qualityRefreshTimer) {
      clearTimeout(__qualityRefreshTimer);
      __qualityRefreshTimer = null;
    }
    return;
  }

  // Mai durante un tratto di freehand/acquerello attivo
  if (canvas._isCurrentlyDrawing) return;

  // Funzione di applicazione reale — legge view.scale al momento dell'esecuzione
  // (non al momento della schedulazione) così se l'utente continua a zoomare
  // dopo il setTimeout, il refresh punta sempre allo step più recente.
  const apply = () => {
    __qualityRefreshTimer = null;
    if (canvas._isCurrentlyDrawing) return;
    const finalQuality = computeQualityScale(view.scale);
    if (finalQuality === currentQualityScale) return;
    currentQualityScale = finalQuality;
    fabric.devicePixelRatio = finalQuality;
    // Re-imposta le dimensioni "logiche" (CSS) → Fabric ricalcola il backstore
    // applicando il nuovo devicePixelRatio. Le coordinate degli oggetti non cambiano.
    canvas.setDimensions({
      width: canvas.getWidth(),
      height: canvas.getHeight()
    });
    canvas.calcOffset();
    canvas.requestRenderAll();
  };

  // Coalescenza: ogni nuova chiamata resetta il timer, così la riallocazione
  // avviene una sola volta a fine burst.
  if (__qualityRefreshTimer) clearTimeout(__qualityRefreshTimer);
  if (immediate) {
    apply();
  } else {
    __qualityRefreshTimer = setTimeout(apply, QUALITY_REFRESH_DEBOUNCE_MS);
  }
}

function updateZoomUI() {
  if (zoomPercent) zoomPercent.textContent = Math.round(view.scale * 100) + "%";
}

// ============== ZOOM SNAPSHOT GPU OVERLAY ==============
// Sistema "Photoshop-style" per zoomate da rotella su canvas complessi
// (centinaia di forme + bg image + tratti acquerello/penna).
//
// IL PROBLEMA RISOLTO:
//   Durante un burst di rotella, OGNI tick chiamava setZoomCentered →
//   _updateActiveHandlesForZoom → canvas.requestRenderAll(). Con 100+ forme
//   + bg image pesante + decine di tratti, ogni render era 30-80ms ed il
//   main thread non riusciva a stare al passo con la rotella: la
//   conseguenza era il "salto" + il "blocco" finale alla riallocazione del
//   backstore.
//
// LA SOLUZIONE:
//   All'inizio del burst snapshot-iamo lower+upper canvas di Fabric in un
//   <canvas> figlio di wrapperEl (quindi dentro #paper). Nascondiamo i due
//   canvas Fabric. Il paper scala via CSS transform → lo snapshot scala con
//   lui (composite GPU del browser, zero costo CPU). Durante il burst NON
//   c'è alcun render Fabric. A fine burst riallochiamo il backstore alla
//   nuova fascia di qualità, rendiamo, e al frame successivo rimuoviamo lo
//   snapshot — la transizione è impercettibile.
//
// GPU: usiamo lo stesso meccanismo del compositor del browser usato da
//   freehandDrawing/watercolorStampBrush per i preview overlay (vedi
//   _ensureWatercolorPreviewOverlay): un <canvas> con will-change:transform
//   posizionato dentro wrapperEl, scalato dalla transform del padre.
//
// SOGLIA SOFT: cappiamo lo snapshot a MAX_SNAPSHOT_DIM (4096px lato lungo).
//   A zoom 800% il backstore Fabric vero arriva a 6400×9040 (≈230 MB). Lo
//   snapshot capped resta ≈30 MB e la perdita di nitidezza dura <250ms,
//   non percepibile durante un gesto rotella attivo.

const ZOOM_BURST_END_MS = 80;   // ms di silenzio rotella per chiudere il burst
const MAX_SNAPSHOT_DIM = 4096;   // lato max snapshot (cap RAM ai zoom alti)

const __zoomBurst = {
  active: false,
  endTimer: null
};

// Canvas riusato tra burst — evita allocazioni/GC ricorrenti da decine di MB
// ad ogni gesto rotella. Lo creiamo lazy alla prima cattura.
let __zoomSnapshotEl = null;

function _captureZoomSnapshot() {
  // Mai sovrapporsi a un tratto attivo: durante un freehand/acquerello in
  // corso lo snapshot nasconderebbe il tratto vivo e impedirebbe il preview.
  if (canvas._isCurrentlyDrawing) return;
  if (!canvas?.lowerCanvasEl || !canvas.wrapperEl) return;

  const lower = canvas.lowerCanvasEl;
  const upper = canvas.upperCanvasEl; // selezione + maniglie + cursore
  const wrapper = canvas.wrapperEl;

  // CSS size: stessa dei canvas Fabric → sovrapposizione 1:1 sotto la transform di #paper.
  const cssW = canvas.getWidth();
  const cssH = canvas.getHeight();
  // Backstore reale di Fabric (può essere fino a 8× la CSS size con quality scale 8).
  const realW = lower.width;
  const realH = lower.height;

  // Cap dimensioni per non riservare RAM eccessiva agli zoom alti.
  const fit = Math.min(1, MAX_SNAPSHOT_DIM / Math.max(realW, realH));
  const snapW = Math.max(1, Math.round(realW * fit));
  const snapH = Math.max(1, Math.round(realH * fit));

  // Riusa l'elemento canvas tra burst: cambiare width/height fa già clearRect.
  let snap = __zoomSnapshotEl;
  if (!snap) {
    snap = __zoomSnapshotEl = document.createElement("canvas");
  }
  let needsClear = false;
  if (snap.width !== snapW) { snap.width = snapW; needsClear = false; }
  else needsClear = true;
  if (snap.height !== snapH) { snap.height = snapH; needsClear = false; }

  // Stile: stesse coordinate dei canvas Fabric → si sovrappone esattamente.
  // z-index 998: sotto il preview acquerello (999) per coerenza, sopra tutto il resto.
  snap.style.cssText =
    "position:absolute;left:0;top:0;" +
    "width:" + cssW + "px;height:" + cssH + "px;" +
    "pointer-events:none;z-index:998;" +
    "will-change:transform;image-rendering:auto;";

  const ctx = snap.getContext("2d");
  if (needsClear) ctx.clearRect(0, 0, snapW, snapH);

  // Composito lower (contenuti) + upper (maniglie/selezione). Try sull'upper
  // perché in alcuni stati Fabric può non averlo (es. canvas appena creato).
  ctx.drawImage(lower, 0, 0, snapW, snapH);
  if (upper) {
    try { ctx.drawImage(upper, 0, 0, snapW, snapH); } catch (_) {}
  }

  // Nascondo i canvas Fabric — l'utente vede SOLO lo snapshot da qui in poi.
  lower.style.visibility = "hidden";
  if (upper) upper.style.visibility = "hidden";

  // Aggancio dentro wrapperEl (che è figlio di #paper) → eredita la transform
  // CSS del paper → scala con esso via composite GPU.
  wrapper.appendChild(snap);
}

function _removeZoomSnapshot() {
  // Ripristino sempre la visibilità dei canvas Fabric, anche se lo snapshot
  // non c'è più (defensive: previene canvas invisibili in caso di chiamate
  // sbilanciate enter/exit).
  if (canvas.lowerCanvasEl) canvas.lowerCanvasEl.style.visibility = "";
  if (canvas.upperCanvasEl) canvas.upperCanvasEl.style.visibility = "";

  const snap = __zoomSnapshotEl;
  if (!snap || !snap.parentNode) return;
  try { snap.parentNode.removeChild(snap); } catch (_) {}
}

function _enterZoomBurst() {
  if (__zoomBurst.active) return;
  if (canvas._isCurrentlyDrawing) return; // fallback: niente snapshot durante un tratto
  __zoomBurst.active = true;
  _captureZoomSnapshot();
}

function _exitZoomBurst() {
  if (!__zoomBurst.active) return;
  __zoomBurst.active = false;
  __zoomBurst.endTimer = null;

  // Tutto il lavoro pesante (riallocazione backstore + render + handles) in
  // UN solo frame, poi rimozione snapshot al frame successivo: garantisce
  // che Fabric abbia già disegnato il nuovo contenuto HD prima dello "swap".
  requestAnimationFrame(() => {
    // 1. Riallocazione backstore alla fascia di qualità finale (sincrono).
    refreshCanvasQualityForZoom(true);

    // 2. Aggiorna maniglie + ricalcolo coords (no-op se nessuna selezione).
    if (typeof _updateActiveHandlesForZoom === "function") {
      _updateActiveHandlesForZoom();
    }

    // 3. Render sincrono: forza Fabric a disegnare TUTTO nel nuovo backstore
    //    prima che lo snapshot venga rimosso al frame seguente.
    canvas.renderAll();

    // 4. Riposiziona radial menu (DOM op, non dipende dal render Fabric).
    if (typeof positionRadial === "function") positionRadial();

    // 5. Rimuovi lo snapshot al frame successivo, quando Fabric ha già 
    //    composto il suo backstore — l'utente vede uno "swap" pulito.
    requestAnimationFrame(_removeZoomSnapshot);
  });
}

// Estende (o crea) il timer di chiusura del burst. Va chiamato a ogni 
// evento rotella: il burst si chiude solo dopo ZOOM_BURST_END_MS di silenzio.
function _bumpZoomBurstEndTimer() {
  if (__zoomBurst.endTimer) clearTimeout(__zoomBurst.endTimer);
  __zoomBurst.endTimer = setTimeout(_exitZoomBurst, ZOOM_BURST_END_MS);
}

function setZoomCentered(newScale, clientX, clientY) {
  clientX = clientX ?? window.innerWidth / 2;
  clientY = clientY ?? window.innerHeight / 2;

  // ── GUARDIA "scala invariata" ───────────────────────────────────────────
  // Se la nuova scala, dopo il clamp 40%–800%, coincide con quella attuale
  // (tipico ai limiti del range), non c'è nulla da fare: niente applyTransform,
  // niente refresh/render a vuoto.
  // Con scala identica anche la ri-centratura restituirebbe gli stessi view.x/y.
  const clamped = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, newScale));
  if (clamped === view.scale) return;

  // Coordinate del punto sotto il mouse nello spazio NON trasformato del paper.
  // Il paper è a (0,0) con transform-origin 0,0, quindi view.x/view.y sono già
  // la posizione del paper sullo schermo: NON serve passare per getBoundingClientRect.
  const paperX = (clientX - view.x) / view.scale;
  const paperY = (clientY - view.y) / view.scale;

  // Applica la nuova scala (clamp già calcolato sopra)
  view.scale = clamped;

  // Riposiziona il paper in modo che (paperX, paperY) finisca esattamente
  // sotto (clientX, clientY) anche dopo lo zoom.
  view.x = clientX - paperX * view.scale;
  view.y = clientY - paperY * view.scale;

  applyTransform();

  // ── ZOOM BURST: SOLO CSS, ZERO LAVORO FABRIC ────────────────────────────
  // Durante un burst di rotella lo snapshot GPU è attivo dentro #paper e
  // scala con la transform CSS del paper stesso (composite del browser).
  // Saltiamo TUTTO il lavoro Fabric-side (refresh quality, render, handles,
  // radial): non viene visto perché i canvas Fabric sono nascosti, e ogni
  // operazione qui sarebbe pura CPU sprecata che inchioda il main thread
  // impedendo alla rotella di stare al passo.
  //
  // A fine burst _exitZoomBurst esegue UNA volta sola tutto il lavoro pesante,
  // in ordine: setDimensions → updateHandles → renderAll → positionRadial → swap.
  if (__zoomBurst.active) return;

  // Percorso normale: zoom da pulsante, scorciatoia tastiera, o singola tacca
  // di rotella senza burst.
  refreshCanvasQualityForZoom();
  if (selectedObj) {
    _updateActiveHandlesForZoom(); // fa già requestRenderAll()
    positionRadial();
  } else {
    canvas.requestRenderAll();
  }
}

// Helper: ricalcola spaziatura/dimensione maniglie per l'oggetto attivo (anche
// in caso di multi-selezione) e forza un re-render del canvas.
function _updateActiveHandlesForZoom() {
  const active = canvas.getActiveObject();
  if (!active) return;
  if (active._objects && Array.isArray(active._objects)) {
    // Stesso pattern già adottato nei listener selection:created/updated:
    // le maniglie visibili durante una activeSelection sono quelle DEL
    // WRAPPER, non dei singoli figli. Fare updateHandlesSpacing su tutti
    // i figli ad ogni rotella zoom costa N×(getBoundingRect + setCoords)
    // per nulla — con 100+ forme selezionate e zoom continuo era un
    // bottleneck rimasto fuori dalla Modifica 4 di stamattina.
    //
    // Per i figli garantiamo solo che abbiano il preset di base — costo O(1)
    // per oggetto — così quando l'utente scioglierà la selezione e selezionerà
    // un singolo figlio, updateHandlesSpacing avrà già __desiredCornerScreen
    // e __paddingScreenRatio settati correttamente.
    updateHandlesSpacing(active);
    active._objects.forEach((o) => {
      if (typeof o.__desiredCornerScreen === "undefined" && typeof applyHandlePreset === "function") {
        applyHandlePreset(o);
      }
    });
  } else {
    updateHandlesSpacing(active);
  }
  canvas.requestRenderAll();
}

function zoomByFactor(factor, clientX, clientY) {
  setZoomCentered(view.scale * factor, clientX, clientY);
}

function resetZoomAndPan() {
  initialView = {
    x: (window.innerWidth - mm2px(A4_MM_W)) / 2,
    y: (window.innerHeight - mm2px(A4_MM_H)) / 2,
    scale: 1
  };
  view = { ...initialView };
  applyTransform();

  // ── FIX culling ───────────────────────────────────────────────────────
  // applyTransform() cambia SOLO la CSS transform del #paper: NON forza un
  // render di Fabric. Siccome il culling ricalcola la finestra visibile
  // (calcViewportBoundaries) unicamente durante un render, senza questo le
  // forme cullate mentre eri zoomato/pannato restano "saltate" anche dopo il
  // reset e riappaiono solo al primo giro di rotella. Allineiamo il backstore
  // alla nuova scala (immediate=true) e forziamo un render completo.
  refreshCanvasQualityForZoom(true);
  if (selectedObj) {
    _updateActiveHandlesForZoom(); // ricalcola maniglie + fa già requestRenderAll()
    positionRadial();
  }
  canvas.requestRenderAll();
}

// ============================================================
//  CULLING FUORI-VISTA (screen-aware) — Mosaica Workspace Pro
//  ------------------------------------------------------------
//  In Mosaica lo zoom è una CSS transform sul #paper, quindi il
//  viewportTransform di Fabric resta SEMPRE l'identità e Fabric "vede"
//  tutto il foglio A4 come fosse a schermo. Il suo skipOffscreen nativo
//  (già attivo) salta solo le forme fuori dal FOGLIO, mai quelle fuori
//  dallo SCHERMO: così allo zoom alto col foglio pannato ridisegna
//  comunque tutte le forme (anche 2000+) nel backstore enorme.
//
//  Qui sovrascriviamo — SOLO su questa istanza — il calcolo dei confini
//  del viewport, facendogli restituire il rettangolo VISIBILE in
//  coordinate-foglio. Da lì la macchina skipOffscreen già presente in
//  Fabric salta da sola tracciamento+riempimento delle forme col
//  bounding-box interamente fuori vista. Nessun tocco al render loop e
//  nessun impatto su selezione/hit-testing (non usano vptCoords).
//
//  "Solo quando serve": se il foglio sta tutto nello schermo → nativo.
//  Export sicuro: toDataURL passa per toCanvasElement, che avvolgiamo
//  per disattivare il culling → l'export è sempre il foglio intero.
//  Compatibile Fabric 5.1.0 → 5.3.0.
// ============================================================
(function installOffscreenCulling() {
  if (!canvas || typeof fabric === "undefined" || canvas.__cullingInstalled) return;
  canvas.__cullingInstalled = true;

  // Config tarabile a runtime da console: window.__mosaicaCulling.*
  const CULL = (window.__mosaicaCulling = window.__mosaicaCulling || {
    enabled: true,      // kill-switch globale
    marginRatio: 0.10,  // margine anti pop-in: 10% della finestra visibile per lato
    minScale: 1.0       // sotto questo zoom non si culla mai
  });

  const _origCalcVPB = fabric.Canvas.prototype.calcViewportBoundaries;

  function _vptIsIdentity(v) {
    return v && v[0] === 1 && v[1] === 0 && v[2] === 0 &&
           v[3] === 1 && v[4] === 0 && v[5] === 0;
  }

  canvas.calcViewportBoundaries = function () {
    // Nativo (foglio intero) in tutti i casi non-interattivi.
    if (
      !CULL.enabled ||
      this.__cullOff ||
      typeof view === "undefined" || !view ||
      !workspace ||
      !_vptIsIdentity(this.viewportTransform)
    ) {
      return _origCalcVPB.call(this);
    }

    const scale = view.scale || 1;
    if (scale < CULL.minScale) return _origCalcVPB.call(this);

    const ws = workspace.getBoundingClientRect();
    if (ws.width <= 1 || ws.height <= 1) return _origCalcVPB.call(this);

    const W = this.width;   // larghezza LOGICA del foglio (page px)
    const H = this.height;  // altezza  LOGICA del foglio (page px)

    // Se il foglio ci sta tutto → niente culling.
    if (W * scale <= ws.width + 1 && H * scale <= ws.height + 1) {
      return _origCalcVPB.call(this);
    }

    // Finestra visibile (client px) → coordinate-foglio.
    // Stessa mappatura dello zoom: page = (client - view.x) / scale.
    let x0 = (ws.left   - view.x) / scale;
    let y0 = (ws.top    - view.y) / scale;
    let x1 = (ws.right  - view.x) / scale;
    let y1 = (ws.bottom - view.y) / scale;

    const mx = (x1 - x0) * CULL.marginRatio;
    const my = (y1 - y0) * CULL.marginRatio;
    x0 -= mx; x1 += mx; y0 -= my; y1 += my;

    if (x0 < 0) x0 = 0;
    if (y0 < 0) y0 = 0;
    if (x1 > W) x1 = W;
    if (y1 > H) y1 = H;

    const P = fabric.Point;
    const pts = { tl: new P(x0, y0), tr: new P(x1, y0), bl: new P(x0, y1), br: new P(x1, y1) };
    this.vptCoords = pts;
    return pts;
  };

  // EXPORT: ogni toDataURL del canvas principale passa di qui → culling off.
  const _origToCanvasEl = canvas.toCanvasElement;
  if (typeof _origToCanvasEl === "function") {
    canvas.toCanvasElement = function () {
      const prev = this.__cullOff;
      this.__cullOff = true;
      try {
        return _origToCanvasEl.apply(this, arguments);
      } finally {
        this.__cullOff = prev;
      }
    };
  }
})();

// ============================================================
//  INDICE SPAZIALE (GRIGLIA) PER IL CULLING — Mosaica Workspace Pro
//  ------------------------------------------------------------
//  Complemento del culling viewport (installOffscreenCulling sopra).
//  Quel blocco fa restituire a Fabric il rettangolo VISIBILE, e lo
//  skipOffscreen nativo salta il DISEGNO delle forme fuori vista — ma
//  per deciderlo Fabric chiama isOnScreen() su OGNI oggetto, ogni frame:
//  O(N) anche durante un semplice pan. Qui aggiungiamo un hash-grid degli
//  AABB delle forme (in coordinate-foglio, identiche a vptCoords perché il
//  viewportTransform è l'identità) e sovrascriviamo SOLO _renderObjects di
//  QUESTA istanza per disegnare unicamente gli oggetti delle celle visibili.
//
//  Non tocca selezione, hit-testing né export (passano da altre vie;
//  l'export ha già __cullOff → percorso nativo = disegna tutto).
//  L'ordine-z è preservato: iteriamo l'array ordinato che Fabric ci passa.
//  Compatibile Fabric 5.1.0 → 5.3.0.
// ============================================================
(function installSpatialIndexCulling() {
  if (!canvas || typeof fabric === "undefined" || canvas.__spatialIndexInstalled) return;
  if (typeof canvas._renderObjects !== "function") return; // guardia di compatibilità
  canvas.__spatialIndexInstalled = true;

  const CULL = (window.__mosaicaCulling = window.__mosaicaCulling || { enabled: true, marginRatio: 0.10, minScale: 1.0 });

  const GRID = (window.__mosaicaGrid = {
    enabled: true,        // kill-switch
    minObjects: 300,      // sotto questa soglia la griglia non conviene → nativo
    cellSize: 256,        // lato cella in px-foglio (ricalcolato a ogni rebuild)
    _cells: new Map(),    // "cx,cy" -> Set(obj)
    _objCells: new Map(), // obj -> [cellKeys] | null (se "sempre visibile")
    _alwaysRender: new Set(),
    _dirty: true,
    _indexedCount: -1,
    stats: { lastVisible: 0, lastTotal: 0 },
    invalidate() { this._dirty = true; }
  });

  const MAX_CELLS_PER_OBJ = 600; // oltre → oggetto "sempre visibile" (sfondo, tratti enormi)

  function _vptIsIdentity(v) {
    return v && v[0] === 1 && v[1] === 0 && v[2] === 0 && v[3] === 1 && v[4] === 0 && v[5] === 0;
  }

  // Stesso gating del culling viewport: se non culliamo, percorso nativo.
  function gridShouldCull(c) {
    if (GRID.enabled === false || CULL.enabled === false || c.__cullOff) return false;
    if (typeof view === "undefined" || !view || !workspace) return false;
    if (!_vptIsIdentity(c.viewportTransform)) return false;
    const scale = view.scale || 1;
    if (scale < (CULL.minScale || 1)) return false;
    const ws = workspace.getBoundingClientRect();
    if (ws.width <= 1 || ws.height <= 1) return false;
    const W = c.width, H = c.height;
    if (W * scale <= ws.width + 1 && H * scale <= ws.height + 1) return false; // foglio intero visibile
    if ((c._objects || []).length < GRID.minObjects) return false;             // troppo pochi oggetti
    return true;
  }

  function aabbOf(o) {
    try {
      const r = o.getBoundingRect(true, true); // absolute=true, calculate=true → coord-foglio, no vpt
      return { l: r.left, t: r.top, r: r.left + r.width, b: r.top + r.height };
    } catch (e) { return null; }
  }

  function chooseCellSize() {
    // Canvas principale = sempre A4 (~794×1123 px-foglio a 96 PPI), tessere
    // piccole (3–13 mm → ~11–49 px). Una cella ≈ 1/8 del lato minore del
    // foglio (A4 → ~99–110 px) tiene una manciata di tessere e mantiene basso
    // il numero di celle (~8×11 ≈ 88 su A4). La formula resta adattiva: quando
    // renderai il canvas ridimensionabile per i mosaici grandi, la cella cresce
    // col foglio. Limitata in [96, 512] per non degenerare ai due estremi.
    const minSide = Math.min(canvas.width || 794, canvas.height || 1123);
    return Math.min(512, Math.max(96, Math.round(minSide / 8)));
  }

  function insert(o) {
    const a = aabbOf(o);
    if (!a) { GRID._alwaysRender.add(o); GRID._objCells.set(o, null); return; }

    // Oggetti che coprono ≥60% del foglio (sfondo immagine, texture carta,
    // tratti acquerello enormi) → "sempre visibili": inutile e controproducente
    // bucketizzarli su tutte le celle.
    const sheetArea = (canvas.width || 1) * (canvas.height || 1);
    const objArea = Math.max(0, a.r - a.l) * Math.max(0, a.b - a.t);
    if (sheetArea > 0 && objArea >= sheetArea * 0.6) {
      GRID._alwaysRender.add(o); GRID._objCells.set(o, null); return;
    }

    const cs = GRID.cellSize;
    const cx0 = Math.floor(a.l / cs), cy0 = Math.floor(a.t / cs);
    const cx1 = Math.floor(a.r / cs), cy1 = Math.floor(a.b / cs);
    if ((cx1 - cx0 + 1) * (cy1 - cy0 + 1) > MAX_CELLS_PER_OBJ) {
      GRID._alwaysRender.add(o); GRID._objCells.set(o, null); return;
    }
    const keys = [];
    for (let cx = cx0; cx <= cx1; cx++) for (let cy = cy0; cy <= cy1; cy++) {
      const k = cx + "," + cy;
      let s = GRID._cells.get(k);
      if (!s) { s = new Set(); GRID._cells.set(k, s); }
      s.add(o); keys.push(k);
    }
    GRID._objCells.set(o, keys);
  }

  function remove(o) {
    const keys = GRID._objCells.get(o);
    GRID._objCells.delete(o);
    GRID._alwaysRender.delete(o);
    if (!keys) return;
    for (const k of keys) {
      const s = GRID._cells.get(k);
      if (s) { s.delete(o); if (s.size === 0) GRID._cells.delete(k); }
    }
  }

  function rebuild() {
    GRID._cells.clear(); GRID._objCells.clear(); GRID._alwaysRender = new Set();
    const objs = canvas._objects || [];
    GRID.cellSize = chooseCellSize(objs);
    for (let i = 0; i < objs.length; i++) insert(objs[i]);
    GRID._dirty = false;
    GRID._indexedCount = objs.length;
  }

  function queryVisible(vpt) {
    const cs = GRID.cellSize;
    const minX = Math.min(vpt.tl.x, vpt.tr.x, vpt.bl.x, vpt.br.x);
    const minY = Math.min(vpt.tl.y, vpt.tr.y, vpt.bl.y, vpt.br.y);
    const maxX = Math.max(vpt.tl.x, vpt.tr.x, vpt.bl.x, vpt.br.x);
    const maxY = Math.max(vpt.tl.y, vpt.tr.y, vpt.bl.y, vpt.br.y);
    const cx0 = Math.floor(minX / cs), cy0 = Math.floor(minY / cs);
    const cx1 = Math.floor(maxX / cs), cy1 = Math.floor(maxY / cs);
    const out = new Set(GRID._alwaysRender);
    for (let cx = cx0; cx <= cx1; cx++) for (let cy = cy0; cy <= cy1; cy++) {
      const s = GRID._cells.get(cx + "," + cy);
      if (s) for (const o of s) out.add(o);
    }
    return out;
  }

  // --- Override del SOLO _renderObjects di questa istanza ---
  const _origRenderObjects = canvas._renderObjects.bind(canvas);
  canvas._renderObjects = function (ctx, objects) {
    if (!gridShouldCull(this)) return _origRenderObjects(ctx, objects);

    // auto-heal: conteggio cambiato fuori dai nostri hook (load, clear, ...) → rebuild
    if (GRID._dirty || (canvas._objects && canvas._objects.length !== GRID._indexedCount)) rebuild();

    const vpt = this.vptCoords;
    if (!vpt || !vpt.tl) return _origRenderObjects(ctx, objects); // sicurezza

    const visible = queryVisible(vpt);
    const active = this._activeObject || null;
    let shown = 0;
    for (let i = 0, len = objects.length; i < len; i++) {
      const o = objects[i];
      if (!o) continue;
      // o.group → in selezione/gruppo (mai cullato, come fa Fabric con !this.group);
      // o === active → oggetto attivo; visible.has(o) → dentro le celle visibili.
      if (o.group || o === active || visible.has(o)) { o.render(ctx); shown++; }
    }
    GRID.stats.lastVisible = shown;
    GRID.stats.lastTotal = objects.length;
  };

  // --- Manutenzione incrementale dell'indice ---
  function safeInsert(o) { try { insert(o); GRID._indexedCount = (canvas._objects || []).length; } catch (e) { GRID._dirty = true; } }
  function safeRemove(o) { try { remove(o); GRID._indexedCount = (canvas._objects || []).length; } catch (e) { GRID._dirty = true; } }
  function safeUpdate(o) {
    try {
      if (o && o._objects && Array.isArray(o._objects)) o._objects.forEach((ch) => { remove(ch); insert(ch); });
      else { remove(o); insert(o); }
    } catch (e) { GRID._dirty = true; }
  }

  canvas.on("object:added",   (e) => { if (e && e.target) safeInsert(e.target); });
  canvas.on("object:removed", (e) => { if (e && e.target) safeRemove(e.target); });
  canvas.on("object:modified",(e) => { if (e && e.target) safeUpdate(e.target); });
  // Quando una selezione si chiude/cambia, Fabric "cuoce" le coord dei figli:
  // un rebuild una-tantum (operazione a ritmo umano, non per-frame) è sicuro.
  canvas.on("selection:cleared", () => { GRID._dirty = true; });
  canvas.on("selection:updated", () => { GRID._dirty = true; });

  // Primo popolamento al prossimo render.
  GRID._dirty = true;
})();

// Zoom con rotella — modello "Photoshop-like" con sensibilità adattiva alla velocità.
// =============================================================================
// IDEA: il moltiplicatore del fattore zoom dipende da QUANTO VELOCE l'utente
// sta girando la rotella, non dal livello di zoom corrente.
//
//   • Rotella lenta (scatti distanti)   → moltiplicatore < 1: zoom preciso e dolce.
//   • Rotella a velocità "normale"      → moltiplicatore ≈ 1: zoom standard.
//   • Rotella molto veloce (burst)      → moltiplicatore satura a ~1.8: copre
//                                          distanza ma non esplode mai.
//
// La velocità è misurata in "intensità rotella" (somma dei |deltaY| nell'ultimo
// secondo, normalizzata) ed è filtrata con un EMA (Exponential Moving Average)
// per evitare che il moltiplicatore sia nervoso a ogni singolo evento.
//
// La curva di mapping intensità → moltiplicatore è: 1 - e^(-(x/τ)²), saturante.
// Questa è la forma giusta della "e elevato a x quadro": cresce veloce all'inizio
// quando l'utente accelera, poi si appiattisce verso un tetto — esattamente il
// comportamento desiderato (più vai veloce, più zoom, MA con tetto di sicurezza).
//
// PROTEZIONI A TUTTI I LIVELLI:
//   1) Coalescenza rAF: max una setZoomCentered per frame (60 Hz).
//   2) WHEEL_DELTA_CAP: cap del singolo evento contro spike del driver/SO.
//   3) PER_FRAME_FACTOR_CAP: tetto assoluto al fattore per frame (+20% max),
//      guardia ultima anche se la curva e l'EMA fallissero.
//   4) Debounce di refreshCanvasQualityForZoom (180ms): il backstore di Fabric
//      viene riallocato UNA volta sola a fine burst, mai durante.

// === Parametri della sensibilità adattiva (RICALIBRATI) ===
const ZOOM_BASE_SENSITIVITY = 0.001;     // sensibilità "neutra" a velocità media
const ZOOM_SPEED_MIN_MULT = 0.7;         // moltiplicatore minimo (rotella lenta → preciso)
const ZOOM_SPEED_MAX_MULT = 1.8;         // moltiplicatore massimo (saturazione → veloce)
const ZOOM_SPEED_TAU = 140;              // CALIBRAZIONE CHIAVE: l'EMD può arrivare a ~240
                                         // (|dy|≤120, dt≥8ms → 120*2). Con τ=140 la curva
                                         // copre DAVVERO tutto il range del moltiplicatore;
                                         // con il vecchio 800 il "veloce" non scattava mai.
const ZOOM_EMA_ALPHA = 0.25;             // reattività dell'EMA (invariato)
const ZOOM_SPEED_DECAY_MS = 250;         // reset EMA dopo pausa (invariato)

// === Cap di sicurezza ===
const WHEEL_DELTA_CAP = 120;             // cap del singolo evento (driver/SO) — invariato
const PER_FRAME_FACTOR_CAP_UP = 1.6;     // era 1.20 e MANGIAVA l'input veloce (causa del
                                         // "blocco"): 3-4 tacche/frame collassavano a +20%.
                                         // Ogni evento è già cappato da WHEEL_DELTA_CAP e
                                         // l'EMA limita la curva, quindi 1.6 (+60%/frame) è
                                         // sicuro: per superarlo servirebbero 5+ tacche in
                                         // 16 ms, fisicamente impossibile a mano.
const PER_FRAME_FACTOR_CAP_DOWN = 1 / PER_FRAME_FACTOR_CAP_UP;

// === Stato della rotella ===
let __wheelAccumDeltaY = 0;
let __wheelLastClientX = 0;
let __wheelLastClientY = 0;
let __wheelRAFScheduled = false;
let __wheelSpeedEMA = 0;                 // media filtrata dell'intensità
let __wheelLastEventT = 0;               // timestamp ultimo evento (per decay)

// Curva 1 - e^(-(x/τ)²) mappata su [MIN_MULT .. MAX_MULT]
function _wheelSpeedMultiplier(speedEma) {
  const x = speedEma / ZOOM_SPEED_TAU;
  const saturating = 1 - Math.exp(-(x * x));   // [0..1), satura a 1
  return ZOOM_SPEED_MIN_MULT + (ZOOM_SPEED_MAX_MULT - ZOOM_SPEED_MIN_MULT) * saturating;
}

// Converte un delta accumulato (acc) + la sensibilità efficace in un fattore di
// zoom per-frame, con SATURAZIONE MORBIDA invece del vecchio clamp netto.
// L'esponente viene "ammorbidito" con tanh: cresce con la velocità ma si avvicina
// dolcemente al tetto (ln del vecchio cap) senza mai sbatterci contro di colpo.
// Resta comunque dentro [1/CAP_UP .. CAP_UP] perché tanh è limitato.
function _zoomFactorFromDelta(acc, effectiveSensitivity) {
  const rawExp = -acc * effectiveSensitivity;
  const maxExp = Math.log(PER_FRAME_FACTOR_CAP_UP); // asintoto = vecchio cap (≈0.47)
  const softExp = maxExp * Math.tanh(rawExp / maxExp);
  return Math.exp(softExp);
}

workspace.addEventListener(
  "wheel",
  (e) => {
    e.preventDefault();

    const now = performance.now();
    const dt = now - __wheelLastEventT;
    __wheelLastEventT = now;

    // Reset EMA dopo una pausa: un nuovo gesto riparte "pulito"
    if (dt > ZOOM_SPEED_DECAY_MS) {
      __wheelSpeedEMA = 0;
    }

    // Cap del singolo evento e accumulo
    const dy = Math.max(-WHEEL_DELTA_CAP, Math.min(WHEEL_DELTA_CAP, e.deltaY));
    __wheelAccumDeltaY += dy;
    __wheelLastClientX = e.clientX;
    __wheelLastClientY = e.clientY;

    // EMA dell'intensità: peso |dy| con la frequenza istantanea. Cappo dt a 100ms.
    const dtClamped = Math.max(8, Math.min(100, dt || 16));
    const instantSpeed = Math.abs(dy) * (16 / dtClamped);
    __wheelSpeedEMA = ZOOM_EMA_ALPHA * instantSpeed + (1 - ZOOM_EMA_ALPHA) * __wheelSpeedEMA;

    // ── ZOOM SNAPSHOT BURST ───────────────────────────────────────────────
    // _enterZoomBurst va chiamato QUI (non nel rAF): lo snapshot deve riflettere
    // lo stato visivo PRIMA del primo applyTransform.
    _enterZoomBurst();
    _bumpZoomBurstEndTimer();

    if (!__wheelRAFScheduled) {
      __wheelRAFScheduled = true;
      requestAnimationFrame(() => {
        __wheelRAFScheduled = false;
        const acc = __wheelAccumDeltaY;
        __wheelAccumDeltaY = 0;
        if (acc === 0) return;

        const speedMult = _wheelSpeedMultiplier(__wheelSpeedEMA);
        const effectiveSensitivity = ZOOM_BASE_SENSITIVITY * speedMult;

        // Fattore con saturazione morbida (niente più clamp netto)
        const f = _zoomFactorFromDelta(acc, effectiveSensitivity);

        setZoomCentered(view.scale * f, __wheelLastClientX, __wheelLastClientY);
      });
    }
  },
  { passive: false }
);

// Pulsanti zoom
if (zoomInBtn)
  zoomInBtn.addEventListener("click", () => zoomByFactor(1.2, window.innerWidth / 2, window.innerHeight / 2));
if (zoomOutBtn)
  zoomOutBtn.addEventListener("click", () => zoomByFactor(1 / 1.2, window.innerWidth / 2, window.innerHeight / 2));
if (zoomResetBtn) zoomResetBtn.addEventListener("click", resetZoomAndPan);

// ============== PAN + ALT PER DISABILITARE DISEGNO ==============
let panning = false;
let last = { x: 0, y: 0 };
let wasDrawingMode = false;
let isAltPanning = false;
let altPressed = false;

// Alt globale (keydown prima del mouse → disabilita subito il disegno)
document.addEventListener("keydown", (e) => {
  if (e.key === "Alt") {
    altPressed = true;
    if (canvas.isDrawingMode) {
      wasDrawingMode = true;
      canvas.isDrawingMode = false;
      isAltPanning = true;
    }
  }
});
document.addEventListener("keyup", (e) => {
  if (e.key === "Alt") {
    altPressed = false;
    if (wasDrawingMode) {
      canvas.isDrawingMode = true;
      wasDrawingMode = false;
      isAltPanning = false;
    }
  }
});

workspace.addEventListener("mousedown", (e) => {
  if (e.button !== 0) return;

  if (
    e.target.closest &&
    (e.target.closest("#calibPanel") ||
      e.target.closest(".radial-btn") ||
      e.target.closest("#measureOverlay") ||
      e.target.closest("#colorPopup") ||
      e.target.closest("#zoomPanel") ||
      e.target.closest("#historyPanel"))
  )
    return;

  // ALT + drag → pan (disabilita disegno)
  if (altPressed && canvas.isDrawingMode) {
    isAltPanning = true;
    wasDrawingMode = true;
    canvas.isDrawingMode = false;
    window.isAltPanning = true; // ← flag globale visibile al brush
  }

  if (e.target.tagName === "CANVAS" && !altPressed) return;

  panning = true;
  last.x = e.clientX;
  last.y = e.clientY;
});

// ── FIX PAN: intercetta Alt+click sul canvas PRIMA di Fabric (fase capture) ──
// Senza questo blocco il mousedown arriva anche a Fabric, che:
//   1. deseleziona la selezione attiva se il click cade su area vuota, oppure
//   2. seleziona la forma sotto il mouse e la trascina insieme al pan
//      (con tante forme e zoom alto è praticamente inevitabile beccarne una).
// stopPropagation() in fase capture impedisce a Fabric di vedere l'evento:
// il pan diventa "puro", la selezione corrente resta intatta e nessuna
// forma viene agganciata o spostata. Alt+drag sul canvas è quindi
// ESCLUSIVAMENTE pan, come da comportamento documentato di Mosaica.
workspace.addEventListener(
  "mousedown",
  (e) => {
    if (e.button !== 0) return;
    if (!(e.altKey || altPressed)) return;
    if (!e.target || e.target.tagName !== "CANVAS") return;

    // Fabric non deve ricevere questo mousedown
    e.preventDefault();
    e.stopPropagation();

    // Se eravamo in modalità disegno (penna/acquerello/gomma), sospendila
    // esattamente come fa il listener classico del pan.
    if (canvas.isDrawingMode) {
      wasDrawingMode = true;
      canvas.isDrawingMode = false;
    }
    isAltPanning = true;
    window.isAltPanning = true; // flag visibile ai brush (penna/acquerello)

    panning = true;
    last.x = e.clientX;
    last.y = e.clientY;
  },
  { capture: true, passive: false }
);

window.addEventListener("mouseup", () => {
  const wasPanning = panning;
  panning = false;
  if (wasDrawingMode) {
    canvas.isDrawingMode = true;
    wasDrawingMode = false;
  }
  isAltPanning = false;
  window.isAltPanning = false; // ← reset flag

  // Render finale dopo un pan: garantisce che le forme rientrate in vista durante
  // il trascinamento siano disegnate nitide all'ultima posizione del foglio.
  if (wasPanning) canvas.requestRenderAll();
});

// Pan con RAF batching: gli accumulatori _panDx/_panDy collezionano i delta
// di tutti i mousemove arrivati nel frame; un solo applyTransform viene
// eseguito per frame al prossimo RAF. Su monitor 120Hz+ evita 60-80 reflow
// CSS in eccesso al secondo durante un pan veloce.
let _panRAF = null;
let _panDx = 0;
let _panDy = 0;
let _panLastRenderT = 0;
const PAN_RENDER_THROTTLE_MS = 90; // ridisegna le forme rientrate in vista durante
                                   // il pan, max ~11×/sec (no render a ogni frame)

window.addEventListener("mousemove", (e) => {
  if (!panning) return;
  _panDx += e.clientX - last.x;
  _panDy += e.clientY - last.y;
  last.x = e.clientX;
  last.y = e.clientY;
  if (_panRAF) return; // un RAF già schedulato — i delta si accumulano lì
  _panRAF = requestAnimationFrame(() => {
    _panRAF = null;
    view.x += _panDx;
    view.y += _panDy;
    _panDx = 0;
    _panDy = 0;
    applyTransform();

    // Il culling salta le forme fuori dallo SCHERMO, ma il rettangolo visibile
    // si sposta col pan → quelle che rientrano vanno ridisegnate. applyTransform()
    // è solo CSS e non rende, quindi senza questo restano vuote. Throttle a tempo
    // per non fare un render completo a ogni frame durante un pan veloce.
    const now = performance.now();
    if (now - _panLastRenderT >= PAN_RENDER_THROTTLE_MS) {
      _panLastRenderT = now;
      canvas.requestRenderAll();
    }
  });
});

// ============== UNDO/REDO (PROTEZIONE TEXTURE CARTA) ==============
const UNDO_LIMIT = 50;
let undoStack = [];
let redoStack = [];
let isApplyingSnapshot = false;
let _pushDebounceTimer = null;

// ── Helper: esclude SEMPRE la texture carta dai snapshot ──
function getUndoJSON() {
  return canvas.toJSON([
    "__shape",
    "data",
    "__isFreehand",
    "__isWatercolor", "__clipPoly",
    "__watercolorParams",
    "__addedAt",
    "__shapeType",
    "customId",
    "__textureId",
    "__textureSpanMM",
    "__textureColorize",
    "__textureTint"
  ]);
}

function enableHistoryButtons() {
  const hasUndo = undoStack.length > 0;
  const hasRedo = redoStack.length > 0;

  if (undoBtn) undoBtn.disabled = !hasUndo;
  if (redoBtn) redoBtn.disabled = !hasRedo;
  // Opzionale: tooltip quando disabilitato
  if (redoBtn) redoBtn.title = hasRedo ? "Redo" : "Nessun tratto da ripristinare";
}

function pushState() {
  if (isApplyingSnapshot) return;
  if (isRestoringProject) return;
  try {
    // Con excludeFromExport=true su backgroundImageObject e paperTextureObject
    // (impostato alla loro creazione), Fabric li salta automaticamente in
    // canvas.toJSON. Non serve più rimuoverli/riaggiungerli: niente flicker.
    const snap = JSON.stringify(
      canvas.toJSON([
        "__shape",
        "data",
        "__isFreehand",
        "__isBackground",
        "__isWatercolor", "__clipPoly",
        "__watercolorParams",
        "__addedAt",
        "__shapeType",
        "customId",
        "__textureId",
        "__textureSpanMM",
        "__textureColorize",
        "__textureTint"
      ])
    );

    undoStack.push(snap);
    if (undoStack.length > UNDO_LIMIT) undoStack.shift();
    redoStack = [];
    enableHistoryButtons();
  } catch (e) {
    console.warn("pushState error", e);
  }
}

function pushStateDebounced() {
  clearTimeout(_pushDebounceTimer);
  _pushDebounceTimer = setTimeout(pushState, 400);
}

async function applySnapshot(jsonStr, pushCurrentToRedo = true) {
  try {
    if (pushCurrentToRedo && !isApplyingSnapshot) {
      // toJSON salta automaticamente gli oggetti excludeFromExport=true
      // (background utente + paper texture): niente remove/add manuale.
      const curr = JSON.stringify(
        canvas.toJSON([
          "__shape",
          "data",
          "__isFreehand",
          "__isBackground",
          "__isWatercolor", "__clipPoly",
          "__watercolorParams",
          "__addedAt",
          "__shapeType",
          "customId",
          "__textureId",
          "__textureSpanMM",
          "__textureColorize",
          "__textureTint"
        ])
      );
      redoStack.push(curr);
      if (redoStack.length > UNDO_LIMIT) redoStack.shift();
    }

    isApplyingSnapshot = true;

    canvas.loadFromJSON(JSON.parse(jsonStr), async () => {
      // Difesa: rimuovi eventuali background finiti per errore nella snapshot
      // (legacy di vecchi save fatti prima del fix excludeFromExport).
      canvas
        .getObjects()
        .filter((o) => o.__isBackground)
        .forEach((o) => canvas.remove(o));

      // Ripristina i lock delle linee freehand prima del render finale
      if (typeof window.restoreFreehandLocks === "function") {
        const freehandCount = window.restoreFreehandLocks();
        console.log(`[undo/redo] ${freehandCount} linee freehand riloccate`);
      }

      // Ripristina lo sfondo utente persistente da backgroundMeta
      if (backgroundMeta && backgroundMeta.dataURL) {
        if (backgroundImageObject) {
          if (!canvas.contains(backgroundImageObject)) {
            canvas.add(backgroundImageObject);
          }
          canvas.sendToBack(backgroundImageObject);
          backgroundImageObject.setCoords();
        } else {
          await new Promise((resolve) => {
            fabric.Image.fromURL(
              backgroundMeta.dataURL,
              function (img) {
                const targetW = mm2px(A4_MM_W);
                const targetH = mm2px(A4_MM_H);
                const rotation = backgroundMeta.rotation || 0;
                const rotatedSwap = rotation === 90 || rotation === 270;
                const refImgW = rotatedSwap ? img.height : img.width;
                const refImgH = rotatedSwap ? img.width : img.height;
                const sx = targetW / refImgW;
                const sy = targetH / refImgH;
                const scale = backgroundMeta.fit === "cover" ? Math.max(sx, sy) : Math.min(sx, sy);

                img.set({
                  left: targetW / 2,
                  top: targetH / 2,
                  originX: "center",
                  originY: "center",
                  angle: rotation,
                  scaleX: scale,
                  scaleY: scale,
                  selectable: false,
                  evented: false,
                  hasControls: false,
                  hasBorders: false,
                  lockMovementX: true,
                  lockMovementY: true,
                  lockScalingX: true,
                  lockScalingY: true,
                  lockRotation: true,
                  excludeFromExport: true,
                  __isBackground: true
                });

                backgroundImageObject = img;
                canvas.add(img);
                canvas.sendToBack(img);
                img.setCoords();
                resolve();
              },
              { crossOrigin: "anonymous" }
            );
          });
        }

        if (typeof window.hidePaperTexture === "function") {
          window.hidePaperTexture();
        }
      } else {
        // Nessuno sfondo utente: ripristina la texture carta
        if (typeof window.restorePaperTexture === "function") {
          window.restorePaperTexture();
        } else if (typeof window.ensurePaperTexture === "function") {
          await window.ensurePaperTexture(paperTextureRotationDeg);
          if (typeof window.keepPaperTextureBehindEverything === "function") {
            window.keepPaperTextureBehindEverything();
          }
        }
      }

      // Ricostruisce i fill texture dai metadati (le snapshot NON contengono
      // piu' l'immagine, solo __textureId): le immagini stanno nel registro in
      // memoria, quindi e' sincrono e immediato.
      if (typeof rebuildTextureFill === "function") {
        canvas.getObjects().forEach((o) => {
          if (o && (o.__textureId || (o.fill && o.fill.__texId))) rebuildTextureFill(o);
        });
      }

      // Riapplica il perimetro di contenimento ai tratti freehand: loadFromJSON
      // ricrea gli oggetti senza clipPath (excludeFromExport lo tiene fuori dal
      // JSON), quindi va riagganciato qui.
      if (typeof window.applyFreehandClipToAll === "function") {
        window.applyFreehandClipToAll();
      }

      canvas.requestRenderAll();
      isApplyingSnapshot = false;
      enableHistoryButtons();
    });
  } catch (e) {
    console.error("applySnapshot error", e);
    isApplyingSnapshot = false;
  }
}

function restoreBackgroundLock() {
  if (!canvas) return 0;
  let count = 0;
  canvas.getObjects().forEach((obj) => {
    if (obj.__isBackground === true) {
      obj.set({
        selectable: false,
        evented: false,
        hasControls: false,
        hasBorders: false,
        lockMovementX: true,
        lockMovementY: true,
        lockScalingX: true,
        lockScalingY: true,
        lockRotation: true,
        hoverCursor: "default"
      });
      obj.setCoords();
      count++;
    }
  });
  canvas.renderAll();
  return count;
}

// ── Riapplica silenziosamente lo sfondo da backgroundMeta (senza pushState) ──
// Usata da applySnapshot dopo ogni undo/redo per tenere lo sfondo sempre
// visibile e completamente disaccoppiato dalla storia delle forme.
function _reapplyBackgroundSilent() {
  if (!backgroundMeta || !backgroundMeta.dataURL) {
    // Nessuno sfondo impostato: ripristina la texture carta se era nascosta
    if (typeof window.restorePaperTexture === "function") window.restorePaperTexture();
    updateBgPreviewUI();
    if (window.forceFixDeleteButton) window.forceFixDeleteButton();
    return;
  }

  fabric.Image.fromURL(
    backgroundMeta.dataURL,
    function (img) {
      const targetW = mm2px(A4_MM_W);
      const targetH = mm2px(A4_MM_H);
      const rotation = backgroundMeta.rotation || 0;
      const rotatedSwap = rotation === 90 || rotation === 270;
      const refImgW = rotatedSwap ? img.height : img.width;
      const refImgH = rotatedSwap ? img.width : img.height;
      const sx = targetW / refImgW;
      const sy = targetH / refImgH;
      const scale = backgroundMeta.fit === "cover" ? Math.max(sx, sy) : Math.min(sx, sy);

      img.set({
        left: targetW / 2,
        top: targetH / 2,
        originX: "center",
        originY: "center",
        angle: rotation,
        scaleX: scale,
        scaleY: scale,
        selectable: false,
        evented: false,
        hasControls: false,
        hasBorders: false,
        lockMovementX: true,
        lockMovementY: true,
        lockScalingX: true,
        lockScalingY: true,
        lockRotation: true,
        excludeFromExport: true,
        hoverCursor: "default",
        __isBackground: true
      });

      // ── Doppia protezione contro pushState indesiderati ──
      // (a) isApplyingSnapshot=true blocca il guard primario su object:added/removed
      // (b) __isBackground=true sul img blocca il guard secondario
      // Usiamo entrambi per essere robusti contro edge-case di Fabric.js.
      const prevApplying = isApplyingSnapshot;
      isApplyingSnapshot = true;

      if (backgroundImageObject) canvas.remove(backgroundImageObject);
      canvas.add(img);
      canvas.sendToBack(img);
      backgroundImageObject = img;

      isApplyingSnapshot = prevApplying; // ripristina esattamente il valore precedente

      img.setCoords();
      canvas.renderAll();

      // ── Nasconde la texture carta: lo sfondo utente la sostituisce visivamente ──
      if (typeof window.hidePaperTexture === "function") window.hidePaperTexture();

      updateBgPreviewUI();
      if (window.forceFixDeleteButton) window.forceFixDeleteButton();
    },
    { crossOrigin: "anonymous" }
  );
}

if (undoBtn) {
  undoBtn.addEventListener("click", () => {
    if (undoStack.length === 0) return;
    const curr = undoStack.pop();
    redoStack.push(curr);
    if (redoStack.length > UNDO_LIMIT) redoStack.shift();
    if (undoStack.length > 0) {
      applySnapshot(undoStack[undoStack.length - 1], false);
    } else {
      // Stack vuoto: rimuovi solo gli oggetti disegnati, NON lo sfondo persistente
      isApplyingSnapshot = true;

      canvas
        .getObjects()
        .slice()
        .forEach((obj) => {
          if (obj.__isBackground) return;
          if (obj === backgroundImageObject) return;
          if (obj === paperTextureObject) return;
          canvas.remove(obj);
        });

      if (backgroundMeta && backgroundMeta.dataURL) {
        if (backgroundImageObject) {
          if (canvas.contains(backgroundImageObject)) canvas.remove(backgroundImageObject);
          canvas.add(backgroundImageObject);
          canvas.sendToBack(backgroundImageObject);
          backgroundImageObject.setCoords();
          if (typeof window.hidePaperTexture === "function") window.hidePaperTexture();
        }
      } else {
        if (typeof window.restorePaperTexture === "function") window.restorePaperTexture();
      }

      canvas.requestRenderAll();
      isApplyingSnapshot = false;
    }
    enableHistoryButtons();
  });
}

if (redoBtn) {
  redoBtn.addEventListener("click", () => {
    if (redoStack.length === 0) return;
    const next = redoStack.pop();
    undoStack.push(next);
    applySnapshot(next, false);
    enableHistoryButtons();
  });
}

let _batchOperationDepth = 0;

function beginBatchOperation() {
  _batchOperationDepth++;
}

function endBatchOperation() {
  _batchOperationDepth = Math.max(0, _batchOperationDepth - 1);
  if (_batchOperationDepth === 0) {
    pushState();
  }
}

function shouldSkipHistoryEvent(e) {
  return (
    isApplyingSnapshot ||
    isRestoringProject ||
    window.__suspendHistoryPush ||
    e.target?.__isBackground ||
    _batchOperationDepth > 0
  );
}

canvas.on("object:added", (e) => {
  if (shouldSkipHistoryEvent(e)) return;
  if (isApplyingSnapshot) return;
  if (canvas.isDrawingMode) return;
  if (e.target?.__isBackground) return;
  pushStateDebounced();
});
// NOTA: il listener "object:modified" canonico è registrato più in basso (≈ riga 2605).
// Lì viene fatto anche bake trapezio/triangolo, positionRadial, updateMeasureOverlay
// e pushState IMMEDIATO. Avere qui un secondo listener con pushStateDebounced(400ms)
// causava DUE entry per ogni modifica → undo/redo instabili (richiedeva 2 click).
// Mantenuti invece object:added / object:removed con debounce: arrivano spesso a raffica
// (paste, import, restore) e il debounce serve a coalescerli in un solo snapshot.
canvas.on("object:removed", (e) => {
  if (shouldSkipHistoryEvent(e)) return;
  if (isApplyingSnapshot) return;
  if (e.target?.__isBackground) return;
  pushStateDebounced();
});

// ============== GEOMETRIA TRIANGOLI E TRAPEZI ==============
function polygonFromTrapezoidModel(model, fitH) {
  return model.computePointsFit(fitH).map((p) => ({ x: p.x, y: p.y }));
}

function polygonFromTriangleModel(model, targetHeightPx = null, targetBasePx = null) {
  if (!model || typeof model.computePoints !== "function") return [];
  let pts = model.computePoints();
  const dist = (p, q) => Math.sqrt((p.x - q.x) ** 2 + (p.y - q.y) ** 2);
  const heightOfPts = (arr) => {
    const ys = arr.map((p) => p.y);
    return Math.max(...ys) - Math.min(...ys);
  };
  if (typeof targetBasePx === "number" && targetBasePx > 0) {
    const baseCurrent = dist(pts[0], pts[1]) || 1;
    const scale = targetBasePx / baseCurrent;
    pts = pts.map((p) => ({ x: p.x * scale, y: p.y * scale }));
  } else if (typeof targetHeightPx === "number" && targetHeightPx > 0) {
    const h = heightOfPts(pts) || 1;
    const scale = targetHeightPx / h;
    pts = pts.map((p) => ({ x: p.x * scale, y: p.y * scale }));
  }
  const centroid = _centroidOfPoints(pts);
  return pts.map((p) => ({ x: p.x - centroid.x, y: p.y - centroid.y }));
}

function createTrapezoidFromBBox(center, targetW_px, targetH_px, fill) {
  const bottom_px = targetW_px;
  const top_px = Math.max(4, Math.round(bottom_px * 0.6));
  const height_px = Math.max(4, targetH_px);

  // ── TRAPEZIO RETTANGOLO INIZIALE ─────────────────────────────────────────
  // Per ottenere un trapezio rettangolo (lato sinistro perpendicolare alle
  // basi) il centro della base superiore deve essere spostato verso destra
  // di esattamente (bottom - top) / 2 rispetto al centro della base inferiore.
  // In questo modo i due vertici di sinistra (basso-sx e alto-sx) hanno la
  // stessa coordinata x → il lato sinistro è verticale, cioè a 90°.
  const offset_px = (bottom_px - top_px) / 2;

  const model = new TrapezoidModel(top_px, bottom_px, height_px, offset_px);
  const pts = model.computePointsFit(height_px);
  const poly = new fabric.Polygon(pts, {
    left: center.x,
    top: center.y,
    originX: "center",
    originY: "center",
    fill: fill || "#78a0ff"
  });
  poly.__shapeType = "trapezoid";
  poly.__shape = model.toJSON(px2mm);
  return poly;
}

// Calcola l'offset da applicare al trapezio per preservare la "categoria"
// angolare (90° di un rettangolo, simmetria di un isoscele) quando l'utente
// modifica solo la lunghezza della base superiore o inferiore.
//
// Strategia:
//   1) Se il trapezio era ESATTAMENTE isoscele (offset = 0), resta isoscele
//      → il nuovo offset è 0.
//   2) Altrimenti si "ancora" sul lato obliquo più vicino alla verticale
//      (quello con |inclinazione orizzontale| minore): si sceglie il nuovo
//      offset in modo che quel lato mantenga la stessa pendenza, così un
//      eventuale angolo a 90° resta a 90°.
//
// Tutti gli argomenti devono essere nelle stesse unità (mm o px, basta che
// siano coerenti tra loro).
function offsetForPreservedAngles(b_old, t_old, dx_old, b_new, t_new) {
  const halfDiff_old = (b_old - t_old) / 2;
  const halfDiff_new = (b_new - t_new) / 2;
  // "Lean" orizzontale dei due lati obliqui (in coord. locali del modello):
  //   leftLean  = D.x - A.x = dx + (b - t)/2
  //   rightLean = C.x - B.x = dx - (b - t)/2
  const leftLean_old = dx_old + halfDiff_old;
  const rightLean_old = dx_old - halfDiff_old;

  const ISOSCELES_EPS = 1e-3;
  if (Math.abs(dx_old) < ISOSCELES_EPS) return 0; // resta isoscele

  if (Math.abs(leftLean_old) <= Math.abs(rightLean_old)) {
    // Preserva D.x - A.x  →  dx_new = leftLean_old - halfDiff_new
    return leftLean_old - halfDiff_new;
  } else {
    // Preserva C.x - B.x  →  dx_new = rightLean_old + halfDiff_new
    return rightLean_old + halfDiff_new;
  }
}

// Determina se la base superiore del MODELLO del trapezio coincide con
// quella visivamente in alto sul canvas. Considera angle, flipX, flipY,
// scaleX, scaleY tramite la matrice di trasformazione di Fabric, quindi
// funziona anche su un polygon non ancora "cotto".
//
// Usata dagli slider Base sup./Base inf. per swappare automaticamente il
// mapping quando il trapezio è ruotato "a testa in giù" (angle ~ 180°)
// o flippato sull'asse Y, così gli slider modificano sempre la base che
// l'utente VEDE come superiore o inferiore.
//
// Tie-break: a parità di Y in canvas (caso degenere di rotazioni esatte
// di 90°/270° con offset = 0, dove le due basi sono perfettamente
// verticali) manteniamo il mapping del modello → niente flicker sulla
// soglia.
function _trapModelTopIsVisuallyTop(obj) {
  if (!obj || obj.type !== "polygon") return true;
  if (!Array.isArray(obj.points) || obj.points.length < 4) return true;

  const pts = obj.points;
  // Convenzione del TrapezoidModel: pts[0..1] = base inf, pts[2..3] = base sup
  const midBottomRaw = new fabric.Point((pts[0].x + pts[1].x) / 2, (pts[0].y + pts[1].y) / 2);
  const midTopRaw = new fabric.Point((pts[2].x + pts[3].x) / 2, (pts[2].y + pts[3].y) / 2);

  // Trasforma in coordinate canvas tramite la matrice di Fabric.
  // calcTransformMatrix() lavora su punti relativi a pathOffset (centro
  // del bounding box dei punti raw del polygon), quindi sottraiamo
  // pathOffset prima di applicare la matrice.
  const matrix = obj.calcTransformMatrix();
  const off = obj.pathOffset || new fabric.Point(0, 0);

  const cBottom = fabric.util.transformPoint(new fabric.Point(midBottomRaw.x - off.x, midBottomRaw.y - off.y), matrix);
  const cTop = fabric.util.transformPoint(new fabric.Point(midTopRaw.x - off.x, midTopRaw.y - off.y), matrix);

  // In coords canvas Y minore = visualmente più in alto.
  if (Math.abs(cTop.y - cBottom.y) < 1e-6) return true;
  return cTop.y < cBottom.y;
}

// ============== CONTROLLI TRAPEZIO ==============
let trapTopInput, trapBottomInput, trapHeightInput, trapOffsetInput;

function ensureTrapezoidControlsExist() {
  let container = document.getElementById("trapezoidControlsContainer");
  if (container) return container;

  const inspectorBody = document.querySelector("#historyPanel .inspector-body");
  if (!inspectorBody) {
    console.warn("[trapezoid] Inspector body non trovato, controlli non inseriti");
    return null;
  }

  container = document.createElement("div");
  container.id = "trapezoidControlsContainer";
  container.className = "inspector-section";
  container.dataset.section = "trapezoid";
  container.innerHTML = `
    <p class="inspector-section-title">Trapezio · Geometria</p>

    <div class="inspector-row">
      <span class="lbl">Base sup.</span>
      <input type="range" id="trapTop" min="1" max="200" value="60" step="0.01" style="flex:1" />
      <span class="val" id="trapTopValue">60.000</span>
    </div>

    <div class="inspector-row">
      <span class="lbl">Base inf.</span>
      <input type="range" id="trapBottom" min="1" max="200" value="100" step="0.01" style="flex:1" />
      <span class="val" id="trapBottomValue">100.000</span>
    </div>

    <div class="inspector-row">
      <span class="lbl">Altezza</span>
      <input type="range" id="trapHeight" min="1" max="150" value="50" step="0.01" style="flex:1" />
      <span class="val" id="trapHeightValue">50.000</span>
    </div>

    <div class="inspector-row">
      <span class="lbl">Offset</span>
      <input type="range" id="trapOffset" min="-15" max="15" value="0" step="0.01" style="flex:1" />
      <span class="val" id="trapOffsetValue">0.000</span>
    </div>

    <div class="inspector-divider"></div>
    <div style="font-size:11px;color:var(--col-text-dim)">
      Tutti i valori in mm (passo 0.01 mm). Le basi seguono la rotazione:
      "Base sup." modifica sempre la base che vedi in alto sullo schermo.
      Solo l'Offset cambia la categoria (rettangolo / isoscele / scaleno);
      gli altri slider la preservano.
    </div>
  `;

  inspectorBody.appendChild(container);

  // BUGFIX (preservato): assegniamo le variabili MODULE-LEVEL, non locali.
  trapTopInput = container.querySelector("#trapTop");
  trapBottomInput = container.querySelector("#trapBottom");
  trapHeightInput = container.querySelector("#trapHeight");
  trapOffsetInput = container.querySelector("#trapOffset");

  const trapTopValue = container.querySelector("#trapTopValue");
  const trapBottomValue = container.querySelector("#trapBottomValue");
  const trapHeightValue = container.querySelector("#trapHeightValue");
  const trapOffsetValue = container.querySelector("#trapOffsetValue");

  let raf = null;
  function updateTrapezoidLive(source) {
    const obj = canvas.getActiveObject();
    if (!obj) return;
    const isTrap = obj.__shapeType === "trapezoid" || (obj.type === "polygon" && obj.__shape?.type === "trapezoid");
    if (!isTrap) return;

    // ── 1) PORTA IL TRAPEZIO IN STATO CANONICO ──────────────────────────
    // Assorbe scaleX/scaleY ≠ 1 e flipX/flipY (residui da handle-scaling
    // o flip via maniglie) nei punti. Dopo questo:
    //   • flipX = flipY = false, scaleX = scaleY = 1
    //   • topBase del modello corrisponde alla base "in alto" in coord locali
    //   • la rotazione visiva è interamente in obj.angle
    // È idempotente: se è già canonico è quasi un no-op.
    bakeTrapezoidScaleIntoPoints(obj);

    // ── 2) MAPPING VISUALE → MODELLO basato su rotazione ────────────────
    // Se il trapezio è ruotato "a testa in giù" (angle in (90°, 270°)), la
    // topBase del MODELLO è visivamente in basso. In quel caso swappiamo
    // top↔bottom così "Base sup." controlla sempre la base che l'utente
    // VEDE in alto. L'Offset è un parametro structural del modello e
    // non si swappa.
    const topModelIsTopVisually = _trapModelTopIsVisuallyTop(obj);

    // Letture grezze (tutto in mm)
    const topVis_mm = parseFloat(trapTopInput.value);
    const botVis_mm = parseFloat(trapBottomInput.value);
    const height_mm = parseFloat(trapHeightInput.value);
    let offset_mm = parseFloat(trapOffsetInput.value);

    // Mappa visivo → modello
    let top_mm = topModelIsTopVisually ? topVis_mm : botVis_mm;
    let bottom_mm = topModelIsTopVisually ? botVis_mm : topVis_mm;

    // Mappa anche la "sorgente" del cambio dal mondo VISIVO a quello MODELLO,
    // così offsetForPreservedAngles riceve coordinate coerenti.
    const sourceModel =
      source === "top"
        ? topModelIsTopVisually
          ? "top"
          : "bottom"
        : source === "bottom"
          ? topModelIsTopVisually
            ? "bottom"
            : "top"
          : source;

    // ── 3) PRESERVA LA CATEGORIA ANGOLARE quando si tocca una BASE ──────
    // Cambiare la lunghezza di una base NON deve trasformare il trapezio
    // in un'altra categoria (es. rettangolo → isoscele): solo lo slider
    // Offset cambia la categoria. Calcoliamo il nuovo offset_mm che
    // mantiene gli angoli, poi clampiamo ai limiti dello slider Offset
    // (graceful degradation: se si tocca l'estremo, l'angolo non viene
    // più mantenuto perfettamente ma le basi continuano a cambiare).
    if (sourceModel === "top" || sourceModel === "bottom") {
      const prev_top = obj.__shape?.top_mm ?? top_mm;
      const prev_bottom = obj.__shape?.bottom_mm ?? bottom_mm;
      const prev_offset = obj.__shape?.offset_mm ?? offset_mm;

      const newOffset_mm = offsetForPreservedAngles(prev_bottom, prev_top, prev_offset, bottom_mm, top_mm);

      const offMin = parseFloat(trapOffsetInput.min);
      const offMax = parseFloat(trapOffsetInput.max);
      offset_mm = Math.max(offMin, Math.min(offMax, newOffset_mm));

      // Riflette il nuovo offset sullo slider (set programmatico di .value
      // NON scatena eventi input/change → nessun loop).
      trapOffsetInput.value = offset_mm.toFixed(3);
    }

    // ── 4) DISPLAY a 3 decimali (coerente con step 0.001 mm) ───────────
    trapTopValue.textContent = topVis_mm.toFixed(3);
    trapBottomValue.textContent = botVis_mm.toFixed(3);
    trapHeightValue.textContent = height_mm.toFixed(3);
    trapOffsetValue.textContent = parseFloat(trapOffsetInput.value).toFixed(3);

    // ── 5) APPLY (RAF-throttled) ───────────────────────────────────────
    if (raf) cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => {
      updateTrapezoidGeometry(obj, { top: top_mm, bottom: bottom_mm, height: height_mm, offset: offset_mm });
      canvas.requestRenderAll();
      if (typeof window.updateStatusSelection === "function") window.updateStatusSelection();
    });
  }

  // input → live preview senza pushState (no spam dello storico).
  // change → fine drag/keystroke: un solo pushState per interazione.
  // NB: la versione precedente registrava un secondo listener "input"
  // duplicato senza source — qui rimosso (era un bug copy-paste).
  const _trapInputSources = new Map([
    [trapTopInput, "top"],
    [trapBottomInput, "bottom"],
    [trapHeightInput, "height"],
    [trapOffsetInput, "offset"]
  ]);
  _trapInputSources.forEach((source, inp) => {
    inp.addEventListener("input", () => updateTrapezoidLive(source));
    inp.addEventListener("change", () => {
      // Ri-arma il max degli slider in base ai nuovi valori del modello.
      // In questo modo ad ogni rilascio si possono espandere di altri 10mm.
      const obj = canvas.getActiveObject();
      if (obj) updateTrapezoidSliderMaxes(obj);
      if (typeof pushState === "function" && !isApplyingSnapshot) pushState();
    });
  });

  return container;
}
ensureTrapezoidControlsExist();
ensureTrapezoidControlsExist();

// ============== MAX DINAMICO SLIDER TRAPEZIO ==============
// Ri-arma dinamicamente il "max" degli slider Base sup. / Base inf. / Altezza
// a (valore_corrente_in_mm + 10). Così l'utente può sempre espandere la
// geometria di al più 10mm dalla forma corrente; al rilascio dello slider
// (o alla riselezione) il limite si "scivola" e si può espandere di altri
// 10mm — utile per costruire incrementalmente trapezi di grandi dimensioni
// senza un cap hard-coded.
//
// Lo slider Offset NON viene toccato: il suo range fisso [-100, +100] mm
// copre già qualsiasi categoria (rettangolo / isoscele / scaleno) per
// trapezi di taglie usuali sul piano da taglio laser.
//
// NB: durante il drag NON aggiorniamo il max — modificarlo mentre il pollice
// dello slider è in movimento provocherebbe un "salto indietro" visivo del
// thumb. Aggiorniamo solo a "change" (rilascio) e in populate.
function updateTrapezoidSliderMaxes(obj) {
  if (!obj || !trapTopInput || !trapBottomInput || !trapHeightInput) return;
  const isTrap = obj.__shapeType === "trapezoid" || (obj.type === "polygon" && obj.__shape?.type === "trapezoid");
  if (!isTrap) return;

  // Mapping visuale → modello (gli slider "Base sup./inf." mostrano i mm
  // della base che l'utente VEDE in alto/basso, non quella del modello —
  // stesso mapping usato in populate e in updateTrapezoidLive).
  const topModelIsTopVisually = _trapModelTopIsVisuallyTop(obj);
  const top_mm = obj.__shape?.top_mm ?? 60;
  const bottom_mm = obj.__shape?.bottom_mm ?? 100;
  const height_mm = obj.__shape?.height_mm ?? 50;

  const topVis_mm = topModelIsTopVisually ? top_mm : bottom_mm;
  const botVis_mm = topModelIsTopVisually ? bottom_mm : top_mm;

  // SAFE_FLOOR garantisce un range minimo utilizzabile anche per trapezi
  // sub-millimetrici durante l'editing (caso raro ma possibile).
  const SAFE_FLOOR = 11; // 1mm (min slider) + 10mm di espansione

  trapTopInput.max = Math.max(SAFE_FLOOR, topVis_mm + 10).toFixed(3);
  trapBottomInput.max = Math.max(SAFE_FLOOR, botVis_mm + 10).toFixed(3);
  trapHeightInput.max = Math.max(SAFE_FLOOR, height_mm + 10).toFixed(3);
}

function populateTrapezoidControlsFromObject(obj) {
  if (!trapTopInput || !obj) return;

  const isTrap = obj.__shapeType === "trapezoid" || (obj.type === "polygon" && obj.__shape?.type === "trapezoid");
  if (!isTrap) return;

  // BAKE: garantisce che __shape sia coerente con i punti reali a schermo,
  // azzera scale/flip residui da handle-scaling e riallinea topBase del
  // modello con la base in alto in coord locali del polygon.
  bakeTrapezoidScaleIntoPoints(obj);

  // Mapping visuale ↔ modello (vedi commento in updateTrapezoidLive).
  const topModelIsTopVisually = _trapModelTopIsVisuallyTop(obj);

  const top_mm = obj.__shape?.top_mm ?? 60;
  const bottom_mm = obj.__shape?.bottom_mm ?? 100;
  const height_mm = obj.__shape?.height_mm ?? 50;
  const offset_mm = obj.__shape?.offset_mm ?? 0;

  // Slider VISIVI: se il trapezio è "a testa in giù" rispetto al canvas,
  // la base sup VISIVA è la bottomBase del modello e viceversa.
  const topVis_mm = topModelIsTopVisually ? top_mm : bottom_mm;
  const botVis_mm = topModelIsTopVisually ? bottom_mm : top_mm;

  // ── RI-ARMA I MAX PRIMA DI SCRIVERE I VALUE ───────────────────────────
  // Importante farlo PRIMA dell'assegnazione di .value: se il valore
  // corrente fosse oltre il vecchio max, il browser lo clampava al max
  // vecchio, perdendo precisione fino al prossimo update.
  updateTrapezoidSliderMaxes(obj);

  // Arrotondiamo a 3 decimali (match con step 0.001 mm degli slider)
  const round3 = (v) => Math.round(Number(v) * 1000) / 1000;

  // Clamp dell'offset ai limiti dello slider, conservando i mm reali
  // del modello (non riscriviamo __shape qui).
  const offMin = parseFloat(trapOffsetInput.min);
  const offMax = parseFloat(trapOffsetInput.max);
  const offset_mm_clamped = Math.max(offMin, Math.min(offMax, offset_mm));

  trapTopInput.value = round3(topVis_mm);
  trapBottomInput.value = round3(botVis_mm);
  trapHeightInput.value = round3(height_mm);
  trapOffsetInput.value = round3(offset_mm_clamped);

  document.getElementById("trapTopValue").textContent = round3(topVis_mm).toFixed(3);
  document.getElementById("trapBottomValue").textContent = round3(botVis_mm).toFixed(3);
  document.getElementById("trapHeightValue").textContent = round3(height_mm).toFixed(3);
  document.getElementById("trapOffsetValue").textContent = round3(offset_mm_clamped).toFixed(3);

  if (typeof window.refreshInspectorContext === "function") {
    window.refreshInspectorContext();
  }
}

// ============== APPLICA NUOVA GEOMETRIA AL TRAPEZIO ==============
// Chiamata dagli slider (Base sup./inf., Altezza, Offset) per ricostruire
// i punti del polygon a partire da {top, bottom, height, offset} in mm.
//
// Comportamento "ad hoc Mosaica":
//   • Conserva centro e rotazione attuali (la forma non si sposta).
//   • Se il trapezio ha scala/flip residui da un handle-scale, prima li
//     "cuoce" nei punti (bakeTrapezoidScaleIntoPoints) — così non si
//     accumulano deformazioni tra slider e maniglie.
//   • Aggiorna __shape DAI PUNTI REALI (non dai valori in input), così
//     gli arrotondamenti restano coerenti con measure overlay e status bar.
//   • NON pusha lo storico: lo fa il listener "change" dello slider,
//     una volta sola a fine interazione.
function updateTrapezoidGeometry(obj, dims) {
  if (!obj || !dims) return;
  const isTrap = obj.__shapeType === "trapezoid" || (obj.type === "polygon" && obj.__shape?.type === "trapezoid");
  if (!isTrap) return;

  // Clamp difensivo (la slider già limita, ma proteggiamo da NaN/negativi)
  const top_mm = Math.max(0, Number(dims.top) || 0);
  const bottom_mm = Math.max(0.1, Number(dims.bottom) || 0.1);
  const height_mm = Math.max(0.1, Number(dims.height) || 0.1);
  const offset_mm = Number(dims.offset) || 0;

  // mm → px (rispetta calibrazione corrente)
  const top_px = mm2px(top_mm);
  const bottom_px = mm2px(bottom_mm);
  const height_px = mm2px(height_mm);
  const offset_px = mm2px(offset_mm);

  // Salva centro e rotazione PRIMA di toccare i punti.
  const center = obj.getCenterPoint();
  const angleObj = obj.angle || 0;

  // Bake preventivo: se ci sono scale/flip residui da un precedente
  // handle-scaling, assorbili nei punti prima di sovrascriverli.
  const sx = obj.scaleX || 1;
  const sy = obj.scaleY || 1;
  if (Math.abs(sx) !== 1 || Math.abs(sy) !== 1 || obj.flipX || obj.flipY) {
    bakeTrapezoidScaleIntoPoints(obj);
  }

  // Costruisci nuovo modello e punti (centrati sull'origine locale
  // come fa computePoints — il polygon manterrà left/top dal center).
  const model = new TrapezoidModel(top_px, bottom_px, height_px, offset_px);
  const newPts = model.computePoints();

  obj.points = newPts;
  obj.scaleX = 1;
  obj.scaleY = 1;
  obj.flipX = false;
  obj.flipY = false;

  // Ricalcola width/height/pathOffset di Fabric dopo il cambio punti
  // (senza spostare la forma).
  _recalcPolygonDimensions(obj);

  // Riposiziona usando il centro salvato e ripristina la rotazione.
  obj.setPositionByOrigin(center, "center", "center");
  obj.angle = angleObj;

  // Aggiorna __shape DAI PUNTI REALI per coerenza con bake/measure.
  const baked = TrapezoidModel.fromPoints(obj.points);
  obj.__shape = {
    type: "trapezoid",
    top_mm: px2mm(baked.topBase),
    bottom_mm: px2mm(baked.bottomBase),
    height_mm: px2mm(baked.height),
    offset_mm: px2mm(baked.offset)
  };
  obj.__shapeType = "trapezoid";

  obj.setCoords();
  updateHandlesSpacing(obj);
  positionRadial();
  updateMeasureOverlay();
}
window.updateTrapezoidGeometry = updateTrapezoidGeometry;

// Determina, in coordinate canvas (cioè dopo aver applicato la matrice di
// trasformazione di Fabric: rotazione, scala, flip, traslazione), se il
// vertice pts[0] (= A, basso-sx in coord LOCALI post-bake) è VISIVAMENTE
// a sinistra di pts[1] (= B, basso-dx in coord LOCALI post-bake).
//
// Usato dagli slider α/β del triangolo per swappare automaticamente il
// mapping quando il triangolo è ruotato in modo che A finisca visivamente
// a destra di B (es. obj.angle ≈ 180°). Così "α" controlla SEMPRE l'angolo
// che l'utente VEDE nel vertice di base più a sinistra — esattamente come
// "Base sup." sul trapezio segue la base che si vede in alto.
//
// Tie-break: se A e B risultano allineati verticalmente (caso degenere
// con base verticale, rotazioni esatte di 90°/270°), restituisce true →
// niente swap, mapping coerente con il modello. Soglia 1e-6 per evitare
// flicker su soglie esatte.
function _triangleAisVisuallyLeftOfB(obj) {
  if (!obj || obj.type !== "polygon") return true;
  if (!Array.isArray(obj.points) || obj.points.length < 3) return true;

  const pts = obj.points;
  const matrix = obj.calcTransformMatrix();
  const off = obj.pathOffset || new fabric.Point(0, 0);

  const cA = fabric.util.transformPoint(new fabric.Point(pts[0].x - off.x, pts[0].y - off.y), matrix);
  const cB = fabric.util.transformPoint(new fabric.Point(pts[1].x - off.x, pts[1].y - off.y), matrix);

  if (Math.abs(cA.x - cB.x) < 1e-6) return true;
  return cA.x < cB.x;
}

// ============== CONTROLLI ANGOLI TRIANGOLO (DIMENSIONE PRESERVATA) ==============
let angleAlphaInput, angleBetaInput;

function ensureTriangleAngleControlsExist() {
  angleAlphaInput = document.getElementById("angleAlpha");
  angleBetaInput = document.getElementById("angleBeta");
  if (!angleAlphaInput || !angleBetaInput) return;

  const alphaValue = document.getElementById("alphaValue");
  const betaValue = document.getElementById("betaValue");

  function updateValueSpans() {
    if (alphaValue) alphaValue.textContent = Number(angleAlphaInput.value).toFixed(1) + "°";
    if (betaValue) betaValue.textContent = Number(angleBetaInput.value).toFixed(1) + "°";
  }

  let raf = null;
  const applyTriangleAngleChange = () => {
    const obj = canvas.getActiveObject();
    if (!obj) return;

    const isTriangle = obj.__shapeType === "triangle" || (obj.type === "polygon" && obj.__shape?.angles);
    if (!isTriangle) return;

    let alpha = parseFloat(angleAlphaInput.value);
    let beta = parseFloat(angleBetaInput.value);
    if (isNaN(alpha) || isNaN(beta)) return;

    // Vincolo di validità
    const MAX_SUM = 179.5;
    if (alpha + beta >= MAX_SUM) {
      beta = Math.max(0.5, MAX_SUM - alpha);
      angleBetaInput.value = beta;
      const betaValueEl = document.getElementById("betaValue");
      if (betaValueEl) betaValueEl.textContent = beta.toFixed(1) + "°";
    }

    // Bake preventivo
    const sxNow = obj.scaleX || 1;
    const syNow = obj.scaleY || 1;
    if (Math.abs(sxNow) !== 1 || Math.abs(syNow) !== 1 || obj.flipX || obj.flipY) {
      bakeTriangleScaleIntoPoints(obj);
    }

    const ptsLocal = obj.points || [];
    if (ptsLocal.length < 3) return;

    // ── FIX: rileva se il triangolo è ribaltato (apice in basso) ──
    // Nella convenzione: pts[0]=A, pts[1]=B (base), pts[2]=C (apice).
    const isFlippedVertically = ptsLocal[2].y > ptsLocal[0].y && ptsLocal[2].y > ptsLocal[1].y;

    const center = obj.getCenterPoint();
    const angleObj = obj.angle || 0;

    // Invariante: bounding-box massimo
    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity;
    for (const p of ptsLocal) {
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }
    const currentMaxDim = Math.max(maxX - minX, maxY - minY) || 100;

    // Costruzione nuova geometria
    const probeModel = new TriangleModel(alpha, beta, 100);
    const probePts = probeModel.computePoints();

    let pMinX = Infinity,
      pMinY = Infinity,
      pMaxX = -Infinity,
      pMaxY = -Infinity;
    for (const p of probePts) {
      if (p.x < pMinX) pMinX = p.x;
      if (p.y < pMinY) pMinY = p.y;
      if (p.x > pMaxX) pMaxX = p.x;
      if (p.y > pMaxY) pMaxY = p.y;
    }
    const probeMaxDim = Math.max(pMaxX - pMinX, pMaxY - pMinY) || 1;

    const fitScale = currentMaxDim / probeMaxDim;
    let newPts = probePts.map((p) => ({ x: p.x * fitScale, y: p.y * fitScale }));

    // ── FIX: se era ribaltato, mantieni l'apice in basso ──
    if (isFlippedVertically) {
      newPts = newPts.map((p) => ({ x: p.x, y: -p.y }));
    }

    obj.points = newPts;
    _recalcPolygonDimensions(obj);

    obj.setPositionByOrigin(center, "center", "center");
    obj.angle = angleObj;

    // Aggiorna __shape dai punti reali
    const baseDist = Math.hypot(newPts[1].x - newPts[0].x, newPts[1].y - newPts[0].y);
    obj.__shapeType = "triangle";
    obj.__shape = {
      type: "triangle",
      angles: [alpha, beta],
      base_mm: px2mm(baseDist)
    };

    obj.setCoords();
    updateHandlesSpacing(obj);
    positionRadial();
    updateMeasureOverlay();
    canvas.renderAll();

    if (!isApplyingSnapshot) pushState();
  };

  [angleAlphaInput, angleBetaInput].forEach((inp) => {
    inp.addEventListener("input", () => {
      updateValueSpans();
      if (raf) cancelAnimationFrame(raf);
      raf = requestAnimationFrame(applyTriangleAngleChange);
    });
  });
}

// ======================= INTEGRAZIONE EVENTI =======================
// (I listener selection:* e object:* sono registrati una sola volta più avanti)

// ============== MENU RADIALE - VARIABILI GLOBALI ==============
let selectedObj = null;
const RADIAL_DEFAULT_RADIUS = 110;

// Moltiplicatore percentuale del raggio del menu radiale, controllato dallo
// slider sotto gli indicatori di misura. Range 0..30 (% in più sul raggio
// calcolato da positionRadial).
let radialSizeOffsetPct = 0;

// ============== ÀNCORA DEL DOCK MULTI-SELEZIONE ==============
// Memorizza l'ULTIMA forma aggiunta alla selezione corrente: il dock
// verticale dei pulsanti si posiziona accanto a lei. Aggiornata dai
// listener selection:created/updated (e.selected contiene solo le forme
// appena aggiunte, qualunque sia la modalità: lazo, CTRL+click, rettangolo).
let radialDockAnchorObj = null;

function updateRadialDockAnchor(e) {
  const active = canvas.getActiveObject();
  if (!active || active.type !== "activeSelection") {
    radialDockAnchorObj = null;
    return;
  }
  const added = e && Array.isArray(e.selected) ? e.selected : [];
  if (added.length > 0) {
    radialDockAnchorObj = added[added.length - 1];
  }
  // Se l'àncora non fa più parte della selezione (es. rimossa con
  // CTRL+click), ripiega sull'ultimo oggetto della selezione corrente.
  const objs = active._objects || [];
  if (!radialDockAnchorObj || objs.indexOf(radialDockAnchorObj) < 0) {
    radialDockAnchorObj = objs.length ? objs[objs.length - 1] : null;
  }
}

// ============== FUNZIONI CENTRO SELEZIONE (semplificata come nel vecchio renderer) ==============
function getSelectionCenterPoint() {
  const active = canvas.getActiveObject();
  if (!active) return { x: 0, y: 0 };

  // ActiveSelection e Group gestiscono automaticamente il centro corretto (anche multi-selezione)
  return active.getCenterPoint();
}

function canvasToScreen(pt) {
  const rect = paper.getBoundingClientRect();
  return {
    x: rect.left + pt.x * view.scale,
    y: rect.top + pt.y * view.scale
  };
}

// ============== MOSTRA/NASCONDI MENU RADIALE ==============
function showRadialForSelection(objects) {
  // FIX MULTI-SELEZIONE + COLORE
  // ──────────────────────────────────────────────────────────────
  // Gli eventi Fabric `selection:created` / `selection:updated`
  // forniscono in `objects` SOLO i NUOVI oggetti aggiunti alla
  // selezione in questa transizione (es. con CTRL+click un secondo
  // oggetto → objects = [solo il secondo]). Per ottenere la SELEZIONE
  // EFFETTIVA leggiamo sempre l'oggetto attivo dal canvas: se è una
  // activeSelection contiene tutti gli N oggetti correntemente
  // selezionati. Senza questo fix, `selectedObj` veniva sovrascritto
  // con l'ultimo oggetto cliccato e la ruota colore agiva solo su
  // quello invece che su tutta la multi-selezione.
  const active = canvas.getActiveObject();

  if (!active) {
    if (radial) radial.style.display = "none";
    if (colorPopup) colorPopup.style.display = "none";
    selectedObj = null;
    return;
  }

  if (active.type === "activeSelection" && Array.isArray(active._objects) && active._objects.length > 1) {
    selectedObj = active;
    selectedObj.__isMultiSelection = true;
    selectedObj.__multiSelectionObjects = selectedObj._objects;
  } else {
    selectedObj = active;
    delete selectedObj.__isMultiSelection;
    delete selectedObj.__multiSelectionObjects;
  }

  if (radial) {
    radial.style.display = "block";
    positionRadial();
  }
  if (overlay) overlay.style.display = "block";

  updateRadialForMultiSelection();
}

// ============== AGGIORNA STATO PULSANTI GROUP/UNGROUP ==============
function updateRadialForMultiSelection() {
  const activeObjects = canvas.getActiveObjects();
  const activeObject = canvas.getActiveObject();

  const btnGroup = radial?.querySelector('[data-action="group"]');
  const btnUngroup = radial?.querySelector('[data-action="ungroup"]');

  if (btnGroup && btnUngroup) {
    // Sempre visibili
    btnGroup.style.display = "flex";
    btnUngroup.style.display = "flex";

    const isMultiSelection = activeObjects.length > 1;
    const isGroup = activeObject && activeObject.type === "group";
    const isActiveSelection = activeObject && activeObject.type === "activeSelection";

    const setEnabled = (btn, enabled) => {
      if (enabled) {
        btn.style.opacity = "1";
        btn.style.pointerEvents = "auto";
        btn.style.filter = "none";
        btn.style.cursor = "pointer";
      } else {
        btn.style.opacity = "0.35";
        btn.style.pointerEvents = "none";
        btn.style.filter = "grayscale(100%)";
        btn.style.cursor = "not-allowed";
      }
    };

    if (isMultiSelection || isActiveSelection) {
      setEnabled(btnGroup, true);
      setEnabled(btnUngroup, false);
    } else if (isGroup) {
      setEnabled(btnGroup, false);
      setEnabled(btnUngroup, true);
    } else {
      setEnabled(btnGroup, false);
      setEnabled(btnUngroup, false);
    }
  }

  // Aggiorna anche icona/tooltip/colore del bottone lock in base allo stato corrente
  updateRadialLockButton();
}

// Aggiorna icona, tooltip e colore del pulsante "lock" del menu radiale per
// riflettere lo stato corrente della selezione:
// - selezione contiene almeno 1 oggetto bloccato → 🔓 "Sblocca" (arancione)
// - tutto libero → 🔒 "Blocca" (blu di default)
function updateRadialLockButton() {
  if (!radial) return;
  const btn = radial.querySelector('[data-action="lock"]');
  if (!btn) return;

  const active = canvas.getActiveObject();
  if (!active) return;

  const isLockedObj = (o) => !!o && (!!o.__locked || !!o.lockMovementX);

  let anyLocked = false;
  if (active.type === "activeSelection" && Array.isArray(active._objects)) {
    anyLocked = active._objects.some(isLockedObj);
  } else {
    anyLocked = isLockedObj(active);
  }

  if (anyLocked) {
    btn.textContent = "🔓";
    btn.setAttribute("data-tooltip", __t("radial.tooltip.unlock", null, "Sblocca oggetto"));
    btn.style.background = "#e67e22"; // arancione = stato bloccato
  } else {
    btn.textContent = "🔒";
    btn.setAttribute("data-tooltip", __t("radial.tooltip.lockFull", null, "Blocca oggetto (non selezionabile per spostamento/scala/rotazione)"));
    btn.style.background = ""; // ripristina il blu di default
  }
}

function updateMeasureOverlay() {
  const active = canvas.getActiveObject();
  if (!active || !overlay) {
    if (overlay) overlay.style.display = "none";
    // Aggiorna comunque status bar + pannello inspector (li resetta a "nessuna")
    if (typeof window.updateStatusSelection === "function") window.updateStatusSelection();
    if (typeof updateShapeDimensionsPanel === "function") updateShapeDimensionsPanel();
    if (typeof updateTextureGrainPanel === "function") updateTextureGrainPanel();
    return;
  }

  const wPx = active.getScaledWidth ? active.getScaledWidth() : active.width || 0;
  const hPx = active.getScaledHeight ? active.getScaledHeight() : active.height || 0;
  const wMm = px2mm(wPx).toFixed(1);
  const hMm = px2mm(hPx).toFixed(1);

  // Aggiorna i testi SOLO se non c'è un input inline attivo (modalità edit)
  if (mW && !mW.querySelector("input")) mW.textContent = `L → ${wMm} mm`;
  if (mH && !mH.querySelector("input")) mH.textContent = `A ↑ ${hMm} mm`;

  // Se il radial è visibile e posizionato, ancoriamo l'overlay al radial.
  // Se non è pronto, calcoliamo una posizione basata sul centro dell'oggetto.
  let overlayX = 0,
    overlayY = 0;

  if (radial && radial.style.display !== "none") {
    // ── FIX: leggiamo i valori inline (FINALI) appena settati da positionRadial,
    //   NON radial.getBoundingClientRect(). Durante la transizione CSS di
    //   left/top/width/height del radial (160-180ms), getBoundingClientRect
    //   restituisce la posizione ANIMATA in-between — non quella finale —
    //   quindi l'overlay si piazzava sotto la posizione transitoria del
    //   radial, restando di fatto fermo nella posizione precedente al
    //   cambio forma. Si "agganciava" solo dopo che l'utente muoveva la
    //   forma (object:moving aggiorna positionRadial+updateMeasureOverlay
    //   ad ogni RAF, e la transizione precedente è già terminata).
    //   Leggere i valori dallo style inline bypassa completamente il
    //   problema senza dover toccare la transizione CSS (che resta come
    //   animazione voluta del radial). Compatibile da Fabric 5.1.0 in poi
    //   perché non dipende da nessuna API Fabric — è solo DOM puro.
    const radialLeft = parseFloat(radial.style.left);
    const radialTop = parseFloat(radial.style.top);
    const radialW = parseFloat(radial.style.width);
    const radialH = parseFloat(radial.style.height);
    if (Number.isFinite(radialLeft) && Number.isFinite(radialTop) && radialW > 0 && radialH > 0) {
      overlayX = radialLeft + radialW / 2 - 108;
      overlayY = radialTop + radialH + 35;
    }
  }

  // fallback: posiziona overlay sotto il centro dell'oggetto selezionato
  if (!overlayX || overlayX === 0) {
    const center = getSelectionCenterPoint();
    const screen = canvasToScreen(center);
    overlayX = screen.x - 108;
    overlayY = screen.y + (Math.max(wPx, hPx) * view.scale) / 2 + 24;
  }

  // (refreshRadialForSelection rimosso: era una chiamata ridondante che
  //  generava un frame RAF extra per ogni updateMeasureOverlay. Tutti i
  //  call-site di updateMeasureOverlay sono già preceduti da positionRadial
  //  o _scheduleRadialUpdate, che gestiscono il radial direttamente.)

  overlay.style.left = `${Math.round(overlayX)}px`;
  overlay.style.top = `${Math.round(overlayY)}px`;
  overlay.style.display = "flex";

  // ── PROPAGAZIONE LIVE: status bar + pannello dimensioni inspector ──
  // Risolve il problema delle misure non aggiornate durante scaling/rotazione,
  // soprattutto quando l'overlay è fuori schermo (zoom alto, forma in basso).
  if (typeof window.updateStatusSelection === "function") window.updateStatusSelection();
  if (typeof updateShapeDimensionsPanel === "function") updateShapeDimensionsPanel();
  if (typeof updateTextureGrainPanel === "function") updateTextureGrainPanel();
}

// ═════════════════════════════════════════════════════════════════════════
// DIMENSIONI MANUALI — Inline edit sugli indicatori + campi inspector W/H
// ═════════════════════════════════════════════════════════════════════════
// Cambia W/H di un oggetto fabric agendo su scaleX/scaleY (funziona uniforme-
// mente per Rect, Circle, Polygon trapezio/triangolo, Path freehand, Group).
// Triggera 'object:modified' così il bake trapezio/triangolo, pushState e i
// vari refresh UI esistenti scattano in cascata senza codice duplicato.
function applyShapeDimensions(obj, newWMm, newHMm) {
  if (!obj) return;
  if (!Number.isFinite(newWMm) || !Number.isFinite(newHMm)) return;
  if (newWMm <= 0 || newHMm <= 0) return;

  const newWPx = mm2px(newWMm);
  const newHPx = mm2px(newHMm);
  const curW = typeof obj.getScaledWidth === "function" ? obj.getScaledWidth() : 0;
  const curH = typeof obj.getScaledHeight === "function" ? obj.getScaledHeight() : 0;
  if (curW <= 0 || curH <= 0) return;

  const fx = newWPx / curW;
  const fy = newHPx / curH;
  obj.scaleX = (obj.scaleX || 1) * fx;
  obj.scaleY = (obj.scaleY || 1) * fy;
  if (typeof obj.setCoords === "function") obj.setCoords();
  canvas.requestRenderAll();

  // Emette object:modified: triggera bake (trapezio/triangolo), positionRadial,
  // updateMeasureOverlay → status bar + inspector si riaggiornano in cascata.
  // Si occupa anche di pushState per l'undo/redo.
  canvas.fire("object:modified", { target: obj });
}

// Aggiorna il blocco "Dimensioni" dentro l'inspector con i valori della
// forma selezionata. Lo nasconde per multi-selezione (coerente con la
// status bar che in quel caso mostra solo "N oggetti").
function updateShapeDimensionsPanel() {
  const block = document.getElementById("inspectorDimensionsBlock");
  const wInput = document.getElementById("inspectorShapeWidth");
  const hInput = document.getElementById("inspectorShapeHeight");
  if (!block) return;

  const obj = canvas.getActiveObject();
  if (!obj || obj.type === "activeSelection") {
    block.style.display = "none";
    return;
  }

  block.style.display = "block";

  // Non sovrascrivere il valore se l'utente sta digitando
  if (wInput && document.activeElement !== wInput) {
    const wMm = px2mm(obj.getScaledWidth ? obj.getScaledWidth() : obj.width || 0);
    wInput.value = wMm.toFixed(1);
  }
  if (hInput && document.activeElement !== hInput) {
    const hMm = px2mm(obj.getScaledHeight ? obj.getScaledHeight() : obj.height || 0);
    hInput.value = hMm.toFixed(1);
  }
}

// Click sugli indicatori L/A sopra il canvas → input inline al posto del testo.
// Enter o blur applicano, Esc annulla. Disponibile solo per oggetto singolo.
function initInlineMeasureEditing() {
  if (!mW || !mH) return;

  [
    { el: mW, axis: "w" },
    { el: mH, axis: "h" }
  ].forEach(({ el, axis }) => {
    el.style.cursor = "pointer";
    el.title = "Clicca per inserire la misura a mano";
    el.addEventListener("click", (ev) => {
      ev.stopPropagation();
      startInlineMeasureEdit(axis);
    });
  });
}

function startInlineMeasureEdit(axis) {
  const obj = canvas.getActiveObject();
  if (!obj) return;
  if (obj.type === "activeSelection") {
    flashToast(__t("toast.shape.directEditOnlySingle", null, "Modifica diretta disponibile solo per forme singole"));
    return;
  }

  const el = axis === "w" ? mW : mH;
  if (!el || el.querySelector("input")) return; // già in editing

  const wMm = px2mm(obj.getScaledWidth ? obj.getScaledWidth() : obj.width || 0);
  const hMm = px2mm(obj.getScaledHeight ? obj.getScaledHeight() : obj.height || 0);
  const currentMm = axis === "w" ? wMm : hMm;

  el.dataset.originalText = el.textContent;
  el.innerHTML = "";

  const prefix = document.createElement("span");
  prefix.textContent = axis === "w" ? "L → " : "A ↑ ";

  const input = document.createElement("input");
  input.type = "number";
  input.step = "0.1";
  input.min = "0.5";
  input.value = currentMm.toFixed(1);
  input.style.cssText =
    "width:64px;background:rgba(0,0,0,0.5);color:#fff;" +
    "border:1px solid #00c8ff;border-radius:3px;padding:0 4px;" +
    "font-family:monospace;font-size:13px;font-weight:600;" +
    "text-align:right;outline:none;pointer-events:auto;";

  const suffix = document.createElement("span");
  suffix.textContent = " mm";

  el.appendChild(prefix);
  el.appendChild(input);
  el.appendChild(suffix);

  input.focus();
  input.select();

  let committed = false;
  const finalize = (apply) => {
    if (committed) return;
    committed = true;
    if (apply) {
      const v = parseFloat(input.value);
      if (Number.isFinite(v) && v > 0) {
        const newW = axis === "w" ? v : wMm;
        const newH = axis === "h" ? v : hMm;
        applyShapeDimensions(obj, newW, newH);
      }
    }
    // Ripristina il testo (updateMeasureOverlay lo rigenererà subito coi nuovi valori)
    el.textContent = el.dataset.originalText || "—";
    delete el.dataset.originalText;
    updateMeasureOverlay();
  };

  input.addEventListener("keydown", (ev) => {
    ev.stopPropagation();
    if (ev.key === "Enter") {
      ev.preventDefault();
      finalize(true);
    } else if (ev.key === "Escape") {
      ev.preventDefault();
      finalize(false);
    }
  });
  input.addEventListener("blur", () => finalize(true));
  // Evita che il click dentro l'input bubbli verso l'overlay/canvas
  input.addEventListener("click", (e) => e.stopPropagation());
  input.addEventListener("mousedown", (e) => e.stopPropagation());
}

// Hook sugli input W/H nell'inspector — change/blur applicano,
// Enter conferma (blur), Esc annulla e ripristina i valori reali.
function initInspectorDimensionInputs() {
  const wInput = document.getElementById("inspectorShapeWidth");
  const hInput = document.getElementById("inspectorShapeHeight");
  if (!wInput || !hInput) return;

  function commit(axis, input) {
    const obj = canvas.getActiveObject();
    if (!obj || obj.type === "activeSelection") {
      updateShapeDimensionsPanel();
      return;
    }
    const v = parseFloat(input.value);
    if (!Number.isFinite(v) || v <= 0) {
      updateShapeDimensionsPanel(); // ripristina valori reali
      return;
    }
    const wMm = px2mm(obj.getScaledWidth ? obj.getScaledWidth() : obj.width || 0);
    const hMm = px2mm(obj.getScaledHeight ? obj.getScaledHeight() : obj.height || 0);
    const newW = axis === "w" ? v : wMm;
    const newH = axis === "h" ? v : hMm;
    applyShapeDimensions(obj, newW, newH);
  }

  [
    { axis: "w", input: wInput },
    { axis: "h", input: hInput }
  ].forEach(({ axis, input }) => {
    input.addEventListener("change", () => commit(axis, input));
    input.addEventListener("keydown", (ev) => {
      ev.stopPropagation();
      if (ev.key === "Enter") {
        ev.preventDefault();
        input.blur(); // → change → commit
      } else if (ev.key === "Escape") {
        ev.preventDefault();
        updateShapeDimensionsPanel(); // ripristina valore reale
        input.blur();
      }
    });
  });
}

// Inizializza tutto appena il DOM è pronto (gli elementi DOM esistono già:
// overlay/mW/mH vengono presi all'inizio del file; gli input inspector
// vengono inseriti dal markup HTML).
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => {
    initInlineMeasureEditing();
    initInspectorDimensionInputs();
    initTextureGrainSlider();
    initTextureAllPanel();
  });
} else {
  initInlineMeasureEditing();
  initInspectorDimensionInputs();
  initTextureGrainSlider();
  initTextureAllPanel();
}

// ============== TOOLTIP RADIALE ==============
const radialTooltip = document.createElement("div");
radialTooltip.id = "radialTooltip";
radialTooltip.style.cssText = `
  position: absolute;
  pointer-events: none;
  z-index: 10010;
  background: rgba(15,15,15,0.96);
  color: #fff;
  padding: 8px 14px;
  border-radius: 6px;
  font-size: 13px;
  white-space: nowrap;
  box-shadow: 0 6px 18px rgba(0,0,0,0.6);
  opacity: 0;
  transition: opacity .15s;
`;
document.body.appendChild(radialTooltip);

function initRadialTooltips() {
  document.querySelectorAll(".radial-btn").forEach((btn) => {
    const text = btn.dataset.tooltip;
    if (!text) return;
    btn.addEventListener("mouseenter", (e) => {
      radialTooltip.textContent = text;
      radialTooltip.style.opacity = "1";
      radialTooltip.style.left = e.clientX + 24 + "px";
      radialTooltip.style.top = e.clientY + 30 + "px";
    });
    btn.addEventListener("mouseleave", () => {
      radialTooltip.style.opacity = "0";
    });
  });
}

// ============== SPACING MANIGLIE ==============
function applyHandlePreset(obj) {
  if (!obj) return;
  const kind = String(obj.__shapeType || obj.type || "").toLowerCase();
  // paddingRatio leggermente aumentati: maniglie un poco più lontane dalla
  // forma (non attaccate) ma non eccessivamente staccate.
  const presets = {
    rect: { cornerScreen: 18, paddingRatio: 0.13 },
    circle: { cornerScreen: 16, paddingRatio: 0.11 },
    trapezoid: { cornerScreen: 20, paddingRatio: 0.15 },
    triangle: { cornerScreen: 20, paddingRatio: 0.15 },
    default: { cornerScreen: 18, paddingRatio: 0.14 }
  };

  const p = presets[kind] || presets.default;
  obj.__desiredCornerScreen = p.cornerScreen;
  obj.__paddingScreenRatio = p.paddingRatio;
}

function updateHandlesSpacing(obj) {
  if (!obj) return;
  try {
    if (typeof obj.__desiredCornerScreen === "undefined") applyHandlePreset(obj);

    const bbox = obj.getBoundingRect(true);
    const maxDim = Math.max(bbox.width, bbox.height);

    const desiredScreenCornerPx = Math.max(10, obj.__desiredCornerScreen || 24);
    const cornerSizeCanvas = Math.max(6, Math.round(desiredScreenCornerPx / (view.scale || 1)));
    const paddingScreenPx = Math.max(14, Math.round(maxDim * (obj.__paddingScreenRatio || 0.13)));
    const paddingCanvas = Math.round(paddingScreenPx / (view.scale || 1));

    obj.hasBorders = false; // ← RIMUOVE LE LINEE FASTIDIOSE
    obj.hasControls = true;
    obj.padding = paddingCanvas;
    obj.cornerSize = cornerSizeCanvas;
    obj.transparentCorners = false;
    obj.cornerColor = "#00c8ff";
    obj.cornerStrokeColor = "#002244";
    obj.borderColor = "transparent"; // ← sicurezza extra

    obj.setCoords();
  } catch (e) {
    console.warn("updateHandlesSpacing error", e);
  }
}

// ── Ricalcola width/height/pathOffset di un fabric.Polygon dopo aver cambiato .points ──
// NON chiamare _setPositionDimensions: resetta anche left/top portando la forma a (0,0).
// Usiamo _calcDimensions che restituisce solo bbox senza spostare l'oggetto.
function _recalcPolygonDimensions(obj) {
  if (!obj || obj.type !== "polygon") return;

  if (typeof obj._calcDimensions === "function") {
    const dim = obj._calcDimensions(); // { left, top, width, height }
    obj.width = dim.width;
    obj.height = dim.height;
    // pathOffset = centro del bounding box dei punti raw
    obj.pathOffset = new fabric.Point(dim.left + dim.width / 2, dim.top + dim.height / 2);
  } else if (typeof obj._setPositionDimensions === "function") {
    // Fallback: salva centro, ricalcola (resetta left/top), ripristina posizione
    const center = obj.getCenterPoint();
    obj._setPositionDimensions({});
    obj.setPositionByOrigin(center, "center", "center");
  }
  obj.dirty = true;
}

// ============== BAKE TRAPEZIO ──────────────────────────────────────────────
// Assorbe scaleX/scaleY (e flipX/flipY) di un poligono trapezio dentro i suoi
// punti, ricalcola __shape dai punti reali, e azzera la scala. Mantiene
// invariate posizione (centro), rotazione, fill e tutto il resto.
//
// Quando va chiamato:
//   1. Dopo handle-scaling (resize con le maniglie) → object:modified
//   2. Dopo lo scale +10% del menu radiale
//   3. Dopo l'ungroup di un gruppo che conteneva un trapezio
//   4. Al caricamento di vecchi progetti che potrebbero avere scale residue
//   5. Prima del salvataggio progetto, per garantire __shape coerente
//
// Effetto: dopo il bake, scaleX = scaleY = 1, flipX = flipY = false, e
// __shape (top_mm, bottom_mm, height_mm, offset_mm) corrisponde ESATTAMENTE
// alla geometria visibile a schermo. Così gli slider mostrano sempre i mm
// reali e una modifica di un singolo slider non rompe gli altri parametri.
function bakeTrapezoidScaleIntoPoints(obj) {
  if (!obj || obj.type !== "polygon") return false;

  const isTrap = obj.__shapeType === "trapezoid" || (obj.__shape && obj.__shape.type === "trapezoid");
  if (!isTrap) return false;
  if (!Array.isArray(obj.points) || obj.points.length < 4) return false;

  const sx = obj.scaleX || 1;
  const sy = obj.scaleY || 1;
  const fx = obj.flipX ? -1 : 1;
  const fy = obj.flipY ? -1 : 1;

  // Se è già canonico (scala = 1, niente flip) → nessun bake necessario,
  // ma ricalcoliamo comunque __shape dai punti per sincronizzare i numeri.
  const isCanonical = Math.abs(sx) === 1 && Math.abs(sy) === 1 && !obj.flipX && !obj.flipY;

  // Salva centro e rotazione PRIMA di toccare scala/punti.
  const center = obj.getCenterPoint();
  const angle = obj.angle || 0;

  if (!isCanonical) {
    // Applica scala (e flip) ai punti raw del polygon.
    const newPoints = obj.points.map((p) => ({
      x: p.x * sx * fx,
      y: p.y * sy * fy
    }));

    // Se c'è stato un flip, ricostruiamo l'ordine dei punti per mantenere
    // la convenzione [bassoSx, bassoDx, altoDx, altoSx] del TrapezoidModel.
    // Strategia robusta: ricalcoliamo dai vertici "geometrici", non dagli
    // indici originali. Ordiniamo per y crescente prima (i due con y più
    // grande sono la base inferiore in coordinate locali del polygon dove
    // y cresce verso il basso), poi ciascuna coppia per x crescente.
    let finalPoints;
    if (obj.flipX || obj.flipY) {
      // Ordina per y desc: i due con y più grande = base inferiore (basso)
      const sorted = [...newPoints].sort((a, b) => b.y - a.y);
      const bottomPair = [sorted[0], sorted[1]].sort((a, b) => a.x - b.x); // sx, dx
      const topPair = [sorted[2], sorted[3]].sort((a, b) => a.x - b.x); // sx, dx
      finalPoints = [bottomPair[0], bottomPair[1], topPair[1], topPair[0]];
    } else {
      finalPoints = newPoints;
    }

    obj.points = finalPoints;

    // Reset di scala e flip
    obj.scaleX = 1;
    obj.scaleY = 1;
    obj.flipX = false;
    obj.flipY = false;

    // Ricalcola width/height/pathOffset dai nuovi punti
    _recalcPolygonDimensions(obj);

    // Riposiziona usando il centro salvato (perché _recalcPolygonDimensions
    // potrebbe aver alterato il riferimento interno)
    obj.setPositionByOrigin(center, "center", "center");
    obj.angle = angle;
  }

  // Ricalcola __shape dai punti reali (in pixel) e converte in mm
  const model = TrapezoidModel.fromPoints(obj.points);
  obj.__shape = {
    type: "trapezoid",
    top_mm: px2mm(model.topBase),
    bottom_mm: px2mm(model.bottomBase),
    height_mm: px2mm(model.height),
    offset_mm: px2mm(model.offset)
  };
  obj.__shapeType = "trapezoid";

  obj.setCoords();
  return true;
}

// Esposizione globale (utile per debug e per chiamate da altri moduli)
window.bakeTrapezoidScaleIntoPoints = bakeTrapezoidScaleIntoPoints;

// ========== BAKE TRIANGOLO (fix riordino) ==========
function bakeTriangleScaleIntoPoints(obj) {
  if (!obj || obj.type !== "polygon") return false;

  const isTriangle = obj.__shapeType === "triangle" || (obj.__shape && Array.isArray(obj.__shape.angles));
  if (!isTriangle) return false;
  if (!Array.isArray(obj.points) || obj.points.length < 3) return false;

  const sx = obj.scaleX || 1;
  const sy = obj.scaleY || 1;
  const isCanonical = Math.abs(sx) === 1 && Math.abs(sy) === 1 && !obj.flipX && !obj.flipY;

  const center = obj.getCenterPoint();
  const angle = obj.angle || 0;

  if (!isCanonical) {
    const fx = obj.flipX ? -1 : 1;
    const fy = obj.flipY ? -1 : 1;

    let newPoints = obj.points.map((p) => ({
      x: p.x * sx * fx,
      y: p.y * sy * fy
    }));

    // ── FIX: riordino SOLO per flip orizzontale (scambia A ↔ B) ──
    // Per flipY / scaleY < 0 NON riordiniamo: l'apice può restare in basso.
    // applyTriangleAngleChange rileverà l'orientamento e lo preserverà.
    if (obj.flipX || sx < 0) {
      newPoints = [newPoints[1], newPoints[0], newPoints[2]];
    }

    obj.points = newPoints;
    obj.scaleX = 1;
    obj.scaleY = 1;
    obj.flipX = false;
    obj.flipY = false;

    _recalcPolygonDimensions(obj);
    obj.setPositionByOrigin(center, "center", "center");
    obj.angle = angle;
  }

  // Ricalcola __shape dai punti reali (funziona anche con apice in basso)
  const model = TriangleModel.fromPoints(obj.points);
  obj.__shape = {
    type: "triangle",
    angles: [model.alpha, model.beta],
    base_mm: px2mm(model.base)
  };
  obj.__shapeType = "triangle";

  obj.setCoords();
  return true;
}

window.bakeTriangleScaleIntoPoints = bakeTriangleScaleIntoPoints;

// ============== EVENT LISTENER SELEZIONE ==============
canvas.on("selection:created", (e) => {
  updateRadialDockAnchor(e);
  const sel = e?.selected || [];
  showRadialForSelection(sel);
  updateRadialSliceVisibility(); // ← ex listener duplicato

  const active = canvas.getActiveObject();
  if (active && active.type === "activeSelection" && active._objects) {
    // Le maniglie visibili sono quelle DEL WRAPPER, non dei figli: aggiorniamo
    // solo il wrapper (1 chiamata invece di N). Per i figli garantiamo solo
    // che abbiano il preset di base — operazione O(1) per oggetto — così
    // quando l'utente scioglierà la selezione e selezionerà un singolo figlio,
    // updateHandlesSpacing avrà già __desiredCornerScreen/__paddingScreenRatio.
    updateHandlesSpacing(active);
    active._objects.forEach((o) => {
      if (typeof o.__desiredCornerScreen === "undefined" && typeof applyHandlePreset === "function") {
        applyHandlePreset(o);
      }
    });
  } else if (sel[0]) {
    updateHandlesSpacing(sel[0]);
    toggleAngleControls();
    populateTrapezoidControlsFromObject(sel[0]);
  }
  positionRadial();
  requestAnimationFrame(() => requestAnimationFrame(updateMeasureOverlay));
});

canvas.on("selection:updated", (e) => {
  updateRadialDockAnchor(e);
  const sel = e?.selected || [];
  showRadialForSelection(sel);
  updateRadialSliceVisibility(); // ← ex listener duplicato

  const active = canvas.getActiveObject();
  if (active && active.type === "activeSelection" && active._objects) {
    // Stesso ottimizzo di selection:created (vedi commento lì).
    updateHandlesSpacing(active);
    active._objects.forEach((o) => {
      if (typeof o.__desiredCornerScreen === "undefined" && typeof applyHandlePreset === "function") {
        applyHandlePreset(o);
      }
    });
  } else if (sel[0]) {
    updateHandlesSpacing(sel[0]);
    toggleAngleControls();
    populateTrapezoidControlsFromObject(sel[0]);
  }
  positionRadial();
  requestAnimationFrame(() => requestAnimationFrame(updateMeasureOverlay)); // doppio RAF
});

canvas.on("selection:cleared", (e) => {
  // ── BAKE DEFERRED dopo multi-resize ───────────────────────────────────
  // Quando l'utente scioglie una activeSelection appena ridimensionata,
  // Fabric ha già applicato scaleX/scaleY/angle del wrapper a ciascun
  // figlio: ora hanno coordinate globali coerenti col visivo. Possiamo
  // finalmente fare bake su trapezi/triangoli che hanno scala residua.
  // Senza questo step, l'inspector mostrerebbe valori incoerenti e
  // applyShapeDimensions calcolerebbe fattori su scaleX già "sporche",
  // generando il comportamento erratico segnalato dopo multi-resize.
  try {
    const exChildren = (e && Array.isArray(e.deselected)) ? e.deselected : [];
    if (exChildren.length > 1) {
      // Sospendi temporaneamente la storia: un solo pushState alla fine,
      // non N (uno per ogni figlio bakato).
      const wasSuspended = !!window.__suspendHistoryPush;
      window.__suspendHistoryPush = true;

      let didBake = false;
      exChildren.forEach((o) => {
        if (!o || o.type !== "polygon") return;
        const isTrap = o.__shapeType === "trapezoid" || (o.__shape && o.__shape.type === "trapezoid");
        const isTri = o.__shapeType === "triangle" || (o.__shape && Array.isArray(o.__shape.angles));
        const sx = o.scaleX || 1;
        const sy = o.scaleY || 1;
        const needs = Math.abs(sx - 1) > 0.001 || Math.abs(sy - 1) > 0.001 || o.flipX || o.flipY;
        if (!needs) return;
        if (isTrap && typeof bakeTrapezoidScaleIntoPoints === "function") {
          bakeTrapezoidScaleIntoPoints(o);
          didBake = true;
        } else if (isTri && typeof bakeTriangleScaleIntoPoints === "function") {
          bakeTriangleScaleIntoPoints(o);
          didBake = true;
        }
      });

      window.__suspendHistoryPush = wasSuspended;

      if (didBake) {
        canvas.requestRenderAll();
        // Singolo pushState che cattura lo stato finale post-bake
        if (typeof pushState === "function" && !isApplyingSnapshot && !isRestoringProject) {
          pushState();
        }
      }
    }
  } catch (err) {
    console.warn("[selection:cleared] bake deferred error", err);
  }

  // ── Reset UI (logica originale) ──────────────────────────────────────
  updateRadialSliceVisibility();
  if (radial) {
    radial.style.display = "none";
    radial.style.setProperty("--radial-radius", `${RADIAL_DEFAULT_RADIUS}px`);
    radial.style.width = `${RADIAL_DEFAULT_RADIUS * 2}px`;
    radial.style.height = `${RADIAL_DEFAULT_RADIUS * 2}px`;
  }
  if (overlay) overlay.style.display = "none";
  if (colorPopup) colorPopup.style.display = "none";

  // ── INSPECTOR: nascondi i blocchi legati alla forma selezionata ───────
  // overlay.style.display="none" qui sopra nasconde solo gli indicatori L/A
  // SUL canvas; i blocchi "Dimensioni" e "Texture" DENTRO l'inspector erano
  // gestiti solo da updateMeasureOverlay(), che non scatta su selection:cleared.
  // Senza questo reset restavano visibili dopo la deselezione e, poiche' i
  // toggle penna/gomma/acquerello deselezionano via discardActiveObject()
  // (-> selection:cleared), si mischiavano con la sezione dello strumento.
  // A questo punto getActiveObject() e' null, quindi le due funzioni nascondono
  // i rispettivi blocchi. Compatibile Fabric 5.1.0 -> 5.3.0 (nessuna API Fabric).
  if (typeof updateShapeDimensionsPanel === "function") updateShapeDimensionsPanel();
  if (typeof updateTextureGrainPanel === "function") updateTextureGrainPanel();

  if (selectedObj) {
    delete selectedObj.__isMultiSelection;
    delete selectedObj.__multiSelectionObjects;
  }
  selectedObj = null;

  try { populateAngleControlsFromObject(null); } catch (err) {}
  try { populateTrapezoidControlsFromObject(null); } catch (err) {}
  toggleAngleControls();
});

// Movimento oggetti - aggiorna posizione menu + ricalcola padding maniglie
// Throttling per positionRadial durante il drag — evita reflow ad ogni frame
let _radialMoveRAF = null;
let _pendingRadialUpdate = false;

function _scheduleRadialUpdate(needHandles = true) {
  // Accumulo OR: se anche un solo trigger nel frame vuole le maniglie
  // aggiornate (scaling/rotating), le aggiorniamo. Moving da solo no.
  _pendingNeedHandles = _pendingNeedHandles || !!needHandles;
  if (_radialMoveRAF) return;
  _pendingRadialUpdate = false;
  _radialMoveRAF = requestAnimationFrame(() => {
    _radialMoveRAF = null;
    const tgt = _pendingMoveTarget;
    const needH = _pendingNeedHandles;
    _pendingMoveTarget = null;
    _pendingNeedHandles = false;
    if (tgt && needH) {
      // Aggiornamento maniglie spostato DENTRO il RAF: a zoom alto evita di
      // far girare getBoundingRect + setCoords ad ogni mousemove (vedi
      // updateHandlesSpacing, che ricalcola padding/cornerSize/setCoords).
      updateHandlesSpacing(tgt);
    }
    positionRadial();
    updateMeasureOverlay();
  });
}

let _pendingMoveTarget = null;
// Durante moving puro (translation) le maniglie NON cambiano dimensione né
// padding (cambia solo lo zoom, fermo durante il drag): skippiamo
// updateHandlesSpacing che a zoom >300% è il collo di bottiglia (chiama
// getBoundingRect+setCoords su Path freehand con migliaia di punti).
// Scaling/rotating invece passano needHandles=true perché il bbox cambia.
let _pendingNeedHandles = false;

canvas.on("object:moving", (e) => {
  if (!e?.target) return;
  // setCoords sincrono: necessario perché Fabric lo legge per il rendering
  // delle maniglie nel frame corrente. È un'operazione lightweight.
  e.target.setCoords();

  // Tutto il resto (positionRadial, updateMeasureOverlay) viene compresso
  // in 1 sola esecuzione per frame via RAF. updateHandlesSpacing SKIPPATA
  // durante moving: a zoom alto è il vero collo di bottiglia del movimento
  // non fluido (getBoundingRect+setCoords su Path con tanti punti). Durante
  // una traslazione pura le maniglie non cambiano dimensione né padding,
  // quindi non c'è motivo di ricalcolarle ad ogni frame del drag.
  const active = canvas.getActiveObject();
  if (active && (active === e.target || (active.type === "activeSelection" && active.contains?.(e.target)))) {
    _pendingMoveTarget = e.target;
    _pendingRadialUpdate = true;
    _scheduleRadialUpdate(false); // ← skip handles update durante moving
  }
});

canvas.on("object:modified", (e) => {
  if (!e?.target) return;
  const tgt = e.target;

  // Skip oggetti di sistema (sfondo): non vanno bakati né pushati.
  if (tgt.__isBackground) return;

  // ── SKIP BAKE durante activeSelection multi-resize ─────────────────────
  // Quando target è una activeSelection (resize di N forme contemporaneo),
  // i FIGLI sono ancora dentro il wrapper: chiamare getCenterPoint() su un
  // figlio ritorna coordinate LOCALI al gruppo → setPositionByOrigin
  // sposterebbe l'oggetto nel posto sbagliato. Skippiamo il bake ora:
  // sarà fatto al selection:cleared, quando Fabric ha già "applicato" la
  // matrice del wrapper ai figli e i loro scaleX/scaleY/angle/left/top
  // riflettono il visivo. Vedi listener selection:cleared più sotto.
  const isMulti = tgt.type === "activeSelection" || tgt.type === "group";

  if (!isMulti) {
    // ── BAKE TRAPEZIO singolo ─────────────────────────────────────────────
    if (tgt.type === "polygon" && (tgt.__shapeType === "trapezoid" || tgt.__shape?.type === "trapezoid")) {
      bakeTrapezoidScaleIntoPoints(tgt);
      populateTrapezoidControlsFromObject(tgt);
    }
    // ── BAKE TRIANGOLO singolo ────────────────────────────────────────────
    if (tgt.type === "polygon" && (tgt.__shapeType === "triangle" || Array.isArray(tgt.__shape?.angles))) {
      bakeTriangleScaleIntoPoints(tgt);
      toggleAngleControls();
    }
  }

  updateHandlesSpacing(tgt);

  // Aggiornamento finale immediato (annulla eventuale RAF pendente del moving)
  if (_radialMoveRAF) {
    cancelAnimationFrame(_radialMoveRAF);
    _radialMoveRAF = null;
  }
  positionRadial();
  updateMeasureOverlay();

  // pushState DEBOUNCED (400ms): coalesce raffiche di object:modified provenienti
  // da slider inspector (applyShapeDimensions → canvas.fire), da rotazione/scaling
  // fini del mouseObserver, e da multi-modifiche in serie. Su canvas con 200+
  // oggetti + tratti freehand un toJSON costa molto: prima si pushava ad ogni
  // evento, ora un solo snapshot per raffica. UX identica per drag singoli
  // (l'utente non percepisce 400ms tra release e fine del salvataggio history).
  if (typeof shouldSkipHistoryEvent === "function" && shouldSkipHistoryEvent(e)) return;
  if (typeof pushStateDebounced === "function") pushStateDebounced();
  else if (typeof pushState === "function") pushState();
});

canvas.on("object:scaling", (e) => {
  if (!e?.target) return;
  // setCoords sincrono: Fabric lo legge per il rendering delle maniglie
  // nel frame corrente — è un'operazione lightweight.
  e.target.setCoords();
  // Tutto il resto (updateHandlesSpacing, positionRadial, updateMeasureOverlay)
  // compresso in 1 sola esecuzione per frame via RAF: stesso pattern già usato
  // per object:moving. Cruciale a zoom alto e su forme con bbox grande, dove
  // getBoundingRect + reflow del radial costano molto per evento.
  const active = canvas.getActiveObject();
  if (active && (active === e.target || (active.type === "activeSelection" && active.contains?.(e.target)))) {
    _pendingMoveTarget = e.target;
    _scheduleRadialUpdate();
  }
});

canvas.on("object:rotating", (e) => {
  if (!e?.target) return;
  e.target.setCoords();
  // Stesso RAF batching di scaling: a rotazione fine col tasto destro
  // (mouseObserver) gli eventi arrivano a raffica con la rotella.
  const active = canvas.getActiveObject();
  if (active && (active === e.target || (active.type === "activeSelection" && active.contains?.(e.target)))) {
    _pendingMoveTarget = e.target;
    _scheduleRadialUpdate();
  }
});

// ============== CAMBIO FORMA ==============
function radialChangeShapeAction() {
  const orig = canvas.getActiveObject();
  if (!orig) {
    flashToast(__t("toast.selection.selectFirstAlt", null, "Seleziona un oggetto prima"));
    return;
  }

  // Cycle: dopo trapezio, il primo triangolo è quello RETTANGOLO classico
  // (angolo retto in basso a sinistra). L'utente può poi spostare gli slider
  // per arrivare a qualsiasi altro tipo di triangolo.
  const cycle = ["rect", "circle", "trapezoid", "retto", "isoscele", "scaleno", "equilatero", "acuto", "ottusangolo"];
  const italianNames = {
    rect: "Rettangolo",
    circle: "Cerchio",
    trapezoid: "Trapezio",
    retto: "Triangolo rettangolo",
    isoscele: "Triangolo isoscele",
    scaleno: "Triangolo scaleno",
    equilatero: "Triangolo equilatero",
    acuto: "Triangolo acutangolo",
    ottusangolo: "Triangolo ottusangolo"
  };

  let current =
    (orig.__shapeType && String(orig.__shapeType).toLowerCase()) ||
    (orig.type === "rect"
      ? "rect"
      : orig.type === "circle"
        ? "circle"
        : orig.type === "polygon" && orig.__shape?.type === "trapezoid"
          ? "trapezoid"
          : orig.type === "polygon"
            ? "retto"
            : "rect");

  let i = cycle.indexOf(current);
  if (i === -1) i = 0;
  const next = cycle[(i + 1) % cycle.length];

  const center = orig.getCenterPoint();
  const angle = orig.angle || 0;
  const flipX = !!orig.flipX;
  const flipY = !!orig.flipY;
  const fill = orig.fill;

  const origBBox = orig.getBoundingRect(true);
  const visualW = Math.max(4, origBBox.width);
  const visualH = Math.max(4, origBBox.height);

  const sx = Math.abs(orig.scaleX) || 1;
  const sy = Math.abs(orig.scaleY) || 1;

  const targetW_unscaled = Math.max(4, visualW / sx);
  const targetH_unscaled = Math.max(4, visualH / sy);

  let newObj = null;

  if (next === "rect") {
    newObj = new fabric.Rect({
      left: center.x,
      top: center.y,
      originX: "center",
      originY: "center",
      width: targetW_unscaled,
      height: targetH_unscaled,
      fill
    });
  } else if (next === "circle") {
    newObj = new fabric.Circle({
      left: center.x,
      top: center.y,
      originX: "center",
      originY: "center",
      radius: Math.max(targetW_unscaled, targetH_unscaled) / 2,
      fill
    });
  } else if (next === "trapezoid") {
    newObj = createTrapezoidFromBBox(center, targetW_unscaled, targetH_unscaled, fill);
  } else {
    // Preset angoli interni dei triangoli.
    // "retto" è il triangolo rettangolo classico: angolo retto al vertice A
    // (basso-sinistra) → α=90°. β=45° dà un triangolo rettangolo isoscele
    // (cateti uguali). Da qui, lo slider può portarlo a qualsiasi forma.
    const presets = {
      retto: { alpha: 90, beta: 45 },
      isoscele: { alpha: 70, beta: 70 },
      scaleno: { alpha: 40, beta: 70 },
      equilatero: { alpha: 60, beta: 60 },
      acuto: { alpha: 50, beta: 50 },
      ottusangolo: { alpha: 30, beta: 30 }
    };
    const p = presets[next] || { alpha: 60, beta: 60 };
    const model = new TriangleModel(p.alpha, p.beta, targetW_unscaled);
    const pts = model.computePointsFit(targetH_unscaled);
    newObj = new fabric.Polygon(pts, { left: center.x, top: center.y, originX: "center", originY: "center", fill });
    newObj.__shapeType = "triangle";
    newObj.__shape = { type: "triangle", angles: [model.alpha, model.beta], base_mm: px2mm(model.base) };
  }

  if (!newObj) {
    flashToast(__t("toast.shape.createError", null, "Errore creazione forma"));
    return;
  }

  newObj.set({
    selectable: true,
    hasControls: true,
    hasBorders: true,
    objectCaching: false,
    angle,
    flipX,
    flipY
  });
  newObj.customId = generateUID();

  try {
    newObj.setControlsVisibility({
      tl: true,
      tr: true,
      bl: true,
      br: true,
      ml: true,
      mr: true,
      mt: true,
      mb: true,
      mtr: true
    });
  } catch (e) {}

  if (orig.data) {
    try {
      newObj.data = JSON.parse(JSON.stringify(orig.data));
    } catch (e) {
      newObj.data = orig.data;
    }
  }

  // Sostituzione
  newObj.set({
    left: orig.left,
    top: orig.top,
    scaleX: orig.scaleX || 1,
    scaleY: orig.scaleY || 1,
    angle: orig.angle,
    flipX: orig.flipX,
    flipY: orig.flipY
  });

  canvas.remove(orig);
  canvas.add(newObj);
  newObj.moveTo(canvas.getObjects().length - 1);
  newObj.setCoords();
  canvas.setActiveObject(newObj);
  selectedObj = newObj;

  // ── BAKE POST-CAMBIO-FORMA ─────────────────────────────────────────────
  // Il nuovo poligono eredita scaleX/scaleY/flipX/flipY dell'originale; e
  // per i triangoli, computePointsFit potrebbe aver scalato i punti per
  // adattarli all'altezza target. In entrambi i casi, __shape può non
  // riflettere la geometria visibile reale. Cuociamo subito tutto così
  // gli slider mostreranno valori corretti appena l'utente li apre.
  if (newObj.type === "polygon") {
    if (newObj.__shapeType === "trapezoid" || newObj.__shape?.type === "trapezoid") {
      bakeTrapezoidScaleIntoPoints(newObj);
    }
    if (newObj.__shapeType === "triangle" || Array.isArray(newObj.__shape?.angles)) {
      bakeTriangleScaleIntoPoints(newObj);
    }
  }

  // ── FIX MANIGLIE DOPO CAMBIO FORMA ──
  // 1. Applica prima il preset di distanza (cornerScreen + paddingRatio) per il nuovo tipo di forma
  // 2. Poi applica updateHandlesSpacing che usa quei valori per calcolare padding e cornerSize
  // L'ordine è fondamentale: il preset deve precedere il calcolo, non seguirlo.
  applyHandlePreset(newObj);
  updateHandlesSpacing(newObj);
  newObj.setCoords();
  canvas.renderAll();

  // Forza ricalcolo completo del radial dopo che il rendering è completato.
  // Ripopola anche gli slider dei triangoli/trapezi così sono pronti al volo.
  requestAnimationFrame(() => {
    positionRadial();
    updateMeasureOverlay();
    if (typeof toggleAngleControls === "function") toggleAngleControls();
    if (typeof populateTrapezoidControlsFromObject === "function") populateTrapezoidControlsFromObject(newObj);
  });

  pushState();
  flashToast(__t("toast.shape.changed", { name: __t("shapes." + next, null, italianNames[next] || next) }, "Forma → " + (italianNames[next] || next)));
}

function updateRadialSliceVisibility() {
  if (!radial) return;
  const btn = radial.querySelector('[data-action="sliceCircle"]');
  if (!btn) return;

  const active = canvas.getActiveObject();
  const show = active && (active.type === "circle" || active.type === "ellipse");
  btn.style.display = show ? "flex" : "none";
}

// (updateRadialSliceVisibility già integrata nei listener canonici selection:* sopra)

// ============== LISTENER PRINCIPALE MENU RADIALE ==============
if (radial) {
  radial.addEventListener("click", (e) => {
    const btn = e.target.closest(".radial-btn");
    if (!btn) return;

    const act = btn.dataset.action;
    if (!act) return;

    // Ignora se disabilitato
    if (btn.style.pointerEvents === "none") return;

    // --- GROUP ---
    if (act === "group") {
      const objs = canvas.getActiveObjects();
      if (objs.length > 1) {
        // Salva il centro geometrico della selezione per posizionare il gruppo
        const active = canvas.getActiveObject();
        const center = active.getCenterPoint();
        // IMPORTANTE: non rimuovere gli oggetti dal canvas!
        // Fabric.js Group richiede che gli oggetti siano ancora sul canvas
        // quando viene creato, altrimenti perde le coordinate assolute.
        // Invece, creiamo il gruppo con COPIE degli oggetti originali
        // o usiamo il metodo corretto: toGroup() su ActiveSelection
        // Metodo corretto per Fabric.js v4/v5:
        // Converti ActiveSelection in Group mantenendo le coordinate
        const group = active.toGroup();

        if (group) {
          group.set({
            subTargetCheck: true,
            interactive: true,
            selectable: true,
            evented: true,
            hasControls: true,
            hasBorders: true
          });

          canvas.setActiveObject(group);
          selectedObj = group;
          canvas.renderAll();
          pushState();
          flashToast(__t("toast.group.grouped", { count: objs.length }, `✅ ${objs.length} oggetti raggruppati`));
          updateRadialForMultiSelection();
          positionRadial();
        }
      }
      return;
    }

    // --- UNGROUP ---
    if (act === "ungroup") {
      const active = canvas.getActiveObject();
      if (active && active.type === "group") {
        const items = active.getObjects();
        const groupMatrix = active.calcTransformMatrix();

        canvas.remove(active);

        const restoredObjects = [];

        items.forEach((obj, index) => {
          const clonedObj = fabric.util.object.clone(obj);

          const objLeft = obj.left || 0;
          const objTop = obj.top || 0;

          const transformedPoint = fabric.util.transformPoint({ x: objLeft, y: objTop }, groupMatrix);

          const combinedAngle = (obj.angle || 0) + (active.angle || 0);
          const combinedScaleX = (obj.scaleX || 1) * (active.scaleX || 1);
          const combinedScaleY = (obj.scaleY || 1) * (active.scaleY || 1);

          clonedObj.set({
            left: transformedPoint.x,
            top: transformedPoint.y,
            angle: combinedAngle,
            scaleX: combinedScaleX,
            scaleY: combinedScaleY,
            flipX: (obj.flipX || false) !== (active.flipX || false),
            flipY: (obj.flipY || false) !== (active.flipY || false),
            selectable: true,
            evented: true,
            hasControls: true,
            hasBorders: true
          });

          delete clonedObj.group;

          if (obj.__shape) clonedObj.__shape = JSON.parse(JSON.stringify(obj.__shape));
          if (obj.__shapeType) clonedObj.__shapeType = obj.__shapeType;
          clonedObj.customId = obj.customId || generateUID();

          canvas.add(clonedObj);

          // Se il figlio era un trapezio, dopo l'ungroup eredita la scala
          // combinata del gruppo. Cuociamola subito nei punti per mantenere
          // la geometria parametrica coerente con il visivo.
          if (
            clonedObj.type === "polygon" &&
            (clonedObj.__shapeType === "trapezoid" || clonedObj.__shape?.type === "trapezoid")
          ) {
            bakeTrapezoidScaleIntoPoints(clonedObj);
          }

          // Stessa cosa per i triangoli: scala combinata → bake → angoli reali.
          if (
            clonedObj.type === "polygon" &&
            (clonedObj.__shapeType === "triangle" || Array.isArray(clonedObj.__shape?.angles))
          ) {
            bakeTriangleScaleIntoPoints(clonedObj);
          }

          restoredObjects.push(clonedObj);

          if (index === 0) {
            canvas.setActiveObject(clonedObj);
            selectedObj = clonedObj;
          }
        });

        if (restoredObjects.length > 1) {
          const activeSelection = new fabric.ActiveSelection(restoredObjects, { canvas: canvas });
          canvas.setActiveObject(activeSelection);
          selectedObj = activeSelection;
          selectedObj.__isMultiSelection = true;
          selectedObj.__multiSelectionObjects = restoredObjects;
        }

        canvas.renderAll();
        pushState();
        flashToast(__t("toast.group.ungrouped", { count: items.length }, `✅ Gruppo separato (${items.length} oggetti)`));
        updateRadialForMultiSelection();
        positionRadial();
      }
      return;
    }

    // --- CHANGE SHAPE ---
    if (act === "changeShape") {
      radialChangeShapeAction();
      return;
    }

    // --- ROTATE ---
    if (act === "rotate") {
      if (!selectedObj) return;
      if (selectedObj.type === "group" || selectedObj.type === "activeSelection") {
        selectedObj.rotate((selectedObj.angle || 0) + 15);
      } else {
        selectedObj.rotate(snapAngleDeg((selectedObj.angle || 0) + 15, 1));
      }
      selectedObj.setCoords();
      canvas.renderAll();
      pushState();
      positionRadial();
      return;
    }

    // --- DUPLICATE --- (gestito dal secondo listener radial.addEventListener via radialDuplicateAction)
    if (act === "duplicate") {
      return; // delegate to the dedicated handler below
    }

    // --- SCALE ---
    if (act === "scale") {
      if (!selectedObj) return;
      selectedObj.scaleX = (selectedObj.scaleX || 1) * 1.1;
      selectedObj.scaleY = (selectedObj.scaleY || 1) * 1.1;
      selectedObj.setCoords();

      // Se è un trapezio, cuociamo subito la scala nei punti per mantenere
      // __shape e gli slider coerenti con il visivo.
      if (
        selectedObj.type === "polygon" &&
        (selectedObj.__shapeType === "trapezoid" || selectedObj.__shape?.type === "trapezoid")
      ) {
        bakeTrapezoidScaleIntoPoints(selectedObj);
        populateTrapezoidControlsFromObject(selectedObj);
      }

      // Lo stesso vale per i triangoli: cuoci scala e aggiorna slider angoli.
      if (
        selectedObj.type === "polygon" &&
        (selectedObj.__shapeType === "triangle" || Array.isArray(selectedObj.__shape?.angles))
      ) {
        bakeTriangleScaleIntoPoints(selectedObj);
        toggleAngleControls();
      }

      canvas.renderAll();
      pushState();
      positionRadial();
      return;
    }

    // --- COPY COLOR ---
    if (act === "copyColor") {
      if (!selectedObj) {
        flashToast(__t("toast.selection.selectFirst", null, "Seleziona prima un oggetto"));
        return;
      }

      let targetObj = selectedObj;
      if (selectedObj.type === "group" || selectedObj.type === "activeSelection") {
        const items = selectedObj.getObjects ? selectedObj.getObjects() : selectedObj._objects || [];
        if (items.length > 0) targetObj = items[0];
      }

      try {
        if (colorInput) {
          colorInput.value = toHexSafe(typeof targetObj.fill === "string" ? targetObj.fill : "#78a0ff");
        }
      } catch (e) {
        if (colorInput) colorInput.value = "#78a0ff";
      }

      const center = getSelectionCenterPoint();
      const screen = canvasToScreen(center);
      if (colorPopup) {
        colorPopup.style.left = screen.x + 120 + "px";
        colorPopup.style.top = screen.y - 20 + "px";
        colorPopup.style.display = "block";
      }
      return;
    }

    // --- PASTE COLOR ---
    if (act === "pasteColor") {
      if (!selectedObj) {
        flashToast(__t("toast.selection.selectFirst", null, "Seleziona prima un oggetto"));
        return;
      }

      const isGroup = selectedObj.type === "group" || selectedObj.type === "activeSelection";

      if (window.textureAPI?.openTexturePicker) {
        window.textureAPI
          .openTexturePicker()
          .then((result) => {
            if (!result) {
              flashToast(__t("toast.texture.noneSelected", null, "Nessuna texture selezionata"));
              return;
            }

            fabric.Image.fromURL(result.dataURL, function (img) {
              const srcEl = img.getElement ? img.getElement() : img;
              try {
                // Un pattern dedicato per ogni oggetto → grana indipendente.
                if (isGroup && selectedObj._objects) {
                  selectedObj._objects.forEach((obj) => applyTextureToObject(obj, srcEl, result.dataURL));
                } else {
                  applyTextureToObject(selectedObj, srcEl, result.dataURL);
                }
                selectedObj.setCoords();
                canvas.renderAll();
                if (typeof updateTextureGrainPanel === "function") updateTextureGrainPanel();
                flashToast(__t("toast.texture.applied", { filename: result.filename || "" }, "Texture applicata: " + (result.filename || "")));
              } catch (err) {
                console.warn(err);
                flashToast(__t("toast.texture.applyError", null, "Impossibile applicare texture"));
              }
            });
          })
          .catch((err) => {
            console.error("textureAPI error", err);
            flashToast(__t("toast.texture.folderError", null, "Errore apertura cartella texture"));
          });
      } else {
        if (textureFile) textureFile.click();
      }
      return;
    }

    // --- LOCK ---
    if (act === "lock") {
      if (!selectedObj) return;

      // Determina i target del lock/unlock.
      // - activeSelection → blocca/sblocca ciascun figlio (Fabric NON propaga i lock al wrapper)
      // - group / oggetto singolo → opera sull'oggetto stesso (è un fabric object permanente)
      let targets;
      if (selectedObj.type === "activeSelection" && Array.isArray(selectedObj._objects)) {
        targets = selectedObj._objects.slice();
      } else {
        targets = [selectedObj];
      }

      // Se almeno UN target è già bloccato → azione = "sblocca tutto"; altrimenti "blocca tutto"
      const anyLocked = targets.some((o) => !!o.__locked || !!o.lockMovementX);
      const lock = !anyLocked;

      targets.forEach((obj) => {
        if (lock) {
          obj.set({
            lockMovementX: true,
            lockMovementY: true,
            lockScalingX: true,
            lockScalingY: true,
            lockRotation: true,
            lockSkewingX: true,
            lockSkewingY: true,
            hasControls: false,
            hoverCursor: "not-allowed",
            // IMPORTANTE: 'selectable' resta true così l'utente può ri-cliccare
            // sulla forma bloccata e usare il menu radiale per sbloccarla.
            selectable: true,
            evented: true
          });
          obj.__locked = true;
        } else {
          obj.set({
            lockMovementX: false,
            lockMovementY: false,
            lockScalingX: false,
            lockScalingY: false,
            lockRotation: false,
            lockSkewingX: false,
            lockSkewingY: false,
            hasControls: true,
            hoverCursor: null,
            selectable: true,
            evented: true
          });
          obj.__locked = false;
        }
        if (typeof obj.setCoords === "function") obj.setCoords();
      });

      const n = targets.length;
      flashToast(
        lock
          ? n > 1
            ? __t("toast.lock.lockedMany", { count: n }, `🔒 ${n} oggetti bloccati`)
            : __t("toast.lock.locked", null, "🔒 Oggetto bloccato")
          : n > 1
            ? __t("toast.lock.unlockedMany", { count: n }, `🔓 ${n} oggetti sbloccati`)
            : __t("toast.lock.unlocked", null, "🔓 Oggetto sbloccato")
      );

      // Aggiorna icona/tooltip del bottone lock per riflettere il nuovo stato della selezione
      if (typeof updateRadialLockButton === "function") updateRadialLockButton();

      canvas.renderAll();
      pushState();
      return;
    }

    // --- DELETE ---
    if (act === "delete") {
      if (!selectedObj) return;

      if (selectedObj.type === "group" && selectedObj._objects) {
        const count = selectedObj._objects.length;
        canvas.remove(selectedObj);
        flashToast(__t("toast.objects.deleted", { count: count }, `✅ ${count} oggetti eliminati`));
      } else if (selectedObj.type === "activeSelection" && selectedObj._objects) {
        const count = selectedObj._objects.length;
        selectedObj._objects.forEach((obj) => canvas.remove(obj));
        flashToast(__t("toast.objects.deleted", { count: count }, `✅ ${count} oggetti eliminati`));
      } else {
        canvas.remove(selectedObj);
      }

      selectedObj = null;
      if (radial) radial.style.display = "none";
      if (overlay) overlay.style.display = "none";

      canvas.renderAll();
      pushState();
      return;
    }

    if (act === "sliceCircle") {
      sliceCircleAction(e.altKey); // Alt+click = 2 metà
      return;
    }

    console.log("Azione non gestita:", act);
  });
}

// ============== COLOR POPUP ==============
function toHexSafe(c) {
  return toHex(c);
}

function toHex(colorStr) {
  if (!colorStr) return "#78a0ff";
  if (/^#([0-9a-f]{3,8})$/i.test(colorStr)) {
    return colorStr.length === 4
      ? "#" +
          colorStr
            .slice(1)
            .split("")
            .map((x) => x + x)
            .join("")
      : colorStr;
  }
  try {
    const cvs = document.createElement("canvas");
    cvs.width = cvs.height = 1;
    const ctx = cvs.getContext("2d");
    ctx.fillStyle = colorStr;
    const m = ctx.fillStyle.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/i);
    if (m) {
      return "#" + [m[1], m[2], m[3]].map((x) => ("0" + parseInt(x).toString(16)).slice(-2)).join("");
    }
    return ctx.fillStyle;
  } catch (e) {
    return "#78a0ff";
  }
}

if (colorInput) {
  // Coalescing: durante il drag la ruota spara molti eventi "input" al secondo;
  // li accorpiamo a UN solo ridisegno per frame (requestAnimationFrame). Niente
  // pushState/toast nel live → la singola tessera (e le multi-selezioni) non
  // laggano e l'undo non si riempie di stati intermedi. Il commit (un solo
  // pushState + un solo toast) avviene sul "change", a fine interazione.
  let _colorRetintRAF = 0;

  function _applyWheelColor() {
    _colorRetintRAF = 0;
    if (!selectedObj) return;
    const color = colorInput.value;
    try {
      // Singolo, multi-selezione o gruppo: stesso percorso (Fabric non propaga
      // 'fill' dal wrapper ai figli, quindi iteriamo sempre la lista).
      const targets =
        (selectedObj.type === "activeSelection" || selectedObj.type === "group") && Array.isArray(selectedObj._objects)
          ? selectedObj._objects
          : [selectedObj];

      targets.forEach((obj) => {
        if (!obj || typeof obj.set !== "function") return;
        // Tessera con texture in modalità "colora dalla ruota": TINGE la texture
        // (preserva grana e pori) invece di sostituirla con un colore piatto. Il
        // blocco tinto è in cache → in multi la stessa tinta si costruisce 1 volta.
        if (obj.__textureColorize && (obj.__textureId || (obj.fill && obj.fill.__texId))) {
          const id = obj.__textureId || obj.fill.__texId;
          const span = clampSpanMM(obj.__textureSpanMM || (obj.fill && obj.fill.__spanMM) || TEXTURE_SPAN_MM_DEFAULT);
          const entry = getRegisteredTexture(id);
          const neutral = entry && entry.img;
          if (neutral) {
            obj.set("fill", buildTexturePattern(id, neutral, span, { colorize: true, tint: color }));
            obj.__textureTint = color;
            obj.dirty = true;
          }
        } else {
          obj.set("fill", color);
        }
        if (typeof obj.setCoords === "function") obj.setCoords();
      });

      selectedObj.setCoords();
      canvas.renderAll();
      updateMeasureOverlay();
    } catch (err) {
      console.warn(err);
    }
  }

  // input → anteprima live coalizzata (max un update per frame), nessun commit.
  colorInput.addEventListener("input", () => {
    if (!selectedObj) return;
    if (!_colorRetintRAF) _colorRetintRAF = requestAnimationFrame(_applyWheelColor);
  });

  // change → fine interazione: applica subito l'ultimo colore (annullando un RAF
  // eventualmente pendente) e fa UN solo pushState + UN solo toast.
  colorInput.addEventListener("change", () => {
    if (_colorRetintRAF) {
      cancelAnimationFrame(_colorRetintRAF);
      _colorRetintRAF = 0;
    }
    if (!selectedObj) return;
    _applyWheelColor();
    flashToast(__t("toast.color.applied", null, "Colore applicato"));
    if (typeof pushState === "function" && !isApplyingSnapshot) pushState();
  });
}

if (openColorBtn) openColorBtn.addEventListener("click", () => colorInput?.click());

// ════════════════════════════════════════════════════════════════════
//  COLORI RAPIDI (pastiglie tonde del popup colore)
//  >>> PER AGGIUNGERE/TOGLIERE COLORI: modifica SOLO questo array. <
//  Accetta qualsiasi formato CSS valido: hex (#rrggbb o #rgb),
//  rgb()/rgba(), hsl()/hsla(), oppure il nome ("tomato"). Vengono
//  convertiti da soli in hex e il bordo scuro coordinato si genera in
//  automatico — tu aggiungi solo la stringa del colore.
//  Aggiungi quante righe vuoi: oltre 2 righe compare la scrollbar.
// ════════════════════════════════════════════════════════════════════
const QUICK_COLORS = [
  "#d2ae6d", // Beige classico
  "#fff0e0", // Beige chiaro
  "#fbe7bd", // Beige medio
  "#f7af6d", // Beige intermedio
  "#ffedab", // Beige medio 2
  "#fefdbe",
  "#994a2e",
  "#8d3b1f",
  "#723722", // Marrone classico
  "#53331b", // Marrone 
  "#03508d", // Blu medio
  "#323e6e", // Blu scuro
  "#5e217d", // Blu scurissimo
  "#0164d4", // Blu Italia
  "#3cbbd4", // Azzurro
  "#0599e6", // Azzurro medio
  "#fa944c", // Arancione classico
  "#f2763b", // Arancione scuro
  "#d86303", // Arancione nemo
  "#e58c07", // Arancione pinguini 
  "#fdee72", // Giallo
  "#fccf01", // Giallo classico
  "#f6b003", // Giallo pinguini
  "#f3c137", // Giallo ape
  "#2d754a", // Verde classico
  "#98d263", // Verde acido
  "#1b3612", // Verde oliva
  "#030806", // Verde scurissimo
  "#b22b3b", // Rosso 
  "#96192e", // Rosso corallo 
  "#c2213c", // Rosso cuore
  "#a11b2c", // Rosso coccinella
  "#c4c4c6", // Grigio balena
  "#c9c9c9", // Grigio chiaro
  "#b776a2", // Lilla
  "#da7a8b", // Rosa classico
  "#5e217d", // Viola
  "#ff0000",
  "#00a000",
  "#0078ff",
  "#ff8c00",
  "#a000ff",
  "#8b5a2b",
  "#00ffff",
  "#ff00ff",
  "#ffff00",
  // Esempi negli altri formati (puoi scriverli liberamente cosi'):
  // "rgb(46, 204, 113)",
  // "hsl(210, 90%, 55%)",
  // "tomato",
];

// Scurisce un hex #rrggbb del fattore indicato (0..1) per il bordino coordinato.
function _qcDarken(hex, factor) {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) return "rgba(0,0,0,0.45)";
  const n = parseInt(m[1], 16);
  const r = Math.round(((n >> 16) & 255) * (1 - factor));
  const g = Math.round(((n >> 8) & 255) * (1 - factor));
  const b = Math.round((n & 255) * (1 - factor));
  return "#" + [r, g, b].map((x) => ("0" + x.toString(16)).slice(-2)).join("");
}

// Genera i pallini tondi dentro #quickColors a partire da QUICK_COLORS.
function buildQuickColors() {
  if (!quickColorsContainer) return;
  quickColorsContainer.innerHTML = "";
  const frag = document.createDocumentFragment();
  QUICK_COLORS.forEach((raw) => {
    const hex = toHex(raw); // qualsiasi formato → #rrggbb (per <input type=color>)
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "smallColor";
    btn.dataset.color = hex;
    btn.title = String(raw); // tooltip col valore originale come lo hai scritto
    btn.setAttribute("aria-label", String(raw));
    btn.style.background = hex;
    btn.style.borderColor = _qcDarken(hex, 0.45);
    frag.appendChild(btn);
  });
  quickColorsContainer.appendChild(frag);
}

buildQuickColors();

// UN solo listener (delega sul contenitore): funziona anche per i colori
// che aggiungerai a QUICK_COLORS, senza dover ri-registrare nulla.
if (quickColorsContainer) {
  quickColorsContainer.addEventListener("click", (ev) => {
    const btn = ev.target.closest(".smallColor");
    if (!btn || !quickColorsContainer.contains(btn)) return;
    const c = btn.dataset.color;
    if (!c || !colorInput) return;
    colorInput.value = c;
    // input → anteprima; change → commit (pushState/toast). Senza il 'change'
    // la pastiglia non finirebbe piu' nell'undo, ora che il commit e' li'.
    colorInput.dispatchEvent(new Event("input", { bubbles: true }));
    colorInput.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

document.addEventListener("mousedown", (e) => {
  if (colorPopup && colorPopup.style.display === "block") {
    if (!e.target.closest || (!e.target.closest("#colorPopup") && !e.target.closest("[data-action='copyColor']"))) {
      colorPopup.style.display = "none";
    }
  }
});

// Radial segue il pan del workspace + drag live
window.addEventListener("mousemove", () => {
  if (panning && radial.style.display === "block") {
    positionRadial();
  }
});

// Aggiornamento LIVE durante drag/scaling/rotazione — già gestito nel blocco canonico sopra

// ============== TEXTURE: SISTEMA TESSERE (registro + grana + ricolora) ======
// Riscrittura completa del sistema texture del CANVAS PRINCIPALE. Obiettivi:
//  - RAM bassa e stabile. Ogni immagine-texture vive UNA sola volta in memoria
//    in un REGISTRO condiviso (ridimensionata a un tetto massimo); le tessere
//    puntano al registro con un id corto. Niente piu' blocco 2x2 specchiato
//    (pesava 4x) ne' dataURL per-tessera negli snapshot.
//  - Niente SPECCHIATURA: l'immagine si usa COSI' COM'E', affiancata (repeat).
//  - Lo slider "Grana" decide quanti mm occupa l'immagine sulla tessera (zoom
//    della texture) via patternTransform: drag fluido, nessuna ricostruzione.
//  - "Colora dalla ruota": VERA ricolorazione dei pixel (modello HSL). Mantiene
//    la struttura (luci/ombre/venature/grana = luminanza) e sostituisce tinta e
//    saturazione col colore scelto. Bianco => marmo bianco; rosso => marmo
//    rosso. Niente piu' "grigino" da multiply.
//  - Salvataggio/Undo leggerissimi: il Pattern NON serializza piu' la sorgente
//    (override toObject -> emette un colore segnaposto). Le immagini si salvano
//    UNA volta sola nel registro del file; le tessere salvano solo l'id+metadati.
// Tutto su Canvas2D puro -> valido da Fabric 5.1.0 a 5.3.0.

const TEXTURE_SPAN_MM_DEFAULT = 14; // mm "occupati" dall'immagine sulla tessera
const TEXTURE_SPAN_MM_MIN = 4;
const TEXTURE_SPAN_MM_MAX = 60;
// Tetto di risoluzione della sorgente in memoria: ogni texture viene ridotta a
// questo lato massimo UNA volta sola. E' la leva principale del "peso" texture:
// abbassa RAM e velocizza il render senza impatto visibile (sulla tessera si
// vede comunque solo una piccola porzione). Tunabile.
const TEXTURE_MAX_SRC_PX = 512;

function clampSpanMM(v) {
  v = parseFloat(v);
  if (!Number.isFinite(v)) v = TEXTURE_SPAN_MM_DEFAULT;
  return Math.min(TEXTURE_SPAN_MM_MAX, Math.max(TEXTURE_SPAN_MM_MIN, v));
}

// ---- REGISTRO TEXTURE (dedup + RAM) ----------------------------------------
// id -> { dataURL, img } dove img e' la sorgente NEUTRA gia' ridimensionata
// (canvas o <img>) condivisa da TUTTE le tessere che usano quella texture.
const _texRegistry = new Map();

// FNV-1a a 32 bit -> id corto e stabile per la stessa immagine (stesso dataURL
// = stesso id, quindi una texture usata da 500 tessere e' UN solo id).
function _texHash(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return "tx" + h.toString(36);
}

// Riduce una sorgente al lato massimo TEXTURE_MAX_SRC_PX (una sola volta). Se e'
// gia' piccola la restituisce intatta.
function _downscaleSource(srcEl) {
  const w = srcEl.naturalWidth || srcEl.width || 1;
  const h = srcEl.naturalHeight || srcEl.height || 1;
  const max = Math.max(w, h);
  if (max <= TEXTURE_MAX_SRC_PX) return srcEl;
  const k = TEXTURE_MAX_SRC_PX / max;
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(w * k));
  c.height = Math.max(1, Math.round(h * k));
  const cx = c.getContext("2d");
  cx.imageSmoothingEnabled = true;
  cx.imageSmoothingQuality = "high";
  cx.drawImage(srcEl, 0, 0, c.width, c.height);
  return c;
}

// Registra (o ritrova) una texture dal suo dataURL. Ritorna l'id condiviso.
function registerTexture(dataURL, imgEl) {
  if (!dataURL) return null;
  const id = _texHash(dataURL);
  let entry = _texRegistry.get(id);
  if (!entry) {
    entry = { dataURL: dataURL, img: imgEl ? _downscaleSource(imgEl) : null };
    _texRegistry.set(id, entry);
  } else if (!entry.img && imgEl) {
    entry.img = _downscaleSource(imgEl);
  }
  return id;
}

function getRegisteredTexture(id) {
  return id ? _texRegistry.get(id) || null : null;
}

// Garantisce che l'immagine di un id sia caricata (post-load potrebbe essere
// solo dataURL). Chiama cb(img|null).
function ensureRegisteredImage(id, cb) {
  const e = getRegisteredTexture(id);
  if (!e) {
    cb && cb(null);
    return;
  }
  if (e.img) {
    cb && cb(e.img);
    return;
  }
  fabric.util.loadImage(e.dataURL, function (img) {
    if (img) e.img = _downscaleSource(img);
    cb && cb(e.img || null);
  });
}

// Semina il registro dai dati salvati nel file: { id: dataURL }.
function seedTextureRegistry(map) {
  if (!map || typeof map !== "object") return;
  Object.keys(map).forEach((id) => {
    if (!_texRegistry.has(id)) _texRegistry.set(id, { dataURL: map[id], img: null });
  });
}

// Raccoglie il registro delle texture EFFETTIVAMENTE usate dagli oggetti dati,
// per salvarlo UNA sola volta nel file. Ritorna { id: dataURL }. Chiamata sia da
// renderer (salvataggio manuale) sia da autoSave.
function collectTextureRegistry(objects) {
  const out = {};
  (objects || []).forEach((o) => {
    const id = o && (o.__textureId || (o.fill && o.fill.__texId));
    if (id && _texRegistry.has(id)) out[id] = _texRegistry.get(id).dataURL;
  });
  return out;
}

// ---- RICOLORAZIONE VERA (HSL) ----------------------------------------------
// Mantiene la luminanza per-pixel (struttura: grana, venature, ombre) e applica
// tinta (H) e saturazione (S) del colore scelto. Per-pixel su immagine PICCOLA
// (<= TEXTURE_MAX_SRC_PX): pochi ms, fatto UNA volta per (texture,tinta) e messo
// in cache. Bianco (S=0) -> grayscale -> marmo bianco con tutta la struttura.
function _hexToRgb(hex) {
  let s = String(hex || "#808080").replace("#", "");
  if (s.length === 3) s = s[0] + s[0] + s[1] + s[1] + s[2] + s[2];
  const n = parseInt(s, 16);
  if (!Number.isFinite(n)) return { r: 128, g: 128, b: 128 };
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

function _rgbToHsl(r, g, b) {
  r /= 255;
  g /= 255;
  b /= 255;
  const mx = Math.max(r, g, b);
  const mn = Math.min(r, g, b);
  let h = 0;
  let s = 0;
  const l = (mx + mn) / 2;
  const d = mx - mn;
  if (d > 0) {
    s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
    if (mx === r) h = (g - b) / d + (g < b ? 6 : 0);
    else if (mx === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h /= 6;
  }
  return { h: h, s: s, l: l };
}

function _hue2rgb(p, q, t) {
  if (t < 0) t += 1;
  if (t > 1) t -= 1;
  if (t < 1 / 6) return p + (q - p) * 6 * t;
  if (t < 1 / 2) return q;
  if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
  return p;
}

// Guadagno tunabile (0..1): quanto "rilievo" della texture (venature, pori,
// grana) resta visibile attorno al tono scelto. 1 = rilievo pieno, 0 = colore
// piatto. 0.85 = struttura ben presente ma non aggressiva.
const _TEX_RECOLOR_RELIEF = 0.85;

// ═════════════════════════════════════════════════════════════════════════
// OPACITA' TESSERA — una tessera NON deve mai far trasparire cio' che le sta
// sotto (carta di sfondo, immagine, acquerello, penna): la trasparenza
// falserebbe il suo colore. Alcune texture hanno pixel non opachi: EVA
// (alpha ~244-252), eventuali PNG da file con canale alpha. Qui rileviamo
// l'alpha e appiattiamo la sorgente del pattern su un FONDO PIENO opaco, cosi'
// il pattern finale e' sempre opaco. Le texture gia' opache passano invariate
// (nessun costo, nessun cambiamento d'aspetto). Tutto Canvas2D puro: nessuna
// API Fabric -> valido da Fabric 5.1.0 a 5.3.0.
// ═════════════════════════════════════════════════════════════════════════

// true se la sorgente ha anche un solo pixel con alpha < 255. Cachato per id
// (la scansione completa dei pixel si fa una sola volta per texture).
const _texHasAlphaCache = new Map();
function _sourceHasAlpha(srcEl, id) {
  if (id != null && _texHasAlphaCache.has(id)) return _texHasAlphaCache.get(id);
  let has = false;
  try {
    const w = srcEl.naturalWidth || srcEl.width || 1;
    const h = srcEl.naturalHeight || srcEl.height || 1;
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    const cx = c.getContext("2d", { willReadFrequently: true });
    cx.drawImage(srcEl, 0, 0, w, h);
    const d = cx.getImageData(0, 0, w, h).data;
    for (let i = 3; i < d.length; i += 4) {
      if (d[i] < 255) {
        has = true;
        break;
      }
    }
  } catch (e) {
    has = false; // cross-origin: pixel non leggibili -> la trattiamo come opaca
  }
  if (id != null) _texHasAlphaCache.set(id, has);
  return has;
}

// Colore medio (pesato per alpha) della sorgente, come "#rrggbb". E' il fondo
// neutro usato per le texture con alpha quando la ruota colore e' OFF:
// appiattisce sul colore PROPRIO della texture, senza introdurre tinte
// estranee (es. EVA neutra -> grigio della gomma). Cachato per id.
const _texAvgColorCache = new Map();
function _averageTextureColor(srcEl, id) {
  if (id != null && _texAvgColorCache.has(id)) return _texAvgColorCache.get(id);
  let hex = "#b8b8b8";
  try {
    const w = srcEl.naturalWidth || srcEl.width || 1;
    const h = srcEl.naturalHeight || srcEl.height || 1;
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    const cx = c.getContext("2d", { willReadFrequently: true });
    cx.drawImage(srcEl, 0, 0, w, h);
    const d = cx.getImageData(0, 0, w, h).data;
    let r = 0;
    let g = 0;
    let b = 0;
    let wsum = 0;
    for (let i = 0; i < d.length; i += 4) {
      const a = d[i + 3] / 255;
      if (a <= 0) continue;
      r += d[i] * a;
      g += d[i + 1] * a;
      b += d[i + 2] * a;
      wsum += a;
    }
    if (wsum > 0) {
      const to2 = (v) => Math.max(0, Math.min(255, Math.round(v / wsum))).toString(16).padStart(2, "0");
      hex = "#" + to2(r) + to2(g) + to2(b);
    }
  } catch (e) {}
  if (id != null) _texAvgColorCache.set(id, hex);
  return hex;
}

// Appiattisce srcEl su un fondo pieno opaco bgHex -> nuova canvas opaca.
function _flattenOpaque(srcEl, bgHex) {
  const w = srcEl.naturalWidth || srcEl.width || 1;
  const h = srcEl.naturalHeight || srcEl.height || 1;
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const cx = c.getContext("2d");
  cx.fillStyle = bgHex || "#b8b8b8";
  cx.fillRect(0, 0, w, h);
  cx.drawImage(srcEl, 0, 0, w, h);
  return c;
}

// Sorgente NEUTRA resa opaca (texture con alpha, ruota colore OFF). Le texture
// gia' opache passano invariate. Cachata per id. Quando la ruota e' ON ci pensa
// invece _recolorSource ad appiattire sulla tinta scelta.
const _texNeutralOpaqueCache = new Map();
function _neutralOpaqueSource(id, neutralImg) {
  if (!_sourceHasAlpha(neutralImg, id)) return neutralImg;
  if (id != null && _texNeutralOpaqueCache.has(id)) return _texNeutralOpaqueCache.get(id);
  const flat = _flattenOpaque(neutralImg, _averageTextureColor(neutralImg, id));
  if (id != null) _texNeutralOpaqueCache.set(id, flat);
  return flat;
}

// Restituisce un canvas ricolorato. Modello: la texture fornisce la STRUTTURA
// (rilievo = scostamento della luminanza dal proprio valor medio); il colore
// scelto fornisce tinta (H), saturazione (S) e soprattutto TONO BASE (L). Cosi'
// la ruota controlla davvero il materiale:
//   bianco         -> marmo chiaro con venature tenui  (NON grigio scuro)
//   blu            -> marmo blu con rilievo
//   azzurro chiaro -> marmo azzurro chiaro (la luminosita' del colore conta!)
//   nero           -> pietra scura con rilievo
// Differenza chiave col vecchio metodo: prima si teneva la L del PIXEL e si
// buttava via la L del colore -> il bianco (S=0) diventava la scala di grigi
// della sorgente, cioe' grigio/scuro su un blu. Ora il tono base e' quello del
// colore. Se cross-origin (getImageData fallisce) restituisce il disegno intatto.
function _recolorSource(srcEl, tintHex) {
  const w = srcEl.naturalWidth || srcEl.width || 1;
  const h = srcEl.naturalHeight || srcEl.height || 1;
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const cx = c.getContext("2d", { willReadFrequently: true });
  cx.drawImage(srcEl, 0, 0, w, h);
  let img;
  try {
    img = cx.getImageData(0, 0, w, h);
  } catch (e) {
    return c; // cross-origin: niente ricolorazione, ma nessun crash
  }
  const d = img.data;

  // Colore scelto -> HSL: H,S = colore; Lt = tono base del materiale.
  const trgb = _hexToRgb(tintHex);
  const thsl = _rgbToHsl(trgb.r, trgb.g, trgb.b);
  const H = thsl.h;
  const S = thsl.s;
  const Lt = thsl.l;

  // 1a passata: luminanza media (solo pixel non trasparenti), per centrare il
  // rilievo. Sui JPEG opachi e' semplicemente la media dell'intera immagine;
  // sui PNG con alpha (texture/venature procedurali) ignora lo sfondo vuoto.
  let sum = 0;
  let n = 0;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] < 8) continue;
    sum += (0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]) / 255;
    n++;
  }
  const meanL = n ? sum / n : 0.5;

  // 2a passata: L finale = tono base del colore + rilievo della texture.
  let hasAlpha = false;
  for (let i = 0; i < d.length; i += 4) {
    const L = (0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]) / 255;
    let Lf = Lt + (L - meanL) * _TEX_RECOLOR_RELIEF;
    if (Lf < 0) Lf = 0;
    else if (Lf > 1) Lf = 1;
    let r;
    let g;
    let b;
    if (S === 0) {
      r = g = b = Lf;
    } else {
      const q = Lf < 0.5 ? Lf * (1 + S) : Lf + S - Lf * S;
      const p = 2 * Lf - q;
      r = _hue2rgb(p, q, H + 1 / 3);
      g = _hue2rgb(p, q, H);
      b = _hue2rgb(p, q, H - 1 / 3);
    }
    d[i] = Math.round(r * 255);
    d[i + 1] = Math.round(g * 255);
    d[i + 2] = Math.round(b * 255);
    if (d[i + 3] < 255) hasAlpha = true; // canale alpha (d[i+3]) lasciato qui invariato
  }
  cx.putImageData(img, 0, 0);

  // La tessera deve restare OPACA: dove la texture e' trasparente facciamo
  // vedere la TINTA piena, non lo sfondo del foglio. Appiattiamo la
  // ricolorazione su un fondo = colore scelto. Se la texture e' gia' opaca
  // (caso piu' comune) restituiamo il canvas com'e', senza lavoro extra.
  if (!hasAlpha) return c;
  const out = document.createElement("canvas");
  out.width = w;
  out.height = h;
  const ox = out.getContext("2d");
  ox.fillStyle = tintHex;
  ox.fillRect(0, 0, w, h);
  ox.drawImage(c, 0, 0);
  return out;
}

// Cache delle sorgenti ricolorate, chiave: id|tinta. Cosi' la STESSA tinta su
// centinaia di tessere si calcola UNA volta sola. Bounded con scarto LRU.
const _TEX_RECOLOR_CACHE_MAX = 48;
const _texRecolorCache = new Map();

function _getColorizedSource(id, neutralImg, colorize, tint) {
  if (!colorize || !tint || !neutralImg) return neutralImg;
  const key = id + "|" + String(tint).toLowerCase();
  let canv = _texRecolorCache.get(key);
  if (canv) {
    _texRecolorCache.delete(key);
    _texRecolorCache.set(key, canv); // tocco -> piu' recente (LRU)
    return canv;
  }
  canv = _recolorSource(neutralImg, tint);
  _texRecolorCache.set(key, canv);
  if (_texRecolorCache.size > _TEX_RECOLOR_CACHE_MAX) {
    _texRecolorCache.delete(_texRecolorCache.keys().next().value);
  }
  return canv;
}

// ---- PATTERN ---------------------------------------------------------------
// Override di toObject sul Pattern: NON serializza la sorgente (canvas/img, che
// pesa MB). Emette un colore pieno SEGNAPOSTO; alla riapertura/undo
// rebuildTextureFill rimette la texture vera dal registro. E' questo che azzera
// l'esplosione di RAM in salvataggi/autosave/undo.
function _patternToColorStub() {
  return this.__tint || "#cfcfd0";
}

// Costruisce il fabric.Pattern. id = chiave registro; neutralImg = sorgente
// neutra ridimensionata; spanMM = grana; opts = { colorize, tint }.
function buildTexturePattern(id, neutralImg, spanMM, opts) {
  spanMM = clampSpanMM(spanMM);
  opts = opts || {};
  const colorize = !!opts.colorize;
  const tint = opts.tint || null;
  let src = _getColorizedSource(id, neutralImg, colorize, tint) || neutralImg;
  // Tessera sempre opaca: se la ruota colore e' OFF ma la texture ha alpha,
  // appiattiamo sul suo colore medio (quando e' ON ci pensa _recolorSource ad
  // appiattire sulla tinta). Cosi' lo sfondo non traspare mai dalla tessera.
  if (!colorize) src = _neutralOpaqueSource(id, src);
  const sw = (src && (src.naturalWidth || src.width)) || 1;
  const scale = mm2px(spanMM) / sw;
  const pattern = new fabric.Pattern({
    source: src,
    repeat: "repeat",
    patternTransform: [scale, 0, 0, scale, 0, 0]
  });
  // Metadati leggeri (NON serializzati come sorgente): id registro, grana e
  // stato colorazione. Servono a salvataggio, slider grana e ruota colore.
  pattern.__texId = id;
  pattern.__spanMM = spanMM;
  pattern.__colorize = colorize;
  pattern.__tint = colorize ? tint : null;
  pattern.toObject = _patternToColorStub; // <- chiave anti-RAM
  return pattern;
}

// Applica una texture a un SINGOLO oggetto. Registra l'immagine (dedup) e crea
// un pattern dedicato (grana indipendente per oggetto). Firma invariata rispetto
// al vecchio sistema: (obj, srcEl, dataURL[, spanMM, colorize, tint]).
function applyTextureToObject(obj, srcEl, dataURL, spanMM, colorize, tint) {
  if (!obj || typeof obj.set !== "function") return false;
  spanMM = clampSpanMM(spanMM != null ? spanMM : obj.__textureSpanMM || TEXTURE_SPAN_MM_DEFAULT);
  // Eredita lo stato "colora dalla ruota" se non specificato.
  if (colorize == null) colorize = !!obj.__textureColorize;
  if (tint == null) {
    const wheel = document.getElementById("colorInput");
    tint = obj.__textureTint || (wheel && wheel.value) || "#78a0ff";
  }
  const id = registerTexture(dataURL, srcEl);
  const entry = getRegisteredTexture(id);
  const neutral = (entry && entry.img) || srcEl;
  // Memorizza il colore pieno originale (solo la prima volta) così "togli
  // texture" può ripristinarlo invece di lasciare la tessera senza colore.
  if (typeof obj.fill === "string" && obj.__preTextureFill == null) obj.__preTextureFill = obj.fill;
  obj.set("fill", buildTexturePattern(id, neutral, spanMM, { colorize: !!colorize, tint: tint }));
  obj.__textureId = id;
  obj.__textureSpanMM = spanMM;
  obj.__textureColorize = !!colorize;
  obj.__textureTint = colorize ? tint : obj.__textureTint || null;
  obj.__textureDataURL = null; // legacy: non piu' usato per-tessera
  obj.dirty = true;
  return true;
}

// Ricostruisce il fill texture di un oggetto dai suoi metadati (__textureId +
// grana + colorize/tint). Usata dopo loadFromJSON (apertura progetto e undo/redo)
// perche' il Pattern non serializza piu' la sorgente. Backward-compatible coi
// vecchi file (solo __textureDataURL per-tessera, nessun id).
function rebuildTextureFill(obj, done) {
  if (!obj) {
    done && done(false);
    return;
  }
  let id = obj.__textureId || (obj.fill && obj.fill.__texId) || null;
  const spanMM = clampSpanMM(obj.__textureSpanMM || (obj.fill && obj.fill.__spanMM) || TEXTURE_SPAN_MM_DEFAULT);
  const colorize = !!obj.__textureColorize;
  const tint = obj.__textureTint || null;
  // Vecchi file: dataURL per-tessera, nessun id -> registralo ora.
  if (!id && obj.__textureDataURL) id = registerTexture(obj.__textureDataURL, null);
  if (!id) {
    done && done(false);
    return;
  }
  ensureRegisteredImage(id, function (img) {
    if (!img) {
      done && done(false);
      return;
    }
    obj.set("fill", buildTexturePattern(id, img, spanMM, { colorize: colorize, tint: tint }));
    obj.__textureId = id;
    obj.__textureSpanMM = spanMM;
    obj.__textureColorize = colorize;
    obj.__textureTint = colorize ? tint : obj.__textureTint || null;
    obj.__textureDataURL = null;
    obj.dirty = true;
    done && done(true);
  });
}

// Ripristina sul CLONE la texture che clone()/toObject() ha perso.
// PERCHE': il fabric.Pattern delle texture ha toObject() sovrascritto (emette
// solo un colore segnaposto, anti-RAM). Quindi qualsiasi obj.clone() -> il clone
// nasce con fill = quel colore, NON la texture. Tutti gli export che clonano gli
// oggetti per ricomporli su un canvas temporaneo (PDF modi "solo forme", SVG
// "riempito") perdono cosi' la texture. Qui rimettiamo sul clone un Pattern che
// riusa la STESSA sorgente VIVA dell'originale (gia' ridimensionata e, se la
// ruota era attiva, gia' ricolorata) e lo STESSO patternTransform -> resa
// pixel-fedele a cio' che si vede a schermo. Sincrono, niente caricamenti.
// NON tocca l'oggetto reale: agisce solo sul clone. Esposto su window per
// svgExport.js. Valido Fabric 5.1.0 -> 5.3.0 (fabric.Pattern, toLive immutato).
function restoreTextureOnClone(orig, clone) {
  if (!orig || !clone) return false;
  const live = orig.fill;
  // Solo se l'originale ha DAVVERO una texture (Pattern), non un colore pieno.
  if (!live || typeof live !== "object" || !(live.__texId || live.source)) return false;

  let src = live.source || null;
  // Fallback dal registro se la sorgente viva mancasse (caso raro).
  if (!src && live.__texId) {
    const e = getRegisteredTexture(live.__texId);
    src = e && e.img;
  }
  if (!src) return false;

  // Dimensioni della sorgente ricolorata viva (canvas o img).
  const sw = (src.naturalWidth || src.width) || 1;
  const sh = (src.naturalHeight || src.height) || 1;

  // --- GRANA: la scala del tassello vive nel patternTransform a schermo ----
  // Fabric 5.x IGNORA patternTransform in Pattern.toSVG (lo legge solo in
  // import da SVG) e disegna il tassello a grandezza PIENA della sorgente ->
  // nell'SVG la grana appariva "al massimo zoom". Per riportare nell'export
  // la stessa grana del canvas in TUTTI i formati (SVG e raster), invece di
  // passare la scala via patternTransform la "cuociamo" in una sorgente gia'
  // ridimensionata alla dimensione reale del tassello e usiamo trasformazione
  // identita'. Per il raster il risultato resta identico a prima (stessa
  // dimensione di tassello), per l'SVG diventa finalmente corretto.
  let sx = 1, sy = 1;
  if (Array.isArray(live.patternTransform) && live.patternTransform.length >= 4) {
    sx = live.patternTransform[0] || 1;
    sy = live.patternTransform[3] || 1;
  } else if (live.__spanMM != null && typeof mm2px === "function") {
    const sp = typeof clampSpanMM === "function" ? clampSpanMM(live.__spanMM) : live.__spanMM;
    sx = sy = mm2px(sp) / sw;
  }

  // Lato del tassello in pixel canvas = identico a come appare in Mosaica.
  const tileW = Math.max(1, Math.round(sw * Math.abs(sx)));
  const tileH = Math.max(1, Math.round(sh * Math.abs(sy)));

  let bakedSrc = src;
  // Cuociamo solo se la scala cambia davvero (a 1:1 si riusa la sorgente).
  if (tileW !== sw || tileH !== sh) {
    try {
      const cnv = document.createElement("canvas");
      cnv.width = tileW;
      cnv.height = tileH;
      const cx = cnv.getContext("2d");
      cx.imageSmoothingEnabled = true;
      if ("imageSmoothingQuality" in cx) cx.imageSmoothingQuality = "high";
      cx.drawImage(src, 0, 0, sw, sh, 0, 0, tileW, tileH);
      bakedSrc = cnv;
    } catch (e) {
      bakedSrc = src; // fallback: meglio grana imperfetta che nessuna texture
    }
  }

  // NIENTE patternTransform: la scala e' gia' nella sorgente cotta.
  const patt = new fabric.Pattern({ source: bakedSrc, repeat: live.repeat || "repeat" });

  // Metadati leggeri (coerenza con il resto del sistema; non influenzano il
  // render perche' src e' gia' pronta). NB: NON sovrascriviamo toObject sul
  // clone: il canvas temporaneo viene buttato subito dopo l'export.
  patt.__texId = live.__texId || orig.__textureId || null;
  patt.__spanMM = live.__spanMM || orig.__textureSpanMM || null;
  patt.__colorize = !!live.__colorize;
  patt.__tint = live.__tint || null;

  clone.set("fill", patt);
  clone.__textureId = patt.__texId;
  clone.__textureSpanMM = patt.__spanMM;
  clone.__textureColorize = patt.__colorize;
  clone.__textureTint = patt.__tint;
  clone.dirty = true;
  return true;
}
window.restoreTextureOnClone = restoreTextureOnClone;

// Ricostruzione texture IN BLOCCO dopo loadFromJSON (apertura progetto da file).
// PERCHE' SERVE: in apertura le immagini del registro sono solo SEMINATE
// (dataURL, img=null). Il vecchio codice chiamava rebuildTextureFill() per OGNI
// tessera dentro un forEach -> (a) ogni tessera lanciava un proprio loadImage
// asincrono, anche tessere che condividono la STESSA texture (nessun dedup degli
// id mentre il primo load e' ancora in volo), e (b) ogni callback faceva un
// canvas.renderAll() COMPLETO -> N render su N tessere = blocco di decine di
// secondi su mosaici grandi. Questa versione:
//   1. raggruppa le tessere per id texture,
//   2. carica l'immagine di OGNI id UNA sola volta,
//   3. costruisce i pattern per tutte le sue tessere (sorgente ricolorata in
//      cache per (id,tinta)),
//   4. fa UN SOLO render finale.
// onProgress(frac 0..1) e' opzionale (barra di caricamento). done(applied) idem.
function rebuildAllTextureFills(objects, onProgress, done) {
  const textured = (objects || []).filter(
    (o) => o && (o.__textureId || (o.fill && o.fill.__texId) || o.__textureDataURL)
  );
  if (!textured.length) {
    if (onProgress) try { onProgress(1); } catch (e) {}
    if (done) done(0);
    return;
  }

  // Raggruppa per id texture (immagine condivisa). Vecchi file con solo
  // __textureDataURL per-tessera -> li registriamo ora e ottengono un id.
  const byId = new Map();
  textured.forEach((o) => {
    let id = o.__textureId || (o.fill && o.fill.__texId) || null;
    if (!id && o.__textureDataURL) id = registerTexture(o.__textureDataURL, null);
    if (!id) return;
    o.__textureId = id;
    if (!byId.has(id)) byId.set(id, []);
    byId.get(id).push(o);
  });

  const ids = Array.from(byId.keys());
  const total = ids.length;
  if (!total) {
    if (onProgress) try { onProgress(1); } catch (e) {}
    if (done) done(0);
    return;
  }

  let completed = 0;
  let applied = 0;

  ids.forEach((id) => {
    ensureRegisteredImage(id, function (img) {
      const list = byId.get(id) || [];
      if (img) {
        list.forEach((o) => {
          const spanMM = clampSpanMM(
            o.__textureSpanMM || (o.fill && o.fill.__spanMM) || TEXTURE_SPAN_MM_DEFAULT
          );
          const colorize = !!o.__textureColorize;
          const tint = o.__textureTint || null;
          o.set("fill", buildTexturePattern(id, img, spanMM, { colorize: colorize, tint: tint }));
          o.__textureSpanMM = spanMM;
          o.__textureColorize = colorize;
          o.__textureTint = colorize ? tint : o.__textureTint || null;
          o.__textureDataURL = null;
          o.dirty = true;
          applied++;
        });
      }
      completed++;
      if (onProgress) {
        try { onProgress(completed / total); } catch (e) {}
      }
      if (completed === total) {
        canvas.requestRenderAll(); // UN SOLO render, a fine ciclo
        if (done) done(applied);
      }
    });
  });
}

// Oggetti selezionati che hanno una texture. Gestisce singolo, multi-selezione
// (activeSelection) e gruppi -> grana/colorazione agiscono su TUTTE le tessere.
function _selectedTexturedObjects() {
  const a = canvas.getActiveObject();
  if (!a) return [];
  const list =
    (a.type === "activeSelection" || a.type === "group") && Array.isArray(a._objects) ? a._objects : [a];
  return list.filter((o) => o && (o.__textureId || (o.fill && o.fill.source && o.fill.toLive)));
}

// Attiva/disattiva la ricolorazione dalla ruota per tutte le tessere selezionate
// con texture. ON -> ricolora HSL col colore corrente; OFF -> colori originali.
function setTextureColorizeForActive(enabled) {
  const targets = _selectedTexturedObjects();
  let changed = 0;
  const wheel = document.getElementById("colorInput");
  targets.forEach((obj) => {
    const id = obj.__textureId || (obj.fill && obj.fill.__texId);
    if (!id) return;
    const span = clampSpanMM(obj.__textureSpanMM || (obj.fill && obj.fill.__spanMM) || TEXTURE_SPAN_MM_DEFAULT);
    const tint = obj.__textureTint || (wheel && wheel.value) || "#78a0ff";
    const apply = function (img) {
      if (!img) return;
      obj.set("fill", buildTexturePattern(id, img, span, { colorize: !!enabled, tint: tint }));
      obj.__textureColorize = !!enabled;
      obj.__textureTint = enabled ? tint : obj.__textureTint || null;
      obj.dirty = true;
      canvas.requestRenderAll();
    };
    const entry = getRegisteredTexture(id);
    if (entry && entry.img) apply(entry.img);
    else ensureRegisteredImage(id, apply);
    changed++;
  });
  if (changed) {
    canvas.requestRenderAll();
    if (typeof pushState === "function" && !isApplyingSnapshot) pushState();
  }
  return changed;
}

// Slider grana: aggiorna SOLO la scala del pattern (patternTransform) degli
// oggetti selezionati con texture -> niente ricostruzione, drag fluido.
function setTextureGrainForActive(spanMM) {
  spanMM = clampSpanMM(spanMM);
  const targets = _selectedTexturedObjects();
  let changed = 0;
  targets.forEach((obj) => {
    const p = obj.fill;
    obj.__textureSpanMM = spanMM;
    if (!p || !p.source) return;
    const sw = p.source.naturalWidth || p.source.width || 1;
    const s = mm2px(spanMM) / sw;
    p.patternTransform = [s, 0, 0, s, 0, 0];
    p.__spanMM = spanMM;
    obj.dirty = true;
    changed++;
  });
  if (changed) canvas.requestRenderAll();
  return changed;
}

// Mostra/aggiorna il blocco "Texture" nell'inspector. Resta visibile anche in
// MULTI-selezione: appare se almeno una tessera selezionata ha una texture.
function updateTextureGrainPanel() {
  const block = document.getElementById("inspectorTextureBlock");
  const slider = document.getElementById("textureGrainSlider");
  const valEl = document.getElementById("textureGrainValue");
  const colorChk = document.getElementById("textureColorizeChk");
  if (!block) return;

  const textured = _selectedTexturedObjects();
  if (textured.length === 0) {
    block.style.display = "none";
    return;
  }

  block.style.display = "block";
  const ref = textured[0];
  const span = clampSpanMM(ref.__textureSpanMM || (ref.fill && ref.fill.__spanMM) || TEXTURE_SPAN_MM_DEFAULT);
  if (slider && document.activeElement !== slider) slider.value = String(span);
  if (valEl) valEl.textContent = span.toFixed(1) + " mm";
  if (colorChk) colorChk.checked = !!ref.__textureColorize;
}

// ============== TEXTURE: APPLICA A TUTTE LE TESSERE (selettore globale) ======
// "Tutte le tessere" del canvas principale = tutte le forme che NON sono
// penna/acquerello (isWatercolorOrFreehand) e NON sono sfondo (__isBackground):
// stesso identico criterio usato negli export. NON tocca Palladiana né 3D
// (builder separati col proprio canvas). Tutto Canvas2D + fabric.Pattern →
// valido da Fabric 5.1.0 a 5.3.0.

// Lista texture per il selettore globale (popolata da loadTexturePanel: stesse
// procedurali + da file della griglia). Ogni voce: { label, dataURL, canvas }.
let _textureAllList = [];

function _allTexturableTiles() {
  if (typeof canvas === "undefined" || !canvas || !canvas.getObjects) return [];
  return canvas.getObjects().filter((o) => o && !isWatercolorOrFreehand(o) && !o.__isBackground);
}

function _texturedTiles(list) {
  return (list || _allTexturableTiles()).filter((o) => o.__textureId || (o.fill && o.fill.__texId));
}

// Applica UNA texture a TUTTE le tessere in un colpo, con grana/colorize presi
// dal popover globale. srcEl è il canvas/<img> già pronto (procedurale) oppure
// null (da file: caricato dal dataURL come fa la griglia).
function applyTextureToAllTiles(dataURL, srcEl, opts) {
  opts = opts || {};
  const tiles = _allTexturableTiles();
  if (!tiles.length) {
    flashToast(__t("toast.textureAll.noTiles", null, "❌ Nessuna tessera sul canvas"));
    return 0;
  }
  const grainSlider = document.getElementById("textureAllGrainSlider");
  const colorChk = document.getElementById("textureAllColorizeChk");
  const wheel = document.getElementById("colorInput");
  const span = clampSpanMM(
    opts.spanMM != null ? opts.spanMM : grainSlider ? grainSlider.value : TEXTURE_SPAN_MM_DEFAULT
  );
  const colorize = opts.colorize != null ? !!opts.colorize : !!(colorChk && colorChk.checked);
  const tint = opts.tint || (wheel && wheel.value) || "#78a0ff";

  const run = (imgEl) => {
    if (!imgEl) return;
    let applied = 0;
    tiles.forEach((o) => {
      if (applyTextureToObject(o, imgEl, dataURL, span, colorize, tint)) applied++;
    });
    canvas.renderAll();
    if (typeof updateTextureGrainPanel === "function") updateTextureGrainPanel();
    if (typeof pushState === "function" && !isApplyingSnapshot) pushState();
    flashToast(__t("toast.textureAll.applied", { count: applied }, `✅ Texture applicata a tutte le ${applied} tessere`));
  };

  if (srcEl) run(srcEl);
  else fabric.util.loadImage(dataURL, run);
  return tiles.length;
}

// Grana per TUTTE le tessere con texture: aggiorna solo il patternTransform.
function setTextureGrainForAll(spanMM) {
  spanMM = clampSpanMM(spanMM);
  const tiles = _texturedTiles();
  let changed = 0;
  tiles.forEach((obj) => {
    const p = obj.fill;
    obj.__textureSpanMM = spanMM;
    if (!p || !p.source) return;
    const sw = p.source.naturalWidth || p.source.width || 1;
    const s = mm2px(spanMM) / sw;
    p.patternTransform = [s, 0, 0, s, 0, 0];
    p.__spanMM = spanMM;
    obj.dirty = true;
    changed++;
  });
  if (changed) canvas.requestRenderAll();
  return changed;
}

// Colora-dalla-ruota per TUTTE le tessere con texture.
function setTextureColorizeForAll(enabled) {
  const tiles = _texturedTiles();
  const wheel = document.getElementById("colorInput");
  let changed = 0;
  tiles.forEach((obj) => {
    const id = obj.__textureId || (obj.fill && obj.fill.__texId);
    if (!id) return;
    const span = clampSpanMM(obj.__textureSpanMM || (obj.fill && obj.fill.__spanMM) || TEXTURE_SPAN_MM_DEFAULT);
    const tint = obj.__textureTint || (wheel && wheel.value) || "#78a0ff";
    const apply = (img) => {
      if (!img) return;
      obj.set("fill", buildTexturePattern(id, img, span, { colorize: !!enabled, tint: tint }));
      obj.__textureColorize = !!enabled;
      obj.__textureTint = enabled ? tint : obj.__textureTint || null;
      obj.dirty = true;
      canvas.requestRenderAll();
    };
    const entry = getRegisteredTexture(id);
    if (entry && entry.img) apply(entry.img);
    else ensureRegisteredImage(id, apply);
    changed++;
  });
  if (changed) {
    canvas.requestRenderAll();
    if (typeof pushState === "function" && !isApplyingSnapshot) pushState();
  }
  return changed;
}

// Toglie la texture da TUTTE le tessere ripristinando il colore pieno
// originale (se memorizzato), altrimenti la tinta usata o il colore della ruota.
function removeTextureFromAllTiles() {
  const tiles = _texturedTiles();
  if (!tiles.length) {
    flashToast(__t("toast.textureAll.none", null, "Nessuna tessera con texture"));
    return 0;
  }
  const wheel = document.getElementById("colorInput");
  let removed = 0;
  tiles.forEach((o) => {
    const restore =
      (typeof o.__preTextureFill === "string" && o.__preTextureFill) ||
      o.__textureTint ||
      (wheel && wheel.value) ||
      "#cccccc";
    o.set("fill", restore);
    o.__textureId = null;
    o.__textureSpanMM = null;
    o.__textureColorize = false;
    o.__textureTint = null;
    o.__textureDataURL = null;
    delete o.__preTextureFill;
    o.dirty = true;
    removed++;
  });
  canvas.renderAll();
  if (typeof updateTextureGrainPanel === "function") updateTextureGrainPanel();
  if (typeof pushState === "function" && !isApplyingSnapshot) pushState();
  flashToast(__t("toast.textureAll.removed", { count: removed }, `🧽 Texture rimossa da ${removed} tessere`));
  return removed;
}

// (Ri)popola il <select> del popover globale con le texture disponibili.
function _rebuildTextureAllSelect() {
  const sel = document.getElementById("textureAllSelect");
  if (!sel) return;
  const placeholder = __t("texturePanel.all.selectPlaceholder", null, "— scegli una texture —");
  let html = `<option value="">${placeholder}</option>`;
  _textureAllList.forEach((t, i) => {
    const label = (t.label || "Texture " + (i + 1)).replace(/</g, "&lt;").replace(/>/g, "&gt;");
    html += `<option value="${i}">${label}</option>`;
  });
  sel.innerHTML = html;
}

// Allinea grana/colorize del popover globale alle tessere già texturizzate.
function _syncTextureAllControls() {
  const grainSlider = document.getElementById("textureAllGrainSlider");
  const grainVal = document.getElementById("textureAllGrainValue");
  const colorChk = document.getElementById("textureAllColorizeChk");
  const textured = _texturedTiles();
  if (textured.length) {
    const ref = textured[0];
    const span = clampSpanMM(ref.__textureSpanMM || (ref.fill && ref.fill.__spanMM) || TEXTURE_SPAN_MM_DEFAULT);
    if (grainSlider && document.activeElement !== grainSlider) grainSlider.value = String(span);
    if (grainVal) grainVal.textContent = span.toFixed(1) + " mm";
    if (colorChk) colorChk.checked = !!ref.__textureColorize;
  }
}

function _positionTextureAllPopover() {
  const pop = document.getElementById("textureAllPopover");
  const btn = document.getElementById("textureAllBtn");
  if (!pop || !btn) return;
  const r = btn.getBoundingClientRect();
  pop.style.left = Math.round(r.right + 8) + "px";
  pop.style.top = Math.round(r.top) + "px";
  pop.style.visibility = "hidden";
  pop.style.display = "block";
  const pr = pop.getBoundingClientRect();
  if (pr.right > window.innerWidth - 8) pop.style.left = Math.max(8, r.left - pr.width - 8) + "px";
  if (pr.bottom > window.innerHeight - 8) pop.style.top = Math.max(8, window.innerHeight - pr.height - 8) + "px";
  pop.style.visibility = "visible";
}

function _openTextureAllPopover() {
  const pop = document.getElementById("textureAllPopover");
  const btn = document.getElementById("textureAllBtn");
  if (!pop) return;
  _rebuildTextureAllSelect();
  _syncTextureAllControls();
  _positionTextureAllPopover();
  pop.setAttribute("aria-hidden", "false");
  if (btn) btn.classList.add("active");
}

function _closeTextureAllPopover() {
  const pop = document.getElementById("textureAllPopover");
  const btn = document.getElementById("textureAllBtn");
  if (pop) {
    pop.style.display = "none";
    pop.setAttribute("aria-hidden", "true");
  }
  if (btn) btn.classList.remove("active");
}

let _textureAllPanelInited = false;
function initTextureAllPanel() {
  if (_textureAllPanelInited) return;
  const btn = document.getElementById("textureAllBtn");
  const pop = document.getElementById("textureAllPopover");
  if (!btn || !pop) return;
  _textureAllPanelInited = true;

  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    if (pop.getAttribute("aria-hidden") === "false") _closeTextureAllPopover();
    else _openTextureAllPopover();
  });

  const sel = pop.querySelector("#textureAllSelect");
  const grainSlider = pop.querySelector("#textureAllGrainSlider");
  const grainVal = pop.querySelector("#textureAllGrainValue");
  const colorChk = pop.querySelector("#textureAllColorizeChk");
  const removeBtn = pop.querySelector("#textureAllRemoveBtn");
  const closeBtn = pop.querySelector("#textureAllClose");

  if (sel) {
    sel.addEventListener("change", () => {
      const i = parseInt(sel.value, 10);
      if (!Number.isInteger(i) || i < 0 || i >= _textureAllList.length) return;
      const t = _textureAllList[i];
      applyTextureToAllTiles(t.dataURL, t.canvas || null);
    });
  }
  if (grainSlider) {
    grainSlider.addEventListener("input", () => {
      const span = clampSpanMM(grainSlider.value);
      if (grainVal) grainVal.textContent = span.toFixed(1) + " mm";
      setTextureGrainForAll(span);
    });
    grainSlider.addEventListener("change", () => {
      if (typeof pushState === "function" && !isApplyingSnapshot) pushState();
    });
    ["mousedown", "pointerdown"].forEach((ev) => grainSlider.addEventListener(ev, (e) => e.stopPropagation()));
  }
  if (colorChk) colorChk.addEventListener("change", () => setTextureColorizeForAll(colorChk.checked));
  if (removeBtn) removeBtn.addEventListener("click", () => removeTextureFromAllTiles());
  if (closeBtn) closeBtn.addEventListener("click", _closeTextureAllPopover);

  document.addEventListener("mousedown", (e) => {
    if (pop.getAttribute("aria-hidden") === "true") return;
    if (pop.contains(e.target)) return;
    if (e.target === btn || btn.contains(e.target)) return;
    _closeTextureAllPopover();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && pop.getAttribute("aria-hidden") === "false") _closeTextureAllPopover();
  });
}
window.applyTextureToAllTiles = applyTextureToAllTiles;
window.setTextureGrainForAll = setTextureGrainForAll;
window.setTextureColorizeForAll = setTextureColorizeForAll;
window.removeTextureFromAllTiles = removeTextureFromAllTiles;
window.initTextureAllPanel = initTextureAllPanel;

function initTextureGrainSlider() {
  const slider = document.getElementById("textureGrainSlider");
  const valEl = document.getElementById("textureGrainValue");
  const colorChk = document.getElementById("textureColorizeChk");

  if (slider) {
    slider.addEventListener("input", () => {
      const span = clampSpanMM(slider.value);
      if (valEl) valEl.textContent = span.toFixed(1) + " mm";
      setTextureGrainForActive(span);
    });
    slider.addEventListener("change", () => {
      if (typeof pushState === "function" && !isApplyingSnapshot) pushState();
    });
    ["mousedown", "pointerdown"].forEach((ev) => slider.addEventListener(ev, (e) => e.stopPropagation()));
  }

  if (colorChk) {
    colorChk.addEventListener("change", () => {
      setTextureColorizeForActive(colorChk.checked);
    });
    ["mousedown", "pointerdown"].forEach((ev) => colorChk.addEventListener(ev, (e) => e.stopPropagation()));
  }
}

// ============== TEXTURE PANEL ==============
// Aggiunge UNA miniatura alla griglia. imgSource: canvas/img gia' pronto
// (texture procedurali) oppure null (texture da file: carico dal dataURL al
// click). Stesso identico percorso di applicazione per entrambe:
// applyTextureToObject + multi-selezione + pushState + toast.
function _addTextureThumb(grid, dataURL, imgSource, displayName) {
  const img = document.createElement("img");
  img.className = "textureThumb";
  img.title = displayName || "";
  img.src = dataURL;
  img.addEventListener("click", () => {
    const selectedObjects = canvas.getActiveObjects(); // multi-selezione + gruppi
    if (selectedObjects.length === 0) {
      flashToast(__t("toast.texture.selectFirst", null, "❌ Seleziona almeno un oggetto prima"));
      return;
    }
    const applyAll = (imgEl) => {
      if (!imgEl) return;
      let applied = 0;
      selectedObjects.forEach((obj) => {
        if (applyTextureToObject(obj, imgEl, dataURL)) applied++;
      });
      canvas.renderAll();
      if (typeof updateTextureGrainPanel === "function") updateTextureGrainPanel();
      pushState(); // storico (Undo)
      flashToast(__t("toast.texture.appliedMany", { count: applied, filename: displayName || "" }, `✅ Texture applicata a ${applied} oggetto/i (${displayName || ""})`));
    };
    // procedurale: canvas gia' pronto; da file: carico l'immagine dal dataURL.
    if (imgSource) applyAll(imgSource);
    else fabric.util.loadImage(dataURL, applyAll);
  });
  grid.appendChild(img);
}

// Token di generazione: protegge il pannello texture dalle chiamate concorrenti.
// loadTexturePanel viene invocata all'avvio da DUE punti (IIFE init del canvas +
// task "textures" della barra di caricamento). Essendo async, le due esecuzioni
// si intrecciavano sull'await di listTextures() duplicando le anteprime da file.
// Ogni chiamata prende un numero progressivo: dopo ogni await chi non e' piu' la
// chiamata piu' recente si ritira senza toccare la griglia. Vince l'ultima.
let _texturePanelGen = 0;

async function loadTexturePanel() {
  const myGen = ++_texturePanelGen;

  const grid = document.getElementById("textureGrid");
  if (!grid) return;
  grid.innerHTML =
    "<div style='grid-column:1/-1;color:#cfcfd0;padding:6px;font-size:13px'>Caricamento texture...</div>";

  const lang =
    window.i18n && typeof window.i18n.getLanguage === "function" ? window.i18n.getLanguage() : "it";

  // 1) TEXTURE PROCEDURALI (generate da codice) — sempre disponibili, in cima.
  let cleared = false;
  const collectedAllTex = [];
  try {
    if (window.proceduralTextures && typeof window.proceduralTextures.list === "function") {
      grid.innerHTML = "";
      cleared = true;
      window.proceduralTextures.list(lang).forEach((p) => {
        _addTextureThumb(grid, p.dataURL, p.canvas, p.label);
        collectedAllTex.push({ label: p.label, dataURL: p.dataURL, canvas: p.canvas || null });
      });
    }
  } catch (e) {
    console.warn("Texture procedurali non disponibili:", e);
  }
  // Selettore "tutte le tessere": rendi disponibili subito almeno le procedurali.
  if (myGen === _texturePanelGen) {
    _textureAllList = collectedAllTex.slice();
    if (typeof _rebuildTextureAllSelect === "function") _rebuildTextureAllSelect();
  }

  // 2) TEXTURE DA FILE (app/textures/).
  if (!window.textureAPI?.listTextures) {
    if (!cleared)
      grid.innerHTML =
        "<div style='grid-column:1/-1;color:#cfcfd0;padding:6px;font-size:13px'>Texture API non disponibile</div>";
    return;
  }

  try {
    const list = await window.textureAPI.listTextures();
    // Se nel frattempo e' partita una chiamata piu' recente, mi ritiro: sara'
    // lei a popolare la griglia (evita la duplicazione delle anteprime da file).
    if (myGen !== _texturePanelGen) return;
    if (!cleared) grid.innerHTML = "";
    if (Array.isArray(list) && list.length > 0) {
      // Separatore sottile tra procedurali e file, solo se ci sono entrambe.
      if (cleared) {
        const sep = document.createElement("div");
        sep.style.cssText =
          "grid-column:1/-1;height:1px;background:rgba(255,255,255,0.12);margin:4px 2px;";
        grid.appendChild(sep);
      }
      list.forEach((item) => {
        _addTextureThumb(grid, item.dataURL, null, item.filename || "");
        collectedAllTex.push({ label: item.filename || "", dataURL: item.dataURL, canvas: null });
      });
      // Aggiorna il selettore globale con procedurali + texture da file.
      _textureAllList = collectedAllTex.slice();
      if (typeof _rebuildTextureAllSelect === "function") _rebuildTextureAllSelect();
    } else if (!cleared) {
      grid.innerHTML =
        "<div style='grid-column:1/-1;color:#cfcfd0;padding:6px;font-size:13px'>Nessuna texture in app/textures/</div>";
    }
  } catch (err) {
    // Anche in caso di errore non scrivo nulla se sono una chiamata sorpassata.
    if (myGen !== _texturePanelGen) return;
    console.error("Errore caricamento textures", err);
    if (!cleared)
      grid.innerHTML =
        "<div style='grid-column:1/-1;color:#ff9d9d;padding:6px;font-size:13px'>Errore caricamento textures</div>";
  }
}

// ============== HISTORY PANEL POSITION ==============
function positionHistoryPanel() {
  // No-op: nel nuovo layout l'Inspector ha posizione fissa via CSS.
  // Funzione mantenuta per compatibilità con i punti del codice che la chiamano.
}

// ============== PAPER SIZING ==============
function setPaperSizeFromMM() {
  const w_px = Math.max(1, Math.round(mm2px(A4_MM_W)));
  const h_px = Math.max(1, Math.round(mm2px(A4_MM_H)));
  if (paper) {
    paper.style.width = w_px + "px";
    paper.style.height = h_px + "px";
  }
  canvas.setWidth(w_px);
  canvas.setHeight(h_px);
  canvas.calcOffset();
  canvas.renderAll();
}

// Imposta l'orientamento del foglio (verticale/orizzontale) SENZA ruotare i
// contenuti. Usata SOLO al caricamento progetto: le forme arrivano gia' con le
// coordinate dell'orientamento salvato, quindi qui basta riportare il foglio
// alla dimensione corretta prima di enlivenare gli oggetti. Diverso da
// rotateCanvasContent(), che invece ruota anche le forme.
function setCanvasOrientationMM(wMM, hMM, paperRotDeg) {
  if (typeof wMM === "number" && wMM > 0 && typeof hMM === "number" && hMM > 0) {
    A4_MM_W = wMM;
    A4_MM_H = hMM;
  } else {
    // Fallback: progetto vecchio senza dato orientamento -> verticale A4 (come prima).
    A4_MM_W = 210;
    A4_MM_H = 297;
  }
  paperTextureRotationDeg = (((Number(paperRotDeg) || 0) % 360) + 360) % 360;
  setPaperSizeFromMM();
}

// Async + Promise-returning: i caller (openProjectBtn, tryAutoOpen) possono
// usare await per sapere quando il load è davvero finito (sfondo incluso).
// Robusta contro callback di loadFromJSON / fromURL mai invocate: timer di
// sicurezza interno che sblocca lo stato e risolve dopo APPLY_TIMEOUT_MS.
function applyProjectData(data, filename, filePath = null) {
  return new Promise((resolve) => {
    console.log("[applyProjectData] ▶ start — filename:", filename, "filePath:", filePath);

    // Anti-double-resolve + timer di sicurezza globale.
    // Se loadFromJSON o setCanvasBackgroundFromDataURL non chiamano mai la
    // propria callback (es. immagine corrotta dentro un oggetto del progetto),
    // dopo APPLY_TIMEOUT_MS sblocchiamo isRestoringProject e proseguiamo lo
    // stesso: meglio un canvas parzialmente popolato che un'app bloccata.
    const APPLY_TIMEOUT_MS = 15000;
    let resolved = false;
    const safetyTimer = setTimeout(() => {
      if (resolved) return;
      resolved = true;
      console.warn("[applyProjectData] ⏱ TIMEOUT", APPLY_TIMEOUT_MS, "ms — sblocco e proseguo");
      isRestoringProject = false;
      try {
        enableHistoryButtons();
      } catch (_) {}
      resolve();
    }, APPLY_TIMEOUT_MS);
    const safeResolve = () => {
      if (resolved) return;
      resolved = true;
      clearTimeout(safetyTimer);
      resolve();
    };

    // ── 0. PULIZIA STATO PREGRESSO ────────────────────────────────────────
    // Cancella un eventuale pushState in debounce dal progetto precedente:
    // se scattasse a metà del load contaminerebbe lo stack del nuovo progetto.
    if (_pushDebounceTimer) {
      clearTimeout(_pushDebounceTimer);
      _pushDebounceTimer = null;
    }
    // Reset stack undo/redo: ogni progetto ha la sua storia, separata.
    undoStack = [];
    redoStack = [];
    _batchOperationDepth = 0;
    enableHistoryButtons();

    isRestoringProject = true;
    canvas.clear();

    // ── RIPRISTINO ORIENTAMENTO FOGLIO (prima di enlivenare le forme) ──
    // Le coordinate delle forme nel file sono relative all'orientamento con cui
    // il progetto e' stato salvato. Riportiamo il foglio a quell'orientamento
    // ORA, cosi' le tessere caricate cadono al posto giusto e nulla finisce
    // fuori dal foglio. I progetti vecchi (senza data.sheet) tornano verticali.
    const _sheet = data && data.sheet ? data.sheet : null;
    setCanvasOrientationMM(
      _sheet ? _sheet.wMM : 210,
      _sheet ? _sheet.hMM : 297,
      _sheet ? _sheet.paperRotDeg : 0
    );

    // ── FASE 3 — Ripristino stato carta (accesa/spenta + personalizzata) ──
    // Va applicato PRIMA della ricreazione della carta (più in basso), così
    // ensurePaperTexture usa subito enabled + custom corretti. I progetti vecchi
    // (senza questi campi) tornano: carta accesa e predefinita, nessuna regressione.
    if (typeof window.applyPaperTextureState === "function") {
      window.applyPaperTextureState({
        enabled: _sheet ? _sheet.paperEnabled : true,
        customDataURL: _sheet ? _sheet.paperCustom : null
      });
    }
    if (typeof window.updatePaperUI === "function") window.updatePaperUI();

    // ── Reset texture carta della sessione precedente ──
    // canvas.clear() l'ha gia' tolta dal canvas, ma il riferimento globale punta
    // ancora all'oggetto vecchio (scala/rotazione del progetto precedente). Lo
    // azzeriamo: verra' ricreato piu' sotto con dimensioni/rotazione corrette.
    if (typeof paperTextureObject !== "undefined" && paperTextureObject) {
      if (canvas.contains(paperTextureObject)) canvas.remove(paperTextureObject);
      paperTextureObject = null;
    }
    if (typeof paperTextureLoading !== "undefined") paperTextureLoading = null;

    console.log("[applyProjectData] → loadFromJSON inizia");
    canvas.loadFromJSON(data.canvas || data, async () => {
      console.log(
        "[applyProjectData] ✓ loadFromJSON callback invocata —",
        canvas.getObjects().length,
        "oggetti caricati"
      );
      try {
        // Barra di caricamento: oggetti enlivenati (inizio elaborazione).
        if (typeof window.__loaderSubProgress === "function") {
          try { window.__loaderSubProgress(0.15, "Forme"); } catch (e) {}
        }

        // 0. Semina il registro texture col dizionario del file ({id:dataURL}).
        //    Le tessere referenziano gli id; le immagini esistono UNA volta sola.
        if (data && data.textures) seedTextureRegistry(data.textures);

        // 1. Ricostruzione forme speciali
        canvas.getObjects().forEach((o) => {
          // Triangoli
          if (o.__shapeType === "triangle" && (!o.__shape || !Array.isArray(o.__shape.angles))) {
            const bbox = o.getBoundingRect(true);
            o.__shape = o.__shape || {};
            o.__shape.type = "triangle";
            o.__shape.angles = o.__shape.angles || [60, 60];
            o.__shape.base_mm = o.__shape.base_mm || px2mm(bbox.width);
          }
          // Bake eventuale scala residua sui triangoli (analogo ai trapezi).
          if (o.__shapeType === "triangle" && o.type === "polygon") {
            const sx = o.scaleX || 1;
            const sy = o.scaleY || 1;
            if (Math.abs(sx) !== 1 || Math.abs(sy) !== 1 || o.flipX || o.flipY) {
              bakeTriangleScaleIntoPoints(o);
            } else {
              if (Array.isArray(o.points) && o.points.length >= 3) {
                const m = TriangleModel.fromPoints(o.points);
                o.__shape = {
                  type: "triangle",
                  angles: [m.alpha, m.beta],
                  base_mm: px2mm(m.base)
                };
              }
            }
          }

          // Trapezi
          if (o.__shape && o.__shape.type === "trapezoid") {
            try {
              const model = TrapezoidModel.fromJSON(o.__shape, mm2px);
              // Le misure salvate in __shape (mm -> px) SONO la dimensione reale
              // del trapezio: ricostruiamo i punti senza vincolarli all'altezza
              // del bounding box. Per una forma ruotata getBoundingRect(true)
              // restituisce l'altezza dell'AABB ruotato (non l'altezza propria
              // del trapezio), che spesso e' piu' piccola -> computePointsFit lo
              // rimpiccioliva ad ogni apertura (tessere "minuscole"). Per le
              // forme dritte il risultato e' identico a prima: nessuna regressione.
              const pts = model.computePoints();
              if (o.type === "polygon") {
                o.points = pts;
                o.__shapeType = "trapezoid";
              }
              if (o.type === "polygon") {
                const sx = o.scaleX || 1;
                const sy = o.scaleY || 1;
                if (Math.abs(sx) !== 1 || Math.abs(sy) !== 1 || o.flipX || o.flipY) {
                  bakeTrapezoidScaleIntoPoints(o);
                } else {
                  const m = TrapezoidModel.fromPoints(o.points);
                  o.__shape = {
                    type: "trapezoid",
                    top_mm: px2mm(m.topBase),
                    bottom_mm: px2mm(m.bottomBase),
                    height_mm: px2mm(m.height),
                    offset_mm: px2mm(m.offset)
                  };
                }
              }
            } catch (err) {
              console.warn("Errore ricostruzione trapezio", err);
            }
          }

          // Settori
          if (o.__shapeType === "sector" && o.__shape) {
            try {
              const model = CircleSectorModel.fromJSON(o.__shape, mm2px);
              const pathData = model.getPath(0, 0);
              const newSector = new fabric.Path(pathData, {
                left: o.left,
                top: o.top,
                originX: "center",
                originY: "center",
                fill: o.fill,
                stroke: null,
                strokeWidth: 0,
                angle: o.angle || 0,
                scaleX: o.scaleX || 1,
                scaleY: o.scaleY || 1,
                __shapeType: "sector",
                __shape: o.__shape,
                customId: o.customId || generateUID()
              });
              // ── FIX: il settore viene RICREATO da zero, quindi va riportata a
              // mano TUTTA la roba che non sta nel costruttore, altrimenti si
              // perde. Prima si perdeva la TEXTURE: copiavamo solo "fill" (il
              // colore base, ecco perche' tornava "il colore giusto ma senza
              // texture"), ma non gli id/metadati che rebuildAllTextureFills usa
              // poco piu' sotto per riattaccare il pattern. Li copiamo qui:
              newSector.__textureId = o.__textureId || null;
              newSector.__textureSpanMM = o.__textureSpanMM;
              newSector.__textureColorize = !!o.__textureColorize;
              newSector.__textureTint = o.__textureTint || null;
              newSector.__textureDataURL = o.__textureDataURL || null; // compat vecchi file
              if (o.__preTextureFill != null) newSector.__preTextureFill = o.__preTextureFill;

              // Riporta anche selezionabilita'/lock salvati (un settore bloccato
              // deve restare bloccato dopo la riapertura).
              ["selectable", "evented", "hasControls", "hasBorders",
               "lockMovementX", "lockMovementY", "lockScalingX",
               "lockScalingY", "lockRotation"].forEach((k) => {
                if (o[k] !== undefined) newSector[k] = o[k];
              });

              canvas.remove(o);
              canvas.add(newSector);
              // Maniglie coerenti coi settori + coords aggiornate (evita che il
              // riquadro di selezione appaia sfasato finche' non si interagisce).
              if (typeof applyHandlePreset === "function") applyHandlePreset(newSector);
              if (typeof updateHandlesSpacing === "function") updateHandlesSpacing(newSector);
              newSector.setCoords();
            } catch (err) {
              console.warn("Errore ricostruzione settore", err);
            }
          }

          // Texture Pattern: la ricostruzione NON si fa piu' qui dentro al
          // forEach (causava N loadImage + N renderAll = blocco di decine di
          // secondi in apertura). Si fa IN BLOCCO subito dopo, con
          // rebuildAllTextureFills: una immagine per id, un solo render finale.
        });

        // 1-bis. Ricostruzione texture IN BLOCCO (dopo che le forme speciali
        // — settori inclusi — sono state ricreate, quindi sul set di oggetti
        // definitivo). Awaitiamo: cosi' la snapshot iniziale dell'undo cattura
        // i pattern gia' pronti e il render e' coerente. La barra avanza dal
        // 45% al 90% del task "Progetto" man mano che gli id si completano.
        if (typeof window.__loaderSubProgress === "function") {
          try { window.__loaderSubProgress(0.45, "Texture"); } catch (e) {}
        }
        await new Promise((resolveTex) => {
          try {
            rebuildAllTextureFills(
              canvas.getObjects(),
              function (frac) {
                if (typeof window.__loaderSubProgress === "function") {
                  try { window.__loaderSubProgress(0.45 + Math.max(0, Math.min(1, frac)) * 0.45, "Texture"); } catch (e) {}
                }
              },
              function () { resolveTex(); }
            );
          } catch (e) {
            console.warn("[applyProjectData] rebuildAllTextureFills error", e);
            resolveTex();
          }
        });

        // 2. Ripristino sfondo (await: ci serve per ordine corretto)
        if (typeof window.__loaderSubProgress === "function") {
          try { window.__loaderSubProgress(0.92, "Sfondo"); } catch (e) {}
        }
        if (data.backgroundMeta && data.backgroundMeta.dataURL) {
          console.log("[applyProjectData] → setCanvasBackgroundFromDataURL");
          await setCanvasBackgroundFromDataURL(data.backgroundMeta.dataURL, data.backgroundMeta.filename, {
            fit: data.backgroundMeta.fit || "contain",
            rotation: data.backgroundMeta.rotation || 0
          });
          console.log("[applyProjectData] ✓ sfondo applicato");
        } else {
          backgroundMeta = null;
          backgroundImageObject = null;
          updateBgPreviewUI();
          // Senza sfondo: ricrea la texture carta con la rotazione del progetto.
          // Usiamo ensurePaperTexture (non restorePaperTexture) perche' l'oggetto
          // e' stato azzerato all'inizio: va rigenerato da zero alle dimensioni e
          // rotazione corrette del foglio appena ripristinato.
          if (typeof window.ensurePaperTexture === "function") {
            try {
              await window.ensurePaperTexture(paperTextureRotationDeg);
              if (typeof window.keepPaperTextureBehindEverything === "function") {
                window.keepPaperTextureBehindEverything();
              }
            } catch (_) {}
          }
        }

        // 3. Ripristino lock e stato visivo
        canvas.renderAll();
        if (typeof window.restoreFreehandLocks === "function") window.restoreFreehandLocks();
        restoreBackgroundLock();
        if (window.forceFixDeleteButton) window.forceFixDeleteButton();

        currentProjectPath = filePath || null; // ← memorizza il path

        // Sincronizza la spunta "apri all'avvio" con lo stato REALE: deve
        // risultare attiva SOLO se il progetto appena caricato e' proprio quello
        // registrato per l'apertura automatica. Aprire un altro progetto non deve
        // piu' "rubargli" l'auto-open (era questo il bug: con la spunta ancora
        // attiva, aprire un secondo progetto spostava l'auto-open su di lui e
        // all'avvio si apriva il progetto sbagliato). NB: impostare .checked via
        // codice NON scatena l'evento "change", quindi il listener resta inerte.
        if (autoOpenCheckbox) {
          try {
            const _ao = await window.projectAPI?.getAutoOpen();
            const _marked = _ao && _ao.lastProject ? String(_ao.lastProject) : null;
            const _norm = (p) => String(p).replace(/[\\/]+/g, "\\").toLowerCase();
            autoOpenCheckbox.checked = !!(filePath && _marked && _norm(filePath) === _norm(_marked));
          } catch (_) {
            autoOpenCheckbox.checked = false;
          }
        }

        // 4. Settings freehand del progetto (FIX: era project.freehandSettings)
        if (data.freehandSettings) {
          freehandPersistentSettings = data.freehandSettings;
          if (typeof loadFreehandSettings === "function") loadFreehandSettings();
        }

        // 4-bis. Perimetro di contenimento del disegno a mano libera.
        if (typeof window.setFreehandClipPolygon === "function") {
          window.setFreehandClipPolygon(
            Array.isArray(data.freehandClipPolygon) ? data.freehandClipPolygon : null,
            { silent: true }
          );
        }
        if (typeof window.applyFreehandClipToAll === "function") {
          window.applyFreehandClipToAll();
        }

        // 5. CHIUSURA FASE DI RESTORE — dopo questa riga gli eventi del canvas
        //    tornano a popolare lo stack undo/redo normalmente.
        isRestoringProject = false;

        // 6. Stato iniziale dell'undo: snapshot del progetto appena caricato.
        pushState();
        enableHistoryButtons();

        // Barra di caricamento: task "Progetto" completato.
        if (typeof window.__loaderSubProgress === "function") {
          try { window.__loaderSubProgress(1, "Progetto"); } catch (e) {}
        }

        flashToast(__t("toast.project.loaded", { filename: filename || "" }, "Progetto caricato: " + (filename || "")));
        console.log("[applyProjectData] ✓ completato regolarmente");
      } catch (err) {
        console.error("[applyProjectData] errore nella callback di loadFromJSON", err);
        isRestoringProject = false;
        enableHistoryButtons();
      } finally {
        safeResolve();
      }
    });
  });
}

// ============== PROGETTI: APRI/SALVA ==============
if (openProjectBtn) {
  openProjectBtn.addEventListener("click", async () => {
    if (!window.projectAPI?.openProjectDialog) {
      flashToast(__t("toast.project.openApiUnavailable", null, "API apertura progetto non disponibile"));
      return;
    }
    try {
      const res = await window.projectAPI.openProjectDialog();
      if (!res) {
        flashToast(__t("toast.project.openCancelled", null, "Apertura progetto annullata"));
        return;
      }
      if (!res.content) {
        flashToast(__t("toast.project.openEmpty", null, "Nessun contenuto nel progetto selezionato"));
        return;
      }

      const projectData = typeof res.content === "string" ? JSON.parse(res.content) : res.content;

      await applyProjectData(projectData, res.filename, res.path);
    } catch (e) {
      console.error(e);
      flashToast(__t("toast.project.openError", null, "Errore apertura progetto"));
    }
  });
}

if (saveProjectBtn) {
  saveProjectBtn.addEventListener("click", async () => {
    try {
      // Prepara metadati forme
      canvas.getObjects().forEach((o) => {
        if (o.__shapeType === "triangle") {
          // Cuoci eventuale scala residua nei punti, e RICALCOLA __shape dai
          // punti reali. Così il file salvato contiene sempre angoli/base "veri".
          if (o.type === "polygon") {
            bakeTriangleScaleIntoPoints(o);
          }
          // Difesa in profondità: se per qualche motivo __shape è ancora vuoto
          // (oggetto non-polygon o bake fallito), riempilo con stime dal bbox.
          if (!o.__shape || !Array.isArray(o.__shape.angles)) {
            const bbox = o.getBoundingRect(true);
            o.__shape = o.__shape || {};
            o.__shape.type = "triangle";
            o.__shape.angles = o.__shape.angles || [60, 60];
            o.__shape.base_mm = o.__shape.base_mm || px2mm(bbox.width);
          }
        }
        if (o.__shapeType === "trapezoid") {
          // Cuoci eventuale scala residua nei punti, e RICALCOLA __shape dai
          // punti reali. Così il file salvato contiene sempre i mm "veri" e
          // alla riapertura lo slider riflette esattamente ciò che si vedeva.
          if (o.type === "polygon") {
            bakeTrapezoidScaleIntoPoints(o);
          }
          // Difesa in profondità: se per qualche motivo __shape è ancora vuoto
          // (oggetto non-polygon o bake fallito), riempilo con stime dal bbox.
          const bbox = o.getBoundingRect(true);
          o.__shape = o.__shape || {};
          o.__shape.type = "trapezoid";
          if (typeof o.__shape.top_mm !== "number") o.__shape.top_mm = px2mm(Math.max(4, bbox.width * 0.5));
          if (typeof o.__shape.bottom_mm !== "number") o.__shape.bottom_mm = px2mm(Math.max(4, bbox.width));
          if (typeof o.__shape.height_mm !== "number") o.__shape.height_mm = px2mm(Math.max(4, bbox.height));
          if (typeof o.__shape.offset_mm !== "number") o.__shape.offset_mm = 0;
        }
      });
      // Texture: NON si baka piu' alcun dataURL per-tessera (era il killer della
      // RAM). Si sincronizzano solo i metadati leggeri dal pattern; le immagini
      // vengono scritte UNA volta sola nel registro (projectData.textures).
      canvas.getObjects().forEach((o) => {
        if (o.fill && o.fill.__texId) {
          o.__textureId = o.fill.__texId;
          o.__textureSpanMM = o.fill.__spanMM || o.__textureSpanMM || TEXTURE_SPAN_MM_DEFAULT;
          if (typeof o.fill.__colorize === "boolean") o.__textureColorize = o.fill.__colorize;
          if (o.fill.__colorize && o.fill.__tint) o.__textureTint = o.fill.__tint;
          o.__textureDataURL = null; // legacy ripulito
        }
      });

      // Salva sfondo temporaneamente
      let tempBackground = null;
      if (backgroundImageObject) {
        tempBackground = backgroundImageObject;
        canvas.remove(tempBackground);
      }

      const backgroundData = backgroundMeta
        ? {
            dataURL: backgroundMeta.dataURL,
            filename: backgroundMeta.filename,
            fit: backgroundMeta.fit,
            rotation: backgroundMeta.rotation
          }
        : null;

      // Blocca linee a mano libera
      if (typeof lockAllFreehandPaths === "function") lockAllFreehandPaths();

      const projectData = {
        canvas: canvas.toJSON([
          "__shape",
          "data",
          "__isFreehand",
          "__isBackground",
          "__isWatercolor", "__clipPoly",
          "__watercolorParams",
          "__addedAt",
          "__shapeType",
          "customId",
          "__textureId",
          "__textureSpanMM",
          "__textureColorize",
          "__textureTint",
          "selectable",
          "evented",
          "hasControls",
          "hasBorders",
          "lockMovementX",
          "lockMovementY",
          "lockScalingX",
          "lockScalingY",
          "lockRotation",
          "hoverCursor"
        ]),
        // Le immagini delle texture vengono salvate UNA volta sola qui (per id),
        // non piu' duplicate dentro ogni tessera: questo elimina l'esplosione di RAM.
        textures: collectTextureRegistry(canvas.getObjects()),
        freehandSettings: freehandPersistentSettings,
        backgroundMeta: backgroundData,
        // Orientamento del foglio + rotazione texture carta. Senza questo blocco
        // il progetto riapriva sempre verticale e le tessere finivano fuori posto.
        // Oggetto estensibile: la Fase 3 (carta on/off + personalizzata) aggiungera'
        // qui i suoi campi senza ritoccare salvataggio/caricamento.
        sheet: (() => {
          // FASE 3 — stato carta per progetto: accesa/spenta + carta personalizzata
          // (dataURL già ridimensionato; null = carta predefinita).
          const _ps = typeof window.getPaperTextureState === "function" ? window.getPaperTextureState() : {};
          return {
            wMM: A4_MM_W,
            hMM: A4_MM_H,
            paperRotDeg: paperTextureRotationDeg,
            paperEnabled: _ps.enabled === undefined ? true : !!_ps.enabled,
            paperCustom: _ps.customDataURL || null
          };
        })(),
        // Perimetro di contenimento del disegno a mano libera (coord. logiche).
        freehandClipPolygon:
          typeof window.getFreehandClipPolygon === "function" ? window.getFreehandClipPolygon() : null
      };

      const json = JSON.stringify(projectData);
      const res = await window.projectAPI.saveProject({ content: json });

      // Ripristina sfondo
      if (tempBackground) {
        canvas.add(tempBackground);
        canvas.sendToBack(tempBackground);
      }

      if (res?.canceled) {
        flashToast(__t("toast.project.saveCancelled", null, "Salvataggio annullato"));
      } else if (res?.error) {
        flashToast(__t("toast.project.saveError", { error: res.error }, "Errore: " + res.error));
      } else {
        currentProjectPath = res.path || null; // ← memorizza sempre il path
        flashToast(__t("toast.project.saved", null, "Progetto salvato ✔"));
        if (autoOpenCheckbox?.checked && res?.path) {
          await window.projectAPI.setAutoOpen(res.path);
          flashToast(__t("toast.project.savedAutoOpen", null, "Progetto salvato e impostato come apertura automatica"));
        }
      }
    } catch (e) {
      console.error(e);
      flashToast(__t("toast.project.saveErrorGeneric", null, "Errore salvataggio progetto"));
    }
  });
}

// ============== AUTO-OPEN ==============
async function tryAutoOpen() {
  try {
    const project = await window.projectAPI?.tryAutoOpen();
    if (!project?.content) return;

    const data = typeof project.content === "string" ? JSON.parse(project.content) : project.content;

    await applyProjectData(data, project.filename, project.path || null);
  } catch (err) {
    console.warn("Auto-open fallito:", err);
    isRestoringProject = false;
    enableHistoryButtons();
  }
}

// ============== SFONDO ==============
let backgroundMeta = null;
let backgroundImageObject = null;
let bgApplySeq = 0;

function normalizeRotationDeg(deg) {
  let r = Math.round(Number(deg) || 0) % 360;
  if (r < 0) r += 360;
  const steps = Math.round(r / 90);
  return (steps * 90) % 360;
}

function setCanvasBackgroundFromDataURL(dataURL, filename = null, opts = {}) {
  opts = opts || {};
  const requestedFit = opts.fit || (backgroundMeta && backgroundMeta.fit) || "contain";
  const requestedRotation =
    typeof opts.rotation !== "undefined"
      ? Number(opts.rotation)
      : (backgroundMeta && Number(backgroundMeta.rotation || 0)) || 0;
  const rotation = normalizeRotationDeg(requestedRotation);

  backgroundMeta = Object.assign({}, backgroundMeta || {}, {
    dataURL,
    filename: filename || (backgroundMeta && backgroundMeta.filename) || null,
    fit: requestedFit,
    rotation
  });

  bgApplySeq += 1;
  const mySeq = bgApplySeq;

  return new Promise((resolve) => {
    fabric.Image.fromURL(
      dataURL,
      function (img) {
        // Race-protection: una chiamata successiva ha rimpiazzato la nostra.
        // Risolviamo comunque la Promise per non lasciare callers in attesa.
        if (mySeq !== bgApplySeq) {
          resolve();
          return;
        }

        // Difesa contro fallimenti di caricamento immagine.
        if (!img) {
          resolve();
          return;
        }

        let targetW = mm2px(A4_MM_W);
        let targetH = mm2px(A4_MM_H);

        const rotatedSwap = rotation === 90 || rotation === 270;
        let refImgW = rotatedSwap ? img.height : img.width;
        let refImgH = rotatedSwap ? img.width : img.height;

        const sx = targetW / refImgW;
        const sy = targetH / refImgH;
        const scale = backgroundMeta.fit === "cover" ? Math.max(sx, sy) : Math.min(sx, sy);

        img.set({
          left: targetW / 2,
          top: targetH / 2,
          originX: "center",
          originY: "center",
          angle: rotation,
          scaleX: scale,
          scaleY: scale,
          selectable: false,
          evented: false,
          hasControls: false,
          hasBorders: false,
          lockMovementX: true,
          lockMovementY: true,
          lockScalingX: true,
          lockScalingY: true,
          lockRotation: true,
          excludeFromExport: true,
          __isBackground: true
        });

        if (backgroundImageObject) canvas.remove(backgroundImageObject);
        canvas.add(img);
        canvas.sendToBack(img);
        backgroundImageObject = img;

        backgroundMeta.scaleApplied = scale;
        img.setCoords();
        canvas.sendToBack(backgroundImageObject);
        canvas.renderAll();
        updateBgPreviewUI();

        // ── Nasconde la texture carta: l'immagine di sfondo utente la sostituisce ──
        if (typeof window.hidePaperTexture === "function") window.hidePaperTexture();

        if (!isRestoringProject) {
          // NON chiamiamo pushState() qui: lo sfondo è gestito separatamente da
          // backgroundMeta e da _reapplyBackgroundSilent, completamente disaccoppiato
          // dallo stack undo/redo. Chiamare pushState() qui farebbe sì che undo/redo
          // aggiunga/rimuova lo sfondo, che è esattamente il comportamento da evitare.
          flashToastSafe(__t("toast.bg.applied", null, "Immagine di sfondo applicata"));
        }
        // Durante il restore di progetto restiamo silenziosi: il toast finale
        // ("Progetto caricato: …") di applyProjectData copre la comunicazione utente.

        resolve();
      },
      { crossOrigin: "anonymous" }
    );
  });
}

function updateBgPreviewUI() {
  const bgPreview = document.getElementById("bgPreview");
  const bgInfo = document.getElementById("bgInfo");
  const clearBtn = document.getElementById("bgClearBtn");
  if (!bgPreview) return;

  const hasBg = !!(backgroundMeta && backgroundMeta.dataURL);

  if (hasBg) {
    bgPreview.src = backgroundMeta.dataURL;
    bgPreview.style.display = "block";
    if (bgInfo) bgInfo.textContent = backgroundMeta.filename || "";
    bgPreview.style.transform = `rotate(${backgroundMeta.rotation || 0}deg)`;
  } else {
    bgPreview.src = "";
    bgPreview.style.display = "none";
    if (bgInfo) bgInfo.textContent = "";
    bgPreview.style.transform = "";
  }

  // Sync visibilità pulsante Rimuovi (lo fa anche il MutationObserver in fixBackgroundUI,
  // ma qui lo forziamo subito per coerenza immediata)
  if (clearBtn) {
    clearBtn.style.display = hasBg ? "" : "none";
    clearBtn.style.pointerEvents = "auto";
    clearBtn.disabled = false;
  }
}

function reapplyBackgroundImage() {
  if (!backgroundMeta || !backgroundMeta.dataURL) return;
  setCanvasBackgroundFromDataURL(backgroundMeta.dataURL, backgroundMeta.filename, {
    fit: backgroundMeta.fit || "contain",
    rotation: backgroundMeta.rotation || 0
  });
}

function rotateBackground(delta) {
  if (!backgroundMeta || !backgroundMeta.dataURL) {
    flashToastSafe(__t("toast.bg.nothingToRotate", null, "Nessuna immagine di sfondo da ruotare"));
    return;
  }
  backgroundMeta.rotation = normalizeRotationDeg((backgroundMeta.rotation || 0) + delta);
  reapplyBackgroundImage();
}

function setBackgroundFit(fit) {
  if (!backgroundMeta || !backgroundMeta.dataURL) {
    flashToastSafe(__t("toast.bg.nothingLoaded", null, "Nessuna immagine caricata"));
    return;
  }
  backgroundMeta.fit = fit === "cover" ? "cover" : "contain";
  reapplyBackgroundImage();
}

function clearBackground() {
  backgroundMeta = null;
  if (backgroundImageObject) {
    canvas.remove(backgroundImageObject);
    backgroundImageObject = null;
  }
  updateBgPreviewUI();
  canvas.renderAll();

  // ── Ripristina la texture carta: rimosso lo sfondo, la carta torna visibile ──
  if (typeof window.restorePaperTexture === "function") window.restorePaperTexture();

  // NON chiamiamo pushState(): la rimozione dello sfondo non va in undo/redo,
  // coerentemente con il fatto che anche l'aggiunta non ci va.
  flashToastSafe(__t("toast.bg.removed", null, "Sfondo rimosso"));
}

// ============== UI SFONDO ==============
const bgFileInput = document.getElementById("bgFileInput");
const bgPickBtn = document.getElementById("bgPickBtn");
const bgDrop = document.getElementById("bgDrop");
const bgPreview = document.getElementById("bgPreview");
const bgInfo = document.getElementById("bgInfo");
const bgClearBtn = document.getElementById("bgClearBtn");
const bgFitContainBtn = document.getElementById("bgFitContain");
const bgFitCoverBtn = document.getElementById("bgFitCover");
const bgRotateLeft = document.getElementById("bgRotateLeft");
const bgRotateRight = document.getElementById("bgRotateRight");

if (bgPickBtn && bgFileInput) {
  bgPickBtn.addEventListener("click", () => {
    bgFileInput.value = ""; // reset: permette di ricaricare lo stesso file
    bgFileInput.click();
  });
}

if (bgFileInput) {
  bgFileInput.addEventListener("change", (ev) => {
    const f = ev.target.files && ev.target.files[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = function (e) {
      setCanvasBackgroundFromDataURL(e.target.result, f.name, { fit: "contain" });
      if (bgPreview) {
        bgPreview.src = e.target.result;
        bgPreview.style.display = "block";
      }
      if (bgInfo) bgInfo.textContent = f.name;
      ev.target.value = ""; // reset per riselezionare lo stesso file in futuro
    };
    reader.readAsDataURL(f);
  });
}

if (bgDrop) {
  bgDrop.addEventListener("dragover", (e) => {
    e.preventDefault();
    bgDrop.classList.add("dragover");
  });
  bgDrop.addEventListener("dragleave", (e) => {
    e.preventDefault();
    bgDrop.classList.remove("dragover");
  });
  bgDrop.addEventListener("drop", (e) => {
    e.preventDefault();
    bgDrop.classList.remove("dragover");
    const f = e.dataTransfer.files && e.dataTransfer.files[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = function (ev) {
      setCanvasBackgroundFromDataURL(ev.target.result, f.name, { fit: "contain" });
      if (bgPreview) {
        bgPreview.src = ev.target.result;
        bgPreview.style.display = "block";
      }
      if (bgInfo) bgInfo.textContent = f.name;
    };
    reader.readAsDataURL(f);
  });
}

if (bgClearBtn) bgClearBtn.addEventListener("click", clearBackground);
if (bgFitContainBtn) bgFitContainBtn.addEventListener("click", () => setBackgroundFit("contain"));
if (bgFitCoverBtn) bgFitCoverBtn.addEventListener("click", () => setBackgroundFit("cover"));
if (bgRotateLeft) bgRotateLeft.addEventListener("click", () => rotateBackground(-90));
if (bgRotateRight) bgRotateRight.addEventListener("click", () => rotateBackground(+90));

// ══════════════════════════════════════════════════════════════════════
//  FASE 3 — UI controlli texture carta (on/off, personalizzata, default)
// ══════════════════════════════════════════════════════════════════════

// Lato lungo massimo della carta personalizzata salvata nel progetto. La carta
// è solo uno sfondo a opacità 22%: 1024px bastano e larga. Tunabile.
const PAPER_CUSTOM_MAX_PX = 1024;

const paperEnabledChk = document.getElementById("paperEnabledChk");
const paperPickBtn = document.getElementById("paperPickBtn");
const paperResetBtn = document.getElementById("paperResetBtn");
const paperFileInput = document.getElementById("paperFileInput");

// Allinea lo stato visivo dei controlli carta a quello reale (usata all'avvio,
// al caricamento progetto e al nuovo progetto). Spegne il toggle solo se la
// carta è davvero disabilitata.
function updatePaperUI() {
  if (!paperEnabledChk) return;
  let enabled = true;
  try {
    if (typeof window.getPaperTextureState === "function") {
      const st = window.getPaperTextureState();
      enabled = st && st.enabled !== undefined ? !!st.enabled : true;
    }
  } catch (_) {}
  paperEnabledChk.checked = enabled;
}

// Ridimensiona un'immagine (dataURL) entro maxPx sul lato lungo, mantenendo le
// proporzioni. Restituisce un dataURL PNG. Se l'immagine è già piccola la
// ri-codifica comunque a PNG (formato uniforme per il salvataggio).
function _downscalePaperImage(dataURL, maxPx) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      try {
        const w = img.naturalWidth || img.width;
        const h = img.naturalHeight || img.height;
        if (!w || !h) {
          reject(new Error("dimensioni immagine non valide"));
          return;
        }
        const scale = Math.min(1, maxPx / Math.max(w, h));
        const outW = Math.max(1, Math.round(w * scale));
        const outH = Math.max(1, Math.round(h * scale));
        const c = document.createElement("canvas");
        c.width = outW;
        c.height = outH;
        const cx = c.getContext("2d");
        cx.imageSmoothingEnabled = true;
        cx.imageSmoothingQuality = "high";
        cx.drawImage(img, 0, 0, outW, outH);
        resolve(c.toDataURL("image/png"));
      } catch (err) {
        reject(err);
      }
    };
    img.onerror = () => reject(new Error("caricamento immagine carta fallito"));
    img.src = dataURL;
  });
}

// Toggle accendi/spegni carta
if (paperEnabledChk) {
  paperEnabledChk.addEventListener("change", () => {
    if (typeof window.setPaperTextureEnabled === "function") {
      window.setPaperTextureEnabled(paperEnabledChk.checked);
    }
    if (typeof scheduleAutoSave === "function") scheduleAutoSave();
  });
}

// Carica carta personalizzata (apre il file picker)
if (paperPickBtn && paperFileInput) {
  paperPickBtn.addEventListener("click", () => {
    paperFileInput.value = ""; // permette di ricaricare lo stesso file
    paperFileInput.click();
  });
}

if (paperFileInput) {
  paperFileInput.addEventListener("change", (ev) => {
    const f = ev.target.files && ev.target.files[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = async function (e) {
      try {
        const resized = await _downscalePaperImage(e.target.result, PAPER_CUSTOM_MAX_PX);
        if (typeof window.setCustomPaperTexture === "function") {
          window.setCustomPaperTexture(resized);
        }
        if (paperEnabledChk) paperEnabledChk.checked = true; // caricare = accendere
        flashToast(__t("toast.paper.loaded", null, "🖼 Carta personalizzata caricata"));
        if (typeof scheduleAutoSave === "function") scheduleAutoSave();
      } catch (err) {
        console.error("[PaperTexture] custom load error", err);
        flashToast(__t("toast.paper.tooLarge", null, "⚠️ Immagine troppo grande o non valida"));
      }
      ev.target.value = "";
    };
    reader.readAsDataURL(f);
  });
}

// Torna alla carta predefinita
if (paperResetBtn) {
  paperResetBtn.addEventListener("click", () => {
    if (typeof window.resetPaperTextureToDefault === "function") {
      window.resetPaperTextureToDefault();
    }
    flashToast(__t("toast.paper.reset", null, "↺ Carta predefinita ripristinata"));
    if (typeof scheduleAutoSave === "function") scheduleAutoSave();
  });
}

// Stato iniziale dei controlli all'avvio
updatePaperUI();
// Esposta su window: viene richiamata da applyProjectData e executeNewProject,
// che vivono in scope diversi nel file.
window.updatePaperUI = updatePaperUI;

// ============== EXPORT PDF (con modale di scelta) ==============
async function handleExportPdfA4() {
  if (!canvas) return flashToast(__t("toast.canvas.notReady", null, "Canvas non pronto"));
  // Aggiorna lo stato disabilitato dell'opzione "immagine di sfondo"
  refreshPdfExportModalState();
  showPdfExportModal();
}

// ============== PDF EXPORT — modale + generazione configurabile ==============
function showPdfExportModal() {
  const modal = document.getElementById("pdfExportModal");
  if (!modal) return;
  modal.style.display = "flex";
}
function hidePdfExportModal() {
  const modal = document.getElementById("pdfExportModal");
  if (modal) modal.style.display = "none";
}

// Disabilita "Solo forme con immagine di sfondo" se non c'è un'immagine caricata
function refreshPdfExportModalState() {
  const opt = document.getElementById("pdfOptShapesOnBg");
  if (!opt) return;
  const hasBg = !!(typeof backgroundImageObject !== "undefined" && backgroundImageObject);
  const radio = opt.querySelector('input[type="radio"]');
  if (hasBg) {
    opt.classList.remove("disabled");
    if (radio) radio.disabled = false;
  } else {
    opt.classList.add("disabled");
    if (radio) {
      radio.disabled = true;
      if (radio.checked) {
        const fallback = document.querySelector('#pdfExportModal input[value="full"]');
        if (fallback) fallback.checked = true;
      }
    }
  }
}

function getSelectedPdfMode() {
  const r = document.querySelector('#pdfExportModal input[name="pdfMode"]:checked');
  return r ? r.value : "full";
}

/**
 * Genera un dataURL ad alta risoluzione del canvas in base alla modalità scelta
 * e lo invia al main process per essere incapsulato in PDF A4.
 *
 * mode:
 *   "full"                 → tutto il canvas così com'è (sfondo + texture + watercolor + freehand + forme)
 *   "shapesOnPaper"        → solo forme + texture carta
 *   "shapesOnBg"           → solo forme + immagine di sfondo
 *   "shapesOnWhite"        → solo forme + sfondo bianco
 *   "shapesOnTransparent"  → solo forme + sfondo trasparente
 */
async function exportPdfWithMode(mode) {
  if (!canvas) return flashToast(__t("toast.canvas.notReady", null, "Canvas non pronto"));
  const CW = canvas.getWidth();
  const CH = canvas.getHeight();

  // Calcolo multiplier dinamico per ottenere 300 DPI reali sul foglio A4
  // A4 portrait → 210mm x 297mm → 2480 x 3508 px @ 300 DPI
  const longSideMm = Math.max(A4_MM_W, A4_MM_H);
  const longSidePx = Math.max(CW, CH);
  const targetLongPx = (longSideMm * 300) / 25.4; // px a 300 DPI
  const multiplier = Math.max(1, targetLongPx / longSidePx);

  const orientation = CW > CH ? "landscape" : "portrait";

  flashToast(__t("toast.pdf.generating", null, "⏳ Generazione PDF ad alta risoluzione…"));

  let dataURL;

  try {
    if (mode === "full") {
      // ========== Caso 1: tutto il canvas così com'è ==========
      dataURL = canvas.toDataURL({
        format: "png",
        multiplier,
        left: 0,
        top: 0,
        width: CW,
        height: CH
      });
    } else {
      // ========== Casi 2–5: ricomposizione su canvas temporaneo ==========
      dataURL = await renderConfiguredCanvas(mode, CW, CH, multiplier);
    }

    if (!dataURL) {
      flashToast(__t("toast.pdf.cancelled", null, "❌ Generazione PDF annullata"));
      return;
    }

    const result = await window.desktopAPI?.exportPDFImage({ imgData: dataURL, orientation });
    if (result) flashToast(__t("toast.pdf.done", null, "✅ PDF A4 esportato a 300 DPI"));
  } catch (err) {
    console.error("Errore export PDF:", err);
    flashToast(__t("toast.pdf.error", null, "❌ Errore durante l'export PDF"));
  }
}

/**
 * Costruisce un fabric.Canvas temporaneo includendo solo gli elementi
 * richiesti dalla modalità, e ritorna il dataURL PNG.
 */
async function renderConfiguredCanvas(mode, CW, CH, multiplier) {
  const tempEl = document.createElement("canvas");

  // Sfondo del canvas temporaneo
  let bgColor;
  if (mode === "shapesOnWhite") bgColor = "#ffffff";
  else if (mode === "shapesOnTransparent")
    bgColor = null; // PNG con alpha
  else bgColor = "#f8f6f0"; // base neutra (verrà coperta da paper o bg image)

  const tempFabric = new fabric.Canvas(tempEl, {
    width: CW,
    height: CH,
    backgroundColor: bgColor,
    enableRetinaScaling: false,
    preserveObjectStacking: true
  });

  try {
    // ===== 1. Texture carta (solo per "shapesOnPaper") =====
    if (mode === "shapesOnPaper") {
      const paperSrc =
        (typeof paperTextureDataURL !== "undefined" && paperTextureDataURL) ||
        (await window.paperTextureAPI?.getDataURL?.());
      if (paperSrc) {
        await new Promise((resolve) => {
          fabric.Image.fromURL(
            paperSrc,
            (img) => {
              img.set({
                left: 0,
                top: 0,
                originX: "left",
                originY: "top",
                selectable: false,
                evented: false,
                opacity: 0.22,
                __isBackground: true
              });
              img.scaleToWidth(CW);
              img.scaleToHeight(CH);
              tempFabric.add(img);
              tempFabric.sendToBack(img);
              resolve();
            },
            { crossOrigin: "anonymous" }
          );
        });
      }
    }

    // ===== 2. Immagine di sfondo (solo per "shapesOnBg") =====
    if (mode === "shapesOnBg" && backgroundImageObject) {
      await new Promise((resolve) => {
        backgroundImageObject.clone((cl) => {
          cl.set({ selectable: false, evented: false, __isBackground: true });
          tempFabric.add(cl);
          tempFabric.sendToBack(cl);
          resolve();
        });
      });
    }

    // ===== 3. Forme geometriche (sempre, per le modalità "shapes*") =====
    const shapes = canvas.getObjects().filter((obj) => !isWatercolorOrFreehand(obj) && !obj.__isBackground);

    if (shapes.length > 0) {
      const shapeClones = await Promise.all(
        shapes.map(
          (p) =>
            new Promise((r) =>
              p.clone((cl) => {
                // clone() serializza via toObject() -> il Pattern texture emette
                // solo un colore segnaposto e il clone perde la texture. La
                // rimettiamo riusando la sorgente viva dell'originale.
                restoreTextureOnClone(p, cl);
                r(cl);
              })
            )
        )
      );
      shapeClones.forEach((cl) => tempFabric.add(cl));
    }

    tempFabric.renderAll();

    return tempFabric.toDataURL({
      format: "png",
      multiplier,
      left: 0,
      top: 0,
      width: CW,
      height: CH
    });
  } finally {
    try {
      tempFabric.dispose();
    } catch (e) {}
  }
}

// Listener della modale (eseguiti subito, dipendono solo da elementi statici dell'HTML)
(function wirePdfExportModal() {
  const modal = document.getElementById("pdfExportModal");
  if (!modal) return;
  const closeBtn = document.getElementById("pdfExportCloseBtn");
  const cancelBtn = document.getElementById("pdfExportCancelBtn");
  const confirmBtn = document.getElementById("pdfExportConfirmBtn");

  closeBtn?.addEventListener("click", hidePdfExportModal);
  cancelBtn?.addEventListener("click", hidePdfExportModal);

  // Chiusura cliccando fuori dal box
  modal.addEventListener("click", (e) => {
    if (e.target === modal) hidePdfExportModal();
  });

  confirmBtn?.addEventListener("click", async () => {
    const mode = getSelectedPdfMode();
    hidePdfExportModal();
    await exportPdfWithMode(mode);
  });
})();

// ============== MENU RADIALE DINAMICO – CENTRATO ESATTAMENTE SUL CENTRO GEOMETRICO ==============
if (radial) {
  // assicurati che ci sia una transizione CSS per la larghezza/altezza/left/top se vuoi animazione
  radial.style.transition = "left 160ms ease, top 160ms ease, width 180ms ease, height 180ms ease, opacity 160ms ease";
}

// ============== MENU RADIALE ==============
function positionRadial() {
  if (!radial) return;

  const active = canvas.getActiveObject();
  if (!active) {
    hideRadial();
    return;
  }

  // ── MULTI-SELEZIONE → dock verticale accanto all'ultima forma selezionata.
  // Il layout circolare insegue il bounding box della selezione e con molte
  // forme (anche a zoom basso) usciva dallo schermo. Il dock è compatto,
  // sempre dentro la finestra, indipendente da zoom e numero di forme.
  if (active.type === "activeSelection") {
    positionRadialDockVertical(active);
    updateMeasureOverlay();
    return;
  }

  const center = getSelectionCenterPoint();
  const screen = canvasToScreen(center);

  // 🔥 USIAMO getScaledWidth/Height → dimensione invariata durante la rotazione
  const w = active.getScaledWidth ? active.getScaledWidth() : active.width || 0;
  const h = active.getScaledHeight ? active.getScaledHeight() : active.height || 0;
  const shapeDiameter = Math.max(w, h) * view.scale;

  let desiredRadius = Math.round(shapeDiameter * 1.35);
  desiredRadius = Math.max(95, Math.min(280, desiredRadius));

  // Margine di sicurezza per maniglie
  const minimal = Math.ceil(shapeDiameter * 0.55 + 30);
  desiredRadius = Math.max(desiredRadius, minimal);

  // ── Moltiplicatore slider (0%..+30%) ─────────────────────────────────────
  // Applicato DOPO i clamp così l'utente può spingere oltre i 280px anche a
  // zoom alto, dove altrimenti il raggio resterebbe bloccato.
  const _sliderMul = 1 + (radialSizeOffsetPct || 0) / 100;
  desiredRadius = Math.round(desiredRadius * _sliderMul);

  // Applica subito
  radial.style.setProperty("--radial-radius", `${desiredRadius}px`);
  radial.style.width = `${desiredRadius * 2}px`;
  radial.style.height = `${desiredRadius * 2}px`;
  radial.style.left = `${Math.round(screen.x - desiredRadius)}px`;
  radial.style.top = `${Math.round(screen.y - desiredRadius)}px`;
  radial.style.display = "block";
  radial.style.opacity = "1";

  void radial.offsetHeight; // forza reflow

  arrangeRadialButtonsDynamic(desiredRadius);
  updateMeasureOverlay();
}

// ============== DOCK VERTICALE PER MULTI-SELEZIONE ==============
const DOCK_BTN_GAP = 8;         // spazio tra i pulsanti
const DOCK_GAP_FROM_SHAPE = 22; // distanza dal bordo della forma àncora
const DOCK_SCREEN_MARGIN = 12;  // margine minimo dai bordi finestra

function positionRadialDockVertical(active) {
  if (!radial) return;

  radial.style.display = "block";
  radial.style.opacity = "1";

  const buttons = Array.from(radial.querySelectorAll(".radial-btn")).filter((b) => b.offsetParent !== null);
  const n = buttons.length;
  if (n === 0) return;

  // Riusa la cache dimensioni pulsante di arrangeRadialButtonsDynamic
  if (!_radialBtnSize) {
    const first = buttons[0];
    _radialBtnSize = { w: first.offsetWidth || 48, h: first.offsetHeight || 48 };
  }
  const bw = _radialBtnSize.w;
  const bh = _radialBtnSize.h;

  // ── Di norma 1 colonna; si spezza in più colonne SOLO se la colonna
  //    intera non entra nell'altezza della finestra ──
  const availH = Math.max(bh, window.innerHeight - DOCK_SCREEN_MARGIN * 2);
  const fullColH = n * bh + (n - 1) * DOCK_BTN_GAP;
  const cols = Math.max(1, Math.ceil(fullColH / availH));
  const rows = Math.ceil(n / cols);
  const dockW = cols * bw + (cols - 1) * DOCK_BTN_GAP;
  const dockH = rows * bh + (rows - 1) * DOCK_BTN_GAP;

  // ── Àncora: ultima forma selezionata (fallback: ultima della selezione) ──
  let anchorObj = radialDockAnchorObj;
  const objs = active._objects || [];
  if (!anchorObj || objs.indexOf(anchorObj) < 0) {
    anchorObj = objs.length ? objs[objs.length - 1] : active;
  }

  // ── Bounding box ASSOLUTO dell'àncora in coordinate canvas ──────────────
  // ATTENZIONE (era il bug): su un figlio di ActiveSelection NON si può
  // usare getBoundingRect(true, true) — i figli hanno left/top RELATIVI al
  // centro della selezione (stessa convenzione gestita in paste/duplica) e
  // le aCoords ignorano la matrice del wrapper, quindi tornava un rettangolo
  // "relativo" vicino allo zero → dock in alto a sinistra, zoom ignorato.
  // calcTransformMatrix() invece INCLUDE la matrice del wrapper (posizione,
  // scala, rotazione della selezione): trasformiamo i 4 angoli locali della
  // forma e ne ricaviamo il bbox assoluto. Segue la forma anche durante il
  // drag della selezione. Compatibile Fabric 5.1.0 → 5.3.0.
  let aRect;
  try {
    const m = anchorObj.calcTransformMatrix();
    const hw = (anchorObj.width || 0) / 2;
    const hh = (anchorObj.height || 0) / 2;
    const pts = [
      fabric.util.transformPoint({ x: -hw, y: -hh }, m),
      fabric.util.transformPoint({ x: hw, y: -hh }, m),
      fabric.util.transformPoint({ x: hw, y: hh }, m),
      fabric.util.transformPoint({ x: -hw, y: hh }, m)
    ];
    aRect = fabric.util.makeBoundingBoxFromPoints(pts);
  } catch (err) {
    // Fallback prudente: bbox dell'intera selezione (il wrapper è un oggetto
    // top-level, quindi per lui getBoundingRect assoluto è corretto).
    aRect = active.getBoundingRect(true, true);
  }

  // ── Canvas → schermo: stessa formula di canvasToScreen (lo zoom di
  //    Mosaica è un CSS transform su #paper, quindi × view.scale) ──
  const paperRect = paper.getBoundingClientRect();
  const sLeft = paperRect.left + aRect.left * view.scale;
  const sTop = paperRect.top + aRect.top * view.scale;
  const sW = aRect.width * view.scale;
  const sH = aRect.height * view.scale;
  const sRight = sLeft + sW;

  // ── Lato: a destra della forma se c'è spazio, altrimenti a sinistra;
  //    se nessuno dei due basta (zoom altissimo, forma larga quanto lo
  //    schermo) il clamp finale lo tiene comunque dentro la finestra ──
  const spaceRight = window.innerWidth - DOCK_SCREEN_MARGIN - (sRight + DOCK_GAP_FROM_SHAPE);
  const spaceLeft = sLeft - DOCK_GAP_FROM_SHAPE - DOCK_SCREEN_MARGIN;

  let left;
  if (spaceRight >= dockW || spaceRight >= spaceLeft) {
    left = sRight + DOCK_GAP_FROM_SHAPE;
  } else {
    left = sLeft - DOCK_GAP_FROM_SHAPE - dockW;
  }
  left = Math.min(Math.max(left, DOCK_SCREEN_MARGIN), Math.max(DOCK_SCREEN_MARGIN, window.innerWidth - DOCK_SCREEN_MARGIN - dockW));

  // ── Verticale: centrato sulla parte VISIBILE della forma àncora.
  //    A zoom alto la forma può essere più alta dello schermo: il suo
  //    centro geometrico finirebbe fuori vista e il dock con lui. Quindi
  //    prima limitiamo il centro-àncora alla finestra, poi centriamo. ──
  const visTop = Math.max(sTop, 0);
  const visBottom = Math.min(sTop + sH, window.innerHeight);
  const anchorCy = visBottom > visTop
    ? (visTop + visBottom) / 2                       // forma (in parte) visibile
    : Math.min(Math.max(sTop + sH / 2, 0), window.innerHeight); // forma del tutto fuori vista

  let top = anchorCy - dockH / 2;
  top = Math.min(Math.max(top, DOCK_SCREEN_MARGIN), Math.max(DOCK_SCREEN_MARGIN, window.innerHeight - DOCK_SCREEN_MARGIN - dockH));

  // Stessi 4 valori inline letti da updateMeasureOverlay → gli indicatori
  // L/A si agganciano da soli sotto il dock, senza modifiche all'overlay.
  radial.style.width = `${dockW}px`;
  radial.style.height = `${dockH}px`;
  radial.style.left = `${Math.round(left)}px`;
  radial.style.top = `${Math.round(top)}px`;

  // ── Disposizione pulsanti in colonna (riempie per colonne) ──
  buttons.forEach((btn, i) => {
    const col = Math.floor(i / rows);
    const row = i % rows;
    btn.style.left = `${col * (bw + DOCK_BTN_GAP)}px`;
    btn.style.top = `${row * (bh + DOCK_BTN_GAP)}px`;
  });
}

let _radialBtnSize = null; // ← aggiungere come variabile modulo vicino a RADIAL_DEFAULT_RADIUS

// Invalida la cache al resize: il layout radiale si ricalcola con le dimensioni corrette
window.addEventListener("resize", () => {
  _radialBtnSize = null;
});

function arrangeRadialButtonsDynamic(currentRadius) {
  if (!radial) return;
  const buttons = Array.from(radial.querySelectorAll(".radial-btn")).filter((b) => b.offsetParent !== null);
  const num = buttons.length;
  if (num === 0) return;
  const centerOffset = currentRadius;

  // Legge le dimensioni una volta sola, poi le riusa
  if (!_radialBtnSize) {
    const first = buttons[0];
    _radialBtnSize = { w: first.offsetWidth || 48, h: first.offsetHeight || 48 };
  }
  const bw = _radialBtnSize.w;
  const bh = _radialBtnSize.h;

  buttons.forEach((btn, i) => {
    const angle = (i * 360) / num - 90;
    const rad = (angle * Math.PI) / 180;
    const x = Math.cos(rad) * currentRadius;
    const y = Math.sin(rad) * currentRadius;
    btn.style.left = `${Math.round(centerOffset + x - bw / 2)}px`;
    btn.style.top = `${Math.round(centerOffset + y - bh / 2)}px`;
  });
}

// ============== SLIDER DIMENSIONE MENU RADIALE ==============
// Lo slider vive dentro #measureOverlay (sotto gli indicatori L/A) e segue
// quindi il menu radiale per via dell'ancoraggio già esistente nell'overlay.
const radialSizeSlider = document.getElementById("radialSizeSlider");
if (radialSizeSlider) {
  radialSizeSlider.addEventListener("input", () => {
    radialSizeOffsetPct = parseFloat(radialSizeSlider.value) || 0;
    if (canvas.getActiveObject()) {
      positionRadial(); // ricalcola raggio + ridispone i pulsanti
    }
  });
  // Doppio click sullo slider → reset a 0
  radialSizeSlider.addEventListener("dblclick", () => {
    radialSizeSlider.value = 0;
    radialSizeOffsetPct = 0;
    if (canvas.getActiveObject()) positionRadial();
  });
}

function hideRadial() {
  if (radial) radial.style.display = "none";
  if (overlay) overlay.style.display = "none"; // ← assicurati questa riga
}

// ============== SLICE CIRCLE / ELLISSE ==============
// - Metà (Alt+click) → 2 parti SOVRAPPOSTE sul centro (come prima)
// - Quarti (click normale) → 4 parti POSTE UNA DOPO L'ALTRA in fila orizzontale (senza sovrapposizione)
function sliceCircleAction(isAltKey) {
  const obj = canvas.getActiveObject();
  if (!obj || (obj.type !== "circle" && obj.type !== "ellipse")) {
    flashToast(__t("toast.slice.needCircleOrEllipse", null, "❌ Seleziona prima un cerchio o un'ellisse"));
    return;
  }

  const numSlices = isAltKey ? 2 : 4;
  const sweepDeg = 360 / numSlices;
  const cx = obj.left; // centro originale
  const cy = obj.top;
  const rx = obj.getScaledWidth() / 2;
  const ry = obj.getScaledHeight() / 2;
  const fillColor = obj.fill || "#78a0ff";
  const currentAngle = obj.angle || 0;

  // Rimuoviamo l'oggetto originale
  canvas.remove(obj);

  const isHalves = numSlices === 2;
  const gap = rx * 0.25; // spazio tra un quarto e l'altro (regolabile)

  for (let i = 0; i < numSlices; i++) {
    const startDeg = i * sweepDeg;

    const model = new CircleSectorModel(startDeg, sweepDeg, rx, ry);
    const pathData = model.getPath(0, 0);

    // Posizionamento diverso in base alla modalità
    let leftPos = cx;
    if (!isHalves) {
      // Modalità "quarti in fila"
      leftPos = cx + i * (rx + gap); // spostiamo a destra raggio + gap
    }

    const sector = new fabric.Path(pathData, {
      left: leftPos,
      top: cy,
      originX: "center",
      originY: "center",
      fill: fillColor,
      stroke: null,
      strokeWidth: 0,
      angle: currentAngle,
      __shapeType: "sector",
      __shape: model.toJSON(px2mm),
      customId: generateUID(),
      selectable: true,
      evented: true
    });

    canvas.add(sector);
    applyHandlePreset(sector); // ← FIX: preset padding/corner per i settori
    updateHandlesSpacing(sector); // ← FIX: applica subito le maniglie ottimizzate
  }

  canvas.renderAll();
  pushState();

  if (isHalves) {
    flashToast(__t("toast.slice.halves", null, `✅ Diviso in 2 metà (sovrapposte perfettamente sul centro)`));
  } else {
    flashToast(__t("toast.slice.quarters", null, `✅ Diviso in 4 quarti disposti in fila (senza sovrapposizione)`));
  }
}

// (I listener selection:* sono già registrati una volta sola nel blocco canonico sopra)

// ============== SELEZIONE + CONTROLLI ANGOLI + DUPLICATE CORRETTO ==============
function toggleAngleControls() {
  const container = document.getElementById("angleControlsContainer");
  if (!container) return;

  const active = canvas.getActiveObject();
  const isTriangle =
    active && (active.__shapeType === "triangle" || (active.type === "polygon" && active.__shape?.angles));

  if (isTriangle) {
    // ── BAKE PREVENTIVO: garantisce che __shape.angles sia coerente con i
    // punti reali a schermo. Se l'utente ha scalato il triangolo con le
    // maniglie, senza il bake gli slider mostrerebbero i valori PRIMA dello
    // scaling — disallineati dalla geometria reale.
    if (active.type === "polygon" && typeof bakeTriangleScaleIntoPoints === "function") {
      bakeTriangleScaleIntoPoints(active);
    }

    // Aggiorna slider con valori reali dell'oggetto, arrotondati a 0.1°
    const alphaSlider = document.getElementById("angleAlpha");
    const betaSlider = document.getElementById("angleBeta");
    const round1 = (v) => Math.round(Number(v) * 10) / 10;

    if (alphaSlider && active.__shape?.angles) {
      const a = round1(active.__shape.angles[0]);
      alphaSlider.value = a;
      document.getElementById("alphaValue").textContent = a.toFixed(1) + "°";
    }
    if (betaSlider && active.__shape?.angles) {
      const b = round1(active.__shape.angles[1]);
      betaSlider.value = b;
      document.getElementById("betaValue").textContent = b.toFixed(1) + "°";
    }
  }

  // Visibilità sezione gestita dall'Inspector contestuale (bootMosaicaUI):
  // se isTriangle → mostra sezione triangolo, altrimenti mostra default/altro contesto.
  if (typeof window.refreshInspectorContext === "function") {
    window.refreshInspectorContext();
  }
}
function toggleAngleControls() {
  const container = document.getElementById("angleControlsContainer");
  if (!container) return;

  const active = canvas.getActiveObject();
  const isTriangle =
    active && (active.__shapeType === "triangle" || (active.type === "polygon" && active.__shape?.angles));

  if (isTriangle) {
    // ── BAKE PREVENTIVO ────────────────────────────────────────────────────
    // Garantisce che __shape.angles sia coerente con i punti reali a schermo.
    // Senza il bake, gli slider mostrerebbero valori PRE handle-scaling,
    // disallineati dalla geometria reale.
    if (active.type === "polygon" && typeof bakeTriangleScaleIntoPoints === "function") {
      bakeTriangleScaleIntoPoints(active);
    }

    const alphaSlider = document.getElementById("angleAlpha");
    const betaSlider = document.getElementById("angleBeta");
    const round1 = (v) => Math.round(Number(v) * 10) / 10;

    if (alphaSlider && betaSlider && active.__shape?.angles) {
      // ── MAPPING MODELLO → VISUALE ───────────────────────────────────────
      // Speculare a quanto fa applyTriangleAngleChange: se A (pts[0]) è
      // visivamente a destra di B (pts[1]) — succede tipicamente con
      // obj.angle ≈ 180° o dopo certi specchiamenti — gli slider mostrano
      // i valori SWAPPATI così "α" è sempre l'angolo che si vede nel
      // vertice di base più a sinistra.
      const aIsLeft = typeof _triangleAisVisuallyLeftOfB === "function" ? _triangleAisVisuallyLeftOfB(active) : true;

      const modelAlpha = active.__shape.angles[0];
      const modelBeta = active.__shape.angles[1];

      const visAlpha = aIsLeft ? modelAlpha : modelBeta;
      const visBeta = aIsLeft ? modelBeta : modelAlpha;

      const a = round1(visAlpha);
      const b = round1(visBeta);

      alphaSlider.value = a;
      document.getElementById("alphaValue").textContent = a.toFixed(1) + "°";
      betaSlider.value = b;
      document.getElementById("betaValue").textContent = b.toFixed(1) + "°";
    }
  }

  // Visibilità sezione gestita dall'Inspector contestuale (bootMosaicaUI):
  // se isTriangle → mostra sezione triangolo, altrimenti mostra default/altro contesto.
  if (typeof window.refreshInspectorContext === "function") {
    window.refreshInspectorContext();
  }
}

// DUPLICATE CORRETTO — deep clone asincrono + conversione coord relative→assolute
// per ActiveSelection/Group, e offset orizzontale puro per singola forma.
function radialDuplicateAction() {
  const active = canvas.getActiveObject();
  if (!active) {
    flashToast(__t("toast.selection.selectFirst", null, "Seleziona prima un oggetto"));
    return;
  }

  // Helper: rende un clone completamente indipendente dall'originale.
  // newLeft / newTop sono già coordinate ASSOLUTE del canvas (calcolate dal chiamante).
  function finalizeClone(clone, source, newLeft, newTop) {
    clone.set({
      left: newLeft,
      top: newTop,
      selectable: true,
      evented: true,
      hasControls: true,
      hasBorders: true,
      objectCaching: false
    });
    clone.customId = generateUID();

    // Deep-copy metadati forma
    clone.__shapeType = source.__shapeType || null;
    clone.__shape = source.__shape ? JSON.parse(JSON.stringify(source.__shape)) : null;

    // Deep-copy dei punti per poligoni (evita che modifiche al clone alterino l'originale)
    if (Array.isArray(clone.points)) {
      clone.points = clone.points.map((p) => ({ x: p.x, y: p.y }));
    }

    clone.setCoords();
  }

  // Offset per la copia, in coordinate canvas (NON pixel schermo).
  // - SINGOLA forma: solo orizzontale (Y=0) → copia a destra alla stessa quota verticale.
  // - MULTI selezione / gruppo: stesso pattern di CTRL+V (+25, +25) per coerenza con
  //   la scorciatoia da tastiera che l'utente già usa correttamente.
  const OFFSET_X_SINGLE = 25;
  const OFFSET_Y_SINGLE = 0;
  const OFFSET_X_MULTI = 25;
  const OFFSET_Y_MULTI = 25;

  if (active.type === "group") {
    // Gruppo statico: i figli hanno left/top RELATIVI al centro del gruppo.
    // Coord assolute = groupCenter + (objLeft, objTop)
    const items = active.getObjects();
    const groupCenter = active.getCenterPoint();

    const promises = items.map(
      (obj) =>
        new Promise((res) => {
          obj.clone(
            (cl) => {
              const absX = groupCenter.x + (obj.left || 0);
              const absY = groupCenter.y + (obj.top || 0);
              finalizeClone(cl, obj, absX + OFFSET_X_MULTI, absY + OFFSET_Y_MULTI);
              res(cl);
            },
            ["__shape", "__shapeType", "customId", "__isFreehand", "__isBackground"]
          );
        })
    );
    Promise.all(promises).then((clones) => {
      clones.forEach((cl) => canvas.add(cl));
      const sel = new fabric.ActiveSelection(clones, { canvas });
      canvas.setActiveObject(sel);
      selectedObj = sel;
      canvas.renderAll();
      pushState();
      positionRadial();
      flashToast(__t("toast.group.duplicated", { count: clones.length }, `✅ Gruppo duplicato (${clones.length} oggetti)`));
    });
  } else if (active.type === "activeSelection") {
    // Selezione multipla → duplica ciascun oggetto.
    // In una ActiveSelection di Fabric, i figli hanno left/top RELATIVI al
    // centro della selezione. Per posizionarli correttamente nel canvas
    // serve la conversione: absolute = selectionCenter + (objLeft, objTop).
    const items = active._objects || [];
    const selCenter = active.getCenterPoint();

    const promises = items.map(
      (obj) =>
        new Promise((res) => {
          obj.clone(
            (cl) => {
              const absX = selCenter.x + (obj.left || 0);
              const absY = selCenter.y + (obj.top || 0);
              finalizeClone(cl, obj, absX + OFFSET_X_MULTI, absY + OFFSET_Y_MULTI);
              res(cl);
            },
            ["__shape", "__shapeType", "customId", "__isFreehand", "__isBackground"]
          );
        })
    );
    Promise.all(promises).then((clones) => {
      clones.forEach((cl) => canvas.add(cl));
      const sel = new fabric.ActiveSelection(clones, { canvas });
      canvas.setActiveObject(sel);
      selectedObj = sel;
      canvas.renderAll();
      pushState();
      positionRadial();
      flashToast(__t("toast.objects.duplicated", { count: clones.length }, `✅ ${clones.length} oggetti duplicati`));
    });
  } else {
    // Oggetto singolo — left/top già assoluti.
    // Posizione copia: stessa quota verticale, spostata solo sull'asse X.
    active.clone(
      (clone) => {
        const absX = (active.left || 0) + OFFSET_X_SINGLE;
        const absY = (active.top || 0) + OFFSET_Y_SINGLE;
        finalizeClone(clone, active, absX, absY);
        canvas.add(clone);
        canvas.setActiveObject(clone);
        selectedObj = clone;
        canvas.renderAll();
        pushState();
        positionRadial();
        toggleAngleControls();
        populateTrapezoidControlsFromObject(clone);
        requestAnimationFrame(() => requestAnimationFrame(updateMeasureOverlay));
        flashToast(__t("toast.shape.duplicated", null, "✅ Forma duplicata"));
      },
      ["__shape", "__shapeType", "customId", "__isFreehand", "__isBackground"]
    );
  }
}

// (Tutti i listener canvas sono già registrati nel blocco canonico — nessuna registrazione duplicata qui)

// Radial click — gestore dedicato SOLO per 'duplicate'
// (sliceCircle è gestito dal listener separato a fine file; gli altri action dal listener principale)
radial.addEventListener("click", (e) => {
  const btn = e.target.closest(".radial-btn");
  if (!btn) return;
  if (btn.dataset.action === "duplicate") {
    radialDuplicateAction();
  }
});

// (object:moving / scaling / rotating / modified già gestiti nel blocco canonico sopra)

// Garantisce che un semplice click su un oggetto ricentri radial + overlay
canvas.on("mouse:down", (e) => {
  if (!e || !e.target) return;
  // Oggetto cliccato: forziamo ricalcolo del radial e degli overlay
  positionRadial();
  // doppio RAF per essere sicuri DOM sia aggiornato
  requestAnimationFrame(() => requestAnimationFrame(updateMeasureOverlay));
});

// (selection:created / selection:updated / object:modified già gestiti
//  nei listener canonici sopra ai blocchi ~2473 / 2490 / 2620. Listener
//  duplicati rimossi per evitare lavoro doppio su multi-selezione massiccia.)

// Click sui bottoni radial (versione completa)
radial.addEventListener("click", (e) => {
  const btn = e.target.closest(".radial-btn");
  if (!btn) return;
  const action = btn.dataset.action;

  if (action === "sliceCircle") {
    sliceCircleAction(e.altKey); // Alt+click = 2 metà
    return;
  }
});

// ============== INIZIALIZZAZIONE ==============
(async () => {
  try {
    if (window.calibrationAPI?.load) {
      const d = await window.calibrationAPI.load();
      calibrationFactor = d?.calibrationFactor ? parseFloat(d.calibrationFactor) : 1;
    } else {
      calibrationFactor = parseFloat(localStorage.getItem("mosaica_calibration_factor")) || 1;
    }
  } catch (e) {
    calibrationFactor = parseFloat(localStorage.getItem("mosaica_calibration_factor")) || 1;
  }

  CSS_PPI = detectCssPpi();
  base_MM_TO_PX = CSS_PPI / 25.4;
  setPaperSizeFromMM();

  view.x = (window.innerWidth - mm2px(A4_MM_W)) / 2;
  view.y = (window.innerHeight - mm2px(A4_MM_H)) / 2;
  view.scale = 1;
  initialView = { ...view };

  applyTransform();
  updateCalibStrip();
  canvas.clear();

  (function () {
    const r = new fabric.Rect({
      left: mm2px(A4_MM_W / 2 - 5),
      top: mm2px(A4_MM_H / 2 - 5),
      width: mm2px(10),
      height: mm2px(10),
      fill: "#78a0ff",
      selectable: true,
      hasControls: true,
      hasBorders: true,
      originX: "left",
      originY: "top",
      __shapeType: "rect"
    });
    r.customId = generateUID();
    canvas.add(r);
  })();

  canvas.renderAll();
  if (typeof window.restoreFreehandLocks === "function") window.restoreFreehandLocks();
  restoreBackgroundLock();
  if (window.forceFixDeleteButton) window.forceFixDeleteButton();
  positionHistoryPanel();

  if (typeof loadTexturePanel === "function") await loadTexturePanel();
  pushState();
  enableHistoryButtons();

  initRadialTooltips();
  wireExportButtons();
  ensureTriangleAngleControlsExist();
  toggleAngleControls(); // mostra subito se c'è già un triangolo
  console.log("[renderer] inizializzazione completata");
})();

// ============== CALIBRAZIONE EVENT LISTENERS ==============
if (applyBtn) applyBtn.addEventListener("click", applyCalibration);
if (resetBtn) resetBtn.addEventListener("click", resetCalibration);

// imposta valore iniziale
if (measuredInput) measuredInput.value = "50.00";
if (miniValue) miniValue.textContent = `50 mm`;

// Checkbox Auto-Open
if (autoOpenCheckbox) {
  autoOpenCheckbox.addEventListener("change", async () => {
    if (autoOpenCheckbox.checked) {
      // Checkbox appena spuntata
      if (currentProjectPath) {
        // C'è un progetto aperto/salvato → registralo come auto-open
        await window.projectAPI?.setAutoOpen(currentProjectPath);
        flashToast(__t("toast.autoOpen.activated", null, "✅ Apertura automatica attivata per questo progetto"));
      } else {
        // Nessun progetto ancora salvato → avvisa l'utente
        flashToast(__t("toast.autoOpen.saveFirst", null, "⚠️ Salva prima il progetto per attivare l'apertura automatica"));
        // Deseleziona la checkbox perché non c'è nulla da registrare
        autoOpenCheckbox.checked = false;
      }
    } else {
      // Checkbox deselezionata → rimuovi auto-open
      await window.projectAPI?.setAutoOpen(null);
      flashToast(__t("toast.autoOpen.deactivated", null, "Apertura automatica disattivata"));
    }
  });
}

// Resize handler
window.addEventListener("resize", () => {
  CSS_PPI = detectCssPpi();
  base_MM_TO_PX = CSS_PPI / 25.4;
  setPaperSizeFromMM();
  initialView = {
    x: (window.innerWidth - mm2px(A4_MM_W)) / 2,
    y: (window.innerHeight - mm2px(A4_MM_H)) / 2,
    scale: view.scale
  };
  applyTransform();
  updateCalibStrip();
  positionHistoryPanel();
});

// Inizializza disegno a mano libera (dopo che canvas e DOM sono pronti)
setTimeout(() => {
  if (typeof window.initFreehandDrawing === "function") {
    window.initFreehandDrawing();
    console.log("[renderer] initFreehandDrawing eseguito correttamente");
  }
}, 150);

// Inizializza selezione lazo (dopo che canvas e DOM sono pronti)
setTimeout(() => {
  if (typeof window.initLassoSelection === "function") {
    window.initLassoSelection();
    console.log("[renderer] initLassoSelection eseguito correttamente");
  }
}, 160);

// Inizializza il PENNELLO selezione (modulo separato lassoBrushSelection.js)
setTimeout(() => {
  if (typeof window.initLassoBrushSelection === "function") {
    window.initLassoBrushSelection();
    console.log("[renderer] initLassoBrushSelection eseguito correttamente");
  }
}, 170);

// Inizializza gli AIUTI DISEGNO A MANO LIBERA (cerchio dimensione tratto +
// perimetro di contenimento — modulo freehandTools.js). Dopo Wacom, lazo e
// freehand cosi' trova brush, flag e poligono eventualmente gia' caricato.
setTimeout(() => {
  if (typeof window.initFreehandTools === "function") {
    window.initFreehandTools();
    console.log("[renderer] initFreehandTools eseguito correttamente");
  }
}, 180);

// ======================= CALIB PANEL – SINGOLO LISTENER (— visibile) =======================
let calibCollapsed = false;

function setCalibPanelState(collapsed) {
  calibCollapsed = !!collapsed;
  // Nuovo layout: il pannello è dentro il dropdown della topbar, apri/chiudi tramite classe
  const dd = document.getElementById("calibDropdown");
  if (dd) dd.classList.toggle("open", !collapsed);
  try {
    localStorage.setItem("mosaica_calib_collapsed_v3", collapsed ? "1" : "0");
  } catch (e) {}
}

function toggleCalibPanel() {
  setCalibPanelState(!calibCollapsed);
}

const calibToggleEl = document.getElementById("calibToggle");
if (calibToggleEl) {
  // NON usiamo replaceChildren() → non cancelliamo più il simbolo "—"
  calibToggleEl.addEventListener("click", toggleCalibPanel);
}

const calibMiniEl = document.getElementById("calibMini");
if (calibMiniEl) calibMiniEl.addEventListener("click", () => setCalibPanelState(false));

// Ripristino stato
try {
  const saved = localStorage.getItem("mosaica_calib_collapsed_v3");
  setCalibPanelState(saved === "1");
} catch (e) {}

// ======================= PATCH: separazioni UI / fix vari =======================
// 1) [DISATTIVATO] La vecchia patch wrappava #textureGrid in un contenitore
//    #textureThumbs con max-height fissa e una label duplicata. Ora il pannello
//    #texturePanel ha già la sua struttura nativa (vlabel verticale + grid che
//    occupa l'altezza piena disponibile), quindi questo wrapper è dannoso e
//    viene lasciato come no-op per non rompere riferimenti eventuali.
(function separateTextureThumbs() {
  // intenzionalmente vuoto — vedi commento sopra
})();

// 3) Ripristino pan con ALT + drag (anche quando il click parte dal CANVAS)
(function restoreAltPanOnCanvas() {
  try {
    const ws = document.getElementById("workspace");
    if (!ws) return;

    // Rimuoviamo l'eventuale listener precedente (non sempre possibile) e aggiungiamo il miglior fallback:
    ws.addEventListener(
      "mousedown",
      (e) => {
        if (e.button !== 0) return;
        // se il click è dentro un pannello UI ignora
        if (
          e.target.closest &&
          (e.target.closest("#calibPanel") ||
            e.target.closest(".radial-btn") ||
            e.target.closest("#measureOverlay") ||
            e.target.closest("#colorPopup") ||
            e.target.closest("#zoomPanel") ||
            e.target.closest("#historyPanel"))
        )
          return;

        // Se il click parte dal canvas e NON è Alt, allora non avviare panning (comportamento originale)
        if (e.target.tagName === "CANVAS" && !e.altKey) return;

        // Se il click è su canvas ma con Alt, abilitiamo il pan: disabilitiamo temporaneamente la selezione canvas
        if (e.target.tagName === "CANVAS" && e.altKey && canvas) {
          try {
            canvas.selection = false;
          } catch (err) {}
        }

        // Avvio pan
        panning = true;
        last.x = e.clientX;
        last.y = e.clientY;
      },
      { passive: false }
    );

    // Al rilascio riattiviamo la selezione canvas (se l'abbiamo disattivata)
    window.addEventListener("mouseup", () => {
      panning = false;
      try {
        if (canvas) canvas.selection = true;
      } catch (err) {}
    });
    // mousemove mantiene la logica esistente (usa var `panning`, `view`, `applyTransform`)
  } catch (e) {
    console.warn("restoreAltPanOnCanvas err", e);
  }
})();

// 5) Aggiunge pulsante "Nuovo progetto" con protezione doppio-click
// 5) Aggiunge pulsante "Nuovo progetto" con modale di conferma
(function addNewProjectButton() {
  try {
    const container = document.getElementById("projectControls");
    if (!container || document.getElementById("newProjectBtn")) return;

    const btn = document.createElement("button");
    btn.id = "newProjectBtn";
    btn.textContent = __t("ui.newProject.label", null, "Nuovo progetto");
    btn.title = __t("ui.newProject.tooltip", null, "Crea nuovo progetto (canvas vuoto)");
    btn.className = "bgBtn";
    btn.style.background = "#6f42c1";
    btn.style.marginTop = "6px";
    btn.style.color = "#fff";

    const saveBtn = document.getElementById("saveProjectBtn");
    if (saveBtn && saveBtn.parentNode) saveBtn.parentNode.insertBefore(btn, saveBtn.nextSibling);
    else container.appendChild(btn);

    // ── Funzione che esegue effettivamente il reset del progetto ──
    function executeNewProject() {
      // Cancella un eventuale pushState in debounce dal progetto precedente
      if (_pushDebounceTimer) {
        clearTimeout(_pushDebounceTimer);
        _pushDebounceTimer = null;
      }
      // Reset completo della storia: il nuovo progetto parte da capo
      undoStack = [];
      redoStack = [];
      _batchOperationDepth = 0;

      canvas.clear();
      backgroundMeta = null;
      if (backgroundImageObject) {
        canvas.remove(backgroundImageObject);
        backgroundImageObject = null;
      }
      updateBgPreviewUI(); // ← sblocca pulsante carica immagine

      // FASE 3 — il nuovo progetto riparte con la carta PREDEFINITA ACCESA:
      // azzera eventuale carta personalizzata o spegnimento ereditati dal
      // progetto precedente, poi aggiorna i controlli del pannello.
      if (typeof window.applyPaperTextureState === "function") {
        window.applyPaperTextureState({ enabled: true, customDataURL: null });
      }
      if (typeof window.updatePaperUI === "function") window.updatePaperUI();

      // Ripristina la texture carta che potrebbe essere stata nascosta
      // da uno sfondo del progetto precedente.
      if (typeof window.restorePaperTexture === "function") {
        window.restorePaperTexture();
      }

      // 🔑 Reset del path del progetto corrente: da questo momento l'autosave
      //    deve trattare la sessione come "nuovo progetto" e scrivere il file
      //    di sessione in userData/projects/ (es. "10 Maggio 2026 - 15:30.msp.json"),
      //    invece di sovrascrivere l'eventuale file auto-aperto all'avvio.
      currentProjectPath = null;

      // Aggiungi il rettangolo di riferimento di default
      const r = new fabric.Rect({
        left: mm2px(A4_MM_W / 2 - 5),
        top: mm2px(A4_MM_H / 2 - 5),
        width: mm2px(10),
        height: mm2px(10),
        fill: "#78a0ff",
        selectable: true,
        hasControls: true,
        hasBorders: true,
        originX: "left",
        originY: "top",
        __shapeType: "rect"
      });
      r.customId = generateUID();
      canvas.add(r);

      canvas.renderAll();
      pushState();
      enableHistoryButtons();
      flashToast(__t("toast.project.created", null, "Nuovo progetto creato"));
    }

    // ── Helper per gestire il modale di conferma ──
    const modal = document.getElementById("newProjectConfirmModal");
    const okBtn = document.getElementById("newProjectConfirmOkBtn");
    const cancelBtn = document.getElementById("newProjectConfirmCancelBtn");
    const closeBtn = document.getElementById("newProjectConfirmCloseBtn");

    function showNewProjectModal() {
      if (modal) modal.style.display = "flex";
    }
    function hideNewProjectModal() {
      if (modal) modal.style.display = "none";
    }

    // Click sul pulsante "Nuovo progetto"
    btn.addEventListener("click", () => {
      // Se canvas è praticamente vuoto (solo il rettangolo di default o nulla)
      // procediamo senza chiedere conferma
      if (canvas.getObjects().length <= 1) {
        executeNewProject();
        return;
      }
      // Altrimenti mostra il modale
      showNewProjectModal();
    });

    // Conferma → esegui reset e chiudi modale
    if (okBtn) {
      okBtn.addEventListener("click", () => {
        hideNewProjectModal();
        executeNewProject();
      });
    }

    // Annulla → chiudi modale
    if (cancelBtn) {
      cancelBtn.addEventListener("click", hideNewProjectModal);
    }

    // X → chiudi modale
    if (closeBtn) {
      closeBtn.addEventListener("click", hideNewProjectModal);
    }

    // Click sul backdrop (zona scura attorno al modale) → chiudi
    if (modal) {
      modal.addEventListener("click", (e) => {
        if (e.target === modal) hideNewProjectModal();
      });
    }
  } catch (e) {
    console.warn("addNewProjectButton err", e);
  }
})();

// ============== CHIUSURA GLOBALE MODALI CON TASTO ESC ==============
// Funziona per qualsiasi <div id="...Modal"> presente o futuro.
// Selettore: tutti i div il cui id termina in "Modal" (es. pdfExportModal,
// brushTipModal, newProjectConfirmModal, ecc.). Quando l'utente preme ESC,
// chiude il modale aperto con z-index più alto (cioè quello visivamente in
// cima, in caso di stack di modali). Coesiste con eventuali listener ESC
// individuali già presenti su singoli modali — è semplicemente idempotente.
(function setupGlobalModalEscClose() {
  if (window.__globalModalEscBound) return; // singleton: bind una volta sola
  window.__globalModalEscBound = true;

  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;

    // Trova tutti i modali attualmente aperti (display !== "none")
    const openModals = Array.from(document.querySelectorAll('div[id$="Modal"]')).filter((el) => {
      // Controlla sia lo style inline che lo style calcolato
      const inline = el.style.display;
      if (inline === "none") return false;
      if (inline && inline !== "") return true; // "flex", "block", ecc.
      // Fallback: se nessuno style inline, leggi il computed
      return getComputedStyle(el).display !== "none";
    });

    if (openModals.length === 0) return;

    // Se ce n'è più di uno aperto, chiudi quello con z-index maggiore
    // (= visivamente in cima); se sono pari, prendi l'ultimo nel DOM.
    let topModal = openModals[0];
    let topZ = parseInt(getComputedStyle(topModal).zIndex, 10) || 0;
    for (let i = 1; i < openModals.length; i++) {
      const z = parseInt(getComputedStyle(openModals[i]).zIndex, 10) || 0;
      if (z >= topZ) {
        topZ = z;
        topModal = openModals[i];
      }
    }

    topModal.style.display = "none";
    e.preventDefault();
    e.stopPropagation();
  });
})();

// ======================= GESTIONE UI SFONDO (unica fonte di verità) =======================
(function fixBackgroundUI() {
  const bgDrop = document.getElementById("bgDrop");
  const bgPreview = document.getElementById("bgPreview");
  const clearBtn = document.getElementById("bgClearBtn");
  const pickBtn = document.getElementById("bgPickBtn");
  const bgInfo = document.getElementById("bgInfo");

  if (!bgDrop || !bgPreview) return;

  function update() {
    const hasBg = bgPreview.style.display !== "none" && bgPreview.src && bgPreview.src.length > 50;

    // bgDrop rimane SEMPRE interagibile: non toccare mai pointerEvents su di esso.
    // Solo i figli vengono aggiustati se necessario.
    bgDrop.style.pointerEvents = "auto"; // ← MAI 'none', bgPickBtn è un suo figlio

    // pickBtn sempre cliccabile
    if (pickBtn) pickBtn.style.pointerEvents = "auto";

    // clearBtn: visibile solo se c'è uno sfondo
    if (clearBtn) {
      clearBtn.style.display = hasBg ? "" : "none";
      clearBtn.style.pointerEvents = "auto";
      clearBtn.disabled = false;
    }
  }

  // Reagisce a ogni cambio di src/style/display sull'anteprima
  const observer = new MutationObserver(update);
  observer.observe(bgPreview, { attributes: true, attributeFilter: ["src", "style", "display"] });

  // Esegui subito e dopo un tick (aspetta che il DOM sia pronto)
  update();
  setTimeout(update, 80);

  // Esposto globalmente in modo che i reset (nuovo progetto, apri progetto) possano forzarlo
  window.forceFixDeleteButton = update;
})();

// ---------- App Loader / Startup progress (in renderer.js, fine file) ----------
(function () {
  const loaderEl = document.getElementById("appLoader");
  const fillEl = document.getElementById("appLoaderFill");
  const pctEl = document.getElementById("appLoaderPercent");
  const etaEl = document.getElementById("appLoaderETA");

  if (!loaderEl || !fillEl || !pctEl || !etaEl) return;

  // Lista di task iniziali (aggiungi o togli funzioni reali presenti nel renderer)
  const tasks = [
    {
      key: "textures",
      fn: () => (loadTexturePanel ? loadTexturePanel() : Promise.resolve()),
      weight: 25,
      label: "Texture"
    },
    { key: "autoopen", fn: () => (tryAutoOpen ? tryAutoOpen() : Promise.resolve()), weight: 40, label: "Progetto" },
    { key: "canvasReady", fn: () => Promise.resolve(), weight: 20, label: "Canvas" }, // placeholder (puoi metterci altri init)
    { key: "finalize", fn: () => new Promise((r) => setTimeout(r, 220)), weight: 15, label: "Finalizzazione" }
  ];

  const totalWeight = tasks.reduce((s, t) => s + (t.weight || 0), 0);
  let doneWeight = 0;
  let startTime = Date.now();

  // Stato del task corrente, per il SOTTO-PROGRESSO: i task lunghi (apertura
  // progetto) riportano il loro avanzamento interno via window.__loaderSubProgress
  // cosi' la barra si muove DURANTE il task e non resta ferma fino alla fine.
  let curBase = 0; // peso completato PRIMA del task corrente
  let curWeight = 0; // peso del task corrente
  let loaderActive = false;
  let lastShownPct = 0;

  // Barra + ETA SINCERO. L'ETA si stima dal ritmo REALE misurato dall'inizio
  // del caricamento (tempo trascorso / percentuale gia' fatta), non dal solo
  // primo task banale: cosi' il numero ha senso e si auto-corregge mentre la
  // barra avanza. La barra non torna mai indietro (niente sfarfallii).
  function setProgress(percent) {
    percent = Math.max(0, Math.min(100, Number(percent) || 0));
    if (percent < lastShownPct) percent = lastShownPct;
    lastShownPct = percent;
    fillEl.style.width = `${percent}%`;
    pctEl.textContent = `${Math.round(percent)}%`;
    const elapsed = Date.now() - startTime;
    let etaMs = null;
    if (percent > 3 && percent < 99.5 && elapsed > 250) {
      etaMs = Math.round((elapsed * (100 - percent)) / percent);
    }
    etaEl.textContent = etaMs ? `ETA: ${Math.max(0, Math.round(etaMs / 1000))}s` : "⌛ —";
  }

  // Esposto ai task lunghi (es. apertura progetto in applyProjectData): frac e'
  // l'avanzamento 0..1 DENTRO il task corrente. No-op se il loader non e' attivo
  // (es. progetto aperto dal pulsante a app gia' avviata).
  window.__loaderSubProgress = function (frac, _label) {
    if (!loaderActive || !curWeight) return;
    frac = Math.max(0, Math.min(1, Number(frac) || 0));
    setProgress(((curBase + frac * curWeight) / totalWeight) * 100);
  };

  async function runTasksSequential() {
    // Timeout di sicurezza PER task: se non risolve entro questi ms il loader
    // prosegue lo stesso (evita blocchi se una callback non viene mai chiamata).
    // L'apertura progetto puo' richiedere piu' tempo su mosaici grandi: le diamo
    // molta piu' aria (60s) cosi' la barra non "schizza" a 100% lasciando il
    // caricamento a meta'; gli altri task restano corti.
    function taskTimeout(t) {
      return t && t.key === "autoopen" ? 60000 : 8000;
    }

    function withTimeout(promise, ms, key) {
      return new Promise((resolve) => {
        let done = false;
        const timer = setTimeout(() => {
          if (done) return;
          done = true;
          console.warn(`[loader] task "${key}" superato timeout di ${ms}ms — proseguo`);
          resolve();
        }, ms);
        Promise.resolve(promise).then(
          (v) => {
            if (done) return;
            done = true;
            clearTimeout(timer);
            resolve(v);
          },
          (e) => {
            if (done) return;
            done = true;
            clearTimeout(timer);
            console.warn(`[loader] task "${key}" rejected:`, e);
            resolve();
          }
        );
      });
    }

    loaderActive = true;
    for (let t of tasks) {
      const tStart = Date.now();
      curBase = doneWeight;
      curWeight = t.weight || 0;
      console.log(`[loader] ▶ task "${t.key}" inizia`);
      try {
        await withTimeout(t.fn(), taskTimeout(t), t.key);
        console.log(`[loader] ✓ task "${t.key}" finito in ${Date.now() - tStart}ms`);
      } catch (e) {
        console.warn("[loader] startup task failed", t.key, e);
      }
      const tEnd = Date.now();
      doneWeight += t.weight || 0;
      try {
        // Allinea la barra al peso cumulato del task (i task che non riportano
        // sotto-progresso avanzano comunque qui).
        setProgress((doneWeight / totalWeight) * 100);
      } catch (e) {
        console.warn("[loader] setProgress error", e);
      }
      const took = tEnd - tStart;
      if (took < 140) await new Promise((r) => setTimeout(r, 140 - took));
    }
    loaderActive = false;
  }

  window.runAppInitLoader = async function () {
    startTime = Date.now();
    lastShownPct = 0;
    setProgress(2);
    await runTasksSequential();
    // Piccola pausa finale
    await new Promise((r) => setTimeout(r, 200));
    // dissolvenza out
    loaderEl.setAttribute("aria-hidden", "true");
    // dopo dissolvenza, rimuoviamo dall'overlay per evitare problemi di pointer-events
    setTimeout(() => {
      try {
        loaderEl.parentNode && loaderEl.parentNode.removeChild(loaderEl);
      } catch (e) {}
    }, 600);
    // ── Avviso modalità schermo intero ────────────────────────────────────
    setTimeout(() => {
      flashTopToast("⛶ Premi ESC per uscire dalla modalità schermo intero", 6000);
    }, 900);
  };
})();

document.addEventListener("DOMContentLoaded", () => {
  // Lancia il loader che esegue le inizializzazioni reali.
  // runAppInitLoader usa le funzioni esistenti come loadTexturePanel e tryAutoOpen
  if (typeof runAppInitLoader === "function") runAppInitLoader();
});

// Inizializza scorciatoie tastiera (ridondante ma sicuro)
if (typeof initKeyboardShortcuts === "function") initKeyboardShortcuts();

// ==================== ANTEPRIMA REALE SVG (PENNA + ACQUERELLO) ====================
function createFreehandPreview(obj) {
  const svgNS = "http://www.w3.org/2000/svg";
  const W = 82;
  const H = 40;
  const PAD = 4;

  const svg = document.createElementNS(svgNS, "svg");
  svg.setAttribute("width", String(W));
  svg.setAttribute("height", String(H));
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  svg.style.background = "#fff";
  svg.style.border = "1px solid #555";
  svg.style.borderRadius = "4px";
  svg.style.flexShrink = "0";
  svg.style.overflow = "hidden";

  if (!obj) return svg;

  // Acquerello: anteprima immagine
  if (obj.type === "image" && obj.__isWatercolor) {
    const imgEl = document.createElementNS(svgNS, "image");
    const src = obj._element?.src || obj.getSrc?.() || "";
    if (src) {
      imgEl.setAttributeNS("http://www.w3.org/1999/xlink", "xlink:href", src);
    }
    imgEl.setAttribute("x", "0");
    imgEl.setAttribute("y", "0");
    imgEl.setAttribute("width", String(W));
    imgEl.setAttribute("height", String(H));
    imgEl.setAttribute("preserveAspectRatio", "xMidYMid meet");
    svg.appendChild(imgEl);
    return svg;
  }

  // Penna: anteprima path robusta
  const pathEl = document.createElementNS(svgNS, "path");
  pathEl.setAttribute("fill", "none");
  pathEl.setAttribute("stroke", obj.stroke || "#1a1a1a");
  pathEl.setAttribute("stroke-linecap", "round");
  pathEl.setAttribute("stroke-linejoin", "round");
  pathEl.setAttribute("vector-effect", "non-scaling-stroke");
  pathEl.setAttribute("stroke-width", Math.max(1.8, (obj.strokeWidth || obj.width || 4) * 0.9));

  let d = "";
  if (obj.type === "path" && Array.isArray(obj.path)) {
    d = obj.path.map((cmd) => cmd.join(" ")).join(" ");
  } else if (typeof obj.path === "string") {
    d = obj.path;
  }

  if (!d) {
    d = "M 8 20 L 74 20";
  }

  pathEl.setAttribute("d", d);

  // Usa width / height / pathOffset dell’oggetto, così la penna non sparisce
  const w = Math.max(1, obj.width || 1);
  const h = Math.max(1, obj.height || 1);
  const scale = Math.min((W - PAD * 2) / w, (H - PAD * 2) / h);
  const offX = obj.pathOffset?.x || 0;
  const offY = obj.pathOffset?.y || 0;
  const tx = (W - w * scale) / 2 - offX * scale;
  const ty = (H - h * scale) / 2 - offY * scale;

  pathEl.setAttribute("transform", `translate(${tx} ${ty}) scale(${scale})`);
  svg.appendChild(pathEl);

  return svg;
}

// ==================== CANCELLA TUTTO + LISTA CON ANTEPRIME ====================
let freehandPathsCache = [];
let freehandExportCache = [];

// ======================= RENDER MODAL LISTA (eliminazione singola) =======================
function renderFreehandListModal() {
  const modal = document.getElementById("freehandListModal");
  const container = document.getElementById("freehandListItems");
  const countEl = document.getElementById("freehandCount");
  if (!modal || !container) return;

  container.innerHTML = "";
  const freehands = canvas.getObjects().filter(isWatercolorOrFreehand);
  freehandPathsCache = freehands.slice();

  countEl.textContent = `(${freehands.length})`;

  if (freehands.length === 0) {
    container.innerHTML = `<div style="padding:40px;text-align:center;color:#777;">${__t("ui.freehand.noLinesPresent", null, "Nessuna linea presente")}</div>`;
    modal.style.display = "flex";
    return;
  }

  // ── Barra "Seleziona tutte / Deseleziona tutte" ──────────────────────────
  const selectBar = document.createElement("div");
  selectBar.style.cssText =
    "display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;padding:6px 10px;background:#222;border-radius:8px;border:1px solid #555;";

  const selectAllLabel = document.createElement("span");
  selectAllLabel.style.cssText = "font-size:13px;color:#cfe;";
  selectAllLabel.textContent = `${freehands.length} linee disponibili`;

  const selectAllBtn = document.createElement("button");
  selectAllBtn.textContent = __t("ui.freehand.selectAll", null, "☑ Seleziona tutte");
  selectAllBtn.style.cssText =
    "padding:5px 12px;background:#e74c3c;border:0;border-radius:6px;color:#fff;cursor:pointer;font-size:12px;font-weight:600;";
  let allSelected = false;

  selectAllBtn.addEventListener("click", () => {
    allSelected = !allSelected;
    container.querySelectorAll('input[type="checkbox"][data-index]').forEach((chk) => {
      chk.checked = allSelected;
    });
    selectAllBtn.textContent = allSelected ? "☐ Deseleziona tutte" : "☑ Seleziona tutte";
    selectAllBtn.style.background = allSelected ? "#555" : "#e74c3c";
  });

  selectBar.append(selectAllLabel, selectAllBtn);
  container.appendChild(selectBar);
  // ─────────────────────────────────────────────────────────────────────────

  freehands.forEach((obj, i) => {
    const item = document.createElement("div");
    item.style.cssText = `display:flex;align-items:center;gap:14px;background:#2b2b2b;padding:10px;border-radius:8px;border:1px solid #444;`;

    const previewContainer = document.createElement("div");
    previewContainer.style.cssText = `width:82px;height:40px;flex-shrink:0;`;
    previewContainer.appendChild(createFreehandPreview(obj)); // ora funziona anche con Image

    const info = document.createElement("div");
    info.style.flex = "1";
    const typeLabel = obj.__isWatercolor ? __t("ui.freehand.typeWatercolor", null, "(acquerello)") : "";
    info.innerHTML = `
      <strong>${__t("ui.freehand.lineLabel", { n: i + 1, type: typeLabel }, "Linea " + (i + 1) + " " + typeLabel)}</strong><br>
      <small style="color:#aaa;">${obj.stroke || "#1a1a1a"} • ${obj.strokeWidth || obj.width || 24}px</small>
    `;

    const chk = document.createElement("input");
    chk.type = "checkbox";
    chk.dataset.index = i;
    chk.style.transform = "scale(1.4)";

    item.append(previewContainer, info, chk);
    container.appendChild(item);
  });

  modal.style.display = "flex";
}

// 2. deleteSelectedFreehandLines
function deleteSelectedFreehandLines() {
  const checked = Array.from(document.querySelectorAll('#freehandListItems input[type="checkbox"]:checked'));
  if (checked.length === 0) return flashToast(__t("toast.freehand.noneSelected", null, "❌ Nessuna linea selezionata"));

  let deleted = 0;
  checked.forEach((chk) => {
    const idx = parseInt(chk.dataset.index);
    const obj = freehandPathsCache[idx];
    if (obj) {
      canvas.remove(obj);
      deleted++;
    }
  });

  canvas.requestRenderAll();
  if (typeof window.pushState === "function") window.pushState();
  flashToast(__t("toast.freehand.deleted", { count: deleted }, `🗑️ ${deleted} linee cancellate`));

  // Rinfresca la modale invece di chiuderla: l'utente vede SUBITO la
  // lista aggiornata (sia per penna normale sia per acquerello) e può
  // continuare a cancellare altri tratti senza riaprire il pannello.
  // renderFreehandListModal() ripopola anche freehandPathsCache, quindi
  // gli indici dei checkbox restano coerenti col nuovo set di oggetti.
  // Se non resta nulla, la stessa funzione mostra il placeholder
  // "Nessuna linea presente".
  renderFreehandListModal();
}

// ======================= HELPER UNIFICATO =======================
function isWatercolorOrFreehand(obj) {
  if (!obj) return false;
  const t = obj.type;

  // PressurePath è prodotto ESCLUSIVAMENTE da PressurePencilBrush
  // (penna normale Mosaica, con o senza Wacom — vedi wacomTablet.js
  // _finalizeAndAddPath). Non esiste altro modo di crearlo: quindi è
  // sempre un tratto freehand, anche se per qualche motivo il flag
  // __isFreehand non è stato (re)impostato (es. dopo certi cicli di
  // applySnapshot/loadFromJSON in cui path:created non viene scatenato).
  // Auto-marchiamo l'oggetto, così reorderCanvasLayers, restoreFreehandLocks,
  // la serializzazione e l'export lo riconoscono coerentemente da qui in poi.
  if (t === "PressurePath" || t === "pressurepath") {
    if (obj.__isFreehand !== true) obj.__isFreehand = true;
    return true;
  }

  return (
    (obj.__isFreehand === true || obj.__isWatercolor === true) &&
    (t === "path" ||
      t === "image" || // ← ACQUERELLO
      t === "group")
  );
}

// ======================= CLEAR ALL =======================
function clearAllFreehandLines() {
  const freehands = canvas.getObjects().filter(isWatercolorOrFreehand);

  if (freehands.length === 0) return flashToast(__t("toast.freehand.noneToDelete", null, "Nessuna linea da cancellare"));

  if (!confirm(__t("confirm.freehand.deleteAll", { count: freehands.length }, `🗑️ CANCELLARE PERMANENTEMENTE TUTTE LE ${freehands.length} LINEE (penna + acquerello)?`))) return;

  freehands.forEach((p) => canvas.remove(p));
  canvas.renderAll();
  if (typeof pushState === "function") pushState();
  flashToast(__t("toast.freehand.allDeleted", { count: freehands.length }, `✅ Tutte le ${freehands.length} linee cancellate`));
}

// ======================= INIZIALIZZAZIONE PULSANTI =======================
function initFreehandManager() {
  // Pulsanti nel pannello history
  const clearBtn = document.getElementById("clearAllFreehandBtn");
  const listBtn = document.getElementById("selectFreehandBtn");

  if (clearBtn) clearBtn.addEventListener("click", clearAllFreehandLines);
  if (listBtn) listBtn.addEventListener("click", renderFreehandListModal);

  // Modal
  const modal = document.getElementById("freehandListModal");
  if (!modal) return;

  document.getElementById("modalCancelBtn")?.addEventListener("click", () => (modal.style.display = "none"));
  document.getElementById("modalCloseBtn")?.addEventListener("click", () => (modal.style.display = "none"));
  document.getElementById("modalDeleteSelectedBtn")?.addEventListener("click", deleteSelectedFreehandLines);

  // ESC per chiudere
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && modal.style.display !== "none") modal.style.display = "none";
  });
}

// Esposizione (già usata da renderer.js)
window.clearAllFreehandLines = clearAllFreehandLines;
window.initFreehandManager = initFreehandManager;

// Chiamata automatica dentro initFreehandDrawing

// Esposizione per freehandManager
window.pushState = pushState;

// 4. exportFreehandLines — VERSIONE FEDELE AL CANVAS (+ FIX BLEND OVERLAY)
async function exportFreehandLines(selectedPaths, format, mode) {
  if (!selectedPaths.length) {
    return flashToast(__t("toast.freehand.noneSelected", null, "❌ Nessuna linea selezionata"));
  }

  // ── Forza l'ordine corretto degli oggetti PRIMA dell'export ──
  // reorderCanvasLayers riordina canvas._objects in [background → freehand → forme].
  // È normalmente schedulato via RAF dal listener object:added, quindi dopo certi
  // undo/redo o caricamenti da file l'ordine può non essere ancora stato corretto
  // al momento in cui l'utente apre il modale di export. Senza questa chiamata
  // esplicita, la paperTexture può finire visivamente SOPRA i tratti nello SVG/PNG
  // esportato (Fabric serializza gli oggetti nell'ordine di _objects).
  if (typeof window.reorderCanvasLayers === "function") {
    window.reorderCanvasLayers();
  }

  const isSVG = format === "svg";
  const filesToSave = [];

  const CW = canvas.getWidth();
  const CH = canvas.getHeight();
  const MULTIPLIER = 3;

  // Snapshot di TUTTO lo stato che andremo a manipolare durante l'export.
  const allObjects = canvas.getObjects();
  const savedVisibility = allObjects.map((obj) => obj.visible !== false);
  const savedExcludeFromExport = allObjects.map((obj) => obj.excludeFromExport === true);
  const savedBgColor = canvas.backgroundColor;

  // ── FIX BLEND OVERLAY (texture che "mangia" gli stamp acquerello) ──
  // Forziamo backgroundColor a "" (trasparente) — NON a "#fff" come in passato.
  // Spiegazione: gli stamp acquerello hanno globalCompositeOperation="overlay".
  // Se il backdrop è bianco-pieno (alpha 1, luminanza alta), overlay applica la
  // formula screen estrema e lava via i tratti. Con backdrop trasparente +
  // texture al 22% (= esattamente quello che ha il canvas a video / PDF "full"
  // dopo loadFromJSON), il blend agisce sul colore corretto e i tratti restano
  // visibili.
  // Il fondo bianco lo applichiamo:
  //   • PNG: post-export via composeOnWhiteBackground (come fa il PDF viewer)
  //   • SVG: post-export iniettando un <rect fill="#fff"/> FUORI dal gruppo
  //          isolato che contiene i tratti
  // Se c'è una bg image utente, copre già tutto il canvas e fa da backdrop
  // opaco "naturale" → non tocchiamo niente.
  const hasUserBg = typeof window.hasUserBackgroundImage === "function" ? window.hasUserBackgroundImage() : false;
  if (!hasUserBg) {
    canvas.backgroundColor = "";
  }

  // Mostra SOLO gli oggetti specificati + lo sfondo (paperTexture / backgroundImage).
  // Oltre a obj.visible (che basta per toDataURL/PNG), settiamo anche
  // obj.excludeFromExport=true sugli oggetti nascosti. Fabric NON esclude dai <g>
  // di toSVG gli oggetti con visible:false (li wrappa comunque in <g> con
  // l'inner element a visibility:hidden), e questo rompe il check
  // directGroups.length === objsInSVG.length in injectWatercolorBlendModesAndIsolation,
  // facendo saltare l'iniezione del mix-blend-mode sugli stamp acquerello.
  function showOnly(pathsToShow) {
    const showSet = new Set(pathsToShow);
    allObjects.forEach((obj) => {
      if (obj.__isBackground === true) {
        obj.visible = true;
        obj.excludeFromExport = false;
      } else {
        const show = showSet.has(obj);
        obj.visible = show;
        obj.excludeFromExport = !show;
      }
    });
  }

  function restoreVisibility() {
    allObjects.forEach((obj, i) => {
      obj.visible = savedVisibility[i];
      obj.excludeFromExport = savedExcludeFromExport[i] ? true : false;
    });
    canvas.backgroundColor = savedBgColor;
  }

  // Inietta mix-blend-mode sugli stamp acquerello + isola il contesto di blending
  // in un <g> interno, con il <rect fill="#fff"/> di sfondo FUORI da quel gruppo
  // così non corrompe il backdrop visto dai mix-blend-mode.
  function injectWatercolorBlendModesAndIsolation(svgStr) {
    const objsInSVG = allObjects.filter((o) => o.visible !== false && o.excludeFromExport !== true);
    if (objsInSVG.length === 0) return svgStr;

    let doc;
    try {
      const parser = new DOMParser();
      doc = parser.parseFromString(svgStr, "image/svg+xml");
      if (doc.getElementsByTagName("parsererror").length > 0) return svgStr;
    } catch (e) {
      return svgStr;
    }

    const root = doc.documentElement;
    if (!root || root.tagName.toLowerCase() !== "svg") return svgStr;

    // Snapshot dei figli diretti del root PRIMA di muoverli, in ordine di documento.
    const allDirectChildren = Array.from(root.children);
    const directGroups = allDirectChildren.filter((el) => el.tagName.toLowerCase() === "g");

    // Mapping 1:1 con gli oggetti visibili: se non combacia, non rischiamo di
    // iniettare blend mode sull'oggetto sbagliato (meglio SVG senza blend che SVG
    // visivamente corrotto).
    if (directGroups.length !== objsInSVG.length) {
      console.warn(
        `[exportFreehand SVG] mismatch <g>=${directGroups.length} vs objs=${objsInSVG.length}, skip blend injection`
      );
      return svgStr;
    }

    // 1) Inietta mix-blend-mode + opacity sui <g> acquerello
    objsInSVG.forEach((obj, i) => {
      if (!obj.__isWatercolor) return;
      const blend = obj.globalCompositeOperation || "overlay";
      const op = typeof obj.opacity === "number" ? obj.opacity : 1;
      const g = directGroups[i];
      const existing = (g.getAttribute("style") || "").trim();
      const sep = existing && !existing.endsWith(";") ? "; " : existing ? " " : "";
      let extra = `mix-blend-mode: ${blend};`;
      // L'opacity dello stamp NON viene esportata da Fabric sull'<image>
      // (resta a 1) — la riapplichiamo qui sul <g> wrapper.
      if (op < 0.999) extra += ` opacity: ${op};`;
      g.setAttribute("style", existing + sep + extra);
    });

    // 2) Wrappa tutto il contenuto renderizzabile in un <g style="isolation:isolate">,
    //    così i mix-blend-mode degli acquerelli vedono come backdrop SOLO la
    //    texture su transparent (= identico al canvas a video / PDF "full").
    //    Il <rect fill="#fff"/> di fondo lo mettiamo FUORI da questo gruppo,
    //    così è visibile dal viewer ma INVISIBILE ai mix-blend-mode interni.
    const SVG_NS = "http://www.w3.org/2000/svg";
    const isoGroup = doc.createElementNS(SVG_NS, "g");
    isoGroup.setAttribute("style", "isolation: isolate;");

    // Sposta dentro isoGroup tutti gli elementi renderizzabili (esclusi defs e
    // metadata). appendChild sposta l'elemento (lo rimuove dalla posizione
    // originale automaticamente).
    const nonRenderable = new Set(["defs", "metadata", "style", "title", "desc"]);
    allDirectChildren.forEach((el) => {
      if (nonRenderable.has(el.tagName.toLowerCase())) return;
      isoGroup.appendChild(el);
    });

    // 3) Inserisce il rect bianco di sfondo PRIMA dell'isoGroup (= dietro nello
    //    z-order). Solo se non c'è bg image utente — coerente col fix PNG.
    if (!hasUserBg) {
      const bgRect = doc.createElementNS(SVG_NS, "rect");
      bgRect.setAttribute("x", "0");
      bgRect.setAttribute("y", "0");
      bgRect.setAttribute("width", "100%");
      bgRect.setAttribute("height", "100%");
      bgRect.setAttribute("fill", "#ffffff");
      root.appendChild(bgRect);
    }
    root.appendChild(isoGroup);

    return new XMLSerializer().serializeToString(doc);
  }

  // Esporta il canvas reale con la visibilità correntemente configurata.
  // Async perché per il PNG facciamo la composizione su bianco a posteriori.
  async function exportCanvasNow() {
    if (isSVG) {
      // toSVG rispetta obj.excludeFromExport=true → escluderà gli oggetti
      // nascosti del tutto. Con canvas.backgroundColor="" Fabric NON inserisce
      // più il <rect fill="#fff"/> automatico → siamo noi a inserirlo, FUORI
      // dal contesto isolato che contiene texture + tratti.
      let svg = canvas.toSVG({ viewBox: { x: 0, y: 0, width: CW, height: CH } });
      svg = injectWatercolorBlendModesAndIsolation(svg);
      return svg;
    } else {
      // PNG trasparente — identico bit-per-bit a quello che PDFKit embedderebbe.
      const transparentDataURL = canvas.toDataURL({
        format: "png",
        multiplier: MULTIPLIER,
        left: 0,
        top: 0,
        width: CW,
        height: CH
      });
      // Composizione finale su bianco (solo se non c'è bg image utente),
      // a posteriori, con semplice source-over → blend overlay degli acquerelli
      // resta intatto e i tratti tornano visibili identici al canvas a video.
      let finalDataURL = transparentDataURL;
      if (!hasUserBg) {
        finalDataURL = await composeOnWhiteBackground(transparentDataURL, CW * MULTIPLIER, CH * MULTIPLIER);
      }
      return finalDataURL.split(",")[1];
    }
  }

  try {
    if (mode === "single") {
      const ext = isSVG ? "svg" : "png";
      showOnly(selectedPaths);
      const content = await exportCanvasNow();
      filesToSave.push({ filename: `disegno_mano_libera.${ext}`, content });
    } else {
      // mode === "separate" → un file per ogni linea selezionata.
      const ext = isSVG ? "svg" : "png";
      for (let i = 0; i < selectedPaths.length; i++) {
        showOnly([selectedPaths[i]]);
        const content = await exportCanvasNow();
        filesToSave.push({ filename: `linea_${i + 1}.${ext}`, content });
      }
    }
  } finally {
    // Sempre — anche su eccezione — ripristina lo stato originale del canvas
    // (visibility, excludeFromExport e backgroundColor di TUTTI gli oggetti).
    restoreVisibility();
    canvas.requestRenderAll();
  }

  await window.desktopAPI.exportFreehand({
    type: isSVG ? "svg" : "png",
    files: filesToSave
  });

  flashToast(
    __t(
      "toast.exportMulti.done",
      { count: filesToSave.length, kind: isSVG ? "SVG" : "PNG", w: CW * MULTIPLIER, h: CH * MULTIPLIER },
      `✅ Esportati ${filesToSave.length} file ${isSVG ? "SVG" : "PNG"} (${CW * MULTIPLIER}×${CH * MULTIPLIER} px)!`
    )
  );
}

function renderFreehandExportModal() {
  const modal = document.getElementById("freehandExportModal");
  const container = document.getElementById("exportListItems");
  const countEl = document.getElementById("exportCount");
  if (!modal || !container) return;

  container.innerHTML = "";
  const freehands = canvas.getObjects().filter(isWatercolorOrFreehand); // ← FIX QUI
  freehandExportCache = freehands.slice();

  countEl.textContent = `(${freehands.length})`;

  if (freehands.length === 0) {
    container.innerHTML = `<div style="padding:40px;text-align:center;color:#777;">${__t("ui.freehand.noLinesToExport", null, "Nessuna linea da esportare")}</div>`;
    modal.style.display = "flex";
    return;
  }

  // Barra Seleziona tutte / Deseleziona tutte (rimane uguale)
  const selectBar = document.createElement("div");
  selectBar.style.cssText =
    "display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;padding:6px 10px;background:#222;border-radius:8px;border:1px solid #555;";
  const selectAllLabel = document.createElement("span");
  selectAllLabel.style.cssText = "font-size:13px;color:#cfe;";
  selectAllLabel.textContent = `${freehands.length} linee disponibili`;
  const selectAllBtn = document.createElement("button");
  selectAllBtn.textContent = __t("ui.freehand.selectAll", null, "☑ Seleziona tutte");
  selectAllBtn.style.cssText =
    "padding:5px 12px;background:#2b6cff;border:0;border-radius:6px;color:#fff;cursor:pointer;font-size:12px;font-weight:600;";
  let allSelected = false;

  selectAllBtn.addEventListener("click", () => {
    allSelected = !allSelected;
    container.querySelectorAll('input[type="checkbox"][data-index]').forEach((chk) => (chk.checked = allSelected));
    selectAllBtn.textContent = allSelected ? "☐ Deseleziona tutte" : "☑ Seleziona tutte";
    selectAllBtn.style.background = allSelected ? "#555" : "#2b6cff";
  });

  selectBar.append(selectAllLabel, selectAllBtn);
  container.appendChild(selectBar);

  freehands.forEach((obj, i) => {
    const item = document.createElement("div");
    item.style.cssText = `display:flex;align-items:center;gap:14px;background:#2b2b2b;padding:10px;border-radius:8px;border:1px solid #444;`;

    const previewContainer = document.createElement("div");
    previewContainer.style.cssText = `width:82px;height:40px;flex-shrink:0;`;
    previewContainer.appendChild(createFreehandPreview(obj));

    const info = document.createElement("div");
    info.style.flex = "1";
    const typeLabel = obj.__isWatercolor ? __t("ui.freehand.typeWatercolor", null, "(acquerello)") : __t("ui.freehand.typePen", null, "(penna)");
    info.innerHTML = `
      <strong>${__t("ui.freehand.lineLabel", { n: i + 1, type: typeLabel }, "Linea " + (i + 1) + " " + typeLabel)}</strong><br>
      <small style="color:#aaa;">${obj.stroke || "#1a1a1a"} • ${obj.strokeWidth || obj.width || 24}px</small>
    `;

    const chk = document.createElement("input");
    chk.type = "checkbox";
    chk.dataset.index = i;
    chk.style.transform = "scale(1.4)";

    item.append(previewContainer, info, chk);
    container.appendChild(item);
  });

  modal.style.display = "flex";
}

// ======================= INIZIALIZZAZIONE PULSANTE ESPORTA =======================
function initFreehandExport() {
  const btn = document.getElementById("exportFreehandBtn");
  if (!btn) return;

  btn.addEventListener("click", renderFreehandExportModal);

  // Modal listeners
  const modal = document.getElementById("freehandExportModal");
  document.getElementById("exportModalCancelBtn")?.addEventListener("click", () => (modal.style.display = "none"));
  document.getElementById("exportModalCloseBtn")?.addEventListener("click", () => (modal.style.display = "none"));

  document.getElementById("exportConfirmBtn")?.addEventListener("click", async () => {
    const checked = Array.from(document.querySelectorAll('#exportListItems input[type="checkbox"]:checked'));
    if (checked.length === 0) {
      flashToast(__t("toast.freehand.exportSelectOne", null, "❌ Seleziona almeno una linea"));
      return;
    }

    const selected = checked
      .map((chk) => {
        const idx = parseInt(chk.dataset.index);
        return freehandExportCache[idx];
      })
      .filter(Boolean);

    const format = document.querySelector('input[name="exportFormat"]:checked').value;
    const mode = document.querySelector('input[name="exportMode"]:checked').value;

    try {
      await exportFreehandLines(selected, format, mode);
    } catch (err) {
      console.error("Export error:", err);
      flashToast(__t("toast.freehand.exportError", null, "❌ Errore durante l'esportazione"));
    }

    document.getElementById("freehandExportModal").style.display = "none";
  });

  // ESC
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && modal.style.display !== "none") modal.style.display = "none";
  });
}

// ====================== HELPER: composizione PNG trasparente su fondo bianco ======================
// Replica esattamente quello che un PDF viewer fa quando mostra un PNG con alpha
// sopra una pagina A4 bianca: il PNG (con i suoi tratti acquerello renderizzati su
// transparent + texture) viene "incollato" su un canvas pieno bianco con un banale
// source-over — NESSUN blend mode coinvolto in questa fase.
//
// Perché non possiamo semplicemente forzare canvas.backgroundColor="#fff" prima di
// toDataURL: in quel caso Fabric riempirebbe il canvas di bianco PRIMA di disegnare
// gli stamp acquerello, e il loro globalCompositeOperation="overlay" vedrebbe un
// backdrop quasi-bianco-opaco → formula screen estrema → tratti lavati via fino a
// renderli invisibili. Componendo a posteriori, l'overlay viene applicato sul
// backdrop "giusto" (texture su transparent), identico al canvas a video / PDF.
async function composeOnWhiteBackground(transparentDataURL, width, height) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      try {
        const c = document.createElement("canvas");
        c.width = width;
        c.height = height;
        const ctx = c.getContext("2d");
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, width, height);
        ctx.drawImage(img, 0, 0);
        resolve(c.toDataURL("image/png"));
      } catch (e) {
        reject(e);
      }
    };
    img.onerror = () => reject(new Error("composeOnWhiteBackground: image load failed"));
    img.src = transparentDataURL;
  });
}

// ====================== EXPORT PNG COMPLETO – VERSIONE FEDELE AL CANVAS ======================
async function exportFullCanvasPNG() {
  if (!canvas) return flashToast(__t("toast.canvas.notReady", null, "Canvas non pronto"));

  const CW = canvas.getWidth();
  const CH = canvas.getHeight();
  const MULTIPLIER = 3; // PNG ad alta risoluzione (stesso fattore di exportFreehandLines)

  // ── FIX BLEND OVERLAY (texture che "mangia" i tratti acquerello) ──
  // Forziamo backgroundColor a "" (trasparente) PRIMA di toDataURL, esattamente
  // come fa il PDF "full" che è 1:1 col canvas a video. In questo modo gli stamp
  // acquerello con globalCompositeOperation="overlay" si fondono col backdrop
  // CORRETTO (texture su transparent) e non con un bianco-pieno che ne forzava
  // la formula screen → lavaggio totale dei tratti.
  // Il fondo bianco lo aggiungiamo a posteriori con composeOnWhiteBackground,
  // identico al modo in cui un PDF viewer compone il PNG sulla pagina A4.
  // Se c'è un'immagine di sfondo utente, copre già tutto e fa da backdrop opaco
  // "naturale" → non serve fare nulla di particolare.
  const savedBgColor = canvas.backgroundColor;
  const hasUserBg = typeof window.hasUserBackgroundImage === "function" ? window.hasUserBackgroundImage() : false;
  if (!hasUserBg) {
    canvas.backgroundColor = "";
  }

  try {
    flashToast(__t("toast.png.generating", null, "⏳ Generazione PNG ad alta risoluzione..."));

    // PNG con alpha — bit-identico a quello che PDFKit embedda nel PDF "full"
    const transparentDataURL = canvas.toDataURL({
      format: "png",
      multiplier: MULTIPLIER,
      left: 0,
      top: 0,
      width: CW,
      height: CH
    });

    // Composizione finale: il PNG trasparente viene incollato su bianco solo
    // se non c'è bg image utente. Replica fedelmente il PDF viewer.
    let finalDataURL = transparentDataURL;
    if (!hasUserBg) {
      finalDataURL = await composeOnWhiteBackground(transparentDataURL, CW * MULTIPLIER, CH * MULTIPLIER);
    }

    await window.desktopAPI.exportFullPNG(finalDataURL);

    flashToast(__t("toast.png.done", { w: CW * MULTIPLIER, h: CH * MULTIPLIER }, `✅ PNG completo esportato (${CW * MULTIPLIER}×${CH * MULTIPLIER} px – calibrazione mm preservata)`));
  } catch (err) {
    console.error("Export PNG error", err);
    flashToast(__t("toast.png.error", null, "❌ Errore durante l'esportazione PNG"));
  } finally {
    // Ripristina backgroundColor anche su errore (sia che fosse "" o qualsiasi
    // altro valore presente prima dell'export) → canvas a video intatto.
    canvas.backgroundColor = savedBgColor;
    canvas.requestRenderAll();
  }
}

// ====================== WIRE EXPORT BUTTONS (unico listener) ======================
function wireExportButtons() {
  // --- PNG / SVG (apre modale di scelta) ---
  const pngBtn = document.getElementById("exportPngBtn");
  if (pngBtn) {
    pngBtn.replaceWith(pngBtn.cloneNode(true));
    const cleanPng = document.getElementById("exportPngBtn");
    cleanPng.addEventListener("click", () => {
      showPngSvgExportModal();
    });
  }

  // --- PDF ---
  const pdfBtn = document.getElementById("exportPdfBtn");
  if (pdfBtn) {
    pdfBtn.replaceWith(pdfBtn.cloneNode(true));
    const cleanPdf = document.getElementById("exportPdfBtn");
    cleanPdf.addEventListener("click", () => {
      handleExportPdfA4();
    });
  }
}

// ====================== MODALE EXPORT PNG / SVG ======================
function showPngSvgExportModal() {
  const modal = document.getElementById("pngSvgExportModal");
  if (!modal) return;
  // Reset alla prima opzione (PNG completo) ad ogni apertura
  const def = modal.querySelector('input[name="pngSvgMode"][value="png_full"]');
  if (def) def.checked = true;
  modal.style.display = "flex";
}

function hidePngSvgExportModal() {
  const modal = document.getElementById("pngSvgExportModal");
  if (modal) modal.style.display = "none";
}

function getSelectedPngSvgMode() {
  const r = document.querySelector('#pngSvgExportModal input[name="pngSvgMode"]:checked');
  return r ? r.value : "png_full";
}

// Listener della modale (eseguito subito, dipende solo da elementi statici dell'HTML)
(function wirePngSvgExportModal() {
  const modal = document.getElementById("pngSvgExportModal");
  if (!modal) return;

  const closeBtn = document.getElementById("pngSvgExportCloseBtn");
  const cancelBtn = document.getElementById("pngSvgExportCancelBtn");
  const confirmBtn = document.getElementById("pngSvgExportConfirmBtn");

  closeBtn?.addEventListener("click", hidePngSvgExportModal);
  cancelBtn?.addEventListener("click", hidePngSvgExportModal);

  // Chiusura cliccando fuori dalla card
  modal.addEventListener("click", (e) => {
    if (e.target === modal) hidePngSvgExportModal();
  });

  // ESC chiude
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && modal.style.display !== "none") hidePngSvgExportModal();
  });

  confirmBtn?.addEventListener("click", async () => {
    const mode = getSelectedPngSvgMode();
    hidePngSvgExportModal();

    try {
      if (mode === "png_full") {
        await exportFullCanvasPNG();
      } else if (mode === "svg_filled") {
        if (typeof window.exportShapesSVG !== "function") {
          flashToast(__t("toast.svg.moduleMissing", null, "❌ Modulo SVG non caricato (svgExport.js)"));
          return;
        }
        await window.exportShapesSVG("filled");
      } else if (mode === "svg_outline") {
        if (typeof window.exportShapesSVG !== "function") {
          flashToast(__t("toast.svg.moduleMissing", null, "❌ Modulo SVG non caricato (svgExport.js)"));
          return;
        }
        await window.exportShapesSVG("outline");
      }
    } catch (err) {
      console.error("[export PNG/SVG] Errore:", err);
      flashToast(__t("toast.freehand.exportError", null, "❌ Errore durante l'esportazione"));
    }
  });
})();

// Inizializza sia manager cancellazione che esportazione
if (typeof initFreehandManager === "function") initFreehandManager();
if (typeof initFreehandExport === "function") initFreehandExport();

// ====================== WATERCOLOR STAMP INIT ======================
async function initWatercolorStamp() {
  if (typeof window.loadWatercolorStamp === "function") {
    try {
      await window.loadWatercolorStamp();
      console.log("[renderer] Watercolor Stamp texture pronta");
    } catch (e) {
      console.warn("[renderer] Watercolor stamp non trovato — usa il vecchio sistema", e);
    }
  }
}

// ====================== GUIDA UTENTE (pulsante circolare) ======================
async function openGuide() {
  if (window.desktopAPI?.openGuide) {
    try {
      // Passa la lingua corrente i18n al main process per scegliere
      // Guida_utente.html vs Guida_utente_EN.html. Default = "it" se
      // il modulo i18n non è ancora pronto (fallback IT).
      const lang =
        (window.i18n && typeof window.i18n.getLanguage === "function")
          ? window.i18n.getLanguage()
          : "it";
      await window.desktopAPI.openGuide(lang);
      flashToast(__t("toast.guide.opened", null, "📖 Guida Utente aperta nel browser predefinito"));
    } catch (err) {
      console.error("Errore apertura guida", err);
      flashToast(__t("toast.guide.openError", null, "❌ Impossibile aprire la guida"));
    }
  }
}

// Inizializzazione pulsante + auto-apertura prima esecuzione
function initGuideButton() {
  const guideBtn = document.getElementById("guideBtn");
  if (!guideBtn) return;

  guideBtn.addEventListener("click", openGuide);

  // Prima esecuzione dell'app → auto-apre la guida
  if (!localStorage.getItem("mosaica_guide_viewed")) {
    console.log("[Guide] Prima esecuzione → auto-apertura Guida Utente");
    setTimeout(() => {
      openGuide().then(() => {
        localStorage.setItem("mosaica_guide_viewed", "true");
      });
    }, 2800); // dopo che tutto è pronto (canvas, freehand, ecc.)
  }
}

// ====================== ROTAZIONE CANVAS + TEXTURE CARTA ======================
function rotateCanvasContent(degrees) {
  if (degrees !== 90 && degrees !== -90) return;

  const CW = degrees === 90;
  const oldW = canvas.lowerCanvasEl ? canvas.lowerCanvasEl.width : canvas.getWidth();
  const oldH = canvas.lowerCanvasEl ? canvas.lowerCanvasEl.height : canvas.getHeight();

  // ── 0. Blocca gli eventi di storia durante tutta la rotazione ────────────────
  const prevApplying = isApplyingSnapshot;
  isApplyingSnapshot = true;

  // ── 1. Rimuovi la texture carta (verrà ricreata con la rotazione corretta) ──
  const hadPaperTexture =
    typeof paperTextureObject !== "undefined" && paperTextureObject !== null && canvas.contains(paperTextureObject);

  if (hadPaperTexture) {
    canvas.remove(paperTextureObject);
    paperTextureObject = null;
    if (typeof paperTextureLoading !== "undefined") paperTextureLoading = null;
  }

  // ── 2. Invalida l'overlay di anteprima acquerello ───────────────────────────
  if (typeof _watercolorPreviewOverlay !== "undefined" && _watercolorPreviewOverlay) {
    try {
      _watercolorPreviewOverlay.parentNode?.removeChild(_watercolorPreviewOverlay);
    } catch (_) {}
    _watercolorPreviewOverlay = null;
    if (typeof _watercolorPreviewOverlayCtx !== "undefined") _watercolorPreviewOverlayCtx = null;
  }

  // ── 3. Swap dimensioni foglio e aggiorna rotazione texture carta ─────────────
  const tmpMM = A4_MM_W;
  A4_MM_W = A4_MM_H;
  A4_MM_H = tmpMM;
  setPaperSizeFromMM();

  // ←←← AGGIORNAMENTO ROTAZIONE TEXTURE (sempre insieme al canvas)
  paperTextureRotationDeg = (paperTextureRotationDeg + degrees + 360) % 360;

  // ── 4. Trasformazione oggetti (resto invariato) ─────────────────────────────
  const allObjects = canvas.getObjects().slice();
  const watercolorToReplace = [];

  allObjects.forEach((obj) => {
    if (obj.__isBackground === true) return;

    if (obj.__isWatercolor === true) {
      watercolorToReplace.push(obj);
      return;
    }

    const cp = obj.getCenterPoint();
    let newCx, newCy;

    if (CW) {
      newCx = oldH - cp.y;
      newCy = cp.x;
    } else {
      newCx = cp.y;
      newCy = oldW - cp.x;
    }

    obj.setPositionByOrigin(new fabric.Point(newCx, newCy), "center", "center");
    obj.angle = ((obj.angle || 0) + degrees + 360) % 360;
    obj.setCoords();
  });

  // ── 5. Sostituisci acquerelli ruotati (invariato) ───────────────────────────
  watercolorToReplace.forEach((img) => {
    const srcEl = img._element;
    if (!srcEl) return;

    const rotCanvas = document.createElement("canvas");
    rotCanvas.width = oldH;
    rotCanvas.height = oldW;
    const rctx = rotCanvas.getContext("2d");

    if (CW) {
      rctx.translate(oldH, 0);
      rctx.rotate(Math.PI / 2);
    } else {
      rctx.translate(0, oldW);
      rctx.rotate(-Math.PI / 2);
    }
    rctx.drawImage(srcEl, 0, 0, oldW, oldH);

    const newImg = new fabric.Image(rotCanvas);
    newImg.set({
      left: 0,
      top: 0,
      originX: "left",
      originY: "top",
      selectable: false,
      evented: false,
      hasControls: false,
      hasBorders: false,
      lockMovementX: true,
      lockMovementY: true,
      lockScalingX: true,
      lockScalingY: true,
      lockRotation: true,
      __isFreehand: true,
      __isWatercolor: true,
      __blendBaked: img.__blendBaked || false,
      __watercolorParams: img.__watercolorParams,
      // Gli oggetti baked usano sempre source-over (il blend è già nei pixel).
      // Gli oggetti legacy mantengono il loro composite originale.
      globalCompositeOperation: img.__blendBaked ? "source-over" : img.globalCompositeOperation || "multiply",
      opacity: img.__blendBaked ? 1 : img.opacity != null ? img.opacity : 1,
      __addedAt: img.__addedAt
    });

    canvas.remove(img);
    canvas.add(newImg);
    newImg.setCoords();
  });

  // ── 6. Ripristina lo sfondo utente (invariato) ──────────────────────────────
  _reapplyBackgroundSilent();

  // ── 7. Ripristina la texture carta CON LA ROTAZIONE CORRETTA ←←←
  isApplyingSnapshot = prevApplying;

  if (hadPaperTexture && typeof window.ensurePaperTexture === "function") {
    window
      .ensurePaperTexture(paperTextureRotationDeg) // ← PASSIAMO LA ROTAZIONE
      .then(() => {
        if (typeof window.keepPaperTextureBehindEverything === "function") {
          window.keepPaperTextureBehindEverything();
        }
      })
      .catch(() => {});
  }

  // ── 8. Finalizza ────────────────────────────────────────────────────────────
  resetZoomAndPan();
  canvas.renderAll();
  isApplyingSnapshot = false;
  pushState();

  const orient = A4_MM_W >= A4_MM_H ? "Orizzontale" : "Verticale";
  flashToast(__t("toast.canvas.flipped", { orient: __t("canvas.orient." + (orient === "verticale" ? "vertical" : "horizontal"), null, orient), w: Math.round(A4_MM_W), h: Math.round(A4_MM_H) }, `🔄 Canvas ${orient} (${Math.round(A4_MM_W)} × ${Math.round(A4_MM_H)} mm)`));
}

/** Forza orientamento verticale (portrait A4). Se è già verticale non fa nulla. */
function setCanvasVertical() {
  if (A4_MM_W < A4_MM_H) {
    flashToast(__t("toast.canvas.alreadyVertical", null, "✅ Canvas già in verticale"));
    return;
  }
  rotateCanvasContent(-90); // landscape → portrait: CCW
}

/** Forza orientamento orizzontale (landscape A4). Se è già orizzontale non fa nulla. */
function setCanvasHorizontal() {
  if (A4_MM_W > A4_MM_H) {
    flashToast(__t("toast.canvas.alreadyHorizontal", null, "✅ Canvas già in orizzontale"));
    return;
  }
  rotateCanvasContent(90); // portrait → landscape: CW
}

// Avvia tutto
document.addEventListener("DOMContentLoaded", () => {
  // ←←← CARICAMENTO PERSISTENZA FREEHAND (importante!)
  if (typeof window.loadFreehandSettings === "function") {
    window.loadFreehandSettings();
  }

  initWatercolorStamp();
  wireExportButtons();
  initGuideButton();

  // Forza inizializzazione GPU worker
  if (typeof window.WatercolorStampBrush !== "undefined") {
    console.log("[renderer] WebGL2 Watercolor GPU worker pronto");
  }

  // ── Pulsanti orientamento canvas ──
  document.getElementById("canvasVerticalBtn")?.addEventListener("click", setCanvasVertical);
  document.getElementById("canvasHorizontalBtn")?.addEventListener("click", setCanvasHorizontal);

  console.log("[renderer] ✅ Persistenza freehand caricata");
});

// === ESPOSIZIONE GLOBALE per bootMosaicaUI (status bar + inspector contestuale) ===
try {
  window.canvas = canvas;
  window.px2mm = px2mm;
  window.mm2px = mm2px;
  // Permette a freehandDrawing.js / watercolorStampBrush.js di sapere se c'è
  // un'immagine di sfondo utente: in tal caso la texture carta NON va aggiunta
  // e i tratti freehand vanno tenuti SOPRA la bg ma SOTTO le forme.
  window.hasUserBackgroundImage = () => !!(backgroundImageObject || (backgroundMeta && backgroundMeta.dataURL));
} catch (e) {
  console.warn("[renderer] Esposizione globali fallita", e);
}

// ======================= ESC → USCITA FULLSCREEN =======================
// Quando non ci sono modali né dropdown aperti, ESC esce dalla modalità
// schermo intero. Questo listener è in fase bubble e viene eseguito DOPO
// il listener dei modali (che ferma la propagazione se chiude un modale).
// ======================= ESC + PULSANTI TOPBAR → FULLSCREEN =======================
// Centralizza tutta la gestione del fullscreen lato renderer:
//  • ESC esce dalla modalità schermo intero (se nessun modale/dropdown è aperto)
//  • I pulsanti #enterFullscreenBtn / #exitFullscreenBtn in topbar fanno toggle
//  • La visibilità dei due pulsanti viene sincronizzata con lo stato reale
//    della finestra tramite l'evento "window:fullscreen-changed" inviato dal main.
(function initFullscreenControls() {
  if (window.__fullscreenControlsBound) return;
  window.__fullscreenControlsBound = true;

  const enterBtn = document.getElementById("enterFullscreenBtn");
  const exitBtn = document.getElementById("exitFullscreenBtn");

  function syncButtonsTo(isFs) {
    if (enterBtn) enterBtn.style.display = isFs ? "none" : "inline-flex";
    if (exitBtn) exitBtn.style.display = isFs ? "inline-flex" : "none";
  }

  function setFs(flag) {
    if (window.desktopAPI?.setFullScreen) {
      window.desktopAPI.setFullScreen(!!flag);
    }
  }

  // — Pulsanti topbar
  if (enterBtn) {
    enterBtn.addEventListener("click", () => {
      setFs(true);
      flashTopToast("⛶ Premi ESC per uscire dalla modalità schermo intero", 5000);
    });
  }
  if (exitBtn) {
    exitBtn.addEventListener("click", () => {
      setFs(false);
      flashToast(__t("toast.fullscreen.exit", null, "⛶ Uscita dalla modalità schermo intero"));
    });
  }

  // — ESC esce dal fullscreen (se non ci sono modali/dropdown aperti)
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;

    // Se c'è un modale aperto → lascia che setupGlobalModalEscClose lo gestisca
    const openModals = Array.from(document.querySelectorAll('div[id$="Modal"]')).filter((el) => {
      const inline = el.style.display;
      if (inline === "none") return false;
      if (inline && inline !== "") return true;
      return getComputedStyle(el).display !== "none";
    });
    if (openModals.length > 0) return;

    // Se c'è un dropdown aperto → lascia che bootMosaicaUI lo gestisca
    const openDropdowns = Array.from(document.querySelectorAll(".topbar-dropdown.open"));
    if (openDropdowns.length > 0) return;

    // Nessun modale né dropdown: esci dal fullscreen
    setFs(false);
    flashToast(__t("toast.fullscreen.exit", null, "⛶ Uscita dalla modalità schermo intero"));
  });

  // — Sincronizzazione stato iniziale
  if (window.desktopAPI?.isFullScreen) {
    window.desktopAPI
      .isFullScreen()
      .then(syncButtonsTo)
      .catch(() => syncButtonsTo(true));
  } else {
    syncButtonsTo(true); // l'app parte in fullscreen
  }

  // — Aggiornamento automatico su cambio stato (anche se l'utente esce/entra
  //   tramite scorciatoie OS come F11 su Windows o il tasto verde su macOS)
  if (window.desktopAPI?.onFullScreenChange) {
    window.desktopAPI.onFullScreenChange(syncButtonsTo);
  }
})();

console.log("[renderer] script caricato");
console.log("TriangleModel", typeof TriangleModel);
console.log("TrapezoidModel", typeof TrapezoidModel);
console.log("radialChangeShapeAction", typeof radialChangeShapeAction);
console.log("snapAngleDeg", typeof snapAngleDeg);
console.log("angleAlpha", document.getElementById("angleAlpha"));
console.log("angleBeta", document.getElementById("angleBeta"));
console.log("canvas", typeof canvas !== "undefined", canvas ? canvas.getObjects().length : "?");