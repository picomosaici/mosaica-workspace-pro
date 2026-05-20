// ====================== gpuWorker.js (BOUNDING-BOX CROP + OTTIMIZZAZIONE DENSITÀ 2026) ======================
let offscreenCanvas = null;
let offscreenCtx = null;
let stampBitmap = null;
let currentStrokeId = null;
let lastPreviewTime = 0;
const PREVIEW_THROTTLE_MS = 16; // ~60 fps

// ── Bounding-box del tratto corrente (in pixel del canvas fisico) ─────────────
// Tiene traccia dell'area effettivamente dipinta per poter ritagliare il bitmap
// finale (e le preview) invece di restituire sempre il canvas intero.
let strokeBBox = null; // { minX, minY, maxX, maxY } | null

// ==================== HELPER ====================
function degToRad(deg) {
  return ((deg || 0) * Math.PI) / 180;
}

function getPerpendicularVector(rotation) {
  const perpAngle = rotation + Math.PI / 2;
  return { x: Math.cos(perpAngle), y: Math.sin(perpAngle) };
}

// ─── Espande il bounding-box con il padding necessario per un timbro ─────────
// Considera:
//   • diagonale del timbro scalato (la rotazione può essere qualsiasi angolo)
//   • posJitter (spostamento perpendicolare massimo)
//   • bleed (shadowBlur × 2 come margine minimo)
//   • margine fisso di sicurezza (16 px)
function _expandBBox(cx, cy, baseWidth, posJitter, bleed) {
  if (!strokeBBox || !stampBitmap) return;

  const STAMP_BASE_WIDTH = 240;
  const scale = baseWidth / STAMP_BASE_WIDTH;
  const sw = stampBitmap.width * scale;
  const sh = stampBitmap.height * scale;

  // raggio che copre il timbro in qualsiasi orientazione
  const halfDiag = Math.sqrt(sw * sw + sh * sh) / 2;

  // padding generoso: diagonale + jitter massimo + shadow + margine fisso
  const pad = Math.ceil(halfDiag + posJitter * 2 + bleed * 3 + 16);

  strokeBBox.minX = Math.min(strokeBBox.minX, cx - pad);
  strokeBBox.minY = Math.min(strokeBBox.minY, cy - pad);
  strokeBBox.maxX = Math.max(strokeBBox.maxX, cx + pad);
  strokeBBox.maxY = Math.max(strokeBBox.maxY, cy + pad);
}

// ─── Ritaglia il canvas corrente al bounding-box, restituisce bitmap + offset ─
async function _buildCroppedBitmap() {
  if (!offscreenCanvas) return null;

  // Se non c'è nessun timbro (bbox non inizializzata) → canvas vuoto 1×1
  if (!strokeBBox || strokeBBox.minX === Infinity || strokeBBox.minY === Infinity) {
    const empty = new OffscreenCanvas(1, 1);
    return { bitmap: await createImageBitmap(empty), offsetX: 0, offsetY: 0 };
  }

  // Clampa al canvas fisico per evitare rettangoli fuori bounds
  const x = Math.max(0, Math.floor(strokeBBox.minX));
  const y = Math.max(0, Math.floor(strokeBBox.minY));
  const right = Math.min(offscreenCanvas.width, Math.ceil(strokeBBox.maxX));
  const bottom = Math.min(offscreenCanvas.height, Math.ceil(strokeBBox.maxY));
  const cw = Math.max(1, right - x);
  const ch = Math.max(1, bottom - y);

  const cropped = new OffscreenCanvas(cw, ch);
  const ctx = cropped.getContext("2d");
  // copia solo la regione dipinta dal canvas principale
  ctx.drawImage(offscreenCanvas, x, y, cw, ch, 0, 0, cw, ch);

  return {
    bitmap: await createImageBitmap(cropped),
    offsetX: x,
    offsetY: y
  };
}

