# Reader-Rust 完整开发与技术架构文档

本文档全面记录 `reader-rust` 的系统架构、设计原则、数据协议、模块分层以及在 Cloudflare Serverless 与 Rust 原生双栈生态下的最新完整技术实现。

---

## 一、 系统架构总览

`reader-rust` 是一个深度对齐开源“阅读 3.0”（Legado）生态规范的云原生在线阅读与书源解析服务，现已全面重构为**基于 Cloudflare Serverless 生态的纯无服务器架构**，同时兼顾原生 Rust 容器化运行能力。

### 1. 架构拓扑图

```text
                               ┌────────────────────────────────────────────────────────┐
                               │                      客户端接入层                       │
                               │  - Web 浏览器 (Vue 3 + Vite + PWA)                      │
                               │  - 手机端 "阅读 3.0" App (Android Legado)               │
                               └───────────────────────────┬────────────────────────────┘
                                                           │
                                                           ▼
┌───────────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│                                       Cloudflare 边缘托管层 (Pages & Functions)                                   │
│                                                                                                                   │
│  - 静态资源分发: Cloudflare Pages (HTML, CSS, JS, 图标全球 Anycast CDN 高速缓存)                                    │
│  - 边缘服务网关: Functions (functions/[[path]].ts) 统一捕获并代理 /reader3/* API 请求                             │
│  - 核心计算引擎: worker/index.ts                                                                                  │
│    ├── 用户认证与权限管理 (多用户隔离, 密码双重加盐哈希, Session Token 校验, SECURE_KEY 按需验证)                   │
│    ├── 书源管理与并发调度 (Scheme 1: 客户端驱动分块调度, 单次严格控制在 ≤ 15 源, 自动失效标记)                       │
│    ├── 网络书源深度解析 (动态时间戳与 MD5 防盗链验签, POST 载荷解析, AES-128/256 解密, GBK 自适应转码)             │
│    ├── 零内存电子书切片引擎 (TXT, EPUB, PDF; 支持基于 R2 原生 Multipart 的 1GB+ 前端分片上传)                        │
│    ├── 本地书籍统一分类引擎 (无论业务分组, 只要源指向 txt/epub/pdf 自动联动"本地"分类, 断链提示与进度继承)         │
│    ├── 完整 RSS 订阅与文章流 (支持 Legado 规范的 { first, second } 接口与正文抽取)                                │
│    ├── 双轨 WebDAV 桥接 (针对 Legado 手机 App 的实时双向进度对齐, 解除普通用户对管理员密码的依赖)                   │
│    ├── 异地 WebDAV 容灾同步引擎 (1:1 镜像用户资产目录 + 额外打包 Legado 标准 ZIP, 非阻塞流解压)                     │
│    └── 双轨 AI 伴读网关 (Cloudflare Workers AI 免费 GPU 推理 + 外部第三方商用模型中继)                            │
└──────────────────┬──────────────────────┬──────────────────────┬──────────────────────────┬───────────────────────┘
                   │                      │                      │                          │
                   ▼                      ▼                      ▼                          ▼
         ┌───────────────────┐  ┌───────────────────┐  ┌───────────────────┐      ┌───────────────────┐
         │  Cloudflare D1    │  │  Cloudflare R2    │  │ Cloudflare Queues │      │ Workers AI / 渲染 │
         │  (Serverless SQL) │  │  (对象存储桶)     │  │ (异步消息队列)    │      │ (GPU 算力引擎)    │
         │                   │  │                   │  │                   │      │                   │
         │ - 书源配置        │  │ - 电子书原件      │  │ - 超大 EPUB 分片  │      │ - Qwen 1.5 伴读   │
         │ - 用户与凭据      │  │   (EPUB/PDF/TXT)  │  │   流式索引解析    │      │ - Flux 场景插画   │
         │ - 书架与文档      │  │ - 静态图片素材    │  │ - 挂钟时间预算管理 │      │ - Kitesurf 动态   │
         │ - 章节切片索引    │  │ - 伴读生成图      │  │   (15s 安全断点)  │      │   浏览器正文抽取  │
         │ - 远端同步配置    │  │ - WebDAV 个人盘   │  │                   │      │                   │
         └───────────────────┘  └───────────────────┘  └───────────────────┘      └───────────────────┘
```

