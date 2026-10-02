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

test("activate 注册 6 个工具、1 个 prompt、1 个 skill", async () => {
  const api = fakeApi();
  const dispose = await activate(api);
  try {
    const names = api.tools.map((t) => t.name).sort();
    assert.deepEqual(names, ["pet_emote", "pet_hide", "pet_say", "pet_show", "pet_skin", "pet_store"]);
    assert.equal(api.prompts.length, 1);
    assert.equal(api.skills.length, 1);
    assert.match(api.statuses.at(-1).message, /已就绪/);
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
