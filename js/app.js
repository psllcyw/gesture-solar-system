// ============================================================
// 手势太阳系 · 主逻辑
// 场景 + 手势状态机 + 键鼠/触屏降级 + UI 反馈
// ============================================================

import { SolarSystem } from './scene.js';
import { GestureController } from './gestures.js';
import { BODIES, GESTURE, GLOSSARY } from './data.js';

let solar = null;
let gesture = null;
let currentIndex = 0;
let demoMode = false;
let camReady = false;
let camStarting = false;
let latestHands = null;
let gestureView = { state: 'none', progress: 0, norm: 0 };
let sceneReady = false;
let enterRequested = false;
let entered = false;
let loadRatio = 0;
let handGuideUntil = 0;

const $ = (sel) => document.querySelector(sel);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const isMobile = () => matchMedia('(max-width: 820px)').matches;
const isCoarse = () => matchMedia('(pointer: coarse)').matches;

function init() {
  // 先绑定 UI：即使 3D 初始化失败，按钮也不能变成“点了没反应”
  bindGate();
  bindKeyboard();
  bindInfoCard();
  bindCamPanel();
  bindTerms();
  checkCamPermission();

  try {
    solar = new SolarSystem($('#stage'), {
      onProgress: updateLoadProgress,
      onFirstFrame: onSceneReady,
    });
  } catch (err) {
    console.error('3D 场景初始化失败：', err);
    failScene(err);
    return;
  }

  solar.setFocus(0);
  buildNav();
  showInfo(0);
  bindPointer();
  window.__solar = solar;

  let last = performance.now();
  (function loop(now) {
    const rawDt = Math.max(0.001, (now - last) / 1000);
    const dt = Math.min(0.05, rawDt);
    last = now;
    solar.update(dt, rawDt);
    requestAnimationFrame(loop);
  })(last);
}

// ---------------- 加载进度与进入 ----------------
function updateLoadProgress(p) {
  const fill = $('#gl-fill');
  const text = $('#gl-text');
  if (!fill || !text) return;
  loadRatio = Math.max(loadRatio, clamp(p, 0, 1));
  const pct = Math.round(loadRatio * 100);
  fill.style.width = pct + '%';
  text.textContent = pct >= 100 ? '正在点亮第一缕阳光…' : `正在装配太阳系 · ${pct}%`;
  maybeEnter();
}

function onSceneReady() {
  sceneReady = true;
  window.__ready = true;
  maybeEnter();
}

// 贴图九成到位 + 首帧渲染完成，才真正揭开进入页：
// 否则会出现体验者说的“进去以后屏幕是空的，不知道在等什么”
function maybeEnter() {
  if (!enterRequested || entered) return;
  if (sceneReady && loadRatio >= 0.9) finishEnter();
}

function bindGate() {
  $('#enter-btn').addEventListener('click', enter);
}

function enter() {
  if (enterRequested) return;
  enterRequested = true;
  startCamera();               // 与贴图加载并行，授权弹窗不必等画面

  if (sceneReady && loadRatio >= 0.9) { finishEnter(); return; }

  const gate = $('#gate');
  gate.classList.add('loading');
  // 兜底：贴图慢或某张加载失败时，最多等 10 秒也让人进去
  setTimeout(() => {
    if (!gate.classList.contains('hide')) finishEnter();
  }, 10000);
}

function finishEnter() {
  if (entered) return;
  entered = true;
  const fill = $('#gl-fill');
  if (fill) fill.style.width = '100%';
  const text = $('#gl-text');
  if (text) text.textContent = '正在点亮第一缕阳光…';
  const gate = $('#gate');
  gate.classList.remove('loading');
  gate.classList.add('hide');
  document.body.classList.add('entered');
  showTouchHint();
}

