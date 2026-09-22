/**
 * 动态路由（前缀 /api/moments）
 * 公开：GET /            列表（游标分页）
 *       GET /:id         详情（含评论）
 * 管理：POST /           发布
 *       DELETE /:id      删除（连带评论/点赞/R2 对象）
 * 点赞与评论在 social.ts（同前缀不同子路径）。
 */
import { Hono } from "hono";
import { ok, fail } from "../respond";
import type { HonoEnv } from "../types";
import { requireAdmin } from "../auth";
import { getSettings } from "../settings";
import {
  queryMoments,
  queryMomentById,
  parseImages,
  parseVideo,
  mediaKeyFrom,
  type VideoRef,
} from "../db";

const app = new Hono<HonoEnv>();

const MAX_IMAGES = 9;
const MAX_CONTENT = 5000;
const MAX_LOCATION = 100;

interface MomentInput {
  content: string;
  images: string[]; // R2 key
  video: VideoRef | null; // src 存储为 key（本站）或 URL（外链）
  location: string;
}

/** 校验并归一化发布输入；返回错误字符串或输入对象。
 *  r2Domain：配置 R2 直连后上传返回完整 URL，需按域名提取 key。 */
function validateMomentInput(raw: unknown, r2Domain?: string): MomentInput | string {
  const body = (raw ?? {}) as Record<string, unknown>;

  const content = String(body.content ?? "").trim().slice(0, MAX_CONTENT);
  const location = String(body.location ?? "").trim().slice(0, MAX_LOCATION);

  // 图片：仅接受本站 uploads/images key
  let images: string[] = [];
  if (body.images !== undefined && body.images !== null) {
    if (!Array.isArray(body.images)) return "images 必须是数组";
    if (body.images.length > MAX_IMAGES) return `最多 ${MAX_IMAGES} 张图片`;
    for (const item of body.images) {
      const src = String(item ?? "");
      // 接受 /media/<key>、纯 key、R2 直连 URL（host 匹配 r2_domain）
      const key = mediaKeyFrom(src, r2Domain);
      if (!key || !key.startsWith("uploads/images/")) return "存在非法的图片来源";
      images.push(key);
    }
    images = [...new Set(images)];
  }

  // 视频：mp4 可本站 key 或外链；hls 仅 http(s) 外链且 .m3u8；poster 可选
  let video: VideoRef | null = null;
  if (body.video && typeof body.video === "object") {
    const v = body.video as Record<string, unknown>;
    const kind = String(v.kind ?? "");
    const src = String(v.src ?? "").trim();
    if (!src) return "视频地址不能为空";
    let poster: string | null = null;
    const posterRaw = typeof v.poster === "string" ? v.poster.trim() : "";
    if (posterRaw) {
      if (!/^https?:\/\//i.test(posterRaw) && !posterRaw.startsWith("/media/") && !/^uploads\//.test(posterRaw)) {
        return "封面地址非法";
      }
      poster = posterRaw;
    }
    if (kind === "mp4") {
      // 先尝试提取本站 key（/media/、纯 key、R2 直连 URL）；提取不到才视为外链
      const key = mediaKeyFrom(src, r2Domain) ?? (/^https?:\/\//i.test(src) ? src : null);
      if (!key) return "MP4 地址非法";
      video = { kind: "mp4", src: key, poster };
    } else if (kind === "hls") {
      let u: URL;
      try {
        u = new URL(src);
      } catch {
        return "M3U8 地址非法";
      }
      if (u.protocol !== "http:" && u.protocol !== "https:") return "M3U8 仅支持 http(s) 外链";
      if (!/\.m3u8($|\?)/i.test(u.pathname + u.search)) return "M3U8 地址必须以 .m3u8 结尾";
      video = { kind: "hls", src, poster };
    } else {
      return "视频类型非法";
    }
  }

  if (!content && images.length === 0 && !video) return "内容不能为空";
  return { content, images, video, location };
}

app.get("/", async c => {
  const voterId = c.req.query("voter_id");
  const cursor = Number(c.req.query("cursor")) || undefined;
  const limit = Number(c.req.query("limit")) || undefined;
  const s = await getSettings(c.env.DB);
  const result = await queryMoments(c.env.DB, { cursor, limit, voterId, r2Domain: s.r2_domain });
  return ok(c, result);
});

app.get("/:id", async c => {
  const id = Number(c.req.param("id"));
  if (!Number.isFinite(id)) return fail(c, "无效的 ID", 400);
  const s = await getSettings(c.env.DB);
  const moment = await queryMomentById(c.env.DB, id, c.req.query("voter_id"), true, s.r2_domain);
  if (!moment) return fail(c, "动态不存在", 404);
  return ok(c, moment);
});

app.post("/", requireAdmin, async c => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return fail(c, "请求格式错误", 400);
  }
  const s = await getSettings(c.env.DB);
  const input = validateMomentInput(body, s.r2_domain);
  if (typeof input === "string") return fail(c, input);

  const now = new Date().toISOString();
  const result = await c.env.DB.prepare(
    `INSERT INTO moments (content, images, video, location, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?) RETURNING *`
  )
    .bind(input.content, JSON.stringify(input.images), JSON.stringify(input.video ?? {}), input.location, now, now)
    .first();

  const created = await queryMomentById(c.env.DB, Number((result as { id: number }).id), undefined, false, s.r2_domain);
  return ok(c, created, "发布成功");
});

