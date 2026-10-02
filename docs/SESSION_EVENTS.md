# 宿主活动事件提案（让桌宠真正「跟着 SecAgent 干活」）

当前状态：桌宠的动画**只能靠模型主动调 `pet_emote`**。模型忘了、或者一轮里没调，桌宠就一直待机。
Codex 原生、whale-girl、petdex 全部是**宿主活动钩子直驱**，不依赖模型自觉。

## 为什么不能靠轮询宿主内部状态

SecAgent 宿主当前没有可供插件读取的会话/回合状态接口：

- `PluginHostApi`（`src/plugin-manager.ts`）没有事件订阅，只有工具/技能/提示词/规则/设置/预览/overlay/网络；
- 本地 HTTP（`src/secagent-http.ts`）只有 `/health`、`/plugins`、`/plugins/install`；
- `session-store.ts` 在主进程内，未对外暴露。

DSH 生态在这点上踩过坑并留了结论（`liyupi/dsh-kun-like-pet` CHANGELOG v3/v4）：
用 `internal/dispatch` 探针实测 831 次事件，`agent/status`、`agent/turn-stopping` 这类状态事件
**0 次**流经动态插件所在总线，事件监听永远等不到「任务完成」，最后只能改成轮询 `agents` 服务。
所以别指望「宿主总会发事件」——要么显式提供订阅，要么显式提供只读快照。

## 方案 A（推荐）：`api.onActivity` 订阅

```ts
api.onActivity(handler: (e: ActivityEvent) => void): () => void;

type ActivityKind =
  | "turn_started" | "tool_started" | "tool_finished"
  | "approval_requested" | "approval_resolved"
  | "turn_completed" | "turn_failed" | "turn_blocked";

interface ActivityEvent {
  kind: ActivityKind;
  sessionId: string;
  at: number;          // 单调时钟毫秒
  /** 可选的无内容摘要（工具名、模型名），不要带参数与输出 */
  label?: string;
}
```

要求（对齐 petdex 的 DSH 集成）：

- **只发无内容投影**：不带 prompt、工具参数、模型输出、审批内容；
- **按 session 保序**，带序号，宿主侧去重；
- 插件停用/卸载时自动退订，和 overlay 同一套生命周期；
- 不新增权限，沿用 `agent.tools`；或单开 `agent.activity`。

## 方案 B：只读快照 + SSE（whale-girl 的做法）

```
GET  /pet-activity/state    → { apiVersion, sessions: [{id, state, since}], turnCompletedUntil }
GET  /pet-activity/events   → SSE 刷新信号（收到消息后重新拉 /state）
POST /pet-activity/presence → 桌面伴侣心跳 { online: true }，TTL 45s；在场时网页内宠物自动隐藏
```

对标 `whale-girl` 的 `/whale-girl/{state,events,presence}`：快照只读、可被多个消费者同时观察，
**不抢事件**。适合「多个伴生应用一起看同一份活动」。

## 状态映射（照抄生态共识，跨宿主观感一致）

| SecAgent 活动 | 桌宠状态 | 精灵行 |
| --- | --- | --- |
| 回合开始 | `jumping` | 4 |
| 工具执行中 | `running` | 7 |
| 请求用户确认 | `waiting` | 6 |
| 工具返回 | `review` | 8 |
| 回合完成 | `waving` | 3 |
| 回合失败/中断 | `failed` | 5 |
| 无活动 ≥ idleSleepSec | `sleeping`（复用 idle 行） | 0 |

优先级沿用 whale-girl 的单链，拖拽永远压过一切：

```
drag > 事件 burst(waving/jumping/failed) > 用户互动 > waiting > running > review > sleeping > idle
```

## 本插件的过渡方案（宿主未实现前也能用）

1. **模型驱动**：`pet_emote` + `pet_say`，并把规则写进 `registerPrompt`（现状）；
2. **输入驱动**：`registerPreRule`（需 `agent.pre_rules` 权限）拦用户消息 → `waiting`；
3. **工具驱动**：注册一个隐藏的 `pet_note` 工具，或让已有工具在描述里带一句「调用后 pet_emote(running)」。

三条都不保证「不漏」，但覆盖了绝大多数场景。宿主一旦提供 `onActivity`，删掉第 3 条即可。