// ---------------- 摄像头授权 ----------------
async function startCamera() {
  if (camStarting || camReady) return;
  camStarting = true;
  setCamStatus('正在请求授权…', '');
  try {
    if (gesture) { gesture.stop(); gesture = null; }
    const oldStream = $('#cam').srcObject;
    oldStream?.getTracks().forEach((track) => track.stop());

    if (!navigator.mediaDevices?.getUserMedia) {
      throw Object.assign(new Error('insecure-context'), { name: 'NotSupportedError' });
    }

    const stream = await navigator.mediaDevices.getUserMedia({
      video: {
        width: { ideal: 640 }, height: { ideal: 480 },
        frameRate: { ideal: 24, max: 30 }, facingMode: 'user',
      },
    });
    const video = $('#cam');
    video.srcObject = stream;
    await video.play();

    gesture = new GestureController(video, {
      onZoom: onGestureZoom,
      onSwipe: onGestureSwipe,
      onAction: onGestureAction,
      onDrag: onGestureDrag,
      onState: onGestureState,
      onHandSize: onHandSize,
      onLandmarks: (hands) => {
        latestHands = hands;
        emitDust(hands);
      },
    });
    await gesture.init();
    camReady = true;
    handGuideUntil = performance.now() + 7000;
    window.__gesture = gesture;
    hideCamError();
    setCamStatus('已连接 · 等待手势', 'ok');
  } catch (err) {
    console.warn('摄像头或手势模型不可用：', err);
    camReady = false;
    handleCamError(err);
  } finally {
    camStarting = false;
  }
}

function handleCamError(err) {
  const name = err?.name;
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    setCamStatus('授权被拒绝 · 可重试', 'warn');
    showCamError('摄像头权限被拒绝。请点击地址栏左侧的摄像头（或锁形）图标，把权限改为“允许”，然后点重试。', true);
  } else if (name === 'NotFoundError' || name === 'OverconstrainedError') {
    setCamStatus('未检测到摄像头', 'warn');
    showCamError('没有检测到可用摄像头。手指拖动、底部导航、键盘方向键同样可以完整操作。', false);
  } else if (name === 'NotReadableError' || name === 'TrackStartError') {
    setCamStatus('摄像头被占用', 'warn');
    showCamError('摄像头被其他程序占用（如视频会议软件），关闭后点重试。', true);
  } else if (name === 'NotSupportedError') {
    setCamStatus('需要 HTTPS 才能开摄像头', 'warn');
    showCamError('当前地址不是 HTTPS（或浏览器不支持），无法调用摄像头。手势之外的触屏、鼠标、键盘操作都可正常使用。', false);
  } else {
    setCamStatus('摄像头不可用 · 触屏可玩', 'warn');
    showCamError(`摄像头或识别模型启动失败（${name || '未知错误'}）。可点重试，或用触屏/键盘完整漫游。`, true);
  }
}

async function checkCamPermission() {
  if (!navigator.permissions?.query) return;
  try {
    const st = await navigator.permissions.query({ name: 'camera' });
    if (st.state === 'denied') {
      setCamStatus('授权被拒绝 · 可重试', 'warn');
      showCamError('摄像头权限已被拒绝。请点击地址栏左侧的摄像头（或锁形）图标改为“允许”，然后点重试。', true);
    } else if (st.state === 'granted') {
      setCamStatus('权限就绪', 'ok');
    }
    st.onchange = () => {
      if (st.state === 'granted' && !camReady && enterRequested) startCamera();
    };
  } catch { /* 浏览器不支持 camera 权限查询时由 getUserMedia 处理 */ }
}

// ---------------- WebGL 失败兜底 ----------------
function failScene() {
  const inner = document.querySelector('.gate-inner');
  if (!inner) return;
  inner.innerHTML = `
    <h1 style="font-size:28px;letter-spacing:6px;margin-bottom:16px">无 法 启 动 3D</h1>
    <p class="gate-sub" style="letter-spacing:2px;margin-bottom:26px">当前浏览器没能创建 WebGL 画面</p>
    <p class="gate-tip" style="max-width:400px;margin:0 auto 26px;line-height:2">
      请用较新版本的 Chrome / Edge / Safari 打开，并在浏览器设置里开启「硬件加速」。<br>
      如果是在微信里打开的，点右上角「…」→「在浏览器中打开」。
    </p>
    <button id="enter-btn">重 新 加 载</button>`;
  document.querySelector('#enter-btn').addEventListener('click', () => location.reload());
}

