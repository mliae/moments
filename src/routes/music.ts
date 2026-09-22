/**
 * 网易云音乐解析代理（移植自 Jxe backend）
 *
 * GET /api/music/163/playlist?id=xxx
 *   → { id, name, cover, creator, songs: [{ id, name, artist, pic, duration }], total }
 *
 * GET /api/music/163?id=xxx
 *   → { url, title, artist, cover, available, proxied? }
 *   优先用网易云官方 outer URL 302 重定向拿 CDN 直链；
 *   若官方返回 404（VIP/下架/区域限制），降级为同源流代理
 *   （/api/music/163/stream?id= 让 <audio> 走后端转发）。
 *
 * GET /api/music/163/stream?id=xxx
 *   → 音频二进制流（Content-Type: audio/mpeg），供 <audio> 直接播放。
 *
 * GET /api/music/163/lyric?id=xxx
 *   → { lyric: "LRC 原文" }（无歌词时为空字符串）
 */
import { Hono } from "hono";
import { ok, fail } from "../respond";
import type { HonoEnv } from "../types";

const app = new Hono<HonoEnv>();

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36";

/** 通过网易云 outer URL 302 重定向获取真实 CDN 播放地址 */
async function getOuterUrl(id: string): Promise<string | null> {
  try {
    const res = await fetch(`https://music.163.com/song/media/outer/url?id=${id}.mp3`, {
      headers: { "User-Agent": UA, Referer: "https://music.163.com/" },
      redirect: "manual",
    });
    const location = res.headers.get("location") || res.headers.get("Location") || "";
    if (res.status === 302 && location && !location.endsWith("/404")) {
      return location.replace(/^http:/, "https:");
    }
  } catch {
    // 忽略，走降级
  }
  return null;
}

