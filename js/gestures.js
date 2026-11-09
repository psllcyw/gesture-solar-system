// ============================================================
// 手势识别 · MediaPipe HandLandmarker（全本地）
// 双手张合缩放（单手自动降级为上下推拉）
// 握拳拖拽旋转 / 握拳静止暂停 / 张掌停留全景 / 轨迹挥手切换
// 独立状态机 + 动作锁 + 进度反馈，识别与 3D 渲染解耦
// ============================================================

import { FilesetResolver, HandLandmarker } from '../vendor/mediapipe/vision_bundle.mjs';
import { GESTURE } from './data.js';

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, (a.z || 0) - (b.z || 0));
// 掌心参考点：0=腕 5/9/13/17=各指根，取平均，比单个关键点稳
const palmCenter = (lm) => ({
  x: (lm[0].x + lm[5].x + lm[9].x + lm[13].x + lm[17].x) / 5,
  y: (lm[0].y + lm[5].y + lm[9].y + lm[13].y + lm[17].y) / 5,
});

export class GestureController {
  constructor(videoEl, callbacks) {
    this.video = videoEl;
    this.cb = callbacks;
    this.landmarker = null;
    this.worker = null;
    this.busy = false;
    this.running = false;

    this.mode = 'none';          // none | one | two
    this.twoStreak = 0;          // 双手连续帧数，防止误检闪烁
    this.smoothZoom = null;      // 缩放输入的平滑值 0~1
    this.lastNorm = null;        // 相对增量基准
    this.history = [];
    this.coolUntil = 0;
    this.swipeArmed = true;   // 挥手后必须先停稳手，才允许下一次挥手（防连跳）
    this.candidate = 'idle';
    this.candidateSince = 0;
    this.latched = null;
    this.dragging = false;
    this.fistAnchor = null;
    this.lastDrag = null;

    this._lastVideoTime = -1;
    this._lastDetectMs = 0;
  }

  async init() {
    try {
      await this._initWorker();
    } catch (err) {
      console.warn('手势 Worker 初始化失败，回退主线程识别：', err);
      this.worker?.terminate();
      this.worker = null;
      const files = await FilesetResolver.forVisionTasks('vendor/mediapipe/wasm');
      const options = (delegate) => ({
        baseOptions: { modelAssetPath: 'vendor/models/hand_landmarker.task', delegate },
        runningMode: 'VIDEO',
        numHands: 2,
      });
      try {
        this.landmarker = await HandLandmarker.createFromOptions(files, options('GPU'));
      } catch {
        this.landmarker = await HandLandmarker.createFromOptions(files, options('CPU'));
      }
    }
    this.running = true;
    this._schedule();
  }

  _initWorker() {
    this.worker = new Worker(new URL('./gesture-worker.js', import.meta.url));
    return new Promise((resolve, reject) => {
      this.worker.onmessage = (event) => {
        const data = event.data;
        if (data.type === 'ready') { resolve(); return; }
        if (data.type === 'init-error') { reject(new Error(data.message)); return; }
        if (data.type === 'result') {
          this.busy = false;
          if (!this.running) return;
          const hands = data.landmarks || [];
          if (!hands.length) { this.processNoHand(); return; }
          this.cb.onLandmarks?.(hands);
          this.processHands(hands, performance.now() / 1000);
        } else if (data.type === 'frame-error') {
          this.busy = false;
          console.warn('手势帧识别失败：', data.message);
        }
      };
      this.worker.onerror = (event) => reject(new Error(event.message || 'Worker load error'));
      this.worker.postMessage({
        type: 'init',
        wasmPath: new URL('../vendor/mediapipe/wasm', import.meta.url).href,
        modelPath: new URL('../vendor/models/hand_landmarker.task', import.meta.url).href,
      });
    });
  }

  _schedule() {
    if (!this.running) return;
    if (this.video.requestVideoFrameCallback) this.video.requestVideoFrameCallback(this._loop);
    else requestAnimationFrame(this._loop);
  }

  _loop = () => {
    if (!this.running) return;
    this._schedule();
    if (this.busy || this.video.readyState < 2 || this.video.currentTime === this._lastVideoTime) return;

    const nowMs = performance.now();
    // 识别目标约 20fps；Worker 忙时自动跳帧，3D 渲染不受影响
    if (nowMs - this._lastDetectMs < 50) return;
    this._lastDetectMs = nowMs;
    this._lastVideoTime = this.video.currentTime;

    if (this.worker) {
      this.busy = true;
      this._sendFrame(nowMs);
      return;
    }

    // 仅在不支持 Worker 的浏览器使用主线程降级路径
    const res = this.landmarker.detectForVideo(this.video, nowMs);
    const hands = res.landmarks || [];
    if (!hands.length) { this.processNoHand(); return; }
    this.cb.onLandmarks?.(hands);
    this.processHands(hands, nowMs / 1000);
  };

