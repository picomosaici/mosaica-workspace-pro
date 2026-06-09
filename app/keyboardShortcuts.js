// keyboardShortcuts.js — Scorciatoie complete (Ctrl+Z, Ctrl+C, Ctrl+V, Ctrl+X, Delete, Zoom, frecce)
// VERSIONE CORRETTA: multi-selezione, paste con preservazione posizioni, batch history

let clipboardObject = null;
let clipboardObjects = null;
let clipboardIsMulti = false;
let clipboardOffset = { x: 25, y: 25 };

// ── i18n helper (con fallback) ──
function __kt(key, params, fallback) {
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


// ==================== HELPERS ====================

function cloneFabricObject(obj) {
  return new Promise((resolve) => {
    obj.clone(
      (clone) => {
        // Preserva metadati importanti per le forme geometriche
        if (obj.__shape) clone.__shape = JSON.parse(JSON.stringify(obj.__shape));
        if (obj.__shapeType) clone.__shapeType = obj.__shapeType;
        if (obj.customId) clone.customId = obj.customId;
        if (obj.__isFreehand) clone.__isFreehand = obj.__isFreehand;
        if (obj.__isWatercolor) clone.__isWatercolor = obj.__isWatercolor;
        if (obj.__watercolorParams) clone.__watercolorParams = JSON.parse(JSON.stringify(obj.__watercolorParams));
        if (obj.__addedAt) clone.__addedAt = obj.__addedAt;

        // Per poligoni, deep-clone dei punti
        if (Array.isArray(clone.points)) {
          clone.points = clone.points.map((p) => ({ x: p.x, y: p.y }));
        }

        resolve(clone);
      },
      ["__shape", "__shapeType", "customId", "__isFreehand", "__isWatercolor", "__watercolorParams", "__addedAt"]
    );
  });
}

function getSelectionBoundingBox(objects) {
  if (!objects || objects.length === 0) return { left: 0, top: 0, width: 0, height: 0 };

  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;

  objects.forEach((obj) => {
    const bbox = obj.getBoundingRect(true, true);
    minX = Math.min(minX, bbox.left);
    minY = Math.min(minY, bbox.top);
    maxX = Math.max(maxX, bbox.left + bbox.width);
    maxY = Math.max(maxY, bbox.top + bbox.height);
  });

  return {
    left: minX,
    top: minY,
    width: maxX - minX,
    height: maxY - minY
  };
}

// ==================== COPY ====================
async function copySelected() {
  const active = canvas.getActiveObject();
  if (!active) return;

  const objects = active.type === "activeSelection" ? active.getObjects() : [active];

  // Clone all objects
  const clones = await Promise.all(objects.map((obj) => cloneFabricObject(obj)));

  // Per oggetti in un ActiveSelection, left/top sono relative al centro del gruppo.
  // Calcoliamo le coordinate assolute per ogni oggetto.
  const activeCenter = active.getCenterPoint();

  clones.forEach((clone, i) => {
    const origObj = objects[i];

    // Se l'oggetto è in un ActiveSelection, le sue coordinate left/top sono relative
    // al centro del gruppo. Convertiamole in assolute.
    if (active.type === "activeSelection") {
      // In ActiveSelection, left/top sono offset dal centro del gruppo
      // Le coordinate assolute = centro_gruppo + left/top_rel
      clone.__pasteAbsoluteX = activeCenter.x + (origObj.left || 0);
      clone.__pasteAbsoluteY = activeCenter.y + (origObj.top || 0);
    } else {
      // Oggetto singolo: left/top sono già assolute
      clone.__pasteAbsoluteX = origObj.left || 0;
      clone.__pasteAbsoluteY = origObj.top || 0;
    }
  });

  clipboardObjects = clones;
  clipboardIsMulti = clones.length > 1;
  clipboardObject = clipboardIsMulti ? null : clones[0];

  // Reset offset per incolla successivo
  clipboardOffset = { x: 25, y: 25 };

  flashToast(clipboardIsMulti ? `✅ ${clones.length} oggetti copiati` : "✅ Oggetto copiato");
}

// ==================== PASTE ====================
// ==================== PASTE ====================
async function paste() {
  const source = clipboardIsMulti ? clipboardObjects : clipboardObject ? [clipboardObject] : null;
  if (!source || !source.length) {
    flashToast("❌ Nulla da incollare");
    return;
  }

  // Punto di incolla base: usato solo per la multi-selezione (centro del nuovo gruppo).
  // Per la singola forma usiamo direttamente la posizione dell'originale (vedi sotto).
  const active = canvas.getActiveObject();
  let pasteBaseX, pasteBaseY;

  if (active) {
    const center = active.getCenterPoint();
    pasteBaseX = center.x + 25;
    pasteBaseY = center.y + 25;
  } else {
    pasteBaseX = canvas.getWidth() / 2;
    pasteBaseY = canvas.getHeight() / 2;
  }

  if (typeof beginBatchOperation === "function") beginBatchOperation();
  window.__suspendHistoryPush = true;

  const pasted = [];

  try {
    // Per multi-selezione: calcola il centro del gruppo copiato
    // per mantenere le posizioni relative corrette
    let sourceCenterX = 0,
      sourceCenterY = 0;
    if (clipboardIsMulti && source.length > 0) {
      const bbox = getSelectionBoundingBox(source);
      sourceCenterX = bbox.left + bbox.width / 2;
      sourceCenterY = bbox.top + bbox.height / 2;
    }

    for (let i = 0; i < source.length; i++) {
      const orig = source[i];
      const clone = await cloneFabricObject(orig);

      if (clipboardIsMulti) {
        // Mantieni la posizione relativa rispetto al centro del gruppo originale
        // e sposta tutto al punto di incolla
        const objCenterX = orig.left || 0;
        const objCenterY = orig.top || 0;
        clone.left = pasteBaseX + (objCenterX - sourceCenterX);
        clone.top = pasteBaseY + (objCenterY - sourceCenterY);
      } else {
        // Singolo oggetto: copia a DESTRA dell'originale, alla stessa quota verticale.
        // Niente offset sull'asse Y → niente effetto "diagonale".
        clone.left = (orig.left || 0) + 25;
        clone.top = orig.top || 0;
      }

      clone.set({
        selectable: true,
        evented: true,
        hasControls: true,
        hasBorders: true,
        objectCaching: false
      });

      clone.customId = generateUID();
      delete clone.__pasteOffsetX;
      delete clone.__pasteOffsetY;

      canvas.add(clone);
      pasted.push(clone);
    }
  } finally {
    window.__suspendHistoryPush = false;
    if (typeof endBatchOperation === "function") endBatchOperation();
  }

  canvas.renderAll();

  if (pasted.length === 1) {
    canvas.setActiveObject(pasted[0]);
  } else if (pasted.length > 1) {
    const sel = new fabric.ActiveSelection(pasted, { canvas });
    canvas.setActiveObject(sel);
  }

  if (typeof pushState === "function") pushState();
  if (typeof positionRadial === "function") positionRadial();
  if (typeof refreshRadialForSelection === "function") refreshRadialForSelection();

  flashToast(`✅ ${pasted.length} oggetto/i incollato/i`);
}

// ==================== CUT ====================

async function cutSelected() {
  const active = canvas.getActiveObject();
  if (!active) return;

  await copySelected();

  const objects = active.type === "activeSelection" ? active.getObjects().slice() : [active];

  // Usa batching per lo storico
  if (typeof beginBatchOperation === "function") beginBatchOperation();
  window.__suspendHistoryPush = true;

  try {
    objects.forEach((obj) => canvas.remove(obj));
    canvas.discardActiveObject();
  } finally {
    window.__suspendHistoryPush = false;
    if (typeof endBatchOperation === "function") endBatchOperation();
  }

  canvas.renderAll();
  if (typeof hideRadial === "function") hideRadial();
  flashToast(`✂️ ${objects.length} oggetto/i tagliato/i`);
}

// ==================== DELETE ====================

function deleteSelected() {
  const active = canvas.getActiveObject();
  if (!active) return;

  const objects = active.type === "activeSelection" ? active.getObjects().slice() : [active];

  // Usa batching per lo storico
  if (typeof beginBatchOperation === "function") beginBatchOperation();
  window.__suspendHistoryPush = true;

  try {
    objects.forEach((obj) => canvas.remove(obj));
    canvas.discardActiveObject();
  } finally {
    window.__suspendHistoryPush = false;
    if (typeof endBatchOperation === "function") endBatchOperation();
  }

  canvas.renderAll();
  if (typeof hideRadial === "function") hideRadial();
  flashToast(`🗑️ ${objects.length} oggetto/i eliminato/i`);
}

// ==================== SPOSTAMENTO FORME / PAN — FUNZIONE GLOBALE ====================
//
// Esposta su window per essere richiamata da:
//   • la callback delle frecce native (sotto, in initKeyboardShortcuts)
//   • inputMapping.js, quando un tasto singolo (es. "W") è mappato come
//     freccia direzionale (arrowKeyBindings).
//
// STEP IN MILLIMETRI REALI (calibrazione-aware via mm2px):
//   • default       → 0.1 mm  (precisione fine, ideale per mosaici)
//   • Shift         → 1   mm  (step "grande")
//   • Ctrl / Cmd    → 0.01 mm (super-fine, sub-pixel)
//
// SE NESSUN OGGETTO SELEZIONATO → pan della vista di 5 mm calibrati
// (più coerente del vecchio 30 px, indipendente dal monitor).
//
// COMPATIBILE Fabric ≥5.1.0: usa solo left/top/setCoords/requestRenderAll,
// emette object:moving per agganciare radial+overlay (il listener in
// renderer.js fa già RAF batching). pushState DEBOUNCED per coalescere
// le pressioni ripetute quando l'utente tiene premuta la freccia.
window.handleArrowMovement = function (direction, evt) {
  if (typeof canvas === "undefined" || !canvas) return;

  // Step in mm — Shift "grande", Ctrl/Cmd "super-fine", altrimenti default fine
  let stepMm;
  if (evt && (evt.ctrlKey || evt.metaKey)) stepMm = 0.01;
  else if (evt && evt.shiftKey) stepMm = 1;
  else stepMm = 0.1;

  // Conversione mm → px canvas tramite la calibrazione utente.
  // Fallback identity se mm2px non è ancora pronto (caricamento iniziale).
  const _mm2px = typeof window.mm2px === "function" ? window.mm2px : typeof mm2px === "function" ? mm2px : (v) => v;
  const stepPx = _mm2px(stepMm);

  const active = canvas.getActiveObject();

  if (active) {
    // ── Spostamento oggetto / selezione multipla ──────────────────────────
    let dx = 0,
      dy = 0;
    if (direction === "left") dx = -stepPx;
    else if (direction === "right") dx = stepPx;
    else if (direction === "up") dy = -stepPx;
    else if (direction === "down") dy = stepPx;
    else return;

    active.left = (active.left || 0) + dx;
    active.top = (active.top || 0) + dy;
    active.setCoords();

    // Aggiorna radial + measure overlay tramite il listener canonico
    // (RAF batched, già ottimizzato a zoom alto).
    try {
      canvas.fire("object:moving", { target: active });
    } catch (_) {}

    canvas.requestRenderAll();

    // pushState DEBOUNCED: coalesce raffiche di pressioni della freccia
    // (chi tiene premuto W o ↑ genera 30+ eventi/sec → 1 solo snapshot).
    if (typeof pushStateDebounced === "function") pushStateDebounced();
    else if (typeof pushState === "function") pushState();
  } else {
    // ── Pan della vista (5 mm calibrati per pressione) ───────────────────
    if (typeof view === "undefined" || !view) return;
    const panStepPx = _mm2px(5);

    if (direction === "left") view.x += panStepPx;
    else if (direction === "right") view.x -= panStepPx;
    else if (direction === "up") view.y += panStepPx;
    else if (direction === "down") view.y -= panStepPx;
    else return;

    if (typeof applyTransform === "function") applyTransform();
  }
};

// ==================== KEYBOARD SHORTCUTS ====================

function initKeyboardShortcuts() {
  document.addEventListener("keydown", (e) => {
    // Ignora se siamo dentro un <input> o <textarea>
    if (["INPUT", "TEXTAREA"].includes(document.activeElement?.tagName)) return;

    const ctrlOrCmd = e.ctrlKey || e.metaKey;

    // ───── UNDO / REDO ─────
    if (ctrlOrCmd && e.key.toLowerCase() === "z") {
      e.preventDefault();
      if (e.shiftKey) {
        if (redoBtn && !redoBtn.disabled) redoBtn.click();
      } else {
        if (undoBtn && !undoBtn.disabled) undoBtn.click();
      }
      return;
    }

    // ───── COPY / PASTE / CUT ─────
    if (ctrlOrCmd && e.key.toLowerCase() === "c") {
      e.preventDefault();
      copySelected();
      return;
    }
    if (ctrlOrCmd && e.key.toLowerCase() === "v") {
      e.preventDefault();
      paste();
      return;
    }
    if (ctrlOrCmd && e.key.toLowerCase() === "x") {
      e.preventDefault();
      cutSelected();
      return;
    }

    // ───── DELETE ─────
    if (e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault();
      deleteSelected();
      return;
    }

    // ───── ZOOM ─────
    if (ctrlOrCmd && (e.key === "+" || e.key === "=")) {
      e.preventDefault();
      zoomByFactor(1.2, window.innerWidth / 2, window.innerHeight / 2);
      return;
    }
    if (ctrlOrCmd && e.key === "-") {
      e.preventDefault();
      zoomByFactor(1 / 1.2, window.innerWidth / 2, window.innerHeight / 2);
      return;
    }
    if (ctrlOrCmd && e.key === "0") {
      e.preventDefault();
      resetZoomAndPan();
      return;
    }

    // ───── RESTART APP (CTRL + R) ─────
    if (ctrlOrCmd && e.key.toLowerCase() === "r") {
      e.preventDefault();
      if (confirm(__kt("kbd.confirm.restart", null, "🔄 Riavviare completamente Mosaica Workspace Pro?\n\nTutti i cambiamenti non salvati andranno persi."))) {
        window.desktopAPI.restartApp();
      }
      return;
    }

    // ───── PAN + SPOSTAMENTO OGGETTI CON FRECCE ─────
    // Step in MM reali (calibrazione-aware): 0.1 mm default, 1 mm con Shift,
    // 0.01 mm con Ctrl. Gestito da window.handleArrowMovement, riutilizzabile
    // anche da inputMapping.js per i tasti singoli mappati come frecce.
    if (e.key.startsWith("Arrow")) {
      e.preventDefault();
      let dir = null;
      if (e.key === "ArrowLeft") dir = "left";
      else if (e.key === "ArrowRight") dir = "right";
      else if (e.key === "ArrowUp") dir = "up";
      else if (e.key === "ArrowDown") dir = "down";
      if (dir && typeof window.handleArrowMovement === "function") {
        window.handleArrowMovement(dir, e);
      }
      return;
    }
  });

  console.log("[keyboardShortcuts] Scorciatoie attivate: Ctrl+Z, Ctrl+C/V/X, Delete, Ctrl+/-, frecce (step 0.1 mm)");
}

// Auto-avvio
initKeyboardShortcuts();