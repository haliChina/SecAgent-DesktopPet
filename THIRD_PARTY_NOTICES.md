# Third-Party Software Notices and Information

本插件包含以下第三方软件代码，按其原始许可证条款使用与分发。

---

## 1. 桌宠甩出物理（拖拽轨迹采速 / 抛掷积分 / 力度档位）

- **文件**：`pet/renderer/physics.js`（及其浏览器化注入形态，见 `main.mjs`）
- **来源仓库**：[MerZlin/dsh-pet-indesktop](https://github.com/MerZlin/dsh-pet-indesktop)
  的 `pet/physics.py`（该仓库本身基于 PC2005-cloud/dsh-pet 移植）
- **许可证**：MIT License（正文见下）
- **移植内容**：松手初速估算（`estimate_release_velocity` 及其参数常量：
  轨迹保留窗口、噪声合并、死区、峰值权重、加速度增益）、速度软上限
  （`soft_clamp_speed`，本项目将软膝公式改为指数渐近 `cap·(1-e^(-v·k/cap))`，
  保证单调且永不穿透上限）、飞行动画速率（`flight_anim_speed`）、抛掷单步
  积分与四边反弹（`throw_step`）、静止判定（`is_at_rest`）、四档力度映射
  （`THROW_STRENGTH_CAPS` / `normalize_throw_strength` / `throw_speed_cap`）。
  参数取值依据注释与测试用例语义随代码保留。
- **未移植**：拖拽弹簧（本项目拖拽用绝对定位协议，天然跟手）与弹弓交互。
- **改动**：Python → JavaScript（ES module，浏览器经 `window.__petPhysics` 注入）；
  坐标语义对齐本项目的 overlay 窗口/浏览器降级两种渲染形态。

### MIT License Text

```text
MIT License

Copyright (c) 2026 Merzlin

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