---

## 二、 数据库与持久化层设计（Cloudflare D1）

数据库使用 SQLite 兼容的 Serverless 边缘数据库 **Cloudflare D1**，全量结构定义在 `migrations/d1_schema.sql` 中。

### 1. 数据表清单与实体关系

| 数据表名称 | 核心字段说明 | 业务职责 |
| :--- | :--- | :--- |
| **`users`** | `username`, `password`, `salt`, `token`, `enable_webdav`, `is_admin`, `created_at` | 用户账号、加盐密码哈希、权限与 WebDAV 开通标记 |
| **`user_sessions`** | `username`, `token`, `expire_at` | 登录会话令牌（30 天有效期） |
| **`book_sources`** | `user_ns`, `book_source_url`, `book_source_name`, `json`, `updated_at` | 用户专属的书源解析规则库，支持失效自动打标 |
| **`json_documents`** | `namespace`, `name`, `json`, `updated_at` | 书架（bookshelf）、分组（bookGroup）、书签、净化规则、RSS（rssSource）等文档存储 |
| **`ai_book_memories`**| `user_ns`, `book_key`, `book_url`, `json`, `updated_at` | AI 伴读抽取的世界观、人物拓扑图谱与时间线 |
| **`txt_books`** | `book_id`, `user_ns`, `r2_key`, `file_size`, `total_chapters`, `title` | 本地 TXT 小说元数据主表 |
| **`txt_chapters`** | `book_id`, `chapter_index`, `title`, `byte_offset`, `byte_length` | TXT 各章节在全文中的字节切片索引 |
| **`epub_books`** | `book_id`, `user_ns`, `r2_key`, `status`, `total_chapters`, `parsed_chapters` | EPUB 电子书主表及分片解析进度 |
| **`epub_chapters`** | `book_id`, `chapter_index`, `title`, `byte_offset`, `byte_length`, `compression_method`, `file_name` | EPUB 章节绝对字节偏移、压缩算法与锚点文件定义 |
| **`epub_parse_checkpoints`** | `book_id`, `last_processed_index`, `spine_json`, `updated_at` | 队列分片解析的挂钟时间中断断点 |
| **`pdf_books`** | `book_id`, `user_ns`, `r2_key`, `file_size`, `total_pages`, `title`, `author` | PDF 书籍元数据与总页数主表 |
| **`pdf_outlines`** | `book_id`, `title`, `dest_page`, `level` | PDF 目录大纲树（用于侧边抽屉秒级打开） |
| **`user_remote_webdav`** | `username`, `enabled`, `server_url`, `webdav_user`, `sync_on_change`, `last_sync_at` | 远端 WebDAV 异地容灾同步配置与执行状态 |

### 2. D1 读写配额深度治理（防止超额行写入）
此前测试中曾出现单日狂写 150k+ 行的异常消耗，现已全链路实现配额治理：
1. **彻底移除 MOBI 逐条 Record 写入**：移除了 MOBI/PalmDOC 产生的上万条微切片记录；
2. **增量书源比对（Delta Sync）**：`handleSaveBookSources` 在写入前比对内存中的已有书源哈希，未发生变动的书源直接短路跳过，2,000 个书源重复导入时的写入量降为 **0 行**；
3. **全局文档写入去重**：`saveDocument` 在执行 SQL 前比对现有 `json` 字符串，书架/配置未变更时直接跳过 `INSERT OR REPLACE` 操作，消除翻页过程中对 `json_documents` 的重复写入。

---

## 三、 本地电子书零内存切片与分片上传架构

