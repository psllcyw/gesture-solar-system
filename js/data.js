// ============================================================
// 天体数据 · 手势太阳系
// 尺寸/轨道为艺术化比例（真实比例下行星肉眼不可见），
// 资料数据为真实值。贴图为 Solar System Scope CC 授权。
// ============================================================

export const BODIES = [
  {
    id: 'sun',
    name: '太阳',
    en: 'SOL',
    type: '恒星 · G2V 黄矮星',
    color: 0xffb84d,
    radius: 16,            // 艺术半径
    orbitRadius: 0,        // 太阳在原点
    orbitSpeed: 0,         // 不公转
    spinSpeed: 0.02,       // 自转（相对速度）
    texture: 'assets/textures/4k_sun.jpg',
    emissive: true,
    focusDist: 52,         // 聚焦时相机距离
    stats: [
      ['直径', '139.2 万公里'],
      ['质量占比', '太阳系总质量的 99.86%'],
      ['表面温度', '约 5500 ℃'],
      ['核心温度', '约 1500 万 ℃'],
    ],
    fact: '太阳每秒把约 400 万吨物质转化成能量——你此刻晒到的每一缕阳光，都是 8 分 20 秒前从它表面出发的。',
  },
  {
    id: 'mercury',
    name: '水星',
    en: 'MERCURY',
    type: '类地行星 · 离太阳最近',
    color: 0xb8a698,
    radius: 1.0,
    orbitRadius: 30,
    orbitSpeed: 0.85,
    spinSpeed: 0.06,
    texture: 'assets/textures/4k_mercury.jpg',
    focusDist: 9,
    stats: [
      ['直径', '4,879 公里'],
      ['距太阳', '5,790 万公里'],
      ['一天', '59 个地球日'],
      ['昼夜温差', '-173 ℃ ～ 427 ℃'],
    ],
    fact: '水星是太阳系昼夜温差最大的行星——没有大气层保温，被太阳晒的一面滚烫，背面却冷得能冻住空气。',
  },
  {
    id: 'venus',
    name: '金星',
    en: 'VENUS',
    type: '类地行星 · 最热的行星',
    color: 0xe8c78e,
    radius: 1.7,
    orbitRadius: 43,
    orbitSpeed: 0.62,
    spinSpeed: -0.02,      // 逆向自转
    texture: 'assets/textures/4k_venus.jpg',
    focusDist: 11,
    stats: [
      ['直径', '12,104 公里'],
      ['距太阳', '1.08 亿公里'],
      ['一天', '243 个地球日'],
      ['表面温度', '约 465 ℃'],
    ],
    fact: '金星上的"一天"比"一年"还长，而且它是倒着转的——在金星上，太阳从西边升起。',
  },
  {
    id: 'earth',
    name: '地球',
    en: 'EARTH',
    type: '类地行星 · 我们的家园',
    color: 0x4d7fd6,
    radius: 1.8,
    orbitRadius: 58,
    orbitSpeed: 0.48,
    spinSpeed: 0.32,
    texture: 'assets/textures/4k_earth.jpg',
    clouds: 'assets/textures/4k_earth_clouds.jpg',   // 云层
    night: 'assets/textures/4k_earth_nightmap.jpg',  // 夜间城市灯光
    focusDist: 11,
    stats: [
      ['直径', '12,756 公里'],
      ['距太阳', '1.496 亿公里'],
      ['一天', '23 小时 56 分'],
      ['一年', '365.25 天'],
    ],
    fact: '地球是目前已知唯一存在生命的星球。它 71% 的表面被海洋覆盖，从太空看是一颗蓝色弹珠。',
    hasMoon: true,
  },
  {
    id: 'mars',
    name: '火星',
    en: 'MARS',
    type: '类地行星 · 红色星球',
    color: 0xd1693f,
    radius: 1.3,
    orbitRadius: 74,
    orbitSpeed: 0.38,
    spinSpeed: 0.30,
    texture: 'assets/textures/4k_mars.jpg',
    focusDist: 9,
    stats: [
      ['直径', '6,792 公里'],
      ['距太阳', '2.28 亿公里'],
      ['一天', '24 小时 37 分'],
      ['最高山峰', '奥林帕斯山 21.9 公里'],
    ],
    fact: '火星上的奥林帕斯山高约 21.9 公里，是珠穆朗玛峰的 2.5 倍——它是太阳系已知最高的火山。',
  },
  {
    id: 'jupiter',
    name: '木星',
    en: 'JUPITER',
    type: '气态巨行星 · 行星之王',
    color: 0xd8b48a,
    radius: 6.2,
    orbitRadius: 108,
    orbitSpeed: 0.20,
    spinSpeed: 0.55,
    texture: 'assets/textures/4k_jupiter.jpg',
    focusDist: 26,
    stats: [
      ['直径', '142,984 公里'],
      ['距太阳', '7.79 亿公里'],
      ['一天', '9 小时 56 分'],
      ['卫星', '已确认 95 颗'],
    ],
    fact: '木星的大红斑是一场刮了至少 350 年的巨型风暴，能装进整个地球。它转得也最快——一天不到 10 小时。',
  },
  {
    id: 'saturn',
    name: '土星',
    en: 'SATURN',
    type: '气态巨行星 · 戴草帽的行星',
    color: 0xe3d5a8,
    radius: 5.3,
    orbitRadius: 146,
    orbitSpeed: 0.145,
    spinSpeed: 0.48,
    tiltDeg: 26.7,
    texture: 'assets/textures/4k_saturn.jpg',
    ring: {
      texture: 'assets/textures/2k_saturn_ring.png',
      inner: 6.6,
      outer: 11.6,
    },
    focusDist: 28,
    stats: [
      ['直径', '120,536 公里'],
      ['距太阳', '14.3 亿公里'],
      ['一天', '10 小时 42 分'],
      ['环宽度', '约 28 万公里'],
    ],
    fact: '土星环主要由无数冰块和碎石组成，宽度能并排放下 20 多个地球，厚度却常常只有十几米——比例像一张薄纸。',
  },
  {
    id: 'uranus',
    name: '天王星',
    en: 'URANUS',
    type: '冰巨星 · 躺着转的行星',
    color: 0x9fd8dd,
    radius: 3.2,
    orbitRadius: 178,
    orbitSpeed: 0.10,
    spinSpeed: -0.35,
    tiltDeg: 97.8,
    texture: 'assets/textures/2k_uranus.jpg',
    focusDist: 16,
    stats: [
      ['直径', '51,118 公里'],
      ['距太阳', '28.7 亿公里'],
      ['一天', '17 小时 14 分'],
      ['自转轴倾角', '97.8°'],
    ],
    fact: '天王星几乎"躺"在轨道上滚动着绕太阳转，可能是因为远古时期被一颗地球大小的天体狠狠撞了一下。',
  },
  {
    id: 'neptune',
    name: '海王星',
    en: 'NEPTUNE',
    type: '冰巨星 · 风暴之王',
    color: 0x4666d1,
    radius: 3.1,
    orbitRadius: 205,
    orbitSpeed: 0.07,
    spinSpeed: 0.38,
    texture: 'assets/textures/2k_neptune.jpg',
    focusDist: 16,
    stats: [
      ['直径', '49,528 公里'],
      ['距太阳', '45 亿公里'],
      ['一天', '16 小时 6 分'],
      ['最大风速', '约 2,100 km/h'],
    ],
    fact: '海王星是太阳系风速最快的地方，风暴可达超音速——它是第一颗"先算出来、再看见"的行星。',
  },
];

