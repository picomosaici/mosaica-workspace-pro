// colorEngine.js — il MOTORE COLORE di Mosaica (processo principale).
// Cantiere «Tintometro», Fetta 1 (15 ottobre 2026); Fetta 4 (16 ottobre): il «fuori stampa» senza la
// compensazione del nero (trappola 297) e il colore «near» per il «Portalo in stampa» della ruota.
//
// Cosa fa, detto con le mani:
//  • tiene acceso Little CMS (lcms-wasm, MIT): il «traduttore» fra i modi di fare colore;
//  • trova i PROFILI di stampa: quelli liberi che porta Mosaica (cartella profili-icc), quelli già
//    installati sul PC (cartella colori di Windows, profili Adobe) e quelli aggiunti a mano;
//  • prepara per il renderer le TABELLE del soft-proof (una LUT 33×33×33: «questo colore a video
//    diventa questo a stampa», più il segno «fuori stampa»);
//  • converte colori singoli (la ruota) e immagini intere (l'export, Fetta 2).
//
// Il renderer non carica Little CMS e non vede percorsi di file: chiede per «id» di profilo, e
// l'id viene SOLO dall'elenco che questo modulo ha costruito.
//
// ⚠ Trappola 281: l'aiutante `cmsDoTransform` di lcms-wasm sbaglia la lunghezza dell'uscita
//   (usa i canali extra dell'INGRESSO). Qui non si usa: buffer fatti a mano (_malloc / HEAPU8).
// ⚠ Trappola 282: nativeImage.toBitmap() dà BGRA → per le immagini si usa TYPE_BGRA_8.
// ⚠ Trappola 297 (Fetta 4): il segno «fuori stampa» si misura SENZA la compensazione del nero. Con lei
//   tutte le ombre si alzano un po' (il nero dello schermo va sul nero della stampa e il resto si
//   sposta in proporzione): misurato così, un grigio 60/60/60 che la stampa fa identico (ΔE 0) sembrava
//   fuori (ΔE 3), e con lui quasi ogni colore scuro. La compensazione resta dove serve: nelle
//   conversioni vere (CMYK della ruota, velo, PDF/X-1a).
"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { pathToFileURL } = require("url");

// Little CMS in WebAssembly, copiato dentro Mosaica (libs/lcms, MIT): niente pacchetto npm (si porterebbe
// dietro ~420 pacchetti di prove). È un modulo ES: si carica con import() anche dall'app.asar.
const LCMS_MODULE = path.join(__dirname, "libs", "lcms", "lcms.mjs");

const LUT_N = 33; // nodi per lato della tabella del soft-proof (misurato alla Fetta 0)
const GAMUT_SCALE = 25; // ΔE00 × 25 nel canale alfa della LUT (2 → 50)
const GAMUT_DE_DEFAULT = 2; // soglia del «fuori stampa» (ΔE00)
const PROFILE_MAX_BYTES = 12 * 1024 * 1024; // un profilo più grosso non è un profilo di stampa
const SCAN_MAX_FILES = 400; // per cartella
const XF_CACHE_MAX = 16; // trasformazioni tenute in memoria (Fetta 4: +1 per profilo, quella del «fuori stampa»)
const LUT_CACHE_MAX = 6;
const IMAGE_CHUNK_PX = 1 << 20; // un milione di pixel per volta, per non gonfiare la memoria del wasm
const INTENTS = ["relativo", "percettivo"];
const BUILTIN_DEFAULT = "ISOcoated_v2_bas.ICC"; // «FOGRA39 (di base)»
const BUILTIN_ADOBE_RGB = "AdobeCompat-v2.icc"; // compatibile Adobe RGB (1998), CC0

// Nomi da mostrare per i profili che porta Mosaica (il nome interno basICColor resta nel profilo).
const BUILTIN_LABELS = {
  "ISOcoated_v2_bas.ICC": "FOGRA39 — ISO Coated v2 (basICColor, di base)",
  "ISOcoated_v2_300_bas.ICC": "FOGRA39 — ISO Coated v2 300% (basICColor)",
  "AdobeCompat-v2.icc": "Compatibile Adobe RGB (1998)"
};

// ───────────────────────────── lettura dei profili ─────────────────────────────

