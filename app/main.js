// main.js
const { app, BrowserWindow, ipcMain, dialog, nativeImage, Menu, shell } = require("electron");
const path = require("path");
const fs = require("fs");
const PDFDocument = require("pdfkit");

const { loadCalibration, saveCalibration } = require("./storage/calibrationStore");
const security = require("./security");

// ── 🎮 PREFERENZA GPU (portatili a doppia scheda / NVIDIA Optimus) ───────────
// Su questi PC Chromium di default usa la GPU integrata (debole, poca VRAM). Qui
// chiediamo di usare la GPU ad alte prestazioni (la dedicata, es. NVIDIA 840M con
// 2 GB): il backstore agli zoom alti ci sta comodo e il processo GPU non crasha
// più per esaurimento/timeout. Va chiamato PRIMA che l'app sia pronta. Se non c'è
// nessuna GPU dedicata, Chromium ignora la richiesta e resta sull'integrata.
app.commandLine.appendSwitch("force_high_performance_gpu");

let mainWindow;
let isRestarting = false;
let autosaveCloseInProgress = false; // protezione anti-rientro nel close handler

// rimuove definitivamente il menu nativo
Menu.setApplicationMenu(null);

// ── Recupero da crash del renderer ──────────────────────────────────────────
// Tempo minimo tra due reload automatici dopo un crash del processo di
// rendering: se i crash arrivano "a raffica" subito dopo un reload, smettiamo
// di ricaricare per non finire in un loop infinito di schermate bianche.
const CRASH_RELOAD_MIN_GAP_MS = 12000; // TUNABLE
let _lastCrashReloadAt = 0;

// ── 📋 LOG DI SESSIONE (vale sia da "npm start" sia da app installata) ────────
// In versione INSTALLATA non c'è nessun terminale: console.log non si vede da
// nessuna parte. Per questo scriviamo SEMPRE su file. Ogni avvio crea UN file di
// log nella cartella logs col nome che contiene data/ora e CHI ha avviato l'app:
//   • "dev"       = lanciata con "npm start" (sviluppo)
//   • "installed" = eseguibile installato (uso reale)
// Teniamo i MAX_LOG_FILES più recenti (i più vecchi vengono cancellati). Sia il
// NOME del file sia l'intestazione DENTRO il log riportano il produttore.
const MAX_LOG_FILES = 10; // TUNABLE: quanti log di sessione conservare
const LOG_PRODUCER = app.isPackaged ? "installed" : "dev";
let _sessionLogPath = null;

function _2d(n) { return String(n).padStart(2, "0"); }

function buildSessionLogName(date) {
  const y = date.getFullYear();
  const mo = _2d(date.getMonth() + 1);
  const d = _2d(date.getDate());
  const h = _2d(date.getHours());
  const mi = _2d(date.getMinutes());
  const s = _2d(date.getSeconds());
  // Niente ":" nel nome (illegale su Windows). Il produttore è nel nome file.
  return `mosaica_${y}-${mo}-${d}_${h}-${mi}-${s}_${LOG_PRODUCER}.log`;
}

// Riconosce SOLO i nostri file di log (per la rotazione non tocchiamo altro).
const LOG_FILE_RE = /^mosaica_\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}_(dev|installed)\.log$/;

function getSessionLogPath() {
  if (_sessionLogPath) return _sessionLogPath;
  _sessionLogPath = path.join(getUserDataSubdir("logs"), buildSessionLogName(new Date()));
  return _sessionLogPath;
}

// Scrive una riga sul log di sessione corrente (best-effort: un log mancato non
// deve mai bloccare l'app).
function appendLog(line) {
  try {
    const s = line.endsWith("\n") ? line : line + "\n";
    fs.appendFileSync(getSessionLogPath(), s, "utf8");
  } catch (_) {}
}

// Mantiene solo i MAX_LOG_FILES log più recenti (per data di modifica).
function pruneSessionLogs() {
  try {
    const dir = getUserDataSubdir("logs");
    const files = fs
      .readdirSync(dir)
      .filter((f) => LOG_FILE_RE.test(f))
      .map((f) => {
        try {
          return { name: f, path: path.join(dir, f), mtime: fs.statSync(path.join(dir, f)).mtimeMs };
        } catch {
          return null;
        }
      })
      .filter(Boolean)
      .sort((a, b) => b.mtime - a.mtime); // più recenti per primi
    for (const f of files.slice(MAX_LOG_FILES)) {
      try { fs.unlinkSync(f.path); } catch (_) {}
    }
  } catch (_) {}
}

// Intestazione di sessione: scritta una volta all'avvio (dopo app.whenReady).
function writeSessionLogHeader() {
  let version = "?";
  try { version = app.getVersion(); } catch (_) {}
  appendLog("==================================================");
  appendLog(`AVVIO MOSAICA`);
  appendLog(`  data      : ${new Date().toISOString()}`);
  appendLog(`  prodotto da: ${LOG_PRODUCER}   (dev = npm start, installed = eseguibile installato)`);
  appendLog(`  versione  : ${version}`);
  appendLog(`  platform  : ${process.platform} ${process.arch}`);
  appendLog("==================================================");
}

// ── 🛟 RECUPERO DA CRASH DEL PROCESSO GPU ────────────────────────────────────
// Il crash con schermata bianca a zoom alto ("GPU process exited unexpectedly:
// exit_code=34") NON è un crash del renderer: è il PROCESSO GPU di Chromium che
// muore (di solito TDR/OOM per il backstore enorme agli zoom alti). Per questo
// "render-process-gone" non scattava e il file di log restava vuoto: stavamo
// ascoltando il processo sbagliato.
//
// Qui intercettiamo la morte di QUALSIASI processo figlio (incluso quello GPU):
//   1) la registriamo sul log di sessione in
//      %APPDATA%\mosaica-workspace-pro\logs\ (vale anche per l'app installata);
//   2) se a morire è la GPU e la finestra è ancora viva ma "bianca", la
//      ricarichiamo UNA volta (stesso anti-loop del renderer): al ricarico
//      tryAutoOpen ripristina il progetto dal file su disco, che ora è scritto
//      in modo atomico + backup, quindi sempre integro.
// Registrato a livello di app (una volta sola) così è attivo per tutta la sessione.
app.on("child-process-gone", (_e, details) => {
  try {
    const type = (details && details.type) || "unknown";
    const reason = (details && details.reason) || "unknown";
    const code = details && details.exitCode;
    const line = `${new Date().toISOString()}  child-process-gone  type=${type}  reason=${reason}  exitCode=${code}`;
    appendLog(line);
    console.error("[crash] processo figlio perso:", type, reason, code);
  } catch (_) {}

  // Solo per la GPU tentiamo il recupero della finestra; gli altri figli
  // (utility, network, ecc.) li logghiamo soltanto: Chromium li ricrea da solo.
  const isGpu = details && details.type === "GPU";
  if (!isGpu) return;
  if (autosaveCloseInProgress || isRestarting) return; // stiamo già chiudendo

  const now = Date.now();
  if (now - _lastCrashReloadAt < CRASH_RELOAD_MIN_GAP_MS) {
    // Crash GPU subito dopo un reload → non ricaricare ancora (anti-loop).
    console.error("[crash][gpu] crash ripetuto troppo presto: niente reload automatico");
    return;
  }
  _lastCrashReloadAt = now;
  if (mainWindow && !mainWindow.isDestroyed()) {
    try { mainWindow.reload(); } catch (_) {}
  }
});

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1420,
    height: 920,
    fullscreen: true,
    autoHideMenuBar: true,
    menuBarVisible: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: false
    }
  });

  // ── 🛡️ CYBER-SECURITY: aggancia CSP, permission handler, navigation guard
  // PRIMA di loadFile, così la prima richiesta del renderer ha già le protezioni.
  try {
    security.lockDownSession(mainWindow.webContents.session);
    security.lockDownWindow(mainWindow);
  } catch (e) {
    console.error("[security] init falliti:", e);
  }

  // Carichiamo la pagina UNA SOLA volta. (Prima loadFile veniva chiamata DUE
  // volte: la pagina partiva e veniva subito ricaricata → lampo bianco
  // all'avvio. Era proprio quella la "schermata bianca all'avvio".)
  mainWindow.loadFile(path.join(__dirname, "index.html"));
  mainWindow.setFullScreen(true);

  // ── 🛟 RECUPERO DA CRASH DEL RENDERER (GPU / out-of-memory) ────────────────
  // Senza questo, quando il processo di rendering muore la finestra resta
  // bianca per sempre. Qui: (1) logghiamo il MOTIVO del crash su file, così
  // possiamo capire COSA lo causa (texture-a-tutte? pennello-lazo?), e (2)
  // ricarichiamo la pagina UNA volta: al riavvio tryAutoOpen ripristina il
  // progetto dal file su disco, che ora è scritto in modo atomico + backup
  // (vedi atomicWriteFile più sotto) quindi è sempre integro.
  mainWindow.webContents.on("render-process-gone", (_e, details) => {
    try {
      const reason = (details && details.reason) || "unknown";
      const code = details && details.exitCode;
      const line = `${new Date().toISOString()}  render-process-gone  reason=${reason}  exitCode=${code}`;
      appendLog(line);
      console.error("[crash] renderer perso:", reason, code);
    } catch (_) {}

    if (autosaveCloseInProgress || isRestarting) return; // stiamo già chiudendo

    const now = Date.now();
    if (now - _lastCrashReloadAt < CRASH_RELOAD_MIN_GAP_MS) {
      // Crash subito dopo un reload → non ricaricare ancora (anti-loop).
      console.error("[crash] crash ripetuto troppo presto: niente reload automatico");
      return;
    }
    _lastCrashReloadAt = now;
    if (mainWindow && !mainWindow.isDestroyed()) {
      try { mainWindow.reload(); } catch (_) {}
    }
  });

  // Renderer "appeso" (loop lungo): lo registriamo soltanto, senza forzare nulla.
  mainWindow.webContents.on("unresponsive", () => {
    appendLog(`${new Date().toISOString()}  renderer UNRESPONSIVE`);
    console.warn("[crash] renderer non risponde");
  });

  // ── Notifica renderer su cambio stato fullscreen ──────────────────────────
  mainWindow.on("enter-full-screen", () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("window:fullscreen-changed", true);
    }
  });
  mainWindow.on("leave-full-screen", () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("window:fullscreen-changed", false);
    }
  });

  // ── Auto-salvataggio alla chiusura ────────────────────────────────────────
  mainWindow.on("close", (e) => {
    if (isRestarting) return;
    if (autosaveCloseInProgress) return;

    e.preventDefault();
    autosaveCloseInProgress = true;

    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("autosave:close-requested");
    }

    // Watchdog: se per qualche motivo il renderer non risponde, forza chiusura.
    setTimeout(() => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        try { mainWindow.destroy(); } catch (_) {}
      }
    }, 30000);
  });
}

