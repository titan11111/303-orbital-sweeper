import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { Lensflare, LensflareElement } from 'three/addons/objects/Lensflare.js';

// ================= 基本セットアップ =================
const renderer = new THREE.WebGLRenderer({ canvas: document.getElementById('game'), antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.domElement.style.pointerEvents = 'auto';

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(65, innerWidth / innerHeight, 0.1, 30000);
camera.position.set(0, 4, 14);

const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.7, 0.5, 0.85);
composer.addPass(bloom);
composer.addPass(new OutputPass());

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight); composer.setSize(innerWidth, innerHeight);
});

const rand = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// ================= ノイズ =================
function hash3(x, y, z) {
  let h = x * 374761393 + y * 668265263 + z * 1274126177;
  h = (h ^ (h >>> 13)) * 1274126177;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}
function vnoise(x, y, z) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const xf = x - xi, yf = y - yi, zf = z - zi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf), w = zf * zf * (3 - 2 * zf);
  const l = (a, b, t) => a + (b - a) * t;
  return l(
    l(l(hash3(xi, yi, zi), hash3(xi + 1, yi, zi), u), l(hash3(xi, yi + 1, zi), hash3(xi + 1, yi + 1, zi), u), v),
    l(l(hash3(xi, yi, zi + 1), hash3(xi + 1, yi, zi + 1), u), l(hash3(xi, yi + 1, zi + 1), hash3(xi + 1, yi + 1, zi + 1), u), v), w);
}
function fbm(x, y, z, oct = 5) {
  let s = 0, a = 0.5, f = 1, n = 0;
  for (let i = 0; i < oct; i++) { s += vnoise(x * f, y * f, z * f) * a; n += a; a *= 0.5; f *= 2.03; }
  return s / n;
}

// ================= 宇宙空間 =================
const SUN_DIR = new THREE.Vector3(-0.8, 0.38, -0.46).normalize();
const GAL_N = new THREE.Vector3(0.35, 0.8, 0.48).normalize(); // 天の川の法線

