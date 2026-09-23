// ====================== cloneStampBrush.js ======================
//  PENNELLO TIMBRO (clone) — Cantiere "Il Pennello Timbro", Fetta 1
//
//  Copia una porzione dello SFONDO (immagine dell'utente o carta) e la
//  ridipinge dove l'utente passa il pennello. Serve a portarsi la carta,
//  la venatura o un pezzo d'immagine dentro le fughe e sulle zone da
//  raccordare, senza uscire da Mosaica e senza perdere i millimetri.
//
//  COSA C'E' IN QUESTA FETTA (§6 del cantiere)
//    • la lastra dello sfondo (campionamento fuori schermo)
//    • Ctrl+Click per prendere la sorgente (§5, strada (a))
//    • la pennellata che nasce come UN fabric.Image con data.mwpStamp
//    • l'avviso quando non c'e' niente da copiare (§4.7)
//    • la quarta fascia dei livelli sta in freehandDrawing.js, non qui
//
//  AGGIUNTO CON LA FETTA 2A (i riferimenti visivi)
//    • la geometria della sorgente diventa UNA SOLA: _tipLogicalPx() e
//      _sourceForPoint() in fondo al modulo. Le usa il pennello per
//      campionare e le legge l'overlay di freehandTools.js per disegnare
//      i due anelli tratteggiati: cosi' l'anello non puo' dire una cosa
//      e la copia farne un'altra (§4.3)
//    • il pennello diventa a PIENA RESA (needsFullRender): l'anteprima
//      del tratto la ridisegna lui a ogni movimento, dall'accumulo, e
//      freehandTools.js ci sovrappone gli anelli senza lasciare scie
//
//  AGGIUNTO CON LA FETTA 2B (i comandi nell'inspector)
//    • la sezione "timbro" dell'inspector: DIMENSIONE (un comando solo,
//      §4.2) e DISTANZA con il segno (a sinistra del centro = sorgente a
//      sinistra), in mm reali, salvate in calibration.json
//    • il modello della sorgente deciso da Mirko al collaudo della 2A
//      (15/09/2026): una sorgente SCELTA e' FISSA e non segue il
//      pennello; la sorgente segue la punta solo se non se n'e' scelta
//      una (§4.1-bis). Ctrl+Click e il contagocce la scelgono e mettono
//      l'interruttore su "Fissa"; "Agganciata" la libera
//    • il pulsante "prendi sorgente" (§4.6): il contagocce. Mentre e'
//      armato la sorgente E' la punta, cosi' l'anello della sorgente si
//      posa su quello della punta e dice onestamente "il click prende da
//      qui". Esc (o un secondo click sul pulsante) lo disarma
//    • il rifiuto col lazo e col pennello selezione, come il perimetro
//
//  AGGIUNTO CON LA FETTA 3 (i colori)
//    • la lastra si compone sul BIANCO DEL FOGLIO: il timbro copia lo
//      sfondo COME SI VEDE. Prima copiava la sola carta, che in Mosaica e'
//      un oggetto al 22% di opacita': le impronte, semitrasparenti, si
//      sommavano e la copia usciva piu' scura dell'originale e a chiazze.
//      Decisione di Mirko del 16/09/2026 (trappola 151)
//    • luminosita', tono, trasparenza e le cinque modalita' colore
//      (normali, scala di grigi, invertiti, negativo, CMY con la lastra
//      scelta), nell'inspector. Ordine: modalita' → tono → luminosita'
//      (§4.5-bis). I colori valgono per i tratti dipinti da quel momento
//      e NON si salvano: al riavvio si riparte dai colori originali
//    • con i colori neutri il calcolo si salta: il pennello fa
//      esattamente quello che faceva prima
//
//  AGGIUNTO CON LA FETTA 3-BIS (la lista dei tratti)
//    • nella lista dei tratti (📋 elimina / esporta) il timbro ha la sua
//      MINIATURA (l'immagine del tratto, non piu' una riga nera) e la sua
//      ETICHETTA "(timbro)". Tutto da qui, avvolgendo createFreehandPreview
//      di renderer.js: vedi "LA LISTA DEI TRATTI" piu' sotto
//    • i difetti dell'acquerello della stessa fetta stanno in gpuWorker.js,
//      watercolorStampBrush.js e freehandTools.js, non qui
//
//  AGGIUNTO CON LA FETTA 4A-1 (la velocita', la spaziatura, l'angolo)
//    • la FIRMA DELLA LASTRA non rilegge piu' l'immagine di sfondo: in
//      Mosaica la sua "src" e' l'immagine intera scritta in testo (un
//      JPEG da 12 MB sono 16 milioni di caratteri) e la si passava tutta
//      a OGNI impronta: 117 ms per impronta, misurati. Ora la chiave di
//      un'immagine costa un'occhiata (trappola 165)
//    • il timbro lavora in un WORKER, come l'acquerello: la lastra gli
//      arriva una volta sola, le impronte a pacchetti una volta per
//      fotogramma, l'anteprima torna ritagliata e si posa su una TELA
//      SUA, fra il foglio e lo strato degli anelli. Il worker nasce da
//      questo stesso file: stampOnto e colorizePixels sono le stesse del
//      percorso di riserva, non una copia
//    • il tratto finito arriva gia' codificato in PNG, UNA volta sola:
//      le fotografie dell'annulla e il salvataggio automatico non lo
//      ricodificano piu' (trappola 166)
//    • il tratto si mette al suo livello PRIMA della fotografia
//      dell'annulla, non un fotogramma dopo (trappola 167)
//    • la punta e' una MASCHERA riempita sul pezzo, non un clip: nel
//      worker Chromium non sfuma i clip. Cambia solo la sfumatura del
//      bordo, in una fascia di un pixel di lastra (trappola 169)
//    • SPAZIATURA delle impronte (come l'acquerello) e ANGOLO della
//      sorgente agganciata (±90°, + = verso l'alto), salvati
//
//  AGGIUNTO CON LA FETTA 4A-2 (le forme della punta e la forma libera)
//    • la punta non e' piu' solo tonda: QUADRATA, RETTANGOLARE,
//      TRIANGOLARE (di partenza equilatera), OVALE e LIBERA, disegnata
//      nel costruttore della palladiana con «Usa come punta». La
//      Dimensione resta UN comando solo e vale la LARGHEZZA (per la
//      forma libera, il lato maggiore); una PROPORZIONE regola l'altezza
//      di rettangolo, ovale e triangolo, e ogni forma ricorda la sua
//    • «SEGUE IL TRATTO» (acceso di partenza) piu' uno slider ROTAZIONE
//      che si somma: + in senso orario, come la rotazione delle tessere
//      e la «Rotaz. iniz.» dell'acquerello. Con la punta che segue il
//      tratto la prima impronta ASPETTA che la mano dica la direzione,
//      come le punte piatte dell'acquerello, e cade dove si e' premuto
//    • IL PEZZO COPIATO NON RUOTA MAI: ruota la MASCHERA. Il pezzo e' il
//      quadrato che contiene la forma girata, cosi' la sua misura non
//      cambia mentre la punta gira e la tela di lavoro non si rialloca
//      a ogni impronta (trappola 168, prova C9)
//    • con la punta TONDA tutto resta identico alla Fetta 4A-1, pixel
//      per pixel: stessa scatola, stessa maschera, nessuna attesa
//    • la GEOMETRIA DELLA PUNTA sta in un posto solo (tipTrace, tipBox,
//      tipVertices, tipReach): la usano la maschera delle impronte, il
//      worker (che le riceve come testo) e gli anelli di
//      freehandTools.js. L'anello non puo' mentire sul pezzo copiato
//
//  COSA NON C'E' ANCORA, E DOVE ARRIVERA'
//    • Fetta 4B: le due guide utente
//
//  QUESTO FILE NON SCRIVE NIENTE NEI FILE DEL CANVAS: renderer.js,
//  mouseObserver.js, keyboardShortcuts.js, svgExport.js.
//  (Nella Fetta 3-bis Mirko ha deciso di cambiare UN blocco di renderer.js,
//  l'opacita' degli acquerelli nell'SVG dei tratti: non riguarda il timbro.)
//  Tutto quello che serve da renderer.js si legge per NOME LESSICALE
//  (canvas, mm2px, view, flashToast, pushState, isAltPanning): sono
//  dichiarazioni di primo livello di uno <script> classico, quindi
//  visibili da qui perche' questo file e' caricato dopo.
//
//  Compatibilita': Fabric 5.1.0 → 5.3.0. Provato su tutte e tre.
// ================================================================