// ======================== PERCORSI CORRETTI (USERDATA) ========================
function getUserDataSubdir(subdir) {
  const dir = path.join(app.getPath("userData"), subdir);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

function getProjectsDir() {
  return getUserDataSubdir("projects");
}

function getTextureDir() {
  return getUserDataSubdir("textures");
}

/* ===============================
   📐 CALIBRAZIONE
================================ */
ipcMain.handle("calibration:load", () => loadCalibration());
ipcMain.handle("calibration:save", (_, data) => {
  saveCalibration(data);
  return true;
});

/* ===============================
   🖼️ TEXTURES 
================================ */

ipcMain.handle("textures:list", () => {
  const dir = getTextureDir();
  return fs
    .readdirSync(dir)
    .filter((f) => /\.(png|jpg|jpeg|gif|webp|svg)$/i.test(f))
    .map((f) => {
      const full = path.join(dir, f);
      const ext = path.extname(f).toLowerCase();
      if (ext === ".svg") {
        const txt = fs.readFileSync(full, "utf8");
        return { filename: f, dataURL: "data:image/svg+xml;charset=utf-8," + encodeURIComponent(txt) };
      }
      const buffer = fs.readFileSync(full);
      const b64 = buffer.toString("base64");
      const mime =
        ext === ".jpg" || ext === ".jpeg"
          ? "image/jpeg"
          : ext === ".gif"
            ? "image/gif"
            : ext === ".webp"
              ? "image/webp"
              : "image/png";
      return { filename: f, dataURL: `data:${mime};base64,${b64}` };
    });
});

ipcMain.handle("textures:select", async () => {
  const dir = getTextureDir();
  const { canceled, filePaths } = await dialog.showOpenDialog({
    defaultPath: dir,
    filters: [{ name: "Images", extensions: ["png", "jpg", "jpeg", "gif", "webp", "svg"] }],
    properties: ["openFile"]
  });
  if (canceled || !filePaths.length) return null;

  const src = filePaths[0];
  const dst = path.join(dir, path.basename(src));
  fs.copyFileSync(src, dst);

  const ext = path.extname(dst).toLowerCase();
  if (ext === ".svg") {
    const txt = fs.readFileSync(dst, "utf8");
    return { filename: path.basename(dst), dataURL: "data:image/svg+xml;charset=utf-8," + encodeURIComponent(txt) };
  }
  const buffer = fs.readFileSync(dst);
  const b64 = buffer.toString("base64");
  const mime =
    ext === ".jpg" || ext === ".jpeg"
      ? "image/jpeg"
      : ext === ".gif"
        ? "image/gif"
        : ext === ".webp"
          ? "image/webp"
          : "image/png";
  return { filename: path.basename(dst), dataURL: `data:${mime};base64,${b64}` };
});

/* ===============================
   🖌️ BRUSH TIPS 
================================ */
ipcMain.handle("brushes:list", async () => {
  const brushDir = path.join(getTextureDir(), "brush");
  if (!fs.existsSync(brushDir)) {
    // crea la cartella se non esiste
    fs.mkdirSync(brushDir, { recursive: true });
    return [];
  }

  const files = fs.readdirSync(brushDir).filter((f) => /\.(png|jpg|jpeg)$/i.test(f));

  return files.map((f) => {
    const full = path.join(brushDir, f);
    const buffer = fs.readFileSync(full);
    const b64 = buffer.toString("base64");
    const name = f.replace(/\.(png|jpg|jpeg)$/i, ""); // senza estensione
    return {
      filename: name,
      dataURL: `data:image/png;base64,${b64}`
    };
  });
});

/* ===============================
   📁 PROJECTS + AUTO-OPEN (Feature B completa)
================================ */

const AUTO_OPEN_FILE = path.join(app.getPath("userData"), "autoOpen.json");

ipcMain.handle("projects:list", async () => {
  const dir = getProjectsDir();
  const files = fs.readdirSync(dir).filter((f) => /\.msp\.json$/i.test(f));
  return files.map((f) => ({ filename: f, path: path.join(dir, f) }));
});

ipcMain.handle("projects:save", async (_, meta) => {
  const { canceled, filePath } = await dialog.showSaveDialog({
    defaultPath: "progetto.msp.json",
    filters: [{ name: "Mosaica Project", extensions: ["msp.json"] }]
  });
  if (canceled || !filePath) return { canceled: true };

  let finalPath = filePath.endsWith(".msp.json") ? filePath : filePath + ".msp.json";
  fs.writeFileSync(finalPath, meta.content, "utf8");
  return { path: finalPath, filename: path.basename(finalPath) };
});

ipcMain.handle("projects:openDialog", async () => {
  const dir = getProjectsDir();
  const { canceled, filePaths } = await dialog.showOpenDialog({
    defaultPath: dir,
    properties: ["openFile"],
    filters: [{ name: "Project", extensions: ["msp.json"] }]
  });
  if (canceled || !filePaths.length) return null;
  const full = filePaths[0];
  const filename = path.basename(full);
  const content = fs.readFileSync(full, "utf8");
  return { filename, content, path: full };
});

// ===== PROGETTI PALLADIANA (.mspp.json) — file SEPARATI dai progetti mosaico =====
// Stesso identico meccanismo dei progetti, ma con estensione .mspp.json e cartella
// dedicata, così le due tipologie non si mescolano mai (né in elenco né in apertura).
function getPalladianaDir() {
  return getUserDataSubdir("palladiana");
}

ipcMain.handle("palladiana:list", async () => {
  const dir = getPalladianaDir();
  const files = fs.readdirSync(dir).filter((f) => /\.mspp\.json$/i.test(f));
  return files.map((f) => ({ filename: f, path: path.join(dir, f) }));
});

ipcMain.handle("palladiana:save", async (_, meta) => {
  const { canceled, filePath } = await dialog.showSaveDialog({
    defaultPath: path.join(getPalladianaDir(), "palladiana.mspp.json"),
    filters: [{ name: "Mosaica Palladiana", extensions: ["mspp.json"] }]
  });
  if (canceled || !filePath) return { canceled: true };

  let finalPath = filePath.endsWith(".mspp.json") ? filePath : filePath + ".mspp.json";
  fs.writeFileSync(finalPath, meta.content, "utf8");
  return { path: finalPath, filename: path.basename(finalPath) };
});

ipcMain.handle("palladiana:openDialog", async () => {
  const dir = getPalladianaDir();
  const { canceled, filePaths } = await dialog.showOpenDialog({
    defaultPath: dir,
    properties: ["openFile"],
    filters: [{ name: "Mosaica Palladiana", extensions: ["mspp.json"] }]
  });
  if (canceled || !filePaths.length) return null;
  const full = filePaths[0];
  const filename = path.basename(full);
  const content = fs.readFileSync(full, "utf8");
  return { filename, content, path: full };
});

// AUTO-OPEN
ipcMain.handle("projects:setAutoOpen", async (_, fullPathOrNull) => {
  if (!fullPathOrNull) {
    if (fs.existsSync(AUTO_OPEN_FILE)) fs.unlinkSync(AUTO_OPEN_FILE);
    return { success: true };
  }
  fs.writeFileSync(AUTO_OPEN_FILE, JSON.stringify({ lastProject: fullPathOrNull }, null, 2), "utf8");
  return { success: true };
});

ipcMain.handle("projects:tryAutoOpen", async () => {
  if (!fs.existsSync(AUTO_OPEN_FILE)) return null;
  try {
    const data = JSON.parse(fs.readFileSync(AUTO_OPEN_FILE, "utf8"));
    const projectPath = data.lastProject;
    if (!projectPath || !fs.existsSync(projectPath)) return null;

    const content = fs.readFileSync(projectPath, "utf8");
    return { filename: path.basename(projectPath), content, path: projectPath };
  } catch {
    return null;
  }
});

ipcMain.handle("projects:getAutoOpen", async () => {
  if (!fs.existsSync(AUTO_OPEN_FILE)) return null;
  try {
    return JSON.parse(fs.readFileSync(AUTO_OPEN_FILE, "utf8"));
  } catch {
    return null;
  }
});

/* ===============================
   💾 AUTOSAVE (Feature C)
   ------------------------------------------------------------
   Scrittura silenziosa per il modulo autoSave.js:
    • writeToPath    → sovrascrive in-place un progetto già su disco
                       (HDD, USB, SD): usato quando currentProjectPath
                       è valorizzato.
    • writeSession   → crea/sovrascrive UN file "di sessione" in
                       userData/projects/ con nome data+ora italiana
                       (es. "1 Aprile 2026 - 15:00.msp.json").
    • pruneSessions  → mantiene massimo MAX_SESSION_FILES file di
                       sessione (riconosciuti dal pattern del nome),
                       cancellando i più vecchi per mtime. Il file
                       corrente è sempre preservato.
    • confirm-close  → chiamato dal renderer dopo l'autosave di
                       chiusura: distrugge la finestra.
    • abort-close    → chiamato dal renderer se l'utente annulla la
                       chiusura: ripristina lo stato di "non in
                       chiusura" così X funzionerà di nuovo.
================================ */

const MAX_SESSION_FILES = 10;

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

function buildSessionFileName(date) {
  const d = date.getDate();
  const m = MESI_IT[date.getMonth()];
  const y = date.getFullYear();
  const h = String(date.getHours()).padStart(2, "0");
  const min = String(date.getMinutes()).padStart(2, "0");
  // NB: usiamo "&" come separatore (es. "15&30") perché ":" è illegale
  // nei nomi file su Windows (riservato agli Alternate Data Streams di NTFS):
  // userebbe il ":" come separatore di stream, troncando il nome visibile
  // a "... - 15" e producendo un file principale da 0 KB senza estensione.
  // Tenere allineato con buildSessionFileName() in autoSave.js.
  return `${d} ${m} ${y} - ${h}&${min}.msp.json`;
}

// Pattern per riconoscere SOLO i file generati dall'autosave
// (così non tocchiamo mai i progetti che l'utente ha salvato manualmente
//  con altri nomi).
// Accetta sia "&" (formato nuovo, corretto) sia ":" (formato vecchio,
// difettoso su Windows) per permettere il pruning degli eventuali file
// legacy ancora presenti in %APPDATA%\mosaica-workspace-pro\projects.
const SESSION_FILE_RE =
  /^\d{1,2} (Gennaio|Febbraio|Marzo|Aprile|Maggio|Giugno|Luglio|Agosto|Settembre|Ottobre|Novembre|Dicembre) \d{4} - \d{2}[&:]\d{2}\.msp\.json$/;

// ── SCRITTURA SICURA: atomica + backup rotanti ───────────────────────────────
// Prima qui c'era un fs.writeFileSync diretto sul file del progetto. Due rischi
// mortali:
//   1) crash A METÀ scrittura → il file restava troncato (0 KB / JSON rotto) e
//      il progetto era irrecuperabile;
//   2) se per qualunque motivo arrivava un canvas vuoto, sovrascriveva il lavoro
//      buono e basta, senza rete di salvataggio.
// Adesso:
//   • scriviamo su <file>.tmp e poi rinominiamo (rename è ATOMICO sullo stesso
//     volume): o c'è il vecchio file integro, o c'è il nuovo integro. Mai a metà.
//   • prima di sovrascrivere copiamo la versione buona in <file>.bak1, ruotando
//     i backup precedenti (.bak1 → .bak2). Così anche se finisse salvato qualcosa
//     di sbagliato, il lavoro è SEMPRE recuperabile rinominando il .bak1.
const PROJECT_BACKUP_COUNT = 2; // quanti .bakN tenere accanto al progetto (TUNABLE)

function atomicWriteFile(targetPath, content, makeBackups) {
  const tmpPath = targetPath + ".tmp";

  // 1) Scrivi sul temporaneo (se questo fallisce, il file originale è intatto).
  fs.writeFileSync(tmpPath, content, "utf8");

  // 2) Ruota i backup della versione ATTUALMENTE su disco (best-effort: un
  //    backup mancato non deve mai bloccare il salvataggio vero).
  if (makeBackups) {
    try {
      if (fs.existsSync(targetPath) && PROJECT_BACKUP_COUNT >= 1) {
        // Elimina il più vecchio.
        const oldest = targetPath + ".bak" + PROJECT_BACKUP_COUNT;
        try { if (fs.existsSync(oldest)) fs.unlinkSync(oldest); } catch (_) {}
        // Sposta .bak(i) → .bak(i+1) dal penultimo verso il basso.
        for (let i = PROJECT_BACKUP_COUNT - 1; i >= 1; i--) {
          const from = targetPath + ".bak" + i;
          const to = targetPath + ".bak" + (i + 1);
          try { if (fs.existsSync(from)) fs.renameSync(from, to); } catch (_) {}
        }
        // La versione buona attuale diventa .bak1 (copia: l'originale resta finché
        // non facciamo il rename atomico al punto 3).
        try { fs.copyFileSync(targetPath, targetPath + ".bak1"); } catch (_) {}
      }
    } catch (_) {}
  }

  // 3) Commit atomico: il temporaneo diventa il file vero.
  fs.renameSync(tmpPath, targetPath);
}

ipcMain.handle("autosave:writeToPath", async (_, payload) => {
  if (!payload || !payload.path || typeof payload.content !== "string") {
    return { error: "Parametri mancanti" };
  }
  try {
    const dir = path.dirname(payload.path);
    if (!fs.existsSync(dir)) {
      // Il supporto rimovibile (USB/SD) potrebbe essere stato scollegato.
      return { error: "Cartella non più disponibile: " + dir };
    }
    atomicWriteFile(payload.path, payload.content, /* makeBackups */ true);
    return { path: payload.path, filename: path.basename(payload.path) };
  } catch (e) {
    // Pulizia best-effort del temporaneo se il rename non è andato a buon fine.
    try { fs.unlinkSync(payload.path + ".tmp"); } catch (_) {}
    return { error: e.message };
  }
});

ipcMain.handle("autosave:writeSession", async (_, payload) => {
  if (!payload || typeof payload.sessionDateMs !== "number" || typeof payload.content !== "string") {
    return { error: "Parametri mancanti" };
  }
  try {
    const dir = getProjectsDir();
    const filename = buildSessionFileName(new Date(payload.sessionDateMs));
    const full = path.join(dir, filename);
    // I file di sessione hanno già la rotazione dei 10 più recenti come backup:
    // qui basta la scrittura atomica (niente .bak per non moltiplicare i file).
    atomicWriteFile(full, payload.content, /* makeBackups */ false);
    return { path: full, filename };
  } catch (e) {
    return { error: e.message };
  }
});

ipcMain.handle("autosave:pruneSessions", async (_, currentFilename) => {
  try {
    const dir = getProjectsDir();
    const files = fs
      .readdirSync(dir)
      .filter((f) => SESSION_FILE_RE.test(f))
      .map((f) => {
        try {
          return { name: f, path: path.join(dir, f), mtime: fs.statSync(path.join(dir, f)).mtimeMs };
        } catch {
          return null;
        }
      })
      .filter(Boolean)
      .sort((a, b) => b.mtime - a.mtime); // più recenti per primi

    const toDelete = files.slice(MAX_SESSION_FILES);
    const deleted = [];
    for (const f of toDelete) {
      if (currentFilename && f.name === currentFilename) continue; // mai cancellare il corrente
      try {
        fs.unlinkSync(f.path);
        deleted.push(f.name);
      } catch (_) {}
    }
    return {
      kept: files.slice(0, MAX_SESSION_FILES).map((f) => f.name),
      deleted
    };
  } catch (e) {
    return { error: e.message };
  }
});

ipcMain.handle("autosave:confirm-close", () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    try {
      mainWindow.destroy();
    } catch (_) {}
  }
  return { closed: true };
});

