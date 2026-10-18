// gen-skin-prompt.mjs 一键生成器的冒烟测试：真实运行脚本、校验契约要素齐全。
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { fileURLToPath } from "node:url";

const run = promisify(execFile);
const script = path.join(
  path.dirname(fileURLToPath(import.meta.url)), "..", "scripts", "gen-skin-prompt.mjs"
);

test("一键生成：契约要素齐全（几何/行表/拼接脚本/完成标准）", async () => {
  const { stdout } = await run("node", [script, "orange cat coder with glasses"]);
  // 图集契约
  assert.match(stdout, /8 列 × 11 行/);
  assert.match(stdout, /1536×2288/);
  assert.match(stdout, /192×208/);
  // 状态行表要素
  assert.match(stdout, /idle 待机 \| 6/);
  assert.match(stdout, /running-right 右跑 \| 8/);
  assert.match(stdout, /review 复核 \| 6/);
  // 定妆图流程 + 拼接脚本 + 完成标准
  assert.match(stdout, /定妆图/);
  assert.match(stdout, /from PIL import Image/);
  assert.match(stdout, /完成标准/);
  assert.match(stdout, /pet_skin/);
});

test("一键生成：英文词组作 id，SKIN_ID 可覆盖，安装目录跟随", async () => {
  const { stdout } = await run("node", [script, "orange cat coder"], {
    env: { ...process.env, SKIN_ID: "my-cat" }
  });
  assert.match(stdout, /"id": "my-cat"/);
  assert.match(stdout, /\/my-cat["'\n]/.source ? /pets\/my-cat/ : /pets/);
});

test("一键生成：纯中文描述退到短随机 id（不做长中文目录）", async () => {
  const { stdout } = await run("node", [script, "一只戴圆眼镜的橘猫程序员"]);
  assert.match(stdout, /"id": "skin-[a-z0-9]{4}"/);
});

test("一键生成：无参数时退出码 1 并给出用法", async () => {
  await assert.rejects(
    run("node", [script]),
    (err) => err.code === 1 && /用法/.test(err.stderr)
  );
});
