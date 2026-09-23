// freehandClipLens.js — Mosaica Workspace Pro
// =====================================================================
//  LENTE / MIRINO DEL PERIMETRO DI CONTENIMENTO
//  (Fetta 2 del cantiere "Il perimetro e la lente")
//
//  A che serve. Il perimetro si usa per colorare le FUGHE fra le
//  tessere: i suoi vertici vanno appoggiati sugli spigoli delle tessere
//  di bordo, e a occhio nudo, a zoom normale, quegli spigoli sono due
//  pixel. Questa lente sta sotto la croce e ingrandisce quello che c'e'
//  intorno al punto di aggancio, con un reticolo a MILLIMETRI REALI che
//  fa da metro: "mirare a distanze volute da quello che e' dentro il
//  perimetro" (parole di Mirko, §1 del cantiere).
//
//  ⚠ IL REQUISITO CHE COMANDA TUTTO IL RESTO: il centro del reticolo e'
//  ESATTAMENTE il punto dove il click piazza la maniglia. Per questo il
//  centro non si calcola da clientX/clientY ma dal punto LOGICO di
//  canvas.getPointer() rimappato a schermo con il rettangolo vero
//  dell'upper-canvas: e' la funzione inversa esatta di getPointer, quindi
//  reticolo e maniglia cadono nello stesso posto per costruzione, non per
//  fortuna (vedi _screenMap).
//
//  ── PERCHE' LA LENTE RIDISEGNA INVECE DI INGRANDIRE I PIXEL ─────────
//  In Mosaica lo zoom e' una CSS transform sul #paper e il
//  viewportTransform di Fabric resta l'identita' (trappola 104). Il
//  backstore e' allocato alla "scala qualita'" (2 a zoom basso, fino a 5
//  col tetto dei 24 Mpx): copiare quei pixel e ingrandirli e' nitido
//  solo fino a un fattore qualita'/zoom, in pratica 1,3×-2×. Un mirino da
//  4-8× fatto cosi' viene una poltiglia. E toCanvasElement del canvas
//  principale e' avvolto da renderer.js con __cullOff = true, quindi
//  userlo costerebbe il ridisegno dell'A4 INTERO a ogni movimento del
//  mouse (trappola 105).
//
//  Quindi: mini-render nostro su una canvas DOM riusata (mai riallocata
//  se le misure non cambiano), con la trasformata a scala×ingrandimento,
//  e sopra SOLO gli oggetti il cui rettangolo d'ingombro tocca la
//  finestra della lente.
//
//  ── NITIDEZZA: I DUE TRUCCHI, E IL LIMITE CHE RESTA ─────────────────
//  1) objectCaching spento per la durata del mini-render: altrimenti
//     Fabric disegna la CACHE dell'oggetto, che e' un bitmap allocato a
//     zoom 1 × qualita', e ingrandirla 6× la sfoca. Spento, disegna i
//     vettori: tessere e tratti di penna restano nitidi a qualunque
//     ingrandimento.
//  2) clipPath tolto e rimesso: un oggetto con clipPath in Fabric 5 ha
//     needsItsOwnCache() === true e viene cachato SEMPRE, anche con
//     objectCaching a false. Il ritaglio lo rifacciamo noi con un
//     ctx.clip() sul poligono del perimetro (che e' in coordinate
//     canvas: absolutePositioned + viewport identita'), cosi' anche i
//     tratti ritagliati entrano nella lente da vettori.
//     ⚠ Salvataggio/ripristino in un try/finally per oggetto, nello
//     stesso tick e senza render del canvas principale nel mezzo.
//  3) Resta FUORI l'acquerello: e' un fabric.Image, un timbro raster
//     (trappola 111). Nella lente si ammorbidisce e non c'e' trucco che
//     lo eviti. Da dire prima del collaudo, non dopo.
//
//  ── L'ANELLO DI COMANDI ─────────────────────────────────────────────
//  Due slider (diametro della lente, ingrandimento interno) in stile
//  menu radiale, DOM come #radialMenu, che compaiono quando il puntatore
//  si FERMA. L'anello nasce ANCORATO dove e' comparso e non inseguve piu'
//  la lente: se inseguisse, gli slider scapperebbero col cursore e non si
//  prenderebbero mai (§4.5). La lente invece continua a seguire il
//  puntatore, cosi' il requisito del centro-reticolo vale sempre, anche
//  con l'anello aperto; quando il cursore esce dal canvas per andare
//  sugli slider i mouse:move finiscono e la lente resta dov'e' da sola:
//  il "congelamento" e' una conseguenza, non un pezzo di codice.
//
//  ── DOVE NON C'E' ───────────────────────────────────────────────────
//  Solo dentro la MODALITA' PERIMETRO (⬡). Non durante i tratti di penna
//  o acquerello: la lente nasce per appoggiare i vertici (§8.3). Niente
//  agganciamento automatico agli spigoli: se agganciasse da sola non
//  sarebbe piu' vero che "il centro del mirino e' dove il click piazza
//  la maniglia".
//
//  PERSISTENZA: acceso/spento, diametro e ingrandimento vivono in
//  userData/calibration.json via window.calibrationAPI.load/save, con
//  MERGE non distruttivo (lo schema e' quello della soglia del lazo in
//  lassoSelection.js). Scrittura su disco solo a fine trascinamento
//  dello slider (evento "change"), non ad ogni pixel ("input").
//
//  DIPENDENZE: legge lo stato del perimetro SOLO da
//  window.getFreehandClipState() (sola lettura, esposto dalla Fetta 1) e
//  non scrive niente in freehandTools.js. Usa window.mm2px per i
//  millimetri veri e window.flashToast per gli avvisi. Nessuno dei cinque
//  file protetti viene toccato.
//
//  Compatibile Fabric 5.1.0 → 5.3.0: usa solo object.render(),
//  object.aCoords / getBoundingRect, canvas.on, canvas.getPointer,
//  canvas.upperCanvasEl. Nessuna API cambiata nel mezzo.
//  <script> classico (no ES module).

