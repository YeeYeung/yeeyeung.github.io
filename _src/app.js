import * as THREE from './vendor/three.module.min.js';

const root = document.documentElement;
root.classList.add('js');

/* ---- HUD 时钟 ---- */
const clock = document.getElementById('clock');
const clockFmt = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Australia/Sydney', timeZoneName: 'shortOffset' });
const tick = () => {
  const parts = clockFmt.formatToParts(new Date());
  const get = t => (parts.find(p => p.type === t) || {}).value || '';
  clock.textContent = `CBR ${get('timeZoneName')} ${get('hour')}:${get('minute')}`;   // 夏令时自动在 GMT+10 / GMT+11 间切换
};
tick(); setInterval(tick, 30_000);

/* 只有深色主题 */
let themeDirty = true;

/* ---- 入场动画 ---- */
const io = new IntersectionObserver(es => es.forEach(e => {
  if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
}), { threshold: 0.15 });
document.querySelectorAll('.reveal').forEach(el => io.observe(el));

/* ---- Scramble 文字：逐字错开落定，乱跳字符闪强调色 ---- */
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const SCR_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789#%<>/*';
function scramble(el, { letterDelay = 42, scrambleTime = 240 } = {}) {
  const text = el.dataset.stext || el.textContent;
  el.dataset.stext = text;
  el.textContent = '';
  const spans = [...text].map(ch => { const sp = document.createElement('span'); sp.textContent = ch; el.appendChild(sp); return sp; });
  const t0 = performance.now();
  function frame(now) {
    const dt = now - t0; let settled = true;
    for (let i = 0; i < spans.length; i++) {
      const ch = text[i];
      if (!/[A-Za-z0-9]/.test(ch)) continue;
      const sp = spans[i];
      if (dt < i * letterDelay + scrambleTime) { sp.textContent = SCR_CHARS[Math.random() * SCR_CHARS.length | 0]; sp.className = 'scr'; settled = false; }
      else if (sp.className) { sp.textContent = ch; sp.className = ''; }
    }
    if (settled) el.textContent = text; else requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}
if (!reduced) {
  const scrIO = new IntersectionObserver(es => es.forEach(e => {
    if (e.isIntersecting) { scramble(e.target); scrIO.unobserve(e.target); }
  }), { threshold: 0.6 });
  document.querySelectorAll('.sec-head span').forEach(el => scrIO.observe(el));
}

/* ---- 公共小工具 ---- */
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const damp = (a, b, l, dt) => a + (b - a) * (1 - Math.exp(-l * dt));
const mix = (a, b, t) => a + (b - a) * t;
const PROMPT = 'second opinions welcome';
const fine = matchMedia('(hover: hover) and (pointer: fine)').matches;

const scroller = document.getElementById('scroll');
const statement = document.getElementById('statement');
const stagePin = document.getElementById('stage-pin');
const stTitle = document.getElementById('st-title');
const promptEl = document.getElementById('prompt');
const pline = document.getElementById('pline');
const glassHome = document.getElementById('glass-home');
const caretHome = document.getElementById('caret-home');
const caretEnd = document.getElementById('caret-end');
const coordsEl = document.getElementById('coords');
const heroTitle = document.querySelector('.hero .display');

/* ---- 首屏大字：逐字母可变字体波浪 ---- */
const letters = [];
if (!reduced && fine && heroTitle) {
  heroTitle.querySelectorAll('.reveal').forEach(span => {
    const text = span.textContent; span.textContent = '';
    for (const ch of text) {
      const s = document.createElement('span'); s.className = 'ch'; s.textContent = ch; span.appendChild(s);
      if (ch.trim()) letters.push({ el: s, x: 0, y: 0, w: 110, g: 800, lw: 0, lg: 0 });
    }
  });
}
function measureLetters() {
  for (const L of letters) { const r = L.el.getBoundingClientRect(); L.x = r.left + r.width / 2; L.y = r.top + r.height / 2; }
}

/* ============================================================
   WebGL 管线。失败或减弱动效时整体跳过，页面退回静态版。
   ============================================================ */
let renderer = null;
if (!reduced) {
  try {
    THREE.ColorManagement.enabled = false;        // 着色器直接写显示色
    renderer = new THREE.WebGLRenderer({ canvas: document.getElementById('gl'), antialias: !fine, alpha: false, powerPreference: 'high-performance' });
    if (!renderer.capabilities.isWebGL2) throw new Error('webgl2 required');
  } catch (_) { renderer = null; }
}

if (!renderer) {
  pline.textContent = PROMPT;
} else {
  root.classList.add('gl');
  const VIRT = fine;                               // 鼠标设备用阻尼虚拟滚动；触屏保留原生滚动
  if (VIRT) root.classList.add('virt');
  const LITE = !fine;                              // 触屏走轻量路径：直出屏幕、无流体/星芒/画布画廊
  if (LITE) root.classList.add('lite');
  const canvas = renderer.domElement;
  renderer.autoClear = false;
  let DPR = Math.min(devicePixelRatio || 1, fine ? 2 : 1.25);
  renderer.setPixelRatio(DPR);

  const FS_VERT = `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;
  const fsScene = new THREE.Scene();
  const fsCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const fsQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2));
  fsQuad.frustumCulled = false; fsScene.add(fsQuad);
  const fsMat = (frag, uniforms) => new THREE.ShaderMaterial({ vertexShader: FS_VERT, fragmentShader: frag, uniforms, depthTest: false, depthWrite: false });
  const pass = (mat, target) => { fsQuad.material = mat; renderer.setRenderTarget(target); renderer.render(fsScene, fsCam); };
  const rt = (w, h, opts = {}) => new THREE.WebGLRenderTarget(Math.max(2, w | 0), Math.max(2, h | 0), { minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false, ...opts });

  let W = 1, H = 1, PW = 1, PH = 1;

  /* ---- 1. 背景层栈（0.3 倍分辨率，一遍程序化）：指针光斑 → 漩涡 → 正弦 → 拉伸 Voronoi 碎裂 ---- */
  const bgMat = fsMat(`
precision highp float;
varying vec2 vUv;
uniform vec2 uRes; uniform vec2 uPos; uniform float uTime;
uniform vec3 uBase; uniform vec3 uGlow;
mat2 rot(float a){ return mat2(cos(a), -sin(a), sin(a), cos(a)); }
vec2 rnd2(vec2 p){ return fract(sin(vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)))) * 43758.5453); }
void main(){
  float asp = uRes.x / uRes.y;
  vec2 uv = vUv;
  vec2 st = (uv - 0.5) * vec2(asp, 1.0) * 14.0;
  st = rot(-0.785) * st * vec2(1.0, 0.11);
  vec2 ist = floor(st), fst = fract(st);
  float d1 = 9.0, d2 = 9.0; vec2 best = vec2(0.0);
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
    vec2 nb = vec2(float(i), float(j));
    vec2 pt = rnd2(ist + nb);
    pt = 0.5 + 0.5 * sin(5.0 + uTime * 0.2 + 6.2831 * pt);
    float d = length(nb + pt - fst);
    if (d < d1) { d2 = d1; d1 = d; best = pt; } else if (d < d2) { d2 = d; }
  }
  float soft = smoothstep(0.0, 0.04, d2 - d1) * smoothstep(0.0, 0.02, d1);
  uv += (best * 0.36 - 0.18) * soft;
  vec2 wc = uv * 2.0 - 1.0;
  wc.x += sin((wc.y + uPos.y) * 7.0 + uTime * 0.25) * 0.236;
  uv = wc * 0.5 + 0.5;
  vec2 q = uv - uPos; q.x *= asp;
  float dc = length(q);
  float a = 1.0 * smoothstep(0.25, 0.0, dc) + uTime * 0.05;
  q = rot(a * smoothstep(0.25, 0.0, dc)) * q;
  vec2 sq = q * vec2(0.54, 0.46);
  float fall = smoothstep(0.03, 0.30, length(sq));
  gl_FragColor = vec4(mix(uGlow, uBase, fall), 1.0);
}`, {
    uRes: { value: new THREE.Vector2(1, 1) }, uPos: { value: new THREE.Vector2(0.5, 0.5) }, uTime: { value: 0 },
    uBase: { value: new THREE.Color() }, uGlow: { value: new THREE.Color() },
  });

  const TRAIL_N = 12;
  const BLUR = LITE ? 5 : 12;
  const compMat = fsMat(`
