// ============================================================
//  spuntaTessere.js — Mosaica Workspace Pro
//  LA SPUNTA DELLE TESSERE (cantiere «Spunta Tessere»: Fetta 1 il motore,
//  Fetta 2 l'interfaccia, Fetta 3 il settore che si schiaccia)
// ------------------------------------------------------------
//  COS'È
//  -----
//  Mozzare una o più punte di una tessera che c'è GIÀ: un triangolo,
//  un trapezio, un quadrato, un rettangolo, una forma libera a lati
//  dritti (anche quelle della Palladiana già nel mosaico). La punta
//  diventa un lato piatto corto.
//
//  ⚠ La tessera NON si rifà: resta lei. Tiene colore, famiglia
//  fantasma, texture, posizione, rotazione, specchio e livello. È il
//  motivo per cui il cantiere esiste: le tessere fatte nella Palladiana
//  nascevano nuove, quindi fuori dalle famiglie (§0-bis del cantiere).
//  Le copie di una tessera spuntata nascono spuntate.
//
//  LE PAROLE (decise da Mirko il 28/10)
//  ------------------------------------
//   • la PUNTA è un vertice della tessera com'era prima della spunta;
//   • il TAGLIO toglie la punta con un lato dritto nuovo, da un CAPO
//     sul lato che arriva nella punta a un CAPO sul lato che ne parte;
//   • la LARGHEZZA DELLA PUNTA è quanto è lungo quel lato nuovo, in mm
//     veri sul foglio (B1 = a: «punta di 1 mm»);
//   • di partenza il taglio è SIMMETRICO (i due capi alla stessa
//     distanza dalla punta); spostando un capo diventa LIBERO (B2).
//     Cambiando la larghezza di un taglio libero, i due capi restano
//     nella stessa proporzione.
//
//  COSA SI PORTA DIETRO LA TESSERA
//  -------------------------------
//  Dopo la spunta la tessera è una FORMA LIBERA (`__shapeType`
//  "custom", un fabric.Polygon) e in `__shape.spunta` c'è tutto quello
//  che serve per rifarla o rimetterla com'era:
//     da     com'era prima: "triangle", "trapezoid", "custom", "rect"…
//     forma  il suo `__shape` di prima (copia)
//     punti  i suoi vertici di prima, nel sistema dei punti del poligono
//     w, h   (solo da "rect") larghezza e altezza del rettangolo
//     tagli  [{ v, a, b }]: la punta v, e dove stanno i capi, come
//            FRAZIONE del lato: a sul lato che arriva (verso v-1),
//            b sul lato che parte (verso v+1). Le frazioni non
//            dipendono da calibrazione, scala o rotazione: la tessera
//            ingrandita con le maniglie si porta dietro i tagli giusti.
//
//  ⚠ PERCHÉ «FORMA LIBERA» E NON PIÙ «TRIANGOLO» (trappola 311)
//  Alla riapertura del file renderer.js RIFÀ i punti di ogni trapezio
//  dai suoi numeri (`__shape` top/bottom/height/offset, applyProjectData)
//  e gli slider di angoli e basi rifanno i punti dal modello: la spunta
//  sparirebbe. Da forma libera nessuno la tocca. «↺ Rimetti le punte»
//  ridà triangolo o trapezio coi loro slider.
//
//  IL PATTO
//  --------
//  renderer.js, mouseObserver.js, keyboardShortcuts.js e svgExport.js
//  non si toccano. Si chiamano per nome (sempre con la guardia, come
//  selectionTools.js e textureGhost.js) le function di primo livello:
//  pushState, beginBatchOperation/endBatchOperation (una voce sola di
//  Ctrl+Z quando la tessera va sostituita), bakeTriangleScaleIntoPoints,
//  bakeTrapezoidScaleIntoPoints (per «Rimetti»), applyHandlePreset,
//  updateHandlesSpacing, positionRadial, updateMeasureOverlay,
//  updateShapeDimensionsPanel, toggleAngleControls,
//  populateTrapezoidControlsFromObject, isWatercolorOrFreehand, px2mm,
//  e la `let selectedObj`. Nessuna porta di Fabric nuova: copie,
//  annulla, file e autosalvataggio portano già `__shape` e
//  `__shapeType` (sono in tutte le liste).
//
//  FETTA 1 = IL MOTORE (parti 1-3). I comandi stanno in
//  window.spuntaTessere e sono muti (niente avvisi a schermo).
//
//  FETTA 2 = L'INTERFACCIA (parte 4):
//   • ✂️ nel radiale (solo sulle tessere a lati dritti: dove si vede ◔
//     non si vede ✂️, quindi il radiale non ha un pulsante in più);
//   • a spunta ACCESA, sulle punte compaiono le maniglie: clic su una
//     punta = la taglia (larghezza di partenza), trascinando la si
//     allarga o la si stringe; i due capi del taglio scelto si
//     trascinano lungo il loro lato (taglio libero);
//   • il blocco «✂️ Spunta» nell'ispettore: larghezza e capi in mm,
//     «Togli questo taglio», «↺ Rimetti le punte»;
//   • i tasti: Canc toglie il taglio scelto e MAI la tessera; Invio ed
//     Esc spengono la spunta; Ctrl+Z la spegne e poi annulla; le
//     frecce restano della tessera.
//  Un passo di Ctrl+Z per ogni taglio: un clic = un passo, un
//  trascinamento = un passo (durante il trascinamento i tagli sono
//  muti, la fotografia si fa al rilascio).
//  Porte in più rispetto alla Fetta 1 (sempre con la guardia):
//  un ascoltatore click/mousedown IN CATTURA sul radiale (come
//  selectionTools.js), i rivestimenti di updateRadialSliceVisibility
//  (chi si vede nel radiale) e di updateTextureGrainPanel (il blocco
//  dell'ispettore, come textureGhost.js), getRadialFreeArea (dove
//  stanno le maniglie), un keydown in cattura su window.
//
//  FETTA 3 = IL SETTORE CHE SI SCHIACCIA (parte 5, novembre 2026):
//   • Mirko (B4): sui settori del cerchio e dell'ovale il lato curvo si
//     abbassa verso la corda e i due lati dritti restano quelli. B5 = a
//     («premuta col pollice»): ogni punto dell'arco scende verso la corda
//     in proporzione. La regola sta in CircleSectorModel.js (il campo
//     `curva` di __shape): alla riapertura renderer.js rifà il settore
//     dal modello e lo ritrova schiacciato da sé;
//   • il blocco «◠ Curva» nell'ispettore, su un settore solo fino a 180°:
//     numero in % e cursore (100 = l'arco di sempre, 0 = lato dritto),
//     INIZIO e FINE CURVATURA in mm sul foglio (Mirko, 02/11: il lato
//     curvo parte dritto per N mm dal capo giallo / rosa, segnati sul
//     settore da due pallini, e solo dopo curva, raccordato senza
//     spigolo), «↺ Curva intera». Il radiale non cambia;
//   • la tessera resta lei: cambia solo il path (`_setPath`, c'è nella
//     5.5.2 e nella 5.3.0), il centro del cerchio e i due estremi non si
//     muovono. Un passo di Ctrl+Z per scelta (il cursore trascinato = uno).
//  Porte in più: nessuna (stesso rivestimento di updateTextureGrainPanel).
//
//  Fabric: 5.5.2 in uso, provato anche sulla 5.3.0. Solo API presenti
//  in tutte e due (points, pathOffset, _calcDimensions,
//  calcTransformMatrix, setPositionByOrigin, insertAt, controls e
//  _controlsVisibility).
// ============================================================
(function () {
  "use strict";

  if (window.__spuntaTessereInstalled) return;
  if (typeof fabric === "undefined" || !fabric.Polygon) return;
  window.__spuntaTessereInstalled = true;

  const VERSION = "3";

  // ── I NUMERI ──
  // La larghezza di partenza della punta (Mirko: «punta di 1 mm»).
  const LARGHEZZA_PARTENZA_MM = 1;
  // Sotto questa misura un lato nuovo non è una punta piatta, è un graffio.
  const LARGHEZZA_MINIMA_MM = 0.1;
  // Quanto lato vero deve restare fra due tagli sullo stesso lato (o fra
  // un taglio e la punta dopo): due capi che si toccano farebbero un
  // vertice di troppo e una tessera che il laser taglia male.
  const LATO_CHE_RESTA_MM = 0.2;
  // Una punta più aperta di così è quasi piatta: tagliarla non serve e il
  // lato nuovo diventerebbe lunghissimo per pochi decimi di tessera tolta.
  const ANGOLO_MASSIMO_GRADI = 175;
  // Dove si ricorda l'ultima larghezza usata (vale per la volta dopo).
  const CHIAVE_LARGHEZZA = "mosaica_spunta_larghezza_mm";

  // I campi di una tessera che la sostituzione (rettangolo → poligono e
  // ritorno) deve portare con sé. Le etichette delle texture e il segno
  // fantasma, come textureGhost.js; i lucchetti del 🔒; il resto di casa.
  const CAMPI_DA_PORTARE = [
    "__ghost", "__textureId", "__textureSpanMM", "__textureColorize", "__textureTint",
    "__preTextureFill", "__textureDataURL", "data", "customId", "__addedAt"
  ];
  const STILE_DA_PORTARE = [
    "fill", "opacity", "stroke", "strokeWidth", "strokeDashArray", "strokeLineCap", "strokeLineJoin",
    "strokeUniform", "strokeMiterLimit", "shadow", "visible", "globalCompositeOperation",
    "selectable", "evented", "hasControls", "hasBorders", "lockMovementX", "lockMovementY",
    "lockRotation", "lockScalingX", "lockScalingY", "lockSkewingX", "lockSkewingY",
    "hoverCursor", "moveCursor", "objectCaching"
  ];

  // ── nomi presi in prestito da renderer.js (sempre con la guardia) ──
  function fn(nome) {
    try {
      return typeof window[nome] === "function" ? window[nome] : null;
    } catch (_) {
      return null;
    }
  }
  function cv() {
    try {
      if (window.canvas) return window.canvas;
    } catch (_) {}
    try {
      if (typeof canvas !== "undefined" && canvas) return canvas;
    } catch (_) {}
    return null;
  }
  function busy() {
    try {
      if (typeof isApplyingSnapshot !== "undefined" && isApplyingSnapshot) return true;
    } catch (_) {}
    try {
      if (typeof isRestoringProject !== "undefined" && isRestoringProject) return true;
    } catch (_) {}
    return false;
  }
  function px2mmV(px) {
    const f = fn("px2mm");
    return f ? f(px) : px / (96 / 25.4);
  }
  function mm2pxV(mm) {
    const f = fn("mm2px");
    return f ? f(mm) : mm * (96 / 25.4);
  }
  function chiama(nome) {
    const f = fn(nome);
    if (!f) return undefined;
    try {
      return f.apply(null, Array.prototype.slice.call(arguments, 1));
    } catch (e) {
      console.warn("[spuntaTessere] " + nome, e);
      return undefined;
    }
  }
  function pushStoria() {
    if (busy()) return;
    chiama("pushState");
  }
  function impostaSelezionato(o) {
    try {
      if (typeof selectedObj !== "undefined") selectedObj = o;
    } catch (_) {}
  }

  // ════════════════════════════════════════════════════════════════
  //  PARTE 1 — LA GEOMETRIA (pura: niente Fabric, niente DOM)
  // ════════════════════════════════════════════════════════════════
  function sub(a, b) {
    return { x: a.x - b.x, y: a.y - b.y };
  }
  function len(v) {
    return Math.sqrt(v.x * v.x + v.y * v.y);
  }
  function lerp(a, b, t) {
    return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
  }
  function cross(a, b) {
    return a.x * b.y - a.y * b.x;
  }
  // La parte lineare di una matrice di Fabric [a, b, c, d, e, f].
  function lin(M, v) {
    return { x: M[0] * v.x + M[2] * v.y, y: M[1] * v.x + M[3] * v.y };
  }
  function areaConSegno(P) {
    let A = 0;
    for (let i = 0, n = P.length; i < n; i++) {
      const p = P[i], q = P[(i + 1) % n];
      A += p.x * q.y - q.x * p.y;
    }
    return A / 2;
  }

  // I vertici dopo i tagli. tagli = array lungo come P (null = punta intera).
  // Camminando sul contorno si incontra prima il capo sul lato che arriva
  // (verso v-1), poi quello sul lato che parte (verso v+1).
  function puntiSpuntati(P, tagli) {
    const n = P.length, out = [];
    for (let i = 0; i < n; i++) {
      const t = tagli && tagli[i];
      if (!t) {
        out.push({ x: P[i].x, y: P[i].y });
        continue;
      }
      out.push(lerp(P[i], P[(i - 1 + n) % n], t.a));
      out.push(lerp(P[i], P[(i + 1) % n], t.b));
    }
    return out;
  }

  function tagliDaLista(lista, n) {
    const T = new Array(n).fill(null);
    (lista || []).forEach((t) => {
      if (t && Number.isInteger(t.v) && t.v >= 0 && t.v < n && t.a > 0 && t.b > 0) T[t.v] = { a: t.a, b: t.b };
    });
    return T;
  }
  function listaDaTagli(T) {
    const out = [];
    T.forEach((t, v) => {
      if (t) out.push({ v: v, a: arrot(t.a), b: arrot(t.b) });
    });
    return out;
  }
  // 1e-9 di lato: nessuna perdita vera (una tessera da 1 m sarebbe un
  // nanometro), e il file non porta il rumore dei conti.
  function arrot(x) {
    return Math.round(x * 1e9) / 1e9;
  }

  // Tutto quello che serve per tagliare la punta i: i lati (veri, sul
  // foglio, in px del canvas), l'angolo, se è sporgente, quanto ci sta.
  // L = matrice della tessera (solo la parte lineare conta).
  // margPx = quanto lato deve restare (LATO_CHE_RESTA_MM in px del canvas).
  function analisiPunta(P, T, i, L, margPx) {
    const n = P.length;
    const V = P[i], A = P[(i - 1 + n) % n], B = P[(i + 1) % n];
    const uA = lin(L, sub(A, V)), uB = lin(L, sub(B, V)); // i due lati, sul foglio
    const la = len(uA), lb = len(uB);
    const ori = Math.sign(areaConSegno(P)) || 1;
    // sporgente = la punta gira dalla stessa parte del contorno
    const giro = cross(sub(V, A), sub(B, V)) * ori;
    const sporgente = giro > 1e-12;
    let angolo = 180;
    if (la > 0 && lb > 0) {
      const c = (uA.x * uB.x + uA.y * uB.y) / (la * lb);
      angolo = (Math.acos(Math.max(-1, Math.min(1, c))) * 180) / Math.PI;
    }
    // quanto di ogni lato è libero: il lato meno il taglio della punta
    // accanto, meno quello che deve restare
    const prima = T[(i - 1 + n) % n], dopo = T[(i + 1) % n];
    const aMax = la > 0 ? 1 - (prima ? prima.b : 0) - margPx / la : 0;
    const bMax = lb > 0 ? 1 - (dopo ? dopo.a : 0) - margPx / lb : 0;
    return { V: V, A: A, B: B, uA: uA, uB: uB, la: la, lb: lb, angolo: angolo, sporgente: sporgente, aMax: aMax, bMax: bMax };
  }

  // La larghezza della punta (sul foglio, px del canvas) per un taglio {a, b}.
  function larghezzaPx(an, t) {
    if (!t) return 0;
    const P = { x: an.uA.x * t.a, y: an.uA.y * t.a };
    const Q = { x: an.uB.x * t.b, y: an.uB.y * t.b };
    return len(sub(P, Q));
  }

  // Il taglio che dà la larghezza wPx con i capi nella proporzione
  // sA : sB (distanze dalla punta, sul foglio). Di partenza 1 : 1, cioè
  // simmetrico. Se non ci sta, il più largo che ci sta (limitato = true).
  function taglioPerLarghezza(an, wPx, sA, sB) {
    if (!(an.la > 0 && an.lb > 0)) return null;
    sA = sA > 0 ? sA : 1;
    sB = sB > 0 ? sB : 1;
    const ua = { x: an.uA.x / an.la, y: an.uA.y / an.la };
    const ub = { x: an.uB.x / an.lb, y: an.uB.y / an.lb };
    const unit = len(sub({ x: ua.x * sA, y: ua.y * sA }, { x: ub.x * sB, y: ub.y * sB }));
    if (!(unit > 1e-12)) return null;
    let k = wPx / unit;
    let a = (k * sA) / an.la, b = (k * sB) / an.lb;
    let limitato = false;
    const f = Math.min(a > an.aMax ? an.aMax / a : 1, b > an.bMax ? an.bMax / b : 1);
    if (f < 1) {
      a *= f;
      b *= f;
      limitato = true;
    }
    if (!(a > 0 && b > 0)) return null;
    return { a: a, b: b, limitato: limitato };
  }

  // ════════════════════════════════════════════════════════════════
  //  PARTE 2 — LA TESSERA
  // ════════════════════════════════════════════════════════════════
  function eTratto(o) {
    if (!o) return true;
    if (o.type === "PressurePath" || o.type === "pressurepath") return true;
    const f = fn("isWatercolorOrFreehand");
    if (f) {
      try {
        return !!f(o);
      } catch (_) {}
    }
    return !!(o.__isFreehand || o.__isWatercolor);
  }

  // Si può spuntare? { ok, motivo }. Le forme con lati curvi (cerchi,
  // ovali, settori, forme curve della Palladiana) non hanno punte da
  // mozzare: il settore ha il suo comando (Fetta 3 del cantiere).
  function puoi(o) {
    if (!o) return { ok: false, motivo: "nessuna" };
    if (o.type === "activeSelection" || o.type === "group") return { ok: false, motivo: "piuDiUna" };
    if (o.group) return { ok: false, motivo: "inGruppo" };
    if (o.__isBackground || eTratto(o)) return { ok: false, motivo: "nonTessera" };
    if (o.type === "polygon") {
      if (!Array.isArray(o.points) || o.points.length < 3) return { ok: false, motivo: "forma" };
      return { ok: true };
    }
    if (o.type === "rect") {
      if ((o.rx || 0) > 0 || (o.ry || 0) > 0) return { ok: false, motivo: "angoliTondi" };
      if (!(o.width > 0 && o.height > 0)) return { ok: false, motivo: "forma" };
      return { ok: true };
    }
    return { ok: false, motivo: "latiCurvi" };
  }

  function clona(x) {
    try {
      return x == null ? null : JSON.parse(JSON.stringify(x));
    } catch (_) {
      return null;
    }
  }

  // Il record della spunta di una tessera, o null.
  function record(o) {
    const s = o && o.__shape && o.__shape.spunta;
    return s && Array.isArray(s.punti) && s.punti.length >= 3 ? s : null;
  }

  // I vertici «di prima» (la tessera intera) e i tagli di adesso.
  function base(o) {
    const r = record(o);
    if (r) return { P: r.punti.map((p) => ({ x: p.x, y: p.y })), T: tagliDaLista(r.tagli, r.punti.length) };
    const P = o.points.map((p) => ({ x: p.x, y: p.y }));
    return { P: P, T: new Array(P.length).fill(null) };
  }

  function margPxDi() {
    return mm2pxV(LATO_CHE_RESTA_MM);
  }

  // Cambia i punti del poligono SENZA spostare niente sul foglio: i
  // vertici che restano restano dov'erano al millesimo. Fabric mette il
  // centro del poligono al centro della scatola dei punti (pathOffset):
  // tagliando una punta la scatola cambia, e il centro va spostato della
  // stessa differenza, girata e scalata come la tessera (trappola 312).
  function cambiaPunti(o, nuovi) {
    const M = o.calcTransformMatrix();
    const po = { x: o.pathOffset ? o.pathOffset.x : 0, y: o.pathOffset ? o.pathOffset.y : 0 };
    o.points = nuovi.map((p) => ({ x: p.x, y: p.y }));
    const d = o._calcDimensions();
    o.width = d.width;
    o.height = d.height;
    o.pathOffset = new fabric.Point(d.left + d.width / 2, d.top + d.height / 2);
    const c = fabric.util.transformPoint(new fabric.Point(o.pathOffset.x - po.x, o.pathOffset.y - po.y), M);
    o.setPositionByOrigin(c, "center", "center");
    o.dirty = true;
    if (o.group) o.group.dirty = true;
    o.setCoords();
  }

  // Sostituisce una tessera con un'altra al suo posto nel foglio (stesso
  // livello), portando i campi di casa. NON fotografa: la voce di Ctrl+Z
  // la fa chi chiama, una sola per tutto il comando. Rimozione e aggiunta
  // stanno dentro `__suspendHistoryPush` (il modo di casa: lo usano la
  // cottura differita di renderer.js e lo specchio di selectionTools.js),
  // così le loro fotografie ritardate di 400 ms non partono (trappola 306).
  // Il valore di prima si RIMETTE, non si azzera.
  function sostituisci(vecchia, nuova) {
    const c = cv();
    STILE_DA_PORTARE.forEach((k) => {
      if (vecchia[k] !== undefined) nuova[k] = vecchia[k];
    });
    CAMPI_DA_PORTARE.forEach((k) => {
      const x = vecchia[k];
      if (x !== undefined) nuova[k] = x && typeof x === "object" ? clona(x) : x;
    });
    // il motivo della texture si passa così com'è: la vecchia esce dal
    // foglio, quindi non ci sono due tessere con lo stesso oggetto
    if (vecchia.fill && typeof vecchia.fill === "object") nuova.fill = vecchia.fill;
    const idx = c.getObjects().indexOf(vecchia);
    const attiva = c.getActiveObject() === vecchia;
    const sospesa = !!window.__suspendHistoryPush;
    window.__suspendHistoryPush = true;
    try {
      if (attiva) c.discardActiveObject();
      c.remove(vecchia);
      if (idx >= 0 && typeof c.insertAt === "function") c.insertAt(nuova, idx);
      else c.add(nuova);
    } finally {
      window.__suspendHistoryPush = sospesa;
    }
    chiama("applyHandlePreset", nuova);
    chiama("updateHandlesSpacing", nuova);
    nuova.setCoords();
    if (attiva) {
      c.setActiveObject(nuova);
      impostaSelezionato(nuova);
    }
    return nuova;
  }

  // I quattro spigoli di un rettangolo, attorno al suo centro. (Separati
  // da poligonoDaRettangolo dalla Fetta 2: le maniglie li rileggono a
  // ogni fotogramma, e un fabric.Polygon nuovo ogni volta non serve.)
  function puntiRettangolo(r) {
    const w = r.width, h = r.height;
    return [
      { x: -w / 2, y: -h / 2 },
      { x: w / 2, y: -h / 2 },
      { x: w / 2, y: h / 2 },
      { x: -w / 2, y: h / 2 }
    ];
  }

  // Un rettangolo diventa un poligono con gli stessi quattro spigoli.
  function poligonoDaRettangolo(r) {
    const w = r.width, h = r.height;
    const pts = puntiRettangolo(r);
    const c = r.getCenterPoint();
    const p = new fabric.Polygon(pts, {
      originX: "center",
      originY: "center",
      left: c.x,
      top: c.y,
      angle: r.angle || 0,
      scaleX: r.scaleX || 1,
      scaleY: r.scaleY || 1,
      flipX: !!r.flipX,
      flipY: !!r.flipY,
      skewX: r.skewX || 0,
      skewY: r.skewY || 0
    });
    return { poligono: p, punti: pts, w: w, h: h };
  }

  // La tessera pronta da spuntare: un poligono col suo record. Se era un
  // rettangolo, al suo posto c'è adesso un poligono (si restituisce quello).
  function preparaPoligono(o) {
    if (o.type === "polygon") {
      if (!record(o)) {
        o.__shape = {
          type: "custom",
          spunta: {
            da: o.__shapeType || (o.__shape && o.__shape.type) || "custom",
            forma: clona(o.__shape),
            punti: o.points.map((p) => ({ x: p.x, y: p.y })),
            tagli: []
          }
        };
        o.__shapeType = "custom";
      }
      return o;
    }
    // rettangolo
    const r = poligonoDaRettangolo(o);
    r.poligono.__shapeType = "custom";
    r.poligono.__shape = {
      type: "custom",
      spunta: { da: "rect", forma: clona(o.__shape), tipoDi: o.__shapeType || null, punti: r.punti, w: r.w, h: r.h, tagli: [] }
    };
    return sostituisci(o, r.poligono);
  }

  // Rimette la tessera nel foglio coi tagli T (sul record) e i punti giusti.
  function applica(o, T) {
    const r = record(o);
    r.tagli = listaDaTagli(T);
    cambiaPunti(o, puntiSpuntati(r.punti, T));
  }

  // Dopo ogni comando: l'ispettore, le maniglie, il radiale, le misure.
  function aggiornaIntorno(o) {
    chiama("updateHandlesSpacing", o);
    chiama("toggleAngleControls");
    chiama("populateTrapezoidControlsFromObject", o);
    chiama("updateShapeDimensionsPanel");
    chiama("updateMeasureOverlay");
    chiama("positionRadial");
    chiama("refreshInspectorContext");
    const c = cv();
    if (c) c.requestRenderAll();
  }

  function larghezzaDiPartenza() {
    try {
      const v = parseFloat(window.localStorage.getItem(CHIAVE_LARGHEZZA));
      if (isFinite(v) && v >= LARGHEZZA_MINIMA_MM) return v;
    } catch (_) {}
    return LARGHEZZA_PARTENZA_MM;
  }
  function ricordaLarghezza(mm) {
    try {
      if (isFinite(mm) && mm >= LARGHEZZA_MINIMA_MM) window.localStorage.setItem(CHIAVE_LARGHEZZA, String(Math.round(mm * 100) / 100));
    } catch (_) {}
  }

  // ════════════════════════════════════════════════════════════════
  //  PARTE 3 — I COMANDI
  // ════════════════════════════════════════════════════════════════
  // Lo stato di una tessera: le punte, com'è ognuna, quanto si può tagliare.
  function stato(o) {
    const p = puoi(o);
    if (!p.ok) return { ok: false, motivo: p.motivo };
    if (o.type === "rect") {
      const P = puntiRettangolo(o);
      const L = o.calcTransformMatrix();
      const T = [null, null, null, null];
      return { ok: true, spuntata: false, da: "rect", punte: P.map((_, i) => descriviPunta(P, T, i, L)) };
    }
    const b = base(o);
    const L = o.calcTransformMatrix();
    const r = record(o);
    return {
      ok: true,
      spuntata: !!(r && r.tagli && r.tagli.length),
      da: r ? r.da : o.__shapeType || "custom",
      punte: b.P.map((_, i) => descriviPunta(b.P, b.T, i, L))
    };
  }
  function descriviPunta(P, T, i, L) {
    const an = analisiPunta(P, T, i, L, margPxDi());
    const t = T[i];
    const tagliabile = an.sporgente && an.angolo < ANGOLO_MASSIMO_GRADI && an.aMax > 0 && an.bMax > 0;
    let maxMm = 0;
    if (tagliabile) {
      const m = taglioPerLarghezza(an, 1e9, t ? t.a : 1, t ? t.b : 1);
      maxMm = m ? px2mmV(larghezzaPx(an, m)) : 0;
    }
    return {
      v: i,
      x: an.V.x,
      y: an.V.y,
      angolo: Math.round(an.angolo * 100) / 100,
      sporgente: an.sporgente,
      tagliabile: tagliabile,
      taglio: t
        ? { a: t.a, b: t.b, larghezzaMm: px2mmV(larghezzaPx(an, t)), capoAmm: px2mmV(an.la * t.a), capoBmm: px2mmV(an.lb * t.b) }
        : null,
      larghezzaMassimaMm: maxMm
    };
  }

  // ✂️ Taglia la punta v.
  //  opz.larghezza (mm): la larghezza della punta. Senza: quella di
  //    partenza (l'ultima usata, 1 mm la prima volta). Se la punta è già
  //    tagliata, i capi tengono la loro proporzione (un taglio libero
  //    resta libero).
  //  opz.capi = { a, b } (mm sul foglio, dalla punta): i due capi dove si
  //    vuole, il taglio libero. Ha la precedenza su larghezza.
  //  opz.muto: niente voce di Ctrl+Z (la fa chi chiama, es. a fine
  //    trascinamento nella Fetta 2).
  // Restituisce { ok, tessera, larghezzaMm, limitato } o { ok:false, motivo }.
  function taglia(o, v, opz) {
    opz = opz || {};
    if (busy()) return { ok: false, motivo: "occupato" };
    const p = puoi(o);
    if (!p.ok) return { ok: false, motivo: p.motivo };
    const nPrima = o.type === "rect" ? 4 : base(o).P.length;
    if (!Number.isInteger(v) || v < 0 || v >= nPrima) return { ok: false, motivo: "punta" };
    // Prima si controlla sulla tessera com'è, poi (solo se si può) la si
    // prepara: un comando rifiutato non lascia niente cambiato.
    const prova = stato(o).punte[v];
    if (!prova.sporgente) return { ok: false, motivo: "rientrante" };
    if (!prova.tagliabile) return { ok: false, motivo: "nonCiSta" };

    const L = o.calcTransformMatrix();
    const b0 = o.type === "rect" ? { P: puntiRettangolo(o), T: [null, null, null, null] } : base(o);
    const an = analisiPunta(b0.P, b0.T, v, L, margPxDi());
    let t;
    if (opz.capi && isFinite(opz.capi.a) && isFinite(opz.capi.b)) {
      const a = mm2pxV(Math.max(0, opz.capi.a)) / an.la;
      const bb = mm2pxV(Math.max(0, opz.capi.b)) / an.lb;
      t = { a: Math.min(a, an.aMax), b: Math.min(bb, an.bMax), limitato: a > an.aMax || bb > an.bMax };
      if (!(t.a > 0 && t.b > 0)) return { ok: false, motivo: "capi" };
    } else {
      const w = isFinite(opz.larghezza) ? Number(opz.larghezza) : larghezzaDiPartenza();
      if (!(w >= LARGHEZZA_MINIMA_MM)) return { ok: false, motivo: "troppoStretta" };
      const vecchio = b0.T[v];
      // la proporzione dei capi, in distanza VERA dalla punta
      const sA = vecchio ? vecchio.a * an.la : 1;
      const sB = vecchio ? vecchio.b * an.lb : 1;
      t = taglioPerLarghezza(an, mm2pxV(w), sA, sB);
      if (!t) return { ok: false, motivo: "nonCiSta" };
    }
    if (px2mmV(larghezzaPx(an, t)) < LARGHEZZA_MINIMA_MM - 1e-9) return { ok: false, motivo: "troppoStretta" };

    const c = cv();
    const eraAttiva = !!(c && c.getActiveObject() === o);
    const tess = preparaPoligono(o);
    const b = base(tess);
    b.T[v] = { a: t.a, b: t.b };
    applica(tess, b.T);
    const largh = px2mmV(larghezzaPx(analisiPunta(b.P, b.T, v, tess.calcTransformMatrix(), margPxDi()), b.T[v]));
    // si ricorda la larghezza OTTENUTA: chiedendo troppo, la prossima punta
    // nascerebbe di nuovo troppo larga (trappola 319)
    if (!opz.capi) ricordaLarghezza(!t.limitato && isFinite(opz.larghezza) ? Number(opz.larghezza) : largh);
    if (eraAttiva && c.getActiveObject() !== tess) c.setActiveObject(tess);
    aggiornaIntorno(tess);
    if (!opz.muto) pushStoria();
    return { ok: true, tessera: tess, larghezzaMm: largh, limitato: !!t.limitato };
  }

  // Toglie il taglio della punta v. Se non resta nessun taglio, la tessera
  // torna com'era (come «Rimetti le punte»).
  function togli(o, v, opz) {
    opz = opz || {};
    if (busy()) return { ok: false, motivo: "occupato" };
    const r = record(o);
    if (!r) return { ok: false, motivo: "nonSpuntata" };
    const b = base(o);
    if (!Number.isInteger(v) || v < 0 || v >= b.P.length || !b.T[v]) return { ok: false, motivo: "punta" };
    b.T[v] = null;
    if (!b.T.some(Boolean)) return rimetti(o, opz);
    applica(o, b.T);
    aggiornaIntorno(o);
    if (!opz.muto) pushStoria();
    return { ok: true, tessera: o };
  }

  // ↺ Rimetti le punte: la tessera torna com'era prima della spunta
  // (triangolo e trapezio coi loro slider, il rettangolo un rettangolo).
  function rimetti(o, opz) {
    opz = opz || {};
    if (busy()) return { ok: false, motivo: "occupato" };
    const r = record(o);
    if (!r) return { ok: false, motivo: "nonSpuntata" };
    const c = cv();
    const eraAttiva = !!(c && c.getActiveObject() === o);
    let tess = o;
    if (r.da === "rect") {
      // si rifà il rettangolo: stessi spigoli, stessa trasformazione
      cambiaPunti(o, r.punti);
      const ctr = o.getCenterPoint();
      const rect = new fabric.Rect({
        originX: "center",
        originY: "center",
        left: ctr.x,
        top: ctr.y,
        width: r.w,
        height: r.h,
        angle: o.angle || 0,
        scaleX: o.scaleX || 1,
        scaleY: o.scaleY || 1,
        flipX: !!o.flipX,
        flipY: !!o.flipY,
        skewX: o.skewX || 0,
        skewY: o.skewY || 0
      });
      if (r.tipoDi) rect.__shapeType = r.tipoDi;
      if (r.forma) rect.__shape = clona(r.forma);
      tess = sostituisci(o, rect);
      if (eraAttiva && c.getActiveObject() !== tess) c.setActiveObject(tess);
      aggiornaIntorno(tess);
      if (!opz.muto) pushStoria();
      return { ok: true, tessera: tess };
    }
    cambiaPunti(o, r.punti);
    const da = r.da, forma = clona(r.forma);
    if (da && da !== "custom") o.__shapeType = da;
    else o.__shapeType = "custom";
    if (forma) o.__shape = forma;
    else delete o.__shape;
    // triangolo e trapezio: il modello si rifà dai punti (come dopo uno
    // specchio o una scalatura), così gli slider dicono il vero
    if (o.__shapeType === "triangle") chiama("bakeTriangleScaleIntoPoints", o);
    if (o.__shapeType === "trapezoid") chiama("bakeTrapezoidScaleIntoPoints", o);
    aggiornaIntorno(o);
    if (!opz.muto) pushStoria();
    return { ok: true, tessera: tess };
  }

  // ════════════════════════════════════════════════════════════════
  //  PARTE 4 — L'INTERFACCIA (Fetta 2)
  // ════════════════════════════════════════════════════════════════
  //  La «spunta accesa» è una SESSIONE su una tessera sola: S non è null.
  //  Finisce con ✂️ di nuovo, «✔ Fine spunta», Invio, Esc, un'altra
  //  selezione, un clic fuori, un altro comando del radiale, Ctrl+Z, la
  //  tessera che sparisce dal foglio. Senza sessione il modulo non
  //  disegna niente e non ferma nessun tasto.
  const NS_SVG = "http://www.w3.org/2000/svg";
  // Sotto questa distanza a schermo i due capi si toccherebbero: le loro
  // maniglie non si mostrano (si lavora coi numeri nell'ispettore, o si
  // ingrandisce il foglio).
  const CAPI_VICINI_PX = 16;
  // Quanto deve muoversi il mouse perché un clic diventi un trascinamento.
  const SOGLIA_TRASCINA_PX = 4;

  let S = null; // { tessera, scelta, drag, raf, firma }
  let _interno = 0; // > 0 mentre un nostro comando sostituisce la tessera
  const _maniglieSalvate = new WeakMap();

  function tr(key, params, fallback) {
    try {
      if (window.i18n && typeof window.i18n.t === "function") {
        const v = window.i18n.t(key, params);
        if (typeof v === "string" && v !== key) return v;
      }
    } catch (_) {}
    let s = String(fallback != null ? fallback : key);
    if (params) s = s.replace(/\{(\w+)\}/g, (m, k) => (Object.prototype.hasOwnProperty.call(params, k) ? String(params[k]) : m));
    return s;
  }
  function avviso(key, params, fallback) {
    const f = fn("flashToast");
    if (f) {
      try {
        f(tr(key, params, fallback));
      } catch (_) {}
    }
  }
  function mm2(x) {
    return (Math.round(x * 100) / 100).toFixed(2);
  }
  function byId(id) {
    return document.getElementById(id);
  }

  // ── la tessera è bloccata dal 🔒? (la stessa regola del pulsante) ──
  function bloccata(o) {
    return !!(o && (o.__locked || o.lockMovementX));
  }
  function disegnoAcceso() {
    const c = cv();
    return !!(c && c.isDrawingMode);
  }
  // ✂️ si vede: una tessera sola, a lati dritti, libera, e niente penna.
  function siVedeForbice(o) {
    return !!(o && puoi(o).ok && !bloccata(o) && !disegnoAcceso());
  }

  // ── foglio ↔ schermo ──
  // Lo zoom di Mosaica è una trasformazione CSS sul #paper (il
  // viewportTransform resta l'identità), ma il conto passa lo stesso per
  // tutte e due: la scatola vera del canvas a schermo e il viewport.
  function aSchermo(p) {
    const c = cv();
    const r = c.upperCanvasEl.getBoundingClientRect();
    const v = c.viewportTransform || [1, 0, 0, 1, 0, 0];
    const x = v[0] * p.x + v[2] * p.y + v[4];
    const y = v[1] * p.x + v[3] * p.y + v[5];
    return { x: r.left + (x * r.width) / (c.getWidth() || 1), y: r.top + (y * r.height) / (c.getHeight() || 1) };
  }
  function aFoglio(cx, cy) {
    const c = cv();
    const r = c.upperCanvasEl.getBoundingClientRect();
    const x = ((cx - r.left) * (c.getWidth() || 1)) / (r.width || 1);
    const y = ((cy - r.top) * (c.getHeight() || 1)) / (r.height || 1);
    const v = fabric.util.invertTransform(c.viewportTransform || [1, 0, 0, 1, 0, 0]);
    return { x: v[0] * x + v[2] * y + v[4], y: v[1] * x + v[3] * y + v[5] };
  }

  // Le punte della tessera SUL FOGLIO, per le maniglie: la punta, i due
  // lati come direzioni unitarie (girate, scalate, specchiate come la
  // tessera), e dove stanno i capi del taglio.
  function puntePerManiglie(o) {
    const st = stato(o);
    if (!st.ok) return null;
    const L = o.calcTransformMatrix();
    let P, T, po;
    if (o.type === "rect") {
      P = puntiRettangolo(o);
      T = [null, null, null, null];
      po = { x: 0, y: 0 };
    } else {
      const b = base(o);
      P = b.P;
      T = b.T;
      po = { x: o.pathOffset ? o.pathOffset.x : 0, y: o.pathOffset ? o.pathOffset.y : 0 };
    }
    const marg = margPxDi();
    return st.punte.map((d, i) => {
      const an = analisiPunta(P, T, i, L, marg);
      const q = fabric.util.transformPoint(new fabric.Point(P[i].x - po.x, P[i].y - po.y), L);
      const V = { x: q.x, y: q.y };
      const ua = an.la > 0 ? { x: an.uA.x / an.la, y: an.uA.y / an.la } : { x: 0, y: 0 };
      const ub = an.lb > 0 ? { x: an.uB.x / an.lb, y: an.uB.y / an.lb } : { x: 0, y: 0 };
      const t = T[i];
      return {
        v: i,
        V: V,
        ua: ua,
        ub: ub,
        la: an.la,
        lb: an.lb,
        info: d,
        t: t,
        capoA: t ? { x: V.x + an.uA.x * t.a, y: V.y + an.uA.y * t.a } : null,
        capoB: t ? { x: V.x + an.uB.x * t.b, y: V.y + an.uB.y * t.b } : null
      };
    });
  }

  // ── le maniglie di Fabric si nascondono durante la spunta ──
  // Si usa la visibilità dei controlli (`_controlsVisibility`), che NON va
  // nel file né nelle fotografie di Ctrl+Z: `hasControls` invece sì, e
  // una fotografia presa a spunta accesa ridarebbe una tessera senza
  // maniglie. Si salva com'era e si rimette uguale.
  function nascondiManiglie(o) {
    if (!o || !o.controls) return;
    if (!_maniglieSalvate.has(o)) _maniglieSalvate.set(o, o._controlsVisibility ? Object.assign({}, o._controlsVisibility) : null);
    const v = Object.assign({}, o._controlsVisibility || {});
    Object.keys(o.controls).forEach((k) => {
      v[k] = false;
    });
    o._controlsVisibility = v;
  }
  function rimettiManiglie(o) {
    if (!o || !_maniglieSalvate.has(o)) return;
    const s = _maniglieSalvate.get(o);
    _maniglieSalvate.delete(o);
    if (s) o._controlsVisibility = s;
    else delete o._controlsVisibility;
  }

  // ── il velo delle maniglie (un SVG sopra il foglio, sotto il radiale) ──
  function velo() {
    let s = byId("spuntaOverlay");
    if (s) return s;
    s = document.createElementNS(NS_SVG, "svg");
    s.setAttribute("id", "spuntaOverlay");
    s.style.display = "none";
    document.body.appendChild(s);
    s.addEventListener("pointerdown", giu);
    // il destro sulle maniglie non apre il menu del browser
    s.addEventListener("contextmenu", (e) => e.preventDefault());
    return s;
  }
  function areaLibera() {
    const f = fn("getRadialFreeArea");
    if (f) {
      try {
        const a = f();
        if (a && a.right > a.left && a.bottom > a.top) return a;
      } catch (_) {}
    }
    return { left: 0, top: 0, right: window.innerWidth, bottom: window.innerHeight };
  }

  function disegna(forza) {
    if (!S) return;
    const s = velo();
    const o = S.tessera;
    const punte = puntePerManiglie(o);
    if (!punte) return;
    const area = areaLibera();
    const ox = area.left, oy = area.top;
    const pt = (p) => {
      const q = aSchermo(p);
      return { x: q.x - ox, y: q.y - oy };
    };
    const n2 = (x) => Math.round(x * 10) / 10;
    let h = "";
    const firma = [area.left, area.top, area.right, area.bottom, S.scelta, S.drag ? S.drag.limitato : ""];
    const tVertice = tr("spunta.handle.vertex", null, "Clic: taglia questa punta · trascina verso la tessera: scegli quanto");
    const tMezzo = tr("spunta.handle.mid", null, "Clic: scegli questo taglio · trascina: allarga o stringi (i capi tengono la proporzione)");
    const tCapo = tr("spunta.handle.capo", null, "Trascina il capo lungo il suo lato: il taglio diventa libero");
    punte.forEach((p) => {
      const V = pt(p.V);
      if (p.t) {
        const A = pt(p.capoA), B = pt(p.capoB);
        const M = { x: (A.x + B.x) / 2, y: (A.y + B.y) / 2 };
        const on = S.scelta === p.v;
        firma.push(p.v, n2(A.x), n2(A.y), n2(B.x), n2(B.y), n2(V.x), n2(V.y));
        h +=
          '<polygon class="st-via" points="' + n2(A.x) + "," + n2(A.y) + " " + n2(V.x) + "," + n2(V.y) + " " + n2(B.x) + "," + n2(B.y) + '"/>';
        h += '<line class="st-seg' + (on ? " on" : "") + '" x1="' + n2(A.x) + '" y1="' + n2(A.y) + '" x2="' + n2(B.x) + '" y2="' + n2(B.y) + '"/>';
        h += '<circle class="st-mid' + (on ? " on" : "") + '" data-k="m:' + p.v + '" cx="' + n2(M.x) + '" cy="' + n2(M.y) + '" r="7"><title>' + esc(tMezzo) + "</title></circle>";
        if (on && Math.hypot(A.x - B.x, A.y - B.y) >= CAPI_VICINI_PX) {
          h += '<rect class="st-capo st-capo-a" data-k="a:' + p.v + '" x="' + n2(A.x - 5) + '" y="' + n2(A.y - 5) + '" width="10" height="10"><title>' + esc(tCapo) + "</title></rect>";
          h += '<rect class="st-capo st-capo-b" data-k="b:' + p.v + '" x="' + n2(B.x - 5) + '" y="' + n2(B.y - 5) + '" width="10" height="10"><title>' + esc(tCapo) + "</title></rect>";
        }
        if (on && p.info.taglio) {
          // il numero sta dentro la tessera, oltre il taglio
          let dx = M.x - V.x, dy = M.y - V.y;
          const l = Math.hypot(dx, dy);
          if (l > 0.5) {
            dx /= l;
            dy /= l;
          } else {
            const b = { x: p.ua.x + p.ub.x, y: p.ua.y + p.ub.y };
            const lb = Math.hypot(b.x, b.y) || 1;
            dx = b.x / lb;
            dy = b.y / lb;
          }
          const testo = mm2(p.info.taglio.larghezzaMm) + " mm" + (S.drag && S.drag.v === p.v && S.drag.limitato ? " · " + tr("spunta.label.max", null, "max") : "");
          firma.push(testo);
          h +=
            '<text class="st-num" x="' + n2(M.x + dx * 22) + '" y="' + n2(M.y + dy * 22 + 4) + '" text-anchor="middle">' + esc(testo) + "</text>";
        }
      } else if (p.info.tagliabile) {
        firma.push(p.v, n2(V.x), n2(V.y));
        h += '<circle class="st-punta" data-k="v:' + p.v + '" cx="' + n2(V.x) + '" cy="' + n2(V.y) + '" r="7"><title>' + esc(tVertice) + "</title></circle>";
      }
    });
    const f = firma.join("|");
    if (!forza && f === S.firma) return;
    S.firma = f;
    s.style.left = area.left + "px";
    s.style.top = area.top + "px";
    s.style.width = Math.max(0, area.right - area.left) + "px";
    s.style.height = Math.max(0, area.bottom - area.top) + "px";
    s.setAttribute("width", String(Math.max(0, area.right - area.left)));
    s.setAttribute("height", String(Math.max(0, area.bottom - area.top)));
    s.innerHTML = h;
    s.style.display = "block";
  }
  function esc(x) {
    return String(x).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  }

  // Il fotogramma: le maniglie seguono la tessera (spostata, girata,
  // ingrandita, zoom, pan) e la spunta si spegne da sola se la tessera
  // non è più quella selezionata o non è più nel foglio (Ctrl+Z, Canc
  // dal radiale, un file aperto…).
  function ciclo() {
    if (!S) return;
    S.raf = requestAnimationFrame(ciclo);
    const c = cv();
    if (!c || _interno) return;
    if (c.getObjects().indexOf(S.tessera) < 0 || c.getActiveObject() !== S.tessera || disegnoAcceso() || busy()) {
      spegni();
      return;
    }
    try {
      disegna(false);
    } catch (e) {
      console.warn("[spuntaTessere] maniglie", e);
    }
  }

  // Un comando del motore dentro la sessione: se la tessera è stata
  // sostituita (il quadrato che diventa poligono, o che torna quadrato),
  // la sessione passa alla tessera nuova.
  function esegui(f) {
    let r;
    _interno++;
    try {
      r = f();
    } finally {
      _interno--;
    }
    if (S && r && r.ok && r.tessera && r.tessera !== S.tessera) {
      rimettiManiglie(S.tessera);
      S.tessera = r.tessera;
      nascondiManiglie(S.tessera);
    }
    if (S) {
      S.tessera.setCoords();
      const c = cv();
      if (c) c.requestRenderAll();
      disegna(true);
    }
    aggiornaIspettore(true);
    aggiornaForbice();
    return r;
  }

  // ── accendi / spegni ──
  function accendi(o) {
    const c = cv();
    if (!c) return false;
    o = o || c.getActiveObject();
    const p = puoi(o);
    if (!p.ok) {
      if (p.motivo === "latiCurvi") avviso("toast.spunta.curved", null, "✂️ Questa tessera ha lati curvi: niente punte da spuntare");
      else if (p.motivo === "angoliTondi") avviso("toast.spunta.rounded", null, "✂️ Gli angoli sono già arrotondati: niente punte da spuntare");
      else avviso("toast.spunta.one", null, "✂️ Seleziona una tessera sola, a lati dritti");
      return false;
    }
    if (bloccata(o)) {
      avviso("toast.spunta.locked", null, "🔒 La tessera è bloccata: sbloccala per spuntarla");
      return false;
    }
    if (busy() || disegnoAcceso()) return false;
    if (S) spegni();
    S = { tessera: o, scelta: null, drag: null, raf: 0, firma: null };
    // su una tessera già spuntata si parte dal primo taglio
    const r = record(o);
    if (r && r.tagli && r.tagli.length) S.scelta = r.tagli[0].v;
    nascondiManiglie(o);
    c.requestRenderAll();
    document.body.classList.add("st-spunta-accesa");
    disegna(true);
    S.raf = requestAnimationFrame(ciclo);
    aggiornaIspettore(true);
    aggiornaForbice();
    avviso("toast.spunta.on", null, "✂️ Spunta: clic su una punta per tagliarla, trascina per scegliere quanto. Invio o Esc per finire");
    return true;
  }

  function spegni() {
    if (!S) return false;
    const fine = S;
    S = null;
    if (fine.raf) cancelAnimationFrame(fine.raf);
    if (fine.drag) staccaTrascina();
    rimettiManiglie(fine.tessera);
    const s = byId("spuntaOverlay");
    if (s) {
      s.innerHTML = "";
      s.style.display = "none";
      s.classList.remove("st-drag");
    }
    document.body.classList.remove("st-spunta-accesa");
    const c = cv();
    if (c) c.requestRenderAll();
    aggiornaIspettore(true);
    aggiornaForbice();
    return true;
  }

  // ── il mouse sulle maniglie ──
  function giu(e) {
    if (!S || e.button !== 0) return;
    const el = e.target && e.target.closest ? e.target.closest("[data-k]") : null;
    if (!el) return;
    e.preventDefault();
    e.stopPropagation();
    const parti = String(el.getAttribute("data-k")).split(":");
    const v = Number(parti[1]);
    const punte = puntePerManiglie(S.tessera);
    const p = punte && punte[v];
    if (!p) return;
    // i capi di partenza, in px del foglio dalla punta
    const sA = p.t ? p.t.a * p.la : 1;
    const sB = p.t ? p.t.b * p.lb : 1;
    const bis = { x: p.ua.x + p.ub.x, y: p.ua.y + p.ub.y };
    const lb = Math.hypot(bis.x, bis.y) || 1;
    const bh = { x: bis.x / lb, y: bis.y / lb };
    const mezzo0 = { x: (sA * p.ua.x + sB * p.ub.x) / 2, y: (sA * p.ua.y + sB * p.ub.y) / 2 };
    S.drag = {
      tipo: parti[0],
      v: v,
      x0: e.clientX,
      y0: e.clientY,
      mosso: false,
      V: p.V,
      ua: p.ua,
      ub: p.ub,
      bh: bh,
      sA: sA,
      sB: sB,
      prof0: mezzo0.x * bh.x + mezzo0.y * bh.y, // quanto è dentro la tessera il mezzo del taglio
      larg0: Math.hypot(sA * p.ua.x - sB * p.ub.x, sA * p.ua.y - sB * p.ub.y),
      ultimo: null,
      limitato: false
    };
    window.addEventListener("pointermove", muovi, true);
    window.addEventListener("pointerup", su, true);
    window.addEventListener("pointercancel", su, true);
  }
  function staccaTrascina() {
    window.removeEventListener("pointermove", muovi, true);
    window.removeEventListener("pointerup", su, true);
    window.removeEventListener("pointercancel", su, true);
    const s = byId("spuntaOverlay");
    if (s) s.classList.remove("st-drag");
  }
  function muovi(e) {
    if (!S || !S.drag) return;
    const d = S.drag;
    e.preventDefault();
    e.stopPropagation();
    if (!d.mosso) {
      if (Math.hypot(e.clientX - d.x0, e.clientY - d.y0) < SOGLIA_TRASCINA_PX) return;
      d.mosso = true;
      S.scelta = d.v;
      const s = byId("spuntaOverlay");
      if (s) s.classList.add("st-drag");
    }
    const q = aFoglio(e.clientX, e.clientY);
    const rel = { x: q.x - d.V.x, y: q.y - d.V.y };
    let opz = null;
    if (d.tipo === "v" || d.tipo === "m") {
      // la profondità del mouse lungo la bisettrice: il taglio si scala
      // tutto insieme, quindi la larghezza va con la profondità
      const prof = rel.x * d.bh.x + rel.y * d.bh.y;
      if (d.tipo === "v" && prof <= 0) return;
      if (!(d.prof0 > 0 && d.larg0 > 0)) return;
      const mm = Math.max(LARGHEZZA_MINIMA_MM, px2mmV((d.larg0 * prof) / d.prof0));
      opz = { larghezza: mm };
    } else if (d.tipo === "a" || d.tipo === "b") {
      const u = d.tipo === "a" ? d.ua : d.ub;
      const s = Math.max(mm2pxV(0.01), rel.x * u.x + rel.y * u.y);
      opz = d.tipo === "a" ? { capi: { a: px2mmV(s), b: px2mmV(d.sB) } } : { capi: { a: px2mmV(d.sA), b: px2mmV(s) } };
    }
    if (!opz) return;
    const r = esegui(() => taglia(S.tessera, d.v, Object.assign({ muto: true }, opz)));
    if (r && r.ok) {
      d.ultimo = opz;
      d.limitato = !!r.limitato;
      if (d.tipo === "a" || d.tipo === "b") {
        // il capo fermo resta dov'era; si ricorda quello mosso
        const info = stato(S.tessera).punte[d.v].taglio;
        if (info) {
          if (d.tipo === "a") d.sA = mm2pxV(info.capoAmm);
          else d.sB = mm2pxV(info.capoBmm);
        }
      }
      disegna(true);
    }
  }
  function su(e) {
    if (!S || !S.drag) {
      staccaTrascina();
      return;
    }
    const d = S.drag;
    S.drag = null;
    staccaTrascina();
    if (e && e.preventDefault) e.preventDefault();
    if (!d.mosso) {
      // un clic
      if (d.tipo === "v") {
        const r = esegui(() => taglia(S.tessera, d.v));
        if (r && r.ok) {
          S.scelta = d.v;
          if (r.limitato) avviso("toast.spunta.limit", { mm: mm2(r.larghezzaMm) }, "✂️ Più larga non ci sta: punta di {mm} mm");
        } else if (r) motivoTaglio(r);
      } else {
        S.scelta = d.v;
      }
      disegna(true);
      aggiornaIspettore(true);
      return;
    }
    if (!d.ultimo) {
      disegna(true);
      return;
    }
    // il rilascio: una fotografia sola per tutto il trascinamento
    const r = esegui(() => taglia(S.tessera, d.v, d.ultimo));
    if (r && r.ok && r.limitato) avviso("toast.spunta.limit", { mm: mm2(r.larghezzaMm) }, "✂️ Più larga non ci sta: punta di {mm} mm");
    S && disegna(true);
  }
  function motivoTaglio(r) {
    if (r.motivo === "troppoStretta") avviso("toast.spunta.narrow", { mm: mm2(LARGHEZZA_MINIMA_MM) }, "✂️ Una punta non può essere più stretta di {mm} mm");
    else if (r.motivo === "nonCiSta" || r.motivo === "rientrante") avviso("toast.spunta.noRoom", null, "✂️ Su questa punta non c'è posto per un taglio");
  }

  // ── i comandi dell'ispettore ──
  function tesseraDiLavoro() {
    if (S) return S.tessera;
    const c = cv();
    const o = c ? c.getActiveObject() : null;
    return o && puoi(o).ok ? o : null;
  }
  function applicaLarghezza(mm) {
    if (!S || S.scelta == null) return;
    if (!(mm >= LARGHEZZA_MINIMA_MM)) {
      avviso("toast.spunta.narrow", { mm: mm2(LARGHEZZA_MINIMA_MM) }, "✂️ Una punta non può essere più stretta di {mm} mm");
      aggiornaIspettore(true);
      return;
    }
    const r = esegui(() => taglia(S.tessera, S.scelta, { larghezza: mm }));
    if (r && r.ok && r.limitato) avviso("toast.spunta.limit", { mm: mm2(r.larghezzaMm) }, "✂️ Più larga non ci sta: punta di {mm} mm");
    else if (r && !r.ok) motivoTaglio(r);
  }
  function applicaCapi(a, b) {
    if (!S || S.scelta == null) return;
    if (!(a > 0 && b > 0)) {
      aggiornaIspettore(true);
      return;
    }
    const r = esegui(() => taglia(S.tessera, S.scelta, { capi: { a: a, b: b } }));
    if (r && r.ok && r.limitato) avviso("toast.spunta.limitCapi", null, "✂️ Il capo è arrivato in fondo al lato: più in là non ci sta");
    else if (r && !r.ok) motivoTaglio(r);
  }
  function togliScelto() {
    if (!S) return false;
    const info = S.scelta != null ? stato(S.tessera).punte[S.scelta] : null;
    if (!info || !info.taglio) {
      avviso("toast.spunta.pick", null, "✂️ Scegli prima un taglio: clic sul suo pallino");
      return false;
    }
    const v = S.scelta;
    S.scelta = null;
    const r = esegui(() => togli(S.tessera, v));
    // si passa al taglio dopo, se c'è
    if (S && r && r.ok) {
      const rec = record(S.tessera);
      if (rec && rec.tagli && rec.tagli.length) S.scelta = rec.tagli[0].v;
      disegna(true);
      aggiornaIspettore(true);
    }
    return !!(r && r.ok);
  }
  function rimettiTutto() {
    const o = tesseraDiLavoro();
    if (!o || !record(o)) return false;
    if (S) S.scelta = null;
    const r = esegui(() => rimetti(o));
    if (r && r.ok) avviso("toast.spunta.restored", null, "↺ Punte rimesse: la tessera è tornata com'era");
    return !!(r && r.ok);
  }

  // ── il blocco «✂️ Spunta» dell'ispettore ──
  let _firmaIsp = null;
  function aggiornaIspettore(forza, ancheIlCampo) {
    const block = byId("inspectorSpuntaBlock");
    if (!block) return;
    const c = cv();
    const o = S ? S.tessera : c ? c.getActiveObject() : null;
    const vede = !!(o && (S || (puoi(o).ok && !disegnoAcceso())));
    if (!vede) {
      if (block.style.display !== "none") block.style.display = "none";
      _firmaIsp = null;
      return;
    }
    const st = stato(o);
    const rec = record(o);
    const nTagli = rec && rec.tagli ? rec.tagli.length : 0;
    const scelta = S && S.scelta != null && st.ok ? st.punte[S.scelta] : null;
    const tg = scelta && scelta.taglio ? scelta.taglio : null;
    const firma = [!!S, nTagli, S ? S.scelta : "", tg ? [mm2(tg.larghezzaMm), mm2(tg.capoAmm), mm2(tg.capoBmm)].join(",") : "", bloccata(o)].join("|");
    if (block.style.display === "none") block.style.display = "block";
    if (!forza && firma === _firmaIsp) return;
    _firmaIsp = firma;

    const btn = byId("spuntaBtn");
    if (btn) {
      btn.textContent = S ? tr("inspector.spunta.stop", null, "✔ Fine spunta") : tr("inspector.spunta.start", null, "✂️ Spunta le punte");
      btn.classList.toggle("st-on", !!S);
    }
    const hint = byId("spuntaHint");
    if (hint) {
      if (S) {
        hint.textContent = tg
          ? tr("inspector.spunta.hint.cut", null, "Canc toglie il taglio scelto. Invio o Esc per finire.")
          : tr("inspector.spunta.hint", null, "Clic su una punta per tagliarla, trascina per scegliere quanto. Clic su un taglio per sceglierlo.");
        hint.style.display = "";
      } else if (nTagli) {
        hint.textContent = tr("inspector.spunta.count", { n: nTagli }, "Punte tagliate: {n}");
        hint.style.display = "";
      } else {
        hint.style.display = "none";
      }
    }
    const box = byId("spuntaTaglioBox");
    if (box) box.style.display = tg ? "" : "none";
    if (tg) {
      const scrivi = (id, x) => {
        const el = byId(id);
        if (el && (ancheIlCampo || document.activeElement !== el)) el.value = mm2(x);
      };
      scrivi("spuntaLarghezza", tg.larghezzaMm);
      scrivi("spuntaCapoA", tg.capoAmm);
      scrivi("spuntaCapoB", tg.capoBmm);
    }
    const rim = byId("spuntaRimettiBtn");
    if (rim) rim.style.display = nTagli ? "" : "none";
  }

  // ── ✂️ nel radiale ──
  function forbice() {
    const r = byId("radialMenu");
    return r ? r.querySelector('[data-action="spunta"]') : null;
  }
  function aggiornaForbice() {
    const b = forbice();
    if (!b) return;
    const c = cv();
    const o = c ? c.getActiveObject() : null;
    const vede = !!S || siVedeForbice(o);
    const disp = vede ? "flex" : "none";
    if (b.style.display !== disp) b.style.display = disp;
    b.classList.toggle("st-on", !!S);
    const tip = S ? tr("radial.tooltip.spuntaStop", null, "Fine spunta (Invio)") : tr("radial.tooltip.spunta", null, "Spunta le punte della tessera");
    if (b.getAttribute("data-tooltip") !== tip) b.setAttribute("data-tooltip", tip);
  }

  // ── i rivestimenti (chiamano l'originale e poi aggiungono) ──
  function vesti(nome, dopo) {
    const orig = fn(nome);
    if (!orig || orig.__stWrapped) return false;
    const w = function () {
      const esito = orig.apply(this, arguments);
      try {
        dopo();
      } catch (e) {
        console.warn("[spuntaTessere] " + nome, e);
      }
      return esito;
    };
    // ⚠ Le marche degli altri rivestimenti passano sul nostro (trappola 320):
    // textureGhost.js e selectionTools.js riconoscono una funzione già
    // rivestita dalla loro marca (`__tgWrapped`, `__selToolsWrapped`), e
    // senza la marca un loro secondo giro la rivestirebbe di nuovo.
    Object.keys(orig).forEach((k) => {
      if (/^__\w+Wrapped$/.test(k) && w[k] === undefined) w[k] = orig[k];
    });
    w.__stWrapped = true;
    w.__stOriginal = orig;
    window[nome] = w;
    return true;
  }

  // ── il modale aperto (Esc e Invio sono suoi) ──
  function modaleAperto() {
    const L = document.querySelectorAll('div[id$="Modal"]');
    for (let i = 0; i < L.length; i++) {
      const el = L[i];
      const d = el.style.display;
      if (d === "none") continue;
      if (d) return true;
      if (getComputedStyle(el).display !== "none") return true;
    }
    return false;
  }

  // ── i tasti (in CATTURA su window, registrato al caricamento: parte
  // prima di inputMapping.js, che si aggancia 60 ms dopo il
  // DOMContentLoaded, e prima di keyboardShortcuts.js, che è sul
  // document in risalita) ──
  function tasto(e) {
    if (!S) return;
    const t = e.target;
    const tag = t && t.tagName ? t.tagName : "";
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || (t && t.isContentEditable)) return;
    if (modaleAperto()) return;
    const k = e.key || "";
    const ctrl = e.ctrlKey || e.metaKey;
    const ferma = () => {
      e.preventDefault();
      e.stopPropagation();
      if (typeof e.stopImmediatePropagation === "function") e.stopImmediatePropagation();
    };
    if (ctrl && (k.toLowerCase() === "z" || k.toLowerCase() === "y")) {
      // la spunta si spegne, poi l'annulla fa il suo lavoro
      spegni();
      return;
    }
    if (k === "Delete" || k === "Backspace") {
      ferma(); // MAI la tessera (trappola 193)
      togliScelto();
      return;
    }
    if (k === "Escape" || k === "Enter") {
      ferma();
      spegni();
      return;
    }
  }

  function inizioUI() {
    const c = cv();
    if (c && !c.__stUiBound) {
      c.__stUiBound = true;
      const via = () => {
        if (S && !_interno) spegni();
      };
      c.on("selection:cleared", via);
      const cambio = () => {
        if (S && !_interno && c.getActiveObject() !== S.tessera) spegni();
      };
      c.on("selection:created", cambio);
      c.on("selection:updated", cambio);
      c.on("object:removed", (e) => {
        if (S && !_interno && e && e.target === S.tessera) spegni();
      });
    }

    const r = byId("radialMenu");
    if (r && !r.__stBound) {
      r.__stBound = true;
      r.addEventListener(
        "click",
        (e) => {
          const btn = e.target && e.target.closest ? e.target.closest(".radial-btn") : null;
          if (!btn) return;
          const act = btn.getAttribute("data-action") || "";
          if (act !== "spunta") {
            // un altro comando: prima si spegne la spunta, poi lui lavora
            if (S) spegni();
            return;
          }
          e.preventDefault();
          e.stopPropagation();
          if (typeof e.stopImmediatePropagation === "function") e.stopImmediatePropagation();
          if (S) spegni();
          else accendi();
        },
        true
      );
      // ↻ e ⤢ partono dal mousedown, non dal click
      r.addEventListener(
        "mousedown",
        (e) => {
          const btn = e.target && e.target.closest ? e.target.closest(".radial-btn") : null;
          if (!btn || !S) return;
          if ((btn.getAttribute("data-action") || "") !== "spunta") spegni();
        },
        true
      );
    }

    const btn = byId("spuntaBtn");
    if (btn && !btn.__stBound) {
      btn.__stBound = true;
      btn.addEventListener("click", () => {
        btn.blur();
        if (S) spegni();
        else accendi();
      });
    }
    const rim = byId("spuntaRimettiBtn");
    if (rim && !rim.__stBound) {
      rim.__stBound = true;
      rim.addEventListener("click", () => {
        rim.blur();
        rimettiTutto();
      });
    }
    const tog = byId("spuntaTogliBtn");
    if (tog && !tog.__stBound) {
      tog.__stBound = true;
      tog.addEventListener("click", () => {
        tog.blur();
        togliScelto();
      });
    }
    // i numeri: Invio (o uscire dal campo) applica, Esc rimette com'era
    const campo = (id, applica) => {
      const el = byId(id);
      if (!el || el.__stBound) return;
      el.__stBound = true;
      el.addEventListener("change", () => {
        const x = parseFloat(String(el.value).replace(",", "."));
        if (isFinite(x)) applica(x);
        else aggiornaIspettore(true);
      });
      el.addEventListener("keydown", (e) => {
        if (e.key === "Escape") {
          // prima il numero di prima, poi fuori dal campo (trappola 328)
          e.preventDefault();
          e.stopPropagation();
          aggiornaIspettore(true, true);
          el.blur();
        } else if (e.key === "Enter") {
          e.preventDefault();
          el.blur(); // il blur fa partire «change» se il numero è cambiato
        }
      });
    };
    campo("spuntaLarghezza", (x) => applicaLarghezza(x));
    campo("spuntaCapoA", (x) => {
      const t = S && S.scelta != null ? stato(S.tessera).punte[S.scelta].taglio : null;
      if (t) applicaCapi(x, t.capoBmm);
    });
    campo("spuntaCapoB", (x) => {
      const t = S && S.scelta != null ? stato(S.tessera).punte[S.scelta].taglio : null;
      if (t) applicaCapi(t.capoAmm, x);
    });

    // chi si vede nel radiale: lo decide renderer.js in
    // updateRadialSliceVisibility, PRIMA di contare i pulsanti per il
    // raggio (selezione creata / cambiata / tolta); ✂️ si accoda lì
    vesti("updateRadialSliceVisibility", aggiornaForbice);
    // il blocco dell'ispettore si rifà con quello della grana (selezione,
    // spostamento, annulla), come il blocco 👻 di textureGhost.js
    // (dalla Fetta 3 anche il blocco «◠ Curva» dei settori)
    vesti("updateTextureGrainPanel", () => {
      aggiornaIspettore(false);
      aggiornaCurva(false);
    });
    aggiornaForbice();
    aggiornaIspettore(true);
    inizioCurva();
  }

  // ════════════════════════════════════════════════════════════════
  //  PARTE 5 — IL SETTORE CHE SI SCHIACCIA (Fetta 3)
  // ════════════════════════════════════════════════════════════════
  //  Mirko (B4): sui settori del cerchio e dell'ovale «schiacciare il
  //  lato curvo lasciando inalterati i due lati dritti». B5 = a: ogni
  //  punto dell'arco scende verso la corda in proporzione (la regola sta
  //  in CircleSectorModel.js, che renderer.js usa anche alla riapertura).
  //  Il numero è la CURVA: 100 % = l'arco di sempre, 0 % = lato dritto.
  //  La FRECCIA è quanto è alta la curva sopra la corda, in mm sul foglio.
  //  La tessera resta lei (stesso oggetto: colore, famiglia, texture,
  //  posizione, rotazione, livello): cambia solo il suo path.
  //  Un passo di Ctrl+Z per scelta; il cursore trascinato = un passo.

  function classeSettore() {
    try {
      // `class` di primo livello: sta nello scope globale, non su window
      if (typeof CircleSectorModel !== "undefined") return CircleSectorModel;
    } catch (_) {}
    return null;
  }

  // Si può schiacciare? { ok, motivo }
  function puoiCurva(o) {
    if (!o) return { ok: false, motivo: "nessuna" };
    if (o.type === "activeSelection" || o.type === "group") return { ok: false, motivo: "piuDiUna" };
    if (o.group) return { ok: false, motivo: "inGruppo" };
    if (o.type !== "path" || o.__shapeType !== "sector" || !o.__shape || typeof o.__shape !== "object") return { ok: false, motivo: "nonSettore" };
    if (!classeSettore() || !Array.isArray(o.path) || typeof o._setPath !== "function") return { ok: false, motivo: "forma" };
    if (!(Number(o.__shape.sweepDeg) <= 180 + 1e-9)) return { ok: false, motivo: "oltre180" };
    return { ok: true };
  }

  // L'ultimo punto del path (prima della Z): il secondo estremo.
  function ultimoPunto(path) {
    for (let i = path.length - 1; i >= 0; i--) {
      const s = path[i];
      if (s && s.length >= 3 && s[0] !== "Z" && s[0] !== "z") return { x: s[s.length - 2], y: s[s.length - 1] };
    }
    return null;
  }

  // Il modello del settore com'è DISEGNATO adesso. I raggi vengono da
  // __shape in mm; se la calibrazione è cambiata dopo la nascita del
  // settore, i mm di oggi non sono più i px del suo path: si riportano
  // alla misura vera leggendo i due estremi del path (trappola 326). Così
  // schiacciando la tessera non cambia grandezza.
  function modelloDi(o) {
    const C = classeSettore();
    const m = C.fromJSON(o.__shape, mm2pxV);
    try {
      const a = o.path[1];
      const b = ultimoPunto(o.path);
      if (a && a[0] === "L" && b) {
        const e = m.estremi(0, 0);
        const veri = Math.hypot(a[1], a[2]) + Math.hypot(b.x, b.y);
        const suoi = Math.hypot(e.x1, e.y1) + Math.hypot(e.x2, e.y2);
        if (suoi > 0 && veri > 0 && Math.abs(veri - suoi) > 0.05) {
          const k = veri / suoi;
          m.radiusX *= k;
          m.radiusY *= k;
          m.inizio *= k;
          m.fine *= k;
          m.__k = k;
        }
      }
    } catch (_) {}
    if (!m.__k) m.__k = 1;
    return m;
  }

  // La FRECCIA vera sul foglio di un path di settore (in px del canvas):
  // la distanza più grande dei punti del lato curvo dalla corda, misurata
  // sui punti che Fabric disegna (le Bézier del path), passati per la
  // parte lineare della matrice della tessera (rotazione, scala anche
  // storta, specchio: trappola 314). Misurata e non calcolata dal modello
  // perché i mezzi cerchi di ◔ hanno l'arco un po' scostato da quello
  // ideale (trappola 327): il numero dell'ispettore è quello del laser.
  const CAMPIONI_FRECCIA = 96;
  function frecciaPx(o, path) {
    const M = o.calcTransformMatrix();
    const lin = (x, y) => ({ x: M[0] * x + M[2] * y, y: M[1] * x + M[3] * y });
    const a = path[1];
    const b = ultimoPunto(path);
    if (!a || !b) return 0;
    const A = lin(a[1], a[2]),
      B = lin(b.x, b.y);
    const L = Math.hypot(B.x - A.x, B.y - A.y);
    if (!(L > 0)) return 0;
    let h = 0,
      cur = null;
    for (const sg of path) {
      if (sg[0] === "M" || sg[0] === "L") cur = { x: sg[1], y: sg[2] };
      else if (sg[0] === "C" && cur) {
        for (let i = 1; i <= CAMPIONI_FRECCIA; i++) {
          const t = i / CAMPIONI_FRECCIA,
            u = 1 - t;
          const x = u * u * u * cur.x + 3 * u * u * t * sg[1] + 3 * u * t * t * sg[3] + t * t * t * sg[5];
          const y = u * u * u * cur.y + 3 * u * u * t * sg[2] + 3 * u * t * t * sg[4] + t * t * t * sg[6];
          const P = lin(x, y);
          h = Math.max(h, Math.abs((B.x - A.x) * (P.y - A.y) - (B.y - A.y) * (P.x - A.x)) / L);
        }
        cur = { x: sg[5], y: sg[6] };
      } else if (sg.length >= 3 && sg[0] !== "Z" && sg[0] !== "z") cur = { x: sg[sg.length - 2], y: sg[sg.length - 1] };
    }
    return h;
  }
  function pathDi(d) {
    return fabric.util.makePathSimpler(fabric.util.parsePath(d));
  }

  function curvaDi(o) {
    const c = o && o.__shape ? Number(o.__shape.curva) : NaN;
    return isFinite(c) ? Math.max(0, Math.min(1, c)) : 1;
  }

  // I tratti dritti sul foglio: quanto vale 1 px del settore lungo la
  // tangente di ogni capo (la matrice della tessera: scala anche storta,
  // rotazione, specchio — trappola 314), e i segmenti capo → T.
  function trattiSulFoglio(o, m) {
    const tg = m.curvaUsata >= 0.001 ? m.tangenti(0, 0) : null;
    if (!tg) return null;
    const M = o.calcTransformMatrix();
    const lin = (d) => Math.hypot(M[0] * d.x + M[2] * d.y, M[1] * d.x + M[3] * d.y);
    const lu = Math.hypot(tg.u.x, tg.u.y),
      lv = Math.hypot(tg.v.x, tg.v.y);
    if (!(lu > 0 && lv > 0)) return null;
    // su, sv: px del foglio per 1 px del settore, lungo u e lungo v
    return { tg, lu, lv, su: lin(tg.u) / lu, sv: lin(tg.v) / lv };
  }

  // Lo stato del settore: { ok, curva (0..1), percento, frecciaMm,
  // frecciaInteraMm, ampiezza, conTratti, inizioMm, fineMm, inizioMaxMm,
  // fineMaxMm } o { ok:false, motivo }. I tratti in mm VERI sul foglio,
  // quelli che il path disegna (fermati al 99 % del segmento capo → T).
  function statoCurva(o) {
    const p = puoiCurva(o);
    if (!p.ok) return p;
    const m = modelloDi(o);
    const c = curvaDi(o);
    const ft = trattiSulFoglio(o, m);
    const fz = m.frazioni(0, 0);
    const MAX = m.constructor.TRATTO_MASSIMO;
    const out = {
      ok: true,
      curva: c,
      percento: Math.round(c * 1000) / 10,
      ampiezza: Number(o.__shape.sweepDeg),
      conTratti: !!ft && m.conTratti,
      inizioMm: ft ? px2mmV(fz.f1 * ft.lu * ft.su) : 0,
      fineMm: ft ? px2mmV(fz.f2 * ft.lv * ft.sv) : 0,
      inizioMaxMm: ft ? px2mmV(MAX * ft.lu * ft.su) : 0,
      fineMaxMm: ft ? px2mmV(MAX * ft.lv * ft.sv) : 0
    };
    m.curva = 1;
    m.inizio = 0;
    m.fine = 0;
    out.frecciaInteraMm = px2mmV(frecciaPx(o, pathDi(m.getPath(0, 0))));
    out.frecciaMm = c >= 1 && !(out.inizioMm > 0 || out.fineMm > 0) ? out.frecciaInteraMm : px2mmV(frecciaPx(o, o.path));
    return out;
  }

  // Cambia il path SENZA spostare niente sul foglio: il centro del
  // cerchio e i due estremi restano dov'erano. Come cambiaPunti per i
  // poligoni (trappola 312): Fabric ricentra il path sulla scatola nuova,
  // e il centro va spostato della differenza, girata e scalata.
  function cambiaPath(o, d) {
    const M = o.calcTransformMatrix();
    const po = { x: o.pathOffset ? o.pathOffset.x : 0, y: o.pathOffset ? o.pathOffset.y : 0 };
    o._setPath(d, { left: o.left, top: o.top });
    const c = fabric.util.transformPoint(new fabric.Point(o.pathOffset.x - po.x, o.pathOffset.y - po.y), M);
    o.setPositionByOrigin(c, "center", "center");
    o.dirty = true;
    if (o.group) o.group.dirty = true;
    o.setCoords();
  }

  // Cambia il settore: opz.curva (0..1), opz.inizioMm / opz.fineMm (il
  // tratto dritto dal capo giallo / rosa, in mm VERI sul foglio, 0 =
  // nessuno). Quello che non si passa resta com'è. muto: niente voce di
  // Ctrl+Z (il cursore trascinato: la voce la fa il rilascio).
  // Restituisce { ok, tessera, curva, inizioMm, fineMm, limitato } o
  // { ok:false, motivo }. Un tratto più lungo del possibile si ferma al
  // massimo (limitato = true).
  function settore(o, cosa, opz) {
    opz = opz || {};
    cosa = cosa || {};
    const p = puoiCurva(o);
    if (!p.ok) return p;
    // Cambiando solo la curva, i tratti dritti restano lunghi uguali SUL
    // FOGLIO: le tangenti dell'arco schiacciato girano, e su una tessera
    // scalata storta la stessa lunghezza del settore varrebbe un'altra
    // misura (trappola 314). Si ripassano i mm di adesso.
    if (cosa.curva !== undefined && cosa.inizioMm === undefined && cosa.fineMm === undefined) {
      const st0 = statoCurva(o);
      if (st0.ok && st0.inizioMm > 0) cosa = Object.assign({}, cosa, { inizioMm: st0.inizioMm });
      if (st0.ok && st0.fineMm > 0) cosa = Object.assign({}, cosa, { fineMm: st0.fineMm });
    }
    const m = modelloDi(o);
    const k = m.__k || 1;
    const sh0 = o.__shape;
    let c = curvaDi(o);
    if (cosa.curva !== undefined) {
      c = Number(cosa.curva);
      if (!isFinite(c)) return { ok: false, motivo: "numero" };
      c = Math.round(Math.max(0, Math.min(1, c)) * 10000) / 10000;
    }
    m.curva = c;
    let limitato = false;
    const tratto = (mm, quale) => {
      const x = Number(mm);
      if (!isFinite(x)) return null;
      if (x <= 0) return 0;
      const ft = trattiSulFoglio(o, m);
      if (!ft || !m.conTratti) return null;
      const lung = quale === "inizio" ? ft.lu : ft.lv;
      const scala = quale === "inizio" ? ft.su : ft.sv;
      let loc = mm2pxV(x) / scala; // px del settore
      const max = m.constructor.TRATTO_MASSIMO * lung;
      if (loc > max + 1e-9) {
        loc = max;
        limitato = true;
      }
      return loc;
    };
    let ini = m.inizio,
      fin = m.fine;
    if (cosa.inizioMm !== undefined) {
      const v = tratto(cosa.inizioMm, "inizio");
      if (v === null) return { ok: false, motivo: m.conTratti ? "numero" : "tratti" };
      ini = v;
    }
    if (cosa.fineMm !== undefined) {
      const v = tratto(cosa.fineMm, "fine");
      if (v === null) return { ok: false, motivo: m.conTratti ? "numero" : "tratti" };
      fin = v;
    }
    m.inizio = ini;
    m.fine = fin;
    // nel file come i raggi: mm del settore (con la calibrazione di quando è nato, trappola 326)
    const mmFile = (px) => px2mmV(px / k);
    const sh = Object.assign({}, sh0); // ⚠ si CONSERVA tutto (__tgGhost: T5 di Texture Ghost)
    if (c >= 1) delete sh.curva;
    else sh.curva = c;
    if (ini > 0) sh.inizio_mm = mmFile(ini);
    else delete sh.inizio_mm;
    if (fin > 0) sh.fine_mm = mmFile(fin);
    else delete sh.fine_mm;
    const cambia = ["curva", "inizio_mm", "fine_mm"].some((q) => sh[q] !== sh0[q]);
    if (cambia) {
      cambiaPath(o, m.getPath(0, 0));
      o.__shape = sh;
      aggiornaIntorno(o);
      if (!opz.muto) pushStoria();
    }
    const st = statoCurva(o);
    return { ok: true, tessera: o, curva: c, inizioMm: st.inizioMm, fineMm: st.fineMm, frecciaMm: st.frecciaMm, limitato };
  }

  // ◠ Schiaccia il lato curvo: curva da 0 (dritto) a 1 (arco intero).
  function curva(o, valore, opz) {
    return settore(o, { curva: valore }, opz);
  }

  // Inizio e fine curvatura: il tratto dritto dai due capi, in mm sul
  // foglio (Mirko, 02/11/2026). { inizio, fine }: quello che non c'è resta.
  function tratti(o, t, opz) {
    t = t || {};
    const cosa = {};
    if (t.inizio !== undefined) cosa.inizioMm = t.inizio;
    if (t.fine !== undefined) cosa.fineMm = t.fine;
    return settore(o, cosa, opz);
  }

  // ── il blocco «◠ Curva» dell'ispettore ──
  let _firmaCurva = null;
  let _curvaPartenza = null; // la curva quando è cominciato il trascinamento del cursore
  function settoreSelezionato() {
    const c = cv();
    const o = c ? c.getActiveObject() : null;
    return o && puoiCurva(o).ok && !disegnoAcceso() ? o : null;
  }
  function aggiornaCurva(forza, ancheIlCampo) {
    const block = byId("inspectorCurvaBlock");
    if (!block) return;
    const o = settoreSelezionato();
    if (!o) {
      if (block.style.display !== "none") block.style.display = "none";
      _firmaCurva = null;
      return;
    }
    if (block.style.display === "none") block.style.display = "block";
    const st = statoCurva(o);
    const firma = [st.percento, mm2(st.inizioMm), mm2(st.fineMm), mm2(st.inizioMaxMm), mm2(st.fineMaxMm), st.conTratti, bloccata(o)].join("|");
    if (!_rafMarche) _rafMarche = requestAnimationFrame(marche);
    if (!forza && firma === _firmaCurva) return;
    _firmaCurva = firma;
    const sl = byId("curvaSlider");
    if (sl && (ancheIlCampo || document.activeElement !== sl)) sl.value = String(Math.round(st.percento));
    if (sl) sl.disabled = bloccata(o);
    const scrivi = (id, x) => {
      const el = byId(id);
      if (el && (ancheIlCampo || document.activeElement !== el)) el.value = x;
      if (el) el.disabled = bloccata(o);
    };
    scrivi("curvaPercento", String(Math.round(st.percento)));
    scrivi("curvaInizio", mm2(st.inizioMm));
    scrivi("curvaFine", mm2(st.fineMm));
    // i tratti: solo dove le tangenti dei capi si incontrano
    ["curvaInizio", "curvaFine"].forEach((id) => {
      const el = byId(id);
      if (el && !st.conTratti) el.disabled = true;
    });
    const hint = byId("curvaTrattiHint");
    if (hint) {
      hint.textContent = st.conTratti
        ? tr("inspector.curva.max", { a: mm2(st.inizioMaxMm), b: mm2(st.fineMaxMm) }, "Al massimo {a} / {b} mm")
        : tr("inspector.curva.noStraight", null, "Inizio e fine curvatura: solo sui settori più stretti di mezzo cerchio e con la curva sopra 0 %");
    }
    const rim = byId("curvaInteraBtn");
    if (rim) rim.style.display = (st.curva < 1 || st.inizioMm > 0 || st.fineMm > 0) && !bloccata(o) ? "" : "none";
  }

  // ── i due pallini sul foglio: giallo = dove COMINCIA la curva (dal capo
  // dell'«Inizio curvatura»), rosa = dove FINISCE (verso il capo della
  // «Fine»). Senza tratti dritti stanno sui due capi. Si TRASCINANO lungo
  // la tangente del loro capo, come i capi della spunta (Mirko, 03/11):
  // il tratto dritto si allunga o si accorcia, un trascinamento = una voce
  // di Ctrl+Z. Un SVG sopra il foglio: lui non prende il mouse, i pallini
  // sì (solo dove i tratti si possono fare). Si ridisegna a ogni
  // fotogramma finché il blocco «◠ Curva» si vede ──
  let _rafMarche = null;
  let _dragCurva = null;
  function veloCurva() {
    let v = byId("curvaOverlay");
    if (v) return v;
    v = document.createElementNS(NS_SVG, "svg");
    v.setAttribute("id", "curvaOverlay");
    v.style.cssText = "position:fixed;left:0;top:0;width:0;height:0;pointer-events:none;z-index:9996;overflow:hidden;display:none";
    ["a", "b"].forEach((k) => {
      const c = document.createElementNS(NS_SVG, "circle");
      c.setAttribute("data-capo", k);
      c.setAttribute("r", "6");
      c.setAttribute("fill", k === "a" ? "#ffd400" : "#ff4fd8");
      c.setAttribute("stroke", "#222");
      c.setAttribute("stroke-width", "1.5");
      const t = document.createElementNS(NS_SVG, "title");
      t.textContent = tr("curva.handle", null, "Trascina lungo il lato: qui comincia (giallo) o finisce (rosa) la curva");
      c.appendChild(t);
      c.addEventListener("pointerdown", curvaGiu);
      c.addEventListener("contextmenu", (e) => e.preventDefault());
      v.appendChild(c);
    });
    document.body.appendChild(v);
    return v;
  }
  // un punto del sistema del settore, sul foglio
  function settoreSulFoglio(o) {
    const M = o.calcTransformMatrix();
    return (p) => {
      const q = fabric.util.transformPoint(new fabric.Point(p.x - o.pathOffset.x, p.y - o.pathOffset.y), M);
      return { x: q.x, y: q.y };
    };
  }
  // dove comincia e dove finisce la curva, sul foglio; e se i tratti si fanno
  function capiCurva(o) {
    const m = modelloDi(o);
    const cd = m.curvaDisegnata(0, 0);
    const w = settoreSulFoglio(o);
    const ft = m.conTratti ? trattiSulFoglio(o, m) : null;
    return { a: w(cd.B), b: w(cd.C), mobili: !!ft, m: m, ft: ft, w: w };
  }
  function marche() {
    _rafMarche = null;
    const v = veloCurva();
    const block = byId("inspectorCurvaBlock");
    const o = block && block.style.display !== "none" ? settoreSelezionato() : _dragCurva ? _dragCurva.o : null;
    const capi = o && !busy() ? capiCurva(o) : null;
    if (!capi) {
      if (v.style.display !== "none") v.style.display = "none";
      return;
    }
    const ar = areaLibera();
    v.style.display = "block";
    v.style.left = ar.left + "px";
    v.style.top = ar.top + "px";
    v.style.width = ar.right - ar.left + "px";
    v.style.height = ar.bottom - ar.top + "px";
    const mobili = capi.mobili && !bloccata(o);
    ["a", "b"].forEach((k) => {
      const p = aSchermo(capi[k]);
      const c = v.querySelector('[data-capo="' + k + '"]');
      c.setAttribute("cx", (p.x - ar.left).toFixed(1));
      c.setAttribute("cy", (p.y - ar.top).toFixed(1));
      c.style.pointerEvents = mobili ? "all" : "none";
      c.style.cursor = _dragCurva ? "grabbing" : "grab";
    });
    _rafMarche = requestAnimationFrame(marche);
  }

  // ── il trascinamento di un pallino ──
  function curvaGiu(e) {
    if (e.button !== 0 || _dragCurva) return;
    const k = e.currentTarget && e.currentTarget.getAttribute("data-capo");
    const o = settoreSelezionato();
    if (!o || (k !== "a" && k !== "b")) return;
    e.preventDefault();
    e.stopPropagation();
    if (bloccata(o)) {
      avviso("toast.curva.locked", null, "🔒 La tessera è bloccata: sbloccala per schiacciarla");
      return;
    }
    const capi = capiCurva(o);
    if (!capi.mobili) return;
    const m = capi.m;
    const e0 = m.estremi(0, 0);
    // il capo e lo spigolo delle tangenti T, sul foglio: il pallino scorre
    // sul segmento capo → T (fino al 99 %, come il campo)
    const E = capi.w(k === "a" ? { x: e0.x1, y: e0.y1 } : { x: e0.x2, y: e0.y2 });
    const T = capi.w(capi.ft.tg.T);
    const L = Math.hypot(T.x - E.x, T.y - E.y);
    if (!(L > 0)) return;
    const sh = o.__shape;
    _dragCurva = {
      o: o,
      k: k,
      E: E,
      d: { x: (T.x - E.x) / L, y: (T.y - E.y) / L },
      max: m.constructor.TRATTO_MASSIMO * L,
      x0: e.clientX,
      y0: e.clientY,
      mosso: false,
      prima: [sh.curva, sh.inizio_mm, sh.fine_mm].join("|")
    };
    // durante il trascinamento il velo prende il mouse: niente Fabric e
    // niente pan sotto (come #spuntaOverlay.st-drag)
    const v = veloCurva();
    v.style.pointerEvents = "auto";
    v.style.cursor = "grabbing";
    window.addEventListener("pointermove", curvaMuovi, true);
    window.addEventListener("pointerup", curvaSu, true);
    window.addEventListener("pointercancel", curvaSu, true);
  }
  function curvaStacca() {
    window.removeEventListener("pointermove", curvaMuovi, true);
    window.removeEventListener("pointerup", curvaSu, true);
    window.removeEventListener("pointercancel", curvaSu, true);
    const v = byId("curvaOverlay");
    if (v) {
      v.style.pointerEvents = "none";
      v.style.cursor = "";
    }
  }
  function curvaMuovi(e) {
    const d = _dragCurva;
    if (!d) return;
    e.preventDefault();
    e.stopPropagation();
    if (!d.mosso) {
      if (Math.hypot(e.clientX - d.x0, e.clientY - d.y0) < SOGLIA_TRASCINA_PX) return;
      d.mosso = true;
    }
    const q = aFoglio(e.clientX, e.clientY);
    // quanto è avanti il mouse lungo la tangente, dal capo (px del foglio)
    const t = Math.max(0, Math.min(d.max, (q.x - d.E.x) * d.d.x + (q.y - d.E.y) * d.d.y));
    const mm = t < mm2pxV(0.05) ? 0 : px2mmV(t); // sotto 0,05 mm: niente tratto
    tratti(d.o, d.k === "a" ? { inizio: mm } : { fine: mm }, { muto: true });
    aggiornaCurva(false);
  }
  function curvaSu(e) {
    const d = _dragCurva;
    _dragCurva = null;
    curvaStacca();
    if (!d) return;
    if (e && e.preventDefault) e.preventDefault();
    // il rilascio: una fotografia sola per tutto il trascinamento
    const sh = d.o.__shape || {};
    if (d.mosso && [sh.curva, sh.inizio_mm, sh.fine_mm].join("|") !== d.prima) pushStoria();
    aggiornaCurva(true);
  }

  // Un comando dall'ispettore: la tessera bloccata dal 🔒 non si tocca.
  function curvaDaIspettore(f) {
    const o = settoreSelezionato();
    if (!o) return;
    if (bloccata(o)) {
      avviso("toast.curva.locked", null, "🔒 La tessera è bloccata: sbloccala per schiacciarla");
      aggiornaCurva(true);
      return;
    }
    f(o);
    aggiornaCurva(true);
  }

  function inizioCurva() {
    const sl = byId("curvaSlider");
    if (sl && !sl.__stBound) {
      sl.__stBound = true;
      // trascinando: anteprima muta; al rilascio («change») una voce sola
      sl.addEventListener("input", () => {
        const o = settoreSelezionato();
        if (!o || bloccata(o)) return;
        if (_curvaPartenza == null) _curvaPartenza = curvaDi(o);
        curva(o, Number(sl.value) / 100, { muto: true });
        aggiornaCurva(false);
      });
      sl.addEventListener("change", () => {
        const da = _curvaPartenza;
        _curvaPartenza = null;
        curvaDaIspettore((o) => {
          const v = Number(sl.value) / 100;
          // senza «input» prima (un clic secco su certi sistemi): il comando intero
          if (da == null) return curva(o, v);
          curva(o, v, { muto: true });
          if (curvaDi(o) !== da) pushStoria();
        });
      });
    }
    const campo = (id, applica) => {
      const el = byId(id);
      if (!el || el.__stBound) return;
      el.__stBound = true;
      el.addEventListener("change", () => {
        const x = parseFloat(String(el.value).replace(",", "."));
        if (isFinite(x)) curvaDaIspettore((o) => applica(o, x));
        else aggiornaCurva(true);
      });
      el.addEventListener("keydown", (e) => {
        if (e.key === "Escape") {
          // prima si rimette il numero di prima, POI si esce dal campo: il
          // blur con un numero cambiato farebbe partire «change» (trappola 328)
          e.preventDefault();
          e.stopPropagation();
          aggiornaCurva(true, true);
          el.blur();
        } else if (e.key === "Enter") {
          e.preventDefault();
          el.blur(); // il blur fa partire «change» se il numero è cambiato
        }
      });
    };
    campo("curvaPercento", (o, x) => curva(o, x / 100));
    const conAvviso = (r, quale) => {
      if (r && r.ok && r.limitato) avviso("toast.curva.limit", { mm: mm2(r[quale]) }, "◠ Più lungo non ci sta: {mm} mm");
      return r;
    };
    campo("curvaInizio", (o, x) => conAvviso(tratti(o, { inizio: x }), "inizioMm"));
    campo("curvaFine", (o, x) => conAvviso(tratti(o, { fine: x }), "fineMm"));
    const btn = byId("curvaInteraBtn");
    if (btn && !btn.__stBound) {
      btn.__stBound = true;
      btn.addEventListener("click", () => {
        btn.blur();
        curvaDaIspettore((o) => settore(o, { curva: 1, inizioMm: 0, fineMm: 0 }));
      });
    }
    aggiornaCurva(true);
  }

  // ⚠ Subito, non al DOMContentLoaded: radiale, ispettore e canvas ci sono
  // già (gli script stanno in fondo alla pagina), e così l'ascoltatore in
  // cattura sul radiale parte PRIMA di quello di selectionTools.js (che si
  // aggancia al DOMContentLoaded e ferma le sue azioni): anche ⬚ ◨ ⬓
  // spengono prima la spunta. Il secondo giro al DOMContentLoaded non
  // rifà niente (ogni pezzo ha la sua guardia) e serve solo se qualcosa
  // mancava ancora.
  window.addEventListener("keydown", tasto, true);
  inizioUI();
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", inizioUI);

  window.spuntaTessere = {
    version: VERSION,
    puoi: puoi,
    stato: stato,
    taglia: taglia,
    togli: togli,
    rimetti: rimetti,
    larghezzaDiPartenza: larghezzaDiPartenza,
    // il settore che si schiaccia (Fetta 3)
    puoiCurva: puoiCurva,
    statoCurva: statoCurva,
    curva: curva,
    tratti: tratti,
    settore: settore,
    // la spunta accesa (Fetta 2): l'interfaccia la usa così, il banco pure
    ui: {
      accendi: accendi,
      spegni: spegni,
      accesa: () => !!S,
      tessera: () => (S ? S.tessera : null),
      scelta: () => (S ? S.scelta : null),
      scegli: (v) => {
        if (!S) return false;
        S.scelta = Number.isInteger(v) ? v : null;
        disegna(true);
        aggiornaIspettore(true);
        return true;
      },
      larghezza: applicaLarghezza,
      capi: applicaCapi,
      togliScelto: togliScelto,
      rimettiTutto: rimettiTutto,
      maniglie: puntePerManiglie,
      aSchermo: aSchermo,
      aFoglio: aFoglio,
      siVedeForbice: siVedeForbice
    },
    numeri: {
      LARGHEZZA_PARTENZA_MM: LARGHEZZA_PARTENZA_MM,
      LARGHEZZA_MINIMA_MM: LARGHEZZA_MINIMA_MM,
      LATO_CHE_RESTA_MM: LATO_CHE_RESTA_MM,
      ANGOLO_MASSIMO_GRADI: ANGOLO_MASSIMO_GRADI,
      CAPI_VICINI_PX: CAPI_VICINI_PX,
      SOGLIA_TRASCINA_PX: SOGLIA_TRASCINA_PX
    },
    // la geometria pura, per il banco
    __test: {
      puntiSpuntati: puntiSpuntati,
      analisiPunta: analisiPunta,
      taglioPerLarghezza: taglioPerLarghezza,
      larghezzaPx: larghezzaPx,
      cambiaPunti: cambiaPunti,
      cambiaPath: cambiaPath,
      modelloDi: modelloDi,
      record: record
    }
  };

  console.log("[spuntaTessere] pronto (Fetta " + VERSION + ")");
})();
