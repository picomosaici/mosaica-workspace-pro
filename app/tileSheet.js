// ============================================================
//  tileSheet.js — Mosaica Workspace Pro
//  «LA TAVOLA DELLE TESSERE» — Fetta 1: il motore e gli SVG per il laser
//                               Fetta 2: la compensazione del taglio e le linguette
//                               Fetta 3: il PDF per il banco (cantiere «La Bottega»)
//                               Fetta 4: la distinta in CSV (cantiere «La Bottega»)
// ------------------------------------------------------------
//  COSA FA
//  -------
//  Dal pulsante «🧩 Tavola delle tessere» del menu Esporta produce,
//  in UNA cartella scelta una volta sola, un file SVG per ogni
//  FAMIGLIA di colore (tutti i viola insieme, tutti i rosa insieme…).
//  Dentro ogni file le tessere stanno in MATRICI: una matrice per
//  ogni colore esatto, le tessere con la rotazione azzerata, la base
//  orizzontale, in righe allineate, a 2 mm l'una dall'altra.
//  Il foglio è un A4 VERO in millimetri. Se una famiglia non ci sta
//  in un A4, continua in un secondo file (…_viola_2.svg).
//
//  LA DECISIONE PORTANTE: SUL CANVAS NON SI MUOVE NIENTE
//  -----------------------------------------------------
//  Il modulo LEGGE e basta. Nessun left/top/angle cambia, nessun
//  clone, nessuna voce di storia, nessun marcatore __ nuovo sugli
//  oggetti. La rotazione si azzera con la MATEMATICA, sui numeri,
//  non sugli oggetti. (L'unica cosa che Fabric scrive da sé è la sua
//  cache interna delle matrici, la stessa che scrive a ogni disegno:
//  non è serializzata e non cambia nulla.)
//
//  L'SVG VA AL LASER, E IL LASER TAGLIA TUTTO QUELLO CHE TROVA
//  -----------------------------------------------------------
//  Quindi il file è NUDO: soltanto <svg>, <g> e <path>. Nessuna
//  scritta, nessuna cornice, nessuna linea di separazione (trappola
//  183). Le matrici si separano con lo spazio vuoto. Tutte le
//  informazioni vivranno nel PDF (Fetta 3).
//
//  IL CONTORNO LO CALCOLA QUESTO MODULO, NON FABRIC
//  -------------------------------------------------
//  Ogni tessera diventa una lista di segmenti dritti e curve di
//  Bézier, in MILLIMETRI, scritta a mano nel file: 1 unità = 1 mm
//  per qualunque importatore (la trappola 182 non può tornare), e
//  nessun <defs> da fondere (la 184 non esiste più). È anche ciò che
//  permetterà nella Fetta 2 di APRIRE il contorno con la linguetta
//  esattamente nel punto giusto.
//
//  LA COMPENSAZIONE DEL TAGLIO E LE LINGUETTE (Fetta 2)
//  ----------------------------------------------------
//  Il laser si mangia una fascia di gomma lungo tutto il perimetro.
//  Negli SVG da taglio ogni tessera CRESCE di «compensazione» mm su ogni
//  misura (0,3 di partenza): a fascia (ogni lato in fuori di metà) o in
//  proporzione (la base + c, il resto in scala). Poi, nel file
//  «…_linguette.svg», il contorno si APRE con un taglietto al centro del
//  lato dritto sulla base (mai sulla curva). Il PDF e la distinta restano
//  con le misure VERE. Con compensazione 0 i file chiusi sono IDENTICI,
//  byte per byte, a quelli della Fetta 1.
//
//  IL PDF PER IL BANCO (Fetta 3)
//  -----------------------------
//  Accanto agli SVG, nella stessa cartella, UN solo PDF A4 a 300 DPI:
//  prima le TAVOLE 1:1 (una pagina per ogni foglio SVG chiuso, le stesse
//  righe, la tessera VERA al posto di quella cresciuta, l'etichetta di
//  ogni matrice nel suo stacco), poi i numeri del mosaico, la barra di
//  controllo della stampa, la TABELLA COLORI (HEX e RGB, per comprare la
//  gomma) e la DISTINTA. Il testo si scrive sul contesto 2D della tela,
//  mai con fabric.Text (trappola 179). La tela si disegna SOLO alla
//  conferma: l'anteprima calcola le pagine sui numeri, senza disegnare.
//
//  LA DISTINTA IN CSV (Fetta 4)
//  ----------------------------
//  Accanto al PDF, se l'interruttore del modale è acceso (lo è di
//  partenza), la stessa distinta come TABELLA per Excel e LibreOffice:
//  una riga per colore, forma e misura, le misure VERE al decimo. Le
//  righe sono quelle del PDF (righeDistinta), i colori quelli della sua
//  tabella (_infoColore): le due non possono dire cose diverse. In
//  italiano «;» fra le colonne e la virgola nei decimali, come vuole
//  l'Excel italiano; in inglese «,» e il punto. UTF-8 con la BOM (senza,
//  l'Excel di Windows legge «Â°» al posto di «°»), a capo CRLF.
//
//  ⚠ LA SCATOLA È LA GEOMETRIA VERA, NON getScaledWidth() (trappola 186)
//  Fabric conta nelle misure uno spessore di contorno di 1 px anche
//  quando il contorno non c'è, e lo moltiplica per la scala: un
//  quadrato nuovo di 37,8 px ne dichiara 38,8. Il laser taglia la
//  forma, non il fantasma: qui la scatola si misura sui segmenti.
//
//  COMPATIBILITÀ
//  -------------
//  Fabric.js 5.1.0 → 5.3.0. Si usano solo calcTransformMatrix(),
//  getObjects(), getActiveObjects(), points/pathOffset/path/radius/
//  rx/ry/width/height — tutte presenti e identiche nelle tre.
//  Il PDF non usa Fabric: una <canvas> del DOM, contesto 2D, toBlob.
//
//  Caricato in index.html DOPO renderer.js e svgExport.js.
//  Espone window.tileSheet = { apri, genera, distinta,
//  famiglieColore, __test }.
// ============================================================