(function () {
  "use strict";

  // ============================================================
  //  COSTANTI REGOLABILI
  // ============================================================
  // --- Misure della lente (px SCHERMO) ---
  const LENS_D_MIN = 90;              // diametro minimo
  const LENS_D_MAX = 460;             // diametro massimo
  const LENS_D_DEFAULT = 190;         // diametro di partenza
  const LENS_D_STEP = 2;
  // --- Ingrandimento interno (× rispetto a quello che si vede fuori) ---
  const LENS_MAG_MIN = 1.5;
  const LENS_MAG_MAX = 12;
  const LENS_MAG_DEFAULT = 4;
  // Lo slider lavora su decimi interi (15..120) perche' gli <input
  // type=range> con step frazionario arrotondano male su Windows.
  const MAG_SLIDER_K = 10;

  // --- Anello di comandi ---
  const RING_DWELL_MS = 420;          // quanto sta fermo il puntatore prima che l'anello compaia
  const RING_GAP_PX = 16;             // distanza dell'anello dal bordo della lente
  const RING_KEEP_PX = 90;            // oltre questo scostamento dall'ancora l'anello si chiude
  const RING_MARGIN_PX = 10;          // margine minimo dai bordi della finestra
  const SAVE_DEBOUNCE_MS = 450;       // ritardo di scrittura su calibration.json

  // --- Reticolo a millimetri reali ---
  // Passi ammessi in mm: si sceglie il piu' fitto che tenga i punti
  // almeno RETICLE_MIN_STEP_PX distanti a schermo.
  const RETICLE_MM_STEPS = [0.25, 0.5, 1, 2, 5, 10, 20, 50];
  const RETICLE_MIN_STEP_PX = 9;      // (px schermo) distanza minima fra due punti del reticolo
  const RETICLE_CENTER_GAP_PX = 5;    // (px schermo) buco della croce attorno al centro
  const RETICLE_DOT_R_PX = 1.2;       // (px schermo) punto del reticolo
  const RETICLE_DOT5_R_PX = 2.2;      // (px schermo) punto ogni 5 passi
  const RETICLE_TICK5_PX = 5;         // (px schermo) tacca ogni 5 passi
  const RETICLE_LABEL_MIN_PX = 34;    // (px schermo) spazio minimo per stampare la quota in mm
  const RETICLE_CROSS_W_PX = 1;       // (px schermo) spessore della croce
  const RETICLE_COLOR = "rgba(255,255,255,0.72)";
  const RETICLE_SHADOW = "rgba(0,0,0,0.45)";  // riga scura sotto: leggibile anche su carta bianca
  const RETICLE_LABEL_COLOR = "rgba(255,255,255,0.92)";
  const RETICLE_CENTER_COLOR = "rgba(0,200,255,0.98)";  // ciano, accento dell'app
  const RETICLE_CENTER_R_PX = 1.6;    // (px schermo) pallino esatto del punto di aggancio

  // --- Guida del perimetro DENTRO la lente (px SCHERMO) ---
  // Piu' sottile della guida grande: nella lente serve vedere lo spigolo
  // della tessera, non coprirlo.
  const LENS_GUIDE_LINE_W = 1.6;
  const LENS_GUIDE_DASH = [7, 4];
  const LENS_GUIDE_COLOR = "rgba(255,140,0,0.95)";    // identico alla Fetta 1
  const LENS_GUIDE_FILL = "rgba(255,160,40,0.08)";    // identico alla Fetta 1
  const LENS_HANDLE_R_PX = 5.0;
  const LENS_HANDLE_HOVER_R_PX = 6.4;
  const LENS_HANDLE_SEL_R_PX = 7.2;
  const LENS_HANDLE_SEL_COLOR = "rgba(0,200,255,0.98)";
  const LENS_FIRST_R_PX = 6.6;
  const LENS_FIRST_COLOR = "rgba(255,255,255,0.95)";

  // --- Bordo della lente ---
  const RIM_OUTER_W_PX = 3;
  const RIM_INNER_W_PX = 1.4;
  const RIM_OUTER_COLOR = "rgba(0,0,0,0.55)";
  const RIM_INNER_COLOR = "rgba(255,160,40,0.85)";

  const CLIP_MIN_VERTICES = 3;        // come in freehandTools.js

  // ============================================================
  //  STATO
  // ============================================================
  let enabled = true;                 // lente accesa? (persistito)
  let diameter = LENS_D_DEFAULT;      // px schermo (persistito)
  let mag = LENS_MAG_DEFAULT;         // × (persistito)

  let center = null;                  // {x,y} punto LOGICO di canvas sotto la croce
  let visible = false;                // la lente e' a schermo?
  let pointerDown = false;            // pulsante premuto sul canvas
  let ringAnchor = null;              // {x,y,r} in px schermo: dove l'anello e' comparso
  let dwellTimer = null;
  let saveTimer = null;
  let rafPending = false;             // un render e' gia' in coda per questo frame?
  let rendering = false;              // ⚠ guardia di rientranza (trappola 106)
  let bound = false;                  // listener gia' agganciati?
  let lastBackstore = { w: 0, h: 0 }; // per non riallocare la canvas ad ogni frame

  // Riferimenti DOM (risolti a init)
  let elLayer = null, elCanvas = null, elRing = null;
  let elSizeWrap = null, elMagWrap = null, elBtns = null;
  let elSize = null, elMag = null, elSizeVal = null, elMagVal = null, elOff = null;

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
  function _mmToPx(mm) {
    // px LOGICI di canvas per un millimetro reale: e' la calibrazione
    // dello schermo di Mosaica, la stessa con cui si misurano le tessere.
    try {
      if (typeof window.mm2px === "function") return window.mm2px(mm);
      if (typeof mm2px === "function") return mm2px(mm);
    } catch (e) {}
    return mm * 3.7795275591;  // 96 PPI nominali, ultimo ripiego
  }
  function _dpr() {
    const d = window.devicePixelRatio;
    return Number.isFinite(d) && d > 0 ? d : 1;
  }
  function _clamp(v, lo, hi) {
    return v < lo ? lo : (v > hi ? hi : v);
  }

  // Stato del perimetro, in sola lettura (API della Fetta 1).
  function _clipState() {
    try {
      if (typeof window.getFreehandClipState === "function") {
        const s = window.getFreehandClipState();
        if (s && typeof s === "object") return s;
      }
    } catch (e) {}
    return { mode: null, points: [], selected: -1, hover: -1 };
  }

  // ⚠ LA MAPPA CHE TIENE IN PIEDI IL REQUISITO DEL §4.4.
  // getPointer fa:  logico = (client - offset_upperCanvas) / scalaCSS
  // Qui facciamo l'inversa esatta leggendo il rettangolo VERO dell'upper
  // canvas (che getBoundingClientRect restituisce gia' trasformato dalla
  // CSS transform del #paper) e la scala come rapporto fra rettangolo e
  // dimensione logica. Cosi' non dipendiamo da view.scale ne' da come lo
  // zoom e' implementato: se un giorno cambiasse, la lente resterebbe
  // incollata al punto di aggancio.
  function _screenMap() {
    const c = _canvas();
    if (!c) return null;
    const el = c.upperCanvasEl || c.lowerCanvasEl;
    if (!el || typeof el.getBoundingClientRect !== "function") return null;
    const r = el.getBoundingClientRect();
    const w = (typeof c.getWidth === "function" ? c.getWidth() : c.width) || 0;
    const h = (typeof c.getHeight === "function" ? c.getHeight() : c.height) || 0;
    if (!(w > 0) || !(h > 0) || !(r.width > 0) || !(r.height > 0)) return null;
    const sx = r.width / w;
    const sy = r.height / h;
    return { left: r.left, top: r.top, s: (sx + sy) / 2, sx: sx, sy: sy };
  }

  // Rettangolo d'ingombro in coordinate FOGLIO, a buon mercato.
  // aCoords e' gia' in coordinate assolute (il viewport e' l'identita') e
  // Fabric lo tiene aggiornato con setCoords: quattro punti da leggere
  // invece di una matrice da ricalcolare. Con 2000+ tessere la differenza
  // fra le due strade e' tutta qui.
  function _aabb(o) {
    const a = o && o.aCoords;
    if (a && a.tl && a.tr && a.bl && a.br) {
      const xs = [a.tl.x, a.tr.x, a.bl.x, a.br.x];
      const ys = [a.tl.y, a.tr.y, a.bl.y, a.br.y];
      let l = xs[0], r = xs[0], t = ys[0], b = ys[0];
      for (let i = 1; i < 4; i++) {
        if (xs[i] < l) l = xs[i];
        if (xs[i] > r) r = xs[i];
        if (ys[i] < t) t = ys[i];
        if (ys[i] > b) b = ys[i];
      }
      if (Number.isFinite(l) && Number.isFinite(r) && Number.isFinite(t) && Number.isFinite(b)) {
        return { l: l, t: t, r: r, b: b };
      }
    }
    try {
      const bb = o.getBoundingRect(true, true);
      return { l: bb.left, t: bb.top, r: bb.left + bb.width, b: bb.top + bb.height };
    } catch (e) {}
    return null;
  }

  // Il poligono di un clipPath NOSTRO (il perimetro), o null.
  // In Mosaica il clipPath lo usa soltanto freehandTools.js, e sempre come
  // fabric.Polygon absolutePositioned: se troviamo altro, lo lasciamo
  // stare e quell'oggetto entrera' nella lente dalla sua cache.
  function _polyOfClipPath(cp) {
    if (!cp || cp.absolutePositioned !== true) return null;
    const pts = cp.points;
    if (!Array.isArray(pts) || pts.length < CLIP_MIN_VERTICES) return null;
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) return null;
    }
    return pts;
  }

  // ============================================================
  //  E' IL MOMENTO DI FARSI VEDERE?
  // ============================================================
  function isActive() {
    if (!enabled) return false;
    const st = _clipState();
    if (!st || !st.mode) return false;     // solo dentro la modalita' perimetro
    return true;
  }

  function _hide() {
    if (dwellTimer) { clearTimeout(dwellTimer); dwellTimer = null; }
    visible = false;
    center = null;
    _hideRing();
    if (elLayer) elLayer.setAttribute("aria-hidden", "true");
    document.body.classList.remove("clip-lens-on");
  }

  function _show() {
    if (elLayer) elLayer.setAttribute("aria-hidden", "false");
    // Il cursore di sistema sparisce: altrimenti la freccia (o la croce)
    // di Windows sta SOPRA il reticolo e non si capisce piu' quale dei due
    // segna il punto. La regola sta nel foglio di stile con !important
    // perche' Fabric riscrive cursor inline ad ogni hover: una regola di
    // stylesheet !important batte una dichiarazione inline normale, una
    // inline !important verrebbe invece sovrascritta da Fabric.
    document.body.classList.add("clip-lens-on");
    visible = true;
  }

  // ============================================================
  //  DISEGNO DELLA LENTE
  // ============================================================
  function requestRender() {
    if (rafPending) return;
    rafPending = true;
    const run = () => { rafPending = false; render(); };
    if (typeof window.requestAnimationFrame === "function") window.requestAnimationFrame(run);
    else setTimeout(run, 16);
  }

  function render() {
    // ⚠ Guardia di rientranza (trappola 106): la lente non passa da
    // renderCanvas, ma object.render puo' toccare cache e stati e non
    // vogliamo due passate sovrapposte per nessun motivo.
    if (rendering) return;
    if (!isActive() || !center || !elCanvas) { _hide(); return; }

    const c = _canvas();
    const map = _screenMap();
    if (!c || !map) { _hide(); return; }

    const dpr = _dpr();
    const R = diameter / 2;                 // raggio in px schermo
    const a = map.s * mag * dpr;            // contenuto-logico → px dispositivo
    if (!(a > 0) || !Number.isFinite(a)) { _hide(); return; }

    // Posizione a schermo del centro = inversa esatta di getPointer.
    const cxScreen = map.left + center.x * map.sx;
    const cyScreen = map.top + center.y * map.sy;

    // Riallocazione del backstore SOLO quando le misure cambiano davvero.
    const bw = Math.max(2, Math.round(diameter * dpr));
    if (lastBackstore.w !== bw || lastBackstore.h !== bw) {
      elCanvas.width = bw;
      elCanvas.height = bw;
      lastBackstore = { w: bw, h: bw };
    }
    elCanvas.style.width = diameter + "px";
    elCanvas.style.height = diameter + "px";
    elCanvas.style.left = Math.round(cxScreen - R) + "px";
    elCanvas.style.top = Math.round(cyScreen - R) + "px";

    const ctx = elCanvas.getContext("2d");
    if (!ctx) { _hide(); return; }

    rendering = true;
    const savedSkipOffscreen = c.skipOffscreen;
    try {
      _show();

      // Finestra di contenuto inquadrata dalla lente (coordinate foglio).
      const hw = R / (map.s * mag);
      const win = { x0: center.x - hw, x1: center.x + hw, y0: center.y - hw, y1: center.y + hw };

      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, bw, bw);

      // Tondo: tutto quello che segue sta dentro il vetro.
      ctx.save();
      ctx.beginPath();
      ctx.arc(bw / 2, bw / 2, bw / 2, 0, Math.PI * 2);
      ctx.clip();

      // 1) La carta. Il colore di fondo del canvas (bianco), poi gli
      //    oggetti: in Mosaica l'immagine di sfondo e la texture carta
      //    sono OGGETTI con __isBackground mandati in fondo, quindi
      //    entrano da soli nel giro normale, nell'ordine giusto.
      ctx.fillStyle = (c.backgroundColor && typeof c.backgroundColor === "string") ? c.backgroundColor : "#fff";
      ctx.fillRect(0, 0, bw, bw);

      // 2) Gli oggetti, in ordine-z, solo quelli che toccano la finestra.
      //    skipOffscreen spento per la durata: la sua risposta dipende da
      //    vptCoords, che qui non c'entra niente (e' la finestra del
      //    culling, non quella della lente).
      c.skipOffscreen = false;
      ctx.setTransform(a, 0, 0, a, bw / 2 - center.x * a, bw / 2 - center.y * a);
      _renderObjects(ctx, c, win);

      // 3) La guida del perimetro e le maniglie, ingrandite: senza queste,
      //    mentre tiri una maniglia guardi nel mirino e non vedi quello
      //    che stai tirando (§8.2).
      _paintGuide(ctx, map.s * mag);

      // 4) Il reticolo, in px schermo: i millimetri sono del FOGLIO, la
      //    loro distanza a schermo no.
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      _paintReticle(ctx, R, map.s * mag);

      ctx.restore();

      // 5) Il bordo, fuori dal ritaglio tondo cosi' non si taglia a meta'.
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      _paintRim(ctx, R);
    } catch (e) {
      console.warn("[freehandClipLens] render fallito:", e);
    } finally {
      c.skipOffscreen = savedSkipOffscreen;
      rendering = false;
    }
  }

  // --- Gli oggetti dentro la lente ------------------------------------
  function _renderObjects(ctx, c, win) {
    const objs = (c._objects && c._objects.length ? c._objects : (typeof c.getObjects === "function" ? c.getObjects() : null));
    if (!objs || !objs.length) return 0;
    let n = 0;
    for (let i = 0; i < objs.length; i++) {
      const o = objs[i];
      if (!o || o.visible === false) continue;
      const bb = _aabb(o);
      if (!bb) continue;
      if (bb.r < win.x0 || bb.l > win.x1 || bb.b < win.y0 || bb.t > win.y1) continue;
      _renderOne(ctx, o);
      n++;
    }
    return n;
  }

  // Un oggetto, disegnato a VETTORI e non dalla sua cache.
  function _renderOne(ctx, o) {
    const savedCaching = o.objectCaching;
    const savedDirty = o.dirty;
    const savedClip = o.clipPath;
    const poly = _polyOfClipPath(savedClip);
    let clipSwapped = false;

    ctx.save();
    try {
      if (poly) {
        // Il ritaglio del perimetro lo rifacciamo noi: il poligono e' in
        // coordinate canvas (absolutePositioned + viewport identita'),
        // che e' esattamente lo spazio in cui e' trasformato questo ctx.
        ctx.beginPath();
        ctx.moveTo(poly[0].x, poly[0].y);
        for (let i = 1; i < poly.length; i++) ctx.lineTo(poly[i].x, poly[i].y);
        ctx.closePath();
        ctx.clip();
        o.clipPath = null;
        clipSwapped = true;
      }
      o.objectCaching = false;
      if (typeof o.render === "function") o.render(ctx);
    } catch (e) {
      // Un oggetto che non si disegna non deve portarsi via la lente.
    } finally {
      o.objectCaching = savedCaching;
      if (clipSwapped) o.clipPath = savedClip;
      o.dirty = savedDirty;
      ctx.restore();
    }
  }

  // --- La guida del perimetro ------------------------------------------
  // k = px schermo per unita' logica dentro la lente. Gli spessori e i
  // raggi sono in px SCHERMO, quindi vanno divisi per k: e' lo stesso
  // mestiere di _screenK() in freehandTools.js, con la scala della lente
  // al posto di quella della vista.
  function _paintGuide(ctx, k) {
    const st = _clipState();
    const pts = Array.isArray(st.points) ? st.points : [];
    if (!pts.length) return;
    const u = 1 / Math.max(0.0001, k);
    const closed = st.mode === "handles";

    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    if (closed) ctx.closePath();
    else if (!pointerDown && center) ctx.lineTo(center.x, center.y);  // elastico fino alla croce

    if (pts.length >= CLIP_MIN_VERTICES) {
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
      ctx.closePath();
      ctx.fillStyle = LENS_GUIDE_FILL;
      ctx.fill();
      ctx.restore();
      // Il tracciato del contorno e' stato consumato dal fill: rifallo.
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
      if (closed) ctx.closePath();
      else if (!pointerDown && center) ctx.lineTo(center.x, center.y);
    }

    ctx.lineWidth = LENS_GUIDE_LINE_W * u;
    ctx.strokeStyle = LENS_GUIDE_COLOR;
    ctx.setLineDash([LENS_GUIDE_DASH[0] * u, LENS_GUIDE_DASH[1] * u]);
    ctx.stroke();
    ctx.setLineDash([]);

    // Le maniglie. Stessa grammatica di colori della Fetta 1: selezionata
    // ciano, 1° vertice bianco grosso in fase di tracciamento, le altre
    // arancioni come la guida.
    const firstIsTarget = st.mode === "draw";
    for (let i = 0; i < pts.length; i++) {
      const isFirst = firstIsTarget && i === 0;
      const isSel = i === st.selected;
      const isHover = i === st.hover;

      let r = LENS_HANDLE_R_PX;
      if (isFirst) r = LENS_FIRST_R_PX;
      if (isSel) r = LENS_HANDLE_SEL_R_PX;
      else if (isHover) r = LENS_HANDLE_HOVER_R_PX;

      let fill = LENS_GUIDE_COLOR;
      if (isFirst) fill = LENS_FIRST_COLOR;
      if (isSel) fill = LENS_HANDLE_SEL_COLOR;

      ctx.beginPath();
      ctx.arc(pts[i].x, pts[i].y, r * u, 0, Math.PI * 2);
      ctx.fillStyle = fill;
      ctx.fill();
      ctx.lineWidth = 1 * u;
      ctx.strokeStyle = isSel ? "rgba(255,255,255,0.95)" : LENS_GUIDE_COLOR;
      ctx.stroke();
    }
  }

  // --- Il reticolo a millimetri reali ----------------------------------
  // Scelta del passo: il piu' fitto che tenga i punti leggibili. A
  // ingrandimento basso i punti diventano ogni 2, 5, 10 mm; a
  // ingrandimento alto scendono a mezzo millimetro. Il metro resta vero
  // in tutti i casi, cambia solo la scansione.
  function pickStepMm(pxPerMm) {
    for (let i = 0; i < RETICLE_MM_STEPS.length; i++) {
      if (RETICLE_MM_STEPS[i] * pxPerMm >= RETICLE_MIN_STEP_PX) return RETICLE_MM_STEPS[i];
    }
    return RETICLE_MM_STEPS[RETICLE_MM_STEPS.length - 1];
  }

  function _paintReticle(ctx, R, k) {
    const pxPerMm = _mmToPx(1) * k;      // px schermo per millimetro reale
    const step = pickStepMm(pxPerMm);
    const d = step * pxPerMm;            // px schermo fra due punti
    const cx = R, cy = R;
    const gap = RETICLE_CENTER_GAP_PX;

    // La croce, due volte: prima scura e un filo piu' spessa, poi chiara.
    // Sulla carta bianca del mosaico una croce solo bianca non si vede.
    for (let pass = 0; pass < 2; pass++) {
      ctx.strokeStyle = pass === 0 ? RETICLE_SHADOW : RETICLE_COLOR;
      ctx.lineWidth = RETICLE_CROSS_W_PX + (pass === 0 ? 1.6 : 0);
      ctx.beginPath();
      ctx.moveTo(cx - R, cy); ctx.lineTo(cx - gap, cy);
      ctx.moveTo(cx + gap, cy); ctx.lineTo(cx + R, cy);
      ctx.moveTo(cx, cy - R); ctx.lineTo(cx, cy - gap);
      ctx.moveTo(cx, cy + gap); ctx.lineTo(cx, cy + R);
      ctx.stroke();
    }

    // I punti: sui due assi, ogni "step" mm. Il quinto e' piu' grosso e
    // porta una tacca; se c'e' spazio, anche la quota in mm.
    const labelOk = d * 5 >= RETICLE_LABEL_MIN_PX;
    ctx.font = "11px monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    for (let i = 1; i * d <= R - 2; i++) {
      const off = i * d;
      const five = (i % 5) === 0;
      const r = five ? RETICLE_DOT5_R_PX : RETICLE_DOT_R_PX;

      const spots = [
        { x: cx - off, y: cy, ax: "x" },
        { x: cx + off, y: cy, ax: "x" },
        { x: cx, y: cy - off, ax: "y" },
        { x: cx, y: cy + off, ax: "y" }
      ];
      for (let s = 0; s < spots.length; s++) {
        const p = spots[s];
        ctx.beginPath();
        ctx.arc(p.x, p.y, r + 0.7, 0, Math.PI * 2);
        ctx.fillStyle = RETICLE_SHADOW;
        ctx.fill();
        ctx.beginPath();
        ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
        ctx.fillStyle = RETICLE_COLOR;
        ctx.fill();

        if (five) {
          ctx.strokeStyle = RETICLE_COLOR;
          ctx.lineWidth = RETICLE_CROSS_W_PX;
          ctx.beginPath();
          if (p.ax === "x") {
            ctx.moveTo(p.x, p.y - RETICLE_TICK5_PX);
            ctx.lineTo(p.x, p.y + RETICLE_TICK5_PX);
          } else {
            ctx.moveTo(p.x - RETICLE_TICK5_PX, p.y);
            ctx.lineTo(p.x + RETICLE_TICK5_PX, p.y);
          }
          ctx.stroke();
        }
      }

      // Quote solo a destra e in basso: due numeri bastano a dare la
      // scala, quattro sporcano il vetro proprio dove si mira.
      if (five && labelOk) {
        const mmTxt = _fmtMm(i * step);
        if (cx + off + 16 <= 2 * R) _label(ctx, mmTxt, cx + off, cy - 12);
        if (cy + off + 16 <= 2 * R) _label(ctx, mmTxt, cx + 14, cy + off);
      }
    }

    // Il centro: il punto dove il click piazza la maniglia. E' l'ultimo
    // a essere disegnato perche' non deve essere coperto da niente.
    ctx.beginPath();
    ctx.arc(cx, cy, RETICLE_CENTER_R_PX + 1, 0, Math.PI * 2);
    ctx.fillStyle = RETICLE_SHADOW;
    ctx.fill();
    ctx.beginPath();
    ctx.arc(cx, cy, RETICLE_CENTER_R_PX, 0, Math.PI * 2);
    ctx.fillStyle = RETICLE_CENTER_COLOR;
    ctx.fill();
  }

  function _fmtMm(v) {
    const r = Math.round(v * 100) / 100;
    return (Math.abs(r - Math.round(r)) < 0.005 ? String(Math.round(r)) : String(r)) + "mm";
  }

  function _label(ctx, txt, x, y) {
    ctx.lineWidth = 3;
    ctx.strokeStyle = RETICLE_SHADOW;
    ctx.strokeText(txt, x, y);
    ctx.fillStyle = RETICLE_LABEL_COLOR;
    ctx.fillText(txt, x, y);
  }

  function _paintRim(ctx, R) {
    ctx.beginPath();
    ctx.arc(R, R, Math.max(1, R - RIM_OUTER_W_PX / 2), 0, Math.PI * 2);
    ctx.lineWidth = RIM_OUTER_W_PX;
    ctx.strokeStyle = RIM_OUTER_COLOR;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(R, R, Math.max(1, R - RIM_OUTER_W_PX - RIM_INNER_W_PX / 2), 0, Math.PI * 2);
    ctx.lineWidth = RIM_INNER_W_PX;
    ctx.strokeStyle = RIM_INNER_COLOR;
    ctx.stroke();
  }

  // ============================================================
  //  ANELLO DI COMANDI
  // ============================================================
  function _ringShown() {
    return !!(elRing && elRing.getAttribute("aria-hidden") === "false");
  }

  function _hideRing() {
    ringAnchor = null;
    if (elRing) elRing.setAttribute("aria-hidden", "true");
  }

  function _armDwell() {
    if (dwellTimer) clearTimeout(dwellTimer);
    dwellTimer = setTimeout(() => {
      dwellTimer = null;
      if (!isActive() || !visible || pointerDown) return;
      _showRing();
    }, RING_DWELL_MS);
  }

  // L'anello nasce ancorato dov'e' la lente ADESSO e non si muove piu':
  // e' la condizione perche' gli slider si possano prendere (§4.5).
  function _showRing() {
    if (!elRing || !center) return;
    const map = _screenMap();
    if (!map) return;
    const R = diameter / 2;
    const ax = map.left + center.x * map.sx;
    const ay = map.top + center.y * map.sy;
    ringAnchor = { x: ax, y: ay, r: R };

    _syncRingUI();
    elRing.setAttribute("aria-hidden", "false");
    _placeRing(ax, ay, R);
  }

  function _placeRing(ax, ay, R) {
    const W = window.innerWidth || 1280;
    const H = window.innerHeight || 800;
    const m = RING_MARGIN_PX;

    // Diametro sopra, ingrandimento sotto, pulsanti a destra: un anello
    // vero attorno al vetro, non un pannello appeso a un angolo.
    if (elSizeWrap) {
      const w = elSizeWrap.offsetWidth || 210;
      const h = elSizeWrap.offsetHeight || 30;
      let x = ax - w / 2;
      let y = ay - R - RING_GAP_PX - h;
      if (y < m) y = ay + R + RING_GAP_PX;                 // non ci sta sopra → sotto
      elSizeWrap.style.left = Math.round(_clamp(x, m, W - w - m)) + "px";
      elSizeWrap.style.top = Math.round(_clamp(y, m, H - h - m)) + "px";
    }
    if (elMagWrap) {
      const w = elMagWrap.offsetWidth || 210;
      const h = elMagWrap.offsetHeight || 30;
      let x = ax - w / 2;
      let y = ay + R + RING_GAP_PX;
      if (y + h > H - m) y = ay - R - RING_GAP_PX - h;     // non ci sta sotto → sopra
      elMagWrap.style.left = Math.round(_clamp(x, m, W - w - m)) + "px";
      elMagWrap.style.top = Math.round(_clamp(y, m, H - h - m)) + "px";
    }
    if (elBtns) {
      const w = elBtns.offsetWidth || 34;
      const h = elBtns.offsetHeight || 34;
      let x = ax + R + RING_GAP_PX;
      if (x + w > W - m) x = ax - R - RING_GAP_PX - w;     // non ci sta a destra → a sinistra
      elBtns.style.left = Math.round(_clamp(x, m, W - w - m)) + "px";
      elBtns.style.top = Math.round(_clamp(ay - h / 2, m, H - h - m)) + "px";
    }
  }

  function _syncRingUI() {
    if (elSize && Math.abs(parseFloat(elSize.value) - diameter) > 0.5) elSize.value = String(diameter);
    if (elMag) {
      const want = Math.round(mag * MAG_SLIDER_K);
      if (parseInt(elMag.value, 10) !== want) elMag.value = String(want);
    }
    if (elSizeVal) elSizeVal.textContent = Math.round(diameter) + " px";
    if (elMagVal) {
      const map = _screenMap();
      const k = (map ? map.s : 1) * mag;
      const step = pickStepMm(_mmToPx(1) * k);
      elMagVal.textContent = "×" + mag.toFixed(1) + " · " + _fmtMm(step);
    }
  }

  // ============================================================
  //  IMPOSTAZIONI + PERSISTENZA (calibration.json, merge non distruttivo)
  // ============================================================
  function setDiameter(v, opts) {
    const n = _clamp(Number(v), LENS_D_MIN, LENS_D_MAX);
    if (!Number.isFinite(n)) return diameter;
    diameter = Math.round(n / LENS_D_STEP) * LENS_D_STEP;
    _syncRingUI();
    if (ringAnchor) _placeRing(ringAnchor.x, ringAnchor.y, diameter / 2);
    requestRender();
    if (!opts || opts.persist !== false) _saveSettings();
    return diameter;
  }

  function setMag(v, opts) {
    const n = _clamp(Number(v), LENS_MAG_MIN, LENS_MAG_MAX);
    if (!Number.isFinite(n)) return mag;
    mag = Math.round(n * MAG_SLIDER_K) / MAG_SLIDER_K;
    _syncRingUI();
    requestRender();
    if (!opts || opts.persist !== false) _saveSettings();
    return mag;
  }

  function setEnabled(on, opts) {
    const next = !!on;
    const changed = next !== enabled;
    enabled = next;
    if (!enabled) _hide();
    else requestRender();
    if (changed && !(opts && opts.silent)) {
      _toast(enabled
        ? _t("freehandClip.lens.on", "🔍 Lente mirino accesa — L per spegnerla")
        : _t("freehandClip.lens.off", "🔍 Lente mirino spenta — L per riaccenderla"));
    }
    if (!opts || opts.persist !== false) _saveSettings();
    return enabled;
  }

  async function _loadSettings() {
    if (!window.calibrationAPI || typeof window.calibrationAPI.load !== "function") return;
    try {
      const data = await window.calibrationAPI.load();
      if (!data || typeof data !== "object") return;
      if (typeof data.freehandClipLensEnabled === "boolean") enabled = data.freehandClipLensEnabled;
      const d = data.freehandClipLensDiameterPx;
      if (typeof d === "number" && d >= LENS_D_MIN && d <= LENS_D_MAX) diameter = d;
      const m = data.freehandClipLensMag;
      if (typeof m === "number" && m >= LENS_MAG_MIN && m <= LENS_MAG_MAX) mag = m;
      _syncRingUI();
    } catch (err) {
      console.warn("[freehandClipLens] load impostazioni fallito:", err);
    }
  }

  // MERGE non distruttivo: load → sovrascrivi solo le chiavi nostre →
  // save. Senza questo si cancellerebbe calibrationFactor (renderer.js) o
  // lassoContainmentThreshold (lassoSelection.js). Stesso schema loro.
  async function _saveNow() {
    if (!window.calibrationAPI || typeof window.calibrationAPI.save !== "function") return;
    let payload = {};
    if (typeof window.calibrationAPI.load === "function") {
      try { payload = (await window.calibrationAPI.load()) || {}; } catch (e) { payload = {}; }
    }
    payload.freehandClipLensEnabled = enabled;
    payload.freehandClipLensDiameterPx = diameter;
    payload.freehandClipLensMag = mag;
    try {
      await window.calibrationAPI.save(payload);
    } catch (err) {
      console.warn("[freehandClipLens] save impostazioni fallito:", err);
    }
  }

  function _saveSettings() {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => { saveTimer = null; _saveNow(); }, SAVE_DEBOUNCE_MS);
  }

  // ============================================================
  //  EVENTI
  // ============================================================
  function onMouseMove(opt) {
    if (!isActive()) { if (visible) _hide(); return; }
    const c = _canvas();
    if (!c) return;
    const e = opt && opt.e;
    // ⚠ Il punto viene da getPointer, come quello che onMouseUp di
    // freehandTools.js usa per piazzare il vertice: e' la stessa
    // sorgente, quindi il centro del reticolo e il vertice non possono
    // divergere.
    let p;
    try { p = c.getPointer(e); } catch (err) { return; }
    if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) return;
    center = { x: p.x, y: p.y };

    // L'anello ancorato resta dov'e' finche' il cursore gira nei suoi
    // paraggi; appena ci si allontana si chiude e ricomparira' al
    // prossimo fermo.
    if (_ringShown() && ringAnchor) {
      const map = _screenMap();
      if (map) {
        const sx = map.left + p.x * map.sx;
        const sy = map.top + p.y * map.sy;
        const dx = sx - ringAnchor.x, dy = sy - ringAnchor.y;
        if (Math.sqrt(dx * dx + dy * dy) > ringAnchor.r + RING_KEEP_PX) _hideRing();
      }
    } else if (!pointerDown) {
      _armDwell();
    }

    requestRender();
  }

  function onMouseDown(opt) {
    if (!isActive()) return;
    const e = opt && opt.e;
    if (e && typeof e.button === "number" && e.button !== 0) return;
    pointerDown = true;
    if (dwellTimer) { clearTimeout(dwellTimer); dwellTimer = null; }
    _hideRing();       // si sta piazzando un punto: via i comandi di mezzo
    requestRender();
  }

  function onMouseUp() {
    pointerDown = false;
    if (isActive()) { _armDwell(); requestRender(); }
  }

  function onAfterRender() {
    // Il canvas ha ridisegnato (zoom, pan, annulla, commit del perimetro):
    // il contenuto della lente e' cambiato sotto. Non chiamiamo niente che
    // passi da renderCanvas — la lente ha la sua canvas DOM — quindi qui
    // non c'e' ricorsione possibile; la guardia di render() e' comunque il
    // secondo giro di chiave.
    if (isActive() && visible && center) requestRender();
  }

  function onCanvasLeave() {
    // Fuori dal canvas: se l'anello e' aperto il cursore sta probabilmente
    // andando sugli slider, e la lente deve restare dov'e' (congelata). Se
    // l'anello e' chiuso, la lente non ha piu' niente da inquadrare.
    if (_ringShown()) return;
    _hide();
  }

  function onKeyDown(e) {
    if (!e) return;
    const st = _clipState();
    if (!st || !st.mode) return;              // la L e' nostra solo dentro la modalita'
    const ae = document.activeElement;
    const tag = ae && ae.tagName ? ae.tagName.toUpperCase() : "";
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || (ae && ae.isContentEditable)) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    // e.code: la lettera fisica, uguale su tastiera italiana e inglese.
    const isL = e.code === "KeyL" || (!e.code && (e.key === "l" || e.key === "L"));
    if (!isL) return;
    e.preventDefault();
    e.stopPropagation();
    setEnabled(!enabled);
  }

  // Il pulsante ⬡ prende e perde la classe "active" quando la modalita'
  // si apre e si chiude (lo fa freehandTools.js). Guardare quella classe
  // e' il modo esatto di sapere quando la lente deve sparire, senza
  // toccare freehandTools.js e senza un timer che gira sempre.
  function _watchModeButton() {
    const btn = document.getElementById("freehandClipBtn");
    if (!btn || typeof window.MutationObserver !== "function") return null;
    const obs = new window.MutationObserver(() => {
      if (!isActive()) _hide();
    });
    obs.observe(btn, { attributes: true, attributeFilter: ["class"] });
    return obs;
  }

  function _wireRing() {
    if (elSize) {
      // input = applicazione live e zero scritture su disco; change = una
      // sola scrittura a fine trascinamento. Schema del lazo.
      elSize.addEventListener("input", () => setDiameter(elSize.value, { persist: false }));
      elSize.addEventListener("change", () => setDiameter(elSize.value, { persist: true }));
    }
    if (elMag) {
      elMag.addEventListener("input", () => setMag(parseInt(elMag.value, 10) / MAG_SLIDER_K, { persist: false }));
      elMag.addEventListener("change", () => setMag(parseInt(elMag.value, 10) / MAG_SLIDER_K, { persist: true }));
    }
    if (elOff) {
      elOff.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        setEnabled(false);
      });
    }
    // Mentre il puntatore sta sull'anello la lente non si tocca: nessun
    // mouse:move arriva dal canvas, quindi resta congelata da sola.
    if (elRing) {
      elRing.addEventListener("mousedown", (e) => e.stopPropagation());
    }
  }

  // ============================================================
  //  INIT
  // ============================================================
  function initFreehandClipLens() {
    elLayer = document.getElementById("clipLensLayer");
    elCanvas = document.getElementById("clipLensCanvas");
    elRing = document.getElementById("clipLensRing");
    elSizeWrap = document.getElementById("clipLensSizeWrap");
    elMagWrap = document.getElementById("clipLensMagWrap");
    elBtns = document.getElementById("clipLensBtns");
    elSize = document.getElementById("clipLensSize");
    elMag = document.getElementById("clipLensMag");
    elSizeVal = document.getElementById("clipLensSizeVal");
    elMagVal = document.getElementById("clipLensMagVal");
    elOff = document.getElementById("clipLensOff");

    if (!elLayer || !elCanvas) {
      console.warn("[freehandClipLens] markup della lente assente in index.html");
      return false;
    }

    const c = _canvas();
    if (!c || typeof c.on !== "function") {
      console.warn("[freehandClipLens] canvas non pronto");
      return false;
    }

    if (!bound) {
      c.on("mouse:move", onMouseMove);
      c.on("mouse:down", onMouseDown);
      c.on("mouse:up", onMouseUp);
      c.on("after:render", onAfterRender);
      const upper = c.upperCanvasEl;
      if (upper && !upper.__clipLensLeaveBound) {
        upper.__clipLensLeaveBound = true;
        upper.addEventListener("mouseleave", onCanvasLeave);
      }
      document.addEventListener("keydown", onKeyDown, true);  // capture, come il resto
      window.addEventListener("resize", () => { if (visible) { _hideRing(); requestRender(); } });
      _wireRing();
      _watchModeButton();
      bound = true;
    }

    if (elSize) {
      elSize.min = String(LENS_D_MIN);
      elSize.max = String(LENS_D_MAX);
      elSize.step = String(LENS_D_STEP);
    }
    if (elMag) {
      elMag.min = String(Math.round(LENS_MAG_MIN * MAG_SLIDER_K));
      elMag.max = String(Math.round(LENS_MAG_MAX * MAG_SLIDER_K));
      elMag.step = "1";
    }
    _syncRingUI();
    _loadSettings();

    console.log("[freehandClipLens] inizializzato");
    return true;
  }

  // Auto-avvio: renderer.js non si tocca, quindi il modulo si accende da
  // se'. Qualche tentativo a distanza perche' il canvas nasce dentro un
  // setTimeout di renderer.js.
  function _boot() {
    let tries = 0;
    const tick = () => {
      tries++;
      if (initFreehandClipLens()) return;
      if (tries < 25) setTimeout(tick, 200);
    };
    setTimeout(tick, 200);
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", _boot);
  } else {
    _boot();
  }

  // ============================================================
  //  ESPOSIZIONI GLOBALI
  // ============================================================
  window.initFreehandClipLens = initFreehandClipLens;
  window.freehandClipLens = {
    isEnabled: () => enabled,
    setEnabled: setEnabled,
    isActive: isActive,
    isVisible: () => visible,
    getDiameter: () => diameter,
    setDiameter: setDiameter,
    getMag: () => mag,
    setMag: setMag,
    getCenter: () => (center ? { x: center.x, y: center.y } : null),
    isRingShown: _ringShown,
    // Solo per l'harness e per tararla dalla console: niente di questo
    // serve all'applicazione.
    _render: render,
    _screenMap: _screenMap,
    _pickStepMm: pickStepMm,
    _aabb: _aabb,
    _limits: () => ({
      dMin: LENS_D_MIN, dMax: LENS_D_MAX, magMin: LENS_MAG_MIN, magMax: LENS_MAG_MAX,
      dwellMs: RING_DWELL_MS, keepPx: RING_KEEP_PX
    })
  };
})();