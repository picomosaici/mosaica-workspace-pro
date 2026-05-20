// freehandDrawing.js — Disegno a mano libera PRO
// gomma BIANCA + ACQUERELLO SEMPLIFICATO SU PENNA BASE + BLOCCO automatico

let isFreehandMode = false;
let isEraserMode = false;
let isWatercolorMode = false;
let currentStrokeColor = "#1a1a1a";
let currentWatercolorThickness = 0.2; // ex roughness, ma come variazione di spessore
let currentJitterAmount = 0.45; // opzionale
let currentLineWidth = 4; // penna normale
// === VALORI OTTIMIZZATI PER EFFETTO ACQUERELLO NATURALE ===
let currentWatercolorWidth = 24; // ← aggiornato
let currentWatercolorFlow = 0.82; // ← aggiornato
let jitterToneControl = 0.48; // ← aggiornato
let currentPositionJitter = 11; // ← aggiornato
let currentRotationJitter = 9.5; // ← aggiornato
let currentBleed = 3.2; // ← aggiornato
let currentWatercolorLayers = 22; // ← aggiornato
// === NUOVO: DISTANZA TRA I TIMBRI ===
let currentStampSpacing = 0.48; // 0.25 = molto denso, 2.0 = molto sparso
let currentTipInitialRotationDeg = 0; // ← NUOVA
// ==================== PAPER TEXTURE PERMANENTE ====================
let paperTextureDataURL = null;
let paperTextureObject = null;
let paperTextureLoading = null;

// ====================== ensurePaperTexture (con supporto rotazione) ======================
async function ensurePaperTexture(rotationDeg = 0) {
  // ── Guard: se c'è un'immagine di sfondo utente, NON aggiungere la carta ──
  // L'immagine utente sostituisce la texture carta come sfondo.
  // Se la carta era ancora in canvas (caso limite), la rimuoviamo per evitare
  // lo "schiarimento" combinato con l'immagine di sfondo.
  const hasUserBg = typeof window.hasUserBackgroundImage === "function" ? window.hasUserBackgroundImage() : false;
  if (hasUserBg) {
    if (paperTextureObject && canvas?.getObjects?.().includes(paperTextureObject)) {
      canvas.remove(paperTextureObject);
      canvas.requestRenderAll();
    }
    return null;
  }

  // Se esiste già e non è stata rimossa → ritorna subito (caso normale)
  if (paperTextureObject && canvas?.getObjects?.().includes(paperTextureObject)) {
    return paperTextureObject;
  }

  // Se l'oggetto esiste ma era stato nascosto (rimosso dal canvas) → ri-aggiungilo
  // senza ricaricare da disco (es. dopo clearBackground o applySnapshot)
  if (paperTextureObject && !canvas?.getObjects?.().includes(paperTextureObject)) {
    canvas.add(paperTextureObject);
    canvas.sendToBack(paperTextureObject);
    canvas.requestRenderAll();
    return paperTextureObject;
  }

  if (paperTextureLoading) return paperTextureLoading;

  paperTextureLoading = new Promise(async (resolve, reject) => {
    try {
      const dataURL = await window.paperTextureAPI?.getDataURL();
      paperTextureDataURL = dataURL;

      if (!dataURL) {
        console.error("[PaperTexture] ❌ carta.png non trovata");
        flashToast("⚠️ Texture carta non trovata — controlla texture-carta");
        reject(new Error("carta.png missing"));
        return;
      }

      console.log("[PaperTexture] ✅ Caricamento da dataURL (userData)");

      const normalizedRot = ((rotationDeg % 360) + 360) % 360;

      // Helper interno per applicare sempre le stesse proprietà
      const _setPaperTextureProps = (fabricImg) => {
        fabricImg.set({
          left: 0,
          top: 0,
          selectable: false,
          evented: false,
          hasControls: false,
          hasBorders: false,
          lockMovementX: true,
          lockMovementY: true,
          lockScalingX: true,
          lockScalingY: true,
          lockRotation: true,
          hoverCursor: "default",
          excludeFromExport: true,
          opacity: 0.22,
          __isBackground: true
        });
        fabricImg.scaleToWidth(canvas.getWidth());
        fabricImg.scaleToHeight(canvas.getHeight());
        paperTextureObject = fabricImg;
        canvas.add(fabricImg);
        canvas.sendToBack(fabricImg);
        canvas.requestRenderAll();
      };

      if (normalizedRot === 0) {
        // === CASO NORMALE (nessuna rotazione) ===
        fabric.Image.fromURL(
          dataURL,
          (img) => {
            try {
              _setPaperTextureProps(img);
              console.log("[PaperTexture] ✅ Carta caricata e posizionata dietro tutto");
              resolve(img);
            } catch (err) {
              reject(err);
            }
          },
          { crossOrigin: "anonymous" }
        );
      } else {
        // === ROTAZIONE AD-HOC (90° / 270°) ===
        const imgEl = new Image();
        imgEl.crossOrigin = "anonymous";
        imgEl.onload = () => {
          const srcW = imgEl.width;
          const srcH = imgEl.height;

          let tempW = srcW;
          let tempH = srcH;
          if (normalizedRot === 90 || normalizedRot === 270) {
            tempW = srcH;
            tempH = srcW;
          }

          const tempCanvas = document.createElement("canvas");
          tempCanvas.width = tempW;
          tempCanvas.height = tempH;
          const tctx = tempCanvas.getContext("2d");

          tctx.save();
          tctx.translate(tempW / 2, tempH / 2);
          tctx.rotate((normalizedRot * Math.PI) / 180);
          tctx.drawImage(imgEl, -srcW / 2, -srcH / 2, srcW, srcH);
          tctx.restore();

          const rotatedDataURL = tempCanvas.toDataURL("image/png");

          fabric.Image.fromURL(
            rotatedDataURL,
            (fabricImg) => {
              try {
                _setPaperTextureProps(fabricImg);
                console.log(`[PaperTexture] ✅ Carta caricata e RUOTATA di ${normalizedRot}°`);
                resolve(fabricImg);
              } catch (err) {
                reject(err);
              }
            },
            { crossOrigin: "anonymous" }
          );
        };
        imgEl.onerror = (e) => reject(new Error("Errore caricamento carta per rotazione"));
        imgEl.src = dataURL;
      }
    } catch (err) {
      console.error("[PaperTexture] Errore generale:", err);
      flashToast("⚠️ Errore caricamento texture carta");
      reject(err);
    }
  });

  return paperTextureLoading;
}