function makeSkyTexture() {
  const W = 1024, H = 512;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const ctx = c.getContext('2d'); const img = ctx.createImageData(W, H); const d = img.data;
  for (let j = 0; j < H; j++) {
    const lat = (j / H) * Math.PI;
    for (let i = 0; i < W; i++) {
      const lon = (i / W) * Math.PI * 2;
      // SphereGeometryのUVに合わせた方向
      const x = -Math.cos(lon) * Math.sin(lat), y = Math.cos(lat), z = Math.sin(lon) * Math.sin(lat);
      const g = x * GAL_N.x + y * GAL_N.y + z * GAL_N.z;
      const band = Math.exp(-g * g / 0.018);
      const n = fbm(x * 3 + 10, y * 3, z * 3, 5);
      const dust = fbm(x * 7, y * 7 + 5, z * 7, 4);
      let b = band * Math.pow(n, 1.6) * 1.4 * (1 - clamp((dust - 0.45) * 2.2, 0, 0.85) * band);
      const core = Math.exp(-g * g / 0.004) * Math.pow(n, 2) * 0.9;
      // 星雲
      const neb = Math.pow(clamp(fbm(x * 2 + 40, y * 2 + 3, z * 2, 5) - 0.5, 0, 1) * 2.4, 2.2);
      const neb2 = Math.pow(clamp(fbm(x * 2.5 - 20, y * 2.5, z * 2.5 + 7, 5) - 0.52, 0, 1) * 2.4, 2.2);
      const k = (j * W + i) * 4;
      d[k] = clamp((b * 70 + core * 90 + neb * 60 + neb2 * 10) , 0, 255);
      d[k + 1] = clamp((b * 66 + core * 75 + neb * 12 + neb2 * 40), 0, 255);
      d[k + 2] = clamp((b * 80 + core * 60 + neb * 70 + neb2 * 80) + 3, 0, 255);
      d[k + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

function buildSky() {
  const sky = new THREE.Mesh(new THREE.SphereGeometry(20000, 64, 32),
    new THREE.MeshBasicMaterial({ map: makeSkyTexture(), side: THREE.BackSide, depthWrite: false, fog: false }));
  sky.renderOrder = -10; scene.add(sky);

  // 星（温度別の色・等級）
  const N = 16000, pos = new Float32Array(N * 3), col = new Float32Array(N * 3), size = new Float32Array(N);
  const tmp = new THREE.Vector3();
  const palette = [[0.62, 0.72, 1], [0.8, 0.86, 1], [1, 1, 1], [1, 0.95, 0.82], [1, 0.82, 0.6], [1, 0.62, 0.45]];
  for (let i = 0; i < N; i++) {
    tmp.set(rand(-1, 1), rand(-1, 1), rand(-1, 1)).normalize();
    if (Math.random() < 0.55) { // 天の川に集中
      const g = tmp.dot(GAL_N); tmp.addScaledVector(GAL_N, -g * (0.85 + Math.random() * 0.15)).normalize();
    }
    tmp.multiplyScalar(18000);
    pos.set([tmp.x, tmp.y, tmp.z], i * 3);
    const p = palette[Math.floor(Math.pow(Math.random(), 0.9) * palette.length)];
    const m = Math.pow(Math.random(), 7);
    const br = 0.35 + m * 1.6;
    col.set([p[0] * br, p[1] * br, p[2] * br], i * 3);
    size[i] = 1.0 + m * 3.6;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setAttribute('size', new THREE.BufferAttribute(size, 1));
  const mat = new THREE.ShaderMaterial({
    uniforms: { pr: { value: renderer.getPixelRatio() } },
    vertexShader: `attribute float size; varying vec3 vC; uniform float pr;
      void main(){ vC=color; vec4 mv=modelViewMatrix*vec4(position,1.); gl_Position=projectionMatrix*mv; gl_PointSize=size*pr; }`,
    fragmentShader: `varying vec3 vC; void main(){ vec2 p=gl_PointCoord-.5; float d=length(p); if(d>.5) discard; float a=max(exp(-d*d*28.)-.03,0.); gl_FragColor=vec4(vC*a*1.6,1.); }`,
    vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending
  });
  const stars = new THREE.Points(g, mat); stars.renderOrder = -9; scene.add(stars);
  return { sky, stars };
}

function makePlanetTextures() {
  const W = 1024, H = 512;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const cc = document.createElement('canvas'); cc.width = W; cc.height = H;
  const ctx = c.getContext('2d'), cctx = cc.getContext('2d');
  const img = ctx.createImageData(W, H), cimg = cctx.createImageData(W, H);
  const d = img.data, cd = cimg.data;
  for (let j = 0; j < H; j++) {
    const lat = (j / H) * Math.PI;
    for (let i = 0; i < W; i++) {
      const lon = (i / W) * Math.PI * 2;
      const x = -Math.cos(lon) * Math.sin(lat), y = Math.cos(lat), z = Math.sin(lon) * Math.sin(lat);
      const h = fbm(x * 2.2 + 3, y * 2.2, z * 2.2, 6);
      const k = (j * W + i) * 4;
      const polar = Math.abs(y);
      let r, gg, b;
      if (h < 0.5) { // 海
        const dep = (0.5 - h) * 4;
        r = 8 + 10 * (1 - dep); gg = 30 + 40 * (1 - dep); b = 70 + 60 * (1 - dep);
      } else { // 陸
        const e = (h - 0.5) * 5; const dry = fbm(x * 5, y * 5, z * 5 + 9, 4);
        const desert = clamp((dry - 0.5) * 3 + (1 - polar) * 0.3 - 0.2, 0, 1);
        r = 40 + 120 * desert + e * 40; gg = 70 + 60 * desert + e * 20; b = 30 + 30 * desert + e * 10;
      }
      if (polar > 0.82 + (h - 0.5) * 0.3) { r = gg = b = 235; }
      d[k] = r; d[k + 1] = gg; d[k + 2] = b; d[k + 3] = 255;
      // 雲
      const cl = fbm(x * 3.5 + 50, y * 7, z * 3.5, 6);
      const ca = clamp((cl - 0.47) * 3.2, 0, 1);
      cd[k] = cd[k + 1] = cd[k + 2] = 255; cd[k + 3] = ca * 255;
    }
  }
  ctx.putImageData(img, 0, 0); cctx.putImageData(cimg, 0, 0);
  const t = new THREE.CanvasTexture(c), ct = new THREE.CanvasTexture(cc);
  t.colorSpace = ct.colorSpace = THREE.SRGBColorSpace;
  return { t, ct };
}

function buildPlanet() {
  const { t, ct } = makePlanetTextures();
  const grp = new THREE.Group();
  const R = 1500;
  const planet = new THREE.Mesh(new THREE.SphereGeometry(R, 96, 64),
    new THREE.MeshStandardMaterial({ map: t, roughness: 0.85, metalness: 0 }));
  const clouds = new THREE.Mesh(new THREE.SphereGeometry(R * 1.012, 96, 64),
    new THREE.MeshStandardMaterial({ map: ct, transparent: true, depthWrite: false, roughness: 1 }));
  const atmo = new THREE.Mesh(new THREE.SphereGeometry(R * 1.06, 96, 64), new THREE.ShaderMaterial({
    uniforms: { sunDir: { value: SUN_DIR } },
    vertexShader: `varying vec3 vN; varying vec3 vW; void main(){ vN=normalize(mat3(modelMatrix)*normal); vec4 w=modelMatrix*vec4(position,1.); vW=w.xyz; gl_Position=projectionMatrix*viewMatrix*w; }`,
    fragmentShader: `uniform vec3 sunDir; varying vec3 vN; varying vec3 vW;
      void main(){ vec3 V=normalize(cameraPosition-vW); float f=pow(1.-abs(dot(V,vN)),3.2);
        float lit=smoothstep(-.35,.5,dot(vN,sunDir)); vec3 c=mix(vec3(.25,.55,1.),vec3(1.,.55,.3),pow(1.-lit,6.)*lit*1.5);
        gl_FragColor=vec4(c*f*lit*1.7, f*lit); }`,
    transparent: true, blending: THREE.AdditiveBlending, side: THREE.BackSide, depthWrite: false
  }));
  grp.add(planet, clouds, atmo);
  grp.position.set(2100, -1500, -4200);
  grp.rotation.set(0.35, -0.8, 0.2);
  scene.add(grp);
  // 月
  const moon = new THREE.Mesh(new THREE.SphereGeometry(160, 48, 32), new THREE.MeshStandardMaterial({ color: 0x9a968f, roughness: 1, flatShading: false }));
  const mp = moon.geometry.attributes.position;
  for (let i = 0; i < mp.count; i++) { const v = new THREE.Vector3().fromBufferAttribute(mp, i).normalize(); const n = fbm(v.x * 6, v.y * 6, v.z * 6, 4); moon.geometry.attributes.position.setXYZ(i, ...v.multiplyScalar(160 * (0.97 + n * 0.06)).toArray()); }
  moon.geometry.computeVertexNormals();
  moon.position.set(-2600, 900, -7000); scene.add(moon);
  return { grp, planet, clouds, moon };
}

function glowTexture(stops, size = 256) {
  const c = document.createElement('canvas'); c.width = c.height = size;
  const ctx = c.getContext('2d'); const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  stops.forEach(s => g.addColorStop(s[0], s[1])); ctx.fillStyle = g; ctx.fillRect(0, 0, size, size);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
const TEX_GLOW = glowTexture([[0, 'rgba(255,255,255,1)'], [0.2, 'rgba(255,255,255,.6)'], [1, 'rgba(255,255,255,0)']], 128);

function buildSun() {
  const sunPos = SUN_DIR.clone().multiplyScalar(9000);
  const sun = new THREE.Sprite(new THREE.SpriteMaterial({
    map: glowTexture([[0, 'rgba(255,255,255,1)'], [0.08, 'rgba(255,250,235,1)'], [0.18, 'rgba(255,220,160,.55)'], [0.45, 'rgba(255,170,90,.12)'], [1, 'rgba(255,140,60,0)']]),
    blending: THREE.AdditiveBlending, depthWrite: false, color: new THREE.Color(3, 2.8, 2.5)
  }));
  sun.scale.set(1500, 1500, 1); sun.position.copy(sunPos); scene.add(sun);
  const light = new THREE.DirectionalLight(0xfff4e6, 3.2); light.position.copy(SUN_DIR.clone().multiplyScalar(100)); scene.add(light);
  const earthShine = new THREE.DirectionalLight(0x3a6fb0, 0.35); earthShine.position.set(1, -0.8, -1); scene.add(earthShine);
  scene.add(new THREE.AmbientLight(0x10131c, 0.6));
  const fill = new THREE.DirectionalLight(0x9fb4d0, 0.9); fill.position.set(0.4, 0.3, 1); scene.add(fill);
  scene.add(new THREE.HemisphereLight(0x1a2233, 0x3a78c8, 1.3)); // 下の惑星からの地球照
  // レンズフレア
  const lf = new Lensflare();
  const hex = glowTexture([[0, 'rgba(255,255,255,.35)'], [0.7, 'rgba(255,255,255,.15)'], [1, 'rgba(255,255,255,0)']], 64);
  const ring = glowTexture([[0, 'rgba(255,255,255,0)'], [0.8, 'rgba(255,255,255,0)'], [0.9, 'rgba(255,255,255,.35)'], [1, 'rgba(255,255,255,0)']], 128);
  lf.addElement(new LensflareElement(TEX_GLOW, 300, 0, new THREE.Color(0.6, 0.55, 0.5)));
  lf.addElement(new LensflareElement(hex, 50, 0.4, new THREE.Color(0.2, 0.35, 0.5)));
  lf.addElement(new LensflareElement(hex, 70, 0.6, new THREE.Color(0.25, 0.4, 0.25)));
  lf.addElement(new LensflareElement(ring, 120, 0.8, new THREE.Color(0.25, 0.15, 0.3)));
  lf.addElement(new LensflareElement(hex, 40, 1.0, new THREE.Color(0.45, 0.28, 0.2)));
  lf.position.copy(sunPos); scene.add(lf);
  return { sun, light };
}

// 速度感を出す微細な宇宙塵（ストリーク）
function buildDust() {
  const N = 700, pos = new Float32Array(N * 6), data = [];
  for (let i = 0; i < N; i++) data.push({ x: rand(-70, 70), y: rand(-45, 45), z: rand(-400, 30) });
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const m = new THREE.LineBasicMaterial({ color: 0x8fb4d8, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false });
  const lines = new THREE.LineSegments(g, m); lines.frustumCulled = false; scene.add(lines);
  return { lines, data, pos };
}

// ================= 生成 =================
const SKY = buildSky();
const PLANET = buildPlanet();
const SUN = buildSun();
const DUST = buildDust();
{ // 環境マップ（金属反射用）
  const pm = new THREE.PMREMGenerator(renderer);
  const envScene = new THREE.Scene();
  envScene.add(SKY.sky.clone());
  const s = new THREE.Mesh(new THREE.SphereGeometry(900, 16, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color(8, 7, 6) }));
  s.position.copy(SUN_DIR).multiplyScalar(15000); envScene.add(s);
  const e = new THREE.Mesh(new THREE.SphereGeometry(6000, 16, 8), new THREE.MeshBasicMaterial({ color: 0x0b1a33 }));
  e.position.set(9000, -7000, -15000); envScene.add(e);
  scene.environment = pm.fromScene(envScene, 0, 0.1, 30000).texture;
  scene.environmentIntensity = 0.9;
}

// ================= サウンド =================
let AC = null, master = null;
let muteOn = localStorage.getItem('tg.303.mute') === '1';
function applyMute() { if (master) master.gain.value = muteOn ? 0 : 0.5; }
function ensureMuteBtn() {
  if ($('muteBtn')) return;
  const b = document.createElement('button');
  b.type = 'button'; b.id = 'muteBtn'; b.setAttribute('aria-label', 'ミュート');
  b.style.cssText = 'pointer-events:auto;position:absolute;top:calc(env(safe-area-inset-top,0px) + 72px);right:calc(env(safe-area-inset-right,0px) + 14px);z-index:6;padding:8px 12px;font-size:18px;background:rgba(10,30,60,.7);border:1px solid rgba(120,200,255,.45);border-radius:4px;color:#cfe8ff;cursor:pointer';
  b.textContent = muteOn ? '🔇' : '🔊';
  b.onclick = () => { initAudio(); if (AC && AC.state === 'suspended') AC.resume(); toggleMute(); };
  $('hud').appendChild(b);
}
function updateMuteBtn() { const b = $('muteBtn'); if (b) b.textContent = muteOn ? '🔇' : '🔊'; }
function toggleMute() { muteOn = !muteOn; localStorage.setItem('tg.303.mute', muteOn ? '1' : '0'); applyMute(); updateMuteBtn(); }
function initAudio() {
  if (AC) return;
  AC = new (window.AudioContext || window.webkitAudioContext)();
  master = AC.createGain(); applyMute(); master.connect(AC.destination);
  // 環境ハム（船内の低音）
  const o = AC.createOscillator(), g = AC.createGain(), f = AC.createBiquadFilter();
  o.type = 'sawtooth'; o.frequency.value = 42; f.type = 'lowpass'; f.frequency.value = 120; g.gain.value = 0.05;
  o.connect(f).connect(g).connect(master); o.start();
}
function noiseBuf(dur) {
  const b = AC.createBuffer(1, AC.sampleRate * dur, AC.sampleRate), d = b.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; return b;
}
let _nb = null;
function sfxLaser() {
  if (!AC) return; const t = AC.currentTime;
  const o = AC.createOscillator(), g = AC.createGain();
  o.type = 'square'; o.frequency.setValueAtTime(1400, t); o.frequency.exponentialRampToValueAtTime(220, t + 0.09);
  g.gain.setValueAtTime(0.045, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.1);
  o.connect(g).connect(master); o.start(t); o.stop(t + 0.11);
}
function sfxBoom(big = 1) {
  if (!AC) return; const t = AC.currentTime; _nb = _nb || noiseBuf(3);
  const s = AC.createBufferSource(), f = AC.createBiquadFilter(), g = AC.createGain();
  s.buffer = _nb; f.type = 'lowpass'; f.frequency.setValueAtTime(1800 * big, t); f.frequency.exponentialRampToValueAtTime(60, t + 0.6 * big + 0.3);
  g.gain.setValueAtTime(0.5 * Math.min(big, 1.6), t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.7 * big + 0.3);
  s.connect(f).connect(g).connect(master); s.start(t); s.stop(t + 3);
  const o = AC.createOscillator(), og = AC.createGain();
  o.type = 'sine'; o.frequency.setValueAtTime(110, t); o.frequency.exponentialRampToValueAtTime(30, t + 0.5 * big);
  og.gain.setValueAtTime(0.35 * Math.min(big, 1.5), t); og.gain.exponentialRampToValueAtTime(0.001, t + 0.6 * big);
  o.connect(og).connect(master); o.start(t); o.stop(t + 2);
}
function sfxCharge(dur) {
  if (!AC) return; const t = AC.currentTime;
  const o = AC.createOscillator(), g = AC.createGain();
  o.type = 'sawtooth'; o.frequency.setValueAtTime(80, t); o.frequency.exponentialRampToValueAtTime(900, t + dur);
  g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.07, t + dur); g.gain.linearRampToValueAtTime(0, t + dur + 0.02);
  o.connect(g).connect(master); o.start(t); o.stop(t + dur + 0.05);
}
function sfxBeam(dur) {
  if (!AC) return; const t = AC.currentTime; _nb = _nb || noiseBuf(3);
  const s = AC.createBufferSource(), f = AC.createBiquadFilter(), g = AC.createGain();
  s.buffer = _nb; s.loop = true; f.type = 'bandpass'; f.frequency.value = 400; f.Q.value = 0.7;
  g.gain.setValueAtTime(0.45, t); g.gain.setValueAtTime(0.45, t + dur - 0.1); g.gain.linearRampToValueAtTime(0, t + dur);
  s.connect(f).connect(g).connect(master); s.start(t); s.stop(t + dur);
  const o = AC.createOscillator(), og = AC.createGain();
  o.type = 'sawtooth'; o.frequency.value = 55; og.gain.setValueAtTime(0.18, t); og.gain.linearRampToValueAtTime(0, t + dur);
  o.connect(og).connect(master); o.start(t); o.stop(t + dur);
}
function sfxAlarm() {
  if (!AC) return; const t = AC.currentTime;
  for (let i = 0; i < 4; i++) {
    const o = AC.createOscillator(), g = AC.createGain(); o.type = 'square';
    o.frequency.setValueAtTime(880, t + i * 0.5); o.frequency.setValueAtTime(660, t + i * 0.5 + 0.25);
    g.gain.setValueAtTime(0.06, t + i * 0.5); g.gain.setValueAtTime(0, t + i * 0.5 + 0.45);
    o.connect(g).connect(master); o.start(t + i * 0.5); o.stop(t + i * 0.5 + 0.5);
  }
}
function sfxPick() {
  if (!AC) return; const t = AC.currentTime;
  [660, 880, 1320].forEach((fq, i) => { const o = AC.createOscillator(), g = AC.createGain(); o.type = 'triangle'; o.frequency.value = fq;
    g.gain.setValueAtTime(0.1, t + i * 0.07); g.gain.exponentialRampToValueAtTime(0.001, t + i * 0.07 + 0.2); o.connect(g).connect(master); o.start(t + i * 0.07); o.stop(t + i * 0.07 + 0.25); });
}
function sfxHit() {
  if (!AC) return; const t = AC.currentTime;
  const o = AC.createOscillator(), g = AC.createGain(); o.type = 'triangle';
  o.frequency.setValueAtTime(300, t); o.frequency.exponentialRampToValueAtTime(900, t + 0.04);
  g.gain.setValueAtTime(0.04, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.06); o.connect(g).connect(master); o.start(t); o.stop(t + 0.07);
}

// ================= パーティクル =================
const PMAX = 5000;
const P = { pos: new Float32Array(PMAX * 3), col: new Float32Array(PMAX * 3), size: new Float32Array(PMAX), vel: new Float32Array(PMAX * 3), life: new Float32Array(PMAX), max: new Float32Array(PMAX), base: new Float32Array(PMAX * 3), bsize: new Float32Array(PMAX), drag: new Float32Array(PMAX), idx: 0 };
const pGeo = new THREE.BufferGeometry();
pGeo.setAttribute('position', new THREE.BufferAttribute(P.pos, 3).setUsage(THREE.DynamicDrawUsage));
pGeo.setAttribute('color', new THREE.BufferAttribute(P.col, 3).setUsage(THREE.DynamicDrawUsage));
pGeo.setAttribute('size', new THREE.BufferAttribute(P.size, 1).setUsage(THREE.DynamicDrawUsage));
const pMat = new THREE.ShaderMaterial({
  uniforms: { pr: { value: renderer.getPixelRatio() * innerHeight * 0.5 } },
  vertexShader: `attribute float size; varying vec3 vC; uniform float pr;
    void main(){ vC=color; vec4 mv=modelViewMatrix*vec4(position,1.); gl_Position=projectionMatrix*mv; gl_PointSize=size*pr/ -mv.z; }`,
  fragmentShader: `varying vec3 vC; void main(){ float d=length(gl_PointCoord-.5); if(d>.5) discard; float a=smoothstep(.5,.0,d); gl_FragColor=vec4(vC*a*a,1.); }`,
  vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending
});
const pPoints = new THREE.Points(pGeo, pMat); pPoints.frustumCulled = false; scene.add(pPoints);
function emit(x, y, z, vx, vy, vz, r, g, b, size, life, drag = 0.98) {
  const i = P.idx; P.idx = (P.idx + 1) % PMAX;
  P.pos[i * 3] = x; P.pos[i * 3 + 1] = y; P.pos[i * 3 + 2] = z;
  P.vel[i * 3] = vx; P.vel[i * 3 + 1] = vy; P.vel[i * 3 + 2] = vz;
  P.base[i * 3] = r; P.base[i * 3 + 1] = g; P.base[i * 3 + 2] = b;
  P.bsize[i] = size; P.life[i] = life; P.max[i] = life; P.drag[i] = drag;
}
function updateParticles(dt, worldSpeed) {
  for (let i = 0; i < PMAX; i++) {
    if (P.life[i] <= 0) { P.size[i] = 0; continue; }
    P.life[i] -= dt;
    const k = P.life[i] / P.max[i], dr = Math.pow(P.drag[i], dt * 60);
    P.vel[i * 3] *= dr; P.vel[i * 3 + 1] *= dr; P.vel[i * 3 + 2] *= dr;
    P.pos[i * 3] += P.vel[i * 3] * dt; P.pos[i * 3 + 1] += P.vel[i * 3 + 1] * dt; P.pos[i * 3 + 2] += (P.vel[i * 3 + 2] + worldSpeed) * dt;
    const heat = Math.max(k, 0);
    P.col[i * 3] = P.base[i * 3] * heat; P.col[i * 3 + 1] = P.base[i * 3 + 1] * heat * heat; P.col[i * 3 + 2] = P.base[i * 3 + 2] * heat * heat * heat;
    P.size[i] = P.bsize[i] * (0.4 + 0.6 * (1 - k * 0.3)) * (k > 0 ? 1 : 0);
  }
  pGeo.attributes.position.needsUpdate = pGeo.attributes.color.needsUpdate = pGeo.attributes.size.needsUpdate = true;
}

// 破片（ポリゴン片）
const shards = [];
const shardGeo = [new THREE.TetrahedronGeometry(1, 0), new THREE.BoxGeometry(1.4, 0.15, 0.9), new THREE.OctahedronGeometry(0.8, 0)];
function spawnShards(pos, mat, n, scale, spd) {
  for (let i = 0; i < n; i++) {
    const m = new THREE.Mesh(shardGeo[i % 3], mat);
    const s = scale * rand(0.3, 1);
    m.scale.setScalar(s); m.position.copy(pos);
    scene.add(m);
    shards.push({ m, v: new THREE.Vector3(rand(-1, 1), rand(-1, 1), rand(-1, 1)).normalize().multiplyScalar(rand(0.3, 1) * spd), r: new THREE.Vector3(rand(-6, 6), rand(-6, 6), rand(-6, 6)), life: rand(1.5, 3), s });
  }
}
// 爆発の閃光ライト
const flashes = [];
for (let i = 0; i < 4; i++) { const l = new THREE.PointLight(0xffaa55, 0, 60, 2); scene.add(l); flashes.push({ l, t: 0, p: 0 }); }
let flashIdx = 0;
function flash(pos, power, range, color = 0xffaa55) {
  const f = flashes[flashIdx++ % flashes.length]; f.l.position.copy(pos); f.l.color.set(color); f.l.distance = range; f.p = power; f.t = 1;
}
const glowSprites = [];
function glowBurst(pos, size, color, life) {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: TEX_GLOW, color, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
  s.position.copy(pos); s.scale.setScalar(size * 0.3); scene.add(s);
  glowSprites.push({ s, life, max: life, size });
}
function explode(pos, size, mat) {
  const n = Math.floor(40 + size * 45);
  for (let i = 0; i < n; i++) {
    const v = new THREE.Vector3(rand(-1, 1), rand(-1, 1), rand(-1, 1)).normalize().multiplyScalar(rand(2, 16) * Math.sqrt(size));
    emit(pos.x, pos.y, pos.z, v.x, v.y, v.z, 2.4, 1.4, 0.7, rand(0.8, 2.2) * size, rand(0.4, 1.2), 0.95);
  }
  for (let i = 0; i < n * 0.6; i++) { // 火花
    const v = new THREE.Vector3(rand(-1, 1), rand(-1, 1), rand(-1, 1)).normalize().multiplyScalar(rand(20, 45) * Math.sqrt(size));
    emit(pos.x, pos.y, pos.z, v.x, v.y, v.z, 3, 2.6, 2, rand(0.25, 0.6), rand(0.3, 0.9), 0.97);
  }
  for (let i = 0; i < n * 0.3; i++) { // 煙（宇宙なのですぐ拡散）
    const v = new THREE.Vector3(rand(-1, 1), rand(-1, 1), rand(-1, 1)).normalize().multiplyScalar(rand(1, 5) * size);
    emit(pos.x, pos.y, pos.z, v.x, v.y, v.z, 0.35, 0.3, 0.28, rand(3, 6) * size, rand(0.8, 1.8), 0.97);
  }
  if (mat) spawnShards(pos, mat, Math.floor(4 + size * 4), 0.4 * size, 10 + size * 3);
  flash(pos, 25 * size, 25 + size * 20);
  glowBurst(pos, 8 * size, new THREE.Color(1.1, 0.65, 0.35), 0.35);
  sfxBoom(Math.min(0.5 + size * 0.35, 2.5));
}

// ================= 宇宙船 =================
function buildShip() {
  const g = new THREE.Group();
  const hull = new THREE.MeshStandardMaterial({ color: 0xdfe3ea, metalness: 0.35, roughness: 0.4, flatShading: true });
  const dark = new THREE.MeshStandardMaterial({ color: 0x4a515e, metalness: 0.4, roughness: 0.5, flatShading: true });
  const accent = new THREE.MeshStandardMaterial({ color: 0xd4442e, metalness: 0.5, roughness: 0.4, flatShading: true });
  const glass = new THREE.MeshStandardMaterial({ color: 0x0a1a2a, metalness: 1, roughness: 0.05, emissive: 0x0a3050, emissiveIntensity: 0.6, flatShading: true });
  // 機首〜胴体
  const body = new THREE.Mesh(new THREE.ConeGeometry(0.9, 5.2, 6), hull); body.rotation.x = -Math.PI / 2; body.position.z = -1.2; g.add(body);
  const rear = new THREE.Mesh(new THREE.CylinderGeometry(0.95, 1.2, 2.2, 6), dark); rear.rotation.x = Math.PI / 2; rear.position.z = 2.2; g.add(rear);
  const cockpit = new THREE.Mesh(new THREE.OctahedronGeometry(0.6, 0), glass); cockpit.scale.set(0.9, 0.6, 2.2); cockpit.position.set(0, 0.55, -0.8); g.add(cockpit);
  // 主翼
  const wingShape = new THREE.Shape(); wingShape.moveTo(0, 0); wingShape.lineTo(4.2, 1.6); wingShape.lineTo(4.4, 2.6); wingShape.lineTo(0, 2.4);
  const wg = new THREE.ExtrudeGeometry(wingShape, { depth: 0.14, bevelEnabled: false });
  [-1, 1].forEach(s => {
    const w = new THREE.Mesh(wg, hull); w.rotation.x = Math.PI / 2; w.scale.x = s; w.position.set(0.6 * s, 0.07, -0.3); w.rotation.z = 0; g.add(w);
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.16, 0.3), accent); stripe.position.set(3.2 * s, 0.02, 1.6); g.add(stripe);
    const gun = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.12, 2.2, 5), dark); gun.rotation.x = Math.PI / 2; gun.position.set(4.3 * s, 0, 0.9); g.add(gun);
    const fin = new THREE.Mesh(new THREE.BoxGeometry(0.1, 1.3, 1.5), hull); fin.position.set(1.1 * s, 0.7, 2.4); fin.rotation.z = -0.35 * s; g.add(fin);
    const pod = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.5, 2.0, 6), dark); pod.rotation.x = Math.PI / 2; pod.position.set(1.35 * s, -0.25, 2.3); g.add(pod);
  });
  // エンジン光
  const engines = [];
  const glowM = new THREE.SpriteMaterial({ map: TEX_GLOW, color: new THREE.Color(0.5, 1.0, 2.2), blending: THREE.AdditiveBlending, depthWrite: false });
  [[0, 0, 3.35, 1.3], [-1.35, -0.25, 3.35, 0.9], [1.35, -0.25, 3.35, 0.9]].forEach(e => {
    const s = new THREE.Sprite(glowM); s.position.set(e[0], e[1], e[2]); s.scale.setScalar(e[3]); s.userData.b = e[3]; g.add(s); engines.push(s);
    const core = new THREE.Mesh(new THREE.CircleGeometry(e[3] * 0.28, 6), new THREE.MeshBasicMaterial({ color: new THREE.Color(1.5, 2.5, 4) })); core.position.set(e[0], e[1], e[2] - 0.05); g.add(core);
  });
  // 翼端灯
  const navL = new THREE.Sprite(new THREE.SpriteMaterial({ map: TEX_GLOW, color: new THREE.Color(3, 0.2, 0.2), blending: THREE.AdditiveBlending, depthWrite: false }));
  const navR = new THREE.Sprite(new THREE.SpriteMaterial({ map: TEX_GLOW, color: new THREE.Color(0.2, 3, 0.4), blending: THREE.AdditiveBlending, depthWrite: false }));
  navL.position.set(-4.4, 0.1, 2.1); navR.position.set(4.4, 0.1, 2.1); navL.scale.setScalar(0.6); navR.scale.setScalar(0.6); g.add(navL, navR);
  g.userData = { engines, navL, navR };
  g.scale.setScalar(0.8);
  scene.add(g);
  return g;
}
const ship = buildShip();

