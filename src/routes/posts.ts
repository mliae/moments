/**
 * 文章路由（前缀 /api/posts）
 * 公开：GET /          已发布文章列表（不含正文）
 *       GET /:slug     文章详情（?preview=1 管理态可看草稿）
 * 管理：POST /          新建（published/draft）
 *       PUT /:id        编辑
 *       DELETE /:id     删除
 */
import { Hono } from "hono";
import { ok, fail } from "../respond";
import type { HonoEnv } from "../types";
import { requireAdmin, isAdmin } from "../auth";
import { getSettings } from "../settings";
import { serializePost, srcToKey, type PostRow } from "../db";
import {
  parseCommentBody,
  validateCommentInput,
  createComment,
  deleteCommentThread,
  listComments,
} from "../comment-service";
import { maybeScheduleAiReply } from "../ai-reply";
import { ensureAvatar } from "../avatar";

const app = new Hono<HonoEnv>();

const MAX_TITLE = 100;
const MAX_EXCERPT = 300;
const MAX_MD = 200_000;

/** 标题 → slug：保留字母数字与中文（URL 中会被编码），其余折叠为连字符 */
function slugify(title: string): string {
  const s = title
    .trim()
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return s || "post";
}

async function slugTaken(db: D1Database, slug: string, exceptId?: number): Promise<boolean> {
  const row = exceptId
    ? await db.prepare(`SELECT 1 FROM posts WHERE slug = ? AND id <> ?`).bind(slug, exceptId).first()
    : await db.prepare(`SELECT 1 FROM posts WHERE slug = ?`).bind(slug).first();
  return !!row;
}

async function uniqueSlug(db: D1Database, title: string, exceptId?: number): Promise<string> {
  const base = slugify(title);
  let slug = base;
  let n = 1;
  while (await slugTaken(db, slug, exceptId)) {
    n += 1;
    slug = `${base}-${n}`;
  }
  return slug;
}

