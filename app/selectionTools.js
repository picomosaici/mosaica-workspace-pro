// ============================================================
//  selectionTools.js — Mosaica Workspace Pro
//  I COMANDI DELLA SELEZIONE
// ------------------------------------------------------------
//  COS'È E PERCHÉ STA FUORI DA renderer.js
//  ---------------------------------------
//  Questo modulo aggiunge comandi che agiscono sulla SELEZIONE —
//  quello che hai preso adesso sul foglio — senza scrivere una
//  sola riga dentro renderer.js.
//
//  Non è una scelta di stile: è un patto. Quando è nato, i file
//  del canvas (renderer.js, mouseObserver.js, keyboardShortcuts.js,
//  svgExport.js) dovevano restare immutati byte per byte, e questo
//  modulo è nato apposta per stare da questa parte del muro.
//
//  COME CI RIESCE — le due porte già aperte
//  ----------------------------------------
//  renderer.js è caricato come <script src="..."> CLASSICO, non
//  come modulo. Da qui discendono due cose:
//
//   1. Le sue `function` di primo livello finiscono su `window` —
//      e non ci finiscono come copia: il nome globale È quella
//      proprietà. Riscrivendo `window.updateHandlesSpacing` si
//      intercettano ANCHE le dodici chiamate che renderer.js fa
//      per nome, senza toccarne nessuna.
//
//   2. Anche i suoi `let` e `const` di primo livello sono
//      raggiungibili PER NOME da ogni script caricato dopo. Non
//      finiscono su window — stanno nell'ambiente lessicale
//      globale — ma si vedono lo stesso. Mosaica lo fa già in due
//      punti: customShapeBuilder.js legge `view`, svgExport.js
//      legge `canvas`.
//
//  ⚠ È il punto 2 che rende possibile l'«inquadra la selezione»:
//  zoom e pan vivono dentro `view`, che è un `let`. Senza il punto
//  2 avrebbe richiesto una funzione nuova dentro renderer.js.
//
//  ⚠ LA REGOLA D'USO, OBBLIGATORIA. Ogni nome preso in prestito va
//  protetto con `typeof X !== "undefined"`. Senza quella guardia,
//  un nome mancante darebbe un ReferenceError — che ferma tutto —
//  invece di un semplice `undefined` che si può gestire. È il
//  motivo per cui qui sotto non c'è un solo accesso nudo.
//
//  I PRESTITI, TUTTI IN UN POSTO SOLO
//  ----------------------------------
//  Sono elencati nel blocco PRESTITI qui sotto, e sono elencati là
//  perché l'harness possa leggerli e andare a verificare SUL
//  SORGENTE VERO di renderer.js che esistano davvero e che siano
//  della specie giusta. Senza quel controllo, un test in jsdom
//  proverebbe questo modulo contro un sostituto e direbbe verde
//  anche se il vero renderer.js avesse cambiato una firma.
//
//  I RIVESTIMENTI SONO MEDICAZIONI, NON GUARIGIONI
//  -----------------------------------------------
//  ⚠ Va scritto qui perché fra sei mesi nessuno se lo ricorderà.
//  Le due correzioni della Fetta 2 — il tetto al margine delle
//  maniglie e il lato del dock — curano due difetti che stanno
//  DENTRO renderer.js. Le curiamo da fuori perché renderer.js non
//  si può toccare, non perché sia il posto giusto. Il giorno in cui
//  i file del canvas
//  torneranno toccabili, quelle due correzioni vanno riportate a
//  casa loro — dentro updateHandlesSpacing() e dentro
//  positionRadialDockVertical() — e questi rivestimenti tolti.
//
//  DOVE STANNO I PULSANTI
//  ----------------------
//  In index.html, insieme agli altri. È il modo in cui il progetto
//  lo fa da sempre, e regala gratis l'aggancio dell'i18n.
//
//  ⚠ IL MENU RADIALE È UNO SOLO. Il radiale e la colonna che
//  compare in multi-selezione sono lo STESSO <div id="radialMenu">:
//  cambiano solo quali pulsanti sono visibili e come vengono
//  disposti. Un pulsante aggiunto una volta sola, senza `display`
//  inline, compare da solo in tutti e due i posti, perché
//  updateRadialForMultiSelection() di renderer.js si occupa solo di
//  group/ungroup/lock.
//
//  ⚠ L'ORDINE DI CARICAMENTO CONTA. Questo file va ULTIMO nella
//  lista di index.html: i suoi rivestimenti avvolgono funzioni di
//  renderer.js che devono esistere già.
//
//  LO SPECCHIO — PERCHÉ NON È UN `flipX` E BASTA
//  ---------------------------------------------
//  ⚠ PRIMA DI TUTTO, I NOMI. In questo modulo — e nel cantiere, dalla
//  revisione 4 — uno specchio prende il nome DALL'ASSE, non dal
//  movimento. È la convenzione di Mirko, ed è quella che le icone
//  mostrano: la linea che divide il quadratino È l'asse dello
//  specchio.
//
//   ◨  asse VERTICALE    → sinistra ↔ destra → azione mirrorLeftRight
//   ⬓  asse ORIZZONTALE  → alto ↔ basso     → azione mirrorTopBottom
//
//  I nomi delle azioni dicono il MOVIMENTO proprio perché il nome
//  dell'asse si può leggere in due modi: «specchio orizzontale» può
//  voler dire «asse orizzontale» oppure «si muove in orizzontale», e
//  sono l'opposto. `mirrorLeftRight` non si può fraintendere né oggi
//  né fra sei mesi (trappola 91).
//
//  Su un trapezio, misurato sul modello vero:
//   · asse verticale   → il lato inclinato passa dall'altro lato, le
//     due basi restano dov'erano (base sup. 60 / inf. 100, offset
//     +20 → −20);
//   · asse orizzontale → le due basi si scambiano e il lato inclinato
//     resta dal suo lato (60/100 → 100/60).
//
//  PERCHÉ NON UNA SCALA NEGATIVA
//  -----------------------------
//  Mirko ha chiesto lo specchio con sei parole che SONO la specifica:
//  «senza che le tessere cambino di dimensione». Dicono da dove viene
//  la richiesta: il modo che Fabric offre di suo per specchiare è
//  tirare una maniglia oltre il lato opposto, e si ottiene lo
//  specchio ma quasi sempre anche un ridimensionamento, perché la
//  mano non si ferma esattamente alla misura giusta. In un mosaico
//  quel prezzo è alto: una tessera che cambia di mezzo millimetro non
//  entra più nel posto per cui era tagliata.
//
//  Quindi lo specchio qui è una RIFLESSIONE PURA. In pratica:
//
//   · si commuta `flipX` (o `flipY`), si rovescia `angle` e si
//     riflette il CENTRO. Nessun numero di dimensione viene scritto —
//     né scaleX, né scaleY, né width, né height, né skew. Non è una
//     tolleranza da verificare: è un'ASSENZA DI CODICE, ed è
//     letteralmente questo che soddisfa la richiesta.
//
//  ⚠ E L'ANGOLO SI ROVESCIA IN TUTTI E DUE GLI SPECCHI. Non è
//  intuitivo — verrebbe da pensare che uno dei due non tocchi la
//  rotazione — ma è quello che dicono i conti (Fx·R(θ) = R(−θ)·Fx, e
//  lo stesso per Fy): è la differenza fra uno specchio e una forma
//  girata a caso. Si vede solo quando almeno una tessera è ruotata,
//  che è il motivo per cui va provato proprio là.
//
//  ⚠ I TRATTI A MANO LIBERA E AD ACQUERELLO NON SI SPECCHIANO MAI,
//  nemmeno se sono dentro la selezione — e non è una dimenticanza, è
//  la decisione del 10 settembre. L'acquerello in Mosaica è il
//  disegno SOTTO, la guida su cui le tessere si posano: con le mani
//  si gira la tessera, non il foglio. E siccome un tratto è un
//  oggetto selezionabile come una tessera, un Ctrl+A distratto lo
//  porterebbe dentro la selezione senza che nessuno l'abbia chiesto.
//  Quelli trovati si contano e si dicono con un avviso, invece di
//  essere rovesciati in silenzio.
//  ⚠ Il guadagno secondario è grosso e va scritto: se un tratto non
//  si specchia mai, il suo taglio permanente (`__clipPoly`, che è una
//  maschera FISSA sul foglio e non segue l'oggetto) non va mai
//  riflesso. Spariscono un ramo, un prestito e un intero caso limite.
//
//  FETTE FATTE
//  -----------
//   1 · l'aggancio e il "deseleziona tutto"
//   2 · la vista: tetto al margine delle maniglie, dock al bordo
//       destro dell'INTERA selezione, "inquadra la selezione"
//   3 · lo specchio sui due assi, con una voce sola di
//       storia e i tratti a mano libera lasciati fuori
// ============================================================