// ---------------- 手势回调 ----------------
function onGestureZoom(delta, source) {
  const gain = source === 'spread' ? GESTURE.zoomGainTwo : GESTURE.zoomGainOne;
  solar.zoomTarget = clamp(
    solar.zoomTarget * Math.exp(-delta * gain),
    GESTURE.zoomNear * 0.85,
    GESTURE.zoomFar * 1.1
  );
}

function onGestureDrag(dmx, dmy) {
  solar.camAzimuth += dmx * GESTURE.dragGainX;
  solar.camPolar = clamp(solar.camPolar + dmy * GESTURE.dragGainY, 0.38, 1.28);
}

function onGestureSwipe(dir) {
  switchBody(currentIndex + dir);
  const name = BODIES[currentIndex].name;
  popFx(dir > 0 ? `→ ${name}` : `${name} ←`);
}

function onGestureAction(action) {
  if (action === 'overview') {
    showOverview();
    popFx('太阳系全景');
  } else if (action === 'pause') {
    const paused = solar.togglePause();
    popFx(paused ? '星体运动已暂停' : '星体继续运动');
  }
}

function onGestureState(state, progress, norm) {
  gestureView = { state, progress, norm };
  if (state === 'none') setCamStatus('已连接 · 等待手势', 'ok');
  else if (state === 'spread') setCamStatus(`双手张合 · 缩放 ${Math.round(norm * 100)}%`, 'pinch');
  else if (state === 'height') setCamStatus(`上下推拉 · 缩放 ${Math.round(norm * 100)}%`, 'pinch');
  else if (state === 'drag') setCamStatus('握拳拖拽 · 旋转视角', 'action');
  else if (state === 'open') setCamStatus(`张掌停留 · 全景 ${Math.round(progress * 100)}%`, 'action');
  else if (state === 'fist') setCamStatus(`握拳静止 · 暂停 ${Math.round(progress * 100)}%`, 'action');
  else if (state === 'swipe') setCamStatus('挥手切换', 'action');
  else setCamStatus('已识别 · 可手势', 'ok');
  renderCamOverlay();
}

// 手离镜头的远近提示：直接回答“手要放多远才识别得到”
function onHandSize(size, count) {
  if (!camReady) return;
  const tip = $('#cam-tip');
  if (!tip) return;
  if (!count) { tip.classList.remove('show'); return; }
  if (size && size < GESTURE.handTooFar) {
    tip.textContent = '离远了一点 · 请靠近镜头';
    tip.classList.add('show');
  } else if (size > GESTURE.handTooNear) {
    tip.textContent = '太近了 · 请退后一点';
    tip.classList.add('show');
  } else if (performance.now() < handGuideUntil) {
    tip.textContent = '手放在虚线框内 · 约一臂距离';
    tip.classList.add('show');
  } else {
    tip.classList.remove('show');
  }
}

// ---------------- 星尘轨迹 ----------------
let dustPrev = null;
function emitDust(hands) {
  if (!hands || !hands.length) { dustPrev = null; return; }
  const tip = hands[0][8];
  const nx = clamp(((1 - tip.x) - 0.5) * 2.4, -1.2, 1.2);
  const ny = clamp(-(tip.y - 0.5) * 2.4, -1.2, 1.2);
  if (dustPrev) {
    const move = Math.hypot(nx - dustPrev.x, ny - dustPrev.y);
    const count = move > 0.3 ? 4 : move > 0.1 ? 2 : move > 0.035 ? 1 : 0;
    if (count) solar.spawnDust(nx, ny, BODIES[currentIndex].color, count);
  }
  dustPrev = { x: nx, y: ny };
}