function plainExcerpt(md: string): string {
  return md
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^:::.*$/gm, "")
    .replace(/@\[video\]\([^)]*\)/g, "[视频]")
    .replace(/\[music=\d+\]/g, "[音乐]")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/[`*_>~#=-]+/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
}

function normalizeCover(raw: unknown): string | null {
  const cover = String(raw ?? "").trim();
  if (!cover) return "";
  if (/^https?:\/\//i.test(cover)) return cover;
  const key = cover.startsWith("/media/") ? srcToKey(cover) : /^uploads\/images\//.test(cover) ? cover : null;
  return key;
}

/** 从正文 markdown 中提取第一张图片地址（兼容 ![alt](url) 与 <img src="url">），用于无封面时自动兜底 */
function extractFirstImage(md: string): string {
  if (!md) return "";
  const mdImg = md.match(/!\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/);
  if (mdImg) return mdImg[1].trim();
  const htmlImg = md.match(/<img[^>]+src\s*=\s*["']([^"']+)["']/i);
  if (htmlImg) return htmlImg[1].trim();
  return "";
}

interface PostInput {
  title: string;
  excerpt: string;
  content_md: string;
  cover: string;
  status: "published" | "draft";
}

function validatePost(raw: unknown): PostInput | string {
  const body = (raw ?? {}) as Record<string, unknown>;
  const title = String(body.title ?? "").trim().slice(0, MAX_TITLE);
  if (!title) return "标题不能为空";
  const content_md = String(body.content_md ?? "").slice(0, MAX_MD);
  const excerptRaw = String(body.excerpt ?? "").trim().slice(0, MAX_EXCERPT);
  const excerpt = excerptRaw || plainExcerpt(content_md);
  const explicitCover = normalizeCover(body.cover);
  if (explicitCover === null) return "封面地址非法";
  // 未设置封面时，自动用正文第一张图兜底（新建/编辑均生效）
  const cover = explicitCover || normalizeCover(extractFirstImage(content_md)) || "";
  const status = body.status === "draft" ? "draft" : "published";
  if (!content_md.trim()) return "正文不能为空";
  return { title, excerpt, content_md, cover, status };
}

app.get("/", async c => {
  // 管理态返回全部（含草稿，便于继续编辑）；访客仅已发布。分页：?page=&per_page=（1-50）
  const admin = await isAdmin(c);
  const perPage = Math.min(50, Math.max(1, Number(c.req.query("per_page")) || 20));
  const page = Math.max(1, Number(c.req.query("page")) || 1);
  const where = admin ? "" : "WHERE status = 'published'";
  const total =
    (await c.env.DB.prepare(`SELECT COUNT(*) AS n FROM posts ${where}`).first<{ n: number }>())?.n ?? 0;
  const rows = (
    await c.env.DB.prepare(
      `SELECT id, slug, title, excerpt, cover, status, created_at, updated_at
       FROM posts ${where} ORDER BY id DESC LIMIT ? OFFSET ?`
    )
      .bind(perPage, (page - 1) * perPage)
      .all<PostRow>()
  ).results;
  const s = await getSettings(c.env.DB);
  return ok(c, { list: rows.map(r => serializePost(r, false, s.r2_domain)), page, per_page: perPage, total });
});

app.get("/:slug", async c => {
  const slug = c.req.param("slug");
  const preview = c.req.query("preview") === "1";
  const row = await c.env.DB.prepare(`SELECT * FROM posts WHERE slug = ?`).bind(slug).first<PostRow>();
  if (!row) return fail(c, "文章不存在", 404);
  if (row.status !== "published") {
    if (!preview || !(await isAdmin(c))) return fail(c, "文章不存在", 404);
  }
  const s = await getSettings(c.env.DB);
  return ok(c, serializePost(row, true, s.r2_domain));
});

app.post("/", requireAdmin, async c => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return fail(c, "请求格式错误", 400);
  }
  const input = validatePost(body);
  if (typeof input === "string") return fail(c, input);

  const slug = await uniqueSlug(c.env.DB, input.title);
  const now = new Date().toISOString();
  const row = await c.env.DB.prepare(
    `INSERT INTO posts (slug, title, excerpt, content_md, cover, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING *`
  )
    .bind(slug, input.title, input.excerpt, input.content_md, input.cover, input.status, now, now)
    .first<PostRow>();
  if (!row) return fail(c, "保存失败", 500);

  const s = await getSettings(c.env.DB);
  return ok(c, serializePost(row, true, s.r2_domain), "文章已保存");
});

app.put("/:id", requireAdmin, async c => {
  const id = Number(c.req.param("id"));
  if (!Number.isFinite(id)) return fail(c, "无效的 ID", 400);

  const existing = await c.env.DB.prepare(`SELECT * FROM posts WHERE id = ?`).bind(id).first<PostRow>();
  if (!existing) return fail(c, "文章不存在", 404);

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return fail(c, "请求格式错误", 400);
  }
  const input = validatePost(body);
  if (typeof input === "string") return fail(c, input);

  // 标题变化时重新生成唯一 slug；标题不变则保留原 slug（保护已分享链接）
  let slug = existing.slug;
  if (input.title !== existing.title) {
    slug = await uniqueSlug(c.env.DB, input.title, id);
  }
  const now = new Date().toISOString();
  const row = await c.env.DB.prepare(
    `UPDATE posts SET slug = ?, title = ?, excerpt = ?, content_md = ?, cover = ?, status = ?, updated_at = ?
     WHERE id = ? RETURNING *`
  )
    .bind(slug, input.title, input.excerpt, input.content_md, input.cover, input.status, now, id)
    .first<PostRow>();
  if (!row) return fail(c, "更新失败", 500);

  const s = await getSettings(c.env.DB);
  return ok(c, serializePost(row, true, s.r2_domain), "文章已更新");
});

app.delete("/:id", requireAdmin, async c => {
  const id = Number(c.req.param("id"));
  if (!Number.isFinite(id)) return fail(c, "无效的 ID", 400);
  await c.env.DB.batch([
    c.env.DB.prepare(`DELETE FROM comments WHERE target_type = 'post' AND target_id = ?`).bind(id),
    c.env.DB.prepare(`DELETE FROM posts WHERE id = ?`).bind(id),
  ]);
  return ok(c, { id }, "文章已删除");
});

/** POST /batch-delete  批量删除文章（连带评论），body: { ids: number[] } */
app.post("/batch-delete", requireAdmin, async c => {
  let ids: number[];
  try {
    const body = (await c.req.json()) as { ids?: unknown };
    ids = [...new Set((Array.isArray(body.ids) ? body.ids : []).map(Number).filter(n => Number.isInteger(n) && n > 0))].slice(0, 200);
  } catch {
    return fail(c, "请求格式错误", 400);
  }
  if (!ids.length) return fail(c, "未选择任何文章", 400);

  await c.env.DB.batch(
    ids.flatMap(id => [
      c.env.DB.prepare(`DELETE FROM comments WHERE target_type = 'post' AND target_id = ?`).bind(id),
      c.env.DB.prepare(`DELETE FROM posts WHERE id = ?`).bind(id),
    ])
  );
  return ok(c, { deleted: ids.length }, `已删除 ${ids.length} 篇文章`);
});

/* ==================== 文章评论（与说说共用 comments 表） ==================== */

/** 按 slug 解析文章：访客仅已发布；管理员不限 */
async function resolveCommentablePost(
  db: D1Database,
  slug: string,
  admin: boolean
): Promise<PostRow | null> {
  const row = await db.prepare(`SELECT * FROM posts WHERE slug = ?`).bind(slug).first<PostRow>();
  if (!row) return null;
  if (row.status !== "published" && !admin) return null;
  return row;
}

/** GET /:slug/comments 文章全部评论 */
app.get("/:slug/comments", async c => {
  const slug = c.req.param("slug");
  const admin = await isAdmin(c);
  const post = await resolveCommentablePost(c.env.DB, slug, admin);
  if (!post) return fail(c, "文章不存在", 404);
  const list = await listComments(c.env.DB, "post", post.id);
  return ok(c, { list, count: list.length });
});

/** POST /:slug/comments 发表文章评论（草稿仅管理员可评论） */
app.post("/:slug/comments", async c => {
  const slug = c.req.param("slug");
  const admin = await isAdmin(c);
  const post = await resolveCommentablePost(c.env.DB, slug, admin);
  if (!post) return fail(c, "文章不存在", 404);

  let input;
  try {
    input = parseCommentBody(await c.req.json());
  } catch {
    return fail(c, "请求格式错误", 400);
  }
  const fieldError = validateCommentInput(input);
  if (fieldError) return fail(c, fieldError);

  // 头像兜底：服务端确保头像已缓存并写入（不依赖客户端）
  const ps = await getSettings(c.env.DB);
  const ensured = await ensureAvatar(
    c.env.R2,
    ps,
    input.email || (input.qq ? `${input.qq}@qq.com` : ""),
    input.qq
  );
  if (ensured) input.avatarUrl = ensured.src;

  const result = await createComment(c.env.DB, "post", post.id, input, admin);
  if ("error" in result) return fail(c, result.error, result.status ?? 400);
  // @AI 机器人：内容含 @机器人昵称 时异步生成楼中楼回复（开关关闭/未提及均无操作）
  await maybeScheduleAiReply(c, { type: "post", targetId: post.id, comment: result.comment });
  return ok(c, { ...result.comment, is_owner: result.comment.is_owner === 1 }, "评论成功");
});

/** DELETE /:slug/comments/:cid 管理员删除文章评论 */
app.delete("/:slug/comments/:cid", requireAdmin, async c => {
  const slug = c.req.param("slug") || "";
  const commentId = Number(c.req.param("cid"));
  if (!Number.isFinite(commentId)) return fail(c, "无效的 ID", 400);
  const post = await resolveCommentablePost(c.env.DB, slug, true);
  if (!post) return fail(c, "文章不存在", 404);
  if (!(await deleteCommentThread(c.env.DB, "post", post.id, commentId))) {
    return fail(c, "评论不存在", 404);
  }
  return ok(c, { id: commentId }, "已删除");
});

export default app;