function keepPaperTextureBehindEverything() {
  if (!paperTextureObject || !canvas) return;

  // ── Guard: se la texture NON è già nel canvas, NON la rimettiamo per errore ──
  // Fabric.sendToBack ha l'effetto collaterale di reinserire l'oggetto nei
  // _objects (via unshift) anche quando non era stato realmente aggiunto via
  // canvas.add(). Senza questo guard, la carta riappare al toggle della penna
  // anche quando c'è un'immagine di sfondo utente che dovrebbe coprirla.
  if (!canvas.getObjects().includes(paperTextureObject)) return;

  canvas.sendToBack(paperTextureObject);
  paperTextureObject.set({
    selectable: false,
    evented: false,
    hasControls: false,
    hasBorders: false,
    lockMovementX: true,
    lockMovementY: true,
    lockScalingX: true,
    lockScalingY: true,
    lockRotation: true
  });
  paperTextureObject.setCoords();
  canvas.requestRenderAll();
}

// ── Nasconde la texture carta dal canvas (es. quando l'utente carica un'immagine di sfondo) ──
// Mantiene il riferimento all'oggetto per poterlo ripristinare senza ricaricare da disco.
function hidePaperTexture() {
  if (!paperTextureObject || !canvas) return;
  if (!canvas.getObjects().includes(paperTextureObject)) return; // già nascosta
  canvas.remove(paperTextureObject);
  canvas.requestRenderAll();
}

// ── Ripristina la texture carta (es. dopo la rimozione dello sfondo utente) ──
function restorePaperTexture() {
  if (!canvas) return;

  // ── Guard: se c'è un'immagine di sfondo utente, la carta NON deve riapparire ──
  // (lo sfondo utente sostituisce visivamente la texture carta)
  const hasUserBg = typeof window.hasUserBackgroundImage === "function" ? window.hasUserBackgroundImage() : false;
  if (hasUserBg) return;

  if (!paperTextureObject) {
    // Non ancora caricata: carica normalmente
    ensurePaperTexture()
      .then(keepPaperTextureBehindEverything)
      .catch(() => {});
    return;
  }
  if (canvas.getObjects().includes(paperTextureObject)) return; // già presente
  canvas.add(paperTextureObject);
  canvas.sendToBack(paperTextureObject);
  paperTextureObject.set({ selectable: false, evented: false });
  paperTextureObject.setCoords();
  canvas.requestRenderAll();
}

// ==================== RIORDINO LIVELLI CANVAS ====================
// Mantiene l'ordine corretto degli oggetti sul canvas:
//   1) Sfondo (texture carta o immagine utente, marcati __isBackground)
//   2) Tratti freehand (penna, gomma, stamp acquerello, marcati __isFreehand)
//   3) Forme (triangoli, trapezi, settori, ecc.)
// In questo modo, anche con immagine di sfondo, i tratti restano sempre
// SOPRA l'immagine ma SOTTO le forme — anche in progetti già esistenti
// e dopo pushState/applySnapshot/undo/redo.
let _reorderRAF = 0;
function reorderCanvasLayers() {
  if (!canvas) return;
  const all = canvas.getObjects();
  if (!all.length) return;

  const bgItems = [];
  const freehandItems = [];
  const otherItems = [];

  for (const o of all) {
    if (o.__isBackground) bgItems.push(o);
    else if (o.__isFreehand) freehandItems.push(o);
    else otherItems.push(o);
  }

  const desired = bgItems.concat(freehandItems, otherItems);

  // Verifica se l'ordine è già corretto: in tal caso evita lavoro inutile
  let already = true;
  for (let i = 0; i < desired.length; i++) {
    if (all[i] !== desired[i]) {
      already = false;
      break;
    }
  }
  if (already) return;

  // Riposiziona gli oggetti uno per uno (Fabric: moveTo non emette eventi
  // di add/remove, quindi non innesca ricorsione del listener qui sotto)
  desired.forEach((o, i) => canvas.moveTo(o, i));
  canvas.requestRenderAll();
}

