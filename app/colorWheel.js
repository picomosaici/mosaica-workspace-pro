// colorWheel.js — LA RUOTA DEI COLORI di Mosaica (nel popup 🎨 del menu radiale).
// Cantiere «Tintometro», Fetta 4 (16 ottobre 2026).
//
// Detto con le mani: al posto della finestra colori di Windows, una ruota dentro il popup. L'anello sceglie
// la TINTA, il quadrato dentro sceglie quanto è piena (verso destra) e quanto è chiara (verso l'alto). Sotto,
// i numeri: esadecimale, RGB e i CMYK del profilo di stampa scelto (lo stesso della 🖨️ Prova di stampa),
// il tassello «in stampa» accanto a quello «a video», il segno ⚠ quando la stampa non arriva a quel colore,
// e il pulsante «Portalo in stampa» che lo sostituisce col più vicino che la stampa sa fare. Nel quadrato,
// a righe, la zona che la stampa non raggiunge: così si sceglie bene già alla fonte.
//
// Come parla a Mosaica: COME LE PASTIGLIE dei colori rapidi. Scrive #colorInput.value e manda «input»
// (l'anteprima sulle tessere) e «change» (la fine: un solo passo di Ctrl+Z, il toast, la porta di Texture
// Ghost). renderer.js fa quello che fa sempre: colore pieno, texture colorata, gruppi, multi-selezione.
//
// ⚠ Zero righe in renderer.js. Le porte: #colorInput e i suoi eventi, #colorPopup (lo apre e lo chiude
//   renderer.js: qui lo si guarda con un MutationObserver), window.colorAPI (motore colore, Fetta 1),
//   window.flashToast. E un nome di renderer.js letto e scritto con la guardia: isApplyingSnapshot.
// ⚠ Trappola 296: freehandDrawing.js fa un pushState a OGNI «input» di #colorInput. Con la finestra di
//   Windows arrivava un «input» solo, alla fine; trascinando la ruota ne arrivano decine al secondo, e ogni
//   pushState fotografa tutto il foglio: Ctrl+Z si riempirebbe di colori a metà e il trascinamento
//   arrancherebbe sui mosaici grandi. Gli «input» di questa ruota passano quindi con isApplyingSnapshot
//   acceso per un istante (lo stesso modo in cui renderer.js stesso ferma le sue fotografie): l'anteprima
//   si vede, la fotografia la fa una volta sola il «change» di renderer.js.
// ⚠ Fabric non si tocca: niente API di Fabric qui dentro (5.1.0 → 5.5.2 uguali).
//
// ── Fetta 4-bis (cantiere «Texture Ghost», 19 ottobre 2026) ──
// IL CONTAGOCCE: il pulsante accanto ai tasselli prende un colore dal foglio (tessere, sfondo, carta, disegno).
//   Clic sul foglio = il pixel sotto la punta; Shift+clic = la media dei pixel attorno (5×5); Esc o clic destro =
//   annulla. Il colore preso va dove va la ruota: alle tessere selezionate (un passo di Ctrl+Z, come la ruota)
//   oppure alla penna e all'acquerello. Un colpo solo: preso il colore, il contagocce si spegne.
//   ⚠ Il clic sul foglio si ferma PRIMA di Fabric e di renderer.js (in cattura su window): non seleziona, non
//   deseleziona, non disegna, non chiude il popup. Rotella e Alt+trascina passano: il foglio si muove lo stesso.
//   ⚠ La tela di Fabric non si legge MAI con getImageData: un pezzetto della tela bassa si copia su una tela
//   piccola, e si legge quella. È la strada della 🖨️ Prova di stampa (softProof.js, collaudata): letture dirette
//   ripetute possono far passare la tela di Fabric dalla scheda video al processore (trappola 309).
// LA PENNA E L'ACQUERELLO: la «Tinta» dell'ispettore (#strokeColorPicker) apre questa ruota invece della finestra
//   di Windows, col titolo «✏️ Colore della penna e dell'acquerello». In quel giro la ruota scrive
//   #strokeColorPicker, NON #colorInput: le tessere non si toccano; freehandDrawing.js cambia la Tinta, rifà il
//   pennello e salva le impostazioni del disegno; niente Ctrl+Z (il colore della penna non sta sul foglio). Anche
//   le pastiglie, in quel giro, vanno alla penna (trappola 310). Se colorWheel.js mancasse, la Tinta aprirebbe la
//   finestra di Windows come prima.
(function () {
  "use strict";
  if (window.colorWheel) return;

  const SIZE = 220; // lato della ruota, px CSS
  const RING_OUT = 109;
  const RING_IN = 91;
  const SQ_HALF = Math.floor((RING_IN - 5) / Math.SQRT2); // mezzo lato del quadrato dentro l'anello
  const GRID = 32; // celle per lato della mappa «dove la stampa non arriva»
  const KEY_MAP = "mosaica_colorWheel_gamutMap";

  const $ = (id) => document.getElementById(id);
  const T = (k, p, fb) => {
    try {
      if (window.i18n && typeof window.i18n.t === "function") {
        const s = window.i18n.t(k, p);
        if (s && s !== k) return s;
      }
    } catch (_) {}
    const s = fb == null ? k : String(fb);
    return p ? s.replace(/\{(\w+)\}/g, (m, x) => (x in p ? String(p[x]) : m)) : s;
  };
  const toast = (msg, opts) => {
    try {
      if (typeof window.flashToast === "function") window.flashToast(msg, opts || {});
    } catch (_) {}
  };
  const api = () => (window.colorAPI && typeof window.colorAPI.analyze === "function" ? window.colorAPI : null);

  // ───────────────────────── i conti del colore ─────────────────────────
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  function hsvToRgb(h, s, v) {
    h = ((h % 360) + 360) % 360;
    const c = v * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = v - c;
    let r = 0, g = 0, b = 0;
    if (h < 60) [r, g, b] = [c, x, 0];
    else if (h < 120) [r, g, b] = [x, c, 0];
    else if (h < 180) [r, g, b] = [0, c, x];
    else if (h < 240) [r, g, b] = [0, x, c];
    else if (h < 300) [r, g, b] = [x, 0, c];
    else [r, g, b] = [c, 0, x];
    return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
  }
  function rgbToHsv(r, g, b) {
    r /= 255;
    g /= 255;
    b /= 255;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
    let h = 0;
    if (d > 0) {
      if (mx === r) h = 60 * (((g - b) / d) % 6);
      else if (mx === g) h = 60 * ((b - r) / d + 2);
      else h = 60 * ((r - g) / d + 4);
    }
    if (h < 0) h += 360;
    return { h, s: mx > 0 ? d / mx : 0, v: mx };
  }
  const hex2 = (n) => ("0" + clamp(Math.round(n), 0, 255).toString(16)).slice(-2);
  const rgbToHex = (rgb) => "#" + hex2(rgb[0]) + hex2(rgb[1]) + hex2(rgb[2]);
  // short: accetta anche #abc. Mentre si scrive NO: «#808080» passa da «#808» (un magenta) e la ruota
  // salterebbe di tinta a metà parola.
  function parseHex(s, short) {
    let t = String(s || "").trim().toLowerCase();
    if (t[0] !== "#") t = "#" + t;
    if (short && /^#[0-9a-f]{3}$/.test(t)) t = "#" + t[1] + t[1] + t[2] + t[2] + t[3] + t[3];
    if (!/^#[0-9a-f]{6}$/.test(t)) return null;
    return [parseInt(t.slice(1, 3), 16), parseInt(t.slice(3, 5), 16), parseInt(t.slice(5, 7), 16)];
  }

  // ───────────────────────── stato ─────────────────────────
  const S = {
    ready: false,
    h: 220, s: 0.53, v: 1, // la tinta resta anche quando il colore è grigio
    rgb: [120, 160, 255],
    drag: null, // "ring" | "square"
    dirty: false, // l'anteprima è cambiata e il «change» non è ancora partito
    lastSent: null, // l'ultimo colore mandato col «change» (Invio e poi il «change» del campo: uno solo)
    rafPreview: 0,
    rafDraw: 0,
    ownEvent: false,
    quietOk: false,
    settings: null,
    profiles: [],
    analysis: null, // { hex, cmyk, proof, dE, out }
    want: null, wantArgs: null, inflight: false,
    typed: null, // { hex, cmyk:[…], clipped } quando i CMYK li ha scritti chi lavora
    cmykBusy: false,
    mapOn: true,
    masks: new Map(), // `${profileId}|${hue}` → canvas GRID×GRID
    maskWant: null, maskInflight: false,
    ringImg: null,
    ctx: null,
    dpr: 1,
    // Fetta 4-bis: per chi lavora la ruota. "tile" = le tessere (#colorInput, il popup lo apre renderer.js col 🎨);
    // "stroke" = la penna e l'acquerello (#strokeColorPicker, il popup lo apre la Tinta dell'ispettore).
    target: "tile",
    strokeWasOpen: false
  };
  try {
    S.mapOn = localStorage.getItem(KEY_MAP) !== "0";
  } catch (_) {}

  // ───────────────────────── parlare a Mosaica ─────────────────────────
  // L'«input» senza fotografie (trappola 296). Se il nome di renderer.js non c'è più, si torna all'«input»
  // normale, e allora durante il trascinamento non si manda niente: la tessera cambia al rilascio.
  function dispatchQuietInput(inp) {
    let prev = false, set = false;
    if (S.quietOk) {
      try {
        prev = isApplyingSnapshot; // eslint-disable-line no-undef
        isApplyingSnapshot = true; // eslint-disable-line no-undef
        set = true;
      } catch (_) {
        S.quietOk = false;
      }
    }
    try {
      inp.dispatchEvent(new Event("input", { bubbles: true }));
    } finally {
      if (set) {
        try {
          isApplyingSnapshot = prev; // eslint-disable-line no-undef
        } catch (_) {}
      }
    }
  }

  function send(hex, final) {
    if (S.target === "stroke") return sendStroke(hex, final);
    const inp = $("colorInput");
    if (!inp) return;
    if (!final && !S.quietOk) {
      S.dirty = true; // niente anteprima: arriva tutto al rilascio
      return;
    }
    S.ownEvent = true;
    try {
      inp.value = hex;
      dispatchQuietInput(inp);
      if (final) {
        inp.dispatchEvent(new Event("change", { bubbles: true }));
        S.lastSent = hex;
      }
    } catch (e) {
      console.warn("[colorWheel] invio:", e);
    } finally {
      S.ownEvent = false;
    }
    S.dirty = !final;
  }

  // La penna e l'acquerello (Fetta 4-bis): #strokeColorPicker, come se il colore l'avesse scelto la finestra di
  // Windows. freehandDrawing.js ascolta il suo «input»: cambia la Tinta, rifà il pennello e salva le impostazioni del
  // disegno (dopo 400 ms di quiete). Niente pushState: il colore della penna non sta sul foglio, e #colorInput (le
  // tessere) resta com'è.
  function sendStroke(hex, final) {
    const inp = $("strokeColorPicker");
    if (!inp) return;
    S.ownEvent = true;
    try {
      inp.value = hex;
      inp.dispatchEvent(new Event("input", { bubbles: true }));
      if (final) {
        inp.dispatchEvent(new Event("change", { bubbles: true }));
        S.lastSent = hex;
      }
    } catch (e) {
      console.warn("[colorWheel] penna:", e);
    } finally {
      S.ownEvent = false;
    }
    S.dirty = !final;
  }

  function schedulePreview() {
    if (S.rafPreview) return;
    S.rafPreview = requestAnimationFrame(() => {
      S.rafPreview = 0;
      if (S.drag) send(rgbToHex(S.rgb), false);
    });
  }

  function commit() {
    if (S.rafPreview) {
      cancelAnimationFrame(S.rafPreview);
      S.rafPreview = 0;
    }
    const hex = rgbToHex(S.rgb);
    if (hex === S.lastSent && !S.dirty) return; // già mandato: un secondo passo di Ctrl+Z uguale non serve
    send(hex, true);
  }

  // ───────────────────────── disegno ─────────────────────────
  function geom() {
    const c = SIZE / 2;
    return { c, x0: c - SQ_HALF, y0: c - SQ_HALF, side: SQ_HALF * 2 };
  }

  function buildRing() {
    const dpr = S.dpr, n = Math.round(SIZE * dpr);
    const cv = document.createElement("canvas");
    cv.width = cv.height = n;
    const ctx = cv.getContext("2d");
    const img = ctx.createImageData(n, n), d = img.data;
    const c = n / 2, ro = RING_OUT * dpr, ri = RING_IN * dpr;
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        const dx = x + 0.5 - c, dy = y + 0.5 - c, r = Math.sqrt(dx * dx + dy * dy);
        // bordo morbido di un pixel, dentro e fuori
        const a = clamp(Math.min(ro - r, r - ri) + 0.5, 0, 1);
        if (a <= 0) continue;
        const h = (Math.atan2(dx, -dy) * 180) / Math.PI; // rosso in alto, giro in senso orario
        const rgb = hsvToRgb(h < 0 ? h + 360 : h, 1, 1);
        const i = (y * n + x) * 4;
        d[i] = rgb[0];
        d[i + 1] = rgb[1];
        d[i + 2] = rgb[2];
        d[i + 3] = Math.round(a * 255);
      }
    }
    ctx.putImageData(img, 0, 0);
    S.ringImg = cv;
  }

  function maskKey() {
    const id = S.settings && S.settings.profileId;
    return id ? id + "|" + Math.round(S.h) % 360 : null;
  }

  function draw() {
    S.rafDraw = 0;
    const cv = $("colorWheelCanvas");
    if (!cv || !S.ctx) return;
    const ctx = S.ctx, g = geom();
    ctx.setTransform(S.dpr, 0, 0, S.dpr, 0, 0);
    ctx.clearRect(0, 0, SIZE, SIZE);
    if (S.ringImg) ctx.drawImage(S.ringImg, 0, 0, SIZE, SIZE);
    // il quadrato: la tinta piena, il bianco da sinistra, il nero dal basso
    const pure = hsvToRgb(S.h, 1, 1);
    ctx.fillStyle = rgbToHex(pure);
    ctx.fillRect(g.x0, g.y0, g.side, g.side);
    let gr = ctx.createLinearGradient(g.x0, 0, g.x0 + g.side, 0);
    gr.addColorStop(0, "rgba(255,255,255,1)");
    gr.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = gr;
    ctx.fillRect(g.x0, g.y0, g.side, g.side);
    gr = ctx.createLinearGradient(0, g.y0, 0, g.y0 + g.side);
    gr.addColorStop(0, "rgba(0,0,0,0)");
    gr.addColorStop(1, "rgba(0,0,0,1)");
    ctx.fillStyle = gr;
    ctx.fillRect(g.x0, g.y0, g.side, g.side);
    // dove la stampa non arriva: righe sopra le celle «fuori»
    if (S.mapOn && api()) {
      const k = maskKey(), m = k && S.masks.get(k);
      if (m) drawMask(ctx, m, g);
      else requestMask();
    }
    ctx.strokeStyle = "rgba(255,255,255,0.18)";
    ctx.lineWidth = 1;
    ctx.strokeRect(g.x0 - 0.5, g.y0 - 0.5, g.side + 1, g.side + 1);
    // i segni: sull'anello la tinta, nel quadrato il colore
    const a = (S.h * Math.PI) / 180, rm = (RING_OUT + RING_IN) / 2;
    ring(ctx, g.c + rm * Math.sin(a), g.c - rm * Math.cos(a), (RING_OUT - RING_IN) / 2 + 1);
    ring(ctx, g.x0 + S.s * g.side, g.y0 + (1 - S.v) * g.side, 6);
  }
  function ring(ctx, x, y, r) {
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.lineWidth = 3;
    ctx.strokeStyle = "rgba(0,0,0,0.75)";
    ctx.stroke();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = "#ffffff";
    ctx.stroke();
  }

  let _stripe = null;
  function drawMask(ctx, m, g) {
    const dpr = S.dpr, side = Math.round(g.side * dpr);
    if (!_stripe || _stripe.width !== side) {
      _stripe = document.createElement("canvas");
      _stripe.width = _stripe.height = side;
    }
    const sc = _stripe.getContext("2d");
    sc.globalCompositeOperation = "source-over";
    sc.clearRect(0, 0, side, side);
    // righe diagonali grigie, larghe 3 px dello schermo, come il «fuori stampa» del velo
    const w = 3 * dpr;
    sc.strokeStyle = "rgba(128,128,128,0.78)";
    sc.lineWidth = w;
    sc.beginPath();
    for (let t = -side; t < side * 2; t += w * 2) {
      sc.moveTo(t, 0);
      sc.lineTo(t + side, side);
    }
    sc.stroke();
    sc.globalCompositeOperation = "destination-in";
    sc.imageSmoothingEnabled = true;
    sc.drawImage(m, 0, 0, side, side);
    sc.globalCompositeOperation = "source-over";
    ctx.drawImage(_stripe, g.x0, g.y0, g.side, g.side);
  }

  function scheduleDraw() {
    if (!S.rafDraw) S.rafDraw = requestAnimationFrame(draw);
  }

  // ───────────────────────── il motore colore ─────────────────────────
  // Un colore alla volta: se ne arriva un altro mentre il motore lavora, si tiene solo l'ultimo.
  function requestAnalysis() {
    if (!api()) return;
    S.want = S.rgb.slice();
    pumpAnalysis();
  }
  async function pumpAnalysis() {
    if (S.inflight || !S.want) return;
    const rgb = S.want;
    S.want = null;
    S.inflight = true;
    try {
      const r = await api().analyze([rgb]);
      if (r && r.ok && r.results && r.results[0]) {
        const x = r.results[0];
        S.analysis = { hex: rgbToHex(rgb), cmyk: x.cmyk, proof: x.proof, dE: x.dE, out: !!x.out };
      } else S.analysis = null;
    } catch (_) {
      S.analysis = null;
    } finally {
      S.inflight = false;
    }
    if (S.want) return pumpAnalysis();
    syncInfo();
  }

  function requestMask() {
    const k = maskKey();
    if (!k || S.masks.has(k)) return;
    S.maskWant = { key: k, h: Math.round(S.h) % 360 };
    pumpMask();
  }
  async function pumpMask() {
    if (S.maskInflight || !S.maskWant) return;
    const w = S.maskWant;
    S.maskWant = null;
    if (S.masks.has(w.key)) return pumpMask();
    S.maskInflight = true;
    try {
      const list = [];
      for (let j = 0; j < GRID; j++) for (let i = 0; i < GRID; i++) list.push(hsvToRgb(w.h, (i + 0.5) / GRID, 1 - (j + 0.5) / GRID));
      // il «fuori stampa» il motore lo calcola sempre col relativo: la carta qui non conta
      const r = await api().analyze(list, { paper: false });
      if (r && r.ok && Array.isArray(r.results) && r.results.length === list.length) {
        const m = document.createElement("canvas");
        m.width = m.height = GRID;
        const mc = m.getContext("2d"), img = mc.createImageData(GRID, GRID);
        r.results.forEach((x, n) => {
          img.data[n * 4 + 3] = x.out ? 255 : 0;
        });
        mc.putImageData(img, 0, 0);
        S.masks.set(w.key, m);
        while (S.masks.size > 120) S.masks.delete(S.masks.keys().next().value);
      }
    } catch (_) {
    } finally {
      S.maskInflight = false;
    }
    if (S.maskWant) return pumpMask();
    scheduleDraw();
  }

  // ───────────────────────── i numeri e i tasselli ─────────────────────────
  const FIELDS = ["cwR", "cwG", "cwB"];
  const CMYK = ["cwC", "cwM", "cwY", "cwK"];

  function setField(id, val) {
    const el = $(id);
    if (!el || document.activeElement === el) return; // non si riscrive sotto le dita
    el.value = val;
    el.classList.remove("bad");
  }

  function syncFields() {
    const hex = rgbToHex(S.rgb);
    setField("cwHex", hex);
    FIELDS.forEach((id, i) => setField(id, String(S.rgb[i])));
    const sw = $("cwSwatchScreen");
    if (sw) sw.style.background = hex;
  }

  function syncInfo() {
    const hex = rgbToHex(S.rgb), A = S.analysis && S.analysis.hex === hex ? S.analysis : null;
    const engine = !!api();
    const pr = $("cwSwatchPrint");
    if (pr) {
      pr.style.background = A ? rgbToHex(A.proof) : "transparent";
      pr.classList.toggle("empty", !A);
    }
    const typed = S.typed && S.typed.hex === hex ? S.typed : null;
    CMYK.forEach((id, i) => {
      const el = $(id);
      if (!el) return;
      el.disabled = !engine;
      if (typed) setField(id, fmtPct(typed.cmyk[i]));
      else setField(id, A ? fmtPct(A.cmyk[i]) : "");
    });
    const warn = $("cwGamutWarn"), okEl = $("cwGamutIn"), de = $("cwGamutDe");
    if (warn) {
      warn.hidden = !(A && A.out);
      warn.title = A ? T("colorWheel.gamut.out.tooltip", { dE: fmtDe(A.dE) }, "La stampa non arriva a questo colore (ΔE {dE}): uscirà come il tassello «in stampa»") : "";
    }
    if (okEl) okEl.hidden = !(A && !A.out);
    if (de) de.textContent = A && A.out ? "ΔE " + fmtDe(A.dE) : "";
    const btn = $("cwToPrintBtn");
    if (btn) btn.disabled = !(A && A.out);
    const note = $("cwNote");
    if (note) {
      let t = "";
      if (!engine) t = T("colorWheel.note.noEngine", null, "CMYK e prova di stampa spenti: riavvia Mosaica (il motore colore non è attivo)");
      else if (typed && typed.clipped) t = T("colorWheel.note.clipped", null, "⚠ Questi inchiostri fanno un colore che lo schermo non sa mostrare: Mosaica usa il più vicino, e la stampa verrà un po' diversa.");
      else if (typed && A && A.cmyk.some((v, i) => Math.abs(v - typed.cmyk[i]) >= 1.5)) {
        const c = A.cmyk.map(fmtPct);
        t = T("colorWheel.note.recomputed", { c: c[0], m: c[1], y: c[2], k: c[3] }, "Stesso colore: Mosaica lo manda in stampa come C {c} · M {m} · Y {y} · K {k} (gli inchiostri li divide il profilo).");
      }
      note.textContent = t;
      note.hidden = !t;
    }
    const map = $("cwGamutMap");
    if (map) {
      map.disabled = !engine;
      map.checked = S.mapOn && engine;
    }
    syncProfileName();
    // all'apertura, e quando la nota cambia l'altezza del popup: che stia sullo schermo (un posto solo)
    if (popupShown()) keepOnScreen();
  }
  const fmtPct = (v) => String(Math.round(+v || 0));
  const fmtDe = (v) => {
    const t = (Math.round((+v || 0) * 10) / 10).toFixed(1);
    let lang = "it";
    try {
      lang = (window.i18n && window.i18n.getLanguage && window.i18n.getLanguage()) || "it";
    } catch (_) {}
    return lang === "it" ? t.replace(".", ",") : t;
  };

  function syncProfileName() {
    const el = $("cwProfile");
    if (!el) return;
    const id = S.settings && S.settings.profileId;
    const p = id && S.profiles.find((x) => x.id === id);
    el.textContent = p ? T("colorWheel.profile", { name: p.name }, "CMYK in: {name}") : "";
    el.title = el.textContent;
  }

  // Il colore nuovo dentro la ruota (non ancora a Mosaica).
  function setRgb(rgb, keepHue) {
    S.rgb = rgb.map((x) => clamp(Math.round(x), 0, 255));
    const hsv = rgbToHsv(S.rgb[0], S.rgb[1], S.rgb[2]);
    if (!(keepHue && (hsv.s === 0 || hsv.v === 0))) S.h = hsv.h;
    S.s = hsv.s;
    S.v = hsv.v;
    syncFields();
    syncInfo();
    scheduleDraw();
    requestAnalysis();
  }
  function setHsv(h, s, v) {
    S.h = ((h % 360) + 360) % 360;
    S.s = clamp(s, 0, 1);
    S.v = clamp(v, 0, 1);
    S.rgb = hsvToRgb(S.h, S.s, S.v);
    syncFields();
    syncInfo();
    scheduleDraw();
    requestAnalysis();
  }

  // ───────────────────────── il trascinamento ─────────────────────────
  function pickAt(e, start) {
    const cv = $("colorWheelCanvas"), r = cv.getBoundingClientRect();
    const k = SIZE / (r.width || SIZE);
    const x = (e.clientX - r.left) * k, y = (e.clientY - r.top) * k, g = geom();
    if (start) {
      const dx = x - g.c, dy = y - g.c, d = Math.sqrt(dx * dx + dy * dy);
      if (d >= RING_IN - 3 && d <= RING_OUT + 3) S.drag = "ring";
      else if (x >= g.x0 - 4 && x <= g.x0 + g.side + 4 && y >= g.y0 - 4 && y <= g.y0 + g.side + 4) S.drag = "square";
      else S.drag = null;
    }
    if (S.drag === "ring") {
      let h = (Math.atan2(x - g.c, -(y - g.c)) * 180) / Math.PI;
      if (h < 0) h += 360;
      setHsv(h, S.s, S.v);
    } else if (S.drag === "square") {
      setHsv(S.h, (x - g.x0) / g.side, 1 - (y - g.y0) / g.side);
    }
  }

  function onDown(e) {
    if (e.button !== undefined && e.button !== 0) return;
    pickAt(e, true);
    if (!S.drag) return;
    e.preventDefault();
    S.typed = null;
    // un campo col fuoco non si riscrive (setField): lo si lascia, così segue la ruota
    const p = $("colorPopup"), ae = document.activeElement;
    if (p && ae && p.contains(ae) && ae.tagName === "INPUT" && typeof ae.blur === "function") ae.blur();
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch (_) {}
    schedulePreview();
  }
  function onMove(e) {
    if (!S.drag) return;
    pickAt(e, false);
    schedulePreview();
  }
  function onUp() {
    if (!S.drag) return;
    S.drag = null;
    commit();
  }

  // ───────────────────────── i campi ─────────────────────────
  function fromHexField(final) {
    const el = $("cwHex"), rgb = parseHex(el && el.value, final);
    if (!rgb) {
      if (el && final) el.classList.add("bad");
      return;
    }
    el.classList.remove("bad");
    S.typed = null;
    setRgb(rgb, true);
    if (final) commit();
  }
  function fromRgbFields(final) {
    const vals = FIELDS.map((id) => {
      const el = $(id), t = el ? String(el.value).trim() : "";
      if (!/^\d{1,3}$/.test(t) || +t > 255) {
        if (el && final) el.classList.add("bad");
        return null;
      }
      el.classList.remove("bad");
      return +t;
    });
    if (vals.some((v) => v == null)) return;
    S.typed = null;
    setRgb(vals, true);
    if (final) commit();
  }
  async function fromCmykFields() {
    const a = api();
    if (!a || S.cmykBusy) return; // Invio e poi il «change» del campo: si lavora una volta sola
    const vals = CMYK.map((id) => {
      const el = $(id), t = el ? String(el.value).trim().replace(",", ".") : "";
      const v = t === "" ? 0 : Number(t);
      if (!isFinite(v) || v < 0 || v > 100) {
        if (el) el.classList.add("bad");
        return null;
      }
      el.classList.remove("bad");
      return v;
    });
    if (vals.some((v) => v == null)) return;
    S.cmykBusy = true;
    try {
      const r = await a.cmykToRgb(vals);
      if (!r || r.ok === false || !Array.isArray(r.rgb)) throw new Error((r && r.error) || "?");
      S.typed = { hex: rgbToHex(r.rgb), cmyk: vals, clipped: !!r.clipped };
      setRgb(r.rgb, true);
      commit();
    } catch (e) {
      toast(T("colorWheel.toast.error", { msg: (e && e.message) || e }, "❌ Ruota dei colori: {msg}"));
    } finally {
      S.cmykBusy = false;
    }
  }

  async function toPrint() {
    const a = api();
    if (!a) return;
    try {
      // il più vicino che la stampa sa fare (il «near» del motore): andata in CMYK e ritorno col relativo,
      // senza compensazione del nero e senza simulare la carta — con la carta il bianco diventerebbe
      // grigino, e un colore stampabile cambierebbe lo stesso. Riportato in stampa, il ⚠ si spegne.
      const r = await a.analyze([S.rgb.slice()], { intent: "relativo", paper: false });
      const x = r && r.ok && r.results && r.results[0];
      const near = x && (x.near || x.proof);
      if (!near) throw new Error((r && r.error) || "?");
      S.typed = null;
      setRgb(near, true);
      commit();
      toast(T("colorWheel.toPrint.toast", { hex: rgbToHex(near) }, "🖨️ Colore portato in stampa: {hex}"));
    } catch (e) {
      toast(T("colorWheel.toast.error", { msg: (e && e.message) || e }, "❌ Ruota dei colori: {msg}"));
    }
  }

  // ───────────────────────── il popup ─────────────────────────
  function popupShown() {
    const p = $("colorPopup");
    return !!(p && p.style.display === "block");
  }

  // Il popup lo mette renderer.js 120 px a destra della tessera: la ruota è più alta del popup di prima e
  // vicino ai bordi uscirebbe dallo schermo. Lo si riporta dentro (solo se serve).
  function keepOnScreen() {
    const p = $("colorPopup");
    if (!p) return;
    const r = p.getBoundingClientRect();
    const top0 = 52, bottom0 = window.innerHeight - 38, right0 = window.innerWidth - 8;
    let dx = 0, dy = 0;
    if (r.right > right0) dx = right0 - r.right;
    if (r.left + dx < 8) dx = 8 - r.left;
    if (r.bottom > bottom0) dy = bottom0 - r.bottom;
    if (r.top + dy < top0) dy = top0 - r.top;
    if (dx) p.style.left = (parseFloat(p.style.left) || 0) + dx + "px";
    if (dy) p.style.top = (parseFloat(p.style.top) || 0) + dy + "px";
  }

  async function refreshSettings() {
    const a = api();
    if (!a) return;
    const key = (x) => (x ? [x.profileId, x.intent, x.paper].join("|") : "");
    const before = key(S.settings);
    try {
      const [s, l] = await Promise.all([a.getSettings(), a.listProfiles(false)]);
      if (s && s.ok) S.settings = s.settings;
      if (l && l.ok) S.profiles = l.profiles || [];
    } catch (_) {}
    // profilo, resa o carta cambiati (dalla 🖨️ Prova di stampa): i numeri di prima non valgono più
    // (la prima volta no: il motore usa già le scelte salvate, e i numeri appena chiesti sono buoni)
    if (before && key(S.settings) !== before) {
      S.analysis = null;
      requestAnalysis();
    }
    syncInfo();
    scheduleDraw();
  }

  // Dal #colorInput alla ruota: all'apertura (renderer.js scrive value senza eventi) e quando lo cambiano
  // le pastiglie o qualcun altro. Col popup aperto dalla Tinta (Fetta 4-bis) il colore è quello della penna.
  function targetInput() {
    return S.target === "stroke" ? $("strokeColorPicker") : $("colorInput");
  }
  function syncFromInput() {
    const inp = targetInput(), rgb = parseHex(inp && inp.value);
    if (!rgb) return;
    if (rgbToHex(rgb) === rgbToHex(S.rgb) && S.ready) {
      syncInfo();
      return;
    }
    S.typed = null;
    S.lastSent = null; // il colore l'ha cambiato qualcun altro
    setRgb(rgb, true);
  }

  let _wasShown = false;
  function onPopupStyle() {
    const shown = popupShown();
    if (shown && !_wasShown) {
      _wasShown = true;
      S.lastSent = null;
      S.dirty = false;
      syncFromInput(); // → syncInfo → keepOnScreen: il popup torna dentro la finestra
      refreshSettings();
    } else if (shown) {
      // riaperto senza passare da chiuso (🎨 di nuovo, o chiuso e aperto nello stesso giro): renderer.js
      // ha riscritto #colorInput. Se è lo stesso colore della ruota, syncFromInput rifà solo i conti a video.
      syncFromInput();
    } else if (!shown && _wasShown) {
      _wasShown = false;
      if (S.drag) {
        S.drag = null;
        commit();
      }
      // Fetta 4-bis: il contagocce si spegne col popup, e la prossima apertura è di renderer.js (le tessere)
      // finché la Tinta non la riapre per la penna.
      pickCancel(true);
      setTarget("tile");
      // il fuoco non deve restare in un campo nascosto: le scorciatoie di Mosaica tacciono finché
      // il fuoco sta in un <input> (keyboardShortcuts.js). Chromium oggi lo toglie già da sé a un elemento
      // che sparisce (sul banco il mutante che toglie queste righe non cade): restano per sicurezza.
      const p = $("colorPopup"), ae = document.activeElement;
      if (p && ae && p.contains(ae) && typeof ae.blur === "function") ae.blur();
    }
  }

  // ───────────────────────── la penna e l'acquerello (Fetta 4-bis) ─────────────────────────
  function setTarget(t) {
    S.target = t === "stroke" ? "stroke" : "tile";
    const stroke = S.target === "stroke";
    const ti = $("cwTitle");
    if (ti) ti.hidden = !stroke;
    const p = $("colorPopup");
    if (p) p.classList.toggle("cw-stroke", stroke);
    syncStrokeNote();
  }
  // Con l'acquerello acceso una riga in più: il colore che si posa lo cambiano anche Tono, Opacità e Miscelazione
  // (watercolorToneColor, l'opacità del tratto e la miscelazione di freehandDrawing.js). Quello scelto qui è il
  // pigmento.
  function syncStrokeNote() {
    const n = $("cwStrokeNote");
    if (!n) return;
    let water = false;
    try {
      water = typeof isWatercolorMode !== "undefined" && !!isWatercolorMode; // eslint-disable-line no-undef
    } catch (_) {}
    n.hidden = !(S.target === "stroke" && water);
  }
  // La ruota per la penna, accanto alla Tinta: a sinistra dell'ispettore, dentro la finestra.
  function openForStroke(anchor) {
    const p = $("colorPopup");
    if (!p || !S.ready) return false;
    pickCancel(true);
    setTarget("stroke");
    p.style.display = "block";
    const r = anchor && typeof anchor.getBoundingClientRect === "function" ? anchor.getBoundingClientRect() : null;
    if (r && r.width > 0) {
      // tutto a sinistra dell'ispettore: la Tinta e gli slider della penna restano scoperti
      let edge = r.left;
      const ins = $("historyPanel");
      if (ins && ins.contains(anchor)) {
        const ir = ins.getBoundingClientRect();
        if (ir.width > 0) edge = Math.min(edge, ir.left);
      }
      const pw = p.offsetWidth || 252;
      p.style.left = Math.round(edge - pw - 10) + "px";
      p.style.top = Math.round(r.top - 12) + "px";
    }
    keepOnScreen();
    syncStrokeNote();
    return true;
  }
  function hidePopup() {
    const p = $("colorPopup");
    if (p && p.style.display !== "none") p.style.display = "none";
  }

  // ───────────────────────── il contagocce (Fetta 4-bis) ─────────────────────────
  const PICK_AVG = 2; // Shift+clic: la media di (2·2+1)² = 25 pixel della tela attorno alla punta
  const PICK_CHIP_DX = 18, PICK_CHIP_DY = 18; // il tassello che segue la mano, un po' in basso a destra
  const PK = { on: false, swallow: false, swallowTimer: 0, raf: 0, last: null, scratch: null, sctx: null };

  function fab() {
    try {
      if (typeof canvas !== "undefined" && canvas && canvas.lowerCanvasEl) return canvas; // eslint-disable-line no-undef
    } catch (_) {}
    return window.canvas && window.canvas.lowerCanvasEl ? window.canvas : null;
  }
  function lowerEl() {
    const c = fab();
    return c ? c.lowerCanvasEl : null;
  }
  // L'evento cade sul foglio? Il bersaglio è la tela di Fabric (o uno degli accessori che le stanno sopra: il
  // radiale, le misure), e il punto è dentro la tela. Un pannello che copre il foglio NON è il foglio.
  function overSheet(e) {
    const c = fab(), el = lowerEl();
    if (!c || !el || !e || !e.target) return false;
    const t = e.target;
    const w = c.wrapperEl || (c.upperCanvasEl && c.upperCanvasEl.parentNode);
    let ok = !!(w && typeof w.contains === "function" && w.contains(t));
    if (!ok && typeof t.closest === "function" && t.closest("#radialMenu, #measureOverlay, #radialTooltip")) ok = true;
    if (!ok) return false;
    const r = el.getBoundingClientRect();
    return e.clientX >= r.left && e.clientX < r.right && e.clientY >= r.top && e.clientY < r.bottom;
  }
  // Il colore della tela nel punto (px della finestra): il pixel, o la media dei pixel attorno. La tela bassa ha la
  // sua scala (retina, qualità) e lo zoom è una trasformazione CSS del foglio (trappola 104): il punto si porta in
  // pixel della tela col suo rettangolo vero. Dove la tela fosse trasparente si vede il bianco del foglio.
  function sampleAt(cx, cy, avg) {
    const el = lowerEl();
    if (!el || !(el.width > 0) || !(el.height > 0)) return null;
    const r = el.getBoundingClientRect();
    if (!(r.width > 0) || !(r.height > 0)) return null;
    const px = Math.floor(((cx - r.left) / r.width) * el.width);
    const py = Math.floor(((cy - r.top) / r.height) * el.height);
    if (!(px >= 0 && py >= 0 && px < el.width && py < el.height)) return null;
    const n = avg ? PICK_AVG : 0;
    const x0 = Math.max(0, px - n), y0 = Math.max(0, py - n);
    const w = Math.min(el.width, px + n + 1) - x0, h = Math.min(el.height, py + n + 1) - y0;
    try {
      if (!PK.scratch) PK.scratch = document.createElement("canvas");
      if (PK.scratch.width !== w) PK.scratch.width = w;
      if (PK.scratch.height !== h) PK.scratch.height = h;
      if (!PK.sctx) PK.sctx = PK.scratch.getContext("2d", { willReadFrequently: true });
      const ctx = PK.sctx;
      ctx.clearRect(0, 0, w, h);
      ctx.drawImage(el, x0, y0, w, h, 0, 0, w, h);
      const d = ctx.getImageData(0, 0, w, h).data;
      let R = 0, G = 0, B = 0, k = 0;
      for (let i = 0; i < d.length; i += 4) {
        const a = d[i + 3] / 255, wb = 255 * (1 - a);
        R += d[i] * a + wb;
        G += d[i + 1] * a + wb;
        B += d[i + 2] * a + wb;
        k++;
      }
      return k ? [Math.round(R / k), Math.round(G / k), Math.round(B / k)] : null;
    } catch (e) {
      console.warn("[colorWheel] contagocce:", e);
      return null;
    }
  }

  function chipEl() {
    let c = $("cwPickChip");
    if (!c) {
      c = document.createElement("div");
      c.id = "cwPickChip";
      c.setAttribute("aria-hidden", "true");
      const sw = document.createElement("span");
      sw.className = "cw-pick-sw";
      const tx = document.createElement("span");
      tx.className = "cw-pick-hex";
      c.appendChild(sw);
      c.appendChild(tx);
      document.body.appendChild(c);
    }
    return c;
  }
  function chipHide() {
    const c = $("cwPickChip");
    if (c && c.style.display !== "none") c.style.display = "none";
  }
  function chipShow(cx, cy, rgb) {
    const c = chipEl(), hex = rgbToHex(rgb);
    c.firstChild.style.background = hex;
    c.lastChild.textContent = hex;
    c.style.display = "flex";
    const w = c.offsetWidth || 90, h = c.offsetHeight || 30;
    let x = cx + PICK_CHIP_DX, y = cy + PICK_CHIP_DY;
    if (x + w > window.innerWidth - 4) x = cx - PICK_CHIP_DX - w;
    if (y + h > window.innerHeight - 4) y = cy - PICK_CHIP_DY - h;
    c.style.left = Math.round(x) + "px";
    c.style.top = Math.round(y) + "px";
  }
  function onPickMove(e) {
    if (!PK.on) return;
    PK.last = { x: e.clientX, y: e.clientY, over: overSheet(e), avg: !!e.shiftKey };
    if (PK.raf) return;
    PK.raf = requestAnimationFrame(() => {
      PK.raf = 0;
      const l = PK.last;
      if (!PK.on || !l) return;
      const rgb = l.over ? sampleAt(l.x, l.y, l.avg) : null;
      if (rgb) chipShow(l.x, l.y, rgb);
      else chipHide();
    });
  }

  function pickStart() {
    if (PK.on) {
      pickCancel();
      return;
    }
    if (!lowerEl()) return;
    PK.on = true;
    document.body.classList.add("cw-picking");
    const b = $("cwPickBtn");
    if (b) {
      b.classList.add("armed");
      b.setAttribute("aria-pressed", "true");
    }
    // un campo col fuoco terrebbe Esc e Invio per sé
    const p = $("colorPopup"), ae = document.activeElement;
    if (p && ae && p.contains(ae) && ae.tagName === "INPUT" && typeof ae.blur === "function") ae.blur();
    toast(T("colorWheel.pick.toast.armed", null, "🎯 Contagocce: clicca sul foglio il colore da prendere (Shift = la media dei pixel attorno) — Esc annulla"));
  }
  function pickEnd() {
    PK.on = false;
    if (PK.raf) {
      cancelAnimationFrame(PK.raf);
      PK.raf = 0;
    }
    PK.last = null;
    document.body.classList.remove("cw-picking");
    const b = $("cwPickBtn");
    if (b) {
      b.classList.remove("armed");
      b.setAttribute("aria-pressed", "false");
    }
    chipHide();
  }
  function pickCancel(silent) {
    if (!PK.on) return;
    pickEnd();
    if (!silent) toast(T("colorWheel.pick.toast.cancelled", null, "🎯 Contagocce annullato"));
  }
  function pickTake(e) {
    const rgb = sampleAt(e.clientX, e.clientY, !!e.shiftKey);
    pickEnd();
    if (!rgb) return;
    S.typed = null;
    setRgb(rgb, true);
    commit(); // le tessere: renderer.js fa il suo passo di Ctrl+Z e il suo avviso; la penna: freehandDrawing.js
    toast(T("colorWheel.pick.toast.taken", { hex: rgbToHex(rgb) }, "🎯 Colore preso dal foglio: {hex}"));
  }

  function stopAll(e) {
    e.preventDefault();
    e.stopPropagation();
    if (typeof e.stopImmediatePropagation === "function") e.stopImmediatePropagation();
  }
  // Il gesto preso dal contagocce si mangia fino in fondo (su, clic, menu): Fabric e renderer.js non devono vedere
  // la metà che resta. Riserva: un secondo e mezzo.
  function swallowGesture() {
    PK.swallow = true;
    clearTimeout(PK.swallowTimer);
    PK.swallowTimer = setTimeout(() => {
      PK.swallow = false;
    }, 1500);
  }
  function onPickDown(e) {
    // pointerdown apre un gesto nuovo; il mousedown che lo segue è lo stesso gesto
    if (e.type === "pointerdown") PK.swallow = false;
    else if (PK.swallow) {
      stopAll(e);
      return;
    }
    if (!PK.on) return;
    const p = $("colorPopup");
    if (p && e.target && p.contains(e.target)) return; // i comandi della ruota (anche il contagocce stesso)
    if (e.button === 1 || e.altKey) return; // rotella e Alt+trascina muovono il foglio: il contagocce resta acceso
    if (e.button === 2) {
      stopAll(e);
      swallowGesture();
      pickCancel();
      return;
    }
    if (e.button !== 0) return;
    if (!overSheet(e)) {
      pickCancel(); // un clic fuori dal foglio fa quello che fa sempre
      return;
    }
    stopAll(e);
    swallowGesture();
    pickTake(e);
  }
  function onPickRest(e) {
    if (!PK.swallow) return;
    stopAll(e);
    if (e.type === "click" || e.type === "auxclick") {
      clearTimeout(PK.swallowTimer);
      PK.swallow = false;
    }
  }
  // Esc: prima il contagocce; poi la ruota della penna (senza uscire dallo schermo intero, renderer.js).
  function onWheelKey(e) {
    if (e.key !== "Escape") return;
    if (PK.on) {
      stopAll(e);
      pickCancel();
      return;
    }
    if (S.target === "stroke" && popupShown()) {
      stopAll(e);
      hidePopup();
    }
  }

  function bindStrokeAndPicker(pop) {
    // la Tinta della penna e dell'acquerello apre la ruota (non la finestra di Windows); un secondo clic la chiude
    const sp = $("strokeColorPicker");
    if (sp) {
      sp.addEventListener("mousedown", () => {
        S.strokeWasOpen = popupShown() && S.target === "stroke";
      });
      sp.addEventListener("click", (e) => {
        e.preventDefault();
        if (S.strokeWasOpen) {
          S.strokeWasOpen = false;
          hidePopup();
          return;
        }
        openForStroke(sp);
      });
      sp.addEventListener("input", () => {
        if (!S.ownEvent && S.target === "stroke" && popupShown()) syncFromInput();
      });
    }
    // le pastiglie, col popup della penna, vanno alla penna (trappola 310): renderer.js scriverebbe #colorInput, e
    // freehandDrawing.js farebbe un passo di Ctrl+Z per niente. In cattura: renderer.js non le vede.
    const qc = $("quickColors");
    if (qc) {
      qc.addEventListener(
        "click",
        (ev) => {
          if (S.target !== "stroke") return;
          const b = ev.target && ev.target.closest ? ev.target.closest(".smallColor") : null;
          if (!b || !qc.contains(b)) return;
          ev.stopPropagation();
          if (typeof ev.stopImmediatePropagation === "function") ev.stopImmediatePropagation();
          const rgb = parseHex(b.dataset.color, true);
          if (!rgb) return;
          S.typed = null;
          setRgb(rgb, true);
          commit();
        },
        true
      );
    }
    // il 🎨 del radiale riapre la ruota per le tessere
    document.addEventListener(
      "click",
      (e) => {
        if (e.target && e.target.closest && e.target.closest("[data-action='copyColor']")) {
          pickCancel(true);
          setTarget("tile");
        }
      },
      true
    );
    // spento lo strumento (la Tinta sparisce dall'ispettore), la ruota della penna si chiude
    const cb = $("inspectorColorBlock");
    if (cb && typeof MutationObserver === "function") {
      new MutationObserver(() => {
        if (S.target === "stroke" && popupShown() && cb.style.display === "none") hidePopup();
      }).observe(cb, { attributes: true, attributeFilter: ["style"] });
    }
    // il contagocce
    const pb = $("cwPickBtn");
    if (pb) {
      pb.addEventListener("click", (e) => {
        e.preventDefault();
        pickStart();
      });
    }
    window.addEventListener("pointerdown", onPickDown, true);
    window.addEventListener("mousedown", onPickDown, true);
    ["pointerup", "mouseup", "click", "dblclick", "auxclick", "contextmenu"].forEach((t) => window.addEventListener(t, onPickRest, true));
    window.addEventListener("pointermove", onPickMove, true);
    window.addEventListener("keydown", onWheelKey, true);
    window.addEventListener("blur", () => pickCancel(true));
  }

  function bindUI() {
    const pop = $("colorPopup"), cv = $("colorWheelCanvas"), inp = $("colorInput");
    if (!pop || !cv || !inp) return false;
    S.dpr = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
    cv.width = cv.height = Math.round(SIZE * S.dpr);
    cv.style.width = cv.style.height = SIZE + "px";
    S.ctx = cv.getContext("2d");
    buildRing();
    try {
      S.quietOk = typeof isApplyingSnapshot === "boolean"; // eslint-disable-line no-undef
    } catch (_) {
      S.quietOk = false;
    }

    cv.addEventListener("pointerdown", onDown);
    cv.addEventListener("pointermove", onMove);
    cv.addEventListener("pointerup", onUp);
    cv.addEventListener("pointercancel", onUp);
    cv.addEventListener("lostpointercapture", onUp);

    const hx = $("cwHex");
    if (hx) {
      hx.addEventListener("input", () => fromHexField(false));
      hx.addEventListener("change", () => fromHexField(true));
    }
    FIELDS.forEach((id) => {
      const el = $(id);
      if (!el) return;
      el.addEventListener("input", () => fromRgbFields(false));
      el.addEventListener("change", () => fromRgbFields(true));
    });
    CMYK.forEach((id) => {
      const el = $(id);
      if (el) el.addEventListener("change", fromCmykFields);
    });
    // Invio = applica (il «change» di un campo di testo arriva col solo Invio solo in certi casi: lo si fa
    // da sé, e il «change» che segue trova il colore già mandato e non rifà niente, vedi commit)
    pop.addEventListener("keydown", (e) => {
      if (e.key === "Escape") return; // ESC resta a Mosaica (chiude la selezione e il popup)
      e.stopPropagation(); // trappola 193: i tasti dei campi non arrivano alle tessere selezionate dietro
      if (e.key !== "Enter" || !e.target || e.target.tagName !== "INPUT") return;
      e.preventDefault();
      const id = e.target.id;
      if (id === "cwHex") fromHexField(true);
      else if (FIELDS.includes(id)) fromRgbFields(true);
      else if (CMYK.includes(id)) fromCmykFields();
    });
    const tp = $("cwToPrintBtn");
    if (tp) tp.addEventListener("click", toPrint);
    const map = $("cwGamutMap");
    if (map)
      map.addEventListener("change", () => {
        S.mapOn = !!map.checked;
        try {
          localStorage.setItem(KEY_MAP, S.mapOn ? "1" : "0");
        } catch (_) {}
        scheduleDraw();
      });

    // le pastiglie (e chiunque altro) cambiano #colorInput: la ruota segue (solo quando lavora per le tessere)
    inp.addEventListener("input", () => {
      if (!S.ownEvent && S.target === "tile") syncFromInput();
    });
    inp.addEventListener("change", () => {
      if (!S.ownEvent && S.target === "tile") syncFromInput();
    });

    bindStrokeAndPicker(pop);

    new MutationObserver(onPopupStyle).observe(pop, { attributes: true, attributeFilter: ["style"] });

    pop.classList.add("cw-ready"); // da qui il pulsante della finestra di Windows sparisce (CSS)
    if (!api()) pop.classList.add("cw-noengine");
    S.ready = true;
    syncFromInput();
    syncInfo();
    draw();
    return true;
  }

  window.colorWheel = {
    get: () => rgbToHex(S.rgb),
    set: (hex) => {
      const rgb = parseHex(hex, true);
      if (rgb) setRgb(rgb, true);
      return !!rgb;
    },
    apply: () => commit(),
    toPrint,
    // Fetta 4-bis: per chi lavora la ruota, la ruota della penna, il contagocce
    target: () => S.target,
    openForStroke: () => openForStroke($("strokeColorPicker")),
    close: () => hidePopup(),
    pick: {
      start: () => pickStart(),
      cancel: () => pickCancel(true),
      active: () => PK.on,
      sample: (x, y, avg) => sampleAt(x, y, !!avg)
    },
    state: () => ({
      hex: rgbToHex(S.rgb), h: S.h, s: S.s, v: S.v, quietOk: S.quietOk, mapOn: S.mapOn,
      analysis: S.analysis, typed: S.typed, profileId: S.settings && S.settings.profileId, masks: S.masks.size,
      maskFor: (h) => {
        const id = S.settings && S.settings.profileId, m = id && S.masks.get(id + "|" + Math.round(h) % 360);
        if (!m) return null;
        return Array.from(m.getContext("2d").getImageData(0, 0, GRID, GRID).data.filter((_, i) => i % 4 === 3)).map((a) => (a ? 1 : 0));
      }
    }),
    _hsvToRgb: hsvToRgb,
    _rgbToHsv: rgbToHsv,
    geometry: () => Object.assign({ size: SIZE, ringIn: RING_IN, ringOut: RING_OUT, grid: GRID }, geom())
  };

  function boot() {
    if (bindUI()) return;
    let tries = 0;
    const iv = setInterval(() => {
      if (bindUI() || ++tries > 50) clearInterval(iv);
    }, 100);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