为彻底解决 Cloudflare Edge 单次请求 100MB 上限与 Worker 128MB 物理内存限制，并精简系统复杂度，**系统全面支持 TXT、EPUB、PDF 三大格式（不再提供 MOBI 兼容）**，采用前端分片直传与零内存流式切片架构。

### 1. 前端大文件分片上传引擎（Chunked Upload Engine）
- **触发机制**：在主页“导入本地书”与 WebDAV 文件上传中，体积小于 10MB 的文件走标准表单上传；**超过 10MB 的大文件（实测支持 113MB、150MB、300MB 直至 1.05GB+）自动触发分片上传**；
- **分片协议（`frontend/src/utils/chunkedUpload.ts`）**：
  1. `POST /reader3/upload/init`：提交文件名与体积，服务端调用 Cloudflare R2 原生 `createMultipartUpload` 初始化会话，返回 `uploadId` 与 `key`；
  2. `POST /reader3/upload/part`：前端以 10MB 为分片单元流式直传各分块（携带 `partNumber`），服务端调用 `uploadPart` 直接写入对象存储，Worker 内存占用恒定在 10MB 以内；提供精确的百分比上传进度回调；
  3. `POST /reader3/upload/complete`：全部切片上传完毕后，服务端调用 `complete(parts)` 在 R2 存储层秒级合成，并触发后台自动索引入库。
- **重名安全防重**：导入本地书与 WebDAV 上传时，前置比对已有书名/文件名，遇重名立即安全拦截并提示 **`书籍已存在：《xxx》`**。

### 2. 本地电子书切片与读取方案
1. **EPUB 电子书**：
   - 尾部 Range 拉取 64KB 解析 ZIP 中央目录与 `content.opf`，按 Spine 提取章节列表存入 D1；
   - 章节读取时由 Worker 查询 `epub_chapters` 的字节偏移向 R2 发起局部切片拉取，使用 `sliceHtmlByAnchors` 严格按起始与后续章节锚点截断，防止章节间内容泄漏；
2. **PDF 文档**：
   - 尾部 Range 拉取 64KB 解析总页数与文档信息，目录页码与章节索引严格按 0 索引对齐；
   - 服务端配置 `Accept-Ranges: bytes` 与 `HTTP 206 Partial Content`，前端阅读器通过内嵌容器流式按需加载目标页；
3. **TXT 纯文本小说**：
   - 自动嗅探 UTF-8 与 GB18030/GBK 编码并转码为标准 UTF-8；正则扫描章节标题精确计算字节偏移，阅读时恒定以几 KB 内存切片输出。

### 3. 本地书籍判定统一化与断链恢复
- **统一判定规则（`frontend/src/utils/localBook.ts: isLocalBook`）**：
  无论书籍在书架上被分配到何种业务分组（如完本、连载、追更等），只要其来源特征指向 TXT、EPUB、PDF（匹配 `origin`、`bookUrl`、`tocUrl`、`kind`、`originName` 中的 `local-`、`webDav::`、`content://` 协议或文件扩展名），均自动认定为本地书籍；
- **书架分类联动**：
  - 点击“完本”（`groupId === 1`）：根据位运算展示在“完本”分组；
  - 点击“本地”（`groupId === -2`）：**同时自动汇总并在“本地”分组中展示**；
- **断链友好提示与进度继承**：
  - 若服务端 R2/WebDAV 尚未上传或物理文件缺失，打开时统一拦截并提示 **`书籍不存在，请重新上传`**；
  - 重新上传该书籍时，系统自动匹配书架历史记录，**完整继承历史阅读章节（`durChapterIndex`）、章节内阅读百分比（`durChapterPos`）、阅读时间戳及分组属性**，无缝续读。

---

## 四、 阅读器排版引擎与翻页交互

