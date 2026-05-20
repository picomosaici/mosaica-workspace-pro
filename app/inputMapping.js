// inputMapping.js — Mosaica Desktop Pro
// =====================================================================
//  Sistema di mapping personalizzabile per mouse e tastiera.
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
//    save-project, open-project, deselect-all.
//
//  PERSISTENZA: localStorage "mosaica_input_mapping_settings"
//
//  COMPATIBILITÀ: Fabric ≥5.1.0 (non utilizza direttamente API di Fabric,
//  invoca solo le funzioni globali esposte da renderer.js e dagli altri
//  moduli — copySelected, paste, cutSelected, deleteSelected, zoomByFactor,
//  resetZoomAndPan, pushState, flashToast).
// =====================================================================

(function () {
  "use strict";

  // ════════════════════════════════════════════════════════════════════
  // STATO INTERNO
  // ════════════════════════════════════════════════════════════════════
  const STATE = {
    heldButtons: new Set(), // pulsanti mouse attualmente premuti
    pendingSingleTimer: null, // timer per il defer del single mapping (chord disambiguation)
    pendingSingleEvent: null,
    pendingSingleButton: null,
    capturedSingleButtonCode: null, // durante calibrazione button-single
    capturedChordButtons: null, // durante calibrazione chord (Set)
    chordCalibrationCommitTimer: null,
    capturedShortcut: null, // durante calibrazione keyboard
    calibrationMode: null, // null | "single" | "chord" | "shortcut"
    calibrationSlotIndex: null, // indice slot da scrivere
    calibrationTimeoutId: null,
    lastChordExecutedAt: 0, // ms timestamp ultima esecuzione chord (per evitare double-fire del single)
    lastChordButtons: null // Set ultima volta che un chord è scattato
  };

  // ════════════════════════════════════════════════════════════════════
  // AZIONI DISPONIBILI
  // ════════════════════════════════════════════════════════════════════
  // exec riceve l'evento originale (può essere usato per coordinate, target)
  const ACTIONS = {
    none: { label: "Nessuna azione", icon: "⊘", exec: () => {} },

    undo: {
      label: "Annulla (Undo)",
      icon: "↩️",
      exec: () => clickIfExists("undoBtn") || dispatchKey("z", { ctrlKey: true })
    },
    redo: {
      label: "Ripeti (Redo)",
      icon: "↪️",
      exec: () => clickIfExists("redoBtn") || dispatchKey("z", { ctrlKey: true, shiftKey: true })
    },

    copy: {
      label: "Copia",
      icon: "📋",
      exec: () => (typeof window.copySelected === "function" ? window.copySelected() : null)
    },
    paste: {
      label: "Incolla",
      icon: "📌",
      exec: () => (typeof window.paste === "function" ? window.paste() : null)
    },
    cut: {
      label: "Taglia",
      icon: "✂️",
      exec: () => (typeof window.cutSelected === "function" ? window.cutSelected() : null)
    },
    delete: {
      label: "Elimina selezione",
      icon: "🗑️",
      exec: () => (typeof window.deleteSelected === "function" ? window.deleteSelected() : null)
    },

    "zoom-in": {
      label: "Zoom in",
      icon: "🔍➕",
      exec: () => {
        if (typeof window.zoomByFactor === "function") {
          window.zoomByFactor(1.2, window.innerWidth / 2, window.innerHeight / 2);
        }
      }
    },
    "zoom-out": {
      label: "Zoom out",
      icon: "🔍➖",
      exec: () => {
        if (typeof window.zoomByFactor === "function") {
          window.zoomByFactor(1 / 1.2, window.innerWidth / 2, window.innerHeight / 2);
        }
      }
    },
    "zoom-reset": {
      label: "Reset zoom",
      icon: "🔍⤾",
      exec: () => {
        if (typeof window.resetZoomAndPan === "function") window.resetZoomAndPan();
      }
    },

    "toggle-lasso": { label: "Toggle Lazo", icon: "⭕", exec: () => clickIfExists("lassoSelectBtn") },
    "toggle-freehand": { label: "Toggle Penna", icon: "✏️", exec: () => clickIfExists("freehandBtn") },
    "toggle-watercolor": { label: "Toggle Acquerello", icon: "💧", exec: () => clickIfExists("watercolorBtn") },
    "toggle-eraser": { label: "Toggle Gomma", icon: "🧼", exec: () => clickIfExists("eraserBtn") },
    "toggle-select-tool": { label: "Strumento Selezione", icon: "🖱️", exec: () => clickIfExists("selectToolBtn") },

    "pan-canvas": {
      label: "Pan canvas (tieni premuto)",
      icon: "✋",
      exec: (e) => activateHoldPan(e)
    },

    "double-click": {
      label: "Doppio click",
      icon: "⚡",
      exec: (e) => simulateDoubleClickAt(e)
    },

    "save-project": { label: "Salva progetto", icon: "💾", exec: () => clickIfExists("saveProjectBtn") },
    "open-project": { label: "Apri progetto", icon: "📂", exec: () => clickIfExists("openProjectBtn") },

    "deselect-all": {
      label: "Deseleziona tutto",
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
      label: "Duplica selezione",
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
    // Mapping single button: chiave = "0"/"1"/"2"/"3"/"4" (button code)
    // Solo i tasti laterali sono mappati di default per coerenza con il
    // comportamento storico di Mosaica (sx=selezione, sx+drag=pan/draw,
    // dx=rotazione su forme).
    mouseButtonActions: {
      0: "none",
      1: "none",
      2: "none",
      3: "undo", // X1 / Browser Back
      4: "redo" // X2 / Browser Forward
    },
    // Combinazioni mouse: array di { id, buttons: [0,2], action: "..." }
    chordMappings: [],
    // Scorciatoie tastiera custom: array di
    //   { id, keys: { ctrl, shift, alt, meta, key }, action: "..." }
    keyboardShortcuts: [
      {
        id: "default-lasso",
        keys: { ctrl: true, shift: false, alt: false, meta: false, key: "l" },
        action: "toggle-lasso"
      }
    ],
    // Tempo (ms) di attesa prima di scatenare un single quando potrebbe
    // diventare un chord. 0 = scatta subito (può portare a "doppio fuoco":
    // prima il single, poi il chord). Default 80ms = compromesso responsivo.
    chordDelayMs: 80,
    // Se true: i mapping single sul button=2 (destro) NON si attivano quando
    // il puntatore è sopra una forma ruotabile (mouseObserver gestisce la
    // rotazione fine). Sulle aree vuote il mapping si attiva normalmente.
    preserveRotationOnShapes: true,
    // Se true: durante il drawing mode (Penna/Acquerello/Gomma) tutti i
    // mapping single mouse sono sospesi (sx serve a disegnare).
    suspendDuringDrawingMode: true
  };

  let prefs = JSON.parse(JSON.stringify(DEFAULT_PREFS));

  function loadPrefs() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const saved = JSON.parse(raw);
      // Merge difensivo
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
      console.warn("[InputMapping] loadPrefs fallito, uso defaults:", e);
      prefs = JSON.parse(JSON.stringify(DEFAULT_PREFS));
    }
  }

  function savePrefs() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
    } catch (e) {
      console.warn("[InputMapping] savePrefs fallito:", e);
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
    // Stesso pattern usato da wacomTablet.js per il tasto penna mappato a "pan"
    window.isAltPanning = true;
    if (typeof window.flashToast === "function") window.flashToast("✋ Pan canvas attivo");
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
      case 0:
        return "Sinistro";
      case 1:
        return "Centrale (rotella)";
      case 2:
        return "Destro";
      case 3:
        return "X1 (laterale Back)";
      case 4:
        return "X2 (laterale Forward)";
      default:
        return `Button ${code}`;
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

  // Verifica se il puntatore è sopra una forma ruotabile (delega a mouseObserver
  // sarebbe ideale, ma il modulo non espone helper: replichiamo la logica con
  // findTarget standard di Fabric, sufficiente per il 99% dei casi).
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

  function isInputFocused() {
    const t = document.activeElement;
    if (!t) return false;
    if (["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName)) return true;
    if (t.isContentEditable) return true;
    return false;
  }

  // Se il modale del modulo è aperto e siamo in calibrazione, blocchiamo
  // l'esecuzione dei mapping (non vogliamo che la pressione di tasti durante
  // la calibrazione esegua azioni).
  function isCalibrating() {
    return STATE.calibrationMode !== null;
  }

  // ════════════════════════════════════════════════════════════════════
  // EXEC ENGINE
  // ════════════════════════════════════════════════════════════════════
  function executeAction(actionKey, originatingEvent) {
    if (!actionKey || actionKey === "none") return;
    const action = ACTIONS[actionKey];
    if (!action || typeof action.exec !== "function") {
      console.warn("[InputMapping] azione sconosciuta:", actionKey);
      return;
    }
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
      const chordKey = chord.buttons
        .slice()
        .sort((a, b) => a - b)
        .join(",");
      if (chordKey === heldKey) return chord;
    }
    return null;
  }

  // ════════════════════════════════════════════════════════════════════
  // MOUSE EVENT HANDLERS
  // ════════════════════════════════════════════════════════════════════

  function onMouseDownCapture(e) {
    if (!prefs.enabled) return;
    if (isCalibrating()) {
      handleCalibrationMouseDown(e);
      return;
    }

    const btn = e.button;
    if (btn < 0) return;

    // Per X1/X2 (button 3/4) preveniamo il default per evitare la navigation
    // history di Electron quando c'è un mapping attivo.
    if ((btn === 3 || btn === 4) && hasAnyMappingForButton(btn)) {
      try {
        e.preventDefault();
      } catch (_) {}
    }

    // Aggiungi al set held
    STATE.heldButtons.add(btn);

    // ── 1) Match CHORD (priorità massima) ───────────────────────────────
    const chord = findChordMatch(STATE.heldButtons);
    if (chord) {
      // Annulla l'eventuale single pendente: vince il chord
      cancelPendingSingle();

      STATE.lastChordExecutedAt = Date.now();
      STATE.lastChordButtons = new Set(STATE.heldButtons);

      // Stop completo: blocca anche mouseObserver (importante per chord che
      // includono il button 2, altrimenti partirebbe la sessione di rotazione)
      try {
        e.preventDefault();
        e.stopPropagation();
        if (typeof e.stopImmediatePropagation === "function") e.stopImmediatePropagation();
      } catch (_) {}

      executeAction(chord.action, e);
      return;
    }

    // ── 2) Match SINGLE (se non è già un button parte di altro chord pendente) ──
    const singleAction = prefs.mouseButtonActions[String(btn)];
    if (!singleAction || singleAction === "none") return;

    // Filtri di sicurezza:
    //  • Drawing mode: il sinistro serve a disegnare → non eseguire single mapping su button 0
    if (prefs.suspendDuringDrawingMode && window.canvas && window.canvas.isDrawingMode && btn === 0) {
      return;
    }
    //  • Tasto destro su forma ruotabile → cedere a mouseObserver (rotazione fine)
    if (btn === 2 && prefs.preserveRotationOnShapes && pointerIsOverRotatableShape(e)) {
      return;
    }
    //  • Click su UI critica: lasciar passare normalmente (NON consumare evento)
    if (isClickOnUIControl(e)) return;

    // Defer per chord disambiguation: aspetta che eventualmente arrivino altri
    // tasti del chord. Se nel frattempo si forma un chord matchato, il
    // pendingSingle viene cancellato.
    if (prefs.chordDelayMs > 0 && chordCouldMatchWithMore(STATE.heldButtons)) {
      schedulePendingSingle(btn, singleAction, e);
    } else {
      // Per X1/X2 (browser back/forward) blocca il default browser
      if (btn === 3 || btn === 4) {
        try {
          e.preventDefault();
        } catch (_) {}
      }
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
    // Se rilasciamo tutto, resettiamo memoria last chord
    if (STATE.heldButtons.size === 0) {
      STATE.lastChordButtons = null;
    }
  }

  // Alcuni driver/sistemi sparano i tasti laterali SOLO come auxclick
  // (non come mousedown). Catturiamoli qui come fallback.
  function onAuxClickCapture(e) {
    if (!prefs.enabled) return;
    if (isCalibrating()) return;
    const btn = e.button;
    if (btn !== 3 && btn !== 4) return;
    // Se già gestito da onMouseDownCapture (mousedown ha sparato), heldButtons
    // ha già rilasciato il tasto: nessun mapping da eseguire qui. Eseguiamo
    // solo se nessun single è stato già fatto scattare in questo evento — per
    // pragmatismo, controlliamo se l'azione è mappata e la eseguiamo
    // SOLO se l'ultimo mousedown non è arrivato (heldButtons non ha mai
    // contenuto questo button durante questo ciclo).
    // Per evitare doppio fire, controlliamo che NON sia stato un mousedown→up
    // recente per questo button. Usiamo un flag temporaneo.
    if (STATE.auxClickSuppressUntil && Date.now() < STATE.auxClickSuppressUntil) return;
    const action = prefs.mouseButtonActions[String(btn)];
    if (!action || action === "none") return;

    try {
      e.preventDefault();
    } catch (_) {}
    executeAction(action, e);
  }

  // Suppressione auxclick subito dopo un mousedown del medesimo button:
  // alcuni sistemi sparano sia mousedown+mouseup sia auxclick.
  function markAuxClickHandled() {
    STATE.auxClickSuppressUntil = Date.now() + 80;
  }

  function chordCouldMatchWithMore(heldSet) {
    // C'è almeno un chord mappato i cui pulsanti includono TUTTI quelli held
    // e ne ha almeno uno in più? Se sì, conviene aspettare.
    for (const chord of prefs.chordMappings) {
      const chordSet = new Set(chord.buttons);
      if (chordSet.size <= heldSet.size) continue;
      let containsAll = true;
      for (const b of heldSet)
        if (!chordSet.has(b)) {
          containsAll = false;
          break;
        }
      if (containsAll) return true;
    }
    return false;
  }

  function schedulePendingSingle(button, action, originatingEvent) {
    cancelPendingSingle();
    STATE.pendingSingleButton = button;
    STATE.pendingSingleEvent = originatingEvent;
    STATE.pendingSingleTimer = setTimeout(() => {
      // Verifica che il tasto sia ancora premuto (o sia stato rilasciato senza
      // formare un chord) — il chord matching avviene già a ogni mousedown,
      // quindi qui possiamo fidarci e scatenare.
      if (button === 3 || button === 4) {
        try {
          originatingEvent.preventDefault && originatingEvent.preventDefault();
        } catch (_) {}
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
    // Stessa lista usata da renderer.js per il pan check (line 729+)
    return !!(
      (
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
      ) // il NOSTRO modale
    );
  }

  // ════════════════════════════════════════════════════════════════════
  // KEYBOARD EVENT HANDLER
  // ════════════════════════════════════════════════════════════════════
  function onKeyDownCapture(e) {
    if (!prefs.enabled) return;
    if (isCalibrating()) {
      handleCalibrationKeyDown(e);
      return;
    }
    if (isInputFocused()) return;

    // ── Caso speciale: BrowserBack / BrowserForward generati da mouse laterali
    // su alcuni driver Windows che li mappano a tastiera invece che a button 3/4.
    if (e.key === "BrowserBack" || e.code === "BrowserBack") {
      const a = prefs.mouseButtonActions["3"];
      if (a && a !== "none") {
        try {
          e.preventDefault();
          e.stopPropagation();
        } catch (_) {}
        executeAction(a, e);
        return;
      }
    }
    if (e.key === "BrowserForward" || e.code === "BrowserForward") {
      const a = prefs.mouseButtonActions["4"];
      if (a && a !== "none") {
        try {
          e.preventDefault();
          e.stopPropagation();
        } catch (_) {}
        executeAction(a, e);
        return;
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
      executeAction(match.action, e);
    }
  }

  function findShortcutMatch(e) {
    const key = (e.key || "").toLowerCase();
    if (!key) return null;
    // Modificatori non considerati come "tasto principale"
    if (["control", "shift", "alt", "meta", "os"].includes(key)) return null;
    // Ctrl e Cmd (meta) sono trattati come equivalenti: una scorciatoia
    // salvata come "ctrl+L" matcha sia Ctrl+L su Windows/Linux sia Cmd+L su macOS.
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
  function startCalibration(mode, slotIndex) {
    if (!["single", "chord", "shortcut"].includes(mode)) return;
    STATE.calibrationMode = mode;
    STATE.calibrationSlotIndex = slotIndex;
    STATE.capturedSingleButtonCode = null;
    STATE.capturedChordButtons = new Set();
    STATE.capturedShortcut = null;

    if (STATE.calibrationTimeoutId) clearTimeout(STATE.calibrationTimeoutId);
    STATE.calibrationTimeoutId = setTimeout(() => {
      cancelCalibration();
      if (typeof window.flashToast === "function") {
        window.flashToast("⏱️ Calibrazione scaduta (15s) — riprova");
      }
    }, 15000);

    updateCalibrationUI();
  }

  function cancelCalibration() {
    STATE.calibrationMode = null;
    STATE.calibrationSlotIndex = null;
    STATE.capturedSingleButtonCode = null;
    STATE.capturedChordButtons = new Set();
    STATE.capturedShortcut = null;
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
    // Blocca il click di calibrazione SOLO se NON è dentro al nostro modale
    // (clic sui bottoni del modale non devono essere intercettati come input
    // da calibrare).
    if (e.target && e.target.closest && e.target.closest("[data-im-modal]")) return;

    try {
      e.preventDefault();
      e.stopPropagation();
      if (typeof e.stopImmediatePropagation === "function") e.stopImmediatePropagation();
    } catch (_) {}

    if (STATE.calibrationMode === "single") {
      STATE.capturedSingleButtonCode = e.button;
      commitSingleCalibration();
    } else if (STATE.calibrationMode === "chord") {
      STATE.capturedChordButtons.add(e.button);
      // commit dopo breve idle: l'utente ha finito di premere tasti
      if (STATE.chordCalibrationCommitTimer) clearTimeout(STATE.chordCalibrationCommitTimer);
      STATE.chordCalibrationCommitTimer = setTimeout(() => {
        commitChordCalibration();
      }, 500);
      updateCalibrationUI();
    }
  }

  function handleCalibrationMouseUp(e) {
    if (e.target && e.target.closest && e.target.closest("[data-im-modal]")) return;
    try {
      e.preventDefault();
      e.stopPropagation();
      if (typeof e.stopImmediatePropagation === "function") e.stopImmediatePropagation();
    } catch (_) {}
    // Nessuna logica particolare: mouseup non aggiunge tasti al chord
  }

  function handleCalibrationKeyDown(e) {
    // Solo per la calibrazione di scorciatoie
    if (STATE.calibrationMode !== "shortcut") return;
    if (isInputFocused()) return;

    const key = (e.key || "").toLowerCase();
    if (["control", "shift", "alt", "meta", "os"].includes(key)) return; // solo modificatori

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
    commitShortcutCalibration();
  }

  function commitSingleCalibration() {
    const code = STATE.capturedSingleButtonCode;
    if (code == null) return cancelCalibration();
    const codeKey = String(code);
    // Garantisce che il codice rilevato sia presente nella mappa così l'utente
    // può assegnargli un'azione dal menù. Non sovrascriviamo se già presente.
    if (!(codeKey in prefs.mouseButtonActions)) {
      prefs.mouseButtonActions[codeKey] = "none";
    }
    savePrefs();
    if (typeof window.flashToast === "function") {
      window.flashToast(`🎯 Tasto rilevato: button code ${code} (${buttonName(code)}) — assegnagli un'azione dal menù`);
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
        window.flashToast("⚠️ Servono almeno 2 tasti per un chord");
      }
      cancelCalibration();
      return;
    }
    const slotIdx = STATE.calibrationSlotIndex; // indice in prefs.chordMappings ("new" per nuovo)
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
      window.flashToast(`✅ Combinazione registrata: ${buttonsToLabel(buttons)}`);
    }
    cancelCalibration();
    refreshModalUI();
  }

  function commitShortcutCalibration() {
    const s = STATE.capturedShortcut;
    const slotIdx = STATE.calibrationSlotIndex;
    if (!s) {
      cancelCalibration();
      return;
    }
    if (slotIdx === "new") {
      prefs.keyboardShortcuts.push({
        id: generateId(),
        keys: s,
        action: "none"
      });
    } else if (typeof slotIdx === "number" && prefs.keyboardShortcuts[slotIdx]) {
      prefs.keyboardShortcuts[slotIdx].keys = s;
    }
    savePrefs();
    if (typeof window.flashToast === "function") {
      window.flashToast(`✅ Scorciatoia registrata: ${shortcutToLabel(s)}`);
    }
    cancelCalibration();
    refreshModalUI();
  }

  function updateCalibrationUI() {
    const banner = document.getElementById("imCalibrationBanner");
    if (!banner) return;
    if (!STATE.calibrationMode) {
      banner.style.display = "none";
      banner.innerHTML = "";
      return;
    }
    banner.style.display = "block";
    let html = "";
    if (STATE.calibrationMode === "single") {
      html = `⏳ <b>Premi ora il tasto del mouse</b> che vuoi rilevare... <span style="color:#888">(timeout 15s — <a href="#" id="imCancelCalib">annulla</a>)</span>`;
    } else if (STATE.calibrationMode === "chord") {
      const captured = [...(STATE.capturedChordButtons || [])].sort();
      html = `⏳ <b>Premi simultaneamente i tasti del mouse</b> che formano la combinazione...<br/>
              <span style="color:#aaa;font-size:12px;">Rilevati finora: ${captured.length ? buttonsToLabel(captured) : "nessuno"} — rilascia per confermare (0.5s).</span>
              <span style="color:#888"> · <a href="#" id="imCancelCalib">annulla</a></span>`;
    } else if (STATE.calibrationMode === "shortcut") {
      html = `⏳ <b>Premi la combinazione di tasti</b> (modificatori + tasto)... <span style="color:#888">(timeout 15s — <a href="#" id="imCancelCalib">annulla</a>)</span>`;
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
          <h3 style="margin:0;font-size:17px">🖱️⌨️ Mappatura Mouse & Tastiera</h3>
          <button id="imCloseBtn" title="Chiudi"
                  style="background:none;border:none;color:#aaa;font-size:26px;cursor:pointer;line-height:1">×</button>
        </div>

        <!-- Banner calibrazione -->
        <div id="imCalibrationBanner" style="
          display:none;
          background:#3d2a00;
          border-left:3px solid #fbbf24;
          padding:10px 12px;
          border-radius:4px;
          font-size:13px;
          margin-bottom:14px;
          color:#fde68a;
        "></div>

        <!-- Toggle integrazione -->
        <label style="display:flex;align-items:center;gap:10px;margin-bottom:14px;padding:10px 12px;background:#2a2a2a;border-radius:8px;cursor:pointer">
          <input type="checkbox" id="imEnabledCheck" style="width:18px;height:18px;cursor:pointer"/>
          <span style="flex:1">
            <b>Abilita mapping personalizzati</b>
            <div style="font-size:11px;color:#aaa;margin-top:2px">
              Disattiva per tornare al comportamento standard (sx=selezione, dx=rotazione su forme)
            </div>
          </span>
        </label>

        <!-- ════════ SEZIONE TASTI SINGOLI ════════ -->
        <div style="background:#2a2a2a;border-radius:8px;padding:14px;margin-bottom:14px">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">
            <h4 style="margin:0;font-size:14px;color:#fbbf24">🖱️ Tasti singoli del mouse</h4>
            <button id="imLearnButton" class="im-secondary-btn">🎯 Rileva codice tasto</button>
          </div>
          <div style="font-size:11px;color:#aaa;margin-bottom:10px">
            I tasti laterali (X1/X2) sui mouse HP HSA-P007M, gaming e simili emettono
            di norma button code 3 (back) e 4 (forward). Mappali qui per evitare la navigazione
            del browser e usarli come scorciatoie a tua scelta.
          </div>
          <div id="imSingleButtonsList"></div>
        </div>

        <!-- ════════ SEZIONE CHORD ════════ -->
        <div style="background:#2a2a2a;border-radius:8px;padding:14px;margin-bottom:14px">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">
            <h4 style="margin:0;font-size:14px;color:#fbbf24">🤝 Combinazioni (chord) — più tasti mouse insieme</h4>
            <button id="imAddChord" class="im-secondary-btn">➕ Aggiungi combinazione</button>
          </div>
          <div style="font-size:11px;color:#aaa;margin-bottom:10px">
            Esempio: <b>Sinistro + Destro</b> per Annulla. Le combinazioni hanno priorità sui
            tasti singoli: se il chord si completa, l'azione del singolo non scatta.
          </div>
          <div id="imChordsList"></div>
        </div>

        <!-- ════════ SEZIONE SCORCIATOIE TASTIERA ════════ -->
        <div style="background:#2a2a2a;border-radius:8px;padding:14px;margin-bottom:14px">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">
            <h4 style="margin:0;font-size:14px;color:#fbbf24">⌨️ Scorciatoie tastiera personalizzate</h4>
            <button id="imAddShortcut" class="im-secondary-btn">➕ Aggiungi scorciatoia</button>
          </div>
          <div style="font-size:11px;color:#aaa;margin-bottom:10px">
            Esempio: <b>Ctrl+L</b> → Toggle Lazo. ⚠️ Le scorciatoie di base di Mosaica
            (Ctrl+Z/C/V/X, Delete, Ctrl+/-, Ctrl+R, frecce) sono protette: per sovrascriverle,
            assegnale qui — la tua versione avrà la precedenza.
            <br/>Premi <b>➕ Aggiungi scorciatoia</b> e premi la sequenza di tasti che vuoi aggiungere sulla tastiera.
          </div>
          <div id="imShortcutsList"></div>
        </div>

        <!-- ════════ OPZIONI AVANZATE ════════ -->
        <details style="background:#2a2a2a;border-radius:8px;padding:14px;margin-bottom:14px">
          <summary style="cursor:pointer;font-size:13px;color:#fbbf24;font-weight:600">⚙️ Opzioni avanzate</summary>
          <div style="margin-top:10px;display:flex;flex-direction:column;gap:10px">
            <label style="display:flex;align-items:center;gap:10px;font-size:12px">
              <span style="flex:1">Ritardo chord disambiguation (ms):
                <span id="imChordDelayVal" style="color:#4ade80;font-weight:600">80</span></span>
              <input type="range" id="imChordDelaySlider" min="0" max="300" step="10" style="width:180px"/>
            </label>
            <div style="font-size:11px;color:#888;margin-top:-4px">
              Quando un tasto premuto potrebbe far parte di una combinazione mappata,
              il suo mapping single attende N ms per dare tempo alla combinazione. 0 = scatta subito.
            </div>
            <label style="display:flex;align-items:center;gap:10px;font-size:12px">
              <input type="checkbox" id="imPreserveRotation" style="width:16px;height:16px"/>
              <span style="flex:1">
                <b>Preserva rotazione fine sul tasto destro</b>
                <div style="font-size:11px;color:#888">Il mapping del tasto destro non scatta sopra le forme (ruotabili).</div>
              </span>
            </label>
            <label style="display:flex;align-items:center;gap:10px;font-size:12px">
              <input type="checkbox" id="imSuspendDrawing" style="width:16px;height:16px"/>
              <span style="flex:1">
                <b>Sospendi in modalità disegno</b>
                <div style="font-size:11px;color:#888">Penna/Acquerello/Gomma: il tasto sinistro disegna, i mapping singoli sono sospesi.</div>
              </span>
            </label>
          </div>
        </details>

        <!-- Footer azioni -->
        <div style="display:flex;justify-content:space-between;gap:10px">
          <button id="imResetDefaults" class="im-secondary-btn">🔄 Ripristina default</button>
          <button id="imDone" style="
            background:#fbbf24;border:0;color:#000;padding:9px 18px;border-radius:6px;
            cursor:pointer;font-size:13px;font-weight:600;">Fatto</button>
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    // Stile pulsanti secondari (iniettato 1 volta)
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
    });
    document.getElementById("imResetDefaults").addEventListener("click", () => {
      if (!confirm("Ripristinare tutti i mapping ai valori di default?")) return;
      prefs = JSON.parse(JSON.stringify(DEFAULT_PREFS));
      savePrefs();
      refreshModalUI();
      if (typeof window.flashToast === "function") window.flashToast("🔄 Mapping ripristinati ai default");
    });
    document.getElementById("imLearnButton").addEventListener("click", () => {
      startCalibration("single", "learn:any");
    });
    document.getElementById("imAddChord").addEventListener("click", () => {
      if (typeof window.flashToast === "function") {
        window.flashToast('Premi "➕ Aggiungi combinazione" e premi simultaneamente i tasti del mouse che vuoi combinare.');
      }
      startCalibration("chord", "new");
    });
    document.getElementById("imAddShortcut").addEventListener("click", () => {
      if (typeof window.flashToast === "function") {
        window.flashToast('Premi "➕ Aggiungi scorciatoia" e premi la sequenza di tasti che vuoi aggiungere sulla tastiera.');
      }
      startCalibration("shortcut", "new");
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

    // Chiusura cliccando lo sfondo
    modal.addEventListener("click", (e) => {
      if (e.target === modal) closeModal();
    });
  }

  function openModal() {
    ensureModal();
    refreshModalUI();
    document.getElementById("inputMappingModal").style.display = "flex";
  }

  function closeModal() {
    cancelCalibration();
    const m = document.getElementById("inputMappingModal");
    if (m) m.style.display = "none";
  }

  function refreshModalUI() {
    if (!document.getElementById("inputMappingModal")) return;

    document.getElementById("imEnabledCheck").checked = prefs.enabled;
    document.getElementById("imChordDelaySlider").value = prefs.chordDelayMs;
    document.getElementById("imChordDelayVal").textContent = String(prefs.chordDelayMs);
    document.getElementById("imPreserveRotation").checked = prefs.preserveRotationOnShapes;
    document.getElementById("imSuspendDrawing").checked = prefs.suspendDuringDrawingMode;

    renderSingleButtons();
    renderChords();
    renderShortcuts();
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

    // Garantiamo le 5 righe standard (button 0..4) + eventuali codici "esotici"
    // imparati dall'utente.
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
      container.innerHTML = `<div style="color:#888;font-size:12px;font-style:italic;padding:8px 4px">Nessuna combinazione configurata. Premi "➕ Aggiungi combinazione" e premi i tasti del mouse insieme.</div>`;
      return;
    }

    let html = "";
    prefs.chordMappings.forEach((c, idx) => {
      html += `
        <div class="im-row">
          <span class="im-label">${escapeHTML(buttonsToLabel(c.buttons))}</span>
          <select data-im-chord-idx="${idx}">${actionsDropdownHTML(c.action)}</select>
          <button class="im-relearn" data-im-relearn-chord="${idx}">🎯 Riapprendi</button>
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
      container.innerHTML = `<div style="color:#888;font-size:12px;font-style:italic;padding:8px 4px">Nessuna scorciatoia personalizzata. Premi "➕ Aggiungi scorciatoia" e digita la combinazione (es. Ctrl+L).</div>`;
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
    // Mouse — capture su window per battere mouseObserver
    window.addEventListener("mousedown", onMouseDownCapture, true);
    window.addEventListener("mouseup", onMouseUpCapture, true);

    // auxclick fallback per X1/X2 su driver che non emettono mousedown
    window.addEventListener("auxclick", onAuxClickCapture, true);

    // Marca auxclick da sopprimere dopo un mousedown normale
    window.addEventListener(
      "mousedown",
      (e) => {
        if (e.button === 3 || e.button === 4) markAuxClickHandled();
      },
      true
    );

    // Tastiera — capture su window per battere keyboardShortcuts.js (su document)
    window.addEventListener("keydown", onKeyDownCapture, true);

    // Reset stato al blur della finestra
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
    console.log("[InputMapping] modulo inizializzato — prefs:", prefs);
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
    setEnabled: (b) => {
      prefs.enabled = !!b;
      savePrefs();
    },
    listActions: () => Object.keys(ACTIONS).map((k) => ({ key: k, label: ACTIONS[k].label, icon: ACTIONS[k].icon })),
    executeAction
  };

  // Auto-init
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => setTimeout(init, 60));
  } else {
    setTimeout(init, 60);
  }
})();