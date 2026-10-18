# SecAgent · 桌面宠物插件

在桌面养一只小宠物：**兼容社区 Codex 桌宠皮肤**（`pet.json` + 精灵图），跟随任务状态切换动画，支持戳戳、摸头、拖拽、气泡对话。

- **皮肤兼容**：严格实现社区精灵图契约——v1 `1536×1872`（8×9）、v2 `1536×2288`（8×11），每格 `192×208`。
  逐状态的**帧数与逐帧时长**按契约表播放（idle 6 帧 / waving 4 帧 / jumping 5 帧…），不是一律 8 帧。
- **商店直装**：`pet_store` 工具直连 Codex 社区商店（petdex，4800+ 只），一键装到 `~/.codex/pets`。
- **状态联动**：由宿主活动事件（`api.onActivity`，需 SecAgent ≥ 0.3）直接驱动——
  回合开始/工具执行/请求审批/回合完成/失败/中断各自对应一个动作，不再依赖模型自觉调工具；
  老宿主没有该 API 时自动降级为 `pet_emote` 工具驱动。
  另有 `running-right` / `running-left` 行走行（拖拽时自动使用，方向跟随）。
- **交互**：单击戳戳、双击摸头、拖拽移动、16 方位追视（v2 皮肤）、右键菜单、久无自动入睡。
- **显示模式**：宿主支持 `agent.overlay` 时为真·桌面浮窗（透明置顶 + **指针命中才接管点击**），
  否则降级为系统浏览器标签页。

## 安装

1. SecAgent → 设置 → 插件 → **从 ZIP 安装**，选择发布包 `desktop-pet-<version>.zip`；
2. 启用插件；
3. 对 Agent 说「把桌宠叫出来」（`pet_show`），或「换个皮肤」（`pet_skin`）；
4. 调设置：对 Agent 说「把桌宠调大一点 / 关掉桌宠 / 多久没互动就睡觉」（`pet_config`，
   action=list/set；宿主暂未提供插件设置面板渲染，这是目前唯一的设置入口）。

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
- [x] **宿主活动事件订阅**——插件侧已接好 `api.onActivity` + `api.getActivity()` 快照补齐；
      宿主实现见 `haliChina/SecAgent` 分支 `feat/plugin-activity-events`，契约见宿主 `docs/plugins.md`。
      老宿主（无 `onActivity`）自动降级，功能不挂。
- [ ] 养成玩法（XP / 等级 / 称号，照 whale-girl 的零负反馈账本）
- [ ] Live2D 皮肤支持

## 已知问题与修复记录

- **拖动桌宠抽搐（0.4.0）**：拖拽增量曾按 clientX 计算——窗口移动后同一物理鼠标的 client 坐标会反向跳回，与异步 setBounds 叠加形成反馈振荡。0.4.1 起改用 screenX/screenY（屏幕坐标系，不受窗口移动影响），增量逐帧消费，窗口跟手不抖。
- **右键菜单点不着（0.4.0）**：菜单打开后鼠标移向菜单项即离开角色像素，穿透接管被释放，点击全部落到桌面。0.4.1 起菜单打开期间保持接管，失焦时连菜单一起收起。
- **「说句话/换皮肤」从未生效（0.4.0）**：Electron 沙盒渲染进程里 window.prompt 静默返回 null。0.4.1 起改为随机台词与循环切换皮肤。
- **拖拽方向错乱/自漂移（0.4.1）**：增量协议跨进程换算在 DPI 缩放下错位（实机：往左上拖反而往左下慢速漂移）。0.4.2 起改为绝对定位协议——渲染端只上报抓取偏移，宿主用主进程光标坐标反推窗口原点，无累积、每帧自纠错（需宿主同步更新；旧宿主自动退回增量协议）。长按不动也不再进入跑步动画。
- **超大皮肤换不上（0.4.1）**：只认标准 1536×1872/2288 图集，社区 2× 放大图集被静默拒播（实机：用户被迫在线压缩后才能换）。0.4.2 起按几何推导网格——宽为 8 的倍数、高为 9/11 的倍数、格子纵横比吻合即接受，任意倍率直接可用。
- **改大小要重启客户端（0.4.1）**：overlay 窗口尺寸固定且渲染页不热更配置。0.4.2 起 pet_config 改 size 即时生效：窗口锚定右下角原地缩放，画布 800ms 内热更。

## 致谢

桌宠的甩出物理（拖拽轨迹采速、松手初速估算、抛掷积分与四边反弹、四档力度）移植自
[MerZlin/dsh-pet-indesktop](https://github.com/MerZlin/dsh-pet-indesktop)（MIT License，
Copyright (c) 2026 Merzlin）的 `pet/physics.py`，参数取值依据与测试语义随代码保留。
许可证全文与移植明细见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