// ================= 宇宙ゴミ =================
const MAT = {
  gold: new THREE.MeshStandardMaterial({ color: 0xd8a640, metalness: 0.7, roughness: 0.35, flatShading: true }),
  white: new THREE.MeshStandardMaterial({ color: 0xd8d8d2, metalness: 0.2, roughness: 0.6, flatShading: true }),
  gray: new THREE.MeshStandardMaterial({ color: 0x8c9098, metalness: 0.5, roughness: 0.5, flatShading: true }),
  rust: new THREE.MeshStandardMaterial({ color: 0x5a4a3e, metalness: 0.5, roughness: 0.8, flatShading: true }),
  panel: new THREE.MeshStandardMaterial({ color: 0x122850, metalness: 0.9, roughness: 0.18, emissive: 0x050c1c, flatShading: true }),
  black: new THREE.MeshStandardMaterial({ color: 0x1b1c1f, metalness: 0.6, roughness: 0.5, flatShading: true }),
  frame: new THREE.MeshStandardMaterial({ color: 0xaaaaaa, metalness: 0.5, roughness: 0.4, flatShading: true }),
};
function jitterGeo(geo, amt) {
  const p = geo.attributes.position; const map = new Map();
  for (let i = 0; i < p.count; i++) {
    const key = `${p.getX(i).toFixed(3)},${p.getY(i).toFixed(3)},${p.getZ(i).toFixed(3)}`;
    if (!map.has(key)) map.set(key, [rand(-amt, amt), rand(-amt, amt), rand(-amt, amt)]);
    const j = map.get(key); p.setXYZ(i, p.getX(i) + j[0], p.getY(i) + j[1], p.getZ(i) + j[2]);
  }
  geo.computeVertexNormals(); return geo;
}
function makeSatellite() {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(2.4, 2.4, 3.2), MAT.gold); g.add(body);
  const top = new THREE.Mesh(new THREE.BoxGeometry(2.5, 0.3, 3.3), MAT.white); top.position.y = 1.3; g.add(top);
  const broken = Math.random() < 0.5;
  [-1, 1].forEach(s => {
    if (broken && s === 1) return;
    const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 1.2, 4), MAT.frame); arm.rotation.z = Math.PI / 2; arm.position.x = 1.8 * s; g.add(arm);
    const pn = new THREE.Group(); pn.position.x = 4.4 * s;
    const pan = new THREE.Mesh(new THREE.BoxGeometry(4.2, 0.06, 2.2), MAT.panel); pn.add(pan);
    for (let k = -1; k <= 1; k++) { const l = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.08, 2.2), MAT.frame); l.position.x = k * 1.4; pn.add(l); }
    pn.rotation.x = rand(-0.6, 0.6); g.add(pn);
  });
  const dish = new THREE.Mesh(new THREE.ConeGeometry(1.1, 0.6, 10, 1, true), MAT.white); dish.position.set(0, -1.6, 0.6); dish.rotation.x = Math.PI; g.add(dish);
  const ant = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 2.5, 3), MAT.frame); ant.position.set(0.8, 2.3, -1); g.add(ant);
  return { g, r: 5.5, hp: 5, score: 300, mat: MAT.gold, size: 2.2 };
}
function makeRocket() {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 1.5, 8, 10), MAT.white); g.add(body);
  const band = new THREE.Mesh(new THREE.CylinderGeometry(1.52, 1.52, 1, 10), MAT.black); band.position.y = 2.4; g.add(band);
  const nz = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 1.3, 1.6, 10, 1, true), MAT.black); nz.position.y = -4.7; g.add(nz);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(1.5, 0.12, 4, 10), MAT.gray); ring.position.y = 4; ring.rotation.x = Math.PI / 2; g.add(ring);
  g.rotation.z = Math.PI / 2;
  const w = new THREE.Group(); w.add(g);
  return { g: w, r: 5, hp: 7, score: 400, mat: MAT.white, size: 2.4 };
}
function makeChunk() {
  const s = rand(0.8, 2.4);
  const mats = [MAT.gray, MAT.rust, MAT.gray, MAT.white];
  const m = new THREE.Mesh(jitterGeo(new THREE.IcosahedronGeometry(s, 0), s * 0.35), mats[Math.floor(Math.random() * mats.length)]);
  m.scale.set(rand(0.6, 1.4), rand(0.6, 1.2), rand(0.6, 1.4));
  const g = new THREE.Group(); g.add(m);
  return { g, r: s * 1.15, hp: s > 1.7 ? 2 : 1, score: 100, mat: m.material, size: s * 0.6 };
}
function makeBrokenPanel() {
  const g = new THREE.Group();
  const p = new THREE.Mesh(jitterGeo(new THREE.BoxGeometry(3.6, 0.07, 2, 3, 1, 2), 0.15), MAT.panel); g.add(p);
  const f = new THREE.Mesh(new THREE.BoxGeometry(3.7, 0.12, 0.08), MAT.frame); f.position.z = 1; g.add(f);
  return { g, r: 2.4, hp: 1, score: 150, mat: MAT.panel, size: 1 };
}
function makeTank() {
  const g = new THREE.Group();
  const t = new THREE.Mesh(new THREE.SphereGeometry(1.6, 10, 8), MAT.gray); t.scale.y = 1.3; g.add(t);
  const b = new THREE.Mesh(new THREE.TorusGeometry(1.62, 0.1, 4, 12), MAT.frame); b.rotation.x = Math.PI / 2; g.add(b);
  const v = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.7, 5), MAT.gold); v.position.y = 2.2; g.add(v);
  return { g, r: 2.3, hp: 3, score: 250, mat: MAT.gray, size: 1.6, volatile: true };
}
function makeStation() { // 大きな宇宙ステーション残骸
  const g = new THREE.Group();
  const core = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 2.2, 9, 8), MAT.white); core.rotation.z = Math.PI / 2; g.add(core);
  const node = new THREE.Mesh(new THREE.BoxGeometry(3.5, 3.5, 3.5), MAT.gray); g.add(node);
  const truss = new THREE.Mesh(new THREE.BoxGeometry(0.6, 16, 0.6), MAT.frame); g.add(truss);
  [-1, 1].forEach(s => { const p = new THREE.Mesh(new THREE.BoxGeometry(5, 0.08, 3), MAT.panel); p.position.y = 7 * s; p.rotation.y = rand(-0.5, 0.5); g.add(p);
    const p2 = new THREE.Mesh(new THREE.BoxGeometry(5, 0.08, 3), MAT.gold); p2.position.set(0, 4 * s, 0); p2.rotation.x = 0.3; g.add(p2); });
  return { g, r: 8.5, hp: 16, score: 1000, mat: MAT.white, size: 3.6 };
}
const makers = [[makeChunk, 40], [makeBrokenPanel, 15], [makeSatellite, 15], [makeRocket, 11], [makeTank, 12], [makeStation, 4]];
const makerTotal = makers.reduce((a, b) => a + b[1], 0);
function pickMaker() { let r = Math.random() * makerTotal; for (const m of makers) { if ((r -= m[1]) < 0) return m[0]; } return makeChunk; }

