# 宿主活动事件（让桌宠真正「跟着 SecAgent 干活」）

桌宠的动画**必须由宿主活动钩子驱动**，不能靠模型自觉调 `pet_emote`——模型忘了、或者一轮里没调，
桌宠就一直待机。Codex 原生、whale-girl、petdex 的 DSH 集成全部是活动钩子直驱。

本文档记录这条边界的来龙去脉（当时宿主没有事件源），以及**已落地的实现**。
下方「已实现：状态映射」一节以代码为准。

## 为什么不能靠轮询宿主内部状态

SecAgent 宿主当前没有可供插件读取的会话/回合状态接口：

- `PluginHostApi`（`src/plugin-manager.ts`）没有事件订阅，只有工具/技能/提示词/规则/设置/预览/overlay/网络；
- 本地 HTTP（`src/secagent-http.ts`）只有 `/health`、`/plugins`、`/plugins/install`；
- `session-store.ts` 在主进程内，未对外暴露。

DSH 生态在这点上踩过坑并留了结论（`liyupi/dsh-kun-like-pet` CHANGELOG v3/v4）：
用 `internal/dispatch` 探针实测 831 次事件，`agent/status`、`agent/turn-stopping` 这类状态事件
**0 次**流经动态插件所在总线，事件监听永远等不到「任务完成」，最后只能改成轮询 `agents` 服务。
所以别指望「宿主总会发事件」——要么显式提供订阅，要么显式提供只读快照。

## 方案 A（已落地）：`api.onActivity` 订阅

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

## 方案 B（未采纳）：只读快照 + SSE（whale-girl 的做法）

```
GET  /pet-activity/state    → { apiVersion, sessions: [{id, state, since}], turnCompletedUntil }
GET  /pet-activity/events   → SSE 刷新信号（收到消息后重新拉 /state）
POST /pet-activity/presence → 桌面伴侣心跳 { online: true }，TTL 45s；在场时网页内宠物自动隐藏
```

对标 `whale-girl` 的 `/whale-girl/{state,events,presence}`：快照只读、可被多个消费者同时观察，
**不抢事件**。适合「多个伴生应用一起看同一份活动」。

## 已实现：状态映射（以代码为准）

宿主实现见 `haliChina/SecAgent#2`，契约见宿主 `docs/plugins.md`。下面这张表是**实际实现**，
不是提案——本插件 `main.mjs` 的 `ACTIVITY_MAP` 与此逐行对应：

| 宿主事件 `kind` | 桌宠动作 | 持续/瞬发 | 含义 |
|---|---|---|---|
| `turn_started` | `hold review` | 持续 | 回合开始 = 思考中，复用复核行 |
| `tool_started` | `hold running` | 持续 | 有工具在执行 |
| `tool_finished` | `hold review` | 持续 | 工具返回后模型还要继续推理，不是停在 running |
| `approval_requested` | `hold waiting` | 持续 | 需要用户确认 |
| `approval_resolved` | `hold running` | 持续 | 已处理完（**同意和拒绝都发这个**） |
| `turn_completed` | `emote waving` | 瞬发 2.2s | 回合完成 |
| `turn_failed` | `emote failed` | 瞬发 5s | 失败 |
| `turn_blocked` | `hold waiting` | 持续 | 用户中断，需要注意 ≠ 出错 |

映射按 `kind` 而非 `phase`——`phase` 只存在于 `api.getActivity()` 快照上，事件里没有。

### 拒绝审批的已知耦合

用户点「拒绝」时宿主发 `approval_resolved`（语义是「处理完了」，不区分同意/拒绝），
紧接着 `callTool` 抛错、`run` 发 `turn_failed`。所以拒绝的序列是
`approval_requested → approval_resolved → turn_failed`，桌宠会短暂经过 `running` 再落到 `failed`。
最终结果是对的，中间有一帧闪烁。事件契约目前**没有**能区分同意/拒绝的字段，要消除闪烁
得等宿主加字段——不要在插件侧靠时序猜。

### 优先级

沿用 whale-girl 的单链，拖拽永远压过一切：

```
drag > 瞬发 burst > 持续态 hold > 瞬发到期后补 pending hold > idle
```

- **burst 期间到达的 hold 不丢弃**，记为 `pendingHold`（后来者覆盖），burst 到期回 idle 时补上。
  否则「失败弹窗 5 秒内用户重开一轮」会把思考态吞掉，桌宠显示 idle 而模型其实在推理。
- 新的瞬发状态到达会作废 `pendingHold`。
- 持续态有 15 分钟 TTL 兜底，事件流断了（宿主崩溃、丢了终态）也回 idle，不会永远卡在 running。
- 宿主快照是全局一份、不按会话分区，多会话交错时 `getActivity()` 是 last-writer-wins。
  单桌宠场景无影响。

## 过渡方案（宿主未实现前的兜底，现已不常用）

1. **模型驱动**：`pet_emote` + `pet_say`，并把规则写进 `registerPrompt`（现状）；
2. **输入驱动**：`registerPreRule`（需 `agent.pre_rules` 权限）拦用户消息 → `waiting`；
3. **工具驱动**：注册一个隐藏的 `pet_note` 工具，或让已有工具在描述里带一句「调用后 pet_emote(running)」。

三条都不保证「不漏」，但覆盖了绝大多数场景。宿主已提供 `onActivity`，本插件现在以事件为主路径；
第 1 条（`pet_emote`）保留为老宿主与临时改情绪时的兜底。