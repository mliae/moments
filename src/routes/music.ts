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
import { requireAdmin } from "../auth";
import { getSettings } from "../settings";
import { keyToSrc } from "../db";

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
    `https://music.163.com/api/v6/playlist/detail?id=${encodeURIComponent(id)}&n=1000`,
    { headers: { "User-Agent": UA, Referer: "https://music.163.com/", Cookie: `NMTID=${Math.random().toString(36).slice(2)}` } }
  );
  const data = (await res.json()) as {
    code: number;
    playlist?: {
      id?: number;
      name?: string;
      coverImgUrl?: string;
      creator?: { nickname?: string };
      tracks?: Array<Record<string, unknown>>;
      trackIds?: Array<{ id: number }>;
    };
  };
  const pl = data.playlist;
  if (!pl || data.code !== 200) {
    throw new Error("歌单不存在或解析失败");
  }

  // v6 内联 tracks 只含前若干首，完整列表在 trackIds；优先用 trackIds 逐首补齐
  const ids = Array.isArray(pl.trackIds) ? pl.trackIds.map(t => t.id).filter(Boolean) : [];
  let songs: PlaylistSong[];
  if (ids.length > 0) {
    songs = await getTracksByIds(ids);
  } else {
    songs = (pl.tracks || [])
      .map(normalizeTrack)
      .filter((s): s is PlaylistSong => s !== null);
  }

  return {
    id: pl.id || Number(id),
    name: pl.name || "未知歌单",
    cover: toHttps(pl.coverImgUrl || ""),
    creator: pl.creator?.nickname || "",
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

/* ============================================================
 * 站内音乐库
 * 后台搜歌（网易云/QQ 聚合）→ 解析下载全曲音频+封面+歌词到 R2
 * → 存 D1 music_tracks → 文章 [music=tN] / 胶囊歌单 playlist.json
 * ============================================================ */

const TRIAL_MIN_BYTES = 1.5 * 1024 * 1024; // 小于 1.5MB 视为试听片段
const MAX_AUDIO_BYTES = 60 * 1024 * 1024; // 上传/转存上限 60MB

const AUDIO_MIME: Record<string, string> = {
  mp3: "audio/mpeg",
  m4a: "audio/mp4",
  flac: "audio/flac",
  wav: "audio/wav",
  ogg: "audio/ogg",
};

interface SearchHit {
  source: "netease" | "qq";
  songId: string;
  title: string;
  artist: string;
  album: string;
  cover: string;
  vip: boolean;
  duration: number; // 秒
}

/** 网易云搜索：fee 0/8=免费，1/4/16=VIP */
async function searchNetease(kw: string, limit = 10): Promise<SearchHit[]> {
  try {
    const res = await fetch(
      `https://music.163.com/api/search/get?s=${encodeURIComponent(kw)}&type=1&limit=${limit}`,
      { headers: { "User-Agent": UA, Referer: "https://music.163.com/" } }
    );
    const data = (await res.json()) as {
      result?: { songs?: Array<Record<string, unknown>> };
    };
    return (data.result?.songs || [])
      .map((s): SearchHit | null => {
        const id = Number(s.id);
        const name = String(s.name ?? "");
        if (!id || !name) return null;
        const artists = Array.isArray(s.artists) ? (s.artists as Array<{ name?: string }>) : [];
        const album = (s.album as { name?: string; picUrl?: string } | undefined) || {};
        return {
          source: "netease" as const,
          songId: String(id),
          title: name,
          artist: artists.map(a => a.name).filter(Boolean).join(" / ") || "未知歌手",
          album: album.name || "",
          cover: toHttps(album.picUrl || ""),
          vip: [1, 4, 16].includes(Number(s.fee ?? 0)),
          duration: Math.round(Number(s.duration ?? 0) / 1000),
        };
      })
      .filter((s): s is SearchHit => s !== null);
  } catch {
    return [];
  }
}

/** QQ 音乐搜索：pay.payplay=1 为 VIP；封面用 gtimg 静态域（无防盗链） */
async function searchQQ(kw: string, limit = 10): Promise<SearchHit[]> {
  try {
    const res = await fetch(
      `https://c.y.qq.com/soso/fcgi-bin/client_search_cp?w=${encodeURIComponent(kw)}&format=json&n=${limit}&p=1&cr=1&t=0`,
      { headers: { "User-Agent": UA, Referer: "https://y.qq.com/" } }
    );
    const data = (await res.json()) as {
      data?: { song?: { list?: Array<Record<string, unknown>> } };
    };
    return (data.data?.song?.list || [])
      .map((s): SearchHit | null => {
        const songmid = String(s.songmid ?? s.songid ?? "");
        const songname = String(s.songname ?? "");
        if (!songmid || !songname) return null;
        const singers = Array.isArray(s.singer) ? (s.singer as Array<{ name?: string }>) : [];
        const albummid = String(s.albummid ?? "");
        const pay = s.pay as { payplay?: number } | undefined;
        return {
          source: "qq" as const,
          songId: songmid,
          title: songname,
          artist: singers.map(a => a.name).filter(Boolean).join(" / ") || "未知歌手",
          album: String(s.albumname ?? ""),
          cover: albummid ? `https://y.gtimg.cn/music/photo_new/T002R500x500M000${albummid}.jpg` : "",
          vip: pay?.payplay === 1,
          duration: Number(s.interval ?? 0),
        };
      })
      .filter((s): s is SearchHit => s !== null);
  } catch {
    return [];
  }
}

/** 双平台聚合搜索（管理端）：GET /api/music/search?kw=xxx */
app.get("/search", requireAdmin, async c => {
  const kw = (c.req.query("kw") || "").trim();
  if (!kw) return fail(c, "请输入搜索关键词", 400);
  const [netease, qq] = await Promise.all([searchNetease(kw), searchQQ(kw)]);
  return ok(c, { netease, qq });
});

/** 音频魔数判断（防把 HTML 错误页当音频入库） */
function audioExt(buf: ArrayBuffer): string {
  const u = new Uint8Array(buf.slice(0, 16));
  if (u[0] === 0x49 && u[1] === 0x44 && u[2] === 0x33) return "mp3"; // ID3
  if (u[0] === 0xff && (u[1] & 0xe0) === 0xe0) return "mp3"; // MPEG frame
  if (u.length >= 8 && String.fromCharCode(u[4], u[5], u[6], u[7]) === "ftyp") return "m4a";
  const head4 = String.fromCharCode(u[0], u[1], u[2], u[3]);
  if (head4 === "fLaC") return "flac";
  if (head4 === "RIFF") return "wav";
  if (head4 === "OggS") return "ogg";
  return "";
}

function looksLikeImage(buf: ArrayBuffer): string {
  const u = new Uint8Array(buf.slice(0, 16));
  if (u[0] === 0xff && u[1] === 0xd8) return "jpg";
  if (u[0] === 0x89 && u[1] === 0x50 && u[2] === 0x4e) return "png";
  if (u.length >= 12 && String.fromCharCode(u[8], u[9], u[10], u[11]) === "WEBP") return "webp";
  if (u[0] === 0x47 && u[1] === 0x49 && u[2] === 0x46) return "gif";
  return "";
}

function newKey(kind: "audio" | "cover", ext: string): string {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 8);
  return `music/${kind}-${ts}${rand}.${ext}`;
}

