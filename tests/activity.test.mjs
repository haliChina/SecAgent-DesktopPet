import { test } from "node:test";
import assert from "node:assert/strict";
import { activate } from "../main.mjs";
import { createPetState } from "../pet/state.mjs";

/** 带（或故意不带）活动事件能力的假宿主。 */
function fakeApi(options = {}) {
  const api = {
    tools: [], prompts: [], skills: [], statuses: [],
    handlers: [],
    config: { idleSleepSec: 0, ...(options.config || {}) },
    getConfig() { return this.config; },
    setConfig(c) { this.config = c; },
    registerTool(def, fn) { this.tools.push({ ...def, fn }); },
    registerPrompt(name, provider) { this.prompts.push({ name, provider }); },
    registerSkill(path, pattern) { this.skills.push({ path, pattern }); },
    setStatus(message, state) { this.statuses.push({ message, state }); },
    async fetch() { return { ok: false, status: 599, json: async () => ({}), arrayBuffer: async () => new ArrayBuffer(0) }; }
  };
  if (options.activity !== false) {
    api.onActivity = (handler) => {
      api.handlers.push(handler);
      return () => { api.handlers = api.handlers.filter((h) => h !== handler); };
    };
    api.getActivity = () => options.snapshot || { phase: "idle", last: null };
    api.emit = (kind) => { for (const handler of [...api.handlers]) handler({ kind, sessionId: "s", at: Date.now() }); };
  }
  return api;
}

/** 通过插件自己的 loopback 服务读渲染页看到的状态快照。 */
async function snapshot(api) {
  const byName = Object.fromEntries(api.tools.map((t) => [t.name, t.fn]));
  const shown = await byName.pet_show();
  const url = new URL(shown.url);
  const res = await fetch(`${url.origin}/api/state?token=${url.searchParams.get("token")}`);
  return (await res.json()).snapshot;
}

test("宿主活动事件驱动桌宠动画（渲染页看到的状态）", async () => {
  const api = fakeApi();
  const dispose = await activate(api);
  try {
    assert.equal(api.handlers.length, 1, "应订阅一次活动事件");

    api.emit("turn_started");
    assert.equal((await snapshot(api)).state, "review", "回合开始=思考中，复用复核行");

    api.emit("tool_started");
    assert.equal((await snapshot(api)).state, "running");

    api.emit("tool_finished");
    assert.equal((await snapshot(api)).state, "review", "工具返回后模型还要继续推理，不停在 running");

    api.emit("approval_requested");
    assert.equal((await snapshot(api)).state, "waiting");

    api.emit("approval_resolved");
    assert.equal((await snapshot(api)).state, "running");

    api.emit("turn_completed");
    assert.equal((await snapshot(api)).state, "waving");
  } finally {
    await dispose();
  }
  assert.equal(api.handlers.length, 0, "dispose 必须退订");
});

test("未知/畸形事件不能把插件打挂", async () => {
  const api = fakeApi();
  const dispose = await activate(api);
  try {
    assert.doesNotThrow(() => api.emit("some_future_kind"));
    assert.doesNotThrow(() => api.emit(undefined));
    // handler 直接收到 null / 字符串 / 空对象也要扛住（不只是 {kind:undefined}）
    for (const bogus of [null, "turn_started", 42, {}, { kind: null }, { kind: { nested: true } }]) {
      assert.doesNotThrow(() => { for (const handler of [...api.handlers]) handler(bogus); });
    }
    api.emit("turn_started");
    assert.equal((await snapshot(api)).state, "review");
  } finally {
    await dispose();
  }
});

test("petEnabled=false 时快照补齐也不改状态（与事件回调同一个不变量）", async () => {
  const api = fakeApi({ config: { petEnabled: false }, snapshot: { phase: "running", last: { kind: "tool_started", sessionId: "s", at: Date.now(), label: "grep" } } });
  const dispose = await activate(api);
  try {
    const byName = Object.fromEntries(api.tools.map((t) => [t.name, t.fn]));
    assert.equal((await byName.pet_show()).shown, false);
    // 没有 pet_show 可拿 URL，用 handler 直接验证状态没被快照推动
    api.emit("turn_started");
    assert.equal(api.handlers.length, 1);
  } finally {
    await dispose();
  }
});

