// ============================================================
//  penTips.js — Mosaica Workspace Pro
//  Le punte PNG della penna (cantiere «Le Punte», Fetta 2, 26/09/2026)
// ------------------------------------------------------------
//  La penna resta vettoriale (decisione di Mirko, B1): un tratto è un
//  fabric.PressurePath, cioè punti + pressione. Un tratto con la punta ha
//  in più il NOME della punta (__tip) e i suoi parametri; quando Fabric lo
//  disegna, invece delle linee tonde timbra la PNG tinta lungo i punti.
//
//  Questo file fa quattro cose, e niente altro:
//   • tiene le punte caricate (una volta per punta) e sa dirne la
//     «parte visibile», cioè la scatola dei pixel non trasparenti;
//   • tinge una punta col colore del tratto (solo la trasparenza della
//     PNG conta, il colore si butta via — come per l'acquerello);
//   • timbra una punta lungo i punti di un tratto (UNA sola funzione,
//     pura e senza caso: lo stesso tratto viene uguale a ogni zoom);
//   • disegna un PressurePath che ha una punta (disegnaTratto), oppure
//     dice «non posso» e il PressurePath si disegna tondo come sempre.
//
//  Da dove arrivano le punte: da window.penTipsAPI.readTip(nome), il
//  canale che la Fetta 4 aggiunge in main.js/preload.js (B2: cartella
//  textures/penna/, una punta per volta). Finché il canale non c'è, le
//  punte si possono registrare a mano: window.penTips.registra(nome, png).
//
//  Una punta che non c'è (B4): il tratto si vede TONDO, tiene il suo nome
//  (se la punta torna, torna anche lui) e compare UN avviso per sessione.
//
//  Dalla Fetta 3 fa anche la «foto» di un tratto a punta per l'SVG di
//  «Esporta disegno mano libera» (B3, decisione di Mirko: fotoSVG).
//
//  Non tocca renderer.js né gli altri file protetti. Si accende da sé:
//  definisce window.penTips e basta (niente timer, trappola 206).
// ============================================================
(function () {
  "use strict";

  const SOGLIA_VISIBILE = 8; // alfa sotto cui un pixel della punta conta come vuoto
  const TINTE_MAX = 64; // come TINT_CACHE_MAX dell'acquerello
  const PASSO_MINIMO = 0.5; // px: sotto, i timbri sarebbero infiniti
  const TIMBRI_MAX = 20000; // tetto di sicurezza per un tratto solo

  // Valori di partenza dei parametri di un tratto a punta.
  const DI_PARTENZA = { spacing: 0.25, rotationDeg: 0, follow: false };

  // nome → { stato: "in arrivo" | "pronta" | "mancante", tela, vis, attese: [] }
  const punte = new Map();
  const tinte = new Map(); // "nome|colore" → tela tinta (LRU)
  let avvisoDato = false;

  function _t(key, params, fallback) {
    if (typeof __t === "function") return __t(key, params, fallback);
    let s = String(fallback != null ? fallback : key);
    if (params) s = s.replace(/\{(\w+)\}/g, (m, k) => (k in params ? String(params[k]) : m));
    return s;
  }

  function _nuovaTela(w, h) {
    const c = document.createElement("canvas");
    c.width = Math.max(1, Math.ceil(w));
    c.height = Math.max(1, Math.ceil(h));
    return c;
  }

  // La scatola dei pixel visibili della punta: la Larghezza del tratto è
  // il lato più lungo di questa scatola (niente «240 px magici», A6).
  function _misuraVisibile(tela) {
    const w = tela.width,
      h = tela.height;
    let dati;
    try {
      dati = tela.getContext("2d").getImageData(0, 0, w, h).data;
    } catch (_) {
      return { x: 0, y: 0, w, h };
    }
    let x0 = w,
      y0 = h,
      x1 = -1,
      y1 = -1;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (dati[(y * w + x) * 4 + 3] > SOGLIA_VISIBILE) {
          if (x < x0) x0 = x;
          if (x > x1) x1 = x;
          if (y < y0) y0 = y;
          if (y > y1) y1 = y;
        }
      }
    }
    if (x1 < 0) return null; // tutta trasparente: non è una punta
    return { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
  }

  function _decodifica(dataURL) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onerror = () => resolve(null);
      img.onload = () => {
        try {
          const tela = _nuovaTela(img.naturalWidth || img.width, img.naturalHeight || img.height);
          tela.getContext("2d").drawImage(img, 0, 0);
          resolve(tela);
        } catch (_) {
          resolve(null);
        }
      };
      img.src = dataURL;
    });
  }

  function _avvisaMancante(nome) {
    if (avvisoDato) return;
    avvisoDato = true;
    const n = String(nome).replace(/-/g, " ");
    const testo = _t(
      "toast.pen.tipMissing",
      { name: n },
      `⚠️ La punta «${n}» non c'è su questo computer: i tratti che la usano si vedono tondi`
    );
    if (typeof window.flashToast === "function") window.flashToast(testo);
    else if (typeof flashToast === "function") flashToast(testo);
  }

  function _chiudi(voce, stato, tela, vis) {
    voce.stato = stato;
    voce.tela = tela || null;
    voce.vis = vis || null;
    const attese = voce.attese.splice(0);
    for (const cb of attese) {
      try {
        cb(stato);
      } catch (e) {
        console.warn("[penTips] richiamo fallito:", e);
      }
    }
  }

  async function _carica(nome, voce) {
    let dataURL = null;
    try {
      if (window.penTipsAPI && typeof window.penTipsAPI.readTip === "function") {
        dataURL = await window.penTipsAPI.readTip(nome);
      }
    } catch (e) {
      console.warn("[penTips] lettura della punta fallita:", nome, e);
    }
    if (voce.stato !== "in arrivo") return; // registrata a mano nel frattempo
    const tela = dataURL ? await _decodifica(dataURL) : null;
    const vis = tela ? _misuraVisibile(tela) : null;
    if (voce.stato !== "in arrivo") return;
    if (!tela || !vis) {
      _chiudi(voce, "mancante");
      _avvisaMancante(nome);
      return;
    }
    _chiudi(voce, "pronta", tela, vis);
  }

  // Chiede una punta. cb(stato) arriva UNA volta, quando la punta è
  // pronta o si sa che manca. Se è già pronta o già mancante, niente cb.
  function chiedi(nome, cb) {
    if (!nome) return "mancante";
    nome = String(nome);
    let voce = punte.get(nome);
    if (!voce) {
      voce = { stato: "in arrivo", tela: null, vis: null, attese: [] };
      punte.set(nome, voce);
      if (typeof cb === "function") voce.attese.push(cb);
      _carica(nome, voce);
      return voce.stato;
    }
    if (voce.stato === "in arrivo" && typeof cb === "function") voce.attese.push(cb);
    return voce.stato;
  }

  function stato(nome) {
    const voce = punte.get(String(nome));
    return voce ? voce.stato : undefined;
  }

  // Registra una punta a mano (prove, e finché non c'è il canale della
  // Fetta 4). png: data-URL o una tela già fatta.
  async function registra(nome, png) {
    nome = String(nome);
    const tela = typeof png === "string" ? await _decodifica(png) : png;
    const vis = tela ? _misuraVisibile(tela) : null;
    if (!tela || !vis) return false;
    let voce = punte.get(nome);
    if (!voce) {
      voce = { stato: "in arrivo", tela: null, vis: null, attese: [] };
      punte.set(nome, voce);
    }
    for (const k of Array.from(tinte.keys())) if (k.startsWith(nome + "|")) tinte.delete(k);
    _chiudi(voce, "pronta", tela, vis);
    return true;
  }

  // Dimentica una punta (per riprovare a caricarla, es. dopo averla
  // rimessa nella cartella).
  function dimentica(nome) {
    punte.delete(String(nome));
    for (const k of Array.from(tinte.keys())) if (k.startsWith(nome + "|")) tinte.delete(k);
  }

  // La punta tinta col colore del tratto, oppure null se non è pronta.
  function tinta(nome, colore) {
    const voce = punte.get(String(nome));
    if (!voce || voce.stato !== "pronta") return null;
    const chiave = `${nome}|${colore}`;
    if (tinte.has(chiave)) {
      const t = tinte.get(chiave);
      tinte.delete(chiave);
      tinte.set(chiave, t);
      return t;
    }
    const t = _nuovaTela(voce.tela.width, voce.tela.height);
    const c = t.getContext("2d");
    c.drawImage(voce.tela, 0, 0);
    c.globalCompositeOperation = "source-in";
    c.fillStyle = colore || "#000";
    c.fillRect(0, 0, t.width, t.height);
    c.globalCompositeOperation = "source-over";
    t.__vis = voce.vis;
    tinte.set(chiave, t);
    if (tinte.size > TINTE_MAX) tinte.delete(tinte.keys().next().value);
    return t;
  }

  function _clamp01(v) {
    return v < 0 ? 0 : v > 1 ? 1 : v;
  }

  // ─── LA TIMBRATURA — una funzione sola, pura ────────────────────────────
  // Timbra la punta tinta lungo i punti. Nessun caso: stesso tratto, stesso
  // disegno. Usata dal PressurePath (e, dalla Fetta 3, dall'anteprima e
  // dall'anello).
  //   ctx         contesto già trasformato come vuole chi chiama
  //   pts         [{x, y, pressure}]
  //   tintaTela   la punta tinta (con __vis)
  //   o.offsetX/Y spostamento da aggiungere ai punti (-halfW/-halfH)
  //   o.width     Larghezza del tratto (lato lungo della parte visibile)
  //   o.minF/maxF/pressure  la curva della pressione del PressurePath
  //   o.spacing   distanza fra i timbri, in frazioni della larghezza
  //   o.rotationDeg  rotazione della punta, oraria col +
  //   o.follow    true: la punta gira con la direzione del tratto
  //   o.angles    angolo del tratto nei punti, in gradi (se follow)
  //   o.primo     indice del primo punto da timbrare (anteprima a pezzi),
  //   o.carry     con o.primo: il cammino fatto dall'ultimo timbro posato
  //   o.statoOut  se c'è, ci si scrive il carry finale (per il pezzo dopo)
  // Ritorna quanti timbri ha posato.
  function timbra(ctx, pts, tintaTela, o) {
    if (!ctx || !pts || !pts.length || !tintaTela) return 0;
    o = o || {};
    const vis = tintaTela.__vis || { x: 0, y: 0, w: tintaTela.width, h: tintaTela.height };
    const lato = Math.max(vis.w, vis.h) || 1;
    const cx = vis.x + vis.w / 2; // centro della parte visibile, in pixel della PNG
    const cy = vis.y + vis.h / 2;
    const ox = o.offsetX || 0,
      oy = o.offsetY || 0;
    const baseW = o.width > 0 ? o.width : 1;
    const pressione = o.pressure !== false;
    const minF = o.minF != null ? o.minF : 0.2;
    const maxF = o.maxF != null ? o.maxF : 1.2;
    const spacing = o.spacing > 0 ? o.spacing : DI_PARTENZA.spacing;
    const rotBase = ((o.rotationDeg || 0) * Math.PI) / 180;
    const segue = !!o.follow;
    const angoli = Array.isArray(o.angles) ? o.angles : null;

    const fattore = (pr) => (pressione ? minF + (maxF - minF) * _clamp01(pr != null ? pr : 0.5) : 1);
    const angoloIn = (i, dx, dy) => {
      if (!segue) return 0;
      if (angoli && Number.isFinite(angoli[i])) return (angoli[i] * Math.PI) / 180;
      return Math.atan2(dy, dx);
    };

    let posati = 0;
    const posa = (x, y, f, ang) => {
      const w = baseW * f;
      if (!(w > 0)) return;
      const s = w / lato;
      ctx.save();
      ctx.translate(x + ox, y + oy);
      const r = rotBase + ang;
      if (r) ctx.rotate(r);
      ctx.drawImage(tintaTela, -cx * s, -cy * s, tintaTela.width * s, tintaTela.height * s);
      ctx.restore();
      posati++;
    };

    // Un punto solo: un timbro.
    if (pts.length === 1) {
      const p = pts[0];
      posa(p.x, p.y, fattore(p.pressure), angoloIn(0, 1, 0));
      return posati;
    }

    // Lungo il tratto: il primo timbro sul primo punto, poi uno ogni
    // «spacing × larghezza locale» di cammino. Il cammino fatto dall'ultimo
    // timbro (carry) passa da un segmento al successivo, così la distanza
    // fra i timbri non dipende da quanti punti ha registrato il mouse.
    const primo = Math.max(1, o.primo | 0);
    let carry = 0;
    if (primo === 1) {
      const p0 = pts[0];
      posa(p0.x, p0.y, fattore(p0.pressure), angoloIn(0, pts[1].x - p0.x, pts[1].y - p0.y));
    } else if (Number.isFinite(o.carry)) {
      carry = o.carry;
    }
    for (let i = primo; i < pts.length && posati < TIMBRI_MAX; i++) {
      const a = pts[i - 1],
        b = pts[i];
      const dx = b.x - a.x,
        dy = b.y - a.y;
      const len = Math.hypot(dx, dy);
      if (!(len > 0)) continue;
      const pa = a.pressure != null ? a.pressure : 0.5;
      const pb = b.pressure != null ? b.pressure : 0.5;
      const ang = angoloIn(i - 1, dx, dy);
      let pos = 0; // dove siamo, dall'inizio del segmento
      while (posati < TIMBRI_MAX) {
        const f = fattore(pa + (pb - pa) * (pos / len));
        const passo = Math.max(PASSO_MINIMO, spacing * baseW * f);
        const manca = passo - carry; // cammino che manca al prossimo timbro
        if (pos + manca > len) {
          carry += len - pos;
          break;
        }
        pos += manca;
        carry = 0;
        const t = pos / len;
        posa(a.x + dx * t, a.y + dy * t, fattore(pa + (pb - pa) * t), ang);
      }
    }
    if (o.statoOut && typeof o.statoOut === "object") o.statoOut.carry = carry;
    return posati;
  }

  // ─── Disegnare un PressurePath che ha una punta ─────────────────────────
  // La chiama PressurePath._render (wacomTablet.js). Ritorna true se ha
  // disegnato; false se la punta non è pronta o manca: allora il tratto si
  // disegna tondo come sempre. Se la punta è in arrivo, appena arriva il
  // tratto si ridisegna da solo (dirty + requestRenderAll: trappola 225).
  function disegnaTratto(ctx, path, halfW, halfH) {
    if (!path || !path.__tip) return false;
    const nome = String(path.__tip);
    const st = chiedi(nome, () => {
      path.dirty = true;
      if (path.canvas && typeof path.canvas.requestRenderAll === "function") path.canvas.requestRenderAll();
    });
    if (st !== "pronta") return false;
    const t = tinta(nome, path.stroke || "#000");
    if (!t) return false;

    const opzioni = {
      offsetX: -halfW,
      offsetY: -halfH,
      width: path.strokeWidth || 1,
      pressure: path.__pressureEnabled !== false,
      minF: path.__pressureMinFactor,
      maxF: path.__pressureMaxFactor,
      spacing: path.__tipSpacing,
      rotationDeg: path.__tipRotationDeg,
      follow: path.__tipFollow === true,
      angles: path.__tipAngles
    };

    // Opacità una volta sola (§5.4): se il foglio sta già disegnando con
    // un'alfa < 1 (oggetto semitrasparente senza cache), i timbri si posano
    // pieni su una lastra e la lastra si posa con l'alfa. Altrimenti le
    // sovrapposizioni fra timbri farebbero macchie più scure.
    const alfa = ctx.globalAlpha;
    if (alfa < 1 && typeof ctx.getTransform === "function") {
      const m = ctx.getTransform();
      const sc = Math.max(Math.hypot(m.a, m.b), Math.hypot(m.c, m.d), 0.01);
      const W = halfW * 2,
        H = halfH * 2;
      const lastra = _nuovaTela(Math.min(W * sc, 8192), Math.min(H * sc, 8192));
      const k = lastra.width / Math.max(W, 1);
      const lc = lastra.getContext("2d");
      lc.scale(k, lastra.height / Math.max(H, 1));
      timbra(lc, path.points, t, Object.assign({}, opzioni, { offsetX: 0, offsetY: 0 }));
      ctx.save();
      ctx.drawImage(lastra, -halfW, -halfH, W, H);
      ctx.restore();
      return true;
    }

    ctx.save();
    timbra(ctx, path.points, t, opzioni);
    ctx.restore();
    return true;
  }

  // ─── La «foto» del tratto per l'SVG (B3, Mirko rev. 5) ──────────────────
  // Come l'acquerello: nell'SVG di «Esporta disegno mano libera» un tratto
  // a punta va come immagine, uguale a come si vede. Tre volte la
  // risoluzione del foglio, come l'export PNG (MULTIPLIER = 3 in renderer.js).
  // Ritorna l'elemento <image> in coordinate dell'oggetto (centro in 0,0),
  // oppure null se la punta non è pronta: allora le linee di sempre.
  const FOTO_SCALA = 3;
  function fotoSVG(path) {
    if (!path || !path.__tip || !path.points || !path.points.length) return null;
    const nome = String(path.__tip);
    if (stato(nome) !== "pronta") return null;
    const t = tinta(nome, path.stroke || "#000");
    if (!t) return null;
    const baseW = path.strokeWidth || 1;
    const W = (path.width || 1) + baseW,
      H = (path.height || 1) + baseW;
    const k = Math.max(1, Math.min(FOTO_SCALA, 8192 / Math.max(W, H)));
    const lastra = _nuovaTela(W * k, H * k);
    const lc = lastra.getContext("2d");
    lc.scale(lastra.width / W, lastra.height / H);
    timbra(lc, path.points, t, {
      offsetX: 0,
      offsetY: 0,
      width: baseW,
      pressure: path.__pressureEnabled !== false,
      minF: path.__pressureMinFactor,
      maxF: path.__pressureMaxFactor,
      spacing: path.__tipSpacing,
      rotationDeg: path.__tipRotationDeg,
      follow: path.__tipFollow === true,
      angles: path.__tipAngles
    });
    let url;
    try {
      url = lastra.toDataURL("image/png");
    } catch (_) {
      return null;
    }
    const f = (v) => (Math.round(v * 100) / 100).toString();
    return `\t<image x="${f(-W / 2)}" y="${f(-H / 2)}" width="${f(W)}" height="${f(H)}" preserveAspectRatio="none" xlink:href="${url}"/>\n`;
  }

  // I campi della punta da scrivere nel salvataggio (§5.3), oppure null se
  // il tratto non ha punta: allora si salva byte per byte come prima.
  function campiDaSalvare(path) {
    if (!path || !path.__tip) return null;
    const out = {
      __tip: String(path.__tip),
      __tipSpacing: path.__tipSpacing > 0 ? path.__tipSpacing : DI_PARTENZA.spacing,
      __tipRotationDeg: Number.isFinite(path.__tipRotationDeg) ? path.__tipRotationDeg : DI_PARTENZA.rotationDeg,
      __tipFollow: path.__tipFollow === true
    };
    if (out.__tipFollow && Array.isArray(path.__tipAngles)) {
      out.__tipAngles = path.__tipAngles.map((a) => (Number.isFinite(a) ? Math.round(a * 10) / 10 : 0));
    }
    return out;
  }

  window.penTips = {
    chiedi,
    stato,
    registra,
    dimentica,
    tinta,
    timbra,
    disegnaTratto,
    campiDaSalvare,
    fotoSVG,
    DI_PARTENZA: Object.freeze(Object.assign({}, DI_PARTENZA))
  };
})();
