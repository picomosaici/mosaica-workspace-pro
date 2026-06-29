// lassoBrushSelection.js — "Pennello selezione" per Mosaica Workspace Pro
// =====================================================================
// Selezione delle tessere PENNELLANDO sul canvas: si tiene premuto il
// tasto sinistro e si traccia una linea che SEGUE il puntatore esattamente
// come la penna del disegno a mano libera. Tutte le tessere che finiscono
// SOTTO la striscia della linea vengono selezionate. La LARGHEZZA della
// linea (slider, in mm) decide quanto e' larga la striscia, cioe' quante
// tessere si prendono per passata.
//
// Differenze rispetto al lazo a poligono (lassoSelection.js, che resta
// invariato e accessibile dal suo pulsante):
//   • qui NON si chiude un'area: si "dipinge" sopra le tessere;
//   • i tratti si SOMMANO (puoi fare piu' passate) finche' lo strumento
//     resta attivo; tenendo ALT premuto un tratto DESELEZIONA invece di
//     selezionare;
//   • la selezione vera (fabric.ActiveSelection) viene materializzata
//     quando esci dal pennello (altro strumento / ESC annulla / Invio o
//     ri-click sul pulsante = conferma). Durante la pennellata vedi un
//     evidenziatore live sulle tessere gia' prese.
//
// Convenzioni del progetto:
//   • Modulo <script> classico (no ES module, no Web Worker).
//   • Le sole API pubbliche sono esposte su window.* in fondo al file.
//   • Riusa cio' che renderer.js gia' espone: window.canvas, window.mm2px,
//     window.pushState, isWatercolorOrFreehand (globale), flashToast
//     (globale). Compatibile Fabric 5.1.0 → 5.3.0 (solo Canvas2D +
//     fabric.ActiveSelection, niente API rimosse/aggiunte nel mezzo).

