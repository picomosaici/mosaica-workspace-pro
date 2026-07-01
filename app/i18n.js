// ============================================================
//  i18n.js — Mosaica Workspace Pro
// ------------------------------------------------------------
//  Modulo di internazionalizzazione (i18n).
//
//  ARCHITETTURA:
//   • Dizionari interni per ogni lingua supportata (IT, EN).
//     L'IT funge da default e da fallback per qualsiasi chiave
//     mancante in altre lingue.
//   • API window.i18n esposta globalmente:
//        t(key, params)            → traduce una chiave (sincrono)
//        getLanguage()             → "it" | "en" | ...
//        getAvailableLanguages()   → ["it","en", ...]
//        setLanguage(lang)         → persiste su disco + reload finestra
//        applyTranslations(root)   → scansiona [data-i18n*] e riscrive
//        on("language:changed",cb) → registra listener
//        getLanguageMeta(lang)     → { name, nativeName, flag }
//   • Persistenza via window.languageAPI (bridge IPC):
//        userData/language.json   { "lang": "it" }
//   • Boot:
//        1) il modulo si auto-inizializza al caricamento dello
//           script (definisce window.i18n e i dizionari).
//        2) su DOMContentLoaded recupera la lingua effettiva via
//           IPC, applica eventuali traduzioni al DOM statico,
//           aggancia i bottoni di selezione lingua nel menu File.
//
//  Caricato come <script> in index.html PRIMA di renderer.js, così
//  qualsiasi modulo successivo (renderer, autoSave, wacom, ecc.)
//  può chiamare window.i18n.t() senza ordering issue.
//
//  FASE 2 + FASE 4 (questa versione): i dizionari contengono ora
//  TUTTE le chiavi necessarie:
//   • FASE 2: HTML statico di index.html (toolbar, modali, popover,
//     inspector, status bar, ecc.)
//   • FASE 4: stringhe dinamiche generate da renderer.js /
//     wacomTablet.js / inputMapping.js (toast, confirm dialog,
//     label di dropdown azioni, status messages, banner
//     calibrazione, modale di mappatura input, ecc.)
//
//  ATTRIBUTI HTML SUPPORTATI:
//   • data-i18n            → riscrive textContent
//   • data-i18n-html       → riscrive innerHTML (supporta <b>, <br>...)
//   • data-i18n-title      → riscrive l'attributo title (tooltip)
//   • data-i18n-placeholder→ riscrive l'attributo placeholder
//   • data-i18n-aria-label → riscrive aria-label
//   • data-i18n-tooltip    → riscrive l'attributo data-tooltip
//                            (custom: lo usa il radial menu in
//                            renderer.js, che legge btn.dataset.tooltip
//                            al mousemove per mostrare il proprio
//                            #radialTooltip — non l'attributo title
//                            nativo del browser)
//
//  INTERPOLAZIONE: t("toast.savedAs", { name: "x.msp" })
//                   con stringa "Salvato come {name}".
// ============================================================

