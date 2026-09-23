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
//      ⚠ ACQUERELLO (Fetta 2C del cantiere del timbro): la macchia vera NON
//      e' larga quanto il cursore. La fa la PUNTA scelta, accumulata strato
//      su strato, piu' l'alone e lo sparpagliamento. L'anello quindi non
//      usa piu' il valore del cursore: MISURA la punta caricata con la
//      stessa ricetta del worker (vedi "ANELLO DELL'ACQUERELLO SU MISURA").
//
//   2) PERIMETRO DI CONTENIMENTO — un poligono dentro cui penna e
//      acquerello possono colorare; fuori no (utile per colorare le
//      fughe restando dentro l'area del mosaico). Come il bordo del
//      canvas taglia i tratti che escono, ma l'ANTEPRIMA del tratto la
//      si vede uscire lo stesso. Realizzato con il clipPath di Fabric
//      (absolutePositioned) applicato a ogni tratto freehand.
//
//      ── MODALITA' PERIMETRO (Fetta 1 del cantiere del perimetro) ────
//      Il pulsante ⬡ apre una MODALITA' che vive per conto suo e NON
//      dipende dallo strumento attivo: si entra dalla selezione, dalla
//      penna, dall'acquerello, indifferentemente. La modalita' ha due
//      fasi:
//
//        fase "draw" (tracciamento) — quando non c'e' ancora un
//          perimetro da modificare:
//            • TAP      = aggiunge un vertice (per cliccare gli spigoli
//                         esterni delle tessere di bordo)
//            • TRASCINA = traccia a mano libera (stile pennello-lazo)
//            • TRASCINA UNA MANIGLIA = sposta un punto GIA' messo,
//                         anche prima della chiusura
//            • TAP sul 1° vertice / INVIO / DOPPIO-CLICK = chiude e
//                         passa alla fase maniglie
//            • BACKSPACE = rimuove l'ultimo punto messo
//            • ESC      = abbandona la sessione (NON cancella un
//                         perimetro gia' committato)
//
//        fase "handles" (maniglie) — si entra chiudendo il perimetro,
//          oppure riaprendo con ⬡ un perimetro gia' esistente:
//            • TRASCINA UNA MANIGLIA = sposta il punto; il ritaglio dei
//                         tratti si aggiorna al RILASCIO
//            • DOPPIO-CLICK SU UN LATO = inserisce un vertice nuovo
//            • CANC / DELETE = toglie la maniglia selezionata (mai
//                         sotto i 3 punti)
//            • CTRL+Z    = annulla l'ultima modifica di forma fatta
//                         DENTRO la sessione (vedi nota sotto)
//            • INVIO / ESC / ⬡ / altro strumento = esce dalla modalita'
//
//      ⚠ CONVIVENZA CON LAZO E PENNELLO SELEZIONE. Lazo e pennello
//      selezione disegnano sullo STESSO strato (contextTop) e lo
//      ripuliscono ad ogni render: non si litiga lo schermo. Se uno dei
//      due e' attivo, l'apertura della modalita' viene RIFIUTATA con un
//      avviso; se si attiva uno dei due mentre la modalita' e' aperta,
//      la modalita' si chiude da sola.
//
//      ⚠ IL RITAGLIO SEGUE LA FORMA. Modificare il perimetro ri-ritaglia
//      i tratti che erano stati tagliati da LUI (confronto geometrico
//      con le forme che il perimetro ha avuto nella sessione). Si puo'
//      fare perche' il clipPath e' una MASCHERA, non un taglio
//      distruttivo: allargando il perimetro ricompare cio' che era
//      nascosto. I tratti tagliati da un perimetro DIVERSO (disegnati
//      prima, con un'altra forma poi cancellata) non vengono toccati.
//
//      ⚠ CTRL+Z DENTRO LA MODALITA'. L'annulla generale di Mosaica
//      fotografa gli OGGETTI, non il poligono globale (che sta nel file
//      di progetto, non nello snapshot): un annulla generale rimetterebbe
//      il taglio vecchio sui tratti lasciando la guida sulla forma nuova.
//      Per questo, mentre la modalita' e' aperta, CTRL+Z e' gestito qui:
//      annulla le modifiche di forma della sessione e tiene guida e
//      taglio allineati. Fuori dalla modalita' CTRL+Z e' quello di
//      sempre.
//
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
  // (acquerello) Il diametro dell'anello NON si regola piu' con un numero:
  // si misura sulla punta caricata. Vedi la sezione "ANELLO DELL'ACQUERELLO
  // SU MISURA" piu' sotto, e la trappola 132 del cantiere del timbro (la
  // vecchia WATERCOLOR_RING_BLEED_K non poteva esprimere lo scarto: il
  // termine principale dipende dalla punta, non dall'alone).
  // --- Pennello Timbro: i due anelli (Fetta 2A del cantiere del timbro) ---
  // Punta e sorgente si vedono con lo STESSO tratteggio dell'anello
  // dell'acquerello (deciso da Mirko il 14/09/2026), uniti da una riga
  // tratteggiata. La punta resta bianca come per gli altri pennelli; la
  // sorgente e' ciano, l'accento dell'app, perche' i due anelli devono
  // distinguersi a colpo d'occhio anche quando si sovrappongono.
  // ⚠ L'anello della sorgente si vede anche PRIMA del Ctrl+Click: con lo
  // scostamento di partenza la sorgente esiste gia', e senza il suo anello
  // il primo tratto si tira a occhi chiusi (§4.3 del cantiere).
  const STAMP_SOURCE_COLOR = "rgba(0,200,255,0.95)";
  // Sorgente fuori dal foglio: la' non c'e' sfondo da copiare e il pennello
  // depositerebbe trasparente. Meglio dirlo con il colore che farlo scoprire.
  const STAMP_SOURCE_OFF_COLOR = "rgba(255,120,120,0.92)";
  const STAMP_SOURCE_LINE_W = 1.2;             // (px schermo) spessore anello sorgente
  const STAMP_SOURCE_DOT_PX = 1.6;             // (px schermo) puntino al centro esatto
  const STAMP_LINK_COLOR = "rgba(0,200,255,0.55)";
  const STAMP_LINK_DASH = [4, 4];              // (px schermo)
  const STAMP_LINK_LINE_W = 1;                 // (px schermo)

  // --- Perimetro di contenimento ---
  const CLIP_VERTEX_DRAG_THRESHOLD_PX = 6;     // (px schermo) oltre = trascino (mano libera / maniglia); sotto = tap
  const CLIP_FREEHAND_MIN_POINT_DISTANCE = 4;  // (px logici) densita' punti durante il trascinamento
  const CLIP_CLOSE_SNAP_PX = 14;               // (px schermo) vicinanza al 1° vertice per chiudere
  const CLIP_GUIDE_COLOR = "rgba(255,140,0,0.95)";   // contorno perimetro committato / in-corso
  const CLIP_GUIDE_FILL = "rgba(255,160,40,0.08)";   // velo interno tenue
  const CLIP_GUIDE_DASH = [8, 5];              // (px schermo)
  const CLIP_GUIDE_LINE_W = 2.8;               // (px schermo) — piu' spesso/visibile
  const CLIP_VERTEX_RADIUS_PX = 3.4;           // (px schermo) pallino vertice in editing
  const CLIP_FIRST_VERTEX_RADIUS_PX = 5.5;     // (px schermo) pallino 1° vertice (per chiudere)
  // --- Maniglie (Fetta 1) ---
  const CLIP_HANDLE_GRAB_PX = 9;               // (px schermo) raggio di presa di una maniglia
  const CLIP_HANDLE_RADIUS_PX = 4.2;           // (px schermo) maniglia a riposo
  const CLIP_HANDLE_HOVER_RADIUS_PX = 5.6;     // (px schermo) maniglia sotto il puntatore
  const CLIP_HANDLE_SEL_RADIUS_PX = 6.4;       // (px schermo) maniglia selezionata
  const CLIP_HANDLE_SEL_COLOR = "rgba(0,200,255,0.98)"; // ciano, accento dell'app
  const CLIP_EDGE_INSERT_SNAP_PX = 12;         // (px schermo) distanza massima dal lato per inserire un vertice
  const CLIP_MIN_VERTICES = 3;                 // un perimetro non scende sotto il triangolo
  const CLIP_POLY_EPS = 0.01;                  // (px logici) tolleranza di confronto fra due forme
  const CLIP_SHAPE_UNDO_LIMIT = 60;            // passi di forma ricordati dentro una sessione

  // ============================================================
  //  STATO
  // ============================================================
  // Perimetro committato: array di {x,y} in coord canvas LOGICHE, oppure null.
  let clipPolygon =
    window.freehandClipPolygon && Array.isArray(window.freehandClipPolygon)
      ? window.freehandClipPolygon.slice()
      : null;

  let hoverPoint = null;        // ultimo punto (coord logiche) sotto il cursore

  // Modalita' perimetro: null (spenta) | "draw" (tracciamento) | "handles" (maniglie)
  let mode = null;
  let editPoints = [];          // punti della sessione (coord logiche)
  let pointerDown = false;      // pulsante premuto durante la sessione
  let dragStarted = false;      // il pointer ha superato la soglia → mano libera
  let downLogical = null;       // punto logico al mousedown
  let downScreen = null;        // {x,y} client al mousedown (per soglia in px schermo)
  let grabIndex = -1;           // maniglia agganciata al mousedown (-1 = nessuna)
  let grabMoved = false;        // la maniglia agganciata ha superato la soglia
  let selectedHandle = -1;      // maniglia selezionata (bersaglio di CANC)
  let hoverHandle = -1;         // maniglia sotto il puntatore (solo evidenza)
  let sessionChanged = false;   // la sessione ha cambiato davvero la forma?
  let shapeUndo = [];           // forme precedenti dentro la sessione (per CTRL+Z)
  let shapeSeen = [];           // tutte le forme che il perimetro ha avuto nella sessione
  let savedDrawingMode = null;  // isDrawingMode salvato prima dell'editing
  let savedSelection = null;    // selection salvato prima dell'editing
  let savedSkipTargetFind = null; // skipTargetFind salvato prima dell'editing
  let savedHoverCursor = null;    // hoverCursor salvato prima dell'editing
  let savedDefaultCursor = null;  // defaultCursor salvato prima dell'editing
  let cursorNow = null;           // cursore applicato ora (per non riscriverlo ad ogni move)

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
  // Il pointer si e' allontanato dal punto di pressione oltre la soglia?
  // Misurata in px SCHERMO (client), come il pennello-lazo: la soglia non
  // deve cambiare con lo zoom.
  function _movedPastThreshold(e) {
    if (!downScreen || !e) return false;
    const ddx = e.clientX - downScreen.x;
    const ddy = e.clientY - downScreen.y;
    return (ddx * ddx + ddy * ddy) >
      CLIP_VERTEX_DRAG_THRESHOLD_PX * CLIP_VERTEX_DRAG_THRESHOLD_PX;
  }

  // ============================================================
  //  STATO STRUMENTO FREEHAND
  // ============================================================
  // 'pen' | 'eraser' | 'watercolor' | 'stamp' | null — quale tool di disegno
  // e' attivo.
  // ⚠ IL TIMBRO SI CHIEDE PER PRIMO. Quando si accende, cloneStampBrush.js
  //   spegne da se' le tre flag di freehandDrawing.js: senza questa domanda
  //   il timbro arriva in fondo e risponde "pen", cosi' l'anello della
  //   dimensione si disegna con la larghezza della PENNA (pochi px) invece
  //   della punta del timbro. Sembra che il riferimento visivo manchi; in
  //   realta' c'e' e mente (trappola 131). Il ripiego "pen" resta, ma ora e'
  //   l'ultima risposta e non la prima: chi aggiunge un pennello nuovo a
  //   Mosaica deve passare da qui, non aggirarlo.
  function _activeFreehandTool() {
    const c = _canvas();
    if (!c || !c.isDrawingMode) return null;
    try {
      if (window.cloneStamp && typeof window.cloneStamp.isActive === "function" &&
          window.cloneStamp.isActive()) return "stamp";
    } catch (e) {}
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
  // Lazo o pennello selezione accesi? Disegnano sullo stesso contextTop e lo
  // ripuliscono ad ogni render: la modalita' perimetro non ci convive.
  function _lassoBusy() {
    try {
      if (typeof window.isLassoMode === "function" && window.isLassoMode()) return true;
    } catch (e) {}
    try {
      if (typeof window.isBrushSelectionMode === "function" && window.isBrushSelectionMode()) return true;
    } catch (e) {}
    return false;
  }

  // ── ANELLO DELL'ACQUERELLO SU MISURA (Fetta 2C del cantiere del timbro) ──
  // L'impronta vera dell'acquerello NON e' larga quanto il cursore: la fa la
  // PUNTA (un PNG, di solito da 512 px, disegnato come se fosse da 240),
  // accumulata strato su strato e impronta su impronta, piu' l'alone. Qui la
  // si ricostruisce con la STESSA ricetta di performStamp() in gpuWorker.js,
  // e se ne misura la larghezza dove il colore scende a META' dell'intensita'
  // del centro del tratto (la soglia dichiarata nel cantiere, trappola 132).
  //
  // Come si fa, in breve. Un tratto dritto e' una fila di impronte a passo
  // costante. Un pixel a distanza d dalla linea del cursore viene coperto da
  // tutte le impronte che gli passano sopra, e ogni strato di ogni impronta
  // lascia passare (1 - alfa) della luce. Quindi:
  //   trasparenza(d) = prodotto di (1 - L_strato * alfa_punta)
  //   -ln(trasparenza(d)) = (1 / passo) * somma lungo il tratto di
  //                         somma sugli strati di -ln(1 - L * alfa)
  // Lo stesso per l'alone (shadowBlur), che il canvas disegna sotto ogni
  // strato. Lo sparpagliamento degli strati sposta ogni strato a caso: in
  // media, sfuma quella somma con una finestra larga quanto lo spostamento.
  //
  // ⚠ Lo spostamento casuale del TRATTO INTERO (strokeParams.perpOffset) non
  //   esiste piu': tolto nella Fetta 3-bis per decisione di Mirko (16/09/2026).
  //   Il tratto cade centrato sul cursore, ed e' li' che l'anello lo disegna.
  //
  // Numeri della ricetta, letti da gpuWorker.js (performStamp) e da
  // watercolorStampBrush.js (onMouseMove). Se cambiano la', vanno cambiati
  // qui: il banco della Fetta 2C ha una prova che se ne accorge.
  const WC_STAMP_BASE_WIDTH = 240;        // la punta e' disegnata larga (png * W / 240)
  const WC_BLEED_TO_BLUR = 1.55;          // shadowBlur = bleed * 1.55
  const WC_LAYER_FADE = 0.85;             // alfa strato = flow * (1 - l/L * 0.85)
  const WC_MIN_LAYERS = 6;                // strati effettivi: max(6, strati)
  const WC_MIN_FLOW = 0.05;               // flusso minimo per strato
  const WC_LAYER_JITTER = 0.85;           // spostamento strato = (rnd-0.5) * sparp * 0.85
  const WC_SEGMENT_K = 0.92;              // passo = max(5, W * spaziatura * 0.92)
  const WC_SEGMENT_MIN = 5;
  // Lo spostamento degli strati e' SEMPRE di traverso al tratto, in tutte le
  // direzioni e con tutte le punte (Fetta 3-bis: il pennello manda al worker
  // la perpendicolare al tratto, e il worker la applica prima di girare il
  // timbro). Qui quindi entra per intero, lungo l'asse d della lastra.
  // (Fino alla Fetta 3-bis era ruotato due volte e si usava la media delle
  // direzioni, 2/pi: la vecchia WC_JITTER_DIR_MEAN non c'e' piu'.)
  // La soglia che definisce il bordo della macchia: meta' dell'intensita' del
  // centro del tratto. E' LEI la decisione, non un numero da ritoccare.
  const WC_EDGE_THRESHOLD = 0.5;
  // Punte enormi (fino a 2400 px): la misura si fa al massimo su questo lato,
  // e si riporta alla scala vera. Basta e avanza per un bordo a meta' altezza.
  const WC_MODEL_MAX_SIDE = 384;          // (px) lato massimo della lastra di misura
  // Tetto di lavoro per una misura (pixel x strati x passate): oltre, la
  // lastra si rimpicciolisce. Tiene la misura nell'ordine dei 10 ms anche
  // con le punte da 2400 px a larghezza 100 e 38 strati.
  const WC_MODEL_BUDGET = 1.5e6;
  // Rotazione casuale per strato: (rnd-0.5)*rotJitter*0.22 gradi, piu' quella
  // per impronta (rnd-0.5)*rotJitter*0.09. Le due si riassumono in una sola
  // uniforme con la stessa varianza: semi-ampiezza rotJitter * 0.1188 gradi.
  const WC_ROT_JITTER_K = Math.sqrt(0.11 * 0.11 + 0.045 * 0.045);
  const WC_ROT_SAMPLES = 5;               // quante rotazioni per farne la media

  // L'aritmetica di Skia per l'alfa di uno strato: a 8 bit, troncata.
  // Misurato sul worker vero (Electron 41): senza questo troncamento l'alone
  // sfumato si somma strato su strato come se fosse continuo, e la misura
  // esce fino al 25% piu' larga del vero (trappola 142).
  function _wcLayerQuant(L) {
    const sc = Math.round(Math.max(0, Math.min(1, L)) * 255) + 1;
    const t = new Uint8Array(256);
    for (let k = 0; k < 256; k++) t[k] = (k * sc) >> 8;
    return t;
  }

  // Media mobile lungo le colonne (asse d), semi-ampiezza h righe (anche
  // frazionaria: le due righe di bordo pesano la parte frazionaria). Somme
  // cumulate: costa uguale qualunque sia la finestra.
  function _wcSmearY(src, size, h, out, cum) {
    const r = Math.floor(h);
    const frac = h - r;
    const w = 2 * r + 1 + 2 * frac;
    for (let x = 0; x < size; x++) {
      cum[0] = 0;
      for (let y = 0; y < size; y++) cum[y + 1] = cum[y] + src[y * size + x];
      for (let y = 0; y < size; y++) {
        const y0 = y - r, y1 = y + r + 1;
        let s = cum[y1 > size ? size : y1] - cum[y0 < 0 ? 0 : y0];
        if (frac > 0) {
          if (y0 - 1 >= 0) s += src[(y0 - 1) * size + x] * frac;
          if (y1 < size) s += src[y1 * size + x] * frac;
        }
        out[y * size + x] = s / w;
      }
    }
  }

  // Misura il diametro (px logici) del tratto d'acquerello per la punta data.
  //   tip      : l'immagine della punta (ImageBitmap / canvas / img)
  //   p        : { width, bleed, jitter, rotJitter, flow, layers, spacing,
  //                tipAngle }
  //   makeCanvas(w, h) : restituisce un <canvas> (o null)
  // Restituisce un numero > 0, oppure null se la misura non si puo' fare.
  function _wcMeasureDiameter(tip, p, makeCanvas) {
    if (!tip || !(tip.width > 0) || !(tip.height > 0)) return null;
    const W = Number(p.width);
    if (!(W > 0)) return null;
    const scale = W / WC_STAMP_BASE_WIDTH;
    const sw = tip.width * scale;
    const sh = tip.height * scale;
    const diag = Math.hypot(sw, sh);
    const fv = Math.max(WC_MIN_FLOW, Number(p.flow) || 0);
    const le = Math.max(WC_MIN_LAYERS, Math.floor(Math.max(1, Number(p.layers) || 14)));
    const blur = Math.max(0, (Number(p.bleed) || 0) * WC_BLEED_TO_BLUR);
    const jitterHalf = Math.max(0, (Number(p.jitter) || 0) * WC_LAYER_JITTER * 0.5); // px logici
    const rotHalf = Math.max(0, (Number(p.rotJitter) || 0) * WC_ROT_JITTER_K) * Math.PI / 180;
    const rotSamples = (rotHalf * diag / 2 >= 0.5) ? WC_ROT_SAMPLES : 1;
    const layerPasses = blur > 0 ? 2 : 1;

    // scala della lastra: tetto sul lato e tetto sul lavoro
    let q = Math.min(1, WC_MODEL_MAX_SIDE / Math.max(sw, sh, 1));
    const extent = (diag / 2 + blur * 1.5 + jitterHalf + 4);
    const cost = (qq) => Math.pow(2 * extent * qq, 2) * le * (rotSamples + 2) * layerPasses;
    if (cost(q) > WC_MODEL_BUDGET) q = q * Math.sqrt(WC_MODEL_BUDGET / cost(q));
    const half = Math.ceil(extent * q) + 1;
    const size = 2 * half;
    if (size < 4) return null;
    const cv = makeCanvas(size, size);
    if (!cv) return null;
    const ctx = cv.getContext("2d", { willReadFrequently: true });
    if (!ctx) return null;
    ctx.imageSmoothingEnabled = true;
    try { ctx.imageSmoothingQuality = "high"; } catch (e) {}

    // 1) la punta (e il suo alone), girata come in un tratto orizzontale,
    //    a qualche rotazione dentro lo sparpagliamento di rotazione
    const ang0 = Number(p.tipAngle) || 0;
    const imgs = [], shds = [];
    const OFF = size + 8;
    for (let i = 0; i < rotSamples; i++) {
      const ang = ang0 + (rotSamples > 1 ? rotHalf * (2 * i / (rotSamples - 1) - 1) : 0);
      const cs = Math.cos(ang) * q, sn = Math.sin(ang) * q;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, size, size);
      ctx.setTransform(cs, sn, -sn, cs, half, half);
      ctx.drawImage(tip, -sw / 2, -sh / 2, sw, sh);
      imgs.push(ctx.getImageData(0, 0, size, size).data);
      if (blur > 0) {
        // il solo alone: la punta fuori dalla lastra, l'ombra riportata dentro
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, size, size);
        ctx.shadowColor = "#000";
        ctx.shadowBlur = blur * q;
        ctx.shadowOffsetX = OFF;
        ctx.shadowOffsetY = 0;
        ctx.setTransform(cs, sn, -sn, cs, half - OFF, half);
        ctx.drawImage(tip, -sw / 2, -sh / 2, sw, sh);
        ctx.shadowBlur = 0;
        ctx.shadowOffsetX = 0;
        shds.push(ctx.getImageData(0, 0, size, size).data);
      }
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);

    // 2) per ogni strato: alfa a 8 bit troncata, media sulle rotazioni,
    //    media sullo sparpagliamento (PRIMA del logaritmo: e' la trasparenza
    //    che si media, perche' ogni strato viene spostato prima di essere
    //    composto), poi -ln(1 - alfa) sommato sugli strati.
    const n = size * size;
    const h = new Float64Array(n);           // -ln(trasparenza) di UNA impronta
    const lay = new Float64Array(n);
    const sm = new Float64Array(n);
    const cum = new Float64Array(size + 1);
    const jh = jitterHalf * q;
    for (let l = 0; l < le; l++) {
      const tq = _wcLayerQuant(fv * (1 - (l / le) * WC_LAYER_FADE));
      for (let pass = 0; pass < layerPasses; pass++) {
        const src = pass === 0 ? imgs : shds;
        lay.fill(0);
        for (let r = 0; r < rotSamples; r++) {
          const d = src[r];
          for (let i = 0; i < n; i++) lay[i] += tq[d[i * 4 + 3]];
        }
        let v = lay;
        if (jh >= 0.25) { _wcSmearY(lay, size, jh, sm, cum); v = sm; }
        const inv = 1 / (255 * rotSamples);
        for (let i = 0; i < n; i++) {
          const t = v[i] * inv;
          if (t > 0) h[i] -= Math.log(Math.max(1e-6, 1 - t));
        }
      }
    }

    // 3) la fila di impronte: passo P (px della lastra). Ogni fase lungo il
    //    tratto somma le impronte che le passano sopra; poi si media la
    //    TRASPARENZA sulle fasi (con impronte rade il tratto e' una fila di
    //    macchie, e la media va fatta macchia per macchia).
    const seg = Math.max(WC_SEGMENT_MIN, W * (Number(p.spacing) || 0) * WC_SEGMENT_K);
    const P = seg * q;
    const B = Math.max(1, Math.round(P));
    const kB = B / P;
    const G = new Float64Array(B);
    const prof = new Float64Array(size);
    for (let y = 0; y < size; y++) {
      G.fill(0);
      const row = y * size;
      for (let x = 0; x < size; x++) {
        const hv = h[row + x];
        if (hv === 0) continue;
        let b = Math.floor(((x % P) / P) * B);
        if (b >= B) b = B - 1;
        G[b] += hv;
      }
      let a = 0;
      for (let b = 0; b < B; b++) a += 1 - Math.exp(-G[b] * kB);
      prof[y] = a / B;
    }

    // 4) bordi a meta' dell'intensita' del centro, cercati dall'ESTERNO:
    //    con le punte a piu' lobi il profilo scende sotto meta' anche FRA due
    //    lobi, e cercando dal centro il bordo verrebbe troppo stretto.
    let topV = 0;
    for (let y = 0; y < size; y++) if (prof[y] > topV) topV = prof[y];
    if (!(topV > 0)) return null;
    const T = topV * WC_EDGE_THRESHOLD;
    let lo = null, hi = null;
    for (let y = size - 1; y > 0; y--) {
      if (prof[y - 1] >= T && prof[y] < T) {
        hi = (y - 1) + (prof[y - 1] - T) / (prof[y - 1] - prof[y]);
        break;
      }
    }
    for (let y = 0; y < size - 1; y++) {
      if (prof[y + 1] >= T && prof[y] < T) {
        lo = (y + 1) - (prof[y + 1] - T) / (prof[y + 1] - prof[y]);
        break;
      }
    }
    if (lo === null || hi === null || !(hi > lo)) return null;
    const dia = (hi - lo) / q;
    return isFinite(dia) && dia > 0 ? dia : null;
  }

  // ── La misura si ricorda, e non si ripete a ogni evento ──────────────────
  // Costa qualche millisecondo (fino a qualche decina con le punte enormi):
  // una volta ogni tanto va benissimo, a ogni evento di un cursore trascinato
  // no. Quindi:
  //   • stessi parametri → la misura ricordata, senza rifare niente;
  //   • un cambio isolato → si misura SUBITO;
  //   • cambi di fila (un cursore trascinato) → si rimanda a quando il
  //     cursore si ferma, e intanto l'anello usa l'ultima misura della
  //     stessa punta riscalata sulla larghezza (senza misura: il cursore).
  const WC_DEFER_MS = 120;                // attesa dopo l'ultimo cambio di una raffica
  const WC_BURST_MS = 250;                // due cambi piu' vicini di cosi' sono "di fila"
  let _wcDone = null;                     // { key, tipId, width, dia }
  let _wcTimer = 0;
  let _wcLastCalcAt = -Infinity;
  let _wcCanvas = null;
  const _wcTipIds = new WeakMap();
  let _wcTipSeq = 0;

  function _wcNow() {
    try { return performance.now(); } catch (e) { return Date.now(); }
  }
  function _wcMakeCanvas(w, h) {
    try {
      if (!_wcCanvas) _wcCanvas = document.createElement("canvas");
      if (_wcCanvas.width !== w) _wcCanvas.width = w;
      if (_wcCanvas.height !== h) _wcCanvas.height = h;
      return _wcCanvas;
    } catch (e) {
      return null;
    }
  }
  function _wcTipId(t) {
    if (!t || (typeof t !== "object" && typeof t !== "function")) return 0;
    let id = _wcTipIds.get(t);
    if (!id) { id = ++_wcTipSeq; _wcTipIds.set(t, id); }
    return id;
  }
  function _wcNum(v, dflt) {
    const n = Number(v);
    return isFinite(n) ? n : dflt;
  }
  // I parametri vivono in freehandDrawing.js (let di primo livello) e la
  // punta in watercolorStampBrush.js (watercolorStampCanvas): si leggono per
  // NOME, come fa gia' questo file con currentLineWidth.
  function _wcReadParams() {
    const tip = typeof watercolorStampCanvas !== "undefined" ? watercolorStampCanvas : null;
    if (!tip) return null;
    let tipAngle = 0;
    try {
      if (typeof getBrushTipAngleOffset === "function") tipAngle = _wcNum(getBrushTipAngleOffset(), 0);
    } catch (e) { tipAngle = 0; }
    return {
      tip: tip,
      width: _wcNum(typeof currentWatercolorWidth !== "undefined" ? currentWatercolorWidth : 24, 24),
      bleed: _wcNum(typeof currentBleed !== "undefined" ? currentBleed : 0, 0),
      jitter: _wcNum(typeof currentPositionJitter !== "undefined" ? currentPositionJitter : 0, 0),
      rotJitter: _wcNum(typeof currentRotationJitter !== "undefined" ? currentRotationJitter : 0, 0),
      flow: _wcNum(typeof currentWatercolorFlow !== "undefined" ? currentWatercolorFlow : 0.82, 0.82),
      layers: _wcNum(typeof currentWatercolorLayers !== "undefined" ? currentWatercolorLayers : 14, 14),
      spacing: _wcNum(typeof currentStampSpacing !== "undefined" ? currentStampSpacing : 0.48, 0.48),
      tipAngle: tipAngle
    };
  }
  function _wcKey(p) {
    return [_wcTipId(p.tip), p.tip.width, p.tip.height, p.width, p.bleed, p.jitter,
      p.rotJitter, p.flow, p.layers, p.spacing, Math.round(p.tipAngle * 1e4)].join("|");
  }
  function _wcCompute(p, key) {
    let dia = null;
    try { dia = _wcMeasureDiameter(p.tip, p, _wcMakeCanvas); } catch (e) { dia = null; }
    _wcLastCalcAt = _wcNow();
    _wcDone = { key: key, tipId: _wcTipId(p.tip), width: p.width, dia: dia };
    return dia;
  }
  function _wcDeferred() {
    _wcTimer = 0;
    const p = _wcReadParams();
    if (!p || !(p.width > 0)) return;
    const key = _wcKey(p);
    if (!_wcDone || _wcDone.key !== key) _wcCompute(p, key);
    if (_activeFreehandTool() === "watercolor" && !_isDrawingNow() && !mode) _redraw(true);
  }
  // Diametro misurato (px logici) del tratto d'acquerello con i parametri di
  // ADESSO, oppure null (punta non ancora caricata, misura impossibile, o
  // misura rimandata senza una precedente da riscalare): allora vale il
  // cursore, come prima della Fetta 2C.
  function _watercolorMeasuredDiameterPx() {
    const p = _wcReadParams();
    if (!p || !(p.width > 0)) return null;
    const key = _wcKey(p);
    if (_wcDone && _wcDone.key === key) return _wcDone.dia;
    if (!_wcTimer && _wcNow() - _wcLastCalcAt >= WC_BURST_MS) return _wcCompute(p, key);
    if (_wcTimer) clearTimeout(_wcTimer);
    _wcTimer = setTimeout(_wcDeferred, WC_DEFER_MS);
    if (_wcDone && _wcDone.dia > 0 && _wcDone.width > 0 && _wcDone.tipId === _wcTipId(p.tip)) {
      return _wcDone.dia * (p.width / _wcDone.width);
    }
    return null;
  }
  // ── fine della misura dell'acquerello ──────────────────────────────────────

  // Diametro LOGICO del tratto da rappresentare col cerchio.
  // Obiettivo: l'anello e' 1:1 col tratto REALE.
  //   • In HOVER mostra la larghezza NOMINALE impostata sugli slider
  //     (penna = currentLineWidth, gomma = Math.max(12, lineW*1.8), identico ad
  //     applyBrushSettings). E' esattamente il segno che traccia il mouse e
  //     quello della Wacom a pressione "piena base" (fattore 1.0).
  //   • ACQUERELLO: la larghezza MISURATA sulla punta caricata (Fetta 2C),
  //     dove il tratto scende a meta' dell'intensita' del suo centro. Se la
  //     misura non c'e' ancora, il cursore (currentWatercolorWidth).
  //   • DURANTE il tratto (isStroking) con Wacom segue LIVE la pressione con lo
  //     STESSO fattore del brush reale (window.wacomGetWidthFactor === il
  //     fattore di PressurePencilBrush / WatercolorStampBrush) → resta 1:1
  //     istante per istante mentre si disegna.
  function _strokeDiameterPx(isStroking) {
    const tool = _activeFreehandTool();

    // ── Timbro ─────────────────────────────────────────────
    // La punta e' un cerchio NETTO di diametro noto in mm reali, e la misura
    // la tiene cloneStampBrush.js — la stessa che usa per campionare, non
    // una copia. Quindi qui si esce subito: niente modulazione Wacom (il
    // timbro non ne ha) e niente correzione dell'alone (non ha alone), che
    // sono i due conti fatti piu' sotto per penna e acquerello. L'anello del
    // timbro puo' essere 1:1 esatto e non deve ereditare lo scarto
    // dell'acquerello (§4.3 del cantiere del timbro).
    if (tool === "stamp") {
      let d = 0;
      try {
        if (window.cloneStamp && typeof window.cloneStamp.getTipDiameterPx === "function") {
          d = Number(window.cloneStamp.getTipDiameterPx());
        }
      } catch (e) { d = 0; }
      if (!isFinite(d) || d <= 0) d = STROKE_CIRCLE_MIN_DIAMETER_PX;
      return Math.max(STROKE_CIRCLE_MIN_DIAMETER_PX, d);
    }

    const lineW = typeof currentLineWidth !== "undefined" ? currentLineWidth : 4;
    const waterW = typeof currentWatercolorWidth !== "undefined" ? currentWatercolorWidth : 24;

    let base;
    if (tool === "eraser") base = Math.max(12, lineW * 1.8);   // come applyBrushSettings
    else if (tool === "watercolor") {
      let m = null;
      try { m = _watercolorMeasuredDiameterPx(); } catch (e) { m = null; }
      base = (m !== null && isFinite(m) && m > 0) ? m : waterW;
    }
    else base = lineW;

    // ── Modulazione pressione Wacom SOLO durante il tratto ────────────────────
    // Penna e acquerello, MENTRE si traccia, stringono/ingrossano il segno con la
    // pressione esattamente come il brush reale, quindi l'anello li segue 1:1.
    // In HOVER NON si modula: l'anello resta sulla larghezza nominale (= il
    // segno a pressione normale / col mouse), niente piu' envelope al
    // maxWidthFactor che lo gonfiava oltre il tratto disegnato.
    // wacomGetWidthFactor ritorna 1.0 con modulazione spenta (mouse / Wacom off).
    if (isStroking && (tool === "pen" || tool === "watercolor") &&
        typeof window.wacomGetWidthFactor === "function") {
      let f = 1;
      try { f = window.wacomGetWidthFactor(); } catch (e) { f = 1; }
      if (Number.isFinite(f) && f > 0) base = base * f;
    }

    // (L'alone dell'acquerello e' gia' dentro la misura: niente da sommare.)

    return Math.max(STROKE_CIRCLE_MIN_DIAMETER_PX, base);
  }

  // ── PENNELLO TIMBRO: la FORMA della punta (Fetta 4A-2) ──────────────
  // Dalla 4A-2 la punta del timbro puo' essere quadrata, rettangolare,
  // triangolare, ovale o libera (disegnata nel costruttore della
  // palladiana), e puo' essere girata. Il contorno NON si ricostruisce qui:
  // lo traccia cloneStampBrush.js con la STESSA funzione che fa la maschera
  // delle impronte, cosi' l'anello mostra esattamente il pezzo che verrebbe
  // copiato (§4.3 del cantiere del timbro, trappola 131).
  // Se il modulo del timbro e' quello di prima (senza queste funzioni) si
  // torna al cerchio: nessun accesso nudo, come vuole il patto.
  function _stampShapeApi() {
    try {
      const api = window.cloneStamp;
      if (api && typeof api.traceTipOutline === "function" &&
          typeof api.tipBoxAt === "function" && typeof api.tipReach === "function") return api;
    } catch (e) {}
    return null;
  }
  // Traccia il contorno della punta attorno a (x, y), sporgente di grow.
  // Restituisce false se non c'e' la forma: allora ci pensa il cerchio.
  function _traceStampTip(ctx, api, x, y, grow) {
    try {
      ctx.beginPath();
      if (api.traceTipOutline(ctx, x, y, grow) === false) return false;
      ctx.closePath();
      return true;
    } catch (e) {
      return false;
    }
  }

  // ============================================================
  //  GEOMETRIA DEL PERIMETRO
  // ============================================================
  function _validPoly(p) {
    return Array.isArray(p) && p.length >= CLIP_MIN_VERTICES &&
      p.every((q) => q && Number.isFinite(q.x) && Number.isFinite(q.y));
  }
  function _clonePoly(p) {
    return p.map((q) => ({ x: q.x, y: q.y }));
  }
  // Due forme sono la stessa forma? Confronto punto per punto con tolleranza:
  // serve per riconoscere quali tratti erano stati tagliati da QUESTO
  // perimetro e quindi vanno ri-ritagliati quando lo si modifica.
  function _samePoly(a, b) {
    if (!Array.isArray(a) || !Array.isArray(b)) return false;
    if (a.length !== b.length || a.length === 0) return false;
    for (let i = 0; i < a.length; i++) {
      const p = a[i], q = b[i];
      if (!p || !q) return false;
      if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) return false;
      if (Math.abs(p.x - q.x) > CLIP_POLY_EPS) return false;
      if (Math.abs(p.y - q.y) > CLIP_POLY_EPS) return false;
    }
    return true;
  }
  // Maniglia sotto il punto p (coord logiche), o -1. Vince la piu' vicina.
  function _hitHandle(p) {
    const k = _screenK();
    const r = CLIP_HANDLE_GRAB_PX * k;
    let best = -1;
    let bestD = r * r;
    for (let i = 0; i < editPoints.length; i++) {
      const d = _dist2(editPoints[i].x, editPoints[i].y, p.x, p.y);
      if (d <= bestD) { bestD = d; best = i; }
    }
    return best;
  }
  // Proiezione di p sul segmento a-b (clampata agli estremi).
  function _projectOnSegment(p, a, b) {
    const vx = b.x - a.x, vy = b.y - a.y;
    const len2 = vx * vx + vy * vy;
    if (len2 <= 0) return { x: a.x, y: a.y };
    let t = ((p.x - a.x) * vx + (p.y - a.y) * vy) / len2;
    if (t < 0) t = 0;
    if (t > 1) t = 1;
    return { x: a.x + vx * t, y: a.y + vy * t };
  }
  // Lato piu' vicino a p, con il punto di appoggio. Null se troppo lontano.
  // I lati sono quelli dell'anello CHIUSO (l'ultimo torna al primo).
  function _nearestEdge(p) {
    if (editPoints.length < 2) return null;
    const k = _screenK();
    const maxD = CLIP_EDGE_INSERT_SNAP_PX * k;
    let best = null;
    let bestD2 = maxD * maxD;
    for (let i = 0; i < editPoints.length; i++) {
      const a = editPoints[i];
      const b = editPoints[(i + 1) % editPoints.length];
      const pr = _projectOnSegment(p, a, b);
      const d2 = _dist2(p.x, p.y, pr.x, pr.y);
      if (d2 <= bestD2) { bestD2 = d2; best = { index: i, point: pr }; }
    }
    return best;
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

    // Col timbro in mano l'anello prende la FORMA della punta (Fetta 4A-2):
    // tonda, quadrata, rettangolare, triangolare, ovale o libera, girata
    // come la punta. Con gli altri pennelli, e con il timbro delle fette
    // precedenti, resta il cerchio.
    let done = false;
    if (tool === "stamp") {
      const api = _stampShapeApi();
      if (api) done = _traceStampTip(ctx, api, hoverPoint.x, hoverPoint.y, STROKE_PREVIEW_RING_GAP_PX * k);
    }
    if (!done) {
      ctx.beginPath();
      ctx.arc(hoverPoint.x, hoverPoint.y, Math.max(0.5, r), 0, Math.PI * 2);
    }
    ctx.lineWidth = STROKE_CIRCLE_LINE_W * k;
    ctx.strokeStyle = tool === "eraser" ? ERASER_CIRCLE_COLOR : STROKE_CIRCLE_COLOR;
    ctx.setLineDash([STROKE_CIRCLE_DASH[0] * k, STROKE_CIRCLE_DASH[1] * k]);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // PENNELLO TIMBRO: l'anello della SORGENTE e la riga tratteggiata che la
  // lega alla punta. La punta la disegna gia' _paintSizeCircle, col diametro
  // vero: qui si aggiunge solo l'altra meta' del riferimento.
  //
  // ⚠ La posizione della sorgente non si ricalcola qui: la si CHIEDE a
  //   cloneStampBrush.js, che e' lo stesso conto con cui campiona i pixel.
  //   Un anello che indica un punto diverso da quello copiato sarebbe peggio
  //   del non averlo (§4.3). Vale anche per l'ancora appena presa con
  //   Ctrl+Click e non ancora consumata: la' la sorgente e' ferma
  //   sull'ancora, e l'anello ce la mostra ferma.
  function _paintStampSource(ctx, k) {
    if (!SHOW_STROKE_SIZE_CIRCLE) return;   // stesso interruttore della punta
    if (!hoverPoint) return;
    if (_activeFreehandTool() !== "stamp") return;

    const api = window.cloneStamp;
    if (!api || typeof api.sourcePointFor !== "function") return;

    let src = null;
    try { src = api.sourcePointFor(hoverPoint); } catch (e) { return; }
    if (!src || !isFinite(src.x) || !isFinite(src.y)) return;

    const gap = STROKE_PREVIEW_RING_GAP_PX * k;
    const r = _strokeDiameterPx(false) / 2 + gap;
    // Dalla 4A-2 il contorno della punta puo' non essere un cerchio: lo
    // chiediamo al timbro, e con lui anche la sua SCATOLA (per l'avviso del
    // bordo) e quanto sporge in una direzione (per la riga fra i due anelli).
    const shape = _stampShapeApi();

    // ⚠ Sorgente A CAVALLO DEL BORDO del foglio: una parte di quello che
    // copierebbe non esiste, quindi l'impronta esce incompleta (trappola
    // 128). Si guarda il CONTORNO, non il centro: un centro appena fuori dal
    // foglio non si vedrebbe nemmeno, perche' l'overlay e' grande come il
    // foglio e non un pixel di piu'. Cosi' invece l'avviso arriva quando
    // serve — mentre ci si avvicina al bordo — ed e' sempre visibile.
    const c = _canvas();
    let off = false;
    if (c) {
      const w = c.getWidth();
      const h = c.getHeight();
      let b = null;
      if (shape) { try { b = shape.tipBoxAt(src.x, src.y, gap); } catch (e) { b = null; } }
      if (!b) b = { x0: src.x - r, y0: src.y - r, x1: src.x + r, y1: src.y + r };
      off = b.x0 < 0 || b.y0 < 0 || b.x1 > w || b.y1 > h;
    }
    const col = off ? STAMP_SOURCE_OFF_COLOR : STAMP_SOURCE_COLOR;

    // La riga va da bordo a bordo dei due anelli, non da centro a centro:
    // dentro gli anelli darebbe fastidio proprio dove si guarda. Se i due
    // anelli si toccano non si disegna affatto. Con una forma non tonda il
    // bordo non sta a un raggio fisso: lo si chiede nella direzione giusta,
    // da una parte e dall'altra.
    const dx = src.x - hoverPoint.x;
    const dy = src.y - hoverPoint.y;
    const d = Math.sqrt(dx * dx + dy * dy);
    if (d > 0) {
      const ux = dx / d;
      const uy = dy / d;
      let rTip = r, rSrc = r;
      if (shape) {
        try {
          const a = shape.tipReach(ux, uy, gap);
          const b = shape.tipReach(-ux, -uy, gap);
          if (isFinite(a) && a > 0) rTip = a;
          if (isFinite(b) && b > 0) rSrc = b;
        } catch (e) {}
      }
      if (d > rTip + rSrc + 1) {
        ctx.beginPath();
        ctx.moveTo(hoverPoint.x + ux * rTip, hoverPoint.y + uy * rTip);
        ctx.lineTo(src.x - ux * rSrc, src.y - uy * rSrc);
        ctx.lineWidth = STAMP_LINK_LINE_W * k;
        ctx.strokeStyle = STAMP_LINK_COLOR;
        ctx.setLineDash([STAMP_LINK_DASH[0] * k, STAMP_LINK_DASH[1] * k]);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }

    let ok = false;
    if (shape) ok = _traceStampTip(ctx, shape, src.x, src.y, gap);
    if (!ok) {
      ctx.beginPath();
      ctx.arc(src.x, src.y, Math.max(0.5, r), 0, Math.PI * 2);
    }
    ctx.lineWidth = STAMP_SOURCE_LINE_W * k;
    ctx.strokeStyle = col;
    ctx.setLineDash([STROKE_CIRCLE_DASH[0] * k, STROKE_CIRCLE_DASH[1] * k]);
    ctx.stroke();
    ctx.setLineDash([]);

    // Il centro esatto da cui parte la copia: con una punta piccola l'anello
    // da solo non basta a dire "da qui".
    ctx.beginPath();
    ctx.arc(src.x, src.y, STAMP_SOURCE_DOT_PX * k, 0, Math.PI * 2);
    ctx.fillStyle = col;
    ctx.fill();
  }

  // Contorno tratteggiato + velo interno di un anello chiuso.
  function _paintRing(ctx, k, pts) {
    if (!pts || pts.length < 2) return;
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.closePath();
    if (pts.length >= CLIP_MIN_VERTICES) {
      ctx.fillStyle = CLIP_GUIDE_FILL;
      ctx.fill();
    }
    ctx.lineWidth = CLIP_GUIDE_LINE_W * k;
    ctx.strokeStyle = CLIP_GUIDE_COLOR;
    ctx.setLineDash([CLIP_GUIDE_DASH[0] * k, CLIP_GUIDE_DASH[1] * k]);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // Le maniglie. In fase "draw" il 1° vertice resta il bersaglio grosso e
  // bianco della chiusura; in fase "handles" sono tutte pari, tranne quella
  // selezionata (ciano) e quella sotto il puntatore (un filo piu' grande).
  function _paintHandles(ctx, k, pts, firstIsCloseTarget) {
    for (let i = 0; i < pts.length; i++) {
      const isFirstTarget = firstIsCloseTarget && i === 0;
      const isSel = i === selectedHandle;
      const isHover = i === hoverHandle;

      let r = CLIP_HANDLE_RADIUS_PX;
      if (isFirstTarget) r = CLIP_FIRST_VERTEX_RADIUS_PX;
      if (isSel) r = CLIP_HANDLE_SEL_RADIUS_PX;
      else if (isHover) r = CLIP_HANDLE_HOVER_RADIUS_PX;

      let fill = CLIP_GUIDE_COLOR;
      if (isFirstTarget) fill = "rgba(255,255,255,0.95)";
      if (isSel) fill = CLIP_HANDLE_SEL_COLOR;

      ctx.beginPath();
      ctx.arc(pts[i].x, pts[i].y, r * k, 0, Math.PI * 2);
      ctx.fillStyle = fill;
      ctx.fill();
      ctx.lineWidth = 1 * k;
      ctx.strokeStyle = isSel ? "rgba(255,255,255,0.95)" : CLIP_GUIDE_COLOR;
      ctx.stroke();
    }
  }

  // Disegna la guida del perimetro: poligono committato (tratteggio + velo)
  // e/o la sessione in corso (segmenti + maniglie).
  function _paintPerimeterGuide(ctx, k) {
    // 1) Fuori dalla modalita': solo il perimetro committato, come guida.
    if (!mode) {
      if (_validPoly(clipPolygon)) _paintRing(ctx, k, clipPolygon);
      return;
    }

    // 2) Fase maniglie: anello chiuso + tutte le maniglie manovrabili.
    if (mode === "handles") {
      _paintRing(ctx, k, editPoints);
      _paintHandles(ctx, k, editPoints, false);
      return;
    }

    // 3) Fase tracciamento: spezzata aperta + elastico + maniglie.
    const pts = editPoints;
    if (pts.length >= 1) {
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
      // segmento "elastico" fino al cursore (se non sto trascinando nulla)
      if (!dragStarted && grabIndex < 0 && hoverPoint) ctx.lineTo(hoverPoint.x, hoverPoint.y);
      ctx.lineWidth = CLIP_GUIDE_LINE_W * k;
      ctx.strokeStyle = CLIP_GUIDE_COLOR;
      ctx.setLineDash([CLIP_GUIDE_DASH[0] * k, CLIP_GUIDE_DASH[1] * k]);
      ctx.stroke();
      ctx.setLineDash([]);

      // velo interno se la sessione e' gia' un poligono plausibile
      if (pts.length >= CLIP_MIN_VERTICES) {
        ctx.beginPath();
        ctx.moveTo(pts[0].x, pts[0].y);
        for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
        ctx.closePath();
        ctx.fillStyle = CLIP_GUIDE_FILL;
        ctx.fill();
      }
    }
    _paintHandles(ctx, k, pts, true);
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
    // oppure la modalita' perimetro aperta. Altrimenti lasciamo l'overlay
    // agli altri strumenti (lazo, pennello-lazo, ecc.).
    if (!tool && !mode) {
      if (clearFirst) c.clearContext(ctx);
      return;
    }

    if (clearFirst) c.clearContext(ctx);

    const k = _screenK();
    ctx.save();
    _applyWorldTransform(ctx, c);
    _paintPerimeterGuide(ctx, k);
    if (!mode) {
      _paintSizeCircle(ctx, k);
      // Col timbro in mano la punta non basta: serve anche sapere DA DOVE
      // sta arrivando la copia. Con gli altri pennelli non fa nulla.
      _paintStampSource(ctx, k);
    }
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

  // ── Il taglio segue la forma (Fetta 1) ─────────────────────────────────────
  // Quando il perimetro cambia forma, i tratti che erano stati tagliati da LUI
  // devono essere ri-ritagliati con la forma nuova. Riconoscerli e' un confronto
  // geometrico: il loro __clipPoly coincide con una delle forme che il perimetro
  // ha avuto in questa sessione (shapeSeen). I tratti tagliati da un perimetro
  // DIVERSO restano intoccati, ed e' voluto.
  //
  // ⚠ Si puo' fare perche' il clipPath e' una MASCHERA e non un taglio
  // distruttivo: il percorso del tratto e' intero sotto, quindi allargando il
  // perimetro ricompare cio' che era nascosto.
  function _rebakeClipPoly(nextPoly) {
    const c = _canvas();
    if (!c || !c.getObjects) return 0;
    let n = 0;
    c.getObjects().forEach((o) => {
      if (!isFreehandObj(o)) return;
      if (!_validPoly(o.__clipPoly)) return;
      for (let i = 0; i < shapeSeen.length; i++) {
        if (_samePoly(o.__clipPoly, shapeSeen[i])) {
          o.__clipPoly = _clonePoly(nextPoly);
          n++;
          return;
        }
      }
    });
    return n;
  }

  // Ricorda una forma come "appartenente a questo perimetro".
  function _rememberShape(poly) {
    if (!_validPoly(poly)) return;
    for (let i = 0; i < shapeSeen.length; i++) {
      if (_samePoly(shapeSeen[i], poly)) return;
    }
    shapeSeen.push(_clonePoly(poly));
  }

  // Il punto unico in cui la forma del perimetro cambia: aggiorna il poligono
  // globale, ri-ritaglia i tratti che lo seguivano, marca sporco per
  // autosalvataggio/annulla, e registra il passo per il CTRL+Z di sessione.
  function _commitShape(pts, opts) {
    if (!_validPoly(pts)) return false;
    const previous = _validPoly(clipPolygon) ? _clonePoly(clipPolygon) : null;

    if (!(opts && opts.noUndo)) {
      if (previous) {
        shapeUndo.push(previous);
        if (shapeUndo.length > CLIP_SHAPE_UNDO_LIMIT) shapeUndo.shift();
      }
    }
    if (previous) _rememberShape(previous);

    clipPolygon = _clonePoly(pts);
    window.freehandClipPolygon = clipPolygon;
    _rememberShape(clipPolygon);
    _rebakeClipPoly(clipPolygon);
    applyFreehandClipToAll();
    _markDirty();
    sessionChanged = true;
    return true;
  }

  // ============================================================
  //  PERSISTENZA (lettori usati da renderer.js / autoSave.js)
  // ============================================================
  function getFreehandClipPolygon() {
    return clipPolygon && clipPolygon.length >= CLIP_MIN_VERTICES ? _clonePoly(clipPolygon) : null;
  }
  // Imposta il poligono (es. al caricamento progetto). Non applica il clip:
  // chi chiama deve poi invocare applyFreehandClipToAll() quando gli oggetti
  // sono sul canvas. opts.silent = non mostrare toast.
  function setFreehandClipPolygon(poly, opts) {
    if (Array.isArray(poly) && poly.length >= CLIP_MIN_VERTICES) {
      clipPolygon = poly.map((p) => ({ x: +p.x, y: +p.y })).filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
      if (clipPolygon.length < CLIP_MIN_VERTICES) clipPolygon = null;
    } else {
      clipPolygon = null;
    }
    window.freehandClipPolygon = clipPolygon;
    // Un poligono che arriva da fuori (apertura progetto, annulla) apre una
    // storia nuova: le forme della sessione precedente non c'entrano piu'.
    shapeUndo = [];
    shapeSeen = [];
    if (clipPolygon) _rememberShape(clipPolygon);
    if (mode) {
      // Se stavamo manovrando, la sessione non ha piu' senso: il poligono
      // sotto i piedi e' cambiato per un'altra via.
      exitMode({ silent: true });
    }
    if (!(opts && opts.silent)) _redraw(true);
  }
  // Marca "sporco" per l'autosave (riusa il debounce undo o pushState).
  function _markDirty() {
    if (typeof window.pushState === "function") window.pushState();
    else if (typeof pushState === "function") pushState();
  }

  // ============================================================
  //  MODALITA' PERIMETRO — apertura, chiusura, uscita
  // ============================================================
  function _suspendCanvas(c) {
    // Sospendi temporaneamente la modalita' disegno (i click devono manovrare
    // il perimetro, non tracciare tratti) e la selezione.
    savedDrawingMode = c.isDrawingMode;
    savedSelection = c.selection;
    c.isDrawingMode = false;
    c.selection = false;
    c.discardActiveObject && c.discardActiveObject();

    // ── P4: il cursore NON deve cambiare passando sopra le tessere, altrimenti
    //    Fabric muove l'hover-cursor e l'utente perde il riferimento esatto del
    //    punto di aggancio. Disattivando skipTargetFind, Fabric non cerca piu'
    //    target sotto il puntatore (niente hover-cursor, niente hit-test): il
    //    crosshair resta fisso e il punto al click e' quello reale del pointer.
    savedSkipTargetFind = c.skipTargetFind;
    savedHoverCursor = c.hoverCursor;
    savedDefaultCursor = c.defaultCursor;
    c.skipTargetFind = true;
    c.hoverCursor = "crosshair";
    _setCursor(c, "crosshair");
  }

  function _setCursor(c, cur) {
    if (!c || cursorNow === cur) return;
    cursorNow = cur;
    c.defaultCursor = cur;
    c.setCursor && c.setCursor(cur);
  }

  function _restoreCanvas(c) {
    if (!c) return;
    if (savedDrawingMode != null) c.isDrawingMode = savedDrawingMode;
    if (savedSelection != null) c.selection = savedSelection;
    // IMPORTANTE: skipTargetFind va SEMPRE ripristinato (fallback false),
    // altrimenti dopo l'editing le tessere non sarebbero piu' selezionabili.
    c.skipTargetFind = (savedSkipTargetFind == null) ? false : savedSkipTargetFind;
    c.hoverCursor = (savedHoverCursor == null) ? "move" : savedHoverCursor;
    cursorNow = null;
    c.defaultCursor = (savedDefaultCursor == null) ? "default" : savedDefaultCursor;
    c.setCursor && c.setCursor(c.defaultCursor);
  }

  function _btn() {
    return document.getElementById("freehandClipBtn");
  }

  // Apre la modalita'. Se un perimetro esiste già si entra direttamente in
  // fase MANIGLIE su quello, senza ridisegnarlo da zero.
  function startEdit() {
    const c = _canvas();
    if (!c) return;
    if (mode) { exitMode(); return; }        // toggle: ri-cliccando si esce

    // Decisione 1 del cantiere: niente convivenza con lazo / pennello selezione.
    if (_lassoBusy()) {
      _toast(_t("freehandClip.toast.blockedByLasso",
        "⬡ Chiudi prima il lazo o il pennello selezione: usano lo stesso strato di disegno del perimetro"));
      return;
    }

    _suspendCanvas(c);
    pointerDown = false;
    dragStarted = false;
    grabIndex = -1;
    grabMoved = false;
    hoverHandle = -1;
    sessionChanged = false;
    shapeUndo = [];
    shapeSeen = [];

    if (_validPoly(clipPolygon)) {
      mode = "handles";
      editPoints = _clonePoly(clipPolygon);
      selectedHandle = -1;
      _rememberShape(clipPolygon);
      _toast(_t("freehandClip.toast.handles",
        "⬡ Maniglie: trascina per spostare, doppio-click su un lato = punto nuovo, CANC = togli, Invio = fine"));
    } else {
      mode = "draw";
      editPoints = [];
      selectedHandle = -1;
      _toast(_t("freehandClip.toast.start",
        "⬡ Perimetro: tap = vertice, trascina = mano libera, le maniglie si spostano, Invio/doppio-click = chiudi, ESC = annulla"));
    }

    const b = _btn();
    if (b) b.classList.add("active");
    _redraw(true);
  }

  // Chiude l'anello tracciato e passa alla fase maniglie (non esce).
  function closeRing() {
    if (mode !== "draw") return false;
    if (editPoints.length < CLIP_MIN_VERTICES) {
      _toast(_t("freehandClip.toast.needMore", "⬡ Servono almeno 3 punti per chiudere il perimetro"));
      return false;
    }
    _commitShape(editPoints);
    editPoints = _clonePoly(clipPolygon);
    mode = "handles";
    selectedHandle = -1;
    hoverHandle = -1;
    dragStarted = false;
    grabIndex = -1;
    grabMoved = false;
    _toast(_t("freehandClip.toast.set", "⬡ Perimetro di contenimento impostato"));
    _redraw(true);
    return true;
  }

  // Esce dalla modalita'. La forma committata resta: in fase maniglie ogni
  // modifica e' già stata applicata al rilascio.
  function exitMode(opts) {
    const c = _canvas();
    if (!mode) return;
    const wasMode = mode;
    const changed = sessionChanged;

    mode = null;
    editPoints = [];
    pointerDown = false;
    dragStarted = false;
    grabIndex = -1;
    grabMoved = false;
    selectedHandle = -1;
    hoverHandle = -1;
    sessionChanged = false;
    shapeUndo = [];

    _restoreCanvas(c);
    savedDrawingMode = null;
    savedSelection = null;
    savedSkipTargetFind = null;
    savedHoverCursor = null;
    savedDefaultCursor = null;

    const b = _btn();
    if (b) b.classList.remove("active");

    if (!(opts && opts.silent)) {
      if (wasMode === "draw") {
        _toast(_t("freehandClip.toast.cancelled", "⬡ Perimetro annullato"));
      } else if (changed) {
        _toast(_t("freehandClip.toast.set", "⬡ Perimetro di contenimento impostato"));
      }
    }
    _redraw(true);
  }

  // Cancella un perimetro committato (click destro sul pulsante).
  function clearPerimeter(opts) {
    const had = !!(clipPolygon && clipPolygon.length >= CLIP_MIN_VERTICES);
    if (mode) exitMode({ silent: true });
    clipPolygon = null;
    window.freehandClipPolygon = null;
    shapeUndo = [];
    shapeSeen = [];
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
  //  MANIGLIE — inserisci, togli, annulla di sessione
  // ============================================================
  function insertVertexNear(p) {
    if (mode !== "handles") return false;
    const edge = _nearestEdge(p);
    if (!edge) return false;
    // Se il punto di appoggio cade praticamente su una maniglia esistente non
    // si inserisce niente: sarebbe un doppione degenere (capita col
    // doppio-click fatto sopra una maniglia).
    const k = _screenK();
    const grab = CLIP_HANDLE_GRAB_PX * k;
    for (let i = 0; i < editPoints.length; i++) {
      if (_dist2(editPoints[i].x, editPoints[i].y, edge.point.x, edge.point.y) <= grab * grab) return false;
    }
    const next = _clonePoly(editPoints);
    next.splice(edge.index + 1, 0, { x: edge.point.x, y: edge.point.y });
    _commitShape(next);
    editPoints = _clonePoly(clipPolygon);
    selectedHandle = edge.index + 1;
    _toast(_t("freehandClip.toast.vertexAdded", "⬡ Punto aggiunto al perimetro"));
    _redraw(true);
    return true;
  }

  function removeSelectedHandle() {
    if (mode !== "handles") return false;
    if (selectedHandle < 0 || selectedHandle >= editPoints.length) return false;
    if (editPoints.length <= CLIP_MIN_VERTICES) {
      _toast(_t("freehandClip.toast.minPoints", "⬡ Un perimetro ha bisogno di almeno 3 punti"));
      return false;
    }
    const next = _clonePoly(editPoints);
    next.splice(selectedHandle, 1);
    _commitShape(next);
    editPoints = _clonePoly(clipPolygon);
    selectedHandle = -1;
    hoverHandle = -1;
    _toast(_t("freehandClip.toast.vertexRemoved", "⬡ Punto rimosso dal perimetro"));
    _redraw(true);
    return true;
  }

  // CTRL+Z di sessione: torna alla forma precedente tenendo guida e taglio
  // allineati. Ritorna false se non c'e' niente da annullare, così il tasto
  // resta all'annulla generale di Mosaica.
  function undoShapeStep() {
    if (mode !== "handles") return false;
    if (!shapeUndo.length) return false;
    const prev = shapeUndo.pop();
    if (!_validPoly(prev)) return false;
    _commitShape(prev, { noUndo: true });
    editPoints = _clonePoly(clipPolygon);
    selectedHandle = -1;
    hoverHandle = -1;
    _redraw(true);
    return true;
  }

  // ============================================================
  //  EVENTI MOUSE (canvas)
  // ============================================================
  function onMouseDown(opt) {
    if (!mode) return;              // fuori modalita': non tocchiamo nulla
    const e = opt && opt.e;
    if (e && typeof e.button === "number" && e.button !== 0) return; // solo sinistro

    const p = _pointer(e);
    pointerDown = true;
    dragStarted = false;
    grabMoved = false;
    downLogical = { x: p.x, y: p.y };
    downScreen = e ? { x: e.clientX, y: e.clientY } : { x: p.x, y: p.y };
    hoverPoint = { x: p.x, y: p.y };
    // Una maniglia sotto il puntatore vince su tutto: si aggancia e si sposta,
    // in entrambe le fasi. E' il cuore della Fetta 1.
    grabIndex = _hitHandle(p);
    hoverHandle = grabIndex;
    _redraw(true);
  }

  function onMouseMove(opt) {
    const e = opt && opt.e;
    const tool = _activeFreehandTool();

    // --- MODALITA' PERIMETRO ---
    if (mode) {
      const c = _canvas();
      const p = _pointer(e);
      hoverPoint = { x: p.x, y: p.y };

      if (pointerDown) {
        if (grabIndex >= 0) {
          // Sto (forse) spostando una maniglia: la muovo solo dopo la soglia,
          // così un tap fermo resta un tap (chiusura / selezione).
          if (!grabMoved && _movedPastThreshold(e)) grabMoved = true;
          if (grabMoved && editPoints[grabIndex]) {
            editPoints[grabIndex] = { x: p.x, y: p.y };
            selectedHandle = grabIndex;
          }
        } else if (mode === "draw") {
          if (!dragStarted && _movedPastThreshold(e)) {
            dragStarted = true;
            // il primo punto della mano-libera e' il punto del down
            if (downLogical) editPoints.push({ x: downLogical.x, y: downLogical.y });
          }
          if (dragStarted) {
            const last = editPoints[editPoints.length - 1];
            if (!last || _dist2(last.x, last.y, p.x, p.y) >= CLIP_FREEHAND_MIN_POINT_DISTANCE * CLIP_FREEHAND_MIN_POINT_DISTANCE) {
              editPoints.push({ x: p.x, y: p.y });
            }
          }
        }
      } else {
        // Hover: evidenzia la maniglia agganciabile e cambia cursore.
        hoverHandle = _hitHandle(p);
        _setCursor(c, hoverHandle >= 0 ? "move" : "crosshair");
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
    if (!mode) return;
    const e = opt && opt.e;
    const p = _pointer(e);

    if (!pointerDown) {
      dragStarted = false;
      grabIndex = -1;
      grabMoved = false;
      return;
    }
    pointerDown = false;

    // (a) Avevo agganciato una maniglia.
    if (grabIndex >= 0) {
      const idx = grabIndex;
      const moved = grabMoved;
      grabIndex = -1;
      grabMoved = false;

      if (moved) {
        if (editPoints[idx]) editPoints[idx] = { x: p.x, y: p.y };
        selectedHandle = idx;
        // Il ritaglio si aggiorna al RILASCIO, non ad ogni pixel del
        // trascinamento: durante il gesto si muove solo la guida.
        if (mode === "handles") {
          _commitShape(editPoints);
          editPoints = _clonePoly(clipPolygon);
        }
        _redraw(true);
        return;
      }

      // Tap fermo su una maniglia.
      if (mode === "draw" && idx === 0 && editPoints.length >= CLIP_MIN_VERTICES) {
        closeRing();
        return;
      }
      selectedHandle = idx;
      _redraw(true);
      return;
    }

    // (b) Mano libera completata: i punti sono gia' stati accumulati.
    if (dragStarted) {
      dragStarted = false;
      _redraw(true);
      return;
    }

    // (c) Tap su area vuota.
    if (mode === "draw") {
      // Chiusura per vicinanza al 1° vertice: raggio piu' generoso di quello
      // di presa della maniglia, quindi resta utile anche se la maniglia non
      // e' stata agganciata.
      if (editPoints.length >= CLIP_MIN_VERTICES) {
        const k = _screenK();
        const snapLogical = CLIP_CLOSE_SNAP_PX * k;
        if (_dist2(editPoints[0].x, editPoints[0].y, p.x, p.y) <= snapLogical * snapLogical) {
          closeRing();
          return;
        }
      }
      editPoints.push({ x: p.x, y: p.y });
      selectedHandle = editPoints.length - 1;
      _redraw(true);
      return;
    }

    // Fase maniglie: tap a vuoto = deseleziona.
    selectedHandle = -1;
    _redraw(true);
  }

  // ============================================================
  //  I DUE RIMEDI DEL COLLAUDO DEL 12 SETTEMBRE 2026
  // ============================================================
  // ⚠ DIFETTO A — il doppio click faceva NASCERE UNA TESSERA.
  // renderer.js (riga 525) ha il vecchio "doppio click = quadrato nuovo",
  // con questa guardia:  if (opt.target || canvas.isDrawingMode) return;
  // Dentro la modalita' perimetro nessuna delle due salva: isDrawingMode
  // e' spento da _suspendCanvas, e opt.target e' SEMPRE null perche'
  // skipTargetFind e' acceso (P4: il crosshair non deve ballare sopra le
  // tessere). Quindi ogni doppio click inseriva il vertice E aggiungeva
  // una tessera.
  // renderer.js non si tocca, e non si puo' nemmeno arrivare prima sul suo
  // ascoltatore di Fabric: gli eventi di Fabric si servono in ordine di
  // registrazione e il suo e' registrato prima del nostro. Ma il doppio
  // click nasce come evento DOM nativo sull'upper-canvas: un ascoltatore in
  // fase CAPTURE su `document` — che e' un antenato — scende dall'alto e
  // arriva prima di chiunque sia agganciato all'elemento. Lo fermiamo li',
  // e il doppio click del perimetro lo serviamo noi.
  let lastDblAt = 0;

  function _handleDoubleClick(p) {
    if (mode === "draw") { closeRing(); return; }
    insertVertexNear(p);
  }

  function onNativeDblClick(e) {
    if (!mode || !e) return;
    const c = _canvas();
    if (!c) return;
    const el = c.upperCanvasEl;
    if (!el) return;
    // Solo i doppi click che cadono sul canvas: quelli sui pannelli, sugli
    // slider e sui campi di testo restano di chi li aspetta.
    const t = e.target;
    if (t !== el && !(el.contains && el.contains(t))) return;
    _stop(e);
    lastDblAt = Date.now();
    _handleDoubleClick(c.getPointer(e));
  }

  // ⚠ DIFETTO B — trascinando si SELEZIONAVANO LE TESSERE sotto il mouse.
  // _suspendCanvas spegne canvas.selection all'apertura della modalita', ma
  // renderer.js (righe 8175-8181, dentro restoreAltPanOnCanvas) ha un
  // ascoltatore su window che ad OGNI mouseup, in qualunque condizione, fa
  // `canvas.selection = true`. Quindi bastava un tap per riaccenderla: dal
  // secondo gesto in poi Fabric apriva il suo rettangolo di selezione e al
  // rilascio si prendeva tutte le tessere attraversate.
  // ⚠ Rimetterla a posto al mouseup NON basta: il rettangolo di selezione
  // nasce dentro __onMouseDown, PRIMA che Fabric emetta "mouse:down". Il
  // punto giusto e' "mouse:down:before", che Fabric emette prima di
  // decidere; da li' la selezione e' gia' spenta e il rettangolo non nasce
  // nemmeno. Il presidio sul mouseup resta come seconda cintura, e sta su
  // window DOPO quello di renderer.js (siamo caricati dopo: ci tocca
  // l'ultima parola).
  function _enforceNoSelection() {
    const c = _canvas();
    if (!c) return;
    if (c.selection !== false) c.selection = false;
    if (c.skipTargetFind !== true) c.skipTargetFind = true;
  }

  function onMouseDownBefore() {
    if (!mode) return;
    _enforceNoSelection();
  }

  function onWindowMouseUp() {
    if (!mode) return;
    _enforceNoSelection();
  }

  function onDblClick(opt) {
    if (!mode) return;
    // Se il doppio click e' gia' stato servito dal listener nativo in fase
    // capture — cioe' la via normale — non lo serviamo una seconda volta.
    if (Date.now() - lastDblAt < 400) return;
    _handleDoubleClick(_pointer(opt && opt.e));
  }

  function onAfterRender() {
    // Safety net: dopo un render del canvas (zoom, pan, undo, path:created…)
    // ridisegna l'overlay se siamo "in scena" e NON in pieno tratto attivo
    // (li' ci pensa onMouseMove a sovrapporre senza scie).
    if (mode) { _redraw(true); return; }
    if (_activeFreehandTool() && !_isDrawingNow()) _redraw(true);
  }

  // ── L'intestazione del file lo dice, ma vale la pena ripeterlo qui ──
  // Mentre il timbro dipinge, l'anello della punta e quello della sorgente
  // li ridisegna onMouseMove (il timbro e' a piena resa): la rotazione della
  // punta che segue il tratto arriva da la', perche' Fabric chiama prima il
  // pennello e poi manda l'evento "mouse:move" a noi. Quindi l'anello mostra
  // sempre l'orientamento dell'ultima impronta, non quello del movimento
  // prima (Fetta 4A-2).

  // ============================================================
  //  TASTIERA (in fase CAPTURE, come il pennello-lazo, per precedere
  //  l'handler globale che su ESC esce dal fullscreen e su CANC
  //  cancella l'oggetto selezionato)
  // ============================================================
  function _stop(e) {
    e.preventDefault();
    e.stopPropagation();
    if (typeof e.stopImmediatePropagation === "function") e.stopImmediatePropagation();
  }

  function onKeyDown(e) {
    if (!mode) return;

    // Non rubare tasti mentre si scrive in un campo.
    const ae = document.activeElement;
    const tag = ae && ae.tagName ? ae.tagName.toUpperCase() : "";
    const typing = tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || (ae && ae.isContentEditable);

    if (e.key === "Escape") {
      _stop(e);
      exitMode();
      return;
    }
    if (e.key === "Enter" && !typing) {
      _stop(e);
      if (mode === "draw") closeRing();
      else exitMode();
      return;
    }
    // CTRL+Z dentro la modalita': annulla un passo di FORMA. Se non c'e'
    // niente da annullare lasciamo il tasto all'annulla generale.
    if ((e.key === "z" || e.key === "Z") && (e.ctrlKey || e.metaKey) && !e.shiftKey && !typing) {
      if (undoShapeStep()) { _stop(e); }
      return;
    }
    if ((e.key === "Delete" || e.key === "Del") && !typing) {
      // In fase maniglie CANC e' della maniglia, non della tessera.
      if (mode === "handles") {
        _stop(e);
        removeSelectedHandle();
      }
      return;
    }
    if (e.key === "Backspace" && !typing) {
      _stop(e);
      if (mode === "draw") {
        if (editPoints.length) editPoints.pop();
        if (selectedHandle >= editPoints.length) selectedHandle = editPoints.length - 1;
        _redraw(true);
      } else {
        removeSelectedHandle();
      }
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
      // ⚠ "down:before" precede la nascita del rettangolo di selezione di
      // Fabric: e' l'unico momento utile per spegnerla (difetto B).
      c.on("mouse:down:before", onMouseDownBefore);
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
      // Difetto A: in CAPTURE su document, cosi' arriviamo prima
      // dell'ascoltatore di Fabric agganciato all'upper-canvas.
      document.addEventListener("dblclick", onNativeDblClick, true);
      // Difetto B, seconda cintura: su window e DOPO renderer.js.
      window.addEventListener("mouseup", onWindowMouseUp);

      // ── P5: quando il mouse ESCE dall'area del canvas, il cerchio dimensione
      //    tratto deve sparire (altrimenti resta "appeso" all'ultima posizione).
      //    mouseleave (non bubbla, scatta solo all'uscita reale) e' il segnale
      //    affidabile: niente piu' mouse:move che ridipinga il cerchio.
      const upper = c.upperCanvasEl;
      if (upper && !upper.__ftLeaveBound) {
        upper.__ftLeaveBound = true;
        upper.addEventListener("mouseleave", () => {
          if (_activeFreehandTool() || mode) {
            hoverPoint = null;
            hoverHandle = -1;
            _redraw(true); // ridisegna senza cerchio; il perimetro resta
          }
        });
      }

      _bound = true;
    }

    // Pulsante strumento perimetro (click = apri/chiudi modalita', click destro
    // = cancella il perimetro).
    const btn = _btn();
    if (btn && !btn.__ftBound) {
      btn.__ftBound = true;
      btn.addEventListener("click", () => startEdit());
      btn.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        clearPerimeter();
      });
    }

    // Se si passa ad un altro strumento mentre la modalita' e' aperta, la
    // modalita' si chiude (coerente col pennello-lazo). Vale anche per penna,
    // gomma e acquerello: chi li clicca vuole disegnare, non manovrare punti.
    ["selectToolBtn", "addShapeBtn", "customShapeBtn",
     "lassoSelectBtn", "lassoBrushBtn", "canvasVerticalBtn", "canvasHorizontalBtn",
     "freehandBtn", "eraserBtn", "watercolorBtn"]
      .forEach((id) => {
        const b = document.getElementById(id);
        if (b && !b.__ftHook) {
          b.__ftHook = true;
          b.addEventListener("click", () => { if (mode) exitMode({ silent: true }); });
        }
      });

    // Se renderer ha gia' un poligono caricato (impostato in applyProjectData
    // PRIMA di questo init durante l'apertura progetto), applicalo.
    if (window.freehandClipPolygon && Array.isArray(window.freehandClipPolygon) && window.freehandClipPolygon.length >= CLIP_MIN_VERTICES) {
      clipPolygon = window.freehandClipPolygon.slice();
      _rememberShape(clipPolygon);
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
  window.exitFreehandClipEdit = exitMode;
  window.isFreehandClipEditing = () => mode !== null;
  // Stato in sola lettura della modalita' (serve alla lente della Fetta 2 e
  // all'harness: niente scrittura, niente scorciatoie).
  window.getFreehandClipState = () => ({
    mode: mode,
    points: editPoints.map((p) => ({ x: p.x, y: p.y })),
    selected: selectedHandle,
    hover: hoverHandle,
    changed: sessionChanged,
    undoDepth: shapeUndo.length
  });
  window.setStrokeSizeCircleEnabled = (b) => { SHOW_STROKE_SIZE_CIRCLE = !!b; _redraw(true); };
  // Fetta 2C, SOLA LETTURA: com'e' fatto adesso l'anello dell'acquerello.
  // Serve all'harness e a chi volesse controllarlo dalla console. Non misura
  // niente da se': dice cosa c'e' in memoria.
  window.getWatercolorRingInfo = () => ({
    nominal: typeof currentWatercolorWidth !== "undefined" ? currentWatercolorWidth : null,
    measured: _wcDone ? _wcDone.dia : null,
    measuredWidth: _wcDone ? _wcDone.width : null,
    pending: !!_wcTimer
  });
  // P5: cancella il cerchio dimensione tratto (chiamato da freehandDrawing.js
  // quando si esce dalla modalita' disegno a mano libera, qualunque fosse lo
  // strumento attivo: penna, acquerello o gomma).
  window.clearFreehandStrokeCircle = () => { hoverPoint = null; _redraw(true); };
  // ════════════════════════════════════════════════════════════════
  //  AVVIO DI RISERVA — cantiere «La Bottega», 21 settembre 2026
  //  renderer.js accende questo modulo con un timer FISSO, contato da
  //  quando renderer.js stesso ha finito di caricarsi. Se in quel momento
  //  questo file non e' ancora arrivato (disco lento, antivirus, un file
  //  grosso caricato prima di lui), il timer salta e non riprova piu':
  //  il pulsante resta morto per tutta la sessione (trappola 206). Qui il
  //  modulo si accende da se', SOLO se il timer lo ha mancato.
  //  185 ms dopo DOMContentLoaded cade sempre DOPO il timer di renderer.js
  //  (che parte prima, a pagina ancora in caricamento) e PRIMA della lente
  //  e del timbro (200 ms): l'ordine degli ascoltatori resta quello di
  //  sempre — come col timer a 180 ms, dopo il pennello selezione e prima della lente e del timbro, che si agganciano agli stessi eventi.
  // ════════════════════════════════════════════════════════════════
  (function () {
    let tentativi = 0;
    function riserva() {
      if (_bound) return;
      if (typeof initFreehandTools !== "function") return;
      tentativi++;
      console.log("[freehandTools] avvio di riserva (il timer di renderer.js l'aveva mancato)");
      let ok = true;
      try {
        ok = initFreehandTools() !== false;
      } catch (e) {
        console.warn("[freehandTools] avvio di riserva fallito:", e);
      }
      if (!ok && !(_bound) && tentativi < 10) setTimeout(riserva, 200);
    }
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", () => setTimeout(riserva, 185));
    } else {
      setTimeout(riserva, 185);
    }
  })();
})();