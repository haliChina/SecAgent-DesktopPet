# SecAgent · 桌面宠物插件

在桌面养一只小宠物：**兼容社区 Codex 桌宠皮肤**（`pet.json` + `spritesheet.webp`），跟随任务状态切换动画，支持戳戳、摸头、拖拽、气泡对话。

- **皮肤兼容**：v2 版式（1536×2288，8×11）与 classic（1536×1872，8×9）；`~/.codex/pets/` 下的社区皮肤零转换即用；无皮肤时显示内置小鲸鱼兜底形象。
- **状态联动**：idle / waiting / running / review / failed / jumping / waving / sleeping，模型可用 `pet_emote` / `pet_say` 驱动。
- **交互**：单击戳戳、双击摸头、拖拽移动、悬停 16 方向追视、右键菜单。
- **显示模式**：宿主支持 `agent.overlay` 时为真·桌面浮窗（见 `docs/OVERLAY_API.md`），否则降级为系统浏览器标签页。

## 安装

1. SecAgent → 设置 → 插件 → **从 ZIP 安装**，选择发布包 `desktop-pet-<version>.zip`；
2. 启用插件；
3. 对 Agent 说“把桌宠叫出来”（`pet_show`），或“换个皮肤”（`pet_skin`）。

## 社区皮肤

把 Codex 桌宠皮肤目录（如 `elysia/`，内含 `pet.json` + `spritesheet.webp`）复制到：

```
~/.codex/pets/elysia/
├── pet.json
└── spritesheet.webp
```

然后 `pet_skin` 切换。也可以在设置里指定其他皮肤目录。

## 给模型用的工具

| 工具 | 作用 |
|---|---|
| `desktop-pet__pet_say` | 冒泡说话 |
| `desktop-pet__pet_emote` | 切换动画状态 |
| `desktop-pet__pet_skin` | 列出 / 切换皮肤 |
| `desktop-pet__pet_show` / `pet_hide` | 显示 / 隐藏 |

## 开发

```bash
npm test          # 单元测试
npm run check     # 语法检查
npm run pack      # 生成 release/desktop-pet-<version>.zip
```

## 路线图

- [ ] 宿主 `agent.overlay` API（真桌面浮窗，提案见 `docs/OVERLAY_API.md`）
- [ ] 会话事件自动驱动（当前由模型工具驱动 + 渲染页交互驱动）
- [ ] 喂食 / 亲密度等养成玩法
- [ ] Live2D 皮肤支持
