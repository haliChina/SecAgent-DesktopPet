// SecAgent 桌面宠物插件入口。
// 由宿主动态 import 并调用 activate(api)。
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { createPetServer } from "./pet/server.mjs";
import { createPetState } from "./pet/state.mjs";
import { scanSkins, defaultSkinDirs, publicFormat } from "./pet/skins.mjs";
import { createStore } from "./pet/store.mjs";
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
- 任务成功完成：pet_emote(jumping) 庆祝，配合 pet_say（如“搞定！”）；失败时 pet_emote(failed)。
- 想让桌宠说话时用 pet_say，文字简短口语化（≤40 字），不要刷屏。
- 用户提到桌宠/宠物/换皮肤时，用 pet_skin 切换社区 Codex 皮肤。
- 本地没有想要的皮肤时，用 pet_store 按名字搜索，再传 slug 安装到 ~/.codex/pets。`;

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
  // 久无互动入睡的定时器只在「回到 idle」时布防：回到 idle 的途径很多
  // （tick 到期、hold TTL 兜底、wake、emote），集中观察，否则定时器只在
  // 启动时布防一次，第一次在非 idle 时被忽略后，整个会话都不会再自动入睡。
  let lastObservedState = pet.snapshot().state;
  function observeState(next) {
    if (next === "idle" && lastObservedState !== "idle") armSleep();
    lastObservedState = next;
    return next;
  }
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
    getSnapshot: () => {
      const snap = pet.tick();
      observeState(snap.state);
      return snap;
    },
    dispatch: (event, arg) => {
      if (event === "skin") {
        const skins = listSkins();
        if (skins.some((s) => s.id === arg)) skinOverride = String(arg);
        return observeState(pet.snapshot().state);
      }
      return observeState(pet.dispatch(event, arg));
    },
    listSkins,
    skinFile: (id) => listSkins().find((s) => s.id === id)?.spritesheet ?? null,
    getConfig: () => ({ ...readConfig(), activeSkinId: activeSkinId() }),
    pageHtml,
    petJs,
    format: publicFormat()
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
      const next = observeState(pet.dispatch("emote", a.emote));
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
      observeState(pet.dispatch("sleep"));
      return { ok: true, mode: "browser", note: "浏览器降级模式：已让桌宠入睡，关闭浏览器标签页可彻底隐藏" };
    }
  );

  // 工具：从 Codex 社区商店（petdex）搜索 / 安装皮肤到 ~/.codex/pets
  const store = createStore((url, init) => {
    if (typeof api.fetch !== "function") throw new Error("当前宿主未提供网络能力，无法访问桌宠商店");
    return api.fetch(url, init);
  });

  api.registerTool(
    {
      name: "pet_store",
      description: "在 Codex 社区桌宠商店（petdex）里找皮肤。不传 query 列出热门，传 slug 则安装到 ~/.codex/pets 并立即可换。",
      inputSchema: {
        type: "object", additionalProperties: false,
        properties: {
          query: { type: "string", description: "搜索词（皮肤名或类别）；留空列目录" },
          slug: { type: "string", description: "要安装的皮肤 slug（英文短横线名）" }
        }
      },
      hidden: false
    },
    async (a) => {
      if (a.slug) {
        const r = await store.install(a.slug);
        const skins = listSkins();
        if (skins.some((s) => s.id === r.slug)) skinOverride = r.slug;
        return { ok: true, installed: r, active: activeSkinId(), count: skins.length };
      }
      const results = await store.search(a.query, 20);
      return { count: results.length, pets: results };
    }
  );

  // 宿主活动事件驱动（需 agent.activity）：回合/工具/审批/完成/失败 → 动画。
  // 这是主路径；pet_emote 工具保留给不支持事件的老宿主兜底。
  // 事件里没有 phase 字段（phase 只在 api.getActivity() 快照上），所以按 kind 映射。
  const ACTIVITY_MAP = {
    turn_started: ["hold", "review"],     // 思考中：复用复核行
    tool_started: ["hold", "running"],
    tool_finished: ["hold", "review"],    // 工具返回后模型还要继续推理
    approval_requested: ["hold", "waiting"],
    approval_resolved: ["hold", "running"],
    turn_completed: ["emote", "waving"],  // 回合完成：挥手
    turn_failed: ["emote", "failed"],
    turn_blocked: ["hold", "waiting"]     // 用户中断：需要注意到，不是失败
  };
  const hasOnActivity = typeof api.onActivity === "function";
  const unsubscribeActivity = hasOnActivity
    ? api.onActivity((event) => {
      try {
        if (!readConfig().petEnabled) return;
        const mapped = ACTIVITY_MAP[event?.kind];
        if (mapped) pet.dispatch(mapped[0], mapped[1]);
      } catch { /* 订阅者异常不得影响宿主与用户 */ }
    })
    : null;

  // 久无互动自动入睡（config.idleSleepSec，0 = 不睡）
  let sleepTimer = null;
  function armSleep() {
    if (sleepTimer) clearTimeout(sleepTimer);
    const sec = Number(readConfig().idleSleepSec) || 0;
    if (sec <= 0) return;
    sleepTimer = setTimeout(() => observeState(pet.dispatch("sleep")), sec * 1000);
    sleepTimer.unref?.();
  }

  api.registerSkill("skills/desktop-pet", /桌宠|宠物|desktop.?pet/i);

  api.registerPrompt("pet_rules", () => {
    const cfg = readConfig();
    if (!cfg.petEnabled) return "";
    return PET_RULES;
  });

  // 晚订阅补齐：浮窗/插件可能在回合进行到一半才起来，读一次快照知道当前状态
  if (hasOnActivity && typeof api.getActivity === "function" && readConfig().petEnabled) {
    try {
      const snapshot = api.getActivity();
      if (snapshot?.phase === "running" || snapshot?.phase === "waiting" || snapshot?.phase === "thinking") {
        const mapped = snapshot.phase === "thinking" ? ["hold", "review"] : ["hold", snapshot.phase];
        pet.dispatch(mapped[0], mapped[1]);
      }
    } catch { /* 读不到快照就按 idle 起步 */ }
  }

  if (readConfig().petEnabled) {
    // 不自动弹窗：首次由用户或模型调用 pet_show 展示，避免打扰
    api.setStatus(overlayMode === "overlay" ? "已就绪（overlay 模式）" : "已就绪（浏览器降级模式）");
    armSleep();
  } else {
    api.setStatus("已停用（设置中关闭）");
  }

  return async () => {
    if (sleepTimer) clearTimeout(sleepTimer);
    try { unsubscribeActivity?.(); } catch { /* ignore */ }
    try { await overlay?.close?.(); } catch { /* ignore */ }
    await server.stop().catch(() => {});
  };
}
