// 皮肤契约层：社区 Codex 桌宠皮肤（pet.json + spritesheet）的解析、校验与查询。
//
// 权威格式（与 hr567/codex-pets、crafter-station/petdex 一致）：
//   pet.json { id, displayName, description?, spriteVersionNumber?: 1|2, spritesheetPath }
//   v1 图集 1536×1872（8 列 × 9 行），v2 图集 1536×2288（8 列 × 11 行），每格 192×208。
//
// 九个状态行由宿主活动钩子驱动，帧数与逐帧时长都是契约的一部分——
// 末列常为空格，按「每行都 8 帧」播放会让宠物周期性闪没。
//   行 0 idle(6) / 1 running-right(8) / 2 running-left(8) / 3 waving(4) /
//   4 jumping(5) / 5 failed(8) / 6 waiting(6) / 7 running(6) / 8 review(6)
// v2 追加行 9~10：16 格 8×2 的注视图，格序为罗盘方位 000=正上，顺时针 22.5° 递增。
//
// 自定义皮肤可在 pet.json 里用 layout 字段覆盖版式；所有路径必须是皮肤目录内的相对路径。

import fs from "node:fs";
import path from "node:path";
import os from "node:os";

export const FRAME_WIDTH = 192;
export const FRAME_HEIGHT = 208;

/** 罗盘方位标签：000=正上，顺时针每 22.5° 一格，共 16 格。 */
export const LOOK_DIRECTIONS = Object.freeze([
  "000", "022.5", "045", "067.5", "090", "112.5", "135", "157.5",
  "180", "202.5", "225", "247.5", "270", "292.5", "315", "337.5"
]);

const ROW = (id, row, frameDurationsMs) =>
  Object.freeze({ id, layout: "row", row, frames: frameDurationsMs.length, frameDurationsMs: Object.freeze(frameDurationsMs) });

/** 九个标准状态行。逐帧时长实测自真实商店素材的帧占用与社区契约一致。 */
export const STANDARD_STATES = Object.freeze([
  ROW("idle", 0, [280, 110, 110, 140, 140, 320]),
  ROW("running-right", 1, [120, 120, 120, 120, 120, 120, 120, 220]),
  ROW("running-left", 2, [120, 120, 120, 120, 120, 120, 120, 220]),
  ROW("waving", 3, [140, 140, 140, 280]),
  ROW("jumping", 4, [140, 140, 140, 140, 280]),
  ROW("failed", 5, [140, 140, 140, 140, 140, 140, 140, 240]),
  ROW("waiting", 6, [150, 150, 150, 150, 150, 260]),
  ROW("running", 7, [120, 120, 120, 120, 120, 220]),
  ROW("review", 8, [150, 150, 150, 150, 150, 280])
]);

/** v2 注视：行 9~10，每行 8 格，共 16 格 360°。 */
export const LOOK_STATE = Object.freeze({
  id: "look", layout: "grid", startRow: 9, columns: 8,
  frames: 16, frameDurationsMs: Object.freeze(LOOK_DIRECTIONS.map(() => 160))
});

export const SUPPORTED_SPRITE_VERSIONS = Object.freeze([1, 2]);

/** 状态 id → 行定义（v2 追加 look）。 */
export function animationStates(version) {
  return version === 2 ? [...STANDARD_STATES, LOOK_STATE] : [...STANDARD_STATES];
}

export function getState(version, id) {
  return animationStates(version).find((s) => s.id === id);
}

/** 状态 → { row, frames, frameDurationsMs }，供渲染层按表推进。 */
export function stateToFrames(state, layout) {
  const def = getState(layout?.version === 2 ? 2 : 1, state) ?? getState(1, "idle");
  const row = def.layout === "grid" ? def.startRow : def.row;
  const frames = layout?.version === 2 && def.layout === "grid" ? 8 : def.frames;
  return { row, frames, frameDurationsMs: def.frameDurationsMs, columns: def.columns ?? 8 };
}

/**
 * 鼠标方向 (dx, dy)（屏幕坐标，y 向下）→ 注视格索引 0~15。
 * 格序以正上为 0、顺时针递增（与图集罗盘约定一致）：
 * 正上 → 0，正右 → 4，正下 → 8，正左 → 12。
 */
export function lookIndex(dx, dy) {
  const bearing = Math.atan2(dx, -dy); // 0 = 正上，顺时针为正
  return ((Math.round(bearing / (Math.PI / 8)) % 16) + 16) % 16;
}

/** 图集标准尺寸。 */
export function expectedAtlas(version) {
  return {
    columns: 8,
    rows: version === 2 ? 11 : 9,
    width: FRAME_WIDTH * 8,
    height: FRAME_HEIGHT * (version === 2 ? 11 : 9)
  };
}

/**
 * 校验图集实际尺寸是否匹配声明版式。
 * 返回 true 表示尺寸符合；false 表示不匹配（渲染层据此拒绝播放而不是画出垃圾）。
 */
export function atlasMatches(version, width, height) {
  const e = expectedAtlas(version);
  return width === e.width && height === e.height;
}

/**
 * 皮肤目录优先级：插件自带 < 自定义 < ~/.codex/pets < ~/.petdex/pets < $PETDEX_PET。
 * 前三者是 Codex 官方与 petdex CLI 的安装位置，PETDEX_PET 与 petdex 桌面端一致。
 */
export function defaultSkinDirs(pluginRoot, env = process.env) {
  const dirs = [];
  if (pluginRoot) dirs.push(path.join(pluginRoot, "skins"));
  dirs.push(path.join(os.homedir(), ".codex", "pets"));
  dirs.push(path.join(os.homedir(), ".petdex", "pets"));
  const override = (env.PETDEX_PET || "").trim();
  if (override) dirs.push(override);
  return dirs;
}

