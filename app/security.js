// ============================================================
//  security.js — Mosaica Workspace Pro
// ------------------------------------------------------------
//  Modulo centralizzato di cyber-security per il main process.
//
//  SCOPO:
//   Aggiungere un livello di difesa "ad hoc" intorno alle DUE
//   superfici di attacco reali di Mosaica:
//
//     1. Sistema aggiornamenti (download installer da GitHub)
//     2. BrowserWindow / sessione del renderer
//
//   Mosaica è un'app di disegno offline: NON deve mai aprire
//   pagine web, NON deve mai eseguire codice arrivato dalla
//   rete, NON deve mai chiedere camera/microfono/geolocazione.
//   Questo modulo si assicura che resti così, anche in caso di
//   bug o di file di progetto malformato.
//
//  COSA FA — IN BREVE:
//   • Allowlist stretta dei domini GitHub per il sistema update
//   • Validazione filename installer (.exe, niente path traversal)
//   • Verifica integrità installer scaricato:
//       - dimensione (min/max sensati)
//       - magic bytes PE ("MZ") → è davvero un eseguibile Windows?
//       - SHA-256 confrontato con il campo `digest` di GitHub
//         (formato "sha256:hex...", introdotto da GitHub nel 2025)
//   • Validazione redirect HTTPS: ogni redirect del download viene
//     ricontrollato contro l'allowlist (no redirect verso host esterni)
//   • Hardening BrowserWindow:
//       - blocco navigation fuori dal file:// dell'app
//       - blocco window.open / target=_blank (rimando a shell.openExternal)
//       - blocco webview annidate
//   • Hardening session:
//       - Content-Security-Policy iniettato come header HTTP
//       - permission request handler che nega tutto
//   • Audit log su userData/security.log con rotation a 512 KB
//
//  COMPATIBILITÀ:
//   • Solo main process (usa fs, crypto, electron app/shell)
//   • Nessuna dipendenza esterna
//   • Indipendente da Fabric.js (compatibile da v5.1.0 in poi
//     per definizione — non lo tocca proprio)
//   • Graceful degradation: se una release GitHub non ha il campo
//     `digest`, l'installer viene comunque validato per dimensione
//     e PE magic, solo l'hash viene saltato (con WARN nel log)
//
//  USO da main.js:
//     const security = require("./security");
//     // in createWindow(), prima di loadFile():
//     security.lockDownSession(mainWindow.webContents.session);
//     security.lockDownWindow(mainWindow);
//     // negli handler update:* di main.js:
//     if (!security.isGithubUrl(url)) return { ok:false, ... };
//     const v = await security.verifyDownloadedAsset(path, { digest, size });
//     if (!v.ok) { fs.unlinkSync(path); return { ok:false, ... }; }
// ============================================================

const { app, shell } = require("electron");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { URL } = require("url");

// ─── CONFIG ────────────────────────────────────────────────
const MAX_LOG_SIZE_BYTES = 512 * 1024;                  // 512 KB → rotazione
const MAX_INSTALLER_SIZE_BYTES = 500 * 1024 * 1024;     // 500 MB hard cap
const MIN_INSTALLER_SIZE_BYTES = 1 * 1024 * 1024;       // 1 MB minimo realistico

// Allowlist STRETTA dei domini GitHub usati dal sistema aggiornamenti.
// Tutto il resto (anche http://, anche sottodomini sconosciuti) viene rifiutato.
const GITHUB_EXACT_HOSTS = new Set([
  "github.com",
  "api.github.com",
  "codeload.github.com",
  "objects.githubusercontent.com",
  "release-assets.githubusercontent.com",
  "raw.githubusercontent.com"
]);

// ─── PATH HELPERS ──────────────────────────────────────────
// userData NON è disponibile prima di app.whenReady(): risolviamo lazily.
function _getLogFilePath() {
  return path.join(app.getPath("userData"), "security.log");
}

// ─── AUDIT LOG ─────────────────────────────────────────────
function _rotateLogIfNeeded(logPath) {
  try {
    if (!fs.existsSync(logPath)) return;
    const st = fs.statSync(logPath);
    if (st.size > MAX_LOG_SIZE_BYTES) {
      const backup = logPath + ".1";
      try { if (fs.existsSync(backup)) fs.unlinkSync(backup); } catch (_) {}
      try { fs.renameSync(logPath, backup); } catch (_) {}
    }
  } catch (_) {}
}

/**
 * Scrive un evento di sicurezza su userData/security.log (JSONL).
 * Anche stampa su console per debug.
 * @param {"info"|"warn"|"error"} level
 * @param {string} kind   - identificatore corto dell'evento
 * @param {object} [details]
 */
