// -------------------- TriangleModel (angle-based) - BASE IN BASSO --------------------
class TriangleModel {
  constructor(alphaDeg = 60, betaDeg = 60, baseLength = 100) {
    this.alpha = Number(alphaDeg);
    this.beta = Number(betaDeg);
    if (this.alpha + this.beta >= 179) this.beta = Math.max(1, 179 - this.alpha);
    this.base = Number(baseLength);
  }

  get radians() {
    const toRad = (d) => (d * Math.PI) / 180;
    return {
      alpha: toRad(this.alpha),
      beta: toRad(this.beta),
      gamma: Math.PI - toRad(this.alpha) - toRad(this.beta)
    };
  }

  computePoints() {
    const { alpha, beta, gamma } = this.radians;
    let pts;
    if (gamma <= 0) {
      pts = [
        { x: -this.base / 2, y: 0 },
        { x: this.base / 2, y: 0 },
        { x: 0, y: -this.base / 2 }
      ];
    } else {
      const c = this.base;
      const k = c / Math.sin(gamma);
      const a = k * Math.sin(alpha);
      const b = k * Math.sin(beta);
      const A = { x: -c / 2, y: 0 };
      const B = { x: c / 2, y: 0 };
      const xC = (b * b - a * a) / (2 * c);
      const yC = Math.sqrt(Math.max(0, b * b - (xC + c / 2) * (xC + c / 2)));
      const C = { x: xC, y: yC };
      pts = [A, B, C];
    }

    const centroid = _centroidOfPoints(pts);
    pts = pts.map((p) => ({ x: p.x - centroid.x, y: p.y - centroid.y }));

    // === FLIP VERTICALE → base in basso (punto in alto) ===
    pts = pts.map((p) => ({ x: p.x, y: -p.y }));

    return pts;
  }

  computePointsFit(H) {
    let pts = this.computePoints();
    if (typeof H === "number" && H > 0) {
      const ys = pts.map((p) => p.y);
      const curHeight = Math.max(...ys) - Math.min(...ys) || 1;
      const scale = H / curHeight;
      pts = pts.map((p) => ({ x: p.x * scale, y: p.y * scale }));
      const centroid = _centroidOfPoints(pts);
      pts = pts.map((p) => ({ x: p.x - centroid.x, y: p.y - centroid.y }));
    }
    return pts;
  }

  toJSON(px2mmFunc) {
    const base_mm = typeof px2mmFunc === "function" ? px2mmFunc(this.base) : this.base;
    return {
      angles: [Number(this.alpha), Number(this.beta)],
      base_mm: Number(base_mm)
    };
  }

  static fromJSON(obj, mm2pxFunc) {
    const a = obj?.angles?.[0] ?? 60;
    const b = obj?.angles?.[1] ?? 60;
    const base_mm = obj?.base_mm ?? 50;
    const base_px = typeof mm2pxFunc === "function" ? mm2pxFunc(base_mm) : base_mm;
    return new TriangleModel(a, b, base_px);
  }

  /**
   * NUOVO — Ricostruisce il modello dai 3 punti del polygon Fabric (in px locali).
   *
   * Convenzione punti (dal computePoints() dopo flip verticale):
   *   pts[0] = vertice A — basso-sinistra (y > 0 in screen-coord locali)
   *   pts[1] = vertice B — basso-destra   (y > 0 in screen-coord locali)
   *   pts[2] = vertice C — apice in alto  (y < 0 in screen-coord locali)
   *
   * Misure recuperate:
   *   base  = |B − A|
   *   alpha = angolo nel vertice A = ∠(AB, AC)
   *   beta  = angolo nel vertice B = ∠(BA, BC)
   *
   * Usato per "cuocere" handle-scaling/scale-radiale nei punti e ricalcolare
   * angoli e base reali in pixel — analogo a TrapezoidModel.fromPoints.
   */
  static fromPoints(pts) {
    if (!Array.isArray(pts) || pts.length < 3) {
      return new TriangleModel(60, 60, 100);
    }

    const A = pts[0];
    const B = pts[1];
    const C = pts[2];

    // Base = lato AB
    const baseLen = Math.hypot(B.x - A.x, B.y - A.y);

    // Vettori per gli angoli interni
    const ABx = B.x - A.x,
      ABy = B.y - A.y;
    const ACx = C.x - A.x,
      ACy = C.y - A.y;
    const BAx = -ABx,
      BAy = -ABy;
    const BCx = C.x - B.x,
      BCy = C.y - B.y;

    const lenAB = Math.hypot(ABx, ABy) || 1;
    const lenAC = Math.hypot(ACx, ACy) || 1;
    const lenBC = Math.hypot(BCx, BCy) || 1;

    // alpha = ∠ tra AB e AC (sempre tra 0 e π via acos)
    let cosAlpha = (ABx * ACx + ABy * ACy) / (lenAB * lenAC);
    cosAlpha = Math.max(-1, Math.min(1, cosAlpha));
    const alphaDeg = (Math.acos(cosAlpha) * 180) / Math.PI;

    // beta = ∠ tra BA e BC
    let cosBeta = (BAx * BCx + BAy * BCy) / (lenAB * lenBC);
    cosBeta = Math.max(-1, Math.min(1, cosBeta));
    const betaDeg = (Math.acos(cosBeta) * 180) / Math.PI;

    return new TriangleModel(Math.max(0.5, alphaDeg), Math.max(0.5, betaDeg), Math.max(1, baseLen));
  }
}
