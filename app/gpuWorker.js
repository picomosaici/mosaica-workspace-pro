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
// ── Cantiere del Pennello Timbro, Fetta 3-bis (16/09/2026) ───────────────────
//   ① Una tela OffscreenCanvas su cui nessuno ha mai chiesto un contesto NON
//     si puo' trasformare in bitmap: Chromium risponde "InvalidStateError: The
//     ImageBitmap could not be allocated". Succedeva a OGNI inizio tratto (la
//     preview vuota di strokeStart) e nel ritaglio vuoto: vedi _emptyBitmap().
//   ② Lo sparpagliamento degli strati era ruotato DUE volte (lo spostamento
//     veniva applicato dentro la rotazione del timbro): la larghezza del tratto
//     cambiava con la direzione (orizzontale 32,2 px, verticale 30,3). Ora
//     e' perpendicolare AL TRATTO in tutte le direzioni, come dice la guida
//     utente del cursore "Jitter pos.": vedi performStamp().
//
// ── Cantiere del Pennello Timbro, Fetta 4A-1 (17/09/2026) ────────────────────
//   ③ Il ritaglio FINALE (strokeResult) arriva col suo PNG gia' codificato
//     (dataURL). Fabric 5.1.0 / 5.2.4 / 5.3.0 ricodifica in PNG, a ogni
//     fotografia dell'annulla e a ogni salvataggio automatico, ogni tratto
//     la cui immagine e' una tela (fabric.Image.getSrc → toDataURL): il costo
//     cresceva col numero dei tratti. Il pennello tiene questo PNG e non lo
//     rifa' piu'. La codifica avviene qui, fuori dal filo principale.
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

// ─── Una bitmap vuota (1×1, trasparente) ─────────────────────────────────────
// La tela va "accesa" con getContext() PRIMA di createImageBitmap(): senza
// contesto Chromium rifiuta la conversione (Fetta 3-bis, punto ①).
function _emptyBitmap() {
  const c = new OffscreenCanvas(1, 1);
  c.getContext("2d");
  return createImageBitmap(c);
}

// Nessun timbro disegnato nel tratto corrente?
function _bboxIsEmpty() {
  return !strokeBBox || strokeBBox.minX === Infinity || strokeBBox.minY === Infinity;
}

// ─── Il PNG di una tela, come data-URL (Fetta 4A-1) ─────────────────────────
// Se la codifica fallisce si restituisce null: il pennello la fara' da se',
// una volta sola, la prima volta che serve.
async function _pngDataURL(canvas) {
  try {
    const blob = await canvas.convertToBlob({ type: "image/png" });
    if (typeof FileReaderSync === "function") return new FileReaderSync().readAsDataURL(blob);
    return await new Promise((resolve) => {
      const fr = new FileReader();
      fr.onload = () => resolve(fr.result);
      fr.onerror = () => resolve(null);
      fr.readAsDataURL(blob);
    });
  } catch (err) {
    return null;
  }
}

