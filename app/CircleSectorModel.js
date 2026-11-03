// CircleSectorModel.js
//
// Il settore del cerchio e dell'ovale (◔). Dal cantiere «Spunta Tessere»
// (Fetta 3, novembre 2026) il settore sa anche SCHIACCIARE il lato curvo:
//
//   curva = 1   → l'arco di sempre (il path è identico, al carattere, a
//                 quello di prima: i settori e i file di sempre non cambiano)
//   curva = 0.6 → ogni punto dell'arco scende verso la corda: resta al 60 %
//                 della sua altezza sopra la corda (B5 = a, «premuta col
//                 pollice»: P' = Q + curva·(P − Q), Q = P proiettato sulla corda)
//   curva = 0   → il lato curvo è dritto: il settore diventa un triangolo
//
// I due lati dritti (dal centro ai due estremi) NON cambiano mai: gli
// estremi stanno sulla corda e la regola li lascia dove sono.
//
// INIZIO e FINE CURVATURA (Mirko, 02/11/2026: la forma della Palladiana
// che «parte dritta e poi curva»): il lato curvo può cominciare con un
// tratto DRITTO, lungo la tangente all'arco in un capo, e solo dopo
// curvare. `inizio` è il tratto dritto dal primo capo (E1, quello del
// lato che arriva da `startDeg`), `fine` quello dal secondo (E2): una
// LUNGHEZZA nel sistema del settore (px come i raggi; nel file in mm,
// `inizio_mm` / `fine_mm`, come `radiusX_mm`), misurata lungo la tangente
// dal capo verso il punto T dove le due tangenti dei capi si incontrano.
// Al massimo il 99 % del segmento capo → T. La curva che
// resta è l'immagine dell'arco intero per l'affinità che tiene fermo T e
// accorcia TE1 e TE2 delle due frazioni: resta un arco d'ellisse,
// tangente al tratto dritto (si raccorda senza spigolo). Sul quarto di
// cerchio T è lo spigolo del quadrato: con inizio al massimo la tessera
// diventa quasi un quadrato. La `curva` schiaccia PRIMA l'arco verso la
// corda E1E2 (come senza tratti), e i tratti seguono le tangenti
// dell'arco schiacciato: così il raccordo resta liscio anche lì. Solo
// fino a 179,5° e con la curva sopra 0: su mezzo cerchio le due tangenti
// sono parallele, a curva 0 stanno sulla stessa retta.
//
// La regola è un'affinità che schiaccia perpendicolarmente alla corda, quindi
// l'arco schiacciato è ancora un arco d'ellisse: nel path resta un comando
// «A» (coi raggi e l'inclinazione dell'ellisse nuova), che Fabric, la Tavola
// delle Tessere e l'SVG leggono come oggi.
//
// La curva sta NEL MODELLO (in __shape.curva) perché alla riapertura di un
// progetto renderer.js rifà ogni settore da CircleSectorModel.fromJSON:
// così torna schiacciato da sé. Un settore intero NON scrive il campo.
// Si schiaccia solo un settore fino a 180°: oltre, l'arco gira attorno al
// centro e schiacciandolo verso la corda attraverserebbe i lati dritti.
class CircleSectorModel {
  constructor(startDeg = 0, sweepDeg = 90, radiusX = 50, radiusY = 50, curva = 1, inizio = 0, fine = 0) {
    this.startDeg = Number(startDeg);
    this.sweepDeg = Math.max(5, Math.min(360, Number(sweepDeg)));
    this.radiusX = Math.max(5, Number(radiusX));
    this.radiusY = Math.max(5, Number(radiusY));
    const c = Number(curva);
    this.curva = isFinite(c) ? Math.max(0, Math.min(1, c)) : 1;
    const fr = (x) => {
      const v = Number(x);
      return isFinite(v) ? Math.max(0, v) : 0;
    };
    this.inizio = fr(inizio);
    this.fine = fr(fine);
  }

  /** Il tratto dritto più lungo: fino al 99 % del segmento capo → T (a T la curva sparirebbe). */
  static get TRATTO_MASSIMO() {
    return 0.99;
  }