ipcMain.handle("autosave:abort-close", () => {
  // L'utente ha annullato la chiusura: rimettiamo il flag a false
  // così il prossimo close (X / Alt+F4) ripartirà da capo.
  autosaveCloseInProgress = false;
  return { aborted: true };
});

/* ===============================
   📄 EXPORT PDF
================================ */
ipcMain.handle("export-pdf-image", async (_, payload) => {
  // Retrocompatibilità: accetta sia stringa (vecchio formato) sia oggetto
  const imgData = typeof payload === "string" ? payload : payload?.imgData;
  const orientation = (typeof payload === "object" && payload?.orientation) || "portrait";
  if (!imgData) return null;

  const { filePath } = await dialog.showSaveDialog({
    defaultPath: "mosaico_A4.pdf",
    filters: [{ name: "PDF", extensions: ["pdf"] }]
  });
  if (!filePath) return null;

  // A4 in points (PDFKit): 595.28 x 841.89
  const pageW = orientation === "landscape" ? 841.89 : 595.28;
  const pageH = orientation === "landscape" ? 595.28 : 841.89;

  const doc = new PDFDocument({
    size: "A4",
    layout: orientation === "landscape" ? "landscape" : "portrait",
    margin: 0
  });
  const stream = fs.createWriteStream(filePath);
  doc.pipe(stream);

  // Decodifica diretta del PNG senza passare da nativeImage → preserva la qualità originale
  const base64 = imgData.split(",")[1];
  const buffer = Buffer.from(base64, "base64");

  // fit copre l'intera pagina A4 mantenendo proporzioni (canvas è già A4 reale)
  doc.image(buffer, 0, 0, { fit: [pageW, pageH] });

  doc.end();
  await new Promise((r) => stream.on("finish", r));
  return filePath;
});

