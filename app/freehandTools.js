// freehandTools.js — Mosaica Workspace Pro
// =====================================================================
//  Due aiuti visivi per il DISEGNO A MANO LIBERA (penna / gomma /
//  acquerello), tenuti in un solo modulo perche' condividono lo stesso
//  overlay (canvas.contextTop):
//
//   1) CERCHIO DIMENSIONE TRATTO sotto il puntatore — come il
//      pennello-lazo. Mostra in tempo reale quanto e' largo il tratto
//      che si sta per disegnare. In hover mostra la larghezza piena;
//      durante un tratto a PENNA con Wacom si stringe/allarga con la
//      pressione usando lo stesso fattore del tratto reale
//      (window.wacomGetWidthFactor). L'anello sta un filo FUORI dal
//      bordo del tratto (STROKE_PREVIEW_RING_GAP_PX) cosi' si vede dove
//      arrivera' il perimetro del tratto prima che il colore lo copra.
//
//   2) PERIMETRO DI CONTENIMENTO — un poligono dentro cui penna e
//      acquerello possono colorare; fuori no (utile per colorare le
//      fughe restando dentro l'area del mosaico). Come il bordo del
//      canvas taglia i tratti che escono, ma l'ANTEPRIMA del tratto la
//      si vede uscire lo stesso. Realizzato con il clipPath di Fabric
//      (absolutePositioned) applicato a ogni tratto freehand.
//      Strumento unico:
//        • TAP      = aggiunge un vertice (per cliccare gli spigoli
//                     esterni delle tessere di bordo)
//        • TRASCINA = traccia a mano libera (stile pennello-lazo)
//        • TAP vicino al 1° vertice / INVIO / DOPPIO-CLICK = chiude
//        • ESC       = annulla la sessione in corso (NON cancella un
//                      perimetro gia' committato)
//        • BACKSPACE = rimuove l'ultimo punto della sessione
//      Cancellare un perimetro committato: click DESTRO sul pulsante
//      dello strumento (coerente col pennello-lazo).
//
//  PERSISTENZA: il poligono (coord. canvas LOGICHE) vive su
//  window.freehandClipPolygon. La SCRITTURA nel file la fanno
//  renderer.js (salvataggio manuale) e autoSave.js leggendo
//  window.getFreehandClipPolygon(); la RILETTURA la fa renderer.js in
//  applyProjectData + applySnapshot chiamando setFreehandClipPolygon()
//  e applyFreehandClipToAll().
//
//  Compatibile Fabric 5.1.0 → 5.3.0: usa solo Canvas2D, fabric.Polygon
//  e clipPath absolutePositioned (nessuna API cambiata nel mezzo).
//  <script> classico (no ES module): riusa le globali di renderer.js
//  (canvas/window.canvas, view, mm2px, pushState, flashToast,
//  isWatercolorOrFreehand), di freehandDrawing.js (currentLineWidth,
//  currentWatercolorWidth, isFreehandMode, isEraserMode,
//  isWatercolorMode) e le API Wacom (window.wacom*).