const debris = [];
function spawnDebris(z) {
  const d = pickMaker()();
  d.g.position.set(rand(-40, 40), rand(-24, 24), z);
  d.g.rotation.set(rand(0, 6), rand(0, 6), rand(0, 6));
  d.spin = new THREE.Vector3(rand(-1, 1), rand(-1, 1), rand(-1, 1)).multiplyScalar(rand(0.2, 1.1) / Math.sqrt(d.r));
  d.vel = new THREE.Vector3(rand(-2, 2), rand(-1.5, 1.5), rand(0, 12));
  d.maxHp = d.hp; d.flash = 0; d.age = 0;
  scene.add(d.g); debris.push(d);
}

// ================= アイテム =================
const pickups = [];
const PICK = {
  repair: { color: new THREE.Color(0.3, 2.2, 0.6), label: 'REPAIR +30' },
  spread: { color: new THREE.Color(0.4, 1.3, 2.8), label: '3WAY LASER' },
  rapid: { color: new THREE.Color(2.6, 1.8, 0.3), label: 'RAPID FIRE' },
};
function spawnPickup(pos) {
  const types = Object.keys(PICK); const type = types[Math.floor(Math.random() * types.length)];
  const c = PICK[type].color;
  const m = new THREE.Mesh(new THREE.OctahedronGeometry(1.1, 0), new THREE.MeshStandardMaterial({ color: 0x111111, emissive: c, emissiveIntensity: 1, metalness: 0.5, roughness: 0.3, flatShading: true }));
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: TEX_GLOW, color: c, blending: THREE.AdditiveBlending, depthWrite: false })); glow.scale.setScalar(5); m.add(glow);
  m.position.copy(pos); scene.add(m); pickups.push({ m, type, t: 0 });
}

