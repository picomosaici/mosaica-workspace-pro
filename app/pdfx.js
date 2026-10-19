// pdfx.js — i FILE PER LA STAMPA (processo principale).
// Cantiere «Tintometro», Fetta 2 (16 ottobre 2026).
//
// Detto con le mani: Mosaica fotografa il foglio intero a 300 DPI (printColor.js, nella pagina), il
// motore colore (colorEngine.js, Fetta 1) ne cambia i colori, e qui si scrive il file che va in
// copisteria:
//  • PDF/X-4  — l'immagine resta RGB «compatibile Adobe RGB (1998)» col suo profilo dentro; dentro c'è
//               anche il profilo di STAMPA scelto (OutputIntent): la copisteria converte in CMYK come fa
//               sempre (decisione C2);
//  • PDF/X-1a — l'immagine è già CMYK, convertita qui col profilo e la resa scelti;
//  • PNG      — RGB compatibile Adobe RGB col profilo dentro, per chi chiede un'immagine.
// E una cosa piccola per il PNG completo di sempre: l'etichetta «sRGB» (B2), così chi lo apre non lo
// prende per Adobe RGB.
//
// PDFKit non sa fare PDF/X: una pagina con un'immagine sola si scrive a mano, con zlib di Node.
// Il prototipo è passato dal Preflight di Acrobat Pro di Mirko (15/10/2026: «PDF/X-1a:2001» e «PDF/X-4»).
//
// ⚠ Il renderer non vede percorsi: sceglie il profilo per «id» (dall'elenco del motore colore) e riceve
//   indietro solo il NOME del file scritto.
"use strict";

const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const crypto = require("crypto");

const PRODUCER = "Mosaica Workspace Pro";
const FORMATS = ["x4", "x1a", "png"];
const MAX_SIDE_PX = 20000; // A4 a 300 DPI = 2480 × 3508: c'è margine
const MAX_PIXELS = 120e6;

// ───────────────────────────── piccole cose ─────────────────────────────

// Stringa di testo PDF: ASCII stampabile così com'è; se c'è altro, UTF-16BE col BOM in esadecimale
// (ammessa da PDF 1.2 in poi, quindi anche nel PDF 1.3 del PDF/X-1a).
function pdfText(s) {
  s = String(s == null ? "" : s);
  if (/^[\x20-\x7e]*$/.test(s)) return "(" + s.replace(/[\\()]/g, (c) => "\\" + c) + ")";
  let hex = "FEFF";
  for (let i = 0; i < s.length; i++) hex += s.charCodeAt(i).toString(16).toUpperCase().padStart(4, "0");
  return "<" + hex + ">";
}

function pdfDate(d) {
  const p = (n) => String(n).padStart(2, "0");
  const off = -d.getTimezoneOffset();
  const a = Math.abs(off);
  return `D:${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}${off >= 0 ? "+" : "-"}${p(Math.floor(a / 60))}'${p(a % 60)}'`;
}