(function () {
  "use strict";

  // ============================================================
  //  COSTANTI REGOLABILI
  // ============================================================
  // --- Cerchio dimensione tratto ---
  let SHOW_STROKE_SIZE_CIRCLE = true;          // Mirko: sempre attivo
  const STROKE_PREVIEW_RING_GAP_PX = 1.5;      // (px schermo) anello appena FUORI dal bordo del tratto
  const STROKE_CIRCLE_DASH = [5, 4];           // (px schermo) tratteggio anello
  const STROKE_CIRCLE_MIN_DIAMETER_PX = 1;     // (px logici) diametro minimo disegnabile
  const STROKE_CIRCLE_LINE_W = 1.2;            // (px schermo) spessore linea anello
  const STROKE_CIRCLE_COLOR = "rgba(255,255,255,0.92)";
  const ERASER_CIRCLE_COLOR = "rgba(255,120,120,0.92)";
  // (acquerello) quanto includere dell'alone di sbavatura (shadowBlur) nel
  // diametro dell'anello: margine = 2 * currentBleed * questo K. 1.55 = bordo
  // esterno dello shadowBlur reale del timbro. Alza se l'anello e' ancora piu'
  // stretto della macchia, abbassa se la supera.
  const WATERCOLOR_RING_BLEED_K = 1.55;

  // --- Perimetro di contenimento ---
  const CLIP_VERTEX_DRAG_THRESHOLD_PX = 6;     // (px schermo) oltre = trascino (mano libera); sotto = tap (vertice)
  const CLIP_FREEHAND_MIN_POINT_DISTANCE = 4;  // (px logici) densita' punti durante il trascinamento
  const CLIP_CLOSE_SNAP_PX = 14;               // (px schermo) vicinanza al 1° vertice per chiudere
  const CLIP_GUIDE_COLOR = "rgba(255,140,0,0.95)";   // contorno perimetro committato / in-corso
  const CLIP_GUIDE_FILL = "rgba(255,160,40,0.08)";   // velo interno tenue
  const CLIP_GUIDE_DASH = [8, 5];              // (px schermo)
  const CLIP_GUIDE_LINE_W = 2.8;               // (px schermo) — piu' spesso/visibile
  const CLIP_VERTEX_RADIUS_PX = 3.4;           // (px schermo) pallino vertice in editing
  const CLIP_FIRST_VERTEX_RADIUS_PX = 5.5;     // (px schermo) pallino 1° vertice (per chiudere)

  // ============================================================
  //  STATO
  // ============================================================
  // Perimetro committato: array di {x,y} in coord canvas LOGICHE, oppure null.
  let clipPolygon =
    window.freehandClipPolygon && Array.isArray(window.freehandClipPolygon)
      ? window.freehandClipPolygon.slice()
      : null;

  let hoverPoint = null;        // ultimo punto (coord logiche) sotto il cursore

  // Editing del perimetro
  let isEditing = false;        // true mentre si disegna un nuovo perimetro
  let editPoints = [];          // punti della sessione in corso (coord logiche)
  let pointerDown = false;      // pulsante premuto durante la sessione
  let dragStarted = false;      // il pointer ha superato la soglia → mano libera
  let downLogical = null;       // punto logico al mousedown
  let downScreen = null;        // {x,y} client al mousedown (per soglia in px schermo)
  let savedDrawingMode = null;  // isDrawingMode salvato prima dell'editing
  let savedSelection = null;    // selection salvato prima dell'editing
  let savedSkipTargetFind = null; // skipTargetFind salvato prima dell'editing
  let savedHoverCursor = null;    // hoverCursor salvato prima dell'editing

  let _bound = false;           // listener canvas gia' agganciati?

  // ============================================================
  //  HELPER BASE
  // ============================================================
  function _canvas() {
    return window.canvas || (typeof canvas !== "undefined" ? canvas : null);
  }
  function _t(key, fallback) {
    try {
      if (window.i18n && typeof window.i18n.t === "function") {
        const v = window.i18n.t(key);
        if (v && v !== key) return v;
      }
    } catch (e) {}
    return fallback;
  }
  function _toast(msg) {
    if (typeof window.flashToast === "function") return window.flashToast(msg);
    if (typeof flashToast === "function") return flashToast(msg);
  }
  // 1/scale: per disegnare spessori/raggi a dimensione-SCHERMO costante,
  // dato che l'overlay e' tracciato in coordinate LOGICHE (viewportTransform
  // applicata sotto). Identico al pennello-lazo.
  function _screenK() {
    const s =
      (window.view && typeof window.view.scale === "number" && window.view.scale) ||
      (typeof view !== "undefined" && view && view.scale) ||
      1;
    return 1 / Math.max(0.1, s);
  }
  // Applica viewportTransform × retina al contesto, cosi' i punti di
  // canvas.getPointer (coord logiche) cadono sotto il cursore. Come il lazo.
  function _applyWorldTransform(ctx, c) {
    const retina = typeof c.getRetinaScaling === "function" ? c.getRetinaScaling() : 1;
    const vpt = c.viewportTransform || [1, 0, 0, 1, 0, 0];
    ctx.setTransform(
      vpt[0] * retina, vpt[1] * retina, vpt[2] * retina,
      vpt[3] * retina, vpt[4] * retina, vpt[5] * retina
    );
  }
  function _pointer(e) {
    const c = _canvas();
    return c ? c.getPointer(e) : { x: 0, y: 0 };
  }
  function _dist2(ax, ay, bx, by) {
    const dx = ax - bx, dy = ay - by;
    return dx * dx + dy * dy;
  }

  // ============================================================
  //  STATO STRUMENTO FREEHAND
  // ============================================================
  // 'pen' | 'eraser' | 'watercolor' | null — quale tool di disegno e' attivo.
  function _activeFreehandTool() {
    const c = _canvas();
    if (!c || !c.isDrawingMode) return null;
    // Le flag vivono in freehandDrawing.js (let top-level → global scope).
    const eraser = typeof isEraserMode !== "undefined" ? isEraserMode : false;
    const water = typeof isWatercolorMode !== "undefined" ? isWatercolorMode : false;
    if (eraser) return "eraser";
    if (water) return "watercolor";
    return "pen";
  }
  // Sto attivamente tracciando un tratto col brush di Fabric?
  function _isDrawingNow() {
    const c = _canvas();
    return !!(c && c._isCurrentlyDrawing);
  }
  // Il brush corrente fa il FULL render dell'anteprima (clear + _render ad
  // ogni move)? Solo in tal caso posso disegnare il cerchio SOPRA il tratto
  // senza lasciare scie: e' il caso della penna (PressurePencilBrush).
  function _brushIsFullRender() {
    const c = _canvas();
    const b = c && c.freeDrawingBrush;
    if (!b) return false;
    if (b.name === "pressure-pencil") return true;
    if (typeof b.needsFullRender === "function") {
      try { return !!b.needsFullRender(); } catch (e) {}
    }
    return false;
  }

  // Diametro LOGICO del tratto da rappresentare col cerchio.
  function _strokeDiameterPx(isStroking) {
    const tool = _activeFreehandTool();
    const lineW = typeof currentLineWidth !== "undefined" ? currentLineWidth : 4;
    const waterW = typeof currentWatercolorWidth !== "undefined" ? currentWatercolorWidth : 24;

    let base;
    if (tool === "eraser") base = Math.max(12, lineW * 1.8);   // come applyBrushSettings
    else if (tool === "watercolor") base = waterW;
    else base = lineW;

    // ── Modulazione pressione Wacom — PENNA vs ACQUERELLO ─────────────────────
    // Entrambi gli strumenti, DURANTE un tratto, ingrossano il segno con la
    // pressione (penna: PressurePath usa la pressione del punto; acquerello:
    // ogni timbro usa baseWidth = currentWatercolorWidth * w.width). Ma il
    // CLICK SINGOLO si comporta diverso fra i due:
    //   • penna      → il dot usa la pressione del tap (puo' arrivare a maxFactor)
    //   • acquerello → il dab usa SEMPRE la larghezza base (nessuna pressione)
    // Quindi:
    //   • DURANTE il tratto (isStroking): fattore LIVE per entrambi → l'anello
    //     segue lo spessore reale che si sta disegnando.
    //   • In HOVER: la PENNA mostra il MASSIMO (un tap deciso arriva li'), cosi'
    //     l'anello non e' mai piu' piccolo del dot; l'ACQUERELLO resta alla base
    //     (il dab e' sempre base) per non disegnare un anello piu' largo della
    //     macchia.
    // I getter ritornano 1.0 quando la modulazione e' spenta (mouse / Wacom off).
    // NB: niente piu' gate su window.wacomIsConnected — in hover quel flag puo'
    // essere false (penna sollevata) e l'anello restava alla base mentre un tap
    // deciso disegnava gia' a piena pressione (il tratto usciva: erano i ~4 mm).
    if (isStroking && (tool === "pen" || tool === "watercolor") &&
        typeof window.wacomGetWidthFactor === "function") {
      let f = 1;
      try { f = window.wacomGetWidthFactor(); } catch (e) { f = 1; }
      if (Number.isFinite(f) && f > 0) base = base * f;
    } else if (!isStroking && tool === "pen" &&
               typeof window.wacomGetMaxWidthFactor === "function") {
      let mf = 1;
      try { mf = window.wacomGetMaxWidthFactor(); } catch (e) { mf = 1; }
      if (Number.isFinite(mf) && mf > 0) base = base * mf;
    }

    // ── Acquerello: alone della sbavatura attorno al timbro ───────────────────
    // Il timbro acquerello e' circondato da un alone morbido (shadowBlur =
    // currentBleed * 1.55) che si estende oltre il nucleo su tutti i lati: senza
    // questo margine l'anello resta dentro la macchia. Tarabile con
    // WATERCOLOR_RING_BLEED_K.
    if (tool === "watercolor") {
      const bleed = typeof currentBleed !== "undefined" ? currentBleed : 0;
      if (bleed > 0) base += 2 * bleed * WATERCOLOR_RING_BLEED_K;
    }

    return Math.max(STROKE_CIRCLE_MIN_DIAMETER_PX, base);
  }

  // ============================================================
  //  DISEGNO OVERLAY (contextTop)
  // ============================================================
  // Disegna SOLO il cerchio dimensione tratto attorno a hoverPoint.
  function _paintSizeCircle(ctx, k) {
    if (!SHOW_STROKE_SIZE_CIRCLE) return;
    if (!hoverPoint) return;
    const tool = _activeFreehandTool();
    if (!tool) return;

    const isStroking = _isDrawingNow();
    const diam = _strokeDiameterPx(isStroking);
    const r = diam / 2 + STROKE_PREVIEW_RING_GAP_PX * k; // anello appena FUORI dal bordo

    ctx.beginPath();
    ctx.arc(hoverPoint.x, hoverPoint.y, Math.max(0.5, r), 0, Math.PI * 2);
    ctx.lineWidth = STROKE_CIRCLE_LINE_W * k;
    ctx.strokeStyle = tool === "eraser" ? ERASER_CIRCLE_COLOR : STROKE_CIRCLE_COLOR;
    ctx.setLineDash([STROKE_CIRCLE_DASH[0] * k, STROKE_CIRCLE_DASH[1] * k]);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // Disegna la guida del perimetro: poligono committato (tratteggio + velo)
  // e/o la sessione di editing in corso (segmenti + vertici).
  function _paintPerimeterGuide(ctx, k) {
    const committed = clipPolygon && clipPolygon.length >= 3 ? clipPolygon : null;

    // 1) Perimetro committato (sempre visibile mentre si lavora a mano libera).
    if (committed && !isEditing) {
      ctx.beginPath();
      ctx.moveTo(committed[0].x, committed[0].y);
      for (let i = 1; i < committed.length; i++) ctx.lineTo(committed[i].x, committed[i].y);
      ctx.closePath();
      ctx.fillStyle = CLIP_GUIDE_FILL;
      ctx.fill();
      ctx.lineWidth = CLIP_GUIDE_LINE_W * k;
      ctx.strokeStyle = CLIP_GUIDE_COLOR;
      ctx.setLineDash([CLIP_GUIDE_DASH[0] * k, CLIP_GUIDE_DASH[1] * k]);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // 2) Sessione di editing in corso.
    if (isEditing) {
      const pts = editPoints;
      if (pts.length >= 1) {
        // linea spezzata corrente
        ctx.beginPath();
        ctx.moveTo(pts[0].x, pts[0].y);
        for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
        // segmento "elastico" fino al cursore (se non sto trascinando)
        if (!dragStarted && hoverPoint) ctx.lineTo(hoverPoint.x, hoverPoint.y);
        ctx.lineWidth = CLIP_GUIDE_LINE_W * k;
        ctx.strokeStyle = CLIP_GUIDE_COLOR;
        ctx.setLineDash([CLIP_GUIDE_DASH[0] * k, CLIP_GUIDE_DASH[1] * k]);
        ctx.stroke();
        ctx.setLineDash([]);

        // velo interno se la sessione e' gia' un poligono plausibile
        if (pts.length >= 3) {
          ctx.beginPath();
          ctx.moveTo(pts[0].x, pts[0].y);
          for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
          ctx.closePath();
          ctx.fillStyle = CLIP_GUIDE_FILL;
          ctx.fill();
        }
      }

      // vertici
      for (let i = 0; i < pts.length; i++) {
        const first = i === 0;
        ctx.beginPath();
        ctx.arc(
          pts[i].x, pts[i].y,
          (first ? CLIP_FIRST_VERTEX_RADIUS_PX : CLIP_VERTEX_RADIUS_PX) * k,
          0, Math.PI * 2
        );
        ctx.fillStyle = first ? "rgba(255,255,255,0.95)" : CLIP_GUIDE_COLOR;
        ctx.fill();
        ctx.lineWidth = 1 * k;
        ctx.strokeStyle = CLIP_GUIDE_COLOR;
        ctx.stroke();
      }
    }
  }

  // Ridisegna l'overlay. clearFirst=false serve durante un tratto a piena
  // resa (penna): il brush ha appena pulito+ridisegnato contextTop, noi ci
  // sovrapponiamo soltanto cerchio+guida senza cancellare il tratto.
  function _redraw(clearFirst) {
    const c = _canvas();
    if (!c) return;
    const ctx = c.contextTop;
    if (!ctx) return;

    const tool = _activeFreehandTool();
    // Disegniamo solo se siamo "in scena": uno strumento freehand attivo
    // oppure stiamo editando il perimetro. Altrimenti lasciamo l'overlay
    // agli altri strumenti (lazo, pennello-lazo, ecc.).
    if (!tool && !isEditing) {
      if (clearFirst) c.clearContext(ctx);
      return;
    }

    if (clearFirst) c.clearContext(ctx);

    const k = _screenK();
    ctx.save();
    _applyWorldTransform(ctx, c);
    _paintPerimeterGuide(ctx, k);
    if (!isEditing) _paintSizeCircle(ctx, k);
    ctx.restore();
  }

  // ============================================================
  //  CLIP — applicazione del perimetro ai tratti freehand
  // ============================================================
  function isFreehandObj(o) {
    if (!o) return false;
    if (o.__isBackground === true) return false;
    if (o.__isFreehand === true || o.__isWatercolor === true) return true;
    if (typeof isWatercolorOrFreehand === "function") {
      try { if (isWatercolorOrFreehand(o)) return true; } catch (e) {}
    }
    if (typeof window.isWatercolorOrFreehand === "function") {
      try { if (window.isWatercolorOrFreehand(o)) return true; } catch (e) {}
    }
    return false;
  }

  function _validPoly(p) {
    return Array.isArray(p) && p.length >= 3 &&
      p.every((q) => q && Number.isFinite(q.x) && Number.isFinite(q.y));
  }

  // Poligono di clip EFFETTIVO per un oggetto:
  //  • se l'oggetto ha un taglio PERMANENTE (__clipPoly) → usa quello. E' il
  //    taglio "cotto" sui tratti disegnati mentre il perimetro era attivo:
  //    sopravvive alla rimozione del perimetro e a salva/riapri.
  //  • altrimenti, se c'e' un perimetro ATTIVO (clipPolygon globale) → maschera
  //    TEMPORANEA (es. il disegno di sfondo preesistente): sparisce appena il
  //    perimetro viene tolto.
  //  • altrimenti nessun clip.
  function _clipPolyFor(o) {
    if (o && _validPoly(o.__clipPoly)) return o.__clipPoly;
    if (_validPoly(clipPolygon)) return clipPolygon;
    return null;
  }

  function _buildClip(poly) {
    const src = _validPoly(poly) ? poly : clipPolygon;
    if (!_validPoly(src)) return null;
    if (typeof fabric === "undefined" || !fabric.Polygon) return null;
    return new fabric.Polygon(
      src.map((p) => ({ x: p.x, y: p.y })),
      {
        // absolutePositioned: il clip e' in coordinate canvas (non relative
        // all'oggetto) → maschera fissa identica per tutti i tratti.
        absolutePositioned: true,
        // excludeFromExport: il POLIGONO clipPath NON viene serializzato (snapshot
        // e salvataggi restano puliti). Il taglio permanente viaggia invece nella
        // proprieta' leggera __clipPoly sull'oggetto (serializzata) e il clipPath
        // viene ricostruito al caricamento da applyFreehandClipToAll().
        excludeFromExport: true,
        objectCaching: false,
        selectable: false,
        evented: false,
        fill: "#000",
        stroke: null
      }
    );
  }

  // Applica/aggiorna il clipPath su TUTTI i tratti freehand presenti, rispettando
  // il taglio permanente per-oggetto (__clipPoly) e la maschera temporanea globale.
  function applyFreehandClipToAll() {
    const c = _canvas();
    if (!c || !c.getObjects) return;
    c.getObjects().forEach((o) => {
      if (!isFreehandObj(o)) return;
      const poly = _clipPolyFor(o);
      o.clipPath = poly ? _buildClip(poly) : null;
      o.dirty = true;
    });
    c.requestRenderAll();
  }

  // Applica il clip a UN solo oggetto (usato da path:created / object:added alla
  // nascita di un nuovo tratto). Se il perimetro e' ATTIVO al momento del disegno,
  // il taglio viene "cotto" in modo PERMANENTE sull'oggetto (__clipPoly): restera'
  // tagliato anche togliendo il perimetro e dopo salva/riapri. Il disegno
  // preesistente NON viene cotto qui (lo maschera solo temporaneamente
  // applyFreehandClipToAll), proprio perche' deve tornare quando si toglie il
  // perimetro.
  function applyFreehandClipToObject(o) {
    if (!o || !isFreehandObj(o)) return;
    if (!_validPoly(o.__clipPoly) && _validPoly(clipPolygon)) {
      o.__clipPoly = clipPolygon.map((p) => ({ x: p.x, y: p.y }));
    }
    const poly = _clipPolyFor(o);
    if (poly) {
      o.clipPath = _buildClip(poly);
      o.dirty = true;
    }
  }

  // ============================================================
  //  PERSISTENZA (lettori usati da renderer.js / autoSave.js)
  // ============================================================
  function getFreehandClipPolygon() {
    return clipPolygon && clipPolygon.length >= 3 ? clipPolygon.map((p) => ({ x: p.x, y: p.y })) : null;
  }
  // Imposta il poligono (es. al caricamento progetto). Non applica il clip:
  // chi chiama deve poi invocare applyFreehandClipToAll() quando gli oggetti
  // sono sul canvas. opts.silent = non mostrare toast.
  function setFreehandClipPolygon(poly, opts) {
    if (Array.isArray(poly) && poly.length >= 3) {
      clipPolygon = poly.map((p) => ({ x: +p.x, y: +p.y })).filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
      if (clipPolygon.length < 3) clipPolygon = null;
    } else {
      clipPolygon = null;
    }
    window.freehandClipPolygon = clipPolygon;
    if (!(opts && opts.silent)) _redraw(true);
  }
  // Marca "sporco" per l'autosave (riusa il debounce undo o pushState).
  function _markDirty() {
    if (typeof window.pushState === "function") window.pushState();
    else if (typeof pushState === "function") pushState();
  }

  // ============================================================
  //  EDITING DEL PERIMETRO
  // ============================================================
  function startEdit() {
    const c = _canvas();
    if (!c) return;
    if (isEditing) { endEdit(false); return; } // toggle: ri-cliccando si annulla

    isEditing = true;
    editPoints = [];
    pointerDown = false;
    dragStarted = false;

    // Sospendi temporaneamente la modalita' disegno (i click devono piazzare
    // vertici, non tracciare tratti).
    savedDrawingMode = c.isDrawingMode;
    savedSelection = c.selection;
    c.isDrawingMode = false;
    c.selection = false;
    c.discardActiveObject && c.discardActiveObject();
    c.defaultCursor = "crosshair";
    c.setCursor && c.setCursor("crosshair");

    // ── P4: il cursore NON deve cambiare passando sopra le tessere, altrimenti
    //    Fabric muove l'hover-cursor e l'utente perde il riferimento esatto del
    //    punto di aggancio. Disattivando skipTargetFind, Fabric non cerca piu'
    //    target sotto il puntatore (niente hover-cursor, niente hit-test): il
    //    crosshair resta fisso e il punto al click e' quello reale del pointer.
    savedSkipTargetFind = c.skipTargetFind;
    savedHoverCursor = c.hoverCursor;
    c.skipTargetFind = true;
    c.hoverCursor = "crosshair";

    const btn = document.getElementById("freehandClipBtn");
    if (btn) btn.classList.add("active");

    _toast(_t("freehandClip.toast.start",
      "⬡ Perimetro: tap = vertice, trascina = mano libera, Invio/doppio-click = chiudi, ESC = annulla"));
    _redraw(true);
  }

  function endEdit(commit) {
    const c = _canvas();
    if (!isEditing) return;

    let committedOk = false;
    if (commit && editPoints.length >= 3) {
      clipPolygon = editPoints.map((p) => ({ x: p.x, y: p.y }));
      window.freehandClipPolygon = clipPolygon;
      applyFreehandClipToAll();
      _markDirty();
      committedOk = true;
    }

    isEditing = false;
    editPoints = [];
    pointerDown = false;
    dragStarted = false;

    // Ripristina lo stato precedente.
    if (c) {
      if (savedDrawingMode != null) c.isDrawingMode = savedDrawingMode;
      if (savedSelection != null) c.selection = savedSelection;
      // IMPORTANTE: skipTargetFind va SEMPRE ripristinato (fallback false),
      // altrimenti dopo l'editing le tessere non sarebbero piu' selezionabili.
      c.skipTargetFind = (savedSkipTargetFind == null) ? false : savedSkipTargetFind;
      c.hoverCursor = (savedHoverCursor == null) ? "move" : savedHoverCursor;
      c.defaultCursor = "default";
    }
    savedDrawingMode = null;
    savedSelection = null;
    savedSkipTargetFind = null;
    savedHoverCursor = null;

    const btn = document.getElementById("freehandClipBtn");
    if (btn) btn.classList.remove("active");

    if (committedOk) {
      _toast(_t("freehandClip.toast.set", "⬡ Perimetro di contenimento impostato"));
    } else if (commit) {
      _toast(_t("freehandClip.toast.needMore", "⬡ Servono almeno 3 punti per chiudere il perimetro"));
    } else {
      _toast(_t("freehandClip.toast.cancelled", "⬡ Perimetro annullato"));
    }
    _redraw(true);
  }

  // Cancella un perimetro committato (click destro sul pulsante).
  function clearPerimeter(opts) {
    const had = !!(clipPolygon && clipPolygon.length >= 3);
    clipPolygon = null;
    window.freehandClipPolygon = null;
    applyFreehandClipToAll();
    if (had) _markDirty();
    if (!(opts && opts.silent)) {
      _toast(had
        ? _t("freehandClip.toast.removed", "⬡ Perimetro di contenimento rimosso")
        : _t("freehandClip.toast.none", "⬡ Nessun perimetro da rimuovere"));
    }
    _redraw(true);
  }

  // ============================================================
  //  EVENTI MOUSE (canvas)
  // ============================================================
  function onMouseDown(opt) {
    if (!isEditing) return;          // fuori editing: non tocchiamo nulla
    const e = opt && opt.e;
    if (e && typeof e.button === "number" && e.button !== 0) return; // solo sinistro

    const p = _pointer(e);
    pointerDown = true;
    dragStarted = false;
    downLogical = { x: p.x, y: p.y };
    downScreen = e ? { x: e.clientX, y: e.clientY } : { x: p.x, y: p.y };
    hoverPoint = { x: p.x, y: p.y };
    _redraw(true);
  }

  function onMouseMove(opt) {
    const e = opt && opt.e;
    const tool = _activeFreehandTool();

    // --- EDITING PERIMETRO ---
    if (isEditing) {
      const p = _pointer(e);
      hoverPoint = { x: p.x, y: p.y };

      if (pointerDown) {
        if (!dragStarted && downScreen && e) {
          const ddx = e.clientX - downScreen.x;
          const ddy = e.clientY - downScreen.y;
          if (ddx * ddx + ddy * ddy > CLIP_VERTEX_DRAG_THRESHOLD_PX * CLIP_VERTEX_DRAG_THRESHOLD_PX) {
            dragStarted = true;
            // il primo punto della mano-libera e' il punto del down
            if (downLogical) editPoints.push({ x: downLogical.x, y: downLogical.y });
          }
        }
        if (dragStarted) {
          const last = editPoints[editPoints.length - 1];
          if (!last || _dist2(last.x, last.y, p.x, p.y) >= CLIP_FREEHAND_MIN_POINT_DISTANCE * CLIP_FREEHAND_MIN_POINT_DISTANCE) {
            editPoints.push({ x: p.x, y: p.y });
          }
        }
      }
      _redraw(true);
      return;
    }

    // --- CERCHIO DIMENSIONE TRATTO ---
    if (!tool) return;
    const p = _pointer(e);
    hoverPoint = { x: p.x, y: p.y };

    if (_isDrawingNow()) {
      // Durante un tratto: aggiorna la pressione Wacom dall'evento, poi
      // sovrapponi il cerchio SOLO se il brush ridisegna tutto ad ogni move
      // (penna). Per gomma/acquerello (resa incrementale) non ridisegniamo
      // qui per non lasciare scie di cerchi.
      if (e && typeof window.wacomReadFromEvent === "function") {
        try { window.wacomReadFromEvent(e); } catch (err) {}
      }
      if (_brushIsFullRender()) _redraw(false);
    } else {
      _redraw(true); // hover: clear + cerchio
    }
  }

  function onMouseUp(opt) {
    if (!isEditing) return;
    const e = opt && opt.e;
    const p = _pointer(e);

    if (!pointerDown) { dragStarted = false; return; }
    pointerDown = false;

    if (dragStarted) {
      // mano libera completata: i punti sono gia' stati accumulati.
      dragStarted = false;
      _redraw(true);
      return;
    }

    // TAP: chiusura se vicino al 1° vertice (con >=3 punti), altrimenti vertice.
    const k = _screenK();
    if (editPoints.length >= 3) {
      const first = editPoints[0];
      const snapLogical = CLIP_CLOSE_SNAP_PX * k;
      if (_dist2(first.x, first.y, p.x, p.y) <= snapLogical * snapLogical) {
        endEdit(true);
        return;
      }
    }
    editPoints.push({ x: p.x, y: p.y });
    _redraw(true);
  }

  function onDblClick() {
    if (!isEditing) return;
    endEdit(true);
  }

  function onAfterRender() {
    // Safety net: dopo un render del canvas (zoom, pan, undo, path:created…)
    // ridisegna l'overlay se siamo "in scena" e NON in pieno tratto attivo
    // (li' ci pensa onMouseMove a sovrapporre senza scie).
    if (isEditing) { _redraw(true); return; }
    if (_activeFreehandTool() && !_isDrawingNow()) _redraw(true);
  }

  // ============================================================
  //  TASTIERA (in fase CAPTURE, come il pennello-lazo, per precedere
  //  l'handler globale che su ESC esce dal fullscreen)
  // ============================================================
  function onKeyDown(e) {
    if (!isEditing) return;

    // Non rubare tasti mentre si scrive in un campo.
    const ae = document.activeElement;
    const tag = ae && ae.tagName ? ae.tagName.toUpperCase() : "";
    const typing = tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || (ae && ae.isContentEditable);

    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      if (typeof e.stopImmediatePropagation === "function") e.stopImmediatePropagation();
      endEdit(false);
      return;
    }
    if (e.key === "Enter" && !typing) {
      e.preventDefault();
      e.stopPropagation();
      if (typeof e.stopImmediatePropagation === "function") e.stopImmediatePropagation();
      endEdit(true);
      return;
    }
    if (e.key === "Backspace" && !typing) {
      e.preventDefault();
      e.stopPropagation();
      if (typeof e.stopImmediatePropagation === "function") e.stopImmediatePropagation();
      if (editPoints.length) editPoints.pop();
      _redraw(true);
      return;
    }
  }

  // ============================================================
  //  INIT
  // ============================================================
  function initFreehandTools() {
    const c = _canvas();
    if (!c) {
      console.warn("[freehandTools] canvas non pronto");
      return false;
    }

    if (!_bound) {
      c.on("mouse:down", onMouseDown);
      c.on("mouse:move", onMouseMove);
      c.on("mouse:up", onMouseUp);
      c.on("mouse:dblclick", onDblClick);
      c.on("after:render", onAfterRender);
      // L'acquerello aggiunge il suo oggetto SENZA passare da path:created
      // (path:created salta isWatercolorMode), ma con __isWatercolor gia'
      // impostato. Lo intercettiamo qui. Penna/gomma passano invece da
      // path:created (vedi freehandDrawing.js). Durante caricamento/undo ci
      // pensa applyFreehandClipToAll a fine ciclo: qui saltiamo per non
      // duplicare lavoro.
      c.on("object:added", (opt) => {
        const o = opt && opt.target;
        if (!o) return;
        const restoring =
          (typeof isRestoringProject !== "undefined" && isRestoringProject) ||
          (typeof isApplyingSnapshot !== "undefined" && isApplyingSnapshot) ||
          window.isApplyingSnapshot === true ||
          window.isRestoringProject === true;
        if (restoring) return;
        applyFreehandClipToObject(o);
      });
      document.addEventListener("keydown", onKeyDown, true); // capture

      // ── P5: quando il mouse ESCE dall'area del canvas, il cerchio dimensione
      //    tratto deve sparire (altrimenti resta "appeso" all'ultima posizione).
      //    mouseleave (non bubbla, scatta solo all'uscita reale) e' il segnale
      //    affidabile: niente piu' mouse:move che ridipinga il cerchio.
      const upper = c.upperCanvasEl;
      if (upper && !upper.__ftLeaveBound) {
        upper.__ftLeaveBound = true;
        upper.addEventListener("mouseleave", () => {
          if (_activeFreehandTool() || isEditing) {
            hoverPoint = null;
            _redraw(true); // ridisegna senza cerchio; il perimetro committato resta
          }
        });
      }

      _bound = true;
    }

    // Pulsante strumento perimetro (click = disegna/annulla, click destro = cancella).
    const btn = document.getElementById("freehandClipBtn");
    if (btn && !btn.__ftBound) {
      btn.__ftBound = true;
      btn.addEventListener("click", () => startEdit());
      btn.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        if (isEditing) endEdit(false);
        clearPerimeter();
      });
    }

    // Se si passa ad un altro strumento mentre stiamo editando il perimetro,
    // annulla la sessione (coerente col pennello-lazo).
    ["selectToolBtn", "addShapeBtn", "customShapeBtn", "scene3DBtn",
     "lassoSelectBtn", "lassoBrushBtn", "canvasVerticalBtn", "canvasHorizontalBtn"]
      .forEach((id) => {
        const b = document.getElementById(id);
        if (b && !b.__ftHook) {
          b.__ftHook = true;
          b.addEventListener("click", () => { if (isEditing) endEdit(false); });
        }
      });

    // Se renderer ha gia' un poligono caricato (impostato in applyProjectData
    // PRIMA di questo init durante l'apertura progetto), applicalo.
    if (window.freehandClipPolygon && Array.isArray(window.freehandClipPolygon) && window.freehandClipPolygon.length >= 3) {
      clipPolygon = window.freehandClipPolygon.slice();
      applyFreehandClipToAll();
    }

    console.log("[freehandTools] inizializzato");
    return true;
  }

  // ============================================================
  //  ESPOSIZIONI GLOBALI
  // ============================================================
  window.initFreehandTools = initFreehandTools;
  window.applyFreehandClipToAll = applyFreehandClipToAll;
  window.applyFreehandClipToObject = applyFreehandClipToObject;
  window.getFreehandClipPolygon = getFreehandClipPolygon;
  window.setFreehandClipPolygon = setFreehandClipPolygon;
  window.clearFreehandClipPerimeter = clearPerimeter;
  window.startFreehandClipEdit = startEdit;
  window.isFreehandClipEditing = () => isEditing;
  window.setStrokeSizeCircleEnabled = (b) => { SHOW_STROKE_SIZE_CIRCLE = !!b; _redraw(true); };
  // P5: cancella il cerchio dimensione tratto (chiamato da freehandDrawing.js
  // quando si esce dalla modalita' disegno a mano libera, qualunque fosse lo
  // strumento attivo: penna, acquerello o gomma).
  window.clearFreehandStrokeCircle = () => { hoverPoint = null; _redraw(true); };
})();