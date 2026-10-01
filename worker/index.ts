/**
 * Cloudflare Worker Backend for reader-rust
 * Full Serverless implementation on Cloudflare Edge:
 * - D1 Database: Users, Sessions, Book Sources, Bookmarks, Replace Rules, AI Memory, EPUB/PDF/MOBI Index
 * - R2 Object Storage: EPUB, PDF, MOBI, Uploaded Assets, Book Covers
 * - Cloudflare Queues: Chunked EPUB parsing under free tier time budget
 * - Kitesurf Browser Rendering: Dynamic JavaScript crawling with 429 cooldown & fallback
 * - Zero-parse Range streaming: EPUB, PDF (206 Partial Content), MOBI
 */

export interface Env {
  DB: D1Database;
  BUCKET: R2Bucket;
  EPUB_QUEUE?: any;
  ASSETS?: any; // Cloudflare Worker Static Assets Binding
  AI?: any; // Cloudflare Workers AI Binding
  CF_ACCOUNT_ID?: string;
  CF_API_TOKEN?: string;
  CF_KITESURF_ENABLED?: string;
  REMOTE_WEBVIEW_API?: string;
  REMOTE_WEBVIEW_API_KEY?: string;
  SECURE?: string;
  SECURE_KEY?: string;
  INVITE_CODE?: string;
}

export interface EpubQueueMessage {
  bookId: string;
  userNs: string;
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    // 0. Handle CORS Preflight
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: corsHeaders(),
      });
    }

    const url = new URL(request.url);
    const path = url.pathname;

    try {
      // 1. User Authentication & Profile
      if (path === "/reader3/login" && request.method === "POST") {
        return handleLogin(request, env);
      }
      if (path === "/reader3/logout" && request.method === "POST") {
        return handleLogout(request, env);
      }
      if (path === "/reader3/getUserInfo" && request.method === "GET") {
        return handleGetUserInfo(request, env);
      }

      // 2. Book Sources (书源管理 - D1)
      if (path === "/reader3/getBookSources") {
        return handleGetBookSources(request, env);
      }
      if (path === "/reader3/getBookSource") {
        return handleGetBookSource(request, env);
      }
      if (path === "/reader3/saveBookSource" && request.method === "POST") {
        return handleSaveBookSource(request, env, ctx);
      }
      if (path === "/reader3/saveBookSources" && request.method === "POST") {
        return handleSaveBookSources(request, env, ctx);
      }
      if (path === "/reader3/deleteBookSource" && request.method === "POST") {
        return handleDeleteBookSource(request, env, ctx);
      }
      if (path === "/reader3/deleteBookSources" && request.method === "POST") {
        return handleDeleteBookSources(request, env, ctx);
      }
      if (path === "/reader3/deleteAllBookSources" && request.method === "POST") {
        return handleDeleteAllBookSources(request, env, ctx);
      }
      if (path === "/reader3/readRemoteSourceFile" && request.method === "POST") {
        return handleReadRemoteSourceFile(request, env);
      }

      // Multi-Source Search (Client-Driven Chunking / Scheme 1)
      if (path === "/reader3/searchBookMulti" && request.method === "POST") {
        return handleSearchBookMulti(request, env);
      }

      // 3. Bookshelf & Reading Progress (书架与进度 - D1)
      if (path === "/reader3/getBookshelf" && request.method === "GET") {
        return handleGetBookshelf(request, env);
      }
      if (path === "/reader3/saveBook" && request.method === "POST") {
        return handleSaveBook(request, env, ctx);
      }
      if (path === "/reader3/saveBooks" && request.method === "POST") {
        return handleSaveBooks(request, env, ctx);
      }
      if (path === "/reader3/deleteBook" && request.method === "POST") {
        return handleDeleteBook(request, env, ctx);
      }
      if (path === "/reader3/deleteBooks" && request.method === "POST") {
        return handleDeleteBooks(request, env, ctx);
      }
      if (path === "/reader3/saveBookProgress" && request.method === "POST") {
        return handleSaveBookProgress(request, env, ctx);
      }
      if (path === "/reader3/getShelfBook") {
        return handleGetShelfBook(request, env);
      }
      if (path === "/reader3/getBookInfo") {
        return handleGetBookInfo(request, env);
      }
      if (path === "/reader3/getChapterList") {
        return handleGetChapterList(request, env);
      }
      if (path === "/reader3/saveBookGroupId" && request.method === "POST") {
        return handleSaveBookGroupId(request, env, ctx);
      }

      // 4. Chapter Content Router (EPUB, PDF, MOBI, Web)
      if (path === "/reader3/getBookContent") {
        return handleGetBookContent(request, env);
      }

      // 5. Document Management: Bookmarks, ReplaceRules, BookGroups
      if (path === "/reader3/getBookmarks") return handleGetDocument(request, env, "bookmark.json");
      if (path === "/reader3/saveBookmark" && request.method === "POST") return handleSaveDocumentItem(request, env, "bookmark.json", ctx);
      if (path === "/reader3/deleteBookmark" && request.method === "POST") return handleDeleteDocumentItem(request, env, "bookmark.json", ctx);

      if (path === "/reader3/getReplaceRules") return handleGetDocument(request, env, "replaceRule.json");
      if (path === "/reader3/saveReplaceRule" && request.method === "POST") return handleSaveDocumentItem(request, env, "replaceRule.json", ctx);
      if (path === "/reader3/deleteReplaceRule" && request.method === "POST") return handleDeleteDocumentItem(request, env, "replaceRule.json", ctx);

      if (path === "/reader3/getBookGroups") return handleGetDocument(request, env, "bookGroup.json");
      if (path === "/reader3/saveBookGroup" && request.method === "POST") return handleSaveDocumentItem(request, env, "bookGroup.json", ctx);
      if (path === "/reader3/deleteBookGroup" && request.method === "POST") return handleDeleteDocumentItem(request, env, "bookGroup.json", ctx);

      // 6. EPUB Streaming & Indexing
      if (path === "/reader3/epub/upload" && request.method === "POST") return handleEpubUpload(request, env);
      if (path === "/reader3/epub/read" && request.method === "GET") {
        const bookId = url.searchParams.get("bookId") || "";
        const pageIndex = parseInt(url.searchParams.get("page") || "0", 10);
        return handleEpubRead(bookId, pageIndex, env);
      }
      if (path === "/reader3/epub/status" && request.method === "GET") {
        return handleEpubStatus(url.searchParams.get("bookId") || "", env);
      }

      // 7. PDF Streaming & TOC
      if (path === "/reader3/pdf/upload" && request.method === "POST") return handlePdfUpload(request, env);
      if (path === "/reader3/pdf/stream" && request.method === "GET") return handlePdfStream(request, env);
      if (path === "/reader3/pdf/info" && request.method === "GET") return handlePdfInfo(url.searchParams.get("bookId") || "", env);
      if (path === "/reader3/pdf/toc" && request.method === "GET") return handlePdfToc(url.searchParams.get("bookId") || "", env);

      // 8. MOBI Streaming
      if (path === "/reader3/mobi/upload" && request.method === "POST") return handleMobiUpload(request, env);
      if (path === "/reader3/mobi/read" && request.method === "GET") {
        const bookId = url.searchParams.get("bookId") || "";
        const pageIndex = parseInt(url.searchParams.get("page") || "0", 10);
        return handleMobiRead(bookId, pageIndex, env);
      }
      if (path === "/reader3/mobi/info" && request.method === "GET") return handleMobiInfo(url.searchParams.get("bookId") || "", env);

      // 9. TXT Streaming & Heading Indexing
      if ((path === "/reader3/txt/upload" || path === "/reader3/uploadLocalBook") && request.method === "POST") {
        return handleTxtUpload(request, env, ctx);
      }
      if (path === "/reader3/txt/read" && request.method === "GET") {
        const bookId = url.searchParams.get("bookId") || "";
        const chapterIndex = parseInt(url.searchParams.get("index") || "0", 10);
        return handleTxtRead(bookId, chapterIndex, env);
      }
      if (path === "/reader3/txt/info" && request.method === "GET") {
        return handleTxtInfo(url.searchParams.get("bookId") || "", env);
      }

      // 10. Assets & Covers (R2)
      if (path === "/reader3/uploadFile" && request.method === "POST") return handleUploadFile(request, env);
      if (path === "/reader3/deleteFile" && request.method === "POST") return handleDeleteFile(request, env);
      if (path.startsWith("/assets/") || path === "/reader3/cover") return handleGetAsset(request, env);

      // 10. WebDAV Protocol & REST APIs (for Web & App)
      if (path.startsWith("/reader3/webdav")) return handleWebdav(request, env);
      if (path === "/reader3/getWebdavFileList" && request.method === "GET") return handleGetWebdavFileList(request, env);
      if (path === "/reader3/getWebdavFile" && request.method === "GET") return handleGetWebdavFile(request, env);
      if (path === "/reader3/uploadFileToWebdav" && request.method === "POST") return handleUploadFileToWebdav(request, env);
      if (path === "/reader3/deleteWebdavFile" && request.method === "POST") return handleDeleteWebdavFile(request, env);
      if (path === "/reader3/deleteWebdavFileList" && request.method === "POST") return handleDeleteWebdavFileList(request, env);

      // User Management
      if (path === "/reader3/changePassword" && request.method === "POST") return handleChangePassword(request, env);
      if (path === "/reader3/getUserList") return handleGetUserList(request, env);
      if (path === "/reader3/addUser" && request.method === "POST") return handleAddUser(request, env);
      if (path === "/reader3/updateUser" && request.method === "POST") return handleUpdateUser(request, env);
      if (path === "/reader3/deleteUsers" && request.method === "POST") return handleDeleteUsers(request, env);
      if (path === "/reader3/resetPassword" && request.method === "POST") return handleResetPassword(request, env);

      // 11. Remote WebDAV Sync Configuration & Actions
      if (path === "/reader3/user/remoteWebdav" && request.method === "GET") {
        return handleGetRemoteWebdav(request, env);
      }
      if (path === "/reader3/user/remoteWebdav" && request.method === "POST") {
        return handleSaveRemoteWebdav(request, env);
      }
      if (path === "/reader3/user/remoteWebdav/test" && request.method === "POST") {
        return handleTestRemoteWebdav(request, env);
      }
      if (path === "/reader3/user/remoteWebdav/syncNow" && request.method === "POST") {
        return handleSyncRemoteWebdavNow(request, env);
      }

      // 12. AI Companion & Reading Assistant (D1 + LLM Proxy)
      if (path === "/reader3/getAiBookMemory") return handleGetAiBookMemory(request, env);
      if (path === "/reader3/saveAiBookMemory" && request.method === "POST") return handleSaveAiBookMemory(request, env);
      if (path === "/reader3/deleteAiBookMemory" && request.method === "POST") return handleDeleteAiBookMemory(request, env);
      if (path === "/reader3/getAiModelConfig") return handleGetDocument(request, env, "ai-model-config.json");
      if (path === "/reader3/saveAiModelConfig" && request.method === "POST") return handleSaveDocumentItem(request, env, "ai-model-config.json", ctx);
      if (path === "/reader3/aiProxy" && request.method === "POST") return handleAiProxy(request, env);
      if (path === "/reader3/aiProxyImage" && request.method === "POST") return handleAiProxyImage(request, env);

      // Health check
      if (path === "/health") {
        return jsonResponse({ status: "ok", service: "reader-rust-cloudflare-worker" });
      }

      // Fallback to static assets if binding exists
      if (env.ASSETS) {
        return env.ASSETS.fetch(request);
      }

      return jsonResponse({ isSuccess: false, errorMsg: "接口未找到" }, 404);
    } catch (err: any) {
      return jsonResponse({ isSuccess: false, errorMsg: err.message || "服务器内部错误" }, 500);
    }
  },
};

// ==========================================
// 1. User Authentication & Sessions (D1)
// ==========================================

async function handleLogin(request: Request, env: Env): Promise<Response> {
  const body = await request.json<any>();
  const { username, password, isLogin, code } = body;

  if (!username || !password) {
    return jsonResponse({ isSuccess: false, errorMsg: "用户名和密码不能为空" });
  }

  const existing = await env.DB.prepare(
    `SELECT username, password, salt, token, is_admin FROM users WHERE username = ?1`
  )
    .bind(username)
    .first<{ username: string; password: string; salt: string; token: string; is_admin: number }>();

  if (existing) {
    if (!isLogin) {
      return jsonResponse({ isSuccess: false, errorMsg: "用户名已被占用" });
    }
    const encrypted = genEncryptedPassword(password, existing.salt);
    if (encrypted !== existing.password) {
      return jsonResponse({ isSuccess: false, errorMsg: "密码错误" });
    }

    const token = generateSessionToken(username);
    const expireAt = Math.floor(Date.now() / 1000) + 30 * 86400; // 30 days
    await env.DB.prepare(
      `INSERT INTO user_sessions (username, token, expire_at) VALUES (?1, ?2, ?3)`
    )
      .bind(username, token, expireAt)
      .run();

    return jsonResponse({
      isSuccess: true,
      data: {
        username,
        accessToken: `${username}:${token}`,
        isAdmin: existing.is_admin === 1,
      },
    });
  }

  // Register new user
  if (isLogin) {
    return jsonResponse({ isSuccess: false, errorMsg: "用户不存在" });
  }

  if (password.length < 8) {
    return jsonResponse({ isSuccess: false, errorMsg: "密码长度不能少于8位" });
  }

  if (env.INVITE_CODE && env.INVITE_CODE !== code) {
    return jsonResponse({ isSuccess: false, errorMsg: "邀请码无效" });
  }

  const userCount = await env.DB.prepare(`SELECT count(*) as cnt FROM users`).first<{ cnt: number }>();
  const isAdmin = (userCount?.cnt || 0) === 0 ? 1 : 0;
  const salt = randomString(8);
  const encrypted = genEncryptedPassword(password, salt);
  const now = Math.floor(Date.now() / 1000);

  await env.DB.prepare(
    `INSERT INTO users (username, password, salt, token, last_login_at, created_at, is_admin)
     VALUES (?1, ?2, ?3, '', ?4, ?4, ?5)`
  )
    .bind(username, encrypted, salt, now, isAdmin)
    .run();

  const token = generateSessionToken(username);
  const expireAt = now + 30 * 86400;
  await env.DB.prepare(
    `INSERT INTO user_sessions (username, token, expire_at) VALUES (?1, ?2, ?3)`
  )
    .bind(username, token, expireAt)
    .run();

  return jsonResponse({
    isSuccess: true,
    data: {
      username,
      accessToken: `${username}:${token}`,
      isAdmin: isAdmin === 1,
    },
  });
}

async function handleLogout(request: Request, env: Env): Promise<Response> {
  const token = getAccessToken(request);
  if (token && token.includes(":")) {
    const [username, sessionToken] = token.split(":");
    await env.DB.prepare(`DELETE FROM user_sessions WHERE username = ?1 AND token = ?2`)
      .bind(username, sessionToken)
      .run();
  }
  return jsonResponse({ isSuccess: true, data: "" });
}

async function handleGetUserInfo(request: Request, env: Env): Promise<Response> {
  const userNs = await resolveUserNs(request, env);
  if (!userNs) return jsonResponse({ isSuccess: false, errorMsg: "请登录后使用", data: "NEED_LOGIN" });

  const user = await env.DB.prepare(
    `SELECT username, is_admin, enable_webdav, enable_local_store FROM users WHERE username = ?1`
  )
    .bind(userNs)
    .first<{ username: string; is_admin: number; enable_webdav: number; enable_local_store: number }>();

  return jsonResponse({
    isSuccess: true,
    data: {
      username: userNs,
      userNs,
      isAdmin: user?.is_admin === 1,
      enableWebdav: user?.enable_webdav === 1,
      enableLocalStore: user?.enable_local_store === 1,
    },
  });
}

// ==========================================
// 2. Book Sources (D1)
// ==========================================

async function handleGetBookSources(request: Request, env: Env): Promise<Response> {
  const userNs = await resolveUserNs(request, env);
  if (!userNs) return jsonResponse({ isSuccess: false, errorMsg: "请登录后使用", data: "NEED_LOGIN" });

  const rows = await env.DB.prepare(
    `SELECT json FROM book_sources WHERE user_ns = ?1 ORDER BY updated_at DESC`
  )
    .bind(userNs)
    .all<{ json: string }>();

  const list = (rows.results || []).map((r) => {
    try {
      return JSON.parse(r.json);
    } catch {
      return null;
    }
  }).filter(Boolean);

  return jsonResponse({ isSuccess: true, data: list });
}

async function handleGetBookSource(request: Request, env: Env): Promise<Response> {
  const userNs = await resolveUserNs(request, env);
  if (!userNs) return jsonResponse({ isSuccess: false, errorMsg: "请登录后使用", data: "NEED_LOGIN" });

  const url = new URL(request.url);
  const sourceUrl = url.searchParams.get("url") || "";

  const row = await env.DB.prepare(
    `SELECT json FROM book_sources WHERE user_ns = ?1 AND book_source_url = ?2`
  )
    .bind(userNs, sourceUrl)
    .first<{ json: string }>();

  if (!row) return jsonResponse({ isSuccess: false, errorMsg: "未找到该书源" });
  return jsonResponse({ isSuccess: true, data: JSON.parse(row.json) });
}

async function handleSaveBookSource(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const userNs = await resolveUserNs(request, env);
  if (!userNs) return jsonResponse({ isSuccess: false, errorMsg: "请登录后使用", data: "NEED_LOGIN" });

  const source = await request.json<any>();
  const sourceUrl = source.bookSourceUrl || "";
  const sourceName = source.bookSourceName || "";
  if (!sourceUrl) return jsonResponse({ isSuccess: false, errorMsg: "书源地址不能为空" });

  const now = Math.floor(Date.now() / 1000);
  await env.DB.prepare(
    `INSERT INTO book_sources (user_ns, book_source_url, book_source_name, json, updated_at)
     VALUES (?1, ?2, ?3, ?4, ?5)
     ON CONFLICT(user_ns, book_source_url) DO UPDATE SET
     book_source_name=excluded.book_source_name, json=excluded.json, updated_at=excluded.updated_at`
  )
    .bind(userNs, sourceUrl, sourceName, JSON.stringify(source), now)
    .run();

  triggerOnChangeSync(env, userNs, ctx);
  return jsonResponse({ isSuccess: true, data: "保存成功" });
}

