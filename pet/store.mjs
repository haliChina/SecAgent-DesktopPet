// Codex 社区桌宠商店（petdex）客户端：查目录 + 安装皮肤到 ~/.codex/pets。
//
// 目录接口：GET https://petdex.dev/api/manifest/v2（307 到 assets.petdex.dev 的快照）。
// v2 紧凑格式：{ v:2, assetBase, fields:[...], total, pets:[[...]] }
//   fields = [slug, displayName, kind, submittedBy, spritesheet, petJson, zip, spriteVersionNumber]
// 资源必须来自 assets.petdex.dev 且走 https——与 petdex CLI 同一份主机白名单，
// 否则一次目录投毒就能让本机写入任意来源的字节。

import fs from "node:fs";
import path from "node:path";
import os from "node:os";

export const MANIFEST_URL = "https://petdex.dev/api/manifest/v2";
export const TRUSTED_ASSET_HOSTS = Object.freeze(["assets.petdex.dev"]);

const FIELDS = Object.freeze([
  "slug", "displayName", "kind", "submittedBy",
  "spritesheet", "petJson", "zip", "spriteVersionNumber"
]);

export function isTrustedAssetUrl(url) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" && TRUSTED_ASSET_HOSTS.includes(parsed.hostname);
  } catch {
    return false;
  }
}

/** 解析 v2 紧凑 manifest；结构或主机不合规即抛错（fail-closed）。 */
export function parseCompactManifest(input) {
  if (!input || typeof input !== "object" || input.v !== 2 || !Array.isArray(input.pets)) {
    throw new Error("商店 manifest 结构不合法");
  }
  if (!isTrustedAssetUrl(String(input.assetBase || ""))) {
    throw new Error("商店 manifest 的 assetBase 主机不在白名单内");
  }
  if (input.total !== undefined && input.total !== input.pets.length) {
    throw new Error("商店 manifest 的 total 与条目数不一致");
  }
  const base = String(input.assetBase).replace(/\/+$/, "");
  return input.pets.map((row, i) => {
    if (!Array.isArray(row) || row.length !== FIELDS.length) throw new Error(`商店条目 ${i} 字段数不对`);
    const [slug, displayName, kind, , spritesheet, petJson, , version] = row;
    if (typeof slug !== "string" || !/^[a-z0-9][a-z0-9-]{0,63}$/i.test(slug)) throw new Error(`商店条目 ${i} 的 slug 非法`);
    if (version !== 1 && version !== 2) throw new Error(`商店条目 ${slug} 的 spriteVersionNumber 非法`);
    const spritesheetUrl = `${base}/${String(spritesheet).replace(/^\/+/, "")}`;
    const petJsonUrl = `${base}/${String(petJson).replace(/^\/+/, "")}`;
    // URL 解析会把 ../ 规范化掉，主机白名单看不出越界——必须单独查路径段。
    for (const rel of [spritesheet, petJson]) {
      if (String(rel).split("/").some((seg) => seg === ".." || seg === "." || seg.length === 0)) {
        throw new Error(`商店条目 ${slug} 的资源路径越界`);
      }
    }
    if (!isTrustedAssetUrl(spritesheetUrl) || !isTrustedAssetUrl(petJsonUrl)) {
      throw new Error(`商店条目 ${slug} 的资源主机不在白名单内`);
    }
    return { slug, displayName: String(displayName ?? slug), kind: String(kind ?? ""), spriteVersionNumber: version, spritesheetUrl, petJsonUrl };
  });
}

/** 拉取并缓存商店目录（默认 10 分钟）。 */
export function createStore(fetchImpl, options = {}) {
  const ttlMs = options.ttlMs ?? 10 * 60_000;
  const url = options.url ?? MANIFEST_URL;
  let cache = null;
  let fetchedAt = 0;

  async function catalog(force = false) {
    if (!force && cache && Date.now() - fetchedAt < ttlMs) return cache;
    const res = await fetchImpl(url, { headers: { accept: "application/json" } });
    if (!res.ok) throw new Error(`商店目录拉取失败：HTTP ${res.status}`);
    cache = parseCompactManifest(await res.json());
    fetchedAt = Date.now();
    return cache;
  }

  async function search(query, limit = 20) {
    const pets = await catalog();
    const q = String(query ?? "").trim().toLowerCase();
    if (!q) return pets.slice(0, limit);
    return pets
      .filter((p) => p.slug.toLowerCase().includes(q) || p.displayName.toLowerCase().includes(q) || p.kind.toLowerCase().includes(q))
      .slice(0, limit);
  }

  /** 下载一只皮肤到 ~/.codex/pets/<slug>/，写回标准 pet.json。 */
  async function install(slug) {
    const pets = await catalog();
    const pet = pets.find((p) => p.slug.toLowerCase() === String(slug).toLowerCase());
    if (!pet) throw new Error(`商店里没有这只皮肤：${slug}`);

    const sheetRes = await fetchImpl(pet.spritesheetUrl);
    if (!sheetRes.ok) throw new Error(`精灵图下载失败：HTTP ${sheetRes.status}`);
    const bytes = Buffer.from(await sheetRes.arrayBuffer());
    if (bytes.length < 1024) throw new Error("精灵图内容异常（过小）");

    const dir = path.join(os.homedir(), ".codex", "pets", pet.slug);
    fs.mkdirSync(dir, { recursive: true });
    const sheetFile = path.join(dir, "spritesheet.webp");
    fs.writeFileSync(sheetFile + ".tmp", bytes);
    fs.renameSync(sheetFile + ".tmp", sheetFile);

    const petJson = {
      id: pet.slug,
      displayName: pet.displayName,
      description: `${pet.kind || "community"} · 来自 petdex 社区商店`,
      spriteVersionNumber: pet.spriteVersionNumber,
      spritesheetPath: "spritesheet.webp"
    };
    const jsonFile = path.join(dir, "pet.json");
    fs.writeFileSync(jsonFile, JSON.stringify(petJson, null, 2) + "\n");

    return { ...pet, dir, bytes: bytes.length };
  }

  return { catalog, search, install };
}