### 1. 三大核心翻页模式
- **上下滑动**：单章节独立分页模式，每个章节只展示自身文本，章节末尾展示“下一章”按钮，章节之间严格物理隔离；
- **左右翻页**：水平无缝独立分页模式，页面内容按视口精确分栏，末尾浮动呈现“下一章”操作；
- **连续翻页**（原“上下滚动”重命名）：垂直无缝流式翻页模式，滚动至当前章节末尾自动预加载并追加下一章节；
  - 目录跳转置顶：点击目录切换章节时，强制清空历史滚动位置并将目标进度重置为 0，确保切换章节后从首行置顶阅读；
  - 段落级进度追踪：扩充元素选择器至 `p, div, section, h1~h6`，精确记忆在连续流中的阅读位置；
- **彻底移除上下滚动 2**，消除冗余状态。

### 2. 章节标题智能去重（`deduplicateChapterTitle`）
- 针对 EPUB、网络书源与富文本小说中普遍存在“外层阅读器生成了一次标题，书籍正文开头又包含 `<h1>` 标题”的双重标题问题；
- 阅读器引入深层遍历去重机制：规范化过滤标点符号与全角半角空白后，自动检测正文开头的首个标题节点或前置段落。若其文本与章节标题一致，且正文包含多段内容（`wrapper.children.length > 1`），自动剔除正文内部重复的首行标题，只保留外层规范排版的大标题。

### 3. 阅读进度越界安全对齐（Index Clamping）
- 修复了从手机备份恢复或切换书源时因历史进度章节号（如第 567 章）大于新书源章节总数（如 50 章）导致的静默退出与空白问题；
- `loadChapter` 引入安全区间约束：`safeIndex = Math.max(0, Math.min(chapters.length - 1, index))`，自动对齐至有效章节，配合空内容自愈监听，保证正文请求 100% 触发。

### 4. 简繁双向无损切换
- 双向动态按需导入 `traditionalized` 与 `simplized` 转换字典；
- 切换至繁体时实时转换，再次点击简体时正确还原简体，支持双向无缝热切换。

---

## 五、 书架系统与 Legado 原生生态对齐

### 1. 深度适配 Legado 系统分组规范
全面兼容 Legado（阅读 3.0）标准备份导出的 `bookGroup.json` 分组定义：

| 分组 ID (`groupId`) | 系统分组名称 | 行为规范 |
| :--- | :--- | :--- |
| **`-1`** | **全部** | 默认固定分组，无论导入设置如何强制默认展示，汇聚书架所有图书 |
| **`-2`** | **本地** | 默认固定分组，汇聚全部 TXT、EPUB、PDF 格式书籍 |
| **`-4`** / **`0`** | **未分组** | 默认固定分组，归一化收纳未分配分组（group 为 0、-4 或 -5）的书籍 |
| **`1`** | **完本** | 业务分组，基于位掩码 `(group & 1) !== 0` 判定 |
| **`2`** | **连载** | 业务分组，基于位掩码 `(group & 2) !== 0` 判定 |
| **`4`** | **已读** | 业务分组，基于位掩码 `(group & 4) !== 0` 判定 |

### 2. 分组管理交互增强（`GroupManagerModal.vue`）
- **系统分组拖拽排序**：“全部”、“本地”、“未分组”统一纳入分组管理列表，配备拖拽手柄，支持在列表中与普通分组一起自由上下拖拽调整顺序，实时持久化 `orderNo`；
- **系统保护**：系统分组带有“默认”徽标保护，禁止重命名和删除；
- **分组可见性切换**：各分组（包括系统分组）均支持一键切换“显示中 / 已隐藏”，书架标签栏自动按最新顺序与可见状态响应呈现。

### 3. 书架排序优先级规则
- 全面落实 **`最后阅读时间（durChapterTime）降序 > 文件名（name）中文拼音/数字自然排序`**；
- 最近阅读过的书籍按阅读时间从近到远排在书架最前，未阅读或时间相同的书籍按文件名自然排序，备份导入后顺序稳定不乱。