  async _sendFrame(timestamp) {
    try {
      // 384px 足够识别 21 点，归一化坐标不受缩放影响
      const bitmap = await createImageBitmap(this.video, {
        resizeWidth: 384, resizeHeight: 288, resizeQuality: 'high',
      });
      if (!this.running || !this.worker) { bitmap.close(); this.busy = false; return; }
      this.worker.postMessage({ type: 'frame', bitmap, timestamp }, [bitmap]);
    } catch (err) {
      this.busy = false;
      console.warn('视频帧截取失败：', err);
    }
  }

  _setMode(mode) {
    if (this.mode === mode) return;
    this.mode = mode;
    this.smoothZoom = null;
    this.lastNorm = null;
    this.history.length = 0;
    this.candidate = 'idle';
    this.latched = null;
    this.dragging = false;
    this.fistAnchor = null;
    this.lastDrag = null;
    this.swipeArmed = true;
  }

  processNoHand() {
    this.twoStreak = 0;
    this.history.length = 0;
    this.candidate = 'idle';
    this.latched = null;
    this.smoothZoom = null;
    this.lastNorm = null;
    this.dragging = false;
    this.fistAnchor = null;
    this.lastDrag = null;
    this.mode = 'none';
    this.swipeArmed = true;
    this.cb.onHandSize?.(0, 0);
    this.cb.onLandmarks?.(null);
    this.cb.onState?.('none', 0, 0);
  }

  /** 独立出来便于自动化测试：直接输入关键点数组（1~2 只手） */
  processHands(hands, now) {
    // 手掌长度（腕 → 中指根）= 手离镜头远近的尺度，用于取景提示
    let sum = 0;
    for (const h of hands) sum += dist(h[0], h[9]);
    this.cb.onHandSize?.(sum / hands.length, hands.length);

    if (hands.length >= 2) {
      if (this.mode === 'two') { this.twoStreak = 2; this._processTwo(hands, now); return; }
      this.twoStreak += 1;
      if (this.mode === 'none' || this.twoStreak >= 2) {
        this._setMode('two');
        this.twoStreak = 2;
        this._processTwo(hands, now);
        return;
      }
      this._processOne(hands[0], now);
      return;
    }
    this.twoStreak = 0;
    this._processOne(hands[0], now);
  }

  // ---------------- 双手张合：缩放 ----------------
  _processTwo(hands, now) {
    const [a, b] = hands;
    const pa = palmCenter(a), pb = palmCenter(b);
    // 两手间距直接用画面平面距离，除以手掌长度做尺度归一，
    // 这样人往后退、手离镜头远近变化都不会被误算成缩放
    const spread = Math.hypot(pa.x - pb.x, pa.y - pb.y);
    const palmScale = (dist(a[0], a[9]) + dist(b[0], b[9])) / 2 || 0.1;
    const ratio = spread / palmScale;
    const norm = clamp(Math.log(Math.max(0.01, ratio / GESTURE.spreadMin)) / Math.log(GESTURE.spreadRange), 0, 1);

    this._driveZoom(norm);
    this.cb.onState?.('spread', 1, norm);
  }

