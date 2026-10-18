// 拖拽/抛掷物理纯函数：松手初速估算 / 抛掷积分 / 静止判定 / 力度档位。
//
// 移植自 MerZlin/dsh-pet-indesktop 的 pet/physics.py（MIT License,
// Copyright (c) 2026 Merzlin，见 THIRD_PARTY_NOTICES.md）。保留了原实现的
// 参数取值依据注释；函数语义逐一对齐（trail 元素 [t, x, y] 对应原 tuple）。
// 未移植部分：拖拽弹簧（本项目拖拽用绝对定位协议，天然跟手无需弹簧）与
// 弹弓交互（无此功能）。
//
// 纯函数、无 DOM 依赖，可直接单元测试（对齐原仓库 tests/test_physics.py）。

// ---- 松手初速估算 ----
export const TRAIL_KEEP_SEC = 0.15;    // 拖拽途中只保留这么长的轨迹
export const RELEASE_WINDOW_SEC = 0.12; // 初速估算取末尾这段窗口
export const RELEASE_STALE_SEC = 0.15; // 松手前停顿超过它 = 静止放下（不带残余速度）
export const MIN_SPAN_SEC = 0.02;      // 窗口太短视为不可估算
export const SEG_MIN_DT = 0.008;       // 分段速度的最小 dt：高回报率鼠标事件间隔可低至 1ms，
                                       // 过小的 dt 会把抖动放大成虚假峰值，短段向前合并
export const DEAD_ZONE_SPEED = 500.0;  // 低于此速度 = 原地放下（px/s）
export const MAX_THROW_SPEED = 6000.0; // 甩出速度上限默认值（px/s）：软膝渐近值
export const PEAK_WEIGHT = 0.5;        // 初速大小 = 端点均值*(1-w) + 窗口峰值*w
export const ACCEL_REF = 8000.0;       // 参考加速度（px/s²）：末段加速达到它即吃满增益
export const ACCEL_GAIN_MAX = 1.5;     // 加速度增益上限：×1.5

// ---- 抛掷积分 ----
export const GRAVITY = 3000.0;         // 重力（px/s²）：桌面像素尺度下的观感重量
export const RESTITUTION = 0.35;       // 边界反弹系数：0.35 ≈ 两成能量损耗/次
export const GROUND_FRICTION = 4.0;    // 地面（屏幕底边）水平摩擦（1/s）
export const GROUND_BOUNCE_STOP_VY = 80.0; // 落地竖直速度截止：小跳不再模拟
export const REST_VX = 20.0;           // 静止判定：水平速度阈值（px/s）
export const REST_VY = 60.0;           // 静止判定：碰边后整体速度阈值（px/s）

// ---- 抛掷力度档位（软上限） ----
export const THROW_STRENGTH_CAPS = {
  gentle: 3600.0,
  standard: 4800.0,
  strong: 7200.0,
  crazy: 9000.0
};

/** 力度档名归一化：未知/缺省 → standard。 */
export function normalizeThrowStrength(value) {
  const key = String(value == null ? "" : value).toLowerCase();
  return Object.prototype.hasOwnProperty.call(THROW_STRENGTH_CAPS, key) ? key : "standard";
}

/** 档位对应的甩出速度软上限（px/s）。 */
export function throwSpeedCap(strength) {
  return THROW_STRENGTH_CAPS[normalizeThrowStrength(strength)];
}

/**
 * 速度软上限（软膝）：v' = cap·(1 - e^(-v·k/cap))。
 * 低速 v'≈v·k（微增甩感），单调递增渐近 cap 永不穿透——避免硬截断的速度跳变。
 */
export function softClampSpeed(speed, cap = MAX_THROW_SPEED) {
  if (!(speed > 0) || !(cap > 0)) return 0;
  const k = 1.15; // 软膝系数：低速段微增益
  return cap * (1 - Math.exp((-speed * k) / cap));
}

/**
 * 松手初速估算：取轨迹末尾 RELEASE_WINDOW_SEC 窗口。
 * 大小 = 端点均值×(1-PEAK_WEIGHT) + 分段峰值×PEAK_WEIGHT，叠加末段加速度增益
 * （甩尾比匀速更远，加速度 = 端点速度差的线性回归）。停顿（RELEASE_STALE_SEC）
 * 或窗口过短（MIN_SPAN_SEC）= 原地放下。高回报率噪声用 SEG_MIN_DT 前向合并抑制。
 * @param {Array<[number,number,number]>} trail 轨迹 [t, x, y]（t 秒）
 * @param {number} now 松手时刻（秒，与 trail 同一时基）
 * @param {number} cap 速度软上限
 * @returns {[number, number]} [vx, vy] px/s
 */