interface ResolvedAudio {
  buf: ArrayBuffer;
  via: string;
}

/** 聚合解析 + 下载音频：outer 302 → meting(netease) → meting(tencent) → 跨平台同名搜索再解析。
 *  <1.5MB 的试听片段跳过换源；全失败返回 null（不入库）。 */
async function resolveAudio(
  songId: string,
  source: "netease" | "qq",
  title: string,
  artist: string
): Promise<ResolvedAudio | null> {
  const directFetch = (url: string, referer?: string) => async (): Promise<Response | null> => {
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": UA, ...(referer ? { Referer: referer } : {}) },
      });
      return res.ok ? res : null;
    } catch {
      return null;
    }
  };
  const meting = (server: string, id: string) =>
    directFetch(`https://api.injahow.cn/meting/?server=${server}&type=url&id=${id}`);

  type Cand = { label: string; make: () => Promise<Response | null> };
  const cands: Cand[] = [];
  if (source === "netease") {
    const outer = await getOuterUrl(songId);
    if (outer) cands.push({ label: "netease-outer", make: directFetch(outer, "https://music.163.com/") });
    cands.push({ label: "meting-netease", make: meting("netease", songId) });
    cands.push({ label: "meting-tencent", make: meting("tencent", songId) });
    // 跨平台：拿「歌名 歌手」去 QQ 搜第一首再解析
    const qqHits = await searchQQ(`${title} ${artist}`, 1);
    if (qqHits[0]) cands.push({ label: "cross-qq", make: meting("tencent", qqHits[0].songId) });
  } else {
    cands.push({ label: "meting-tencent", make: meting("tencent", songId) });
    const neHits = await searchNetease(`${title} ${artist}`, 1);
    if (neHits[0]) {
      const outer = await getOuterUrl(neHits[0].songId);
      if (outer) cands.push({ label: "cross-netease-outer", make: directFetch(outer, "https://music.163.com/") });
      cands.push({ label: "cross-netease-meting", make: meting("netease", neHits[0].songId) });
    }
  }

  for (const cand of cands) {
    try {
      const res = await cand.make();
      if (!res) continue;
      const ct = res.headers.get("content-type") || "";
      if (ct.includes("text/html")) continue; // 上游错误提示页
      const len = Number(res.headers.get("content-length") || 0);
      if (len && len > MAX_AUDIO_BYTES) continue;
      const buf = await res.arrayBuffer();
      if (buf.byteLength < TRIAL_MIN_BYTES) continue; // 试听片段：换源
      if (buf.byteLength > MAX_AUDIO_BYTES) continue;
      if (!audioExt(buf)) continue;
      return { buf, via: cand.label };
    } catch {
      continue;
    }
  }
  return null;
}

