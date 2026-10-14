# Overlay API 提案（给 SecAgent 宿主）

桌面宠物插件需要一个**透明、常置顶、点击穿透**的浮动窗口来做真·桌宠。
建议复用 `agent.preview`（`openSvgPreview`）已有的隔离窗口安全模式，新增：

## 权限

```json
{ "permissions": ["agent.overlay"] }
```

## API

```ts
api.createOverlay(options: {
  url: string;            // 插件本地服务地址（仅允许 http://127.0.0.1/*）
  width: number;          // 逻辑宽度，如 260
  height: number;         // 逻辑高度，如 300
  transparent?: boolean;  // 默认 true
  alwaysOnTop?: boolean;  // 默认 true
  clickThrough?: boolean; // 默认 true：鼠标穿透，仅内容主动接管时捕获
}): Promise<OverlayHandle>

interface OverlayHandle {
  show(): Promise<void>;
  hide(): Promise<void>;
  close(): Promise<void>;
  setBounds(rect: { x?, y?, width?, height? }): Promise<void>;
}
```

## 安全与行为（对齐 openSvgPreview）

- 只允许加载 `http://127.0.0.1/*` / `http://localhost/*`，禁止外网 URL；
- 无 Node Integration，`contextIsolation: true`，独立 session；
- 点击穿透默认开启：窗口级 `setIgnoreMouseEvents(true, { forward: true })`，
  渲染页在指针进入精灵命中区时通过预置的 `window.__petHost.setIgnoreMouseEvents(false)`
  临时接管，离开恢复（Electron 官方推荐做法）；
- 插件停用 / 卸载时宿主自动关闭其 overlay；
- CLI 等无窗口环境：`api.createOverlay` 不存在，插件自行降级（本插件已实现浏览器降级）。

## 渲染页 ↔ 宿主桥（可选注入）

```js
window.__petHost = {
  setIgnoreMouseEvents(ignore: boolean): void,  // 点击穿透开关
  move(dx: number, dy: number): void,           // 拖拽移动窗口（旧协议，增量；DPI 缩放下可能漂移，仅兜底）
  moveTo(offsetX: number, offsetY: number): void // 拖拽绝对定位（0.4.2+）：传抓取点在窗口内的
                                                  // 偏移（拖拽期间恒定），宿主用主进程光标坐标
                                                  // 反推窗口原点，无跨进程增量换算、每帧自纠错
};
```

`setBounds` 支持 `anchor`：`{ width, height, anchor: "bottom-right" }` 只改宽高时保持
窗口右下角不动（桌宠锚定右下角，改尺寸时原地缩放；旧宿主忽略该字段，退化为左上角锚定）。

## 插件侧兼容写法（本插件已采用）

```js
if (typeof api.createOverlay === "function") {
  overlay = await api.createOverlay({ url, width: 260, height: 300, transparent: true, alwaysOnTop: true, clickThrough: true });
} else {
  // 降级：系统浏览器打开渲染页
}
```
