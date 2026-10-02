// 桌宠状态机：会话/交互事件 → 动画状态。纯逻辑，不依赖 DOM，可单元测试。
//
// 状态：
//   idle 睡待机 / waiting 等待用户 / running 执行中 / review 复核中 /
//   failed 出错 / jumping 庆祝 / waving 挥手（被戳） / sleeping 睡觉
//  timed 状态会在 duration 后自动回到 idle（由 tick 驱动）。

export const STATES = [
  "idle",
  "waiting",
  "running",
  "review",
  "failed",
  "jumping",
  "waving",
  "sleeping"
];

// timed 状态的默认持续时间（毫秒）
const TIMED = {
  jumping: 3200,
  waving: 2200,
  review: 2600,
  failed: 5000
};

export function createPetState(options = {}) {
  const now = options.now ?? (() => Date.now());
  const timed = { ...TIMED, ...(options.timed ?? {}) };

  let state = "idle";
  let since = now();
  let until = 0; // timed 状态的到期时间，0 表示非常驻
  let bubble = null; // { text, until }
  let look = null; // { dx, dy } 注视方向（-1..1），null 表示不追视

  function set(next, durationMs = 0) {
    if (!STATES.includes(next)) throw new Error(`未知桌宠状态：${next}`);
    state = next;
    since = now();
    until = durationMs > 0 ? since + durationMs : 0;
  }

  /** 外部事件 → 状态迁移。返回迁移后的状态。 */
  function dispatch(event, arg) {
    const t = now();
    switch (event) {
      case "tool_call": // 模型开始调工具 → 干活
        if (state === "idle" || state === "sleeping" || state === "waiting") set("running");
        break;
      case "tool_done": // 工具返回 → 短暂复核
        if (state === "running") set("review", timed.review);
        break;
      case "task_done": // 任务完成 → 庆祝
        set("jumping", timed.jumping);
        break;
      case "task_failed": // 任务出错 → 沮丧
        set("failed", timed.failed);
        break;
      case "user_message": // 用户发消息 → 等待
        if (state === "idle" || state === "sleeping") set("waiting");
        break;
      case "poke": // 被戳 → 挥手
        set("waving", timed.waving);
        break;
      case "pat": // 被摸头 → 开心跳跃
        set("jumping", timed.jumping);
        break;
      case "sleep": // 久无互动 → 睡觉
        if (state === "idle") set("sleeping");
        break;
      case "wake": // 有互动 → 醒来
        if (state === "sleeping") set("idle");
        break;
      case "say": // 说话只冒泡，不强制切状态（waiting/running 下保持原状态）
        bubble = { text: String(arg ?? ""), until: t + (options.bubbleMs ?? 4000) };
        if (state === "idle" || state === "sleeping") set("waiting");
        break;
      case "emote": // 模型/用户强制指定状态
        set(String(arg), timed[String(arg)] ?? 0);
        break;
      default:
        throw new Error(`未知桌宠事件：${event}`);
    }
    return state;
  }

  /** 推进时间：timed 到期回 idle；气泡到期清除。返回当前快照。 */
  function tick() {
    const t = now();
    if (until && t >= until) {
      // timed 结束：failed 之后回 idle，其余同理
      set("idle");
    }
    if (bubble && t >= bubble.until) bubble = null;
    return snapshot();
  }

  function setLook(dx, dy) {
    if (dx == null || dy == null) { look = null; return; }
    look = { dx: Math.max(-1, Math.min(1, dx)), dy: Math.max(-1, Math.min(1, dy)) };
  }

  function snapshot() {
    return {
      state,
      since,
      msInState: now() - since,
      bubble: bubble && now() < bubble.until ? bubble.text : null,
      look
    };
  }

  return { dispatch, tick, snapshot, setLook, STATES };
}