// ================= 弾 =================
const bullets = [];
const bulletGeo = new THREE.CylinderGeometry(0.09, 0.09, 4.5, 5); bulletGeo.rotateX(Math.PI / 2);
const bulletMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.2, 3.5, 3.0) });
const bulletGlowMat = new THREE.SpriteMaterial({ map: TEX_GLOW, color: new THREE.Color(0.3, 1.5, 1.3), blending: THREE.AdditiveBlending, depthWrite: false });
function fireBullet(x, y, z, vx) {
  const m = new THREE.Mesh(bulletGeo, bulletMat);
  const s = new THREE.Sprite(bulletGlowMat); s.scale.set(1.0, 1.0, 1); m.add(s);
  m.position.set(x, y, z); scene.add(m); bullets.push({ m, vx, life: 1.6 });
}

// ================= 巨大UFO =================
const UFO_R = 135;
function buildUFO() {
  const g = new THREE.Group(); const R = UFO_R;
  const hullM = new THREE.MeshStandardMaterial({ color: 0x6c7482, metalness: 0.55, roughness: 0.45, flatShading: true });
  const hull2 = new THREE.MeshStandardMaterial({ color: 0x8a92a0, metalness: 0.5, roughness: 0.4, flatShading: true });
  const pts = [[0, -16], [R * .18, -17], [R * .3, -13], [R * .55, -9], [R * .85, -4], [R, 0], [R * .97, 4], [R * .75, 9], [R * .5, 13], [R * .3, 18], [0, 20]].map(p => new THREE.Vector2(p[0], p[1]));
  const body = new THREE.Mesh(new THREE.LatheGeometry(pts, 28), hullM); g.add(body);
  const rim = new THREE.Mesh(new THREE.TorusGeometry(R * 0.99, 3.4, 5, 56), hull2); rim.rotation.x = Math.PI / 2; g.add(rim);
  // グリーブル
  for (let i = 0; i < 40; i++) {
    const a = (i / 40) * Math.PI * 2, rr = rand(R * 0.35, R * 0.8);
    const b = new THREE.Mesh(new THREE.BoxGeometry(rand(4, 12), rand(1.5, 4), rand(4, 10)), Math.random() < 0.5 ? hullM : hull2);
    b.position.set(Math.cos(a) * rr, 12 - (rr / R) * 10, Math.sin(a) * rr); b.rotation.y = -a; g.add(b);
  }
  // リムのライト
  const lights = new THREE.Group();
  const lmA = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.4, 2.8, 2.2) }), lmB = new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 0.5, 1.2) });
  for (let i = 0; i < 48; i++) { const a = (i / 48) * Math.PI * 2; const l = new THREE.Mesh(new THREE.BoxGeometry(3.5, 2, 3.5), i % 2 ? lmA : lmB); l.position.set(Math.cos(a) * (R + 2.5), 0, Math.sin(a) * (R + 2.5)); l.rotation.y = -a; lights.add(l); }
  g.add(lights);
  // 下部リング
  const ringM = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.5, 0.3, 0.8) });
  const ring = new THREE.Mesh(new THREE.TorusGeometry(R * 0.42, 1.6, 4, 40), ringM); ring.rotation.x = Math.PI / 2; ring.position.y = -11.5; g.add(ring);
  // ドーム
  const dome = new THREE.Mesh(new THREE.SphereGeometry(R * 0.26, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x0b2a2a, metalness: 1, roughness: 0.05, emissive: new THREE.Color(0.05, 0.5, 0.4), flatShading: true, transparent: true, opacity: 0.9 }));
  dome.position.y = 18; g.add(dome);
  // 砲口（コア）
  const coreM = new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 0.4, 1.5) });
  const core = new THREE.Mesh(new THREE.IcosahedronGeometry(13, 1), coreM); core.position.y = -17; core.scale.y = 0.6; g.add(core);
  const coreGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: TEX_GLOW, color: new THREE.Color(2.5, 0.4, 1.4), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
  coreGlow.position.y = -20; coreGlow.scale.setScalar(60); g.add(coreGlow);
  const hitMat = hullM;
  g.visible = false; scene.add(g);
  return { g, lights, core, coreM, coreGlow, ring, hullM, hitMat };
}
const UFO = buildUFO();
const ufo = { active: false, state: 'none', t: 0, hp: 0, maxHp: 260, atkTimer: 0, hitFlash: 0, pos: new THREE.Vector3(), dieT: 0 };

// 光線
const beamVS = `varying vec3 vN; varying vec3 vV; varying vec2 vUv; void main(){ vUv=uv; vec4 w=modelMatrix*vec4(position,1.); vN=normalize(mat3(modelMatrix)*normal); vV=normalize(cameraPosition-w.xyz); gl_Position=projectionMatrix*viewMatrix*w; }`;
const beamFS = `uniform float time; uniform float intensity; uniform vec3 col; varying vec3 vN; varying vec3 vV; varying vec2 vUv;
  void main(){ float f=abs(dot(vN,vV)); float core=pow(f,4.); float edge=pow(f,1.2);
   float n=sin(vUv.y*260.-time*60.)*.5+.5; n=mix(.75,1.,n);
   vec3 c=mix(col*edge, vec3(1.,.95,1.)*3., core)*n*intensity; gl_FragColor=vec4(c,1.); }`;
const beams = [];
for (let i = 0; i < 3; i++) {
  const mat = new THREE.ShaderMaterial({ uniforms: { time: { value: 0 }, intensity: { value: 1 }, col: { value: new THREE.Color(2.4, 0.3, 1.4) } }, vertexShader: beamVS, fragmentShader: beamFS, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 20, 1, true), mat);
  const outerMat = mat.clone(); outerMat.uniforms = { time: mat.uniforms.time, intensity: { value: 0.18 }, col: { value: new THREE.Color(1.6, 0.2, 1.0) } };
  const outer = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 20, 1, true), outerMat);
  const tele = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 1, 4, 1, true), new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 0.1, 0.2), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
  const impact = new THREE.Sprite(new THREE.SpriteMaterial({ map: TEX_GLOW, color: new THREE.Color(3, 0.8, 2), blending: THREE.AdditiveBlending, depthWrite: false }));
  beam.visible = outer.visible = tele.visible = impact.visible = false;
  beam.frustumCulled = outer.frustumCulled = tele.frustumCulled = false;
  scene.add(beam, outer, tele, impact);
  beams.push({ beam, outer, tele, impact, active: false, phase: '', t: 0, target: new THREE.Vector3(), offset: new THREE.Vector3(), aimDur: 1.2, fireDur: 1, radius: 3.4, sweep: 0, hit: false, dmg: 30 });
}
const _Y = new THREE.Vector3(0, 1, 0);
function placeCyl(mesh, a, b, radius, extend = 0) {
  const dir = new THREE.Vector3().subVectors(b, a); const len = dir.length(); dir.normalize();
  const end = b.clone().addScaledVector(dir, extend);
  mesh.position.addVectors(a, end).multiplyScalar(0.5);
  mesh.quaternion.setFromUnitVectors(_Y, dir);
  mesh.scale.set(radius, len + extend, radius);
}
function emitterPos() { return UFO.core.getWorldPosition(new THREE.Vector3()); }

