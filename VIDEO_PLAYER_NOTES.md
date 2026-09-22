# 视频播放器实现记录

> 最后更新：2026-09-21，线上版本 v=20260920s
> 项目路径：`c:\Users\Administrator\Documents\trae_projects\moments`
> 部署命令：`npx wrangler deploy`（需 Cloudflare token，写在 `C:\Users\Administrator\Documents\trae_projects\Jxe\.env.local` 的 `CLOUDFLARE_API_TOKEN`）

---

## 一、当前实现方案

**核心思路：用浏览器原生 `<video controls poster>`，不叠任何全屏 overlay 图层。**

1. **封面**：直接用 `<video poster="URL">` 原生属性 + CSS `object-fit: cover` 充满容器
   - 封面是 video 元素自身的一部分，原生控制条永远在它之上，不会被遮挡
   - 浏览器在视频播放后自动隐藏 poster；HEVC 解码失败时永远不隐藏（兜底，至少能看封面）
2. **object-fit 切换**：封面阶段 `cover`（无黑边），播放中 `is-playing` 类切 `contain`（视频内容不裁切），`ended` 切回 `cover`
3. **居中播放按钮**：仅桌面端（`matchMedia('(pointer: coarse)')` 为 false）创建 `.video-play-btn`
   - 移动端不创建自定义按钮，用浏览器原生中央播放按钮（避免两个按钮重叠）
   - 按钮只占正中 60px，不挡底部控制条；播放中 `opacity:0 + pointer-events:none`
4. **竖屏自适应**：`loadedmetadata` 后把 video 的 `aspect-ratio` 设为真实宽高比，避免固定 16:9 两侧黑边
5. **外链封面**：走 `/imgproxy?u=...` Worker 反代（国内图床被 TLS 阻断时由 Cloudflare 回源），同源校验防滥用
6. **HEVC 转码**：上传时检测 `hvc1/hev1` FourCC（头尾各扫 2MB），用 ffmpeg.wasm 转 H.264 后上传；封面从转码后文件截取

---

## 二、已解决的问题（时间线，最新在上）

| 版本 | 问题 | 修复 |
|---|---|---|
| v=s | CSS 兜底 `::-webkit-media-controls-overlay-play-button{display:none}` 可能误伤移动端原生按钮 | 删除该规则，移动端保留原生中央按钮 |
| v=r | 移动端浏览器自带中央播放按钮，与自定义按钮重叠成两个 | `pointer:coarse` 检测，移动端不创建自定义按钮 |
| v=q | 只有原生 poster，无居中播放按钮 | 桌面端加 `.video-play-btn`，包 `.video-stage` 定位 |
| v=p | overlay `<img>` 封面盖住原生控制条，移动端体验差 | 改用原生 `poster` + `object-fit:cover`，删除全部 overlay 图层 |
| v=o | 12 项健壮性问题 + 默认封面功能 + imgproxy 防盗用 + SSR 视频块引号 bug | 见下方详情 |
| v=n/m/l/k/j/i | 封面双显、封面消失、黑图封面、图床被墙、loading 残留等迭代修复 | — |

### v=o 详细修复清单（12 项审查问题 + 新功能）

**高优先级**
1. 重播封面不消失 → `play` 事件 `readyState>=2` 时隐藏（已随 v=p 重构）
2. 关弹窗/切页视频不停声、HLS 不销毁 → `disposeVideos` 暂停所有 video + `closeModal` 先调 `disposeVideos`
3. 封面点击 play 失败无反应 → 失败后 `canplay` 重试、error 先 `load()`（已随 v=p 移除，原生 poster 点击即播）
4. 说说发布抢跑丢封面 → 发布前 `await videoPosterPromise`（15s 超时兜底）

**中优先级**
5. HEVC 只扫头 2MB 漏检（非 faststart）→ 头尾各扫 2MB
6. ffmpeg 加载失败永久卡死 → catch 里清空 `_ffmpegPromise`
7. `/imgproxy` 开放代理被盗刷 → `Sec-Fetch-Dest:image` 或同源 Referer/Origin 校验；15MB 限制读完整 body 校验
8. 竖屏视频封面→画面跳变 → `loadedmetadata` 写真实 aspect-ratio

**低优先级**
9. 视频 input 不重置 → `value=""`
10. 转码关弹窗后仍写脏 draft → `modal.isConnected` 判断
11. 封面不可键盘操作 → `role=button tabindex=0`（已随 v=p 移除，移动端原生、桌面端按钮已加）
12. 视频面板 URL 校验过严 → 用 `URL.pathname` 判扩展名，封面接受站内相对路径

**新功能**
- 后台「站点设置」新增 `video_default_poster`（支持上传 R2 / 填 URL / 站内路径），说说+文章+SSR 无封面视频自动套用
- SSR `markdown.ts` 视频块正则匹配 `&quot;`（正文先转义，之前带封面视频块在服务端失配）

---

## 三、关键文件与位置

