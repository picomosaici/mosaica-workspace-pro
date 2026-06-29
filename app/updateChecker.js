// ============================================================
//  updateChecker.js — Mosaica Workspace Pro
// ------------------------------------------------------------
//  Sistema di verifica e download degli aggiornamenti dal
//  repository GitHub ufficiale.
//
//  ARCHITETTURA:
//   • Sorgente unica: GitHub Releases API
//       https://api.github.com/repos/picomosaici/mosaica-workspace-pro/releases/latest
//   • Confronto versioni nel formato del progetto:
//       package.json  →  "M.YYYY.X"   (es. 6.2026.0)
//       git tag       →  "vM.YYYY[.X]" (es. v6.2026 oppure v6.2026.1)
//     Il parser normalizza entrambi a { month, year, hotfix }.
//   • Asset cercato: primo file .exe (Setup) negli assets della release.
//   • Download fatto LATO MAIN (electron.net), con redirect automatici
//     verso objects.githubusercontent.com e progress streaming via IPC.
//   • Installazione: spawn detached dell'installer + chiusura coordinata
//     con il sistema autosave esistente (vedi update:install-and-quit),
//     così se l'utente ha lavoro non salvato l'overlay di autoSave.js
//     parte normalmente prima del riavvio.
//
//  PERSISTENZA (userData/update-settings.json):
//     {
//       "autoCheckOnStartup": true,
//       "skipVersion": "v6.2026.1",   // versione da NON ripresentare
//       "lastCheckTs": 1716638400000
//     }
//
//  COMPORTAMENTO:
//   • Boot silenzioso: ~6s dopo DOMContentLoaded, se autoCheckOnStartup
//     è ON e la connessione c'è, controlla. Apre il modale SOLO se c'è
//     un update disponibile e la versione non è stata "skippata".
//   • Manuale (menu File → "Verifica aggiornamenti"): apre il modale in
//     stato "checking" e mostra sempre il risultato (anche "sei aggiornato").
//
//  COMPATIBILITÀ:
//   • Solo Windows packaged (NSIS .exe). In sviluppo (npm run dev) o su
//     piattaforme non Windows il modulo notifica e basta — non scarica.
//   • Nessuna dipendenza esterna: usa window.updaterAPI esposta da preload.
//   • Indipendente da Fabric.js (lato puramente UI/network/IPC).
//
//  Caricato come <script> in index.html DOPO i18n.js (per le traduzioni)
//  e DOPO autoSave.js (così l'autosave è già pronto quando lanciamo
//  l'installer).
// ============================================================

