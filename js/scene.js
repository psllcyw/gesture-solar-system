// ============================================================
// 3D 太阳系 · 性能与画质平衡版
// 远景 2K / 聚焦天体动态 8K / 自适应后期 / 大气与土星环阴影
// ============================================================

import * as THREE from 'three';
import { EffectComposer } from '../vendor/three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from '../vendor/three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from '../vendor/three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from '../vendor/three/examples/jsm/postprocessing/OutputPass.js';
import { BODIES } from './data.js';

const ATMOS = {
  venus:   [0xe8c78e, 0.52],
  earth:   [0x4f96ff, 0.82],
  jupiter: [0xd8a878, 0.30],
  saturn:  [0xe3d5a8, 0.27],
  uranus:  [0x8fd8dd, 0.50],
  neptune: [0x4169ff, 0.58],
};

const lowRes = (url) => url?.replace(/(?:8k|4k)_/, '2k_');
const clampPolar = (v) => Math.min(0.98, Math.max(0.42, v));

export class SolarSystem {
  constructor(container) {
    this.container = container;
    this.bodies = [];
    this.time = 0;
    this.flyT = 1;
    this.focusIndex = 0;
    this.overview = false;
    this.motionPaused = false;
    this.adaptive = true;
    this.quality = 2;
    this._fps = 60;
    this._qualityClock = 0;
    this._lastQualityChange = 0;
    this._highToken = 0;
    this._highBody = null;

    // 复用向量，避免动画循环里的 GC 抖动
    this._v1 = new THREE.Vector3();
    this._v2 = new THREE.Vector3();
    this._v3 = new THREE.Vector3();
    this._v4 = new THREE.Vector3();
    this._up = new THREE.Vector3(0, 1, 0);

    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: 'high-performance',
      stencil: false,
    });
    this.renderer.setPixelRatio(this._pixelRatio());
    this.renderer.setSize(innerWidth, innerHeight);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.28;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 0.1, 6000);
    this.camera.position.set(0, 130, 260);

    // 2x MSAA + 半分辨率 Bloom：保留高光，避免全分辨率多次模糊造成带宽瓶颈
    const rt = new THREE.WebGLRenderTarget(innerWidth, innerHeight, {
      samples: this.renderer.capabilities.isWebGL2 ? 2 : 0,
      type: THREE.HalfFloatType,
    });
    this.composer = new EffectComposer(this.renderer, rt);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth / 2, innerHeight / 2), 0.48, 0.62, 0.80);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
    this._applySize();

    this._buildLights();
    this._buildSky();
    this._buildBodies();
    this._buildDust();

    this.camAzimuth = Math.PI * 0.25;
    this.camPolar = 0.92;
    this.zoomFactor = 1;
    this.zoomTarget = 1;
    this.focusPos = new THREE.Vector3();
    this.lookAt = new THREE.Vector3();
    this.raycaster = new THREE.Raycaster();
    this.pointerNdc = new THREE.Vector2();

    addEventListener('resize', () => this._onResize());
  }

  _pixelRatio() {
    const caps = [0.85, 1.15, 1.5];
    return Math.min(devicePixelRatio || 1, caps[this.quality]);
  }

  _applySize() {
    const w = innerWidth, h = innerHeight, pr = this._pixelRatio();
    this.renderer.setPixelRatio(pr);
    this.renderer.setSize(w, h);
    this.composer.setPixelRatio(pr);
    this.composer.setSize(w, h);
    // UnrealBloom 默认从半分辨率开始；再减半，太阳仍有柔光但填充率大幅降低
    this.bloom.setSize(Math.max(1, Math.floor(w * pr * 0.5)), Math.max(1, Math.floor(h * pr * 0.5)));
  }

  _setQuality(level) {
    const next = Math.max(0, Math.min(2, level));
    if (next === this.quality) return;
    this.quality = next;
    this.bloom.enabled = next > 0;
    this._lastQualityChange = performance.now() / 1000;
    this._applySize();
  }

  getStats() {
    return {
      fps: Math.round(this._fps * 10) / 10,
      quality: this.quality,
      pixelRatio: this.renderer.getPixelRatio(),
      bloom: this.bloom.enabled,
      textures: this.renderer.info.memory.textures,
      triangles: this.renderer.info.render.triangles,
      highRes: this._highBody?.def.id || null,
      paused: this.motionPaused,
      overview: this.overview,
      flyT: this.flyT,
    };
  }

  // ---------------- 灯光与星空 ----------------
  _buildLights() {
    // 艺术化比例下不做距离衰减，让外侧行星仍有正确日照
    this.sunLight = new THREE.PointLight(0xfff2dd, 1.85, 0, 0);
    this.scene.add(this.sunLight);
    this.scene.add(new THREE.AmbientLight(0x293b5e, 0.48));
  }

  _buildSky() {
    const loader = new THREE.TextureLoader();
    loader.load('assets/textures/4k_stars.jpg', (tex) => {
      tex.colorSpace = THREE.SRGBColorSpace;
      const sky = new THREE.Mesh(
        new THREE.SphereGeometry(2600, 48, 32),
        new THREE.MeshBasicMaterial({ map: tex, side: THREE.BackSide, fog: false })
      );
      sky.rotation.y = Math.PI;
      this.scene.add(sky);
    });

    for (const [count, size, spread] of [[1400, 1.25, 2400], [550, 2.1, 1800]]) {
      const pos = new Float32Array(count * 3);
      for (let i = 0; i < count; i++) {
        const u = Math.random(), v = Math.random();
        const theta = u * Math.PI * 2;
        const phi = Math.acos(2 * v - 1);
        const r = spread * (0.6 + 0.4 * Math.random());
        pos[i * 3] = r * Math.sin(phi) * Math.cos(theta);
        pos[i * 3 + 1] = r * Math.cos(phi);
        pos[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      this.scene.add(new THREE.Points(geo, new THREE.PointsMaterial({
        color: 0xffffff, size, sizeAttenuation: true,
        transparent: true, opacity: 0.82, fog: false,
      })));
    }
  }

  // ---------------- 星尘轨迹 ----------------
  // 手的屏幕位置 → 相机前方射线上的一点，粒子留在世界空间里自然飘散
  _buildDust() {
    const cap = 420;
    this._dustCap = cap;
    this._dustHead = 0;
    this._dustPos = new Float32Array(cap * 3);
    this._dustCol = new Float32Array(cap * 3);
    this._dustVel = new Float32Array(cap * 3);
    this._dustTint = new Float32Array(cap * 3);
    this._dustLife = new Float32Array(cap);
    for (let i = 0; i < cap; i++) this._dustPos[i * 3 + 1] = 1e6;
    this._dustColor = new THREE.Color();
    this._dustWhite = new THREE.Color(0xffffff);

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this._dustPos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('color', new THREE.BufferAttribute(this._dustCol, 3).setUsage(THREE.DynamicDrawUsage));
    // 粒子在世界里到处飘，交给手动包围球避免每帧重算
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);

    const cv = document.createElement('canvas');
    cv.width = cv.height = 64;
    const ctx = cv.getContext('2d');
    const grad = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.28, 'rgba(255,255,255,0.62)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 64, 64);

    this.dust = new THREE.Points(geo, new THREE.PointsMaterial({
      size: 2.4,
      map: new THREE.CanvasTexture(cv),
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      vertexColors: true,
      sizeAttenuation: true,
      opacity: 0.9,
    }));
    this.dust.frustumCulled = false;
    this.dust.visible = false;
    this.scene.add(this.dust);
  }

  /** nx, ny: 归一化设备坐标 -1~1；color: 0xRRGGBB */
  spawnDust(nx, ny, color, count = 2) {
    if (!this.dust) return;
    const cam = this.camera;
    const dir = this._v1.set(nx, ny, 0.5).unproject(cam).sub(cam.position).normalize();
    const depth = Math.max(5, cam.position.distanceTo(this.focusPos) * 0.5);
    const ox = cam.position.x + dir.x * depth;
    const oy = cam.position.y + dir.y * depth;
    const oz = cam.position.z + dir.z * depth;
    const spread = depth * 0.012;

    this._dustColor.set(color);
    // 往白色偏一点：纯行星色在深空里偏暗，掺白后更像星光
    this._dustColor.lerp(this._dustWhite, 0.32);
    // 让粒子在屏幕上保持稳定的像素大小（约 5px），不随远近忽大忽小
    this.dust.material.size = depth * 0.011;
    this.dust.visible = true;

    for (let k = 0; k < count; k++) {
      const i = this._dustHead;
      this._dustHead = (this._dustHead + 1) % this._dustCap;
      const j = i * 3;
      this._dustPos[j] = ox + (Math.random() - 0.5) * spread;
      this._dustPos[j + 1] = oy + (Math.random() - 0.5) * spread;
      this._dustPos[j + 2] = oz + (Math.random() - 0.5) * spread;
      this._dustVel[j] = (Math.random() - 0.5) * depth * 0.05;
      this._dustVel[j + 1] = (Math.random() - 0.5) * depth * 0.05 + depth * 0.012;
      this._dustVel[j + 2] = (Math.random() - 0.5) * depth * 0.05;
      this._dustTint[j] = this._dustColor.r;
      this._dustTint[j + 1] = this._dustColor.g;
      this._dustTint[j + 2] = this._dustColor.b;
      this._dustLife[i] = 1;
    }
    this.dust.geometry.attributes.position.needsUpdate = true;
  }

  _updateDust(dt) {
    if (!this.dust || !this.dust.visible) return;
    const pos = this._dustPos, col = this._dustCol, vel = this._dustVel;
    const tint = this._dustTint, life = this._dustLife;
    let alive = false;

    for (let i = 0; i < this._dustCap; i++) {
      const j = i * 3;
      if (life[i] <= 0) { col[j] = col[j + 1] = col[j + 2] = 0; continue; }
      life[i] -= dt / 1.35;
      if (life[i] <= 0) {
        life[i] = 0;
        col[j] = col[j + 1] = col[j + 2] = 0;
        continue;
      }
      alive = true;
      pos[j] += vel[j] * dt;
      pos[j + 1] += vel[j + 1] * dt;
      pos[j + 2] += vel[j + 2] * dt;
      vel[j] *= 0.986; vel[j + 1] *= 0.986; vel[j + 2] *= 0.986;
      // additive 混合下亮度衰减等价于透明度淡出
      const k = Math.pow(life[i], 1.6) * 1.05;
      col[j] = tint[j] * k;
      col[j + 1] = tint[j + 1] * k;
      col[j + 2] = tint[j + 2] * k;
    }

    this.dust.geometry.attributes.position.needsUpdate = true;
    this.dust.geometry.attributes.color.needsUpdate = true;
    if (!alive) this.dust.visible = false;
  }

  // ---------------- 材质与天体 ----------------
  _makeGlowSprite(r, g, b, size, opacity) {
    const cv = document.createElement('canvas');
    cv.width = cv.height = 256;
    const ctx = cv.getContext('2d');
    const grad = ctx.createRadialGradient(128, 128, 0, 128, 128, 128);
    grad.addColorStop(0, `rgba(${r},${g},${b},0.85)`);
    grad.addColorStop(0.35, `rgba(${r},${g},${b},0.30)`);
    grad.addColorStop(1, `rgba(${r},${g},${b},0)`);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 256, 256);
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({
      map: new THREE.CanvasTexture(cv), transparent: true, opacity,
      depthWrite: false, blending: THREE.AdditiveBlending,
    }));
    sp.scale.setScalar(size);
    return sp;
  }

  _configTex(tex) {
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    return tex;
  }

  _loadTex(loader, url) {
    return this._configTex(loader.load(url));
  }

  _makeAtmosphere(radius, color, intensity) {
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uColor: { value: new THREE.Color(color) },
        uIntensity: { value: intensity },
        uPlanetCenter: { value: new THREE.Vector3() },
      },
      vertexShader: /* glsl */`
        varying vec3 vWorldNormal;
        varying vec3 vWorldPos;
        void main() {
          vec4 world = modelMatrix * vec4(position, 1.0);
          vWorldPos = world.xyz;
          vWorldNormal = normalize(mat3(modelMatrix) * normal);
          gl_Position = projectionMatrix * viewMatrix * world;
        }`,
      fragmentShader: /* glsl */`
        uniform vec3 uColor;
        uniform float uIntensity;
        uniform vec3 uPlanetCenter;
        varying vec3 vWorldNormal;
        varying vec3 vWorldPos;
        void main() {
          vec3 n = normalize(vWorldNormal);
          vec3 viewDir = normalize(cameraPosition - vWorldPos);
          vec3 sunDir = normalize(-uPlanetCenter);
          float rim = pow(1.0 - abs(dot(n, viewDir)), 3.1);
          float daylight = smoothstep(-0.28, 0.38, dot(n, sunDir));
          float alpha = rim * uIntensity * (0.12 + 0.88 * daylight);
          gl_FragColor = vec4(uColor * (0.55 + 0.45 * daylight), alpha);
        }`,
      transparent: true,
      side: THREE.BackSide,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    return new THREE.Mesh(new THREE.SphereGeometry(radius * 1.14, 64, 40), mat);
  }

  _makeEarthMaterial(loader, day, night) {
    const mat = new THREE.MeshStandardMaterial({
      map: this._loadTex(loader, day),
      emissiveMap: this._loadTex(loader, night),
      emissive: new THREE.Color(0xffd7a0),
      emissiveIntensity: 1.6,
      roughness: 0.78,
      metalness: 0,
    });
    // 让城市灯光只出现在夜面，保留 MeshStandard 的真实日照与晨昏线
    mat.userData.sunViewDir = { value: new THREE.Vector3(0, 0, 1) };
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uSunViewDir = mat.userData.sunViewDir;
      shader.fragmentShader = 'uniform vec3 uSunViewDir;\n' + shader.fragmentShader;
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
         float nightSide = 1.0 - smoothstep(-0.16, 0.18, dot(normalize(normal), normalize(uSunViewDir)));
         totalEmissiveRadiance *= nightSide;`
      );
    };
    mat.customProgramCacheKey = () => 'earth-day-night-v1';
    return mat;
  }

  _makeSaturnRing(loader, def) {
    const { inner, outer, texture } = def.ring;
    const geo = new THREE.RingGeometry(inner, outer, 192, 3);
    const pos = geo.attributes.position;
    const uv = geo.attributes.uv;
    const v = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i);
      uv.setXY(i, (v.length() - inner) / (outer - inner), 0.5);
    }
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uMap: { value: this._loadTex(loader, texture) },
        uPlanetCenter: { value: new THREE.Vector3() },
        uPlanetRadius: { value: def.radius },
      },
      vertexShader: /* glsl */`
        varying vec2 vUv;
        varying vec3 vWorldPos;
        varying vec3 vWorldNormal;
        void main() {
          vUv = uv;
          vec4 world = modelMatrix * vec4(position, 1.0);
          vWorldPos = world.xyz;
          vWorldNormal = normalize(mat3(modelMatrix) * normal);
          gl_Position = projectionMatrix * viewMatrix * world;
        }`,
      fragmentShader: /* glsl */`
        uniform sampler2D uMap;
        uniform vec3 uPlanetCenter;
        uniform float uPlanetRadius;
        varying vec2 vUv;
        varying vec3 vWorldPos;
        varying vec3 vWorldNormal;
        void main() {
          vec4 tex = texture2D(uMap, vUv);
          if (tex.a < 0.015) discard;
          vec3 sunDir = normalize(-uPlanetCenter);
          vec3 rel = vWorldPos - uPlanetCenter;
          float behind = step(dot(rel, sunDir), 0.0);
          float axial = dot(rel, sunDir);
          float radial = length(rel - sunDir * axial);
          float litShadow = smoothstep(uPlanetRadius * 0.88, uPlanetRadius * 1.08, radial);
          float shadow = mix(1.0, 0.20 + 0.80 * litShadow, behind);
          float lambert = 0.62 + 0.38 * abs(dot(normalize(vWorldNormal), sunDir));
          gl_FragColor = vec4(tex.rgb * lambert * shadow, tex.a * 0.96);
        }`,
      side: THREE.DoubleSide,
      transparent: true,
      depthWrite: false,
    });
    const ring = new THREE.Mesh(geo, mat);
    ring.rotation.x = Math.PI / 2;
    return ring;
  }

  _buildBodies() {
    const loader = new THREE.TextureLoader();
    for (const def of BODIES) {
      const pivot = new THREE.Group();
      this.scene.add(pivot);
      const holder = new THREE.Group();
      holder.position.x = def.orbitRadius;
      pivot.add(holder);

      const lowTexture = lowRes(def.texture);
      let mesh;
      if (def.emissive) {
        mesh = new THREE.Mesh(
          new THREE.SphereGeometry(def.radius, 96, 64),
          new THREE.MeshBasicMaterial({ map: this._loadTex(loader, lowTexture) })
        );
        holder.add(this._makeGlowSprite(255, 174, 88, def.radius * 7.2, 0.82));
        holder.add(this._makeGlowSprite(255, 238, 198, def.radius * 3.5, 0.90));
      } else if (def.id === 'earth') {
        mesh = new THREE.Mesh(
          new THREE.SphereGeometry(def.radius, 96, 64),
          this._makeEarthMaterial(loader, lowTexture, lowRes(def.night))
        );
      } else {
        mesh = new THREE.Mesh(
          new THREE.SphereGeometry(def.radius, 96, 64),
          new THREE.MeshStandardMaterial({
            map: this._loadTex(loader, lowTexture),
            roughness: def.id === 'earth' ? 0.78 : 0.92,
            metalness: 0,
          })
        );
      }
      holder.add(mesh);

      let atmosphere = null;
      const atm = ATMOS[def.id];
      if (atm) {
        atmosphere = this._makeAtmosphere(def.radius, atm[0], atm[1]);
        holder.add(atmosphere);
      }

      let clouds = null, cloudLow = null;
      if (def.clouds) {
        cloudLow = lowRes(def.clouds);
        const cloudTex = this._loadTex(loader, cloudLow);
        clouds = new THREE.Mesh(
          new THREE.SphereGeometry(def.radius * 1.018, 64, 40),
          new THREE.MeshStandardMaterial({
            map: cloudTex, alphaMap: cloudTex,
            transparent: true, opacity: 0.64, depthWrite: false, roughness: 1,
          })
        );
        holder.add(clouds);
      }

      if (def.tiltDeg) holder.rotation.z = THREE.MathUtils.degToRad(def.tiltDeg);

      let ring = null;
      if (def.ring) {
        ring = this._makeSaturnRing(loader, def);
        holder.add(ring);
      }

      let moon = null, moonLow = null;
      if (def.hasMoon) {
        moon = new THREE.Group();
        moonLow = 'assets/textures/2k_moon.jpg';
        const mMesh = new THREE.Mesh(
          new THREE.SphereGeometry(0.45, 48, 32),
          new THREE.MeshStandardMaterial({ map: this._loadTex(loader, moonLow), roughness: 1 })
        );
        mMesh.position.x = 3.6;
        moon.add(mMesh);
        moon.userData.mesh = mMesh;
        holder.add(moon);
      }

      if (def.orbitRadius > 0) {
        const pts = [];
        for (let i = 0; i <= 192; i++) {
          const a = (i / 192) * Math.PI * 2;
          pts.push(new THREE.Vector3(Math.cos(a) * def.orbitRadius, 0, Math.sin(a) * def.orbitRadius));
        }
        this.scene.add(new THREE.Line(
          new THREE.BufferGeometry().setFromPoints(pts),
          new THREE.LineBasicMaterial({ color: def.color, transparent: true, opacity: 0.14 })
        ));
      }

      const angle = Math.random() * Math.PI * 2;
      pivot.rotation.y = angle;
      this.bodies.push({
        def, pivot, holder, mesh, moon, angle, atmosphere, clouds, ring,
        lowTexture, highTexture: def.texture,
        cloudLow, cloudHigh: def.clouds || null,
        nightLow: def.night ? lowRes(def.night) : null,
        nightHigh: def.night || null,
        moonLow,
        lowMaps: {
          surface: mesh.material.map,
          clouds: clouds?.material.map || null,
          night: def.night ? mesh.material.emissiveMap : null,
          moon: moon?.userData.mesh.material.map || null,
        },
        currentHigh: null,
      });
    }
  }

  // ---------------- 动态 8K：任意时刻最多一颗天体持有高清贴图 ----------------
  async _loadHighRes(body) {
    if (this._highBody === body && body.currentHigh) return;
    const token = ++this._highToken;

    if (this._highBody && this._highBody !== body) this._restoreLow(this._highBody);
    this._highBody = null;
    if (body.highTexture === body.lowTexture) return;

    const urls = [body.highTexture];
    if (body.cloudHigh && body.cloudHigh !== body.cloudLow) urls.push(body.cloudHigh);
    if (body.nightHigh && body.nightHigh !== body.nightLow) urls.push(body.nightHigh);
    if (body.moonLow) urls.push('assets/textures/4k_moon.jpg');

    try {
      const loader = new THREE.TextureLoader();
      const textures = await Promise.all(urls.map((url) => loader.loadAsync(url)));
      textures.forEach((tex) => this._configTex(tex));
      if (token !== this._highToken || this.overview || this.bodies[this.focusIndex] !== body) {
        textures.forEach((tex) => tex.dispose());
        return;
      }

      let cursor = 0;
      body.mesh.material.map = textures[cursor++];
      if (body.cloudHigh && body.cloudHigh !== body.cloudLow) {
        const cloudTex = textures[cursor++];
        body.clouds.material.map = cloudTex;
        body.clouds.material.alphaMap = cloudTex;
      }
      if (body.nightHigh && body.nightHigh !== body.nightLow) {
        body.mesh.material.emissiveMap = textures[cursor++];
      }
      if (body.moonLow) body.moon.userData.mesh.material.map = textures[cursor++];
      body.currentHigh = textures;
      this._highBody = body;
    } catch (err) {
      console.warn(`高清贴图加载失败，保留流畅模式：${body.def.id}`, err);
    }
  }

  _restoreLow(body) {
    if (!body.currentHigh) return;
    body.mesh.material.map = body.lowMaps.surface;
    if (body.clouds) {
      body.clouds.material.map = body.lowMaps.clouds;
      body.clouds.material.alphaMap = body.lowMaps.clouds;
    }
    if (body.nightLow) body.mesh.material.emissiveMap = body.lowMaps.night;
    if (body.moonLow) body.moon.userData.mesh.material.map = body.lowMaps.moon;
    body.currentHigh.forEach((tex) => tex.dispose());
    body.currentHigh = null;
  }

  // ---------------- 焦点、全景与相机 ----------------
  setFocus(index) {
    if (this.focusIndex !== undefined && (this.focusIndex !== index || this.overview)) {
      const prev = this.bodies[this.focusIndex];
      prev.holder.getWorldPosition(this._v4);
      this._startOffset = this.camera.position.clone().sub(this._v4);
    }
    this.overview = false;
    this.focusIndex = index;
    this.zoomTarget = 1;
    this.flyT = 0;
    this._loadHighRes(this.bodies[index]);
  }

  setOverview() {
    if (!this.overview) {
      const prev = this.bodies[this.focusIndex];
      prev.holder.getWorldPosition(this._v4);
      this._startOffset = this.camera.position.clone().sub(this._v4);
    }
    ++this._highToken; // 取消尚未完成的聚焦高清加载
    if (this._highBody) {
      this._restoreLow(this._highBody);
      this._highBody = null;
    }
    this.overview = true;
    this.zoomTarget = 1;
    this.flyT = 0;
  }

  togglePause() {
    this.motionPaused = !this.motionPaused;
    return this.motionPaused;
  }

  getFocusBody() {
    return this.bodies[this.focusIndex ?? 0];
  }

  _onResize() {
    this.camera.aspect = innerWidth / innerHeight;
    this.camera.updateProjectionMatrix();
    this._applySize();
  }

  pick(clientX, clientY) {
    this.pointerNdc.set((clientX / innerWidth) * 2 - 1, -(clientY / innerHeight) * 2 + 1);
    this.raycaster.setFromCamera(this.pointerNdc, this.camera);
    const meshes = this.bodies.map((b) => b.mesh);
    const hits = this.raycaster.intersectObjects(meshes, false);
    if (!hits.length) return null;
    const idx = this.bodies.findIndex((b) => b.mesh === hits[0].object);
    return idx >= 0 ? idx : null;
  }

  // ---------------- 主循环 ----------------
  update(dt, rawDt = dt) {
    if (!this.motionPaused) {
      this.time += dt;
      for (const b of this.bodies) {
        if (b.def.orbitSpeed) b.pivot.rotation.y += b.def.orbitSpeed * dt * 0.35;
        b.mesh.rotation.y += b.def.spinSpeed * dt * 3;
        if (b.moon) {
          b.moon.rotation.y += dt * 1.6;
          b.moon.userData.mesh.rotation.y += dt * 0.4;
        }
      }
      const earth = this.bodies.find((b) => b.def.id === 'earth');
      if (earth?.clouds) earth.clouds.rotation.y += dt * 0.05;
    }

    const focus = this.getFocusBody();
    if (this.overview) this.focusPos.set(0, 0, 0);
    else focus.holder.getWorldPosition(this.focusPos);

    this.zoomFactor += (this.zoomTarget - this.zoomFactor) * Math.min(1, dt * 6.5);
    const wantDist = (this.overview ? 430 : focus.def.focusDist) * this.zoomFactor;
    if (this.flyT < 1) this.flyT = Math.min(1, this.flyT + dt * 0.9);
    const flyEase = 1 - Math.pow(1 - this.flyT, 3);

    const az = this.camAzimuth;
    // 全景沿用同一个俯仰角做等比压低，拖拽视角时全景也会跟着变，
    // 而不是锁死在固定机位
    const po = this.overview ? clampPolar(this.camPolar * 0.63) : this.camPolar;
    const dirOut = this._v1;
    if (this.overview || focus.def.emissive) {
      dirOut.set(Math.sin(po) * Math.cos(az), Math.cos(po), Math.sin(po) * Math.sin(az));
    } else {
      dirOut.copy(this.focusPos).normalize().negate();
      dirOut.applyAxisAngle(this._up, az);
      dirOut.multiplyScalar(Math.sin(po)).add(this._v2.set(0, Math.cos(po), 0)).normalize();
    }
    const targetOffset = this._v2.copy(dirOut).multiplyScalar(wantDist);

    if (this._startOffset) {
      const offset = this._v3.copy(this._startOffset).lerp(targetOffset, flyEase);
      if (this.flyT >= 1) this._startOffset = null;
      this.camera.position.copy(this.focusPos).add(offset);
    } else {
      this.camera.position.copy(this.focusPos).add(targetOffset);
    }
    this.lookAt.copy(this.focusPos);
    this.camera.lookAt(this.lookAt);
    this.camera.updateMatrixWorld();

    // 大气中心、土星环阴影和地球昼夜方向
    for (const b of this.bodies) {
      if (b.atmosphere || b.ring || b.def.id === 'earth') b.holder.getWorldPosition(this._v4);
      if (b.atmosphere) b.atmosphere.material.uniforms.uPlanetCenter.value.copy(this._v4);
      if (b.ring) b.ring.material.uniforms.uPlanetCenter.value.copy(this._v4);
      if (b.def.id === 'earth') {
        const uniform = b.mesh.material.userData.sunViewDir;
        uniform.value.copy(this._v4).negate().normalize().transformDirection(this.camera.matrixWorldInverse);
      }
    }

    this._updateDust(dt);

    // 性能模式完全绕开 HDR 离屏渲染与全屏 OutputPass，而非只关 Bloom
    if (this.quality === 0) this.renderer.render(this.scene, this.camera);
    else this.composer.render();

    // 连续低帧才降级，避免加载瞬间误触发；高画质恢复有更长冷却
    if (this.adaptive && rawDt > 0 && rawDt < 0.5) {
      this._fps += ((1 / rawDt) - this._fps) * 0.04;
      this._qualityClock += rawDt;
      const now = performance.now() / 1000;
      if (this._qualityClock > 3 && now > 5) {
        this._qualityClock = 0;
        if (this._fps < 43 && this.quality > 0) this._setQuality(this.quality - 1);
        else if (this._fps > 58 && this.quality < 2 && now - this._lastQualityChange > 10) {
          this._setQuality(this.quality + 1);
        }
      }
    }
  }
}
