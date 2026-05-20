// ====================== watercolorStampBrush.js ======================

let watercolorStampCanvas = null;
let watercolorStampLoading = null;
let watercolorTintCache = new Map();

// ─── GPU WORKER ──────
let _gpuWorker = null;
let _gpuWorkerReady = false;
let _watercolorPreviewOverlay = null;
let _watercolorPreviewOverlayCtx = null;
let _activeWatercolorBrush = null;
let _activeStreamingStrokeId = null;
const _strokeFinalizeParamsById = new Map();

const GPU_WORKER_ENABLED = typeof OffscreenCanvas !== "undefined" && typeof Worker !== "undefined";

function _ensureWatercolorPreviewOverlay(fabricCanvas) {
  if (!fabricCanvas?.wrapperEl) return null;

  // ── Invalida l'overlay se le sue dimensioni non corrispondono più al canvas ──
  // Questo succede dopo una rotazione del canvas (portrait ↔ landscape).
  if (_watercolorPreviewOverlay && _watercolorPreviewOverlay.isConnected) {
    const canvasW = fabricCanvas.getWidth();
    const canvasH = fabricCanvas.getHeight();
    if (_watercolorPreviewOverlay.width !== canvasW || _watercolorPreviewOverlay.height !== canvasH) {
      try {
        _watercolorPreviewOverlay.parentNode.removeChild(_watercolorPreviewOverlay);
      } catch (_) {}
      _watercolorPreviewOverlay = null;
      _watercolorPreviewOverlayCtx = null;
    } else {
      return _watercolorPreviewOverlay;
    }
  } else if (!_watercolorPreviewOverlay?.isConnected) {
    // Overlay rimosso dal DOM esternamente (es. reset dopo rotazione)
    _watercolorPreviewOverlay = null;
    _watercolorPreviewOverlayCtx = null;
  }

  const wrapper = fabricCanvas.wrapperEl;

  const overlay = document.createElement("canvas");
  // USA IL BUFFER REALE
  overlay.width = fabricCanvas.lowerCanvasEl ? fabricCanvas.lowerCanvasEl.width : fabricCanvas.getWidth();
  overlay.height = fabricCanvas.lowerCanvasEl ? fabricCanvas.lowerCanvasEl.height : fabricCanvas.getHeight();
  overlay.style.cssText = `
    position: absolute;
    left: 0;
    top: 0;
    pointer-events: none;
    z-index: 999;
  `;

  if (getComputedStyle(wrapper).position === "static") {
    wrapper.style.position = "relative";
  }

  wrapper.appendChild(overlay);

  _watercolorPreviewOverlay = overlay;
  _watercolorPreviewOverlayCtx = overlay.getContext("2d");

  return overlay;
}

function _clearWatercolorPreviewOverlay() {
  if (!_watercolorPreviewOverlayCtx || !_watercolorPreviewOverlay) return;
  _watercolorPreviewOverlayCtx.clearRect(0, 0, _watercolorPreviewOverlay.width, _watercolorPreviewOverlay.height);
}

function _initGpuWorker() {
  if (_gpuWorker || !GPU_WORKER_ENABLED) return;

  try {
    _gpuWorker = new Worker("./gpuWorker.js");
    _gpuWorkerReady = true;

    _gpuWorker.onmessage = ({ data: msg }) => {
      const brush = _activeWatercolorBrush;
      if (!brush) return;

      if (msg.type === "strokePreview") {
        // Solo la preview del tratto attivo va mostrata.
        if (msg.strokeId !== _activeStreamingStrokeId) {
          if (msg.bitmap) msg.bitmap.close();
          return;
        }

        _drawWorkerPreviewBitmap(msg.bitmap, brush.canvas, msg.offsetX || 0, msg.offsetY || 0);
        return;
      }

      if (msg.type === "strokeResult") {
        const watercolorParams = _strokeFinalizeParamsById.get(msg.strokeId);

        if (watercolorParams) {
          _applyWorkerBitmapToFabric(msg.bitmap, brush.canvas, watercolorParams, msg.offsetX || 0, msg.offsetY || 0);
        } else if (msg.bitmap) {
          msg.bitmap.close();
        }

        _strokeFinalizeParamsById.delete(msg.strokeId);

        if (msg.strokeId === _activeStreamingStrokeId) {
          _activeStreamingStrokeId = null;
        }

        return;
      }

      if (msg.type === "strokeError") {
        console.warn("[gpuWorker] Errore rendering:", msg.error);
        _strokeFinalizeParamsById.delete(msg.strokeId);
        if (msg.strokeId === _activeStreamingStrokeId) {
          _activeStreamingStrokeId = null;
        }
      }
    };

    _gpuWorker.onerror = (err) => {
      console.error("[gpuWorker] Worker crash:", err);
      _gpuWorkerReady = false;
      _gpuWorker = null;
      _activeStreamingStrokeId = null;
      _strokeFinalizeParamsById.clear();
    };

    console.log("[gpuWorker] Worker inizializzato correttamente");
  } catch (err) {
    console.warn("[gpuWorker] Impossibile creare il worker — fallback legacy:", err);
    _gpuWorker = null;
    _gpuWorkerReady = false;
  }
}