function _scheduleReorderCanvasLayers() {
  if (_reorderRAF) return;

  // ── Skip durante apply snapshot / restore progetto ──────────────────────
  // Questi due flussi gestiscono già esplicitamente l'ordine dei livelli:
  //  • applySnapshot fa sendToBack(backgroundImageObject) o restorePaperTexture
  //    DOPO loadFromJSON, mentre i tratti freehand sono ricaricati nell'ordine
  //    già corretto perché reorderCanvasLayers aveva lavorato al momento del
  //    salvataggio del JSON.
  //  • isRestoringProject copre il caricamento iniziale del progetto da disk.
  // Senza questo guard, ogni undo/redo su un progetto con centinaia di oggetti
  // generava un reorder ridondante (anche con il check "already" interno
  // è sempre 1 iterazione O(n) di confronto). Skip totale è zero-lavoro.
  //
  // Le variabili sono nel global script scope di renderer.js → accessibili
  // da freehandDrawing.js perché caricato dopo come <script> non-module.
  // (autoSave.js già usa lo stesso pattern a riga 124 per isRestoringProject.)
  if (typeof isApplyingSnapshot !== "undefined" && isApplyingSnapshot) return;
  if (typeof isRestoringProject !== "undefined" && isRestoringProject) return;

  _reorderRAF = requestAnimationFrame(() => {
    _reorderRAF = 0;
    // Re-check al frame: lo stato potrebbe essere appena cambiato durante
    // l'attesa del prossimo RAF (es. applySnapshot iniziato un istante dopo
    // lo schedule). Difesa in profondità.
    if (typeof isApplyingSnapshot !== "undefined" && isApplyingSnapshot) return;
    if (typeof isRestoringProject !== "undefined" && isRestoringProject) return;
    try {
      reorderCanvasLayers();
    } catch (err) {
      console.warn("[reorderCanvasLayers]", err);
    }
  });
}

// Listener globale: ogni volta che un oggetto viene aggiunto al canvas
// (forma, tratto, stamp acquerello, sfondo) schedula UN solo riordino al
// prossimo frame. Il debounce via RAF evita reorder ridondanti durante
// loadFromJSON / pushState / batch.
function _attachReorderHook() {
  if (!canvas || !canvas.on) return;
  if (canvas.__reorderHookAttached) return;
  canvas.__reorderHookAttached = true;
  canvas.on("object:added", _scheduleReorderCanvasLayers);
}

// ==================== HELPER COLORI ====================
function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

function hslToHex(h, s, l) {
  s /= 100;
  l /= 100;

  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;

  let r = 0,
    g = 0,
    b = 0;

  if (h < 60) {
    r = c;
    g = x;
    b = 0;
  } else if (h < 120) {
    r = x;
    g = c;
    b = 0;
  } else if (h < 180) {
    r = 0;
    g = c;
    b = x;
  } else if (h < 240) {
    r = 0;
    g = x;
    b = c;
  } else if (h < 300) {
    r = x;
    g = 0;
    b = c;
  } else {
    r = c;
    g = 0;
    b = x;
  }

  r = Math.round((r + m) * 255);
  g = Math.round((g + m) * 255);
  b = Math.round((b + m) * 255);

  return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
}

function hexToRgba(hex, alpha = 1) {
  const clean = hex.replace("#", "");
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${clamp(alpha, 0, 1)})`;
}

function tintWatercolor(baseHex, lightnessOffset, saturationFactor = 0.85) {
  let r = parseInt(baseHex.slice(1, 3), 16);
  let g = parseInt(baseHex.slice(3, 5), 16);
  let b = parseInt(baseHex.slice(5, 7), 16);

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);

  let h = 0,
    s = 0,
    l = (max + min) / 510;

  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (510 - max - min) : d / (max + min);

    if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;

    h *= 60;
  }

  const newL = Math.max(20, Math.min(95, l * 100 + lightnessOffset));
  return hslToHex(h, s * 100 * saturationFactor, newL);
}

function watercolorToneColor(baseHex, toneControl = 0.5) {
  const delta = toneControl - 0.5;

  const lightnessOffset = delta * 28; // più chiaro/scuro
  const saturationFactor = 0.88 + delta * 0.18; // più saturo/spento

  return tintWatercolor(baseHex, lightnessOffset, saturationFactor);
}

// ==================== WATERCOLOR DEFORM ENGINE (basato sul tuo algoritmo) ====================
function randomGaussian(mean = 0, stdDev = 1) {
  let u = 0,
    v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return mean + stdDev * Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
}

function getPathPoints(fabricPath) {
  const points = [];
  if (!fabricPath || !fabricPath.path) return points;
  for (let cmd of fabricPath.path) {
    const type = cmd[0];
    if (type === "M" || type === "L") {
      points.push([cmd[1], cmd[2]]);
    } else if (type === "Q") {
      points.push([cmd[3], cmd[4]]); // end point
    } else if (type === "C") {
      points.push([cmd[5], cmd[6]]);
    }
  }
  return points;
}

function rebuildPathFromPoints(points) {
  if (points.length < 2) return "";
  let d = `M ${points[0][0].toFixed(2)} ${points[0][1].toFixed(2)}`;
  for (let i = 1; i < points.length; i++) {
    d += ` L ${points[i][0].toFixed(2)} ${points[i][1].toFixed(2)}`;
  }
  return d;
}

function deformPolyline(points, depth, variance) {
  if (depth <= 0 || points.length < 2) return points.map((p) => [...p]);
  let res = [points[0].slice()];
  for (let i = 0; i < points.length - 1; i++) {
    const curr = points[i];
    const next = points[i + 1];
    const len = Math.hypot(curr[0] - next[0], curr[1] - next[1]);
    const mid = [(curr[0] + next[0]) / 2, (curr[1] + next[1]) / 2];
    mid[0] = randomGaussian(mid[0], variance * len);
    mid[1] = randomGaussian(mid[1], variance * len);
    const inner = deformPolyline([curr, mid, next], depth - 1, variance);
    res.push(...inner.slice(1));
  }
  res.push(points[points.length - 1].slice());
  return res;
}

// ==================== getCurrentBrushColor (FIXED) ====================
function getCurrentBrushColor() {
  return isWatercolorMode ? watercolorToneColor(currentStrokeColor, jitterToneControl) : currentStrokeColor;
}

// ==================== CURSORI PERSONALIZZATI ====================
// Cursori SVG inline per le 3 modalità di disegno. L'hotspot (X Y dopo il
// data-URL) coincide con la PUNTA dello strumento (matita, pennello) o col
// centro della gomma — così il punto del cursore corrisponde esattamente al
// centro del tratto disegnato/cancellato. Fallback "crosshair" se l'SVG
// dovesse fallire per qualche motivo (non dovrebbe mai succedere su Electron).

const _PEN_CURSOR_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">
  <polygon points="2,30 5,27 7,29" fill="#222" stroke="#000" stroke-width="0.6"/>
  <polygon points="5,27 7,29 11,25 9,23" fill="#f0c060" stroke="#000" stroke-width="0.6"/>
  <polygon points="9,23 11,25 23,13 21,11" fill="#ffd54a" stroke="#000" stroke-width="0.6"/>
  <polygon points="21,11 23,13 26,10 24,8" fill="#bbb" stroke="#000" stroke-width="0.6"/>
  <polygon points="24,8 26,10 29,7 27,5" fill="#ff7a8c" stroke="#000" stroke-width="0.6"/>
</svg>`;

