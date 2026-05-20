// ============================================================
//  autoSave.js — Mosaica Workspace Pro
// ------------------------------------------------------------
//  Modulo di auto-salvataggio. Funziona in due modalità:
//
//   1) PROGETTO APERTO (currentProjectPath valorizzato, tipicamente
//      arrivato via tryAutoOpen): l'autosave sovrascrive in-place il
//      file originale ovunque si trovi (HDD, USB, SD card, ecc.).
//
//   2) NUOVO PROGETTO (currentProjectPath null): l'autosave crea/
//      sovrascrive UN file "di sessione" in:
//        %APPDATA%\mosaica-workspace-pro\projects\
//      Nome con data+ora di inizio sessione (formato italiano), es:
//        "1 Aprile 2026 - 15:00.msp.json"
//      Vengono tenuti al massimo gli ULTIMI 10 file di sessione
//      (pruning automatico).
//
//  EVENTI:
//   • Timer periodico (60s di default) → solo se il canvas è "dirty".
//   • Chiusura finestra (X / Alt+F4): il main intercetta il "close",
//     emette "autosave:close-requested" → il renderer mostra un
//     overlay informativo, fa l'autosave, comunica al main il path
//     salvato, e dopo un breve countdown (o click "Esci ora") chiude.
//
//  UI:
//   • Badge "💾 Auto-salvataggio in corso…" nella status bar durante
//     i salvataggi periodici, poi "✔ Auto-salvato" verde per ~2s.
//   • Overlay full-screen alla chiusura con icona, titolo, path,
//     spinner, countdown e i due bottoni "Esci ora" / "Annulla
//     chiusura".
//
//  ANTI-LOOP:
//   • Durante la serializzazione il background viene rimosso/
//     riaggiunto al canvas (replica della logica del bottone Salva).
//     Il flag `serializing` blocca markDirty() in quella finestra.
//
//  Caricato come <script> in index.html DOPO renderer.js (perché
//  usa canvas, currentProjectPath, backgroundMeta, ecc. dichiarati
//  lì) e DOPO saveLoader.js per coerenza visiva (l'overlay di
//  autoSave si sovrappone sopra eventuali loader).
// ============================================================

