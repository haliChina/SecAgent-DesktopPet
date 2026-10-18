// 拖拽/抛掷物理纯函数测试。用例对齐 dsh-pet-indesktop 的 tests/test_physics.py
// （MIT, Copyright (c) 2026 Merzlin）：死区、快甩、方向、加速增益、停顿、
// 高回报率噪声、软上限、抛掷收敛、力度档位。弹簧与弹弓未移植故无其用例。
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEAD_ZONE_SPEED,
  MAX_THROW_SPEED,
  THROW_STRENGTH_CAPS,
  estimateReleaseVelocity,
  normalizeThrowStrength,
  softClampSpeed,
  throwSpeedCap,
  throwStep,
  isAtRest
} from "../pet/renderer/physics.js";

/** 由 (x, y) 序列生成等间隔轨迹，t 从 0 开始（对齐原 _trail）。 */
function trail(points, dt = 0.016) {
  return points.map(([x, y], i) => [i * dt, x, y]);
}

test("慢拖低于死区：估算速度 < DEAD_ZONE_SPEED", () => {
  const tr = trail(Array.from({ length: 8 }, (_, i) => [100 + i * 3, 100])); // ~187px/s
  const [vx, vy] = estimateReleaseVelocity(tr, tr[tr.length - 1][0]);
  assert.ok(Math.hypot(vx, vy) < DEAD_ZONE_SPEED);
});

test("快甩比慢甩快", () => {
  const slow = trail(Array.from({ length: 8 }, (_, i) => [100 + i * 5, 100]));
  const fast = trail(Array.from({ length: 8 }, (_, i) => [100 + i * 40, 100]));
  const vSlow = Math.hypot(...estimateReleaseVelocity(slow, slow[slow.length - 1][0]));
  const vFast = Math.hypot(...estimateReleaseVelocity(fast, fast[fast.length - 1][0]));
  assert.ok(vFast > vSlow);
});

test("方向保持：向左甩 vx<0、向右甩 vx>0", () => {
  const right = trail(Array.from({ length: 8 }, (_, i) => [100 + i * 30, 100]));
  const left = trail(Array.from({ length: 8 }, (_, i) => [100 - i * 30, 100]));
  const vR = estimateReleaseVelocity(right, right[right.length - 1][0]);
  const vL = estimateReleaseVelocity(left, left[left.length - 1][0]);
  assert.ok(vR[0] > 0);
  assert.ok(vL[0] < 0);
});

test("加速甩尾比匀速快（加速度增益）", () => {
  // 匀速 25px/帧；加速版从 5px/帧 加速到 45px/帧（端点均值相同）
  const steady = trail(Array.from({ length: 8 }, () => [100, 100]).map(([x], i) => [100 + i * 25, 100]));
  const accel = trail(Array.from({ length: 8 }, (_, i) => [100 + i * 5 + i * i * 5, 100]));
  const vS = Math.hypot(...estimateReleaseVelocity(steady, steady[steady.length - 1][0]));
  const vA = Math.hypot(...estimateReleaseVelocity(accel, accel[accel.length - 1][0]));
  assert.ok(vA > vS);
});

test("松手前停顿 = 原地放下（无残余速度）", () => {
  const tr = trail(Array.from({ length: 8 }, (_, i) => [100 + i * 40, 100]));
  const settled = tr[tr.length - 1][0] + 0.2; // 停顿 200ms > RELEASE_STALE_SEC
  const [vx, vy] = estimateReleaseVelocity(tr, settled);
  assert.equal(vx, 0);
  assert.equal(vy, 0);
});

test("高回报率鼠标噪声不被放大成虚假峰值", () => {
  // 1ms 间隔、交替 +40/-2 的抖动流：合并后不应出现远超平均的峰值
  const points = [];
  let x = 0;
  for (let i = 0; i < 40; i += 1) {
    x += i % 2 === 0 ? 40 : -2;
    points.push([x, 100]);
  }
  const tr = points.map(([px, py], i) => [i * 0.001, px, py]);
  const [vx, vy] = estimateReleaseVelocity(tr, tr[tr.length - 1][0]);
  // 平均速度 ~19px/ms = 19000px/s，软上限内；且不为 0（有效窗口）
  assert.ok(Math.hypot(vx, vy) > 0);
  assert.ok(Math.hypot(vx, vy) <= MAX_THROW_SPEED * 1.2);
});

test("速度软上限：永不穿透上限且单调", () => {
  assert.ok(softClampSpeed(1000) > 1000); // 低速接近原速
  let prev = 0;
  for (const v of [100, 1000, 5000, 20000, 100000]) {
    const c = softClampSpeed(v);
    assert.ok(c <= MAX_THROW_SPEED + 1e-9, `${v} 穿透了上限`);
    assert.ok(c > prev);
    prev = c;
  }
});

test("甩出速度尊重档位上限", () => {
  const tr = trail(Array.from({ length: 8 }, (_, i) => [100 + i * 60, 100])); // 极快
  const [vx, vy] = estimateReleaseVelocity(tr, tr[tr.length - 1][0], throwSpeedCap("gentle"));
  assert.ok(Math.hypot(vx, vy) <= 3600 + 1e-6);
});

test("抛掷步进：反弹并最终落地停稳（不穿墙）", () => {
  let px = 500.0, py = 100.0, vx = 800.0, vy = -300.0;
  const bounds = [0.0, 0.0, 1000.0, 600.0];
  let bouncedOnce = false;
  for (let i = 0; i < 2000; i += 1) {
    [px, py, vx, vy, bouncedOnce] = throwStep(px, py, vx, vy, 0.016, ...bounds);
    assert.ok(px >= -1 && px <= 1001 && py >= -1 && py <= 601, "穿墙");
    bouncedOnce = true;
  }
  assert.ok(bouncedOnce);
  assert.equal(py, 600.0);
  assert.ok(Math.abs(vy) < 1);
  assert.ok(Math.abs(vx) < 30);
});

test("静止判定：贴地低速 / 碰边后整体低速", () => {
  assert.ok(isAtRest(600.0, 10, 0, 600.0, false, 10));
  assert.ok(!isAtRest(300.0, 10, 0, 600.0, false, 10)); // 空中不算
  assert.ok(isAtRest(599.0, 10, 0.5, 600.0, true, 50)); // 碰边后低速
});

test("力度档位映射与上限", () => {
  assert.deepEqual(THROW_STRENGTH_CAPS, { gentle: 3600, standard: 4800, strong: 7200, crazy: 9000 });
  assert.equal(normalizeThrowStrength("GENTLE"), "gentle");
  assert.equal(normalizeThrowStrength("invalid"), "standard");
  assert.equal(throwSpeedCap("gentle"), 3600);
  assert.equal(throwSpeedCap("crazy"), 9000);
  assert.equal(throwSpeedCap("unknown"), 4800);
});