function xmpDate(d) {
  const p = (n) => String(n).padStart(2, "0");
  const off = -d.getTimezoneOffset();
  const a = Math.abs(off);
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}${off >= 0 ? "+" : "-"}${p(Math.floor(a / 60))}:${p(a % 60)}`;
}

const xmlEsc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const num = (n) => (Number.isInteger(n) ? String(n) : n.toFixed(4).replace(/0+$/, "").replace(/\.$/, ""));

// La condizione di stampa per l'OutputIntent. Un nome del registro ICC (color.org) se il profilo è di
// una condizione registrata; altrimenti «Custom»: il profilo dentro il PDF basta, ma il nome del
// registro non si inventa. ISO Coated v2 (ECI e basICColor, anche 300%) è FOGRA39.
const CONDITIONS = [
  { re: /FOGRA\s*-?\s*(\d{2})/i, id: (m) => "FOGRA" + m[1] },
  { re: /ISO\s*Coated\s*v2/i, id: () => "FOGRA39" },
  { re: /PSO\s*Coated\s*v3/i, id: () => "FOGRA51" },
  { re: /PSO\s*Uncoated\s*v3/i, id: () => "FOGRA52" },
  { re: /GRACoL\s*2006/i, id: () => "CGATS TR 006" },
  { re: /U\.?S\.?\s*Web\s*Coated\s*\(SWOP\)\s*v2/i, id: () => "CGATS TR 001" }
];
const CONDITION_TEXT = {
  FOGRA39: "Offset printing, according to ISO 12647-2:2004/Amd 1, paper type 1 or 2 (coated), FOGRA39L",
  FOGRA51: "Offset printing, according to ISO 12647-2:2013, PS1 (premium coated), FOGRA51",
  FOGRA52: "Offset printing, according to ISO 12647-2:2013, PS5 (wood-free uncoated), FOGRA52"
};
function outputConditionFor(profile) {
  const text = [profile && profile.internalName, profile && profile.name, profile && profile.fileName].filter(Boolean).join(" | ");
  for (const c of CONDITIONS) {
    const m = text.match(c.re);
    if (m) {
      const id = c.id(m);
      return { id, registry: "http://www.color.org", condition: CONDITION_TEXT[id] || null };
    }
  }
  return { id: "Custom", registry: null, condition: null };
}

// ───────────────────────────── il PDF/X ─────────────────────────────
/**
 * writePdfX({ kind: "x1a"|"x4", widthPt, heightPt, imgW, imgH, pixels, imageIcc, outputIcc,
 *             outputInfo, outputConditionId, registryName, outputCondition, title, date }) → Buffer
 *  pixels: CMYK 8 bit (4 byte/pixel) per x1a, RGB 8 bit (3 byte/pixel) per x4.
 */
function writePdfX(o) {
  const kind = o.kind;
  if (kind !== "x1a" && kind !== "x4") throw new Error("pdfx: kind deve essere x1a o x4");
  const comps = kind === "x1a" ? 4 : 3;
  if (!o.pixels || o.pixels.length !== o.imgW * o.imgH * comps) throw new Error("pdfx: pixel di lunghezza sbagliata");
  if (!o.outputIcc) throw new Error("pdfx: manca il profilo di stampa");
  if (kind === "x4" && !o.imageIcc) throw new Error("pdfx: manca il profilo RGB dell'immagine");
  const date = o.date || new Date();
  const title = o.title || "Mosaico";
  const W = num(o.widthPt), H = num(o.heightPt);
  const condId = o.outputConditionId || "FOGRA39";
  const registry = o.registryName === undefined ? "http://www.color.org" : o.registryName;

  const objs = [];
  const add = (body) => { objs.push(body); return objs.length; };
  const B = (s) => Buffer.from(s, "latin1");
  const stream = (dict, data) => Buffer.concat([B(`<< ${dict ? dict + " " : ""}/Length ${data.length} >>\nstream\n`), data, B("\nendstream")]);

  // numeri fissi: 1 catalogo, 2 pagine, 3 pagina
  const nCatalog = add(null), nPages = add(null), nPage = add(null);
  const nOutIcc = add(stream(`/N 4 /Filter /FlateDecode`, zlib.deflateSync(o.outputIcc, { level: 9 })));
  let nImgIcc = 0;
  if (kind === "x4") nImgIcc = add(stream(`/N 3 /Filter /FlateDecode`, zlib.deflateSync(o.imageIcc, { level: 9 })));
  const cs = kind === "x1a" ? "/DeviceCMYK" : `[/ICCBased ${nImgIcc} 0 R]`;
  const img = zlib.deflateSync(Buffer.from(o.pixels.buffer, o.pixels.byteOffset, o.pixels.byteLength), { level: 6 });
  const nImg = add(stream(`/Type /XObject /Subtype /Image /Width ${o.imgW} /Height ${o.imgH} /ColorSpace ${cs} /BitsPerComponent 8 /Interpolate false /Filter /FlateDecode`, img));
  const nContent = add(stream(``, B(`q\n${W} 0 0 ${H} 0 0 cm\n/Im0 Do\nQ\n`)));
  const nIntent = add(
    B(
      `<< /Type /OutputIntent /S /GTS_PDFX /OutputConditionIdentifier ${pdfText(condId)}` +
        (registry ? ` /RegistryName ${pdfText(registry)}` : "") +
        ` /Info ${pdfText(o.outputInfo || condId)}` +
        (o.outputCondition ? ` /OutputCondition ${pdfText(o.outputCondition)}` : "") +
        ` /DestOutputProfile ${nOutIcc} 0 R >>`
    )
  );

  const docId = crypto.createHash("md5").update(title + "|" + date.toISOString() + "|" + o.imgW + "x" + o.imgH + "|" + crypto.randomBytes(8).toString("hex")).digest("hex");
  let nMeta = 0;
  if (kind === "x4") {
    const uuid = `${docId.slice(0, 8)}-${docId.slice(8, 12)}-${docId.slice(12, 16)}-${docId.slice(16, 20)}-${docId.slice(20, 32)}`;
    const xd = xmpDate(date);
    const xmp =
      `<?xpacket begin="﻿" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/">
 <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
  <rdf:Description rdf:about=""
    xmlns:dc="http://purl.org/dc/elements/1.1/"
    xmlns:xmp="http://ns.adobe.com/xap/1.0/"
    xmlns:pdf="http://ns.adobe.com/pdf/1.3/"
    xmlns:xmpMM="http://ns.adobe.com/xap/1.0/mm/"
    xmlns:pdfxid="http://www.npes.org/pdfx/ns/id/">
   <dc:format>application/pdf</dc:format>
   <dc:title><rdf:Alt><rdf:li xml:lang="x-default">${xmlEsc(title)}</rdf:li></rdf:Alt></dc:title>
   <xmp:CreateDate>${xd}</xmp:CreateDate>
   <xmp:ModifyDate>${xd}</xmp:ModifyDate>
   <xmp:MetadataDate>${xd}</xmp:MetadataDate>
   <xmp:CreatorTool>${PRODUCER}</xmp:CreatorTool>
   <pdf:Producer>${PRODUCER}</pdf:Producer>
   <pdf:Trapped>False</pdf:Trapped>
   <xmpMM:DocumentID>uuid:${uuid}</xmpMM:DocumentID>
   <xmpMM:InstanceID>uuid:${uuid}</xmpMM:InstanceID>
   <xmpMM:VersionID>1</xmpMM:VersionID>
   <xmpMM:RenditionClass>default</xmpMM:RenditionClass>
   <pdfxid:GTS_PDFXVersion>PDF/X-4</pdfxid:GTS_PDFXVersion>
  </rdf:Description>
 </rdf:RDF>
