import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { createStore, parseCompactManifest, isTrustedAssetUrl } from "../pet/store.mjs";

const FIELDS = ["slug", "displayName", "kind", "submittedBy", "spritesheet", "petJson", "zip", "spriteVersionNumber"];

function row(slug, version = 1) {
  return [slug, slug.toUpperCase(), "character", "someone", `pets/${slug}-abc/sprite.webp`, `pets/${slug}-abc/petjson.json`, null, version];
}

function fakeFetch(manifest, sheetBytes = Buffer.alloc(4096, 7)) {
  return async (url) => {
    const u = String(url);
    if (u.includes("petdex.dev/api/manifest")) {
      return { ok: true, status: 200, json: async () => manifest };
    }
    if (u.endsWith(".webp")) {
      return { ok: true, status: 200, arrayBuffer: async () => sheetBytes.buffer.slice(sheetBytes.byteOffset, sheetBytes.byteOffset + sheetBytes.byteLength) };
    }
    return { ok: false, status: 404, json: async () => ({}) };
  };
}

test("白名单只认 assets.petdex.dev 的 https", () => {
  assert.equal(isTrustedAssetUrl("https://assets.petdex.dev/pets/a/sprite.webp"), true);
  assert.equal(isTrustedAssetUrl("http://assets.petdex.dev/pets/a/sprite.webp"), false);
  assert.equal(isTrustedAssetUrl("https://evil.example/pets/a/sprite.webp"), false);
  assert.equal(isTrustedAssetUrl("https://assets.petdex.dev.evil.example/a"), false);
});

test("解析 v2 紧凑 manifest", () => {
  const pets = parseCompactManifest({ v: 2, assetBase: "https://assets.petdex.dev", total: 2, pets: [row("boba", 1), row("ovo", 2)] });
  assert.equal(pets.length, 2);
  assert.equal(pets[1].slug, "ovo");
  assert.equal(pets[1].spriteVersionNumber, 2);
  assert.equal(pets[0].spritesheetUrl, "https://assets.petdex.dev/pets/boba-abc/sprite.webp");
});

test("assetBase / 条目资源主机不在白名单即拒绝（目录投毒不能写入任意来源字节）", () => {
  assert.throws(() => parseCompactManifest({ v: 2, assetBase: "https://evil.example", pets: [] }), /白名单/);
  assert.throws(() => parseCompactManifest({ v: 2, assetBase: "http://assets.petdex.dev", pets: [] }), /白名单/);
  assert.throws(() => parseCompactManifest({
    v: 2, assetBase: "https://assets.petdex.dev",
    pets: [["a", "A", "c", null, "../../etc/passwd", "p.json", null, 1]]
  }), /越界/);
  assert.throws(() => parseCompactManifest({ v: 2, assetBase: "https://assets.petdex.dev", total: 5, pets: [] }), /total/);
  assert.throws(() => parseCompactManifest({ v: 1, assetBase: "https://assets.petdex.dev", pets: [] }), /结构/);
});

test("slug 必须是安全的短横线名", () => {
  const bad = (slug) => {
    const r = row("ok");
    r[0] = slug;
    return parseCompactManifest({ v: 2, assetBase: "https://assets.petdex.dev", pets: [r] });
  };
  assert.throws(() => bad("../evil"), /slug/);
  assert.throws(() => bad("Has Uppercase And Spaces"), /slug/);
});

test("search 按名字/类别过滤并限长", async () => {
  const manifest = { v: 2, assetBase: "https://assets.petdex.dev", total: 3, pets: [row("boba"), row("kirby"), row("catbox")] };
  const store = createStore(fakeFetch(manifest), { url: "https://petdex.dev/api/manifest/v2" });
  assert.equal((await store.search("BOBA")).length, 1);
  assert.equal((await store.search("character")).length, 3);
  assert.equal((await store.search("", 2)).length, 2);
});

test("install 下载精灵图并写出标准 pet.json", async (t) => {
  const home = path.join(os.tmpdir(), "pet-store-" + crypto.randomUUID());
  fs.mkdirSync(home, { recursive: true });
  const original = os.homedir;
  os.homedir = () => home;
  t.after(() => { os.homedir = original; fs.rmSync(home, { recursive: true, force: true }); });

  const manifest = { v: 2, assetBase: "https://assets.petdex.dev", total: 1, pets: [row("boba", 2)] };
  const store = createStore(fakeFetch(manifest));
  const r = await store.install("BOBA");
  assert.equal(r.slug, "boba");
  assert.equal(r.dir, path.join(home, ".codex", "pets", "boba"));
  const sheet = path.join(r.dir, "spritesheet.webp");
  assert.ok(fs.existsSync(sheet));
  assert.equal(fs.statSync(sheet).size, 4096);
  const json = JSON.parse(fs.readFileSync(path.join(r.dir, "pet.json"), "utf8"));
  assert.deepEqual(json, {
    id: "boba", displayName: "BOBA", description: "character · 来自 petdex 社区商店",
    spriteVersionNumber: 2, spritesheetPath: "spritesheet.webp"
  });
});

test("install 未知 slug 报错；精灵图异常小则拒绝落盘", async () => {
  const manifest = { v: 2, assetBase: "https://assets.petdex.dev", total: 1, pets: [row("boba")] };
  const store = createStore(fakeFetch(manifest, Buffer.alloc(8)));
  await assert.rejects(() => store.install("nope"), /没有这只皮肤/);
  await assert.rejects(() => store.install("boba"), /过小/);
});

test("目录拉取失败向上抛错，不静默返回空列表", async () => {
  const store = createStore(async () => ({ ok: false, status: 503, json: async () => ({}) }));
  await assert.rejects(() => store.search("x"), /HTTP 503/);
});

test("FIELDS 顺序与商店 v2 契约一致", () => {
  assert.equal(FIELDS.length, 8);
  assert.equal(FIELDS[0], "slug");
  assert.equal(FIELDS[7], "spriteVersionNumber");
});