/* ===============================
   🖼️ EXPORT FULL CANVAS PNG (nuovo – coerente con PDF e Freehand)
================================ */
ipcMain.handle("export-full-png", async (_, dataURL) => {
  const { canceled, filePath } = await dialog.showSaveDialog({
    defaultPath: "mosaico_completo.png",
    filters: [{ name: "PNG Image", extensions: ["png"] }]
  });

  if (canceled || !filePath) return null;

  // dataURL è già base64 → estraiamo solo la parte dopo la virgola
  const base64Data = dataURL.split(",")[1];
  const buffer = Buffer.from(base64Data, "base64");

  fs.writeFileSync(filePath, buffer);
  return filePath;
});

/* ===============================
   🧩 EXPORT SHAPES SVG (solo forme — vettoriale)
================================ */
ipcMain.handle("export-shapes-svg", async (_, svgContent) => {
  if (!svgContent || typeof svgContent !== "string") return null;

  const { canceled, filePath } = await dialog.showSaveDialog({
    defaultPath: "mosaico_forme.svg",
    filters: [{ name: "SVG Vector", extensions: ["svg"] }]
  });

  if (canceled || !filePath) return null;

  fs.writeFileSync(filePath, svgContent, "utf8");
  return filePath;
});

/* ===============================
   ✏️ EXPORT FREEHAND SVG/PNG (singolo o multipli)
================================ */
ipcMain.handle("export-freehand", async (_, payload) => {
  const { type, files } = payload; // files = [{filename, content}]
  if (!files || files.length === 0) return false;

  for (let f of files) {
    const filters =
      type === "svg"
        ? [{ name: "SVG vettoriale", extensions: ["svg"] }]
        : [{ name: "PNG alta risoluzione", extensions: ["png"] }];

    const { canceled, filePath } = await dialog.showSaveDialog({
      defaultPath: f.filename,
      filters
    });
    if (canceled || !filePath) continue;

    try {
      if (type === "svg") {
        fs.writeFileSync(filePath, f.content, "utf8");
      } else {
        const buffer = Buffer.from(f.content, "base64");
        fs.writeFileSync(filePath, buffer);
      }
    } catch (err) {
      console.error("Errore salvataggio freehand:", err);
    }
  }
  return true;
});

/* ===============================
   🔄 RESTART APP (CTRL + R)
================================ */
ipcMain.handle("app:restart", () => {
  isRestarting = true;
  app.relaunch();
  app.quit();
});

/* ===============================
   ⛶ FULLSCREEN CONTROL (gestione finestra)
================================ */
ipcMain.on("window:set-fullscreen", (_, flag) => {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.setFullScreen(!!flag);
});

ipcMain.handle("window:is-fullscreen", () => {
  return !!(mainWindow && !mainWindow.isDestroyed() && mainWindow.isFullScreen());
});

// ======================== COPIA DEFAULT TEXTURES (RICORSIVA) ========================
async function copyDefaultTextures() {
  const texturesDir = getTextureDir();

  const sourceDir = app.isPackaged ? path.join(process.resourcesPath, "textures") : path.join(__dirname, "textures");

  if (!fs.existsSync(sourceDir)) return;

  function copyRecursive(src, dest) {
    if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true });

    const entries = fs.readdirSync(src, { withFileTypes: true });

    for (const entry of entries) {
      const srcPath = path.join(src, entry.name);
      const destPath = path.join(dest, entry.name);

      if (entry.isDirectory()) {
        copyRecursive(srcPath, destPath);
      } else if (/\.(png|jpg|jpeg|gif|webp|svg)$/i.test(entry.name)) {
        if (!fs.existsSync(destPath)) {
          fs.copyFileSync(srcPath, destPath);
          console.log(`[Textures] Copiato: ${entry.name} → ${destPath}`);
        }
      }
    }
  }

  copyRecursive(sourceDir, texturesDir);
}

/* ===============================
   🖼️ PAPER TEXTURE (carta.png)
================================ */
ipcMain.handle("papertexture:get", async () => {
  const texturesDir = getTextureDir();
  const cartaPath = path.join(texturesDir, "brush", "texture-carta", "carta.png");

  if (!fs.existsSync(cartaPath)) {
    console.warn("[PaperTexture] carta.png NON trovata in userData");
    return null;
  }

  const buffer = fs.readFileSync(cartaPath);
  const b64 = buffer.toString("base64");
  return `data:image/png;base64,${b64}`;
});

/* ===============================
   📖 GUIDA UTENTE (VERSIONE PRODUZIONE CORRETTA)
   ------------------------------------------------------------
   Multilingua: il renderer passa la lingua corrente (i18n) come
   argomento. "en" → Guida_utente_EN.html, qualunque altro valore
   (compreso undefined / "it" / lingue non ancora tradotte) →
   Guida_utente.html (italiano, fallback sicuro).
================================ */
ipcMain.handle("open-guide", async (_event, lang) => {
  // Scelta del file in base alla lingua. Normalizziamo a minuscolo
  // per accettare sia "en" che "EN", "en-US" ecc. Default = IT.
  const langLower = typeof lang === "string" ? lang.toLowerCase() : "it";
  const isEnglish = langLower === "en" || langLower.startsWith("en-") || langLower.startsWith("en_");
  const guideFile = isEnglish ? "Guida_utente_EN.html" : "Guida_utente.html";

  let guidePath;

  if (app.isPackaged) {
    // ← Dopo l'installazione (exe / installer)
    guidePath = path.join(process.resourcesPath, guideFile);
  } else {
    // ← Sviluppo
    guidePath = path.join(__dirname, guideFile);
  }

  // Debug utile
  console.log("[open-guide] Lingua richiesta:", langLower, "→ file:", guideFile);
  console.log("[open-guide] Tentativo apertura:", guidePath);
  console.log("[open-guide] File esiste?", fs.existsSync(guidePath));

  // Fallback robusto: se il file specifico della lingua non esiste
  // (es. lingua aggiunta in futuro senza guida tradotta), cadiamo
  // sull'italiano invece di restituire errore — l'utente vede pur
  // sempre una guida invece di un toast d'errore.
  if (!fs.existsSync(guidePath) && isEnglish) {
    console.warn("[open-guide] Guida EN non trovata, fallback a IT");
    guidePath = app.isPackaged
      ? path.join(process.resourcesPath, "Guida_utente.html")
      : path.join(__dirname, "Guida_utente.html");
  }

  if (!fs.existsSync(guidePath)) {
    console.error("[open-guide] ❌ Guida utente NON trovata!");
    return { success: false, error: "File guida non trovato dopo l'installazione" };
  }

  const fileUrl = `file://${guidePath.replace(/\\/g, "/")}`;
  await shell.openExternal(fileUrl);
  return { success: true };
});

/* ===============================
   🖊️ WACOM TABLET — Rilevazione + apertura app preferenze
   ------------------------------------------------------------
   1. wacom:detect-devices → WMI query su Win32_PnPEntity per
      tutti i device contenenti "Wacom" o "Bamboo" nel nome.
      Filtra solo quelli connessi (Status = "OK").
   2. wacom:open-preferences → cerca l'eseguibile dell'app
      "Wacom Desktop Center" o "Wacom Tablet Properties" nei
      percorsi standard e lo lancia via shell.openPath.
   3. wacom:get-info → info statiche sulla piattaforma per UI.
================================ */
const { exec } = require("child_process");