(function () {
  "use strict";

  // ─── Singleton ─────────────────────────────────────────────
  if (window.__updateCheckerInitialized) return;
  window.__updateCheckerInitialized = true;

  // ─── Costanti ──────────────────────────────────────────────
  const REPO_OWNER = "picomosaici";
  const REPO_NAME = "mosaica-workspace-pro";
  const STARTUP_CHECK_DELAY_MS = 6000;
  const MIN_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6h tra check automatici

  // ─── Stato ─────────────────────────────────────────────────
  let isChecking = false;
  let isDownloading = false;
  let currentRelease = null;      // dato grezzo dell'API GitHub
  let currentInstallerPath = null; // path locale dell'installer scaricato
  let currentUserSettings = {
    autoCheckOnStartup: true,
    skipVersion: null,
    lastCheckTs: 0
  };
  let progressUnsubscribe = null; // listener IPC progress
  let isMinimized = false;        // modale ridotto a "barretta" mentre scarica

  // ─── i18n helper (con fallback) ───────────────────────────
  function _t(key, params, fallback) {
    try {
      if (window.i18n && typeof window.i18n.t === "function") {
        const r = window.i18n.t(key, params);
        if (r === key && fallback != null) return _interp(fallback, params);
        return r;
      }
    } catch (_) {}
    return _interp(fallback != null ? fallback : key, params);
  }
  function _interp(str, params) {
    if (!params || typeof str !== "string") return str;
    return str.replace(/\{(\w+)\}/g, (m, k) =>
      Object.prototype.hasOwnProperty.call(params, k) ? String(params[k]) : m
    );
  }

  // ─── Toast helper (usa flashToast se presente) ────────────
  function _toast(msg) {
    try {
      if (typeof window.flashToast === "function") {
        window.flashToast(msg);
        return;
      }
    } catch (_) {}
    console.log("[updateChecker]", msg);
  }

  // ─── Version parsing ──────────────────────────────────────
  // Accetta: "6.2026.0", "06.2026", "v6.2026", "v6.2026.1", " v06.2026 ".
  function parseVersion(v) {
    if (v == null) return null;
    const m = /^v?(\d{1,2})\.(\d{4})(?:\.(\d+))?$/.exec(String(v).trim());
    if (!m) return null;
    const month = parseInt(m[1], 10);
    const year = parseInt(m[2], 10);
    const hotfix = m[3] != null ? parseInt(m[3], 10) : 0;
    if (month < 1 || month > 12 || year < 2025 || year > 2099) return null;
    return { month, year, hotfix };
  }

  function compareVersions(a, b) {
    if (a.year !== b.year) return a.year - b.year;
    if (a.month !== b.month) return a.month - b.month;
    return a.hotfix - b.hotfix;
  }

  function formatVersion(v) {
    const mm = String(v.month).padStart(2, "0");
    return v.hotfix > 0 ? `${mm}.${v.year}.${v.hotfix}` : `${mm}.${v.year}`;
  }

  // ─── Selezione asset .exe dalla release ───────────────────
  function pickWindowsInstaller(release) {
    if (!release || !Array.isArray(release.assets)) return null;
    // Cerca il primo .exe (l'installer è MosaicaWorkspacePro-Setup-*.exe)
    return release.assets.find(
      (a) => a && typeof a.name === "string" && /\.exe$/i.test(a.name)
    );
  }

  // ─── Format bytes ─────────────────────────────────────────
  function formatBytes(n) {
    if (!n || isNaN(n)) return "—";
    const KB = 1024,
      MB = KB * 1024;
    if (n >= MB) return (n / MB).toFixed(1) + " MB";
    if (n >= KB) return (n / KB).toFixed(1) + " KB";
    return n + " B";
  }

  // ─── Markdown light (release notes) ────────────────────────
  // GitHub release.body è Markdown. Renderizziamo solo l'essenziale per
  // tenerlo leggibile dentro il modale senza dipendenze esterne.
  function renderReleaseNotes(md) {
    if (!md || typeof md !== "string") {
      return `<em style="color:#999">${_t("update.notes.empty", null, "Nessuna nota di rilascio fornita.")}</em>`;
    }
    // Escape HTML prima di applicare i marker MD
    let html = md
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");

    // Headings ## / ### / #
    html = html.replace(/^### (.+)$/gm, "<h4>$1</h4>");
    html = html.replace(/^## (.+)$/gm, "<h3>$1</h3>");
    html = html.replace(/^# (.+)$/gm, "<h3>$1</h3>");

    // Bold + italic
    html = html.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    html = html.replace(/(^|\s)\*([^*\s][^*]*[^*\s]|[^*\s])\*(?=\s|[.,;:!?]|$)/g, "$1<em>$2</em>");

    // Inline code
    html = html.replace(/`([^`]+)`/g, "<code>$1</code>");

    // Liste puntate (- o *)
    html = html.replace(/^[ \t]*[-*] +(.+)$/gm, "<li>$1</li>");
    html = html.replace(/(?:<li>.*<\/li>\s*)+/g, (block) => `<ul>${block}</ul>`);

    // Link [testo](url) — autorizziamo solo http(s)
    html = html.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');

    // Paragrafi: linee vuote → <p>
    html = html
      .split(/\n{2,}/)
      .map((block) => {
        if (/^\s*<(h\d|ul|ol|p|blockquote)/i.test(block.trim())) return block;
        return "<p>" + block.replace(/\n/g, "<br>") + "</p>";
      })
      .join("\n");

    return html;
  }

  // ─── Stili CSS (iniettati una sola volta) ──────────────────
  function injectStyles() {
    if (document.getElementById("updateCheckerStyles")) return;
    const s = document.createElement("style");
    s.id = "updateCheckerStyles";
    s.textContent = `
      #updateModal {
        position: fixed; inset: 0;
        display: none;
        align-items: center; justify-content: center;
        background: rgba(0,0,0,0.72);
        z-index: 12000;
        opacity: 0; transition: opacity .22s ease;
        backdrop-filter: blur(3px);
      }
      #updateModal.visible { opacity: 1; }

      #updateModal .upd-inner {
        width: min(640px, 92vw);
        max-height: 86vh;
        background: linear-gradient(180deg, #1f2330 0%, #181b25 100%);
        color: #e9ecf3;
        border: 1px solid #2e3344;
        border-radius: 14px;
        box-shadow: 0 30px 80px rgba(0,0,0,0.55), 0 0 0 1px rgba(255,255,255,0.04) inset;
        padding: 22px 26px 20px;
        display: flex; flex-direction: column;
        font-family: inherit;
      }

      #updateModal .upd-header {
        display: flex; align-items: center; gap: 12px;
        margin-bottom: 14px;
      }
      #updateModal .upd-icon {
        font-size: 30px; line-height: 1;
        filter: drop-shadow(0 2px 4px rgba(0,0,0,0.4));
      }
      #updateModal .upd-title {
        font-size: 18px; font-weight: 700; letter-spacing: 0.2px;
        flex: 1;
      }
      #updateModal .upd-close {
        background: transparent; color: #aab; border: 0;
        font-size: 20px; cursor: pointer; padding: 2px 8px;
        border-radius: 6px; line-height: 1;
      }
      #updateModal .upd-close:hover { background: rgba(255,255,255,0.08); color: #fff; }

      #updateModal .upd-versions {
        display: flex; gap: 14px; align-items: center;
        background: rgba(255,255,255,0.03);
        border: 1px solid rgba(255,255,255,0.06);
        border-radius: 10px;
        padding: 12px 14px;
        margin-bottom: 14px;
      }
      #updateModal .upd-ver-col { flex: 1; min-width: 0; }
      #updateModal .upd-ver-label {
        font-size: 11px; text-transform: uppercase; letter-spacing: 0.8px;
        color: #8b93a5; margin-bottom: 4px;
      }
      #updateModal .upd-ver-value {
        font-size: 18px; font-weight: 700; color: #fff;
        font-variant-numeric: tabular-nums;
      }
      #updateModal .upd-ver-arrow {
        color: #4ade80; font-size: 22px; font-weight: 700;
      }
      #updateModal .upd-ver-new .upd-ver-value { color: #4ade80; }

      #updateModal .upd-notes-wrap {
        background: rgba(0,0,0,0.22);
        border: 1px solid rgba(255,255,255,0.05);
        border-radius: 10px;
        padding: 14px 16px;
        max-height: 38vh;
        overflow-y: auto;
        font-size: 13.5px; line-height: 1.55;
        margin-bottom: 14px;
        color: #d3d8e3;
      }
      #updateModal .upd-notes-wrap h3,
      #updateModal .upd-notes-wrap h4 {
        margin: 14px 0 6px; color: #fff;
        font-size: 14px; font-weight: 700;
      }
      #updateModal .upd-notes-wrap h3:first-child,
      #updateModal .upd-notes-wrap h4:first-child { margin-top: 0; }
      #updateModal .upd-notes-wrap p { margin: 6px 0; }
      #updateModal .upd-notes-wrap ul { margin: 6px 0; padding-left: 22px; }
      #updateModal .upd-notes-wrap li { margin: 2px 0; }
      #updateModal .upd-notes-wrap code {
        background: rgba(255,255,255,0.08);
        padding: 1px 5px; border-radius: 4px;
        font-family: ui-monospace,Consolas,monospace; font-size: 12.5px;
      }
      #updateModal .upd-notes-wrap a { color: #7eb8ff; }

      #updateModal .upd-spinner {
        margin: 16px auto 8px;
        width: 38px; height: 38px;
        border: 3px solid rgba(255,255,255,0.12);
        border-top-color: #4ade80;
        border-radius: 50%;
        animation: updSpin .9s linear infinite;
      }
      @keyframes updSpin { to { transform: rotate(360deg); } }

      #updateModal .upd-status-msg {
        text-align: center; padding: 6px 8px 18px;
        font-size: 14px; color: #c8cee0; line-height: 1.5;
      }
      #updateModal .upd-status-msg.ok { color: #4ade80; }
      #updateModal .upd-status-msg.err { color: #f87171; }

      #updateModal .upd-progress {
        background: rgba(255,255,255,0.06);
        height: 12px; border-radius: 999px; overflow: hidden;
        margin: 6px 0 8px;
      }
      #updateModal .upd-progress-fill {
        height: 100%;
        background: linear-gradient(90deg, #4ade80, #22d3ee);
        width: 0%;
        transition: width .15s ease;
      }
      #updateModal .upd-progress-info {
        display: flex; justify-content: space-between;
        font-size: 12px; color: #aab; margin-bottom: 14px;
        font-variant-numeric: tabular-nums;
      }

      #updateModal .upd-actions {
        display: flex; gap: 10px; justify-content: flex-end;
        flex-wrap: wrap;
        border-top: 1px solid rgba(255,255,255,0.06);
        padding-top: 14px;
      }
      #updateModal .upd-actions-left {
        margin-right: auto;
        display: flex; align-items: center; gap: 8px;
        font-size: 12.5px; color: #aab;
      }
      #updateModal .upd-actions-left input[type=checkbox] {
        cursor: pointer; accent-color: #2b6cff;
      }
      #updateModal .upd-actions-left label { cursor: pointer; user-select: none; }

      #updateModal .upd-btn {
        padding: 9px 16px;
        border-radius: 8px;
        border: 1px solid transparent;
        cursor: pointer;
        font-size: 13.5px; font-weight: 600;
        transition: transform .08s ease, background .15s ease, border-color .15s;
      }
      #updateModal .upd-btn:hover { transform: translateY(-1px); }
      #updateModal .upd-btn:disabled {
        opacity: .5; cursor: not-allowed; transform: none;
      }
      #updateModal .upd-btn.primary {
        background: #2b6cff; color: #fff;
        box-shadow: 0 6px 18px rgba(43,108,255,0.35);
      }
      #updateModal .upd-btn.primary:hover { background: #3b7cff; }
      #updateModal .upd-btn.success {
        background: #22a661; color: #fff;
        box-shadow: 0 6px 18px rgba(34,166,97,0.32);
      }
      #updateModal .upd-btn.success:hover { background: #2cba6f; }
      #updateModal .upd-btn.ghost {
        background: transparent; color: #c8cee0;
        border-color: rgba(255,255,255,0.12);
      }
      #updateModal .upd-btn.ghost:hover {
        background: rgba(255,255,255,0.06);
        border-color: rgba(255,255,255,0.22);
      }
      #updateModal .upd-btn.danger-ghost {
        background: transparent; color: #f87171;
        border-color: rgba(248,113,113,0.3);
      }
      #updateModal .upd-btn.danger-ghost:hover {
        background: rgba(248,113,113,0.08);
      }

      /* Sezioni a stati: nascoste salvo quella attiva */
      #updateModal .upd-section { display: none; }
      #updateModal[data-state="checking"]    .upd-section.s-checking    { display: block; }
      #updateModal[data-state="up-to-date"]  .upd-section.s-up-to-date  { display: block; }
      #updateModal[data-state="available"]   .upd-section.s-available   { display: block; }
      #updateModal[data-state="downloading"] .upd-section.s-downloading { display: block; }
      #updateModal[data-state="ready"]       .upd-section.s-ready       { display: block; }
      #updateModal[data-state="error"]       .upd-section.s-error       { display: block; }

      /* ── Barretta "download in background" (modale ridotto a icona) ── */
      #updateMiniPill {
        position: fixed; right: 22px; bottom: 22px;
        z-index: 11999;
        display: none; align-items: center; gap: 12px;
        width: 280px; max-width: calc(100vw - 44px);
        padding: 12px 14px;
        background: linear-gradient(180deg, #1f2330 0%, #181b25 100%);
        color: #e9ecf3;
        border: 1px solid #2e3344; border-radius: 12px;
        box-shadow: 0 16px 40px rgba(0,0,0,0.45);
        cursor: pointer; opacity: 0;
        transform: translateY(10px);
        transition: opacity .2s ease, transform .2s ease, border-color .2s;
      }
      #updateMiniPill.visible { display: flex; opacity: 1; transform: translateY(0); }
      #updateMiniPill:hover { border-color: #41506e; }
      #updateMiniPill .upd-mini-spinner {
        flex: 0 0 auto;
        width: 22px; height: 22px;
        border: 3px solid rgba(255,255,255,0.12);
        border-top-color: #4ade80; border-radius: 50%;
        animation: updSpin .9s linear infinite;
        display: flex; align-items: center; justify-content: center;
        font-size: 15px;
      }
      #updateMiniPill .upd-mini-spinner.done {
        animation: none; border: 0; width: auto; height: auto;
      }
      #updateMiniPill .upd-mini-text { flex: 1; min-width: 0; }
      #updateMiniPill .upd-mini-title {
        font-size: 12.5px; font-weight: 700; color: #fff;
        white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
      }
      #updateMiniPill .upd-mini-sub {
        font-size: 11.5px; color: #9aa3b6; margin-top: 2px;
        font-variant-numeric: tabular-nums;
      }
      #updateMiniPill .upd-mini-bar {
        position: absolute; left: 0; right: 0; bottom: 0; height: 3px;
        background: rgba(255,255,255,0.06);
        border-radius: 0 0 12px 12px; overflow: hidden;
      }
      #updateMiniPill .upd-mini-fill {
        height: 100%; width: 0%;
        background: linear-gradient(90deg, #4ade80, #22d3ee);
        transition: width .2s ease;
      }
      #updateMiniPill.ready { border-color: #22a661; }
      #updateMiniPill.ready .upd-mini-fill { background: #22a661; }
    `;
    document.head.appendChild(s);
  }

  // ─── Costruzione modale lazy ──────────────────────────────
  function ensureModal() {
    let m = document.getElementById("updateModal");
    if (m) return m;

    injectStyles();

    m = document.createElement("div");
    m.id = "updateModal";
    m.setAttribute("data-state", "checking");
    m.innerHTML = `
      <div class="upd-inner" role="dialog" aria-modal="true" aria-labelledby="updTitle">
        <div class="upd-header">
          <div class="upd-icon">🔄</div>
          <div class="upd-title" id="updTitle">${_t("update.modal.title", null, "Aggiornamenti di Mosaica")}</div>
          <button class="upd-close" id="updCloseBtn" aria-label="${_t("common.close", null, "Chiudi")}">✕</button>
        </div>

        <!-- Stato: verifica in corso -->
        <div class="upd-section s-checking">
          <div class="upd-spinner"></div>
          <div class="upd-status-msg">${_t("update.checking", null, "Verifica della disponibilità di nuove versioni…")}</div>
        </div>

        <!-- Stato: già aggiornato -->
        <div class="upd-section s-up-to-date">
          <div class="upd-status-msg ok">
            ✅ ${_t("update.upToDate.line1", null, "Stai usando l'ultima versione di Mosaica Workspace Pro.")}
          </div>
          <div class="upd-status-msg" style="padding-top:0;">
            <span data-upd-current-version></span>
          </div>
        </div>

        <!-- Stato: aggiornamento disponibile -->
        <div class="upd-section s-available">
          <div class="upd-versions">
            <div class="upd-ver-col">
              <div class="upd-ver-label">${_t("update.modal.current", null, "Versione corrente")}</div>
              <div class="upd-ver-value" data-upd-current-version>—</div>
            </div>
            <div class="upd-ver-arrow">→</div>
            <div class="upd-ver-col upd-ver-new">
              <div class="upd-ver-label">${_t("update.modal.available", null, "Nuova versione")}</div>
              <div class="upd-ver-value" data-upd-new-version>—</div>
            </div>
          </div>
          <div style="font-size:12px;color:#8b93a5;margin:-6px 0 10px;">
            <span data-upd-asset-size></span>
          </div>
          <div style="font-size:13px;color:#aab;margin-bottom:6px;">
            ${_t("update.modal.releaseNotes", null, "Novità di questa versione:")}
          </div>
          <div class="upd-notes-wrap" data-upd-notes></div>
        </div>

        <!-- Stato: download in corso -->
        <div class="upd-section s-downloading">
          <div style="text-align:center;margin-bottom:14px;font-size:15px;font-weight:600;">
            ${_t("update.modal.downloading", null, "Download dell'aggiornamento in corso…")}
          </div>
          <div class="upd-progress">
            <div class="upd-progress-fill" data-upd-progress-fill></div>
          </div>
          <div class="upd-progress-info">
            <span data-upd-progress-percent>0%</span>
            <span data-upd-progress-bytes>— / —</span>
          </div>
          <div class="upd-status-msg" data-upd-progress-status style="padding:0 0 8px;min-height:18px;color:#fbbf24;"></div>
          <div style="font-size:12px;color:#8b93a5;text-align:center;">
            ${_t("update.modal.downloadingHint", null, "Puoi ridurre a icona e continuare a lavorare: il download prosegue in background. Non chiudere Mosaica.")}
          </div>
        </div>

        <!-- Stato: download completato, pronto a installare -->
        <div class="upd-section s-ready">
          <div class="upd-status-msg ok" style="font-size:15px;">
            ✅ ${_t("update.modal.readyLine1", null, "Download completato.")}
          </div>
          <div class="upd-status-msg" style="padding-top:0;">
            ${_t("update.modal.readyLine2", null, "Mosaica si chiuderà per avviare l'installer. Il lavoro non salvato verrà preservato dall'auto-salvataggio.")}
          </div>
        </div>

        <!-- Stato: errore -->
        <div class="upd-section s-error">
          <div class="upd-status-msg err">
            ⚠️ <span data-upd-error-msg>${_t("update.error.generic", null, "Si è verificato un errore.")}</span>
          </div>
        </div>

        <!-- Azioni -->
        <div class="upd-actions">
          <div class="upd-actions-left">
            <input type="checkbox" id="updAutoCheckChk" />
            <label for="updAutoCheckChk">${_t("update.modal.autoCheck", null, "Controlla all'avvio")}</label>
          </div>

          <!-- bottoni stato available -->
          <button class="upd-btn ghost" data-upd-action="skip">${_t("update.modal.skip", null, "Salta questa versione")}</button>
          <button class="upd-btn ghost" data-upd-action="later">${_t("update.modal.later", null, "Più tardi")}</button>
          <button class="upd-btn primary" data-upd-action="download">⬇ ${_t("update.modal.download", null, "Scarica e installa")}</button>

          <!-- bottoni stato downloading -->
          <button class="upd-btn ghost" data-upd-action="minimize">${_t("update.modal.minimize", null, "Continua a lavorare")}</button>
          <button class="upd-btn danger-ghost" data-upd-action="cancel-download">${_t("update.modal.cancel", null, "Annulla")}</button>

          <!-- bottoni stato ready -->
          <button class="upd-btn ghost" data-upd-action="install-later">${_t("update.modal.installLater", null, "Installa più tardi")}</button>
          <button class="upd-btn success" data-upd-action="install-now">▶ ${_t("update.modal.installNow", null, "Installa ora")}</button>

          <!-- bottoni stato up-to-date / error -->
          <button class="upd-btn primary" data-upd-action="close-ok">${_t("common.ok", null, "OK")}</button>
          <button class="upd-btn primary" data-upd-action="retry">${_t("update.modal.retry", null, "Riprova")}</button>
        </div>
      </div>
    `;
    document.body.appendChild(m);

    // Listener bottoni (delega)
    // La X, il click sul backdrop ed ESC ora chiamano dismissModal():
    // se è in corso un download riducono a icona (download in background),
    // altrimenti chiudono normalmente.
    m.querySelector("#updCloseBtn").addEventListener("click", () => dismissModal());
    m.querySelector("#updAutoCheckChk").addEventListener("change", (e) => {
      currentUserSettings.autoCheckOnStartup = !!e.target.checked;
      saveSettings();
    });
    m.addEventListener("click", (e) => {
      if (e.target === m) dismissModal(); // click sul backdrop
    });
    m.querySelectorAll("[data-upd-action]").forEach((btn) => {
      btn.addEventListener("click", () => handleAction(btn.getAttribute("data-upd-action")));
    });

    // ESC: riduce a icona se sta scaricando, altrimenti chiude
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && m.style.display === "flex") {
        dismissModal();
      }
    });

    return m;
  }

  function setState(state) {
    const m = ensureModal();
    m.setAttribute("data-state", state);
    // Sincronizza visibilità bottoni in base allo stato.
    // Un singolo bottone è visibile solo se la sua azione corrisponde
    // a uno degli stati elencati qui sotto.
    const VISIBLE = {
      "checking": [],
      "up-to-date": ["close-ok"],
      "available": ["skip", "later", "download"],
      "downloading": ["minimize", "cancel-download"],
      "ready": ["install-later", "install-now"],
      "error": ["retry", "close-ok"]
    };
    const allowed = VISIBLE[state] || [];
    m.querySelectorAll("[data-upd-action]").forEach((btn) => {
      btn.style.display = allowed.includes(btn.getAttribute("data-upd-action")) ? "" : "none";
    });
  }

  function openModal(state) {
    const m = ensureModal();
    // Sincronizza checkbox
    const chk = m.querySelector("#updAutoCheckChk");
    if (chk) chk.checked = !!currentUserSettings.autoCheckOnStartup;

    m.style.display = "flex";
    requestAnimationFrame(() => m.classList.add("visible"));
    setState(state || "checking");
  }

  function closeModal() {
    const m = document.getElementById("updateModal");
    if (!m) return;
    isMinimized = false;
    hideMiniPill();
    m.classList.remove("visible");
    setTimeout(() => {
      if (m) m.style.display = "none";
    }, 220);
  }

  // "Chiusura morbida" da X / backdrop / ESC:
  //  • se sta scaricando → riduce a icona (la barretta) e il download
  //    prosegue in background, così si può continuare a lavorare;
  //  • altrimenti → chiude davvero.
  function dismissModal() {
    const m = document.getElementById("updateModal");
    if (!m) return;
    const state = m.getAttribute("data-state");
    if (isDownloading || state === "downloading") {
      minimizeModal();
    } else {
      closeModal();
    }
  }

  function minimizeModal() {
    const m = document.getElementById("updateModal");
    if (!m) return;
    isMinimized = true;
    m.classList.remove("visible");
    setTimeout(() => { if (m && isMinimized) m.style.display = "none"; }, 220);
    const pill = ensureMiniPill();
    pill.classList.add("visible");
  }

  function restoreModal() {
    isMinimized = false;
    hideMiniPill();
    const m = ensureModal();
    m.style.display = "flex";
    requestAnimationFrame(() => m.classList.add("visible"));
    // Lo stato corrente (downloading / ready / error) è già impostato:
    // non lo reimpostiamo, così l'utente ritrova esattamente dov'era.
  }

  // ─── Barretta "download in background" ────────────────────
  function ensureMiniPill() {
    let pill = document.getElementById("updateMiniPill");
    if (pill) return pill;
    injectStyles();
    pill = document.createElement("div");
    pill.id = "updateMiniPill";
    pill.setAttribute("role", "button");
    pill.setAttribute("tabindex", "0");
    pill.setAttribute("title", _t("update.mini.tooltip", null, "Aggiornamento in download — clicca per i dettagli"));
    pill.innerHTML = `
      <div class="upd-mini-spinner"></div>
      <div class="upd-mini-text">
        <div class="upd-mini-title">${_t("update.mini.title", null, "Download aggiornamento")}</div>
        <div class="upd-mini-sub"><span data-mini-pct>0%</span> · <span data-mini-status>${_t("update.mini.downloading", null, "in corso")}</span></div>
      </div>
      <div class="upd-mini-bar"><div class="upd-mini-fill" data-mini-fill></div></div>
    `;
    pill.addEventListener("click", () => restoreModal());
    pill.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); restoreModal(); }
    });
    document.body.appendChild(pill);
    return pill;
  }

  function hideMiniPill() {
    const pill = document.getElementById("updateMiniPill");
    if (pill) pill.classList.remove("visible");
  }

  function updateMiniPill(pct, status) {
    const pill = document.getElementById("updateMiniPill");
    if (!pill) return;
    const fill = pill.querySelector("[data-mini-fill]");
    const pctEl = pill.querySelector("[data-mini-pct]");
    const stEl = pill.querySelector("[data-mini-status]");
    if (fill) fill.style.width = (pct || 0) + "%";
    if (pctEl) pctEl.textContent = (pct || 0) + "%";
    if (stEl) {
      if (status === "retrying") stEl.textContent = _t("update.mini.retrying", null, "riconnessione…");
      else if (status === "resuming") stEl.textContent = _t("update.mini.resuming", null, "ripresa…");
      else if (status === "stalled") stEl.textContent = _t("update.mini.stalled", null, "in attesa…");
      else stEl.textContent = _t("update.mini.downloading", null, "in corso");
    }
  }

  // Trasforma la barretta in stato "pronto per installare" (verde + ✅).
  function setMiniReady() {
    const pill = ensureMiniPill();
    pill.classList.add("ready", "visible");
    const sp = pill.querySelector(".upd-mini-spinner");
    if (sp) { sp.classList.add("done"); sp.textContent = "✅"; }
    const titleEl = pill.querySelector(".upd-mini-title");
    if (titleEl) titleEl.textContent = _t("update.mini.readyTitle", null, "Aggiornamento pronto");
    const subEl = pill.querySelector(".upd-mini-sub");
    if (subEl) subEl.textContent = _t("update.mini.readySub", null, "clicca per installare");
    const fill = pill.querySelector("[data-mini-fill]");
    if (fill) fill.style.width = "100%";
  }

  // ─── Settings persistenza ─────────────────────────────────
  async function loadSettings() {
    try {
      if (!window.updaterAPI || !window.updaterAPI.getSettings) return;
      const s = await window.updaterAPI.getSettings();
      if (s && typeof s === "object") {
        currentUserSettings = {
          autoCheckOnStartup: s.autoCheckOnStartup !== false, // default true
          skipVersion: s.skipVersion || null,
          lastCheckTs: s.lastCheckTs || 0
        };
      }
    } catch (e) {
      console.warn("[updateChecker] loadSettings:", e);
    }
  }

  async function saveSettings() {
    try {
      if (!window.updaterAPI || !window.updaterAPI.setSettings) return;
      await window.updaterAPI.setSettings(currentUserSettings);
    } catch (e) {
      console.warn("[updateChecker] saveSettings:", e);
    }
  }

  // ─── Azioni utente (modale) ───────────────────────────────
  async function handleAction(action) {
    switch (action) {
      case "download":
        await startDownload();
        break;
      case "cancel-download":
        await cancelDownload();
        break;
      case "install-now":
        await installNow();
        break;
      case "install-later":
        _toast(_t("update.toast.installLater", null, "Installer scaricato. Lo lanceremo alla prossima verifica."));
        closeModal();
        break;
      case "skip":
        if (currentRelease && currentRelease.tag_name) {
          currentUserSettings.skipVersion = currentRelease.tag_name;
          await saveSettings();
          _toast(_t("update.toast.skipped", { ver: currentRelease.tag_name }, "Versione {ver} ignorata."));
        }
        closeModal();
        break;
      case "minimize":
        minimizeModal();
        break;
      case "later":
        closeModal();
        break;
      case "close-ok":
        closeModal();
        break;
      case "retry":
        await check({ manual: true });
        break;
    }
  }

  // ─── Logica principale: check ─────────────────────────────
  async function check(opts) {
    opts = opts || {};
    const manual = !!opts.manual;

    if (isChecking) return;
    isChecking = true;

    if (manual) openModal("checking");

    // Verifica disponibilità API
    if (!window.updaterAPI) {
      isChecking = false;
      if (manual) showError(_t("update.error.bridgeMissing", null, "Bridge IPC degli aggiornamenti non disponibile."));
      return;
    }

    // Info piattaforma
    let info = null;
    try {
      info = await window.updaterAPI.getPlatformInfo();
    } catch (e) {
      isChecking = false;
      if (manual) showError(_t("update.error.platformInfo", null, "Impossibile leggere le informazioni di piattaforma."));
      return;
    }

    if (!info || info.platform !== "win32") {
      isChecking = false;
      if (manual) showError(_t("update.error.notWindows", null, "Gli aggiornamenti automatici sono supportati solo su Windows."));
      return;
    }

    if (!info.isPackaged) {
      isChecking = false;
      if (manual) {
        const m = ensureModal();
        setState("error");
        const errEl = m.querySelector("[data-upd-error-msg]");
        if (errEl) errEl.textContent = _t("update.error.devMode", null, "Sei in modalità sviluppo (npm run dev). Gli aggiornamenti sono disponibili solo nella versione installata.");
      }
      return;
    }

    const localV = parseVersion(info.version);
    if (!localV) {
      isChecking = false;
      if (manual) showError(_t("update.error.localVersion", null, "Versione locale non riconosciuta: ") + info.version);
      return;
    }

    // Fetch della release dal main
    let release;
    try {
      release = await window.updaterAPI.fetchLatestRelease(REPO_OWNER, REPO_NAME);
    } catch (e) {
      isChecking = false;
      if (manual) showError(_t("update.error.network", null, "Impossibile contattare GitHub. Verifica la connessione."));
      else console.log("[updateChecker] silent check failed:", e && e.message);
      return;
    }

    isChecking = false;
    currentUserSettings.lastCheckTs = Date.now();
    saveSettings();

    if (!release || !release.tag_name) {
      if (manual) showError(_t("update.error.noRelease", null, "Nessuna release trovata sul repository GitHub."));
      return;
    }

    const remoteV = parseVersion(release.tag_name);
    if (!remoteV) {
      if (manual) showError(_t("update.error.remoteVersion", null, "Tag remoto non riconosciuto: ") + release.tag_name);
      return;
    }

    currentRelease = release;
    const newer = compareVersions(remoteV, localV) > 0;
    const localStr = formatVersion(localV);
    const remoteStr = formatVersion(remoteV);

    if (!newer) {
      if (manual) {
        const m = ensureModal();
        openModal("up-to-date");
        const cur = m.querySelector(".s-up-to-date [data-upd-current-version]");
        if (cur) cur.textContent = _t("update.modal.currentLabel", { ver: localStr }, "Versione installata: {ver}");
      }
      return;
    }

    // C'è un update disponibile.
    // Se è quella che l'utente ha "skippato" e non è un check manuale → silenzio.
    if (!manual && currentUserSettings.skipVersion && currentUserSettings.skipVersion === release.tag_name) {
      console.log("[updateChecker] versione skippata:", release.tag_name);
      return;
    }

    // Cerchiamo l'asset .exe
    const asset = pickWindowsInstaller(release);
    if (!asset) {
      if (manual) showError(_t("update.error.noAsset", null, "La release non contiene un installer Windows."));
      return;
    }

    // Apri il modale "available" — sia manuale che automatico
    const m = ensureModal();
    openModal("available");
    m.querySelector(".s-available [data-upd-current-version]").textContent = localStr;
    m.querySelector(".s-available [data-upd-new-version]").textContent = remoteStr;
    const sizeEl = m.querySelector("[data-upd-asset-size]");
    if (sizeEl) {
      sizeEl.textContent = _t(
        "update.modal.assetInfo",
        { name: asset.name, size: formatBytes(asset.size) },
        "{name} · {size}"
      );
    }
    const notesEl = m.querySelector("[data-upd-notes]");
    if (notesEl) notesEl.innerHTML = renderReleaseNotes(release.body);

    if (!manual) {
      _toast(_t("update.toast.newAvailable", { ver: remoteStr }, "🎉 Nuova versione disponibile: {ver}"));
    }
  }

  function showError(message) {
    isMinimized = false;
    hideMiniPill();
    const m = ensureModal();
    openModal("error");
    const errEl = m.querySelector("[data-upd-error-msg]");
    if (errEl) errEl.textContent = message;
  }

  // ─── Download ────────────────────────────────────────────
  async function startDownload() {
    if (isDownloading) return;
    if (!currentRelease) return;
    const asset = pickWindowsInstaller(currentRelease);
    if (!asset) {
      showError(_t("update.error.noAsset", null, "La release non contiene un installer Windows."));
      return;
    }

    isDownloading = true;
    setState("downloading");

    // Resetta progress bar
    const m = ensureModal();
    const fill = m.querySelector("[data-upd-progress-fill]");
    const pctEl = m.querySelector("[data-upd-progress-percent]");
    const bytesEl = m.querySelector("[data-upd-progress-bytes]");
    if (fill) fill.style.width = "0%";
    if (pctEl) pctEl.textContent = "0%";
    if (bytesEl) bytesEl.textContent = "— / —";

    // Aggancia listener progress
    if (progressUnsubscribe) {
      progressUnsubscribe();
      progressUnsubscribe = null;
    }
    const statusEl = m.querySelector("[data-upd-progress-status]");
    if (statusEl) statusEl.textContent = "";

    if (window.updaterAPI && window.updaterAPI.onDownloadProgress) {
      progressUnsubscribe = window.updaterAPI.onDownloadProgress((p) => {
        if (!p) return;
        const total = p.total > 0 ? p.total : 0;
        const downloaded = p.downloaded || 0;
        const pct = total > 0 ? Math.min(100, Math.round((downloaded / total) * 100)) : 0;
        const status = p.status || "downloading";
        if (fill) {
          fill.style.width = pct + "%";
          fill.style.filter = (status === "retrying" || status === "stalled") ? "grayscale(0.55)" : "";
        }
        if (pctEl) pctEl.textContent = pct + "%";
        if (bytesEl) bytesEl.textContent = formatBytes(downloaded) + " / " + (total ? formatBytes(total) : "—");
        if (statusEl) {
          if (status === "retrying") {
            statusEl.textContent = _t("update.modal.retrying", { n: p.attempt || 1 }, "⚠️ Connessione persa — nuovo tentativo… (tentativo {n})");
          } else if (status === "resuming") {
            statusEl.textContent = _t("update.modal.resuming", null, "🔄 Connessione ripristinata — riprendo da dove si era interrotto…");
          } else if (status === "stalled") {
            statusEl.textContent = _t("update.modal.stalled", null, "⏳ Connessione lenta o assente — in attesa…");
          } else {
            statusEl.textContent = "";
          }
        }
        // Se l'utente ha ridotto a icona, aggiorniamo anche la barretta.
        if (isMinimized) updateMiniPill(pct, status);
      });
    }

    try {
      const res = await window.updaterAPI.downloadAsset({
        url: asset.browser_download_url,
        filename: asset.name,
        expectedSize: asset.size || 0,
        // 🛡️ Hash SHA-256 fornito da GitHub (formato "sha256:hex...").
        // Le release vecchie potrebbero non averlo: il main fa graceful fallback.
        expectedDigest: (asset.digest && typeof asset.digest === "string") ? asset.digest : null
      });
      if (!res || !res.ok) {
        throw new Error((res && res.error) || "Download fallito");
      }
      currentInstallerPath = res.path;
      isDownloading = false;
      if (progressUnsubscribe) {
        progressUnsubscribe();
        progressUnsubscribe = null;
      }
      setState("ready");
      // Se il modale era ridotto a icona NON lo facciamo "saltare in faccia"
      // mentre l'utente lavora: trasformiamo la barretta in "Pronto" e
      // mandiamo un avviso. Un clic sulla barretta riapre il modale già
      // pronto per installare.
      if (isMinimized) {
        setMiniReady();
        _toast(_t("update.toast.readyMinimized", null, "✅ Aggiornamento scaricato — clicca la barretta in basso a destra per installare."));
      }
    } catch (e) {
      isDownloading = false;
      if (progressUnsubscribe) {
        progressUnsubscribe();
        progressUnsubscribe = null;
      }
      const msg = (e && e.message) || _t("update.error.downloadGeneric", null, "Errore durante il download.");
      // Se l'utente ha annullato non mostriamo errore
      if (/annull|cancel|abort/i.test(msg)) {
        closeModal();
        return;
      }
      showError(_t("update.error.downloadPrefix", null, "Download fallito: ") + msg);
    }
  }

  async function cancelDownload() {
    try {
      if (window.updaterAPI && window.updaterAPI.cancelDownload) {
        await window.updaterAPI.cancelDownload();
      }
    } catch (_) {}
    isDownloading = false;
    if (progressUnsubscribe) {
      progressUnsubscribe();
      progressUnsubscribe = null;
    }
    closeModal();
  }

  async function installNow() {
    if (!currentInstallerPath) {
      showError(_t("update.error.noInstaller", null, "Installer non trovato sul disco."));
      return;
    }
    try {
      // Il main process lancia l'installer detached e chiude la finestra.
      // L'autosave esistente (autoSave.js) farà partire l'overlay
      // "Salvataggio in corso…" prima della destroy effettiva, così
      // il lavoro non salvato è al sicuro.
      await window.updaterAPI.installAndQuit(currentInstallerPath);
    } catch (e) {
      showError(_t("update.error.installPrefix", null, "Avvio installer fallito: ") + ((e && e.message) || String(e)));
    }
  }

  // ─── Bootstrap ───────────────────────────────────────────
  async function init() {
    await loadSettings();

    // Aggancia il bottone "Verifica aggiornamenti" nel menu File (se presente)
    const checkBtn = document.getElementById("checkUpdatesBtn");
    if (checkBtn) {
      checkBtn.addEventListener("click", () => {
        // Chiudi il dropdown File se aperto
        const fileMenu = document.getElementById("fileMenuDropdown");
        if (fileMenu) fileMenu.classList.remove("open");
        check({ manual: true });
      });
    }

    // Check silenzioso all'avvio — solo se attivo e non eseguito di recente
    if (currentUserSettings.autoCheckOnStartup) {
      const since = Date.now() - (currentUserSettings.lastCheckTs || 0);
      if (since >= MIN_CHECK_INTERVAL_MS) {
        setTimeout(() => {
          check({ manual: false }).catch((e) => console.warn("[updateChecker] auto-check:", e));
        }, STARTUP_CHECK_DELAY_MS);
      } else {
        console.log("[updateChecker] auto-check saltato (controllato di recente)");
      }
    }
  }

  // ─── API pubblica ────────────────────────────────────────
  window.MosaicaUpdater = {
    check: (opts) => check(opts),
    openSettings: () => {
      // utility: apre il modale in stato up-to-date così l'utente può
      // vedere la checkbox "Controlla all'avvio". Usata raramente.
      openModal("up-to-date");
      const m = ensureModal();
      const cur = m.querySelector(".s-up-to-date [data-upd-current-version]");
      if (cur && window.updaterAPI) {
        window.updaterAPI.getPlatformInfo().then((info) => {
          if (info && info.version) {
            const lv = parseVersion(info.version);
            cur.textContent = _t(
              "update.modal.currentLabel",
              { ver: lv ? formatVersion(lv) : info.version },
              "Versione installata: {ver}"
            );
          }
        });
      }
    }
  };

  // Boot al DOMContentLoaded (oppure subito se DOM già pronto)
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();