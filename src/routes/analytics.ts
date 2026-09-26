/**
 * 访问统计：
 *  公开上报
 *   POST /api/analytics/pv     记录一次页面浏览，返回 { id }（供离开时回写停留时长）
 *   POST /api/analytics/leave  回写停留秒数（sendBeacon）
 *  后台查询（requireAdmin）
 *   GET  /api/admin/analytics/summary?days=7   总览 + 趋势 + 热门页 + 来源 + 画像
 *   GET  /api/admin/analytics/visitors?limit=50 最近访客会话（IP + 地区 + 浏览序列 + 停留）
 *
 *  设计要点：
 *  - IP 明文存储并在后台展示；地区走 ip-api.com，结果按 IP 缓存到 analytics_ip_geo（免费版 45次/分，缓存后几乎不耗）。
 *  - 管理员（已登录）的访问不计入。
 *  - 明细只保留 90 天，写入时顺带低频清理。
 */
import { Hono } from "hono";
import { ok } from "../respond";
import type { HonoEnv } from "../types";
import { getSettings } from "../settings";
import { isAdmin, requireAdmin } from "../auth";

const publicApp = new Hono<HonoEnv>();
const adminApp = new Hono<HonoEnv>();

const RETENTION_DAYS = 90;

/* ---------------- UA 解析（轻量，够后台画像用） ---------------- */
function parseUA(ua: string) {
  const u = ua || "";
  let device = "desktop";
  if (/iPad|Tablet|PlayBook|Silk/i.test(u)) device = "tablet";
  else if (/Mobi|Android|iPhone|iPod|Windows Phone|BlackBerry/i.test(u)) device = "mobile";

  let browser = "其他";
  if (/Edg\//i.test(u)) browser = "Edge";
  else if (/OPR\/|Opera/i.test(u)) browser = "Opera";
  else if (/Firefox\//i.test(u)) browser = "Firefox";
  else if (/Chrome\//i.test(u) && !/Chromium/i.test(u)) browser = "Chrome";
  else if (/Chromium/i.test(u)) browser = "Chromium";
  else if (/Safari\//i.test(u)) browser = "Safari";

  let os = "其他";
  if (/Windows NT 10/i.test(u)) os = "Windows 10/11";
  else if (/Windows/i.test(u)) os = "Windows";
  else if (/Android/i.test(u)) os = "Android";
  else if (/iPhone|iPad|iPod/i.test(u)) os = "iOS";
  else if (/Mac OS X|Macintosh/i.test(u)) os = "macOS";
  else if (/Linux/i.test(u)) os = "Linux";

  return { device, browser, os };
}

/* ---------------- IP 归属地（ip-api.com + D1 缓存） ---------------- */
interface Geo { country: string; region: string; city: string; isp: string; }

async function lookupGeo(db: D1Database, ip: string, cfCountry: string): Promise<Geo> {
  if (!ip) return { country: cfCountry || "", region: "", city: "", isp: "" };
  const cached = await db
    .prepare(`SELECT country, region, city, isp FROM analytics_ip_geo WHERE ip = ?`)
    .bind(ip)
    .first<Geo>();
  if (cached) return cached;

  let geo: Geo = { country: cfCountry || "", region: "", city: "", isp: "" };
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 2500);
    const res = await fetch(
      `http://ip-api.com/json/${encodeURIComponent(ip)}?fields=status,country,regionName,city,isp,query&lang=zh-CN`,
      { signal: ctrl.signal, headers: { "User-Agent": "moments-analytics/1.0" } }
    );
    clearTimeout(t);
    if (res.ok) {
      const j = (await res.json()) as { status?: string; country?: string; regionName?: string; city?: string; isp?: string };
      if (j.status === "success") {
        geo = { country: j.country || "", region: j.regionName || "", city: j.city || "", isp: j.isp || "" };
      }
    }
  } catch {
    // 超时/失败：回退 CF 国家头，仍缓存避免重复请求
  }
  try {
    await db
      .prepare(
        `INSERT INTO analytics_ip_geo (ip, country, region, city, isp) VALUES (?,?,?,?,?)
         ON CONFLICT(ip) DO UPDATE SET country=excluded.country, region=excluded.region, city=excluded.city, isp=excluded.isp`
      )
      .bind(ip, geo.country, geo.region, geo.city, geo.isp)
      .run();
  } catch {
    /* 缓存写入失败不影响主流程 */
  }
  return geo;
}

/* ---------------- 简易内存限流（每隔离体，防刷） ---------------- */
const rl = new Map<string, { n: number; t: number }>();
function overLimit(ip: string): boolean {
  const now = Date.now();
  const e = rl.get(ip);
  if (!e || now - e.t > 60000) { rl.set(ip, { n: 1, t: now }); return false; }
  e.n++;
  return e.n > 90; // 单 IP 每分钟上限 90 次
}

let lastPrune = 0;

/* ---------------- 上报 PV ---------------- */
publicApp.post("/pv", async c => {
  const s = await getSettings(c.env.DB);
  if (!s.analytics_enabled) return ok(c, { disabled: true });
  if (await isAdmin(c)) return ok(c, { ignored: true }); // 后台不计

  let body: Record<string, unknown> = {};
  try { body = (await c.req.json()) as Record<string, unknown>; } catch { /* 空体也接受 */ }

  const ip = c.req.header("cf-connecting-ip") || "";
  if (overLimit(ip)) return ok(c, { throttled: true });

  const cfCountry = c.req.header("cf-ipcountry") || "";
  const ua = parseUA(c.req.header("user-agent") || "");
  const clamp = (v: unknown, n: number) => String(v ?? "").slice(0, n);

  const info = await c.env.DB
    .prepare(
      `INSERT INTO analytics_pv
        (path, title, referrer, utm_source, utm_medium, utm_campaign, country, ip, device, browser, os, sid)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`
    )
    .bind(
      clamp(body.path, 300), clamp(body.title, 120), clamp(body.referrer, 500),
      clamp(body.utm_source, 60), clamp(body.utm_medium, 60), clamp(body.utm_campaign, 60),
      cfCountry, ip.slice(0, 64), ua.device, ua.browser, ua.os, clamp(body.sid, 64)
    )
    .run();
  const id = Number(info.meta?.last_row_id ?? 0);

  // 异步：补全归属地（不阻塞响应）+ 低频清理 90 天前明细
  c.executionCtx.waitUntil((async () => {
    try {
      const geo = await lookupGeo(c.env.DB, ip, cfCountry);
      if (geo.region || geo.city || geo.isp || (geo.country && geo.country !== cfCountry)) {
        await c.env.DB
          .prepare(`UPDATE analytics_pv SET country=?, region=?, city=?, isp=? WHERE id=?`)
          .bind(geo.country, geo.region, geo.city, geo.isp, id)
          .run();
      }
      const now = Date.now();
      if (now - lastPrune > 3600_000) {
        lastPrune = now;
        await c.env.DB.prepare(`DELETE FROM analytics_pv WHERE created_at < strftime('%Y-%m-%dT%H:%M:%fZ','now','-${RETENTION_DAYS} days')`).run();
      }
    } catch { /* 后台任务失败静默 */ }
  })());

  return ok(c, { id });
});

/* ---------------- 回写停留时长 ---------------- */
publicApp.post("/leave", async c => {
  let body: Record<string, unknown> = {};
  try { body = (await c.req.json()) as Record<string, unknown>; } catch { return ok(c, {}); }
  const id = Number(body.id) || 0;
  const sec = Math.max(0, Math.min(86400, Math.round(Number(body.seconds) || 0)));
  if (id > 0 && sec > 0) {
    try {
      await c.env.DB.prepare(`UPDATE analytics_pv SET duration = ? WHERE id = ? AND duration = 0`).bind(sec, id).run();
    } catch { /* 忽略 */ }
  }
  return ok(c, {});
});

/* ---------------- 后台：总览 ---------------- */
adminApp.get("/summary", requireAdmin, async c => {
  const db = c.env.DB;
  const days = Math.max(1, Math.min(90, Number(c.req.query("days")) || 7));
  const where = `created_at >= strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-${days} days')`;

  const batch = await db.batch([
    db.prepare(`SELECT COUNT(*) AS pv, COUNT(DISTINCT ip) AS uv FROM analytics_pv WHERE ${where}`),
    db.prepare(
      `SELECT date(created_at) AS d, COUNT(*) AS pv, COUNT(DISTINCT ip) AS uv FROM analytics_pv
       WHERE ${where} GROUP BY date(created_at) ORDER BY d ASC`
    ),
    db.prepare(`SELECT path, MIN(title) AS title, COUNT(*) AS n FROM analytics_pv WHERE ${where} GROUP BY path ORDER BY n DESC LIMIT 10`),
    db.prepare(`SELECT referrer, COUNT(*) AS n FROM analytics_pv WHERE ${where} AND referrer <> '' GROUP BY referrer ORDER BY n DESC LIMIT 10`),
    db.prepare(`SELECT country, COUNT(*) AS n FROM analytics_pv WHERE ${where} GROUP BY country ORDER BY n DESC LIMIT 10`),
    db.prepare(`SELECT device, COUNT(*) AS n FROM analytics_pv WHERE ${where} GROUP BY device ORDER BY n DESC`),
    db.prepare(`SELECT browser, COUNT(*) AS n FROM analytics_pv WHERE ${where} GROUP BY browser ORDER BY n DESC LIMIT 8`),
    db.prepare(`SELECT os, COUNT(*) AS n FROM analytics_pv WHERE ${where} GROUP BY os ORDER BY n DESC LIMIT 8`),
    db.prepare(`SELECT AVG(duration) AS avg FROM analytics_pv WHERE ${where} AND duration > 0`),
  ]);
  const row = batch[0].results[0] as { pv: number; uv: number };
  const avgRow = batch[8].results[0] as { avg: number | null };

  // 补齐趋势日期
  const trendMap = new Map<string, { pv: number; uv: number }>();
  for (const r of batch[1].results as Array<{ d: string; pv: number; uv: number }>) {
    trendMap.set(r.d, { pv: Number(r.pv), uv: Number(r.uv) });
  }
  const trend: Array<{ date: string; pv: number; uv: number }> = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10);
    trend.push({ date: d, ...(trendMap.get(d) ?? { pv: 0, uv: 0 }) });
  }

  const top = (i: number) => (batch[i].results as Array<Record<string, unknown>>).map(r => ({
    name: String(r.path ?? r.referrer ?? r.country ?? r.device ?? r.browser ?? r.os ?? "未知"),
    n: Number(r.n),
  }));

  return ok(c, {
    days,
    pv: Number(row?.pv ?? 0),
    uv: Number(row?.uv ?? 0),
    avgDuration: Math.round(Number(avgRow?.avg ?? 0)),
    trend,
    topPaths: (batch[2].results as Array<{ path: string; title: string | null; n: number }>).map(r => ({
      name: String(r.path),
      title: String(r.title ?? ""),
      n: Number(r.n),
    })),
    referrers: top(3),
    countries: top(4),
    devices: top(5),
    browsers: top(6),
    os: top(7),
  });
});