// L'intestazione di un profilo ICC (128 byte) e il nome (tag desc / mluc). Null se non è un ICC.
function readIccInfo(buf) {
  if (!buf || buf.length < 132) return null;
  if (buf.toString("latin1", 36, 40) !== "acsp") return null;
  const size = buf.readUInt32BE(0);
  if (size > buf.length || size < 132) return null;
  const cls = buf.toString("latin1", 12, 16);
  const space = buf.toString("latin1", 16, 20).trim();
  const pcs = buf.toString("latin1", 20, 24).trim();
  const version = buf[8] + "." + (buf[9] >> 4);
  let name = "";
  try {
    const n = buf.readUInt32BE(128);
    for (let i = 0; i < n && 132 + 12 * i + 12 <= buf.length; i++) {
      const sig = buf.toString("latin1", 132 + 12 * i, 136 + 12 * i);
      if (sig !== "desc") continue;
      const off = buf.readUInt32BE(136 + 12 * i);
      const len = buf.readUInt32BE(140 + 12 * i);
      if (off + len > buf.length || len < 12) break;
      const t = buf.toString("latin1", off, off + 4);
      if (t === "desc") {
        const l = buf.readUInt32BE(off + 8);
        name = buf.toString("latin1", off + 12, off + 12 + Math.min(l, len - 12)).replace(/\0.*$/s, "");
      } else if (t === "mluc") {
        const rlen = buf.readUInt32BE(off + 20);
        const roff = buf.readUInt32BE(off + 24);
        const s = buf.subarray(off + roff, off + roff + rlen);
        let u = "";
        for (let k = 0; k + 1 < s.length; k += 2) u += String.fromCharCode(s.readUInt16BE(k));
        name = u.replace(/\0.*$/s, "");
      }
      break;
    }
  } catch (_) {}
  return { cls, space, pcs, version, name: name.trim() };
}

function sha16(buf) {
  return crypto.createHash("sha256").update(buf).digest("hex").slice(0, 16);
}

// ───────────────────────────── ΔE00 (CIEDE2000) ─────────────────────────────
function dE00(L1, a1, b1, L2, a2, b2) {
  const rad = Math.PI / 180;
  const C1 = Math.hypot(a1, b1), C2 = Math.hypot(a2, b2), Cm = (C1 + C2) / 2;
  const Cm7 = Math.pow(Cm, 7), G = 0.5 * (1 - Math.sqrt(Cm7 / (Cm7 + 6103515625)));
  const a1p = (1 + G) * a1, a2p = (1 + G) * a2;
  const C1p = Math.hypot(a1p, b1), C2p = Math.hypot(a2p, b2);
  const hue = (x, y) => { if (!x && !y) return 0; const v = Math.atan2(y, x) / rad; return v < 0 ? v + 360 : v; };
  const h1 = hue(a1p, b1), h2 = hue(a2p, b2);
  const dL = L2 - L1, dC = C2p - C1p;
  let dh = 0;
  if (C1p * C2p) { dh = h2 - h1; if (dh > 180) dh -= 360; else if (dh < -180) dh += 360; }
  const dH = 2 * Math.sqrt(C1p * C2p) * Math.sin((dh * rad) / 2);
  const Lm = (L1 + L2) / 2, Cpm = (C1p + C2p) / 2;
  let hm = h1 + h2;
  if (C1p * C2p) hm = Math.abs(h1 - h2) > 180 ? (h1 + h2 < 360 ? (h1 + h2 + 360) / 2 : (h1 + h2 - 360) / 2) : (h1 + h2) / 2;
  const T = 1 - 0.17 * Math.cos((hm - 30) * rad) + 0.24 * Math.cos(2 * hm * rad) + 0.32 * Math.cos((3 * hm + 6) * rad) - 0.2 * Math.cos((4 * hm - 63) * rad);
  const dTh = 30 * Math.exp(-Math.pow((hm - 275) / 25, 2));
  const Cpm7 = Math.pow(Cpm, 7), Rc = 2 * Math.sqrt(Cpm7 / (Cpm7 + 6103515625));
  const Sl = 1 + (0.015 * (Lm - 50) * (Lm - 50)) / Math.sqrt(20 + (Lm - 50) * (Lm - 50));
  const Sc = 1 + 0.045 * Cpm, Sh = 1 + 0.015 * Cpm * T, Rt = -Math.sin(2 * dTh * rad) * Rc;
  return Math.sqrt((dL / Sl) ** 2 + (dC / Sc) ** 2 + (dH / Sh) ** 2 + Rt * (dC / Sc) * (dH / Sh));
}

// ───────────────────────────── il motore ─────────────────────────────

