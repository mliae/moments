/**
 * 站外嵌入视频封面解析（前缀 /api/embed）
 * GET /cover?url=<分享链接>
 *  - YouTube：302 到 img.youtube 稳定封面
 *  - B站：调用官方接口取 pic 后 302（封面 URL 无法由 BV 直接拼接）
 * 封面本身稳定，给长缓存。
 */
import { Hono } from "hono";
import type { HonoEnv } from "../types";
import { fail } from "../respond";
import { parseEmbed, youtubeCover } from "../video-embed";

const app = new Hono<HonoEnv>();

const CACHE = "public, max-age=604800"; // 7 天

app.get("/cover", async c => {
  // 支持两种入参：?url=<分享链接> 或 ?provider=&vid=
  let e = parseEmbed(c.req.query("url") || "");
  if (!e) {
    const provider = c.req.query("provider");
    const vid = c.req.query("vid") || "";
    if ((provider === "bilibili" || provider === "youtube") && vid) e = { provider, vid };
  }
  if (!e) return fail(c, "无法识别的视频链接", 400);

  if (e.provider === "youtube") {
    return c.redirect(youtubeCover(e.vid), 302);
  }

  // B站：取 pic
  try {
    const res = await fetch(`https://api.bilibili.com/x/web-interface/view?bvid=${encodeURIComponent(e.vid)}`, {
      headers: { "User-Agent": "moments/1.0" },
      signal: AbortSignal.timeout(10000),
    });
    if (res.ok) {
      const json = (await res.json()) as { data?: { pic?: string } };
      const pic = json.data?.pic;
      if (pic && /^https?:\/\//i.test(pic)) {
        return new Response(null, {
          status: 302,
          headers: { Location: pic, "Cache-Control": CACHE },
        });
      }
    }
  } catch {
    /* 落下到兜底 */
  }
  // 兜底：B站占位封面
  return new Response(null, {
    status: 302,
    headers: { Location: `https://i0.hdslb.com/bfs/archive/0000000000000000000000000000000000000000.jpg`, "Cache-Control": CACHE },
  });
});

export default app;