// ─── Applica l'ImageBitmap del worker al canvas Fabric ───────────────────────
//
// offsetX / offsetY (pixel del canvas fisico) indicano dove posizionare il
// bitmap ritagliato all'interno del canvas Fabric. Ricevuti dal worker insieme
// al bitmap cropped; predefiniti a 0 per retro-compatibilità.
function _applyWorkerBitmapToFabric(bitmap, fabricCanvas, watercolorParams, offsetX, offsetY) {
  if (!bitmap) return;

  const ox = offsetX || 0;
  const oy = offsetY || 0;

  // Elemento canvas temporaneo: Fabric accetta HTMLCanvasElement nel costruttore.
  // Il canvas è ora delle dimensioni del ritaglio, non del canvas intero.
  const tmpCanvas = document.createElement("canvas");
  tmpCanvas.width = bitmap.width;
  tmpCanvas.height = bitmap.height;
  tmpCanvas.getContext("2d").drawImage(bitmap, 0, 0);
  bitmap.close(); // libera GPU memory — il contenuto è ora nel tmpCanvas

  const img = new fabric.Image(tmpCanvas);
  img.set({
    // Posiziona il bitmap ritagliato al suo offset corretto.
    // Questo garantisce che i tratti si sovrappongano e si mescolino nella
    // posizione esatta in cui l'utente ha disegnato.
    left: ox,
    top: oy,
    selectable: false,
    evented: false,
    hasControls: false,
    hasBorders: false,
    lockMovementX: true,
    lockMovementY: true,
    lockScalingX: true,
    lockScalingY: true,
    lockRotation: true,
    __isFreehand: true,
    __isWatercolor: true,
    __watercolorParams: watercolorParams,
    // "overlay" → su zone chiare (carta) si comporta come screen (colori visibili),
    // su zone scure come multiply (accumulo naturale).
    // "multiply" era il vecchio default ma produceva nero per colori diversi sovrapposti.
    globalCompositeOperation: watercolorParams.composite || "overlay",
    opacity: watercolorParams.flow
  });

  img.__addedAt = Date.now();

  fabricCanvas.add(img);

  if (typeof pushState === "function") pushState();

  fabricCanvas.renderAll();

  requestAnimationFrame(() => {
    _clearWatercolorPreviewOverlay();
    fabricCanvas.requestRenderAll();
  });
}

// offsetX / offsetY sono i pixel di offset restituiti dal worker insieme al
// bitmap ritagliato. Permettono di disegnare la preview nella posizione
// corretta sull'overlay, anche se il bitmap è molto più piccolo del canvas.
function _drawWorkerPreviewBitmap(bitmap, fabricCanvas, offsetX, offsetY) {
  if (!bitmap || !fabricCanvas) return;

  const overlay = _ensureWatercolorPreviewOverlay(fabricCanvas);
  if (!overlay) return;

  const ctx = _watercolorPreviewOverlayCtx || overlay.getContext("2d");
  ctx.clearRect(0, 0, overlay.width, overlay.height);
  ctx.drawImage(bitmap, offsetX || 0, offsetY || 0);
  bitmap.close();
}

function _captureCurrentTintedStampData(tintedCanvas) {
  if (!tintedCanvas || typeof tintedCanvas.getContext !== "function") return null;

  const tctx = tintedCanvas.getContext("2d", { willReadFrequently: true });
  const imageData = tctx.getImageData(0, 0, tintedCanvas.width, tintedCanvas.height);

  return {
    buffer: imageData.data.buffer,
    w: tintedCanvas.width,
    h: tintedCanvas.height
  };
}
// ─── Percorso legacy (fallback se il worker non è disponibile) ───────────────
//
// Identico al codice originale con toDataURL.

