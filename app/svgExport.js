// ============================================================
//  svgExport.js — Mosaica Workspace Pro
// ------------------------------------------------------------
//  Esportazione SVG vettoriale delle FORME GEOMETRICHE presenti
//  sul canvas (escluso disegno a mano libera, acquerello,
//  texture carta, immagine di sfondo).
//
//  Due modalità:
//   • "filled"  → forme così come sono sul canvas (colore di
//                 riempimento o texture pattern + posizione).
//   • "outline" → solo contorno colorato. Se la forma ha un
//                 fill tinta unita, il contorno usa quel
//                 colore. Se la forma ha una texture (Pattern),
//                 il contorno è nero.
//
//  Lo sfondo del SVG è SEMPRE trasparente.
//  Le dimensioni SVG sono in mm REALI (px2mm) — la calibrazione
//  utente è preservata. Il viewBox resta in pixel canvas così le
//  posizioni delle forme corrispondono 1:1 a quelle viste a video.
//
//  Caricato come <script> in index.html (dopo renderer.js) come
//  gli altri moduli (TriangleModel, freehandDrawing, ecc.).
//  Espone window.exportShapesSVG(mode).
// ============================================================

(function () {
  "use strict";

  // ────────────────────────────────────────────────────────────
  //  Helper — riconosce un fill che è una fabric.Pattern (texture)
  // ────────────────────────────────────────────────────────────
  function isPatternFill(fill) {
    if (!fill) return false;
    if (typeof fill !== "object") return false;
    // fabric.Pattern ha sempre .source (HTMLImageElement / canvas)
    // oppure un type === "pattern" (a seconda della versione).
    if (typeof fabric !== "undefined" && fabric.Pattern && fill instanceof fabric.Pattern) return true;
    return !!fill.source || fill.type === "pattern";
  }

  // ────────────────────────────────────────────────────────────
  //  Filtro forme — riusa la stessa logica già esistente in
  //  renderer.js (isWatercolorOrFreehand + __isBackground)
  // ────────────────────────────────────────────────────────────
  function getShapesForExport(canvasRef) {
    return canvasRef.getObjects().filter((obj) => {
      if (!obj) return false;
      if (obj.__isBackground) return false;

      const isFreehandOrWatercolor =
        (obj.__isFreehand === true || obj.__isWatercolor === true) &&
        (obj.type === "path" || obj.type === "image" || obj.type === "group");

      if (isFreehandOrWatercolor) return false;
      return true;
    });
  }

  // ────────────────────────────────────────────────────────────
  //  Costruzione SVG
  // ────────────────────────────────────────────────────────────
  async function buildShapesSVG(mode) {
    if (typeof canvas === "undefined" || !canvas) {
      throw new Error("Canvas non disponibile");
    }

    const CW = canvas.getWidth();
    const CH = canvas.getHeight();

    // Dimensioni in mm "veri" derivati dalla calibrazione corrente.
    // Se la calibrazione non è disponibile (caso anomalo), fallback ai px.
    const widthMM = typeof px2mm === "function" ? px2mm(CW) : CW;
    const heightMM = typeof px2mm === "function" ? px2mm(CH) : CH;

    // Canvas temporaneo SENZA backgroundColor → SVG trasparente
    const tempEl = document.createElement("canvas");
    const tempFabric = new fabric.Canvas(tempEl, {
      width: CW,
      height: CH,
      backgroundColor: null, // sfondo trasparente garantito
      enableRetinaScaling: false,
      preserveObjectStacking: true
    });

    try {
      const shapes = getShapesForExport(canvas);

      if (shapes.length === 0) {
        throw new Error("Nessuna forma da esportare");
      }

      // Cloniamo le forme per non toccare gli oggetti reali del canvas utente.
      // Stesso pattern usato in exportFullCanvasPNG (renderer.js).
      // NB: clone() serializza via toObject() e il Pattern texture emette solo
      // un colore segnaposto -> il clone perde la texture. Per il modo "filled"
      // la rimettiamo con restoreTextureOnClone (esposto da renderer.js), che
      // riusa la sorgente viva dell'originale. Per "outline" il fill viene
      // comunque scartato, quindi non serve.
      const clones = await Promise.all(
        shapes.map(
          (s) =>
            new Promise((resolve) =>
              s.clone((cl) => {
                if (mode === "filled" && typeof window.restoreTextureOnClone === "function") {
                  window.restoreTextureOnClone(s, cl);
                }
                resolve(cl);
              })
            )
        )
      );

      clones.forEach((cl) => {
        if (mode === "outline") {
          // ── Determina il colore del contorno ─────────────────
          let strokeColor;
          if (typeof cl.fill === "string" && cl.fill && cl.fill !== "transparent") {
            // Tinta unita → contorno = colore del riempimento
            strokeColor = cl.fill;
          } else if (isPatternFill(cl.fill)) {
            // Texture caricata dall'utente → contorno NERO
            strokeColor = "#000000";
          } else if (typeof cl.stroke === "string" && cl.stroke) {
            // Forma senza fill ma con stroke esistente → mantieni
            strokeColor = cl.stroke;
          } else {
            strokeColor = "#000000";
          }

          // Larghezza stroke ragionevole in pixel canvas.
          // 1.5 px è ben visibile sia a video che in stampa vettoriale.
          cl.set({
            fill: null, // niente riempimento
            stroke: strokeColor,
            strokeWidth: 1.5,
            strokeUniform: true, // non si deforma con scale non uniformi
            paintFirst: "stroke"
          });
        }
        // mode === "filled" → nessuna modifica, manteniamo fill/stroke originali

        tempFabric.add(cl);
      });

      tempFabric.renderAll();

      // Genera l'SVG con viewBox = pixel reali del canvas
      let svgStr = tempFabric.toSVG({
        viewBox: { x: 0, y: 0, width: CW, height: CH },
        suppressPreamble: false
      });

      // Sostituisci width/height del root <svg> con valori in mm REALI,
      // mantenendo il viewBox in px. In questo modo aprendo il file in
      // Inkscape / Illustrator / browser le dimensioni fisiche sono
      // esatte (es. 210mm × 297mm per A4) ma le coordinate interne
      // restano le stesse del canvas Mosaica.
      svgStr = svgStr.replace(/<svg\b([^>]*)>/i, (m, attrs) => {
        let newAttrs = attrs.replace(/\s+width\s*=\s*"[^"]*"/i, "").replace(/\s+height\s*=\s*"[^"]*"/i, "");
        // assicura xmlns:xlink (necessario quando i pattern usano xlink:href)
        if (!/xmlns:xlink\s*=/.test(newAttrs)) {
          newAttrs += ' xmlns:xlink="http://www.w3.org/1999/xlink"';
        }
        return `<svg${newAttrs} width="${widthMM.toFixed(3)}mm" height="${heightMM.toFixed(3)}mm">`;
      });

      return svgStr;
    } finally {
      try {
        tempFabric.dispose();
      } catch (e) {}
    }
  }

  // ────────────────────────────────────────────────────────────
  //  API PUBBLICA
  // ────────────────────────────────────────────────────────────
  /**
   * Esporta le forme del canvas come SVG e salva tramite Electron dialog.
   * @param {"filled"|"outline"} mode  Tipo di esportazione.
   * @returns {Promise<string|null>}   Path del file salvato, o null se annullato/errore.
   */
  async function exportShapesSVG(mode) {
    if (mode !== "filled" && mode !== "outline") mode = "filled";

    if (typeof flashToast === "function") {
      flashToast("⏳ Generazione SVG forme...");
    }

    try {
      const svgStr = await buildShapesSVG(mode);

      if (!window.desktopAPI || typeof window.desktopAPI.exportShapesSVG !== "function") {
        throw new Error("API exportShapesSVG non disponibile (preload.js da aggiornare)");
      }

      const result = await window.desktopAPI.exportShapesSVG(svgStr);

      // result è null se l'utente ha annullato la dialog di salvataggio
      if (result && typeof flashToast === "function") {
        const lbl = mode === "outline" ? "solo contorni" : "riempite";
        flashToast(`✅ SVG forme esportato (${lbl})`);
      }
      return result;
    } catch (err) {
      console.error("[svgExport] Errore:", err);
      if (typeof flashToast === "function") {
        flashToast("❌ Errore SVG: " + (err.message || "sconosciuto"));
      }
      return null;
    }
  }

  // Espone l'API in scope globale, consumata dal modale in renderer.js
  window.exportShapesSVG = exportShapesSVG;

  console.log("[svgExport] Modulo SVG forme pronto");
})();