(function () {
  "use strict";

  let isBrushMode = false;
  let isBrushDrawing = false;
  let brushPoints = [];        // punti del tratto corrente (coord canvas LOGICHE)
  let hoverPoint = null;       // ultimo punto del puntatore (per il cerchio-anteprima)
  let strokeRemoving = false;  // ALT premuto all'inizio del tratto → deseleziona

  // Insieme (vivo) delle tessere selezionate in questa sessione di pennello.
  let brushSelected = new Set();

  // Cache delle tessere candidate, costruita all'attivazione: gli oggetti NON
  // si muovono mentre il pennello e' attivo (evented=false), quindi i campioni
  // e gli AABB restano validi per tutta la sessione (anche con pan/zoom, che
  // non cambiano le coordinate logiche assolute).
  let tileCache = [];

  // Backup stato canvas (ripristinato al deactivate)
  let prevCanvasSelection = true;
  let prevCanvasDefaultCursor = "default";
  let prevCanvasHoverCursor = "move";

  // ---- Dimensione del pennello (DIAMETRO in mm) -----------------------------
  const BRUSH_DIAMETER_MM_DEFAULT = 12;
  const BRUSH_DIAMETER_MM_MIN = 2;
  const BRUSH_DIAMETER_MM_MAX = 60;

  // Densita' minima dei punti del tratto (px logici): evita di accumularne
  // troppi a puntatore lento.
  const BRUSH_MIN_POINT_DISTANCE = 1.5;

  // Bootstrap sano su window prima del load async dal calibration store.
  if (typeof window.BRUSH_SELECT_DIAMETER_MM !== "number") {
    window.BRUSH_SELECT_DIAMETER_MM = BRUSH_DIAMETER_MM_DEFAULT;
  }

  // ============================================================
  //  Util
  // ============================================================
  function _canvas() {
    return window.canvas || null;
  }

  function _toast(msg) {
    if (typeof window.flashToast === "function") window.flashToast(msg);
  }

  // i18n con fallback (il modulo puo' girare anche prima/senza i18n).
  function _t(key, fallback) {
    try {
      if (window.i18n && typeof window.i18n.t === "function") {
        const v = window.i18n.t(key);
        if (v && v !== key) return v;
      }
    } catch (e) {}
    return fallback;
  }

  function _diameterMM() {
    const v = window.BRUSH_SELECT_DIAMETER_MM;
    return typeof v === "number" && isFinite(v) ? v : BRUSH_DIAMETER_MM_DEFAULT;
  }

  // Diametro/raggio in PX logici del canvas (stessa unita' delle coordinate
  // delle tessere e di getPointer). Cosi' la striscia disegnata e l'area di
  // selezione coincidono ESATTAMENTE, a qualunque zoom.
  function _diameterPx() {
    const mm = _diameterMM();
    return typeof window.mm2px === "function" ? window.mm2px(mm) : mm * 3.7795;
  }
  function _radiusPx() {
    return Math.max(0.5, _diameterPx() / 2);
  }

  // distanza^2 da un punto al segmento AB (tutti in coord logiche)
  function _distSqPointSeg(px, py, ax, ay, bx, by) {
    const vx = bx - ax, vy = by - ay;
    const wx = px - ax, wy = py - ay;
    const c1 = vx * wx + vy * wy;
    if (c1 <= 0) return wx * wx + wy * wy;
    const c2 = vx * vx + vy * vy;
    if (c2 <= c1) {
      const dx = px - bx, dy = py - by;
      return dx * dx + dy * dy;
    }
    const t = c1 / c2;
    const projx = ax + t * vx, projy = ay + t * vy;
    const dx = px - projx, dy = py - projy;
    return dx * dx + dy * dy;
  }

  // Due AABB si sovrappongono?
  function _aabbIntersect(a, b) {
    return !(a.maxX < b.minX || a.minX > b.maxX || a.maxY < b.minY || a.minY > b.maxY);
  }

  // AABB assoluto (coord canvas logiche) di un oggetto Fabric.
  function _objectAabb(obj) {
    try {
      const r = obj.getBoundingRect(true, true);
      return { minX: r.left, minY: r.top, maxX: r.left + r.width, maxY: r.top + r.height };
    } catch (e) {
      return null;
    }
  }

  // Campiona punti rappresentativi della tessera in coord ASSOLUTE: centro,
  // 4 angoli del bbox orientato, 4 punti medi dei lati, + vertici reali per
  // polygon/polyline/triangle (sotto-campionati). Stessa filosofia del lazo a
  // poligono: per i mosaici servono punti dentro/attorno alla forma reale.
  function _sampleObjectPoints(obj) {
    const pts = [];
    try {
      const c = obj.getCenterPoint();
      pts.push({ x: c.x, y: c.y });
    } catch (e) {}

    const ac = obj.aCoords;
    if (ac && ac.tl && ac.tr && ac.bl && ac.br) {
      pts.push({ x: ac.tl.x, y: ac.tl.y });
      pts.push({ x: ac.tr.x, y: ac.tr.y });
      pts.push({ x: ac.br.x, y: ac.br.y });
      pts.push({ x: ac.bl.x, y: ac.bl.y });
      pts.push({ x: (ac.tl.x + ac.tr.x) * 0.5, y: (ac.tl.y + ac.tr.y) * 0.5 });
      pts.push({ x: (ac.tr.x + ac.br.x) * 0.5, y: (ac.tr.y + ac.br.y) * 0.5 });
      pts.push({ x: (ac.br.x + ac.bl.x) * 0.5, y: (ac.br.y + ac.bl.y) * 0.5 });
      pts.push({ x: (ac.bl.x + ac.tl.x) * 0.5, y: (ac.bl.y + ac.tl.y) * 0.5 });
    }

    if (
      (obj.type === "polygon" || obj.type === "polyline" || obj.type === "triangle") &&
      Array.isArray(obj.points) && obj.points.length > 0 &&
      typeof obj.calcTransformMatrix === "function"
    ) {
      try {
        const m = obj.calcTransformMatrix();
        const off = obj.pathOffset || { x: 0, y: 0 };
        const step = Math.max(1, Math.ceil(obj.points.length / 16));
        for (let i = 0; i < obj.points.length; i += step) {
          const p = obj.points[i];
          const lx = p.x - off.x, ly = p.y - off.y;
          const wx = m[0] * lx + m[2] * ly + m[4];
          const wy = m[1] * lx + m[3] * ly + m[5];
          pts.push({ x: wx, y: wy });
        }
      } catch (e) {}
    }
    return pts;
  }

  // E' una tessera "vera" del canvas principale (NO penna/acquerello, NO
  // sfondo, NO oggetti lock-ati dall'utente)? Riusa lo stesso criterio del
  // resto del codice (isWatercolorOrFreehand + __isBackground).
  function _isTile(obj) {
    if (!obj) return false;
    if (obj.__isBackground === true) return false;
    if (typeof window.isWatercolorOrFreehand === "function" && window.isWatercolorOrFreehand(obj)) {
      return false;
    }
    // Rispetta i lock: durante il pennello selectable e' forzato a false, quindi
    // leggiamo il backup pre-pennello.
    const wasSelectable =
      typeof obj.__brushPrevSelectable !== "undefined" ? obj.__brushPrevSelectable : obj.selectable;
    if (wasSelectable === false) return false;
    return true;
  }

  function _buildTileCache() {
    const canvas = _canvas();
    tileCache = [];
    if (!canvas || !canvas.getObjects) return;
    canvas.getObjects().forEach((o) => {
      if (!_isTile(o)) return;
      if (typeof o.setCoords === "function") {
        try { o.setCoords(); } catch (e) {}
      }
      const aabb = _objectAabb(o);
      if (!aabb) return;
      tileCache.push({ obj: o, aabb: aabb, samples: _sampleObjectPoints(o) });
    });
  }

  // ============================================================
  //  Test del segmento → seleziona/deseleziona le tessere sotto
  // ============================================================
  // Una tessera e' "sotto" la striscia se almeno un suo campione cade entro
  // raggio dal segmento AB. Ritorna true se l'insieme e' cambiato.
  function _applySegment(ax, ay, bx, by) {
    const r = _radiusPx();
    const r2 = r * r;
    const seg = {
      minX: Math.min(ax, bx) - r, minY: Math.min(ay, by) - r,
      maxX: Math.max(ax, bx) + r, maxY: Math.max(ay, by) + r
    };
    let changed = false;
    for (let i = 0; i < tileCache.length; i++) {
      const t = tileCache[i];
      const already = brushSelected.has(t.obj);
      // Aggiungendo: salta chi e' gia' dentro. Rimuovendo: salta chi e' gia' fuori.
      if (strokeRemoving ? !already : already) continue;
      if (!_aabbIntersect(t.aabb, seg)) continue;
      let hit = false;
      const s = t.samples;
      for (let j = 0; j < s.length; j++) {
        if (_distSqPointSeg(s[j].x, s[j].y, ax, ay, bx, by) <= r2) { hit = true; break; }
      }
      if (!hit) continue;
      if (strokeRemoving) brushSelected.delete(t.obj);
      else brushSelected.add(t.obj);
      changed = true;
    }
    return changed;
  }

  // ============================================================
  //  Overlay (contextTop): evidenziatore selezione + tratto + cerchio
  // ============================================================
  function _applyWorldTransform(ctx, canvas) {
    const retina = typeof canvas.getRetinaScaling === "function" ? canvas.getRetinaScaling() : 1;
    const vpt = canvas.viewportTransform || [1, 0, 0, 1, 0, 0];
    ctx.setTransform(
      vpt[0] * retina, vpt[1] * retina, vpt[2] * retina,
      vpt[3] * retina, vpt[4] * retina, vpt[5] * retina
    );
  }

  function drawBrushOverlay() {
    const canvas = _canvas();
    if (!canvas) return;
    const ctx = canvas.contextTop;
    if (!ctx) return;
    canvas.clearContext(ctx);
    if (!isBrushMode) return;

    const cssScale = window.view && typeof window.view.scale === "number" ? window.view.scale : 1;
    const k = 1 / Math.max(0.1, cssScale); // per linee a spessore-schermo costante

    ctx.save();
    _applyWorldTransform(ctx, canvas);

    // 1) Evidenziatore delle tessere gia' prese (bbox orientato, traslucido).
    if (brushSelected.size) {
      ctx.fillStyle = "rgba(0, 200, 255, 0.22)";
      ctx.strokeStyle = "rgba(0, 200, 255, 0.95)";
      ctx.lineWidth = 1.4 * k;
      brushSelected.forEach((obj) => {
        const ac = obj.aCoords;
        if (!ac || !ac.tl) return;
        ctx.beginPath();
        ctx.moveTo(ac.tl.x, ac.tl.y);
        ctx.lineTo(ac.tr.x, ac.tr.y);
        ctx.lineTo(ac.br.x, ac.br.y);
        ctx.lineTo(ac.bl.x, ac.bl.y);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      });
    }

    // 2) Striscia del tratto corrente, larga quanto il pennello (round cap).
    const diam = _diameterPx();
    if (isBrushDrawing && brushPoints.length >= 1) {
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.lineWidth = diam;
      ctx.strokeStyle = strokeRemoving
        ? "rgba(255, 90, 90, 0.30)"
        : "rgba(43, 108, 255, 0.30)";
      if (brushPoints.length === 1) {
        // tratto-punto (tap): un pallino del diametro
        const p = brushPoints[0];
        ctx.beginPath();
        ctx.arc(p.x, p.y, diam / 2, 0, Math.PI * 2);
        ctx.fillStyle = ctx.strokeStyle;
        ctx.fill();
      } else {
        ctx.beginPath();
        ctx.moveTo(brushPoints[0].x, brushPoints[0].y);
        for (let i = 1; i < brushPoints.length; i++) ctx.lineTo(brushPoints[i].x, brushPoints[i].y);
        ctx.stroke();
      }
    }

    // 3) Cerchio-anteprima della dimensione del pennello attorno al puntatore.
    const hp = isBrushDrawing && brushPoints.length ? brushPoints[brushPoints.length - 1] : hoverPoint;
    if (hp) {
      ctx.beginPath();
      ctx.arc(hp.x, hp.y, diam / 2, 0, Math.PI * 2);
      ctx.lineWidth = 1.2 * k;
      ctx.strokeStyle = strokeRemoving ? "rgba(255,90,90,0.95)" : "rgba(255,255,255,0.9)";
      ctx.setLineDash([5 * k, 4 * k]);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    ctx.restore();
  }

  function clearBrushOverlay() {
    const canvas = _canvas();
    if (!canvas) return;
    const ctx = canvas.contextTop;
    if (ctx) canvas.clearContext(ctx);
  }

  // ============================================================
  //  Event handlers
  // ============================================================
  function onBrushDown(opt) {
    const canvas = _canvas();
    if (!canvas || !isBrushMode) return;
    if (canvas.isDrawingMode) return;
    const e = opt.e;
    if (e && typeof e.button === "number" && e.button !== 0) return; // solo sinistro

    isBrushDrawing = true;
    // Deseleziona se si tiene premuto CTRL (o CMD su Mac). NON usiamo ALT perché
    // ALT è riservato al pan del canvas in tutta Mosaica: tenuto premuto, il pan
    // intercetta il mousedown in fase capture e questo handler non scatterebbe
    // nemmeno. Con CTRL il mousedown arriva fin qui e il deseleziona funziona.
    strokeRemoving = !!(e && (e.ctrlKey || e.metaKey));
    const p = canvas.getPointer(e);
    brushPoints = [{ x: p.x, y: p.y }];
    hoverPoint = { x: p.x, y: p.y };

    // tap iniziale: tratta il punto come dot (seleziona subito sotto il pennello)
    _applySegment(p.x, p.y, p.x, p.y);
    drawBrushOverlay();
  }

  function onBrushMove(opt) {
    const canvas = _canvas();
    if (!canvas || !isBrushMode) return;
    const e = opt.e;
    const p = canvas.getPointer(e);
    hoverPoint = { x: p.x, y: p.y };

    if (!isBrushDrawing) {
      drawBrushOverlay(); // solo cerchio-anteprima che segue il puntatore
      return;
    }

    const last = brushPoints[brushPoints.length - 1];
    if (last) {
      const dx = p.x - last.x, dy = p.y - last.y;
      if (dx * dx + dy * dy < BRUSH_MIN_POINT_DISTANCE * BRUSH_MIN_POINT_DISTANCE) {
        drawBrushOverlay();
        return;
      }
      _applySegment(last.x, last.y, p.x, p.y);
    }
    brushPoints.push({ x: p.x, y: p.y });
    drawBrushOverlay();
  }

  function onBrushUp() {
    if (!isBrushMode) return;
    if (!isBrushDrawing) return;
    isBrushDrawing = false;
    brushPoints = [];
    drawBrushOverlay();

    const n = brushSelected.size;
    if (n > 0) {
      _toast(
        _t("toast.brushSelect.count", "🖌️ " + n + " tessere — esci/Invio per confermare")
          .replace("{count}", n)
      );
    }
  }

  // Riapplica l'overlay dopo ogni render di Fabric (safety net come nel lazo).
  function onAfterRenderRedraw() {
    if (isBrushMode) drawBrushOverlay();
  }

  // ============================================================
  //  Attivazione / disattivazione
  // ============================================================
  function activateBrush() {
    const canvas = _canvas();
    if (!canvas) return;
    if (isBrushMode) return;

    // 1) Spegni gli altri strumenti modali (lazo a poligono, penna, gomma,
    //    acquerello) per non restare in stato ibrido.
    try {
      if (typeof window.deactivateLasso === "function") window.deactivateLasso();
      const wb = document.getElementById("watercolorBtn");
      const eb = document.getElementById("eraserBtn");
      const fb = document.getElementById("freehandBtn");
      if (wb && wb.classList.contains("active")) wb.click();
      if (eb && eb.classList.contains("active")) eb.click();
      if (fb && fb.classList.contains("active")) fb.click();
    } catch (err) {}

    // 2) Backup stato canvas
    prevCanvasSelection = canvas.selection;
    prevCanvasDefaultCursor = canvas.defaultCursor;
    prevCanvasHoverCursor = canvas.hoverCursor;

    // 3) Disabilita selezione nativa e interazione oggetti durante la pennellata
    canvas.selection = false;
    canvas.defaultCursor = "crosshair";
    canvas.hoverCursor = "crosshair";
    if (canvas.getObjects) {
      canvas.getObjects().forEach((o) => {
        if (!o) return;
        o.__brushPrevSelectable = o.selectable;
        o.__brushPrevEvented = o.evented;
        o.selectable = false;
        o.evented = false;
      });
    }
    if (canvas.getActiveObject && canvas.getActiveObject()) canvas.discardActiveObject();

    // 4) Stato pennello pulito + cache tessere
    brushSelected = new Set();
    brushPoints = [];
    hoverPoint = null;
    isBrushDrawing = false;
    _buildTileCache();

    // 5) Handler
    canvas.on("mouse:down", onBrushDown);
    canvas.on("mouse:move", onBrushMove);
    canvas.on("mouse:up", onBrushUp);
    canvas.on("after:render", onAfterRenderRedraw);

    isBrushMode = true;

    // 6) UI feedback
    const btn = document.getElementById("lassoBrushBtn");
    if (btn) btn.classList.add("active");
    const selectBtn = document.getElementById("selectToolBtn");
    if (selectBtn) selectBtn.classList.remove("active");

    canvas.requestRenderAll();
    _toast(_t("toast.brushSelect.on", "🖌️ Pennello selezione attivo — dipingi sulle tessere (ALT = deseleziona)"));
  }

  // commit=true → materializza la selezione (ActiveSelection); false → annulla.
  function deactivateBrush(commit) {
    const canvas = _canvas();
    if (!canvas) return;
    if (!isBrushMode) return;

    // 1) Rimuovi handler
    canvas.off("mouse:down", onBrushDown);
    canvas.off("mouse:move", onBrushMove);
    canvas.off("mouse:up", onBrushUp);
    canvas.off("after:render", onAfterRenderRedraw);

    // 2) Ripristina selectable/evented rispettando i lock pre-pennello
    if (canvas.getObjects) {
      canvas.getObjects().forEach((o) => {
        if (!o) return;
        if (typeof o.__brushPrevSelectable !== "undefined") {
          o.selectable = o.__brushPrevSelectable;
          delete o.__brushPrevSelectable;
        } else {
          o.selectable = true;
        }
        if (typeof o.__brushPrevEvented !== "undefined") {
          o.evented = o.__brushPrevEvented;
          delete o.__brushPrevEvented;
        } else {
          o.evented = true;
        }
      });
    }

    // 3) Ripristina stato canvas
    canvas.selection = prevCanvasSelection;
    canvas.defaultCursor = prevCanvasDefaultCursor;
    canvas.hoverCursor = prevCanvasHoverCursor;

    // 4) Materializza (o scarta) la selezione PRIMA di azzerare lo stato.
    const picked = commit ? Array.from(brushSelected).filter((o) => o && o.canvas === canvas) : [];

    // 5) Reset stato modulo
    isBrushMode = false;
    isBrushDrawing = false;
    brushPoints = [];
    hoverPoint = null;
    brushSelected = new Set();
    tileCache = [];
    clearBrushOverlay();

    // 6) Applica la selezione nativa
    if (picked.length === 1) {
      canvas.setActiveObject(picked[0]);
    } else if (picked.length > 1) {
      try {
        const sel = new fabric.ActiveSelection(picked, { canvas: canvas });
        canvas.setActiveObject(sel);
      } catch (e) {
        canvas.setActiveObject(picked[0]);
      }
    }
    canvas.requestRenderAll();

    // 7) UI feedback
    const btn = document.getElementById("lassoBrushBtn");
    if (btn) btn.classList.remove("active");
    try {
      const fb = document.getElementById("freehandBtn");
      const eb = document.getElementById("eraserBtn");
      const wb = document.getElementById("watercolorBtn");
      const lb = document.getElementById("lassoSelectBtn");
      const anyOn =
        (fb && fb.classList.contains("active")) ||
        (eb && eb.classList.contains("active")) ||
        (wb && wb.classList.contains("active")) ||
        (lb && lb.classList.contains("active"));
      const selectBtn = document.getElementById("selectToolBtn");
      if (selectBtn && !anyOn) selectBtn.classList.add("active");
    } catch (err) {}

    if (commit && picked.length) {
      _toast(
        _t("toast.brushSelect.committed", "🖌️ " + picked.length + " tessere selezionate")
          .replace("{count}", picked.length)
      );
    }
  }

  function toggleBrush() {
    if (isBrushMode) deactivateBrush(true);
    else activateBrush();
  }

  // ============================================================
  //  Dimensione pennello: persistenza + popover
  // ============================================================
  function getBrushDiameter() {
    return _diameterMM();
  }

  function setBrushDiameter(value, opts) {
    let v = Math.max(BRUSH_DIAMETER_MM_MIN, Math.min(BRUSH_DIAMETER_MM_MAX, Number(value)));
    if (!isFinite(v)) v = BRUSH_DIAMETER_MM_DEFAULT;
    window.BRUSH_SELECT_DIAMETER_MM = v;
    if (!opts || opts.persist !== false) _saveBrushDiameter(v);
    _refreshBrushSettingsUI(v);
    if (isBrushMode) drawBrushOverlay(); // aggiorna subito il cerchio-anteprima
    return v;
  }

  async function _loadBrushDiameter() {
    if (!window.calibrationAPI || typeof window.calibrationAPI.load !== "function") return;
    try {
      const data = await window.calibrationAPI.load();
      const v = data && data.brushSelectionDiameterMM;
      if (typeof v === "number" && v >= BRUSH_DIAMETER_MM_MIN && v <= BRUSH_DIAMETER_MM_MAX) {
        window.BRUSH_SELECT_DIAMETER_MM = v;
        _refreshBrushSettingsUI(v);
      }
    } catch (err) {
      console.warn("[lassoBrushSelection] load diametro fallito:", err);
    }
  }

  async function _saveBrushDiameter(value) {
    if (!window.calibrationAPI || typeof window.calibrationAPI.save !== "function") return;
    let payload = {};
    if (typeof window.calibrationAPI.load === "function") {
      try { payload = (await window.calibrationAPI.load()) || {}; } catch (e) { payload = {}; }
    }
    payload.brushSelectionDiameterMM = value;
    try {
      await window.calibrationAPI.save(payload);
    } catch (err) {
      console.warn("[lassoBrushSelection] save diametro fallito:", err);
    }
  }

  function _refreshBrushSettingsUI(value) {
    const slider = document.getElementById("brushDiameterSlider");
    const display = document.getElementById("brushDiameterValue");
    if (slider && Math.abs(parseFloat(slider.value) - value) > 1e-6) slider.value = String(value);
    if (display) display.textContent = value.toFixed(1) + " mm";
  }

  function _positionPopoverNear(btn, pop) {
    if (!btn || !pop) return;
    const r = btn.getBoundingClientRect();
    pop.style.left = Math.round(r.right + 8) + "px";
    pop.style.top = Math.round(r.top) + "px";
    pop.style.visibility = "hidden";
    pop.style.display = "block";
    const pr = pop.getBoundingClientRect();
    if (pr.right > window.innerWidth - 8) {
      pop.style.left = Math.max(8, r.left - pr.width - 8) + "px";
    }
    if (pr.bottom > window.innerHeight - 8) {
      pop.style.top = Math.max(8, window.innerHeight - pr.height - 8) + "px";
    }
    pop.style.visibility = "visible";
  }

  function _openBrushSettings() {
    const pop = document.getElementById("brushSettingsPopover");
    const btn = document.getElementById("lassoBrushBtn");
    if (!pop || !btn) return;
    _refreshBrushSettingsUI(getBrushDiameter());
    _positionPopoverNear(btn, pop);
    pop.setAttribute("aria-hidden", "false");
  }

  function _closeBrushSettings() {
    const pop = document.getElementById("brushSettingsPopover");
    if (!pop) return;
    pop.style.display = "none";
    pop.setAttribute("aria-hidden", "true");
  }

  function _wireBrushSettingsUI() {
    const btn = document.getElementById("lassoBrushBtn");
    const pop = document.getElementById("brushSettingsPopover");
    if (!btn || !pop) return;

    btn.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      e.stopPropagation();
      _openBrushSettings();
    });

    const slider = pop.querySelector("#brushDiameterSlider");
    const closeBtn = pop.querySelector("#brushSettingsClose");
    const resetBtn = pop.querySelector("#brushSettingsReset");

    if (slider) {
      slider.addEventListener("input", () => setBrushDiameter(slider.value, { persist: false }));
      slider.addEventListener("change", () => setBrushDiameter(slider.value, { persist: true }));
      ["mousedown", "pointerdown"].forEach((ev) => slider.addEventListener(ev, (e) => e.stopPropagation()));
    }
    if (resetBtn) {
      resetBtn.addEventListener("click", () => setBrushDiameter(BRUSH_DIAMETER_MM_DEFAULT, { persist: true }));
    }
    if (closeBtn) closeBtn.addEventListener("click", _closeBrushSettings);

    document.addEventListener("mousedown", (e) => {
      if (pop.getAttribute("aria-hidden") === "true") return;
      if (pop.contains(e.target)) return;
      if (e.target === btn || btn.contains(e.target)) return;
      _closeBrushSettings();
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && pop.getAttribute("aria-hidden") === "false") _closeBrushSettings();
    });
  }

  // ================  Init ===========================================
  function initLassoBrushSelection() {
    const btn = document.getElementById("lassoBrushBtn");
    if (!btn) {
      console.warn("[lassoBrushSelection] #lassoBrushBtn non trovato nel DOM");
      return;
    }
    btn.addEventListener("click", () => toggleBrush());

    // Se l'utente passa ad un altro strumento mentre il pennello e' attivo,
    // CONFERMA la selezione e disattiva (cosi' puo' subito colorare/applicare
    // texture/cancellare le tessere appena dipinte).
    ["selectToolBtn", "addShapeBtn", "customShapeBtn", "scene3DBtn", "lassoSelectBtn",
     "freehandBtn", "eraserBtn", "watercolorBtn"].forEach((id) => {
      const b = document.getElementById(id);
      if (!b) return;
      b.addEventListener("click", () => {
        if (isBrushMode) deactivateBrush(true);
      });
    });

    // Tastiera: ESC annulla, Invio conferma. In fase di CAPTURE così precede
    // l'handler globale che su ESC esce dal fullscreen (lo consumiamo SOLO se
    // il pennello è attivo; altrimenti lasciamo passare tutto invariato).
    document.addEventListener(
      "keydown",
      (e) => {
        if (!isBrushMode) return;
        if (e.key !== "Escape" && e.key !== "Enter") return;

        // Se il popover dimensione è aperto, lascia che ESC lo chiuda prima.
        const pop = document.getElementById("brushSettingsPopover");
        if (e.key === "Escape" && pop && pop.getAttribute("aria-hidden") === "false") return;

        // Non rubare Invio mentre si scrive in un campo.
        const ae = document.activeElement;
        const tag = ae && ae.tagName ? ae.tagName.toUpperCase() : "";
        if (e.key === "Enter" && (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT")) return;

        e.preventDefault();
        e.stopPropagation();
        if (typeof e.stopImmediatePropagation === "function") e.stopImmediatePropagation();
        deactivateBrush(e.key === "Enter");
      },
      true
    );

    _wireBrushSettingsUI();
    _loadBrushDiameter();

    console.log("[lassoBrushSelection] inizializzato");
  }

  // ============================================================
  //  Esposizioni globali
  // ============================================================
  window.initLassoBrushSelection = initLassoBrushSelection;
  window.activateBrushSelection = activateBrush;
  window.deactivateBrushSelection = function () { deactivateBrush(true); };
  window.toggleBrushSelection = toggleBrush;
  window.isBrushSelectionMode = () => isBrushMode;
  window.setBrushSelectionDiameter = setBrushDiameter;
  window.getBrushSelectionDiameter = getBrushDiameter;
})();
