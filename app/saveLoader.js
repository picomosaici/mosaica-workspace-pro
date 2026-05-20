// ============================================================
//  saveLoader.js — Mosaica Workspace Pro
// ------------------------------------------------------------
//  Loader di salvataggio con barra di avanzamento basata sul
//  tempo reale trascorso e sulla dimensione del payload.
//
//  Intercetta TUTTI i salvataggi/export di Mosaica Desktop Pro:
//    • Salva progetto       (projectAPI.saveProject)
//    • Esporta PDF A4       (desktopAPI.exportPDFImage)
//    • Esporta PNG completo (desktopAPI.exportFullPNG)
//    • Esporta SVG forme    (desktopAPI.exportShapesSVG)
//    • Esporta Freehand     (desktopAPI.exportFreehand)
//
//  Funzionamento:
//   1. In CAPTURE phase ascolta il click sui bottoni che
//      avviano un salvataggio (saveProjectBtn + i 3 confirm
//      dei modali). Mostra subito il loader → copre anche la
//      fase di rendering nel renderer (canvas.toDataURL,
//      toSVG, toJSON) che precede la chiamata IPC.
//   2. Wrappa le 5 funzioni IPC esposte dal preload. Quando
//      l'IPC viene invocata passa alla fase "scrittura su
//      disco" usando una costante di tempo tau calcolata sulla
//      dimensione del payload (MB).
//   3. La percentuale converge in modo asintotico verso il
//      95% del peso della fase corrente, in base al tempo
//      effettivamente trascorso. Al ritorno dell'IPC salta a
//      100% (o mostra "annullato"/"errore").
//
//  Stile e posizione: replica la card del loader di avvio
//  (#appLoader → .appLoader-inner, .progressBar, ecc.). Il
//  container è creato dinamicamente con id #saveLoader.
//
//  Caricato come <script> in index.html DOPO renderer.js
//  e DOPO svgExport.js (vedi tag </body>).
// ============================================================