function logSecurityEvent(level, kind, details) {
  const lvl = (level === "warn" || level === "error" || level === "info") ? level : "info";
  const payload = {
    t: new Date().toISOString(),
    level: lvl,
    kind: kind || "generic",
    details: details || {}
  };

  // console mirror (utile in DevTools del main / log NSIS)
  if (lvl === "error") console.error("[security]", kind, details || "");
  else if (lvl === "warn") console.warn("[security]", kind, details || "");
  else console.log("[security]", kind, details || "");

  try {
    const logPath = _getLogFilePath();
    _rotateLogIfNeeded(logPath);
    fs.appendFileSync(logPath, JSON.stringify(payload) + "\n", "utf8");
  } catch (_) {
    // file system non disponibile / userData non pronto: ignoriamo
    // l'evento resta nella console di sistema.
  }
}

// ─── URL & FILENAME VALIDATION ─────────────────────────────
/**
 * True se l'URL è HTTPS verso un dominio GitHub noto.
 * Accetta i 5 host espliciti dell'allowlist e qualsiasi
 * sottodominio di githubusercontent.com (per i CDN asset).
 */
function isGithubUrl(u) {
  if (typeof u !== "string" || !u) return false;
  let url;
  try { url = new URL(u); } catch { return false; }
  if (url.protocol !== "https:") return false;
  if (GITHUB_EXACT_HOSTS.has(url.hostname)) return true;
  if (url.hostname.endsWith(".githubusercontent.com")) return true;
  return false;
}

/**
 * True se il filename è un installer Windows sicuro:
 *  - estensione .exe
 *  - solo caratteri ASCII safe + spazi
 *  - niente separatori di path, niente ".."
 *  - lunghezza ragionevole (<= 200 char)
 */
function validateInstallerFilename(name) {
  if (typeof name !== "string" || !name) return false;
  if (name.length > 200) return false;
  if (/[\/\\]/.test(name)) return false;
  if (name.includes("..")) return false;
  return /^[A-Za-z0-9._\- ]+\.exe$/i.test(name);
}

// ─── INTEGRITY CHECKS ──────────────────────────────────────
/**
 * True se i primi 2 byte del file sono "MZ" (0x4D 0x5A),
 * cioè il magic number degli eseguibili Windows PE.
 */
function isPEExecutable(filePath) {
  let fd = null;
  try {
    fd = fs.openSync(filePath, "r");
    const buf = Buffer.alloc(2);
    fs.readSync(fd, buf, 0, 2, 0);
    return buf[0] === 0x4D && buf[1] === 0x5A;
  } catch {
    return false;
  } finally {
    if (fd !== null) { try { fs.closeSync(fd); } catch (_) {} }
  }
}

/**
 * Calcola lo SHA-256 di un file in streaming (no caricamento in RAM).
 * @returns {Promise<string>} digest esadecimale minuscolo
 */
function sha256OfFile(filePath) {
  return new Promise((resolve, reject) => {
    try {
      const hash = crypto.createHash("sha256");
      const stream = fs.createReadStream(filePath);
      stream.on("data", (chunk) => hash.update(chunk));
      stream.on("error", (err) => reject(err));
      stream.on("end", () => resolve(hash.digest("hex").toLowerCase()));
    } catch (e) {
      reject(e);
    }
  });
}

/**
 * Verifica integrità completa di un installer scaricato.
 * Esegue, in ordine:
 *   1. esistenza del file
 *   2. dimensione entro [MIN, MAX] e (se nota) match con expected.size
 *   3. magic bytes PE
 *   4. SHA-256 (se expected.digest è presente nel formato "sha256:hex")
 *
 * Se uno qualsiasi dei controlli fallisce, ritorna { ok:false, reason }
 * e il chiamante DEVE cancellare il file e rifiutare l'installazione.
 *
 * @param {string} filePath
 * @param {{ digest?: string, size?: number }} expected
 */
