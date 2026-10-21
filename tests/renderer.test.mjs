// 渲染层 pet.js 的源码契约测试（无 DOM 基建，以关键模式断言防回归）。
// 每条断言都对应一次实机踩坑，改回去就是事故重演。
// deriveAtlasLayout 从源码提取后用 new Function 实跑——比字符串断言强一档。
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const petJs = fs.readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "pet", "renderer", "pet.js"),
  "utf8"
);
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

/** 从源码提取顶层具名函数（按大括号配对），注入常量后返回可调用副本。 */
function extractFunction(name, consts) {
  const start = petJs.indexOf(`function ${name}(`);
  assert.ok(start > 0, `源码中未找到 ${name}`);
  let depth = 0, end = -1;
  for (let i = petJs.indexOf("{", start); i < petJs.length; i += 1) {
    if (petJs[i] === "{") depth += 1;
    else if (petJs[i] === "}") { depth -= 1; if (depth === 0) { end = i + 1; break; } }
  }
  assert.ok(end > 0, `${name} 的大括号不配对`);
  const src = petJs.slice(start, end);
  return new Function(...Object.keys(consts), `${src}; return ${name};`)(...Object.values(consts));
}

test("拖拽优先绝对定位协议（0.4.1 实机：增量换算在 DPI 缩放下反向/棘轮漂移）", () => {
  // pointerdown 记录抓取点偏移（窗口内坐标，拖拽期间恒定）
  assert.match(petJs, /S\.grabOffset = \{ x: e\.clientX, y: e\.clientY \}/);
  // pointermove 优先 moveTo（绝对定位），旧宿主退回 move（增量），浏览器降级走 stage
  const moveBranch = petJs.match(/if \(hostBridge && hostBridge\.moveTo\) \{[\s\S]{0,200}hostBridge\.moveTo\(S\.grabOffset\.x, S\.grabOffset\.y\)/);
  assert.ok(moveBranch, "缺少 moveTo 绝对定位调用");
  assert.match(petJs, /\} else if \(hostBridge && hostBridge\.move\) \{/);
  // 方向按总位移判定（相对 downStartScreen），不是逐事件增量
  assert.match(petJs, /const totalDx = e\.screenX - S\.downStartScreen\.x/);
});

test("drag_start 延迟到真实移动（0.4.1 实机：长按不动也进跑步态）", () => {
  const down = petJs.match(/canvas\.addEventListener\("pointerdown"[\s\S]{0,700}?\}\);/)?.[0] ?? "";
  assert.ok(down, "未找到 pointerdown 处理器");
  assert.doesNotMatch(down, /postEvent\("drag_start"/, "pointerdown 不应立即发 drag_start");
  assert.match(petJs, /S\.dragMoved = true;\s*\n\s*postEvent\("drag_start", 1\)/, "drag_start 应在首次移动 >6px 时发");
  // 跑步动画行选择也须有 dragMoved 门控（0.5.0 起飞行态同走跑步行）
  assert.match(petJs, /const inMotion = \(S\.dragging && S\.dragMoved\) \|\| !!S\.flight;/);
  assert.match(petJs, /if \(inMotion && layout\)/);
});

test("右键菜单打开期间保持接管（0.4.0 实机：鼠标移向菜单即释放穿透，菜单点不着）", () => {
  assert.match(petJs, /menuEl\.classList\.add\("show"\); menubg\.classList\.add\("show"\);[\s\S]{0,200}setCapture\(true\)/);
  // 释放条件含 menuOpen 保护；0.5.0 起飞行中同样保持接管
  assert.match(petJs, /!hitsPet\(e\.clientX, e\.clientY\) && !S\.dragging && !S\.flight && !menuOpen/);
});

test("失焦时连菜单一起收起（只释放穿透不关菜单 = 菜单挂着但点不着）", () => {
  assert.match(
    petJs,
    /window\.addEventListener\("blur", \(\) => \{[\s\S]{0,300}menuEl\.classList\.remove\("show"\); menubg\.classList\.remove\("show"\);[\s\S]{0,200}setCapture\(false\)/
  );
});

test("菜单项不使用原生对话框（Electron 沙盒渲染进程里 prompt 静默返回 null）", () => {
  assert.doesNotMatch(petJs, /\bprompt\s*\(/);
});

test("换皮肤为循环切换（旧实现依赖 prompt 输入编号，从未生效过）", () => {
  assert.match(petJs, /S\.skins\[\(idx \+ 1\) % S\.skins\.length\]/);
});

test("deriveAtlasLayout：标准与任意倍率图集都能推导，几何不吻合返回 null（0.4.1 实机：用户被迫在线压缩超大皮肤）", () => {
  const derive = extractFunction("deriveAtlasLayout", { CELL_W: 192, CELL_H: 208 });
  // 标准 v1 / v2
  assert.deepEqual(derive(1536, 1872), { cols: 8, rows: 9, cellW: 192, cellH: 208, lookRows: 0, version: 1 });
  assert.deepEqual(derive(1536, 2288), { cols: 8, rows: 11, cellW: 192, cellH: 208, lookRows: 2, version: 2 });
  // 2× 放大图集（实机场景）
  assert.deepEqual(derive(3072, 3744), { cols: 8, rows: 9, cellW: 384, cellH: 416, lookRows: 0, version: 1 });
  assert.deepEqual(derive(3072, 4576), { cols: 8, rows: 11, cellW: 384, cellH: 416, lookRows: 2, version: 2 });
  // 0.5× 缩小图集
  assert.equal(derive(768, 936).cellW, 96);
  // 非 8 列倍数 / 高度不整除 / 纵横比跑偏 → null
  assert.equal(derive(2000, 3000), null);
  assert.equal(derive(1536, 1873), null);
  assert.equal(derive(1600, 2079), null); // 行数整除但格子比例失真（200/231 ≠ 192/208）
  assert.equal(derive(0, 0), null);
  assert.equal(derive(-8, -9), null);
});

test("loadSkin 尺寸复核优先级：pet.json 有效 layout > 几何推导 > 默认（判失败）", () => {
  assert.match(petJs, /const petJsonValid = !!\(l\.cols && l\.rows && l\.cellW && l\.cellH/);
  assert.match(petJs, /const derived = deriveAtlasLayout\(img\.naturalWidth, img\.naturalHeight\)/);
});

test("甩出物理接入：轨迹采样 → 死区判定 → 飞行循环（0.5.0，移植自 dsh-pet-indesktop）", () => {
  // 拖拽中采样轨迹并保留窗口
  assert.match(petJs, /S\.trail\.push\(\[t, e\.screenX, e\.screenY\]\)/);
  assert.match(petJs, /t - PHYS\.TRAIL_KEEP_SEC/);
  // 松手估算初速，死区内不起飞，开关可关
  assert.match(petJs, /PHYS\.estimateReleaseVelocity\(S\.trail, performance\.now\(\) \/ 1000, cap\)/);
  assert.match(petJs, /Math\.hypot\(vx, vy\) >= PHYS\.DEAD_ZONE_SPEED/);
  assert.match(petJs, /S\.config\.throwPhysics/);
  // 飞行循环：子步积分 + 静止判定 + 每帧驱动
  assert.match(petJs, /function stepFlight\(tSec\)/);
  assert.match(petJs, /PHYS\.throwStep\(f\.px, f\.py, f\.vx, f\.vy, h/);
  assert.match(petJs, /PHYS\.isAtRest\(f\.py, f\.vx, f\.vy, f\.bounds\[3\], f\.bounced/);
  assert.match(petJs, /stepFlight\(t \/ 1000\)/);
  // 写位置优先级：新宿主 setPosition 绝对定位，旧宿主 move 差分兜底
  assert.match(petJs, /if \(hostBridge\.setPosition\) \{[\s\S]{0,60}hostBridge\.setPosition\(x, y\)/);
  // 0.5.3（#8）甩出屏幕自愈：写后读回 screenX/Y，严重偏差 → 采纳实测并钳回边界
  assert.match(petJs, /Math\.abs\(sx - x\) > 48 \|\| Math\.abs\(sy - y\) > 48/);
  assert.match(petJs, /clampNum\(sx, f\.bounds\[0\], f\.bounds\[2\]\)/);
  // 飞行动画随速度加速
  assert.match(petJs, /PHYS\.flightAnimSpeed\(Math\.hypot\(S\.flight\.vx, S\.flight\.vy\)\)/);
});

test("甩出物理经 window.__petPhysics 注入，缺失时整体禁用（不炸页面）", () => {
  assert.match(petJs, /const PHYS = window\.__petPhysics \|\| null/);
});

test("拖拽与起飞门槛（#8：小幅拖动反向走 / 蹭一下甩飞）", () => {
  // 拖拽优先渲染端绝对定位（e.screenX 与 setPosition 同一 DIP 空间，自纠错）
  assert.match(petJs, /hostBridge\.setPosition\(e\.screenX - S\.grabOffset\.x, e\.screenY - S\.grabOffset\.y\)/);
  // moveTo 降级保留（旧宿主）
  assert.match(petJs, /else if \(hostBridge && hostBridge\.moveTo\)/);
  // 总位移 < 12px 不起飞（高速微蹭的初速估算噪声）
  assert.match(petJs, /totalDist >= 12 && Math\.hypot\(vx, vy\) >= PHYS\.DEAD_ZONE_SPEED/);
  // 停顿判定放宽（0.15 → 0.25）：拖一下再停下的停顿不再误判为甩出
  const physicsJs = fs.readFileSync(path.join(root, "pet/renderer/physics.js"), "utf8");
  assert.match(physicsJs, /RELEASE_STALE_SEC = 0\.25/);
});

test("主进程注入：physics.js 剥 export 后附 window.__petPhysics（main.mjs）", () => {
  const mainJs = fs.readFileSync(path.join(root, "main.mjs"), "utf8");
  assert.match(mainJs, /\.replace\(\/\^export const \/gm, "const "\)/);
  assert.match(mainJs, /\.replace\(\/\^export function \/gm, "function "\)/);
  assert.match(mainJs, /window\.__petPhysics = \{/);
});

test("尺寸热更新：轮询检测 size 变化即 fitCanvas（0.4.1 实机：改大小要重启客户端）", () => {
  assert.match(petJs, /S\.appliedSize = Number\(S\.config\.size\) \|\| 0/);
  assert.match(petJs, /const wantSize = Number\(S\.config\.size\) \|\| 0/);
  assert.match(petJs, /if \(wantSize && wantSize !== S\.appliedSize\) \{[\s\S]{0,150}fitCanvas\(\)/);
  // 轮询必须合并 config（气泡时长等同样热更）
  assert.match(petJs, /S\.config = \{ \.\.\.S\.config, \.\.\.\(data\.config \|\| \{\}\) \};/);
});
