// main.js
const { app, BrowserWindow, ipcMain, dialog, nativeImage, Menu, shell } = require("electron");
const path = require("path");
const fs = require("fs");
const PDFDocument = require("pdfkit");

const { loadCalibration, saveCalibration } = require("./storage/calibrationStore");
const security = require("./security");

let mainWindow;
let isRestarting = false;
let autosaveCloseInProgress = false; // protezione anti-rientro nel close handler

// rimuove definitivamente il menu nativo
Menu.setApplicationMenu(null);


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
  
  mainWindow.loadFile(path.join(__dirname, "index.html"));
  mainWindow.setFullScreen(true);
  
  // ── 🛡️ CYBER-SECURITY: aggancia CSP, permission handler, navigation guard
  // PRIMA di loadFile, così la prima richiesta del renderer ha già le protezioni.
  try {
    security.lockDownSession(mainWindow.webContents.session);
    security.lockDownWindow(mainWindow);
  } catch (e) {
    console.error("[security] init falliti:", e);
  }

  mainWindow.loadFile(path.join(__dirname, "index.html"));
  mainWindow.setFullScreen(true);

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
    fs.writeFileSync(payload.path, payload.content, "utf8");
    return { path: payload.path, filename: path.basename(payload.path) };
  } catch (e) {
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
    fs.writeFileSync(full, payload.content, "utf8");
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

ipcMain.handle("update:download-asset", (event, args) => {
  return new Promise((resolve) => {
    const { url, filename, expectedSize, expectedDigest } = args || {};

    // ── Validazioni iniziali (allowlist URL + nome file)
    if (!url || !security.isGithubUrl(url)) {
      security.logSecurityEvent("error", "download_url_rejected", { url });
      return resolve({ ok: false, error: "URL non consentito (deve essere su github.com)" });
    }
    if (!security.validateInstallerFilename(filename)) {
      security.logSecurityEvent("error", "download_filename_rejected", { filename });
      return resolve({ ok: false, error: "Nome file installer non valido" });
    }

    // ── Cleanup di vecchi .exe nella cartella updates (teniamo solo il nuovo)
    const dir = _getUpdatesDir();
    try {
      for (const f of fs.readdirSync(dir)) {
        if (/\.(exe|part)$/i.test(f)) {
          try { fs.unlinkSync(path.join(dir, f)); } catch (_) {}
        }
      }
    } catch (_) {}

    // ── Download su file .part: il rename ad .exe avviene SOLO dopo verifica integrità
    const destPath = path.join(dir, filename);
    const tmpPath = destPath + ".part";
    activeDownloadPath = tmpPath;

    const stream = fs.createWriteStream(tmpPath);
    activeDownloadStream = stream;

    const req = net.request({ method: "GET", url, redirect: "manual" });
    req.setHeader("User-Agent", "Mosaica-Workspace-Pro-Updater");
    req.setHeader("Accept", "application/octet-stream");
    activeDownloadRequest = req;

    // ── Redirect guard: ogni hop DEVE restare in dominio GitHub
    let redirectAborted = false;
    security.attachRedirectGuard(req, (badUrl) => {
      redirectAborted = true;
      try { stream.close(); } catch (_) {}
      try { fs.unlinkSync(tmpPath); } catch (_) {}
      activeDownloadRequest = null;
      activeDownloadStream = null;
      activeDownloadPath = null;
      resolve({ ok: false, error: "Redirect bloccato verso host esterno: " + badUrl });
    });

    let total = (typeof expectedSize === "number" && expectedSize > 0) ? expectedSize : 0;
    let downloaded = 0;

    req.on("response", (response) => {
      if (response.statusCode !== 200) {
        try { stream.close(); } catch (_) {}
        try { fs.unlinkSync(tmpPath); } catch (_) {}
        activeDownloadRequest = null;
        activeDownloadStream = null;
        activeDownloadPath = null;
        security.logSecurityEvent("warn", "download_http_error", { status: response.statusCode, url });
        return resolve({ ok: false, error: `HTTP ${response.statusCode}` });
      }
      const cl = parseInt(response.headers["content-length"] || "0", 10);
      if (cl > 0) total = cl;

      // Hard cap: se il server dichiara una size oltre il limite, rifiutiamo subito
      if (total > security.MAX_INSTALLER_SIZE_BYTES) {
        try { stream.close(); } catch (_) {}
        try { fs.unlinkSync(tmpPath); } catch (_) {}
        activeDownloadRequest = null;
        activeDownloadStream = null;
        activeDownloadPath = null;
        security.logSecurityEvent("error", "download_size_cap_exceeded", { total });
        try { req.abort(); } catch (_) {}
        return resolve({ ok: false, error: "Dimensione installer oltre il limite di sicurezza" });
      }

      response.on("data", (chunk) => {
        downloaded += chunk.length;
        // Difesa runtime: se durante il download superiamo il cap, interrompi
        if (downloaded > security.MAX_INSTALLER_SIZE_BYTES) {
          security.logSecurityEvent("error", "download_size_cap_runtime", { downloaded });
          try { req.abort(); } catch (_) {}
          return;
        }
        try { stream.write(chunk); } catch (_) {}
        try {
          event.sender.send("update:download-progress", { downloaded, total });
        } catch (_) {}
      });

      response.on("end", () => {
        stream.end();
        stream.on("finish", async () => {
          // ── VERIFICA INTEGRITÀ prima di esporre il file
          const verify = await security.verifyDownloadedAsset(tmpPath, {
            digest: expectedDigest || null,
            size: expectedSize || 0
          });

          if (!verify.ok) {
            // File compromesso o corrotto: cancella e segnala
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
            return resolve({ ok: false, error: "Verifica integrità fallita: " + verify.reason });
          }

          // Verifica OK: rinomina .part → .exe (commit atomico)
          try {
            fs.renameSync(tmpPath, destPath);
          } catch (e) {
            try { fs.unlinkSync(tmpPath); } catch (_) {}
            activeDownloadRequest = null;
            activeDownloadStream = null;
            activeDownloadPath = null;
            security.logSecurityEvent("error", "download_rename_failed", { message: e.message });
            return resolve({ ok: false, error: "Impossibile finalizzare il file: " + e.message });
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

          resolve({
            ok: true,
            path: destPath,
            size: verify.size,
            verified: true,
            digest: verify.actualDigest
          });
        });
      });

      response.on("error", (err) => {
        try { stream.close(); } catch (_) {}
        try { fs.unlinkSync(tmpPath); } catch (_) {}
        activeDownloadRequest = null;
        activeDownloadStream = null;
        activeDownloadPath = null;
        if (!redirectAborted) resolve({ ok: false, error: err.message });
      });
    });

    req.on("error", (err) => {
      try { stream.close(); } catch (_) {}
      try { fs.unlinkSync(tmpPath); } catch (_) {}
      activeDownloadRequest = null;
      activeDownloadStream = null;
      activeDownloadPath = null;
      if (!redirectAborted) resolve({ ok: false, error: err.message });
    });

    req.on("abort", () => {
      try { stream.close(); } catch (_) {}
      try { fs.unlinkSync(tmpPath); } catch (_) {}
      activeDownloadRequest = null;
      activeDownloadStream = null;
      activeDownloadPath = null;
      if (!redirectAborted) resolve({ ok: false, error: "Download annullato dall'utente" });
    });

    req.end();
  });
});

ipcMain.handle("update:cancel-download", () => {
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

// Esegui all’avvio
app.whenReady().then(async () => {
  createWindow();
  await copyDefaultTextures();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
