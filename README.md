# Reader-Rust (Cloudflare Serverless 版)

基于开源“阅读 3.0”（Legado）生态规范重构的云原生在线阅读与书源解析服务。已完成面向 **Cloudflare Pages / Workers 免费版** 的纯无服务器（Serverless）全栈架构改造，零服务器开销、支持多端秒级双向同步、四大电子书格式切片流式秒开与 AI 伴读。

[![License: AGPL v3](https://img.shields.io/badge/License-AGPL_v3-blue.svg)](https://www.gnu.org/licenses/agpl-3.0)
[![Cloudflare Pages](https://img.shields.io/badge/Deploy-Cloudflare_Pages-orange.svg)](https://pages.cloudflare.com/)
[![Cloudflare Workers](https://img.shields.io/badge/Edge-Cloudflare_Workers-blue.svg)](https://workers.cloudflare.com/)

---

## ⚠️ 免责声明

本项目仅提供书源管理、内容解析、阅读与缓存等技术能力，不内置、存储、分发或提供任何受版权保护的书籍内容。用户应确保自行添加的书源、上传的本地文件以及通过本服务访问的内容均已获得合法授权，并自行承担由此产生的版权与合规责任。

如任何权利人认为本项目相关内容或使用方式侵犯了其合法权益，请通过项目 Issues 联系维护者，我们将在核实后及时处理。

---

> **项目致谢与重构声明**：  
> 本项目在 [givenge/reader-rust](https://github.com/givenge/reader-rust) 基础上进行了完全重构，深入对齐 Cloudflare Pages / Workers 免费版运行规范，完成了数据层（D1）、存储层（R2）、异步队列（Queues）、无头浏览器（Kitesurf）、多格式零内存切片流式读取与异地容灾同步的云原生改造。

---

## 🌟 核心特性

- **100% 契合 Cloudflare 免费版**：利用 Pages + Functions + D1 + R2 + Queues + Workers AI 组合拳，彻底摆脱传统服务器与常驻进程，零成本永久运行。
- **全格式电子书流式切片秒开**：
  - **EPUB**：仅通过 Range 读取末尾 64KB 中央目录，利用 Cloudflare Queues 异步队列在 15 秒安全预算内分片索引，毫秒级流式拉取；
  - **PDF**：后端轻量索引总页数与大纲，前端 Mozilla PDF.js 驱动标准 `HTTP 206 Partial Content` 按需拉取单页，不下载全书；
  - **MOBI**：解析 78 字节 PDB 头部与 Record 偏移，通过纯内存 PalmDOC LZ77 算法微秒级解压；
  - **TXT**：自动嗅探 UTF-8 / GB18030 编码，正则扫描章节标题与字节偏移，阅读单章内存消耗恒定在几 KB。
- **爬虫并发智能分块（Scheme 1 客户端驱动）**：
  - 将上百个书源按批次划分为 15 源/块，由前端调度多个边缘 Worker 分布式并行抓取；
  - 完美绕过免费版“单请求最多 50 次子请求”与 10ms CPU 限制，支持实时进度指示与随时停止。
- **动态浏览器渲染（Kitesurf）与自动降级**：
  - 针对带有 `webView: true` 的动态书源，优先调度 Cloudflare 官方轻量无头浏览器 Kitesurf 抽取正文；
  - 遭遇 429 限流时，自动触发冷却至次日 UTC 00:00:00，并无缝旁路切换至备用渲染服务。
- **手机端“阅读 3.0”App 实时双向进度同步**：
  - 手机 App 退出阅读时，通过标准 WebDAV 写入，服务端即时桥接更新 D1 数据库；
  - 电脑 Web 端刷新即显最新进度；Web 端读完翻页，手机 App 再次打开自动跳至最新章节。
- **第三方 WebDAV 异地容灾备份**：
  - 支持配置坚果云、Nextcloud 或群晖等外部云盘；
  - 提供数据变动自动同步（带 30s 防抖）与每 5 分钟定时同步；
  - **1:1 镜像个人资产目录（必要时可直接替代本地 R2）**，并额外生成符合阅读 3.0 规范的标准全量资产 ZIP。
- **双轨 AI 伴读与世界观图谱**：
  - 原生直通 **Cloudflare Workers AI**（平台赠送每日 10,000 神经元算力，Qwen 1.5 总结 + Flux 绘图）；
  - 完整保留 OpenAI 兼容中继网关，可自由配置 DeepSeek、Kimi、通义千问等外部大模型。

---

## 🛠️ 开放端口说明

| 运行环境 | 端口 | 协议 | 说明 |
| :--- | :---: | :---: | :--- |
| **Cloudflare Pages / Workers (生产环境)** | **`443`** | HTTPS | 全球 Anycast CDN 边缘接收入口，自动配置免费 SSL 证书 |
| **Cloudflare Pages / Workers (生产环境)** | **`80`** | HTTP | 自动 301 重定向至 443 HTTPS 安全通道 |
| **本地 Rust 原生后端 (`cargo run`)** | **`8080`** | HTTP | 本地独立服务默认监听端口（可通过环境变量 `SERVER_PORT` 自定义） |
| **本地前端开发服务 (`npm run dev`)** | **`5173`** | HTTP | Vite 默认热更新开发服务器 |

---

## 🔐 环境变量与配置字典（`wrangler.toml` 默认全量添加）

所有可选环境变量均已直接在项目根目录的 **`wrangler.toml`** 的 `[vars]` 节点中**默认完整定义与自动导入**。在 Cloudflare Pages / Workers 部署时，系统会自动完成全量环境变量的读取与注入：

| 变量名称 (Key) | 变量类型 | `wrangler.toml` 默认值 | 功能说明 |
| :--- | :---: | :---: | :--- |
| **`CF_ACCOUNT_ID`** | **加密密钥 (Secret)** | `""` | Cloudflare 账户 ID（用于调用 Kitesurf 无头浏览器 API） |
| **`CF_API_TOKEN`** | **加密密钥 (Secret)** | `""` | 具备 `Browser Rendering - Edit` 权限的 API Token |
| **`SECURE_KEY`** | **加密密钥 (Secret)** | `""` | 管理员特权密钥（配置后可携带 `X-Secure-Key` 头直接执行管理） |
| **`REMOTE_WEBVIEW_API`** | **加密密钥 (Secret)** | `""` | 备用第三方渲染节点地址（Kitesurf 429 冷却时全量接管） |
| **`REMOTE_WEBVIEW_API_KEY`** | **加密密钥 (Secret)** | `""` | 备用渲染服务的认证密钥 |
| **`INVITE_CODE`** | **加密密钥 (Secret)** | `""` | 新用户注册邀请码（留空则不设注册门槛） |
| **`CF_KITESURF_ENDPOINT`** | 普通变量 (Var) | `""` | 自定义 Kitesurf 代理或内网调用端点 |
| **`CF_KITESURF_ENABLED`** | 普通变量 (Var) | `"true"` | 是否启用 Cloudflare Kitesurf 动态渲染 |
| **`SECURE`** | 普通变量 (Var) | `"true"` | 是否开启多用户安全模式（系统默认开启） |
| **`USER_LIMIT`** | 普通变量 (Var) | `"50"` | 系统允许注册的最大用户数 |
| **`USER_BOOK_LIMIT`** | 普通变量 (Var) | `"2000"` | 单个用户书架允许存放的最大书籍数量 |
| **`USER_LOCAL_BOOK_LIMIT`** | 普通变量 (Var) | `"0"` | 用户上传本地书籍上限（0 表示不限制） |
| **`LOG_LEVEL`** | 普通变量 (Var) | `"info"` | 边缘运行时日志级别 |
| **`D1_DATABASE_ID`** | 普通变量 (Var) | `"reader-db"` | 绑定的 D1 数据库名称 |
| **`R2_BUCKET_NAME`** | 普通变量 (Var) | `"reader-storage"` | 绑定的 R2 存储桶名称 |
| **`STORAGE_BACKEND`** | 普通变量 (Var) | `"r2"` | 存储后端类型（默认 R2） |
| **`DATABASE_BACKEND`** | 普通变量 (Var) | `"d1"` | 数据库后端类型（默认 D1） |

---

## 🚀 全自动化部署指南（由项目下 Wrangler 统一接管）

所有云端资源（D1 数据库、R2 存储桶、Queues 异步队列、Workers AI 算力与全量环境变量）的创建、绑定及迁移均由项目下的 **Wrangler** 配置全权自动托管。

### 方式 A：推送到 GitHub ──> Cloudflare 控制台一键导入（最推荐）

1. **推送代码至 GitHub**：
   ```bash
   git add .
   git commit -m "feat: automated cloudflare serverless deployment"
   git push origin main
   ```
2. **在 Cloudflare 控制台导入仓库**：
   - 进入 **Workers & Pages** ──> **Create application** ──> **Pages** ──> **Connect to Git**；
   - 选中当前仓库，点击 **Begin setup**；
   - 平台将自动识别根目录 `package.json` 与 `wrangler.toml`：
     - **Build command**: `npm run build`
     - **Build output directory**: `frontend/dist`
   - 点击 **Save and Deploy**。
3. **资源自动创建与绑定**：
   - Cloudflare Pages 将自动依据 `wrangler.toml` 识别并完成 D1（`DB`）、R2（`BUCKET`）、Workers AI（`AI`）与异步队列（`EPUB_QUEUE`）的绑定，并自动注入全量默认环境变量。
   - > **全自动建表说明**：代码已内置自愈初始化引擎，**不需要手动执行任何 SQL 脚本**。部署完成后首次打开网页，系统自动在 5 毫秒内完成所有 17 张数据表、切片索引与触发器的创建！
4. **（可选）设置加密密钥**：
   - 若需配置真实的 `CF_ACCOUNT_ID`、`CF_API_TOKEN` 或 `SECURE_KEY`，可在 Pages 项目的 **Settings** ──> **Environment variables** 中直接添加并勾选 **Encrypt（加密存储为密钥类型）**。

---

### 方式 B：本地命令行一键自动化部署（`npm run deploy`）

如果在本地终端已经登录过 Wrangler，只需一条命令即可完成全套云端资源自动创建与上线：

```bash
# 自动创建 D1 数据库、R2 桶、Queues 队列，执行数据库迁移并一键发布 Pages
npm run deploy
```

---

## 📱 手机端“阅读 3.0”（Legado）App 对接指南

1. 打开手机端“阅读”App ──> 点击 **【我的】** ──> **【备份与恢复】** ──> **【WebDAV 设置】**；
2. 参数填写：
   - **WebDAV 地址**：`https://<你的Pages域名>/reader3/webdav/`（**末尾必须带斜杠 `/`**）
   - **WebDAV 账号**：在网页端注册的用户名（如 `admin`）
   - **WebDAV 密码**：该用户的登录密码
3. 点击 **【测试连接】**，提示“连接成功”即完成绑定；
4. 勾选 **【打开书籍时自动同步进度】** 与 **【退出阅读时自动上传进度】**，即可享受与 Web 网页端全天候双向同步体验。

---

## 📂 项目结构指南

```text
reader-rust/
├── frontend/                     # Vue 3.5 + Vite + TypeScript 前端工程
│   ├── src/components/           # 界面组件 (包含新增的 WebDAV 文件管理与 AI 伴读抽屉)
│   ├── src/utils/zip.ts          # 纯 Web 标准编写的零依赖 PKZIP 编解码引擎
│   └── public/_redirects         # Cloudflare Pages 专用的 SPA 路由重定向规则
├── functions/                    # Cloudflare Pages Functions 边缘服务网关
│   └── [[path]].ts               # 统一路由分发（前端静态资源与后端 Serverless API 无缝合流）
├── worker/                       # 纯无服务器后端实现
│   └── index.ts                  # 全量 D1、R2、Queues、Kitesurf 与流式切片引擎
├── migrations/                   # D1 数据库结构
│   └── d1_schema.sql             # 包含书架、书源、切片索引与异地同步的全量建表脚本
├── src/                          # 原生 Rust 后端核心代码（保留本地容器化运行能力）
│   ├── service/                  # EPUB/PDF/MOBI/TXT 流式切片服务
│   ├── crawler/                  # Kitesurf 无头浏览器请求与网络抓取
│   └── storage/                  # D1 与 R2 的 Rust 客户端
├── wrangler.toml                 # Cloudflare 资源绑定与 5 分钟定时 Cron 配置文件
├── DEVELOPMENT.md                # 详细的技术架构与开发指南文档
└── LICENSE                       # GNU AGPL-3.0 开源许可证
```

---

## 📄 开源许可证 (License)

本项目基于 [GNU Affero General Public License v3.0 (AGPL-3.0)](LICENSE) 协议完全开源。
