/* ============================================================================
 * proceduralTextures.js  —  Texture generate da codice per Mosaica Workspace Pro
 * ----------------------------------------------------------------------------
 * Canvas2D PURO. Nessuna dipendenza da Fabric -> valido da Fabric 5.1.0 a 5.3.0.
 * Ogni texture e' un <canvas> NxN, seamless (ripetibile senza giunte), generato
 * in modo DETERMINISTICO (stesso seed -> stessa immagine). Si aggancia al
 * sistema texture esistente come una qualsiasi "sorgente":
 *   - thumbnail nel #textureGrid
 *   - al click -> applyTextureToObject(obj, canvas, dataURL) (percorso invariato)
 *   - i pixel generati finiscono nel registro e quindi nel file salvato, percio'
 *     un progetto riaperto ritrova la texture identica (anche su PC diversi).
 *
 * Due "famiglie":
 *   - OPACHE (granito, marmo, cemento, murano): la STRUTTURA sta nella luminanza;
 *     la ruota colore (HSL tono-base) la colora -> granito blu, marmo rosso, ecc.
 *   - CON ALPHA (eva, venature): la struttura sta nel canale alpha; il colore
 *     riempie pulito (bianco = bianco), lo sfondo della tessera traspare nei
 *     punti piu' trasparenti.
 * ==========================================================================*/
