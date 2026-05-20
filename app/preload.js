// preload.js
const { contextBridge, ipcRenderer } = require("electron");

console.log("[preload] preload.js caricato — API esposte");

/* ===============================
   🔗 SAVE LOADER BRIDGE
   ------------------------------------------------------------
   Permette al saveLoader (renderer) di registrare hook che
   vengono invocati all'inizio e alla fine di ogni IPC di
   salvataggio/export. Questo è necessario perché gli oggetti
   esposti via contextBridge sono deeply-frozen e NON possono
   essere wrappati dal renderer dopo l'esposizione.
================================ */
const _hooks = { onStart: null, onEnd: null };

contextBridge.exposeInMainWorld("saveLoaderBridge", {
   register: (handlers) => {
      _hooks.onStart = handlers && typeof handlers.onStart === "function" ? handlers.onStart : null;
      _hooks.onEnd = handlers && typeof handlers.onEnd === "function" ? handlers.onEnd : null;
   }
});

// Helper: avvolge una IPC di salvataggio in eventi onStart / onEnd.
// Gli errori dei hook NON devono mai compromettere l'IPC reale.
function tracked(kind, ipcChannel) {
   return async (payload) => {
      try {
         _hooks.onStart && _hooks.onStart(kind, payload);
      } catch (_) {}
      try {
         const res = await ipcRenderer.invoke(ipcChannel, payload);
         try {
            _hooks.onEnd && _hooks.onEnd(kind, { result: res });
         } catch (_) {}
         return res;
      } catch (e) {
         try {
            _hooks.onEnd && _hooks.onEnd(kind, { error: (e && e.message) || String(e) });
         } catch (_) {}
         throw e;
      }
   };
}

/* ===============================
   📏 SYSTEM DPI
================================ */
contextBridge.exposeInMainWorld("systemAPI", {
   getDPI: () => window.devicePixelRatio * 96 || 96
});

/* =============================== 
   💾 DESKTOP + PDF + SVG + FREEHAND + GUIDA + ESC FULLSCREEN
================================ */
contextBridge.exposeInMainWorld("desktopAPI", {
   exportPDFImage: tracked("exportPDFImage", "export-pdf-image"),
   exportFreehand: tracked("exportFreehand", "export-freehand"),
   exportFullPNG: tracked("exportFullPNG", "export-full-png"),
   exportShapesSVG: tracked("exportShapesSVG", "export-shapes-svg"),
   restartApp: () => ipcRenderer.invoke("app:restart"),
   openGuide: () => ipcRenderer.invoke("open-guide"),
   setFullScreen: (flag) => ipcRenderer.send("window:set-fullscreen", flag),
   isFullScreen: () => ipcRenderer.invoke("window:is-fullscreen"),
   onFullScreenChange: (cb) => {
      if (typeof cb !== "function") return () => {};
      const listener = (_event, isFs) => {
         try {
            cb(!!isFs);
         } catch (_) {}
      };
      ipcRenderer.on("window:fullscreen-changed", listener);
      // ritorna una funzione "unsubscribe" nel caso servisse
      return () => ipcRenderer.removeListener("window:fullscreen-changed", listener);
   }
});

/* ===============================
   📐 CALIBRAZIONE (unificata)
================================ */
contextBridge.exposeInMainWorld("calibrationAPI", {
   load: () => ipcRenderer.invoke("calibration:load"),
   save: (data) => ipcRenderer.invoke("calibration:save", data)
});

/* ===============================
   🖼️ TEXTURES
================================ */
contextBridge.exposeInMainWorld("textureAPI", {
   openTexturePicker: () => ipcRenderer.invoke("textures:select"),
   listTextures: () => ipcRenderer.invoke("textures:list")
});

/* ===============================
   🖌️ BRUSH TIPS
================================ */
contextBridge.exposeInMainWorld("brushAPI", {
   listBrushes: () => ipcRenderer.invoke("brushes:list")
});

/* =============================== 
   🖼️ PAPER TEXTURE (carta.png)
================================ */
contextBridge.exposeInMainWorld("paperTextureAPI", {
   getDataURL: () => ipcRenderer.invoke("papertexture:get")
});

/* ===============================
   📁 PROJECTS + AUTO-OPEN (Feature B)
================================ */
contextBridge.exposeInMainWorld("projectAPI", {
   listProjects: () => ipcRenderer.invoke("projects:list"),
   saveProject: tracked("saveProject", "projects:save"),
   openProjectDialog: () => ipcRenderer.invoke("projects:openDialog"),

   // Auto-Open
   setAutoOpen: (fullPathOrNull) => ipcRenderer.invoke("projects:setAutoOpen", fullPathOrNull),
   getAutoOpen: () => ipcRenderer.invoke("projects:getAutoOpen"),
   tryAutoOpen: () => ipcRenderer.invoke("projects:tryAutoOpen")
});

/* ===============================
   💾 AUTO-SAVE (silenzioso, NON tracked)
   ------------------------------------------------------------
   Non passa da `tracked()` di proposito: l'auto-salvataggio
   deve essere invisibile (no saveLoader modale). Espone una
   API dedicata usata dal modulo autoSave.js.
================================ */
contextBridge.exposeInMainWorld("autoSaveAPI", {
   // Scrive direttamente a un percorso esistente (sovrascrittura in-place,
   // qualunque sia il volume: HDD / USB / SD)
   writeToPath: (filePath, content) => ipcRenderer.invoke("autosave:writeToPath", { path: filePath, content }),

   // Crea/sovrascrive il file "di sessione" in userData/projects/ con
   // nome data+ora italiana, derivato dal timestamp passato.
   writeSession: (sessionDateMs, content) => ipcRenderer.invoke("autosave:writeSession", { sessionDateMs, content }),

   // Pruning: tiene solo gli ultimi N file di sessione (default 10 lato main).
   pruneSessions: (currentFilename) => ipcRenderer.invoke("autosave:pruneSessions", currentFilename),

   // Conferma chiusura: chiamata DOPO il salvataggio per far distruggere la finestra.
   confirmClose: () => ipcRenderer.invoke("autosave:confirm-close"),

   // Annulla chiusura: l'utente ha cliccato "Annulla chiusura" nell'overlay.
   abortClose: () => ipcRenderer.invoke("autosave:abort-close"),

   // Listener invocato quando il main intercetta il "close" della finestra.
   onCloseRequested: (cb) => {
      if (typeof cb !== "function") return () => {};
      const listener = () => {
         try {
            cb();
         } catch (_) {}
      };
      ipcRenderer.on("autosave:close-requested", listener);
      return () => ipcRenderer.removeListener("autosave:close-requested", listener);
   }
});

/* ===============================
   🖊️ WACOM TABLET API
   ------------------------------------------------------------
   Bridge IPC per il modulo wacomTablet.js (renderer-side).
================================ */
contextBridge.exposeInMainWorld("wacomAPI", {
   detectDevices: () => ipcRenderer.invoke("wacom:detect-devices"),
   openPreferences: () => ipcRenderer.invoke("wacom:open-preferences"),
   getInfo: () => ipcRenderer.invoke("wacom:get-info")
});
