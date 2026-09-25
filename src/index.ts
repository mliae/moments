/**
 * moments Worker 入口
 * - /api/*   Hono API（动态/文章/社交/管理）
 * - /media/* R2 对象流式输出（Range）
 * - HTML 路由（/ /posts /post/:slug /photos /admin）：SSR 注入 SEO meta/JSON-LD/文章正文
 * - robots.txt / sitemap.xml / rss.xml
 * - 其余     静态资源由 wrangler assets 服务；SPA 深链兜底 index.html
 */
import { Hono } from "hono";
import type { Context } from "hono";
import type { HonoEnv } from "./types";
import { ok, fail } from "./respond";
import { serveMedia } from "./media";
import adminRoutes from "./routes/admin";
import momentRoutes from "./routes/moments";
import socialRoutes from "./routes/social";
import postRoutes from "./routes/posts";
import feedRoutes from "./routes/feed";
import musicRoutes from "./routes/music";
import miscRoutes from "./routes/misc";
import photoRoutes, { adminPhotoRoutes } from "./routes/photos";
import friendRoutes, { adminFriendRoutes } from "./routes/friends";
import searchRoutes from "./routes/search";
import indexnowAdminRoutes from "./routes/indexnow";
import { getSettings } from "./settings";
import { keyToSrc, ensureSchema, type PostRow } from "./db";
import { isAdmin, hasAdminPassword } from "./auth";
import {
  buildSeoHead,
  websiteJsonLd,
  blogJsonLd,
  collectionJsonLd,
  postJsonLd,
  renderPostSsr,
  robotsTxt,
  sitemapXml,
  rssXml,
  absoluteUrl,
} from "./seo";

const app = new Hono<HonoEnv>();

/* 首次请求时自动建表（一键部署场景：自动 provisioning 只创建空 D1，不跑 migrations）。
 * 幂等：表已存在时跳过；模块级 Promise 缓存，同一 Worker 隔离体内只跑一次。 */
app.use("*", async (c, next) => {
  await ensureSchema(c.env.DB);
  await next();
});

/* ==================== 规范域名跳转 ====================
 * 保证 http→https、www→非 www 全部 301 到后台 site_domain 指定的规范主机，
 * 保留原路径与查询串（SEO 友好 + Cookie/资源同源一致）。
 * 快速路径：已是 https 且非 www 前缀时直接放行，不查 D1，零额外开销。
 * workers.dev 调试子域不参与规范化。
 */
app.use("*", async (c, next) => {
  const url = new URL(c.req.url);
  const host = url.host.toLowerCase();
  if (url.protocol === "https:" && !host.startsWith("www.")) return next();
  const s = await getSettings(c.env.DB);
  let canonical: string | null = null;
  if (s.site_domain) {
    try {
      canonical = new URL(s.site_domain).host.toLowerCase();
    } catch {
      canonical = null;
    }
  }
  // 未配置规范域或访问的是 workers.dev 调试子域：只做 http→https，不动主机名
  const targetHost = canonical && !host.endsWith(".workers.dev") ? canonical : host;
  const needsRedirect = url.protocol !== "https:" || host !== targetHost;
  if (!needsRedirect) return next();
  const dest = `https://${targetHost}${url.pathname}${url.search}`;
  const status = c.req.method === "GET" || c.req.method === "HEAD" ? 301 : 308;
  return c.redirect(dest, status);
});

app.get("/api/health", c => ok(c, { site: c.env.SITE_NAME ?? "moments", time: new Date().toISOString() }));

// 公开站点配置（横幅文案/站名等）；admin_path 等敏感字段不下发
// 设置变更频率低：浏览器缓存 60s + Cloudflare 边缘缓存 5min（边缘命中不消耗 Worker 请求额度）
app.get("/api/settings", async c => {
  const s = await getSettings(c.env.DB);
  // 私密字段绝不下发：后台入口、apihz 凭证、QQ 登录态
  const {
    admin_path: _h1, apihz_id: _h2, apihz_key: _h3, qq_ckqq: _h4, qq_skey: _h5, qq_pskey: _h6,
    indexnow_key: _h7,
    ...publicSettings
  } = s;
  void [_h1, _h2, _h3, _h4, _h5, _h6, _h7];
  const res = ok(c, publicSettings);
  res.headers.set("Cache-Control", "public, max-age=60, s-maxage=300");
  return res;
});