// ==================== DRAW SINGLE STAMP (con densità adattiva) ====================
function performStamp(params) {
  if (!offscreenCtx || !stampBitmap) return;

  let {
    x,
    y,
    rotation,
    baseWidth = 24,
    flow = 0.82,
    layers = 22,
    posJitter = 11,
    rotJitter = 9.5,
    bleed = 3.2,
    shadowColor = "#1a1a1a",
    speedFactor = 1,
    isFirstStamp = false
  } = params;

  const densityFactor = speedFactor <= 1.0 ? 1.0 : Math.max(0.35, 1 / speedFactor);

  const effectiveLayers = isFirstStamp
    ? Math.max(4, Math.floor(layers * 0.45))
    : Math.max(6, Math.floor(layers * densityFactor));

  const STAMP_BASE_WIDTH = 240;
  const scale = baseWidth / STAMP_BASE_WIDTH;
  const w = stampBitmap.width * scale;
  const h = stampBitmap.height * scale;

  _expandBBox(x, y, baseWidth, posJitter, bleed);

  offscreenCtx.save();
  offscreenCtx.translate(x, y);
  offscreenCtx.rotate(rotation);

  offscreenCtx.shadowColor = shadowColor;
  offscreenCtx.shadowBlur = Math.max(0, bleed * 1.55 * densityFactor * (isFirstStamp ? 0.35 : 1));

  const perp = getPerpendicularVector(rotation);
  const flowVal = Math.max(0.05, flow);

  for (let l = 0; l < effectiveLayers; l++) {
    offscreenCtx.save();

    const jitterScale = isFirstStamp ? 0.45 : 0.85;
    const layerPerpJitter = (Math.random() - 0.5) * (posJitter * jitterScale);
    const layerRotJitter = degToRad((Math.random() - 0.5) * rotJitter * 0.22);

    offscreenCtx.translate(perp.x * layerPerpJitter, perp.y * layerPerpJitter);
    offscreenCtx.rotate(layerRotJitter);
    offscreenCtx.globalAlpha = flowVal * (1 - (l / effectiveLayers) * 0.85) * (isFirstStamp ? 0.72 : 1);

    offscreenCtx.drawImage(stampBitmap, -w / 2, -h / 2, w, h);
    offscreenCtx.restore();
  }

  offscreenCtx.shadowBlur = 0;
  offscreenCtx.restore();
}

// ==================== MESSAGE HANDLER ====================
self.onmessage = async function (e) {
  const { type, strokeId, width, height, stampData, stamps } = e.data;

  switch (type) {
    case "strokeStart": {
      currentStrokeId = strokeId;

      // Inizializza il canvas fisico del tratto
      offscreenCanvas = new OffscreenCanvas(width, height);
      offscreenCtx = offscreenCanvas.getContext("2d", { alpha: true, desynchronized: true });
      offscreenCtx.imageSmoothingEnabled = true;
      offscreenCtx.imageSmoothingQuality = "high";

      const imageData = new ImageData(new Uint8ClampedArray(stampData.buffer), stampData.w, stampData.h);
      stampBitmap = await createImageBitmap(imageData);

      offscreenCtx.clearRect(0, 0, width, height);
      lastPreviewTime = performance.now();

      // Resetta il bounding-box per il nuovo tratto
      strokeBBox = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };

      // Preview iniziale vuota (canvas 1×1 ritagliato)
      const emptyCanvas = new OffscreenCanvas(1, 1);
      const emptyBitmap = await createImageBitmap(emptyCanvas);
      self.postMessage({ type: "strokePreview", strokeId, bitmap: emptyBitmap, offsetX: 0, offsetY: 0 }, [emptyBitmap]);
      break;
    }

    case "strokeChunk": {
      if (!offscreenCtx) return;

      for (const stamp of stamps) {
        performStamp(stamp); // disegna e aggiorna il bbox
      }

      const now = performance.now();
      if (now - lastPreviewTime >= PREVIEW_THROTTLE_MS) {
        // ── Preview ritagliata al bounding-box corrente ─────────────────────
        const result = await _buildCroppedBitmap();
        if (result) {
          self.postMessage(
            {
              type: "strokePreview",
              strokeId: currentStrokeId,
              bitmap: result.bitmap,
              offsetX: result.offsetX,
              offsetY: result.offsetY
            },
            [result.bitmap]
          );
        }
        lastPreviewTime = now;
      }
      break;
    }

    case "strokeEnd": {
      if (!offscreenCanvas) return;

      // ── Bitmap finale ritagliato + offset di posizionamento ────────────────
      const result = await _buildCroppedBitmap();
      if (result) {
        self.postMessage(
          {
            type: "strokeResult",
            strokeId: currentStrokeId,
            bitmap: result.bitmap,
            offsetX: result.offsetX,
            offsetY: result.offsetY
          },
          [result.bitmap]
        );
      } else {
        // fallback di sicurezza: canvas intero (non dovrebbe mai accadere)
        const fullBitmap = await createImageBitmap(offscreenCanvas);
        self.postMessage(
          { type: "strokeResult", strokeId: currentStrokeId, bitmap: fullBitmap, offsetX: 0, offsetY: 0 },
          [fullBitmap]
        );
      }

      offscreenCtx = null;
      offscreenCanvas = null;
      stampBitmap = null;
      currentStrokeId = null;
      strokeBBox = null;
      break;
    }

    case "cancelStroke": {
      offscreenCtx = null;
      offscreenCanvas = null;
      stampBitmap = null;
      currentStrokeId = null;
      strokeBBox = null;
      break;
    }
  }
};

console.log("[gpuWorker] ✅ BOUNDING-BOX CROP attivo — bitmap minimi per ogni tratto");