/**
 * createColorEngine({ builtinDir, userDir, systemDirs, log, loadLcms })
 *  builtinDir : la cartella dei profili che porta Mosaica (profili-icc)
 *  userDir    : la cartella dei profili aggiunti a mano (userData/profili-icc)
 *  systemDirs : [{ dir, source }] cartelle dove cercare i profili già installati
 *  log        : (riga) => void (facoltativo)
 *  loadLcms   : () => Promise<modulo lcms-wasm> (facoltativo: di base import("lcms-wasm"))
 */
function createColorEngine(opts) {
  const o = opts || {};
  const log = typeof o.log === "function" ? o.log : () => {};
  const loadLcms = o.loadLcms || (() => import(pathToFileURL(LCMS_MODULE).href));
  let L = null, lcms = null, ready = null, hSRGB = 0, hLab = 0;
  let profiles = null; // elenco costruito da scan()
  const handles = new Map(); // id → handle lcms
  const xfCache = new Map(); // chiave → { t, fa, fb }
  const lutCache = new Map();

  function init() {
    if (ready) return ready;
    ready = (async () => {
      L = await loadLcms();
      lcms = await L.instantiate();
      hSRGB = lcms.cmsCreate_sRGBProfile();
      hLab = lcms.cmsCreateLab4Profile(0);
      if (!hSRGB || !hLab) throw new Error("Little CMS: profili di base non creati");
      return true;
    })();
    ready.catch((e) => { log("[colore] Little CMS non partito: " + (e && e.message)); ready = null; });
    return ready;
  }

  // ── l'elenco dei profili ──
  function _scanDir(dir, source, out, seen) {
    let names;
    try { names = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return; }
    let count = 0;
    for (const e of names) {
      if (count >= SCAN_MAX_FILES) break;
      if (!(e.isFile() || e.isSymbolicLink()) || !/\.(icc|icm)$/i.test(e.name)) continue;
      count++;
      const file = path.join(dir, e.name);
      try {
        const st = fs.statSync(file); // segue i collegamenti (trappola 286)
        if (!st.isFile() || st.size > PROFILE_MAX_BYTES || st.size < 132) continue;
        const buf = fs.readFileSync(file);
        const info = readIccInfo(buf);
        if (!info) continue;
        const isCmykPrinter = info.space === "CMYK" && info.cls === "prtr";
        const isRgb = info.space === "RGB";
        if (!isCmykPrinter && !(isRgb && source === "mosaica")) continue; // monitor & co. non servono
        const id = sha16(buf);
        if (seen.has(id)) { // stesso file in due posti: si tiene il primo (Mosaica prima di tutto)
          const prev = out.find((p) => p.id === id);
          if (prev && !prev.alsoIn.includes(source)) prev.alsoIn.push(source);
          continue;
        }
        seen.add(id);
        out.push({
          id,
          name: (source === "mosaica" && BUILTIN_LABELS[e.name]) || info.name || e.name,
          internalName: info.name,
          kind: isCmykPrinter ? "cmyk" : "rgb",
          source,
          alsoIn: [],
          fileName: e.name,
          file,
          bytes: st.size,
          version: info.version,
          builtinDefault: source === "mosaica" && e.name === BUILTIN_DEFAULT
        });
      } catch (err) {
        log(`[colore] profilo saltato ${file}: ${err && err.message}`);
      }
    }
  }

  function scan() {
    const out = [], seen = new Set();
    if (o.builtinDir) _scanDir(o.builtinDir, "mosaica", out, seen);
    if (o.userDir) _scanDir(o.userDir, "utente", out, seen);
    for (const s of o.systemDirs || []) if (s && s.dir) _scanDir(s.dir, s.source || "sistema", out, seen);
    profiles = out;
    return out;
  }

  function list(rescan) {
    if (!profiles || rescan) scan();
    // al renderer niente percorsi
    return profiles.map(({ file, ...p }) => ({ ...p, alsoIn: p.alsoIn.slice() }));
  }

  function find(id) {
    if (!profiles) scan();
    return profiles.find((p) => p.id === id) || null;
  }

  function defaultCmykId() {
    if (!profiles) scan();
    const d = profiles.find((p) => p.builtinDefault) || profiles.find((p) => p.kind === "cmyk");
    return d ? d.id : null;
  }

  function adobeRgbId() {
    if (!profiles) scan();
    const d = profiles.find((p) => p.source === "mosaica" && p.fileName === BUILTIN_ADOBE_RGB);
    return d ? d.id : null;
  }

  function profileBytes(id) {
    const p = find(id);
    if (!p) throw new Error("profilo sconosciuto");
    return fs.readFileSync(p.file);
  }

  function _handle(id) {
    if (handles.has(id)) return handles.get(id);
    const p = find(id);
    if (!p) throw new Error("profilo sconosciuto: " + id);
    const b = new Uint8Array(fs.readFileSync(p.file));
    const h = lcms.cmsOpenProfileFromMem(b, b.byteLength);
    if (!h) throw new Error("profilo non leggibile da Little CMS: " + p.name);
    handles.set(id, h);
    return h;
  }

  function _intent(intent) {
    if (intent === "percettivo") return L.INTENT_PERCEPTUAL;
    if (intent === "assoluto") return L.INTENT_ABSOLUTE_COLORIMETRIC;
    return L.INTENT_RELATIVE_COLORIMETRIC;
  }

  // una trasformazione, tenuta in memoria (le più vecchie si buttano)
  function _xf(key, make) {
    if (xfCache.has(key)) { const v = xfCache.get(key); xfCache.delete(key); xfCache.set(key, v); return v; }
    const v = make();
    if (!v.t) throw new Error("trasformazione non creata: " + key);
    xfCache.set(key, v);
    while (xfCache.size > XF_CACHE_MAX) {
      const k0 = xfCache.keys().next().value;
      try { lcms.cmsDeleteTransform(xfCache.get(k0).t); } catch (_) {}
      xfCache.delete(k0);
    }
    return v;
  }

  function _mk(hIn, fa, hOut, fb, intent, bpc) {
    const t = lcms.cmsCreateTransform(hIn, fa, hOut, fb, intent, bpc ? L.cmsFLAGS_BLACKPOINTCOMPENSATION : 0);
    return { t, fa, fb };
  }

  // sRGB → CMYK per il segno «fuori stampa»: relativo SENZA compensazione del nero (trappola 297)
  function _gamutXf(id, h) {
    return _xf(`s>c|${id}|gamut`, () => _mk(hSRGB, L.TYPE_RGB_16, h, L.TYPE_CMYK_16, L.INTENT_RELATIVE_COLORIMETRIC, false));
  }

  // byte per canale e canali (con gli extra) di un formato
  const _bpc = (fmt) => { const b = L.T_BYTES(fmt); return b < 1 ? 8 : b; };
  const _ch = (fmt) => L.T_CHANNELS(fmt) + L.T_EXTRA(fmt);

  // esegue una trasformazione su n pixel (input: TypedArray) → TypedArray nuovo
  function _run(X, input, n) {
    const ib = _bpc(X.fa), ob = _bpc(X.fb), ic = _ch(X.fa), oc = _ch(X.fb);
    const inBytes = n * ic * ib, outBytes = n * oc * ob;
    const src = new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
    if (src.length < inBytes) throw new Error("ingresso troppo corto");
    const pin = lcms._malloc(inBytes), pout = lcms._malloc(outBytes);
    if (!pin || !pout) { if (pin) lcms._free(pin); if (pout) lcms._free(pout); throw new Error("memoria del motore esaurita"); }
    try {
      lcms.HEAPU8.set(src.subarray(0, inBytes), pin);
      lcms._cmsDoTransform(X.t, pin, pout, n);
      const raw = lcms.HEAPU8.slice(pout, pout + outBytes); // copia
      if (ob === 8) return new Float64Array(raw.buffer);
      if (ob === 2) return new Uint16Array(raw.buffer);
      return raw;
    } finally {
      lcms._free(pin);
      lcms._free(pout);
    }
  }

  // ── la tabella del soft-proof ──
  // RGB(A) 8 bit, N³ nodi, rosso più veloce (come una texture 3D di WebGL: x = r, y = g, z = b).
  // R,G,B = come appare a stampa (CMYK col profilo e l'intento scelti, poi a video: relativo, o
  // assoluto se «simula carta»); A = ΔE00 fra il colore e la sua stampa (relativo) × 25.
  async function proofLut(profileId, intent, paper) {
    await init();
    const id = profileId || defaultCmykId();
    const p = find(id);
    if (!p || p.kind !== "cmyk") throw new Error("serve un profilo CMYK");
    intent = INTENTS.includes(intent) ? intent : "relativo";
    const key = `${id}|${intent}|${paper ? 1 : 0}`;
    if (lutCache.has(key)) return lutCache.get(key);
    const h = _handle(id), N = LUT_N, n = N * N * N;
    const toC = _xf(`s>c|${id}|${intent}`, () => _mk(hSRGB, L.TYPE_RGB_16, h, L.TYPE_CMYK_16, _intent(intent), true));
    const toCgam = _gamutXf(id, h);
    const back = _xf(`c>s|${id}|${paper ? "abs" : "rel"}`, () => _mk(h, L.TYPE_CMYK_16, hSRGB, L.TYPE_RGB_16, paper ? L.INTENT_ABSOLUTE_COLORIMETRIC : L.INTENT_RELATIVE_COLORIMETRIC, false));
    const backRel = _xf(`c>s|${id}|rel`, () => _mk(h, L.TYPE_CMYK_16, hSRGB, L.TYPE_RGB_16, L.INTENT_RELATIVE_COLORIMETRIC, false));
    const toLab = _xf(`s>lab`, () => _mk(hSRGB, L.TYPE_RGB_16, hLab, L.TYPE_Lab_DBL, L.INTENT_RELATIVE_COLORIMETRIC, false));
    const nodes = new Uint16Array(n * 3);
    let k = 0;
    for (let b = 0; b < N; b++) for (let g = 0; g < N; g++) for (let r = 0; r < N; r++) {
      nodes[k++] = Math.round((r * 65535) / (N - 1));
      nodes[k++] = Math.round((g * 65535) / (N - 1));
      nodes[k++] = Math.round((b * 65535) / (N - 1));
    }
    const shown = _run(back, _run(toC, nodes, n), n);
    const rel = _run(backRel, _run(toCgam, nodes, n), n); // trappola 297: senza compensazione del nero
    const la = _run(toLab, nodes, n), lb = _run(toLab, rel, n);
    const data = new Uint8Array(n * 4);
    for (let i = 0; i < n; i++) {
      data[4 * i] = Math.round(shown[3 * i] / 257);
      data[4 * i + 1] = Math.round(shown[3 * i + 1] / 257);
      data[4 * i + 2] = Math.round(shown[3 * i + 2] / 257);
      const d = dE00(la[3 * i], la[3 * i + 1], la[3 * i + 2], lb[3 * i], lb[3 * i + 1], lb[3 * i + 2]);
      data[4 * i + 3] = Math.min(255, Math.round(d * GAMUT_SCALE));
    }
    // il bianco della carta come appare (per il fondo del velo)
    const white = Array.from(_run(back, _run(toC, new Uint16Array([65535, 65535, 65535]), 1), 1)).map((v) => Math.round(v / 257));
    const res = { n: N, data, white, gamutScale: GAMUT_SCALE, gamutDE: GAMUT_DE_DEFAULT, profileId: id, intent, paper: !!paper };
    lutCache.set(key, res);
    while (lutCache.size > LUT_CACHE_MAX) lutCache.delete(lutCache.keys().next().value);
    return res;
  }

  // ── colori singoli (la ruota) ──
  // rgb: [[r,g,b], ...] 0–255 → [{ cmyk: [c,m,y,k] in % (1 decimale), proof: [r,g,b], near: [r,g,b], dE, out }]
  async function analyzeColors(profileId, intent, rgbList, paper) {
    await init();
    const id = profileId || defaultCmykId();
    const p = find(id);
    if (!p || p.kind !== "cmyk") throw new Error("serve un profilo CMYK");
    intent = INTENTS.includes(intent) ? intent : "relativo";
    const list = (Array.isArray(rgbList) ? rgbList : []).slice(0, 4096);
    const n = list.length;
    if (!n) return [];
    const h = _handle(id);
    const in16 = new Uint16Array(n * 3);
    list.forEach((c, i) => { for (let j = 0; j < 3; j++) in16[3 * i + j] = Math.max(0, Math.min(255, Math.round(+c[j] || 0))) * 257; });
    const toC = _xf(`s>c|${id}|${intent}`, () => _mk(hSRGB, L.TYPE_RGB_16, h, L.TYPE_CMYK_16, _intent(intent), true));
    const toCgam = _gamutXf(id, h);
    const back = _xf(`c>s|${id}|${paper ? "abs" : "rel"}`, () => _mk(h, L.TYPE_CMYK_16, hSRGB, L.TYPE_RGB_16, paper ? L.INTENT_ABSOLUTE_COLORIMETRIC : L.INTENT_RELATIVE_COLORIMETRIC, false));
    const backRel = _xf(`c>s|${id}|rel`, () => _mk(h, L.TYPE_CMYK_16, hSRGB, L.TYPE_RGB_16, L.INTENT_RELATIVE_COLORIMETRIC, false));
    const toLab = _xf(`s>lab`, () => _mk(hSRGB, L.TYPE_RGB_16, hLab, L.TYPE_Lab_DBL, L.INTENT_RELATIVE_COLORIMETRIC, false));
    const cmyk = _run(toC, in16, n);
    const proof = _run(back, cmyk, n);
    const rel = _run(backRel, _run(toCgam, in16, n), n); // trappola 297: senza compensazione del nero
    const la = _run(toLab, in16, n), lb = _run(toLab, rel, n);
    const out = [];
    for (let i = 0; i < n; i++) {
      const d = dE00(la[3 * i], la[3 * i + 1], la[3 * i + 2], lb[3 * i], lb[3 * i + 1], lb[3 * i + 2]);
      out.push({
        cmyk: [0, 1, 2, 3].map((j) => Math.round((cmyk[4 * i + j] / 655.35) * 10) / 10),
        proof: [0, 1, 2].map((j) => Math.round(proof[3 * i + j] / 257)),
        // Fetta 4: il più vicino che la stampa sa fare (andata e ritorno col relativo, senza compensazione
        // del nero e senza carta): è il colore del «Portalo in stampa» della ruota
        near: [0, 1, 2].map((j) => Math.round(rel[3 * i + j] / 257)),
        dE: Math.round(d * 100) / 100,
        out: d > GAMUT_DE_DEFAULT
      });
    }
    return out;
  }

  // CMYK in % → sRGB 0–255 (colorimetrico relativo). clipped = il colore non sta dentro sRGB.
  async function cmykToRgb(profileId, cmykPct) {
    await init();
    const id = profileId || defaultCmykId();
    const p = find(id);
    if (!p || p.kind !== "cmyk") throw new Error("serve un profilo CMYK");
    const h = _handle(id);
    const c16 = new Uint16Array(4);
    for (let j = 0; j < 4; j++) c16[j] = Math.round((Math.max(0, Math.min(100, +cmykPct[j] || 0)) / 100) * 65535);
    const toS = _xf(`c>s|${id}|rel`, () => _mk(h, L.TYPE_CMYK_16, hSRGB, L.TYPE_RGB_16, L.INTENT_RELATIVE_COLORIMETRIC, false));
    const toLabC = _xf(`c>lab|${id}`, () => _mk(h, L.TYPE_CMYK_16, hLab, L.TYPE_Lab_DBL, L.INTENT_RELATIVE_COLORIMETRIC, false));
    const toLab = _xf(`s>lab`, () => _mk(hSRGB, L.TYPE_RGB_16, hLab, L.TYPE_Lab_DBL, L.INTENT_RELATIVE_COLORIMETRIC, false));
    const s16 = _run(toS, c16, 1);
    const rgb = Array.from(s16).map((v) => Math.round(v / 257));
    const l1 = _run(toLabC, c16, 1), l2 = _run(toLab, s16, 1);
    const d = dE00(l1[0], l1[1], l1[2], l2[0], l2[1], l2[2]);
    return { rgb, clipped: d > GAMUT_DE_DEFAULT, dE: Math.round(d * 100) / 100 };
  }

  // ── immagini intere (export, Fetta 2) ──
  // bgra: Buffer/Uint8Array BGRA 8 bit (come nativeImage.toBitmap) — target:
  //   { kind: "cmyk", profileId, intent } → CMYK 8 bit (4 byte/pixel)
  //   { kind: "adobergb" }                → RGB 8 bit compatibile Adobe RGB (3 byte/pixel)
  async function convertImage(bgra, w, h, target) {
    await init();
    const n = w * h;
    if (!bgra || bgra.length < n * 4) throw new Error("immagine troppo corta");
    let X, oc;
    if (target && target.kind === "adobergb") {
      const id = adobeRgbId();
      if (!id) throw new Error("profilo compatibile Adobe RGB mancante");
      const hA = _handle(id);
      X = _xf(`img>argb|${id}`, () => _mk(hSRGB, L.TYPE_BGRA_8, hA, L.TYPE_RGB_8, L.INTENT_RELATIVE_COLORIMETRIC, false));
      oc = 3;
    } else {
      const id = (target && target.profileId) || defaultCmykId();
      const p = find(id);
      if (!p || p.kind !== "cmyk") throw new Error("serve un profilo CMYK");
      const intent = target && INTENTS.includes(target.intent) ? target.intent : "relativo";
      const hC = _handle(id);
      X = _xf(`img>c|${id}|${intent}`, () => _mk(hSRGB, L.TYPE_BGRA_8, hC, L.TYPE_CMYK_8, _intent(intent), true));
      oc = 4;
    }
    const out = new Uint8Array(n * oc);
    const src = bgra instanceof Uint8Array ? bgra : new Uint8Array(bgra);
    for (let start = 0; start < n; start += IMAGE_CHUNK_PX) {
      const cnt = Math.min(IMAGE_CHUNK_PX, n - start);
      const part = _run(X, src.subarray(start * 4, (start + cnt) * 4), cnt);
      out.set(part, start * oc);
    }
    return out;
  }

  // ── aggiungi un profilo (lo copia nella cartella dell'utente) ──
  function addProfileFile(srcPath) {
    if (!o.userDir) throw new Error("cartella dei profili non disponibile");
    const st = fs.statSync(srcPath);
    if (!st.isFile() || st.size > PROFILE_MAX_BYTES) return { ok: false, error: "non è un profilo (file troppo grande)" };
    const buf = fs.readFileSync(srcPath);
    const info = readIccInfo(buf);
    if (!info) return { ok: false, error: "non è un profilo ICC" };
    if (!(info.space === "CMYK" && info.cls === "prtr")) return { ok: false, error: "non è un profilo di stampa CMYK" };
    const id = sha16(buf);
    if (!profiles) scan();
    const already = profiles.find((p) => p.id === id);
    if (already) return { ok: true, already: true, profile: list().find((p) => p.id === id) };
    fs.mkdirSync(o.userDir, { recursive: true });
    let base = path.basename(srcPath).replace(/[^\w.\- ()%]/g, "_");
    if (!/\.(icc|icm)$/i.test(base)) base += ".icc";
    let dst = path.join(o.userDir, base), k = 1;
    while (fs.existsSync(dst)) dst = path.join(o.userDir, base.replace(/(\.\w+)$/, `_${k++}$1`));
    fs.writeFileSync(dst, buf);
    scan();
    return { ok: true, profile: list().find((p) => p.id === id) };
  }

  // toglie un profilo aggiunto a mano (solo quelli: gli altri non sono di Mosaica)
  function removeUserProfile(id) {
    const p = find(id);
    if (!p || p.source !== "utente") return { ok: false, error: "si possono togliere solo i profili aggiunti a mano" };
    try { fs.unlinkSync(p.file); } catch (e) { return { ok: false, error: e.message }; }
    if (handles.has(id)) { try { lcms.cmsCloseProfile(handles.get(id)); } catch (_) {} handles.delete(id); }
    for (const k of [...xfCache.keys()]) if (k.includes(id)) { try { lcms.cmsDeleteTransform(xfCache.get(k).t); } catch (_) {} xfCache.delete(k); }
    for (const k of [...lutCache.keys()]) if (k.startsWith(id)) lutCache.delete(k);
    scan();
    return { ok: true };
  }

  return {
    init, scan, list, find, defaultCmykId, adobeRgbId, profileBytes,
    proofLut, analyzeColors, cmykToRgb, convertImage, addProfileFile, removeUserProfile,
    get ready() { return !!lcms; },
    constants: { LUT_N, GAMUT_SCALE, GAMUT_DE_DEFAULT, INTENTS: INTENTS.slice() }
  };
}