(function () {
  "use strict";

  if (window.__i18nInitialized) return;
  window.__i18nInitialized = true;

  // ───────────────────────────────────────────────────────────
  //  CONFIG
  // ───────────────────────────────────────────────────────────
  const DEFAULT_LANG = "it";
  const AVAILABLE_LANGS = ["it", "en"];

  // Metadati di ogni lingua (per il menu e per il toast di cambio)
  const LANG_META = {
    it: { name: "Italiano", nativeName: "Italiano", flag: "🇮🇹" },
    en: { name: "English",  nativeName: "English",  flag: "🇬🇧" }
  };

  // ───────────────────────────────────────────────────────────
  //  DIZIONARI
  //  ------------------------------------------------------------
  //  Struttura piatta: "categoria.sotto.chiave".
  //  Chiavi NON presenti in EN ricadono sull'IT (fallback).
  //  Chiavi NON presenti in IT ritornano la chiave stessa
  //  (così durante lo sviluppo si vede subito cosa manca).
  //
  //  NB: i nomi delle lingue restano nella propria forma nativa
  //  in entrambi i dizionari (convenzione standard).
  // ───────────────────────────────────────────────────────────
  const DICTIONARIES = {
    it: {
      // ────────────────────────────────────────────────────────
      //  FASE 1 — Menu File → sezione lingua + toast cambio lingua
      // ────────────────────────────────────────────────────────
      "menu.language.label":    "🌐 Lingua",
      "menu.language.tooltip":  "Cambia la lingua dell'interfaccia",
      "menu.language.it":       "🇮🇹 Italiano",
      "menu.language.en":       "🇬🇧 English",

      "toast.languageChanged":  "Lingua impostata: {name}. L'app si riavvia…",
      "toast.languageError":    "Errore nel cambio lingua",

      // ════════════════════════════════════════════════════════
      //  FASE 2 — HTML STATICO (index.html)
      // ════════════════════════════════════════════════════════

      // ── App loader ──────────────────────────────────────────
      "appLoader.loaderNote":                 "Caricamento…",

      // ── Radial menu (data-tooltip) ──────────────────────────
      "radial.tooltip.rotate":                "Ruota l'oggetto (trascina o rotella)",
      "radial.tooltip.duplicate":             "Duplica oggetto",
      "radial.tooltip.scale":                 "Ridimensiona liberamente",
      "radial.tooltip.copyColor":             "Cambia colore attuale",
      "radial.tooltip.pasteColor":            "Incolla colore copiato",
      "radial.tooltip.changeShape":           "Cambia forma (triangolo/trapezio/settore)",
      "radial.tooltip.sliceCircle":           "Dividi cerchio/ellisse (Click=4 quarti | Alt+Click=2 metà)",
      "radial.tooltip.lock":                  "Blocca oggetto (non selezionabile)",
      "radial.tooltip.delete":                "Elimina oggetto (tasto Canc)",
      "radial.tooltip.group":                 "Raggruppa oggetti selezionati",
      "radial.tooltip.ungroup":               "Separa gruppo",

      // ── Color popup ─────────────────────────────────────────
      "colorPopup.changeColor.label":         "Cambia colore",
      "colorPopup.changeColor.tooltip":       "Cambia colore",
      "colorPopup.colorInput.tooltip":        "Scegli colore",

      // ── Lasso popover ───────────────────────────────────────
      "lasso.popover.ariaLabel":              "Sensibilità Lazo",
      "lasso.popover.title":                  "🎯 Sensibilità Lazo",
      "lasso.popover.close":                  "Chiudi",
      "lasso.popover.hint":                   "Quanta parte di una tessera deve cadere dentro il tracciato del lazo perché venga selezionata. Più <b>basso</b> = più permissivo (utile fra tessere fitte con fughe strette dove il lazo deve per forza sfiorare le forme da prendere). Più <b>alto</b> = più restrittivo (solo forme quasi interamente dentro).",
      "lasso.popover.resetTooltip":           "Ripristina il valore consigliato per mosaici fitti",
      "lasso.popover.resetLabel":             "Default (0.20)",
      // ── Pennello selezione + Texture su tutte le tessere (NUOVI) ──
      "leftToolbar.lassoBrush.tooltip":        "Pennello selezione — dipingi sulle tessere per selezionarle (i tratti si sommano, CTRL = deseleziona). Click destro per la dimensione della punta.",
      "lassoBrush.popover.ariaLabel":          "Dimensione pennello selezione",
      "lassoBrush.popover.title":              "🖌️ Pennello selezione",
      "lassoBrush.popover.close":              "Chiudi",
      "lassoBrush.popover.size":               "Punta",
      "lassoBrush.popover.hint":               "Diametro della punta in millimetri reali sul foglio: più è grande, più tessere prendi per passata. I tratti si sommano; tieni CTRL premuto per deselezionare.",
      "lassoBrush.popover.resetLabel":         "Default (12 mm)",
      "lassoBrush.popover.resetTooltip":       "Ripristina la dimensione consigliata",
      "texturePanel.all.title":                "▦ Tutte le tessere",
      "texturePanel.all.btnTooltip":           "Applica una texture a TUTTE le tessere del canvas (grana e colore inclusi)",
      "texturePanel.all.ariaLabel":            "Texture su tutte le tessere",
      "texturePanel.all.close":                "Chiudi",
      "texturePanel.all.select":               "Texture",
      "texturePanel.all.selectPlaceholder":    "— scegli una texture —",
      "texturePanel.all.grain":                "Grana",
      "texturePanel.all.colorize":             "colora dalla ruota colore",
      "texturePanel.all.hint":                 "Applica la texture scelta a tutte le tessere del canvas (non tocca penna, acquerello, sfondo, Palladiana e 3D). Grana e colore valgono per tutte.",
      "texturePanel.all.remove":               "Togli da tutte",
      "toast.textureAll.noTiles":              "❌ Nessuna tessera sul canvas",
      "toast.textureAll.applied":              "✅ Texture applicata a tutte le {count} tessere",
      "toast.textureAll.none":                 "Nessuna tessera con texture",
      "toast.textureAll.removed":              "🧽 Texture rimossa da {count} tessere",
      "toast.brushSelect.on":                  "🖌️ Pennello selezione attivo — dipingi sulle tessere (CTRL = deseleziona)",
      "toast.brushSelect.count":               "🖌️ {count} tessere — esci o premi Invio per confermare",
      "toast.brushSelect.committed":           "🖌️ {count} tessere selezionate",

      // ── Measure overlay (radial size slider) ────────────────
      "measure.radialSize.tooltip":           "Dimensione menu radiale (doppio click = reset)",

      // ── Top bar: menu File ──────────────────────────────────
      "menu.file.title":                      "File",
      "menu.file.openProject.label":          "📂 Apri progetto…",
      "menu.file.openProject.tooltip":        "Apri progetto",
      "menu.file.saveProject.label":          "💾 Salva progetto",
      "menu.file.saveProject.tooltip":        "Salva progetto",
      "menu.file.autoOpen.label":             "Apri progetto all'avvio",

      // ── Top bar: menu Esporta ───────────────────────────────
      "menu.export.title":                    "Esporta",
      "menu.export.pdf.label":                "📄 Esporta PDF (A4)",
      "menu.export.pdf.tooltip":              "Esporta su PDF A4",
      "menu.export.png.label":                "🖼️ Esporta PNG / SVG",
      "menu.export.png.tooltip":              "Esporta immagine PNG/SVG",
      "menu.export.freehand.label":           "✏️ Esporta disegno mano libera",
      "menu.export.freehand.tooltip":         "Esporta solo linee a mano libera",

      // ── Top bar: undo/redo/zoom ─────────────────────────────
      "topbar.undo.tooltip":                  "Annulla (Ctrl+Z)",
      "topbar.redo.tooltip":                  "Ripristina (Ctrl+Y)",
      "topbar.zoom.out.tooltip":              "Zoom out",
      "topbar.zoom.in.tooltip":               "Zoom in",
      "topbar.zoom.reset.tooltip":            "Reset zoom",

      // ── Top bar: calibrazione ───────────────────────────────
      "calib.dropdown.tooltip":               "Calibrazione mm reale",
      "calib.dropdown.label":                 "Calibrazione",
      "calib.panel.title":                    "Calibrazione mm reale",
      "calib.panel.steps.intro":              "Passaggi rapidi:",
      "calib.panel.step1":                    "Zoom browser al 100% + scaling OS al 100%",
      "calib.panel.step2":                    "<strong>Misura la striscia nera qui sotto</strong> con il calibro digitale",
      "calib.panel.step3":                    "Inserisci il valore reale e premi \"Applica calibrazione\"",
      "calib.panel.stripLabel":               "50 mm TEORICI",
      "calib.panel.realMeasured.label":       "Misura reale con calibro (mm):",
      "calib.panel.apply":                    "Applica calibrazione",
      "calib.panel.reset":                    "Reset calibrazione (1.0)",
      "calib.panel.note":                     "La striscia è esattamente 50 mm teorici. Misurala fisicamente!",

      // ── Top bar: fullscreen, guida, wacom, input mapping ────
      "topbar.fullscreen.enter.tooltip":      "Entra in modalità schermo intero",
      "topbar.fullscreen.exit.tooltip":       "Esci dalla modalità schermo intero (ESC)",
      "topbar.guide.label":                   "📖 Guida",
      "topbar.guide.tooltip":                 "Apri Guida Utente",
      "topbar.wacom.label":                   "🖊️ Wacom",
      "topbar.wacom.tooltip":                 "Tavoletta Wacom — clicca per impostazioni",
      "topbar.inputMapping.label":            "🖱️⌨️ Input",
      "topbar.inputMapping.tooltip":          "Mappatura Mouse & Tastiera — clicca per personalizzare",

      // ── Left toolbar ────────────────────────────────────────
      "leftToolbar.canvasVertical.tooltip":   "Canvas Verticale (A4 Portrait)",
      "leftToolbar.canvasHorizontal.tooltip": "Canvas Orizzontale (A4 Landscape)",
      "leftToolbar.select.tooltip":           "Seleziona / Sposta (default)",
      "leftToolbar.addShape.tooltip":         "Aggiungi forma al centro del canvas",
      "leftToolbar.customShape.tooltip":      "Crea forma personalizzata (poligono non standard)",
      "leftToolbar.lasso.tooltip":            "Lazo — selezione libera (trascina per selezionare, si auto-disattiva al rilascio). Click destro per regolare la sensibilità.",
      "leftToolbar.freehand.tooltip":         "Penna — disegno a mano libera",
      "leftToolbar.eraser.tooltip":           "Gomma — cancella tratti freehand",
      "leftToolbar.watercolor.tooltip":       "Acquerello — pennellata con bleed",
      "leftToolbar.selectFreehand.tooltip":   "Lista linee disegnate (selettore)",
      "leftToolbar.clearAllFreehand.tooltip": "Cancella TUTTO il disegno a mano libera",
      "leftToolbar.freehandClip.tooltip":     "Perimetro di contenimento del disegno (penna/acquerello): colora solo dentro l'area. Tap = vertice, trascina = mano libera, Invio/doppio-click = chiudi, ESC = annulla. Click destro = cancella.",
      "freehandClip.toast.start":             "⬡ Perimetro: tap = vertice, trascina = mano libera, Invio/doppio-click = chiudi, ESC = annulla",
      "freehandClip.toast.set":               "⬡ Perimetro di contenimento impostato",
      "freehandClip.toast.needMore":          "⬡ Servono almeno 3 punti per chiudere il perimetro",
      "freehandClip.toast.cancelled":         "⬡ Perimetro annullato",
      "freehandClip.toast.removed":           "⬡ Perimetro di contenimento rimosso",
      "freehandClip.toast.none":              "⬡ Nessun perimetro da rimuovere",

      // ── Inspector ───────────────────────────────────────────
      "inspector.title":                      "Inspector",
      "inspector.subtitle.empty":             "Nessuna selezione",
      "inspector.colorBlock.title":           "Colore corrente",
      "inspector.colorBlock.tinta":           "Tinta",
      "inspector.colorBlock.tinta.tooltip":   "Colore linea / acquerello",
      "inspector.dimensions.title":           "Dimensioni",
      "inspector.dimensions.width":           "Largh.",
      "inspector.dimensions.width.tooltip":   "Larghezza in mm — Invio per applicare, Esc per annullare",
      "inspector.dimensions.height":          "Altezza",
      "inspector.dimensions.height.tooltip":  "Altezza in mm — Invio per applicare, Esc per annullare",
      "inspector.texture.title":               "Texture",
      "inspector.texture.grain":               "Grana",
      "inspector.texture.grain.tooltip":       "Dimensione della texture sulla tessera (mm). Piccolo = grana fitta, grande = grana larga.",
      "inspector.texture.colorize":            "Colora",
      "inspector.texture.colorize.hint":       "dalla ruota colore",
      "inspector.texture.colorize.tooltip":    "Colora la texture con la ruota colore: usa grana e pori della texture e la tinge col colore scelto.",
      "inspector.default.hint":               "Seleziona uno strumento dalla barra a sinistra<br />oppure crea/seleziona una forma sul canvas.<br /><br /><em style=\"opacity: 0.7\">Doppio-click sul foglio = nuovo quadrato</em>",

      "inspector.penna.title":                "Penna · Gomma",
      "inspector.penna.width":                "Larghezza",
      "inspector.penna.note":                 "La penna disegna tratti vettoriali sopra le forme.<br />La gomma cancella solo i tratti a mano libera.",

      "inspector.acquerello.title":           "Acquerello",
      "inspector.acquerello.width":           "Larghezza",
      "inspector.acquerello.opacity":         "Opacità",
      "inspector.acquerello.tone":            "Tono",
      "inspector.acquerello.initialRotation": "Rotaz. iniz.",
      "inspector.acquerello.distance":        "Distanza",
      "inspector.acquerello.jitterPos":       "Jitter pos.",
      "inspector.acquerello.rotation":        "Rotazione",
      "inspector.acquerello.bleed":           "Sbavatura",
      "inspector.acquerello.layers":          "Layers",
      "inspector.acquerello.tip":             "Punta",
      "inspector.acquerello.mixing":          "Mixing",
      "inspector.acquerello.mixing.multiply": "Multiply (colore su colore)",
      "inspector.acquerello.mixing.overlay":  "Overlay (somma colori)",
      "inspector.acquerello.mixing.softLight":"Soft Light (somma delicato)",

      "inspector.triangle.title":             "Triangolo · Angoli",
      "inspector.triangle.alpha":             "α (gradi)",
      "inspector.triangle.beta":              "β (gradi)",
      "inspector.triangle.snapPrefix":        "Snap angolare:",

      // ── Texture panel ───────────────────────────────────────
      "texturePanel.label":                   "Anteprima texture",

      // ── BG panel ────────────────────────────────────────────
      "bgPanel.label":                        "Sfondo",
      "bgPanel.dropHintPrefix":               "Trascina qui o",
      "bgPanel.pickBtn":                      "Scegli file",
      "bgPanel.fitContain.label":             "Contain",
      "bgPanel.fitContain.tooltip":           "Fit Contain",
      "bgPanel.fitCover.label":               "Cover",
      "bgPanel.fitCover.tooltip":             "Fit Cover",
      "bgPanel.rotateLeft.label":             "↶ Ruota",
      "bgPanel.rotateLeft.tooltip":           "Ruota a sinistra",
      "bgPanel.rotateRight.label":            "Ruota ↷",
      "bgPanel.rotateRight.tooltip":          "Ruota a destra",
      "bgPanel.clear.label":                  "🗑 Rimuovi",
      "bgPanel.clear.tooltip":                "Rimuovi sfondo",
      "paperPanel.label":                     "Carta texture",
      "paperPanel.toggle":                    "Mostra carta",
      "paperPanel.pickBtn.label":             "🖼 Carica carta",
      "paperPanel.pickBtn.tooltip":           "Carica una carta personalizzata (viene salvata nel progetto)",
      "paperPanel.resetBtn.label":            "↺ Predefinita",
      "paperPanel.resetBtn.tooltip":          "Torna alla carta predefinita",
      "toast.paper.loaded":                   "🖼 Carta personalizzata caricata",
      "toast.paper.reset":                    "↺ Carta predefinita ripristinata",
      "toast.paper.tooLarge":                 "⚠️ Immagine troppo grande o non valida",

      // ── Status bar ──────────────────────────────────────────
      "statusBar.zoom":                       "Zoom",
      "statusBar.cursor":                     "Cursore",
      "statusBar.cursor.empty":               "— mm",
      "statusBar.selection":                  "Selezione",
      "statusBar.selection.empty":            "Nessuna",
      "statusBar.calibration":                "Calibrazione",

      // ── Modale: Selettore linee freehand ────────────────────
      "freehandList.modal.title":             "📋 Linee disegnate a mano libera",
      "freehandList.modal.cancel":            "Annulla",
      "freehandList.modal.deleteSelected":    "🗑️ Elimina selezionati",

      // ── Modale: Esporta disegno mano libera ─────────────────
      "freehandExport.modal.title":           "✏️ Esporta Disegno a Mano Libera",
      "freehandExport.modal.format":          "Formato:",
      "freehandExport.modal.formatSvg":       "SVG vettoriale (perfetto)",
      "freehandExport.modal.formatPng":       "PNG alta risoluzione",
      "freehandExport.modal.type":            "Tipo esportazione:",
      "freehandExport.modal.typeSingle":      "Unico file",
      "freehandExport.modal.typeSeparate":    "File separati (uno per linea)",
      "freehandExport.modal.cancel":          "Annulla",
      "freehandExport.modal.confirm":         "✅ ESPORTA",

      // ── Modale: Selettore punta acquerello ──────────────────
      "brushTip.modal.title":                 "🖌️ Seleziona Punta Pennello Acquerello",
      "brushTip.modal.cancel":                "Annulla",

      // ── Modale: Esporta PDF ─────────────────────────────────
      "pdfExport.modal.title":                "📄 Esporta PDF (A4) — Cosa vuoi includere?",
      "pdfExport.modal.close.tooltip":        "Chiudi",
      "pdfExport.modal.subtitle":             "Il PDF sarà salvato in formato A4 reale a 300 DPI (massima qualità).",
      "pdfExport.modal.mode.full.title":      "🖼️ Tutto il canvas completo (100%)",
      "pdfExport.modal.mode.full.desc":       "Esporta esattamente ciò che vedi: sfondo, texture, acquerello, mano libera, forme.",
      "pdfExport.modal.mode.shapesOnPaper.title": "📜 Solo forme su texture carta",
      "pdfExport.modal.mode.shapesOnPaper.desc":  "Solo le forme geometriche, sopra la texture carta. Niente acquerello né mano libera.",
      "pdfExport.modal.mode.shapesOnBg.title":    "🌄 Solo forme con immagine di sfondo",
      "pdfExport.modal.mode.shapesOnBg.desc":     "Solo le forme geometriche, sopra l'immagine di sfondo caricata.",
      "pdfExport.modal.mode.shapesOnWhite.title": "⬜ Solo forme su sfondo bianco",
      "pdfExport.modal.mode.shapesOnWhite.desc":  "Solo le forme geometriche, sfondo bianco solido. Ideale per stampa neutra.",
      "pdfExport.modal.mode.shapesOnTransparent.title": "🔲 Solo forme su sfondo trasparente",
      "pdfExport.modal.mode.shapesOnTransparent.desc":  "Solo le forme. La maggior parte dei lettori PDF mostra il bianco; alcuni mostrano la trasparenza reale.",
      "pdfExport.modal.cancel":               "Annulla",
      "pdfExport.modal.confirm":              "✅ Esporta PDF",

      // ── Modale: Esporta PNG/SVG ─────────────────────────────
      "pngSvgExport.modal.title":             "🖼️ Esporta PNG / SVG — Cosa preferisci?",
      "pngSvgExport.modal.close.tooltip":     "Chiudi",
      "pngSvgExport.modal.subtitle":          "Il PNG salva un'immagine raster ad alta risoluzione del canvas completo. L'SVG salva solo le forme geometriche in formato vettoriale (sfondo trasparente, dimensioni reali in mm).",
      "pngSvgExport.modal.mode.pngFull.title":    "🖼️ PNG completo del canvas",
      "pngSvgExport.modal.mode.pngFull.desc":     "Esporta tutto ciò che vedi: sfondo, texture carta, forme, mano libera, acquerello.",
      "pngSvgExport.modal.mode.svgFilled.title":  "🧩 SVG vettoriale — forme con riempimento",
      "pngSvgExport.modal.mode.svgFilled.desc":   "Solo le forme geometriche, con il loro colore o texture di riempimento e la posizione esatta. Sfondo trasparente.",
      "pngSvgExport.modal.mode.svgOutline.title": "✏️ SVG vettoriale — solo contorni",
      "pngSvgExport.modal.mode.svgOutline.desc":  "Solo i contorni delle forme: stroke del colore di riempimento se tinta unita, nero se la forma ha una texture. Sfondo trasparente.",
      "pngSvgExport.modal.cancel":            "Annulla",
      "pngSvgExport.modal.confirm":           "✅ Esporta",

      // ── Modale: Conferma Nuovo Progetto ─────────────────────
      "newProject.modal.title":               "🆕 Nuovo Progetto",
      "newProject.modal.close.tooltip":       "Chiudi",
      "newProject.modal.body":                "Verrà creato un nuovo progetto con canvas vuoto.<br /><br /><strong style=\"color: #ff9800\">⚠️ Tutto il lavoro non salvato andrà perso</strong> (forme, disegni a mano libera, acquerello, immagine di sfondo).<br /><br /><span style=\"opacity: 0.75\">Vuoi procedere?</span>",
      "newProject.modal.cancel":              "Annulla",
      "newProject.modal.confirm":             "✅ Crea nuovo progetto",

      // ── Modale: Impostazioni Wacom ──────────────────────────
      "wacom.modal.title":                    "🖊️ Tavoletta Wacom — Impostazioni",
      "wacom.modal.close.tooltip":            "Chiudi",
      "wacom.modal.detecting":                "⌛ Rilevamento in corso...",
      "wacom.modal.redetect":                 "🔄 Rileva",
      "wacom.modal.inkWarning":               "⚠️ La pressione non è disponibile. Apri <b>Wacom Tablet Properties</b> e attiva la modalità <b>Windows Ink</b>, oppure aggiorna il driver Wacom.",
      "wacom.modal.enable.title":             "Abilita integrazione Wacom",
      "wacom.modal.enable.desc":              "Disattiva per tornare al comportamento solo-mouse",

      "wacom.modal.pressure.title":           "⚙️ Pressione",
      "wacom.modal.pressure.sensitivity":     "Sensibilità globale",
      "wacom.modal.pressure.curve":           "Curva di risposta",
      "wacom.modal.pressure.curveLinear":     "📏 Lineare (default)",
      "wacom.modal.pressure.curveSoft":       "🪶 Soft (più sensibile a tocco leggero)",
      "wacom.modal.pressure.curveHard":       "💪 Hard (serve premere forte)",
      "wacom.modal.pressure.curveStairs":     "🪜 A gradini (5 livelli)",

      "wacom.modal.modulations.title":        "🎯 Cosa modula la pressione",
      "wacom.modal.modulations.width":        "Spessore tratto",
      "wacom.modal.modulations.opacity":      "Opacità tratto",
      "wacom.modal.modulations.flow":         "Flusso acquerello",
      "wacom.modal.modulations.min":          "min",
      "wacom.modal.modulations.max":          "max",

      "wacom.modal.tilt.title":               "🎯 Inclinazione penna (tilt)",
      "wacom.modal.tilt.enable":              "Abilita modulazione tilt",
      "wacom.modal.tilt.desc":                "Allarga + ruota il timbro acquerello a seconda dell'inclinazione della penna",
      "wacom.modal.tilt.widthAmp":            "Ampiezza allargamento",
      "wacom.modal.tilt.rotateAmp":           "Ampiezza rotazione timbro",
      "wacom.modal.tilt.note":                "💡 La tilt agisce solo sull'acquerello. Penna inclinata di lato → pennellata più larga e con l'orientamento del timbro che segue l'inclinazione reale (come un pennello vero).",

      "wacom.modal.buttons.title":            "🔘 Tasti laterali della penna",
      "wacom.modal.buttons.low":              "Tasto BASSO",
      "wacom.modal.buttons.high":             "Tasto ALTO",
      "wacom.modal.buttons.note":             "💡 Nota: sulla Bamboo CTL-460 il riconoscimento dei due tasti dipende dal driver. Se entrambi i tasti eseguono la stessa azione, prova a invertire la configurazione nelle Wacom Tablet Properties.",
      "wacom.modal.buttons.calib.title":      "🎓 Calibrazione tasti",
      "wacom.modal.buttons.calib.desc":       "Insegna a Mosaica quale codice button corrisponde a ciascun tasto della tua penna. Clicca un pulsante qui sotto e poi premi il tasto corrispondente sulla penna entro 10 secondi.",
      "wacom.modal.buttons.calib.calibLow":   "🎯 Calibra tasto BASSO",
      "wacom.modal.buttons.calib.calibHigh":  "🎯 Calibra tasto ALTO",
      "wacom.modal.buttons.calib.cancel":     "✕ Annulla",
      "wacom.modal.buttons.calib.reset":      "🔄 Reset",
      "wacom.modal.buttons.calib.statusEmpty":"Stato calibrazione...",

      "wacom.modal.testLive.title":           "🎨 Test pressione dal vivo",
      "wacom.modal.testLive.clear":           "Pulisci",
      "wacom.modal.testLive.pressure":        "Pressione:",
      "wacom.modal.testLive.tilt":            "Tilt:",
      "wacom.modal.testLive.inclination":     "Inclinazione:",

      "wacom.modal.footer.openApp":           "🪟 Apri Wacom Preferenze",
      "wacom.modal.footer.resetDefaults":     "🔄 Ripristina default",
      "wacom.modal.footer.done":              "Fatto",

      // ════════════════════════════════════════════════════════
      //  FASE 4 — STRINGHE DINAMICHE JS (renderer / wacom / inputMapping)
      // ════════════════════════════════════════════════════════

      // ── TOAST renderer.js — calibrazione ──
      "toast.calib.invalidValue":           "❌ Inserisci un valore valido (> 0)",
      "toast.calib.applied":                "✅ Calibrazione applicata! Fattore = {factor}",
      "toast.calib.reset":                  "🔄 Calibrazione resettata a 1.0",

      // ── TOAST renderer.js — forme / selezione ──
      "toast.shape.directEditOnlySingle":   "Modifica diretta disponibile solo per forme singole",
      "toast.selection.selectFirst":        "Seleziona prima un oggetto",
      "toast.selection.selectFirstAlt":     "Seleziona un oggetto prima",
      "toast.shape.createError":            "Errore creazione forma",
      "toast.shape.changed":                "Forma → {name}",
      "toast.shape.duplicated":             "✅ Forma duplicata",

      // ── TOAST renderer.js — gruppi ──
      "toast.group.grouped":                "✅ {count} oggetti raggruppati",
      "toast.group.ungrouped":              "✅ Gruppo separato ({count} oggetti)",
      "toast.group.duplicated":             "✅ Gruppo duplicato ({count} oggetti)",
      "toast.objects.duplicated":           "✅ {count} oggetti duplicati",
      "toast.objects.deleted":              "✅ {count} oggetti eliminati",

      // ── TOAST renderer.js — texture / colore ──
      "toast.texture.selectFirst":          "❌ Seleziona almeno un oggetto prima",
      "toast.texture.noneSelected":         "Nessuna texture selezionata",
      "toast.texture.applied":              "Texture applicata: {filename}",
      "toast.texture.applyError":           "Impossibile applicare texture",
      "toast.texture.appliedMany":          "✅ Texture applicata a {count} oggetto/i ({filename})",
      "toast.texture.folderError":          "Errore apertura cartella texture",
      "toast.color.applied":                "Colore applicato",
      "toast.color.applyError":             "Errore applicazione colore",

      // ── TOAST renderer.js — progetti ──
      "toast.project.loaded":               "Progetto caricato: {filename}",
      "toast.project.openApiUnavailable":   "API apertura progetto non disponibile",
      "toast.project.openCancelled":        "Apertura progetto annullata",
      "toast.project.openEmpty":            "Nessun contenuto nel progetto selezionato",
      "toast.project.openError":            "Errore apertura progetto",
      "toast.project.saveCancelled":        "Salvataggio annullato",
      "toast.project.saveError":            "Errore: {error}",
      "toast.project.saved":                "Progetto salvato ✔",
      "toast.project.savedAutoOpen":        "Progetto salvato e impostato come apertura automatica",
      "toast.project.saveErrorGeneric":     "Errore salvataggio progetto",
      "toast.project.created":              "Nuovo progetto creato",
      "toast.autoOpen.activated":           "✅ Apertura automatica attivata per questo progetto",
      "toast.autoOpen.saveFirst":           "⚠️ Salva prima il progetto per attivare l'apertura automatica",
      "toast.autoOpen.deactivated":         "Apertura automatica disattivata",

      // ── TOAST renderer.js — sfondo / canvas ──
      "toast.bg.applied":                   "Immagine di sfondo applicata",
      "toast.bg.nothingToRotate":           "Nessuna immagine di sfondo da ruotare",
      "toast.bg.nothingLoaded":             "Nessuna immagine caricata",
      "toast.bg.removed":                   "Sfondo rimosso",
      "toast.canvas.notReady":              "Canvas non pronto",
      "toast.canvas.flipped":               "🔄 Canvas {orient} ({w} × {h} mm)",
      "toast.canvas.alreadyVertical":       "✅ Canvas già in verticale",
      "toast.canvas.alreadyHorizontal":     "✅ Canvas già in orizzontale",
      "canvas.orient.vertical":             "verticale",
      "canvas.orient.horizontal":           "orizzontale",

      // ── TOAST renderer.js — export PDF / PNG / SVG ──
      "toast.pdf.generating":               "⏳ Generazione PDF ad alta risoluzione…",
      "toast.pdf.cancelled":                "❌ Generazione PDF annullata",
      "toast.pdf.done":                     "✅ PDF A4 esportato a 300 DPI",
      "toast.pdf.error":                    "❌ Errore durante l'export PDF",
      "toast.png.generating":               "⏳ Generazione PNG ad alta risoluzione...",
      "toast.png.done":                     "✅ PNG completo esportato ({w}×{h} px – calibrazione mm preservata)",
      "toast.png.error":                    "❌ Errore durante l'esportazione PNG",
      "toast.svg.moduleMissing":            "❌ Modulo SVG non caricato (svgExport.js)",

      // ── TOAST renderer.js — slice cerchi ──
      "toast.slice.needCircleOrEllipse":    "❌ Seleziona prima un cerchio o un'ellisse",
      "toast.slice.halves":                 "✅ Diviso in 2 metà (sovrapposte perfettamente sul centro)",
      "toast.slice.quarters":               "✅ Diviso in 4 quarti disposti in fila (senza sovrapposizione)",

      // ── TOAST renderer.js — freehand list / export ──
      "toast.freehand.noneSelected":        "❌ Nessuna linea selezionata",
      "toast.freehand.deleted":             "🗑️ {count} linee cancellate",
      "toast.freehand.noneToDelete":        "Nessuna linea da cancellare",
      "toast.freehand.allDeleted":          "✅ Tutte le {count} linee cancellate",
      "toast.freehand.exportSelectOne":     "❌ Seleziona almeno una linea",
      "toast.freehand.exportError":         "❌ Errore durante l'esportazione",

      // ── TOAST renderer.js — guida / fullscreen ──
      "toast.guide.opened":                 "📖 Guida Utente aperta nel browser predefinito",
      "toast.guide.openError":              "❌ Impossibile aprire la guida",
      "toast.fullscreen.exit":              "⛶ Uscita dalla modalità schermo intero",
      // ── TOAST lock/unlock (multi-line in renderer.js) ──
      "toast.lock.locked":                  "🔒 Oggetto bloccato",
      "toast.lock.lockedMany":              "🔒 {count} oggetti bloccati",
      "toast.lock.unlocked":                "🔓 Oggetto sbloccato",
      "toast.lock.unlockedMany":            "🔓 {count} oggetti sbloccati",

      // ── TOAST export multiplo PNG/SVG ──
      "toast.exportMulti.done":             "✅ Esportati {count} file {kind} ({w}×{h} px)!",

      // ── CONFIRM renderer.js ──
      "confirm.freehand.deleteAll":         "🗑️ CANCELLARE PERMANENTEMENTE TUTTE LE {count} LINEE (penna + acquerello)?",

      // ── SHAPE NAMES (italianNames in renderer.js) ──
      "shapes.rect":                        "Rettangolo",
      "shapes.circle":                      "Cerchio",
      "shapes.trapezoid":                   "Trapezio",
      "shapes.retto":                       "Triangolo rettangolo",
      "shapes.isoscele":                    "Triangolo isoscele",
      "shapes.scaleno":                     "Triangolo scaleno",
      "shapes.equilatero":                  "Triangolo equilatero",
      "shapes.acuto":                       "Triangolo acutangolo",
      "shapes.ottusangolo":                 "Triangolo ottusangolo",

      // ── RADIAL MENU dinamico (lock/unlock tooltip) ──
      "radial.tooltip.unlock":              "Sblocca oggetto",
      "radial.tooltip.lockFull":            "Blocca oggetto (non selezionabile per spostamento/scala/rotazione)",

      // ── UI dinamica generata da renderer.js ──
      "ui.newProject.label":                "Nuovo progetto",
      "ui.newProject.tooltip":              "Crea nuovo progetto (canvas vuoto)",
      "ui.freehand.selectAll":              "☑ Seleziona tutte",
      "ui.freehand.noLinesPresent":         "Nessuna linea presente",
      "ui.freehand.noLinesToExport":        "Nessuna linea da esportare",
      "ui.freehand.lineLabel":              "Linea {n} {type}",
      "ui.freehand.typeWatercolor":         "(acquerello)",
      "ui.freehand.typePen":                "(penna)",

      // ── WACOM toast (wacomTablet.js) ──
      "wacom.toast.eraser":                 "🧼 Gomma (tasto penna)",
      "wacom.toast.undo":                   "↩️ Annulla (tasto penna)",
      "wacom.toast.redo":                   "↪️ Ripeti (tasto penna)",
      "wacom.toast.calib.timeout":          "⏱️ Calibrazione tasto scaduta (10s) — riprova",
      "wacom.toast.calib.success":          "✅ Tasto {which} calibrato (code={code})",
      "wacom.toast.calib.whichLow":         "BASSO",
      "wacom.toast.calib.whichHigh":        "ALTO",
      "wacom.toast.api.unavailable":        "⚠️ API Wacom non disponibile",
      "wacom.toast.app.opened":             "🪟 App Wacom aperta — {path}",
      "wacom.toast.app.notFound":           "⚠️ Wacom Preferenze non trovata: {error}",
      "wacom.toast.app.notFoundFallback":   "verifica installazione driver",
      "wacom.toast.prefs.reset":            "🔄 Impostazioni Wacom ripristinate",
      "wacom.toast.calib.reset":            "🔄 Calibrazione tasti reset",

      // ── WACOM confirm + tooltip + modale dinamica ──
      "wacom.confirm.resetPrefs":           "Ripristinare tutte le impostazioni Wacom ai valori predefiniti?",
      "wacom.toolbar.connectedTooltip":     "Tavoletta Wacom connessa — clicca per impostazioni",
      "wacom.toolbar.disconnectedTooltip":  "Tavoletta Wacom non rilevata — clicca per impostazioni",
      "wacom.status.connectedLabel":        "✓ Connessa",
      "wacom.status.disconnectedLabel":     "✗ Non rilevata",
      "wacom.status.viaPenInput":           "Rilevata via input penna",
      "wacom.status.disconnectedHint":      "collega la tavoletta o verifica i driver Wacom",
      "wacom.status.detecting":             "⌛ Rilevamento in corso...",
      "wacom.calib.pressLow":               "⏳ Premi ora il tasto BASSO della penna...",
      "wacom.calib.pressHigh":              "⏳ Premi ora il tasto ALTO della penna...",
      "wacom.calib.pressHighHint":          "(se non viene rilevato dopo qualche tentativo, il driver Wacom potrebbe non emetterlo: vedi nota sotto)",
      "wacom.calib.codeContextmenu":        "contextmenu (right-click sintetico)",
      "wacom.calib.codePrefix":             "code {code}",
      "wacom.calib.notCalibrated":          "non calibrato (uso euristica)",
      "wacom.calib.summary":                "Basso: {low} · Alto: {high}",

      // ── WACOM PEN_BUTTON_ACTIONS (label dropdown azioni penna) ──
      "wacom.action.none":                  "Nessuna azione",
      "wacom.action.rightClick":            "Click destro (default)",
      "wacom.action.doubleClick":           "Doppio click",
      "wacom.action.eraser":                "Gomma rapida",
      "wacom.action.pan":                   "Pan canvas (Alt+drag)",
      "wacom.action.undo":                  "Annulla (Ctrl+Z)",
      "wacom.action.redo":                  "Ripeti (Ctrl+Y)",
      "wacom.action.toggleFreehand":        "Toggle Penna",
      "wacom.action.toggleWatercolor":      "Toggle Acquerello",
      "wacom.action.toggleLasso":           "Toggle Lazo",

      // ── INPUTMAPPING toast (inputMapping.js) ──
      "im.toast.panActive":                 "✋ Pan canvas attivo",
      "im.toast.calib.timeout":             "⏱️ Calibrazione scaduta (15s) — riprova",
      "im.toast.arrow.alreadyNative":       "⚠️ Le frecce native sono già attive — scegli un tasto diverso",
      "im.toast.button.detected":           "🎯 Tasto rilevato: button code {code} ({name}) — assegnagli un'azione dal menù",
      "im.toast.chord.needTwo":             "⚠️ Servono almeno 2 tasti per un chord",
      "im.toast.chord.registered":          "✅ Combinazione registrata: {label}",
      "im.toast.shortcut.registered":       "✅ Scorciatoia registrata: {label}",
      "im.toast.arrow.keyAlreadyMapped":    "⚠️ Il tasto \"{key}\" è già mappato a un'altra freccia",
      "im.toast.arrow.registered":          "✅ {key} → {arrow}",
      "im.toast.prefs.reset":               "🔄 Mapping ripristinati ai default",
      "im.toast.chord.startPress":          "Premi simultaneamente i tasti del mouse che vuoi combinare.",
      "im.toast.shortcut.startPress":       "Premi la sequenza di tasti che vuoi aggiungere sulla tastiera.",
      "im.toast.arrow.startPress":          "Premi un tasto da mappare a {arrow}",

      // ── INPUTMAPPING confirm ──
      "im.confirm.resetDefaults":           "Ripristinare tutti i mapping ai valori di default?",

      // ── INPUTMAPPING button names + arrow names ──
      "im.button.left":                     "Sinistro",
      "im.button.middle":                   "Centrale (rotella)",
      "im.button.right":                    "Destro",
      "im.button.x1":                       "X1 (laterale Back)",
      "im.button.x2":                       "X2 (laterale Forward)",
      "im.button.generic":                  "Button {code}",
      "im.arrow.upShort":                   "su",
      "im.arrow.downShort":                 "giù",
      "im.arrow.leftShort":                 "sinistra",
      "im.arrow.rightShort":                "destra",
      "im.arrow.up":                        "freccia su",
      "im.arrow.down":                      "freccia giù",
      "im.arrow.left":                      "freccia sinistra",
      "im.arrow.right":                     "freccia destra",

      // ── INPUTMAPPING ACTIONS — label dropdown azioni mouse/scorciatoia ──
      "im.action.none":                     "Nessuna azione",
      "im.action.undo":                     "Annulla (Undo)",
      "im.action.redo":                     "Ripeti (Redo)",
      "im.action.copy":                     "Copia",
      "im.action.paste":                    "Incolla",
      "im.action.cut":                      "Taglia",
      "im.action.delete":                   "Elimina selezione",
      "im.action.zoomIn":                   "Zoom in",
      "im.action.zoomOut":                  "Zoom out",
      "im.action.zoomReset":                "Reset zoom",
      "im.action.toggleLasso":              "Toggle Lazo",
      "im.action.toggleFreehand":           "Toggle Penna",
      "im.action.toggleWatercolor":         "Toggle Acquerello",
      "im.action.toggleEraser":             "Toggle Gomma",
      "im.action.toggleSelectTool":         "Strumento Selezione",
      "im.action.panCanvas":                "Pan canvas (tieni premuto)",
      "im.action.doubleClick":              "Doppio click",
      "im.action.saveProject":              "Salva progetto",
      "im.action.openProject":              "Apri progetto",
      "im.action.deselectAll":              "Deseleziona tutto",
      "im.action.duplicateSelection":       "Duplica selezione",

      // ── INPUTMAPPING banner calibrazione (innerHTML dinamico) ──
      "im.banner.chord.press":              "⏳ <b>Premi simultaneamente i tasti del mouse</b> che formano la combinazione...",
      "im.banner.chord.detectedSoFar":      "Rilevati finora: {captured} — rilascia per confermare (0.5s).",
      "im.banner.chord.none":               "nessuno",
      "im.banner.cancel":                   "annulla",
      "im.banner.escToCancel":              "Esc per annullare",
      "im.banner.shortcut.press":           "⏳ <b>Premi la combinazione di tasti</b> (modificatori + tasto)...",
      "im.banner.shortcut.timeout":         "timeout 15s",
      "im.banner.arrow.press":              "⏳ <b>Premi un tasto</b> da mappare come freccia",
      "im.banner.arrow.hintSingle":         "Solo tasti singoli, senza modificatori. Le frecce native (↑↓←→) sono già attive e non possono essere rimappate.",

      // ── INPUTMAPPING placeholder liste vuote ──
      "im.placeholder.noChord":             "Nessuna combinazione configurata. Premi \"➕ Aggiungi combinazione\" e premi i tasti del mouse insieme.",
      "im.placeholder.noShortcut":          "Nessuna scorciatoia personalizzata. Premi \"➕ Aggiungi scorciatoia\" e digita la combinazione (es. Ctrl+L).",
      "im.placeholder.noArrow":             "Nessun tasto mappato come freccia. Premi uno dei \"➕ Mappa per ↑/↓/←/→\" qui sopra per assegnare un tasto fisico a una direzione.",

      // ── INPUTMAPPING modale HTML (data-i18n applicato runtime) ──
      "im.modal.title":                     "🖱️⌨️ Mappatura Mouse & Tastiera",
      "im.modal.close":                     "Chiudi",
      "im.modal.enableLabel":               "Abilita mapping personalizzati",
      "im.modal.enableHint":                "Disattiva per tornare al comportamento standard (sx=selezione, dx=rotazione su forme)",
      "im.modal.singleTitle":               "🖱️ Tasti singoli del mouse",
      "im.modal.learnButton":               "🎯 Rileva codice tasto",
      "im.modal.singleHint":                "I tasti laterali (X1/X2) sui mouse HP HSA-P007M, gaming e simili emettono di norma button code 3 (back) e 4 (forward). Mappali qui per evitare la navigazione del browser e usarli come scorciatoie a tua scelta.",
      "im.modal.chordTitle":                "🤝 Combinazioni (chord) — più tasti mouse insieme",
      "im.modal.addChord":                  "➕ Aggiungi combinazione",
      "im.modal.chordHint":                 "Esempio: <b>Sinistro + Destro</b> per Annulla. Le combinazioni hanno priorità sui tasti singoli: se il chord si completa, l'azione del singolo non scatta.",
      "im.modal.shortcutTitle":             "⌨️ Scorciatoie tastiera personalizzate",
      "im.modal.addShortcut":               "➕ Aggiungi scorciatoia",
      "im.modal.shortcutHint":              "Esempio: <b>Ctrl+L</b> → Toggle Lazo. ⚠️ Le scorciatoie di base di Mosaica (Ctrl+Z/C/V/X, Delete, Ctrl+/-, Ctrl+R, frecce) sono protette: per sovrascriverle, assegnale qui — la tua versione avrà la precedenza.<br/>Premi <b>➕ Aggiungi scorciatoia</b> e premi la sequenza di tasti che vuoi aggiungere sulla tastiera.",
      "im.modal.arrowTitle":                "🎮 Tasti come frecce direzionali",
      "im.modal.arrowMapUp":                "➕ Mappa per ↑",
      "im.modal.arrowMapDown":              "➕ Mappa per ↓",
      "im.modal.arrowMapLeft":              "➕ Mappa per ←",
      "im.modal.arrowMapRight":             "➕ Mappa per →",
      "im.modal.arrowHint":                 "Mappa tasti singoli (es. <b>W</b>→↑, <b>S</b>→↓, <b>A</b>→←, <b>D</b>→→) per spostare la forma selezionata. <b>Le frecce native (↑↓←→) restano sempre attive in parallelo</b>.<br/>Step di movimento: <b>0.1 mm</b> di default, <b>1 mm</b> con <kbd>Shift</kbd>, <b>0.01 mm</b> con <kbd>Ctrl</kbd>. Senza selezione, fa pan della vista di 5 mm.<br/>I tasti mappati scattano solo da soli o con <kbd>Shift</kbd>: le combinazioni con <kbd>Ctrl</kbd>/<kbd>Alt</kbd>/<kbd>Cmd</kbd> restano libere per le scorciatoie.",
      "im.modal.advancedTitle":             "⚙️ Opzioni avanzate",
      "im.modal.chordDelayLabel":           "Ritardo chord disambiguation (ms):",
      "im.modal.chordDelayHint":            "Quando un tasto premuto potrebbe far parte di una combinazione mappata, il suo mapping single attende N ms per dare tempo alla combinazione. 0 = scatta subito.",
      "im.modal.preserveRotationLabel":     "Preserva rotazione fine sul tasto destro",
      "im.modal.preserveRotationHint":      "Il mapping del tasto destro non scatta sopra le forme (ruotabili).",
      "im.modal.suspendDrawingLabel":       "Sospendi in modalità disegno",
      "im.modal.suspendDrawingHint":        "Penna/Acquerello/Gomma: il tasto sinistro disegna, i mapping singoli sono sospesi.",
      "im.modal.debugLabel":                "Diagnostica console",
      "im.modal.debugHint":                 "Stampa log dettagliati nella DevTools console (Ctrl+Shift+I). Utile per capire perché un mapping non scatta.",
      "im.modal.resetDefaults":             "🔄 Ripristina default",
      "im.modal.done":                      "Fatto",
      "im.modal.relearn":                   "🎯 Riapprendi",
      "im.modal.relearnArrow":              "🎯 Riapprendi tasto",
      "im.modal.disabledWarn":              "⚠️ Mapping personalizzati DISATTIVATI — nessuna scorciatoia/chord/freccia personalizzata funzionerà",
    
      // ── Sistema aggiornamenti ──────────────────────────────
      "menu.update.check.label":            "🔄 Verifica aggiornamenti",
      "menu.update.check.tooltip":          "Cerca nuove versioni di Mosaica su GitHub",

      "update.modal.title":                 "Aggiornamenti di Mosaica",
      "update.modal.current":               "Versione corrente",
      "update.modal.available":             "Nuova versione",
      "update.modal.currentLabel":          "Versione installata: {ver}",
      "update.modal.releaseNotes":          "Novità di questa versione:",
      "update.modal.assetInfo":             "{name} · {size}",
      "update.modal.autoCheck":             "Controlla all'avvio",

      "update.modal.download":              "Scarica e installa",
      "update.modal.later":                 "Più tardi",
      "update.modal.skip":                  "Salta questa versione",
      "update.modal.cancel":                "Annulla",
      "update.modal.installNow":            "Installa ora",
      "update.modal.installLater":          "Installa più tardi",
      "update.modal.retry":                 "Riprova",

      "update.modal.downloading":           "Download dell'aggiornamento in corso…",
      "update.modal.downloadingHint":       "Puoi continuare a lavorare. Non chiudere Mosaica.",
      "update.modal.readyLine1":            "Download completato.",
      "update.modal.readyLine2":            "Mosaica si chiuderà per avviare l'installer. Il lavoro non salvato verrà preservato dall'auto-salvataggio.",

      "update.checking":                    "Verifica della disponibilità di nuove versioni…",
      "update.upToDate.line1":              "Stai usando l'ultima versione di Mosaica Workspace Pro.",

      "update.notes.empty":                 "Nessuna nota di rilascio fornita.",

      "update.error.generic":               "Si è verificato un errore.",
      "update.error.network":               "Impossibile contattare GitHub. Verifica la connessione.",
      "update.error.bridgeMissing":         "Bridge IPC degli aggiornamenti non disponibile.",
      "update.error.platformInfo":          "Impossibile leggere le informazioni di piattaforma.",
      "update.error.notWindows":            "Gli aggiornamenti automatici sono supportati solo su Windows.",
      "update.error.devMode":               "Sei in modalità sviluppo (npm run dev). Gli aggiornamenti sono disponibili solo nella versione installata.",
      "update.error.localVersion":          "Versione locale non riconosciuta: ",
      "update.error.remoteVersion":         "Tag remoto non riconosciuto: ",
      "update.error.noRelease":             "Nessuna release trovata sul repository GitHub.",
      "update.error.noAsset":               "La release non contiene un installer Windows.",
      "update.error.noInstaller":           "Installer non trovato sul disco.",
      "update.error.downloadPrefix":        "Download fallito: ",
      "update.error.downloadGeneric":       "Errore durante il download.",
      "update.error.installPrefix":         "Avvio installer fallito: ",

      "update.toast.newAvailable":          "🎉 Nuova versione disponibile: {ver}",
      "update.toast.installLater":          "Installer scaricato. Lo lanceremo alla prossima verifica.",
      "update.toast.skipped":               "Versione {ver} ignorata.",

      "common.close":                       "Chiudi",
      "common.ok":                          "OK",

      // ── FASE 5 — keyboardShortcuts.js (conferma riavvio) ──
      "kbd.confirm.restart": "🔄 Riavviare completamente Mosaica Workspace Pro?\n\nTutti i cambiamenti non salvati andranno persi.",

      // ── FASE 5 — csb-image.js (overlay immagine di riferimento) ──
      "csb.img.btn.move": "🔓 Sposta/Scala",
      "csb.img.btn.locked": "🔒 Bloccata",
      "csb.img.title.move": "Modalità attiva: trascina per spostare, angoli per ridimensionare. Clicca per bloccare.",
      "csb.img.title.locked": "Immagine bloccata come riferimento. Clicca per spostarla/ridimensionarla.",
      "csb.img.btn.load": "🖼 Immagine",
      "csb.img.title.load": "Carica un'immagine di riferimento da ricalcare",
      "csb.img.label.opacity": "Opacità img",
      "csb.img.title.opacity": "Opacità immagine di riferimento",
      "csb.img.btn.remove": "✕ Rimuovi",
      "csb.img.title.remove": "Rimuovi l'immagine di riferimento",

      // ── FASE 5 — customShapeBuilder.js (builder forme personalizzate) ──
      "csb.paper.palladianaOnly": "  (solo palladiana)",
      "csb.paper.areaLabel": "Area foglio: ",
      "csb.status.palladianaWarn": " ⚠️ Foglio palladiana (>A4): usa 💾 Salva palladiana — l'inserimento nel mosaico è disattivato.",
      "csb.status.shapesOnSheet": "Forme sul foglio: {total}. ",
      "csb.status.placeFirst": "Clicca sul foglio per piazzare il 1° vertice.",
      "csb.status.placeN": "{n} vertice/i piazzati. Continua a cliccare per tracciare i lati.",
      "csb.status.closeHint": "{n} vertici. Chiudi la forma cliccando sul 1° vertice (verde) o premi Invio.",
      "csb.status.editHead": "Forma selezionata ({v} vertici, {c} curva/e). ",
      "csb.status.editBody": "Trascina il corpo per spostarla, i vertici per modellarla, le maniglie a metà lato per curvare. ",
      "csb.status.editFoot": "➕ Nuova forma (o doppio click) · 🗑/Canc per eliminarla.",
      "csb.toast.completeFirst": "Completa la forma corrente (almeno 3 vertici) o annullala prima di iniziarne un'altra",
      "csb.toast.disablePenInsert": "Disattiva penna/acquerello prima di inserire la forma",
      "csb.toast.biggerThanA4": "Foglio più grande di A4: inserimento disabilitato. Usa il salvataggio progetto palladiana.",
      "csb.toast.shapesInserted": "✅ {count} forme inserite",
      "csb.toast.shapeInserted": "✅ Forma personalizzata inserita",
      "csb.toast.palSaveUnavail": "Salvataggio palladiana non disponibile (riavvia l'app dopo l'aggiornamento)",
      "csb.toast.noShapeToSave": "Nessuna forma da salvare: chiudi almeno una forma",
      "csb.toast.palSaved": "💾 Progetto palladiana salvato: ",
      "csb.toast.palSaveErr": "Errore nel salvataggio del progetto palladiana",
      "csb.toast.palOpenUnavail": "Apertura palladiana non disponibile (riavvia l'app dopo l'aggiornamento)",
      "csb.toast.notPalladiana": "Questo non è un progetto palladiana (.mspp.json)",
      "csb.toast.palLoaded": "📂 Progetto palladiana caricato: ",
      "csb.toast.palOpenErr": "Errore nell'apertura del progetto palladiana",
      "csb.toast.disablePenCreate": "Disattiva penna/acquerello per creare una forma",

      // ── FASE 5 — saveLoader.js (schermata di caricamento) ──
      "saveloader.title.default": "Salvataggio in corso",
      "saveloader.sub.preparing": "Preparazione…",
      "saveloader.sub.cancelled": "Salvataggio annullato",
      "saveloader.sub.error": "Errore durante il salvataggio",
      "saveloader.sub.errorWith": "Errore: {msg}",
      "saveloader.title.saveProject": "Salvataggio progetto",
      "saveloader.sub.prepProject": "Preparazione dei dati progetto…",
      "saveloader.sub.transfer": "Trasferimento al sistema…",
      "saveloader.sub.writeDisk": "Scrittura su disco…",
      "saveloader.title.exportPdf": "Esportazione PDF A4",
      "saveloader.sub.gen300": "Generazione immagine 300 DPI…",
      "saveloader.sub.composePdfWrite": "Composizione PDF e scrittura file…",
      "saveloader.title.exportImage": "Esportazione immagine",
      "saveloader.sub.composeCanvas": "Composizione canvas finale…",
      "saveloader.sub.writeFile": "Scrittura file…",
      "saveloader.title.exportFreehand": "Esportazione disegno mano libera",
      "saveloader.sub.composeLayers": "Composizione livelli (carta + penna + acquerello)…",
      "saveloader.sub.writeNFiles": "Scrittura {n} file…",
      "saveloader.sub.composePdfA4": "Composizione PDF A4…",
      "saveloader.sub.writePdfFile": "Scrittura file PDF…",
      "saveloader.title.exportPng": "Esportazione PNG completo",
      "saveloader.sub.writePngHi": "Scrittura PNG ad alta risoluzione…",
      "saveloader.title.exportSvg": "Esportazione SVG forme",
      "saveloader.sub.writeSvg": "Scrittura SVG vettoriale…",

      // ── FASE 6 — customShapeBuilder.js (modale forme personalizzate) ──
      "csb.modal.title": "✏️ Crea forma personalizzata",
      "csb.modal.paper": "Foglio:",
      "csb.modal.custom": "Personalizzato",
      "csb.modal.paperPreset": "Preset foglio",
      "csb.modal.width": "Larghezza",
      "csb.modal.height": "Altezza",
      "csb.modal.unit": "Unità di misura per le dimensioni personalizzate",
      "csb.modal.apply": "Applica",
      "csb.modal.applyPaper": "Applica dimensioni foglio",
      "csb.modal.paperArea": "Area del foglio applicato",
      "csb.modal.zoomOut": "Riduci zoom (−)",
      "csb.modal.zoomLevel": "Livello zoom",
      "csb.modal.zoomIn": "Aumenta zoom (+)",
      "csb.modal.fit": "Adatta alla vista (0)",
      "csb.modal.close": "Chiudi (Esc)",
      "csb.modal.color": "Colore",
      "csb.modal.colorTitle": "Colore di riempimento",
      "csb.modal.opacity": "Opacità",
      "csb.modal.opacityTitle": "Opacità riempimento",
      "csb.modal.allCorners": "Tutti gli angoli",
      "csb.modal.allCornersTitle": "Arrotonda tutti gli angoli vivi (mm)",
      "csb.modal.selCorner": "Angolo selezionato",
      "csb.modal.selCornerTitle": "Seleziona un vertice sul foglio, poi arrotonda solo quello",
      "csb.modal.savePal": "💾 Salva palladiana",
      "csb.modal.savePalTitle": "Salva il foglio come progetto palladiana (.mspp.json)",
      "csb.modal.openPal": "📂 Apri palladiana",
      "csb.modal.openPalTitle": "Apri un progetto palladiana (.mspp.json)",
      "csb.modal.undoVertex": "↶ Vertice",
      "csb.modal.undoVertexTitle": "Rimuovi ultimo vertice (Backspace)",
      "csb.modal.newShape": "➕ Nuova forma",
      "csb.modal.newShapeTitle": "Inizia una nuova forma sul foglio (N)",
      "csb.modal.deleteShape": "🗑 Elimina forma",
      "csb.modal.deleteShapeTitle": "Elimina la forma selezionata (Canc)",
      "csb.modal.reset": "🔄 Ricomincia",
      "csb.modal.resetTitle": "Svuota il foglio e ricomincia",
      "csb.modal.cancel": "Annulla",
      "csb.footer.help": "Click = vertice · Invio = chiudi (≥3) · doppio click area libera = nuova forma (o N) · trascina il corpo = sposta · Canc = elimina forma · rotella = zoom · Alt+drag = pan · doppio click / tasto destro su una curva = raddrizzala",
      "csb.label.none": "nessuno",
      "csb.label.curvedSide": "V{v}: lato curvo",
      "csb.insert.btn": "✅ Inserisci nel canvas",
      "csb.insert.btnMany": "✅ Inserisci {count} forme",
      "csb.insert.titleOne": "Inserisci la forma nel canvas del mosaico",
      "csb.insert.titleMany": "Inserisci tutte le {count} forme nel canvas del mosaico",
      "csb.insert.titleDisabled": "Fogli più grandi di A4 → solo progetto palladiana (inserimento disabilitato)",
      "csb.save.titleDisabled": "Chiudi almeno una forma per poter salvare il progetto palladiana",
      // ── Costruttore Scena 3D ─────────────────────────────────
      "leftToolbar.scene3D.tooltip":          "Costruttore scena 3D — mosaico prospettico (sfere, scatole, piani)",
      "s3d.modal.title":                      "🧊 Costruttore scena 3D",
      "s3d.modal.close":                      "Chiudi (Esc)",
      "s3d.modal.projection":                 "Proiezione",
      "s3d.proj.persp":                       "Prospettica",
      "s3d.proj.ortho":                       "Assonometrica",
      "s3d.modal.focal":                      "Focale",
      "s3d.camera.title":                     "Camera",
      "s3d.cam.front":                        "Frontale",
      "s3d.cam.top":                          "Dall'alto",
      "s3d.cam.bottom":                       "Dal basso",
      "s3d.cam.threeq":                       "3/4",
      "s3d.cam.fit":                          "Adatta la scena alla vista",
      "s3d.light.dir":                        "Luce direzione",
      "s3d.light.elev":                       "Altezza luce",
      "s3d.light.strength":                   "Intensità ombre",
      "s3d.grout.label":                      "Fuga",
      "s3d.grout.on":                         "Fuga colorata",
      "s3d.grout.color":                      "Colore fuga",
      "s3d.grout.depth":                      "Profondità",
      "s3d.objects.title":                    "Oggetti",
      "s3d.add.sphere":                       "Aggiungi sfera",
      "s3d.add.box":                          "Aggiungi scatola",
      "s3d.add.plane":                        "Aggiungi piano",
      "s3d.obj.delete":                       "Elimina oggetto",
      "s3d.obj.duplicate":                     "Duplica oggetto",
      "s3d.obj.copySuffix":                    "(copia)",
      "s3d.obj.hide":                          "Nascondi oggetto",
      "s3d.obj.show":                          "Mostra oggetto",
      "s3d.obj.lock":                          "Blocca oggetto",
      "s3d.obj.unlock":                        "Sblocca oggetto",
      "s3d.obj.delLocked":                     "Sblocca per eliminare",
      "s3d.type.sphere":                      "Sfera",
      "s3d.type.box":                         "Scatola",
      "s3d.type.plane":                       "Piano",
      "s3d.type.lathe":                       "Tornio",
      "s3d.name.vase":                        "Vaso",
      "s3d.add.lathe":                        "Aggiungi solido al tornio (vaso, colonna...)",
      "s3d.props.preset":                     "Forma",
      "s3d.props.maxDiameter":                "Diametro max (mm)",
      "s3d.lathe.vaso":                        "Vaso",
      "s3d.lathe.anfora":                      "Anfora",
      "s3d.lathe.colonna":                     "Colonna",
      "s3d.lathe.cilindro":                    "Cilindro",
      "s3d.lathe.cono":                        "Cono",
      "s3d.lathe.ciotola":                     "Ciotola",
      "s3d.lathe.calice":                      "Calice",
      "s3d.lathe.uovo":                        "Uovo",
      "s3d.name.floor":                       "Pavimento",
      "s3d.name.wall":                        "Parete",
      "s3d.name.table":                       "Tavolo",
      "s3d.props.none":                       "Nessun oggetto selezionato",
      "s3d.props.locked":                      "🔒 Oggetto bloccato — sbloccalo dalla lista per modificarlo",
      "s3d.props.title":                      "proprietà",
      "s3d.props.color":                      "Colore",
      "s3d.props.diameter":                   "Diametro (mm)",
      "s3d.props.poleSquare":                 "Squadratura poli",
      "s3d.props.width":                      "Larghezza (mm)",
      "s3d.props.height":                     "Altezza (mm)",
      "s3d.props.depth":                      "Profondità (mm)",
      "s3d.props.rotY":                       "Rotazione (°)",
      "s3d.props.tilt":                       "Inclinazione (°)",
      "s3d.props.pos":                        "Posizione X/Y/Z",
      "s3d.props.tile":                       "Tessera (mm)",
      "s3d.props.gap":                        "Fuga (mm)",
      "s3d.props.offset":                     "Sfalsamento (mm)",
      "s3d.props.arrange":                    "Disposizione",
      "s3d.props.arrangeBrick":               "A mattoncino (sfalsata)",
      "s3d.props.arrangeCols":                "Colonne allineate",
      "s3d.footer.count":                     "{count} tessere visibili",
      "s3d.footer.help":                      "trascina = orbita · Shift/tasto destro+trascina = sposta · rotella = avvicina/allontana",
      "s3d.footer.fitA4":                     "Adatta al foglio A4",
      "s3d.footer.fitA4Title":                "Riduce la scena per farla stare nel foglio A4. Se disattivato, le dimensioni in mm sono quelle reali della scena (può uscire dal foglio).",
      "s3d.modal.reset":                      "🔄 Scena esempio",
      "s3d.modal.resetTitle":                 "Ripristina la scena di esempio",
      "s3d.modal.cancel":                     "Annulla",
      "s3d.insert.btn":                       "✅ Inserisci nel mosaico",
      "s3d.toast.disablePen":                 "Disattiva penna/acquerello prima di inserire la scena",
      "s3d.toast.disablePenOpen":             "Disattiva penna/acquerello per aprire il costruttore 3D",
      "s3d.toast.empty":                      "Nessuna tessera visibile da inserire",
      "s3d.toast.tooMany":                    "⛔ Troppe tessere ({count} > {max}): aumenta la dimensione tessera o togli oggetti",
      "s3d.toast.manyWarn":                   "⚠️ {count} tessere: il canvas potrebbe rallentare",
      "s3d.toast.outOfA4":                    "⚠️ La scena è più grande del foglio A4: dopo l'inserimento selezionala e ridimensionala",
      "s3d.toast.inserted":                   "✅ {count} tessere inserite nel mosaico",
      "s3d.toast.insertedFit":                "✅ {count} tessere inserite (scena adattata al foglio: {pct}%)",
      "s3d.refine.title":                     "Rifinitura tessere",
      "s3d.refine.enter":                     "✂️ Rifinisci e ritaglia",
      "s3d.refine.back":                      "← Scena 3D",
      "s3d.refine.outline":                   "Solo contorni",
      "s3d.refine.crop":                      "Ritaglio A4",
      "s3d.refine.portrait":                  "▯ Verticale",
      "s3d.refine.landscape":                 "▭ Orizzontale",
      "s3d.refine.cropCenter":                "⊹ Centra",
      "s3d.flow.toggle":                      "📐 Andamento",
      "s3d.flow.draw":                        "✏️ Disegna guida",
      "s3d.flow.select":                      "▭ Seleziona fila",
      "s3d.flow.across":                      "Di traverso",
      "s3d.flow.apply":                       "↻ Applica",
      "s3d.flow.clear":                       "🧹 Pulisci",
      "s3d.flow.done":                        "✓ Fine",
      "s3d.flow.help":                        "Disegna guida: clic = punto, trascina = sposta, doppio clic = togli · Seleziona fila: trascina un riquadro (Shift aggiunge, Alt toglie) · Applica = allinea le tessere alla guida · destro/centrale = sposta vista",
      "s3d.flow.needGuide":                   "Disegna prima la linea guida (almeno 2 punti)",
      "s3d.flow.needSel":                     "Seleziona prima una fila di tessere",
      "s3d.flow.applied":                     "↻ {n} tessere allineate all'andamento",
      "s3d.refine.noSel":                     "Nessuna tessera selezionata",
      "s3d.refine.shape":                     "Forma",
      "s3d.refine.sweep":                     "Spicchio",
      "s3d.refine.secStart":                  "Angolo iniziale",
      "s3d.refine.triAngles":                 "Angoli alfa / beta",
      "s3d.refine.trapTop":                   "Base sup. (%)",
      "s3d.refine.width":                     "Larghezza (mm)",
      "s3d.refine.height":                    "Altezza (mm)",
      "s3d.refine.rot":                       "Rotazione (°)",
      "s3d.refine.delete":                    "Elimina tessera",
      "s3d.refine.reFreeze":                  "Ricatturare la scena sostituirà le tessere e perderai le modifiche fatte nella rifinitura. Continuare?",
      "s3d.refine.footerHelp":                "clic = seleziona tessera · trascina tessera = sposta · pallina gialla = ruota · trascina nel vuoto / tasto destro / Shift = sposta vista · rotella = zoom",      "s3d.refine.help":                      "Clicca una tessera per selezionarla. Trascina il corpo per spostarla, la pallina gialla in alto per ruotarla. Usa i campi per misure e forma esatte. Le tessere restano forme intere: la curva di un andamento nasce ruotandole.",
      "s3d.shape.free":                       "Originale",
      "s3d.shape.rect":                       "Quadrato / Rettangolo",
      "s3d.shape.triangle":                   "Triangolo",
      "s3d.shape.trapezoid":                  "Trapezio",
      "s3d.shape.sector":                     "Settore (cerchio/ellisse)",
      "s3d.sweep.360":                        "Intero",
      "s3d.sweep.180":                        "Metà",
      "s3d.sweep.90":                         "Quarto",
      "s3d.sweep.45":                         "Ottavo",
      "s3d.lathe.custom":                     "✏️ Disegnato a mano",
      "s3d.lathe.customInfo":                 "Profilo disegnato · altezza {h} · diam. max {d} mm",
      "s3d.lathe.editProfile":                "Modifica profilo",
      "s3d.lathe.drawProfile":                "Disegna profilo",
      "s3d.lathe.drawProfileTitle":           "Disegna a mano la mezza-sagoma che il tornio fa girare",
      "s3d.profile.title":                    "Profilo del tornio",
      "s3d.profile.sideHelp":                 "Trascina i pallini per modellare la mezza-sagoma. Clicca sulla linea per aggiungere un punto, doppio clic o Canc per toglierlo. L'asse tratteggiato è il centro: la sagoma viene specchiata e fatta girare attorno ad esso. Premi Conferma profilo per applicarla al tornio.",
      "s3d.profile.cancel":                   "← Annulla profilo",
      "s3d.profile.cancelTitle":              "Torna alla scena senza applicare il profilo",
      "s3d.profile.confirm":                  "✅ Conferma profilo",
      "s3d.profile.confirmTitle":             "Applica il profilo disegnato al tornio",
      "s3d.profile.selPoint":                 "Punto: r {r} · y {y} mm",
      "s3d.profile.noPoint":                  "Nessun punto selezionato",
      "s3d.profile.count":                    "{n} punti",
      "s3d.profile.size":                     "Altezza {h} · diametro max {d} mm",
      "s3d.profile.min2":                     "Servono almeno 2 punti nel profilo",
      "s3d.profile.saved":                    "Profilo personalizzato applicato al tornio",
      "s3d.profile.help":                     "clic sulla linea = aggiungi punto · trascina pallino = sposta · doppio clic / Canc = togli · Shift/destro+trascina = sposta vista · rotella = zoom",
    },

    en: {
      // ────────────────────────────────────────────────────────
      //  PHASE 1 — File menu → language section + change toast
      // ────────────────────────────────────────────────────────
      "menu.language.label":    "🌐 Language",
      "menu.language.tooltip":  "Change interface language",
      "menu.language.it":       "🇮🇹 Italiano",
      "menu.language.en":       "🇬🇧 English",

      "toast.languageChanged":  "Language set: {name}. The app is restarting…",
      "toast.languageError":    "Error while changing language",

      // ════════════════════════════════════════════════════════
      //  PHASE 2 — STATIC HTML (index.html)
      // ════════════════════════════════════════════════════════

      // ── App loader ──────────────────────────────────────────
      "appLoader.loaderNote":                 "Loading…",

      // ── Radial menu (data-tooltip) ──────────────────────────
      "radial.tooltip.rotate":                "Rotate object (drag or wheel)",
      "radial.tooltip.duplicate":             "Duplicate object",
      "radial.tooltip.scale":                 "Resize freely",
      "radial.tooltip.copyColor":             "Change current color",
      "radial.tooltip.pasteColor":            "Paste copied color",
      "radial.tooltip.changeShape":           "Change shape (triangle/trapezoid/sector)",
      "radial.tooltip.sliceCircle":           "Slice circle/ellipse (Click=4 quarters | Alt+Click=2 halves)",
      "radial.tooltip.lock":                  "Lock object (not selectable)",
      "radial.tooltip.delete":                "Delete object (Del key)",
      "radial.tooltip.group":                 "Group selected objects",
      "radial.tooltip.ungroup":               "Ungroup",

      // ── Color popup ─────────────────────────────────────────
      "colorPopup.changeColor.label":         "Change color",
      "colorPopup.changeColor.tooltip":       "Change color",
      "colorPopup.colorInput.tooltip":        "Pick color",

      // ── Lasso popover ───────────────────────────────────────
      "lasso.popover.ariaLabel":              "Lasso Sensitivity",
      "lasso.popover.title":                  "🎯 Lasso Sensitivity",
      "lasso.popover.close":                  "Close",
      "lasso.popover.hint":                   "How much of a tile must fall inside the lasso path to be selected. <b>Lower</b> = more permissive (useful between dense tiles with narrow gaps where the lasso must touch the shapes to grab them). <b>Higher</b> = more restrictive (only shapes almost entirely inside).",
      "lasso.popover.resetTooltip":           "Restore recommended value for dense mosaics",
      "lasso.popover.resetLabel":             "Default (0.20)",
      // ── Brush selection + Texture on all tiles (NEW) ──
      "leftToolbar.lassoBrush.tooltip":        "Brush selection — paint over tiles to select them (strokes add up, CTRL = deselect). Right click to set the tip size.",
      "lassoBrush.popover.ariaLabel":          "Brush selection size",
      "lassoBrush.popover.title":              "🖌️ Brush selection",
      "lassoBrush.popover.close":              "Close",
      "lassoBrush.popover.size":               "Tip",
      "lassoBrush.popover.hint":               "Tip diameter in real millimeters on the sheet: the bigger it is, the more tiles you grab per stroke. Strokes add up; hold CTRL to deselect.",
      "lassoBrush.popover.resetLabel":         "Default (12 mm)",
      "lassoBrush.popover.resetTooltip":       "Restore the recommended size",
      "texturePanel.all.title":                "▦ All tiles",
      "texturePanel.all.btnTooltip":           "Apply a texture to ALL tiles on the canvas (grain and color included)",
      "texturePanel.all.ariaLabel":            "Texture on all tiles",
      "texturePanel.all.close":                "Close",
      "texturePanel.all.select":               "Texture",
      "texturePanel.all.selectPlaceholder":    "— choose a texture —",
      "texturePanel.all.grain":                "Grain",
      "texturePanel.all.colorize":             "tint from color wheel",
      "texturePanel.all.hint":                 "Apply the chosen texture to every tile on the canvas (does not touch pen, watercolor, background, Palladiana and 3D). Grain and color apply to all.",
      "texturePanel.all.remove":               "Remove from all",
      "toast.textureAll.noTiles":              "❌ No tiles on the canvas",
      "toast.textureAll.applied":              "✅ Texture applied to all {count} tiles",
      "toast.textureAll.none":                 "No tiles with texture",
      "toast.textureAll.removed":              "🧽 Texture removed from {count} tiles",
      "toast.brushSelect.on":                  "🖌️ Brush selection active — paint over the tiles (CTRL = deselect)",
      "toast.brushSelect.count":               "🖌️ {count} tiles — exit or press Enter to confirm",
      "toast.brushSelect.committed":           "🖌️ {count} tiles selected",

      // ── Measure overlay (radial size slider) ────────────────
      "measure.radialSize.tooltip":           "Radial menu size (double click = reset)",

      // ── Top bar: File menu ──────────────────────────────────
      "menu.file.title":                      "File",
      "menu.file.openProject.label":          "📂 Open project…",
      "menu.file.openProject.tooltip":        "Open project",
      "menu.file.saveProject.label":          "💾 Save project",
      "menu.file.saveProject.tooltip":        "Save project",
      "menu.file.autoOpen.label":             "Open project on startup",

      // ── Top bar: Export menu ────────────────────────────────
      "menu.export.title":                    "Export",
      "menu.export.pdf.label":                "📄 Export PDF (A4)",
      "menu.export.pdf.tooltip":              "Export to A4 PDF",
      "menu.export.png.label":                "🖼️ Export PNG / SVG",
      "menu.export.png.tooltip":              "Export PNG/SVG image",
      "menu.export.freehand.label":           "✏️ Export freehand drawing",
      "menu.export.freehand.tooltip":         "Export only freehand lines",

      // ── Top bar: undo/redo/zoom ─────────────────────────────
      "topbar.undo.tooltip":                  "Undo (Ctrl+Z)",
      "topbar.redo.tooltip":                  "Redo (Ctrl+Y)",
      "topbar.zoom.out.tooltip":              "Zoom out",
      "topbar.zoom.in.tooltip":               "Zoom in",
      "topbar.zoom.reset.tooltip":            "Reset zoom",

      // ── Top bar: calibration ────────────────────────────────
      "calib.dropdown.tooltip":               "Real mm calibration",
      "calib.dropdown.label":                 "Calibration",
      "calib.panel.title":                    "Real mm calibration",
      "calib.panel.steps.intro":              "Quick steps:",
      "calib.panel.step1":                    "Browser zoom at 100% + OS scaling at 100%",
      "calib.panel.step2":                    "<strong>Measure the black strip below</strong> with a digital caliper",
      "calib.panel.step3":                    "Enter the real value and press \"Apply calibration\"",
      "calib.panel.stripLabel":               "50 mm THEORETICAL",
      "calib.panel.realMeasured.label":       "Real caliper measurement (mm):",
      "calib.panel.apply":                    "Apply calibration",
      "calib.panel.reset":                    "Reset calibration (1.0)",
      "calib.panel.note":                     "The strip is exactly 50 mm theoretical. Measure it physically!",

      // ── Top bar: fullscreen, guide, wacom, input mapping ────
      "topbar.fullscreen.enter.tooltip":      "Enter fullscreen mode",
      "topbar.fullscreen.exit.tooltip":       "Exit fullscreen mode (ESC)",
      "topbar.guide.label":                   "📖 Guide",
      "topbar.guide.tooltip":                 "Open User Guide",
      "topbar.wacom.label":                   "🖊️ Wacom",
      "topbar.wacom.tooltip":                 "Wacom Tablet — click for settings",
      "topbar.inputMapping.label":            "🖱️⌨️ Input",
      "topbar.inputMapping.tooltip":          "Mouse & Keyboard Mapping — click to customize",

      // ── Left toolbar ────────────────────────────────────────
      "leftToolbar.canvasVertical.tooltip":   "Vertical Canvas (A4 Portrait)",
      "leftToolbar.canvasHorizontal.tooltip": "Horizontal Canvas (A4 Landscape)",
      "leftToolbar.select.tooltip":           "Select / Move (default)",
      "leftToolbar.addShape.tooltip":         "Add shape at canvas center",
      "leftToolbar.customShape.tooltip":      "Create custom shape (non-standard polygon)",
      "leftToolbar.lasso.tooltip":            "Lasso — free selection (drag to select, auto-deactivates on release). Right click to adjust sensitivity.",
      "leftToolbar.freehand.tooltip":         "Pen — freehand drawing",
      "leftToolbar.eraser.tooltip":           "Eraser — clears freehand strokes",
      "leftToolbar.watercolor.tooltip":       "Watercolor — brushstroke with bleed",
      "leftToolbar.selectFreehand.tooltip":   "Drawn lines list (selector)",
      "leftToolbar.clearAllFreehand.tooltip": "Clear ALL freehand drawing",
      "leftToolbar.freehandClip.tooltip":     "Drawing containment perimeter (pen/watercolor): color only inside the area. Tap = vertex, drag = freehand, Enter/double-click = close, ESC = cancel. Right click = remove.",
      "freehandClip.toast.start":             "⬡ Perimeter: tap = vertex, drag = freehand, Enter/double-click = close, ESC = cancel",
      "freehandClip.toast.set":               "⬡ Containment perimeter set",
      "freehandClip.toast.needMore":          "⬡ At least 3 points are needed to close the perimeter",
      "freehandClip.toast.cancelled":         "⬡ Perimeter cancelled",
      "freehandClip.toast.removed":           "⬡ Containment perimeter removed",
      "freehandClip.toast.none":              "⬡ No perimeter to remove",

      // ── Inspector ───────────────────────────────────────────
      "inspector.title":                      "Inspector",
      "inspector.subtitle.empty":             "No selection",
      "inspector.colorBlock.title":           "Current color",
      "inspector.colorBlock.tinta":           "Hue",
      "inspector.colorBlock.tinta.tooltip":   "Stroke / watercolor color",
      "inspector.dimensions.title":           "Dimensions",
      "inspector.dimensions.width":           "Width",
      "inspector.dimensions.width.tooltip":   "Width in mm — Enter to apply, Esc to cancel",
      "inspector.dimensions.height":          "Height",
      "inspector.dimensions.height.tooltip":  "Height in mm — Enter to apply, Esc to cancel",
      "inspector.texture.title":               "Texture",
      "inspector.texture.grain":               "Grain",
      "inspector.texture.grain.tooltip":       "Texture size on the tile (mm). Small = fine grain, large = coarse grain.",
      "inspector.texture.colorize":            "Tint",
      "inspector.texture.colorize.hint":       "from color wheel",
      "inspector.texture.colorize.tooltip":    "Tint the texture with the color wheel: keeps the texture grain and pores, recolored to the chosen color.",
      "inspector.default.hint":               "Select a tool from the left toolbar<br />or create/select a shape on the canvas.<br /><br /><em style=\"opacity: 0.7\">Double-click on paper = new square</em>",

      "inspector.penna.title":                "Pen · Eraser",
      "inspector.penna.width":                "Width",
      "inspector.penna.note":                 "The pen draws vector strokes over shapes.<br />The eraser only clears freehand strokes.",

      "inspector.acquerello.title":           "Watercolor",
      "inspector.acquerello.width":           "Width",
      "inspector.acquerello.opacity":         "Opacity",
      "inspector.acquerello.tone":            "Tone",
      "inspector.acquerello.initialRotation": "Init. rotation",
      "inspector.acquerello.distance":        "Distance",
      "inspector.acquerello.jitterPos":       "Pos. jitter",
      "inspector.acquerello.rotation":        "Rotation",
      "inspector.acquerello.bleed":           "Bleed",
      "inspector.acquerello.layers":          "Layers",
      "inspector.acquerello.tip":             "Tip",
      "inspector.acquerello.mixing":          "Mixing",
      "inspector.acquerello.mixing.multiply": "Multiply (color over color)",
      "inspector.acquerello.mixing.overlay":  "Overlay (color sum)",
      "inspector.acquerello.mixing.softLight":"Soft Light (gentle sum)",

      "inspector.triangle.title":             "Triangle · Angles",
      "inspector.triangle.alpha":             "α (degrees)",
      "inspector.triangle.beta":              "β (degrees)",
      "inspector.triangle.snapPrefix":        "Angular snap:",

      // ── Texture panel ───────────────────────────────────────
      "texturePanel.label":                   "Texture preview",

      // ── BG panel ────────────────────────────────────────────
      "bgPanel.label":                        "Background",
      "bgPanel.dropHintPrefix":               "Drag here or",
      "bgPanel.pickBtn":                      "Choose file",
      "bgPanel.fitContain.label":             "Contain",
      "bgPanel.fitContain.tooltip":           "Fit Contain",
      "bgPanel.fitCover.label":               "Cover",
      "bgPanel.fitCover.tooltip":             "Fit Cover",
      "bgPanel.rotateLeft.label":             "↶ Rotate",
      "bgPanel.rotateLeft.tooltip":           "Rotate left",
      "bgPanel.rotateRight.label":            "Rotate ↷",
      "bgPanel.rotateRight.tooltip":          "Rotate right",
      "bgPanel.clear.label":                  "🗑 Remove",
      "bgPanel.clear.tooltip":                "Remove background",
      "paperPanel.label":                     "Paper texture",
      "paperPanel.toggle":                    "Show paper",
      "paperPanel.pickBtn.label":             "🖼 Load paper",
      "paperPanel.pickBtn.tooltip":           "Load a custom paper (saved with the project)",
      "paperPanel.resetBtn.label":            "↺ Default",
      "paperPanel.resetBtn.tooltip":          "Back to the default paper",
      "toast.paper.loaded":                   "🖼 Custom paper loaded",
      "toast.paper.reset":                    "↺ Default paper restored",
      "toast.paper.tooLarge":                 "⚠️ Image too large or invalid",

      // ── Status bar ──────────────────────────────────────────
      "statusBar.zoom":                       "Zoom",
      "statusBar.cursor":                     "Cursor",
      "statusBar.cursor.empty":               "— mm",
      "statusBar.selection":                  "Selection",
      "statusBar.selection.empty":            "None",
      "statusBar.calibration":                "Calibration",

      // ── Modal: Freehand lines selector ──────────────────────
      "freehandList.modal.title":             "📋 Freehand drawn lines",
      "freehandList.modal.cancel":            "Cancel",
      "freehandList.modal.deleteSelected":    "🗑️ Delete selected",

      // ── Modal: Export freehand drawing ──────────────────────
      "freehandExport.modal.title":           "✏️ Export Freehand Drawing",
      "freehandExport.modal.format":          "Format:",
      "freehandExport.modal.formatSvg":       "Vector SVG (perfect)",
      "freehandExport.modal.formatPng":       "High-resolution PNG",
      "freehandExport.modal.type":            "Export type:",
      "freehandExport.modal.typeSingle":      "Single file",
      "freehandExport.modal.typeSeparate":    "Separate files (one per line)",
      "freehandExport.modal.cancel":          "Cancel",
      "freehandExport.modal.confirm":         "✅ EXPORT",

      // ── Modal: Watercolor brush tip selector ────────────────
      "brushTip.modal.title":                 "🖌️ Select Watercolor Brush Tip",
      "brushTip.modal.cancel":                "Cancel",

      // ── Modal: Export PDF ───────────────────────────────────
      "pdfExport.modal.title":                "📄 Export PDF (A4) — What to include?",
      "pdfExport.modal.close.tooltip":        "Close",
      "pdfExport.modal.subtitle":             "PDF will be saved in real A4 format at 300 DPI (maximum quality).",
      "pdfExport.modal.mode.full.title":      "🖼️ Entire complete canvas (100%)",
      "pdfExport.modal.mode.full.desc":       "Exports exactly what you see: background, texture, watercolor, freehand, shapes.",
      "pdfExport.modal.mode.shapesOnPaper.title": "📜 Only shapes on paper texture",
      "pdfExport.modal.mode.shapesOnPaper.desc":  "Only geometric shapes, over paper texture. No watercolor or freehand.",
      "pdfExport.modal.mode.shapesOnBg.title":    "🌄 Only shapes with background image",
      "pdfExport.modal.mode.shapesOnBg.desc":     "Only geometric shapes, over the loaded background image.",
      "pdfExport.modal.mode.shapesOnWhite.title": "⬜ Only shapes on white background",
      "pdfExport.modal.mode.shapesOnWhite.desc":  "Only geometric shapes, solid white background. Ideal for neutral printing.",
      "pdfExport.modal.mode.shapesOnTransparent.title": "🔲 Only shapes on transparent background",
      "pdfExport.modal.mode.shapesOnTransparent.desc":  "Only shapes. Most PDF readers show white; some show real transparency.",
      "pdfExport.modal.cancel":               "Cancel",
      "pdfExport.modal.confirm":              "✅ Export PDF",

      // ── Modal: Export PNG/SVG ───────────────────────────────
      "pngSvgExport.modal.title":             "🖼️ Export PNG / SVG — What do you prefer?",
      "pngSvgExport.modal.close.tooltip":     "Close",
      "pngSvgExport.modal.subtitle":          "PNG saves a high-resolution raster image of the complete canvas. SVG saves only the geometric shapes in vector format (transparent background, real dimensions in mm).",
      "pngSvgExport.modal.mode.pngFull.title":    "🖼️ Complete canvas PNG",
      "pngSvgExport.modal.mode.pngFull.desc":     "Exports everything you see: background, paper texture, shapes, freehand, watercolor.",
      "pngSvgExport.modal.mode.svgFilled.title":  "🧩 Vector SVG — filled shapes",
      "pngSvgExport.modal.mode.svgFilled.desc":   "Only the geometric shapes, with their fill color or texture and exact position. Transparent background.",
      "pngSvgExport.modal.mode.svgOutline.title": "✏️ Vector SVG — outlines only",
      "pngSvgExport.modal.mode.svgOutline.desc":  "Only shape outlines: stroke of fill color if solid, black if shape has a texture. Transparent background.",
      "pngSvgExport.modal.cancel":            "Cancel",
      "pngSvgExport.modal.confirm":           "✅ Export",

      // ── Modal: New Project confirmation ─────────────────────
      "newProject.modal.title":               "🆕 New Project",
      "newProject.modal.close.tooltip":       "Close",
      "newProject.modal.body":                "A new project with empty canvas will be created.<br /><br /><strong style=\"color: #ff9800\">⚠️ All unsaved work will be lost</strong> (shapes, freehand drawings, watercolor, background image).<br /><br /><span style=\"opacity: 0.75\">Proceed?</span>",
      "newProject.modal.cancel":              "Cancel",
      "newProject.modal.confirm":             "✅ Create new project",

      // ── Modal: Wacom Tablet settings ────────────────────────
      "wacom.modal.title":                    "🖊️ Wacom Tablet — Settings",
      "wacom.modal.close.tooltip":            "Close",
      "wacom.modal.detecting":                "⌛ Detecting...",
      "wacom.modal.redetect":                 "🔄 Detect",
      "wacom.modal.inkWarning":               "⚠️ Pressure is not available. Open <b>Wacom Tablet Properties</b> and enable <b>Windows Ink</b> mode, or update the Wacom driver.",
      "wacom.modal.enable.title":             "Enable Wacom integration",
      "wacom.modal.enable.desc":              "Disable to return to mouse-only behavior",

      "wacom.modal.pressure.title":           "⚙️ Pressure",
      "wacom.modal.pressure.sensitivity":     "Global sensitivity",
      "wacom.modal.pressure.curve":           "Response curve",
      "wacom.modal.pressure.curveLinear":     "📏 Linear (default)",
      "wacom.modal.pressure.curveSoft":       "🪶 Soft (more sensitive to light touch)",
      "wacom.modal.pressure.curveHard":       "💪 Hard (needs firm pressure)",
      "wacom.modal.pressure.curveStairs":     "🪜 Stairs (5 levels)",

      "wacom.modal.modulations.title":        "🎯 What pressure modulates",
      "wacom.modal.modulations.width":        "Stroke width",
      "wacom.modal.modulations.opacity":      "Stroke opacity",
      "wacom.modal.modulations.flow":         "Watercolor flow",
      "wacom.modal.modulations.min":          "min",
      "wacom.modal.modulations.max":          "max",

      "wacom.modal.tilt.title":               "🎯 Pen tilt",
      "wacom.modal.tilt.enable":              "Enable tilt modulation",
      "wacom.modal.tilt.desc":                "Widens + rotates the watercolor stamp based on pen inclination",
      "wacom.modal.tilt.widthAmp":            "Widening amplitude",
      "wacom.modal.tilt.rotateAmp":           "Stamp rotation amplitude",
      "wacom.modal.tilt.note":                "💡 Tilt only affects watercolor. Pen tilted sideways → wider brushstroke with stamp orientation following the real inclination (like a real brush).",

      "wacom.modal.buttons.title":            "🔘 Pen side buttons",
      "wacom.modal.buttons.low":              "LOWER button",
      "wacom.modal.buttons.high":             "UPPER button",
      "wacom.modal.buttons.note":             "💡 Note: on Bamboo CTL-460 the recognition of the two buttons depends on the driver. If both buttons trigger the same action, try inverting the configuration in Wacom Tablet Properties.",
      "wacom.modal.buttons.calib.title":      "🎓 Button calibration",
      "wacom.modal.buttons.calib.desc":       "Teach Mosaica which button code corresponds to each pen button. Click a button below then press the matching pen button within 10 seconds.",
      "wacom.modal.buttons.calib.calibLow":   "🎯 Calibrate LOWER button",
      "wacom.modal.buttons.calib.calibHigh":  "🎯 Calibrate UPPER button",
      "wacom.modal.buttons.calib.cancel":     "✕ Cancel",
      "wacom.modal.buttons.calib.reset":      "🔄 Reset",
      "wacom.modal.buttons.calib.statusEmpty":"Calibration status...",

      "wacom.modal.testLive.title":           "🎨 Live pressure test",
      "wacom.modal.testLive.clear":           "Clear",
      "wacom.modal.testLive.pressure":        "Pressure:",
      "wacom.modal.testLive.tilt":            "Tilt:",
      "wacom.modal.testLive.inclination":     "Inclination:",

      "wacom.modal.footer.openApp":           "🪟 Open Wacom Preferences",
      "wacom.modal.footer.resetDefaults":     "🔄 Restore defaults",
      "wacom.modal.footer.done":              "Done",

      // ════════════════════════════════════════════════════════
      //  PHASE 4 — STRINGHE DINAMICHE JS (renderer / wacom / inputMapping)
      // ════════════════════════════════════════════════════════

      // ── TOAST renderer.js — calibrazione ──
      "toast.calib.invalidValue":           "❌ Enter a valid value (> 0)",
      "toast.calib.applied":                "✅ Calibration applied! Factor = {factor}",
      "toast.calib.reset":                  "🔄 Calibration reset to 1.0",

      // ── TOAST renderer.js — forme / selezione ──
      "toast.shape.directEditOnlySingle":   "Direct edit only available for single shapes",
      "toast.selection.selectFirst":        "Select an object first",
      "toast.selection.selectFirstAlt":     "Select an object first",
      "toast.shape.createError":            "Shape creation error",
      "toast.shape.changed":                "Shape → {name}",
      "toast.shape.duplicated":             "✅ Shape duplicated",

      // ── TOAST renderer.js — gruppi ──
      "toast.group.grouped":                "✅ {count} objects grouped",
      "toast.group.ungrouped":              "✅ Group ungrouped ({count} objects)",
      "toast.group.duplicated":             "✅ Group duplicated ({count} objects)",
      "toast.objects.duplicated":           "✅ {count} objects duplicated",
      "toast.objects.deleted":              "✅ {count} objects deleted",

      // ── TOAST renderer.js — texture / colore ──
      "toast.texture.selectFirst":          "❌ Select at least one object first",
      "toast.texture.noneSelected":         "No texture selected",
      "toast.texture.applied":              "Texture applied: {filename}",
      "toast.texture.applyError":           "Unable to apply texture",
      "toast.texture.appliedMany":          "✅ Texture applied to {count} object(s) ({filename})",
      "toast.texture.folderError":          "Error opening textures folder",
      "toast.color.applied":                "Color applied",
      "toast.color.applyError":             "Color apply error",

      // ── TOAST renderer.js — progetti ──
      "toast.project.loaded":               "Project loaded: {filename}",
      "toast.project.openApiUnavailable":   "Open project API not available",
      "toast.project.openCancelled":        "Open project cancelled",
      "toast.project.openEmpty":            "No content in the selected project",
      "toast.project.openError":            "Error opening project",
      "toast.project.saveCancelled":        "Save cancelled",
      "toast.project.saveError":            "Error: {error}",
      "toast.project.saved":                "Project saved ✔",
      "toast.project.savedAutoOpen":        "Project saved and set as auto-open",
      "toast.project.saveErrorGeneric":     "Error saving project",
      "toast.project.created":              "New project created",
      "toast.autoOpen.activated":           "✅ Auto-open enabled for this project",
      "toast.autoOpen.saveFirst":           "⚠️ Save the project first to enable auto-open",
      "toast.autoOpen.deactivated":         "Auto-open disabled",

      // ── TOAST renderer.js — sfondo / canvas ──
      "toast.bg.applied":                   "Background image applied",
      "toast.bg.nothingToRotate":           "No background image to rotate",
      "toast.bg.nothingLoaded":             "No image loaded",
      "toast.bg.removed":                   "Background removed",
      "toast.canvas.notReady":              "Canvas not ready",
      "toast.canvas.flipped":               "🔄 Canvas {orient} ({w} × {h} mm)",
      "toast.canvas.alreadyVertical":       "✅ Canvas already vertical",
      "toast.canvas.alreadyHorizontal":     "✅ Canvas already horizontal",
      "canvas.orient.vertical":             "portrait",
      "canvas.orient.horizontal":           "landscape",

      // ── TOAST renderer.js — export PDF / PNG / SVG ──
      "toast.pdf.generating":               "⏳ Generating high-resolution PDF…",
      "toast.pdf.cancelled":                "❌ PDF generation cancelled",
      "toast.pdf.done":                     "✅ A4 PDF exported at 300 DPI",
      "toast.pdf.error":                    "❌ Error during PDF export",
      "toast.png.generating":               "⏳ Generating high-resolution PNG...",
      "toast.png.done":                     "✅ Full PNG exported ({w}×{h} px – mm calibration preserved)",
      "toast.png.error":                    "❌ Error during PNG export",
      "toast.svg.moduleMissing":            "❌ SVG module not loaded (svgExport.js)",

      // ── TOAST renderer.js — slice cerchi ──
      "toast.slice.needCircleOrEllipse":    "❌ Select a circle or ellipse first",
      "toast.slice.halves":                 "✅ Split into 2 halves (perfectly overlapping at the center)",
      "toast.slice.quarters":               "✅ Split into 4 quarters arranged in a row (no overlap)",

      // ── TOAST renderer.js — freehand list / export ──
      "toast.freehand.noneSelected":        "❌ No line selected",
      "toast.freehand.deleted":             "🗑️ {count} lines deleted",
      "toast.freehand.noneToDelete":        "No lines to delete",
      "toast.freehand.allDeleted":          "✅ All {count} lines deleted",
      "toast.freehand.exportSelectOne":     "❌ Select at least one line",
      "toast.freehand.exportError":         "❌ Error during export",

      // ── TOAST renderer.js — guida / fullscreen ──
      "toast.guide.opened":                 "📖 User Guide opened in default browser",
      "toast.guide.openError":              "❌ Unable to open the guide",
      "toast.fullscreen.exit":              "⛶ Exiting fullscreen mode",
      // ── TOAST lock/unlock (multi-line in renderer.js) ──
      "toast.lock.locked":                  "🔒 Object locked",
      "toast.lock.lockedMany":              "🔒 {count} objects locked",
      "toast.lock.unlocked":                "🔓 Object unlocked",
      "toast.lock.unlockedMany":            "🔓 {count} objects unlocked",

      // ── TOAST export multiplo PNG/SVG ──
      "toast.exportMulti.done":             "✅ Exported {count} {kind} files ({w}×{h} px)!",

      // ── CONFIRM renderer.js ──
      "confirm.freehand.deleteAll":         "🗑️ PERMANENTLY DELETE ALL {count} LINES (pen + watercolor)?",

      // ── SHAPE NAMES (italianNames in renderer.js) ──
      "shapes.rect":                        "Rectangle",
      "shapes.circle":                      "Circle",
      "shapes.trapezoid":                   "Trapezoid",
      "shapes.retto":                       "Right triangle",
      "shapes.isoscele":                    "Isosceles triangle",
      "shapes.scaleno":                     "Scalene triangle",
      "shapes.equilatero":                  "Equilateral triangle",
      "shapes.acuto":                       "Acute triangle",
      "shapes.ottusangolo":                 "Obtuse triangle",

      // ── RADIAL MENU dinamico (lock/unlock tooltip) ──
      "radial.tooltip.unlock":              "Unlock object",
      "radial.tooltip.lockFull":            "Lock object (not selectable for move/scale/rotate)",

      // ── UI dinamica generata da renderer.js ──
      "ui.newProject.label":                "New project",
      "ui.newProject.tooltip":              "Create new project (empty canvas)",
      "ui.freehand.selectAll":              "☑ Select all",
      "ui.freehand.noLinesPresent":         "No lines present",
      "ui.freehand.noLinesToExport":        "No lines to export",
      "ui.freehand.lineLabel":              "Line {n} {type}",
      "ui.freehand.typeWatercolor":         "(watercolor)",
      "ui.freehand.typePen":                "(pen)",

      // ── WACOM toast (wacomTablet.js) ──
      "wacom.toast.eraser":                 "🧼 Eraser (pen button)",
      "wacom.toast.undo":                   "↩️ Undo (pen button)",
      "wacom.toast.redo":                   "↪️ Redo (pen button)",
      "wacom.toast.calib.timeout":          "⏱️ Button calibration timed out (10s) — try again",
      "wacom.toast.calib.success":          "✅ {which} button calibrated (code={code})",
      "wacom.toast.calib.whichLow":         "LOW",
      "wacom.toast.calib.whichHigh":        "HIGH",
      "wacom.toast.api.unavailable":        "⚠️ Wacom API not available",
      "wacom.toast.app.opened":             "🪟 Wacom app opened — {path}",
      "wacom.toast.app.notFound":           "⚠️ Wacom Preferences not found: {error}",
      "wacom.toast.app.notFoundFallback":   "check driver installation",
      "wacom.toast.prefs.reset":            "🔄 Wacom settings restored",
      "wacom.toast.calib.reset":            "🔄 Button calibration reset",

      // ── WACOM confirm + tooltip + modale dinamica ──
      "wacom.confirm.resetPrefs":           "Restore all Wacom settings to defaults?",
      "wacom.toolbar.connectedTooltip":     "Wacom tablet connected — click for settings",
      "wacom.toolbar.disconnectedTooltip":  "Wacom tablet not detected — click for settings",
      "wacom.status.connectedLabel":        "✓ Connected",
      "wacom.status.disconnectedLabel":     "✗ Not detected",
      "wacom.status.viaPenInput":           "Detected via pen input",
      "wacom.status.disconnectedHint":      "connect the tablet or check Wacom drivers",
      "wacom.status.detecting":             "⌛ Detecting...",
      "wacom.calib.pressLow":               "⏳ Press the pen's LOW button now...",
      "wacom.calib.pressHigh":              "⏳ Press the pen's HIGH button now...",
      "wacom.calib.pressHighHint":          "(if not detected after a few attempts, the Wacom driver may not emit it: see note below)",
      "wacom.calib.codeContextmenu":        "contextmenu (synthetic right-click)",
      "wacom.calib.codePrefix":             "code {code}",
      "wacom.calib.notCalibrated":          "not calibrated (heuristic)",
      "wacom.calib.summary":                "Low: {low} · High: {high}",

      // ── WACOM PEN_BUTTON_ACTIONS (label dropdown azioni penna) ──
      "wacom.action.none":                  "No action",
      "wacom.action.rightClick":            "Right click (default)",
      "wacom.action.doubleClick":           "Double click",
      "wacom.action.eraser":                "Quick eraser",
      "wacom.action.pan":                   "Pan canvas (Alt+drag)",
      "wacom.action.undo":                  "Undo (Ctrl+Z)",
      "wacom.action.redo":                  "Redo (Ctrl+Y)",
      "wacom.action.toggleFreehand":        "Toggle Pen",
      "wacom.action.toggleWatercolor":      "Toggle Watercolor",
      "wacom.action.toggleLasso":           "Toggle Lasso",

      // ── INPUTMAPPING toast (inputMapping.js) ──
      "im.toast.panActive":                 "✋ Pan canvas active",
      "im.toast.calib.timeout":             "⏱️ Calibration timed out (15s) — try again",
      "im.toast.arrow.alreadyNative":       "⚠️ Native arrows are already active — pick a different key",
      "im.toast.button.detected":           "🎯 Button detected: button code {code} ({name}) — assign an action from the menu",
      "im.toast.chord.needTwo":             "⚠️ At least 2 buttons are required for a chord",
      "im.toast.chord.registered":          "✅ Chord registered: {label}",
      "im.toast.shortcut.registered":       "✅ Shortcut registered: {label}",
      "im.toast.arrow.keyAlreadyMapped":    "⚠️ Key \"{key}\" is already mapped to another arrow",
      "im.toast.arrow.registered":          "✅ {key} → {arrow}",
      "im.toast.prefs.reset":               "🔄 Mappings reset to defaults",
      "im.toast.chord.startPress":          "Press simultaneously the mouse buttons you want to combine.",
      "im.toast.shortcut.startPress":       "Press the key sequence you want to add on the keyboard.",
      "im.toast.arrow.startPress":          "Press a key to map to {arrow}",

      // ── INPUTMAPPING confirm ──
      "im.confirm.resetDefaults":           "Restore all mappings to defaults?",

      // ── INPUTMAPPING button names + arrow names ──
      "im.button.left":                     "Left",
      "im.button.middle":                   "Middle (wheel)",
      "im.button.right":                    "Right",
      "im.button.x1":                       "X1 (side Back)",
      "im.button.x2":                       "X2 (side Forward)",
      "im.button.generic":                  "Button {code}",
      "im.arrow.upShort":                   "up",
      "im.arrow.downShort":                 "down",
      "im.arrow.leftShort":                 "left",
      "im.arrow.rightShort":                "right",
      "im.arrow.up":                        "up arrow",
      "im.arrow.down":                      "down arrow",
      "im.arrow.left":                      "left arrow",
      "im.arrow.right":                     "right arrow",

      // ── INPUTMAPPING ACTIONS — label dropdown azioni mouse/scorciatoia ──
      "im.action.none":                     "No action",
      "im.action.undo":                     "Undo",
      "im.action.redo":                     "Redo",
      "im.action.copy":                     "Copy",
      "im.action.paste":                    "Paste",
      "im.action.cut":                      "Cut",
      "im.action.delete":                   "Delete selection",
      "im.action.zoomIn":                   "Zoom in",
      "im.action.zoomOut":                  "Zoom out",
      "im.action.zoomReset":                "Reset zoom",
      "im.action.toggleLasso":              "Toggle Lasso",
      "im.action.toggleFreehand":           "Toggle Pen",
      "im.action.toggleWatercolor":         "Toggle Watercolor",
      "im.action.toggleEraser":             "Toggle Eraser",
      "im.action.toggleSelectTool":         "Select Tool",
      "im.action.panCanvas":                "Pan canvas (hold)",
      "im.action.doubleClick":              "Double click",
      "im.action.saveProject":              "Save project",
      "im.action.openProject":              "Open project",
      "im.action.deselectAll":              "Deselect all",
      "im.action.duplicateSelection":       "Duplicate selection",

      // ── INPUTMAPPING banner calibrazione (innerHTML dinamico) ──
      "im.banner.chord.press":              "⏳ <b>Press simultaneously the mouse buttons</b> that form the chord...",
      "im.banner.chord.detectedSoFar":      "Detected so far: {captured} — release to confirm (0.5s).",
      "im.banner.chord.none":               "none",
      "im.banner.cancel":                   "cancel",
      "im.banner.escToCancel":              "Esc to cancel",
      "im.banner.shortcut.press":           "⏳ <b>Press the key combination</b> (modifiers + key)...",
      "im.banner.shortcut.timeout":         "timeout 15s",
      "im.banner.arrow.press":              "⏳ <b>Press a key</b> to map as arrow",
      "im.banner.arrow.hintSingle":         "Single keys only, no modifiers. Native arrows (↑↓←→) are already active and cannot be remapped.",

      // ── INPUTMAPPING placeholder liste vuote ──
      "im.placeholder.noChord":             "No chord configured. Press \"➕ Add chord\" and press the mouse buttons together.",
      "im.placeholder.noShortcut":          "No custom shortcut. Press \"➕ Add shortcut\" and type the combination (e.g. Ctrl+L).",
      "im.placeholder.noArrow":             "No key mapped as arrow. Press one of the \"➕ Map for ↑/↓/←/→\" above to assign a physical key to a direction.",

      // ── INPUTMAPPING modale HTML (data-i18n applicato runtime) ──
      "im.modal.title":                     "🖱️⌨️ Mouse & Keyboard Mapping",
      "im.modal.close":                     "Close",
      "im.modal.enableLabel":               "Enable custom mappings",
      "im.modal.enableHint":                "Disable to revert to standard behavior (left=select, right=rotate on shapes)",
      "im.modal.singleTitle":               "🖱️ Single mouse buttons",
      "im.modal.learnButton":               "🎯 Detect button code",
      "im.modal.singleHint":                "Side buttons (X1/X2) on HP HSA-P007M, gaming and similar mice normally emit button code 3 (back) and 4 (forward). Map them here to prevent browser navigation and use them as shortcuts of your choice.",
      "im.modal.chordTitle":                "🤝 Chords — multiple mouse buttons together",
      "im.modal.addChord":                  "➕ Add chord",
      "im.modal.chordHint":                 "Example: <b>Left + Right</b> for Undo. Chords have priority over single buttons: if the chord completes, the single-button action does not fire.",
      "im.modal.shortcutTitle":             "⌨️ Custom keyboard shortcuts",
      "im.modal.addShortcut":               "➕ Add shortcut",
      "im.modal.shortcutHint":              "Example: <b>Ctrl+L</b> → Toggle Lasso. ⚠️ Mosaica's built-in shortcuts (Ctrl+Z/C/V/X, Delete, Ctrl+/-, Ctrl+R, arrows) are protected: to override them, assign them here — your version will take precedence.<br/>Press <b>➕ Add shortcut</b> and type the key sequence you want to add.",
      "im.modal.arrowTitle":                "🎮 Keys as directional arrows",
      "im.modal.arrowMapUp":                "➕ Map for ↑",
      "im.modal.arrowMapDown":              "➕ Map for ↓",
      "im.modal.arrowMapLeft":              "➕ Map for ←",
      "im.modal.arrowMapRight":             "➕ Map for →",
      "im.modal.arrowHint":                 "Map single keys (e.g. <b>W</b>→↑, <b>S</b>→↓, <b>A</b>→←, <b>D</b>→→) to move the selected shape. <b>Native arrows (↑↓←→) stay always active in parallel</b>.<br/>Movement step: <b>0.1 mm</b> by default, <b>1 mm</b> with <kbd>Shift</kbd>, <b>0.01 mm</b> with <kbd>Ctrl</kbd>. With no selection, pans the view by 5 mm.<br/>Mapped keys fire only alone or with <kbd>Shift</kbd>: combinations with <kbd>Ctrl</kbd>/<kbd>Alt</kbd>/<kbd>Cmd</kbd> remain free for shortcuts.",
      "im.modal.advancedTitle":             "⚙️ Advanced options",
      "im.modal.chordDelayLabel":           "Chord disambiguation delay (ms):",
      "im.modal.chordDelayHint":            "When a pressed button might be part of a mapped chord, its single-button mapping waits N ms to give the chord time. 0 = fire immediately.",
      "im.modal.preserveRotationLabel":     "Preserve fine rotation on right click",
      "im.modal.preserveRotationHint":      "The right-click mapping does not fire over (rotatable) shapes.",
      "im.modal.suspendDrawingLabel":       "Suspend in drawing mode",
      "im.modal.suspendDrawingHint":        "Pen/Watercolor/Eraser: left button draws, single-button mappings are suspended.",
      "im.modal.debugLabel":                "Console diagnostics",
      "im.modal.debugHint":                 "Print detailed logs to DevTools console (Ctrl+Shift+I). Useful to figure out why a mapping does not fire.",
      "im.modal.resetDefaults":             "🔄 Restore defaults",
      "im.modal.done":                      "Done",
      "im.modal.relearn":                   "🎯 Relearn",
      "im.modal.relearnArrow":              "🎯 Relearn key",
      "im.modal.disabledWarn":              "⚠️ Custom mappings DISABLED — no custom shortcut/chord/arrow will work",
    
      // ── Update system ──────────────────────────────────────
      "menu.update.check.label":            "🔄 Check for updates",
      "menu.update.check.tooltip":          "Look for new Mosaica versions on GitHub",

      "update.modal.title":                 "Mosaica Updates",
      "update.modal.current":               "Current version",
      "update.modal.available":             "New version",
      "update.modal.currentLabel":          "Installed version: {ver}",
      "update.modal.releaseNotes":          "What's new in this version:",
      "update.modal.assetInfo":             "{name} · {size}",
      "update.modal.autoCheck":             "Check on startup",

      "update.modal.download":              "Download & install",
      "update.modal.later":                 "Later",
      "update.modal.skip":                  "Skip this version",
      "update.modal.cancel":                "Cancel",
      "update.modal.installNow":            "Install now",
      "update.modal.installLater":          "Install later",
      "update.modal.retry":                 "Retry",

      "update.modal.downloading":           "Downloading update…",
      "update.modal.downloadingHint":       "You can keep working. Don't close Mosaica.",
      "update.modal.readyLine1":            "Download complete.",
      "update.modal.readyLine2":            "Mosaica will close to launch the installer. Unsaved work will be preserved by auto-save.",

      "update.checking":                    "Checking for new versions…",
      "update.upToDate.line1":              "You're running the latest version of Mosaica Workspace Pro.",

      "update.notes.empty":                 "No release notes provided.",

      "update.error.generic":               "An error occurred.",
      "update.error.network":               "Cannot reach GitHub. Check your connection.",
      "update.error.bridgeMissing":         "Update IPC bridge not available.",
      "update.error.platformInfo":          "Cannot read platform information.",
      "update.error.notWindows":            "Automatic updates are supported on Windows only.",
      "update.error.devMode":               "You're in development mode (npm run dev). Updates are available only in the installed version.",
      "update.error.localVersion":          "Unrecognized local version: ",
      "update.error.remoteVersion":         "Unrecognized remote tag: ",
      "update.error.noRelease":             "No release found on the GitHub repository.",
      "update.error.noAsset":               "The release does not contain a Windows installer.",
      "update.error.noInstaller":           "Installer not found on disk.",
      "update.error.downloadPrefix":        "Download failed: ",
      "update.error.downloadGeneric":       "Download error.",
      "update.error.installPrefix":         "Installer launch failed: ",

      "update.toast.newAvailable":          "🎉 New version available: {ver}",
      "update.toast.installLater":          "Installer downloaded. We'll launch it at the next check.",
      "update.toast.skipped":               "Version {ver} skipped.",

      "common.close":                       "Close",
      "common.ok":                          "OK",

      // ── FASE 5 — keyboardShortcuts.js (conferma riavvio) ──
      "kbd.confirm.restart": "🔄 Completely restart Mosaica Workspace Pro?\n\nAll unsaved changes will be lost.",

      // ── FASE 5 — csb-image.js (overlay immagine di riferimento) ──
      "csb.img.btn.move": "🔓 Move/Scale",
      "csb.img.btn.locked": "🔒 Locked",
      "csb.img.title.move": "Active mode: drag to move, corners to resize. Click to lock.",
      "csb.img.title.locked": "Image locked as reference. Click to move/resize it.",
      "csb.img.btn.load": "🖼 Image",
      "csb.img.title.load": "Load a reference image to trace",
      "csb.img.label.opacity": "Image opacity",
      "csb.img.title.opacity": "Reference image opacity",
      "csb.img.btn.remove": "✕ Remove",
      "csb.img.title.remove": "Remove the reference image",

      // ── FASE 5 — customShapeBuilder.js (builder forme personalizzate) ──
      "csb.paper.palladianaOnly": "  (palladiana only)",
      "csb.paper.areaLabel": "Sheet area: ",
      "csb.status.palladianaWarn": " ⚠️ Palladiana sheet (>A4): use 💾 Save palladiana — inserting into the mosaic is disabled.",
      "csb.status.shapesOnSheet": "Shapes on sheet: {total}. ",
      "csb.status.placeFirst": "Click on the sheet to place the 1st vertex.",
      "csb.status.placeN": "{n} vertex(es) placed. Keep clicking to draw the sides.",
      "csb.status.closeHint": "{n} vertices. Close the shape by clicking the 1st vertex (green) or press Enter.",
      "csb.status.editHead": "Shape selected ({v} vertices, {c} curve(s)). ",
      "csb.status.editBody": "Drag the body to move it, the vertices to reshape it, the mid-side handles to curve it. ",
      "csb.status.editFoot": "➕ New shape (or double click) · 🗑/Del to delete it.",
      "csb.toast.completeFirst": "Complete the current shape (at least 3 vertices) or cancel it before starting another",
      "csb.toast.disablePenInsert": "Turn off pen/watercolor before inserting the shape",
      "csb.toast.biggerThanA4": "Sheet larger than A4: insertion disabled. Use palladiana project save.",
      "csb.toast.shapesInserted": "✅ {count} shapes inserted",
      "csb.toast.shapeInserted": "✅ Custom shape inserted",
      "csb.toast.palSaveUnavail": "Palladiana save unavailable (restart the app after the update)",
      "csb.toast.noShapeToSave": "No shape to save: close at least one shape",
      "csb.toast.palSaved": "💾 Palladiana project saved: ",
      "csb.toast.palSaveErr": "Error while saving the palladiana project",
      "csb.toast.palOpenUnavail": "Palladiana open unavailable (restart the app after the update)",
      "csb.toast.notPalladiana": "This is not a palladiana project (.mspp.json)",
      "csb.toast.palLoaded": "📂 Palladiana project loaded: ",
      "csb.toast.palOpenErr": "Error while opening the palladiana project",
      "csb.toast.disablePenCreate": "Turn off pen/watercolor to create a shape",

      // ── FASE 5 — saveLoader.js (schermata di caricamento) ──
      "saveloader.title.default": "Saving…",
      "saveloader.sub.preparing": "Preparing…",
      "saveloader.sub.cancelled": "Save cancelled",
      "saveloader.sub.error": "Error during save",
      "saveloader.sub.errorWith": "Error: {msg}",
      "saveloader.title.saveProject": "Saving project",
      "saveloader.sub.prepProject": "Preparing project data…",
      "saveloader.sub.transfer": "Transferring to system…",
      "saveloader.sub.writeDisk": "Writing to disk…",
      "saveloader.title.exportPdf": "Exporting A4 PDF",
      "saveloader.sub.gen300": "Generating 300 DPI image…",
      "saveloader.sub.composePdfWrite": "Composing PDF and writing file…",
      "saveloader.title.exportImage": "Exporting image",
      "saveloader.sub.composeCanvas": "Composing final canvas…",
      "saveloader.sub.writeFile": "Writing file…",
      "saveloader.title.exportFreehand": "Exporting freehand drawing",
      "saveloader.sub.composeLayers": "Compositing layers (paper + pen + watercolor)…",
      "saveloader.sub.writeNFiles": "Writing {n} file(s)…",
      "saveloader.sub.composePdfA4": "Composing A4 PDF…",
      "saveloader.sub.writePdfFile": "Writing PDF file…",
      "saveloader.title.exportPng": "Exporting full PNG",
      "saveloader.sub.writePngHi": "Writing high-resolution PNG…",
      "saveloader.title.exportSvg": "Exporting shapes SVG",
      "saveloader.sub.writeSvg": "Writing vector SVG…",

      // ── FASE 6 — customShapeBuilder.js (modale forme personalizzate) ──
      "csb.modal.title": "✏️ Create custom shape",
      "csb.modal.paper": "Sheet:",
      "csb.modal.custom": "Custom",
      "csb.modal.paperPreset": "Sheet preset",
      "csb.modal.width": "Width",
      "csb.modal.height": "Height",
      "csb.modal.unit": "Unit of measure for custom dimensions",
      "csb.modal.apply": "Apply",
      "csb.modal.applyPaper": "Apply sheet dimensions",
      "csb.modal.paperArea": "Applied sheet area",
      "csb.modal.zoomOut": "Zoom out (−)",
      "csb.modal.zoomLevel": "Zoom level",
      "csb.modal.zoomIn": "Zoom in (+)",
      "csb.modal.fit": "Fit to view (0)",
      "csb.modal.close": "Close (Esc)",
      "csb.modal.color": "Color",
      "csb.modal.colorTitle": "Fill color",
      "csb.modal.opacity": "Opacity",
      "csb.modal.opacityTitle": "Fill opacity",
      "csb.modal.allCorners": "All corners",
      "csb.modal.allCornersTitle": "Round all sharp corners (mm)",
      "csb.modal.selCorner": "Selected corner",
      "csb.modal.selCornerTitle": "Select a vertex on the sheet, then round only that one",
      "csb.modal.savePal": "💾 Save palladiana",
      "csb.modal.savePalTitle": "Save the sheet as a palladiana project (.mspp.json)",
      "csb.modal.openPal": "📂 Open palladiana",
      "csb.modal.openPalTitle": "Open a palladiana project (.mspp.json)",
      "csb.modal.undoVertex": "↶ Vertex",
      "csb.modal.undoVertexTitle": "Remove last vertex (Backspace)",
      "csb.modal.newShape": "➕ New shape",
      "csb.modal.newShapeTitle": "Start a new shape on the sheet (N)",
      "csb.modal.deleteShape": "🗑 Delete shape",
      "csb.modal.deleteShapeTitle": "Delete the selected shape (Del)",
      "csb.modal.reset": "🔄 Restart",
      "csb.modal.resetTitle": "Clear the sheet and start over",
      "csb.modal.cancel": "Cancel",
      "csb.footer.help": "Click = vertex · Enter = close (≥3) · double-click empty area = new shape (or N) · drag the body = move · Del = delete shape · wheel = zoom · Alt+drag = pan · double-click / right-click on a curve = straighten it",
      "csb.label.none": "none",
      "csb.label.curvedSide": "V{v}: curved side",
      "csb.insert.btn": "✅ Insert into canvas",
      "csb.insert.btnMany": "✅ Insert {count} shapes",
      "csb.insert.titleOne": "Insert the shape into the mosaic canvas",
      "csb.insert.titleMany": "Insert all {count} shapes into the mosaic canvas",
      "csb.insert.titleDisabled": "Sheets larger than A4 → palladiana project only (insertion disabled)",
      "csb.save.titleDisabled": "Close at least one shape to save the palladiana project",
      // ── 3D Scene Builder ─────────────────────────────────────
      "leftToolbar.scene3D.tooltip":          "3D scene builder — perspective mosaic (spheres, boxes, planes)",
      "s3d.modal.title":                      "🧊 3D scene builder",
      "s3d.modal.close":                      "Close (Esc)",
      "s3d.modal.projection":                 "Projection",
      "s3d.proj.persp":                       "Perspective",
      "s3d.proj.ortho":                       "Axonometric",
      "s3d.modal.focal":                      "Focal",
      "s3d.camera.title":                     "Camera",
      "s3d.cam.front":                        "Front",
      "s3d.cam.top":                          "From above",
      "s3d.cam.bottom":                       "From below",
      "s3d.cam.threeq":                       "3/4",
      "s3d.cam.fit":                          "Fit scene to view",
      "s3d.light.dir":                        "Light direction",
      "s3d.light.elev":                       "Light height",
      "s3d.light.strength":                   "Shadow intensity",
      "s3d.grout.label":                      "Grout",
      "s3d.grout.on":                         "Colored grout",
      "s3d.grout.color":                      "Grout color",
      "s3d.grout.depth":                      "Depth",
      "s3d.objects.title":                    "Objects",
      "s3d.add.sphere":                       "Add sphere",
      "s3d.add.box":                          "Add box",
      "s3d.add.plane":                        "Add plane",
      "s3d.obj.delete":                       "Delete object",
      "s3d.obj.duplicate":                     "Duplicate object",
      "s3d.obj.copySuffix":                    "(copy)",
      "s3d.obj.hide":                          "Hide object",
      "s3d.obj.show":                          "Show object",
      "s3d.obj.lock":                          "Lock object",
      "s3d.obj.unlock":                        "Unlock object",
      "s3d.obj.delLocked":                     "Unlock to delete",
      "s3d.type.sphere":                      "Sphere",
      "s3d.type.box":                         "Box",
      "s3d.type.plane":                       "Plane",
      "s3d.type.lathe":                       "Lathe",
      "s3d.name.vase":                        "Vase",
      "s3d.add.lathe":                        "Add lathe solid (vase, column...)",
      "s3d.props.preset":                     "Shape",
      "s3d.props.maxDiameter":                "Max diameter (mm)",
      "s3d.lathe.vaso":                        "Vase",
      "s3d.lathe.anfora":                      "Amphora",
      "s3d.lathe.colonna":                     "Column",
      "s3d.lathe.cilindro":                    "Cylinder",
      "s3d.lathe.cono":                        "Cone",
      "s3d.lathe.ciotola":                     "Bowl",
      "s3d.lathe.calice":                      "Goblet",
      "s3d.lathe.uovo":                        "Egg",
      "s3d.name.floor":                       "Floor",
      "s3d.name.wall":                        "Wall",
      "s3d.name.table":                       "Table",
      "s3d.props.none":                       "No object selected",
      "s3d.props.locked":                      "🔒 Object locked — unlock it from the list to edit",
      "s3d.props.title":                      "properties",
      "s3d.props.color":                      "Color",
      "s3d.props.diameter":                   "Diameter (mm)",
      "s3d.props.poleSquare":                 "Pole squaring",
      "s3d.props.width":                      "Width (mm)",
      "s3d.props.height":                     "Height (mm)",
      "s3d.props.depth":                      "Depth (mm)",
      "s3d.props.rotY":                       "Rotation (°)",
      "s3d.props.tilt":                       "Tilt (°)",
      "s3d.props.pos":                        "Position X/Y/Z",
      "s3d.props.tile":                       "Tile (mm)",
      "s3d.props.gap":                        "Grout gap (mm)",
      "s3d.props.offset":                     "Stagger (mm)",
      "s3d.props.arrange":                    "Arrangement",
      "s3d.props.arrangeBrick":               "Running bond (offset)",
      "s3d.props.arrangeCols":                "Aligned columns",
      "s3d.footer.count":                     "{count} visible tiles",
      "s3d.footer.help":                      "drag = orbit · Shift/right-drag = pan · wheel = zoom in/out",
      "s3d.footer.fitA4":                     "Fit to A4 sheet",
      "s3d.footer.fitA4Title":                "Shrinks the scene to fit the A4 sheet. When off, mm sizes are the real scene sizes (may exceed the sheet).",
      "s3d.modal.reset":                      "🔄 Example scene",
      "s3d.modal.resetTitle":                 "Restore the example scene",
      "s3d.modal.cancel":                     "Cancel",
      "s3d.insert.btn":                       "✅ Insert into mosaic",
      "s3d.toast.disablePen":                 "Disable pen/watercolor before inserting the scene",
      "s3d.toast.disablePenOpen":             "Disable pen/watercolor to open the 3D builder",
      "s3d.toast.empty":                      "No visible tiles to insert",
      "s3d.toast.tooMany":                    "⛔ Too many tiles ({count} > {max}): increase tile size or remove objects",
      "s3d.toast.manyWarn":                   "⚠️ {count} tiles: the canvas may slow down",
      "s3d.toast.outOfA4":                    "⚠️ The scene is larger than the A4 sheet: select and resize it after insertion",
      "s3d.toast.inserted":                   "✅ {count} tiles inserted into the mosaic",
      "s3d.toast.insertedFit":                "✅ {count} tiles inserted (scene fitted to sheet: {pct}%)",
      "s3d.refine.title":                     "Tile refinement",
      "s3d.refine.enter":                     "✂️ Refine & crop",
      "s3d.refine.back":                      "← 3D scene",
      "s3d.refine.outline":                   "Outlines only",
      "s3d.refine.crop":                      "A4 crop",
      "s3d.refine.portrait":                  "▯ Portrait",
      "s3d.refine.landscape":                 "▭ Landscape",
      "s3d.refine.cropCenter":                "⊹ Center",
      "s3d.flow.toggle":                      "📐 Flow",
      "s3d.flow.draw":                        "✏️ Draw guide",
      "s3d.flow.select":                      "▭ Select row",
      "s3d.flow.across":                      "Across",
      "s3d.flow.apply":                       "↻ Apply",
      "s3d.flow.clear":                       "🧹 Clear",
      "s3d.flow.done":                        "✓ Done",
      "s3d.flow.help":                        "Draw guide: click = point, drag = move, double-click = remove · Select row: drag a box (Shift adds, Alt removes) · Apply = align tiles to the guide · right/middle = pan",
      "s3d.flow.needGuide":                   "Draw the guide line first (at least 2 points)",
      "s3d.flow.needSel":                     "Select a row of tiles first",
      "s3d.flow.applied":                     "↻ {n} tiles aligned to the flow",
      "s3d.refine.noSel":                     "No tile selected",
      "s3d.refine.shape":                     "Shape",
      "s3d.refine.sweep":                     "Slice",
      "s3d.refine.secStart":                  "Start angle",
      "s3d.refine.triAngles":                 "Angles alpha / beta",
      "s3d.refine.trapTop":                   "Top base (%)",
      "s3d.refine.width":                     "Width (mm)",
      "s3d.refine.height":                    "Height (mm)",
      "s3d.refine.rot":                       "Rotation (°)",
      "s3d.refine.delete":                    "Delete tile",
      "s3d.refine.reFreeze":                  "Re-capturing the scene will replace the tiles and discard the refinements you made. Continue?",
      "s3d.refine.footerHelp":                "click = select tile · drag tile = move · yellow dot = rotate · drag empty / right-drag / Shift = pan view · wheel = zoom",      "s3d.refine.help":                      "Click a tile to select it. Drag the body to move it, the yellow dot on top to rotate it. Use the fields for exact size and shape. Tiles stay whole shapes: a curved flow comes from rotating them.",
      "s3d.shape.free":                       "Original",
      "s3d.shape.rect":                       "Square / Rectangle",
      "s3d.shape.triangle":                   "Triangle",
      "s3d.shape.trapezoid":                  "Trapezoid",
      "s3d.shape.sector":                     "Sector (circle/ellipse)",
      "s3d.sweep.360":                        "Full",
      "s3d.sweep.180":                        "Half",
      "s3d.sweep.90":                         "Quarter",
      "s3d.sweep.45":                         "Eighth",
      "s3d.lathe.custom":                     "✏️ Hand-drawn",
      "s3d.lathe.customInfo":                 "Drawn profile · height {h} · max dia. {d} mm",
      "s3d.lathe.editProfile":                "Edit profile",
      "s3d.lathe.drawProfile":                "Draw profile",
      "s3d.lathe.drawProfileTitle":           "Hand-draw the half-silhouette the lathe revolves",
      "s3d.profile.title":                    "Lathe profile",
      "s3d.profile.sideHelp":                 "Drag the dots to shape the half-silhouette. Click the line to add a point, double-click or Del to remove it. The dashed axis is the centre: the shape is mirrored and revolved around it. Press Confirm profile to apply it to the lathe.",
      "s3d.profile.cancel":                   "← Cancel profile",
      "s3d.profile.cancelTitle":              "Back to the scene without applying the profile",
      "s3d.profile.confirm":                  "✅ Confirm profile",
      "s3d.profile.confirmTitle":             "Apply the drawn profile to the lathe",
      "s3d.profile.selPoint":                 "Point: r {r} · y {y} mm",
      "s3d.profile.noPoint":                  "No point selected",
      "s3d.profile.count":                    "{n} points",
      "s3d.profile.size":                     "Height {h} · max diameter {d} mm",
      "s3d.profile.min2":                     "The profile needs at least 2 points",
      "s3d.profile.saved":                    "Custom profile applied to the lathe",
      "s3d.profile.help":                     "click the line = add point · drag a dot = move · double-click / Del = remove · Shift/right+drag = pan · wheel = zoom",
    }
  };

  // ───────────────────────────────────────────────────────────
  //  STATO
  // ───────────────────────────────────────────────────────────
  let currentLang = DEFAULT_LANG;
  const listeners = {};

  // ───────────────────────────────────────────────────────────
  //  EVENTI INTERNI (mini emitter)
  // ───────────────────────────────────────────────────────────
  function emit(event, payload) {
    const arr = listeners[event];
    if (!arr) return;
    arr.forEach((cb) => {
      try { cb(payload); } catch (_) {}
    });
  }

  function on(event, cb) {
    if (typeof cb !== "function") return () => {};
    listeners[event] = listeners[event] || [];
    listeners[event].push(cb);
    // Ritorna funzione di unsubscribe
    return () => {
      const i = listeners[event].indexOf(cb);
      if (i >= 0) listeners[event].splice(i, 1);
    };
  }

  // ───────────────────────────────────────────────────────────
  //  CORE: t() e applyTranslations()
  // ───────────────────────────────────────────────────────────

  // Sostituisce {placeholder} con params[placeholder]
  function interpolate(str, params) {
    if (!params || typeof str !== "string") return str;
    return str.replace(/\{(\w+)\}/g, (m, k) =>
      Object.prototype.hasOwnProperty.call(params, k) ? String(params[k]) : m
    );
  }

  // Traduce una chiave nella lingua corrente con fallback IT
  function t(key, params) {
    if (typeof key !== "string") return "";
    const dict = DICTIONARIES[currentLang] || DICTIONARIES[DEFAULT_LANG];
    let str = dict[key];
    if (str == null && currentLang !== DEFAULT_LANG) {
      str = DICTIONARIES[DEFAULT_LANG][key];
    }
    if (str == null) {
      // Chiave mancante: ritorna la chiave stessa per debug
      return key;
    }
    return interpolate(str, params);
  }

  // Scansiona il DOM e riscrive testi/attributi marcati con data-i18n*
  function applyTranslations(root) {
    root = root || document;

    // textContent → [data-i18n="key"]
    root.querySelectorAll("[data-i18n]").forEach((el) => {
      const key = el.getAttribute("data-i18n");
      if (!key) return;
      el.textContent = t(key);
    });

    // innerHTML → [data-i18n-html="key"]
    root.querySelectorAll("[data-i18n-html]").forEach((el) => {
      const key = el.getAttribute("data-i18n-html");
      if (!key) return;
      el.innerHTML = t(key);
    });

    // title attribute → [data-i18n-title="key"]
    root.querySelectorAll("[data-i18n-title]").forEach((el) => {
      const key = el.getAttribute("data-i18n-title");
      if (!key) return;
      el.setAttribute("title", t(key));
    });

    // placeholder attribute → [data-i18n-placeholder="key"]
    root.querySelectorAll("[data-i18n-placeholder]").forEach((el) => {
      const key = el.getAttribute("data-i18n-placeholder");
      if (!key) return;
      el.setAttribute("placeholder", t(key));
    });

    // aria-label → [data-i18n-aria-label="key"]
    root.querySelectorAll("[data-i18n-aria-label]").forEach((el) => {
      const key = el.getAttribute("data-i18n-aria-label");
      if (!key) return;
      el.setAttribute("aria-label", t(key));
    });

    // data-tooltip → [data-i18n-tooltip="key"]
    // Usato dal radial menu: renderer.js legge btn.dataset.tooltip al
    // mousemove e mostra il proprio #radialTooltip (NON l'attributo
    // title nativo). Quindi qui dobbiamo riscrivere l'attributo
    // data-tooltip stesso: il renderer poi lo leggerà tradotto.
    root.querySelectorAll("[data-i18n-tooltip]").forEach((el) => {
      const key = el.getAttribute("data-i18n-tooltip");
      if (!key) return;
      el.setAttribute("data-tooltip", t(key));
    });
  }

  // ───────────────────────────────────────────────────────────
  //  API: cambio lingua
  // ───────────────────────────────────────────────────────────
  async function setLanguage(lang) {
    if (!AVAILABLE_LANGS.includes(lang)) {
      console.warn("[i18n] Lingua non supportata:", lang);
      return false;
    }
    if (lang === currentLang) return true;

    try {
      if (window.languageAPI?.setLanguage) {
        await window.languageAPI.setLanguage(lang);
      }
    } catch (e) {
      console.error("[i18n] setLanguage IPC error:", e);
      if (typeof window.flashToast === "function") {
        window.flashToast(t("toast.languageError"));
      }
      return false;
    }

    currentLang = lang;

    // Feedback all'utente e reload dell'app. Il reload è la via più
    // solida per re-tradurre tutto, dato che molti moduli (renderer,
    // wacomTablet, inputMapping, ecc.) generano UI dinamica a runtime.
    const meta = LANG_META[lang] || {};
    if (typeof window.flashToast === "function") {
      window.flashToast(t("toast.languageChanged", { name: meta.nativeName || lang }));
    }
    emit("language:changed", { lang });

    // Piccolo delay così l'utente vede il toast prima del reload
    setTimeout(() => {
      try { window.location.reload(); } catch (_) {}
    }, 700);

    return true;
  }

  function getLanguage() { return currentLang; }
  function getAvailableLanguages() { return AVAILABLE_LANGS.slice(); }
  function getLanguageMeta(lang) {
    return LANG_META[lang] || { name: lang, nativeName: lang, flag: "" };
  }

  // ───────────────────────────────────────────────────────────
  //  ESPOSIZIONE API
  // ───────────────────────────────────────────────────────────
  window.i18n = {
    t,
    applyTranslations,
    setLanguage,
    getLanguage,
    getAvailableLanguages,
    getLanguageMeta,
    on
  };

  // Shorthand globale comodo (es. window.tt("toast.x")).
  // Non obbligatorio, ma evita boilerplate nei moduli.
  window.tt = t;

  // ───────────────────────────────────────────────────────────
  //  BOOT (DOMContentLoaded)
  // ───────────────────────────────────────────────────────────
  async function boot() {
    // 1) Recupera la lingua effettiva dal main (file → CLI → locale → default).
    try {
      if (window.languageAPI?.getLanguage) {
        const lang = await window.languageAPI.getLanguage();
        if (lang && AVAILABLE_LANGS.includes(lang)) {
          currentLang = lang;
        }
      }
    } catch (e) {
      console.warn("[i18n] Impossibile leggere la lingua dal main, uso default:", e);
    }

    // 2) Imposta l'attributo lang sul tag <html> per CSS/accessibilità.
    try { document.documentElement.setAttribute("lang", currentLang); } catch (_) {}

    // 3) Applica le traduzioni al DOM statico già presente.
    try { applyTranslations(document); } catch (e) {
      console.warn("[i18n] applyTranslations error:", e);
    }

    // 4) Aggancia gli handler ai bottoni di selezione lingua nel menu File.
    bindLanguageMenu();

    // 5) Notifica eventuali moduli in ascolto.
    emit("language:ready", { lang: currentLang });

    console.log("[i18n] Pronto. Lingua corrente:", currentLang);
  }

  function bindLanguageMenu() {
    AVAILABLE_LANGS.forEach((lang) => {
      const btn = document.getElementById("languageBtn_" + lang);
      if (!btn) return;

      // Stato visivo: lingua attiva
      if (lang === currentLang) {
        btn.classList.add("language-active");
      } else {
        btn.classList.remove("language-active");
      }

      btn.addEventListener("click", (e) => {
        e.preventDefault();
        if (lang === currentLang) return;
        setLanguage(lang);
      });
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    // Caso raro: i18n caricato dopo DOMContentLoaded
    boot();
  }
})();