import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import {
  scanSkins, stateToFrames, lookIndex, animationStates, defaultSkinDirs,
  parsePetManifest, normalizeSpritesheetPath, atlasMatches, expectedAtlas, publicFormat
} from "../pet/skins.mjs";

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

// 真实社区契约（实测自 petdex 商店素材的帧占用）：
// 每行末列常为空格，按「每行都 8 帧」播放会让桌宠周期性闪没。
const CONTRACT_FRAMES = {
  idle: 6, "running-right": 8, "running-left": 8, waving: 4,
  jumping: 5, failed: 8, waiting: 6, running: 6, review: 6
};

test("扫描发现 v2 与 classic 皮肤", () => {
  const base = tmpBase();
  makeSkin(base, "elysia", { id: "elysia", displayName: "Elysia", spriteVersionNumber: 2, spritesheetPath: "spritesheet.webp" });
  makeSkin(base, "oldcat", { id: "oldcat", displayName: "Old Cat", spriteVersionNumber: 1, spritesheetPath: "spritesheet.webp" });
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
  makeSkin(base, "nosheet", { id: "nosheet", displayName: "N", spriteVersionNumber: 2, spritesheetPath: "spritesheet.webp" }, false);
  const badDir = path.join(base, "badjson");
  fs.mkdirSync(badDir, { recursive: true });
  fs.writeFileSync(path.join(badDir, "pet.json"), "{not json");
  fs.mkdirSync(path.join(base, "empty"), { recursive: true });
  assert.equal(scanSkins([base]).length, 0);
});

test("字段缺失的 pet.json 被拒（社区契约要求 id/displayName/spritesheetPath）", () => {
  const base = tmpBase();
  makeSkin(base, "a", { id: "a" });                                  // 缺 displayName
  makeSkin(base, "b", { displayName: "B", spritesheetPath: "s.webp" }); // 缺 id
  makeSkin(base, "c", { id: "c", displayName: "C" });                 // 缺 spritesheetPath
  makeSkin(base, "d", { id: "d", displayName: "D", spritesheetPath: "s.webp", spriteVersionNumber: 3 });
  assert.equal(scanSkins([base]).length, 0);
});

test("spritesheetPath 越界被拒（皮肤来自公开商店，这是供应链可达的任意文件读）", () => {
  const base = tmpBase();
  makeSkin(base, "evil", { id: "evil", displayName: "Evil", spritesheetPath: "../../../../etc/hostname" }, false);
  makeSkin(base, "abs", { id: "abs", displayName: "Abs", spritesheetPath: "/etc/hostname" }, false);
  makeSkin(base, "url", { id: "url", displayName: "Url", spritesheetPath: "https://evil.example/x.webp" }, false);
  assert.deepEqual(scanSkins([base]), []);
  assert.throws(() => normalizeSpritesheetPath("../x.webp"), /安全相对路径/);
  assert.throws(() => normalizeSpritesheetPath("/etc/passwd"), /安全相对路径/);
  assert.equal(normalizeSpritesheetPath("sub/a.webp"), "sub/a.webp");
  assert.throws(() => normalizeSpritesheetPath("sub/../a.webp"), /安全相对路径/);
});

test("同名 id 去重（先到先得）", () => {
  const a = tmpBase(), b = tmpBase();
  makeSkin(a, "x", { id: "dup", displayName: "A", spritesheetPath: "s.webp" });
  makeSkin(b, "y", { id: "dup", displayName: "B", spritesheetPath: "s.webp" });
  const skins = scanSkins([a, b]);
  assert.equal(skins.length, 1);
  assert.equal(skins[0].displayName, "A");
});

test("不存在的目录被跳过", () => {
  assert.deepEqual(scanSkins(["/no/such/dir"]), []);
});

test("每个状态的帧数与逐帧时长符合契约（不是一律 8 帧）", () => {
  const v2 = { cols: 8, rows: 11, cellW: 192, cellH: 208, lookRows: 2, version: 2 };
  for (const [id, frames] of Object.entries(CONTRACT_FRAMES)) {
    const f = stateToFrames(id, v2);
    assert.equal(f.frames, frames, `${id} 帧数应为 ${frames}`);
    assert.equal(f.frameDurationsMs.length, frames, `${id} 逐帧时长长度应与帧数一致`);
  }
  // 末列留空的状态必须真的少于 8 帧，否则会出现空白帧闪烁
  assert.ok(stateToFrames("waving", v2).frames < 8);
  assert.ok(stateToFrames("jumping", v2).frames < 8);
  assert.ok(stateToFrames("idle", v2).frames < 8);
});