function _applyContextTopToFabric(fabricCanvas, watercolorParams) {
  const ctx = fabricCanvas.contextTop;
  const dataURL = ctx.canvas.toDataURL("image/png");

  fabric.Image.fromURL(dataURL, (img) => {
    img.set({
      left: 0,
      top: 0,
      selectable: false,
      evented: false,
      hasControls: false,
      hasBorders: false,
      lockMovementX: true,
      lockMovementY: true,
      lockScalingX: true,
      lockScalingY: true,
      lockRotation: true,
      __isFreehand: true,
      __isWatercolor: true,
      __watercolorParams: watercolorParams,
      globalCompositeOperation: watercolorParams.composite || "overlay",
      opacity: watercolorParams.flow
    });

    img.__addedAt = Date.now();

    fabricCanvas.add(img);
    fabricCanvas.clearContext(fabricCanvas.contextTop);

    if (typeof pushState === "function") pushState();

    fabricCanvas.renderAll();
  });
}

// ─── UTILITY (invariate) ─────────────────────────────────────────────────────

function hexToRgb(hex) {
  const clean = (hex || "#000000").replace("#", "");
  const full =
    clean.length === 3
      ? clean
          .split("")
          .map((ch) => ch + ch)
          .join("")
      : clean.padEnd(6, "0").slice(0, 6);

  return {
    r: parseInt(full.slice(0, 2), 16) || 0,
    g: parseInt(full.slice(2, 4), 16) || 0,
    b: parseInt(full.slice(4, 6), 16) || 0
  };
}

function degToRad(deg) {
  return ((deg || 0) * Math.PI) / 180;
}

function normalizeAngleRad(a) {
  const twoPi = Math.PI * 2;
  a = a % twoPi;
  if (a > Math.PI) a -= twoPi;
  if (a < -Math.PI) a += twoPi;
  return a;
}

function smoothAngleRad(prev, next, baseFactor = 0.35) {
  if (prev == null || Number.isNaN(prev)) return next;

  let diff = next - prev;
  // JS `%` returns a negative remainder for negative operands, so the naive
  // `((diff + π) % 2π) - π` formula breaks when diff < -π (e.g. crossing the
  // atan2 ±180° discontinuity).  The portable form below works for all cases:
  //   ((x % m) + m + half) % m - half   with m=2π, half=π
  const TWO_PI = Math.PI * 2;
  diff = (((diff % TWO_PI) + TWO_PI + Math.PI) % TWO_PI) - Math.PI;

  const absDiffDeg = Math.abs(diff) * (180 / Math.PI);

  let factor = baseFactor;
  if (absDiffDeg > 35) factor = 0.92;
  else if (absDiffDeg > 20) factor = 0.78;
  else if (absDiffDeg > 10) factor = 0.55;
  else if (absDiffDeg > 5) factor = 0.42;

  return normalizeAngleRad(prev + diff * factor);
}

function getBrushTipAngleOffset() {
  const brushName =
    typeof currentBrushTip !== "undefined" && currentBrushTip ? String(currentBrushTip) : "watercolor-stamp";

  let baseOffsetRad = 0;
  switch (brushName) {
    case "watercolor_flat_wide":
    case "watercolor-filbert":
      baseOffsetRad = Math.PI / 2;
      break;
    case "watercolor-stamp":
    default:
      baseOffsetRad = 0;
      break;
  }

  // ── ROTAZIONE INIZIALE IMPOSTATA DALL'UTENTE (supporta + e -) ──
  const userDeg =
    typeof window.currentTipInitialRotationDeg === "function"
      ? window.currentTipInitialRotationDeg()
      : typeof currentTipInitialRotationDeg !== "undefined"
        ? currentTipInitialRotationDeg
        : 0;

  return baseOffsetRad + degToRad(userDeg);
}

// ─── CARICAMENTO BRUSH (con createImageBitmap) ───────────────────────────────

