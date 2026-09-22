/**
 * 管理路由：登录/登出/会话、文件上传（图片、MP4）
 * 前缀 /api/admin
 */
import { Hono } from "hono";
import { ok, fail } from "../respond";
import type { HonoEnv } from "../types";
import {
  createAdminToken,
  setAdminCookie,
  clearAdminCookie,
  isAdmin,
  requireAdmin,
  verifyAdminPassword,
  getAdminSecret,
  setAdminPassword,
  hasAdminPassword,
} from "../auth";
import { keyToSrc } from "../db";
import { getSettings, updateSettings, normalizeAdminPath } from "../settings";
import { deleteCommentAnywhere, editCommentAnywhere } from "../comment-service";

const app = new Hono<HonoEnv>();

/* ---------- 登录暴力破解防护（按 IP，5 次失败锁 15 分钟） ---------- */
const MAX_FAILS = 5;
const LOCK_MS = 15 * 60 * 1000;

interface AttemptRow {
  ip: string;
  fail_count: number;
  locked_until: string | null;
  updated_at: string;
}

async function getAttempt(db: D1Database, ip: string): Promise<AttemptRow | null> {
  return db.prepare(`SELECT * FROM login_attempts WHERE ip = ?`).bind(ip).first<AttemptRow>();
}

async function clearAttempt(db: D1Database, ip: string): Promise<void> {
  await db.prepare(`DELETE FROM login_attempts WHERE ip = ?`).bind(ip).run();
}

/** 记录一次失败；返回锁定截止时间（达到阈值时） */
async function registerFailure(db: D1Database, ip: string): Promise<Date | null> {
  const now = Date.now();
  const prev = await getAttempt(db, ip);
  // 锁定期已过 → 重新计数
  const expired = prev?.locked_until && new Date(prev.locked_until).getTime() <= now;
  const failCount = expired ? 1 : (Number(prev?.fail_count ?? 0) + 1);
  const lockedUntil = failCount >= MAX_FAILS ? new Date(now + LOCK_MS) : null;
  await db
    .prepare(
      `INSERT INTO login_attempts (ip, fail_count, locked_until, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(ip) DO UPDATE SET
         fail_count = excluded.fail_count,
         locked_until = excluded.locked_until,
         updated_at = excluded.updated_at`
    )
    .bind(ip, failCount, lockedUntil?.toISOString() ?? null, new Date(now).toISOString())
    .run();
  return lockedUntil;
}

const IMAGE_TYPES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/gif": "gif",
  "image/webp": "webp",
};
const MAX_IMAGE = 30 * 1024 * 1024;
const MAX_VIDEO = 100 * 1024 * 1024;

/**
 * POST /api/admin/setup  { new_password, path }
 * 首次部署设初始密码：仅在 D1 无 password_hash 且环境变量 ADMIN_PASSWORD 未设置时可用。
 * 设置成功后写入 SHA-256 哈希并下发登录 cookie，后续访问 /admin 走正常解锁页。
 */
app.post("/setup", async c => {
  // 已设过密码：禁止调用此接口（防止已部署站点被任意人重置密码）
  if (await hasAdminPassword(c.env.DB, c.env.ADMIN_PASSWORD)) {
    return fail(c, "已设置管理密码，请使用登录接口", 403);
  }
  let body: { new_password?: unknown; path?: unknown };
  try {
    body = await c.req.json();
  } catch {
    return fail(c, "请求格式错误", 400);
  }
  const newPassword = typeof body.new_password === "string" ? body.new_password : "";
  const entryPath = typeof body.path === "string" ? body.path : "";

  const settings = await getSettings(c.env.DB);
  if (entryPath !== settings.admin_path) {
    return fail(c, "页面不存在", 404);
  }
  if (newPassword.length < 6 || newPassword.length > 128) {
    return fail(c, "密码长度需 6-128 位", 400);
  }

  const hash = await setAdminPassword(c.env.DB, newPassword);
  const token = await createAdminToken(hash);
  setAdminCookie(c, token);
  return ok(c, { admin: true, admin_path: settings.admin_path }, "初始密码已设置");
});

