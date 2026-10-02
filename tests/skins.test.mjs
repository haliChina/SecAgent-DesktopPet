import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { scanSkins, stateToFrames, lookToCell, STATE_ROWS, defaultSkinDirs } from "../pet/skins.mjs";

function tmpBase() {
  const dir = path.join(os.tmpdir(), "pet-skins-" + crypto.randomUUID());
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function makeSkin(base, name, petJson, withSheet = true) {
  const dir = path.join(base, name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "pet.json"), JSON.stringify(petJson));
  if (withSheet) fs.writeFileSync(path.join(dir, petJson.spritesheetPath || "spritesheet.webp"), "fake");
  return dir;
}

test("扫描发现 v2 与 classic 皮肤", () => {
  const base = tmpBase();
  makeSkin(base, "elysia", { id: "elysia", displayName: "Elysia", spriteVersionNumber: 2 });
  makeSkin(base, "oldcat", { id: "oldcat", spriteVersionNumber: 1 });
  const skins = scanSkins([base]);
  assert.equal(skins.length, 2);
  const v2 = skins.find((s) => s.id === "elysia");
  assert.deepEqual(v2.layout, { cols: 8, rows: 11, cellW: 192, cellH: 208, lookRows: 2, version: 2 });
  const classic = skins.find((s) => s.id === "oldcat");
  assert.equal(classic.layout.rows, 9);
  assert.equal(classic.layout.lookRows, 0);
});

test("缺 spritesheet / pet.json 非法 / 无 pet.json 的目录被跳过", () => {
  const base = tmpBase();
  makeSkin(base, "nosheet", { id: "nosheet", spriteVersionNumber: 2 }, false);
  const badDir = path.join(base, "badjson");
  fs.mkdirSync(badDir, { recursive: true });
  fs.writeFileSync(path.join(badDir, "pet.json"), "{not json");
  fs.mkdirSync(path.join(base, "empty"), { recursive: true });
  const skins = scanSkins([base]);
  assert.equal(skins.length, 0);
});

test("同名 id 去重（先到先得）", () => {
  const a = tmpBase(), b = tmpBase();
  makeSkin(a, "x", { id: "dup", displayName: "A" });
  makeSkin(b, "y", { id: "dup", displayName: "B" });
  const skins = scanSkins([a, b]);
  assert.equal(skins.length, 1);
  assert.equal(skins[0].displayName, "A");
});

test("不存在的目录被跳过", () => {
  assert.deepEqual(scanSkins(["/no/such/dir"]), []);
});

test("stateToFrames 映射状态到行", () => {
  const layout = { cols: 8, rows: 11, cellW: 192, cellH: 208, lookRows: 2 };
  assert.deepEqual(stateToFrames("running", layout), { row: 7, frames: 8, lookRows: 2 });
  assert.deepEqual(stateToFrames("waiting", layout), { row: 6, frames: 8, lookRows: 2 });
  assert.deepEqual(stateToFrames("nope", layout).row, 0);
  assert.ok(STATE_ROWS.sleeping === 0);
});

test("lookToCell：16 方向", () => {
  assert.equal(lookToCell(1, 0), 0);   // 正右
  assert.equal(lookToCell(0, -1), 4);  // 正上（屏幕 y 向下取反）
  assert.equal(lookToCell(-1, 0), 8);  // 正左
  assert.equal(lookToCell(0, 1), 12);   // 正下
});

test("defaultSkinDirs 包含 ~/.codex/pets", () => {
  const dirs = defaultSkinDirs("/plugin/root");
  assert.ok(dirs[0].endsWith(path.join("skins")));
  assert.ok(dirs.some((d) => d.endsWith(path.join(".codex", "pets"))));
});