app.route("/api/photos", photoRoutes);
app.route("/api/admin/photos", adminPhotoRoutes);
app.route("/api/friends", friendRoutes);
app.route("/api/admin/friends", adminFriendRoutes);
app.route("/api/admin", adminRoutes);
app.route("/api/moments", momentRoutes);
app.route("/api/moments", socialRoutes);
app.route("/api/posts", postRoutes);
app.route("/api/feed", feedRoutes);
app.route("/api/music", musicRoutes);
app.route("/api", miscRoutes);
app.route("/api/search", searchRoutes);
app.route("/api/admin/indexnow", indexnowAdminRoutes);

app.get("/media/*", serveMedia);

/* ==================== 外链图片反向代理 ====================
 * 部分图床/资源站域名在国内网络被 TLS 阻断（DNS 正常但握手失败），
 * 浏览器直连封面永远加载失败。由 Worker 在 Cloudflare 网络内回源取图，
 * 浏览器只访问自家域名；边缘缓存 7 天，回源一次后几乎零成本。
 * 安全：仅 http(s)、拦截内网字面量地址、只回 image/*、上限 15MB。
 */
const MAX_IMG_PROXY = 15 * 1024 * 1024;

function isBlockedHost(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local") || h.endsWith(".internal")) return true;
  // IPv4 内网/保留段
  const m = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (m) {
    const [a, b] = [Number(m[1]), Number(m[2])];
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT 100.64/10
    if (a === 169 && b === 254) return true; // 链路本地（含云 metadata）
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && (b === 168 || b === 0)) return true;
    if (a >= 224) return true; // 组播/保留
  }
  // IPv6 回环/链路本地/唯一本地
  if (h === "::1" || h === "::" || h.startsWith("fe80:") || h.startsWith("fc") || h.startsWith("fd")) return true;
  return false;
}