async function loadWatercolorStamp(brushName = currentBrushTip) {
  if (watercolorStampCanvas && watercolorStampCanvas.__currentBrush === brushName) {
    return watercolorStampCanvas;
  }

  watercolorStampLoading = new Promise(async (resolve, reject) => {
    try {
      let src = null;

      if (window.brushAPI?.listBrushes) {
        const list = await window.brushAPI.listBrushes();
        const found = list.find((item) => item.filename === brushName || item.filename === `${brushName}.png`);
        if (found?.dataURL) src = found.dataURL;
      }

      if (!src) {
        src = new URL(`./textures/brush/${brushName}.png`, window.location.href).href;
      }

      const img = new Image();
      img.onerror = () => reject(new Error(`Brush texture not found: ${brushName}`));
      img.onload = async () => {
        // createImageBitmap: la texture viene decodificata una sola volta
        // e il risultato risiede in memoria accessibile alla GPU.
        const bitmap = await createImageBitmap(img);
        bitmap.__currentBrush = brushName;
        watercolorStampCanvas = bitmap;
        watercolorTintCache.clear();
        console.log(`[WatercolorStamp] ✅ Caricata (ImageBitmap): ${brushName}`);
        resolve(bitmap);
      };
      img.src = src;
    } catch (err) {
      reject(err);
    }
  });

  return watercolorStampLoading;
}

// Tetto LRU: limite massimo di voci nella cache. Map preserva l'ordine
// di inserimento → re-inserire una key la sposta in coda (most-recently-used),
// la più vecchia (head) viene evictata quando si supera il tetto.
// 64 voci coprono ampiamente l'uso reale (tipicamente 5-15 colori per sessione)
// proteggendo da memory bloat in sessioni di lavoro di ore.
const TINT_CACHE_MAX = 64;

function getTintedStampCanvas(color) {
  const stamp = watercolorStampCanvas;
  if (!stamp) return null;

  const key = `${color}|${stamp.width}x${stamp.height}`;
  if (watercolorTintCache.has(key)) {
    // HIT: porta la voce in coda (LRU bump) e ritorna
    const cached = watercolorTintCache.get(key);
    watercolorTintCache.delete(key);
    watercolorTintCache.set(key, cached);
    return cached;
  }

  // MISS: crea il canvas tintato come prima
  const tinted = document.createElement("canvas");
  tinted.width = stamp.width;
  tinted.height = stamp.height;

  const tctx = tinted.getContext("2d", { willReadFrequently: true });
  tctx.drawImage(stamp, 0, 0);
  tctx.globalCompositeOperation = "source-in";
  tctx.fillStyle = color;
  tctx.fillRect(0, 0, tinted.width, tinted.height);
  tctx.globalCompositeOperation = "source-over";

  watercolorTintCache.set(key, tinted);

  // Evict del più vecchio se sopra il tetto (1 sola eviction per chiamata:
  // il numero di hit/miss è 1, quindi al massimo size = TINT_CACHE_MAX + 1).
  if (watercolorTintCache.size > TINT_CACHE_MAX) {
    const oldestKey = watercolorTintCache.keys().next().value;
    watercolorTintCache.delete(oldestKey);
  }

  return tinted;
}

function _clearActiveWorkerStrokeState(strokeId) {
  if (strokeId != null) {
    _strokeFinalizeParamsById.delete(strokeId);
  }
  if (_activeStreamingStrokeId === strokeId) {
    _activeStreamingStrokeId = null;
  }
}

// ─── CLASSE BRUSH ─────────────────────────────────────────────────────────────
class WatercolorStampBrush extends fabric.PencilBrush {
  constructor(canvas) {
    super(canvas);
    this.name = "watercolor-stamp";
    this._useStreamingWorker = false;
    _activeWatercolorBrush = this;
    this._strokeId = null;
    this._strokeFlushRAF = 0;
    this._strokeStampData = null;
    this._strokeChunkBuffer = [];
    this.lastPoint = null;
    this.downPoint = null;
    this._currentTintedStamp = null;
    this.smoothedAngle = null;
    this.tipAngleOffset = 0;

    this.rotationResponsiveness = 0.35;
    this.smoothedAngle = null;

    this.strokeParams = null;
    this.strokeStarted = false;
    this.hasDrawnAnyStamp = false;

    // Assicura che il worker sia pronto
    _initGpuWorker();
  }

  _getStampRotationForSegment(dx, dy) {
    const rawAngle = Math.atan2(dy, dx);
    this.smoothedAngle = smoothAngleRad(this.smoothedAngle, rawAngle, this.rotationResponsiveness);
    const tinyRotJitter = degToRad((Math.random() - 0.5) * currentRotationJitter * 0.09);
    return this.smoothedAngle + this.tipAngleOffset + tinyRotJitter;
  }