(function (global) {
  "use strict";

  var SIZE = 256; // lato sorgente (px). Leggero; su una tessera se ne vede una porzione.

  // ---- PRNG deterministico (mulberry32) -----------------------------------
  function mulberry32(a) {
    return function () {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function smooth(t) { return t * t * (3 - 2 * t); }
  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

  // ---- Rumore di valore TILEABLE (somma di ottave) ------------------------
  // Reticolo freq x freq con wrap; interpolazione smoothstep -> niente giunte.
  function makeLattice(freq, rnd) {
    var g = new Float32Array(freq * freq);
    for (var i = 0; i < g.length; i++) g[i] = rnd();
    return g;
  }
  function sampleLattice(g, freq, u, v) {
    var x = u * freq, y = v * freq;
    var ix = Math.floor(x), iy = Math.floor(y);
    var x0 = ((ix % freq) + freq) % freq, y0 = ((iy % freq) + freq) % freq;
    var x1 = (x0 + 1) % freq, y1 = (y0 + 1) % freq;
    var fx = smooth(x - ix), fy = smooth(y - iy);
    var a = g[y0 * freq + x0], b = g[y0 * freq + x1];
    var c = g[y1 * freq + x0], d = g[y1 * freq + x1];
    var ab = a + (b - a) * fx, cd = c + (d - c) * fx;
    return ab + (cd - ab) * fy;
  }
  // Ritorna funzione (u,v in [0,1)) -> ~[0,1]. octaves di frequenza raddoppiata.
  function fractal(seed, baseFreq, octaves, persistence) {
    var rnd = mulberry32(seed);
    var layers = [];
    var f = baseFreq, amp = 1, norm = 0;
    for (var o = 0; o < octaves; o++) {
      layers.push({ g: makeLattice(f, rnd), freq: f, amp: amp });
      norm += amp; f *= 2; amp *= persistence;
    }
    return function (u, v) {
      var s = 0;
      for (var i = 0; i < layers.length; i++) {
        s += sampleLattice(layers[i].g, layers[i].freq, u, v) * layers[i].amp;
      }
      return s / norm;
    };
  }
  
  // ---- Campo CELLULARE tileable (Worley F1) -------------------------------
  // Punti-feature jitterati su griglia cells x cells che WRAPPA ai bordi (toro)
  // -> superficie a "cellula chiusa" ripetibile senza giunte e deterministica.
  // f(u,v) in ~[0,1]: ~0 al centro cella (incavo = poro), ~1 sul muro tra celle.
  function cellularF1(seed, cells) {
    var rnd = mulberry32(seed);
    var px = new Float32Array(cells * cells);
    var py = new Float32Array(cells * cells);
    for (var i = 0; i < cells * cells; i++) { px[i] = rnd(); py[i] = rnd(); }
    return function (u, v) {
      var gx = u * cells, gy = v * cells;
      var cx = Math.floor(gx), cy = Math.floor(gy);
      var best = 1e9;
      for (var oy = -1; oy <= 1; oy++) {
        for (var ox = -1; ox <= 1; ox++) {
          var ix = cx + ox, iy = cy + oy;
          var wx = ((ix % cells) + cells) % cells; // indice cella wrappato
          var wy = ((iy % cells) + cells) % cells;
          var idx = wy * cells + wx;
          // posizione punto-feature riportata vicino al campione (continuita' toroidale)
          var fx = ix + px[idx], fy = iy + py[idx];
          var dx = gx - fx, dy = gy - fy, dd = dx * dx + dy * dy;
          if (dd < best) best = dd;
        }
      }
      var d1 = Math.sqrt(best); // distanza in unita' di cella (0 = sul punto)
      return d1 < 0 ? 0 : d1 > 1 ? 1 : d1;
    };
  }

  // ---- Utility canvas ------------------------------------------------------
  function newCanvas(N) {
    if (typeof document !== "undefined" && document.createElement) {
      var c = document.createElement("canvas");
      c.width = N; c.height = N;
      return c;
    }
    // Node (anteprime): canvas iniettato dall'harness via global.__np_createCanvas
    if (global.__np_createCanvas) return global.__np_createCanvas(N, N);
    throw new Error("Nessun backend canvas disponibile");
  }
  // Disegna fn 9 volte (toro) -> feature discrete (vene, bolle, granuli) seamless.
  function wrapDraw(ctx, N, fn) {
    var offs = [-N, 0, N];
    for (var i = 0; i < 3; i++) {
      for (var j = 0; j < 3; j++) {
        ctx.save();
        ctx.translate(offs[i], offs[j]);
        fn();
        ctx.restore();
      }
    }
  }

  // ==========================================================================
  // GENERATORI
  // Ognuno ritorna un <canvas> SIZE x SIZE. ctx ottenuto con willReadFrequently.
  // ==========================================================================

// --- EVA gomma (ALPHA): superficie a CELLULA CHIUSA "buccia di mandarino".
  // La STRUTTURA dei pori sta nella LUMINANZA (non piu' nell'alpha): cosi' la
  // ricolorazione del renderer (Lf = Lt + (L-meanL)*relief) la rende come vero
  // rilievo visibile, non come tinta piatta. Modello: rete di muri tra le celle
  // (piu' chiari) + incavo/poro al centro (piu' scuro), passo ~1.1 mm a span
  // default (14 mm), denso e uniforme. Alpha alta e quasi uniforme -> gomma
  // opaca, lo sfondo tessera traspara pochissimo (nessun "buco" sui pori).
  // Tutto seamless (campo cellulare tileable + frattali tileable) e deterministico.
  function genEVA(N, seed) {
    var c = newCanvas(N), ctx = c.getContext("2d", { willReadFrequently: true });
    var img = ctx.createImageData(N, N), d = img.data;

    // ---- Parametri regolabili (tarati a span default 14 mm) -----------------
    var BASE_RGB    = 150;  // grigio neutro medio -> colorabile pulito dalla ruota
    var CELLS       = 12;   // celle per lato: passo ~14/12 = 1.17 mm (pori entro 1.2 mm)
    var CELL_RELIEF = 66;   // contrasto luminanza muro<->incavo = profondita' dei pori
    var RIDGE_GAMMA = 0.80; // <1 ingrossa i muri / restringe i pori (rete piu' marcata)
    var MICRO_AMP   = 9;    // micro-ruvidita' matte fine sopra le celle
    var MOTTLE_AMP  = 7;    // disuniformita' molto blanda a grande scala
    var A_BASE      = 252;  // alpha alta: la gomma e' opaca, lo sfondo traspara poco
    var A_MICRO     = 8;    // lievissima modulazione alpha (matte traslucente)

    var pore   = cellularF1(seed, CELLS);        // celle chiuse (Worley F1, tileable)
    var micro  = fractal(seed + 13, 48, 3, 0.5); // micro-grana fine (tileable)
    var mottle = fractal(seed + 31, 4, 2, 0.5);  // nuvola larga tenue (tileable)

    for (var y = 0; y < N; y++) {
      for (var x = 0; x < N; x++) {
        var u = x / N, v = y / N, k = (y * N + x) * 4;
        var mu = micro(u, v);
        // profilo poro: 0 al centro cella (incavo), 1 sul muro tra celle
        var w = Math.pow(pore(u, v), RIDGE_GAMMA);
        var L = BASE_RGB
              + (w - 0.5) * CELL_RELIEF       // <-- rilievo nei pori (in LUMINANZA)
              + (mu - 0.5) * MICRO_AMP
              + (mottle(u, v) - 0.5) * MOTTLE_AMP;
        d[k] = d[k + 1] = d[k + 2] = clamp(Math.round(L), 0, 255);
        d[k + 3] = clamp(Math.round(A_BASE - mu * A_MICRO), 0, 255);
      }
    }
    ctx.putImageData(img, 0, 0);
    return c;
  }

  // --- Granito / pietrisco (OPACA): fondo medio + granuli chiari/scuri sparsi.
  function genGranito(N, seed) {
    var c = newCanvas(N), ctx = c.getContext("2d", { willReadFrequently: true });
    var img = ctx.createImageData(N, N), d = img.data;
    var mottle = fractal(seed, 6, 3, 0.5);   // macchie morbide del fondo
    var grain = fractal(seed + 3, 40, 2, 0.5); // grana fine
    for (var y = 0; y < N; y++) {
      for (var x = 0; x < N; x++) {
        var u = x / N, v = y / N, k = (y * N + x) * 4;
        var L = 150 + (mottle(u, v) - 0.5) * 44 + (grain(u, v) - 0.5) * 26;
        L = clamp(L, 0, 255);
        d[k] = d[k + 1] = d[k + 2] = L;
        d[k + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    // Granuli (feldspato chiaro, mica/biotite scura) come piccoli rettangoli.
    var rnd = mulberry32(seed + 99);
    var count = Math.round(N * N * 0.012);
    wrapDraw(ctx, N, function () {
      for (var i = 0; i < count; i++) {
        var gx = rnd() * N, gy = rnd() * N;
        var s = 1 + Math.floor(rnd() * 3);
        var dark = rnd() < 0.5;
        var lum = dark ? 45 + Math.floor(rnd() * 35) : 205 + Math.floor(rnd() * 45);
        ctx.fillStyle = "rgba(" + lum + "," + lum + "," + lum + "," + (0.55 + rnd() * 0.4).toFixed(3) + ")";
        ctx.fillRect(gx, gy, s, s);
      }
    });
    return c;
  }

  // --- Marmo venato (OPACA): corpo chiaro nuvoloso + venature scure ramificate.
  function genMarmo(N, seed) {
    var c = newCanvas(N), ctx = c.getContext("2d", { willReadFrequently: true });
    var img = ctx.createImageData(N, N), d = img.data;
    var cloud = fractal(seed, 4, 5, 0.6);
    for (var y = 0; y < N; y++) {
      for (var x = 0; x < N; x++) {
        var u = x / N, v = y / N, k = (y * N + x) * 4;
        var L = 214 + (cloud(u, v) - 0.5) * 60; // corpo chiaro
        L = clamp(L, 0, 255);
        d[k] = d[k + 1] = d[k + 2] = L;
        d[k + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    // Vene organiche MORBIDE: 2 madri affusolate + rami, grigio medio, sfocate
    // leggermente e a bassa opacita' -> venatura naturale, non graffiata.
    var layer = buildVeinLayer(N, seed + 21, { mains: 2, branches: 3, mainW: 9, color: [96, 96, 102] });
    compositeVeins(ctx, N, layer, 0.5, 1.1);
    return c;
  }

  // --- Marmo bianco a vene nette (OPACA): corpo quasi bianco, vene scure NITIDE.
  // (sostituisce le ex "venature trasparenti": tessera PIENA, non velata).
  function genMarmoBianco(N, seed) {
    var c = newCanvas(N), ctx = c.getContext("2d", { willReadFrequently: true });
    var img = ctx.createImageData(N, N), d = img.data;
    var cloud = fractal(seed, 5, 4, 0.55);
    for (var y = 0; y < N; y++) {
      for (var x = 0; x < N; x++) {
        var u = x / N, v = y / N, k = (y * N + x) * 4;
        var L = 238 + (cloud(u, v) - 0.5) * 18; // corpo quasi bianco, nuvola tenue
        L = clamp(L, 0, 255);
        d[k] = d[k + 1] = d[k + 2] = L;
        d[k + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    // Vene NETTE: 2 madri + rami, grigio scuro, NIENTE sfocatura, alta opacita'.
    var layer = buildVeinLayer(N, seed + 33, { mains: 2, branches: 3, mainW: 7, color: [58, 60, 70] });
    compositeVeins(ctx, N, layer, 0.9, 0);
    return c;
  }

  // --- Cemento / grana fine (OPACA): base chiara neutra, rumore tenue ed uniforme.
  // Ottima base "pastello" da colorare.
  function genCemento(N, seed) {
    var c = newCanvas(N), ctx = c.getContext("2d", { willReadFrequently: true });
    var img = ctx.createImageData(N, N), d = img.data;
    var fine = fractal(seed, 30, 3, 0.5);
    var mott = fractal(seed + 11, 5, 2, 0.5);
    for (var y = 0; y < N; y++) {
      for (var x = 0; x < N; x++) {
        var u = x / N, v = y / N, k = (y * N + x) * 4;
        var L = 206 + (fine(u, v) - 0.5) * 14 + (mott(u, v) - 0.5) * 10;
        L = clamp(L, 0, 255);
        d[k] = d[k + 1] = d[k + 2] = L;
        d[k + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    return c;
  }

  // --- Pastevite di Murano (OPACA): vetro/smalto. Colore nuvoloso, qualche
  // riflesso morbido (lucentezza) e micro-bolle. La luminanza porta il "vetro";
  // la ruota da' il colore (smalto blu, verde acqua, ambra...).
  function genMurano(N, seed) {
    var c = newCanvas(N), ctx = c.getContext("2d", { willReadFrequently: true });
    var img = ctx.createImageData(N, N), d = img.data;
    var swirl = fractal(seed, 3, 4, 0.6);     // velature del vetro
    var fine = fractal(seed + 9, 18, 2, 0.5); // grana finissima
    for (var y = 0; y < N; y++) {
      for (var x = 0; x < N; x++) {
        var u = x / N, v = y / N, k = (y * N + x) * 4;
        var L = 150 + (swirl(u, v) - 0.5) * 70 + (fine(u, v) - 0.5) * 12;
        L = clamp(L, 0, 255);
        d[k] = d[k + 1] = d[k + 2] = L;
        d[k + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    // Riflessi morbidi (lucentezza) come blob radiali chiari, seamless.
    var rnd = mulberry32(seed + 71);
    wrapDraw(ctx, N, function () {
      var n = 3;
      for (var i = 0; i < n; i++) {
        var gx = rnd() * N, gy = rnd() * N, r = N * (0.16 + rnd() * 0.18);
        var grad = ctx.createRadialGradient(gx, gy, 0, gx, gy, r);
        grad.addColorStop(0, "rgba(255,255,255," + (0.16 + rnd() * 0.12).toFixed(3) + ")");
        grad.addColorStop(1, "rgba(255,255,255,0)");
        ctx.fillStyle = grad;
        ctx.beginPath(); ctx.arc(gx, gy, r, 0, Math.PI * 2); ctx.fill();
      }
    });
    // Micro-bolle (puntini con orlo scuro e centro chiaro).
    wrapDraw(ctx, N, function () {
      var nb = Math.round(N * 0.10);
      for (var i = 0; i < nb; i++) {
        var bx = rnd() * N, by = rnd() * N, br = 0.8 + rnd() * 1.8;
        ctx.fillStyle = "rgba(60,60,60,0.30)";
        ctx.beginPath(); ctx.arc(bx, by, br, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = "rgba(255,255,255,0.55)";
        ctx.beginPath(); ctx.arc(bx - br * 0.25, by - br * 0.25, br * 0.5, 0, Math.PI * 2); ctx.fill();
      }
    });
    return c;
  }

  // ---- VENE ORGANICHE: motore condiviso (marmo venato + marmo bianco) ------
  // Costruisce un LAYER trasparente NxN con le vene OPACHE nel colore o.color.
  // Vene madri affusolate (spesse al centro, sottili alle estremita') con
  // andamento dolce (deriva a bassa frequenza, non graffiato) + rami sottili.
  // Disegno toroidale (wrapDraw) -> continuita' delle vene tra tessere adiacenti.
  // L'alpha/la morbidezza si applicano DOPO in composizione, cosi' niente
  // "perline" da sovrapposizione di tratti.
  // o: { mains, branches, mainW, color:[r,g,b] }
  function buildVeinLayer(N, seed, o) {
    var lc = newCanvas(N), lx = lc.getContext("2d", { willReadFrequently: true });
    var rnd = mulberry32(seed);
    lx.fillStyle = "rgb(" + o.color[0] + "," + o.color[1] + "," + o.color[2] + ")";
    lx.strokeStyle = lx.fillStyle;
    lx.lineCap = "round";
    lx.lineJoin = "round";
    function tangent(pts, i) {
      var a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
      var dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy) || 1;
      return [dx / L, dy / L];
    }
    function vein(sx, sy, ang, length, maxW, gen) {
      var pts = [], ws = [], x = sx, y = sy, a = ang, step = 12;
      var steps = Math.max(8, Math.round(length / step));
      var ph = rnd() * 6.283, ph2 = rnd() * 6.283;
      for (var s = 0; s <= steps; s++) {
        pts.push([x, y]);
        var t = s / steps;
        // profilo larghezza: sottile-spesso-sottile (sin) + leggera irregolarita'
        var w = maxW * (0.16 + 0.84 * Math.sin(Math.PI * t)) * (0.85 + 0.3 * rnd());
        ws.push(Math.max(0.5, w));
        // andamento dolce: deriva sinusoidale a bassa freq + micro-rumore
        a += Math.sin(ph + t * 2.2) * 0.09 + Math.sin(ph2 + t * 5.0) * 0.045 + (rnd() - 0.5) * 0.08;
        x += Math.cos(a) * step;
        y += Math.sin(a) * step;
      }
      // tratti a piena opacita' (niente doppioni): la trasparenza arriva dopo.
      wrapDraw(lx, N, function () {
        for (var i = 0; i < pts.length - 1; i++) {
          lx.lineWidth = (ws[i] + ws[i + 1]) * 0.5;
          lx.beginPath();
          lx.moveTo(pts[i][0], pts[i][1]);
          lx.lineTo(pts[i + 1][0], pts[i + 1][1]);
          lx.stroke();
        }
      });
      // rami sottili che si staccano con angolo dolce
      if (gen < 2) {
        for (var b = 0; b < o.branches; b++) {
          if (rnd() < 0.8) {
            var bi = 2 + Math.floor(rnd() * (pts.length - 3));
            var ta = tangent(pts, bi);
            var bang = Math.atan2(ta[1], ta[0]) + (rnd() < 0.5 ? -1 : 1) * (0.45 + rnd() * 0.5);
            vein(pts[bi][0], pts[bi][1], bang, length * (0.35 + rnd() * 0.3), maxW * (0.4 + rnd() * 0.18), gen + 1);
          }
        }
      }
    }
    for (var m = 0; m < o.mains; m++) {
      var edge = Math.floor(rnd() * 4), sx, sy, ang;
      if (edge === 0) { sx = rnd() * N; sy = -6; ang = Math.PI * (0.25 + rnd() * 0.5); }
      else if (edge === 1) { sx = N + 6; sy = rnd() * N; ang = Math.PI * (0.75 + rnd() * 0.5); }
      else if (edge === 2) { sx = rnd() * N; sy = N + 6; ang = Math.PI * (1.25 + rnd() * 0.5); }
      else { sx = -6; sy = rnd() * N; ang = Math.PI * (-0.25 + rnd() * 0.5); }
      vein(sx, sy, ang, N * 1.6, o.mainW, 0);
    }
    return lc;
  }

  // Sfoca un layer in modo SEAMLESS: lo affianca 3x3, sfoca il grande e ritaglia
  // il centro -> il bordo eredita il contenuto del vicino (niente giunte).
  function blurSeamless(layer, N, px) {
    var big = newCanvas(N * 3), bx = big.getContext("2d");
    for (var i = 0; i < 3; i++) for (var j = 0; j < 3; j++) bx.drawImage(layer, i * N, j * N);
    var out = newCanvas(N), ox = out.getContext("2d");
    ox.filter = "blur(" + px + "px)";
    ox.drawImage(big, -N, -N);
    ox.filter = "none";
    return out;
  }

  // Compone un layer vene sul ctx con alpha e (opzionale) sfocatura seamless.
  function compositeVeins(ctx, N, layer, alpha, blurPx) {
    var src = blurPx > 0 ? blurSeamless(layer, N, blurPx) : layer;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.drawImage(src, 0, 0);
    ctx.restore();
  }

  // ==========================================================================
  // REGISTRO GENERATORI  (id stabile, etichette IT/EN, seed fisso = riproducibile)
  // ==========================================================================
  var GENERATORS = [
    { id: "proc_eva",      kind: "alpha",  seed: 1011, gen: genEVA,      it: "Gomma EVA",            en: "EVA foam" },
    { id: "proc_murano",   kind: "opaque", seed: 2022, gen: genMurano,   it: "Pastevitree Murano",   en: "Murano glass paste" },
    { id: "proc_granito",  kind: "opaque", seed: 3033, gen: genGranito,  it: "Granito",              en: "Granite" },
    { id: "proc_marmo",    kind: "opaque", seed: 4044, gen: genMarmo,    it: "Marmo venato",         en: "Veined marble" },
    { id: "proc_cemento",  kind: "opaque", seed: 5055, gen: genCemento,  it: "Cemento (grana fine)", en: "Concrete (fine grain)" },
    { id: "proc_marmo_bianco", kind: "opaque", seed: 6066, gen: genMarmoBianco, it: "Marmo bianco (vene nette)", en: "White marble (sharp veins)" }
  ];

  // Genera UN canvas dato l'id. Cache in-memory (1 sola generazione per sessione).
  var _cache = {};
  function generateCanvas(id) {
    if (_cache[id]) return _cache[id];
    var g = null;
    for (var i = 0; i < GENERATORS.length; i++) if (GENERATORS[i].id === id) g = GENERATORS[i];
    if (!g) return null;
    var c = g.gen(SIZE, g.seed);
    _cache[id] = c;
    return c;
  }

  // API per il renderer: lista { id, label, kind, canvas, dataURL }.
  function list(lang) {
    var out = [];
    for (var i = 0; i < GENERATORS.length; i++) {
      var g = GENERATORS[i];
      var canvas = generateCanvas(g.id);
      out.push({
        id: g.id,
        kind: g.kind,
        label: lang === "en" ? g.en : g.it,
        canvas: canvas,
        dataURL: canvas.toDataURL("image/png")
      });
    }
    return out;
  }

  var api = { SIZE: SIZE, GENERATORS: GENERATORS, generateCanvas: generateCanvas, list: list };

  if (typeof window !== "undefined") window.proceduralTextures = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);