// ---------------- 键盘与鼠标 / 触屏 ----------------
function bindKeyboard() {
  addEventListener('keydown', (e) => {
    if (!solar) return;
    if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', ' '].includes(e.key)) e.preventDefault();
    switch (e.key) {
      case 'ArrowRight': switchBody(currentIndex + 1); popFx(`→ ${BODIES[currentIndex].name}`); break;
      case 'ArrowLeft': switchBody(currentIndex - 1); popFx(`${BODIES[currentIndex].name} ←`); break;
      case 'ArrowUp': solar.zoomTarget = clamp(solar.zoomTarget * 0.82, GESTURE.zoomNear * 0.85, GESTURE.zoomFar * 1.1); break;
      case 'ArrowDown': solar.zoomTarget = clamp(solar.zoomTarget * 1.22, GESTURE.zoomNear * 0.85, GESTURE.zoomFar * 1.1); break;
      case 'Home': case '0': case 'o': case 'O': showOverview(); popFx('太阳系全景'); break;
      case ' ': { const paused = solar.togglePause(); popFx(paused ? '星体运动已暂停' : '星体继续运动'); break; }
      case 'd': case 'D': toggleDemo(); break;
      case 'Escape': if (demoMode) toggleDemo(); break;
    }
  });
}

function bindPointer() {
  const el = solar.renderer.domElement;
  let dragging = false, lastX = 0, lastY = 0, travel = 0;
  let startX = 0, startY = 0, startT = 0;

  el.addEventListener('pointerdown', (e) => {
    if (!e.isPrimary) return;
    dragging = true;
    lastX = startX = e.clientX;
    lastY = startY = e.clientY;
    travel = 0;
    startT = performance.now();
    el.setPointerCapture(e.pointerId);
  });

  el.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const dx = e.clientX - lastX, dy = e.clientY - lastY;
    travel += Math.abs(dx) + Math.abs(dy);
    solar.camAzimuth += dx * 0.004;
    solar.camPolar = clamp(solar.camPolar + dy * 0.0025, 0.38, 1.28);
    lastX = e.clientX; lastY = e.clientY;
  });

  el.addEventListener('pointerup', (e) => {
    if (!dragging) return;
    dragging = false;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    const dt = performance.now() - startT;

    // 触屏上快速横滑 = 换星球（和手机相册的习惯一致）
    if (isCoarse() && dt < 450 && Math.abs(dx) > 55 && Math.abs(dx) > Math.abs(dy) * 1.6) {
      switchBody(currentIndex + (dx < 0 ? 1 : -1));
      popFx(dx < 0 ? `→ ${BODIES[currentIndex].name}` : `${BODIES[currentIndex].name} ←`);
      return;
    }
    if (travel < 6) {
      const idx = solar.pick(e.clientX, e.clientY);
      if (idx !== null) { switchBody(idx); popFx(BODIES[idx].name); }
    }
  });

  el.addEventListener('pointercancel', () => { dragging = false; });

  el.addEventListener('wheel', (e) => {
    solar.zoomTarget = clamp(
      solar.zoomTarget * (e.deltaY > 0 ? 1.1 : 0.9),
      GESTURE.zoomNear * 0.85, GESTURE.zoomFar * 1.1
    );
  }, { passive: true });

  // 双指捏合缩放（移动端）
  let pinchBase = 0, pinchZoom = 1;
  el.addEventListener('touchstart', (e) => {
    if (e.touches.length === 2) {
      dragging = false;
      pinchBase = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      );
      pinchZoom = solar.zoomTarget;
    }
  }, { passive: true });

  el.addEventListener('touchmove', (e) => {
    if (e.touches.length !== 2 || !pinchBase) return;
    const d = Math.hypot(
      e.touches[0].clientX - e.touches[1].clientX,
      e.touches[0].clientY - e.touches[1].clientY
    );
    if (d < 8) return;
    solar.zoomTarget = clamp(
      pinchZoom * (pinchBase / d),
      GESTURE.zoomNear * 0.85, GESTURE.zoomFar * 1.1
    );
    e.preventDefault();
  }, { passive: false });

  el.addEventListener('touchend', (e) => {
    if (e.touches.length < 2) pinchBase = 0;
  });
}

// ---------------- 切换与全景 ----------------
function switchBody(idx) {
  const n = BODIES.length;
  currentIndex = ((idx % n) + n) % n;
  solar.setFocus(currentIndex);
  showInfo(currentIndex, true);
  updateNav();
}

