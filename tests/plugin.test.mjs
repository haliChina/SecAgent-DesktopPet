import { test } from "node:test";
import assert from "node:assert/strict";
import { activate } from "../main.mjs";

function fakeApi() {
  const api = {
    tools: [], prompts: [], skills: [],
    statuses: [],
    config: {},
    getConfig() { return this.config; },
    setConfig(c) { this.config = c; },
    registerTool(def, fn) { this.tools.push({ ...def, fn }); },
    async fetch(url, init) { return { ok: false, status: 599, json: async () => ({}), arrayBuffer: async () => new ArrayBuffer(0) }; },
    registerPrompt(name, provider) { this.prompts.push({ name, provider }); },
    registerSkill(path, pattern) { this.skills.push({ path, pattern }); },
    setStatus(message, state) { this.statuses.push({ message, state }); }
  };
  return api;
}

test("activate 注册 7 个工具、1 个 prompt、1 个 skill", async () => {
  const api = fakeApi();
  const dispose = await activate(api);
  try {
    const names = api.tools.map((t) => t.name).sort();
    assert.deepEqual(names, ["pet_config", "pet_emote", "pet_hide", "pet_say", "pet_show", "pet_skin", "pet_store"]);
    assert.equal(api.prompts.length, 1);
    assert.equal(api.skills.length, 1);
    assert.match(api.statuses.at(-1).message, /已就绪/);
  } finally {
    await dispose();
  }
});

test("pet_config：list 返回分组设置项与当前值", async () => {
  const api = fakeApi();
  const dispose = await activate(api);
  try {
    const byName = Object.fromEntries(api.tools.map((t) => [t.name, t.fn]));
    const out = await byName.pet_config({ action: "list" });
    assert.ok(Array.isArray(out.settings) && out.settings.length > 0);
    const all = out.settings.flatMap((g) => g.items.map((i) => i.key));
    assert.ok(all.includes("petEnabled") && all.includes("size") && all.includes("idleSleepSec"));
    const size = out.settings.flatMap((g) => g.items).find((i) => i.key === "size");
    assert.equal(size.value, 160); // 默认值
    assert.equal(size.min, 96);
  } finally {
    await dispose();
  }
});

test("pet_config：set 写入经宿主 setConfig 持久化，越界值钳制并提示", async () => {
  const api = fakeApi();
  const dispose = await activate(api);
  try {
    const byName = Object.fromEntries(api.tools.map((t) => [t.name, t.fn]));
    const out = await byName.pet_config({ action: "set", key: "size", value: 9999 });
    assert.equal(out.ok, true);
    assert.equal(out.value, 320, "size 超上限应钳到 320");
    assert.match(out.note, /size/);
    assert.equal(api.config.size, 9999, "原值照存，读取时统一钳制");
    const off = await byName.pet_config({ action: "set", key: "petEnabled", value: false });
    assert.equal(off.value, false);
    assert.equal(api.config.petEnabled, false);
    await assert.rejects(() => byName.pet_config({ action: "set", key: "nope", value: 1 }), /未知设置项/);
    await assert.rejects(() => byName.pet_config({ action: "set", key: "size" }), /value/);
  } finally {
    await dispose();
  }
});

test("pet_say / pet_emote / pet_skin 工具可用", async () => {
  const api = fakeApi();
  const dispose = await activate(api);
  try {
    const byName = Object.fromEntries(api.tools.map((t) => [t.name, t.fn]));
    const said = await byName.pet_say({ text: "你好呀" });
    assert.equal(said.said, "你好呀");
    const emoted = await byName.pet_emote({ emote: "jumping" });
    assert.equal(emoted.state, "jumping");
    const skins = await byName.pet_skin({});
    assert.ok(Array.isArray(skins.skins));
    await assert.rejects(() => byName.pet_say({ text: "  " }), /text/);
    await assert.rejects(() => byName.pet_skin({ skinId: "nope" }), /没有这个皮肤/);
    await assert.rejects(() => byName.pet_store({ query: "cat" }), /HTTP 599/);
  } finally {
    await dispose();
  }
});

test("pet_config 改 size 即时调整 overlay 窗口（0.4.1 实机：改大小要重启客户端才生效）", async () => {
  const api = fakeApi();
  const boundsCalls = [];
  api.createOverlay = async () => ({
    show: async () => {},
    hide: async () => {},
    close: async () => {},
    setBounds: async (b) => { boundsCalls.push(b); }
  });
  const dispose = await activate(api);
  try {
    const byName = Object.fromEntries(api.tools.map((t) => [t.name, t.fn]));
    const out = await byName.pet_config({ action: "set", key: "size", value: 280 });
    assert.equal(out.ok, true);
    // 窗口立即跟着扩：280 → 宽 max(260, 280+48)=328；高 max(300, ⌈280×208/192⌉+110)=414
    assert.equal(boundsCalls.length, 1, "size 变化应触发一次 setBounds");
    assert.equal(boundsCalls[0].width, 328);
    assert.equal(boundsCalls[0].height, 414);
    assert.equal(boundsCalls[0].anchor, "bottom-right", "锚定右下角，桌宠原地缩放");
    // 改别的键不动窗口
    await byName.pet_config({ action: "set", key: "petEnabled", value: true });
    assert.equal(boundsCalls.length, 1);
  } finally {
    await dispose();
  }
});

test("petEnabled=false 时 prompt 为空", async () => {
  const api = fakeApi();
  api.config = { petEnabled: false };
  const dispose = await activate(api);
  try {
    assert.equal(api.prompts[0].provider(), "");
    assert.match(api.statuses.at(-1).message, /停用/);
  } finally {
    await dispose();
  }
});
