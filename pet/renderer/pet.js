// 桌宠渲染器：canvas 精灵图播放 + 交互。无依赖。
// 由宿主 overlay 窗口或系统浏览器加载；与插件服务用 token + 轮询通信。
//
// 契约由服务端注入 window.__PET_FORMAT（见 pet/skins.mjs publicFormat），
// 本文件不重复状态表——帧数与逐帧时长都是契约的一部分，按「每行都 8 帧」播放
// 会让末列为空的行周期性闪没。
(() => {
  "use strict";
  const qs = new URLSearchParams(location.search);
  const TOKEN = qs.get("token") || "";
  const api = (p, init) => fetch(p + (p.includes("?") ? "&" : "?") + "token=" + encodeURIComponent(TOKEN), init);

  const F = window.__PET_FORMAT || { frameWidth: 192, frameHeight: 208, states: {} };
  const CELL_W = F.frameWidth || 192, CELL_H = F.frameHeight || 208;
  const LOOK_COLUMNS = 8;

  // 契约里没有独立的睡觉行，sleeping 复用 idle 行，由 CSS 做闭眼/变暗。
  const STATE_ALIAS = { sleeping: "idle" };

  const canvas = document.getElementById("pet");
  const ctx = canvas.getContext("2d");
  const stage = document.getElementById("stage");
  const bubbleEl = document.getElementById("bubble");
  const menuEl = document.getElementById("menu");
  const menubg = document.getElementById("menubg");

  const S = {
    config: { size: 160, bubbleDurationMs: 4000 },
    skins: [],
    skin: null,
    skinImg: null,
    skinOk: false,
    atlasOk: true,
    state: "idle",
    bubble: null,
    look: null,
    frame: 0,
    frameElapsed: 0,
    lastT: 0,
    scale: 1,
    dragging: false,
    dragMoved: false,
    grabOffset: null,
    downScreen: null, downStartScreen: null, downT: 0,
    appliedSize: 0,
    stagePos: null,
    blinkT: 0, blinkOn: false,
    captured: false,
    pokeLines: ["欸？", "怎么啦？", "在呢在呢~", "戳我干嘛呀", "嘿嘿"],
    patLines: ["好舒服~", "再摸摸嘛", "开心！"]
  };

  function say(text, ms) {
    if (!text) { bubbleEl.classList.remove("show"); return; }
    bubbleEl.textContent = text;
    bubbleEl.classList.add("show");
    clearTimeout(say._t);
    say._t = setTimeout(() => bubbleEl.classList.remove("show"), ms || S.config.bubbleDurationMs || 4000);
  }

  function postEvent(event, arg) {
    api("/api/state", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ event, arg })
    }).catch(() => {});
  }

  // ---------- 皮肤 ----------
  function pickSkin() {
    const want = S.config.skinId;
    return S.skins.find((s) => s.id === want) || S.skins[0] || null;
  }

  /**
   * 从图集实际尺寸推导网格版式。
   * 标准契约：8 列 × (9|11) 行、标准格 192×208。社区皮肤常见 2× 等整倍放大图集
   * （0.4.1 实机：用户被迫在线压缩到标准尺寸才能换肤）。只要几何对得上——
   * 宽是 8 的倍数、高是行数的倍数、格子纵横比 ≈ 192/208——任意倍率都接受，
   * drawSprite/frameBBox 全部按 layout.cellW/cellH 取源格并缩放到 192×208 绘制。
   * @returns {object|null} 推导出的 layout，几何不吻合返回 null。
   */
  function deriveAtlasLayout(w, h) {
    if (!(w > 0) || !(h > 0) || w % 8 !== 0) return null;
    const cw = w / 8;
    for (const rows of [11, 9]) {
      if (h % rows !== 0) continue;
      const ch = h / rows;
      if (Math.abs(cw / ch - CELL_W / CELL_H) > 0.03) continue;
      return { cols: 8, rows, cellW: cw, cellH: ch, lookRows: rows === 11 ? 2 : 0, version: rows === 11 ? 2 : 1 };
    }
    return null;
  }

  function loadSkin(skin) {
    S.skin = skin; S.skinOk = false; S.skinImg = null;
    bboxCache.clear();
    if (!skin) { fitCanvas(); return; }
    const img = new Image();
    img.onload = () => {
      // 以实际尺寸复核版式：声明与图集不符时按图集纠正，仍不符则拒绝播放（画出来只会是错位网格）。
      // 优先级：pet.json 显式 layout 且与实际尺寸吻合 > 按几何推导（标准及任意倍率）> 默认版式（将判失败）。
      const l = skin.layout || {};
      const petJsonValid = !!(l.cols && l.rows && l.cellW && l.cellH
        && img.naturalWidth === l.cols * l.cellW && img.naturalHeight === l.rows * l.cellH);
      if (petJsonValid) {
        skin.layout = { ...l, lookRows: l.lookRows ?? 0, version: l.version ?? "custom" };
      } else {
        const derived = deriveAtlasLayout(img.naturalWidth, img.naturalHeight);
        if (derived) skin.layout = derived;
        else skin.layout = { cols: 8, rows: 11, cellW: CELL_W, cellH: CELL_H, lookRows: 0, version: "custom" };
      }
      const ok = (img.naturalWidth === skin.layout.cols * skin.layout.cellW)
        && (img.naturalHeight === skin.layout.rows * skin.layout.cellH);
      S.atlasOk = ok;
      if (!ok) {
        S.skinImg = img; S.skinOk = true; fitCanvas();
        say("皮肤尺寸对不上契约，已停播");
        return;
      }
      S.skinImg = img; S.skinOk = true;
      fitCanvas();
    };
    img.onerror = () => { S.skin = null; fitCanvas(); };
    img.src = "/skin-file/" + encodeURIComponent(skin.id) + "?token=" + encodeURIComponent(TOKEN);
  }

  function fitCanvas() {
    const target = S.config.size || 160;
    S.scale = target / CELL_W;
    canvas.width = CELL_W; canvas.height = CELL_H;
    canvas.style.width = target + "px";
    canvas.style.height = Math.round(CELL_H * S.scale) + "px";
  }

  // ---------- 当前帧契约 ----------
  /** 返回 { row, columns, frames, frameDurationsMs }；注视态是单帧定格。 */
  function currentSpec() {
    const layout = S.skin && S.skin.layout;
    // 拖拽是运动层，优先于一切动画状态；方向决定用 running-right / running-left 行。
    // 0.4.2：加 dragMoved 门控——长按不动不该播放跑步动画。
    if (S.dragging && S.dragMoved && layout) {
      const id = (S.dragDir ?? 1) < 0 ? "running-left" : "running-right";
      const def = F.states[id];
      if (def) return { row: def.row, columns: 8, frames: def.frames, frameDurationsMs: def.frameDurationsMs };
    }
    if (S.look && layout && layout.lookRows > 0
        && (S.state === "idle" || S.state === "waiting" || S.state === "sleeping")) {
      return { row: null, columns: LOOK_COLUMNS, frames: 1, frameDurationsMs: [160], look: true };
    }
    const id = STATE_ALIAS[S.state] || S.state;
    const def = F.states[id] || F.states.idle;
    return def
      ? { row: def.row, columns: def.columns || 8, frames: def.frames, frameDurationsMs: def.frameDurationsMs }
      : { row: 0, columns: 8, frames: 1, frameDurationsMs: [1000] };
  }

  /** 注视格索引：正上=0，顺时针递增（正右=4，正下=8，正左=12）。 */
  function lookCell(dx, dy) {
    const bearing = Math.atan2(dx, -dy);
    return ((Math.round(bearing / (Math.PI / 8)) % 16) + 16) % 16;
  }

  function advance(t) {
    const spec = currentSpec();
    if (spec.row !== S.lastRow || spec.frames !== S.lastFrames) {
      S.lastRow = spec.row; S.lastFrames = spec.frames;
      S.frame = 0; S.frameElapsed = 0;
    }
    if (spec.look || spec.frames <= 1) { S.frame = 0; return; }
    const dt = Math.min(S.lastT ? t - S.lastT : 0, 1000); // 后台标签页回来不要一次跳几十帧
    S.frameElapsed += dt;
    let guard = 0;
    while (S.frameElapsed >= spec.frameDurationsMs[S.frame] && guard++ < 30) {
      S.frameElapsed -= spec.frameDurationsMs[S.frame];
      S.frame = (S.frame + 1) % spec.frames;
    }
    S.frame = Math.min(S.frame, spec.frames - 1);
  }

  // ---------- 绘制 ----------
  function drawSprite() {
    const layout = S.skin.layout;
    const spec = currentSpec();
    let row, col;
    if (spec.look) {
      // 注视是 16 格 8×2 网格：行 9~10，格序以正上为 0 顺时针递增。
      const idx = lookCell(S.look.dx, S.look.dy);
      row = 9 + Math.floor(idx / LOOK_COLUMNS);
      col = idx % LOOK_COLUMNS;
    } else {
      row = spec.row;
      col = S.frame % spec.frames;
    }
    // v1 无注视行时退化：素材朝右时对左指针水平翻转示意。
    let flip = false;
    if (S.look && !spec.look && S.look.dx < -0.3) flip = true;

    const cw = layout.cellW || CELL_W, ch = layout.cellH || CELL_H;
    ctx.save();
    ctx.clearRect(0, 0, CELL_W, CELL_H);
    if (flip) { ctx.translate(CELL_W, 0); ctx.scale(-1, 1); }
    let oy = 0;
    if (S.state === "jumping") oy = -Math.abs(Math.sin(performance.now() / 180)) * 26;
    ctx.drawImage(S.skinImg, col * cw, row * ch, cw, ch, 0, oy, CELL_W, CELL_H);
    ctx.restore();
  }

  // ---------- 点击热区（跟随当前帧的不透明像素） ----------
  // overlay 窗口默认 setIgnoreMouseEvents(true, {forward:true})，指针事件进不来；
  // 必须先用 mousemove（forward 仍会派发）做命中判定，再主动接管点击。
  const bboxCache = new Map();
  const hitCanvas = document.createElement("canvas");
  hitCanvas.width = CELL_W; hitCanvas.height = CELL_H;
  const hitCtx = hitCanvas.getContext("2d", { willReadFrequently: true });

  /** 返回当前帧不透明像素的归一化包围盒 {x,y,w,h}，缓存按格。 */
  function frameBBox(col, row) {
    const key = col + "," + row;
    const hit = bboxCache.get(key);
    if (hit) return hit;
    const layout = S.skin.layout;
    const cw = layout.cellW || CELL_W, ch = layout.cellH || CELL_H;
    hitCtx.clearRect(0, 0, CELL_W, CELL_H);
    hitCtx.drawImage(S.skinImg, col * cw, row * ch, cw, ch, 0, 0, CELL_W, CELL_H);
    let data;
    try { data = hitCtx.getImageData(0, 0, CELL_W, CELL_H).data; } catch { data = null; }
    let minX = CELL_W, minY = CELL_H, maxX = -1, maxY = -1;
    if (data) {
      for (let y = 0; y < CELL_H; y++) {
        for (let x = 0; x < CELL_W; x++) {
          if (data[(y * CELL_W + x) * 4 + 3] > 24) {
            if (x < minX) minX = x; if (x > maxX) maxX = x;
            if (y < minY) minY = y; if (y > maxY) maxY = y;
          }
        }
      }
    }
    const box = maxX < 0
      ? { x: 0, y: 0, w: 1, h: 1 }
      : { x: minX / CELL_W, y: minY / CELL_H, w: (maxX - minX + 1) / CELL_W, h: (maxY - minY + 1) / CELL_H };
    bboxCache.set(key, box);
    return box;
  }

  /** 指针是否命中当前帧的角色像素（留 margin 像素的迟滞，避免边界抖动反复接管）。 */
  function hitsPet(clientX, clientY) {
    if (!S.skinOk || !S.atlasOk) return false;
    const r = canvas.getBoundingClientRect();
    if (clientX < r.left || clientX > r.right || clientY < r.top || clientY > r.bottom) return false;
    const spec = currentSpec();
    let col, row;
    if (spec.look) {
      const idx = lookCell(S.look.dx, S.look.dy);
      col = idx % LOOK_COLUMNS; row = 9 + Math.floor(idx / LOOK_COLUMNS);
    } else {
      col = S.frame % spec.frames; row = spec.row;
    }
    const box = frameBBox(col, row);
    const mx = (r.width * box.w + 24) / r.width, my = (r.height * box.h + 24) / r.height;
    const cx = box.x + box.w / 2, cy = box.y + box.h / 2;
    const nx = (clientX - r.left) / r.width, ny = (clientY - r.top) / r.height;
    return Math.abs(nx - cx) <= mx / 2 && Math.abs(ny - cy) <= my / 2;
  }

  function setCapture(on) {
    if (S.captured === on) return;
    S.captured = on;
    try { hostBridge.setIgnoreMouseEvents(!on); } catch { /* 无宿主桥时忽略 */ }
  }

  // ---------- 内置兜底形象：小鲸鱼（无皮肤时用） ----------
  function drawFallback(t) {
    const w = CELL_W, h = CELL_H;
    ctx.clearRect(0, 0, w, h);
    const bob = Math.sin(t / 600) * 6;
    const cx = w / 2, cy = h / 2 + bob;
    const sleeping = S.state === "sleeping";

    ctx.save();
    if (sleeping) ctx.globalAlpha = 0.75;

    const wag = Math.sin(t / 300) * 0.35;
    ctx.save();
    ctx.translate(cx - 52, cy - 6); ctx.rotate(wag);
    ctx.fillStyle = "#5b9bd5";
    ctx.beginPath();
    ctx.moveTo(0, 0); ctx.lineTo(-30, -18); ctx.lineTo(-24, 0); ctx.lineTo(-30, 18);
    ctx.closePath(); ctx.fill();
    ctx.restore();

    const grad = ctx.createLinearGradient(cx - 60, 0, cx + 60, 0);
    grad.addColorStop(0, "#7fb8ec"); grad.addColorStop(1, "#4a90d9");
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.ellipse(cx, cy, 58, 44, -0.12, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = "rgba(255,255,255,.55)";
    ctx.beginPath();
    ctx.ellipse(cx + 6, cy + 16, 38, 24, -0.12, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = "#4a90d9";
    ctx.beginPath();
    ctx.moveTo(cx - 8, cy - 42); ctx.quadraticCurveTo(cx + 6, cy - 66, cx + 18, cy - 42);
    ctx.closePath(); ctx.fill();

    S.blinkT -= 16;
    if (S.blinkT <= 0) { S.blinkOn = true; setTimeout(() => { S.blinkOn = false; }, 140); S.blinkT = 2200 + Math.random() * 2600; }
    ctx.strokeStyle = "#223"; ctx.lineWidth = 3; ctx.lineCap = "round";
    const ex = cx + 26, ey = cy - 10;
    ctx.beginPath();
    if (sleeping || S.blinkOn) {
      ctx.moveTo(ex - 8, ey); ctx.quadraticCurveTo(ex, ey + 5, ex + 8, ey);
    } else {
      ctx.arc(ex, ey, 7, 0, Math.PI * 2);
      ctx.fillStyle = "#223"; ctx.fill();
      ctx.fillStyle = "#fff";
      ctx.beginPath(); ctx.arc(ex + 2.5, ey - 2.5, 2.4, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = "#223";
    }
    ctx.stroke();

    ctx.fillStyle = "rgba(255,130,150,.5)";
    ctx.beginPath(); ctx.arc(ex + 16, ey + 12, 6, 0, Math.PI * 2); ctx.fill();

    if (!sleeping && S.state !== "failed") {
      ctx.fillStyle = "rgba(180,220,255,.7)";
      const p = (t / 1400) % 1;
      ctx.beginPath(); ctx.arc(cx - 6, cy - 62 - p * 26, 3 + p * 3, 0, Math.PI * 2); ctx.fill();
    }
    if (S.state === "jumping") {
      ctx.fillStyle = "#ffd75e";
      for (let i = 0; i < 5; i++) {
        const a = t / 500 + (i * Math.PI * 2) / 5;
        const sx = cx + Math.cos(a) * 66, sy = cy + Math.sin(a) * 52 - 10;
        ctx.beginPath(); ctx.arc(sx, sy, 3, 0, Math.PI * 2); ctx.fill();
      }
    }
    ctx.restore();
    canvas.classList.toggle("sleeping", sleeping);
  }

  // ---------- 宿主桥接：优先新版 __secagentOverlay，兼容旧名 __petHost ----------
  const hostBridge = window.__secagentOverlay || window.__petHost || null;

  function frame(t) {
    advance(t);
    S.lastT = t;
    if (S.skinOk && S.atlasOk) { drawSprite(); canvas.classList.toggle("sleeping", S.state === "sleeping"); }
    else drawFallback(t);
    requestAnimationFrame(frame);
  }

  // ---------- 交互 ----------
  // 拖拽协议（0.4.2 重写，实机：0.4.1 往左上拖反而往左下慢速漂移）：
  // - 有宿主桥时优先「绝对定位」：每次 move 只上报抓取点在窗口内的偏移（拖拽期间
  //   恒定），宿主用主进程自己的光标坐标反推窗口原点——无跨进程增量换算，DPI
  //   缩放/坐标系差异不可能造成反向或漂移，且每帧自纠错。
  // - 旧宿主无 moveTo 时退回增量协议（screen 坐标系，比 client 稳但 DPI 不一致仍可能漂移）。
  // - 浏览器降级：窗口不动，移动页内 stage。
  // 另：跑步动画与 drag_start 事件都延迟到「真实移动 >6px」才触发——长按不动
  // 不该进跑步态（0.4.1 实机反馈）。
  canvas.addEventListener("pointerdown", (e) => {
    S.dragging = true; S.dragMoved = false;
    S.grabOffset = { x: e.clientX, y: e.clientY };
    S.downScreen = { x: e.screenX, y: e.screenY };
    S.downStartScreen = { x: e.screenX, y: e.screenY };
    S.downT = performance.now();
    try { canvas.setPointerCapture(e.pointerId); } catch { /* 忽略 */ }
  });
  canvas.addEventListener("pointermove", (e) => {
    if (!S.dragging || !S.downStartScreen) return;
    const totalDx = e.screenX - S.downStartScreen.x;
    const totalDy = e.screenY - S.downStartScreen.y;
    if (!S.dragMoved && Math.hypot(totalDx, totalDy) > 6) {
      S.dragMoved = true;
      postEvent("drag_start", 1);
    }
    if (!S.dragMoved) return;
    // 方向按总位移判定（逐事件增量会因抖动来回翻转）
    S.dragDir = totalDx < 0 ? -1 : 1;
    postEvent("drag_move", S.dragDir);
    if (hostBridge && hostBridge.moveTo) {
      hostBridge.moveTo(S.grabOffset.x, S.grabOffset.y);
    } else if (hostBridge && hostBridge.move) {
      hostBridge.move(e.screenX - S.downScreen.x, e.screenY - S.downScreen.y);
      S.downScreen = { x: e.screenX, y: e.screenY };
    } else {
      // 浏览器降级：移动页内 stage
      const dx = e.screenX - S.downScreen.x, dy = e.screenY - S.downScreen.y;
      if (!S.stagePos) {
        const r = stage.getBoundingClientRect();
        S.stagePos = { right: innerWidth - r.right, bottom: innerHeight - r.bottom };
        stage.style.left = "auto"; stage.style.top = "auto";
      }
      S.stagePos.right = Math.max(-40, S.stagePos.right - dx);
      S.stagePos.bottom = Math.max(-40, S.stagePos.bottom - dy);
      stage.style.right = S.stagePos.right + "px";
      stage.style.bottom = S.stagePos.bottom + "px";
      S.downScreen = { x: e.screenX, y: e.screenY };
    }
  });
  canvas.addEventListener("pointerup", (e) => {
    const wasDrag = S.dragMoved;
    S.dragging = false; S.dragMoved = false; S.downScreen = null; S.downStartScreen = null;
    postEvent("drag_end");
    if (!wasDrag && performance.now() - S.downT < 400) {
      postEvent("poke");
      if (Math.random() < 0.6) say(S.pokeLines[Math.floor(Math.random() * S.pokeLines.length)]);
    }
  });
  canvas.addEventListener("dblclick", () => {
    postEvent("pat");
    say(S.patLines[Math.floor(Math.random() * S.patLines.length)]);
  });
  canvas.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    buildMenu();
    menuEl.classList.add("show"); menubg.classList.add("show");
    // 菜单打开期间必须保持接管：一旦交还穿透，菜单项/遮罩的 click 全部落到桌面，
    // 菜单看得见点不着（0.4.0 实机）。关闭由 menubg/按钮的 click 处理。
    setCapture(true);
  });
  menubg.addEventListener("click", () => {
    menuEl.classList.remove("show"); menubg.classList.remove("show");
    // 不在这里交还穿透：指针若已不在角色像素上，下一次 mousemove 会自动释放。
  });

  // 追视 + 点击穿透接管：两件事共用同一次 mousemove。
  // 追视不挂在「已接管」上——overlay 窗口本身就是桌宠大小，指针只要进窗口就算近邻；
  // 挂在接管后面会让 macOS（setIgnoreMouseEvents 无 forward）永远追不到视。
  window.addEventListener("mousemove", (e) => {
    if (S.captured) {
      // 已接管：指针离开角色像素就交还穿透，避免挡住整块桌面。
      // 例外：菜单打开期间保持接管（见 contextmenu），否则菜单点不着。
      const menuOpen = menuEl.classList.contains("show");
      if (!hitsPet(e.clientX, e.clientY) && !S.dragging && !menuOpen) setCapture(false);
    } else if (hitsPet(e.clientX, e.clientY)) {
      setCapture(true);
    }
    if (!S.skinOk || !S.atlasOk) return;
    const r = canvas.getBoundingClientRect();
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    const dx = e.clientX - cx, dy = e.clientY - cy;
    const dist = Math.hypot(dx, dy);
    S.look = dist < 12 || dist > 900 ? null : { dx: dx / dist, dy: dy / dist };
  });
  window.addEventListener("blur", () => {
    // 失焦（用户点到别的应用）时连菜单一起收起：只释放穿透不关菜单的话，
    // 菜单还挂着但点不着，又回到「看得见摸不着」的状态。
    menuEl.classList.remove("show"); menubg.classList.remove("show");
    if (!S.dragging) setCapture(false);
  });

  function buildMenu() {
    menuEl.innerHTML = "";
    // 注意：Electron 沙盒渲染进程里 window.prompt/alert 一律静默失败（返回 null），
    // 菜单项不能用任何原生对话框——0.4.0 实机：「说句话/换皮肤」两项从未生效过。
    const items = [
      ["说句话", () => {
        const lines = ["今天也要加油鸭~", "要不要摸摸头？", "我在陪你哦", "有什么想让我做的嘛？", "嘿嘿，被发现了~"];
        say(lines[Math.floor(Math.random() * lines.length)], 5000);
      }],
      ["换皮肤", () => {
        if (!S.skins.length) { say("还没有皮肤，先去放一个吧"); return; }
        const idx = S.skins.indexOf(S.skin);
        const skin = S.skins[(idx + 1) % S.skins.length];
        postEvent("skin", skin.id);
        loadSkin(skin);
        say("换上" + skin.displayName + "啦~");
      }],
      ["睡觉/醒来", () => postEvent(S.state === "sleeping" ? "wake" : "sleep")],
      ["隐藏桌宠", () => { stage.style.display = "none"; say(""); setTimeout(() => { stage.style.display = ""; }, 60000); }]
    ];
    for (const [label, fn] of items) {
      const b = document.createElement("button");
      b.textContent = label;
      b.onclick = () => { menuEl.classList.remove("show"); menubg.classList.remove("show"); fn(); };
      menuEl.appendChild(b);
    }
  }

  // ---------- 主循环 ----------
  async function boot() {
    try {
      const r = await api("/api/state");
      const data = await r.json();
      S.config = { ...S.config, ...(data.config || {}) };
      S.appliedSize = Number(S.config.size) || 0;
      S.state = data.snapshot?.state || "idle";
      const sr = await api("/api/skins");
      const sd = await sr.json();
      S.skins = sd.skins || [];
      const active = (data.config || {}).activeSkinId;
      const skin = S.skins.find((s) => s.id === active) || S.skins[0] || null;
      loadSkin(skin);
      fitCanvas();
      if (!skin) say("还没有皮肤，暂用小鲸鱼陪你~");
    } catch {
      say("连不上插件服务");
    }
    requestAnimationFrame(frame);
    setInterval(async () => {
      try {
        const r = await api("/api/state");
        const data = await r.json();
        const snap = data.snapshot || {};
        // 配置热更新：pet_config 改了 size / 气泡时长等，overlay 已在跑也要立刻生效，
        // 不能等重启（0.4.1 实机：改大小要重启整个客户端才应用）。
        S.config = { ...S.config, ...(data.config || {}) };
        const wantSize = Number(S.config.size) || 0;
        if (wantSize && wantSize !== S.appliedSize) {
          S.appliedSize = wantSize;
          fitCanvas();
        }
        // 皮肤切换要热生效：agent 调 pet_skin / 用户从菜单换皮肤后，overlay 已经在跑，
        // 不能等到下次打开页面才换。
        const wantSkin = (data.config || {}).activeSkinId || null;
        const nextSkin = S.skins.find((s) => s.id === wantSkin) || S.skins[0] || null;
        const curId = S.skin ? S.skin.id : null;
        const nextId = nextSkin ? nextSkin.id : null;
        if (nextId !== curId && nextSkin) { loadSkin(nextSkin); say("换上" + nextSkin.displayName + "啦~"); }
        if (snap.dragDir !== undefined) S.dragDir = snap.dragDir;
        if (snap.state && snap.state !== S.state) {
          S.state = snap.state;
          if (S.state === "jumping") say("搞定！");
          else if (S.state === "failed") say("呜……出错了");
        }
        if (snap.bubble) say(snap.bubble, S.config.bubbleDurationMs);
      } catch { /* 忽略轮询失败 */ }
    }, 800);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();