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
//            • FRECCE   = spostano l'ultimo punto messo (vedi sotto)
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
//            • FRECCE    = spostano la maniglia selezionata (vedi sotto)
//            • INVIO / ESC / ⬡ / altro strumento = esce dalla modalita'
//
//      ── LA MIRA (cantiere «Il Mirino», Fetta 1, 2 ottobre 2026) ──────
//        • Il TAP mette il punto dove si e' PREMUTO, non dove si e'
//          rilasciato: premere sposta quasi sempre il mouse di un pixel,
//          e nella lente quel pixel e' un salto (trappola 247).
//        • Con la LENTE a schermo le distanze di presa (maniglia, lato) si
//          misurano NEL VETRO, cioe' divise anche per l'ingrandimento: due
//          spigoli a 1 mm, lontani nella lente, non sono piu' «lo stesso
//          punto» (trappola 246). Con la lente accesa la chiusura per
//          vicinanza al 1° vertice e' spenta: si chiude col tap SOPRA il
//          1° vertice, con Invio o col doppio-click.
//        • Le FRECCE spostano il punto selezionato come spostano le
//          tessere: 0,1 mm, Shift 1 mm, Ctrl 0,01 mm (anche i tasti
//          mappati come frecce: si avvolge window.handleArrowMovement,
//          trappola 249). Senza punto selezionato fanno quello di sempre.
//          In fase maniglie il taglio dei tratti si aggiorna dopo una
//          pausa: una raffica di frecce e' UN passo di Ctrl+Z.
//
//      ── LA VITE MICROMETRICA (cantiere «Il Mirino», Fetta 2, 6 ottobre
//         2026) — «premi, tieni e aggiusta» ─────────────────────────────
//        • Con la LENTE a schermo, PREMERE e TENERE premuto (col mouse, o
//          con la punta della penna appoggiata) demoltiplica la mano: il
//          mirino fa 1/N della strada della mano, con N = ingrandimento
//          della lente. Nel vetro l'immagine si muove cosi' alla velocita'
//          della mano, come un foglio sotto un microscopio fermo
//          (trappola 245). Al RILASCIO il punto va dov'e' il mirino.
//        • Premendo su una maniglia si sposta la maniglia, piano; premendo
//          a vuoto in fase traccia nasce un punto nuovo al rilascio. Con la
//          lente accesa trascinare NON e' piu' la mano libera: la mano
//          libera c'e' con la lente spenta (L), come prima (B2 del cantiere).
//        • Il punto di mira lo calcola SOLO questo file (_aimFrom); la lente
//          lo chiede con window.freehandClipAimAt(e) per mettere li' il
//          centro del reticolo: «centro del reticolo = dove va il punto»
//          resta vero per costruzione, in qualunque ordine arrivino gli
//          ascoltatori.
//        • Mentre si tiene premuto il cursore di Windows sparisce ovunque
//          (body.clip-aim-hold, regola in index.html): la mano puo' uscire
//          dal foglio, e un cursore lontano dal mirino indicherebbe un
//          punto che non conta. Al rilascio il mirino NON torna sotto la
//          mano: c'e' la frizione (sotto).
//
//      ── LA FRIZIONE (cantiere «Il Mirino», Fetta 2-bis, 6 ottobre 2026)
//        • Il cursore vero non si puo' spostare (trappola 254): al rilascio
//          della vite la mano e' N volte piu' in la' del mirino. Riportare
//          il mirino sotto la mano era un salto di (N-1) volte la
//          regolazione fine: a x8, 3,5 mm di mira = 24,5 mm di salto
//          (trappola 257). Quindi al rilascio il mirino RESTA dov'e', e da
//          li' segue la mano 1:1, scostato (clutch, in coordinate LOGICHE).
//          Come alzare il mouse dal tappetino e riappoggiarlo.
//        • Lo scostamento non si vede: sopra il foglio, con la lente, il
//          cursore di Windows e' nascosto. Si riassorbe da solo un po' alla
//          volta, SOLO lungo la direzione dello scostamento (il mirino non
//          curva: va un po' piu' piano o un po' piu' svelto della mano), e
//          piu' in fretta se e' diventato grande.
//        • Si azzera di colpo (il mirino torna sotto la mano) quando la
//          lente non c'e' piu' (L, mano fuori dal foglio, rilascio fuori),
//          quando la mano esce dal foglio, all'apertura e all'uscita.
//        • La rotella zooma attorno alla mano vera (renderer.js, protetto):
//          lo scostamento e' in punti del foglio, quindi il mirino resta
//          sullo stesso punto della tessera; a schermo si sposta con lo zoom.
//
//      ── LA FRIZIONE CHE SLITTA (cantiere «Il Mirino», Fetta 2-ter, 7
//         ottobre 2026) ───────────────────────────────────────────────────
//        • Attaccata di botto, la frizione passava in un colpo da 1/N a 1:1:
//          il primo colpo di mouse dopo il rilascio (anche quello del dito
//          che si alza dal pulsante) valeva N volte di piu' nel vetro. Col
//          mouse veloce di Mirko un colpo e' 3-5 px di schermo: a x8 un
//          salto di due puntini e mezzo del reticolo (trappola 259).
//        • Ora dopo il rilascio il mirino riparte LENTO come nella vite e
//          riprende velocita' nei primi CLIP_CLUTCH_SLIP_PX px di strada
//          della mano: il riduttore parte da 1/N, passa per 1:1, va un
//          filo oltre (a x8 fino al 137% circa) e torna a 1:1. La strada
//          che il mirino perde all'inizio la RECUPERA dopo: a fine rampa,
//          andando dritti, lo scostamento e' di nuovo quello del rilascio.
//          ⚠ Una rampa che non restituisce la strada (solo da 1/N a 1)
//          allontanerebbe la mano dal mirino a ogni punto, sempre nello
//          stesso verso, fino a farla uscire dal foglio: il salto grosso.
//        • Il conto e' esatto sulla strada fatta (integrale della rampa),
//          quindi non dipende da come Chromium spezza il movimento in
//          eventi. In questo tratto lo scostamento non si riassorbe: e' la
//          rampa a muoverlo, e a fine rampa lo rimette com'era.
//        • Vale dopo OGNI pressione con la lente, anche un tap fermo: il
//          colpetto del rilascio c'e' lo stesso.
//
//      ── LE CURVE, IL MOTORE (cantiere «Il Mirino», Fetta 3, 7 ottobre 2026)
//        • Il perimetro e' una FORMA (vertici spigolo o morbidi, lati dritti,
//          morbidi o ad arco) e un POLIGONO DI TAGLIO che ne esce «spianato» in
//          lati piccoli, entro 0,02 mm dalla curva vera. Al taglio, a
//          __clipPoly, al file e all'export arriva SOLO il poligono: renderer.js,
//          autoSave.js e svgExport.js non sanno delle curve e non serve.
//        • Nel file (freehandClipPolygon) i punti del poligono che sono vertici
//          veri portano v: 1 (spigolo) o v: 2 (morbido), e a: [t, h] se il lato
//          che parte da li' e' un arco. Un perimetro di soli spigoli e lati
//          dritti si salva come prima, senza campi in piu'. Un Mosaica vecchio
//          legge solo x e y: taglia giusto, curva compresa.
//        • Lo spianamento e' un'impronta (trappola 252): vedi la sezione «LE
//          CURVE — il motore» per le regole che lo tengono uguale al bit.
//        • Le curve si leggono, si salvano, si disegnano, si spostano con le
//          maniglie e le frecce; i comandi per farle sono quelli qui sotto.
//
//      ── LE CURVE A MANO (cantiere «Il Mirino», Fette 4A e 4B, 14 ottobre
//         2026) ─────────────────────────────────────────────────────────────
//        • Le maniglie dicono il tipo del punto: QUADRATA = spigolo (la linea
//          ci fa l'angolo), TONDA = morbido (la linea ci passa in curva).
//        • PUNTI MORBIDI (4A): doppio-click su una maniglia (fase maniglie),
//          oppure maniglia selezionata + M (in tutte e due le fasi: e' la
//          strada senza doppio-click, per la penna). In fase traccia
//          Shift+tap mette un punto gia' morbido.
//        • ARCHI (4B): ogni lato ha un ROMBO a meta'; trascinandolo il lato
//          diventa un arco di cerchio che passa dal rombo (vale la regola per
//          lato: un arco vince sui morbidi). Il rombo VUOTO e' un lato che non
//          e' un arco, quello PIENO e' un arco. Per non riempire lo schermo i
//          rombi si vedono solo sul lato sotto il puntatore, sui due lati della
//          maniglia selezionata, sul rombo selezionato e su tutti gli archi.
//          Rombo selezionato + frecce = l'arco si aggiusta di fino; doppio-click
//          sul rombo di un arco, o rombo selezionato + M (o CANC) = l'arco si
//          toglie.
//        • Maniglie e rombi si prendono dal MIRINO (_aimAt, trappola 258): con
//          la lente tenendo premuto anche il rombo va piano (la vite), e dopo
//          il rilascio c'e' la frizione come per i punti.
//        • Prima la maniglia, poi il rombo: dove si toccano vince la maniglia.
//        • M vale solo dentro la modalita', senza Ctrl/Alt (Ctrl+M resta
//          libero) e non mentre si scrive in un campo.
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
  // --- La mira (cantiere «Il Mirino», Fetta 1) ---
  const CLIP_NUDGE_COMMIT_MS = 450;            // pausa dopo l'ultima freccia prima di ri-tagliare i tratti
  const CLIP_DBL_TAP_MS = 450;                 // due tap cosi' vicini nel tempo sono un doppio-click
  // --- La vite micrometrica (cantiere «Il Mirino», Fetta 2) ---
  // Il riduttore e' l'ingrandimento della lente al momento della pressione:
  // nessun numero da tarare qui. La classe su <body> nasconde il cursore di
  // sistema finche' si tiene premuto (la regola sta in index.html).
  const CLIP_AIM_HOLD_CLASS = "clip-aim-hold";
  // --- La frizione (cantiere «Il Mirino», Fetta 2-bis) ---
  // Quanta parte del movimento della mano, LUNGO lo scostamento, serve a
  // riassorbirlo: a 0,3 il mirino va al 70% o al 130% della mano in quella
  // direzione, e di traverso va uguale. Sopra CLIP_CLUTCH_SOFT_MAX_PX il
  // riassorbimento cresce in proporzione, fino a CLIP_CLUTCH_PULL_MAX.
  const CLIP_CLUTCH_PULL = 0.3;
  const CLIP_CLUTCH_SOFT_MAX_PX = 160;         // (px schermo) scostamento "grande"
  const CLIP_CLUTCH_PULL_MAX = 0.8;
  const CLIP_CLUTCH_EPS_PX = 0.25;             // (px schermo) sotto, la frizione si stacca
  // --- La frizione che slitta (cantiere «Il Mirino», Fetta 2-ter) ---
  // Quanta strada (px di schermo della MANO) dura la rampa dopo il rilascio
  // della vite: da 1/N a 1:1, un filo oltre, e di nuovo 1:1. Piu' e' lunga,
  // piu' i primi colpi del mouse restano lenti, ma piu' strada serve per
  // recuperare (se ci si ferma a meta', il pezzo non recuperato resta nello
  // scostamento e si riassorbe come sempre).
  const CLIP_CLUTCH_SLIP_PX = 40;
  // --- Le curve (cantiere «Il Mirino», Fetta 3) ---
  // Lo scarto massimo fra il poligono di taglio e la curva vera: 0,02 mm a
  // 96 PPI, in px LOGICI fissi. NON con mm2px: la calibrazione cambierebbe il
  // poligono e i tratti gia' tagliati non si riconoscerebbero piu' (trappola 252).
  const CLIP_CURVE_TOL_PX = 0.02 * 96 / 25.4;
  const CLIP_CURVE_ROUND = 100;                // i punti in mezzo si arrotondano a 0,01 px
  const CLIP_ARC_MAX_DEPTH = 8;                // al massimo 2^8 pezzi per meta' arco
  const CLIP_ARC_MAX_R_K = 2;                  // arco di piu' di mezzo giro: raggio al massimo 2 volte il lato (Fetta 4B)
  const CLIP_SOFT_MAX_SEG = 256;               // al massimo 256 pezzi per lato morbido
  // --- Le curve a mano (cantiere «Il Mirino», Fette 4A e 4B) ---
  // Maniglia QUADRATA = spigolo, TONDA = morbido, ROMBO a meta' lato = arco.
  // Il quadrato ha mezzo lato un filo piu' piccolo del raggio del tondo, cosi'
  // sembrano grandi uguali; il rombo e' piu' piccolo tutti e due.
  const CLIP_SQUARE_K = 0.9;                   // mezzo lato del quadrato = raggio del tondo × 0,9
  const CLIP_KNOB_RADIUS_PX = 4.6;             // (px schermo) rombo a riposo (mezza diagonale)
  const CLIP_KNOB_HOVER_RADIUS_PX = 5.8;       // (px schermo) rombo sotto il puntatore
  const CLIP_KNOB_SEL_RADIUS_PX = 6.6;         // (px schermo) rombo selezionato o tirato
  const CLIP_KNOB_LINE_W = 1.4;                // (px schermo) bordo del rombo
  const CLIP_KNOB_EMPTY_COLOR = "rgba(255,255,255,0.92)"; // rombo VUOTO (lato senza arco): bianco, bordo arancione
  const CLIP_KNOB_EDGE_COLOR = "rgba(255,255,255,0.95)";  // bordo del rombo selezionato (come le maniglie)
  const CLIP_KNOB_ARC_EDGE_COLOR = "rgba(90,40,0,0.95)";   // bordo del rombo PIENO (arco): scuro, si vede sulla carta

  // ============================================================
  //  STATO
  // ============================================================
  // Perimetro committato: array di {x,y} in coord canvas LOGICHE, oppure null.
  let clipPolygon =
    window.freehandClipPolygon && Array.isArray(window.freehandClipPolygon)
      ? window.freehandClipPolygon.slice()
      : null;
  // La FORMA del perimetro committato (Fetta 3): i vertici col loro tipo. Il
  // poligono qui sopra e' lei spianata. Ci sono sempre tutti e due, o nessuno.
  let clipShape = clipPolygon ? clipPolygon.map((p) => ({ x: p.x, y: p.y })) : null;

  let hoverPoint = null;        // ultimo punto (coord logiche) sotto il cursore

  // Modalita' perimetro: null (spenta) | "draw" (tracciamento) | "handles" (maniglie)
  let mode = null;
  let editPoints = [];          // la FORMA della sessione: vertici {x, y, s?, a?} (coord logiche)
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
  let nudgeTimer = null;        // frecce in fase maniglie: commit in attesa della pausa
  let lastTap = null;           // {t, x, y} (px client) dell'ultimo tap: riconosce il doppio-click
  let aiming = false;           // mira fine in corso: pulsante premuto con la lente a schermo
  let aimN = 1;                 // il riduttore di QUESTA pressione (= ingrandimento della lente)
  let downHand = null;          // punto logico della MANO al mousedown (il riduttore parte da li')
  let clutch = null;            // {x,y} logici: mirino - mano dopo il rilascio della vite (null = sotto la mano)
  let clutchHand = null;        // ultimo punto logico della mano visto dalla frizione
  let slipN = 1;                // il riduttore da cui riparte la frizione che slitta (= N della vite)
  let slipLeft = 0;             // px di schermo della mano che mancano alla velocita' piena (0 = attaccata)
  let selectedKnob = -1;        // rombo selezionato (= indice del lato), bersaglio di M, CANC e frecce
  let hoverKnob = -1;           // rombo sotto il puntatore (solo evidenza)
  let knobGrab = -1;            // rombo agganciato al mousedown (-1 = nessuno)
  let knobMoved = false;        // il rombo agganciato ha superato la soglia
  let downShift = false;        // Shift premuto alla pressione (Shift+tap = punto morbido)
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
  // ── LA LENTE E LE DISTANZE DI PRESA (trappola 246) ──
  // Ingrandimento della lente SE e' a schermo adesso, altrimenti 1. La
  // lente vive in freehandClipLens.js: qui si legge e basta.
  function _lensMag() {
    try {
      const L = window.freehandClipLens;
      if (L && typeof L.isVisible === "function" && L.isVisible() &&
          typeof L.getMag === "function") {
        const m = Number(L.getMag());
        if (Number.isFinite(m) && m > 1) return m;
      }
    } catch (e) {}
    return 1;
  }
  // Px LOGICI per un px «di chi guarda»: dello schermo grande se la lente
  // non c'e', del vetro della lente se c'e'. E' la misura giusta per le
  // distanze di presa: si prende quello che si VEDE vicino.
  function _aimK() {
    return _screenK() / _lensMag();
  }
  // Chiede alla lente di ridisegnarsi (le frecce muovono un punto senza
  // che il canvas faccia un render: la lente non lo saprebbe).
  function _lensRefresh() {
    try {
      const L = window.freehandClipLens;
      if (L && typeof L.requestRender === "function") L.requestRender();
    } catch (e) {}
  }

  // ── LA VITE MICROMETRICA (cantiere «Il Mirino», Fetta 2) ──
  // Il punto di mira. Senza pulsante premuto e' il puntatore. Premendo con
  // la lente a schermo la mano si demoltiplica: il mirino parte dal punto
  // della pressione e fa 1/N della strada della mano. Il conto si fa sui
  // punti LOGICI di getPointer, non sui pixel del client: cosi' non
  // dipende da come e' fatto lo zoom (CSS sul #paper, trappola 104) e una
  // mano ferma da' un mirino fermo anche se lo zoom cambia sotto.
  // ⚠ Fetta 2-bis: il mirino parte da dov'ERA alla pressione (downLogical,
  // che con la frizione e' scostato dalla mano), ma il riduttore conta la
  // strada della MANO da dov'era lei (downHand).
  function _aimFrom(p) {
    if (aiming && downLogical && aimN > 1) {
      const h0 = downHand || downLogical;
      return {
        x: downLogical.x + (p.x - h0.x) / aimN,
        y: downLogical.y + (p.y - h0.y) / aimN
      };
    }
    if (clutch) return { x: p.x + clutch.x, y: p.y + clutch.y };
    return { x: p.x, y: p.y };
  }
  function _aimAt(e) {
    const h = _pointer(e);
    _clutchFollow(e, h);
    return _aimFrom(h);
  }

  // ── LA FRIZIONE (cantiere «Il Mirino», Fetta 2-bis) ──
  // Si stacca: il mirino torna sotto la mano.
  function _clutchOff() {
    clutch = null;
    clutchHand = null;
    slipLeft = 0;
  }
  // Si attacca al rilascio della vite: mirino = mano + scostamento, e parte
  // lo slittamento da 1/N (Fetta 2-ter; n = il riduttore di quella vite).
  // Si attacca anche con scostamento zero (tap fermo): il colpetto del
  // rilascio deve restare lento lo stesso. (Fino alla 2-bis uno scostamento
  // sotto CLIP_CLUTCH_EPS_PX non la attaccava: con la rampa sempre accesa
  // quella guardia non scattava piu', e un mutante l'ha detto.)
  function _clutchSet(aim, hand, n) {
    clutch = { x: aim.x - hand.x, y: aim.y - hand.y };
    clutchHand = { x: hand.x, y: hand.y };
    slipN = n;
    slipLeft = CLIP_CLUTCH_SLIP_PX;
  }
  // La strada del mirino per s px di strada della mano, dall'inizio dello
  // slittamento (s fra 0 e S). Il riduttore e' r(u) = 1 - (1 - 1/N) q(u),
  // con u = s/S e q(u) = (1-u)^2 (1 - 10 u^2): q(0) = 1 (si parte da 1/N),
  // q(1) = 0 e piatta (si arriva a 1:1 senza strappo), e l'integrale di q
  // da 0 a 1 e' ZERO: la strada persa all'inizio si recupera tutta.
  // Qui sotto c'e' l'integrale: Q(u) = u - u^2 - 3u^3 + 5u^4 - 2u^5.
  function _slipPath(s) {
    const S = CLIP_CLUTCH_SLIP_PX, u = s / S;
    const Q = u - u * u - 3 * u * u * u + 5 * u * u * u * u - 2 * u * u * u * u * u;
    return s - (1 - 1 / slipN) * S * Q;
  }
  // La mano si e' mossa (h = punto logico della mano per l'evento e): lo
  // scostamento si riassorbe un poco, solo per la parte di movimento che va
  // lungo lo scostamento stesso. Il conto parte dall'ULTIMA posizione della
  // mano che ha visto, non dall'evento: questo file e la lente chiedono lo
  // stesso evento, e la seconda volta la mano non si e' mossa, quindi non
  // cambia niente. Il mirino e' lo stesso in qualunque ordine Fabric chiami
  // gli ascoltatori. (A pulsante premuto il conto gira lo stesso, ma non
  // conta: comanda la vite, e al rilascio _clutchSet riscrive tutto.)
  function _clutchFollow(e, h) {
    if (!clutch) return;
    // Senza lente a schermo la frizione non ha senso: la mano si vede.
    if (_lensMag() === 1) { _clutchOff(); return; }
    const last = clutchHand;
    clutchHand = { x: h.x, y: h.y };
    if (!last) return;
    const k = _screenK();
    // La frizione che slitta (Fetta 2-ter): finche' la mano non ha fatto
    // CLIP_CLUTCH_SLIP_PX px di strada, il mirino fa la strada di
    // _slipPath; la differenza va e torna nello scostamento. Niente
    // riassorbimento in questo tratto: e' la ripartenza, non il ritorno.
    let mx = h.x - last.x, my = h.y - last.y;
    if (slipLeft > 0) {
      const step = Math.hypot(mx, my) / k;          // px di schermo della mano
      if (!(step > 0)) return;
      const used = Math.min(step, slipLeft);
      const s0 = CLIP_CLUTCH_SLIP_PX - slipLeft;
      const f = used / step;                        // la parte di questo movimento dentro la rampa
      const r = (_slipPath(s0 + used) - _slipPath(s0)) / used;
      clutch = { x: clutch.x + (r - 1) * f * mx, y: clutch.y + (r - 1) * f * my };
      slipLeft = slipLeft - used > 1e-9 ? slipLeft - used : 0;
      if (f >= 1) return;
      // La rampa e' finita a meta' movimento: il resto va al riassorbimento,
      // come se fosse arrivato con un evento suo.
      mx *= 1 - f;
      my *= 1 - f;
    }
    const len = Math.hypot(clutch.x, clutch.y);
    if (!(len > CLIP_CLUTCH_EPS_PX * k)) { _clutchOff(); return; }
    const ux = clutch.x / len, uy = clutch.y / len;
    const along = Math.abs(mx * ux + my * uy);
    if (!(along > 0)) return;
    const pull = Math.min(CLIP_CLUTCH_PULL_MAX,
      CLIP_CLUTCH_PULL * Math.max(1, len / (CLIP_CLUTCH_SOFT_MAX_PX * k)));
    const next = len - pull * along;
    if (next <= CLIP_CLUTCH_EPS_PX * k) { _clutchOff(); return; }
    clutch = { x: ux * next, y: uy * next };
  }
  function _aimClass(on) {
    try {
      const b = document.body;
      if (b && b.classList) b.classList.toggle(CLIP_AIM_HOLD_CLASS, !!on);
    } catch (e) {}
  }
  // Comincia la mira fine se la lente e' a schermo; ritorna se e' cominciata.
  function _beginAim() {
    const m = _lensMag();
    aiming = m > 1;
    aimN = aiming ? m : 1;
    _aimClass(aiming);
    return aiming;
  }
  // Fine della mira: il cursore ricompare. Dove resta il mirino lo decide
  // chi chiama (al rilascio: la frizione, Fetta 2-bis).
  function _endAim() {
    aiming = false;
    aimN = 1;
    _aimClass(false);
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
  // Il pennello ridisegna TUTTO il foglio di sopra a ogni movimento? Solo
  // allora l'anello si puo' sovrapporre durante il tratto: il pennello lo
  // cancella al movimento dopo. Si chiede PRIMA al pennello (cantiere «Le
  // Punte», 27/09/2026): la penna a punte (Fetta 3) posa solo i timbri
  // nuovi e non cancella, e l'anello ci restava stampato a ogni movimento,
  // una scia di cerchi fino al rilascio (trappola 241). Il nome resta come
  // riserva per un pennello che non sa rispondere.
  function _brushIsFullRender() {
    const c = _canvas();
    const b = c && c.freeDrawingBrush;
    if (!b) return false;
    if (typeof b.needsFullRender === "function") {
      try { return !!b.needsFullRender(); } catch (e) {}
    }
    if (b.name === "pressure-pencil") return true;
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
    const k = _aimK();
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
  // ============================================================
  //  LE CURVE — il motore (cantiere «Il Mirino», Fetta 3, 7 ottobre 2026)
  // ============================================================
  // Il perimetro e' DUE cose (§5.4 del cantiere):
  //   • la FORMA (clipShape, e editPoints durante la sessione): i vertici, ognuno
  //     {x, y} piu' due campi facoltativi —
  //       s: true      il vertice e' MORBIDO (senza: e' uno spigolo, come sempre);
  //       a: [t, h]    il lato che PARTE da questo vertice e' un ARCO di cerchio
  //                    che passa dal pallino P = A + t·D + h·perp(D), con
  //                    A = questo vertice, D = vertice dopo − A, perp(D) = (−D.y, D.x).
  //                    t e h sono frazioni della lunghezza del lato: allungando il
  //                    lato l'arco si allarga con lui (trappola 251).
  //   • il POLIGONO DI TAGLIO (clipPolygon): la forma «spianata» in lati piccoli.
  //     E' lui che va al clipPath, a __clipPoly, a _samePoly, al file: chi non
  //     sa delle curve vede un poligono e taglia giusto (trappola 248).
  // La regola per lato (la stessa ovunque):
  //   1. il vertice di partenza ha un arco → arco;
  //   2. altrimenti, almeno uno dei due estremi e' morbido → curva morbida
  //      (Catmull-Rom centripeta: passa dai vertici, niente riccioli);
  //   3. altrimenti → dritto, come sempre.
  // ⚠ LO SPIANAMENTO E' UN'IMPRONTA (trappola 252): stessa forma → stesso
  // poligono, al bit, su ogni PC e in ogni momento. Per questo:
  //   • dipende SOLO dalla forma: la tolleranza e' in px LOGICI fissi (0,02 mm
  //     a 96 PPI), non dallo zoom e nemmeno dalla calibrazione (cambiare la
  //     calibrazione non deve staccare i tratti dal loro perimetro);
  //   • usa solo + − × ÷ e Math.sqrt, che IEEE 754 arrotonda in un modo solo
  //     (niente sin/cos/atan2/pow: la loro ultima cifra puo' cambiare fra
  //     motori). Gli archi si spianano per BISEZIONE, non per angoli;
  //   • i vertici restano ESATTI (sono i punti dell'utente); i punti in mezzo
  //     si arrotondano a 0,01 px. Un perimetro di soli spigoli e lati dritti
  //     spianato e' identico, al bit, a quello di prima delle curve.
  function _cloneShape(sh) {
    return sh.map((q) => {
      const r = { x: q.x, y: q.y };
      if (q.s === true) r.s = true;
      if (_validArc(q.a)) r.a = [q.a[0], q.a[1]];
      return r;
    });
  }
  function _validArc(a) {
    return Array.isArray(a) && a.length === 2 && Number.isFinite(a[0]) && Number.isFinite(a[1]);
  }
  function _shapeHasCurves(sh) {
    if (!Array.isArray(sh)) return false;
    for (let i = 0; i < sh.length; i++) {
      if (sh[i] && (sh[i].s === true || _validArc(sh[i].a))) return true;
    }
    return false;
  }
  // Che lato e' il lato i (dal vertice i al successivo)?
  function _sideKind(sh, i, closed) {
    const n = sh.length;
    const j = i + 1 < n ? i + 1 : (closed ? 0 : -1);
    if (j < 0) return "none";
    if (_validArc(sh[i].a)) return "arc";
    if (sh[i].s === true || sh[j].s === true) return "soft";
    return "line";
  }
  function _r2(v) { return Math.round(v * CLIP_CURVE_ROUND) / CLIP_CURVE_ROUND; }
  function _len(dx, dy) { return Math.sqrt(dx * dx + dy * dy); }

  // ── L'ARCO per tre punti: A, il pallino P, B ──
  // Restituisce { cx, cy, R, o } (o = +1 o −1: il verso in cui l'arco va da A
  // a P a B), oppure null se i tre punti sono in fila o il lato e' nullo.
  function _arcCircle(A, P, B) {
    const ax = A.x, ay = A.y, px = P.x, py = P.y, bx = B.x, by = B.y;
    const d = 2 * (ax * (py - by) + px * (by - ay) + bx * (ay - py));
    if (!(Math.abs(d) > 1e-12)) return null;
    const a2 = ax * ax + ay * ay, p2 = px * px + py * py, b2 = bx * bx + by * by;
    const cx = (a2 * (py - by) + p2 * (by - ay) + b2 * (ay - py)) / d;
    const cy = (a2 * (bx - px) + p2 * (ax - bx) + b2 * (px - ax)) / d;
    const R = _len(ax - cx, ay - cy);
    if (!(R > 0) || !Number.isFinite(R)) return null;
    const turn = (px - ax) * (by - py) - (py - ay) * (bx - px);
    return { cx: cx, cy: cy, R: R, o: turn > 0 ? 1 : -1 };
  }
  // Il punto a meta' dell'arco che va da X a Y nel verso o (solo radici).
  function _arcMid(c, X, Y) {
    const vx = (X.x + Y.x) / 2 - c.cx, vy = (X.y + Y.y) / 2 - c.cy;
    const cr = (X.x - c.cx) * (Y.y - c.cy) - (X.y - c.cy) * (Y.x - c.cx);
    let dx, dy;
    if (cr * c.o > 0) { dx = vx; dy = vy; }            // meno di mezzo giro
    else if (cr * c.o < 0) { dx = -vx; dy = -vy; }     // piu' di mezzo giro
    else {                                             // mezzo giro esatto
      dx = -c.o * (X.y - c.cy); dy = c.o * (X.x - c.cx);
    }
    const L = _len(dx, dy);
    if (!(L > 0)) return { x: X.x, y: X.y };
    return { x: c.cx + c.R * dx / L, y: c.cy + c.R * dy / L };
  }
  // Quante volte bisecare l'arco X→Y perche' ogni pezzo stia nella tolleranza.
  function _arcDepth(c, X, Y) {
    let a = X, b = Y, k = 0;
    // il primo taglio e' sempre fatto: un pezzo da piu' di mezzo giro non ha
    // una freccia misurabile con la corda
    while (k < CLIP_ARC_MAX_DEPTH) {
      const m = _arcMid(c, a, b);
      k++;
      b = m;
      const half = _len(b.x - a.x, b.y - a.y) / 2;
      const inside = c.R * c.R - half * half;
      const sag = c.R - Math.sqrt(inside > 0 ? inside : 0);
      if (sag <= CLIP_CURVE_TOL_PX) break;
    }
    return k;
  }
  function _arcPush(c, X, Y, depth, out) {
    if (depth <= 0) return;
    const m = _arcMid(c, X, Y);
    _arcPush(c, X, m, depth - 1, out);
    out.push(m);
    _arcPush(c, m, Y, depth - 1, out);
  }
  // Il pallino dell'arco del lato A→B, in punti del foglio.
  function _arcKnob(A, B, a) {
    const dx = B.x - A.x, dy = B.y - A.y;
    return { x: A.x + a[0] * dx - a[1] * dy, y: A.y + a[0] * dy + a[1] * dx };
  }
  // Un punto Q in proporzione al lato A→B (l'inverso di _arcKnob).
  function _toArc(A, B, Q) {
    const dx = B.x - A.x, dy = B.y - A.y, L2 = dx * dx + dy * dy;
    if (!(L2 > 0)) return null;
    const qx = Q.x - A.x, qy = Q.y - A.y;
    return [(qx * dx + qy * dy) / L2, (qy * dx - qx * dy) / L2];
  }
  // I punti in mezzo (non arrotondati) del lato ad arco A→B, o null se
  // l'arco e' cosi' piatto da essere un lato dritto (freccia sotto la
  // tolleranza) o degenere.
  function _arcPointsRaw(A, B, a) {
    const L = _len(B.x - A.x, B.y - A.y);
    if (!(L > 0)) return null;
    const P = _arcKnob(A, B, a);
    if (!_arcWorthIt(A, P, B, L)) return null;
    const c = _arcCircle(A, P, B);
    if (!c) return null;
    const pts = [];
    _arcPush(c, A, P, _arcDepth(c, A, P), pts);
    pts.push(P);
    _arcPush(c, P, B, _arcDepth(c, P, B), pts);
    // (Fino alla Fetta 3 qui si misurava quanto i puntini si staccano dalla
    // corda: dalla 4B l'arco piatto lo decide _arcWorthIt, esatto, prima del
    // cerchio. Quella misura sui puntini era la stessa regola fatta a occhio,
    // e un mutante ha detto che non decideva piu' niente.)
    return { pts: pts, circle: c, knob: P };
  }

  // ⚠ L'ARCO QUASI PIATTO (Fetta 4B, trappola 262). Tirando un rombo lo si
  // riporta spesso sulla corda: il pallino resta fuori di un nulla (10^-16) e
  // il cerchio per tre punti quasi in fila ha il centro a miliardi di px, i
  // conti perdono tutte le cifre e la «curva» esce a zig-zag, fino a 1 mm
  // fuori dal lato vero. Quindi PRIMA di cercare il cerchio si decide se ne
  // vale la pena, con conti che non perdono cifre (solo i lati del triangolo
  // A P B e la sua area, niente centro):
  //   • P sull'arco MINORE (l'angolo in P e' ottuso: meno di mezzo giro): la
  //     freccia vera e' (L/2)² / (R + √(R² − (L/2)²)), con R = |AP|·|PB|·L /
  //     (2·|AP × PB|); sotto la tolleranza il lato e' dritto;
  //   • P sull'arco MAGGIORE (piu' di mezzo giro: il rombo tirato oltre un
  //     estremo): si accetta solo con R fino a CLIP_ARC_MAX_R_K volte il lato.
  //     Oltre, il cerchio sarebbe enorme e la «curva» un giro gigante fuori
  //     dal foglio: il lato resta dritto;
  //   • P in fila con A e B (area zero): dritto.
  // Solo + − × ÷ e √: lo spianamento resta un'impronta (trappola 252). Dove i
  // conti di prima erano giusti il risultato non cambia: un arco con la
  // freccia sotto la tolleranza era gia' dritto.
  function _arcWorthIt(A, P, B, L) {
    const apx = A.x - P.x, apy = A.y - P.y, bpx = B.x - P.x, bpy = B.y - P.y;
    const area2 = Math.abs(apx * bpy - apy * bpx);
    // in fila (area zero): R infinito o 0/0, e il lato resta dritto
    const R = _len(apx, apy) * _len(bpx, bpy) * L / (2 * area2);
    if (!Number.isFinite(R)) return false;
    if (apx * bpx + apy * bpy < 0) {
      const h = L / 2;
      const sag = h * h / (R + Math.sqrt(R * R > h * h ? R * R - h * h : 0));
      return sag >= CLIP_CURVE_TOL_PX;
    }
    return R <= CLIP_ARC_MAX_R_K * L;
  }

  // ── LA CURVA MORBIDA: Catmull-Rom centripeta, come Bézier cubica ──
  // Il lato P1→P2, con i vicini P0 e P3. Un estremo che e' uno SPIGOLO non
  // guarda il vicino oltre di se': al suo posto un vicino finto, il
  // simmetrico (la curva parte, o arriva, lungo la corda: e' l'angolo vero).
  function _softPointsRaw(P0, P1, P2, P3) {
    const d12 = _len(P2.x - P1.x, P2.y - P1.y);
    if (!(d12 > 0)) return [];
    let d01 = _len(P1.x - P0.x, P1.y - P0.y);
    if (!(d01 > 0)) { P0 = { x: 2 * P1.x - P2.x, y: 2 * P1.y - P2.y }; d01 = d12; }
    let d23 = _len(P3.x - P2.x, P3.y - P2.y);
    if (!(d23 > 0)) { P3 = { x: 2 * P2.x - P1.x, y: 2 * P2.y - P1.y }; d23 = d12; }
    const t1 = Math.sqrt(d01), t2 = t1 + Math.sqrt(d12), t3 = t2 + Math.sqrt(d23);
    const k12 = t2 - t1;
    // le derivate in P1 e in P2 (Barry–Goldman, con t0 = 0)
    const m1x = (P1.x - P0.x) / t1 - (P2.x - P0.x) / t2 + (P2.x - P1.x) / k12;
    const m1y = (P1.y - P0.y) / t1 - (P2.y - P0.y) / t2 + (P2.y - P1.y) / k12;
    const m2x = (P2.x - P1.x) / k12 - (P3.x - P1.x) / (t3 - t1) + (P3.x - P2.x) / (t3 - t2);
    const m2y = (P2.y - P1.y) / k12 - (P3.y - P1.y) / (t3 - t1) + (P3.y - P2.y) / (t3 - t2);
    const b1x = P1.x + m1x * k12 / 3, b1y = P1.y + m1y * k12 / 3;
    const b2x = P2.x - m2x * k12 / 3, b2y = P2.y - m2y * k12 / 3;
    // quanti pezzi: con n pezzi uguali lo scarto e' al massimo 6M / (8 n²)
    const M = Math.max(
      _len(P1.x - 2 * b1x + b2x, P1.y - 2 * b1y + b2y),
      _len(b1x - 2 * b2x + P2.x, b1y - 2 * b2y + P2.y));
    let n = Math.ceil(Math.sqrt(3 * M / (4 * CLIP_CURVE_TOL_PX)));
    if (!(n >= 1)) n = 1;
    if (n > CLIP_SOFT_MAX_SEG) n = CLIP_SOFT_MAX_SEG;
    const out = [];
    for (let i = 1; i < n; i++) {
      const u = i / n, v = 1 - u;
      const w0 = v * v * v, w1 = 3 * u * v * v, w2 = 3 * u * u * v, w3 = u * u * u;
      out.push({ x: w0 * P1.x + w1 * b1x + w2 * b2x + w3 * P2.x,
                 y: w0 * P1.y + w1 * b1y + w2 * b2y + w3 * P2.y });
    }
    return out;
  }

  // I punti IN MEZZO al lato i (arrotondati, senza i due vertici).
  function _sideInner(sh, i, closed) {
    const n = sh.length;
    const kind = _sideKind(sh, i, closed);
    if (kind === "line" || kind === "none") return [];
    const j = (i + 1) % n;
    const A = sh[i], B = sh[j];
    let raw = null;
    if (kind === "arc") {
      const r = _arcPointsRaw(A, B, A.a);
      raw = r ? r.pts : [];
    } else {
      const hasPrev = closed || i > 0;
      const hasNext = closed || j + 1 < n;
      const P0 = (A.s === true && hasPrev) ? sh[(i - 1 + n) % n] : { x: 2 * A.x - B.x, y: 2 * A.y - B.y };
      const P3 = (B.s === true && hasNext) ? sh[(j + 1) % n] : { x: 2 * B.x - A.x, y: 2 * B.y - A.y };
      raw = _softPointsRaw(P0, A, B, P3);
    }
    return raw.map((q) => ({ x: _r2(q.x), y: _r2(q.y) }));
  }
  // La forma spianata. vIdx (se passato) riceve, per ogni vertice, il suo
  // posto nel poligono spianato. Soli spigoli e lati dritti = i vertici, tali e
  // quali (prova d'identita').
  function _flatten(sh, closed, vIdx) {
    const n = sh ? sh.length : 0;
    if (!n) return [];
    const out = [{ x: sh[0].x, y: sh[0].y }];
    if (vIdx) vIdx.push(0);
    const sides = closed ? n : n - 1;
    for (let i = 0; i < sides; i++) {
      const inner = _sideInner(sh, i, closed);
      for (let k = 0; k < inner.length; k++) out.push(inner[k]);
      const j = (i + 1) % n;
      if (closed && j === 0) break;               // il ritorno al primo vertice
      out.push({ x: sh[j].x, y: sh[j].y });
      if (vIdx) vIdx.push(out.length - 1);
    }
    return out;
  }

  // Lato piu' vicino a p, con il punto di appoggio. Null se troppo lontano.
  // I lati sono quelli dell'anello CHIUSO (l'ultimo torna al primo), e dalla
  // Fetta 3 sono quelli SPIANATI: il punto d'appoggio sta sulla curva che si
  // vede, non sulla corda.
  function _nearestEdge(p) {
    if (editPoints.length < 2) return null;
    return _nearestSide(p, true);
  }
  // Lo stesso, sull'anello chiuso (fase maniglie) o sulla spezzata aperta
  // (fase traccia: l'ultimo lato non c'e' ancora). Serve anche ai rombi.
  function _nearestSide(p, closed) {
    const n = editPoints.length;
    const sides = closed ? n : n - 1;
    if (!p || n < 2 || sides < 1) return null;
    const k = _aimK();
    const maxD = CLIP_EDGE_INSERT_SNAP_PX * k;
    let best = null;
    let bestD2 = maxD * maxD;
    for (let i = 0; i < sides; i++) {
      const run = _sideRun(editPoints, i, closed);
      for (let m = 0; m + 1 < run.length; m++) {
        const pr = _projectOnSegment(p, run[m], run[m + 1]);
        const d2 = _dist2(p.x, p.y, pr.x, pr.y);
        if (d2 <= bestD2) { bestD2 = d2; best = { index: i, point: pr }; }
      }
    }
    return best;
  }
  // Sposta il vertice i in (x, y) tenendo il suo tipo (morbido, arco).
  function _moveVertex(i, x, y) {
    const q = editPoints[i];
    if (!q) return;
    const r = { x: x, y: y };
    if (q.s === true) r.s = true;
    if (_validArc(q.a)) r.a = [q.a[0], q.a[1]];
    editPoints[i] = r;
  }

  // ============================================================
  //  I ROMBI (cantiere «Il Mirino», Fetta 4B, 14 ottobre 2026)
  // ============================================================
  // Il lato i della forma sh, come si vede: [A, punti in mezzo, B].
  function _sideRun(sh, i, closed) {
    const n = sh.length;
    return [sh[i]].concat(_sideInner(sh, i, closed), [sh[(i + 1) % n]]);
  }
  // Quanti lati ha la sessione: tutti in fase maniglie (anello chiuso), uno
  // di meno in fase traccia (il lato di chiusura non c'e' ancora).
  function _sideCount() {
    const n = editPoints.length;
    if (mode === "handles") return n >= CLIP_MIN_VERTICES ? n : 0;
    if (mode === "draw") return n >= 2 ? n - 1 : 0;
    return 0;
  }
  // Dove sta il rombo del lato i. Su un arco e' il suo pallino (l'arco ci
  // passa per costruzione); su un lato dritto o morbido e' a meta' strada
  // lungo la linea che si vede.
  function _knobPos(i) {
    const n = editPoints.length;
    const A = editPoints[i], B = editPoints[(i + 1) % n];
    if (_validArc(A.a)) return _arcKnob(A, B, A.a);
    const run = _sideRun(editPoints, i, mode === "handles");
    let tot = 0;
    for (let m = 0; m + 1 < run.length; m++) tot += _len(run[m + 1].x - run[m].x, run[m + 1].y - run[m].y);
    let half = tot / 2;
    for (let m = 0; m + 1 < run.length; m++) {
      const L = _len(run[m + 1].x - run[m].x, run[m + 1].y - run[m].y);
      if (L > 0 && L >= half) {
        const t = half / L;
        return { x: run[m].x + (run[m + 1].x - run[m].x) * t, y: run[m].y + (run[m + 1].y - run[m].y) * t };
      }
      half -= L;
    }
    return { x: (A.x + B.x) / 2, y: (A.y + B.y) / 2 };
  }
  // Quali rombi si vedono (§5.4 del cantiere: lo schermo non si riempie,
  // anche con un punto ogni 7 mm): tutti gli archi; i due lati della maniglia
  // selezionata; il rombo selezionato e quello che si sta tirando; e, a
  // pulsante alzato, il lato sotto il punto p (il mirino) se li' non c'e'
  // una maniglia. Indici dei lati, in ordine.
  function _knobSides(p) {
    const cnt = _sideCount();
    const out = [];
    if (!cnt) return out;
    const n = editPoints.length;
    const closed = mode === "handles";
    const add = (i) => { if (i >= 0 && i < cnt && out.indexOf(i) < 0) out.push(i); };
    for (let i = 0; i < cnt; i++) if (_validArc(editPoints[i].a)) add(i);
    if (selectedHandle >= 0 && selectedHandle < n) {
      add(selectedHandle);
      add(closed ? (selectedHandle - 1 + n) % n : selectedHandle - 1);
    }
    add(selectedKnob);
    add(knobGrab);
    if (p && !pointerDown && _hitHandle(p) < 0) {
      const s = _nearestSide(p, closed);
      if (s) add(s.index);
    }
    return out.sort((x, y) => x - y);
  }
  // Il rombo sotto il punto p (coord logiche), o -1: fra quelli che si
  // vedono, il piu' vicino, con la stessa presa delle maniglie (nel vetro
  // della lente, se c'e': trappola 246).
  function _hitKnob(p) {
    if (!p) return -1;
    const r = CLIP_HANDLE_GRAB_PX * _aimK();
    let best = -1;
    let bestD = r * r;
    const sides = _knobSides(p);
    for (let m = 0; m < sides.length; m++) {
      const q = _knobPos(sides[m]);
      const d = _dist2(q.x, q.y, p.x, p.y);
      if (d <= bestD) { bestD = d; best = sides[m]; }
    }
    return best;
  }
  // Il lato i diventa l'arco che passa da P; se P sta sulla corda (l'arco
  // starebbe entro 0,02 mm da lei) il lato torna senza arco. Il tipo del
  // vertice resta. Il pallino si salva in proporzione al lato (trappola 251).
  function _setKnob(i, P) {
    const n = editPoints.length;
    const A = editPoints[i], B = editPoints[(i + 1) % n];
    if (!A || !B) return;
    const a = _toArc(A, B, P);
    const r = { x: A.x, y: A.y };
    if (A.s === true) r.s = true;
    if (a && _arcPointsRaw(A, B, a)) r.a = a;
    editPoints[i] = r;
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

      // Fetta 4A: quadrata = spigolo, tonda = morbido.
      _traceHandle(ctx, pts[i].x, pts[i].y, r * k, pts[i].s === true);
      ctx.fillStyle = fill;
      ctx.fill();
      ctx.lineWidth = 1 * k;
      ctx.strokeStyle = isSel ? "rgba(255,255,255,0.95)" : CLIP_GUIDE_COLOR;
      ctx.stroke();
    }
  }
  // Il segno di una maniglia attorno a (x, y), r = raggio: un tondo per un
  // punto morbido, un quadrato per uno spigolo (Fetta 4A).
  function _traceHandle(ctx, x, y, r, soft) {
    ctx.beginPath();
    if (soft) { ctx.arc(x, y, r, 0, Math.PI * 2); return; }
    const h = r * CLIP_SQUARE_K;
    ctx.rect(x - h, y - h, 2 * h, 2 * h);
  }
  // Un rombo attorno a (x, y), r = mezza diagonale (Fetta 4B).
  function _traceKnob(ctx, x, y, r) {
    ctx.beginPath();
    ctx.moveTo(x, y - r);
    ctx.lineTo(x + r, y);
    ctx.lineTo(x, y + r);
    ctx.lineTo(x - r, y);
    ctx.closePath();
  }
  // I rombi che si vedono (Fetta 4B): VUOTO (bianco, bordo arancione) = il lato
  // non e' un arco e si puo' piegare; PIENO (arancione, bordo scuro) = e' un
  // arco; ciano = selezionato o tirato adesso.
  function _paintKnobs(ctx, k) {
    const sides = _knobSides(hoverPoint);
    for (let m = 0; m < sides.length; m++) {
      const i = sides[m];
      const q = _knobPos(i);
      const isSel = i === selectedKnob || i === knobGrab;
      const isHover = i === hoverKnob;
      let r = CLIP_KNOB_RADIUS_PX;
      if (isSel) r = CLIP_KNOB_SEL_RADIUS_PX;
      else if (isHover) r = CLIP_KNOB_HOVER_RADIUS_PX;
      const arc = _validArc(editPoints[i].a);
      _traceKnob(ctx, q.x, q.y, r * k);
      ctx.fillStyle = isSel ? CLIP_HANDLE_SEL_COLOR : (arc ? CLIP_GUIDE_COLOR : CLIP_KNOB_EMPTY_COLOR);
      ctx.fill();
      ctx.lineWidth = CLIP_KNOB_LINE_W * k;
      ctx.strokeStyle = isSel ? CLIP_KNOB_EDGE_COLOR : (arc ? CLIP_KNOB_ARC_EDGE_COLOR : CLIP_GUIDE_COLOR);
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
      _paintRing(ctx, k, _flatten(editPoints, true));
      _paintKnobs(ctx, k);
      _paintHandles(ctx, k, editPoints, false);
      return;
    }

    // 3) Fase tracciamento: spezzata aperta + elastico + maniglie. La linea e'
    // quella spianata (Fetta 3); le maniglie stanno sui vertici.
    const pts = editPoints;
    const line = _flatten(pts, false);
    if (pts.length >= 1) {
      ctx.beginPath();
      ctx.moveTo(line[0].x, line[0].y);
      for (let i = 1; i < line.length; i++) ctx.lineTo(line[i].x, line[i].y);
      // segmento "elastico" fino al cursore (se non sto trascinando nulla)
      if (!dragStarted && grabIndex < 0 && knobGrab < 0 && hoverPoint) ctx.lineTo(hoverPoint.x, hoverPoint.y);
      ctx.lineWidth = CLIP_GUIDE_LINE_W * k;
      ctx.strokeStyle = CLIP_GUIDE_COLOR;
      ctx.setLineDash([CLIP_GUIDE_DASH[0] * k, CLIP_GUIDE_DASH[1] * k]);
      ctx.stroke();
      ctx.setLineDash([]);

      // velo interno se la sessione e' gia' un poligono plausibile
      if (pts.length >= CLIP_MIN_VERTICES) {
        ctx.beginPath();
        ctx.moveTo(line[0].x, line[0].y);
        for (let i = 1; i < line.length; i++) ctx.lineTo(line[i].x, line[i].y);
        ctx.closePath();
        ctx.fillStyle = CLIP_GUIDE_FILL;
        ctx.fill();
      }
    }
    _paintKnobs(ctx, k);
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
  // Dalla Fetta 3 «pts» e' la FORMA (vertici col tipo): il poligono di taglio
  // si ottiene spianandola. Il Ctrl+Z di sessione ricorda le FORME; le forme
  // «viste» (per riconoscere i tratti) sono i poligoni SPIANATI.
  function _commitShape(pts, opts) {
    if (!_validPoly(pts)) return false;
    const previous = _validPoly(clipPolygon) ? _clonePoly(clipPolygon) : null;
    const previousShape = previous ? _cloneShape(clipShape) : null;

    if (!(opts && opts.noUndo)) {
      if (previousShape) {
        shapeUndo.push(previousShape);
        if (shapeUndo.length > CLIP_SHAPE_UNDO_LIMIT) shapeUndo.shift();
      }
    }
    if (previous) _rememberShape(previous);

    clipShape = _cloneShape(pts);
    clipPolygon = _flatten(clipShape, true);
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
  // Il poligono SPIANATO, punto per punto. Se la forma ha curve, i punti che
  // sono vertici veri portano v (1 spigolo, 2 morbido) e, se il lato che parte
  // da li' e' un arco, a: [t, h] (Fetta 3, §5.5). Soli spigoli e lati dritti:
  // nessun campo in piu', come prima.
  function getFreehandClipPolygon() {
    if (!(clipPolygon && clipPolygon.length >= CLIP_MIN_VERTICES)) return null;
    const out = _clonePoly(clipPolygon);
    if (!_shapeHasCurves(clipShape)) return out;
    const vIdx = [];
    const flat = _flatten(clipShape, true, vIdx);
    if (!_samePoly(flat, out)) return out;          // non dovrebbe mai succedere
    for (let k = 0; k < vIdx.length; k++) {
      const q = clipShape[k], o = out[vIdx[k]];
      o.v = q.s === true ? 2 : 1;
      if (_validArc(q.a)) o.a = [q.a[0], q.a[1]];
    }
    return out;
  }
  // La forma da un poligono letto dal file: se ha i vertici marcati (v) e il
  // loro spianamento torna AL CENTESIMO col poligono del file, la forma e'
  // quella; altrimenti (file vecchio, file risalvato da un Mosaica vecchio, o
  // qualcosa che non torna) ogni punto e' uno spigolo e vince il file: si
  // taglia esattamente quello che c'e' scritto.
  function _shapeFromSaved(raw, plain) {
    const verts = [];
    for (let i = 0; i < raw.length; i++) {
      const p = raw[i];
      if (!p || (p.v !== 1 && p.v !== 2)) continue;
      const x = +p.x, y = +p.y;
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      const q = { x: x, y: y };
      if (p.v === 2) q.s = true;
      if (Array.isArray(p.a) && p.a.length === 2 && Number.isFinite(+p.a[0]) && Number.isFinite(+p.a[1])) {
        q.a = [+p.a[0], +p.a[1]];
      }
      verts.push(q);
    }
    if (verts.length >= CLIP_MIN_VERTICES && _samePoly(_flatten(verts, true), plain)) return verts;
    return plain.map((p) => ({ x: p.x, y: p.y }));
  }
  // Imposta il poligono (es. al caricamento progetto). Non applica il clip:
  // chi chiama deve poi invocare applyFreehandClipToAll() quando gli oggetti
  // sono sul canvas. opts.silent = non mostrare toast.
  function setFreehandClipPolygon(poly, opts) {
    _dropNudge();                   // la forma arriva da fuori: vince lei
    if (Array.isArray(poly) && poly.length >= CLIP_MIN_VERTICES) {
      clipPolygon = poly.map((p) => ({ x: +p.x, y: +p.y })).filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
      if (clipPolygon.length < CLIP_MIN_VERTICES) clipPolygon = null;
    } else {
      clipPolygon = null;
    }
    clipShape = clipPolygon ? _shapeFromSaved(poly, clipPolygon) : null;
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
    _knobReset();
    sessionChanged = false;
    shapeUndo = [];
    shapeSeen = [];
    lastTap = null;
    _endAim();

    if (_validPoly(clipPolygon)) {
      mode = "handles";
      editPoints = _cloneShape(clipShape);
      selectedHandle = -1;
      _rememberShape(clipPolygon);
      _toast(_t("freehandClip.toast.handles",
        "⬡ Maniglie: trascina per spostare, frecce = di fino, M = morbido/spigolo, rombo a metà lato = arco, doppio-click su un lato = punto nuovo, CANC = togli, Invio = fine"));
    } else {
      mode = "draw";
      editPoints = [];
      selectedHandle = -1;
      _toast(_t("freehandClip.toast.start",
        "⬡ Perimetro: tap = vertice, Shift+tap = vertice morbido, con la lente tieni premuto = mira lenta (L spenta = mano libera), le maniglie si spostano, Invio/doppio-click = chiudi, ESC = annulla"));
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
    editPoints = _cloneShape(clipShape);
    mode = "handles";
    selectedHandle = -1;
    hoverHandle = -1;
    _knobReset();
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
    _flushNudge();                  // le frecce in attesa valgono: si escono applicate
    lastTap = null;
    _endAim();                      // anche uscendo a pulsante premuto (ESC): il cursore torna
    _clutchOff();
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
    _knobReset();
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
    _dropNudge();
    if (mode) exitMode({ silent: true });
    clipPolygon = null;
    clipShape = null;
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
    const k = _aimK();
    const grab = CLIP_HANDLE_GRAB_PX * k;
    for (let i = 0; i < editPoints.length; i++) {
      if (_dist2(editPoints[i].x, editPoints[i].y, edge.point.x, edge.point.y) <= grab * grab) return false;
    }
    const next = _cloneShape(editPoints);
    next.splice(edge.index + 1, 0, _splitSide(next, edge.index, edge.point));
    _commitShape(next);
    editPoints = _cloneShape(clipShape);
    selectedHandle = edge.index + 1;
    _knobReset();
    _toast(_t("freehandClip.toast.vertexAdded", "⬡ Punto aggiunto al perimetro"));
    _redraw(true);
    return true;
  }

  // Il vertice nuovo N sul lato i (Fetta 3): su un lato morbido nasce morbido
  // (la curva continua); su un arco l'arco si divide in due archi dello STESSO
  // cerchio, e il vertice i prende il primo dei due. Su un lato dritto: uno
  // spigolo, come sempre. N e' il punto d'appoggio sul lato spianato.
  function _splitSide(sh, i, N) {
    const n = sh.length;
    const A = sh[i], B = sh[(i + 1) % n];
    const v = { x: N.x, y: N.y };
    const kind = _sideKind(sh, i, true);
    if (kind === "soft") { v.s = true; return v; }
    if (kind === "arc") {
      const r = _arcPointsRaw(A, B, A.a);
      if (!r) { delete A.a; return v; }
      const a1 = _toArc(A, v, _arcMid(r.circle, A, v));
      const a2 = _toArc(v, B, _arcMid(r.circle, v, B));
      if (a1) A.a = a1; else delete A.a;
      if (a2) v.a = a2;
    }
    return v;
  }

  function removeSelectedHandle() {
    if (mode !== "handles") return false;
    if (selectedHandle < 0 || selectedHandle >= editPoints.length) return false;
    if (editPoints.length <= CLIP_MIN_VERTICES) {
      _toast(_t("freehandClip.toast.minPoints", "⬡ Un perimetro ha bisogno di almeno 3 punti"));
      return false;
    }
    const next = _cloneShape(editPoints);
    next.splice(selectedHandle, 1);
    // Il lato che arrivava al punto tolto ora va al punto dopo: era un arco
    // fatto per un altro lato, non vale piu' (Fetta 3).
    const prev = next[(selectedHandle - 1 + next.length) % next.length];
    if (prev && prev.a) delete prev.a;
    _commitShape(next);
    editPoints = _cloneShape(clipShape);
    selectedHandle = -1;
    hoverHandle = -1;
    _knobReset();
    _toast(_t("freehandClip.toast.vertexRemoved", "⬡ Punto rimosso dal perimetro"));
    _redraw(true);
    return true;
  }

  // ── Le due operazioni del motore delle curve (Fetta 3) ──
  // Le useranno i gesti delle fette 4A (M, doppio-click, Shift+tap) e 4B (i
  // rombi). Valgono solo dentro la modalita'. In fase maniglie cambiano la
  // forma committata (un passo di Ctrl+Z, il taglio dei tratti segue); in
  // fase traccia cambiano solo la sessione.
  function _applyShapeEdit(next) {
    if (mode === "handles") {
      _flushNudge();
      _commitShape(next);
      editPoints = _cloneShape(clipShape);
    } else {
      editPoints = next;
    }
    _redraw(true);
    _lensRefresh();
    return true;
  }
  // Il vertice i diventa morbido (on = true) o spigolo (on = false).
  function setVertexSoft(i, on) {
    if (!mode || !(i >= 0 && i < editPoints.length)) return false;
    const want = !!on;
    if ((editPoints[i].s === true) === want) return false;
    const next = _cloneShape(editPoints);
    if (want) next[i].s = true; else delete next[i].s;
    return _applyShapeEdit(next);
  }
  // Il lato che parte dal vertice i diventa un arco col pallino a = [t, h]
  // (in proporzione al lato), oppure torna dritto (a = null). Un arco cosi'
  // piatto da stare entro 0,02 mm dalla corda torna dritto da solo.
  function setSideArc(i, a) {
    if (!mode || !(i >= 0 && i < editPoints.length)) return false;
    const n = editPoints.length;
    const closed = mode === "handles";
    if (!closed && i + 1 >= n) return false;       // in traccia l'ultimo lato non c'e' ancora
    const next = _cloneShape(editPoints);
    const had = _validArc(next[i].a);
    if (a == null) {
      if (!had) return false;
      delete next[i].a;
    } else {
      if (!_validArc(a)) return false;
      const B = next[(i + 1) % n];
      if (_arcPointsRaw(next[i], B, a)) next[i].a = [a[0], a[1]];
      else if (had) delete next[i].a;
      else return false;
    }
    return _applyShapeEdit(next);
  }

  // ── I gesti delle curve (cantiere «Il Mirino», Fette 4A e 4B) ──
  // Nessun rombo scelto, sotto il puntatore o in mano.
  function _knobReset() {
    selectedKnob = -1;
    hoverKnob = -1;
    knobGrab = -1;
    knobMoved = false;
  }
  // Il punto i: spigolo ↔ morbido, con l'avviso che dice cosa e' diventato.
  function _toggleSoft(i) {
    if (!(i >= 0 && i < editPoints.length)) return false;
    const on = editPoints[i].s !== true;
    if (!setVertexSoft(i, on)) return false;
    _toast(on
      ? _t("freehandClip.toast.soft", "⬡ Punto morbido: la linea ci passa in curva")
      : _t("freehandClip.toast.corner", "⬡ Punto spigolo: la linea ci fa l'angolo"));
    return true;
  }
  // Il lato i perde il suo arco (torna dritto, o morbido se un suo estremo
  // e' morbido: la regola per lato).
  function _straighten(i) {
    if (!(i >= 0 && i < editPoints.length) || !_validArc(editPoints[i].a)) return false;
    if (!setSideArc(i, null)) return false;
    _toast(_t("freehandClip.toast.arcRemoved", "⬡ Arco tolto: il lato torna com'era"));
    return true;
  }
  // Il tasto M (la strada senza doppio-click, per la penna): sulla maniglia
  // selezionata cambia spigolo ↔ morbido; sul rombo selezionato toglie
  // l'arco. Senza niente di selezionato vale quello che sta sotto il mirino.
  function _keyM() {
    if (pointerDown) return;
    if (selectedHandle >= 0 && selectedHandle < editPoints.length) { _toggleSoft(selectedHandle); return; }
    if (selectedKnob >= 0 && selectedKnob < _sideCount()) {
      if (!_straighten(selectedKnob)) {
        _toast(_t("freehandClip.toast.notArc",
          "⬡ Questo lato non è un arco: trascina il rombo (o usa le frecce) per piegarlo"));
      }
      return;
    }
    if (hoverHandle >= 0 && hoverHandle < editPoints.length) { _toggleSoft(hoverHandle); return; }
    if (hoverKnob >= 0 && hoverKnob < _sideCount() && _straighten(hoverKnob)) return;
    _toast(_t("freehandClip.toast.mHint",
      "⬡ M: seleziona prima un punto (morbido/spigolo) o il rombo di un arco (torna dritto)"));
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
    editPoints = _cloneShape(clipShape);
    selectedHandle = -1;
    hoverHandle = -1;
    _knobReset();
    _redraw(true);
    return true;
  }

  // ============================================================
  //  LE FRECCE (cantiere «Il Mirino», Fetta 1)
  // ============================================================
  // Passo in mm come per le tessere (keyboardShortcuts.js): Ctrl 0,01,
  // Shift 1, altrimenti 0,1. mm2px e' un const di renderer.js: si legge per
  // nome, con il ripiego dei 96 PPI come fa la lente.
  function _nudgeStepPx(evt) {
    let mm = 0.1;
    if (evt && (evt.ctrlKey || evt.metaKey)) mm = 0.01;
    else if (evt && evt.shiftKey) mm = 1;
    try {
      if (typeof window.mm2px === "function") return window.mm2px(mm);
      if (typeof mm2px === "function") return mm2px(mm);
    } catch (e) {}
    return mm * (96 / 25.4);
  }
  // Il commit in attesa (fase maniglie) si fa SUBITO: prima di qualunque
  // altro gesto, cosi' guida, taglio e Ctrl+Z di sessione restano in fila.
  function _flushNudge() {
    if (!nudgeTimer) return false;
    clearTimeout(nudgeTimer);
    nudgeTimer = null;
    if (mode === "handles" && _validPoly(editPoints)) {
      _commitShape(editPoints);
      editPoints = _cloneShape(clipShape);
      _redraw(true);
    }
    return true;
  }
  // Il commit in attesa si butta: la forma arriva da fuori (apertura,
  // annulla generale) o il perimetro si cancella.
  function _dropNudge() {
    if (nudgeTimer) { clearTimeout(nudgeTimer); nudgeTimer = null; }
  }
  // Sposta il punto selezionato. Ritorna true se la freccia e' stata
  // usata qui (e allora non deve spostare anche la vista).
  function nudgeSelected(direction, evt) {
    if (!mode) return false;
    // Fetta 4B: senza una maniglia selezionata le frecce muovono il rombo
    // selezionato (l'arco si aggiusta di fino).
    const onKnob = !(selectedHandle >= 0 && selectedHandle < editPoints.length) &&
      selectedKnob >= 0 && selectedKnob < _sideCount();
    if (!onKnob && (selectedHandle < 0 || selectedHandle >= editPoints.length)) return false;
    if (pointerDown) return true;    // durante un gesto: ferma, ma niente pan
    const step = _nudgeStepPx(evt);
    let dx = 0, dy = 0;
    if (direction === "left") dx = -step;
    else if (direction === "right") dx = step;
    else if (direction === "up") dy = -step;
    else if (direction === "down") dy = step;
    else return false;
    if (onKnob) {
      const q = _knobPos(selectedKnob);
      _setKnob(selectedKnob, { x: q.x + dx, y: q.y + dy });
    } else {
      const q = editPoints[selectedHandle];
      _moveVertex(selectedHandle, q.x + dx, q.y + dy);
    }
    if (mode === "handles") {
      // La guida si muove subito; il ri-taglio dei tratti (e il passo di
      // annulla) arriva dopo la pausa: una raffica = un passo solo.
      if (nudgeTimer) clearTimeout(nudgeTimer);
      nudgeTimer = setTimeout(() => {
        nudgeTimer = null;
        if (mode !== "handles" || !_validPoly(editPoints)) return;
        _commitShape(editPoints);
        editPoints = _cloneShape(clipShape);
        _redraw(true);
        _lensRefresh();
      }, CLIP_NUDGE_COMMIT_MS);
    }
    _redraw(true);
    _lensRefresh();
    return true;
  }
  // ⚠ Le frecce NON passano tutte da keydown: inputMapping.js chiama
  // window.handleArrowMovement direttamente per i tasti singoli mappati
  // come frecce (trappola 249). Si avvolge la funzione su window (porta
  // della Bottega §3.1): keyboardShortcuts.js non si tocca.
  function _wrapArrowMovement() {
    const orig = window.handleArrowMovement;
    if (typeof orig !== "function") return false;
    if (orig.__mirinoWrapped) return true;
    const wrapped = function (direction, evt) {
      if (nudgeSelected(direction, evt)) return;
      return orig.apply(this, arguments);
    };
    wrapped.__mirinoWrapped = true;
    wrapped.__mirinoOriginal = orig;
    window.handleArrowMovement = wrapped;
    return true;
  }

  // ============================================================
  //  EVENTI MOUSE (canvas)
  // ============================================================
  function onMouseDown(opt) {
    if (!mode) return;              // fuori modalita': non tocchiamo nulla
    const e = opt && opt.e;
    if (e && typeof e.button === "number" && e.button !== 0) return; // solo sinistro
    _flushNudge();                  // frecce in attesa: prima si chiudono loro

    // Il punto della pressione e' il MIRINO, non la mano: con la frizione
    // (Fetta 2-bis) i due sono scostati, e si preme dove si vede il pallino.
    const p = _aimAt(e);
    const h = _pointer(e);
    // Una maniglia sotto il puntatore vince su tutto: si aggancia e si sposta,
    // in entrambe le fasi. E' il cuore della Fetta 1. Se non c'e', un rombo
    // (Fetta 4B). Si guarda PRIMA di segnare il pulsante premuto: il rombo
    // del lato sotto il mirino si vede solo a pulsante alzato.
    const hitH = _hitHandle(p);
    const hitK = hitH < 0 ? _hitKnob(p) : -1;
    pointerDown = true;
    dragStarted = false;
    grabMoved = false;
    knobMoved = false;
    downShift = !!(e && e.shiftKey);
    downLogical = { x: p.x, y: p.y };
    downHand = { x: h.x, y: h.y };
    downScreen = e ? { x: e.clientX, y: e.clientY } : { x: p.x, y: p.y };
    hoverPoint = { x: p.x, y: p.y };
    grabIndex = hitH;
    hoverHandle = grabIndex;
    knobGrab = hitK;
    hoverKnob = knobGrab;
    // La vite micrometrica (Fetta 2): con la lente a schermo, da qui al
    // rilascio la mano e' demoltiplicata. Il punto di partenza e' quello
    // della pressione, quindi un tap fermo resta dove si e' premuto (P2).
    _beginAim();
    _redraw(true);
  }

  function onMouseMove(opt) {
    const e = opt && opt.e;
    const tool = _activeFreehandTool();

    // --- MODALITA' PERIMETRO ---
    if (mode) {
      const c = _canvas();
      // Il punto di mira: il puntatore, oppure (tenendo premuto con la
      // lente) il puntatore demoltiplicato. Maniglie, elastico e lente
      // seguono LUI, non la mano.
      const p = _aimAt(e);
      hoverPoint = { x: p.x, y: p.y };

      if (pointerDown) {
        if (grabIndex >= 0) {
          // Sto (forse) spostando una maniglia: la muovo solo dopo la soglia,
          // così un tap fermo resta un tap (chiusura / selezione).
          if (!grabMoved && _movedPastThreshold(e)) grabMoved = true;
          if (grabMoved && editPoints[grabIndex]) {
            _moveVertex(grabIndex, p.x, p.y);
            selectedHandle = grabIndex;
            selectedKnob = -1;
          }
        } else if (knobGrab >= 0) {
          // Sto (forse) tirando un rombo (Fetta 4B): il lato diventa l'arco
          // che passa dal mirino. Anche qui solo dopo la soglia della mano.
          if (!knobMoved && _movedPastThreshold(e)) knobMoved = true;
          if (knobMoved && knobGrab < _sideCount()) {
            _setKnob(knobGrab, p);
            selectedKnob = knobGrab;
            selectedHandle = -1;
          }
        } else if (mode === "draw" && !aiming) {
          // Mano libera: solo a lente spenta. Con la lente premere e
          // trascinare a vuoto e' mira fine (B2): il punto nasce al rilascio.
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
        // Hover: evidenzia la maniglia (o il rombo) agganciabile e cambia cursore.
        hoverHandle = _hitHandle(p);
        hoverKnob = hoverHandle < 0 ? _hitKnob(p) : -1;
        _setCursor(c, hoverHandle >= 0 || hoverKnob >= 0 ? "move" : "crosshair");
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
    // Il punto del rilascio e' quello del MIRINO (Fetta 2): lo si legge
    // prima di chiudere la mira.
    const p = _aimAt(e);
    const fine = aiming;
    const n = aimN;
    _endAim();
    // La frizione (Fetta 2-bis): il mirino resta dov'e', la mano e' N volte
    // piu' in la'. Da qui il mirino segue la mano, scostato: niente salto.
    // E riparte lento, da 1/N (Fetta 2-ter): niente scatto al primo colpo.
    if (fine) _clutchSet(p, _pointer(e), n);

    if (!pointerDown) {
      dragStarted = false;
      grabIndex = -1;
      grabMoved = false;
      knobGrab = -1;
      knobMoved = false;
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
        if (editPoints[idx]) _moveVertex(idx, p.x, p.y);
        selectedHandle = idx;
        selectedKnob = -1;
        // Il ritaglio si aggiorna al RILASCIO, non ad ogni pixel del
        // trascinamento: durante il gesto si muove solo la guida.
        if (mode === "handles") {
          _commitShape(editPoints);
          editPoints = _cloneShape(clipShape);
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
      selectedKnob = -1;
      _redraw(true);
      return;
    }

    // (a') Avevo agganciato un rombo (Fetta 4B): tirato = l'arco nuovo (in
    // fase maniglie un passo di Ctrl+Z, e il taglio dei tratti segue al
    // RILASCIO, come per le maniglie); fermo = lo seleziono (M, CANC, frecce).
    if (knobGrab >= 0) {
      const ki = knobGrab;
      const kMoved = knobMoved;
      knobGrab = -1;
      knobMoved = false;
      if (ki < _sideCount()) {
        if (kMoved) {
          _setKnob(ki, p);
          if (mode === "handles") {
            _commitShape(editPoints);
            editPoints = _cloneShape(clipShape);
          }
        }
        selectedKnob = ki;
        selectedHandle = -1;
      }
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
      // Il punto e' quello della PRESSIONE, non del rilascio (trappola 247).
      // Con la mira fine e' quello del MIRINO al rilascio: si e' premuto
      // proprio per portarlo li', e il tremolio del click e' gia' diviso
      // per N.
      const q = fine ? p : (downLogical || p);
      // Il doppio-click arriva prima come DUE tap: il secondo, vicino nel
      // tempo e nello spazio al primo, non e' un punto nuovo ma meta' del
      // doppio-click (che poi chiude). Senza la lente lo fermava gia' la
      // presa della maniglia; con la lente la presa e' piccola come il
      // vetro vuole, e il secondo tap passerebbe (trappola 253).
      const now = Date.now();
      const scr = downScreen || { x: q.x, y: q.y };
      if (lastTap && now - lastTap.t <= CLIP_DBL_TAP_MS &&
          _dist2(lastTap.x, lastTap.y, scr.x, scr.y) <= CLIP_HANDLE_GRAB_PX * CLIP_HANDLE_GRAB_PX) {
        lastTap = null;
        _redraw(true);
        return;
      }
      lastTap = { t: now, x: scr.x, y: scr.y };
      // Chiusura per vicinanza al 1° vertice: raggio piu' generoso di quello
      // di presa della maniglia, quindi resta utile anche se la maniglia non
      // e' stata agganciata. ⚠ Solo SENZA lente: con la lente si mira a
      // spigoli vicini fra loro, e uno spigolo accanto al 1° vertice
      // chiudeva il perimetro invece di aggiungere il punto (P3).
      if (editPoints.length >= CLIP_MIN_VERTICES && _lensMag() === 1) {
        const k = _screenK();
        const snapLogical = CLIP_CLOSE_SNAP_PX * k;
        if (_dist2(editPoints[0].x, editPoints[0].y, q.x, q.y) <= snapLogical * snapLogical) {
          closeRing();
          return;
        }
      }
      // Shift+tap = il punto nasce gia' morbido (Fetta 4A). Shift si guarda
      // alla pressione e al rilascio: con la penna si tiene il tasto e si
      // tocca, e l'ordine non deve contare.
      const v = { x: q.x, y: q.y };
      if (downShift || (e && e.shiftKey)) v.s = true;
      editPoints.push(v);
      selectedHandle = editPoints.length - 1;
      selectedKnob = -1;
      _redraw(true);
      return;
    }

    // Fase maniglie: tap a vuoto = deseleziona.
    selectedHandle = -1;
    selectedKnob = -1;
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
    // Fette 4A e 4B: doppio-click SU una maniglia = spigolo ↔ morbido; sul
    // rombo di un arco = l'arco si toglie; altrove sul lato = punto nuovo,
    // come sempre. (In fase traccia il doppio-click chiude: li' il punto
    // morbido si fa con M o con Shift+tap.)
    const h = _hitHandle(p);
    if (h >= 0) {
      selectedHandle = h;
      selectedKnob = -1;
      _toggleSoft(h);
      return;
    }
    const kn = _hitKnob(p);
    if (kn >= 0 && _validArc(editPoints[kn].a)) {
      selectedKnob = kn;
      _straighten(kn);
      return;
    }
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
    // Il punto e' quello del mirino (Fetta 2-bis: con la frizione la mano
    // sta altrove).
    _handleDoubleClick(_aimAt(e));
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
    _handleDoubleClick(_aimAt(opt && opt.e));
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
    // Ogni tasto che non e' una freccia (ne' un modificatore) chiude prima
    // la raffica di frecce in attesa: Ctrl+Z, CANC, Invio la trovano fatta.
    const k0 = e.key || "";
    if (k0.indexOf("Arrow") !== 0 && k0 !== "Shift" && k0 !== "Control" &&
        k0 !== "Meta" && k0 !== "Alt") {
      _flushNudge();
    }

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
      // In fase maniglie CANC e' della maniglia, non della tessera. Con un
      // rombo selezionato toglie il suo arco (Fetta 4B).
      if (mode === "handles") {
        _stop(e);
        _deleteSelected();
      }
      return;
    }
    if (e.key === "Backspace" && !typing) {
      _stop(e);
      if (mode === "draw") {
        if (editPoints.length) editPoints.pop();
        const tail = editPoints[editPoints.length - 1];
        if (tail && tail.a) delete tail.a;           // il suo lato non c'e' piu' (Fetta 3)
        if (selectedHandle >= editPoints.length) selectedHandle = editPoints.length - 1;
        if (selectedKnob >= _sideCount()) selectedKnob = -1;
        _redraw(true);
      } else {
        _deleteSelected();
      }
      return;
    }
    // M = spigolo ↔ morbido sulla maniglia, via l'arco sul rombo (Fette 4A e
    // 4B). La lettera fisica (e.code), come la L della lente: uguale su
    // tastiera italiana e inglese. Senza Ctrl/Alt: Ctrl+M resta libero.
    const isM = e.code === "KeyM" || (!e.code && (e.key === "m" || e.key === "M"));
    if (isM && !typing && !e.ctrlKey && !e.metaKey && !e.altKey) {
      _stop(e);
      _keyM();
      return;
    }
  }
  // CANC (e Backspace) in fase maniglie: via la maniglia selezionata, oppure
  // l'arco del rombo selezionato.
  function _deleteSelected() {
    if (selectedHandle >= 0 && selectedHandle < editPoints.length) return removeSelectedHandle();
    if (selectedKnob >= 0 && selectedKnob < _sideCount()) return _straighten(selectedKnob);
    return removeSelectedHandle();
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
      // Fetta 2: se la finestra perde il fuoco mentre si tiene premuto
      // (Alt+Tab, un avviso di Windows), il rilascio puo' non arrivare mai.
      // Senza questa riga il cursore resterebbe nascosto su tutta Mosaica
      // fino al prossimo click (trappola 255).
      window.addEventListener("blur", () => { if (aiming) _endAim(); });

      // ── P5: quando il mouse ESCE dall'area del canvas, il cerchio dimensione
      //    tratto deve sparire (altrimenti resta "appeso" all'ultima posizione).
      //    mouseleave (non bubbla, scatta solo all'uscita reale) e' il segnale
      //    affidabile: niente piu' mouse:move che ridipinga il cerchio.
      const upper = c.upperCanvasEl;
      if (upper && !upper.__ftLeaveBound) {
        upper.__ftLeaveBound = true;
        upper.addEventListener("mouseleave", () => {
          // La frizione si stacca quando la mano esce dal foglio (Fetta
          // 2-bis): fuori il cursore di Windows si vede, e al rientro il
          // mirino deve stargli sotto. Non a pulsante premuto: li' comanda
          // la vite.
          if (!pointerDown) _clutchOff();
          if (_activeFreehandTool() || mode) {
            hoverPoint = null;
            hoverHandle = -1;
            hoverKnob = -1;
            _redraw(true); // ridisegna senza cerchio; il perimetro resta
          }
        });
      }

      _bound = true;
    }

    // Le frecce sul punto selezionato (Fetta 1 del Mirino). Anche al
    // caricamento del file, qui sotto: questo e' il secondo giro di chiave.
    _wrapArrowMovement();

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
      // Di solito e' il poligono che abbiamo messo noi (setFreehandClipPolygon
      // all'apertura del progetto): la sua forma c'e' gia'. Se fosse un altro,
      // lo si legge come dal file (Fetta 3).
      if (!_samePoly(window.freehandClipPolygon, clipPolygon) || !_validPoly(clipShape)) {
        clipPolygon = window.freehandClipPolygon.map((p) => ({ x: +p.x, y: +p.y }));
        clipShape = _shapeFromSaved(window.freehandClipPolygon, clipPolygon);
      }
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
  // keyboardShortcuts.js e' caricato PRIMA di questo file (index.html):
  // handleArrowMovement c'e' gia'. Se non ci fosse, ci riprova l'init.
  _wrapArrowMovement();
  // Stato in sola lettura della modalita' (serve alla lente della Fetta 2 e
  // all'harness: niente scrittura, niente scorciatoie).
  window.getFreehandClipState = () => ({
    mode: mode,
    points: editPoints.map((p) => ({ x: p.x, y: p.y })),
    selected: selectedHandle,
    hover: hoverHandle,
    changed: sessionChanged,
    undoDepth: shapeUndo.length,
    // Fetta 2 del Mirino: la mira fine in corso, il suo riduttore, la
    // maniglia agganciata (la lente non tira l'elastico mentre la si porta).
    aiming: aiming,
    aimN: aimN,
    grab: grabIndex,
    // Fetta 2-bis: lo scostamento della frizione (mirino - mano, punti
    // logici), o null se il mirino e' sotto la mano.
    clutch: clutch ? { x: clutch.x, y: clutch.y } : null,
    // Fetta 3: la forma della sessione col tipo dei vertici (s = morbido,
    // a = arco del lato che parte da li'), e la linea spianata che si vede
    // (chiusa in fase maniglie, aperta in fase traccia). La lente la usera'
    // dalla Fetta 4A.
    shape: _cloneShape(editPoints),
    path: _flatten(editPoints, mode === "handles"),
    // Fetta 2-ter: px di schermo della mano che mancano alla velocita'
    // piena (0 = frizione attaccata, o staccata).
    slip: slipLeft,
    // Fette 4A e 4B: i rombi che si vedono adesso (side = indice del lato,
    // x/y = dove sta il rombo, arc = il lato e' un arco), il rombo
    // selezionato, quello sotto il puntatore e quello tirato (-1 = nessuno).
    // La lente li disegna uguali.
    knobs: mode ? _knobSides(hoverPoint).map((i) => {
      const q = _knobPos(i);
      return { side: i, x: q.x, y: q.y, arc: _validArc(editPoints[i].a) };
    }) : [],
    knobSel: selectedKnob,
    knobHover: hoverKnob,
    knobGrab: knobGrab
  });
  // Il punto di mira per un evento del mouse (Fetta 2 del Mirino): il
  // puntatore, oppure il puntatore demoltiplicato mentre si tiene premuto con
  // la lente, oppure (Fetta 2-bis) il puntatore piu' lo scostamento della
  // frizione dopo il rilascio. La lente ci mette il centro del reticolo: e' la stessa funzione
  // che decide dove va il punto, quindi i due non possono divergere, in
  // qualunque ordine Fabric chiami i loro ascoltatori.
  // Il motore delle curve (Fetta 3): le due operazioni sulla forma della
  // sessione, e lo spianamento in sola lettura (una copia: la forma passata
  // non si tocca).
  window.freehandClipCurves = {
    setVertexSoft: setVertexSoft,
    setSideArc: setSideArc,
    flatten: (sh, closed) => (Array.isArray(sh) ? _flatten(_cloneShape(sh), !!closed) : []),
    tolerancePx: CLIP_CURVE_TOL_PX
  };
  window.freehandClipAimAt = (e) => {
    try { return _aimAt(e); } catch (err) { return null; }
  };
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