  _getPerpendicularVector(rotation) {
    const perpAngle = rotation + Math.PI / 2;
    return { x: Math.cos(perpAngle), y: Math.sin(perpAngle) };
  }

  _buildStrokeId() {
    return `ws_${Date.now()}_${Math.floor(Math.random() * 1e9)}`;
  }

  _queueStrokeStamp(stamp) {
    this._strokeChunkBuffer.push(stamp);
    this._scheduleStrokeFlush();
  }

  _scheduleStrokeFlush() {
    if (this._strokeFlushRAF || !this._strokeChunkBuffer.length) return;

    this._strokeFlushRAF = requestAnimationFrame(() => {
      this._strokeFlushRAF = 0;
      this._flushStrokeChunk();
    });
  }

  _flushStrokeChunk() {
    if (!_gpuWorkerReady || !_gpuWorker || !this._strokeId) return;
    if (!this._strokeChunkBuffer.length) return;

    const batch = this._strokeChunkBuffer.splice(0, this._strokeChunkBuffer.length);

    _gpuWorker.postMessage({
      type: "strokeChunk",
      strokeId: this._strokeId,
      stamps: batch
    });
  }

  _startStreamingStroke(fabricCanvas) {
    if (!_gpuWorkerReady || !_gpuWorker) return false;
    if (!this._strokeId || !this._strokeStampData) return false;

    _activeStreamingStrokeId = this._strokeId;

    _gpuWorker.postMessage(
      {
        type: "strokeStart",
        strokeId: this._strokeId,
        // DIMENSIONI REALI DEL BUFFER
        width: fabricCanvas.lowerCanvasEl ? fabricCanvas.lowerCanvasEl.width : fabricCanvas.getWidth(),
        height: fabricCanvas.lowerCanvasEl ? fabricCanvas.lowerCanvasEl.height : fabricCanvas.getHeight(),
        stampData: this._strokeStampData
      },
      [this._strokeStampData.buffer]
    );

    return true;
  }

  _cancelStreamingStroke() {
    if (_gpuWorkerReady && _gpuWorker && this._strokeId) {
      _gpuWorker.postMessage({
        type: "cancelStroke",
        strokeId: this._strokeId
      });
    }
  }

  onMouseDown(pointer, e) {
    if (window.isAltPanning) return;

    // Lettura SINCRONA della penna dal PointerEvent corrente, prima
    // che il brush usi qualsiasi parametro derivato dalla pressione/tilt.
    // `e` qui è il secondo argomento di Fabric (options): `e.e` è il
    // PointerEvent originale. In assenza di Wacom o se è in uso il mouse,
    // wacomReadFromEvent imposterà currentPressure=null e i fattori
    // restituiranno 1.0 (zero regressioni).
    if (typeof window.wacomReadFromEvent === "function") {
      window.wacomReadFromEvent(e && e.e);
    }

    this.lastPoint = pointer;
    this.downPoint = pointer;
    this.smoothedAngle = null;
    this.tipAngleOffset = getBrushTipAngleOffset();
    this.rotationResponsiveness = 0.28;
    this.strokeStarted = false;
    this.hasDrawnAnyStamp = false;

    this._strokeId = this._buildStrokeId();
    this._strokeChunkBuffer = [];
    this._strokeStampData = null;

    this.strokeParams = {
      perpOffset: (Math.random() - 0.5) * currentPositionJitter * 1.2
    };

    const strokeColor = isWatercolorMode
      ? watercolorToneColor(currentStrokeColor, jitterToneControl)
      : currentStrokeColor;

    this._currentTintedStamp = getTintedStampCanvas(strokeColor);
    this._strokeStampData = _captureCurrentTintedStampData(this._currentTintedStamp);

    this._useStreamingWorker = this._startStreamingStroke(this.canvas);

    if (!this._useStreamingWorker) {
      this._strokeStampData = null;
      this._strokeId = null;
      const ctx = this.canvas.contextTop;
      ctx.globalCompositeOperation = "source-over";
    }

    // ── NON chiamare super.onMouseDown ────────────────────────────────────────
    // fabric.PencilBrush.onMouseDown inizializza this._points = [pointer]. Poiché
    // onMouseMove qui sotto non chiama mai super.onMouseMove, _points rimane con
    // un solo punto. In onMouseUp, super.onMouseUp -> _finalizeAndAddPath
    // genera con quel singolo punto un fabric.Path con stroke=this.color
    // (default 'rgb(0,0,0)') e strokeWidth=this.width (default 1), e lo
    // aggiunge al canvas: ecco il punto nero permanente al centro del primo
    // timbro. Niente di ciò che PencilBrush fa internamente ci serve (gli stamps
    // disegnano da soli su contextTop), quindi saltiamo entrambe le super-call.
  }