  /** Si possono fare inizio e fine curvatura? (le tangenti dei capi si incontrano) */
  get conTratti() {
    return this.sweepDeg < 179.5;
  }

  /** Ls = I − (1 − curva)·n nᵀ, lo schiacciamento verso la corda E1E2 (n = normale unitaria). */
  _schiaccia(e) {
    const k = 1 - this.curvaUsata;
    let nx = -(e.y2 - e.y1),
      ny = e.x2 - e.x1;
    const nl = Math.hypot(nx, ny) || 1;
    nx /= nl;
    ny /= nl;
    return [1 - k * nx * nx, -k * nx * ny, -k * nx * ny, 1 - k * ny * ny];
  }

  /**
   * T, dove si incontrano le tangenti nei due capi dell'arco GIÀ
   * schiacciato dalla curva (così il tratto dritto si raccorda sempre
   * all'arco senza spigolo), e i vettori u = E1 − T, v = E2 − T.
   * null se le tangenti non si incontrano (mezzo cerchio, o curva 0).
   */
  tangenti(cx = 0, cy = 0) {
    if (!this.conTratti) return null;
    const e = this.estremi(cx, cy);
    const L = this._schiaccia(e);
    const sr = (this.startDeg * Math.PI) / 180;
    const er = sr + (this.sweepDeg * Math.PI) / 180;
    const t1 = { x: -this.radiusX * Math.sin(sr), y: this.radiusY * Math.cos(sr) };
    const t2 = { x: -this.radiusX * Math.sin(er), y: this.radiusY * Math.cos(er) };
    const d1 = { x: L[0] * t1.x + L[1] * t1.y, y: L[2] * t1.x + L[3] * t1.y };
    const d2 = { x: L[0] * t2.x + L[1] * t2.y, y: L[2] * t2.x + L[3] * t2.y };
    const den = d1.x * d2.y - d1.y * d2.x;
    if (Math.abs(den) < 1e-9 * Math.hypot(d1.x, d1.y) * Math.hypot(d2.x, d2.y)) return null;
    const k = ((e.x2 - e.x1) * d2.y - (e.y2 - e.y1) * d2.x) / den;
    const T = { x: e.x1 + k * d1.x, y: e.y1 + k * d1.y };
    return { T, u: { x: e.x1 - T.x, y: e.y1 - T.y }, v: { x: e.x2 - T.x, y: e.y2 - T.y } };
  }

  /** Il settore si può schiacciare? (fino a mezzo cerchio) */
  get schiacciabile() {
    return this.sweepDeg <= 180 + 1e-9;
  }

  /** I due estremi dell'arco (sulla corda), come li scrive il path. */
  estremi(cx = 0, cy = 0) {
    const sr = (this.startDeg * Math.PI) / 180;
    const er = sr + (this.sweepDeg * Math.PI) / 180;
    return {
      x1: cx + this.radiusX * Math.cos(sr),
      y1: cy + this.radiusY * Math.sin(sr),
      x2: cx + this.radiusX * Math.cos(er),
      y2: cy + this.radiusY * Math.sin(er)
    };
  }

  /** La curva che il path usa davvero (oltre 180° il settore resta intero). */
  get curvaUsata() {
    return this.schiacciabile ? this.curva : 1;
  }
  // I tratti dritti come FRAZIONE del segmento capo → T (fino al 99 %).
  // Contano solo se le tangenti si incontrano: fino a 179,5° e con la
  // curva sopra 0 (a curva 0 il lato è già tutto dritto).
  frazioni(cx = 0, cy = 0) {
    if (!(this.inizio > 0 || this.fine > 0) || !this.conTratti || this.curvaUsata < 0.001) return { f1: 0, f2: 0, tg: null };
    const tg = this.tangenti(cx, cy);
    if (!tg) return { f1: 0, f2: 0, tg: null };
    const M = CircleSectorModel.TRATTO_MASSIMO;
    const lu = Math.hypot(tg.u.x, tg.u.y),
      lv = Math.hypot(tg.v.x, tg.v.y);
    return { f1: lu > 0 ? Math.min(M, this.inizio / lu) : 0, f2: lv > 0 ? Math.min(M, this.fine / lv) : 0, tg };
  }
  get inizioUsato() {
    return this.frazioni().f1;
  }
  get fineUsato() {
    return this.frazioni().f2;
  }

