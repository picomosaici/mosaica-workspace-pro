// ════════════════════════════════════════════════════════════════════════════
//  csb-image.js  —  FASE 2B (modulo immagine di riferimento)
//  ────────────────────────────────────────────────────────────────────────────
//  Aggiunge al builder di forme non standard (customShapeBuilder.js) la
//  possibilità di caricare un'IMMAGINE DI RIFERIMENTO sul foglio, da ricalcare.
//
//  Caratteristiche:
//   • Caricamento da file locale (PNG/JPG/…); l'immagine viene posata centrata
//     sul foglio, scalata per entrare comodamente, e poi è LIBERA.
//   • Modalità "Sposta/Scala" (un lucchetto): quando attiva, trascinando il
//     corpo si sposta l'immagine, trascinando gli angoli la si ridimensiona
//     (proporzioni bloccate). In quella modalità il tracciamento dei vertici è
//     sospeso, così non si disegna per sbaglio. Quando è "Bloccata", l'immagine
//     resta come riferimento fisso e si disegna sopra normalmente.
//   • OPACITÀ regolabile.
//   • Pulsante RIMUOVI.
//   • GRIGLIA ADATTIVA: alla luminanza media dell'immagine. Immagine chiara
//     (es. foglio bianco con linee/scritte nere, scala di grigi) → la griglia
//     diventa scura; immagine scura → la griglia diventa chiara. Il core applica
//     i colori veri; qui restituiamo solo il "verso" (dark: true/false).
//
//  Si aggancia tramite window.CSB (definito da customShapeBuilder.js). Se il core
//  non è presente, il modulo non fa nulla. Va incluso DOPO customShapeBuilder.js.
//
//  Compatibilità: Fabric.js non richiesto qui (lavora su canvas 2D del modale).
// ════════════════════════════════════════════════════════════════════════════