(function () {
  "use strict";

  if (window.__autoSaveInitialized) return;
  window.__autoSaveInitialized = true;

  // ───────────────────────────────────────────────────────────
  //  CONFIG
  // ───────────────────────────────────────────────────────────
  const AUTOSAVE_INTERVAL_MS = 60 * 1000; // 1 minuto
  const MIN_GAP_BETWEEN_SAVES_MS = 5000; // anti-spam
  const STATUS_DONE_VISIBLE_MS = 2000; // quanto resta "✔ Auto-salvato"
  const CLOSE_COUNTDOWN_S = 4; // chiusura automatica dopo n s
  const MAX_SESSION_FILES = 10; // tenuti su disco (gestito dal main)

  // Nomi mesi in italiano per il nome-file richiesto
  const MESI_IT = [
    "Gennaio",
    "Febbraio",
    "Marzo",
    "Aprile",
    "Maggio",
    "Giugno",
    "Luglio",
    "Agosto",
    "Settembre",
    "Ottobre",
    "Novembre",
    "Dicembre"
  ];

  // ───────────────────────────────────────────────────────────
  //  STATO
  // ───────────────────────────────────────────────────────────
  const sessionStartDate = new Date();
  let sessionFileName = null; // nome del file di sessione (popolato dopo il primo write riuscito)
  let dirty = false; // canvas modificato dall'ultimo save?
  let saving = false; // un'operazione di save è in corso?
  let serializing = false; // siamo dentro serializeProject()?
  let lastSaveTime = 0;
  let intervalId = null;
  let isClosing = false; // chiusura in corso (overlay aperto)
  let closeCountdownTimer = null;

  // ───────────────────────────────────────────────────────────
  //  UTILITY
  // ───────────────────────────────────────────────────────────
  function pad2(n) {
    return n < 10 ? "0" + n : "" + n;
  }

  function buildSessionFileName(date) {
    const d = date.getDate();
    const m = MESI_IT[date.getMonth()];
    const y = date.getFullYear();
    const h = pad2(date.getHours());
    const min = pad2(date.getMinutes());
    // NB: usiamo "&" come separatore (es. "15&30") perché ":" è illegale
    // nei nomi file su Windows (riservato per gli Alternate Data Streams):
    // causerebbe troncamento del nome e file da 0 KB.
    return `${d} ${m} ${y} - ${h}&${min}.msp.json`;
  }

  // Accessor difensivi: leggono le globali di renderer.js (script-scope)
  // restituendo null se per qualche ragione la variabile non esiste ancora.
  function getCanvas() {
    try {
      return canvas;
    } catch (_) {
      return null;
    }
  }
  function getProjectPath() {
    try {
      return currentProjectPath;
    } catch (_) {
      return null;
    }
  }
  function getRestoring() {
    try {
      return !!isRestoringProject;
    } catch (_) {
      return false;
    }
  }
  function getBgMeta() {
    try {
      return backgroundMeta;
    } catch (_) {
      return null;
    }
  }
  function getBgObj() {
    try {
      return backgroundImageObject;
    } catch (_) {
      return null;
    }
  }
  function getFreehandSet() {
    try {
      return freehandPersistentSettings;
    } catch (_) {
      return null;
    }
  }
  function getPx2mm() {
    try {
      return typeof px2mm === "function" ? px2mm : null;
    } catch (_) {
      return null;
    }
  }

  // ───────────────────────────────────────────────────────────
  //  SERIALIZZAZIONE PROGETTO
  //  (replica fedele della logica di saveProjectBtn in renderer.js)
  // ───────────────────────────────────────────────────────────
  function serializeProject() {
    const c = getCanvas();
    if (!c) return null;

    serializing = true;
    try {
      // 1. Bake metadati forme (triangoli / trapezoidi)
      c.getObjects().forEach((o) => {
        if (o.__shapeType === "triangle") {
          if (o.type === "polygon" && typeof bakeTriangleScaleIntoPoints === "function") {
            try {
              bakeTriangleScaleIntoPoints(o);
            } catch (_) {}
          }
          if (!o.__shape || !Array.isArray(o.__shape.angles)) {
            const bbox = o.getBoundingRect(true);
            const _px2mm = getPx2mm();
            o.__shape = o.__shape || {};
            o.__shape.type = "triangle";
            o.__shape.angles = o.__shape.angles || [60, 60];
            o.__shape.base_mm = o.__shape.base_mm || (_px2mm ? _px2mm(bbox.width) : bbox.width);
          }
        }
        if (o.__shapeType === "trapezoid") {
          if (o.type === "polygon" && typeof bakeTrapezoidScaleIntoPoints === "function") {
            try {
              bakeTrapezoidScaleIntoPoints(o);
            } catch (_) {}
          }
          const bbox = o.getBoundingRect(true);
          const _px2mm = getPx2mm();
          o.__shape = o.__shape || {};
          o.__shape.type = "trapezoid";
          if (typeof o.__shape.top_mm !== "number")
            o.__shape.top_mm = _px2mm ? _px2mm(Math.max(4, bbox.width * 0.5)) : bbox.width * 0.5;
          if (typeof o.__shape.bottom_mm !== "number")
            o.__shape.bottom_mm = _px2mm ? _px2mm(Math.max(4, bbox.width)) : bbox.width;
          if (typeof o.__shape.height_mm !== "number")
            o.__shape.height_mm = _px2mm ? _px2mm(Math.max(4, bbox.height)) : bbox.height;
          if (typeof o.__shape.offset_mm !== "number") o.__shape.offset_mm = 0;
        }
      });

      // 2. Pattern bitmap → __textureDataURL (per la riapertura)
      c.getObjects().forEach((o) => {
        if (o.fill && o.fill.source) {
          try {
            const tmp = document.createElement("canvas");
            tmp.width = o.fill.source.width || 100;
            tmp.height = o.fill.source.height || 100;
            tmp.getContext("2d").drawImage(o.fill.source, 0, 0);
            o.__textureDataURL = tmp.toDataURL("image/png");
          } catch (_) {
            /* cross-origin: skip */
          }
        }
      });

      // 3. Rimuovi temporaneamente lo sfondo dal canvas per la serializzazione
      const bgObj = getBgObj();
      let tempBackground = null;
      if (bgObj) {
        tempBackground = bgObj;
        c.remove(tempBackground);
      }

      const bgMeta = getBgMeta();
      const backgroundData = bgMeta
        ? {
            dataURL: bgMeta.dataURL,
            filename: bgMeta.filename,
            fit: bgMeta.fit,
            rotation: bgMeta.rotation
          }
        : null;

      // 4. Blocca tracciati freehand prima di serializzare
      if (typeof lockAllFreehandPaths === "function") {
        try {
          lockAllFreehandPaths();
        } catch (_) {}
      }

      // 5. Costruzione payload finale
      const projectData = {
        canvas: c.toJSON([
          "__shape",
          "data",
          "__isFreehand",
          "__isBackground",
          "__isWatercolor",
          "__watercolorParams",
          "__addedAt",
          "__shapeType",
          "customId",
          "__textureDataURL",
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
        freehandSettings: getFreehandSet(),
        backgroundMeta: backgroundData
      };

      // 6. Ripristina sfondo nel canvas (stato visivo invariato)
      if (tempBackground) {
        c.add(tempBackground);
        c.sendToBack(tempBackground);
      }

      return JSON.stringify(projectData);
    } finally {
      serializing = false;
    }
  }

  // ───────────────────────────────────────────────────────────
  //  AUTOSAVE PERIODICO
  // ───────────────────────────────────────────────────────────
  async function doPeriodicSave(force = false) {
    if (saving || isClosing) return;
    if (!getCanvas()) return;
    if (!force && !dirty) return;

    const now = Date.now();
    if (!force && now - lastSaveTime < MIN_GAP_BETWEEN_SAVES_MS) return;

    saving = true;
    showStatusBadge("salvataggio");

    try {
      const content = serializeProject();
      if (!content) {
        hideStatusBadge();
        return;
      }

      const projectPath = getProjectPath();
      let result;

      if (projectPath) {
        // Progetto già su disco → sovrascrive in-place (HDD / USB / SD)
        result = await window.autoSaveAPI.writeToPath(projectPath, content);
      } else {
        // Nuovo progetto → file di sessione in userData/projects/
        result = await window.autoSaveAPI.writeSession(sessionStartDate.getTime(), content);
        if (result && result.filename) {
          sessionFileName = result.filename;
          // Mantieni solo gli ultimi MAX_SESSION_FILES, escluso quello corrente
          window.autoSaveAPI.pruneSessions(sessionFileName).catch(() => {});
        }
      }

      if (result && result.error) {
        throw new Error(result.error);
      }

      lastSaveTime = Date.now();
      dirty = false;
      showStatusBadge("salvato");
      setTimeout(hideStatusBadge, STATUS_DONE_VISIBLE_MS);
    } catch (e) {
      console.error("[autoSave] Errore salvataggio periodico:", e);
      showStatusBadge("errore", e && e.message);
      setTimeout(hideStatusBadge, 2500);
    } finally {
      saving = false;
    }
  }

  // ───────────────────────────────────────────────────────────
  //  AUTOSAVE ALLA CHIUSURA
  // ───────────────────────────────────────────────────────────
  async function doCloseSave() {
    if (isClosing) return;
    isClosing = true;

    showCloseOverlay({
      title: "Salvataggio in corso…",
      detail: "Salvataggio automatico prima della chiusura.",
      pathOrMsg: "",
      busy: true
    });

    try {
      const content = serializeProject();
      if (!content) {
        showCloseOverlay({
          title: "Nessun progetto da salvare",
          detail: "Mosaica si chiuderà tra poco.",
          pathOrMsg: "",
          busy: false
        });
        startCloseCountdown(2);
        return;
      }

      const projectPath = getProjectPath();
      let savedPath = null;

      if (projectPath) {
        const r = await window.autoSaveAPI.writeToPath(projectPath, content);
        if (r && r.error) throw new Error(r.error);
        savedPath = (r && r.path) || projectPath;
      } else {
        const r = await window.autoSaveAPI.writeSession(sessionStartDate.getTime(), content);
        if (r && r.error) throw new Error(r.error);
        savedPath = (r && r.path) || null;
        if (r && r.filename) {
          sessionFileName = r.filename;
          window.autoSaveAPI.pruneSessions(sessionFileName).catch(() => {});
        }
      }

      showCloseOverlay({
        title: "Progetto salvato ✔",
        detail: projectPath
          ? "Il progetto è stato sovrascritto al percorso originale."
          : "Salvataggio di ripristino creato automaticamente.",
        pathOrMsg: savedPath || "",
        busy: false
      });
      startCloseCountdown(CLOSE_COUNTDOWN_S);
    } catch (e) {
      console.error("[autoSave] Errore salvataggio di chiusura:", e);
      showCloseOverlay({
        title: "Errore di salvataggio",
        detail: "Non è stato possibile completare l'auto-salvataggio:",
        pathOrMsg: String((e && e.message) || e),
        busy: false
      });
      startCloseCountdown(CLOSE_COUNTDOWN_S + 1);
    }
  }

  // ───────────────────────────────────────────────────────────
  //  HOOK SUL CANVAS PER TRACCIARE LE MODIFICHE
  // ───────────────────────────────────────────────────────────
  function installCanvasHooks(retry = 0) {
    const c = getCanvas();
    if (!c) {
      if (retry < 50) setTimeout(() => installCanvasHooks(retry + 1), 200);
      else console.warn("[autoSave] canvas non disponibile dopo 50 tentativi");
      return;
    }
    const markDirty = () => {
      if (serializing) return; // ignora i nostri remove/add temporanei
      if (getRestoring()) return; // ignora il loadFromJSON in corso
      dirty = true;
    };
    c.on("object:added", markDirty);
    c.on("object:modified", markDirty);
    c.on("object:removed", markDirty);
    c.on("path:created", markDirty);
    console.log("[autoSave] Hook canvas installati ✔");
  }

  // ───────────────────────────────────────────────────────────
  //  UI — BADGE NELLA STATUS BAR
  // ───────────────────────────────────────────────────────────
  function showStatusBadge(state, extraMsg) {
    const badge = document.getElementById("statusAutoSave");
    if (!badge) return;
    badge.style.display = "inline-flex";
    badge.className = "status-item auto-save-badge state-" + state;
    let txt;
    if (state === "salvataggio") txt = "💾 Auto-salvataggio in corso…";
    else if (state === "salvato") txt = "✔ Auto-salvato";
    else txt = "⚠ Errore auto-salvataggio" + (extraMsg ? ": " + extraMsg : "");
    badge.innerHTML = `<span class="value">${txt}</span>`;
  }

  function hideStatusBadge() {
    const badge = document.getElementById("statusAutoSave");
    if (badge) badge.style.display = "none";
  }

  // ───────────────────────────────────────────────────────────
  //  UI — OVERLAY DI CHIUSURA
  // ───────────────────────────────────────────────────────────
  function ensureCloseOverlay() {
    let o = document.getElementById("autoSaveCloseOverlay");
    if (o) return o;

    o = document.createElement("div");
    o.id = "autoSaveCloseOverlay";
    o.innerHTML = `
      <div class="autoSaveCloseInner" role="dialog" aria-modal="true" aria-labelledby="autoSaveCloseTitle">
        <div class="autoSaveCloseLogo"><span class="autoSaveCloseEmoji">💾</span></div>
        <div class="autoSaveCloseTitle" id="autoSaveCloseTitle">Salvataggio in corso…</div>
        <div class="autoSaveCloseDetail" id="autoSaveCloseDetail"></div>
        <div class="autoSaveClosePath" id="autoSaveClosePath"></div>
        <div class="autoSaveCloseSpinner" id="autoSaveCloseSpinner"></div>
        <div class="autoSaveCloseActions">
          <button class="autoSaveBtn cancel" id="autoSaveCancelCloseBtn" style="display:none;">
            Annulla chiusura
          </button>
          <button class="autoSaveBtn primary" id="autoSaveCloseNowBtn" style="display:none;">
            Esci ora (<span id="autoSaveCloseCountdown">${CLOSE_COUNTDOWN_S}</span>s)
          </button>
        </div>
      </div>
    `;
    document.body.appendChild(o);

    o.querySelector("#autoSaveCloseNowBtn").addEventListener("click", () => {
      requestNativeClose();
    });
    o.querySelector("#autoSaveCancelCloseBtn").addEventListener("click", () => {
      cancelClose();
    });

    return o;
  }

  function showCloseOverlay({ title, detail, pathOrMsg, busy }) {
    const o = ensureCloseOverlay();
    o.style.display = "flex";
    requestAnimationFrame(() => o.classList.add("visible"));

    o.querySelector("#autoSaveCloseTitle").textContent = title || "";
    o.querySelector("#autoSaveCloseDetail").textContent = detail || "";
    o.querySelector("#autoSaveClosePath").textContent = pathOrMsg || "";
    o.querySelector("#autoSaveCloseSpinner").style.display = busy ? "block" : "none";
    o.querySelector("#autoSaveCloseNowBtn").style.display = busy ? "none" : "inline-block";
    o.querySelector("#autoSaveCancelCloseBtn").style.display = busy ? "none" : "inline-block";
  }

  function hideCloseOverlay() {
    const o = document.getElementById("autoSaveCloseOverlay");
    if (!o) return;
    o.classList.remove("visible");
    setTimeout(() => {
      o.style.display = "none";
    }, 250);
  }

  function startCloseCountdown(seconds) {
    if (closeCountdownTimer) {
      clearInterval(closeCountdownTimer);
      closeCountdownTimer = null;
    }
    const cdEl = document.getElementById("autoSaveCloseCountdown");
    let n = seconds;
    if (cdEl) cdEl.textContent = n;
    closeCountdownTimer = setInterval(() => {
      n--;
      if (cdEl) cdEl.textContent = n;
      if (n <= 0) {
        clearInterval(closeCountdownTimer);
        closeCountdownTimer = null;
        requestNativeClose();
      }
    }, 1000);
  }

  function cancelClose() {
    if (closeCountdownTimer) {
      clearInterval(closeCountdownTimer);
      closeCountdownTimer = null;
    }
    hideCloseOverlay();
    isClosing = false;
    // Avvisa il main: niente chiusura, l'utente è rimasto
    try {
      window.autoSaveAPI && window.autoSaveAPI.abortClose();
    } catch (_) {}
  }

  function requestNativeClose() {
    try {
      window.autoSaveAPI && window.autoSaveAPI.confirmClose();
    } catch (e) {
      console.error("[autoSave] confirmClose fallita:", e);
    }
  }

  // ───────────────────────────────────────────────────────────
  //  STILI CSS (badge + overlay)
  // ───────────────────────────────────────────────────────────
  function injectStyles() {
    if (document.getElementById("autoSaveStyles")) return;
    const s = document.createElement("style");
    s.id = "autoSaveStyles";
    s.textContent = `
      /* ─── Badge nella status bar ─── */
      #statusAutoSave {
        display: none;
        margin-left: auto;        /* spinge a destra, e statusCalib gli si aggancia */
        color: #ffd166;
        font-weight: 500;
        font-size: 11px;
        text-transform: none;
        letter-spacing: 0;
        transition: color 250ms ease;
        padding-left: 14px;
        border-left: 1px solid var(--col-border, #2a3245);
      }
      #statusAutoSave.state-salvato  { color: #06d6a0; }
      #statusAutoSave.state-errore   { color: #ff6b6b; }
      #statusAutoSave .value          { color: inherit; }

      /* ─── Overlay di chiusura ─── */
      #autoSaveCloseOverlay {
        position: fixed; inset: 0;
        background: linear-gradient(180deg, rgba(11,18,32,0.94) 0%, rgba(20,32,58,0.94) 100%);
        z-index: 30000;
        display: none;
        align-items: center;
        justify-content: center;
        opacity: 0;
        transition: opacity 250ms ease;
        backdrop-filter: blur(4px);
      }
      #autoSaveCloseOverlay.visible { opacity: 1; }

      .autoSaveCloseInner {
        background: #161f33;
        border: 1px solid rgba(255,255,255,0.08);
        border-radius: 14px;
        padding: 34px 42px;
        max-width: 640px;
        min-width: 360px;
        text-align: center;
        color: #e8eef8;
        box-shadow: 0 24px 60px rgba(0,0,0,0.55);
        font-family: inherit;
      }
      .autoSaveCloseLogo {
        width: 72px; height: 72px;
        border-radius: 50%;
        background: rgba(255,255,255,0.06);
        margin: 0 auto 18px;
        display: flex; align-items: center; justify-content: center;
      }
      .autoSaveCloseEmoji {
        font-size: 38px; line-height: 1;
        filter: drop-shadow(0 4px 10px rgba(0,0,0,0.5));
      }
      .autoSaveCloseTitle {
        font-size: 19px;
        font-weight: 600;
        margin-bottom: 8px;
        color: #fff;
      }
      .autoSaveCloseDetail {
        font-size: 13px;
        color: #a8b3c7;
        margin-bottom: 12px;
        line-height: 1.45;
      }
      .autoSaveClosePath {
        font-family: 'Consolas','Courier New', monospace;
        font-size: 12px;
        color: #ffd166;
        background: rgba(0,0,0,0.3);
        padding: 10px 14px;
        border-radius: 6px;
        margin: 12px 0 4px;
        word-break: break-all;
        user-select: text;
        text-align: left;
      }
      .autoSaveClosePath:empty { display: none; }
      .autoSaveCloseSpinner {
        width: 32px; height: 32px;
        border: 3px solid rgba(255,255,255,0.15);
        border-top-color: #ffd166;
        border-radius: 50%;
        margin: 18px auto 4px;
        animation: autoSaveSpin 0.9s linear infinite;
        display: none;
      }
      @keyframes autoSaveSpin { to { transform: rotate(360deg); } }
      .autoSaveCloseActions {
        margin-top: 20px;
        display: flex;
        gap: 10px;
        justify-content: center;
        flex-wrap: wrap;
      }
      .autoSaveBtn {
        border: none;
        padding: 10px 18px;
        border-radius: 8px;
        font-size: 14px;
        font-weight: 500;
        cursor: pointer;
        transition: background 200ms ease, transform 100ms ease;
        font-family: inherit;
      }
      .autoSaveBtn.primary  { background: #4a90e2; color: #fff; }
      .autoSaveBtn.primary:hover  { background: #5aa0f2; }
      .autoSaveBtn.cancel   { background: rgba(255,255,255,0.08); color: #e8eef8; }
      .autoSaveBtn.cancel:hover   { background: rgba(255,255,255,0.14); }
      .autoSaveBtn:active   { transform: translateY(1px); }
    `;
    document.head.appendChild(s);
  }

  // ───────────────────────────────────────────────────────────
  //  INIT
  // ───────────────────────────────────────────────────────────
  function init() {
    injectStyles();
    installCanvasHooks();

    // Timer periodico — gira sempre, ma salva solo se "dirty"
    intervalId = setInterval(() => {
      doPeriodicSave(false);
    }, AUTOSAVE_INTERVAL_MS);

    // Ascolto richiesta di chiusura dal main process
    if (window.autoSaveAPI && typeof window.autoSaveAPI.onCloseRequested === "function") {
      window.autoSaveAPI.onCloseRequested(() => {
        doCloseSave();
      });
    } else {
      console.warn("[autoSave] window.autoSaveAPI non disponibile — verifica preload.js");
    }

    // API pubblica (debug + uso programmatico)
    window.autoSave = {
      triggerSave: () => doPeriodicSave(true),
      triggerCloseSave: doCloseSave,
      cancelCloseDialog: cancelClose,
      getState: () => ({
        dirty,
        saving,
        isClosing,
        sessionStartDate: sessionStartDate.toISOString(),
        sessionFileName,
        lastSaveTime: lastSaveTime ? new Date(lastSaveTime).toISOString() : null,
        currentProjectPath: getProjectPath()
      }),
      markDirty: () => {
        dirty = true;
      }
    };

    console.log("[autoSave] Modulo caricato ✔  sessione:", buildSessionFileName(sessionStartDate));
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