/* ---------------- 后台：最近访客（按会话聚合） ---------------- */
adminApp.get("/visitors", requireAdmin, async c => {
  const db = c.env.DB;
  const limit = Math.max(1, Math.min(100, Number(c.req.query("limit")) || 50));
  const rows = await db
    .prepare(
      `SELECT id, created_at, path, title, country, region, city, isp, ip, device, browser, os, sid, duration
       FROM analytics_pv ORDER BY created_at DESC, id DESC LIMIT 800`
    )
    .all<{
      id: number; created_at: string; path: string; title: string; country: string; region: string;
      city: string; isp: string; ip: string; device: string; browser: string; os: string; sid: string; duration: number;
    }>();

  const map = new Map<string, any>();
  for (const r of rows.results ?? []) {
    const sid = r.sid || `ip:${r.ip}`;
    let sess = map.get(sid);
    if (!sess) {
      sess = { sid, first: r.created_at, last: r.created_at, ip: r.ip, country: r.country, region: r.region, city: r.city, isp: r.isp, device: r.device, browser: r.browser, os: r.os, pages: [], duration: 0 };
      map.set(sid, sess);
    }
    sess.last = r.created_at;
    sess.duration += Number(r.duration) || 0;
    sess.pages.push({ path: r.path, title: r.title, at: r.created_at, dur: Number(r.duration) || 0 });
  }
  const list = [...map.values()]
    .sort((a, b) => (a.last < b.last ? 1 : -1))
    .slice(0, limit)
    .map(s => ({ ...s, pages: s.pages.reverse() })); // 最近页在前
  return ok(c, { list });
});

export { publicApp as analyticsPublicRoutes, adminApp as analyticsAdminRoutes };
export default publicApp;
