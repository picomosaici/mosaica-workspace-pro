// mouseObserver.js
// =============================================================================
//  Mosaica Desktop Pro — Osservatore mouse
// -----------------------------------------------------------------------------
//  Monitora il mouse sul canvas Fabric e abilita la ROTAZIONE FINE delle
//  forme tramite tasto destro tenuto premuto + rotella.
//
//    • Quando il mouse passa SOPRA una forma, Fabric mostra di suo il cursore
//      di "move" (segnale visivo nativo di manipolabilità).
//    • Tenendo PREMUTO il TASTO DESTRO su una forma e usando la ROTELLA, la
//      forma ruota; durante l'intera sessione il CURSORE diventa l'icona di
//      ROTAZIONE personalizzata (replica stilizzata della maniglia mtr di
//      Mosaica: arco ciano #00c8ff con punta a freccia + drop-shadow).
//
//    • Passo di rotazione (controllabile con i modificatori di tastiera):
//          – nessun modificatore  →  0.25°  (default, fine grain)
//          – SHIFT premuto        →  0.5°
//          – CTRL  (o ⌘ Cmd su macOS) premuto  →  1°
//      Se Shift e Ctrl sono entrambi premuti vince Ctrl (passo 1°).
//
//    • Direzione: scroll giù (deltaY > 0) = senso orario (+),
//                 scroll su  (deltaY < 0) = senso antiorario (−).
//
//    • Il rilascio del tasto destro chiude la sessione di rotazione ed emette
//      UN solo "object:modified" → push automatico nello storico undo/redo
//      (grazie a pushStateDebounced agganciato in renderer.js).
//
//  Note di integrazione con Mosaica:
//    – findTarget() ignora gli oggetti con evented:false → tracce freehand,
//      pennellate watercolor, paper-texture e background-image NON vengono
//      mai presi come bersaglio.
//    – Le forme con lockRotation:true o __isBackground vengono ignorate.
//    – Strategia multi-fallback per individuare la forma sotto il puntatore:
//        1) calcOffset() + findTarget()  (rapido)
//        2) getPointer() + containsPoint() iterato sugli oggetti
//        3) getActiveObject() (utile se la forma è già selezionata e l'utente
//           preme destro+rotella appena fuori dalla bbox)
//      Questo risolve i casi in cui findTarget() restituisce null perché
//      l'offset interno di Fabric è "stale" dopo pan/zoom via CSS sul paper.
//    – L'handler "wheel" è registrato in fase CAPTURE su window così
//      intercetta l'evento PRIMA di QUALSIASI altro listener (incluso lo
//      zoom in renderer.js). Lo zoom viene saltato (stopImmediatePropagation)
//      SOLO durante una sessione di rotazione attiva. In tutti gli altri
//      casi l'evento passa intatto e lo zoom funziona come prima.
//    – Emettendo canvas.fire("object:rotating", ...) gli handler già
//      presenti in renderer.js (updateHandlesSpacing, positionRadial,
//      updateMeasureOverlay) rispondono come per una rotazione via maniglie.
//    – Cursore custom imposto in 3 livelli per battere Fabric:
//        · canvas.defaultCursor / canvas.hoverCursor
//        · classe `body.mosaica-rotating` + regola CSS con !important
//        · inline-style !important sull'upperCanvasEl
//
//  Per attivare i log diagnostici, eseguire in console:
//      window.__mouseObserverDebug = true
// =============================================================================