### 4. 主页极简重构与“书架设置”全局抽屉
- 从主页顶部工具栏剥离“导入本地书”、“刷新书架”、“分组管理”、“缓存管理”、“编辑”5 个操作，主页回归纯净极简；
- 在全局“设置”侧边抽屉（`SettingsDrawer.vue`）中开辟了专属的 **“书架设置”** 专区，一键唤起各项管理；
- 顶部导航栏移除外部“文档”链接，GitHub 图标外链精准指向本项目 `https://github.com/gfyuye/reader-rust-cf`。

---

## 六、 在线书源解析与抓取引擎

为确保第三方小说源（GET / POST 方式、复杂加解密）在 Cloudflare Serverless 环境下全功能运行，构建了全套边缘爬虫与解析引擎。

### 1. 动态时间戳与防盗链验签（`getDynamicHeaders`）
- 自动提取目标域名，自动注入 `Referer: https://${domain}/` 与标准 Chrome 120 浏览器标头，彻底攻克第三方站点（如飞卢小说网）的 Nginx 403 Forbidden 防盗链拦截；
- 自动识别 Legado 的 `@js:` 动态签名头（如“小小阅读”），在边缘实时计算当前秒级时间戳与 MD5 防盗链签名（`sign`, `pt`, `package`, `time`），保证第三方接口鉴权通过。

### 2. 在线目录解析引擎（`parseSourceChapterList`）
- 彻底解决此前网络书源目录接口返回空数组 `data: []` 的根本缺陷；
- **支持 JSON 格式目录**：自动解析 `data.chapters`，并为每个章节自动拼装带有 POST 载荷（`chapterContent,{"body":...}`）的抓取 URL；
- **支持多级解密目录**（如小小阅读）：自动解析详情与多源切换接口，使用 Web Crypto 执行 AES-128-CBC 密文解密，还原真实章节目录；
- **支持 HTML 网页目录与 GBK 智能解码**（如飞卢小说）：
  - 增加智能编码探测（`fetchTextWithEncoding`）：自动检测并使用 `gb18030` 解码老牌中文小说站点，彻底解决乱码（`̵...`）；
  - 修复协议相对路径解析：将 `//b.faloo.com` 正确解析为完整绝对 URL；
  - 过滤掉作者专栏、排行榜、月票榜等非章节干扰链接。

### 3. 正文抓取与逆向解密
- 自动解析 Legado 专有带有 POST 载荷的章节 URL（`url,{"body":...}`），以正确 Method 发起请求；
- 支持 JSONPath（如 `$..content`）递归提取；
- 针对采用对称加密的正文内容，自动调用 Web Crypto 逆向解密还原正文纯文本，输出给前端阅读器。

### 4. 书源测试与自动“失效”归类
- 补齐 `POST /reader3/testBookSources` 接口，解决 405 报错；
- 标准化测试结果统计结构，修复前台 `NaN` 缺陷，提供实时测试进度提示；
- 经测试失效的书源，服务端自动在 D1 中将其分组追加为 `,失效` 标签，前台可一键筛选并批量删除。

### 5. 搜索增强与严格模式
- **书架已有优先置顶**：搜索时优先实时比对书架已有藏书（`shelfStore.books`），将库内匹配的书籍以“书架已有”标识置顶排列在搜索结果最前列，点击直接接读；
- **“严格模式（书名完全一致）”**：搜索结果栏配备严格模式勾选框，开启后书名必须完全一致才予以呈现，关闭时保留智能模糊搜索。

---

## 七、 完整 RSS 订阅与 WebDAV 备份恢复系统

### 1. RSS 订阅系统
- 服务端补齐全套 RSS 路由：
  - `/reader3/getRssSources` / `/saveRssSources` / `/deleteRssSources`
  - `/reader3/getRssArticles`：支持 POST 载荷传参，流式拉取并使用正则解析 XML RSS/Atom 订阅源，返回符合 Legado 规范的 `{ first: articles, second: null }` 数据格式；
  - `/reader3/getRssContent`：流式代理抓取文章正文 HTML；
- 前端 `RssView.vue` 与 `RssManageView.vue` 文章列表与内容展示恢复顺畅。