// 手势参数（双手张合 / 单手推拉 / 挥手 / 握拳 / 张掌）
export const GESTURE = {
  // ---- 双手张合缩放 ----
  spreadMin: 1.35,       // 两手间距 / 手掌长度 的下限（手并拢）
  spreadRange: 5.0,      // 到上限的对数倍数（张开到 6.75 倍手掌长）
  // ---- 单手上下推拉（降级） ----
  heightMin: 0.20,       // 手掌中心 y 的上边界（画面上方 = 拉近）
  heightRange: 0.58,
  // ---- 共用 ----
  zoomDeadzone: 0.016,   // 归一化输入的增量死区，滤掉手部抖动
  zoomGainTwo: 2.2,      // 双手张合的缩放灵敏度
  zoomGainOne: 1.25,     // 单手推拉的缩放灵敏度
  zoomNear: 0.42,
  zoomFar: 3.2,
  // ---- 挥手切换 ----
  swipeSpeed: 0.90,
  swipeDistance: 0.14,
  swipeCooldown: 1.0,
  // ---- 停留手势 ----
  holdOpen: 1.10,        // 张开手掌停留：返回全景
  holdFist: 0.80,        // 握拳静止停留：暂停/继续
  holdStill: 0.045,      // 0.28s 内位移小于此值算“静止”，否则按推拉缩放处理
  // ---- 握拳拖拽旋转 ----
  dragStart: 0.05,       // 位移超过此值即进入拖拽，不再计暂停
  dragGainX: 2.8,
  dragGainY: 1.5,
};