async function verifyDownloadedAsset(filePath, expected) {
  expected = expected || {};

  if (!filePath || typeof filePath !== "string") {
    return { ok: false, reason: "Percorso file mancante." };
  }
  if (!fs.existsSync(filePath)) {
    return { ok: false, reason: "Il file scaricato non esiste sul disco." };
  }

  // 1. dimensione
  let stat;
  try {
    stat = fs.statSync(filePath);
  } catch (e) {
    return { ok: false, reason: "Impossibile leggere il file: " + e.message };
  }
  if (stat.size < MIN_INSTALLER_SIZE_BYTES) {
    return {
      ok: false,
      size: stat.size,
      reason: `File troppo piccolo (${stat.size} byte): possibile errore HTTP o file corrotto.`
    };
  }
  if (stat.size > MAX_INSTALLER_SIZE_BYTES) {
    return {
      ok: false,
      size: stat.size,
      reason: `File troppo grande (${stat.size} byte): superato limite di sicurezza.`
    };
  }
  if (typeof expected.size === "number" && expected.size > 0) {
    // tolleranza di 64 byte (header/padding sui CDN)
    if (Math.abs(stat.size - expected.size) > 64) {
      return {
        ok: false,
        size: stat.size,
        reason: `Dimensione file (${stat.size}) diversa da quella dichiarata da GitHub (${expected.size}).`
      };
    }
  }

  // 2. magic bytes
  if (!isPEExecutable(filePath)) {
    return {
      ok: false,
      size: stat.size,
      reason: "Il file non è un eseguibile Windows valido (manca header PE 'MZ')."
    };
  }

  // 3. SHA-256
  let actualDigest = null;
  try {
    actualDigest = await sha256OfFile(filePath);
  } catch (e) {
    return {
      ok: false,
      size: stat.size,
      reason: "Impossibile calcolare l'hash SHA-256: " + e.message
    };
  }

  if (expected.digest && typeof expected.digest === "string") {
    const m = expected.digest.match(/^sha256:([a-f0-9]{64})$/i);
    if (!m) {
      // GitHub potrebbe in futuro usare altri algoritmi: logghiamo ma non blocchiamo
      logSecurityEvent("warn", "digest_format_unknown", { digest: expected.digest });
    } else {
      const expectedHex = m[1].toLowerCase();
      if (actualDigest !== expectedHex) {
        return {
          ok: false,
          size: stat.size,
          actualDigest,
          expectedDigest: expectedHex,
          reason: "Hash SHA-256 NON corrisponde: il file potrebbe essere stato manomesso o corrotto in transito."
        };
      }
    }
  } else {
    // Release GitHub vecchie potrebbero non avere il campo digest:
    // procediamo, ma loghiamo l'evento perché è una verifica in meno.
    logSecurityEvent("warn", "digest_missing_from_release", {
      file: path.basename(filePath),
      size: stat.size,
      actualDigest
    });
  }

  return { ok: true, size: stat.size, actualDigest };
}

// ─── REDIRECT VALIDATION (per net.request) ─────────────────
/**
 * Aggancia un net.ClientRequest a controlli di redirect sicuri.
 * Va usato con net.request({ redirect: "manual", ... }).
 *
 * Comportamento:
 *  - se il redirect è verso un dominio GitHub valido → segue
 *  - se è verso qualunque altro host → ABORT + log + invoca onUnsafe
 *
 * @param {Electron.ClientRequest} req
 * @param {(url:string) => void} [onUnsafe]   callback opzionale per propagare l'errore
 */
function attachRedirectGuard(req, onUnsafe) {
  if (!req || typeof req.on !== "function") return;
  req.on("redirect", (_statusCode, _method, redirectUrl /* , headers */) => {
    if (isGithubUrl(redirectUrl)) {
      try { req.followRedirect(); } catch (_) {}
    } else {
      logSecurityEvent("error", "redirect_blocked", { redirectUrl });
      try { req.abort(); } catch (_) {}
      if (typeof onUnsafe === "function") {
        try { onUnsafe(redirectUrl); } catch (_) {}
      }
    }
  });
}

// ─── BROWSERWINDOW HARDENING ───────────────────────────────
/**
 * Aggiunge guardrail al BrowserWindow principale:
 *  - blocco navigation out-of-app (rimando a shell.openExternal se HTTPS)
 *  - blocco window.open / target=_blank
 *  - blocco creazione webview
 */
function lockDownWindow(win) {
  if (!win || win.isDestroyed()) return;
  const wc = win.webContents;

  wc.on("will-navigate", (event, url) => {
    let proto = "";
    try { proto = new URL(url).protocol; } catch (_) {}
    // Lasciamo passare solo file:// (l'app stessa) e about:blank
    if (proto === "file:" || url === "about:blank") return;
    event.preventDefault();
    logSecurityEvent("warn", "navigation_blocked", { url });
    if (proto === "https:" || proto === "http:") {
      try { shell.openExternal(url); } catch (_) {}
    }
  });

  wc.setWindowOpenHandler(({ url }) => {
    logSecurityEvent("info", "popup_blocked", { url });
    let proto = "";
    try { proto = new URL(url).protocol; } catch (_) {}
    if (proto === "https:" || proto === "http:") {
      try { shell.openExternal(url); } catch (_) {}
    }
    return { action: "deny" };
  });

  wc.on("will-attach-webview", (event, webPreferences, params) => {
    try {
      delete webPreferences.preload;
      webPreferences.nodeIntegration = false;
      webPreferences.contextIsolation = true;
    } catch (_) {}
    event.preventDefault();
    logSecurityEvent("warn", "webview_blocked", { src: params && params.src });
  });
}

