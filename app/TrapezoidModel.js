// -------------------- TrapezoidModel --------------------
// Dipendenza: la funzione _centroidOfPoints deve essere disponibile globalmente
// oppure importata nel contesto in cui viene usata questa classe.

class TrapezoidModel {
  /**
   * topBase, bottomBase, height, offset sono espressi nella stessa unità di "base"
   * (px quando usati direttamente).
   * offset è lo spostamento orizzontale del centro della BASE SUPERIORE
   * rispetto al centro della base inferiore (positivo → destra).
   */
  constructor(topBase = 60, bottomBase = 100, height = 50, offset = 0) {
    this.topBase = Number(topBase);
    this.bottomBase = Number(bottomBase);
    this.height = Number(height);
    this.offset = Number(offset);
    // dimensioni minime valide
    if (this.height <= 0) this.height = 1;
    if (this.topBase < 0) this.topBase = 0;
    if (this.bottomBase < 0) this.bottomBase = 0;
  }

  /**
   * Calcola i punti del trapezio centrati sull'origine.
   * Base inferiore a y = 0, base superiore a y = -height.
   */
  computePoints() {
    const b = this.bottomBase;
    const t = this.topBase;
    const h = this.height;
    const dx = this.offset;

    // in senso orario: basso-sx, basso-dx, alto-dx, alto-sx
    const A = { x: -b / 2, y: 0 };
    const B = { x: b / 2, y: 0 };
    const C = { x: dx + t / 2, y: -h };
    const D = { x: dx - t / 2, y: -h };

    const pts = [A, B, C, D];
    // trasla in modo che il centroide sia in (0,0), come TriangleModel
    const centroid = _centroidOfPoints(pts);
    return pts.map((p) => ({ x: p.x - centroid.x, y: p.y - centroid.y }));
  }

  /** Scala verticalmente se necessario per adattarsi all'altezza H (in px). */
  computePointsFit(H) {
    let pts = this.computePoints();
    const ys = pts.map((p) => p.y);
    const height = Math.max(...ys) - Math.min(...ys);
    if (height > H && height > 0) {
      const scale = H / height;
      pts = pts.map((p) => ({ x: p.x * scale, y: p.y * scale }));
      const centroid = _centroidOfPoints(pts);
      pts = pts.map((p) => ({ x: p.x - centroid.x, y: p.y - centroid.y }));
    }
    return pts;
  }

  /** Serializzazione: richiede un convertitore px→mm per la persistenza. */
  toJSON(px2mmFunc) {
    const toMm = (v) => (typeof px2mmFunc === "function" ? px2mmFunc(v) : v);
    return {
      type: "trapezoid",
      top_mm: Number(toMm(this.topBase)),
      bottom_mm: Number(toMm(this.bottomBase)),
      height_mm: Number(toMm(this.height)),
      offset_mm: Number(toMm(this.offset))
    };
  }

  /** Deserializzazione: converte mm→px con mm2pxFunc (se fornita). */
  static fromJSON(obj = {}, mm2pxFunc) {
    const top_mm = obj?.top_mm ?? 60;
    const bottom_mm = obj?.bottom_mm ?? 100;
    const height_mm = obj?.height_mm ?? 50;
    const offset_mm = obj?.offset_mm ?? 0;

    const toPx = (v) => (typeof mm2pxFunc === "function" ? mm2pxFunc(v) : v);
    return new TrapezoidModel(toPx(top_mm), toPx(bottom_mm), toPx(height_mm), toPx(offset_mm));
  }

  /**
   * NUOVO — Ricostruisce il modello dai 4 punti del polygon Fabric (in px locali).
   *
   * Convenzione punti (in senso orario, dal computePoints originale):
   *   pts[0] = basso-sx (A)
   *   pts[1] = basso-dx (B)
   *   pts[2] = alto-dx  (C)
   *   pts[3] = alto-sx  (D)
   *
   * Misure recuperate:
   *   bottomBase = |B - A|
   *   topBase    = |C - D|
   *   height     = distanza verticale tra le due basi
   *   offset     = ((C.x + D.x)/2) - ((A.x + B.x)/2)
   *                cioè spostamento orizzontale del centro della base sup
   *                rispetto al centro della base inf.
   *
   * Usato per "cuocere" la scala/handle-scaling nei punti e ricalcolare
   * top/bottom/height/offset reali in pixel.
   */
  static fromPoints(pts) {
    if (!Array.isArray(pts) || pts.length < 4) {
      return new TrapezoidModel(60, 100, 50, 0);
    }

    const A = pts[0];
    const B = pts[1];
    const C = pts[2];
    const D = pts[3];

    const bottomBase = Math.hypot(B.x - A.x, B.y - A.y);
    const topBase = Math.hypot(C.x - D.x, C.y - D.y);

    // L'altezza è la distanza verticale (sull'asse Y locale del polygon)
    // tra la quota media della base inf e quella della base sup.
    const yBottomMean = (A.y + B.y) / 2;
    const yTopMean = (C.y + D.y) / 2;
    const height = Math.abs(yBottomMean - yTopMean);

    const xBottomMean = (A.x + B.x) / 2;
    const xTopMean = (C.x + D.x) / 2;
    const offset = xTopMean - xBottomMean;

    return new TrapezoidModel(Math.max(0, topBase), Math.max(0, bottomBase), Math.max(1, height), offset);
  }
}