(function () {
    "use strict";

    if (window.__saveLoaderInitialized) return;
    window.__saveLoaderInitialized = true;

    // ──────────────────────────────────────────────────────────────────
    //  COSTANTI
    // ──────────────────────────────────────────────────────────────────
    const WATCHDOG_MS = 90000; // se l'IPC non viene mai chiamata, chiudi loader dopo 90s
    const FINAL_DELAY_MS = 600; // pausa visiva al 100% prima di nascondere
    const ERR_DELAY_MS = 1400; // pausa visiva su errore
    const CANCEL_DELAY_MS = 700; // pausa visiva su annullato

    // ──────────────────────────────────────────────────────────────────
    //  STILI
    //  Il container #saveLoader replica gli stili di #appLoader
    //  (sfondo gradient + center). Le classi interne (.appLoader-inner,
    //  .progressBar, .progressFill, .progressInfo, .loaderNote, .title,
    //  .subtitle, .flag, .logo-circle) sono già definite in index.html
    //  e vengono riutilizzate così com'è.
    // ──────────────────────────────────────────────────────────────────
    function injectStyles() {
        if (document.getElementById("saveLoaderStyles")) return;
        const style = document.createElement("style");
        style.id = "saveLoaderStyles";
        style.textContent = `
      #saveLoader {
        position: fixed;
        inset: 0;
        display: flex;
        align-items: center;
        justify-content: center;
        background: linear-gradient(180deg, rgba(11, 18, 32, 0.92) 0%, rgba(20, 32, 58, 0.92) 100%);
        z-index: 25000;
        pointer-events: all;
        opacity: 0;
        visibility: hidden;
        transition: opacity 280ms ease, visibility 280ms ease;
        backdrop-filter: blur(3px);
      }
      #saveLoader[aria-hidden="false"] {
        opacity: 1;
        visibility: visible;
      }
      #saveLoader .save-emoji {
        font-size: 38px;
        line-height: 1;
        filter: drop-shadow(0 4px 10px rgba(0, 0, 0, 0.5));
      }
    `;
        document.head.appendChild(style);
    }

    // ──────────────────────────────────────────────────────────────────
    //  DOM
    // ──────────────────────────────────────────────────────────────────
    let rootEl, fillEl, pctEl, etaEl, titleEl, subtitleEl, noteEl, flagEl;

    function buildDOM() {
        if (document.getElementById("saveLoader")) return;

        rootEl = document.createElement("div");
        rootEl.id = "saveLoader";
        rootEl.setAttribute("aria-hidden", "true");
        rootEl.innerHTML = `
      <div class="appLoader-inner">
        <div class="appLoader-logo" role="img" aria-label="Salvataggio in corso">
          <div class="logo-circle"><span class="save-emoji">💾</span></div>
        </div>
        <div class="appLoader-text">
          <div class="title" id="saveLoaderTitle">Salvataggio in corso</div>
          <div class="subtitle" id="saveLoaderSubtitle">Preparazione…</div>
          <div class="flag" id="saveLoaderFlag">📁</div>
        </div>
        <div class="progressWrap">
          <div class="progressBar"><div class="progressFill" id="saveLoaderFill"></div></div>
          <div class="progressInfo">
            <div id="saveLoaderPercent">0%</div>
            <div id="saveLoaderETA">⌛ —</div>
          </div>
        </div>
        <div class="loaderNote" id="saveLoaderNote">Non chiudere l'applicazione</div>
      </div>
    `;
        document.body.appendChild(rootEl);

        fillEl = rootEl.querySelector("#saveLoaderFill");
        pctEl = rootEl.querySelector("#saveLoaderPercent");
        etaEl = rootEl.querySelector("#saveLoaderETA");
        titleEl = rootEl.querySelector("#saveLoaderTitle");
        subtitleEl = rootEl.querySelector("#saveLoaderSubtitle");
        noteEl = rootEl.querySelector("#saveLoaderNote");
        flagEl = rootEl.querySelector("#saveLoaderFlag");
    }

    function show() {
        rootEl.setAttribute("aria-hidden", "false");
    }
    function hide() {
        rootEl.setAttribute("aria-hidden", "true");
    }

    function setProgress(pct, etaMs) {
        pct = Math.max(0, Math.min(100, pct));
        fillEl.style.width = pct.toFixed(1) + "%";
        pctEl.textContent = Math.round(pct) + "%";
        if (etaMs != null && isFinite(etaMs) && etaMs >= 0) {
            etaEl.textContent = `ETA: ${Math.max(0, Math.round(etaMs / 1000))}s`;
        } else {
            etaEl.textContent = "⌛ —";
        }
    }

    // ──────────────────────────────────────────────────────────────────
    //  STIMA DURATE basata sulla dimensione del payload
    //  Restituisce una "costante di tempo" tau in ms: a ~3*tau la barra
    //  ha raggiunto il 95% della fase. Empiricamente:
    //   • file piccoli (~1MB)   → ~1s a 95%
    //   • file medi   (~10MB)  → ~3s a 95%
    //   • file grandi (~50MB)  → ~8s a 95% (limite superiore)
    // ──────────────────────────────────────────────────────────────────
    function estimateBytes(arg) {
        if (!arg) return 0;
        if (typeof arg === "string") return arg.length;
        if (typeof arg === "object") {
            if (typeof arg.imgData === "string") return arg.imgData.length;
            if (typeof arg.content === "string") return arg.content.length;
            if (Array.isArray(arg.files)) {
                return arg.files.reduce((s, f) => s + (f?.content?.length || 0), 0);
            }
            try {
                return JSON.stringify(arg).length;
            } catch {
                return 0;
            }
        }
        return 0;
    }

    function tauForBytes(bytes) {
        const MB = bytes / (1024 * 1024);
        return Math.max(600, Math.min(8000, 600 + MB * 80));
    }

    // ──────────────────────────────────────────────────────────────────
    //  STATO SESSIONE
    //
    //  Una "sessione" è un singolo salvataggio: composta da fasi
    //  sequenziali con peso (weight) e durata stimata (tauMs).
    //  Ogni fase avanza in modo asintotico fino al 95% del proprio
    //  peso, poi viene "chiusa" (al 100%) quando si passa alla fase
    //  successiva o quando la sessione termina con successo.
    // ──────────────────────────────────────────────────────────────────
    let session = null;
    let rafId = null;
    let watchdogId = null;

    function startSession({ title, flag, phases }) {
        session = {
            title: title || "Salvataggio in corso",
            flag: flag || "📁",
            phases: phases.map((p) => ({ ...p, started: false, ended: false, startTime: 0 })),
            currentIdx: -1,
            totalWeight: phases.reduce((s, p) => s + p.weight, 0),
            doneWeight: 0,
            sessionStart: performance.now(),
            ipcStarted: false
        };
        titleEl.textContent = session.title;
        flagEl.textContent = session.flag;
        subtitleEl.textContent = phases[0]?.subtitle || "Preparazione…";
        setProgress(0);
        show();
        activatePhase(0);
        armWatchdog();
    }

    function armWatchdog() {
        clearWatchdog();
        watchdogId = setTimeout(() => {
            // Se nessuna IPC è stata chiamata in 90s, qualcosa è andato storto
            // (es. modale freehand chiuso senza selezioni). Chiudo silenziosamente.
            if (session && !session.ipcStarted) {
                endFail("timeout");
            }
        }, WATCHDOG_MS);
    }
    function clearWatchdog() {
        if (watchdogId) {
            clearTimeout(watchdogId);
            watchdogId = null;
        }
    }

    function activatePhase(idx) {
        if (!session) return;

        // Chiudi la fase precedente accumulando il suo peso intero (snap a 100% locale)
        if (session.currentIdx >= 0 && session.currentIdx < session.phases.length) {
            const prev = session.phases[session.currentIdx];
            if (prev && !prev.ended) {
                session.doneWeight += prev.weight;
                prev.ended = true;
            }
        }

        session.currentIdx = idx;
        if (idx >= session.phases.length) return;

        const ph = session.phases[idx];
        ph.started = true;
        ph.startTime = performance.now();
        if (ph.subtitle) subtitleEl.textContent = ph.subtitle;

        if (rafId) cancelAnimationFrame(rafId);
        rafId = requestAnimationFrame(tickAuto);
    }

    function tickAuto() {
        if (!session || session.currentIdx < 0) return;
        const ph = session.phases[session.currentIdx];
        if (!ph || ph.ended) return;

        const elapsed = performance.now() - ph.startTime;
        const tau = ph.tauMs || 1500;
        // Avanzamento asintotico: 1 - exp(-t/tau), scalato al 95% del weight
        const fraction = 0.95 * (1 - Math.exp(-elapsed / tau));
        const phasePartial = ph.weight * fraction;

        const totalDone = session.doneWeight + phasePartial;
        const pct = (totalDone / session.totalWeight) * 100;

        // ETA: tempo previsto per arrivare al 95% di questa fase + somma 3*tau
        // delle fasi successive (ognuna arriva al 95% in ~3*tau)
        const remainingThisPhase = Math.max(0, 3 * tau - elapsed);
        const remainingNextPhases = session.phases
            .slice(session.currentIdx + 1)
            .reduce((s, p) => s + (p.tauMs || 1500) * 3, 0);
        const eta = remainingThisPhase + remainingNextPhases;

        setProgress(pct, eta);
        rafId = requestAnimationFrame(tickAuto);
    }

    function notifyIPC(phaseIdx, newSubtitle, newTau) {
        // Chiamato dai wrapper IPC: l'operazione è effettivamente entrata in
        // fase di scrittura su disco. Aggiorna sottotitolo + tau della fase.
        if (!session) return;
        session.ipcStarted = true;
        if (phaseIdx < session.phases.length) {
            const ph = session.phases[phaseIdx];
            if (newSubtitle) ph.subtitle = newSubtitle;
            if (newTau) ph.tauMs = newTau;
        }
        activatePhase(phaseIdx);
    }

    function endSuccess() {
        if (!session) return;
        if (rafId) {
            cancelAnimationFrame(rafId);
            rafId = null;
        }
        clearWatchdog();
        setProgress(100, 0);
        subtitleEl.textContent = "Completato ✔";
        setTimeout(() => {
            hide();
            session = null;
        }, FINAL_DELAY_MS);
    }

    function endCancel() {
        if (!session) return;
        if (rafId) {
            cancelAnimationFrame(rafId);
            rafId = null;
        }
        clearWatchdog();
        subtitleEl.textContent = "Salvataggio annullato";
        setTimeout(() => {
            hide();
            session = null;
        }, CANCEL_DELAY_MS);
    }

    function endFail(msg) {
        if (!session) return;
        if (rafId) {
            cancelAnimationFrame(rafId);
            rafId = null;
        }
        clearWatchdog();
        subtitleEl.textContent = msg ? `Errore: ${String(msg).slice(0, 80)}` : "Errore durante il salvataggio";
        setTimeout(() => {
            hide();
            session = null;
        }, ERR_DELAY_MS);
    }

    // ──────────────────────────────────────────────────────────────────
    //  PRE-LOADER su click dei bottoni che avviano un salvataggio
    //  (capture-phase su document → parte PRIMA dei listener originali
    //  registrati in renderer.js, così il loader appare anche durante
    //  la fase di rendering interna a Fabric, che precede l'IPC).
    // ──────────────────────────────────────────────────────────────────
    function bindClickPreloaders() {
        document.addEventListener(
            "click",
            (e) => {
                const t = e.target;
                if (!t || !t.closest) return;
                if (session) return; // già attivo, non ri-avviare

                // ── Salva progetto ─────────────────────────────────────────────
                if (t.closest("#saveProjectBtn")) {
                    startSession({
                        title: "Salvataggio progetto",
                        flag: "💾",
                        phases: [
                            { weight: 25, subtitle: "Preparazione dei dati progetto…", tauMs: 1500 },
                            { weight: 30, subtitle: "Trasferimento al sistema…", tauMs: 700 },
                            { weight: 45, subtitle: "Scrittura su disco…", tauMs: 2000 }
                        ]
                    });
                    return;
                }

                // ── Conferma export PDF ────────────────────────────────────────
                if (t.closest("#pdfExportConfirmBtn")) {
                    startSession({
                        title: "Esportazione PDF A4",
                        flag: "📄",
                        phases: [
                            { weight: 50, subtitle: "Generazione immagine 300 DPI…", tauMs: 2800 },
                            { weight: 25, subtitle: "Trasferimento al sistema…", tauMs: 700 },
                            { weight: 25, subtitle: "Composizione PDF e scrittura file…", tauMs: 1500 }
                        ]
                    });
                    return;
                }

                // ── Conferma export PNG/SVG ────────────────────────────────────
                if (t.closest("#pngSvgExportConfirmBtn")) {
                    // Titolo neutro: il wrapper IPC corrispondente affinerà i sottotitoli
                    startSession({
                        title: "Esportazione immagine",
                        flag: "🖼️",
                        phases: [
                            { weight: 55, subtitle: "Composizione canvas finale…", tauMs: 2400 },
                            { weight: 20, subtitle: "Trasferimento al sistema…", tauMs: 600 },
                            { weight: 25, subtitle: "Scrittura file…", tauMs: 1300 }
                        ]
                    });
                    return;
                }

                // ── Conferma export Freehand ───────────────────────────────────
                if (t.closest("#exportConfirmBtn")) {
                    // Verifica esplicita: il listener originale aborta se nessuna
                    // linea è selezionata (flashToast "Seleziona almeno una linea").
                    // In quel caso non avviamo il loader.
                    const checked = document.querySelectorAll('#exportListItems input[type="checkbox"]:checked');
                    if (checked.length === 0) return;

                    const modeRadio = document.querySelector('input[name="exportMode"]:checked');
                    const isSeparate = modeRadio && modeRadio.value === "separate";
                    const fileCount = isSeparate ? checked.length : 1;

                    startSession({
                        title: "Esportazione disegno mano libera",
                        flag: "✏️",
                        phases: [
                            { weight: 50, subtitle: "Composizione livelli (carta + penna + acquerello)…", tauMs: 2500 },
                            { weight: 20, subtitle: "Trasferimento al sistema…", tauMs: 500 },
                            {
                                weight: 30,
                                subtitle: `Scrittura ${fileCount} file…`,
                                tauMs: 1500 * Math.max(1, fileCount * 0.7)
                            }
                        ]
                    });
                    return;
                }
            },
            true
        ); // capture phase
    }

    // ──────────────────────────────────────────────────────────────────
    //  REGISTRAZIONE HOOKS sul saveLoaderBridge esposto dal preload.
    //
    //  Sostituisce il vecchio wrapIPC: gli oggetti esposti via
    //  contextBridge sono deeply-frozen, quindi non si possono
    //  riassegnare le loro proprietà dal renderer. Il bridge nel
    //  preload chiama onStart/onEnd al posto nostro per ogni IPC
    //  di salvataggio: qui ci limitiamo a reagire.
    // ──────────────────────────────────────────────────────────────────
    function bindHooks() {
        if (!window.saveLoaderBridge || typeof window.saveLoaderBridge.register !== "function") {
            // Bridge non ancora pronto (preload non eseguito): ritenta.
            setTimeout(bindHooks, 50);
            return;
        }

        window.saveLoaderBridge.register({
            onStart: (kind, payload) => {
                const bytes = estimateBytes(payload);
                const tau = tauForBytes(bytes);

                if (kind === "saveProject") {
                    if (!session) {
                        startSession({
                            title: "Salvataggio progetto",
                            flag: "💾",
                            phases: [
                                { weight: 30, subtitle: "Trasferimento al sistema…", tauMs: 700 },
                                { weight: 70, subtitle: "Scrittura su disco…", tauMs: tau }
                            ]
                        });
                        notifyIPC(0);
                    } else {
                        // Pre-loader già attivo (avviato dal click): passa direttamente alla fase di scrittura.
                        notifyIPC(session.phases.length - 1, "Scrittura su disco…", tau);
                    }
                    return;
                }

                if (kind === "exportPDFImage") {
                    if (!session) {
                        startSession({
                            title: "Esportazione PDF A4",
                            flag: "📄",
                            phases: [
                                { weight: 30, subtitle: "Trasferimento al sistema…", tauMs: 700 },
                                { weight: 50, subtitle: "Composizione PDF A4…", tauMs: tau },
                                { weight: 20, subtitle: "Scrittura file PDF…", tauMs: 800 }
                            ]
                        });
                        notifyIPC(0);
                    } else {
                        notifyIPC(session.phases.length - 2, "Composizione PDF A4…", tau);
                    }
                    return;
                }

                if (kind === "exportFullPNG") {
                    if (!session) {
                        startSession({
                            title: "Esportazione PNG completo",
                            flag: "🖼️",
                            phases: [
                                { weight: 30, subtitle: "Trasferimento al sistema…", tauMs: 700 },
                                { weight: 70, subtitle: "Scrittura PNG ad alta risoluzione…", tauMs: tau }
                            ]
                        });
                        notifyIPC(0);
                    } else {
                        if (titleEl) titleEl.textContent = "Esportazione PNG completo";
                        if (flagEl) flagEl.textContent = "🖼️";
                        notifyIPC(session.phases.length - 1, "Scrittura PNG ad alta risoluzione…", tau);
                    }
                    return;
                }

                if (kind === "exportShapesSVG") {
                    if (!session) {
                        startSession({
                            title: "Esportazione SVG forme",
                            flag: "🧩",
                            phases: [
                                { weight: 30, subtitle: "Trasferimento al sistema…", tauMs: 600 },
                                { weight: 70, subtitle: "Scrittura SVG vettoriale…", tauMs: tau }
                            ]
                        });
                        notifyIPC(0);
                    } else {
                        if (titleEl) titleEl.textContent = "Esportazione SVG forme";
                        if (flagEl) flagEl.textContent = "🧩";
                        notifyIPC(session.phases.length - 1, "Scrittura SVG vettoriale…", tau);
                    }
                    return;
                }

                if (kind === "exportFreehand") {
                    const fileCount = payload && Array.isArray(payload.files) ? payload.files.length : 1;
                    const tauFh = tau * Math.max(1, fileCount * 0.7);
                    if (!session) {
                        startSession({
                            title: "Esportazione disegno mano libera",
                            flag: "✏️",
                            phases: [
                                { weight: 25, subtitle: "Trasferimento al sistema…", tauMs: 600 },
                                { weight: 75, subtitle: `Scrittura ${fileCount} file…`, tauMs: tauFh }
                            ]
                        });
                        notifyIPC(0);
                    } else {
                        notifyIPC(session.phases.length - 1, `Scrittura ${fileCount} file…`, tauFh);
                    }
                    return;
                }
            },

            onEnd: (kind, payload) => {
                if (!session) return;

                // Errore: prevale su qualunque altra cosa.
                if (payload && payload.error) {
                    endFail(payload.error);
                    return;
                }

                // Decodifica del valore di ritorno specifica per ogni IPC,
                // come nel vecchio wrapIPC:
                //   • saveProject     → res.canceled === true  → cancel
                //   • exportFreehand  → res === false          → cancel
                //   • exportPDF/PNG/SVG → res == null           → cancel
                const res = payload ? payload.result : undefined;
                let canceled = false;
                if (kind === "saveProject") canceled = !!(res && res.canceled);
                else if (kind === "exportFreehand") canceled = res === false;
                else canceled = res == null;

                if (canceled) endCancel();
                else endSuccess();
            }
        });

        console.log("[saveLoader] hooks IPC registrati sul bridge ✔");
    }

    // ──────────────────────────────────────────────────────────────────
    //  INIT
    // ──────────────────────────────────────────────────────────────────
    function init() {
        injectStyles();
        buildDOM();
        bindClickPreloaders();
        bindHooks();
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", init);
    } else {
        init();
    }

    // API pubblica minimale (debug / uso futuro)
    window.saveLoader = {
        isActive: () => !!session,
        forceClose: () => {
            endSuccess();
        }
    };

    console.log("[saveLoader] Modulo caricato");
})();