test("状态行号符合契约", () => {
  const v2 = { cols: 8, rows: 11, cellW: 192, cellH: 208, lookRows: 2, version: 2 };
  assert.equal(stateToFrames("idle", v2).row, 0);
  assert.equal(stateToFrames("running-right", v2).row, 1);
  assert.equal(stateToFrames("running-left", v2).row, 2);
  assert.equal(stateToFrames("waving", v2).row, 3);
  assert.equal(stateToFrames("jumping", v2).row, 4);
  assert.equal(stateToFrames("failed", v2).row, 5);
  assert.equal(stateToFrames("waiting", v2).row, 6);
  assert.equal(stateToFrames("running", v2).row, 7);
  assert.equal(stateToFrames("review", v2).row, 8);
  assert.equal(stateToFrames("nope", v2).row, 0); // 未知状态回落到 idle
});

test("lookIndex：图集格序以正上为 0、顺时针递增", () => {
  assert.equal(lookIndex(0, -1), 0);   // 正上
  assert.equal(lookIndex(1, -1), 2);   // 右上 45°
  assert.equal(lookIndex(1, 0), 4);    // 正右
  assert.equal(lookIndex(1, 1), 6);    // 右下
  assert.equal(lookIndex(0, 1), 8);    // 正下
  assert.equal(lookIndex(-1, 1), 10);  // 左下
  assert.equal(lookIndex(-1, 0), 12);  // 正左
  assert.equal(lookIndex(-1, -1), 14); // 左上
});

test("v2 才有注视状态，v1 没有", () => {
  assert.equal(animationStates(1).length, 9);
  assert.equal(animationStates(2).length, 10);
  assert.equal(animationStates(2).at(-1).id, "look");
});

test("图集尺寸校验：1536×1872 / 1536×2288，其它一律不匹配", () => {
  assert.equal(atlasMatches(1, 1536, 1872), true);
  assert.equal(atlasMatches(2, 1536, 2288), true);
  assert.equal(atlasMatches(1, 1536, 2288), false);
  assert.equal(atlasMatches(2, 1536, 1872), false);
  assert.equal(atlasMatches(2, 1024, 1024), false);
  assert.equal(expectedAtlas(2).height, 2288);
});

test("parsePetManifest 默认 v1 并裁剪空白", () => {
  const m = parsePetManifest('{"id":" a ","displayName":" A ","spritesheetPath":" s.webp "}');
  assert.equal(m.id, "a");
  assert.equal(m.displayName, "A");
  assert.equal(m.spritesheetPath, "s.webp");
  assert.equal(m.spriteVersionNumber, 1);
  assert.equal(m.description, "");
});

test("defaultSkinDirs 覆盖 Codex 与 petdex 两个安装位置 + PETDEX_PET", () => {
  const dirs = defaultSkinDirs("/plugin/root", {});
  assert.ok(dirs[0].endsWith(path.join("skins")));
  assert.ok(dirs.some((d) => d.endsWith(path.join(".codex", "pets"))));
  assert.ok(dirs.some((d) => d.endsWith(path.join(".petdex", "pets"))), "npx petdex install 装到 ~/.petdex/pets");
  const withEnv = defaultSkinDirs("/plugin/root", { PETDEX_PET: "/tmp/mypets" });
  assert.ok(withEnv.includes("/tmp/mypets"));
});

test("publicFormat 暴露完整契约给渲染页", () => {
  const f = publicFormat();
  assert.equal(f.frameWidth, 192);
  assert.equal(f.frameHeight, 208);
  assert.equal(f.states.idle.frames, 6);
  assert.equal(f.states["running-right"].row, 1);
  assert.equal(f.states.look.startRow, 9);
  assert.equal(f.states.look.columns, 8);
  assert.equal(f.lookDirections.length, 16);
  assert.equal(f.lookDirections[0], "000");
});