const _WATERCOLOR_CURSOR_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">
  <polygon points="2,30 4,28 6,30 5,26" fill="#3a2818" stroke="#000" stroke-width="0.6"/>
  <polygon points="3,29 5,30 6,28 4,27" fill="#5a3828" stroke="#000" stroke-width="0.6"/>
  <polygon points="5,26 7,28 11,24 9,22" fill="#bbb" stroke="#000" stroke-width="0.6"/>
  <polygon points="9,22 11,24 27,8 25,6" fill="#8b4513" stroke="#000" stroke-width="0.6"/>
</svg>`;

const _ERASER_CURSOR_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">
  <rect x="3" y="20" width="20" height="9" rx="2" fill="#ffd1d8" stroke="#000" stroke-width="0.7"/>
  <rect x="3" y="20" width="20" height="3" rx="1" fill="#fff" stroke="#000" stroke-width="0.7"/>
</svg>`;

function _svgToCursor(svgString, hotX, hotY) {
  return `url("data:image/svg+xml;base64,${btoa(svgString)}") ${hotX} ${hotY}, crosshair`;
}

const PEN_CURSOR = _svgToCursor(_PEN_CURSOR_SVG, 2, 30); // hotspot = punta grafite
const WATERCOLOR_CURSOR = _svgToCursor(_WATERCOLOR_CURSOR_SVG, 2, 30); // hotspot = punta setole
const ERASER_CURSOR = _svgToCursor(_ERASER_CURSOR_SVG, 13, 24); // hotspot = centro gomma

// ==================== APPLY BRUSH ====================
function applyBrushSettings() {
  if (isEraserMode) {
    canvas.freeDrawingBrush = new fabric.PencilBrush(canvas);
    canvas.freeDrawingBrush.globalCompositeOperation = "source-over";
    canvas.freeDrawingBrush.color = "#ffffff";
    canvas.freeDrawingBrush.width = Math.max(12, currentLineWidth * 1.8);
    canvas.freeDrawingCursor = ERASER_CURSOR;
    return;
  }

  if (isWatercolorMode) {
    canvas.freeDrawingBrush = new window.WatercolorStampBrush(canvas);
    canvas.freeDrawingCursor = WATERCOLOR_CURSOR;
    console.log("[WatercolorStamp] Brush attivato — spacing", currentStampSpacing.toFixed(2));
  } else {
    // Se Wacom è caricato, usa il PressurePencilBrush per avere pressione
    // pixel-per-pixel sui path finalizzati. Senza Wacom (mouse) si comporta
    // come un PencilBrush ordinario (width uniforme).
    const BrushCtor = window.PressurePencilBrush || fabric.PencilBrush;
    const brush = new BrushCtor(canvas);
    brush.width = currentLineWidth;
    brush.color = currentStrokeColor;
    brush.globalCompositeOperation = "source-over";
    canvas.freeDrawingBrush = brush;
    canvas.freeDrawingCursor = PEN_CURSOR;
  }
}

