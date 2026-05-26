// ============================================================
//  i18n helper locale per wacomTablet.js (Fase 4)
//  ------------------------------------------------------------
//  Wrapper sicuro intorno a window.i18n.t() con fallback al
//  testo italiano originale. Vedi commento equivalente in
//  renderer.js. Nome univoco __wt per non collidere con __t.
// ============================================================
function __wt(key, params, fallback) {
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

// wacomTablet.js — Mosaica Desktop Pro
// =====================================================================
//  Integrazione tavolette/penne Wacom — REVISIONATA
//  Modello di riferimento: Bamboo Pen CTL-460 (Windows 10/11, driver
//  Wacom 6.3.x+ in modalità Windows Ink). Compatibile con qualsiasi
//  altra Wacom che esponga PointerEvent.pressure.
// ---------------------------------------------------------------------
//  NOVITÀ DI QUESTA REVISIONE:
//   1. PressurePencilBrush — sub-class di fabric.PencilBrush che salva
//      la pressione PUNTO-PER-PUNTO e finalizza un fabric.PressurePath
//      custom con width variabile lungo tutto il tratto. La pressione
//      è VERA, pixel-per-pixel, anche sui path finalizzati.
//
//   2. fabric.PressurePath — fabric.Object custom che renderizza una
//      sequenza di segmenti con stroke-width variabile. Serializzabile
//      (toObject / fromObject), esportabile in SVG, integrato con il
//      sistema undo/redo di Mosaica.
//
//   3. TILT (inclinazione penna) — letta da PointerEvent.tiltX/tiltY,
//      esposta come fattori moltiplicativi:
//        • wacomGetTiltWidthMultiplier() → allarga la pennellata
//        • wacomGetTiltRotationOffset()  → ruota il timbro (acquerello)
//      L'acquerello la consuma in watercolorStampBrush per realismo
//      pieno (pennellata "di lato" più larga + orientata).
//
//   4. CALIBRAZIONE TASTI PENNA — i due tasti laterali della Bamboo
//      CTL-460 (e altri modelli) vengono mappati su valori di
//      PointerEvent.button che DIFFERISCONO fra driver e modalità.
//      Adesso l'utente può "imparare" i tasti dal modale: clicca
//      "Calibra tasto basso/alto", preme il tasto sulla penna, e il
//      codice button viene salvato in prefs.learnedLowerButtonCode /
//      learnedUpperButtonCode. Niente più euristiche cieche.
//
//   5. Listener contextmenu globale — su alcuni driver Wacom il tasto
//      basso non spara pointerdown con button=2 ma genera direttamente
//      un evento contextmenu (right-click di sistema). Ora viene
//      catturato come azione del tasto basso.
//
//  COMPATIBILITÀ:
//   • Tutte le API esposte prima (wacomGetWidthFactor, wacomGetOpacityFactor,
//     wacomGetFlowFactor, wacomCurrentPressure, wacomIsConnected,
//     window.WacomTablet.*) restano disponibili e con la stessa firma.
//   • Nuove API: wacomGetTiltMagnitude, wacomGetTiltAngle,
//     wacomGetTiltWidthMultiplier, wacomGetTiltRotationOffset,
//     wacomGetCurrentPressureRaw, window.PressurePencilBrush,
//     fabric.PressurePath.
//   • Senza Wacom collegata, tutto continua a comportarsi come prima:
//     i fattori restano 1.0, la tilt 0, e PressurePencilBrush si
//     comporta come un PencilBrush ordinario (width uniforme).
//
//  PERSISTENZA: localStorage "mosaica_wacom_settings".
// =====================================================================

(function () {
  "use strict";

  // ════════════════════════════════════════════════════════════════════
  // STATO INTERNO
  // ════════════════════════════════════════════════════════════════════
  const STATE = {
    isConnected: false,
    isPenDown: false,
    currentPressure: null,
    currentPointerType: null,
    currentTiltX: 0,
    currentTiltY: 0,
    currentTwist: 0,
    currentTiltMagnitude: 0, // 0..1 (sin dell'angolo dalla normale)
    currentTiltAngle: 0, // radianti (atan2 di tiltY,tiltX)
    lastPenSeenAt: 0,
    detectedDevices: [],
    windowsInkMode: null,
    pointerListenerAttached: false,
    contextMenuListenerAttached: false,
    auxClickListenerAttached: false,
    calibrationMode: null, // null | "lower" | "upper"
    calibrationTimeoutId: null
  };

  // ════════════════════════════════════════════════════════════════════
  // PREFERENZE PERSISTENTI
  // ════════════════════════════════════════════════════════════════════
  const DEFAULT_PREFS = {
    enabled: true,
    pressureSensitivity: 1.0,
    pressureCurve: "linear",
    modulateWidth: true,
    minWidthFactor: 0.2,
    maxWidthFactor: 1.2,
    modulateOpacity: true,
    minOpacityFactor: 0.35,
    maxOpacityFactor: 1.0,
    modulateFlow: true,
    minFlowFactor: 0.4,
    maxFlowFactor: 1.0,
    // === TILT ===
    modulateTilt: true,
    tiltWidthAmount: 0.5, // 0..1: a tilt max → width × (1 + amount)
    tiltRotateAmount: 1.0, // 0..1: 1.0 = il timbro segue completamente l'inclinazione
    // === TASTI PENNA ===
    penLowerButtonAction: "right-click",
    penUpperButtonAction: "double-click",
    learnedLowerButtonCode: 2, // default = right-click classico
    learnedUpperButtonCode: null, // null = non calibrato, uso euristica (button=4,5)
    showHoverCursor: true
  };

  let prefs = { ...DEFAULT_PREFS };

  // ════════════════════════════════════════════════════════════════════
  // AZIONI MAPPABILI SUI TASTI PENNA
  // ════════════════════════════════════════════════════════════════════
  const PEN_BUTTON_ACTIONS = {
    // NB: le label vengono valutate ora alla creazione dell'oggetto.
    // Poiché i18n.setLanguage() fa reload della finestra (vedi i18n.js),
    // il modulo wacomTablet viene re-istanziato e le label nascono già
    // tradotte. Il fallback IT garantisce funzionamento anche se window.i18n
    // non è ancora pronto al primo passaggio.
    none:               { label: __wt("wacom.action.none",            null, "Nessuna azione"),         icon: "⊘" },
    "right-click":      { label: __wt("wacom.action.rightClick",      null, "Click destro (default)"),  icon: "🖱️" },
    "double-click":     { label: __wt("wacom.action.doubleClick",     null, "Doppio click"),            icon: "⚡" },
    eraser:             { label: __wt("wacom.action.eraser",          null, "Gomma rapida"),            icon: "🧼" },
    pan:                { label: __wt("wacom.action.pan",             null, "Pan canvas (Alt+drag)"),   icon: "✋" },
    undo:               { label: __wt("wacom.action.undo",            null, "Annulla (Ctrl+Z)"),        icon: "↩️" },
    redo:               { label: __wt("wacom.action.redo",            null, "Ripeti (Ctrl+Y)"),         icon: "↪️" },
    "toggle-freehand":  { label: __wt("wacom.action.toggleFreehand",  null, "Toggle Penna"),            icon: "✏️" },
    "toggle-watercolor":{ label: __wt("wacom.action.toggleWatercolor",null, "Toggle Acquerello"),       icon: "💧" },
    "toggle-lasso":     { label: __wt("wacom.action.toggleLasso",     null, "Toggle Lazo"),             icon: "⭕" }
  };

  // ════════════════════════════════════════════════════════════════════
  // UTILITY
  // ════════════════════════════════════════════════════════════════════
  function clamp(v, min, max) {
    return Math.max(min, Math.min(max, v));
  }

  function escapeHTML(s) {
    return String(s).replace(
      /[&<>"']/g,
      (m) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;"
        })[m]
    );
  }

  // ════════════════════════════════════════════════════════════════════
  // PERSISTENZA
  // ════════════════════════════════════════════════════════════════════
  const STORAGE_KEY = "mosaica_wacom_settings";

  function loadPrefs() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const saved = JSON.parse(raw);
      Object.keys(DEFAULT_PREFS).forEach((k) => {
        if (k in saved) prefs[k] = saved[k];
      });
      // Sanitizzazione difensiva
      prefs.pressureSensitivity = clamp(prefs.pressureSensitivity, 0, 2);
      prefs.minWidthFactor = clamp(prefs.minWidthFactor, 0, 2);
      prefs.maxWidthFactor = clamp(prefs.maxWidthFactor, 0, 3);
      prefs.minOpacityFactor = clamp(prefs.minOpacityFactor, 0, 1);
      prefs.maxOpacityFactor = clamp(prefs.maxOpacityFactor, 0, 1);
      prefs.minFlowFactor = clamp(prefs.minFlowFactor, 0, 1);
      prefs.maxFlowFactor = clamp(prefs.maxFlowFactor, 0, 1);
      prefs.tiltWidthAmount = clamp(prefs.tiltWidthAmount, 0, 1);
      prefs.tiltRotateAmount = clamp(prefs.tiltRotateAmount, 0, 1);
    } catch (e) {
      console.warn("[Wacom] loadPrefs fallito, uso defaults:", e);
      prefs = { ...DEFAULT_PREFS };
    }
  }

  function savePrefs() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
    } catch (e) {
      console.warn("[Wacom] savePrefs fallito:", e);
    }
  }

  // ════════════════════════════════════════════════════════════════════
  // CURVE DI PRESSIONE
  // ════════════════════════════════════════════════════════════════════
  function applyPressureCurve(p, curve) {
    if (!Number.isFinite(p)) return 0;
    p = clamp(p, 0, 1);
    switch (curve) {
      case "soft":
        return Math.pow(p, 0.55);
      case "hard":
        return Math.pow(p, 1.85);
      case "stairs":
        return Math.round(p * 4) / 4;
      case "linear":
      default:
        return p;
    }
  }

  function getProcessedPressure() {
    if (STATE.currentPressure == null) return null;
    if (!prefs.enabled) return null;
    const curved = applyPressureCurve(STATE.currentPressure, prefs.pressureCurve);
    return clamp(curved * prefs.pressureSensitivity, 0, 1.5);
  }

  // Pressione raw (0..1), usata dal PressurePencilBrush per campionare ogni punto.
  // Restituisce un valore SEMPRE: se non c'è Wacom o pressione, ritorna null
  // (il brush sa cadere su un valore di fallback).
  function getCurrentPressureRaw() {
    return STATE.currentPressure;
  }

  // ════════════════════════════════════════════════════════════════════
  // FATTORI MOLTIPLICATIVI (1.0 = nessuna modulazione)
  // ════════════════════════════════════════════════════════════════════
  function getWidthFactor() {
    if (!prefs.enabled || !prefs.modulateWidth) return 1.0;
    const p = getProcessedPressure();
    if (p == null) return 1.0;
    return prefs.minWidthFactor + (prefs.maxWidthFactor - prefs.minWidthFactor) * clamp(p, 0, 1);
  }
  function getOpacityFactor() {
    if (!prefs.enabled || !prefs.modulateOpacity) return 1.0;
    const p = getProcessedPressure();
    if (p == null) return 1.0;
    return prefs.minOpacityFactor + (prefs.maxOpacityFactor - prefs.minOpacityFactor) * clamp(p, 0, 1);
  }
  function getFlowFactor() {
    if (!prefs.enabled || !prefs.modulateFlow) return 1.0;
    const p = getProcessedPressure();
    if (p == null) return 1.0;
    return prefs.minFlowFactor + (prefs.maxFlowFactor - prefs.minFlowFactor) * clamp(p, 0, 1);
  }

  // ── TILT helpers ────────────────────────────────────────────────────
  function getTiltMagnitude() {
    return STATE.currentTiltMagnitude;
  }
  function getTiltAngle() {
    return STATE.currentTiltAngle;
  }

  // Moltiplicatore di width per la tilt: a tilt 0 → 1.0, a tilt max → 1+amount.
  // Default amount = 0.5 → pennellata fino al +50% se penna molto inclinata.
  function getTiltWidthMultiplier() {
    if (!prefs.enabled || !prefs.modulateTilt) return 1.0;
    return 1.0 + STATE.currentTiltMagnitude * clamp(prefs.tiltWidthAmount, 0, 1);
  }

  // Offset di rotazione (radianti) per il timbro acquerello, derivato
  // dall'orientamento della penna. Scalato da tiltRotateAmount (0..1).
  function getTiltRotationOffset() {
    if (!prefs.enabled || !prefs.modulateTilt) return 0;
    return STATE.currentTiltAngle * clamp(prefs.tiltRotateAmount, 0, 1);
  }

  // ════════════════════════════════════════════════════════════════════
  // LETTURA SINCRONA DA POINTEREVENT — usato dai brush
  // ────────────────────────────────────────────────────────────────────
  // I brush (PressurePencilBrush, WatercolorStampBrush) chiamano questa
  // funzione all'INIZIO del loro onMouseDown/onMouseMove, passando
  // l'evento ricevuto da Fabric (options.e). In questo modo lo stato
  // Wacom viene aggiornato PRIMA che il brush legga i fattori
  // (getWidthFactor, getOpacityFactor, getTiltWidthMultiplier, …) e
  // quindi i valori sono SEMPRE freschi, indipendentemente dall'ordine
  // con cui i listener pointer della finestra vengono chiamati.
  // ════════════════════════════════════════════════════════════════════
  function readFromEvent(e) {
    if (!e || typeof e !== "object") return;
    STATE.currentPointerType = e.pointerType;
    STATE.lastEventTime = Date.now();

    if (e.pointerType === "pen") {
      if (!STATE.isConnected) {
        STATE.isConnected = true;
        STATE.windowsInkMode = true;
        _emitConnectionChange();
      }
      STATE.lastPenSeenAt = Date.now();
      STATE.currentPressure = typeof e.pressure === "number" ? e.pressure : 0;
      STATE.currentTiltX = e.tiltX || 0;
      STATE.currentTiltY = e.tiltY || 0;
      STATE.currentTwist = e.twist || 0;
      const tx = STATE.currentTiltX;
      const ty = STATE.currentTiltY;
      STATE.currentTiltMagnitude = clamp(Math.hypot(tx, ty) / 90, 0, 1);
      STATE.currentTiltAngle = tx === 0 && ty === 0 ? 0 : Math.atan2(ty, tx);
    } else if (e.pointerType === "mouse") {
      // Mouse: nessuna pressione/tilt → i fattori tornano 1.0,
      // gli slider riprendono il loro effetto pieno.
      STATE.currentPressure = null;
      STATE.currentTiltMagnitude = 0;
      STATE.currentTiltAngle = 0;
    }
  }

  // ════════════════════════════════════════════════════════════════════
  // POINTER EVENTS — INTERCETTAZIONE in FASE CAPTURE
  // ════════════════════════════════════════════════════════════════════
  function _onPointerEvent(e) {
    STATE.currentPointerType = e.pointerType;
    STATE.lastEventTime = Date.now();

    if (e.pointerType === "pen") {
      if (!STATE.isConnected) {
        STATE.isConnected = true;
        STATE.windowsInkMode = true;
        _emitConnectionChange();
      }
      STATE.lastPenSeenAt = Date.now();

      if (e.type === "pointerdown" || e.type === "pointermove") {
        STATE.currentPressure = typeof e.pressure === "number" ? e.pressure : 0;
        STATE.currentTiltX = e.tiltX || 0;
        STATE.currentTiltY = e.tiltY || 0;
        STATE.currentTwist = e.twist || 0;
        // Magnitudine inclinazione 0..1 (90° = piatta sulla tavola)
        const tx = STATE.currentTiltX;
        const ty = STATE.currentTiltY;
        STATE.currentTiltMagnitude = clamp(Math.hypot(tx, ty) / 90, 0, 1);
        // Angolo orientamento penna nel piano XY (radianti)
        STATE.currentTiltAngle = tx === 0 && ty === 0 ? 0 : Math.atan2(ty, tx);
      } else if (e.type === "pointerup" || e.type === "pointercancel" || e.type === "pointerleave") {
        STATE.currentPressure = null;
        STATE.isPenDown = false;
        STATE.currentTiltMagnitude = 0;
        STATE.currentTiltAngle = 0;
      }

      if (e.type === "pointerdown") {
        STATE.isPenDown = true;

        // CALIBRAZIONE TASTI — se l'utente sta calibrando, registriamo
        // il valore di button e usciamo (non eseguiamo l'azione).
        if (STATE.calibrationMode && e.button > 0) {
          _captureCalibratedButton(e.button);
          try {
            e.preventDefault();
            e.stopPropagation();
          } catch (_) {}
          return;
        }

        // Riconoscimento tasto laterale tramite codice imparato + euristica
        if (e.button > 0) {
          const which = _identifyPenButton(e.button);
          if (which) _handlePenButton(which, e);
        }
      }

      // Modulazione live della width del PencilBrush standard
      // (il PressurePencilBrush gestisce la propria pressione internamente)
      _autoModulatePencilBrushWidth();
    } else if (e.pointerType === "mouse") {
      STATE.currentPressure = null;
      STATE.isPenDown = false;
      STATE.currentTiltMagnitude = 0;
      STATE.currentTiltAngle = 0;
    }
  }

  // Identifica quale tasto laterale è stato premuto in base al valore button.
  // Usa i codici imparati dall'utente se presenti, altrimenti euristica.
  // Codici riconosciuti:
  //   0..5  = PointerEvent.button standard
  //   -2    = evento contextmenu sintetico (driver che emette solo right-click)
  function _identifyPenButton(buttonCode) {
    // Tasto BASSO (default driver Wacom: button=2 = right-click)
    if (prefs.learnedLowerButtonCode != null && buttonCode === prefs.learnedLowerButtonCode) {
      return "lower";
    }
    // Tasto ALTO (codice imparato — può essere 1, 4, o 5 a seconda del driver)
    if (prefs.learnedUpperButtonCode != null && buttonCode === prefs.learnedUpperButtonCode) {
      return "upper";
    }
    // Euristica di fallback se non calibrati
    if (prefs.learnedLowerButtonCode == null && buttonCode === 2) return "lower";
    if (prefs.learnedUpperButtonCode == null && (buttonCode === 4 || buttonCode === 5 || buttonCode === 1))
      return "upper";
    return null;
  }

  // ────────────────────────────────────────────────────────────────────
  // Modulazione LIVE della width del PencilBrush (penna ordinaria).
  //  • Acquerello (watercolor-stamp) → self-managed, skip
  //  • PressurePencilBrush (pressure-pencil) → self-managed, skip
  //  • Gomma (PencilBrush bianco) → skip (sempre piena potenza)
  // ────────────────────────────────────────────────────────────────────
  function _autoModulatePencilBrushWidth() {
    const c = window.canvas;
    if (!c || !c.isDrawingMode || !c.freeDrawingBrush) return;

    const brush = c.freeDrawingBrush;
    if (brush && brush.name === "watercolor-stamp") return;
    if (brush && brush.name === "pressure-pencil") return;
    if (brush.color === "#ffffff" || brush.color === "rgb(255,255,255)") return;

    if (typeof brush.__wacomBaseWidth !== "number" || brush.__wacomBaseWidthDirty) {
      brush.__wacomBaseWidth = brush.width;
      brush.__wacomBaseWidthDirty = false;
    }

    const factor = getWidthFactor();
    brush.width = Math.max(0.5, brush.__wacomBaseWidth * factor);
  }

  function invalidatePencilBrushBaseWidth() {
    const c = window.canvas;
    if (c && c.freeDrawingBrush) {
      c.freeDrawingBrush.__wacomBaseWidthDirty = true;
    }
  }

  // ════════════════════════════════════════════════════════════════════
  // TASTI LATERALI PENNA — handler + listener fallback
  // ════════════════════════════════════════════════════════════════════
  function _handlePenButton(which, e) {
    const action = which === "lower" ? prefs.penLowerButtonAction : prefs.penUpperButtonAction;

    if (action === "right-click") return; // lascia passare al browser

    if (action === "none") {
      try {
        e.preventDefault();
      } catch (_) {}
      return;
    }

    try {
      e.preventDefault();
      e.stopPropagation();
    } catch (_) {}

    switch (action) {
      case "double-click":
        _simulateDoubleClickAt(e);
        break;
      case "eraser":
        document.getElementById("eraserBtn")?.click();
        if (typeof window.flashToast === "function") window.flashToast(__wt("wacom.toast.eraser", null, "🧼 Gomma (tasto penna)"));
        break;
      case "pan":
        window.isAltPanning = true;
        const release = () => {
          window.isAltPanning = false;
          window.removeEventListener("pointerup", release, true);
          window.removeEventListener("pointercancel", release, true);
        };
        window.addEventListener("pointerup", release, true);
        window.addEventListener("pointercancel", release, true);
        break;
      case "undo":
        document.dispatchEvent(
          new KeyboardEvent("keydown", {
            key: "z",
            code: "KeyZ",
            ctrlKey: true,
            bubbles: true
          })
        );
        if (typeof window.flashToast === "function") window.flashToast(__wt("wacom.toast.undo", null, "↩️ Annulla (tasto penna)"));
        break;
      case "redo":
        document.dispatchEvent(
          new KeyboardEvent("keydown", {
            key: "y",
            code: "KeyY",
            ctrlKey: true,
            bubbles: true
          })
        );
        if (typeof window.flashToast === "function") window.flashToast(__wt("wacom.toast.redo", null, "↪️ Ripeti (tasto penna)"));
        break;
      case "toggle-freehand":
        document.getElementById("freehandBtn")?.click();
        break;
      case "toggle-watercolor":
        document.getElementById("watercolorBtn")?.click();
        break;
      case "toggle-lasso":
        document.getElementById("lassoSelectBtn")?.click();
        break;
    }
  }

  function _simulateDoubleClickAt(e) {
    const target = e.target;
    if (!target) return;
    const dbl = new MouseEvent("dblclick", {
      bubbles: true,
      cancelable: true,
      clientX: e.clientX,
      clientY: e.clientY,
      button: 0
    });
    target.dispatchEvent(dbl);
  }

  // Listener contextmenu globale: alcuni driver Wacom mappano il tasto
  // basso direttamente a un evento contextmenu (right-click di sistema)
  // SENZA passare per pointerdown con button=2. Lo intercettiamo qui.
  function _onContextMenu(e) {
    // Solo se l'ultimo input era una penna (entro 500ms)
    const recentPen = Date.now() - STATE.lastPenSeenAt < 500;
    if (!recentPen) return;

    // ── CALIBRAZIONE ──
    // Se siamo in calibrazione e il driver sta emettendo un contextmenu
    // come risposta al tasto, usiamo un codice convenzionale "-2"
    // (contextmenu) per distinguerlo dai codici button standard (0..5).
    // Così _identifyPenButton lo potrà riconoscere come quel tasto specifico.
    if (STATE.calibrationMode) {
      try {
        e.preventDefault();
        e.stopPropagation();
      } catch (_) {}
      _captureCalibratedButton(-2); // -2 = "contextmenu" sintetico
      return;
    }

    // Se l'azione è "right-click", non facciamo nulla (default)
    if (prefs.penLowerButtonAction === "right-click") return;

    // Altrimenti blocchiamo il menu contestuale e gestiamo come tasto basso
    try {
      e.preventDefault();
      e.stopPropagation();
    } catch (_) {}
    _handlePenButton("lower", e);
  }

  // Alcuni driver Wacom sparano "auxclick" per il tasto alto della penna.
  function _onAuxClick(e) {
    if (STATE.currentPointerType !== "pen") return;

    // ── CALIBRAZIONE ──
    // Su molti driver il tasto ALTO arriva SOLO come auxclick, non come
    // pointerdown. Per questo durante la calibrazione catturiamo qui
    // il button code: senza questo, calibrare il tasto alto è impossibile.
    if (STATE.calibrationMode && e.button > 0) {
      try {
        e.preventDefault();
        e.stopPropagation();
      } catch (_) {}
      _captureCalibratedButton(e.button);
      return;
    }
    if (STATE.calibrationMode) return; // calibrazione attiva ma button 0 → ignora

    // button=1 (middle), button=3 (back), button=4 (forward) sono spesso
    // usati per il tasto alto a seconda del driver.
    const which = _identifyPenButton(e.button);
    if (which) {
      try {
        e.preventDefault();
      } catch (_) {}
      _handlePenButton(which, e);
    }
  }

  // ════════════════════════════════════════════════════════════════════
  // CALIBRAZIONE TASTI
  // ════════════════════════════════════════════════════════════════════
  function startButtonCalibration(which) {
    if (which !== "lower" && which !== "upper") return;
    STATE.calibrationMode = which;
    _updateCalibrationUI();

    // Timeout di sicurezza dopo 10s
    if (STATE.calibrationTimeoutId) clearTimeout(STATE.calibrationTimeoutId);
    STATE.calibrationTimeoutId = setTimeout(() => {
      if (STATE.calibrationMode) {
        STATE.calibrationMode = null;
        _updateCalibrationUI();
        if (typeof window.flashToast === "function") {
          window.flashToast(__wt("wacom.toast.calib.timeout", null, "⏱️ Calibrazione tasto scaduta (10s) — riprova"));
        }
      }
    }, 10000);
  }

  function cancelButtonCalibration() {
    STATE.calibrationMode = null;
    if (STATE.calibrationTimeoutId) {
      clearTimeout(STATE.calibrationTimeoutId);
      STATE.calibrationTimeoutId = null;
    }
    _updateCalibrationUI();
  }

  function _captureCalibratedButton(buttonCode) {
    const which = STATE.calibrationMode;
    if (!which) return;
    if (which === "lower") prefs.learnedLowerButtonCode = buttonCode;
    else if (which === "upper") prefs.learnedUpperButtonCode = buttonCode;
    savePrefs();

    STATE.calibrationMode = null;
    if (STATE.calibrationTimeoutId) {
      clearTimeout(STATE.calibrationTimeoutId);
      STATE.calibrationTimeoutId = null;
    }
    _updateCalibrationUI();

    if (typeof window.flashToast === "function") {
      window.flashToast(__wt("wacom.toast.calib.success", {
        which: which === "lower" ? __wt("wacom.toast.calib.whichLow", null, "BASSO") : __wt("wacom.toast.calib.whichHigh", null, "ALTO"),
        code: buttonCode
      }, `✅ Tasto ${which === "lower" ? "BASSO" : "ALTO"} calibrato (code=${buttonCode})`));
    }
  }

  function _updateCalibrationUI() {
    const statusEl = document.getElementById("wacomCalibrationStatus");
    if (!statusEl) return;

    function fmtCode(code) {
      if (code == null) return null;
      if (code === -2) return __wt("wacom.calib.codeContextmenu", null, "contextmenu (right-click sintetico)");
      return __wt("wacom.calib.codePrefix", { code: code }, `code ${code}`);
    }

    if (STATE.calibrationMode === "lower") {
      statusEl.innerHTML = `<span style="color:#fbbf24;font-weight:600;">${__wt("wacom.calib.pressLow", null, "⏳ Premi ora il tasto BASSO della penna...")}</span>`;
    } else if (STATE.calibrationMode === "upper") {
      statusEl.innerHTML = `<span style="color:#fbbf24;font-weight:600;">${__wt("wacom.calib.pressHigh", null, "⏳ Premi ora il tasto ALTO della penna...")}</span> <span style="color:#888;font-size:11px;">${__wt("wacom.calib.pressHighHint", null, "(se non viene rilevato dopo qualche tentativo, il driver Wacom potrebbe non emetterlo: vedi nota sotto)")}</span>`;
    } else {
      const lowerStr = fmtCode(prefs.learnedLowerButtonCode) || __wt("wacom.calib.notCalibrated", null, "non calibrato (uso euristica)");
      const upperStr = fmtCode(prefs.learnedUpperButtonCode) || __wt("wacom.calib.notCalibrated", null, "non calibrato (uso euristica)");
      // La chiave wacom.calib.summary contiene "Basso: {low} · Alto: {high}" (IT)
      // o "Low: {low} · High: {high}" (EN). Per preservare l'HTML, costruiamo
      // il testo tradotto a partire dalla stringa template e poi reinseriamo i
      // <b> attorno ai valori sostituendo i placeholder con segnaposto temporanei.
      const summaryTpl = __wt("wacom.calib.summary", null, "Basso: {low} · Alto: {high}");
      // Sostituiamo {low} / {high} con i tag <b> già pieni dei valori.
      const summaryHTML = summaryTpl
        .replace("{low}", `<b style="color:#4ade80;">${lowerStr}</b>`)
        .replace("{high}", `<b style="color:#4ade80;">${upperStr}</b>`);
      statusEl.innerHTML = `<span style="color:#aaa;font-size:12px;">${summaryHTML}</span>`;
    }
  }

  // ════════════════════════════════════════════════════════════════════
  // RILEVAZIONE DEVICE (via WMI da main.js)
  // ════════════════════════════════════════════════════════════════════
  async function _detectDevicesFromMain() {
    try {
      if (!window.wacomAPI || typeof window.wacomAPI.detectDevices !== "function") {
        console.log("[Wacom] wacomAPI non disponibile (preload?)");
        return [];
      }
      const devs = await window.wacomAPI.detectDevices();
      STATE.detectedDevices = Array.isArray(devs) ? devs : [];
      if (STATE.detectedDevices.length > 0) {
        STATE.isConnected = true;
        _emitConnectionChange();
        console.log("[Wacom] Device rilevati via WMI:", STATE.detectedDevices);
      } else {
        console.log("[Wacom] Nessun device rilevato via WMI (fallback runtime su pointer pen)");
      }
      return STATE.detectedDevices;
    } catch (e) {
      console.warn("[Wacom] Detect failed:", e);
      return [];
    }
  }

  function _emitConnectionChange() {
    try {
      window.dispatchEvent(
        new CustomEvent("wacom:connection-changed", {
          detail: { connected: STATE.isConnected, devices: STATE.detectedDevices }
        })
      );
    } catch (_) {}
    _updateToolbarIndicator();
  }

  // ════════════════════════════════════════════════════════════════════
  // TOOLBAR — INDICATORE STATO
  // ════════════════════════════════════════════════════════════════════
  function _updateToolbarIndicator() {
    const btn = document.getElementById("wacomToolbarBtn");
    if (!btn) return;
    btn.classList.toggle("wacom-connected", STATE.isConnected);
    btn.title = STATE.isConnected
      ? __wt("wacom.toolbar.connectedTooltip", null, "Tavoletta Wacom connessa — clicca per impostazioni")
      : __wt("wacom.toolbar.disconnectedTooltip", null, "Tavoletta Wacom non rilevata — clicca per impostazioni");
  }

  function _bindToolbarButton() {
    const btn = document.getElementById("wacomToolbarBtn");
    if (!btn) return;
    if (btn.__wacomBound) return;
    btn.__wacomBound = true;
    btn.addEventListener("click", openConfigModal);
    _updateToolbarIndicator();
  }

  // ════════════════════════════════════════════════════════════════════
  // APERTURA APP WACOM PREFERENZE UFFICIALE
  // ════════════════════════════════════════════════════════════════════
  async function openWacomPreferencesApp() {
    try {
      if (!window.wacomAPI || typeof window.wacomAPI.openPreferences !== "function") {
        if (typeof window.flashToast === "function") window.flashToast(__wt("wacom.toast.api.unavailable", null, "⚠️ API Wacom non disponibile"));
        return { success: false, error: "API non disponibile" };
      }
      const res = await window.wacomAPI.openPreferences();
      if (res && res.success) {
        if (typeof window.flashToast === "function") {
          window.flashToast(__wt("wacom.toast.app.opened", { path: res.path ? res.path.split(/[\\/]/).pop() : "" }, "🪟 App Wacom aperta — " + (res.path ? res.path.split(/[\\/]/).pop() : "")));
        }
      } else {
        if (typeof window.flashToast === "function") {
          window.flashToast(__wt(
            "wacom.toast.app.notFound",
            { error: (res && res.error) || __wt("wacom.toast.app.notFoundFallback", null, "verifica installazione driver") },
            "⚠️ Wacom Preferenze non trovata: " + ((res && res.error) || "verifica installazione driver")
          ));
        }
      }
      return res;
    } catch (e) {
      console.error("[Wacom] Apertura app fallita:", e);
      return { success: false, error: String(e) };
    }
  }

  // ════════════════════════════════════════════════════════════════════
  // MODALE DI CONFIGURAZIONE
  // ════════════════════════════════════════════════════════════════════
  function openConfigModal() {
    const modal = document.getElementById("wacomConfigModal");
    if (!modal) {
      console.warn("[Wacom] Modale config non trovato in DOM");
      return;
    }
    _refreshConfigModalUI();
    _clearTestPanel();
    modal.style.display = "flex";
  }

  function _closeConfigModal() {
    cancelButtonCalibration();
    const modal = document.getElementById("wacomConfigModal");
    if (modal) modal.style.display = "none";
  }

  function _refreshConfigModalUI() {
    const statusEl = document.getElementById("wacomDeviceStatus");
    if (statusEl) {
      if (STATE.isConnected) {
        const names =
          STATE.detectedDevices.length > 0
            ? STATE.detectedDevices.map((d) => d.name).join(", ")
            : __wt("wacom.status.viaPenInput", null, "Rilevata via input penna");
        const connLabel = __wt("wacom.status.connectedLabel", null, "✓ Connessa");
        statusEl.innerHTML = `<span style="color:#4ade80;font-weight:600;">${connLabel}</span> <span style="color:#aaa;">— ${escapeHTML(names)}</span>`;
      } else {
        const discLabel = __wt("wacom.status.disconnectedLabel", null, "✗ Non rilevata");
        const discHint = __wt("wacom.status.disconnectedHint", null, "collega la tavoletta o verifica i driver Wacom");
        statusEl.innerHTML = `<span style="color:#f87171;font-weight:600;">${discLabel}</span> <span style="color:#aaa;">— ${escapeHTML(discHint)}</span>`;
      }
    }

    const inkWarnEl = document.getElementById("wacomInkWarning");
    if (inkWarnEl) {
      inkWarnEl.style.display = STATE.isConnected && STATE.windowsInkMode === false ? "block" : "none";
    }

    _setChecked("wacomEnabledCheck", prefs.enabled);
    _setSlider("wacomSensitivitySlider", prefs.pressureSensitivity * 100);
    _setText("wacomSensitivityValue", (prefs.pressureSensitivity * 100).toFixed(0) + "%");

    const curveSel = document.getElementById("wacomCurveSelect");
    if (curveSel) curveSel.value = prefs.pressureCurve;

    _setChecked("wacomModulateWidthCheck", prefs.modulateWidth);
    _setChecked("wacomModulateOpacityCheck", prefs.modulateOpacity);
    _setChecked("wacomModulateFlowCheck", prefs.modulateFlow);

    _setSlider("wacomMinWidthSlider", prefs.minWidthFactor * 100);
    _setText("wacomMinWidthValue", (prefs.minWidthFactor * 100).toFixed(0) + "%");
    _setSlider("wacomMaxWidthSlider", prefs.maxWidthFactor * 100);
    _setText("wacomMaxWidthValue", (prefs.maxWidthFactor * 100).toFixed(0) + "%");

    _setSlider("wacomMinOpacitySlider", prefs.minOpacityFactor * 100);
    _setText("wacomMinOpacityValue", (prefs.minOpacityFactor * 100).toFixed(0) + "%");

    _setSlider("wacomMinFlowSlider", prefs.minFlowFactor * 100);
    _setText("wacomMinFlowValue", (prefs.minFlowFactor * 100).toFixed(0) + "%");

    // === TILT ===
    _setChecked("wacomModulateTiltCheck", prefs.modulateTilt);
    _setSlider("wacomTiltWidthSlider", prefs.tiltWidthAmount * 100);
    _setText("wacomTiltWidthValue", (prefs.tiltWidthAmount * 100).toFixed(0) + "%");
    _setSlider("wacomTiltRotateSlider", prefs.tiltRotateAmount * 100);
    _setText("wacomTiltRotateValue", (prefs.tiltRotateAmount * 100).toFixed(0) + "%");

    _populatePenButtonSelect("wacomLowerBtnSelect", prefs.penLowerButtonAction);
    _populatePenButtonSelect("wacomUpperBtnSelect", prefs.penUpperButtonAction);

    _updateCalibrationUI();
  }

  function _populatePenButtonSelect(selectId, currentValue) {
    const sel = document.getElementById(selectId);
    if (!sel) return;
    sel.innerHTML = "";
    Object.keys(PEN_BUTTON_ACTIONS).forEach((key) => {
      const opt = document.createElement("option");
      opt.value = key;
      const a = PEN_BUTTON_ACTIONS[key];
      opt.textContent = `${a.icon}  ${a.label}`;
      if (key === currentValue) opt.selected = true;
      sel.appendChild(opt);
    });
  }

  function _setChecked(id, val) {
    const el = document.getElementById(id);
    if (el) el.checked = !!val;
  }
  function _setSlider(id, val) {
    const el = document.getElementById(id);
    if (el) el.value = val;
  }
  function _setText(id, txt) {
    const el = document.getElementById(id);
    if (el) el.textContent = txt;
  }

  // ────────────────────────────────────────────────────────────────────
  // Wiring del modale (UNA SOLA volta)
  // ────────────────────────────────────────────────────────────────────
  function _setupConfigModalUI() {
    const modal = document.getElementById("wacomConfigModal");
    if (!modal) return;
    if (modal.__wacomWired) return;
    modal.__wacomWired = true;

    document.getElementById("wacomConfigCloseBtn")?.addEventListener("click", _closeConfigModal);
    document.getElementById("wacomConfigDoneBtn")?.addEventListener("click", _closeConfigModal);

    document.getElementById("wacomRedetectBtn")?.addEventListener("click", async () => {
      const el = document.getElementById("wacomDeviceStatus");
      if (el) el.innerHTML = `<span style="color:#aaa;">${__wt("wacom.status.detecting", null, "⌛ Rilevamento in corso...")}</span>`;
      await _detectDevicesFromMain();
      _refreshConfigModalUI();
    });

    document.getElementById("wacomOpenAppBtn")?.addEventListener("click", openWacomPreferencesApp);

    document.getElementById("wacomResetDefaultsBtn")?.addEventListener("click", () => {
      if (!confirm(__wt("wacom.confirm.resetPrefs", null, "Ripristinare tutte le impostazioni Wacom ai valori predefiniti?"))) return;
      prefs = { ...DEFAULT_PREFS };
      savePrefs();
      _refreshConfigModalUI();
      if (typeof window.flashToast === "function") window.flashToast(__wt("wacom.toast.prefs.reset", null, "🔄 Impostazioni Wacom ripristinate"));
    });

    document.getElementById("wacomEnabledCheck")?.addEventListener("change", (e) => {
      prefs.enabled = !!e.target.checked;
      savePrefs();
    });

    document.getElementById("wacomSensitivitySlider")?.addEventListener("input", (e) => {
      prefs.pressureSensitivity = clamp(parseFloat(e.target.value) / 100, 0, 2);
      _setText("wacomSensitivityValue", (prefs.pressureSensitivity * 100).toFixed(0) + "%");
      savePrefs();
    });

    document.getElementById("wacomCurveSelect")?.addEventListener("change", (e) => {
      const v = e.target.value;
      if (["linear", "soft", "hard", "stairs"].includes(v)) {
        prefs.pressureCurve = v;
        savePrefs();
      }
    });

    document.getElementById("wacomModulateWidthCheck")?.addEventListener("change", (e) => {
      prefs.modulateWidth = !!e.target.checked;
      savePrefs();
    });
    document.getElementById("wacomModulateOpacityCheck")?.addEventListener("change", (e) => {
      prefs.modulateOpacity = !!e.target.checked;
      savePrefs();
    });
    document.getElementById("wacomModulateFlowCheck")?.addEventListener("change", (e) => {
      prefs.modulateFlow = !!e.target.checked;
      savePrefs();
    });

    document.getElementById("wacomMinWidthSlider")?.addEventListener("input", (e) => {
      prefs.minWidthFactor = clamp(parseFloat(e.target.value) / 100, 0, 2);
      _setText("wacomMinWidthValue", (prefs.minWidthFactor * 100).toFixed(0) + "%");
      savePrefs();
    });
    document.getElementById("wacomMaxWidthSlider")?.addEventListener("input", (e) => {
      prefs.maxWidthFactor = clamp(parseFloat(e.target.value) / 100, 0, 3);
      _setText("wacomMaxWidthValue", (prefs.maxWidthFactor * 100).toFixed(0) + "%");
      savePrefs();
    });

    document.getElementById("wacomMinOpacitySlider")?.addEventListener("input", (e) => {
      prefs.minOpacityFactor = clamp(parseFloat(e.target.value) / 100, 0, 1);
      _setText("wacomMinOpacityValue", (prefs.minOpacityFactor * 100).toFixed(0) + "%");
      savePrefs();
    });

    document.getElementById("wacomMinFlowSlider")?.addEventListener("input", (e) => {
      prefs.minFlowFactor = clamp(parseFloat(e.target.value) / 100, 0, 1);
      _setText("wacomMinFlowValue", (prefs.minFlowFactor * 100).toFixed(0) + "%");
      savePrefs();
    });

    // === TILT wiring ===
    document.getElementById("wacomModulateTiltCheck")?.addEventListener("change", (e) => {
      prefs.modulateTilt = !!e.target.checked;
      savePrefs();
    });
    document.getElementById("wacomTiltWidthSlider")?.addEventListener("input", (e) => {
      prefs.tiltWidthAmount = clamp(parseFloat(e.target.value) / 100, 0, 1);
      _setText("wacomTiltWidthValue", (prefs.tiltWidthAmount * 100).toFixed(0) + "%");
      savePrefs();
    });
    document.getElementById("wacomTiltRotateSlider")?.addEventListener("input", (e) => {
      prefs.tiltRotateAmount = clamp(parseFloat(e.target.value) / 100, 0, 1);
      _setText("wacomTiltRotateValue", (prefs.tiltRotateAmount * 100).toFixed(0) + "%");
      savePrefs();
    });

    document.getElementById("wacomLowerBtnSelect")?.addEventListener("change", (e) => {
      prefs.penLowerButtonAction = e.target.value;
      savePrefs();
    });
    document.getElementById("wacomUpperBtnSelect")?.addEventListener("change", (e) => {
      prefs.penUpperButtonAction = e.target.value;
      savePrefs();
    });

    // === CALIBRAZIONE TASTI ===
    document.getElementById("wacomCalibrateLowerBtn")?.addEventListener("click", () => {
      startButtonCalibration("lower");
    });
    document.getElementById("wacomCalibrateUpperBtn")?.addEventListener("click", () => {
      startButtonCalibration("upper");
    });
    document.getElementById("wacomCalibrateCancelBtn")?.addEventListener("click", () => {
      cancelButtonCalibration();
    });
    document.getElementById("wacomCalibrateResetBtn")?.addEventListener("click", () => {
      prefs.learnedLowerButtonCode = DEFAULT_PREFS.learnedLowerButtonCode;
      prefs.learnedUpperButtonCode = DEFAULT_PREFS.learnedUpperButtonCode;
      savePrefs();
      _updateCalibrationUI();
      if (typeof window.flashToast === "function") window.flashToast(__wt("wacom.toast.calib.reset", null, "🔄 Calibrazione tasti reset"));
    });

    _setupLiveTestPanel();
  }

  // ════════════════════════════════════════════════════════════════════
  // CANVAS DI TEST LIVE (dentro al modale)
  // ════════════════════════════════════════════════════════════════════
  function _setupLiveTestPanel() {
    const canvasEl = document.getElementById("wacomTestCanvas");
    if (!canvasEl) return;
    if (canvasEl.__wacomBound) return;
    canvasEl.__wacomBound = true;

    const ctx = canvasEl.getContext("2d");
    let lastPos = null;

    // ── Diagnostica tilt: distinguiamo
    //    A) tiltX/tiltY NON presenti come proprietà dell'evento
    //       → la penna/driver non li espone proprio
    //    B) presenti ma sempre 0 dopo N campioni
    //       → tipicamente penna senza sensori di tilt (es. Bamboo CTL-460)
    //    C) presenti e con valori != 0 → tilt funzionante
    let tiltDiag = { samples: 0, hasField: false, nonZeroSeen: false };
    const tiltStatusEl = document.getElementById("wacomLiveTiltValue");

    _clearTestPanel();

    canvasEl.addEventListener("pointerdown", (e) => {
      try {
        canvasEl.setPointerCapture(e.pointerId);
      } catch (_) {}
      if (e.pointerType !== "pen") {
        _clearTestPanel();
        ctx.fillStyle = "#f87171";
        ctx.font = "13px sans-serif";
        ctx.fillText("⚠️ Usa la penna Wacom (non il mouse) per testare la pressione", 16, 26);
        return;
      }
      lastPos = { x: e.offsetX, y: e.offsetY };
      // reset diagnostica a ogni nuovo tratto
      tiltDiag = { samples: 0, hasField: false, nonZeroSeen: false };
    });

    canvasEl.addEventListener("pointermove", (e) => {
      if (e.pointerType !== "pen") return;

      _setText("wacomLivePressureValue", ((e.pressure || 0) * 100).toFixed(0) + "%");

      // === Diagnostica TILT ===
      const hasTiltField = "tiltX" in e || "tiltY" in e;
      const tx = typeof e.tiltX === "number" ? e.tiltX : 0;
      const ty = typeof e.tiltY === "number" ? e.tiltY : 0;
      tiltDiag.samples++;
      if (hasTiltField) tiltDiag.hasField = true;
      if (tx !== 0 || ty !== 0) tiltDiag.nonZeroSeen = true;

      _setText("wacomLiveTiltValue", `X:${tx.toFixed(0)}° Y:${ty.toFixed(0)}°`);

      // Visualizzazione live tilt magnitude
      const tiltMag = Math.hypot(tx, ty) / 90;
      _setText("wacomLiveTiltMagValue", (tiltMag * 100).toFixed(0) + "%");

      // Dopo 25 campioni senza tilt mai diverso da 0 → diagnosi chiara
      if (tiltDiag.samples === 25 && !tiltDiag.nonZeroSeen) {
        if (!tiltDiag.hasField) {
          if (tiltStatusEl)
            tiltStatusEl.title = "Il driver non espone tiltX/tiltY (modalità WinTab? aggiorna a Windows Ink)";
          _setText("wacomLiveTiltMagValue", "n/d");
        } else {
          if (tiltStatusEl)
            tiltStatusEl.title = "Questa penna probabilmente non ha sensori di tilt (es. Bamboo Pen CTL-460)";
          // Non scriviamo "n/d" nel valore perché tecnicamente 0 è un valore valido,
          // ma il tooltip + il color cue aiutano l'utente a capire.
        }
        if (tiltStatusEl) tiltStatusEl.style.color = "#999";
      } else if (tiltDiag.nonZeroSeen && tiltStatusEl) {
        tiltStatusEl.style.color = "#00c8ff";
        tiltStatusEl.title = "";
      }

      if (!lastPos) return;
      const p = e.pressure || 0;
      const curvedP = applyPressureCurve(p, prefs.pressureCurve) * prefs.pressureSensitivity;
      const tiltMult = 1.0 + tiltMag * clamp(prefs.tiltWidthAmount, 0, 1);
      const width = Math.max(0.6, curvedP * 22 * tiltMult);

      ctx.strokeStyle = "#00c8ff";
      ctx.lineWidth = width;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.beginPath();
      ctx.moveTo(lastPos.x, lastPos.y);
      ctx.lineTo(e.offsetX, e.offsetY);
      ctx.stroke();

      lastPos = { x: e.offsetX, y: e.offsetY };
    });

    const finish = () => {
      lastPos = null;
    };
    canvasEl.addEventListener("pointerup", finish);
    canvasEl.addEventListener("pointercancel", finish);
    canvasEl.addEventListener("pointerleave", finish);

    document.getElementById("wacomTestClearBtn")?.addEventListener("click", _clearTestPanel);
  }

  function _clearTestPanel() {
    const canvasEl = document.getElementById("wacomTestCanvas");
    if (!canvasEl) return;
    const ctx = canvasEl.getContext("2d");
    ctx.fillStyle = "#181818";
    ctx.fillRect(0, 0, canvasEl.width, canvasEl.height);
    ctx.fillStyle = "#777";
    ctx.font = "13px sans-serif";
    ctx.fillText("Disegna qui con la penna per testare la pressione...", 16, 26);
  }

  // ════════════════════════════════════════════════════════════════════
  // INSTALLAZIONE LISTENER POINTER + CONTEXTMENU + AUXCLICK
  // ────────────────────────────────────────────────────────────────────
  // I listener pointer tornano su upperCanvasEl. Registrarli su `window`
  // con passive:true causava su Chromium/Electron un effetto collaterale
  // poco documentato: il sistema pointer events della finestra entrava in
  // un fast-path mouse-only e il pointerType veniva "downgraded" da "pen"
  // a "mouse" anche nel test canvas del modale Wacom.
  //
  // La race condition con Fabric (Fabric attaccava i suoi listener prima
  // e leggeva STATE.currentPressure stale) viene ora risolta a monte:
  // i brush (PressurePencilBrush e WatercolorStampBrush) chiamano
  // wacomReadFromEvent(options.e) DENTRO il loro onMouseDown/Move,
  // aggiornando STATE direttamente dal PointerEvent fornito da Fabric.
  // Niente più dipendenza dall'ordine dei listener.
  //
  // Questo listener resta utile per: aggiornamento badge connessione,
  // riconoscimento tasti laterali pen, calibrazione, e backup di stato
  // per chiunque legga STATE fuori dal flusso brush.
  // ════════════════════════════════════════════════════════════════════
  function _attachPointerListener() {
    const tryAttach = () => {
      const fc = window.canvas;
      if (!fc || !fc.upperCanvasEl) return false;
      if (STATE.pointerListenerAttached) return true;

      const el = fc.upperCanvasEl;
      // ⚠️ IMPORTANTE: passive:false è OBBLIGATORIO qui.
      // ──────────────────────────────────────────────────────────────
      // Con passive:true Chromium attiva un "fast-path mouse-only" per
      // i pointer events che è WINDOW-GLOBALE (non per-elemento) e che
      // downgrada pointerType da "pen" a "mouse" — anche su elementi
      // i cui listener NON sono passive (es. il wacomTestCanvas).
      // Inoltre _onPointerEvent chiama preventDefault() durante la
      // calibrazione tasti penna: con passive:true verrebbe ignorato.
      // ──────────────────────────────────────────────────────────────
      ["pointerdown", "pointermove", "pointerup", "pointercancel", "pointerleave"].forEach((evt) => {
        el.addEventListener(evt, _onPointerEvent, { capture: true, passive: false });
      });
      STATE.pointerListenerAttached = true;
      console.log("[Wacom] Pointer listener attached to upperCanvasEl (passive:false)");
      return true;
    };

    if (!tryAttach()) {
      const interval = setInterval(() => {
        if (tryAttach()) clearInterval(interval);
      }, 200);
      setTimeout(() => clearInterval(interval), 15000);
    }

    // Listener globali per contextmenu + auxclick (per i tasti laterali
    // della penna su driver che non li mappano via pointerdown)
    if (!STATE.contextMenuListenerAttached) {
      window.addEventListener("contextmenu", _onContextMenu, { capture: true });
      STATE.contextMenuListenerAttached = true;
    }
    if (!STATE.auxClickListenerAttached) {
      window.addEventListener("auxclick", _onAuxClick, { capture: true });
      STATE.auxClickListenerAttached = true;
    }
  }

  function _hookFreehandPanels() {
    const ids = ["lineWidthSlider", "watercolorWidthSlider", "stampSpacingSlider"];
    ids.forEach((id) => {
      const el = document.getElementById(id);
      if (!el || el.__wacomHooked) return;
      el.__wacomHooked = true;
      el.addEventListener("input", invalidatePencilBrushBaseWidth, { passive: true });
    });
  }

  // ════════════════════════════════════════════════════════════════════
  // fabric.PressurePath — CLASSE CUSTOM PER PATH CON WIDTH VARIABILE
  // ════════════════════════════════════════════════════════════════════
  // Renderizza una sequenza di punti {x, y, pressure} disegnando segmenti
  // separati di strokeWidth scalato dalla pressione media del segmento.
  // I punti vengono salvati relativi al top-left del bounding box, quindi
  // l'oggetto è spostabile/ridimensionabile come qualsiasi altro fabric.Object.
  function _definePressurePath() {
    if (typeof fabric === "undefined") {
      console.warn("[Wacom] fabric non disponibile, PressurePath non registrato");
      return;
    }
    if (fabric.PressurePath) return; // già registrato

    const FabricObject = fabric.FabricObject || fabric.Object;

    class PressurePath extends FabricObject {
      static type = "PressurePath";

      constructor(absolutePoints, options) {
        options = options || {};

        // === FIX OFFSET TRATTO FINALE — FABRIC v7 ===
        // In Fabric v7 il default di originX/originY è stato cambiato da
        // "left"/"top" a "center"/"center" (vedi upgrade guide ufficiale:
        // https://fabricjs.com/docs/upgrading/upgrading-to-fabric-70/).
        // Tutta la matematica di _initFromAbsolutePoints e _render di
        // PressurePath è scritta per origin "left"/"top": i punti vengono
        // salvati relativi al top-left del bounding box e in _render si
        // sottrae halfW/halfH per portarli al sistema di coordinate centrato
        // che Fabric applica automaticamente prima di chiamare _render.
        // Senza forzare l'origin il tratto finale renderizza spostato
        // rispetto all'anteprima (che invece disegna direttamente in
        // coordinate world via _saveAndTransform e quindi resta corretta).
        // Forziamo l'origin con priorità SUL contenuto di `options`, così la
        // forzatura vince anche caricando vecchi salvataggi fatti in stato
        // "rotto" di v7 che potrebbero aver serializzato originX/Y="center".
        const opts = Object.assign({}, options, { originX: "left", originY: "top" });
        super(opts);

        // === FIX TYPE — FABRIC v5.1.0 ===
        // In Fabric 5.1.0 il `type` di un'istanza viene risolto leggendo dal
        // prototype della classe (es. fabric.Rect.prototype.type === "rect").
        // Con la sintassi ES6 `static type = "PressurePath"` (sopra) il valore
        // è impostato SULLA CLASSE e NON sul prototype, quindi NON viene mai
        // ereditato dalle istanze: `new PressurePath(...).type` cade sul
        // default di FabricObject ("object"). Conseguenze in Mosaica:
        //  • Tratti penna NUOVI creati live da PressurePencilBrush hanno
        //    type === "object" → isWatercolorOrFreehand non li riconosce →
        //    spariscono dalla lista del pannello "Linee", dall'export, dal
        //    riordino layer e dalla serializzazione esplicita.
        //  • Tratti penna caricati da progetto salvato hanno invece type
        //    corretto perché toObject() lo serializza esplicitamente come
        //    "PressurePath" e fromObject() lo ripassa al constructor, che
        //    lo copia sull'istanza tramite super(opts) → setOptions(opts).
        //    Per questo "tratti pre-esistenti sì, tratti nuovi no".
        // Forziamo qui il type sull'istanza per uniformare i due percorsi.
        this.type = "PressurePath";

        this.stroke = options.stroke || "#000";
        this.strokeWidth = options.strokeWidth || 1;
        this.strokeLineCap = options.strokeLineCap || "round";
        this.strokeLineJoin = options.strokeLineJoin || "round";
        this.fill = null;

        this.__pressureMinFactor = options.__pressureMinFactor != null ? options.__pressureMinFactor : 0.2;
        this.__pressureMaxFactor = options.__pressureMaxFactor != null ? options.__pressureMaxFactor : 1.2;
        this.__pressureEnabled = options.__pressureEnabled != null ? options.__pressureEnabled : true;

        // Se i points sono già forniti in formato relativo (caricamento da JSON),
        // usali così come sono e ricostruisci dimensioni; altrimenti calcola
        // bounding box e ri-origina al top-left.
        const pts = Array.isArray(absolutePoints) ? absolutePoints : [];
        if (options.__pointsAreRelative) {
          this.points = pts.map((p) => ({ x: p.x, y: p.y, pressure: p.pressure }));
          if (options.width == null || options.height == null) {
            this._recalcBoundsFromRelative();
          }
        } else {
          this._initFromAbsolutePoints(pts);
        }
      }

      _initFromAbsolutePoints(absPts) {
        if (!absPts || absPts.length === 0) {
          this.points = [];
          this.width = 1;
          this.height = 1;
          return;
        }
        let minX = Infinity,
          minY = Infinity,
          maxX = -Infinity,
          maxY = -Infinity;
        for (const p of absPts) {
          if (p.x < minX) minX = p.x;
          if (p.y < minY) minY = p.y;
          if (p.x > maxX) maxX = p.x;
          if (p.y > maxY) maxY = p.y;
        }
        const padding = Math.max((this.strokeWidth || 1) * (this.__pressureMaxFactor || 1.2) * 0.5, 1);
        const left = minX - padding;
        const top = minY - padding;
        const width = maxX - minX + padding * 2;
        const height = maxY - minY + padding * 2;

        this.points = absPts.map((p) => ({
          x: p.x - left,
          y: p.y - top,
          pressure: typeof p.pressure === "number" ? p.pressure : 0.5
        }));
        this.set({ left, top, width, height });
      }

      _recalcBoundsFromRelative() {
        const pts = this.points || [];
        if (pts.length === 0) {
          this.width = 1;
          this.height = 1;
          return;
        }
        let maxX = 0,
          maxY = 0;
        for (const p of pts) {
          if (p.x > maxX) maxX = p.x;
          if (p.y > maxY) maxY = p.y;
        }
        this.width = maxX + 1;
        this.height = maxY + 1;
      }

      _render(ctx) {
        const pts = this.points;
        if (!pts || pts.length < 2) return;

        const enabled = this.__pressureEnabled !== false;
        const minF = this.__pressureMinFactor != null ? this.__pressureMinFactor : 0.2;
        const maxF = this.__pressureMaxFactor != null ? this.__pressureMaxFactor : 1.2;
        const baseW = this.strokeWidth || 1;

        // === FIX OFFSET TRATTO FINALE — FABRIC 5.1.0+ ===
        // Fabric chiama _render(ctx) DOPO aver traslato il context al "centro"
        // calcolato come (left + (width + strokeWidth)/2, top + (height + strokeWidth)/2).
        // _getTransformedDimensions() di Fabric somma SEMPRE strokeWidth alla
        // width/height del bounding box per posizionare correttamente l'oggetto
        // tenendo conto dello spessore del tratto: questo comportamento è
        // costante da Fabric 5.1 fino a Fabric 7+ (cambia solo la geometria
        // dipendente da originX/originY, ma noi forziamo "left"/"top" nel
        // constructor, quindi la formula è sempre questa).
        // I nostri punti sono salvati relativi a (left, top), quindi per
        // portarli al sistema di coordinate centrato che Fabric ha già
        // applicato dobbiamo sottrarre (width + strokeWidth)/2, NON width/2.
        // Senza la compensazione di strokeWidth il tratto finale risulta
        // shiftato di (+strokeWidth/2, +strokeWidth/2) rispetto all'anteprima
        // (visibile come "tratto orizzontale spostato in giù" e "tratto
        // verticale spostato a destra").
        const halfW = (this.width + baseW) / 2;
        const halfH = (this.height + baseW) / 2;

        ctx.save();
        ctx.strokeStyle = this.stroke || "#000";
        ctx.lineCap = this.strokeLineCap || "round";
        ctx.lineJoin = this.strokeLineJoin || "round";

        for (let i = 1; i < pts.length; i++) {
          const a = pts[i - 1];
          const b = pts[i];
          const avgP = ((a.pressure != null ? a.pressure : 0.5) + (b.pressure != null ? b.pressure : 0.5)) * 0.5;
          const f = enabled ? minF + (maxF - minF) * clamp(avgP, 0, 1) : 1.0;
          ctx.lineWidth = Math.max(0.5, baseW * f);
          ctx.beginPath();
          ctx.moveTo(a.x - halfW, a.y - halfH);
          ctx.lineTo(b.x - halfW, b.y - halfH);
          ctx.stroke();
        }
        ctx.restore();
      }

      toObject(propertiesToInclude) {
        const base = super.toObject(propertiesToInclude);
        return Object.assign(base, {
          type: "PressurePath",
          points: (this.points || []).map((p) => ({ x: p.x, y: p.y, pressure: p.pressure })),
          __pressureMinFactor: this.__pressureMinFactor,
          __pressureMaxFactor: this.__pressureMaxFactor,
          __pressureEnabled: this.__pressureEnabled,
          stroke: this.stroke,
          strokeWidth: this.strokeWidth
        });
      }

      _toSVG() {
        const pts = this.points;
        if (!pts || pts.length < 2) return [""];
        const enabled = this.__pressureEnabled !== false;
        const minF = this.__pressureMinFactor != null ? this.__pressureMinFactor : 0.2;
        const maxF = this.__pressureMaxFactor != null ? this.__pressureMaxFactor : 1.2;
        const baseW = this.strokeWidth || 1;

        // === FIX OFFSET — stessa logica di _render (vedi commento esteso lì).
        // L'export SVG deve usare lo stesso sistema di coordinate del rendering
        // su canvas: senza compensare strokeWidth, il tratto esportato sarebbe
        // shiftato di (+strokeWidth/2, +strokeWidth/2) rispetto agli altri
        // oggetti del documento.
        const halfW = (this.width + baseW) / 2;
        const halfH = (this.height + baseW) / 2;

        const lines = [];
        for (let i = 1; i < pts.length; i++) {
          const a = pts[i - 1],
            b = pts[i];
          const avgP = ((a.pressure != null ? a.pressure : 0.5) + (b.pressure != null ? b.pressure : 0.5)) * 0.5;
          const f = enabled ? minF + (maxF - minF) * clamp(avgP, 0, 1) : 1.0;
          const sw = Math.max(0.5, baseW * f);
          lines.push(
            `\t<line x1="${(a.x - halfW).toFixed(2)}" y1="${(a.y - halfH).toFixed(2)}" x2="${(b.x - halfW).toFixed(2)}" y2="${(b.y - halfH).toFixed(2)}" stroke="${this.stroke}" stroke-width="${sw.toFixed(2)}" stroke-linecap="round" fill="none"/>\n`
          );
        }
        return lines;
      }

      toSVG(reviver) {
        const commonPieces = this._createBaseSVGMarkup
          ? this._createBaseSVGMarkup(this._toSVG(), { reviver, noStyle: false, withShadow: true })
          : null;
        if (commonPieces) return commonPieces;
        // Fallback semplice: <g> con linee
        const lines = this._toSVG().join("");
        const transform = this.calcTransformMatrix ? this.calcTransformMatrix() : null;
        const tStr = transform ? `transform="matrix(${transform.join(" ")})"` : "";
        return `<g ${tStr}>\n${lines}</g>\n`;
      }

      // fromObject — DEVE supportare il pattern callback di Fabric 5.x:
      // Fabric chiama fromObject(obj, callback) e aspetta che callback(instance)
      // venga invocata prima di considerare l'oggetto pronto. Senza, loadFromJSON
      // resta in stallo per sempre. Ritorna anche una Promise per compatibilità
      // con Fabric 6+. NON dichiarare async qui: rompe il pattern callback.
      static fromObject(object, callback) {
        try {
          const pts = Array.isArray(object.points) ? object.points : [];
          const opts = Object.assign({}, object, { __pointsAreRelative: true });
          delete opts.points; // i punti passano come 1° arg al costruttore
          const instance = new PressurePath(pts, opts);
          if (typeof callback === "function") callback(instance);
          return Promise.resolve(instance);
        } catch (err) {
          console.error("[Wacom] PressurePath.fromObject errore:", err, object);
          if (typeof callback === "function") callback(null);
          return Promise.resolve(null);
        }
      }
    }

    // Registrazione classe in Fabric (per loadFromJSON)
    try {
      if (fabric.classRegistry && typeof fabric.classRegistry.setClass === "function") {
        fabric.classRegistry.setClass(PressurePath);
        fabric.classRegistry.setClass(PressurePath, "PressurePath");
        fabric.classRegistry.setClass(PressurePath, "pressurepath");
        if (typeof fabric.classRegistry.setSVGClass === "function") {
          fabric.classRegistry.setSVGClass(PressurePath);
        }
      }
    } catch (e) {
      console.warn("[Wacom] Registrazione PressurePath nel classRegistry fallita:", e);
    }
    fabric.PressurePath = PressurePath;
    console.log("[Wacom] fabric.PressurePath registrato");
  }

  // ════════════════════════════════════════════════════════════════════
  // PressurePencilBrush — BRUSH CON PRESSIONE PIXEL-PER-PIXEL
  // ════════════════════════════════════════════════════════════════════
  // Estende fabric.PencilBrush:
  //  • Salva la pressione di ogni punto in this._pressurePoints
  //  • Override di _render → disegna ogni segmento con width modulata
  //  • Override di onMouseUp → finalizza come fabric.PressurePath
  // Quando non c'è pressione (mouse), si comporta come un PencilBrush
  // ordinario (width uniforme).
  function _definePressurePencilBrush() {
    if (typeof fabric === "undefined" || !fabric.PencilBrush) {
      console.warn("[Wacom] fabric.PencilBrush non disponibile");
      return;
    }
    if (window.PressurePencilBrush) return;

    class PressurePencilBrush extends fabric.PencilBrush {
      constructor(canvas) {
        super(canvas);
        this.name = "pressure-pencil";
        this._pressurePoints = [];
      }

      _samplePressure() {
        const p = getCurrentPressureRaw();
        return p != null && Number.isFinite(p) ? clamp(p, 0, 1) : 0.5;
      }

      _pressureWidthFactor(pressure) {
        if (!prefs.enabled || !prefs.modulateWidth) return 1.0;
        const curved = applyPressureCurve(pressure, prefs.pressureCurve) * prefs.pressureSensitivity;
        const p01 = clamp(curved, 0, 1);
        return prefs.minWidthFactor + (prefs.maxWidthFactor - prefs.minWidthFactor) * p01;
      }

      onMouseDown(pointer, ev) {
        if (window.isAltPanning) return;
        // Lettura SINCRONA dalla penna dal PointerEvent corrente, prima di
        // qualsiasi altra cosa: garantisce che _samplePressure() veda valori
        // freschi anche se il listener globale non si è ancora attivato.
        readFromEvent(ev && ev.e);
        super.onMouseDown(pointer, ev);
        this._pressurePoints = [
          {
            x: pointer.x,
            y: pointer.y,
            pressure: this._samplePressure()
          }
        ];
      }

      onMouseMove(pointer, ev) {
        if (window.isAltPanning) return;
        // Stessa logica: aggiorna lo stato dalla PointerEvent corrente PRIMA
        // di campionare la pressione per il nuovo punto.
        readFromEvent(ev && ev.e);
        const prevLen = this._points ? this._points.length : 0;
        super.onMouseMove(pointer, ev);
        const newLen = this._points ? this._points.length : 0;
        // Se _points è cresciuto, sincronizziamo _pressurePoints
        if (newLen > prevLen) {
          const newP = this._points[newLen - 1];
          this._pressurePoints.push({
            x: newP.x,
            y: newP.y,
            pressure: this._samplePressure()
          });
        }
      }

      // Forziamo SEMPRE il full render dell'anteprima.
      // Conseguenze ad-hoc per la penna normale di Mosaica:
      //  1) viene usato esclusivamente il nostro _render() qui sotto, che
      //     calcola lo spessore di ogni segmento con
      //     (this.width * pressureFactor) — ESATTAMENTE come fa
      //     fabric.PressurePath nel tratto finale. Quindi anteprima e
      //     tratto finalizzato hanno sempre lo stesso spessore reale.
      //  2) il ramo "incrementale" di fabric.PencilBrush.onMouseMove non
      //     viene mai eseguito, quindi this.oldEnd (residuo dell'ultimo
      //     punto del tratto precedente, mai resettato perché la nostra
      //     onMouseUp salta super.onMouseUp per i tratti multi-punto)
      //     non viene mai letto. Risultato: niente più "anteprima
      //     agganciata" alla fine del tratto precedente.
      needsFullRender() {
        return true;
      }

      // Override del rendering live: disegna ogni segmento con width
      // modulata dalla pressione del rispettivo punto.
      _render() {
        const ctx = this.canvas.contextTop;
        const pts = this._pressurePoints;
        if (!pts || pts.length < 1) return;

        try {
          this._saveAndTransform(ctx);
        } catch (_) {
          ctx.save();
        }
        ctx.strokeStyle = this.color;
        ctx.lineCap = "round";
        ctx.lineJoin = "round";

        if (pts.length === 1) {
          // Singolo punto: disegna un cerchietto
          const f = this._pressureWidthFactor(pts[0].pressure);
          const r = Math.max(0.5, (this.width || 1) * f * 0.5);
          ctx.fillStyle = this.color;
          ctx.beginPath();
          ctx.arc(pts[0].x, pts[0].y, r, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
          return;
        }

        for (let i = 1; i < pts.length; i++) {
          const a = pts[i - 1],
            b = pts[i];
          const avgP = (a.pressure + b.pressure) * 0.5;
          const f = this._pressureWidthFactor(avgP);
          ctx.lineWidth = Math.max(0.5, (this.width || 1) * f);
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
          ctx.stroke();
        }
        ctx.restore();
      }

      // Override del finalize: invece di creare un fabric.Path con strokeWidth
      // fisso, crea un fabric.PressurePath con i punti+pressione.
      onMouseUp(ev) {
        if (!this._pressurePoints || this._pressurePoints.length < 2) {
          // Singolo punto (tap): produce un puntino di Path standard
          try {
            return super.onMouseUp(ev);
          } catch (_) {
            this._reset();
            return false;
          }
        }
        this._finalizeAndAddPath();
        return false;
      }

      _finalizeAndAddPath() {
        const c = this.canvas;
        if (!c) {
          this._reset();
          return;
        }

        const points = this._pressurePoints.slice();
        const path = new fabric.PressurePath(points, {
          stroke: this.color,
          strokeWidth: this.width,
          strokeLineCap: "round",
          strokeLineJoin: "round",
          __pressureMinFactor: prefs.minWidthFactor,
          __pressureMaxFactor: prefs.maxWidthFactor,
          __pressureEnabled: prefs.enabled && prefs.modulateWidth
        });

        // Applica opacità modulata da Wacom (se attiva)
        if (prefs.enabled && prefs.modulateOpacity) {
          const opFactor = getOpacityFactor();
          if (opFactor !== 1.0) {
            path.set("opacity", clamp(opFactor, 0.05, 1));
          }
        }

        // ↳ FIX anteprima "fantasma" agganciata al tratto precedente.
        // clearContext() pulisce solo il BITMAP del contextTop ma NON resetta
        // il "current path" interno del Canvas2D. Senza beginPath() qui, il
        // prossimo tratto (quando super.onMouseMove chiama drawSegment ->
        // quadraticCurveTo senza beginPath, perché this.oldEnd è undefined al
        // primo segmento) si aggancia ai segmenti residui di QUESTO tratto, e
        // ctx.stroke() ridisegna il tratto fantasma finché il nuovo tratto
        // non finisce e clearContext lo nasconde di nuovo.
        const ctx = c.contextTop;
        ctx.beginPath();
        c.clearContext(ctx);

        c.add(path);
        c.fire("path:created", { path });
        c.requestRenderAll();
        this._reset();
      }

      _reset() {
        // super._reset() di Fabric (PencilBrush) svuota this._points e — cosa
        // cruciale per noi — RIAPPLICA gli stili al contextTop:
        //   ctx.strokeStyle = this.color
        //   ctx.lineWidth   = this.width
        //   lineCap / lineJoin / miterLimit / dash
        // Senza questa chiamata, il contextTop conserva i default del Canvas2D
        // (lineWidth=1, strokeStyle="#000") e l'anteprima del tratto risulta
        // un filo sottile nero, anche se il fabric.PressurePath finalizzato
        // viene poi creato con i valori corretti.
        super._reset();
        this._pressurePoints = [];
        // Reset difensivo di oldEnd: con needsFullRender()=true il ramo
        // incrementale di Fabric non viene piu' eseguito e quindi oldEnd non
        // viene letto, ma pulirlo qui ci copre se in futuro qualcuno (o una
        // versione diversa di Fabric) tornasse al rendering incrementale.
        this.oldEnd = null;
      }
    }

    window.PressurePencilBrush = PressurePencilBrush;
    console.log("[Wacom] PressurePencilBrush registrato (window.PressurePencilBrush)");
  }

  // ════════════════════════════════════════════════════════════════════
  // INIT
  // ════════════════════════════════════════════════════════════════════
  function init() {
    loadPrefs();
    _definePressurePath();
    _definePressurePencilBrush();
    _attachPointerListener();
    _detectDevicesFromMain();
    _setupConfigModalUI();
    _bindToolbarButton();
    _hookFreehandPanels();

    // Refresh periodico stato per UI live se modale aperto
    setInterval(() => {
      const modal = document.getElementById("wacomConfigModal");
      if (modal && modal.style.display === "flex") {
        const statusEl = document.getElementById("wacomDeviceStatus");
        if (statusEl && STATE.isConnected) {
          const names =
            STATE.detectedDevices.length > 0
              ? STATE.detectedDevices.map((d) => d.name).join(", ")
              : __wt("wacom.status.viaPenInput", null, "Rilevata via input penna");
          const connLabel = __wt("wacom.status.connectedLabel", null, "✓ Connessa");
          statusEl.innerHTML = `<span style="color:#4ade80;font-weight:600;">${connLabel}</span> <span style="color:#aaa;">— ${escapeHTML(names)}</span>`;
        }
      }
    }, 1500);

    console.log("[Wacom] Modulo inizializzato — prefs:", prefs);
  }

  // ════════════════════════════════════════════════════════════════════
  // ESPOSIZIONE GLOBALE
  // ════════════════════════════════════════════════════════════════════
  window.WacomTablet = {
    init,
    openConfigModal,
    openWacomPreferencesApp,
    startButtonCalibration,
    cancelButtonCalibration,
    getStatus: () => ({
      isConnected: STATE.isConnected,
      isPenDown: STATE.isPenDown,
      currentPressure: STATE.currentPressure,
      currentPointerType: STATE.currentPointerType,
      currentTiltX: STATE.currentTiltX,
      currentTiltY: STATE.currentTiltY,
      currentTiltMagnitude: STATE.currentTiltMagnitude,
      currentTiltAngle: STATE.currentTiltAngle,
      detectedDevices: [...STATE.detectedDevices],
      windowsInkMode: STATE.windowsInkMode,
      calibrationMode: STATE.calibrationMode
    }),
    getPrefs: () => ({ ...prefs }),
    savePrefs,
    setEnabled: (b) => {
      prefs.enabled = !!b;
      savePrefs();
    },
    getCurrentPressure: getProcessedPressure,
    getWidthFactor,
    getOpacityFactor,
    getFlowFactor,
    getTiltMagnitude,
    getTiltAngle,
    getTiltWidthMultiplier,
    getTiltRotationOffset,
    invalidatePencilBrushBaseWidth,
    PEN_BUTTON_ACTIONS
  };

  // Getter read-only: i brush leggono questo valore live
  try {
    Object.defineProperty(window, "wacomCurrentPressure", {
      get: () => STATE.currentPressure,
      configurable: true
    });
    Object.defineProperty(window, "wacomIsConnected", {
      get: () => STATE.isConnected,
      configurable: true
    });
  } catch (_) {
    window.wacomCurrentPressure = null;
    window.wacomIsConnected = false;
  }

  // Helpers che i brush chiamano direttamente — restituiscono 1.0 quando
  // non c'è pressione/tilt attiva, garantendo zero regressioni sul mouse
  window.wacomGetWidthFactor = getWidthFactor;
  window.wacomGetOpacityFactor = getOpacityFactor;
  window.wacomGetFlowFactor = getFlowFactor;
  window.wacomGetCurrentPressureRaw = getCurrentPressureRaw;
  window.wacomGetTiltMagnitude = getTiltMagnitude;
  window.wacomGetTiltAngle = getTiltAngle;
  window.wacomGetTiltWidthMultiplier = getTiltWidthMultiplier;
  window.wacomGetTiltRotationOffset = getTiltRotationOffset;
  window.wacomReadFromEvent = readFromEvent;

  // ─── Auto-init ───────────────────────────────────────────────────────
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => {
      setTimeout(init, 50);
    });
  } else {
    setTimeout(init, 50);
  }
})();