  onMouseMove(pointer, options) {
    if (window.isAltPanning) return;

    // Aggiorna stato Wacom dal PointerEvent corrente PRIMA di leggere
    // i fattori in readWacomFactors(). Così la pressione/tilt usati per
    // ogni timbro lungo il tratto sono esattamente quelli del frame.
    if (typeof window.wacomReadFromEvent === "function") {
      window.wacomReadFromEvent(options && options.e);
    }

    const p = pointer;
    if (!this.lastPoint || !this.downPoint) {
      this.lastPoint = p;
      this.downPoint = p;
      return;
    }

    const dynamicSegment = Math.max(5, currentWatercolorWidth * currentStampSpacing * 0.92);

    // Helper locale per leggere i fattori Wacom + TILT
    // (sempre 1.0 / 0 se Wacom non attivo: zero regressioni su mouse)
    const readWacomFactors = () => ({
      width: typeof window.wacomGetWidthFactor === "function" ? window.wacomGetWidthFactor() : 1.0,
      flow: typeof window.wacomGetFlowFactor === "function" ? window.wacomGetFlowFactor() : 1.0,
      opacity: typeof window.wacomGetOpacityFactor === "function" ? window.wacomGetOpacityFactor() : 1.0,
      tiltW: typeof window.wacomGetTiltWidthMultiplier === "function" ? window.wacomGetTiltWidthMultiplier() : 1.0,
      tiltRot: typeof window.wacomGetTiltRotationOffset === "function" ? window.wacomGetTiltRotationOffset() : 0
    });

    // ─────────────────────────────────────────────────────────
    // PATH STREAMING: worker attivo
    // ─────────────────────────────────────────────────────────
    if (this._useStreamingWorker && _gpuWorkerReady && _gpuWorker && this._strokeId) {
      if (!this.strokeStarted) {
        const dx0 = p.x - this.downPoint.x;
        const dy0 = p.y - this.downPoint.y;
        const dist0 = Math.hypot(dx0, dy0);

        if (dist0 < dynamicSegment) return;

        this.strokeStarted = true;

        const rotation0 = this._getStampRotationForSegment(dx0, dy0);
        const perp0 = this._getPerpendicularVector(rotation0);
        const basePerpOffset = this.strokeParams?.perpOffset || 0;
        const steps0 = Math.max(1, Math.round(dist0 / dynamicSegment));
        const speedFactor = Math.min(3.2, dist0 / dynamicSegment);

        for (let i = 0; i <= steps0; i++) {
          const progress = i / steps0;
          const x = this.downPoint.x + dx0 * progress;
          const y = this.downPoint.y + dy0 * progress;

          // Modulazione Wacom + TILT letta PER OGNI stamp (varia LIVE durante il tratto)
          const w = readWacomFactors();

          this._queueStrokeStamp({
            x: x + perp0.x * basePerpOffset,
            y: y + perp0.y * basePerpOffset,
            rotation: rotation0 + w.tiltRot,
            baseWidth: currentWatercolorWidth * w.width * w.tiltW,
            flow: currentWatercolorFlow * w.flow * w.opacity,
            layers: Math.max(1, currentWatercolorLayers || 14),
            posJitter: currentPositionJitter,
            rotJitter: currentRotationJitter,
            bleed: currentBleed,
            shadowColor: isWatercolorMode
              ? watercolorToneColor(currentStrokeColor, jitterToneControl)
              : currentStrokeColor,
            speedFactor
          });
        }

        this.hasDrawnAnyStamp = true;
        this.lastPoint = p;
        return;
      }

      // === BLOCCO MOVIMENTO NORMALE ===
      const dx = p.x - this.lastPoint.x;
      const dy = p.y - this.lastPoint.y;
      const dist = Math.hypot(dx, dy);

      if (dist < dynamicSegment) return;

      const steps = Math.max(1, Math.round(dist / dynamicSegment));
      const rotation = this._getStampRotationForSegment(dx, dy);
      const perp = this._getPerpendicularVector(rotation);
      const basePerpOffset = this.strokeParams?.perpOffset || 0;
      const speedFactor = Math.min(3.2, dist / dynamicSegment);

      for (let i = 1; i <= steps; i++) {
        const progress = i / steps;
        const x = this.lastPoint.x + dx * progress;
        const y = this.lastPoint.y + dy * progress;

        // Modulazione Wacom + TILT letta PER OGNI stamp (varia LIVE durante il tratto)
        const w = readWacomFactors();

        this._queueStrokeStamp({
          x: x + perp.x * basePerpOffset,
          y: y + perp.y * basePerpOffset,
          rotation: rotation + w.tiltRot,
          baseWidth: currentWatercolorWidth * w.width * w.tiltW,
          flow: currentWatercolorFlow * w.flow * w.opacity,
          layers: Math.max(1, currentWatercolorLayers || 14),
          posJitter: currentPositionJitter,
          rotJitter: currentRotationJitter,
          bleed: currentBleed,
          shadowColor: isWatercolorMode
            ? watercolorToneColor(currentStrokeColor, jitterToneControl)
            : currentStrokeColor,
          speedFactor
        });
      }

      this.hasDrawnAnyStamp = true;
      this.lastPoint = p;
      return;
    }

    // ─────────────────────────────────────────────────────────
    // FALLBACK LEGACY: worker non disponibile
    // ─────────────────────────────────────────────────────────
    const ctx = this.canvas.contextTop;
    ctx.globalCompositeOperation = "source-over";

    if (!this.strokeStarted) {
      const dx0 = p.x - this.downPoint.x;
      const dy0 = p.y - this.downPoint.y;
      const dist0 = Math.hypot(dx0, dy0);

      if (dist0 < dynamicSegment) return;

      this.strokeStarted = true;

      const rotation0 = this._getStampRotationForSegment(dx0, dy0);
      const perp0 = this._getPerpendicularVector(rotation0);
      const basePerpOffset = this.strokeParams?.perpOffset || 0;
      const steps0 = Math.max(1, Math.round(dist0 / dynamicSegment));

      for (let i = 0; i <= steps0; i++) {
        const progress = i / steps0;
        const x = this.downPoint.x + dx0 * progress;
        const y = this.downPoint.y + dy0 * progress;

        // Modulazione Wacom + TILT anche nel fallback legacy
        const w = readWacomFactors();
        this._stampAt(
          x + perp0.x * basePerpOffset,
          y + perp0.y * basePerpOffset,
          rotation0 + w.tiltRot,
          currentWatercolorWidth * w.width * w.tiltW
        );
      }

      this.hasDrawnAnyStamp = true;
      this.lastPoint = p;
      this.canvas.requestRenderAll();
      return;
    }

    const dx = p.x - this.lastPoint.x;
    const dy = p.y - this.lastPoint.y;
    const dist = Math.hypot(dx, dy);

    if (dist < dynamicSegment) return;

    const steps = Math.max(1, Math.round(dist / dynamicSegment));
    const rotation = this._getStampRotationForSegment(dx, dy);
    const perp = this._getPerpendicularVector(rotation);
    const basePerpOffset = this.strokeParams?.perpOffset || 0;

    for (let i = 1; i <= steps; i++) {
      const progress = i / steps;
      const x = this.lastPoint.x + dx * progress;
      const y = this.lastPoint.y + dy * progress;

      // Modulazione Wacom + TILT anche nel fallback legacy
      const w = readWacomFactors();
      this._stampAt(
        x + perp.x * basePerpOffset,
        y + perp.y * basePerpOffset,
        rotation + w.tiltRot,
        currentWatercolorWidth * w.width * w.tiltW
      );
    }

    this.hasDrawnAnyStamp = true;
    this.lastPoint = p;
    this.canvas.requestRenderAll();
  }

