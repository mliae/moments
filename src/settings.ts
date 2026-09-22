/**
 * 站点配置：单行 site_config(id=1, data=JSON)
 * 公开接口只返回白名单字段；所有字段均有默认值，库中无记录时前端直接用默认值。
 */

export interface SiteSettings {
  site_title: string; // 顶栏品牌名 / 页面标题
  nav_feeds_name: string; // 顶栏"动态"导航文字
  essay_tips: string; // 横幅小标签
  essay_title: string; // 横幅大标题
  essay_subtitle: string; // 横幅描述
  essay_button_text: string; // 横幅管理员按钮文字
  // 音乐
  music_enable: boolean; // 是否启用底部音乐播放器
  music_playlist_id: string; // 网易云歌单 ID
  music_custom_playlist: string; // 自定义歌单 JSON 链接（可选）
  music_autoplay: boolean; // 打开网页自动播放（浏览器可能拦截，拦截时回退手动）
  music_preload: boolean; // 页面加载后预解析第一首音源，点播放即时出声
  music_collapsed: boolean; // 初始折叠成球形
  music_volume: string; // 初始音量 0-1
  // 品牌 / 作者
  brand_avatar: string; // 顶栏品牌头像（emoji 或图片 URL）
  author_name: string; // 说说作者昵称（卡片头像 fallback 取首字符）
  author_avatar: string; // 说说作者头像（图片 URL 或 emoji；空=昵称首字符）
  post_avatar: string; // 文章卡片头像（emoji 或图片 URL）
  // 导航
  nav_links: string; // 自定义导航项，每行一条：名称|链接
  // 横幅
  banner_button_url: string; // 横幅按钮链接（空=默认 发布/登录 行为）
  banner_bg_image: string; // 横幅背景图 URL（后台上传或外链）
  // 页脚
  footer_text: string; // 页脚文案（支持 HTML）
  footer_run_since: string; // 网站运行起始时间 ISO 字符串，空=不显示运行时长
  // 首页
  feed_page_size: string; // 首页时间线每页条数（1-50），超过后分页加载
  // 视频
  video_default_poster: string; // 统一视频封面 URL（说说/文章视频未单独设置封面时使用）
  // 域名
  site_domain: string; // 站点主域名（带 https://，如 https://jxe.me），用于 SEO/RSS/OG 绝对 URL；留空=用请求 origin
  r2_domain: string; // R2 自定义域名（带 https://，如 https://r2.e.jxe.me）；留空=走 Worker /media/ 代理
  // AI 评论机器人
  ai_reply_enabled: boolean; // 是否启用评论 @AI 自动回复（Workers AI，消耗每日免费额度）
  ai_bot_name: string; // 机器人昵称（评论中 @此昵称 触发回复），默认「小J」
  ai_bot_avatar: string; // 机器人头像：图片 URL 或 emoji；空=昵称首字符
  ai_text_model: string; // 自定义文本模型 ID（@cf/...）；留空=内置默认模型
  // QQ 昵称 API
  qq_nick_apis: string; // QQ 昵称 API 列表，每行一条：URL 模板（{qq} 占位）|解析方式。留空=内置默认列表
  // 安全
  admin_path: string; // 后台秘密入口路径（/admin 或 /sys-xxxx），不通过公开 API 下发
  site_icon: string; // 站点图标（favicon）：图片 URL 或 emoji；空=默认 ✍️
}

export const DEFAULT_SETTINGS: SiteSettings = {
  site_title: "Jxe",
  nav_feeds_name: "首页",
  essay_tips: "Jxe · 轻博客",
  essay_title: "即刻",
  essay_subtitle: "记录生活中的每一个瞬间，图文、视频与心情",
  essay_button_text: "发布即刻",
  music_enable: false,
  music_playlist_id: "8152976493",
  music_custom_playlist: "",
  music_autoplay: false,
  music_preload: true,
  music_collapsed: false,
  music_volume: "0.7",
  brand_avatar: "✍️",
  author_name: "Jxe",
  author_avatar: "",
  post_avatar: "📄",
  nav_links: "",
  banner_button_url: "",
  banner_bg_image: "",
  footer_text: "",
  footer_run_since: "",
  feed_page_size: "20",
  video_default_poster: "",
  site_domain: "",
  r2_domain: "",
  ai_reply_enabled: false,
  ai_bot_name: "小J",
  ai_bot_avatar: "🤖",
  ai_text_model: "",
  qq_nick_apis: "",
  admin_path: "/admin",
  site_icon: "",
};