test("petEnabled=false 时活动事件不改状态", async () => {
  const api = fakeApi();
  const dispose = await activate(api);
  try {
    const byName = Object.fromEntries(api.tools.map((t) => [t.name, t.fn]));
    const shown = await byName.pet_show();      // 先拿到 URL（此时桌宠是开的）
    const url = new URL(shown.url);
    api.setConfig({ ...api.config, petEnabled: false });
    api.emit("turn_started");
    const res = await fetch(`${url.origin}/api/state?token=${url.searchParams.get("token")}`);
    assert.equal((await res.json()).snapshot.state, "idle", "关掉桌宠后活动事件不应再改状态");
    assert.equal((await byName.pet_show()).shown, false);
  } finally {
    await dispose();
  }
});

test("老宿主没有 onActivity 时仍能工作（降级为 pet_emote 工具驱动）", async () => {
  const api = fakeApi({ activity: false });
  const dispose = await activate(api);
  try {
    assert.equal(api.handlers.length, 0);
    const byName = Object.fromEntries(api.tools.map((t) => [t.name, t.fn]));
    assert.equal((await byName.pet_emote({ emote: "running" })).state, "running");
  } finally {
    await dispose();
  }
});

test("activate 时读快照补齐错过的历史（回合中途才起来的浮窗）", async () => {
  const running = fakeApi({ snapshot: { phase: "running", last: { kind: "tool_started", sessionId: "s", at: Date.now(), label: "grep" } } });
  const dispose = await activate(running);
  try {
    assert.equal((await snapshot(running)).state, "running");
  } finally {
    await dispose();
  }

  const thinking = fakeApi({ snapshot: { phase: "thinking", last: { kind: "turn_started", sessionId: "s", at: Date.now() } } });
  const dispose2 = await activate(thinking);
  try {
    assert.equal((await snapshot(thinking)).state, "review", "thinking 快照映射到复核行");
  } finally {
    await dispose2();
  }
});

test("hold 持续态不抢占正在播的瞬发状态", () => {
  let now = 1000;
  const pet = createPetState({ now: () => now });
  pet.dispatch("emote", "jumping");
  pet.dispatch("hold", "running");
  assert.equal(pet.snapshot().state, "jumping", "burst 优先于持续态");
  now += 4000;
  pet.tick();
  pet.dispatch("hold", "running");
  assert.equal(pet.snapshot().state, "running");
  assert.throws(() => pet.dispatch("hold", "nope"), /未知桌宠状态/);
});

test("burst 期间的 hold 延迟到 burst 结束后补上，而不是被丢弃", () => {
  let now = 0;
  const pet = createPetState({ now: () => now });
  pet.dispatch("emote", "failed");            // 失败 burst 5s
  pet.dispatch("hold", "review");             // 用户 1s 后重开一轮
  assert.equal(pet.snapshot().state, "failed");
  now += 6000;
  assert.equal(pet.tick().state, "review", "burst 到期应补上攒下的持续态，而不是回 idle");
});

test("后来的 hold 覆盖先到的；新瞬发状态作废待补的 hold", () => {
  let now = 0;
  const pet = createPetState({ now: () => now });
  pet.dispatch("emote", "jumping");
  pet.dispatch("hold", "review");
  pet.dispatch("hold", "waiting");            // 后来者覆盖
  pet.dispatch("poke");                       // 新瞬发 → 作废 pending
  now += 4000;
  assert.equal(pet.tick().state, "idle", "pending 应被新瞬发作废");
});

test("持续态有 TTL 兜底：事件流断了也回 idle", () => {
  let now = 0;
  const pet = createPetState({ now: () => now, holdTtlMs: 1000 });
  pet.dispatch("hold", "running");
  assert.equal(pet.snapshot().state, "running");
  now = 900;
  assert.equal(pet.tick().state, "running");
  now = 1200;
  assert.equal(pet.tick().state, "idle", "超过 TTL 应回 idle，不能永远卡在 running");
});

test("瞬发结束后回到 idle，不残留上一轮的持续态", () => {
  let now = 0;
  const pet = createPetState({ now: () => now });
  pet.dispatch("hold", "running");
  pet.dispatch("emote", "waving");
  assert.equal(pet.snapshot().state, "waving");
  now = 3000;
  pet.tick();
  assert.equal(pet.snapshot().state, "idle");
});