</x:xmpmeta>
` + (" ".repeat(100) + "\n").repeat(20) + `<?xpacket end="w"?>`;
    nMeta = add(stream(`/Type /Metadata /Subtype /XML`, Buffer.from(xmp, "utf8")));
  }
  const pd = pdfDate(date);
  const nInfo = add(
    B(
      `<< /Title ${pdfText(title)} /Creator ${pdfText(PRODUCER)} /Producer ${pdfText(PRODUCER)} /CreationDate ${pdfText(pd)} /ModDate ${pdfText(pd)} /Trapped /False` +
        (kind === "x1a" ? ` /GTS_PDFXVersion (PDF/X-1:2001) /GTS_PDFXConformance (PDF/X-1a:2001)` : ` /GTS_PDFXVersion (PDF/X-4)`) +
        ` >>`
    )
  );

  objs[nCatalog - 1] = B(`<< /Type /Catalog /Pages ${nPages} 0 R /OutputIntents [${nIntent} 0 R]${nMeta ? ` /Metadata ${nMeta} 0 R` : ""} >>`);
  objs[nPages - 1] = B(`<< /Type /Pages /Kids [${nPage} 0 R] /Count 1 >>`);
  objs[nPage - 1] = B(
    `<< /Type /Page /Parent ${nPages} 0 R /MediaBox [0 0 ${W} ${H}] /TrimBox [0 0 ${W} ${H}] /Resources << /XObject << /Im0 ${nImg} 0 R >> /ProcSet [/PDF /ImageC] >> /Contents ${nContent} 0 R >>`
  );

  const header = B(`%PDF-${kind === "x1a" ? "1.3" : "1.6"}\n%\xE2\xE3\xCF\xD3\n`);
  const parts = [header];
  const offsets = [];
  let pos = header.length;
  objs.forEach((body, i) => {
    const head = B(`${i + 1} 0 obj\n`), tail = B(`\nendobj\n`);
    offsets.push(pos);
    parts.push(head, body, tail);
    pos += head.length + body.length + tail.length;
  });
  let xref = `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  offsets.forEach((off) => (xref += `${String(off).padStart(10, "0")} 00000 n \n`));
  parts.push(B(xref + `trailer\n<< /Size ${objs.length + 1} /Root ${nCatalog} 0 R /Info ${nInfo} 0 R /ID [<${docId}> <${docId}>] >>\nstartxref\n${pos}\n%%EOF\n`));
  return Buffer.concat(parts);
}

