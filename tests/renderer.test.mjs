// 渲染层 pet.js 的源码契约测试（无 DOM 基建，以关键模式断言防回归）。
// 每条断言都对应一次实机踩坑，改回去就是事故重演。
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const petJs = fs.readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "pet", "renderer", "pet.js"),
  "utf8"
);

test("拖拽用 screen 坐标系（0.4.0 实机：client 坐标反馈振荡导致窗口抽搐）", () => {
  // 增量必须来自 screenX/screenY：窗口移动不影响屏幕坐标，
  // clientX 会随窗口移动反向「跳回」，与异步 setBounds 叠加即抽搐。
  assert.match(petJs, /S\.downScreen = \{ x: e\.screenX, y: e\.screenY \}/);
  assert.match(petJs, /const dx = e\.screenX - S\.downScreen\.x, dy = e\.screenY - S\.downScreen\.y/);
  // 旧的 client 增量模式（消费后重置 downPos 为 client 坐标）必须不复存在
  assert.doesNotMatch(petJs, /S\.downPos = \{ x: e\.clientX/);
});

test("降级模式垂直拖动用 dy（0.4.0 笔误：bottom 误用 dx，垂直拖不动）", () => {
  assert.match(petJs, /S\.stagePos\.bottom = Math\.max\(-40, S\.stagePos\.bottom - dy\)/);
});

test("右键菜单打开期间保持接管（0.4.0 实机：鼠标移向菜单即释放穿透，菜单点不着）", () => {
  // contextmenu 打开时主动接管
  assert.match(petJs, /menuEl\.classList\.add\("show"\); menubg\.classList\.add\("show"\);[\s\S]{0,200}setCapture\(true\)/);
  // mousemove 的释放条件包含 menuOpen 保护
  assert.match(petJs, /!hitsPet\(e\.clientX, e\.clientY\) && !S\.dragging && !menuOpen/);
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
