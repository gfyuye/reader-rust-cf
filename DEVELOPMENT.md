# Reader-Rust 完整开发与技术架构文档

本文档全面记录 `reader-rust` 的系统架构、设计原则、数据协议、模块分层以及在 Cloudflare Serverless 生态下的完整技术实现。

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
│  - 边缘服务网关: Functions (functions/[[path]].ts) 统一捕获 /reader3/* API 请求                                  │
│  - 核心计算引擎: worker/index.ts                                                                                  │
│    ├── 用户认证与权限管理 (多用户隔离, 密码双重加盐哈希, Session Token 校验)                                       │
│    ├── 书源管理与分块并发搜索 (Scheme 1: 客户端驱动分块调度, 单次严格控制在 ≤ 15 源)                               │
│    ├── 零内存占用电子书切片引擎 (EPUB, PDF, MOBI, TXT)                                                            │
│    ├── 双轨 WebDAV 桥接 (针对 Legado App 的实时双向进度对齐)                                                      │
│    ├── 异地 WebDAV 容灾同步引擎 (1:1 镜像用户资产目录 + 额外打包 Legado 标准 ZIP)                                 │
│    └── 双轨 AI 伴读网关 (Cloudflare Workers AI 免费 GPU 推理 + 外部第三方商用模型中继)                            │
└──────────────────┬──────────────────────┬──────────────────────┬──────────────────────────┬───────────────────────┘
                   │                      │                      │                          │
                   ▼                      ▼                      ▼                          ▼
         ┌───────────────────┐  ┌───────────────────┐  ┌───────────────────┐      ┌───────────────────┐
         │  Cloudflare D1    │  │  Cloudflare R2    │  │ Cloudflare Queues │      │ Workers AI / 渲染 │
         │  (Serverless SQL) │  │  (对象存储桶)     │  │ (异步消息队列)    │      │ (GPU 算力引擎)    │
         │                   │  │                   │  │                   │      │                   │
         │ - 书源配置        │  │ - 电子书原件      │  │ - 超大 EPUB 分片  │      │ - Qwen 1.5 伴读   │
         │ - 用户与凭据      │  │   (EPUB/PDF/MOBI) │  │   流式索引解析    │      │ - Flux 场景插画   │
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
| **`users`** | `username`, `password`, `salt`, `enable_webdav`, `is_admin` | 用户账号、加盐哈希密码与权限 |
| **`user_sessions`** | `username`, `token`, `expire_at` | 登录会话令牌（30 天有效期） |
| **`book_sources`** | `user_ns`, `book_source_url`, `book_source_name`, `json`, `updated_at` | 用户专属的书源解析规则库 |
| **`json_documents`** | `namespace`, `name`, `json`, `updated_at` | 书架（bookshelf）、分组、书签、净化规则与配置文档 |
| **`ai_book_memories`**| `user_ns`, `book_key`, `book_url`, `json`, `updated_at` | AI 伴读抽取的世界观、人物拓扑图谱与时间线 |
| **`txt_books`** | `book_id`, `user_ns`, `r2_key`, `file_size`, `total_chapters`, `title` | 本地 TXT 小说元数据主表 |
| **`txt_chapters`** | `book_id`, `chapter_index`, `title`, `byte_offset`, `byte_length` | TXT 各章节在全文中的字节切片索引 |
| **`epub_books`** | `book_id`, `user_ns`, `r2_key`, `status`, `total_chapters`, `parsed_chapters` | EPUB 电子书主表及分片解析进度 |
| **`epub_chapters`** | `book_id`, `chapter_index`, `title`, `byte_offset`, `byte_length`, `compression_method` | EPUB 章节在 ZIP 归档中的绝对字节偏移与压缩算法 |
| **`epub_parse_checkpoints`** | `book_id`, `last_processed_index`, `spine_json`, `updated_at` | 队列分片解析的挂钟时间中断断点 |
| **`pdf_books`** | `book_id`, `user_ns`, `r2_key`, `file_size`, `total_pages`, `title`, `author` | PDF 书籍元数据与总页数主表 |
| **`pdf_outlines`** | `book_id`, `title`, `dest_page`, `level` | PDF 目录大纲树（用于侧边抽屉秒级打开） |
| **`mobi_books`** | `book_id`, `user_ns`, `r2_key`, `file_size`, `total_chapters`, `compression` | MOBI / PalmDOC 电子书元数据 |
| **`mobi_chapters`** | `book_id`, `chapter_index`, `title`, `byte_offset`, `byte_length`, `compression` | MOBI 文本 Record 切片偏移索引 |
| **`user_remote_webdav`** | `username`, `enabled`, `server_url`, `webdav_user`, `sync_on_change`, `last_sync_at` | 远端 WebDAV 异地容灾同步配置与执行日志 |

---

## 三、 四大本地电子书零内存流式切片架构

为了彻底解决传统服务端“把几十 MB 电子书读入内存再切片”引发的 128MB 内存溢出（OOM）与 10ms CPU 超时问题，全格式均改用 **“导入时轻量索引 + 阅读时 R2 Range 微切片提取”** 架构。

### 1. EPUB 电子书：ZIP 中央目录流式解析与 Queues 异步队列
- **上传阶段**：直接将原始 EPUB 写入 R2；
- **索引阶段**：仅通过 Range 请求拉取文件末尾 64KB（`Range: bytes=-65536`），定位 ZIP EOCD 与中央目录，解析 `container.xml` 与 `content.opf`，提取总章节数并存入 D1；
- **分片队列（Queues）**：
  - 投递消息至 `epub-indexing-queue`；
  - 消费者每次处理一批章节，监测 `Date.now() - startTime >= 15000`（15 秒预算限制）；
  - 临近限额时保存当前断点到 `epub_parse_checkpoints` 并重发队列消息继续，任务完成标记 `status = 'ready'`；
- **阅读阶段**：前端请求第 N 节，Worker 查 D1 得到 `(byte_offset, byte_length, compression_method)`，向 R2 请求仅 20KB 切片，若为 Deflate 格式则在内存中毫秒级解压，流式输出 HTML。

### 2. PDF 文档：Mozilla PDF.js 客户端驱动 Range 206 流式拉取
- **上传阶段**：流式写入 R2；尾部 Range 读取 64KB，定位 `/Pages` 树提取 `/Count` 总页数，提取 `/Info` 字典提取书名与作者，存入 `pdf_books`；
- **目录秒开**：通过 `/reader3/pdf/toc` 直接查询 D1 渲染侧边栏大纲，无需等待前端 PDF.js 解析整个对象树；
- **阅读阶段**：前端 PDF.js 开启 `disableAutoFetch: true` 与 `disableRange: false`，仅根据视口向 `/reader3/pdf/stream` 发起对应页码的 Range 请求；Worker 返回标准的 `HTTP 206 Partial Content`，携带 `Content-Range` 与 `Accept-Ranges: bytes`。

### 3. MOBI 电子书：PalmDOC 边缘轻量拆解
- **上传阶段**：读取前 16KB，解析 PDB 78 字节头部与各 Record 绝对偏移量表，解析 Record 0 提取 PalmDOC 压缩格式与总分片数，批量将切片偏移写入 D1 `mobi_chapters`；
- **阅读阶段**：纯 Range 请求提取单个 2KB~4KB 的 Record 切片，使用纯内存编写的 PalmDOC LZ77 算法在 **0.05 毫秒** 内解压输出纯净 HTML/Text。

### 4. TXT 纯文本小说：编码嗅探与标题偏移索引
- **上传阶段**：自动嗅探 UTF-8 BOM、标准 UTF-8 以及中文常见的 GB18030/GBK 编码并统一转码为标准 UTF-8；正则扫描章节标题（`第X章`、`Chapter X`、`序章` 等），精确计算每个章节对应的 UTF-8 字节起始偏移 `byte_offset` 与长度存入 D1 `txt_chapters`；
- **阅读阶段**：用户阅读任意章节，向 R2 发起 Range 请求拉取该章节的局部切片，内存占用恒定在几 KB，与整书文件大小（哪怕 50MB）完全解耦。

---

## 四、 爬虫与书源并发治理架构（方案 1：客户端驱动分批并发）

### 1. 痛点与约束
- Cloudflare Workers 免费版**限制单次请求内最多发出 50 次子请求（`fetch()`）**，且 CPU 限制 10ms；
- 若单个搜索请求同时并发 200 个书源，必将直接触发 `Too many subrequests` 崩溃。

### 2. 治理方案实现（Client-Driven Chunking）
- **前端分块引擎（`frontend/src/components/SearchResults.vue`）**：
  - 自动将全量启用的书源划分为 `CHUNK_SIZE = 15` 的微批次；
  - 维护一个最大并行度 `MAX_PARALLEL = 3` 的并发工作池，同时发出 3 个独立的 Worker 请求；
  - 搜索结果实时动态合流至书架展示，提供实时进度指示器（`已搜 45/150 源 · 18 结果`）；
  - 配备 **【停止搜索】** 按钮，利用 `AbortController` 支持用户随时中断剩余在途请求。
- **后端配额安全网关（`worker/index.ts: handleSearchBookMulti`）**：
  - 单次强制截断最多处理 `MAX_CHUNK_SOURCES = 20` 个源；
  - 子请求数恒定在 20 以下，完全在 50 次安全线内；
  - 耗时在不同边缘节点分布式并行，实测响应时间比传统单机 VPS 提升 300%。

### 3. Kitesurf 动态渲染与自动熔断
- 书源 URL 带有 `,"webView": true` 时，优先向 Cloudflare 官方轻量无头浏览器 Kitesurf（`/browser-run/content?browser=kitesurf`）发送请求；
- 遭遇 `429 Too Many Requests` 或免费时长超限时，调度器自动触发冷却至次日 UTC 00:00:00，当前失败请求与冷却期内的后续请求**无缝旁路分流至备用 `REMOTE_WEBVIEW_API`**。

---

## 五、 双轨 WebDAV 与异地容灾备份体系

### 1. 移动端 App 实时双向进度对齐（WebDAV to D1 Bridge）
- 手机端“阅读 3.0”App 将 WebDAV 地址配置为 `https://<DOMAIN>/reader3/webdav/`；
- 手机端退出阅读时向 `/reader3/webdav/bookshelf.json` 发起 `PUT` 请求；
- 服务端在写入 R2 的同时，**实时解码 JSON 并原子更新 D1 数据库的 `json_documents` 表**；
- 电脑 Web 端刷新即刻展示手机端最新进度；Web 端读完翻页亦同步反射回 WebDAV，手机端再次打开自动跳至最新章节。

### 2. 远端 WebDAV 异地容灾备份（双轨策略）
在用户设置中配置第三方 WebDAV 云盘（坚果云 / Nextcloud / 群晖 NAS）后，提供两种自动触发渠道：
- **数据变动时同步（`triggerOnChangeSync`）**：书架、进度、书源变动时后台通过 `ctx.waitUntil` 异步触发（内置 30 秒防抖，不阻塞 API 响应）；
- **定时自动同步（`scheduled`）**：由 Cloudflare Cron 触发器每 5 分钟在后台唤醒 Worker 自动推进；
- **同步数据双轨内容**：
  1. **1:1 目录镜像**：完全镜像用户的 `data/`、`assets/`、`epubs/`、`pdfs/`、`mobis/`、`txts/`、`webdav/` 目录树；
  2. **R2 容灾接管**：当本地 R2 存储缺失某个书籍切片时，后端**自动通过 Range 请求向远端 WebDAV 获取对应字节切片**，实现远端完全替代本地 R2；
  3. **独立全量资产 ZIP 归档**：额外将全量书架、全量书源规则、分类分组、净化脚本与书签打包为标准的 `backups/backup-{user}-latest.zip`（对齐手机 App 恢复规范）。

---

## 六、 双轨 AI 伴读与模型中继系统

前端通过 `AiBookView.vue` 提供全套阅读 AI 伴读交互，后端通过统一的 `handleAiProxy` 抹平底差异：

1. **Cloudflare Workers AI 原生算力**：
   - 绑定 `[ai] binding = "AI"`；
   - 文本与剧情总结使用 `@cf/qwen/qwen1.5-7b-chat`，支持真实打字机流式输出；
   - 世界观地图与插画生成使用 `@cf/black-forest-labs/flux-1-schnell`，生成的图片自动持久化存入 R2 `assets/{userNs}/ai-images/`；
   - 读者免自备 API Key，0 费用使用平台每日赠送的 10,000 Neurons 算力。
2. **外部第三方商用模型中继**：
   - 完整保留 OpenAI 兼容协议（支持配置 DeepSeek、OpenAI、Kimi、通义千问等外部端点）；
   - 内置 `isSafeRemoteUrl` 安全网关，杜绝针对内网和云厂商元数据的 SSRF 漏洞。

---

## 七、 本地开发与调试流程

### 1. 前端本地开发
```bash
cd frontend
npm install
npm run dev
# 访问 http://localhost:5173
```

### 2. 边缘 Worker 本地模拟测试（Wrangler）
```bash
# 启动本地 D1、R2 与 Worker 模拟运行时
npx wrangler dev
```

### 3. 执行 D1 数据库本地与远程初始化
```bash
# 本地测试环境
npx wrangler d1 execute reader-db --local --file=migrations/d1_schema.sql

# 生产环境
npx wrangler d1 execute reader-db --remote --file=migrations/d1_schema.sql
```