(function () {
  "use strict";

  // ───────────────────────────────────────────────────────────
  //  I PRESTITI — i nomi che questo modulo prende da renderer.js
  // ───────────────────────────────────────────────────────────
  // ⚠ Blocco unico e dichiarativo di proposito: è il contratto che
  // l'harness verifica sul sorgente vero di renderer.js. Se un nome
  // sparisce o cambia specie di là, il livello "contratto" diventa
  // rosso PRIMA che qualcuno se ne accorga usando l'app.
  var PRESTITI = {
    // `function` di primo livello in renderer.js → finiscono su window
    funzioni: [
      "updateHandlesSpacing",          // rivestita: tetto al margine
      "positionRadialDockVertical",    // rivestita: lato del dock
      "getRadialFreeArea",             // letta: l'area libera per l'inquadratura
      "applyTransform",                // chiamata: applica view al #paper
      "refreshCanvasQualityForZoom",   // chiamata: allinea il backstore alla scala
      "_updateActiveHandlesForZoom",   // chiamata: ricalcola le maniglie
      "positionRadial",                // chiamata: rimette il menu al suo posto
      "flashToast",                    // chiamata: avvisi all'utente
      "__t",                           // chiamata: traduzione con ripiego
      // ── Fetta 3 ──────────────────────────────────────────────────
      "isWatercolorOrFreehand",        // chiesta: chi NON va specchiato
      "bakeTrapezoidScaleIntoPoints",  // chiamata: cuoce il flip nei punti
      "bakeTriangleScaleIntoPoints",   // chiamata: cuoce il flip nei punti
      "populateTrapezoidControlsFromObject", // chiamata: ispettore ai mm nuovi
      "toggleAngleControls",           // chiamata: cursori α/β del triangolo
      "pushState"                      // chiamata: UNA voce di storia per gesto
    ],
    // `function` esposte su window da ALTRI file, oppure oggetti-namespace.
    // Stanno in un elenco a parte perché il livello "contratto" le deve
    // cercare nel file giusto: cercarle in renderer.js le farebbe
    // sembrare scomparse quando invece stanno benissimo altrove
    // (è l'errore che il §3.2 del cantiere aveva fatto una volta).
    esterne: [],
    // `let`/`const` di primo livello → raggiungibili per nome lessicale
    lessicali: [
      "canvas", "view", "paper",
      "MIN_ZOOM", "MAX_ZOOM",
      "DOCK_GAP_FROM_SHAPE", "DOCK_SCREEN_MARGIN"
    ]
  };

  // Le nostre azioni sul radiale. L'ascoltatore in capture intercetta
  // SOLO queste e si ferma lì: il dispatch di renderer.js non le vede.
  //
  // ⚠ I NOMI DICONO IL MOVIMENTO, NON L'ASSE, e di proposito:
  // «mirrorH» si può leggere «asse orizzontale» oppure «si muove in
  // orizzontale», che sono l'opposto. Questi due non si possono
  // leggere in due modi (trappola 91).
  //   mirrorLeftRight → asse VERTICALE   (icona ◨)
  //   mirrorTopBottom → asse ORIZZONTALE (icona ⬓)
  var OUR_ACTIONS = ["deselectAll", "mirrorLeftRight", "mirrorTopBottom"];

  // ───────────────────────────────────────────────────────────
  //  NUMERI
  // ───────────────────────────────────────────────────────────
  // ⚠ TETTO_MARGINE_SCHERMO è l'unico numero da girare se al
  // collaudo il margine delle maniglie non convince. Quaranta pixel
  // di schermo:
  //  · morde quando ingombro × 0,14 > 40, cioè oltre ≈ 286 px ≈ 76 mm;
  //  · sotto quella misura NON CAMBIA NIENTE — una tessera da 10 mm
  //    resta ai suoi 14 px, una da 50 mm ai suoi 26. Il regime in cui
  //    la proporzione è giusta resta intatto;
  //  · su una selezione grande quanto un A4 pieno porta il margine da
  //    157 a 40 px per lato, cioè restituisce ~234 px di altezza.
  var TETTO_MARGINE_SCHERMO = 40;

  // Aria fra le maniglie e il bordo dell'area libera dopo
  // l'inquadratura. Stesso valore di DOCK_SCREEN_MARGIN e
  // RADIAL_SCREEN_MARGIN di renderer.js: è il margine di casa.
  var ARIA_INQUADRATURA = 12;

  // Valori di riserva, usati SOLO se le costanti di renderer.js non
  // fossero raggiungibili. Devono restare uguali a quelle vere: se un
  // domani cambiassero di là e non qui, in un ambiente degradato il
  // dock si staccherebbe di una misura diversa. L'harness li confronta
  // con i valori veri letti dal sorgente.
  var RISERVA_DOCK_GAP_FROM_SHAPE = 22;
  var RISERVA_DOCK_SCREEN_MARGIN = 12;
  var RISERVA_MIN_ZOOM = 0.4;
  var RISERVA_MAX_ZOOM = 8;

  // ───────────────────────────────────────────────────────────
  //  ACCESSI PROTETTI
  // ───────────────────────────────────────────────────────────
  // Prima window (renderer.js espone `canvas` esplicitamente in coda),
  // poi il nome lessicale come fa svgExport.js. Mai un accesso nudo.
  function _cv() {
    try {
      if (typeof window !== "undefined" && window.canvas) return window.canvas;
    } catch (e) { /* ambienti senza window */ }
    try {
      if (typeof canvas !== "undefined" && canvas) return canvas;
    } catch (e) { /* nome non ancora definito */ }
    return null;
  }

  // ⚠ `view` NON è su window: è un `let` di primo livello, quindi si
  // raggiunge solo per nome lessicale. È la porta dello zoom e del pan.
  function _view() {
    try {
      if (typeof view !== "undefined" && view) return view;
    } catch (e) { /* renderer.js non ancora caricato */ }
    return null;
  }

  function _scala() {
    var v = _view();
    var s = v && v.scale;
    return (typeof s === "number" && isFinite(s) && s > 0) ? s : 1;
  }

  function _paper() {
    try {
      if (typeof paper !== "undefined" && paper) return paper;
    } catch (e) { /* non ancora definito */ }
    if (typeof document !== "undefined") return document.getElementById("paper");
    return null;
  }

  // Costante lessicale con riserva. Ogni lettura sta dentro il proprio
  // `typeof`, perché è l'unico modo di interrogare un nome che
  // potrebbe non esistere senza far esplodere tutto.
  function _cost(nome, riserva) {
    var v;
    try {
      if (nome === "DOCK_GAP_FROM_SHAPE") { if (typeof DOCK_GAP_FROM_SHAPE !== "undefined") v = DOCK_GAP_FROM_SHAPE; }
      else if (nome === "DOCK_SCREEN_MARGIN") { if (typeof DOCK_SCREEN_MARGIN !== "undefined") v = DOCK_SCREEN_MARGIN; }
      else if (nome === "MIN_ZOOM") { if (typeof MIN_ZOOM !== "undefined") v = MIN_ZOOM; }
      else if (nome === "MAX_ZOOM") { if (typeof MAX_ZOOM !== "undefined") v = MAX_ZOOM; }
    } catch (e) { /* non raggiungibile: si usa la riserva */ }
    return (typeof v === "number" && isFinite(v)) ? v : riserva;
  }

  function _radialEl() {
    if (typeof document === "undefined") return null;
    return document.getElementById("radialMenu");
  }

  function _fn(nome) {
    try {
      if (typeof window !== "undefined" && typeof window[nome] === "function") return window[nome];
    } catch (e) { /* niente window */ }
    return null;
  }

  // Un punto per Fabric. `setPositionByOrigin` si accontenta di un
  // oggetto con x e y, ma se fabric.Point c'è si usa quello: è la
  // moneta di casa e attraversa senza sorprese le tre versioni.
  function _pt(x, y) {
    try {
      if (typeof window !== "undefined" && window.fabric && window.fabric.Point) {
        return new window.fabric.Point(x, y);
      }
    } catch (e) { /* si ripiega sull'oggetto nudo */ }
    return { x: x, y: y };
  }

  function _rad(gradi) {
    return (Number(gradi) || 0) * Math.PI / 180;
  }

  // Traduzione con ripiego: se __t non c'è, si mostra l'italiano.
  //
  // ⚠ IL TERZO ARGOMENTO È I PARAMETRI, e l'ordine è INVERTITO
  // rispetto a __t di renderer.js — che vuole (chiave, params,
  // fallback) — perché qui il ripiego è obbligatorio e i parametri
  // sono l'eccezione. Chi legge questa riga in fretta scambia i due:
  // guardare la chiamata a `f(...)` qui sotto, non la firma.
  function _t(chiave, ripiego, param) {
    var f = _fn("__t");
    if (f) { try { return f(chiave, param || null, ripiego); } catch (e) { /* ripiego */ } }
    // Senza motore i18n si interpola a mano, esattamente come fa __t
    // nel suo ramo di ripiego: se qui non si interpolasse, l'utente
    // leggerebbe «{count} tratti» invece di «3 tratti».
    var s = ripiego;
    if (param && s != null) {
      s = String(s).replace(/\{(\w+)\}/g, function (m, k) {
        return Object.prototype.hasOwnProperty.call(param, k) ? String(param[k]) : m;
      });
    }
    return s;
  }

  function _toast(chiave, ripiego, param) {
    var f = _fn("flashToast");
    if (f) { try { f(_t(chiave, ripiego, param)); } catch (e) { /* silenzio */ } }
  }

  // ───────────────────────────────────────────────────────────
  //  FETTA 1 · DESELEZIONA TUTTO
  // ───────────────────────────────────────────────────────────
  // Fa due cose e basta. Il resto — nascondere il menu radiale,
  // spegnere gli indicatori L/A, azzerare l'ispettore — lo fa già
  // il gestore di `selection:cleared` in renderer.js, che è lo
  // stesso identico percorso di un clic sul vuoto.
  //
  // ⚠ NON SPINGE STORIA DA SÉ, e non deve. Deselezionare non cambia
  // la geometria del mosaico. Ma attenzione: deselezionare NON è
  // gratis, e va bene così. `discardActiveObject()` fa scattare
  // `selection:cleared`, che cuoce dentro i punti la scala e il flip
  // residui di trapezi e triangoli e registra UNA voce di storia.
  // È il comportamento di sempre e questo pulsante non lo sopprime:
  // sopprimerlo lascerebbe le forme con una scala residua e
  // l'ispettore con numeri incoerenti.
  function deselectAll() {
    var cv = _cv();
    if (!cv || typeof cv.discardActiveObject !== "function") return false;
    if (typeof cv.getActiveObject === "function" && !cv.getActiveObject()) return false;

    cv.discardActiveObject();
    if (typeof cv.requestRenderAll === "function") cv.requestRenderAll();
    return true;
  }

  // ───────────────────────────────────────────────────────────
  //  FETTA 2a · IL TETTO AL MARGINE DELLE MANIGLIE
  // ───────────────────────────────────────────────────────────
  // Il difetto, in una riga: in renderer.js il margine delle maniglie
  // è UNA FRAZIONE DELL'INGOMBRO (`maxDim × 0,14`). Su una tessera da
  // 10 mm è la cosa giusta — stacca le maniglie senza staccarle
  // troppo. Su una selezione grande quanto un A4 diventa 157 px per
  // lato, e le maniglie finiscono fuori dallo schermo.
  //
  // ⚠ E c'è il secondo colpo: il valore viene diviso per view.scale e
  // Fabric lo rimoltiplica disegnando, quindi SULLO SCHERMO quei 157
  // px restano 157 px a qualunque zoom. Zoomare fuori non li recupera
  // mai. Era il difetto che si vedeva.
  //
  // ⚠ SI LIMITA IL RISULTATO, NON SI RISCRIVE LA FORMULA. Chiamiamo
  // l'originale e poi tagliamo quello che ha scritto. Se un domani la
  // formula di là cambiasse, il tetto continuerebbe a fare il suo
  // mestiere; se invece l'avessimo ricopiata, divergerebbe in silenzio.
  //
  // Si applica SEMPRE, non solo alle multi-selezioni: una forma sola
  // grande come il foglio ha lo stesso problema, e sarebbe assurdo
  // curarne una e non l'altra.
  function limitaMargineManiglie(obj) {
    if (!obj || typeof obj.padding !== "number" || !isFinite(obj.padding)) return false;
    var scala = _scala();
    var padSchermo = obj.padding * scala;
    if (!(padSchermo > TETTO_MARGINE_SCHERMO)) return false;

    // Il minimo a 1 evita un padding zero a zoom altissimo: le maniglie
    // si appiccicherebbero alla forma e non si distinguerebbero più dal
    // suo bordo.
    obj.padding = Math.max(1, Math.round(TETTO_MARGINE_SCHERMO / scala));
    if (typeof obj.setCoords === "function") obj.setCoords();
    return true;
  }

  // ───────────────────────────────────────────────────────────
  //  FETTA 2b · IL DOCK AL BORDO DESTRO DELL'INTERA SELEZIONE
  // ───────────────────────────────────────────────────────────
  // Il difetto: renderer.js àncora la colonna dei pulsanti
  // all'ULTIMA forma aggiunta alla selezione. L'intenzione era buona
  // — il menu appare vicino a dove hai appena cliccato — ma con una
  // selezione grande l'ultima tessera cliccata sta quasi sempre in
  // mezzo al mosaico, e il menu ci atterra sopra.
  //
  // ⚠ LA COSA DA CAPIRE PRIMA DI CORREGGERE: «il più esterno a destra
  // possibile» È GIÀ SCRITTO. Il clamp finale dell'originale tiene la
  // colonna dentro l'area libera anche quando il bordo destro è fuori
  // vista. Gli si sta solo dando IL RETTANGOLO SBAGLIATO. Non c'è una
  // regola nuova da inventare: c'è un riquadro da sostituire.
  //
  // Quindi qui si riscrive UN SOLO NUMERO — `radial.style.left` —
  // rifacendo la stessa scelta di lato dell'originale sul riquadro
  // dell'INTERA selezione. Larghezza, altezza, verticale e
  // disposizione dei pulsanti restano quelle che l'originale ha già
  // calcolato: non le tocchiamo nemmeno di striscio.
  //
  // ⚠ LA VERTICALE NON SI TOCCA, ed è voluto. Continua a centrarsi
  // sulla porzione visibile dell'ultima tessera selezionata: il menu
  // resta all'altezza di dove stai lavorando, che è la cosa buona del
  // comportamento di oggi. Cambia solo il lato.
  //
  // ⚠ IL DISTACCO SI MISURA DAL BORDO DELLE MANIGLIE, NON DA QUELLO
  // DELLA FORMA (è la cerniera con il tetto qui sopra). Finché il
  // margine era 157 px, il dock messo a "riquadro + 22" cadeva DENTRO
  // l'anello delle maniglie e nessuno se ne accorgeva. Con il tetto a
  // 40 px cadrebbe SOPRA la maniglia di destra. Lezione generale:
  // quando si stringe un margine, si controlla chi ci stava dentro.
  function correggiLatoDock(active, freeArea) {
    // Solo per le multi-selezioni: per una forma sola l'àncora È la
    // forma, quindi l'originale calcola già il riquadro giusto e non
    // c'è niente da correggere. Un ramo in meno da collaudare.
    if (!active || active.type !== "activeSelection") return false;
    if (typeof active.getBoundingRect !== "function") return false;

    var radial = _radialEl();
    if (!radial) return false;

    var pap = _paper();
    if (!pap || typeof pap.getBoundingClientRect !== "function") return false;

    // La larghezza del dock l'originale l'ha appena scritta: la
    // rileggiamo invece di rifare il conto delle colonne. Se un domani
    // cambiasse il modo di impaginare i pulsanti, questo continua a
    // funzionare senza saperne niente.
    var dockW = parseFloat(radial.style.width);
    if (!isFinite(dockW) || dockW <= 0) return false;

    var GAP = _cost("DOCK_GAP_FROM_SHAPE", RISERVA_DOCK_GAP_FROM_SHAPE);
    var MARG = _cost("DOCK_SCREEN_MARGIN", RISERVA_DOCK_SCREEN_MARGIN);
    var scala = _scala();

    // Stessa area dell'originale: quella passata se è valida, altrimenti
    // la finestra intera. Ricopiata di proposito, perché se divergesse
    // il nostro clamp cadrebbe in un posto e il suo in un altro.
    var area =
      freeArea && isFinite(freeArea.left) && freeArea.right > freeArea.left && freeArea.bottom > freeArea.top
        ? freeArea
        : { left: 0, top: 0,
            right: (typeof window !== "undefined" ? window.innerWidth : 0),
            bottom: (typeof window !== "undefined" ? window.innerHeight : 0) };

    // ⚠ Sul WRAPPER della selezione getBoundingRect(true, true) è
    // corretto: il wrapper è un oggetto di primo livello, non un figlio.
    // Era sui FIGLI che non si poteva usare — hanno left/top relativi al
    // centro del contenitore — ed è il motivo per cui l'originale, che
    // lavora sull'àncora, deve passare da calcTransformMatrix.
    var r = active.getBoundingRect(true, true);
    if (!r || !isFinite(r.left) || !isFinite(r.width)) return false;

    var paperRect = pap.getBoundingClientRect();
    var padSchermo = (typeof active.padding === "number" && isFinite(active.padding))
      ? active.padding * scala : 0;

    var sLeft = paperRect.left + r.left * scala - padSchermo;
    var sRight = paperRect.left + (r.left + r.width) * scala + padSchermo;

    // Stessa scelta di lato dell'originale, sul riquadro giusto.
    var spaceRight = area.right - MARG - (sRight + GAP);
    var spaceLeft = sLeft - GAP - (area.left + MARG);

    var left;
    if (spaceRight >= dockW || spaceRight >= spaceLeft) left = sRight + GAP;
    else left = sLeft - GAP - dockW;

    // Stesso clamp dell'originale: è la riga che realizza «il più
    // esterno possibile, ma dentro la finestra».
    left = Math.min(
      Math.max(left, area.left + MARG),
      Math.max(area.left + MARG, area.right - MARG - dockW)
    );

    radial.style.left = Math.round(left) + "px";
    return true;
  }

  // ───────────────────────────────────────────────────────────
  //  FETTA 2c · INQUADRA LA SELEZIONE
  // ───────────────────────────────────────────────────────────
  // Zoom e pan calcolati perché la selezione stia tutta nell'area
  // libera, MANIGLIE COMPRESE. Fa esattamente quello che fa
  // resetZoomAndPan() di renderer.js, nello stesso ordine, scritto da
  // fuori invece che da dentro.
  //
  // ⚠ IL MARGINE PER LE MANIGLIE SI TIENE IN PIXEL DI SCHERMO, non in
  // unità canvas, e la ragione è la trappola del margine proporzionale:
  // il padding in unità canvas CRESCE quando la scala cala, quindi
  // allargare il riquadro del padding attuale darebbe un conto che si
  // smentisce da solo appena la scala cambia. Sullo schermo invece il
  // margine è costante e, dopo il tetto qui sopra, è al massimo
  // TETTO_MARGINE_SCHERMO per lato. Quello riserviamo. È il modo in cui
  // le due correzioni di questa fetta si parlano.
  //
  // ⚠ NON PASSA DA setZoomCentered(), quindi non entra nel percorso
  // dello zoom burst: qui non c'è nessuna raffica da assorbire, c'è un
  // salto solo.
  //
  // ⚠ NON SPINGE STORIA. Zoom e pan non hanno mai spinto storia in
  // Mosaica e non cominciano adesso.
  function fitSelection() {
    var cv = _cv();
    if (!cv || typeof cv.getActiveObject !== "function") return false;

    var active = cv.getActiveObject();
    if (!active || typeof active.getBoundingRect !== "function") {
      _toast("toast.fitSelection.nothing", "Non c'è niente di selezionato da inquadrare");
      return false;
    }

    var v = _view();
    if (!v) return false;

    var r = active.getBoundingRect(true, true);
    if (!r || !(r.width > 0) || !(r.height > 0)) return false;

    var areaFn = _fn("getRadialFreeArea");
    var area = areaFn ? areaFn() : null;
    if (!area || !(area.right > area.left) || !(area.bottom > area.top)) {
      area = { left: 0, top: 0,
               right: (typeof window !== "undefined" ? window.innerWidth : 0),
               bottom: (typeof window !== "undefined" ? window.innerHeight : 0) };
    }

    // Il margine da riservare per lato: le maniglie più un po' d'aria.
    var margine = TETTO_MARGINE_SCHERMO + ARIA_INQUADRATURA;
    var utileW = (area.right - area.left) - margine * 2;
    var utileH = (area.bottom - area.top) - margine * 2;
    if (!(utileW > 0) || !(utileH > 0)) return false;

    // ⚠ LA MANIGLIA DI ROTAZIONE STA SOPRA IL RIQUADRO, E VA INQUADRATA
    // ANCHE LEI. Fabric la disegna a `rotatingPointOffset` unità canvas
    // sopra il bordo superiore — in Mosaica è quella con l'icona a
    // freccia curva. Se la lasciassimo fuori, dopo aver premuto
    // "inquadra" la selezione si vedrebbe tutta ma non si potrebbe più
    // ruotare: il comando ci sarebbe e non si potrebbe prendere.
    //
    // Si allarga il riquadro IN UNITÀ CANVAS, non in pixel di schermo, e
    // la ragione è che il conto si morderebbe la coda: a schermo quello
    // scarto vale `offset × scala`, e la scala è proprio quello che
    // stiamo calcolando. In unità canvas invece è un numero fisso, e la
    // scala che ne esce lo tiene dentro da sola.
    var rotOff = (typeof active.rotatingPointOffset === "number" && isFinite(active.rotatingPointOffset))
      ? Math.max(0, active.rotatingPointOffset) : 40;
    var altezzaConRotazione = r.height + rotOff;

    var minZ = _cost("MIN_ZOOM", RISERVA_MIN_ZOOM);
    var maxZ = _cost("MAX_ZOOM", RISERVA_MAX_ZOOM);

    var voluta = Math.min(utileW / r.width, utileH / altezzaConRotazione);
    var s = Math.min(maxZ, Math.max(minZ, voluta));

    // ⚠ Limite DICHIARATO, non difetto: se la selezione è più grande di
    // quanto il 40% di zoom possa contenere, il clamp vince e una parte
    // resta fuori. Lo si dice all'utente invece di far finta che sia
    // andata bene.
    var troppoGrande = voluta < minZ;

    // ⚠ view.x e view.y sono la posizione del foglio SULLO SCHERMO, non
    // un offset da convertire: un punto p del canvas finisce a schermo in
    // view.x + p × view.scale. Quindi per portare il centro del riquadro
    // al centro dell'area basta rovesciare quella formula.
    //
    // ⚠ Il centro VERTICALE è quello del riquadro allargato in su dalla
    // maniglia di rotazione, non quello della forma: altrimenti la
    // selezione starebbe in mezzo e la maniglia sborderebbe da sopra.
    //
    // Si MUTANO le tre proprietà, non si riassegna `view`: una
    // riassegnazione da fuori funzionerebbe, ma lascerebbe orfano
    // chiunque avesse catturato un riferimento all'oggetto di prima.
    v.scale = s;
    v.x = (area.left + area.right) / 2 - (r.left + r.width / 2) * s;
    v.y = (area.top + area.bottom) / 2 - ((r.top - rotOff) + altezzaConRotazione / 2) * s;

    // Stesso ordine di resetZoomAndPan(), e non va cambiato: la qualità
    // del backstore va allineata PRIMA di ricalcolare le maniglie,
    // altrimenti si misurano su una scala che non c'è più.
    var f;
    if ((f = _fn("applyTransform"))) f();
    if ((f = _fn("refreshCanvasQualityForZoom"))) f(true);
    if ((f = _fn("_updateActiveHandlesForZoom"))) f();
    if ((f = _fn("positionRadial"))) f();
    if (typeof cv.requestRenderAll === "function") cv.requestRenderAll();

    if (troppoGrande) {
      _toast("toast.fitSelection.tooLarge",
             "La selezione è più grande di quanto lo zoom minimo possa contenere: una parte resta fuori");
    }
    return true;
  }

  // ───────────────────────────────────────────────────────────
  //  FETTA 3 · CHI NON SI SPECCHIA
  // ───────────────────────────────────────────────────────────
  // Decisione di Mirko del 10 settembre 2026. Due famiglie restano
  // fuori, per due ragioni diverse:
  //
  //  · lo SFONDO (`__isBackground`) — carta, texture, immagine di
  //    fondo. Non è nemmeno selezionabile, quindi in pratica non
  //    arriva mai qui; la guardia c'è perché una guardia che non
  //    scatta mai costa zero e una che manca costa un mosaico;
  //
  //  · i TRATTI A MANO LIBERA E AD ACQUERELLO — e questi sì che ci
  //    arrivano, perché sono oggetti selezionabili come le tessere:
  //    basta un Ctrl+A. L'acquerello in Mosaica è il disegno SOTTO,
  //    la guida su cui le tessere si posano. Con le mani si gira la
  //    tessera, non il foglio.
  //
  // ⚠ Il riconoscimento si CHIEDE a renderer.js, non si reinventa.
  // `isWatercolorOrFreehand()` sa tre cose che qui non si vedono: che
  // un `PressurePath` è sempre un tratto anche senza il flag (ed è il
  // caso dopo certi cicli di snapshot), che l'acquerello è un
  // `image`, e che un gruppo marcato conta. Il ripiego locale c'è per
  // gli ambienti degradati e ricalca le sue righe — è la stessa
  // scelta che svgExport.js ha già fatto per la stessa funzione.
  function nonSiSpecchia(o) {
    if (!o) return true;
    if (o.__isBackground === true) return true;

    var f = _fn("isWatercolorOrFreehand");
    if (f) {
      try { if (f(o)) return true; } catch (e) { /* si passa al ripiego */ }
    } else {
      var t = o.type;
      if (t === "PressurePath" || t === "pressurepath") return true;
      if ((o.__isFreehand === true || o.__isWatercolor === true) &&
          (t === "path" || t === "image" || t === "group")) return true;
    }
    return false;
  }

  // ───────────────────────────────────────────────────────────
  //  FETTA 3 · LO SPECCHIO DI UN OGGETTO SOLO
  // ───────────────────────────────────────────────────────────
  // `asse` è il punto per cui passa l'asse, NEL SISTEMA IN CUI
  // L'OGGETTO SI TROVA. Vale:
  //   · {x:0, y:0} per un figlio di una ActiveSelection — i suoi
  //     left/top sono relativi al centro del contenitore, quindi
  //     l'asse è x = 0 (o y = 0) e riflettere è cambiare un segno.
  //     La convenzione che altrove in renderer.js è una trappola qui
  //     è un regalo;
  //   · il centro dell'oggetto stesso, per una forma sola: l'asse
  //     passa per lì, quindi il centro non si muove e lo specchio è
  //     «in posto». Stesso codice, nessun ramo speciale.
  //
  // ⚠ L'ORDINE DELLE TRE SCRITTURE NON È LIBERO, e sbagliarlo dà una
  // forma nel posto sbagliato senza nessun errore in console:
  //  1. si LEGGE il centro PRIMA di toccare qualunque cosa. Mosaica
  //     ha oggetti con origini diverse — il rettangolo iniziale nasce
  //     originX:"left" e fabric.PressurePath FORZA left/top nel
  //     costruttore — e su quelli cambiare l'angolo cambia dove cade
  //     il centro. Leggerlo dopo darebbe un centro già inquinato;
  //  2. si scrive l'ANGOLO;
  //  3. si scrive il CENTRO, che va tradotto in left/top usando
  //     l'angolo — quindi l'angolo deve essere già quello nuovo.
  //
  // ⚠ E l'angolo si scrive come `-angle` e non come `360 - angle`:
  // il cambio di segno in virgola mobile è ESATTO, la sottrazione no.
  // È quello che fa tornare il doppio specchio all'identità al bit
  // invece che «a meno di un decimillesimo di grado» (trappola 84).
  function specchiaOggetto(o, asseVerticale, asse, esito) {
    if (nonSiSpecchia(o)) { esito.saltati++; return false; }
    if (typeof o.getCenterPoint !== "function" || typeof o.setPositionByOrigin !== "function") return false;

    // Il centro, letto adesso e non dopo (vedi la nota qui sopra).
    var c0 = o.getCenterPoint();
    if (!c0 || !isFinite(c0.x) || !isFinite(c0.y)) return false;

    // Si commuta il flip e non si scrive NESSUN numero di
    // dimensione. È l'assenza di codice che garantisce la misura.
    if (asseVerticale) o.flipX = !o.flipX;
    else o.flipY = !o.flipY;

    o.angle = -(Number(o.angle) || 0);

    o.setPositionByOrigin(
      _pt(asseVerticale ? 2 * asse.x - c0.x : c0.x,
          asseVerticale ? c0.y : 2 * asse.y - c0.y),
      "center", "center"
    );

    o.dirty = true;
    if (typeof o.setCoords === "function") o.setCoords();
    esito.fatti++;
    return true;
  }

  // ───────────────────────────────────────────────────────────
  //  FETTA 3 · LA COTTURA PARAMETRICA, SOLO SU UNA FORMA SOLA
  // ───────────────────────────────────────────────────────────
  // Trapezi e triangoli hanno un modello parametrico in `__shape` —
  // base superiore, base inferiore, altezza, spostamento, angoli α e
  // β — ed è quello che l'ispettore mostra e che l'export legge. Un
  // flip appena commutato non l'ha ancora aggiornato: la cottura di
  // renderer.js lo ricalcola DAI PUNTI, riordina i vertici secondo la
  // convenzione del modello e lascia intatti centro, rotazione e
  // misure. Non c'è niente da riscrivere qui: c'è da chiamarla.
  //
  // ⚠ SOLO QUANDO LA FORMA È SELEZIONATA DA SOLA, ed è la guardia
  // esatta che il gestore `object:modified` di renderer.js usa già
  // (`if (!isMulti)`). La ragione vera non è quella scritta nel suo
  // commento — la coppia leggi-centro/scrivi-centro è coerente anche
  // dentro un contenitore, l'ho misurata su tutte e tre le versioni
  // di Fabric — ma è comunque una ragione buona: dentro una
  // multi-selezione il WRAPPER può avere una scala ancora pendente,
  // che Fabric moltiplicherà nei figli solo allo scioglimento.
  // Cuocere adesso cuocerebbe metà della verità. Al suo posto ci
  // pensa la cottura differita di `selection:cleared`, che è il
  // percorso di sempre e che il deseleziona della Fetta 1 già
  // rispetta (trappola 91).
  function cuociParametrica(o) {
    if (!o || o.type !== "polygon") return false;
    var f;

    var trap = o.__shapeType === "trapezoid" || (o.__shape && o.__shape.type === "trapezoid");
    if (trap) {
      if ((f = _fn("bakeTrapezoidScaleIntoPoints"))) { try { f(o); } catch (e) { /* silenzio */ } }
      if ((f = _fn("populateTrapezoidControlsFromObject"))) { try { f(o); } catch (e) { /* silenzio */ } }
      return true;
    }

    var tri = o.__shapeType === "triangle" || (o.__shape && Array.isArray(o.__shape.angles));
    if (tri) {
      if ((f = _fn("bakeTriangleScaleIntoPoints"))) { try { f(o); } catch (e) { /* silenzio */ } }
      if ((f = _fn("toggleAngleControls"))) { try { f(); } catch (e) { /* silenzio */ } }
      return true;
    }

    return false;
  }

  // ───────────────────────────────────────────────────────────
  //  FETTA 3 · L'AZIONE
  // ───────────────────────────────────────────────────────────
  // ⚠ NON SI SCIOGLIE LA SELEZIONE, e non è pigrizia: il riquadro
  // d'ingombro di una disposizione specchiata è lo specchio del
  // riquadro — stessa larghezza, stessa altezza, stesso centro —
  // quindi il contenitore non va ricostruito né ricalcolato, basta un
  // setCoords(). Ricostruirlo scatenerebbe la raffica
  // selection:cleared / selection:created, con dentro la cottura
  // differita e le voci di storia che ne seguono: si pagherebbero tre
  // effetti collaterali per un guadagno di zero.
  //
  // ⚠ UNA VOCE SOLA DI STORIA PER GESTO. Il giro sta dentro
  // `__suspendHistoryPush`, che è il pattern di casa — lo usano la
  // cottura differita di renderer.js e deleteSelected() di
  // keyboardShortcuts.js — e la fotografia si scatta una volta, alla
  // fine. Il valore di prima si RIMETTE (non si azzera): se il gesto
  // arrivasse dentro un'operazione più grande che aveva già sospeso
  // la storia, azzerare gliela riaccenderebbe sotto il naso.
  function specchia(asseVerticale) {
    var cv = _cv();
    if (!cv || typeof cv.getActiveObject !== "function") return false;

    var active = cv.getActiveObject();
    if (!active) {
      _toast("toast.mirror.nothing", "Non c'è niente di selezionato da specchiare");
      return false;
    }

    var multi = active.type === "activeSelection";
    var figli;
    if (multi) {
      figli = (typeof active.getObjects === "function") ? active.getObjects().slice() : [];
    } else {
      figli = [active];
    }
    if (!figli.length) return false;

    // L'asse, nel sistema in cui i figli vivono. Vedi la nota lunga
    // dentro specchiaOggetto().
    var asse = { x: 0, y: 0 };
    if (!multi) {
      var c = active.getCenterPoint();
      if (!c || !isFinite(c.x) || !isFinite(c.y)) return false;
      asse = { x: c.x, y: c.y };
    }

    var esito = { fatti: 0, saltati: 0 };

    var sospesa = (typeof window !== "undefined") ? !!window.__suspendHistoryPush : false;
    try {
      if (typeof window !== "undefined") window.__suspendHistoryPush = true;
      for (var i = 0; i < figli.length; i++) {
        specchiaOggetto(figli[i], asseVerticale, asse, esito);
      }
      // La cottura parametrica sta DENTRO la sospensione: riscrive i
      // punti, e non deve generare una seconda voce di storia.
      //
      // ⚠ SI PASSA `active`, NON `figli[0]`, e la differenza conta.
      // Nel ramo a forma sola sono lo stesso oggetto, quindi il
      // comportamento è identico — ma con `active` il difetto
      // «cuoce anche in multi-selezione» diventa IMPOSSIBILE invece
      // che soltanto guardato: una ActiveSelection non è mai un
      // polygon, quindi cuociParametrica() esce da sé sul suo primo
      // controllo. Con `figli[0]` la guardia `!multi` era l'unica
      // cosa che teneva, e una guardia è una cosa da ricordare.
      // Meglio una porta chiusa che una cintura.
      // La guardia resta comunque, perché dichiara l'intenzione e
      // non costa niente: è per questo che il mutante che la
      // rimuove è dichiarato EQUIVALENTE nella suite di mutazione,
      // e non nascosto.
      if (!multi && esito.fatti) cuociParametrica(active);
    } finally {
      if (typeof window !== "undefined") window.__suspendHistoryPush = sospesa;
    }

    // Niente di specchiato: non si sporca la storia e si dice perché.
    if (!esito.fatti) {
      if (esito.saltati) {
        _toast("toast.mirror.onlyFreehand",
               "La selezione contiene solo tratti a mano libera o ad acquerello, che non si specchiano");
      }
      return false;
    }

    if (typeof active.setCoords === "function") active.setCoords();

    if (typeof cv.requestRenderAll === "function") cv.requestRenderAll();

    var ps = _fn("pushState");
    if (ps) { try { ps(); } catch (e) { /* silenzio */ } }

    // ⚠ L'avviso si dà DOPO aver fatto il lavoro, e si dà sempre che
    // ci sia stato qualcosa da saltare: se uno si aspetta che tutta
    // la selezione si rovesci e una parte non l'ha fatto, deve
    // saperlo subito — non scoprirlo stampando l'A4.
    //
    // ⚠ DUE CHIAVI, NON UNA CON {count}. Non è pignoleria: «1 tratti
    // non sono stati specchiati» è sbagliato in italiano e «1 strokes
    // were not» in inglese, e una chiave sola non può essere giusta
    // in entrambi i casi. Mettere il singolare nel ripiego non
    // servirebbe a niente, perché il ripiego smette di essere usato
    // esattamente nel momento in cui la chiave esiste.
    if (esito.saltati) {
      if (esito.saltati === 1) {
        _toast("toast.mirror.freehandSkippedOne",
               "Un tratto a mano libera non è stato specchiato: il disegno sotto le tessere non si tocca");
      } else {
        _toast("toast.mirror.freehandSkippedMany",
               "{count} tratti a mano libera non sono stati specchiati: il disegno sotto le tessere non si tocca",
               { count: esito.saltati });
      }
    }

    return true;
  }

  // ───────────────────────────────────────────────────────────
  //  I RIVESTIMENTI
  // ───────────────────────────────────────────────────────────
  // ⚠ Ogni rivestimento marca la funzione e non riveste due volte.
  // Senza la marca, un secondo
  // giro incapsulerebbe il rivestimento dentro sé stesso e la
  // correzione verrebbe applicata due volte — qui è idempotente, ma
  // nella Fetta 3 sarebbe uno specchio doppio.
  //
  // ⚠ E ogni rivestimento CHIAMA L'ORIGINALE E POI CORREGGE. Mai una
  // riscrittura: se domani la funzione di renderer.js cambia dentro,
  // la correzione continua a valere perché lavora sul risultato.
  //
  // ⚠ La correzione sta dentro un try: un errore nostro non deve mai
  // impedire alla funzione di renderer.js di aver fatto il suo lavoro.
  // Peggio del menu nel posto sbagliato c'è il menu che non compare.
  function vesti(nome, correzione) {
    var orig = _fn(nome);
    if (!orig || orig.__selToolsWrapped) return false;

    var vestito = function () {
      var esito = orig.apply(this, arguments);
      try {
        correzione.apply(null, arguments);
      } catch (e) {
        console.warn("[selectionTools] correzione di " + nome + " fallita", e);
      }
      return esito;
    };
    vestito.__selToolsWrapped = true;
    vestito.__selToolsOriginal = orig;
    window[nome] = vestito;
    return true;
  }

  function vestiTutto() {
    // ⚠ L'ordine fra questi due non conta: toccano cose diverse.
    vesti("updateHandlesSpacing", function (obj) { limitaMargineManiglie(obj); });
    vesti("positionRadialDockVertical", function (active, freeArea) { correggiLatoDock(active, freeArea); });
  }

  // ───────────────────────────────────────────────────────────
  //  L'ASCOLTATORE IN CAPTURE SUL RADIALE
  // ───────────────────────────────────────────────────────────
  // Registrato in CAPTURE sul contenitore: parte
  // PRIMA dei tre ascoltatori che renderer.js ha già sul radiale e
  // si ferma lì. Così il dispatch esistente non vede mai le nostre
  // azioni e non c'è niente da toccare di là.
  //
  // ⚠ Perché DUE fermate e non una — la distinzione è sottile e
  // vale la pena scriverla, perché a prima vista una delle due
  // sembra superflua.
  //  · `stopPropagation` basta contro i TRE ascoltatori che
  //    renderer.js ha sul radiale (il dispatch grande, quello del
  //    duplica, quello del taglia-cerchio): stanno tutti in fase di
  //    RISALITA, e fermare la propagazione in capture impedisce
  //    all'evento di arrivarci.
  //  · `stopImmediatePropagation` serve contro eventuali FRATELLI
  //    IN CAPTURE sullo stesso contenitore: contare sul filtro di un
  //    altro modulo sarebbe una dipendenza che nessuno ha scritto da
  //    nessuna parte. Ce la togliamo.
  function attachActions() {
    var r = _radialEl();
    if (!r || typeof r.addEventListener !== "function" || r.__selToolsBound) return false;
    r.__selToolsBound = true;

    r.addEventListener("click", function (e) {
      var btn = e.target && e.target.closest ? e.target.closest(".radial-btn") : null;
      if (!btn) return;
      var act = btn.getAttribute("data-action") || "";
      if (OUR_ACTIONS.indexOf(act) < 0) return;
      // Un pulsante spento si comporta da pulsante spento.
      if (btn.style.pointerEvents === "none") return;

      e.preventDefault();
      e.stopPropagation();
      if (typeof e.stopImmediatePropagation === "function") e.stopImmediatePropagation();

      if (act === "deselectAll") { deselectAll(); return; }
      if (act === "mirrorLeftRight") { specchia(true); return; }
      if (act === "mirrorTopBottom") { specchia(false); return; }
    }, true);

    // Sui nostri pulsanti il tasto destro non deve aprire il menu del
    // browser: nel radiale il destro è già un gesto dell'app.
    r.addEventListener("contextmenu", function (e) {
      var btn = e.target && e.target.closest ? e.target.closest(".radial-btn") : null;
      if (btn && OUR_ACTIONS.indexOf(btn.getAttribute("data-action") || "") >= 0) e.preventDefault();
    }, true);

    return true;
  }

  // ───────────────────────────────────────────────────────────
  //  IL PULSANTE DELLA BARRA DELLO ZOOM
  // ───────────────────────────────────────────────────────────
  // ⚠ Sta nella barra dello zoom e non nel radiale, e non è un
  // ripiego: un comando di zoom appartiene ai comandi di zoom. Il
  // radiale parla della forma selezionata, la barra in alto parla di
  // come la guardi. E c'è anche l'aritmetica: ogni pulsante in più
  // sul radiale alza il pavimento del raggio e anticipa il
  // ripiegamento a colonna — undici pulsanti chiedono 95 px di
  // raggio, dodici ne chiedono 103. Metterlo nel radiale avrebbe
  // fatto pagare a tutte le tessere il prezzo di un comando che non
  // le riguarda.
  function attachZoomButton() {
    if (typeof document === "undefined") return false;
    var b = document.getElementById("zoomFitSelection");
    if (!b || typeof b.addEventListener !== "function" || b.__selToolsBound) return false;
    b.__selToolsBound = true;
    b.addEventListener("click", function () { fitSelection(); });
    return true;
  }

  // ───────────────────────────────────────────────────────────
  //  AVVIO
  // ───────────────────────────────────────────────────────────
  // ⚠ Idempotente di proposito:
  // in Electron il DOMContentLoaded scatta una volta sola e la
  // guardia non serve, ma negli harness in jsdom l'evento naturale
  // del documento e quello che il test lancia a mano si sommano, e
  // senza questa riga ogni ascoltatore verrebbe registrato due volte.
  // Le guardie sui singoli elementi sono la seconda rete.
  var _inited = false;

  function init() {
    if (_inited) return;
    _inited = true;
    attachActions();
    attachZoomButton();
    vestiTutto();
    console.log("[selectionTools] Comandi della selezione caricati ✔ (deseleziona · tetto maniglie · dock esterno · inquadra selezione · specchio sui due assi)");
  }

  // Porta di servizio per l'harness e per chi un domani volesse
  // chiamare le azioni da altrove (una scorciatoia di tastiera, un
  // menu). Espone anche i prestiti e i numeri, che è il modo in cui
  // il livello "contratto" li legge senza ritagliare il sorgente.
  if (typeof window !== "undefined") {
    window.selectionTools = {
      deselectAll: deselectAll,
      fitSelection: fitSelection,
      // ⚠ I due nomi pubblici dicono il MOVIMENTO, come le azioni:
      // mirrorLeftRight lavora sull'asse VERTICALE (icona ◨),
      // mirrorTopBottom sull'asse ORIZZONTALE (icona ⬓).
      mirrorLeftRight: function () { return specchia(true); },
      mirrorTopBottom: function () { return specchia(false); },
      limitaMargineManiglie: limitaMargineManiglie,
      correggiLatoDock: correggiLatoDock,
      actions: OUR_ACTIONS,
      prestiti: PRESTITI,
      numeri: {
        TETTO_MARGINE_SCHERMO: TETTO_MARGINE_SCHERMO,
        ARIA_INQUADRATURA: ARIA_INQUADRATURA,
        RISERVA_DOCK_GAP_FROM_SHAPE: RISERVA_DOCK_GAP_FROM_SHAPE,
        RISERVA_DOCK_SCREEN_MARGIN: RISERVA_DOCK_SCREEN_MARGIN,
        RISERVA_MIN_ZOOM: RISERVA_MIN_ZOOM,
        RISERVA_MAX_ZOOM: RISERVA_MAX_ZOOM
      },
      // Il motore puro della Fetta 3, esposto per il banco di prova.
      // Non serve all'app.
      motore: {
        nonSiSpecchia: nonSiSpecchia,
        specchiaOggetto: specchiaOggetto,
        cuociParametrica: cuociParametrica
      },
      _init: init
    };
  }

  if (typeof document !== "undefined") {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", init);
    } else {
      init();
    }
  }
})();