/**
 * 随机横幅背景图：本站代理 + R2 缓存（前缀 /api/bg）
 * - 按设置的「换图频率（小时）」把时间分桶，同桶内所有访客同一张图 → 高缓存命中
 * - 首次请求抓取图源（URL 含 {seed} 占位），校验为图片且 ≤5MB 后存 R2，后续直出
 * - 自动清理 30 天前的旧图，避免 R2 无限增长
 */
import { Hono } from "hono";
import type { HonoEnv } from "../types";
import { fail } from "../respond";
import { getSettings } from "../settings";

const app = new Hono<HonoEnv>();

const MAX_BYTES = 5 * 1024 * 1024; // 单图上限 5MB
const KEEP_MS = 30 * 24 * 3600 * 1000; // 保留最近 30 天

/** 简易字符串哈希，用于把图源 URL 映射成短目录名 */
function hashStr(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
  return h.toString(16);
}

/** 清理某图源目录下 30 天前的旧缓存图（不阻塞响应） */
async function pruneOld(R2: R2Bucket, prefix: string, now: number): Promise<void> {
  try {
    const cutoff = now - KEEP_MS;
    let cursor: string | undefined;
    const toDelete: string[] = [];
    do {
      const listed = await R2.list({ prefix, cursor, limit: 500 });
      for (const o of listed.objects) {
        const m = /(\d+)\.jpg$/i.exec(o.key);
        if (!m) continue;
        const bucket = Number(m[1]);
        if (Number.isFinite(bucket) && bucket < cutoff) toDelete.push(o.key);
      }
      cursor = listed.truncated ? listed.cursor : undefined;
    } while (cursor);
    for (const k of toDelete) await R2.delete(k).catch(() => {});
  } catch {
    /* 清理失败不影响服务 */
  }
}

app.get("/", async c => {
  const s = await getSettings(c.env.DB);
  if (s.banner_bg_mode !== "random") return fail(c, "未启用随机背景", 404);

  const source = (s.banner_bg_source || "").trim();
  if (!/^https:\/\//i.test(source) || !source.includes("{seed}")) {
    return fail(c, "随机图源配置无效（需 https 且含 {seed}）", 500);
  }

  const hours = Math.max(1, Math.min(720, parseInt(s.banner_bg_interval, 10) || 24));
  const bucketMs = hours * 3600_000;
  const now = Date.now();
  const bucket = Math.floor(now / bucketMs) * bucketMs; // 对齐到时间桶起点（ms）
  const seed = String(bucket);
  const maxAge = Math.max(1, Math.floor((bucket + bucketMs - now) / 1000)); // 距下个桶的秒数

  const prefix = `bg/${hashStr(source)}/`;
  const key = `${prefix}${seed}.jpg`;

  // 命中 R2 缓存 → 直出
  const cached = await c.env.R2.get(key);
  if (cached) {
    const ct = cached.httpMetadata?.contentType || "image/jpeg";
    return new Response(cached.body, {
      headers: { "Content-Type": ct, "Cache-Control": `public, max-age=${maxAge}`, ETag: cached.httpEtag },
    });
  }

  // 未命中 → 抓取图源
  let res: Response;
  try {
    res = await fetch(source.replace("{seed}", seed), {
      headers: { "User-Agent": "moments-bg/1.0" },
      signal: AbortSignal.timeout(15000),
    });
  } catch {
    return fail(c, "图源抓取失败", 502);
  }
  if (!res.ok) return fail(c, "图源返回异常", 502);
  const ct = res.headers.get("content-type") || "";
  if (!/^image\//i.test(ct)) return fail(c, "图源返回的不是图片", 502);
  const buf = await res.arrayBuffer();
  if (buf.byteLength === 0 || buf.byteLength > MAX_BYTES) return fail(c, "图片为空或超过 5MB", 502);

  await c.env.R2.put(key, buf, { httpMetadata: { contentType: ct } });
  c.executionCtx.waitUntil(pruneOld(c.env.R2, prefix, now));

  return new Response(buf, {
    headers: { "Content-Type": ct, "Cache-Control": `public, max-age=${maxAge}` },
  });
});

export default app;
