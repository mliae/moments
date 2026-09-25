/** D1 数据访问助手：行类型、序列化与聚合查询（原生 prepared statements，无 ORM） */

/* ==================== 自动建表（一键部署） ====================
 * Cloudflare 自动资源 provisioning 只创建空 D1 库，不跑 migrations。
 * 首次请求时检测 moments 表是否存在，不存在则一次性执行完整 schema
 * （合并 migrations/0001-0011 的最终状态，全部 CREATE IF NOT EXISTS，幂等）。
 * 已有库不受影响（表已存在时跳过）。
 */
const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS moments (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  content     TEXT NOT NULL DEFAULT '',
  images      TEXT NOT NULL DEFAULT '[]',
  video       TEXT NOT NULL DEFAULT '{}',
  location    TEXT NOT NULL DEFAULT '',
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS idx_moments_created ON moments (created_at DESC, id DESC);

CREATE TABLE IF NOT EXISTS posts (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  slug        TEXT NOT NULL UNIQUE,
  title       TEXT NOT NULL,
  excerpt     TEXT NOT NULL DEFAULT '',
  content_md  TEXT NOT NULL DEFAULT '',
  cover       TEXT NOT NULL DEFAULT '',
  status      TEXT NOT NULL DEFAULT 'published',
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS idx_posts_status_created ON posts (status, created_at DESC, id DESC);

CREATE TABLE IF NOT EXISTS comments (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  target_type  TEXT NOT NULL DEFAULT 'moment',
  target_id    INTEGER NOT NULL,
  parent_id    INTEGER NOT NULL DEFAULT 0,
  nickname     TEXT NOT NULL,
  content      TEXT NOT NULL,
  is_owner     INTEGER NOT NULL DEFAULT 0,
  is_ai        INTEGER NOT NULL DEFAULT 0,
  images       TEXT DEFAULT '',
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  qq           TEXT NOT NULL DEFAULT '',
  email        TEXT NOT NULL DEFAULT '',
  avatar_url   TEXT NOT NULL DEFAULT '',
  website      TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_comments_target ON comments (target_type, target_id, parent_id, id);

CREATE TABLE IF NOT EXISTS likes (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  moment_id   INTEGER NOT NULL,
  voter_id    TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (moment_id, voter_id)
);
CREATE INDEX IF NOT EXISTS idx_likes_moment ON likes (moment_id);

CREATE TABLE IF NOT EXISTS site_config (
  id          INTEGER PRIMARY KEY CHECK (id = 1),
  data        TEXT NOT NULL DEFAULT '{}',
  updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS admin_auth (
  id            INTEGER PRIMARY KEY CHECK (id = 1),
  password_hash TEXT NOT NULL,
  updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS photos (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  src         TEXT NOT NULL,
  title       TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  sort_order  INTEGER NOT NULL DEFAULT 0,
  visible     INTEGER NOT NULL DEFAULT 1,
  source_type TEXT NOT NULL DEFAULT 'upload',
  source_id   INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS idx_photos_visible_sort ON photos (visible DESC, sort_order ASC, id DESC);

CREATE TABLE IF NOT EXISTS login_attempts (
  ip TEXT PRIMARY KEY,
  fail_count INTEGER NOT NULL DEFAULT 0,
  locked_until TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS friends (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL DEFAULT '',
  url         TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  avatar      TEXT NOT NULL DEFAULT '',
  category    TEXT NOT NULL DEFAULT '',
  email       TEXT NOT NULL DEFAULT '',
  sort_order  INTEGER NOT NULL DEFAULT 0,
  status      TEXT NOT NULL DEFAULT 'approved', -- approved 已上架 / pending 待审核 / rejected 已拒绝
  last_checked TEXT NOT NULL DEFAULT '',
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS idx_friends_status ON friends (status, sort_order ASC, id DESC);
CREATE TABLE IF NOT EXISTS indexnow_log (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  url        TEXT NOT NULL DEFAULT '',
  endpoint   TEXT NOT NULL DEFAULT '',
  status     TEXT NOT NULL DEFAULT '',  -- ok / fail
  message    TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS idx_indexnow_log_created ON indexnow_log (created_at DESC);

CREATE TABLE IF NOT EXISTS analytics_pv (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  path         TEXT NOT NULL DEFAULT '',
  title        TEXT NOT NULL DEFAULT '',
  referrer     TEXT NOT NULL DEFAULT '',
  utm_source   TEXT NOT NULL DEFAULT '',
  utm_medium   TEXT NOT NULL DEFAULT '',
  utm_campaign TEXT NOT NULL DEFAULT '',
  country      TEXT NOT NULL DEFAULT '',
  region       TEXT NOT NULL DEFAULT '',
  city         TEXT NOT NULL DEFAULT '',
  isp          TEXT NOT NULL DEFAULT '',
  ip           TEXT NOT NULL DEFAULT '',
  device       TEXT NOT NULL DEFAULT '',
  browser      TEXT NOT NULL DEFAULT '',
  os           TEXT NOT NULL DEFAULT '',
  sid          TEXT NOT NULL DEFAULT '',
  duration     INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_analytics_pv_created ON analytics_pv (created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_analytics_pv_path ON analytics_pv (path);
CREATE INDEX IF NOT EXISTS idx_analytics_pv_sid ON analytics_pv (sid);

CREATE TABLE IF NOT EXISTS analytics_ip_geo (
  ip         TEXT PRIMARY KEY,
  country    TEXT NOT NULL DEFAULT '',
  region     TEXT NOT NULL DEFAULT '',
  city       TEXT NOT NULL DEFAULT '',
  isp        TEXT NOT NULL DEFAULT '',
  fetched_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
`;

let schemaPromise: Promise<void> | null = null;

/**
 * 幂等建表：首次请求时检测 moments 表是否存在，不存在则执行完整 schema。
 * 模块级 Promise 缓存，同一 Worker 隔离体内只跑一次；失败重置以便下次重试。
 * 对已存在数据的老库，新增表请通过 migrations/ 目录 + `wrangler d1 migrations apply` 应用，
 * 不要依赖这里（此处只在全新库时跑全量 schema）。
 */
export function ensureSchema(db: D1Database): Promise<void> {
  if (!schemaPromise) {
    schemaPromise = (async () => {
      const row = await db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='moments'")
        .first<{ name: string }>();
      if (row?.name) return; // 已有库，跳过
      await db.exec(SCHEMA_SQL);
    })().catch(err => {
      schemaPromise = null; // 失败重置，下次请求重试
      throw err;
    });
  }
  return schemaPromise;
}

export interface MomentRow {
  id: number;
  content: string;
  images: string; // JSON 字符串
  video: string; // JSON 字符串
  location: string;
  created_at: string;
  updated_at: string;
  like_count?: number;
  comment_count?: number;
  liked?: number;
}

export interface CommentRow {
  id: number;
  target_type: "moment" | "post";
  target_id: number;
  parent_id: number; // 0 = 顶级评论；>0 = 楼中楼回复，值为根评论 id
  nickname: string;
  content: string;
  is_owner: number;
  is_ai?: number; // 1 = Workers AI 机器人自动回复
  created_at: string;
  qq?: string;
  email?: string;
  avatar_url?: string;
  website?: string;
  images?: string; // JSON 数组，存图片 URL 列表
}

export interface PostRow {
  id: number;
  slug: string;
  title: string;
  excerpt: string;
  content_md: string;
  cover: string;
  status: string;
  created_at: string;
  updated_at: string;
}

export interface VideoRef {
  kind: "mp4" | "hls" | "embed";
  src: string;
  poster?: string | null;
  provider?: "bilibili" | "youtube"; // kind=embed 时：站外平台
  vid?: string; // kind=embed 时：平台视频 ID
}

export interface MomentView {
  id: number;
  content: string;
  images: string[];
  video: VideoRef | null; // 兼容字段：首个视频（无则 null）
  videos: VideoRef[]; // 视频列表（统一用这个）
  location: string;
  created_at: string;
  updated_at: string;
  like_count: number;
  comment_count: number;
  liked: boolean;
  comments?: CommentRow[];
}

export function parseImages(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.map(x => String(x)) : [];
  } catch {
    return [];
  }
}

/** 把任意对象归一化为 VideoRef；非法返回 null */
function normalizeVideo(v: unknown): VideoRef | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Partial<VideoRef>;
  if (o.kind === "embed") {
    if ((o.provider === "bilibili" || o.provider === "youtube") && typeof o.vid === "string" && o.vid) {
      return { kind: "embed", src: "", provider: o.provider, vid: o.vid, poster: null };
    }
    return null;
  }
  if ((o.kind === "mp4" || o.kind === "hls") && typeof o.src === "string" && o.src) {
    return { kind: o.kind, src: o.src, poster: typeof o.poster === "string" && o.poster ? o.poster : null };
  }
  return null;
}

export function parseVideo(raw: string | null | undefined): VideoRef | null {
  if (!raw) return null;
  try {
    return normalizeVideo(JSON.parse(raw));
  } catch {
    return null;
  }
}

/** 解析视频字段：兼容历史单对象与新的数组结构，统一返回数组 */
export function parseVideos(raw: string | null | undefined): VideoRef[] {
  if (!raw) return [];
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    return [];
  }
  if (Array.isArray(v)) {
    return v.map(normalizeVideo).filter((x): x is VideoRef => !!x);
  }
  const one = normalizeVideo(v);
  return one ? [one] : [];
}

/** 本站图片 R2 key → 可访问路径；外链原样返回。
 *  r2Domain 有值时直连 R2 自定义域名（省 Worker 请求），否则走 /media/ 代理。 */
export function keyToSrc(keyOrUrl: string, r2Domain?: string): string {
  if (/^https?:\/\//i.test(keyOrUrl)) return keyOrUrl;
  const encoded = keyOrUrl.split("/").map(encodeURIComponent).join("/");
  return r2Domain ? `${r2Domain.replace(/\/$/, "")}/${encoded}` : `/media/${encoded}`;
}

/** src → R2 key（仅本站对象；外链返回 null） */
export function srcToKey(src: string): string | null {
  if (/^https?:\/\//i.test(src)) return null;
  if (!src.startsWith("/media/")) return null;
  try {
    const key = decodeURIComponent(src.slice("/media/".length));
    if (!key || key.includes("..") || key.includes("\\")) return null;
    return key;
  } catch {
    return null;
  }
}

/** 宽松提取本站媒体 key：/media/<key>、纯 uploads/ key、R2 直连完整 URL（host 必须匹配配置的 r2_domain）。
 *  背景：配置 r2_domain 后上传接口返回 R2 直连 URL，前端原样提交，校验层需能提取 key。
 *  提取不到返回 null（视为外链或非法来源）。 */
export function mediaKeyFrom(src: string, r2Domain?: string): string | null {
  if (!src) return null;
  if (src.startsWith("/media/")) return srcToKey(src);
  if (/^uploads\//.test(src)) return src;
  if (/^https?:\/\//i.test(src) && r2Domain) {
    try {
      const u = new URL(src);
      if (u.host !== new URL(r2Domain).host) return null;
      const p = decodeURIComponent(u.pathname).replace(/^\//, "");
      return /^uploads\//.test(p) && !p.includes("..") && !p.includes("\\") ? p : null;
    } catch {
      return null;
    }
  }
  return null;
}

export function serializeMoment(row: MomentRow, withComments?: CommentRow[], r2Domain?: string): MomentView {
  const out: MomentView = {
    id: row.id,
    content: row.content ?? "",
    images: parseImages(row.images).map(k => keyToSrc(k, r2Domain)),
    videos: (() => {
      const transform = (v: VideoRef): VideoRef => {
        if (v.kind === "embed") return { kind: "embed", src: "", provider: v.provider, vid: v.vid, poster: null };
        const poster = v.poster ? (/^https?:\/\//i.test(v.poster) || v.poster.startsWith("/media/") ? v.poster : keyToSrc(v.poster, r2Domain)) : null;
        return /^https?:\/\//i.test(v.src) || v.src.startsWith("/media/") ? { ...v, poster } : { kind: v.kind, src: keyToSrc(v.src, r2Domain), poster };
      };
      return parseVideos(row.video).map(transform);
    })(),
    video: null,
    location: row.location ?? "",
    created_at: row.created_at,
    updated_at: row.updated_at,
    like_count: Number(row.like_count ?? 0),
    comment_count: Number(row.comment_count ?? 0),
    liked: Number(row.liked ?? 0) === 1,
    ...(withComments ? { comments: withComments } : {}),
  };
  out.video = out.videos[0] ?? null; // 兼容字段：首个视频
  return out;
}

export function serializePost(row: PostRow, withContent = false, r2Domain?: string) {
  const base = {
    id: row.id,
    slug: row.slug,
    title: row.title,
    excerpt: row.excerpt,
    cover: row.cover ? keyToSrc(row.cover, r2Domain) : "",
    status: row.status,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
  return withContent ? { ...base, content_md: row.content_md } : base;
}

/** voter_id 白名单（前端 uuid），非法一律按未登录访客处理 */
function safeVoter(v?: string): string {
  if (!v) return "";
  return /^[A-Za-z0-9_-]{8,64}$/.test(v) ? v : "";
}

function momentSelectColumns(voter: string): string {
  return `
    SELECT m.*,
      (SELECT COUNT(*) FROM likes l WHERE l.moment_id = m.id) AS like_count,
      (SELECT COUNT(*) FROM comments c WHERE c.target_type = 'moment' AND c.target_id = m.id) AS comment_count,
      ${
        voter
          ? "EXISTS(SELECT 1 FROM likes lk WHERE lk.moment_id = m.id AND lk.voter_id = ?) AS liked"
          : "0 AS liked"
      }
    FROM moments m`;
}

/**
 * 动态列表（游标分页：按 id 倒序，cursor = 上一页最后一条 id）。
 * 计数用相关子查询实时聚合；liked 由 voter_id 判定。
 */
export async function queryMoments(
  db: D1Database,
  opts: { cursor?: number; limit?: number; voterId?: string; r2Domain?: string }
): Promise<{ list: MomentView[]; nextCursor: number | null }> {
  const limit = Math.min(50, Math.max(1, opts.limit ?? 20));
  const voter = safeVoter(opts.voterId);
  const r2 = opts.r2Domain;
  const binds: (string | number)[] = [];
  if (voter) binds.push(voter);

  let where = "";
  if (opts.cursor && Number.isFinite(opts.cursor)) {
    where = "WHERE m.id < ?";
    binds.push(opts.cursor);
  }
  binds.push(limit + 1); // 多取一条判断是否还有下一页

  // 列子句中 voter 占位在最前；where/limit 追加在后，D1 匿名占位按顺序绑定
  const sql = `${momentSelectColumns(voter)} ${where} ORDER BY m.id DESC LIMIT ?`;
  const rows = (await db.prepare(sql).bind(...binds).all<MomentRow>()).results;

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const nextCursor = hasMore ? page[page.length - 1].id : null;
  return { list: page.map(r => serializeMoment(r, undefined, r2)), nextCursor };
}

/* ==================== 说说 + 文章 混合时间线 ==================== */

export interface PostFeedView {
  kind: "post";
  id: number;
  slug: string;
  title: string;
  excerpt: string;
  cover: string;
  created_at: string;
}

export type MomentFeedView = { kind: "moment" } & MomentView;
export type FeedItem = MomentFeedView | PostFeedView;

export interface FeedCursor {
  ts: string;
  kind: "moment" | "post";
  id: number;
}

/** 游标仅含 ASCII（ISO 时间 + kind + id），可直接 btoa */
export function encodeFeedCursor(c: FeedCursor): string {
  return btoa(JSON.stringify(c));
}
export function decodeFeedCursor(raw: string): FeedCursor | null {
  try {
    const c = JSON.parse(atob(raw)) as Partial<FeedCursor>;
    if (c && typeof c.ts === "string" && typeof c.id === "number" && (c.kind === "moment" || c.kind === "post")) {
      return { ts: c.ts, kind: c.kind, id: c.id };
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * 混合时间线：说说 + 已发布文章，按 created_at 倒序混排（同表内同毫秒以 id 兜底）。
 * 游标分页：每张表各取 limit+1，在 JS 中归并后截取一页。
 */
export async function queryFeed(
  db: D1Database,
  opts: { cursor?: FeedCursor | null; limit?: number; voterId?: string; r2Domain?: string; q?: string }
): Promise<{ list: FeedItem[]; nextCursor: string | null }> {
  const limit = Math.min(50, Math.max(1, opts.limit ?? 20));
  const voter = safeVoter(opts.voterId);
  const r2 = opts.r2Domain;
  const cur = opts.cursor ?? null;
  // 关键词过滤：有 q 时只检索匹配的说说（内容/位置），不混入文章
  const q = (opts.q || "").trim();
  const like = q ? `%${q}%` : "";
  const fetchN = limit + 1;

  // 说说
  const mBinds: (string | number)[] = [];
  if (voter) mBinds.push(voter);
  const mConds: string[] = [];
  if (like) { mConds.push("(m.content LIKE ? OR m.location LIKE ?)"); mBinds.push(like, like); }
  if (cur) { mConds.push("(m.created_at < ? OR (m.created_at = ? AND m.id < ?))"); mBinds.push(cur.ts, cur.ts, cur.id); }
  const mWhere = mConds.length ? "WHERE " + mConds.join(" AND ") : "";
  mBinds.push(fetchN);
  const mSql = `${momentSelectColumns(voter)} ${mWhere} ORDER BY m.created_at DESC, m.id DESC LIMIT ?`;
  const mRows = (await db.prepare(mSql).bind(...mBinds).all<MomentRow>()).results;

  // 已发布文章（关键词过滤模式下不返回文章）
  let pRows: PostRow[] = [];
  if (!like) {
    const pBinds: (string | number)[] = [];
    let pWhere = `WHERE status = 'published'`;
    if (cur) {
      pWhere += ` AND (created_at < ? OR (created_at = ? AND id < ?))`;
      pBinds.push(cur.ts, cur.ts, cur.id);
    }
    pBinds.push(fetchN);
    pRows = (
      await db
        .prepare(
          `SELECT id, slug, title, excerpt, cover, status, created_at, updated_at
         FROM posts ${pWhere} ORDER BY created_at DESC, id DESC LIMIT ?`
        )
        .bind(...pBinds)
        .all<PostRow>()
    ).results;
  }

  const items: FeedItem[] = [
    ...mRows.map<MomentFeedView>(r => ({ kind: "moment", ...serializeMoment(r, undefined, r2) })),
    ...pRows.map<PostFeedView>(r => ({
      kind: "post",
      id: r.id,
      slug: r.slug,
      title: r.title,
      excerpt: r.excerpt,
      cover: r.cover ? keyToSrc(r.cover, r2) : "",
      created_at: r.created_at,
    })),
  ];

  items.sort((a, b) => {
    const t = b.created_at.localeCompare(a.created_at);
    if (t !== 0) return t;
    if (a.kind !== b.kind) return a.kind === "post" ? -1 : 1;
    return b.id - a.id;
  });

  const page = items.slice(0, limit);
  const last = page[page.length - 1];
  const nextCursor =
    items.length > limit && last
      ? encodeFeedCursor({ ts: last.created_at, kind: last.kind, id: last.id })
      : null;
  return { list: page, nextCursor };
}

export async function queryMomentById(
  db: D1Database,
  id: number,
  voterId?: string,
  withComments = false,
  r2Domain?: string
): Promise<MomentView | null> {
  const voter = safeVoter(voterId);
  const binds: (string | number)[] = [];
  if (voter) binds.push(voter);
  binds.push(id);

  const row = await db.prepare(`${momentSelectColumns(voter)} WHERE m.id = ?`).bind(...binds).first<MomentRow>();
  if (!row) return null;

  if (!withComments) return serializeMoment(row, undefined, r2Domain);
  const comments = (
    await db
      .prepare(`SELECT * FROM comments WHERE target_type = 'moment' AND target_id = ? ORDER BY id ASC`)
      .bind(id)
      .all<CommentRow>()
  ).results;
  return serializeMoment(row, comments, r2Domain);
}