(function () {
  "use strict";

  // ═══════════════════════════════════════════════════════════
  //  PARTE 1 — MATEMATICA PURA
  //  Nessun Fabric, nessun DOM: la prova il banco in Node.
  // ═══════════════════════════════════════════════════════════

  // Costante del quarto di cerchio in Bézier cubica. Errore radiale
  // massimo 0,027% del raggio: su una tessera tonda di 10 mm sono
  // 1,4 millesimi di millimetro, cento volte sotto il raggio del laser.
  var K_CERCHIO = 0.5522847498307936;
  var EPS = 1e-9;

  // Il foglio A4, in mm.
  var A4_CORTO = 210;
  var A4_LUNGO = 297;

  // Valori di partenza del modale (tutti regolabili dall'utente).
  var DEFAULT_PARAMETRI = {
    orientamento: "verticale", // "verticale" | "orizzontale"
    margine: 5,
    spazio: 2,
    stacco: 10, // lo spazio PRIMA di ogni matrice: nel PDF porterà l'etichetta
    allineamento: "basso", // "basso" | "alto"
    soloSelezionate: false,
    // Fetta 2 (§4.16, §4.14)
    compensazione: 0.3, // mm in più su OGNI misura della tessera; 0 = spenta
    crescita: "fascia", // "fascia" | "proporzione"
    contorni: "entrambi", // "entrambi" (chiusi + con linguetta) | "chiusi"
    taglietto: 0.4, // mm di contorno aperto della linguetta
    // Fetta 3 (§4.15): come si disegnano le tessere nelle tavole del PDF
    pdfTessere: "colorate", // "colorate" (piene del loro colore) | "contorno" (meno inchiostro)
    // Fetta 4 (§4.15): accanto al PDF anche la distinta in CSV
    distintaCsv: true
  };
  // Lo stacco non scende sotto questa misura: nella Fetta 3 ci deve
  // stare l'etichetta della matrice, alta ~4 mm con il suo respiro.
  var STACCO_MINIMO = 6;
  // Guardia contro i conti sbagliati: oltre, si ferma e lo dice.
  var MAX_FILE = 60;

  // ── Colori ───────────────────────────────────────────────────

  function _clamp(v, lo, hi) {
    return v < lo ? lo : v > hi ? hi : v;
  }

  function _hex2(n) {
    var s = Math.round(_clamp(n, 0, 255)).toString(16).toUpperCase();
    return s.length < 2 ? "0" + s : s;
  }

  function _canale(v, perc) {
    var n = parseFloat(v);
    if (!isFinite(n)) return NaN;
    return perc ? (n * 255) / 100 : n;
  }

  /**
   * Legge un colore CSS e lo restituisce come {r,g,b,a} normalizzato
   * (r,g,b interi 0..255, a 0..1 con tre decimali), oppure null.
   * ⚠ Trappola 177: «rgba(0,5,255,0.79)» e «#0005FFC9» devono dare lo
   * STESSO numero, altrimenti lo stesso blu finisce in due matrici.
   * Esadecimali e rgb()/rgba() li leggo io (sono il 99% dei colori di
   * Mosaica e il risultato non dipende dalla versione di Fabric); i
   * nomi CSS e hsl() li chiedo alle tabelle di fabric.Color.
   */
  function parseColore(str) {
    if (typeof str !== "string") return null;
    var s = str.trim();
    if (!s) return null;
    var m = /^#([0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(s);
    if (m) {
      var h = m[1];
      if (h.length <= 4) {
        h = h
          .split("")
          .map(function (c) {
            return c + c;
          })
          .join("");
      }
      return _normalizza(
        parseInt(h.slice(0, 2), 16),
        parseInt(h.slice(2, 4), 16),
        parseInt(h.slice(4, 6), 16),
        h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1
      );
    }
    m = /^rgba?\(\s*([-\d.]+)(%?)\s*[,\s]\s*([-\d.]+)(%?)\s*[,\s]\s*([-\d.]+)(%?)\s*(?:[,/]\s*([-\d.]+)(%?)\s*)?\)$/i.exec(s);
    if (m) {
      var a = 1;
      if (m[7] !== undefined) {
        a = parseFloat(m[7]);
        if (m[8]) a = a / 100;
      }
      return _normalizza(_canale(m[1], m[2]), _canale(m[3], m[4]), _canale(m[5], m[6]), a);
    }
    if (s.toLowerCase() === "transparent") return _normalizza(0, 0, 0, 0);
    try {
      if (typeof fabric !== "undefined" && fabric.Color) {
        var mappa = fabric.Color.colorNameMap;
        var nome = s.toLowerCase();
        if (mappa && Object.prototype.hasOwnProperty.call(mappa, nome)) return parseColore(mappa[nome]);
        if (typeof fabric.Color.sourceFromHsl === "function") {
          var src = fabric.Color.sourceFromHsl(s);
          if (src) return _normalizza(src[0], src[1], src[2], src.length > 3 ? src[3] : 1);
        }
      }
    } catch (_) {
      /* colore illeggibile: resta null */
    }
    return null;
  }

  function _normalizza(r, g, b, a) {
    if (![r, g, b, a].every(isFinite)) return null;
    return {
      r: Math.round(_clamp(r, 0, 255)),
      g: Math.round(_clamp(g, 0, 255)),
      b: Math.round(_clamp(b, 0, 255)),
      a: Math.round(_clamp(a, 0, 1) * 1000) / 1000
    };
  }

  function hexDi(c) {
    return "#" + _hex2(c.r) + _hex2(c.g) + _hex2(c.b);
  }

  // La chiave di un colore esatto: confronto ESATTO, nessuna tolleranza
  // (trappola 177). L'alfa entra nella chiave solo se < 1.
  function chiaveColore(c) {
    return hexDi(c) + (c.a < 1 ? "@" + c.a : "");
  }

  // Il colore come lo VEDI sul foglio bianco: una tessera trasparente
  // al 79% è un blu più chiaro, ed è quello il colore della gomma da
  // comprare e del livello nel software del laser.
  function suBianco(c) {
    var a = c.a;
    return {
      r: Math.round(c.r * a + 255 * (1 - a)),
      g: Math.round(c.g * a + 255 * (1 - a)),
      b: Math.round(c.b * a + 255 * (1 - a)),
      a: 1
    };
  }

  // Tinta/saturazione/luminosità scritte a mano (4 righe di aritmetica)
  // invece di fabric.Color.toHsl(): identiche per costruzione su
  // 5.1.0, 5.2.4 e 5.3.0. h in gradi [0,360), s e l in [0,1].
  function hsl(r, g, b) {
    r /= 255;
    g /= 255;
    b /= 255;
    var max = Math.max(r, g, b),
      min = Math.min(r, g, b);
    var l = (max + min) / 2;
    var h = 0,
      s = 0;
    var d = max - min;
    if (d > 0) {
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
      else if (max === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
      h *= 60;
    }
    return { h: h, s: s, l: l };
  }

  // ── Le famiglie di colore ────────────────────────────────────
  // Per RAGGRUPPARE conta solo la tinta: i viola chiari e scuri stanno
  // insieme, come ha chiesto Mirko. Fasce [da, a) in gradi, tarate
  // sui nomi italiani e sui colori della farfalla (trappola 185).
  // ⚠ Trappola 189: nella revisione 3 c'erano due fasce che potevano
  // chiamarsi entrambe «rosa» (290–320 chiara e 320–345): due file
  // «rosa» diversi per due rosa che per te sono la stessa gomma. Ora
  // sono UNA fascia sola, 290–345.
  // Il rosso è tutto quello che resta: 345→360 e 0→15.
  var FASCE = [
    { cod: "arancio", da: 15, a: 40 },
    { cod: "giallo", da: 40, a: 65 },
    { cod: "lime", da: 65, a: 90 },
    { cod: "verde", da: 90, a: 150 },
    { cod: "verdeAcqua", da: 150, a: 175 },
    { cod: "ciano", da: 175, a: 195 },
    { cod: "blu", da: 195, a: 255 },
    { cod: "viola", da: 255, a: 290 },
    { cod: "rosa", da: 290, a: 345 }
  ];
  // Sotto questa saturazione la tinta non vuol dire niente: bianchi,
  // grigi, neri finiscono nella famiglia dei neutri.
  var SOGLIA_NEUTRI = 0.12;

  function fasciaDi(r, g, b) {
    var x = hsl(r, g, b);
    if (x.s < SOGLIA_NEUTRI) return "neutri";
    for (var i = 0; i < FASCE.length; i++) {
      if (x.h >= FASCE[i].da && x.h < FASCE[i].a) return FASCE[i].cod;
    }
    return "rosso";
  }

  // Il NOME segue il colore DOMINANTE della famiglia. Due sole regole,
  // perché in italiano due coppie di nomi famosi non sono solo tinta:
  //   • azzurro/blu: azzurro se la tinta tira al ciano (sotto 225°) OPPURE
  //     se è molto chiaro (luminosità oltre il 70%); altrimenti blu.
  //     ⚠ Trappola 185-bis: con la sola soglia di luminosità al 60% della
  //     revisione 3, il quadrato blu di partenza di Mosaica (rgba(0,5,255,
  //     0.79), che sul bianco è #3639FF, 239°, 60,6%) veniva chiamato
  //     «azzurro». È un blu pieno.
  //   • rosa/fucsia: rosa se la luminosità supera il 70%, altrimenti fucsia.
  // Il nome è cosmetico: la verità è l'esadecimale scritto nel file.
  function nomeFamiglia(cod, rgbDominante) {
    if (!rgbDominante) return cod;
    var x = hsl(rgbDominante.r, rgbDominante.g, rgbDominante.b);
    if (cod === "blu") return x.h < 225 || x.l > 0.7 ? "azzurro" : "blu";
    if (cod === "rosa") return x.l > 0.7 ? "rosa" : "fucsia";
    return cod;
  }

  // ── Geometria: matrici affini e contorni ─────────────────────
  // Matrice nella forma di Fabric: [a, b, c, d, e, f]
  //   x' = a·x + c·y + e      y' = b·x + d·y + f

  function mul(A, B) {
    return [
      A[0] * B[0] + A[2] * B[1],
      A[1] * B[0] + A[3] * B[1],
      A[0] * B[2] + A[2] * B[3],
      A[1] * B[2] + A[3] * B[3],
      A[0] * B[4] + A[2] * B[5] + A[4],
      A[1] * B[4] + A[3] * B[5] + A[5]
    ];
  }

  function tp(A, p) {
    return { x: A[0] * p.x + A[2] * p.y + A[4], y: A[1] * p.x + A[3] * p.y + A[5] };
  }

  // Un contorno: { p0, segs: [ {t:"L", p} | {t:"C", c1, c2, p} ] },
  // sempre CHIUSO (il ritorno a p0 è implicito: nel file c'è la Z).
  // Le Bézier sono invarianti per trasformazione affine: basta
  // trasformare i punti di controllo. Per questo tutto è L o C.
  function trasformaContorno(ct, A) {
    return {
      p0: tp(A, ct.p0),
      segs: ct.segs.map(function (s) {
        return s.t === "L" ? { t: "L", p: tp(A, s.p) } : { t: "C", c1: tp(A, s.c1), c2: tp(A, s.c2), p: tp(A, s.p) };
      })
    };
  }

  function traslaContorno(ct, dx, dy) {
    return trasformaContorno(ct, [1, 0, 0, 1, dx, dy]);
  }

  // Minimo e massimo ESATTI di una Bézier cubica su un asse: estremi
  // agli zeri della derivata (un'equazione di secondo grado).
  function estremiCubica(p0, p1, p2, p3) {
    var lo = Math.min(p0, p3),
      hi = Math.max(p0, p3);
    var a = -p0 + 3 * p1 - 3 * p2 + p3;
    var b = 2 * (p0 - 2 * p1 + p2);
    var c = p1 - p0;
    var ts = [];
    if (Math.abs(a) < 1e-14) {
      if (Math.abs(b) > 1e-14) ts.push(-c / b);
    } else {
      var disc = b * b - 4 * a * c;
      if (disc >= 0) {
        var q = Math.sqrt(disc);
        ts.push((-b + q) / (2 * a), (-b - q) / (2 * a));
      }
    }
    for (var i = 0; i < ts.length; i++) {
      var t = ts[i];
      if (t > 0 && t < 1) {
        var u = 1 - t;
        var v = u * u * u * p0 + 3 * u * u * t * p1 + 3 * u * t * t * p2 + t * t * t * p3;
        if (v < lo) lo = v;
        if (v > hi) hi = v;
      }
    }
    return [lo, hi];
  }

  function scatolaContorni(contorni) {
    var x0 = Infinity,
      y0 = Infinity,
      x1 = -Infinity,
      y1 = -Infinity;
    function punto(p) {
      if (p.x < x0) x0 = p.x;
      if (p.x > x1) x1 = p.x;
      if (p.y < y0) y0 = p.y;
      if (p.y > y1) y1 = p.y;
    }
    contorni.forEach(function (ct) {
      var cur = ct.p0;
      punto(cur);
      ct.segs.forEach(function (s) {
        if (s.t === "L") {
          punto(s.p);
        } else {
          var ex = estremiCubica(cur.x, s.c1.x, s.c2.x, s.p.x);
          var ey = estremiCubica(cur.y, s.c1.y, s.c2.y, s.p.y);
          if (ex[0] < x0) x0 = ex[0];
          if (ex[1] > x1) x1 = ex[1];
          if (ey[0] < y0) y0 = ey[0];
          if (ey[1] > y1) y1 = ey[1];
        }
        cur = s.p;
      });
    });
    if (!isFinite(x0)) return null;
    return { x0: x0, y0: y0, x1: x1, y1: y1, w: x1 - x0, h: y1 - y0 };
  }

  // ── Le forme nel loro sistema locale (origine al centro) ────
  // Sono le stesse coordinate con cui Fabric le disegna in _render().

  function geoRettangolo(w, h, rx, ry) {
    var X = w / 2,
      Y = h / 2;
    rx = Math.min(Math.abs(rx || 0), X);
    ry = Math.min(Math.abs(ry || 0), Y);
    if (!(rx > 0 && ry > 0)) {
      return [
        {
          p0: { x: -X, y: -Y },
          segs: [
            { t: "L", p: { x: X, y: -Y } },
            { t: "L", p: { x: X, y: Y } },
            { t: "L", p: { x: -X, y: Y } }
          ]
        }
      ];
    }
    var kx = rx * K_CERCHIO,
      ky = ry * K_CERCHIO;
    return [
      {
        p0: { x: -X + rx, y: -Y },
        segs: [
          { t: "L", p: { x: X - rx, y: -Y } },
          { t: "C", c1: { x: X - rx + kx, y: -Y }, c2: { x: X, y: -Y + ry - ky }, p: { x: X, y: -Y + ry } },
          { t: "L", p: { x: X, y: Y - ry } },
          { t: "C", c1: { x: X, y: Y - ry + ky }, c2: { x: X - rx + kx, y: Y }, p: { x: X - rx, y: Y } },
          { t: "L", p: { x: -X + rx, y: Y } },
          { t: "C", c1: { x: -X + rx - kx, y: Y }, c2: { x: -X, y: Y - ry + ky }, p: { x: -X, y: Y - ry } },
          { t: "L", p: { x: -X, y: -Y + ry } },
          { t: "C", c1: { x: -X, y: -Y + ry - ky }, c2: { x: -X + rx - kx, y: -Y }, p: { x: -X + rx, y: -Y } }
        ]
      }
    ];
  }

  // Ellisse (e cerchio) in quattro quarti. Si parte dal punto più BASSO
  // (y positiva = in basso, come sullo schermo): nella Fetta 2 è lì che
  // un cerchio intero riceverà la sua linguetta.
  function geoEllisse(rx, ry) {
    var kx = rx * K_CERCHIO,
      ky = ry * K_CERCHIO;
    return [
      {
        p0: { x: 0, y: ry },
        segs: [
          { t: "C", c1: { x: -kx, y: ry }, c2: { x: -rx, y: ky }, p: { x: -rx, y: 0 } },
          { t: "C", c1: { x: -rx, y: -ky }, c2: { x: -kx, y: -ry }, p: { x: 0, y: -ry } },
          { t: "C", c1: { x: kx, y: -ry }, c2: { x: rx, y: -ky }, p: { x: rx, y: 0 } },
          { t: "C", c1: { x: rx, y: ky }, c2: { x: kx, y: ry }, p: { x: 0, y: ry } }
        ]
      }
    ];
  }

  function geoPoligono(punti, off) {
    if (!Array.isArray(punti) || punti.length < 3) return null;
    var ox = (off && off.x) || 0,
      oy = (off && off.y) || 0;
    var pts = punti.map(function (p) {
      return { x: p.x - ox, y: p.y - oy };
    });
    return [
      {
        p0: pts[0],
        segs: pts.slice(1).map(function (p) {
          return { t: "L", p: p };
        })
      }
    ];
  }

  // Un fabric.Path in Fabric 5 è già «semplificato» (makePathSimpler):
  // solo M, L, C, Q, Z assoluti. Q diventa C in modo ESATTO (elevazione
  // di grado). Qualunque altro comando → null: non si indovina una forma.
  function geoPath(path, off) {
    if (!Array.isArray(path) || !path.length) return null;
    var ox = (off && off.x) || 0,
      oy = (off && off.y) || 0;
    var contorni = [];
    var cur = null,
      start = null,
      ct = null;
    function P(x, y) {
      return { x: x - ox, y: y - oy };
    }
    function chiudi() {
      if (ct && ct.segs.length) {
        // Se l'ultimo punto coincide col primo, il segmento di chiusura è
        // già la Z: tolgo il doppione di lunghezza zero.
        var last = ct.segs[ct.segs.length - 1];
        if (last.t === "L" && Math.abs(last.p.x - ct.p0.x) < EPS && Math.abs(last.p.y - ct.p0.y) < EPS) ct.segs.pop();
        if (ct.segs.length) contorni.push(ct);
      }
      ct = null;
    }
    for (var i = 0; i < path.length; i++) {
      var c = path[i];
      if (!Array.isArray(c) || typeof c[0] !== "string") return null;
      switch (c[0]) {
        case "M":
          chiudi();
          cur = P(c[1], c[2]);
          start = cur;
          ct = { p0: cur, segs: [] };
          break;
        case "L":
          if (!ct) return null;
          cur = P(c[1], c[2]);
          ct.segs.push({ t: "L", p: cur });
          break;
        case "C":
          if (!ct) return null;
          cur = P(c[5], c[6]);
          ct.segs.push({ t: "C", c1: P(c[1], c[2]), c2: P(c[3], c[4]), p: cur });
          break;
        case "Q":
          if (!ct) return null;
          var q = P(c[1], c[2]),
            e = P(c[3], c[4]);
          ct.segs.push({
            t: "C",
            c1: { x: cur.x + (2 / 3) * (q.x - cur.x), y: cur.y + (2 / 3) * (q.y - cur.y) },
            c2: { x: e.x + (2 / 3) * (q.x - e.x), y: e.y + (2 / 3) * (q.y - e.y) },
            p: e
          });
          cur = e;
          break;
        case "Z":
        case "z":
          chiudi();
          cur = start;
          break;
        default:
          return null;
      }
    }
    chiudi();
    return contorni.length ? contorni : null;
  }

  // ── L'impacchettamento: scaffali, primo che ci sta, ORDINE CONSERVATO
  //
  // Non è un ottimizzatore: un ottimizzatore rimescolerebbe le tessere e
  // romperebbe l'unica cosa che conta, cioè i colori insieme e in fila.
  //
  // Regole (§5 del cantiere, revisione 4):
  //   • ogni foglio comincia al margine;
  //   • ogni MATRICE è preceduta da uno STACCO (anche la prima del
  //     foglio): nell'SVG è aria, nel PDF porterà l'etichetta. Così le
  //     pagine del PDF saranno IDENTICHE ai fogli SVG, riga per riga;
  //   • fra due righe della stessa matrice: `spazio`;
  //   • ogni colore comincia una riga nuova (una riga = un colore solo,
  //     altrimenti in Beam Studio le matrici non si separano più);
  //   • una riga non si spezza mai fra due fogli; se una matrice continua
  //     sul foglio dopo, ricomincia con il suo stacco (banda «segue»);
  //   • ⚠ trappola 178: l'allineamento in basso si scrive a riga CHIUSA.
  //
  // griglie: [{ chiave, pezzi: [{ id, w, h }] }]   (in mm, già in ordine)
  // par:     { W, H, margine, spazio, stacco, allineamento }
  function impagina(griglie, par) {
    var W = par.W,
      H = par.H,
      m = par.margine,
      sp = par.spazio,
      st = par.stacco;
    var basso = par.allineamento !== "alto";
    var larghUtile = W - 2 * m;
    var altUtile = H - 2 * m - st; // la riga più alta possibile su un foglio vuoto

    var fogli = [];
    var fuori = [];
    var nRighe = 0;
    var foglio = null;
    var yFondo = 0; // il fondo dell'ultima cosa posata sul foglio corrente

    function nuovoFoglio() {
      foglio = { pezzi: [], bande: [] };
      fogli.push(foglio);
      yFondo = m;
    }

    griglie.forEach(function (gr, gi) {
      // 1) le righe come ELENCHI (le y si decidono dopo: trappola 178)
      var righe = [];
      var riga = null;
      var x = 0;
      gr.pezzi.forEach(function (p) {
        if (p.w > larghUtile + EPS) {
          fuori.push({ id: p.id, griglia: gi, motivo: "larga" });
          return;
        }
        if (p.h > altUtile + EPS) {
          fuori.push({ id: p.id, griglia: gi, motivo: "alta" });
          return;
        }
        if (riga && riga.pezzi.length && x + sp + p.w > m + larghUtile + EPS) {
          riga = null;
        }
        if (!riga) {
          riga = { pezzi: [], h: 0 };
          righe.push(riga);
          x = m;
        } else {
          x += sp;
        }
        riga.pezzi.push({ p: p, x: x });
        x += p.w;
        if (p.h > riga.h) riga.h = p.h;
      });

      // 2) le righe sui fogli
      righe.forEach(function (r, ri) {
        if (!foglio) nuovoFoglio();
        var apre = ri === 0; // la prima riga della matrice porta lo stacco
        var top = apre ? yFondo + st : yFondo + sp;
        if (top + r.h > H - m + EPS) {
          nuovoFoglio();
          top = m + st;
          foglio.bande.push({ griglia: gi, y0: top - st, y1: top, segue: !apre });
        } else if (apre) {
          foglio.bande.push({ griglia: gi, y0: top - st, y1: top, segue: false });
        }
        r.pezzi.forEach(function (q) {
          foglio.pezzi.push({
            id: q.p.id,
            griglia: gi,
            riga: nRighe,
            x: q.x,
            y: basso ? top + r.h - q.p.h : top,
            w: q.p.w,
            h: q.p.h
          });
        });
        yFondo = top + r.h;
        nRighe++;
      });
    });

    return { fogli: fogli, fuori: fuori, righe: nRighe };
  }

  // L'ordine DENTRO una matrice: per specie di forma, poi altezza
  // decrescente, poi larghezza decrescente, poi l'ordine sul canvas.
  // Righe di scatole quasi uguali sprecano meno altezza.
  var ORDINE_SPECIE = ["rect", "circle", "ellipse", "trapezoid", "triangle", "sector", "custom", "polygon", "path", "group"];

  function indiceSpecie(s) {
    var i = ORDINE_SPECIE.indexOf(s);
    return i < 0 ? ORDINE_SPECIE.length : i;
  }

  function confrontaPezzi(a, b) {
    var d = indiceSpecie(a.specie) - indiceSpecie(b.specie);
    if (d) return d;
    // Arrotondo al millesimo di mm: due tessere «uguali» con un rumore di
    // calcolo di 1e-12 non devono scambiarsi di posto fra due esportazioni.
    d = Math.round(b.h * 1000) - Math.round(a.h * 1000);
    if (d) return d;
    d = Math.round(b.w * 1000) - Math.round(a.w * 1000);
    if (d) return d;
    return a.indice - b.indice;
  }

  // ── Scrittura SVG ────────────────────────────────────────────

  function fmt(v) {
    var n = Math.round(v * 10000) / 10000;
    if (Object.is(n, -0) || Math.abs(n) < 1e-12) n = 0;
    return String(n);
  }

  function dContorni(contorni) {
    return contorni
      .map(function (ct) {
        var s = "M" + fmt(ct.p0.x) + " " + fmt(ct.p0.y);
        ct.segs.forEach(function (g) {
          if (g.t === "L") s += "L" + fmt(g.p.x) + " " + fmt(g.p.y);
          else
            s +=
              "C" +
              fmt(g.c1.x) + " " + fmt(g.c1.y) + " " +
              fmt(g.c2.x) + " " + fmt(g.c2.y) + " " +
              fmt(g.p.x) + " " + fmt(g.p.y);
        });
        return ct.aperto ? s : s + "Z";
      })
      .join("");
  }

  function idSicuro(s) {
    return String(s).replace(/[^A-Za-z0-9_-]/g, "_");
  }

  function _attr(s) {
    return String(s).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
  }

  // Spessore del tratto nel file, in mm: una linea sottile che il
  // software del laser legge come taglio. Non è una misura del taglio.
  var STROKE_MM = 0.1;

  /**
   * Scrive UN foglio SVG. Tutto in millimetri: width/height in mm e
   * viewBox con gli stessi numeri (trappola 182).
   *
   * matrici: [{ id, attributi: {k: v}, pezzi: [{ foglie: [{ contorni, stroke }], gruppo }] }]
   * dove i contorni sono GIÀ nella posizione finale sul foglio.
   * Tag ammessi: svg, g, path. Nient'altro (trappola 183).
   */
  function scriviSvg(W, H, matrici, radice) {
    var out = [];
    var attR = "";
    // Attributi, non disegni: il laser non li vede. Dicono a chi riapre il
    // file che è già cresciuto (trappola 197). Senza compensazione e senza
    // linguette non ce n'è nessuno: il file è quello della Fetta 1.
    Object.keys(radice || {}).forEach(function (k) {
      attR += " " + k + '="' + _attr(radice[k]) + '"';
    });
    out.push('<?xml version="1.0" encoding="UTF-8"?>');
    out.push(
      '<svg xmlns="http://www.w3.org/2000/svg" version="1.1" width="' +
        fmt(W) + 'mm" height="' + fmt(H) + 'mm" viewBox="0 0 ' + fmt(W) + " " + fmt(H) + '"' + attR + ">"
    );
    matrici.forEach(function (mx) {
      var att = "";
      Object.keys(mx.attributi || {}).forEach(function (k) {
        att += " " + k + '="' + _attr(mx.attributi[k]) + '"';
      });
      out.push('<g id="' + _attr(mx.id) + '"' + att + ">");
      mx.pezzi.forEach(function (pz) {
        var paths = pz.foglie.map(function (f) {
          return (
            '<path d="' + dContorni(f.contorni) + '" fill="none" stroke="' + f.stroke +
            '" stroke-width="' + fmt(STROKE_MM) + '"/>'
          );
        });
        if (pz.gruppo) {
          out.push('<g data-gruppo="' + pz.foglie.length + '">');
          paths.forEach(function (p) {
            out.push(p);
          });
          out.push("</g>");
        } else {
          paths.forEach(function (p) {
            out.push(p);
          });
        }
      });
      out.push("</g>");
    });
    out.push("</svg>");
    return out.join("\n");
  }

  // Nomi dei file: minuscoli, senza accenti né spazi.
  function slug(s) {
    var t = String(s == null ? "" : s);
    try {
      t = t.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    } catch (_) {}
    t = t
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "");
    return t.slice(0, 60).replace(/_+$/g, "");
  }

  // ═══════════════════════════════════════════════════════════
  //  FETTA 2 — LA COMPENSAZIONE DEL TAGLIO (§4.16) E LE LINGUETTE (§4.14)
  //  Tutto sui contorni in mm, DOPO l'azzeramento della rotazione.
  //  L'ordine è quello di Mirko: contorno vero → crescita → scatola della
  //  tessera cresciuta → impaginazione → (file con linguette) taglietto.
  //  Il PDF e la distinta NON passano di qui: portano le misure vere.
  // ═══════════════════════════════════════════════════════════

  // Due pezzi si incontrano «lisci» sotto questo angolo: niente spigolo.
  var SOGLIA_LISCIO = (0.5 * Math.PI) / 180;
  // Lo spigolo vivo non sporge più di TETTO_PUNTA·d dal vertice vero:
  // oltre (punte sotto ~14,4°) si smussa. Taratura del collaudo (trappola 199).
  var TETTO_PUNTA = 8;
  // Scarto massimo della fascia sulle curve: 0,5 µm (trappola 198).
  var SCARTO_CURVE = 0.0005;
  var DIVISIONI_MAX = 6;
  var CAMPIONI_SCARTO = 16;
  // Dopo sei divisioni una curva ancora più lontana di così dalla fascia
  // vera non va nel file: la tessera resta senza compensazione, dichiarata.
  var SCARTO_ULTIMO = 0.01;
  // Linguette: quanto lato pieno deve restare da ogni parte del taglietto,
  // e quanto vicino al fondo della scatola deve stare un lato per essere
  // «la base» (10 µm: i raggi dei settori sono arrotondati al centesimo di px).
  var MARGINE_LINGUETTA = 0.2;
  var TOLL_BASE = 0.01;

  // ── vettori ──
  function _vsub(a, b) {
    return { x: a.x - b.x, y: a.y - b.y };
  }
  function _vadd(a, b) {
    return { x: a.x + b.x, y: a.y + b.y };
  }
  function _vmul(a, k) {
    return { x: a.x * k, y: a.y * k };
  }
  function _vdot(a, b) {
    return a.x * b.x + a.y * b.y;
  }
  function _vcross(a, b) {
    return a.x * b.y - a.y * b.x;
  }
  function _vlen(a) {
    return Math.sqrt(a.x * a.x + a.y * a.y);
  }
  function _vunit(a) {
    var l = _vlen(a);
    return l > 1e-15 ? { x: a.x / l, y: a.y / l } : null;
  }
  function _vlerp(a, b, t) {
    return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
  }
  // La normale a DESTRA del verso di percorrenza (tangente ruotata di −90°).
  function _destra(t) {
    return { x: t.y, y: -t.x };
  }

  // ── pezzi: i segmenti con il loro punto di partenza ──
  // { t:"L", a, b } oppure { t:"C", a, c1, c2, b }

  // Da contorno a elenco ciclico di pezzi, con la chiusura ESPLICITA e
  // senza i pezzi di lunghezza zero (un punto ripetuto non ha un verso).
  function pezziDi(ct) {
    var out = [],
      cur = ct.p0;
    ct.segs.forEach(function (s) {
      if (s.t === "L") out.push({ t: "L", a: cur, b: s.p });
      else out.push({ t: "C", a: cur, c1: s.c1, c2: s.c2, b: s.p });
      cur = s.p;
    });
    if (!ct.aperto && _vlen(_vsub(cur, ct.p0)) > 1e-9) out.push({ t: "L", a: cur, b: ct.p0 });
    return out.filter(function (s) {
      if (s.t === "L") return _vlen(_vsub(s.b, s.a)) > 1e-9;
      return _vlen(_vsub(s.b, s.a)) > 1e-9 || _vlen(_vsub(s.c1, s.a)) > 1e-9 || _vlen(_vsub(s.c2, s.a)) > 1e-9;
    });
  }

  // Da pezzi a contorno. Chiuso: il ritorno al primo punto resta implicito
  // (nel file c'è la Z). Aperto: nessun ritorno.
  function contornoDaPezzi(pz, aperto) {
    var segs = pz.map(function (s) {
      return s.t === "L" ? { t: "L", p: s.b } : { t: "C", c1: s.c1, c2: s.c2, p: s.b };
    });
    var p0 = pz[0].a;
    if (!aperto) {
      var last = segs[segs.length - 1];
      if (last && last.t === "L" && _vlen(_vsub(last.p, p0)) < 1e-9) segs.pop();
      return { p0: p0, segs: segs };
    }
    return { p0: p0, segs: segs, aperto: true };
  }

  function puntoPezzo(s, t) {
    if (s.t === "L") return _vlerp(s.a, s.b, t);
    var u = 1 - t;
    var A = u * u * u,
      B = 3 * u * u * t,
      C = 3 * u * t * t,
      D = t * t * t;
    return {
      x: A * s.a.x + B * s.c1.x + C * s.c2.x + D * s.b.x,
      y: A * s.a.y + B * s.c1.y + C * s.c2.y + D * s.b.y
    };
  }

  function derivataPezzo(s, t) {
    if (s.t === "L") return _vsub(s.b, s.a);
    var u = 1 - t;
    return {
      x: 3 * u * u * (s.c1.x - s.a.x) + 6 * u * t * (s.c2.x - s.c1.x) + 3 * t * t * (s.b.x - s.c2.x),
      y: 3 * u * u * (s.c1.y - s.a.y) + 6 * u * t * (s.c2.y - s.c1.y) + 3 * t * t * (s.b.y - s.c2.y)
    };
  }

  function derivata2Pezzo(s, t) {
    if (s.t === "L") return { x: 0, y: 0 };
    var u = 1 - t;
    return {
      x: 6 * u * (s.c2.x - 2 * s.c1.x + s.a.x) + 6 * t * (s.b.x - 2 * s.c2.x + s.c1.x),
      y: 6 * u * (s.c2.y - 2 * s.c1.y + s.a.y) + 6 * t * (s.b.y - 2 * s.c2.y + s.c1.y)
    };
  }

  // de Casteljau: la cubica divisa in t → [sinistra, destra], esatta.
  function _dividiCubica(s, t) {
    var ab = _vlerp(s.a, s.c1, t),
      bc = _vlerp(s.c1, s.c2, t),
      cd = _vlerp(s.c2, s.b, t);
    var abc = _vlerp(ab, bc, t),
      bcd = _vlerp(bc, cd, t);
    var m = _vlerp(abc, bcd, t);
    return [
      { t: "C", a: s.a, c1: ab, c2: abc, b: m },
      { t: "C", a: m, c1: bcd, c2: cd, b: s.b }
    ];
  }

  // La parte del pezzo fra t0 e t1 (0 ≤ t0 < t1 ≤ 1).
  function tagliaPezzo(s, t0, t1) {
    if (s.t === "L") return { t: "L", a: _vlerp(s.a, s.b, t0), b: _vlerp(s.a, s.b, t1) };
    var r = s;
    if (t1 < 1) r = _dividiCubica(r, t1)[0];
    if (t0 > 0) r = _dividiCubica(r, t0 / t1)[1];
    return r;
  }

  function _primaDirezione(da, verso) {
    for (var i = 0; i < verso.length; i++) {
      var v = _vsub(verso[i], da);
      if (_vlen(v) > 1e-12) return _vunit(v);
    }
    return null;
  }
  // Le tangenti unitarie agli estremi, anche con i punti di controllo
  // sovrapposti (una Q elevata, un arco degenere).
  function tangenteInizio(s) {
    return s.t === "L" ? _vunit(_vsub(s.b, s.a)) : _primaDirezione(s.a, [s.c1, s.c2, s.b]);
  }
  function tangenteFine(s) {
    if (s.t === "L") return _vunit(_vsub(s.b, s.a));
    var v = _primaDirezione(s.b, [s.c2, s.c1, s.a]);
    return v ? _vmul(v, -1) : null;
  }

  // Area con segno (campionata: serve il verso e il confronto prima/dopo).
  function areaPezzi(pz) {
    var A = 0;
    pz.forEach(function (s) {
      var n = s.t === "L" ? 1 : 32;
      var prev = s.a;
      for (var i = 1; i <= n; i++) {
        var p = puntoPezzo(s, i / n);
        A += prev.x * p.y - p.x * prev.y;
        prev = p;
      }
    });
    return A / 2;
  }

  function _poligonale(pz, perCurva) {
    var pts = [];
    pz.forEach(function (s) {
      var n = s.t === "L" ? 1 : perCurva;
      for (var i = 0; i < n; i++) pts.push(puntoPezzo(s, i / n));
    });
    return pts;
  }

  function _dentro(p, poly) {
    var c = false;
    for (var i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      var a = poly[i],
        b = poly[j];
      if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) c = !c;
    }
    return c;
  }

  // Quali contorni di una forma sono FORI: quelli che stanno dentro un
  // numero dispari di altri contorni della stessa forma.
  function segnaFori(contorni) {
    if (contorni.length < 2) return contorni.map(function () {
      return false;
    });
    var polys = contorni.map(function (ct) {
      return _poligonale(pezziDi(ct), 24);
    });
    return contorni.map(function (ct, i) {
      var n = 0;
      for (var j = 0; j < polys.length; j++) if (j !== i && _dentro(ct.p0, polys[j])) n++;
      return n % 2 === 1;
    });
  }

  function _orient(a, b, c) {
    return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  }
  function _siTaglianoDavvero(a, b, c, d) {
    var E = 1e-14;
    var o1 = _orient(a, b, c),
      o2 = _orient(a, b, d),
      o3 = _orient(c, d, a),
      o4 = _orient(c, d, b);
    return ((o1 > E && o2 < -E) || (o1 < -E && o2 > E)) && ((o3 > E && o4 < -E) || (o3 < -E && o4 > E));
  }
  // Un contorno che si intreccia (due tratti non vicini che si tagliano).
  function siIntreccia(pz) {
    var pts = _poligonale(pz, 8);
    var m = pts.length;
    if (m < 4) return false;
    for (var i = 0; i < m; i++) {
      var a = pts[i],
        b = pts[(i + 1) % m];
      for (var j = i + 2; j < m; j++) {
        if (i === 0 && j === m - 1) continue; // adiacenti attraverso la chiusura
        if (_siTaglianoDavvero(a, b, pts[j], pts[(j + 1) % m])) return true;
      }
    }
    return false;
  }

  // ── la fascia di una cubica (trappola 198) ──
  // Si spostano gli estremi di d lungo la normale e si tengono le TANGENTI
  // agli estremi, con le maniglie allungate di (1 + d·σ·κ): è la derivata
  // esatta della fascia vera negli estremi (O' = B'·(1 + dσκ)), e per un
  // arco di cerchio dà il cerchio di raggio r + d. Poi lo scarto si MISURA
  // in 16 punti; se supera 0,5 µm la curva si divide a metà e si rifà.

  function _curvatura(d1, d2) {
    var l = _vlen(d1);
    return l > 1e-12 ? _vcross(d1, d2) / (l * l * l) : 0;
  }

  // Il parametro del punto della curva più vicino a p (Newton da t0).
  function _piuVicino(s, p, t0) {
    var t = t0;
    for (var it = 0; it < 12; it++) {
      var r = _vsub(puntoPezzo(s, t), p),
        d1 = derivataPezzo(s, t),
        d2 = derivata2Pezzo(s, t);
      var g = _vdot(r, d1),
        gp = _vdot(d1, d1) + _vdot(r, d2);
      if (!(Math.abs(gp) > 1e-18)) break;
      var nt = t - g / gp;
      if (nt < 0) nt = 0;
      else if (nt > 1) nt = 1;
      if (Math.abs(nt - t) < 1e-13) {
        t = nt;
        break;
      }
      t = nt;
    }
    return t;
  }

  // Lo scarto di una fascia approssimata o dalla fascia vera a distanza d
  // da s: il massimo, in 16 punti, di | distanza da s − d |.
  function scartoFascia(s, o, d) {
    var peggio = 0;
    for (var i = 0; i < CAMPIONI_SCARTO; i++) {
      var u = (i + 0.5) / CAMPIONI_SCARTO;
      var p = puntoPezzo(o, u);
      var t = _piuVicino(s, p, u);
      var e = Math.abs(_vlen(_vsub(puntoPezzo(s, t), p)) - d);
      if (e > peggio) peggio = e;
    }
    return peggio;
  }

  function fasciaCubica(s, d, sig, prof) {
    var tA = tangenteInizio(s),
      tB = tangenteFine(s);
    if (!tA || !tB) return null;
    var nA = _vmul(_destra(tA), sig),
      nB = _vmul(_destra(tB), sig);
    var h0 = _vsub(s.c1, s.a),
      h1 = _vsub(s.c2, s.b);
    var k0 = _vlen(h0) > 1e-12 ? _curvatura(_vmul(h0, 3), derivata2Pezzo(s, 0)) : 0;
    var k1 = _vlen(h1) > 1e-12 ? _curvatura(_vmul(h1, -3), derivata2Pezzo(s, 1)) : 0;
    var f0 = 1 + d * sig * k0,
      f1 = 1 + d * sig * k1;
    var o = null,
      e = Infinity;
    if (f0 > 0 && f1 > 0) {
      var A = _vadd(s.a, _vmul(nA, d)),
        B = _vadd(s.b, _vmul(nB, d));
      o = { t: "C", a: A, c1: _vadd(A, _vmul(h0, f0)), c2: _vadd(B, _vmul(h1, f1)), b: B };
      e = scartoFascia(s, o, d);
      if (e <= SCARTO_CURVE) return [o];
    }
    if (prof >= DIVISIONI_MAX) return o && e <= SCARTO_ULTIMO ? [o] : null;
    var m = _dividiCubica(s, 0.5);
    var sx = fasciaCubica(m[0], d, sig, prof + 1);
    var dx = sx && fasciaCubica(m[1], d, sig, prof + 1);
    return sx && dx ? sx.concat(dx) : null;
  }

  // Dove si incrociano la fine del pezzo A e l'inizio del pezzo B (i due
  // pezzi spostati di uno spigolo RIENTRANTE). Newton in due variabili da
  // (1, 0); null se non si incrociano dentro i due pezzi.
  function _incrocio(A, B) {
    var s = 1,
      t = 0;
    for (var it = 0; it < 40; it++) {
      var F = _vsub(puntoPezzo(A, s), puntoPezzo(B, t));
      if (_vlen(F) < 1e-13) break;
      var dA = derivataPezzo(A, s),
        dB = derivataPezzo(B, t);
      var det = -_vcross(dA, dB);
      if (Math.abs(det) < 1e-18) return null;
      var ds = (F.x * dB.y - dB.x * F.y) / det;
      var dt = (dA.y * F.x - dA.x * F.y) / det;
      s += ds;
      t += dt;
      if (!isFinite(s) || !isFinite(t) || s < -1 || s > 2 || t < -1 || t > 2) return null;
    }
    if (_vlen(_vsub(puntoPezzo(A, s), puntoPezzo(B, t))) > 1e-7) return null;
    if (s < -1e-9 || s > 1 + 1e-9 || t < -1e-9 || t > 1 + 1e-9) return null;
    return { s: _clamp(s, 0, 1), t: _clamp(t, 0, 1) };
  }

  function _accoda(out, q) {
    if (out.length) {
      var e = out[out.length - 1].b;
      if (_vlen(_vsub(q.a, e)) > 1e-9) out.push({ t: "L", a: e, b: q.a });
      else if (q.t === "L") q = { t: "L", a: e, b: q.b };
      else q = { t: "C", a: e, c1: q.c1, c2: q.c2, b: q.b };
    }
    out.push(q);
  }
  function _accodaPunto(out, p) {
    var e = out[out.length - 1].b;
    if (_vlen(_vsub(p, e)) > 1e-9) out.push({ t: "L", a: e, b: p });
  }
  // Sposta un estremo di un pezzo portandosi dietro la sua maniglia: la
  // tangente resta la stessa.
  function _spostaFine(s, p) {
    if (s.t === "L") return { t: "L", a: s.a, b: p };
    return { t: "C", a: s.a, c1: s.c1, c2: _vadd(s.c2, _vsub(p, s.b)), b: p };
  }
  function _spostaInizio(s, p) {
    if (s.t === "L") return { t: "L", a: p, b: s.b };
    return { t: "C", a: p, c1: _vadd(s.c1, _vsub(p, s.a)), c2: s.c2, b: s.b };
  }

  // ── la fascia di UN contorno chiuso ──
  // Ogni pezzo spostato di d dalla parte «sig» (+1 = a destra del verso di
  // percorrenza). Negli spigoli SPORGENTI i due lati si prolungano fino a
  // incontrarsi (spigolo vivo: restituisce la punta che il laser si mangia,
  // trappola 199), col tetto di TETTO_PUNTA·d; negli spigoli RIENTRANTI si
  // taglia dove i due pezzi spostati si incrociano. null se non riesce: un
  // lato così corto da rovesciarsi, un incrocio che non c'è.
  function fasciaContorno(ct, d, sig) {
    var pz = pezziDi(ct);
    var n = pz.length;
    if (!n) return null;
    var off = [];
    var i, j;
    for (i = 0; i < n; i++) {
      var s = pz[i];
      if (s.t === "L") {
        var sp = _vmul(_destra(tangenteInizio(s)), sig * d);
        off.push([{ t: "L", a: _vadd(s.a, sp), b: _vadd(s.b, sp) }]);
      } else {
        var oc = fasciaCubica(s, d, sig, 0);
        if (!oc) return null;
        off.push(oc);
      }
    }
    var tIni = [],
      tFin = [],
      giunti = [];
    for (i = 0; i < n; i++) {
      tIni.push(0);
      tFin.push(1);
      giunti.push(null);
    }
    for (i = 0; i < n; i++) {
      j = (i + 1) % n;
      var tA = tangenteFine(pz[i]),
        tB = tangenteInizio(pz[j]);
      if (!tA || !tB) return null;
      var cr = _vcross(tA, tB),
        phi = Math.atan2(cr, _vdot(tA, tB)); // quanto gira il contorno nel vertice
      var ultimo = off[i][off[i].length - 1],
        primo = off[j][0];
      if (Math.abs(phi) < SOGLIA_LISCIO) {
        // liscio: i due capi quasi coincidono → si incontrano a metà
        var mezzo = _vlerp(ultimo.b, primo.a, 0.5);
        off[i][off[i].length - 1] = _spostaFine(ultimo, mezzo);
        off[j][0] = _spostaInizio(off[j][0], mezzo);
        continue;
      }
      if (sig * cr > 0) {
        // SPORGENTE: i due pezzi spostati si allontanano → spigolo vivo
        var V = pz[i].b;
        var nA = _vmul(_destra(tA), sig),
          nB = _vmul(_destra(tB), sig);
        var bis = _vunit(_vadd(nA, nB)) || tA;
        var co = Math.cos(Math.abs(phi) / 2);
        if (co > 1e-12 && 1 / co <= TETTO_PUNTA) {
          giunti[i] = [_vadd(V, _vmul(bis, d / co))];
        } else {
          var h = TETTO_PUNTA * d,
            ta = _vdot(tA, bis),
            tb = _vdot(tB, bis);
          if (!(ta > 1e-12) || !(tb < -1e-12)) return null;
          var PA = ultimo.b,
            PB = primo.a;
          giunti[i] = [
            _vadd(PA, _vmul(tA, (h - _vdot(_vsub(PA, V), bis)) / ta)),
            _vadd(PB, _vmul(tB, (h - _vdot(_vsub(PB, V), bis)) / tb))
          ];
        }
      } else {
        // RIENTRANTE: i due pezzi spostati si incrociano → si taglia lì
        var X = _incrocio(ultimo, primo);
        if (!X) return null;
        tFin[i] = X.s;
        tIni[j] = X.t;
      }
    }
    var out = [];
    for (i = 0; i < n; i++) {
      var subs = off[i];
      for (var k = 0; k < subs.length; k++) {
        var t0 = k === 0 ? tIni[i] : 0,
          t1 = k === subs.length - 1 ? tFin[i] : 1;
        if (!(t1 > t0 + 1e-12)) return null; // il pezzo si è rovesciato
        _accoda(out, t0 === 0 && t1 === 1 ? subs[k] : tagliaPezzo(subs[k], t0, t1));
      }
      if (giunti[i]) {
        for (var g = 0; g < giunti[i].length; g++) _accodaPunto(out, giunti[i][g]);
      }
    }
    _accodaPunto(out, out[0].a);
    return contornoDaPezzi(_fondiInFila(out), false);
  }

  // Due lati dritti consecutivi ESATTAMENTE in fila diventano uno solo:
  // lo spigolo vivo nasce come «prolungamento + lato», e senza questa
  // pulizia un quadrato cresciuto avrebbe otto vertici invece di quattro.
  // (Solo in fila davvero, 1e-9: i due raggi di un semicerchio, arrotondati
  // al centesimo di px, restano due pezzi — per la linguetta li unisce
  // latiDritti con la sua tolleranza di 0,5°.)
  function _fondiInFila(pz) {
    var cambiato = true;
    while (cambiato && pz.length > 3) {
      cambiato = false;
      for (var i = 0; i < pz.length; i++) {
        var j = (i + 1) % pz.length;
        var A = pz[i],
          B = pz[j];
        if (A.t !== "L" || B.t !== "L") continue;
        var u = _vsub(A.b, A.a),
          v = _vsub(B.b, B.a);
        if (Math.abs(_vcross(u, v)) <= 1e-9 * _vlen(u) * _vlen(v) && _vdot(u, v) > 0) {
          var m = { t: "L", a: A.a, b: B.b };
          if (j === 0) {
            pz[i] = m;
            pz.shift();
          } else pz.splice(i, 2, m);
          cambiato = true;
          break;
        }
      }
    }
    return pz;
  }

  // ── la crescita di UNA forma (i suoi contorni in mm) ──
  //   "fascia":      ogni contorno spostato di c/2 «in fuori», cioè lontano
  //                  dalla gomma: i contorni esterni verso fuori, i FORI
  //                  verso il loro interno (il foro si stringe, come col laser);
  //   "proporzione": k = (base + c)/base attorno al centro della scatola
  //                  vera. Esatta su tutto: è una trasformazione affine.
  // ⚠ Il numero c è quanto cresce OGNI MISURA (larghezza, altezza,
  // diametro): con la fascia ogni lato si sposta di c/2.
  // null se la fascia non riesce (la forma resta non compensata, dichiarata).
  function cresciContorni(contorni, c, modo) {
    if (!(c > 0)) return contorni;
    var box = scatolaContorni(contorni);
    if (!box || !(box.w > 0) || !(box.h > 0)) return null;
    if (modo === "proporzione") {
      var k = (box.w + c) / box.w;
      var cx = (box.x0 + box.x1) / 2,
        cy = (box.y0 + box.y1) / 2;
      return contorni.map(function (ct) {
        return trasformaContorno(ct, [k, 0, 0, k, cx - k * cx, cy - k * cy]);
      });
    }
    var d = c / 2;
    var fori = segnaFori(contorni);
    var out = [];
    for (var i = 0; i < contorni.length; i++) {
      var A0 = areaPezzi(pezziDi(contorni[i]));
      if (!(Math.abs(A0) > 1e-12)) return null;
      var sig = (A0 > 0 ? 1 : -1) * (fori[i] ? -1 : 1);
      var nuovo = fasciaContorno(contorni[i], d, sig);
      if (!nuovo) return null;
      var pzN = pezziDi(nuovo);
      var A1 = areaPezzi(pzN);
      // stesso verso, e l'area cresce (o, per un foro, cala)
      if (!(A1 * A0 > 0)) return null;
      if (fori[i] ? Math.abs(A1) >= Math.abs(A0) : Math.abs(A1) <= Math.abs(A0)) return null;
      if (siIntreccia(pzN)) return null;
      out.push(nuovo);
    }
    return out;
  }

  // ── le linguette (§4.14) ──

  // I lati dritti: pezzi L consecutivi in fila (entro 0,5°) contano come UN
  // lato solo — il diametro di un semicerchio è fatto di due raggi.
  function latiDritti(pz) {
    var n = pz.length;
    function inFila(i, j) {
      if (pz[i].t !== "L" || pz[j].t !== "L") return false;
      var a = tangenteFine(pz[i]),
        b = tangenteInizio(pz[j]);
      return Math.abs(Math.atan2(_vcross(a, b), _vdot(a, b))) < SOGLIA_LISCIO;
    }
    // si parte da un pezzo che NON continua il precedente, così un lato a
    // cavallo della chiusura non si spezza in due
    var start = -1;
    for (var k = 0; k < n; k++) {
      if (!inFila((k - 1 + n) % n, k)) {
        start = k;
        break;
      }
    }
    if (start < 0) return [];
    var lati = [],
      cur = null;
    for (var q = 0; q < n; q++) {
      var i = (start + q) % n;
      if (pz[i].t !== "L") {
        cur = null;
        continue;
      }
      if (cur && inFila((i - 1 + n) % n, i)) {
        cur.idx.push(i);
        cur.b = pz[i].b;
      } else {
        cur = { idx: [i], a: pz[i].a, b: pz[i].b };
        lati.push(cur);
      }
    }
    lati.forEach(function (l) {
      l.len = 0;
      l.idx.forEach(function (i) {
        l.len += _vlen(_vsub(pz[i].b, pz[i].a));
      });
    });
    return lati;
  }

  function _puntoSulLato(pz, l, s) {
    for (var k = 0; k < l.idx.length; k++) {
      var p = pz[l.idx[k]],
        L = _vlen(_vsub(p.b, p.a));
      if (s <= L + 1e-12 || k === l.idx.length - 1) return { i: l.idx[k], t: _clamp(s / L, 0, 1) };
      s -= L;
    }
    return null;
  }

  // Il punto più basso (y più grande: sullo schermo y cresce in basso).
  // A parità vince il primo: nei cerchi è il punto di partenza, messo lì
  // apposta da geoEllisse.
  function _piuBasso(pz) {
    var best = null;
    pz.forEach(function (s, i) {
      var ts = [0, 1];
      if (s.t === "C") {
        var p0 = s.a.y,
          p1 = s.c1.y,
          p2 = s.c2.y,
          p3 = s.b.y;
        var a = -p0 + 3 * p1 - 3 * p2 + p3,
          b = 2 * (p0 - 2 * p1 + p2),
          c = p1 - p0;
        if (Math.abs(a) < 1e-14) {
          if (Math.abs(b) > 1e-14) ts.push(-c / b);
        } else {
          var disc = b * b - 4 * a * c;
          if (disc >= 0) {
            var q = Math.sqrt(disc);
            ts.push((-b + q) / (2 * a), (-b - q) / (2 * a));
          }
        }
      }
      ts.forEach(function (t) {
        if (!(t >= 0 && t <= 1)) return;
        var y = puntoPezzo(s, t).y;
        if (!best || y > best.y + 1e-12) best = { i: i, t: t, y: y };
      });
    });
    return best;
  }

  // Un parametro «globale» u = indice + t, ciclico su n pezzi.
  function _norm(u, n) {
    u = u % n;
    return u < 0 ? u + n : u;
  }
  function _aU(u, n) {
    var v = _norm(u, n),
      i = Math.floor(v);
    if (i >= n) i = n - 1;
    return { i: i, t: v - i };
  }
  function _puntoU(pz, u) {
    var q = _aU(u, pz.length);
    return puntoPezzo(pz[q.i], q.t);
  }
  // Da uc, nel verso «dir» (+1 avanti, −1 indietro), il primo u a distanza
  // r (in linea d'aria) dal punto di uc.
  function _aDistanza(pz, uc, r, dir) {
    var n = pz.length,
      C = _puntoU(pz, uc),
      passo = 1 / 64,
      prec = 0;
    for (var k = 1; k <= n * 64; k++) {
      var u = k * passo;
      if (_vlen(_vsub(_puntoU(pz, uc + dir * u), C)) >= r) {
        var lo = prec,
          hi = u;
        for (var it = 0; it < 60; it++) {
          var mid = (lo + hi) / 2;
          if (_vlen(_vsub(_puntoU(pz, uc + dir * mid), C)) >= r) hi = mid;
          else lo = mid;
        }
        return uc + dir * hi;
      }
      prec = u;
    }
    return null;
  }

  // Il contorno APERTO: parte dalla fine del taglietto (ub), fa il giro e
  // si ferma all'inizio del taglietto (ua). Senza Z.
  function _contornoAperto(pz, ua, ub) {
    var n = pz.length,
      out = [];
    if (ub.t < 1 - 1e-12) out.push(tagliaPezzo(pz[ub.i], ub.t, 1));
    var i = (ub.i + 1) % n,
      guard = 0;
    while (i !== ua.i && guard++ <= n) {
      out.push(pz[i]);
      i = (i + 1) % n;
    }
    if (ua.t > 1e-12) out.push(tagliaPezzo(pz[ua.i], 0, ua.t));
    if (!out.length) return null;
    return contornoDaPezzi(out, true);
  }

  /**
   * Apre il contorno (chiuso, già al suo posto nel foglio) con un taglietto
   * lungo tg mm. Dove, in quest'ordine (§4.14):
   *   1. al centro del lato dritto che sta sulla BASE della scatola;
   *   2. se nessuno sta sulla base, al centro del lato dritto più lungo —
   *      i semicerchi di Mosaica nascono col diametro in alto: la regola
   *      non è «in basso», è «sul lato dritto, mai sulla curva»;
   *   3. forme SENZA lati dritti (cerchi, ovali): nel punto più basso.
   * Un lato più corto di tg + 0,2 mm per parte non lo riceve; se nessun
   * lato dritto basta, la tessera resta CHIUSA (null) e il modale la conta.
   */
  function apriContorno(ct, tg) {
    var pz = pezziDi(ct);
    if (!pz.length || !(tg > 0)) return null;
    var serve = tg + 2 * MARGINE_LINGUETTA;
    var ua, ub;
    var haLinee = pz.some(function (s) {
      return s.t === "L";
    });
    if (haLinee) {
      var box = scatolaContorni([ct]);
      var base = [],
        altri = [];
      latiDritti(pz).forEach(function (l, k) {
        l.k = k;
        (box.y1 - l.a.y <= TOLL_BASE && box.y1 - l.b.y <= TOLL_BASE ? base : altri).push(l);
      });
      var ord = function (x, y) {
        return y.len - x.len || x.k - y.k;
      };
      base.sort(ord);
      altri.sort(ord);
      var tutti = base.concat(altri),
        scelto = null;
      for (var q = 0; q < tutti.length; q++) {
        if (tutti[q].len >= serve - 1e-9) {
          scelto = tutti[q];
          break;
        }
      }
      if (!scelto) return null;
      var mid = scelto.len / 2;
      ua = _puntoSulLato(pz, scelto, mid - tg / 2);
      ub = _puntoSulLato(pz, scelto, mid + tg / 2);
    } else {
      var basso = _piuBasso(pz);
      if (!basso) return null;
      var perimetro = 0,
        poly = _poligonale(pz, 64);
      for (var z = 0; z < poly.length; z++) perimetro += _vlen(_vsub(poly[(z + 1) % poly.length], poly[z]));
      if (perimetro < serve) return null;
      var uc = basso.i + basso.t;
      // le due estremità equidistanti dal punto più basso, con la corda
      // fra le due lunga ESATTAMENTE tg
      var lo = tg / 2,
        hi = tg,
        uA = null,
        uB = null;
      for (var it = 0; it < 60; it++) {
        var r = (lo + hi) / 2;
        var a = _aDistanza(pz, uc, r, -1),
          b = _aDistanza(pz, uc, r, +1);
        if (a === null || b === null) return null;
        uA = a;
        uB = b;
        if (_vlen(_vsub(_puntoU(pz, a), _puntoU(pz, b))) < tg) lo = r;
        else hi = r;
      }
      ua = _aU(uA, pz.length);
      ub = _aU(uB, pz.length);
    }
    if (!ua || !ub) return null;
    return _contornoAperto(pz, ua, ub);
  }

  // ═══════════════════════════════════════════════════════════
  //  PARTE 2 — LETTURA DEL CANVAS (Fabric, SOLA LETTURA)
  // ═══════════════════════════════════════════════════════════

  function _canvas() {
    if (window.canvas) return window.canvas;
    try {
      if (typeof canvas !== "undefined" && canvas) return canvas;
    } catch (_) {}
    return null;
  }

  function _pxmm() {
    if (typeof window.px2mm === "function") return window.px2mm(1);
    try {
      if (typeof px2mm === "function") return px2mm(1);
    } catch (_) {}
    return 25.4 / 96;
  }

  // Ripiego locale del riconoscitore dei tratti, allineato a quello di
  // svgExport.js (PressurePath compreso).
  function _trattoLocale(o) {
    var t = o.type;
    return (o.__isFreehand === true || o.__isWatercolor === true) && (t === "path" || t === "image" || t === "group");
  }

  function eTratto(o) {
    var t = o.type;
    // ⚠ Trappola 188: isWatercolorOrFreehand() di renderer.js, davanti a
    // un PressurePath senza marchio, SCRIVE __isFreehand sull'oggetto.
    // È un'auto-riparazione legittima, ma qui abbiamo promesso di non
    // scrivere niente: il PressurePath lo riconosco io, prima di chiedere.
    if (t === "PressurePath" || t === "pressurepath") return true;
    try {
      if (typeof isWatercolorOrFreehand === "function") return !!isWatercolorOrFreehand(o);
    } catch (_) {}
    return _trattoLocale(o);
  }

  function _bgObj() {
    try {
      if (typeof backgroundImageObject !== "undefined") return backgroundImageObject;
    } catch (_) {}
    return null;
  }
  function _paperObj() {
    try {
      if (typeof paperTextureObject !== "undefined") return paperTextureObject;
    } catch (_) {}
    return null;
  }

  // Perché un oggetto NON entra nella tavola (o null se entra).
  function motivoEsclusione(o) {
    if (!o) return "sistema";
    if (o.__isBackground === true) return "sfondo";
    var bg = _bgObj(),
      pp = _paperObj();
    if ((bg && o === bg) || (pp && o === pp)) return "sfondo";
    if (eTratto(o)) return "tratti";
    if (o.type === "activeSelection") return "sistema";
    if (o.excludeFromExport === true) return "sistema";
    if (o.visible === false) return "nascoste";
    return null;
  }

  function _isPattern(f) {
    if (!f || typeof f !== "object") return false;
    try {
      if (typeof fabric !== "undefined" && fabric.Pattern && f instanceof fabric.Pattern) return true;
    } catch (_) {}
    return !!f.source || f.type === "pattern";
  }

  // Il colore di UNA forma (non gruppo), letto dall'ORIGINALE.
  function infoColoreFoglia(o) {
    var f = o.fill;
    if (_isPattern(f)) {
      var id = String(o.__textureId || f.__texId || "?");
      var tinto = !!(o.__textureColorize || f.__colorize);
      var tinta = tinto ? parseColore(o.__textureTint || f.__tint) : null;
      var hexT = tinta ? hexDi(suBianco(tinta)) : null;
      return {
        tipo: "texture",
        texture: id,
        tinta: hexT,
        chiave: "texture:" + id + (hexT ? "+" + hexT : ""),
        stroke: hexT || "#000000"
      };
    }
    var c = typeof f === "string" ? parseColore(f) : null;
    if (!c || c.a <= 0) return { tipo: "nessuno", chiave: "senza", stroke: "#000000" };
    var visto = suBianco(c);
    return {
      tipo: "tinta",
      hex: hexDi(c),
      alfa: c.a,
      rgb: { r: c.r, g: c.g, b: c.b },
      visto: visto,
      chiave: chiaveColore(c),
      stroke: hexDi(visto)
    };
  }

  // Le foglie di un pezzo: un gruppo è UN pezzo, ma si taglia forma per
  // forma. Non si scioglie mai (§4.10).
  function foglieDi(o) {
    if (o.type === "group" && Array.isArray(o._objects)) {
      var out = [];
      o._objects.forEach(function (c) {
        out = out.concat(foglieDi(c));
      });
      return out;
    }
    return [o];
  }

  function contorniLocali(o) {
    switch (o.type) {
      case "rect":
        return geoRettangolo(o.width, o.height, o.rx, o.ry);
      case "circle": {
        var giro = Math.abs((o.endAngle == null ? 360 : o.endAngle) - (o.startAngle || 0));
        if (giro < 360 - 1e-6) return null; // arco di cerchio: non è una tessera che so tagliare
        return geoEllisse(o.radius, o.radius);
      }
      case "ellipse":
        return geoEllisse(o.rx, o.ry);
      case "polygon":
        return geoPoligono(o.points, o.pathOffset);
      case "path":
        return geoPath(o.path, o.pathOffset);
      default:
        return null;
    }
  }

  // L'angolo TOTALE di un pezzo: il suo più quello dei contenitori
  // (una ActiveSelection ruotata e non ancora sciolta porta la sua
  // rotazione dentro calcTransformMatrix dei figli).
  function angoloTotale(o) {
    var a = 0,
      x = o,
      guard = 0;
    while (x && guard++ < 16) {
      a += Number(x.angle) || 0;
      x = x.group;
    }
    return a;
  }

  /**
   * La geometria del pezzo con la rotazione azzerata, in mm, centrata sul
   * centro del pezzo.
   *
   *   q' = S(mm) · R(−θ) · ( M_foglia · p − t_pezzo )
   *
   * ⚠ Trappola 187: NON si scompone la matrice (qrDecompose) per poi
   * rimetterla con angle 0. Un ribaltamento orizzontale si scompone come
   * «180° + ribaltamento verticale», e azzerando l'angolo resterebbe il
   * ribaltamento SBAGLIATO: il trapezio con la base in alto. Qui si
   * toglie SOLO la rotazione θ, e il ribaltamento resta quello vero.
   * ⚠ Trappola 191: la posizione si prende dalla matrice (M[4], M[5]),
   * non da getCenterPoint(), che dentro una selezione multipla è relativo
   * alla selezione.
   */
  function geometriaPezzo(o, pxmm) {
    var foglie = foglieDi(o);
    if (!foglie.length) return null;
    var MP = o.calcTransformMatrix();
    var th = (angoloTotale(o) * Math.PI) / 180;
    var c = Math.cos(th),
      s = Math.sin(th);
    var Z = mul([pxmm, 0, 0, pxmm, 0, 0], mul([c, -s, s, c, 0, 0], [1, 0, 0, 1, -MP[4], -MP[5]]));
    var out = [];
    for (var i = 0; i < foglie.length; i++) {
      var fg = foglie[i];
      var loc = contorniLocali(fg);
      if (!loc) return null; // un solo pezzo che non so tagliare → tutto il pezzo fuori, dichiarato
      var A = mul(Z, fg.calcTransformMatrix());
      out.push({
        obj: fg,
        contorni: loc.map(function (ct) {
          return trasformaContorno(ct, A);
        }),
        colore: infoColoreFoglia(fg)
      });
    }
    var tutti = [];
    out.forEach(function (f) {
      tutti = tutti.concat(f.contorni);
    });
    var box = scatolaContorni(tutti);
    if (!box || !(box.w > 0) || !(box.h > 0)) return null;
    return { foglie: out, box: box };
  }

  function specieDi(o) {
    var st = o.__shapeType;
    if (o.type === "group") return "group";
    if (st && indiceSpecie(st) < ORDINE_SPECIE.length) return st;
    return o.type;
  }

  function colorePezzo(foglie, gruppo) {
    var prima = foglie[0].colore;
    if (!gruppo) return prima;
    for (var i = 1; i < foglie.length; i++) {
      if (foglie[i].colore.chiave !== prima.chiave) return { tipo: "misti", chiave: "misti", stroke: null };
    }
    return prima;
  }

  /**
   * Raccoglie le tessere. Non scrive niente.
   * opz.soloSelezionate → solo gli oggetti della selezione attiva.
   */
  function raccogli(opz) {
    opz = opz || {};
    var cv = _canvas();
    if (!cv) throw new Error("canvas non disponibile");
    var tutti = cv.getObjects();
    var sorgente = opz.soloSelezionate && typeof cv.getActiveObjects === "function" ? cv.getActiveObjects() : tutti;
    var pxmm = _pxmm();
    var pezzi = [];
    var escluse = { tratti: 0, sfondo: 0, nascoste: 0, nonTagliabili: 0, sistema: 0 };
    sorgente.forEach(function (o) {
      var mot = motivoEsclusione(o);
      if (mot) {
        escluse[mot]++;
        return;
      }
      var g = geometriaPezzo(o, pxmm);
      if (!g) {
        escluse.nonTagliabili++;
        return;
      }
      var gruppo = o.type === "group";
      pezzi.push({
        id: pezzi.length,
        obj: o,
        indice: tutti.indexOf(o),
        specie: specieDi(o),
        gruppo: gruppo,
        foglie: g.foglie,
        box: g.box,
        w: g.box.w,
        h: g.box.h,
        colore: colorePezzo(g.foglie, gruppo)
      });
    });
    return { pezzi: pezzi, escluse: escluse };
  }

  function famigliaDelColore(col) {
    if (col.tipo === "tinta") {
      var v = col.visto;
      return fasciaDi(v.r, v.g, v.b);
    }
    if (col.tipo === "texture") return "texture:" + col.texture;
    if (col.tipo === "misti") return "misti";
    return "senzaColore";
  }

  /**
   * Famiglie → colori esatti → pezzi, già in ordine.
   * Famiglie per numero di tessere decrescente; dentro, le matrici per
   * numero decrescente; dentro, i pezzi con confrontaPezzi().
   */
  function raggruppa(pezzi) {
    var fam = {};
    pezzi.forEach(function (p) {
      var fc = famigliaDelColore(p.colore);
      if (!fam[fc]) fam[fc] = { codice: fc, colori: {}, tessere: 0 };
      var F = fam[fc];
      if (!F.colori[p.colore.chiave]) F.colori[p.colore.chiave] = { chiave: p.colore.chiave, info: p.colore, pezzi: [] };
      F.colori[p.colore.chiave].pezzi.push(p);
      F.tessere++;
    });
    var lista = Object.keys(fam).map(function (k) {
      var F = fam[k];
      var colori = Object.keys(F.colori)
        .map(function (ck) {
          var C = F.colori[ck];
          C.pezzi.sort(confrontaPezzi);
          return C;
        })
        .sort(function (a, b) {
          return b.pezzi.length - a.pezzi.length || (a.chiave < b.chiave ? -1 : a.chiave > b.chiave ? 1 : 0);
        });
      return { codice: F.codice, colori: colori, tessere: F.tessere };
    });
    lista.sort(function (a, b) {
      return b.tessere - a.tessere || (a.codice < b.codice ? -1 : a.codice > b.codice ? 1 : 0);
    });
    // i nomi: dal colore dominante (il primo, dopo l'ordinamento)
    var nTex = 0;
    lista.forEach(function (F) {
      var dom = F.colori[0].info;
      if (F.codice.indexOf("texture:") === 0) {
        nTex++;
        F.nomeCodice = "texture";
        F.numero = nTex;
      } else if (F.codice === "misti" || F.codice === "senzaColore" || F.codice === "neutri") {
        F.nomeCodice = F.codice;
      } else {
        F.nomeCodice = nomeFamiglia(F.codice, dom.visto);
      }
    });
    return lista;
  }

  function nomeVisibile(F) {
    var base = _t("tileSheet.family." + F.nomeCodice, null, F.nomeCodice);
    return F.numero ? base + " " + F.numero : base;
  }

  function attributiMatrice(C) {
    var i = C.info;
    if (i.tipo === "tinta") {
      var a = { "data-colore": i.hex };
      if (i.alfa < 1) a["data-alfa"] = String(i.alfa);
      return a;
    }
    if (i.tipo === "texture") {
      var t = { "data-texture": i.texture };
      if (i.tinta) t["data-tinta"] = i.tinta;
      return t;
    }
    if (i.tipo === "misti") return { "data-colore": "misti" };
    return { "data-colore": "nessuno" };
  }

  function idMatrice(C) {
    var i = C.info;
    if (i.tipo === "tinta") return "griglia_" + i.hex.slice(1) + (i.alfa < 1 ? "_a" + Math.round(i.alfa * 1000) : "");
    if (i.tipo === "texture") return "griglia_tex_" + idSicuro(i.texture) + (i.tinta ? "_" + i.tinta.slice(1) : "");
    if (i.tipo === "misti") return "griglia_misti";
    return "griglia_senza_colore";
  }

  function normalizzaParametri(p) {
    var q = Object.assign({}, DEFAULT_PARAMETRI, p || {});
    function num(v, def, lo, hi) {
      // un campo vuoto vale il suo valore di partenza, non zero: una
      // compensazione cancellata per sbaglio non deve spegnersi in silenzio
      var n = v === "" || v === null || v === undefined ? def : Number(v);
      if (!isFinite(n)) n = def;
      return _clamp(n, lo, hi);
    }
    q.orientamento = q.orientamento === "orizzontale" ? "orizzontale" : "verticale";
    q.allineamento = q.allineamento === "alto" ? "alto" : "basso";
    q.margine = num(q.margine, DEFAULT_PARAMETRI.margine, 0, 50);
    q.spazio = num(q.spazio, DEFAULT_PARAMETRI.spazio, 0, 50);
    q.stacco = num(q.stacco, DEFAULT_PARAMETRI.stacco, STACCO_MINIMO, 80);
    q.soloSelezionate = !!q.soloSelezionate;
    q.compensazione = num(q.compensazione, DEFAULT_PARAMETRI.compensazione, 0, 1.5);
    q.crescita = q.crescita === "proporzione" ? "proporzione" : "fascia";
    q.contorni = q.contorni === "chiusi" ? "chiusi" : "entrambi";
    q.taglietto = num(q.taglietto, DEFAULT_PARAMETRI.taglietto, 0.05, 3);
    q.pdfTessere = q.pdfTessere === "contorno" ? "contorno" : "colorate";
    // acceso salvo un «no» esplicito: i parametri salvati prima della
    // Fetta 4 non hanno il campo, e la distinta la vuole Mirko
    q.distintaCsv = q.distintaCsv !== false;
    q.W = q.orientamento === "orizzontale" ? A4_LUNGO : A4_CORTO;
    q.H = q.orientamento === "orizzontale" ? A4_CORTO : A4_LUNGO;
    return q;
  }

  function nomeProgetto() {
    var p = null;
    try {
      if (typeof currentProjectPath !== "undefined") p = currentProjectPath;
    } catch (_) {}
    if (!p || typeof p !== "string") return "";
    var base = p.split(/[\\/]/).pop() || "";
    return base.replace(/\.msp\.json$/i, "").replace(/\.json$/i, "").replace(/\.[a-z0-9]+$/i, "");
  }

  /**
   * La tessera come va nei file da TAGLIO: cresciuta della compensazione
   * (§4.16). Ogni foglia cresce per conto suo, al suo posto, con la sua
   * base (un gruppo resta un pezzo, ma si taglia forma per forma). Se una
   * sola foglia non si lascia allargare, il pezzo intero resta con le
   * misure vere e si dichiara: mai in silenzio, mai perso.
   */
  function perIlTaglio(P, par) {
    var c = par.compensazione;
    if (!(c > 0)) return { foglie: P.foglie, box: P.box, compensato: true };
    var foglie = [];
    for (var i = 0; i < P.foglie.length; i++) {
      var f = P.foglie[i];
      var nc = cresciContorni(f.contorni, c, par.crescita);
      if (!nc) return { foglie: P.foglie, box: P.box, compensato: false };
      foglie.push({ obj: f.obj, contorni: nc, colore: f.colore });
    }
    var tutti = [];
    foglie.forEach(function (f) {
      tutti = tutti.concat(f.contorni);
    });
    var box = scatolaContorni(tutti);
    if (!box || !(box.w > 0) || !(box.h > 0)) return { foglie: P.foglie, box: P.box, compensato: false };
    return { foglie: foglie, box: box, compensato: true };
  }

  /**
   * Il cuore: raccoglie, raggruppa, fa crescere, impagina e scrive.
   * Restituisce { files: [{name, content}], pdf, csv, riepilogo }:
   * `files` sono i soli SVG; `pdf` la descrizione delle pagine (Fetta 3)
   * o null; `csv` = { name, content, righe, sep } (Fetta 4) o null.
   * Per ogni famiglia e per ogni foglio: il file CHIUSO e, se i contorni
   * sono «entrambi», accanto il file CON LINGUETTE, identico nelle posizioni.
   */
  function genera(opzioni) {
    var par = normalizzaParametri(opzioni);
    var rac = raccogli(par);
    var nonCompensate = 0;
    rac.pezzi.forEach(function (p) {
      p.taglio = perIlTaglio(p, par);
      if (!p.taglio.compensato) nonCompensate++;
    });
    var fam = raggruppa(rac.pezzi);
    var base = slug(nomeProgetto()) || "tavola";
    var suffisso = slug(_t("tileSheet.file.tabsSuffix", null, "linguette")) || "linguette";
    var conLinguette = par.contorni === "entrambi";
    var usati = {};
    function nomeUnico(n) {
      var k = n,
        i = 2;
      while (usati[k + ".svg"]) k = n + "-" + i++;
      usati[k + ".svg"] = true;
      return k + ".svg";
    }
    // gli attributi del <svg>: attributi, non disegni (trappola 197)
    var radiceChiusi = {};
    if (par.compensazione > 0) {
      radiceChiusi["data-compensazione"] = fmt(par.compensazione);
      radiceChiusi["data-crescita"] = par.crescita;
    }
    var radiceLinguette = Object.assign({}, radiceChiusi, { "data-taglietto": fmt(par.taglietto) });
    var perId = {};
    rac.pezzi.forEach(function (p) {
      perId[p.id] = p;
    });
    var senzaLinguetta = {};
    var files = [];
    var tavole = []; // Fetta 3: i fogli SVG chiusi, in ordine → le tavole del PDF
    var riep = [];
    var fuoriTot = [];
    var nChiusi = 0,
      nLinguette = 0;

    // Le matrici di UN foglio. aprire → ogni contorno esterno col suo
    // taglietto (i fori restano chiusi: dentro c'è scarto, non tessera).
    function matriciDelFoglio(F, fg, aprire) {
      var matrici = [];
      var perGriglia = {};
      fg.pezzi.forEach(function (q) {
        var C = F.colori[q.griglia];
        if (!perGriglia[q.griglia]) {
          perGriglia[q.griglia] = { id: idMatrice(C), attributi: attributiMatrice(C), pezzi: [], n: 0 };
          matrici.push(perGriglia[q.griglia]);
        }
        var P = perId[q.id];
        var T = P.taglio;
        var dx = q.x - T.box.x0,
          dy = q.y - T.box.y0;
        perGriglia[q.griglia].pezzi.push({
          gruppo: P.gruppo,
          foglie: T.foglie.map(function (f) {
            var cs = f.contorni.map(function (ct) {
              return traslaContorno(ct, dx, dy);
            });
            if (aprire) {
              var fori = segnaFori(cs);
              cs = cs.map(function (ct, k) {
                if (fori[k]) return ct;
                var ap = apriContorno(ct, par.taglietto);
                if (!ap) {
                  senzaLinguetta[P.id] = true;
                  return ct;
                }
                return ap;
              });
            }
            return { stroke: f.colore.stroke, contorni: cs };
          })
        });
        perGriglia[q.griglia].n++;
      });
      // id unici nel file anche se due texture diverse si «sicurizzano»
      // nello stesso modo (trappola 184, l'unica cosa che l'unione rompe).
      var visti = {};
      matrici.forEach(function (mx) {
        mx.attributi["data-tessere"] = String(mx.n);
        var k = mx.id,
          j = 2;
        while (visti[k]) k = mx.id + "-" + j++;
        visti[k] = true;
        mx.id = k;
      });
      return matrici;
    }

    fam.forEach(function (F) {
      var griglie = F.colori.map(function (C) {
        return {
          chiave: C.chiave,
          pezzi: C.pezzi.map(function (p) {
            // l'impaginazione usa la tessera CRESCIUTA: lo spazio di 2 mm
            // si misura fra i contorni che il laser taglia davvero
            return { id: p.id, w: p.taglio.box.w, h: p.taglio.box.h };
          })
        };
      });
      var imp = impagina(griglie, par);
      imp.fuori.forEach(function (f) {
        fuoriTot.push(perId[f.id]);
      });
      var nome = nomeVisibile(F);
      var slugFam = slug(nome) || "famiglia";
      // Fetta 3: quante tessere di ogni matrice sono state POSATE (su tutti
      // i fogli della famiglia), per dire «in questa pagina» quando una
      // matrice continua sul foglio dopo.
      var posate = {};
      imp.fogli.forEach(function (fg) {
        fg.pezzi.forEach(function (q) {
          posate[q.griglia] = (posate[q.griglia] || 0) + 1;
        });
      });
      imp.fogli.forEach(function (fg, fi) {
        var n = base + "_" + slugFam + (imp.fogli.length > 1 ? "_" + (fi + 1) : "");
        var nomeChiuso = nomeUnico(n);
        files.push({ name: nomeChiuso, content: scriviSvg(par.W, par.H, matriciDelFoglio(F, fg, false), radiceChiusi) });
        // una pagina del PDF per ogni foglio SVG CHIUSO (quello con le
        // linguette ha le stesse posizioni: la stessa pagina lo ricalca)
        tavole.push({ F: F, fg: fg, file: nomeChiuso, posate: posate });
        nChiusi++;
        if (conLinguette) {
          files.push({
            name: nomeUnico(n + "_" + suffisso),
            content: scriviSvg(par.W, par.H, matriciDelFoglio(F, fg, true), radiceLinguette)
          });
          nLinguette++;
        }
      });
      riep.push({
        codice: F.codice,
        nome: nome,
        fogli: imp.fogli.length,
        matrici: F.colori.length,
        tessere: F.tessere - imp.fuori.length,
        colori: F.colori.map(function (C) {
          return { chiave: C.chiave, stroke: C.info.stroke, tessere: C.pezzi.length };
        })
      });
    });
    var riepilogo = {
      famiglie: riep,
      fuori: fuoriTot.length,
      escluse: rac.escluse,
      tessere: rac.pezzi.length,
      parametri: par,
      fileChiusi: nChiusi,
      fileLinguette: nLinguette,
      nonCompensate: nonCompensate,
      senzaLinguetta: Object.keys(senzaLinguetta).length
    };
    // Fetta 3: il PDF, come LISTA DI VOCI in mm (nessun disegno qui: la tela
    // si disegna solo alla conferma). Senza tessere niente PDF.
    var pdf = null;
    riepilogo.pdf = null;
    if (files.length) {
      var desc = costruisciPdf({ par: par, rac: rac, fam: fam, tavole: tavole, perId: perId, riepilogo: riepilogo });
      riepilogo.pdf = { nome: desc.name, pagine: desc.pagine.length, tavole: desc.tavole, info: desc.info, troppe: desc.pagine.length > MAX_PAGINE_PDF };
      if (!riepilogo.pdf.troppe) pdf = desc;
    }
    // Fetta 4: la distinta in CSV, testo puro (nessun disegno). Fuori da
    // `files` apposta: `files` sono gli SVG da taglio, contati dal tetto di
    // MAX_FILE e dall'anteprima; la CSV si aggiunge solo nel pacco per il
    // canale. Nasce anche quando il PDF sfora il tetto: lì serve di più.
    var csv = null;
    riepilogo.csv = null;
    if (files.length && par.distintaCsv) {
      csv = costruisciCsv(fam);
      riepilogo.csv = { nome: csv.name, righe: csv.righe };
    }
    return { files: files, pdf: pdf, csv: csv, riepilogo: riepilogo };
  }

  /** Le famiglie di colore del mosaico, senza generare niente. */
  function famiglieColore(opzioni) {
    var par = normalizzaParametri(opzioni);
    return raggruppa(raccogli(par).pezzi).map(function (F) {
      return {
        codice: F.codice,
        nome: nomeVisibile(F),
        tessere: F.tessere,
        colori: F.colori.map(function (C) {
          return { chiave: C.chiave, hex: C.info.hex || null, alfa: C.info.alfa == null ? null : C.info.alfa, tessere: C.pezzi.length };
        })
      };
    });
  }

  /**
   * I numeri del mosaico (senza generare file, senza toccare niente).
   * Le misure sono quelle VERE della forma, al decimo di mm: quelle che
   * il laser taglia (trappola 186).
   */
  function distinta(opzioni) {
    var par = normalizzaParametri(opzioni);
    var rac = raccogli(par);
    var fam = raggruppa(rac.pezzi);
    var colori = [];
    fam.forEach(function (F) {
      F.colori.forEach(function (C) {
        // Dalla Fetta 3 le righe le fa righeDistinta(), la stessa del PDF:
        // i campi di prima (specie, w, h, n) restano, e ogni riga
        // porta anche il nome della forma e le sue misure in più.
        colori.push({
          chiave: C.chiave,
          famiglia: nomeVisibile(F),
          tessere: C.pezzi.length,
          forme: righeDistinta(C)
        });
      });
    });
    return { totale: rac.pezzi.length, escluse: rac.escluse, colori: colori };
  }

  // ═══════════════════════════════════════════════════════════
  //  FETTA 3 — IL PDF PER IL BANCO (§4.15 del cantiere della Tavola,
  //  §6.2 del cantiere «La Bottega»)
  //  ---------------------------------------------------------------
  //  UN solo PDF, A4, raster a 300 DPI: la stessa catena del PDF di
  //  sempre (0,085 mm per pixel), e il canale di main.js c'è già dalla
  //  Fetta 1 (pagine PNG, tetto di 20: trappola 175). Dentro, in ordine:
  //    1. le TAVOLE 1:1 — una pagina per ogni foglio SVG CHIUSO, nello
  //       stesso ordine e con le STESSE righe (§4.7). Al posto di ogni
  //       tessera cresciuta c'è la tessera VERA, con la STESSA traslazione
  //       (§4.16): stampato al 100% il PDF mostra la tessera come esce dal
  //       laser, nel punto dove il laser la taglia. Nello stacco prima di
  //       ogni matrice la sua etichetta; nel primo stacco il nome del file
  //       SVG che la pagina ricalca e il numero di pagina;
  //    2. le INFORMAZIONI — i numeri del mosaico, la barra nera di 100 mm
  //       per controllare la stampa, la TABELLA COLORI (quadrato, HEX, RGB,
  //       famiglia, tessere: per comprare la gomma) e la DISTINTA (forme,
  //       misure VERE, quante).
  //  ⚠ Trappola 179: nessun fabric.Text. Il testo si scrive sul contesto
  //  2D della tela, IN PIXEL (niente scale() sotto il font: i caratteri
  //  piccoli ingranditi da una trasformazione si disegnano male), con la
  //  pila Arial, Helvetica, sans-serif.
  //  ⚠ Il layout è PURO: numeri in mm, una lista di VOCI per pagina
  //  (forme, rettangoli, testi). genera() lo costruisce anche per
  //  l'anteprima, che così sa quante pagine verranno; la tela si disegna
  //  SOLO alla conferma (rasterizzaPdf).
  // ═══════════════════════════════════════════════════════════

  var PDF_DPI = 300;
  // Lo stesso tetto di main.js (TILE_SHEET_MAX_PDF_PAGES): oltre, niente PDF
  // (gli SVG si scrivono lo stesso) e l'anteprima lo dice prima.
  var MAX_PAGINE_PDF = 20;
  var PDF_FONT = "Arial, Helvetica, sans-serif";
  // Le pagine delle informazioni non ricalcano niente: margine comodo, lontano
  // dalla zona che le stampanti non stampano.
  var PDF_MARGINE_INFO = 12;
  // Larghezza media stimata di un carattere, in em, per andare a capo nel
  // layout puro (senza misurare). Arial sta sotto 0,56 nel testo normale; il
  // fillText(…, larghezzaMassima) della tela è la seconda difesa.
  var PDF_LARG_CAR = 0.56;
  var PDF_NERO = "#111111";
  var PDF_GRIGIO = "#555555";
  var PDF_AVVISO = "#9A4A00";
  var PDF_BORDO_PIENE = "#1A1A1A"; // il filo attorno alle tessere colorate
  var PDF_SPESSORE_PIENE = 0.1; // mm
  var PDF_SPESSORE_CONTORNO = 0.15; // mm, per le tessere «solo contorno»
  var PDF_TEXTURE_SENZA_TINTA = "#CFCFCF";

  // ── numeri e parole ──

  function _sepDec() {
    return _t("tileSheet.pdf.decimalSep", null, ",");
  }

  // Un numero con `dec` decimali e la virgola della lingua.
  function _num(v, dec) {
    var n = Number(v);
    if (!isFinite(n)) return "?";
    var s = n.toFixed(dec);
    if (/^-0(\.0+)?$/.test(s)) s = s.slice(1);
    return s.replace(".", _sepDec());
  }

  // Come _num, ma senza gli zeri inutili in coda (0,3 e non 0,30).
  function _numBreve(v, dec) {
    var s = Number(v).toFixed(dec);
    if (s.indexOf(".") >= 0) s = s.replace(/0+$/, "").replace(/\.$/, "");
    if (/^-0$/.test(s)) s = "0";
    return s.replace(".", _sepDec());
  }

  function _rgbTesto(c) {
    return c.r + ", " + c.g + ", " + c.b;
  }

  // Il colore con cui si RIEMPIE una tessera (o il quadratino di una
  // matrice) nel PDF: quello visto sul foglio bianco. null = niente.
  function _riempitivo(col) {
    if (!col) return null;
    if (col.tipo === "tinta") return hexDi(col.visto);
    if (col.tipo === "texture") return col.tinta || PDF_TEXTURE_SENZA_TINTA;
    return null;
  }

  // Come si chiama una matrice nel PDF: la verità è l'esadecimale (§4.5).
  function _nomeColore(C) {
    var i = C.info;
    if (i.tipo === "tinta") return i.hex + (i.alfa < 1 ? " (α " + _numBreve(i.alfa, 3) + ")" : "");
    if (i.tipo === "texture") return _t("tileSheet.pdf.texture", { id: i.texture }, "texture {id}") + (i.tinta ? " + " + i.tinta : "");
    if (i.tipo === "misti") return _t("tileSheet.family.misti", null, "misti");
    return _t("tileSheet.family.senzaColore", null, "senza colore");
  }

  // HEX, RGB e nota di un colore esatto: la tabella colori del PDF e la
  // distinta in CSV (Fetta 4) li leggono QUI, così non possono dire cose
  // diverse. hex e rgb sono null quando non ci sono (il PDF ci scrive «—»,
  // la CSV lascia la casella vuota).
  function _infoColore(C) {
    var i = C.info;
    var o = { hex: null, rgb: null, nota: "" };
    if (i.tipo === "tinta") {
      o.hex = i.hex;
      o.rgb = _rgbTesto(i.rgb);
      if (i.alfa < 1) o.nota = _t("tileSheet.pdf.alpha", { a: _numBreve(i.alfa, 3), hex: hexDi(i.visto), rgb: _rgbTesto(i.visto) }, "trasparenza {a}: sul foglio si vede {hex} (RGB {rgb})");
    } else if (i.tipo === "texture") {
      var tc = i.tinta ? parseColore(i.tinta) : null;
      if (tc) {
        o.hex = i.tinta;
        o.rgb = _rgbTesto(tc);
      }
      o.nota = _t("tileSheet.pdf.texture", { id: i.texture }, "texture {id}");
    } else if (i.tipo === "misti") {
      o.nota = _t("tileSheet.pdf.mixedNote", null, "gruppi con pezzi di colori diversi");
    }
    return o;
  }

  // Va a capo sulle parole, con la larghezza STIMATA (layout puro).
  function _avvolgi(testo, s, larg) {
    var max = Math.max(8, Math.floor(larg / (s * PDF_LARG_CAR)));
    var righe = [],
      cur = "";
    String(testo)
      .split(" ")
      .forEach(function (w) {
        if (!cur) cur = w;
        else if ((cur + " " + w).length <= max) cur += " " + w;
        else {
          righe.push(cur);
          cur = w;
        }
      });
    if (cur) righe.push(cur);
    return righe.length ? righe : [""];
  }

  // Una voce di testo: (x, y) è la LINEA DI BASE, in mm; s è il corpo in mm.
  function _testo(x, y, s, t, o) {
    o = o || {};
    return {
      k: "testo",
      x: x,
      y: y,
      s: s,
      t: String(t),
      peso: o.peso || "normal",
      allinea: o.allinea || "left",
      colore: o.colore || PDF_NERO,
      larg: o.larg || null,
      paginaDi: !!o.paginaDi, // il numero di pagina si scrive alla fine
      base: o.base || ""
    };
  }

  function _rett(x, y, w, h, riempi, bordo, spessore) {
    return { k: "rett", x: x, y: y, w: w, h: h, riempi: riempi || null, bordo: bordo || null, spessore: spessore || 0 };
  }

  // ── il nome della forma e le sue misure in più (§4.8) ──
  // Tutto dalla GEOMETRIA VERA con la rotazione azzerata, in mm: vale anche
  // per una tessera scalata a mano dopo la creazione, quando i parametri
  // salvati in __shape non la descrivono più.

  var TOLL_ORIZZ = 0.01; // mm: un lato è «orizzontale» (la base) entro 10 µm

  // I nomi di ripiego, se i18n non c'è: gli stessi dell'italiano di i18n.js.
  var NOMI_FORME = {
    quadrato: "quadrato",
    rettangolo: "rettangolo",
    cerchio: "cerchio",
    ellisse: "ellisse",
    triangolo: "triangolo",
    trapezio: "trapezio",
    settore: "settore",
    formaLibera: "forma libera",
    formaCurva: "forma curva",
    gruppo: "gruppo",
    forma: "forma"
  };

  function _verticiPoligono(ct) {
    if (!ct || !ct.segs.length) return null;
    for (var i = 0; i < ct.segs.length; i++) if (ct.segs[i].t !== "L") return null;
    return [ct.p0].concat(
      ct.segs.map(function (s) {
        return s.p;
      })
    );
  }

  function _latiOrizzontali(v) {
    var out = [];
    for (var i = 0; i < v.length; i++) {
      var a = v[i],
        b = v[(i + 1) % v.length];
      if (Math.abs(a.y - b.y) < TOLL_ORIZZ && Math.abs(a.x - b.x) > TOLL_ORIZZ) out.push({ a: a, b: b, y: (a.y + b.y) / 2, l: Math.abs(a.x - b.x) });
    }
    return out;
  }

  // L'angolo in V fra VA e VB, in gradi (0..180).
  function _angolo(V, A, B) {
    var ux = A.x - V.x,
      uy = A.y - V.y,
      wx = B.x - V.x,
      wy = B.y - V.y;
    return (Math.abs(Math.atan2(ux * wy - uy * wx, ux * wx + uy * wy)) * 180) / Math.PI;
  }

  function formaDi(P) {
    if (P.gruppo) return { forma: "gruppo", extra: { pezzi: P.foglie.length } };
    var f = P.foglie[0];
    var cts = f.contorni;
    var sp = P.specie;
    var curve = cts.some(function (ct) {
      return ct.segs.some(function (s) {
        return s.t === "C";
      });
    });
    if (sp === "rect") return { forma: Math.abs(P.w - P.h) < 0.1 ? "quadrato" : "rettangolo", extra: null };
    if (sp === "circle" || sp === "ellipse") return { forma: Math.abs(P.w - P.h) < 0.1 ? "cerchio" : "ellisse", extra: null };
    if (sp === "sector") {
      // l'apertura la dice il modello (sola lettura): è un angolo, non una
      // misura, e una scala non la cambia
      var sh = f.obj && f.obj.__shape;
      var a = sh ? Number(sh.sweepDeg) : NaN;
      return { forma: "settore", extra: isFinite(a) && a > 0 ? { ampiezza: Math.round(a) } : null };
    }
    var v = cts.length === 1 ? _verticiPoligono(cts[0]) : null;
    if (sp === "trapezoid") {
      var lo = v ? _latiOrizzontali(v) : [];
      if (lo.length !== 2) return { forma: "trapezio", extra: null };
      lo.sort(function (p, q) {
        return q.y - p.y; // quella in basso prima (la y cresce verso il basso)
      });
      return { forma: "trapezio", extra: { basi: [lo[0].l, lo[1].l] } };
    }
    if (sp === "triangle") {
      var lt = v && v.length === 3 ? _latiOrizzontali(v) : [];
      if (lt.length !== 1) return { forma: "triangolo", extra: null };
      var sx = lt[0].a.x < lt[0].b.x ? lt[0].a : lt[0].b,
        dx = sx === lt[0].a ? lt[0].b : lt[0].a;
      var apice = v.filter(function (p) {
        return p !== sx && p !== dx;
      })[0];
      return { forma: "triangolo", extra: { angoli: [_angolo(sx, dx, apice), _angolo(dx, sx, apice)] } };
    }
    if (curve) return { forma: "formaCurva", extra: null };
    if (v) return { forma: "formaLibera", extra: { lati: v.length } };
    return { forma: cts.length > 1 ? "formaLibera" : "forma", extra: null };
  }

  // La chiave delle misure in più, ARROTONDATE come si stampano: due
  // tessere che nel PDF si leggono uguali si contano insieme.
  function _chiaveExtra(e) {
    if (!e) return "";
    if (e.basi) return "b" + Math.round(e.basi[0] * 10) + "/" + Math.round(e.basi[1] * 10);
    if (e.angoli) return "a" + Math.round(e.angoli[0]) + "/" + Math.round(e.angoli[1]);
    if (e.lati) return "l" + e.lati;
    if (e.pezzi) return "p" + e.pezzi;
    if (e.ampiezza) return "s" + e.ampiezza;
    return "";
  }

  function _testoExtra(e) {
    if (!e) return "";
    if (e.basi) return _t("tileSheet.pdf.extra.bases", { a: _num(Math.round(e.basi[0] * 10) / 10, 1), b: _num(Math.round(e.basi[1] * 10) / 10, 1) }, "basi {a} / {b} mm");
    if (e.angoli) return _t("tileSheet.pdf.extra.angles", { a: Math.round(e.angoli[0]), b: Math.round(e.angoli[1]) }, "angoli {a}° / {b}°");
    if (e.lati) return _t("tileSheet.pdf.extra.sides", { n: e.lati }, "{n} lati");
    if (e.pezzi) return _t("tileSheet.pdf.extra.pieces", { n: e.pezzi }, "{n} pezzi");
    if (e.ampiezza) return _t("tileSheet.pdf.extra.sweep", { a: e.ampiezza }, "apertura {a}°");
    return "";
  }

  // Le misure in più di una RIGA della distinta: la stessa scritta nel PDF
  // e nella colonna «Misure in più» della CSV.
  function _testoExtraRiga(r) {
    return _testoExtra(r.extra);
  }

  // Il nome di una forma nella lingua di Mosaica (PDF e CSV).
  function _nomeForma(forma) {
    return _t("tileSheet.shape." + forma, null, NOMI_FORME[forma] || forma);
  }

  // Le righe della distinta di UN colore esatto: stessa forma, stesse misure
  // al decimo di mm, stesse misure in più → una riga sola. L'ordine è quello
  // della matrice (specie, altezza, larghezza), cioè quello delle tavole.
  function righeDistinta(C) {
    var perChiave = {},
      righe = [];
    C.pezzi.forEach(function (p) {
      var fd = formaDi(p);
      var w = Math.round(p.w * 10) / 10,
        h = Math.round(p.h * 10) / 10;
      var k = p.specie + "|" + fd.forma + "|" + w + "|" + h + "|" + _chiaveExtra(fd.extra);
      var r = perChiave[k];
      if (!r) {
        r = perChiave[k] = { specie: p.specie, forma: fd.forma, extra: fd.extra, w: w, h: h, n: 0 };
        righe.push(r);
      }
      r.n++;
    });
    return righe;
  }

  // ── una pagina TAVOLA: ricalca un foglio SVG chiuso ──

  function paginaTavola(tv, par, perId, piene) {
    var F = tv.F,
      fg = tv.fg;
    var W = par.W,
      m = par.margine;
    var voci = [];
    var qui = {};
    fg.pezzi.forEach(function (q) {
      qui[q.griglia] = (qui[q.griglia] || 0) + 1;
    });
    // le tessere VERE, con la traslazione della tessera CRESCIUTA (§4.16):
    // la stessa di matriciDelFoglio(), quindi lo stesso punto del laser
    fg.pezzi.forEach(function (q) {
      var P = perId[q.id],
        T = P.taglio;
      var dx = q.x - T.box.x0,
        dy = q.y - T.box.y0;
      P.foglie.forEach(function (f) {
        voci.push({
          k: "forma",
          id: P.id,
          griglia: q.griglia,
          contorni: f.contorni.map(function (ct) {
            return traslaContorno(ct, dx, dy);
          }),
          riempi: piene ? _riempitivo(f.colore) : null,
          bordo: piene ? PDF_BORDO_PIENE : "#000000",
          spessore: piene ? PDF_SPESSORE_PIENE : PDF_SPESSORE_CONTORNO
        });
      });
    });
    // le etichette, ognuna nel SUO stacco, in basso (vicina alla sua matrice)
    var S = 2.8,
      LATO = 2.6;
    fg.bande.forEach(function (b, bi) {
      var C = F.colori[b.griglia];
      var yb = b.y1 - 1.3;
      voci.push(_rett(m, yb - 2.3, LATO, LATO, _riempitivo(C.info) || "#FFFFFF", "#333333", 0.1));
      var n = tv.posate[b.griglia] || 0;
      var t = _t("tileSheet.pdf.band", { color: _nomeColore(C), n: n }, "{color} — {n} tessere");
      if (b.segue) t += " " + _t("tileSheet.pdf.band.cont", null, "(segue)");
      if ((qui[b.griglia] || 0) < n) t += " · " + _t("tileSheet.pdf.band.here", { n: qui[b.griglia] || 0 }, "{n} in questa pagina");
      var larg = W - 2 * m - LATO - 1;
      if (bi === 0) {
        // nel primo stacco anche quale file SVG ricalca la pagina, e che
        // pagina è: lo spazio si divide secondo la lunghezza STIMATA dei due
        // testi (un nome di progetto lungo non deve schiacciare l'etichetta,
        // né l'etichetta il nome). Il numero di pagina si scrive alla fine:
        // si stima col più lungo possibile.
        var campione = tv.file + " · " + _t("tileSheet.pdf.pageOf", { page: MAX_PAGINE_PDF, pages: MAX_PAGINE_PDF }, "pagina {page} di {pages}");
        var stimaT = t.length * S * PDF_LARG_CAR,
          stimaH = campione.length * 2.4 * PDF_LARG_CAR;
        var largH = Math.max(larg * 0.3, Math.min(stimaH, larg - stimaT - 4));
        voci.push(_testo(m + LATO + 1, yb, S, t, { peso: "bold", larg: larg - largH - 4 }));
        voci.push(_testo(W - m, yb, 2.4, "", { allinea: "right", colore: PDF_GRIGIO, larg: largH, paginaDi: true, base: tv.file }));
      } else {
        voci.push(_testo(m + LATO + 1, yb, S, t, { peso: "bold", larg: larg }));
      }
    });
    return { tipo: "tavola", file: tv.file, voci: voci };
  }

  // ── i numeri per le pagine delle informazioni ──

  function _dataTesto(par) {
    if (typeof par.data === "string") return par.data; // il banco la fissa
    var d = new Date();
    var due = function (n) {
      return (n < 10 ? "0" : "") + n;
    };
    return _t("tileSheet.pdf.date", { d: due(d.getDate()), m: due(d.getMonth() + 1), y: d.getFullYear() }, "{d}/{m}/{y}");
  }

  function datiInfo(o) {
    var par = o.par,
      R = o.riepilogo,
      fam = o.fam;
    var nomeP = nomeProgetto();
    var D = {};
    D.titolo = nomeP
      ? _t("tileSheet.pdf.title", { name: nomeP }, "TAVOLA DELLE TESSERE — {name}")
      : _t("tileSheet.pdf.titleNoName", null, "TAVOLA DELLE TESSERE");
    D.sottotitolo = _t("tileSheet.pdf.subtitle", { date: _dataTesto(par) }, "Mosaica Workspace Pro · {date}");
    // colori, distinta, forme diverse, area
    var nColori = 0,
      forme = {},
      area = 0;
    D.colori = [];
    D.distinta = [];
    fam.forEach(function (F) {
      var nomeF = nomeVisibile(F);
      F.colori.forEach(function (C) {
        nColori++;
        // HEX, RGB e nota dalla funzione che legge anche la CSV (Fetta 4)
        var ic = _infoColore(C);
        var riga = { riempi: _riempitivo(C.info), hex: ic.hex || "—", rgb: ic.rgb || "—", famiglia: nomeF, tessere: C.pezzi.length, nota: ic.nota };
        D.colori.push(riga);
        var righe = righeDistinta(C);
        righe.forEach(function (r) {
          forme[r.forma] = true;
        });
        D.distinta.push({
          riempi: riga.riempi,
          testata: _t("tileSheet.pdf.bom.color", { color: _nomeColore(C), n: C.pezzi.length, family: nomeF }, "{color} — {n} tessere · {family}"),
          righe: righe
        });
        C.pezzi.forEach(function (p) {
          area += p.w * p.h;
        });
      });
    });
    var nForme = Object.keys(forme).length;
    var modo =
      par.crescita === "proporzione"
        ? _t("tileSheet.modal.preview.mode.proportional", null, "in proporzione")
        : _t("tileSheet.modal.preview.mode.band", null, "a fascia");
    D.righe = [];
    D.righe.push({ t: _t("tileSheet.pdf.summary", { tiles: R.tessere, colors: nColori, families: fam.length, shapes: nForme }, "{tiles} tessere · {colors} colori esatti in {families} famiglie · {shapes} forme diverse") });
    D.righe.push({ t: _t("tileSheet.pdf.area", { area: _num(area / 100, 1) }, "Area complessiva delle scatole: {area} cm²") });
    var nFile = R.fileChiusi + R.fileLinguette;
    D.righe.push({
      t:
        R.fileLinguette > 0
          ? _t("tileSheet.pdf.filesBoth", { n: nFile, closed: R.fileChiusi, tabs: R.fileLinguette }, "File da taglio: {n} ({closed} chiusi + {tabs} con linguetta)")
          : _t("tileSheet.pdf.files", { n: nFile }, "File da taglio: {n}")
    });
    D.righe.push({
      t: _t(
        "tileSheet.pdf.grids",
        {
          list: R.famiglie
            .map(function (F) {
              return F.nome + " " + F.matrici;
            })
            .join(" · ")
        },
        "Matrici per famiglia: {list}"
      )
    });
    D.righe.push({
      t:
        par.compensazione > 0
          ? _t("tileSheet.pdf.kerf", { c: _numBreve(par.compensazione, 2), mode: modo }, "Compensazione del taglio: +{c} mm su ogni misura, {mode}, SOLO nei file da taglio. In questo PDF le misure sono quelle vere.")
          : _t("tileSheet.pdf.kerfOff", null, "Compensazione del taglio spenta: i file da taglio hanno le misure vere.")
    });
    D.righe.push({
      t: _t(
        "tileSheet.pdf.sheet",
        {
          orient: (par.orientamento === "orizzontale" ? _t("tileSheet.modal.sheet.landscape", null, "Orizzontale") : _t("tileSheet.modal.sheet.portrait", null, "Verticale")).toLowerCase(),
          m: _numBreve(par.margine, 2),
          gap: _numBreve(par.spazio, 2),
          st: _numBreve(par.stacco, 2),
          align: par.allineamento === "alto" ? _t("tileSheet.modal.align.top", null, "in alto") : _t("tileSheet.modal.align.bottom", null, "in basso")
        },
        "Foglio A4 {orient} · margine {m} mm · spazio {gap} mm · stacco {st} mm · tessere allineate {align}"
      )
    });
    if (R.fuori > 0) D.righe.push({ avviso: true, t: _t("tileSheet.pdf.outOfSize", { n: R.fuori }, "⚠ {n} tessere sono troppo grandi per un A4 con questi margini: non sono nelle tavole né negli SVG, ma sono contate nella distinta.") });
    if (R.nonCompensate > 0) D.righe.push({ avviso: true, t: _t("tileSheet.modal.preview.notGrown", { n: R.nonCompensate }, "⚠ {n} tessere senza compensazione (la forma non si può allargare): nei file restano con la misura vera.") });
    if (R.senzaLinguetta > 0) D.righe.push({ avviso: true, t: _t("tileSheet.modal.preview.noTab", { n: R.senzaLinguetta }, "⚠ {n} tessere senza linguetta (nessun lato dritto abbastanza lungo): nel file con linguette restano chiuse.") });
    var esc = R.escluse.tratti + R.escluse.sfondo + R.escluse.nascoste + R.escluse.nonTagliabili;
    if (esc > 0) D.righe.push({ t: _t("tileSheet.modal.preview.excluded", { n: esc }, "Esclusi {n} oggetti che non sono tessere da tagliare (tratti, acquerello, timbro, sfondo, oggetti nascosti o non tagliabili).") });
    D.stampa = _t("tileSheet.pdf.print", null, "Stampa al 100% («dimensione effettiva», senza adattamento alla pagina): la barra nera qui sotto deve misurare 100 mm col calibro.");
    D.barra = _t("tileSheet.pdf.ruler", null, "← 100 mm →");
    D.titoloColori = _t("tileSheet.pdf.colors.title", null, "COLORI — per comprare la gomma");
    D.col = {
      hex: _t("tileSheet.pdf.col.hex", null, "HEX"),
      rgb: _t("tileSheet.pdf.col.rgb", null, "RGB"),
      famiglia: _t("tileSheet.pdf.col.family", null, "famiglia"),
      tessere: _t("tileSheet.pdf.col.tiles", null, "tessere"),
      nota: _t("tileSheet.pdf.col.note", null, "note")
    };
    D.titoloDistinta = _t("tileSheet.pdf.bom.title", null, "DISTINTA");
    D.notaDistinta = _t(
      "tileSheet.pdf.bom.note",
      null,
      "Misure VERE della forma con la base orizzontale, al decimo di millimetro: quelle che il laser taglia. L'inspector conta in più un contorno di 1 px che non c'è, quindi può dire qualche decimo in più."
    );
    D.segue = _t("tileSheet.pdf.band.cont", null, "(segue)");
    D.nomeForma = function (r) {
      return _nomeForma(r.forma);
    };
    D.misura = function (r) {
      return _t("tileSheet.pdf.size", { w: _num(r.w, 1), h: _num(r.h, 1) }, "{w} × {h} mm");
    };
    D.conta = function (r) {
      return _t("tileSheet.pdf.count", { n: r.n }, "× {n}");
    };
    D.extra = _testoExtraRiga;
    return D;
  }

  // ── le pagine delle INFORMAZIONI: tutto va a capo e si impagina da sé ──

  function pagineInfo(D, par) {
    var W = par.W,
      H = par.H,
      M = PDF_MARGINE_INFO,
      L = W - 2 * M;
    var pagine = [],
      pag = null,
      y = 0;
    function nuova() {
      pag = { tipo: "info", voci: [] };
      pagine.push(pag);
      y = M;
      if (pagine.length > 1) {
        pag.voci.push(_testo(M, y + 2.6, 2.6, D.titolo, { colore: PDF_GRIGIO, larg: L * 0.6 }));
        pag.voci.push(_testo(W - M, y + 2.6, 2.6, "", { allinea: "right", colore: PDF_GRIGIO, larg: L * 0.38, paginaDi: true }));
        y += 7;
      }
    }
    // true se ha dovuto voltare pagina
    function posto(h) {
      if (!pag || y + h > H - M + EPS) {
        nuova();
        return true;
      }
      return false;
    }
    function paragrafo(testo, s, opz) {
      var lh = s * 1.45;
      _avvolgi(testo, s, L).forEach(function (r) {
        posto(lh);
        pag.voci.push(_testo(M, y + s * 0.95, s, r, Object.assign({ larg: L }, opz || {})));
        y += lh;
      });
    }
    // un titolo non resta mai da solo in fondo alla pagina: si porta
    // dietro almeno 20 mm di quello che lo segue
    function titoletto(t) {
      if (y > M + 8) y += 3;
      posto(7 + 20);
      pag.voci.push(_testo(M, y + 4, 4, t, { peso: "bold", larg: L }));
      y += 7;
    }

    nuova();
    // il titolo va a capo anche lui: il nome del progetto può essere lungo
    var righeTitolo = _avvolgi(D.titolo, 5.4, L);
    righeTitolo.forEach(function (r, k) {
      pag.voci.push(_testo(M, y + 5.4 + k * 7, 5.4, r, { peso: "bold", larg: L }));
    });
    y += 8.7 + (righeTitolo.length - 1) * 7;
    pag.voci.push(_testo(M, y + 2.8, 2.8, "", { colore: PDF_GRIGIO, larg: L, paginaDi: true, base: D.sottotitolo }));
    y += 7;
    D.righe.forEach(function (r) {
      paragrafo(r.t, 3, r.avviso ? { colore: PDF_AVVISO } : null);
    });
    // la barra di controllo della stampa: nera piena, un bordo solo (202)
    y += 2;
    paragrafo(D.stampa, 3, { peso: "bold" });
    posto(10);
    pag.voci.push(_rett(M, y + 1.5, 100, 3, "#000000", null, 0));
    pag.voci.push(_testo(M + 103, y + 4.2, 3, D.barra, { larg: L - 103 }));
    y += 8;

    // la tabella dei colori
    var CX = { hex: 8, rgb: 30, fam: 60, n: 90, nota: 114 };
    function testataColori() {
      var yb = y + 3.6;
      pag.voci.push(_testo(M + CX.hex, yb, 2.6, D.col.hex, { colore: PDF_GRIGIO, larg: CX.rgb - CX.hex - 1 }));
      pag.voci.push(_testo(M + CX.rgb, yb, 2.6, D.col.rgb, { colore: PDF_GRIGIO, larg: CX.fam - CX.rgb - 1 }));
      pag.voci.push(_testo(M + CX.fam, yb, 2.6, D.col.famiglia, { colore: PDF_GRIGIO, larg: CX.n - CX.fam - 1 }));
      pag.voci.push(_testo(M + CX.n, yb, 2.6, D.col.tessere, { colore: PDF_GRIGIO, larg: CX.nota - CX.n - 1 }));
      pag.voci.push(_testo(M + CX.nota, yb, 2.6, D.col.nota, { colore: PDF_GRIGIO, larg: L - CX.nota }));
      pag.voci.push(_rett(M, y + 5, L, 0.15, "#999999", null, 0));
      y += 5.6;
    }
    titoletto(D.titoloColori);
    testataColori();
    D.colori.forEach(function (c) {
      var note = c.nota ? _avvolgi(c.nota, 2.6, L - CX.nota) : [];
      var h = Math.max(6, 2.4 + note.length * 3.6);
      if (posto(h)) testataColori();
      var yb = y + 4.1;
      pag.voci.push(_rett(M, y + 0.9, 6, 4.2, c.riempi || "#FFFFFF", "#333333", 0.1));
      pag.voci.push(_testo(M + CX.hex, yb, 2.9, c.hex, { peso: "bold", larg: CX.rgb - CX.hex - 1 }));
      pag.voci.push(_testo(M + CX.rgb, yb, 2.9, c.rgb, { larg: CX.fam - CX.rgb - 1 }));
      pag.voci.push(_testo(M + CX.fam, yb, 2.9, c.famiglia, { larg: CX.n - CX.fam - 1 }));
      pag.voci.push(_testo(M + CX.n, yb, 2.9, String(c.tessere), { larg: CX.nota - CX.n - 1 }));
      note.forEach(function (r, k) {
        pag.voci.push(_testo(M + CX.nota, yb + k * 3.6, 2.6, r, { colore: PDF_GRIGIO, larg: L - CX.nota }));
      });
      y += h;
    });

    // la distinta
    var DX = { forma: 5, misura: 42, n: 73, extra: 90 };
    function testataBlocco(b, segue) {
      pag.voci.push(_rett(M, y + 1.2, 3.4, 3.4, b.riempi || "#FFFFFF", "#333333", 0.1));
      pag.voci.push(_testo(M + DX.forma, y + 4.2, 3.2, b.testata + (segue ? " " + D.segue : ""), { peso: "bold", larg: L - DX.forma }));
      y += 6;
    }
    titoletto(D.titoloDistinta);
    paragrafo(D.notaDistinta, 2.7, { colore: PDF_GRIGIO });
    y += 1;
    D.distinta.forEach(function (b) {
      posto(6 + 4.4); // la testata non resta orfana
      testataBlocco(b, false);
      b.righe.forEach(function (r) {
        if (posto(4.4)) testataBlocco(b, true);
        var yb = y + 3.2;
        pag.voci.push(_testo(M + DX.forma, yb, 2.9, D.nomeForma(r), { larg: DX.misura - DX.forma - 1 }));
        pag.voci.push(_testo(M + DX.misura, yb, 2.9, D.misura(r), { larg: DX.n - DX.misura - 1 }));
        pag.voci.push(_testo(M + DX.n, yb, 2.9, D.conta(r), { peso: "bold", larg: DX.extra - DX.n - 1 }));
        var ex = D.extra(r);
        if (ex) pag.voci.push(_testo(M + DX.extra, yb, 2.7, ex, { colore: PDF_GRIGIO, larg: L - DX.extra }));
        y += 4.4;
      });
      y += 2;
    });
    return pagine;
  }

  /**
   * Il PDF intero, come descrizione pura: { name, orientation, W, H,
   * pagine: [{ tipo, voci }], tavole, info }. Niente si disegna qui.
   */
  function costruisciPdf(o) {
    var par = o.par;
    var piene = par.pdfTessere !== "contorno";
    var pagine = o.tavole.map(function (tv) {
      return paginaTavola(tv, par, o.perId, piene);
    });
    var nTavole = pagine.length;
    var info = pagineInfo(datiInfo(o), par);
    pagine = pagine.concat(info);
    // i numeri di pagina, ora che si sa quante sono
    var N = pagine.length;
    pagine.forEach(function (pg, i) {
      var pt = _t("tileSheet.pdf.pageOf", { page: i + 1, pages: N }, "pagina {page} di {pages}");
      pg.voci.forEach(function (v) {
        if (v.paginaDi) v.t = v.base ? v.base + " · " + pt : pt;
      });
    });
    var suff = slug(_t("tileSheet.file.pdfSuffix", null, "tavola")) || "tavola";
    var baseP = slug(nomeProgetto());
    return {
      name: (baseP ? baseP + "_" + suff : suff) + ".pdf",
      orientation: par.orientamento === "orizzontale" ? "landscape" : "portrait",
      W: par.W,
      H: par.H,
      pagine: pagine,
      tavole: nTavole,
      info: info.length
    };
  }

  // ── il disegno: una pagina sulla tela, in PIXEL ──
  // kx e ky sono i pixel per mm in orizzontale e in verticale: la pagina
  // PNG ha un numero intero di pixel (2480 × 3508) e main.js la stende
  // ESATTAMENTE su un A4 (larghezza E altezza), quindi 1 mm della pagina è
  // kx pixel in x e ky in y. Differiscono dello 0,016%: 1,6 µm su 10 mm, ma
  // così la stampa al 100% è 1:1 su tutti e due i lati per costruzione.

  function _tracciaContorni(ctx, contorni, kx, ky) {
    ctx.beginPath();
    contorni.forEach(function (ct) {
      ctx.moveTo(ct.p0.x * kx, ct.p0.y * ky);
      ct.segs.forEach(function (s) {
        if (s.t === "L") ctx.lineTo(s.p.x * kx, s.p.y * ky);
        else ctx.bezierCurveTo(s.c1.x * kx, s.c1.y * ky, s.c2.x * kx, s.c2.y * ky, s.p.x * kx, s.p.y * ky);
      });
      ctx.closePath();
    });
  }

  function disegnaPagina(ctx, pagina, kx, ky, wpx, hpx) {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
    ctx.fillStyle = "#FFFFFF";
    ctx.fillRect(0, 0, wpx, hpx);
    ctx.lineJoin = "miter";
    ctx.miterLimit = 10;
    ctx.lineCap = "butt";
    var k = (kx + ky) / 2;
    pagina.voci.forEach(function (v) {
      if (v.k === "forma") {
        _tracciaContorni(ctx, v.contorni, kx, ky);
        // pari/dispari: un foro è un foro qualunque sia il suo verso, come
        // per il laser che taglia tutti e due i contorni
        if (v.riempi) {
          ctx.fillStyle = v.riempi;
          ctx.fill("evenodd");
        }
        if (v.bordo && v.spessore > 0) {
          ctx.strokeStyle = v.bordo;
          ctx.lineWidth = Math.max(1, v.spessore * k);
          ctx.stroke();
        }
      } else if (v.k === "rett") {
        var x = v.x * kx,
          y = v.y * ky,
          w = v.w * kx,
          h = v.h * ky;
        if (v.riempi) {
          ctx.fillStyle = v.riempi;
          ctx.fillRect(x, y, w, h);
        }
        if (v.bordo && v.spessore > 0) {
          ctx.strokeStyle = v.bordo;
          ctx.lineWidth = Math.max(1, v.spessore * k);
          ctx.strokeRect(x, y, w, h);
        }
      } else if (v.k === "testo" && v.t) {
        ctx.font = (v.peso === "bold" ? "bold " : "") + (v.s * ky).toFixed(1) + "px " + PDF_FONT;
        ctx.fillStyle = v.colore;
        ctx.textAlign = v.allinea === "right" ? "right" : "left";
        ctx.textBaseline = "alphabetic";
        // la larghezza massima STRINGE il testo invece di tagliarlo: nessuna
        // parola si perde, anche se la stima del layout è stata ottimista
        if (v.larg > 0) ctx.fillText(v.t, v.x * kx, v.y * ky, v.larg * kx);
        else ctx.fillText(v.t, v.x * kx, v.y * ky);
      }
    });
  }

  function _pngDi(cnv) {
    return new Promise(function (resolve, reject) {
      try {
        // toBlob codifica il PNG fuori dal filo principale: la finestra non
        // si blocca mentre le pagine si preparano
        if (typeof cnv.toBlob === "function" && typeof FileReader !== "undefined") {
          cnv.toBlob(function (blob) {
            if (!blob) {
              try {
                resolve(cnv.toDataURL("image/png"));
              } catch (e) {
                reject(e);
              }
              return;
            }
            var fr = new FileReader();
            fr.onload = function () {
              resolve(String(fr.result));
            };
            fr.onerror = function () {
              reject(fr.error || new Error("PNG illeggibile"));
            };
            fr.readAsDataURL(blob);
          }, "image/png");
          return;
        }
        resolve(cnv.toDataURL("image/png"));
      } catch (e) {
        reject(e);
      }
    });
  }

  /**
   * Disegna le pagine del PDF e le restituisce come dataURL PNG, una alla
   * volta sulla STESSA tela (una sola pagina in memoria alla volta).
   * avanzamento(k, n) si chiama prima di ogni pagina.
   */
  async function rasterizzaPdf(pdf, avanzamento) {
    var wpx = Math.round((pdf.W * PDF_DPI) / 25.4),
      hpx = Math.round((pdf.H * PDF_DPI) / 25.4);
    var cnv = document.createElement("canvas");
    cnv.width = wpx;
    cnv.height = hpx;
    var ctx = cnv.getContext("2d");
    if (!ctx) throw new Error("tela 2D non disponibile");
    var kx = wpx / pdf.W,
      ky = hpx / pdf.H;
    var out = [];
    try {
      for (var i = 0; i < pdf.pagine.length; i++) {
        if (typeof avanzamento === "function") avanzamento(i + 1, pdf.pagine.length);
        // un respiro fra una pagina e l'altra: il toast si aggiorna
        await new Promise(function (r) {
          setTimeout(r, 0);
        });
        disegnaPagina(ctx, pdf.pagine[i], kx, ky, wpx, hpx);
        out.push(await _pngDi(cnv));
      }
    } finally {
      // la tela di una pagina A4 a 300 DPI pesa 35 MB: si libera subito
      cnv.width = 0;
      cnv.height = 0;
    }
    return out;
  }

  // ═══════════════════════════════════════════════════════════
  //  FETTA 4 — LA DISTINTA IN CSV (§4.15 del cantiere della Tavola,
  //  §6.2 del cantiere «La Bottega»)
  //  ---------------------------------------------------------------
  //  Una tabella in testo semplice da aprire con Excel o LibreOffice:
  //  una riga d'intestazione, poi una riga per ogni riga della distinta
  //  del PDF (stesso colore, stessa forma, stesse misure al decimo, stesse
  //  misure in più → una riga), nello stesso ordine. Nessuna riga dei
  //  totali: una tabella pulita si ordina e si filtra, e la somma la fa il
  //  foglio di calcolo. Ogni riga ripete famiglia, HEX e RGB, così resta
  //  giusta anche dopo averla ordinata per un'altra colonna.
  //  ⚠ Il separatore dipende dalla lingua (tileSheet.csv.sep): «;» in
  //  italiano, perché la virgola è dei decimali; «,» in inglese. Una
  //  casella che contiene il separatore, le virgolette o un a capo si
  //  chiude fra virgolette (RFC 4180): l'RGB «133, 84, 227» in inglese.
  //  ⚠ UTF-8 con la BOM: senza, l'Excel di Windows apre il file come se
  //  fosse nella vecchia codifica occidentale e «°» diventa «Â°». main.js
  //  scrive il testo in UTF-8 così com'è: la BOM arriva sul disco.
  // ═══════════════════════════════════════════════════════════

  var CSV_BOM = "\uFEFF";
  var CSV_A_CAPO = "\r\n";

  function _sepCsv() {
    var s = _t("tileSheet.csv.sep", null, ";");
    return s === ";" || s === "," || s === "\t" ? s : ";";
  }

  // Una casella. ⚠ Una casella che comincia con = + - @ Excel la prende per
  // una FORMULA: nessuna delle nostre ci comincia (misure positive, nomi e
  // note della lingua, esadecimali col #), ma l'id di una texture viene dal
  // file del progetto: l'apostrofo davanti la tiene testo, per sicurezza.
  function _cellaCsv(v, sep) {
    var s = v == null ? "" : String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
    if (s.indexOf(sep) >= 0 || /["\r\n]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
    return s;
  }

  /**
   * La distinta come CSV: { name, content, righe, sep }. `righe` sono le
   * righe della distinta (l'intestazione esclusa). Pura: niente disegno,
   * niente DOM, niente canvas toccato.
   */
  function costruisciCsv(fam) {
    var sep = _sepCsv();
    var testata = [
      _t("tileSheet.csv.col.family", null, "Famiglia"),
      _t("tileSheet.pdf.col.hex", null, "HEX"),
      _t("tileSheet.pdf.col.rgb", null, "RGB"),
      _t("tileSheet.csv.col.shape", null, "Forma"),
      _t("tileSheet.csv.col.width", null, "Larghezza (mm)"),
      _t("tileSheet.csv.col.height", null, "Altezza (mm)"),
      _t("tileSheet.csv.col.count", null, "Quantità"),
      _t("tileSheet.csv.col.extra", null, "Misure in più"),
      _t("tileSheet.csv.col.note", null, "Note")
    ];
    var righe = [];
    fam.forEach(function (F) {
      var nomeF = nomeVisibile(F);
      F.colori.forEach(function (C) {
        var ic = _infoColore(C);
        righeDistinta(C).forEach(function (r) {
          righe.push([nomeF, ic.hex || "", ic.rgb || "", _nomeForma(r.forma), _num(r.w, 1), _num(r.h, 1), String(r.n), _testoExtraRiga(r), ic.nota]);
        });
      });
    });
    var testo =
      CSV_BOM +
      [testata]
        .concat(righe)
        .map(function (celle) {
          return celle
            .map(function (c) {
              return _cellaCsv(c, sep);
            })
            .join(sep);
        })
        .join(CSV_A_CAPO) +
      CSV_A_CAPO;
    var suff = slug(_t("tileSheet.file.csvSuffix", null, "distinta")) || "distinta";
    var baseP = slug(nomeProgetto());
    return { name: (baseP ? baseP + "_" + suff : suff) + ".csv", content: testo, righe: righe.length, sep: sep };
  }

  // ═══════════════════════════════════════════════════════════
  //  PARTE 3 — IL MODALE E IL SALVATAGGIO
  //  Il pulsante e il modale stanno in index.html; questo modulo li
  //  accende (come selectionTools.js). Nessun listener
  //  globale di tastiera: l'ESC lo gestisce già renderer.js per ogni
  //  div[id$="Modal"].
  // ═══════════════════════════════════════════════════════════

  function _t(key, params, fallback) {
    try {
      if (window.i18n && typeof window.i18n.t === "function") {
        var v = window.i18n.t(key, params);
        if (v !== key) return v;
      }
    } catch (_) {}
    var s = fallback != null ? String(fallback) : key;
    if (params) {
      s = s.replace(/\{(\w+)\}/g, function (m, k) {
        return Object.prototype.hasOwnProperty.call(params, k) ? String(params[k]) : m;
      });
    }
    return s;
  }

  function _toast(msg, opts) {
    try {
      if (typeof flashToast === "function") {
        flashToast(msg, opts || {});
        return;
      }
    } catch (_) {}
    console.log("[tileSheet]", msg);
  }

  var CHIAVE_PARAMETRI = "mosaica_tileSheet_params";

  function caricaParametri() {
    try {
      var s = window.localStorage && window.localStorage.getItem(CHIAVE_PARAMETRI);
      if (s) {
        var p = JSON.parse(s);
        delete p.soloSelezionate; // l'interruttore si decide ogni volta dalla selezione
        return p;
      }
    } catch (_) {}
    return {};
  }

  function salvaParametri(p) {
    try {
      if (!window.localStorage) return;
      window.localStorage.setItem(
        CHIAVE_PARAMETRI,
        JSON.stringify({
          orientamento: p.orientamento,
          margine: p.margine,
          spazio: p.spazio,
          stacco: p.stacco,
          allineamento: p.allineamento,
          compensazione: p.compensazione,
          crescita: p.crescita,
          contorni: p.contorni,
          taglietto: p.taglietto,
          pdfTessere: p.pdfTessere,
          distintaCsv: p.distintaCsv
        })
      );
    } catch (_) {}
  }

  function $(id) {
    return document.getElementById(id);
  }

  function _radio(name) {
    var el = document.querySelector('input[name="' + name + '"]:checked');
    return el ? el.value : null;
  }

  function leggiParametri() {
    return normalizzaParametri({
      orientamento: _radio("tileSheetOrient") === "landscape" ? "orizzontale" : "verticale",
      allineamento: _radio("tileSheetAlign") === "top" ? "alto" : "basso",
      margine: $("tileSheetMargin") ? $("tileSheetMargin").value : undefined,
      spazio: $("tileSheetGap") ? $("tileSheetGap").value : undefined,
      stacco: $("tileSheetGridGap") ? $("tileSheetGridGap").value : undefined,
      soloSelezionate: $("tileSheetOnlySelected") ? $("tileSheetOnlySelected").checked : false,
      compensazione: $("tileSheetKerf") ? $("tileSheetKerf").value : undefined,
      crescita: _radio("tileSheetGrowth") === "proportional" ? "proporzione" : "fascia",
      contorni: _radio("tileSheetOutlines") === "closed" ? "chiusi" : "entrambi",
      taglietto: $("tileSheetTab") ? $("tileSheetTab").value : undefined,
      pdfTessere: _radio("tileSheetPdfFill") === "outline" ? "contorno" : "colorate",
      // senza la casella (index.html di prima) vale il valore di partenza
      distintaCsv: $("tileSheetCsv") ? $("tileSheetCsv").checked : undefined
    });
  }

  function scriviParametri(p) {
    var q = normalizzaParametri(p);
    var o = document.querySelector('input[name="tileSheetOrient"][value="' + (q.orientamento === "orizzontale" ? "landscape" : "portrait") + '"]');
    if (o) o.checked = true;
    var a = document.querySelector('input[name="tileSheetAlign"][value="' + (q.allineamento === "alto" ? "top" : "bottom") + '"]');
    if (a) a.checked = true;
    if ($("tileSheetMargin")) $("tileSheetMargin").value = q.margine;
    if ($("tileSheetGap")) $("tileSheetGap").value = q.spazio;
    if ($("tileSheetGridGap")) $("tileSheetGridGap").value = q.stacco;
    if ($("tileSheetKerf")) $("tileSheetKerf").value = q.compensazione;
    var g = document.querySelector('input[name="tileSheetGrowth"][value="' + (q.crescita === "proporzione" ? "proportional" : "band") + '"]');
    if (g) g.checked = true;
    var c = document.querySelector('input[name="tileSheetOutlines"][value="' + (q.contorni === "chiusi" ? "closed" : "both") + '"]');
    if (c) c.checked = true;
    if ($("tileSheetTab")) $("tileSheetTab").value = q.taglietto;
    var pf = document.querySelector('input[name="tileSheetPdfFill"][value="' + (q.pdfTessere === "contorno" ? "outline" : "filled") + '"]');
    if (pf) pf.checked = true;
    if ($("tileSheetCsv")) $("tileSheetCsv").checked = q.distintaCsv;
    _campiTaglio();
  }

  // Il taglietto serve solo se ci sono i file con linguetta.
  function _campiTaglio() {
    var tab = $("tileSheetTab");
    if (tab) tab.disabled = _radio("tileSheetOutlines") === "closed";
  }

  // Quante TESSERE ci sono nella selezione attiva (non oggetti qualsiasi).
  function tessereSelezionate() {
    var cv = _canvas();
    if (!cv || typeof cv.getActiveObjects !== "function") return 0;
    var n = 0;
    cv.getActiveObjects().forEach(function (o) {
      if (!motivoEsclusione(o)) n++;
    });
    return n;
  }

  function _escapeHtml(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  var _ultimoRisultato = null;

  function aggiornaAnteprima() {
    var box = $("tileSheetPreview");
    if (!box) return;
    var par = leggiParametri();
    var ris;
    try {
      ris = genera(par);
    } catch (e) {
      box.textContent = _t("toast.tileSheet.error", { msg: e.message || String(e) }, "❌ Errore tavola: {msg}");
      _ultimoRisultato = null;
      return;
    }
    _ultimoRisultato = ris;
    var r = ris.riepilogo;
    var html = [];
    if (!r.famiglie.length) {
      html.push("<div>" + _escapeHtml(_t("tileSheet.modal.preview.empty", null, "Nessuna tessera da mettere in tavola.")) + "</div>");
    }
    r.famiglie.forEach(function (F) {
      var quadrati = F.colori
        .slice(0, 12)
        .map(function (c) {
          var col = c.stroke || "#888";
          return (
            '<span style="display:inline-block;width:11px;height:11px;border-radius:2px;margin-right:3px;vertical-align:-1px;' +
            "background:" + _escapeHtml(col) + ';border:1px solid rgba(255,255,255,0.35)"></span>'
          );
        })
        .join("");
      html.push(
        '<div style="margin:3px 0">' + quadrati + " " +
          _escapeHtml(
            _t(
              "tileSheet.modal.preview.family",
              { name: F.nome, tiles: F.tessere, grids: F.matrici, sheets: F.fogli },
              "{name} — tessere: {tiles} · matrici: {grids} · fogli A4: {sheets}"
            )
          ) +
          "</div>"
      );
    });
    var pr = r.parametri; // normalizzati (leggiParametri dà i grezzi del modale)
    html.push(
      '<div style="margin-top:8px;opacity:0.8">' +
        _escapeHtml(
          r.fileLinguette > 0
            ? _t(
                "tileSheet.modal.preview.filesBoth",
                { n: ris.files.length, closed: r.fileChiusi, tabs: r.fileLinguette },
                "File SVG da creare: {n} ({closed} chiusi + {tabs} con linguetta)"
              )
            : _t("tileSheet.modal.preview.files", { n: ris.files.length }, "File SVG da creare: {n}")
        ) +
        "</div>"
    );
    // Fetta 3: il PDF — quante pagine, e se sfora il tetto lo dice PRIMA
    var pd = r.pdf;
    if (pd) {
      html.push(
        '<div style="margin-top:4px;' + (pd.troppe ? "color:#ffb347" : "opacity:0.8") + '">' +
          _escapeHtml(
            pd.troppe
              ? _t(
                  "tileSheet.modal.preview.pdfTooLong",
                  { pages: pd.pagine, max: MAX_PAGINE_PDF },
                  "⚠ Il PDF avrebbe {pages} pagine, oltre il tetto di {max}: si creano solo gli SVG."
                )
              : _t(
                  "tileSheet.modal.preview.pdf",
                  { name: pd.nome, pages: pd.pagine, sheets: pd.tavole, info: pd.info },
                  "PDF: {name} — {pages} pagine ({sheets} tavole 1:1 + {info} con colori e distinta)"
                )
          ) +
          "</div>"
      );
    }
    // Fetta 4: la distinta in CSV, se l'interruttore è acceso
    if (r.csv) {
      html.push(
        '<div style="margin-top:4px;opacity:0.8">' +
          _escapeHtml(
            _t(
              "tileSheet.modal.preview.csv",
              { name: r.csv.nome, rows: r.csv.righe },
              "CSV: {name} — {rows} righe di distinta (per Excel e LibreOffice)"
            )
          ) +
          "</div>"
      );
    }
    html.push(
      '<div style="margin-top:4px;opacity:0.8">' +
        _escapeHtml(
          pr.compensazione > 0
            ? _t(
                "tileSheet.modal.preview.kerf",
                {
                  c: fmt(pr.compensazione),
                  mode:
                    pr.crescita === "proporzione"
                      ? _t("tileSheet.modal.preview.mode.proportional", null, "in proporzione")
                      : _t("tileSheet.modal.preview.mode.band", null, "a fascia")
                },
                "Compensazione: +{c} mm su ogni misura, {mode} (solo nei file da taglio)"
              )
            : _t("tileSheet.modal.preview.kerfOff", null, "Compensazione spenta: i file da taglio hanno le misure vere")
        ) +
        "</div>"
    );
    if (r.nonCompensate > 0) {
      html.push(
        '<div style="margin-top:4px;color:#ffb347">' +
          _escapeHtml(
            _t(
              "tileSheet.modal.preview.notGrown",
              { n: r.nonCompensate },
              "⚠ {n} tessere senza compensazione (la forma non si può allargare): nei file restano con la misura vera."
            )
          ) +
          "</div>"
      );
    }
    if (r.senzaLinguetta > 0) {
      html.push(
        '<div style="margin-top:4px;color:#ffb347">' +
          _escapeHtml(
            _t(
              "tileSheet.modal.preview.noTab",
              { n: r.senzaLinguetta },
              "⚠ {n} tessere senza linguetta (nessun lato dritto abbastanza lungo): nel file con linguette restano chiuse."
            )
          ) +
          "</div>"
      );
    }
    if (r.fuori > 0) {
      html.push(
        '<div style="margin-top:4px;color:#ffb347">' +
          _escapeHtml(
            _t("tileSheet.modal.preview.outOfSize", { n: r.fuori }, "⚠ {n} tessere sono troppo grandi per un A4 con questi margini: restano fuori.")
          ) +
          "</div>"
      );
    }
    var esc = r.escluse.tratti + r.escluse.sfondo + r.escluse.nascoste + r.escluse.nonTagliabili;
    if (esc > 0) {
      html.push(
        '<div style="margin-top:4px;opacity:0.7">' +
          _escapeHtml(
            _t(
              "tileSheet.modal.preview.excluded",
              { n: esc },
              "Esclusi {n} oggetti che non sono tessere da tagliare (tratti, acquerello, timbro, sfondo, oggetti nascosti o non tagliabili)."
            )
          ) +
          "</div>"
      );
    }
    box.innerHTML = html.join("");
    var ok = $("tileSheetConfirmBtn");
    if (ok) ok.disabled = !ris.files.length;
  }

  function apri() {
    var modal = $("tileSheetModal");
    if (!modal) return;
    scriviParametri(Object.assign({}, DEFAULT_PARAMETRI, caricaParametri()));
    var nSel = tessereSelezionate();
    var chk = $("tileSheetOnlySelected");
    if (chk) {
      chk.disabled = nSel < 1;
      // acceso di partenza con almeno DUE tessere selezionate (decisione di Mirko)
      chk.checked = nSel >= 2;
    }
    var lbl = $("tileSheetOnlySelectedCount");
    if (lbl) lbl.textContent = String(nSel);
    modal.style.display = "flex";
    // Il fuoco va sul modale (tabindex="-1" in index.html): il pulsante del
    // menu appena cliccato NON deve restare il bersaglio dei tasti (193).
    try {
      modal.focus({ preventScroll: true });
    } catch (_) {}
    aggiornaAnteprima();
  }

  function chiudi() {
    var modal = $("tileSheetModal");
    if (modal) {
      modal.style.display = "none";
      try {
        if (modal.contains(document.activeElement)) document.activeElement.blur();
      } catch (_) {}
    }
    _ultimoRisultato = null;
  }

  var _inCorso = false;

  async function conferma() {
    if (_inCorso) return;
    var par = leggiParametri();
    salvaParametri(par);
    var api = window.desktopAPI;
    if (!api || typeof api.exportTileSheet !== "function") {
      // main.js e preload.js nuovi si attivano solo riavviando l'app
      _toast(_t("toast.tileSheet.noApi", null, "❌ Riavvia Mosaica: il canale dei file della tavola non è ancora attivo"), { duration: 6000 });
      return;
    }
    var ris;
    try {
      ris = genera(par);
    } catch (e) {
      console.error("[tileSheet]", e);
      _toast(_t("toast.tileSheet.error", { msg: e.message || String(e) }, "❌ Errore tavola: {msg}"));
      return;
    }
    if (!ris.files.length) {
      _toast(_t("toast.tileSheet.empty", null, "❌ Nessuna tessera da mettere in tavola"));
      return;
    }
    if (ris.files.length > MAX_FILE) {
      _toast(_t("toast.tileSheet.tooMany", { n: ris.files.length, max: MAX_FILE }, "❌ Troppi file ({n}): la tavola si ferma a {max}"));
      return;
    }
    chiudi();
    _inCorso = true;
    _toast(_t("toast.tileSheet.working", null, "⏳ Preparazione della tavola delle tessere…"));
    try {
      // Fetta 3: prima si disegnano le pagine del PDF (la tela si usa solo
      // qui, mai nell'anteprima). Se il PDF non riesce o sfora il tetto, gli
      // SVG per il laser si scrivono lo stesso e il toast finale lo dice.
      var pdf = null,
        avvisoPdf = "";
      if (ris.pdf) {
        try {
          var pagine = await rasterizzaPdf(ris.pdf, function (k, n) {
            _toast(_t("toast.tileSheet.pdfPage", { n: k, tot: n }, "⏳ PDF: pagina {n} di {tot}…"));
          });
          pdf = { name: ris.pdf.name, orientation: ris.pdf.orientation, pages: pagine };
          // dopo la scelta della cartella main.js impagina il PDF (qualche
          // secondo con molte pagine): il toast non deve restare fermo
          // sull'ultima pagina come se si fosse bloccato
          _toast(
            _t("toast.tileSheet.pdfReady", { pages: pagine.length }, "⏳ PDF pronto ({pages} pagine): scegli la cartella, poi si scrivono i file…"),
            { duration: 15000 }
          );
        } catch (e) {
          console.error("[tileSheet] PDF:", e);
          avvisoPdf = _t("toast.tileSheet.pdfFailed", { msg: e.message || String(e) }, "⚠ PDF non creato: {msg}");
        }
      } else if (ris.riepilogo.pdf && ris.riepilogo.pdf.troppe) {
        avvisoPdf = _t(
          "toast.tileSheet.pdfTooLong",
          { pages: ris.riepilogo.pdf.pagine, max: MAX_PAGINE_PDF },
          "⚠ PDF non creato: {pages} pagine, oltre il tetto di {max}"
        );
      }
      // Fetta 4: la distinta in CSV viaggia coi file di testo, dopo gli SVG
      // (il canale di main.js accetta i .csv dalla Fetta 1)
      var fileTesto = ris.csv ? ris.files.concat([{ name: ris.csv.name, content: ris.csv.content }]) : ris.files;
      var payload = {
        files: fileTesto,
        testi: {
          title: _t("tileSheet.dialog.title", null, "Scegli la cartella per la tavola delle tessere"),
          overwriteQuestion: _t(
            "tileSheet.dialog.overwriteQuestion",
            null,
            "Nella cartella ci sono già {n} file con lo stesso nome. Vuoi sovrascriverli?"
          ),
          overwrite: _t("tileSheet.dialog.overwrite", null, "Sovrascrivi"),
          cancel: _t("tileSheet.dialog.cancel", null, "Annulla")
        }
      };
      if (pdf) payload.pdf = pdf;
      var r = await api.exportTileSheet(payload);
      if (!r) return; // annullato dall'utente
      if (r.ok) {
        _toast(
          _t("toast.tileSheet.done", { n: r.written.length, dir: r.dir }, "✅ Tavola delle tessere: {n} file creati in {dir}") +
            (avvisoPdf ? " · " + avvisoPdf : ""),
          { duration: avvisoPdf ? 9000 : 6000 }
        );
      } else {
        _toast(_t("toast.tileSheet.error", { msg: r.error || "?" }, "❌ Errore tavola: {msg}"), { duration: 6000 });
      }
    } catch (e) {
      console.error("[tileSheet]", e);
      _toast(_t("toast.tileSheet.error", { msg: e.message || String(e) }, "❌ Errore tavola: {msg}"));
    } finally {
      _inCorso = false;
    }
  }

  function inizializzaUI() {
    var btn = $("exportTileSheetBtn");
    if (btn) btn.addEventListener("click", apri);
    var modal = $("tileSheetModal");
    if (!modal) return;
    modal.addEventListener("click", function (e) {
      if (e.target === modal) chiudi();
    });
    ["tileSheetCloseBtn", "tileSheetCancelBtn"].forEach(function (id) {
      var b = $(id);
      if (b) b.addEventListener("click", chiudi);
    });
    var ok = $("tileSheetConfirmBtn");
    if (ok) ok.addEventListener("click", conferma);
    modal.addEventListener("change", function (e) {
      if (e.target && e.target.tagName === "INPUT") {
        _campiTaglio();
        aggiornaAnteprima();
      }
    });
    // ⚠ Trappola 193: keyboardShortcuts.js ignora i tasti solo dentro un
    // <input>. Con un modale aperto e il fuoco altrove, Backspace/Canc
    // CANCELLEREBBERO le tessere selezionate dietro il modale (e le frecce
    // le sposterebbero). Il modale è focalizzabile e i tasti che nascono
    // dentro di lui non arrivano al document — tranne ESC, che serve al
    // gestore globale di renderer.js per chiuderlo. Nessun listener
    // globale: questo sta sul NOSTRO elemento.
    modal.addEventListener("keydown", function (e) {
      if (e.key === "Escape") return;
      e.stopPropagation();
      if (e.key === "Enter" && e.target && e.target.tagName === "INPUT") {
        e.preventDefault();
        aggiornaAnteprima();
      }
    });
    // la lingua cambia a modale aperto → i nomi delle famiglie cambiano
    try {
      if (window.i18n && typeof window.i18n.on === "function") {
        window.i18n.on("language:changed", function () {
          if (modal.style.display === "flex") aggiornaAnteprima();
        });
      }
    } catch (_) {}
  }

  window.tileSheet = {
    apri: apri,
    genera: genera,
    distinta: distinta,
    famiglieColore: famiglieColore,
    __test: {
      parseColore: parseColore,
      chiaveColore: chiaveColore,
      hexDi: hexDi,
      suBianco: suBianco,
      hsl: hsl,
      fasciaDi: fasciaDi,
      nomeFamiglia: nomeFamiglia,
      FASCE: FASCE,
      SOGLIA_NEUTRI: SOGLIA_NEUTRI,
      mul: mul,
      estremiCubica: estremiCubica,
      scatolaContorni: scatolaContorni,
      geoRettangolo: geoRettangolo,
      geoEllisse: geoEllisse,
      geoPoligono: geoPoligono,
      geoPath: geoPath,
      impagina: impagina,
      confrontaPezzi: confrontaPezzi,
      scriviSvg: scriviSvg,
      dContorni: dContorni,
      slug: slug,
      fmt: fmt,
      normalizzaParametri: normalizzaParametri,
      raccogli: raccogli,
      raggruppa: raggruppa,
      geometriaPezzo: geometriaPezzo,
      motivoEsclusione: motivoEsclusione,
      DEFAULT_PARAMETRI: DEFAULT_PARAMETRI,
      STACCO_MINIMO: STACCO_MINIMO,
      MAX_FILE: MAX_FILE,
      // Fetta 2
      pezziDi: pezziDi,
      contornoDaPezzi: contornoDaPezzi,
      puntoPezzo: puntoPezzo,
      tagliaPezzo: tagliaPezzo,
      areaPezzi: areaPezzi,
      segnaFori: segnaFori,
      siIntreccia: siIntreccia,
      fasciaCubica: fasciaCubica,
      scartoFascia: scartoFascia,
      fasciaContorno: fasciaContorno,
      cresciContorni: cresciContorni,
      latiDritti: latiDritti,
      apriContorno: apriContorno,
      perIlTaglio: perIlTaglio,
      trasformaContorno: trasformaContorno,
      SCARTO_CURVE: SCARTO_CURVE,
      TETTO_PUNTA: TETTO_PUNTA,
      MARGINE_LINGUETTA: MARGINE_LINGUETTA,
      // Fetta 3
      formaDi: formaDi,
      righeDistinta: righeDistinta,
      costruisciPdf: costruisciPdf,
      disegnaPagina: disegnaPagina,
      rasterizzaPdf: rasterizzaPdf,
      MAX_PAGINE_PDF: MAX_PAGINE_PDF,
      PDF_DPI: PDF_DPI,
      // Fetta 4
      costruisciCsv: costruisciCsv,
      _cellaCsv: _cellaCsv,
      _infoColore: _infoColore
    }
  };

  if (typeof document !== "undefined") {
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", inizializzaUI);
    else inizializzaUI();
  }

  console.log("[tileSheet] Tavola delle tessere pronta");
})();