app.delete("/:id", requireAdmin, async c => {
  const id = Number(c.req.param("id"));
  if (!Number.isFinite(id)) return fail(c, "无效的 ID", 400);

  const row = await c.env.DB.prepare(`SELECT * FROM moments WHERE id = ?`).bind(id).first<{
    images: string;
    video: string;
  }>();
  if (!row) return fail(c, "动态不存在", 404);

  // 收集本站 R2 对象（图片 + mp4）
  const keys: string[] = [...parseImages(row.images)];
  const video = parseVideo(row.video);
  if (video && video.kind === "mp4") {
    // mediaKeyFrom 兼容历史数据里存的 R2 直连完整 URL（按配置的 r2_domain 提取 key）
    const key = mediaKeyFrom(video.src, (await getSettings(c.env.DB)).r2_domain);
    if (key && key.startsWith("uploads/")) keys.push(key);
  }
  const r2Keys = keys.filter(k => k.startsWith("uploads/"));

  await c.env.DB.batch([
    c.env.DB.prepare(`DELETE FROM comments WHERE target_type = 'moment' AND target_id = ?`).bind(id),
    c.env.DB.prepare(`DELETE FROM likes WHERE moment_id = ?`).bind(id),
    c.env.DB.prepare(`DELETE FROM moments WHERE id = ?`).bind(id),
  ]);
  if (r2Keys.length) await c.env.R2.delete(r2Keys);

  return ok(c, { id }, "删除成功");
});

/** POST /batch-delete  批量删除说说（连带评论/点赞/R2 媒体），body: { ids: number[] } */
app.post("/batch-delete", requireAdmin, async c => {
  let ids: number[];
  try {
    const body = (await c.req.json()) as { ids?: unknown };
    ids = [...new Set((Array.isArray(body.ids) ? body.ids : []).map(Number).filter(n => Number.isInteger(n) && n > 0))].slice(0, 200);
  } catch {
    return fail(c, "请求格式错误", 400);
  }
  if (!ids.length) return fail(c, "未选择任何说说", 400);

  const ph = ids.map(() => "?").join(",");
  const rows = await c.env.DB
    .prepare(`SELECT images, video FROM moments WHERE id IN (${ph})`)
    .bind(...ids)
    .all<{ images: string; video: string }>();

  const r2Domain = (await getSettings(c.env.DB)).r2_domain;
  const r2Keys = new Set<string>();
  for (const r of rows.results) {
    for (const k of parseImages(r.images)) if (k.startsWith("uploads/")) r2Keys.add(k);
    const v = parseVideo(r.video);
    if (v && v.kind === "mp4") {
      const k = mediaKeyFrom(v.src, r2Domain);
      if (k && k.startsWith("uploads/")) r2Keys.add(k);
    }
  }

  await c.env.DB.batch(
    ids.flatMap(id => [
      c.env.DB.prepare(`DELETE FROM comments WHERE target_type = 'moment' AND target_id = ?`).bind(id),
      c.env.DB.prepare(`DELETE FROM likes WHERE moment_id = ?`).bind(id),
      c.env.DB.prepare(`DELETE FROM moments WHERE id = ?`).bind(id),
    ])
  );
  if (r2Keys.size) await c.env.R2.delete([...r2Keys]);

  return ok(c, { deleted: rows.results.length }, `已删除 ${rows.results.length} 条说说`);
});

/**
 * PUT /:id  编辑说说（content/images/video/location，可选字段；未传字段保留原值）
 * 注意：images/video 整体替换；旧 R2 对象不自动清理（编辑时不删旧素材，避免误删）
 */
app.put("/:id", requireAdmin, async c => {
  const id = Number(c.req.param("id"));
  if (!Number.isFinite(id)) return fail(c, "无效的 ID", 400);
  const existing = await c.env.DB.prepare(`SELECT * FROM moments WHERE id = ?`).bind(id).first<{
    content: string;
    images: string;
    video: string;
    location: string;
  }>();
  if (!existing) return fail(c, "动态不存在", 404);

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return fail(c, "请求格式错误", 400);
  }
  const s = await getSettings(c.env.DB);
  const input = validateMomentInput(body, s.r2_domain);
  if (typeof input === "string") return fail(c, input);

  const now = new Date().toISOString();
  await c.env.DB.prepare(
    `UPDATE moments SET content = ?, images = ?, video = ?, location = ?, updated_at = ? WHERE id = ?`
  )
    .bind(
      input.content,
      JSON.stringify(input.images),
      JSON.stringify(input.video ?? {}),
      input.location,
      now,
      id
    )
    .run();

  const updated = await queryMomentById(c.env.DB, id, undefined, false, s.r2_domain);
  return ok(c, updated, "已更新");
});

export default app;