  /**
   * Il lato curvo come lo disegna il path: dove comincia la curva (B) e
   * dove finisce (C), e la parte lineare K dell'affinità che porta l'arco
   * intero nella curva: prima lo schiacciamento verso la corda E1E2
   * (Ls), poi i tratti dritti (Lg: tiene fermo T, accorcia TE1 e TE2).
   * L'arco nuovo è l'ellisse di matrice K·diag(rx, ry), K = Lg·Ls.
   */
  curvaDisegnata(cx = 0, cy = 0) {
    const e = this.estremi(cx, cy);
    const fz = this.frazioni(cx, cy);
    const f1 = fz.f1,
      f2 = fz.f2;
    const Ls = this._schiaccia(e);
    let B = { x: e.x1, y: e.y1 },
      C = { x: e.x2, y: e.y2 };
    let g00 = 1,
      g01 = 0,
      g10 = 0,
      g11 = 1;
    const tg = f1 > 0 || f2 > 0 ? fz.tg : null;
    if (tg) {
      const { T, u, v } = tg;
      B = { x: T.x + (1 - f1) * u.x, y: T.y + (1 - f1) * u.y };
      C = { x: T.x + (1 - f2) * v.x, y: T.y + (1 - f2) * v.y };
      // Lg = P·diag(1 − f1, 1 − f2)·P⁻¹, P = [u v], P⁻¹ = [v.y −v.x; −u.y u.x] / det
      const det = u.x * v.y - u.y * v.x;
      const a = 1 - f1,
        b = 1 - f2;
      g00 = (a * u.x * v.y - b * v.x * u.y) / det;
      g01 = (-a * u.x * v.x + b * v.x * u.x) / det;
      g10 = (a * u.y * v.y - b * v.y * u.y) / det;
      g11 = (-a * u.y * v.x + b * v.y * u.x) / det;
    }
    // K = Lg·Ls
    const K = [g00 * Ls[0] + g01 * Ls[2], g00 * Ls[1] + g01 * Ls[3], g10 * Ls[0] + g11 * Ls[2], g10 * Ls[1] + g11 * Ls[3]];
    return { E1: { x: e.x1, y: e.y1 }, E2: { x: e.x2, y: e.y2 }, B, C, K, conTratti: !!tg };
  }

  /**
   * L'ellisse del lato curvo disegnato: raggi r1 ≥ r2 e inclinazione
   * (gradi) dell'asse r1 = valori singolari e asse grande di K·diag(rx, ry)
   * (le radici degli autovalori di M·Mᵀ e il suo autovettore).
   */
  ellisseSchiacciata(cx = 0, cy = 0) {
    const { K } = this.curvaDisegnata(cx, cy);
    // M = K·diag(rx, ry)
    const m00 = K[0] * this.radiusX,
      m01 = K[1] * this.radiusY,
      m10 = K[2] * this.radiusX,
      m11 = K[3] * this.radiusY;
    // S = M·Mᵀ (simmetrica)
    const s00 = m00 * m00 + m01 * m01,
      s01 = m00 * m10 + m01 * m11,
      s11 = m10 * m10 + m11 * m11;
    const meta = (s00 + s11) / 2;
    const d = Math.sqrt(Math.max(0, ((s00 - s11) / 2) ** 2 + s01 * s01));
    const r1 = Math.sqrt(Math.max(0, meta + d));
    const r2 = Math.sqrt(Math.max(0, meta - d));
    const phi = (0.5 * Math.atan2(2 * s01, s00 - s11) * 180) / Math.PI;
    return { r1, r2, phi };
  }

