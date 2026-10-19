// softProof.js — la PROVA DI STAMPA a video (soft-proof).
// Cantiere «Tintometro», Fetta 3 (15 ottobre 2026).
//
// Detto con le mani: un VELO trasparente ai clic, appoggiato sopra la tela di Fabric (sotto le maniglie),
// che ridipinge il foglio «come uscirà in stampa». Il disegno, le tessere e i file non cambiano: il velo
// guarda e basta. La tabella dei colori (LUT 33×33×33) la prepara il motore colore nel processo principale
// (colorEngine.js, Fetta 1); qui la si applica a ogni ridisegno.
//
// Come lavora:
//  • il velo copre SOLO la parte del foglio che si vede sullo schermo (a zoom alto il backstore di Fabric
//    arriva a decine di milioni di pixel: copiarlo tutto raddoppierebbe la memoria della scheda video, che
//    è proprio quello che faceva crollare Mosaica agli zoom alti — vedi il TETTO DI SICUREZZA in renderer.js);
//  • con la scheda video (WebGL2) il ridisegno è immediato, a ogni render di Fabric;
//  • senza WebGL2 c'è una strada di riserva in JavaScript, che si aggiorna a fine gesto;
//  • segue zoom e pan (la transform CSS di #paper) e si nasconde durante il «burst» della rotella, quando
//    renderer.js nasconde la tela e mostra la sua istantanea.
//
// ⚠ Zero righe in renderer.js: si usano canvas.lowerCanvasEl, l'evento after:render, e si osservano gli
//   attributi style di #paper e della tela bassa.
(function () {
  "use strict";
  if (window.softProof) return;

  const MAX_SIDE = 4096; // lato massimo del velo, in pixel veri
  const CPU_DEBOUNCE_MS = 140; // la riserva in JavaScript aspetta la fine del gesto
  const STRIPE_PX = 4; // larghezza delle righe del «fuori stampa», in pixel del MONITOR

  const T = (k, p, fb) => {
    try {
      if (window.i18n && typeof window.i18n.t === "function") {
        const s = window.i18n.t(k, p);
        if (s && s !== k) return s;
      }
    } catch (_) {}
    if (!fb) return k;
    return p ? String(fb).replace(/\{(\w+)\}/g, (m, x) => (x in p ? String(p[x]) : m)) : fb;
  };
  const toast = (msg) => {
    try {
      if (typeof window.flashToast === "function") window.flashToast(msg);
    } catch (_) {}
  };

  // ───────────────────────── stato ─────────────────────────
  const S = {
    on: false,
    busy: false,
    lut: null, // { n, data: Uint8Array RGBA, white, gamutScale, gamutDE, profileId, intent, paper }
    settings: null, // { profileId, intent, paper, gamutWarning }
    profiles: [],
    defaultId: null,
    mode: null, // "webgl" | "cpu"
    veil: null, // il <canvas> del velo
    gl: null,
    prog: null,
    texSrc: null,
    texLut: null,
    loc: {},
    ctx2d: null, // riserva
    scratch: null, // tela d'appoggio per riduzioni
    rafId: 0,
    frameLock: false, // già ridisegnato in questo fotogramma
    dirty: false, // un render arrivato col fotogramma già usato
    cpuTimer: 0,
    times: [],
    lastRect: null,
    observers: [],
    forceCpu: false // per le prove: window.softProof._forceCpu(true)
  };

  function canvasOk() {
    const c = window.canvas;
    return !!(c && c.lowerCanvasEl && c.lowerCanvasEl.parentNode);
  }
  function api() {
    return window.colorAPI && typeof window.colorAPI.proofLut === "function" ? window.colorAPI : null;
  }

  // ───────────────────────── il velo ─────────────────────────
  function makeVeil(kind) {
    const low = window.canvas.lowerCanvasEl;
    if (S.veil && S.veil.parentNode) S.veil.parentNode.removeChild(S.veil);
    const v = document.createElement("canvas");
    v.id = "softProofVeil";
    v.setAttribute("aria-hidden", "true");
    v.style.cssText = "position:absolute;left:0;top:0;width:0;height:0;pointer-events:none;display:none;";
    // ⚠ Subito DOPO la tela bassa e PRIMA di quella delle maniglie: sopra il disegno, sotto selezione e
    // cursore. Messo dopo la tela delle maniglie si mangerebbe i clic (trappola 285).
    low.parentNode.insertBefore(v, low.nextSibling);
    S.veil = v;
    S.gl = null;
    S.ctx2d = null;
    if (kind === "webgl") {
      const gl = v.getContext("webgl2", { alpha: true, premultipliedAlpha: false, antialias: false, depth: false, stencil: false, preserveDrawingBuffer: false });
      if (!gl || !initGL(gl)) return false;
      S.gl = gl;
      v.addEventListener("webglcontextlost", (e) => {
        e.preventDefault();
        S.gl = null;
        S.mode = null; // al prossimo disegno si rifà il velo (WebGL se torna, altrimenti riserva)
      });
      return true;
    }
    S.ctx2d = v.getContext("2d");
    return !!S.ctx2d;
  }

  function initGL(gl) {
    const vs =
      "#version 300 es\nin vec2 p; out vec2 uv;\n" +
      "void main(){ uv = vec2((p.x + 1.0) * 0.5, (1.0 - p.y) * 0.5); gl_Position = vec4(p, 0.0, 1.0); }";
    const fs =
      "#version 300 es\nprecision highp float; precision highp sampler3D;\n" +
      "uniform sampler2D src; uniform sampler3D lut; uniform vec3 paper; uniform float warn; uniform float thr;\n" +
      "uniform float lutScale; uniform float lutOffset; uniform float stripe; in vec2 uv; out vec4 o;\n" +
      "void main(){\n" +
      "  vec4 c = texture(src, uv);\n" +
      "  vec4 p = texture(lut, c.rgb * lutScale + lutOffset);\n" +
      "  vec3 col = mix(paper, p.rgb, c.a);\n" +
      "  if (warn > 0.5 && c.a > 0.5 && p.a > thr) {\n" +
      "    float st = mod(floor((gl_FragCoord.x + gl_FragCoord.y) / stripe), 2.0);\n" +
      "    col = mix(col, vec3(0.5), 0.6 * st);\n" +
      "  }\n" +
      "  o = vec4(col, 1.0);\n" +
      "}";
    const sh = (type, src) => {
      const s = gl.createShader(type);
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
        console.warn("[softProof] shader:", gl.getShaderInfoLog(s));
        return null;
      }
      return s;
    };
    const a = sh(gl.VERTEX_SHADER, vs), b = sh(gl.FRAGMENT_SHADER, fs);
    if (!a || !b) return false;
    const prog = gl.createProgram();
    gl.attachShader(prog, a);
    gl.attachShader(prog, b);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      console.warn("[softProof] link:", gl.getProgramInfoLog(prog));
      return false;
    }
    gl.useProgram(prog);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const lp = gl.getAttribLocation(prog, "p");
    gl.enableVertexAttribArray(lp);
    gl.vertexAttribPointer(lp, 2, gl.FLOAT, false, 0, 0);
    S.texSrc = gl.createTexture();
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, S.texSrc);
    for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.NEAREST], [gl.TEXTURE_MAG_FILTER, gl.NEAREST], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v);
    S.texLut = gl.createTexture();
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_3D, S.texLut);
    for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_R, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_3D, k, v);
    S.prog = prog;
    S.loc = {};
    for (const n of ["src", "lut", "paper", "warn", "thr", "lutScale", "lutOffset", "stripe"]) S.loc[n] = gl.getUniformLocation(prog, n);
    gl.uniform1i(S.loc.src, 0);
    gl.uniform1i(S.loc.lut, 1);
    S.lutUploaded = null;
    return true;
  }

  function uploadLut() {
    const gl = S.gl, L = S.lut;
    if (!gl || !L || S.lutUploaded === L) return;
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_3D, S.texLut);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage3D(gl.TEXTURE_3D, 0, gl.RGBA8, L.n, L.n, L.n, 0, gl.RGBA, gl.UNSIGNED_BYTE, L.data);
    gl.uniform1f(S.loc.lutScale, (L.n - 1) / L.n);
    gl.uniform1f(S.loc.lutOffset, 0.5 / L.n);
    gl.uniform1f(S.loc.thr, (L.gamutDE * L.gamutScale) / 255);
    S.lutUploaded = L;
  }

  // La parte del foglio che si vede: in pixel della tela bassa (backstore) e in px CSS del foglio.
  function visibleRect() {
    const c = window.canvas, low = c.lowerCanvasEl;
    const r = low.getBoundingClientRect();
    const cssW = c.getWidth(), cssH = c.getHeight();
    if (!r.width || !r.height || !cssW || !cssH) return null;
    const scale = r.width / cssW; // la scala dello zoom (transform di #paper)
    const ratioX = low.width / cssW, ratioY = low.height / cssH; // pixel veri per px CSS
    const vx0 = Math.max(r.left, 0), vy0 = Math.max(r.top, 0);
    const vx1 = Math.min(r.right, window.innerWidth), vy1 = Math.min(r.bottom, window.innerHeight);
    if (vx1 <= vx0 || vy1 <= vy0) return null;
    // in px CSS del foglio, con un px di margine
    const sx0 = Math.max(0, (vx0 - r.left) / scale - 1), sy0 = Math.max(0, (vy0 - r.top) / scale - 1);
    const sx1 = Math.min(cssW, (vx1 - r.left) / scale + 1), sy1 = Math.min(cssH, (vy1 - r.top) / scale + 1);
    const bx = Math.max(0, Math.floor(sx0 * ratioX)), by = Math.max(0, Math.floor(sy0 * ratioY));
    const bw = Math.min(low.width, Math.ceil(sx1 * ratioX)) - bx, bh = Math.min(low.height, Math.ceil(sy1 * ratioY)) - by;
    if (bw <= 0 || bh <= 0) return null;
    // Riduzione: sempre se il pezzo è enorme; con la riserva in JavaScript anche ai pixel veri dello SCHERMO
    // (la tela di Fabric ne ha 2–8 per ogni pixel del monitor: lavorarli tutti in JavaScript è tempo buttato,
    // tanto il browser li rimpicciolisce lo stesso).
    const dpr = window.devicePixelRatio || 1;
    const screenW = (bw / ratioX) * scale * dpr; // quanti pixel del monitor occupa il pezzo
    let f = Math.min(1, MAX_SIDE / Math.max(bw, bh));
    if (S.mode === "cpu") f = Math.min(f, Math.max(0.05, screenW / bw));
    return {
      bx, by, bw, bh, f,
      cw: Math.max(1, Math.round(bw * f)), ch: Math.max(1, Math.round(bh * f)),
      perScreenPx: (bw * f) / Math.max(1, screenW), // pixel del velo per pixel del monitor (righe sempre larghe uguali)
      cssLeft: bx / ratioX, cssTop: by / ratioY, cssW: bw / ratioX, cssH: bh / ratioY
    };
  }

  function placeVeil(R) {
    const v = S.veil;
    if (v.width !== R.cw) v.width = R.cw;
    if (v.height !== R.ch) v.height = R.ch;
    const st = v.style;
    const l = R.cssLeft + "px", t = R.cssTop + "px", w = R.cssW + "px", h = R.cssH + "px";
    if (st.left !== l) st.left = l;
    if (st.top !== t) st.top = t;
    if (st.width !== w) st.width = w;
    if (st.height !== h) st.height = h;
    if (st.display !== "block") st.display = "block";
  }

  function scratchFor(R) {
    let sc = S.scratch;
    if (!sc) sc = S.scratch = document.createElement("canvas");
    if (sc.width !== R.cw) sc.width = R.cw;
    if (sc.height !== R.ch) sc.height = R.ch;
    const ctx = sc.getContext("2d", { willReadFrequently: S.mode === "cpu" });
    ctx.clearRect(0, 0, R.cw, R.ch);
    ctx.drawImage(window.canvas.lowerCanvasEl, R.bx, R.by, R.bw, R.bh, 0, 0, R.cw, R.ch);
    return { el: sc, ctx };
  }

  function hideVeil() {
    if (S.veil && S.veil.style.display !== "none") S.veil.style.display = "none";
  }

  function lowerHidden() {
    const low = window.canvas && window.canvas.lowerCanvasEl;
    return !low || low.style.visibility === "hidden" || low.style.display === "none";
  }

  // ── ridisegno con la scheda video ──
  function drawGL(R) {
    const gl = S.gl, low = window.canvas.lowerCanvasEl;
    uploadLut();
    placeVeil(R);
    gl.viewport(0, 0, R.cw, R.ch);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, S.texSrc);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    if (R.f === 1) {
      // il pezzo che si vede, direttamente dalla tela bassa (WebGL2: sottorettangolo di una sorgente DOM)
      gl.pixelStorei(gl.UNPACK_SKIP_PIXELS, R.bx);
      gl.pixelStorei(gl.UNPACK_SKIP_ROWS, R.by);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, R.bw, R.bh, 0, gl.RGBA, gl.UNSIGNED_BYTE, low);
      gl.pixelStorei(gl.UNPACK_SKIP_PIXELS, 0);
      gl.pixelStorei(gl.UNPACK_SKIP_ROWS, 0);
    } else {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, scratchFor(R).el);
    }
    const w = S.lut.paper ? S.lut.white : [255, 255, 255];
    gl.uniform3f(S.loc.paper, w[0] / 255, w[1] / 255, w[2] / 255);
    gl.uniform1f(S.loc.warn, S.settings && S.settings.gamutWarning ? 1 : 0);
    gl.uniform1f(S.loc.stripe, Math.max(2, STRIPE_PX * R.perScreenPx));
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  // ── ridisegno di riserva, in JavaScript ──
  function drawCPU(R) {
    const L = S.lut, N = L.n, lut = L.data, s = (N - 1) / 255;
    const src = R.f === 1
      ? window.canvas.lowerCanvasEl.getContext("2d").getImageData(R.bx, R.by, R.bw, R.bh)
      : scratchFor(R).ctx.getImageData(0, 0, R.cw, R.ch);
    const px = src.data, W = src.width;
    const w = L.paper ? L.white : [255, 255, 255];
    const warn = !!(S.settings && S.settings.gamutWarning), thr = L.gamutDE * L.gamutScale;
    const stripe = Math.max(2, STRIPE_PX * R.perScreenPx);
    const sx = 4, sy = N * 4, sz = N * N * 4;
    for (let i = 0, p = 0; i < px.length; i += 4, p++) {
      const a = px[i + 3] / 255;
      const fr = px[i] * s, fg = px[i + 1] * s, fb = px[i + 2] * s;
      let r0 = fr | 0, g0 = fg | 0, b0 = fb | 0;
      if (r0 > N - 2) r0 = N - 2;
      if (g0 > N - 2) g0 = N - 2;
      if (b0 > N - 2) b0 = N - 2;
      const dr = fr - r0, dg = fg - g0, db = fb - b0;
      const base = ((b0 * N + g0) * N + r0) * 4;
      let out = 0;
      for (let ch = 0; ch < 4; ch++) {
        const q = base + ch;
        const c00 = lut[q] + (lut[q + sx] - lut[q]) * dr, c10 = lut[q + sy] + (lut[q + sy + sx] - lut[q + sy]) * dr;
        const c01 = lut[q + sz] + (lut[q + sz + sx] - lut[q + sz]) * dr, c11 = lut[q + sz + sy] + (lut[q + sz + sy + sx] - lut[q + sz + sy]) * dr;
        const c0 = c00 + (c10 - c00) * dg, c1 = c01 + (c11 - c01) * dg;
        const val = c0 + (c1 - c0) * db;
        if (ch < 3) px[i + ch] = w[ch] + (val - w[ch]) * a;
        else out = val;
      }
      if (warn && a > 0.5 && out > thr) {
        const x = p % W, y = (p / W) | 0;
        const k = 0.6 * (Math.floor((x + (R.ch - 1 - y)) / stripe) % 2);
        for (let ch = 0; ch < 3; ch++) px[i + ch] = px[i + ch] + (128 - px[i + ch]) * k;
      }
      px[i + 3] = 255;
    }
    placeVeil(R);
    S.ctx2d.putImageData(src, 0, 0);
  }

  function ensureMode() {
    if (S.mode && S.veil && S.veil.parentNode) return true;
    if (!S.forceCpu && makeVeil("webgl")) {
      S.mode = "webgl";
      return true;
    }
    if (makeVeil("2d")) {
      S.mode = "cpu";
      return true;
    }
    S.mode = null;
    return false;
  }

  function draw() {
    S.rafId = 0;
    if (!S.on || !S.lut || !canvasOk()) return hideVeil();
    if (lowerHidden()) return hideVeil(); // burst della rotella: renderer.js mostra la sua istantanea
    if (!ensureMode()) return;
    const R = visibleRect();
    if (!R) return hideVeil();
    const t0 = performance.now();
    try {
      if (S.mode === "webgl" && S.gl) drawGL(R);
      else if (S.mode === "cpu") drawCPU(R);
    } catch (e) {
      console.warn("[softProof] disegno:", e);
      if (S.mode === "webgl") {
        S.mode = null;
        S.forceCpu = true; // un errore WebGL: si passa alla riserva
      }
      return;
    }
    S.lastRect = R;
    S.times.push(performance.now() - t0);
    if (S.times.length > 60) S.times.shift();
    updateStatus();
  }

  // Dopo un render di Fabric: con la scheda video SUBITO, così il velo non resta indietro di un fotogramma;
  // ma al massimo UNA volta per fotogramma (certi gesti chiamano renderAll più volte di fila: i render in più
  // dello stesso fotogramma si riassumono in un solo ridisegno al fotogramma dopo). Con la riserva, a fine gesto.
  function onRender() {
    if (!S.on) return;
    if (S.mode === "cpu") return scheduleCpu();
    if (S.mode === "webgl" && S.gl) {
      if (S.frameLock) {
        S.dirty = true;
        return;
      }
      draw();
      S.frameLock = true;
      requestAnimationFrame(() => {
        S.frameLock = false;
        if (S.dirty) {
          S.dirty = false;
          draw();
        }
      });
      return;
    }
    schedule();
  }
  function schedule() {
    if (!S.on) return;
    if (S.mode === "cpu") return scheduleCpu();
    if (!S.rafId) S.rafId = requestAnimationFrame(draw);
  }
  function scheduleCpu() {
    if (S.cpuTimer) clearTimeout(S.cpuTimer);
    // mentre si lavora il velo di riserva sparisce: meglio il foglio vero che uno vecchio
    hideVeil();
    S.cpuTimer = setTimeout(() => {
      S.cpuTimer = 0;
      draw();
    }, CPU_DEBOUNCE_MS);
  }

  // ───────────────────────── accendi / spegni ─────────────────────────
  async function loadLut() {
    const a = api();
    if (!a) throw new Error(T("softProof.toast.noEngine", null, "Riavvia Mosaica: il motore colore non è attivo"));
    const r = await a.proofLut({});
    if (!r || r.ok === false) throw new Error((r && r.error) || "LUT");
    const data = r.data instanceof Uint8Array ? r.data : new Uint8Array(r.data);
    if (data.length !== r.n * r.n * r.n * 4) throw new Error("LUT di lunghezza sbagliata");
    S.lut = { n: r.n, data, white: r.white, gamutScale: r.gamutScale, gamutDE: r.gamutDE, profileId: r.profileId, intent: r.intent, paper: r.paper };
    S.lutUploaded = null;
  }

  async function loadSettings() {
    const a = api();
    if (!a) return null;
    const r = await a.getSettings();
    if (r && r.ok) S.settings = r.settings;
    return S.settings;
  }

  async function setOn(v) {
    v = !!v;
    if (v === S.on || S.busy) return S.on;
    if (!v) {
      S.on = false;
      hideVeil();
      updateButton();
      updateStatus();
      toast(T("softProof.toast.off", null, "🖨️ Prova di stampa spenta"));
      return false;
    }
    if (!canvasOk()) return false;
    if (!api()) {
      toast(T("softProof.toast.noEngine", null, "❌ Riavvia Mosaica: il motore colore non è attivo"));
      return false;
    }
    S.busy = true;
    try {
      await loadSettings();
      await loadLut();
      if (!S.profiles.length) await loadProfiles(false).catch(() => {});
      S.on = true;
      ensureMode();
      draw();
      updateButton();
      const p = S.profiles.find((x) => x.id === S.lut.profileId);
      toast(T("softProof.toast.on", { profile: p ? p.name : "" }, "🖨️ Prova di stampa: {profile}"));
    } catch (e) {
      S.on = false;
      updateButton();
      toast(T("softProof.toast.error", { msg: (e && e.message) || e }, "❌ Prova di stampa: {msg}"));
    } finally {
      S.busy = false;
    }
    return S.on;
  }

  // Cambia una scelta (profilo, intento, carta, fuori stampa): si salva e, se serve, si rifà la tabella.
  async function change(patch) {
    const a = api();
    if (!a) return;
    const r = await a.setSettings(patch);
    if (r && r.ok) S.settings = r.settings;
    const needLut = S.lut && (S.lut.profileId !== S.settings.profileId || S.lut.intent !== S.settings.intent || S.lut.paper !== S.settings.paper);
    if (S.on && needLut) {
      S.busy = true;
      try {
        await loadLut();
      } catch (e) {
        toast(T("softProof.toast.error", { msg: (e && e.message) || e }, "❌ Prova di stampa: {msg}"));
      } finally {
        S.busy = false;
      }
    } else if (needLut) {
      S.lut = null; // si rifà alla prossima accensione
    }
    syncPanel();
    if (S.on) draw();
  }

  // ───────────────────────── interfaccia ─────────────────────────
  const $ = (id) => document.getElementById(id);

  function updateButton() {
    const b = $("softProofToggle");
    if (!b) return;
    b.classList.toggle("on", S.on);
    b.setAttribute("aria-pressed", S.on ? "true" : "false");
  }

  function updateStatus() {
    const el = $("softProofStatus");
    if (!el) return;
    if (!S.on) {
      el.textContent = T("softProof.status.off", null, "Spenta");
      return;
    }
    const tt = S.times.slice().sort((x, y) => x - y);
    const ms = tt.length ? tt[Math.floor(tt.length / 2)].toFixed(1) : "—";
    el.textContent = S.mode === "webgl"
      ? T("softProof.status.webgl", { ms }, "Velo: scheda video · {ms} ms")
      : T("softProof.status.cpu", { ms }, "Velo: processore (senza WebGL2) · {ms} ms");
  }

  const GROUPS = ["mosaica", "utente", "windows", "adobe", "sistema"];
  const GROUP_FALLBACK = { mosaica: "Di Mosaica (liberi)", utente: "Aggiunti da te", windows: "Installati in Windows", adobe: "Profili Adobe", sistema: "Del sistema" };

  async function loadProfiles(rescan) {
    const a = api();
    if (!a) return [];
    const r = await a.listProfiles(!!rescan);
    S.profiles = r && r.ok ? r.profiles.filter((p) => p.kind === "cmyk") : [];
    S.defaultId = r && r.ok ? r.defaultId : null;
    return S.profiles;
  }

  function syncPanel() {
    const sel = $("softProofProfile");
    if (sel) {
      sel.textContent = "";
      for (const g of GROUPS) {
        // quello di base per primo, poi in ordine di nome
        const items = S.profiles.filter((p) => p.source === g).sort((a, b) => (b.id === S.defaultId) - (a.id === S.defaultId) || String(a.name).localeCompare(String(b.name)));
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
    if (S.settings) {
      if ($("softProofIntent")) $("softProofIntent").value = S.settings.intent;
      if ($("softProofPaper")) $("softProofPaper").checked = !!S.settings.paper;
      if ($("softProofGamut")) $("softProofGamut").checked = !!S.settings.gamutWarning;
    }
    updateStatus();
  }

  async function openPanel() {
    const dd = $("softProofDropdown");
    if (!dd) return;
    dd.classList.add("open");
    try {
      await loadSettings();
      await loadProfiles(false);
    } catch (_) {}
    syncPanel();
  }
  function closePanel() {
    const dd = $("softProofDropdown");
    if (dd) dd.classList.remove("open");
  }

  function bindUI() {
    const tg = $("softProofToggle"), mb = $("softProofMenuBtn"), dd = $("softProofDropdown");
    if (!tg || !dd) return;
    if (!api()) {
      tg.disabled = true;
      tg.removeAttribute("data-i18n-title"); // altrimenti la traduzione rimette il suggerimento normale
      if (mb) mb.disabled = true;
      tg.title = T("softProof.toast.noEngine", null, "Riavvia Mosaica: il motore colore non è attivo");
    }
    // ⚠ Niente stopPropagation qui: il clic deve arrivare al documento, così i menu File/Esporta/
    // Calibrazione di bootMosaicaUI si chiudono come quando si clicca altrove.
    tg.addEventListener("click", () => {
      setOn(!S.on);
    });
    if (mb)
      mb.addEventListener("click", () => {
        if (dd.classList.contains("open")) closePanel();
        else openPanel();
      });
    // Il pannello si chiude cliccando FUORI. In fase di cattura: i pulsanti degli altri menu fermano la
    // propagazione del loro clic, e senza la cattura il nostro pannello resterebbe aperto sotto il loro.
    document.addEventListener("click", (e) => {
      if (!dd.contains(e.target)) closePanel();
    }, true);
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") closePanel();
    });
    const sel = $("softProofProfile");
    if (sel) sel.addEventListener("change", () => change({ profileId: sel.value }));
    const it = $("softProofIntent");
    if (it) it.addEventListener("change", () => change({ intent: it.value }));
    const pp = $("softProofPaper");
    if (pp) pp.addEventListener("change", () => change({ paper: pp.checked }));
    const gw = $("softProofGamut");
    if (gw) gw.addEventListener("change", () => change({ gamutWarning: gw.checked }));
    const add = $("softProofAddBtn");
    if (add)
      add.addEventListener("click", async () => {
        const a = api();
        if (!a) return;
        const r = await a.addProfile();
        if (r && r.canceled) return;
        if (!r || r.ok === false) return toast(T("softProof.toast.notAdded", { msg: (r && r.error) || "?" }, "❌ Profilo non aggiunto: {msg}"));
        await loadProfiles(false);
        toast(r.already
          ? T("softProof.toast.already", { name: r.profile.name }, "Il profilo c'è già: {name}")
          : T("softProof.toast.added", { name: r.profile.name }, "✅ Profilo aggiunto: {name}"));
        await change({ profileId: r.profile.id });
      });
    const rs = $("softProofRescanBtn");
    if (rs)
      rs.addEventListener("click", async () => {
        await loadProfiles(true);
        syncPanel();
        toast(T("softProof.toast.rescan", { n: S.profiles.length }, "🔄 Profili trovati: {n}"));
      });
  }

  // ───────────────────────── aggancio ─────────────────────────
  function attach() {
    if (!canvasOk()) return false;
    const c = window.canvas;
    c.on("after:render", onRender);
    // pan e zoom cambiano la transform CSS di #paper senza un render di Fabric; il burst della rotella
    // nasconde la tela bassa. Tutti e due si vedono dagli attributi style.
    const mo = new MutationObserver(() => {
      if (!S.on) return;
      if (lowerHidden()) hideVeil();
      else schedule();
    });
    const paper = document.getElementById("paper");
    if (paper) mo.observe(paper, { attributes: true, attributeFilter: ["style"] });
    mo.observe(c.lowerCanvasEl, { attributes: true, attributeFilter: ["style", "width", "height"] });
    S.observers.push(mo);
    window.addEventListener("resize", schedule);
    bindUI();
    updateButton();
    return true;
  }

  function boot() {
    if (attach()) return;
    let tries = 0;
    const iv = setInterval(() => {
      if (attach() || ++tries > 100) clearInterval(iv);
    }, 100);
  }

  window.softProof = {
    setOn,
    toggle: () => setOn(!S.on),
    isOn: () => S.on,
    change,
    redraw: () => draw(),
    state: () => ({
      on: S.on, mode: S.mode, profileId: S.lut && S.lut.profileId, intent: S.lut && S.lut.intent, paper: S.lut && S.lut.paper,
      gamutWarning: !!(S.settings && S.settings.gamutWarning), rect: S.lastRect,
      msMedian: S.times.length ? S.times.slice().sort((a, b) => a - b)[Math.floor(S.times.length / 2)] : null
    }),
    _forceCpu: (v) => { S.forceCpu = !!v; S.mode = null; if (S.on) draw(); }
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => setTimeout(boot, 300));
  else setTimeout(boot, 300);
})();