  _stampAt(x, y, rotation, baseWidth) {
    // ── Preview su contextTop (comportamento invariato) ────────────────────
    const ctx = this.canvas.contextTop;
    ctx.globalCompositeOperation = "source-over";

    const stamp = this._currentTintedStamp;
    if (!stamp) return;

    const STAMP_BASE_WIDTH = 240;
    const scale = baseWidth / STAMP_BASE_WIDTH;
    const w = stamp.width * scale;
    const h = stamp.height * scale;
    const perp = this._getPerpendicularVector(rotation);

    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rotation);

    ctx.shadowColor = isWatercolorMode
      ? watercolorToneColor(currentStrokeColor, jitterToneControl)
      : currentStrokeColor;
    ctx.shadowBlur = Math.max(0, currentBleed * 1.55);

    const flow = Math.max(0.05, currentWatercolorFlow);
    const layers = Math.max(1, currentWatercolorLayers || 14);

    for (let l = 0; l < layers; l++) {
      const layerPerpJitter = (Math.random() - 0.5) * (currentPositionJitter * 0.85);
      const layerRotJitter = degToRad((Math.random() - 0.5) * currentRotationJitter * 0.22);

      ctx.save();
      ctx.translate(perp.x * layerPerpJitter, perp.y * layerPerpJitter);
      ctx.rotate(layerRotJitter);
      ctx.globalAlpha = flow * (1 - (l / layers) * 0.85);
      ctx.drawImage(stamp, -w / 2, -h / 2, w, h);
      ctx.restore();
    }