// ───────────────────────────── cartelle di sistema ─────────────────────────────
function systemProfileDirs(env, platform) {
  env = env || process.env;
  platform = platform || process.platform;
  const dirs = [];
  if (platform === "win32") {
    const sysRoot = env.SystemRoot || env.windir || "C:\\Windows";
    dirs.push({ dir: path.join(sysRoot, "System32", "spool", "drivers", "color"), source: "windows" });
    for (const cp of [env.CommonProgramFiles, env["CommonProgramFiles(x86)"], env.CommonProgramW6432]) {
      if (!cp) continue;
      dirs.push({ dir: path.join(cp, "Adobe", "Color", "Profiles"), source: "adobe" });
      dirs.push({ dir: path.join(cp, "Adobe", "Color", "Profiles", "Recommended"), source: "adobe" });
    }
    if (env.APPDATA) dirs.push({ dir: path.join(env.APPDATA, "Adobe", "Color", "Profiles"), source: "adobe" });
  } else if (platform === "darwin") {
    dirs.push({ dir: "/Library/ColorSync/Profiles", source: "sistema" });
    if (env.HOME) dirs.push({ dir: path.join(env.HOME, "Library", "ColorSync", "Profiles"), source: "sistema" });
    dirs.push({ dir: "/Library/Application Support/Adobe/Color/Profiles/Recommended", source: "adobe" });
  } else {
    dirs.push({ dir: "/usr/share/color/icc", source: "sistema" });
    if (env.HOME) dirs.push({ dir: path.join(env.HOME, ".local", "share", "icc"), source: "sistema" });
  }
  // senza doppioni (CommonProgramFiles e CommonProgramW6432 sono spesso la stessa cartella)
  const seen = new Set();
  return dirs.filter((d) => { const k = d.dir.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; });
}