function isRecord(v) {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function requireString(v, field) {
  if (typeof v !== "string" || v.trim().length === 0) {
    throw new Error(`pet.json 缺少非空字段 "${field}"`);
  }
  return v.trim();
}

/**
 * spritesheetPath 必须是皮肤目录内的安全相对路径。
 * 皮肤来自公开商店，恶意 pet.json 可以用绝对路径或 ../ 越界读取任意本地文件。
 */
export function normalizeSpritesheetPath(value) {
  const normalized = String(value).trim().replaceAll("\\", "/").replace(/^\.\//, "");
  const segments = normalized.split("/");
  if (
    normalized.length === 0
    || normalized.startsWith("/")
    || path.isAbsolute(String(value).trim())
    || /^[a-z][a-z\d+.-]*:/i.test(normalized)
    || normalized.includes("?")
    || normalized.includes("#")
    || segments.some((s) => s === ".." || s === "." || s.length === 0)
  ) {
    throw new Error("pet.json 的 spritesheetPath 必须是皮肤目录内的安全相对路径");
  }
  return normalized;
}

/**
 * 解析并校验 pet.json。
 * @returns {{id,displayName,description,spriteVersionNumber,spritesheetPath,layout?}}
 * @throws {Error} 结构非法时抛错（调用方据此跳过该皮肤）
 */
export function parsePetManifest(raw) {
  const json = typeof raw === "string" ? JSON.parse(raw) : raw;
  if (!isRecord(json)) throw new Error("pet.json 必须是 JSON 对象");

  const version = json.spriteVersionNumber === undefined ? 1 : json.spriteVersionNumber;
  if (!SUPPORTED_SPRITE_VERSIONS.includes(version)) {
    throw new Error("pet.json 的 spriteVersionNumber 只能是 1 或 2");
  }
  if (json.description !== undefined && typeof json.description !== "string") {
    throw new Error("pet.json 的 description 必须是字符串");
  }
  if (json.layout !== undefined && !isRecord(json.layout)) {
    throw new Error("pet.json 的 layout 必须是对象");
  }

  return {
    id: requireString(json.id, "id"),
    displayName: requireString(json.displayName, "displayName"),
    description: (json.description ?? "").trim(),
    spriteVersionNumber: version,
    spritesheetPath: normalizeSpritesheetPath(requireString(json.spritesheetPath, "spritesheetPath")),
    layout: json.layout
  };
}

/** pet.json.layout 覆盖默认版式；缺省按 spriteVersionNumber 推导。 */
export function resolveLayout(petJson) {
  const version = Number(petJson.spriteVersionNumber) === 2 ? 2 : 1;
  const base = { cols: 8, rows: version === 2 ? 11 : 9, cellW: FRAME_WIDTH, cellH: FRAME_HEIGHT, lookRows: version === 2 ? 2 : 0, version };
  const l = petJson.layout;
  if (!isRecord(l)) return base;
  const cols = Number.isInteger(l.cols) && l.cols > 0 ? l.cols : base.cols;
  const rows = Number.isInteger(l.rows) && l.rows > 0 ? l.rows : base.rows;
  return {
    cols,
    rows,
    cellW: Number.isFinite(l.cellW) && l.cellW > 0 ? l.cellW : base.cellW,
    cellH: Number.isFinite(l.cellH) && l.cellH > 0 ? l.cellH : base.cellH,
    lookRows: Number.isInteger(l.lookRows) && l.lookRows >= 0 ? l.lookRows : base.lookRows,
    version: "custom"
  };
}

function loadSkinDir(dir, entryName) {
  let raw;
  try {
    raw = fs.readFileSync(path.join(dir, "pet.json"), "utf8");
  } catch {
    return null;
  }
  let json;
  try {
    json = parsePetManifest(raw);
  } catch {
    return null; // 结构非法的皮肤直接跳过，不让整个扫描失败
  }
  const spritesheet = path.resolve(dir, json.spritesheetPath);
  // 双保险：resolve 后必须仍在皮肤目录内
  const rel = path.relative(dir, spritesheet);
  if (rel.startsWith("..") || path.isAbsolute(rel)) return null;
  if (!fs.existsSync(spritesheet)) return null;
  return {
    id: json.id || entryName,
    displayName: json.displayName,
    description: json.description,
    dir,
    spritesheet,
    layout: resolveLayout(json)
  };
}

/**
 * 扫描皮肤目录。每个含 pet.json 的子目录视为一个皮肤；同 id 只保留首个。
 * @returns {Array<{id,displayName,description,dir,spritesheet,layout}>}
 */
export function scanSkins(dirs = []) {
  const skins = [];
  const seen = new Set();
  for (const base of dirs) {
    if (!base) continue;
    let entries;
    try {
      entries = fs.readdirSync(base, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const skin = loadSkinDir(path.join(base, entry.name), entry.name);
      if (!skin || seen.has(skin.id)) continue;
      seen.add(skin.id);
      skins.push(skin);
    }
  }
  return skins;
}

/** 注入渲染页的契约快照：单一事实源，避免浏览器端再抄一份状态表。 */
export function publicFormat() {
  return {
    frameWidth: FRAME_WIDTH,
    frameHeight: FRAME_HEIGHT,
    lookDirections: LOOK_DIRECTIONS,
    states: Object.fromEntries(
      animationStates(2).map((s) => [s.id, {
        layout: s.layout, row: s.row ?? null, startRow: s.startRow ?? null,
        columns: s.columns ?? 8, frames: s.frames, frameDurationsMs: s.frameDurationsMs
      }])
    )
  };
}