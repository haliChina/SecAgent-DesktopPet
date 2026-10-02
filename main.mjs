// SecAgent 桌面宠物插件入口。
// 由宿主动态 import 并调用 activate(api)。
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { createPetServer } from "./pet/server.mjs";
import { createPetState } from "./pet/state.mjs";
import { scanSkins, defaultSkinDirs } from "./pet/skins.mjs";
import { mergeConfig } from "./settings/config-schema.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));

function expandHome(p) {
  if (!p) return p;
  if (p === "~") return os.homedir();
  if (p.startsWith("~" + path.sep)) return path.join(os.homedir(), p.slice(2));
  return p;
}

const PET_RULES = `## 桌面宠物规则（Desktop Pet）
- 任务开始 / 调用工具前：可用 pet_emote(running) 让桌宠进入干活状态。
- 需要用户确认或等待输入时：pet_emote(waiting)。
- 任务成功完成：pet_emote(task_done 事件用 pet_say 庆祝，如“搞定！”)；失败时 pet_emote(failed)。
- 想让桌宠说话时用 pet_say，文字简短口语化（≤40 字），不要刷屏。
- 用户提到桌宠/宠物/换皮肤时，用 pet_skin 切换社区 Codex 皮肤。`;

export async function activate(api) {
  const readConfig = () => {
    try {
      const raw = typeof api.getConfig === "function" ? api.getConfig() : {};
      return mergeConfig(raw).config;
    } catch {
      return mergeConfig({}).config;
    }
  };

  const pet = createPetState();
  let skinOverride = null; // pet_skin 工具的会话级覆盖

  function skinDirs() {
    const cfg = readConfig();
    const dirs = [...defaultSkinDirs(here)];
    const codexDir = expandHome((cfg.codexPetsDir || "").trim());
    if (codexDir) dirs.push(codexDir);
    const extra = (cfg.customSkinDirs || "").trim();
    if (extra) dirs.push(...extra.split(path.delimiter).map((s) => expandHome(s.trim())).filter(Boolean));
    return [...new Set(dirs)];
  }

  function listSkins() {
    try {
      return scanSkins(skinDirs());
    } catch {
      return [];
    }
  }

  function activeSkinId() {
    const cfg = readConfig();
    const skins = listSkins();
    if (skinOverride && skins.some((s) => s.id === skinOverride)) return skinOverride;
    if (cfg.skinId && skins.some((s) => s.id === cfg.skinId)) return cfg.skinId;
    return skins[0]?.id ?? null;
  }

  const pageHtml = fs.readFileSync(path.join(here, "pet", "renderer", "index.html"), "utf8");
  const petJs = fs.readFileSync(path.join(here, "pet", "renderer", "pet.js"), "utf8");

  const server = createPetServer({
    getSnapshot: () => pet.tick(),
    dispatch: (event, arg) => {
      if (event === "skin") {
        const skins = listSkins();
        if (skins.some((s) => s.id === arg)) skinOverride = String(arg);
        return pet.snapshot().state;
      }
      return pet.dispatch(event, arg);
    },
    listSkins,
    skinFile: (id) => listSkins().find((s) => s.id === id)?.spritesheet ?? null,
    getConfig: () => ({ ...readConfig(), activeSkinId: activeSkinId() }),
    pageHtml,
    petJs
  });
  const petUrl = await server.start();

  // —— 展示层：优先宿主 overlay（见 docs/OVERLAY_API.md），否则降级用系统浏览器 ——
  let overlay = null;
  let overlayMode = "browser";
  if (typeof api.createOverlay === "function") {
    try {
      overlay = await api.createOverlay({
        url: petUrl,
        width: 260,
        height: 300,
        transparent: true,
        alwaysOnTop: true,
        clickThrough: true
      });
      overlayMode = "overlay";
    } catch {
      overlay = null;
    }
  }

  const showPet = async () => {
    const cfg = readConfig();
    if (!cfg.petEnabled) return { shown: false, reason: "桌宠已在设置中关闭" };
    if (overlay && typeof overlay.show === "function") {
      await overlay.show();
      return { shown: true, mode: "overlay" };
    }
    const url = server.openPetPage();
    return { shown: true, mode: "browser", url, note: "宿主暂不支持 overlay，已在系统浏览器打开（降级模式）" };
  };

  // 工具：让桌宠说话
  api.registerTool(
    {
      name: "pet_say",
      description: "让桌宠冒泡说话。文字简短口语化，不要刷屏。",
      inputSchema: {
        type: "object", additionalProperties: false, required: ["text"],
        properties: { text: { type: "string", description: "气泡文字（≤40字）" } }
      },
      hidden: false
    },
    async (a) => {
      const text = String(a.text || "").slice(0, 200);
      if (!text.trim()) throw new Error("pet_say 需要 text");
      pet.dispatch("say", text);
      return { ok: true, said: text };
    }
  );

  // 工具：切换桌宠动画状态
  api.registerTool(
    {
      name: "pet_emote",
      description: "切换桌宠动画：idle 待机 / waiting 等待 / running 干活 / review 复核 / failed 出错 / jumping 庆祝 / waving 挥手 / sleeping 睡觉。",
      inputSchema: {
        type: "object", additionalProperties: false, required: ["emote"],
        properties: {
          emote: { type: "string", enum: ["idle", "waiting", "running", "review", "failed", "jumping", "waving", "sleeping"] }
        }
      },
      hidden: false
    },
    async (a) => {
      const next = pet.dispatch("emote", a.emote);
      return { ok: true, state: next };
    }
  );

  // 工具：列出 / 切换皮肤（兼容社区 Codex 皮肤）
  api.registerTool(
    {
      name: "pet_skin",
      description: "列出可用皮肤（社区 Codex 桌宠皮肤即放即用）或切换皮肤。不传 skinId 时返回列表。",
      inputSchema: {
        type: "object", additionalProperties: false,
        properties: { skinId: { type: "string", description: "皮肤 id" } }
      },
      hidden: false
    },
    async (a) => {
      const skins = listSkins().map((s) => ({ id: s.id, displayName: s.displayName, description: s.description }));
      if (!a.skinId) return { skins, active: activeSkinId(), dirs: skinDirs() };
      if (!skins.some((s) => s.id === a.skinId)) {
        throw new Error(`没有这个皮肤：${a.skinId}。可用：${skins.map((s) => s.id).join(", ") || "（无）"}`);
      }
      skinOverride = a.skinId;
      return { ok: true, active: skinOverride };
    }
  );

  // 工具：显示 / 隐藏
  api.registerTool(
    { name: "pet_show", description: "显示桌宠。", inputSchema: { type: "object", additionalProperties: false, properties: {} }, hidden: false },
    async () => showPet()
  );
  api.registerTool(
    {
      name: "pet_hide", description: "隐藏桌宠。", inputSchema: { type: "object", additionalProperties: false, properties: {} }, hidden: false
    },
    async () => {
      if (overlay && typeof overlay.hide === "function") { await overlay.hide(); return { ok: true, mode: "overlay" }; }
      pet.dispatch("sleep");
      return { ok: true, mode: "browser", note: "浏览器降级模式：已让桌宠入睡，关闭浏览器标签页可彻底隐藏" };
    }
  );

  api.registerSkill("skills/desktop-pet", /桌宠|宠物|desktop.?pet/i);

  api.registerPrompt("pet_rules", () => {
    const cfg = readConfig();
    if (!cfg.petEnabled) return "";
    return PET_RULES;
  });

  if (readConfig().petEnabled) {
    // 不自动弹窗：首次由用户或模型调用 pet_show 展示，避免打扰
    api.setStatus(overlayMode === "overlay" ? "已就绪（overlay 模式）" : "已就绪（浏览器降级模式）");
  } else {
    api.setStatus("已停用（设置中关闭）");
  }

  return async () => {
    try { await overlay?.close?.(); } catch { /* ignore */ }
    await server.stop().catch(() => {});
  };
}