function restoreFreehandLocks() {
  if (!canvas) return 0;
  let count = 0;

  canvas.getObjects().forEach((obj) => {
    if (isWatercolorOrFreehand(obj)) {
      // ← usa lo stesso helper (lo puoi copiare qui o esporlo)
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

function lockAllFreehandPaths() {
  let count = 0;
  canvas.getObjects().forEach((obj) => {
    if (isWatercolorOrFreehand(obj)) {
      obj.set({
        selectable: false,
        evented: false,
        hasControls: false,
        hasBorders: false,
        lockMovementX: true,
        lockMovementY: true,
        lockScalingX: true,
        lockScalingY: true,
        lockRotation: true
      });
      obj.setCoords();
      count++;
    }
  });
  canvas.renderAll();
  if (count > 0) flashToast(`✅ ${count} linee (penna + acquerello) bloccate sullo sfondo`);
}

// ==================== TOGGLE MODALITÀ ====================
function toggleFreehandMode() {
  const btn = document.getElementById("freehandBtn");
  isFreehandMode = !isFreehandMode;
  canvas.isDrawingMode = isFreehandMode;

  if (isFreehandMode) {
    btn.classList.add("active");
    document.getElementById("eraserBtn")?.classList.remove("active");
    document.getElementById("watercolorBtn")?.classList.remove("active");
    isEraserMode = false;
    isWatercolorMode = false;

    // ── Deseleziona eventuale forma attiva: l'Inspector deve passare alla
    //    sezione "penna" (vedi refreshInspectorContext in index.html). ──
    if (canvas.getActiveObject && canvas.getActiveObject()) {
      canvas.discardActiveObject();
      canvas.requestRenderAll();
    }

    ensurePaperTexture()
      .then(() => {
        keepPaperTextureBehindEverything();
        applyBrushSettings();
        if (typeof window.reorderCanvasLayers === "function") window.reorderCanvasLayers();
        flashToast("✏️ Modalità disegno attivo");
      })
      .catch((err) => {
        console.error("[PaperTexture] Errore caricamento carta.png", err);
        applyBrushSettings();
        if (typeof window.reorderCanvasLayers === "function") window.reorderCanvasLayers();
        flashToast("✏️ Modalità disegno attivo");
      });
  } else {
    btn.classList.remove("active");
    lockAllFreehandPaths();

    // la texture NON viene rimossa
    keepPaperTextureBehindEverything();

    flashToast("Disegno terminato — linee fissate sullo sfondo");
  }
}

function toggleEraser() {
  if (!isFreehandMode) toggleFreehandMode();
  isEraserMode = !isEraserMode;
  isWatercolorMode = false;
  document.getElementById("eraserBtn")?.classList.toggle("active", isEraserMode);
  document.getElementById("watercolorBtn")?.classList.remove("active");

  // Deseleziona eventuale forma attiva quando attivo la gomma
  if (isEraserMode && canvas.getActiveObject && canvas.getActiveObject()) {
    canvas.discardActiveObject();
    canvas.requestRenderAll();
  }

  applyBrushSettings();
  flashToast(isEraserMode ? "🧼 Gomma attivata" : "✏️ Pennello ripristinato");
}

function toggleWatercolor() {
  if (!isFreehandMode) toggleFreehandMode();

  isWatercolorMode = !isWatercolorMode;
  isEraserMode = false;

  const watercolorBtn = document.getElementById("watercolorBtn");
  const eraserBtn = document.getElementById("eraserBtn");

  watercolorBtn?.classList.toggle("active", isWatercolorMode);
  eraserBtn?.classList.remove("active");

  // Deseleziona eventuale forma attiva quando attivo l'acquerello
  if (isWatercolorMode && canvas.getActiveObject && canvas.getActiveObject()) {
    canvas.discardActiveObject();
    canvas.requestRenderAll();
  }

  canvas.isDrawingMode = true;
  applyBrushSettings();

  console.log("[WatercolorToggle]", {
    isFreehandMode,
    isWatercolorMode,
    brush: canvas.freeDrawingBrush?.constructor?.name
  });

  flashToast(isWatercolorMode ? "💧 Acquerello attivato" : "✏️ Pennello ripristinato");
}

// ==================== INIZIALIZZAZIONE ====================
function initFreehandDrawing() {
  const freeBtn = document.getElementById("freehandBtn");
  const eraserBtn = document.getElementById("eraserBtn");
  const watercolorBtn = document.getElementById("watercolorBtn");
  const widthSlider = document.getElementById("lineWidthSlider");
  const widthValue = document.getElementById("lineWidthValue");
  const strokePicker = document.getElementById("strokeColorPicker");
  const flowSlider = document.getElementById("watercolorFlowSlider");
  const toneSlider = document.getElementById("toneSlider");
  const toneValue = document.getElementById("toneValue");

  // ←←← CARICA PERSISTENZA SUBITO
  if (typeof loadFreehandSettings === "function") {
    loadFreehandSettings();
  }

  if (freeBtn) freeBtn.addEventListener("click", toggleFreehandMode);
  if (eraserBtn) eraserBtn.addEventListener("click", toggleEraser);
  if (watercolorBtn) watercolorBtn.addEventListener("click", toggleWatercolor);

  const watercolorWidthSlider = document.getElementById("watercolorWidthSlider");

  // === SLIDER ROTAZIONE INIZIALE TEXTURE PUNTA ACQUERELLO ===
  const tipRotationSlider = document.getElementById("tipInitialRotationSlider");
  const tipRotationValue = document.getElementById("tipInitialRotationValue");

  if (tipRotationSlider) {
    tipRotationSlider.addEventListener("input", () => {
      currentTipInitialRotationDeg = parseFloat(tipRotationSlider.value);
      if (tipRotationValue) {
        tipRotationValue.textContent = currentTipInitialRotationDeg.toFixed(1) + "°";
      }
      // Aggiorna live se stiamo già disegnando in modalità acquerello
      if (canvas.isDrawingMode && isWatercolorMode) {
        applyBrushSettings();
      }
    });
  }

  const watercolorWidthValue = document.getElementById("watercolorWidthValue");

  if (widthSlider) {
    widthSlider.addEventListener("input", () => {
      currentLineWidth = parseFloat(widthSlider.value);
      if (widthValue) widthValue.textContent = currentLineWidth;
      if (canvas.isDrawingMode && !isWatercolorMode && !isEraserMode) applyBrushSettings();
    });
  }

  if (watercolorWidthSlider) {
    watercolorWidthSlider.addEventListener("input", () => {
      currentWatercolorWidth = parseFloat(watercolorWidthSlider.value);
      if (watercolorWidthValue) watercolorWidthValue.textContent = currentWatercolorWidth.toFixed(1);
      if (canvas.isDrawingMode && isWatercolorMode) applyBrushSettings();
    });
  }

  // === NUOVO SLIDER DISTANZA TIMBRI ===
  const spacingSlider = document.getElementById("stampSpacingSlider");
  const spacingValue = document.getElementById("stampSpacingValue");
  if (spacingSlider) {
    spacingSlider.addEventListener("input", () => {
      currentStampSpacing = parseFloat(spacingSlider.value) / 100;
      if (spacingValue) spacingValue.textContent = currentStampSpacing.toFixed(2) + "×";
      if (canvas.isDrawingMode && isWatercolorMode) applyBrushSettings();
    });
  }

  // === SLIDER OPACITÀ (curva migliorata) ===
  const flowValue = document.getElementById("watercolorFlowValue");
  if (flowSlider) {
    flowSlider.addEventListener("input", () => {
      currentWatercolorFlow = parseFloat(flowSlider.value) / 100;
      if (flowValue) flowValue.textContent = Math.round(currentWatercolorFlow * 100) + "%";
      if (canvas.isDrawingMode && isWatercolorMode) applyBrushSettings();
    });
  }

  if (toneSlider) {
    toneSlider.addEventListener("input", () => {
      jitterToneControl = parseFloat(toneSlider.value) / 100;
      if (toneValue) toneValue.textContent = Math.round(jitterToneControl * 100) + "%";
      if (canvas.isDrawingMode && isWatercolorMode) applyBrushSettings();
    });
  }

  // legacy jitter (opzionale)
  const jitterSlider = document.getElementById("jitterSlider");
  const jitterValue = document.getElementById("jitterValue");
  if (jitterSlider) {
    jitterSlider.addEventListener("input", () => {
      currentJitterAmount = parseFloat(jitterSlider.value) / 100;
      if (jitterValue) jitterValue.textContent = Math.round(currentJitterAmount * 100) + "%";
    });
  }

  if (strokePicker) {
    strokePicker.addEventListener("input", (e) => {
      currentStrokeColor = e.target.value;
      if (canvas.isDrawingMode && !isEraserMode) applyBrushSettings();
    });
  }

  if (typeof colorInput !== "undefined" && colorInput) {
    colorInput.addEventListener("input", (e) => {
      const active = canvas.getActiveObject();
      const newColor = e.target.value;

      if (active?.type === "path") {
        active.set("stroke", newColor);
      }

      currentStrokeColor = newColor;
      if (strokePicker) strokePicker.value = newColor;
      canvas.renderAll();
      if (typeof pushState === "function") pushState();
    });
  }

  // === SLIDER JITTER POSIZIONE + ROTAZIONE PENNELLO ===
  const positionJitterSlider = document.getElementById("positionJitterSlider");
  const positionJitterValue = document.getElementById("positionJitterValue");
  if (positionJitterSlider) {
    positionJitterSlider.addEventListener("input", () => {
      currentPositionJitter = parseFloat(positionJitterSlider.value);
      if (positionJitterValue) positionJitterValue.textContent = currentPositionJitter;
      if (canvas.isDrawingMode && isWatercolorMode) applyBrushSettings();
    });
  }

  const rotationJitterSlider = document.getElementById("rotationJitterSlider");
  const rotationJitterValue = document.getElementById("rotationJitterValue");
  if (rotationJitterSlider) {
    rotationJitterSlider.addEventListener("input", () => {
      currentRotationJitter = parseFloat(rotationJitterSlider.value);
      if (rotationJitterValue) rotationJitterValue.textContent = currentRotationJitter.toFixed(1) + "°";
      if (canvas.isDrawingMode && isWatercolorMode) applyBrushSettings();
    });
  }

  const bleedSlider = document.getElementById("bleedSlider");
  const bleedValue = document.getElementById("bleedValue");
  if (bleedSlider) {
    bleedSlider.addEventListener("input", () => {
      currentBleed = parseFloat(bleedSlider.value);
      if (bleedValue) bleedValue.textContent = currentBleed.toFixed(1);
    });
  }

  const layersSlider = document.getElementById("layersSlider");
  const layersValue = document.getElementById("layersValue");
  if (layersSlider) {
    layersSlider.addEventListener("input", () => {
      currentWatercolorLayers = parseInt(layersSlider.value, 10);
      if (layersValue) layersValue.textContent = currentWatercolorLayers;
    });
  }

  // ==================== PATH CREATED — PENNA NORMALE ====================
  // Quando un path della PencilBrush viene finalizzato, applichiamo:
  //  • marker __isFreehand (come prima)
  //  • timestamp __addedAt
  //  • opacità modulata dalla pressione MEDIA del tratto (Wacom)
  //    L'opacità viene presa dal fattore corrente al momento del rilascio
  //    — è l'unica cosa Wacom-modulabile per i path Fabric, perché la
  //    width è già fissata nell'oggetto Path al momento della creazione.
  canvas.on("path:created", (opt) => {
    if (!opt.path || window.isAltPanning) return;
    if (isWatercolorMode) return; // watercolor usa onMouseUp

    opt.path.__isFreehand = true;
    opt.path.__addedAt = Date.now();

    // Applica opacità modulata da pressione (Wacom) — solo se penna era attiva
    if (typeof window.wacomGetOpacityFactor === "function" && window.wacomIsConnected) {
      const opFactor = window.wacomGetOpacityFactor();
      if (opFactor !== 1.0) {
        opt.path.set("opacity", Math.max(0.05, Math.min(1, opFactor)));
      }
    }

    if (typeof pushState === "function") pushState(); // solo main history
  });

  ensurePaperTexture()
    .then(() => {
      keepPaperTextureBehindEverything();
    })
    .catch((err) => console.warn("[PaperTexture]", err));

  _attachReorderHook();
  initFreehandManager();
}

// ====================== SELETTORE MIXING ACQUERELLO ======================
// "multiply" produce nero quasi puro quando due colori diversi si sovrappongono
// (es. rosso × blu = 0,0,0) per limite matematico intrinseco del blend mode.
// "overlay" preserva entrambi i colori: su zone scure si comporta come multiply,
// su zone chiare come screen → risultato visibile e naturale in entrambi i casi.
let currentWatercolorComposite = "overlay"; // default (era "multiply")

// ====================== SELETTORE PUNTA PENNELLO ======================
let currentBrushTip = "watercolor-stamp"; // default

// ====================== PERSISTENZA GLOBALE + PER-PROGETTO ======================
let freehandPersistentSettings = {
  general: {
    currentLineWidth: 4,
    currentWatercolorWidth: 24,
    currentStrokeColor: "#1a1a1a",
    currentStampSpacing: 0.48,
    currentWatercolorFlow: 0.82,
    jitterToneControl: 0.48,
    currentPositionJitter: 11,
    currentRotationJitter: 9.5,
    currentBleed: 3.2,
    currentWatercolorLayers: 22,
    lastBrushTip: "watercolor-stamp"
  },
  perTipInitialRotation: {} // es. { "watercolor-stamp": 0, "dry-brush": 15, ... }
};

function saveFreehandSettings() {
  freehandPersistentSettings.general = {
    currentLineWidth,
    currentWatercolorWidth,
    currentStrokeColor,
    currentStampSpacing,
    currentWatercolorFlow,
    jitterToneControl,
    currentPositionJitter,
    currentRotationJitter,
    currentBleed,
    currentWatercolorLayers,
    lastBrushTip: currentBrushTip
  };

  // salva su localStorage (fallback)
  localStorage.setItem("mosaica_freehand_settings", JSON.stringify(freehandPersistentSettings));

  // se c'è un progetto aperto, salva anche nel progetto (renderer.js lo gestirà)
  if (typeof window.pushState === "function") window.pushState();
}

function loadFreehandSettings() {
  const saved = localStorage.getItem("mosaica_freehand_settings");
  if (saved) {
    const data = JSON.parse(saved);
    Object.assign(freehandPersistentSettings, data);
  }

  // applica valori generali
  currentLineWidth = freehandPersistentSettings.general.currentLineWidth ?? 4;
  currentWatercolorWidth = freehandPersistentSettings.general.currentWatercolorWidth ?? 24;
  currentStrokeColor = freehandPersistentSettings.general.currentStrokeColor ?? "#1a1a1a";
  currentStampSpacing = freehandPersistentSettings.general.currentStampSpacing ?? 0.48;
  currentWatercolorFlow = freehandPersistentSettings.general.currentWatercolorFlow ?? 0.82;
  jitterToneControl = freehandPersistentSettings.general.jitterToneControl ?? 0.48;
  currentPositionJitter = freehandPersistentSettings.general.currentPositionJitter ?? 11;
  currentRotationJitter = freehandPersistentSettings.general.currentRotationJitter ?? 9.5;
  currentBleed = freehandPersistentSettings.general.currentBleed ?? 3.2;
  currentWatercolorLayers = freehandPersistentSettings.general.currentWatercolorLayers ?? 22;
  currentBrushTip = freehandPersistentSettings.general.lastBrushTip ?? "watercolor-stamp";

  // aggiorna tutti gli slider (per sicurezza)
  document.getElementById("lineWidthSlider").value = currentLineWidth;
  document.getElementById("lineWidthValue").textContent = currentLineWidth;
  document.getElementById("watercolorWidthSlider").value = currentWatercolorWidth;
  document.getElementById("watercolorWidthValue").textContent = currentWatercolorWidth.toFixed(1);
  document.getElementById("stampSpacingSlider").value = currentStampSpacing * 100;
  document.getElementById("stampSpacingValue").textContent = currentStampSpacing.toFixed(2) + "×";
  // ... (puoi aggiungere gli altri slider se vuoi)
}

// ====================== MODALE PUNTA PENNELLO ======================
let brushListCache = [];

async function showBrushTipModal() {
  const modal = document.getElementById("brushTipModal");
  const container = document.getElementById("brushTipList");
  if (!modal || !container) return;

  container.innerHTML = '<div style="padding:40px;text-align:center;color:#777;">Caricamento punte...</div>';

  try {
    const brushes = await window.brushAPI.listBrushes();
    brushListCache = brushes;

    container.innerHTML = "";

    brushes.forEach((brush) => {
      const item = document.createElement("div");
      item.style.cssText = `display:flex;flex-direction:column;align-items:center;gap:8px;background:#2b2b2b;padding:12px;border-radius:10px;cursor:pointer;border:2px solid ${currentBrushTip === brush.filename ? "#00c8ff" : "transparent"};`;

      // preview
      const preview = document.createElement("img");
      preview.src = brush.dataURL;
      preview.style.cssText =
        "width:90px;height:90px;object-fit:contain;background:#fff;border-radius:8px;box-shadow:0 4px 12px rgba(0,0,0,0.3);";
      preview.alt = brush.filename;

      // nome
      const name = document.createElement("div");
      name.textContent = brush.filename.replace(/-/g, " ");
      name.style.fontSize = "13px";
      name.style.fontWeight = "600";

      // rotazione iniziale per questa punta
      const rotContainer = document.createElement("div");
      rotContainer.style.cssText = "display:flex;align-items:center;gap:6px;width:100%;margin-top:6px;";
      rotContainer.innerHTML = `
        <span style="font-size:12px;white-space:nowrap;color:#aaa;">Rotaz. iniziale</span>
        <input type="number" value="${freehandPersistentSettings.perTipInitialRotation[brush.filename] ?? 0}" 
               step="0.1" min="-180" max="180" 
               style="flex:1;background:#1b1b1b;color:#fff;border:1px solid #555;border-radius:6px;padding:4px 8px;text-align:center;font-family:monospace;">
        <span style="font-size:12px;color:#aaa;">°</span>
      `;

      const rotInput = rotContainer.querySelector("input");

      // ==================== FIX PRINCIPALE ====================
      rotInput.addEventListener("click", (e) => {
        e.stopImmediatePropagation(); // blocca il click sul div padre
      });

      rotInput.addEventListener("input", () => {
        const val = parseFloat(rotInput.value) || 0;
        freehandPersistentSettings.perTipInitialRotation[brush.filename] = val;

        // se è la punta attualmente selezionata → aggiorna anche lo slider globale
        if (currentBrushTip === brush.filename) {
          currentTipInitialRotationDeg = val;
          const globalSlider = document.getElementById("tipInitialRotationSlider");
          const globalValue = document.getElementById("tipInitialRotationValue");
          if (globalSlider) globalSlider.value = val;
          if (globalValue) globalValue.textContent = val.toFixed(1) + "°";
        }
        saveFreehandSettings();
      });

      item.append(preview, name, rotContainer);

      // Click sul div → seleziona solo se NON è sull'input
      item.addEventListener("click", async (e) => {
        // evita di selezionare se l'utente sta scrivendo nella rotazione
        if (e.target.tagName === "INPUT") return;

        currentBrushTip = brush.filename;
        currentTipInitialRotationDeg = freehandPersistentSettings.perTipInitialRotation[brush.filename] ?? 0;

        // aggiorna slider globale
        const globalSlider = document.getElementById("tipInitialRotationSlider");
        const globalValue = document.getElementById("tipInitialRotationValue");
        if (globalSlider) globalSlider.value = currentTipInitialRotationDeg;
        if (globalValue) globalValue.textContent = currentTipInitialRotationDeg.toFixed(1) + "°";

        document.getElementById("currentBrushTipName").textContent = brush.filename.replace(/-/g, " ");

        if (isWatercolorMode) {
          await window.loadWatercolorStamp(currentBrushTip);
          applyBrushSettings();
        }

        saveFreehandSettings();
        modal.style.display = "none";
        flashToast(`🖌️ Punta cambiata: ${brush.filename.replace(/-/g, " ")}`);
      });

      container.appendChild(item);
    });
  } catch (e) {
    container.innerHTML = `<div style="padding:40px;text-align:center;color:#f66;">Errore caricamento punte</div>`;
  }

  modal.style.display = "flex";

  // ==================== FIX PULSANTI CHIUSURA ====================
  // (garantiamo che funzionino ogni volta che il modale viene aperto)
  const closeBtn = document.getElementById("brushTipModalCloseBtn");
  const cancelBtn = document.getElementById("brushTipModalCancelBtn");

  if (closeBtn) {
    closeBtn.onclick = () => {
      modal.style.display = "none";
    };
  }
  if (cancelBtn) {
    cancelBtn.onclick = () => {
      modal.style.display = "none";
    };
  }
}

// ====================== INIZIALIZZAZIONE (sostituisci la vecchia initBrushTipSelector) ======================
function initBrushTipSelector() {
  const btn = document.getElementById("brushTipModalBtn");
  if (!btn) return;

  btn.addEventListener("click", showBrushTipModal);

  // aggiornamento nome iniziale
  document.getElementById("currentBrushTipName").textContent = currentBrushTip.replace(/-/g, " ");
}

function initWatercolorCompositeSelector() {
  const select = document.getElementById("watercolorCompositeSelect");
  if (!select) return;

  // Carica valore salvato (se esiste).
  // MIGRAZIONE: se l'utente non aveva mai cambiato il mixing (era "multiply" di default),
  // lo azzeriamo così prende il nuovo default "overlay".
  // Se invece l'utente aveva esplicitamente scelto "multiply" non possiamo distinguerlo,
  // ma il comportamento è comunque rispettato se ha salvato la preferenza.
  const saved = localStorage.getItem("watercolorComposite");
  if (saved && saved !== "multiply") {
    // Preferenza esplicita non-multiply → la rispettiamo
    currentWatercolorComposite = saved;
    select.value = currentWatercolorComposite;
  } else if (saved === "multiply") {
    // Era il vecchio default oppure scelta esplicita: lasciamo multiply
    currentWatercolorComposite = "multiply";
    select.value = "multiply";
  } else {
    // Nessuna preferenza salvata → usa il nuovo default "overlay"
    select.value = currentWatercolorComposite; // "overlay"
  }

  select.addEventListener("change", () => {
    currentWatercolorComposite = select.value;
    localStorage.setItem("watercolorComposite", currentWatercolorComposite);
    flashToast(`🎨 Mixing cambiato in: ${select.options[select.selectedIndex].text}`);
  });

  console.log("[Watercolor] Selettore mixing inizializzato, composite attivo:", currentWatercolorComposite);
}

// ====================== AVVIO INIZIALIZZATORI ACQUERELLO ======================
// Questi due init dipendono dal DOM dell'inspector. Il file è caricato
// in fondo al body in index.html, quindi il DOM è già pronto. Per
// robustezza tienilo idempotente con un piccolo delay di sicurezza.
function _bootWatercolorInspectorInits() {
  if (typeof initWatercolorCompositeSelector === "function") {
    initWatercolorCompositeSelector();
  }
  if (typeof initBrushTipSelector === "function") {
    initBrushTipSelector();
  }
}
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", _bootWatercolorInspectorInits, { once: true });
} else {
  _bootWatercolorInspectorInits();
}

// Esposizioni globali
window.lockAllFreehandPaths = lockAllFreehandPaths;
window.restoreFreehandLocks = restoreFreehandLocks;
window.initFreehandDrawing = initFreehandDrawing;
window.currentTipInitialRotationDeg = () => currentTipInitialRotationDeg;
window.currentStampSpacing = () => currentStampSpacing;
window.ensurePaperTexture = ensurePaperTexture;
window.keepPaperTextureBehindEverything = keepPaperTextureBehindEverything;
window.hidePaperTexture = hidePaperTexture;
window.restorePaperTexture = restorePaperTexture;
window.loadFreehandSettings = loadFreehandSettings;
window.saveFreehandSettings = saveFreehandSettings;
window.reorderCanvasLayers = reorderCanvasLayers;