app.post("/login", async c => {
  let password = "";
  let entryPath = "";
  try {
    const body = await c.req.json<{ password?: unknown; path?: unknown }>();
    password = typeof body.password === "string" ? body.password : "";
    entryPath = typeof body.path === "string" ? body.path : "";
  } catch {
    return fail(c, "请求格式错误", 400);
  }

  const settings = await getSettings(c.env.DB);
  // 入口路径证明：不知道秘密路径的请求一律 404（伪装页面不存在，不暴露后台）
  if (entryPath !== settings.admin_path) {
    return fail(c, "页面不存在", 404);
  }

  const ip = c.req.header("CF-Connecting-IP") || c.req.header("X-Forwarded-For") || "unknown";
  const attempt = await getAttempt(c.env.DB, ip);
  const now = Date.now();
  if (attempt?.locked_until) {
    const until = new Date(attempt.locked_until).getTime();
    if (until > now) {
      const mins = Math.ceil((until - now) / 60000);
      return fail(c, `失败次数过多，请 ${mins} 分钟后再试`, 429);
    }
  }

  if (!(await verifyAdminPassword(c.env.DB, c.env.ADMIN_PASSWORD, password))) {
    const lockedUntil = await registerFailure(c.env.DB, ip);
    if (lockedUntil) return fail(c, "连续失败过多，已锁定 15 分钟", 429);
    return fail(c, "密码错误", 401);
  }

  await clearAttempt(c.env.DB, ip);
  const secret = await getAdminSecret(c.env.DB, c.env.ADMIN_PASSWORD);
  const token = await createAdminToken(secret);
  setAdminCookie(c, token);
  return ok(c, { admin: true, admin_path: settings.admin_path }, "解锁成功");
});

/**
 * POST /api/admin/password  { old_password, new_password }
 * 后台修改管理密码：校验原密码后把新密码 SHA-256 哈希写入 D1，
 * 立即生效（无需重新部署），并用新密钥重签 cookie 保持当前会话。
 */
app.post("/password", requireAdmin, async c => {
  let body: { old_password?: unknown; new_password?: unknown };
  try {
    body = await c.req.json();
  } catch {
    return fail(c, "请求格式错误", 400);
  }
  const oldPassword = typeof body.old_password === "string" ? body.old_password : "";
  const newPassword = typeof body.new_password === "string" ? body.new_password : "";

  if (!(await verifyAdminPassword(c.env.DB, c.env.ADMIN_PASSWORD, oldPassword))) {
    return fail(c, "原密码错误", 401);
  }
  if (newPassword.length < 6 || newPassword.length > 128) {
    return fail(c, "新密码长度需 6-128 位", 400);
  }
  if (newPassword === oldPassword) {
    return fail(c, "新密码不能与原密码相同", 400);
  }

  const hash = await setAdminPassword(c.env.DB, newPassword);
  const token = await createAdminToken(hash);
  setAdminCookie(c, token);
  return ok(c, { admin: true }, "密码已修改");
});

app.post("/logout", async c => {
  clearAdminCookie(c);
  return ok(c, { admin: false }, "已退出");
});

app.get("/session", async c => {
  const admin = await isAdmin(c);
  if (!admin) return ok(c, { admin: false });
  const s = await getSettings(c.env.DB);
  return ok(c, { admin: true, admin_path: s.admin_path });
});

/**
 * POST /api/admin/upload  multipart: file + kind(image|video) + optional thumb(image thumbnail)
 * 返回 { key, src, content_type, size, has_thumb }
 */