function showOverview() {
  solar.setOverview();
  $('#infocard').classList.remove('show');
  updateNav();
}

window.__focus = (i) => switchBody(i);
window.__overview = () => showOverview();

// ---------------- 信息卡与导航 ----------------
function showInfo(i, userTriggered = false) {
  const b = BODIES[i];
  $('#ic-type').innerHTML = linkTerms(b.type);
  $('#ic-name').textContent = b.name;
  $('#ic-en').textContent = b.en;
  $('#ic-stats').innerHTML = b.stats
    .map(([k, v]) => `<div class="row"><dt>${linkTerms(k)}</dt><dd>${esc(v)}</dd></div>`)
    .join('');
  $('#ic-fact').textContent = b.fact;

  // 手机上默认收起科普卡：一进来先看星球，点了导航或星球才滑出
  if (isMobile() && !userTriggered) $('#infocard').classList.remove('show');
  else $('#infocard').classList.add('show');
}

function bindInfoCard() {
  $('#ic-close').addEventListener('click', () => $('#infocard').classList.remove('show'));
}

function buildNav() {
  const nav = $('#planet-nav');
  nav.innerHTML = '';
  BODIES.forEach((b, i) => {
    const btn = document.createElement('button');
    btn.className = 'nav-item';
    btn.innerHTML = `<span class="dot"></span><span class="label">${b.name}</span>`;
    btn.style.setProperty('--dot-color', '#' + b.color.toString(16).padStart(6, '0'));
    btn.addEventListener('click', () => switchBody(i));
    nav.appendChild(btn);
  });
  updateNav();
}

function updateNav() {
  if (!solar) return;
  document.querySelectorAll('.nav-item').forEach((el, i) => {
    el.classList.toggle('active', !solar.overview && i === currentIndex);
  });
}

function toggleDemo() {
  demoMode = !demoMode;
  document.body.classList.toggle('demo', demoMode);
}

function popFx(text) {
  const fx = $('#gesture-fx');
  fx.textContent = text;
  fx.classList.remove('pop');
  void fx.offsetWidth;
  fx.classList.add('pop');
}