// ─── SESSION HARDENING (CSP + permessi) ────────────────────
/**
 * Content-Security-Policy "pratico" per Mosaica:
 *
 *   default-src 'self' file:                  ← solo l'app stessa
 *   script-src  'self' file: 'unsafe-inline'  ← serve per gli <script> inline
 *                                                in index.html, MA niente eval
 *                                                e niente script da rete
 *   style-src   'self' file: 'unsafe-inline'  ← per gli <style> inline
 *   img-src     'self' file: data: blob:      ← texture base64 + blob canvas
 *   font-src    'self' file: data:
 *   media-src   'self' file: data: blob:
 *   connect-src 'self' file:                  ← il renderer NON parla con
 *                                                la rete: tutto via IPC →
 *                                                main → electron.net
 *   object-src 'none'                         ← niente <object>/<embed>
 *   base-uri   'self'                         ← niente <base> hijack
 *   form-action 'none'                        ← niente form submission
 *   frame-ancestors 'none'                    ← non incorporabile in iframe
 *   worker-src 'self' file: blob:             ← per il gpuWorker.js
 *
 * Notare l'assenza di 'unsafe-eval': Fabric.js 5.1.0+ non usa eval,
 * quindi possiamo permetterci la versione restrittiva.
 */
const CSP_STRING = [
  "default-src 'self' file:",
  "script-src 'self' file: 'unsafe-inline'",
  "style-src 'self' file: 'unsafe-inline'",
  "img-src 'self' file: data: blob:",
  "font-src 'self' file: data:",
  "media-src 'self' file: data: blob:",
  "connect-src 'self' file:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'none'",
  "frame-ancestors 'none'",
  "worker-src 'self' file: blob:"
].join("; ");

/**
 * Applica CSP + permission handler alla sessione del renderer.
 * Deve essere chiamato PRIMA di mainWindow.loadFile(), così la
 * prima risposta HTTP-like del protocollo file:// ha già la CSP.
 */
function lockDownSession(ses) {
  if (!ses) return;

  // 1) Permessi: Mosaica è un'app di disegno offline → neghiamo TUTTO
  //    (camera, microfono, geolocazione, notifiche, midi, clipboard-read…)
  try {
    ses.setPermissionRequestHandler((_webContents, permission, callback) => {
      logSecurityEvent("info", "permission_denied", { permission });
      callback(false);
    });
  } catch (_) {}

  if (typeof ses.setPermissionCheckHandler === "function") {
    try {
      ses.setPermissionCheckHandler((/* wc, permission */) => false);
    } catch (_) {}
  }

  // 2) Content-Security-Policy come header HTTP iniettato
  try {
    ses.webRequest.onHeadersReceived((details, callback) => {
      const headers = Object.assign({}, details.responseHeaders || {});
      // rimuovi CSP esistenti (se presenti) per evitare conflitti
      for (const k of Object.keys(headers)) {
        if (/^content-security-policy$/i.test(k)) delete headers[k];
        if (/^x-content-security-policy$/i.test(k)) delete headers[k];
      }
      headers["Content-Security-Policy"] = [CSP_STRING];
      // Header di hardening generale (no-op sul file:// ma utili
      // se mai si caricasse contenuto da http(s))
      headers["X-Content-Type-Options"] = ["nosniff"];
      headers["Referrer-Policy"] = ["no-referrer"];
      callback({ responseHeaders: headers });
    });
  } catch (e) {
    logSecurityEvent("error", "csp_install_failed", { message: e.message });
  }
}

// ─── EXPORT ────────────────────────────────────────────────
module.exports = {
  // logging
  logSecurityEvent,
  // URL/filename allowlist
  isGithubUrl,
  validateInstallerFilename,
  // integrità installer
  isPEExecutable,
  sha256OfFile,
  verifyDownloadedAsset,
  attachRedirectGuard,
  // hardening
  lockDownWindow,
  lockDownSession,
  // costanti utili per test/diagnostica
  CSP_STRING,
  MAX_INSTALLER_SIZE_BYTES,
  MIN_INSTALLER_SIZE_BYTES
};