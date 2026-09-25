/**
 * 站外视频嵌入：解析 B站 / YouTube 分享链接为结构化引用，
 * 并提供官方 iframe 播放器地址与封面地址。前端与后端共用同一套规则。
 */
export type EmbedProvider = "bilibili" | "youtube";

export interface EmbedRef {
  provider: EmbedProvider;
  vid: string;
}

export const EMBED_PROVIDERS: EmbedProvider[] = ["bilibili", "youtube"];

/** 解析任意输入（可能带多余文字）为嵌入引用；不匹配返回 null */
export function parseEmbed(raw: unknown): EmbedRef | null {
  const s = String(raw ?? "").trim();
  if (!s) return null;

  // YouTube：youtu.be / youtube.com / embed / shorts
  const yt =
    s.match(/youtube\.com\/watch\?[^#]*?[?&]v=([\w-]{11})/i) ||
    s.match(/youtu\.be\/([\w-]{11})/i) ||
    s.match(/youtube(?:-nocookie)?\.com\/(?:embed|shorts|v)\/([\w-]{11})/i);
  if (yt) return { provider: "youtube", vid: yt[1] };

  // B站：优先取 URL 里的 BV，退而求其次扫整段文本里的 BV 号
  const bv = s.match(/\/video\/(BV[0-9A-Za-z]{10})/i) || s.match(/(BV[0-9A-Za-z]{10})/);
  if (bv) return { provider: "bilibili", vid: bv[1] };

  return null;
}

/** 官方 iframe 播放器地址 */
export function embedIframeSrc(e: EmbedRef): string {
  if (e.provider === "youtube") return `https://www.youtube-nocookie.com/embed/${e.vid}`;
  return `https://player.bilibili.com/player.html?bvid=${e.vid}&page=1&high_quality=1&danmaku=0&autoplay=0`;
}

/** YouTube 封面可直接拼接；B站封面需经 /api/embed/cover 解析 */
export function youtubeCover(vid: string): string {
  return `https://img.youtube.com/vi/${vid}/hqdefault.jpg`;
}