// ---------------- 术语解释 ----------------
const TERM_KEYS = Object.keys(GLOSSARY).sort((a, b) => b.length - a.length);
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function linkTerms(text) {
  // 一次性替换，避免长词替换后又被短词二次包裹
  const re = new RegExp(`(${TERM_KEYS.map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'g');
  return esc(text).replace(re, (m) => `<button class="term" data-term="${m}">${m}</button>`);
}

function bindTerms() {
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('.term');
    if (btn) {
      e.stopPropagation();
      showTerm(btn.dataset.term, btn);
      return;
    }
    if (!e.target.closest('#term-pop')) hideTerm();
  });
}

function showTerm(key, anchor) {
  const desc = GLOSSARY[key];
  if (!desc) return;
  const pop = $('#term-pop');
  pop.innerHTML = `<b>${esc(key)}</b>${esc(desc)}`;
  pop.classList.add('show');

  const r = anchor.getBoundingClientRect();
  const vw = innerWidth, vh = innerHeight;
  const pw = pop.offsetWidth, ph = pop.offsetHeight;

  if (isMobile()) {
    pop.style.left = '';
    pop.style.right = '';
    // 移动端：固定在底部上方的气泡，避免贴边溢出
    pop.style.top = Math.max(12, vh - ph - 96) + 'px';
  } else {
    // 桌面：优先放信息卡左侧，不遮住正在看的条目
    const card = $('#infocard').getBoundingClientRect();
    const leftSpace = card.left - pw - 16;
    if (leftSpace > 12) {
      pop.style.left = leftSpace + 'px';
      pop.style.top = clamp(r.top - 8, 12, vh - ph - 12) + 'px';
    } else {
      pop.style.left = clamp(r.left, 12, vw - pw - 12) + 'px';
      let top = r.bottom + 10;
      if (top + ph > vh - 12) top = Math.max(12, r.top - ph - 10);
      pop.style.top = top + 'px';
    }
  }
  // 标记当前选中的词，便于再次点击关闭
  document.querySelectorAll('.term.active').forEach((el) => el.classList.remove('active'));
  anchor.classList.add('active');
}

function hideTerm() {
  $('#term-pop').classList.remove('show');
  document.querySelectorAll('.term.active').forEach((el) => el.classList.remove('active'));
}

// ---------------- 摄像头小窗 ----------------
function bindCamPanel() {
  const panel = $('#cam-panel');
  panel.addEventListener('click', () => {
    panel.classList.toggle('expanded');
    setTimeout(renderCamOverlay, 340);
  });
}

function showTouchHint() {
  if (!isMobile()) return;
  const el = $('#touch-hint');
  if (!el) return;
  el.style.opacity = '1';
  setTimeout(() => { el.style.opacity = '0'; }, 7000);
}

const camCv = $('#cam-overlay');
const camCtx = camCv.getContext('2d');
const HAND_LINKS = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [17, 18], [18, 19], [19, 20], [0, 17],
];
let camCvW = 0, camCvH = 0;

function renderCamOverlay() {
  const w = camCv.clientWidth, h = camCv.clientHeight;
  if (!w || !h) return;
  if (w !== camCvW || h !== camCvH) {
    camCv.width = w; camCv.height = h; camCvW = w; camCvH = h;
  }
  camCtx.clearRect(0, 0, w, h);
  const state = gestureView.state;
  const color = state === 'open' || state === 'fist' ? '#f0c674'
    : state === 'spread' || state === 'height' ? '#e98b78'
    : state === 'drag' ? '#7ee2a0' : '#8fb8ff';

  if (latestHands) {
    camCtx.strokeStyle = color;
    camCtx.fillStyle = color;
    camCtx.lineWidth = 1.15;
    for (const lm of latestHands) {
      camCtx.globalAlpha = 0.72;
      camCtx.beginPath();
      for (const [a, b] of HAND_LINKS) {
        const p = lm[a], q = lm[b];
        camCtx.moveTo((1 - p.x) * w, p.y * h);
        camCtx.lineTo((1 - q.x) * w, q.y * h);
      }
      camCtx.stroke();
      for (const p of lm) {
        camCtx.beginPath();
        camCtx.arc((1 - p.x) * w, p.y * h, 1.55, 0, Math.PI * 2);
        camCtx.fill();
      }
    }
    camCtx.globalAlpha = 1;
  }

  if (state === 'spread' || state === 'height' || state === 'open' || state === 'fist') {
    const value = state === 'open' || state === 'fist' ? gestureView.progress : gestureView.norm;
    const barW = w * 0.72, barX = w * 0.14, barY = h * 0.86;
    camCtx.fillStyle = 'rgba(255,255,255,.22)';
    camCtx.fillRect(barX, barY, barW, 3);
    camCtx.fillStyle = color;
    camCtx.fillRect(barX, barY, barW * value, 3);
  }
}

function setCamStatus(text, cls) {
  const el = $('#cam-status');
  el.textContent = text;
  el.className = cls || '';
}

let camErrTimer = null;
function showCamError(text, withRetry) {
  let el = $('#cam-error');
  if (!el) {
    el = document.createElement('div');
    el.id = 'cam-error';
    document.body.appendChild(el);
  }
  el.innerHTML = '';
  const msg = document.createElement('div');
  msg.className = 'cam-err-msg';
  msg.textContent = text;
  el.appendChild(msg);
  if (withRetry) {
    const btn = document.createElement('button');
    btn.id = 'cam-retry';
    btn.textContent = '重 试 摄 像 头';
    btn.addEventListener('click', () => { hideCamError(); startCamera(); });
    el.appendChild(btn);
  }
  el.classList.add('show');
  clearTimeout(camErrTimer);
  if (!withRetry) camErrTimer = setTimeout(() => el.classList.remove('show'), 8000);
}

function hideCamError() {
  clearTimeout(camErrTimer);
  $('#cam-error')?.classList.remove('show');
}

// 放在文件末尾启动：确保下面用 const 定义的术语表、画布引用都已初始化
init();