### 2. Web Streams 原生流式解压（解决大备份死锁）
- **背压死锁根本解决**：此前在解压大于 64KB 的 ZIP 备份文件（如 1.44MB 的 Legado 备份）时，由于 `writer.write` 阻塞等待下游读取引发了浏览器 Web Streams 背压死锁；现全面升级为非阻塞的并发管道写法：
  ```typescript
  const stream = new Response(data).body!.pipeThrough(new DecompressionStream("deflate-raw"));
  const decompressed = await new Response(stream).arrayBuffer();
  ```
- **解压算法双重兼容**：支持标准 `deflate` 与 `deflate-raw` 双重回退，兼容 7-Zip、WinRAR 及系统原生压缩工具；
- **多版本规范与路径归一化**：备份文件名不区分大小写匹配 `bookShelf.json`、`bookshelf.json`、`rssSources.json`、`rssSource.json`、`backup.json`，自动忽略压缩包内的前置子路径；
- **全量分批切片提交**：对备份中的所有 JSON 数据项（书架、分组、书签、规则、RSS、书源）全部按 50~150 项/批分片提交，杜绝请求体超限或网络超时；
- **快捷入口**：WebDAV 管理器顶部工具栏提供“导入本地备份”按钮，无需先上传 WebDAV，直接从手机或电脑选取本地 `.zip` / `.json` 文件即可一键导入恢复。

---

## 八、 权限体系与 WebDAV 解耦

- **管理密码（SECURE_KEY）按需验证**：从设置抽屉主页面彻底删除管理密码输入块，仅在点击“用户管理”时按需弹出密码验证弹窗，并在用户管理页面增加“退出管理”按钮，随时安全注销管理员身份；
- **解除 WebDAV 权限过度依赖**：移除了对管理员授权态的强绑定，只要用户开通了 WebDAV 权限（`userInfo.enableWebdav === 1`），普通用户登录后即可直接进入 WebDAV 文件管理。

---

## 九、 本地开发与生产接口实时调试指南

### 1. 前端本地开发
```bash
cd frontend
npm install
npm run dev
# 访问 http://localhost:5173
```

### 2. 生产环境接口直接调用调试（无需在浏览器反复点击）
使用部署域名与登录授权 Token，可在本地终端直接使用 `curl` 调试 Cloudflare Pages 上的实时后端接口：

- **测试获取章节目录（`getChapterList`）**：
  ```bash
  curl -X POST https://readsomething.pages.dev/reader3/getChapterList \
    -H "Content-Type: application/json" \
    -H "Authorization: <YOUR_USER_TOKEN>" \
    -d '{
      "bookUrl": "http://119.45.176.116:5006/findChapterList?book_id=9294",
      "bookSourceUrl": "http://119.45.176.116:5006",
      "name": "我带系统去修仙"
    }'
  ```

- **测试获取章节正文（`getBookContent`）**：
  ```bash
  curl -X POST https://readsomething.pages.dev/reader3/getBookContent \
    -H "Content-Type: application/json" \
    -H "Authorization: <YOUR_USER_TOKEN>" \
    -d '{
      "chapterUrl": "http://119.45.176.116:5006/chapterContent,{\"body\":{\"book_id\":9294,\"chapterIdList\":\"955340,\"},\"method\":\"POST\"}",
      "bookSourceUrl": "http://119.45.176.116:5006"
    }'
  ```

- **测试书源连通性（`testBookSources`）**：
  ```bash
  curl -X POST https://readsomething.pages.dev/reader3/testBookSources \
    -H "Content-Type: application/json" \
    -H "Authorization: <YOUR_USER_TOKEN>" \
    -d '{
      "bookSourceUrls": ["https://s.chuangke.tv"],
      "keyword": "剑来"
    }'
  ```

### 3. 执行 D1 数据库本地与远程初始化
```bash
# 本地测试环境
npx wrangler d1 execute reader-db --local --file=migrations/d1_schema.sql

# 生产环境
npx wrangler d1 execute reader-db --remote --file=migrations/d1_schema.sql
```
