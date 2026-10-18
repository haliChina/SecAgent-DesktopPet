# 桌宠皮肤制作教程与 Prompt 模板（SKIN_PROMPT）

配合 [SKIN_SPEC.md](SKIN_SPEC.md)（动画契约规范）使用。三条路线按你的工具选：让编码 Agent 全自动做（推荐）、用图像生成模型半自动做、手工画。

**先记住三条铁律**（违规是最常见的失败原因）：

1. 图集是**一张图**：8 列 × 11 行网格、每格 192×208（v2，总 1536×2288），背景**全透明**；
2. **帧数是契约**：每行实际播放的帧数固定（idle 6 帧、跑步 8 帧……），行内不足 8 帧的末列留透明，别画满；
3. 尺寸不必精确标准值——**任意整倍缩放也接受**（宽 % 8 == 0、高 % 11 == 0、格子比例 ≈ 192/208 即可），AI 生成偏大的图缩到任一合法倍率就能用。

---

## 路线 A：让编码 Agent 全自动做（推荐）

把下面整段复制给能操作文件、能调图像生成工具的 Agent（SecAgent 本体、Claude Code、Cursor 都行）：

````markdown
帮我做一套桌宠皮肤并安装。严格遵守以下契约（来源：desktop-pet 的 docs/SKIN_SPEC.md）。

【角色设定】
（在这里描述你的角色：物种、配色、风格、装饰，越具体越好）

【图集契约】
- 输出 spritesheet.png：8 列 × 11 行网格，每格 192×208，总尺寸精确 1536×2288；
- 背景全透明，角色主体居中、脚踩格底、四周留约 10% 透明边；
- 行 0~8 是九个动画状态行，行 9~10 是 16 格注视图。

【状态行表】（每行从左到右按帧播放，不足 8 帧的末列留透明）
| 行 | 状态 | 帧数 | 内容要求 |
|---|---|---|---|
| 0 | idle 待机 | 6 | 呼吸起伏的站立循环 |
| 1 | running-right 右跑 | 8 | 面朝右的跑步循环 |
| 2 | running-left 左跑 | 8 | 面朝左的跑步循环（与行 1 镜像即可） |
| 3 | waving 挥手 | 4 | 挥手打招呼 |
| 4 | jumping 跳跃 | 5 | 蓄力→起跳→落地（渲染器会另加弹跳位移） |
| 5 | failed 出错 | 8 | 委屈、晕头转向 |
| 6 | waiting 等待 | 6 | 探头张望等待 |
| 7 | running 干活 | 6 | 轻快小跑 |
| 8 | review 复核 | 6 | 托腮思考/检查 |
| 9 | look 注视上半 | 8 格 | 头转向：正上、右上偏上、右上、右下偏右、正右、右下偏右、右下、右下偏下（顺时针每 22.5° 一格，身体不动只动头和眼） |
| 10 | look 注视下半 | 8 格 | 接着转：正下、左下偏下、左下、左下偏左、正左、左上偏左、左上、左上偏上 |

【工作流】
1. 先生成角色定妆立绘（正面全身、透明背景），确认风格后再做动作帧——所有帧必须同一角色、同一风格、同一光照、同一基准线（脚底对齐）；
2. 逐状态生成帧图，存到 frames/<状态名>/0.png 起编号；
3. 用下面的脚本拼图集；
4. 自检：文件总尺寸精确 (1536, 2288)、背景透明、逐行帧数正确；
5. 写 pet.json（id 用小写连字符），把整个目录放到 ~/.codex/pets/（或告诉我你的皮肤目录设置）；
6. 用 pet_skin 工具切换到新皮肤验证，逐状态检查动画是否正常。