/** 字符串字段约束：最大长度 */
const STRING_LIMITS: Partial<Record<keyof SiteSettings, number>> = {
  site_title: 40,
  nav_feeds_name: 12,
  essay_tips: 60,
  essay_title: 40,
  essay_subtitle: 200,
  essay_button_text: 20,
  music_playlist_id: 32,
  music_custom_playlist: 500,
  music_volume: 4,
  brand_avatar: 200,
  author_name: 32,
  author_avatar: 200,
  post_avatar: 200,
  nav_links: 1000,
  banner_button_url: 500,
  banner_bg_image: 500,
  footer_text: 2000,
  footer_run_since: 40,
  feed_page_size: 3,
  video_default_poster: 500,
  site_domain: 200,
  r2_domain: 200,
  ai_bot_name: 20,
  ai_bot_avatar: 200,
  ai_text_model: 100,
  qq_nick_apis: 2000,
  admin_path: 40,
  site_icon: 300,
};

/**
 * 校验后台入口路径：仅允许默认 /admin 或 /sys- 前缀的秘密路径
 * （/sys-* 已在 wrangler.jsonc run_worker_first 中放行到 Worker）
 */
export function normalizeAdminPath(raw: unknown): string | null {
  const v = String(raw ?? "").trim().slice(0, 40);
  if (v === "/admin") return v;
  if (/^\/sys-[a-z0-9]{4,24}$/i.test(v)) return v.toLowerCase();
  return null;
}

/** 布尔字段 */
const BOOLEAN_KEYS: (keyof SiteSettings)[] = [
  "music_enable",
  "music_autoplay",
  "music_preload",
  "music_collapsed",
  "ai_reply_enabled",
];

export function clampSetting(value: unknown, max: number): string {
  return String(value ?? "").trim().slice(0, max);
}

function toBool(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value === 1;
  if (typeof value === "string") return value === "1" || value.toLowerCase() === "true";
  return false;
}

/** 任意输入 → 安全的设置对象（空串回退默认值，防止前台显示空白） */
export function normalizeSettings(raw: Record<string, unknown> | null | undefined): SiteSettings {
  const out: SiteSettings = { ...DEFAULT_SETTINGS };
  if (!raw) return out;
  (Object.keys(DEFAULT_SETTINGS) as (keyof SiteSettings)[]).forEach(key => {
    if (BOOLEAN_KEYS.includes(key)) {
      // 布尔字段：未提供时保留默认
      if (raw[key] !== undefined) out[key] = toBool(raw[key]) as never;
      return;
    }
    const max = STRING_LIMITS[key] ?? 0;
    const v = clampSetting(raw[key], max);
    if (v) out[key] = v as never;
  });
  // 音量：数值范围 0-1，非法回退默认
  const vol = parseFloat(out.music_volume);
  out.music_volume = Number.isFinite(vol)
    ? String(Math.max(0, Math.min(1, vol)))
    : DEFAULT_SETTINGS.music_volume;
  // 首页每页条数：1-50，非法回退默认
  const fps = parseInt(out.feed_page_size, 10);
  out.feed_page_size = Number.isFinite(fps)
    ? String(Math.max(1, Math.min(50, fps)))
    : DEFAULT_SETTINGS.feed_page_size;
  return out;
}

export async function getSettings(db: D1Database): Promise<SiteSettings> {
  const row = await db
    .prepare(`SELECT data FROM site_config WHERE id = 1`)
    .first<{ data: string }>();
  if (!row) return { ...DEFAULT_SETTINGS };
  try {
    return normalizeSettings(JSON.parse(row.data) as Record<string, unknown>);
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

/** 合并 patch 后 UPSERT，返回规范化后的完整设置 */
export async function updateSettings(
  db: D1Database,
  patch: Record<string, unknown>
): Promise<SiteSettings> {
  const current = await getSettings(db);
  const next: Record<string, unknown> = { ...current };
  (Object.keys(DEFAULT_SETTINGS) as (keyof SiteSettings)[]).forEach(key => {
    if (patch[key] === undefined) return;
    if (BOOLEAN_KEYS.includes(key)) {
      next[key] = toBool(patch[key]);
      return;
    }
    const max = STRING_LIMITS[key] ?? 0;
    const v = clampSetting(patch[key], max);
    // 空串视为"恢复默认"，而非保留旧值
    next[key] = v || DEFAULT_SETTINGS[key];
  });
  const normalized = normalizeSettings(next as Record<string, unknown>);
  await db
    .prepare(
      `INSERT INTO site_config (id, data, updated_at)
       VALUES (1, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
       ON CONFLICT(id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`
    )
    .bind(JSON.stringify(normalized))
    .run();
  return normalized;
}
