// 皮肤加载：兼容社区 Codex 桌宠皮肤（pet.json + spritesheet）。
//
// 支持的版式：
//   v2（spriteVersionNumber: 2）：1536×2288，8 列 × 11 行，每格 192×208
//   classic（8×9）：1536×1872，8 列 × 9 行，每格 192×208（无注视行）
//   pet.json 可用 layout 字段覆盖：{ cols, rows, cellW, cellH, lookRows }
//
// v2 行语义（社区约定）：
//   0 idle 待机 / 1 右移 / 2 左移 / 3 挥手 / 4 跳跃 /
//   5 失败 / 6 等待输入 / 7 执行任务 / 8 复核 / 9~10 注视（16 方向）

import fs from "node:fs";
import path from "node:path";
import os from "node:os";

/** 动画状态 → 精灵图行号 */
export const STATE_ROWS = {
  idle: 0,
  running: 7,
  waiting: 6,
  review: 8,
  failed: 5,
  jumping: 4,
  waving: 3,
  sleeping: 0 // sleeping 复用 idle 行，渲染层做闭眼/变暗处理
};

export const LOOK = { startRow: 9, rows: 2, cells: 16 };

/** 默认皮肤来源目录（按优先级）：插件自带 < 自定义 < ~/.codex/pets */
export function defaultSkinDirs(pluginRoot) {
  const dirs = [];
  if (pluginRoot) dirs.push(path.join(pluginRoot, "skins"));
  dirs.push(path.join(os.homedir(), ".codex", "pets"));
  return dirs;
}

function readPetJson(dir) {
  const file = path.join(dir, "pet.json");
  let raw;
  try {
    raw = fs.readFileSync(file, "utf8");
  } catch {
    return null;
  }
  let json;
  try {
    json = JSON.parse(raw);
  } catch {
    return null;
  }
  return { file, json };
}

function resolveLayout(petJson) {
  if (petJson.layout && typeof petJson.layout === "object") {
    const l = petJson.layout;
    return {
      cols: l.cols | 0 || 8,
      rows: l.rows | 0 || 11,
      cellW: l.cellW | 0 || 192,
      cellH: l.cellH | 0 || 208,
      lookRows: l.lookRows | 0 || 0,
      version: "custom"
    };
  }
  const v = Number(petJson.spriteVersionNumber);
  if (v === 2) {
    return { cols: 8, rows: 11, cellW: 192, cellH: 208, lookRows: 2, version: 2 };
  }
  // 缺省按 classic 8×9 处理（社区早期皮肤）
  return { cols: 8, rows: 9, cellW: 192, cellH: 208, lookRows: 0, version: 1 };
}

/**
 * 扫描皮肤目录。每个子目录含 pet.json 即视为一个皮肤。
 * @returns {Array<{id, displayName, description, dir, spritesheet, layout}>}
 */
export function scanSkins(dirs = []) {
  const skins = [];
  const seen = new Set();
  for (const base of dirs) {
    let entries;
    try {
      entries = fs.readdirSync(base, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const dir = path.join(base, entry.name);
      const found = readPetJson(dir);
      if (!found) continue;
      const { json } = found;
      const id = String(json.id || entry.name);
      if (seen.has(id)) continue;
      const sheetRel = json.spritesheetPath || "spritesheet.webp";
      const spritesheet = path.resolve(dir, sheetRel);
      if (!fs.existsSync(spritesheet)) continue;
      seen.add(id);
      skins.push({
        id,
        displayName: String(json.displayName || id),
        description: String(json.description || ""),
        dir,
        spritesheet,
        layout: resolveLayout(json)
      });
    }
  }
  return skins;
}

/** 状态 → { row, frames }，供渲染层取帧 */
export function stateToFrames(state, layout) {
  const row = STATE_ROWS[state] ?? 0;
  return { row, frames: layout.cols, lookRows: layout.lookRows };
}

/** 注视方向（dx,dy ∈ [-1,1]）→ 注视格索引（0~15，顺时针，0=正右） */
export function lookToCell(dx, dy) {
  const angle = Math.atan2(-dy, dx); // 屏幕 y 向下，取反
  let idx = Math.round(angle / (Math.PI / 8));
  idx = ((idx % 16) + 16) % 16;
  return idx;
}
