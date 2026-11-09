// 手势推理 Worker：ImageBitmap 进入，21 个关键点返回，不阻塞 3D 主线程
// 必须使用 classic worker：MediaPipe 的 wasm 加载器内部依赖 importScripts
let modulePromise = import('../vendor/mediapipe/vision_bundle.mjs');
let landmarker = null;

self.onmessage = async (event) => {
  const data = event.data;

  if (data.type === 'init') {
    try {
      const { FilesetResolver, HandLandmarker } = await modulePromise;
      const files = await FilesetResolver.forVisionTasks(data.wasmPath);
      landmarker = await HandLandmarker.createFromOptions(files, {
        baseOptions: { modelAssetPath: data.modelPath, delegate: 'CPU' },
        runningMode: 'VIDEO',
        numHands: 2,
      });
      self.postMessage({ type: 'ready' });
    } catch (err) {
      self.postMessage({ type: 'init-error', message: err?.message || String(err) });
    }
    return;
  }

  if (data.type === 'frame' && landmarker) {
    try {
      const result = landmarker.detectForVideo(data.bitmap, data.timestamp);
      self.postMessage({ type: 'result', landmarks: result.landmarks || [] });
    } catch (err) {
      self.postMessage({ type: 'frame-error', message: err?.message || String(err) });
    } finally {
      data.bitmap.close();
    }
  }
};
