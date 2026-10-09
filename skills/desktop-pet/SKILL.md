---
name: desktop-pet
description: 在桌面养一只小宠物：兼容社区 Codex 桌宠皮肤，跟随任务状态切换动画，可交互（戳戳/摸头/拖拽/气泡对话）。
---

# 桌面宠物（Desktop Pet）

当用户提到桌宠、宠物，或你想让任务过程更生动时使用本技能。

## 前置条件

- 插件已启用且 `petEnabled` 为 true；
- 首次使用建议先 `pet_show` 确认桌宠可见。

## 皮肤（兼容社区 Codex 皮肤）

- 皮肤 = `pet.json` + `spritesheet.webp`，v2 版式 1536×2288（8×11，每格 192×208），也兼容 8×9 classic；
- 自动发现的位置：`~/.codex/pets/`、`~/.petdex/pets/`（`npx petdex install` 装的）、`$PETDEX_PET`，零转换；
- `pet_skin` 不传参列出皮肤，传 `skinId` 切换；切换会热生效，不用重开窗口；
- 本地没有想要的皮肤时，先 `pet_store` 传 `query` 搜索，再传 `slug` 安装，装完立刻可换；
- 没有皮肤时显示内置小鲸鱼兜底形象，照样可交互。

## 工具契约

完整 key 前缀为 `desktop-pet__`：

| 工具 key | 参数 | 作用 |
|---|---|---|
| `desktop-pet__pet_say` | `text`（≤40字为佳） | 桌宠冒泡说话 |
| `desktop-pet__pet_emote` | `emote`: idle/waiting/running/review/failed/jumping/waving/sleeping | 切换动画状态 |
| `desktop-pet__pet_skin` | 可选 `skinId` | 列出/切换皮肤 |
| `desktop-pet__pet_store` | 可选 `query` 或 `slug` | 社区商店搜索 / 安装皮肤 |
| `desktop-pet__pet_show` | 无 | 显示桌宠 |
| `desktop-pet__pet_hide` | 无 | 隐藏桌宠 |
| `desktop-pet__pet_config` | `action`: list/set；set 另带 `key`/`value` | 查看/修改设置（开关、尺寸、入睡时间等） |

## 状态联动（优先）

宿主支持活动事件时（SecAgent ≥ 0.3，声明 `agent.activity`），桌宠动画由宿主直接驱动，
**不需要**你手动调 `pet_emote`——那只是老宿主或需要临时改情绪时的兜底手段。

## 状态使用指南（兜底）

- 开始干活前：`pet_emote(running)`；需要用户确认时：`pet_emote(waiting)`；
- 任务完成：`pet_emote(jumping)` + `pet_say("搞定！")`；
- 任务失败：`pet_emote(failed)` + 简短说明；
- 完成后回到 `pet_emote(idle)`，别让它一直蹦。

## 用户侧交互（渲染页）

- 单击：戳戳 → 挥手 + 随机回应；双击：摸头 → 开心；
- 拖拽：移动桌宠并切成走行动画（方向跟随）；悬停：16 方向追视（v2 皮肤用注视行，v1 退化为水平翻转）；
- 右键：菜单（说句话 / 换皮肤 / 睡觉 / 隐藏）。

## 约束

- 气泡文字简短口语化，不要刷屏；
- 不要在用户专心工作时频繁切换状态；
- overlay 模式需要宿主支持 `agent.overlay`（见 docs/OVERLAY_API.md），否则降级为浏览器标签页。
