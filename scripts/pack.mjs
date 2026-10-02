// 打包：收集发布文件到 release/stage，再压缩为 release/desktop-pet-<version>.zip。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const manifest = JSON.parse(fs.readFileSync(path.join(root, "secagent-plugin.json"), "utf8"));
const version = manifest.version;

const releaseDir = path.join(root, "release");
const stage = path.join(releaseDir, "stage");
const outZip = path.join(releaseDir, `desktop-pet-${version}.zip`);

const FILES = ["secagent-plugin.json", "package.json", "main.mjs", "README.md"];
const DIRS = ["pet", "settings", "skills", "docs"];

fs.rmSync(stage, { recursive: true, force: true });
fs.mkdirSync(stage, { recursive: true });

for (const f of FILES) {
  fs.cpSync(path.join(root, f), path.join(stage, f));
}
for (const d of DIRS) {
  const src = path.join(root, d);
  if (!fs.existsSync(src)) throw new Error(`缺少目录：${d}`);
  fs.cpSync(src, path.join(stage, d), { recursive: true });
}
// 测试文件不进发布包

fs.rmSync(outZip, { force: true });
if (process.platform === "win32") {
  execSync(
    `powershell -NoProfile -Command "Compress-Archive -Path '${path.join(stage, "*")}' -DestinationPath '${outZip}' -Force"`,
    { stdio: "inherit" }
  );
} else {
  execSync(`zip -r -X "${outZip}" .`, { cwd: stage, stdio: "inherit" });
}
fs.rmSync(stage, { recursive: true, force: true });

const bytes = fs.statSync(outZip).size;
console.log(`\n打包完成：${path.relative(root, outZip)}（${(bytes / 1024).toFixed(0)} KiB）`);