app.post("/upload", requireAdmin, async c => {
  const form = await c.req.formData();
  const file = form.get("file");
  const kind = String(form.get("kind") ?? "image");
  const thumb = form.get("thumb");
  if (!(file instanceof File) || file.size === 0) return fail(c, "file 不能为空");

  // 缩略图重建专用：前端 canvas 生成的缩略图按指定 key 直存（覆盖）。
  // 仅允许 uploads/ 前缀 + _w1200.jpg 结尾，防路径穿越与滥用；普通上传不带 key 字段不受影响。
  const customKey = String(form.get("key") ?? "");
  if (customKey) {
    if (!/^uploads\/[\w./-]+_w1200\.jpg$/i.test(customKey) || customKey.includes(".."))
      return fail(c, "非法的缩略图 key");
    await c.env.R2.put(customKey, file.stream(), { httpMetadata: { contentType: "image/jpeg" } });
    const s0 = await getSettings(c.env.DB);
    return ok(c, { key: customKey, src: keyToSrc(customKey, s0.r2_domain), content_type: "image/jpeg", size: file.size, has_thumb: false }, "缩略图已写入");
  }

  const date = new Date().toISOString().slice(0, 10);
  const uuid = crypto.randomUUID();
  const originalExt = (file.name.split(".").pop() ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");

  let key: string;
  let contentType: string;

  if (kind === "image") {
    const ext = IMAGE_TYPES[file.type] ?? "";
    if (!ext) return fail(c, "仅支持 JPG/PNG/GIF/WEBP 图片");
    if (file.size > MAX_IMAGE) return fail(c, "图片不能超过 30MB");
    contentType = file.type;
    key = `uploads/images/${date}/${uuid}.${ext}`;
  } else if (kind === "video") {
    const isMp4 = file.type === "video/mp4" || originalExt === "mp4";
    if (!isMp4) return fail(c, "仅支持 MP4 视频（M3U8 请使用外链地址）");
    if (file.size > MAX_VIDEO) return fail(c, "视频不能超过 100MB，建议使用外链");
    contentType = "video/mp4";
    key = `uploads/videos/${date}/${uuid}.mp4`;
  } else {
    return fail(c, "未知的上传类型");
  }

  await c.env.R2.put(key, file.stream(), { httpMetadata: { contentType } });

  // 若附带缩略图，存储为 _w1200.jpg（不阻塞原图已写入）
  let hasThumb = false;
  if (kind === "image" && thumb instanceof File && thumb.size > 0) {
    const thumbKey = key.replace(/(\.[^.]+)$/, "_w1200.jpg");
    try {
      await c.env.R2.put(thumbKey, thumb.stream(), { httpMetadata: { contentType: "image/jpeg" } });
      hasThumb = true;
    } catch {
      // 缩略图写入失败不影响原图上传
    }
  }

  const s = await getSettings(c.env.DB);
  return ok(c, { key, src: keyToSrc(key, s.r2_domain), content_type: contentType, size: file.size, has_thumb: hasThumb }, "上传成功");
});

/**
 * GET /api/admin/settings  管理员读取完整配置
 * PUT /api/admin/settings  更新配置（白名单字段，空串忽略）
 */
app.get("/settings", requireAdmin, async c => {
  return ok(c, await getSettings(c.env.DB));
});

app.put("/settings", requireAdmin, async c => {
  let patch: Record<string, unknown>;
  try {
    patch = (await c.req.json()) as Record<string, unknown>;
  } catch {
    return fail(c, "请求格式错误", 400);
  }
  if (typeof patch !== "object" || patch === null) return fail(c, "请求格式错误", 400);
  // 后台入口路径单独严格校验，非法格式直接拒绝（避免把后台锁死在无效路径）
  if (patch.admin_path !== undefined) {
    const p = normalizeAdminPath(patch.admin_path);
    if (!p) return fail(c, "后台入口路径格式非法（需为 /admin 或 /sys- 开头 4-24 位字母数字）", 400);
    patch.admin_path = p;
  }
  const settings = await updateSettings(c.env.DB, patch);
  return ok(c, settings, "已保存");
});

/**
 * GET /api/admin/comments?limit=  全站最新评论（后台管理用）
 */
app.get("/comments", requireAdmin, async c => {
  const limit = Math.min(200, Math.max(1, Number(c.req.query("limit")) || 100));
  const rows = await c.env.DB.prepare(
    `SELECT c.id, c.target_type, c.target_id, c.parent_id, c.nickname, c.content, c.is_owner, c.is_ai, c.created_at,
            CASE WHEN c.target_type = 'post' THEN p.title
                 ELSE substr(replace(replace(m.content, char(10), ' '), char(13), ''), 1, 60)
            END AS target_excerpt,
            p.slug AS post_slug
     FROM comments c
     LEFT JOIN moments m ON c.target_type = 'moment' AND m.id = c.target_id
     LEFT JOIN posts p ON c.target_type = 'post' AND p.id = c.target_id
     ORDER BY c.id DESC LIMIT ?`
  )
    .bind(limit)
    .all<{
      id: number;
      target_type: "moment" | "post";
      target_id: number;
      parent_id: number;
      nickname: string;
      content: string;
      is_owner: number;
      is_ai: number;
      created_at: string;
      target_excerpt: string;
      post_slug: string | null;
    }>();
  const list = (rows.results ?? []).map(r => ({ ...r, is_owner: r.is_owner === 1 }));
  return ok(c, { list });
});

/** DELETE /api/admin/comments/:cid 按 id 删除评论（自动识别说说/文章及整楼回复） */
app.delete("/comments/:cid", requireAdmin, async c => {
  const commentId = Number(c.req.param("cid"));
  if (!Number.isFinite(commentId)) return fail(c, "无效的 ID", 400);
  if (!(await deleteCommentAnywhere(c.env.DB, commentId))) return fail(c, "评论不存在", 404);
  return ok(c, { id: commentId }, "已删除");
});

/** PUT /api/admin/comments/:cid 编辑评论内容（后台管理用） */
app.put("/comments/:cid", requireAdmin, async c => {
  const commentId = Number(c.req.param("cid"));
  if (!Number.isFinite(commentId)) return fail(c, "无效的 ID", 400);
  let content = "";
  try {
    const body = await c.req.json<{ content?: unknown }>();
    content = String(body.content ?? "");
  } catch {
    return fail(c, "请求格式错误", 400);
  }
  if (!content.trim()) return fail(c, "评论内容不能为空", 400);
  const updated = await editCommentAnywhere(c.env.DB, commentId, content);
  if (!updated) return fail(c, "评论不存在", 404);
  return ok(c, updated, "已更新");
});

export default app;
