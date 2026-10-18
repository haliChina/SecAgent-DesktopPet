#!/usr/bin/env node
// 桌宠皮肤「一键生成 prompt」工具。
// 用法：node scripts/gen-skin-prompt.mjs "<角色设定一句话>"
//   可选环境变量：SKIN_ID（默认从描述生成）、SKIN_DIR（默认 ~/.codex/pets/<id>）
// 输出：完整契约 prompt（复制给任意编码 Agent 即可全自动做皮肤并安装）。
//
// prompt 模板与 docs/SKIN_SPEC.md、docs/SKIN_PROMPT.md 保持同步；
// 契约数字（网格/帧数/时长）改动时须同步改这里。

import os from "node:os";
import path from "node:path";

const args = process.argv.slice(2);
const description = args.filter((a) => !a.startsWith("--")).join(" ").trim();

if (!description) {
  console.error("用法: node scripts/gen-skin-prompt.mjs \"<角色设定，例如：一只戴圆眼镜的橘猫程序员>\"");
  console.error("可选: SKIN_ID=自定义id SKIN_DIR=/目标/安装/目录 node scripts/gen-skin-prompt.mjs \"...\"");
  process.exit(1);
}

// 由描述启发式生成 id：有英文词就用英文词（短横线连接）；
// 纯中文描述不硬翻译（长中文目录名不优雅），退到 skin-<随机4位>，
// 用户可用 SKIN_ID 环境变量覆盖。
function guessId(desc) {
  if (process.env.SKIN_ID) return process.env.SKIN_ID;
  const latinWords = desc
    .replace(/[^\p{Script=Latin}0-9]+/gu, " ")
    .trim()
    .split(/\s+/)
    .filter((w) => w.length >= 2 && /^[a-z0-9]+$/i.test(w))
    .slice(0, 4)
    .map((w) => w.toLowerCase());
  if (latinWords.length) return latinWords.join("-");
  const rand = Math.random().toString(36).slice(2, 6);
  return `skin-${rand}`;
}

const skinId = guessId(description);
const displayName = description.slice(0, 30);
const installDir = process.env.SKIN_DIR
  ? process.env.SKIN_DIR
  : path.join(os.homedir(), ".codex", "pets", skinId);

const prompt = `帮我做一套桌宠皮肤并安装到 ${installDir}。严格遵守以下契约（来源：desktop-pet 的 docs/SKIN_SPEC.md）。

【角色设定】
${description}

【第一步：定妆图】
先单独生成一张 192×208 的定妆图（透明背景、全身、脚踩底边、居中）。
把这张图给用户确认风格后再继续，避免 11 行画完才发现角色不对。

【图集契约】
- 输出 spritesheet.png：8 列 × 11 行网格，每格 192×208，总尺寸精确 1536×2288；
- 背景全透明，角色主体居中、脚踩格底、四周留约 10% 透明边；
- 行 0~8 是九个动画状态行，行 9~10 是 16 格注视图；
- 整倍缩放的图集也合法（宽 % 8 == 0、高 % 11 == 0、格子纵横比 ≈ 192/208 即可），
  生成 192×208 或 2× 的 384×416 网格都行，别为凑尺寸拉伸变形。

【状态行表】（每行从左到右按帧播放，不足 8 帧的末列留透明）
| 行 | 状态 | 帧数 | 内容要求 |
|---|---|---|---|
| 0 | idle 待机 | 6 | 呼吸起伏的站立循环 |
| 1 | running-right 右跑 | 8 | 面朝右的跑步循环 |
| 2 | running-left 左跑 | 8 | 面朝左的跑步循环（与行 1 镜像） |
| 3 | waving 挥手 | 4 | 挥手打招呼 |
| 4 | jumping 跳跃 | 5 | 蓄力→起跳→落地（渲染器会另加弹跳位移，画原地姿态即可） |
| 5 | failed 出错 | 8 | 懊恼/沮丧（拍地、抱头等） |
| 6 | waiting 等待 | 6 | 抱臂/看表等不耐烦的小动作 |
| 7 | running 跑步（前向） | 6 | 正面或 3/4 视角跑 |
| 8 | review 复核 | 6 | 摸下巴/翻页检查 |
| 9 | 注视图上半 | 8 | 原地转头朝 000/022.5/.../157.5 八方位（罗盘序，000=正上顺时针） |
| 10 | 注视图下半 | 8 | 朝 180/202.5/.../337.5 八方位 |

【pet.json】（写入 ${installDir}/pet.json）
{
  "id": "${skinId}",
  "displayName": "${displayName}",
  "description": "${description}",
  "spriteVersionNumber": 2,
  "spritesheetPath": "spritesheet.png"
}

【拼接脚本】逐帧素材生成后用它拼图集（保存为 make-sheet.py 运行，pip install pillow）：
# PYTHON
from PIL import Image
CELL_W, CELL_H, COLS, ROWS = 192, 208, 8, 11
# frames: {行号: [PIL.Image 单帧列表]}，不足 8 帧的行补透明格
frames = {0: [], 1: [], 2: [], 3: [], 4: [], 5: [], 6: [], 7: [], 8: [], 9: [], 10: []}
sheet = Image.new("RGBA", (CELL_W * COLS, CELL_H * ROWS), (0, 0, 0, 0))
for row, imgs in frames.items():
    for col in range(8):
        img = imgs[col] if col < len(imgs) else Image.new("RGBA", (CELL_W, CELL_H), (0, 0, 0, 0))
        if img.size != (CELL_W, CELL_H): img = img.resize((CELL_W, CELL_H))
        sheet.paste(img, (col * CELL_W, row * CELL_H))
sheet.save("spritesheet.png")

【完成标准（逐步执行并自检）】
1. 图片尺寸 == 1536×2288（或合法倍率）；
2. 我会调 desktop-pet__pet_skin 切换到 ${skinId} 验证——出现「皮肤尺寸对不上契约」气泡即失败；
3. 逐状态验证：idle 呼吸、拖动时跑步、快速甩出后落地、指针靠近时注视跟随；
4. 失败排查对照 docs/SKIN_PROMPT.md 的「常见失败对照」表。

现在从定妆图开始。`;

console.log(prompt);
console.error(`\n——\n皮肤 id: ${skinId}\n安装目录: ${installDir}\n（可用 SKIN_ID / SKIN_DIR 环境变量覆盖；把上面整段复制给任意编码 Agent 即可）\n（若当前 Agent 无生图能力：把 prompt 交给生图工具产帧图，带回后由 Agent 拼图集、装、验证——见 docs/SKIN_PROMPT.md 分工说明）`);
