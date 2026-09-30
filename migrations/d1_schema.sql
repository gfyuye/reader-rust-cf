-- Cloudflare D1 Consolidated Schema for reader-rust
-- Run with: wrangler d1 execute <DATABASE_NAME> --file=migrations/d1_schema.sql

-- 1. Book Sources
CREATE TABLE IF NOT EXISTS book_sources (
    user_ns TEXT NOT NULL DEFAULT 'default',
    book_source_url TEXT NOT NULL,
    book_source_name TEXT NOT NULL,
    json TEXT NOT NULL,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (user_ns, book_source_url)
);

CREATE INDEX IF NOT EXISTS idx_book_sources_user_ns_updated
ON book_sources(user_ns, updated_at DESC);

-- 2. Book Info Cache
CREATE TABLE IF NOT EXISTS book_cache (
    book_url TEXT PRIMARY KEY,
    json TEXT NOT NULL,
    updated_at INTEGER NOT NULL
);

-- 3. Chapter Content Cache (Metadata)
CREATE TABLE IF NOT EXISTS chapter_cache (
    book_url TEXT NOT NULL,
    chapter_index INTEGER NOT NULL,
    file_path TEXT NOT NULL,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (book_url, chapter_index)
);

-- 4. User Accounts
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

-- 5. User Login Sessions
CREATE TABLE IF NOT EXISTS user_sessions (
    username TEXT NOT NULL,
    token TEXT NOT NULL,
    expire_at INTEGER NOT NULL,
    PRIMARY KEY (username, token),
    FOREIGN KEY (username) REFERENCES users(username) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_user_sessions_expire_at
ON user_sessions(expire_at);

-- 6. JSON Documents (Bookshelf, Replace Rules, RSS, Bookmarks, App Configs)
CREATE TABLE IF NOT EXISTS json_documents (
    namespace TEXT NOT NULL,
    name TEXT NOT NULL,
    json TEXT NOT NULL,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (namespace, name)
);

CREATE INDEX IF NOT EXISTS idx_json_documents_namespace
ON json_documents(namespace);

-- 7. AI Reading Memories
CREATE TABLE IF NOT EXISTS ai_book_memories (
    user_ns TEXT NOT NULL,
    book_key TEXT NOT NULL,
    book_url TEXT NOT NULL,
    json TEXT NOT NULL,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (user_ns, book_key)
);

CREATE INDEX IF NOT EXISTS idx_ai_book_memories_user_ns
ON ai_book_memories(user_ns);

-- 8. EPUB Books (Zero-download Streaming & Central Directory Index)
CREATE TABLE IF NOT EXISTS epub_books (
    book_id TEXT PRIMARY KEY,
    user_ns TEXT NOT NULL,
    file_name TEXT NOT NULL,
    r2_key TEXT NOT NULL,
    file_size INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'uploaded', -- uploaded, indexing, ready, failed
    total_chapters INTEGER NOT NULL DEFAULT 0,
    parsed_chapters INTEGER NOT NULL DEFAULT 0,
    title TEXT,
    author TEXT,
    cover_url TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_epub_books_user_ns
ON epub_books(user_ns, updated_at DESC);

-- 9. EPUB Chapter Byte Offsets & Ranges (For Sub-millisecond Range Queries)
CREATE TABLE IF NOT EXISTS epub_chapters (
    book_id TEXT NOT NULL,
    chapter_index INTEGER NOT NULL,
    title TEXT NOT NULL,
    file_name TEXT NOT NULL,
    byte_offset INTEGER NOT NULL,
    byte_length INTEGER NOT NULL,
    uncompressed_length INTEGER NOT NULL,
    compression_method INTEGER NOT NULL DEFAULT 0, -- 0 = Stored, 8 = Deflated
    created_at INTEGER NOT NULL,
    PRIMARY KEY (book_id, chapter_index)
);

CREATE INDEX IF NOT EXISTS idx_epub_chapters_book
ON epub_chapters(book_id, chapter_index);

-- 10. EPUB Queue Checkpoints (Chunked Parsing Under Free Execution Time Budget)
CREATE TABLE IF NOT EXISTS epub_parse_checkpoints (
    book_id TEXT PRIMARY KEY,
    last_processed_index INTEGER NOT NULL DEFAULT 0,
    spine_json TEXT NOT NULL DEFAULT '[]',
    title_map_json TEXT NOT NULL DEFAULT '{}',
    updated_at INTEGER NOT NULL
);

-- 11. PDF Books (Lightweight Metadata Indexing & Range Streaming)
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

CREATE INDEX IF NOT EXISTS idx_pdf_books_user_ns
ON pdf_books(user_ns, updated_at DESC);

-- 12. PDF Outlines / Table of Contents (For Zero-delay TOC Navigation)
CREATE TABLE IF NOT EXISTS pdf_outlines (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    book_id TEXT NOT NULL,
    title TEXT NOT NULL,
    dest_page INTEGER NOT NULL DEFAULT 1,
    level INTEGER NOT NULL DEFAULT 1,
    FOREIGN KEY (book_id) REFERENCES pdf_books(book_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_pdf_outlines_book
ON pdf_outlines(book_id, dest_page);

-- 13. MOBI / PalmDOC Books (Lightweight Header Indexing & Range Streaming)
CREATE TABLE IF NOT EXISTS mobi_books (
    book_id TEXT PRIMARY KEY,
    user_ns TEXT NOT NULL,
    file_name TEXT NOT NULL,
    r2_key TEXT NOT NULL,
    file_size INTEGER NOT NULL,
    total_chapters INTEGER NOT NULL DEFAULT 0,
    title TEXT,
    author TEXT,
    compression INTEGER NOT NULL DEFAULT 1, -- 1 = No compression, 2 = PalmDOC LZ77
    status TEXT NOT NULL DEFAULT 'ready',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_mobi_books_user_ns
ON mobi_books(user_ns, updated_at DESC);

-- 14. MOBI Record Byte Offsets & Slices (For Zero-Parse Range Queries)
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

CREATE INDEX IF NOT EXISTS idx_mobi_chapters_book
ON mobi_chapters(book_id, chapter_index);

-- 15. User Remote WebDAV Sync Configuration & History
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

CREATE INDEX IF NOT EXISTS idx_user_remote_webdav_enabled
ON user_remote_webdav(enabled);

-- 16. TXT Books (Zero-Memory Range Streaming & Heading Index)
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

CREATE INDEX IF NOT EXISTS idx_txt_books_user_ns
ON txt_books(user_ns, updated_at DESC);

-- 17. TXT Chapter Byte Ranges (For Instant Sub-millisecond Range Slices)
CREATE TABLE IF NOT EXISTS txt_chapters (
    book_id TEXT NOT NULL,
    chapter_index INTEGER NOT NULL,
    title TEXT NOT NULL,
    byte_offset INTEGER NOT NULL,
    byte_length INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (book_id, chapter_index)
);

CREATE INDEX IF NOT EXISTS idx_txt_chapters_book
ON txt_chapters(book_id, chapter_index);
