# 项目上下文

### 版本技术栈

- **Framework**: Next.js 16 (App Router)
- **Core**: React 19
- **Language**: TypeScript 5
- **UI 组件**: shadcn/ui (基于 Radix UI)
- **Styling**: Tailwind CSS 4

## 目录结构

```
├── public/                 # 静态资源
├── scripts/                # 构建与启动脚本
│   ├── build.sh            # 构建脚本
│   ├── dev.sh              # 开发环境启动脚本
│   ├── prepare.sh          # 预处理脚本
│   └── start.sh            # 生产环境启动脚本
├── src/
│   ├── app/                # 页面路由与布局
│   ├── components/ui/      # Shadcn UI 组件库
│   ├── hooks/              # 自定义 Hooks
│   ├── lib/                # 工具库
│   │   └── utils.ts        # 通用工具函数 (cn)
│   └── server.ts           # 自定义服务端入口
├── next.config.ts          # Next.js 配置
├── package.json            # 项目依赖管理
└── tsconfig.json           # TypeScript 配置
```

- 项目文件（如 app 目录、pages 目录、components 等）默认初始化到 `src/` 目录下。

## 包管理规范

**仅允许使用 pnpm** 作为包管理器，**严禁使用 npm 或 yarn**。
**常用命令**：
- 安装依赖：`pnpm add <package>`
- 安装开发依赖：`pnpm add -D <package>`
- 安装所有依赖：`pnpm install`
- 移除依赖：`pnpm remove <package>`

## 开发规范

### 编码规范

- 默认按 TypeScript `strict` 心智写代码；优先复用当前作用域已声明的变量、函数、类型和导入，禁止引用未声明标识符或拼错变量名。
- 禁止隐式 `any` 和 `as any`；函数参数、返回值、解构项、事件对象、`catch` 错误在使用前应有明确类型或先完成类型收窄，并清理未使用的变量和导入。

### next.config 配置规范

- 配置的路径不要写死绝对路径，必须使用 path.resolve(__dirname, ...)、import.meta.dirname 或 process.cwd() 动态拼接。

### Hydration 问题防范

1. 严禁在 JSX 渲染逻辑中直接使用 typeof window、Date.now()、Math.random() 等动态数据。**必须使用 'use client' 并配合 useEffect + useState 确保动态内容仅在客户端挂载后渲染**；同时严禁非法 HTML 嵌套（如 <p> 嵌套 <div>）。
2. **禁止使用 head 标签**，优先使用 metadata，详见文档：https://nextjs.org/docs/app/api-reference/functions/generate-metadata
   1. 三方 CSS、字体等资源可在 `globals.css` 中顶部通过 `@import` 引入或使用 next/font
   2. preload, preconnect, dns-prefetch 通过 ReactDOM 的 preload、preconnect、dns-prefetch 方法引入
   3. json-ld 可阅读 https://nextjs.org/docs/app/guides/json-ld

## UI 设计与组件规范 (UI & Styling Standards)

- 模板默认预装核心组件库 `shadcn/ui`，位于`src/components/ui/`目录下
- Next.js 项目**必须默认**采用 shadcn/ui 组件、风格和规范，**除非用户指定用其他的组件和规范。**

## 云函数视频解析（miniprogram/cloudfunctions/yt_video_parse/index.js）

