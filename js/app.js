// ============================================================
// 手势太阳系 · 主逻辑
// 场景 + 手势状态机 + 键鼠降级 + UI 反馈
// ============================================================

import { SolarSystem } from './scene.js';
import { GestureController } from './gestures.js';
import { BODIES, GESTURE } from './data.js';

let solar = null;
let gesture = null;
let currentIndex = 0;
let demoMode = false;
let camReady = false;
let camStarting = false;
let latestHands = null;
let gestureView = { state: 'none', progress: 0, norm: 0 };

const $ = (sel) => document.querySelector(sel);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

init();

function init() {
  solar = new SolarSystem($('#stage'));
  solar.setFocus(0);
  buildNav();
  showInfo(0);
  bindKeyboard();
  bindPointer();
  bindGate();
  checkCamPermission();

  let last = performance.now();
  (function loop(now) {
    const rawDt = Math.max(0.001, (now - last) / 1000);
    const dt = Math.min(0.05, rawDt);
    last = now;
    solar.update(dt, rawDt);
    requestAnimationFrame(loop);
  })(last);
}

// ---------------- 进入与摄像头授权 ----------------
function bindGate() {
  $('#enter-btn').addEventListener('click', () => {
    $('#gate').classList.add('hide');
    if (!camReady) startCamera();
  });
}

async function startCamera() {
  if (camStarting || camReady) return;
  camStarting = true;
  setCamStatus('正在请求授权…', '');
  try {
    if (gesture) { gesture.stop(); gesture = null; }
    const oldStream = $('#cam').srcObject;
    oldStream?.getTracks().forEach((track) => track.stop());

    const stream = await navigator.mediaDevices.getUserMedia({
      video: {
        width: { ideal: 480 }, height: { ideal: 360 },
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
      onLandmarks: (hands) => {
        latestHands = hands;
        emitDust(hands);
      },
    });
    await gesture.init();
    camReady = true;
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
    showCamError('没有检测到可用摄像头。键盘方向键、Home 和空格同样可以完整操作。', false);
  } else if (name === 'NotReadableError' || name === 'TrackStartError') {
    setCamStatus('摄像头被占用', 'warn');
    showCamError('摄像头被其他程序占用（如视频会议软件），关闭后点重试。', true);
  } else {
    setCamStatus('摄像头不可用 · 键盘可玩', 'warn');
    showCamError(`摄像头或识别模型启动失败（${name || '未知错误'}）。可点重试，或使用键盘完整漫游。`, true);
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
      if (st.state === 'granted' && !camReady && $('#gate').classList.contains('hide')) startCamera();
    };
  } catch { /* 浏览器不支持 camera 权限查询时由 getUserMedia 处理 */ }
}

// ---------------- 手势回调 ----------------
function onGestureZoom(delta, source) {
  // 相对增量：手张开（正）拉近、收拢（负）拉远，不会因手入镜突然跳变
  const gain = source === 'spread' ? GESTURE.zoomGainTwo : GESTURE.zoomGainOne;
  solar.zoomTarget = clamp(
    solar.zoomTarget * Math.exp(-delta * gain),
    GESTURE.zoomNear * 0.85,
    GESTURE.zoomFar * 1.1
  );
}

function onGestureDrag(dmx, dmy) {
  // 握拳拖拽：与鼠标拖动同一套极性与限位
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

// ---------------- 星尘轨迹 ----------------
let dustPrev = null;
function emitDust(hands) {
  if (!hands || !hands.length) { dustPrev = null; return; }
  const tip = hands[0][8];   // 食指指尖，指向性最强
  const nx = clamp(((1 - tip.x) - 0.5) * 2.4, -1.2, 1.2);   // 镜像回用户视角
  const ny = clamp(-(tip.y - 0.5) * 2.4, -1.2, 1.2);
  if (dustPrev) {
    const move = Math.hypot(nx - dustPrev.x, ny - dustPrev.y);
    const count = move > 0.3 ? 4 : move > 0.1 ? 2 : move > 0.035 ? 1 : 0;
    if (count) solar.spawnDust(nx, ny, BODIES[currentIndex].color, count);
  }
  dustPrev = { x: nx, y: ny };
}

// ---------------- 键盘与鼠标 ----------------
function bindKeyboard() {
  addEventListener('keydown', (e) => {
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
  el.addEventListener('pointerdown', (e) => {
    dragging = true; lastX = e.clientX; lastY = e.clientY; travel = 0;
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
}

// ---------------- 切换与全景 ----------------
function switchBody(idx) {
  const n = BODIES.length;
  currentIndex = ((idx % n) + n) % n;
  solar.setFocus(currentIndex);
  showInfo(currentIndex);
  updateNav();
}

function showOverview() {
  solar.setOverview();
  $('#infocard').classList.remove('show');
  updateNav();
}

window.__focus = switchBody;
window.__overview = showOverview;
window.__solar = solar;

// ---------------- 信息卡与导航 ----------------
function showInfo(i) {
  const b = BODIES[i];
  $('#ic-type').textContent = b.type;
  $('#ic-name').textContent = b.name;
  $('#ic-en').textContent = b.en;
  $('#ic-stats').innerHTML = b.stats.map(([k, v]) => `<div class="row"><dt>${k}</dt><dd>${v}</dd></div>`).join('');
  $('#ic-fact').textContent = b.fact;
  $('#infocard').classList.add('show');
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

// ---------------- 摄像头小窗：骨架 + 动作进度 ----------------
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