  /**
   * La freccia: quanto è alta la curva sopra la corda, nel sistema del
   * path (px della tessera non scalata). Schiacciata = curva × intera.
   * (Senza tratti dritti: con inizio e fine la si misura sul path.)
   */
  freccia() {
    const e = this.estremi(0, 0);
    let nx = -(e.y2 - e.y1),
      ny = e.x2 - e.x1;
    const nl = Math.hypot(nx, ny) || 1;
    nx /= nl;
    ny /= nl;
    // n·(P(t) − E1) = n·(C − E1) + a cos t + b sin t
    const a = nx * this.radiusX,
      b = ny * this.radiusY;
    const c0 = -(nx * e.x1 + ny * e.y1);
    const sr = (this.startDeg * Math.PI) / 180;
    const sw = (this.sweepDeg * Math.PI) / 180;
    let best = 0;
    const prova = (t) => {
      const v = Math.abs(c0 + a * Math.cos(t) + b * Math.sin(t));
      if (v > best) best = v;
    };
    // il massimo di a cos t + b sin t (e il minimo) cadono a t* e t* + π
    const ts = Math.atan2(b, a);
    for (const t0 of [ts, ts + Math.PI]) {
      let rel = (t0 - sr) % (2 * Math.PI);
      if (rel < 0) rel += 2 * Math.PI;
      if (rel <= sw) prova(sr + rel);
    }
    prova(sr);
    prova(sr + sw);
    return best * this.curvaUsata;
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

    const c = this.curvaUsata;
    const fz = this.frazioni(cx, cy);
    const f1 = fz.f1,
      f2 = fz.f2;
    if (c >= 0.9999 && f1 === 0 && f2 === 0) {
      // il settore di sempre: la stessa stringa, al carattere
      return `M ${cx},${cy} L ${x1.toFixed(2)},${y1.toFixed(2)} A ${this.radiusX},${this.radiusY} 0 ${largeArc} 1 ${x2.toFixed(2)},${y2.toFixed(2)} Z`;
    }
    const p2 = (q) => `${q.x.toFixed(2)},${q.y.toFixed(2)}`;
    const p4 = (q) => `${Number(q.x.toFixed(4))},${Number(q.y.toFixed(4))}`;
    const E1 = { x: x1, y: y1 },
      E2 = { x: x2, y: y2 };
    if (c < 0.001 && f1 === 0 && f2 === 0) {
      // lato dritto: un triangolo coi due lati di prima
      return `M ${cx},${cy} L ${p2(E1)} L ${p2(E2)} Z`;
    }
    const cd = this.curvaDisegnata(cx, cy);
    const parti = [`M ${cx},${cy}`, `L ${p2(E1)}`];
    if (f1 > 0) parti.push(`L ${p4(cd.B)}`);
    const fineCurva = f2 > 0 ? p4(cd.C) : p2(E2);
    const el = this.ellisseSchiacciata(cx, cy);
    if (c < 0.001 || el.r2 < 1e-6) {
      parti.push(`L ${fineCurva}`);
    } else {
      // stesso «large» e stesso verso: l'affinità ha determinante > 0
      const f = (v) => Number(v.toFixed(6));
      parti.push(`A ${f(el.r1)},${f(el.r2)} ${f(el.phi)} ${largeArc} 1 ${fineCurva}`);
    }
    if (f2 > 0) parti.push(`L ${p2(E2)}`);
    parti.push("Z");
    return parti.join(" ");
  }

  toJSON(px2mmFunc) {
    const toMm = (v) => (typeof px2mmFunc === "function" ? px2mmFunc(v) : v);
    const out = {
      type: "sector",
      startDeg: Number(this.startDeg),
      sweepDeg: Number(this.sweepDeg),
      radiusX_mm: Number(toMm(this.radiusX)),
      radiusY_mm: Number(toMm(this.radiusY))
    };
    // un settore intero si scrive come sempre (niente campo)
    if (this.curva < 1) out.curva = this.curva;
    if (this.inizio > 0) out.inizio_mm = Number(toMm(this.inizio));
    if (this.fine > 0) out.fine_mm = Number(toMm(this.fine));
    return out;
  }

  static fromJSON(obj = {}, mm2pxFunc) {
    const toPx = (v) => (typeof mm2pxFunc === "function" ? mm2pxFunc(v) : v);
    return new CircleSectorModel(
      obj.startDeg ?? 0,
      obj.sweepDeg ?? 90,
      toPx(obj.radiusX_mm ?? 50),
      toPx(obj.radiusY_mm ?? 50),
      obj.curva ?? 1,
      toPx(obj.inizio_mm ?? 0),
      toPx(obj.fine_mm ?? 0)
    );
  }
}