precision highp float;
varying vec2 vUv;
uniform sampler2D uBg; uniform vec2 uRes; uniform float uDpr;
uniform vec2 uTrail[${TRAIL_N}]; uniform float uTrailS[${TRAIL_N}];
uniform vec3 uAccent; uniform vec3 uDotCol; uniform float uDotA;
void main(){
  ${LITE ? 'vec3 c = texture2D(uBg, vUv).rgb;' : `  vec3 c = vec3(0.0); float r = 1.0;
  vec2 px = vec2(uRes.y / uRes.x, 1.0) * 0.012;
  for (int i = 0; i < ${BLUR}; i++) {
    float th = float(i) * 2.39996323; r += 1.0 / r;
    c += texture2D(uBg, vUv + (r - 1.0) * vec2(cos(th), sin(th)) * px).rgb;
  }
  c /= ${BLUR}.0;`}
  float cell = 34.0 * uDpr;
  vec2 fc = gl_FragCoord.xy;
  vec2 id = floor(fc / cell), cuv = fract(fc / cell);
  float d = distance(cuv, vec2(0.5));
  float aa = fwidth(d) * 1.5;
  c = mix(c, uDotCol, smoothstep(0.055, 0.055 - aa, d) * uDotA);
  ${LITE ? '' : `float hl = 0.0;
  for (int i = 0; i < ${TRAIL_N}; i++) {
    vec2 pc = floor(uTrail[i] / cell);
    vec2 dd = abs(id - pc);
    hl = max(hl, (1.0 - step(0.5, max(dd.x, dd.y))) * uTrailS[i]);
  }
  c = mix(c, uAccent, smoothstep(0.30, 0.30 - aa, d) * hl);`}
  gl_FragColor = vec4(c, 1.0);
}`, {
    uBg: { value: null }, uRes: { value: new THREE.Vector2(1, 1) }, uDpr: { value: DPR },
    uTrail: { value: Array.from({ length: TRAIL_N }, () => new THREE.Vector2(-9999, -9999)) },
    uTrailS: { value: new Array(TRAIL_N).fill(0) },
    uAccent: { value: new THREE.Color() }, uDotCol: { value: new THREE.Color() }, uDotA: { value: 0.22 },
  });

  /* ---- 2. 3D 场景 ---- */
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 200);
  const CAM_Z = 12;
  camera.position.set(0, 0, CAM_Z);
  const worldH = () => 2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * CAM_Z;

  const OBJ_VERT = `