// ───────────────────────────── il PNG ─────────────────────────────
// zlib.crc32 c'è da Node 22.2 (Electron 41 lo ha); la tabella è la riserva per un Node più vecchio.
let _crcTable = null;
function crc32(buf) {
  if (typeof zlib.crc32 === "function") return zlib.crc32(buf) >>> 0;
  if (!_crcTable) {
    _crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      _crcTable[n] = c >>> 0;
    }
  }
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = _crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, "latin1"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

const PNG_SIG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

function physChunk(dpi) {
  const p = Buffer.alloc(9);
  const ppm = Math.round(dpi / 0.0254);
  p.writeUInt32BE(ppm, 0);
  p.writeUInt32BE(ppm, 4);
  p[8] = 1;
  return pngChunk("pHYs", p);
}

/** PNG RGB 8 bit col profilo dentro (iCCP) e la risoluzione (pHYs). */
function writePngRgb({ w, h, rgb, icc, iccName, dpi }) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit per canale
  ihdr[9] = 2; // RGB
  const stride = w * 3 + 1;
  const raw = Buffer.alloc(stride * h);
  const src = Buffer.from(rgb.buffer, rgb.byteOffset, rgb.byteLength);
  for (let y = 0; y < h; y++) src.copy(raw, y * stride + 1, y * w * 3, (y + 1) * w * 3); // filtro 0 su ogni riga
  const parts = [PNG_SIG, pngChunk("IHDR", ihdr)];
  if (icc) {
    const name = String(iccName || "ICC profile").replace(/[^\x20-\x7e]/g, "").slice(0, 79) || "ICC profile";
    parts.push(pngChunk("iCCP", Buffer.concat([Buffer.from(name, "latin1"), Buffer.from([0, 0]), zlib.deflateSync(icc, { level: 9 })])));
  }
  if (dpi) parts.push(physChunk(dpi));
  parts.push(pngChunk("IDAT", zlib.deflateSync(raw, { level: 6 })), pngChunk("IEND", Buffer.alloc(0)));
  return Buffer.concat(parts);
}

/**
 * B2 — l'etichetta sRGB sul PNG completo di sempre: i pixel restano quelli, si aggiungono subito dopo
 * l'intestazione i blocchi sRGB (resa percettiva), gAMA e cHRM (per i programmi che non leggono sRGB).
 * Un PNG che ha già un profilo o un'etichetta di colore resta com'è. Se qualcosa non torna, il PNG
 * esce identico a prima.
 */