ipcMain.handle("wacom:detect-devices", async () => {
  if (process.platform !== "win32") {
    return []; // supportato solo su Windows per ora
  }

  return new Promise((resolve) => {
    // WMIC è deprecato ma ancora presente in Win10/11; in caso di
    // fallimento (es. WMIC rimosso) fallback PowerShell Get-PnpDevice.
    const wmicCmd =
      "wmic path Win32_PnPEntity where \"(Name like '%Wacom%' OR Name like '%Bamboo%') AND Status='OK'\" get Name,DeviceID,Manufacturer /format:csv";

    exec(wmicCmd, { timeout: 6000, windowsHide: true }, (err, stdout) => {
      if (!err && stdout && stdout.trim().length > 0) {
        const devices = _parseWmicCsv(stdout);
        if (devices.length > 0) return resolve(devices);
      }

      // Fallback PowerShell (Win10+ ha sempre Get-PnpDevice)
      const psCmd =
        "powershell -NoProfile -Command \"Get-PnpDevice -Status OK | Where-Object { $_.FriendlyName -match 'Wacom|Bamboo' } | Select-Object FriendlyName,InstanceId,Manufacturer | ConvertTo-Json -Compress\"";
      exec(psCmd, { timeout: 6000, windowsHide: true }, (psErr, psStdout) => {
        if (psErr || !psStdout) {
          console.warn("[Wacom] Detect fallito (wmic + ps):", err?.message, psErr?.message);
          return resolve([]);
        }
        try {
          let parsed = JSON.parse(psStdout.trim());
          if (!Array.isArray(parsed)) parsed = [parsed];
          const devices = parsed.map((d) => ({
            name: d.FriendlyName || "Wacom Device",
            deviceId: d.InstanceId || "",
            manufacturer: d.Manufacturer || "Wacom"
          }));
          resolve(devices);
        } catch (parseErr) {
          console.warn("[Wacom] PS parse fallito:", parseErr);
          resolve([]);
        }
      });
    });
  });
});

function _parseWmicCsv(stdout) {
  const lines = stdout.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) return [];
  // Header CSV: Node,DeviceID,Manufacturer,Name
  const header = lines[0].split(",").map((h) => h.trim().toLowerCase());
  const idxName = header.indexOf("name");
  const idxId = header.indexOf("deviceid");
  const idxMfg = header.indexOf("manufacturer");

  const out = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(",");
    const name = idxName >= 0 ? (cols[idxName] || "").trim() : "";
    if (!name) continue;
    out.push({
      name,
      deviceId: idxId >= 0 ? (cols[idxId] || "").trim() : "",
      manufacturer: idxMfg >= 0 ? (cols[idxMfg] || "").trim() : "Wacom"
    });
  }
  return out;
}

ipcMain.handle("wacom:open-preferences", async () => {
  if (process.platform !== "win32") {
    return { success: false, error: "Supportato solo su Windows" };
  }

  // Percorsi candidati ESTESI per l'app Wacom — ordinati per probabilità
  // di trovarli, dal più moderno al più legacy.
  const candidates = [
    // ── Wacom Center / Desktop Center (driver 6.4+) ──
    "C:\\Program Files\\Tablet\\Wacom\\WacomCenter.exe",
    "C:\\Program Files\\Tablet\\Wacom\\WacomDesktopCenter.exe",
    "C:\\Program Files (x86)\\Tablet\\Wacom\\WacomCenter.exe",
    "C:\\Program Files (x86)\\Tablet\\Wacom\\WacomDesktopCenter.exe",
    // ── Wacom Tablet Properties (la GUI principale dei driver moderni) ──
    "C:\\Program Files\\Tablet\\Wacom\\Wacom Tablet Properties.exe",
    "C:\\Program Files\\Tablet\\Wacom\\WacomTabletProperties.exe",
    "C:\\Program Files (x86)\\Tablet\\Wacom\\Wacom Tablet Properties.exe",
    "C:\\Program Files (x86)\\Tablet\\Wacom\\WacomTabletProperties.exe",
    // ── Pen Tablet (driver intermedi) ──
    "C:\\Program Files\\Tablet\\Wacom\\Pen Tablet.exe",
    "C:\\Program Files (x86)\\Tablet\\Wacom\\Pen Tablet.exe",
    "C:\\Program Files\\Tablet\\Wacom\\32\\Pen_TabletUser.exe",
    "C:\\Program Files\\Tablet\\Wacom\\64\\Pen_TabletUser.exe",
    // ── Control Panel applet (vecchi driver) ──
    "C:\\Program Files\\Tablet\\Wacom\\WacomTabletControlPanel.exe",
    "C:\\Program Files (x86)\\Tablet\\Wacom\\WacomTabletControlPanel.exe",
    // ── Bamboo CTL-460 / Bamboo Pen — driver legacy ──
    "C:\\Program Files\\Tablet\\Pen\\Pen_TabletUser.exe",
    "C:\\Program Files (x86)\\Tablet\\Pen\\Pen_TabletUser.exe",
    "C:\\Program Files\\Bamboo Dock\\Bamboo Dock.exe",
    "C:\\Program Files (x86)\\Bamboo Dock\\Bamboo Dock.exe",
    "C:\\Program Files\\Tablet\\Bamboo\\Bamboo Dock.exe",
    "C:\\Program Files (x86)\\Tablet\\Bamboo\\Bamboo Dock.exe",
    "C:\\Program Files\\Bamboo\\Bamboo.exe",
    "C:\\Program Files (x86)\\Bamboo\\Bamboo.exe"
  ];

  // ── Helper: lancia un eseguibile in modo che emerga in foreground ──
  // Su Windows, shell.openPath() non porta sempre la finestra davanti
  // quando l'app chiamante è fullscreen. Usiamo "cmd /c start" che
  // ha un comportamento di foreground migliore (Windows lo gestisce
  // come fosse l'utente a doppio-clic dal desktop).
  function launchForeground(exePath) {
    return new Promise((resolve) => {
      // start "" "C:\path\to\app.exe"  — il primo "" è il titolo finestra
      const cmd = `start "" "${exePath}"`;
      exec(cmd, { windowsHide: true }, (err) => {
        resolve(!err);
      });
    });
  }

  // ── Cede la scena: se Mosaica è fullscreen, ne usciamo. Se è
  // alwaysOnTop, lo disabilitiamo. Poi blur() per cedere il focus.
  // Non ripristiniamo automaticamente: l'utente premerà F11 (o lo
  // shortcut Mosaica) quando avrà finito di configurare Wacom.
  function yieldStageToOtherApp() {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    try {
      if (mainWindow.isAlwaysOnTop()) mainWindow.setAlwaysOnTop(false);
      if (mainWindow.isFullScreen()) mainWindow.setFullScreen(false);
      // Piccolo delay perché Windows rifletta il cambio di stato
      // PRIMA di lanciare l'app esterna, così questa emerge subito sopra.
      setTimeout(() => {
        try {
          mainWindow.blur();
        } catch (_) {}
      }, 80);
    } catch (e) {
      console.warn("[Wacom] yieldStage err:", e);
    }
  }

  // Provo tutti i candidati uno per uno: il primo che esiste viene lanciato
  for (const p of candidates) {
    if (fs.existsSync(p)) {
      yieldStageToOtherApp();
      // Piccolo delay perché il fullscreen-exit prenda effetto su Windows
      await new Promise((r) => setTimeout(r, 120));
      const ok = await launchForeground(p);
      if (ok) {
        console.log("[Wacom] Aperto (foreground):", p);
        return { success: true, path: p };
      }
      console.warn("[Wacom] launchForeground fallito su", p);
    }
  }

  // FALLBACK 1: control.exe con applet (driver vecchi)
  try {
    const cplCandidates = ["Wacom Tablet.cpl", "WacomTablet.cpl", "Bamboo.cpl"];
    for (const cpl of cplCandidates) {
      const cplPath = `C:\\Windows\\System32\\${cpl}`;
      if (fs.existsSync(cplPath)) {
        yieldStageToOtherApp();
        await new Promise((r) => setTimeout(r, 120));
        await new Promise((resolve) => {
          exec(`control.exe "${cpl}"`, { windowsHide: true }, () => resolve());
        });
        return { success: true, path: cplPath };
      }
    }
  } catch (e) {
    console.warn("[Wacom] Fallback control.exe fallito:", e);
  }

  // FALLBACK 2: Pannello "Penna e tocco" di Windows
  try {
    yieldStageToOtherApp();
    await new Promise((r) => setTimeout(r, 120));
    await new Promise((resolve) => {
      exec("control.exe /name Microsoft.PenAndTouch", { windowsHide: true }, () => resolve());
    });
    return {
      success: true,
      path: "Penna e tocco",
      note: "App Wacom non trovata: aperto pannello 'Penna e tocco' di Windows come ripiego."
    };
  } catch (_) {}

  return { success: false, error: "App Wacom non trovata — verifica che il driver sia installato correttamente" };
});