varying vec3 vN; varying vec3 vEye; varying vec3 vWorld; varying float vY;
void main(){
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorld = wp.xyz;
  vN = normalize((modelMatrix * vec4(normal, 0.0)).xyz);
  vEye = normalize(wp.xyz - cameraPosition);
  vY = position.y;
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;

  const GLASS_LOOPS = LITE ? 2 : 6;
  /* 玻璃：逐通道折射背景贴图 + 体色 + 跟随鼠标的高光 + 侧向菲涅尔 */
  const glassMat = new THREE.ShaderMaterial({
    vertexShader: OBJ_VERT,
    fragmentShader: `
precision highp float;
uniform sampler2D uBg; uniform vec2 uRes; uniform vec3 uLight;
uniform vec3 uTintA; uniform vec3 uTintB; uniform vec2 uYRange; uniform float uDark; uniform float uLift;
varying vec3 vN; varying vec3 vEye; varying vec3 vWorld; varying float vY;
float rnd(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
void main(){
  vec2 uv = gl_FragCoord.xy / uRes;
  vec3 n = normalize(vN), e = normalize(vEye);
  vec3 rR = refract(e, n, 1.0 / 1.15), rG = refract(e, n, 1.0 / 1.18), rB = refract(e, n, 1.0 / 1.22);
  float noise = rnd(uv) * 0.025;
  vec3 col = vec3(0.0);
  for (int i = 0; i < ${GLASS_LOOPS}; i++) {
    float s = float(i) / ${GLASS_LOOPS}.0 * 0.1 + noise;
    col.r += texture2D(uBg, uv + rR.xy * (0.24 + s * 1.0) * 0.30).r;
    col.g += texture2D(uBg, uv + rG.xy * (0.24 + s * 2.0) * 0.30).g;
    col.b += texture2D(uBg, uv + rB.xy * (0.24 + s * 3.0) * 0.30).b;
  }
  col /= ${GLASS_LOOPS}.0;
  float ndv = abs(dot(n, e));
  float thick = 1.0 - ndv;
  float g = clamp((vY - uYRange.x) / (uYRange.y - uYRange.x), 0.0, 1.0);
  vec3 tint = mix(uTintB, uTintA, g);
  vec3 dk = col * 1.3; dk = mix(dk, dk * tint * 2.6, 0.65) + tint * (0.10 + 0.42 * thick);
  vec3 lt = col * mix(vec3(1.0), tint * 1.25, 0.55 + 0.4 * thick);      // 亮底：按厚度吸收
  col = mix(lt, dk, uDark) + tint * uLift * (0.55 + 0.45 * ndv);
  vec3 V = -e;
  vec3 L = normalize(uLight - vWorld);
  float spec = pow(max(dot(n, normalize(L + V)), 0.0), 220.0);
  float spec2 = pow(max(dot(n, normalize(vec3(-0.5, 0.8, 0.6) + V)), 0.0), 320.0);
  col += spec * 1.3 + spec2 * 0.7 + max(dot(n, L), 0.0) * 0.05;
  float fr = pow(1.0 - ndv, 5.0);
  float side = smoothstep(-0.5, 0.5, dot(n, normalize(vec3(-1.0, 0.3, 1.0))));
  col += fr * side * 0.45;
  gl_FragColor = vec4(col, 1.0);
}`,
    uniforms: {
      uBg: { value: null }, uRes: { value: new THREE.Vector2(1, 1) }, uLight: { value: new THREE.Vector3(4, 6, 8) },
      uTintA: { value: new THREE.Color(0.0, 0.80, 0.56) }, uTintB: { value: new THREE.Color(0.0, 0.40, 0.52) },
      uYRange: { value: new THREE.Vector2(-1.2, 1.2) }, uDark: { value: 1 }, uLift: { value: 0 },
    },
  });

  /* 「n=1」充气管字 */
  function tube(points, radius = 0.25) {
    const curve = new THREE.CatmullRomCurve3(points.map(p => new THREE.Vector3(p[0], p[1], p[2] || 0)), false, 'catmullrom', 0.45);
    const g = new THREE.Group();
    g.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 120, radius, 28, false), glassMat));
    for (const p of [points[0], points[points.length - 1]]) {
      const s = new THREE.Mesh(new THREE.SphereGeometry(radius, 28, 20), glassMat);
      s.position.set(p[0], p[1], p[2] || 0); g.add(s);
    }
    return g;
  }
  const glass = new THREE.Group();
  const glassInner = new THREE.Group();
  glass.add(glassInner);
  glassInner.add(tube([[0, 1.0, 0], [0.0, 0.0, 0.04], [0, -1, 0]]));
  glassInner.add(tube([[0.0, 0.25, 0.02], [0.2, 0.78, 0.0], [0.55, 0.98, -0.04], [0.9, 0.72, 0.0], [1.02, 0.1, 0.05], [1.02, -1, 0]]));
  glassInner.add(tube([[1.75, 0.33, 0.1], [2.2, 0.36, 0.14], [2.65, 0.33, 0.1]], 0.2));
  glassInner.add(tube([[1.75, -0.33, -0.05], [2.2, -0.30, -0.02], [2.65, -0.33, -0.05]], 0.2));
  glassInner.add(tube([[3.35, 0.5, 0], [3.62, 0.72, 0.03], [3.86, 1.0, 0.0], [3.9, 0.3, 0.04], [3.9, -1, 0]]));
  glassInner.position.set(-1.95, 0, 0);
  scene.add(glass);

  /* 页底的「n+1」：和开头的「n=1」同一套玻璃管，等号换成加号 */
  const glassEnd = new THREE.Group();
  const glassEndInner = new THREE.Group();
  glassEnd.add(glassEndInner);
  glassEndInner.add(tube([[0, 1.0, 0], [0.0, 0.0, 0.04], [0, -1, 0]]));
  glassEndInner.add(tube([[0.0, 0.25, 0.02], [0.2, 0.78, 0.0], [0.55, 0.98, -0.04], [0.9, 0.72, 0.0], [1.02, 0.1, 0.05], [1.02, -1, 0]]));
  glassEndInner.add(tube([[1.70, 0.0, 0.08], [2.2, 0.03, 0.13], [2.70, 0.0, 0.08]], 0.2));
  glassEndInner.add(tube([[2.2, 0.50, -0.05], [2.2, 0.0, -0.02], [2.2, -0.50, -0.05]], 0.2));
  glassEndInner.add(tube([[3.35, 0.5, 0], [3.62, 0.72, 0.03], [3.86, 1.0, 0.0], [3.9, 0.3, 0.04], [3.9, -1, 0]]));
  glassEndInner.position.set(-1.95, 0, 0);
  glassEnd.visible = false;
  scene.add(glassEnd);
  const glassEndEl = document.getElementById('glass-end');

  /* ---- 飞船：圆润小火箭。首屏停泊，宣言区调头跃迁，结尾飞回停在提示符上方 ---- */
  const lightU = { value: new THREE.Vector3(4, 6, 8) };
  const solidMat = (hex, emit = 0) => new THREE.ShaderMaterial({
    vertexShader: OBJ_VERT, side: THREE.DoubleSide,
    fragmentShader: `precision highp float; uniform vec3 uCol; uniform vec3 uLight; uniform float uEmit;
varying vec3 vN; varying vec3 vEye; varying vec3 vWorld;
void main(){ vec3 n = normalize(vN); if (!gl_FrontFacing) n = -n; vec3 e = normalize(vEye), V = -e;
  vec3 L = normalize(uLight - vWorld);
  float lamb = max(dot(n, normalize(vec3(0.35, 0.75, 0.55))), 0.0);
  vec3 rgb = uCol * (0.40 + 0.60 * lamb);
  rgb += pow(max(dot(n, normalize(L + V)), 0.0), 70.0) * 0.7;
  rgb += pow(1.0 - abs(dot(n, e)), 5.0) * 0.30;
  rgb += uCol * uEmit;
  gl_FragColor = vec4(rgb, 1.0); }`,
    uniforms: { uCol: { value: new THREE.Color(hex) }, uLight: lightU, uEmit: { value: emit } },
  });
  const mAccent = solidMat(0x00e5a0), mLight = solidMat(0xe6f4ee), mDark = solidMat(0x17332c), mWindow = solidMat(0xbffff0, 0.55);
  const glassDS = new THREE.ShaderMaterial({ vertexShader: glassMat.vertexShader, fragmentShader: glassMat.fragmentShader, side: THREE.DoubleSide,
    uniforms: { ...glassMat.uniforms, uLift: { value: 0.5 }, uTintA: { value: new THREE.Color(0.30, 0.98, 0.76) }, uTintB: { value: new THREE.Color(0.05, 0.62, 0.60) } } });   // 共享背景贴图/光源引用，机身更亮
  const glowU = { value: 0 };
  const glowMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
    vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `precision highp float; uniform float uGlow; varying vec2 vUv;
void main(){ float d = distance(vUv, vec2(0.5)) * 2.0; float core = exp(-d * d * 9.0), halo = exp(-d * d * 2.2);
  vec3 c = vec3(0.85, 1.0, 0.95) * core * 1.6 + vec3(0.0, 0.9, 0.63) * halo * 0.9; gl_FragColor = vec4(c * uGlow, 1.0); }`,
    uniforms: { uGlow: glowU },
  });
  const lathe = (pts, seg = 48) => new THREE.LatheGeometry(new THREE.SplineCurve(pts.map(p => new THREE.Vector2(p[0], p[1]))).getPoints(44), seg);
  const put = (g, geo, mat, pos = [0, 0, 0], rot = [0, 0, 0], scl = [1, 1, 1]) => { const m = new THREE.Mesh(geo, mat); m.position.set(...pos); m.rotation.set(...rot); m.scale.set(...scl); m.frustumCulled = false; m.layers.set(2); g.add(m); return m; };
  const glowDisc = (g, y, r) => put(g, new THREE.PlaneGeometry(r * 2, r * 2), glowMat, [0, y, 0], [Math.PI / 2, 0, 0]);
  const extr = (pts, depth) => { const sh = new THREE.Shape(); pts.forEach((p, i) => i ? sh.lineTo(p[0], p[1]) : sh.moveTo(p[0], p[1])); const g = new THREE.ExtrudeGeometry(sh, { depth, bevelEnabled: true, bevelThickness: 0.012, bevelSize: 0.012, bevelSegments: 2 }); g.translate(0, 0, -depth / 2); return g; };

  function shipA() {            // 玻璃舱体 + 腰线 + 舷窗 + 三片尾翼
    const g = new THREE.Group();
    put(g, lathe([[0.001, 1.0], [0.13, 0.9], [0.26, 0.68], [0.33, 0.35], [0.34, 0.0], [0.30, -0.38], [0.22, -0.66]]), glassDS);
    put(g, new THREE.TorusGeometry(0.338, 0.028, 12, 48), mAccent, [0, 0.02, 0], [Math.PI / 2, 0, 0]);
    put(g, new THREE.SphereGeometry(0.115, 24, 18), mWindow, [0, 0.38, 0.27]);
    put(g, new THREE.TorusGeometry(0.125, 0.022, 10, 32), mLight, [0, 0.38, 0.285], [0, 0, 0]);
    const fin = extr([[0, 0.28], [0.40, -0.36], [0.40, -0.58], [0, -0.30]], 0.045);
    for (let i = 0; i < 3; i++) { const h = new THREE.Group(); h.rotation.y = i * Math.PI * 2 / 3 + 0.5; put(h, fin, mAccent, [0.25, -0.36, 0]); g.add(h); }
    put(g, new THREE.CylinderGeometry(0.15, 0.21, 0.16, 28), mDark, [0, -0.74, 0]);
    glowDisc(g, -0.83, 0.42);
    return { group: g, size: 1.95 };
  }
  const ship = shipA();
  ship.group.visible = false; scene.add(ship.group);

  /* 星流：全屏叠加层（预乘混合：黑底按 reveal 盖住画面，光线叠加在上面） */
  const portalMat = new THREE.ShaderMaterial({
    vertexShader: FS_VERT, depthTest: false, depthWrite: false, transparent: true,
    blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
    fragmentShader: `
precision highp float;
uniform vec2 uRes; uniform float uPhase; uniform float uT; uniform float uReveal; uniform float uFlash;
uniform vec3 uA; uniform vec3 uB; uniform vec3 uC;
float h1(float n){ return fract(sin(n * 127.1) * 43758.5453123); }
vec3 hyper(vec2 fc){
  vec2 u = (fc * 2.0 - uRes) / min(uRes.x, uRes.y);
  float r = length(u);
  const float RAYS = 260.0;
  float a = (atan(u.y, u.x) / 6.28318530718 + 0.5) * RAYS;
  float id = floor(a), cell = abs(fract(a) - 0.5);
  float ha = h1(id), hb = h1(id + 71.3), hc = h1(id + 13.7);
  float keepP = mix(0.16, 1.0, uT);
  float keep = 1.0 - smoothstep(keepP - 0.03, keepP + 0.03, fract((id + 0.5) * 0.61803398875));
  float len = mix(0.30, 0.62, hc) * mix(0.75, 1.25, uT);
  float z = log(r + 1e-3) * 1.15 - uPhase * (0.55 + hb) + ha * 17.0;
  float f = fract(z);
  float ew = max(fwidth(z) * 1.5, 0.004);
  float dash = smoothstep(0.0, ew, f) * (1.0 - smoothstep(len - ew, len + ew, f));
  dash *= mix(0.55, 1.0, f / max(len, 1e-3));
  float tw = max(fwidth(cell) * 1.5, 0.002);
  float thin = 1.0 - smoothstep(0.14 - tw, 0.14 + tw, cell);
  float radial = pow(smoothstep(0.06, 0.9, r), 1.2);
  vec3 col = mix(mix(uA, uB, smoothstep(0.0, 0.6, hb)), uC, smoothstep(0.72, 1.0, ha));
  col *= mix(0.8, 1.15, hc);
  return col * dash * thin * keep * radial * mix(1.2, 3.2, uT);
}
void main(){
  vec3 st = hyper(gl_FragCoord.xy);
  float reveal = clamp(uReveal, 0.0, 1.0);
  vec3 rgb = st * reveal * smoothstep(0.0, 0.35, reveal);
  vec2 u = (gl_FragCoord.xy * 2.0 - uRes) / min(uRes.x, uRes.y);
  float r2 = dot(u, u);
  rgb += vec3(0.78, 1.0, 0.92) * uFlash * exp(-r2 * mix(16.0, 0.9, uFlash));     // 跃迁瞬间的闪光
  gl_FragColor = vec4(rgb, smoothstep(0.0, 0.6, reveal));
}`,
    uniforms: {
      uRes: { value: new THREE.Vector2(1, 1) }, uPhase: { value: 0 }, uT: { value: 0 }, uReveal: { value: 0 }, uFlash: { value: 0 },
      uAccent: { value: new THREE.Color() },
      uA: { value: new THREE.Color(0.10, 0.95, 0.72) }, uB: { value: new THREE.Color(0.20, 0.62, 1.0) }, uC: { value: new THREE.Color(0.62, 0.38, 1.0) },
      uLight: lightU,
    },
  });
  const shipEndEl = document.getElementById('ship-end');

  /* ---- 画廊：每张卡一块细分平面，对齐 DOM 槽；滚动卷曲在裁剪空间做，悬停用方块扩散揭示反面 ---- */
  const cardGeo = new THREE.PlaneGeometry(1, 1, 1, 24);
  const texLoader = new THREE.TextureLoader();
  const curlU = { value: 0 };
  const cardMat = () => new THREE.ShaderMaterial({
    transparent: true, depthTest: false, depthWrite: false,
    vertexShader: `
uniform float uCurl; varying vec2 vUv;
void main(){
  vUv = uv;
  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  float y = clamp(p.y / p.w, -1.0, 1.0);
  p.x *= 1.0 - (1.0 - sqrt(max(0.0, 1.0 - y * y))) * uCurl;      // 靠近视口上下缘时向中线收拢 = 圆柱感
  gl_Position = p;
}`,
    fragmentShader: `
precision highp float;
uniform sampler2D uFront; uniform sampler2D uHover; uniform float uHp; uniform vec2 uSize; uniform float uHoverAsp; uniform float uReady;
varying vec2 vUv;
vec2 coverUv(vec2 uv, float imgAsp, float boxAsp){
  vec2 s = imgAsp > boxAsp ? vec2(boxAsp / imgAsp, 1.0) : vec2(1.0, imgAsp / boxAsp);
  return (uv - 0.5) * s + 0.5;
}
void main(){
  vec2 px = vUv * uSize;
  vec2 q = abs(px - uSize * 0.5) - (uSize * 0.5 - 10.0);
  float sd = length(max(q, 0.0)) - 10.0;                          // 圆角 10px
  float alpha = (1.0 - smoothstep(-1.0, 0.5, sd)) * uReady;
  if (alpha < 0.01) discard;
  vec3 col = texture2D(uFront, vUv).rgb;
  if (uHp > 0.001) {
    const float CELL = 20.0;
    vec2 cid = floor(px / CELL), cuv = fract(px / CELL);
    float d = distance((cid + 0.5) * CELL, uSize * 0.5);
    float band = CELL * 4.0;
    float grow = clamp((uHp * (length(uSize * 0.5) + band) - d) / band, 0.0, 1.0);
    grow = grow * grow * (3.0 - 2.0 * grow);
    vec2 a = abs(cuv - 0.5);
    float sq = max(a.x, a.y), aa = fwidth(sq) * 1.5;
    float m = grow >= 0.999 ? 1.0 : (grow <= 0.001 ? 0.0 : 1.0 - smoothstep(0.5 * grow - aa, 0.5 * grow + aa, sq));
    col = mix(col, texture2D(uHover, coverUv(vUv, uHoverAsp, uSize.x / uSize.y)).rgb, m);
  }
  gl_FragColor = vec4(col, alpha);
}`,
    uniforms: { uFront: { value: null }, uHover: { value: null }, uHp: { value: 0 }, uSize: { value: new THREE.Vector2(1, 1) }, uHoverAsp: { value: 1.6 }, uReady: { value: 0 }, uCurl: curlU },
  });
  let closeOpen = null;
  const cards = (LITE ? [] : [...document.querySelectorAll('.gcard')]).map(el => {
    const c = { el, stage: el.querySelector('.stage'), hp: 0, target: 0, mat: cardMat() };
    c.mesh = new THREE.Mesh(cardGeo, c.mat); c.mesh.renderOrder = 1; c.mesh.frustumCulled = false; c.mesh.visible = false; c.mesh.layers.set(1);
    scene.add(c.mesh);
    const prep = t => { t.minFilter = THREE.LinearMipmapLinearFilter; t.anisotropy = 4; return t; };
    texLoader.load(el.dataset.front, t => {
      c.mat.uniforms.uFront.value = prep(t); c.mat.uniforms.uReady.value = 1;
      c.stage.style.setProperty('--ar', `${t.image.width} / ${t.image.height}`);
      layoutScroll();
    });
    texLoader.load(el.dataset.hover, t => { c.mat.uniforms.uHover.value = prep(t); c.mat.uniforms.uHoverAsp.value = t.image.width / t.image.height; c.hasHover = true; });
    if (fine) {
      el.addEventListener('pointerenter', () => { c.target = 1; });
      el.addEventListener('pointerleave', () => { c.target = 0; });
    } else {
      /* 触屏：第一次点按翻面，翻开后再点才走链接；翻开新卡时旧卡翻回 */
      const flipBack = () => { c.target = 0; };
      el.addEventListener('click', e => {
        if (c.target < 0.5) { e.preventDefault(); if (closeOpen && closeOpen !== flipBack) closeOpen(); c.target = 1; closeOpen = flipBack; }
      });
    }
    return c;
  });


  /* ---- 贴纸：科研与日常器具，点击处迸出一把，页脚持续飘落（风摆 + 旋转 + 下落） ---- */
  const INK = '#10201b';
  const ST = [
    /* 锥形瓶 */ `<path d="M40 12h20v6h-4v22l22 38a6 6 0 0 1-5 10H27a6 6 0 0 1-5-10l22-38V18h-4z" fill="#f6f2e6" stroke="${INK}" stroke-width="4" stroke-linejoin="round"/><path d="M33 62h34l9 16a4 4 0 0 1-3.5 6h-45a4 4 0 0 1-3.5-6z" fill="#00c98b"/><circle cx="44" cy="72" r="3" fill="#f6f2e6"/><circle cx="56" cy="67" r="2" fill="#f6f2e6"/>`,
    /* 试管 */ `<g transform="rotate(20 50 50)"><path d="M38 10h24v6h-3v52a9 9 0 0 1-18 0V16h-3z" fill="#f6f2e6" stroke="${INK}" stroke-width="4" stroke-linejoin="round"/><path d="M43 44h14v24a7 7 0 0 1-14 0z" fill="#ff7a59"/></g>`,
    /* 培养皿 */ `<circle cx="50" cy="50" r="36" fill="#f6f2e6" stroke="${INK}" stroke-width="4"/><circle cx="50" cy="50" r="28" fill="#7ef0c8" stroke="${INK}" stroke-width="2.5"/><circle cx="42" cy="44" r="6" fill="#00c98b"/><circle cx="60" cy="56" r="4.5" fill="#ffd35a"/><circle cx="56" cy="38" r="3" fill="#ff7a59"/><circle cx="40" cy="62" r="3.5" fill="#00c98b"/>`,
    /* 胶囊 */ `<g transform="rotate(-35 50 50)"><rect x="16" y="35" width="68" height="30" rx="15" fill="#f6f2e6" stroke="${INK}" stroke-width="4"/><path d="M50 35H31a15 15 0 0 0 0 30h19z" fill="#ff7a59" stroke="${INK}" stroke-width="4" stroke-linejoin="round"/><path d="M58 42h14" stroke="#fff" stroke-width="3" stroke-linecap="round"/></g>`,
    /* 显微镜 */ `<rect x="22" y="78" width="56" height="10" rx="3" fill="#5aa9ff" stroke="${INK}" stroke-width="4" stroke-linejoin="round"/><path d="M62 78C82 66 82 38 62 28" fill="none" stroke="${INK}" stroke-width="11" stroke-linecap="round"/><path d="M62 78C82 66 82 38 62 28" fill="none" stroke="#5aa9ff" stroke-width="5" stroke-linecap="round"/><g transform="rotate(24 50 34)"><rect x="42" y="12" width="16" height="38" rx="3" fill="#f6f2e6" stroke="${INK}" stroke-width="4"/><rect x="45" y="50" width="10" height="9" fill="${INK}"/></g><rect x="26" y="62" width="34" height="6" rx="2" fill="${INK}"/>`,
    /* 听诊器 */ `<path d="M32 14v22a16 16 0 0 0 32 0V14" fill="none" stroke="${INK}" stroke-width="6" stroke-linecap="round"/><path d="M48 52v14a15 15 0 0 0 30 0v-6" fill="none" stroke="${INK}" stroke-width="6" stroke-linecap="round"/><circle cx="78" cy="52" r="9" fill="#7ef0c8" stroke="${INK}" stroke-width="4"/><circle cx="32" cy="13" r="4" fill="#ff7a59" stroke="${INK}" stroke-width="3"/><circle cx="64" cy="13" r="4" fill="#ff7a59" stroke="${INK}" stroke-width="3"/>`,
    /* 双螺旋 */ `<g stroke="${INK}" stroke-width="3" stroke-linecap="round"><path d="M40 20h20M37 32h26M40 44h20M40 56h20M37 68h26M40 80h20"/></g><path d="M36 10C36 30 64 30 64 50S36 70 36 90" fill="none" stroke="#00c98b" stroke-width="7" stroke-linecap="round"/><path d="M64 10C64 30 36 30 36 50S64 70 64 90" fill="none" stroke="#ff7a59" stroke-width="7" stroke-linecap="round"/>`,
    /* 手冲滤杯 */ `<path d="M20 26h60L62 66H38z" fill="#f6f2e6" stroke="${INK}" stroke-width="4" stroke-linejoin="round"/><path d="M27 30h46l-6 13H33z" fill="#8a5a3c"/><path d="M40 46l4 16M50 46v16M60 46l-4 16" stroke="${INK}" stroke-width="2.5" stroke-linecap="round"/><rect x="34" y="66" width="32" height="7" rx="2" fill="#ffd35a" stroke="${INK}" stroke-width="4" stroke-linejoin="round"/><path d="M78 32c14 0 14 20-3 22" fill="none" stroke="${INK}" stroke-width="5" stroke-linecap="round"/><path d="M50 78c-4 6-4 10 0 10s4-4 0-10z" fill="#8a5a3c" stroke="${INK}" stroke-width="2.5" stroke-linejoin="round"/>`,
    /* 电子秤 */ `<rect x="18" y="28" width="64" height="12" rx="5" fill="#5aa9ff" stroke="${INK}" stroke-width="4"/><rect x="14" y="40" width="72" height="42" rx="9" fill="#f6f2e6" stroke="${INK}" stroke-width="4"/><rect x="27" y="52" width="46" height="18" rx="4" fill="${INK}"/><text x="50" y="66" text-anchor="middle" font-family="ui-monospace,Menlo,monospace" font-weight="700" font-size="13" fill="#7ef0c8">15.0g</text>`,
    /* 背包 */ `<path d="M40 24v-6a10 10 0 0 1 20 0v6" fill="none" stroke="${INK}" stroke-width="5" stroke-linecap="round"/><rect x="26" y="22" width="48" height="64" rx="16" fill="#00c98b" stroke="${INK}" stroke-width="4"/><rect x="35" y="54" width="30" height="22" rx="6" fill="#7ef0c8" stroke="${INK}" stroke-width="3.5"/><path d="M34 40h32" stroke="${INK}" stroke-width="3.5" stroke-linecap="round"/><path d="M50 54v8" stroke="${INK}" stroke-width="3.5" stroke-linecap="round"/>`,
    /* 滴管 */ `<g transform="rotate(38 50 50)"><ellipse cx="50" cy="20" rx="11" ry="13" fill="#ff7a59" stroke="${INK}" stroke-width="4"/><rect x="43" y="30" width="14" height="8" fill="${INK}"/><path d="M45 38h10v30l-5 14-5-14z" fill="#f6f2e6" stroke="${INK}" stroke-width="4" stroke-linejoin="round"/><path d="M47 54h6v14l-3 8-3-8z" fill="#5aa9ff"/></g>`,
    /* 心电卡 */ `<rect x="10" y="26" width="80" height="48" rx="8" fill="#f6f2e6" stroke="${INK}" stroke-width="4"/><path d="M16 52h16l5-14 8 30 8-38 6 22h25" fill="none" stroke="#00c98b" stroke-width="4.5" stroke-linecap="round" stroke-linejoin="round"/>`,
  ];
  const ST_COLS = 4, ST_ROWS = 3, ST_CELL = 256;
  const stCanvas = document.createElement('canvas'); stCanvas.width = ST_COLS * ST_CELL; stCanvas.height = ST_ROWS * ST_CELL;
  const stCtx = stCanvas.getContext('2d');
  const stTex = new THREE.CanvasTexture(stCanvas); stTex.minFilter = THREE.LinearMipmapLinearFilter; stTex.anisotropy = 4;
  let stReady = 0;
  ST.forEach((body, i) => {
    /* 先画一层加粗的白色轮廓当「模切白边」，再画本体 */
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-8 -8 116 116" width="${ST_CELL}" height="${ST_CELL}"><style>.cut *{stroke:#fff!important;stroke-width:15px!important;fill:#fff!important;stroke-linejoin:round;stroke-linecap:round}</style><g class="cut">${body}</g><g>${body}</g></svg>`;
    const im = new Image();
    im.onload = () => { stCtx.drawImage(im, (i % ST_COLS) * ST_CELL, ((i / ST_COLS) | 0) * ST_CELL, ST_CELL, ST_CELL); stTex.needsUpdate = true; stReady++; };
    im.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  });
  const stGeo = new THREE.PlaneGeometry(1, 1);
  const ST_POOL = LITE ? 14 : 22;
  const stickers = Array.from({ length: ST_POOL }, () => {
    const mat = new THREE.ShaderMaterial({
      transparent: true, depthTest: false, depthWrite: false,
      vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: `precision highp float; uniform sampler2D uMap; uniform vec4 uRect; uniform float uAlpha; varying vec2 vUv;
void main(){ vec4 c = texture2D(uMap, uRect.xy + vUv * uRect.zw); if (c.a * uAlpha < 0.01) discard; gl_FragColor = vec4(c.rgb, c.a * uAlpha); }`,
      uniforms: { uMap: { value: stTex }, uRect: { value: new THREE.Vector4(0, 0, 1, 1) }, uAlpha: { value: 1 } },
    });
    const mesh = new THREE.Mesh(stGeo, mat); mesh.visible = false; mesh.renderOrder = 5; mesh.frustumCulled = false; mesh.layers.set(1);
    scene.add(mesh);
    return { mesh, mat, live: false, x: 0, y: 0, vx: 0, vy: 0, rot: 0, rs: 0, size: 80, ph: 0, amp: 0, term: 400, age: 0 };
  });
  let stNext = 0, stLast = -1;
  function spawnSticker(x, y, burst) {
    if (stReady < ST.length) return;
    const s = stickers[stNext]; stNext = (stNext + 1) % ST_POOL;
    let k = (Math.random() * ST.length) | 0; if (k === stLast) k = (k + 1) % ST.length; stLast = k;
    s.mat.uniforms.uRect.value.set((k % ST_COLS) / ST_COLS, 1 - (((k / ST_COLS) | 0) + 1) / ST_ROWS, 1 / ST_COLS, 1 / ST_ROWS);
    s.live = true; s.age = 0; s.x = x; s.y = y;
    s.size = (LITE ? 88 : 150) * (0.8 + Math.random() * 0.5);
    s.vx = burst ? (Math.random() - 0.5) * 520 : (Math.random() - 0.5) * 40;
    s.vy = burst ? -170 - Math.random() * 220 : 30 + Math.random() * 40;
    s.rot = Math.random() * 6.283; s.rs = (Math.random() - 0.5) * 1.6;
    s.ph = Math.random() * 6.283; s.amp = 16 + Math.random() * 44; s.term = 130 + Math.random() * 120;
    s.mesh.visible = true;
  }
  addEventListener('click', e => {
    if (e.target.closest && e.target.closest('a, button, .gcard')) return;
    const n = LITE ? 4 : 6;
    for (let i = 0; i < n; i++) spawnSticker(e.clientX + (Math.random() - 0.5) * 30, e.clientY + (Math.random() - 0.5) * 20, true);
  });
  const footerEl = document.querySelector('footer');
  let rainAcc = 0;
  function tickStickers(dt, k) {
    /* 页脚进入视口后持续飘落 */
    const fr = rectC(footerEl);
    if (fr.top < H * 0.75 && fr.bottom > H * 0.3) {
      rainAcc += dt;
      if (rainAcc > 0.85) { rainAcc = 0; spawnSticker(W * (0.08 + Math.random() * 0.84), -70, false); }
    }
    for (const s of stickers) {
      if (!s.live) continue;
      s.age += dt;
      s.vy = Math.min(s.vy + 380 * dt, s.term);
      s.vx *= Math.exp(-1.6 * dt);
      s.x += (s.vx + Math.sin(time * 1.1 + s.ph) * s.amp) * dt;
      s.y += s.vy * dt; s.rot += s.rs * dt;
      if (s.y > H + 160) { s.live = false; s.mesh.visible = false; continue; }
      const [wx, wy] = toWorld(s.x, s.y);
      s.mesh.position.set(wx, wy, 0); s.mesh.rotation.z = s.rot;
      s.mesh.scale.setScalar(s.size * k * Math.min(1, s.age * 6));
      s.mat.uniforms.uAlpha.value = Math.min(1, s.age * 8);
    }
  }

  /* ---- 3. 流体速度场：只用来扭曲整帧画面 ---- */
  const FLUID = fine;
  const SIM_H = 144;
  let simW = 256, vel, pres, curlRT, divRT;
  const dbl = (w, h) => { const o = { a: rt(w, h, { type: THREE.HalfFloatType }), b: rt(w, h, { type: THREE.HalfFloatType }) };
    o.swap = () => { const t = o.a; o.a = o.b; o.b = t; }; return o; };
  const tx = () => ({ value: new THREE.Vector2(1 / simW, 1 / SIM_H) });
  const SIM_HEAD = `precision highp float; varying vec2 vUv; uniform vec2 uTx;`;
  const curlMat = fsMat(SIM_HEAD + ` uniform sampler2D uV;
void main(){ float L = texture2D(uV, vUv - vec2(uTx.x, 0.)).y, R = texture2D(uV, vUv + vec2(uTx.x, 0.)).y;
  float T = texture2D(uV, vUv + vec2(0., uTx.y)).x, B = texture2D(uV, vUv - vec2(0., uTx.y)).x;
  gl_FragColor = vec4(0.5 * (R - L - T + B), 0., 0., 1.); }`, { uV: { value: null }, uTx: tx() });
  const forceMat = fsMat(SIM_HEAD + ` uniform sampler2D uV; uniform sampler2D uCurl; uniform vec2 uP; uniform vec2 uD; uniform float uAsp;
void main(){
  float L = abs(texture2D(uCurl, vUv - vec2(uTx.x, 0.)).x), R = abs(texture2D(uCurl, vUv + vec2(uTx.x, 0.)).x);
  float T = abs(texture2D(uCurl, vUv + vec2(0., uTx.y)).x), B = abs(texture2D(uCurl, vUv - vec2(0., uTx.y)).x);
  float C = texture2D(uCurl, vUv).x;
  vec2 f = vec2(T - B, R - L); float fl = length(f); f = fl > 1e-4 ? f / fl : vec2(0.);
  f *= 9.0 * C; f.y *= -1.0;
  vec2 v = texture2D(uV, vUv).xy + f * 0.016;
  vec2 d = vUv - uP; d.x *= uAsp;
  v += uD * exp(-dot(d, d) / 0.0035);
  gl_FragColor = vec4(clamp(v, vec2(-1000.), vec2(1000.)), 0., 1.); }`,
    { uV: { value: null }, uCurl: { value: null }, uP: { value: new THREE.Vector2(0.5, 0.5) }, uD: { value: new THREE.Vector2() }, uAsp: { value: 1 }, uTx: tx() });
  const divMat = fsMat(SIM_HEAD + ` uniform sampler2D uV;
void main(){ float L = texture2D(uV, vUv - vec2(uTx.x, 0.)).x, R = texture2D(uV, vUv + vec2(uTx.x, 0.)).x;
  float T = texture2D(uV, vUv + vec2(0., uTx.y)).y, B = texture2D(uV, vUv - vec2(0., uTx.y)).y;
  gl_FragColor = vec4(0.5 * (R - L + T - B), 0., 0., 1.); }`, { uV: { value: null }, uTx: tx() });
  const presMat = fsMat(SIM_HEAD + ` uniform sampler2D uPr; uniform sampler2D uDiv;
void main(){ float L = texture2D(uPr, vUv - vec2(uTx.x, 0.)).x, R = texture2D(uPr, vUv + vec2(uTx.x, 0.)).x;
  float T = texture2D(uPr, vUv + vec2(0., uTx.y)).x, B = texture2D(uPr, vUv - vec2(0., uTx.y)).x;
  gl_FragColor = vec4((L + R + T + B - texture2D(uDiv, vUv).x) * 0.25, 0., 0., 1.); }`, { uPr: { value: null }, uDiv: { value: null }, uTx: tx() });
  const gradMat = fsMat(SIM_HEAD + ` uniform sampler2D uPr; uniform sampler2D uV;
void main(){ float L = texture2D(uPr, vUv - vec2(uTx.x, 0.)).x, R = texture2D(uPr, vUv + vec2(uTx.x, 0.)).x;
  float T = texture2D(uPr, vUv + vec2(0., uTx.y)).x, B = texture2D(uPr, vUv - vec2(0., uTx.y)).x;
  gl_FragColor = vec4(texture2D(uV, vUv).xy - vec2(R - L, T - B), 0., 1.); }`, { uPr: { value: null }, uV: { value: null }, uTx: tx() });
  const advMat = fsMat(SIM_HEAD + ` uniform sampler2D uV;
void main(){ vec2 v = texture2D(uV, vUv).xy; vec2 c = clamp(vUv - v * uTx * 0.016, 0., 1.);
  gl_FragColor = vec4(texture2D(uV, c).xy / (1.0 + 2.8 * 0.016), 0., 1.); }`, { uV: { value: null }, uTx: tx() });
  const simMats = [curlMat, forceMat, divMat, presMat, gradMat, advMat];
  function stepFluid(pu, pv, du, dv) {
    curlMat.uniforms.uV.value = vel.a.texture; pass(curlMat, curlRT);
    forceMat.uniforms.uV.value = vel.a.texture; forceMat.uniforms.uCurl.value = curlRT.texture;
    forceMat.uniforms.uP.value.set(pu, pv); forceMat.uniforms.uD.value.set(du, dv); forceMat.uniforms.uAsp.value = W / H;
    pass(forceMat, vel.b); vel.swap();
    divMat.uniforms.uV.value = vel.a.texture; pass(divMat, divRT);
    presMat.uniforms.uDiv.value = divRT.texture;
    for (let i = 0; i < 10; i++) { presMat.uniforms.uPr.value = pres.a.texture; pass(presMat, pres.b); pres.swap(); }
    gradMat.uniforms.uPr.value = pres.a.texture; gradMat.uniforms.uV.value = vel.a.texture; pass(gradMat, vel.b); vel.swap();
    advMat.uniforms.uV.value = vel.a.texture; pass(advMat, vel.b); vel.swap();
  }

  /* ---- 4. 后处理：半分辨率星芒 + 流体位移合成 ---- */
  const flareMat = fsMat(`
precision highp float; varying vec2 vUv; uniform sampler2D uScene; uniform vec2 uRes;
float luma(vec3 c){ return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
vec3 bright(vec2 uv){ vec3 c = texture2D(uScene, uv).rgb; float m = clamp((luma(c) - 0.93) / 0.07, 0.0, 1.0); m = m * m * (3.0 - 2.0 * m); return c * m * m; }
vec3 streak(vec2 dir){ vec3 acc = vec3(0.0);
  for (int i = 1; i <= 10; i++) { float d = float(i) * 1.6; float w = 1.0 / (1.0 + d * 0.2); w *= w;
    vec3 ramp = mix(vec3(1.0), vec3(0.45, 1.0, 0.85), clamp(d / 16.0, 0.0, 1.0));
    acc += (bright(vUv + dir * d) + bright(vUv - dir * d)) * w * ramp; }
  return acc; }
void main(){ vec2 px = 2.2 / uRes;
  vec3 f = bright(vUv) * 1.2 + streak(vec2(px.x, 0.0)) + streak(vec2(0.0, px.y));
  gl_FragColor = vec4(f * 0.42, 1.0); }`, { uScene: { value: null }, uRes: { value: new THREE.Vector2(1, 1) } });

  const finalMat = fsMat(`
precision highp float; varying vec2 vUv;
uniform sampler2D uScene; uniform sampler2D uFlare; uniform sampler2D uVel; uniform vec2 uTx; uniform float uFlareK;
vec3 spectrum(float x){ return cos((x - vec3(0.0, 0.5, 1.0)) * vec3(0.6, 1.0, 0.5) * 3.14); }
void main(){
  vec2 d = texture2D(uVel, vUv).xy * uTx * 0.034;
  float m = length(d);
  vec3 c;
  c.r = texture2D(uScene, clamp(vUv - d * 0.75, 0.0, 1.0)).r;
  c.g = texture2D(uScene, clamp(vUv - d * 1.00, 0.0, 1.0)).g;
  c.b = texture2D(uScene, clamp(vUv - d * 1.30, 0.0, 1.0)).b;
  c += texture2D(uFlare, clamp(vUv - d, 0.0, 1.0)).rgb * uFlareK;
  c += max(spectrum(sin(m * 60.0) * 0.4 + 0.6), 0.0) * smoothstep(0.004, 0.03, m) * 0.10;
  gl_FragColor = vec4(c, 1.0);
}`, { uScene: { value: null }, uFlare: { value: null }, uVel: { value: null }, uTx: tx(), uFlareK: { value: 1 } });

  /* ---- 渲染目标与尺寸 ---- */
  let bgRT, sceneRT, flareRT;
  let sy = scrollY, stTop = 0, stH = 1, VH = 1, lastW = -1;
  function layoutScroll() {
    if (VIRT) document.body.style.height = scroller.offsetHeight + 'px';
    stTop = statement.offsetTop; stH = statement.offsetHeight; VH = stagePin.offsetHeight || innerHeight;
    measureAnchors();
    measureLetters();
  }
  function resize() {
    const cw = canvas.clientWidth || innerWidth, ch = canvas.clientHeight || innerHeight;
    if (LITE && cw === lastW) { layoutScroll(); return; }      // 手机地址栏收放只改高度：不重建缓冲
    lastW = cw; W = cw; H = ch;
    renderer.setSize(W, H, false);
    PW = renderer.domElement.width; PH = renderer.domElement.height;
    camera.aspect = W / H; camera.updateProjectionMatrix();
    [bgRT, sceneRT, flareRT, curlRT, divRT].forEach(t => t && t.dispose());
    if (vel) { vel.a.dispose(); vel.b.dispose(); pres.a.dispose(); pres.b.dispose(); }
    bgRT = rt(PW * (LITE ? 0.22 : 0.3), PH * (LITE ? 0.22 : 0.3));
    bgMat.uniforms.uRes.value.set(PW, PH); compMat.uniforms.uRes.value.set(PW, PH);
    glassMat.uniforms.uRes.value.set(PW, PH); portalMat.uniforms.uRes.value.set(PW, PH);
    if (LITE) { layoutScroll(); return; }
    sceneRT = new THREE.WebGLRenderTarget(PW, PH, { minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: true, samples: fine ? 4 : 2 });
    flareRT = rt(PW / 2, PH / 2);
    simW = Math.round(SIM_H * W / H);
    vel = dbl(simW, SIM_H); pres = dbl(simW, SIM_H);
    curlRT = rt(simW, SIM_H, { type: THREE.HalfFloatType }); divRT = rt(simW, SIM_H, { type: THREE.HalfFloatType });
    for (const m of [...simMats, finalMat]) m.uniforms.uTx.value.set(1 / simW, 1 / SIM_H);
    bgMat.uniforms.uRes.value.set(PW, PH); compMat.uniforms.uRes.value.set(PW, PH);
    glassMat.uniforms.uRes.value.set(PW, PH); portalMat.uniforms.uRes.value.set(PW, PH);
    flareMat.uniforms.uRes.value.set(PW / 2, PH / 2);
    layoutScroll();
  }
  new ResizeObserver(layoutScroll).observe(scroller);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(layoutScroll);

  /* 页内锚点：虚拟滚动下原生跳转失效，改为手动定位 */
  document.querySelectorAll('a[href^="#"]').forEach(a => a.addEventListener('click', e => {
    const id = a.getAttribute('href').slice(1);
    const el = id ? document.getElementById(id) : null;
    e.preventDefault();
    const top = el ? el.getBoundingClientRect().top + (VIRT ? sy : scrollY) - 70 : 0;
    scrollTo({ top: Math.max(0, top), behavior: VIRT ? 'auto' : 'smooth' });
  }));

  /* ---- 主题色 ---- */
  const dark = true;
  function syncTheme() {
    bgMat.uniforms.uBase.value.setRGB(0.030, 0.050, 0.046); bgMat.uniforms.uGlow.value.setRGB(0.0, 0.42, 0.31);
    compMat.uniforms.uDotCol.value.setRGB(0.62, 0.68, 0.66);
    compMat.uniforms.uAccent.value.setHex(0x00e5a0); portalMat.uniforms.uAccent.value.setHex(0x00e5a0);
    glassMat.uniforms.uDark.value = 1;
    themeDirty = false;
  }

  /* ---- 指针 ---- */
  const ptr = { x: innerWidth / 2, y: innerHeight / 2, sx: 0.5, sy: 0.5, lx: 0, ly: 0, gx: innerWidth / 2, gy: innerHeight / 2, has: false };
  const trail = Array.from({ length: TRAIL_N }, () => ({ x: -9999, y: -9999, s: 0 }));
  let trailI = 0, trailCell = '';
  let lastTouch = -1e9;
  addEventListener('pointerdown', e => { ptr.x = e.clientX; ptr.y = e.clientY; lastTouch = performance.now(); });
  addEventListener('pointermove', e => {
    ptr.x = e.clientX; ptr.y = e.clientY; lastTouch = performance.now();
    if (!ptr.has) { ptr.lx = ptr.x; ptr.ly = ptr.y; ptr.has = true; }
    if (LITE) return;
    if (coordsEl) coordsEl.textContent = String(e.clientX | 0).padStart(4, '0') + ' X ' + String((innerHeight - e.clientY) | 0).padStart(4, '0') + ' Y';
    const key = ((e.clientX / 34) | 0) + ':' + (((H - e.clientY) / 34) | 0);
    if (key !== trailCell) { trailCell = key; trailI = (trailI + 1) % TRAIL_N; trail[trailI] = { x: e.clientX, y: H - e.clientY, s: 1 }; }
  });

  const toWorld = (px, py) => { const k = worldH() / H; return [(px - W / 2) * k, -(py - H / 2) * k]; };
  /* 触屏：锚点位置只在布局变化时量一次（文档坐标），每帧用滚动量换算，避免滚动中强制排版 */
  const anchors = new Map();
  let ceOff = null;
  function measureAnchors() {
    if (!LITE) return;
    for (const el of [glassHome, caretHome, glassEndEl, footerEl]) {
      const r = el.getBoundingClientRect();
      anchors.set(el, { x: r.left + r.width / 2, dy: r.top + r.height / 2 + scrollY, w: r.width, h: r.height });
    }
    ceOff = null;
  }
  const rectC = el => {
    const a = anchors.get(el);
    if (a) { const y = a.dy - sy; return { x: a.x, y, w: a.w, h: a.h, top: y - a.h / 2, bottom: y + a.h / 2 }; }
    const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height, top: r.top, bottom: r.bottom };
  };
  function caretEndRect() {
    if (!LITE) return rectC(shipEndEl);
    if (!ceOff) { const a = shipEndEl.getBoundingClientRect(), b = stagePin.getBoundingClientRect(); ceOff = { x: a.left + a.width / 2 - b.left, y: a.top + a.height / 2 - b.top, h: a.height }; }
    const top = stTop + clamp(sy - stTop, 0, Math.max(1, stH - VH)) - sy;      // sticky 舞台在屏幕上的顶边
    return { x: ceOff.x, y: top + ceOff.y, h: ceOff.h };
  }

  /* ---- 每帧 ---- */
  let lastTitleA = '', lastN = -1, lastPO = '', slow = 0;
  let last = performance.now(), time = 0, started = false, titleShown = false, inPortal = false, lastMeasure = 0, curl = 0;
  function frame(now) {
    const dt = Math.min(Math.max((now - last) / 1000, 0.001), 0.05); last = now; time += dt;
    if (themeDirty) syncTheme();

    /* 滚动 */
    const prevSy = sy;
    if (VIRT) {
      sy = damp(sy, scrollY, 7.5, dt); if (Math.abs(sy - scrollY) < 0.05) sy = scrollY;
      scroller.style.transform = `translate3d(0,${-sy}px,0)`;
    } else sy = scrollY;
    const pinSpan = Math.max(1, stH - VH);
    const q = clamp((sy - stTop) / pinSpan, 0, 1);
    if (VIRT) stagePin.style.transform = `translate3d(0,${clamp(sy - stTop, 0, pinSpan)}px,0)`;
    curl = damp(curl, clamp(Math.abs(sy - prevSy) / dt / 9000, 0, 0.30), 5, dt);
    curlU.value = curl;

    /* 触屏没有鼠标：让「指针」随滚动位置游走（点按后先停留在手指处 1.5 秒） */
    if (LITE && now - lastTouch > 1500) {
      const u = sy / Math.max(1, H);
      ptr.x = W * (0.5 + 0.38 * Math.sin(u * 3.2 + 0.6) + 0.04 * Math.sin(time * 0.5));
      ptr.y = H * (0.48 + 0.30 * Math.cos(u * 2.3) + 0.03 * Math.cos(time * 0.37));
    }

    /* 指针平滑、光源 */
    ptr.sx = damp(ptr.sx, ptr.x / W, 5, dt); ptr.sy = damp(ptr.sy, 1 - ptr.y / H, 5, dt);
    ptr.gx = damp(ptr.gx, ptr.x, 10, dt); ptr.gy = damp(ptr.gy, ptr.y, 10, dt);
    const lightX = (ptr.sx - 0.5) * 14, lightY = (ptr.sy - 0.5) * 9 + 2.5;
    glassMat.uniforms.uLight.value.set(lightX, lightY, 7); lightU.value.set(lightX, lightY, 7);

    /* 首屏大字：字母波浪 + 透字渐变 */
    if (letters.length && ptr.has && sy < H) {
      if (now - lastMeasure > 400) { measureLetters(); lastMeasure = now; }
      const argb = '0,229,160';
      for (const L of letters) {
        const dl = Math.max(Math.hypot(L.x - ptr.gx, L.y - ptr.gy), 1);
        const n = Math.max(0, 1 - dl / 210);
        L.w = damp(L.w, 110 + n * 40, 14, dt); L.g = damp(L.g, 800 + n * 100, 14, dt);
        if (Math.abs(L.w - L.lw) > 0.4 || Math.abs(L.g - L.lg) > 4) {
          L.el.style.fontVariationSettings = `"wdth" ${L.w.toFixed(1)}, "wght" ${Math.round(L.g)}`;
          const dx = (L.x - ptr.gx) / dl, dy = (L.y - ptr.gy) / dl, s = 1.5 + n * 6;
          L.el.style.textShadow = `${(dx * s).toFixed(1)}px ${(dy * s).toFixed(1)}px ${(1 + n * 3).toFixed(1)}px rgba(0,0,0,.5), ${(-dx * 1.4).toFixed(1)}px ${(-dy * 1.4).toFixed(1)}px 1px rgba(${argb},${(0.15 + n * 0.45).toFixed(2)})`;
          L.lw = L.w; L.lg = L.g;
        }
      }
      const tr = heroTitle.getBoundingClientRect();
      heroTitle.style.setProperty('--gx', `${(ptr.gx - tr.left).toFixed(1)}px`);
      heroTitle.style.setProperty('--gy', `${(ptr.gy - tr.top).toFixed(1)}px`);
    }

    /* 宣言区：飞船调头 → 跃迁远去 → 星流 → 飞回停靠 */
    const k = worldH() / H;
    const enter = sstep(stTop - H, stTop - H * 0.1, sy);
    const turn = sstep(0.0, 0.09, q), jump = sstep(0.09, 0.20, q);
    const back = sstep(0.76, 0.89, q), park = sstep(0.87, 1.0, q);
    const starIn = sstep(0.10, 0.20, q), starOut = sstep(0.72, 0.85, q);
    const reveal = starIn * (1 - starOut);
    const home = rectC(caretHome), end = caretEndRect();
    const first = q < 0.5;
    const away = jump * (1 - back);                                   // 1 = 飞到远处
    const restS = (first ? home.h : end.h) * k / ship.size;
    const sc = restS * Math.pow(0.012, away);
    let cx, cy;
    if (first) { cx = mix(home.x, W / 2, enter); cy = mix(home.y, H / 2, enter); }
    else { cx = mix(W / 2, end.x, back); cy = mix(H / 2, end.y, back); }
    const pose = first ? turn : 1 - park;                             // 0 = 停泊姿态，1 = 机尾朝向镜头
    const idle = 1 - pose;
    const [wx, wy] = toWorld(cx, cy);
    ship.group.position.set(wx, wy + Math.sin(time * 1.2) * 0.06 * idle, 0);
    ship.group.scale.setScalar(sc);
    ship.group.rotation.set(mix(0.18 + (ptr.sy - 0.5) * 0.2, -Math.PI / 2 + 0.10, pose), mix(0.55 + Math.sin(time * 0.5) * 0.18 + (ptr.sx - 0.5) * 0.5, 0, pose), mix(-0.5, 0, pose));
    ship.group.visible = away < 0.985 && cy > -260 && cy < H + 260;
    glowU.value = first ? turn * 0.55 + jump * 1.6 : back * (1 - park) * 1.2 + (1 - back) * 1.6;
    const bell = (x, c, w) => Math.exp(-((x - c) / w) * ((x - c) / w));
    portalMat.uniforms.uFlash.value = first ? bell(jump, 0.62, 0.2) * (jump > 0.02 ? 1 : 0) : bell(back, 0.3, 0.2) * 0.6 * (back > 0.02 && back < 0.98 ? 1 : 0);
    portalMat.uniforms.uReveal.value = reveal;
    portalMat.uniforms.uT.value = sstep(0.10, 0.62, q) * (1 - starOut * 0.5);
    portalMat.uniforms.uPhase.value = q * 9.0 + time * 0.22;
    if ((reveal > 0.5) !== inPortal) { inPortal = reveal > 0.5; root.classList.toggle('in-portal', inPortal); }

    const titleA = sstep(0.14, 0.24, q) * (1 - sstep(0.62, 0.72, q));
    const tA = titleA.toFixed(2); if (tA !== lastTitleA) { lastTitleA = tA; stTitle.style.opacity = tA; }
    if (titleA > 0.02 && !titleShown) { titleShown = true; scramble(stTitle, { letterDelay: 34, scrambleTime: 260 }); }
    if (titleA <= 0.02) titleShown = false;
    const typeP = sstep(0.80, 0.97, q), nCh = Math.round(typeP * PROMPT.length);
    if (nCh !== lastN) { lastN = nCh; pline.textContent = PROMPT.slice(0, nCh); ceOff = null; }
    const pO = typeP > 0 ? '1' : '0'; if (pO !== lastPO) { lastPO = pO; promptEl.style.opacity = pO; }

    /* 玻璃字跟随 DOM 锚点 */
    const gh = rectC(glassHome);
    glass.visible = gh.bottom > -80 && gh.top < H + 80;
    if (glass.visible) {
      const [gx, gy] = toWorld(gh.x, gh.y);
      glass.position.set(gx, gy + Math.sin(time * 1.2) * 0.07 + Math.sin(time * 0.6) * 0.03, 0);
      glass.scale.setScalar(Math.min(gh.w * k / 4.5, gh.h * k / 2.7));
      const sp = clamp(sy / H, 0, 1.5);
      glass.rotation.set(-0.12 + (ptr.sy - 0.5) * 0.25 - sp * 0.5, -0.38 + (ptr.sx - 0.5) * 0.45 + sp * 0.9, 0.04);
    }

    /* 页底玻璃字「n+1」：进入视口时从侧倾转正 */
    const ge = rectC(glassEndEl);
    glassEnd.visible = ge.bottom > -80 && ge.top < H + 80;
    if (glassEnd.visible) {
      const [ex, ey] = toWorld(ge.x, ge.y);
      glassEnd.position.set(ex, ey + Math.sin(time * 1.0) * 0.06 + Math.sin(time * 0.5) * 0.03, 0);
      glassEnd.scale.setScalar(Math.min(ge.w * k / 4.5, ge.h * k / 2.7));
      const settle = 1 - sstep(H * 0.15, H * 1.05, ge.y - H / 2);          // 0=刚露头 1=居中
      glassEnd.rotation.set(0.10 + (ptr.sy - 0.5) * 0.22 + (1 - settle) * 0.55, 0.30 + (ptr.sx - 0.5) * 0.40 - (1 - settle) * 0.9, -0.03);
    }

    /* 画廊卡片对齐 DOM 槽 */
    for (const c of cards) {
      const r = c.stage.getBoundingClientRect();
      const vis = r.bottom > -40 && r.top < H + 40 && r.width > 0;
      c.mesh.visible = vis;
      c.hp = damp(c.hp, c.hasHover ? c.target : 0, 6, dt);
      if (!vis) continue;
      const [x, y] = toWorld(r.left + r.width / 2, r.top + r.height / 2);
      c.mesh.position.set(x, y, 0); c.mesh.scale.set(r.width * k, r.height * k, 1);
      c.mat.uniforms.uSize.value.set(r.width, r.height); c.mat.uniforms.uHp.value = c.hp;
    }

    tickStickers(dt, k);

    /* 流体 + 指针拖尾 */
    if (FLUID) {
      const du = (ptr.x - ptr.lx) / W, dv = -(ptr.y - ptr.ly) / H; ptr.lx = ptr.x; ptr.ly = ptr.y;
      stepFluid(ptr.x / W, 1 - ptr.y / H, du * simW / 0.016 * 0.22, dv * SIM_H / 0.016 * 0.22);
    }
    trail.forEach((t, i) => { t.s = Math.max(0, t.s - dt * 1.8); compMat.uniforms.uTrail.value[i].set(t.x * DPR, t.y * DPR); compMat.uniforms.uTrailS.value[i] = t.s; });

    /* 渲染 */
    bgMat.uniforms.uTime.value = time; bgMat.uniforms.uPos.value.set(ptr.sx, ptr.sy);
    pass(bgMat, bgRT);
    compMat.uniforms.uBg.value = bgRT.texture; glassMat.uniforms.uBg.value = bgRT.texture;
    if (LITE) {                                                         // 轻量路径：直接画到屏幕
      /* 持续掉帧就自动降一档分辨率（1.25 → 1 → 0.8） */
      slow = dt > 0.024 ? slow + 1 : Math.max(0, slow - 1);
      if (slow > 40 && DPR > 0.8) { DPR = DPR > 1 ? 1 : 0.8; slow = 0; renderer.setPixelRatio(DPR); compMat.uniforms.uDpr.value = DPR; lastW = -1; resize(); }
      renderer.setRenderTarget(null); renderer.clear();
      pass(compMat, null);
      renderer.clearDepth();
      camera.layers.set(0); renderer.render(scene, camera);
      camera.layers.set(1); renderer.render(scene, camera);
      if (reveal > 0.001 || portalMat.uniforms.uFlash.value > 0.01) pass(portalMat, null);
      renderer.clearDepth();
      camera.layers.set(2); renderer.render(scene, camera);               // 飞船画在星流上面
      started = true; requestAnimationFrame(frame); return;
    }
    renderer.setRenderTarget(sceneRT); renderer.clear();
    pass(compMat, sceneRT);
    renderer.clearDepth();
    camera.layers.set(0); renderer.render(scene, camera);               // 玻璃字
    flareMat.uniforms.uScene.value = sceneRT.texture; pass(flareMat, flareRT);   // 星芒只取玻璃高光，不吃图片里的白
    renderer.setRenderTarget(sceneRT);
    camera.layers.set(1); renderer.render(scene, camera);               // 画廊卡片 + 贴纸
    if (reveal > 0.001 || portalMat.uniforms.uFlash.value > 0.01) pass(portalMat, sceneRT);
    renderer.clearDepth();
    camera.layers.set(2); renderer.render(scene, camera);               // 飞船画在星流上面
    finalMat.uniforms.uScene.value = sceneRT.texture; finalMat.uniforms.uFlare.value = flareRT.texture; finalMat.uniforms.uVel.value = vel.a.texture;
    finalMat.uniforms.uFlareK.value = 1 - reveal;
    pass(finalMat, null);

    started = true;
    requestAnimationFrame(frame);
  }


  if (LITE) {
    /* 手机画廊用普通图片：跟手不掉帧；点按淡入反面，翻开后再点才走链接 */
    document.querySelectorAll('.gcard').forEach(el => {
      const stage = el.querySelector('.stage'), fb = el.querySelector('.fallback');
      const setAr = () => { if (fb.naturalWidth) { stage.style.setProperty('--ar', `${fb.naturalWidth} / ${fb.naturalHeight}`); layoutScroll(); } };
      if (fb.complete) setAr(); else fb.addEventListener('load', setAr);
      const hv = new Image(); hv.className = 'hoverimg'; hv.alt = ''; hv.loading = 'lazy'; hv.src = el.dataset.hover; stage.appendChild(hv);
      const flipBack = () => el.classList.remove('flipped');
      el.addEventListener('click', e => {
        if (!el.classList.contains('flipped')) { e.preventDefault(); if (closeOpen && closeOpen !== flipBack) closeOpen(); el.classList.add('flipped'); closeOpen = flipBack; }
      });
    });
  }
  resize();
  addEventListener('resize', resize);
  window.__site = { get q() { return clamp((sy - stTop) / Math.max(1, stH - VH), 0, 1); }, get stTop() { return stTop; }, get stH() { return stH; } };
  requestAnimationFrame(frame);
}