// ================= ゲーム状態 =================
const G = { running: false, score: 0, hull: 100, kills: 0, dist: 0, time: 0, speed: 60, spawnT: 0, fireT: 0, inv: 0, weapon: 'normal', weaponT: 0, shake: 0, nextUfo: 35, over: false };
let booted = false;
const player = { pos: new THREE.Vector3(0, 0, 0), vel: new THREE.Vector3(), target: new THREE.Vector3() };
let hi = +(localStorage.getItem('tg.303.hi') || localStorage.getItem('orbital_hi') || 0);
const $ = id => document.getElementById(id);
$('hi').textContent = hi.toLocaleString();

// 入力
const keys = {}; let mouseDown = false, touching = false, useMouse = false;
let touchLast = null;
addEventListener('keydown', e => { keys[e.code] = true; if (e.code === 'Space') e.preventDefault(); });
addEventListener('keyup', e => { keys[e.code] = false; });
const BX = 24, BY = 14;
renderer.domElement.addEventListener('mousemove', e => {
  useMouse = true;
  player.target.x = ((e.clientX / innerWidth) * 2 - 1) * BX;
  player.target.y = -((e.clientY / innerHeight) * 2 - 1) * BY;
});
renderer.domElement.addEventListener('mousedown', () => { mouseDown = true; });
addEventListener('mouseup', () => { mouseDown = false; });
renderer.domElement.addEventListener('click', () => { if (booted && !G.running && !G.over) startGame(); });
renderer.domElement.addEventListener('touchstart', e => { e.preventDefault(); touching = true; useMouse = false; touchLast = [e.touches[0].clientX, e.touches[0].clientY]; }, { passive: false });
renderer.domElement.addEventListener('touchmove', e => {
  e.preventDefault(); const t = e.touches[0];
  if (touchLast) { const k = 2.6 * BX * 2 / innerWidth; player.target.x += (t.clientX - touchLast[0]) * k; player.target.y -= (t.clientY - touchLast[1]) * k; }
  touchLast = [t.clientX, t.clientY];
}, { passive: false });
renderer.domElement.addEventListener('touchend', e => { if (e.touches.length === 0) { touching = false; touchLast = null; } });

function popup(pos3, text, color = '#fff') {
  const v = pos3.clone().project(camera);
  if (v.z > 1) return;
  const el = document.createElement('div'); el.className = 'pop'; el.textContent = text; el.style.color = color;
  el.style.left = ((v.x + 1) / 2 * innerWidth) + 'px'; el.style.top = ((1 - v.y) / 2 * innerHeight) + 'px';
  $('popups').appendChild(el); setTimeout(() => el.remove(), 900);
}
function addScore(n) { G.score += n; $('score').textContent = G.score.toLocaleString(); }
function damage(n) {
  if (G.inv > 0 || G.over) return;
  G.hull = Math.max(0, G.hull - n); G.inv = 1.0; G.shake = Math.max(G.shake, 1.2);
  $('dmg').style.opacity = 1; setTimeout(() => $('dmg').style.opacity = 0, 180);
  sfxBoom(0.6); updateHull();
  for (let i = 0; i < 40; i++) emit(player.pos.x, player.pos.y, player.pos.z, rand(-15, 15), rand(-15, 15), rand(-15, 15), 3, 2, 1, rand(0.3, 0.8), rand(0.3, 0.7));
  if (G.hull <= 0) gameOver();
}
function updateHull() {
  $('hullFill').style.width = G.hull + '%'; $('hullTxt').textContent = Math.round(G.hull) + '%';
  $('hullFill').classList.toggle('low', G.hull < 35);
}

function clearAll() {
  debris.forEach(d => scene.remove(d.g)); debris.length = 0;
  bullets.forEach(b => scene.remove(b.m)); bullets.length = 0;
  pickups.forEach(p => scene.remove(p.m)); pickups.length = 0;
  shards.forEach(s => scene.remove(s.m)); shards.length = 0;
  beams.forEach(b => { b.active = false; b.beam.visible = b.outer.visible = b.tele.visible = b.impact.visible = false; });
  ufo.active = false; ufo.state = 'none'; UFO.g.visible = false; $('bossBox').style.display = 'none'; $('warn').style.display = 'none';
}
function startGame() {
  if (!booted) return;
  if (!looping) { looping = true; loop(); }
  initAudio(); if (AC.state === 'suspended') AC.resume();
  clearAll();
  Object.assign(G, { running: true, score: 0, hull: 100, kills: 0, dist: 0, time: 0, speed: 60, spawnT: 0, fireT: 0, inv: 1.5, weapon: 'normal', weaponT: 0, shake: 0, nextUfo: 30, over: false });
  player.pos.set(0, 0, 0); player.target.set(0, 0, 0); player.vel.set(0, 0, 0);
  ship.visible = true; addScore(0); updateHull(); $('kills').textContent = 0; $('wpn').textContent = 'PULSE LASER';
  $('start').style.display = 'none'; $('over').style.display = 'none'; $('hud').style.display = 'block';
  ensureMuteBtn(); updateMuteBtn();
  for (let i = 0; i < 14; i++) spawnDebris(rand(-550, -120));
}
function gameOver() {
  G.over = true; ship.visible = false;
  explode(player.pos.clone(), 3, MAT.gray); G.shake = 2.5;
  if (G.score > hi) { hi = G.score; localStorage.setItem('tg.303.hi', hi); $('hi').textContent = hi.toLocaleString(); }
  setTimeout(() => { G.running = false; $('finalScore').innerHTML = `SCORE ${G.score.toLocaleString()}<br><span style="font-size:15px;color:#9bd">破壊デブリ ${G.kills} 基 ／ HI-SCORE ${hi.toLocaleString()}</span>`; $('over').style.display = 'flex'; }, 2000);
}
window.__ogStart = () => { initAudio(); if (AC && AC.state === 'suspended') AC.resume(); startGame(); };
document.addEventListener('contextmenu', e => e.preventDefault());
document.addEventListener('dblclick', e => e.preventDefault());
let lastTouchEnd = 0;
document.addEventListener('touchend', e => {
  const now = Date.now();
  if (now - lastTouchEnd <= 300) e.preventDefault();
  lastTouchEnd = now;
}, { passive: false });

