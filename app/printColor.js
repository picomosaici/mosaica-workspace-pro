// printColor.js — ESPORTA PER LA STAMPA (la finestra nella pagina).
// Cantiere «Tintometro», Fetta 2 (16 ottobre 2026).
//
// Detto con le mani: si fotografa il foglio INTERO a 300 DPI sulla misura vera del foglio, proprio come
// il «PNG completo» (sfondo vuoto mentre si disegna e bianco messo dopo, così l'acquerello in «overlay»
// esce uguale a quello che si vede), e lo si manda al processo principale, che cambia i colori col motore
// colore (Fetta 1) e scrive il file (pdfx.js):
//   • PDF/X-4  — RGB compatibile Adobe RGB + il profilo di stampa dentro: la copisteria converte (C2);
//   • PDF/X-1a — già CMYK, col profilo e la resa scelti;
//   • PNG      — RGB compatibile Adobe RGB col profilo dentro.
// Profilo e resa sono GLI STESSI della prova di stampa (softProof.js): quello che si vede col velo
// acceso è quello che esce. Il formato scelto si ricorda in questo PC.
//
// ⚠ Zero righe in renderer.js. Si leggono per nome (script classici) A4_MM_W / A4_MM_H (la misura del
//   foglio) e currentProjectPath (il nome del file), sempre con la guardia; e si usano le porte già su
//   window: canvas, reorderCanvasLayers, hasUserBackgroundImage, flashToast.
// ⚠ Si usa canvas.toCanvasElement (lo stesso disegno di toDataURL, senza codificare e ridecodificare un
//   PNG da 35 MB): renderer.js lo avvolge per spegnere il «culling», quindi esce sempre il foglio intero.
//   Identico da Fabric 5.1.0 a 5.5.2.
(function () {
  "use strict";
  if (window.printColor) return;

  const DPI = 300;
  const FORMATS = ["x4", "x1a", "png"];
  const KEY_FORMAT = "mosaica_printExport_format";
  const GROUPS = ["mosaica", "utente", "windows", "adobe", "sistema"];
  const GROUP_FALLBACK = { mosaica: "Di Mosaica (liberi)", utente: "Aggiunti da te", windows: "Installati in Windows", adobe: "Profili Adobe", sistema: "Del sistema" };

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
      else console.log("[printColor]", msg);
    } catch (_) {}
  };
  const api = () => (window.colorAPI && typeof window.colorAPI.exportPrint === "function" ? window.colorAPI : null);

  const S = { busy: false, profiles: [], defaultId: null, settings: null };

  // ───────────────────────── il foglio ─────────────────────────
  // La misura VERA del foglio in mm (la tiene renderer.js; cambia con l'orientamento).
  function sheetMm() {
    let w = 0, h = 0;
    try {
      if (typeof A4_MM_W === "number" && typeof A4_MM_H === "number") {
        w = A4_MM_W;
        h = A4_MM_H;
      }
    } catch (_) {}
    if (!(w > 0 && h > 0)) {
      const c = window.canvas;
      const land = c && c.getWidth() > c.getHeight();
      w = land ? 297 : 210;
      h = land ? 210 : 297;
    }
    return { w, h };
  }

  function sheetPx() {
    const mm = sheetMm();
    return { mm, w: Math.max(1, Math.round((mm.w / 25.4) * DPI)), h: Math.max(1, Math.round((mm.h / 25.4) * DPI)) };
  }

  function baseName() {
    try {
      if (typeof currentProjectPath === "string" && currentProjectPath) {
        return currentProjectPath.split(/[\\/]/).pop().replace(/\.msp\.json$/i, "").replace(/\.json$/i, "");
      }
    } catch (_) {}
    return "mosaico";
  }

  /**
   * Il foglio intero a 300 DPI, su bianco, come pixel RGBA. Come exportFullCanvasPNG di renderer.js:
   * sfondo vuoto durante il disegno (se non c'è un'immagine di sfondo) e bianco messo dopo. Il bianco
   * dopo si mette SEMPRE: per la stampa la trasparenza non esiste, è la carta.
   */
  function renderSheet() {
    const c = window.canvas;
    if (!c) throw new Error("canvas");
    if (typeof window.reorderCanvasLayers === "function") window.reorderCanvasLayers();
    const CW = c.getWidth(), CH = c.getHeight();
    const P = sheetPx();
    const mult = P.w / CW;
    const saved = c.backgroundColor;
    const hasUserBg = typeof window.hasUserBackgroundImage === "function" ? !!window.hasUserBackgroundImage() : false;
    if (!hasUserBg) c.backgroundColor = "";
    let el;
    try {
      el = c.toCanvasElement(mult, { left: 0, top: 0, width: CW, height: CH });
    } finally {
      c.backgroundColor = saved;
      c.requestRenderAll();
    }
    const out = document.createElement("canvas");
    out.width = P.w;
    out.height = P.h;
    const ctx = out.getContext("2d", { willReadFrequently: true });
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, P.w, P.h);
    // toCanvasElement taglia i decimali della misura: al più un pixel di differenza, si stende sul foglio
    if (el.width === P.w && el.height === P.h) ctx.drawImage(el, 0, 0);
    else ctx.drawImage(el, 0, 0, P.w, P.h);
    const data = ctx.getImageData(0, 0, P.w, P.h).data;
    el.width = el.height = 0; // libera la memoria della tela grande subito
    return { width: P.w, height: P.h, widthMm: P.mm.w, heightMm: P.mm.h, pixels: new Uint8Array(data.buffer, data.byteOffset, data.byteLength) };
  }

  // ───────────────────────── la finestra ─────────────────────────
  function readFormat() {
    const r = document.querySelector('#printExportModal input[name="printFormat"]:checked');
    return r && FORMATS.includes(r.value) ? r.value : "x4";
  }

  function savedFormat() {
    try {
      const v = window.localStorage && window.localStorage.getItem(KEY_FORMAT);
      if (FORMATS.includes(v)) return v;
    } catch (_) {}
    return "x4";
  }

  function rememberFormat(v) {
    try {
      if (window.localStorage) window.localStorage.setItem(KEY_FORMAT, v);
    } catch (_) {}
  }

  function setStatus(msg, warn) {
    const el = $("printExportStatus");
    if (!el) return;
    el.textContent = msg || "";
    el.style.color = warn ? "#ffb347" : "";
  }

  function fillProfiles() {
    const sel = $("printExportProfile");
    if (!sel) return;
    sel.textContent = "";
    for (const g of GROUPS) {
      const items = S.profiles
        .filter((p) => p.source === g)
        .sort((a, b) => (b.id === S.defaultId) - (a.id === S.defaultId) || String(a.name).localeCompare(String(b.name)));
      if (!items.length) continue;
      const og = document.createElement("optgroup");
      og.label = T("softProof.group." + g, null, GROUP_FALLBACK[g]);
      for (const p of items) {
        const o = document.createElement("option");
        o.value = p.id;
        o.textContent = p.name;
        og.appendChild(o);
      }
      sel.appendChild(og);
    }
    if (S.settings) sel.value = S.settings.profileId;
  }

  // Cosa conta per ogni formato: il profilo non serve al PNG, la resa conta solo nel PDF/X-1a.
  function syncFormat() {
    const f = readFormat();
    const prof = $("printExportProfile"), intent = $("printExportIntent");
    if (prof) prof.disabled = f === "png" || S.busy;
    if (intent) intent.disabled = f !== "x1a" || S.busy;
    const note = $("printExportNote");
    if (note) {
      note.textContent =
        f === "x4"
          ? T("printExport.note.x4", null, "Il profilo scelto va dentro il PDF: la copisteria converte in CMYK con quello. La resa la sceglie la copisteria.")
          : f === "x1a"
            ? T("printExport.note.x1a", null, "Mosaica converte in CMYK col profilo e la resa scelti: la copisteria stampa senza altre conversioni.")
            : T("printExport.note.png", null, "Il PNG non ha profilo di stampa: i colori restano RGB, col profilo compatibile Adobe RGB dentro.");
    }
  }

  function syncSheet() {
    const el = $("printExportSheet");
    if (!el) return;
    const P = sheetPx();
    const orient = T(P.mm.w > P.mm.h ? "canvas.orient.horizontal" : "canvas.orient.vertical", null, P.mm.w > P.mm.h ? "orizzontale" : "verticale");
    const s = T(
      "printExport.modal.sheet",
      { orient, w: Math.round(P.mm.w), h: Math.round(P.mm.h), pw: P.w, ph: P.h },
      "Foglio {orient} · {w} × {h} mm · {pw} × {ph} pixel a 300 DPI"
    );
    el.textContent = s.charAt(0).toUpperCase() + s.slice(1); // «portrait sheet…» → «Portrait sheet…»
  }

  function setBusy(v) {
    S.busy = !!v;
    const ok = $("printExportConfirmBtn");
    if (ok) ok.disabled = S.busy || !api();
    document.querySelectorAll('#printExportModal input[name="printFormat"]').forEach((r) => (r.disabled = S.busy));
    syncFormat();
  }

  async function open() {
    const modal = $("printExportModal");
    if (!modal) return;
    const f = savedFormat();
    const r = document.querySelector('#printExportModal input[name="printFormat"][value="' + f + '"]');
    if (r) r.checked = true;
    syncSheet();
    setStatus("");
    modal.style.display = "flex";
    // Il fuoco va sul modale (tabindex="-1"): Backspace/Canc non arrivano alle tessere dietro (trappola 193).
    try {
      modal.focus({ preventScroll: true });
    } catch (_) {}
    const a = api();
    if (!a) {
      setBusy(false);
      setStatus(T("printExport.status.noEngine", null, "❌ Riavvia Mosaica: il motore colore non è attivo"), true);
      return;
    }
    setBusy(false);
    try {
      const [s, l] = await Promise.all([a.getSettings(), a.listProfiles(false)]);
      if (s && s.ok) S.settings = s.settings;
      S.profiles = l && l.ok ? l.profiles.filter((p) => p.kind === "cmyk") : [];
      S.defaultId = l && l.ok ? l.defaultId : null;
    } catch (e) {
      console.warn("[printColor] profili:", e);
    }
    fillProfiles();
    const it = $("printExportIntent");
    if (it && S.settings) it.value = S.settings.intent;
    syncFormat();
  }

  function close() {
    const modal = $("printExportModal");
    if (modal) modal.style.display = "none";
  }

  // Profilo e resa sono quelli della prova di stampa: si cambiano DA LEI se c'è (così il velo acceso si
  // rifà subito), altrimenti dritti nelle preferenze del motore colore.
  async function changeSetting(patch) {
    try {
      if (window.softProof && typeof window.softProof.change === "function") await window.softProof.change(patch);
      else {
        const r = await api().setSettings(patch);
        if (r && r.ok) S.settings = r.settings;
      }
      const s = await api().getSettings();
      if (s && s.ok) S.settings = s.settings;
    } catch (e) {
      console.warn("[printColor] preferenze:", e);
    }
  }

  async function confirm() {
    const a = api();
    if (!a || S.busy) return;
    const format = readFormat();
    rememberFormat(format);
    setBusy(true);
    setStatus(T("printExport.status.render", null, "⏳ Preparo il foglio a 300 DPI…"));
    // un fotogramma per far vedere la scritta prima del lavoro pesante
    await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 30)));
    let img;
    try {
      img = renderSheet();
    } catch (e) {
      console.error("[printColor] foglio:", e);
      setBusy(false);
      setStatus("");
      return toast(T("printExport.toast.error", { msg: (e && e.message) || e }, "❌ Esportazione per la stampa: {msg}"), { duration: 6000 });
    }
    setStatus(T("printExport.status.convert", null, "⏳ Converto i colori e scrivo il file…"));
    const sel = $("printExportProfile");
    const it = $("printExportIntent");
    let r;
    try {
      r = await a.exportPrint({
        format,
        width: img.width,
        height: img.height,
        widthMm: img.widthMm,
        heightMm: img.heightMm,
        pixels: img.pixels,
        profileId: (sel && sel.value) || (S.settings && S.settings.profileId) || undefined,
        intent: (it && it.value) || (S.settings && S.settings.intent) || "relativo",
        title: baseName(),
        baseName: baseName(),
        testi: { title: T("printExport.dialog.title", null, "Esporta per la stampa") }
      });
    } catch (e) {
      r = { ok: false, error: (e && e.message) || String(e) };
    }
    img = null;
    setBusy(false);
    if (r && r.canceled) {
      setStatus("");
      return;
    }
    if (!r || !r.ok) {
      setStatus("");
      const msg =
        r && r.code === "iccV4"
          ? T("printExport.toast.iccV4", null, "❌ Il PDF/X-1a vuole un profilo ICC versione 2, e questo è un v4: usa il PDF/X-4 o un altro profilo")
          : T("printExport.toast.error", { msg: (r && r.error) || "?" }, "❌ Esportazione per la stampa: {msg}");
      return toast(msg, { duration: 7000 });
    }
    close();
    let msg = T("printExport.toast.done", { name: r.name, mb: (r.bytes / 1048576).toFixed(1) }, "✅ Pronto per la stampa: {name} ({mb} MB)");
    if (r.condition === "Custom") msg += " · " + T("printExport.toast.custom", null, "⚠ profilo senza nome di registro: nel PDF la condizione di stampa è «Custom»");
    toast(msg, { duration: 6000 });
  }

  function bindUI() {
    const btn = $("exportPrintBtn");
    if (btn) btn.addEventListener("click", open);
    const modal = $("printExportModal");
    if (!modal) return;
    modal.addEventListener("click", (e) => {
      if (e.target === modal && !S.busy) close();
    });
    ["printExportCloseBtn", "printExportCancelBtn"].forEach((id) => {
      const b = $(id);
      if (b) b.addEventListener("click", () => {
        if (!S.busy) close();
      });
    });
    const ok = $("printExportConfirmBtn");
    if (ok) ok.addEventListener("click", confirm);
    document.querySelectorAll('#printExportModal input[name="printFormat"]').forEach((r) =>
      r.addEventListener("change", () => {
        rememberFormat(readFormat());
        syncFormat();
      })
    );
    const sel = $("printExportProfile");
    if (sel) sel.addEventListener("change", () => changeSetting({ profileId: sel.value }));
    const it = $("printExportIntent");
    if (it) it.addEventListener("change", () => changeSetting({ intent: it.value }));
    // ⚠ Trappola 193: i tasti nati dentro il modale non arrivano al document (Canc cancellerebbe le
    // tessere selezionate dietro), tranne ESC, che renderer.js usa per chiudere ogni …Modal.
    modal.addEventListener("keydown", (e) => {
      if (e.key === "Escape") return;
      e.stopPropagation();
    });
  }

  window.printColor = {
    open,
    close,
    renderSheet,
    sheetPx,
    isBusy: () => S.busy
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", bindUI);
  else bindUI();
})();