(function () {
  "use strict";

  // ── Passi di rotazione ──────────────────────────────────────────────────────
  const STEP_DEFAULT = 0.25; // nessun modificatore
  const STEP_SHIFT = 0.5; // Shift
  const STEP_CTRL = 1; // Ctrl / Cmd

  // ── Passi di scaling (in millimetri reali, riferiti al lato maggiore) ───────
  const STEP_MM_DEFAULT = 1; // nessun modificatore: ±1 mm
  const STEP_MM_SHIFT = 0.5; // Shift:               ±0.5 mm
  const STEP_MM_CTRL = 0.35; // Ctrl / Cmd:          ±0.35 mm

  // Dimensione minima (in mm) sotto la quale lo scale non contrae più
  // la forma — evita di far collassare un oggetto a 0 con troppi click destro.
  const MIN_SCALE_MM = 1;

  // ── Cursore di rotazione (SVG inline) ──────────────────────────────────────
  const ROTATION_CURSOR_SVG =
    '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" ' +
    'viewBox="-300 -300 1212 1212">' +
    '<g fill="#2100FF" style="filter:drop-shadow(0 0 60px rgba(0,0,0,0.9))">' +
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
  const ROTATION_CURSOR_URI =
    'url("data:image/svg+xml;utf8,' + encodeURIComponent(ROTATION_CURSOR_SVG) + '") 16 16, grab';

  // ── Riferimenti runtime ─────────────────────────────────────────────────────
  let canvas = null;
  let upperEl = null;
  let workspaceEl = null;

  // ── Stato sessione di rotazione ─────────────────────────────────────────────
  let rightButtonHeld = false;
  let rotationTarget = null;
  let didRotate = false;

  // Snapshot cursori per ripristino fedele
  let savedFabricDefaultCursor = null;
  let savedFabricHoverCursor = null;
  let savedUpperInlineCursor = null;

  // ── Logger diagnostico ──────────────────────────────────────────────────────
  function dbg() {
    if (window.__mouseObserverDebug) {
      console.log.apply(console, ["[mouseObserver]"].concat([].slice.call(arguments)));
    }
  }

  // ── Avvio (attende che renderer.js abbia esposto window.canvas) ─────────────
  function init() {
    if (!window.canvas || !window.canvas.upperCanvasEl) {
      return setTimeout(init, 50);
    }
    canvas = window.canvas;
    upperEl = canvas.upperCanvasEl;
    workspaceEl = document.getElementById("workspace") || upperEl;

    injectCursorStyle();
    attachListeners();
    attachRadialObservers();

    console.log(
      "[mouseObserver] osservatore attivo " +
        "(rotazione fine destro+rotella: passo 0.25° / Shift 0.5° / Ctrl 1°) " +
        "+ radial rotate/scale (sx/dx + modificatori)"
    );
  }

  // ── Iniezione regola CSS per il cursore di rotazione ───────────────────────
  // !important per battere lo style inline che Fabric scrive su upperCanvasEl.
  function injectCursorStyle() {
    if (document.getElementById("mosaicaMouseObserverStyle")) return;
    const style = document.createElement("style");
    style.id = "mosaicaMouseObserverStyle";
    style.textContent =
      "body.mosaica-rotating, " +
      "body.mosaica-rotating *, " +
      "body.mosaica-rotating canvas, " +
      "body.mosaica-rotating canvas.upper-canvas { " +
      "  cursor: " +
      ROTATION_CURSOR_URI +
      " !important; " +
      "}";
    document.head.appendChild(style);
  }

  // ── Helpers ─────────────────────────────────────────────────────────────────
  function isRotatable(obj) {
    if (!obj) return false;
    if (obj.lockRotation) return false;
    if (obj.__isBackground) return false;
    return true;
  }

  // Ricerca multi-fallback della forma sotto il puntatore.
  // Risolve i casi in cui findTarget() ritorna null perché _offset di Fabric
  // è stale dopo trasformazione CSS sul #paper.
  function findShapeAt(e) {
    // (0) ricalcola l'offset interno di Fabric (idempotente, costo trascurabile)
    if (typeof canvas.calcOffset === "function") {
      try {
        canvas.calcOffset();
      } catch (_) {
        /* ignore */
      }
    }

    // (1) findTarget standard
    let target = null;
    try {
      target = canvas.findTarget(e, false);
    } catch (_) {
      /* ignore */
    }
    if (target && isRotatable(target)) {
      dbg("findShapeAt → findTarget OK:", target.type);
      return target;
    }

    // (2) iterazione manuale con containsPoint
    try {
      const pointer = canvas.getPointer(e, true);
      const objs = canvas.getObjects();
      for (let i = objs.length - 1; i >= 0; i--) {
        const obj = objs[i];
        if (!obj.evented) continue;
        if (!isRotatable(obj)) continue;
        if (typeof obj.containsPoint === "function" && obj.containsPoint(pointer)) {
          dbg("findShapeAt → containsPoint OK:", obj.type);
          return obj;
        }
      }
    } catch (_) {
      /* ignore */
    }

    // (3) fallback su activeObject (se è una singola forma ruotabile)
    const active = canvas.getActiveObject && canvas.getActiveObject();
    if (active && isRotatable(active) && active.type !== "activeSelection") {
      dbg("findShapeAt → activeObject fallback:", active.type);
      return active;
    }

    dbg("findShapeAt → nessun target trovato");
    return null;
  }

  function currentStepDeg(wheelEvent) {
    if (wheelEvent.ctrlKey || wheelEvent.metaKey) return STEP_CTRL; // Ctrl batte Shift
    if (wheelEvent.shiftKey) return STEP_SHIFT;
    return STEP_DEFAULT;
  }

  function applyRotationCursor() {
    if (!canvas) return;
    if (savedFabricDefaultCursor === null) {
      savedFabricDefaultCursor = canvas.defaultCursor;
      savedFabricHoverCursor = canvas.hoverCursor;
      savedUpperInlineCursor = upperEl.style.cursor;
    }
    canvas.defaultCursor = ROTATION_CURSOR_URI;
    canvas.hoverCursor = ROTATION_CURSOR_URI;
    if (typeof canvas.setCursor === "function") {
      canvas.setCursor(ROTATION_CURSOR_URI);
    }
    // Triplo livello di sicurezza contro override di Fabric:
    upperEl.style.setProperty("cursor", ROTATION_CURSOR_URI, "important");
    document.body.classList.add("mosaica-rotating");
  }

  function clearRotationCursor() {
    if (!canvas) return;
    document.body.classList.remove("mosaica-rotating");
    upperEl.style.removeProperty("cursor");
    if (savedUpperInlineCursor) upperEl.style.cursor = savedUpperInlineCursor;
    if (savedFabricDefaultCursor !== null) {
      canvas.defaultCursor = savedFabricDefaultCursor;
      canvas.hoverCursor = savedFabricHoverCursor;
      savedFabricDefaultCursor = null;
      savedFabricHoverCursor = null;
      savedUpperInlineCursor = null;
    }
    if (typeof canvas.setCursor === "function" && canvas.defaultCursor) {
      canvas.setCursor(canvas.defaultCursor);
    }
  }

  function endSession(commit) {
    if (rightButtonHeld && commit && didRotate && rotationTarget) {
      rotationTarget.setCoords();
      canvas.fire("object:modified", { target: rotationTarget });
      rotationTarget.fire("modified");
      dbg("sessione chiusa con commit, angolo finale =", rotationTarget.angle);
    } else if (rightButtonHeld) {
      dbg("sessione chiusa senza commit (didRotate =", didRotate + ")");
    }
    rightButtonHeld = false;
    rotationTarget = null;
    didRotate = false;
    clearRotationCursor();
  }

  // ── Listener ────────────────────────────────────────────────────────────────
  function attachListeners() {
    // Sopprime il menu contestuale del browser sull'area canvas/workspace:
    // il tasto destro è riservato alla rotazione fine.
    upperEl.addEventListener("contextmenu", (e) => e.preventDefault());
    workspaceEl.addEventListener("contextmenu", (e) => e.preventDefault());

    // Inizio sessione: mousedown col tasto destro su una forma ruotabile.
    // Listener sia su upperEl che su workspaceEl in CAPTURE per ridondanza.
    const onDown = (e) => {
      if (e.button !== 2) return; // solo tasto destro
      if (rightButtonHeld) return; // già in sessione (capture doppio)
      if (canvas.isDrawingMode) {
        // in modalità disegno non si ruota
        dbg("mousedown destro ignorato: drawing mode attivo");
        return;
      }

      const target = findShapeAt(e);
      dbg("mousedown destro, target =", target ? target.type + " angle=" + (target.angle || 0) : "null");
      if (!target) return;

      rightButtonHeld = true;
      rotationTarget = target;
      didRotate = false;

      applyRotationCursor();

      // Evita drag/selezione nativi del browser durante la sessione
      e.preventDefault();
    };
    upperEl.addEventListener("mousedown", onDown, true);
    workspaceEl.addEventListener("mousedown", onDown, true);

    // Fine sessione: mouseup del destro (ovunque sulla finestra), in CAPTURE
    // per garantire che l'evento arrivi sempre.
    window.addEventListener(
      "mouseup",
      (e) => {
        if (!rightButtonHeld) return;
        if (e.button !== 2) return;
        endSession(true);
      },
      true
    );

    // Se la finestra perde il focus (alt-tab, ecc.), chiudo la sessione
    // committando ciò che è stato ruotato finora — niente undo "perso".
    window.addEventListener("blur", () => {
      if (rightButtonHeld) endSession(true);
    });

    // Esc come safety-net per uscire dalla sessione anche senza rilascio destro
    window.addEventListener("keydown", (e) => {
      if (rightButtonHeld && e.key === "Escape") endSession(true);
    });

    // Safety: se il bottone destro viene rilasciato senza generare mouseup
    // (es. drag-and-drop, focus rubato), rilevo il rilascio dal bitmask
    // `buttons` al primo mousemove successivo e chiudo la sessione.
    window.addEventListener(
      "mousemove",
      (e) => {
        if (rightButtonHeld && !(e.buttons & 2)) {
          dbg("mousemove rileva tasto destro non più premuto, chiudo sessione");
          endSession(true);
        }
      },
      true
    );

    // Rotella: in fase CAPTURE su window per battere QUALSIASI listener bubble
    // (zoom in renderer.js, eventuali altri). Lo zoom viene saltato solo
    // durante una sessione di rotazione attiva — in tutti gli altri casi
    // l'evento passa intatto.
    window.addEventListener(
      "wheel",
      (e) => {
        if (!rightButtonHeld || !rotationTarget) return;

        // Blocca zoom e scroll nativo SOLO durante la sessione
        e.preventDefault();
        e.stopPropagation();
        if (typeof e.stopImmediatePropagation === "function") {
          e.stopImmediatePropagation();
        }

        // Direzione: giù (+) = orario, su (−) = antiorario
        const dir = e.deltaY > 0 ? 1 : e.deltaY < 0 ? -1 : 0;
        if (!dir) return;

        const step = currentStepDeg(e);
        let next = (rotationTarget.angle || 0) + dir * step;
        // Normalizza in [0, 360)
        next = ((next % 360) + 360) % 360;

        rotationTarget.rotate(next);
        rotationTarget.setCoords();
        didRotate = true;

        dbg("rotazione: dir=", dir, "step=", step, "→ angle=", next.toFixed(3));

        // Notifica gli handler esistenti (maniglie, radial, measure overlay)
        canvas.fire("object:rotating", { target: rotationTarget, e });
        rotationTarget.fire("rotating");

        canvas.requestRenderAll();
      },
      { capture: true, passive: false }
    );
  }

  // ===========================================================================
  // OSSERVATORI BOTTONI RADIAL — rotate / scale (click sinistro e destro)
  // ---------------------------------------------------------------------------
  //  Estende il radial menu di Mosaica con controllo fine via click + modificatori
  //  sui bottoni `.radial-btn[data-action="rotate"]` e `.radial-btn[data-action="scale"]`.
  //
  //   • ROTATE (data-action="rotate"):
  //       click sinistro  → rotazione oraria (+)
  //       click destro    → rotazione antioraria (−)
  //       passo:  nessun modificatore = 0.25°
  //               Shift                = 0.5°
  //               Ctrl / Cmd           = 1°
  //
  //   • SCALE  (data-action="scale"):
  //       click sinistro  → espande la forma
  //       click destro    → contrae la forma (con minimo MIN_SCALE_MM)
  //       passo:  nessun modificatore = ±1 mm
  //               Shift                = ±0.5 mm
  //               Ctrl / Cmd           = ±0.35 mm
  //       La quantità in mm viene applicata al LATO MAGGIORE del bounding box
  //       dell'oggetto attivo, e tradotta in fattore moltiplicativo uniforme
  //       per scaleX e scaleY (mantiene le proporzioni).
  //
  //  Architettura:
  //   – I listener sono attaccati DIRETTAMENTE sui due bottoni in fase CAPTURE.
  //     Questo permette di intercettare il click PRIMA del listener bubble
  //     già presente in renderer.js (rigo ~2589, gestione click radial), che
  //     applicava i vecchi passi fissi (+15° e ×1.10). Chiamando
  //     stopImmediatePropagation() nel nostro handler, il vecchio listener
  //     viene bypassato SOLO per i bottoni rotate/scale — tutti gli altri
  //     (group, duplicate, delete, ecc.) continuano a funzionare come prima.
  //   – Il click destro è gestito tramite l'evento "contextmenu" (il click
  //     destro nativo non emette un evento "click"). preventDefault() blocca
  //     il menu contestuale del browser solo per questi due bottoni.
  //   – Dopo aver applicato la trasformazione emettiamo canvas.fire(
  //     "object:modified", ...). I listener canonici di renderer.js (righe
  //     ~1177 e ~2322) si occupano automaticamente di:
  //        · bake punti per trapezi e triangoli (mantiene __shape coerente)
  //        · pushState / pushStateDebounced (undo/redo)
  //        · positionRadial() e updateMeasureOverlay()
  //        · refreshRadialForSelection() (stato bottoni in multi-selezione)
  //     Quindi NON dobbiamo replicare manualmente nessuna di queste logiche.
  // ===========================================================================
  function attachRadialObservers() {
    const radialEl = document.getElementById("radialMenu");
    if (!radialEl) return setTimeout(attachRadialObservers, 50);

    const rotateBtn = radialEl.querySelector('.radial-btn[data-action="rotate"]');
    const scaleBtn = radialEl.querySelector('.radial-btn[data-action="scale"]');
    if (!rotateBtn || !scaleBtn) return setTimeout(attachRadialObservers, 50);

    // ── Lettura modificatori → step corrente ─────────────────────────────────
    // Ctrl batte Shift (coerente con currentStepDeg per la rotella).
    function readDegStep(e) {
      if (e.ctrlKey || e.metaKey) return STEP_CTRL; // 1°
      if (e.shiftKey) return STEP_SHIFT; // 0.5°
      return STEP_DEFAULT; // 0.25°
    }
    function readMmStep(e) {
      if (e.ctrlKey || e.metaKey) return STEP_MM_CTRL; // 0.35 mm
      if (e.shiftKey) return STEP_MM_SHIFT; // 0.5  mm
      return STEP_MM_DEFAULT; // 1    mm
    }

    // ── Recupera l'oggetto attivo, filtrando background ─────────────────────
    function getActiveTarget() {
      if (!canvas) return null;
      const obj = canvas.getActiveObject && canvas.getActiveObject();
      if (!obj) return null;
      if (obj.__isBackground) return null;
      return obj;
    }

    // ── Applica un passo di ROTAZIONE ────────────────────────────────────────
    //   dir = +1  →  oraria (click sinistro)
    //   dir = -1  →  antioraria (click destro)
    function applyRotateStep(dir, e) {
      const obj = getActiveTarget();
      if (!obj) {
        dbg("radial rotate: nessun target attivo");
        return;
      }
      if (obj.lockRotation) {
        dbg("radial rotate: target con lockRotation, ignoro");
        return;
      }

      const step = readDegStep(e);
      let next = (obj.angle || 0) + dir * step;
      // Normalizza in [0, 360)
      next = ((next % 360) + 360) % 360;

      obj.rotate(next);
      obj.setCoords();

      dbg("radial rotate: dir=", dir, "step=", step, "→ angle=", next.toFixed(3));

      // Notifica gli handler live (radial, maniglie, measure overlay)
      canvas.fire("object:rotating", { target: obj, e });
      obj.fire("rotating");

      // Commit definitivo: i listener object:modified in renderer.js fanno
      // tutto il resto (bake, pushState, positionRadial, measure overlay)
      canvas.fire("object:modified", { target: obj });
      obj.fire("modified");

      canvas.requestRenderAll();
    }

    // ── Applica un passo di SCALE in millimetri reali ────────────────────────
    //   dir = +1  →  espande (click sinistro)
    //   dir = -1  →  contrae (click destro)
    function applyScaleStep(dir, e) {
      const obj = getActiveTarget();
      if (!obj) {
        dbg("radial scale: nessun target attivo");
        return;
      }
      if (obj.lockScalingX || obj.lockScalingY) {
        dbg("radial scale: target con lockScaling, ignoro");
        return;
      }
      if (typeof window.px2mm !== "function") {
        dbg("radial scale: window.px2mm non disponibile");
        return;
      }

      // Dimensione di riferimento = LATO MAGGIORE del bbox in coordinate canvas
      // (già scalato). Su activeSelection/group ritorna il bbox aggregato →
      // comportamento atteso: il gruppo cresce/contrae uniformemente di N mm.
      const wPx =
        typeof obj.getScaledWidth === "function" ? obj.getScaledWidth() : (obj.width || 0) * (obj.scaleX || 1);
      const hPx =
        typeof obj.getScaledHeight === "function" ? obj.getScaledHeight() : (obj.height || 0) * (obj.scaleY || 1);
      const refPx = Math.max(wPx, hPx);
      const refMm = window.px2mm(refPx);
      if (!isFinite(refMm) || refMm <= 0) {
        dbg("radial scale: refMm non valido (", refMm, ")");
        return;
      }

      const stepMm = readMmStep(e);
      const nextMm = refMm + dir * stepMm;

      // Protezione contrazione eccessiva
      if (dir < 0 && nextMm < MIN_SCALE_MM) {
        dbg("radial scale: contrazione bloccata (nextMm=", nextMm, "< MIN=", MIN_SCALE_MM, ")");
        return;
      }

      const factor = nextMm / refMm;
      obj.scaleX = (obj.scaleX || 1) * factor;
      obj.scaleY = (obj.scaleY || 1) * factor;
      obj.setCoords();

      dbg(
        "radial scale: dir=",
        dir,
        "step=",
        stepMm,
        "mm",
        "refMm=",
        refMm.toFixed(2),
        "→ nextMm=",
        nextMm.toFixed(2),
        "factor=",
        factor.toFixed(4)
      );

      // Notifica handler live
      canvas.fire("object:scaling", { target: obj, e });
      obj.fire("scaling");

      // Commit: i listener object:modified fanno bake trapezio/triangolo +
      // populateTrapezoidControlsFromObject + toggleAngleControls + pushState
      // + positionRadial + updateMeasureOverlay (vedi renderer.js riga ~2322).
      canvas.fire("object:modified", { target: obj });
      obj.fire("modified");

      canvas.requestRenderAll();
    }

    // ── Click SINISTRO ───────────────────────────────────────────────────────
    // Capture phase + stopImmediatePropagation per bypassare il listener
    // bubble in renderer.js (vecchi passi +15° / ×1.10).
    function onClickRotate(e) {
      if (e.button !== undefined && e.button !== 0) return; // solo tasto sinistro
      if (rotateBtn.style.pointerEvents === "none") return; // bottone disabilitato
      e.preventDefault();
      e.stopPropagation();
      if (typeof e.stopImmediatePropagation === "function") e.stopImmediatePropagation();
      applyRotateStep(+1, e);
    }
    function onClickScale(e) {
      if (e.button !== undefined && e.button !== 0) return;
      if (scaleBtn.style.pointerEvents === "none") return;
      e.preventDefault();
      e.stopPropagation();
      if (typeof e.stopImmediatePropagation === "function") e.stopImmediatePropagation();
      applyScaleStep(+1, e);
    }

    // ── Click DESTRO (contextmenu) ───────────────────────────────────────────
    // Il click destro non genera "click", solo "contextmenu". preventDefault
    // blocca il menu nativo del browser SOLO sopra questi due bottoni.
    function onContextRotate(e) {
      e.preventDefault();
      e.stopPropagation();
      if (rotateBtn.style.pointerEvents === "none") return;
      applyRotateStep(-1, e);
    }
    function onContextScale(e) {
      e.preventDefault();
      e.stopPropagation();
      if (scaleBtn.style.pointerEvents === "none") return;
      applyScaleStep(-1, e);
    }

    rotateBtn.addEventListener("click", onClickRotate, true); // capture
    rotateBtn.addEventListener("contextmenu", onContextRotate, false);
    scaleBtn.addEventListener("click", onClickScale, true); // capture
    scaleBtn.addEventListener("contextmenu", onContextScale, false);

    dbg("attachRadialObservers: listener attaccati su rotate + scale");
  }

  // ── Bootstrap ───────────────────────────────────────────────────────────────
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