// ================= UFO制御 =================
function summonUFO() {
  ufo.active = true; ufo.state = 'arrive'; ufo.t = 0; ufo.hp = ufo.maxHp = 220 + Math.floor(G.time / 60) * 80; ufo.atkTimer = 2.5;
  UFO.g.visible = true; UFO.g.position.set(0, 60, -3200); UFO.g.rotation.set(-0.42, 0, 0);
  $('warn').style.display = 'block'; sfxAlarm();
  setTimeout(() => { $('warn').style.display = 'none'; }, 2600);
  $('bossBox').style.display = 'block'; $('bossFill').style.width = '100%';
}
function startAttack() {
  const r = Math.random();
  const p = player.pos;
  const setB = (b, off, aim, fire, sweep, radius, dmg) => {
    Object.assign(b, { active: true, phase: 'aim', t: 0, aimDur: aim, fireDur: fire, sweep, radius, dmg, hit: false });
    b.offset.copy(off); b.target.set(p.x + off.x, p.y + off.y, 0);
  };
  if (r < 0.45) { // 追尾ロックオン
    setB(beams[0], new THREE.Vector3(), 1.3, 1.0, 0, 4.2, 30); sfxCharge(1.3);
  } else if (r < 0.75) { // 横薙ぎ
    const dir = Math.random() < 0.5 ? 1 : -1;
    setB(beams[0], new THREE.Vector3(-dir * 30 - p.x, 0, 0), 1.1, 1.6, dir * 42, 4.5, 28); sfxCharge(1.1);
  } else { // 3連ビーム
    setB(beams[0], new THREE.Vector3(0, 0, 0), 1.4, 0.8, 0, 3.4, 25);
    setB(beams[1], new THREE.Vector3(-11, rand(-4, 4), 0), 1.4, 0.8, 0, 3.4, 25);
    setB(beams[2], new THREE.Vector3(11, rand(-4, 4), 0), 1.4, 0.8, 0, 3.4, 25);
    sfxCharge(1.4);
  }
}
function updateUFO(dt, time) {
  if (!ufo.active) return;
  ufo.t += dt;
  const g = UFO.g;
  UFO.lights.rotation.y += dt * 0.6;
  g.children[0].rotation.y += dt * 0.05;
  const charging = beams.some(b => b.active && b.phase === 'aim');
  const firing = beams.some(b => b.active && b.phase === 'fire');
  const pulse = charging ? 1 + Math.sin(time * 30) * 0.3 + 1 : firing ? 3 : 0.8 + Math.sin(time * 3) * 0.2;
  UFO.coreGlow.scale.setScalar(40 * Math.min(pulse, 2)); UFO.coreM.color.setRGB(2 * pulse, 0.3 * pulse, pulse);
  if (ufo.hitFlash > 0) { ufo.hitFlash -= dt; UFO.hullM.emissive.setRGB(ufo.hitFlash * 2, ufo.hitFlash * 0.6, ufo.hitFlash * 0.3); } else UFO.hullM.emissive.setRGB(0, 0, 0);

  if (ufo.state === 'arrive') {
    const k = Math.min(ufo.t / 4.5, 1); const e = 1 - Math.pow(1 - k, 3);
    g.position.z = -3200 + (3200 - 470) * e; g.position.y = 60 - 20 * e;
    if (k >= 1) { ufo.state = 'fight'; ufo.t = 0; }
  } else if (ufo.state === 'fight') {
    g.position.x = Math.sin(ufo.t * 0.35) * 45; g.position.y = 40 + Math.sin(ufo.t * 0.6) * 8;
    g.rotation.z = -Math.cos(ufo.t * 0.35) * 0.08;
    if (!beams.some(b => b.active)) { ufo.atkTimer -= dt; if (ufo.atkTimer <= 0) { startAttack(); ufo.atkTimer = Math.max(1.2, rand(2.2, 3.4) - G.time / 300); } }
    if (ufo.t > 50) { ufo.state = 'leave'; ufo.t = 0; }
  } else if (ufo.state === 'leave') {
    g.position.z -= dt * 600 * Math.min(ufo.t, 3); g.position.y += dt * 60;
    if (ufo.t > 5) { ufo.active = false; g.visible = false; $('bossBox').style.display = 'none'; G.nextUfo = G.time + 40; }
  } else if (ufo.state === 'dying') {
    ufo.dieT += dt; g.position.y -= dt * 8; g.rotation.z += dt * 0.15; g.rotation.x -= dt * 0.05;
    if (Math.random() < dt * 14) {
      const p = g.position.clone().add(new THREE.Vector3(rand(-1, 1) * UFO_R, rand(-20, 20), rand(-1, 1) * UFO_R * 0.5));
      explode(p, rand(3, 6), UFO.hullM); G.shake = Math.max(G.shake, 0.6);
    }
    if (ufo.dieT > 3.2) {
      const p = g.position.clone();
      for (let i = 0; i < 6; i++) explode(p.clone().add(new THREE.Vector3(rand(-60, 60), rand(-15, 15), rand(-30, 30))), 8, UFO.hullM);
      glowBurst(p, 900, new THREE.Color(2, 1.5, 1.8), 1.2); flash(p, 3000, 2000, 0xffccff);
      G.shake = 3; ufo.active = false; g.visible = false; $('bossBox').style.display = 'none';
      addScore(10000); popup(p, 'MOTHERSHIP DESTROYED +10000', '#ff9ad0');
      for (let i = 0; i < 3; i++) spawnPickup(new THREE.Vector3(rand(-15, 15), rand(-8, 8), -150 - i * 30));
      G.nextUfo = G.time + 45;
    }
  }
  // ビーム
  beams.forEach(b => {
    if (!b.active) return;
    b.t += dt; const E = emitterPos();
    b.beam.material.uniforms.time.value = time;
    if (ufo.state !== 'fight' && b.phase === 'aim') { b.active = false; b.tele.visible = false; return; }
    if (b.phase === 'aim') {
      if (b.t < b.aimDur - 0.35 && b.sweep === 0) {
        const tx = player.pos.x + b.offset.x, ty = player.pos.y + b.offset.y;
        b.target.x += (tx - b.target.x) * Math.min(1, dt * 6); b.target.y += (ty - b.target.y) * Math.min(1, dt * 6);
      }
      b.tele.visible = true; placeCyl(b.tele, E, b.target, b.t > b.aimDur - 0.35 ? 2.2 : 1, 6);
      b.tele.material.opacity = (Math.sin(b.t * 40) * 0.5 + 0.5) * 0.8 + 0.2;
      if (b.t >= b.aimDur) { b.phase = 'fire'; b.t = 0; b.tele.visible = false; b.beam.visible = b.outer.visible = b.impact.visible = true; if (b === beams[0]) sfxBeam(b.fireDur); G.shake = Math.max(G.shake, 0.5); }
    } else {
      b.target.x += b.sweep * dt;
      const k = b.t / b.fireDur;
      const w = b.radius * (k < 0.08 ? k / 0.08 : k > 0.85 ? (1 - k) / 0.15 : 1) * (1 + Math.sin(time * 70) * 0.06);
      placeCyl(b.beam, E, b.target, w * 0.55, 6); placeCyl(b.outer, E, b.target, w * 1.1, 6);
      b.impact.position.copy(b.target); b.impact.scale.setScalar(w * 2);
      G.shake = Math.max(G.shake, 0.25);
      // 当たり判定（線分と点の距離）
      const dir = new THREE.Vector3().subVectors(b.target, E).normalize();
      const ap = new THREE.Vector3().subVectors(player.pos, E);
      const d = ap.sub(dir.multiplyScalar(ap.dot(dir))).length();
      if (!b.hit && d < b.radius * 0.8 + 1.2 && k > 0.06 && k < 0.9 && !G.over) { b.hit = true; damage(b.dmg); }
      // ビーム周りのデブリも蒸発
      for (let i = debris.length - 1; i >= 0; i--) {
        const dd = debris[i]; const ap2 = new THREE.Vector3().subVectors(dd.g.position, E); const dir2 = new THREE.Vector3().subVectors(b.target, E).normalize();
        const t2 = ap2.dot(dir2); if (t2 < 0) continue;
        if (ap2.sub(dir2.multiplyScalar(t2)).length() < b.radius + dd.r * 0.6) { explode(dd.g.position.clone(), dd.size, dd.mat); scene.remove(dd.g); debris.splice(i, 1); }
      }
      for (let i = 0; i < 2; i++) emit(b.target.x, b.target.y, b.target.z - 4, rand(-20, 20), rand(-20, 20), rand(-5, 10), 1.2, 0.4, 1.0, rand(0.3, 0.7), rand(0.2, 0.4));
      if (b.t >= b.fireDur) { b.active = false; b.beam.visible = b.outer.visible = b.impact.visible = false; }
    }
  });
}