export function estimateReleaseVelocity(trail, now, cap = MAX_THROW_SPEED) {
  if (!Array.isArray(trail) || trail.length < 2) return [0, 0];
  const windowStart = now - RELEASE_WINDOW_SEC;
  const segs = [];
  for (let i = 1; i < trail.length; i += 1) {
    const [t0, x0, y0] = trail[i - 1];
    const [t1, x1, y1] = trail[i];
    const dt = t1 - t0;
    if (dt < SEG_MIN_DT && segs.length > 0) {
      // 短段向前合并：避免高回报率抖动放大成虚假峰值
      const last = segs[segs.length - 1];
      last.t1 = t1; last.x1 = x1; last.y1 = y1;
    } else {
      segs.push({ t0, t1, x0, x1, y0, y1 });
    }
  }
  const win = segs.filter((s) => s.t1 >= windowStart);
  if (win.length === 0) return [0, 0];
  const first = win[0];
  const last = win[win.length - 1];
  const span = last.t1 - first.t0;
  const stale = now - last.t1 > RELEASE_STALE_SEC;
  if (stale || span < MIN_SPAN_SEC) return [0, 0];
  // 端点速度（窗口首尾位移）
  const ex = (last.x1 - first.x0) / span;
  const ey = (last.y1 - first.y0) / span;
  // 分段峰值速度
  let peak = 0;
  for (const s of win) {
    const dt = s.t1 - s.t0;
    if (dt <= 0) continue;
    const v = Math.hypot((s.x1 - s.x0) / dt, (s.y1 - s.y0) / dt);
    if (v > peak) peak = v;
  }
  // 末段加速度增益：末 1/3 窗口的加速度达到 ACCEL_REF 即吃满 ACCEL_GAIN_MAX
  const tail = win.slice(Math.max(0, Math.floor(win.length * 2 / 3)));
  let gain = 1.0;
  if (tail.length >= 2) {
    const a = win[win.length - 1];
    const b = tail[0];
    const dtTail = a.t1 - b.t0;
    if (dtTail > 1e-4) {
      const ax = ((a.x1 - a.x0) / (a.t1 - a.t0) - (b.x1 - b.x0) / (b.t1 - b.t0)) / dtTail;
      const ay = ((a.y1 - a.y0) / (a.t1 - a.t0) - (b.y1 - b.y0) / (b.t1 - b.t0)) / dtTail;
      const mag = Math.hypot(ax, ay);
      gain = 1.0 + (ACCEL_GAIN_MAX - 1.0) * Math.min(1, mag / ACCEL_REF);
    }
  }
  const mag = (Math.hypot(ex, ey) * (1 - PEAK_WEIGHT) + peak * PEAK_WEIGHT) * gain;
  const capped = softClampSpeed(mag, cap);
  const base = Math.hypot(ex, ey);
  if (base < 1e-6) return [0, 0];
  const scale = capped / base;
  return [ex * scale, ey * scale];
}

/** 飞行期动画速度倍率：越快跑得越快，1.0~2.0 线性渐近。 */
export function flightAnimSpeed(speedPxS) {
  return 1.0 + Math.min(1.0, speedPxS / MAX_THROW_SPEED);
}

/**
 * 抛掷单步积分 + 边界反弹。返回 [px, py, vx, vy, bounced]。
 * py >= bottom 为地面：水平摩擦，竖直速度低于截止值则停。
 */
export function throwStep(px, py, vx, vy, dt, left, top, right, bottom) {
  vy += GRAVITY * dt;
  px += vx * dt;
  py += vy * dt;
  let bounced = false;
  if (px < left) { px = left; vx = Math.abs(vx) * RESTITUTION; bounced = true; }
  else if (px > right) { px = right; vx = -Math.abs(vx) * RESTITUTION; bounced = true; }
  if (py < top) { py = top; vy = Math.abs(vy) * RESTITUTION; bounced = true; }
  else if (py >= bottom) {
    py = bottom;
    vx *= Math.max(0, 1.0 - GROUND_FRICTION * dt);
    if (Math.abs(vy) < GROUND_BOUNCE_STOP_VY) vy = 0;
    else vy = -Math.abs(vy) * RESTITUTION;
    bounced = true;
  }
  return [px, py, vx, vy, bounced];
}

/** 抛掷终止判定：贴地且双轴低速，或碰边后整体低速。 */
export function isAtRest(py, vx, vy, bottom, bounced, speed) {
  if (py >= bottom - 1 && Math.abs(vy) < 1 && Math.abs(vx) < REST_VX) return true;
  return bounced && speed < REST_VY && Math.abs(vy) < 1;
}
