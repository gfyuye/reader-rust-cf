CREATE TABLE IF NOT EXISTS book_sources (
    user_ns TEXT NOT NULL DEFAULT 'default',
    book_source_url TEXT NOT NULL,
    book_source_name TEXT NOT NULL,
    json TEXT NOT NULL,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (user_ns, book_source_url)
);

CREATE INDEX IF NOT EXISTS idx_book_sources_user_ns_updated ON book_sources(user_ns, updated_at DESC);

CREATE TABLE IF NOT EXISTS book_cache (
    book_url TEXT PRIMARY KEY,
    json TEXT NOT NULL,
    updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS chapter_cache (
    book_url TEXT NOT NULL,
    chapter_index INTEGER NOT NULL,
    file_path TEXT NOT NULL,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (book_url, chapter_index)
);

CREATE TABLE IF NOT EXISTS users (
    username TEXT NOT NULL PRIMARY KEY,
    password TEXT NOT NULL,
    salt TEXT NOT NULL,
    token TEXT NOT NULL DEFAULT '',
    last_login_at INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL DEFAULT 0,
    enable_webdav INTEGER NOT NULL DEFAULT 0,
    enable_local_store INTEGER NOT NULL DEFAULT 0,
    enable_ai_model INTEGER NOT NULL DEFAULT 0,
    is_admin INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS user_sessions (
    username TEXT NOT NULL,
    token TEXT NOT NULL,
    expire_at INTEGER NOT NULL,
    PRIMARY KEY (username, token),
    FOREIGN KEY (username) REFERENCES users(username) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_user_sessions_expire_at ON user_sessions(expire_at);

CREATE TABLE IF NOT EXISTS json_documents (
    namespace TEXT NOT NULL,
    name TEXT NOT NULL,
    json TEXT NOT NULL,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (namespace, name)
);

CREATE INDEX IF NOT EXISTS idx_json_documents_namespace ON json_documents(namespace);

CREATE TABLE IF NOT EXISTS ai_book_memories (
    user_ns TEXT NOT NULL,
    book_key TEXT NOT NULL,
    book_url TEXT NOT NULL,
    json TEXT NOT NULL,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (user_ns, book_key)
);

CREATE INDEX IF NOT EXISTS idx_ai_book_memories_user_ns ON ai_book_memories(user_ns);

CREATE TABLE IF NOT EXISTS epub_books (
    book_id TEXT PRIMARY KEY,
    user_ns TEXT NOT NULL,
    file_name TEXT NOT NULL,
    r2_key TEXT NOT NULL,
    file_size INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'uploaded',
    total_chapters INTEGER NOT NULL DEFAULT 0,
    parsed_chapters INTEGER NOT NULL DEFAULT 0,
    title TEXT,
    author TEXT,
    cover_url TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_epub_books_user_ns ON epub_books(user_ns, updated_at DESC);

CREATE TABLE IF NOT EXISTS epub_chapters (
    book_id TEXT NOT NULL,
    chapter_index INTEGER NOT NULL,
    title TEXT NOT NULL,
    file_name TEXT NOT NULL,
    byte_offset INTEGER NOT NULL,
    byte_length INTEGER NOT NULL,
    uncompressed_length INTEGER NOT NULL,
    compression_method INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (book_id, chapter_index)
);

CREATE INDEX IF NOT EXISTS idx_epub_chapters_book ON epub_chapters(book_id, chapter_index);

CREATE TABLE IF NOT EXISTS epub_parse_checkpoints (
    book_id TEXT PRIMARY KEY,
    last_processed_index INTEGER NOT NULL DEFAULT 0,
    spine_json TEXT NOT NULL DEFAULT '[]',
    title_map_json TEXT NOT NULL DEFAULT '{}',
    updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS pdf_books (
    book_id TEXT PRIMARY KEY,
    user_ns TEXT NOT NULL,
    file_name TEXT NOT NULL,
    r2_key TEXT NOT NULL,
    file_size INTEGER NOT NULL,
    total_pages INTEGER NOT NULL DEFAULT 0,
    title TEXT,
    author TEXT,
    status TEXT NOT NULL DEFAULT 'ready',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_pdf_books_user_ns ON pdf_books(user_ns, updated_at DESC);

CREATE TABLE IF NOT EXISTS pdf_outlines (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    book_id TEXT NOT NULL,
    title TEXT NOT NULL,
    dest_page INTEGER NOT NULL DEFAULT 1,
    level INTEGER NOT NULL DEFAULT 1,
    FOREIGN KEY (book_id) REFERENCES pdf_books(book_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_pdf_outlines_book ON pdf_outlines(book_id, dest_page);

CREATE TABLE IF NOT EXISTS mobi_books (
    book_id TEXT PRIMARY KEY,
    user_ns TEXT NOT NULL,
    file_name TEXT NOT NULL,
    r2_key TEXT NOT NULL,
    file_size INTEGER NOT NULL,
    total_chapters INTEGER NOT NULL DEFAULT 0,
    title TEXT,
    author TEXT,
    compression INTEGER NOT NULL DEFAULT 1,
    status TEXT NOT NULL DEFAULT 'ready',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_mobi_books_user_ns ON mobi_books(user_ns, updated_at DESC);

CREATE TABLE IF NOT EXISTS mobi_chapters (
    book_id TEXT NOT NULL,
    chapter_index INTEGER NOT NULL,
    title TEXT NOT NULL,
    byte_offset INTEGER NOT NULL,
    byte_length INTEGER NOT NULL,
    compression INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (book_id, chapter_index)
);

CREATE INDEX IF NOT EXISTS idx_mobi_chapters_book ON mobi_chapters(book_id, chapter_index);

CREATE TABLE IF NOT EXISTS user_remote_webdav (
    username TEXT PRIMARY KEY,
    enabled INTEGER NOT NULL DEFAULT 0,
    server_url TEXT NOT NULL DEFAULT '',
    webdav_user TEXT NOT NULL DEFAULT '',
    webdav_password TEXT NOT NULL DEFAULT '',
    sync_on_change INTEGER NOT NULL DEFAULT 1,
    sync_interval_mins INTEGER NOT NULL DEFAULT 5,
    last_sync_at INTEGER NOT NULL DEFAULT 0,
    last_sync_status TEXT NOT NULL DEFAULT '',
    last_sync_error TEXT,
    updated_at INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY (username) REFERENCES users(username) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_user_remote_webdav_enabled ON user_remote_webdav(enabled);

CREATE TABLE IF NOT EXISTS txt_books (
    book_id TEXT PRIMARY KEY,
    user_ns TEXT NOT NULL,
    file_name TEXT NOT NULL,
    r2_key TEXT NOT NULL,
    file_size INTEGER NOT NULL,
    total_chapters INTEGER NOT NULL DEFAULT 0,
    title TEXT NOT NULL,
    author TEXT NOT NULL DEFAULT '本地导入',
    status TEXT NOT NULL DEFAULT 'ready',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_txt_books_user_ns ON txt_books(user_ns, updated_at DESC);

CREATE TABLE IF NOT EXISTS txt_chapters (
    book_id TEXT NOT NULL,
    chapter_index INTEGER NOT NULL,
    title TEXT NOT NULL,
    byte_offset INTEGER NOT NULL,
    byte_length INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (book_id, chapter_index)
);

CREATE INDEX IF NOT EXISTS idx_txt_chapters_book ON txt_chapters(book_id, chapter_index);
