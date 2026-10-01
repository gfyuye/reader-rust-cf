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
| **`CF_ACCOUNT_ID`** | **加密密钥 (Secret)** | 留空 | Cloudflare 账户 ID（仅在需要调用 Kitesurf 无头浏览器时可选填写，不填不影响常规阅读） |
| **`CF_API_TOKEN`** | **加密密钥 (Secret)** | 留空 | 具备 `Browser Rendering - Edit` 权限的 API Token（可选） |
| **`SECURE_KEY`** | **加密密钥 (Secret)** | 留空 | 管理员特权密钥（配置后可携带 `X-Secure-Key` 头直接执行管理） |
| **`REMOTE_WEBVIEW_API`** | **加密密钥 (Secret)** | 留空 | 备用第三方渲染节点地址（Kitesurf 429 冷却时全量接管） |
| **`REMOTE_WEBVIEW_API_KEY`** | **加密密钥 (Secret)** | 留空 | 备用渲染服务的认证密钥 |
| **`INVITE_CODE`** | **加密密钥 (Secret)** | 留空 | 新用户注册邀请码（留空则不设注册门槛） |
| **`CF_KITESURF_ENDPOINT`** | 普通变量 (Var) | 留空 | 自定义 Kitesurf 代理或内网调用端点（无需自行设置，默认留空即可） |
| **`CF_KITESURF_ENABLED`** | 普通变量 (Var) | `"true"` | 是否启用 Cloudflare Kitesurf 动态渲染 |
| **`SECURE`** | 普通变量 (Var) | `"true"` | 是否开启多用户安全模式（系统默认开启） |
| **`USER_LIMIT`** | 普通变量 (Var) | `"50"` | 系统允许注册的最大用户数 |
| **`USER_BOOK_LIMIT`** | 普通变量 (Var) | `"2000"` | 单个用户书架允许存放的最大书籍数量 |
| **`USER_LOCAL_BOOK_LIMIT`** | 普通变量 (Var) | `"0"` | 用户上传本地书籍上限（0 表示不限制） |
| **`LOG_LEVEL`** | 普通变量 (Var) | `"info"` | 边缘运行时日志级别 |
| **`R2_BUCKET_NAME`** | 普通变量 (Var) | `"reader-storage"` | R2 存储桶名称标识（生产环境由 Pages 后台绑定的 `BUCKET` 对象驱动） |
| **`STORAGE_BACKEND`** | 普通变量 (Var) | `"r2"` | 存储后端类型（默认 R2） |
| **`DATABASE_BACKEND`** | 普通变量 (Var) | `"d1"` | 数据库后端类型（默认 D1） |

---

## 🚀 Cloudflare Pages 公开仓库安全部署指南（控制台纯 GUI 零泄密部署）

为保障公共 GitHub 仓库的安全性（**不在公开代码中暴露任何私有 D1 数据库 UUID 与个人凭据**），本项目遵循 Cloudflare Pages 官方推荐的控制台安全绑定标准：

### 第一步：在 Cloudflare 控制台创建 D1 与 R2（各点击一次）

1. **创建 D1 数据库**：
   - 控制台左侧菜单 ──> **Storage & Databases** ──> **D1** ──> 点击 **Create database** ──> 输入名称 **`reader-db`** ──> 点击 **Create**；
   - 点击进入 `reader-db` ──> 切换到 **Console** 面板，将项目中的 `migrations/d1_schema.sql` 纯净建表脚本贴入并点击 **Execute** 执行建表。
2. **创建 R2 存储桶**：
   - 控制台左侧菜单 ──> **Storage & Databases** ──> **R2** ──> 点击 **Create bucket** ──> 输入名称 **`reader-storage`** ──> 点击 **Create bucket**。

---

### 第二步：导入 GitHub 仓库部署 Pages

1. 登录 Cloudflare 控制台 ──> 点击左侧 **Workers & Pages** ──> 点击 **Create application** ──> 点击 **Connect to Git**（或通过经典 Pages 导入）；
2. 选中你的 GitHub 仓库（`reader-rust-cf`），点击 **Begin setup**；
3. **构建参数自动识别**（已由根目录 `vite.config.ts` 自动预填）：
   - **Framework preset**: `Vite`
   - **Build command**: `npm run build`
   - **Build output directory**: `dist`
4. 点击 **Save and Deploy** 完成初次编译发布。

---

### 第三步：在 Pages 控制台一键绑定（控制台已解锁，直接下拉选择）

首次部署完成后，进入该 Pages 项目的 **Settings**（设置）页面：

1. **绑定 D1 数据库**：
   - 进入 **Settings** ──> **Functions** ──> 找到 **D1 database bindings**；
   - 点击 **Add binding**：
     - **Variable name（变量名）**：严格填写 **`DB`**
     - **D1 database**：在下拉菜单中直接选中 **`reader-db`**（平台自动安全关联，无泄密风险）
2. **绑定 R2 存储桶**：
   - 在同一页面的 **R2 bucket bindings** ──> 点击 **Add binding**：
     - **Variable name（变量名）**：严格填写 **`BUCKET`**
     - **R2 bucket**：在下拉菜单中直接选中 **`reader-storage`**
3. **绑定 Workers AI 算力**：
   - 在同一页面的 **Workers AI bindings** ──> 点击 **Add binding**：
     - **Variable name（变量名）**：严格填写 **`AI`**
4. **导入可选加密密钥（Secrets）**：
   - 切换到 **Settings** ──> **Environment variables**，点击 **Add variable** 填入你的密钥（如 `CF_ACCOUNT_ID`、`CF_API_TOKEN`、`SECURE_KEY` 等），勾选 **Encrypt（加密存储）**。
5. **重新部署生效**：
   切换到 **Deployments** 页面，点击最新构建记录右侧的三个点 ──> 选择 **Retry deployment**。部署完成后全站正式在全球边缘网络上线运行！

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
