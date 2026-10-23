// 0.5.6：skin 事件唤醒（切皮肤不再「变透明」）。
import { test } from "node:test";
import assert from "node:assert/strict";
import { createPetState } from "../pet/state.mjs";

test("skin 事件唤醒：睡着时换皮肤回到 idle（0.5.6 切皮肤变透明修复）", () => {
  const pet = createPetState({});
  pet.dispatch("sleep");
  assert.equal(pet.snapshot().state, "sleeping");
  assert.equal(pet.dispatch("wake"), "idle", "dispatch 返回迁移后的状态字符串");
  assert.equal(pet.snapshot().state, "idle");
});
