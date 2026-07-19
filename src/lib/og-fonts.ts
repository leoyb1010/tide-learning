import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/**
 * OG 图 CJK 字体子集加载(v4.2 收敛:此前 3 个 opengraph-image 各持一份拷贝)。
 *
 * 策略:Google Fonts css2 按需取字形子集(体积 ~几十 KB) + **磁盘缓存兜底**——
 * 内网/断网/临时故障时回落「最近一次成功的同键子集」,不再出无字体豆腐块;
 * 首次冷启动且无网时仍可能 null(调用方已兜底默认字体)。
 * 缓存键 = sha256(text|weight),目录 .next/cache/og-fonts(构建产物同生命周期,可随时清)。
 */

const CACHE_DIR = join(process.cwd(), ".next", "cache", "og-fonts");

function cachePath(text: string, weight: number): string {
  const key = createHash("sha256").update(`${weight}|${text}`).digest("hex").slice(0, 24);
  return join(CACHE_DIR, `${key}.font`);
}

function readCache(p: string): ArrayBuffer | null {
  try {
    const buf = readFileSync(p);
    return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  } catch {
    return null;
  }
}

export async function loadCjkSubset(text: string, weight: 700 | 900): Promise<ArrayBuffer | null> {
  const uniq = Array.from(new Set(text.split(""))).join("");
  const file = cachePath(uniq, weight);
  try {
    const cssUrl =
      `https://fonts.googleapis.com/css2?family=Noto+Sans+SC:wght@${weight}` +
      `&text=${encodeURIComponent(uniq)}`;
    const cssRes = await fetch(cssUrl, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible)" },
      next: { revalidate: 60 * 60 * 24 * 30 }, // 子集稳定，缓存 30 天
    });
    if (!cssRes.ok) return readCache(file);
    const css = await cssRes.text();
    const m = css.match(/src:\s*url\(([^)]+)\)\s*format\('(?:truetype|opentype)'\)/);
    if (!m) return readCache(file);
    const fontRes = await fetch(m[1], { next: { revalidate: 60 * 60 * 24 * 30 } });
    if (!fontRes.ok) return readCache(file);
    const buf = await fontRes.arrayBuffer();
    try {
      mkdirSync(CACHE_DIR, { recursive: true });
      writeFileSync(file, Buffer.from(buf));
    } catch {
      // 缓存写失败不影响本次渲染
    }
    return buf;
  } catch {
    return readCache(file);
  }
}