async function handleSaveBookSources(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const userNs = await resolveUserNs(request, env);
  if (!userNs) return jsonResponse({ isSuccess: false, errorMsg: "请登录后使用", data: "NEED_LOGIN" });

  const sources = await request.json<any[]>();
  if (!Array.isArray(sources)) return jsonResponse({ isSuccess: false, errorMsg: "格式错误" });

  const now = Math.floor(Date.now() / 1000);
  const stmts = sources
    .filter((s) => s && s.bookSourceUrl)
    .map((s) =>
      env.DB.prepare(
        `INSERT INTO book_sources (user_ns, book_source_url, book_source_name, json, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5)
         ON CONFLICT(user_ns, book_source_url) DO UPDATE SET
         book_source_name=excluded.book_source_name, json=excluded.json, updated_at=excluded.updated_at`
      ).bind(userNs, s.bookSourceUrl, s.bookSourceName || "", JSON.stringify(s), now)
    );

  for (let i = 0; i < stmts.length; i += 50) {
    await env.DB.batch(stmts.slice(i, i + 50));
  }

  triggerOnChangeSync(env, userNs, ctx);
  return jsonResponse({ isSuccess: true, data: `成功导入 ${stmts.length} 个书源` });
}

async function handleDeleteBookSource(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const userNs = await resolveUserNs(request, env);
  if (!userNs) return jsonResponse({ isSuccess: false, errorMsg: "请登录后使用", data: "NEED_LOGIN" });

  const body = await request.json<any>();
  const url = body.bookSourceUrl || "";
  await env.DB.prepare(`DELETE FROM book_sources WHERE user_ns = ?1 AND book_source_url = ?2`)
    .bind(userNs, url)
    .run();

  triggerOnChangeSync(env, userNs, ctx);
  return jsonResponse({ isSuccess: true, data: "删除成功" });
}

async function handleDeleteBookSources(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const userNs = await resolveUserNs(request, env);
  if (!userNs) return jsonResponse({ isSuccess: false, errorMsg: "请登录后使用", data: "NEED_LOGIN" });

  const list = await request.json<string[]>();
  if (!Array.isArray(list)) return jsonResponse({ isSuccess: false, errorMsg: "格式错误" });

  const stmts = list.map((url) =>
    env.DB.prepare(`DELETE FROM book_sources WHERE user_ns = ?1 AND book_source_url = ?2`).bind(userNs, url)
  );

  for (let i = 0; i < stmts.length; i += 50) {
    await env.DB.batch(stmts.slice(i, i + 50));
  }

  triggerOnChangeSync(env, userNs, ctx);
  return jsonResponse({ isSuccess: true, data: "批量删除成功" });
}

async function handleDeleteAllBookSources(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const userNs = await resolveUserNs(request, env);
  if (!userNs) return jsonResponse({ isSuccess: false, errorMsg: "请登录后使用", data: "NEED_LOGIN" });

  await env.DB.prepare(`DELETE FROM book_sources WHERE user_ns = ?1`).bind(userNs).run();
  triggerOnChangeSync(env, userNs, ctx);
  return jsonResponse({ isSuccess: true, data: "全部书源已清空" });
}

async function handleReadRemoteSourceFile(request: Request, env: Env): Promise<Response> {
  const userNs = await resolveUserNs(request, env);
  if (!userNs) return jsonResponse({ isSuccess: false, errorMsg: "请登录后使用", data: "NEED_LOGIN" });

  const { url } = await request.json<{ url: string }>();
  if (!url || !isSafeRemoteUrl(url)) {
    return jsonResponse({ isSuccess: false, errorMsg: "无效或受限制的 URL (SSRF 防御)" });
  }

  const resp = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" },
  });

  const text = await resp.text();
  const parsed = JSON.parse(text);
  const sources = Array.isArray(parsed) ? parsed : [parsed];

  return jsonResponse({ isSuccess: true, data: [JSON.stringify(sources)] });
}

// ==========================================
// 3. Bookshelf & Reading Progress (D1)
// ==========================================

async function handleGetBookshelf(request: Request, env: Env): Promise<Response> {
  const userNs = await resolveUserNs(request, env);
  if (!userNs) return jsonResponse({ isSuccess: false, errorMsg: "请登录后使用", data: "NEED_LOGIN" });

  const shelfDoc = await getDocument(env, userNs, "bookshelf.json");
  return jsonResponse({ isSuccess: true, data: shelfDoc || [] });
}

async function handleSaveBook(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const userNs = await resolveUserNs(request, env);
  if (!userNs) return jsonResponse({ isSuccess: false, errorMsg: "请登录后使用", data: "NEED_LOGIN" });

  const book = await request.json<any>();
  let shelf: any[] = (await getDocument(env, userNs, "bookshelf.json")) || [];

  const idx = shelf.findIndex((b) => b.bookUrl === book.bookUrl);
  if (idx >= 0) {
    shelf[idx] = { ...shelf[idx], ...book };
  } else {
    shelf.unshift(book);
  }

  await saveDocument(env, userNs, "bookshelf.json", shelf);
  triggerOnChangeSync(env, userNs, ctx);
  return jsonResponse({ isSuccess: true, data: book });
}

async function handleSaveBooks(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const userNs = await resolveUserNs(request, env);
  if (!userNs) return jsonResponse({ isSuccess: false, errorMsg: "请登录后使用", data: "NEED_LOGIN" });

  const newBooks = await request.json<any[]>();
  let shelf: any[] = (await getDocument(env, userNs, "bookshelf.json")) || [];

  for (const book of newBooks) {
    const idx = shelf.findIndex((b) => b.bookUrl === book.bookUrl);
    if (idx >= 0) {
      shelf[idx] = { ...shelf[idx], ...book };
    } else {
      shelf.unshift(book);
    }
  }

  await saveDocument(env, userNs, "bookshelf.json", shelf);
  triggerOnChangeSync(env, userNs, ctx);
  return jsonResponse({ isSuccess: true, data: "书架更新成功" });
}

async function handleDeleteBook(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const userNs = await resolveUserNs(request, env);
  if (!userNs) return jsonResponse({ isSuccess: false, errorMsg: "请登录后使用", data: "NEED_LOGIN" });

  const { bookUrl } = await request.json<any>();
  let shelf: any[] = (await getDocument(env, userNs, "bookshelf.json")) || [];
  shelf = shelf.filter((b) => b.bookUrl !== bookUrl);

  await saveDocument(env, userNs, "bookshelf.json", shelf);
  triggerOnChangeSync(env, userNs, ctx);
  return jsonResponse({ isSuccess: true, data: "书籍已移出书架" });
}

async function handleDeleteBooks(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const userNs = await resolveUserNs(request, env);
  if (!userNs) return jsonResponse({ isSuccess: false, errorMsg: "请登录后使用", data: "NEED_LOGIN" });

  const list = await request.json<any[]>();
  const deleteUrls = new Set(list.map((b) => (typeof b === "string" ? b : b.bookUrl)));
  let shelf: any[] = (await getDocument(env, userNs, "bookshelf.json")) || [];
  shelf = shelf.filter((b) => !deleteUrls.has(b.bookUrl));

  await saveDocument(env, userNs, "bookshelf.json", shelf);
  triggerOnChangeSync(env, userNs, ctx);
  return jsonResponse({ isSuccess: true, data: "批量删除成功" });
}

async function handleSaveBookProgress(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const userNs = await resolveUserNs(request, env);
  if (!userNs) return jsonResponse({ isSuccess: false, errorMsg: "请登录后使用", data: "NEED_LOGIN" });

  const progress = await request.json<any>();
  let shelf: any[] = (await getDocument(env, userNs, "bookshelf.json")) || [];

  const idx = shelf.findIndex((b) => b.bookUrl === progress.bookUrl);
  if (idx >= 0) {
    shelf[idx] = {
      ...shelf[idx],
      durChapterIndex: progress.durChapterIndex,
      durChapterTitle: progress.durChapterTitle,
      durChapterPos: progress.durChapterPos,
      durChapterTime: progress.durChapterTime || Date.now(),
    };
    await saveDocument(env, userNs, "bookshelf.json", shelf);
    triggerOnChangeSync(env, userNs, ctx);
  }

  return jsonResponse({ isSuccess: true, data: "进度已同步" });
}

// ==========================================
// 4. Unified Chapter Content Router
// ==========================================

async function handleGetBookContent(request: Request, env: Env): Promise<Response> {
  const userNs = await resolveUserNs(request, env);
  if (!userNs) return jsonResponse({ isSuccess: false, errorMsg: "请登录后使用", data: "NEED_LOGIN" });

  const url = new URL(request.url);
  const chapterUrl = url.searchParams.get("url") || "";
  const bookUrl = url.searchParams.get("bookUrl") || "";
  const index = parseInt(url.searchParams.get("index") || "0", 10);

  // 0. TXT Book
  if (bookUrl.startsWith("local-txt:") || chapterUrl.startsWith("local-txt:")) {
    const rawId = (bookUrl || chapterUrl).split(":")[1].split("#")[0];
    const text = await readTxtChapterText(rawId, index, env);
    return jsonResponse({ isSuccess: true, data: text });
  }

  // 1. EPUB Book
  if (bookUrl.startsWith("local-epub:") || chapterUrl.startsWith("local-epub:")) {
    const bookId = (bookUrl || chapterUrl).split(":")[1].split("#")[0];
    const html = await readEpubChapterHtml(bookId, index, env);
    return jsonResponse({ isSuccess: true, data: html });
  }

  // 2. MOBI Book
  if (bookUrl.startsWith("local-mobi:") || chapterUrl.startsWith("local-mobi:")) {
    const bookId = (bookUrl || chapterUrl).split(":")[1];
    const text = await readMobiChapterText(bookId, index, env);
    return jsonResponse({ isSuccess: true, data: text });
  }

  // 3. Web Novel (Direct fetch or Kitesurf)
  if (chapterUrl.startsWith("http://") || chapterUrl.startsWith("https://")) {
    if (!isSafeRemoteUrl(chapterUrl)) {
      return jsonResponse({ isSuccess: false, errorMsg: "禁止访问内网或本地地址 (SSRF 防御)" });
    }

    const isWebView = url.searchParams.get("webView") === "true";
    if (isWebView && env.CF_ACCOUNT_ID && env.CF_API_TOKEN && env.CF_KITESURF_ENABLED !== "false") {
      // 1. Try Kitesurf
      try {
        const kitesurfUrl = `https://api.cloudflare.com/client/v4/accounts/${env.CF_ACCOUNT_ID}/browser-run/content?browser=kitesurf`;
        const kResp = await fetch(kitesurfUrl, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${env.CF_API_TOKEN}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            url: chapterUrl,
            rejectResourceTypes: ["image", "media", "font"],
          }),
        });
        if (kResp.ok) {
          const html = await kResp.text();
          return jsonResponse({ isSuccess: true, data: html });
        }
      } catch (e) {
        // Fall through to backup
      }
    }

    // 2. Try Remote WebView API if webView was requested
    if (isWebView && env.REMOTE_WEBVIEW_API) {
      try {
        const rResp = await fetch(`${env.REMOTE_WEBVIEW_API.replace(/\/$/, "")}/render.html`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(env.REMOTE_WEBVIEW_API_KEY ? { Authorization: `Bearer ${env.REMOTE_WEBVIEW_API_KEY}` } : {}),
          },
          body: JSON.stringify({
            url: chapterUrl,
            http_method: "GET",
          }),
        });
        if (rResp.ok) {
          const html = await rResp.text();
          return jsonResponse({ isSuccess: true, data: html });
        }
      } catch (e) {
        // Fall through to direct fetch
      }
    }

    // 3. Direct HTTP fetch fallback
    const resp = await fetch(chapterUrl, {
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" },
    });
    const html = await resp.text();
    return jsonResponse({ isSuccess: true, data: html });
  }

  return jsonResponse({ isSuccess: false, errorMsg: "未识别的书籍格式" });
}

// ==========================================
// 5. Document Store Helpers (D1: json_documents)
// ==========================================

async function getDocument(env: Env, namespace: string, name: string): Promise<any | null> {
  const row = await env.DB.prepare(
    `SELECT json FROM json_documents WHERE namespace = ?1 AND name = ?2`
  )
    .bind(namespace, name)
    .first<{ json: string }>();

  if (!row) return null;
  try {
    return JSON.parse(row.json);
  } catch {
    return null;
  }
}

async function saveDocument(env: Env, namespace: string, name: string, data: any): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  await env.DB.prepare(
    `INSERT INTO json_documents (namespace, name, json, updated_at)
     VALUES (?1, ?2, ?3, ?4)
     ON CONFLICT(namespace, name) DO UPDATE SET json = excluded.json, updated_at = excluded.updated_at`
  )
    .bind(namespace, name, JSON.stringify(data), now)
    .run();
}

async function handleGetDocument(request: Request, env: Env, name: string): Promise<Response> {
  const userNs = await resolveUserNs(request, env);
  if (!userNs) return jsonResponse({ isSuccess: false, errorMsg: "请登录后使用", data: "NEED_LOGIN" });
  const doc = await getDocument(env, userNs, name);
  return jsonResponse({ isSuccess: true, data: doc || [] });
}

async function handleSaveDocumentItem(request: Request, env: Env, name: string, ctx: ExecutionContext): Promise<Response> {
  const userNs = await resolveUserNs(request, env);
  if (!userNs) return jsonResponse({ isSuccess: false, errorMsg: "请登录后使用", data: "NEED_LOGIN" });

  const item = await request.json<any>();
  let list: any[] = (await getDocument(env, userNs, name)) || [];
  list.unshift(item);
  await saveDocument(env, userNs, name, list);
  triggerOnChangeSync(env, userNs, ctx);
  return jsonResponse({ isSuccess: true, data: "保存成功" });
}

async function handleDeleteDocumentItem(request: Request, env: Env, name: string, ctx: ExecutionContext): Promise<Response> {
  const userNs = await resolveUserNs(request, env);
  if (!userNs) return jsonResponse({ isSuccess: false, errorMsg: "请登录后使用", data: "NEED_LOGIN" });

  const item = await request.json<any>();
  let list: any[] = (await getDocument(env, userNs, name)) || [];
  list = list.filter((i) => JSON.stringify(i) !== JSON.stringify(item));
  await saveDocument(env, userNs, name, list);
  triggerOnChangeSync(env, userNs, ctx);
  return jsonResponse({ isSuccess: true, data: "删除成功" });
}

// ==========================================
// 6. R2 Asset & Cover Handlers
// ==========================================

async function handleUploadFile(request: Request, env: Env): Promise<Response> {
  const userNs = await resolveUserNs(request, env);
  if (!userNs) return jsonResponse({ isSuccess: false, errorMsg: "请登录后使用", data: "NEED_LOGIN" });

  const formData = await request.formData();
  const file = formData.get("file") as File | null;
  if (!file) return jsonResponse({ isSuccess: false, errorMsg: "缺少上传文件" });

  const rawName = file.name || "file";
  const baseName = rawName.split("/").pop()?.split("\\").pop() || "file";
  const safeName = baseName.replace(/[^a-zA-Z0-9._-]/g, "_").replace(/^\.+/, "") || "file";
  const fileType = new URL(request.url).searchParams.get("fileType") || "images";
  const safeFileType = /^[a-zA-Z0-9_-]+$/.test(fileType) ? fileType : "images";
  const r2Key = `assets/${userNs}/${safeFileType}/${safeName}`;

  await env.BUCKET.put(r2Key, await file.arrayBuffer(), {
    httpMetadata: { contentType: file.type || "application/octet-stream" },
  });

  return jsonResponse({
    isSuccess: true,
    data: [`/assets/${userNs}/${safeFileType}/${safeName}`],
  });
}

async function handleDeleteFile(request: Request, env: Env): Promise<Response> {
  const userNs = await resolveUserNs(request, env);
  if (!userNs) return jsonResponse({ isSuccess: false, errorMsg: "请登录后使用", data: "NEED_LOGIN" });

  const { url } = await request.json<{ url: string }>();
  const prefix = `/assets/${userNs}/`;
  if (!url || !url.startsWith(prefix) || url.includes("..") || url.includes("\\")) {
    return jsonResponse({ isSuccess: false, errorMsg: "非法文件路径" });
  }

  const rel = url.substring(prefix.length);
  const parts = rel.split("/").filter(Boolean);
  if (parts.length === 0 || parts.some((p) => p === "." || p === "..")) {
    return jsonResponse({ isSuccess: false, errorMsg: "非法文件路径" });
  }

  const r2Key = `assets/${userNs}/${parts.join("/")}`;
  await env.BUCKET.delete(r2Key);
  return jsonResponse({ isSuccess: true, data: "" });
}

