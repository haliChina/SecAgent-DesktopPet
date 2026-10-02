// 桌宠设置：单一事实源（字段定义、默认值、校验、合并）。
export const SETTING_GROUPS = [
  { id: "general", title: "常规", description: "桌宠开关、尺寸与活跃度。" },
  { id: "skin", title: "皮肤", description: "Codex 桌宠皮肤（pet.json + spritesheet）来源。" },
  { id: "behavior", title: "行为", description: "气泡、睡眠与互动。" }
];

export const SETTING_FIELDS = [
  { key: "petEnabled", group: "general", type: "boolean", default: true,
    label: "启用桌宠", effect: "immediate" },
  { key: "size", group: "general", type: "number", default: 160, min: 96, max: 320, step: 8,
    label: "桌宠尺寸（px）", effect: "immediate" },
  { key: "activityLevel", group: "general", type: "select", default: "normal",
    options: [
      { value: "quiet", label: "安静（少气泡、不乱动）" },
      { value: "normal", label: "正常" },
      { value: "lively", label: "活泼（多互动、多气泡）" }
    ],
    label: "活跃程度", effect: "guidance" },

  { key: "skinId", group: "skin", type: "string", default: "",
    label: "指定皮肤", hint: "留空自动用第一个；也可用 pet_skin 工具切换。", effect: "immediate" },
  { key: "codexPetsDir", group: "skin", type: "string", default: "",
    label: "社区皮肤目录", hint: "留空用 ~/.codex/pets；社区 Codex 皮肤放这里即用。", effect: "immediate" },
  { key: "customSkinDirs", group: "skin", type: "string", default: "",
    label: "额外皮肤目录", hint: "多个用系统路径分隔符（: 或 ;）隔开。", effect: "immediate" },

  { key: "bubbleDurationMs", group: "behavior", type: "number", default: 4000, min: 1000, max: 15000, step: 500,
    label: "气泡停留（毫秒）", effect: "immediate" },
  { key: "idleSleepSec", group: "behavior", type: "number", default: 600, min: 60, max: 3600, step: 60,
    label: "无互动后入睡（秒）", hint: "0 表示不睡。", effect: "immediate" }
];

export const DEFAULT_CONFIG = Object.freeze(
  SETTING_FIELDS.reduce((acc, f) => { acc[f.key] = f.default; return acc; }, {})
);

const FIELD_BY_KEY = new Map(SETTING_FIELDS.map((f) => [f.key, f]));

function coerce(value, field, fallback) {
  if (value === undefined || value === null || value === "") return fallback;
  if (field.type === "boolean") {
    if (typeof value === "boolean") return value;
    if (value === "true") return true;
    if (value === "false") return false;
    return fallback;
  }
  if (field.type === "number") {
    const n = Number(value);
    if (!Number.isFinite(n)) return fallback;
    const c = Math.min(field.max ?? n, Math.max(field.min ?? n, n));
    return field.step === 1 ? Math.round(c) : c;
  }
  if (field.type === "select") {
    return field.options.some((o) => o.value === value) ? value : fallback;
  }
  return typeof value === "string" ? value.trim() : fallback;
}

export function normalizeField(key, value, fallback) {
  const field = FIELD_BY_KEY.get(key);
  if (!field) return undefined;
  return coerce(value, field, fallback ?? field.default);
}

export function mergeConfig(userConfig) {
  const config = { ...DEFAULT_CONFIG };
  const dropped = [];
  if (userConfig && typeof userConfig === "object" && !Array.isArray(userConfig)) {
    for (const [key, value] of Object.entries(userConfig)) {
      if (!FIELD_BY_KEY.has(key)) continue;
      const normalized = normalizeField(key, value);
      if (normalized !== config[key] && value !== normalized) dropped.push(key);
      config[key] = normalized;
    }
  }
  return { config, dropped };
}

export function describeSettings() {
  return SETTING_GROUPS.map((g) => ({ ...g, fields: SETTING_FIELDS.filter((f) => f.group === g.id) }));
}
