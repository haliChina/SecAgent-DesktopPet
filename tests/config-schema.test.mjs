import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_CONFIG, mergeConfig, normalizeField, describeSettings } from "../settings/config-schema.mjs";

test("默认值", () => {
  assert.equal(DEFAULT_CONFIG.petEnabled, true);
  assert.equal(DEFAULT_CONFIG.size, 160);
  assert.equal(DEFAULT_CONFIG.skinId, "");
  assert.equal(DEFAULT_CONFIG.activityLevel, "normal");
});

test("数字钳制", () => {
  assert.equal(normalizeField("size", 9999), 320);
  assert.equal(normalizeField("size", 1), 96);
  assert.equal(normalizeField("size", "abc"), 160);
});

test("select 非法回退", () => {
  assert.equal(normalizeField("activityLevel", "hyper"), "normal");
  assert.equal(normalizeField("activityLevel", "quiet"), "quiet");
});

test("mergeConfig 丢弃未知键", () => {
  const { config, dropped } = mergeConfig({ size: 200, nope: 1 });
  assert.equal(config.size, 200);
  assert.equal(config.nope, undefined);
  assert.deepEqual(dropped, []);
});

test("describeSettings 按分组返回", () => {
  const groups = describeSettings();
  assert.equal(groups.length, 3);
  assert.ok(groups.every((g) => Array.isArray(g.fields) && g.fields.length > 0));
});
