// keyboardShortcuts.js — Scorciatoie complete (Ctrl+Z, Ctrl+C, Ctrl+V, Ctrl+X, Delete, Zoom, frecce)
// VERSIONE CORRETTA: multi-selezione, paste con preservazione posizioni, batch history

let clipboardObject = null;
let clipboardObjects = null;
let clipboardIsMulti = false;
let clipboardOffset = { x: 25, y: 25 };

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
      if (confirm("🔄 Riavviare completamente Pico Mosaici?\n\nTutti i cambiamenti non salvati andranno persi.")) {
        window.desktopAPI.restartApp();
      }
      return;
    }

    // ───── PAN + SPOSTAMENTO OGGETTI CON FRECCE ─────
    if (e.key.startsWith("Arrow")) {
      e.preventDefault();
      const active = canvas.getActiveObject();
      const step = e.shiftKey ? 10 : 1;

      if (active) {
        // sposta oggetto selezionato
        let dx = 0,
          dy = 0;
        if (e.key === "ArrowLeft") dx = -step;
        if (e.key === "ArrowRight") dx = step;
        if (e.key === "ArrowUp") dy = -step;
        if (e.key === "ArrowDown") dy = step;

        active.left += dx;
        active.top += dy;
        active.setCoords();
        canvas.renderAll();
        pushState();
      } else {
        // pan della vista se nessun oggetto selezionato
        const panStep = 30;
        if (e.key === "ArrowLeft") view.x += panStep;
        if (e.key === "ArrowRight") view.x -= panStep;
        if (e.key === "ArrowUp") view.y += panStep;
        if (e.key === "ArrowDown") view.y -= panStep;
        applyTransform();
      }
    }
  });

  console.log("[keyboardShortcuts] Scorciatoie attivate: Ctrl+Z, Ctrl+C/V/X, Delete, Ctrl+/-, frecce");
}

// Auto-avvio
initKeyboardShortcuts();