async function handleGetAsset(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  let path = url.pathname.replace(/^\//, "");
  if (url.pathname === "/reader3/cover") {
    path = (url.searchParams.get("path") || "").replace(/^\//, "");
  }

  if (path.includes("..") || path.includes("\\")) {
    return new Response("Invalid Path", { status: 400, headers: corsHeaders() });
  }

  const obj = await env.BUCKET.get(path);
  let bodyStream: any = null;

  if (obj) {
    bodyStream = obj.body;
  } else {
    // Fallback to remote WebDAV
    const remoteBytes = await fallbackFetchFromRemoteWebdav(env, path);
    if (remoteBytes) {
      bodyStream = remoteBytes;
    }
  }

  if (!bodyStream) return new Response("Asset Not Found", { status: 404, headers: corsHeaders() });

  const headers = new Headers(corsHeaders());
  headers.set("Content-Type", obj?.httpMetadata?.contentType || "application/octet-stream");
  headers.set("Cache-Control", "public, max-age=31536000");

  return new Response(bodyStream, { headers });
}

// ==========================================
// 7. EPUB Streaming & Indexing Implementation
// ==========================================

async function handleEpubUpload(request: Request, env: Env): Promise<Response> {
  try {
    const userNs = (await resolveUserNs(request, env)) || "default";
    const fileName = request.headers.get("X-File-Name") || "book.epub";
    const bookId = `epub_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
    const r2Key = `epubs/${userNs}/${bookId}.epub`;

    const bodyBytes = await request.arrayBuffer();
    const fileSize = bodyBytes.byteLength;

    await env.BUCKET.put(r2Key, bodyBytes, {
      httpMetadata: { contentType: "application/epub+zip" },
    });

    const tailSize = Math.min(65536, fileSize);
    const tailObj = await env.BUCKET.get(r2Key, {
      range: { offset: fileSize - tailSize, length: tailSize },
    });
    if (!tailObj) return jsonResponse({ isSuccess: false, errorMsg: "无法读取 R2 数据" });

    const tailBytes = new Uint8Array(await tailObj.arrayBuffer());
    const eocd = findEOCD(tailBytes, fileSize);
    if (!eocd) return jsonResponse({ isSuccess: false, errorMsg: "未找到 EOCD 记录" });

    const cdObj = await env.BUCKET.get(r2Key, {
      range: { offset: eocd.cdOffset, length: eocd.cdSize },
    });
    if (!cdObj) return jsonResponse({ isSuccess: false, errorMsg: "无法读取中央目录" });

    const cdBytes = new Uint8Array(await cdObj.arrayBuffer());
    const entries = parseCentralDirectory(cdBytes);

    const containerEntry = entries.find((e) => e.fileName === "META-INF/container.xml");
    if (!containerEntry) return jsonResponse({ isSuccess: false, errorMsg: "缺少 container.xml" });

    const containerXml = await readZipEntryText(r2Key, containerEntry, env);
    const opfPath = parseContainerOpfPath(containerXml);
    if (!opfPath) return jsonResponse({ isSuccess: false, errorMsg: "缺少 OPF 路径" });

    const opfEntry = entries.find((e) => e.fileName === opfPath);
    if (!opfEntry) return jsonResponse({ isSuccess: false, errorMsg: `缺少 OPF 文件: ${opfPath}` });

    const opfXml = await readZipEntryText(r2Key, opfEntry, env);
    const opfDir = opfPath.includes("/") ? opfPath.substring(0, opfPath.lastIndexOf("/")) : "";
    const { title, author, spinePaths } = parseOpfPackage(opfXml, opfDir);

    const totalChapters = spinePaths.length;
    const now = Math.floor(Date.now() / 1000);

    const stmts = [];
    for (let i = 0; i < spinePaths.length; i++) {
      const path = spinePaths[i];
      const entry = entryMap.get(path);
      if (entry) {
        const dataOffset = entry.localHeaderOffset + 30 + new TextEncoder().encode(path).length;
        stmts.push(
          env.DB.prepare(
            `INSERT INTO epub_chapters (book_id, chapter_index, title, file_name, byte_offset, byte_length, uncompressed_length, compression_method, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
             ON CONFLICT(book_id, chapter_index) DO UPDATE SET byte_offset = excluded.byte_offset, byte_length = excluded.byte_length`
          ).bind(
            bookId,
            i,
            `第 ${i + 1} 节`,
            path,
            dataOffset,
            entry.compressedSize,
            entry.uncompressedSize,
            entry.compressionMethod,
            now
          )
        );
      }
    }

    for (let i = 0; i < stmts.length; i += 50) {
      await env.DB.batch(stmts.slice(i, i + 50));
    }

    await env.DB.prepare(
      `INSERT INTO epub_books (book_id, user_ns, file_name, r2_key, file_size, status, total_chapters, parsed_chapters, title, author, created_at, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5, 'ready', ?6, ?6, ?7, ?8, ?9, ?10)
       ON CONFLICT(book_id) DO UPDATE SET status='ready', total_chapters=excluded.total_chapters, parsed_chapters=excluded.parsed_chapters, updated_at=excluded.updated_at`
    )
      .bind(bookId, userNs, fileName, r2Key, fileSize, totalChapters, title, author, now, now)
      .run();

    return jsonResponse({
      isSuccess: true,
      data: { bookId, fileName, title, author, totalChapters, status: "ready" },
    });
  } catch (err: any) {
    return jsonResponse({ isSuccess: false, errorMsg: err.message });
  }
}

async function handleEpubRead(bookId: string, chapterIndex: number, env: Env): Promise<Response> {
  try {
    const html = await readEpubChapterHtml(bookId, chapterIndex, env);
    return new Response(html, {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        ...corsHeaders(),
      },
    });
  } catch (err: any) {
    return jsonResponse({ isSuccess: false, errorMsg: err.message });
  }
}

async function readEpubChapterHtml(bookId: string, chapterIndex: number, env: Env): Promise<string> {
  const chapter = await env.DB.prepare(
    `SELECT c.byte_offset, c.byte_length, c.compression_method, b.r2_key
     FROM epub_chapters c
     JOIN epub_books b ON c.book_id = b.book_id
     WHERE c.book_id = ?1 AND c.chapter_index = ?2`
  )
    .bind(bookId, chapterIndex)
    .first<{ byte_offset: number; byte_length: number; compression_method: number; r2_key: string }>();

  if (!chapter) throw new Error("章节尚未完成分片索引");

  const obj = await env.BUCKET.get(chapter.r2_key, {
    range: { offset: chapter.byte_offset, length: chapter.byte_length },
  });
  let payload: Uint8Array | null = obj ? new Uint8Array(await obj.arrayBuffer()) : null;

  if (!payload) {
    // Fallback to remote WebDAV if R2 is unavailable or missing object
    payload = await fallbackFetchFromRemoteWebdav(env, chapter.r2_key, {
      offset: chapter.byte_offset,
      length: chapter.byte_length,
    });
  }

  if (!payload) throw new Error("无法读取章节切片数据 (R2 与远端 WebDAV 均未命中)");
  if (chapter.compression_method === 0) {
    return new TextDecoder().decode(payload);
  } else if (chapter.compression_method === 8) {
    const ds = new DecompressionStream("deflate-raw");
    const writer = ds.writable.getWriter();
    writer.write(payload);
    writer.close();
    const buf = await new Response(ds.readable).arrayBuffer();
    return new TextDecoder().decode(buf);
  }
  throw new Error(`不支持的压缩格式: ${chapter.compression_method}`);
}

async function handleEpubStatus(bookId: string, env: Env): Promise<Response> {
  const book = await env.DB.prepare(
    `SELECT book_id, file_name, status, total_chapters, parsed_chapters, title, author FROM epub_books WHERE book_id = ?1`
  )
    .bind(bookId)
    .first();
  return jsonResponse({ isSuccess: true, data: book });
}

async function processEpubChunkWithBudget(
  bookId: string,
  startTime: number,
  timeBudgetMs: number,
  env: Env
): Promise<{ needsMore: boolean }> {
  const book = await env.DB.prepare(
    `SELECT r2_key, file_size FROM epub_books WHERE book_id = ?1`
  )
    .bind(bookId)
    .first<{ r2_key: string; file_size: number }>();
  if (!book) return { needsMore: false };

  const cp = await env.DB.prepare(
    `SELECT last_processed_index, spine_json FROM epub_parse_checkpoints WHERE book_id = ?1`
  )
    .bind(bookId)
    .first<{ last_processed_index: number; spine_json: string }>();
  if (!cp) return { needsMore: false };

  const spine: string[] = JSON.parse(cp.spine_json || "[]");
  const total = spine.length;
  let curIdx = cp.last_processed_index;

  if (curIdx >= total) {
    await markBookReady(bookId, total, env);
    return { needsMore: false };
  }

  const tailSize = Math.min(65536, book.file_size);
  const tailObj = await env.BUCKET.get(book.r2_key, {
    range: { offset: book.file_size - tailSize, length: tailSize },
  });
  if (!tailObj) return { needsMore: false };
  const tailBytes = new Uint8Array(await tailObj.arrayBuffer());
  const eocd = findEOCD(tailBytes, book.file_size);
  if (!eocd) return { needsMore: false };

  const cdObj = await env.BUCKET.get(book.r2_key, {
    range: { offset: eocd.cdOffset, length: eocd.cdSize },
  });
  if (!cdObj) return { needsMore: false };
  const cdBytes = new Uint8Array(await cdObj.arrayBuffer());
  const entries = parseCentralDirectory(cdBytes);
  const entryMap = new Map(entries.map((e) => [e.fileName, e]));

  while (curIdx < total) {
    if (Date.now() - startTime >= timeBudgetMs) {
      const now = Math.floor(Date.now() / 1000);
      await env.DB.prepare(
        `UPDATE epub_parse_checkpoints SET last_processed_index = ?1, updated_at = ?2 WHERE book_id = ?3`
      ).bind(curIdx, now, bookId).run();
      await env.DB.prepare(
        `UPDATE epub_books SET parsed_chapters = ?1, updated_at = ?2 WHERE book_id = ?3`
      ).bind(curIdx, now, bookId).run();
      return { needsMore: true };
    }

    const path = spine[curIdx];
    const entry = entryMap.get(path);
    if (entry) {
      const localHdrObj = await env.BUCKET.get(book.r2_key, {
        range: { offset: entry.localHeaderOffset, length: 30 },
      });
      if (localHdrObj) {
        const localHdrBytes = new Uint8Array(await localHdrObj.arrayBuffer());
        const dataOffset = parseLocalHeaderDataOffset(localHdrBytes, entry.localHeaderOffset);
        const now = Math.floor(Date.now() / 1000);

        await env.DB.prepare(
          `INSERT INTO epub_chapters (book_id, chapter_index, title, file_name, byte_offset, byte_length, uncompressed_length, compression_method, created_at)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
           ON CONFLICT(book_id, chapter_index) DO UPDATE SET byte_offset = excluded.byte_offset, byte_length = excluded.byte_length`
        ).bind(
          bookId,
          curIdx,
          `第 ${curIdx + 1} 节`,
          path,
          dataOffset,
          entry.compressedSize,
          entry.uncompressedSize,
          entry.compressionMethod,
          now
        ).run();
      }
    }
    curIdx++;
  }

  await markBookReady(bookId, total, env);
  return { needsMore: false };
}

async function markBookReady(bookId: string, total: number, env: Env): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  await env.DB.prepare(
    `UPDATE epub_books SET status = 'ready', parsed_chapters = ?1, updated_at = ?2 WHERE book_id = ?3`
  ).bind(total, now, bookId).run();
  await env.DB.prepare(`DELETE FROM epub_parse_checkpoints WHERE book_id = ?1`).bind(bookId).run();
}

// ==========================================
// 8. PDF Streaming Implementation
// ==========================================

async function handlePdfUpload(request: Request, env: Env): Promise<Response> {
  try {
    const userNs = (await resolveUserNs(request, env)) || "default";
    const fileName = request.headers.get("X-File-Name") || "book.pdf";
    const bookId = `pdf_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
    const r2Key = `pdfs/${userNs}/${bookId}.pdf`;

    const bodyBytes = await request.arrayBuffer();
    const fileSize = bodyBytes.byteLength;

    await env.BUCKET.put(r2Key, bodyBytes, {
      httpMetadata: { contentType: "application/pdf" },
    });

    const tailSize = Math.min(65536, fileSize);
    const tailObj = await env.BUCKET.get(r2Key, {
      range: { offset: fileSize - tailSize, length: tailSize },
    });
    if (!tailObj) return jsonResponse({ isSuccess: false, errorMsg: "无法读取 R2 数据" });

    const tailBytes = new Uint8Array(await tailObj.arrayBuffer());
    const tailText = new TextDecoder().decode(tailBytes);

    const countMatch = tailText.match(/\/Count\s+(\d+)/);
    const totalPages = countMatch ? parseInt(countMatch[1], 10) : 1;
    const titleMatch = tailText.match(/\/Title\s*\(([^)]+)\)/);
    const authorMatch = tailText.match(/\/Author\s*\(([^)]+)\)/);

    const title = titleMatch ? titleMatch[1].trim() : fileName.replace(/\.pdf$/i, "");
    const author = authorMatch ? authorMatch[1].trim() : "未知作者";
    const now = Math.floor(Date.now() / 1000);

    await env.DB.prepare(
      `INSERT INTO pdf_books (book_id, user_ns, file_name, r2_key, file_size, total_pages, title, author, status, created_at, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 'ready', ?9, ?10)`
    ).bind(bookId, userNs, fileName, r2Key, fileSize, totalPages, title, author, now, now).run();

    return jsonResponse({
      isSuccess: true,
      data: { bookId, fileName, title, author, totalPages, status: "ready" },
    });
  } catch (err: any) {
    return jsonResponse({ isSuccess: false, errorMsg: err.message });
  }
}

async function handlePdfStream(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const bookId = url.searchParams.get("bookId") || "";

  const book = await env.DB.prepare(
    `SELECT r2_key, file_size FROM pdf_books WHERE book_id = ?1`
  ).bind(bookId).first<{ r2_key: string; file_size: number }>();

  if (!book) return jsonResponse({ isSuccess: false, errorMsg: "未找到该 PDF 书籍" });

  const rangeHeader = request.headers.get("Range");
  const r2Options: R2GetOptions = {};

  if (rangeHeader) {
    const match = rangeHeader.match(/bytes=(\d+)-(\d*)/);
    if (match) {
      const offset = parseInt(match[1], 10);
      if (offset >= book.file_size) {
        const headers = new Headers(corsHeaders());
        headers.set("Content-Range", `bytes */${book.file_size}`);
        return new Response(null, { status: 416, headers });
      }
      const rawEnd = match[2] ? parseInt(match[2], 10) : undefined;
      const end = rawEnd !== undefined ? Math.min(rawEnd, book.file_size - 1) : book.file_size - 1;
      const length = Math.max(0, end - offset + 1);
      r2Options.range = { offset, length };
    }
  }

  const obj = await env.BUCKET.get(book.r2_key, r2Options);
  let bodyStream: any = null;
  let byteLen = 0;

  if (obj) {
    bodyStream = obj.body;
    byteLen = (obj as any).range?.length || (book.file_size - (r2Options.range && "offset" in r2Options.range ? r2Options.range.offset : 0));
  } else {
    // Fallback to remote WebDAV
    const remoteBytes = await fallbackFetchFromRemoteWebdav(env, book.r2_key, r2Options.range);
    if (remoteBytes) {
      bodyStream = remoteBytes;
      byteLen = remoteBytes.length;
    }
  }

  if (!bodyStream) return jsonResponse({ isSuccess: false, errorMsg: "文件未找到 (R2 与远端 WebDAV 均未命中)" });

  const headers = new Headers(corsHeaders());
  headers.set("Content-Type", "application/pdf");
  headers.set("Accept-Ranges", "bytes");
  headers.set("Access-Control-Expose-Headers", "Accept-Ranges, Content-Range, Content-Length");

  if (r2Options.range && "offset" in r2Options.range) {
    const offset = r2Options.range.offset;
    const end = offset + byteLen - 1;
    headers.set("Content-Range", `bytes ${offset}-${end}/${book.file_size}`);
    headers.set("Content-Length", byteLen.toString());
    return new Response(bodyStream, { status: 206, headers });
  }

  headers.set("Content-Length", book.file_size.toString());
  return new Response(bodyStream, { status: 200, headers });
}

async function handlePdfInfo(bookId: string, env: Env): Promise<Response> {
  const book = await env.DB.prepare(
    `SELECT book_id, file_name, title, author, total_pages, file_size, status FROM pdf_books WHERE book_id = ?1`
  ).bind(bookId).first();
  return jsonResponse({ isSuccess: true, data: book });
}

async function handlePdfToc(bookId: string, env: Env): Promise<Response> {
  const outlines = await env.DB.prepare(
    `SELECT title, dest_page, level FROM pdf_outlines WHERE book_id = ?1 ORDER BY dest_page ASC`
  ).bind(bookId).all();
  return jsonResponse({ isSuccess: true, data: outlines.results });
}

// ==========================================
// 9. MOBI Streaming Implementation
// ==========================================

async function handleMobiUpload(request: Request, env: Env): Promise<Response> {
  try {
    const userNs = (await resolveUserNs(request, env)) || "default";
    const fileName = request.headers.get("X-File-Name") || "book.mobi";
    const bookId = `mobi_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
    const r2Key = `mobis/${userNs}/${bookId}.mobi`;

    const bodyBytes = await request.arrayBuffer();
    const fileSize = bodyBytes.byteLength;

    await env.BUCKET.put(r2Key, bodyBytes, {
      httpMetadata: { contentType: "application/x-mobipocket-ebook" },
    });

    const headSize = Math.min(16384, fileSize);
    const headObj = await env.BUCKET.get(r2Key, { range: { offset: 0, length: headSize } });
    if (!headObj) return jsonResponse({ isSuccess: false, errorMsg: "无法读取 R2 数据" });

    const headBytes = new Uint8Array(await headObj.arrayBuffer());
    const pdb = parsePdbRecords(headBytes, fileSize);
    if (!pdb || pdb.recordOffsets.length === 0) {
      return jsonResponse({ isSuccess: false, errorMsg: "非法 MOBI 文件" });
    }

    const rec0Offset = pdb.recordOffsets[0];
    const rec0Len = pdb.recordOffsets.length > 1 ? pdb.recordOffsets[1] - rec0Offset : fileSize - rec0Offset;
    let rec0Bytes: Uint8Array;
    if (rec0Offset + rec0Len <= headBytes.length) {
      rec0Bytes = headBytes.subarray(rec0Offset, rec0Offset + rec0Len);
    } else {
      const rec0Obj = await env.BUCKET.get(r2Key, { range: { offset: rec0Offset, length: rec0Len } });
      if (!rec0Obj) return jsonResponse({ isSuccess: false, errorMsg: "读取描述符失败" });
      rec0Bytes = new Uint8Array(await rec0Obj.arrayBuffer());
    }

    const mobiHeader = parseMobiHeader(rec0Bytes);
    const title = mobiHeader.title || fileName.replace(/\.(mobi|prc)$/i, "");
    const totalChapters = Math.min(mobiHeader.textRecordCount, pdb.recordOffsets.length - 1);
    const now = Math.floor(Date.now() / 1000);

    await env.DB.prepare(
      `INSERT INTO mobi_books (book_id, user_ns, file_name, r2_key, file_size, total_chapters, title, author, compression, status, created_at, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, '未知作者', ?8, 'ready', ?9, ?10)`
    ).bind(bookId, userNs, fileName, r2Key, fileSize, totalChapters, title, mobiHeader.compression, now, now).run();

    const stmts = [];
    for (let i = 1; i <= totalChapters; i++) {
      if (i >= pdb.recordOffsets.length) break;
      const byteOffset = pdb.recordOffsets[i];
      const byteLength = i + 1 < pdb.recordOffsets.length ? pdb.recordOffsets[i + 1] - byteOffset : fileSize - byteOffset;
      stmts.push(
        env.DB.prepare(
          `INSERT INTO mobi_chapters (book_id, chapter_index, title, byte_offset, byte_length, compression, created_at)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`
        ).bind(bookId, i - 1, `第 ${i} 节`, byteOffset, byteLength, mobiHeader.compression, now)
      );
    }

    for (let i = 0; i < stmts.length; i += 50) {
      await env.DB.batch(stmts.slice(i, i + 50));
    }

    return jsonResponse({
      isSuccess: true,
      data: { bookId, fileName, title, totalChapters, status: "ready" },
    });
  } catch (err: any) {
    return jsonResponse({ isSuccess: false, errorMsg: err.message });
  }
}

async function handleMobiRead(bookId: string, chapterIndex: number, env: Env): Promise<Response> {
  try {
    const text = await readMobiChapterText(bookId, chapterIndex, env);
    return new Response(text, {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        ...corsHeaders(),
      },
    });
  } catch (err: any) {
    return jsonResponse({ isSuccess: false, errorMsg: err.message });
  }
}

async function readMobiChapterText(bookId: string, chapterIndex: number, env: Env): Promise<string> {
  const chapter = await env.DB.prepare(
    `SELECT c.byte_offset, c.byte_length, c.compression, b.r2_key
     FROM mobi_chapters c
     JOIN mobi_books b ON c.book_id = b.book_id
     WHERE c.book_id = ?1 AND c.chapter_index = ?2`
  ).bind(bookId, chapterIndex).first<{ byte_offset: number; byte_length: number; compression: number; r2_key: string }>();

  if (!chapter) throw new Error("未找到该 MOBI 章节记录");

  const obj = await env.BUCKET.get(chapter.r2_key, {
    range: { offset: chapter.byte_offset, length: chapter.byte_length },
  });
  let payload: Uint8Array | null = obj ? new Uint8Array(await obj.arrayBuffer()) : null;

  if (!payload) {
    // Fallback to remote WebDAV if R2 is unavailable or missing object
    payload = await fallbackFetchFromRemoteWebdav(env, chapter.r2_key, {
      offset: chapter.byte_offset,
      length: chapter.byte_length,
    });
  }

  if (!payload) throw new Error("无法读取切片数据 (R2 与远端 WebDAV 均未命中)");

  const decompressed = chapter.compression === 2 ? decompressPalmDoc(payload) : payload;
  return new TextDecoder().decode(decompressed);
}

async function handleMobiInfo(bookId: string, env: Env): Promise<Response> {
  const book = await env.DB.prepare(
    `SELECT book_id, file_name, title, author, total_chapters, file_size, status FROM mobi_books WHERE book_id = ?1`
  ).bind(bookId).first();
  return jsonResponse({ isSuccess: true, data: book });
}

// ==========================================
// 10. Utilities: Security, CORS, Parsing
// ==========================================

function corsHeaders(): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, Range, X-User-NS, X-File-Name, X-Requested-With",
  };
}

function jsonResponse(data: any, status: number = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...corsHeaders(),
    },
  });
}

function getAccessToken(request: Request): string | null {
  const auth = request.headers.get("Authorization");
  if (auth && auth.startsWith("Bearer ")) return auth.substring(7);
  const cookie = request.headers.get("Cookie") || "";
  const match = cookie.match(/token=([^;]+)/);
  if (match) return decodeURIComponent(match[1]);
  return new URL(request.url).searchParams.get("accessToken");
}

async function resolveUserNs(request: Request, env: Env): Promise<string | null> {
  if (env.SECURE === "false") return "default";

  const url = new URL(request.url);
  const secureKey = url.searchParams.get("secureKey") || request.headers.get("X-Secure-Key");
  if (env.SECURE_KEY && secureKey === env.SECURE_KEY) {
    return url.searchParams.get("userNS") || "default";
  }

  const accessToken = getAccessToken(request);
  if (!accessToken || !accessToken.includes(":")) return null;

  const [username, token] = accessToken.split(":");
  const session = await env.DB.prepare(
    `SELECT username FROM user_sessions WHERE username = ?1 AND token = ?2 AND expire_at > ?3`
  )
    .bind(username, token, Math.floor(Date.now() / 1000))
    .first<{ username: string }>();

  return session?.username || null;
}

function generateSessionToken(username: string): string {
  return `${Date.now()}_${randomString(16)}`;
}

function randomString(len: number): string {
  const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let res = "";
  for (let i = 0; i < len; i++) res += chars[Math.floor(Math.random() * chars.length)];
  return res;
}

function isSafeRemoteUrl(rawUrl: string): boolean {
  try {
    const parsed = new URL(rawUrl.trim());
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;

    const hostname = parsed.hostname.toLowerCase();
    if (
      hostname === "localhost" ||
      hostname.endsWith(".localhost") ||
      hostname.endsWith(".local") ||
      hostname.endsWith(".internal") ||
      hostname.endsWith(".lan") ||
      hostname === "127.0.0.1" ||
      hostname === "0.0.0.0" ||
      hostname === "::1" ||
      hostname === "169.254.169.254"
    ) {
      return false;
    }

    // Check private IPv4 ranges
    const ipv4Regex = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
    const match = hostname.match(ipv4Regex);
    if (match) {
      const a = parseInt(match[1], 10);
      const b = parseInt(match[2], 10);
      if (a === 127 || a === 10 || a === 0) return false;
      if (a === 172 && b >= 16 && b <= 31) return false;
      if (a === 192 && b === 168) return false;
      if (a === 169 && b === 254) return false;
      if (a === 100 && b >= 64 && b <= 127) return false;
    }

    if (
      hostname.startsWith("[::1]") ||
      hostname.startsWith("[fc") ||
      hostname.startsWith("[fd") ||
      hostname.startsWith("[fe80")
    ) {
      return false;
    }

    return true;
  } catch {
    return false;
  }
}

// Pure JS MD5 implementation for double-MD5 passwords
function md5(string: string): string {
  function rotateLeft(lValue: number, iShiftBits: number) {
    return (lValue << iShiftBits) | (lValue >>> (32 - iShiftBits));
  }
  function addUnsigned(lX: number, lY: number) {
    const lX8 = lX & 0x80000000;
    const lY8 = lY & 0x80000000;
    const lX4 = lX & 0x40000000;
    const lY4 = lY & 0x40000000;
    const lResult = (lX & 0x3fffffff) + (lY & 0x3fffffff);
    if (lX4 & lY4) return lResult ^ 0x80000000 ^ lX8 ^ lY8;
    if (lX4 | lY4) {
      if (lResult & 0x40000000) return lResult ^ 0xc0000000 ^ lX8 ^ lY8;
      else return lResult ^ 0x40000000 ^ lX8 ^ lY8;
    } else {
      return lResult ^ lX8 ^ lY8;
    }
  }
  function F(x: number, y: number, z: number) { return (x & y) | (~x & z); }
  function G(x: number, y: number, z: number) { return (x & z) | (y & ~z); }
  function H(x: number, y: number, z: number) { return x ^ y ^ z; }
  function I(x: number, y: number, z: number) { return y ^ (x | ~z); }
  function FF(a: number, b: number, c: number, d: number, x: number, s: number, ac: number) {
    a = addUnsigned(a, addUnsigned(addUnsigned(F(b, c, d), x), ac));
    return addUnsigned(rotateLeft(a, s), b);
  }
  function GG(a: number, b: number, c: number, d: number, x: number, s: number, ac: number) {
    a = addUnsigned(a, addUnsigned(addUnsigned(G(b, c, d), x), ac));
    return addUnsigned(rotateLeft(a, s), b);
  }
  function HH(a: number, b: number, c: number, d: number, x: number, s: number, ac: number) {
    a = addUnsigned(a, addUnsigned(addUnsigned(H(b, c, d), x), ac));
    return addUnsigned(rotateLeft(a, s), b);
  }
  function II(a: number, b: number, c: number, d: number, x: number, s: number, ac: number) {
    a = addUnsigned(a, addUnsigned(addUnsigned(I(b, c, d), x), ac));
    return addUnsigned(rotateLeft(a, s), b);
  }
  function convertToWordArray(string: string) {
    let lWordCount;
    const lMessageLength = string.length;
    const lNumberOfWordsTempOne = lMessageLength + 8;
    const lNumberOfWordsTempTwo = (lNumberOfWordsTempOne - (lNumberOfWordsTempOne % 64)) / 64;
    const lNumberOfWords = (lNumberOfWordsTempTwo + 1) * 16;
    const lWordArray = Array(lNumberOfWords - 1);
    let lBytePosition = 0;
    let lByteCount = 0;
    while (lByteCount < lMessageLength) {
      lWordCount = (lByteCount - (lByteCount % 4)) / 4;
      lBytePosition = (lByteCount % 4) * 8;
      lWordArray[lWordCount] = lWordArray[lWordCount] | (string.charCodeAt(lByteCount) << lBytePosition);
      lByteCount++;
    }
    lWordCount = (lByteCount - (lByteCount % 4)) / 4;
    lBytePosition = (lByteCount % 4) * 8;
    lWordArray[lWordCount] = lWordArray[lWordCount] | (0x80 << lBytePosition);
    lWordArray[lNumberOfWords - 2] = lMessageLength << 3;
    lWordArray[lNumberOfWords - 1] = lMessageLength >>> 29;
    return lWordArray;
  }
  function wordToHex(lValue: number) {
    let WordToHexValue = "", WordToHexValueTemp = "", lByte, lCount;
    for (lCount = 0; lCount <= 3; lCount++) {
      lByte = (lValue >>> (lCount * 8)) & 255;
      WordToHexValueTemp = "0" + lByte.toString(16);
      WordToHexValue = WordToHexValue + WordToHexValueTemp.substr(WordToHexValueTemp.length - 2, 2);
    }
    return WordToHexValue;
  }

  const x = convertToWordArray(string);
  let a = 0x67452301, b = 0xefcdab89, c = 0x98badcfe, d = 0x10325476;
  const S11 = 7, S12 = 12, S13 = 17, S14 = 22;
  const S21 = 5, S22 = 9, S23 = 14, S24 = 20;
  const S31 = 4, S32 = 11, S33 = 16, S34 = 23;
  const S41 = 6, S42 = 10, S43 = 15, S44 = 21;

  for (let k = 0; k < x.length; k += 16) {
    const AA = a, BB = b, CC = c, DD = d;
    a = FF(a, b, c, d, x[k], S11, 0xd76aa478);
    d = FF(d, a, b, c, x[k + 1], S12, 0xe8c7b756);
    c = FF(c, d, a, b, x[k + 2], S13, 0x242070db);
    b = FF(b, c, d, a, x[k + 3], S14, 0xc1bdceee);
    a = FF(a, b, c, d, x[k + 4], S11, 0xf57c0faf);
    d = FF(d, a, b, c, x[k + 5], S12, 0x4787c62a);
    c = FF(c, d, a, b, x[k + 6], S13, 0xa8304613);
    b = FF(b, c, d, a, x[k + 7], S14, 0xfd469501);
    a = FF(a, b, c, d, x[k + 8], S11, 0x698098d8);
    d = FF(d, a, b, c, x[k + 9], S12, 0x8b44f7af);
    c = FF(c, d, a, b, x[k + 10], S13, 0xffff5bb1);
    b = FF(b, c, d, a, x[k + 11], S14, 0x895cd7be);
    a = FF(a, b, c, d, x[k + 12], S11, 0x6b901122);
    d = FF(d, a, b, c, x[k + 13], S12, 0xfd987193);
    c = FF(c, d, a, b, x[k + 14], S13, 0xa679438e);
    b = FF(b, c, d, a, x[k + 15], S14, 0x49b40821);

    a = GG(a, b, c, d, x[k + 1], S21, 0xf61e2562);
    d = GG(d, a, b, c, x[k + 6], S22, 0xc040b340);
    c = GG(c, d, a, b, x[k + 11], S23, 0x265e5a51);
    b = GG(b, c, d, a, x[k], S24, 0xe9b6c7aa);
    a = GG(a, b, c, d, x[k + 5], S21, 0xd62f105d);
    d = GG(d, a, b, c, x[k + 10], S22, 0x2441453);
    c = GG(c, d, a, b, x[k + 15], S23, 0xd8a1e681);
    b = GG(b, c, d, a, x[k + 4], S24, 0xe7d3fbc8);
    a = GG(a, b, c, d, x[k + 9], S21, 0x21e1cde6);
    d = GG(d, a, b, c, x[k + 14], S22, 0xc33707d6);
    c = GG(c, d, a, b, x[k + 3], S23, 0xf4d50d87);
    b = GG(b, c, d, a, x[k + 8], S24, 0x455a14ed);
    a = GG(a, b, c, d, x[k + 13], S21, 0xa9e3e905);
    d = GG(d, a, b, c, x[k + 2], S22, 0xfcefa3f8);
    c = GG(c, d, a, b, x[k + 7], S23, 0x676f02d9);
    b = GG(b, c, d, a, x[k + 12], S24, 0x8d2a4c8a);

    a = HH(a, b, c, d, x[k + 5], S31, 0xfffa3942);
    d = HH(d, a, b, c, x[k + 8], S32, 0x8771f681);
    c = HH(c, d, a, b, x[k + 11], S33, 0x6d9d6122);
    b = HH(b, c, d, a, x[k + 14], S34, 0xfde5380c);
    a = HH(a, b, c, d, x[k + 1], S31, 0xa4beea44);
    d = HH(d, a, b, c, x[k + 4], S32, 0x4bdecfa9);
    c = HH(c, d, a, b, x[k + 7], S33, 0xf6bb4b60);
    b = HH(b, c, d, a, x[k + 10], S34, 0xbebfbc70);
    a = HH(a, b, c, d, x[k + 13], S31, 0x289b7ec6);
    d = HH(d, a, b, c, x[k], S32, 0xeaa127fa);
    c = HH(c, d, a, b, x[k + 3], S33, 0xd4ef3085);
    b = HH(b, c, d, a, x[k + 6], S34, 0x4881d05);
    a = HH(a, b, c, d, x[k + 9], S31, 0xd9d4d039);
    d = HH(d, a, b, c, x[k + 12], S32, 0xe6db99e5);
    c = HH(c, d, a, b, x[k + 15], S33, 0x1fa27cf8);
    b = HH(b, c, d, a, x[k + 2], S34, 0xc4ac5665);

    a = II(a, b, c, d, x[k], S41, 0xf4292244);
    d = II(d, a, b, c, x[k + 7], S42, 0x432aff97);
    c = II(c, d, a, b, x[k + 14], S43, 0xab9423a7);
    b = II(b, c, d, a, x[k + 5], S44, 0xfc93a039);
    a = II(a, b, c, d, x[k + 12], S41, 0x655b59c3);
    d = II(d, a, b, c, x[k + 3], S42, 0x8f0ccc92);
    c = II(c, d, a, b, x[k + 10], S43, 0xffeff47d);
    b = II(b, c, d, a, x[k + 1], S44, 0x85845dd1);
    a = II(a, b, c, d, x[k + 8], S41, 0x6fa87e4f);
    d = II(d, a, b, c, x[k + 15], S42, 0xfe2ce6e0);
    c = II(c, d, a, b, x[k + 6], S43, 0xa3014314);
    b = II(b, c, d, a, x[k + 13], S44, 0x4e0811a1);
    a = II(a, b, c, d, x[k + 4], S41, 0xf7537e82);
    d = II(d, a, b, c, x[k + 11], S42, 0xbd3af235);
    c = II(c, d, a, b, x[k + 2], S43, 0x2ad7d2bb);
    b = II(b, c, d, a, x[k + 9], S44, 0xeb86d391);

    a = addUnsigned(a, AA);
    b = addUnsigned(b, BB);
    c = addUnsigned(c, CC);
    d = addUnsigned(d, DD);
  }
  return (wordToHex(a) + wordToHex(b) + wordToHex(c) + wordToHex(d)).toLowerCase();
}

function genEncryptedPassword(password: string, salt: string): string {
  const first = md5(password + salt);
  return md5(first + salt);
}

// === ZIP / EPUB Helpers ===

interface CentralDirEntry {
  fileName: string;
  compressionMethod: number;
  compressedSize: number;
  uncompressedSize: number;
  localHeaderOffset: number;
}

function findEOCD(tail: Uint8Array, totalFileSize: number): { cdOffset: number; cdSize: number } | null {
  for (let i = tail.length - 22; i >= 0; i--) {
    if (tail[i] === 0x50 && tail[i + 1] === 0x4b && tail[i + 2] === 0x05 && tail[i + 3] === 0x06) {
      const view = new DataView(tail.buffer, tail.byteOffset + i, 22);
      const cdSize = view.getUint32(12, true);
      const cdOffset = view.getUint32(16, true);
      if (cdOffset + cdSize <= totalFileSize) return { cdOffset, cdSize };
    }
  }
  return null;
}

function parseCentralDirectory(cd: Uint8Array): CentralDirEntry[] {
  const entries: CentralDirEntry[] = [];
  let pos = 0;
  const view = new DataView(cd.buffer, cd.byteOffset, cd.byteLength);

  while (pos + 46 <= cd.length) {
    if (cd[pos] !== 0x50 || cd[pos + 1] !== 0x4b || cd[pos + 2] !== 0x01 || cd[pos + 3] !== 0x02) break;
    const compressionMethod = view.getUint16(pos + 10, true);
    const compressedSize = view.getUint32(pos + 20, true);
    const uncompressedSize = view.getUint32(pos + 24, true);
    const nameLen = view.getUint16(pos + 28, true);
    const extraLen = view.getUint16(pos + 30, true);
    const commentLen = view.getUint16(pos + 32, true);
    const localHeaderOffset = view.getUint32(pos + 42, true);

    pos += 46;
    if (pos + nameLen <= cd.length) {
      const fileName = new TextDecoder().decode(cd.subarray(pos, pos + nameLen));
      entries.push({ fileName, compressionMethod, compressedSize, uncompressedSize, localHeaderOffset });
    }
    pos += nameLen + extraLen + commentLen;
  }
  return entries;
}

function parseLocalHeaderDataOffset(hdr: Uint8Array, localHeaderOffset: number): number {
  const view = new DataView(hdr.buffer, hdr.byteOffset, hdr.byteLength);
  const nameLen = view.getUint16(26, true);
  const extraLen = view.getUint16(28, true);
  return localHeaderOffset + 30 + nameLen + extraLen;
}

async function readZipEntryText(r2Key: string, entry: CentralDirEntry, env: Env): Promise<string> {
  const localHdrObj = await env.BUCKET.get(r2Key, { range: { offset: entry.localHeaderOffset, length: 30 } });
  if (!localHdrObj) throw new Error("无法读取本地头");
  const localHdrBytes = new Uint8Array(await localHdrObj.arrayBuffer());
  const dataOffset = parseLocalHeaderDataOffset(localHdrBytes, entry.localHeaderOffset);

  const dataObj = await env.BUCKET.get(r2Key, { range: { offset: dataOffset, length: entry.compressedSize } });
  if (!dataObj) throw new Error("无法读取数据切片");
  const dataBytes = new Uint8Array(await dataObj.arrayBuffer());

  if (entry.compressionMethod === 0) {
    return new TextDecoder().decode(dataBytes);
  } else if (entry.compressionMethod === 8) {
    const ds = new DecompressionStream("deflate-raw");
    const writer = ds.writable.getWriter();
    writer.write(dataBytes);
    writer.close();
    const decompressed = await new Response(ds.readable).arrayBuffer();
    return new TextDecoder().decode(decompressed);
  }
  throw new Error(`不支持的压缩格式: ${entry.compressionMethod}`);
}

function parseContainerOpfPath(xml: string): string | null {
  const match = xml.match(/full-path=["']([^"']+)["']/i);
  return match ? match[1] : null;
}

function parseOpfPackage(xml: string, opfDir: string): { title: string; author: string; spinePaths: string[] } {
  const titleMatch = xml.match(/<dc:title[^>]*>([^<]+)<\/dc:title>/i);
  const authorMatch = xml.match(/<dc:creator[^>]*>([^<]+)<\/dc:creator>/i);

  const manifest = new Map<string, string>();
  const itemRegex = /<item\s+[^>]*id=["']([^"']+)["'][^>]*href=["']([^"']+)["'][^>]*>/gi;
  let match;
  while ((match = itemRegex.exec(xml)) !== null) {
    const id = match[1];
    const href = match[2];
    const fullPath = opfDir ? `${opfDir.replace(/\/$/, "")}/${href.replace(/^\//, "")}` : href;
    manifest.set(id, fullPath);
  }

  const spinePaths: string[] = [];
  const itemrefRegex = /<itemref\s+[^>]*idref=["']([^"']+)["'][^>]*>/gi;
  while ((match = itemrefRegex.exec(xml)) !== null) {
    const idref = match[1];
    const path = manifest.get(idref);
    if (path) spinePaths.push(path);
  }

  return {
    title: titleMatch ? titleMatch[1].trim() : "未知书名",
    author: authorMatch ? authorMatch[1].trim() : "未知作者",
    spinePaths,
  };
}

// === PDB / MOBI Format Helpers ===

function parsePdbRecords(data: Uint8Array, totalFileSize: number): { numRecords: number; recordOffsets: number[] } | null {
  if (data.length < 78) return null;
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const numRecords = view.getUint16(76, false);

  const recordOffsets: number[] = [];
  let pos = 78;
  for (let i = 0; i < numRecords; i++) {
    if (pos + 8 > data.length) break;
    const offset = view.getUint32(pos, false);
    if (offset < totalFileSize) recordOffsets.push(offset);
    pos += 8;
  }
  return { numRecords, recordOffsets };
}

function parseMobiHeader(rec0: Uint8Array): { compression: number; textRecordCount: number; title: string | null } {
  if (rec0.length < 16) return { compression: 1, textRecordCount: 0, title: null };
  const view = new DataView(rec0.buffer, rec0.byteOffset, rec0.byteLength);
  const compression = view.getUint16(0, false);
  const textRecordCount = view.getUint16(8, false);

  let title: string | null = null;
  if (rec0.length >= 92 && rec0[16] === 0x4d && rec0[17] === 0x4f && rec0[18] === 0x42 && rec0[19] === 0x49) {
    const nameOffset = view.getUint32(84, false);
    const nameLength = view.getUint32(88, false);
    if (nameOffset + nameLength <= rec0.length) {
      title = new TextDecoder().decode(rec0.subarray(nameOffset, nameOffset + nameLength)).trim() || null;
    }
  }
  return { compression, textRecordCount, title };
}

function decompressPalmDoc(data: Uint8Array): Uint8Array {
  const out: number[] = [];
  let i = 0;
  while (i < data.length) {
    const b = data[i++];
    if (b === 0x00) {
      out.push(0);
    } else if (b <= 0x08) {
      const end = Math.min(i + b, data.length);
      for (let k = i; k < end; k++) out.push(data[k]);
      i = end;
    } else if (b <= 0x7f) {
      out.push(b);
    } else if (b <= 0xbf) {
      if (i < data.length) {
        const next = data[i++];
        const distance = ((b & 0x3f) << 3) | (next >> 5);
        const length = (next & 0x07) + 3;
        if (distance > 0 && distance <= out.length) {
          const start = out.length - distance;
          for (let k = 0; k < length; k++) out.push(out[start + (k % distance)]);
        }
      }
    } else {
      out.push(0x20);
      out.push(b ^ 0x80);
    }
  }
  return new Uint8Array(out);
}

// ==========================================
// 11. Standard WebDAV Protocol (Legado App Sync)
// ==========================================

async function resolveWebdavUser(request: Request, env: Env): Promise<string | null> {
  const auth = request.headers.get("Authorization") || "";
  if (!auth.toLowerCase().startsWith("basic ")) return null;
  const b64 = auth.substring(6).trim();
  let decoded = "";
  try {
    decoded = atob(b64);
  } catch {
    return null;
  }
  const [username, password] = decoded.split(":");
  if (!username || !password) return null;

  const user = await env.DB.prepare(
    `SELECT username, password, salt, enable_webdav FROM users WHERE username = ?1`
  )
    .bind(username)
    .first<{ username: string; password: string; salt: string; enable_webdav: number }>();

  if (!user || user.enable_webdav !== 1) return null;
  const encrypted = genEncryptedPassword(password, user.salt);
  if (encrypted !== user.password) return null;
  return user.username;
}

async function handleWebdav(request: Request, env: Env): Promise<Response> {
  const userNs = await resolveWebdavUser(request, env);
  if (!userNs) {
    return new Response("Unauthorized", {
      status: 401,
      headers: {
        "WWW-Authenticate": 'Basic realm="reader-webdav"',
        ...corsHeaders(),
      },
    });
  }

  const url = new URL(request.url);
  const rawRelPath = url.pathname.replace(/^\/reader3\/webdav\/?/, "");
  if (rawRelPath.includes("..") || rawRelPath.includes("\\")) {
    return new Response("Forbidden", { status: 403, headers: corsHeaders() });
  }

  const cleanPath = rawRelPath.replace(/^\/+/, "");
  const r2Key = cleanPath ? `webdav/${userNs}/${cleanPath}` : `webdav/${userNs}/`;
  const method = request.method.toUpperCase();

  // 1. OPTIONS: Capability discovery
  if (method === "OPTIONS") {
    return new Response(null, {
      status: 200,
      headers: {
        DAV: "1, 2",
        Allow: "OPTIONS, GET, HEAD, POST, PUT, DELETE, PROPFIND, MKCOL, MOVE, COPY, LOCK, UNLOCK",
        ...corsHeaders(),
      },
    });
  }

  // 2. PROPFIND: Directory / File Property Discovery (XML Multi-Status)
  if (method === "PROPFIND") {
    const isRoot = !cleanPath || cleanPath === "";
    const prefix = isRoot ? `webdav/${userNs}/` : r2Key;
    const listed = await env.BUCKET.list({ prefix, delimiter: "/" });

    let xml = `<?xml version="1.0" encoding="utf-8"?><D:multistatus xmlns:D="DAV:">`;
    const hrefBase = `/reader3/webdav/${cleanPath ? cleanPath.replace(/\/$/, "") + "/" : ""}`;

    // Add current collection entry
    xml += `<D:response><D:href>/reader3/webdav/${cleanPath ? cleanPath : ""}</D:href><D:propstat><D:status>HTTP/1.1 200 OK</D:status><D:prop><D:resourcetype><D:collection/></D:resourcetype></D:prop></D:propstat></D:response>`;

    // Add subdirectories
    for (const delimitedPrefix of listed.delimitedPrefixes || []) {
      const subName = delimitedPrefix.replace(prefix, "").replace(/\/$/, "");
      if (!subName) continue;
      const subHref = `${hrefBase}${subName}/`;
      xml += `<D:response><D:href>${subHref}</D:href><D:propstat><D:status>HTTP/1.1 200 OK</D:status><D:prop><D:resourcetype><D:collection/></D:resourcetype></D:prop></D:propstat></D:response>`;
    }

    // Add files
    for (const obj of listed.objects || []) {
      const fileName = obj.key.replace(prefix, "");
      if (!fileName || fileName.includes("/")) continue;
      const fileHref = `${hrefBase}${fileName}`;
      const mod = Math.floor(obj.uploaded.getTime() / 1000);
      xml += `<D:response><D:href>${fileHref}</D:href><D:propstat><D:status>HTTP/1.1 200 OK</D:status><D:prop><D:getlastmodified>${mod}</D:getlastmodified><D:getcontentlength>${obj.size}</D:getcontentlength><D:resourcetype/></D:prop></D:propstat></D:response>`;
    }

    xml += `</D:multistatus>`;
    return new Response(xml, {
      status: 207,
      headers: {
        "Content-Type": "application/xml; charset=utf-8",
        ...corsHeaders(),
      },
    });
  }

  // 3. MKCOL: Create Directory
  if (method === "MKCOL") {
    await env.BUCKET.put(`${r2Key.replace(/\/$/, "")}/`, new Uint8Array(0));
    return new Response(null, { status: 201, headers: corsHeaders() });
  }

  // 4. PUT: Upload File
  if (method === "PUT") {
    const body = await request.arrayBuffer();
    await env.BUCKET.put(r2Key, body, {
      httpMetadata: { contentType: request.headers.get("Content-Type") || "application/octet-stream" },
    });

    // Bridge Legado WebDAV sync to D1 database for real-time progress & source synchronization
    const baseDocName = cleanPath.split("/").pop() || "";
    if (
      baseDocName === "bookshelf.json" ||
      baseDocName === "bookSource.json" ||
      baseDocName === "bookmark.json" ||
      baseDocName === "replaceRule.json"
    ) {
      try {
        const text = new TextDecoder().decode(body);
        const data = JSON.parse(text);
        if (baseDocName === "bookshelf.json" && Array.isArray(data)) {
          await saveDocument(env, userNs, "bookshelf.json", data);
        } else if (baseDocName === "bookSource.json" && Array.isArray(data)) {
          const now = Math.floor(Date.now() / 1000);
          const stmts = data.filter((s: any) => s && s.bookSourceUrl).map((s: any) =>
            env.DB.prepare(
              `INSERT INTO book_sources (user_ns, book_source_url, book_source_name, json, updated_at)
               VALUES (?1, ?2, ?3, ?4, ?5)
               ON CONFLICT(user_ns, book_source_url) DO UPDATE SET
               book_source_name=excluded.book_source_name, json=excluded.json, updated_at=excluded.updated_at`
            ).bind(userNs, s.bookSourceUrl, s.bookSourceName || "", JSON.stringify(s), now)
          );
          for (let i = 0; i < stmts.length; i += 50) {
            await env.DB.batch(stmts.slice(i, i + 50));
          }
        } else {
          await saveDocument(env, userNs, baseDocName, data);
        }
      } catch (e) {
        console.error("WebDAV to D1 bridge error:", e);
      }
    }

    return new Response(null, { status: 201, headers: corsHeaders() });
  }

  // 5. GET / HEAD: Download File
  if (method === "GET" || method === "HEAD") {
    const baseDocName = cleanPath.split("/").pop() || "";
    if (
      baseDocName === "bookshelf.json" ||
      baseDocName === "bookmark.json" ||
      baseDocName === "replaceRule.json"
    ) {
      const doc = await getDocument(env, userNs, baseDocName);
      if (doc) {
        const jsonText = JSON.stringify(doc, null, 2);
        const bytes = new TextEncoder().encode(jsonText);
        return new Response(method === "HEAD" ? null : bytes, {
          status: 200,
          headers: {
            "Content-Type": "application/json; charset=utf-8",
            "Content-Length": bytes.length.toString(),
            ...corsHeaders(),
          },
        });
      }
    }

    const obj = await env.BUCKET.get(r2Key);
    if (!obj) return new Response("Not Found", { status: 404, headers: corsHeaders() });
    const headers = new Headers(corsHeaders());
    headers.set("Content-Type", obj.httpMetadata?.contentType || "application/octet-stream");
    headers.set("Content-Length", obj.size.toString());
    return new Response(method === "HEAD" ? null : obj.body, { status: 200, headers });
  }

  // 6. DELETE: Remove File or Directory
  if (method === "DELETE") {
    await env.BUCKET.delete(r2Key);
    const listed = await env.BUCKET.list({ prefix: `${r2Key}/` });
    for (const obj of listed.objects || []) {
      await env.BUCKET.delete(obj.key);
    }
    return new Response(null, { status: 204, headers: corsHeaders() });
  }

  // 7. LOCK / UNLOCK: Virtual lock for client concurrency
  if (method === "LOCK") {
    const lockToken = `urn:uuid:${crypto.randomUUID()}`;
    const lockXml = `<?xml version="1.0" encoding="utf-8"?><D:prop xmlns:D="DAV:"><D:lockdiscovery><D:activelock><D:locktype><write/></D:locktype><D:lockscope><exclusive/></D:lockscope><D:locktoken><D:href>${lockToken}</D:href></D:locktoken><D:timeout>Second-3600</D:timeout></D:activelock></D:lockdiscovery></D:prop>`;
    return new Response(lockXml, {
      status: 200,
      headers: {
        "Content-Type": "application/xml; charset=utf-8",
        "Lock-Token": `<${lockToken}>`,
        ...corsHeaders(),
      },
    });
  }

  if (method === "UNLOCK") {
    return new Response(null, { status: 204, headers: corsHeaders() });
  }

  return new Response("Method Not Allowed", { status: 405, headers: corsHeaders() });
}

// ==========================================
// 12. Remote WebDAV Sync Handlers & Engine
// ==========================================

async function handleGetRemoteWebdav(request: Request, env: Env): Promise<Response> {
  const userNs = await resolveUserNs(request, env);
  if (!userNs) return jsonResponse({ isSuccess: false, errorMsg: "请登录后使用", data: "NEED_LOGIN" });

  const row = await env.DB.prepare(
    `SELECT server_url, webdav_user, webdav_password, enabled, sync_on_change, sync_interval_mins, last_sync_at, last_sync_status, last_sync_error FROM user_remote_webdav WHERE username = ?1`
  )
    .bind(userNs)
    .first<{
      server_url: string;
      webdav_user: string;
      webdav_password: string;
      enabled: number;
      sync_on_change: number;
      sync_interval_mins: number;
      last_sync_at: number;
      last_sync_status: string;
      last_sync_error: string | null;
    }>();

  if (!row) {
    return jsonResponse({
      isSuccess: true,
      data: {
        enabled: false,
        serverUrl: "",
        webdavUser: "",
        hasPassword: false,
        syncOnChange: true,
        syncIntervalMins: 5,
        lastSyncAt: 0,
        lastSyncStatus: "",
        lastSyncError: null,
      },
    });
  }

  return jsonResponse({
    isSuccess: true,
    data: {
      enabled: row.enabled === 1,
      serverUrl: row.server_url,
      webdavUser: row.webdav_user,
      hasPassword: !!row.webdav_password,
      syncOnChange: row.sync_on_change === 1,
      syncIntervalMins: row.sync_interval_mins || 5,
      lastSyncAt: row.last_sync_at || 0,
      lastSyncStatus: row.last_sync_status || "",
      lastSyncError: row.last_sync_error,
    },
  });
}

async function handleSaveRemoteWebdav(request: Request, env: Env): Promise<Response> {
  const userNs = await resolveUserNs(request, env);
  if (!userNs) return jsonResponse({ isSuccess: false, errorMsg: "请登录后使用", data: "NEED_LOGIN" });

  const body = await request.json<any>();
  const { enabled, serverUrl, webdavUser, webdavPassword, syncOnChange, syncIntervalMins } = body;

  const now = Math.floor(Date.now() / 1000);
  const enabledInt = enabled ? 1 : 0;
  const syncOnChangeInt = syncOnChange ? 1 : 0;
  const interval = parseInt(syncIntervalMins || "5", 10) || 5;

  const existing = await env.DB.prepare(
    `SELECT webdav_password FROM user_remote_webdav WHERE username = ?1`
  )
    .bind(userNs)
    .first<{ webdav_password: string }>();

  let passwordToSave = existing?.webdav_password || "";
  if (webdavPassword && webdavPassword !== "******") {
    passwordToSave = webdavPassword;
  }

  await env.DB.prepare(
    `INSERT INTO user_remote_webdav (username, enabled, server_url, webdav_user, webdav_password, sync_on_change, sync_interval_mins, updated_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
     ON CONFLICT(username) DO UPDATE SET
       enabled = excluded.enabled,
       server_url = excluded.server_url,
       webdav_user = excluded.webdav_user,
       webdav_password = excluded.webdav_password,
       sync_on_change = excluded.sync_on_change,
       sync_interval_mins = excluded.sync_interval_mins,
       updated_at = excluded.updated_at`
  )
    .bind(userNs, enabledInt, serverUrl || "", webdavUser || "", passwordToSave, syncOnChangeInt, interval, now)
    .run();

  return jsonResponse({ isSuccess: true, data: "配置保存成功" });
}

async function handleTestRemoteWebdav(request: Request, env: Env): Promise<Response> {
  const userNs = await resolveUserNs(request, env);
  if (!userNs) return jsonResponse({ isSuccess: false, errorMsg: "请登录后使用", data: "NEED_LOGIN" });

  const body = await request.json<any>();
  let { serverUrl, webdavUser, webdavPassword } = body;

  if (webdavPassword === "******") {
    const existing = await env.DB.prepare(
      `SELECT webdav_password FROM user_remote_webdav WHERE username = ?1`
    ).bind(userNs).first<{ webdav_password: string }>();
    webdavPassword = existing?.webdav_password || "";
  }

  if (!serverUrl || !webdavUser || !webdavPassword) {
    return jsonResponse({ isSuccess: false, errorMsg: "请填写完整 WebDAV 地址、用户名和密码" });
  }

  if (!isSafeRemoteUrl(serverUrl)) {
    return jsonResponse({ isSuccess: false, errorMsg: "WebDAV 地址不合法或指向受限网络" });
  }

  try {
    const baseUrl = serverUrl.replace(/\/$/, "");
    const authHeader = `Basic ${btoa(webdavUser + ":" + webdavPassword)}`;
    const resp = await fetch(baseUrl, {
      method: "OPTIONS",
      headers: { Authorization: authHeader },
    });

    if (resp.status === 401 || resp.status === 403) {
      return jsonResponse({ isSuccess: false, errorMsg: "认证失败，请检查 WebDAV 账号或应用密码" });
    }
    if (resp.ok || resp.status === 405 || resp.status === 207) {
      return jsonResponse({ isSuccess: true, data: "连接成功！远端 WebDAV 服务正常响应" });
    }

    return jsonResponse({ isSuccess: false, errorMsg: `远端返回 HTTP ${resp.status}` });
  } catch (err: any) {
    return jsonResponse({ isSuccess: false, errorMsg: `连接失败: ${err.message}` });
  }
}

async function handleSyncRemoteWebdavNow(request: Request, env: Env): Promise<Response> {
  const userNs = await resolveUserNs(request, env);
  if (!userNs) return jsonResponse({ isSuccess: false, errorMsg: "请登录后使用", data: "NEED_LOGIN" });

  const res = await syncUserToRemoteWebdav(env, userNs);
  if (res.success) {
    return jsonResponse({ isSuccess: true, data: "同步成功" });
  } else {
    return jsonResponse({ isSuccess: false, errorMsg: res.error || "同步失败" });
  }
}

function triggerOnChangeSync(env: Env, userNs: string, ctx: ExecutionContext): void {
  ctx.waitUntil(
    (async () => {
      try {
        const row = await env.DB.prepare(
          `SELECT enabled, sync_on_change, last_sync_at FROM user_remote_webdav WHERE username = ?1`
        )
          .bind(userNs)
          .first<{ enabled: number; sync_on_change: number; last_sync_at: number }>();

        if (row && row.enabled === 1 && row.sync_on_change === 1) {
          const now = Math.floor(Date.now() / 1000);
          if (now - (row.last_sync_at || 0) >= 30) {
            await syncUserToRemoteWebdav(env, userNs);
          }
        }
      } catch (e) {
        console.error("OnChange sync error:", e);
      }
    })()
  );
}

async function handleScheduledSync(env: Env): Promise<void> {
  try {
    const rows = await env.DB.prepare(
      `SELECT username, last_sync_at, sync_interval_mins FROM user_remote_webdav WHERE enabled = 1`
    ).all<{ username: string; last_sync_at: number; sync_interval_mins: number }>();

    const now = Math.floor(Date.now() / 1000);
    for (const r of rows.results || []) {
      const intervalSecs = (r.sync_interval_mins || 5) * 60;
      if (now - (r.last_sync_at || 0) >= intervalSecs) {
        await syncUserToRemoteWebdav(env, r.username);
      }
    }
  } catch (e) {
    console.error("Scheduled sync error:", e);
  }
}

async function remoteWebdavEnsureDir(baseUrl: string, authHeader: string, relPath: string): Promise<void> {
  const parts = relPath.replace(/^\/+/, "").split("/").filter(Boolean);
  parts.pop(); // remove file name, keep directory path
  let current = baseUrl.replace(/\/$/, "");
  for (const seg of parts) {
    current += `/${seg}`;
    try {
      await fetch(current, {
        method: "MKCOL",
        headers: { Authorization: authHeader },
      });
    } catch {
      // ignore (MKCOL on existing collection returns 405)
    }
  }
}

async function remoteWebdavPutFile(
  baseUrl: string,
  authHeader: string,
  relPath: string,
  body: Uint8Array | string,
  contentType: string = "application/octet-stream"
): Promise<boolean> {
  const cleanBase = baseUrl.replace(/\/$/, "");
  const cleanRel = relPath.replace(/^\/+/, "");
  await remoteWebdavEnsureDir(cleanBase, authHeader, cleanRel);

  const url = `${cleanBase}/${cleanRel}`;
  const resp = await fetch(url, {
    method: "PUT",
    headers: {
      Authorization: authHeader,
      "Content-Type": contentType,
    },
    body,
  });

  return resp.ok || resp.status === 201 || resp.status === 204;
}

async function remoteWebdavGetFile(
  baseUrl: string,
  authHeader: string,
  relPath: string,
  range?: { offset: number; length?: number }
): Promise<Uint8Array | null> {
  const cleanBase = baseUrl.replace(/\/$/, "");
  const cleanRel = relPath.replace(/^\/+/, "");
  const url = `${cleanBase}/${cleanRel}`;

  const headers: Record<string, string> = {
    Authorization: authHeader,
  };

  if (range) {
    const end = range.length !== undefined ? range.offset + range.length - 1 : "";
    headers["Range"] = `bytes=${range.offset}-${end}`;
  }

  try {
    const resp = await fetch(url, { headers });
    if (resp.status === 404) return null;
    if (!resp.ok && resp.status !== 206) return null;
    return new Uint8Array(await resp.arrayBuffer());
  } catch {
    return null;
  }
}

async function fallbackFetchFromRemoteWebdav(
  env: Env,
  relKey: string,
  range?: { offset: number; length?: number }
): Promise<Uint8Array | null> {
  try {
    const parts = relKey.replace(/^\/+/, "").split("/");
    const username = parts.length > 1 ? parts[1] : "default";

    const config = await env.DB.prepare(
      `SELECT server_url, webdav_user, webdav_password, enabled FROM user_remote_webdav WHERE username = ?1`
    )
      .bind(username)
      .first<{ server_url: string; webdav_user: string; webdav_password: string; enabled: number }>();

    if (!config || config.enabled !== 1 || !config.server_url) return null;
    const authHeader = `Basic ${btoa(config.webdav_user + ":" + config.webdav_password)}`;
    return await remoteWebdavGetFile(config.server_url, authHeader, relKey, range);
  } catch {
    return null;
  }
}

async function syncUserToRemoteWebdav(env: Env, username: string): Promise<{ success: boolean; error?: string }> {
  try {
    const config = await env.DB.prepare(
      `SELECT server_url, webdav_user, webdav_password, enabled, last_sync_at FROM user_remote_webdav WHERE username = ?1`
    )
      .bind(username)
      .first<{ server_url: string; webdav_user: string; webdav_password: string; enabled: number; last_sync_at: number }>();

    if (!config || config.enabled !== 1 || !config.server_url) {
      return { success: false, error: "未启用远端同步或未配置地址" };
    }

    if (!isSafeRemoteUrl(config.server_url)) {
      throw new Error("远端 WebDAV 地址不合法或指向受限网络");
    }

    const cleanBase = config.server_url.replace(/\/$/, "");
    const authHeader = `Basic ${btoa(config.webdav_user + ":" + config.webdav_password)}`;

    // 1. Gather all data for this user
    const [shelf, groups, sources, rss, bookmarks, rules] = await Promise.all([
      getDocument(env, username, "bookshelf.json"),
      getDocument(env, username, "bookGroup.json"),
      env.DB.prepare(`SELECT json FROM book_sources WHERE user_ns = ?1`).bind(username).all<{ json: string }>(),
      getDocument(env, username, "rssSource.json"),
      getDocument(env, username, "bookmark.json"),
      getDocument(env, username, "replaceRule.json"),
    ]);

    const parsedSources = (sources.results || []).map((r) => {
      try { return JSON.parse(r.json); } catch { return null; }
    }).filter(Boolean);

    // ==============================================================
    // PART A: 1:1 Mirror User Personal Folder (data/, assets/, books/, webdav/)
    // Allows remote WebDAV to seamlessly replace local R2 when needed!
    // ==============================================================
    const jsonFiles: Record<string, string> = {
      [`data/${username}/bookshelf.json`]: JSON.stringify(shelf || [], null, 2),
      [`data/${username}/bookGroup.json`]: JSON.stringify(groups || [], null, 2),
      [`data/${username}/bookSource.json`]: JSON.stringify(parsedSources, null, 2),
      [`data/${username}/rssSource.json`]: JSON.stringify(rss || [], null, 2),
      [`data/${username}/bookmark.json`]: JSON.stringify(bookmarks || [], null, 2),
      [`data/${username}/replaceRule.json`]: JSON.stringify(rules || [], null, 2),
    };

    for (const [relPath, content] of Object.entries(jsonFiles)) {
      await remoteWebdavPutFile(cleanBase, authHeader, relPath, content, "application/json;charset=utf-8");
    }

    // Mirror user R2 storage objects (assets, epubs, pdfs, mobis, webdav)
    const prefixes = [
      `assets/${username}/`,
      `txts/${username}/`,
      `epubs/${username}/`,
      `pdfs/${username}/`,
      `mobis/${username}/`,
      `webdav/${username}/`,
    ];

    for (const prefix of prefixes) {
      const listed = await env.BUCKET.list({ prefix, limit: 100 });
      for (const obj of listed.objects || []) {
        if (obj.key.endsWith("/")) continue;
        const r2File = await env.BUCKET.get(obj.key);
        if (r2File) {
          const bodyBytes = new Uint8Array(await r2File.arrayBuffer());
          const ct = r2File.httpMetadata?.contentType || "application/octet-stream";
          await remoteWebdavPutFile(cleanBase, authHeader, obj.key, bodyBytes, ct);
        }
      }
    }

    // ==============================================================
    // PART B: Extra Full-Asset Standalone Backup ZIP Archive
    // (Contains: bookshelf + progress, bookSources, groups, rules, bookmarks, rss, readConfig)
    // ==============================================================
    const zipArchiveFiles: Record<string, string> = {
      "bookshelf.json": JSON.stringify(shelf || [], null, 2),
      "bookGroup.json": JSON.stringify(groups || [], null, 2),
      "bookSource.json": JSON.stringify(parsedSources, null, 2),
      "rssSource.json": JSON.stringify(rss || [], null, 2),
      "bookmark.json": JSON.stringify(bookmarks || [], null, 2),
      "replaceRule.json": JSON.stringify(rules || [], null, 2),
    };

    const zipBytes = await createZipArchive(zipArchiveFiles);

    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, "0");
    const timestampZip = `backups/backup-${username}-${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}-${pad(now.getHours())}-${pad(now.getMinutes())}.zip`;
    const latestZip = `backups/backup-${username}-latest.zip`;

    await remoteWebdavPutFile(cleanBase, authHeader, timestampZip, zipBytes, "application/zip");
    await remoteWebdavPutFile(cleanBase, authHeader, latestZip, zipBytes, "application/zip");

    const nowTs = Math.floor(Date.now() / 1000);
    await env.DB.prepare(
      `UPDATE user_remote_webdav SET last_sync_at = ?1, last_sync_status = 'success', last_sync_error = NULL WHERE username = ?2`
    )
      .bind(nowTs, username)
      .run();

    return { success: true };
  } catch (err: any) {
    const nowTs = Math.floor(Date.now() / 1000);
    await env.DB.prepare(
      `UPDATE user_remote_webdav SET last_sync_at = ?1, last_sync_status = 'failed', last_sync_error = ?2 WHERE username = ?3`
    )
      .bind(nowTs, err.message, username)
      .run();
    return { success: false, error: err.message };
  }
}

// === ZIP Creation Helpers for Worker ===

const CRC_TABLE = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
  let c = i;
  for (let k = 0; k < 8; k++) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  CRC_TABLE[i] = c >>> 0;
}

function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) {
    crc = CRC_TABLE[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

async function compressDeflate(data: Uint8Array): Promise<{ bytes: Uint8Array; method: number }> {
  try {
    const cs = new CompressionStream("deflate-raw");
    const writer = cs.writable.getWriter();
    writer.write(data);
    writer.close();
    const compressed = await new Response(cs.readable).arrayBuffer();
    return { bytes: new Uint8Array(compressed), method: 8 };
  } catch {
    return { bytes: data, method: 0 };
  }
}

async function createZipArchive(files: Record<string, string>): Promise<Uint8Array> {
  const encoder = new TextEncoder();
  const fileRecords: Array<{
    nameBytes: Uint8Array;
    crc: number;
    compressedBytes: Uint8Array;
    uncompressedSize: number;
    method: number;
    localHeaderOffset: number;
  }> = [];

  const localChunks: Uint8Array[] = [];
  let currentOffset = 0;

  for (const [name, content] of Object.entries(files)) {
    const data = encoder.encode(content);
    const nameBytes = encoder.encode(name);
    const crc = crc32(data);
    const uncompressedSize = data.length;

    const { bytes: compressedBytes, method } = await compressDeflate(data);
    const localHeaderOffset = currentOffset;

    const localHeader = new Uint8Array(30 + nameBytes.length);
    const view = new DataView(localHeader.buffer);
    view.setUint32(0, 0x04034b50, true);
    view.setUint16(4, 20, true);
    view.setUint16(6, 0x0800, true);
    view.setUint16(8, method, true);
    view.setUint16(10, 0, true);
    view.setUint16(12, 0, true);
    view.setUint32(14, crc, true);
    view.setUint32(18, compressedBytes.length, true);
    view.setUint32(22, uncompressedSize, true);
    view.setUint16(26, nameBytes.length, true);
    view.setUint16(28, 0, true);
    localHeader.set(nameBytes, 30);

    localChunks.push(localHeader);
    localChunks.push(compressedBytes);
    currentOffset += localHeader.length + compressedBytes.length;

    fileRecords.push({
      nameBytes,
      crc,
      compressedBytes,
      uncompressedSize,
      method,
      localHeaderOffset,
    });
  }

  const centralDirOffset = currentOffset;
  const centralChunks: Uint8Array[] = [];

  for (const record of fileRecords) {
    const cdHeader = new Uint8Array(46 + record.nameBytes.length);
    const view = new DataView(cdHeader.buffer);
    view.setUint32(0, 0x02014b50, true);
    view.setUint16(4, 20, true);
    view.setUint16(6, 20, true);
    view.setUint16(8, 0x0800, true);
    view.setUint16(10, record.method, true);
    view.setUint16(12, 0, true);
    view.setUint16(14, 0, true);
    view.setUint32(16, record.crc, true);
    view.setUint32(20, record.compressedBytes.length, true);
    view.setUint32(24, record.uncompressedSize, true);
    view.setUint16(28, record.nameBytes.length, true);
    view.setUint16(30, 0, true);
    view.setUint16(32, 0, true);
    view.setUint16(34, 0, true);
    view.setUint16(36, 0, true);
    view.setUint32(38, 0, true);
    view.setUint32(42, record.localHeaderOffset, true);
    cdHeader.set(record.nameBytes, 46);

    centralChunks.push(cdHeader);
    currentOffset += cdHeader.length;
  }

  const centralDirSize = currentOffset - centralDirOffset;

  const eocd = new Uint8Array(22);
  const eocdView = new DataView(eocd.buffer);
  eocdView.setUint32(0, 0x06054b50, true);
  eocdView.setUint16(4, 0, true);
  eocdView.setUint16(6, 0, true);
  eocdView.setUint16(8, fileRecords.length, true);
  eocdView.setUint16(10, fileRecords.length, true);
  eocdView.setUint32(12, centralDirSize, true);
  eocdView.setUint32(16, centralDirOffset, true);
  eocdView.setUint16(20, 0, true);

  const totalLength = currentOffset + eocd.length;
  const result = new Uint8Array(totalLength);
  let pos = 0;
  for (const chunk of [...localChunks, ...centralChunks, eocd]) {
    result.set(chunk, pos);
    pos += chunk.length;
  }
  return result;
}

// ==========================================
// 13. TXT Novel Streaming & Heading Indexer
// ==========================================

function decodeTxtBytes(bytes: Uint8Array): string {
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return new TextDecoder("utf-8").decode(bytes.subarray(3));
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    try {
      return new TextDecoder("gb18030").decode(bytes);
    } catch {
      return new TextDecoder("utf-8").decode(bytes);
    }
  }
}

function scanTxtChapterOffsets(text: string, utf8Bytes: Uint8Array): Array<{ title: string; offset: number; length: number }> {
  const regex = /^\s*(第[0-9一二三四五六七八九十百千万零两]+[章回节卷集幕篇部话段]|Chapter\s+\d+|序章|引子|楔子|尾声|番外)[^\r\n]*$/gm;
  const matches: Array<{ title: string; charIndex: number }> = [];

  let match;
  while ((match = regex.exec(text)) !== null) {
    matches.push({
      title: match[0].trim(),
      charIndex: match.index,
    });
  }

  if (matches.length === 0) {
    return [{ title: "全本", offset: 0, length: utf8Bytes.length }];
  }

  // Convert charIndex to UTF-8 byte offset
  let curChar = 0;
  let curByte = 0;
  let matchPtr = 0;

  const byteOffsets: number[] = [];
  while (curChar < text.length && matchPtr < matches.length) {
    if (curChar === matches[matchPtr].charIndex) {
      byteOffsets.push(curByte);
      matchPtr++;
    }
    const code = text.charCodeAt(curChar);
    curChar++;
    if (code <= 0x7f) curByte += 1;
    else if (code <= 0x7ff) curByte += 2;
    else if (code >= 0xd800 && code <= 0xdbff) {
      curChar++;
      curByte += 4;
    } else curByte += 3;
  }

  const chapters: Array<{ title: string; offset: number; length: number }> = [];

  // If first chapter starts after character 0, add "序章"
  if (byteOffsets.length > 0 && byteOffsets[0] > 0) {
    chapters.push({
      title: "序章",
      offset: 0,
      length: byteOffsets[0],
    });
  }

  for (let i = 0; i < byteOffsets.length; i++) {
    const start = byteOffsets[i];
    const end = i + 1 < byteOffsets.length ? byteOffsets[i + 1] : utf8Bytes.length;
    const len = end - start;
    if (len > 0) {
      chapters.push({
        title: matches[i].title,
        offset: start,
        length: len,
      });
    }
  }

  return chapters;
}

async function handleTxtUpload(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  try {
    const userNs = (await resolveUserNs(request, env)) || "default";
    let fileName = "book.txt";
    let fileBuffer: ArrayBuffer;

    const contentType = request.headers.get("Content-Type") || "";
    if (contentType.includes("multipart/form-data")) {
      const formData = await request.formData();
      const file = formData.get("file") as File | null;
      if (!file) return jsonResponse({ isSuccess: false, errorMsg: "缺少 TXT 文件" });
      fileName = file.name || "book.txt";
      fileBuffer = await file.arrayBuffer();
    } else {
      fileName = request.headers.get("X-File-Name") || "book.txt";
      fileBuffer = await request.arrayBuffer();
    }

    const rawBytes = new Uint8Array(fileBuffer);
    if (rawBytes.length === 0) return jsonResponse({ isSuccess: false, errorMsg: "文件内容为空" });
    if (rawBytes.length > 50 * 1024 * 1024) return jsonResponse({ isSuccess: false, errorMsg: "文件不能超过 50MB" });

    // 1. Decode with automatic GBK / UTF-8 detection
    const text = decodeTxtBytes(rawBytes);
    // 2. Re-encode to clean UTF-8
    const utf8Bytes = new TextEncoder().encode(text);
    const fileSize = utf8Bytes.length;

    const bookId = `txt_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
    const r2Key = `txts/${userNs}/${bookId}.txt`;

    // 3. Store UTF-8 text into R2
    await env.BUCKET.put(r2Key, utf8Bytes, {
      httpMetadata: { contentType: "text/plain; charset=utf-8" },
    });

    // 4. Scan chapter heading offsets
    const chapters = scanTxtChapterOffsets(text, utf8Bytes);
    const totalChapters = chapters.length;
    const title = fileName.replace(/\.txt$/i, "");
    const now = Math.floor(Date.now() / 1000);

    // 5. Save metadata into D1 txt_books
    await env.DB.prepare(
      `INSERT INTO txt_books (book_id, user_ns, file_name, r2_key, file_size, total_chapters, title, author, status, created_at, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, '本地导入', 'ready', ?8, ?9)
       ON CONFLICT(book_id) DO UPDATE SET file_size=excluded.file_size, total_chapters=excluded.total_chapters, title=excluded.title, updated_at=excluded.updated_at`
    )
      .bind(bookId, userNs, fileName, r2Key, fileSize, totalChapters, title, now, now)
      .run();

    // 6. Batch save chapter slice indices into D1 txt_chapters
    const stmts = chapters.map((ch, idx) =>
      env.DB.prepare(
        `INSERT INTO txt_chapters (book_id, chapter_index, title, byte_offset, byte_length, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)
         ON CONFLICT(book_id, chapter_index) DO UPDATE SET byte_offset=excluded.byte_offset, byte_length=excluded.byte_length`
      ).bind(bookId, idx, ch.title, ch.offset, ch.length, now)
    );

    for (let i = 0; i < stmts.length; i += 50) {
      await env.DB.batch(stmts.slice(i, i + 50));
    }

    // 7. Add book to user's bookshelf.json
    const bookUrl = `local-txt:${bookId}`;
    const newBook = {
      name: title,
      author: "本地导入",
      bookUrl: bookUrl,
      origin: "local-txt",
      originName: "本地 TXT",
      tocUrl: bookUrl,
      canUpdate: false,
      durChapterIndex: 0,
      durChapterPos: 0,
      durChapterTitle: chapters[0]?.title || "第一章",
      durChapterTime: Date.now(),
      totalChapterNum: totalChapters,
      latestChapterTitle: chapters[chapters.length - 1]?.title,
      kind: "本地TXT",
      wordCount: `${text.length}字`,
    };

    let shelf: any[] = (await getDocument(env, userNs, "bookshelf.json")) || [];
    const idx = shelf.findIndex((b) => b.bookUrl === bookUrl);
    if (idx >= 0) shelf[idx] = newBook;
    else shelf.unshift(newBook);
    await saveDocument(env, userNs, "bookshelf.json", shelf);

    triggerOnChangeSync(env, userNs, ctx);

    return jsonResponse({
      isSuccess: true,
      data: newBook,
    });
  } catch (err: any) {
    return jsonResponse({ isSuccess: false, errorMsg: err.message });
  }
}

async function handleTxtRead(bookId: string, chapterIndex: number, env: Env): Promise<Response> {
  try {
    const text = await readTxtChapterText(bookId, chapterIndex, env);
    return new Response(text, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        ...corsHeaders(),
      },
    });
  } catch (err: any) {
    return jsonResponse({ isSuccess: false, errorMsg: err.message });
  }
}

async function readTxtChapterText(bookId: string, chapterIndex: number, env: Env): Promise<string> {
  const chapter = await env.DB.prepare(
    `SELECT c.byte_offset, c.byte_length, b.r2_key
     FROM txt_chapters c
     JOIN txt_books b ON c.book_id = b.book_id
     WHERE c.book_id = ?1 AND c.chapter_index = ?2`
  )
    .bind(bookId, chapterIndex)
    .first<{ byte_offset: number; byte_length: number; r2_key: string }>();

  if (!chapter) throw new Error("未找到该 TXT 章节切片");

  const obj = await env.BUCKET.get(chapter.r2_key, {
    range: { offset: chapter.byte_offset, length: chapter.byte_length },
  });
  let payload: Uint8Array | null = obj ? new Uint8Array(await obj.arrayBuffer()) : null;

  if (!payload) {
    // Fallback to remote WebDAV if R2 is unavailable or missing object
    payload = await fallbackFetchFromRemoteWebdav(env, chapter.r2_key, {
      offset: chapter.byte_offset,
      length: chapter.byte_length,
    });
  }

  if (!payload) throw new Error("无法读取 TXT 章节数据 (R2 与远端 WebDAV 均未命中)");
  return new TextDecoder().decode(payload);
}

async function handleTxtInfo(bookId: string, env: Env): Promise<Response> {
  const book = await env.DB.prepare(
    `SELECT book_id, file_name, title, author, total_chapters, file_size, status FROM txt_books WHERE book_id = ?1`
  )
    .bind(bookId)
    .first();

  if (!book) return jsonResponse({ isSuccess: false, errorMsg: "未找到该 TXT 书籍" });
  return jsonResponse({ isSuccess: true, data: book });
}

// ==========================================
// 14. AI Companion & Reading Assistant Handlers
// ==========================================

async function handleGetAiBookMemory(request: Request, env: Env): Promise<Response> {
  const userNs = await resolveUserNs(request, env);
  if (!userNs) return jsonResponse({ isSuccess: false, errorMsg: "请登录后使用", data: "NEED_LOGIN" });

  const url = new URL(request.url);
  let bookUrl = url.searchParams.get("bookUrl") || url.searchParams.get("url") || "";
  if (!bookUrl && request.method === "POST") {
    try {
      const body = await request.json<any>();
      bookUrl = body.bookUrl || body.url || "";
    } catch {
      // ignore
    }
  }

  if (!bookUrl) return jsonResponse({ isSuccess: false, errorMsg: "缺少 bookUrl" });

  const bookKey = md5(bookUrl);
  const row = await env.DB.prepare(
    `SELECT json FROM ai_book_memories WHERE user_ns = ?1 AND book_key = ?2`
  )
    .bind(userNs, bookKey)
    .first<{ json: string }>();

  if (!row) return jsonResponse({ isSuccess: true, data: null });
  return jsonResponse({ isSuccess: true, data: JSON.parse(row.json) });
}

async function handleSaveAiBookMemory(request: Request, env: Env): Promise<Response> {
  const userNs = await resolveUserNs(request, env);
  if (!userNs) return jsonResponse({ isSuccess: false, errorMsg: "请登录后使用", data: "NEED_LOGIN" });

  const memory = await request.json<any>();
  const bookUrl = memory.bookUrl || memory.book_url || "";
  if (!bookUrl) return jsonResponse({ isSuccess: false, errorMsg: "缺少 bookUrl" });

  const bookKey = md5(bookUrl);
  const now = Math.floor(Date.now() / 1000);
  if (!memory.updatedAt) memory.updatedAt = Date.now();

  await env.DB.prepare(
    `INSERT INTO ai_book_memories (user_ns, book_key, book_url, json, updated_at)
     VALUES (?1, ?2, ?3, ?4, ?5)
     ON CONFLICT(user_ns, book_key) DO UPDATE SET
       book_url = excluded.book_url,
       json = excluded.json,
       updated_at = excluded.updated_at`
  )
    .bind(userNs, bookKey, bookUrl, JSON.stringify(memory), now)
    .run();

  return jsonResponse({ isSuccess: true, data: memory });
}

async function handleDeleteAiBookMemory(request: Request, env: Env): Promise<Response> {
  const userNs = await resolveUserNs(request, env);
  if (!userNs) return jsonResponse({ isSuccess: false, errorMsg: "请登录后使用", data: "NEED_LOGIN" });

  let bookUrl = new URL(request.url).searchParams.get("bookUrl") || "";
  if (!bookUrl) {
    try {
      const body = await request.json<any>();
      bookUrl = body.bookUrl || body.url || "";
    } catch {
      // ignore
    }
  }

  if (!bookUrl) return jsonResponse({ isSuccess: false, errorMsg: "缺少 bookUrl" });
  const bookKey = md5(bookUrl);

  await env.DB.prepare(
    `DELETE FROM ai_book_memories WHERE user_ns = ?1 AND book_key = ?2`
  )
    .bind(userNs, bookKey)
    .run();

  return jsonResponse({ isSuccess: true, data: { deleted: true } });
}

async function handleAiProxy(request: Request, env: Env): Promise<Response> {
  const userNs = await resolveUserNs(request, env);
  if (!userNs) return jsonResponse({ isSuccess: false, errorMsg: "请登录后使用", data: "NEED_LOGIN" });

  const req = await request.json<any>();
  let baseUrl = req.baseUrl || "";
  let apiKey = req.apiKey || "";
  let path = req.path || "/v1/chat/completions";
  let provider = req.provider || "";

  // 1. Check if server config is requested
  if (req.useServerConfig) {
    const config = await getDocument(env, "__app__", "ai-model-config.json");
    if (config?.text?.enabled) {
      baseUrl = config.text.base_url || config.text.baseUrl || "";
      apiKey = config.text.api_key || config.text.apiKey || "";
      provider = config.text.provider || "";
    }
  }

  // 2. Check if Cloudflare Workers AI is requested or selected as default
  const isWorkersAi =
    provider === "cloudflare" ||
    req.useWorkersAi === true ||
    req.model?.startsWith("@cf/") ||
    req.body?.model?.startsWith("@cf/") ||
    (!baseUrl && !!env.AI);

  if (isWorkersAi && env.AI) {
    return handleWorkersAiInference(req, env, userNs);
  }

  // 3. Fallback to external AI API
  if (!baseUrl) {
    return jsonResponse({ isSuccess: false, errorMsg: "缺少 AI 模型接口地址 (baseUrl)，或未配置 Cloudflare Workers AI" });
  }

  const targetUrl = req.fullUrl ? baseUrl : `${baseUrl.replace(/\/$/, "")}/${path.replace(/^\//, "")}`;
  if (!isSafeRemoteUrl(targetUrl)) {
    return jsonResponse({ isSuccess: false, errorMsg: "禁止访问内网或受限 AI 目标地址 (SSRF 防御)" });
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json",
  };
  if (apiKey) {
    headers["Authorization"] = `Bearer ${apiKey.trim()}`;
  }

  try {
    const upstream = await fetch(targetUrl, {
      method: "POST",
      headers,
      body: JSON.stringify(req.body || {}),
    });

    const respHeaders = new Headers(corsHeaders());
    respHeaders.set("Content-Type", upstream.headers.get("Content-Type") || "application/json");

    return new Response(upstream.body, {
      status: upstream.status,
      headers: respHeaders,
    });
  } catch (err: any) {
    return jsonResponse({ isSuccess: false, errorMsg: `AI 模型上游连接失败: ${err.message}` }, 502);
  }
}

async function handleWorkersAiInference(req: any, env: Env, userNs: string): Promise<Response> {
  const path = req.path || "/v1/chat/completions";

  // Image generation
  if (path === "/v1/images/generations" || req.kind === "image") {
    const model = req.body?.model?.startsWith("@cf/")
      ? req.body.model
      : "@cf/black-forest-labs/flux-1-schnell";

    try {
      const prompt = req.body?.prompt || "";
      const imageBytes = await env.AI.run(model, { prompt });
      const imgKey = `assets/${userNs}/ai-images/img_${Date.now()}.png`;
      await env.BUCKET.put(imgKey, imageBytes, {
        httpMetadata: { contentType: "image/png" },
      });

      return jsonResponse({
        created: Math.floor(Date.now() / 1000),
        data: [{ url: `/${imgKey}` }],
      });
    } catch (err: any) {
      return jsonResponse({ isSuccess: false, errorMsg: `Workers AI 绘图失败: ${err.message}` }, 500);
    }
  }

  // Text chat completions
  const model = req.body?.model?.startsWith("@cf/")
    ? req.body.model
    : "@cf/qwen/qwen1.5-7b-chat";

  const messages = req.body?.messages || [];
  const isStream = req.body?.stream === true;

  try {
    if (isStream) {
      const stream = await env.AI.run(model, {
        messages,
        stream: true,
      });
      const headers = new Headers(corsHeaders());
      headers.set("Content-Type", "text/event-stream");
      headers.set("Cache-Control", "no-cache");
      return new Response(stream, { headers });
    } else {
      const result = await env.AI.run(model, {
        messages,
      });
      const textContent = result.response || result.description || "";
      const openAiFormat = {
        id: `chatcmpl-${Date.now()}`,
        object: "chat.completion",
        created: Math.floor(Date.now() / 1000),
        model,
        choices: [
          {
            index: 0,
            message: {
              role: "assistant",
              content: textContent,
            },
            finish_reason: "stop",
          },
        ],
        usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
      };
      return jsonResponse(openAiFormat);
    }
  } catch (err: any) {
    return jsonResponse({ isSuccess: false, errorMsg: `Workers AI 推理失败: ${err.message}` }, 500);
  }
}

async function handleAiProxyImage(request: Request, env: Env): Promise<Response> {
  const userNs = await resolveUserNs(request, env);
  if (!userNs) return jsonResponse({ isSuccess: false, errorMsg: "请登录后使用", data: "NEED_LOGIN" });

  const { url } = await request.json<{ url: string }>();
  if (!url || !isSafeRemoteUrl(url)) {
    return jsonResponse({ isSuccess: false, errorMsg: "无效或受限的图片地址 (SSRF 防御)" });
  }

  try {
    const upstream = await fetch(url, {
      headers: { Accept: "image/*,*/*;q=0.8" },
    });

    if (!upstream.ok) {
      return jsonResponse({ isSuccess: false, errorMsg: `拉取图片失败 (HTTP ${upstream.status})` });
    }

    const headers = new Headers(corsHeaders());
    headers.set("Content-Type", upstream.headers.get("Content-Type") || "image/png");
    headers.set("Cache-Control", "public, max-age=86400");

    return new Response(upstream.body, { headers });
  } catch (err: any) {
    return jsonResponse({ isSuccess: false, errorMsg: `图片代理失败: ${err.message}` });
  }
}

// ==========================================
// 15. Bounded Multi-Source Search (Scheme 1)
// ==========================================

async function handleSearchBookMulti(request: Request, env: Env): Promise<Response> {
  const userNs = await resolveUserNs(request, env);
  if (!userNs) return jsonResponse({ isSuccess: false, errorMsg: "请登录后使用", data: "NEED_LOGIN" });

  const body = await request.json<any>();
  const key = (body.key || "").trim();
  const page = parseInt(body.page || "1", 10) || 1;
  const bookSourceUrls: string[] | undefined = Array.isArray(body.bookSourceUrls) ? body.bookSourceUrls : undefined;
  const bookSourceGroup: string | undefined = body.bookSourceGroup;

  if (!key) return jsonResponse({ isSuccess: true, data: [] });

  // 1. Fetch enabled book sources from D1
  const rows = await env.DB.prepare(
    `SELECT json FROM book_sources WHERE user_ns = ?1`
  )
    .bind(userNs)
    .all<{ json: string }>();

  let sources: any[] = (rows.results || []).map((r) => {
    try { return JSON.parse(r.json); } catch { return null; }
  }).filter((s) => s && s.enabled !== false && s.searchUrl && s.searchUrl.trim().length > 0);

  if (bookSourceUrls && bookSourceUrls.length > 0) {
    const urlSet = new Set(bookSourceUrls);
    sources = sources.filter((s) => urlSet.has(s.bookSourceUrl));
  } else if (bookSourceGroup) {
    sources = sources.filter((s) => s.bookSourceGroup?.includes(bookSourceGroup));
  }

  // Scheme 1 Safety: Bound to max 20 sources per Worker invocation to never exceed Cloudflare's 50 subrequests limit!
  const targetChunk = sources.slice(0, 20);
  if (targetChunk.length === 0) {
    return jsonResponse({ isSuccess: true, data: [] });
  }

  // 2. Concurrently search the chunk using Promise.allSettled
  const searchTasks = targetChunk.map((source) => searchSingleSource(source, key, page, env));
  const settled = await Promise.allSettled(searchTasks);

  const allBooks: any[] = [];
  for (const res of settled) {
    if (res.status === "fulfilled" && Array.isArray(res.value)) {
      allBooks.push(...res.value);
    }
  }

  return jsonResponse({ isSuccess: true, data: allBooks });
}

async function searchSingleSource(source: any, key: string, page: number, env: Env): Promise<any[]> {
  try {
    let rawUrl = source.searchUrl || "";
    // Clean potential options after comma in Legado URL spec
    let urlConfig = "";
    if (rawUrl.includes(",{") || rawUrl.includes(", {")) {
      const idx = rawUrl.indexOf(",{") !== -1 ? rawUrl.indexOf(",{") : rawUrl.indexOf(", {");
      urlConfig = rawUrl.substring(idx + 1);
      rawUrl = rawUrl.substring(0, idx);
    }

    const encodedKey = encodeURIComponent(key);
    let targetUrl = rawUrl
      .replace(/\{\{key\}\}/g, encodedKey)
      .replace(/\$\{key\}/g, encodedKey)
      .replace(/\{\{page\}\}/g, String(page))
      .replace(/\$\{page\}/g, String(page));

    if (!isSafeRemoteUrl(targetUrl)) return [];

    let html = "";
    const isWebView = urlConfig.includes('"webView":true') || urlConfig.includes('"webView": true');

    if (isWebView && env.CF_ACCOUNT_ID && env.CF_API_TOKEN && env.CF_KITESURF_ENABLED !== "false") {
      try {
        const kResp = await fetch(
          `https://api.cloudflare.com/client/v4/accounts/${env.CF_ACCOUNT_ID}/browser-run/content?browser=kitesurf`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${env.CF_API_TOKEN}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ url: targetUrl, rejectResourceTypes: ["image", "media", "font"] }),
          }
        );
        if (kResp.ok) html = await kResp.text();
      } catch {}
    }

    if (!html) {
      const headers: Record<string, string> = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      };
      if (source.header) {
        try {
          const parsedHeaders = JSON.parse(source.header);
          Object.assign(headers, parsedHeaders);
        } catch {}
      }

      const resp = await fetch(targetUrl, { headers });
      if (resp.ok) html = await resp.text();
    }

    if (!html) return [];

    return extractSearchResults(html, source, targetUrl, key);
  } catch {
    return [];
  }
}

