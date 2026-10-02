import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { createPetServer } from "../pet/server.mjs";
import { createPetState } from "../pet/state.mjs";

async function makeServer() {
  const pet = createPetState();
  const server = createPetServer({
    getSnapshot: () => pet.tick(),
    dispatch: (e, a) => pet.dispatch(e, a),
    listSkins: () => [],
    skinFile: () => null,
    getConfig: () => ({ size: 160 }),
    pageHtml: "<html>__TOKEN__</html>",
    petJs: "/*js*/",
    openBrowser: () => {},
    log: () => {}
  });
  const url = await server.start();
  const token = server.token;
  return { server, url, token };
}

test("GET / 带正确 token 返回页面，无 token 401", async () => {
  const { server, url, token } = await makeServer();
  try {
    let r = await fetch(url);
    assert.equal(r.status, 200);
    const html = await r.text();
    assert.ok(html.includes(token));
    r = await fetch(url.split("?")[0]);
    assert.equal(r.status, 401);
  } finally { await server.stop(); }
});

test("伪造 Host 头返回 403", async () => {
  const { server } = await makeServer();
  try {
    const status = await new Promise((resolve, reject) => {
      const req = http.request(
        { host: "127.0.0.1", port: server.port, path: "/api/health", headers: { Host: "evil.com" } },
        (res) => { res.resume(); res.on("end", () => resolve(res.statusCode)); }
      );
      req.on("error", reject);
      req.end();
    });
    assert.equal(status, 403);
  } finally { await server.stop(); }
});

test("POST /api/state 分发事件", async () => {
  const { server, url, token } = await makeServer();
  try {
    let r = await fetch(`${url.split("?")[0]}api/state?token=${token}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ event: "emote", arg: "jumping" })
    });
    assert.equal(r.status, 200);
    const data = await r.json();
    assert.equal(data.state, "jumping");

    r = await fetch(`${url.split("?")[0]}api/state?token=${token}`);
    const snap = await r.json();
    assert.equal(snap.snapshot.state, "jumping");
    assert.equal(snap.config.size, 160);
  } finally { await server.stop(); }
});

test("非法事件返回 400", async () => {
  const { server, url, token } = await makeServer();
  try {
    const r = await fetch(`${url.split("?")[0]}api/state?token=${token}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ event: "fly" })
    });
    assert.equal(r.status, 400);
  } finally { await server.stop(); }
});

test("GET /api/skins 返回列表", async () => {
  const { server, url, token } = await makeServer();
  try {
    const r = await fetch(`${url.split("?")[0]}api/skins?token=${token}`);
    assert.equal(r.status, 200);
    assert.deepEqual((await r.json()).skins, []);
  } finally { await server.stop(); }
});

test("GET /api/health 无需 token", async () => {
  const { server } = await makeServer();
  try {
    const r = await fetch(`http://127.0.0.1:${server.port}/api/health`);
    assert.equal(r.status, 200);
    assert.equal((await r.json()).service, "secagent-desktop-pet");
  } finally { await server.stop(); }
});