ipcMain.handle("wacom:get-info", async () => {
  return {
    platform: process.platform,
    supported: process.platform === "win32"
  };
});

/* ===============================
   🌐 LINGUA (i18n)
   ------------------------------------------------------------
   Gestione della lingua dell'interfaccia utente.
   Persistenza su userData/language.json: { "lang": "it" | "en" }.

   Priorità all'avvio (resolveLanguage):
     1) file language.json (scelta esplicita dell'utente)
     2) argomento CLI --lang=XX (es. passato dall'installer NSIS)
     3) locale di sistema mappato a una lingua supportata
     4) default "it"

   Cambio lingua: il renderer chiama "language:setLanguage" e poi
   ricarica la finestra; nessun riavvio del processo main richiesto.
================================ */

const LANGUAGE_FILE = path.join(app.getPath("userData"), "language.json");
const SUPPORTED_LANGS = ["it", "en"];
const DEFAULT_LANG = "it";

function parseCliLang() {
  try {
    const arg = process.argv.find((a) => /^--lang=/i.test(a));
    if (!arg) return null;
    const v = arg.split("=")[1];
    return SUPPORTED_LANGS.includes(v) ? v : null;
  } catch (_) {
    return null;
  }
}

function readLanguageFile() {
  try {
    if (!fs.existsSync(LANGUAGE_FILE)) return null;
    const data = JSON.parse(fs.readFileSync(LANGUAGE_FILE, "utf8"));
    return data && SUPPORTED_LANGS.includes(data.lang) ? data.lang : null;
  } catch {
    return null;
  }
}

function resolveLanguage() {
  // 1) File esplicito (scelta dell'utente)
  const fromFile = readLanguageFile();
  if (fromFile) return fromFile;

  // 2) Argomento CLI (utile per l'installer NSIS: --lang=en)
  //    Se presente, lo persistiamo subito così al prossimo avvio
  //    non serve più rileggerlo dalla command line.
  const fromCli = parseCliLang();
  if (fromCli) {
    try {
      fs.writeFileSync(LANGUAGE_FILE, JSON.stringify({ lang: fromCli }, null, 2), "utf8");
    } catch (_) {}
    return fromCli;
  }

  // 3) Locale di sistema (disponibile dopo app.whenReady())
  try {
    const locale = typeof app.getLocale === "function" ? app.getLocale().toLowerCase() : "";
    if (locale) {
      const short = locale.split(/[-_]/)[0];
      if (SUPPORTED_LANGS.includes(short)) return short;
    }
  } catch (_) {}

  // 4) Default
  return DEFAULT_LANG;
}

ipcMain.handle("language:getLanguage", async () => {
  return resolveLanguage();
});