/** http 资源升级为 https（HTTPS 页面混合内容会被浏览器拦截） */
function toHttps(url: string): string {
  return url ? url.replace(/^http:\/\//i, "https://") : "";
}

/** 获取歌曲元信息（歌名/歌手/封面）；found=false 表示歌曲已下架/ID 无效 */
async function getSongMeta(
  id: string
): Promise<{ title: string; artist: string; cover: string; found: boolean }> {
  try {
    const res = await fetch(
      `https://music.163.com/api/song/detail?ids=${encodeURIComponent(`[${id}]`)}`,
      { headers: { "User-Agent": UA, Referer: "https://music.163.com/" } }
    );
    const data = (await res.json()) as {
      songs?: Array<{
        name?: string;
        artists?: Array<{ name?: string }>;
        album?: { picUrl?: string };
      }>;
    };
    const s = data.songs?.[0];
    if (!s?.name) return { title: "", artist: "", cover: "", found: false };
    return {
      title: s.name,
      artist: s.artists?.map(a => a.name).filter(Boolean).join(" / ") || "未知歌手",
      cover: toHttps(s.album?.picUrl || ""),
      found: true,
    };
  } catch {
    return { title: "", artist: "", cover: "", found: false };
  }
}

interface PlaylistSong {
  id: number;
  name: string;
  artist: string;
  pic: string;
  duration: number;
}

function normalizeTrack(t: Record<string, unknown>): PlaylistSong | null {
  const id = Number(t.id);
  const name = String(t.name ?? "");
  if (!id || !name) return null;
  const artists = Array.isArray(t.artists) ? (t.artists as Array<{ name?: string }>) : [];
  const album = (t.album as { name?: string; picUrl?: string } | undefined) || {};
  return {
    id,
    name,
    artist: artists.map(a => a.name).filter(Boolean).join(" / ") || "未知歌手",
    pic: toHttps(album.picUrl || ""),
    duration: Number(t.duration ?? 0),
  };
}

/** 歌单只返回 trackIds 时，用 song/detail 批量补齐歌曲信息（每批 100） */
async function getTracksByIds(ids: number[]): Promise<PlaylistSong[]> {
  const songs: PlaylistSong[] = [];
  for (let i = 0; i < ids.length; i += 100) {
    const chunk = ids.slice(i, i + 100);
    try {
      const res = await fetch(
        `https://music.163.com/api/song/detail?ids=${encodeURIComponent(JSON.stringify(chunk))}`,
        { headers: { "User-Agent": UA, Referer: "https://music.163.com/" } }
      );
      const data = (await res.json()) as { songs?: Array<Record<string, unknown>> };
      for (const t of data.songs || []) {
        const song = normalizeTrack(t);
        if (song) songs.push(song);
      }
    } catch {
      // 单批失败不影响其他批次
    }
  }
  return songs;
}

/** 获取 LRC 歌词原文 */
async function getLyric(id: string): Promise<string> {
  const res = await fetch(
    `https://music.163.com/api/song/lyric?id=${id}&lv=1&kv=1&tv=-1`,
    { headers: { "User-Agent": UA, Referer: "https://music.163.com/" } }
  );
  const data = (await res.json()) as { lrc?: { lyric?: string }; nolyric?: boolean };
  if (data.nolyric) return "";
  return data.lrc?.lyric || "";
}

/** 获取歌单详情 */
async function getPlaylistDetail(id: string): Promise<{
  id: number;
  name: string;
  cover: string;
  creator: string;
  songs: PlaylistSong[];
}> {
  const res = await fetch(
    `https://music.163.com/api/playlist/detail?id=${id}`,
    { headers: { "User-Agent": UA, Referer: "https://music.163.com/" } }
  );
  const data = (await res.json()) as {
    code: number;
    result?: {
      id?: number;
      name?: string;
      coverImgUrl?: string;
      creator?: { nickname?: string };
      tracks?: Array<Record<string, unknown>>;
      trackIds?: Array<{ id: number }>;
    };
  };
  const result = data.result;
  if (!result || data.code !== 200) {
    throw new Error("歌单不存在或解析失败");
  }

  const directTracks = (result.tracks || [])
    .map(normalizeTrack)
    .filter((s): s is PlaylistSong => s !== null);

  let songs = directTracks;
  if (songs.length === 0 && Array.isArray(result.trackIds) && result.trackIds.length > 0) {
    songs = await getTracksByIds(result.trackIds.map(t => t.id));
  }

  return {
    id: result.id || Number(id),
    name: result.name || "未知歌单",
    cover: toHttps(result.coverImgUrl || ""),
    creator: result.creator?.nickname || "",
    songs,
  };
}

/** 解析歌曲播放地址：GET /api/music/163?id=xxx */
app.get("/163", async c => {
  const id = c.req.query("id") || "";
  if (!/^\d+$/.test(id)) return fail(c, "无效的歌曲 ID", 400);

  const [meta, url] = await Promise.all([getSongMeta(id), getOuterUrl(id)]);

  // 网易云曲库查不到该歌曲：已下架 / ID 无效 / 区域版权不可用
  if (!meta.found) {
    return ok(
      c,
      { url: "", title: "", artist: "", cover: "", available: false },
      "歌曲不可用（已下架或版权限制）"
    );
  }

  if (url) {
    return ok(c, { url: toHttps(url), title: meta.title, artist: meta.artist, cover: meta.cover, available: true }, "解析成功");
  }

  // 降级：同源流代理（VIP 歌曲通常为试听片段）
  const proxiedUrl = `/api/music/163/stream?id=${id}`;
  return ok(
    c,
    { url: proxiedUrl, title: meta.title, artist: meta.artist, cover: meta.cover, available: true, proxied: true },
    "解析成功（流代理）"
  );
});

/** 音频流代理：GET /api/music/163/stream?id=xxx
 *  透传 Range 请求支持拖拽快进 */
app.get("/163/stream", async c => {
  const id = c.req.query("id") || "";
  if (!/^\d+$/.test(id)) return fail(c, "无效的歌曲 ID", 400);

  try {
    const range = c.req.header("range") || "";
    const upstreamHeaders: Record<string, string> = { "User-Agent": UA };
    if (range) upstreamHeaders.Range = range;

    const res = await fetch(`https://api.injahow.cn/meting/?type=url&id=${id}`, {
      headers: upstreamHeaders,
    });
    if (!res.body || (res.status !== 200 && res.status !== 206)) {
      return fail(c, "音频获取失败", 502);
    }
    // 上游对下架/无版权歌曲会返回 HTML 提示页而非音频，避免把 HTML 当音频下发
    const upstreamType = res.headers.get("content-type") || "";
    if (upstreamType.includes("text/html")) {
      return fail(c, "该歌曲暂无可用音源（版权或已下架）", 502);
    }

    const headers = new Headers();
    headers.set("Content-Type", res.headers.get("content-type") || "audio/mpeg");
    headers.set("Cache-Control", "public, max-age=3600, s-maxage=3600");
    headers.set("Accept-Ranges", res.headers.get("accept-ranges") || "bytes");
    const contentRange = res.headers.get("content-range");
    const contentLength = res.headers.get("content-length");
    if (contentRange) headers.set("Content-Range", contentRange);
    if (contentLength) headers.set("Content-Length", contentLength);

    return new Response(res.body, { status: res.status, headers });
  } catch {
    return fail(c, "音频代理请求失败", 502);
  }
});

/** 封面图代理：GET /api/music/163/cover?url=xxx
 *  网易云 p1/p2.music.126.net 有防盗链，浏览器直链会被 403，走 Worker 中转 */
app.get("/163/cover", async c => {
  const url = c.req.query("url") || "";
  if (!url || !/^https?:\/\/.+\.music\.126\.net\//.test(url)) {
    return fail(c, "无效的封面地址", 400);
  }
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": UA, Referer: "https://music.163.com/" },
    });
    if (!res.body || res.status >= 400) return fail(c, "封面获取失败", 502);
    const headers = new Headers();
    headers.set("Content-Type", res.headers.get("content-type") || "image/jpeg");
    headers.set("Cache-Control", "public, max-age=86400, s-maxage=86400");
    return new Response(res.body, { status: res.status, headers });
  } catch {
    return fail(c, "封面代理失败", 502);
  }
});

/** LRC 歌词：GET /api/music/163/lyric?id=xxx */
app.get("/163/lyric", async c => {
  const id = c.req.query("id") || "";
  if (!/^\d+$/.test(id)) return fail(c, "无效的歌曲 ID", 400);

  try {
    const lyric = await getLyric(id);
    return ok(c, { lyric }, lyric ? "歌词获取成功" : "该歌曲暂无歌词");
  } catch {
    return fail(c, "歌词获取失败", 502);
  }
});

/** 歌单详情：GET /api/music/163/playlist?id=xxx */
app.get("/163/playlist", async c => {
  const id = c.req.query("id") || "";
  if (!/^\d+$/.test(id)) return fail(c, "无效的歌单 ID", 400);

  try {
    const playlist = await getPlaylistDetail(id);
    return ok(c, { ...playlist, total: playlist.songs.length }, "歌单获取成功");
  } catch {
    return fail(c, "歌单获取失败，请检查歌单 ID 是否正确", 502);
  }
});

export default app;