function extractSearchResults(html: string, source: any, baseUrl: string, keyword: string): any[] {
  const books: any[] = [];
  let baseDomain = "";
  try {
    baseDomain = new URL(baseUrl).origin;
  } catch {
    return [];
  }

  // Pattern: extract links matching the keyword
  const linkRegex = /<a\s+[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match;
  const seenUrls = new Set<string>();

  while ((match = linkRegex.exec(html)) !== null) {
    let href = match[1].trim();
    const rawText = match[2].replace(/<[^>]+>/g, "").trim();

    if (rawText.toLowerCase().includes(keyword.toLowerCase())) {
      let bookUrl = href;
      if (bookUrl.startsWith("/")) {
        bookUrl = `${baseDomain}${bookUrl}`;
      } else if (!bookUrl.startsWith("http://") && !bookUrl.startsWith("https://")) {
        bookUrl = `${baseDomain}/${bookUrl}`;
      }

      if (!seenUrls.has(bookUrl)) {
        seenUrls.add(bookUrl);
        books.push({
          name: rawText,
          author: source.bookSourceName || "网络来源",
          bookUrl,
          origin: source.bookSourceUrl,
          originName: source.bookSourceName,
          kind: "网络连载",
        });
      }
    }
  }

  return books.slice(0, 5);
}

// ==========================================
// 16. Bookshelf, Chapter List & Book Info
// ==========================================

async function handleGetShelfBook(request: Request, env: Env): Promise<Response> {
  const userNs = await resolveUserNs(request, env);
  if (!userNs) return jsonResponse({ isSuccess: false, errorMsg: "请登录后使用", data: "NEED_LOGIN" });

  let url = new URL(request.url).searchParams.get("url") || "";
  if (!url && request.method === "POST") {
    try {
      const body = await request.json<any>();
      url = body.url || "";
    } catch {}
  }

  const shelf: any[] = (await getDocument(env, userNs, "bookshelf.json")) || [];
  const book = shelf.find((b) => b.bookUrl === url);
  if (!book) return jsonResponse({ isSuccess: false, errorMsg: "书籍未在书架中" });
  return jsonResponse({ isSuccess: true, data: book });
}

async function handleGetBookInfo(request: Request, env: Env): Promise<Response> {
  const userNs = await resolveUserNs(request, env);
  if (!userNs) return jsonResponse({ isSuccess: false, errorMsg: "请登录后使用", data: "NEED_LOGIN" });

  let url = new URL(request.url).searchParams.get("url") || "";
  if (!url && request.method === "POST") {
    try {
      const body = await request.json<any>();
      url = body.url || "";
    } catch {}
  }

  if (url.startsWith("local-txt:")) {
    const bookId = url.split(":")[1].split("#")[0];
    const info = await env.DB.prepare(`SELECT * FROM txt_books WHERE book_id = ?1`).bind(bookId).first<any>();
    if (info) {
      return jsonResponse({
        isSuccess: true,
        data: {
          name: info.title,
          author: info.author,
          bookUrl: url,
          totalChapterNum: info.total_chapters,
          origin: "local-txt",
          originName: "本地 TXT",
        },
      });
    }
  }

  if (url.startsWith("local-epub:")) {
    const bookId = url.split(":")[1].split("#")[0];
    const info = await env.DB.prepare(`SELECT * FROM epub_books WHERE book_id = ?1`).bind(bookId).first<any>();
    if (info) {
      return jsonResponse({
        isSuccess: true,
        data: {
          name: info.title || info.file_name,
          author: info.author || "未知作者",
          bookUrl: url,
          totalChapterNum: info.total_chapters,
          origin: "local-epub",
          originName: "本地 EPUB",
        },
      });
    }
  }

  if (url.startsWith("local-mobi:")) {
    const bookId = url.split(":")[1];
    const info = await env.DB.prepare(`SELECT * FROM mobi_books WHERE book_id = ?1`).bind(bookId).first<any>();
    if (info) {
      return jsonResponse({
        isSuccess: true,
        data: {
          name: info.title || info.file_name,
          author: info.author || "未知作者",
          bookUrl: url,
          totalChapterNum: info.total_chapters,
          origin: "local-mobi",
          originName: "本地 MOBI",
        },
      });
    }
  }

  // Fallback to bookshelf
  const shelf: any[] = (await getDocument(env, userNs, "bookshelf.json")) || [];
  const book = shelf.find((b) => b.bookUrl === url);
  return jsonResponse({ isSuccess: true, data: book || { bookUrl: url, name: "书籍详情" } });
}

async function handleGetChapterList(request: Request, env: Env): Promise<Response> {
  const userNs = await resolveUserNs(request, env);
  if (!userNs) return jsonResponse({ isSuccess: false, errorMsg: "请登录后使用", data: "NEED_LOGIN" });

  let bookUrl = new URL(request.url).searchParams.get("bookUrl") || "";
  let tocUrl = new URL(request.url).searchParams.get("tocUrl") || "";
  if ((!bookUrl || !tocUrl) && request.method === "POST") {
    try {
      const body = await request.json<any>();
      bookUrl = body.bookUrl || bookUrl;
      tocUrl = body.tocUrl || tocUrl;
    } catch {}
  }

  const targetUrl = bookUrl || tocUrl;

  // 1. Local TXT Chapters
  if (targetUrl.startsWith("local-txt:")) {
    const bookId = targetUrl.split(":")[1].split("#")[0];
    const rows = await env.DB.prepare(
      `SELECT chapter_index, title FROM txt_chapters WHERE book_id = ?1 ORDER BY chapter_index ASC`
    ).bind(bookId).all<{ chapter_index: number; title: string }>();

    const chapters = (rows.results || []).map((r) => ({
      index: r.chapter_index,
      title: r.title,
      url: `${targetUrl}#${r.chapter_index}`,
    }));
    return jsonResponse({ isSuccess: true, data: chapters });
  }

  // 2. Local EPUB Chapters
  if (targetUrl.startsWith("local-epub:")) {
    const bookId = targetUrl.split(":")[1].split("#")[0];
    const rows = await env.DB.prepare(
      `SELECT chapter_index, title FROM epub_chapters WHERE book_id = ?1 ORDER BY chapter_index ASC`
    ).bind(bookId).all<{ chapter_index: number; title: string }>();

    const chapters = (rows.results || []).map((r) => ({
      index: r.chapter_index,
      title: r.title,
      url: `${targetUrl}#${r.chapter_index}`,
    }));
    return jsonResponse({ isSuccess: true, data: chapters });
  }

  // 3. Local MOBI Chapters
  if (targetUrl.startsWith("local-mobi:")) {
    const bookId = targetUrl.split(":")[1];
    const rows = await env.DB.prepare(
      `SELECT chapter_index, title FROM mobi_chapters WHERE book_id = ?1 ORDER BY chapter_index ASC`
    ).bind(bookId).all<{ chapter_index: number; title: string }>();

    const chapters = (rows.results || []).map((r) => ({
      index: r.chapter_index,
      title: r.title,
      url: `${targetUrl}#${r.chapter_index}`,
    }));
    return jsonResponse({ isSuccess: true, data: chapters });
  }

  // 4. Local PDF Pages
  if (targetUrl.startsWith("local-pdf:") || targetUrl.includes(".pdf")) {
    const bookId = targetUrl.split(":")[1] || targetUrl;
    const book = await env.DB.prepare(`SELECT total_pages FROM pdf_books WHERE book_id = ?1`).bind(bookId).first<{ total_pages: number }>();
    const count = book?.total_pages || 1;
    const chapters = Array.from({ length: count }, (_, i) => ({
      index: i + 1,
      title: `第 ${i + 1} 页`,
      url: `${targetUrl}#${i + 1}`,
    }));
    return jsonResponse({ isSuccess: true, data: chapters });
  }

  return jsonResponse({ isSuccess: true, data: [] });
}

async function handleSaveBookGroupId(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const userNs = await resolveUserNs(request, env);
  if (!userNs) return jsonResponse({ isSuccess: false, errorMsg: "请登录后使用", data: "NEED_LOGIN" });

  const { bookUrl, groupId } = await request.json<any>();
  let shelf: any[] = (await getDocument(env, userNs, "bookshelf.json")) || [];
  const idx = shelf.findIndex((b) => b.bookUrl === bookUrl);
  if (idx >= 0) {
    shelf[idx].group = groupId;
    await saveDocument(env, userNs, "bookshelf.json", shelf);
    triggerOnChangeSync(env, userNs, ctx);
  }
  return jsonResponse({ isSuccess: true, data: "分组修改成功" });
}

// ==========================================
// 17. WebDAV REST Endpoints (for Web Manager)
// ==========================================

async function handleGetWebdavFileList(request: Request, env: Env): Promise<Response> {
  const userNs = await resolveUserNs(request, env);
  if (!userNs) return jsonResponse({ isSuccess: false, errorMsg: "请登录后使用", data: "NEED_LOGIN" });

  const url = new URL(request.url);
  const relPath = (url.searchParams.get("path") || "/").replace(/^\/+/, "").replace(/\/$/, "");
  const prefix = relPath ? `webdav/${userNs}/${relPath}/` : `webdav/${userNs}/`;

  const listed = await env.BUCKET.list({ prefix, delimiter: "/" });
  const entries: any[] = [];

  // Subdirectories
  for (const dp of listed.delimitedPrefixes || []) {
    const subName = dp.replace(prefix, "").replace(/\/$/, "");
    if (!subName) continue;
    entries.push({
      name: subName,
      size: 0,
      path: `/${relPath ? relPath + "/" : ""}${subName}`,
      lastModified: Date.now(),
      isDirectory: true,
    });
  }

  // Files
  for (const obj of listed.objects || []) {
    const fileName = obj.key.replace(prefix, "");
    if (!fileName || fileName.includes("/")) continue;
    entries.push({
      name: fileName,
      size: obj.size,
      path: `/${relPath ? relPath + "/" : ""}${fileName}`,
      lastModified: obj.uploaded.getTime(),
      isDirectory: false,
    });
  }

  return jsonResponse({ isSuccess: true, data: entries });
}

async function handleGetWebdavFile(request: Request, env: Env): Promise<Response> {
  const userNs = await resolveUserNs(request, env);
  if (!userNs) return jsonResponse({ isSuccess: false, errorMsg: "请登录后使用", data: "NEED_LOGIN" });

  const url = new URL(request.url);
  const relPath = (url.searchParams.get("path") || "").replace(/^\/+/, "");
  const r2Key = `webdav/${userNs}/${relPath}`;

  const obj = await env.BUCKET.get(r2Key);
  if (!obj) return new Response("File Not Found", { status: 404, headers: corsHeaders() });

  const headers = new Headers(corsHeaders());
  headers.set("Content-Type", obj.httpMetadata?.contentType || "application/octet-stream");
  headers.set("Content-Length", obj.size.toString());
  return new Response(obj.body, { headers });
}

async function handleUploadFileToWebdav(request: Request, env: Env): Promise<Response> {
  const userNs = await resolveUserNs(request, env);
  if (!userNs) return jsonResponse({ isSuccess: false, errorMsg: "请登录后使用", data: "NEED_LOGIN" });

  const formData = await request.formData();
  const dirPath = (formData.get("path") as string || "/").replace(/^\/+/, "").replace(/\/$/, "");
  const prefix = dirPath ? `webdav/${userNs}/${dirPath}/` : `webdav/${userNs}/`;

  for (const [key, value] of formData.entries()) {
    if (key.startsWith("file") && value instanceof File) {
      const safeName = value.name.replace(/[/\\?%*:|"<>]/g, "_");
      await env.BUCKET.put(`${prefix}${safeName}`, await value.arrayBuffer(), {
        httpMetadata: { contentType: value.type || "application/octet-stream" },
      });
    }
  }

  return jsonResponse({ isSuccess: true, data: [] });
}

async function handleDeleteWebdavFile(request: Request, env: Env): Promise<Response> {
  const userNs = await resolveUserNs(request, env);
  if (!userNs) return jsonResponse({ isSuccess: false, errorMsg: "请登录后使用", data: "NEED_LOGIN" });

  const { path } = await request.json<any>();
  const clean = (path || "").replace(/^\/+/, "");
  const r2Key = `webdav/${userNs}/${clean}`;

  await env.BUCKET.delete(r2Key);
  // Also delete subkeys if directory
  const listed = await env.BUCKET.list({ prefix: `${r2Key}/` });
  for (const o of listed.objects || []) {
    await env.BUCKET.delete(o.key);
  }

  return jsonResponse({ isSuccess: true, data: "删除成功" });
}

async function handleDeleteWebdavFileList(request: Request, env: Env): Promise<Response> {
  const userNs = await resolveUserNs(request, env);
  if (!userNs) return jsonResponse({ isSuccess: false, errorMsg: "请登录后使用", data: "NEED_LOGIN" });

  const { path: paths } = await request.json<any>();
  const list: string[] = Array.isArray(paths) ? paths : [paths];

  for (const p of list) {
    const clean = (p || "").replace(/^\/+/, "");
    const r2Key = `webdav/${userNs}/${clean}`;
    await env.BUCKET.delete(r2Key);
  }

  return jsonResponse({ isSuccess: true, data: "批量删除成功" });
}

// ==========================================
// 18. User Management Handlers (Admin & User)
// ==========================================

async function handleChangePassword(request: Request, env: Env): Promise<Response> {
  const userNs = await resolveUserNs(request, env);
  if (!userNs) return jsonResponse({ isSuccess: false, errorMsg: "请登录后使用", data: "NEED_LOGIN" });

  const { oldPassword, newPassword } = await request.json<any>();
  if (!newPassword || newPassword.length < 8) {
    return jsonResponse({ isSuccess: false, errorMsg: "新密码长度不能少于8位" });
  }

  const user = await env.DB.prepare(`SELECT password, salt FROM users WHERE username = ?1`).bind(userNs).first<any>();
  if (!user) return jsonResponse({ isSuccess: false, errorMsg: "用户不存在" });

  const oldEncrypted = genEncryptedPassword(oldPassword, user.salt);
  if (oldEncrypted !== user.password) {
    return jsonResponse({ isSuccess: false, errorMsg: "原密码错误" });
  }

  const newSalt = randomString(8);
  const newEncrypted = genEncryptedPassword(newPassword, newSalt);

  await env.DB.prepare(`UPDATE users SET password = ?1, salt = ?2 WHERE username = ?3`)
    .bind(newEncrypted, newSalt, userNs)
    .run();

  return jsonResponse({ isSuccess: true, data: "密码修改成功" });
}

async function handleGetUserList(request: Request, env: Env): Promise<Response> {
  const userNs = await resolveUserNs(request, env);
  if (!userNs) return jsonResponse({ isSuccess: false, errorMsg: "请登录后使用", data: "NEED_LOGIN" });

  const admin = await env.DB.prepare(`SELECT is_admin FROM users WHERE username = ?1`).bind(userNs).first<any>();
  if (!admin || admin.is_admin !== 1) {
    return jsonResponse({ isSuccess: false, errorMsg: "需要管理员权限" });
  }

  const rows = await env.DB.prepare(
    `SELECT username, last_login_at as lastLoginAt, created_at as createdAt, enable_webdav as enableWebdav, enable_local_store as enableLocalStore, is_admin as isAdmin FROM users`
  ).all<any>();

  return jsonResponse({ isSuccess: true, data: rows.results || [] });
}

async function handleAddUser(request: Request, env: Env): Promise<Response> {
  const userNs = await resolveUserNs(request, env);
  if (!userNs) return jsonResponse({ isSuccess: false, errorMsg: "请登录后使用", data: "NEED_LOGIN" });

  const admin = await env.DB.prepare(`SELECT is_admin FROM users WHERE username = ?1`).bind(userNs).first<any>();
  if (!admin || admin.is_admin !== 1) {
    return jsonResponse({ isSuccess: false, errorMsg: "需要管理员权限" });
  }

  const { username, password } = await request.json<any>();
  if (!username || !password || password.length < 8) {
    return jsonResponse({ isSuccess: false, errorMsg: "用户名与密码格式不符" });
  }

  const salt = randomString(8);
  const encrypted = genEncryptedPassword(password, salt);
  const now = Math.floor(Date.now() / 1000);

  await env.DB.prepare(
    `INSERT INTO users (username, password, salt, token, last_login_at, created_at, enable_webdav, is_admin)
     VALUES (?1, ?2, ?3, '', ?4, ?4, 1, 0)`
  ).bind(username, encrypted, salt, now).run();

  return handleGetUserList(request, env);
}

async function handleUpdateUser(request: Request, env: Env): Promise<Response> {
  const userNs = await resolveUserNs(request, env);
  if (!userNs) return jsonResponse({ isSuccess: false, errorMsg: "请登录后使用", data: "NEED_LOGIN" });

  const admin = await env.DB.prepare(`SELECT is_admin FROM users WHERE username = ?1`).bind(userNs).first<any>();
  if (!admin || admin.is_admin !== 1) {
    return jsonResponse({ isSuccess: false, errorMsg: "需要管理员权限" });
  }

  const { username, enableWebdav, enableLocalStore, isAdmin } = await request.json<any>();

  await env.DB.prepare(
    `UPDATE users SET enable_webdav = ?1, enable_local_store = ?2, is_admin = ?3 WHERE username = ?4`
  )
    .bind(enableWebdav ? 1 : 0, enableLocalStore ? 1 : 0, isAdmin ? 1 : 0, username)
    .run();

  return handleGetUserList(request, env);
}

async function handleDeleteUsers(request: Request, env: Env): Promise<Response> {
  const userNs = await resolveUserNs(request, env);
  if (!userNs) return jsonResponse({ isSuccess: false, errorMsg: "请登录后使用", data: "NEED_LOGIN" });

  const admin = await env.DB.prepare(`SELECT is_admin FROM users WHERE username = ?1`).bind(userNs).first<any>();
  if (!admin || admin.is_admin !== 1) {
    return jsonResponse({ isSuccess: false, errorMsg: "需要管理员权限" });
  }

  const usernames = await request.json<string[]>();
  for (const u of usernames) {
    if (u !== userNs) {
      await env.DB.prepare(`DELETE FROM users WHERE username = ?1`).bind(u).run();
    }
  }

  return handleGetUserList(request, env);
}

async function handleResetPassword(request: Request, env: Env): Promise<Response> {
  const userNs = await resolveUserNs(request, env);
  if (!userNs) return jsonResponse({ isSuccess: false, errorMsg: "请登录后使用", data: "NEED_LOGIN" });

  const admin = await env.DB.prepare(`SELECT is_admin FROM users WHERE username = ?1`).bind(userNs).first<any>();
  if (!admin || admin.is_admin !== 1) {
    return jsonResponse({ isSuccess: false, errorMsg: "需要管理员权限" });
  }

  const { username, password } = await request.json<any>();
  const salt = randomString(8);
  const encrypted = genEncryptedPassword(password, salt);

  await env.DB.prepare(`UPDATE users SET password = ?1, salt = ?2 WHERE username = ?3`)
    .bind(encrypted, salt, username)
    .run();

  return jsonResponse({ isSuccess: true, data: "重置密码成功" });
}