function addSrgbChunk(buf) {
  try {
    if (!Buffer.isBuffer(buf) || buf.length < 33 || !buf.subarray(0, 8).equals(PNG_SIG)) return buf;
    if (buf.toString("latin1", 12, 16) !== "IHDR") return buf;
    const afterIhdr = 8 + 8 + buf.readUInt32BE(8) + 4;
    for (let p = 8; p + 8 <= buf.length; ) {
      const len = buf.readUInt32BE(p);
      const type = buf.toString("latin1", p + 4, p + 8);
      if (type === "iCCP" || type === "sRGB" || type === "cICP") return buf;
      if (type === "IDAT" || type === "IEND") break;
      p += 12 + len;
    }
    const gama = Buffer.alloc(4);
    gama.writeUInt32BE(45455);
    const chrm = Buffer.alloc(32);
    [31270, 32900, 64000, 33000, 30000, 60000, 15000, 6000].forEach((v, i) => chrm.writeUInt32BE(v, i * 4));
    return Buffer.concat([buf.subarray(0, afterIhdr), pngChunk("sRGB", Buffer.from([0])), pngChunk("gAMA", gama), pngChunk("cHRM", chrm), buf.subarray(afterIhdr)]);
  } catch (_) {
    return buf;
  }
}

// ───────────────────────────── IPC (main.js) ─────────────────────────────
/**
 * registerPrintIpc(ipcMain, { engine, app, dialog, getMainWindow, appendLog })
 *  canale «color:exportPrint»: { format: "x4"|"x1a"|"png", width, height (pixel), widthMm, heightMm,
 *  pixels (RGBA, già su bianco), profileId?, intent?, title?, baseName?, testi? }
 *  → { ok:true, name, bytes, ms, condition } | { ok:false, canceled:true } | { ok:false, code?, error }
 */
