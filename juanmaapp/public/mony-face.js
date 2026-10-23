// Mony's living face (version 2.2.15). The particle portrait is drawn on a WebGL mesh and warped around her own
// features: the head turns in depth (nose and eyes move more than the outline), she blinks, her eyes look at the
// pointer, her brows and smile change, she breathes and, when she reads an answer aloud, her mouth moves.
// Everything runs in the browser from the same picture; nothing is recorded or sent anywhere. If WebGL is not
// available, the plain picture stays (the old <img>).
(() => {
  const IMG = "mony-avatar-full.webp", TW = 1600, TH = 893, COLS = 96, ROWS = 54;
  const VERT = `
attribute vec2 aP;
uniform vec2 uTex; uniform vec4 uView;
uniform float uYaw, uPitch, uTilt, uBreath, uBlink, uGx, uGy, uMouth, uSmile, uBrow;
varying vec2 vUV; varying float vDim;
float g(vec2 p, vec2 c, vec2 r) { vec2 q = (p - c) / r; return exp(-dot(q, q)); }
void main() {
  vec2 p = aP, d = vec2(0.0);
  float edge = smoothstep(0.0, 40.0, min(min(p.x, uTex.x - p.x), min(p.y, uTex.y - p.y)));
  // head turn in depth: the middle of the face (nose strongest) shifts more than the outline
  float z = g(p, vec2(750.0, 400.0), vec2(330.0, 430.0)) * (1.0 + 0.9 * g(p, vec2(830.0, 480.0), vec2(120.0, 140.0)));
  d += vec2(uYaw * 44.0, uPitch * 30.0) * z;
  // head tilt around the base of the neck
  float head = 1.0 - smoothstep(640.0, 900.0, p.y);
  float a = uTilt * head; vec2 v = p - vec2(790.0, 820.0);
  d += vec2(cos(a) * v.x - sin(a) * v.y, sin(a) * v.x + cos(a) * v.y) - v;
  // breathing: shoulders and neck rise a little
  d.y -= uBreath * 4.0 * smoothstep(560.0, 900.0, p.y);
  // blink: each eye squeezes toward its lid line; gaze: the iris slides inside the eye
  vec2 e1 = vec2(697.0, 312.0), e2 = vec2(935.0, 328.0);
  float w1 = g(p, e1, vec2(95.0, 40.0)), w2 = g(p, e2, vec2(85.0, 38.0));
  d.y -= uBlink * 0.92 * ((p.y - e1.y) * w1 + (p.y - e2.y) * w2);
  float k1 = g(p, e1, vec2(46.0, 24.0)), k2 = g(p, e2, vec2(42.0, 22.0));
  d += vec2(uGx * 11.0, uGy * 7.0) * (k1 + k2);
  vDim = 1.0 - 0.55 * uBlink * (w1 + w2);
  // brows
  d.y -= uBrow * 11.0 * g(p, vec2(820.0, 262.0), vec2(230.0, 34.0));
  // mouth: the jaw drops (lower lip and chin go down, fading out toward the neck), the corners lift in a smile
  float jaw = smoothstep(584.0, 612.0, p.y) * (1.0 - smoothstep(690.0, 790.0, p.y)) * g(vec2(p.x, 0.0), vec2(805.0, 0.0), vec2(170.0, 1.0));
  d.y += uMouth * 24.0 * jaw;
  d.y -= uMouth * 3.0 * g(p, vec2(805.0, 572.0), vec2(80.0, 14.0));
  d.y -= uSmile * 9.0 * (g(p, vec2(722.0, 592.0), vec2(34.0, 22.0)) + g(p, vec2(888.0, 590.0), vec2(34.0, 22.0)));
  d *= edge;
  vec2 pos = p + d;
  vec2 n = (pos - uView.xy) / uView.zw;
  gl_Position = vec4(n.x * 2.0 - 1.0, 1.0 - n.y * 2.0, 0.0, 1.0);
  vUV = p / uTex;
}`;
  const FRAG = `
precision mediump float;
uniform sampler2D uImg; uniform float uA; varying vec2 vUV; varying float vDim;
void main() { gl_FragColor = vec4(texture2D(uImg, vUV).rgb * vDim, uA); }`;
  // The opening: thousands of points taken from the portrait itself drift in a swirl and lock into place.
  const PVERT = `
attribute vec2 aT; attribute vec2 aS; attribute vec4 aR; attribute vec3 aC;
uniform vec4 uView; uniform float uTime, uPx;
varying vec3 vC; varying float vE;
void main() {
  float e = clamp((uTime - aR.x) / aR.y, 0.0, 1.0); e = 1.0 - pow(1.0 - e, 3.0);
  vec2 c = vec2(750.0, 400.0); float a = aR.z * (1.0 - e); vec2 o = mix(aS, aT - c, e);
  vec2 p = c + vec2(cos(a) * o.x - sin(a) * o.y, sin(a) * o.x + cos(a) * o.y);
  p += vec2(sin(uTime / 260.0 + aR.x * 9.0), cos(uTime / 310.0 + aR.y * 7.0)) * 7.0 * (1.0 - e);
  vec2 n = (p - uView.xy) / uView.zw;
  gl_Position = vec4(n.x * 2.0 - 1.0, 1.0 - n.y * 2.0, 0.0, 1.0);
  gl_PointSize = max(2.0, aR.w * uPx * (0.7 + 0.6 * e)); vC = aC; vE = e;
}`;
  const PFRAG = `
precision mediump float;
uniform float uFade; varying vec3 vC; varying float vE;
void main() { vec2 q = gl_PointCoord - 0.5; float d = dot(q, q) * 4.0; if (d > 1.0) discard;
  gl_FragColor = vec4(vC * (0.55 + 0.35 * vE), (1.0 - d) * 0.8 * uFade); }`;

  const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)");
  const INTRO_MS = 3200, FORMED_MS = 2700;
  const faces = [];
  let gl = null, glc = null, prog = null, U = {}, ready = false, failed = false, raf = 0;
  let vbuf = null, pprog = null, PU = {}, pbuf = null, pcount = 0;
  const S = { yaw: 0, pitch: 0, tilt: 0, gx: 0, gy: 0, blink: 0, mouth: 0, smile: 0.35, brow: 0, breath: 0 };
  const T = { yaw: 0, pitch: 0, gx: 0, gy: 0, smile: 0.35, brow: 0 };
  let mode = "idle"; // idle | thinking | listening | speaking
  let pointer = null, pointerAt = -1e9, nextBlink = 1500, blinkAt = -1, nextSaccade = 0, nextBrow = 4000, lastT = 0, level = 0;

  function init() {
    if (ready || failed) return ready;
    try {
      glc = document.createElement("canvas");
      gl = glc.getContext("webgl", { alpha: false, antialias: false, preserveDrawingBuffer: true });
      if (!gl) throw new Error("webgl");
      const sh = (t, s) => { const o = gl.createShader(t); gl.shaderSource(o, s); gl.compileShader(o); if (!gl.getShaderParameter(o, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(o)); return o; };
      prog = gl.createProgram(); gl.attachShader(prog, sh(gl.VERTEX_SHADER, VERT)); gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FRAG)); gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error("link");
      gl.useProgram(prog);
      for (const n of ["uTex", "uView", "uYaw", "uPitch", "uTilt", "uBreath", "uBlink", "uGx", "uGy", "uMouth", "uSmile", "uBrow", "uImg", "uA"]) U[n] = gl.getUniformLocation(prog, n);
      const pts = [], idx = [];
      for (let j = 0; j <= ROWS; j++) for (let i = 0; i <= COLS; i++) pts.push((i / COLS) * TW, (j / ROWS) * TH);
      for (let j = 0; j < ROWS; j++) for (let i = 0; i < COLS; i++) { const a = j * (COLS + 1) + i, b = a + 1, c = a + COLS + 1, e = c + 1; idx.push(a, b, c, b, e, c); }
      vbuf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, vbuf); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(pts), gl.STATIC_DRAW);
      const loc = gl.getAttribLocation(prog, "aP"); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
      const ib = gl.createBuffer(); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(idx), gl.STATIC_DRAW);
      gl.uniform2f(U.uTex, TW, TH);
      const tex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([6, 16, 40, 255]));
      const im = new Image();
      im.onload = () => {
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, im);
        for (const p of [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T]) gl.texParameteri(gl.TEXTURE_2D, p, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.uniform1i(U.uImg, 0);
        try { buildPoints(im); } catch { pcount = 0; }
        ready = true; wake();
      };
      im.src = IMG;
      glc.addEventListener("webglcontextlost", (e) => { e.preventDefault(); failed = true; unmountAll(); });
      return false;
    } catch { failed = true; return false; }
  }

  function buildPoints(im) {
    const W = 800, H = 447, k = TW / W, c = document.createElement("canvas"); c.width = W; c.height = H;
    const x = c.getContext("2d", { willReadFrequently: true }); x.drawImage(im, 0, 0, W, H);
    const px = x.getImageData(0, 0, W, H).data, MAX = 7000, out = [];
    for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
      const o = (j * W + i) * 4, r = px[o] / 255, g = px[o + 1] / 255, b = px[o + 2] / 255, l = 0.3 * r + 0.59 * g + 0.11 * b;
      const sx = i * k, sy = j * k;
      if (l < 0.42 || sx < 330 || sx > 1100 || sy > 770 || Math.random() > 0.3) continue;
      const ang = Math.random() * Math.PI * 2, rad = 260 + Math.random() * 520;
      out.push(sx + (Math.random() - 0.5) * 2, sy + (Math.random() - 0.5) * 2, Math.cos(ang) * rad, Math.sin(ang) * rad,
        Math.random() * 1100, 900 + Math.random() * 600, (Math.random() < 0.5 ? -1 : 1) * (1.6 + Math.random() * 2.4), 2.2 + l * 3.5,
        Math.min(1, r * 1.3 + 0.1), Math.min(1, g * 1.3 + 0.15), Math.min(1, b * 1.3 + 0.2));
    }
    const stride = 11; let n = out.length / stride;
    if (n > MAX) { const keep = []; for (let q = 0; q < n; q++) if (Math.random() < MAX / n) keep.push(...out.slice(q * stride, q * stride + stride)); out.length = 0; out.push(...keep); n = out.length / stride; }
    const sh = (t, src) => { const o = gl.createShader(t); gl.shaderSource(o, src); gl.compileShader(o); if (!gl.getShaderParameter(o, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(o)); return o; };
    pprog = gl.createProgram(); gl.attachShader(pprog, sh(gl.VERTEX_SHADER, PVERT)); gl.attachShader(pprog, sh(gl.FRAGMENT_SHADER, PFRAG)); gl.linkProgram(pprog);
    if (!gl.getProgramParameter(pprog, gl.LINK_STATUS)) throw new Error("plink");
    for (const nme of ["uView", "uTime", "uPx", "uFade"]) PU[nme] = gl.getUniformLocation(pprog, nme);
    pbuf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, pbuf); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(out), gl.STATIC_DRAW);
    pcount = n;
  }
  function drawPoints(t, v, cw) {
    gl.useProgram(pprog); gl.bindBuffer(gl.ARRAY_BUFFER, pbuf);
    const st = 44; let o = 0;
    for (const [nme, size] of [["aT", 2], ["aS", 2], ["aR", 4], ["aC", 3]]) {
      const l = gl.getAttribLocation(pprog, nme); gl.enableVertexAttribArray(l); gl.vertexAttribPointer(l, size, gl.FLOAT, false, st, o); o += size * 4;
    }
    gl.uniform4f(PU.uView, v[0], v[1], v[2], v[3]); gl.uniform1f(PU.uTime, t); gl.uniform1f(PU.uPx, cw / v[2]);
    const sm = (a, b, x) => { const u = Math.max(0, Math.min(1, (x - a) / (b - a))); return u * u * (3 - 2 * u); };
    gl.uniform1f(PU.uFade, 1 - sm(2500, 3200, t));
    gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
    gl.drawArrays(gl.POINTS, 0, pcount);
    for (const nme of ["aT", "aS", "aR", "aC"]) gl.disableVertexAttribArray(gl.getAttribLocation(pprog, nme));
    gl.useProgram(prog); gl.bindBuffer(gl.ARRAY_BUFFER, vbuf);
    const loc = gl.getAttribLocation(prog, "aP"); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  }

  const visible = (f) => f.cv.getClientRects().length > 0;
  function active() { // only one face is on screen at a time: the enlarged one wins
    const shown = faces.filter(visible);
    return shown.find((f) => f.cv.closest("#mony-zoom")) || shown[0] || null;
  }

  function mount(img) {
    if (!img || img.dataset.face || failed) return;
    if (!init() && failed) return;
    const cv = document.createElement("canvas");
    cv.className = "mony-cv " + img.className;
    for (const a of ["title", "tabindex", "role"]) if (img.hasAttribute(a)) cv.setAttribute(a, img.getAttribute(a));
    cv.setAttribute("aria-label", img.alt || "Mony");
    img.dataset.face = "1"; img.after(cv); img.hidden = true;
    faces.push({ cv, img, ctx: cv.getContext("2d"), was: false, introAt: null, introMs: 3200, formed: true });
    wake();
  }
  function unmountAll() { for (const f of faces) { f.img.hidden = false; f.cv.remove(); } faces.length = 0; }

  function view(f) { // which part of the picture the face shows: a circle around the head, or the whole picture when enlarged to full screen
    const w = f.cv.width, h = f.cv.height;
    if (f.cv.closest("#mony-zoom.full")) {
      const k = 1.04, ca = w / h; let vh = TH / k, vw = vh * ca;
      if (vw > TW / k) { vw = TW / k; vh = vw / ca; }
      return [760 - vw / 2, 446 - vh / 2, vw, vh];
    }
    return [335, 0, 760, 760];
  }
  function size(f) {
    const r = f.cv.getBoundingClientRect(), dpr = Math.min(window.devicePixelRatio || 1, 2);
    const full = !!f.cv.closest("#mony-zoom.full");
    const w = Math.max(32, Math.min(full ? 1920 : 1100, Math.round(r.width * dpr))), h = Math.max(32, Math.min(full ? 1080 : 1100, Math.round(r.height * dpr)));
    if (f.cv.width !== w || f.cv.height !== h) { f.cv.width = w; f.cv.height = h; }
  }

  const lerp = (a, b, k) => a + (b - a) * Math.min(1, k);
  function think(t, dt) {
    const f = active();
    const calm = !!reduce?.matches;
    // where she looks
    const near = pointer && t - pointerAt < 6000 && !calm;
    if (f && near) {
      const r = f.cv.getBoundingClientRect();
      T.yaw = Math.max(-1, Math.min(1, (pointer.x - (r.left + r.width / 2)) / (window.innerWidth / 2))) * 0.85;
      T.pitch = Math.max(-1, Math.min(1, (pointer.y - (r.top + r.height / 2)) / (window.innerHeight / 2))) * 0.7;
      T.gx = Math.max(-1, Math.min(1, T.yaw * 1.6)); T.gy = Math.max(-1, Math.min(1, T.pitch * 1.6));
    } else if (!calm) {
      if (t > nextSaccade) { // a few small glances while nobody moves the pointer
        nextSaccade = t + 1400 + Math.random() * 3200;
        T.gx = (Math.random() - 0.5) * 1.1; T.gy = (Math.random() - 0.5) * 0.7;
        T.yaw = T.gx * 0.3; T.pitch = T.gy * 0.25;
      }
    }
    if (mode === "thinking") { T.gx = -0.5 + Math.sin(t / 700) * 0.2; T.gy = -0.8; T.pitch = -0.25; T.brow = 0.6; }
    else if (mode === "listening") { T.gx = 0; T.gy = 0; T.yaw = 0; T.pitch = -0.05; T.brow = 0.45; T.smile = 0.5; }
    else if (t > nextBrow && !calm) { T.brow = Math.random() < 0.45 ? 0.5 : 0; nextBrow = t + 2500 + Math.random() * 5000; if (mode === "idle") T.smile = 0.25 + Math.random() * 0.4; }
    if (mode === "speaking") { T.brow = Math.max(T.brow, 0.1 + 0.25 * Math.abs(Math.sin(t / 540))); T.smile = 0.2; }
    // blinking
    if (!calm) {
      if (blinkAt < 0 && t > nextBlink) { blinkAt = t; nextBlink = t + 2200 + Math.random() * 4200; if (Math.random() < 0.2) nextBlink = t + 330; }
      if (blinkAt >= 0) { const u = (t - blinkAt) / 170; S.blink = u >= 1 ? 0 : Math.sin(Math.PI * u) ** 0.7; if (u >= 1) blinkAt = -1; }
    } else S.blink = 0;
    // mouth: syllable-like movement while she speaks
    let m = 0;
    if (mode === "speaking" && !calm) {
      level = Math.max(level - dt / 260, 0);
      const s = 0.5 + 0.5 * Math.sin(t / 95 + Math.sin(t / 310) * 2.2), q = 0.5 + 0.5 * Math.sin(t / 47 + 1.3);
      m = Math.min(1, (0.1 + 0.55 * s * (0.55 + 0.45 * q)) + 0.3 * level);
      if (Math.sin(t / 900) > 0.93) m *= 0.2; // a short pause between phrases
    }
    S.mouth = lerp(S.mouth, m, dt / 55);
    const k = dt / 160;
    S.yaw = lerp(S.yaw, T.yaw + (calm ? 0 : Math.sin(t / 2300) * 0.05), k); S.pitch = lerp(S.pitch, T.pitch + (calm ? 0 : Math.sin(t / 3100) * 0.04), k);
    S.tilt = lerp(S.tilt, -S.yaw * 0.035 + (calm ? 0 : Math.sin(t / 4100) * 0.008), k);
    S.gx = lerp(S.gx, T.gx, dt / 70); S.gy = lerp(S.gy, T.gy, dt / 70);
    S.smile = lerp(S.smile, T.smile, dt / 400); S.brow = lerp(S.brow, T.brow, dt / 220);
    S.breath = calm ? 0 : Math.sin(t / 1250);
  }

  function draw(f) {
    size(f);
    const v = view(f);
    if (glc.width !== f.cv.width || glc.height !== f.cv.height) { glc.width = f.cv.width; glc.height = f.cv.height; }
    gl.viewport(0, 0, glc.width, glc.height);
    gl.uniform4f(U.uView, v[0], v[1], v[2], v[3]);
    gl.uniform1f(U.uYaw, S.yaw); gl.uniform1f(U.uPitch, S.pitch); gl.uniform1f(U.uTilt, S.tilt); gl.uniform1f(U.uBreath, S.breath);
    gl.uniform1f(U.uBlink, S.blink); gl.uniform1f(U.uGx, S.gx); gl.uniform1f(U.uGy, S.gy); gl.uniform1f(U.uMouth, S.mouth);
    gl.uniform1f(U.uSmile, S.smile); gl.uniform1f(U.uBrow, S.brow);
    gl.clearColor(0.02, 0.06, 0.15, 1); gl.clear(gl.COLOR_BUFFER_BIT);
    const it = f.introAt === null ? -1 : (performance.now() - f.introAt) * (INTRO_MS / f.introMs), intro = it >= 0 && it < INTRO_MS && pcount > 0;
    const sm = (a, b, x) => { const u = Math.max(0, Math.min(1, (x - a) / (b - a))); return u * u * (3 - 2 * u); };
    gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.uniform1f(U.uA, intro ? sm(1800, 3000, it) : 1);
    gl.drawElements(gl.TRIANGLES, COLS * ROWS * 6, gl.UNSIGNED_SHORT, 0);
    if (intro) drawPoints(it, v, glc.width);
    if (f.introAt !== null && it >= FORMED_MS && !f.formed) { f.formed = true; f.cv.dispatchEvent(new CustomEvent("mony-formed", { bubbles: true })); }
    if (f.introAt !== null && it >= INTRO_MS) f.introAt = null;
    f.ctx.drawImage(glc, 0, 0);
  }

  function frame(t) {
    raf = 0;
    if (failed || !ready) return;
    const f = active();
    if (!f) return; // nothing on screen: stop until something shows up again (wake)
    scan();
    const dt = Math.min(60, lastT ? t - lastT : 16); lastT = t;
    think(t, dt);
    draw(f);
    raf = requestAnimationFrame(frame);
  }
  /** Every time a face shows up again (the Mony screen is entered, the chat opens, the floating button appears) the points gather into it anew. */
  function startIntro(f) {
    f.introAt = performance.now(); f.introMs = f.cv.closest(".mony-id") ? 3200 : 2200; f.formed = false;
    f.cv.dispatchEvent(new CustomEvent("mony-intro-start", { bubbles: true }));
  }
  function scan() {
    for (const f of faces) {
      const v = visible(f);
      if (v && !f.was && !f.cv.closest("#mony-zoom") && !reduce?.matches && pcount > 0) startIntro(f);
      f.was = v;
    }
  }
  function wake() { if (ready && !failed) { scan(); if (!raf) { lastT = 0; raf = requestAnimationFrame(frame); } } }

  document.addEventListener("pointermove", (e) => { pointer = { x: e.clientX, y: e.clientY }; pointerAt = performance.now(); wake(); });
  document.addEventListener("visibilitychange", wake);
  window.addEventListener("resize", wake);
  new MutationObserver(wake).observe(document.documentElement, { attributes: true, subtree: true, attributeFilter: ["hidden", "open", "class"] });

  window.MonyFace = {
    mount, wake,
    get ok() { return !failed; },
    /** idle | thinking | listening | speaking */
    setMode(m) { mode = m; if (m === "idle") { T.brow = 0; T.smile = 0.35; } wake(); },
    /** a spoken word: the mouth opens a little wider */
    pulse() { level = 1; },
    /** test hooks */
    _state: S,
  };
})();