/** 下载封面（网易 126.net 有 Referer 防盗链，QQ gtimg 不需要） */
async function downloadCover(coverUrl: string): Promise<{ buf: ArrayBuffer; ext: string } | null> {
  if (!coverUrl || !/^https?:\/\//i.test(coverUrl)) return null;
  try {
    const referer = coverUrl.includes("126.net") ? "https://music.163.com/" : coverUrl.includes("gtimg") ? "https://y.qq.com/" : undefined;
    const res = await fetch(coverUrl, { headers: { "User-Agent": UA, ...(referer ? { Referer: referer } : {}) } });
    if (!res.ok || !res.body) return null;
    const buf = await res.arrayBuffer();
    if (buf.byteLength < 1024 || buf.byteLength > 5 * 1024 * 1024) return null;
    const ext = looksLikeImage(buf);
    return ext ? { buf, ext } : null;
  } catch {
    return null;
  }
}

async function getLyricSafe(id: string): Promise<string> {
  try {
    return await getLyric(id);
  } catch {
    return "";
  }
}

/** meting 取 LRC 原文（QQ 曲目歌词来源） */
async function metingLrc(server: string, id: string): Promise<string> {
  try {
    const res = await fetch(`https://api.injahow.cn/meting/?server=${server}&type=lrc&id=${id}`, {
      headers: { "User-Agent": UA },
    });
    if (!res.ok) return "";
    const text = (await res.text()).trim();
    return text && !text.startsWith("<") && text.includes("[") ? text : "";
  } catch {
    return "";
  }
}

/** 搜索结果入库：POST /api/music/import { source, songId, title, artist?, album?, cover?, vip? } */
app.post("/import", requireAdmin, async c => {
  const body = await c.req.json().catch(() => null);
  const source = body?.source === "qq" ? "qq" : "netease";
  const songId = String(body?.songId ?? "").trim();
  const title = String(body?.title ?? "").trim();
  const artist = String(body?.artist ?? "").trim();
  const album = String(body?.album ?? "").trim();
  const coverUrl = String(body?.cover ?? "").trim();
  const vip = body?.vip ? 1 : 0;
  if (!songId || !title) return fail(c, "参数错误", 400);

  // 同源同 ID 防重复
  const dup = await c.env.DB.prepare("SELECT id FROM music_tracks WHERE source = ? AND source_id = ?")
    .bind(source, songId)
    .first<{ id: number }>();
  if (dup) return ok(c, { id: `t${dup.id}`, duplicate: true }, "该歌曲已在音乐库中");

  const resolved = await resolveAudio(songId, source, title, artist);
  if (!resolved) return fail(c, "解析失败：所有音源均不可用（VIP 付费或已下架），未入库", 502);

  const [coverRes, lyric] = await Promise.all([
    downloadCover(coverUrl),
    source === "netease" ? getLyricSafe(songId) : metingLrc("tencent", songId),
  ]);

  const ext = audioExt(resolved.buf);
  const audioKey = newKey("audio", ext);
  await c.env.R2.put(audioKey, resolved.buf, {
    httpMetadata: { contentType: AUDIO_MIME[ext] || "audio/mpeg" },
  });

  let coverKey = "";
  if (coverRes) {
    coverKey = newKey("cover", coverRes.ext);
    await c.env.R2.put(coverKey, coverRes.buf, {
      httpMetadata: { contentType: `image/${coverRes.ext === "jpg" ? "jpeg" : coverRes.ext}` },
    });
  }

  const r = await c.env.DB.prepare(
    "INSERT INTO music_tracks (title, artist, album, source, source_id, vip, audio_key, cover_key, lyric) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
  )
    .bind(title, artist, album, source, songId, vip, audioKey, coverKey, lyric)
    .run();
  return ok(
    c,
    { id: `t${r.meta.last_row_id}`, title, artist, via: resolved.via },
    "入库成功（音频/封面/歌词已存 R2）"
  );
});

/** 本地上传入库：POST /api/music/upload（multipart: file, title?, artist?, cover?） */
app.post("/upload", requireAdmin, async c => {
  const form = await c.req.parseBody().catch(() => null);
  if (!form) return fail(c, "表单解析失败", 400);
  const file = form.file;
  if (!(file instanceof File)) return fail(c, "请选择音频文件", 400);
  if (file.size > MAX_AUDIO_BYTES) return fail(c, "文件超过 60MB 限制", 400);
  if (file.size < 1024) return fail(c, "文件太小，不是有效音频", 400);
  const buf = await file.arrayBuffer();
  const ext = audioExt(buf);
  if (!ext) return fail(c, "不支持的音频格式（仅 mp3 / m4a / flac / wav / ogg）", 400);

  const title = (typeof form.title === "string" && form.title.trim()) || file.name.replace(/\.[^.]+$/, "") || "未命名";
  const artist = (typeof form.artist === "string" && form.artist.trim()) || "本地音乐";

  const audioKey = newKey("audio", ext);
  await c.env.R2.put(audioKey, buf, {
    httpMetadata: { contentType: AUDIO_MIME[ext] || "audio/mpeg" },
  });

  // 可选自定义封面
  let coverKey = "";
  const coverFile = form.cover;
  if (coverFile instanceof File && coverFile.size > 1024 && coverFile.size < 5 * 1024 * 1024) {
    const cb = await coverFile.arrayBuffer();
    const iext = looksLikeImage(cb);
    if (iext) {
      coverKey = newKey("cover", iext);
      await c.env.R2.put(coverKey, cb, {
        httpMetadata: { contentType: `image/${iext === "jpg" ? "jpeg" : iext}` },
      });
    }
  }

  const r = await c.env.DB.prepare(
    "INSERT INTO music_tracks (title, artist, source, source_id, audio_key, cover_key) VALUES (?, ?, 'upload', '', ?, ?)"
  )
    .bind(title, artist, audioKey, coverKey)
    .run();
  return ok(c, { id: `t${r.meta.last_row_id}`, title, artist }, "上传成功");
});

/** 网络地址转存：POST /api/music/url { url, title?, artist? }（汽水音乐等走此通道） */
app.post("/url", requireAdmin, async c => {
  const body = await c.req.json().catch(() => null);
  const url = String(body?.url ?? "").trim();
  if (!/^https?:\/\//i.test(url)) return fail(c, "请提供 http(s) 音频地址", 400);

  try {
    const res = await fetch(url, { headers: { "User-Agent": UA } });
    if (!res.ok) return fail(c, `源地址返回 HTTP ${res.status}`, 400);
    const len = Number(res.headers.get("content-length") || 0);
    if (len > MAX_AUDIO_BYTES) return fail(c, "文件超过 60MB 限制", 400);
    const buf = await res.arrayBuffer();
    if (buf.byteLength > MAX_AUDIO_BYTES) return fail(c, "文件超过 60MB 限制", 400);
    const ext = audioExt(buf);
    if (!ext) return fail(c, "该地址不是有效的音频文件（mp3 / m4a / flac / wav / ogg）", 400);

    const fallbackName = decodeURIComponent((url.split("?")[0].split("/").pop() || "").replace(/\.[^.]+$/, "")) || "网络音乐";
    const title = String(body?.title ?? "").trim() || fallbackName;
    const artist = String(body?.artist ?? "").trim() || "网络音乐";

    const audioKey = newKey("audio", ext);
    await c.env.R2.put(audioKey, buf, {
      httpMetadata: { contentType: AUDIO_MIME[ext] || "audio/mpeg" },
    });

    const r = await c.env.DB.prepare(
      "INSERT INTO music_tracks (title, artist, source, source_id, audio_key) VALUES (?, ?, 'url', ?, ?)"
    )
      .bind(title, artist, url.slice(0, 500), audioKey)
      .run();
    return ok(c, { id: `t${r.meta.last_row_id}`, title, artist }, "转存成功");
  } catch (e) {
    return fail(c, `转存失败：${e instanceof Error ? e.message : "网络错误"}`, 502);
  }
});

/** 站内曲目元数据（公开）：GET /api/music/track?id=tN
 *  → { title, artist, cover, url, lyric, available }（与 /163 卡片字段对齐） */
app.get("/track", async c => {
  const id = c.req.query("id") || "";
  const m = /^t(\d+)$/.exec(id);
  if (!m) return fail(c, "无效的曲目 ID", 400);
  const row = await c.env.DB.prepare("SELECT title, artist, audio_key, cover_key, lyric, enabled FROM music_tracks WHERE id = ?")
    .bind(Number(m[1]))
    .first<{ title: string; artist: string; audio_key: string; cover_key: string; lyric: string; enabled: number }>();
  if (!row || !row.enabled) {
    return ok(c, { title: "", artist: "", cover: "", url: "", lyric: "", available: false }, "曲目不存在或已停用");
  }
  const s = await getSettings(c.env.DB);
  return ok(c, {
    title: row.title,
    artist: row.artist || "未知歌手",
    cover: row.cover_key ? keyToSrc(row.cover_key, s.r2_domain) : "",
    url: row.audio_key ? keyToSrc(row.audio_key, s.r2_domain) : "",
    lyric: row.lyric || "",
    available: true,
  });
});

/** 胶囊播放器歌单（公开）：GET /api/music/playlist.json
 *  自定义歌单格式纯数组 [{ id, name, artist, url, pic, lrc }]，后台 music_custom_playlist 填此 URL */
app.get("/playlist.json", async c => {
  const s = await getSettings(c.env.DB);
  const { results } = await c.env.DB.prepare(
    "SELECT id, title, artist, audio_key, cover_key, lyric FROM music_tracks WHERE enabled = 1 ORDER BY id DESC LIMIT 500"
  ).all<{ id: number; title: string; artist: string; audio_key: string; cover_key: string; lyric: string }>();
  const list = (results || []).map(r => ({
    id: `t${r.id}`,
    name: r.title,
    artist: r.artist || "未知歌手",
    url: r.audio_key ? keyToSrc(r.audio_key, s.r2_domain) : "",
    pic: r.cover_key ? keyToSrc(r.cover_key, s.r2_domain) : "",
    lrc: r.lyric || "",
  }));
  return c.json(list, 200, { "Cache-Control": "public, max-age=60, s-maxage=300" });
});

/** 音乐库列表（管理端）：GET /api/music/library */
app.get("/library", requireAdmin, async c => {
  const s = await getSettings(c.env.DB);
  const { results } = await c.env.DB.prepare(
    "SELECT id, title, artist, album, source, source_id, vip, audio_key, cover_key, duration, enabled, created_at FROM music_tracks ORDER BY id DESC LIMIT 1000"
  ).all<{
    id: number;
    title: string;
    artist: string;
    album: string;
    source: string;
    source_id: string;
    vip: number;
    audio_key: string;
    cover_key: string;
    duration: number;
    enabled: number;
    created_at: string;
  }>();
  const list = (results || []).map(r => ({
    id: `t${r.id}`,
    title: r.title,
    artist: r.artist,
    album: r.album,
    source: r.source,
    vip: !!r.vip,
    duration: r.duration,
    enabled: !!r.enabled,
    created_at: r.created_at,
    audio_url: r.audio_key ? keyToSrc(r.audio_key, s.r2_domain) : "",
    cover_url: r.cover_key ? keyToSrc(r.cover_key, s.r2_domain) : "",
  }));
  return ok(c, { list, total: list.length });
});

/** 启用/停用：POST /api/music/library/toggle { id: "tN", enabled: bool } */
app.post("/library/toggle", requireAdmin, async c => {
  const body = await c.req.json().catch(() => null);
  const id = Number(String(body?.id ?? "").replace(/^t/, ""));
  if (!id) return fail(c, "参数错误", 400);
  const enabled = body?.enabled === false ? 0 : 1;
  const r = await c.env.DB.prepare("UPDATE music_tracks SET enabled = ? WHERE id = ?").bind(enabled, id).run();
  if (!r.meta.changes) return fail(c, "曲目不存在", 404);
  return ok(c, { id: `t${id}`, enabled: enabled === 1 });
});

/** 删除（同时清理 R2 音频+封面）：POST /api/music/library/delete { id: "tN" } */
app.post("/library/delete", requireAdmin, async c => {
  const body = await c.req.json().catch(() => null);
  const id = Number(String(body?.id ?? "").replace(/^t/, ""));
  if (!id) return fail(c, "参数错误", 400);
  const row = await c.env.DB.prepare("SELECT audio_key, cover_key FROM music_tracks WHERE id = ?")
    .bind(id)
    .first<{ audio_key: string; cover_key: string }>();
  if (!row) return fail(c, "曲目不存在", 404);
  for (const key of [row.audio_key, row.cover_key]) {
    if (key) await c.env.R2.delete(key);
  }
  await c.env.DB.prepare("DELETE FROM music_tracks WHERE id = ?").bind(id).run();
  return ok(c, { id: `t${id}` }, "已删除");
});

export default app;