- `FN_VERSION` 版本戳随返回下发（`exports.main` 包装 `ver` 字段，尾部带 `[timing]` 总耗时日志），真机 toast 尾巴可见，用于排查「线上是否为最新部署」。
- **链路优先级（v15）**：`mainHandler` 对所有非直链先走聚合通道 `callZacaoParse`（`ZACAO_DISABLED=1` 可关，默认开启）——zacao 覆盖平台最多（快手/小红书/微博/头条/TikTok/视频号/公众号/百度/腾讯新闻等），命中即 `clientDownload` 直下；未命中静默降级自研链路（抖音/豆包/可灵/即梦/B站）。匿名 30 次/IP/小时，配 `ZACAO_API_KEY` 扩容。
- zacao 代理 URL：B站/小红书等 Referer 敏感 CDN，zacao 返回 `video.zacao.top/api/video/stream?url=...&referer=...` 代拉地址（HTTP 200 video/mp4，实测可下）——**`video.zacao.top` 必须在 downloadFile 白名单**；抖音/豆包系仍返回 CDN 直链。
- 豆包去水印链路（v14）：`parseDoubao` → 分享接口 `get_video_share_info`（拿 `source_info.message_id` + 水印流兜底）→ `callDoubaoPlayInfo`（Cookie get_play_info）→ **`callDoubaoMessageChannel`（消息通道）** → `tryDoubaoShareSsr` → 水印流 clientDownload 降级。
- 消息通道提速（v14）：等 `callDoubaoPlayInfo` 期间**并行预取**会话列表（`convsPreload` promise，命中消息通道时零等待复用）；对话扫描 `scanConversationsForFplay` 并发 3（`resolveFplayInConv` 拆分单对话解析，组内 `Promise.all` 取 max 而非串行求和）；`[doubao-timing]` share/playInfo/msg-channel/msg-scan + `[timing]` total 全链路埋点（云函数日志可直接定位慢在哪一段）。
- 聚合通道（v15 默认开启）：`video.zacao.top/api/parse` `{text: shareUrl}`（可选 `ZACAO_API_KEY` 扩容，匿名 30 次/IP/小时），`mainHandler` 全平台最优先调用，失败（实测 HTTP 502 + succ:false，~2s 快速失败）静默降级自研链路；`ZACAO_DISABLED=1` 整体关闭。前端不展示具体支持平台（第三方列表持续扩展，列出即过时）。
- 消息通道（自研，抓包 BDS 协议）：`fetchDoubaoConversations`（`alice/conversation/list`，query 必须带 `DOUBAO_IM_QUERY` 公共参数）→ `findDoubaoVideoFplay`（`im/chain/single` cmd:3100 翻页，Content-Type 必须为 `application/json; encoding=utf-8` 且带 `agw-js-conv: str` 头，翻页锚点 `next_index`）→ `extractFplayFromDoubaoMessage`（消息体 creation_block 内嵌 video_model JSON 的 fallback_api，token 绑 vid、url_expire 到 2036 年）→ `buildUnwatermarkedUrl` 改参重放（`logo_type=unwatermarked&codec_type=8`）→ `pickFplayVideo`（qAAB 解密 main_url）。
- 凭证：云开发控制台环境变量 `DOUBAO_COOKIE` / `DOUBAO_COOKIES`（多账号换行分隔，`getDoubaoCookiePool` 读取）；无凭证时全链路仍 ok:true（水印流 clientDownload），不报错。
- 豆包直下模式（v11）：`parseDoubao` 五处无水印/降级通道全部 `clientDownload: true`——云函数不下载转存 27MB+ 大文件（省 5~10s），直链（fplay url_expire 到 2036）由小程序端直下，解析压到 ~3s；云函数仅转存封面小图，yt_cleanup 清理负担大幅下降。
- clientDownload 多候选透传（v13.1）：mainHandler 两个 clientDownload 分支均透传 `playFallbacks`（share 页 url_list 变体 + play 接口 302 入口，最多 4 条）；前端 `saveToAlbum` 候选序 `playNoMark → play → playFallbacks`，单一直链失效（时效/防盗链/单接口 404）自动降级，修复抖音「单候选失败即视频下载失败」问题。直链首跳域名需在 downloadFile 白名单（aweme.snssdk.com / www.iesdouyin.com / www.douyin.com / v26-vdl.doubao.com / 365yg.com 系）。
- B站通道（v11，`parseBilibili`）：b23.tv 短链 302 展开 → BV/av 号提取（av 形态经 `avToBvByPage`：av 页 302 → 移动版页面提 BV；公开 base58 转换算法对 2024+ 新号段已失效）→ `x/player/pagelist` 取 cid + 分P（?p=N 选分P，越界回落 P1；**view 族接口对机房 IP 412 风控，必须走 pagelist**）→ `x/player/playurl?platform=html5&high_quality=1`（qn 64→32→16 降级，游客态 720P mp4 + backup_url 候选）→ 云函数转存（CDN 域名变体多无法进 downloadFile 白名单）。多段 durl（超长视频）明确报错；番剧/付费/互动视频无 durl 报错。CDN 直链必须带 UA（无 UA 403）。
- e2e 验证方式：`/tmp/harness/e2e_ck.js`（stub wx-server-sdk + 真实链接 + Cookie 直跑 `exports.main`）；单测 `test_units.js` 从源码 `m._compile(src + 追加导出行)` 提取纯函数，用 `/tmp/harness/target_msg.json`、`fplay_nomark.json` 真实抓包夹具。
