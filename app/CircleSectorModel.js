// CircleSectorModel.js
class CircleSectorModel {
  constructor(startDeg = 0, sweepDeg = 90, radiusX = 50, radiusY = 50) {
    this.startDeg = Number(startDeg);
    this.sweepDeg = Math.max(5, Math.min(360, Number(sweepDeg)));
    this.radiusX = Math.max(5, Number(radiusX));
    this.radiusY = Math.max(5, Number(radiusY));
  }

  /** Path SVG perfetto per cerchi E ellissi (rx ≠ ry) */
  getPath(cx = 0, cy = 0) {
    const sr = (this.startDeg * Math.PI) / 180;
    const er = sr + (this.sweepDeg * Math.PI) / 180;
    const x1 = cx + this.radiusX * Math.cos(sr);
    const y1 = cy + this.radiusY * Math.sin(sr);
    const x2 = cx + this.radiusX * Math.cos(er);
    const y2 = cy + this.radiusY * Math.sin(er);
    const largeArc = this.sweepDeg > 180 ? 1 : 0;

    return `M ${cx},${cy} L ${x1.toFixed(2)},${y1.toFixed(2)} A ${this.radiusX},${this.radiusY} 0 ${largeArc} 1 ${x2.toFixed(2)},${y2.toFixed(2)} Z`;
  }

  toJSON(px2mmFunc) {
    const toMm = (v) => (typeof px2mmFunc === "function" ? px2mmFunc(v) : v);
    return {
      type: "sector",
      startDeg: Number(this.startDeg),
      sweepDeg: Number(this.sweepDeg),
      radiusX_mm: Number(toMm(this.radiusX)),
      radiusY_mm: Number(toMm(this.radiusY))
    };
  }

  static fromJSON(obj = {}, mm2pxFunc) {
    const toPx = (v) => (typeof mm2pxFunc === "function" ? mm2pxFunc(v) : v);
    return new CircleSectorModel(
      obj.startDeg ?? 0,
      obj.sweepDeg ?? 90,
      toPx(obj.radiusX_mm ?? 50),
      toPx(obj.radiusY_mm ?? 50)
    );
  }
}
