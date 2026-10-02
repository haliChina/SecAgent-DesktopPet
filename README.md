# SecAgent · 桌面宠物插件

在桌面养一只小宠物：**兼容社区 Codex 桌宠皮肤**（`pet.json` + 精灵图），跟随任务状态切换动画，支持戳戳、摸头、拖拽、气泡对话。

- **皮肤兼容**：严格实现社区精灵图契约——v1 `1536×1872`（8×9）、v2 `1536×2288`（8×11），每格 `192×208`。
  逐状态的**帧数与逐帧时长**按契约表播放（idle 6 帧 / waving 4 帧 / jumping 5 帧…），不是一律 8 帧。
- **商店直装**：`pet_store` 工具直连 Codex 社区商店（petdex，4800+ 只），一键装到 `~/.codex/pets`。
- **状态联动**：idle / waiting / running / review / failed / jumping / waving / sleeping，
  外加 `running-right` / `running-left` 行走行（拖拽时自动使用，方向跟随）。
- **交互**：单击戳戳、双击摸头、拖拽移动、16 方位追视（v2 皮肤）、右键菜单、久无自动入睡。
- **显示模式**：宿主支持 `agent.overlay` 时为真·桌面浮窗（透明置顶 + **指针命中才接管点击**），
  否则降级为系统浏览器标签页。

## 安装

1. SecAgent → 设置 → 插件 → **从 ZIP 安装**，选择发布包 `desktop-pet-<version>.zip`；
2. 启用插件；
3. 对 Agent 说「把桌宠叫出来」（`pet_show`），或「换个皮肤」（`pet_skin`）。

## 皮肤来源

按优先级扫描，同 id 只保留首个：

| 目录 | 来源 |
| --- | --- |
| `<插件>/skins` | 插件自带 |
| `~/.codex/pets` | Codex 官方自定义皮肤 |
| `~/.petdex/pets` | `npx petdex install <slug>` |
| `$PETDEX_PET` | petdex 桌面端同款覆盖变量 |
| 设置里的自定义目录 | `codexPetsDir` / `customSkinDirs` |

社区皮肤零转换即用；没有皮肤时显示内置小鲸鱼兜底形象。

## 给模型用的工具

| 工具 | 作用 |
| --- | --- |
| `desktop-pet__pet_say` | 冒泡说话 |
| `desktop-pet__pet_emote` | 切换动画状态 |
| `desktop-pet__pet_skin` | 列出 / 切换皮肤 |
| `desktop-pet__pet_store` | 在 petdex 商店搜索 / 安装皮肤 |
| `desktop-pet__pet_show` / `pet_hide` | 显示 / 隐藏 |

## 安全边界

- `pet.json` 必填 `id` / `displayName` / `spritesheetPath`，且 `spritesheetPath` 必须是皮肤目录内的
  **安全相对路径**——皮肤来自公开商店，绝对路径或 `../` 一律拒收（否则 `/skin-file/*` 会变成任意本地文件读）。
- 商店资源必须走 `https://assets.petdex.dev`，与 petdex CLI 同一份主机白名单，路径段也不允许 `..`。
- 本地服务只绑 `127.0.0.1` 随机端口，校验 `Host` 头 + 随机 token；皮肤文件按 id 白名单取，不接受任意路径参数。
- overlay 窗口默认鼠标穿透，只有指针命中**当前帧的不透明像素**时才临时接管，离开即交还。

## 开发

```bash
npm test          # 45 个单元测试
npm run check     # 语法检查
npm run pack      # 生成 release/desktop-pet-<version>.zip
```

## 路线图

- [x] 精灵图契约严格实现（帧数 / 逐帧时长 / 16 方位格序 / 图集尺寸校验）
- [x] 指针命中才接管点击（overlay 模式可交互）
- [x] 商店直装（petdex manifest + 主机白名单）
- [ ] **宿主活动事件订阅**（`api.onActivity` 或只读快照 + SSE）——提案见 `docs/SESSION_EVENTS.md`。
      当前动画靠模型调 `pet_emote` 驱动，宿主一旦提供事件即可去掉这层不可靠性。
- [ ] 养成玩法（XP / 等级 / 称号，照 whale-girl 的零负反馈账本）
- [ ] Live2D 皮肤支持