// ─── Ritaglia il canvas corrente al bounding-box, restituisce bitmap + offset ─
// withPNG: solo per il risultato finale (Fetta 4A-1), non per le anteprime.
async function _buildCroppedBitmap(withPNG) {
  if (!offscreenCanvas) return null;

  // Se non c'è nessun timbro (bbox non inizializzata) → bitmap vuota 1×1
  if (_bboxIsEmpty()) {
    return { bitmap: await _emptyBitmap(), offsetX: 0, offsetY: 0 };
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

  const dataURL = withPNG ? await _pngDataURL(cropped) : null;

  return {
    bitmap: await createImageBitmap(cropped),
    offsetX: x,
    offsetY: y,
    dataURL
  };
}

// ==================== DRAW SINGLE STAMP (con densità adattiva) ====================
function performStamp(params) {
  if (!offscreenCtx || !stampBitmap) return;

  let {
    x,
    y,
    rotation,
    perpX,
    perpY,
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

  offscreenCtx.shadowColor = shadowColor;
  offscreenCtx.shadowBlur = Math.max(0, bleed * 1.55 * densityFactor * (isFirstStamp ? 0.35 : 1));

  // Direzione dello sparpagliamento degli strati, SUL FOGLIO: perpendicolare
  // al tratto. Il pennello la manda gia' fatta (perpX, perpY); se manca, si
  // ripiega sulla perpendicolare alla rotazione del timbro.
  // ⚠ Lo spostamento si applica PRIMA della rotazione del timbro: applicato
  //   dopo (com'era fino alla Fetta 3-bis) veniva ruotato una seconda volta,
  //   ed era di traverso solo nei tratti orizzontali.
  const perp =
    Number.isFinite(perpX) && Number.isFinite(perpY) ? { x: perpX, y: perpY } : getPerpendicularVector(rotation);
  const flowVal = Math.max(0.05, flow);

  for (let l = 0; l < effectiveLayers; l++) {
    offscreenCtx.save();

    const jitterScale = isFirstStamp ? 0.45 : 0.85;
    const layerPerpJitter = (Math.random() - 0.5) * (posJitter * jitterScale);
    const layerRotJitter = degToRad((Math.random() - 0.5) * rotJitter * 0.22);

    offscreenCtx.translate(perp.x * layerPerpJitter, perp.y * layerPerpJitter);
    offscreenCtx.rotate(rotation);
    offscreenCtx.rotate(layerRotJitter);
    offscreenCtx.globalAlpha = flowVal * (1 - (l / effectiveLayers) * 0.85) * (isFirstStamp ? 0.72 : 1);

    offscreenCtx.drawImage(stampBitmap, -w / 2, -h / 2, w, h);
    offscreenCtx.restore();
  }

  offscreenCtx.shadowBlur = 0;
  offscreenCtx.restore();
}

// ==================== MESSAGE HANDLER ====================
// ── SERIALIZZAZIONE DEI MESSAGGI ─────────────────────────────────────────────
// L'handler e' async perche' "strokeStart" deve attendere createImageBitmap()
// per preparare lo stampBitmap e il bounding-box. Senza una coda, quando
// "strokeStart" cede il controllo sull'await il browser puo' gia' eseguire
// l'handler del messaggio successivo: per un CLICK SECCO (timbro singolo) i
// messaggi "strokeChunk" e "strokeEnd" arrivano subito dopo "strokeStart" e
// venivano elaborati PRIMA che stampBitmap/strokeBBox fossero pronti →
// performStamp() usciva senza disegnare e il ritaglio finale era vuoto: il
// timbro singolo "non appariva". Tracciando un tratto, invece, i chunk
// arrivano piu' tardi (dopo l'await) e il problema non si vedeva.
//
// La coda _msgChain garantisce che ogni messaggio (incluso l'await interno)
// venga COMPLETATO prima che parta il successivo, mantenendo l'ordine reale
// strokeStart → strokeChunk → strokeEnd. Il .catch evita che un errore in un
// handler blocchi tutta la catena.
let _msgChain = Promise.resolve();

async function handleWorkerMessage(e) {
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

      // Preview iniziale vuota (bitmap 1×1): ripulisce l'anteprima a schermo.
      // Fino alla Fetta 3-bis questa riga lanciava un errore a ogni tratto e
      // la preview vuota non partiva mai.
      const emptyBitmap = await _emptyBitmap();
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

      if (_bboxIsEmpty()) {
        // ── Niente di dipinto: il tratto si chiude SENZA oggetto ────────────
        // (bitmap: null). Il pennello libera lo stato del tratto e non mette
        // sul foglio un'immagine trasparente da 1×1 px, con la sua voce di
        // annullamento. Prima qui il ritaglio vuoto lanciava un errore e il
        // risultato non arrivava mai.
        self.postMessage({ type: "strokeResult", strokeId: currentStrokeId, bitmap: null, offsetX: 0, offsetY: 0 });
        offscreenCtx = null;
        offscreenCanvas = null;
        stampBitmap = null;
        currentStrokeId = null;
        strokeBBox = null;
        break;
      }

      // ── Bitmap finale ritagliato + offset di posizionamento + PNG ──────────
      const result = await _buildCroppedBitmap(true);
      if (result) {
        self.postMessage(
          {
            type: "strokeResult",
            strokeId: currentStrokeId,
            bitmap: result.bitmap,
            offsetX: result.offsetX,
            offsetY: result.offsetY,
            dataURL: result.dataURL
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
}

self.onmessage = function (e) {
  // Accoda l'elaborazione: ogni messaggio completa (await incluso) prima del
  // successivo, preservando l'ordine strokeStart → strokeChunk → strokeEnd.
  _msgChain = _msgChain
    .then(() => handleWorkerMessage(e))
    .catch((err) => {
      console.error("[gpuWorker] Errore nell'handler messaggio:", err);
    });
};

console.log("[gpuWorker] ✅ BOUNDING-BOX CROP attivo — bitmap minimi per ogni tratto");