(function initCsbImage() {
  if (!window.CSB) {
    console.warn("[csb-image] window.CSB non trovato: includere csb-image.js DOPO customShapeBuilder.js.");
    return;
  }
  const CSB = window.CSB;

  // ── i18n helper (con fallback) ──
  function __cit(key, params, fallback) {
    try {
      if (window.i18n && typeof window.i18n.t === "function") {
        const v = window.i18n.t(key, params);
        if (v === key && fallback != null) return fallback;
        return v;
      }
    } catch (_) {}
    let s = (fallback != null ? String(fallback) : key);
    if (params) {
      s = s.replace(/\{(\w+)\}/g, (m, k) =>
        Object.prototype.hasOwnProperty.call(params, k) ? String(params[k]) : m
      );
    }
    return s;
  }

  // ───────────────────── Costanti ────────────────────────────────────────
  const HANDLE_R_CSS = 6;        // raggio maniglie d'angolo (px schermo/CSS)
  const HANDLE_HIT_CSS = 12;     // tolleranza click sulle maniglie (px schermo)
  const MIN_SIZE_WORLD = 8;      // dimensione minima immagine (world px)
  const LUM_THRESHOLD = 140;     // soglia luminanza 0..255: sopra = "chiara" → griglia scura
  const PLACE_FRACTION = 0.7;    // l'immagine appena caricata occupa ~70% del foglio

  // ───────────────────── Stato del modulo ────────────────────────────────
  const st = {
    img: null,                 // HTMLImageElement
    natW: 0, natH: 0,          // dimensioni naturali (px immagine)
    x: 0, y: 0, w: 0, h: 0,    // rettangolo in coordinate WORLD del foglio
    opacity: 1,
    gridDark: true,            // true = griglia scura (default per foglio chiaro)
    active: false,             // modalità "Sposta/Scala"
    // drag
    drag: null,                // null | 'move' | 'scale'
    anchor: null,              // {x,y} world (angolo opposto, per scale)
    dragDirX: 1, dragDirY: 1,  // verso dell'angolo trascinato rispetto all'anchor
    startWorld: null,          // {x,y} world all'inizio del drag (per move)
    startRect: null            // {x,y,w,h} world all'inizio del drag (per move)
  };

  // Riferimenti UI
  let fileInput = null;
  let loadBtn = null;
  let modeBtn = null;
  let opacityWrap = null;
  let opacityInput = null;
  let removeBtn = null;

  // ───────────────────── Helpers ─────────────────────────────────────────
  function hasImage() { return !!st.img; }

  // I 4 angoli in coordinate WORLD (in senso: tl, tr, br, bl)
  function cornersWorld() {
    return [
      { x: st.x, y: st.y },                 // tl  (0)
      { x: st.x + st.w, y: st.y },          // tr  (1)
      { x: st.x + st.w, y: st.y + st.h },   // br  (2)
      { x: st.x, y: st.y + st.h }           // bl  (3)
    ];
  }

  // Trova l'angolo (0..3) vicino al punto schermo, oppure -1.
  function handleAtScreen(screen) {
    const cs = cornersWorld();
    for (let i = 0; i < 4; i++) {
      const s = CSB.worldToScreen(cs[i].x, cs[i].y);
      if (Math.hypot(s.x - screen.x, s.y - screen.y) <= HANDLE_HIT_CSS) return i;
    }
    return -1;
  }

  function pointInImage(world) {
    return world.x >= st.x && world.x <= st.x + st.w &&
           world.y >= st.y && world.y <= st.y + st.h;
  }

  // ───────────────────── Caricamento immagine ────────────────────────────
  function openFilePicker() { if (fileInput) fileInput.click(); }

  function onFileChosen(e) {
    const file = e.target && e.target.files && e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        st.img = img;
        st.natW = img.naturalWidth || img.width || 1;
        st.natH = img.naturalHeight || img.height || 1;
        placeImageCentered();
        computeLuminance();
        st.active = true;       // entra subito in modalità sposta/scala
        showLoadedControls(true);
        updateModeBtn();
        CSB.requestRenderAndUI();
      };
      img.onerror = () => { console.warn("[csb-image] immagine non caricabile"); };
      img.src = reader.result;
    };
    reader.onerror = () => { console.warn("[csb-image] lettura file fallita"); };
    reader.readAsDataURL(file);
    // consenti di ricaricare lo stesso file una seconda volta
    e.target.value = "";
  }

  // Posiziona l'immagine centrata sul foglio, "contain" al PLACE_FRACTION.
  function placeImageCentered() {
    const paper = CSB.getPaperPx();
    const aspect = st.natW / st.natH;
    let w = paper.w * PLACE_FRACTION;
    let h = w / aspect;
    if (h > paper.h * PLACE_FRACTION) {
      h = paper.h * PLACE_FRACTION;
      w = h * aspect;
    }
    st.w = w; st.h = h;
    st.x = (paper.w - w) / 2;
    st.y = (paper.h - h) / 2;
  }

  // Luminanza media (0..255) campionata su un canvas ridotto. Si valuta come
  // appare sul foglio bianco (sfondo bianco sotto eventuale trasparenza PNG).
  function computeLuminance() {
    try {
      const SAMPLE = 100;
      const aspect = st.natW / st.natH;
      let sw = SAMPLE, sh = Math.max(1, Math.round(SAMPLE / aspect));
      if (sh > SAMPLE) { sh = SAMPLE; sw = Math.max(1, Math.round(SAMPLE * aspect)); }
      const off = document.createElement("canvas");
      off.width = sw; off.height = sh;
      const octx = off.getContext("2d");
      octx.fillStyle = "#ffffff";       // come se fosse appoggiata sul foglio
      octx.fillRect(0, 0, sw, sh);
      octx.drawImage(st.img, 0, 0, sw, sh);
      const data = octx.getImageData(0, 0, sw, sh).data;
      let sum = 0, count = 0;
      for (let i = 0; i < data.length; i += 4) {
        // luminanza percettiva (Rec.709)
        const lum = 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
        sum += lum; count++;
      }
      const avg = count ? sum / count : 255;
      st.gridDark = avg > LUM_THRESHOLD; // chiara → griglia scura
    } catch (_) {
      st.gridDark = true; // fallback prudente
    }
  }

  function removeImage() {
    st.img = null;
    st.active = false;
    st.drag = null;
    showLoadedControls(false);
    CSB.requestRenderAndUI();
  }

  // ───────────────────── Modalità sposta/scala ───────────────────────────
  function toggleMode() {
    if (!hasImage()) return;
    st.active = !st.active;
    st.drag = null;
    updateModeBtn();
    CSB.requestRenderAndUI();
  }

  function updateModeBtn() {
    if (!modeBtn) return;
    if (st.active) {
      modeBtn.textContent = __cit("csb.img.btn.move", null, "🔓 Sposta/Scala");
      modeBtn.style.background = "#3a6ea5";
      modeBtn.title = __cit("csb.img.title.move", null, "Modalità attiva: trascina per spostare, angoli per ridimensionare. Clicca per bloccare.");
    } else {
      modeBtn.textContent = __cit("csb.img.btn.locked", null, "🔒 Bloccata");
      modeBtn.style.background = "#555";
      modeBtn.title = __cit("csb.img.title.locked", null, "Immagine bloccata come riferimento. Clicca per spostarla/ridimensionarla.");
    }
  }

  // ───────────────────── Hook di disegno ─────────────────────────────────
  // Disegno immagine in coordinate WORLD (il core ha già applicato pan+zoom e
  // clippa al foglio).
  function draw(ctx) {
    if (!hasImage()) return;
    ctx.save();
    ctx.globalAlpha = Math.max(0, Math.min(1, st.opacity));
    try { ctx.drawImage(st.img, st.x, st.y, st.w, st.h); } catch (_) {}
    ctx.restore();
  }

  // Overlay (maniglie) in coordinate SCHERMO/CSS. Solo in modalità attiva.
  function drawOverlay(ctx) {
    if (!hasImage() || !st.active) return;
    const cs = cornersWorld().map((c) => CSB.worldToScreen(c.x, c.y));
    // bordo
    ctx.save();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = "#3a9bff";
    ctx.setLineDash([6, 4]);
    ctx.beginPath();
    ctx.moveTo(cs[0].x, cs[0].y);
    for (let i = 1; i < 4; i++) ctx.lineTo(cs[i].x, cs[i].y);
    ctx.closePath();
    ctx.stroke();
    ctx.setLineDash([]);
    // maniglie d'angolo
    for (let i = 0; i < 4; i++) {
      ctx.beginPath();
      ctx.arc(cs[i].x, cs[i].y, HANDLE_R_CSS, 0, Math.PI * 2);
      ctx.fillStyle = "#ffffff";
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = "#3a9bff";
      ctx.stroke();
    }
    ctx.restore();
  }

  // ───────────────────── Hook colore griglia ─────────────────────────────
  function gridColorHint() {
    if (!hasImage()) return null;       // nessuna immagine → core usa il default
    return { dark: st.gridDark };
  }

  // ───────────────────── Hook eventi ─────────────────────────────────────
  function onMouseDown(world, screen) {
    if (!st.active || !hasImage()) return false;
    // 1) maniglia d'angolo → scala (ancorata all'angolo opposto)
    const hi = handleAtScreen(screen);
    if (hi !== -1) {
      const cs = cornersWorld();
      const opp = cs[(hi + 2) % 4];     // angolo opposto = ancora fissa
      const dragged = cs[hi];
      st.drag = "scale";
      st.anchor = { x: opp.x, y: opp.y };
      st.dragDirX = Math.sign(dragged.x - opp.x) || 1;
      st.dragDirY = Math.sign(dragged.y - opp.y) || 1;
      return true;
    }
    // 2) corpo immagine → sposta
    if (pointInImage(world)) {
      st.drag = "move";
      st.startWorld = { x: world.x, y: world.y };
      st.startRect = { x: st.x, y: st.y, w: st.w, h: st.h };
      return true;
    }
    return false;
  }

  function onMouseMove(world) {
    if (!st.active || !hasImage() || !st.drag) return false;
    if (st.drag === "move") {
      const dx = world.x - st.startWorld.x;
      const dy = world.y - st.startWorld.y;
      st.x = st.startRect.x + dx;
      st.y = st.startRect.y + dy;
      return true;
    }
    if (st.drag === "scale") {
      const aspect = st.natW / st.natH;
      let newW = Math.abs(world.x - st.anchor.x);
      let newH = newW / aspect;          // proporzioni bloccate (base sulla larghezza)
      if (newW < MIN_SIZE_WORLD) { newW = MIN_SIZE_WORLD; newH = newW / aspect; }
      const draggedX = st.anchor.x + st.dragDirX * newW;
      const draggedY = st.anchor.y + st.dragDirY * newH;
      st.x = Math.min(st.anchor.x, draggedX);
      st.y = Math.min(st.anchor.y, draggedY);
      st.w = newW;
      st.h = newH;
      return true;
    }
    return false;
  }

  function onMouseUp() {
    if (!st.drag) return false;
    st.drag = null;
    return true;
  }

  function cursorFor(world, screen) {
    if (!st.active || !hasImage()) return "default";
    const hi = handleAtScreen(screen);
    if (hi !== -1) return (hi === 0 || hi === 2) ? "nwse-resize" : "nesw-resize";
    if (pointInImage(world)) return st.drag === "move" ? "grabbing" : "move";
    return "default";
  }

  // ───────────────────── Costruzione UI ──────────────────────────────────
  function onModalBuilt(refs) {
    const host = refs && refs.imageToolsEl;
    const modalEl = refs && refs.modalEl;
    if (!host) return;

    const btnCss = "border:0; border-radius:6px; color:#fff; cursor:pointer; font-size:12px; padding:6px 10px;";

    // separatore visivo
    const sep = document.createElement("span");
    sep.style.cssText = "width:1px; height:18px; background:#3a3a3a; display:inline-block; margin:0 2px;";
    host.appendChild(sep);

    // input file nascosto
    fileInput = document.createElement("input");
    fileInput.type = "file";
    fileInput.accept = "image/*";
    fileInput.style.display = "none";
    fileInput.addEventListener("change", onFileChosen);
    (modalEl || host).appendChild(fileInput);

    // pulsante carica
    loadBtn = document.createElement("button");
    loadBtn.textContent = __cit("csb.img.btn.load", null, "🖼 Immagine");
    loadBtn.title = __cit("csb.img.title.load", null, "Carica un'immagine di riferimento da ricalcare");
    loadBtn.style.cssText = btnCss + "background:#444;";
    loadBtn.addEventListener("click", openFilePicker);
    host.appendChild(loadBtn);

    // toggle modalità
    modeBtn = document.createElement("button");
    modeBtn.style.cssText = btnCss + "background:#555;";
    modeBtn.addEventListener("click", toggleMode);
    host.appendChild(modeBtn);

    // opacità
    opacityWrap = document.createElement("span");
    opacityWrap.style.cssText = "display:flex; align-items:center; gap:6px; color:#bcd;";
    const opLbl = document.createElement("span");
    opLbl.textContent = __cit("csb.img.label.opacity", null, "Opacità img");
    opLbl.style.opacity = "0.8";
    opacityInput = document.createElement("input");
    opacityInput.type = "range";
    opacityInput.min = "10"; opacityInput.max = "100"; opacityInput.value = "100";
    opacityInput.title = __cit("csb.img.title.opacity", null, "Opacità immagine di riferimento");
    opacityInput.style.cssText = "width:100px; cursor:pointer;";
    opacityInput.addEventListener("input", () => {
      st.opacity = Math.max(0, Math.min(1, (parseFloat(opacityInput.value) || 0) / 100));
      CSB.requestRender();
    });
    opacityWrap.appendChild(opLbl);
    opacityWrap.appendChild(opacityInput);
    host.appendChild(opacityWrap);

    // rimuovi
    removeBtn = document.createElement("button");
    removeBtn.textContent = __cit("csb.img.btn.remove", null, "✕ Rimuovi");
    removeBtn.title = __cit("csb.img.title.remove", null, "Rimuovi l'immagine di riferimento");
    removeBtn.style.cssText = btnCss + "background:#7a3030;";
    removeBtn.addEventListener("click", removeImage);
    host.appendChild(removeBtn);

    showLoadedControls(false);
    updateModeBtn();
  }

  function showLoadedControls(show) {
    const d = show ? "" : "none";
    if (modeBtn) modeBtn.style.display = show ? "inline-block" : "none";
    if (opacityWrap) opacityWrap.style.display = show ? "flex" : "none";
    if (removeBtn) removeBtn.style.display = show ? "inline-block" : "none";
    void d;
  }

  function onOpen() {
    // L'immagine persiste tra aperture; riallinea solo i controlli.
    showLoadedControls(hasImage());
    if (hasImage() && opacityInput) opacityInput.value = Math.round(st.opacity * 100);
    updateModeBtn();
  }
  function onClose() {
    // esce dalla modalità di modifica ma mantiene l'immagine caricata
    st.active = false;
    st.drag = null;
  }

  // ───────────────────── Registrazione hook nel core ─────────────────────
  CSB.background = {
    isActive: () => st.active && hasImage(),
    draw,
    drawOverlay,
    gridColorHint,
    onMouseDown,
    onMouseMove,
    onMouseUp,
    cursorFor,
    onModalBuilt,
    onOpen,
    onClose
  };
})();