ipcMain.handle("language:setLanguage", async (_, lang) => {
  if (!SUPPORTED_LANGS.includes(lang)) {
    return { success: false, error: "Lingua non supportata" };
  }
  try {
    fs.writeFileSync(LANGUAGE_FILE, JSON.stringify({ lang }, null, 2), "utf8");
    return { success: true, lang };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle("language:getAvailableLanguages", async () => {
  return SUPPORTED_LANGS.slice();
});

/* ===============================
   🔄 SISTEMA AGGIORNAMENTI (GitHub Releases)
   ------------------------------------------------------------
   • update:get-platform-info  → versione locale + piattaforma + isPackaged
   • update:fetch-latest       → JSON dell'ultima release da GitHub API
   • update:download-asset     → scarica l'installer (.exe) con progress IPC
   • update:cancel-download    → annulla il download in corso
   • update:install-and-quit   → spawn detached + close finestra (autosave OK)
   • update:get-settings / set-settings → persistenza su update-settings.json

   Sicurezza:
   • Solo URL su GitHub (github.com / githubusercontent.com).
   • Validazione tag/asset nel renderer; qui niente esecuzione di codice
     arrivato dall'API: ci limitiamo a fare GET + write su disco.
================================ */
const { net } = require("electron");

const UPDATE_SETTINGS_FILE = path.join(app.getPath("userData"), "update-settings.json");
let activeDownloadRequest = null;     // riferimento alla net.request in corso
let activeDownloadStream = null;      // write stream del file in corso
let activeDownloadPath = null;        // path dell'installer parziale
let pendingInstallerPath = null;      // installer da lanciare al quit
let downloadCancelled = false;        // flag annullamento (interrompe i retry)

// Attesa interrompibile (per il backoff tra un tentativo e l'altro):
// si sblocca subito se l'utente annulla, senza aspettare l'intero ritardo.
function _interruptibleWait(ms, shouldCancel) {
  return new Promise((resolve) => {
    const step = 200;
    let elapsed = 0;
    const id = setInterval(() => {
      elapsed += step;
      if (elapsed >= ms || (typeof shouldCancel === "function" && shouldCancel())) {
        clearInterval(id);
        resolve();
      }
    }, step);
  });
}

function _getUpdatesDir() {
  const d = path.join(app.getPath("userData"), "updates");
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
  return d;
}

function _isGithubUrl(u) {
  return security.isGithubUrl(u);
}

ipcMain.handle("update:get-platform-info", () => {
  return {
    platform: process.platform,
    isPackaged: app.isPackaged,
    version: app.getVersion()
  };
});

ipcMain.handle("update:get-settings", () => {
  try {
    if (!fs.existsSync(UPDATE_SETTINGS_FILE)) {
      return { autoCheckOnStartup: true, skipVersion: null, lastCheckTs: 0 };
    }
    const data = JSON.parse(fs.readFileSync(UPDATE_SETTINGS_FILE, "utf8"));
    return {
      autoCheckOnStartup: data.autoCheckOnStartup !== false,
      skipVersion: data.skipVersion || null,
      lastCheckTs: data.lastCheckTs || 0
    };
  } catch {
    return { autoCheckOnStartup: true, skipVersion: null, lastCheckTs: 0 };
  }
});

ipcMain.handle("update:set-settings", (_e, settings) => {
  try {
    const safe = {
      autoCheckOnStartup: settings && settings.autoCheckOnStartup !== false,
      skipVersion: (settings && settings.skipVersion) || null,
      lastCheckTs: (settings && settings.lastCheckTs) || 0
    };
    fs.writeFileSync(UPDATE_SETTINGS_FILE, JSON.stringify(safe, null, 2), "utf8");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle("update:fetch-latest", (_e, owner, repo) => {
  return new Promise((resolve, reject) => {
    if (!owner || !repo || !/^[a-zA-Z0-9._-]+$/.test(owner) || !/^[a-zA-Z0-9._-]+$/.test(repo)) {
      security.logSecurityEvent("warn", "fetch_latest_bad_args", { owner, repo });
      return reject(new Error("Owner/repo non validi"));
    }
    const url = `https://api.github.com/repos/${owner}/${repo}/releases/latest`;
    if (!security.isGithubUrl(url)) {
      // Paranoia: l'URL costruito DEVE matchare l'allowlist.
      security.logSecurityEvent("error", "fetch_latest_url_rejected", { url });
      return reject(new Error("URL API non valido"));
    }

    const req = net.request({ method: "GET", url, redirect: "manual" });
    req.setHeader("User-Agent", "Mosaica-Workspace-Pro-Updater");
    req.setHeader("Accept", "application/vnd.github+json");

    // Redirect guard: api.github.com → segui solo se ancora GitHub
    security.attachRedirectGuard(req, (badUrl) => {
      reject(new Error("Redirect bloccato verso host esterno: " + badUrl));
    });

    const timeoutId = setTimeout(() => {
      try { req.abort(); } catch (_) {}
      reject(new Error("Timeout richiesta GitHub"));
    }, 15000);

    req.on("response", (response) => {
      let chunks = "";
      response.on("data", (chunk) => { chunks += chunk.toString("utf8"); });
      response.on("end", () => {
        clearTimeout(timeoutId);
        if (response.statusCode !== 200) {
          security.logSecurityEvent("warn", "fetch_latest_http_error", { status: response.statusCode });
          return reject(new Error(`GitHub API HTTP ${response.statusCode}`));
        }
        // Limite difensivo sulla dimensione della risposta JSON
        if (chunks.length > 2 * 1024 * 1024) {
          security.logSecurityEvent("warn", "fetch_latest_response_too_big", { bytes: chunks.length });
          return reject(new Error("Risposta GitHub troppo grande"));
        }
        try {
          resolve(JSON.parse(chunks));
        } catch (e) {
          security.logSecurityEvent("warn", "fetch_latest_parse_error", { message: e.message });
          reject(new Error("Risposta GitHub non valida: " + e.message));
        }
      });
      response.on("error", (err) => { clearTimeout(timeoutId); reject(err); });
    });
    req.on("error", (err) => { clearTimeout(timeoutId); reject(err); });
    req.end();
  });
});

ipcMain.handle("update:download-asset", async (event, args) => {
  const { url, filename, expectedSize, expectedDigest } = args || {};

  // ── Validazioni iniziali (allowlist URL + nome file)
  if (!url || !security.isGithubUrl(url)) {
    security.logSecurityEvent("error", "download_url_rejected", { url });
    return { ok: false, error: "URL non consentito (deve essere su github.com)" };
  }
  if (!security.validateInstallerFilename(filename)) {
    security.logSecurityEvent("error", "download_filename_rejected", { filename });
    return { ok: false, error: "Nome file installer non valido" };
  }

  const dir = _getUpdatesDir();
  const destPath = path.join(dir, filename);
  const tmpPath = destPath + ".part";

  // ── Cleanup: rimuoviamo i vecchi .exe e i .part di ALTRI file.
  //    Il .part dello STESSO file lo lasciamo: serve per riprendere un
  //    download interrotto (anche dopo un riavvio dell'app). L'integrità
  //    finale è comunque garantita dalla verifica SHA-256 prima di installare.
  try {
    for (const f of fs.readdirSync(dir)) {
      if (/\.exe$/i.test(f)) {
        try { fs.unlinkSync(path.join(dir, f)); } catch (_) {}
      } else if (/\.part$/i.test(f) && f !== (filename + ".part")) {
        try { fs.unlinkSync(path.join(dir, f)); } catch (_) {}
      }
    }
  } catch (_) {}

  activeDownloadPath = tmpPath;
  downloadCancelled = false;

  // ── Parametri di robustezza
  const MAX_ATTEMPTS = 8;            // tentativi totali (incluso il primo)
  const STALL_TIMEOUT_MS = 30000;    // 30s senza dati => stallo => si riprende
  const BASE_BACKOFF_MS = 1500;      // attesa iniziale fra un tentativo e l'altro
  const MAX_BACKOFF_MS = 15000;      // tetto massimo dell'attesa

  // total = dimensione totale attesa del file (se nota a priori)
  let total = (typeof expectedSize === "number" && expectedSize > 0) ? expectedSize : 0;

  // Dimensione attuale del .part su disco (= byte già scaricati e salvati).
  function partSize() {
    try { return fs.existsSync(tmpPath) ? fs.statSync(tmpPath).size : 0; } catch (_) { return 0; }
  }

  function sendProgress(downloaded, status, attempt) {
    try {
      event.sender.send("update:download-progress", {
        downloaded,
        total,
        status: status || "downloading",
        attempt: attempt || 1,
        maxAttempts: MAX_ATTEMPTS
      });
    } catch (_) {}
  }

  // Un singolo tentativo di download/ripresa.
  //  • risolve { done: true } quando lo stream è completato senza errori;
  //  • rigetta con un Error che ha .retryable (true = si può ritentare/riprendere)
  //    e .cancelled (true = annullato dall'utente).
  function attemptDownload(attempt) {
    return new Promise((resolve, reject) => {
      let startByte = partSize();

      // Se abbiamo già su disco tutti i byte attesi, saltiamo alla verifica.
      if (total > 0 && startByte >= total) {
        return resolve({ done: true });
      }

      // Apertura file: append se stiamo riprendendo, sovrascrittura se da zero.
      const stream = fs.createWriteStream(tmpPath, { flags: startByte > 0 ? "a" : "w" });
      activeDownloadStream = stream;

      const req = net.request({ method: "GET", url, redirect: "manual" });
      req.setHeader("User-Agent", "Mosaica-Workspace-Pro-Updater");
      req.setHeader("Accept", "application/octet-stream");
      // Ripresa: chiediamo solo i byte mancanti (HTTP Range).
      if (startByte > 0) {
        req.setHeader("Range", `bytes=${startByte}-`);
      }
      activeDownloadRequest = req;

      let downloaded = startByte;
      let settled = false;
      let stallTimer = null;
      let redirectAborted = false;

      function clearTimers() {
        if (stallTimer) { clearTimeout(stallTimer); stallTimer = null; }
      }

      // Rilevamento "connessione morta": se per STALL_TIMEOUT_MS non arriva
      // nessun byte (né la prima risposta), abortiamo e segnaliamo retry.
      function armStall() {
        clearTimers();
        stallTimer = setTimeout(() => {
          if (settled) return;
          settled = true;
          security.logSecurityEvent("warn", "download_stalled", { attempt, downloaded });
          try { req.abort(); } catch (_) {}
          try { stream.close(); } catch (_) {}
          activeDownloadRequest = null;
          activeDownloadStream = null;
          const e = new Error("Connessione in stallo (nessun dato ricevuto)");
          e.retryable = true;
          reject(e);
        }, STALL_TIMEOUT_MS);
      }

      // Redirect guard: ogni hop DEVE restare in dominio GitHub.
      security.attachRedirectGuard(req, (badUrl) => {
        if (settled) return;
        settled = true;
        clearTimers();
        try { stream.close(); } catch (_) {}
        try { fs.unlinkSync(tmpPath); } catch (_) {}
        activeDownloadRequest = null;
        activeDownloadStream = null;
        activeDownloadPath = null;
        const e = new Error("Redirect bloccato verso host esterno: " + badUrl);
        e.retryable = false;   // problema di sicurezza: non si ritenta
        reject(e);
      });

      req.on("response", (response) => {
        const sc = response.statusCode;

        // Il server ha ignorato il Range e rimanda tutto da capo (200 invece
        // di 206): buttiamo il parziale e ripartiamo puliti al giro dopo.
        if (sc === 200 && startByte > 0) {
          settled = true;
          clearTimers();
          try { stream.close(); } catch (_) {}
          try { fs.truncateSync(tmpPath, 0); } catch (_) {}
          activeDownloadRequest = null;
          activeDownloadStream = null;
          const e = new Error("Il server non supporta la ripresa: riparto da zero");
          e.retryable = true;
          return reject(e);
        }

        // Solo 200 (full) o 206 (partial) sono validi.
        if (sc !== 200 && sc !== 206) {
          settled = true;
          clearTimers();
          try { stream.close(); } catch (_) {}
          activeDownloadRequest = null;
          activeDownloadStream = null;
          security.logSecurityEvent("warn", "download_http_error", { status: sc, url });
          const e = new Error(`HTTP ${sc}`);
          // 5xx / 429 / 408 sono temporanei → si ritenta. 4xx no.
          e.retryable = (sc >= 500 || sc === 429 || sc === 408);
          return reject(e);
        }

        // Determiniamo la dimensione totale del file.
        const hv = (name) => {
          const v = response.headers[name];
          return Array.isArray(v) ? v[0] : v;
        };
        if (sc === 206) {
          // Content-Range: bytes <start>-<end>/<total>
          const cr = hv("content-range");
          const m = cr && /\/(\d+)\s*$/.exec(String(cr));
          if (m) total = parseInt(m[1], 10);
        } else {
          const cl = parseInt(hv("content-length") || "0", 10);
          if (cl > 0) total = cl;
        }

        // Hard cap di sicurezza sulla dimensione.
        if (total > security.MAX_INSTALLER_SIZE_BYTES) {
          settled = true;
          clearTimers();
          try { stream.close(); } catch (_) {}
          try { fs.unlinkSync(tmpPath); } catch (_) {}
          activeDownloadRequest = null;
          activeDownloadStream = null;
          activeDownloadPath = null;
          security.logSecurityEvent("error", "download_size_cap_exceeded", { total });
          try { req.abort(); } catch (_) {}
          const e = new Error("Dimensione installer oltre il limite di sicurezza");
          e.retryable = false;
          return reject(e);
        }

        sendProgress(downloaded, "downloading", attempt);
        armStall();

        response.on("data", (chunk) => {
          if (settled) return;
          if (downloadCancelled) {
            try { req.abort(); } catch (_) {}
            return;
          }
          downloaded += chunk.length;
          // Difesa runtime: se superiamo il cap durante lo scaricamento, stop.
          if (downloaded > security.MAX_INSTALLER_SIZE_BYTES) {
            security.logSecurityEvent("error", "download_size_cap_runtime", { downloaded });
            try { req.abort(); } catch (_) {}
            return;
          }
          try { stream.write(chunk); } catch (_) {}
          armStall();
          sendProgress(downloaded, "downloading", attempt);
        });

        response.on("end", () => {
          clearTimers();
          if (settled) return;
          settled = true;
          stream.end();
          stream.on("finish", () => {
            activeDownloadRequest = null;
            activeDownloadStream = null;
            resolve({ done: true });
          });
        });

        response.on("error", (err) => {
          clearTimers();
          if (settled) return;
          settled = true;
          try { stream.close(); } catch (_) {}
          activeDownloadRequest = null;
          activeDownloadStream = null;
          if (redirectAborted) return;
          // Errore di rete a metà: TENIAMO il .part così si riprende dopo.
          const e = new Error(err && err.message ? err.message : "Errore di rete");
          e.retryable = true;
          reject(e);
        });
      });

      req.on("error", (err) => {
        clearTimers();
        if (settled) return;
        settled = true;
        try { stream.close(); } catch (_) {}
        activeDownloadRequest = null;
        activeDownloadStream = null;
        if (redirectAborted) return;
        // Tipico quando la connessione cade o l'host non risponde:
        // .part conservato, si riprenderà al prossimo tentativo.
        const e = new Error(err && err.message ? err.message : "Errore di rete");
        e.retryable = true;
        reject(e);
      });

      req.on("abort", () => {
        clearTimers();
        if (settled) return;
        settled = true;
        try { stream.close(); } catch (_) {}
        activeDownloadRequest = null;
        activeDownloadStream = null;
        if (redirectAborted) return;
        if (downloadCancelled) {
          const e = new Error("Download annullato dall'utente");
          e.retryable = false;
          e.cancelled = true;
          return reject(e);
        }
        const e = new Error("Download interrotto");
        e.retryable = true;
        reject(e);
      });

      req.end();
    });
  }

  // ── Loop dei tentativi con backoff crescente ──────────────
  let lastErr = null;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    if (downloadCancelled) {
      try { fs.unlinkSync(tmpPath); } catch (_) {}
      activeDownloadPath = null;
      return { ok: false, error: "Download annullato dall'utente", cancelled: true };
    }

    try {
      await attemptDownload(attempt);
      lastErr = null;
      break; // stream completato → si passa alla verifica
    } catch (e) {
      lastErr = e;

      // Annullamento esplicito: ripuliamo e usciamo.
      if (e && e.cancelled) {
        try { fs.unlinkSync(tmpPath); } catch (_) {}
        activeDownloadRequest = null;
        activeDownloadStream = null;
        activeDownloadPath = null;
        return { ok: false, error: "Download annullato dall'utente", cancelled: true };
      }

      // Errore non ritentabile o tentativi esauriti → falliamo.
      if (!e || !e.retryable || attempt >= MAX_ATTEMPTS) {
        try { fs.unlinkSync(tmpPath); } catch (_) {}
        activeDownloadRequest = null;
        activeDownloadStream = null;
        activeDownloadPath = null;
        return { ok: false, error: (e && e.message) || "Download fallito" };
      }

      // Altrimenti: attesa con backoff e ripresa dal punto raggiunto.
      const backoff = Math.min(MAX_BACKOFF_MS, Math.round(BASE_BACKOFF_MS * Math.pow(1.7, attempt - 1)));
      security.logSecurityEvent("info", "download_retry", {
        attempt, nextInMs: backoff, reason: (e && e.message) || "?"
      });
      sendProgress(partSize(), "retrying", attempt);
      await _interruptibleWait(backoff, () => downloadCancelled);
      if (downloadCancelled) {
        try { fs.unlinkSync(tmpPath); } catch (_) {}
        activeDownloadPath = null;
        return { ok: false, error: "Download annullato dall'utente", cancelled: true };
      }
      sendProgress(partSize(), "resuming", attempt + 1);
    }
  }

  if (lastErr) {
    try { fs.unlinkSync(tmpPath); } catch (_) {}
    activeDownloadPath = null;
    return { ok: false, error: lastErr.message || "Download fallito" };
  }

  // ── VERIFICA INTEGRITÀ prima di esporre il file ───────────
  const verify = await security.verifyDownloadedAsset(tmpPath, {
    digest: expectedDigest || null,
    size: expectedSize || 0
  });

  if (!verify.ok) {
    // File compromesso o corrotto: cancella e segnala.
    try { fs.unlinkSync(tmpPath); } catch (_) {}
    activeDownloadRequest = null;
    activeDownloadStream = null;
    activeDownloadPath = null;
    security.logSecurityEvent("error", "download_verify_failed", {
      reason: verify.reason,
      actualDigest: verify.actualDigest,
      expectedDigest: verify.expectedDigest,
      size: verify.size
    });
    return { ok: false, error: "Verifica integrità fallita: " + verify.reason };
  }

  // Verifica OK: rinomina .part → .exe (commit atomico).
  try {
    fs.renameSync(tmpPath, destPath);
  } catch (e) {
    try { fs.unlinkSync(tmpPath); } catch (_) {}
    activeDownloadRequest = null;
    activeDownloadStream = null;
    activeDownloadPath = null;
    security.logSecurityEvent("error", "download_rename_failed", { message: e.message });
    return { ok: false, error: "Impossibile finalizzare il file: " + e.message };
  }

  activeDownloadRequest = null;
  activeDownloadStream = null;
  activeDownloadPath = null;

  security.logSecurityEvent("info", "download_verified", {
    file: filename,
    size: verify.size,
    digest: verify.actualDigest,
    digestProvidedByGithub: !!expectedDigest
  });

  return {
    ok: true,
    path: destPath,
    size: verify.size,
    verified: true,
    digest: verify.actualDigest
  };
});

ipcMain.handle("update:cancel-download", () => {
  // Alziamo il flag PRIMA dell'abort: così il loop dei tentativi non riprende
  // e l'eventuale attesa di backoff si interrompe subito.
  downloadCancelled = true;
  try {
    if (activeDownloadRequest) activeDownloadRequest.abort();
  } catch (_) {}
  return { ok: true };
});

ipcMain.handle("update:install-and-quit", async (_e, installerPath) => {
  if (!installerPath || typeof installerPath !== "string") {
    security.logSecurityEvent("warn", "install_path_missing", {});
    return { ok: false, error: "Path installer mancante" };
  }
  if (!fs.existsSync(installerPath) || !/\.exe$/i.test(installerPath)) {
    security.logSecurityEvent("warn", "install_path_invalid", { installerPath });
    return { ok: false, error: "Installer non trovato o non valido" };
  }

  // ── 🛡️ Ri-verifica integrità just-in-time, prima di spawnare:
  // se nel frattempo qualcuno ha sostituito il file sul disco,
  // rifiutiamo l'esecuzione.
  const verify = await security.verifyDownloadedAsset(installerPath, {});
  if (!verify.ok) {
    try { fs.unlinkSync(installerPath); } catch (_) {}
    security.logSecurityEvent("error", "install_preflight_verify_failed", { reason: verify.reason });
    return { ok: false, error: "Verifica installer fallita: " + verify.reason };
  }

  security.logSecurityEvent("info", "install_armed", {
    installerPath,
    size: verify.size,
    digest: verify.actualDigest
  });

  pendingInstallerPath = installerPath;

  if (mainWindow && !mainWindow.isDestroyed()) {
    setTimeout(() => {
      try { mainWindow.close(); } catch (_) {}
    }, 200);
  }
  return { ok: true };
});

// Quando l'app sta per chiudersi, se abbiamo un installer pendente, lo spawnamo
// detached così sopravvive alla chiusura di Mosaica e parte in autonomia.
app.on("before-quit", () => {
  if (pendingInstallerPath) {
    try {
      const { spawn } = require("child_process");
      const child = spawn(pendingInstallerPath, [], {
        detached: true,
        stdio: "ignore"
      });
      child.unref();
      console.log("[update] installer avviato:", pendingInstallerPath);
    } catch (e) {
      console.error("[update] spawn installer fallito:", e);
    }
    pendingInstallerPath = null;
  }
});

// ── 🔎 LOG INFO GPU ALL'AVVIO ────────────────────────────────────────────────
// Registra QUALE GPU sta usando il rendering. Lo scrive sul log di sessione (così
// vale anche per l'app installata, dove non c'è terminale) e lo stampa anche a
// console quando si lancia da "npm start". Best-effort.
async function logGpuInfo() {
  try {
    const info = await app.getGPUInfo("complete");
    const aux = (info && info.auxAttributes) || {};
    const renderer = aux.glRenderer || "(sconosciuto)";
    const vendor = aux.glVendor || "(sconosciuto)";
    const version = aux.glVersion || "";
    let device = "(nessuna scheda marcata 'active')";
    if (info && Array.isArray(info.gpuDevice)) {
      const a = info.gpuDevice.find((d) => d && d.active) || info.gpuDevice[0];
      if (a) device = `vendorId=${a.vendorId} deviceId=${a.deviceId} active=${!!a.active}`;
    }
    console.log("==================== GPU IN USO ====================");
    console.log("  " + renderer + "  (" + vendor + ")");
    console.log("====================================================");
    appendLog("---- GPU IN USO ----");
    appendLog(`  GL renderer : ${renderer}`);
    appendLog(`  GL vendor   : ${vendor}`);
    appendLog(`  GL version  : ${version}`);
    appendLog(`  GPU device  : ${device}`);
  } catch (e) {
    console.error("[gpu] impossibile leggere le info GPU:", e && e.message);
    appendLog(`${new Date().toISOString()}  errore lettura GPU info: ${e && e.message}`);
  }
}

// Esegui all’avvio
app.whenReady().then(async () => {
  // Apri il log di sessione PER PRIMO: così se l'avvio crasha, qualcosa resta.
  writeSessionLogHeader();
  pruneSessionLogs();
  createWindow();
  logGpuInfo(); // best-effort, non blocca l'avvio
  await copyDefaultTextures();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});