【拼接脚本（Python + Pillow）】
from PIL import Image
CELL_W, CELL_H, COLS, ROWS = 192, 208, 8, 11
STATES = {  # 行号: (目录名, 帧数)
    0: ("idle", 6), 1: ("running-right", 8), 2: ("running-left", 8),
    3: ("waving", 4), 4: ("jumping", 5), 5: ("failed", 8),
    6: ("waiting", 6), 7: ("running", 6), 8: ("review", 6),
    9: ("look-a", 8), 10: ("look-b", 8),
}
atlas = Image.new("RGBA", (CELL_W * COLS, CELL_H * ROWS), (0, 0, 0, 0))
for row, (name, n) in STATES.items():
    for i in range(n):
        im = Image.open(f"frames/{name}/{i}.png").convert("RGBA")
        if im.size != (CELL_W, CELL_H):
            im = im.resize((CELL_W, CELL_H))
        atlas.paste(im, (i * CELL_W, row * CELL_H))
atlas.save("spritesheet.png")
print(atlas.size)  # 必须输出 (1536, 2288)

【pet.json 模板】
{
  "id": "my-pet",
  "displayName": "我的宠物",
  "description": "一句话介绍",
  "spriteVersionNumber": 2,
  "spritesheetPath": "spritesheet.png"
}

【失败对照】
- 气泡提示「皮肤尺寸对不上契约」→ 尺寸或网格不对，回到自检第 4 步；
- 动画错位/闪没 → 格子没对齐网格或末列没留透明；
- 换肤后角色看不见 → 背景没透明或画到了错误行；
- 皮肤列表里不出现 → pet.json 缺 id/displayName/spritesheetPath，或路径越界。
````

---

## 路线 B：图像生成模型半自动做

**诚实的局限**：图像模型画不出像素级精确的 11 行网格，别指望一次生成整张图集。可行做法是**逐状态生成横条（strip）再拼接**：

1. **定妆**：生成角色正面全身立绘（提示词强调：single character, full body, front view, transparent background, consistent style）；
2. **逐状态生成**：每次生成一个状态的动作序列（4~8 帧横条或关键帧），提示词模板：

   ```
   A sprite strip of [角色描述], 8 frames of a run cycle facing right,
   same character as the reference, flat cartoon style, consistent lighting,
   each frame in a separate cell, transparent background, feet aligned to bottom
   ```

3. **拼接**：把帧裁成单帧后用路线 A 的脚本拼图集；
4. **尺寸修正**：生成图偏大没关系——缩放到 1536×2288（或任何合法倍率，见铁律 3）即可，不必追求原生 192×208 的格子；
5. 校验与安装同路线 A 的 4~6 步。

提示词要点：`sprite sheet`、`run cycle`、`consistent character`、`transparent background`、`feet aligned`、`same style as reference`。一次只做一个状态，多个状态混在一张图里几乎必糊。

---

## 路线 C：手工绘制

适合设计师，工具任意（Aseprite / PS / Krita / Figma）：

1. 建画布 **1536×2288**，拉参考网格 8 列 × 11 行、每格 192×208；
2. 按 SKIN_SPEC.md §3 的行表逐行画：先画 idle 定稿，复制到其他行改动作，保持基准线（脚底）一致；
3. 不足 8 帧的行末列留透明；行 9~10 按罗盘顺序画 16 个转头（身体不动）；
4. 导出 **PNG 或 WebP，带 alpha**（JPEG 会让点击热区变矩形）；
5. 与 pet.json 一起放进 `~/.codex/pets/<你的皮肤名>/`，`pet_skin` 切换验证。

Aseprite 导出参考：File → Export Sprite Sheet，Sheet type 选 **Horizontal strips** 逐行导出后手动堆叠，或直接在一张画布上排版后整图导出。

---

## 装好之后

- 对 Agent 说「换个皮肤试试 <名字>」或「列出皮肤」；
- 逐状态验证：戳一下（挥手）、拖动（跑步）、快速甩出（飞行+落地）、静置等指针靠近（注视跟随）；
- 满意的话可以提交到 petdex 商店与社区分享。