app.get("/imgproxy", async c => {
  const raw = c.req.query("u");
  if (!raw) return c.text("missing u", 400);
  // 防盗用：只接受页面内 <img> 请求（Sec-Fetch-Dest: image）或同源 Referer/Origin，
  // 阻止第三方把本 Worker 当开放图床代理刷请求额度。旧浏览器无 Sec-Fetch 头时
  // 一般会带 Referer，三者全缺才拒绝。
  const selfHost = new URL(c.req.url).host;
  const fetchDest = c.req.header("sec-fetch-dest") || "";
  const referer = c.req.header("referer") || "";
  const origin = c.req.header("origin") || "";
  const hostOf = (s: string) => { try { return new URL(s).host; } catch { return ""; } };
  const sameOrigin = hostOf(referer) === selfHost || hostOf(origin) === selfHost;
  if (fetchDest !== "image" && !sameOrigin) return c.text("forbidden", 403);

  let target: URL;
  try {
    target = new URL(raw);
  } catch {
    return c.text("bad url", 400);
  }
  if (target.protocol !== "http:" && target.protocol !== "https:") return c.text("bad scheme", 400);
  if (isBlockedHost(target.hostname)) return c.text("forbidden", 403);

  const cache = caches.default;
  const cached = await cache.match(c.req.raw);
  if (cached) return cached;

  let upstream: Response;
  try {
    upstream = await fetch(target.toString(), {
      redirect: "follow",
      headers: {
        // 部分图床校验 Referer/UA，带源站 Origin 的常规浏览器标识
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
        Referer: target.origin + "/",
        Accept: "image/avif,image/webp,image/*,*/*;q=0.8",
      },
      cf: { cacheTtl: 604800, cacheEverything: true },
    });
  } catch {
    return c.text("upstream fetch failed", 502);
  }
  if (!upstream.ok || upstream.status === 404) {
    return c.text("upstream error", upstream.status === 404 ? 404 : 502);
  }
  const ct = (upstream.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
  if (!ct.startsWith("image/")) return c.text("not an image", 415);
  // 声明长度超限直接拒绝；未声明长度时读完整 body 再校验（防 chunked 绕过）。
  // 封面图通常 <1MB，15MB 内 ArrayBuffer 对 Worker 内存无压力。
  const declaredLen = Number(upstream.headers.get("content-length") ?? 0);
  if (declaredLen && declaredLen > MAX_IMG_PROXY) return c.text("too large", 413);
  const buf = await upstream.arrayBuffer();
  if (buf.byteLength > MAX_IMG_PROXY) return c.text("too large", 413);

  const res = new Response(buf, {
    status: 200,
    headers: {
      "content-type": ct,
      "cache-control": "public, max-age=86400, s-maxage=604800, immutable",
    },
  });
  c.executionCtx.waitUntil(cache.put(c.req.raw, res.clone()));
  return res;
});

/* ==================== SEO 静态文件 ==================== */

async function publishedPosts(db: D1Database, limit = 500): Promise<PostRow[]> {
  const rows = await db
    .prepare(`SELECT * FROM posts WHERE status = 'published' ORDER BY id DESC LIMIT ?`)
    .bind(limit)
    .all<PostRow>();
  return rows.results ?? [];
}

app.get("/robots.txt", async c => {
  const origin = new URL(c.req.url).origin;
  return c.text(robotsTxt(origin), 200, { "content-type": "text/plain; charset=utf-8" });
});

app.get("/sitemap.xml", async c => {
  const origin = new URL(c.req.url).origin;
  const posts = await publishedPosts(c.env.DB);
  return c.text(sitemapXml(origin, posts), 200, { "content-type": "application/xml; charset=utf-8" });
});

app.get("/rss.xml", async c => {
  const origin = new URL(c.req.url).origin;
  const s = await getSettings(c.env.DB);
  const posts = await publishedPosts(c.env.DB, 50);
  return c.text(rssXml(origin, s, posts), 200, {
    "content-type": "application/rss+xml; charset=utf-8",
  });
});

// /feed 作为 RSS 订阅源别名（通用惯例），与 /rss.xml 输出一致
app.get("/feed", async c => {
  const origin = new URL(c.req.url).origin;
  const s = await getSettings(c.env.DB);
  const posts = await publishedPosts(c.env.DB, 50);
  return c.text(rssXml(origin, s, posts), 200, {
    "content-type": "application/rss+xml; charset=utf-8",
  });
});

// IndexNow key 校验文件：搜索引擎抓取此文件验证 key 归属；未配置 key 时返回 404
app.get("/indexnow-key.txt", async c => {
  const s = await getSettings(c.env.DB);
  const key = (s.indexnow_key || "").trim();
  if (!key) return c.text("Not Found", 404);
  return c.text(key, 200, { "content-type": "text/plain; charset=utf-8" });
});

/* ==================== HTML SSR ==================== */

// index.html 短缓存（30s），减少对 ASSETS 的重复子请求；发布后最多 30s 生效
let indexCache: { at: number; text: string } | null = null;
async function getIndexHtml(c: Context<HonoEnv>): Promise<string> {
  const now = Date.now();
  if (indexCache && now - indexCache.at < 30_000) return indexCache.text;
  const res = await c.env.ASSETS.fetch(new URL("/index.html", c.req.url).toString());
  const text = await res.text();
  indexCache = { at: now, text };
  return text;
}

const TITLE_TAG = "<title>Moments</title>";
const DESC_TAG = '<meta name="description" content="朋友圈式轻博客：图文动态与文章" />';
const ICON_TAG = `<link rel="icon" href="${iconToHref("")}" />`;
const HEAD_MARK = "<!--SSR_HEAD-->";
const APP_MARK = '<main id="app" class="page-main"></main>';

/** 站点图标值 → favicon href：URL 直接用；空=默认 lucide pen-nib SVG（不再用 emoji） */
function iconToHref(v: string): string {
  const val = String(v || "").trim();
  if (/^https?:\/\//i.test(val)) return val;
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23888' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><path d='M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z'/><path d='m15 5 4 4'/></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

async function serveSsr(
  c: Context<HonoEnv>,
  html: string,
  opts: { title: string; description: string; head: string; body?: string; status?: number }
) {
  // 首屏无闪烁：SSR 时把 favicon 替换为后台配置的站点图标
  const s = await getSettings(c.env.DB);
  const out = html
    .replace(TITLE_TAG, () => `<title>${opts.title}</title>`)
    .replace(DESC_TAG, () => `<meta name="description" content="${opts.description}" />`)
    .replace(ICON_TAG, () => `<link rel="icon" href="${iconToHref(s.site_icon)}" />`)
    .replace(HEAD_MARK, () => opts.head)
    .replace(APP_MARK, () => `<main id="app" class="page-main">${opts.body ?? ""}</main>`);
  return c.html(out, (opts.status ?? 200) as 200, {
    "cache-control": "public, max-age=0, must-revalidate",
  });
}

app.get("/", async c => {
  const s = await getSettings(c.env.DB);
  const origin = new URL(c.req.url).origin;
  const html = await getIndexHtml(c);
  const image = /^https?:\/\//i.test(s.banner_bg_image || "")
    ? s.banner_bg_image
    : s.banner_bg_image
      ? absoluteUrl(origin, s.banner_bg_image, s.site_domain)
      : "";
  const head = buildSeoHead(origin, {
    title: s.site_title,
    description: s.essay_subtitle,
    path: "/",
    image,
    siteName: s.site_title,
    jsonLd: websiteJsonLd(origin, s),
  });
  return serveSsr(c, html, { title: s.site_title, description: s.essay_subtitle, head });
});

app.get("/posts", async c => {
  const s = await getSettings(c.env.DB);
  const origin = new URL(c.req.url).origin;
  const posts = await publishedPosts(c.env.DB);
  const title = `文章 · ${s.site_title}`;
  const description = `${s.site_title} 的全部文章，共 ${posts.length} 篇`;
  const head = buildSeoHead(origin, {
    title,
    description,
    path: "/posts",
    siteName: s.site_title,
    jsonLd: blogJsonLd(origin, s, posts),
  });
  const html = await getIndexHtml(c);
  return serveSsr(c, html, { title, description, head });
});

app.get("/photos", async c => {
  const s = await getSettings(c.env.DB);
  const origin = new URL(c.req.url).origin;
  const countRow = await c.env.DB
    .prepare(`SELECT COUNT(*) AS n FROM photos WHERE visible = 1`)
    .first<{ n: number }>();
  const count = Number(countRow?.n ?? 0);
  const title = `相册 · ${s.site_title}`;
  const description = `${s.site_title} 的相册，共 ${count} 张图片`;
  const head = buildSeoHead(origin, {
    title,
    description,
    path: "/photos",
    siteName: s.site_title,
    jsonLd: collectionJsonLd(origin, s, count),
  });
  const html = await getIndexHtml(c);
  return serveSsr(c, html, { title, description, head });
});

app.get("/links", async c => {
  const s = await getSettings(c.env.DB);
  const origin = new URL(c.req.url).origin;
  const countRow = await c.env.DB.prepare(`SELECT COUNT(*) AS n FROM friends WHERE status = 'approved'`).first<{ n: number }>();
  const count = Number(countRow?.n ?? 0);
  const title = `友链 · ${s.site_title}`;
  const description = `${s.site_title} 的友链，共收录 ${count} 个优秀站点`;
  const head = buildSeoHead(origin, {
    title,
    description,
    path: "/links",
    siteName: s.site_title,
    jsonLd: collectionJsonLd(origin, s, count),
  });
  const html = await getIndexHtml(c);
  return serveSsr(c, html, { title, description, head });
});

app.get("/links/apply", async c => {
  const s = await getSettings(c.env.DB);
  const origin = new URL(c.req.url).origin;
  const title = `申请友链 · ${s.site_title}`;
  const description = `向 ${s.site_title} 申请交换友情链接`;
  const head = buildSeoHead(origin, {
    title,
    description,
    path: "/links/apply",
    siteName: s.site_title,
    noindex: true,
  });
  const html = await getIndexHtml(c);
  return serveSsr(c, html, { title, description, head });
});

/** 后台入口 HTML：noindex + x-admin-entry 标记（前端据此渲染解锁页；路径本身即凭证）。
 *  首次部署且未设密码时，追加 x-admin-setup=1 标记，前端渲染"设置初始密码"表单。 */
async function serveAdminEntry(c: Context<HonoEnv>, path: string): Promise<Response> {
  const s = await getSettings(c.env.DB);
  const origin = new URL(c.req.url).origin;
  const needsSetup = !(await hasAdminPassword(c.env.DB, c.env.ADMIN_PASSWORD));
  const head =
    buildSeoHead(origin, {
      title: s.site_title,
      description: "",
      path,
      siteName: s.site_title,
      noindex: true,
    }) +
    '\n    <meta name="x-admin-entry" content="1" />' +
    (needsSetup ? '\n    <meta name="x-admin-setup" content="1" />' : "");
  const html = await getIndexHtml(c);
  return serveSsr(c, html, { title: s.site_title, description: "", head });
}

app.get("/admin", async c => {
  const s = await getSettings(c.env.DB);
  // 已启用秘密入口：已登录管理员跳转到真实入口，其余人得到 404（后台对扫描器隐形）
  if (s.admin_path !== "/admin") {
    if (await isAdmin(c)) return c.redirect(s.admin_path, 302);
    const origin = new URL(c.req.url).origin;
    const head =
      buildSeoHead(origin, {
        title: `页面不存在 · ${s.site_title}`,
        description: "",
        path: "/admin",
        siteName: s.site_title,
        noindex: true,
      }) + '\n    <meta name="x-admin-entry" content="0" />';
    const html = await getIndexHtml(c);
    return serveSsr(c, html, { title: `页面不存在 · ${s.site_title}`, description: "页面不存在", head, status: 404 });
  }
  return serveAdminEntry(c, "/admin");
});

app.get("/post/:slug", async c => {
  const s = await getSettings(c.env.DB);
  const origin = new URL(c.req.url).origin;
  const slug = c.req.param("slug");
  const post = await c.env.DB.prepare(`SELECT * FROM posts WHERE slug = ?`).bind(slug).first<PostRow>();

  const html = await getIndexHtml(c);
  if (!post || post.status !== "published") {
    // 不存在/草稿：404 + noindex，前端继续走 SPA（管理员预览靠 ?preview=1 客户端鉴权）
    const head = buildSeoHead(origin, {
      title: `文章不存在 · ${s.site_title}`,
      description: "",
      path: "/post/" + encodeURIComponent(slug),
      siteName: s.site_title,
      noindex: true,
    });
    return serveSsr(c, html, {
      title: `文章不存在 · ${s.site_title}`,
      description: "文章不存在或尚未发布",
      head,
      status: 404,
    });
  }

  const countRow = await c.env.DB
    .prepare(`SELECT COUNT(*) AS n FROM comments WHERE target_type = 'post' AND target_id = ?`)
    .bind(post.id)
    .first<{ n: number }>();
  const title = `${post.title} · ${s.site_title}`;
  const image = post.cover ? absoluteUrl(origin, keyToSrc(post.cover, s.r2_domain), s.site_domain) : "";
  const head = buildSeoHead(origin, {
    title,
    description: post.excerpt,
    path: "/post/" + encodeURIComponent(post.slug),
    image,
    siteName: s.site_title,
    type: "article",
    jsonLd: postJsonLd(origin, s, post),
  });
  const body = renderPostSsr(post, Number(countRow?.n ?? 0), s.video_default_poster, s.r2_domain);
  return serveSsr(c, html, { title, description: post.excerpt, head, body });
});

app.notFound(async c => {
  const path = new URL(c.req.url).pathname;
  if (path.startsWith("/api/") || path.startsWith("/media/")) return fail(c, "接口不存在", 404);
  // 秘密后台入口（任意路径由 wrangler run_worker_first 的 /* 兜底到 Worker，
  // 但没有注册对应路由，因此落到这里）。
  // 前置过滤：仅对「单段、无扩展名」的路径查库，避免每个静态资源请求都打 D1。
  if (
    c.req.method === "GET" &&
    !path.includes(".") &&
    /^\/[a-z0-9-]{3,40}$/i.test(path)
  ) {
    const s = await getSettings(c.env.DB);
    if (s.admin_path === path) return serveAdminEntry(c, path);
  }
  // 非 API：交给 assets（SPA 兜底由 wrangler not_found_handling 处理）
  return c.env.ASSETS.fetch(c.req.raw);
});

app.onError((err, c) => {
  console.error(`[moments] ${c.req.method} ${new URL(c.req.url).pathname}`, err);
  return fail(c, "服务器开小差了", 500);
});

export default app;