  // ---------------- 单手：挥手 / 拖拽 / 停留 / 推拉 ----------------
  _processOne(lm, now) {
    this._setMode('one');

    const palmLen = dist(lm[0], lm[9]) || 0.1;
    const pinch = dist(lm[4], lm[8]) / palmLen;

    // 四指伸展用指尖/近节到腕部距离比判定，不依赖手掌朝向
    const fingers = [[8, 6], [12, 10], [16, 14], [20, 18]];
    const ratios = fingers.map(([tip, pip]) => dist(lm[tip], lm[0]) / (dist(lm[pip], lm[0]) || 0.001));
    const extended = ratios.filter((r) => r > 1.10).length;
    const openPalm = extended === 4 && pinch > 0.72;
    // 握拳要求中指/无名指/小指全部收拢，避免捏合手指被判成拳头
    const fist = ratios.slice(1).every((r) => r < 1.08) && pinch < 0.62;

    const palm = palmCenter(lm);
    const cx = palm.x, cy = palm.y;
    // 预览画面是镜像的，换成用户视角坐标后再判断方向与拖拽
    const mx = 1 - cx, my = cy;

    // ---- 挥手：识别 80~280ms 内的真实位移，而非相邻帧噪声 ----
    this.history.push({ x: cx, y: cy, t: now });
    while (this.history.length > 2 && now - this.history[0].t > 0.28) this.history.shift();

    // 冷却结束后手还得停稳一小会儿才重新武装：
    // 手挥完常常顺带摆回原位，若不禁用会被同一次挥扫连续计数（体验者反馈的“连跳两颗”）
    if (!this.swipeArmed && now > this.coolUntil && this.history.length >= 2) {
      const first = this.history[0];
      const still = Math.hypot(cx - first.x, cy - first.y) < GESTURE.swipeRearmStill;
      if (still && now - first.t >= GESTURE.swipeRearmTime) {
        this.swipeArmed = true;
        this.history.length = 0;
      }
    }

    // 挥手允许张掌姿势（最自然），靠速度与方向区分停留
    const canSwipe = !this.dragging && !fist && extended >= 3 && pinch > 0.55;
    if (canSwipe && this.swipeArmed && now > this.coolUntil && this.history.length >= 3) {
      const first = this.history[0];
      const elapsed = now - first.t;
      const dx = cx - first.x;
      const dy = cy - first.y;
      if (elapsed >= 0.065 && Math.abs(dx) >= GESTURE.swipeDistance &&
          Math.abs(dx) / elapsed >= GESTURE.swipeSpeed && Math.abs(dy) < 0.16) {
        const dir = dx < 0 ? 1 : -1; // 预览为镜像，视频 x 向左 = 用户向右挥
        this.coolUntil = now + GESTURE.swipeCooldown;
        this.swipeArmed = false;
        this.history.length = 0;
        this.candidate = 'idle';
        this.latched = null;
        this.smoothZoom = null;
        this.lastNorm = null;
        this.cb.onSwipe?.(dir);
        this.cb.onState?.('swipe', 1, 0);
        return;
      }
    }

    // ---- 握拳：先看是否在拖拽，静止不动才计暂停 ----
    if (fist) {
      if (!this.fistAnchor) this.fistAnchor = { x: mx, y: my };
      const travel = Math.hypot(mx - this.fistAnchor.x, my - this.fistAnchor.y);
      if (!this.dragging && travel >= GESTURE.dragStart) {
        this.dragging = true;
        this.lastDrag = { x: mx, y: my };
        this.candidate = 'drag';
        this.latched = null;
      }
      if (this.dragging) {
        const dmx = mx - this.lastDrag.x;
        const dmy = my - this.lastDrag.y;
        this.lastDrag.x = mx;
        this.lastDrag.y = my;
        this.lastNorm = null;
        if (Math.abs(dmx) > 0.0006 || Math.abs(dmy) > 0.0006) this.cb.onDrag?.(dmx, dmy);
        this.cb.onState?.('drag', 1, 0);
        return;
      }
      if (this.candidate !== 'fist') {
        this.candidate = 'fist';
        this.candidateSince = now;
        this.latched = null;
      }
      this.lastNorm = null;
      const progress = clamp((now - this.candidateSince) / GESTURE.holdFist, 0, 1);
      if (progress >= 1 && this.latched !== 'fist') {
        this.latched = 'fist';
        this.cb.onAction?.('pause');
      }
      this.cb.onState?.('fist', progress, 0);
      return;
    }

    // 松拳：清掉拖拽态，后面重新开始
    this.dragging = false;
    this.fistAnchor = null;
    this.lastDrag = null;

    // ---- 张掌静止：返回全景；张掌在动：当作单手推拉 ----
    if (openPalm) {
      const recent = this.history.length ? this.history[0] : { x: cx, y: cy };
      const moved = Math.hypot(cx - recent.x, cy - recent.y);
      if (moved < GESTURE.holdStill) {
        if (this.candidate !== 'open') {
          this.candidate = 'open';
          this.candidateSince = now;
        }
        this.lastNorm = null;
        const progress = clamp((now - this.candidateSince) / GESTURE.holdOpen, 0, 1);
        if (progress >= 1 && this.latched !== 'open') {
          this.latched = 'open';
          this.cb.onAction?.('overview');
        }
        this.cb.onState?.('open', progress, 0);
        return;
      }
      // 手还在移动 → 不累计停留，交给下面的推拉缩放
      this.candidate = 'idle';
      this.candidateSince = now;
    }

    if (this.candidate !== 'idle') {
      this.candidate = 'idle';
      this.candidateSince = now;
      this.latched = null;
    }

    // ---- 单手降级：手掌上下推拉 ----
    const norm = clamp(1 - (cy - GESTURE.heightMin) / GESTURE.heightRange, 0, 1);
    this._driveZoom(norm);
    this.cb.onState?.('height', 1, norm);
  }

  // ---------------- 相对增量缩放 ----------------
  // 手入镜、静止、离场都不会让镜头跳动，只有真实张合才驱动缩放
  _driveZoom(norm) {
    const prev = this.smoothZoom;
    if (prev === null) {
      this.smoothZoom = norm;
      if (this.lastNorm === null) this.lastNorm = norm;
      return;
    }
    // 大动作更跟手，小动作重滤波
    const alpha = Math.abs(norm - prev) > 0.08 ? 0.5 : 0.22;
    this.smoothZoom = prev + (norm - prev) * alpha;
    // 收敛到目标后直接对齐，手静止时不会因为滤波残量继续推镜头
    if (Math.abs(norm - this.smoothZoom) < 0.004) this.smoothZoom = norm;

    if (this.lastNorm === null) { this.lastNorm = this.smoothZoom; return; }
    const delta = this.smoothZoom - this.lastNorm;
    if (Math.abs(delta) < GESTURE.zoomDeadzone) return;
    this.lastNorm = this.smoothZoom;
    this.cb.onZoom?.(delta, this.mode === 'two' ? 'spread' : 'height');
  }

  stop() {
    this.running = false;
    this.worker?.terminate();
    this.worker = null;
    this.landmarker?.close();
  }
}
