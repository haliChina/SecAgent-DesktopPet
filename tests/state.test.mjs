import { test } from "node:test";
import assert from "node:assert/strict";
import { createPetState, STATES } from "../pet/state.mjs";

function harness() {
  let t = 1000;
  const pet = createPetState({ now: () => t, bubbleMs: 4000 });
  return { pet, advance: (ms) => { t += ms; }, now: () => t };
}

test("初始状态为 idle", () => {
  const { pet } = harness();
  assert.equal(pet.snapshot().state, "idle");
  assert.ok(STATES.includes("sleeping"));
});

test("tool_call → running，tool_done → review → 超时回 idle", () => {
  const { pet, advance } = harness();
  assert.equal(pet.dispatch("tool_call"), "running");
  assert.equal(pet.dispatch("tool_done"), "review");
  advance(1000);
  assert.equal(pet.tick().state, "review");
  advance(2000);
  assert.equal(pet.tick().state, "idle");
});

test("task_done → jumping，task_failed → failed", () => {
  const { pet, advance } = harness();
  assert.equal(pet.dispatch("task_done"), "jumping");
  advance(4000);
  assert.equal(pet.tick().state, "idle");
  assert.equal(pet.dispatch("task_failed"), "failed");
  advance(6000);
  assert.equal(pet.tick().state, "idle");
});

test("poke → waving，pat → jumping", () => {
  const { pet, advance } = harness();
  assert.equal(pet.dispatch("poke"), "waving");
  advance(3000);
  assert.equal(pet.tick().state, "idle");
  assert.equal(pet.dispatch("pat"), "jumping");
});

test("say 只冒泡：idle 下切 waiting，running 下保持", () => {
  const { pet, advance } = harness();
  pet.dispatch("say", "你好");
  assert.equal(pet.snapshot().state, "waiting");
  assert.equal(pet.snapshot().bubble, "你好");
  advance(5000);
  assert.equal(pet.tick().bubble, null);

  pet.dispatch("emote", "running");
  pet.dispatch("say", "干活中");
  assert.equal(pet.snapshot().state, "running");
});

test("sleep / wake", () => {
  const { pet } = harness();
  assert.equal(pet.dispatch("sleep"), "sleeping");
  assert.equal(pet.dispatch("user_message"), "waiting");
  pet.dispatch("sleep");
  pet.dispatch("emote", "idle");
  pet.dispatch("sleep");
  assert.equal(pet.dispatch("wake"), "idle");
});

test("emote 强制指定状态，非法抛错", () => {
  const { pet } = harness();
  assert.equal(pet.dispatch("emote", "sleeping"), "sleeping");
  assert.throws(() => pet.dispatch("emote", "flying"), /未知桌宠状态/);
  assert.throws(() => pet.dispatch("nope"), /未知桌宠事件/);
});

test("setLook 钳制到 [-1,1]", () => {
  const { pet } = harness();
  pet.setLook(5, -5);
  assert.deepEqual(pet.snapshot().look, { dx: 1, dy: -1 });
  pet.setLook(null, null);
  assert.equal(pet.snapshot().look, null);
});
