// 桌宠渲染器：canvas 精灵图播放 + 交互。无依赖。
// 由宿主 overlay 窗口或系统浏览器加载；与插件服务用 token + 轮询通信。
(() => {
  "use strict";
  const qs = new URLSearchParams(location.search);
  const TOKEN = qs.get("token") || "";
  const api = (p, init) => fetch(p + (p.includes("?") ? "&" : "?") + "token=" + encodeURIComponent(TOKEN), init);

  const canvas = document.getElementById("pet");
  const ctx = canvas.getContext("2d");
  const stage = document.getElementById("stage");
  const bubbleEl = document.getElementById("bubble");
  const menuEl = document.getElementById("menu");
  const menubg = document.getElementById("menubg");

  const CELL_W = 192, CELL_H = 208;
  const STATE_ROWS = { idle: 0, running: 7, waiting: 6, review: 8, failed: 5, jumping: 4, waving: 3, sleeping: 0 };

  const S = {
    config: { size: 160, bubbleDurationMs: 4000 },
    skins: [],
    skin: null,          // 当前皮肤 { id, layout }
    skinImg: null,
    skinOk: false,
    state: "idle",
    bubble: null,
    look: null,          // { dx, dy }
    frame: 0,
    lastFrameT: 0,
    scale: 1,
    dragging: false,
    dragMoved: false,
    downPos: null, downT: 0,
    stagePos: null,      // 浏览器降级模式下的 stage 偏移
    blinkT: 0, blinkOn: false,
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

  function loadSkin(skin) {
    S.skin = skin; S.skinOk = false; S.skinImg = null;
    if (!skin) return;
    const img = new Image();
    img.onload = () => {
      // 按实际尺寸确认版式（服务端给的是声明值）
      const l = skin.layout || {};
      if (img.naturalWidth === 1536 && img.naturalHeight === 2288) {
        skin.layout = { cols: 8, rows: 11, cellW: 192, cellH: 208, lookRows: 2, version: 2 };
      } else if (img.naturalWidth === 1536 && img.naturalHeight === 1872) {
        skin.layout = { cols: 8, rows: 9, cellW: 192, cellH: 208, lookRows: 0, version: 1 };
      } else if (!l.cols) {
        skin.layout = { cols: 8, rows: 11, cellW: 192, cellH: 208, lookRows: 0, version: "custom" };
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

  // ---------- 绘制 ----------
  function drawSprite() {
    const layout = S.skin.layout;
    const cols = layout.cols || 8;
    let row = STATE_ROWS[S.state] ?? 0;
    let col = S.frame % cols;

    // 注视：有注视行时用 16 格，否则 idle 行水平翻转示意
    let flip = false;
    if (S.look && (S.state === "idle" || S.state === "waiting")) {
      if (layout.lookRows > 0) {
        const ang = Math.atan2(-S.look.dy, S.look.dx);
        let idx = Math.round(ang / (Math.PI / 8));
        idx = ((idx % 16) + 16) % 16;
        row = 9 + Math.floor(idx / 8);
        col = idx % 8;
      } else if (S.look.dx < -0.3) {
        flip = true;
      }
    }

    const cw = layout.cellW || CELL_W, ch = layout.cellH || CELL_H;
    ctx.save();
    ctx.clearRect(0, 0, CELL_W, CELL_H);
    // 目标格 192×208 居中绘制（兼容非标准格尺寸）
    const dx = (CELL_W - CELL_W) / 2, dy = (CELL_H - CELL_H) / 2;
    if (flip) {
      ctx.translate(CELL_W, 0); ctx.scale(-1, 1);
    }
    // 跳跃时加一点上下位移
    let oy = 0;
    if (S.state === "jumping") oy = -Math.abs(Math.sin(performance.now() / 180)) * 26;
    ctx.drawImage(S.skinImg, col * cw, row * ch, cw, ch, 0, oy, CELL_W, CELL_H);
    ctx.restore();
  }

  // 内置兜底形象：小鲸鱼（无皮肤时用）
  function drawFallback(t) {
    const w = CELL_W, h = CELL_H;
    ctx.clearRect(0, 0, w, h);
    const bob = Math.sin(t / 600) * 6;
    const cx = w / 2, cy = h / 2 + bob;
    const sleeping = S.state === "sleeping";

    ctx.save();
    if (sleeping) ctx.globalAlpha = 0.75;

    // 尾巴
    const wag = Math.sin(t / 300) * 0.35;
    ctx.save();
    ctx.translate(cx - 52, cy - 6); ctx.rotate(wag);
    ctx.fillStyle = "#5b9bd5";
    ctx.beginPath();
    ctx.moveTo(0, 0); ctx.lineTo(-30, -18); ctx.lineTo(-24, 0); ctx.lineTo(-30, 18);
    ctx.closePath(); ctx.fill();
    ctx.restore();

    // 身体
    const grad = ctx.createLinearGradient(cx - 60, 0, cx + 60, 0);
    grad.addColorStop(0, "#7fb8ec"); grad.addColorStop(1, "#4a90d9");
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.ellipse(cx, cy, 58, 44, -0.12, 0, Math.PI * 2);
    ctx.fill();

    // 肚皮
    ctx.fillStyle = "rgba(255,255,255,.55)";
    ctx.beginPath();
    ctx.ellipse(cx + 6, cy + 16, 38, 24, -0.12, 0, Math.PI * 2);
    ctx.fill();

    // 背鳍
    ctx.fillStyle = "#4a90d9";
    ctx.beginPath();
    ctx.moveTo(cx - 8, cy - 42); ctx.quadraticCurveTo(cx + 6, cy - 66, cx + 18, cy - 42);
    ctx.closePath(); ctx.fill();

    // 眼睛（眨眼 / 睡觉闭眼）
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

    // 腮红
    ctx.fillStyle = "rgba(255,130,150,.5)";
    ctx.beginPath(); ctx.arc(ex + 16, ey + 12, 6, 0, Math.PI * 2); ctx.fill();

    // 头顶水汽
    if (!sleeping && S.state !== "failed") {
      ctx.fillStyle = "rgba(180,220,255,.7)";
      const p = (t / 1400) % 1;
      ctx.beginPath(); ctx.arc(cx - 6, cy - 62 - p * 26, 3 + p * 3, 0, Math.PI * 2); ctx.fill();
    }
    // 开心星星
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

  function frame(t) {
    if (t - S.lastFrameT > 130) { S.frame++; S.lastFrameT = t; }
    if (S.skinOk) { drawSprite(); canvas.classList.toggle("sleeping", S.state === "sleeping"); }
    else drawFallback(t);
    requestAnimationFrame(frame);
  }

  // ---------- 交互 ----------
  // 宿主桥接：优先新版 __secagentOverlay，兼容旧名 __petHost
  const hostBridge = window.__secagentOverlay || window.__petHost || null;

  function canvasPoint(e) {
    const r = canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top, w: r.width, h: r.height };
  }

  canvas.addEventListener("pointerdown", (e) => {
    S.dragging = true; S.dragMoved = false;
    S.downPos = { x: e.clientX, y: e.clientY };
    S.downT = performance.now();
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener("pointermove", (e) => {
    if (S.dragging && S.downPos) {
      const dx = e.clientX - S.downPos.x, dy = e.clientY - S.downPos.y;
      if (Math.hypot(dx, dy) > 6) S.dragMoved = true;
      if (S.dragMoved) {
        if (hostBridge && hostBridge.move) {
          hostBridge.move(dx, dy);
          S.downPos = { x: e.clientX, y: e.clientY };
        } else {
          // 浏览器降级：在页面内拖动
          if (!S.stagePos) {
            const r = stage.getBoundingClientRect();
            S.stagePos = { right: innerWidth - r.right, bottom: innerHeight - r.bottom };
            stage.style.left = "auto"; stage.style.top = "auto";
          }
          S.stagePos.right = Math.max(-40, S.stagePos.right - dx);
          S.stagePos.bottom = Math.max(-40, S.stagePos.bottom - dy);
          stage.style.right = S.stagePos.right + "px";
          stage.style.bottom = S.stagePos.bottom + "px";
          S.downPos = { x: e.clientX, y: e.clientY };
        }
      }
    }
  });
  canvas.addEventListener("pointerup", (e) => {
    const wasDrag = S.dragMoved;
    S.dragging = false; S.dragMoved = false; S.downPos = null;
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
  });
  menubg.addEventListener("click", () => {
    menuEl.classList.remove("show"); menubg.classList.remove("show");
  });
  window.addEventListener("mousemove", (e) => {
    const r = canvas.getBoundingClientRect();
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    const dx = e.clientX - cx, dy = e.clientY - cy;
    const dist = Math.hypot(dx, dy);
    if (dist < 30 || dist > 900) { S.look = null; return; }
    S.look = { dx: dx / dist, dy: dy / dist };
  });
  window.addEventListener("mouseout", (e) => { if (!e.relatedTarget) S.look = null; });

  function buildMenu() {
    menuEl.innerHTML = "";
    const items = [
      ["说句话", () => { const t = prompt("让桌宠说什么？"); if (t) postEvent("say", t); }],
      ["换皮肤", () => {
        if (!S.skins.length) { say("还没有皮肤，去 ~/.codex/pets 放一个吧"); return; }
        const names = S.skins.map((s, i) => `${i + 1}. ${s.displayName}`).join("\n");
        const c = prompt("选择皮肤编号：\n" + names);
        const n = parseInt(c, 10);
        if (n >= 1 && n <= S.skins.length) {
          const skin = S.skins[n - 1];
          api("/api/state", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ event: "skin", arg: skin.id }) }).catch(() => {});
          loadSkin(skin);
          say("换上" + skin.displayName + "啦~");
        }
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