function registerPrintIpc(ipcMain, deps) {
  const { engine, app, dialog, getMainWindow } = deps;
  const log = typeof deps.appendLog === "function" ? deps.appendLog : () => {};
  let lastDir = null;

  const clean = (m) => String(m).replace(/(?:[A-Za-z]:)?[\\/][^\s'"]*[\\/]([^\s'"\\/]+)/g, "…/$1");
  const fail = (code, error) => ({ ok: false, code, error: error || code });
  const safeBase = (s) =>
    String(s || "")
      .replace(/\.msp\.json$/i, "")
      .replace(/[\\/:*?"<>|\x00-\x1f]/g, "_")
      .trim()
      .slice(0, 80) || "mosaico";

  ipcMain.handle("color:exportPrint", async (_e, a) => {
    const t0 = Date.now();
    try {
      if (!a || typeof a !== "object") return fail("bad", "richiesta vuota");
      const format = FORMATS.includes(a.format) ? a.format : null;
      if (!format) return fail("bad", "formato sconosciuto");
      const w = a.width | 0, h = a.height | 0;
      if (w < 1 || h < 1 || w > MAX_SIDE_PX || h > MAX_SIDE_PX || w * h > MAX_PIXELS) return fail("bad", "misura dell'immagine non valida");
      const wMm = +a.widthMm, hMm = +a.heightMm;
      if (!(wMm >= 10 && wMm <= 2000 && hMm >= 10 && hMm <= 2000)) return fail("bad", "misura del foglio non valida");
      const px = a.pixels;
      if (!px || !ArrayBuffer.isView(px) || px.byteLength !== w * h * 4) return fail("bad", "immagine di lunghezza sbagliata");

      // il profilo di stampa (non serve per il PNG)
      let profile = null;
      if (format !== "png") {
        const id = typeof a.profileId === "string" && a.profileId ? a.profileId : engine.defaultCmykId();
        profile = engine.find(id);
        if (!profile || profile.kind !== "cmyk") return fail("noProfile", "profilo di stampa sconosciuto");
        // PDF/X-1a è un PDF 1.3: dentro ci sta solo un profilo ICC versione 2
        if (format === "x1a" && parseFloat(profile.version) >= 4) return fail("iccV4", "il PDF/X-1a vuole un profilo ICC versione 2");
      }
      const intent = a.intent === "percettivo" ? "percettivo" : "relativo";
      const adobeId = engine.adobeRgbId();
      if (format !== "x1a" && !adobeId) return fail("noAdobe", "profilo compatibile Adobe RGB mancante");

      // ── dove salvare
      const testi = (a.testi && typeof a.testi === "object" && a.testi) || {};
      const base = safeBase(a.baseName);
      const short = profile ? (outputConditionFor(profile).id === "Custom" ? "CMYK" : outputConditionFor(profile).id.replace(/\s+/g, "")) : "";
      const fileName = format === "png" ? `${base}_AdobeRGB.png` : `${base}_PDFX-${format === "x4" ? "4" : "1a"}_${short}.pdf`;
      const filters = format === "png" ? [{ name: "PNG", extensions: ["png"] }] : [{ name: "PDF/X", extensions: ["pdf"] }];
      const options = { title: String(testi.title || "Esporta per la stampa").slice(0, 120), defaultPath: path.join(lastDir || app.getPath("documents"), fileName), filters };
      const win = getMainWindow && getMainWindow();
      const r = win && !win.isDestroyed() ? await dialog.showSaveDialog(win, options) : await dialog.showSaveDialog(options);
      if (r.canceled || !r.filePath) return { ok: false, canceled: true };
      let filePath = r.filePath;
      const ext = format === "png" ? ".png" : ".pdf";
      if (path.extname(filePath).toLowerCase() !== ext) filePath += ext;
      lastDir = path.dirname(filePath);

      // ── i colori. Dalla pagina arriva RGBA; il motore vuole BGRA (come nativeImage, trappola 282).
      const bgra = Buffer.from(px.buffer, px.byteOffset, px.byteLength);
      for (let i = 0; i < bgra.length; i += 4) {
        const t = bgra[i];
        bgra[i] = bgra[i + 2];
        bgra[i + 2] = t;
      }
      const dpi = (w / wMm) * 25.4;
      const title = String(a.title || base).slice(0, 120);
      let out;
      let condition = null;
      if (format === "png") {
        const rgb = await engine.convertImage(bgra, w, h, { kind: "adobergb" });
        out = writePngRgb({ w, h, rgb, icc: engine.profileBytes(adobeId), iccName: "Adobe RGB (1998) compatible", dpi });
      } else {
        const cond = outputConditionFor(profile);
        condition = cond.id;
        const common = {
          widthPt: (wMm / 25.4) * 72,
          heightPt: (hMm / 25.4) * 72,
          imgW: w,
          imgH: h,
          outputIcc: engine.profileBytes(profile.id),
          outputInfo: profile.internalName || profile.name,
          outputConditionId: cond.id,
          registryName: cond.registry,
          outputCondition: cond.condition,
          title,
          date: new Date()
        };
        if (format === "x4") {
          const rgb = await engine.convertImage(bgra, w, h, { kind: "adobergb" });
          out = writePdfX(Object.assign({ kind: "x4", pixels: rgb, imageIcc: engine.profileBytes(adobeId) }, common));
        } else {
          const cmyk = await engine.convertImage(bgra, w, h, { kind: "cmyk", profileId: profile.id, intent });
          out = writePdfX(Object.assign({ kind: "x1a", pixels: cmyk }, common));
        }
      }
      fs.writeFileSync(filePath, out);
      const ms = Date.now() - t0;
      log(`${new Date().toISOString()}  export stampa ${format} ${w}x${h} ${condition || ""} ${out.length} byte in ${ms} ms`);
      return { ok: true, name: path.basename(filePath), bytes: out.length, ms, condition };
    } catch (e) {
      log("[stampa] " + ((e && e.stack) || e));
      return fail("error", clean((e && e.message) || e));
    }
  });
}

module.exports = { writePdfX, writePngRgb, addSrgbChunk, outputConditionFor, registerPrintIpc, pdfText };