    ctx.shadowBlur = 0;
    ctx.restore();
  }

  onMouseUp(e) {
    if (window.isAltPanning) {
      _clearActiveWorkerStrokeState(this._strokeId);
      this._cancelStreamingStroke();
      this._resetStrokeState();
      // NON chiamare super.onMouseUp — vedi commento in onMouseDown.
      return;
    }

    if (this._strokeFlushRAF) {
      cancelAnimationFrame(this._strokeFlushRAF);
      this._strokeFlushRAF = 0;
    }
    this._flushStrokeChunk();

    if (!this.hasDrawnAnyStamp && this.downPoint) {
      const rotation = this.tipAngleOffset || 0;

      if (this._useStreamingWorker && _gpuWorkerReady && _gpuWorker && this._strokeId) {
        this._queueStrokeStamp({
          x: this.downPoint.x,
          y: this.downPoint.y,
          rotation,
          baseWidth: currentWatercolorWidth,
          flow: currentWatercolorFlow,
          layers: Math.max(1, currentWatercolorLayers || 14),
          posJitter: currentPositionJitter,
          rotJitter: currentRotationJitter,
          bleed: currentBleed,
          shadowColor: isWatercolorMode
            ? watercolorToneColor(currentStrokeColor, jitterToneControl)
            : currentStrokeColor,
          isFirstStamp: true
        });
        this.hasDrawnAnyStamp = true;
        this._flushStrokeChunk();
      } else {
        this._stampAt(this.downPoint.x, this.downPoint.y, rotation, currentWatercolorWidth, {
          isFirstStamp: true
        });
        this.hasDrawnAnyStamp = true;
      }
    }

    const watercolorParams = {
      color: currentStrokeColor,
      width: currentWatercolorWidth,
      flow: currentWatercolorFlow,
      tone: jitterToneControl,
      bleed: currentBleed,
      composite: currentWatercolorComposite
    };

    const fabricCanvas = this.canvas;

    if (_gpuWorkerReady && _gpuWorker && this._strokeId) {
      _strokeFinalizeParamsById.set(this._strokeId, watercolorParams);

      _gpuWorker.postMessage({
        type: "strokeEnd",
        strokeId: this._strokeId
      });

      this._strokeStampData = null;
      this._strokeChunkBuffer = [];
      this._currentTintedStamp = null;
      this.strokeParams = null;
      this.lastPoint = null;
      this.downPoint = null;
      this.smoothedAngle = null;
      this.strokeStarted = false;
      this.hasDrawnAnyStamp = false;
      this._strokeId = null;

      // NON chiamare super.onMouseUp — vedi commento in onMouseDown.
      return;
    }

    _applyContextTopToFabric(fabricCanvas, watercolorParams);
    this._resetStrokeState();
    // NON chiamare super.onMouseUp — vedi commento in onMouseDown.
  }

  // ── Pulizia stato tratto ────────────────────────────────────────────────────
  _resetStrokeState() {
    if (this._strokeFlushRAF) {
      cancelAnimationFrame(this._strokeFlushRAF);
      this._strokeFlushRAF = 0;
    }

    this.strokeParams = null;
    this.lastPoint = null;
    this.downPoint = null;
    this.smoothedAngle = null;
    this._currentTintedStamp = null;
    this.strokeStarted = false;
    this.hasDrawnAnyStamp = false;
    this._strokeChunkBuffer = [];
    this._strokeStampData = null;
    this._strokeId = null;
  }
}

window.WatercolorStampBrush = WatercolorStampBrush;
window.loadWatercolorStamp = loadWatercolorStamp;