// ================= メインループ =================
const clock = new THREE.Clock();
const tmpV = new THREE.Vector3();
let camShake = new THREE.Vector3();
let looping = false;
function loop() {
  requestAnimationFrame(loop);
  const dt = Math.min(clock.getDelta(), 0.05); const time = clock.elapsedTime;

  // 背景の緩やかな動き
  PLANET.planet.rotation.y += dt * 0.004; PLANET.clouds.rotation.y += dt * 0.0055;
  SKY.sky.rotation.y += dt * 0.0006; SKY.stars.rotation.y += dt * 0.0006;

  const worldSpeed = G.running ? G.speed : 25;

  if (G.running) {
    G.time += dt; G.speed = 60 + Math.min(G.time * 0.35, 60);
    G.dist += G.speed * dt * 0.12; $('dist').textContent = Math.floor(G.dist).toLocaleString();

    // 移動
    if (!G.over) {
      const ks = 42 * dt;
      if (keys.ArrowLeft || keys.KeyA) player.target.x -= ks;
      if (keys.ArrowRight || keys.KeyD) player.target.x += ks;
      if (keys.ArrowUp || keys.KeyW) player.target.y += ks;
      if (keys.ArrowDown || keys.KeyS) player.target.y -= ks;
      player.target.x = clamp(player.target.x, -BX, BX); player.target.y = clamp(player.target.y, -BY, BY);
      const prev = player.pos.clone();
      player.pos.x += (player.target.x - player.pos.x) * Math.min(1, dt * 7);
      player.pos.y += (player.target.y - player.pos.y) * Math.min(1, dt * 7);
      player.vel.subVectors(player.pos, prev).divideScalar(dt || 1);
    }
    ship.position.copy(player.pos);
    ship.rotation.z = clamp(-player.vel.x * 0.035, -0.9, 0.9);
    ship.rotation.x = clamp(player.vel.y * 0.02, -0.4, 0.4);
    ship.rotation.y = clamp(-player.vel.x * 0.008, -0.2, 0.2);
    if (G.inv > 0) { G.inv -= dt; ship.visible = !G.over && (Math.floor(G.inv * 20) % 2 === 0); } else if (!G.over) ship.visible = true;

    // エンジン炎
    ship.userData.engines.forEach(s => s.scale.setScalar(s.userData.b * (0.9 + Math.random() * 0.25)));
    ship.userData.navL.visible = ship.userData.navR.visible = Math.sin(time * 6) > 0;
    if (!G.over) for (let i = 0; i < 3; i++) {
      const ox = [0, -1.08, 1.08][i], oy = [0, -0.2, -0.2][i];
      emit(player.pos.x + ox, player.pos.y + oy, player.pos.z + 2.8, rand(-0.6, 0.6), rand(-0.6, 0.6), rand(15, 25), 0.35, 0.8, 1.8, i ? 0.6 : 0.9, rand(0.1, 0.2), 0.9);
    }

    // 射撃
    G.fireT -= dt;
    const wantFire = mouseDown || touching || keys.Space;
    if (wantFire && G.fireT <= 0 && !G.over) {
      const rate = G.weapon === 'rapid' ? 0.055 : 0.11;
      G.fireT = rate;
      const s = 0.8;
      fireBullet(player.pos.x - 3.44 * s, player.pos.y, player.pos.z - 0.5, 0);
      fireBullet(player.pos.x + 3.44 * s, player.pos.y, player.pos.z - 0.5, 0);
      if (G.weapon === 'spread') { fireBullet(player.pos.x, player.pos.y, -2, -40); fireBullet(player.pos.x, player.pos.y, -2, 40); }
      sfxLaser();
      flash(tmpV.set(player.pos.x, player.pos.y, -6), 0.6, 10, 0x66ffee);
    }
    if (G.weaponT > 0) { G.weaponT -= dt; if (G.weaponT <= 0) { G.weapon = 'normal'; $('wpn').textContent = 'PULSE LASER'; } else $('wpn').textContent = (G.weapon === 'rapid' ? 'RAPID FIRE ' : '3WAY LASER ') + G.weaponT.toFixed(1) + 's'; }

    // デブリ生成
    G.spawnT -= dt;
    const interval = Math.max(0.22, 0.9 - G.time * 0.004);
    if (G.spawnT <= 0) { G.spawnT = interval * rand(0.6, 1.4); spawnDebris(ufo.active && ufo.state !== 'arrive' ? rand(-430, -380) : rand(-650, -550)); }

    // UFO出現
    if (!ufo.active && G.time > G.nextUfo && !G.over) summonUFO();
  }

  // 弾更新
  for (let i = bullets.length - 1; i >= 0; i--) {
    const b = bullets[i]; const z0 = b.m.position.z; b.m.position.z -= 420 * dt; b.m.position.x += b.vx * dt * 0.25; b.life -= dt;
    let dead = b.life <= 0;
    if (!dead) for (let j = debris.length - 1; j >= 0; j--) {
      const d = debris[j]; const dp = d.g.position;
      const dx = b.m.position.x - dp.x, dy = b.m.position.y - dp.y, dz = b.m.position.z - dp.z;
      const zc = dp.z; const hitZ = (zc + d.r + 2 >= b.m.position.z) && (zc - d.r - 2 <= z0 + 2);
      if (hitZ && dx * dx + dy * dy < d.r * d.r * 0.8) {
        dead = true; d.hp--; d.flash = 0.08; sfxHit();
        for (let k = 0; k < 6; k++) emit(b.m.position.x, b.m.position.y, dp.z + d.r * 0.5, rand(-8, 8), rand(-8, 8), rand(0, 12), 2, 2.5, 3, 0.4, 0.25);
        if (d.hp <= 0) {
          explode(dp.clone(), d.size, d.mat);
          if (d.volatile) { // 燃料タンクは誘爆
            for (let k = debris.length - 1; k >= 0; k--) { if (k === j) continue; const o = debris[k]; if (o.g.position.distanceTo(dp) < 18) { o.hp = 0; o.chain = true; } }
            glowBurst(dp.clone(), 60, new THREE.Color(2, 1.2, 0.4), 0.5);
          }
          const pts = d.score * (1 + Math.floor(G.time / 60));
          addScore(pts); popup(dp, '+' + pts); G.kills++; $('kills').textContent = G.kills;
          if (d.maxHp >= 3 && Math.random() < 0.18) spawnPickup(dp.clone());
          scene.remove(d.g); debris.splice(j, 1);
        }
        break;
      }
    }
    // UFO への命中
    if (!dead && ufo.active && (ufo.state === 'fight' || ufo.state === 'arrive')) {
      const u = UFO.g.position; const bp = b.m.position;
      if (bp.z < u.z + 30 && z0 > u.z - 30) {
        const ex = (bp.x - u.x) / UFO_R, ey = (bp.y - u.y) / (UFO_R * 0.42);
        if (ex * ex + ey * ey < 1) {
          dead = true; ufo.hp--; ufo.hitFlash = 0.12; addScore(20);
          for (let k = 0; k < 5; k++) emit(bp.x, bp.y, u.z + 30, rand(-15, 15), rand(-15, 15), rand(0, 20), 3, 2, 1, rand(1, 2.5), 0.35);
          $('bossFill').style.width = (ufo.hp / ufo.maxHp * 100) + '%';
          if (ufo.hp <= 0) { ufo.state = 'dying'; ufo.dieT = 0; beams.forEach(bb => { bb.active = false; bb.beam.visible = bb.outer.visible = bb.tele.visible = bb.impact.visible = false; }); }
        }
      }
    }
    if (dead) { scene.remove(b.m); bullets.splice(i, 1); }
  }

  // デブリ更新
  for (let i = debris.length - 1; i >= 0; i--) {
    const d = debris[i]; d.age += dt;
    d.g.position.z += (worldSpeed + d.vel.z) * dt; d.g.position.x += d.vel.x * dt; d.g.position.y += d.vel.y * dt;
    d.g.rotation.x += d.spin.x * dt; d.g.rotation.y += d.spin.y * dt; d.g.rotation.z += d.spin.z * dt;
    const sc = Math.min(1, d.age * 1.5); d.g.scale.setScalar(sc);
    if (d.chain && d.hp <= 0) { explode(d.g.position.clone(), d.size, d.mat); addScore(d.score); G.kills++; $('kills').textContent = G.kills; scene.remove(d.g); debris.splice(i, 1); continue; }
    if (d.flash > 0) { d.flash -= dt; d.g.traverse(o => { if (o.isMesh) o.material = MAT.hit || (MAT.hit = new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 3, 3) })); }); d._fl = true; }
    else if (d._fl) { d._fl = false; restoreMats(d); }
    // 衝突
    if (G.running && !G.over && d.g.position.distanceTo(player.pos) < d.r * 0.75 + 1.4) {
      explode(d.g.position.clone(), d.size, d.mat); damage(Math.round(8 + d.r * 3)); scene.remove(d.g); debris.splice(i, 1); continue;
    }
    if (d.g.position.z > 40) { scene.remove(d.g); debris.splice(i, 1); }
  }

  // アイテム
  for (let i = pickups.length - 1; i >= 0; i--) {
    const p = pickups[i]; p.t += dt; p.m.position.z += worldSpeed * 0.8 * dt; p.m.rotation.y += dt * 3; p.m.rotation.x += dt * 1.3;
    if (G.running && !G.over && p.m.position.distanceTo(player.pos) < 4) {
      sfxPick(); popup(p.m.position, PICK[p.type].label, '#aff');
      if (p.type === 'repair') { G.hull = Math.min(100, G.hull + 30); updateHull(); }
      else { G.weapon = p.type; G.weaponT = 12; }
      scene.remove(p.m); pickups.splice(i, 1); continue;
    }
    if (p.m.position.z > 30) { scene.remove(p.m); pickups.splice(i, 1); }
  }

  // 破片
  for (let i = shards.length - 1; i >= 0; i--) {
    const s = shards[i]; s.life -= dt;
    s.m.position.addScaledVector(s.v, dt); s.m.position.z += worldSpeed * dt;
    s.m.rotation.x += s.r.x * dt; s.m.rotation.y += s.r.y * dt; s.m.rotation.z += s.r.z * dt;
    s.m.scale.setScalar(s.s * Math.min(1, s.life));
    if (s.life <= 0 || s.m.position.z > 30) { scene.remove(s.m); shards.splice(i, 1); }
  }
  for (let i = glowSprites.length - 1; i >= 0; i--) {
    const g = glowSprites[i]; g.life -= dt; const k = 1 - g.life / g.max;
    g.s.scale.setScalar(g.size * (0.3 + k)); g.s.material.opacity = Math.max(0, 1 - k);
    if (g.life <= 0) { scene.remove(g.s); g.s.material.dispose(); glowSprites.splice(i, 1); }
  }
  flashes.forEach(f => { if (f.t > 0) { f.t -= dt * 4; f.l.intensity = Math.max(0, f.t) * f.p * 30; } else f.l.intensity = 0; });

  updateUFO(dt, time);
  updateParticles(dt, 0);

  // 宇宙塵ストリーク
  const len = worldSpeed * 0.04;
  for (let i = 0; i < DUST.data.length; i++) {
    const p = DUST.data[i]; p.z += worldSpeed * dt * 1.4;
    if (p.z > 30) { p.z = -400; p.x = rand(-70, 70); p.y = rand(-45, 45); }
    DUST.pos.set([p.x, p.y, p.z, p.x, p.y, p.z - len], i * 6);
  }
  DUST.lines.geometry.attributes.position.needsUpdate = true;

  // カメラ
  const px = G.running ? player.pos.x : Math.sin(time * 0.2) * 6, py = G.running ? player.pos.y : Math.sin(time * 0.3) * 2;
  if (!G.running) { ship.position.set(px, py, 0); ship.rotation.z = Math.sin(time * 0.5) * 0.2; ship.userData.engines.forEach(s => s.scale.setScalar(s.userData.b * (0.9 + Math.random() * 0.25))); }
  G.shake = Math.max(0, G.shake - dt * 2.5);
  camShake.set(rand(-1, 1), rand(-1, 1), 0).multiplyScalar(G.shake * 0.6);
  camera.position.x += (px * 0.55 + camShake.x - camera.position.x) * Math.min(1, dt * 5);
  camera.position.y += (py * 0.5 + 4.5 + camShake.y - camera.position.y) * Math.min(1, dt * 5);
  camera.position.z = 15;
  camera.lookAt(px * 0.75 + camShake.x * 0.5, py * 0.7 + 1.5, -40);
  camera.rotation.z += (G.running ? -player.vel.x * 0.002 : 0);

  // レティクル
  if (G.running && !G.over) {
    const v = tmpV.set(player.pos.x, player.pos.y, -120).project(camera);
    const r = $('reticle'); r.style.left = ((v.x + 1) / 2 * innerWidth) + 'px'; r.style.top = ((1 - v.y) / 2 * innerHeight) + 'px'; r.style.display = 'block';
  } else $('reticle').style.display = 'none';

  if (G.running || G.over) composer.render();
}
function restoreMats(d) { d.g.traverse(o => { if (o.isMesh && o.userData.m) o.material = o.userData.m; }); }
// 元マテリアル保存用フック
const _origSpawn = spawnDebris;
function saveMats(d) { d.g.traverse(o => { if (o.isMesh) o.userData.m = o.material; }); }
const _push = debris.push.bind(debris);
debris.push = (...a) => { a.forEach(saveMats); return _push(...a); };

booted = true;
renderer.render(scene, camera);
$('loading').style.display = 'none';