(function () {
  "use strict";

  // ════════════════════════════════════════════════════════════════
  //  VALORI DI PARTENZA E LIMITI
  //  Sono i valori iniziali dei due comandi dell'inspector (Fetta 2B):
  //  la DIMENSIONE (un comando solo, muove punta e sorgente insieme —
  //  §4.2) e la DISTANZA della sorgente agganciata (§4.1). Decisi da
  //  Mirko il 12/09/2026. Quello che l'utente sceglie poi si salva in
  //  calibration.json e al riavvio vince sui default.
  // ════════════════════════════════════════════════════════════════
  const TIP_MM_DEFAULT = 12;   // diametro della punta, in mm reali
  const DIST_MM_DEFAULT = 20;  // sorgente a 20 mm a SINISTRA della punta

  // Dimensione: gli stessi limiti del pennello selezione
  // (lassoBrushSelection.js), che e' l'altro pennello in mm di Mosaica.
  const TIP_MM_MIN = 1;
  const TIP_MM_MAX = 60;

  // Distanza CON IL SEGNO, in orizzontale: negativo = sorgente a
  // SINISTRA della punta, positivo = a DESTRA. E' lo scostamento x vero,
  // cosi' la manopola dello slider sta dalla stessa parte della sorgente.
  // ⚠ Il segno serve: con la sola sinistra, la striscia sinistra del
  //   foglio (distanza + raggio, ~26 mm coi default) non si potrebbe
  //   dipingere con la sorgente agganciata, perche' la sorgente cadrebbe
  //   fuori dal foglio.
  const OFFSET_X_MM_MIN = -100;
  const OFFSET_X_MM_MAX = 100;

  // Scrittura su calibration.json: stesso ritardo della lente.
  const SAVE_DEBOUNCE_MS = 450;

  // Cursori: quello del pennello, e quello del contagocce armato.
  const PAINT_CURSOR = "crosshair";
  const PICK_CURSOR = "copy";

  // Risoluzione della lastra: px di lastra per ogni px logico del foglio.
  // A 2 la copia resta nitida quando si zooma, e l'A4 costa ~14 MB una
  // volta sola (trappola 122). NON e' la qualita' del canvas, che in
  // Mosaica cambia con lo zoom: la lastra e' volutamente stabile.
  const SLAB_SCALE = 2;

  // SPAZIATURA (Fetta 4A-1): il passo fra due impronte, in frazioni della
  // punta. Piu' basso = tratto piu' continuo e piu' impronte da disegnare;
  // sopra 1 le impronte si staccano. Il valore di partenza 0,25 e'
  // quello cablato fino alla Fetta 3-bis: chi non tocca lo slider ha le
  // impronte negli stessi punti di prima.
  const SPACING_DEFAULT = 0.25;
  const SPACING_MIN = 0.05;
  const SPACING_MAX = 2;

  // ANGOLO della sorgente agganciata (Fetta 4A-1), in gradi, rispetto
  // all'orizzontale della punta. + = VERSO L'ALTO, sia con la sorgente a
  // sinistra sia a destra; a ±90° la sorgente sta sopra o sotto la punta.
  const ANGLE_DEFAULT = 0;
  const ANGLE_MIN = -90;
  const ANGLE_MAX = 90;

  // Anteprima dal worker: al massimo una ogni 16 ms, come gpuWorker.js.
  const PREVIEW_THROTTLE_MS = 16;

  // ── LE FORME DELLA PUNTA (Fetta 4A-2) ─────────────────────────────
  // "round" e' quella di sempre, e resta la punta di partenza: con lei
  // il pennello fa esattamente quello che faceva nella 4A-1.
  // "custom" e' la forma libera disegnata nel costruttore della
  // palladiana: si puo' scegliere solo quando ce n'e' una.
  const TIP_SHAPES = ["round", "square", "rect", "tri", "oval", "custom"];
  const TIP_SHAPE_DEFAULT = "round";

  // Le forme che hanno una PROPORZIONE (altezza = larghezza x proporzione).
  // Ognuna ricorda la sua: il triangolo parte EQUILATERO (sqrt(3)/2), il
  // rettangolo e l'ovale a meta' della larghezza.
  const RATIO_SHAPES = ["rect", "oval", "tri"];
  const RATIO_DEFAULTS = { rect: 0.5, oval: 0.5, tri: Math.sqrt(3) / 2 };
  const RATIO_MIN = 0.1;
  const RATIO_MAX = 2;

  // ROTAZIONE della punta, in gradi: + = SENSO ORARIO, come la rotazione
  // delle tessere e la «Rotaz. iniz.» dell'acquerello (deciso da Mirko il
  // 22/09/2026). Si somma alla direzione del tratto, quando la punta la segue.
  const ROTATION_MIN = -180;
  const ROTATION_MAX = 180;
  const ROTATION_DEFAULT = 0;

  // «Segue il tratto»: acceso di partenza.
  const FOLLOW_DEFAULT = true;

  // Quanto deve muoversi la mano perche' il tratto abbia una direzione: un
  // quarto della larghezza della punta, e comunque qualche pixel. Sotto
  // questa soglia il tremolio della mano farebbe girare una punta a spigoli
  // vivi e il bordo uscirebbe frastagliato.
  const DIR_MIN_FRACTION = 0.25;
  const DIR_MIN_PX = 4;
  // Lo smussamento della direzione: la stessa legge delle punte piatte
  // dell'acquerello (smoothAngleRad di watercolorStampBrush.js, con la sua
  // reattivita' di inizio tratto).
  const DIR_SMOOTH_BASE = 0.28;

  // La forma libera: quanti pezzi per ogni curva quando la si spiana (per
  // area, baricentro e raggi), e quanti comandi si accettano al massimo.
  const CUSTOM_FLATTEN = 8;
  const CUSTOM_MAX_CMDS = 4000;
  // Meno di due decimi di millimetro sul lato maggiore non e' una punta.
  const CUSTOM_MIN_MM = 0.2;

  // ── I COLORI (Fetta 3, §4.5 e §4.5-bis del cantiere) ──────────────
  // Tre cursori e un menu. Tutti partono NEUTRI: con i valori di partenza
  // il tratto e' la copia esatta dello sfondo, e il calcolo si salta.
  const BRIGHTNESS_MIN = -100;      // somma sui tre canali: ±100 = ±255
  const BRIGHTNESS_MAX = 100;
  const HUE_MIN = -180;             // rotazione della tinta, in gradi
  const HUE_MAX = 180;
  const TRANSPARENCY_MIN = 0;       // % — opacity dell'oggetto tratto
  // ⚠ Non 100: un tratto trasparente al 100% e' invisibile ma finisce
  //   lo stesso nella cronologia e nel cestino, e sembrerebbe un pennello
  //   rotto. A 90 il tratto si vede ancora.
  const TRANSPARENCY_MAX = 90;
  const COLOR_MODES = ["normal", "grayscale", "invert", "negative", "cmy"];
  const CMY_CHANNELS = ["c", "m", "y"];

  // Luminanza BT.709 sui valori del file (sRGB, senza linearizzare):
  // gli stessi pesi della scala di grigi "luminosity" di Fabric.
  const LUMA_R = 0.2126;
  const LUMA_G = 0.7152;
  const LUMA_B = 0.0722;

  // ── Stato del modulo ──────────────────────────────────────────
  let stampMode = false;            // il Pennello Timbro e' in mano?
  let tipMM = TIP_MM_DEFAULT;       // diametro punta (= lato della sorgente)
  let offsetXMM = -DIST_MM_DEFAULT; // distanza della sorgente agganciata (con segno)
  let angleDeg = ANGLE_DEFAULT;     // angolo della sorgente agganciata (+ = in alto)
  let spacing = SPACING_DEFAULT;    // passo fra le impronte, in frazioni di punta
  let anchored = true;              // agganciata (default) / fissa
  let tipShape = TIP_SHAPE_DEFAULT; // forma della punta (Fetta 4A-2)
  let tipRatios = {                 // proporzione ricordata forma per forma
    rect: RATIO_DEFAULTS.rect,
    oval: RATIO_DEFAULTS.oval,
    tri: RATIO_DEFAULTS.tri
  };
  let tipRotationDeg = ROTATION_DEFAULT;  // rotazione della punta (+ = orario)
  let tipFollow = FOLLOW_DEFAULT;   // la punta segue il tratto?
  let customTip = null;             // la forma libera: { cmds, pts, poly, rN, sizeMM }
  let _liveDirRad = null;           // direzione del tratto in corso (null = nessuna)
  let fixedSource = null;           // la sorgente scelta, coord. logiche
  let pickArmed = false;            // contagocce armato ("prendi sorgente" o "Fissa")
  let saveTimer = null;             // ritardo di scrittura su calibration.json

  // I colori (Fetta 3). NON si salvano: sono una scelta del momento, e
  // un timbro che al riavvio copiasse in grigio senza dirlo sarebbe
  // peggio di un comando da reimpostare.
  let brightness = 0;               // −100…+100
  let hue = 0;                      // −180…+180 gradi
  let transparency = 0;             // 0…90 %
  let colorMode = "normal";         // una di COLOR_MODES
  let cmyChannel = "c";             // la lastra tenuta in modalita' CMY

  // ⚠ INVARIANTE (Fetta 2B): "fissa" vuol dire "c'e' una sorgente scelta".
  //   anchored === false  ⇔  fixedSource !== null
  //   con UNA sola eccezione transitoria: il contagocce armato dal
  //   pulsante "Fissa", finche' l'utente non clicca il pezzo. Se lo
  //   annulla, si torna ad agganciata (disarmPick). Nessun'altra via
  //   lascia la fissa senza sorgente: e' questo che rende impossibile la
  //   sorgente che "segue il pennello" pur essendo fissa.

  // ════════════════════════════════════════════════════════════════
  //  PONTI VERSO renderer.js
  //  Tutto per nome lessicale, con ripiego su window: mai una copia,
  //  mai una riga scritta dentro i file protetti.
  // ════════════════════════════════════════════════════════════════
  function _c() {
    try { if (typeof canvas !== "undefined" && canvas) return canvas; } catch (e) {}
    return (typeof window !== "undefined" && window.canvas) || null;
  }

  function _mm2px(mm) {
    try { if (typeof mm2px === "function") return mm2px(mm); } catch (e) {}
    if (typeof window.mm2px === "function") return window.mm2px(mm);
    return mm * (96 / 25.4);  // ripiego: solo se renderer.js non c'e'
  }

  // ⚠ isAltPanning e isDrawingMode: durante un pan con Alt, renderer.js
  //   spegne da se' canvas.isDrawingMode (righe 1531-1550), quindi Fabric
  //   non ci manda piu' niente. Il controllo qui e' la seconda cintura,
  //   per un tratto gia' cominciato. Si legge per nome lessicale perche'
  //   isAltPanning e' un `let` e NON sta su window (trappola 124).
  function _altPanning() {
    try { if (typeof isAltPanning !== "undefined" && isAltPanning) return true; } catch (e) {}
    return false;
  }

  function _t(key, fallback) {
    try {
      if (window.i18n && typeof window.i18n.t === "function") {
        const s = window.i18n.t(key);
        if (s && s !== key) return s;
      }
    } catch (e) {}
    return fallback;
  }

  // Come _t, ma con i numeri da mettere dentro il testo ({mm}, {orig}).
  function _tp(key, params, fallback) {
    try {
      if (window.i18n && typeof window.i18n.t === "function") {
        const s = window.i18n.t(key, params);
        if (s && s !== key) return s;
      }
    } catch (e) {}
    let out = String(fallback);
    if (params) {
      out = out.replace(/\{(\w+)\}/g, function (m, k) {
        return Object.prototype.hasOwnProperty.call(params, k) ? String(params[k]) : m;
      });
    }
    return out;
  }

  function _toastMsg(msg) {
    try { if (typeof flashToastSafe === "function") return void flashToastSafe(msg); } catch (e) {}
    try { if (typeof flashToast === "function") return void flashToast(msg); } catch (e) {}
    if (typeof window.flashToast === "function") window.flashToast(msg);
  }

  function _toastP(key, params, fallback) {
    _toastMsg(_tp(key, params, fallback));
  }

  function _toast(key, fallback) {
    _toastMsg(_t(key, fallback));
  }

  function _pushState() {
    try { if (typeof pushState === "function") return void pushState(); } catch (e) {}
    if (typeof window.pushState === "function") window.pushState();
  }

  function _btn() {
    return document.getElementById("stampBtn");
  }

  // ═══════════════════════════════════════════════════════════════
  //  LA GEOMETRIA DELLA PUNTA E DELLA SORGENTE
  //
  //  ⚠ Sta QUI, una volta sola, perche' ha due lettori: il pennello
  //  (che campiona) e l'overlay degli anelli in freehandTools.js (che
  //  disegna). Se fossero due conti separati, l'anello potrebbe indicare
  //  un punto e la copia arrivare da un altro: il riferimento visivo
  //  mentirebbe, che e' peggio del non averlo (§4.3, trappola 131).
  // ═══════════════════════════════════════════════════════════════
  function _tipLogicalPx() {
    return Math.max(1, _mm2px(tipMM));
  }

  // ═══════════════════════════════════════════════════════════════
  //  LA FORMA DELLA PUNTA — Fetta 4A-2
  //
  //  Queste funzioni sono PURE (solo Math e il contesto 2D) perche' hanno
  //  TRE lettori: la maschera dell'impronta qui sotto, il WORKER (che le
  //  riceve come testo da _workerSource) e gli ANELLI di freehandTools.js.
  //  Una forma sola scritta una volta: l'anello non puo' promettere un
  //  contorno e la copia farne un altro (§4.3, trappola 131).
  //
  //  Una punta e' un oggetto { shape, w, h, R, ... }:
  //    w, h  larghezza e altezza in px logici (la w e' la Dimensione)
  //    R     raggio del cerchio che la contiene, misurato dal centro:
  //          il pezzo copiato e' il quadrato 2R x 2R, cosi' NON cambia
  //          misura mentre la punta gira (niente tele nuove a ogni
  //          impronta) e con la punta tonda resta quello della 4A-1
  //    cmds  solo per la forma libera: comandi M/L/Q normalizzati (lato
  //          maggiore = 1, centrati sul baricentro)
  //  Il centro della punta e' sotto il cursore. Per il triangolo e per la
  //  forma libera il centro e' il BARICENTRO dell'area: e' quello il punto
  //  attorno a cui una forma gira senza sembrare sbilanciata.
  //  La rotazione a e' in radianti e gira in SENSO ORARIO, come ctx.rotate
  //  e come la direzione del tratto (le y del foglio crescono in basso).
  // ═══════════════════════════════════════════════════════════════

  // I vertici della punta (poligoni), prima della rotazione. grow > 0 li
  // porta in fuori di quel tanto, perpendicolarmente ai lati: serve
  // all'anello, che sta appena fuori dal bordo. Per cerchio, ovale e forma
  // libera restituisce null (li' il contorno non e' un poligono).
  function tipVertices(tip, grow) {
    if (tip.shape === "square" || tip.shape === "rect") {
      const hx = tip.w / 2 + grow, hy = tip.h / 2 + grow;
      return [{ x: -hx, y: -hy }, { x: hx, y: -hy }, { x: hx, y: hy }, { x: -hx, y: hy }];
    }
    if (tip.shape === "tri") {
      const h = tip.h;
      // isoscele, base in basso, punta in su; centrato sul baricentro
      const V = [{ x: 0, y: -2 * h / 3 }, { x: tip.w / 2, y: h / 3 }, { x: -tip.w / 2, y: h / 3 }];
      return grow ? _growPoly(V, grow) : V;
    }
    return null;
  }

  // Porta un poligono convesso in fuori di grow, lato per lato (il vertice
  // nuovo e' l'incrocio dei due lati spostati). Il centro e' l'origine, e
  // serve solo a capire da che parte sta il fuori.
  function _growPoly(V, grow) {
    const n = V.length;
    const N = [];
    for (let i = 0; i < n; i++) {
      const a = V[i], b = V[(i + 1) % n];
      let nx = -(b.y - a.y), ny = b.x - a.x;
      const L = Math.sqrt(nx * nx + ny * ny) || 1;
      nx /= L; ny /= L;
      if (nx * (a.x + b.x) / 2 + ny * (a.y + b.y) / 2 < 0) { nx = -nx; ny = -ny; }
      N.push({ x: nx, y: ny });
    }
    const out = [];
    for (let i = 0; i < n; i++) {
      const n1 = N[(i - 1 + n) % n], n2 = N[i];
      const d = 1 + (n1.x * n2.x + n1.y * n2.y);
      const k = d > 1e-6 ? grow / d : grow;
      out.push({ x: V[i].x + k * (n1.x + n2.x), y: V[i].y + k * (n1.y + n2.y) });
    }
    return out;
  }

  // La forma libera non si puo' "spostare in fuori" lato per lato (e' fatta
  // anche di curve): l'anello la ingrandisce attorno al centro, quel tanto
  // che nel punto piu' lontano fa esattamente grow.
  function _growK(tip, grow) {
    if (!grow || !(tip.R > 0)) return 1;
    return (tip.R + grow) / tip.R;
  }

  // Traccia il contorno della punta sul contesto. Il chiamante fa
  // beginPath / closePath (e poi fill o stroke).
  //   cx, cy  centro, nelle unita' del contesto
  //   k       px del contesto per ogni px logico (S per la maschera, 1 per
  //           l'anello, che e' disegnato in coordinate logiche)
  //   a       rotazione della punta, radianti, + = orario
  //   grow    quanto sporgere in fuori, px logici (0 per la maschera)
  function tipTrace(ctx, tip, cx, cy, k, a, grow) {
    if (tip.shape === "round") {
      ctx.arc(cx, cy, (tip.w / 2 + grow) * k, 0, Math.PI * 2);
      return;
    }
    if (tip.shape === "oval") {
      ctx.ellipse(cx, cy, (tip.w / 2 + grow) * k, (tip.h / 2 + grow) * k, a, 0, Math.PI * 2);
      return;
    }
    const c = Math.cos(a), s = Math.sin(a);
    if (tip.shape === "custom") {
      const m = tip.w * _growK(tip, grow) * k;
      const cmds = tip.cmds || [];
      for (let i = 0; i < cmds.length; i++) {
        const q = cmds[i];
        const x = cx + (q.x * c - q.y * s) * m;
        const y = cy + (q.x * s + q.y * c) * m;
        if (q.t === "Q") {
          ctx.quadraticCurveTo(cx + (q.cx * c - q.cy * s) * m, cy + (q.cx * s + q.cy * c) * m, x, y);
        } else if (q.t === "L") {
          ctx.lineTo(x, y);
        } else {
          ctx.moveTo(x, y);
        }
      }
      return;
    }
    const V = tipVertices(tip, grow);
    if (!V) { ctx.arc(cx, cy, (tip.w / 2 + grow) * k, 0, Math.PI * 2); return; }
    for (let i = 0; i < V.length; i++) {
      const x = cx + (V[i].x * c - V[i].y * s) * k;
      const y = cy + (V[i].x * s + V[i].y * c) * k;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
  }

  // La scatola della punta girata, rispetto al suo centro (px logici).
  // ⚠ Per la forma libera si misura sui punti dei comandi, CONTROLLI
  //   COMPRESI: una curva quadratica sta sempre dentro il triangolo dei suoi
  //   tre punti, quindi la scatola e' sicura e non taglia il bordo del
  //   tratto (che si ritaglia proprio su questa scatola).
  function tipBox(tip, a, grow) {
    if (tip.shape === "round") {
      const r = tip.w / 2 + grow;
      return { x0: -r, y0: -r, x1: r, y1: r };
    }
    const c = Math.cos(a), s = Math.sin(a);
    if (tip.shape === "oval") {
      const A = tip.w / 2 + grow, B = tip.h / 2 + grow;
      const ex = Math.sqrt(A * A * c * c + B * B * s * s);
      const ey = Math.sqrt(A * A * s * s + B * B * c * c);
      return { x0: -ex, y0: -ey, x1: ex, y1: ey };
    }
    let pts = null;
    if (tip.shape === "custom") {
      const m = tip.w * _growK(tip, grow);
      const hull = tip.pts || [];
      pts = [];
      for (let i = 0; i < hull.length; i++) pts.push({ x: hull[i].x * m, y: hull[i].y * m });
    } else {
      pts = tipVertices(tip, grow);
    }
    if (!pts || !pts.length) {
      const r = tip.w / 2 + grow;
      return { x0: -r, y0: -r, x1: r, y1: r };
    }
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (let i = 0; i < pts.length; i++) {
      const x = pts[i].x * c - pts[i].y * s;
      const y = pts[i].x * s + pts[i].y * c;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
    return { x0: x0, y0: y0, x1: x1, y1: y1 };
  }

  // Quanto sporge la punta dal centro nella direzione (ux, uy). La usa la
  // riga tratteggiata fra punta e sorgente, che va da BORDO a BORDO: con una
  // forma non tonda il bordo non sta piu' a un raggio fisso.
  function tipReach(tip, a, grow, ux, uy) {
    const fall = tip.w / 2 + grow;
    const L = Math.sqrt(ux * ux + uy * uy);
    if (!(L > 0)) return fall;
    const dx = ux / L, dy = uy / L;
    if (tip.shape === "round") return fall;
    const c = Math.cos(a), s = Math.sin(a);
    // la direzione vista dalla punta (rotazione all'indietro)
    const lx = dx * c + dy * s;
    const ly = -dx * s + dy * c;
    if (tip.shape === "oval") {
      const A = tip.w / 2 + grow, B = tip.h / 2 + grow;
      const q = (lx / A) * (lx / A) + (ly / B) * (ly / B);
      return q > 0 ? 1 / Math.sqrt(q) : fall;
    }
    let poly = null;
    if (tip.shape === "custom") {
      const m = tip.w * _growK(tip, grow);
      const p0 = tip.poly || [];
      poly = [];
      for (let i = 0; i < p0.length; i++) poly.push({ x: p0[i].x * m, y: p0[i].y * m });
    } else {
      poly = tipVertices(tip, grow);
    }
    if (!poly || poly.length < 2) return fall;
    // raggio dal centro in direzione (lx, ly): si tiene l'incrocio piu'
    // lontano, cosi' anche una forma rientrante non taglia la riga dentro
    let best = 0;
    for (let i = 0; i < poly.length; i++) {
      const A = poly[i], B = poly[(i + 1) % poly.length];
      const ex = B.x - A.x, ey = B.y - A.y;
      const den = lx * ey - ly * ex;
      if (Math.abs(den) < 1e-12) continue;
      const t = (A.x * ey - A.y * ex) / den;
      if (!(t > best)) continue;
      const den2 = ex * ly - ey * lx;
      if (Math.abs(den2) < 1e-12) continue;
      const u = (A.y * lx - A.x * ly) / den2;
      if (u < -1e-9 || u > 1 + 1e-9) continue;
      best = t;
    }
    return best > 0 ? best : fall;
  }

  // La punta di adesso, in px logici. La chiedono il pennello (a inizio
  // tratto), l'overlay degli anelli e il banco.
  function _tipGeom() {
    const w = _tipLogicalPx();
    if (tipShape === "square") return { shape: "square", w: w, h: w, R: w * Math.SQRT1_2 };
    if (tipShape === "rect") {
      const h = w * tipRatios.rect;
      return { shape: "rect", w: w, h: h, R: Math.sqrt(w * w + h * h) / 2 };
    }
    if (tipShape === "oval") {
      const h = w * tipRatios.oval;
      return { shape: "oval", w: w, h: h, R: Math.max(w, h) / 2 };
    }
    if (tipShape === "tri") {
      const h = w * tipRatios.tri;
      return {
        shape: "tri", w: w, h: h,
        R: Math.max(2 * h / 3, Math.sqrt(w * w / 4 + h * h / 9))
      };
    }
    if (tipShape === "custom" && customTip) {
      return {
        shape: "custom", w: w, h: w * customTip.hN,
        R: w * customTip.rN,
        cmds: customTip.cmds, pts: customTip.pts, poly: customTip.poly
      };
    }
    // tonda: identica alla Fetta 4A-1 (R = raggio, scatola = quadrato)
    return { shape: "round", w: w, h: w, R: w / 2 };
  }

  function _rotRad() { return tipRotationDeg * Math.PI / 180; }

  // La punta segue il tratto? Con la tonda non vuol dire niente: si risponde
  // no, e cosi' il pennello non aspetta la direzione e resta quello di prima.
  function _followsStroke() {
    return !!tipFollow && tipShape !== "round";
  }

  // L'orientamento da mostrare negli anelli: mentre si dipinge e' quello
  // vero dell'ultima impronta; a mano ferma e' quello di RIPOSO, cioe' la
  // sola Rotazione (come uscirebbe un click secco).
  function _tipAngleRad() {
    if (_liveDirRad !== null && _followsStroke()) return _liveDirRad + _rotRad();
    return _rotRad();
  }

  // La direzione del tratto, smussata con la stessa legge delle punte piatte
  // dell'acquerello (smoothAngleRad di watercolorStampBrush.js): il fattore
  // sale quando la mano gira davvero, cosi' una curva la segue e il tremolio
  // no. Il conto dell'angolo regge il salto a +-180 gradi.
  function _smoothAngle(prev, next) {
    if (prev === null || prev === undefined || isNaN(prev)) return next;
    const TWO = Math.PI * 2;
    let diff = next - prev;
    diff = (((diff % TWO) + TWO + Math.PI) % TWO) - Math.PI;
    const deg = Math.abs(diff) * 180 / Math.PI;
    let f = DIR_SMOOTH_BASE;
    if (deg > 35) f = 0.92;
    else if (deg > 20) f = 0.78;
    else if (deg > 10) f = 0.55;
    else if (deg > 5) f = 0.42;
    let a = (prev + diff * f) % TWO;
    if (a > Math.PI) a -= TWO;
    if (a < -Math.PI) a += TWO;
    return a;
  }

  // Lo scostamento della sorgente AGGANCIATA. La distanza ha il segno
  // (negativo = a sinistra), l'angolo la inclina: + = verso l'alto da
  // tutte e due le parti. Coordinate del foglio, con la y che scende.
  //   angolo 0   → (D, 0): come fino alla Fetta 3-bis, identico
  //   angolo +90 → (0, −|D|): sopra la punta, da qualunque lato
  //   angolo −90 → (0, +|D|): sotto la punta
  function _offsetLogicalPx() {
    const d = _mm2px(offsetXMM);
    if (angleDeg === 0) return { x: d, y: 0 };
    // (A ±90° la x vale d·cos(90°) ≈ 6e-17 px invece di zero: sommata alla
    //  punta sparisce, e non cambia ne' un pixel ne' la freccia. Un caso
    //  speciale per azzerarla non lo difenderebbe nessuna prova: trappola 155.)
    const a = angleDeg * Math.PI / 180;
    return { x: d * Math.cos(a), y: -Math.abs(d) * Math.sin(a) };
  }

  // Dove sta la sorgente ADESSO, per una punta in p (coord. logiche).
  //   1) contagocce armato → la sorgente E' la punta: il prossimo click
  //      prende esattamente da li', e l'anello della sorgente si posa su
  //      quello della punta per dirlo. Mentre e' armato il pennello non
  //      dipinge (onMouseDown va sempre a prendere), quindi questa
  //      risposta non puo' finire in un'impronta;
  //   2) sorgente fissa → quella, SEMPRE: al passaggio del mouse, mentre
  //      si dipinge, fra un tratto e l'altro. Non segue il pennello
  //      (decisione di Mirko al collaudo della 2A, §4.1-bis);
  //   3) altrimenti → punta + distanza (agganciata): segue la punta.
  //
  //   ⚠ Fino alla 2A un Ctrl+Click metteva un'ANCORA che al primo tocco
  //     diventava uno scostamento e poi seguiva il pennello: la sorgente
  //     scelta serviva solo a fissare una distanza. Mirko l'ha bocciato
  //     in collaudo, ed e' sparito (trappola 138).
  function _sourceForPoint(p) {
    if (!p) return null;
    if (pickArmed) return { x: p.x, y: p.y };
    if (!anchored && fixedSource) return { x: fixedSource.x, y: fixedSource.y };
    const off = _offsetLogicalPx();
    return { x: p.x + off.x, y: p.y + off.y };
  }

  // ════════════════════════════════════════════════════════════════
  //  LA LASTRA DELLO SFONDO
  //
  //  ⚠ In Mosaica lo sfondo NON e' canvas.backgroundImage: sono OGGETTI
  //  del canvas marcati __isBackground (l'immagine dell'utente e la
  //  texture della carta), mandati in fondo. Leggere i pixel del canvas
  //  prenderebbe anche tessere e tratti, cioe' copierebbe il mosaico
  //  invece della carta (trappola 120). Quindi: si ridisegnano QUEI SOLI
  //  OGGETTI su una lastra fuori schermo, e si campiona da lei.
  //
  //  La lastra si costruisce UNA volta e si tiene (trappola 122).
  //  Si invalida in due modi, e servono entrambi:
  //    a) a eventi — object:added/removed/modified su un __isBackground;
  //    b) per firma — un confronto da due soldi prima di riusarla, che
  //       copre i cambi fatti senza eventi. I tre punti che creano uno
  //       sfondo stanno dentro renderer.js (1910, 2043, 6594) e non si
  //       possono toccare: la cintura (b) e' quello che ci mette al
  //       riparo dal non accorgersene.
  // ════════════════════════════════════════════════════════════════
  let slab = null;  // { el, wLog, hLog, scale, sig, version }
  let slabVersion = 0;  // cresce a ogni lastra nuova: il worker sa se e' la sua

  function _backgroundObjects(c) {
    if (!c || typeof c.getObjects !== "function") return [];
    return c.getObjects().filter(function (o) {
      return o && o.__isBackground === true;
    });
  }

  function hasBackground(c) {
    return _backgroundObjects(c).length > 0;
  }

  // Hash corto di una stringa corta.
  function _hash(s) {
    let h = 5381;
    for (let i = 0; i < s.length; i++) h = (((h << 5) + h) + s.charCodeAt(i)) | 0;
    return (h >>> 0).toString(36);
  }

  // ⚠ LA CHIAVE DI UN'IMMAGINE DI SFONDO, SENZA RILEGGERLA (Fetta 4A-1).
  //   In Mosaica lo sfondo nasce da fabric.Image.fromURL(dataURL): la sua
  //   src E' l'immagine intera scritta in testo. Un JPEG 4K da 12 MB sono
  //   ~16,8 milioni di caratteri, e fino alla Fetta 3-bis la firma li
  //   passava TUTTI a ogni impronta: 117 ms a impronta (158 con 18 MB),
  //   misurati in V8. Un tratto veloce chiede una decina di impronte per
  //   movimento del mouse: piu' di un secondo fermo a ogni movimento.
  //   Trappola 165.
  //   Ora la chiave e': chi e' l'elemento (un numero dato la prima volta
  //   che lo si vede: renderer.js crea un'immagine NUOVA a ogni sfondo
  //   nuovo), quanto e' lunga la src, e un campione di 3 × 64 caratteri
  //   (inizio, meta', fine). Costa lo stesso con 1 KB o con 20 MB.
  const _elementIds = typeof WeakMap === "function" ? new WeakMap() : null;
  let _nextElementId = 1;

  function _elementId(el) {
    if (!el || (typeof el !== "object" && typeof el !== "function") || !_elementIds) return 0;
    let id = _elementIds.get(el);
    if (!id) { id = _nextElementId++; _elementIds.set(el, id); }
    return id;
  }

  function _srcKey(o) {
    const el = o._element;
    const src = String((el && (el.currentSrc || el.src)) || o.cacheKey || o.type || "?");
    const n = src.length;
    const K = 64;
    const sample = n <= 3 * K
      ? src
      : src.slice(0, K) + src.slice((n >> 1) - (K >> 1), (n >> 1) + (K >> 1)) + src.slice(n - K);
    return _elementId(el) + "/" + n + "/" + _hash(sample);
  }

  // Il colore del foglio sotto lo sfondo. In Mosaica e' il bianco di
  // canvas.backgroundColor (renderer.js). Durante gli export renderer.js
  // lo svuota per un istante: in quel caso vale comunque il bianco,
  // perche' il foglio E' bianco.
  function _sheetColor(c) {
    const bc = c && c.backgroundColor;
    return (typeof bc === "string" && bc) ? bc : "#ffffff";
  }

  function _slabSignature(c) {
    const bg = _backgroundObjects(c);
    const parts = [Math.round(c.getWidth()), Math.round(c.getHeight()), bg.length, _sheetColor(c)];
    for (let i = 0; i < bg.length; i++) {
      const o = bg[i];
      parts.push([
        _srcKey(o),
        o.left, o.top, o.scaleX, o.scaleY, o.angle,
        o.opacity, o.width, o.height, !!o.flipX, !!o.flipY, o.visible !== false,
        o.fill, o.stroke, o.strokeWidth
      ].join(":"));
    }
    return parts.join("|");
  }

  // Ridisegna UN oggetto di sfondo sul contesto della lastra.
  // E' la tecnica della lente (freehandClipLens.js _renderOne): cache
  // spenta, cosi' si ottiene il vettore e non un bitmap ingrandito.
  // ⚠ Il clipPath NON lo tocchiamo: un __isBackground non prende mai il
  //   ritaglio del perimetro (isFreehandObj lo esclude per primo), quindi
  //   se un clipPath c'e' e' suo e va rispettato.
  // ⚠ Il catch NON e' muto: un errore qui vuol dire lastra vuota, e una
  //   lastra vuota che non si lamenta e' il modo peggiore di sbagliare.
  //   L'ultimo errore resta leggibile (l'harness lo pretende).
  let _renderErrors = 0;
  let _lastRenderError = null;

  function _renderOneBackground(ctx, o) {
    const savedCaching = o.objectCaching;
    const savedDirty = o.dirty;
    ctx.save();
    try {
      o.objectCaching = false;
      if (typeof o.render === "function") o.render(ctx);
    } catch (e) {
      // Uno sfondo che non si disegna non deve portarsi via la lastra,
      // ma deve lasciare traccia.
      _renderErrors++;
      _lastRenderError = (e && e.message) || String(e);
    } finally {
      o.objectCaching = savedCaching;
      o.dirty = savedDirty;
      ctx.restore();
    }
  }

  function _buildSlab(c) {
    const wLog = Math.max(1, Math.round(c.getWidth()));
    const hLog = Math.max(1, Math.round(c.getHeight()));
    const el = document.createElement("canvas");
    el.width = Math.max(1, Math.round(wLog * SLAB_SCALE));
    el.height = Math.max(1, Math.round(hLog * SLAB_SCALE));
    const ctx = el.getContext("2d");
    if (!ctx) return null;

    // La lastra vive in coordinate LOGICHE del foglio, scalate di
    // SLAB_SCALE. In Mosaica il viewportTransform di Fabric e' SEMPRE
    // l'identita' (lo zoom e' una CSS transform sul #paper), quindi le
    // coordinate degli oggetti sono direttamente quelle logiche.
    //
    // ⚠ skipOffscreen VA SPENTO. fabric.Object.render() non disegna un
    //   oggetto che ritiene fuori dal viewport, e per deciderlo guarda il
    //   viewport del canvas PRINCIPALE (canvas.vptCoords) anche mentre noi
    //   stiamo disegnando su una lastra nostra, che non e' un viewport.
    //   Se vptCoords non e' ancora stato calcolato (avvio, subito dopo un
    //   setDimensions, prima del primo render) isOnScreen() lancia e la
    //   lastra esce VUOTA. La lastra deve dipendere solo dagli oggetti che
    //   ci mettiamo: quindi si spegne, e si rimette com'era.
    //
    // ⚠ PRIMA IL BIANCO DEL FOGLIO (Fetta 3, trappola 151). La carta di
    //   Mosaica e' un oggetto al 22% di opacita' appoggiato sul bianco:
    //   senza il bianco la lastra sarebbe un velo semitrasparente, e i
    //   veli si sommano impronta dopo impronta — la copia usciva piu'
    //   scura dell'originale (misurato: 230 → 174 su 255) e a chiazze.
    //   Col bianco sotto la lastra e' lo sfondo COME SI VEDE, opaco, e
    //   il tratto e' la copia esatta. Serve anche ai colori: invertire un
    //   velo non da' il negativo di quello che si vede.
    const savedSkip = c.skipOffscreen;
    ctx.save();
    try {
      c.skipOffscreen = false;
      ctx.fillStyle = _sheetColor(c);
      ctx.fillRect(0, 0, el.width, el.height);
      ctx.scale(SLAB_SCALE, SLAB_SCALE);
      const bg = _backgroundObjects(c);
      for (let i = 0; i < bg.length; i++) _renderOneBackground(ctx, bg[i]);
    } finally {
      c.skipOffscreen = savedSkip;
      ctx.restore();
    }

    slabVersion++;
    return { el: el, wLog: wLog, hLog: hLog, scale: SLAB_SCALE, sig: _slabSignature(c), version: slabVersion };
  }

  function ensureSlab(c) {
    if (!c) return null;
    if (!hasBackground(c)) { slab = null; return null; }
    if (slab && slab.sig === _slabSignature(c)) return slab;
    slab = _buildSlab(c);
    return slab;
  }

  function invalidateSlab() { slab = null; }

  // Campiona un quadrato di lato sizeLog centrato su (srcX, srcY).
  // readable: il pezzo verra' riletto con getImageData (i colori della
  // Fetta 3). Chromium tiene allora quella tela in memoria normale invece
  // che sulla scheda video, e la rilettura non costa un viaggio.
  //
  // ⚠ NON si passa un rettangolo sorgente che sborda dalla lastra a
  //   drawImage: quando il rettangolo sorgente esce dall'immagine, la
  //   destinazione viene ritagliata in proporzione e il contenuto SLITTA.
  //   Quindi si ritaglia a mano e si disegna all'offset corrispondente:
  //   quello che sta fuori dalla lastra resta trasparente al posto
  //   giusto, che e' la verita' (li' non c'e' sfondo da copiare).
  function sampleTip(c, srcX, srcY, sizeLog, readable) {
    const sl = ensureSlab(c);
    if (!sl) return null;
    const S = sl.scale;
    const px = Math.max(1, Math.round(sizeLog * S));

    const out = document.createElement("canvas");
    out.width = px;
    out.height = px;
    const octx = readable ? out.getContext("2d", { willReadFrequently: true }) : out.getContext("2d");
    if (!octx) return null;

    let sx = Math.round((srcX - sizeLog / 2) * S);
    let sy = Math.round((srcY - sizeLog / 2) * S);
    let sw = px, sh = px, dx = 0, dy = 0;

    if (sx < 0) { dx = -sx; sw += sx; sx = 0; }
    if (sy < 0) { dy = -sy; sh += sy; sy = 0; }
    if (sx + sw > sl.el.width) sw = sl.el.width - sx;
    if (sy + sh > sl.el.height) sh = sl.el.height - sy;
    if (sw <= 0 || sh <= 0) return null;  // tutto fuori dalla lastra

    try {
      octx.drawImage(sl.el, sx, sy, sw, sh, dx, dy, sw, sh);
    } catch (e) {
      return null;
    }
    return out;
  }

  // ════════════════════════════════════════════════════════════════
  //  I COLORI — Fetta 3
  //
  //  Si applicano al pezzo campionato PRIMA di timbrarlo, sui suoi pixel
  //  (la trasparenza no: e' l'opacity dell'oggetto, §4.5). L'ordine e'
  //  dichiarato (§4.5-bis) e ha una ragione:
  //    1) la MODALITA' decide "quali colori";
  //    2) il TONO gira la tinta del risultato;
  //    3) la LUMINOSITA' viene per ultima, cosi' "piu' luminoso" vuol
  //       dire sempre "il risultato piu' luminoso" — anche su un negativo.
  //
  //  Le cinque modalita', su valori 0…255:
  //    normal     niente
  //    grayscale  luminanza BT.709 sui tre canali
  //    invert     255 − canale (il negativo fotografico: la tinta gira)
  //    negative   il NEGATIVO DI LUMINANZA: la luce si inverte, la tinta
  //               e la saturazione (HSL) restano. Conto esatto e senza
  //               arrotondamenti: ogni canale + (255 − max − min).
  //               ⚠ E' uguale a "invert" seguito da un tono di 180°: la
  //               prova del banco lo pretende
  //    cmy        separazione sottrattiva: si tiene la lastra scelta e la
  //               si mostra nel colore del suo inchiostro su bianco.
  //               Lastra C = (R, 255, 255), M = (255, G, 255),
  //               Y = (255, 255, B)
  //
  //  Il tono gira la tinta in HSL tenendo saturazione e luce: e' una
  //  rotazione dentro l'esagono, che conserva il massimo e il minimo dei
  //  tre canali. Si calcola IN INTERI e in gradi interi: e' esatto anche
  //  sui valori che cadono a meta' (trappola 152). I pixel del tutto
  //  trasparenti non si toccano; l'alfa non si tocca mai.
  //
  //  Costo misurato (V8, fuori da jsdom): a 12 mm un'impronta ha ~8 000
  //  pixel e costa ~0,3 ms con la combinazione piu' pesante; a 60 mm
  //  ~200 000 pixel e ~5 ms.
  // ════════════════════════════════════════════════════════════════
  function _colorParams() {
    const active = colorMode !== "normal" || brightness !== 0 || hue !== 0;
    return {
      brightness: brightness,
      hue: hue,
      opacity: 1 - transparency / 100,
      mode: colorMode,
      channel: cmyChannel,
      active: active
    };
  }

  // Trasforma IN POSTO i pixel RGBA (un Uint8ClampedArray o un array).
  // Funzione pura rispetto allo stato del modulo: riceve i parametri.
  function colorizePixels(data, params) {
    if (!data || !params || !params.active) return data;
    // La modalita' diventa un numero una volta sola, e dentro il ciclo si
    // usano confronti invece di Math.max / Math.min: e' lo stesso conto,
    // ma a 60 mm un'impronta ha 200 000 pixel e ogni nanosecondo conta.
    // (x + 0.5) | 0 e' Math.round per i valori NON negativi, che sono gli
    // unici che arrivano a quegli arrotondamenti.
    const mode = params.mode;
    const M = mode === "grayscale" ? 1 : mode === "invert" ? 2 : mode === "negative" ? 3 : mode === "cmy" ? 4 : 0;
    const ch = params.channel === "m" ? 1 : params.channel === "y" ? 2 : 0;
    // Il tono e' in GRADI INTERI (lo slider ha passo 1, setHue arrotonda):
    // cosi' il conto del tono si fa tutto in interi, in sessantesimi, ed e'
    // ESATTO — anche quando il valore vero cade a meta' (27,5 → 28), dove
    // la virgola mobile sbaglierebbe a caso di un livello.
    // Il segno non va sistemato qui: il resto intero ha sempre valore
    // assoluto minore del divisore, e "if (H < 0)" piu' sotto basta.
    const hueDeg = Math.round(Number(params.hue) || 0) % 360;
    const doHue = hueDeg !== 0;
    const delta = Math.round((Number(params.brightness) || 0) * 255 / 100);
    const n = data.length;

    for (let i = 0; i < n; i += 4) {
      if (data[i + 3] === 0) continue;
      let r = data[i], g = data[i + 1], b = data[i + 2];

      // 1) modalita'
      if (M === 1) {
        // I pesi sommano a 1: col bianco la somma fa 254,99999999999997,
        // che arrotondata e' 255. Nessun tetto da mettere.
        r = g = b = (LUMA_R * r + LUMA_G * g + LUMA_B * b + 0.5) | 0;
      } else if (M === 2) {
        r = 255 - r; g = 255 - g; b = 255 - b;
      } else if (M === 3) {
        let mx, mn;
        if (r > g) { mx = r > b ? r : b; mn = g < b ? g : b; }
        else { mx = g > b ? g : b; mn = r < b ? r : b; }
        const k = 255 - mx - mn;
        r += k; g += k; b += k;
      } else if (M === 4) {
        if (ch === 1) { r = 255; b = 255; }
        else if (ch === 2) { r = 255; g = 255; }
        else { g = 255; b = 255; }
      }

      // 2) tono
      if (doHue) {
        let max, min;
        if (r > g) { max = r > b ? r : b; min = g < b ? g : b; }
        else { max = g > b ? g : b; min = r < b ? r : b; }
        const C = max - min;
        if (C > 0) {
          // H = tinta × 60 × C, intero. Un giro intero vale 360 × C.
          const C60 = 60 * C;
          let H;
          if (max === r) H = 60 * (g - b);
          else if (max === g) H = 60 * (b - r) + 2 * C60;
          else H = 60 * (r - g) + 4 * C60;
          H = (H + hueDeg * C) % (6 * C60);
          if (H < 0) H += 6 * C60;
          const s = (H / C60) | 0;                  // sestante, 0…5
          let hm = H % (2 * C60) - C60;             // (h % 2 − 1) × 60C
          if (hm < 0) hm = -hm;
          // Il canale di mezzo vale min + (60C − |hm|) / 60: arrotondato
          // a meta' per eccesso, in interi.
          const mid = ((C60 - hm + 60 * min + 30) / 60) | 0;
          const top = max;                          // = C + min
          if (s === 0) { r = top; g = mid; b = min; }
          else if (s === 1) { r = mid; g = top; b = min; }
          else if (s === 2) { r = min; g = top; b = mid; }
          else if (s === 3) { r = min; g = mid; b = top; }
          else if (s === 4) { r = mid; g = min; b = top; }
          else { r = top; g = min; b = mid; }
        }
      }

      // 3) luminosita'
      if (delta !== 0) {
        r += delta; g += delta; b += delta;
        r = r < 0 ? 0 : (r > 255 ? 255 : r);
        g = g < 0 ? 0 : (g > 255 ? 255 : g);
        b = b < 0 ? 0 : (b > 255 ? 255 : b);
      }

      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b;
    }
    return data;
  }

  // Applica i colori a un pezzo campionato (una tela). Con i colori
  // neutri non fa niente: nemmeno la rilettura dei pixel.
  function colorizeCanvas(el, params) {
    if (!el || !params || !params.active) return el;
    const ctx = el.getContext("2d");
    if (!ctx) return el;
    try {
      const img = ctx.getImageData(0, 0, el.width, el.height);
      colorizePixels(img.data, params);
      ctx.putImageData(img, 0, 0);
    } catch (e) {
      // Una tela illeggibile non deve fermare il tratto: si timbra il
      // pezzo com'e', e resta traccia per l'harness.
      _colorErrors++;
      _lastColorError = (e && e.message) || String(e);
    }
    return el;
  }
  let _colorErrors = 0;
  let _lastColorError = null;

  // ════════════════════════════════════════════════════════════════
  //  UN'IMPRONTA — Fetta 4A-1
  //
  //  Funzione PURA: non tocca lo stato del modulo, ne' document, ne'
  //  window. La usano DUE lettori, e deve restare una sola:
  //    • il percorso di riserva, qui sul filo principale;
  //    • il worker, che la riceve come testo da _workerSource() — cosi'
  //      il conto che il worker fa e' quello scritto qui, non una copia.
  //  Per la stessa ragione dentro ci sono solo cose che esistono in
  //  tutti e due i posti: Math, il contesto 2D, colorizePixels.
  //
  //  Copia dalla lastra alla tela d'accumulo il quadrato che contiene la
  //  punta, centrato sulla sorgente, e lo posa sotto la punta ritagliato
  //  alla SUA FORMA. Tutto in pixel della lastra (coordinate logiche × S).
  //    ctx      contesto della tela d'accumulo
  //    slabImg  la lastra (canvas, OffscreenCanvas o ImageBitmap)
  //    S        pixel di lastra per pixel logico
  //    p, src   punta e sorgente, coordinate logiche
  //    tip      la punta: { shape, w, h, R, … } (Fetta 4A-2)
  //    a        rotazione della punta, radianti, + = orario
  //    col      i colori fotografati a inizio tratto (o null)
  //    scratch  scratch(px, leggibile) → una tela di ESATTAMENTE px × px
  //             (leggibile se servono i colori); si riusa, non si alloca a
  //             ogni impronta
  //  Restituisce il rettangolo toccato (pixel di lastra), o null.
  //
  //  ⚠ IL PEZZO COPIATO NON RUOTA MAI (Fetta 4A-2): si copia sempre un
  //    quadrato diritto, di lato 2R, e si ruota la MASCHERA. Cosi' la
  //    venatura della carta e l'immagine restano per il verso giusto, e la
  //    tela di lavoro non cambia misura mentre la punta gira: con la punta
  //    che segue il tratto sarebbe una tela nuova a ogni impronta.
  //    Con la punta tonda R = raggio, e tutto torna ai conti della 4A-1.
  //
  //  La ricetta: lastra → pezzo (grande ESATTAMENTE px × px) → colori →
  //  MASCHERA della punta sul pezzo → tela, col pezzo disegnato intero.
  //  ⚠ La punta e' una MASCHERA RIEMPITA (destination-in), non un clip().
  //    Nel worker Chromium non sfuma i clip delle tele fuori pagina
  //    (OffscreenCanvas): il bordo del cerchio usciva a scalini, alfa 0 o
  //    255, mentre sulla pagina e' sfumato. Il riempimento invece si sfuma
  //    in tutti e due i posti. Stessa ricetta nel worker e nella riserva:
  //    pixel identici fra le due strade (banco Electron). Rispetto alla
  //    Fetta 3 (che usava il clip) cambia solo l'arrotondamento dei pixel
  //    del bordo sfumato, di pochi livelli; l'interno e' identico.
  //    Trappola 169.
  //  ⚠ Il pezzo si disegna INTERO: una copia diretta dalla lastra (col
  //    ritaglio della sorgente) sul bordo del ritaglio puo' guardare i
  //    pixel vicini della lastra invece del trasparente. Trappola 168.
  //  ⚠ I colori PRIMA della maschera: sui pixel del bordo sfumato la
  //    rilettura "non premoltiplicata" perderebbe precisione.
  //  ⚠ Il rettangolo sorgente si ritaglia a mano, e quello che sta fuori
  //    dalla lastra resta trasparente AL SUO POSTO (trappola 128).
  function stampOnto(ctx, slabImg, S, p, src, tip, a, col, scratch) {
    if (!ctx || !slabImg || !p || !src || !tip) return null;
    const r = tip.R;
    const px = Math.max(1, Math.round(2 * r * S));

    let sx = Math.round((src.x - r) * S);
    let sy = Math.round((src.y - r) * S);
    let sw = px, sh = px, dx = 0, dy = 0;
    if (sx < 0) { dx = -sx; sw += sx; sx = 0; }
    if (sy < 0) { dy = -sy; sh += sy; sy = 0; }
    if (sx + sw > slabImg.width) sw = slabImg.width - sx;
    if (sy + sh > slabImg.height) sh = slabImg.height - sy;
    if (sw <= 0 || sh <= 0) return null;  // tutto fuori dalla lastra

    const ox = Math.round((p.x - r) * S);
    const oy = Math.round((p.y - r) * S);

    const readable = !!(col && col.active);
    const t = scratch(px, readable);
    const tctx = t && (readable ? t.getContext("2d", { willReadFrequently: true }) : t.getContext("2d"));
    if (!tctx) return null;
    tctx.setTransform(1, 0, 0, 1, 0, 0);
    tctx.globalCompositeOperation = "source-over";
    tctx.globalAlpha = 1;
    tctx.clearRect(0, 0, px, px);
    tctx.drawImage(slabImg, sx, sy, sw, sh, dx, dy, sw, sh);
    if (readable) {
      const img = tctx.getImageData(0, 0, px, px);
      colorizePixels(img.data, col);
      tctx.putImageData(img, 0, 0);
    }
    // la punta: il centro vero (non arrotondato) nelle coordinate del pezzo
    tctx.save();
    try {
      tctx.globalCompositeOperation = "destination-in";
      tctx.fillStyle = "#000";
      tctx.beginPath();
      tipTrace(tctx, tip, p.x * S - ox, p.y * S - oy, S, a, 0);
      tctx.closePath();
      tctx.fill();
    } finally {
      tctx.restore();
    }
    ctx.drawImage(t, ox, oy, px, px);
    const b = tipBox(tip, a, 0);
    return {
      x0: (p.x + b.x0) * S, y0: (p.y + b.y0) * S,
      x1: (p.x + b.x1) * S, y1: (p.y + b.y1) * S
    };
  }

  // ════════════════════════════════════════════════════════════════
  //  IL WORKER DEL TIMBRO — Fetta 4A-1
  //
  //  Le stesse accortezze dell'acquerello (gpuWorker.js), per il timbro:
  //    • la lastra passa al worker UNA volta per ogni lastra nuova;
  //    • le impronte partono a pacchetti, una volta per fotogramma;
  //    • il worker disegna su una OffscreenCanvas (la scheda video, dove
  //      Chromium la tiene), e rimanda l'anteprima RITAGLIATA sull'area
  //      dipinta, al massimo ogni 16 ms;
  //    • a fine tratto rimanda il ritaglio E il suo PNG gia' codificato:
  //      il filo principale non codifica niente (trappola 166).
  //
  //  ⚠ Il worker nasce da questo stesso file, come Blob: il suo testo e'
  //    fatto con le funzioni vere (colorizePixels, stampOnto,
  //    _stampWorkerMain). Niente file nuovo da impacchettare, e soprattutto
  //    niente seconda copia della ricetta che possa divergere. La CSP di
  //    security.js ammette gia' i worker da blob: ("worker-src 'self'
  //    file: blob:").
  //  ⚠ Tutti i messaggi passano da UNA catena (_wChain): la lastra si
  //    prepara in modo asincrono (createImageBitmap), e le impronte non
  //    devono arrivare prima di lei.
  // ════════════════════════════════════════════════════════════════
  function _stampWorkerMain(scope) {
    let slabBmp = null;
    let accEl = null, accCtx = null;
    let strokeId = null, S = 2, sizeLog = 1, col = null, tip = null;
    let bbox = null;
    let lastPreview = 0;
    const scratchEls = [null, null];     // [normale, leggibile]
    let chain = Promise.resolve();

    function scratch(px, readable) {
      const k = readable ? 1 : 0;
      let el = scratchEls[k];
      if (!el || el.width !== px || el.height !== px) {
        el = new OffscreenCanvas(px, px);
        if (readable) el.getContext("2d", { willReadFrequently: true });
        else el.getContext("2d");
        scratchEls[k] = el;
      }
      return el;
    }

    function grow(b) {
      if (!bbox) { bbox = { x0: b.x0, y0: b.y0, x1: b.x1, y1: b.y1 }; return; }
      if (b.x0 < bbox.x0) bbox.x0 = b.x0;
      if (b.y0 < bbox.y0) bbox.y0 = b.y0;
      if (b.x1 > bbox.x1) bbox.x1 = b.x1;
      if (b.y1 > bbox.y1) bbox.y1 = b.y1;
    }

    function crop() {
      if (!bbox || !accEl) return null;
      const x0 = Math.max(0, Math.floor(bbox.x0));
      const y0 = Math.max(0, Math.floor(bbox.y0));
      const x1 = Math.min(accEl.width, Math.ceil(bbox.x1));
      const y1 = Math.min(accEl.height, Math.ceil(bbox.y1));
      const w = x1 - x0, h = y1 - y0;
      if (w <= 0 || h <= 0) return null;
      const c = new OffscreenCanvas(w, h);
      c.getContext("2d").drawImage(accEl, x0, y0, w, h, 0, 0, w, h);
      return { c: c, x: x0, y: y0, w: w, h: h };
    }

    function blobToDataURL(blob) {
      if (typeof FileReaderSync === "function") return new FileReaderSync().readAsDataURL(blob);
      return new Promise(function (res, rej) {
        const fr = new FileReader();
        fr.onload = function () { res(fr.result); };
        fr.onerror = function () { rej(fr.error); };
        fr.readAsDataURL(blob);
      });
    }

    async function handle(m) {
      if (!m) return;
      if (m.type === "slab") {
        if (slabBmp && typeof slabBmp.close === "function") slabBmp.close();
        slabBmp = m.bitmap || null;
        return;
      }
      if (m.type === "start") {
        strokeId = m.id;
        S = m.scale;
        sizeLog = m.sizeLog;
        // la punta della Fetta 4A-2; se un giorno arrivasse un messaggio
        // vecchio, senza punta, si torna alla tonda del diametro dato
        tip = m.tip || { shape: "round", w: sizeLog, h: sizeLog, R: sizeLog / 2 };
        col = m.color || null;
        bbox = null;
        lastPreview = 0;
        if (!accEl || accEl.width !== m.w || accEl.height !== m.h) {
          accEl = new OffscreenCanvas(m.w, m.h);
          accCtx = accEl.getContext("2d");
        } else {
          accCtx.setTransform(1, 0, 0, 1, 0, 0);
          accCtx.clearRect(0, 0, accEl.width, accEl.height);
        }
        return;
      }
      if (m.type === "stamps") {
        if (m.id !== strokeId || !accCtx || !slabBmp) return;
        const list = m.list || [];
        for (let i = 0; i < list.length; i++) {
          const b = stampOnto(accCtx, slabBmp, S, list[i].p, list[i].s, tip, list[i].a || 0, col, scratch);
          if (b) grow(b);
        }
        const now = performance.now();
        if (bbox && now - lastPreview >= m.throttle) {
          lastPreview = now;
          const cr = crop();
          if (cr) {
            const bm = await createImageBitmap(cr.c);
            scope.postMessage({ type: "preview", id: m.id, bitmap: bm, x: cr.x, y: cr.y }, [bm]);
          }
        }
        return;
      }
      if (m.type === "end") {
        if (m.id !== strokeId) return;
        const id = strokeId;
        strokeId = null;
        const cr = crop();
        bbox = null;
        if (!cr) {
          scope.postMessage({ type: "result", id: id, empty: true });
          return;
        }
        let url = null;
        try {
          const blob = await cr.c.convertToBlob({ type: "image/png" });
          url = await blobToDataURL(blob);
        } catch (e) {
          url = null;  // il filo principale codifichera' da se', una volta
        }
        const bm = await createImageBitmap(cr.c);
        scope.postMessage({ type: "result", id: id, bitmap: bm, dataURL: url, x: cr.x, y: cr.y, w: cr.w, h: cr.h }, [bm]);
        return;
      }
      if (m.type === "cancel") {
        if (m.id === strokeId) { strokeId = null; bbox = null; }
      }
    }

    scope.onmessage = function (e) {
      const m = e.data;
      chain = chain.then(function () { return handle(m); }).catch(function (err) {
        scope.postMessage({ type: "error", id: m && m.id, message: String((err && err.message) || err) });
      });
    };
  }

  function _workerSource() {
    return [
      '"use strict";',
      "const LUMA_R = " + LUMA_R + ";",
      "const LUMA_G = " + LUMA_G + ";",
      "const LUMA_B = " + LUMA_B + ";",
      colorizePixels.toString(),
      // la geometria della punta (Fetta 4A-2): le STESSE funzioni, non una
      // copia — il worker riceve il testo di queste, qui sopra
      tipVertices.toString(),
      _growPoly.toString(),
      _growK.toString(),
      tipTrace.toString(),
      tipBox.toString(),
      stampOnto.toString(),
      "(" + _stampWorkerMain.toString() + ")(self);"
    ].join("\n");
  }

  let _worker = null;
  let _workerBroken = false;
  let _workerSlabVersion = -1;
  let _wChain = Promise.resolve();
  let _nextStrokeId = 1;
  const _strokeHandlers = new Map();   // id → { onPreview, onResult, onFail }

  function _workerUsable() {
    return !_workerBroken &&
      typeof Worker === "function" &&
      typeof OffscreenCanvas === "function" &&
      typeof createImageBitmap === "function" &&
      typeof Blob === "function" &&
      typeof URL !== "undefined" && typeof URL.createObjectURL === "function";
  }

  function _workerFail(reason) {
    _workerBroken = true;
    _lastWorkerError = reason;
    try { if (_worker) _worker.terminate(); } catch (e) {}
    _worker = null;
    _workerSlabVersion = -1;
    // I tratti in corso nel worker non arriveranno: chi li aspetta lo sa.
    const pending = Array.from(_strokeHandlers.values());
    _strokeHandlers.clear();
    pending.forEach(function (h) { try { h.onFail(); } catch (e) {} });
    console.warn("[cloneStampBrush] worker del timbro fermo, si continua sul filo principale:", reason);
  }
  let _lastWorkerError = null;

  function _ensureWorker() {
    if (_worker) return _worker;
    if (!_workerUsable()) return null;
    try {
      const url = URL.createObjectURL(new Blob([_workerSource()], { type: "text/javascript" }));
      _worker = new Worker(url);
      _worker.onmessage = _onWorkerMessage;
      _worker.onerror = function (ev) {
        _workerFail((ev && ev.message) || "errore del worker");
      };
      _workerSlabVersion = -1;
    } catch (e) {
      _workerFail((e && e.message) || String(e));
      return null;
    }
    return _worker;
  }

  function _wPost(msg, transfer) {
    _wChain = _wChain.then(function () {
      if (_worker) _worker.postMessage(msg, transfer || []);
    });
  }

  // La lastra al worker, se non e' gia' la sua. Si accoda: le impronte
  // che seguono aspettano che sia arrivata.
  function _wSyncSlab(sl) {
    if (!_worker || !sl || sl.version === _workerSlabVersion) return;
    _workerSlabVersion = sl.version;
    const el = sl.el;
    _wChain = _wChain.then(function () {
      return createImageBitmap(el).then(function (bm) {
        if (_worker) _worker.postMessage({ type: "slab", version: sl.version, bitmap: bm }, [bm]);
        else if (bm && bm.close) bm.close();
      });
    }).catch(function (e) {
      _workerFail("lastra: " + ((e && e.message) || e));
    });
  }

  function _onWorkerMessage(ev) {
    const m = ev && ev.data;
    if (!m) return;
    if (m.type === "error") {
      _workerFail(m.message || "errore nel worker");
      return;
    }
    const h = _strokeHandlers.get(m.id);
    if (!h) {
      if (m.bitmap && m.bitmap.close) m.bitmap.close();
      return;
    }
    if (m.type === "preview") { h.onPreview(m); return; }
    if (m.type === "result") { _strokeHandlers.delete(m.id); h.onResult(m); }
  }

  // ════════════════════════════════════════════════════════════════
  //  LA TELA DELL'ANTEPRIMA — Fetta 4A-1
  //
  //  Il tratto in corso (e quello appena finito, finche' non e' sul
  //  foglio) si vede su una tela SUA, messa nel contenitore di Fabric
  //  subito PRIMA della tela di sopra (contextTop). L'ordine nel DOM fa
  //  l'ordine a schermo: foglio, anteprima, anelli. Cosi' gli anelli di
  //  freehandTools.js restano sopra il tratto mentre si dipinge, e il
  //  contextTop si pulisce e basta.
  //  La tela e' grande quanto il foglio in pixel di lastra (× S), e a
  //  schermo quanto il foglio: lo zoom di Mosaica (una CSS transform sul
  //  foglio) la porta con se'.
  // ════════════════════════════════════════════════════════════════
  let _ovEl = null;
  let _ovCtx = null;
  let _ovLive = null;                 // { src, x, y, (sx, sy, w, h), opacity, owned } del tratto in corso
  let _ovLiveId = null;               // il tratto del worker a cui appartiene _ovLive
  const _ovPending = new Map();       // id → { src, x, y, opacity } dei tratti finiti non ancora sul foglio

  function _ensureOverlay(c) {
    if (!c || !c.wrapperEl) return null;
    const wLog = Math.max(1, Math.round(c.getWidth()));
    const hLog = Math.max(1, Math.round(c.getHeight()));
    const W = Math.max(1, Math.round(wLog * SLAB_SCALE));
    const H = Math.max(1, Math.round(hLog * SLAB_SCALE));
    if (_ovEl && (!_ovEl.parentNode || _ovEl.parentNode !== c.wrapperEl)) {
      try { if (_ovEl.parentNode) _ovEl.parentNode.removeChild(_ovEl); } catch (e) {}
      _ovEl = null;
      _ovCtx = null;
    }
    if (!_ovEl) {
      _ovEl = document.createElement("canvas");
      _ovEl.className = "mwp-stamp-preview";
      _ovEl.setAttribute("aria-hidden", "true");
      _ovEl.style.position = "absolute";
      _ovEl.style.left = "0px";
      _ovEl.style.top = "0px";
      _ovEl.style.pointerEvents = "none";
      const upper = c.upperCanvasEl;
      if (upper && upper.parentNode === c.wrapperEl) c.wrapperEl.insertBefore(_ovEl, upper);
      else c.wrapperEl.appendChild(_ovEl);
    }
    if (_ovEl.width !== W || _ovEl.height !== H) {
      _ovEl.width = W;
      _ovEl.height = H;
      _ovCtx = null;
    }
    _ovEl.style.width = wLog + "px";
    _ovEl.style.height = hLog + "px";
    if (!_ovCtx) _ovCtx = _ovEl.getContext("2d");
    return _ovEl;
  }

  function _paintOverlay() {
    if (!_ovEl || !_ovCtx) return;
    const ctx = _ovCtx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, _ovEl.width, _ovEl.height);
    const draw = function (it) {
      if (!it || !it.src) return;
      ctx.globalAlpha = it.opacity < 1 ? it.opacity : 1;
      try {
        if (it.w && it.h) ctx.drawImage(it.src, it.sx || 0, it.sy || 0, it.w, it.h, it.x, it.y, it.w, it.h);
        else ctx.drawImage(it.src, it.x, it.y);
      } catch (e) {}
      ctx.globalAlpha = 1;
    };
    _ovPending.forEach(draw);
    draw(_ovLive);
  }

  function _closeSrc(src) {
    if (src && typeof src.close === "function") { try { src.close(); } catch (e) {} }
  }

  function _setLive(item) {
    if (_ovLive && _ovLive.src !== (item && item.src) && _ovLive.owned) _closeSrc(_ovLive.src);
    _ovLive = item;
    _paintOverlay();
  }

  // ════════════════════════════════════════════════════════════════
  //  IL PNG UNA VOLTA SOLA — Fetta 4A-1, trappola 166
  //
  //  Fabric 5.1.0 / 5.2.4 / 5.3.0, fabric.Image.getSrc(): se l'elemento
  //  e' una tela, restituisce element.toDataURL(); e getSrc lo chiamano
  //  toObject/toJSON. Ogni fotografia dell'annulla e ogni salvataggio
  //  automatico ricodificavano in PNG tutti i tratti della sessione.
  //  La tela del tratto tiene il suo PNG. La funzione e' UNA, in
  //  freehandDrawing.js (la usa anche l'acquerello): qui la si chiama.
  //  Senza di lei il tratto funziona lo stesso, col costo di prima.
  // ════════════════════════════════════════════════════════════════
  function cachePngDataURL(el, url) {
    if (typeof window.cacheCanvasPngDataURL === "function") {
      try { return window.cacheCanvasPngDataURL(el, url); } catch (e) {}
    }
    return el;
  }

  // ════════════════════════════════════════════════════════════════
  //  IL PENNELLO
  //
  //  Una pennellata = UN oggetto, non un oggetto per impronta. E' la
  //  forma dell'acquerello (watercolorStampBrush.js
  //  _applyWorkerBitmapToFabric): si accumula fuori schermo, e alla fine
  //  nasce un solo fabric.Image ritagliato al suo rettangolo.
  // ════════════════════════════════════════════════════════════════
  let CloneStampBrush = null;

  // ── Le tele del percorso di riserva (filo principale) ────────────
  // Si riusano da un tratto all'altro: una tela d'accumulo grande quanto
  // la lastra (~14 MB per l'A4) allocata a OGNI tratto era lavoro buttato,
  // e una tela per ogni impronta anche (trappola 122, stessa famiglia).
  let _mainAccEl = null;
  const _mainScratchEls = [null, null];   // [normale, leggibile]

  function _mainAcc(W, H) {
    if (!_mainAccEl || _mainAccEl.width !== W || _mainAccEl.height !== H) {
      _mainAccEl = document.createElement("canvas");
      _mainAccEl.width = W;
      _mainAccEl.height = H;
    }
    const ctx = _mainAccEl.getContext("2d");
    if (!ctx) return null;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, W, H);
    return ctx;
  }

  // Il pezzo campionato: una tela di ESATTAMENTE px × px (trappola 168),
  // riusata finche' la punta non cambia misura. Due tele, perche' il modo
  // di una tela si decide la prima volta che le si chiede il contesto:
  // quella dei colori e' "leggibile" (Chromium la tiene in memoria
  // normale e la rilettura non fa un viaggio sulla scheda video), l'altra
  // no (la copia resta sulla scheda video).
  function _mainScratch(px, readable) {
    const k = readable ? 1 : 0;
    let el = _mainScratchEls[k];
    if (!el || el.width !== px || el.height !== px) {
      el = document.createElement("canvas");
      el.width = px;
      el.height = px;
      if (readable) el.getContext("2d", { willReadFrequently: true });
      else el.getContext("2d");
      _mainScratchEls[k] = el;
    }
    return el;
  }

  function _nextFrame(fn) {
    if (typeof requestAnimationFrame === "function") return requestAnimationFrame(fn);
    return setTimeout(fn, 16);
  }

  function _cancelFrame(h) {
    if (!h) return;
    if (typeof cancelAnimationFrame === "function") cancelAnimationFrame(h);
    else clearTimeout(h);
  }

  // ⚠ IL LIVELLO PRIMA DELLA FOTOGRAFIA (trappola 167). reorderCanvasLayers
  //   di freehandDrawing.js sistema l'ordine un fotogramma DOPO l'aggiunta
  //   (object:added → requestAnimationFrame), ma la fotografia dell'annulla
  //   si scattava SUBITO: nella storia il tratto restava in cima, SOPRA le
  //   tessere. Dopo un annulla/ripristino (e in un progetto salvato subito
  //   dopo) il timbro compariva sopra le tessere finche' qualcosa non
  //   rifaceva l'ordine. Qui lo si sistema prima di fotografare.
  function _reorderNow() {
    try {
      if (typeof window.reorderCanvasLayers === "function") window.reorderCanvasLayers();
    } catch (e) {}
  }

  // Un tratto finito diventa UN fabric.Image, ritagliato al suo rettangolo
  // (x0, y0 in pixel di lastra).
  function _makeStrokeImage(el, x0, y0, opacity) {
    const S = SLAB_SCALE;
    return new fabric.Image(el, {
      left: x0 / S,
      top: y0 / S,
      scaleX: 1 / S,
      scaleY: 1 / S,
      originX: "left",
      originY: "top",
      selectable: false,
      evented: false,
      hasControls: false,
      hasBorders: false,
      lockMovementX: true,
      lockMovementY: true,
      lockScalingX: true,
      lockScalingY: true,
      lockRotation: true,
      hoverCursor: "default",

      // ⚠ Il timbro NON si fonde con quello che ha sotto:
      //   "source-over", non l'"overlay" dell'acquerello. Sta sopra lo
      //   sfondo e sotto penna e acquerello (quarta fascia), e resta
      //   un oggetto suo, mai fuso nel raster di un altro tratto.
      //   L'acquerello passato SOPRA un timbro si mescolera' con lui,
      //   perche' l'acquerello e' "overlay" per costruzione: e' il
      //   prezzo dichiarato del "sotto l'acquerello" (trappola 119).
      globalCompositeOperation: "source-over",

      // La trasparenza (Fetta 3) e' l'opacity dell'OGGETTO, non dei
      // pixel: le impronte sovrapposte non si scuriscono a vicenda, e
      // "opacity" e' gia' in tutte le liste di serializzazione e negli
      // export (PNG, PDF e SVG la rispettano: verificato su Fabric).
      opacity: opacity,

      // Identita' del tratto: __isFreehand perche' lo riconoscano
      // isWatercolorOrFreehand, l'export e il ritaglio del perimetro;
      // e data.mwpStamp per distinguerlo da penna e acquerello nella
      // quarta fascia. ⚠ NIENTE marcatori nuovi tipo __isStamp: non
      // sono nelle liste di serializzazione e non sopravvivrebbero a
      // CTRL+Z (trappola 117). "data" e "__isFreehand" ci sono
      // entrambi in tutte le liste: nessuna lista cresce.
      __isFreehand: true,
      data: { mwpStamp: 1 }
    });
  }

  // Il tratto sul foglio: al suo livello, POI la fotografia, poi il
  // disegno. L'anteprima del tratto sparisce nel fotogramma in cui il
  // tratto e' disegnato: il suo requestAnimationFrame e' registrato dopo
  // quello di requestRenderAll, quindi gira dopo, nello stesso fotogramma.
  function _commitStroke(c, img, pendingId) {
    img.__addedAt = Date.now();
    c.add(img);
    _reorderNow();
    _pushState();
    if (typeof c.requestRenderAll === "function") c.requestRenderAll();
    else if (typeof c.renderAll === "function") c.renderAll();
    if (pendingId != null) {
      _nextFrame(function () {
        const it = _ovPending.get(pendingId);
        _ovPending.delete(pendingId);
        if (it && it.owned) _closeSrc(it.src);
        _paintOverlay();
      });
    }
    return img;
  }

  function _dropPending(id) {
    const it = _ovPending.get(id);
    _ovPending.delete(id);
    if (it && it.owned) _closeSrc(it.src);
    _paintOverlay();
  }

  // Il risultato del worker: il ritaglio (bitmap) diventa la tela del
  // tratto, col suo PNG gia' pronto.
  function _deliverWorkerResult(c, m, opacity) {
    if (!c || m.empty || !m.bitmap) {
      if (m.bitmap && m.bitmap.close) m.bitmap.close();
      _dropPending(m.id);
      return null;
    }
    const el = document.createElement("canvas");
    el.width = m.w;
    el.height = m.h;
    const ctx = el.getContext("2d");
    if (!ctx) { _dropPending(m.id); return null; }
    ctx.drawImage(m.bitmap, 0, 0);
    if (m.bitmap.close) m.bitmap.close();
    cachePngDataURL(el, m.dataURL);
    return _commitStroke(c, _makeStrokeImage(el, m.x, m.y, opacity), m.id);
  }

  function defineBrush() {
    if (CloneStampBrush) return CloneStampBrush;
    if (typeof fabric === "undefined" || !fabric || !fabric.BaseBrush) return null;

    CloneStampBrush = class CloneStampBrush extends fabric.BaseBrush {
      constructor(c) {
        super(c);
        // ⚠ fabric.BaseBrush non ha un initialize suo: createClass gli
        //   mette una funzione VUOTA, quindi super() NON assegna
        //   this.canvas (a differenza di PencilBrush, che invece lo fa).
        //   Verificato su 5.1.0, 5.2.4 e 5.3.0 — trappola 126.
        this.canvas = c;
        this.name = "clone-stamp";
        this._painting = false;
        this._picking = false;
        this._mode = null;        // "worker" | "main", deciso a inizio tratto
        this._strokeId = null;
        this._queue = [];
        this._flushH = 0;
        this._slab = null;
        this._sizeLog = 1;
        this._stepPx = 1;
        // Fetta 4A-2: la punta di questo tratto e la direzione della mano
        this._tip = null;
        this._follow = false;     // la punta segue il tratto?
        this._rot = 0;            // la Rotazione, fotografata a inizio tratto
        this._dir = null;         // direzione smussata (null = non si sa ancora)
        this._dirFrom = null;     // da dove si misura il prossimo campione
        this._dirSeg = 1;         // quanto deve muoversi la mano per dirla
        this._pendingFirst = null; // la prima impronta che aspetta la direzione
        this._accCtx = null;
        this._bbox = null;
        this._last = null;
        this._stamped = false;
        this._color = null;
      }

      // ── misure e sorgente: si chiedono, non si ricalcolano ────
      // Il conto sta nel modulo (_tipLogicalPx / _sourceForPoint) ed e'
      // lo stesso che legge l'overlay degli anelli.
      _tipLogical() { return _tipLogicalPx(); }

      _offsetLogical() { return _offsetLogicalPx(); }

      _sourceFor(p) { return _sourceForPoint(p); }

      // ── la direzione del tratto (Fetta 4A-2) ──────────────────
      // Si campiona solo quando la mano si e' spostata di almeno un quarto
      // della punta (e comunque qualche pixel), poi si smussa: sotto quella
      // soglia il tremolio farebbe girare una punta a spigoli vivi e il
      // bordo del tratto uscirebbe frastagliato. Restituisce true se la
      // direzione e' stata aggiornata.
      _trackDir(p) {
        if (!p) return false;
        const f = this._dirFrom || p;
        const dx = p.x - f.x, dy = p.y - f.y;
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d < this._dirSeg) return false;
        this._dir = _smoothAngle(this._dir, Math.atan2(dy, dx));
        this._dirFrom = { x: p.x, y: p.y };
        _liveDirRad = this._dir;
        return true;
      }

      // L'angolo di un'impronta: la Rotazione dello slider, piu' la
      // direzione del tratto se la punta la segue. Finche' la direzione non
      // si sa, vale la sola Rotazione (l'orientamento di riposo).
      _stampAngle() {
        return this._rot + (this._follow && this._dir !== null ? this._dir : 0);
      }

      // La prima impronta, quella rimasta in attesa della direzione, cade
      // dove la mano aveva premuto: e' il capo del tratto, e si guarda.
      _flushFirst() {
        const f = this._pendingFirst;
        if (!f) return false;
        this._pendingFirst = null;
        this._stampAt(f);
        this._last = { x: f.x, y: f.y };
        return true;
      }

      _clearTop() {
        const c = this.canvas;
        if (!c || !c.contextTop) return;
        try {
          if (typeof c.clearContext === "function") c.clearContext(c.contextTop);
          else c.contextTop.clearRect(0, 0, c.getWidth(), c.getHeight());
        } catch (e) {}
      }

      // ⚠ PIENA RESA. E' la bandiera che freehandTools.js guarda
      //   (_brushIsFullRender) per decidere se puo' sovrapporre i suoi
      //   anelli al tratto MENTRE si dipinge. Dicendo "si'" ci impegniamo
      //   a ripulire il contextTop a OGNI movimento, anche quando non
      //   abbiamo depositato nessuna impronta nuova: se non lo facessimo,
      //   gli anelli lascerebbero una scia di cerchi.
      needsFullRender() { return true; }

      // Dalla Fetta 4A-1 il tratto NON sta piu' sul contextTop: sta sulla
      // tela dell'anteprima, sotto gli anelli. Qui si ripulisce il
      // contextTop (per gli anelli, a ogni movimento: trappole 135, 136,
      // 139) e, nel percorso di riserva, si posa l'accumulo sull'anteprima.
      // Nel percorso del worker l'anteprima la aggiornano i suoi messaggi.
      _repaintTop() {
        this._clearTop();
        if (this._mode !== "main" || !this._painting) return;
        const bb = this._bbox;
        if (!bb || !this._stamped || !_mainAccEl) return;
        const x0 = Math.max(0, Math.floor(bb.x0));
        const y0 = Math.max(0, Math.floor(bb.y0));
        const x1 = Math.min(_mainAccEl.width, Math.ceil(bb.x1));
        const y1 = Math.min(_mainAccEl.height, Math.ceil(bb.y1));
        if (x1 <= x0 || y1 <= y0) return;
        _setLive({
          src: _mainAccEl, sx: x0, sy: y0, w: x1 - x0, h: y1 - y0, x: x0, y: y0,
          opacity: this._color ? this._color.opacity : 1, owned: false
        });
      }

      // ── FABRIC: mouse down ──────────────────────────────────────
      onMouseDown(pointer, options) {
        const c = this.canvas;
        if (!c || !pointer) return;
        if (_altPanning()) return;

        const ev = options && options.e;

        // Ctrl+Click = prendi la sorgente (§5, strada (a)).
        // ⚠ Con un pennello in mano canvas.isDrawingMode e' acceso, e in
        //   quella condizione il percorso drawing-mode di Fabric non
        //   guarda ne' ctrlKey ne' selectionKey: verificato dentro il
        //   sorgente di 5.1.0, 5.2.4 e 5.3.0. Quindi qui Ctrl e' libero,
        //   e FUORI dallo strumento continua a fare la multi-selezione
        //   delle tessere come sempre, perche' non gliela tocchiamo.
        //   Il contagocce armato (pulsante "prendi sorgente" o "Fissa"
        //   dell'inspector, §4.6) fa esattamente la stessa cosa senza
        //   tasti, e si disarma da se' dopo il click, riuscito o no, per
        //   non restare incastrato.
        if ((ev && (ev.ctrlKey || ev.metaKey)) || pickArmed) {
          this._picking = true;   // Fabric ha gia' alzato _isCurrentlyDrawing
          if (pickArmed) disarmPick(true);
          takeSource(pointer);
          this._repaintTop();
          return;
        }

        if (!hasBackground(c)) {
          _toast("stamp.toast.noBackground",
            "\uD83D\uDDBC\uFE0F Niente da copiare: non c'\u00e8 n\u00e9 un'immagine di sfondo n\u00e9 la carta");
          return;
        }

        this._beginStroke(pointer);
      }

      // ── FABRIC: mouse move ──────────────────────────────────────
      onMouseMove(pointer, options) {
        // ⚠ Siamo a PIENA RESA, e questo vuol dire che il clear del
        //   contextTop e' nostro SEMPRE — anche nei movimenti in cui non
        //   stiamo dipingendo: un Ctrl+Click con la mano che si muove, un
        //   gesto rifiutato perche' manca lo sfondo. Se in quei casi non
        //   ripulissimo, freehandTools.js ci disegnerebbe gli anelli sopra
        //   senza pulire e lascerebbe una scia di cerchi a ogni pixel.
        if (this._picking || !this._painting || !pointer) { this._repaintTop(); return; }
        if (_altPanning()) { this._abortStroke(); return; }

        // ⚠ Con la punta che segue il tratto la prima impronta ASPETTA: la
        //   direzione la dice la mano, e al momento della pressione non
        //   c'era. E' la ricetta delle punte piatte dell'acquerello. Finche'
        //   non si sa, non si deposita niente — ma il contextTop si
        //   ripulisce lo stesso, perche' la piena resa e' un impegno.
        if (this._follow) {
          this._trackDir(pointer);
          if (this._dir === null) { this._repaintTop(); return; }
          this._flushFirst();
        }

        const step = this._stepPx;
        const last = this._last || pointer;
        const dx = pointer.x - last.x;
        const dy = pointer.y - last.y;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (dist >= step) {
          // Interpolazione: un gesto veloce non deve lasciare buchi.
          const n = Math.floor(dist / step);
          for (let i = 1; i <= n; i++) {
            const t = (i * step) / dist;
            this._stampAt({ x: last.x + dx * t, y: last.y + dy * t });
          }
          const tEnd = (n * step) / dist;
          this._last = { x: last.x + dx * tEnd, y: last.y + dy * tEnd };
        }

        // ⚠ SEMPRE, anche se non e' nata nessuna impronta nuova.
        this._repaintTop();
      }

      // ── FABRIC: mouse up ────────────────────────────────────────
      // ⚠ Il valore restituito diventa canvas._isCurrentlyDrawing:
      //   deve essere falso, o Fabric resta convinto che stiamo ancora
      //   disegnando. Identico su tutte e tre le versioni.
      onMouseUp(options) {
        if (this._picking) { this._picking = false; return false; }
        if (!this._painting) return false;

        // Un'ultima impronta esattamente dove l'utente stacca il dito:
        // senza questa il tratto finirebbe sull'ultimo punto della
        // griglia del passo, fino a un passo prima. E' il bordo del
        // tratto, ed e' quello che si guarda.
        // ⚠ Fetta 4A-2: se la mano non ha mai detto la direzione (un click
        //   secco, o un tratto piu' corto della soglia) la prima impronta
        //   esce adesso, con l'orientamento di RIPOSO: la sola Rotazione.
        const p = options && options.pointer;
        if (!_altPanning()) {
          if (this._follow && p) this._trackDir(p);
          this._flushFirst();
          if (p) this._stampAt(p);
        }

        this._painting = false;
        this._clearTop();
        if (this._mode === "worker") this._endWorkerStroke();
        else this._finalizeMain();
        return false;
      }

      // ── un tratto ───────────────────────────────────────────────
      _beginStroke(p) {
        const c = this.canvas;
        // La firma della lastra si controlla QUI, una volta per tratto:
        // mentre si dipinge lo sfondo non cambia (e se cambiasse, gli
        // ascoltatori di object:* buttano la lastra per il tratto dopo).
        const sl = ensureSlab(c);
        if (!sl) return;
        if (!_ensureOverlay(c)) return;

        this._slab = sl;
        // La punta di QUESTO tratto si fotografa adesso, forma compresa: un
        // tratto e' una cosa sola, anche se qualcuno muovesse gli slider
        // mentre si dipinge (come i colori, qui sotto).
        this._tip = _tipGeom();
        this._sizeLog = this._tip.w;
        this._stepPx = Math.max(1, this._sizeLog * spacing);
        this._follow = _followsStroke();
        this._rot = _rotRad();
        this._dir = null;
        this._dirFrom = { x: p.x, y: p.y };
        this._dirSeg = Math.max(DIR_MIN_PX, this._sizeLog * DIR_MIN_FRACTION);
        this._pendingFirst = this._follow ? { x: p.x, y: p.y } : null;
        _liveDirRad = null;
        this._bbox = null;
        this._stamped = false;
        this._last = null;
        this._queue = [];
        // I colori si fotografano all'inizio del tratto: un tratto e' una
        // cosa sola, anche se qualcuno li cambiasse mentre si dipinge.
        this._color = _colorParams();

        // ⚠ Qui NON si tocca la sorgente. Nella 2A il primo tocco
        //   trasformava un Ctrl+Click in uno scostamento che poi seguiva
        //   il pennello: bocciato da Mirko in collaudo (trappola 138). La
        //   sorgente la decide _sourceForPoint, e basta.
        const W = sl.el.width;
        const H = sl.el.height;
        if (_ensureWorker()) {
          const self = this;
          const id = _nextStrokeId++;
          const op = this._color.opacity;
          this._mode = "worker";
          this._strokeId = id;
          _ovLiveId = id;
          _strokeHandlers.set(id, {
            onPreview: function (m) {
              const item = { src: m.bitmap, x: m.x, y: m.y, opacity: op, owned: true };
              if (_ovPending.has(id)) {
                const old = _ovPending.get(id);
                if (old && old.owned) _closeSrc(old.src);
                _ovPending.set(id, item);
                _paintOverlay();
              } else if (_ovLiveId === id) {
                _setLive(item);
              } else {
                _closeSrc(m.bitmap);
              }
            },
            onResult: function (m) { _deliverWorkerResult(self.canvas, m, op); },
            onFail: function () {
              _dropPending(id);
              if (self._strokeId === id) self._abortStroke();
            }
          });
          _wSyncSlab(sl);
          _wPost({
            type: "start", id: id, scale: SLAB_SCALE, sizeLog: this._sizeLog,
            tip: this._tip, color: this._color, w: W, h: H
          });
        } else {
          this._mode = "main";
          this._strokeId = null;
          this._accCtx = _mainAcc(W, H);
          if (!this._accCtx) return;
        }
        this._painting = true;

        // La punta che NON segue il tratto non ha niente da aspettare: la
        // prima impronta cade subito, come dalla Fetta 1.
        if (!this._follow) this._stampAt(p);
        this._repaintTop();
        this._last = { x: p.x, y: p.y };
      }

      _abortStroke() {
        const id = this._strokeId;
        if (this._mode === "worker" && id != null) {
          if (this._flushH) { _cancelFrame(this._flushH); this._flushH = 0; }
          _strokeHandlers.delete(id);
          _wPost({ type: "cancel", id: id });
        }
        if (_ovLiveId === id || this._mode === "main") { _ovLiveId = null; _setLive(null); }
        this._painting = false;
        this._mode = null;
        this._strokeId = null;
        this._queue = [];
        this._color = null;
        this._accCtx = null;
        this._slab = null;
        this._bbox = null;
        this._last = null;
        this._stamped = false;
        this._tip = null;
        this._dir = null;
        this._pendingFirst = null;
        _liveDirRad = null;
        this._clearTop();
      }

      _growBBox(b) {
        if (!this._bbox) {
          this._bbox = { x0: b.x0, y0: b.y0, x1: b.x1, y1: b.y1 };
          return;
        }
        const bb = this._bbox;
        if (b.x0 < bb.x0) bb.x0 = b.x0;
        if (b.y0 < bb.y0) bb.y0 = b.y0;
        if (b.x1 > bb.x1) bb.x1 = b.x1;
        if (b.y1 > bb.y1) bb.y1 = b.y1;
      }

      // Una impronta alla punta p. Nel percorso del worker si ACCODA e
      // parte col pacchetto del fotogramma; nel percorso di riserva si
      // deposita subito. Il conto e' lo stesso: stampOnto.
      _stampAt(p) {
        if (!this._slab || !this._tip) return false;
        const src = this._sourceFor(p);
        if (!src) return false;
        const a = this._stampAngle();
        if (this._mode === "worker") {
          this._queue.push({ p: { x: p.x, y: p.y }, s: { x: src.x, y: src.y }, a: a });
          this._stamped = true;
          this._scheduleFlush();
          return true;
        }
        if (!this._accCtx) return false;
        const b = stampOnto(this._accCtx, this._slab.el, SLAB_SCALE, p, src, this._tip, a, this._color, _mainScratch);
        if (!b) return false;
        this._growBBox(b);
        this._stamped = true;
        return true;
      }

      _scheduleFlush() {
        if (this._flushH) return;
        const self = this;
        this._flushH = _nextFrame(function () {
          self._flushH = 0;
          self._flush();
        });
      }

      _flush() {
        if (this._strokeId == null || !this._queue.length) return;
        const list = this._queue;
        this._queue = [];
        _wPost({ type: "stamps", id: this._strokeId, list: list, throttle: PREVIEW_THROTTLE_MS });
      }

      // Fine tratto nel worker: l'ultimo pacchetto, poi "fine". L'anteprima
      // del tratto resta a schermo (fra i "finiti") finche' il tratto non
      // e' sul foglio.
      _endWorkerStroke() {
        const id = this._strokeId;
        if (this._flushH) { _cancelFrame(this._flushH); this._flushH = 0; }
        this._flush();
        if (_ovLiveId === id) {
          // Anche senza un'anteprima ancora arrivata si prenota il posto:
          // un'anteprima in ritardo va fra i "finiti", non si perde.
          _ovPending.set(id, _ovLive || { src: null, x: 0, y: 0, opacity: 1, owned: false });
          _ovLive = null;
          _ovLiveId = null;
          _paintOverlay();
        }
        _wPost({ type: "end", id: id });
        this._strokeId = null;
        this._mode = null;
        this._slab = null;
        this._color = null;
        this._tip = null;
        this._dir = null;
        this._pendingFirst = null;
        _liveDirRad = null;
      }

      // Fine tratto nel percorso di riserva: ritaglia l'accumulo e
      // consegna al canvas UN solo fabric.Image.
      _finalizeMain() {
        const c = this.canvas;
        const acc = _mainAccEl;
        const bb = this._bbox;
        const stamped = this._stamped;
        const col = this._color || _colorParams();

        this._mode = null;
        this._color = null;
        this._accCtx = null;
        this._slab = null;
        this._bbox = null;
        this._last = null;
        this._stamped = false;
        this._tip = null;
        this._dir = null;
        this._pendingFirst = null;
        _liveDirRad = null;
        _setLive(null);

        if (!c || !acc || !bb || !stamped) return null;

        const x0 = Math.max(0, Math.floor(bb.x0));
        const y0 = Math.max(0, Math.floor(bb.y0));
        const x1 = Math.min(acc.width, Math.ceil(bb.x1));
        const y1 = Math.min(acc.height, Math.ceil(bb.y1));
        const w = x1 - x0;
        const h = y1 - y0;
        if (w <= 0 || h <= 0) return null;

        const out = document.createElement("canvas");
        out.width = w;
        out.height = h;
        const octx = out.getContext("2d");
        if (!octx) return null;
        octx.drawImage(acc, x0, y0, w, h, 0, 0, w, h);
        // Il PNG si fa la prima volta che serve (la fotografia qui sotto),
        // e poi mai piu' (trappola 166).
        cachePngDataURL(out, null);

        const img = _makeStrokeImage(out, x0, y0, col.opacity);
        const pid = "main-" + (_nextStrokeId++);
        _ovPending.set(pid, { src: out, x: x0, y: y0, opacity: col.opacity, owned: false });
        _paintOverlay();
        return _commitStroke(c, img, pid);
      }
    };

    window.CloneStampBrush = CloneStampBrush;
    return CloneStampBrush;
  }

  // La lastra pronta, e gia' nel worker: il primo tratto non aspetta.
  function _prepareSlab(c) {
    const sl = ensureSlab(c);
    if (sl && _ensureWorker()) _wSyncSlab(sl);
    return sl;
  }

  // ════════════════════════════════════════════════════════════════
  //  PRENDERE LA SORGENTE
  // ════════════════════════════════════════════════════════════════
  function takeSource(p) {
    const c = _c();
    if (!c || !p) return false;
    if (!hasBackground(c)) {
      _toast("stamp.toast.noBackground",
        "\uD83D\uDDBC\uFE0F Niente da copiare: non c'\u00e8 n\u00e9 un'immagine di sfondo n\u00e9 la carta");
      return false;
    }
    // Scegliere una sorgente vuol dire FISSARLA (§4.1-bis): l'interruttore
    // passa da solo su "Fissa", cosi' l'inspector dice il vero.
    fixedSource = { x: p.x, y: p.y };
    anchored = false;
    _prepareSlab(c);
    _syncUI();
    _toast("stamp.toast.sourceTaken",
      "\uD83D\uDDBC\uFE0F Sorgente fissa presa \u2014 ora dipingi: copi sempre da l\u00ec. \u00abAgganciata\u00bb la libera");
    return true;
  }

  // ════════════════════════════════════════════════════════════════
  //  ACCENSIONE E SPEGNIMENTO
  // ════════════════════════════════════════════════════════════════
  function installBrush() {
    const c = _c();
    const K = defineBrush();
    if (!c || !K) return false;
    c.freeDrawingBrush = new K(c);
    c.freeDrawingCursor = pickArmed ? PICK_CURSOR : PAINT_CURSOR;
    return true;
  }

  // ⚠ applyBrushSettings() di freehandDrawing.js decide il pennello in
  //   base a isEraserMode / isWatercolorMode, e viene richiamata da ogni
  //   slider del disegno: senza questo involucro, muovere uno slider
  //   mentre il timbro e' in mano ci sostituirebbe la penna sotto le
  //   dita. E' una dichiarazione `function` di primo livello in uno
  //   <script> classico, quindi il nome globale E' la proprieta' di
  //   window: riscriverla intercetta anche le chiamate che
  //   freehandDrawing.js fa a se stesso. Si avvolge, non si riscrive.
  let _origApplyBrushSettings = null;

  function wrapApplyBrushSettings() {
    if (_origApplyBrushSettings) return true;
    if (typeof window.applyBrushSettings !== "function") return false;
    _origApplyBrushSettings = window.applyBrushSettings;
    window.applyBrushSettings = function () {
      if (stampMode) { installBrush(); return; }
      return _origApplyBrushSettings.apply(this, arguments);
    };
    return true;
  }

  // Spegne penna / gomma / acquerello senza passare dai loro toggle
  // (che farebbero partire i loro avvisi e bloccherebbero i tratti).
  // Le tre variabili sono `let` di primo livello di freehandDrawing.js:
  // stesso ambito lessicale globale, quindi assegnabili da qui.
  function _yieldOtherFreehandModes() {
    try { if (typeof isEraserMode !== "undefined") isEraserMode = false; } catch (e) {}
    try { if (typeof isWatercolorMode !== "undefined") isWatercolorMode = false; } catch (e) {}
    try { if (typeof isFreehandMode !== "undefined") isFreehandMode = false; } catch (e) {}
    ["freehandBtn", "eraserBtn", "watercolorBtn"].forEach(function (id) {
      const b = document.getElementById(id);
      if (b) b.classList.remove("active");
    });
    if (typeof window.clearFreehandStrokeCircle === "function") {
      try { window.clearFreehandStrokeCircle(); } catch (e) {}
    }
  }

  // Lazo o pennello selezione accesi? Si contendono il contextTop col
  // timbro e, peggio, allo spegnimento rimettono selectable/evented =
  // true a ogni oggetto nato MENTRE erano accesi (lassoSelection.js
  // deactivateLasso, e il suo gemello in lassoBrushSelection.js): un
  // tratto di timbro dipinto in quel momento diventerebbe trascinabile e
  // copiabile, e un copia/incolla perderebbe data.mwpStamp (trappola 117
  // da teorica a pratica). E' lo stesso controllo del perimetro
  // (freehandTools.js _lassoBusy), dalle stesse due funzioni pubbliche.
  // Trappola 137.
  function _lassoBusy() {
    try {
      if (typeof window.isLassoMode === "function" && window.isLassoMode()) return true;
    } catch (e) {}
    try {
      if (typeof window.isBrushSelectionMode === "function" && window.isBrushSelectionMode()) return true;
    } catch (e) {}
    return false;
  }

  function _refreshInspector() {
    if (typeof window.refreshInspectorContext === "function") {
      try { window.refreshInspectorContext(); } catch (e) {}
    }
  }

  function activate() {
    const c = _c();
    if (!c) return false;

    // Come il perimetro (decisione 1 del suo cantiere): col lazo o col
    // pennello selezione accesi il timbro NON si accende, e lo dice. Il
    // contrario (timbro in mano, click sul lazo) resta com'e': il timbro
    // si fa da parte in silenzio, perche' chi clicca il lazo vuole il
    // lazo — vedi _attachYieldListener.
    if (_lassoBusy()) {
      _toast("stamp.toast.blockedByLasso",
        "\uD83D\uDDBC\uFE0F Chiudi prima il lazo o il pennello selezione: usano lo stesso strato di disegno del timbro");
      return false;
    }

    // §4.7 — se non c'e' niente da copiare il pennello non si accende.
    // La condizione si LEGGE dal canvas, non da una flag da tenere
    // aggiornata. E il timbro non crea mai uno sfondo da se': in Mosaica
    // niente compare sul foglio senza che l'abbia deciso Mirko.
    if (!hasBackground(c)) {
      _toast("stamp.toast.noBackground",
        "\uD83D\uDDBC\uFE0F Niente da copiare: non c'\u00e8 n\u00e9 un'immagine di sfondo n\u00e9 la carta");
      return false;
    }
    if (!defineBrush()) return false;

    _yieldOtherFreehandModes();
    stampMode = true;
    _prepareSlab(c);

    if (typeof c.getActiveObject === "function" && c.getActiveObject()) {
      c.discardActiveObject();
      if (typeof c.requestRenderAll === "function") c.requestRenderAll();
    }

    c.isDrawingMode = true;
    installBrush();

    const b = _btn();
    if (b) { b.classList.add("active"); b.setAttribute("aria-pressed", "true"); }
    // Il "Seleziona" non resta acceso accanto al timbro (lo spengono
    // anche lazo e pennello selezione al loro avvio).
    const sel = document.getElementById("selectToolBtn");
    if (sel) sel.classList.remove("active");

    // L'inspector passa alla sezione del timbro: la sceglie index.html
    // (refreshInspectorContext) leggendo il pulsante, gia' acceso qui sopra.
    _syncUI();
    _refreshInspector();

    _toast("stamp.toast.on",
      "\uD83D\uDDBC\uFE0F Pennello Timbro attivo \u2014 Ctrl+Click sceglie il pezzo da copiare");
    return true;
  }

  function deactivate(silent) {
    const c = _c();
    // ⚠ PRIMA di spegnere: disarmPick rimette "Agganciata" se il
    //   contagocce era stato armato da "Fissa" senza scegliere niente.
    //   La sorgente fissa scelta invece RESTA: riprendendo il timbro in
    //   mano sullo stesso foglio la si ritrova dov'era.
    if (pickArmed) disarmPick(true);
    stampMode = false;

    if (c) {
      try {
        if (c.contextTop) {
          if (typeof c.clearContext === "function") c.clearContext(c.contextTop);
          else c.contextTop.clearRect(0, 0, c.getWidth(), c.getHeight());
        }
      } catch (e) {}
      c.isDrawingMode = false;
    }

    const b = _btn();
    if (b) { b.classList.remove("active"); b.setAttribute("aria-pressed", "false"); }

    // Anche quando ci si fa da parte in silenzio (click sul lazo, che non
    // aggiorna l'inspector da se'): la sezione del timbro non deve restare
    // in vista con il timbro riposto.
    _refreshInspector();

    if (!silent) {
      _toast("stamp.toast.off", "\uD83D\uDDBC\uFE0F Pennello Timbro riposto");
    }
    return true;
  }

  // ════════════════════════════════════════════════════════════════
  //  IL CONTAGOCCE — il pulsante "prendi sorgente" (§4.6) e "Fissa"
  //  E' la via senza tasti: si arma, il click dopo sul foglio prende la
  //  sorgente come farebbe Ctrl+Click. Si disarma da se' dopo quel
  //  click, con Esc, con un secondo click sul pulsante, con "Agganciata",
  //  o riponendo il timbro.
  // ════════════════════════════════════════════════════════════════
  function _setCursor(cur) {
    const c = _c();
    if (!c) return;
    c.freeDrawingCursor = cur;
    try { if (typeof c.setCursor === "function" && c.isDrawingMode) c.setCursor(cur); } catch (e) {}
  }

  function armPick() {
    if (!stampMode) return false;
    if (pickArmed) return true;
    const c = _c();
    if (!hasBackground(c)) {
      _toast("stamp.toast.noBackground",
        "\uD83D\uDDBC\uFE0F Niente da copiare: non c'\u00e8 n\u00e9 un'immagine di sfondo n\u00e9 la carta");
      return false;
    }
    pickArmed = true;
    _setCursor(PICK_CURSOR);
    _syncUI();
    _toast("stamp.toast.pickArmed",
      "\uD83D\uDDBC\uFE0F Clicca sul pezzo da copiare: diventa la sorgente fissa \u2014 Esc annulla");
    return true;
  }

  function disarmPick(silent) {
    if (!pickArmed) return false;
    pickArmed = false;
    _setCursor(PAINT_CURSOR);
    // "Fissa" chiesta e poi abbandonata senza scegliere niente: non
    // esiste una fissa senza sorgente (invariante in testa al modulo).
    if (!anchored && !fixedSource) anchored = true;
    _syncUI();
    if (!silent) {
      _toast("stamp.toast.pickCancelled", "\uD83D\uDDBC\uFE0F Contagocce annullato");
    }
    return true;
  }

  function togglePick() {
    return pickArmed ? disarmPick(false) : armPick();
  }

  // Esc disarma il contagocce. ⚠ Esc in Mosaica ha gia' un mestiere:
  //   renderer.js lo usa per USCIRE DALLO SCHERMO INTERO quando non ci
  //   sono modali aperti. Quindi si ascolta in fase CAPTURE (come il
  //   perimetro e la lente) e si ferma l'evento — ma SOLO mentre il
  //   contagocce e' armato, e mai se c'e' un modale aperto o si sta
  //   scrivendo in un campo: in quei casi Esc e' di qualcun altro.
  function _modalOpen() {
    try {
      const list = document.querySelectorAll('div[id$="Modal"]');
      for (let i = 0; i < list.length; i++) {
        const el = list[i];
        const inline = el.style.display;
        if (inline === "none") continue;
        if (inline && inline !== "") return true;
        if (getComputedStyle(el).display !== "none") return true;
      }
    } catch (e) {}
    return false;
  }

  function _onKeyDown(e) {
    if (!pickArmed || e.key !== "Escape") return;
    const ae = document.activeElement;
    const tag = ae && ae.tagName ? ae.tagName.toUpperCase() : "";
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || (ae && ae.isContentEditable)) return;
    if (_modalOpen()) return;
    e.preventDefault();
    e.stopPropagation();
    if (typeof e.stopImmediatePropagation === "function") e.stopImmediatePropagation();
    disarmPick(false);
  }

  function _attachKeyListener() {
    if (window.__mwpStampKeyBound) return;
    window.__mwpStampKeyBound = true;
    document.addEventListener("keydown", _onKeyDown, true);  // capture
  }

  // ════════════════════════════════════════════════════════════════
  //  I COMANDI (usati dall'inspector e dall'API)
  //  Ogni setter limita il valore, aggiorna l'inspector e salva (salvo
  //  opts.persist === false, che serve al caricamento).
  // ════════════════════════════════════════════════════════════════
  function _clamp(v, lo, hi) {
    return Math.max(lo, Math.min(hi, v));
  }

  // ⚠ UN SOLO comando dimensione: muove la punta E il lato della
  //   sorgente insieme, perche' sono la stessa misura (§4.2).
  function setTipMM(mm, opts) {
    const v = Number(mm);
    if (!isFinite(v) || v <= 0) return tipMM;
    tipMM = _clamp(v, TIP_MM_MIN, TIP_MM_MAX);
    _syncUI();
    if (!opts || opts.persist !== false) _saveSettings();
    return tipMM;
  }

  // La distanza della sorgente AGGANCIATA. ⚠ Con la sorgente fissa NON
  // la sblocca: cambia solo la distanza che varra' tornando ad
  // agganciata (l'inspector la mostra attenuata). Una sorgente scelta si
  // libera solo con "Agganciata" o scegliendone un'altra: toccare uno
  // slider per sbaglio non deve buttarla via (§4.1-bis).
  function setOffsetXMM(mm, opts) {
    const v = Number(mm);
    if (!isFinite(v)) return offsetXMM;
    offsetXMM = _clamp(v, OFFSET_X_MM_MIN, OFFSET_X_MM_MAX);
    _syncUI();
    if (!opts || opts.persist !== false) _saveSettings();
    return offsetXMM;
  }

  // SPAZIATURA (Fetta 4A-1): il passo fra le impronte, in frazioni della
  // punta, arrotondato al centesimo (il passo dello slider).
  function setSpacing(v, opts) {
    const n = Number(v);
    if (!isFinite(n) || n <= 0) return spacing;
    spacing = Math.round(_clamp(n, SPACING_MIN, SPACING_MAX) * 100) / 100;
    _syncUI();
    if (!opts || opts.persist !== false) _saveSettings();
    return spacing;
  }

  // ANGOLO della sorgente agganciata (Fetta 4A-1), gradi interi, + = in
  // alto. Come la distanza: con la sorgente fissa NON la sblocca, vale
  // tornando ad Agganciata.
  function setAngleDeg(v, opts) {
    const n = Number(v);
    if (!isFinite(n)) return angleDeg;
    angleDeg = Math.round(_clamp(n, ANGLE_MIN, ANGLE_MAX)) || 0;  // mai −0
    _syncUI();
    if (!opts || opts.persist !== false) _saveSettings();
    return angleDeg;
  }

  // ════════════════════════════════════════════════════════════════
  //  I COMANDI DELLA FORMA DELLA PUNTA — Fetta 4A-2
  // ════════════════════════════════════════════════════════════════

  // La forma. "custom" si puo' scegliere solo se una forma libera c'e'
  // davvero: un pulsante che promette una punta che non esiste sarebbe
  // peggio di un pulsante spento.
  function setTipShape(name, opts) {
    if (TIP_SHAPES.indexOf(name) < 0) return tipShape;
    if (name === "custom" && !customTip) return tipShape;
    tipShape = name;
    _syncUI();
    if (!opts || opts.persist !== false) _saveSettings();
    return tipShape;
  }

  // La proporzione (altezza = larghezza × proporzione) della forma indicata,
  // o di quella in uso. Ogni forma ricorda la sua: passando dal rettangolo
  // al triangolo si ritrova quella del triangolo, non quella di prima.
  // ⚠ Il numero NON si arrotonda: lo slider manda comunque centesimi tondi,
  //   e arrotondando (anche al millesimo) il triangolo equilatero — che e'
  //   sqrt(3)/2, cioe' 0,8660254… — tornava 0,866 dopo un salvataggio e non
  //   era piu' equilatero. Chi legge il numero per scriverlo (l'etichetta)
  //   arrotonda lui.
  function setTipRatio(v, shape, opts) {
    const key = RATIO_SHAPES.indexOf(shape) >= 0
      ? shape
      : (RATIO_SHAPES.indexOf(tipShape) >= 0 ? tipShape : null);
    if (!key) return 1;
    const n = Number(v);
    if (!isFinite(n) || n <= 0) return tipRatios[key];
    tipRatios[key] = _clamp(n, RATIO_MIN, RATIO_MAX);
    _syncUI();
    if (!opts || opts.persist !== false) _saveSettings();
    return tipRatios[key];
  }

  // La rotazione della punta, gradi interi, + = senso orario.
  function setTipRotationDeg(v, opts) {
    const n = Number(v);
    if (!isFinite(n)) return tipRotationDeg;
    tipRotationDeg = Math.round(_clamp(n, ROTATION_MIN, ROTATION_MAX)) || 0;  // mai −0
    _syncUI();
    if (!opts || opts.persist !== false) _saveSettings();
    return tipRotationDeg;
  }

  // «Segue il tratto». Con la punta tonda non cambia niente (_followsStroke).
  function setTipFollow(on, opts) {
    tipFollow = !!on;
    _syncUI();
    if (!opts || opts.persist !== false) _saveSettings();
    return tipFollow;
  }

  // ── LA FORMA LIBERA (Fetta 4A-2) ──────────────────────────────────
  //  Arriva dal costruttore della palladiana, in MILLIMETRI VERI, come
  //  comandi M/L/Q (le curve dell'utente e gli angoli arrotondati sono gia'
  //  dentro, perche' il costruttore ci passa il suo CONTORNO EFFETTIVO).
  //  Qui si normalizza una volta sola: centro sul BARICENTRO dell'area,
  //  lato maggiore = 1. Poi la Dimensione la scala come qualunque altra
  //  punta, proporzioni sue.
  function _quadAt(a, c, b, t) {
    const u = 1 - t;
    return {
      x: u * u * a.x + 2 * u * t * c.x + t * t * b.x,
      y: u * u * a.y + 2 * u * t * c.y + t * t * b.y
    };
  }

  function _r5(v) { return Math.round(v * 100000) / 100000; }

  // Restituisce { cmds, pts, poly, rN, wN, hN, sizeMM } oppure null se la
  // forma non puo' fare la punta (aperta, vuota, senza area, troppo piccola).
  function _normalizeCustom(cmds) {
    if (!Array.isArray(cmds) || cmds.length < 3 || cmds.length > CUSTOM_MAX_CMDS) return null;
    const pts = [];    // tutti i punti dei comandi, CONTROLLI COMPRESI → scatola sicura
    const poly = [];   // il contorno spianato → area, baricentro, raggi
    let cur = null;
    for (let i = 0; i < cmds.length; i++) {
      const c = cmds[i];
      if (!c || (c.t !== "M" && c.t !== "L" && c.t !== "Q")) return null;
      if (!isFinite(c.x) || !isFinite(c.y)) return null;
      if (i === 0 && c.t !== "M") return null;
      if (i > 0 && c.t === "M") return null;   // una forma sola, non un foglio
      const end = { x: c.x, y: c.y };
      if (c.t === "Q") {
        if (!isFinite(c.cx) || !isFinite(c.cy)) return null;
        const ctl = { x: c.cx, y: c.cy };
        pts.push(ctl);
        if (cur) {
          for (let k = 1; k <= CUSTOM_FLATTEN; k++) poly.push(_quadAt(cur, ctl, end, k / CUSTOM_FLATTEN));
        }
      } else {
        poly.push(end);
      }
      pts.push(end);
      cur = end;
    }
    if (poly.length < 3) return null;

    // area e baricentro (l'anello si chiude da se': l'ultimo punto torna al primo)
    let A2 = 0, cx = 0, cy = 0;
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i], b = poly[(i + 1) % poly.length];
      const w = a.x * b.y - b.x * a.y;
      A2 += w;
      cx += (a.x + b.x) * w;
      cy += (a.y + b.y) * w;
    }
    if (Math.abs(A2) < 1e-9) return null;   // una forma senza superficie non e' una punta
    cx /= 3 * A2;
    cy /= 3 * A2;

    let bx0 = Infinity, by0 = Infinity, bx1 = -Infinity, by1 = -Infinity;
    for (let i = 0; i < poly.length; i++) {
      const q = poly[i];
      if (q.x < bx0) bx0 = q.x;
      if (q.x > bx1) bx1 = q.x;
      if (q.y < by0) by0 = q.y;
      if (q.y > by1) by1 = q.y;
    }
    const bw = bx1 - bx0, bh = by1 - by0;
    const L = Math.max(bw, bh);
    if (!(L > CUSTOM_MIN_MM)) return null;

    const ncmds = [];
    for (let i = 0; i < cmds.length; i++) {
      const c = cmds[i];
      const o = { t: c.t, x: _r5((c.x - cx) / L), y: _r5((c.y - cy) / L) };
      if (c.t === "Q") { o.cx = _r5((c.cx - cx) / L); o.cy = _r5((c.cy - cy) / L); }
      ncmds.push(o);
    }
    const npts = [], npoly = [];
    let rN = 0;
    for (let i = 0; i < pts.length; i++) {
      const q = { x: (pts[i].x - cx) / L, y: (pts[i].y - cy) / L };
      npts.push(q);
      const d = Math.sqrt(q.x * q.x + q.y * q.y);
      if (d > rN) rN = d;
    }
    for (let i = 0; i < poly.length; i++) {
      npoly.push({ x: (poly[i].x - cx) / L, y: (poly[i].y - cy) / L });
    }
    if (!(rN > 0)) return null;
    return {
      cmds: ncmds, pts: npts, poly: npoly, rN: rN,
      wN: bw / L, hN: bh / L, sizeMM: L
    };
  }

  // La forma libera diventa la punta, in mm VERI 1:1: la Dimensione prende
  // il lato maggiore. Se sfora i limiti della Dimensione si riduce, e lo dice.
  function setCustomTipFromMM(desc) {
    const norm = _normalizeCustom(desc && desc.cmds);
    if (!norm) {
      _toast("stamp.toast.tipInvalid",
        "\uD83D\uDDBC\uFE0F Questa forma non pu\u00f2 fare la punta: chiudila e dalle un po' di superficie");
      return false;
    }
    customTip = norm;
    tipShape = "custom";
    const mm = _clamp(norm.sizeMM, TIP_MM_MIN, TIP_MM_MAX);
    tipMM = mm;
    _syncUI();
    _saveSettings();
    if (Math.abs(mm - norm.sizeMM) > 0.05) {
      _toastP("stamp.toast.tipReduced", { mm: _fmtMM(mm), orig: _fmtMM(norm.sizeMM) },
        "\uD83D\uDDBC\uFE0F Punta libera presa, ridotta a {mm} mm sul lato maggiore (era {orig} mm)");
    } else {
      _toastP("stamp.toast.tipTaken", { mm: _fmtMM(mm) },
        "\uD83D\uDDBC\uFE0F Punta libera presa: {mm} mm sul lato maggiore. La Dimensione la scala come vuoi");
    }
    return true;
  }

  // «✏️ Disegna la forma…»: apre il costruttore della palladiana in modo
  // punta. Il timbro resta in mano: il modale copre il foglio, e al «Usa
  // come punta» si ritrova il pennello con la forma nuova.
  function openTipBuilder() {
    if (typeof window.openCustomShapeBuilderForStampTip !== "function") {
      _toast("stamp.toast.builderMissing",
        "\uD83D\uDDBC\uFE0F Il costruttore delle forme non \u00e8 disponibile");
      return false;
    }
    if (pickArmed) disarmPick(true);
    try {
      return !!window.openCustomShapeBuilderForStampTip({
        onUse: function (desc) { return setCustomTipFromMM(desc); }
      });
    } catch (e) {
      console.warn("[cloneStampBrush] costruttore della punta non aperto:", e);
      return false;
    }
  }

  // Agganciata / fissa.
  //   • Agganciata → libera la sorgente scelta (e un contagocce armato):
  //     la sorgente torna a seguire la punta alla distanza dello slider.
  //   • Fissa → se una sorgente scelta c'e' gia', niente da fare; se no
  //     arma il contagocce: "fissa" vuol dire "scegli il pezzo".
  function setAnchored(on, opts) {
    const silent = !!(opts && opts.silent);
    if (on) {
      const changed = !anchored;
      if (pickArmed) disarmPick(true);
      anchored = true;
      fixedSource = null;
      _syncUI();
      if (changed && !silent) {
        _toast("stamp.toast.anchored", "\uD83D\uDDBC\uFE0F Sorgente agganciata: segue la punta");
      }
      return anchored;
    }
    if (!anchored && fixedSource) { _syncUI(); return anchored; }
    anchored = false;
    if (!armPick()) {
      // Timbro non in mano o niente sfondo: la fissa non puo' nascere.
      anchored = true;
    }
    _syncUI();
    return anchored;
  }

  // ── I comandi dei colori (Fetta 3) ──────────────────────────────
  // Limitano, arrotondano al passo dello slider, aggiornano l'inspector.
  // ⚠ NON salvano: i colori non vanno in calibration.json.
  function setBrightness(v) {
    const n = Number(v);
    if (!isFinite(n)) return brightness;
    brightness = Math.round(_clamp(n, BRIGHTNESS_MIN, BRIGHTNESS_MAX));
    _syncUI();
    return brightness;
  }

  function setHue(v) {
    const n = Number(v);
    if (!isFinite(n)) return hue;
    hue = Math.round(_clamp(n, HUE_MIN, HUE_MAX));
    _syncUI();
    return hue;
  }

  function setTransparency(v) {
    const n = Number(v);
    if (!isFinite(n)) return transparency;
    transparency = Math.round(_clamp(n, TRANSPARENCY_MIN, TRANSPARENCY_MAX));
    _syncUI();
    return transparency;
  }

  function setColorMode(m) {
    if (COLOR_MODES.indexOf(m) < 0) return colorMode;
    colorMode = m;
    _syncUI();
    return colorMode;
  }

  function setCmyChannel(ch) {
    if (CMY_CHANNELS.indexOf(ch) < 0) return cmyChannel;
    cmyChannel = ch;
    _syncUI();
    return cmyChannel;
  }

  function colorsAreOriginal() {
    return brightness === 0 && hue === 0 && transparency === 0 && colorMode === "normal";
  }

  // "Colori originali": tutto neutro, e la lastra CMY torna alla C.
  function resetColors() {
    brightness = 0;
    hue = 0;
    transparency = 0;
    colorMode = "normal";
    cmyChannel = "c";
    _syncUI();
    return true;
  }

  function _getColors() {
    return {
      brightness: brightness,
      hue: hue,
      transparency: transparency,
      mode: colorMode,
      channel: cmyChannel
    };
  }

  // ════════════════════════════════════════════════════════════════
  //  PERSISTENZA — calibration.json, MERGE non distruttivo
  //  load → sovrascrivi solo le chiavi nostre → save. E' lo schema di
  //  lassoSelection.js e di freehandClipLens.js (_saveNow): senza, si
  //  cancellerebbero calibrationFactor e le chiavi degli altri moduli.
  //  Si salvano le SCELTE (dimensione e distanza), non la sorgente
  //  fissa: quella e' un punto del foglio che si ha davanti, non una
  //  preferenza, e al riavvio si riparte da agganciata.
  // ════════════════════════════════════════════════════════════════
  async function _loadSettings() {
    if (!window.calibrationAPI || typeof window.calibrationAPI.load !== "function") return;
    try {
      const data = await window.calibrationAPI.load();
      if (!data || typeof data !== "object") return;
      const t = data.stampTipMM;
      if (typeof t === "number" && isFinite(t) && t >= TIP_MM_MIN && t <= TIP_MM_MAX) {
        setTipMM(t, { persist: false });
      }
      const x = data.stampOffsetXMM;
      if (typeof x === "number" && isFinite(x) && x >= OFFSET_X_MM_MIN && x <= OFFSET_X_MM_MAX) {
        setOffsetXMM(x, { persist: false });
      }
      const sp = data.stampSpacing;
      if (typeof sp === "number" && isFinite(sp) && sp >= SPACING_MIN && sp <= SPACING_MAX) {
        setSpacing(sp, { persist: false });
      }
      const an = data.stampAngleDeg;
      if (typeof an === "number" && isFinite(an) && an >= ANGLE_MIN && an <= ANGLE_MAX) {
        setAngleDeg(an, { persist: false });
      }
      // ── la punta (Fetta 4A-2) ──
      // ⚠ La forma LIBERA si legge PRIMA della forma scelta: senza di lei
      //   "custom" non si potrebbe scegliere e si tornerebbe alla tonda.
      const cu = data.stampTipCustom;
      if (cu && Array.isArray(cu.cmds)) {
        const n = _normalizeCustom(cu.cmds);
        if (n) customTip = n;
      }
      const ra = data.stampTipRatios;
      if (ra && typeof ra === "object") {
        RATIO_SHAPES.forEach(function (k) {
          const v = ra[k];
          if (typeof v === "number" && isFinite(v) && v >= RATIO_MIN && v <= RATIO_MAX) {
            setTipRatio(v, k, { persist: false });
          }
        });
      }
      const ro = data.stampTipRotationDeg;
      if (typeof ro === "number" && isFinite(ro) && ro >= ROTATION_MIN && ro <= ROTATION_MAX) {
        setTipRotationDeg(ro, { persist: false });
      }
      if (typeof data.stampTipFollow === "boolean") {
        setTipFollow(data.stampTipFollow, { persist: false });
      }
      const sh = data.stampTipShape;
      if (typeof sh === "string" && TIP_SHAPES.indexOf(sh) >= 0) {
        setTipShape(sh, { persist: false });
      }
    } catch (err) {
      console.warn("[cloneStampBrush] load impostazioni fallito:", err);
    }
  }

  async function _saveNow() {
    if (!window.calibrationAPI || typeof window.calibrationAPI.save !== "function") return;
    let payload = {};
    if (typeof window.calibrationAPI.load === "function") {
      try { payload = (await window.calibrationAPI.load()) || {}; } catch (e) { payload = {}; }
    }
    payload.stampTipMM = tipMM;
    payload.stampOffsetXMM = offsetXMM;
    payload.stampSpacing = spacing;
    payload.stampAngleDeg = angleDeg;
    payload.stampTipShape = tipShape;
    payload.stampTipRatios = { rect: tipRatios.rect, oval: tipRatios.oval, tri: tipRatios.tri };
    payload.stampTipRotationDeg = tipRotationDeg;
    payload.stampTipFollow = tipFollow;
    // La forma libera si salva normalizzata (lato maggiore = 1): la
    // Dimensione, che e' la sua misura vera, sta in stampTipMM.
    payload.stampTipCustom = customTip ? { cmds: customTip.cmds } : null;
    try {
      await window.calibrationAPI.save(payload);
    } catch (err) {
      console.warn("[cloneStampBrush] save impostazioni fallito:", err);
    }
  }

  function _saveSettings() {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(function () { saveTimer = null; _saveNow(); }, SAVE_DEBOUNCE_MS);
  }

  // ════════════════════════════════════════════════════════════════
  //  L'INSPECTOR — sezione data-section="timbro" di index.html
  //  Il modulo e' l'unica fonte di verita': gli elementi MOSTRANO lo
  //  stato, non lo tengono. Se il markup non c'e' tutto qui e' muto e il
  //  pennello funziona lo stesso.
  // ════════════════════════════════════════════════════════════════
  function _el(id) { return document.getElementById(id); }

  function _fmtMM(v) {
    return (Math.round(Math.abs(v) * 10) / 10).toFixed(1);
  }

  // La freccia dice DOVE sta la sorgente agganciata rispetto alla punta,
  // angolo compreso: con l'angolo a zero e' ← o →, come prima.
  const _ARROWS = ["\u2192", "\u2197", "\u2191", "\u2196", "\u2190", "\u2199", "\u2193", "\u2198"];

  function _dirArrow() {
    const o = _offsetLogicalPx();
    const deg = Math.atan2(-o.y, o.x) * 180 / Math.PI;   // 0 = destra, 90 = su
    const k = ((Math.round(deg / 45) % 8) + 8) % 8;
    return _ARROWS[k];
  }

  function _distanceLabel() {
    if (offsetXMM < 0) return _dirArrow() + " " + _fmtMM(offsetXMM) + " mm";
    if (offsetXMM > 0) return _fmtMM(offsetXMM) + " mm " + _dirArrow();
    return "0.0 mm";
  }

  function _spacingLabel() {
    return spacing.toFixed(2) + "\u00d7";
  }

  function _syncUI() {
    const size = _el("stampSizeSlider");
    if (size && Math.abs(parseFloat(size.value) - tipMM) > 1e-6) size.value = String(tipMM);
    const sizeVal = _el("stampSizeValue");
    if (sizeVal) sizeVal.textContent = _fmtMM(tipMM) + " mm";

    // Lo slider della spaziatura lavora in centesimi (5…200).
    const sp = _el("stampTipSpacingSlider");
    if (sp && Math.abs(parseFloat(sp.value) - spacing * 100) > 1e-6) sp.value = String(Math.round(spacing * 100));
    const spVal = _el("stampTipSpacingValue");
    if (spVal) spVal.textContent = _spacingLabel();

    // Con la sorgente fissa la distanza non e' in vigore: si vede, ma
    // attenuata.
    const dim = !anchored;
    const dist = _el("stampDistanceSlider");
    if (dist) {
      if (Math.abs(parseFloat(dist.value) - offsetXMM) > 1e-6) dist.value = String(offsetXMM);
      dist.classList.toggle("stamp-dim", dim);
    }
    const distVal = _el("stampDistanceValue");
    if (distVal) {
      distVal.textContent = _distanceLabel();
      distVal.classList.toggle("stamp-dim", dim);
    }
    const ang = _el("stampAngleSlider");
    if (ang) {
      if (Math.abs(parseFloat(ang.value) - angleDeg) > 1e-6) ang.value = String(angleDeg);
      ang.classList.toggle("stamp-dim", dim);
    }
    const angVal = _el("stampAngleValue");
    if (angVal) {
      angVal.textContent = _signed(angleDeg) + "\u00b0";
      angVal.classList.toggle("stamp-dim", dim);
    }

    // ── la punta (Fetta 4A-2) ──
    TIP_SHAPES.forEach(function (name) {
      const b = _el("stampShape" + name.charAt(0).toUpperCase() + name.slice(1) + "Btn");
      if (!b) return;
      const on = name === tipShape;
      b.classList.toggle("active", on);
      b.setAttribute("aria-pressed", on ? "true" : "false");
      if (name === "custom") {
        // niente forma libera, niente pulsante: spento e attenuato
        b.disabled = !customTip;
        b.classList.toggle("stamp-dim", !customTip);
      }
    });

    // La proporzione si vede solo dove vuol dire qualcosa: rettangolo,
    // ovale e triangolo. La tonda e la quadrata non ne hanno, e la forma
    // libera ha le sue.
    const hasRatio = RATIO_SHAPES.indexOf(tipShape) >= 0;
    const ratioRow = _el("stampRatioRow");
    // ⚠ Con style.display e non con hidden: .inspector-row e' display:flex
    //   nel CSS, che vince sull'hidden del browser (come stampCmyRow).
    if (ratioRow) ratioRow.style.display = hasRatio ? "" : "none";
    if (hasRatio) {
      const pct = Math.round((tipRatios[tipShape] || 1) * 100);
      const rs = _el("stampRatioSlider");
      if (rs && Math.abs(parseFloat(rs.value) - pct) > 1e-6) rs.value = String(pct);
      const rv = _el("stampRatioValue");
      if (rv) rv.textContent = pct + "%";
    }

    // La punta tonda non ha un verso: rotazione e «segue il tratto» si
    // vedono, ma attenuati, perche' non cambiano un pixel.
    const noTurn = tipShape === "round";
    const rot = _el("stampRotationSlider");
    if (rot) {
      if (Math.abs(parseFloat(rot.value) - tipRotationDeg) > 1e-6) rot.value = String(tipRotationDeg);
      rot.classList.toggle("stamp-dim", noTurn);
    }
    const rotV = _el("stampRotationValue");
    if (rotV) {
      rotV.textContent = _signed(tipRotationDeg) + "\u00b0";
      rotV.classList.toggle("stamp-dim", noTurn);
    }
    const fchk = _el("stampFollowChk");
    if (fchk && fchk.checked !== tipFollow) fchk.checked = tipFollow;
    const frow = _el("stampFollowRow");
    if (frow) frow.classList.toggle("stamp-dim", noTurn);

    const a = _el("stampSourceAnchoredBtn");
    const f = _el("stampSourceFixedBtn");
    if (a) { a.classList.toggle("active", anchored); a.setAttribute("aria-pressed", anchored ? "true" : "false"); }
    if (f) { f.classList.toggle("active", !anchored); f.setAttribute("aria-pressed", anchored ? "false" : "true"); }

    const pick = _el("stampPickSourceBtn");
    if (pick) {
      pick.classList.toggle("armed", pickArmed);
      pick.setAttribute("aria-pressed", pickArmed ? "true" : "false");
    }

    _syncColorUI();
  }

  function _signed(v) {
    if (v > 0) return "+" + v;
    if (v < 0) return "\u2212" + Math.abs(v);
    return "0";
  }

  function _syncColorUI() {
    const bs = _el("stampBrightnessSlider");
    if (bs && parseFloat(bs.value) !== brightness) bs.value = String(brightness);
    const bv = _el("stampBrightnessValue");
    if (bv) bv.textContent = _signed(brightness);

    const hs = _el("stampHueSlider");
    if (hs && parseFloat(hs.value) !== hue) hs.value = String(hue);
    const hv = _el("stampHueValue");
    if (hv) hv.textContent = _signed(hue) + "\u00b0";

    const ts = _el("stampTransparencySlider");
    if (ts && parseFloat(ts.value) !== transparency) ts.value = String(transparency);
    const tv = _el("stampTransparencyValue");
    if (tv) tv.textContent = transparency + "%";

    const ms = _el("stampColorModeSelect");
    if (ms && ms.value !== colorMode) ms.value = colorMode;

    // La riga delle lastre si vede solo in modalita' CMY.
    // ⚠ Con style.display e non con l'attributo hidden: .inspector-row ha
    //   display:flex nel CSS, che vince sull'hidden del browser.
    const row = _el("stampCmyRow");
    if (row) row.style.display = colorMode === "cmy" ? "" : "none";
    CMY_CHANNELS.forEach(function (chn) {
      const b = _el("stampCmy" + chn.toUpperCase() + "Btn");
      if (!b) return;
      const on = chn === cmyChannel;
      b.classList.toggle("active", on);
      b.setAttribute("aria-pressed", on ? "true" : "false");
    });

    const reset = _el("stampColorResetBtn");
    if (reset) reset.disabled = colorsAreOriginal();
  }

  function _wireInspector() {
    const size = _el("stampSizeSlider");
    if (size && !size.__mwpStampBound) {
      size.__mwpStampBound = true;
      size.addEventListener("input", function () { setTipMM(parseFloat(size.value)); });
    }
    const dist = _el("stampDistanceSlider");
    if (dist && !dist.__mwpStampBound) {
      dist.__mwpStampBound = true;
      dist.addEventListener("input", function () { setOffsetXMM(parseFloat(dist.value)); });
    }
    const sp = _el("stampTipSpacingSlider");
    if (sp && !sp.__mwpStampBound) {
      sp.__mwpStampBound = true;
      sp.addEventListener("input", function () { setSpacing(parseFloat(sp.value) / 100); });
    }
    const ang = _el("stampAngleSlider");
    if (ang && !ang.__mwpStampBound) {
      ang.__mwpStampBound = true;
      ang.addEventListener("input", function () { setAngleDeg(parseFloat(ang.value)); });
    }
    // ── la punta (Fetta 4A-2) ──
    TIP_SHAPES.forEach(function (name) {
      const b = _el("stampShape" + name.charAt(0).toUpperCase() + name.slice(1) + "Btn");
      if (b && !b.__mwpStampBound) {
        b.__mwpStampBound = true;
        b.addEventListener("click", function () { setTipShape(name); });
      }
    });
    const draw = _el("stampDrawShapeBtn");
    if (draw && !draw.__mwpStampBound) {
      draw.__mwpStampBound = true;
      draw.addEventListener("click", openTipBuilder);
    }
    const rs = _el("stampRatioSlider");
    if (rs && !rs.__mwpStampBound) {
      rs.__mwpStampBound = true;
      rs.addEventListener("input", function () { setTipRatio(parseFloat(rs.value) / 100); });
    }
    const rot = _el("stampRotationSlider");
    if (rot && !rot.__mwpStampBound) {
      rot.__mwpStampBound = true;
      rot.addEventListener("input", function () { setTipRotationDeg(parseFloat(rot.value)); });
    }
    const fchk = _el("stampFollowChk");
    if (fchk && !fchk.__mwpStampBound) {
      fchk.__mwpStampBound = true;
      fchk.addEventListener("change", function () { setTipFollow(!!fchk.checked); });
    }

    const a = _el("stampSourceAnchoredBtn");
    if (a && !a.__mwpStampBound) {
      a.__mwpStampBound = true;
      a.addEventListener("click", function () { setAnchored(true); });
    }
    const f = _el("stampSourceFixedBtn");
    if (f && !f.__mwpStampBound) {
      f.__mwpStampBound = true;
      f.addEventListener("click", function () { setAnchored(false); });
    }
    const pick = _el("stampPickSourceBtn");
    if (pick && !pick.__mwpStampBound) {
      pick.__mwpStampBound = true;
      pick.addEventListener("click", togglePick);
    }

    // ── i colori (Fetta 3) ──
    const bs = _el("stampBrightnessSlider");
    if (bs && !bs.__mwpStampBound) {
      bs.__mwpStampBound = true;
      bs.addEventListener("input", function () { setBrightness(parseFloat(bs.value)); });
    }
    const hs = _el("stampHueSlider");
    if (hs && !hs.__mwpStampBound) {
      hs.__mwpStampBound = true;
      hs.addEventListener("input", function () { setHue(parseFloat(hs.value)); });
    }
    const ts = _el("stampTransparencySlider");
    if (ts && !ts.__mwpStampBound) {
      ts.__mwpStampBound = true;
      ts.addEventListener("input", function () { setTransparency(parseFloat(ts.value)); });
    }
    const ms = _el("stampColorModeSelect");
    if (ms && !ms.__mwpStampBound) {
      ms.__mwpStampBound = true;
      ms.addEventListener("change", function () {
        setColorMode(ms.value);
        // ⚠ Il menu lascia il fuoco: keyboardShortcuts.js ignora i tasti
        //   solo dentro INPUT e TEXTAREA, quindi con un <select> a fuoco
        //   le frecce cambierebbero voce E sposterebbero il foglio.
        try { ms.blur(); } catch (e) {}
      });
    }
    CMY_CHANNELS.forEach(function (chn) {
      const b = _el("stampCmy" + chn.toUpperCase() + "Btn");
      if (b && !b.__mwpStampBound) {
        b.__mwpStampBound = true;
        b.addEventListener("click", function () { setCmyChannel(chn); });
      }
    });
    const reset = _el("stampColorResetBtn");
    if (reset && !reset.__mwpStampBound) {
      reset.__mwpStampBound = true;
      reset.addEventListener("click", resetColors);
    }
    _syncUI();
  }

  function toggle() {
    return stampMode ? deactivate(false) : activate();
  }

  // ════════════════════════════════════════════════════════════════
  //  CONVIVENZA CON GLI ALTRI STRUMENTI
  //  Chi prende in mano un altro strumento si trova il timbro riposto,
  //  in silenzio (l'altro strumento dice la sua). In fase CAPTURE su
  //  document per arrivare prima degli ascoltatori dei pulsanti, che
  //  sono stati registrati con un riferimento diretto alla funzione e
  //  non per nome: avvolgere i toggle NON basterebbe.
  //  ⚠ Lazo e pennello selezione restano in questa lista APPOSTA: col
  //  timbro in mano, cliccarli fa riporre il timbro (come fa il
  //  perimetro). Il rifiuto con avviso vale nell'altro verso, e sta in
  //  activate() (Fetta 2B, trappola 137).
  // ════════════════════════════════════════════════════════════════
  const YIELD_SELECTOR = [
    "#freehandBtn", "#eraserBtn", "#watercolorBtn", "#freehandClipBtn",
    "#lassoSelectBtn", "#lassoBrushBtn", "#selectToolBtn", "#addShapeBtn",
    "#customShapeBtn"
  ].join(",");

  function _attachYieldListener() {
    if (window.__mwpStampYieldBound) return;
    window.__mwpStampYieldBound = true;
    document.addEventListener("click", function (e) {
      if (!stampMode) return;
      const t = e.target && e.target.closest ? e.target.closest(YIELD_SELECTOR) : null;
      if (!t) return;
      deactivate(true);
    }, true);
  }

  function _attachSlabInvalidation(c) {
    if (!c || typeof c.on !== "function") return;
    if (c.__mwpStampSlabHook) return;
    c.__mwpStampSlabHook = true;
    const onChange = function (opt) {
      const o = opt && opt.target;
      if (!o || o.__isBackground === true) invalidateSlab();
    };
    c.on("object:added", onChange);
    c.on("object:removed", onChange);
    c.on("object:modified", onChange);
  }

  // ════════════════════════════════════════════════════════════════
  //  LA LISTA DEI TRATTI (📋 elimina / esporta) — Fetta 3-bis, punto ④
  //  Miniature ed etichette le scrive renderer.js. Il tratto del timbro e'
  //  un'immagine SENZA __isWatercolor, quindi la miniatura lo trattava da
  //  penna (una riga nera, disegnata con un percorso che non ha) e
  //  l'etichetta non diceva cos'e' (nell'esporta diceva "(penna)").
  //   • la MINIATURA: createFreehandPreview e' una funzione di primo livello
  //     che la finestra chiama per NOME al momento di disegnare la lista,
  //     quindi basta avvolgerla (window.createFreehandPreview). Al suo ramo
  //     dell'acquerello si passa un oggetto-ponte con l'immagine del timbro;
  //   • l'ETICHETTA la finestra la scrive subito dopo, nella stessa riga.
  //     Si corregge appena la lista e' finita (un microtask: prima che il
  //     browser disegni, quindi senza lampi), trovando la riga dalla
  //     miniatura e il numero dalla casella di spunta (data-index), che e'
  //     esattamente il numero che la finestra ha usato.
  //  Se un giorno renderer.js cambiasse la forma della riga, la correzione
  //  non trova niente e non fa niente: resta la miniatura giusta.
  // ════════════════════════════════════════════════════════════════
  function _isStampObject(o) {
    return !!(o && o.data && o.data.mwpStamp);
  }

  function _stampLineLabel(n) {
    const type = _t("ui.freehand.typeStamp", "(timbro)");
    try {
      if (window.i18n && typeof window.i18n.t === "function") {
        const s = window.i18n.t("ui.freehand.lineLabel", { n: n, type: type });
        if (s && s !== "ui.freehand.lineLabel") return s;
      }
    } catch (e) {}
    return "Linea " + n + " " + type;
  }

  function _fixStampListRow(svg) {
    const box = svg && svg.parentNode;
    const row = box && box.parentNode;
    if (!row || typeof row.querySelector !== "function") return false;
    const strong = row.querySelector("strong");
    const chk = row.querySelector("input[data-index]");
    if (!strong || !chk) return false;
    const i = parseInt(chk.dataset.index, 10);
    if (!(i >= 0)) return false;
    strong.textContent = _stampLineLabel(i + 1);
    return true;
  }

  function _installFreehandListHooks() {
    const orig = window.createFreehandPreview;
    if (typeof orig !== "function") return false;
    if (orig.__mwpStampWrapped) return true;
    const wrapped = function (obj) {
      if (!_isStampObject(obj)) return orig.apply(this, arguments);
      const bridge = {
        type: "image",
        __isWatercolor: true,
        _element: obj._element,
        getSrc: function () {
          return typeof obj.getSrc === "function" ? obj.getSrc() : "";
        }
      };
      const svg = orig.call(this, bridge);
      Promise.resolve().then(function () {
        _fixStampListRow(svg);
      });
      return svg;
    };
    wrapped.__mwpStampWrapped = true;
    wrapped.__mwpOriginal = orig;
    window.createFreehandPreview = wrapped;
    return true;
  }

  // ════════════════════════════════════════════════════════════════
  //  AVVIO
  //  Da se', con qualche tentativo: renderer.js non si puo' toccare per
  //  farsi chiamare, quindi si aspetta che il canvas ci sia. E' la
  //  strada di freehandClipLens.js.
  // ════════════════════════════════════════════════════════════════
  function initCloneStampBrush() {
    const c = _c();
    if (!c) return false;

    defineBrush();
    _attachSlabInvalidation(c);
    _attachYieldListener();
    _attachKeyListener();
    wrapApplyBrushSettings();
    _installFreehandListHooks();
    _wireInspector();
    if (!window.__mwpStampSettingsLoaded) {
      window.__mwpStampSettingsLoaded = true;
      _loadSettings();
    }

    const b = _btn();
    if (b && !b.__mwpStampBound) {
      b.__mwpStampBound = true;
      b.addEventListener("click", toggle);
    }
    return true;
  }

  function _boot() {
    let tries = 0;
    const tick = function () {
      tries++;
      if (initCloneStampBrush()) return;
      if (tries < 25) setTimeout(tick, 200);
    };
    setTimeout(tick, 200);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", _boot);
  } else {
    _boot();
  }

  // ════════════════════════════════════════════════════════════════
  //  ESPOSIZIONI GLOBALI
  // ════════════════════════════════════════════════════════════════
  window.initCloneStampBrush = initCloneStampBrush;

  window.cloneStamp = {
    // Quello che serve all'applicazione: gli stessi comandi che usa
    // l'inspector (Fetta 2B), con gli stessi limiti.
    isActive: function () { return stampMode; },
    activate: activate,
    deactivate: deactivate,
    toggle: toggle,

    // ⚠ UN SOLO comando dimensione: muove la punta E il lato della
    //   sorgente insieme, perche' sono la stessa misura (§4.2).
    getTipMM: function () { return tipMM; },
    setTipMM: setTipMM,

    // La distanza dello slider, CON IL SEGNO: negativo = a sinistra.
    getOffsetXMM: function () { return offsetXMM; },
    setOffsetXMM: setOffsetXMM,

    // ⚠ Nomi della Fetta 1, tenuti per chi li usa: qui la distanza e'
    //   POSITIVA A SINISTRA ("quanto a sinistra"), cioe' l'opposto del
    //   segno dello slider. Due viste della stessa grandezza.
    getDistanceMM: function () { return -offsetXMM; },
    setDistanceMM: function (mm) {
      const v = Number(mm);
      if (!isFinite(v)) return -offsetXMM;
      return -setOffsetXMM(-v);
    },

    // Spaziatura e angolo (Fetta 4A-1).
    getSpacing: function () { return spacing; },
    setSpacing: setSpacing,
    getAngleDeg: function () { return angleDeg; },
    setAngleDeg: setAngleDeg,

    isAnchored: function () { return anchored; },
    setAnchored: setAnchored,

    // ── La forma della punta (Fetta 4A-2) ────────────────────────
    getTipShape: function () { return tipShape; },
    setTipShape: setTipShape,
    getTipRatio: function (shape) {
      const k = RATIO_SHAPES.indexOf(shape) >= 0 ? shape : tipShape;
      return typeof tipRatios[k] === "number" ? tipRatios[k] : 1;
    },
    setTipRatio: setTipRatio,
    getTipRotationDeg: function () { return tipRotationDeg; },
    setTipRotationDeg: setTipRotationDeg,
    isTipFollowing: function () { return tipFollow; },
    setTipFollow: setTipFollow,
    followsStroke: function () { return _followsStroke(); },

    // La forma libera dal costruttore della palladiana.
    hasCustomTip: function () { return !!customTip; },
    getCustomTipSizeMM: function () { return customTip ? customTip.sizeMM : null; },
    setCustomTipFromMM: setCustomTipFromMM,
    openTipBuilder: openTipBuilder,

    // Il contagocce (§4.6).
    isPickArmed: function () { return pickArmed; },
    armPick: armPick,
    disarmPick: disarmPick,
    togglePick: togglePick,

    // I colori (Fetta 3). Non si salvano.
    getColors: _getColors,
    setBrightness: setBrightness,
    setHue: setHue,
    setTransparency: setTransparency,
    setColorMode: setColorMode,
    setCmyChannel: setCmyChannel,
    resetColors: resetColors,
    colorsAreOriginal: colorsAreOriginal,

    getSource: function () { return fixedSource ? { x: fixedSource.x, y: fixedSource.y } : null; },
    takeSource: takeSource,
    invalidateSlab: invalidateSlab,

    // ── Quello che legge l'overlay degli anelli (Fetta 2A) ───────
    // Sola lettura, e dalla STESSA geometria che il pennello usa per
    // campionare: l'anello e il pezzo copiato non possono divergere.
    // Le chiama freehandTools.js a ogni render, quindi non fanno
    // nient'altro che un conto.
    getTipDiameterPx: function () { return _tipLogicalPx(); },
    sourcePointFor: function (p) { return _sourceForPoint(p); },

    // ── Il contorno della punta, per gli anelli (Fetta 4A-2) ─────
    // Sempre la stessa geometria della maschera delle impronte: l'anello
    // disegna il contorno VERO del pezzo che verrebbe copiato.
    //   grow  quanto sporgere in fuori (px logici): l'anello sta appena
    //         fuori dal bordo, come per gli altri pennelli
    getTipAngleRad: function () { return _tipAngleRad(); },
    getTipGeometry: function () {
      const t = _tipGeom();
      return { shape: t.shape, w: t.w, h: t.h, R: t.R, angle: _tipAngleRad() };
    },
    traceTipOutline: function (ctx, x, y, grow) {
      if (!ctx) return false;
      tipTrace(ctx, _tipGeom(), x, y, 1, _tipAngleRad(), grow || 0);
      return true;
    },
    tipBoxAt: function (x, y, grow) {
      const b = tipBox(_tipGeom(), _tipAngleRad(), grow || 0);
      return { x0: x + b.x0, y0: y + b.y0, x1: x + b.x1, y1: y + b.y1 };
    },
    tipReach: function (ux, uy, grow) {
      return tipReach(_tipGeom(), _tipAngleRad(), grow || 0, ux, uy);
    },

    // Solo per l'harness e per tararlo dalla console: niente di questo
    // serve all'applicazione.
    _hasBackground: function () { return hasBackground(_c()); },
    _backgroundObjects: function () { return _backgroundObjects(_c()); },
    _ensureSlab: function () { return ensureSlab(_c()); },
    _slabSignature: function () { return _slabSignature(_c()); },
    _renderErrors: function () { return { conteggio: _renderErrors, ultimo: _lastRenderError }; },
    _slabHeld: function () { return !!slab; },
    _sampleTip: function (x, y, sizeLog) { return sampleTip(_c(), x, y, sizeLog); },
    _limits: function () {
      return {
        tipMMDefault: TIP_MM_DEFAULT,
        distMMDefault: DIST_MM_DEFAULT,
        tipMMMin: TIP_MM_MIN,
        tipMMMax: TIP_MM_MAX,
        offsetXMMMin: OFFSET_X_MM_MIN,
        offsetXMMMax: OFFSET_X_MM_MAX,
        saveDebounceMs: SAVE_DEBOUNCE_MS,
        slabScale: SLAB_SCALE,
        spacingDefault: SPACING_DEFAULT,
        spacingMin: SPACING_MIN,
        spacingMax: SPACING_MAX,
        angleDefault: ANGLE_DEFAULT,
        angleMin: ANGLE_MIN,
        angleMax: ANGLE_MAX,
        previewThrottleMs: PREVIEW_THROTTLE_MS,
        tipShapes: TIP_SHAPES.slice(),
        tipShapeDefault: TIP_SHAPE_DEFAULT,
        ratioShapes: RATIO_SHAPES.slice(),
        ratioDefaults: { rect: RATIO_DEFAULTS.rect, oval: RATIO_DEFAULTS.oval, tri: RATIO_DEFAULTS.tri },
        ratioMin: RATIO_MIN,
        ratioMax: RATIO_MAX,
        rotationDefault: ROTATION_DEFAULT,
        rotationMin: ROTATION_MIN,
        rotationMax: ROTATION_MAX,
        followDefault: FOLLOW_DEFAULT,
        dirMinFraction: DIR_MIN_FRACTION,
        dirMinPx: DIR_MIN_PX,
        dirSmoothBase: DIR_SMOOTH_BASE,
        customFlatten: CUSTOM_FLATTEN,
        customMaxCmds: CUSTOM_MAX_CMDS,
        customMinMM: CUSTOM_MIN_MM
      };
    },
    _colorLimits: function () {
      return {
        brightnessMin: BRIGHTNESS_MIN,
        brightnessMax: BRIGHTNESS_MAX,
        hueMin: HUE_MIN,
        hueMax: HUE_MAX,
        transparencyMin: TRANSPARENCY_MIN,
        transparencyMax: TRANSPARENCY_MAX,
        modes: COLOR_MODES.slice(),
        channels: CMY_CHANNELS.slice()
      };
    },
    _colorParams: function () { return _colorParams(); },
    _colorizePixels: function (data, params) { return colorizePixels(data, params); },
    _colorErrors: function () { return { conteggio: _colorErrors, ultimo: _lastColorError }; },
    _sheetColor: function () { return _sheetColor(_c()); },
    _saveNow: function () { return _saveNow(); },
    _loadSettings: function () { return _loadSettings(); },
    _installFreehandListHooks: function () { return _installFreehandListHooks(); },
    _stampLineLabel: function (n) { return _stampLineLabel(n); },
    // Fetta 4A-1
    _srcKey: function (o) { return _srcKey(o); },
    _stampOnto: stampOnto,
    // Fetta 4A-2: la geometria nuda, per il banco
    _tipGeom: function () { return _tipGeom(); },
    _tipVertices: function (tip, grow) { return tipVertices(tip, grow || 0); },
    _tipTrace: function (ctx, tip, cx, cy, k, a, grow) { return tipTrace(ctx, tip, cx, cy, k, a, grow || 0); },
    _tipBox: function (tip, a, grow) { return tipBox(tip, a || 0, grow || 0); },
    _tipReach: function (tip, a, grow, ux, uy) { return tipReach(tip, a || 0, grow || 0, ux, uy); },
    _normalizeCustom: function (cmds) { return _normalizeCustom(cmds); },
    _customTip: function () { return customTip; },
    _smoothAngle: function (prev, next) { return _smoothAngle(prev, next); },
    _liveDir: function () { return _liveDirRad; },
    _workerSource: function () { return _workerSource(); },
    _workerState: function () {
      return {
        usable: _workerUsable(),
        alive: !!_worker,
        broken: _workerBroken,
        lastError: _lastWorkerError,
        slabVersion: _workerSlabVersion,
        pendingStrokes: _strokeHandlers.size
      };
    },
    _disableWorker: function () { _workerFail("spento dal banco"); },
    _overlay: function () { return _ovEl; },
    _overlayState: function () { return { live: !!_ovLive, pending: _ovPending.size }; },
    _cachePngDataURL: cachePngDataURL,
    _slabVersion: function () { return slab ? slab.version : 0; }
  };
})();