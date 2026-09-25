/* global marked, Hls */
/* eslint-disable */
/* build 20260921f */
/**
 * moments 前端（原生 JS，无构建）
 * BannerCard + 瀑布流 bber 卡片（>=1200 三列 / >=768 两列 / 其余一列，列间距 16px）
 * History API 路由：/ 首页 ｜ /posts 文章列表 ｜ /post/:slug 文章详情 ｜ /photos 相册 ｜ /admin 后台
 * （旧 hash 链接 #/... 自动重定向到真实路径）
 */
(function () {
  "use strict";

  const app = document.getElementById("app");
  const adminArea = document.getElementById("adminArea");
  const modalRoot = document.getElementById("modalRoot");
  const lightboxRoot = document.getElementById("lightboxRoot");
  const themeToggle = document.getElementById("themeToggle");
  const fabPublish = document.getElementById("fabPublish");

  const GAP = 16;
  const LAYOUT_TIMEOUT = 1000;
  /** 首页每页条数：读后台设置（1-50），非法回退 20 */
  function feedPageSize() {
    const n = Number(state.settings.feed_page_size);
    return Number.isFinite(n) && n >= 1 ? Math.min(50, Math.floor(n)) : 20;
  }
  /** 分页条 HTML（pages<=1 不显示） */
  function pagerHtml(page, pages) {
    if (pages <= 1) return "";
    return `<div class="pager">
      <button type="button" class="btn" data-pager="prev"${page <= 1 ? " disabled" : ""}>上一页</button>
      <span class="pager-info">第 ${page} / ${pages} 页</span>
      <button type="button" class="btn" data-pager="next"${page >= pages ? " disabled" : ""}>下一页</button>
    </div>`;
  }

  // 与后端 DEFAULT_SETTINGS 保持一致的前端兜底
  const DEFAULT_SETTINGS = {
    site_title: "Moments",
    nav_feeds_name: "首页",
    essay_tips: "Moments · 轻博客",
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
    brand_avatar: "",
    author_name: "Moments",
    author_avatar: "",
    post_avatar: "",
    about_enabled: true,
    links_enabled: true,
    photos_enabled: true,
    links_categories: "技术\n设计\n生活随笔\n摄影",
    about_greeting: "先认识一下，再慢慢读。",
    about_greeting_sub: "记录生活中的每一个瞬间，图文、视频与心情。",
    about_avatar: "",
    about_signature: "一个热爱记录生活的普通人，写字、拍照、偶尔写点代码。",
    about_bio:
      "写了几年字，还在慢慢找自己的声音。\n\n" +
      "这里是我的小小角落，记录生活里那些值得停下的瞬间——可能是一段文字、一张照片、一首歌，或是某个忽然想说点什么的下午。\n\n" +
      "如果你也喜欢这样的节奏，欢迎常来坐坐。",
    about_stats: "坚持记录|多年|从开始写到现在\n记录天数|持续|几乎每天都在更新\n兴趣爱好|广泛|写字 拍照 音乐 代码",
    about_timeline:
      "2021|开始写博客|用文字记录生活的第一个节点\n" +
      "2023|第一次做独立站|从模板到自己动手，慢慢搭起这个小站\n" +
      "2025|上线轻博客 Moments|更专注于碎片化的日常记录",
    about_bigstats: "6|年记录\n120+|篇文字\n300+|张照片\n1000+|个瞬间",
    about_contacts:
      "GitHub|孤鸿剑尊|https://github.com/mliae\n邮箱|hi@jxe.me|mailto:hi@jxe.me\nRSS|订阅本站|/rss.xml",
  about_qr_text: "这里没有广告，全是一杯杯陈酿。扫码或留言，跟我打个招呼。",
  about_qr_amounts: "10元|请我喝杯咖啡\n30元|支持我继续写下去\n60元|加个鸡腿，再接再厉",
    nav_links: "",
    banner_button_url: "",
    banner_button_target: "_blank",
    banner_bg_image: "",
    footer_text: "",
    footer_run_since: "",
    feed_page_size: "20",
    video_default_poster: "",
    site_domain: "",
    r2_domain: "",
    ai_reply_enabled: false,
    ai_bot_name: "小J",
    ai_bot_avatar: "",
    ai_text_model: "",
    qq_nick_apis: "",
    site_icon: "",
  };

  const state = {
    admin: false,
    // 后台秘密入口路径（仅本机缓存；未登录时公开 API 不返回）
    adminPath: localStorage.getItem("moments_admin_path") || "/admin",
    voterId: getVoterId(),
    activeView: "", // 当前路由视图，防止快速切换时旧请求覆盖新页面
    feed: [],
    cursor: null,
    feedDone: false,
    feedLoading: false,
    commentTarget: null,
    settings: { ...DEFAULT_SETTINGS },
    adminTab: "overview",
    adminData: { moments: [], posts: [], comments: [] },
    music: {
      playlist: [],
      currentIndex: -1,
      isPlaying: false,
      isLoading: false,
      volume: 0.7,
      muted: false,
      playMode: (() => {
        // 播放模式：list 列表循环 / random 随机播放 / one 单曲循环（持久化）
        const m = localStorage.getItem("moments_playmode");
        return m === "random" || m === "one" ? m : "list";
      })(),
    },
  };

  marked.setOptions({ gfm: true, breaks: true });

  // 块级自定义占位（移植自 Jxe marked-extensions，文章/说说通用）
  marked.use({
    extensions: [
      {
        name: "musicIdBlock",
        level: "block",
        start(src) {
          return src.match(/^\[music=\d+\]/im)?.index;
        },
        tokenizer(src) {
          const m = src.match(/^\[music=(\d+)\][^\n\r]*(?:\r?\n|$)/i);
          if (!m) return undefined;
          return { type: "musicIdBlock", raw: m[0], songId: m[1] };
        },
        renderer(token) {
          const id = String(token.songId || "").replace(/[^\d]/g, "");
          return `<div class="music-block-card" data-song-id="${id}"><div class="mcc-skeleton"><span class="spinner"></span>加载音乐…</div></div>`;
        },
      },
      {
        // 块级视频：@[video](url) 或 @[video](url "封面URL")，仅允许 http(s)/站内路径
        name: "videoBlock",
        level: "block",
        start(src) {
          return src.match(/^@\[video\]/im)?.index;
        },
        tokenizer(src) {
          const m = src.match(/^@\[video\]\(([^)\s]+)(?:\s+"([^"]*)")?\)/);
          if (!m) return undefined;
          if (!/^(?:https?:\/\/|\/)/i.test(m[1])) return undefined;
          return { type: "videoBlock", raw: m[0], url: m[1].replace(/"/g, ""), poster: m[2] || "" };
        },
        renderer(token) {
          const url = String(token.url || "");
          const poster = resolveVideoPoster(token.poster);
          const posterAttr = poster ? ` poster="${esc(poster)}"` : "";
          const cls = /\.m3u8(?:[?#]|$)/i.test(url) ? "essay-media-video essay-media-video--hls" : "essay-media-video";
          const hlsAttrs = /\.m3u8(?:[?#]|$)/i.test(url) ? ` data-hls-src="${esc(url)}"` : ` src="${esc(url)}"`;
          return `<div class="article-video"><video class="${cls}"${hlsAttrs}${posterAttr} controls preload="none" playsinline></video></div>`;
        },
      },
      {
        // 行内高亮：==文字==
        name: "markInline",
        level: "inline",
        start(src) {
          return src.indexOf("==");
        },
        tokenizer(src) {
          const m = /^==([^=\n][^\n]*?)==/.exec(src);
          if (!m) return undefined;
          return { type: "markInline", raw: m[0], tokens: this.lexer.inlineTokens(m[1]) };
        },
        renderer(token) {
          return `<mark>${this.parser.parseInline(token.tokens)}</mark>`;
        },
      },
      {
        // 居中块：:::center 与 ::: 之间的内容整体居中（文章/说说通用）
        name: "centerBlock",
        level: "block",
        start(src) {
          return src.match(/^:::center\s*$/m)?.index;
        },
        tokenizer(src) {
          const m = src.match(/^:::center[ \t]*\r?\n([\s\S]*?)\r?\n:::[ \t]*(?:\r?\n|$)/);
          if (!m) return undefined;
          return { type: "centerBlock", raw: m[0], tokens: this.lexer.blockTokens(m[1]) };
        },
        renderer(token) {
          return `<div class="text-center">${this.parser.parse(token.tokens)}</div>`;
        },
      },
    ],
  });

  /* ================= 图标（iconify 内嵌） ================= */

  const ICONS = {
    clock: { vb: "0 0 384 512", d: "M256 0a256 256 0 1 1 0 512a256 256 0 1 1 0-512m-24 120v136c0 8 4 15.5 10.7 20l96 64c11 7.4 25.9 4.4 33.3-6.7s4.4-25.9-6.7-33.3L280 243.2V120c0-13.3-10.7-24-24-24s-24 10.7-24 24" },
    locationDot: { vb: "0 0 384 512", d: "M215.7 499.2C267 435 384 279.4 384 192C384 86 298 0 192 0S0 86 0 192c0 87.4 117 243 168.3 307.2c12.3 15.3 35.1 15.3 47.4 0M192 128a64 64 0 1 1 0 128a64 64 0 1 1 0-128" },
    heartFill: { vb: "0 0 512 512", d: "m47.6 300.4l180.7 168.7c7.5 7 17.4 10.9 27.7 10.9s20.2-3.9 27.7-10.9l180.7-168.7c30.4-28.3 47.6-68 47.6-109.5v-5.8c0-69.9-50.5-129.5-119.4-141c-45.6-7.6-92 7.3-124.6 39.9l-12 12l-12-12c-32.6-32.6-79-47.5-124.6-39.9C50.5 55.6 0 115.2 0 185.1v5.8c0 41.5 17.2 81.2 47.6 109.5" },
    heartLine: { vb: "0 0 512 512", d: "m225.8 468.2l-2.5-2.3L48.1 303.2C17.4 274.7 0 234.7 0 192.8v-3.3c0-70.4 50-130.8 119.2-144c39.4-7.6 79.7 1.5 111.8 24.1c9 6.4 17.4 13.8 25 22.3c4.2-4.8 8.7-9.2 13.5-13.3c3.7-3.2 7.5-6.2 11.5-9c32.1-22.6 72.4-31.7 111.8-24.2C462 58.6 512 119.1 512 189.5v3.3c0 41.9-17.4 81.9-48.1 110.4L288.7 465.9l-2.5 2.3c-8.2 7.6-19 11.9-30.2 11.9s-22-4.2-30.2-11.9M239.1 145c-.4-.3-.7-.7-1-1.1l-17.8-20l-.1-.1c-23.1-25.9-58-37.7-92-31.2c-46.6 8.9-80.2 49.5-80.2 96.9v3.3c0 28.5 11.9 55.8 32.8 75.2L256 430.7L431.2 268a102.7 102.7 0 0 0 32.8-75.2v-3.3c0-47.3-33.6-88-80.1-96.9c-34-6.5-69 5.4-92 31.2l-.1.1l-.1.1l-17.8 20c-.3.4-.7.7-1 1.1c-4.5 4.5-10.6 7-16.9 7s-12.4-2.5-16.9-7z" },
    chat: { vb: "0 0 24 24", d: "M10 3h4a8 8 0 1 1 0 16v3.5c-5-2-12-5-12-11.5a8 8 0 0 1 8-8" },
    plus: { vb: "0 0 448 512", d: "M256 80c0-17.7-14.3-32-32-32s-32 14.3-32 32v144H48c-17.7 0-32 14.3-32 32s14.3 32 32 32h144v144c0 17.7 14.3 32 32 32s32-14.3 32-32V288h144c17.7 0 32-14.3 32-32s-14.3-32-32-32H256z" },
    chevronLeft: { vb: "0 0 320 512", d: "M9.4 233.4c-12.5 12.5-12.5 32.8 0 45.3l192 192c12.5 12.5 32.8 12.5 45.3 0s12.5-32.8 0-45.3L77.3 256L246.6 86.6c12.5-12.5 12.5-32.8 0-45.3s-32.8-12.5-45.3 0l-192 192z" },
    chevronRight: { vb: "0 0 320 512", d: "M310.6 233.4c12.5 12.5 12.5 32.8 0 45.3l-192 192c-12.5 12.5-32.8 12.5-45.3 0s-12.5-32.8 0-45.3L242.7 256L73.4 86.6c-12.5-12.5-12.5-32.8 0-45.3s32.8-12.5 45.3 0l192 192z" },
    anglesRight: { vb: "0 0 512 512", d: "M470.6 278.6c12.5-12.5 12.5-32.8 0-45.3l-160-160c-12.5-12.5-32.8-12.5-45.3 0s-12.5 32.8 0 45.3L402.7 256L265.4 393.4c-12.5 12.5-12.5 32.8 0 45.3s32.8 12.5 45.3 0l160-160zm-352 160l160-160c12.5-12.5 12.5-32.8 0-45.3l-160-160c-12.5-12.5-32.8-12.5-45.3 0s-12.5 32.8 0 45.3L210.7 256L73.4 393.4c-12.5 12.5-12.5 32.8 0 45.3s32.8 12.5 45.3 0z" },
    moon: { vb: "0 0 384 512", d: "M223.5 32C100 32 0 132.3 0 256s100 224 223.5 224c60.6 0 115.5-24.2 155.8-63.4c5-4.9 6.3-12.5 3.1-18.7s-10.1-9.7-17-8.5c-9.8 1.7-19.8 2.6-30.1 2.6c-96.9 0-175.5-78.8-175.5-176c0-65.8 36-123.1 89.3-153.3c6.1-3.5 9.2-10.5 7.7-17.3s-7.3-11.9-14.3-12.5c-6.3-.5-12.6-.8-19-.8z" },
    sun: { vb: "0 0 512 512", d: "M361.5 1.2c5 2.1 8.6 6.6 9.6 11.9L391 121l107.9 19.8c5.3 1 9.8 4.6 11.9 9.6s1.5 10.7-1.6 15.2L446.9 256l62.3 90.3c3.1 4.5 3.7 10.2 1.6 15.2s-6.6 8.6-11.9 9.6L391 391l-19.9 107.9c-1 5.3-4.6 9.8-9.6 11.9s-10.7 1.5-15.2-1.6L256 446.9l-90.3 62.3c-4.5 3.1-10.2 3.7-15.2 1.6s-8.6-6.6-9.6-11.9L121 391L13.1 371.1c-5.3-1-9.8-4.6-11.9-9.6s-1.5-10.7 1.6-15.2L65.1 256L2.8 165.7c-3.1-4.5-3.7-10.2-1.6-15.2s6.6-8.6 11.9-9.6L121 121l19.9-107.9c1-5.3 4.6-9.8 9.6-11.9s10.7-1.5 15.2 1.6L256 65.1l90.3-62.3c4.5-3.1 10.2-3.7 15.2-1.6M160 256a96 96 0 1 1 192 0a96 96 0 1 1-192 0m224 0a128 128 0 1 0-256 0a128 128 0 1 0 256 0" },
    compass: { vb: "0 0 512 512", d: "M256 512a256 256 0 1 0 0-512a256 256 0 1 0 0 512m50.7-186.9l-144.3 55.5c-19.4 7.5-38.5-11.6-31-31l55.5-144.3c3.3-8.5 9.9-15.1 18.4-18.4l144.3-55.5c19.4-7.5 38.5 11.6 31 31l-55.5 144.3c-3.2 8.5-9.9 15.1-18.4 18.4M288 256a32 32 0 1 0-64 0a32 32 0 1 0 64 0" },
    arrowUpRight: { vb: "0 0 24 24", d: "M13.828 7.172a.997.997 0 0 0-1-1h-6a1 1 0 1 0 0 2h3.586l-3.95 3.95a1 1 0 0 0 1.415 1.414l3.95-3.95v3.586a1 1 0 0 0 2 0v-6zM10 20C4.477 20 0 15.523 0 10S4.477 0 10 0s10 4.477 10 10s-4.477 10-10 10" },
    trash: { vb: "0 0 448 512", d: "M135.2 17.7C140.6 6.8 151.7 0 163.8 0h120.4c12.1 0 23.2 6.8 28.6 17.7L320 32h96c17.7 0 32 14.3 32 32s-14.3 32-32 32H32C14.3 96 0 81.7 0 64s14.3-32 32-32h96zM32 128h384v320c0 35.3-28.7 64-64 64H96c-35.3 0-64-28.7-64-64zm96 64c-8.8 0-16 7.2-16 16v224c0 8.8 7.2 16 16 16s16-7.2 16-16V208c0-8.8-7.2-16-16-16m96 0c-8.8 0-16 7.2-16 16v224c0 8.8 7.2 16 16 16s16-7.2 16-16V208c0-8.8-7.2-16-16-16m96 0c-8.8 0-16 7.2-16 16v224c0 8.8 7.2 16 16 16s16-7.2 16-16V208c0-8.8-7.2-16-16-16" },
    /* —— 以下为 lucide 线性图标（多元素 path），用 stroke 字段；svgIcon 据此渲染描边风格 —— */
    home: { stroke: '<path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/>' },
    "layout-dashboard": { stroke: '<rect width="7" height="9" x="3" y="3" rx="1"/><rect width="7" height="5" x="14" y="3" rx="1"/><rect width="7" height="9" x="14" y="12" rx="1"/><rect width="7" height="5" x="3" y="16" rx="1"/>' },
    "message-circle": { stroke: '<path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/>' },
    "message-square": { stroke: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>' },
    "file-text": { stroke: '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M10 9H8"/><path d="M16 13H8"/><path d="M16 17H8"/>' },
    image: { stroke: '<rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/>' },
    palette: { stroke: '<circle cx="13.5" cy="6.5" r=".5" fill="currentColor"/><circle cx="17.5" cy="10.5" r=".5" fill="currentColor"/><circle cx="8.5" cy="7.5" r=".5" fill="currentColor"/><circle cx="6.5" cy="12.5" r=".5" fill="currentColor"/><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.965 6.012 17.461 2 12 2z"/>' },
    folder: { stroke: '<path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/>' },
    bot: { stroke: '<path d="M12 8V4H8"/><rect width="16" height="12" x="4" y="8" rx="2"/><path d="M2 14h2"/><path d="M20 14h2"/><path d="M15 13v2"/><path d="M9 13v2"/>' },
    shield: { stroke: '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/>' },
    "pen-nib": { stroke: '<path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"/><path d="m15 5 4 4"/>' },
    search: { stroke: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>' },
    smile: { stroke: '<circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><line x1="9" x2="9.01" y1="9" y2="9"/><line x1="15" x2="15.01" y1="9" y2="9"/>' },
    heart: { stroke: '<path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/>' },
    "thumbs-up": { stroke: '<path d="M7 10v12"/><path d="M15 5.88 14 10h5.83a2 2 0 0 1 1.92 2.56l-2.33 8A2 2 0 0 1 17.5 22H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2.76a2 2 0 0 0 1.79-1.11L12 2a3.13 3.13 0 0 1 3 3.88Z"/>' },
    star: { stroke: '<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>' },
    "party-popper": { stroke: '<path d="M5.8 11.3 2 22l10.7-3.79"/><path d="M4 3h.01"/><path d="M22 8h.01"/><path d="M15 2h.01"/><path d="M22 20h.01"/><path d="m22 2-2.24.75a2.9 2.9 0 0 0-1.96 3.12c.1.86-.57 1.63-1.45 1.63h-.38c-.86 0-1.6.6-1.76 1.44L14 10"/><path d="m22 13-.82-.33c-.86-.34-1.82.2-1.98 1.11c-.11.7-.72 1.22-1.43 1.22H17"/><path d="m11 2 .33.82c.34.86-.2 1.82-1.11 1.98C9.52 4.9 9 5.52 9 6.23V7"/><path d="M11 13c1.93 1.93 2.83 4.17 2 5-.83.83-3.07-.07-5-2-1.93-1.93-2.83-4.17-2-5 .83-.83 3.07.07 5 2Z"/>' },
    flame: { stroke: '<path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z"/>' },
    coffee: { stroke: '<path d="M10 2v2"/><path d="M14 2v2"/><path d="M16 8a1 1 0 0 1 1 1v8a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4V9a1 1 0 0 1 1-1h14a4 4 0 1 1 0 8h-1"/><path d="M6 2v2"/>' },
    sunLine: { stroke: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/>' },
    sparkles: { stroke: '<path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .962 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.962 0z"/><path d="M20 3v4"/><path d="M22 5h-4"/><path d="M4 17v2"/><path d="M5 18H3"/>' },
    music: { stroke: '<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>' },
    dices: { stroke: '<rect width="12" height="12" x="2" y="10" rx="2" ry="2"/><path d="m17.92 14 3.5-3.5a2.24 2.24 0 0 0 0-3l-5-4.92a2.24 2.24 0 0 0-3 0L10 6"/><path d="M6 18h.01"/><path d="M10 14h.01"/><path d="M15 6h.01"/><path d="M18 9h.01"/>' },
    lock: { stroke: '<rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>' },
    menu: { stroke: '<line x1="4" x2="20" y1="6" y2="6"/><line x1="4" x2="20" y1="12" y2="12"/><line x1="4" x2="20" y1="18" y2="18"/>' },
    "triangle-alert": { stroke: '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4"/><path d="M12 17h.01"/>' },
    gift: { stroke: '<rect x="3" y="8" width="18" height="4" rx="1"/><path d="M12 8v13"/><path d="M19 12v7a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-7"/><path d="M7.5 8a2.5 2.5 0 0 1 0-5A4.8 8 0 0 1 12 8a4.8 8 0 0 1 4.5-5 2.5 2.5 0 0 1 0 5"/>' },
    /* —— 关于我页面用到的图标 —— */
    quote: { stroke: '<path d="M3 21c3 0 7-1 7-8V5c0-1.25-.756-2.017-2-2H4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2 1 0 1 0 1 1v1c0 1-1 2-2 2s-1 .008-1 1.031V20c0 1 0 1 1 1z"/><path d="M15 21c3 0 7-1 7-8V5c0-1.25-.757-2.017-2-2h-4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2h.75c0 2.25.25 4-2.75 4v3c0 1 0 1 1 1z"/>' },
    "chevron-right": { stroke: '<path d="m9 18 6-6-6-6"/>' },
    github: { stroke: '<path d="M15 22v-4a4.8 4.8 0 0 0-1-3.5c3 0 6-2 6-5.5.08-1.25-.27-2.48-1-3.5.28-1.15.28-2.35 0-3.5 0 0-1 0-3 1.5-2.64-.5-5.36-.5-8 0C6 2 5 2 5 2c-.3 1.15-.3 2.35 0 3.5A5.4 5.4 0 0 0 4 9c0 3.5 3 5.5 6 5.5-.39.49-.68 1.05-.85 1.65-.17.6-.22 1.23-.15 1.85v4"/><path d="M9 18c-4.51 2-5-2-7-2"/>' },
    mail: { stroke: '<rect width="20" height="16" x="2" y="4" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/>' },
    rss: { stroke: '<path d="M4 11a9 9 0 0 1 9 9"/><path d="M4 4a16 16 0 0 1 16 16"/><circle cx="5" cy="19" r="1"/>' },
    "at-sign": { stroke: '<circle cx="12" cy="12" r="4"/><path d="M16 8v5a3 3 0 0 0 6 0v-1a10 10 0 1 0-4 8"/>' },
    send: { stroke: '<path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/>' },
    link: { stroke: '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>' },
    /* —— 友情链接页面用到的图标 —— */
    "arrow-up-right": { stroke: '<path d="M7 7h10v10"/><path d="M7 17 17 7"/>' },
    "arrow-right": { stroke: '<path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>' },
    "scroll-text": { stroke: '<path d="M15 12h-5"/><path d="M15 8h-5"/><path d="M19 17V5a2 2 0 0 0-2-2H4"/><path d="M8 21h12a2 2 0 0 0 2-2v-1a1 1 0 0 0-1-1H11a1 1 0 0 0-1 1v1a2 2 0 1 1-4 0V5a2 2 0 1 0-4 0v2a1 1 0 0 0 1 1h3"/>' },
    info: { stroke: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>' },
    check: { stroke: '<path d="M20 6 9 17l-5-5"/>' },
    "circle-user": { stroke: '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="10" r="3"/><path d="M7 20.662V19a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v1.662"/>' },
  };

  function svgIcon(name, size) {
    const ic = ICONS[name];
    if (!ic) return "";
    const s = size || 16;
    // stroke 字段：lucide 描边风（多元素 path，24 viewBox）
    if (ic.stroke) {
      return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="${s}" height="${s}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ic.stroke}</svg>`;
    }
    // { vb, d }：FontAwesome 填充风（兼容原有图标）
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${ic.vb}" width="${s}" height="${s}" fill="currentColor"><path fill="currentColor" d="${ic.d}"/></svg>`;
  }

  /* ================= 工具 ================= */

  function getVoterId() {
    let v = localStorage.getItem("moments_voter");
    if (!v) {
      v = (crypto.randomUUID && crypto.randomUUID()) || "v-" + Math.random().toString(36).slice(2) + Date.now().toString(36);
      localStorage.setItem("moments_voter", v);
    }
    return v;
  }

  function esc(s) {
    return String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  /** 相对时间（与原站 formatRelativeTime 一致） */
  function timeAgo(dateString) {
    if (!dateString) return "";
    const date = new Date(dateString);
    if (Number.isNaN(date.getTime())) return "";
    const seconds = Math.floor((new Date().getTime() - date.getTime()) / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);
    const months = Math.floor(days / 30);
    const years = Math.floor(days / 365);
    if (seconds < 60) return "刚刚";
    if (minutes < 60) return `${minutes}分钟前`;
    if (hours < 24) return `${hours}小时前`;
    if (days < 30) return `${days}天前`;
    if (months < 12) return `${months}个月前`;
    return `${years}年前`;
  }

  /** 从 markdown 内容提取纯文本摘要 */
  function plainText(content, maxLen) {
    const text = String(content || "")
      .replace(/\[music=\d+\]/gi, "")
      .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
      .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replace(/<[^>]+>/g, "")
      .replace(/[#*`>~_]/g, "")
      .replace(/\s+/g, " ")
      .trim();
    return text.length > maxLen ? text.slice(0, maxLen) + "…" : text;
  }

  let toastTimer = null;
  function toast(msg) {
    const el = document.getElementById("toast");
    el.textContent = msg;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (el.hidden = true), 2400);
  }

  async function api(path, options = {}) {
    // 携带 body/form 时若未显式指定方法，默认 POST（GET/HEAD 不允许有 body）
    const inferredMethod = options.body !== undefined || options.form ? "POST" : "GET";
    const opts = { method: options.method || inferredMethod, headers: {}, credentials: "same-origin" };
    if (options.form) {
      opts.body = options.form;
    } else if (options.body !== undefined) {
      opts.headers["Content-Type"] = "application/json";
      opts.body = JSON.stringify(options.body);
    }
    const res = await fetch(path, opts);
    let json = null;
    try {
      json = await res.json();
    } catch (_) {}
    if (!res.ok || !json || json.code !== 200) {
      const err = new Error((json && json.message) || "请求失败 (" + res.status + ")");
      err.status = res.status;
      throw err;
    }
    return json.data;
  }

  /**
   * 从原图 src 推导缩略图 URL（/media/ 路径插入 _w1200.jpg 后缀；外链/GIF/已带后缀原样返回）。
   * 展示用缩略图，data-lightbox 用原图 → 点击查看原图。
   */
  function thumbSrc(src) {
    if (!src) return src;
    // 站内资源：/media/ 代理路径 或 R2 直连域名，才做缩略图转换
    const r2 = (state.settings?.r2_domain || "").replace(/\/$/, "");
    const isLocal = src.includes("/media/") || (r2 && src.startsWith(r2 + "/"));
    if (!isLocal) return src; // 外链不处理
    if (src.includes("_w1200.")) return src; // 已是缩略图
    if (/\.gif(?:$|[?#])/i.test(src)) return src; // GIF 保动画，不换
    return src.replace(/\.([^.]+)$/, "_w1200.jpg");
  }

  /** 缩略图 404 兜底：历史图/生成失败的图 R2 上没有 _w1200.jpg，回退加载原图避免裂图。
   *  error 事件不冒泡，用捕获阶段委托。回退后移除 data-orig 防止原图也 404 时死循环。 */
  document.addEventListener(
    "error",
    e => {
      const el = e.target;
      if (el && el.tagName === "IMG" && el.dataset.orig && el.getAttribute("src") !== el.dataset.orig) {
        el.src = el.dataset.orig;
        el.removeAttribute("data-orig");
      }
    },
    true
  );

  /* ---------- 后台：重建历史缩略图 ----------
   * 遍历 feed+photos 全部站内图片，HEAD 检查 _w1200.jpg，缺失的下载原图→canvas 缩图→
   * 按指定 key 上传（/api/admin/upload 带 key 字段，仅允许 uploads/*_w1200.jpg）。
   * 全程走 /media/ 代理（同源无 CORS 依赖），一次性任务可接受 Worker 消耗。 */
  async function rebuildAllThumbs(btn) {
    const setMsg = t => {
      const m = document.querySelector("[data-rebuild-thumbs-msg]");
      if (m) m.textContent = t;
    };
    if (btn.disabled) return;
    if (!confirm("遍历全站图片并为缺失的缩略图生成补传。\n图片多时耗时较长，确定开始？")) return;
    btn.disabled = true;
    try {
      const r2 = (state.settings?.r2_domain || "").replace(/\/$/, "");
      const keyFrom = src => {
        if (!src) return null;
        try {
          if (src.includes("/media/")) {
            const k = decodeURIComponent(src.split("/media/")[1].split(/[?#]/)[0]);
            return k.startsWith("uploads/") ? k : null;
          }
          if (r2 && src.startsWith(r2 + "/")) {
            const k = decodeURIComponent(src.slice(r2.length + 1).split(/[?#]/)[0]);
            return k.startsWith("uploads/") ? k : null;
          }
        } catch {}
        return null;
      };
      const keys = new Set();
      let cursor = "";
      setMsg("正在收集图片列表…");
      for (;;) {
        const d = await api("/api/feed?limit=50" + (cursor ? "&cursor=" + encodeURIComponent(cursor) : ""));
        (d.list || []).forEach(it => {
          (it.images || []).forEach(s => {
            const k = keyFrom(s);
            if (k) keys.add(k);
          });
          if (it.cover) {
            const k = keyFrom(it.cover);
            if (k) keys.add(k);
          }
        });
        cursor = d.nextCursor || "";
        if (!cursor) break;
      }
      let page = 1;
      for (;;) {
        const d = await api(`/api/photos?page=${page}&per_page=50`);
        const list = d.list || [];
        list.forEach(p => {
          const k = keyFrom(p.src);
          if (k) keys.add(k);
        });
        if (list.length < 50) break;
        page++;
      }
      const targets = [...keys].filter(k => !/_w1200\.jpg$/i.test(k) && !/\.gif$/i.test(k));
      // 带超时的 fetch：单张请求超过 30s 自动中止，避免某张图卡住导致整个任务“假死”
      const fetchWithTimeout = (url, opts = {}, ms = 30000) => {
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), ms);
        return fetch(url, { ...opts, signal: ctrl.signal }).finally(() => clearTimeout(t));
      };
      let done = 0, made = 0, missing = 0, failed = 0;
      for (const key of targets) {
        done++;
        setMsg(`重建缩略图 ${done}/${targets.length}（已补 ${made}）…`);
        const thumbKey = key.replace(/\.([^.]+)$/i, "_w1200.jpg");
        try {
          const head = await fetchWithTimeout("/media/" + encodeURI(thumbKey), { method: "HEAD" });
          if (head.ok) continue;
          const resp = await fetchWithTimeout("/media/" + encodeURI(key));
          if (!resp.ok) { missing++; continue; }
          const blob = await resp.blob();
          const file = new File([blob], key.split("/").pop() || "img", { type: blob.type || "image/jpeg" });
          const thumb = await generateThumb(file);
          if (!thumb) { failed++; continue; }
          const fd = new FormData();
          fd.append("file", thumb, "thumb.jpg");
          fd.append("kind", "image");
          fd.append("key", thumbKey);
          const res = await fetchWithTimeout("/api/admin/upload", { method: "POST", body: fd, credentials: "same-origin" });
          if (res.ok) made++; else failed++;
        } catch {
          failed++; // 超时/网络异常：记入失败，继续下一张，不中断整体任务
        }
      }
      setMsg(`完成：共 ${targets.length} 张，补生成 ${made} 张${missing ? `，${missing} 张原图缺失` : ""}${failed ? `，${failed} 张失败` : ""}`);
      toast(`缩略图重建完成（${made}/${targets.length}）${failed ? `，${failed} 张失败` : ""}`);
    } catch (err) {
      setMsg("失败：" + err.message);
      toast(err.message);
    } finally {
      btn.disabled = false;
    }
  }
  document.addEventListener("click", e => {
    const btn = e.target?.closest?.("[data-rebuild-thumbs]");
    if (btn) rebuildAllThumbs(btn);
  });

  /**
   * 上传前用 canvas 生成缩略图（最长边 1200px、JPEG 82%），与原图一起上传到 R2。
   * 展示用缩略图，原图仅「查看原图」时加载。
   * GIF 跳过（保动画），失败返回 null（不影响上传）。
   */
  async function generateThumb(file) {
    // GIF 跳过（保动画，thumbSrc 同步豁免 GIF）；其余一律生成——
    // 展示端 thumbSrc 会无条件把站内图替换成 _w1200.jpg，小图不生成会导致 404 裂图
    if (file.type === "image/gif") return null;
    const MAX_EDGE = 1200;
    let bitmap = null;
    try {
      if (window.createImageBitmap) {
        try {
          bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
        } catch {
          bitmap = await createImageBitmap(file);
        }
      } else {
        const url = URL.createObjectURL(file);
        try {
          bitmap = await new Promise((res, rej) => {
            const el = new Image();
            el.onload = () => res(el);
            el.onerror = rej;
            el.src = url;
          });
        } finally {
          setTimeout(() => URL.revokeObjectURL(url), 1000);
        }
      }
      const W = bitmap.width;
      const H = bitmap.height;
      // 始终生成 _w1200.jpg 缩略图：展示端 thumbSrc 无条件把站内图改写成 _w1200.jpg，
      // 若小图不生成缩略图，前端请求会 404（控制台 ORB 报错 + 回退加载原图拖慢首页）。
      // 小于 1200px 的按原尺寸重编码为 jpeg，保证每张站内图都有对应缩略图。
      const scale = Math.min(1, MAX_EDGE / Math.max(W, H));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(W * scale));
      canvas.height = Math.max(1, Math.round(H * scale));
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      return await new Promise(res => canvas.toBlob(b => res(b), "image/jpeg", 0.82));
    } catch {
      return null;
    } finally {
      bitmap?.close?.();
    }
  }

  /* ================= 视频转码（HEVC → H.264，ffmpeg.wasm 按需加载） =================
     现象：iPhone 录制视频默认 HEVC(hvc1)，Firefox/部分 Chrome 不能解码 → 有声音没画面。
     方案：上传前在浏览器中用 ffmpeg.wasm 转码 HEVC → H.264(avc1) + AAC，所有浏览器可播。
     - 主类托管在 /vendor/ffmpeg.js + /vendor/814.ffmpeg.js（worker）
     - ffmpeg-core.wasm(约 32MB) 从 jsdelivr CDN 加载，超出 Workers 静态资源单文件 25MB 限制
     - 仅检测到 HEVC 时才加载，H.264 视频直传无影响
  */
  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const existing = document.querySelector(`script[data-src="${src}"]`);
      if (existing && existing.dataset.loaded === "1") return resolve();
      if (existing) {
        existing.addEventListener("load", () => resolve(), { once: true });
        existing.addEventListener("error", () => reject(new Error("加载失败: " + src)), { once: true });
        return;
      }
      const el = document.createElement("script");
      el.src = src;
      el.dataset.src = src;
      el.async = true;
      el.onload = () => { el.dataset.loaded = "1"; resolve(); };
      el.onerror = () => reject(new Error("加载失败: " + src));
      document.head.appendChild(el);
    });
  }

  let _ffmpegPromise = null;
  function loadFfmpeg() {
    if (_ffmpegPromise) return _ffmpegPromise;
    _ffmpegPromise = (async () => {
      try {
        await loadScript("/vendor/ffmpeg.js?v=20260920o");
        if (!window.FFmpegWASM || !window.FFmpegWASM.FFmpeg) throw new Error("ffmpeg 加载失败");
        const ffmpeg = new window.FFmpegWASM.FFmpeg();
        await ffmpeg.load({
          coreURL: "https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.6/dist/umd/ffmpeg-core.js",
          wasmURL: "https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.6/dist/umd/ffmpeg-core.wasm"
        });
        return ffmpeg;
      } catch (err) {
        // 加载/初始化失败必须清空缓存，否则之后所有 HEVC 上传都会拿到同一个
        // rejected Promise，永久不可用，只能刷新页面
        _ffmpegPromise = null;
        throw err;
      }
    })();
    return _ffmpegPromise;
  }

  /** 在 buffer 中查找 hvc1/hev1 四字节标识 */
  function bufferHasHevcFourcc(buf) {
    const len = buf.length - 3;
    for (let i = 0; i < len; i++) {
      // hvc1 = 0x68 0x76 0x63 0x31
      if (buf[i] === 0x68 && buf[i + 1] === 0x76 && buf[i + 2] === 0x63 && buf[i + 3] === 0x31) return true;
      // hev1 = 0x68 0x65 0x76 0x31
      if (buf[i] === 0x68 && buf[i + 1] === 0x65 && buf[i + 2] === 0x76 && buf[i + 3] === 0x31) return true;
    }
    return false;
  }

  /** 检测 MP4 是否 HEVC：moov 可能在文件头（faststart/iPhone）也可能在文件尾
   *  （安卓/剪映非 faststart 导出），头尾各扫 2MB 避免漏检 */
  async function detectHevcMp4(file) {
    const CHUNK = 2 * 1024 * 1024;
    try {
      const ranges = [];
      ranges.push([0, Math.min(file.size, CHUNK)]);
      if (file.size > CHUNK) ranges.push([Math.max(0, file.size - CHUNK), file.size]);
      for (const [start, end] of ranges) {
        const buf = new Uint8Array(await file.slice(start, end).arrayBuffer());
        if (bufferHasHevcFourcc(buf)) return true;
      }
      return false;
    } catch {
      return false;
    }
  }

  /** 浏览器转码 HEVC MP4 → H.264 MP4；onProgress(ratio 0~1) */
  async function transcodeHevcToAvc(file, onProgress) {
    const ffmpeg = await loadFfmpeg();
    const inName = "in.mp4";
    const outName = "out.mp4";
    const data = new Uint8Array(await file.arrayBuffer());
    await ffmpeg.writeFile(inName, data);
    const onProg = e => {
      if (typeof e?.progress === "number") onProgress?.(Math.max(0, Math.min(1, e.progress)));
    };
    ffmpeg.on("progress", onProg);
    try {
      // 注意：不用 -movflags +faststart。progress 到 100% 只代表视频帧编码完成，
      // 之后还有音频封装；faststart 需要在 wasm 内存里把整个输出文件再复制一遍，
      // 大视频（iPhone 100MB 级）极易在此卡死假死。moov 在尾时 R2 与 /media/ 代理
      // 都支持 Range 请求，浏览器照样秒开可播。
      // 另加超时兜底：wasm 内大文件转码偶发假死，超时后 terminate 实例报错。
      const EXEC_TIMEOUT = 8 * 60 * 1000;
      let timer;
      await Promise.race([
        ffmpeg.exec([
          "-i", inName,
          "-c:v", "libx264",
          "-preset", "veryfast",
          "-crf", "23",
          "-pix_fmt", "yuv420p",
          "-c:a", "aac",
          "-b:a", "128k",
          outName
        ]),
        new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("转码超时，请压缩视频后重试")), EXEC_TIMEOUT); }),
      ]).finally(() => clearTimeout(timer));
    } catch (err) {
      // 失败/超时：终止 wasm 实例并清空缓存，下次上传自动重新加载转码器
      try { ffmpeg.terminate(); } catch {}
      _ffmpegPromise = null;
      throw err;
    } finally {
      ffmpeg.off("progress", onProg);
      try { await ffmpeg.deleteFile(inName); } catch {}
    }
    const out = await ffmpeg.readFile(outName, "binary");
    try { await ffmpeg.deleteFile(outName); } catch {}
    const base = file.name.replace(/\.mp4$/i, "");
    return new File([out], base + ".mp4", { type: "video/mp4" });
  }

  function uploadFile(file, kind, onProgress, thumb) {
    return new Promise((resolve, reject) => {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("kind", kind);
      if (thumb) fd.append("thumb", thumb, "thumb.jpg");
      const xhr = new XMLHttpRequest();
      xhr.open("POST", "/api/admin/upload");
      xhr.onload = () => {
        try {
          const j = JSON.parse(xhr.responseText);
          if (xhr.status >= 200 && xhr.status < 300 && j.code === 200) resolve(j.data);
          else reject(new Error(j.message || "上传失败"));
        } catch (_) {
          reject(new Error("上传失败"));
        }
      };
      xhr.onerror = () => reject(new Error("网络错误，上传失败"));
      if (onProgress && xhr.upload) {
        xhr.upload.onprogress = e => {
          if (e.lengthComputable) onProgress(e.loaded / e.total);
        };
      }
      xhr.send(fd);
    });
  }

  /** 图片原图直传 + 同时生成缩略图；视频原样直传 */
  async function uploadMedia(file, kind, onProgress) {
    if (kind === "image" && file.type.startsWith("image/")) {
      onProgress?.(0);
      const thumb = await generateThumb(file);
      return uploadFile(file, kind, onProgress, thumb);
    }
    return uploadFile(file, kind, onProgress);
  }

  /** marked 输出净化（纵深防御）+ 图片缩略图替换 */
  function sanitizeHtml(html) {
    const tpl = document.createElement("template");
    tpl.innerHTML = html;
    tpl.content.querySelectorAll("script,iframe,object,embed,link,meta,style,form,input,button").forEach(n => n.remove());
    // 图片增强：用缩略图 src，原图存 data-orig + data-lightbox 供查看
    tpl.content.querySelectorAll("img[src]").forEach(el => {
      const src = el.getAttribute("src") || "";
      const ts = thumbSrc(src);
      if (ts !== src) {
        el.setAttribute("src", ts);
        el.setAttribute("data-orig", src);
        el.setAttribute("data-lightbox", src);
      }
    });
    tpl.content.querySelectorAll("*").forEach(el => {
      [...el.attributes].forEach(attr => {
        const name = attr.name.toLowerCase();
        if (name.startsWith("on")) el.removeAttribute(attr.name);
        if ((name === "href" || name === "src") && /^\s*javascript:/i.test(attr.value)) {
          el.removeAttribute(attr.name);
        }
      });
      if (el.tagName === "A") {
        el.setAttribute("target", "_blank");
        el.setAttribute("rel", "noopener noreferrer");
      }
    });
    return tpl.innerHTML;
  }

  function renderContentHtml(content) {
    if (!content) return "";
    return sanitizeHtml(marked.parse(content));
  }

  /** 等待下一帧；隐藏窗口下 rAF 会被暂停，用短超时兜底 */
  function nextFrame() {
    return new Promise(resolve => {
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        resolve();
      };
      window.requestAnimationFrame(finish);
      window.setTimeout(finish, 120);
    });
  }

  /* ================= 模态 ================= */
  // 弹窗打开时锁定背景滚动，避免手机端弹窗与背景争抢滚动导致抖动；
  // 用计数兼容嵌套弹窗（如评论弹窗里再开图片灯箱）
  let modalOpenCount = 0;
  function lockBodyScroll() {
    if (modalOpenCount === 0) document.body.style.overflow = "hidden";
    modalOpenCount++;
  }
  function unlockBodyScroll() {
    modalOpenCount = Math.max(0, modalOpenCount - 1);
    if (modalOpenCount === 0) document.body.style.overflow = "";
  }

  /**
   * 把表情面板重新定位到当前 textarea 上方（键盘弹起 / 视口变化后调用，
   * 避免面板被键盘遮挡或位置过时）。
   */
  function repositionEmojiPanel() {
    const panel = document.getElementById("emojiPanel");
    const ta = emojiPanelTarget;
    if (!panel || !ta || !ta.isConnected) return;
    const rect = ta.getBoundingClientRect();
    panel.style.left = rect.left + "px";
    panel.style.bottom = window.innerHeight - rect.top + 4 + "px";
  }

  /**
   * 手机端键盘适配：键盘弹起时把弹窗内容（含底部输入框）顶到键盘之上，
   * 并把当前聚焦元素滚入可视区，避免评论框被输入法遮挡。
   * 返回清理函数，closeModal 时调用。
   */
  function bindKeyboardAware(modal) {
    const vv = window.visualViewport;
    if (!vv) return () => {};
    let raf = 0;
    let lastKbd = -1; // 上次应用的键盘高度，用于阈值去抖
    let wasOpen = false; // 键盘是否处于弹起状态（只在收起→弹起时滚一次）

    const scrollFocused = () => {
      const el = document.activeElement;
      if (el && modal.contains(el) && typeof el.scrollIntoView === "function") {
        el.scrollIntoView({ block: "nearest" });
      }
    };

    const onViewport = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        // 键盘高度 = 布局视口高 - 可视视口高 - 可视视口偏移
        const kbd = Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop));
        // 阈值去抖：忽略地址栏伸缩等小幅抖动（<20px 不响应），减少跳动
        if (Math.abs(kbd - lastKbd) >= 20) {
          lastKbd = kbd;
          modal.style.paddingBottom = kbd > 0 ? kbd + 12 + "px" : "";
        }
        // 仅在键盘「收起→弹起」的瞬间滚一次，避免与浏览器原生滚动反复打架
        if (kbd > 0 && !wasOpen) {
          wasOpen = true;
          scrollFocused();
        } else if (kbd === 0) {
          wasOpen = false;
        }
        repositionEmojiPanel(); // 表情面板跟随键盘重定位
      });
    };
    // 键盘已弹起时切换到另一个输入框，也滚一次
    const onFocus = () => { if (wasOpen) scrollFocused(); };

    vv.addEventListener("resize", onViewport);
    vv.addEventListener("scroll", onViewport);
    modal.addEventListener("focusin", onFocus);
    return () => {
      vv.removeEventListener("resize", onViewport);
      vv.removeEventListener("scroll", onViewport);
      modal.removeEventListener("focusin", onFocus);
      cancelAnimationFrame(raf);
      modal.style.paddingBottom = "";
    };
  }

  function openModal(html, opts) {
    lockBodyScroll();
    modalRoot.innerHTML = `
      <div class="modal-mask">
        <div class="modal${opts?.size === "lg" ? " modal-lg" : ""}" role="dialog">${html}</div>
      </div>`;
    const mask = modalRoot.querySelector(".modal-mask");
    const modal = modalRoot.querySelector(".modal");
    modal._kbCleanup = bindKeyboardAware(modal);
    mask.addEventListener("click", e => {
      if (e.target !== mask) return;
      // 编辑器类弹窗（含文本输入框）点外部不关闭，防止误点丢内容；
      // 确认类小弹窗（无输入控件）保留点遮罩关闭的习惯
      if (modalRoot.querySelector(".modal textarea, .modal input[type='text'], .modal input[type='url'], .modal input[type='email'], .modal input[type='password']")) return;
      closeModal();
    });
    return modal;
  }
  function closeModal() {
    document.querySelectorAll(".md-menu").forEach(m => m.remove()); // 编辑器下拉菜单挂在 body，需手动清理
    // 必须先停掉弹窗内所有视频：直接 innerHTML="" 会让正在播放的 MP4 继续发声、
    // HLS 实例不 destroy 继续后台拉分片
    disposeVideos(modalRoot);
    const modal = modalRoot.querySelector(".modal");
    if (modal && typeof modal._kbCleanup === "function") modal._kbCleanup();
    modalRoot.innerHTML = "";
    unlockBodyScroll();
  }

  /* ================= 图片灯箱（幻影灯） ================= */

  let lightboxState = null;

  function renderLightbox() {
    if (!lightboxState) return;
    const { group, index } = lightboxState;
    const src = group[index];
    const multi = group.length > 1;
    lightboxRoot.innerHTML = `
      <div class="lightbox-mask" data-lb-close>
        <button type="button" class="lightbox-close" data-lb-close aria-label="关闭">×</button>
        ${
          multi
            ? `<button type="button" class="lightbox-nav lightbox-prev" data-lb-prev aria-label="上一张">‹</button>
               <button type="button" class="lightbox-nav lightbox-next" data-lb-next aria-label="下一张">›</button>
               <div class="lightbox-index">${index + 1} / ${group.length}</div>`
            : ""
        }
        <img class="lightbox-img" src="${esc(src)}" alt="" />
        <span class="lightbox-orig-tip">原图 · 右键可保存</span>
      </div>`;
  }

  function openLightbox(src, group) {
    lightboxState = { group: group.filter(Boolean), index: Math.max(0, group.indexOf(src)) };
    lockBodyScroll();
    renderLightbox();
  }

  function closeLightbox() {
    lightboxState = null;
    lightboxRoot.innerHTML = "";
    unlockBodyScroll();
  }

  function moveLightbox(delta) {
    if (!lightboxState) return;
    const n = lightboxState.group.length;
    lightboxState.index = (lightboxState.index + delta + n) % n;
    renderLightbox();
  }

  // 事件委托：点击任意 [data-lightbox] 打开；灯箱内按钮/遮罩处理
  document.addEventListener("click", e => {
    const trigger = e.target.closest?.("[data-lightbox]");
    if (trigger) {
      e.preventDefault();
      const wrap = trigger.closest(".bber-container-img") || trigger.parentElement;
      const group = [...wrap.querySelectorAll("[data-lightbox]")].map(a => a.getAttribute("data-lightbox"));
      openLightbox(trigger.getAttribute("data-lightbox"), group);
      return;
    }
    if (!lightboxState) return;
    const t = e.target;
    if (t.closest("[data-lb-prev]")) moveLightbox(-1);
    else if (t.closest("[data-lb-next]")) moveLightbox(1);
    else if (t.closest("[data-lb-close]") && !t.closest(".lightbox-img")) closeLightbox();
  });

  document.addEventListener("keydown", e => {
    if (!lightboxState) return;
    // 灯箱打开时独占键盘：阻止模态的 ESC 处理器连带关闭评论弹窗
    e.stopImmediatePropagation();
    if (e.key === "Escape") closeLightbox();
    else if (e.key === "ArrowLeft") moveLightbox(-1);
    else if (e.key === "ArrowRight") moveLightbox(1);
  });

  // 缩略图加载失败 → 自动回退原图（老图片没有 _w1200 缩略图时触发）
  document.addEventListener("error", e => {
    const img = e.target;
    if (img && img.tagName === "IMG" && img.dataset.orig && img.src !== img.dataset.orig) {
      img.src = img.dataset.orig;
    }
  }, true);

  /* ================= 视频 ================= */

  /**
   * 浏览器截取视频封面帧：创建隐藏 <video>，seek 到 1 秒处，canvas 截图 → JPEG Blob。
   * 失败返回 null（不阻断上传）。CORS 限制下外链视频可能截取失败。
   */
  async function extractVideoPoster(file) {
    const MAX_W = 1280;
    let url = null;
    let v = null;
    try {
      url = URL.createObjectURL(file);
      v = document.createElement("video");
      v.muted = true;
      v.playsInline = true;
      v.preload = "auto"; // 手机需要 auto，metadata 不够 seek
      v.crossOrigin = "anonymous";
      v.src = url;

      // 等 metadata 加载
      await new Promise((res, rej) => {
        v.onloadedmetadata = res;
        v.onerror = rej;
        setTimeout(rej, 10000);
      });

      // 手机（尤其 iOS Safari）必须 play() 后才能 seek，否则 seeked 事件永远不触发
      try {
        await v.play();
      } catch {
        // 某些浏览器 play() 被 block 也没关系，继续尝试 seek
      }

      const t = Math.min(1, (v.duration || 10) * 0.1);
      await new Promise((res, rej) => {
        const done = () => { cleanup(); res(); };
        const fail = () => { cleanup(); rej(new Error("seek timeout")); };
        const cleanup = () => {
          v.removeEventListener("seeked", done);
        };
        v.addEventListener("seeked", done, { once: true });
        try { v.currentTime = t; } catch { done(); }
        setTimeout(fail, 8000);
      });

      try { v.pause(); } catch {}

      // 等 frame 渲染到屏幕上
      await new Promise(r => setTimeout(r, 150));

      const W = v.videoWidth;
      const H = v.videoHeight;
      if (!W || !H) throw new Error("no video frame");
      const scale = W > MAX_W ? MAX_W / W : 1;
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(W * scale));
      canvas.height = Math.max(1, Math.round(H * scale));
      const ctx = canvas.getContext("2d");
      ctx.drawImage(v, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      const blob = await new Promise(res => canvas.toBlob(b => res(b), "image/jpeg", 0.82));
      // 截帧结果校验：blob 过小说明画出了空白/纯黑帧（如解码失败的 HEVC 视频），
      // 视为截帧失败返回 null，避免把 1x1/纯黑废图当封面上传
      if (!blob || blob.size < 3072) return null;
      return blob;
    } catch {
      try { if (url) URL.revokeObjectURL(url); } catch {}
      return null;
    } finally {
      try { if (v) v.src = ""; } catch {}
    }
  }
  // 视频封面：视频自带封面优先，否则用后台"统一默认封面"（存量数据无需改库即生效）
  function resolveVideoPoster(own) {
    const p = own || state.settings?.video_default_poster || "";
    return /^(?:https?:\/\/|\/)/i.test(p) ? p : "";
  }

  function videoHtml(video) {
    if (!video || !video.src) return "";
    const poster = resolveVideoPoster(video.poster);
    const posterAttr = poster ? ` poster="${esc(poster)}"` : "";
    if (video.kind === "hls") {
      return `<video class="essay-media-video essay-media-video--hls" data-hls-src="${esc(video.src)}"${posterAttr} controls preload="none" playsinline></video>`;
    }
    return `<video class="essay-media-video" src="${esc(video.src)}"${posterAttr} controls preload="none" playsinline></video>`;
  }

  // 外链媒体（封面图等）统一走自家 Worker 反代：部分图床域名在国内被 TLS 阻断，
  // 浏览器直连永远失败；站内相对路径原样返回
  function proxiedMedia(url) {
    if (!url || !/^https?:\/\//i.test(url)) return url;
    try {
      const u = new URL(url, location.origin);
      // R2 直连域名：文件本就可公网访问，原样保留——不能转 pathname，
      // Worker 站点上不存在 /uploads/ 路径（站内媒体走 /media/<key>），转了必 404
      const r2Host = state.settings?.r2_domain ? new URL(state.settings.r2_domain, location.origin).host : "";
      if (r2Host && u.host === r2Host) return url;
      // 当前站点域名：转相对路径（/media/<key> 在本站有效）
      if (u.host === location.host) return u.pathname + u.search + u.hash;
      // 其他外链：走 imgproxy 反代（防被墙/防盗链）
      return "/imgproxy?u=" + encodeURIComponent(url);
    } catch {
      return url;
    }
  }

  function hydrateVideos(root) {
    // 预连接外部视频域名（提前建 TCP 连接，HLS 首请求快几百毫秒）
    const preconnected = new Set();
    root.querySelectorAll("video.essay-media-video").forEach(v => {
      const raw = v.src || v.dataset.hlsSrc || "";
      const m = raw.match(/^https?:\/\/([^/]+)/i);
      if (m && !preconnected.has(m[1])) {
        preconnected.add(m[1]);
        const link = document.createElement("link");
        link.rel = "preconnect";
        link.href = `${m[0].split("/")[0]}//${m[1]}`;
        document.head.appendChild(link);
      }
    });
    // 封面：直接用 <video> 原生 poster 属性，配合 CSS object-fit:cover 充满容器。
    // 不叠 overlay <img>——overlay 会在移动端盖住原生控制条（播放/进度条/全屏），
    // 体验差。原生 poster 由浏览器在视频播放后自动隐藏；HEVC 解码失败时永远不隐藏
    // （兜底：至少能看到封面）。外链封面走 /imgproxy 由 Worker 回源（国内图床被墙）。
    //
    // 中间播放按钮：仅在桌面端（fine pointer）显示。
    // 原因：移动端浏览器（iOS Safari / 移动版 Edge / Android Chrome）会在视频画面中央
    // 自动渲染原生大播放按钮，若再加自定义按钮会出现两个按钮重叠。移动端原生控制条
    // 体验更好（系统级全屏手势等），直接用原生；桌面端浏览器不显示中央按钮，用我们的。
    const isTouchDevice = window.matchMedia && window.matchMedia("(pointer: coarse)").matches;
    root.querySelectorAll("video.essay-media-video:not([data-poster-attached])").forEach(v => {
      v.dataset.posterAttached = "1";
      const p = v.getAttribute("poster") || "";
      if (p) v.setAttribute("poster", proxiedMedia(p));
      // 包定位容器（仅未包过时）
      if (!v.parentElement.classList.contains("video-stage")) {
        const stage = document.createElement("div");
        stage.className = "video-stage";
        v.parentNode.insertBefore(stage, v);
        stage.appendChild(v);
      }
      const stage = v.parentElement;
      // 桌面端：加居中播放按钮（点击播放，播放中隐藏）；移动端不挂，用浏览器原生按钮
      if (!isTouchDevice && !stage.querySelector(".video-play-btn")) {
        const btn = document.createElement("span");
        btn.className = "video-play-btn";
        btn.setAttribute("role", "button");
        btn.setAttribute("aria-label", "播放视频");
        btn.tabIndex = 0;
        const tryPlay = () => v.play().catch(() => {});
        btn.addEventListener("click", tryPlay);
        btn.addEventListener("keydown", e => {
          if (e.key === "Enter" || e.key === " ") { e.preventDefault(); tryPlay(); }
        });
        stage.appendChild(btn);
      }
      // 播放中切换 object-fit:contain，保证视频内容不被裁切；
      // ended 后切回 cover（封面重新显示，充满无黑边）
      v.addEventListener("playing", () => v.classList.add("is-playing"));
      v.addEventListener("ended", () => v.classList.remove("is-playing"));
      // 竖屏视频自适应：metadata 后写入真实宽高比，避免固定 16:9 导致两侧黑边；
      // 竖屏另加 video-portrait 类（CSS 限高居中），否则 width:100% 时高度≈1.78×容器宽
      // 会把卡片/整页布局撑爆——竖屏是起播加载 metadata 后才突变，正是"点播放后撑变形"根因
      const applyRatio = () => {
        const W = v.videoWidth, H = v.videoHeight;
        if (!W || !H) return;
        v.style.aspectRatio = (W / H).toFixed(4);
        v.classList.toggle("video-portrait", H > W);
      };
      if (v.readyState >= 1) applyRatio();
      v.addEventListener("loadedmetadata", applyRatio);
    });
    // 仅水合"未挂接"的视频：loadFeed 每次翻页都对整个列表容器调用，
    // 不加标记会让旧 HLS 视频被反复 new Hls()，旧实例（含 worker/持续分片下载）
    // 从不销毁，翻几页后 CPU/网络/内存暴涨，整站越来越卡。
    root.querySelectorAll("video.essay-media-video--hls[data-hls-src]:not([data-video-attached])").forEach(videoEl => {
      const url = videoEl.dataset.hlsSrc;
      if (!url) return;
      videoEl.dataset.videoAttached = "1";
      // 加载提示：只在用户主动播放且确实缓冲中时显示。
      // 不能用 loadstart——preload="none" 的视频解析到 src 就会触发 loadstart
      // 但不下载数据、canplay 永不触发，会导致"加载中…"遮罩永久残留盖住封面。
      videoEl.addEventListener("play", () => { if (videoEl.readyState < 3) videoEl.dataset.loading = "1"; });
      videoEl.addEventListener("waiting", () => videoEl.dataset.loading = "1");
      videoEl.addEventListener("canplay", () => delete videoEl.dataset.loading);
      videoEl.addEventListener("playing", () => delete videoEl.dataset.loading);
      videoEl.addEventListener("pause", () => delete videoEl.dataset.loading);
      videoEl.addEventListener("error", () => delete videoEl.dataset.loading);
      if (videoEl.canPlayType("application/vnd.apple.mpegurl")) {
        videoEl.src = url; // Safari 原生 HLS
      } else if (window.Hls && Hls.isSupported()) {
        // 起播/抗卡顿调优：默认配置过于保守（初始带宽估计仅 500kbps、
        // 清单加载完才拉首片、前向缓冲只有 30s），外链源站慢时起播卡顿明显
        const hls = new Hls({
          enableWorker: true,
          startFragPrefetch: true, // 清单解析时并行预取首片，起播快几百毫秒
          abrEwmaDefaultEstimate: 2e6, // 初始带宽估计 2Mbps，多码率源直接高档起播
          maxBufferLength: 60, // 前向缓冲目标 60s（默认 30s），抗源站抖动
          backBufferLength: 30, // 已播仅保留 30s，控制内存
        });
        hls.loadSource(url);
        hls.attachMedia(videoEl);
        videoEl._hls = hls; // 元素被移除时可供 destroy
      }
    });

    // 非 HLS（直 src）视频：加载提示
    root.querySelectorAll("video.essay-media-video[src]:not(.essay-media-video--hls):not([data-video-attached])").forEach(v => {
      v.dataset.videoAttached = "1";
      // 同上：不用 loadstart（preload="none" 下会误触发且永久不清除）
      v.addEventListener("play", () => { if (v.readyState < 3) v.dataset.loading = "1"; });
      v.addEventListener("waiting", () => v.dataset.loading = "1");
      v.addEventListener("canplay", () => delete v.dataset.loading);
      v.addEventListener("playing", () => delete v.dataset.loading);
      v.addEventListener("pause", () => delete v.dataset.loading);
      v.addEventListener("error", () => delete v.dataset.loading);
    });
  }

  /** 停止容器内所有视频：HLS 销毁实例（停止后台拉分片），普通 MP4 暂停。
   *  删除卡片/关弹窗/视图切换/路由切换前调用，防止声音继续、流量空耗 */
  function disposeVideos(root) {
    root.querySelectorAll("video.essay-media-video--hls").forEach(videoEl => {
      try {
        if (videoEl._hls) {
          videoEl._hls.destroy();
          videoEl._hls = null;
        }
        videoEl.pause();
        videoEl.removeAttribute("src");
        videoEl.load();
      } catch {
        /* 忽略 */
      }
    });
    // 普通 MP4（直 src）：暂停即可，无需移除 src（元素通常会随容器一起销毁）
    root.querySelectorAll("video.essay-media-video:not(.essay-media-video--hls)").forEach(videoEl => {
      try { videoEl.pause(); } catch { /* 忽略 */ }
    });
  }

  /* ================= 即刻瀑布流 ================= */

  let feedEls = []; // 与 state.feed 对齐的 li 元素
  // 瀑布流卡片高度自适应：图片晚到（waitForImages 单张仅等 1s 就超时放行）、视频起播后
  // 宽高比/限高突变、音乐卡异步内容等都会在 layout() 之后改变卡片高度，而绝对定位布局
  // 不会自动重排 → 卡片不定时重叠。RO 统一兜底：任何卡片尺寸变化都防抖重排。
  // 无死循环：重排只写 top/left/width，卡片自身高度不变，不会再次触发 RO。
  const feedRO = typeof ResizeObserver !== "undefined" ? new ResizeObserver(onCardsResize) : null;
  let feedRafId = 0;
  function onCardsResize() {
    if (feedRafId) return;
    feedRafId = requestAnimationFrame(() => {
      feedRafId = 0;
      layout();
    });
  }
  /** feedEls 重新赋值后调用：断开旧观察，观察当前全部卡片（RO 初始会派发一次，幂等无害） */
  function syncFeedRO() {
    if (!feedRO) return;
    feedRO.disconnect();
    feedEls.forEach(el => el && feedRO.observe(el));
  }
  let resizeTimer = null;
  let loadMoreObserver = null;
  let resizeObserver = null; // 单例：renderFeed 多次调用时必须 disconnect 旧的，避免监听器泄漏

  function imagesGridHtml(m) {
    const images = m.images || [];
    if (!images.length) return "";
    const count = images.length;
    const mod = count === 1 ? "single" : count === 2 ? "double" : "multi";
    const cells = images
      .map(
        src => {
          const ts = thumbSrc(src);
          return `
      <a class="bber-content-img" data-lightbox="${esc(src)}" rel="external nofollow noreferrer">
        <img src="${esc(ts)}" alt="图片" loading="lazy"${ts !== src ? ` data-orig="${esc(src)}"` : ""} />
        ${ts !== src ? '<span class="img-orig-badge" title="点击查看原图">原图</span>' : ""}
      </a>`;
        }
      )
      .join("");
    return `<div class="bber-container-img bber-img-${mod}">${cells}</div>`;
  }

  /**
   * 头像渲染：
   *  - http(s) 链接 → 图片
   *  - 否则 → 若传了 fallbackIcon（lucide key）用线性图标占位；否则用 fallbackChar 文本（昵称首字符）
   * 不再把非空文本当 emoji 渲染（全站去 emoji）。
   */
  function avatarSpanHtml(value, fallbackChar, extraClass, fallbackIcon) {
    const cls = "bber-author-avatar" + (extraClass ? " " + extraClass : "");
    if (/^https?:\/\//i.test(value || "")) {
      return `<span class="${cls}"><img src="${esc(value)}" alt="" loading="lazy" referrerpolicy="no-referrer" /></span>`;
    }
    if (fallbackIcon) {
      return `<span class="${cls} bber-author-avatar--fallback">${svgIcon(fallbackIcon, 22)}</span>`;
    }
    const txt = (value || "").trim() ? value : fallbackChar;
    return `<span class="${cls} bber-author-avatar--fallback">${esc(txt)}</span>`;
  }

  function momentCardHtml(m) {
    const s = state.settings;
    return `
    <li class="bber-item" data-id="${m.id}">
      <div class="bber-content">
        <div class="bber-author-row">
          <span class="bber-author">
            ${avatarSpanHtml(s.author_avatar, (s.author_name || "M").charAt(0))}
            <span class="bber-author-nickname">${esc(s.author_name || "Moments")}</span>
          </span>
        </div>
        <div class="datacont">${renderContentHtml(m.content)}${videoHtml(m.video)}</div>
        ${imagesGridHtml(m)}
      </div>
      <hr />
      <div class="bber-bottom">
        <div class="bber-info">
          <div class="bber-info-time">
            ${svgIcon("clock", 14)}
            <time class="datatime" datetime="${esc(m.created_at)}">${timeAgo(m.created_at)}</time>
          </div>
          ${m.location ? `<div class="bber-info-from">${svgIcon("locationDot", 14)}<span>${esc(m.location)}</span></div>` : ""}
        </div>
        <div class="bber-actions">
          <div class="bber-like ${m.liked ? "is-liked" : ""}" data-act="like" title="${m.liked ? "取消点赞" : "点赞"}">
            ${svgIcon(m.liked ? "heartFill" : "heartLine", 18)}
            ${m.like_count > 0 ? `<span class="bber-like-count">${m.like_count}</span>` : ""}
          </div>
          <div class="bber-reply" data-act="reply" title="评论">
            ${svgIcon("chat", 18)}
            ${m.comment_count > 0 ? `<span class="bber-reply-count">${m.comment_count}</span>` : ""}
          </div>
          ${state.admin ? `<div class="bber-reply bber-del" data-act="del" title="删除">${svgIcon("trash", 18)}</div>` : ""}
        </div>
      </div>
    </li>`;
  }

  /** 瀑布流布局（与原站算法一致） */
  function layout(force) {
    const container = document.getElementById("waterfall");
    if (!container || feedEls.length === 0) return;
    const width = container.offsetWidth;
    if (!width) return;

    const cols = width >= 1200 ? 3 : width >= 768 ? 2 : 1;
    const colWidth = (width - GAP * (cols - 1)) / cols;
    const heights = new Array(cols).fill(0);

    // 两阶段布局，避免“读 getBoundingClientRect → 写 style”逐元素交错造成的
    // 强制同步布局（layout thrashing）：卡片越多主线程被阻塞越久。
    // 阶段一：纯读取，浏览器至多做一次 reflow
    const measured = feedEls.map(el => (el ? el.getBoundingClientRect().height : 0));

    // 阶段二：纯写入
    feedEls.forEach((el, index) => {
      if (!el) return;
      let minH = Infinity;
      let col = 0;
      for (let i = 0; i < cols; i++) {
        if (heights[i] < minH) {
          minH = heights[i];
          col = i;
        }
      }
      const top = heights[col];
      const height = measured[index];
      el.style.position = "absolute";
      el.style.width = `${colWidth}px`;
      el.style.left = `${col * (colWidth + GAP)}px`;
      el.style.top = `${top}px`;
      el.style.transition = "left 0.3s ease, top 0.3s ease, width 0.3s ease";
      heights[col] = top + height + GAP;
    });

    const maxH = Math.max(...heights);
    container.style.height = `${maxH > 0 ? maxH - GAP : 0}px`;
  }

  /** 等待所有图片加载完成（单张超时 1s，与原站一致） */
  function waitForImages(container) {
    const images = Array.from(container.querySelectorAll("img"));
    if (images.length === 0) return Promise.resolve();
    return Promise.all(
      images.map(
        img =>
          new Promise(resolve => {
            if (img.complete && img.naturalHeight !== 0) {
              resolve();
              return;
            }
            let done = false;
            const cleanup = () => {
              if (done) return;
              done = true;
              img.removeEventListener("load", cleanup);
              img.removeEventListener("error", cleanup);
              window.clearTimeout(timer);
              resolve();
            };
            const timer = window.setTimeout(cleanup, LAYOUT_TIMEOUT);
            img.addEventListener("load", cleanup, { once: true });
            img.addEventListener("error", cleanup, { once: true });
          })
      )
    );
  }

  function observeLoadMore() {
    if (loadMoreObserver) loadMoreObserver.disconnect();
    const sentinel = document.getElementById("loadMore");
    if (!sentinel) return;
    loadMoreObserver = new IntersectionObserver(
      entries => {
        // 防重必须用真实的加载标志（旧代码的 busy 从未被赋值，恒为 false）；
        // loadFeed 内部也有同样守卫，这里提前拦截避免排队触发
        if (entries[0].isIntersecting && !state.feedLoading && !state.feedDone) loadFeed();
      },
      { rootMargin: "300px 0px 300px 0px", threshold: 0 }
    );
    loadMoreObserver.observe(sentinel);
  }

  function observeResize() {
    const container = document.getElementById("waterfall");
    if (!container) return;
    if (resizeObserver) resizeObserver.disconnect(); // 每次 renderFeed 复用单例，防止 RO 堆积
    let lastWidth = container.offsetWidth;
    const ro = new ResizeObserver(entries => {
      const entry = entries[0];
      if (!entry) return;
      const width = entry.contentRect.width;
      if (Math.abs(width - lastWidth) < 1) return;
      lastWidth = width;
      if (resizeTimer) window.clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(() => layout(), 50);
    });
    ro.observe(container);
    resizeObserver = ro;
  }

  function setLoadMoreText() {
    const el = document.getElementById("loadMore");
    if (!el) return;
    if (state.feedLoading) el.innerHTML = `<span class="spinner"></span><span>正在加载更多即刻...</span>`;
    else if (!state.feedDone) el.innerHTML = `<span>下滑继续浏览更多即刻</span>`;
    else el.innerHTML = state.feed.length ? `<span>— 已经到底啦 —</span>` : "";
  }

  function bannerHtml() {
    const s = state.settings;
    const bg = /^https?:\/\//i.test(s.banner_bg_image || "") ? s.banner_bg_image : "";
    const customUrl = /^https?:\/\//i.test(s.banner_button_url || "") ? s.banner_button_url : "";
    return `
    <div class="banner-card">
      <div class="banner-inner${bg ? " has-bg" : ""}"${bg ? ` style="background-image:url('${esc(bg).replace(/'/g, "%27")}')" data-banner-bg="1"` : ""}>
        ${state.admin ? `<button type="button" class="essay-publish-fab" data-act="publish-fab" aria-label="发布说说" title="发布说说">${svgIcon("plus", 18)}</button>` : ""}
        <div class="banner-content">
          <div>
            <div class="banner-tips">${esc(s.essay_tips)}</div>
            <span class="banner-title">${esc(s.essay_title)}</span>
          </div>
          <div class="banner-bottom">
            <div class="banner-desc">${esc(s.essay_subtitle)}</div>
            ${customUrl
              ? `<button type="button" class="banner-button" data-act="banner-link" data-url="${esc(customUrl)}">${svgIcon("arrowUpRight", 20)}<span>${esc(s.essay_button_text)}</span></button>`
              : state.admin
                ? `<button type="button" class="banner-button" data-act="publish-fab">${svgIcon("arrowUpRight", 20)}<span>${esc(s.essay_button_text)}</span></button>`
                : `<button type="button" class="banner-button" data-act="unlock">${svgIcon("arrowUpRight", 20)}<span>解锁管理</span></button>`}
          </div>
        </div>
      </div>
    </div>`;
  }

  /** 站点图标值 → favicon href（仅图片 URL；留空用 lucide pen-nib SVG，不再用 emoji） */
  function iconToHref(v) {
    const val = String(v || "").trim();
    if (/^https?:\/\//i.test(val)) return val;
    const svg = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23888' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><path d='M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z'/><path d='m15 5 4 4'/></svg>`;
    return `data:image/svg+xml,${encodeURIComponent(svg)}`;
  }

  /** 把站点设置应用到顶栏品牌名 / 导航文字 / 文档标题 */
  function applySettings() {
    const s = state.settings;
    const iconLink = document.querySelector('link[rel="icon"]');
    if (iconLink) iconLink.href = iconToHref(s.site_icon);
    document.querySelector(".brand-name").textContent = s.site_title;
    document.querySelector('[data-route="feed"]').textContent = s.nav_feeds_name;
    document.title = s.site_title;
    // 「关于」入口：about_enabled 开启时显示（桌面端 + 移动端）
    document.querySelectorAll(".about-nav-link").forEach(a => { a.hidden = !s.about_enabled; });
    // 「友情链接」「相册」入口独立开关
    document.querySelectorAll(".links-nav-link").forEach(a => { a.hidden = !s.links_enabled; });
    document.querySelectorAll(".photos-nav-link").forEach(a => { a.hidden = !s.photos_enabled; });
    // 品牌头像：http(s) 链接渲染图片，否则用 lucide pen-nib 占位（不再用 emoji/文本）
    const avatarEl = document.querySelector(".brand-avatar");
    if (avatarEl) {
      if (/^https?:\/\//i.test(s.brand_avatar || "")) {
        avatarEl.innerHTML = `<img src="${esc(s.brand_avatar)}" alt="" referrerpolicy="no-referrer" />`;
      } else {
        avatarEl.innerHTML = svgIcon("pen-nib", 22);
      }
    }
    // 自定义导航项（每行 名称|链接），追加在"即刻"之后；重复应用先清理
    const nav = document.querySelector(".nav");
    if (nav) {
      nav.querySelectorAll(".custom-nav-link").forEach(a => a.remove());
      String(s.nav_links || "")
        .split("\n")
        .map(line => line.trim())
        .filter(Boolean)
        .slice(0, 6)
        .forEach(line => {
          const sep = line.lastIndexOf("|");
          const label = sep > 0 ? line.slice(0, sep).trim() : line;
          const href = sep > 0 ? line.slice(sep + 1).trim() : "";
          if (!label || !/^https?:\/\//i.test(href)) return;
          const a = document.createElement("a");
          a.className = "custom-nav-link";
          a.href = href;
          a.target = "_blank";
          a.rel = "noopener";
          a.textContent = label;
          // 插到"后台"入口之前
          const adminLink = nav.querySelector('[data-route="admin"]');
          nav.insertBefore(a, adminLink || null);
        });
    }
    // 页脚：文案 + 网站运行时间
    applyFooter(s);
    applyMusicSettings();
  }

  // 页脚运行时间计时器 id
  let footerRuntimeTimer = null;
  function applyFooter(s) {
    const footer = document.getElementById("siteFooter");
    if (!footer) return;
    const textEl = footer.querySelector("[data-footer-text]");
    const runtimeEl = footer.querySelector("[data-footer-runtime]");
    const hasText = !!(s.footer_text || "").trim();
    const since = (s.footer_run_since || "").trim();
    const show = hasText || since;
    footer.hidden = !show;
    textEl.innerHTML = hasText ? String(s.footer_text) : "";

    if (footerRuntimeTimer) { clearInterval(footerRuntimeTimer); footerRuntimeTimer = null; }
    if (!since) { runtimeEl.hidden = true; return; }
    const start = new Date(since).getTime();
    if (!Number.isFinite(start) || start >= Date.now()) { runtimeEl.hidden = true; return; }

    const pad = n => String(n).padStart(2, "0");
    const tick = () => {
      const diff = Math.max(0, Date.now() - start);
      const sec = Math.floor(diff / 1000);
      const days = Math.floor(sec / 86400);
      const hours = Math.floor((sec % 86400) / 3600);
      const mins = Math.floor((sec % 3600) / 60);
      const secs = sec % 60;
      runtimeEl.textContent = `网站已运行 ${days} 天 ${pad(hours)}:${pad(mins)}:${pad(secs)}`;
      runtimeEl.hidden = false;
    };
    tick();
    footerRuntimeTimer = setInterval(tick, 1000);
  }

  /** 幂等应用音乐播放器设置（初始折叠/音量）。
   *  settings 任何时刻更新（启动/后台保存/bfcache 恢复）都同步到播放器。 */
  function applyMusicSettings() {
    if (!musicCapsule) return;
    const s = state.settings;
    if (!s.music_enable) return;
    const vol = Math.max(0, Math.min(1, Number(s.music_volume) || 0.7));
    if (!state.music.isPlaying) setMusicVolume(vol);
    if (s.music_collapsed) setCapsuleCollapsed(true);
  }

  function commentSectionHtml() {
    return `
    <div class="link-comment-section">
      <div id="post-comment" class="comment-container">
        <div class="comment-head">
          ${svgIcon("chat", 22)}
          <span class="comment-title">评论</span>
          <span class="comment-count-tag" data-comment-count>0</span>
        </div>
        <div data-comment-body>
          <div class="comment-hint">点击即刻卡片右下角的评论图标，可针对该条即刻发表评论</div>
        </div>
      </div>
    </div>`;
  }

  function renderFeed() {
    state.activeView = "feed";
    const s0 = state.settings;
    const fq = new URLSearchParams(location.search).get("q") || "";
    setSeo({
      title: fq ? `搜索「${fq}」 · ${s0.site_title}` : s0.site_title,
      description: s0.essay_subtitle,
      path: fq ? "/?q=" + encodeURIComponent(fq) : "/",
      image: s0.banner_bg_image,
    });
    state.feed = [];
    state.cursor = null;
    state.feedDone = false;
    feedEls = [];
    syncFeedRO(); // 首页重建，断开旧卡片观察
    state.commentTarget = null;
    const filterBanner = fq ? `
      <div class="feed-filter-bar">
        <span>🔍 只显示包含「<b>${esc(fq)}</b>」的说说</span>
        <a class="feed-filter-clear" href="/" data-route="feed">清除筛选</a>
      </div>` : "";
    app.innerHTML = `
      <div class="essay">
        ${bannerHtml()}
        ${filterBanner}
        <div class="essay-list-container">
          <div class="essay-content-wrapper">
            <div class="layout-loading-placeholder">
              <div style="display:flex;flex-direction:column;align-items:center;gap:1rem;padding:2rem">
                <span class="spinner"></span><span style="font-size:.875rem;font-weight:500">加载中...</span>
              </div>
            </div>
            <section class="timeline is-hidden">
              <ul id="waterfall" class="list" style="position:relative"></ul>
            </section>
          </div>
          <div class="essay-loadmore" id="loadMore"></div>
        </div>
      </div>`;
    observeLoadMore();
    observeResize();
    loadFeed();
  }

  /** 时间线中的文章卡片：只显示封面 + 标题 + 摘要，点击进入文章详情 */
  function postFeedCardHtml(p) {
    return `
    <li class="bber-item bber-item--post">
      <a class="bber-post-link" href="/post/${encodeURIComponent(p.slug)}">
        <div class="bber-author-row">
          <span class="bber-author">
            ${avatarSpanHtml(state.settings.post_avatar, "", "bber-author-avatar--post", "file-text")}
            <span class="bber-author-nickname">文章</span>
          </span>
          <span class="bber-post-tag">文章</span>
        </div>
        ${p.cover ? `<div class="bber-post-cover"><img src="${esc(thumbSrc(p.cover))}" alt="" loading="lazy" referrerpolicy="no-referrer" data-orig="${esc(p.cover)}" /></div>` : ""}
        <div class="bber-post-title">${esc(p.title)}</div>
        ${p.excerpt ? `<div class="bber-post-excerpt">${esc(p.excerpt)}</div>` : ""}
        <hr />
        <div class="bber-bottom">
          <div class="bber-info">
            <div class="bber-info-time">
              ${svgIcon("clock", 14)}
              <time datetime="${esc(p.created_at)}">${timeAgo(p.created_at)}</time>
            </div>
          </div>
          <div class="bber-actions"><span class="bber-post-read">阅读全文 →</span></div>
        </div>
      </a>
    </li>`;
  }

  /** 时间线条目：说说 / 文章 各走各的卡片模板 */
  function feedItemHtml(it) {
    return it.kind === "post" ? postFeedCardHtml(it) : momentCardHtml(it);
  }

  /** 评论内容 @ 提及高亮：转义后包裹 @username */
  function formatCommentContent(text) {
    return reactionTokenToSvg(esc(text))
      .replace(/@([^\s@<>，。！？、（）]+)/g, '<span class="comment-mention">@$1</span>');
  }

  /* ================= 评论增强：表情 / 图片 / 随机评论 ================= */

  // 评论表情：改用精选 lucide 线性小图标（全站去 emoji）。
  // 点击图标插入短码 token「:key:」，渲染时由 formatCommentContent 转成内联 SVG。
  const REACTION_ICONS = [
    { k: "smile" }, { k: "heart" }, { k: "thumbs-up" }, { k: "star" },
    { k: "party-popper" }, { k: "flame" }, { k: "coffee" }, { k: "sparkles" },
    { k: "music" }, { k: "gift" }, { k: "sunLine" },
  ];

  /** 将表情图标集合渲染为可点击的网格（每个格子是 lucide 图标） */
  function reactionGridHtml() {
    return REACTION_ICONS.map(r =>
      `<button type="button" class="emoji-cell" data-reaction="${r.k}" title=":${r.k}:">${svgIcon(r.k, 20)}</button>`
    ).join("");
  }

  /** 评论表情短码 → 内联 SVG（供 formatCommentContent 用） */
  function reactionTokenToSvg(text) {
    return text.replace(/:([a-z-]+):/g, (m, key) => {
      if (REACTION_ICONS.some(r => r.k === key)) {
        return `<span class="comment-reaction">${svgIcon(key, 18)}</span>`;
      }
      return m;
    });
  }

  // 随机评论库（50 条，4 类）
  const RANDOM_COMMENTS = [
    // 夸赞类
    "写得真好，收藏了！", "太有才了吧！", "这篇文章质量很高，感谢分享", "博主写的太好了，学到了", "干货满满，已收藏", "写得非常详细，赞一个", "这也太厉害了吧！", "文章写得真棒，持续关注中", "优质内容，支持博主！", "太赞了，迫不及待想看更多", "这篇必须点赞，太实用了", "博主真是才华横溢！",
    // 幽默类
    "笑死我了", "这篇文章把我看饿了", "博主你是不是偷偷开了挂？", "我看完了，然后忘了我在干嘛", "这文笔，不去写小说可惜了", "哈哈哈哈太真实了", "看完感觉智商被碾压了", "这篇内容比我的饭还香", "笑不活了，博主是懂幽默的", "看完我直接原地转圈", "这操作我给满分", "博主你是懂生活的",
    // 互动类
    "学到了，感谢博主分享", "刚好需要这个，太及时了", "博主能详细讲讲这个吗？", "收藏了，以后慢慢看", "转发给朋友一起学习", "请问有后续更新吗？期待", "已关注，持续学习中", "这个观点很有启发，谢谢", "做笔记了，受益匪浅", "正好在研究这个，太有帮助了", "已实践，效果很好感谢", "博主能出个系列吗？想看更多",
    // 日常类
    "打卡签到", "路过留个脚印", "每天必看博主的更新", "今天也是元气满满的一天", "摸鱼时看到这篇，值了", "深夜刷到好文，满足了", "上班偷偷看完了哈哈哈", "坐等更新！", "默默支持博主", "又到了催更的时候了", "第一次留言，支持一下", "前排围观！", "沙发！第一！" 
  ];

  /** 当前表情面板活动 textarea 引用 */
  let emojiPanelTarget = null;

  /** 打开/关闭表情面板（lucide 小图标），定位在指定 textarea 上方 */
  function toggleEmojiPanel(textarea) {
    let panel = document.getElementById("emojiPanel");
    if (panel && panel.dataset.targetId === textarea.id) {
      panel.remove();
      return;
    }
    if (panel) panel.remove();
    emojiPanelTarget = textarea;
    panel = document.createElement("div");
    panel.id = "emojiPanel";
    panel.className = "emoji-panel";
    panel.dataset.targetId = textarea.id || "";
    panel.innerHTML = `
      <div class="emoji-grid" data-emoji-grid>${reactionGridHtml()}</div>
    `;
    // 定位
    const rect = textarea.getBoundingClientRect();
    panel.style.position = "fixed";
    panel.style.left = rect.left + "px";
    panel.style.bottom = (window.innerHeight - rect.top + 4) + "px";
    panel.style.zIndex = "10001";
    document.body.appendChild(panel);
    // 点击图标：插入短码 token「:key:」到 textarea 光标位置
    panel.addEventListener("click", e => {
      const cell = e.target.closest && e.target.closest("[data-reaction]");
      if (cell && emojiPanelTarget) {
        const token = `:${cell.dataset.reaction}:`;
        const ta = emojiPanelTarget;
        const start = ta.selectionStart;
        const end = ta.selectionEnd;
        ta.value = ta.value.slice(0, start) + token + ta.value.slice(end);
        ta.selectionStart = ta.selectionEnd = start + token.length;
        ta.focus();
      }
    });
    // 点击面板外部关闭
    setTimeout(() => {
      document.addEventListener("click", closeEmojiOnOutside, { once: true });
    }, 0);
  }

  function closeEmojiOnOutside(e) {
    const panel = document.getElementById("emojiPanel");
    if (panel && !panel.contains(e.target) && !e.target.closest("[data-emoji-btn]")) {
      panel.remove();
    } else if (panel) {
      // 重新监听
      setTimeout(() => {
        document.addEventListener("click", closeEmojiOnOutside, { once: true });
      }, 0);
    }
  }

  /** 评论图片状态（每个评论表单独立维护） */
  const commentImages = new Map(); // form element -> string[]

  /** 获取评论表单的图片列表 */
  function getCommentImages(form) {
    return commentImages.get(form) || [];
  }

  /** 设置评论表单的图片列表并刷新预览 */
  function setCommentImages(form, urls) {
    commentImages.set(form, urls);
    const preview = form.querySelector("[data-comment-img-preview]");
    if (preview) {
      preview.innerHTML = urls.map((url, i) =>
        `<div class="comment-img-thumb" data-img-idx="${i}">
          <img src="${esc(url)}" alt="" loading="lazy" referrerpolicy="no-referrer" />
          <button type="button" class="comment-img-del" data-img-del="${i}">×</button>
        </div>`
      ).join("");
      preview.style.display = urls.length ? "flex" : "none";
    }
  }

  /** 添加评论图片（本地上传或网络 URL），最多 3 张 */
  async function addCommentImage(form, url) {
    const list = getCommentImages(form);
    if (list.length >= 3) return toast("最多 3 张图片");
    list.push(url);
    setCommentImages(form, list);
  }

  /** 评论表单图片上传处理 */
  async function handleCommentImageUpload(form, file) {
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) return toast("图片不能超过 5MB");
    const btn = form.querySelector("[data-img-upload-btn]");
    if (btn) { btn.disabled = true; btn.textContent = "上传中..."; }
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/comment-upload", { method: "POST", body: fd });
      const json = await res.json();
      if (!res.ok || !json.data?.src) throw new Error(json.message || "上传失败");
      const full = /^https?:\/\//i.test(json.data.src) ? json.data.src : location.origin + json.data.src;
      await addCommentImage(form, full);
    } catch (err) {
      toast(err.message);
    } finally {
      if (btn) { btn.disabled = false; btn.innerHTML = svgIcon("image", 18); }
    }
  }

  /** 随机评论填入 textarea */
  function fillRandomComment(textarea) {
    const msg = RANDOM_COMMENTS[Math.floor(Math.random() * RANDOM_COMMENTS.length)];
    textarea.value = msg;
    textarea.focus();
    textarea.selectionStart = textarea.selectionEnd = textarea.value.length;
  }

  /** 为评论表单绑定增强功能（表情/图片/随机评论） */
  function bindCommentToolbar(form) {
    const ta = form.content;
    if (!ta) return;

    // 表情按钮
    const emojiBtn = form.querySelector("[data-emoji-btn]");
    if (emojiBtn) {
      emojiBtn.addEventListener("click", () => toggleEmojiPanel(ta));
    }

    // 图片上传按钮
    const uploadBtn = form.querySelector("[data-img-upload-btn]");
    const fileInput = form.querySelector("[data-img-file]");
    if (uploadBtn && fileInput) {
      uploadBtn.addEventListener("click", () => fileInput.click());
      fileInput.addEventListener("change", async () => {
        const file = fileInput.files[0];
        if (file) await handleCommentImageUpload(form, file);
        fileInput.value = "";
      });
    }

    // 网络图片 URL 输入
    const urlInput = form.querySelector("[data-img-url-input]");
    if (urlInput) {
      urlInput.addEventListener("keydown", async e => {
        if (e.key === "Enter") {
          e.preventDefault();
          const url = urlInput.value.trim();
          if (!url) return;
          if (!/^https?:\/\//i.test(url)) return toast("请输入完整的图片 URL");
          await addCommentImage(form, url);
          urlInput.value = "";
        }
      });
    }

    // 图片删除
    form.addEventListener("click", e => {
      const del = e.target.closest("[data-img-del]");
      if (del) {
        const idx = Number(del.dataset.imgDel);
        const list = getCommentImages(form);
        list.splice(idx, 1);
        setCommentImages(form, list);
      }
    });
  }

  /** 单条评论（isReply=true 时为楼中楼回复，小头像；rootId 为所属根评论 id） */
  function commentItemHtml(cm, isReply, rootId) {
    let avatarInner;
    if (cm.is_ai) {
      // AI 机器人：图片 URL 用 img，否则用 lucide bot 图标占位（不再用 emoji）
      const botAv = state.settings?.ai_bot_avatar || "";
      avatarInner = /^https?:\/\//i.test(botAv)
        ? `<img class="comment-avatar comment-avatar--img comment-avatar--ai" src="${esc(botAv)}" alt="" referrerpolicy="no-referrer" loading="lazy" />`
        : `<span class="comment-avatar comment-avatar--ai">${svgIcon("bot", 20)}</span>`;
    } else if (cm.avatar_url) {
      avatarInner = `<img class="comment-avatar comment-avatar--img" src="${esc(cm.avatar_url)}" alt="" referrerpolicy="no-referrer" loading="lazy" />`;
    } else {
      avatarInner = `<span class="comment-avatar">${esc((cm.nickname || "?").slice(0, 1).toUpperCase())}</span>`;
    }
    const avatar = cm.website
      ? `<a class="comment-avatar-link" href="${esc(cm.website)}" target="_blank" rel="external nofollow noreferrer" title="${esc(cm.website)}">${avatarInner}</a>`
      : avatarInner;
    const root = rootId || cm.id;
    // 解析评论图片
    let imgs = [];
    try { imgs = cm.images ? JSON.parse(cm.images) : []; } catch {}
    return `
    <div class="comment-item${isReply ? " comment-item--reply" : ""}${cm.is_ai ? " comment-item--ai" : ""}" data-comment-id="${cm.id}">
      ${avatar}
      <div class="comment-body">
        <div>
          <span class="comment-name">${esc(cm.nickname)}</span>
          ${cm.is_ai ? '<span class="badge-ai">AI</span>' : cm.is_owner ? '<span class="badge-owner">博主</span>' : ""}
          <span class="comment-time">${timeAgo(cm.created_at)}</span>
        </div>
        <div class="comment-text">${formatCommentContent(cm.content)}</div>
        ${imgs.length ? `<div class="comment-images">${imgs.map(u => `<img src="${esc(u)}" alt="" loading="lazy" referrerpolicy="no-referrer" class="comment-img" data-lightbox="${esc(u)}" data-comment-img="${esc(u)}" />`).join("")}</div>` : ""}
        <div class="comment-actions">
          <button type="button" class="comment-reply-btn" data-reply-root="${root}" data-reply-name="${esc(cm.nickname)}">回复</button>
        </div>
      </div>
    </div>`;
  }

  /* ================= 楼中楼回复：分组 / 折叠 / 一键 @ ================= */
  const REPLY_PREVIEW_COUNT = 2;   // 折叠态每个楼下默认显示最新回复数
  const TOP_COMMENT_PREVIEW = 20;  // 顶级评论过多时默认显示条数
  // 弹窗级 UI 状态：展开的楼集合 / 是否显示全部顶级评论 / 当前回复目标
  const commentUi = { expandedThreads: new Set(), showAll: false, replyRoot: 0, replyName: "" };

  /** 扁平评论 → 两级树（根评论 + replies），均按 id 升序 */
  function groupComments(list) {
    const roots = [];
    const map = new Map();
    (list || []).forEach(cm => {
      if (cm.parent_id > 0) return;
      const node = { ...cm, replies: [] };
      map.set(cm.id, node);
      roots.push(node);
    });
    (list || []).forEach(cm => {
      if (cm.parent_id > 0) {
        const root = map.get(cm.parent_id);
        if (root) root.replies.push(cm);
        else roots.push({ ...cm, replies: [] }); // 父评论丢失时兜底为顶级
      }
    });
    roots.forEach(r => r.replies.sort((a, b) => a.id - b.id));
    return roots;
  }

  /** 单个楼层（根评论 + 回复列表，回复过多时折叠） */
  function commentThreadHtml(node) {
    const total = node.replies.length;
    const expanded = commentUi.expandedThreads.has(node.id);
    const collapsible = total > REPLY_PREVIEW_COUNT;
    const visibleReplies = !expanded && collapsible ? node.replies.slice(-REPLY_PREVIEW_COUNT) : node.replies;
    const toggleHtml = (label) =>
      `<button type="button" class="comment-replies-toggle" data-replies-toggle="${node.id}">${label}</button>`;
    if (!total) {
      return `<div class="comment-thread" data-thread-id="${node.id}">${commentItemHtml(node, false, node.id)}</div>`;
    }
    return `
    <div class="comment-thread" data-thread-id="${node.id}">
      ${commentItemHtml(node, false, node.id)}
      <div class="comment-replies">
        ${collapsible && !expanded ? toggleHtml(`展开全部 ${total} 条回复`) : ""}
        <div class="comment-replies-list">
          ${visibleReplies.map(cm => commentItemHtml(cm, true, node.id)).join("")}
        </div>
        ${collapsible && expanded ? toggleHtml("收起回复") : ""}
      </div>
    </div>`;
  }

  /** 整个评论列表 HTML（顶级评论过多时折叠）；无评论返回空串 */
  function renderCommentListHtml(comments) {
    const threads = groupComments(comments);
    if (!threads.length) return "";
    const visible = commentUi.showAll ? threads : threads.slice(0, TOP_COMMENT_PREVIEW);
    const hiddenCount = threads.length - visible.length;
    return visible.map(commentThreadHtml).join("") +
      (hiddenCount > 0
        ? `<button type="button" class="comments-more-toggle" data-comments-toggle>展开更多评论（剩余 ${hiddenCount} 条）</button>`
        : commentUi.showAll && threads.length > TOP_COMMENT_PREVIEW
          ? `<button type="button" class="comments-more-toggle" data-comments-toggle>收起评论</button>`
          : "");
  }

  /** 用 state.commentTarget 的缓存重新渲染当前评论弹窗列表 */
  function rerenderCommentList() {
    const target = state.commentTarget;
    const list = document.querySelector("[data-comment-list]");
    if (!target || !list) return;
    const html = renderCommentListHtml(target.comments || []);
    list.innerHTML = html || `<div class="comment-hint">还没有评论，来说第一句吧</div>`;
  }

  /** 一键回复：记录根评论、文本框自动带入 @昵称、显示回复提示条 */
  function startCommentReply(rootId, name) {
    const form = document.querySelector("[data-comment-form]");
    if (!form) return;
    const ta = form.content;
    // 切换回复对象时，去掉旧的 @昵称 前缀
    if (commentUi.replyRoot && commentUi.replyName) {
      const oldPrefix = `@${commentUi.replyName} `;
      if (ta.value.startsWith(oldPrefix)) ta.value = ta.value.slice(oldPrefix.length);
    }
    commentUi.replyRoot = rootId;
    commentUi.replyName = name;
    form.dataset.parentId = String(rootId);

    let bar = form.querySelector("[data-reply-bar]");
    if (!bar) {
      bar = document.createElement("div");
      bar.className = "comment-reply-bar";
      bar.setAttribute("data-reply-bar", "");
      bar.innerHTML = `回复给 <b class="comment-reply-to"></b><button type="button" class="comment-reply-cancel" data-cancel-reply aria-label="取消回复">×</button>`;
      form.prepend(bar);
    }
    bar.querySelector(".comment-reply-to").textContent = `@${name}`;

    ta.value = `@${name} ${ta.value.trimStart()}`;
    ta.focus();
    const len = ta.value.length;
    ta.setSelectionRange(len, len);
  }

  /** 取消回复状态（不动文本框内容，由调用方决定是否清空） */
  function resetReplyTarget(form) {
    if (!form) return;
    delete form.dataset.parentId;
    commentUi.replyRoot = 0;
    commentUi.replyName = "";
    form.querySelector("[data-reply-bar]")?.remove();
  }

  const QQ_NUM_RE = /^[1-9]\d{4,11}$/;

  /** 过滤占位/示例网址，避免默认显示 https://example.com 等测试值 */
  const EXAMPLE_URL_RE = /^(https?:\/\/)?(example\.com|example\.org|test\.com|localhost|127\.0\.0\.1)/i;
  function getSavedWebsite() {
    const v = (localStorage.getItem("moments_website") || "").trim();
    if (!v || EXAMPLE_URL_RE.test(v)) return "";
    return v;
  }

  /** 评论身份：单个输入框既可填昵称也可填 QQ 号
   *  - 输入符合 QQ 号格式（5-12 位数字）时自动调 /api/qq-info 获取昵称/邮箱/头像
   *  - 获取成功后用昵称覆盖输入框值，并清空 form.dataset.qq 允许重新填写
   *  - 手动输入昵称时，若无头像则同步显示昵称首字做头像回退
   */

  /** AI 机器人开启时，在评论框上方插入「召唤 @小J」提示条，点击自动填入 @昵称 */
  function injectAiHint(form) {
    const s = state.settings;
    if (!s?.ai_reply_enabled) return;
    if (form.querySelector("[data-ai-hint]")) return;
    const botName = s.ai_bot_name || "小J";
    const ta = form.querySelector('textarea[name="content"]');
    if (!ta) return;
    const bar = document.createElement("div");
    bar.className = "comment-ai-hint";
    bar.setAttribute("data-ai-hint", "");
    bar.innerHTML = `<span>${svgIcon("message-circle", 16)} 评论中 @<b></b> 可召唤 AI 回复</span><button type="button" class="comment-ai-mention-btn">@<b></b></button>`;
    bar.querySelectorAll("b").forEach(b => { b.textContent = botName; });
    bar.querySelector(".comment-ai-mention-btn").addEventListener("click", () => {
      const prefix = `@${botName} `;
      ta.value = ta.value.includes(`@${botName}`) ? ta.value : prefix + ta.value;
      ta.focus();
      const len = ta.value.length;
      ta.setSelectionRange(len, len);
    });
    ta.insertAdjacentElement("beforebegin", bar);
  }

  /**
   * 发送 @机器人 评论后轻量轮询评论列表（AI 回复是异步生成的）。
   * 只更新数据并重渲染，不重置楼中楼展开状态；切走目标/关闭弹窗后自动停止。
   */
  function pollAiReplies(target) {
    if (!state.settings?.ai_reply_enabled) return;
    // 三次轮询的相对延迟（提交后 6s / 14s / 26s），AI 生成通常 5-15 秒
    const delays = [6000, 8000, 12000];
    const seen = new Set((target.comments || []).map(c => Number(c.id)));
    let found = 0;
    const tick = async attempt => {
      // 弹窗/页面已切到其他目标，停止轮询
      if (state.commentTarget !== target) return;
      try {
        let comments, count;
        if (target.ctype === "post") {
          const data = await api(`/api/posts/${encodeURIComponent(target.slug)}/comments`);
          comments = data.list || [];
          count = Number(data.count) || comments.length;
        } else {
          const detail = await api(`/api/moments/${target.cid}?voter_id=${encodeURIComponent(state.voterId)}`);
          comments = detail.comments || [];
          count = detail.comment_count;
        }
        const arrived = comments.filter(c => Number(c.is_ai) === 1 && !seen.has(Number(c.id)));
        if (arrived.length) {
          found += arrived.length;
          arrived.forEach(c => {
            seen.add(Number(c.id));
            // 自动展开 AI 回复所在楼层
            const root = c.parent_id || c.id;
            commentUi.expandedThreads.add(root);
          });
          target.comments = comments;
          target.comment_count = count;
          rerenderCommentList();
          if (target.ctype === "moment") {
            const card = app.querySelector(`.bber-item[data-id="${target.cid}"] .bber-reply`);
            if (card) updateReplyCount(card, count);
            const fm = state.feed.find(x => x.id === target.cid);
            if (fm) { fm.comments = comments; fm.comment_count = count; }
          } else {
            updateArticleCommentCount(count);
          }
        }
      } catch {
        /* 单次轮询失败静默，下一拍继续 */
      }
      if (found === 0 && attempt < delays.length - 1) {
        setTimeout(() => tick(attempt + 1), delays[attempt + 1]);
      }
    };
    setTimeout(() => tick(0), delays[0]);
  }

  function bindCommentIdentity(form) {
    if (!form) return;
    const nickInput = form.querySelector('input[name="nickname"]');
    const emailInput = form.querySelector('input[name="email"]');
    if (!nickInput || nickInput.dataset.bound) return;
    nickInput.dataset.bound = "1";

    injectAiHint(form);

    // 缓存恢复：昵称/邮箱由 input value 回填，头像此前未持久化，重开弹窗只剩首字
    const savedAvatar = (localStorage.getItem("moments_avatar") || "").trim();
    const savedQq = (localStorage.getItem("moments_qq") || "").trim();
    if (savedQq && QQ_NUM_RE.test(savedQq)) form.dataset.qq = savedQq;

    const renderAvatar = (url, fallback) => {
      const box = form.querySelector("[data-qq-avatar]");
      if (!box) return;
      if (url) {
        box.innerHTML = `<img src="${esc(url)}" alt="" referrerpolicy="no-referrer" />`;
        box.classList.add("has-img");
      } else {
        box.textContent = (fallback || "?").slice(0, 1).toUpperCase();
        box.classList.remove("has-img");
      }
    };

    // 打开弹窗即回填缓存的 QQ 头像
    if (savedAvatar) {
      form.dataset.avatar = savedAvatar;
      renderAvatar(savedAvatar, nickInput.value || "?");
    }

    // 手动输入昵称时：若无 QQ 头像，同步把昵称首字显示到头像位
    nickInput.addEventListener("input", () => {
      const v = nickInput.value.trim();
      // 当前已是 QQ 号获取的昵称，不触发首字回退
      if (form.dataset.qq && v === form.dataset.lastQqNick) return;
      if (QQ_NUM_RE.test(v)) return; // 输入的是 QQ 号，等接口返回
      if (!form.dataset.avatar) {
        renderAvatar("", v || "?");
      }
    });

    const resolveQq = async qq => {
      const avatarFallback = `https://q1.qlogo.cn/g?b=qq&nk=${qq}&s=100`;
      try {
        const info = await api(`/api/qq-info?qq=${encodeURIComponent(qq)}`);
        form.dataset.qq = qq;
        form.dataset.avatar = info.avatar || avatarFallback;
        if (info.nickname) {
          nickInput.value = info.nickname; // 自动覆盖 QQ 号 → 昵称
          form.dataset.lastQqNick = info.nickname;
          localStorage.setItem("moments_nick", info.nickname);
        } else {
          form.dataset.lastQqNick = "";
        }
        if (emailInput && info.email) {
          emailInput.value = info.email;
          localStorage.setItem("moments_email", info.email);
        }
        renderAvatar(info.avatar || avatarFallback, info.nickname || qq);
        localStorage.setItem("moments_qq", qq);
        localStorage.setItem("moments_avatar", info.avatar || avatarFallback);
        if (!info.nickname) toast("未获取到昵称，请手动填写");
      } catch {
        form.dataset.qq = qq;
        form.dataset.avatar = avatarFallback;
        form.dataset.lastQqNick = "";
        localStorage.setItem("moments_qq", qq);
        localStorage.setItem("moments_avatar", avatarFallback);
        if (emailInput) {
          emailInput.value = `${qq}@qq.com`;
          localStorage.setItem("moments_email", `${qq}@qq.com`);
        }
        renderAvatar(avatarFallback, qq);
      }
    };

    let timer = null;
    nickInput.addEventListener("input", () => {
      clearTimeout(timer);
      const v = nickInput.value.trim();
      if (QQ_NUM_RE.test(v) && form.dataset.qq !== v) {
        timer = setTimeout(() => resolveQq(v), 500);
      }
    });
    nickInput.addEventListener("blur", () => {
      const v = nickInput.value.trim();
      if (QQ_NUM_RE.test(v) && form.dataset.qq !== v) resolveQq(v);
    });

    // 输入邮箱即拉取头像（QQ→Gravatar→随机），服务端缓存到 R2；防抖 600ms，失败静默
    const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    let emailTimer = null;
    const prefetchAvatar = async () => {
      if (!emailInput) return;
      const email = emailInput.value.trim().toLowerCase();
      if (!EMAIL_RE.test(email)) return;
      try {
        const res = await api("/api/comment/avatar", { method: "POST", body: { email, qq: form.dataset.qq || "" } });
        if (res && res.src) {
          form.dataset.avatar = res.src;
          renderAvatar(res.src, nickInput.value || "?");
          localStorage.setItem("moments_avatar", res.src);
          localStorage.setItem("moments_email", email);
        }
      } catch { /* 拉取失败不影响评论，提交时服务端会兜底 */ }
    };
    if (emailInput) {
      emailInput.addEventListener("input", () => {
        clearTimeout(emailTimer);
        const email = emailInput.value.trim().toLowerCase();
        if (EMAIL_RE.test(email)) emailTimer = setTimeout(prefetchAvatar, 600);
      });
      emailInput.addEventListener("blur", prefetchAvatar);
    }
  }

  /** 规范化评论目标对象 */
  function normalizeCommentTarget(target) {
    return {
      ctype: target.ctype === "post" ? "post" : "moment",
      cid: Number(target.cid),
      slug: target.slug || "",
      quote: target.quote || "",
      comment_count: Number(target.comment_count) || 0,
      comments: Array.isArray(target.comments) ? target.comments : [],
    };
  }

  /**
   * 评论区水合：假设 DOM 中已存在 [data-comment-list] 与 [data-comment-form]
   * 供弹窗（说说）和文章内联评论区共用。负责：设置目标、重置楼中楼 UI、
   * 绑定身份输入、拉取评论并渲染、同步计数。
   */
  async function hydrateCommentSection(t) {
    state.commentTarget = t;
    commentUi.expandedThreads = new Set();
    commentUi.showAll = false;
    commentUi.replyRoot = 0;
    commentUi.replyName = "";
    const form = document.querySelector("[data-comment-form]");
    const list = document.querySelector("[data-comment-list]");
    if (form) { bindCommentIdentity(form); bindCommentToolbar(form); }
    try {
      let comments;
      let count;
      if (t.ctype === "post") {
        const data = await api(`/api/posts/${encodeURIComponent(t.slug)}/comments`);
        comments = data.list || [];
        count = Number(data.count) || comments.length;
      } else {
        const detail = await api(`/api/moments/${t.cid}?voter_id=${encodeURIComponent(state.voterId)}`);
        comments = detail.comments || [];
        count = detail.comment_count;
      }
      t.comments = comments;
      t.comment_count = count;
      if (list) {
        const html = renderCommentListHtml(comments);
        list.innerHTML = html || `<div class="comment-hint">还没有评论，来说第一句吧</div>`;
      }
      if (t.ctype === "moment") {
        const card = app.querySelector(`.bber-item[data-id="${t.cid}"] .bber-reply`);
        if (card) updateReplyCount(card, count);
        const fm = state.feed.find(x => x.id === t.cid);
        if (fm) {
          fm.comments = comments;
          fm.comment_count = count;
        }
      } else {
        updateArticleCommentCount(count);
      }
    } catch (err) {
      if (list) list.innerHTML = `<div class="comment-hint">${esc(err.message)}</div>`;
    }
  }

  /**
   * 评论弹窗（说说用）：文章评论已改为文章内联显示，不走此弹窗
   * target: { ctype:'moment', cid, quote, comment_count?, comments? }
   */
  async function openCommentModal(target) {
    const t = normalizeCommentTarget(target);
    const modal = openModal(`
      <div class="modal-head">
        <h3>评论</h3>
        <button type="button" class="modal-x" data-close aria-label="关闭">×</button>
      </div>
      <div data-comment-body>
        <div class="comment-quote">
          <span>${esc(t.quote || `#${t.cid}`)}</span>
        </div>
        <div class="comment-list" data-comment-list><span class="spinner"></span></div>
        <form class="comment-form-wrap" data-comment-form data-ctype="${t.ctype}" data-cid="${t.cid}" data-slug="${esc(t.slug)}">
          <div class="comment-form-row comment-user-row">
            <span class="qq-avatar" data-qq-avatar>${esc((localStorage.getItem("moments_nick") || "?").slice(0, 1).toUpperCase())}</span>
            <input name="nickname" placeholder="昵称或 QQ 号（填 QQ 号自动获取昵称邮箱头像）" maxlength="20" value="${esc(localStorage.getItem("moments_nick") || "")}" required autocomplete="off" />
          </div>
          <div class="comment-form-row">
            <input name="email" type="email" placeholder="邮箱 *" maxlength="100" value="${esc(localStorage.getItem("moments_email") || "")}" required />
            <input name="website" placeholder="网址（选填，头像可点击跳转）" maxlength="200" value="${esc(getSavedWebsite())}" />
          </div>
          <div class="comment-toolbar">
            <button type="button" class="comment-tool-btn" data-emoji-btn title="表情">${svgIcon("smile", 18)}</button>
            <button type="button" class="comment-tool-btn" data-img-upload-btn title="上传图片">${svgIcon("image", 18)}</button>
            <input type="file" accept="image/*" data-img-file hidden />
            <input type="text" class="comment-img-url-input" data-img-url-input placeholder="图片 URL，回车添加" maxlength="500" />
            <button type="button" class="comment-tool-btn comment-random-btn" data-random-comment title="随机一句">${svgIcon("dices", 18)}</button>
          </div>
          <textarea name="content" placeholder="说点什么…（支持 @ 提及他人）" maxlength="500" required style="min-height:80px"></textarea>
          <div class="comment-img-preview" data-comment-img-preview style="display:none"></div>
          <div style="margin-top:.5rem;text-align:right">
            <button class="btn primary" type="submit">发表评论</button>
          </div>
        </form>
      </div>`);
    modal.querySelector("[data-close]").addEventListener("click", closeModal);
    await hydrateCommentSection(t);
  }

  /** 更新文章详情页评论入口的数字（无数字时不显示角标） */
  function updateArticleCommentCount(count) {
    const el = document.querySelector("[data-article-comments-count]");
    if (!el) return;
    el.textContent = count > 0 ? String(count) : "";
    el.style.display = count > 0 ? "" : "none";
  }

  /** 更新卡片评论数显示 */
  function updateReplyCount(replyEl, count) {
    let c = replyEl.querySelector(".bber-reply-count");
    if (count > 0) {
      if (!c) {
        replyEl.insertAdjacentHTML("beforeend", `<span class="bber-reply-count"></span>`);
        c = replyEl.querySelector(".bber-reply-count");
      }
      c.textContent = String(count);
    } else if (c) {
      c.remove();
    }
  }

  async function setCommentTarget(m) {
    state.commentTarget = m || null;
    const body = app.querySelector("[data-comment-body]");
    const countTag = app.querySelector("[data-comment-count]");
    if (!body) return;
    if (!m) {
      body.innerHTML = `<div class="comment-hint">点击即刻卡片右下角的评论图标，可针对该条即刻发表评论</div>`;
      if (countTag) countTag.textContent = "0";
      return;
    }
    if (countTag) countTag.textContent = String(m.comment_count || 0);
    body.innerHTML = `
      <div class="comment-quote">
        <span>${esc(plainText(m.content, 60) || `即刻 #${m.id}`)}</span>
        <button type="button" data-act="clear-target" title="取消定位">×</button>
      </div>
      <div class="comment-list" data-comment-list><span class="spinner"></span></div>
      <form class="comment-form-wrap" data-comment-form>
        <div class="comment-form-row comment-user-row">
          <span class="qq-avatar" data-qq-avatar>${esc((localStorage.getItem("moments_nick") || "?").slice(0, 1).toUpperCase())}</span>
          <input name="nickname" placeholder="昵称或 QQ 号（填 QQ 号自动获取昵称邮箱头像）" maxlength="20" value="${esc(localStorage.getItem("moments_nick") || "")}" required autocomplete="off" />
        </div>
        <div class="comment-form-row">
          <input name="email" type="email" placeholder="邮箱 *" maxlength="100" value="${esc(localStorage.getItem("moments_email") || "")}" required />
          <input name="website" placeholder="网址（选填，头像可点击跳转）" maxlength="200" value="${esc(getSavedWebsite())}" />
        </div>
        <div class="comment-toolbar">
          <button type="button" class="comment-tool-btn" data-emoji-btn title="表情">${svgIcon("smile", 18)}</button>
          <button type="button" class="comment-tool-btn" data-img-upload-btn title="上传图片">${svgIcon("image", 18)}</button>
          <input type="file" accept="image/*" data-img-file hidden />
          <input type="text" class="comment-img-url-input" data-img-url-input placeholder="图片 URL，回车添加" maxlength="500" />
          <button type="button" class="comment-tool-btn comment-random-btn" data-random-comment title="随机一句">${svgIcon("dices", 18)}</button>
        </div>
        <textarea name="content" placeholder="说点什么…（支持 @ 提及他人）" maxlength="500" required style="min-height:80px"></textarea>
        <div class="comment-img-preview" data-comment-img-preview style="display:none"></div>
        <div style="margin-top:.5rem;text-align:right">
          <button class="btn primary" type="submit">发表评论</button>
        </div>
      </form>`;
    bindCommentIdentity(body.querySelector("[data-comment-form]"));
    bindCommentToolbar(body.querySelector("[data-comment-form]"));
    try {
      const detail = await api(`/api/moments/${m.id}?voter_id=${encodeURIComponent(state.voterId)}`);
      const list = body.querySelector("[data-comment-list]");
      if (list) list.innerHTML = detail.comments && detail.comments.length ? detail.comments.map(commentItemHtml).join("") : `<div class="comment-hint">还没有评论，来说第一句吧</div>`;
      if (state.commentTarget && state.commentTarget.id === m.id) {
        state.commentTarget.comments = detail.comments;
        if (countTag) countTag.textContent = String(detail.comment_count || 0);
      }
    } catch (err) {
      const list = body.querySelector("[data-comment-list]");
      if (list) list.innerHTML = `<div class="comment-hint">${esc(err.message)}</div>`;
    }
  }

  async function loadFeed() {
    if (state.feedLoading || state.feedDone) return;
    state.feedLoading = true;
    setLoadMoreText();
    try {
      const fq = new URLSearchParams(location.search).get("q") || "";
      const q = new URLSearchParams({ voter_id: state.voterId, limit: String(feedPageSize()) });
      if (state.cursor) q.set("cursor", String(state.cursor));
      if (fq) q.set("q", fq);
      const data = await api("/api/feed?" + q.toString());
      if (state.activeView !== "feed" || !document.getElementById("waterfall")) return;
      state.feed = state.feed.concat(data.list);
      state.cursor = data.nextCursor;
      state.feedDone = !data.nextCursor;

      const ul = document.getElementById("waterfall");
      const timeline = app.querySelector(".timeline");
      if (!ul) return;
      ul.insertAdjacentHTML("beforeend", data.list.map(feedItemHtml).join(""));
      feedEls = Array.from(ul.children);
      syncFeedRO(); // 观察新增卡片：后续图片晚到/视频起播等高度变化自动重排
      hydrateVideos(ul);
      hydrateMusicCards(ul);
      document.querySelector(".layout-loading-placeholder")?.remove();
      timeline?.classList.remove("is-hidden");

      // 追加布局：先强制排一次再等图片，最后精排（与原站一致）
      layout(true);
      await waitForImages(ul);
      layout();
    } catch (e) {
      const el = document.getElementById("loadMore");
      if (el) el.innerHTML = `<span>${esc(e.message)}，点击重试</span>`;
      el && (el.style.cursor = "pointer");
    } finally {
      // 必须在 feedLoading 复位后再刷新文案，否则成功时仍显示 spinner
      state.feedLoading = false;
      setLoadMoreText();
    }
  }

  /* ================= 文章列表 / 详情 ================= */

  async function renderPostList(page = 1) {
    state.activeView = "posts";
    app.innerHTML = `<div class="essay"><div class="posts-wrap"><div class="essay-loading"><span class="spinner"></span><span>加载中...</span></div></div></div>`;
    try {
      const data = await api(`/api/posts?page=${page}&per_page=20`);
      if (state.activeView !== "posts") return;
      const list = data.list;
      const total = data.total ?? list.length;
      const pages = Math.max(1, Math.ceil(total / 20));
      if (!list.length && page > 1) return renderPostList(pages); // 原页被删空时自动回退
      setSeo({ title: `文章 · ${state.settings.site_title}`, description: `共 ${total} 篇文章`, path: "/posts" });
      const adminBtn = state.admin ? `<div style="margin-bottom:1rem;text-align:right"><button class="btn primary" data-act="new-post">＋ 写文章</button></div>` : "";
      app.innerHTML = `
        <div class="essay">
          ${bannerHtml()}
          <div class="posts-wrap">
            ${adminBtn}
            ${
              list.length
                ? list
                    .map(
                      p => `
            <a class="post-item" href="/post/${encodeURIComponent(p.slug)}">
              ${p.cover ? `<img class="cover" src="${esc(thumbSrc(p.cover))}" loading="lazy" alt="" data-orig="${esc(p.cover)}" />` : ""}
              <div class="info">
                <h3>${esc(p.title)}${p.status === "draft" ? '<span class="draft-tag">草稿</span>' : ""}</h3>
                <p class="excerpt">${esc(p.excerpt || "")}</p>
                <div class="date">${timeAgo(p.created_at)}</div>
              </div>
            </a>`
                    )
                    .join("")
                : `<div class="essay-empty"><span class="empty-ico">${svgIcon("file-text", 48)}</span><span>还没有文章</span></div>`
            }
            ${pagerHtml(page, pages)}
          </div>
        </div>`;
      app.querySelectorAll("[data-pager]").forEach(b =>
        b.addEventListener("click", () => {
          renderPostList(b.dataset.pager === "prev" ? page - 1 : page + 1);
          window.scrollTo({ top: 0 });
        })
      );
    } catch (e) {
      app.innerHTML = `<div class="essay"><div class="posts-wrap"><div class="essay-empty">${esc(e.message)}</div></div></div>`;
    }
  }

  async function renderPhotos(page = 1) {
    state.activeView = "photos";
    app.innerHTML = `<div class="essay"><div class="photos-wrap"><div class="essay-loading"><span class="spinner"></span><span>加载中...</span></div></div></div>`;
    try {
      const data = await api(`/api/photos?page=${page}&per_page=24`);
      if (state.activeView !== "photos") return;
      const list = data.list || [];
      const total = data.total ?? list.length;
      const pages = Math.max(1, Math.ceil(total / 24));
      if (!list.length && page > 1) return renderPhotos(pages); // 原页被删空时自动回退
      const s = state.settings;
      setSeo({ title: `相册 · ${s.site_title}`, description: `共 ${total} 张图片`, path: "/photos" });
      // 横幅背景图与首页一致（后台「横幅背景图」设置）
      const bg = /^https?:\/\//i.test(s.banner_bg_image || "") ? s.banner_bg_image : "";
      // 顶部标题卡（与首页横幅风格呼应）
      const header = `
        <div class="banner-card photos-banner">
          <div class="banner-inner${bg ? " has-bg" : ""}"${bg ? ` style="background-image:url('${esc(bg).replace(/'/g, "%27")}')" data-banner-bg="1"` : ""}>
            <div class="banner-content">
              <div>
                <div class="banner-tips">${esc(s.essay_tips)}</div>
                <span class="banner-title">相册</span>
              </div>
              <div class="banner-bottom">
                <div class="banner-desc">共 ${list.length} 张图片 · 记录每一个精彩瞬间</div>
              </div>
            </div>
          </div>
        </div>`;
      const grid = list.length
        ? `<div class="photos-grid">${list
            .map(
              p => {
                const ts = thumbSrc(p.src);
                return `
            <a class="photo-item" data-lightbox="${esc(p.src)}" rel="external nofollow noreferrer">
              <img src="${esc(ts)}" alt="${esc(p.title || "")}" loading="lazy" referrerpolicy="no-referrer"${ts !== p.src ? ` data-orig="${esc(p.src)}"` : ""} />
              ${p.title ? `<span class="photo-title">${esc(p.title)}</span>` : ""}
            </a>`;
              }
            )
            .join("")}</div>`
        : `<div class="essay-empty"><span class="empty-ico">${svgIcon("images", 48)}</span><span>相册还没有图片</span><span style="font-size:.85rem;color:var(--anzhiyu-secondtext)">在后台「相册管理」上传或从说说/文章同步</span></div>`;

      app.innerHTML = `<div class="essay">${header}<div class="photos-wrap">${grid}${pagerHtml(page, pages)}</div></div>`;
      app.querySelectorAll("[data-pager]").forEach(b =>
        b.addEventListener("click", () => {
          renderPhotos(b.dataset.pager === "prev" ? page - 1 : page + 1);
          window.scrollTo({ top: 0 });
        })
      );
    } catch (e) {
      app.innerHTML = `<div class="essay"><div class="photos-wrap"><div class="essay-empty">${esc(e.message)}</div></div></div>`;
    }
  }

  /* ================= 关于我页面（/about） ================= */

  /** 把「每行 a|b|c」文本解析成对象数组，空行忽略 */
  function parseRows(text) {
    return String(text || "")
      .split(/\r?\n/)
      .map(l => l.trim())
      .filter(Boolean)
      .map(l => l.split("|").map(s => s.trim()));
  }

  async function renderAbout() {
    state.activeView = "about";
    const s = state.settings;
    setSeo({
      title: `关于 · ${s.site_title}`,
      description: s.about_signature || s.about_greeting_sub || "",
      path: "/about",
      image: s.about_avatar || s.author_avatar || s.brand_avatar || "",
    });
    app.innerHTML = `<div class="essay"><div class="about-wrap"><div class="essay-loading"><span class="spinner"></span><span>加载中...</span></div></div></div>`;
    try {
      // 最近文章（设计图「最近写的一些东西」），失败则不显示该区块
      let recentPosts = [];
      try {
        const pd = await api("/api/posts?page=1&per_page=6");
        recentPosts = (pd && pd.list) || [];
      } catch (_) {
        recentPosts = [];
      }
      if (state.activeView !== "about") return;

      const avatar = s.about_avatar || s.author_avatar || s.brand_avatar || "";
      const name = s.author_name || s.site_title;

      // 顶部问候 + 作者卡
      const avatarHtml = avatar
        ? `<img class="about-avatar-img" src="${esc(avatar)}" alt="${esc(name)}" />`
        : `<span class="about-avatar-fallback">${svgIcon("pen-nib", 40)}</span>`;
      const head = `
        <section class="about-card about-head">
          <div class="about-greet">
            <h1>${esc(s.about_greeting || "关于我")}</h1>
            ${s.about_greeting_sub ? `<p class="about-greet-sub">${esc(s.about_greeting_sub)}</p>` : ""}
          </div>
          <div class="about-author">
            <div class="about-avatar">${avatarHtml}</div>
            <div class="about-author-info">
              <div class="about-author-name">${esc(name)}</div>
              ${s.about_signature ? `<div class="about-author-sign">${esc(s.about_signature)}</div>` : ""}
            </div>
          </div>
        </section>`;

      // 自我介绍正文 + 右侧「一些数字」
      const statsRows = parseRows(s.about_stats);
      const statsHtml = statsRows.length
        ? `<aside class="about-card about-stats-aside">
            <div class="about-card-title">一些数字</div>
            ${statsRows
              .map(
                r => `<div class="about-stat-mini">
                  <span class="about-stat-mini-num">${esc(r[1] || "")}</span>
                  <span class="about-stat-mini-label">${esc(r[0] || "")}</span>
                  ${r[2] ? `<span class="about-stat-mini-desc">${esc(r[2])}</span>` : ""}
                </div>`
              )
              .join("")}
          </aside>`
        : "";
      const bioHtml = `
        <section class="about-card about-bio${statsHtml ? " has-aside" : ""}">
          <div class="about-bio-main">
            <h2 class="about-card-title">${s.about_bio ? "" : ""}自我介绍</h2>
            <div class="article-body">${sanitizeHtml(marked.parse(s.about_bio || ""))}</div>
          </div>
          ${statsHtml}
        </section>`;

      // 时间线
      const tlRows = parseRows(s.about_timeline);
      const timelineHtml = tlRows.length
        ? `<section class="about-card about-tl">
            <h2 class="about-card-title">一路走来的几个坐标</h2>
            <div class="about-timeline">
              ${tlRows
                .map(
                  r => `<div class="about-tl-item">
                    <div class="about-tl-dot"></div>
                    <div class="about-tl-body">
                      <div class="about-tl-date">${esc(r[0] || "")}</div>
                      <div class="about-tl-title">${esc(r[1] || "")}</div>
                      ${r[2] ? `<div class="about-tl-desc">${esc(r[2])}</div>` : ""}
                    </div>
                  </div>`
                )
                .join("")}
            </div>
          </section>`
        : "";

      // 最近写的一些东西（文章网格）
      const recentHtml = recentPosts.length
        ? `<section class="about-card about-recent">
            <div class="about-recent-head">
              <h2 class="about-card-title">最近写的一些东西</h2>
              <a class="about-more-link" href="/posts">查看全部 ${svgIcon("chevron-right", 14)}</a>
            </div>
            <div class="about-post-grid">
              ${recentPosts
                .map(
                  p => `<a class="about-post-item" href="/post/${encodeURIComponent(p.slug)}">
                    ${p.cover ? `<div class="about-post-cover"><img src="${esc(thumbSrc(p.cover))}" alt="" loading="lazy" data-orig="${esc(p.cover)}" /></div>` : `<div class="about-post-cover about-post-cover-empty">${svgIcon("file-text", 28)}</div>`}
                    <div class="about-post-title">${esc(p.title)}</div>
                  </a>`
                )
                .join("")}
            </div>
          </section>`
        : "";

      // 大数字统计
      const bigRows = parseRows(s.about_bigstats);
      const bigHtml = bigRows.length
        ? `<section class="about-card about-big">
            <div class="about-card-title">这段时间，有多少人来过。</div>
            <div class="about-big-grid">
              ${bigRows
                .map(
                  r => `<div class="about-big-item">
                    <div class="about-big-num">${esc(r[0] || "")}</div>
                    <div class="about-big-label">${esc(r[1] || "")}</div>
                  </div>`
                )
                .join("")}
            </div>
          </section>`
        : "";

      // 联系方式
      const ctRows = parseRows(s.about_contacts);
      const contactHtml = ctRows.length
        ? `<section class="about-card about-contact">
            <h2 class="about-card-title">想聊点什么，就挂挂我。</h2>
            <div class="about-contact-list">
              ${ctRows
                .map(r => {
                  const [type, val, link] = r;
                  const inner = `<span class="about-contact-ico">${svgIcon(contactIcon(type), 18)}</span><span class="about-contact-type">${esc(type || "")}</span><span class="about-contact-val">${esc(val || "")}</span>`;
                  return link
                    ? `<a class="about-contact-item" href="${esc(link)}" target="_blank" rel="noopener noreferrer nofollow">${inner}</a>`
                    : `<div class="about-contact-item">${inner}</div>`;
                })
                .join("")}
            </div>
          </section>`
        : "";

      // 赞助 / 收款码：咖啡主题卡 + 金额按钮切换二维码
      // about_qr_amounts 每行：金额|二维码URL，或 金额|描述|二维码URL（兼容 2/3 列）
      // URL 可空；自动识别哪一列是 http(s) 开头，并去掉反引号/引号包裹
      const cleanUrl = v => String(v || "").trim().replace(/^[`'"]+|[`'"]+$/g, "").trim();
      const amounts = parseRows(s.about_qr_amounts).map(r => {
        const label = String(r[0] || "").trim();
        // 从第 2 列起找第一个以 http 开头的作为二维码 URL
        const src = r.slice(1).map(cleanUrl).find(v => /^https?:\/\//i.test(v)) || cleanUrl(r[r.length - 1]);
        return { label, src: /^https?:\/\//i.test(src) ? src : "" };
      }).filter(x => x.label);
      const firstSrc = amounts.find(x => /^https?:\/\//i.test(x.src))?.src || "";
      const btnHtml = amounts.length
        ? amounts.map((a, i) => `<button type="button" class="about-amt-btn${i === 0 ? " is-active" : ""}" data-qr-src="${esc(a.src)}">${esc(a.label)}</button>`).join("")
        : "";
      const qrImgHtml = firstSrc ? `<img class="about-qr-pic" src="${esc(firstSrc)}" alt="赞助收款码" loading="lazy" />` : `<div class="about-qr-empty">${svgIcon("coffee", 40)}</div>`;
      const qrHtml = `
        <section class="about-card about-sponsor">
          <div class="about-sponsor-main">
            <div class="about-sponsor-head">
              <span class="about-sponsor-ico">${svgIcon("coffee", 22)}</span>
              <span class="about-sponsor-title">请我喝杯咖啡</span>
            </div>
            <div class="about-qr-text">${esc(s.about_qr_text || "")}</div>
            ${btnHtml ? `<div class="about-amt-group" role="group" aria-label="选择赞助金额">${btnHtml}</div>` : ""}
          </div>
          <div class="about-sponsor-qr">
            ${qrImgHtml}
            <div class="about-qr-tip">扫码支持，感谢你 ❤</div>
          </div>
        </section>`;

      app.innerHTML = `<div class="essay"><div class="about-wrap">
        ${head}
        ${bioHtml}
        ${timelineHtml}
        ${recentHtml}
        ${bigHtml}
        ${contactHtml}
        ${qrHtml}
      </div></div>`;
      // 赞助金额按钮：点击切换对应收款码图片
      app.querySelectorAll(".about-amt-btn").forEach(btn => {
        btn.addEventListener("click", () => {
          const src = btn.getAttribute("data-qr-src") || "";
          app.querySelectorAll(".about-amt-btn").forEach(b => b.classList.toggle("is-active", b === btn));
          const pic = app.querySelector(".about-sponsor-qr .about-qr-pic");
          if (!/^https?:\/\//i.test(src)) return; // 该金额未配置二维码，仅高亮不切图
          if (pic) { pic.src = src; }
          else {
            const box = app.querySelector(".about-sponsor-qr");
            if (box) box.innerHTML = `<img class="about-qr-pic" src="${esc(src)}" alt="赞助收款码" loading="lazy" /><div class="about-qr-tip">扫码支持，感谢你 ❤</div>`;
          }
        });
      });
    } catch (e) {
      app.innerHTML = `<div class="essay"><div class="about-wrap"><div class="essay-empty">${esc(e.message)}</div></div></div>`;
    }
  }

  /* ================= 友情链接（/links） ================= */

  /** 相对时间：x 天前 / 刚刚 */
  function timeAgo(iso) {
    if (!iso) return "";
    const t = new Date(iso).getTime();
    if (!t) return "";
    const diff = Date.now() - t;
    const d = Math.floor(diff / 86400000);
    if (d <= 0) return "今天";
    if (d === 1) return "昨天";
    if (d < 30) return `${d} 天前`;
    if (d < 365) return `${Math.floor(d / 30)} 个月前`;
    return `${Math.floor(d / 365)} 年前`;
  }

  /** 友站卡片头像：有图显示图片（裂图回退首字），无图直接首字 */
  function friendAvatar(name, url) {
    const initial = (name || "?").trim().charAt(0).toUpperCase();
    const img = url
      ? `<img src="${esc(url)}" alt="${esc(name)}" referrerpolicy="no-referrer" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'" />`
      : "";
    const fb = `<span class="links-avatar-fb" style="${url ? "display:none" : "display:flex"}">${esc(initial)}</span>`;
    return `<div class="links-avatar">${img}${fb}</div>`;
  }

  async function renderLinks() {
    const activeCat = new URLSearchParams(location.search).get("category") || "全部";
    app.innerHTML = `<div class="essay"><div class="links-wrap"><div class="essay-empty">加载中…</div></div></div>`;
    try {
      const res = await api(`/api/friends?category=${encodeURIComponent(activeCat)}`);
      const { list = [], stats = {}, categories = [] } = res;
      const cats = ["全部", ...categories];
      const filterHtml = cats.map(c => {
        const href = c === "全部" ? "/links" : `/links?category=${encodeURIComponent(c)}`;
        return `<a class="links-cat${c === activeCat ? " is-active" : ""}" href="${href}">${esc(c)}</a>`;
      }).join("");

      const gridHtml = list.length
        ? list.map(f => `
            <a class="links-card" href="${esc(f.url)}" target="_blank" rel="noopener noreferrer nofollow">
              <div class="links-card-top">
                ${friendAvatar(f.name, f.avatar)}
                <div class="links-card-info">
                  <div class="links-card-name">${esc(f.name)}</div>
                  <div class="links-card-domain">${esc((f.url || "").replace(/^https?:\/\//i, "").replace(/\/$/, ""))}</div>
                </div>
                <span class="links-card-arrow">${svgIcon("arrow-up-right", 16)}</span>
              </div>
              <div class="links-card-desc">${esc(f.description || "这个人很懒，什么都没留下。")}</div>
              <div class="links-card-foot">
                ${f.category ? `<span class="links-card-cat">${esc(f.category)}</span>` : ""}
                <span class="links-card-time">${timeAgo(f.last_checked || f.updated_at)}更新</span>
              </div>
            </a>`).join("")
        : `<div class="essay-empty">还没有友链，去<a href="/links/apply">申请友链</a>吧～</div>`;

      app.innerHTML = `<div class="essay"><div class="links-wrap">
        <div class="links-page-head">
          <div class="links-eyebrow">友链 · FRIENDS</div>
          <h1 class="links-title">友链</h1>
          <p class="links-subtitle">这里收集了我常去翻阅的独立博客与友站。每一家都有自己的节奏，值得慢下来读一读。</p>
          <div class="links-stats">
            <div class="links-stat"><b>${stats.total ?? 0}</b><span>友站总数</span></div>
            <div class="links-stat"><b>${stats.categories ?? 0}</b><span>站点分类</span></div>
            <div class="links-stat"><b>${stats.newThisMonth ?? 0}</b><span>本月新增</span></div>
          </div>
        </div>
        <div class="links-cats">${filterHtml}</div>
        <div class="links-grid">${gridHtml}</div>
        <div class="links-apply-banner">
          <div>
            <div class="links-apply-title">想让你的站点也出现在这里？</div>
            <div class="links-apply-desc">交换友链只需提交站点信息，或直接发邮件给我。通常 48 小时内回复，通过后就会加入这面友链墙。</div>
          </div>
          <a class="links-apply-btn" href="/links/apply">申请友链 ${svgIcon("arrow-right", 16)}</a>
        </div>
      </div></div>`;
    } catch (e) {
      app.innerHTML = `<div class="essay"><div class="links-wrap"><div class="essay-empty">${esc(e.message)}</div></div></div>`;
    }
  }

  /* ================= 申请友链（/links/apply） ================= */
  async function renderLinksApply() {
    const s = state.settings;
    const cats = String(s.links_categories || "").split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    const catOpts = cats.map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join("");
    const siteUrl = s.site_domain ? s.site_domain.replace(/\/$/, "") : location.origin;

    app.innerHTML = `<div class="essay"><div class="links-apply-wrap">
      <div class="links-page-head">
        <div class="links-eyebrow">交换友链 · APPLY</div>
        <h1 class="links-title">申请友链</h1>
        <p class="links-subtitle">如果你也在写博客，欢迎交换友链。请先确认自己的站点符合下面的规则，再填写信息提交申请。</p>
      </div>
      <div class="links-apply-grid">
        <div class="links-apply-side">
          <div class="links-info-card">
            <div class="links-info-title">${svgIcon("scroll-text", 18)} 友链规则</div>
            <p>为了保证友链墙的阅读感，这里只收录内容原创、长期更新的个人站点。</p>
            <ol class="links-rules">
              <li>内容以原创为主，无违规、采集与广告信息</li>
              <li>站点已稳定运行 6 个月以上，并有持续更新</li>
              <li>站点首页已放置本站链接，且可以正常访问</li>
              <li>无强制跳转、弹窗与其他干扰性广告</li>
              <li>站点方向与阅读、摄影、设计或技术相关</li>
            </ol>
          </div>
          <div class="links-info-card">
            <div class="links-info-title">${svgIcon("info", 18)} 本站信息</div>
            <p>复制以下信息，填写到你的友链页面即可。</p>
            <div class="links-siteinfo">
              <div><span>站点名称</span><b data-copy="${esc(s.site_title || "")}">${esc(s.site_title || "")}</b></div>
              <div><span>站点地址</span><b data-copy="${esc(siteUrl)}">${esc(siteUrl)}</b></div>
              <div><span>站点简介</span><b data-copy="${esc(s.essay_subtitle || "")}">${esc(s.essay_subtitle || "")}</b></div>
            </div>
          </div>
        </div>
        <form class="links-info-card links-apply-form" id="linksApplyForm">
          <div class="links-info-title">${svgIcon("send", 18)} 提交申请</div>
          <p style="margin:.2rem 0 1rem">填写后我会尽快查看，通过后站点会自动加入友链墙。</p>
          <div class="field"><label>站点名称 *</label><input name="name" maxlength="60" placeholder="例：云间随笔" required /></div>
          <div class="field">
            <label>站点地址 *</label>
            <div style="display:flex;gap:.5rem">
              <input name="url" placeholder="https://example.com" required style="flex:1" />
              <button type="button" class="btn" id="linksFetchBtn">自动获取</button>
            </div>
          </div>
          <div class="field"><label>站点简介</label><input name="description" maxlength="300" placeholder="一句话介绍你的站点" /></div>
          <div class="field"><label>联系邮箱</label><input name="email" type="email" maxlength="120" placeholder="you@example.com" /></div>
          <div class="field"><label>站点分类</label><select name="category">${catOpts}</select></div>
          <button class="btn primary" type="submit">提交申请 ${svgIcon("check", 16)}</button>
          <div class="links-review">
            <div class="links-info-title">审核流程</div>
            <ol class="links-review-steps">
              <li class="is-done"><b>已提交申请</b><span>表单提交成功</span></li>
              <li><b>人工审核</b><span>通常 48 小时内回复，结果会发到你的邮箱</span></li>
              <li><b>上线展示</b><span>通过后自动加入友链墙</span></li>
            </ol>
          </div>
        </form>
      </div>
    </div></div>`;

    // 自动获取站点信息
    const form = document.getElementById("linksApplyForm");
    const fetchBtn = document.getElementById("linksFetchBtn");
    if (fetchBtn && form) {
      fetchBtn.addEventListener("click", async () => {
        const url = form.querySelector('[name="url"]').value.trim();
        if (!url) { toast("请先填写站点地址"); return; }
        fetchBtn.disabled = true; fetchBtn.textContent = "获取中…";
        try {
          const info = await api(`/api/friends/info?url=${encodeURIComponent(url)}`);
          if (info.name) form.querySelector('[name="name"]').value = info.name;
          if (info.description) form.querySelector('[name="description"]').value = info.description;
          if (info.url) form.querySelector('[name="url"]').value = info.url;
          toast("已自动获取站点信息，可再微调");
        } catch (err) {
          toast(err.message || "获取失败，请手动填写");
        } finally {
          fetchBtn.disabled = false; fetchBtn.textContent = "自动获取";
        }
      });
      form.addEventListener("submit", async e => {
        e.preventDefault();
        const fd = new FormData(form);
        const btn = form.querySelector('button[type="submit"]');
        btn.disabled = true;
        try {
          await api("/api/friends/apply", { method: "POST", body: Object.fromEntries(fd) });
          toast("已提交申请，站长审核通过后会出现在友链列表");
          navigate("/links");
        } catch (err) {
          toast(err.message || "提交失败");
        } finally {
          btn.disabled = false;
        }
      });
    }
  }

  /** 联系方式 → lucide 图标名映射，未知类型回退 link */
  function contactIcon(type) {
    const t = String(type || "").toLowerCase();
    if (t.includes("github")) return "github";
    if (t.includes("mail") || t.includes("邮箱") || t.includes("email")) return "mail";
    if (t.includes("rss")) return "rss";
    if (t.includes("qq")) return "message-circle";
    if (t.includes("微博") || t.includes("weibo")) return "at-sign";
    if (t.includes("tg") || t.includes("telegram")) return "send";
    if (t.includes("b站") || t.includes("bilibili")) return "play";
    return "link";
  }

  /** 水合服务端直出的文章页：保留 SSR DOM（无重绘闪烁），仅绑定交互/增强排版 */
  async function hydrateSsrPost(slug) {
    try {
      const p = await api("/api/posts/" + encodeURIComponent(slug));
      if (state.activeView !== "post") return;
      const card = Array.from(app.querySelectorAll(".article-card[data-ssr-post]")).find(
        el => el.dataset.ssrPost === slug
      );
      if (!card) {
        // DOM 已不在（例如快速切页后又返回）：走常规渲染
        renderPostDetail(slug);
        return;
      }
      setSeo({
        title: p.title + " · " + state.settings.site_title,
        description: p.excerpt,
        path: "/post/" + encodeURIComponent(p.slug),
        image: p.cover,
        type: "article",
      });
      // 正文用 marked 重新渲染（音乐卡片等增强）；爬虫已抓到 SSR 版本
      const bodyEl = card.querySelector(".article-body");
      if (bodyEl) bodyEl.innerHTML = sanitizeHtml(marked.parse(p.content_md || ""));
      hydrateMusicCards(app);
      hydrateVideos(app);
      const metaEl = card.querySelector(".article-meta");
      if (metaEl) metaEl.textContent = timeAgo(p.created_at);
      // 评论表单回填本地缓存（SSR 时无法读取访客 localStorage）
      const form = card.querySelector("[data-comment-form]");
      if (form) {
        const nick = localStorage.getItem("moments_nick") || "";
        const email = localStorage.getItem("moments_email") || "";
        const web = getSavedWebsite();
        const nEl = form.querySelector('input[name="nickname"]');
        if (nEl) nEl.value = nick;
        const emEl = form.querySelector('input[name="email"]');
        if (emEl) emEl.value = email;
        const wEl = form.querySelector('input[name="website"]');
        if (wEl) wEl.value = web;
        const avEl = form.querySelector("[data-qq-avatar]");
        if (avEl) avEl.textContent = (nick || "?").slice(0, 1).toUpperCase();
      }
      // 管理员操作区
      if (state.admin) {
        const actions = card.querySelector(".article-actions");
        if (actions) {
          actions.innerHTML = `<button class="btn" data-act="edit-post">编辑</button>
            <button class="btn danger" data-act="del-post">删除</button>
            <a class="btn" href="/posts">返回列表</a>`;
        }
      }
      card.querySelector('[data-act="edit-post"]')?.addEventListener("click", () => openPostEditor(p));
      card.querySelector('[data-act="del-post"]')?.addEventListener("click", async () => {
        if (!confirm("确定删除这篇文章？")) return;
        try {
          await api("/api/posts/" + p.id, { method: "DELETE" });
          toast("已删除");
          navigate("/posts");
        } catch (err) {
          toast(err.message);
        }
      });
      hydrateCommentSection({
        ctype: "post",
        cid: p.id,
        slug: p.slug,
        quote: p.title,
        comment_count: p.comment_count || 0,
      });
    } catch (e) {
      if (state.activeView !== "post") return;
      app.innerHTML = `<div class="essay"><div class="posts-wrap"><div class="essay-empty"><span class="empty-ico">${svgIcon("search", 56)}</span><span>${esc(e.message)}</span><a class="btn" href="/posts">返回</a></div></div></div>`;
    }
  }

  async function renderPostDetail(slug, preview) {
    state.activeView = "post";
    // 服务端已直出文章正文（#app 内带 data-ssr-post）：直接水合，不重绘
    if (!preview) {
      const ssrCard = Array.from(app.querySelectorAll(".article-card[data-ssr-post]")).find(
        el => el.dataset.ssrPost === slug
      );
      if (ssrCard) {
        hydrateSsrPost(slug);
        return;
      }
    }
    app.innerHTML = `<div class="essay"><div class="posts-wrap"><div class="essay-loading"><span class="spinner"></span><span>加载中...</span></div></div></div>`;
    try {
      const p = await api("/api/posts/" + encodeURIComponent(slug) + (preview ? "?preview=1" : ""));
      if (state.activeView !== "post") return;
      setSeo({
        title: p.title + " · " + state.settings.site_title,
        description: p.excerpt,
        path: "/post/" + encodeURIComponent(p.slug),
        image: p.cover,
        type: "article",
      });
      app.innerHTML = `
      <div class="essay">
        <div class="article-card">
          <a class="article-back" href="/" title="返回首页">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z"></path></svg>
            返回首页
          </a>
          <h1>${esc(p.title)}${p.status === "draft" ? '<span class="draft-tag">草稿</span>' : ""}</h1>
          <div class="article-meta">${timeAgo(p.created_at)}</div>
          <div class="article-body">${sanitizeHtml(marked.parse(p.content_md || ""))}</div>
          ${
            state.admin
              ? `<div class="article-actions">
                  <button class="btn" data-act="edit-post">编辑</button>
                  <button class="btn danger" data-act="del-post">删除</button>
                  <a class="btn" href="/posts">返回列表</a>
                </div>`
              : `<div class="article-actions"><a class="btn" href="/posts">返回列表</a></div>`
          }
          <section class="article-comments" data-comment-section>
            <h3 class="comment-section-title">评论<span class="comment-count-badge" data-article-comments-count></span></h3>
            <div class="comment-list" data-comment-list><span class="spinner"></span></div>
            <form class="comment-form-wrap comment-form-inline" data-comment-form data-ctype="post" data-cid="${p.id}" data-slug="${esc(p.slug)}">
              <div class="comment-form-row comment-user-row">
                <span class="qq-avatar" data-qq-avatar>${esc((localStorage.getItem("moments_nick") || "?").slice(0, 1).toUpperCase())}</span>
                <input name="nickname" placeholder="昵称或 QQ 号（填 QQ 号自动获取昵称邮箱头像）" maxlength="20" value="${esc(localStorage.getItem("moments_nick") || "")}" required autocomplete="off" />
              </div>
              <div class="comment-form-row">
                <input name="email" type="email" placeholder="邮箱 *" maxlength="100" value="${esc(localStorage.getItem("moments_email") || "")}" required />
                <input name="website" placeholder="网址（选填，头像可点击跳转）" maxlength="200" value="${esc(getSavedWebsite())}" />
              </div>
              <div class="comment-toolbar">
                <button type="button" class="comment-tool-btn" data-emoji-btn title="表情">${svgIcon("smile", 18)}</button>
                <button type="button" class="comment-tool-btn" data-img-upload-btn title="上传图片">${svgIcon("image", 18)}</button>
                <input type="file" accept="image/*" data-img-file hidden />
                <input type="text" class="comment-img-url-input" data-img-url-input placeholder="图片 URL，回车添加" maxlength="500" />
                <button type="button" class="comment-tool-btn comment-random-btn" data-random-comment title="随机一句">${svgIcon("dices", 18)}</button>
              </div>
              <textarea name="content" placeholder="说点什么…（支持 @ 提及他人）" maxlength="500" required style="min-height:100px"></textarea>
              <div class="comment-img-preview" data-comment-img-preview style="display:none"></div>
              <div class="comment-form-foot">
                <button class="btn primary" type="submit">发表评论</button>
              </div>
            </form>
          </section>
        </div>
      </div>`;
      hydrateMusicCards(app);
      hydrateVideos(app);
      app.querySelector('[data-act="edit-post"]')?.addEventListener("click", () => openPostEditor(p));
      app.querySelector('[data-act="del-post"]')?.addEventListener("click", async () => {
        if (!confirm("确定删除这篇文章？")) return;
        try {
          await api("/api/posts/" + p.id, { method: "DELETE" });
          toast("已删除");
          navigate("/posts");
        } catch (e) {
          toast(e.message);
        }
      });
      // 文章内联评论区：直接渲染在正文下方，与说说共用评论逻辑（楼中楼/@/QQ头像/折叠）
      hydrateCommentSection({
        ctype: "post",
        cid: p.id,
        slug: p.slug,
        quote: p.title,
        comment_count: p.comment_count || 0,
      });
    } catch (e) {
      app.innerHTML = `<div class="essay"><div class="posts-wrap"><div class="essay-empty"><span class="empty-ico">${svgIcon("search", 56)}</span><span>${esc(e.message)}</span><a class="btn" href="/posts">返回</a></div></div></div>`;
    }
  }

  /* ================= 管理：解锁 ================= */

  /** 更新顶栏「后台」导航地址为秘密入口（桌面导航 + 移动菜单各一份） */
  function updateAdminNavHref() {
    document.querySelectorAll(".admin-only-nav").forEach(link => {
      link.setAttribute("href", state.adminPath || "/admin");
    });
  }

  function setAdminPath(p) {
    if (!p || p === state.adminPath) return;
    state.adminPath = p;
    try { localStorage.setItem("moments_admin_path", p); } catch (_) {}
    updateAdminNavHref();
  }

  async function refreshAdmin() {
    try {
      const data = await api("/api/admin/session");
      state.admin = !!data.admin;
      if (data.admin && data.admin_path) setAdminPath(data.admin_path);
    } catch (_) {
      state.admin = false;
    }
    renderAdminArea();
  }

  function renderAdminArea() {
    // 未登录时顶栏不显示任何后台入口（「解锁」按钮一并隐藏，后台对访客隐形）
    const html = state.admin
      ? `
      <button class="btn primary" data-nav="new-moment"><span class="label-text">＋ 说说</span></button>
      <button class="btn" data-nav="new-post"><span class="label-text">写文章</span></button>
      <button class="btn ghost" data-nav="logout" title="退出">退出</button>`
      : "";
    adminArea.innerHTML = html;
    const mobileAdmin = document.getElementById("adminAreaMobile");
    if (mobileAdmin) mobileAdmin.innerHTML = html;
    document.querySelectorAll(".admin-only-nav").forEach(link => {
      link.hidden = !state.admin;
    });
    updateAdminNavHref();
    syncFab();
  }

  /** 悬浮 + 仅管理员、且不在后台页时显示 */
  function syncFab() {
    fabPublish.hidden = !state.admin || location.pathname === state.adminPath;
  }

  fabPublish.addEventListener("click", () => openMomentComposer());

  function openLogin() {
    const modal = openModal(`
      <div class="modal-head"><h3>站主解锁</h3></div>
      <form data-login-form>
        <div class="field">
          <label>管理密码</label>
          <input type="password" name="password" placeholder="输入 ADMIN_PASSWORD" autocomplete="current-password" required />
        </div>
        <div class="modal-foot">
          <button type="button" class="btn" data-close>取消</button>
          <button type="submit" class="btn primary">解锁</button>
        </div>
      </form>`);
    modal.querySelector("[data-close]").addEventListener("click", closeModal);
    modal.querySelector("input").focus();
    modal.querySelector("form").addEventListener("submit", async e => {
      e.preventDefault();
      const password = modal.querySelector('input[name="password"]').value;
      try {
        const data = await api("/api/admin/login", { method: "POST", body: { password, path: state.adminPath } });
        state.admin = true;
        if (data.admin_path) setAdminPath(data.admin_path);
        renderAdminArea();
        closeModal();
        toast("已解锁");
        if (location.pathname !== state.adminPath) navigate(state.adminPath, { replace: true });
        else route();
      } catch (err) {
        toast(err.status === 401 ? "密码错误" : err.message);
      }
    });
  }

  /* ================= 管理：发动态 ================= */

  /** 后台编辑评论内容：小弹窗，PUT /api/admin/comments/:cid */
  function openCommentEditor(cid, content) {
    const modal = openModal(`
      <div class="modal-head"><h3>编辑评论</h3><button type="button" class="modal-x" data-close aria-label="关闭">×</button></div>
      <form class="comment-edit-form" data-comment-edit-form data-cid="${cid}">
        <div class="field">
          <label>评论内容</label>
          <textarea name="content" maxlength="500" required style="min-height:90px">${esc(content || "")}</textarea>
        </div>
        <div class="modal-foot">
          <button type="button" class="btn" data-close>取消</button>
          <button type="submit" class="btn primary">保存</button>
        </div>
      </form>`);
    modal.querySelectorAll("[data-close]").forEach(b => b.addEventListener("click", closeModal));
    const form = modal.querySelector("[data-comment-edit-form]");
    form.addEventListener("submit", async e => {
      e.preventDefault();
      const v = form.content.value.trim();
      if (!v) return toast("评论内容不能为空");
      const btn = form.querySelector('button[type="submit"]');
      btn.disabled = true;
      try {
        await api(`/api/admin/comments/${cid}`, { method: "PUT", body: { content: v } });
        closeModal();
        toast("已更新");
        renderAdminComments(document.getElementById("adminPanel"));
      } catch (err) {
        toast(err.message);
        btn.disabled = false;
      }
    });
    setTimeout(() => form.content.focus(), 50);
  }

  /** 后台查看说说：弹窗预览单条说说（复用时间线渲染逻辑，不跳转首页） */
  function openMomentView(m) {
    const modal = openModal(`
      <div class="modal-head">
        <h3>说说预览</h3>
        <button type="button" class="modal-x" data-close aria-label="关闭">×</button>
      </div>
      <div class="moment-view">
        <div class="mv-meta">
          <time datetime="${esc(m.created_at)}">${timeAgo(m.created_at)}</time>
          ${m.location ? `<span class="mv-loc">${svgIcon("locationDot", 14)}${esc(m.location)}</span>` : ""}
          <span class="mv-stats">赞 ${m.like_count || 0} · 评论 ${m.comment_count || 0}</span>
        </div>
        ${m.content || (m.video && m.video.src) || (m.images && m.images.length)
          ? `<div class="datacont">${renderContentHtml(m.content)}${videoHtml(m.video)}</div>${imagesGridHtml(m)}`
          : `<div class="comment-hint">这条说说没有正文内容</div>`}
      </div>`);
    modal.querySelector("[data-close]").addEventListener("click", closeModal);
    hydrateVideos(modal);
    hydrateMusicCards(modal);
  }

  /** 说说编辑器（独立）：发布即刻弹窗（插入行 + 音乐坞 + 图片工具条 + 一键定位） */
  function openMomentComposer(existing) {
    const isEdit = !!existing;
    const draft = {
      images: Array.isArray(existing?.images) ? [...existing.images] : [],
      video: existing?.video ? { ...existing.video } : null,
    };
    const modal = openModal(`
      <div class="modal-head composer-head">
        <div class="ch-text">
          <h3>${isEdit ? "编辑即刻" : "发布即刻"}</h3>
          <p class="composer-sub">${isEdit ? "修改后将立即同步到时间线" : "记录此刻的想法，发布后将立即出现在时间线中"}</p>
        </div>
        <button type="button" class="modal-x" data-close aria-label="关闭">×</button>
      </div>
      <form data-moment-form>
        <div class="field">
          <label>内容<sup>*</sup></label>
          <textarea name="content" placeholder="记录此刻的想法…（支持简单 Markdown 语法）" maxlength="5000" style="min-height:112px"></textarea>
        </div>
        <div class="composer-insert">
          <span class="ci-label">插入：</span>
          <button type="button" class="ci-btn" data-ins-img>${mdIcon("image")}图片</button>
          <button type="button" class="ci-btn" data-ins-video>${mdIcon("video")}视频</button>
          <button type="button" class="ci-btn" data-ins-music>${mdIcon("music")}音乐</button>
          <span class="ci-sep"></span>
          <button type="button" class="ci-btn" data-ins-center title="将选中的文字居中（再点一次取消）">${mdIcon("alignCenter")}居中</button>
        </div>
        <!-- 图片面板 -->
        <div class="composer-panel" data-panel="img" hidden>
          <div class="pick-toolbar">
            <button type="button" class="btn pt-upload" data-add-img>${mdIcon("upload")}上传图片</button>
            <div class="pick-url">
              <input type="url" placeholder="或粘贴图片链接后回车添加" data-img-url />
              <button type="button" class="pick-url-add" data-add-url title="添加链接图片">＋</button>
            </div>
          </div>
          <div class="pick-grid" data-pick-grid></div>
          <input type="file" name="images" accept="image/jpeg,image/png,image/gif,image/webp" multiple hidden />
          <div class="upload-progress" data-img-progress></div>
          <p class="field-hint">支持 JPG/PNG/WebP，最多 9 张；可拖拽缩略图调整顺序。</p>
        </div>
        <!-- 视频面板 -->
        <div class="composer-panel" data-panel="video" hidden>
          <div class="seg">
            <button type="button" data-vtab="mp4-upload" class="on">上传 MP4</button>
            <button type="button" data-vtab="url">在线地址</button>
          </div>
          <div data-vpanel="mp4-upload">
            <input type="file" accept="video/mp4" name="video-file" />
            <div class="upload-progress" data-video-progress></div>
          </div>
          <div data-vpanel="url" hidden>
            <div class="emp-row">
              <input type="url" name="video-url" placeholder="https://example.com/video.m3u8 或 .mp4" />
            </div>
            <div class="emp-row">
              <input type="url" data-moment-poster placeholder="封面图地址（选填，不填显示纯色占位）" />
            </div>
            <div class="emp-help">M3U8（HLS 流媒体）和 MP4 均可。封面图可选填任意网络图片地址。</div>
          </div>
          <div class="video-preview" data-video-preview hidden></div>
        </div>
        <!-- 音乐面板 -->
        <div class="composer-panel" data-panel="music">
          <div data-music-box></div>
        </div>
        <div class="field">
          <label>地点</label>
          <div class="loc-wrap">
            <span class="loc-pin">${mdIcon("pin")}</span>
            <input name="location" placeholder="此刻在哪里？（可选）" maxlength="100" />
            <button type="button" class="loc-btn" data-locate title="一键定位当前位置">${mdIcon("crosshair")}</button>
          </div>
        </div>
        <div class="modal-foot compact">
          <button type="button" class="btn" data-close>取消</button>
          <button type="submit" class="btn primary">${mdIcon("rocket")}发布</button>
        </div>
      </form>`);

    const form = modal.querySelector("form");
    const ta = modal.querySelector('textarea[name="content"]');
    const grid = modal.querySelector("[data-pick-grid]");
    const fileInput = modal.querySelector('input[name="images"]');
    const insertRow = modal.querySelector(".composer-insert");

    // 编辑器内嵌可播放音乐坞（[music=ID] 实时渲染可试听卡片）
    editorMusicDock(ta, insertRow);

    // 面板选项卡切换：图片/视频/音乐 互斥显示，再点收起
    const panels = modal.querySelectorAll(".composer-panel");
    const ciBtns = modal.querySelectorAll(".ci-btn[data-ins-img], .ci-btn[data-ins-video], .ci-btn[data-ins-music]");
    function showPanel(name, btn) {
      const wasOpen = btn.classList.contains("on");
      ciBtns.forEach(b => b.classList.remove("on"));
      panels.forEach(p => (p.hidden = true));
      if (wasOpen) return; // 再点收起
      btn.classList.add("on");
      const panel = modal.querySelector(`[data-panel="${name}"]`);
      if (panel) panel.hidden = false;
    }
    modal.querySelector("[data-ins-img]").addEventListener("click", function () { showPanel("img", this); });
    modal.querySelector("[data-ins-video]").addEventListener("click", function () { showPanel("video", this); });
    modal.querySelector("[data-ins-center]").addEventListener("click", () => mdWrapCenter(ta));

    // 视频 tab 切换
    let vtab = "mp4-upload";
    modal.querySelectorAll("[data-vtab]").forEach(btn => {
      btn.addEventListener("click", () => {
        vtab = btn.dataset.vtab;
        modal.querySelectorAll("[data-vtab]").forEach(b => b.classList.toggle("on", b === btn));
        modal.querySelectorAll("[data-vpanel]").forEach(p => (p.hidden = p.dataset.vpanel !== vtab));
      });
    });

    // 视频预览卡片
    const videoFileInput = modal.querySelector('input[name="video-file"]');
    const videoPreview = modal.querySelector("[data-video-preview]");
    function renderVideoPreview() {
      if (!draft.video) { videoPreview.hidden = true; return; }
      videoPreview.hidden = false;
      const p = draft.video.poster;
      videoPreview.innerHTML = `
        <div class="vp-card">
          ${p ? `<img class="vp-poster" src="${esc(p)}" alt="封面" />` : `<div class="vp-no-poster">无封面</div>`}
          <div class="vp-info">
            <span class="vp-kind">${draft.video.kind === "hls" ? "M3U8" : "MP4"}</span>
            <span class="vp-src">${esc(draft.video.src.slice(0, 60))}</span>
          </div>
          <button type="button" class="btn ghost sm" data-rm-video>移除</button>
        </div>`;
      videoPreview.querySelector("[data-rm-video]").addEventListener("click", () => {
        draft.video = null;
        videoFileInput.value = "";
        const vu = modal.querySelector('input[name="video-url"]');
        if (vu) vu.value = "";
        const mp = modal.querySelector("[data-moment-poster]");
        if (mp) mp.value = "";
        renderVideoPreview();
      });
    }

    // 音乐插入面板：面板显示时初始化音乐搜索
    const musicBox = modal.querySelector("[data-music-box]");
    let musicInited = false;
    modal.querySelector("[data-ins-music]").addEventListener("click", function () {
      showPanel("music", this);
      if (!musicInited && !this.classList.contains("on")) return;
      if (!musicInited && this.classList.contains("on")) {
        toggleMusicInsertPanel(musicBox, ta);
        musicInited = true;
      }
    });

    // 编辑模式：回填内容 / 地点 / 视频
    if (isEdit) {
      ta.value = existing.content || "";
      const locInput0 = modal.querySelector('input[name="location"]');
      if (locInput0 && existing.location) locInput0.value = existing.location;
      if (draft.video) {
        const urlTab = modal.querySelector('[data-vtab="url"]');
        if (urlTab) urlTab.click();
        const vu = modal.querySelector('input[name="video-url"]');
        if (vu) vu.value = draft.video.src || "";
        const mp = modal.querySelector("[data-moment-poster]");
        if (mp && draft.video.poster) mp.value = draft.video.poster;
        renderVideoPreview();
      }
    }
    // 封面后台任务 Promise：发布前等待它完成（带超时兜底），避免封面还没传完
    // 就提交导致该条说说永久无封面
    let videoPosterPromise = null;
    videoFileInput.addEventListener("change", async () => {
      const file = videoFileInput.files[0];
      videoFileInput.value = ""; // 允许再次选择同一个文件
      if (!file) return;
      const prog = modal.querySelector("[data-video-progress]");
      prog.textContent = `上传视频 ${Math.round(file.size / 1048576)}MB，0%`;
      try {
        // HEVC 检测：iPhone 默认录制为 hvc1，Firefox/部分 Chrome 不能解码 → 有声音没画面
        // 转码为 H.264 后所有浏览器可播；H.264 视频直传无影响
        let videoToUpload = file;
        if (await detectHevcMp4(file)) {
          prog.textContent = "检测到 HEVC 视频，正在转码为 H.264…";
          videoToUpload = await transcodeHevcToAvc(file, p => {
            // 100% 后 ffmpeg 还要做音频封装（原 faststart 已移除），期间可能持续数秒~数十秒
            if (modal.isConnected) prog.textContent = p >= 0.995 ? "正在封装视频，请稍候…" : `转码 HEVC → H.264 ${Math.round(p * 100)}%（首次加载转码器约 30MB）`;
          });
          if (!modal.isConnected) return; // 弹窗已关：放弃后续上传，不再写已废弃的 draft
        }
        const data = await uploadMedia(videoToUpload, "video", p => {
          if (modal.isConnected) prog.textContent = `上传视频 ${Math.round(videoToUpload.size / 1048576)}MB，${Math.round(p * 100)}%`;
        });
        if (!modal.isConnected) return;
        draft.video = { kind: "mp4", src: data.src, poster: null };
        const uploadedSrc = data.src;
        renderVideoPreview();
        // 视频上传完成后异步截取并上传封面（不阻塞插入，失败静默；用户也可事后自定义）
        // 注意：从转码后的文件截取封面（HEVC 原文件在 canvas 上可能无法渲染）
        videoPosterPromise = (async () => {
          try {
            if (modal.isConnected) prog.textContent = "截取封面…";
            const posterBlob = await extractVideoPoster(videoToUpload);
            if (!posterBlob) { if (modal.isConnected) prog.textContent = ""; return; }
            const posterData = await uploadFile(new File([posterBlob], "poster.jpg", { type: "image/jpeg" }), "image");
            // 弹窗已关，或用户已改用其他视频（URL 面板/重新上传）：不写 draft
            if (!modal.isConnected || draft.video?.src !== uploadedSrc) return;
            draft.video = { ...draft.video, poster: posterData.src };
            renderVideoPreview();
          } catch {}
          if (modal.isConnected) prog.textContent = "";
        })();
      } catch (err) {
        if (modal.isConnected) { prog.textContent = ""; toast(err.message); }
      }
    });

    // 图片：上传 / 链接添加 / 缩略图删除与拖拽排序
    function renderPicks() {
      grid.innerHTML = draft.images
        .map(
          (src, i) => `
      <div class="pick-item" draggable="true" data-drag-idx="${i}">
        <img src="${esc(thumbSrc(src))}" alt=""${thumbSrc(src) !== src ? ` data-orig="${esc(src)}"` : ""} />
        <button type="button" class="remove" data-rm-img="${i}">×</button>
      </div>`
        )
        .join("");
    }
    renderPicks();
    modal.querySelector("[data-add-img]").addEventListener("click", () => fileInput.click());

    fileInput.addEventListener("change", async () => {
      const files = [...fileInput.files];
      fileInput.value = "";
      if (!files.length) return;
      const room = 9 - draft.images.length;
      if (files.length > room) {
        toast("最多 9 张，多余的已忽略");
        files.splice(room);
      }
      const prog = modal.querySelector("[data-img-progress]");
      for (const file of files) {
        prog.textContent = `处理图片 ${file.name} …`;
        try {
          const data = await uploadMedia(file, "image", p => {
            prog.textContent = `上传图片 ${file.name} ${Math.round(p * 100)}%`;
          });
          draft.images.push(data.src);
          renderPicks();
        } catch (err) {
          toast(err.message);
        }
      }
      prog.textContent = draft.images.length ? `已选 ${draft.images.length} 张` : "";
    });

    const urlInput = modal.querySelector("[data-img-url]");
    const addUrlImg = () => {
      const v = urlInput.value.trim();
      if (!v) return;
      if (draft.images.length >= 9) return toast("最多 9 张图片");
      draft.images.push(v);
      urlInput.value = "";
      renderPicks();
    };
    modal.querySelector("[data-add-url]").addEventListener("click", addUrlImg);
    urlInput.addEventListener("keydown", e => {
      if (e.key === "Enter") {
        e.preventDefault();
        addUrlImg();
      }
    });

    let dragIdx = null;
    grid.addEventListener("dragstart", e => {
      const it = e.target.closest(".pick-item");
      if (!it) return;
      dragIdx = Number(it.dataset.dragIdx);
      it.classList.add("dragging");
    });
    grid.addEventListener("dragend", () => {
      dragIdx = null;
      grid.querySelectorAll(".pick-item.dragging").forEach(it => it.classList.remove("dragging"));
    });
    grid.addEventListener("dragover", e => {
      if (dragIdx === null) return;
      e.preventDefault();
      const it = e.target.closest(".pick-item");
      if (!it) return;
      const to = Number(it.dataset.dragIdx);
      if (to === dragIdx) return;
      const [moved] = draft.images.splice(dragIdx, 1);
      draft.images.splice(to, 0, moved);
      dragIdx = to;
      renderPicks();
    });
    grid.addEventListener("click", e => {
      const rm = e.target.closest("[data-rm-img]");
      if (rm) {
        draft.images.splice(Number(rm.dataset.rmImg), 1);
        renderPicks();
      }
    });

    // 地点一键定位（浏览器取坐标 → 同源 Worker 代理 OSM 反查地名，失败降级经纬度）
    const locInput = modal.querySelector('input[name="location"]');
    const locBtn = modal.querySelector("[data-locate]");
    locBtn.addEventListener("click", async () => {
      if (!navigator.geolocation) return toast("当前环境不支持定位（需 HTTPS 或 localhost）");
      const requestPos = opts =>
        new Promise((resolve, reject) => navigator.geolocation.getCurrentPosition(resolve, reject, opts));
      locBtn.disabled = true;
      const oldHtml = locBtn.innerHTML;
      locBtn.innerHTML = '<span class="spinner" style="width:14px;height:14px;border-width:2px"></span>';

      // 两段式：先用 2 分钟内缓存/低精度快速取位（12s）；超时再开高精度 GPS 冷定位（25s）。
      // 手机 GPS 冷启动在室内常需 15s 以上，单次 10s 极易误报超时。
      let pos = null;
      let lastErr = null;
      try {
        pos = await requestPos({ enableHighAccuracy: false, timeout: 12000, maximumAge: 120000 });
      } catch (e1) {
        if (e1.code === 1) {
          lastErr = e1; // 权限被拒绝不必重试
        } else {
          toast("正在使用 GPS 精确定位，请稍候…");
          try {
            pos = await requestPos({ enableHighAccuracy: true, timeout: 25000, maximumAge: 0 });
          } catch (e2) {
            lastErr = e2;
          }
        }
      }

      if (!pos) {
        // 浏览器定位失败 → IP 定位兜底（Cloudflare 边缘自带数据，城市级，不依赖代理和外部服务）
        try {
          const j = await api("/api/geo/ip");
          if (Number.isFinite(j.latitude) && Number.isFinite(j.longitude)) {
            pos = { coords: { latitude: j.latitude, longitude: j.longitude } };
            toast("浏览器定位不可用，已改用 IP 定位（城市级精度）");
          }
        } catch (_) {}
      }

      if (!pos) {
        locBtn.disabled = false;
        locBtn.innerHTML = oldHtml;
        const code = lastErr?.code;
        const msg =
          code === 1
            ? "定位权限被拒绝，请在浏览器地址栏允许定位"
            : code === 2
              ? "暂时获取不到位置：请确认手机已开启系统定位（GPS），并到窗边或室外重试"
              : code === 3
                ? "定位超时：室内 GPS 信号弱或手机网络不佳，请到窗边/室外重试，并检查定位开关与网络"
                : "定位失败：" + (lastErr?.message || "未知错误");
        toast(msg);
        return;
      }

      const { latitude, longitude } = pos.coords;
      try {
        const j = await api(
          `/api/geo/reverse?lat=${latitude.toFixed(6)}&lon=${longitude.toFixed(6)}`
        );
        locInput.value = j.place || `${latitude.toFixed(4)}, ${longitude.toFixed(4)}`;
        toast("已填入当前位置");
      } catch (_) {
        locInput.value = `${latitude.toFixed(4)}, ${longitude.toFixed(4)}`;
        toast("地名解析失败，已填入经纬度");
      }
      locBtn.disabled = false;
      locBtn.innerHTML = oldHtml;
    });

    modal.querySelectorAll("[data-close]").forEach(b => b.addEventListener("click", closeModal));

    form.addEventListener("submit", async e => {
      e.preventDefault();
      const content = form.content.value.trim();
      const location = form.location.value.trim();
      if (vtab === "url") {
        const url = form["video-url"].value.trim();
        const posterInput = modal.querySelector("[data-moment-poster]");
        const poster = posterInput ? posterInput.value.trim() : "";
        if (url) {
          const isHls = /\.m3u8($|\?)/i.test(url.split("?")[0] + "?");
          draft.video = { kind: isHls ? "hls" : "mp4", src: url, poster: poster || null };
        } else {
          draft.video = null;
        }
      }
      if (!content && !draft.images.length && !draft.video) return toast("内容不能为空");
      const btn = form.querySelector('button[type="submit"]');
      btn.disabled = true;
      // 封面仍在后台截取/上传时等待完成（最多 15s 兜底，超时先发布保证不卡死），
      // 否则该条说说会以 poster=null 永久落库
      if (videoPosterPromise) {
        btn.textContent = "封面处理中…";
        try {
          await Promise.race([videoPosterPromise, new Promise(r => setTimeout(r, 15000))]);
        } catch {}
      }
      try {
        if (isEdit) {
          await api(`/api/moments/${existing.id}`, {
            method: "PUT",
            body: { content, images: draft.images, video: draft.video, location },
          });
          closeModal();
          toast("已更新");
        } else {
          await api("/api/moments", {
            method: "POST",
            body: { content, images: draft.images, video: draft.video, location },
          });
          closeModal();
          toast("发布成功");
        }
        route();
        // 若在后台管理页，刷新说说列表（回到第 1 页看到新说说）
        // 注意：本函数内 location 被「定位输入框的值」遮蔽，必须用 window.location
        if (window.location.pathname.startsWith("/admin")) {
          renderAdminMoments(document.getElementById("adminPanel"), 1);
        }
      } catch (err) {
        toast(err.message);
        btn.disabled = false;
      }
    });
  }

  /* ================= 管理：写文章 ================= */

  function openPostEditor(existing) {
    const isEdit = !!existing;
    const modal = openModal(`
      <div class="modal-head"><h3>${isEdit ? "编辑文章" : "写文章"}</h3></div>
      <form data-post-form>
        <div class="field">
          <label>标题</label>
          <input name="title" maxlength="100" required value="${esc(existing?.title || "")}" />
        </div>
        <div class="field">
          <label>封面（选填，可上传或粘贴图片 URL）</label>
          <div style="display:flex;gap:8px">
            <input name="cover" placeholder="/media/... 或 https://..." value="${esc(existing?.cover || "")}" />
            <button type="button" class="btn" data-cover-upload style="white-space:nowrap">上传</button>
          </div>
          <input type="file" accept="image/jpeg,image/png,image/gif,image/webp" hidden name="cover-file" />
        </div>
        <div class="field">
          <label>摘要（选填，留空自动取正文开头）</label>
          <input name="excerpt" maxlength="300" value="${esc(existing?.excerpt || "")}" />
        </div>
        <div class="field">
          <label>正文（Markdown）</label>
          <textarea name="content_md" required>${esc(existing?.content_md || "")}</textarea>
        </div>
        <div class="modal-foot">
          <button type="button" class="btn" data-close>取消</button>
          <button type="submit" class="btn" name="status" value="draft">存草稿</button>
          <button type="submit" class="btn primary" name="status" value="published">${isEdit ? "保存" : "发布"}</button>
        </div>
      </form>`, { size: "lg" });

    attachPostEditorTools(modal, "content_md");

    const coverInput = modal.querySelector('input[name="cover"]');
    const coverFile = modal.querySelector('input[name="cover-file"]');
    modal.querySelector("[data-cover-upload]").addEventListener("click", () => coverFile.click());
    coverFile.addEventListener("change", async () => {
      const file = coverFile.files[0];
      if (!file) return;
      try {
        toast("正在处理封面图片…");
        const data = await uploadMedia(file, "image");
        coverInput.value = data.src;
        toast("封面已上传");
      } catch (err) {
        toast(err.message);
      }
    });

    modal.querySelector("[data-close]").addEventListener("click", closeModal);

    modal.querySelector("form").addEventListener("submit", async e => {
      e.preventDefault();
      const submitter = e.submitter;
      const status = (submitter && submitter.value) || "published";
      const f = e.currentTarget;
      const payload = {
        title: f.title.value.trim(),
        cover: f.cover.value.trim(),
        excerpt: f.excerpt.value.trim(),
        content_md: f.content_md.value,
        status,
      };
      try {
        if (isEdit) {
          await api("/api/posts/" + existing.id, { method: "PUT", body: payload });
        } else {
          await api("/api/posts", { method: "POST", body: payload });
        }
        closeModal();
        toast(status === "draft" ? "草稿已保存" : "文章已发布");
        route();
      } catch (err) {
        toast(err.message);
      }
    });
  }

  /* ================= 后台管理页 ================= */

  const ADMIN_TABS = [
    { key: "overview", label: "概览", icon: "layout-dashboard" },
    { key: "moments", label: "说说", icon: "message-circle" },
    { key: "posts", label: "文章", icon: "file-text" },
    { key: "photos", label: "相册", icon: "image" },
    { key: "friends", label: "友链", icon: "link" },
    { key: "about", label: "关于我", icon: "circle-user" },
    { key: "comments", label: "评论", icon: "message-square" },
    { key: "appearance", label: "外观", icon: "palette" },
    { key: "media", label: "媒体", icon: "folder" },
    { key: "ai", label: "AI 助手", icon: "bot" },
    { key: "seo", label: "搜索收录", icon: "search" },
    { key: "security", label: "安全", icon: "shield" },
  ];

  /**
   * 首次部署设初始密码：D1 无 password_hash 且环境变量 ADMIN_PASSWORD 未设置时，
   * /admin SSR 注入 x-admin-setup=1，前端渲染此表单。提交后写入 SHA-256 哈希并登录。
   */
  function renderAdminSetup() {
    setSeo({ title: `初始化 · ${state.settings.site_title}`, path: location.pathname, noindex: true });
    app.innerHTML = `
      <div class="essay"><div class="admin-wrap">
        <div class="admin-lock">
          <span class="lock-icon">${svgIcon("lock", 40)}</span>
          <h3 style="margin:0 0 .5rem">设置初始管理密码</h3>
          <p style="margin:0 0 1rem;color:var(--muted)">首次部署，请设置管理密码（6-128 位）</p>
          <form data-admin-setup>
            <input type="password" name="new_password" placeholder="设置管理密码" autocomplete="new-password" required minlength="6" maxlength="128"
              style="margin-bottom:.5rem;text-align:center" />
            <input type="password" name="confirm_password" placeholder="再次输入密码" autocomplete="new-password" required minlength="6" maxlength="128"
              style="margin-bottom:.75rem;text-align:center" />
            <button class="btn primary block" type="submit">设置并登录</button>
            <p class="setup-msg" style="margin:.6rem 0 0;font-size:.8rem;color:#f56c6c;min-height:1em"></p>
          </form>
        </div>
      </div></div>`;
    const form = app.querySelector("[data-admin-setup]");
    const msg = app.querySelector(".setup-msg");
    form.querySelector('input[name="new_password"]').focus();
    form.addEventListener("submit", async e => {
      e.preventDefault();
      const newPwd = form.querySelector('input[name="new_password"]').value;
      const confirmPwd = form.querySelector('input[name="confirm_password"]').value;
      const btn = form.querySelector("button");
      msg.textContent = "";
      if (newPwd !== confirmPwd) {
        msg.textContent = "两次输入的密码不一致";
        return;
      }
      if (newPwd.length < 6) {
        msg.textContent = "密码至少 6 位";
        return;
      }
      btn.disabled = true;
      try {
        const data = await api("/api/admin/setup", {
          method: "POST",
          body: { new_password: newPwd, path: location.pathname },
        });
        state.admin = true;
        if (data.admin_path) setAdminPath(data.admin_path);
        toast("初始密码已设置，已自动登录");
        renderAdminArea();
        route();
      } catch (err) {
        msg.textContent = err.message || "设置失败";
        btn.disabled = false;
      }
    });
  }

  function renderAdmin() {
    const curPath = location.pathname;
    setSeo({ title: `管理后台 · ${state.settings.site_title}`, path: curPath, noindex: true });
    if (!state.admin) {
      app.innerHTML = `
        <div class="essay"><div class="admin-wrap">
          <div class="admin-lock">
            <span class="lock-icon">${svgIcon("lock", 40)}</span>
            <h3 style="margin:0 0 .5rem">站主解锁</h3>
            <p>请输入管理密码</p>
            <form data-entry-login>
              <input type="password" name="password" placeholder="管理密码" autocomplete="current-password" required
                style="margin-bottom:.75rem;text-align:center" />
              <button class="btn primary block" type="submit">解锁</button>
              <p class="entry-login-msg" style="margin:.6rem 0 0;font-size:.8rem;color:#f56c6c;min-height:1em"></p>
            </form>
          </div>
        </div></div>`;
      const form = app.querySelector("[data-entry-login]");
      const msg = app.querySelector(".entry-login-msg");
      form.querySelector("input").focus();
      form.addEventListener("submit", async e => {
        e.preventDefault();
        const password = form.querySelector('input[name="password"]').value;
        const btn = form.querySelector("button");
        btn.disabled = true;
        msg.textContent = "";
        try {
          // path 用当前地址（秘密入口路径即凭证）
          const data = await api("/api/admin/login", { method: "POST", body: { password, path: location.pathname } });
          state.admin = true;
          if (data.admin_path) setAdminPath(data.admin_path);
          renderAdminArea();
          toast("已解锁");
          route();
        } catch (err) {
          msg.textContent = err.status === 429 ? err.message : err.status === 401 ? "密码错误" : err.message;
          btn.disabled = false;
        }
      });
      return;
    }
    const hour = new Date().getHours();
    const greet = hour < 6 ? "夜深了" : hour < 11 ? "早上好" : hour < 14 ? "中午好" : hour < 18 ? "下午好" : "晚上好";
    const dateStr = new Date().toLocaleDateString("zh-CN", { year: "numeric", month: "long", day: "numeric", weekday: "long" });
    if (!ADMIN_TABS.some(t => t.key === state.adminTab)) state.adminTab = "overview";
    const curTab = ADMIN_TABS.find(t => t.key === state.adminTab) || ADMIN_TABS[0];
    app.innerHTML = `
      <div class="admin-app">
        <div class="admin-side-mask" data-admin-side-toggle></div>
        <aside class="admin-side">
          <div class="admin-brand">
            <span class="admin-logo">${svgIcon("pen-nib", 20)}</span>
            <div class="admin-brand-name"><b>${esc(state.settings.site_title || "moments")}</b><small>管理后台</small></div>
          </div>
          <nav class="admin-nav">
            ${ADMIN_TABS.map(t => `
              <button class="admin-nav-item ${state.adminTab === t.key ? "is-active" : ""}" data-admin-tab="${t.key}">
                <span class="admin-nav-ico">${svgIcon(t.icon, 18)}</span>
                <span class="admin-nav-label">${t.label}</span>
              </button>`).join("")}
          </nav>
          <div class="admin-side-foot">
            <button class="btn ghost sm" data-nav="logout" title="退出登录">退出</button>
            <a class="admin-back-home" href="/" data-link>← 返回首页</a>
          </div>
        </aside>
        <main class="admin-main">
          <header class="admin-head">
            <div>
              <h2>${greet}，站长</h2>
              <span class="admin-head-date">${dateStr} · ${curTab.label}</span>
            </div>
            <div class="admin-head-actions">
              <button class="btn ghost sm admin-side-toggle" data-admin-side-toggle type="button">${svgIcon("menu", 16)} 菜单</button>
              <a class="btn ghost sm" href="/" data-link>查看网站</a>
            </div>
          </header>
          <div class="admin-panel" id="adminPanel">
            <div class="essay-loading"><span class="spinner"></span><span>加载中...</span></div>
          </div>
        </main>
      </div>`;
    loadAdminTab(state.adminTab);
    // 手机端：汉堡按钮 / 遮罩 开合抽屉；点导航项后自动收起；打开时锁背景滚动
    const appEl = app.querySelector(".admin-app");
    if (appEl) {
      const syncScroll = () => {
        document.body.style.overflow = appEl.classList.contains("is-open") ? "hidden" : "";
      };
      app.querySelectorAll("[data-admin-side-toggle]").forEach(el => {
        el.addEventListener("click", () => {
          appEl.classList.toggle("is-open");
          syncScroll();
        });
      });
      appEl.querySelectorAll(".admin-nav-item").forEach(item => {
        item.addEventListener("click", () => {
          appEl.classList.remove("is-open");
          syncScroll();
        });
      });
    }
  }

  function loadAdminTab(tab) {
    const panel = document.getElementById("adminPanel");
    if (!panel) return;
    if (tab === "overview") return renderAdminOverview(panel);
    if (tab === "moments") return renderAdminMoments(panel);
    if (tab === "posts") return renderAdminPosts(panel);
    if (tab === "photos") return renderAdminPhotos(panel);
    if (tab === "friends") return renderAdminFriends(panel);
    if (tab === "about") return renderAdminAbout(panel);
    if (tab === "comments") return renderAdminComments(panel);
    if (tab === "appearance") return renderAdminAppearance(panel);
    if (tab === "media") return renderAdminMedia(panel);
    if (tab === "ai") return renderAdminAI(panel);
    if (tab === "seo") return renderAdminSeo(panel);
    if (tab === "security") return renderAdminSecurity(panel);
  }

  /* ---------- 后台 Tab：概览仪表盘 ---------- */
  async function renderAdminOverview(panel) {
    let d;
    try { d = await api("/api/admin/overview"); } catch (e) { panel.innerHTML = `<p>概览加载失败：${esc(e.message)}</p>`; return; }
    const cards = [
      { label: "说说", icon: "message-circle", val: d.moments, tab: "moments" },
      { label: "文章", icon: "file-text", val: d.posts, tab: "posts" },
      { label: "评论", icon: "message-square", val: d.comments, tab: "comments" },
      { label: "相册", icon: "image", val: d.photos, tab: "photos" },
    ];
    // 近 7 天评论趋势 SVG 面积图
    const trend = d.trend || [];
    const max = Math.max(1, ...trend.map(t => t.count));
    const W = 640, H = 180, pad = 28;
    const n = trend.length;
    const x = i => pad + (i * (W - pad * 2)) / Math.max(1, n - 1);
    const y = v => H - pad - (v / max) * (H - pad * 2);
    const pts = trend.map((t, i) => `${x(i).toFixed(1)},${y(t.count).toFixed(1)}`);
    const linePts = pts.join(" ");
    const areaPts = `${pad},${H - pad} ${linePts} ${x(n - 1).toFixed(1)},${H - pad}`;
    const total = trend.reduce((s, t) => s + t.count, 0);
    panel.innerHTML = `
      <div class="ov-cards">
        ${cards.map(c => `
          <div class="ov-card" data-admin-tab="${c.tab}">
            <div class="ov-card-ico">${svgIcon(c.icon, 26)}</div>
            <div class="ov-card-num">${c.val}</div>
            <div class="ov-card-label">${c.label}</div>
          </div>`).join("")}
      </div>
      <div class="ov-chart-card">
        <div class="ov-chart-head">
          <h3>近 7 天评论</h3>
          <span class="ov-chart-sub">共 ${total} 条 · 峰值 ${max}</span>
        </div>
        <svg class="ov-chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img">
          <defs><linearGradient id="ovFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="var(--anzhiyu-main)" stop-opacity="0.28"/>
            <stop offset="100%" stop-color="var(--anzhiyu-main)" stop-opacity="0"/>
          </linearGradient></defs>
          ${[0.25, 0.5, 0.75].map(f => `<line x1="${pad}" y1="${(pad + (H - pad * 2) * f).toFixed(1)}" x2="${W - pad}" y2="${(pad + (H - pad * 2) * f).toFixed(1)}" stroke="var(--anzhiyu-card-border)" stroke-dasharray="4 5"/>`).join("")}
          <polygon points="${areaPts}" fill="url(#ovFill)"/>
          <polyline points="${linePts}" fill="none" stroke="var(--anzhiyu-main)" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>
          ${trend.map((t, i) => `<circle cx="${x(i).toFixed(1)}" cy="${y(t.count).toFixed(1)}" r="3.5" fill="var(--anzhiyu-card-bg)" stroke="var(--anzhiyu-main)" stroke-width="2"/>`).join("")}
        </svg>
        <div class="ov-chart-axis">${trend.map(t => `<span>${t.date.slice(5)}</span>`).join("")}</div>
      </div>
      <p class="ov-tip">提示：点击上方数字卡片可快速跳转到对应管理页。</p>`;
  }

  // 后台列表分页状态（跨重渲染保留）
  let adminMomPage = 1;
  const adminMomCursors = [null]; // adminMomCursors[page-1] = 该页起始游标
  let adminPostsPage = 1;
  let adminPhotosPage = 1;

  /** 后台列表多选 + 批量删除通用接线：rowSel 为行/卡片选择器，onDone 为删除成功后的重绘回调 */
  function wireBatch(panel, { rowSel, endpoint, label, onDone }) {
    const all = panel.querySelector("[data-batch-all]");
    const countEl = panel.querySelector("[data-batch-count]");
    const delBtn = panel.querySelector("[data-batch-del]");
    if (!all || !delBtn) return;
    const boxes = () => [...panel.querySelectorAll(`${rowSel} input.admin-check`)];
    const sync = () => {
      const bs = boxes();
      const checked = bs.filter(b => b.checked);
      if (countEl) countEl.textContent = checked.length;
      delBtn.disabled = checked.length === 0;
      all.checked = bs.length > 0 && checked.length === bs.length;
      all.indeterminate = checked.length > 0 && checked.length < bs.length;
    };
    all.addEventListener("change", () => {
      boxes().forEach(b => { b.checked = all.checked; });
      sync();
    });
    boxes().forEach(b => b.addEventListener("change", sync));
    delBtn.addEventListener("click", async () => {
      const ids = boxes().filter(b => b.checked).map(b => Number(b.value));
      if (!ids.length) return;
      if (!confirm(`确定删除选中的 ${ids.length} ${label}？此操作不可恢复`)) return;
      delBtn.disabled = true;
      const oldText = delBtn.textContent;
      delBtn.textContent = "删除中...";
      try {
        await api(endpoint, { method: "POST", body: { ids } });
        toast(`已删除 ${ids.length} ${label}`);
        onDone && onDone();
      } catch (err) {
        toast(err.message);
        delBtn.disabled = false;
        delBtn.textContent = oldText;
      }
    });
    sync();
  }

  async function renderAdminMoments(panel, page = adminMomPage) {
    adminMomPage = page;
    panel.innerHTML = `<div class="essay-loading"><span class="spinner"></span><span>加载中...</span></div>`;
    let list = [];
    let nextCursor = null;
    try {
      const cursor = adminMomCursors[page - 1];
      const data = await api(
        `/api/moments?limit=20&voter_id=${encodeURIComponent(state.voterId)}${cursor ? `&cursor=${cursor}` : ""}`
      );
      list = data.list;
      nextCursor = data.nextCursor ?? null;
    } catch (e) {
      panel.innerHTML = `<div class="essay-empty">${esc(e.message)}</div>`;
      return;
    }
    if (nextCursor != null && adminMomCursors[page] === undefined) adminMomCursors[page] = nextCursor;
    const hasMore = nextCursor != null;
    panel.innerHTML = `
      <div class="admin-panel-head">
        <h3>说说管理</h3>
        <button class="btn primary" data-admin-act="new-moment">＋ 发布说说</button>
      </div>
      <div class="admin-batch-bar">
        <label class="admin-batch-all"><input type="checkbox" data-batch-all /> 全选</label>
        <span class="admin-batch-info">已选 <strong data-batch-count>0</strong> 项</span>
        <button class="btn danger" data-batch-del disabled>批量删除</button>
      </div>
      ${
        list.length
          ? list
              .map(
                m => `
        <div class="admin-row">
          <label class="admin-check-cell"><input type="checkbox" class="admin-check" value="${m.id}" /></label>
          <div class="row-main">
            <div class="row-title">${esc(plainText(m.content, 80) || (m.video ? "[视频说说]" : "[图片说说]"))}</div>
            <div class="row-sub">
              <span>${timeAgo(m.created_at)}</span>
              ${m.images && m.images.length ? `<span class="tag-mini">图片×${m.images.length}</span>` : ""}
              ${m.video && m.video.src ? `<span class="tag-mini">${m.video.kind === "hls" ? "M3U8 视频" : "MP4 视频"}</span>` : ""}
              ${m.location ? `<span>${svgIcon("locationDot", 14)} ${esc(m.location)}</span>` : ""}
              <span>赞 ${m.like_count || 0}</span><span>评论 ${m.comment_count || 0}</span>
            </div>
          </div>
          <div class="row-actions">
            <button class="btn" data-admin-act="view-moment" data-id="${m.id}">查看</button>
            <button class="btn" data-admin-act="edit-moment" data-id="${m.id}">编辑</button>
            <button class="btn danger" data-admin-act="del-moment" data-id="${m.id}">删除</button>
          </div>
        </div>`
              )
              .join("")
          : `<div class="essay-empty">还没有说说，点右上角发布第一条</div>`
      }
      <div class="pager">
        <button type="button" class="btn" data-pager="prev"${page <= 1 ? " disabled" : ""}>上一页</button>
        <span class="pager-info">第 ${page} 页</span>
        <button type="button" class="btn" data-pager="next"${hasMore ? "" : " disabled"}>下一页</button>
      </div>`;
    panel.querySelectorAll("[data-pager]").forEach(b =>
      b.addEventListener("click", () => renderAdminMoments(panel, b.dataset.pager === "prev" ? page - 1 : page + 1))
    );
    wireBatch(panel, { rowSel: ".admin-row", endpoint: "/api/moments/batch-delete", label: "条说说", onDone: () => renderAdminMoments(panel) });
  }

  async function renderAdminPosts(panel, page = adminPostsPage) {
    adminPostsPage = page;
    panel.innerHTML = `<div class="essay-loading"><span class="spinner"></span><span>加载中...</span></div>`;
    let list = [];
    let total = 0;
    try {
      const data = await api(`/api/posts?page=${page}&per_page=20`);
      list = data.list;
      total = data.total ?? list.length;
    } catch (e) {
      panel.innerHTML = `<div class="essay-empty">${esc(e.message)}</div>`;
      return;
    }
    const pages = Math.max(1, Math.ceil(total / 20));
    if (!list.length && page > 1) return renderAdminPosts(panel, pages); // 原页被删空时自动回退
    panel.innerHTML = `
      <div class="admin-panel-head">
        <h3>文章管理（${total}）</h3>
        <button class="btn primary" data-admin-act="new-post">＋ 写文章</button>
      </div>
      <div class="admin-batch-bar">
        <label class="admin-batch-all"><input type="checkbox" data-batch-all /> 全选</label>
        <span class="admin-batch-info">已选 <strong data-batch-count>0</strong> 项</span>
        <button class="btn danger" data-batch-del disabled>批量删除</button>
      </div>
      ${
        list.length
          ? list
              .map(
                p => `
        <div class="admin-row">
          <label class="admin-check-cell"><input type="checkbox" class="admin-check" value="${p.id}" /></label>
          <div class="row-main">
            <div class="row-title">${esc(p.title)}${p.status === "draft" ? '<span class="tag-mini draft" style="margin-left:6px">草稿</span>' : ""}</div>
            <div class="row-sub"><span>${timeAgo(p.created_at)}</span><span>/${esc(p.slug)}</span></div>
          </div>
          <div class="row-actions">
            <a class="btn" href="/post/${encodeURIComponent(p.slug)}${p.status === "draft" ? "?preview=1" : ""}">查看</a>
            <button class="btn" data-admin-act="edit-post" data-slug="${esc(p.slug)}">编辑</button>
            <button class="btn danger" data-admin-act="del-post" data-id="${p.id}">删除</button>
          </div>
        </div>`
              )
              .join("")
          : `<div class="essay-empty">还没有文章</div>`
      }
      ${pagerHtml(page, pages)}`;
    panel.querySelectorAll("[data-pager]").forEach(b =>
      b.addEventListener("click", () => renderAdminPosts(panel, b.dataset.pager === "prev" ? page - 1 : page + 1))
    );
    wireBatch(panel, { rowSel: ".admin-row", endpoint: "/api/posts/batch-delete", label: "篇文章", onDone: () => renderAdminPosts(panel) });
  }

  async function renderAdminPhotos(panel, page = adminPhotosPage) {
    adminPhotosPage = page;
    panel.innerHTML = `<div class="essay-loading"><span class="spinner"></span><span>加载中...</span></div>`;
    let list = [];
    let total = 0;
    try {
      const data = await api(`/api/admin/photos?page=${page}&per_page=24`);
      list = data.list;
      total = data.total ?? list.length;
    } catch (e) {
      panel.innerHTML = `<div class="essay-empty">${esc(e.message)}</div>`;
      return;
    }
    const pages = Math.max(1, Math.ceil(total / 24));
    if (!list.length && page > 1) return renderAdminPhotos(panel, pages); // 原页被删空时自动回退
    const sourceLabel = t => (t === "moment" ? "说说" : t === "post" ? "文章" : "上传");
    panel.innerHTML = `
      <div class="admin-panel-head">
        <h3>相册管理（${total}）</h3>
        <div style="display:flex;gap:.5rem">
          <button class="btn" data-photo-act="sync">同步说说/文章图片</button>
          <button class="btn primary" data-photo-act="upload">上传图片</button>
        </div>
      </div>
      <div class="field-hint" style="margin-bottom:1rem">上传或同步的图片会出现在前台「相册」页；可设置标题、排序（升序）和是否显示。勾选图片可批量删除。</div>
      <div class="admin-batch-bar">
        <label class="admin-batch-all"><input type="checkbox" data-batch-all /> 全选</label>
        <span class="admin-batch-info">已选 <strong data-batch-count>0</strong> 项</span>
        <button class="btn danger" data-batch-del disabled>批量删除</button>
      </div>
      <input type="file" accept="image/*" data-photo-file hidden multiple />
      ${
        list.length
          ? `<div class="photo-admin-grid">${list
              .map(
                p => `
            <div class="photo-admin-card" data-id="${p.id}">
              <div class="photo-admin-thumb">
                <input type="checkbox" class="admin-check photo-admin-check" value="${p.id}" title="选中用于批量操作" />
                <img src="${esc(p.src)}" alt="" referrerpolicy="no-referrer" loading="lazy" />
                <span class="photo-admin-src-tag">${sourceLabel(p.source_type)}</span>
              </div>
              <div class="photo-admin-fields">
                <input type="text" class="photo-title-input" placeholder="标题（可选）" value="${esc(p.title)}" />
                <div class="photo-admin-row">
                  <label class="photo-check">
                    <input type="checkbox" class="photo-visible-input" ${p.visible ? "checked" : ""} />
                    <span>显示</span>
                  </label>
                  <input type="number" class="photo-sort-input" value="${p.sort_order}" style="width:70px" title="排序（升序）" />
                  <button class="btn photo-save-btn" data-photo-act="save">保存</button>
                  <button class="btn danger" data-photo-act="del">删除</button>
                </div>
              </div>
            </div>`
              )
              .join("")}</div>`
          : `<div class="essay-empty">还没有图片，点击「上传图片」或「同步说说/文章图片」</div>`
      }
      ${pagerHtml(page, pages)}`;

    panel.querySelectorAll("[data-pager]").forEach(b =>
      b.addEventListener("click", () => renderAdminPhotos(panel, b.dataset.pager === "prev" ? page - 1 : page + 1))
    );
    wireBatch(panel, { rowSel: ".photo-admin-card", endpoint: "/api/admin/photos/batch-delete", label: "张图片", onDone: () => renderAdminPhotos(panel) });
    panel.querySelector('[data-photo-act="sync"]').addEventListener("click", async e => {
      const btn = e.currentTarget;
      btn.disabled = true;
      btn.textContent = "同步中...";
      try {
        const r = await api("/api/admin/photos/sync", { method: "POST" });
        toast(`同步完成，新增 ${r.inserted} 张`);
        renderAdminPhotos(panel);
      } catch (err) {
        toast(err.message);
      } finally {
        btn.disabled = false;
        btn.textContent = "同步说说/文章图片";
      }
    });

    // 上传
    const fileInput = panel.querySelector("[data-photo-file]");
    panel.querySelector('[data-photo-act="upload"]').addEventListener("click", () => fileInput.click());
    fileInput.addEventListener("change", async () => {
      const files = [...fileInput.files];
      if (!files.length) return;
      for (const file of files) {
        try {
          // 走 uploadMedia：图片自动生成 _w1200.jpg 缩略图（与说说/文章一致），否则相册页 thumbSrc 404
          const data = await uploadMedia(file, "image");
          if (!data?.key) throw new Error("上传失败");
          // 存储 canonical /media/<key>，由后端 serializePhoto 根据 r2_domain 动态转换为 R2 直连或代理
          await api("/api/admin/photos", { method: "POST", body: { src: "/media/" + data.key, title: file.name.replace(/\.[^.]+$/, "") } });
        } catch (err) {
          toast(`${file.name}: ${err.message}`);
        }
      }
      toast("上传完成");
      fileInput.value = "";
      renderAdminPhotos(panel);
    });

    // 单张保存 / 删除
    panel.querySelectorAll(".photo-admin-card").forEach(card => {
      const id = Number(card.dataset.id);
      card.querySelector('[data-photo-act="save"]').addEventListener("click", async () => {
        const title = card.querySelector(".photo-title-input").value;
        const sort_order = Number(card.querySelector(".photo-sort-input").value) || 0;
        const visible = card.querySelector(".photo-visible-input").checked;
        try {
          await api(`/api/admin/photos/${id}`, { method: "PUT", body: { title, sort_order, visible } });
          toast("已保存");
        } catch (err) {
          toast(err.message);
        }
      });
      card.querySelector('[data-photo-act="del"]').addEventListener("click", async () => {
        if (!confirm("删除这张图片？")) return;
        try {
          await api(`/api/admin/photos/${id}`, { method: "DELETE" });
          card.remove();
          toast("已删除");
        } catch (err) {
          toast(err.message);
        }
      });
    });
  }

  /* ================= 后台：关于我页面 ================= */
  function renderAdminAbout(panel) {
    const s = state.settings;
    panel.innerHTML = `
      <h3>关于我页面</h3>
      <form class="settings-form" data-settings-form>
        <div class="field">
          <label for="about_enabled">启用「关于我」页面<br /><small style="color:var(--anzhiyu-secondtext)">开启后顶栏显示「关于」入口，访问 /about 可查看</small></label>
          <label class="admin-check-cell" style="justify-content:flex-start;gap:.5rem;margin-top:.35rem">
            <input type="checkbox" name="about_enabled" id="about_enabled" ${s.about_enabled ? "checked" : ""} />
            <span>启用关于我页面（/about）</span>
          </label>
        </div>
        <div class="field">
          <label>顶部问候大标题</label>
          <input name="about_greeting" maxlength="60" value="${esc(s.about_greeting)}" />
        </div>
        <div class="field">
          <label>问候标题下方小字</label>
          <input name="about_greeting_sub" maxlength="200" value="${esc(s.about_greeting_sub)}" />
        </div>
        <div class="field">
          <label>关于页大头像（可选）<br /><small style="color:var(--anzhiyu-secondtext)">图片 URL 或上传；留空则用说说作者头像</small></label>
          <div style="display:flex;gap:.5rem;align-items:center">
            <input name="about_avatar" maxlength="300" value="${esc(s.about_avatar)}" placeholder="https://...（留空=作者头像）" style="flex:1" />
            <button type="button" class="btn" data-avatar-upload="about_avatar">上传</button>
            <input type="file" accept="image/*" data-avatar-file="about_avatar" hidden />
          </div>
          <div class="field-hint" data-avatar-preview="about_avatar" style="margin-top:.4rem">${/^https?:\/\//i.test(s.about_avatar || "") ? `<img src="${esc(s.about_avatar)}" alt="" style="width:48px;height:48px;border-radius:50%;object-fit:cover" referrerpolicy="no-referrer" />` : ""}</div>
        </div>
        <div class="field">
          <label>一句话签名</label>
          <input name="about_signature" maxlength="200" value="${esc(s.about_signature)}" />
        </div>
        <div class="field">
          <label>自我介绍正文（Markdown）</label>
          <textarea name="about_bio" maxlength="5000" rows="6" placeholder="支持 Markdown 语法…">${esc(s.about_bio)}</textarea>
        </div>
        <div class="field">
          <label>「一些数字」小卡片（每行一条：名称|数值|说明）</label>
          <textarea name="about_stats" maxlength="1000" rows="4" placeholder="坚持记录|多年|从开始写到现在&#10;记录天数|持续|几乎每天都在更新">${esc(s.about_stats)}</textarea>
        </div>
        <div class="field">
          <label>时间线（每行一条：日期|标题|描述）</label>
          <textarea name="about_timeline" maxlength="2000" rows="4" placeholder="2021|开始写博客|用文字记录生活的第一个节点">${esc(s.about_timeline)}</textarea>
        </div>
        <div class="field">
          <label>底部大数字统计（每行一条：数字|标签）</label>
          <textarea name="about_bigstats" maxlength="500" rows="3" placeholder="6|年记录&#10;120+|篇文字">${esc(s.about_bigstats)}</textarea>
        </div>
        <div class="field">
          <label>联系方式（每行一条：类型|值|链接）<br /><small style="color:var(--anzhiyu-secondtext)">链接可空；类型自动匹配图标（GitHub/邮箱/RSS/QQ 等）</small></label>
          <textarea name="about_contacts" maxlength="1000" rows="4" placeholder="GitHub|孤鸿剑尊|https://github.com/xxx&#10;邮箱|a@b.com|mailto:a@b.com">${esc(s.about_contacts)}</textarea>
        </div>
        <div class="field">
          <label>赞助卡说明文字</label>
          <input name="about_qr_text" maxlength="300" value="${esc(s.about_qr_text)}" />
        </div>
        <div class="field">
          <label>赞助金额按钮组（点击切换二维码）<br /><small style="color:var(--anzhiyu-secondtext)">每行一条：金额|该金额的二维码图片URL。URL 可留空（留空则该按钮只高亮不切图）</small></label>
          <textarea name="about_qr_amounts" maxlength="1000" rows="4" placeholder="10元|https://.../10.png&#10;30元|https://.../30.png&#10;60元|https://.../60.png">${esc(s.about_qr_amounts)}</textarea>
        </div>

        <button class="btn primary" type="submit">保存设置</button>
      </form>`;

    // 关于页头像上传 + 预览
    const avBtn = panel.querySelector('[data-avatar-upload="about_avatar"]');
    if (avBtn) {
      const fileInp = panel.querySelector('[data-avatar-file="about_avatar"]');
      const urlInp = panel.querySelector('[name="about_avatar"]');
      const preview = panel.querySelector('[data-avatar-preview="about_avatar"]');
      avBtn.addEventListener("click", () => fileInp.click());
      fileInp.addEventListener("change", async () => {
        const file = fileInp.files[0];
        if (!file) return;
        avBtn.disabled = true;
        avBtn.textContent = "上传中...";
        try {
          const fd = new FormData();
          fd.append("file", file);
          fd.append("kind", "image");
          const res = await fetch("/api/admin/upload", { method: "POST", body: fd, credentials: "same-origin" });
          const json = await res.json();
          if (!res.ok || !json.data?.src) throw new Error(json.message || "上传失败");
          const full = /^https?:\/\//i.test(json.data.src) ? json.data.src : location.origin + json.data.src;
          urlInp.value = full;
          preview.innerHTML = `<img src="${esc(full)}" alt="" style="width:48px;height:48px;border-radius:50%;object-fit:cover" referrerpolicy="no-referrer" />`;
          toast("上传成功，记得点击保存设置");
        } catch (err) {
          toast(err.message);
        } finally {
          avBtn.disabled = false;
          avBtn.textContent = "上传";
          fileInp.value = "";
        }
      });
    }
  }

  /* ================= 后台：友链管理 ================= */
  async function renderAdminFriends(panel) {
    panel.innerHTML = `<h3>友链管理</h3><div class="field-hint">加载中…</div>`;
    let data;
    try {
      data = await api("/api/admin/friends");
    } catch (e) {
      panel.innerHTML = `<h3>友链管理</h3><div class="field-hint">${esc(e.message)}</div>`;
      return;
    }
    const list = data.list || [];
    const cats = String(state.settings.links_categories || "").split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    const catOpts = cats.map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join("");
    const statusText = { pending: "待审核", approved: "已上架", rejected: "已拒绝" };

    const rows = list.map(f => `
      <div class="friend-admin-row" data-id="${f.id}">
        <div class="friend-admin-main">
          ${friendAvatar(f.name, f.avatar)}
          <div class="friend-admin-info">
            <div class="friend-admin-name">
              ${esc(f.name)}
              ${f.category ? `<span class="links-card-cat">${esc(f.category)}</span>` : ""}
              <span class="friend-admin-status s-${f.status}">${statusText[f.status] || f.status}</span>
            </div>
            <a class="friend-admin-url" href="${esc(f.url)}" target="_blank" rel="noopener">${esc(f.url)}</a>
            <div class="friend-admin-desc">${esc(f.description || "—")}</div>
          </div>
        </div>
        <div class="friend-admin-actions">
          ${f.status === "pending" ? `<button class="btn sm" data-act="approve">通过</button><button class="btn sm ghost" data-act="reject">拒绝</button>` : ""}
          <button class="btn sm ghost" data-act="edit">编辑</button>
          <button class="btn sm danger" data-act="del">删除</button>
        </div>
      </div>`).join("");

    panel.innerHTML = `
      <h3>友链管理（${list.length}）${data.pending_count ? ` <span class="friend-pending-badge">${data.pending_count} 条待审核</span>` : ""}</h3>
      <div class="field-hint" style="margin-bottom:1rem">访客在 /links/apply 提交的申请会进入「待审核」，通过后自动上架到 /links。也可在此直接新增友站。</div>

      <form class="settings-form" data-settings-form style="border:1px solid var(--anzhiyu-card-border,#e3e8ef);border-radius:10px;padding:.9rem 1rem;background:var(--anzhiyu-card-bg,#fafbfc);margin-bottom:1rem">
        <div class="field">
          <label>友链分类（每行一个）<br /><small style="color:var(--anzhiyu-secondtext)">列表页会自动加「全部」；此处可增删改，新增/编辑友站时分类下拉同步更新</small></label>
          <textarea name="links_categories" maxlength="500" rows="4" placeholder="技术&#10;设计&#10;生活随笔&#10;摄影">${esc(state.settings.links_categories)}</textarea>
        </div>
        <button class="btn primary" type="submit">保存分类</button>
      </form>

      <details class="friend-add-box" ${list.length === 0 ? "open" : ""}>
        <summary><b>＋ 新增友站</b></summary>
        <form id="friendAddForm" class="friend-form">
          <div class="friend-form-grid">
            <div class="field"><label>站点名称 *</label><input name="name" maxlength="60" required /></div>
            <div class="field">
              <label>站点地址 *</label>
              <div style="display:flex;gap:.5rem">
                <input name="url" placeholder="https://example.com" required style="flex:1" />
                <button type="button" class="btn" id="friendFetchBtn">自动获取</button>
              </div>
            </div>
            <div class="field"><label>站点简介</label><input name="description" maxlength="300" /></div>
            <div class="field"><label>图标 URL（可选）</label><input name="avatar" maxlength="500" placeholder="留空自动取对方 favicon" /></div>
            <div class="field"><label>分类</label><select name="category"><option value="">未分类</option>${catOpts}</select></div>
            <div class="field"><label>排序（升序）</label><input name="sort_order" type="number" value="0" /></div>
          </div>
          <button class="btn primary" type="submit">添加</button>
        </form>
      </details>

      <div class="friend-admin-list">${rows || '<div class="field-hint">暂无友站</div>'}</div>
    `;

    // 新增
    const addForm = panel.querySelector("#friendAddForm");
    const fetchBtn = panel.querySelector("#friendFetchBtn");
    if (fetchBtn) {
      fetchBtn.addEventListener("click", async () => {
        const url = addForm.querySelector('[name="url"]').value.trim();
        if (!url) { toast("请先填写站点地址"); return; }
        fetchBtn.disabled = true; fetchBtn.textContent = "获取中…";
        try {
          const info = await api(`/api/friends/info?url=${encodeURIComponent(url)}`);
          if (info.name) addForm.querySelector('[name="name"]').value = info.name;
          if (info.description) addForm.querySelector('[name="description"]').value = info.description;
          if (!addForm.querySelector('[name="avatar"]').value && info.avatar) addForm.querySelector('[name="avatar"]').value = info.avatar;
          if (info.url) addForm.querySelector('[name="url"]').value = info.url;
          toast("已自动获取，可再微调");
        } catch (err) { toast(err.message || "获取失败，请手动填写"); }
        finally { fetchBtn.disabled = false; fetchBtn.textContent = "自动获取"; }
      });
    }
    if (addForm) {
      addForm.addEventListener("submit", async e => {
        e.preventDefault();
        const fd = new FormData(addForm);
        const btn = addForm.querySelector('button[type="submit"]');
        btn.disabled = true;
        try {
          await api("/api/admin/friends", { method: "POST", body: Object.fromEntries(fd) });
          toast("已添加");
          renderAdminFriends(panel);
        } catch (err) { toast(err.message); }
        finally { btn.disabled = false; }
      });
    }

    // 列表操作
    panel.querySelectorAll(".friend-admin-row").forEach(row => {
      const id = row.dataset.id;
      const act = (sel) => row.querySelector(`[data-act="${sel}"]`);
      const a = act("approve"); if (a) a.addEventListener("click", async () => { await api(`/api/admin/friends/${id}/approve`, { method: "POST" }); toast("已通过"); renderAdminFriends(panel); });
      const rj = act("reject"); if (rj) rj.addEventListener("click", async () => { await api(`/api/admin/friends/${id}/reject`, { method: "POST" }); toast("已拒绝"); renderAdminFriends(panel); });
      const dl = act("del"); if (dl) dl.addEventListener("click", async () => { if (!confirm("确定删除该友站？")) return; await api(`/api/admin/friends/${id}`, { method: "DELETE" }); toast("已删除"); renderAdminFriends(panel); });
      const ed = act("edit"); if (ed) ed.addEventListener("click", () => openFriendEditor(panel, id, list.find(x => String(x.id) === id), cats));
    });
  }

  /** 编辑友站：内联替换该行内容为表单 */
  function openFriendEditor(panel, id, f, cats) {
    if (!f) return;
    const row = panel.querySelector(`.friend-admin-row[data-id="${id}"]`);
    if (!row) return;
    const catOpts = ['<option value="">未分类</option>', ...cats.map(c => `<option value="${esc(c)}"${c === f.category ? " selected" : ""}>${esc(c)}</option>`)].join("");
    row.innerHTML = `
      <form class="friend-form friend-edit-form" style="width:100%">
        <div class="friend-form-grid">
          <div class="field"><label>名称</label><input name="name" maxlength="60" value="${esc(f.name)}" required /></div>
          <div class="field"><label>地址</label><input name="url" value="${esc(f.url)}" required /></div>
          <div class="field"><label>简介</label><input name="description" maxlength="300" value="${esc(f.description)}" /></div>
          <div class="field"><label>图标 URL</label><input name="avatar" maxlength="500" value="${esc(f.avatar)}" /></div>
          <div class="field"><label>分类</label><select name="category">${catOpts}</select></div>
          <div class="field"><label>排序</label><input name="sort_order" type="number" value="${f.sort_order ?? 0}" /></div>
        </div>
        <div style="display:flex;gap:.5rem">
          <button class="btn primary sm" type="submit">保存</button>
          <button class="btn ghost sm" type="button" data-act="cancel">取消</button>
        </div>
      </form>`;
    row.querySelector('[data-act="cancel"]').addEventListener("click", () => renderAdminFriends(panel));
    row.querySelector(".friend-edit-form").addEventListener("submit", async e => {
      e.preventDefault();
      const fd = new FormData(e.target);
      try {
        await api(`/api/admin/friends/${id}`, { method: "PUT", body: Object.fromEntries(fd) });
        toast("已保存");
        renderAdminFriends(panel);
      } catch (err) { toast(err.message); }
    });
  }

  async function renderAdminComments(panel) {
    panel.innerHTML = `<div class="essay-loading"><span class="spinner"></span><span>加载中...</span></div>`;
    let list = [];
    try {
      list = (await api("/api/admin/comments?limit=200")).list;
    } catch (e) {
      panel.innerHTML = `<div class="essay-empty">${esc(e.message)}</div>`;
      return;
    }
    panel.innerHTML = `
      <div class="admin-panel-head"><h3>评论管理（${list.length}）</h3></div>
      ${
        list.length
          ? `<div class="admin-batch-bar">
        <label class="admin-batch-all"><input type="checkbox" data-batch-all /> 全选</label>
        <span class="admin-batch-info">已选 <strong data-batch-count>0</strong> 项</span>
        <button class="btn danger" data-batch-del disabled>批量删除</button>
      </div>` +
            list
              .map(
                c => `
        <div class="admin-row">
          <div class="admin-check-cell"><input type="checkbox" class="admin-check" value="${c.id}" /></div>
          <div class="row-main">
            <div class="row-title">
              ${c.is_ai ? '<span class="tag-mini tag-ai">AI</span>' : c.is_owner ? '<span class="tag-mini">博主</span>' : ""}<strong>${esc(c.nickname)}</strong>：${esc(c.content)}
            </div>
            <div class="row-sub">
              <span>${timeAgo(c.created_at)}</span>
              <span class="tag-mini">${c.target_type === "post" ? "文章" : "说说"}</span>
              <span>${c.target_type === "post" ? "所属文章" : "所属说说"}：${esc(c.target_excerpt || "#" + c.target_id)}</span>
            </div>
          </div>
          <div class="row-actions">
            <button class="btn" data-admin-act="edit-comment" data-cid="${c.id}" data-content="${esc(c.content.replace(/"/g, "&quot;"))}">编辑</button>
            <button class="btn danger" data-admin-act="del-comment" data-cid="${c.id}">删除</button>
          </div>
        </div>`
              )
              .join("")
          : `<div class="essay-empty">还没有评论</div>`
      }`;
    if (list.length) {
      wireBatch(panel, { rowSel: ".admin-row", endpoint: "/api/admin/comments/batch-delete", label: "条评论", onDone: () => renderAdminComments(panel) });
    }
  }

  /** 后台：音乐播放器设置面板 */
  /* ---------- 后台 Tab：外观 ---------- */
  async function renderAdminAppearance(panel) {
    panel.innerHTML = `<div class="essay-loading"><span class="spinner"></span><span>加载中...</span></div>`;
    let s;
    try {
      s = await api("/api/admin/settings");
    } catch (e) {
      panel.innerHTML = `<div class="essay-empty">${esc(e.message)}</div>`;
      return;
    }
    panel.innerHTML = `
      <div class="admin-panel-head"><h3>站点外观</h3></div>
      <form class="settings-form" data-settings-form>
        <div class="field">
          <label>站点名称（顶栏品牌 / 浏览器标题）</label>
          <input name="site_title" maxlength="40" value="${esc(s.site_title)}" required />
        </div>
        <div class="field">
          <label>首页导航文字</label>
          <input name="nav_feeds_name" maxlength="12" value="${esc(s.nav_feeds_name)}" required />
        </div>
        <div class="field">
          <label>首页每页条数（1-50）<br /><small style="color:var(--anzhiyu-secondtext)">首页时间线每次加载的数量，超出后向下滚动分页加载；越小越省流量和服务器请求</small></label>
          <input name="feed_page_size" type="number" min="1" max="50" value="${esc(s.feed_page_size)}" required />
        </div>
        <div class="field">
          <label>顶栏品牌头像<br /><small style="color:var(--anzhiyu-secondtext)">仅图片 URL，或点击"上传"选择本地图片；留空显示默认笔尖图标</small></label>
          <div style="display:flex;gap:.5rem;align-items:center">
            <input name="brand_avatar" maxlength="200" value="${esc(s.brand_avatar)}" placeholder="https://...（留空=默认图标）" style="flex:1" />
            <button type="button" class="btn" data-avatar-upload="brand_avatar">上传</button>
            <input type="file" accept="image/*" data-avatar-file="brand_avatar" hidden />
          </div>
          <div class="field-hint" data-avatar-preview="brand_avatar" style="margin-top:.4rem">${/^https?:\/\//i.test(s.brand_avatar || "") ? `<img src="${esc(s.brand_avatar)}" alt="" style="width:48px;height:48px;border-radius:50%;object-fit:cover" referrerpolicy="no-referrer" />` : ""}</div>
        </div>
        <div class="field">
          <label>站点图标（favicon）<br /><small style="color:var(--anzhiyu-secondtext)">仅图片 URL，或点"上传"选本地图片；留空=默认笔尖图标</small></label>
          <div style="display:flex;gap:.5rem;align-items:center">
            <input name="site_icon" maxlength="300" value="${esc(s.site_icon)}" placeholder="https://...（留空=默认图标）" style="flex:1" />
            <button type="button" class="btn" data-avatar-upload="site_icon">上传</button>
            <input type="file" accept="image/*" data-avatar-file="site_icon" hidden />
          </div>
          <div class="field-hint" data-avatar-preview="site_icon" style="margin-top:.4rem">${/^https?:\/\//i.test(s.site_icon || "") ? `<img src="${esc(s.site_icon)}" alt="" style="width:48px;height:48px;object-fit:cover" referrerpolicy="no-referrer" />` : ""}</div>
        </div>
        <div class="field">
          <label>说说作者昵称<br /><small style="color:var(--anzhiyu-secondtext)">卡片左上角昵称；未设置作者头像时，头像显示昵称首字符</small></label>
          <input name="author_name" maxlength="32" value="${esc(s.author_name)}" />
        </div>
        <div class="field">
          <label>说说作者头像（可选）<br /><small style="color:var(--anzhiyu-secondtext)">图片 URL 或本地"上传"；留空则用昵称首字符</small></label>
          <div style="display:flex;gap:.5rem;align-items:center">
            <input name="author_avatar" maxlength="200" value="${esc(s.author_avatar)}" placeholder="https://...（留空=昵称首字符）" style="flex:1" />
            <button type="button" class="btn" data-avatar-upload="author_avatar">上传</button>
            <input type="file" accept="image/*" data-avatar-file="author_avatar" hidden />
          </div>
          <div class="field-hint" data-avatar-preview="author_avatar" style="margin-top:.4rem">${/^https?:\/\//i.test(s.author_avatar || "") ? `<img src="${esc(s.author_avatar)}" alt="" style="width:48px;height:48px;border-radius:50%;object-fit:cover" referrerpolicy="no-referrer" />` : ""}</div>
        </div>
        <div class="field">
          <label>文章卡片头像<br /><small style="color:var(--anzhiyu-secondtext)">仅图片 URL，或点击"上传"选择本地图片；留空显示默认文档图标</small></label>
          <div style="display:flex;gap:.5rem;align-items:center">
            <input name="post_avatar" maxlength="200" value="${esc(s.post_avatar)}" placeholder="https://...（留空=默认图标）" style="flex:1" />
            <button type="button" class="btn" data-avatar-upload="post_avatar">上传</button>
            <input type="file" accept="image/*" data-avatar-file="post_avatar" hidden />
          </div>
          <div class="field-hint" data-avatar-preview="post_avatar" style="margin-top:.4rem">${/^https?:\/\//i.test(s.post_avatar || "") ? `<img src="${esc(s.post_avatar)}" alt="" style="width:48px;height:48px;border-radius:50%;object-fit:cover" referrerpolicy="no-referrer" />` : ""}</div>
        </div>
        <div class="field">
          <label>自定义导航项（可选，每行一条：名称|链接，最多 6 条）<br /><small style="color:var(--anzhiyu-secondtext)">显示在顶栏"即刻"之后、"后台"之前，新标签打开</small></label>
          <textarea name="nav_links" maxlength="1000" rows="3" placeholder="友链|https://example.com&#10;相册|https://example.com/photos">${esc(s.nav_links)}</textarea>
        </div>

        <div class="admin-panel-head" style="margin-top:1.75rem"><h3>横幅</h3></div>
        <div class="field">
          <label>小标签</label>
          <input name="essay_tips" maxlength="60" value="${esc(s.essay_tips)}" />
        </div>
        <div class="field">
          <label>大标题</label>
          <input name="essay_title" maxlength="40" value="${esc(s.essay_title)}" required />
        </div>
        <div class="field">
          <label>描述</label>
          <input name="essay_subtitle" maxlength="200" value="${esc(s.essay_subtitle)}" />
        </div>
        <div class="field">
          <label>发布按钮文字</label>
          <input name="essay_button_text" maxlength="20" value="${esc(s.essay_button_text)}" />
        </div>
        <div class="field">
          <label>按钮链接（可选）<br /><small style="color:var(--anzhiyu-secondtext)">填写 http(s) 链接后，横幅按钮改为点击跳转该链接；留空则保持默认发布/解锁行为</small></label>
          <input name="banner_button_url" maxlength="500" value="${esc(s.banner_button_url)}" placeholder="https://example.com" />
        </div>
        <div class="field">
          <label>外链打开方式<br /><small style="color:var(--anzhiyu-secondtext)">仅对 http(s) 外链生效；站内路径始终在当前标签内切换</small></label>
          <select name="banner_button_target" style="max-width:220px">
            <option value="_blank"${s.banner_button_target !== "_self" ? " selected" : ""}>新标签打开</option>
            <option value="_self"${s.banner_button_target === "_self" ? " selected" : ""}>当前标签打开</option>
          </select>
        </div>
        <div class="field">
          <label>背景图（可选）<br /><small style="color:var(--anzhiyu-secondtext)">直接填图片 URL，或点击"上传"选择本地图片（存入 R2）</small></label>
          <div style="display:flex;gap:.5rem;align-items:center">
            <input name="banner_bg_image" maxlength="500" value="${esc(s.banner_bg_image)}" placeholder="https://... 或留空使用默认渐变" style="flex:1" />
            <button type="button" class="btn" data-banner-upload>上传</button>
            <input type="file" accept="image/*" data-banner-file hidden />
          </div>
          <div class="field-hint" data-banner-preview style="margin-top:.4rem">${s.banner_bg_image ? `<img src="${esc(s.banner_bg_image)}" alt="" style="max-width:100%;max-height:120px;border-radius:8px;object-fit:cover" referrerpolicy="no-referrer" />` : ""}</div>
        </div>

        <div class="admin-panel-head" style="margin-top:1.75rem"><h3>页脚</h3></div>
        <div class="field">
          <label>页脚文案（可选，支持 HTML）<br /><small style="color:var(--anzhiyu-secondtext)">例如：© 2024 Jxe · 轻博客 · Powered by Moments</small></label>
          <textarea name="footer_text" maxlength="2000" rows="3" placeholder="© 2024 My Site. All rights reserved.">${esc(s.footer_text)}</textarea>
        </div>
        <div class="field">
          <label>网站运行起始时间（可选）<br /><small style="color:var(--anzhiyu-secondtext)">填写后页脚显示「网站已运行 X 天 HH:MM:SS」，支持 ISO 时间（如 2024-01-01T00:00:00）或 yyyy-mm-dd</small></label>
          <input name="footer_run_since" maxlength="40" value="${esc(s.footer_run_since)}" placeholder="2024-01-01T00:00:00" />
        </div>

        <details class="admin-fold" style="margin-top:1.25rem">
          <summary class="admin-fold-summary">评论头像设置</summary>
          <div class="admin-fold-body">
        <div class="field">
          <label>随机头像 API（回退源）<br /><small style="color:var(--anzhiyu-secondtext)">评论者无 QQ / Gravatar 时，从这里随机取头像。每行一条，按序自动故障转移；支持 {imgtype} 占位。留空=用默认 apihz</small></label>
          <textarea name="random_avatar_api" rows="3" style="width:100%;resize:vertical" placeholder="https://cn.apihz.cn/api/img/apihzimgtx.php?id=88888888&amp;key=88888888&amp;type=1&amp;imgtype={imgtype}">${esc(s.random_avatar_api)}</textarea>
        </div>
        <div class="field">
          <label>随机头像类型<br /><small style="color:var(--anzhiyu-secondtext)">无 QQ / Gravatar 时随机头像的风格；默认 9=古风</small></label>
          <select name="random_avatar_imgtype" style="max-width:220px">
            ${[["0","综合"],["1","男生"],["2","女生"],["3","情侣"],["4","闺蜜"],["5","动漫"],["6","萌宠"],["7","可爱"],["8","欧美"],["9","古风"],["10","沙雕"],["11","仙女"],["12","简单"],["13","QQ"],["14","微信"],["15","文字"],["16","个性"]].map(([v,t])=>`<option value="${v}"${String(s.random_avatar_imgtype)===v?" selected":""}>${v} · ${t}</option>`).join("")}
          </select>
        </div>
        <div class="field" style="border:1px solid var(--anzhiyu-card-border,#e3e8ef);border-radius:10px;padding:.9rem 1rem;background:var(--anzhiyu-card-bg,#fafbfc)">
          <label style="font-weight:600">刷新头像缓存</label>
          <div style="color:var(--anzhiyu-secondtext);font-size:.82rem;margin:.25rem 0 .6rem">扫描历史评论里的邮箱，把缺失的头像补拉到本地（已缓存的默认跳过）。</div>
          <label style="display:flex;align-items:center;gap:.45rem;font-weight:normal;margin-bottom:.5rem;cursor:pointer">
            <input type="checkbox" data-refresh-avatars-force />
            <span>强制覆盖已缓存头像（较慢，随机头像会重新抽取）</span>
          </label>
          <div style="display:flex;align-items:center;gap:.6rem;flex-wrap:wrap">
            <button type="button" class="btn" data-refresh-avatars>开始刷新</button>
            <span data-refresh-avatars-msg style="color:var(--anzhiyu-secondtext);font-size:.85rem"></span>
          </div>
        </div>
          </div>
        </details>

        <details class="admin-fold">
          <summary class="admin-fold-summary">QQ 昵称资料（apihz）</summary>
          <div class="admin-fold-body">
        <div class="field" style="border:1px solid var(--anzhiyu-card-border,#e3e8ef);border-radius:10px;padding:.9rem 1rem;background:var(--anzhiyu-card-bg,#fafbfc)">
          <div style="color:var(--anzhiyu-secondtext);font-size:.82rem;margin:.25rem 0 .6rem">评论者填 QQ 号时，用这组凭证查昵称。凭证仅存服务端，绝不下发前台。</div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:.5rem">
            <div><label style="font-size:.78rem;color:var(--anzhiyu-secondtext)">apihz 开发者 ID</label><input name="apihz_id" value="${esc(s.apihz_id)}" placeholder="个人资料里的数字 ID" /></div>
            <div><label style="font-size:.78rem;color:var(--anzhiyu-secondtext)">apihz 开发者 KEY</label><input name="apihz_key" value="${esc(s.apihz_key)}" placeholder="通讯秘钥" /></div>
            <div><label style="font-size:.78rem;color:var(--anzhiyu-secondtext)">系统 QQ（ckqq）</label><input name="qq_ckqq" value="${esc(s.qq_ckqq)}" placeholder="你的 QQ 号" /></div>
            <div><label style="font-size:.78rem;color:var(--anzhiyu-secondtext)">skey</label><input name="qq_skey" value="${esc(s.qq_skey)}" placeholder="cookie 里的 skey" /></div>
          </div>
          <div style="margin-top:.4rem"><label style="font-size:.78rem;color:var(--anzhiyu-secondtext)">pskey（p_skey）</label><input name="qq_pskey" value="${esc(s.qq_pskey)}" placeholder="cookie 里的 p_skey" style="width:100%" /></div>
          <div style="display:flex;align-items:center;gap:.6rem;flex-wrap:wrap;margin-top:.6rem">
            <a data-qq-bookmarklet class="btn" href="#" style="text-decoration:none">拖拽到书签栏：一键抓取</a>
            <button type="button" class="btn" data-qq-test>测试连接</button>
            <span data-qq-test-msg style="color:var(--anzhiyu-secondtext);font-size:.85rem"></span>
          </div>
          <details style="margin-top:.6rem">
            <summary style="cursor:pointer;font-size:.82rem;color:var(--anzhiyu-secondtext)">没有书签栏？手动粘贴 Cookie 自动解析</summary>
            <textarea data-qq-paste rows="2" placeholder="登录 vip.qq.com 后，F12 把整段 Cookie 粘到这里" style="width:100%;margin-top:.4rem;resize:vertical"></textarea>
            <button type="button" class="btn" data-qq-parse style="margin-top:.35rem">解析并填入</button>
          </details>
        </div>
          </div>
        </details>

        <div class="admin-panel-head" style="margin-top:1.75rem"><h3>导航入口开关</h3></div>
        <div class="field">
          <label class="admin-check-cell" style="justify-content:flex-start;gap:.5rem;margin-top:.35rem">
            <input type="checkbox" name="links_enabled" ${s.links_enabled ? "checked" : ""} />
            <span>显示「友链」入口（/links）</span>
          </label>
          <label class="admin-check-cell" style="justify-content:flex-start;gap:.5rem;margin-top:.35rem">
            <input type="checkbox" name="photos_enabled" ${s.photos_enabled ? "checked" : ""} />
            <span>显示「相册」入口（/photos）</span>
          </label>
          <small style="color:var(--anzhiyu-secondtext)">「关于我」入口开关在「关于我」Tab。三个入口可独立开关，关闭后顶栏与移动端菜单均不显示。</small>
        </div>

        
        <button class="btn primary" type="submit">保存设置</button>
      </form>`;

    // 横幅背景图上传
    const uploadBtn = panel.querySelector("[data-banner-upload]");
    if (uploadBtn) {
      const fileInput = panel.querySelector("[data-banner-file]");
      const urlInput = panel.querySelector('[name="banner_bg_image"]');
      const preview = panel.querySelector("[data-banner-preview]");
      uploadBtn.addEventListener("click", () => fileInput.click());
      fileInput.addEventListener("change", async () => {
        const file = fileInput.files[0];
        if (!file) return;
        uploadBtn.disabled = true;
        uploadBtn.textContent = "上传中...";
        try {
          const fd = new FormData();
          fd.append("file", file);
          fd.append("kind", "image");
          const res = await fetch("/api/admin/upload", { method: "POST", body: fd, credentials: "same-origin" });
          const json = await res.json();
          if (!res.ok || !json.data?.src) throw new Error(json.message || "上传失败");
          const full = /^https?:\/\//i.test(json.data.src) ? json.data.src : location.origin + json.data.src;
          urlInput.value = full;
          preview.innerHTML = `<img src="${esc(full)}" alt="" style="max-width:100%;max-height:120px;border-radius:8px;object-fit:cover" referrerpolicy="no-referrer" />`;
          toast("上传成功，记得点击保存设置");
        } catch (err) {
          toast(err.message);
        } finally {
          uploadBtn.disabled = false;
          uploadBtn.textContent = "上传";
          fileInput.value = "";
        }
      });
    }

    // 头像类字段上传 + URL 实时预览
    const avatarPreviewHtml = url =>
      `<img src="${esc(url)}" alt="" style="width:48px;height:48px;border-radius:50%;object-fit:cover" referrerpolicy="no-referrer" />`;
    ["brand_avatar", "author_avatar", "post_avatar", "site_icon", "about_avatar"].forEach(field => {
      const btn = panel.querySelector(`[data-avatar-upload="${field}"]`);
      if (!btn) return;
      const fileInp = panel.querySelector(`[data-avatar-file="${field}"]`);
      const urlInp = panel.querySelector(`[name="${field}"]`);
      const preview = panel.querySelector(`[data-avatar-preview="${field}"]`);
      btn.addEventListener("click", () => fileInp.click());
      fileInp.addEventListener("change", async () => {
        const file = fileInp.files[0];
        if (!file) return;
        btn.disabled = true;
        btn.textContent = "上传中...";
        try {
          const fd = new FormData();
          fd.append("file", file);
          fd.append("kind", "image");
          const res = await fetch("/api/admin/upload", { method: "POST", body: fd, credentials: "same-origin" });
          const json = await res.json();
          if (!res.ok || !json.data?.src) throw new Error(json.message || "上传失败");
          const full = /^https?:\/\//i.test(json.data.src) ? json.data.src : location.origin + json.data.src;
          urlInp.value = full;
          preview.innerHTML = avatarPreviewHtml(full);
          toast("上传成功，记得点击保存设置");
        } catch (err) {
          toast(err.message);
        } finally {
          btn.disabled = false;
          btn.textContent = "上传";
          fileInp.value = "";
        }
      });
      urlInp.addEventListener("input", () => {
        preview.innerHTML = /^https?:\/\//i.test(urlInp.value.trim()) ? avatarPreviewHtml(urlInp.value.trim()) : "";
      });
    });

    // 刷新评论头像缓存：分页批处理，每批 ≤100，循环跑到结束，避免单请求超时/超子请求上限
    const refreshBtn = panel.querySelector("[data-refresh-avatars]");
    if (refreshBtn) {
      const msg = panel.querySelector("[data-refresh-avatars-msg]");
      const forceBox = panel.querySelector("[data-refresh-avatars-force]");
      refreshBtn.addEventListener("click", async () => {
        refreshBtn.disabled = true;
        let offset = 0;
        let total = 0, ok = 0, fail = 0;
        const force = forceBox && forceBox.checked ? "1" : "0";
        try {
          for (;;) {
            if (msg) msg.textContent = `刷新中…已处理 ${total}`;
            const r = await api(`/api/admin/avatars/refresh?offset=${offset}&force=${force}`, { method: "POST" });
            total += r.count || 0;
            ok += r.refreshed || 0;
            fail += r.failed || 0;
            if (!r.hasMore) break;
            offset += r.count || 100;
          }
          if (msg) msg.textContent = `完成：共 ${total} 个，成功 ${ok}${fail ? `，失败 ${fail}` : ""}`;
        } catch (e) {
          if (msg) msg.textContent = `中断于 ${total}：${e.message}`;
        } finally {
          refreshBtn.disabled = false;
        }
      });
    }

    // QQ 资料：书签一键抓取 / 粘贴 Cookie 解析 / 测试连接
    const bmLink = panel.querySelector("[data-qq-bookmarklet]");
    if (bmLink) {
      const bm = "javascript:(function(){try{var c=document.cookie.split('; '),g=function(k){for(var i=0;i<c.length;i++){var p=c[i].indexOf('=');if(c[i].slice(0,p)===k)return decodeURIComponent(c[i].slice(p+1));}return ''};var u=g('p_uin').replace(/^o0*/,'');var t='QQCK#'+new URLSearchParams({ckqq:u,skey:g('skey'),pskey:g('p_skey')}).toString();navigator.clipboard.writeText(t).then(function(){alert('已复制 QQ 登录态（QQ:'+(u||'未取到')+'），回到后台粘贴即可')}).catch(function(){prompt('复制失败，请手动复制：',t)})}catch(e){alert('请先在 vip.qq.com 登录后，再点本书签')}})();";
      bmLink.setAttribute("href", bm);
      bmLink.addEventListener("click", e => e.preventDefault());
    }
    const qqFormVals = () => ({
      apihz_id: panel.querySelector('[name="apihz_id"]')?.value || "",
      apihz_key: panel.querySelector('[name="apihz_key"]')?.value || "",
      qq_ckqq: panel.querySelector('[name="qq_ckqq"]')?.value || "",
      qq_skey: panel.querySelector('[name="qq_skey"]')?.value || "",
      qq_pskey: panel.querySelector('[name="qq_pskey"]')?.value || "",
    });
    const parseBtn = panel.querySelector("[data-qq-parse]");
    if (parseBtn) {
      parseBtn.addEventListener("click", () => {
        const text = (panel.querySelector("[data-qq-paste]")?.value || "").trim();
        if (!text) { toast("先粘贴 Cookie"); return; }
        const out = { ckqq: "", skey: "", pskey: "" };
        const m = text.match(/QQCK#([\s\S]*)/);
        if (m) {
          try { const p = new URLSearchParams(m[1]); out.ckqq = p.get("ckqq") || ""; out.skey = p.get("skey") || ""; out.pskey = p.get("pskey") || ""; } catch {}
        } else {
          const g = k => { const mm = text.match(new RegExp("(?:^|[;\\s])" + k + "=([^;\\s]+)")); return mm ? decodeURIComponent(mm[1]) : ""; };
          out.ckqq = g("p_uin").replace(/^o0*/, "");
          out.skey = g("skey");
          out.pskey = g("p_skey");
        }
        if (!out.ckqq && !out.skey && !out.pskey) { toast("没解析到 p_uin/skey/p_skey，确认是 vip.qq.com 的 Cookie"); return; }
        if (out.ckqq) panel.querySelector('[name="qq_ckqq"]').value = out.ckqq;
        if (out.skey) panel.querySelector('[name="qq_skey"]').value = out.skey;
        if (out.pskey) panel.querySelector('[name="qq_pskey"]').value = out.pskey;
        toast(`已填入 ckqq=${out.ckqq || "?"}，记得点「保存设置」`);
      });
    }
    const testBtn = panel.querySelector("[data-qq-test]");
    if (testBtn) {
      const tmsg = panel.querySelector("[data-qq-test-msg]");
      testBtn.addEventListener("click", async () => {
        testBtn.disabled = true;
        if (tmsg) tmsg.style.color = "" , tmsg.textContent = "测试中…";
        try {
          const r = await api("/api/admin/qq/test", { method: "POST", body: qqFormVals() });
          if (tmsg) { tmsg.style.color = r.ok ? "#23b26d" : "#f56c6c"; tmsg.textContent = r.ok ? `✓ ${r.msg}（昵称：${r.nickname}）` : `✗ ${r.msg}`; }
        } catch (e) {
          if (tmsg) { tmsg.style.color = "#f56c6c"; tmsg.textContent = "✗ " + e.message; }
        } finally {
          testBtn.disabled = false;
        }
      });
    }
  }

  /* ---------- 后台 Tab：媒体 ---------- */
  async function renderAdminMedia(panel) {
    panel.innerHTML = `<div class="essay-loading"><span class="spinner"></span><span>加载中...</span></div>`;
    let s;
    try {
      s = await api("/api/admin/settings");
    } catch (e) {
      panel.innerHTML = `<div class="essay-empty">${esc(e.message)}</div>`;
      return;
    }
    const vol = Math.max(0, Math.min(1, Number(s.music_volume) || 0.7));
    panel.innerHTML = `
      <div class="admin-panel-head"><h3>域名与存储</h3></div>
      <form class="settings-form" data-settings-form>
        <div class="field">
          <label>站点域名（可选）<br /><small style="color:var(--anzhiyu-secondtext)">带 https://，如 https://e.jxe.me。用于 SEO/RSS/OG 标签生成绝对 URL；留空则使用当前访问域名。换域名时填新域名即可，无需改代码</small></label>
          <input name="site_domain" maxlength="200" value="${esc(s.site_domain)}" placeholder="https://e.jxe.me（留空=自动）" />
        </div>
        <div class="field">
          <label>R2 媒体域名（可选）<br /><small style="color:var(--anzhiyu-secondtext)">R2 桶绑定的自定义域名，带 https://，如 https://r2.e.jxe.me。填写后图片/视频直连 R2，不经过 Worker（节省 Worker 请求额度）；留空则走 /media/ 代理</small></label>
          <input name="r2_domain" maxlength="200" value="${esc(s.r2_domain)}" placeholder="https://r2.e.jxe.me（留空=走 /media/ 代理）" />
        </div>
        <div class="field">
          <label>视频默认封面（可选）<br /><small style="color:var(--anzhiyu-secondtext)">说说和文章中的视频未单独设置封面时统一使用此图；可填图片 URL 或上传本地图片（建议 16:9 JPG）。留空则无封面视频显示播放器默认底色</small></label>
          <div style="display:flex;gap:.5rem;align-items:center">
            <input name="video_default_poster" maxlength="500" value="${esc(s.video_default_poster)}" placeholder="https://... 或 /media/...（留空不启用）" style="flex:1" />
            <button type="button" class="btn" data-video-poster-upload>上传</button>
            <input type="file" accept="image/*" data-video-poster-file hidden />
          </div>
          <div class="field-hint" data-video-poster-preview style="margin-top:.4rem">${s.video_default_poster ? `<img src="${esc(s.video_default_poster)}" alt="" style="max-width:100%;max-height:120px;border-radius:8px;object-fit:cover" referrerpolicy="no-referrer" />` : ""}</div>
        </div>
        <button class="btn primary" type="submit">保存设置</button>
      </form>

      <div class="admin-panel-head" style="margin-top:1.75rem"><h3>缩略图维护</h3></div>
      <div class="settings-form" style="max-width:680px">
        <div class="field">
          <label><small style="color:var(--anzhiyu-secondtext)">遍历全站图片，为历史图/小图/相册直传图补生成 _w1200 缩略图（缺失的图片会裂图或回退加载原图，拖慢首页）。图片多时耗时较长，建议低峰期执行一次</small></label>
          <div style="display:flex;gap:.75rem;align-items:center">
            <button type="button" class="btn" data-rebuild-thumbs>重建历史缩略图</button>
            <span data-rebuild-thumbs-msg style="font-size:.8rem;color:var(--anzhiyu-secondtext)"></span>
          </div>
        </div>
      </div>

      <div class="admin-panel-head" style="margin-top:1.75rem"><h3>音乐播放器</h3></div>
      <form class="settings-form" data-music-settings-form style="max-width:680px">
        <div class="field field-row">
          <label for="m_enable">启用底部音乐播放器</label>
          <label class="toggle">
            <input type="checkbox" name="music_enable" id="m_enable" ${s.music_enable ? "checked" : ""} />
            <span></span>
          </label>
        </div>
        <div class="field field-row">
          <label for="m_autoplay">打开网页自动播放<br /><small style="color:var(--anzhiyu-secondtext)">浏览器可能拦截有声自动播放，被拦截时自动回退为手动播放</small></label>
          <label class="toggle">
            <input type="checkbox" name="music_autoplay" id="m_autoplay" ${s.music_autoplay ? "checked" : ""} />
            <span></span>
          </label>
        </div>
        <div class="field field-row">
          <label for="m_preload">预加载第一首歌<br /><small style="color:var(--anzhiyu-secondtext)">页面打开后提前解析音源，点击播放按钮立即出声（推荐开启）</small></label>
          <label class="toggle">
            <input type="checkbox" name="music_preload" id="m_preload" ${s.music_preload ? "checked" : ""} />
            <span></span>
          </label>
        </div>
        <div class="field field-row">
          <label for="m_collapsed">初始折叠成球形<br /><small style="color:var(--anzhiyu-secondtext)">打开网页时播放器收起为悬浮球，点击展开</small></label>
          <label class="toggle">
            <input type="checkbox" name="music_collapsed" id="m_collapsed" ${s.music_collapsed ? "checked" : ""} />
            <span></span>
          </label>
        </div>
        <div class="field">
          <label for="m_volume">初始音量：<output data-vol-out>${Math.round(vol * 100)}%</output></label>
          <input type="range" name="music_volume" id="m_volume" min="0" max="1" step="0.05" value="${vol}" data-vol-range style="width:100%" />
        </div>
        <div class="field">
          <label>网易云歌单 ID（纯数字，如 8152976493）</label>
          <input name="music_playlist_id" maxlength="32" value="${esc(s.music_playlist_id)}" placeholder="8152976493" />
        </div>
        <div class="field">
          <label>自定义歌单 JSON 链接（可选，优先级高于网易云歌单）</label>
          <input name="music_custom_playlist" maxlength="500" value="${esc(s.music_custom_playlist)}" placeholder="https://.../playlist.json" />
          <div class="field-hint">JSON 格式：<code>[{"name":"歌名","artist":"歌手","url":"音频直链","cover":"封面URL"}]</code></div>
        </div>
        <button class="btn primary" type="submit">保存音乐设置</button>
      </form>`;

    // 视频默认封面上传
    const vpUploadBtn = panel.querySelector("[data-video-poster-upload]");
    if (vpUploadBtn) {
      const vpFileInput = panel.querySelector("[data-video-poster-file]");
      const vpUrlInput = panel.querySelector('[name="video_default_poster"]');
      const vpPreview = panel.querySelector("[data-video-poster-preview]");
      vpUploadBtn.addEventListener("click", () => vpFileInput.click());
      vpFileInput.addEventListener("change", async () => {
        const file = vpFileInput.files[0];
        if (!file) return;
        vpUploadBtn.disabled = true;
        vpUploadBtn.textContent = "上传中...";
        try {
          const fd = new FormData();
          fd.append("file", file);
          fd.append("kind", "image");
          const res = await fetch("/api/admin/upload", { method: "POST", body: fd, credentials: "same-origin" });
          const json = await res.json();
          if (!res.ok || !json.data?.src) throw new Error(json.message || "上传失败");
          const full = /^https?:\/\//i.test(json.data.src) ? json.data.src : location.origin + json.data.src;
          vpUrlInput.value = full;
          vpPreview.innerHTML = `<img src="${esc(full)}" alt="" style="max-width:100%;max-height:120px;border-radius:8px;object-fit:cover" referrerpolicy="no-referrer" />`;
          toast("上传成功，记得点击保存设置");
        } catch (err) {
          toast(err.message);
        } finally {
          vpUploadBtn.disabled = false;
          vpUploadBtn.textContent = "上传";
          vpFileInput.value = "";
        }
      });
    }

    // 音量滑块实时显示
    const range = panel.querySelector("[data-vol-range]");
    const out = panel.querySelector("[data-vol-out]");
    if (range && out) {
      range.addEventListener("input", () => {
        out.textContent = Math.round(Number(range.value) * 100) + "%";
      });
    }
  }

  /* ---------- 后台 Tab：AI 助手 ---------- */
  async function renderAdminAI(panel) {
    panel.innerHTML = `<div class="essay-loading"><span class="spinner"></span><span>加载中...</span></div>`;
    let s;
    try {
      s = await api("/api/admin/settings");
    } catch (e) {
      panel.innerHTML = `<div class="essay-empty">${esc(e.message)}</div>`;
      return;
    }
    panel.innerHTML = `
      <div class="admin-panel-head"><h3>评论 @AI 机器人</h3></div>
      <form class="settings-form" data-ai-settings-form style="max-width:680px">
        <div class="field field-row">
          <label for="ai_reply_enabled">启用评论 @AI 机器人<br /><small style="color:var(--anzhiyu-secondtext)">访客在说说/文章评论中 @机器人昵称 时，由 Cloudflare Workers AI 自动生成回复（消耗每日免费额度），回复以楼中楼形式出现</small></label>
          <label class="toggle">
            <input type="checkbox" name="ai_reply_enabled" id="ai_reply_enabled" ${s.ai_reply_enabled ? "checked" : ""} />
            <span></span>
          </label>
        </div>
        <div class="field">
          <label>机器人昵称<br /><small style="color:var(--anzhiyu-secondtext)">评论中 @此昵称 触发回复，建议 2-6 个字符（如 小J、阿沐）</small></label>
          <input name="ai_bot_name" maxlength="20" value="${esc(s.ai_bot_name)}" placeholder="小J" />
        </div>
        <div class="field">
          <label>机器人头像<br /><small style="color:var(--anzhiyu-secondtext)">仅图片 URL；留空显示默认机器人图标</small></label>
          <input name="ai_bot_avatar" maxlength="200" value="${esc(s.ai_bot_avatar)}" placeholder="https://...（留空=默认图标）" />
        </div>
        <div class="field">
          <label>文本模型 ID（高级，可选）<br /><small style="color:var(--anzhiyu-secondtext)">默认使用 Cloudflare 托管免费模型 Qwen3（失败自动回退 Llama 3.2）；如确认其他 @cf/* 模型可用可在此覆盖</small></label>
          <input name="ai_text_model" maxlength="100" value="${esc(s.ai_text_model)}" placeholder="@cf/qwen/qwen3-30b-a3b-fp8（留空=默认）" />
        </div>
        <button class="btn primary" type="submit">保存 AI 设置</button>
      </form>

      <div class="admin-panel-head" style="margin-top:1.75rem"><h3>QQ 昵称 API</h3></div>
      <form class="settings-form" data-qq-api-form style="max-width:680px">
        <div class="field">
          <label>API 列表（每行一条，从上到下依次尝试，获取到昵称即停止）<br /><small style="color:var(--anzhiyu-secondtext)">格式：<code>URL|解析方式</code> 或 <code>URL|密钥|解析方式</code>，URL 中用 <code>{qq}</code> 占位 QQ 号<br />解析方式：<code>auto</code>（通用自动提取）、<code>uapis</code>、<code>uomg</code>、<code>guiguiya</code><br />留空=使用内置默认列表（主源 uapis + 备用 uomg + guiguiya）</small></label>
          <textarea name="qq_nick_apis" maxlength="2000" rows="6" placeholder="https://api.example.com/qq?qq={qq}|auto&#10;https://api.example2.com/qq?qq={qq}|your-key|auto" style="font-family:monospace;font-size:.82rem">${esc(s.qq_nick_apis)}</textarea>
        </div>
        <button class="btn primary" type="submit">保存 QQ API</button>
      </form>`;
  }

  /* ---------- 后台 Tab：搜索收录 ---------- */
  async function renderAdminSeo(panel) {
    setSeo({ title: `搜索收录 · ${state.settings.site_title}`, path: location.pathname, noindex: true });
    const origin = location.origin.replace(/\/$/, "");
    const site = (state.settings.site_domain || origin).replace(/^https?:\/\//, "").replace(/\/.*$/, "");
    const enc = encodeURIComponent(site);
    const items = [
      { label: "站点地图 sitemap.xml", url: `${origin}/sitemap.xml`, tip: "提交给搜索引擎，列出所有可收录页面" },
      { label: "爬虫规则 robots.txt", url: `${origin}/robots.txt`, tip: "声明允许/禁止抓取的路径与 sitemap 位置" },
      { label: "RSS 订阅 rss.xml", url: `${origin}/rss.xml`, tip: "文章更新源，也可用于订阅与部分平台抓取" },
    ];
    panel.innerHTML = `
      <div class="admin-panel-head"><h3>搜索收录</h3></div>
      <p style="color:var(--anzhiyu-secondtext);font-size:.82rem;margin:-.4rem 0 1rem">把本站地址提交到各搜索引擎站长平台，加快收录。先复制下方 sitemap 地址，再点对应平台按钮去提交。</p>

      <div style="display:flex;flex-direction:column;gap:.7rem;margin-bottom:1.4rem">
        ${items.map(it => `
          <div style="display:flex;align-items:center;gap:.7rem;background:var(--anzhiyu-card-bg);border:var(--style-border);border-radius:12px;padding:.75rem 1rem">
            <div style="flex:1;min-width:0">
              <div style="font-weight:600;font-size:.9rem">${esc(it.label)}</div>
              <div style="font-size:.78rem;color:var(--anzhiyu-secondtext);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(it.url)}</div>
              <div style="font-size:.72rem;color:var(--anzhiyu-secondtext);opacity:.8">${esc(it.tip)}</div>
            </div>
            <button class="btn sm ghost" data-copy="${esc(it.url)}">复制</button>
            <a class="btn sm ghost" href="${esc(it.url)}" target="_blank" rel="noopener">打开</a>
          </div>`).join("")}
      </div>

      <div style="font-weight:700;font-size:.92rem;margin:1.2rem 0 .7rem">站长平台快捷入口</div>
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:.8rem">
        <a class="btn" href="https://ziyuan.baidu.com/linksubmit/index" target="_blank" rel="noopener" style="justify-content:center">百度搜索资源平台</a>
        <a class="btn" href="https://www.bing.com/webmasters?siteUrl=${enc}" target="_blank" rel="noopener" style="justify-content:center">Bing Webmaster</a>
        <a class="btn" href="https://search.google.com/search-console?resource_id=${encodeURIComponent("sc-domain:" + site)}" target="_blank" rel="noopener" style="justify-content:center">Google Search Console</a>
        <a class="btn ghost" href="https://www.bing.com/indexnow" target="_blank" rel="noopener" style="justify-content:center">了解 IndexNow 自动推送</a>
      </div>
      <p style="color:var(--anzhiyu-secondtext);margin-top:1rem;font-size:.78rem">提示：各平台需先验证站点归属（按平台指引添加 TXT 或上传文件），验证后即可提交 sitemap 并查看收录情况。</p>`;
    panel.querySelectorAll("[data-copy]").forEach(btn => btn.addEventListener("click", async () => {
      try { await navigator.clipboard.writeText(btn.dataset.copy); toast("已复制：" + btn.dataset.copy); }
      catch { toast("复制失败，请手动复制", 1); }
    }));
  }

  /* ---------- 后台 Tab：安全 ---------- */
  async function renderAdminSecurity(panel) {
    panel.innerHTML = `<div class="essay-loading"><span class="spinner"></span><span>加载中...</span></div>`;
    let s;
    try {
      s = await api("/api/admin/settings");
    } catch (e) {
      panel.innerHTML = `<div class="essay-empty">${esc(e.message)}</div>`;
      return;
    }
    panel.innerHTML = `
      <div class="admin-panel-head"><h3>后台入口路径</h3></div>
      <form class="settings-form" data-adminpath-form style="max-width:560px">
        <div class="field">
          <label>后台入口路径<br />
            <small style="color:var(--anzhiyu-secondtext)">修改后旧地址 /admin 立即失效（访客访问显示 404），请牢记新地址，建议收藏。格式：/ 开头 + 3~39 位字母数字或短横线，如 /my-secret</small>
          </label>
          <div style="display:flex;gap:8px">
            <input name="admin_path" maxlength="40" value="${esc(s.admin_path || "/admin")}" pattern="/admin|/[A-Za-z0-9][A-Za-z0-9-]{2,38}" required style="flex:1;font-family:monospace" />
            <button type="button" class="btn" data-gen-path style="white-space:nowrap">随机生成</button>
          </div>
          <div class="field-hint" style="margin-top:.5rem;color:#e6a23c">
            ${svgIcon("triangle-alert", 14)} 修改后浏览器地址会立即跳转到新入口；连续输错 5 次密码将锁定 15 分钟。
          </div>
          <div data-adminpath-msg style="margin-top:.4rem;font-size:.85rem"></div>
        </div>
        <button class="btn primary" type="submit">更新入口路径</button>
      </form>

      <div class="admin-panel-head" style="margin-top:1.75rem"><h3>修改管理密码</h3></div>
      <form class="settings-form" data-password-form style="max-width:420px">
        <div class="field">
          <label>当前密码</label>
          <input type="password" name="old_password" autocomplete="current-password" required />
        </div>
        <div class="field">
          <label>新密码（6-128 位）</label>
          <input type="password" name="new_password" autocomplete="new-password" minlength="6" maxlength="128" required />
        </div>
        <div class="field">
          <label>确认新密码</label>
          <input type="password" name="confirm_password" autocomplete="new-password" minlength="6" maxlength="128" required />
        </div>
        <button class="btn primary" type="submit">修改密码</button>
        <div class="field-hint" style="margin-top:.5rem">修改后立即生效，无需重新部署；其他已登录设备需要用新密码重新解锁。</div>
      </form>`;
  }

  /* ================= 音乐播放器 ================= */

  const MUSIC_CACHE_KEY = "moments-playlist-cache";
  const MUSIC_CACHE_TTL = 7 * 24 * 60 * 60 * 1000; // 7 天

  const musicEl = document.getElementById("musicPlayer");
  const audio = document.getElementById("musicAudio");
  const musicCapsule = document.getElementById("musicCapsule");
  const musicCover = document.getElementById("musicCover");
  const musicTitle = document.getElementById("musicTitle");
  const musicArtist = document.getElementById("musicArtist");
  const musicPlayBtn = document.getElementById("musicPlayBtn");
  const musicProgressBar = document.getElementById("musicProgressBar");
  const musicProgress = document.getElementById("musicProgress");
  const musicVolume = document.getElementById("musicVolume");
  const musicPlaylist = document.getElementById("musicPlaylist");
  const musicPlaylistList = document.getElementById("musicPlaylistList");
  const musicLyric = document.getElementById("musicLyric");
  const musicCoverOverlay = document.getElementById("musicCoverOverlay");

  // 歌词状态
  const lyricState = { lines: [], currentIndex: -1, songId: "" };

  audio.volume = state.music.volume;

  function showMusicPlayer(show) {
    musicEl.hidden = !show;
    document.body.classList.toggle("music-visible", show);
  }

  function setMusicPlayIcon(kind) {
    musicPlayBtn.querySelector(".icon-play").style.display = kind === "play" ? "" : "none";
    musicPlayBtn.querySelector(".icon-pause").style.display = kind === "pause" ? "" : "none";
    musicPlayBtn.querySelector(".icon-loading").style.display = kind === "loading" ? "" : "none";
  }

  function renderMusicPlaylist() {
    if (!state.music.playlist.length) {
      musicPlaylistList.innerHTML = `<div class="music-playlist-item" style="justify-content:center;color:var(--anzhiyu-secondtext)">歌单为空</div>`;
      return;
    }
    musicPlaylistList.innerHTML = state.music.playlist
      .map(
        (s, i) => `
      <div class="music-playlist-item ${i === state.music.currentIndex ? "active" : ""} ${i === state.music.currentIndex && state.music.isPlaying ? "playing" : ""}" data-music-idx="${i}">
        <span class="idx">${i === state.music.currentIndex ? "▶" : i + 1}</span>
        <div class="info">
          <div class="name">${esc(s.name)}</div>
          <div class="artist">${esc(s.artist)}</div>
        </div>
        <span class="playing-ind"><span></span><span></span><span></span></span>
      </div>`
      )
      .join("");
  }

  function toggleMusicPlaylist() {
    const hidden = musicPlaylist.hidden;
    musicPlaylist.hidden = !hidden;
    if (hidden) renderMusicPlaylist();
  }

  /** 从缓存或后端获取歌单 */
  async function fetchMusicPlaylist() {
    const playlistId = state.settings.music_playlist_id;
    const customUrl = state.settings.music_custom_playlist;
    const cacheKey = `${MUSIC_CACHE_KEY}:${playlistId}:${customUrl}`;

    // 读缓存
    try {
      const cached = JSON.parse(localStorage.getItem(cacheKey) || "null");
      if (cached && Date.now() - cached.ts < MUSIC_CACHE_TTL && Array.isArray(cached.songs) && cached.songs.length) {
        return cached.songs;
      }
    } catch {
      /* ignore */
    }

    // 自定义 JSON 歌单
    if (customUrl && customUrl.trim()) {
      try {
        const res = await fetch(customUrl);
        if (res.ok) {
          const data = await res.json();
          if (Array.isArray(data)) {
            const songs = data.map((it, i) => ({
              id: String(it.id || `custom-${i}`),
              name: it.name || it.title || `歌曲 ${i + 1}`,
              artist: it.artist || "未知歌手",
              url: it.url || "",
              pic: it.cover || it.pic || "",
              lrc: it.lrc || "",
            }));
            localStorage.setItem(cacheKey, JSON.stringify({ ts: Date.now(), songs }));
            return songs;
          }
        }
      } catch {
        // 降级到网易云
      }
    }

    // 网易云歌单
    try {
      const data = await api(`/api/music/163/playlist?id=${encodeURIComponent(playlistId)}`);
      const songs = (data.songs || []).map(s => ({
        id: String(s.id),
        name: s.name || "未知歌曲",
        artist: s.artist || "未知歌手",
        pic: s.pic ? ensureHttps(s.pic) : "",
        url: "",
        lrc: "",
      }));
      if (songs.length) {
        localStorage.setItem(cacheKey, JSON.stringify({ ts: Date.now(), songs }));
      }
      return songs;
    } catch (e) {
      console.error("[music] 歌单获取失败", e);
      return [];
    }
  }

  function ensureHttps(url) {
    if (!url) return url;
    if (url.startsWith("http://")) return url.replace("http://", "https://");
    return url;
  }

  /** 把网易云封面 URL 转成 Worker 代理地址，绕过防盗链 */
  function proxyCover(url) {
    if (!url) return url;
    if (/\.music\.126\.net\//.test(url)) {
      return `/api/music/163/cover?url=${encodeURIComponent(url)}`;
    }
    return ensureHttps(url);
  }

  /** 设置封面：空 pic 清空 src，加载失败时由 error 事件兜底显示占位图
   *  目标 URL 与当前相同则跳过赋值，避免重复请求/中止进行中的加载 */
  function setCover(pic) {
    musicCover.removeAttribute("data-fallback");
    if (pic) {
      const next = proxyCover(pic);
      if (musicCover.getAttribute("src") === next) return;
      musicCover.src = next;
    } else {
      musicCover.removeAttribute("src");
    }
  }

  /** 加载并播放指定索引的歌曲
   *  - 修复封面：空 pic 不设 src，避免请求当前页 URL
   *  - 修复卡住：连续 3 首无音源停止自动跳转
   *  - 加载歌词：网易云 ID 走 /api/music/163/lyric 代理
   */
  let consecutiveFailCount = 0;
  async function loadAndPlay(index) {
    if (index < 0 || index >= state.music.playlist.length) return;
    const song = state.music.playlist[index];
    // 同一首歌的音源已由预加载缓冲好：直接播放，
    // 不重复解析、不重赋 audio.src（避免进行中的 stream 请求被中止 net::ERR_ABORTED）
    if (
      song &&
      String(audio.dataset.songId || "") === String(song.id) &&
      audio.src &&
      audio.readyState >= 2
    ) {
      state.music.currentIndex = index;
      musicTitle.textContent = song.name;
      musicArtist.textContent = song.artist;
      setCover(song.pic);
      try {
        await audio.play();
        markPlaying();
      } catch (_) {
        state.music.isPlaying = false;
        setMusicPlayIcon("play");
        updateCoverOverlay();
        renderMusicPlaylist();
      }
      return;
    }
    preloadToken++; // 作废进行中的预加载，防止迟到的预加载覆盖新音源
    state.music.currentIndex = index;

    musicTitle.textContent = song.name;
    musicArtist.textContent = song.artist;
    setCover(song.pic);
    setMusicPlayIcon("loading");
    state.music.isLoading = true;
    renderMusicPlaylist();
    loadLyric(song); // 异步加载歌词，不阻塞播放

    try {
      // 解析播放地址（网易云 ID）
      let audioUrl = song.url || "";
      if (!audioUrl && /^\d+$/.test(song.id)) {
        try {
          const res = await api(`/api/music/163?id=${song.id}`);
          audioUrl = res.url || "";
          // 仅在歌单未带封面时采用解析结果的封面：
          // 同一张图网易云可能返回 p1/p2 不同 CDN 域名，无条件覆盖会导致
          // 进行中的 cover 请求被中止（net::ERR_ABORTED）
          if (res.cover && !song.pic) {
            song.pic = ensureHttps(res.cover);
            setCover(song.pic);
          }
        } catch {
          // 解析失败，可能 VIP 歌曲
        }
      }

      if (!audioUrl) {
        consecutiveFailCount++;
        if (consecutiveFailCount >= 3) {
          consecutiveFailCount = 0;
          state.music.isLoading = false;
          setMusicPlayIcon("play");
          toast("连续多首歌曲无可用音源，已停止播放");
          return;
        }
        toast(`「${song.name}」暂无可用音源，自动下一首`);
        nextSong();
        return;
      }
      consecutiveFailCount = 0; // 拿到音源，重置计数

      audio.src = audioUrl;
      audio.dataset.songId = String(song.id);
      audio.play().then(() => {
        state.music.isPlaying = true;
        state.music.isLoading = false;
        musicCapsule.classList.add("playing");
        setMusicPlayIcon("pause");
        updateCoverOverlay();
        renderMusicPlaylist();
      }).catch(err => {
        console.warn("[music] 自动播放被阻止", err);
        state.music.isPlaying = false;
        state.music.isLoading = false;
        setMusicPlayIcon("play");
        updateCoverOverlay();
        renderMusicPlaylist();
      });
    } catch (e) {
      console.error("[music] 加载歌曲失败", e);
      state.music.isLoading = false;
      setMusicPlayIcon("play");
      toast("歌曲加载失败");
    }
  }

  /** LRC 解析：返回 [{time: 秒, text: 歌词}] 按时间升序 */
  function parseLrc(lrcStr) {
    if (!lrcStr) return [];
    const lines = lrcStr.split(/\r?\n/);
    const out = [];
    const tagRe = /\[(\d{1,2}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g;
    for (const raw of lines) {
      const text = raw.replace(tagRe, "").trim();
      if (!text) continue;
      tagRe.lastIndex = 0;
      let m;
      while ((m = tagRe.exec(raw)) !== null) {
        const mm = Number(m[1]);
        const ss = Number(m[2]);
        const ff = m[3] ? Number(m[3]) : 0;
        const ms = m[3] && m[3].length === 3 ? ff : ff * 10; // 三位是毫秒，两位是百分秒
        const time = mm * 60 + ss + ms / 1000;
        out.push({ time, text });
      }
    }
    out.sort((a, b) => a.time - b.time);
    return out;
  }

  /** 加载歌词：网易云 ID 走后端代理；自定义歌单直接用 song.lrc */
  async function loadLyric(song) {
    lyricState.lines = [];
    lyricState.currentIndex = -1;
    lyricState.songId = String(song.id);
    let lrcStr = song.lrc || "";
    if (!lrcStr && /^\d+$/.test(song.id)) {
      try {
        const res = await api(`/api/music/163/lyric?id=${encodeURIComponent(song.id)}`);
        lrcStr = res.lyric || "";
        if (lrcStr) song.lrc = lrcStr; // 缓存到 song 对象，避免重复请求
      } catch {
        // 歌词获取失败不影响播放
      }
    }
    lyricState.lines = parseLrc(lrcStr);
    renderLyric();
  }

  /** 渲染歌词面板 */
  function renderLyric() {
    if (!musicLyric) return;
    if (!lyricState.lines.length) {
      musicLyric.innerHTML = `<div class="music-lyric-empty">暂无歌词</div>`;
      return;
    }
    musicLyric.innerHTML = lyricState.lines
      .map((l, i) => `<div class="music-lyric-line" data-lyric-idx="${i}">${esc(l.text)}</div>`)
      .join("");
  }

  /** 时间更新时高亮当前歌词并滚动 */
  function updateLyricIndex() {
    if (!lyricState.lines.length || !musicLyric) return;
    const t = audio.currentTime;
    let idx = -1;
    for (let i = 0; i < lyricState.lines.length; i++) {
      if (lyricState.lines[i].time <= t) idx = i;
      else break;
    }
    if (idx === lyricState.currentIndex) return;
    lyricState.currentIndex = idx;
    musicLyric.querySelectorAll(".music-lyric-line").forEach(el => {
      el.classList.toggle("active", Number(el.dataset.lyricIdx) === idx);
    });
    const active = musicLyric.querySelector(".music-lyric-line.active");
    if (active) {
      // 滚动到中心
      const top = active.offsetTop - musicLyric.clientHeight / 2 + active.clientHeight / 2;
      musicLyric.scrollTo({ top, behavior: "smooth" });
    }
  }

  /** 切换歌词面板显示 */
  function toggleMusicLyric() {
    if (!musicLyric) return;
    musicLyric.hidden = !musicLyric.hidden;
  }

  function togglePlay() {
    if (!state.music.playlist.length) return;
    if (state.music.currentIndex < 0) {
      loadAndPlay(0);
      return;
    }
    // 刷新后 audio.src 未加载：需先 loadAndPlay 获取音源
    if (!audio.src || audio.dataset.songId !== String(state.music.playlist[state.music.currentIndex].id)) {
      loadAndPlay(state.music.currentIndex);
      return;
    }
    if (audio.paused) {
      audio.play().then(() => {
        state.music.isPlaying = true;
        musicCapsule.classList.add("playing");
        setMusicPlayIcon("pause");
        updateCoverOverlay();
        renderMusicPlaylist();
      }).catch(() => {});
    } else {
      audio.pause();
      state.music.isPlaying = false;
      musicCapsule.classList.remove("playing");
      setMusicPlayIcon("play");
      updateCoverOverlay();
      renderMusicPlaylist();
    }
  }

  const PLAY_MODE_LABEL = { list: "列表循环", random: "随机播放", one: "单曲循环" };

  /** 选下一曲索引：随机模式排除当前曲，列表/单曲循环（手动切歌）走相邻曲 */
  function pickNextIndex(dir) {
    const len = state.music.playlist.length;
    if (len <= 1) return state.music.currentIndex;
    if (state.music.playMode === "random") {
      let idx = state.music.currentIndex;
      while (idx === state.music.currentIndex) idx = Math.floor(Math.random() * len);
      return idx;
    }
    return (state.music.currentIndex + dir + len) % len;
  }

  function nextSong() {
    if (!state.music.playlist.length) return;
    loadAndPlay(pickNextIndex(1));
  }

  function prevSong() {
    if (!state.music.playlist.length) return;
    loadAndPlay(pickNextIndex(-1));
  }

  /** 播放模式按钮：应用模式对应的图标/高亮/提示 */
  function applyPlayModeBtn() {
    const btn = musicCapsule.querySelector("[data-music-mode]");
    if (!btn) return;
    btn.classList.toggle("mode-list", state.music.playMode === "list");
    btn.classList.toggle("mode-random", state.music.playMode === "random");
    btn.classList.toggle("mode-one", state.music.playMode === "one");
    // 非列表循环模式常亮提示
    btn.classList.toggle("on", state.music.playMode !== "list");
    btn.title = `播放模式：${PLAY_MODE_LABEL[state.music.playMode]}（点击切换）`;
  }

  /** 循环切换播放模式：列表循环 → 随机播放 → 单曲循环（localStorage 持久化） */
  function cyclePlayMode() {
    const order = ["list", "random", "one"];
    const next = order[(order.indexOf(state.music.playMode) + 1) % order.length];
    state.music.playMode = next;
    localStorage.setItem("moments_playmode", next);
    applyPlayModeBtn();
    toast(`播放模式：${PLAY_MODE_LABEL[next]}`);
  }

  function setMusicVolume(v) {
    v = Math.max(0, Math.min(1, Number(v) || 0));
    state.music.volume = v;
    audio.volume = v;
    audio.muted = v === 0;
    state.music.muted = v === 0;
    musicVolume.value = v;
    updateVolumeIcon();
  }

  function toggleMute() {
    state.music.autoplayMuted = false; // 手动操作静音按钮即接管，取消自动恢复
    if (audio.muted || state.music.volume === 0) {
      setMusicVolume(state.music.volume > 0 ? state.music.volume : 0.7);
    } else {
      audio.muted = true;
      state.music.muted = true;
    }
    updateVolumeIcon();
  }

  function updateVolumeIcon() {
    const on = musicPlayBtn.parentElement.querySelector(".icon-vol-on");
    const off = musicPlayBtn.parentElement.querySelector(".icon-vol-off");
    if (!on || !off) return;
    const muted = audio.muted || state.music.volume === 0;
    on.style.display = muted ? "none" : "";
    off.style.display = muted ? "" : "none";
  }

  // 音频事件
  audio.addEventListener("timeupdate", () => {
    if (audio.duration) {
      musicProgressBar.style.width = (audio.currentTime / audio.duration) * 100 + "%";
    }
    updateLyricIndex();
  });
  audio.addEventListener("ended", () => {
    // 单曲循环：原地重播，不走切歌
    if (state.music.playMode === "one") {
      audio.currentTime = 0;
      audio.play().catch(() => {});
      return;
    }
    nextSong();
  });
  audio.addEventListener("error", () => {
    state.music.isLoading = false;
    setMusicPlayIcon("play");
    musicCapsule.classList.remove("playing");
    state.music.isPlaying = false;
    updateCoverOverlay();
    // 音源加载失败（如 VIP 歌曲流代理返回 502），自动跳下一首
    consecutiveFailCount++;
    if (consecutiveFailCount >= 3) {
      consecutiveFailCount = 0;
      toast("连续多首歌曲无可用音源，已停止播放");
      return;
    }
    const cur = state.music.playlist[state.music.currentIndex];
    toast(`「${cur?.name || "歌曲"}」暂无可用音源，自动下一首`);
    setTimeout(() => nextSong(), 800);
  });

  // 封面加载失败：显示默认音乐图标占位
  musicCover.addEventListener("error", () => {
    if (!musicCover.dataset.fallback) {
      musicCover.dataset.fallback = "1";
      // 用 SVG data URI 作为占位封面
      musicCover.src = "data:image/svg+xml;utf8," + encodeURIComponent(
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" fill="#e3e8f7"/><circle cx="50" cy="50" r="28" fill="#163bf2" opacity=".15"/><path d="M62 34L40 42v26a12 12 0 11-4-9V38l26-8v18a12 12 0 11-4 9V34z" fill="#163bf2" opacity=".6"/></svg>'
      );
    }
  });

  // 进度条点击跳转
  musicProgress.addEventListener("click", e => {
    if (!audio.duration) return;
    const rect = musicProgress.getBoundingClientRect();
    const pct = (e.clientX - rect.left) / rect.width;
    audio.currentTime = pct * audio.duration;
  });

  // 音量滑块
  musicVolume.addEventListener("input", e => {
    setMusicVolume(e.target.value);
  });

  // 折叠/展开胶囊
  function setCapsuleCollapsed(collapsed) {
    musicCapsule.classList.toggle("collapsed", collapsed);
    updateCoverOverlay();
  }

  // 更新折叠态中央的播放/暂停图标
  function updateCoverOverlay() {
    if (!musicCoverOverlay) return;
    const playing = state.music.isPlaying;
    musicCoverOverlay.innerHTML = playing
      ? `<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M6 5h4v14H6zm8 0h4v14h-4z"/></svg>`
      : `<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>`;
  }

  // 控制按钮委托
  musicCapsule.addEventListener("click", e => {
    // 折叠态：点击整个球 → 展开（不暂停音乐）
    if (musicCapsule.classList.contains("collapsed")) {
      setCapsuleCollapsed(false);
      return;
    }
    const btn = e.target.closest("[data-music-prev]");
    if (btn) { prevSong(); return; }
    if (e.target.closest("[data-music-mode]")) { cyclePlayMode(); return; }
    if (e.target.closest("[data-music-play]")) { togglePlay(); return; }
    if (e.target.closest("[data-music-next]")) { nextSong(); return; }
    if (e.target.closest("[data-music-list]")) { toggleMusicPlaylist(); return; }
    if (e.target.closest("[data-music-lyric]")) { toggleMusicLyric(); return; }
    if (e.target.closest("[data-music-mute]")) { toggleMute(); return; }
    if (e.target.closest("[data-music-close]")) {
      // 点击 X → 折叠成球形（音乐继续播放）
      setCapsuleCollapsed(true);
      if (musicLyric) musicLyric.hidden = true;
      if (musicPlaylist) musicPlaylist.hidden = true;
      return;
    }
  });

  // 播放列表关闭
  musicPlaylist.querySelector("[data-music-close-list]").addEventListener("click", () => {
    musicPlaylist.hidden = true;
  });
  // 播放列表选歌
  musicPlaylistList.addEventListener("click", e => {
    const item = e.target.closest(".music-playlist-item");
    if (!item || item.dataset.musicIdx === undefined) return;
    loadAndPlay(Number(item.dataset.musicIdx));
  });

  /** 初始化音乐播放器（设置启用时调用）
   *  加载歌单后，把第一首歌的标题/歌手/封面显示到胶囊上，但不自动播放
   */
  async function initMusicPlayer() {
    if (!state.settings.music_enable) {
      showMusicPlayer(false);
      return;
    }
    showMusicPlayer(true);
    // 应用后台音乐设置：初始音量 / 初始折叠 / 播放模式按钮态
    const vol = Math.max(0, Math.min(1, Number(state.settings.music_volume) || 0.7));
    setMusicVolume(vol);
    if (state.settings.music_collapsed) setCapsuleCollapsed(true);
    applyPlayModeBtn();
    if (!state.music.playlist.length) {
      const songs = await fetchMusicPlaylist();
      state.music.playlist = songs;
    }
    renderMusicPlaylist();
    // 刷新后默认显示第一首歌的信息（标题/歌手/封面），避免封面空白
    if (state.music.playlist.length && state.music.currentIndex < 0) {
      const first = state.music.playlist[0];
      musicTitle.textContent = first.name || "未播放";
      musicArtist.textContent = first.artist || "点击播放";
      setCover(first.pic);
      state.music.currentIndex = 0;
      renderMusicPlaylist();
    }
    // 预加载第一首：提前解析音源并缓冲，点击播放立即出声
    if (state.settings.music_preload !== false) {
      preloadFirstSong().then(() => {
        // 自动播放：预加载完成后尝试播放（被浏览器拦截则保持手动）
        if (state.settings.music_autoplay && !state.music.isPlaying && audio.paused) tryAutoplay();
      });
    } else if (state.settings.music_autoplay) {
      tryAutoplay();
    }
  }

  /** 预加载当前歌曲音源（不播放）：解析直链 → 填入 audio 缓冲。
   *  成功后 togglePlay 检测到 audio.src 与当前歌曲匹配，直接 play()，秒开。
   */
  let preloadToken = 0;
  async function preloadFirstSong() {
    if (!state.music.playlist.length) return;
    const idx = state.music.currentIndex >= 0 ? state.music.currentIndex : 0;
    const song = state.music.playlist[idx];
    if (!song) return;
    const token = ++preloadToken;
    try {
      let audioUrl = song.url || "";
      if (!audioUrl && /^\d+$/.test(song.id)) {
        const res = await api(`/api/music/163?id=${song.id}`);
        if (token !== preloadToken) return; // 期间用户已切歌/换曲，放弃
        audioUrl = res.url || "";
        if (res.cover && !song.pic) {
          song.pic = ensureHttps(res.cover);
          setCover(song.pic);
        }
      }
      if (!audioUrl) return;
      if (token !== preloadToken) return;
      // 已有同名音源（如自动播放已接手）则跳过
      if (audio.src && audio.dataset.songId === String(song.id)) return;
      audio.preload = "auto";
      audio.src = audioUrl;
      audio.dataset.songId = String(song.id);
      audio.load();
      loadLyric(song); // 歌词一并预取
    } catch {
      /* 预加载失败静默：点击播放时走正常 loadAndPlay 流程 */
    }
  }

  /** 标记播放中 UI 状态（tryAutoplay 复用） */
  function markPlaying() {
    state.music.isPlaying = true;
    musicCapsule.classList.add("playing");
    setMusicPlayIcon("pause");
    updateCoverOverlay();
    renderMusicPlaylist();
  }

  /** 自动播放（后台开启时）：预加载完成后直接播放。
   *  有声自动播放被浏览器策略拦截时（Safari/Firefox/无交互史的 Chrome 常见），
   *  回退为"静音自动播放"（各浏览器均允许），首次用户交互后自动恢复声音。 */
  async function tryAutoplay() {
    if (!audio.src) return;
    try {
      await audio.play();
      markPlaying();
    } catch (_) {
      try {
        audio.muted = true;
        state.music.autoplayMuted = true;
        await audio.play();
        markPlaying();
        updateVolumeIcon();
        toast("已静音自动播放，点击页面任意处开启声音");
        const restore = () => {
          window.removeEventListener("pointerdown", restore);
          window.removeEventListener("keydown", restore);
          window.removeEventListener("touchstart", restore);
          if (!state.music.autoplayMuted) return;
          state.music.autoplayMuted = false;
          audio.muted = false;
          updateVolumeIcon();
        };
        window.addEventListener("pointerdown", restore);
        window.addEventListener("keydown", restore);
        window.addEventListener("touchstart", restore);
      } catch (_) {
        /* 完全无法自动播放：保持暂停，等待用户手动点击 */
      }
    }
  }

  /* ================= 正文音乐卡片（[music=id] 渲染） ================= */

  const musicMetaCache = new Map();
  let musicCardAudio = null;

  function setCardIcon(card, playing) {
    const play = card.querySelector(".mcc-btn .i-play");
    const pause = card.querySelector(".mcc-btn .i-pause");
    if (play) play.hidden = playing;
    if (pause) pause.hidden = !playing;
  }

  function stopAllMusicCards() {
    document.querySelectorAll(".music-block-card.playing").forEach(c => {
      c.classList.remove("playing");
      setCardIcon(c, false);
      // 歌词行占位但透明，保持卡片高度不抖动
      const nowLyric = c.querySelector("[data-mcc-now-lyric]");
      if (nowLyric) nowLyric.classList.add("is-empty");
    });
  }

  function pauseBottomMusic() {
    if (audio && !audio.paused) {
      audio.pause();
      state.music.isPlaying = false;
      musicCapsule.classList.remove("playing");
      setMusicPlayIcon("play");
      updateCoverOverlay();
      renderMusicPlaylist();
    }
  }

  const cardLyricCache = new Map(); // songId -> [{time, text}]
  const cardLyricState = { lines: [], currentIndex: -1, songId: "" };
  const cardLyricDismissed = new Set(); // 用户主动关闭过的 songId，不再自动弹出

  function toggleMusicCard(card, id, meta) {
    if (!musicCardAudio) musicCardAudio = new Audio();
    const a = musicCardAudio;
    const nowLyric = card.querySelector("[data-mcc-now-lyric]");
    if (card.classList.contains("playing")) {
      a.pause();
      card.classList.remove("playing");
      setCardIcon(card, false);
      // 暂停时歌词行占位但透明，保持卡片高度不抖动
      if (nowLyric) nowLyric.classList.add("is-empty");
      return;
    }
    pauseBottomMusic();
    stopAllMusicCards();
    if (a.dataset.songId !== id) {
      a.src = meta.url || "";
      a.dataset.songId = id;
      // 切歌时重置歌词状态（歌词稍后在播放成功后自动加载）
      cardLyricState.lines = [];
      cardLyricState.currentIndex = -1;
      cardLyricState.songId = id;
    }
    a.volume = state.music.volume;
    a.play()
      .then(() => {
        card.classList.add("playing");
        setCardIcon(card, true);
        // 播放时显示内联歌词行（位于歌手名下方，不隐藏歌手名）
        if (nowLyric) {
          nowLyric.textContent = "♪";
          nowLyric.classList.remove("is-empty");
        }
        // 后台加载歌词（不强制弹出完整面板）
        autoLoadCardLyric(card, id);
        if (!a._cardBound) {
          a._cardBound = true;
          a.addEventListener("timeupdate", () => {
            const bar = document.querySelector(".music-block-card.playing .mcc-bar i");
            if (bar && a.duration) bar.style.width = (a.currentTime / a.duration) * 100 + "%";
            updateCardLyric(a.currentTime);
          });
          a.addEventListener("ended", () => {
            stopAllMusicCards();
          });
        }
      })
      .catch(() => toast("播放失败"));
  }

  /** 播放时后台加载歌词到内存，内联显示当前行（不自动弹出完整面板） */
  async function autoLoadCardLyric(card, id) {
    const panel = card.querySelector("[data-mcc-lyric-panel]");
    if (!panel) return;
    // 仅加载到内存，不自动弹出完整面板（用户可用歌词按钮手动展开）
    if (cardLyricCache.has(id)) {
      cardLyricState.lines = cardLyricCache.get(id);
      cardLyricState.songId = id;
      return;
    }
    try {
      const res = await api(`/api/music/163/lyric?id=${encodeURIComponent(id)}`);
      const lrc = res.lyric || "";
      cardLyricState.lines = parseLrc(lrc);
      cardLyricState.songId = id;
      cardLyricCache.set(id, cardLyricState.lines);
    } catch {
      cardLyricState.lines = [];
    }
  }

  /** 解析 LRC（复用底部播放器的 parseLrc） */
  function parseCardLrc(lrcStr) {
    if (!lrcStr) return [];
    return parseLrc(lrcStr);
  }

  /** 手动切换说说内音乐卡片的歌词面板 */
  async function toggleCardLyric(card, id, meta, btn) {
    const panel = card.querySelector("[data-mcc-lyric-panel]");
    if (!panel) return;
    const isOpen = panel.classList.contains("show");
    if (isOpen) {
      // 用户主动关闭：标记为 dismissed，不再自动弹出
      cardLyricDismissed.add(id);
      panel.classList.remove("show");
      if (btn) btn.classList.remove("active");
      return;
    }
    // 打开：清除 dismissed 标记（用户重新打开表示想看歌词）
    cardLyricDismissed.delete(id);
    panel.classList.add("show");
    if (btn) btn.classList.add("active");

    // 若歌词已缓存直接渲染
    if (cardLyricCache.has(id)) {
      cardLyricState.lines = cardLyricCache.get(id);
      cardLyricState.songId = id;
      renderCardLyric(panel);
      return;
    }
    panel.innerHTML = `<div class="mcc-lyric-empty">加载歌词中…</div>`;
    try {
      const res = await api(`/api/music/163/lyric?id=${encodeURIComponent(id)}`);
      const lrc = res.lyric || "";
      cardLyricState.lines = parseCardLrc(lrc);
      cardLyricState.songId = id;
      cardLyricCache.set(id, cardLyricState.lines);
      renderCardLyric(panel);
    } catch {
      panel.innerHTML = `<div class="mcc-lyric-empty">歌词加载失败</div>`;
    }
  }

  function renderCardLyric(panel) {
    if (!cardLyricState.lines.length) {
      panel.innerHTML = `<div class="mcc-lyric-empty">暂无歌词</div>`;
      return;
    }
    panel.innerHTML = cardLyricState.lines
      .map((l, i) => `<div class="mcc-lyric-line" data-idx="${i}">${esc(l.text)}</div>`)
      .join("");
  }

  function updateCardLyric(currentTime) {
    if (!cardLyricState.lines.length) return;
    let idx = -1;
    for (let i = 0; i < cardLyricState.lines.length; i++) {
      if (cardLyricState.lines[i].time <= currentTime) idx = i;
      else break;
    }
    if (idx === cardLyricState.currentIndex) return;
    cardLyricState.currentIndex = idx;

    // 内联显示当前歌词行（替换歌手名位置）
    const card = document.querySelector(".music-block-card.playing");
    const nowLyric = card?.querySelector("[data-mcc-now-lyric]");
    if (nowLyric) {
      const text = idx >= 0 ? cardLyricState.lines[idx].text : "";
      nowLyric.textContent = text;
      nowLyric.hidden = false;
    }

    // 若完整歌词面板已展开，同步高亮并滚动
    const panel = document.querySelector(".mcc-lyric.show");
    if (!panel) return;
    panel.querySelectorAll(".mcc-lyric-line").forEach(el => {
      el.classList.toggle("active", Number(el.dataset.idx) === idx);
    });
    const active = panel.querySelector(".mcc-lyric-line.active");
    if (active) {
      const top = active.offsetTop - panel.clientHeight / 2 + active.clientHeight / 2;
      panel.scrollTo({ top, behavior: "smooth" });
    }
  }

  /** 扫描容器内未水合的音乐占位卡，拉取元信息并挂播放器 */
  async function hydrateMusicCards(root) {
    const cards = [...root.querySelectorAll(".music-block-card[data-song-id]:not([data-hydrated])")];
    if (!cards.length) return;
    cards.forEach(c => (c.dataset.hydrated = "1"));
    await Promise.all(
      cards.map(async card => {
        const id = card.dataset.songId;
        let meta = musicMetaCache.get(id);
        if (!meta) {
          try {
            meta = await api(`/api/music/163?id=${id}`);
            musicMetaCache.set(id, meta);
          } catch {
            meta = null;
          }
        }
        if (!meta || meta.available === false) {
          card.innerHTML = `<div class="mcc-err">${svgIcon("music", 16)} 音乐不可用（已下架或版权限制）</div>`;
          return;
        }
        if (!meta.title && !meta.url) {
          card.innerHTML = `<div class="mcc-err">${svgIcon("music", 16)} 音乐加载失败</div>`;
          return;
        }
        card.innerHTML = `
          ${meta.cover ? `<img class="mcc-cover" src="${proxyCover(meta.cover)}" alt="" referrerpolicy="no-referrer" />` : `<div class="mcc-cover mcc-cover--ph">${svgIcon("music", 32)}</div>`}
          <div class="mcc-info">
            <div class="mcc-name">${esc(meta.title)}</div>
            <div class="mcc-artist" data-mcc-artist>${esc(meta.artist)}</div>
            <div class="mcc-now-lyric is-empty" data-mcc-now-lyric></div>
            <div class="mcc-bar"><i></i></div>
          </div>
          <button type="button" class="mcc-lyric-btn" data-mcc-lyric aria-label="歌词">
            <svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor"><path d="M14 3v2h3.59l-9.3 9.29 1.42 1.42L19 6.41V10h2V3h-7zM5 5v14h14v-7h-2v5H7V7h5V5H5z"/></svg>
          </button>
          <button type="button" class="mcc-btn" aria-label="播放/暂停">
            <svg class="i-play" viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
            <svg class="i-pause" viewBox="0 0 24 24" width="16" height="16" fill="currentColor" hidden><path d="M6 5h4v14H6zm8 0h4v14h-4z"/></svg>
          </button>
          <div class="mcc-lyric" data-mcc-lyric-panel><div class="mcc-lyric-empty">暂无歌词</div></div>`;
        card.querySelector(".mcc-btn").addEventListener("click", () => toggleMusicCard(card, id, meta));
        // 点击封面也可播放/暂停
        const cover = card.querySelector(".mcc-cover");
        if (cover) {
          cover.style.cursor = "pointer";
          cover.addEventListener("click", () => toggleMusicCard(card, id, meta));
        }
        // 歌词按钮（展开完整歌词面板，可选）
        const lyricBtn = card.querySelector("[data-mcc-lyric]");
        lyricBtn.addEventListener("click", () => toggleCardLyric(card, id, meta, lyricBtn));
      })
    );
  }

  // 底部播放器与正文卡片互斥
  audio.addEventListener("play", () => {
    if (musicCardAudio && !musicCardAudio.paused) {
      musicCardAudio.pause();
      stopAllMusicCards();
    }
  });

  /* ================= Markdown 编辑器工具栏（说说/文章通用） ================= */

  /** Jxe 同款 lucide 线性图标（24 viewBox，stroke 2） */
  const MD_ICONS = {
    heading: '<path d="M6 12h12"/><path d="M6 20V4"/><path d="M18 20V4"/>',
    bold: '<path d="M6 12h9a4 4 0 0 1 0 8H7a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h7a4 4 0 0 1 0 8"/>',
    italic: '<line x1="19" x2="10" y1="4" y2="4"/><line x1="14" x2="5" y1="20" y2="20"/><line x1="15" x2="9" y1="4" y2="20"/>',
    strike: '<path d="M16 4H9a3 3 0 0 0-2.83 4"/><path d="M14 12a4 4 0 0 1 0 8H6"/><line x1="4" x2="20" y1="12" y2="12"/>',
    quote:
      '<path d="M3 21c3 0 7-1 7-8V5c0-1.25-.756-2.017-2-2H4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2 1 0 1 0 1 1v1c0 1-1 2-2 2s-1 .008-1 1.031V20c0 1 0 1 1 1z"/><path d="M15 21c3 0 7-1 7-8V5c0-1.25-.757-2.017-2-2h-4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2h.75c0 2.25.25 4-2.75 4v3c0 1 0 1 1 1z"/>',
    code: '<polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/>',
    codeBlock: '<rect width="18" height="18" x="3" y="3" rx="2"/><path d="m10 10-2 2 2 2"/><path d="m14 14 2-2-2-2"/>',
    link: '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
    list: '<line x1="8" x2="21" y1="6" y2="6"/><line x1="8" x2="21" y1="12" y2="12"/><line x1="8" x2="21" y1="18" y2="18"/><line x1="3" x2="3.01" y1="6" y2="6"/><line x1="3" x2="3.01" y1="12" y2="12"/><line x1="3" x2="3.01" y1="18" y2="18"/>',
    listOrdered:
      '<line x1="10" x2="21" y1="6" y2="6"/><line x1="10" x2="21" y1="12" y2="12"/><line x1="10" x2="21" y1="18" y2="18"/><path d="M4 6h1v4"/><path d="M4 10h2"/><path d="M6 18H4c0-1 2-2 2-3s-1-1.5-2-1"/>',
    listChecks: '<path d="m3 17 2 2 4-4"/><path d="m3 7 2 2 4-4"/><path d="M13 6h8"/><path d="M13 12h8"/><path d="M13 18h8"/>',
    table: '<rect width="18" height="18" x="3" y="3" rx="2"/><line x1="3" x2="21" y1="9" y2="9"/><line x1="3" x2="21" y1="15" y2="15"/><line x1="12" x2="12" y1="3" y2="21"/>',
    minus: '<path d="M5 12h14"/>',
    image: '<rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/>',
    music: '<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>',
    pencil: '<path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/><path d="m15 5 4 4"/>',
    eye: '<path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/>',
    video: '<path d="m16 13 5.223 3.482a.5.5 0 0 0 .777-.416V7.87a.5.5 0 0 0-.752-.432L16 10.5"/><rect x="2" y="6" width="14" height="12" rx="2"/>',
    pin: '<path d="M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0"/><circle cx="12" cy="10" r="3"/>',
    crosshair: '<circle cx="12" cy="12" r="10"/><line x1="22" x2="18" y1="12" y2="12"/><line x1="6" x2="2" y1="12" y2="12"/><line x1="12" x2="12" y1="6" y2="2"/><line x1="12" x2="12" y1="22" y2="18"/>',
    upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" x2="12" y1="3" y2="15"/>',
    rocket:
      '<path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z"/><path d="m12 15-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z"/><path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0"/><path d="M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5"/>',
    highlight:
      '<path d="m9 11-6 6v3h9l3-3"/><path d="m22 12-4.6 4.6a2 2 0 0 1-2.8 0l-5.2-5.2a2 2 0 0 1 0-2.8L14 4"/>',
    expand:
      '<path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
    compress:
      '<path d="M8 3v3a2 2 0 0 1-2 2H3"/><path d="M21 8h-3a2 2 0 0 1-2-2V3"/><path d="M3 16h3a2 2 0 0 1 2 2v3"/><path d="M16 21v-3a2 2 0 0 1 2-2h3"/>',
    caret: '<path d="m6 9 6 6 6-6"/>',
    alignCenter:
      '<line x1="21" x2="3" y1="6" y2="6"/><line x1="17" x2="7" y1="12" y2="12"/><line x1="19" x2="5" y1="18" y2="18"/>',
    linkImage:
      '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
  };
  function mdIcon(name) {
    return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${MD_ICONS[name] || ""}</svg>`;
  }

  /** textarea 程序化修改后补发 input（音乐坞等监听方依赖） */
  function mdFireInput(ta) {
    ta.dispatchEvent(new Event("input", { bubbles: true }));
  }

  /** 光标处包裹选区 */
  function mdWrapSelection(ta, before, after, placeholder) {
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    const sel = ta.value.slice(start, end) || placeholder || "";
    ta.setRangeText(before + sel + after, start, end, "select");
    ta.selectionStart = start + before.length;
    ta.selectionEnd = start + before.length + sel.length;
    ta.focus();
    mdFireInput(ta);
  }

  /** 当前行首插入前缀 */
  function mdLinePrefix(ta, prefix) {
    const start = ta.selectionStart;
    const lineStart = ta.value.lastIndexOf("\n", start - 1) + 1;
    ta.setRangeText(prefix, lineStart, lineStart, "end");
    ta.selectionStart = ta.selectionEnd = start + prefix.length;
    ta.focus();
    mdFireInput(ta);
  }

  /** 独占一行插入块 */
  function mdInsertBlock(ta, text) {
    const start = ta.selectionStart;
    const atLineStart = start === 0 || ta.value[start - 1] === "\n";
    ta.setRangeText((atLineStart ? "" : "\n") + text + "\n", start, ta.selectionEnd, "end");
    ta.focus();
    mdFireInput(ta);
  }

  /** 居中块：包裹选区所在整行（可再次点击取消）；无选区时插入模板。文章/说说共用 */
  function mdWrapCenter(ta) {
    const val = ta.value;
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    if (start === end || !val.slice(start, end).trim()) {
      mdInsertBlock(ta, ":::center\n居中内容\n:::");
      return;
    }
    const blockStart = val.lastIndexOf("\n", start - 1) + 1;
    const nl = val.indexOf("\n", end);
    const blockEnd = nl === -1 ? val.length : nl;
    const block = val.slice(blockStart, blockEnd);
    if (/^:::center[ \t]*\n/.test(block) && /\n:::[ \t]*$/.test(block)) {
      const inner = block.replace(/^:::center[ \t]*\n/, "").replace(/\n:::[ \t]*$/, "");
      ta.setRangeText(inner, blockStart, blockEnd, "select");
    } else {
      ta.setRangeText(`:::center\n${block}\n:::`, blockStart, blockEnd, "select");
    }
    ta.focus();
    mdFireInput(ta);
  }

  /** 顺序上传多个文件并按类型插入 Markdown（图片 ![]()、视频 @[video]()） */
  async function mdUploadFiles(ta, files, kind, onMsg) {
    let ok = 0;
    for (const file of files) {
      try {
        onMsg?.(kind === "image" ? `生成缩略图 ${file.name} …` : `上传中 ${file.name} 0%`);
        const data = await uploadMedia(file, kind, p => onMsg?.(`上传中 ${file.name} ${Math.round(p * 100)}%`));
        if (kind === "video") mdInsertBlock(ta, `@[video](${data.src})`);
        else mdInsertBlock(ta, `![](${data.src})`);
        ok++;
      } catch (err) {
        toast(err.message || "上传失败");
      }
    }
    if (ok) toast(kind === "video" ? `视频已插入（${ok}）` : `图片已插入（${ok}）`);
  }

  /** 正文图片上传（支持多选） */
  function mdPickImages(ta) {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/jpeg,image/png,image/gif,image/webp";
    input.multiple = true;
    input.onchange = () => {
      const files = [...input.files].filter(f => f.type.startsWith("image/"));
      if (files.length) mdUploadFiles(ta, files, "image", msg => toast(msg));
    };
    input.click();
  }

  /** 替换当前行的块级前缀（用于标题级别切换/切回正文） */
  function mdSetLinePrefix(ta, prefix) {
    const start = ta.selectionStart;
    const lineStart = ta.value.lastIndexOf("\n", start - 1) + 1;
    const nl = ta.value.indexOf("\n", start);
    const lineEnd = nl === -1 ? ta.value.length : nl;
    const line = ta.value.slice(lineStart, lineEnd);
    const stripped = prefix === "" ? line.replace(/^#{1,6}\s+/, "") : line.replace(/^#{1,6}\s+/, "");
    const next = prefix + stripped;
    ta.setRangeText(next, lineStart, lineEnd, "start");
    ta.selectionStart = ta.selectionEnd = lineStart + next.length;
    ta.focus();
    mdFireInput(ta);
  }

  /** 工具栏下拉菜单：items=[{icon,label,fn}]，返回触发按钮（菜单挂到 body 防被工具栏 overflow 裁剪） */
  let mdMenuDocBound = false;
  function mdDropdown(toolbar, icon, title, items) {
    if (!mdMenuDocBound) {
      mdMenuDocBound = true;
      const closeAll = () => document.querySelectorAll(".md-menu").forEach(m => (m.hidden = true));
      document.addEventListener("click", e => {
        if (!e.target.closest?.(".md-dropdown-btn") && !e.target.closest?.(".md-menu")) closeAll();
      });
      window.addEventListener("scroll", closeAll, true);
      window.addEventListener("resize", closeAll);
    }
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "md-btn md-dropdown-btn";
    btn.title = title;
    btn.setAttribute("aria-label", title);
    btn.innerHTML = mdIcon(icon) + mdIcon("caret");
    const menu = document.createElement("span");
    menu.className = "md-menu";
    menu.hidden = true;
    items.forEach(it => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "md-menu-item";
      b.innerHTML = (it.icon ? mdIcon(it.icon) : "") + `<span>${it.label}</span>`;
      b.addEventListener("click", () => {
        menu.hidden = true;
        it.fn();
      });
      menu.appendChild(b);
    });
    document.body.appendChild(menu);
    btn.addEventListener("click", e => {
      e.stopPropagation();
      const willOpen = menu.hidden;
      document.querySelectorAll(".md-menu").forEach(m => (m.hidden = true));
      if (willOpen) {
        menu.hidden = false;
        const r = btn.getBoundingClientRect();
        menu.style.top = `${r.bottom + 6}px`;
        menu.style.left = `${Math.max(8, Math.min(r.left, window.innerWidth - 184))}px`;
      }
    });
    return btn;
  }

  /** 网络图片插入面板（复用 .editor-music-panel 样式） */
  function toggleImageUrlPanel(container, ta) {
    const exist = container.querySelector("[data-imgurl-panel]");
    if (exist) {
      exist.remove();
      return;
    }
    const panel = document.createElement("div");
    panel.className = "editor-music-panel";
    panel.dataset.imgurlPanel = "";
    panel.innerHTML = `
      <div class="emp-row">
        <input type="url" placeholder="粘贴图片直链 https://…（jpg/png/webp/gif），回车插入" />
        <button type="button" class="btn primary" data-iup-ok>插入</button>
        <button type="button" class="btn" data-iup-close aria-label="关闭">×</button>
      </div>
      <div class="emp-help">支持一次粘贴多个链接，用空格或换行分隔，将批量插入。</div>`;
    container.appendChild(panel);
    const input = panel.querySelector("input");
    input.focus();
    const ok = () => {
      const urls = input.value.match(/https?:\/\/[^\s]+/g) || [];
      if (!urls.length) return toast("请输入图片链接");
      urls.forEach(u => mdInsertBlock(ta, `![](${u})`));
      panel.remove();
      toast(`已插入 ${urls.length} 张图片`);
    };
    panel.querySelector("[data-iup-ok]").addEventListener("click", ok);
    panel.querySelector("[data-iup-close]").addEventListener("click", () => panel.remove());
    input.addEventListener("keydown", e => {
      if (e.key === "Enter") {
        e.preventDefault();
        e.stopPropagation();
        ok();
      }
    });
  }

  /** 视频插入面板：上传 MP4（≤100MB）或在线 m3u8/mp4 地址 */
  function toggleVideoInsertPanel(container, ta, initialTab) {
    const exist = container.querySelector("[data-video-panel]");
    if (exist) {
      exist.remove();
      return;
    }
    const panel = document.createElement("div");
    panel.className = "editor-music-panel";
    panel.dataset.videoPanel = "";
    panel.innerHTML = `
      <div class="seg evp-seg">
        <button type="button" data-vtab="mp4-upload" class="on">上传 MP4</button>
        <button type="button" data-vtab="url">在线地址</button>
      </div>
      <div data-vpanel="mp4-upload">
        <input type="file" accept="video/mp4" />
        <div class="upload-progress" data-evp-progress></div>
        <div class="emp-help">MP4 建议 ≤100MB；更大的视频请先传到对象存储/网盘，再用「在线地址」插入 <code>.m3u8</code> 或 <code>.mp4</code> 直链。</div>
      </div>
      <div data-vpanel="url" hidden>
        <div class="emp-row">
          <input type="url" placeholder="https://example.com/video.m3u8 或 .mp4" />
          <button type="button" class="btn primary" data-evp-ok>插入</button>
        </div>
        <div class="emp-row">
          <input type="url" data-evp-poster placeholder="封面图地址（选填，不填显示纯色占位）" />
        </div>
        <div class="emp-help">M3U8（HLS 流媒体）和 MP4 均可，前端会自动挂接播放器。封面图可选填任意网络图片地址。</div>
      </div>`;
    container.appendChild(panel);
    const progress = panel.querySelector("[data-evp-progress]");
    // 选项卡
    const switchTab = name => {
      panel.querySelectorAll("[data-vtab]").forEach(b => b.classList.toggle("on", b.dataset.vtab === name));
      panel.querySelectorAll("[data-vpanel]").forEach(p => (p.hidden = p.dataset.vpanel !== name));
    };
    panel.querySelectorAll("[data-vtab]").forEach(tb => tb.addEventListener("click", () => switchTab(tb.dataset.vtab)));
    if (initialTab === "url") {
      switchTab("url");
      panel.querySelector('input[type="url"]').focus();
    }
    // 本地上传
    panel.querySelector('input[type="file"]').addEventListener("change", async e => {
      const file = e.target.files[0];
      e.target.value = ""; // 允许再次选择同一个文件
      if (!file) return;
      if (!/video\/mp4|mp4/i.test(file.type) && !/\.mp4$/i.test(file.name)) {
        return toast("仅支持 MP4 文件");
      }
      try {
        // HEVC 检测：iPhone 默认录制为 hvc1，Firefox/部分 Chrome 不能解码 → 有声音没画面
        // 转码为 H.264 后所有浏览器可播；H.264 视频直传无影响
        let videoToUpload = file;
        if (await detectHevcMp4(file)) {
          progress.textContent = "检测到 HEVC 视频，正在转码为 H.264…";
          videoToUpload = await transcodeHevcToAvc(file, p => {
            // 100% 后 ffmpeg 还要做音频封装（原 faststart 已移除），期间可能持续数秒~数十秒
            if (panel.isConnected) progress.textContent = p >= 0.995 ? "正在封装视频，请稍候…" : `转码 HEVC → H.264 ${Math.round(p * 100)}%（首次加载转码器约 30MB）`;
          });
        }
        const data = await uploadMedia(videoToUpload, "video", p => {
          if (panel.isConnected) progress.textContent = `上传视频 ${Math.round(videoToUpload.size / 1048576)}MB，${Math.round(p * 100)}%`;
        });
        mdInsertBlock(ta, `@[video](${data.src})`);
        panel.remove();
        toast("视频已插入");
        // 视频上传完成后异步截取并上传封面，追加到刚插入的块（不阻塞，失败静默；用户也可自定义）
        // 注意：从转码后的文件截取封面（HEVC 原文件在 canvas 上可能无法渲染）
        (async () => {
          try {
            const posterBlob = await extractVideoPoster(videoToUpload);
            if (!posterBlob) return;
            const posterData = await uploadFile(new File([posterBlob], "poster.jpg", { type: "image/jpeg" }), "image");
            // 编辑器已关闭/销毁：不再回写
            if (!ta.isConnected) return;
            const target = `@[video](${data.src})`;
            const withPoster = `@[video](${data.src} "${posterData.src}")`;
            if (ta.value.indexOf(target) >= 0) {
              ta.value = ta.value.split(target).join(withPoster);
              ta.dispatchEvent(new Event("input"));
            }
          } catch {}
        })();
      } catch (err) {
        if (panel.isConnected) progress.textContent = err.message || "上传失败";
      }
    });
    // 在线地址
    const urlInput = panel.querySelector('input[type="url"]');
    const posterInput = panel.querySelector("[data-evp-poster]");
    const okUrl = () => {
      const u = urlInput.value.trim();
      // 去掉 query/hash 后按路径扩展名判断，兼容带签名参数（?Expires=&Signature=）的直链
      let pathOk = false;
      try {
        const path = new URL(u).pathname.toLowerCase();
        pathOk = /\.(m3u8|mp4)$/.test(path);
      } catch {}
      if (!pathOk) {
        return toast("请输入 .m3u8 或 .mp4 结尾的视频直链");
      }
      const p = posterInput.value.trim();
      // 封面接受 http(s) 外链或站内相对路径（/media/...）
      if (p && !/^https?:\/\/\S+$/i.test(p) && !/^\/\S+$/.test(p)) {
        return toast("封面地址需为 http(s) 链接或 / 开头的站内路径");
      }
      mdInsertBlock(ta, p ? `@[video](${u} "${p}")` : `@[video](${u})`);
      panel.remove();
      toast("视频已插入");
    };
    panel.querySelector("[data-evp-ok]").addEventListener("click", okUrl);
    urlInput.addEventListener("keydown", e => {
      if (e.key === "Enter") {
        e.preventDefault();
        e.stopPropagation();
        okUrl();
      }
    });
    posterInput.addEventListener("keydown", e => {
      if (e.key === "Enter") {
        e.preventDefault();
        e.stopPropagation();
        okUrl();
      }
    });
  }

  /** 音乐插入面板（内嵌在表单里，含 ID 获取帮助） */
  function toggleMusicInsertPanel(container, ta) {
    const exist = container.querySelector("[data-music-panel]");
    if (exist) {
      exist.remove();
      return;
    }
    const panel = document.createElement("div");
    panel.className = "editor-music-panel";
    panel.dataset.musicPanel = "";
    panel.innerHTML = `
      <div class="emp-row">
        <input type="text" placeholder="网易云歌曲 ID（纯数字）或歌曲页链接" />
        <button type="button" class="btn primary" data-emp-ok>插入</button>
        <button type="button" class="btn" data-emp-close aria-label="关闭">×</button>
      </div>
      <div class="emp-help">获取 ID：打开 <a href="https://music.163.com" target="_blank" rel="noreferrer">music.163.com</a> 歌曲页，地址栏 <code>music.163.com/song?id=554241732</code> 中的数字就是 ID。</div>`;
    container.appendChild(panel);
    const input = panel.querySelector("input");
    input.focus();
    const ok = () => {
      const m = input.value.trim().match(/(\d{5,})/);
      if (!m) return toast("请输入歌曲 ID 或歌曲页链接");
      mdInsertBlock(ta, `[music=${m[1]}]`);
      panel.remove();
    };
    panel.querySelector("[data-emp-ok]").addEventListener("click", ok);
    panel.querySelector("[data-emp-close]").addEventListener("click", () => panel.remove());
    input.addEventListener("keydown", e => {
      if (e.key === "Enter") {
        e.preventDefault();
        e.stopPropagation();
        ok();
      }
    });
  }

  /**
   * 编辑器内嵌「音乐坞」：实时解析 textarea 中的 [music=ID]，
   * 在编辑区内直接渲染可播放的音乐卡片（带移除按钮），说说/文章编辑器共用。
   * @param {HTMLTextAreaElement} ta
   * @param {Element} [afterEl] 坞插入位置（默认紧随 textarea）
   */
  function editorMusicDock(ta, afterEl) {
    const dock = document.createElement("div");
    dock.className = "editor-music-dock";
    dock.hidden = true;
    (afterEl || ta).after(dock);
    let lastKey = null;
    function sync() {
      const ids = [...ta.value.matchAll(/\[music=(\d+)\]/gi)].map(m => m[1]);
      const key = ids.join(",");
      if (key === lastKey) return;
      lastKey = key;
      if (!ids.length) {
        dock.hidden = true;
        dock.innerHTML = "";
        return;
      }
      dock.hidden = false;
      dock.innerHTML = ids
        .map(
          id => `
        <div class="editor-music-row">
          <div class="music-block-card" data-song-id="${id}"><div class="mcc-skeleton">${svgIcon("music", 16)} 加载中…</div></div>
          <button type="button" class="emd-remove" data-emd-rm="${id}" title="移除该音乐" aria-label="移除该音乐">×</button>
        </div>`
        )
        .join("");
      hydrateMusicCards(dock);
    }
    ta.addEventListener("input", sync);
    dock.addEventListener("click", e => {
      const rm = e.target.closest("[data-emd-rm]");
      if (!rm) return;
      ta.value = ta.value.replace(new RegExp(`\\[music=${rm.dataset.emdRm}\\][^\\n]*\\n?`, "i"), "");
      ta.dispatchEvent(new Event("input"));
      ta.focus();
    });
    sync();
    return dock;
  }

  /**
   * 文章编辑器（独立）：Jxe 风格 Markdown 工具栏 + 编辑/预览切换 + 内嵌音乐坞
   * 返回 { textarea }
   */
  function attachPostEditorTools(modal, textareaName) {
    const ta = modal.querySelector(`textarea[name="${textareaName}"]`);
    if (!ta) return null;
    const field = ta.closest(".field");
    field.classList.add("md-field");

    const toolbar = document.createElement("div");
    toolbar.className = "md-toolbar";

    const preview = document.createElement("div");
    preview.className = "md-preview datacont";
    preview.hidden = true;
    ta.before(toolbar);
    editorMusicDock(ta); // 先插坞再插预览，保持 .md-toolbar + textarea + .md-preview 相邻关系
    ta.after(preview);

    const seg = document.createElement("div");
    seg.className = "md-modes";
    seg.innerHTML = `<button type="button" class="on" data-mode="edit">${mdIcon("pencil")}<span>编辑</span></button><button type="button" data-mode="preview">${mdIcon("eye")}<span>预览</span></button>`;

    function setMode(mode) {
      seg.querySelectorAll("button").forEach(b => b.classList.toggle("on", b.dataset.mode === mode));
      field.classList.toggle("previewing", mode === "preview");
      if (mode === "preview") {
        preview.innerHTML = renderContentHtml(ta.value) || `<div class="essay-empty" style="padding:1rem">暂无内容</div>`;
        hydrateMusicCards(preview);
        hydrateVideos(preview);
        ta.hidden = true;
        preview.hidden = false;
      } else {
        disposeVideos(preview); // 退回编辑模式时停止预览区 HLS 拉流
        preview.hidden = true;
        ta.hidden = false;
      }
    }
    seg.addEventListener("click", e => {
      const btn = e.target.closest("button[data-mode]");
      if (btn) setMode(btn.dataset.mode);
    });

    /* ---------- 工具栏：下拉菜单 + 分组按钮 ---------- */
    const addSep = () => {
      const s = document.createElement("span");
      s.className = "md-sep";
      toolbar.appendChild(s);
    };
    const addBtn = (icon, title, fn, cls) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "md-btn" + (cls ? " " + cls : "");
      b.innerHTML = mdIcon(icon);
      b.title = title;
      b.setAttribute("aria-label", title);
      b.addEventListener("click", fn);
      toolbar.appendChild(b);
      return b;
    };

    // 段落 / 标题级别
    toolbar.appendChild(
      mdDropdown(toolbar, "heading", "段落标题", [
        { label: "正文", fn: () => mdSetLinePrefix(ta, "") },
        { label: "一级标题 H1", fn: () => mdSetLinePrefix(ta, "# ") },
        { label: "二级标题 H2", fn: () => mdSetLinePrefix(ta, "## ") },
        { label: "三级标题 H3", fn: () => mdSetLinePrefix(ta, "### ") },
      ])
    );
    addSep();
    addBtn("bold", "加粗（Ctrl+B）", () => mdWrapSelection(ta, "**", "**", "加粗文字"));
    addBtn("italic", "斜体（Ctrl+I）", () => mdWrapSelection(ta, "*", "*", "斜体文字"));
    addBtn("strike", "删除线（Ctrl+Shift+X）", () => mdWrapSelection(ta, "~~", "~~", "删除文字"));
    addBtn("highlight", "高亮（Ctrl+Shift+H）", () => mdWrapSelection(ta, "==", "==", "高亮文字"));
    addSep();
    addBtn("quote", "引用", () => mdLinePrefix(ta, "> "));
    addBtn("alignCenter", "居中段落（选中行后点击，再点取消）", () => mdWrapCenter(ta));
    addBtn("code", "行内代码（Ctrl+E）", () => mdWrapSelection(ta, "`", "`", "code"));
    addBtn("codeBlock", "代码块", () => mdWrapSelection(ta, "```\n", "\n```", "code"));
    addSep();
    addBtn("link", "链接（Ctrl+K）", () => mdWrapSelection(ta, "[", "](https://)", "链接文字"));
    if (state.admin) {
      // 图片：本地上传（多选）或网络直链
      toolbar.appendChild(
        mdDropdown(toolbar, "image", "插入图片", [
          { icon: "upload", label: "上传图片（可多选）", fn: () => mdPickImages(ta) },
          { icon: "linkImage", label: "网络图片链接", fn: () => toggleImageUrlPanel(field, ta) },
        ])
      );
      // 视频：本地上传 MP4 或在线 m3u8/mp4
      toolbar.appendChild(
        mdDropdown(toolbar, "video", "插入视频", [
          { icon: "upload", label: "上传 MP4（≤100MB）", fn: () => toggleVideoInsertPanel(field, ta, "mp4-upload") },
          { icon: "video", label: "M3U8 / MP4 在线地址", fn: () => toggleVideoInsertPanel(field, ta, "url") },
        ])
      );
    }
    addBtn("music", "插入网易云音乐", () => toggleMusicInsertPanel(field, ta), "music");
    addSep();
    addBtn("list", "无序列表", () => mdLinePrefix(ta, "- "));
    addBtn("listOrdered", "有序列表", () => mdLinePrefix(ta, "1. "));
    addBtn("listChecks", "任务列表", () => mdLinePrefix(ta, "- [ ] "));
    addSep();
    addBtn("table", "插入表格", () =>
      mdInsertBlock(ta, "| 列1 | 列2 | 列3 |\n| --- | --- | --- |\n| 内容 | 内容 | 内容 |")
    );
    addBtn("minus", "分割线", () => mdInsertBlock(ta, "---"));

    /* ---------- 右侧：字数统计 / 全屏 / 编辑预览 ---------- */
    const status = document.createElement("span");
    status.className = "md-status";
    const updateStatus = () => {
      const v = ta.value;
      const cjk = (v.match(/[一-龥]/g) || []).length;
      const words = (v.trim().match(/[A-Za-z0-9]+/g) || []).length;
      const imgs = (v.match(/!\[[^\]]*\]\(/g) || []).length;
      const vids = (v.match(/@\[video\]\(/g) || []).length;
      const musics = (v.match(/\[music=\d+\]/g) || []).length;
      const media = [imgs && `图 ${imgs}`, vids && `视频 ${vids}`, musics && `音乐 ${musics}`].filter(Boolean).join(" · ");
      status.textContent = `字数 ${cjk + words}${media ? "　" + media : ""}`;
    };
    ta.addEventListener("input", updateStatus);
    updateStatus();
    toolbar.appendChild(status);

    const fsBtn = addBtn("expand", "全屏编辑", () => toggleFullscreen());
    function toggleFullscreen() {
      const on = field.classList.toggle("md-fullscreen");
      fsBtn.innerHTML = mdIcon(on ? "compress" : "expand");
      fsBtn.title = on ? "退出全屏（Esc）" : "全屏编辑";
      fsBtn.classList.toggle("active", on);
      if (on) ta.focus();
    }

    toolbar.appendChild(seg);
    // 阻止工具栏按钮触发表单提交
    toolbar.querySelectorAll("button").forEach(b => (b.type = "button"));

    /* ---------- 编辑区增强（仅文章编辑器） ---------- */
    // 快捷键：Ctrl/Cmd+B/I/K/E、Ctrl+Shift+X/H；Tab 缩进
    ta.addEventListener("keydown", e => {
      if (e.isComposing) return;
      // 全屏下 Esc 先退出全屏（阻止冒泡到全局关闭弹窗）
      if (e.key === "Escape" && field.classList.contains("md-fullscreen")) {
        e.preventDefault();
        e.stopPropagation();
        toggleFullscreen();
        return;
      }
      if (e.key === "Tab") {
        e.preventDefault();
        ta.setRangeText("  ", ta.selectionStart, ta.selectionEnd, "end");
        mdFireInput(ta);
        return;
      }
      // Enter：列表/任务/引用自动续行；空项回车取消前缀
      if (e.key === "Enter" && !e.shiftKey && ta.selectionStart === ta.selectionEnd) {
        const pos = ta.selectionStart;
        const lineStart = ta.value.lastIndexOf("\n", pos - 1) + 1;
        const curLine = ta.value.slice(lineStart, pos);
        const task = curLine.match(/^(\s*)([-*+])\s+\[[ xX]\]\s/);
        const bullet = curLine.match(/^(\s*)([-*+])\s+/);
        const ordered = curLine.match(/^(\s*)(\d+)\.\s+/);
        const quote = curLine.match(/^(\s*>\s+)/);
        if (task || bullet || ordered || quote) {
          e.preventDefault();
          const emptyTask = /^\s*[-*+]\s+\[[ xX]\]\s*$/.test(curLine);
          const emptyBullet = /^\s*[-*+]\s*$/.test(curLine);
          const emptyOrdered = /^\s*\d+\.\s*$/.test(curLine);
          const emptyQuote = /^\s*>\s*$/.test(curLine);
          if (emptyTask || emptyBullet || emptyOrdered || emptyQuote) {
            ta.setRangeText("", lineStart, pos, "end");
          } else if (task) {
            ta.setRangeText(`\n${task[1]}${task[2]} [ ] `, pos, pos, "end");
          } else if (ordered) {
            ta.setRangeText(`\n${ordered[1]}${Number(ordered[2]) + 1}. `, pos, pos, "end");
          } else if (bullet) {
            ta.setRangeText(`\n${bullet[1]}${bullet[2]} `, pos, pos, "end");
          } else {
            ta.setRangeText(`\n${quote[1]}`, pos, pos, "end");
          }
          mdFireInput(ta);
          return;
        }
      }
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
      const k = e.key.toLowerCase();
      if (k === "b") {
        e.preventDefault();
        mdWrapSelection(ta, "**", "**", "加粗文字");
      } else if (k === "i") {
        e.preventDefault();
        mdWrapSelection(ta, "*", "*", "斜体文字");
      } else if (k === "k") {
        e.preventDefault();
        mdWrapSelection(ta, "[", "](https://)", "链接文字");
      } else if (k === "e") {
        e.preventDefault();
        mdWrapSelection(ta, "`", "`", "code");
      } else if (e.shiftKey && k === "x") {
        e.preventDefault();
        mdWrapSelection(ta, "~~", "~~", "删除文字");
      } else if (e.shiftKey && k === "h") {
        e.preventDefault();
        mdWrapSelection(ta, "==", "==", "高亮文字");
      }
    });

    // 粘贴图片：剪贴板里的截图直接上传插入
    ta.addEventListener("paste", e => {
      const files = [...(e.clipboardData?.files || [])].filter(f => f.type.startsWith("image/"));
      if (!files.length) return;
      e.preventDefault();
      mdUploadFiles(ta, files, "image", msg => toast(msg));
    });

    // 拖拽文件到编辑区：图片上传，MP4 作为视频上传
    ["dragenter", "dragover"].forEach(evt =>
      ta.addEventListener(evt, e => {
        if (e.dataTransfer && [...e.dataTransfer.files].length) {
          e.preventDefault();
          ta.classList.add("md-dragover");
        }
      })
    );
    ta.addEventListener("dragleave", () => ta.classList.remove("md-dragover"));
    ta.addEventListener("drop", e => {
      ta.classList.remove("md-dragover");
      const files = [...(e.dataTransfer?.files || [])];
      if (!files.length) return;
      e.preventDefault();
      const images = files.filter(f => f.type.startsWith("image/"));
      const videos = files.filter(f => /video\/mp4|\.mp4$/i.test(f.type) || /\.mp4$/i.test(f.name));
      if (images.length) mdUploadFiles(ta, images, "image", msg => toast(msg));
      if (videos.length) mdUploadFiles(ta, videos, "video", msg => toast(msg));
    });

    return { textarea: ta, setMode };
  }

  /* ================= 主题 ================= */

  function renderThemeBtn() {
    const cur = document.documentElement.dataset.theme;
    themeToggle.innerHTML = svgIcon(cur === "dark" ? "sun" : "moon", 18);
    themeToggle.title = cur === "dark" ? "切换浅色模式" : "切换深色模式";
  }
  themeToggle.addEventListener("click", () => {
    const cur = document.documentElement.dataset.theme;
    const next = cur === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    localStorage.setItem("moments_theme", next);
    renderThemeBtn();
  });
  renderThemeBtn();

  /* ================= 站内搜索弹层 ================= */

  const searchBtn = document.getElementById("searchBtn");
  const searchOverlay = document.getElementById("searchOverlay");
  const searchInput = document.getElementById("searchInput");
  const searchClear = document.getElementById("searchClear");
  const searchResults = document.getElementById("searchResults");
  let searchTimer = null;
  let searchItems = []; // {href, external} 与结果 DOM 顺序对齐
  let searchActive = -1;

  function openSearch(prefill) {
    if (prefill != null) searchInput.value = prefill;
    searchOverlay.hidden = false;
    requestAnimationFrame(() => { searchInput.focus(); searchInput.select(); });
    if (searchInput.value.trim()) runSearch(); else renderSearchEmpty();
  }
  function closeSearch() {
    if (searchOverlay.hidden) return;
    searchOverlay.hidden = true;
    searchActive = -1;
  }
  function highlight(q, text) {
    const safe = esc(text || "");
    if (!q) return safe;
    const re = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
    return safe.replace(re, m => `<mark>${m}</mark>`);
  }
  function renderSearchEmpty() {
    searchItems = []; searchActive = -1;
    searchResults.innerHTML = `<div class="search-empty">输入关键词，搜索文章、说说、友链</div>`;
  }
  function renderSearchLoading() {
    searchResults.innerHTML = `<div class="search-empty">搜索中…</div>`;
  }
  function renderSearchResults(data) {
    const q = data.query || "";
    const feedHref = "/?q=" + encodeURIComponent(q);
    const groups = [
      { key: "posts", label: "文章", icon: "file-text", more: !!data.posts_more, moreHref: "/posts",
        list: (data.posts || []).map(p => ({ title: p.title, sub: p.excerpt, href: "/post/" + encodeURIComponent(p.slug) })) },
      { key: "moments", label: "说说", icon: "message-circle", more: !!data.moments_more, moreHref: feedHref,
        list: (data.moments || []).map(m => ({ title: m.content || "（无文字）", sub: m.location ? "📍 " + m.location : m.created_at?.slice(0, 10) || "", href: feedHref })) },
      { key: "friends", label: "友链", icon: "link", more: !!data.friends_more, moreHref: "/links",
        list: (data.friends || []).map(f => ({ title: f.name, sub: f.description || f.url, href: f.url || "/links", external: !!f.url })) },
    ].filter(g => g.list.length || g.more);
    if (!groups.length) {
      searchItems = []; searchActive = -1;
      searchResults.innerHTML = `<div class="search-empty">没有找到与「${esc(q)}」相关的内容</div>`;
      return;
    }
    searchItems = [];
    let html = "";
    for (const g of groups) {
      if (!g.list.length) continue;
      html += `<div class="search-group"><div class="search-group-title">${svgIcon(g.icon, 14)} ${esc(g.label)} · ${g.list.length}${g.more ? "+" : ""}</div>`;
      for (const it of g.list) {
        const idx = searchItems.length;
        searchItems.push({ href: it.href, external: it.external });
        html += `<a class="search-item" data-search-idx="${idx}" href="${esc(it.href)}"${it.external ? ' target="_blank" rel="noopener"' : ""}>
          <div class="search-item-main"><div class="search-item-title">${highlight(q, it.title)}</div>${it.sub ? `<div class="search-item-sub">${highlight(q, it.sub)}</div>` : ""}</div>
          ${it.external ? '<span class="search-item-ext">↗</span>' : ""}
        </a>`;
      }
      if (g.more) {
        html += `<a class="search-more" href="${esc(g.moreHref)}" data-search-more>查看更多「${esc(g.label)}」结果 →</a>`;
      }
      html += `</div>`;
    }
    html += `<div class="search-total">共 ${data.total} 条结果</div>`;
    searchResults.innerHTML = html;
    searchActive = -1;
  }
  async function runSearch() {
    const q = searchInput.value.trim();
    searchClear.hidden = !q;
    if (!q) { renderSearchEmpty(); return; }
    if (searchTimer) clearTimeout(searchTimer);
    renderSearchLoading();
    searchTimer = setTimeout(async () => {
      try {
        const data = await api("/api/search?q=" + encodeURIComponent(q));
        if (searchOverlay.hidden || searchInput.value.trim() !== q) return; // 已关闭或又改了词
        renderSearchResults(data);
      } catch (e) {
        if (!searchOverlay.hidden) searchResults.innerHTML = `<div class="search-empty">${esc(e.message || "搜索失败")}</div>`;
      }
    }, 220);
  }
  function setSearchActive(delta) {
    const n = searchItems.length;
    if (!n) return;
    searchActive = (searchActive + delta + n) % n;
    const els = searchResults.querySelectorAll(".search-item");
    els.forEach((el, i) => el.classList.toggle("is-active", i === searchActive));
    els[searchActive]?.scrollIntoView({ block: "nearest" });
  }

  searchBtn?.addEventListener("click", () => openSearch());
  searchOverlay.addEventListener("click", e => {
    if (e.target.closest("[data-search-close]")) closeSearch();
    const more = e.target.closest("[data-search-more]");
    if (more) { e.preventDefault(); const href = more.getAttribute("href"); closeSearch(); if (href) navigate(href); return; }
    const item = e.target.closest(".search-item");
    if (item) {
      e.preventDefault();
      const idx = Number(item.dataset.searchIdx);
      const it = searchItems[idx];
      closeSearch();
      if (it.external) window.open(it.href, "_blank", "noopener");
      else navigate(it.href);
    }
  });
  searchInput.addEventListener("input", runSearch);
  searchClear.addEventListener("click", () => { searchInput.value = ""; searchInput.focus(); runSearch(); });
  searchInput.addEventListener("keydown", e => {
    if (e.key === "ArrowDown") { e.preventDefault(); setSearchActive(1); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setSearchActive(-1); }
    else if (e.key === "Enter") {
      if (searchActive >= 0) {
        e.preventDefault();
        const it = searchItems[searchActive];
        if (it) { closeSearch(); if (it.external) window.open(it.href, "_blank", "noopener"); else navigate(it.href); }
      }
    } else if (e.key === "Escape") { e.preventDefault(); closeSearch(); }
  });
  // 快捷键：Ctrl/Cmd+K 或 斜杠 唤起；Esc 关闭
  document.addEventListener("keydown", e => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") { e.preventDefault(); openSearch(); return; }
    if (e.key === "Escape") { if (!searchOverlay.hidden) { e.preventDefault(); closeSearch(); } return; }
    if (e.key === "/" && !searchOverlay.hidden && !/^(INPUT|TEXTAREA)$/.test(document.activeElement?.tagName || "")) {
      e.preventDefault(); openSearch();
    }
  });

  /* ================= 移动端汉堡菜单 ================= */

  const topbarEl = document.querySelector(".topbar");
  const menuToggle = document.getElementById("menuToggle");
  const mobileMenu = document.getElementById("mobileMenu");

  function closeMobileMenu() {
    if (!topbarEl.classList.contains("menu-open")) return;
    topbarEl.classList.remove("menu-open");
    menuToggle?.setAttribute("aria-expanded", "false");
    menuToggle?.setAttribute("aria-label", "打开菜单");
  }
  function openMobileMenu() {
    topbarEl.classList.add("menu-open");
    menuToggle?.setAttribute("aria-expanded", "true");
    menuToggle?.setAttribute("aria-label", "关闭菜单");
  }

  menuToggle.addEventListener("click", e => {
    e.stopPropagation();
    topbarEl.classList.contains("menu-open") ? closeMobileMenu() : openMobileMenu();
  });
  // 点导航链接（SPA 切换）后收起
  mobileMenu.addEventListener("click", e => {
    if (e.target.closest("a[href]")) closeMobileMenu();
  });
  // 点菜单外区域收起
  document.addEventListener("click", e => {
    if (topbarEl.classList.contains("menu-open") && !e.target.closest(".topbar")) closeMobileMenu();
  });
  document.addEventListener("keydown", e => {
    if (e.key === "Escape") closeMobileMenu();
  });
  // 拉宽到桌面断点时收起，避免状态残留
  window.addEventListener("resize", () => {
    if (window.innerWidth > 768) closeMobileMenu();
  });
  // SPA 前进/后退时收起
  window.addEventListener("popstate", closeMobileMenu);

  /* ================= 全局事件委托 ================= */

  document.addEventListener("keydown", e => {
    if (e.key === "Escape" && modalRoot.innerHTML) closeModal();
  });

  document.addEventListener("click", async e => {
    const btn = e.target.closest("[data-nav]");
    if (!btn || !btn.closest(".admin-area")) return; // 桌面顶栏与移动菜单共用同一委托
    closeMobileMenu();
    const nav = btn.dataset.nav;
    if (nav === "login") openLogin();
    else if (nav === "new-moment") openMomentComposer();
    else if (nav === "new-post") openPostEditor(null);
    else if (nav === "logout") {
      try {
        await api("/api/admin/logout", { method: "POST" });
      } catch (_) {}
      state.admin = false;
      renderAdminArea();
      if (location.pathname === state.adminPath || location.pathname === "/admin") {
        navigate("/", { replace: true });
      } else {
        route();
      }
      toast("已退出");
    }
  });

  app.addEventListener("click", async e => {
    /* ---------- 后台入口：随机生成秘密路径 ---------- */
    const genPathBtn = e.target.closest("[data-gen-path]");
    if (genPathBtn) {
      const rnd = Array.from({ length: 8 }, () =>
        "abcdefghijkmnpqrstuvwxyz23456789"[Math.floor(Math.random() * 32)]
      ).join("");
      const input = genPathBtn.closest("[data-adminpath-form]")?.querySelector('input[name="admin_path"]');
      if (input) {
        input.value = "/" + rnd;
        const msg = input.closest("[data-adminpath-form]")?.querySelector("[data-adminpath-msg]");
        if (msg) {
          msg.textContent = "已生成随机路径，确认无误后点击「更新入口路径」";
          msg.style.color = "var(--anzhiyu-secondtext)";
        }
      }
      return;
    }
    /* ---------- 后台页 ---------- */
    const tabBtn = e.target.closest("[data-admin-tab]");
    if (tabBtn) {
      state.adminTab = tabBtn.dataset.adminTab;
      renderAdmin();
      return;
    }
    const adminAct = e.target.closest("[data-admin-act]");
    if (adminAct) {
      const act = adminAct.dataset.adminAct;
      if (act === "unlock") {
        openLogin();
        return;
      }
      if (act === "new-moment") {
        openMomentComposer();
        return;
      }
      if (act === "new-post") {
        openPostEditor(null);
        return;
      }
      if (act === "del-moment") {
        const id = Number(adminAct.dataset.id);
        if (!confirm("确定删除这条说说？图片和视频会一起删除")) return;
        try {
          await api(`/api/moments/${id}`, { method: "DELETE" });
          toast("已删除");
          renderAdminMoments(document.getElementById("adminPanel"));
        } catch (err) {
          toast(err.message);
        }
        return;
      }
      if (act === "view-moment") {
        const id = Number(adminAct.dataset.id);
        try {
          const m = await api(`/api/moments/${id}?voter_id=${encodeURIComponent(state.voterId)}`);
          openMomentView(m);
        } catch (err) {
          toast(err.message);
        }
        return;
      }
      if (act === "edit-moment") {
        const id = Number(adminAct.dataset.id);
        try {
          const m = await api(`/api/moments/${id}?voter_id=${encodeURIComponent(state.voterId)}`);
          openMomentComposer(m);
        } catch (err) {
          toast(err.message);
        }
        return;
      }
      if (act === "del-post") {
        const id = Number(adminAct.dataset.id);
        if (!confirm("确定删除这篇文章？")) return;
        try {
          await api(`/api/posts/${id}`, { method: "DELETE" });
          toast("已删除");
          renderAdminPosts(document.getElementById("adminPanel"));
        } catch (err) {
          toast(err.message);
        }
        return;
      }
      if (act === "edit-post") {
        try {
          const p = await api("/api/posts/" + encodeURIComponent(adminAct.dataset.slug) + "?preview=1");
          openPostEditor(p);
        } catch (err) {
          toast(err.message);
        }
        return;
      }
      if (act === "del-comment") {
        const cid = Number(adminAct.dataset.cid);
        if (!confirm("确定删除这条评论？")) return;
        try {
          await api(`/api/admin/comments/${cid}`, { method: "DELETE" });
          toast("已删除");
          renderAdminComments(document.getElementById("adminPanel"));
        } catch (err) {
          toast(err.message);
        }
        return;
      }
      if (act === "edit-comment") {
        const cid = Number(adminAct.dataset.cid);
        const content = adminAct.dataset.content || "";
        openCommentEditor(cid, content);
        return;
      }
      return;
    }

    // banner 发布按钮 / 解锁 / 自定义链接（后台设置横幅按钮 URL 时）
    const fab = e.target.closest('[data-act="publish-fab"]');
    if (fab) {
      if (state.admin) openMomentComposer();
      else openLogin();
      return;
    }
    const bannerLink = e.target.closest('[data-act="banner-link"]');
    if (bannerLink) {
      const url = bannerLink.dataset.url || "";
      if (/^https?:\/\//i.test(url)) {
        if ((state.settings.banner_button_target || "_blank") === "_self") location.href = url;
        else window.open(url, "_blank", "noopener");
      } else if (url.startsWith("/")) navigate(url);
      return;
    }
    const unlockBtn = e.target.closest('[data-act="unlock"]');
    if (unlockBtn) {
      openLogin();
      return;
    }

    const act = e.target.closest("[data-act]");
    if (!act) return;
    const type = act.dataset.act;

    // 评论弹窗的关闭
    if (type === "clear-target") {
      state.commentTarget = null;
      closeModal();
      return;
    }
    if (type === "new-post") {
      openPostEditor(null);
      return;
    }

    // 即刻卡片操作
    const card = e.target.closest(".bber-item");
    if (!card) return;
    const id = Number(card.dataset.id);

    if (type === "like") {
      const likeEl = card.querySelector(".bber-like");
      const liked = likeEl.classList.contains("is-liked");
      const countEl = likeEl.querySelector(".bber-like-count");
      const current = countEl ? Number(countEl.textContent) || 0 : 0;

      const paintLike = (isLiked, count) => {
        likeEl.classList.toggle("is-liked", isLiked);
        const sv = likeEl.querySelector("svg");
        if (sv) sv.outerHTML = svgIcon(isLiked ? "heartFill" : "heartLine", 18);
        let c = likeEl.querySelector(".bber-like-count");
        if (count > 0) {
          if (!c) {
            likeEl.insertAdjacentHTML("beforeend", `<span class="bber-like-count"></span>`);
            c = likeEl.querySelector(".bber-like-count");
          }
          c.textContent = String(count);
        } else if (c) c.remove();
      };

      // 乐观更新
      paintLike(!liked, !liked ? current + 1 : Math.max(0, current - 1));
      try {
        const data = await api(`/api/moments/${id}/like`, { method: "POST", body: { voter_id: state.voterId } });
        paintLike(data.liked, data.like_count);
        const m = state.feed.find(x => x.id === id);
        if (m) {
          m.liked = data.liked;
          m.like_count = data.like_count;
        }
      } catch (err) {
        // 回滚
        paintLike(liked, current);
        toast(err.message);
      }
      return;
    }

    if (type === "reply") {
      const m = state.feed.find(x => x.id === id);
      if (m) {
        openCommentModal({
          ctype: "moment",
          cid: m.id,
          quote: plainText(m.content, 80) || `即刻 #${m.id}`,
          comment_count: m.comment_count,
          comments: m.comments,
        });
      }
      return;
    }

    if (type === "del") {
      if (!confirm("确定删除这条动态？图片和视频会一起删除")) return;
      try {
        await api(`/api/moments/${id}`, { method: "DELETE" });
        state.feed = state.feed.filter(x => x.id !== id);
        const li = app.querySelector(`.bber-item[data-id="${id}"]`);
        if (li) {
          disposeVideos(li);
          li.remove();
          feedEls = Array.from(document.getElementById("waterfall").children);
          syncFeedRO(); // 删除后重新观察现存卡片
          layout();
        }
        if (state.commentTarget && state.commentTarget.cid === id && state.commentTarget.ctype !== "post") {
          state.commentTarget = null;
        }
        toast("已删除");
      } catch (err) {
        toast(err.message);
      }
    }
  });

  app.addEventListener("submit", async e => {
    /* ---------- 后台：站点设置 ---------- */
    const settingsForm = e.target.closest("[data-settings-form]");
    if (settingsForm) {
      e.preventDefault();
      const fd = new FormData(settingsForm);
      const patch = {};
      ["site_title", "nav_feeds_name", "essay_tips", "essay_title", "essay_subtitle", "essay_button_text", "banner_button_url", "banner_button_target", "banner_bg_image", "brand_avatar", "author_name", "author_avatar", "post_avatar", "nav_links", "footer_text", "footer_run_since", "feed_page_size", "video_default_poster", "site_domain", "r2_domain", "site_icon", "random_avatar_api", "random_avatar_imgtype", "apihz_id", "apihz_key", "qq_ckqq", "qq_skey", "qq_pskey", "about_greeting", "about_greeting_sub", "about_avatar", "about_signature", "about_bio", "about_stats", "about_timeline", "about_bigstats", "about_contacts", "about_qr_text", "about_qr_amounts", "links_categories"].forEach(k => {
        // 外观/媒体拆分 Tab 后，只提交当前表单实际包含的字段，
        // 否则表单里不存在的字段会以空串提交，后端视为"恢复默认"，导致跨 Tab 互相清空
        if (!fd.has(k)) return;
        patch[k] = String(fd.get(k) || "").trim();
      });
      // about_enabled 复选框：勾选=启用（表单含该字段时才提交，避免跨 Tab 覆盖）
      const aboutEnabledEl = settingsForm.querySelector('[name="about_enabled"]');
      if (aboutEnabledEl) patch.about_enabled = aboutEnabledEl.checked;
      // 顶栏入口独立开关：关于/友链/相册
      const linksEnabledEl = settingsForm.querySelector('[name="links_enabled"]');
      if (linksEnabledEl) patch.links_enabled = linksEnabledEl.checked;
      const photosEnabledEl = settingsForm.querySelector('[name="photos_enabled"]');
      if (photosEnabledEl) patch.photos_enabled = photosEnabledEl.checked;
      const btn = settingsForm.querySelector('button[type="submit"]');
      btn.disabled = true;
      try {
        const s = await api("/api/admin/settings", { method: "PUT", body: patch });
        state.settings = s;
        applySettings();
        toast("设置已保存");
      } catch (err) {
        toast(err.message);
      } finally {
        btn.disabled = false;
      }
      return;
    }

    /* ---------- 后台：后台入口路径（安全） ---------- */
    const pathForm = e.target.closest("[data-adminpath-form]");
    if (pathForm) {
      e.preventDefault();
      const msg = pathForm.querySelector("[data-adminpath-msg]");
      msg.textContent = "";
      const newPath = pathForm.admin_path.value.trim().toLowerCase();
      if (!/^(\/admin|\/[a-z0-9][a-z0-9-]{2,38})$/i.test(newPath)) {
        msg.textContent = "格式非法：需为 /admin 或 / 开头加 3~39 位字母数字/短横线";
        msg.style.color = "#f56c6c";
        return;
      }
      if (newPath === (state.adminPath || "").toLowerCase()) {
        msg.textContent = "与当前入口相同，无需修改";
        msg.style.color = "var(--anzhiyu-secondtext)";
        return;
      }
      if (!confirm(`后台入口将变更为：\n${location.origin}${newPath}\n\n旧地址立即失效，请确认已牢记新地址！`)) return;
      const btn = pathForm.querySelector('button[type="submit"]');
      btn.disabled = true;
      try {
        const s = await api("/api/admin/settings", { method: "PUT", body: { admin_path: newPath } });
        if (s.admin_path) setAdminPath(s.admin_path);
        toast("入口已更新：" + (s.admin_path || newPath));
        // 立即跳到新入口（旧路径此刻已 404）
        if (location.pathname !== (s.admin_path || newPath)) {
          navigate(s.admin_path || newPath, { replace: true });
        }
      } catch (err) {
        msg.textContent = err.message;
        msg.style.color = "#f56c6c";
      } finally {
        btn.disabled = false;
      }
      return;
    }

    /* ---------- 后台：音乐播放器设置 ---------- */
    const musicForm = e.target.closest("[data-music-settings-form]");
    if (musicForm) {
      e.preventDefault();
      const fd = new FormData(musicForm);
      const patch = {
        music_enable: musicForm.querySelector('[name="music_enable"]').checked,
        music_autoplay: musicForm.querySelector('[name="music_autoplay"]').checked,
        music_preload: musicForm.querySelector('[name="music_preload"]').checked,
        music_collapsed: musicForm.querySelector('[name="music_collapsed"]').checked,
        music_volume: String(fd.get("music_volume") || "0.7"),
        music_playlist_id: String(fd.get("music_playlist_id") || "").trim(),
        music_custom_playlist: String(fd.get("music_custom_playlist") || "").trim(),
      };
      const btn = musicForm.querySelector('button[type="submit"]');
      btn.disabled = true;
      try {
        const s = await api("/api/admin/settings", { method: "PUT", body: patch });
        state.settings = s;
        applySettings();
        initMusicPlayer();
        toast("音乐设置已保存");
      } catch (err) {
        toast(err.message);
      } finally {
        btn.disabled = false;
      }
      return;
    }

    /* ---------- 后台：AI 评论机器人设置 ---------- */
    const aiForm = e.target.closest("[data-ai-settings-form]");
    if (aiForm) {
      e.preventDefault();
      const fd = new FormData(aiForm);
      const patch = {
        ai_reply_enabled: aiForm.querySelector('[name="ai_reply_enabled"]').checked,
        ai_bot_name: String(fd.get("ai_bot_name") || "").trim(),
        ai_bot_avatar: String(fd.get("ai_bot_avatar") || "").trim(),
        ai_text_model: String(fd.get("ai_text_model") || "").trim(),
      };
      if (!patch.ai_bot_name) return toast("请填写机器人昵称");
      const btn = aiForm.querySelector('button[type="submit"]');
      btn.disabled = true;
      try {
        const s = await api("/api/admin/settings", { method: "PUT", body: patch });
        state.settings = s;
        applySettings();
        toast("AI 设置已保存");
      } catch (err) {
        toast(err.message);
      } finally {
        btn.disabled = false;
      }
      return;
    }

    /* ---------- 后台：QQ 昵称 API ---------- */
    const qqApiForm = e.target.closest("[data-qq-api-form]");
    if (qqApiForm) {
      e.preventDefault();
      const patch = { qq_nick_apis: qqApiForm.qq_nick_apis.value };
      const btn = qqApiForm.querySelector('button[type="submit"]');
      btn.disabled = true;
      try {
        const s = await api("/api/admin/settings", { method: "PUT", body: patch });
        state.settings = s;
        toast("QQ API 设置已保存");
      } catch (err) {
        toast(err.message);
      } finally {
        btn.disabled = false;
      }
      return;
    }

    /* ---------- 后台：修改管理密码 ---------- */
    const passwordForm = e.target.closest("[data-password-form]");
    if (passwordForm) {
      e.preventDefault();
      const oldPwd = passwordForm.old_password.value;
      const newPwd = passwordForm.new_password.value;
      const confirmPwd = passwordForm.confirm_password.value;
      if (newPwd.length < 6) return toast("新密码至少 6 位");
      if (newPwd !== confirmPwd) return toast("两次输入的新密码不一致");
      const pwdBtn = passwordForm.querySelector('button[type="submit"]');
      pwdBtn.disabled = true;
      try {
        await api("/api/admin/password", {
          method: "POST",
          body: { old_password: oldPwd, new_password: newPwd },
        });
        passwordForm.reset();
        toast("密码已修改");
      } catch (err) {
        toast(err.message);
      } finally {
        pwdBtn.disabled = false;
      }
      return;
    }
  });

  /* ---------- 评论区点击委托：一键回复 / 楼中楼折叠 / 顶级评论折叠 / 取消回复 ---------- */
  document.addEventListener("click", e => {
    const btn = e.target.closest?.("button");
    if (!btn) return;
    if (btn.hasAttribute("data-replies-toggle")) {
      const id = Number(btn.dataset.repliesToggle);
      if (commentUi.expandedThreads.has(id)) commentUi.expandedThreads.delete(id);
      else commentUi.expandedThreads.add(id);
      rerenderCommentList();
      return;
    }
    if (btn.hasAttribute("data-comments-toggle")) {
      commentUi.showAll = !commentUi.showAll;
      rerenderCommentList();
      return;
    }
    if (btn.classList.contains("comment-reply-btn")) {
      startCommentReply(Number(btn.dataset.replyRoot), btn.dataset.replyName || "");
      return;
    }
    if (btn.hasAttribute("data-cancel-reply")) {
      const form = btn.closest("[data-comment-form]");
      // 取消回复时移除自动带入的 @昵称 前缀
      if (commentUi.replyName && form) {
        const prefix = `@${commentUi.replyName} `;
        if (form.content.value.startsWith(prefix)) form.content.value = form.content.value.slice(prefix.length);
      }
      resetReplyTarget(form);
    }
    // 随机评论
    if (btn.hasAttribute("data-random-comment")) {
      const form = btn.closest("[data-comment-form]");
      if (form?.content) fillRandomComment(form.content);
    }
  });

  /* ---------- 评论提交：监听 document（评论弹窗渲染在 #app 外的 #modalRoot 中） ---------- */
  document.addEventListener("submit", async e => {
    const form = e.target.closest?.("[data-comment-form]");
    if (!form) return;
    e.preventDefault();
    const target = state.commentTarget;
    if (!target) return toast("请先选择评论对象");
    const ctype = target.ctype === "post" ? "post" : "moment";
    const cid = Number(target.cid);
    const nickname = form.nickname.value.trim();
    const email = form.email?.value.trim() || "";
    const content = form.content.value.trim();
    const website = form.website?.value.trim() || "";
    if (!nickname) return toast("请填写昵称");
    if (!email) return toast("请填写邮箱");
    if (!content) return toast("评论内容不能为空");
    const qq = (form.dataset.qq || "").trim();
    const parentId = Number(form.dataset.parentId) || 0;
    const btn = form.querySelector('button[type="submit"]');
    btn.disabled = true;
    try {
      const endpoint = ctype === "post"
        ? `/api/posts/${encodeURIComponent(target.slug)}/comments`
        : `/api/moments/${cid}/comments`;
      const cm = await api(endpoint, {
        method: "POST",
        body: {
          nickname,
          content,
          qq: QQ_NUM_RE.test(qq) ? qq : "",
          email,
          avatar_url: form.dataset.avatar || "",
          website,
          parent_id: parentId,
          images: getCommentImages(form),
        },
      });
      localStorage.setItem("moments_nick", nickname);
      localStorage.setItem("moments_email", email);
      // 缓存头像与 QQ，重开评论弹窗时直接回填
      if (form.dataset.avatar) localStorage.setItem("moments_avatar", form.dataset.avatar);
      if (QQ_NUM_RE.test(qq)) localStorage.setItem("moments_qq", qq);
      // 仅保存合法且非占位的网址
      if (website && !EXAMPLE_URL_RE.test(website)) localStorage.setItem("moments_website", website);
      else localStorage.removeItem("moments_website");
      form.content.value = "";
      setCommentImages(form, []);
      resetReplyTarget(form);
      // 写入缓存并重整棵评论树（保证楼中楼归属/折叠计数正确）
      if (!Array.isArray(target.comments)) target.comments = [];
      target.comments.push(cm);
      if (parentId) commentUi.expandedThreads.add(parentId); // 发回复后自动展开所在楼
      rerenderCommentList();
      // 新回复滚动到可视区域
      if (parentId) {
        const thread = document.querySelector(`[data-comment-list] [data-thread-id="${parentId}"] .comment-replies-list`);
        thread?.lastElementChild?.scrollIntoView({ block: "nearest", behavior: "smooth" });
      }
      target.comment_count = (target.comment_count || 0) + 1;
      if (ctype === "moment") {
        const card = app.querySelector(`.bber-item[data-id="${cid}"] .bber-reply`);
        if (card) updateReplyCount(card, target.comment_count);
        const m = state.feed.find(x => x.id === cid);
        if (m) m.comment_count = target.comment_count;
      } else {
        updateArticleCommentCount(target.comment_count);
      }
      // @机器人：提示并轻量轮询异步生成的 AI 回复
      if (state.settings?.ai_reply_enabled && content.includes(`@${state.settings.ai_bot_name || "小J"}`)) {
        toast(`已召唤 ${state.settings.ai_bot_name || "小J"}，回复稍后自动出现`);
        pollAiReplies(target);
      }
    } catch (err) {
      toast(err.message);
    } finally {
      btn.disabled = false;
    }
  });

  /* ================= 路由（History API 真实路径，利于 SEO） ================= */

  /** 旧 hash 链接（#/post/x、#/photos…）→ 真实路径；返回 null 表示无 hash 需处理 */
  function legacyHashToPath() {
    const h = location.hash || "";
    if (!h.startsWith("#/")) return null;
    const rest = h.slice(2);
    const main = rest.split("?")[0];
    const query = rest.includes("?") ? "?" + rest.slice(rest.indexOf("?") + 1) : "";
    const map = { "": "/", posts: "/posts", photos: "/photos", admin: "/admin" };
    if (main in map) return map[main] + (map[main] === "/" ? "" : query);
    if (main.startsWith("post/")) return "/" + main + query;
    return null;
  }

  /** 编程式导航 */
  function navigate(url, opts = {}) {
    if (location.pathname + location.search === url) {
      window.scrollTo(0, 0);
      return;
    }
    history[opts.replace ? "replaceState" : "pushState"](null, "", url);
    route();
  }

  /** 拦截同站内部链接，无刷新跳转（外链/新窗口/下载/api/media 放行） */
  document.addEventListener("click", e => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const a = e.target.closest && e.target.closest("a[href]");
    if (!a || a.target === "_blank" || a.hasAttribute("download") || "noSpa" in a.dataset) return;
    let u;
    try { u = new URL(a.href, location.href); } catch { return; }
    if (u.origin !== location.origin) return;
    if (u.pathname.startsWith("/api/") || u.pathname.startsWith("/media/")) return;
    e.preventDefault();
    navigate(u.pathname + u.search);
  });

  // 点击带 data-copy 的元素：复制其值/文本到剪贴板
  document.addEventListener("click", e => {
    const el = e.target.closest && e.target.closest("[data-copy]");
    if (!el) return;
    const text = el.getAttribute("data-copy") || el.textContent || "";
    const done = () => toast("已复制到剪贴板");
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done).catch(() => {
        const ta = document.createElement("textarea"); ta.value = text; document.body.appendChild(ta);
        ta.select(); try { document.execCommand("copy"); done(); } catch { toast("复制失败"); } ta.remove();
      });
    }
  });

  /* ================= SEO meta 管理（客户端切换路由时同步） ================= */

  function upsertMeta(attr, key, content) {
    let el = document.head.querySelector(`meta[${attr}="${key}"]`);
    if (content === undefined || content === null || content === "") {
      if (el) el.remove();
      return;
    }
    if (!el) {
      el = document.createElement("meta");
      el.setAttribute(attr, key);
      document.head.appendChild(el);
    }
    el.setAttribute("content", content);
  }

  function setSeo(o) {
    const title = o.title || state.settings.site_title;
    document.title = title;
    upsertMeta("name", "description", o.description || "");
    upsertMeta("name", "robots", o.noindex ? "noindex,nofollow,noarchive" : "");
    let canonical = document.querySelector('link[rel="canonical"]');
    if (!canonical) {
      canonical = document.createElement("link");
      canonical.rel = "canonical";
      document.head.appendChild(canonical);
    }
    canonical.href = location.origin + o.path;
    const abs = src => (/^https?:\/\//i.test(src || "") ? src : src ? location.origin + src : "");
    const img = abs(o.image);
    [
      ["og:type", o.noindex ? "" : o.type || "website"],
      ["og:title", o.noindex ? "" : title],
      ["og:description", o.noindex ? "" : o.description || ""],
      ["og:url", o.noindex ? "" : location.origin + o.path],
      ["og:image", o.noindex ? "" : img],
    ].forEach(([k, v]) => upsertMeta("property", k, v));
    [
      ["twitter:card", o.noindex ? "" : img ? "summary_large_image" : "summary"],
      ["twitter:title", o.noindex ? "" : title],
      ["twitter:description", o.noindex ? "" : o.description || ""],
      ["twitter:image", o.noindex ? "" : img],
    ].forEach(([k, v]) => upsertMeta("name", k, v));
  }

  /** 404 空状态（访问已废弃的 /admin 等地址时显示，不暴露后台存在） */
  function renderNotFound() {
    state.activeView = "404";
    setSeo({ title: `页面不存在 · ${state.settings.site_title}`, path: location.pathname, noindex: true });
    app.innerHTML = `<div class="essay"><div class="posts-wrap"><div class="essay-empty">
      <span class="empty-ico">${svgIcon("search", 56)}</span><span>页面不存在</span>
      <a class="btn" href="/">返回首页</a></div></div></div>`;
  }

  function route() {
    // 后台手机抽屉若曾锁定滚动，任何路由切换都解除，避免页面卡住
    document.body.style.overflow = "";
    // 兼容旧 hash 外链：静默替换为真实路径
    const legacy = legacyHashToPath();
    if (legacy && legacy !== location.pathname + location.search) {
      history.replaceState(null, "", legacy);
    }
    const path = location.pathname || "/";
    const search = location.search;
    // SSR 注入的后台入口信号："1"=有效入口，"0"=服务端判定 404，null=SPA 内导航无信号
    const entryMetaEl = document.querySelector('meta[name="x-admin-entry"]');
    const ssrEntry = entryMetaEl ? entryMetaEl.getAttribute("content") : null;
    // 首次部署且未设密码：渲染"设置初始密码"表单
    const setupMetaEl = document.querySelector('meta[name="x-admin-setup"]');
    const ssrSetup = setupMetaEl ? setupMetaEl.getAttribute("content") : null;
    document.querySelectorAll("[data-route]").forEach(a => {
      const key = a.dataset.route;
      const isActive =
        (key === "feed" && path === "/") ||
        (key === "posts" && (path === "/posts" || path.startsWith("/post/"))) ||
        (key === "photos" && path === "/photos") ||
        (key === "links" && (path === "/links" || path.startsWith("/links/"))) ||
        (key === "about" && path === "/about") ||
        (key === "admin" && (path === state.adminPath || path === "/admin"));
      a.classList.toggle("active", isActive);
    });
    // 切换视图会整体覆盖 #app，先销毁时间线/文章里的 HLS 实例，
    // 否则视频元素随 DOM 丢弃后仍在后台拉 m3u8/ts 分片，累积耗 CPU/网络导致卡顿
    disposeVideos(app);
    if (path === "/") {
      renderFeed();
    } else if (path === "/about") {
      renderAbout();
    } else if (path === "/links") {
      renderLinks();
    } else if (path === "/links/apply") {
      renderLinksApply();
    } else if (path === "/posts") {
      renderPostList();
    } else if (path === "/photos") {
      renderPhotos();
    } else if (path.startsWith("/post/")) {
      const slug = decodeURIComponent(path.slice("/post/".length));
      const preview = state.admin && new URLSearchParams(search).get("preview") === "1";
      renderPostDetail(slug, preview);
    } else if (path === state.adminPath || ssrEntry === "1") {
      // 秘密后台入口（SPA 跳转靠本地记录的路径，硬加载靠 SSR meta 标记；
      // ssrEntry=1 仅由后端在 path===admin_path 时注入，故任意路径均适用）
      // 首次部署且未设密码：渲染设置初始密码表单，而非解锁页
      if (ssrSetup === "1" && !state.admin) {
        renderAdminSetup();
      } else {
        renderAdmin();
      }
    } else if (path === "/admin") {
      // 旧后台地址：以 SSR 信号为准，防止清缓存访客被前端画出解锁表单
      if (ssrEntry === "1") {
        if (ssrSetup === "1" && !state.admin) {
          renderAdminSetup();
        } else {
          renderAdmin();
        }
      } else if (ssrEntry === "0") {
        renderNotFound();
      } else if (state.admin && state.adminPath !== "/admin") {
        navigate(state.adminPath, { replace: true });
        return;
      } else if (state.adminPath === "/admin") {
        renderAdmin();
      } else {
        renderNotFound();
      }
    } else {
      navigate("/", { replace: true });
      return;
    }
    syncFab();
    window.scrollTo(0, 0);
  }

  window.addEventListener("popstate", route);

  /* bfcache（往返缓存）恢复页面时 JS 不会重新执行，
     浏览器后退/前进返回本站会导致初始折叠丢失 —— 在此重新应用 */
  window.addEventListener("pageshow", event => {
    if (event.persisted) applyMusicSettings();
  });

  /* ================= 启动 ================= */
  // 旧 workers.dev 域名迁移：把缓存/接口设置中的旧绝对地址改成相对路径，
  // 资源随当前域名（e.jxe.me）走，避免老用户 localStorage 缓存继续引用旧域名
  const OLD_ORIGIN_RE = /^https?:\/\/moments\.237333536\.workers\.dev/;
  function migrateSettings(s) {
    if (!s || typeof s !== "object") return s;
    ["brand_avatar", "author_avatar", "post_avatar", "banner_bg_image", "banner_button_url"].forEach(k => {
      if (typeof s[k] === "string") s[k] = s[k].replace(OLD_ORIGIN_RE, "");
    });
    return s;
  }

  (async function init() {
    // 先用上次缓存的设置应用顶栏/页脚/音乐设置，配合 index.html 内联脚本消除首帧默认值闪现
    try {
      const cached = migrateSettings(JSON.parse(localStorage.getItem("moments_settings") || "null"));
      if (cached && typeof cached === "object" && !Array.isArray(cached)) {
        state.settings = Object.assign({ ...DEFAULT_SETTINGS }, cached);
        applySettings();
      }
    } catch (_) {}
    try {
      const s = migrateSettings(await api("/api/settings"));
      state.settings = Object.assign({ ...DEFAULT_SETTINGS }, s);
      try { localStorage.setItem("moments_settings", JSON.stringify(s)); } catch (_) {}
    } catch (_) {
      /* 后端不可用时使用兜底默认值 */
    }
    applySettings();
    await refreshAdmin();
    route();
    initMusicPlayer();
  })();
})();