### 前端 `public/app.js`
- `resolveVideoPoster()` ~L705：封面 fallback（自带 > 后台统一封面）
- `videoHtml()` ~L711：说说视频 HTML 输出
- marked `videoBlock` renderer ~L127：文章视频渲染
- `hydrateVideos()` ~L749：水合（poster 代理、is-playing、竖屏比例、桌面端按钮、HLS 挂接、loading 态）
- `disposeVideos()` ~L864：停止所有视频 + 销毁 HLS
- `closeModal()` ~L550：先 `disposeVideos(modalRoot)` 再清 DOM
- 说说上传入口 ~L2256（HEVC 检测→转码→上传→异步封面→发布等待）
- 文章视频面板 ~L4380（同上 + URL/封面校验放宽）
- `loadFfmpeg()` / `detectHevcMp4()` / `transcodeHevcToAvc()` ~L360-430
- 后台设置表单 `video_default_poster` 字段 + 上传逻辑 ~L3093、L3247

### 前端 `public/style.css`
- `.essay-media-video` ~L374、L602：`object-fit:cover` + `aspect-ratio:16/9`
- `.is-playing` → `object-fit:contain`
- `.video-stage` / `.video-play-btn` ~L386-409：定位容器 + 居中按钮
- 无封面视频渐变占位 `:not([poster])` ~L382

### 后端 `src/`
- `settings.ts`：`video_default_poster` 字段（默认空、长度 500、白名单自动生效）
- `markdown.ts` `renderMarkdownSafe(input, defaultPoster)`：SSR 视频封面 fallback + `&quot;` 正则
- `seo.ts` `renderPostSsr(row, count, defaultPoster)`
- `index.ts` 文章路由透传 `s.video_default_poster`
- `index.ts` `/imgproxy`：防盗用校验 + 15MB 完整 body 限制 + image/* 校验 + SSRF 内网拦截

### 版本号
`public/index.html` 中 `style.css?v=...` 和 `app.js?v=...`，每次改动递增字母。

---

## 四、技术要点与坑

1. **`<video>` 是替换元素，`::after`/`::before` 不生效**——CSS 加载提示 `::after` 实际无效，依赖浏览器原生 loading 动画
2. **`object-fit` 同时作用于 poster 和视频帧**——不能给 poster 和视频分别设，只能靠 `is-playing` 类切换
3. **`preload="none"` 不影响 poster 下载**——poster 是独立资源，浏览器仍会加载
4. **HEVC 检测要头尾都扫**——iPhone faststart 的 moov 在头部，安卓/剪映非 faststart 的 moov 在尾部
5. **ffmpeg-core.wasm 32MB 超 Workers 静态资源 25MB 限制**——从 jsdelivr CDN 加载（CORS 允许 `*`），首次加载约 10MB gzip
6. **`@[video](url "poster")` 在 SSR 中正则要匹配 `&quot;`**——因为 `renderMarkdownSafe` 先整体 `escapeHtml`
7. **imgproxy 必须校验来源**——否则第三方可当开放代理刷 Workers 请求额度
8. **转码后封面从转码文件截取**——HEVC 原文件在 canvas 上无法渲染，会产出 1×1 黑图
9. **`<video>` 原生 `poster` + 自定义居中按钮**是移动端体验最佳方案：原生控制条不被遮挡，按钮只占正中

---

## 五、已知限制 / 可能待处理

- **存量 HEVC 视频**（如黑屏的 4183d4dc）：浏览器转码只在新上传时生效，存量文件需手动重传或服务端批量转码（宝塔服务器跑 ffmpeg）
- **移动版 Edge 等浏览器的中央原生按钮样式不可控**：由浏览器渲染，无法统一外观（这是故意的，避免两个按钮）
- **`object-fit:contain` 播放时**：非 16:9 视频会有黑边（正常，保证内容不裁切）
- **竖屏视频高度**：目前 `aspect-ratio` 自适应，未限制最大高度，超长竖屏可能占屏过高（可加 `max-height:70vh`）
- **封面加载失败**：浏览器原生回退到黑底，无自定义兜底图（可考虑 `onerror` 切换到统一封面）
- **多个视频同时播放**：目前无互斥逻辑，理论上可同时播两个（可加全局单例播放控制）

---

## 六、部署备忘

```bash
cd c:\Users\Administrator\Documents\trae_projects\moments
# 令牌从本机环境变量读取，切勿写入代码或提交到仓库
$env:CLOUDFLARE_API_TOKEN="<你的 Cloudflare API Token>"
npx wrangler deploy
```

- 末尾 `workers/routes` 报 "No access" 是 token 权限问题，不影响 Worker 代码和静态资源部署
- 部署后必须改 `index.html` 版本号字母递增，用户需 **Ctrl+F5 强刷**
- 类型检查：`npx tsc --noEmit`

---

## 七、备选方案记录（未采用）

- **muiplayer / ArtPlayer 等第三方播放器**：都是 `<video>` 的 UI 封装，不解 HEVC，换了不解决黑屏问题，反而引入停更/协议风险。已确认不采用。
- **WASM 软解播放器（Jessibuca）**：能解 HEVC 但只支持直播流，MP4 需服务端实时转封装，绕回转码。不采用。
- **服务端转码（宝塔 ffmpeg）**：根治方案，可批量修复存量 HEVC。当前用浏览器转码替代，待后续需要时再做。
