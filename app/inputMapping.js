// ============================================================
//  i18n helper locale per inputMapping.js (Fase 4)
//  ------------------------------------------------------------
//  Wrapper sicuro intorno a window.i18n.t() con fallback IT.
//  Nome univoco __it (Input mapping T) per non collidere con
//  __t (renderer.js) e __wt (wacomTablet.js).
// ============================================================
function __it(key, params, fallback) {
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

// inputMapping.js — Mosaica Workspace Pro
// =====================================================================
//  Sistema di mapping personalizzabile per mouse e tastiera.
//
//  REVISIONE COMPLETA — fix cattura tasti che non scattava in calibrazione
//  e in uso normale. Modifiche principali rispetto alla versione precedente:
//   • isInputFocused() reso "smart": durante la calibrazione gli elementi
//     dentro il nostro modale ([data-im-modal]) NON contano come "input
//     focused", così slider/select/checkbox del modale non bloccano più
//     la cattura tasti. <body>/<html> sono ignorati anche fuori cal.
//   • Focus reset robusto: open/close modale fa blur esplicito di qualunque
//     residuo focus su elementi del modale, così le scorciatoie tornano
//     attive immediatamente alla chiusura.
//   • Banner di calibrazione "floating" in posizione fixed sopra al modale
//     (z-index alto), così è sempre visibile anche con modale lungo.
//   • Escape annulla TUTTI i tipi di calibrazione (single/chord/shortcut/arrow).
//   • Diagnostica console attivabile via window.InputMapping.debug(true).
//     Mostra a console ogni evento ricevuto, perché viene scartato, e ogni
//     match. Utile in caso di malfunzionamenti per capire dove si rompe.
//   • Controllo esplicito di prefs.enabled all'avvio con warn in console
//     se è false (è la causa più comune di "non funziona niente").
//
//  ESTENDE (NON sostituisce) i moduli esistenti:
//    • keyboardShortcuts.js  — le scorciatoie hardcoded (Ctrl+Z, Ctrl+C/V/X,
//      Delete, Ctrl+/-, frecce, Ctrl+R) restano TUTTE attive. Le scorciatoie
//      custom dell'utente vengono valutate PRIMA in fase capture; se matchano
//      con una hardcoded l'override è esplicito (l'utente sa cosa fa).
//    • mouseObserver.js     — la rotazione fine col tasto destro + rotella
//      sopra le forme resta INTATTA. Per garantirlo:
//         · il mapping single sul tasto destro (button 2) viene eseguito
//           SOLO se il puntatore non è sopra una forma ruotabile (così
//           sulle aree vuote del workspace puoi mappare il destro a qualcosa,
//           sulle forme continua a ruotare).
//         · i chord che includono il button 2 sono "atomici": appena il chord
//           si completa, l'evento viene fermato con stopImmediatePropagation
//           così mouseObserver non avvia la sessione di rotazione.
//
//  COSA FA:
//    1. MAPPING TASTI MOUSE SINGOLI — assegna un'azione a button 0/1/2/3/4
//       (sinistro, mezzo, destro, X1=back, X2=forward).
//    2. MAPPING COMBINAZIONI (CHORD) — assegna un'azione a una combinazione
//       di tasti mouse premuti SIMULTANEAMENTE (es. sinistro+destro).
//    3. SCORCIATOIE TASTIERA CUSTOM — l'utente registra combinazioni di
//       modificatori + tasto (es. Ctrl+L → toggle lazo) e le associa
//       a un'azione.
//    4. TASTI SINGOLI COME FRECCE — l'utente mappa tasti fisici (es. W/A/S/D)
//       come frecce direzionali per spostare la forma selezionata. Le frecce
//       native (↑↓←→) restano SEMPRE attive in parallelo (additivo, non
//       sostitutivo). Step calibrato in mm: 0.1 default, 1 con Shift,
//       0.01 con Ctrl. Riusa window.handleArrowMovement di keyboardShortcuts.js.
//
//  TASTI LATERALI MOUSE (X1/X2):
//    Sui mouse HP modello HSA-P007M (e tutti i mouse "browser back/forward")
//    e sui mouse gaming, i due tasti laterali generano:
//      · MouseEvent.button = 3  (X1 / back)
//      · MouseEvent.button = 4  (X2 / forward)
//    Alcuni driver li emettono SOLO come `auxclick` (non mousedown), altri
//    li traducono in KeyboardEvent("BrowserBack"/"BrowserForward").
//    Questo modulo li intercetta in TUTTI E TRE i modi.
//    Default suggeriti: X1 → Annulla, X2 → Ripeti.
//
//  AZIONI MAPPABILI (estendibili):
//    none, undo, redo, copy, paste, cut, delete,
//    zoom-in, zoom-out, zoom-reset,
//    toggle-lasso, toggle-freehand, toggle-watercolor,
//    toggle-eraser, toggle-select-tool,
//    pan-canvas (hold), double-click,
//    save-project, open-project, deselect-all, duplicate-selection.
//
//  PERSISTENZA: localStorage "mosaica_input_mapping_settings"
//
//  COMPATIBILITÀ: Fabric ≥5.1.0 (non utilizza direttamente API di Fabric,
//  invoca solo le funzioni globali esposte da renderer.js e dagli altri
//  moduli — copySelected, paste, cutSelected, deleteSelected, zoomByFactor,
//  resetZoomAndPan, pushState, flashToast, handleArrowMovement).
// =====================================================================

(function () {
  "use strict";

  // ════════════════════════════════════════════════════════════════════
  // DIAGNOSTICA (toggle via window.InputMapping.debug(true/false))
  // ════════════════════════════════════════════════════════════════════
  let DEBUG = false;
  function dbg(...args) {
    if (!DEBUG) return;
    console.log("[InputMapping]", ...args);
  }
  function warn(...args) {
    console.warn("[InputMapping]", ...args);
  }

  // ════════════════════════════════════════════════════════════════════
  // STATO INTERNO
  // ════════════════════════════════════════════════════════════════════
  const STATE = {
    heldButtons: new Set(),               // pulsanti mouse attualmente premuti
    pendingSingleTimer: null,             // timer per il defer del single mapping (chord disambiguation)
    pendingSingleEvent: null,
    pendingSingleButton: null,
    capturedSingleButtonCode: null,       // durante calibrazione button-single
    capturedChordButtons: null,           // durante calibrazione chord (Set)
    chordCalibrationCommitTimer: null,
    capturedShortcut: null,               // durante calibrazione keyboard
    capturedArrowKey: null,               // durante calibrazione "arrow" (singolo tasto come freccia)
    calibrationMode: null,                // null | "single" | "chord" | "shortcut" | "arrow"
    calibrationSlotIndex: null,           // indice slot da scrivere
    calibrationContext: null,             // dati ausiliari (es. { direction: "up" } per "arrow")
    calibrationTimeoutId: null,
    lastChordExecutedAt: 0,               // ms timestamp ultima esecuzione chord (per evitare double-fire del single)
    lastChordButtons: null,               // Set ultima volta che un chord è scattato
    auxClickSuppressUntil: 0              // soppressione auxclick dopo mousedown
  };

  // ════════════════════════════════════════════════════════════════════
  // AZIONI DISPONIBILI
  // ════════════════════════════════════════════════════════════════════
  const ACTIONS = {
    none: { label: __it("im.action.none", null, "Nessuna azione"), icon: "⊘", exec: () => {} },

    undo: {
      label: __it("im.action.undo", null, "Annulla (Undo)"),
      icon: "↩️",
      exec: () => clickIfExists("undoBtn") || dispatchKey("z", { ctrlKey: true })
    },
    redo: {
      label: __it("im.action.redo", null, "Ripeti (Redo)"),
      icon: "↪️",
      exec: () => clickIfExists("redoBtn") || dispatchKey("z", { ctrlKey: true, shiftKey: true })
    },

    copy: {
      label: __it("im.action.copy", null, "Copia"),
      icon: "📋",
      exec: () => (typeof window.copySelected === "function" ? window.copySelected() : null)
    },
    paste: {
      label: __it("im.action.paste", null, "Incolla"),
      icon: "📌",
      exec: () => (typeof window.paste === "function" ? window.paste() : null)
    },
    cut: {
      label: __it("im.action.cut", null, "Taglia"),
      icon: "✂️",
      exec: () => (typeof window.cutSelected === "function" ? window.cutSelected() : null)
    },
    delete: {
      label: __it("im.action.delete", null, "Elimina selezione"),
      icon: "🗑️",
      exec: () => (typeof window.deleteSelected === "function" ? window.deleteSelected() : null)
    },

    "zoom-in": {
      label: __it("im.action.zoomIn", null, "Zoom in"),
      icon: "🔍➕",
      exec: () => {
        if (typeof window.zoomByFactor === "function") {
          window.zoomByFactor(1.2, window.innerWidth / 2, window.innerHeight / 2);
        }
      }
    },
    "zoom-out": {
      label: __it("im.action.zoomOut", null, "Zoom out"),
      icon: "🔍➖",
      exec: () => {
        if (typeof window.zoomByFactor === "function") {
          window.zoomByFactor(1 / 1.2, window.innerWidth / 2, window.innerHeight / 2);
        }
      }
    },
    "zoom-reset": {
      label: __it("im.action.zoomReset", null, "Reset zoom"),
      icon: "🔍⤾",
      exec: () => {
        if (typeof window.resetZoomAndPan === "function") window.resetZoomAndPan();
      }
    },

    "toggle-lasso": { label: __it("im.action.toggleLasso", null, "Toggle Lazo"), icon: "⭕", exec: () => clickIfExists("lassoSelectBtn") },
    "toggle-freehand": { label: __it("im.action.toggleFreehand", null, "Toggle Penna"), icon: "✏️", exec: () => clickIfExists("freehandBtn") },
    "toggle-watercolor": { label: __it("im.action.toggleWatercolor", null, "Toggle Acquerello"), icon: "💧", exec: () => clickIfExists("watercolorBtn") },
    "toggle-eraser": { label: __it("im.action.toggleEraser", null, "Toggle Gomma"), icon: "🧼", exec: () => clickIfExists("eraserBtn") },
    "toggle-select-tool": { label: __it("im.action.toggleSelectTool", null, "Strumento Selezione"), icon: "🖱️", exec: () => clickIfExists("selectToolBtn") },

    "pan-canvas": {
      label: __it("im.action.panCanvas", null, "Pan canvas (tieni premuto)"),
      icon: "✋",
      exec: (e) => activateHoldPan(e)
    },

    "double-click": {
      label: __it("im.action.doubleClick", null, "Doppio click"),
      icon: "⚡",
      exec: (e) => simulateDoubleClickAt(e)
    },

    "save-project": { label: __it("im.action.saveProject", null, "Salva progetto"), icon: "💾", exec: () => clickIfExists("saveProjectBtn") },
    "open-project": { label: __it("im.action.openProject", null, "Apri progetto"), icon: "📂", exec: () => clickIfExists("openProjectBtn") },

    "deselect-all": {
      label: __it("im.action.deselectAll", null, "Deseleziona tutto"),
      icon: "❎",
      exec: () => {
        if (window.canvas) {
          window.canvas.discardActiveObject();
          window.canvas.requestRenderAll();
          if (typeof window.hideRadial === "function") window.hideRadial();
        }
      }
    },

    "duplicate-selection": {
      label: __it("im.action.duplicateSelection", null, "Duplica selezione"),
      icon: "🧬",
      exec: async () => {
        if (typeof window.copySelected === "function" && typeof window.paste === "function") {
          await window.copySelected();
          await window.paste();
        }
      }
    }
  };

  // ════════════════════════════════════════════════════════════════════
  // PREFERENZE PERSISTENTI
  // ════════════════════════════════════════════════════════════════════
  const STORAGE_KEY = "mosaica_input_mapping_settings";

  const DEFAULT_PREFS = {
    enabled: true,
    mouseButtonActions: {
      0: "none",
      1: "none",
      2: "none",
      3: "undo", // X1 / Browser Back
      4: "redo"  // X2 / Browser Forward
    },
    chordMappings: [],
    keyboardShortcuts: [
      {
        id: "default-lasso",
        keys: { ctrl: true, shift: false, alt: false, meta: false, key: "l" },
        action: "toggle-lasso"
      }
    ],
    arrowKeyBindings: [],
    chordDelayMs: 80,
    preserveRotationOnShapes: true,
    suspendDuringDrawingMode: true
  };

  let prefs = JSON.parse(JSON.stringify(DEFAULT_PREFS));

  function loadPrefs() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const saved = JSON.parse(raw);
      if (typeof saved.enabled === "boolean") prefs.enabled = saved.enabled;
      if (saved.mouseButtonActions && typeof saved.mouseButtonActions === "object") {
        prefs.mouseButtonActions = { ...DEFAULT_PREFS.mouseButtonActions, ...saved.mouseButtonActions };
      }
      if (Array.isArray(saved.chordMappings)) {
        prefs.chordMappings = saved.chordMappings
          .filter((c) => Array.isArray(c.buttons) && c.buttons.length >= 2 && typeof c.action === "string")
          .map((c) => ({
            id: c.id || generateId(),
            buttons: c.buttons
              .slice()
              .map(Number)
              .sort((a, b) => a - b),
            action: c.action
          }));
      }
      if (Array.isArray(saved.keyboardShortcuts)) {
        prefs.keyboardShortcuts = saved.keyboardShortcuts
          .filter((s) => s && s.keys && typeof s.keys.key === "string" && typeof s.action === "string")
          .map((s) => ({
            id: s.id || generateId(),
            keys: {
              ctrl: !!s.keys.ctrl,
              shift: !!s.keys.shift,
              alt: !!s.keys.alt,
              meta: !!s.keys.meta,
              key: String(s.keys.key).toLowerCase()
            },
            action: s.action
          }));
      }
      if (Array.isArray(saved.arrowKeyBindings)) {
        const VALID_DIR = ["up", "down", "left", "right"];
        const seenKeys = new Set();
        prefs.arrowKeyBindings = saved.arrowKeyBindings
          .filter((b) => b && typeof b.key === "string" && b.key.length > 0 && VALID_DIR.includes(b.direction))
          .map((b) => ({
            id: b.id || generateId(),
            key: String(b.key).toLowerCase(),
            direction: b.direction
          }))
          .filter((b) => {
            if (seenKeys.has(b.key)) return false;
            seenKeys.add(b.key);
            return true;
          });
      }
      if (typeof saved.chordDelayMs === "number") {
        prefs.chordDelayMs = Math.max(0, Math.min(500, saved.chordDelayMs));
      }
      if (typeof saved.preserveRotationOnShapes === "boolean") {
        prefs.preserveRotationOnShapes = saved.preserveRotationOnShapes;
      }
      if (typeof saved.suspendDuringDrawingMode === "boolean") {
        prefs.suspendDuringDrawingMode = saved.suspendDuringDrawingMode;
      }
    } catch (e) {
      warn("loadPrefs fallito, uso defaults:", e);
      prefs = JSON.parse(JSON.stringify(DEFAULT_PREFS));
    }
  }

  function savePrefs() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
    } catch (e) {
      warn("savePrefs fallito:", e);
    }
  }

  function generateId() {
    return "im_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 8);
  }

  // ════════════════════════════════════════════════════════════════════
  // UTILITY
  // ════════════════════════════════════════════════════════════════════
  function clickIfExists(id) {
    const el = document.getElementById(id);
    if (el && !el.disabled) {
      el.click();
      return true;
    }
    return false;
  }

  function dispatchKey(key, mods) {
    const ev = new KeyboardEvent("keydown", {
      key: key,
      code: "Key" + key.toUpperCase(),
      ctrlKey: !!(mods && mods.ctrlKey),
      shiftKey: !!(mods && mods.shiftKey),
      altKey: !!(mods && mods.altKey),
      metaKey: !!(mods && mods.metaKey),
      bubbles: true,
      cancelable: true
    });
    document.dispatchEvent(ev);
  }

  function simulateDoubleClickAt(e) {
    const target = e && e.target ? e.target : document.elementFromPoint(e.clientX, e.clientY);
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

  function activateHoldPan(e) {
    window.isAltPanning = true;
    if (typeof window.flashToast === "function") window.flashToast(__it("im.toast.panActive", null, "✋ Pan canvas attivo"));
    const release = () => {
      window.isAltPanning = false;
      window.removeEventListener("mouseup", release, true);
      window.removeEventListener("pointerup", release, true);
      window.removeEventListener("pointercancel", release, true);
    };
    window.addEventListener("mouseup", release, true);
    window.addEventListener("pointerup", release, true);
    window.addEventListener("pointercancel", release, true);
  }

  function escapeHTML(s) {
    return String(s).replace(
      /[&<>"']/g,
      (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[m]
    );
  }

  function getActionLabel(actionKey) {
    const a = ACTIONS[actionKey];
    return a ? `${a.icon} ${a.label}` : actionKey;
  }

  function buttonName(code) {
    switch (Number(code)) {
      case 0: return __it("im.button.left",   null, "Sinistro");
      case 1: return __it("im.button.middle", null, "Centrale (rotella)");
      case 2: return __it("im.button.right",  null, "Destro");
      case 3: return __it("im.button.x1",     null, "X1 (laterale Back)");
      case 4: return __it("im.button.x2",     null, "X2 (laterale Forward)");
      default: return __it("im.button.generic", { code: code }, `Button ${code}`);
    }
  }

  function buttonsToLabel(buttons) {
    return buttons.map(buttonName).join(" + ");
  }

  function shortcutToLabel(keys) {
    const parts = [];
    if (keys.ctrl) parts.push("Ctrl");
    if (keys.shift) parts.push("Shift");
    if (keys.alt) parts.push("Alt");
    if (keys.meta) parts.push("Cmd");
    parts.push(keys.key.length === 1 ? keys.key.toUpperCase() : keys.key);
    return parts.join(" + ");
  }

  function setsEqual(a, b) {
    if (a.size !== b.size) return false;
    for (const v of a) if (!b.has(v)) return false;
    return true;
  }

  function pointerIsOverRotatableShape(e) {
    const c = window.canvas;
    if (!c || typeof c.findTarget !== "function") return false;
    try {
      if (typeof c.calcOffset === "function") c.calcOffset();
      const target = c.findTarget(e, false);
      if (!target) return false;
      if (target.lockRotation) return false;
      if (target.__isBackground) return false;
      return true;
    } catch (_) {
      return false;
    }
  }

  // isInputFocused() — versione "smart":
  //  • Durante la calibrazione, gli elementi DENTRO il nostro modale
  //    (data-im-modal) NON contano: slider/select/checkbox del modale
  //    potrebbero essere stati toccati dall'utente prima di iniziare la
  //    calibrazione, e non devono bloccare la cattura dei tasti.
  //  • <body> e <html> non contano (in alcuni browser sono activeElement
  //    di default).
  //  • Considera input/textarea/select/contentEditable come "input focused"
  //    quando NON in calibrazione → blocca le scorciatoie mentre l'utente
  //    sta scrivendo in un campo testo.
  function isInputFocused() {
    const t = document.activeElement;
    if (!t) return false;
    if (t === document.body || t === document.documentElement) return false;
    // Durante calibrazione: i controlli interni del nostro modale non bloccano
    if (isCalibrating() && t.closest && t.closest("[data-im-modal]")) return false;
    const tag = t.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
    if (t.isContentEditable) return true;
    return false;
  }

  function isCalibrating() {
    return STATE.calibrationMode !== null;
  }

  // Spinge il focus su <body> (o sul container del modale se aperto) per
  // assicurarsi che non resti un input/select/button con il focus che
  // potrebbe disturbare la cattura tasti.
  function releaseFocus() {
    try {
      const ae = document.activeElement;
      if (ae && typeof ae.blur === "function" && ae !== document.body && ae !== document.documentElement) {
        ae.blur();
      }
    } catch (_) {}
  }

  // ════════════════════════════════════════════════════════════════════
  // EXEC ENGINE
  // ════════════════════════════════════════════════════════════════════
  function executeAction(actionKey, originatingEvent) {
    if (!actionKey || actionKey === "none") return;
    const action = ACTIONS[actionKey];
    if (!action || typeof action.exec !== "function") {
      warn("azione sconosciuta:", actionKey);
      return;
    }
    dbg("EXEC →", actionKey);
    try {
      action.exec(originatingEvent);
    } catch (err) {
      console.error("[InputMapping] errore esecuzione azione", actionKey, err);
    }
  }

  // ════════════════════════════════════════════════════════════════════
  // CHORD MATCHING
  // ════════════════════════════════════════════════════════════════════
  function findChordMatch(buttonSet) {
    if (buttonSet.size < 2) return null;
    const sortedHeld = [...buttonSet].sort((a, b) => a - b);
    const heldKey = sortedHeld.join(",");
    for (const chord of prefs.chordMappings) {
      const chordKey = chord.buttons.slice().sort((a, b) => a - b).join(",");
      if (chordKey === heldKey) return chord;
    }
    return null;
  }

  function chordCouldMatchWithMore(heldSet) {
    for (const chord of prefs.chordMappings) {
      const chordSet = new Set(chord.buttons);
      if (chordSet.size <= heldSet.size) continue;
      let containsAll = true;
      for (const b of heldSet) {
        if (!chordSet.has(b)) { containsAll = false; break; }
      }
      if (containsAll) return true;
    }
    return false;
  }

  // ════════════════════════════════════════════════════════════════════
  // MOUSE EVENT HANDLERS
  // ════════════════════════════════════════════════════════════════════
  function onMouseDownCapture(e) {
    if (!prefs.enabled) {
      dbg("mousedown btn=" + e.button + " ignorato (prefs.enabled=false)");
      return;
    }
    if (isCalibrating()) {
      handleCalibrationMouseDown(e);
      return;
    }

    const btn = e.button;
    if (btn < 0) return;

    // Per X1/X2 (button 3/4) preveniamo il default per evitare la navigation
    // history di Electron quando c'è un mapping attivo.
    if ((btn === 3 || btn === 4) && hasAnyMappingForButton(btn)) {
      try { e.preventDefault(); } catch (_) {}
    }

    STATE.heldButtons.add(btn);
    dbg("mousedown btn=" + btn + " held=[" + [...STATE.heldButtons].join(",") + "]");

    // ── 1) Match CHORD (priorità massima)
    const chord = findChordMatch(STATE.heldButtons);
    if (chord) {
      cancelPendingSingle();
      STATE.lastChordExecutedAt = Date.now();
      STATE.lastChordButtons = new Set(STATE.heldButtons);
      try {
        e.preventDefault();
        e.stopPropagation();
        if (typeof e.stopImmediatePropagation === "function") e.stopImmediatePropagation();
      } catch (_) {}
      dbg("CHORD match:", chord.buttons, "→", chord.action);
      executeAction(chord.action, e);
      return;
    }

    // ── 2) Match SINGLE
    const singleAction = prefs.mouseButtonActions[String(btn)];
    if (!singleAction || singleAction === "none") {
      dbg("nessun single mapping per btn=" + btn);
      return;
    }

    if (prefs.suspendDuringDrawingMode && window.canvas && window.canvas.isDrawingMode && btn === 0) {
      dbg("single skip: drawing mode attivo + btn=0");
      return;
    }
    if (btn === 2 && prefs.preserveRotationOnShapes && pointerIsOverRotatableShape(e)) {
      dbg("single skip: btn=2 sopra forma ruotabile");
      return;
    }
    if (isClickOnUIControl(e)) {
      dbg("single skip: click su UI control");
      return;
    }

    if (prefs.chordDelayMs > 0 && chordCouldMatchWithMore(STATE.heldButtons)) {
      dbg("single deferred (chord potenziale): btn=" + btn + " action=" + singleAction);
      schedulePendingSingle(btn, singleAction, e);
    } else {
      if (btn === 3 || btn === 4) {
        try { e.preventDefault(); } catch (_) {}
      }
      dbg("single immediate: btn=" + btn + " action=" + singleAction);
      executeAction(singleAction, e);
    }
  }

  function onMouseUpCapture(e) {
    if (!prefs.enabled) return;
    if (isCalibrating()) {
      handleCalibrationMouseUp(e);
      return;
    }
    STATE.heldButtons.delete(e.button);
    if (STATE.heldButtons.size === 0) {
      STATE.lastChordButtons = null;
    }
  }

  function onAuxClickCapture(e) {
    if (!prefs.enabled) return;
    const btn = e.button;
    if (btn !== 3 && btn !== 4) return;
    if (STATE.auxClickSuppressUntil && Date.now() < STATE.auxClickSuppressUntil) return;

    if (isCalibrating()) {
      if (STATE.calibrationMode !== "single" && STATE.calibrationMode !== "chord") return;
      try {
        e.preventDefault();
        e.stopPropagation();
        if (typeof e.stopImmediatePropagation === "function") e.stopImmediatePropagation();
      } catch (_) {}
      if (STATE.calibrationMode === "single") {
        STATE.capturedSingleButtonCode = btn;
        commitSingleCalibration();
      } else {
        STATE.capturedChordButtons.add(btn);
        if (STATE.chordCalibrationCommitTimer) clearTimeout(STATE.chordCalibrationCommitTimer);
        STATE.chordCalibrationCommitTimer = setTimeout(() => { commitChordCalibration(); }, 500);
        updateCalibrationUI();
      }
      return;
    }

    const action = prefs.mouseButtonActions[String(btn)];
    if (!action || action === "none") return;
    try { e.preventDefault(); } catch (_) {}
    dbg("auxclick fallback btn=" + btn + " action=" + action);
    executeAction(action, e);
  }

  function markAuxClickHandled() {
    STATE.auxClickSuppressUntil = Date.now() + 80;
  }

  function schedulePendingSingle(button, action, originatingEvent) {
    cancelPendingSingle();
    STATE.pendingSingleButton = button;
    STATE.pendingSingleEvent = originatingEvent;
    STATE.pendingSingleTimer = setTimeout(() => {
      if (button === 3 || button === 4) {
        try { originatingEvent.preventDefault && originatingEvent.preventDefault(); } catch (_) {}
      }
      executeAction(action, originatingEvent);
      STATE.pendingSingleTimer = null;
      STATE.pendingSingleEvent = null;
      STATE.pendingSingleButton = null;
    }, prefs.chordDelayMs);
  }

  function cancelPendingSingle() {
    if (STATE.pendingSingleTimer) {
      clearTimeout(STATE.pendingSingleTimer);
      STATE.pendingSingleTimer = null;
      STATE.pendingSingleEvent = null;
      STATE.pendingSingleButton = null;
    }
  }

  function hasAnyMappingForButton(btn) {
    const single = prefs.mouseButtonActions[String(btn)];
    if (single && single !== "none") return true;
    for (const chord of prefs.chordMappings) {
      if (chord.buttons.includes(btn)) return true;
    }
    return false;
  }

  function isClickOnUIControl(e) {
    const t = e.target;
    if (!t || !t.closest) return false;
    return !!(
      t.closest("#calibPanel") ||
      t.closest(".radial-btn") ||
      t.closest("#measureOverlay") ||
      t.closest("#colorPopup") ||
      t.closest("#zoomPanel") ||
      t.closest("#historyPanel") ||
      t.closest(".topbar-btn") ||
      t.closest(".tool-btn") ||
      t.closest(".topbar-icon-btn") ||
      t.closest("#topbar") ||
      t.closest("#leftToolbar") ||
      t.closest("#inspectorPanel") ||
      t.closest(".inspector") ||
      t.closest("input") ||
      t.closest("button") ||
      t.closest("select") ||
      t.closest("textarea") ||
      t.closest("[data-im-modal]")
    );
  }

  // ════════════════════════════════════════════════════════════════════
  // KEYBOARD EVENT HANDLER
  // ════════════════════════════════════════════════════════════════════
  function onKeyDownCapture(e) {
    if (!prefs.enabled) {
      dbg("keydown key='" + e.key + "' ignorato (prefs.enabled=false)");
      return;
    }
    if (isCalibrating()) {
      handleCalibrationKeyDown(e);
      return;
    }
    if (isInputFocused()) {
      dbg("keydown key='" + e.key + "' ignorato (isInputFocused)");
      return;
    }

    // ── BrowserBack / BrowserForward da mouse laterali su driver Windows
    if (e.key === "BrowserBack" || e.code === "BrowserBack") {
      const a = prefs.mouseButtonActions["3"];
      if (a && a !== "none") {
        try { e.preventDefault(); e.stopPropagation(); } catch (_) {}
        executeAction(a, e);
        return;
      }
    }
    if (e.key === "BrowserForward" || e.code === "BrowserForward") {
      const a = prefs.mouseButtonActions["4"];
      if (a && a !== "none") {
        try { e.preventDefault(); e.stopPropagation(); } catch (_) {}
        executeAction(a, e);
        return;
      }
    }

    // ── Tasti singoli mappati come frecce direzionali
    if (!e.ctrlKey && !e.metaKey && !e.altKey) {
      const arrowKey = (e.key || "").toLowerCase();
      if (
        arrowKey &&
        !["control", "shift", "alt", "meta", "os"].includes(arrowKey) &&
        prefs.arrowKeyBindings.length > 0
      ) {
        const binding = prefs.arrowKeyBindings.find((b) => b.key === arrowKey);
        if (binding && typeof window.handleArrowMovement === "function") {
          try {
            e.preventDefault();
            e.stopPropagation();
            if (typeof e.stopImmediatePropagation === "function") e.stopImmediatePropagation();
          } catch (_) {}
          dbg("ARROW binding match:", binding.key, "→", binding.direction);
          window.handleArrowMovement(binding.direction, e);
          return;
        }
      }
    }

    // ── Scorciatoie custom
    const match = findShortcutMatch(e);
    if (match) {
      try {
        e.preventDefault();
        e.stopPropagation();
        if (typeof e.stopImmediatePropagation === "function") e.stopImmediatePropagation();
      } catch (_) {}
      dbg("SHORTCUT match:", shortcutToLabel(match.keys), "→", match.action);
      executeAction(match.action, e);
    }
  }

  function findShortcutMatch(e) {
    const key = (e.key || "").toLowerCase();
    if (!key) return null;
    if (["control", "shift", "alt", "meta", "os"].includes(key)) return null;
    const evCtrl = !!e.ctrlKey || !!e.metaKey;
    for (const s of prefs.keyboardShortcuts) {
      if (s.keys.key.toLowerCase() !== key) continue;
      if (!!s.keys.ctrl !== evCtrl) continue;
      if (!!s.keys.shift !== !!e.shiftKey) continue;
      if (!!s.keys.alt !== !!e.altKey) continue;
      return s;
    }
    return null;
  }

  // ════════════════════════════════════════════════════════════════════
  // CALIBRAZIONE
  // ════════════════════════════════════════════════════════════════════
  function startCalibration(mode, slotIndex, context) {
    if (!["single", "chord", "shortcut", "arrow"].includes(mode)) return;

    // Libera il focus per evitare che residui su <input>/<select>/<range>
    // del modale facciano scattare isInputFocused() FUORI calibrazione.
    // Nota: isInputFocused() ora ignora già gli elementi del modale durante
    // la calibrazione, quindi questo è una precauzione aggiuntiva.
    releaseFocus();

    STATE.calibrationMode = mode;
    STATE.calibrationSlotIndex = slotIndex;
    STATE.calibrationContext = context || null;
    STATE.capturedSingleButtonCode = null;
    STATE.capturedChordButtons = new Set();
    STATE.capturedShortcut = null;
    STATE.capturedArrowKey = null;

    if (STATE.calibrationTimeoutId) clearTimeout(STATE.calibrationTimeoutId);
    STATE.calibrationTimeoutId = setTimeout(() => {
      cancelCalibration();
      if (typeof window.flashToast === "function") {
        window.flashToast(__it("im.toast.calib.timeout", null, "⏱️ Calibrazione scaduta (15s) — riprova"));
      }
    }, 15000);

    dbg("CALIBRATION start mode=" + mode + " slot=" + slotIndex);
    updateCalibrationUI();
  }

  function cancelCalibration() {
    STATE.calibrationMode = null;
    STATE.calibrationSlotIndex = null;
    STATE.calibrationContext = null;
    STATE.capturedSingleButtonCode = null;
    STATE.capturedChordButtons = new Set();
    STATE.capturedShortcut = null;
    STATE.capturedArrowKey = null;
    if (STATE.calibrationTimeoutId) {
      clearTimeout(STATE.calibrationTimeoutId);
      STATE.calibrationTimeoutId = null;
    }
    if (STATE.chordCalibrationCommitTimer) {
      clearTimeout(STATE.chordCalibrationCommitTimer);
      STATE.chordCalibrationCommitTimer = null;
    }
    updateCalibrationUI();
  }

  function handleCalibrationMouseDown(e) {
    if (STATE.calibrationMode !== "single" && STATE.calibrationMode !== "chord") return;

    // Click sinistro su un controllo del modale: lasciamo passare (serve a
    // interagire col modale stesso — bottoni "annulla", select, ecc.).
    if (
      e.button === 0 &&
      e.target &&
      e.target.closest &&
      e.target.closest("button, select, input, textarea, a")
    ) {
      return;
    }

    try {
      e.preventDefault();
      e.stopPropagation();
      if (typeof e.stopImmediatePropagation === "function") e.stopImmediatePropagation();
    } catch (_) {}

    dbg("CAL mousedown btn=" + e.button + " mode=" + STATE.calibrationMode);

    if (STATE.calibrationMode === "single") {
      STATE.capturedSingleButtonCode = e.button;
      commitSingleCalibration();
    } else if (STATE.calibrationMode === "chord") {
      STATE.capturedChordButtons.add(e.button);
      if (STATE.chordCalibrationCommitTimer) clearTimeout(STATE.chordCalibrationCommitTimer);
      STATE.chordCalibrationCommitTimer = setTimeout(() => { commitChordCalibration(); }, 500);
      updateCalibrationUI();
    }
  }

  function handleCalibrationMouseUp(e) {
    if (STATE.calibrationMode !== "single" && STATE.calibrationMode !== "chord") return;
    if (
      e.button === 0 &&
      e.target &&
      e.target.closest &&
      e.target.closest("button, select, input, textarea, a")
    ) {
      return;
    }
    try {
      e.preventDefault();
      e.stopPropagation();
      if (typeof e.stopImmediatePropagation === "function") e.stopImmediatePropagation();
    } catch (_) {}
  }

  function handleCalibrationKeyDown(e) {
    const key = (e.key || "").toLowerCase();

    // Escape annulla SEMPRE la calibrazione, qualunque mode
    if (key === "escape") {
      try { e.preventDefault(); e.stopPropagation(); } catch (_) {}
      dbg("CAL cancel via Escape (mode=" + STATE.calibrationMode + ")");
      cancelCalibration();
      return;
    }

    // Modalità "arrow"
    if (STATE.calibrationMode === "arrow") {
      if (isInputFocused()) return;
      if (["control", "shift", "alt", "meta", "os"].includes(key)) return;

      if (["arrowup", "arrowdown", "arrowleft", "arrowright"].includes(key)) {
        try { e.preventDefault(); e.stopPropagation(); } catch (_) {}
        if (typeof window.flashToast === "function") {
          window.flashToast(__it("im.toast.arrow.alreadyNative", null, "⚠️ Le frecce native sono già attive — scegli un tasto diverso"));
        }
        return;
      }

      try {
        e.preventDefault();
        e.stopPropagation();
        if (typeof e.stopImmediatePropagation === "function") e.stopImmediatePropagation();
      } catch (_) {}

      STATE.capturedArrowKey = key;
      dbg("CAL arrow captured key='" + key + "'");
      commitArrowCalibration();
      return;
    }

    // Modalità "shortcut"
    if (STATE.calibrationMode !== "shortcut") return;
    if (isInputFocused()) return;
    if (["control", "shift", "alt", "meta", "os"].includes(key)) return;

    try {
      e.preventDefault();
      e.stopPropagation();
      if (typeof e.stopImmediatePropagation === "function") e.stopImmediatePropagation();
    } catch (_) {}

    STATE.capturedShortcut = {
      ctrl: !!(e.ctrlKey || e.metaKey),
      shift: !!e.shiftKey,
      alt: !!e.altKey,
      meta: !!e.metaKey,
      key: key
    };
    dbg("CAL shortcut captured:", STATE.capturedShortcut);
    commitShortcutCalibration();
  }

  function commitSingleCalibration() {
    const code = STATE.capturedSingleButtonCode;
    if (code == null) return cancelCalibration();
    const codeKey = String(code);
    if (!(codeKey in prefs.mouseButtonActions)) {
      prefs.mouseButtonActions[codeKey] = "none";
    }
    savePrefs();
    if (typeof window.flashToast === "function") {
      window.flashToast(__it("im.toast.button.detected", { code: code, name: buttonName(code) }, `🎯 Tasto rilevato: button code ${code} (${buttonName(code)}) — assegnagli un'azione dal menù`));
    }
    STATE.calibrationMode = null;
    STATE.calibrationSlotIndex = null;
    if (STATE.calibrationTimeoutId) {
      clearTimeout(STATE.calibrationTimeoutId);
      STATE.calibrationTimeoutId = null;
    }
    refreshModalUI();
  }

  function commitChordCalibration() {
    const set = STATE.capturedChordButtons;
    if (!set || set.size < 2) {
      if (typeof window.flashToast === "function") {
        window.flashToast(__it("im.toast.chord.needTwo", null, "⚠️ Servono almeno 2 tasti per un chord"));
      }
      cancelCalibration();
      return;
    }
    const slotIdx = STATE.calibrationSlotIndex;
    const buttons = [...set].sort((a, b) => a - b);

    if (slotIdx === "new") {
      prefs.chordMappings.push({
        id: generateId(),
        buttons: buttons,
        action: "none"
      });
    } else if (typeof slotIdx === "number" && prefs.chordMappings[slotIdx]) {
      prefs.chordMappings[slotIdx].buttons = buttons;
    }

    savePrefs();
    if (typeof window.flashToast === "function") {
      window.flashToast(__it("im.toast.chord.registered", { label: buttonsToLabel(buttons) }, `✅ Combinazione registrata: ${buttonsToLabel(buttons)}`));
    }
    cancelCalibration();
    refreshModalUI();
  }

  function commitShortcutCalibration() {
    const s = STATE.capturedShortcut;
    const slotIdx = STATE.calibrationSlotIndex;
    if (!s) { cancelCalibration(); return; }
    if (slotIdx === "new") {
      prefs.keyboardShortcuts.push({ id: generateId(), keys: s, action: "none" });
    } else if (typeof slotIdx === "number" && prefs.keyboardShortcuts[slotIdx]) {
      prefs.keyboardShortcuts[slotIdx].keys = s;
    }
    savePrefs();
    if (typeof window.flashToast === "function") {
      window.flashToast(__it("im.toast.shortcut.registered", { label: shortcutToLabel(s) }, `✅ Scorciatoia registrata: ${shortcutToLabel(s)}`));
    }
    cancelCalibration();
    refreshModalUI();
  }

  function commitArrowCalibration() {
    const key = STATE.capturedArrowKey;
    const ctx = STATE.calibrationContext || {};
    const direction = ctx.direction;
    const slotIdx = STATE.calibrationSlotIndex;

    if (!key || !["up", "down", "left", "right"].includes(direction)) {
      cancelCalibration();
      return;
    }

    const conflictIdx = prefs.arrowKeyBindings.findIndex(
      (b, i) => b.key === key && (typeof slotIdx !== "number" || i !== slotIdx)
    );
    if (conflictIdx >= 0) {
      if (typeof window.flashToast === "function") {
        window.flashToast(__it("im.toast.arrow.keyAlreadyMapped", { key: key.toUpperCase() }, `⚠️ Il tasto "${key.toUpperCase()}" è già mappato a un'altra freccia`));
      }
      cancelCalibration();
      return;
    }

    if (slotIdx === "new") {
      prefs.arrowKeyBindings.push({ id: generateId(), key: key, direction: direction });
    } else if (typeof slotIdx === "number" && prefs.arrowKeyBindings[slotIdx]) {
      prefs.arrowKeyBindings[slotIdx].key = key;
    }

    savePrefs();
    if (typeof window.flashToast === "function") {
      const arrowSym = { up: "↑", down: "↓", left: "←", right: "→" }[direction];
      window.flashToast(__it("im.toast.arrow.registered", { key: key.toUpperCase(), arrow: arrowSym }, `✅ ${key.toUpperCase()} → ${arrowSym}`));
    }
    cancelCalibration();
    refreshModalUI();
  }

  // ════════════════════════════════════════════════════════════════════
  // BANNER DI CALIBRAZIONE (FLOATING, FIXED, SEMPRE VISIBILE)
  // ════════════════════════════════════════════════════════════════════
  function ensureCalibrationBanner() {
    let banner = document.getElementById("imCalibrationBannerFloating");
    if (banner) return banner;
    banner = document.createElement("div");
    banner.id = "imCalibrationBannerFloating";
    banner.setAttribute("data-im-modal", "1");
    banner.style.cssText = `
      display:none;
      position:fixed;
      top:14px;
      left:50%;
      transform:translateX(-50%);
      z-index:20010;
      background:#3d2a00;
      border:1px solid #fbbf24;
      border-left:4px solid #fbbf24;
      padding:12px 18px;
      border-radius:6px;
      font-size:13px;
      color:#fde68a;
      box-shadow:0 6px 24px rgba(0,0,0,0.6);
      max-width:680px;
      width:auto;
    `;
    document.body.appendChild(banner);
    return banner;
  }

  function updateCalibrationUI() {
    const banner = ensureCalibrationBanner();
    if (!STATE.calibrationMode) {
      banner.style.display = "none";
      banner.innerHTML = "";
      // Aggiorno anche il banner interno al modale se esiste (legacy)
      const inner = document.getElementById("imCalibrationBanner");
      if (inner) { inner.style.display = "none"; inner.innerHTML = ""; }
      return;
    }
    banner.style.display = "block";
    let html = "";
    if (STATE.calibrationMode === "single") {
      html = `⏳ <b>Premi ora il tasto del mouse</b> che vuoi rilevare... <span style="color:#aaa">(timeout 15s — <a href="#" id="imCancelCalib">annulla</a> · Esc per annullare)</span>`;
    } else if (STATE.calibrationMode === "chord") {
      const captured = [...(STATE.capturedChordButtons || [])].sort();
      // i18n: il template è composto come nell'originale ma con stringhe tradotte.
      // im.banner.chord.press contiene la headline grassetto, detectedSoFar il sottotitolo.
      const chordHeadline = __it("im.banner.chord.press", null, "⏳ <b>Premi simultaneamente i tasti del mouse</b> che formano la combinazione...");
      const chordCaptured = captured.length ? buttonsToLabel(captured) : __it("im.banner.chord.none", null, "nessuno");
      const chordSub = __it("im.banner.chord.detectedSoFar", { captured: chordCaptured }, `Rilevati finora: ${chordCaptured} — rilascia per confermare (0.5s).`);
      const cancelTxt = __it("im.banner.cancel", null, "annulla");
      const escTxt = __it("im.banner.escToCancel", null, "Esc per annullare");
      html = `${chordHeadline}<br/>
              <span style="color:#fde68a;font-size:12px;">${chordSub}</span>
              <span style="color:#aaa"> · <a href="#" id="imCancelCalib">${cancelTxt}</a> · ${escTxt}</span>`;
    } else if (STATE.calibrationMode === "shortcut") {
      const headline = __it("im.banner.shortcut.press", null, "⏳ <b>Premi la combinazione di tasti</b> (modificatori + tasto)...");
      const timeoutTxt = __it("im.banner.shortcut.timeout", null, "timeout 15s");
      const cancelTxt = __it("im.banner.cancel", null, "annulla");
      const escTxt = __it("im.banner.escToCancel", null, "Esc per annullare");
      html = `${headline} <span style="color:#aaa">(${timeoutTxt} — <a href="#" id="imCancelCalib">${cancelTxt}</a> · ${escTxt})</span>`;
    } else if (STATE.calibrationMode === "arrow") {
      const dir = STATE.calibrationContext && STATE.calibrationContext.direction;
      const arrowSym = { up: "↑", down: "↓", left: "←", right: "→" }[dir] || "?";
      // arrowName usa le chiavi i18n im.arrow.upShort/downShort/leftShort/rightShort
      const arrowKey = { up: "im.arrow.upShort", down: "im.arrow.downShort", left: "im.arrow.leftShort", right: "im.arrow.rightShort" }[dir];
      const arrowFallback = { up: "su", down: "giù", left: "sinistra", right: "destra" }[dir] || "?";
      const arrowName = arrowKey ? __it(arrowKey, null, arrowFallback) : "?";
      const headline = __it("im.banner.arrow.press", null, "⏳ <b>Premi un tasto</b> da mappare come freccia");
      const hint = __it("im.banner.arrow.hintSingle", null, "Solo tasti singoli, senza modificatori. Le frecce native (↑↓←→) sono già attive e non possono essere rimappate.");
      const cancelTxt = __it("im.banner.cancel", null, "annulla");
      const escTxt = __it("im.banner.escToCancel", null, "Esc per annullare");
      html = `${headline} <span style="color:#4ade80;font-size:16px">${arrowSym}</span> (${arrowName}) <br/>
              <span style="color:#fde68a;font-size:12px;">${hint}</span>
              <span style="color:#aaa"> · <a href="#" id="imCancelCalib">${cancelTxt}</a> · ${escTxt}</span>`;
    }
    banner.innerHTML = html;
    const cancelLink = document.getElementById("imCancelCalib");
    if (cancelLink) {
      cancelLink.addEventListener("click", (e) => {
        e.preventDefault();
        cancelCalibration();
      });
    }
  }

  // ════════════════════════════════════════════════════════════════════
  // UI — MODALE DI CONFIGURAZIONE (generata dinamicamente)
  // ════════════════════════════════════════════════════════════════════
  function ensureModal() {
    if (document.getElementById("inputMappingModal")) return;

    const modal = document.createElement("div");
    modal.id = "inputMappingModal";
    modal.setAttribute("data-im-modal", "1");
    modal.style.cssText = `
      display: none;
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.92);
      z-index: 20005;
      align-items: center;
      justify-content: center;
    `;

    modal.innerHTML = `
      <div data-im-modal="1" style="
        background:#1f1f1f;
        padding:22px 24px;
        border-radius:12px;
        width:760px;
        max-width:94vw;
        max-height:92vh;
        overflow:auto;
        color:#eee;
        box-shadow:0 15px 50px rgba(0,0,0,0.8);
      ">
        <!-- Header -->
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px">
          <h3 style="margin:0;font-size:17px" data-i18n="im.modal.title">🖱️⌨️ Mappatura Mouse & Tastiera</h3>
          <button id="imCloseBtn" data-i18n-title="im.modal.close" title="Chiudi"
                  style="background:none;border:none;color:#aaa;font-size:26px;cursor:pointer;line-height:1">×</button>
        </div>

        <!-- Banner calibrazione interno (legacy, lasciato per compat ma nascosto) -->
        <div id="imCalibrationBanner" style="display:none"></div>

        <!-- Toggle integrazione -->
        <label style="display:flex;align-items:center;gap:10px;margin-bottom:14px;padding:10px 12px;background:#2a2a2a;border-radius:8px;cursor:pointer">
          <input type="checkbox" id="imEnabledCheck" style="width:18px;height:18px;cursor:pointer"/>
          <span style="flex:1">
            <b data-i18n="im.modal.enableLabel">Abilita mapping personalizzati</b>
            <div style="font-size:11px;color:#aaa;margin-top:2px" data-i18n="im.modal.enableHint">
              Disattiva per tornare al comportamento standard (sx=selezione, dx=rotazione su forme)
            </div>
          </span>
        </label>

        <!-- ════════ SEZIONE TASTI SINGOLI ════════ -->
        <div style="background:#2a2a2a;border-radius:8px;padding:14px;margin-bottom:14px">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">
            <h4 style="margin:0;font-size:14px;color:#fbbf24" data-i18n="im.modal.singleTitle">🖱️ Tasti singoli del mouse</h4>
            <button id="imLearnButton" class="im-secondary-btn" data-i18n="im.modal.learnButton">🎯 Rileva codice tasto</button>
          </div>
          <div style="font-size:11px;color:#aaa;margin-bottom:10px" data-i18n="im.modal.singleHint">
            I tasti laterali (X1/X2) sui mouse HP HSA-P007M, gaming e simili emettono
            di norma button code 3 (back) e 4 (forward). Mappali qui per evitare la navigazione
            del browser e usarli come scorciatoie a tua scelta.
          </div>
          <div id="imSingleButtonsList"></div>
        </div>

        <!-- ════════ SEZIONE CHORD ════════ -->
        <div style="background:#2a2a2a;border-radius:8px;padding:14px;margin-bottom:14px">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">
            <h4 style="margin:0;font-size:14px;color:#fbbf24" data-i18n="im.modal.chordTitle">🤝 Combinazioni (chord) — più tasti mouse insieme</h4>
            <button id="imAddChord" class="im-secondary-btn" data-i18n="im.modal.addChord">➕ Aggiungi combinazione</button>
          </div>
          <div style="font-size:11px;color:#aaa;margin-bottom:10px" data-i18n-html="im.modal.chordHint">
            Esempio: <b>Sinistro + Destro</b> per Annulla. Le combinazioni hanno priorità sui
            tasti singoli: se il chord si completa, l'azione del singolo non scatta.
          </div>
          <div id="imChordsList"></div>
        </div>

        <!-- ════════ SEZIONE SCORCIATOIE TASTIERA ════════ -->
        <div style="background:#2a2a2a;border-radius:8px;padding:14px;margin-bottom:14px">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">
            <h4 style="margin:0;font-size:14px;color:#fbbf24" data-i18n="im.modal.shortcutTitle">⌨️ Scorciatoie tastiera personalizzate</h4>
            <button id="imAddShortcut" class="im-secondary-btn" data-i18n="im.modal.addShortcut">➕ Aggiungi scorciatoia</button>
          </div>
          <div style="font-size:11px;color:#aaa;margin-bottom:10px" data-i18n-html="im.modal.shortcutHint">
            Esempio: <b>Ctrl+L</b> → Toggle Lazo. ⚠️ Le scorciatoie di base di Mosaica
            (Ctrl+Z/C/V/X, Delete, Ctrl+/-, Ctrl+R, frecce) sono protette: per sovrascriverle,
            assegnale qui — la tua versione avrà la precedenza.
            <br/>Premi <b>➕ Aggiungi scorciatoia</b> e premi la sequenza di tasti che vuoi aggiungere sulla tastiera.
          </div>
          <div id="imShortcutsList"></div>
        </div>

        <!-- ════════ SEZIONE TASTI COME FRECCE ════════ -->
        <div style="background:#2a2a2a;border-radius:8px;padding:14px;margin-bottom:14px">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;flex-wrap:wrap;gap:8px">
            <h4 style="margin:0;font-size:14px;color:#fbbf24" data-i18n="im.modal.arrowTitle">🎮 Tasti come frecce direzionali</h4>
            <div style="display:flex;gap:6px;flex-wrap:wrap">
              <button class="im-secondary-btn" data-im-add-arrow="up" data-i18n="im.modal.arrowMapUp">➕ Mappa per ↑</button>
              <button class="im-secondary-btn" data-im-add-arrow="down" data-i18n="im.modal.arrowMapDown">➕ Mappa per ↓</button>
              <button class="im-secondary-btn" data-im-add-arrow="left" data-i18n="im.modal.arrowMapLeft">➕ Mappa per ←</button>
              <button class="im-secondary-btn" data-im-add-arrow="right" data-i18n="im.modal.arrowMapRight">➕ Mappa per →</button>
            </div>
          </div>
          <div style="font-size:11px;color:#aaa;margin-bottom:10px" data-i18n-html="im.modal.arrowHint">
            Mappa tasti singoli (es. <b>W</b>→↑, <b>S</b>→↓, <b>A</b>→←, <b>D</b>→→) per spostare
            la forma selezionata. <b>Le frecce native (↑↓←→) restano sempre attive in parallelo</b>.<br/>
            Step di movimento: <b>0.1 mm</b> di default, <b>1 mm</b> con <kbd>Shift</kbd>,
            <b>0.01 mm</b> con <kbd>Ctrl</kbd>. Senza selezione, fa pan della vista di 5 mm.<br/>
            I tasti mappati scattano solo da soli o con <kbd>Shift</kbd>: le combinazioni con
            <kbd>Ctrl</kbd>/<kbd>Alt</kbd>/<kbd>Cmd</kbd> restano libere per le scorciatoie.
          </div>
          <div id="imArrowBindingsList"></div>
        </div>

        <!-- ════════ OPZIONI AVANZATE ════════ -->
        <details style="background:#2a2a2a;border-radius:8px;padding:14px;margin-bottom:14px">
          <summary style="cursor:pointer;font-size:13px;color:#fbbf24;font-weight:600" data-i18n="im.modal.advancedTitle">⚙️ Opzioni avanzate</summary>
          <div style="margin-top:10px;display:flex;flex-direction:column;gap:10px">
            <label style="display:flex;align-items:center;gap:10px;font-size:12px">
              <span style="flex:1"><span data-i18n="im.modal.chordDelayLabel">Ritardo chord disambiguation (ms):</span>
                <span id="imChordDelayVal" style="color:#4ade80;font-weight:600">80</span></span>
              <input type="range" id="imChordDelaySlider" min="0" max="300" step="10" style="width:180px"/>
            </label>
            <div style="font-size:11px;color:#888;margin-top:-4px" data-i18n="im.modal.chordDelayHint">
              Quando un tasto premuto potrebbe far parte di una combinazione mappata,
              il suo mapping single attende N ms per dare tempo alla combinazione. 0 = scatta subito.
            </div>
            <label style="display:flex;align-items:center;gap:10px;font-size:12px">
              <input type="checkbox" id="imPreserveRotation" style="width:16px;height:16px"/>
              <span style="flex:1">
                <b data-i18n="im.modal.preserveRotationLabel">Preserva rotazione fine sul tasto destro</b>
                <div style="font-size:11px;color:#888" data-i18n="im.modal.preserveRotationHint">Il mapping del tasto destro non scatta sopra le forme (ruotabili).</div>
              </span>
            </label>
            <label style="display:flex;align-items:center;gap:10px;font-size:12px">
              <input type="checkbox" id="imSuspendDrawing" style="width:16px;height:16px"/>
              <span style="flex:1">
                <b data-i18n="im.modal.suspendDrawingLabel">Sospendi in modalità disegno</b>
                <div style="font-size:11px;color:#888" data-i18n="im.modal.suspendDrawingHint">Penna/Acquerello/Gomma: il tasto sinistro disegna, i mapping singoli sono sospesi.</div>
              </span>
            </label>
            <label style="display:flex;align-items:center;gap:10px;font-size:12px">
              <input type="checkbox" id="imDebugCheck" style="width:16px;height:16px"/>
              <span style="flex:1">
                <b data-i18n="im.modal.debugLabel">Diagnostica console</b>
                <div style="font-size:11px;color:#888" data-i18n="im.modal.debugHint">Stampa log dettagliati nella DevTools console (Ctrl+Shift+I). Utile per capire perché un mapping non scatta.</div>
              </span>
            </label>
          </div>
        </details>

        <!-- Footer azioni -->
        <div style="display:flex;justify-content:space-between;gap:10px">
          <button id="imResetDefaults" class="im-secondary-btn" data-i18n="im.modal.resetDefaults">🔄 Ripristina default</button>
          <button id="imDone" style="
            background:#fbbf24;border:0;color:#000;padding:9px 18px;border-radius:6px;
            cursor:pointer;font-size:13px;font-weight:600;" data-i18n="im.modal.done">Fatto</button>
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    // i18n: applica le traduzioni sui marker data-i18n* statici del modale
    // appena iniettato. È sicuro chiamare anche se window.i18n non c'è
    // ancora (no-op). Senza questa chiamata, gli elementi marcati ma
    // appendi DOPO il DOMContentLoaded iniziale rimarrebbero in italiano.
    try {
      if (window.i18n && typeof window.i18n.applyTranslations === "function") {
        window.i18n.applyTranslations(modal);
      }
    } catch (e) {
      console.warn("[inputMapping] applyTranslations sul modale fallito:", e);
    }

    if (!document.getElementById("inputMappingStyle")) {
      const st = document.createElement("style");
      st.id = "inputMappingStyle";
      st.textContent = `
        .im-secondary-btn {
          background:#3b3b3b;border:0;color:#fff;padding:6px 12px;
          border-radius:6px;cursor:pointer;font-size:12px;
          transition:background 0.15s ease;
        }
        .im-secondary-btn:hover { background:#4b4b4b; }
        .im-row {
          display:flex;align-items:center;gap:8px;padding:8px 10px;
          background:#1f1f1f;border-radius:6px;margin-bottom:6px;font-size:13px;
        }
        .im-row select, .im-row input[type="text"] {
          background:#3b3b3b;color:#eee;border:1px solid #555;
          padding:5px 8px;border-radius:4px;font-size:12px;
        }
        .im-row .im-label {
          flex:1;color:#eee;font-weight:500;
        }
        .im-row .im-meta {
          font-size:11px;color:#888;
        }
        .im-row .im-del {
          background:#742a2a;border:0;color:#fff;
          padding:5px 10px;border-radius:4px;cursor:pointer;font-size:11px;
        }
        .im-row .im-del:hover { background:#9b3535; }
        .im-row .im-relearn {
          background:#2a4a74;border:0;color:#fff;
          padding:5px 10px;border-radius:4px;cursor:pointer;font-size:11px;
        }
        .im-row .im-relearn:hover { background:#3b5b8a; }
        #inputMappingModal a { color:#60a5fa; }
      `;
      document.head.appendChild(st);
    }

    // Wiring
    document.getElementById("imCloseBtn").addEventListener("click", closeModal);
    document.getElementById("imDone").addEventListener("click", closeModal);
    document.getElementById("imEnabledCheck").addEventListener("change", (e) => {
      prefs.enabled = !!e.target.checked;
      savePrefs();
      if (!prefs.enabled) warn(__it("im.modal.disabledWarn", null, "⚠️ Mapping personalizzati DISATTIVATI — nessuna scorciatoia/chord/freccia personalizzata funzionerà"));
      else dbg("Mapping personalizzati attivati");
    });
    document.getElementById("imResetDefaults").addEventListener("click", () => {
      if (!confirm(__it("im.confirm.resetDefaults", null, "Ripristinare tutti i mapping ai valori di default?"))) return;
      prefs = JSON.parse(JSON.stringify(DEFAULT_PREFS));
      savePrefs();
      refreshModalUI();
      if (typeof window.flashToast === "function") window.flashToast(__it("im.toast.prefs.reset", null, "🔄 Mapping ripristinati ai default"));
    });
    document.getElementById("imLearnButton").addEventListener("click", () => {
      startCalibration("single", "learn:any");
    });
    document.getElementById("imAddChord").addEventListener("click", () => {
      if (typeof window.flashToast === "function") {
        window.flashToast(__it("im.toast.chord.startPress", null, 'Premi simultaneamente i tasti del mouse che vuoi combinare.'));
      }
      startCalibration("chord", "new");
    });
    document.getElementById("imAddShortcut").addEventListener("click", () => {
      if (typeof window.flashToast === "function") {
        window.flashToast(__it("im.toast.shortcut.startPress", null, 'Premi la sequenza di tasti che vuoi aggiungere sulla tastiera.'));
      }
      startCalibration("shortcut", "new");
    });

    modal.querySelectorAll("button[data-im-add-arrow]").forEach((b) => {
      b.addEventListener("click", () => {
        const direction = b.getAttribute("data-im-add-arrow");
        if (typeof window.flashToast === "function") {
          const arrowSym = { up: "↑", down: "↓", left: "←", right: "→" }[direction] || "?";
          window.flashToast(__it("im.toast.arrow.startPress", { arrow: arrowSym }, `Premi un tasto da mappare a ${arrowSym}`));
        }
        startCalibration("arrow", "new", { direction });
      });
    });

    document.getElementById("imChordDelaySlider").addEventListener("input", (e) => {
      prefs.chordDelayMs = parseInt(e.target.value, 10) || 0;
      document.getElementById("imChordDelayVal").textContent = String(prefs.chordDelayMs);
      savePrefs();
    });
    document.getElementById("imPreserveRotation").addEventListener("change", (e) => {
      prefs.preserveRotationOnShapes = !!e.target.checked;
      savePrefs();
    });
    document.getElementById("imSuspendDrawing").addEventListener("change", (e) => {
      prefs.suspendDuringDrawingMode = !!e.target.checked;
      savePrefs();
    });
    document.getElementById("imDebugCheck").addEventListener("change", (e) => {
      DEBUG = !!e.target.checked;
      console.log("[InputMapping] DEBUG =", DEBUG);
    });

    // Chiusura cliccando lo sfondo — disabilitata durante calibrazione
    modal.addEventListener("click", (e) => {
      if (e.target === modal && !isCalibrating()) closeModal();
    });
  }

  function openModal() {
    ensureModal();
    refreshModalUI();
    document.getElementById("inputMappingModal").style.display = "flex";
    // Libera il focus dal toolbar button che ha aperto il modale, così i
    // keydown durante eventuali calibrazioni vengono catturati subito.
    releaseFocus();
  }

  function closeModal() {
    cancelCalibration();
    const m = document.getElementById("inputMappingModal");
    if (m) m.style.display = "none";
    // CRITICO: libera il focus da qualunque elemento del modale (select,
    // checkbox, slider, button) — altrimenti isInputFocused() bloccherebbe
    // tutte le scorciatoie successive finché l'utente non clicca altrove.
    releaseFocus();
  }

  function refreshModalUI() {
    if (!document.getElementById("inputMappingModal")) return;

    document.getElementById("imEnabledCheck").checked = prefs.enabled;
    document.getElementById("imChordDelaySlider").value = prefs.chordDelayMs;
    document.getElementById("imChordDelayVal").textContent = String(prefs.chordDelayMs);
    document.getElementById("imPreserveRotation").checked = prefs.preserveRotationOnShapes;
    document.getElementById("imSuspendDrawing").checked = prefs.suspendDuringDrawingMode;
    const dbgCheck = document.getElementById("imDebugCheck");
    if (dbgCheck) dbgCheck.checked = DEBUG;

    renderSingleButtons();
    renderChords();
    renderShortcuts();
    renderArrowBindings();
    updateCalibrationUI();
  }

  function actionsDropdownHTML(currentAction) {
    let html = "";
    for (const key of Object.keys(ACTIONS)) {
      const a = ACTIONS[key];
      const sel = key === currentAction ? "selected" : "";
      html += `<option value="${escapeHTML(key)}" ${sel}>${escapeHTML(a.icon + " " + a.label)}</option>`;
    }
    return html;
  }

  function renderSingleButtons() {
    const container = document.getElementById("imSingleButtonsList");
    if (!container) return;

    const standardCodes = ["0", "1", "2", "3", "4"];
    const allCodes = Array.from(new Set([...standardCodes, ...Object.keys(prefs.mouseButtonActions)]));
    allCodes.sort((a, b) => Number(a) - Number(b));

    let html = "";
    for (const code of allCodes) {
      const current = prefs.mouseButtonActions[code] || "none";
      const nameLabel = buttonName(code);
      const isExotic = !standardCodes.includes(code);
      html += `
        <div class="im-row">
          <span class="im-label">${escapeHTML(nameLabel)} <span class="im-meta">(button ${escapeHTML(code)})</span></span>
          <select data-im-single-code="${escapeHTML(code)}">${actionsDropdownHTML(current)}</select>
          ${isExotic ? `<button class="im-del" data-im-remove-single="${escapeHTML(code)}">✕</button>` : ""}
        </div>
      `;
    }
    container.innerHTML = html;

    container.querySelectorAll("select[data-im-single-code]").forEach((sel) => {
      sel.addEventListener("change", (e) => {
        const code = e.target.getAttribute("data-im-single-code");
        prefs.mouseButtonActions[code] = e.target.value;
        savePrefs();
      });
    });
    container.querySelectorAll("button[data-im-remove-single]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const code = btn.getAttribute("data-im-remove-single");
        delete prefs.mouseButtonActions[code];
        savePrefs();
        renderSingleButtons();
      });
    });
  }

  function renderChords() {
    const container = document.getElementById("imChordsList");
    if (!container) return;

    if (prefs.chordMappings.length === 0) {
      container.innerHTML = `<div style="color:#888;font-size:12px;font-style:italic;padding:8px 4px">${__it("im.placeholder.noChord", null, "Nessuna combinazione configurata. Premi \"➕ Aggiungi combinazione\" e premi i tasti del mouse insieme.")}</div>`;
      return;
    }

    let html = "";
    prefs.chordMappings.forEach((c, idx) => {
      html += `
        <div class="im-row">
          <span class="im-label">${escapeHTML(buttonsToLabel(c.buttons))}</span>
          <select data-im-chord-idx="${idx}">${actionsDropdownHTML(c.action)}</select>
          <button class="im-relearn" data-im-relearn-chord="${idx}">${__it("im.modal.relearn", null, "🎯 Riapprendi")}</button>
          <button class="im-del" data-im-remove-chord="${idx}">✕</button>
        </div>
      `;
    });
    container.innerHTML = html;

    container.querySelectorAll("select[data-im-chord-idx]").forEach((sel) => {
      sel.addEventListener("change", (e) => {
        const idx = parseInt(e.target.getAttribute("data-im-chord-idx"), 10);
        if (prefs.chordMappings[idx]) {
          prefs.chordMappings[idx].action = e.target.value;
          savePrefs();
        }
      });
    });
    container.querySelectorAll("button[data-im-relearn-chord]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const idx = parseInt(btn.getAttribute("data-im-relearn-chord"), 10);
        startCalibration("chord", idx);
      });
    });
    container.querySelectorAll("button[data-im-remove-chord]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const idx = parseInt(btn.getAttribute("data-im-remove-chord"), 10);
        prefs.chordMappings.splice(idx, 1);
        savePrefs();
        renderChords();
      });
    });
  }

  function renderShortcuts() {
    const container = document.getElementById("imShortcutsList");
    if (!container) return;

    if (prefs.keyboardShortcuts.length === 0) {
      container.innerHTML = `<div style="color:#888;font-size:12px;font-style:italic;padding:8px 4px">${__it("im.placeholder.noShortcut", null, "Nessuna scorciatoia personalizzata. Premi \"➕ Aggiungi scorciatoia\" e digita la combinazione (es. Ctrl+L).")}</div>`;
      return;
    }

    let html = "";
    prefs.keyboardShortcuts.forEach((s, idx) => {
      html += `
        <div class="im-row">
          <span class="im-label"><kbd style="background:#3b3b3b;padding:2px 6px;border-radius:3px;font-family:monospace">${escapeHTML(shortcutToLabel(s.keys))}</kbd></span>
          <select data-im-shortcut-idx="${idx}">${actionsDropdownHTML(s.action)}</select>
          <button class="im-relearn" data-im-relearn-shortcut="${idx}">🎯 Riapprendi</button>
          <button class="im-del" data-im-remove-shortcut="${idx}">✕</button>
        </div>
      `;
    });
    container.innerHTML = html;

    container.querySelectorAll("select[data-im-shortcut-idx]").forEach((sel) => {
      sel.addEventListener("change", (e) => {
        const idx = parseInt(e.target.getAttribute("data-im-shortcut-idx"), 10);
        if (prefs.keyboardShortcuts[idx]) {
          prefs.keyboardShortcuts[idx].action = e.target.value;
          savePrefs();
        }
      });
    });
    container.querySelectorAll("button[data-im-relearn-shortcut]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const idx = parseInt(btn.getAttribute("data-im-relearn-shortcut"), 10);
        startCalibration("shortcut", idx);
      });
    });
    container.querySelectorAll("button[data-im-remove-shortcut]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const idx = parseInt(btn.getAttribute("data-im-remove-shortcut"), 10);
        prefs.keyboardShortcuts.splice(idx, 1);
        savePrefs();
        renderShortcuts();
      });
    });
  }

  function renderArrowBindings() {
    const container = document.getElementById("imArrowBindingsList");
    if (!container) return;

    if (prefs.arrowKeyBindings.length === 0) {
      container.innerHTML = `<div style="color:#888;font-size:12px;font-style:italic;padding:8px 4px">${__it("im.placeholder.noArrow", null, "Nessun tasto mappato come freccia. Premi uno dei \"➕ Mappa per ↑/↓/←/→\" qui sopra per assegnare un tasto fisico a una direzione.")}</div>`;
      return;
    }

    const arrowSym = { up: "↑", down: "↓", left: "←", right: "→" };
    // arrowName tradotto via i18n (chiavi im.arrow.up/down/left/right). Fallback IT integrato.
    const arrowName = {
      up:    __it("im.arrow.up",    null, "freccia su"),
      down:  __it("im.arrow.down",  null, "freccia giù"),
      left:  __it("im.arrow.left",  null, "freccia sinistra"),
      right: __it("im.arrow.right", null, "freccia destra")
    };

    let html = "";
    prefs.arrowKeyBindings.forEach((b, idx) => {
      const keyLabel = b.key.length === 1 ? b.key.toUpperCase() : b.key;
      html += `
        <div class="im-row">
          <span class="im-label" style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
            <kbd style="background:#3b3b3b;padding:3px 10px;border-radius:3px;font-family:monospace;font-size:13px;font-weight:600">${escapeHTML(keyLabel)}</kbd>
            <span style="color:#888">→</span>
            <span style="color:#4ade80;font-size:18px;font-weight:600">${arrowSym[b.direction]}</span>
            <span class="im-meta">${arrowName[b.direction]}</span>
          </span>
          <button class="im-relearn" data-im-relearn-arrow="${idx}">${__it("im.modal.relearnArrow", null, "🎯 Riapprendi tasto")}</button>
          <button class="im-del" data-im-remove-arrow="${idx}">✕</button>
        </div>
      `;
    });
    container.innerHTML = html;

    container.querySelectorAll("button[data-im-relearn-arrow]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const idx = parseInt(btn.getAttribute("data-im-relearn-arrow"), 10);
        const b = prefs.arrowKeyBindings[idx];
        if (b) startCalibration("arrow", idx, { direction: b.direction });
      });
    });
    container.querySelectorAll("button[data-im-remove-arrow]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const idx = parseInt(btn.getAttribute("data-im-remove-arrow"), 10);
        prefs.arrowKeyBindings.splice(idx, 1);
        savePrefs();
        renderArrowBindings();
      });
    });
  }

  // ════════════════════════════════════════════════════════════════════
  // TOOLBAR BUTTON BINDING
  // ════════════════════════════════════════════════════════════════════
  function bindToolbarButton() {
    const btn = document.getElementById("inputMappingToolbarBtn");
    if (!btn) return;
    if (btn.__imBound) return;
    btn.__imBound = true;
    btn.addEventListener("click", openModal);
  }

  // ════════════════════════════════════════════════════════════════════
  // ATTACH LISTENERS (sempre in CAPTURE su window)
  // ════════════════════════════════════════════════════════════════════
  function attachListeners() {
    window.addEventListener("mousedown", onMouseDownCapture, true);
    window.addEventListener("mouseup", onMouseUpCapture, true);
    window.addEventListener("auxclick", onAuxClickCapture, true);

    // Marca auxclick da sopprimere dopo un mousedown normale
    window.addEventListener(
      "mousedown",
      (e) => {
        if (e.button === 3 || e.button === 4) markAuxClickHandled();
      },
      true
    );

    window.addEventListener("keydown", onKeyDownCapture, true);

    window.addEventListener("blur", () => {
      STATE.heldButtons.clear();
      cancelPendingSingle();
    });
  }

  // ════════════════════════════════════════════════════════════════════
  // INIT
  // ════════════════════════════════════════════════════════════════════
  function init() {
    loadPrefs();
    attachListeners();
    bindToolbarButton();
    if (!prefs.enabled) {
      warn("⚠️ Mapping personalizzati DISATTIVATI in localStorage (prefs.enabled=false). Apri il modale e abilita il checkbox per attivarli.");
    }
    console.log("[InputMapping] modulo inizializzato — enabled=" + prefs.enabled + " shortcuts=" + prefs.keyboardShortcuts.length + " chords=" + prefs.chordMappings.length + " arrows=" + prefs.arrowKeyBindings.length);
  }

  // ════════════════════════════════════════════════════════════════════
  // ESPOSIZIONE GLOBALE
  // ════════════════════════════════════════════════════════════════════
  window.InputMapping = {
    init,
    openModal,
    closeModal,
    getPrefs: () => JSON.parse(JSON.stringify(prefs)),
    savePrefs,
    setEnabled: (b) => { prefs.enabled = !!b; savePrefs(); },
    listActions: () => Object.keys(ACTIONS).map((k) => ({ key: k, label: ACTIONS[k].label, icon: ACTIONS[k].icon })),
    executeAction,
    debug: (b) => { DEBUG = !!b; console.log("[InputMapping] DEBUG =", DEBUG); return DEBUG; },
    diagnose: () => {
      console.group("[InputMapping] Stato diagnostico");
      console.log("DEBUG:", DEBUG);
      console.log("prefs.enabled:", prefs.enabled);
      console.log("prefs.mouseButtonActions:", JSON.parse(JSON.stringify(prefs.mouseButtonActions)));
      console.log("prefs.chordMappings:", JSON.parse(JSON.stringify(prefs.chordMappings)));
      console.log("prefs.keyboardShortcuts:", JSON.parse(JSON.stringify(prefs.keyboardShortcuts)));
      console.log("prefs.arrowKeyBindings:", JSON.parse(JSON.stringify(prefs.arrowKeyBindings)));
      console.log("activeElement:", document.activeElement && document.activeElement.tagName, document.activeElement);
      console.log("isInputFocused():", isInputFocused());
      console.log("isCalibrating():", isCalibrating(), STATE.calibrationMode);
      console.log("STATE.heldButtons:", [...STATE.heldButtons]);
      console.groupEnd();
    }
  };

  // Auto-init
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => setTimeout(init, 60));
  } else {
    setTimeout(init, 60);
  }
})();