// ───────────────────────────── IPC (main.js) ─────────────────────────────
// Le preferenze di stampa (profilo, intento, simula carta) stanno in userData/colore.json.
function registerColorIpc(ipcMain, deps) {
  const { app, dialog, getMainWindow, getUserDataSubdir } = deps;
  const log = typeof deps.appendLog === "function" ? deps.appendLog : () => {};
  const builtinDir = app.isPackaged ? path.join(process.resourcesPath, "profili-icc") : path.join(__dirname, "profili-icc");
  const engine = createColorEngine({
    builtinDir,
    userDir: getUserDataSubdir("profili-icc"),
    systemDirs: systemProfileDirs(),
    log
  });
  const SETTINGS = path.join(app.getPath("userData"), "colore.json");

  function readSettings() {
    let s = {};
    try { s = JSON.parse(fs.readFileSync(SETTINGS, "utf8")) || {}; } catch (_) {}
    const ids = new Set(engine.list().filter((p) => p.kind === "cmyk").map((p) => p.id));
    return {
      profileId: ids.has(s.profileId) ? s.profileId : engine.defaultCmykId(),
      intent: INTENTS.includes(s.intent) ? s.intent : "relativo",
      paper: s.paper !== false,
      gamutWarning: !!s.gamutWarning
    };
  }

  // gli errori al renderer senza percorsi di file (nel log invece tutto)
  const clean = (m) => String(m).replace(/(?:[A-Za-z]:)?[\\/][^\s'"]*[\\/]([^\s'"\\/]+)/g, "…/$1");
  const safe = (fn) => async (...a) => {
    try { return await fn(...a); } catch (e) { log("[colore] " + ((e && e.stack) || e)); return { ok: false, error: clean((e && e.message) || e) }; }
  };

  ipcMain.handle("color:list", safe((_e, rescan) => ({ ok: true, profiles: engine.list(!!rescan), defaultId: engine.defaultCmykId() })));
  ipcMain.handle("color:getSettings", safe(() => ({ ok: true, settings: readSettings() })));
  ipcMain.handle("color:setSettings", safe((_e, s) => {
    const cur = readSettings();
    const ids = new Set(engine.list().filter((p) => p.kind === "cmyk").map((p) => p.id));
    const next = {
      profileId: s && ids.has(s.profileId) ? s.profileId : cur.profileId,
      intent: s && INTENTS.includes(s.intent) ? s.intent : cur.intent,
      paper: s && typeof s.paper === "boolean" ? s.paper : cur.paper,
      gamutWarning: s && typeof s.gamutWarning === "boolean" ? s.gamutWarning : cur.gamutWarning
    };
    fs.writeFileSync(SETTINGS, JSON.stringify(next, null, 2), "utf8");
    return { ok: true, settings: next };
  }));
  ipcMain.handle("color:proofLut", safe(async (_e, a) => {
    const s = readSettings();
    const r = await engine.proofLut((a && a.profileId) || s.profileId, (a && a.intent) || s.intent, a && typeof a.paper === "boolean" ? a.paper : s.paper);
    return { ok: true, ...r };
  }));
  ipcMain.handle("color:analyze", safe(async (_e, a) => {
    const s = readSettings();
    const r = await engine.analyzeColors((a && a.profileId) || s.profileId, (a && a.intent) || s.intent, a && a.colors, a && typeof a.paper === "boolean" ? a.paper : s.paper);
    return { ok: true, results: r };
  }));
  ipcMain.handle("color:cmykToRgb", safe(async (_e, a) => {
    const s = readSettings();
    return { ok: true, ...(await engine.cmykToRgb((a && a.profileId) || s.profileId, a && a.cmyk)) };
  }));
  ipcMain.handle("color:addProfile", safe(async () => {
    const win = getMainWindow && getMainWindow();
    const options = { title: "Aggiungi un profilo di stampa (.icc)", properties: ["openFile"], filters: [{ name: "Profili ICC", extensions: ["icc", "icm"] }] };
    const r = win && !win.isDestroyed() ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options);
    if (r.canceled || !r.filePaths || !r.filePaths[0]) return { ok: false, canceled: true };
    return engine.addProfileFile(r.filePaths[0]);
  }));
  ipcMain.handle("color:removeProfile", safe((_e, id) => engine.removeUserProfile(id)));
  return engine;
}

module.exports = { createColorEngine, systemProfileDirs, registerColorIpc, readIccInfo, dE00 };
