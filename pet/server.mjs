// 桌宠本地服务：127.0.0.1 随机端口 + token + Host 校验，
// 提供渲染页、皮肤文件、状态 API。渲染页由宿主 overlay 窗口或系统浏览器打开。
import http from "node:http";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawn as defaultSpawn } from "node:child_process";

function defaultOpenBrowser(url) {
  const platform = process.platform;
  if (platform === "win32") {
    defaultSpawn("cmd", ["/c", "start", "", url], { windowsHide: true });
  } else if (platform === "darwin") {
    defaultSpawn("open", [url], { windowsHide: true });
  } else {
    defaultSpawn("xdg-open", [url], { windowsHide: true });
  }
}

function sendJson(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { "content-type": "application/json; charset=utf-8", "content-length": Buffer.byteLength(body) });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (c) => { data += c; if (data.length > 65536) req.destroy(); });
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

/**
 * @param {object} options
 * @param {() => object} options.getSnapshot 桌宠状态快照
 * @param {(event:string, arg?:any) => string} options.dispatch 分发事件，返回新状态
 * @param {() => Array} options.listSkins
 * @param {(id:string) => string|null} options.skinFile 皮肤 spritesheet 绝对路径
 * @param {() => object} options.getConfig
 * @param {string} options.pageHtml 渲染页 HTML
 * @param {string} options.petJs 渲染脚本
 * @param {(url:string)=>void} [options.openBrowser]
 * @param {(msg:string)=>void} [options.log]
 */
export function createPetServer(options) {
  const {
    getSnapshot, dispatch, listSkins, skinFile, getConfig,
    pageHtml, petJs, log = () => {}
  } = options;
  const openBrowser = options.openBrowser || defaultOpenBrowser;

  const token = crypto.randomBytes(16).toString("hex");
  let server = null;
  let boundPort = 0;

  function checkHost(req) {
    const host = String(req.headers.host || "").split(":")[0].toLowerCase();
    return host === "127.0.0.1" || host === "localhost" || host === "::1";
  }
  function checkToken(url) {
    return url.searchParams.get("token") === token;
  }

  async function handler(req, res) {
    const url = new URL(req.url, "http://127.0.0.1");
    if (!checkHost(req)) {
      res.writeHead(403); res.end("forbidden");
      return;
    }
    const pathname = url.pathname;

    // 静态页与脚本：token 校验
    if (pathname === "/" || pathname === "/index.html") {
      if (!checkToken(url)) { res.writeHead(401); res.end("unauthorized"); return; }
      const html = pageHtml.replaceAll("__TOKEN__", token);
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(html);
      return;
    }
    if (pathname === "/pet.js") {
      if (!checkToken(url)) { res.writeHead(401); res.end("unauthorized"); return; }
      // 契约表由 pet/skins.mjs 单一事实源注入，渲染页不重复抄一份状态表。
      const prelude = `window.__PET_FORMAT=${JSON.stringify(options.format ?? {})};\n`;
      res.writeHead(200, { "content-type": "text/javascript; charset=utf-8" });
      res.end(prelude + petJs);
      return;
    }
    if (pathname.startsWith("/skin-file/")) {
      if (!checkToken(url)) { res.writeHead(401); res.end("unauthorized"); return; }
      const id = decodeURIComponent(pathname.slice("/skin-file/".length));
      const file = skinFile(id);
      if (!file) { res.writeHead(404); res.end("no such skin"); return; }
      const ext = path.extname(file).toLowerCase();
      const type = ext === ".png" ? "image/png" : ext === ".gif" ? "image/gif" : "image/webp";
      res.writeHead(200, { "content-type": type });
      fs.createReadStream(file).pipe(res);
      return;
    }

    // API
    if (pathname === "/api/state" && req.method === "GET") {
      if (!checkToken(url)) { res.writeHead(401); res.end("unauthorized"); return; }
      sendJson(res, 200, { ok: true, snapshot: getSnapshot(), config: getConfig() });
      return;
    }
    if (pathname === "/api/state" && req.method === "POST") {
      if (!checkToken(url)) { res.writeHead(401); res.end("unauthorized"); return; }
      let body = {};
      try { body = JSON.parse(await readBody(req)); } catch { /* ignore */ }
      try {
        const next = dispatch(body.event, body.arg);
        sendJson(res, 200, { ok: true, state: next, snapshot: getSnapshot() });
      } catch (error) {
        sendJson(res, 400, { ok: false, error: error?.message ?? String(error) });
      }
      return;
    }
    if (pathname === "/api/skins" && req.method === "GET") {
      if (!checkToken(url)) { res.writeHead(401); res.end("unauthorized"); return; }
      sendJson(res, 200, {
        ok: true,
        skins: listSkins().map((s) => ({
          id: s.id, displayName: s.displayName, description: s.description, layout: s.layout
        }))
      });
      return;
    }
    if (pathname === "/api/health") {
      sendJson(res, 200, { ok: true, service: "secagent-desktop-pet" });
      return;
    }
    res.writeHead(404); res.end("not found");
  }

  function start() {
    return new Promise((resolve, reject) => {
      server = http.createServer(handler);
      server.on("error", reject);
      server.listen(0, "127.0.0.1", () => {
        boundPort = server.address().port;
        log(`[desktop-pet] listening on 127.0.0.1:${boundPort}`);
        resolve(petUrl());
      });
    });
  }

  function petUrl() {
    if (!boundPort) throw new Error("服务未启动");
    return `http://127.0.0.1:${boundPort}/?token=${token}`;
  }

  function openPetPage() {
    openBrowser(petUrl());
    return petUrl();
  }

  function stop() {
    return new Promise((resolve) => {
      if (server) server.close(() => resolve()); else resolve();
    });
  }

  return { start, stop, openPetPage, petUrl, get token() { return token; }, get port() { return boundPort; } };
}
