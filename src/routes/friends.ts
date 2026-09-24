/**
 * 友情链接路由
 * 公开：
 *   GET  /api/friends              已上架友站（可按 category 筛选），含统计
 *   POST /api/friends/apply        访客提交友链申请（status=pending，待后台审核）
 *   GET  /api/friends/info?url=    抓取目标站点的 名称/描述/图标（用于表单自动回填）
 * 管理（/api/admin/friends）：
 *   GET    /                       全部友站（含待审核/已拒绝）
 *   POST   /                       新增（直接上架）
 *   PUT    /:id                    编辑
 *   DELETE /:id                    删除
 *   POST   /:id/approve            审核通过
 *   POST   /:id/reject             拒绝
 */
import { Hono } from "hono";
import { ok, fail } from "../respond";
import type { HonoEnv } from "../types";
import { requireAdmin } from "../auth";
import { getSettings } from "../settings";

const app = new Hono<HonoEnv>();

export interface FriendRow {
  id: number;
  name: string;
  url: string;
  description: string;
  avatar: string;
  category: string;
  email: string;
  sort_order: number;
  status: string;
  last_checked: string;
  created_at: string;
  updated_at: string;
}

function serializeFriend(row: FriendRow) {
  return {
    id: row.id,
    name: row.name ?? "",
    url: row.url ?? "",
    description: row.description ?? "",
    avatar: row.avatar ?? "",
    category: row.category ?? "",
    email: row.email ?? "",
    sort_order: Number(row.sort_order ?? 0),
    status: row.status ?? "approved",
    last_checked: row.last_checked ?? "",
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

/* ==================== 公开接口 ==================== */

/** 已上架友站列表 + 统计（友站总数 / 分类数 / 本月新增） */
app.get("/", async c => {
  const category = String(c.req.query("category") || "").trim();
  const s = await getSettings(c.env.DB);

  let where = `WHERE status = 'approved'`;
  const binds: (string | number)[] = [];
  if (category && category !== "全部") {
    where += ` AND category = ?`;
    binds.push(category);
  }
  const list = (
    await c.env.DB
      .prepare(
        `SELECT * FROM friends ${where} ORDER BY sort_order ASC, id DESC`
      )
      .bind(...binds)
      .all<FriendRow>()
  ).results.map(serializeFriend);

  // 统计基于全部已上架
  const totalRow = await c.env.DB
    .prepare(`SELECT COUNT(*) AS n FROM friends WHERE status = 'approved'`)
    .first<{ n: number }>();
  const catRow = await c.env.DB
    .prepare(`SELECT COUNT(DISTINCT category) AS n FROM friends WHERE status = 'approved' AND category != ''`)
    .first<{ n: number }>();
  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);
  const newRow = await c.env.DB
    .prepare(`SELECT COUNT(*) AS n FROM friends WHERE status = 'approved' AND created_at >= ?`)
    .bind(monthStart.toISOString())
    .first<{ n: number }>();

  const categories = String(s.links_categories || "")
    .split(/\r?\n/)
    .map(l => l.trim())
    .filter(Boolean);

  return ok(c, {
    list,
    stats: {
      total: Number(totalRow?.n ?? 0),
      categories: Number(catRow?.n ?? 0),
      newThisMonth: Number(newRow?.n ?? 0),
    },
    categories,
  });
});

/** 抓取目标站点信息：名称/描述/图标（不写库，仅返回供表单回填） */
app.get("/info", async c => {
  const raw = String(c.req.query("url") || "").trim();
  const info = await fetchSiteInfo(raw);
  if (!info) return fail(c, "无法获取该站点信息，请检查网址或手动填写", 400);
  return ok(c, info);
});

/** 访客提交友链申请 */
app.post("/apply", async c => {
  let body: Record<string, unknown>;
  try {
    body = (await c.req.json()) as Record<string, unknown>;
  } catch {
    return fail(c, "请求格式错误", 400);
  }
  const name = String(body.name ?? "").trim().slice(0, 60);
  const url = normalizeUrl(String(body.url ?? "").trim());
  const description = String(body.description ?? "").trim().slice(0, 300);
  const email = String(body.email ?? "").trim().slice(0, 120);
  const avatar = String(body.avatar ?? "").trim().slice(0, 500);
  const category = String(body.category ?? "").trim().slice(0, 30);

  if (!name) return fail(c, "请填写站点名称", 400);
  if (!url) return fail(c, "请填写正确的站点地址", 400);
  if (!/^https?:\/\//i.test(url)) return fail(c, "站点地址需以 http(s):// 开头", 400);

  const now = new Date().toISOString();
  const info = await fetchSiteInfo(url); // 尽力抓取，失败不阻塞
  const row = await c.env.DB.prepare(
    `INSERT INTO friends (name, url, description, avatar, category, email, sort_order, status, last_checked, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 0, 'pending', ?, ?, ?) RETURNING *`
  )
    .bind(
      info?.name || name,
      url,
      info?.description || description,
      avatar || info?.avatar || "",
      category,
      email,
      now,
      now,
      now
    )
    .first<FriendRow>();
  return ok(c, { id: row?.id, status: "pending" }, "已提交，站长审核通过后会出现在友链列表");
});

/* ==================== 后台接口 ==================== */

const admin = new Hono<HonoEnv>();

admin.get("/", requireAdmin, async c => {
  const status = String(c.req.query("status") || "").trim();
  let where = "";
  const binds: (string | number)[] = [];
  if (status === "pending" || status === "approved" || status === "rejected") {
    where = "WHERE status = ?";
    binds.push(status);
  }
  const rows = (
    await c.env.DB
      .prepare(`SELECT * FROM friends ${where} ORDER BY sort_order ASC, id DESC`)
      .bind(...binds)
      .all<FriendRow>()
  ).results;
  const pending = (await c.env.DB.prepare(`SELECT COUNT(*) AS n FROM friends WHERE status = 'pending'`).first<{ n: number }>())?.n ?? 0;
  return ok(c, { list: rows.map(serializeFriend), pending_count: Number(pending) });
});

admin.post("/", requireAdmin, async c => {
  let body: Record<string, unknown>;
  try {
    body = (await c.req.json()) as Record<string, unknown>;
  } catch {
    return fail(c, "请求格式错误", 400);
  }
  const name = String(body.name ?? "").trim().slice(0, 60);
  const url = normalizeUrl(String(body.url ?? "").trim());
  if (!name || !url) return fail(c, "名称和地址必填", 400);
  const now = new Date().toISOString();
  const row = await c.env.DB.prepare(
    `INSERT INTO friends (name, url, description, avatar, category, email, sort_order, status, last_checked, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'approved', ?, ?, ?) RETURNING *`
  )
    .bind(
      name,
      url,
      String(body.description ?? "").slice(0, 500),
      String(body.avatar ?? "").slice(0, 500),
      String(body.category ?? "").slice(0, 30),
      String(body.email ?? "").slice(0, 120),
      Number(body.sort_order) || 0,
      now,
      now,
      now
    )
    .first<FriendRow>();
  return ok(c, serializeFriend(row as FriendRow), "已添加");
});

admin.put("/:id", requireAdmin, async c => {
  const id = Number(c.req.param("id"));
  if (!Number.isFinite(id)) return fail(c, "无效的 ID", 400);
  const existing = await c.env.DB.prepare(`SELECT * FROM friends WHERE id = ?`).bind(id).first<FriendRow>();
  if (!existing) return fail(c, "友站不存在", 404);
  let body: Record<string, unknown>;
  try {
    body = (await c.req.json()) as Record<string, unknown>;
  } catch {
    return fail(c, "请求格式错误", 400);
  }
  const name = body.name !== undefined ? String(body.name).trim().slice(0, 60) : existing.name;
  const url = body.url !== undefined ? normalizeUrl(String(body.url).trim()) || existing.url : existing.url;
  const description = body.description !== undefined ? String(body.description).slice(0, 500) : existing.description;
  const avatar = body.avatar !== undefined ? String(body.avatar).slice(0, 500) : existing.avatar;
  const category = body.category !== undefined ? String(body.category).slice(0, 30) : existing.category;
  const email = body.email !== undefined ? String(body.email).slice(0, 120) : existing.email;
  const sort_order = body.sort_order !== undefined ? Number(body.sort_order) || 0 : existing.sort_order;
  let status = existing.status;
  if (body.status !== undefined && ["pending", "approved", "rejected"].includes(String(body.status))) {
    status = String(body.status);
  }
  await c.env.DB.prepare(
    `UPDATE friends SET name=?, url=?, description=?, avatar=?, category=?, email=?, sort_order=?, status=?, updated_at=? WHERE id=?`
  )
    .bind(name, url, description, avatar, category, email, sort_order, status, new Date().toISOString(), id)
    .run();
  const updated = await c.env.DB.prepare(`SELECT * FROM friends WHERE id = ?`).bind(id).first<FriendRow>();
  return ok(c, serializeFriend(updated as FriendRow), "已更新");
});

admin.delete("/:id", requireAdmin, async c => {
  const id = Number(c.req.param("id"));
  if (!Number.isFinite(id)) return fail(c, "无效的 ID", 400);
  const existing = await c.env.DB.prepare(`SELECT id FROM friends WHERE id = ?`).bind(id).first<{ id: number }>();
  if (!existing) return fail(c, "友站不存在", 404);
  await c.env.DB.prepare(`DELETE FROM friends WHERE id = ?`).bind(id).run();
  return ok(c, { id }, "已删除");
});

admin.post("/:id/approve", requireAdmin, async c => {
  const id = Number(c.req.param("id"));
  await c.env.DB.prepare(`UPDATE friends SET status='approved', updated_at=? WHERE id=?`).bind(new Date().toISOString(), id).run();
  return ok(c, { id, status: "approved" }, "已通过");
});

admin.post("/:id/reject", requireAdmin, async c => {
  const id = Number(c.req.param("id"));
  await c.env.DB.prepare(`UPDATE friends SET status='rejected', updated_at=? WHERE id=?`).bind(new Date().toISOString(), id).run();
  return ok(c, { id, status: "rejected" }, "已拒绝");
});

/* ==================== 抓取站点信息 ==================== */

function isBlockedHost(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local") || h.endsWith(".internal")) return true;
  const m = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (m) {
    const [a, b] = [Number(m[1]), Number(m[2])];
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && (b === 168 || b === 0)) return true;
    if (a >= 224) return true;
  }
  if (h === "::1" || h === "::" || h.startsWith("fe80:") || h.startsWith("fc") || h.startsWith("fd")) return true;
  return false;
}

function normalizeUrl(raw: string): string {
  let v = raw.trim();
  if (!v) return "";
  if (!/^https?:\/\//i.test(v)) v = "https://" + v;
  try {
    const u = new URL(v);
    if (u.protocol !== "http:" && u.protocol !== "https:") return "";
    if (isBlockedHost(u.hostname)) return "";
    return u.toString();
  } catch {
    return "";
  }
}

/** 抓取目标站首页，解析 title / description / favicon。失败返回 null。 */
async function fetchSiteInfo(rawUrl: string): Promise<{ name: string; description: string; avatar: string; url: string } | null> {
  const url = normalizeUrl(rawUrl);
  if (!url) return null;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  let html = "";
  try {
    const res = await fetch(url, {
      redirect: "follow",
      signal: ctrl.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml",
      },
    });
    if (!res.ok) return null;
    html = await res.text();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
  if (!html) return null;

  let base = url;
  const baseMatch = html.match(/<base[^>]+href=["']([^"']+)["']/i);
  if (baseMatch) {
    try { base = new URL(baseMatch[1], url).toString(); } catch { /* keep url */ }
  }

  const name = (() => {
    const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    return m ? m[1].replace(/\s+/g, " ").trim().slice(0, 80) : "";
  })();
  const description = (() => {
    const m = html.match(/<meta[^>]+name=["']description["'][^>]*content=["']([^"']*)["']/i)
      || html.match(/<meta[^>]+content=["']([^"']*)["'][^>]*name=["']description["']/i);
    return m ? m[1].replace(/\s+/g, " ").trim().slice(0, 200) : "";
  })();

  const avatar = (() => {
    const iconRe = /<link[^>]+rel=["'][^"']*(?:icon|apple-touch-icon)[^"']*["'][^>]*>/gi;
    let href = "";
    let mm;
    while ((mm = iconRe.exec(html))) {
      const tag = mm[0];
      const hm = tag.match(/href=["']([^"']+)["']/i);
      if (hm && hm[1]) { href = hm[1]; break; }
    }
    if (href) {
      try { return new URL(href, base).toString(); } catch { /* fallthrough */ }
    }
    try { return new URL("/favicon.ico", base).toString(); } catch { return ""; }
  })();

  return { name, description, avatar, url };
}

export default app;
export { admin as adminFriendRoutes };
