use crate::error::error::AppError;
use crate::storage::db::d1::D1Client;
use crate::storage::r2::R2Client;
use crate::util::time::now_ts;
use quick_xml::events::Event;
use quick_xml::Reader;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::io::Read;
use std::time::{Duration, Instant};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CentralDirectoryEntry {
    pub file_name: String,
    pub compression_method: u16,
    pub compressed_size: u64,
    pub uncompressed_size: u64,
    pub local_header_offset: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EpubChapterIndex {
    pub book_id: String,
    pub chapter_index: i32,
    pub title: String,
    pub file_name: String,
    pub byte_offset: u64,
    pub byte_length: u64,
    pub uncompressed_length: u64,
    pub compression_method: u16,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EpubBookStatus {
    pub book_id: String,
    pub user_ns: String,
    pub file_name: String,
    pub status: String,
    pub total_chapters: i32,
    pub parsed_chapters: i32,
    pub title: Option<String>,
    pub author: Option<String>,
}

#[derive(Debug, Clone)]
pub enum ChunkProcessOutcome {
    Completed { total_chapters: usize },
    NeedsMore { processed: usize, total: usize },
}

pub struct EpubStreamService {
    d1: D1Client,
    r2: R2Client,
}

impl EpubStreamService {
    pub fn new(d1: D1Client, r2: R2Client) -> Self {
        Self { d1, r2 }
    }

    /// Step 1: User uploaded EPUB -> Read Central Directory & Store Initial Manifest into D1
    pub async fn init_uploaded_epub(
        &self,
        user_ns: &str,
        book_id: &str,
        file_name: &str,
        file_size: u64,
        r2_key: &str,
    ) -> Result<EpubBookStatus, AppError> {
        // Fetch only the last 64KB to locate ZIP End-of-Central-Directory (EOCD)
        let tail_len = 65536.min(file_size);
        let tail_bytes = self
            .r2
            .get_object_tail(r2_key, tail_len)
            .await?
            .ok_or_else(|| AppError::BadRequest("无法读取 EPUB 尾部数据".to_string()))?;

        let (cd_offset, cd_size, _total_entries) = parse_eocd(&tail_bytes, file_size)?;

        // Fetch central directory bytes via R2 Range request
        let cd_bytes = self
            .r2
            .get_object_range(r2_key, cd_offset, cd_size)
            .await?
            .ok_or_else(|| AppError::BadRequest("无法读取 EPUB 中央目录数据".to_string()))?;

        let entries = parse_central_directory(&cd_bytes)?;
        let mut entry_map = HashMap::new();
        for entry in entries {
            entry_map.insert(entry.file_name.clone(), entry);
        }

        // 1. Locate and read container.xml to find OPF path
        let container_entry = entry_map
            .get("META-INF/container.xml")
            .ok_or_else(|| AppError::BadRequest("非法 EPUB: 缺少 container.xml".to_string()))?;
        let container_xml = self.read_zip_entry_text(r2_key, container_entry).await?;
        let opf_path = parse_container_opf_path(&container_xml)?;

        // 2. Read OPF file
        let opf_entry = entry_map
            .get(&opf_path)
            .ok_or_else(|| AppError::BadRequest(format!("非法 EPUB: 缺少 OPF 文件 {}", opf_path)))?;
        let opf_xml = self.read_zip_entry_text(r2_key, opf_entry).await?;

        let opf_dir = if let Some(idx) = opf_path.rfind('/') {
            &opf_path[..idx]
        } else {
            ""
        };
        let (title, author, spine_paths, title_map) = parse_opf_package(&opf_xml, opf_dir)?;

        let total_chapters = spine_paths.len() as i32;
        let now = now_ts();

        // 3. Save book record in D1 as 'indexing'
        self.d1
            .execute(
                "INSERT INTO epub_books (book_id, user_ns, file_name, r2_key, file_size, status, total_chapters, parsed_chapters, title, author, created_at, updated_at) \
                 VALUES (?1, ?2, ?3, ?4, ?5, 'indexing', ?6, 0, ?7, ?8, ?9, ?10) \
                 ON CONFLICT(book_id) DO UPDATE SET status='indexing', total_chapters=excluded.total_chapters, parsed_chapters=0, updated_at=excluded.updated_at",
                &[
                    json!(book_id),
                    json!(user_ns),
                    json!(file_name),
                    json!(r2_key),
                    json!(file_size as i64),
                    json!(total_chapters),
                    json!(title.clone()),
                    json!(author.clone()),
                    json!(now),
                    json!(now),
                ],
            )
            .await?;

        // 4. Save parse checkpoint in D1
        let spine_json = serde_json::to_string(&spine_paths).unwrap_or_else(|_| "[]".to_string());
        let title_map_json = serde_json::to_string(&title_map).unwrap_or_else(|_| "{}".to_string());
        self.d1
            .execute(
                "INSERT INTO epub_parse_checkpoints (book_id, last_processed_index, spine_json, title_map_json, updated_at) \
                 VALUES (?1, 0, ?2, ?3, ?4) \
                 ON CONFLICT(book_id) DO UPDATE SET last_processed_index=0, spine_json=excluded.spine_json, title_map_json=excluded.title_map_json, updated_at=excluded.updated_at",
                &[json!(book_id), json!(spine_json), json!(title_map_json), json!(now)],
            )
            .await?;

        Ok(EpubBookStatus {
            book_id: book_id.to_string(),
            user_ns: user_ns.to_string(),
            file_name: file_name.to_string(),
            status: "indexing".to_string(),
            total_chapters,
            parsed_chapters: 0,
            title,
            author,
        })
    }

    /// Step 2: Queue Chunk Consumer - Parses chapters with wall-clock time budget check
    pub async fn process_indexing_chunk(
        &self,
        book_id: &str,
        time_budget: Duration,
    ) -> Result<ChunkProcessOutcome, AppError> {
        let start_time = Instant::now();

        // 1. Get book info
        let book_row = self
            .d1
            .query_optional(
                "SELECT r2_key, file_size FROM epub_books WHERE book_id=?1",
                &[json!(book_id)],
            )
            .await?
            .ok_or_else(|| AppError::BadRequest("未找到该 EPUB 书籍".to_string()))?;

        let r2_key = book_row
            .get("r2_key")
            .and_then(Value::as_str)
            .ok_or_else(|| AppError::Internal(anyhow::anyhow!("缺少 r2_key")))?;
        let file_size = book_row
            .get("file_size")
            .and_then(Value::as_i64)
            .unwrap_or(0) as u64;

        // 2. Load checkpoint
        let cp_row = self
            .d1
            .query_optional(
                "SELECT last_processed_index, spine_json, title_map_json FROM epub_parse_checkpoints WHERE book_id=?1",
                &[json!(book_id)],
            )
            .await?
            .ok_or_else(|| AppError::BadRequest("未找到解析进度检查点".to_string()))?;

        let last_idx = cp_row
            .get("last_processed_index")
            .and_then(Value::as_i64)
            .unwrap_or(0) as usize;
        let spine_raw = cp_row.get("spine_json").and_then(Value::as_str).unwrap_or("[]");
        let title_map_raw = cp_row.get("title_map_json").and_then(Value::as_str).unwrap_or("{}");

        let spine: Vec<String> = serde_json::from_str(spine_raw).unwrap_or_default();
        let title_map: HashMap<String, String> = serde_json::from_str(title_map_raw).unwrap_or_default();
        let total_count = spine.len();

        if last_idx >= total_count {
            // Already finished
            self.mark_book_ready(book_id, total_count as i32).await?;
            return Ok(ChunkProcessOutcome::Completed { total_chapters: total_count });
        }

        // 3. Load central directory to locate chapters
        let tail_len = 65536.min(file_size);
        let tail_bytes = self
            .r2
            .get_object_tail(r2_key, tail_len)
            .await?
            .ok_or_else(|| AppError::Internal(anyhow::anyhow!("读取尾部失败")))?;
        let (cd_offset, cd_size, _) = parse_eocd(&tail_bytes, file_size)?;
        let cd_bytes = self
            .r2
            .get_object_range(r2_key, cd_offset, cd_size)
            .await?
            .ok_or_else(|| AppError::Internal(anyhow::anyhow!("读取中央目录失败")))?;
        let entries = parse_central_directory(&cd_bytes)?;
        let mut entry_map = HashMap::new();
        for entry in entries {
            entry_map.insert(entry.file_name.clone(), entry);
        }

        let mut cur_idx = last_idx;
        while cur_idx < total_count {
            // Check wall-clock budget before starting next chapter
            if start_time.elapsed() >= time_budget {
                tracing::info!(
                    "EPUB {} 分片解析达到时间预算限额 ({:?})，保存检查点 (进度 {}/{}) 并交由队列下次触发",
                    book_id,
                    start_time.elapsed(),
                    cur_idx,
                    total_count
                );
                // Save checkpoint & update progress in D1
                self.save_checkpoint(book_id, cur_idx as i64).await?;
                return Ok(ChunkProcessOutcome::NeedsMore {
                    processed: cur_idx,
                    total: total_count,
                });
            }

            let path = &spine[cur_idx];
            if let Some(entry) = entry_map.get(path) {
                // Read local header to get the exact data offset inside ZIP
                let local_header_bytes = self
                    .r2
                    .get_object_range(r2_key, entry.local_header_offset, 30)
                    .await?
                    .ok_or_else(|| AppError::Internal(anyhow::anyhow!("读取本地头失败")))?;
                let data_offset = parse_local_header_data_offset(&local_header_bytes, entry.local_header_offset)?;

                let title = title_map
                    .get(path)
                    .cloned()
                    .unwrap_or_else(|| format!("第 {} 节", cur_idx + 1));

                // Insert chapter index record into D1
                let now = now_ts();
                self.d1
                    .execute(
                        "INSERT INTO epub_chapters (book_id, chapter_index, title, file_name, byte_offset, byte_length, uncompressed_length, compression_method, created_at) \
                         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9) \
                         ON CONFLICT(book_id, chapter_index) DO UPDATE SET title=excluded.title, byte_offset=excluded.byte_offset, byte_length=excluded.byte_length, updated_at=excluded.created_at",
                        &[
                            json!(book_id),
                            json!(cur_idx as i32),
                            json!(title),
                            json!(path),
                            json!(data_offset as i64),
                            json!(entry.compressed_size as i64),
                            json!(entry.uncompressed_size as i64),
                            json!(entry.compression_method as i32),
                            json!(now),
                        ],
                    )
                    .await?;
            }

            cur_idx += 1;
        }

        // All chapters indexed! Mark ready
        self.mark_book_ready(book_id, total_count as i32).await?;
        Ok(ChunkProcessOutcome::Completed { total_chapters: total_count })
    }

    /// Step 3: Read Phase (Zero-Parse Range Query) - User requests Chapter / Page N
    pub async fn read_chapter_html(
        &self,
        book_id: &str,
        chapter_index: i32,
    ) -> Result<String, AppError> {
        // 1. Query D1 for byte offset and compression method
        let row = self
            .d1
            .query_optional(
                "SELECT c.byte_offset, c.byte_length, c.compression_method, b.r2_key, b.status \
                 FROM epub_chapters c \
                 JOIN epub_books b ON c.book_id = b.book_id \
                 WHERE c.book_id = ?1 AND c.chapter_index = ?2",
                &[json!(book_id), json!(chapter_index)],
            )
            .await?
            .ok_or_else(|| AppError::BadRequest("未找到该章节或书籍尚未完成索引".to_string()))?;

        let r2_key = row.get("r2_key").and_then(Value::as_str).unwrap_or("");
        let offset = row.get("byte_offset").and_then(Value::as_i64).unwrap_or(0) as u64;
        let length = row.get("byte_length").and_then(Value::as_i64).unwrap_or(0) as u64;
        let method = row.get("compression_method").and_then(Value::as_i64).unwrap_or(0) as u16;

        // 2. Fetch only that chapter's bytes from R2 via HTTP Range
        let payload = self
            .r2
            .get_object_range(r2_key, offset, length)
            .await?
            .ok_or_else(|| AppError::Internal(anyhow::anyhow!("读取 R2 章节切片失败")))?;

        // 3. Decompress if Deflated (takes ~1ms in memory)
        let decompressed = decompress_zip_payload(&payload, method)?;
        let html = String::from_utf8_lossy(&decompressed).to_string();

        Ok(html)
    }

    async fn read_zip_entry_text(
        &self,
        r2_key: &str,
        entry: &CentralDirectoryEntry,
    ) -> Result<String, AppError> {
        let local_hdr = self
            .r2
            .get_object_range(r2_key, entry.local_header_offset, 30)
            .await?
            .ok_or_else(|| AppError::Internal(anyhow::anyhow!("读取本地头失败")))?;
        let data_offset = parse_local_header_data_offset(&local_hdr, entry.local_header_offset)?;

        let bytes = self
            .r2
            .get_object_range(r2_key, data_offset, entry.compressed_size)
            .await?
            .ok_or_else(|| AppError::Internal(anyhow::anyhow!("读取数据块失败")))?;

        let decompressed = decompress_zip_payload(&bytes, entry.compression_method)?;
        Ok(String::from_utf8_lossy(&decompressed).to_string())
    }

    async fn save_checkpoint(&self, book_id: &str, last_index: i64) -> Result<(), AppError> {
        let now = now_ts();
        self.d1
            .execute(
                "UPDATE epub_parse_checkpoints SET last_processed_index=?1, updated_at=?2 WHERE book_id=?3",
                &[json!(last_index), json!(now), json!(book_id)],
            )
            .await?;
        self.d1
            .execute(
                "UPDATE epub_books SET parsed_chapters=?1, updated_at=?2 WHERE book_id=?3",
                &[json!(last_index), json!(now), json!(book_id)],
            )
            .await?;
        Ok(())
    }

    async fn mark_book_ready(&self, book_id: &str, total_count: i32) -> Result<(), AppError> {
        let now = now_ts();
        self.d1
            .execute(
                "UPDATE epub_books SET status='ready', parsed_chapters=?1, updated_at=?2 WHERE book_id=?3",
                &[json!(total_count), json!(now), json!(book_id)],
            )
            .await?;
        self.d1
            .execute(
                "DELETE FROM epub_parse_checkpoints WHERE book_id=?1",
                &[json!(book_id)],
            )
            .await?;
        Ok(())
    }
}

// === ZIP Parsing Utilities ===

fn parse_eocd(tail: &[u8], total_file_size: u64) -> Result<(u64, u64, usize), AppError> {
    // EOCD signature is 0x06054b50 (PK\x05\x06)
    if tail.len() < 22 {
        return Err(AppError::BadRequest("文件太小，不是有效 ZIP/EPUB".to_string()));
    }
    for i in (0..=tail.len() - 22).rev() {
        if tail[i..i + 4] == [0x50, 0x4b, 0x05, 0x06] {
            let total_entries = u16::from_le_bytes(tail[i + 10..i + 12].try_into().unwrap()) as usize;
            let cd_size = u32::from_le_bytes(tail[i + 12..i + 16].try_into().unwrap()) as u64;
            let cd_offset = u32::from_le_bytes(tail[i + 16..i + 20].try_into().unwrap()) as u64;

            if cd_offset + cd_size > total_file_size {
                return Err(AppError::BadRequest("ZIP 中央目录偏移越界".to_string()));
            }
            return Ok((cd_offset, cd_size, total_entries));
        }
    }
    Err(AppError::BadRequest("未找到 ZIP EOCD 记录".to_string()))
}

fn parse_central_directory(cd: &[u8]) -> Result<Vec<CentralDirectoryEntry>, AppError> {
    let mut entries = Vec::new();
    let mut pos = 0;
    while pos + 46 <= cd.len() {
        if cd[pos..pos + 4] != [0x50, 0x4b, 0x01, 0x02] {
            break;
        }
        let method = u16::from_le_bytes(cd[pos + 10..pos + 12].try_into().unwrap());
        let comp_size = u32::from_le_bytes(cd[pos + 20..pos + 24].try_into().unwrap()) as u64;
        let uncomp_size = u32::from_le_bytes(cd[pos + 24..pos + 28].try_into().unwrap()) as u64;
        let name_len = u16::from_le_bytes(cd[pos + 28..pos + 30].try_into().unwrap()) as usize;
        let extra_len = u16::from_le_bytes(cd[pos + 30..pos + 32].try_into().unwrap()) as usize;
        let comment_len = u16::from_le_bytes(cd[pos + 32..pos + 34].try_into().unwrap()) as usize;
        let local_hdr_offset = u32::from_le_bytes(cd[pos + 42..pos + 46].try_into().unwrap()) as u64;

        pos += 46;
        if pos + name_len > cd.len() {
            break;
        }
        let file_name = String::from_utf8_lossy(&cd[pos..pos + name_len]).to_string();
        pos += name_len + extra_len + comment_len;

        entries.push(CentralDirectoryEntry {
            file_name,
            compression_method: method,
            compressed_size: comp_size,
            uncompressed_size: uncomp_size,
            local_header_offset: local_hdr_offset,
        });
    }
    Ok(entries)
}

fn parse_local_header_data_offset(hdr: &[u8], local_header_offset: u64) -> Result<u64, AppError> {
    if hdr.len() < 30 || hdr[0..4] != [0x50, 0x4b, 0x03, 0x04] {
        return Err(AppError::BadRequest("非法 ZIP 本地文件头".to_string()));
    }
    let name_len = u16::from_le_bytes(hdr[26..28].try_into().unwrap()) as u64;
    let extra_len = u16::from_le_bytes(hdr[28..30].try_into().unwrap()) as u64;
    Ok(local_header_offset + 30 + name_len + extra_len)
}

fn decompress_zip_payload(data: &[u8], compression_method: u16) -> Result<Vec<u8>, AppError> {
    match compression_method {
        0 => Ok(data.to_vec()), // Stored
        8 => {
            // Deflate
            let mut decoder = flate2::read::DeflateDecoder::new(data);
            let mut out = Vec::new();
            decoder
                .read_to_end(&mut out)
                .map_err(|e| AppError::Internal(anyhow::anyhow!("Deflate 解压失败: {}", e)))?;
            Ok(out)
        }
        other => Err(AppError::BadRequest(format!("不支持的压缩格式: {}", other))),
    }
}

// === EPUB OPF Parsing ===

fn parse_container_opf_path(xml: &str) -> Result<String, AppError> {
    let mut reader = Reader::from_str(xml);
    reader.trim_text(true);
    let mut buf = Vec::new();

    while let Ok(event) = reader.read_event_into(&mut buf) {
        match event {
            Event::Start(e) | Event::Empty(e) if e.name().as_ref() == b"rootfile" => {
                for attr in e.attributes().flatten() {
                    if attr.key.as_ref() == b"full-path" {
                        let path = String::from_utf8_lossy(&attr.value).to_string();
                        return Ok(path);
                    }
                }
            }
            Event::Eof => break,
            _ => {}
        }
        buf.clear();
    }
    Err(AppError::BadRequest("container.xml 中未找到 rootfile 路径".to_string()))
}

fn parse_opf_package(
    xml: &str,
    opf_dir: &str,
) -> Result<(Option<String>, Option<String>, Vec<String>, HashMap<String, String>), AppError> {
    let mut reader = Reader::from_str(xml);
    reader.trim_text(true);
    let mut buf = Vec::new();

    let mut title = None;
    let mut author = None;
    let mut manifest = HashMap::new(); // id -> path
    let mut spine_ids = Vec::new();
    let mut in_title = false;
    let mut in_creator = false;

    while let Ok(event) = reader.read_event_into(&mut buf) {
        match event {
            Event::Start(e) => match e.name().as_ref() {
                b"dc:title" => in_title = true,
                b"dc:creator" => in_creator = true,
                _ => {}
            },
            Event::Text(e) => {
                let text = e.unescape().unwrap_or_default().to_string();
                if in_title && title.is_none() {
                    title = Some(text);
                } else if in_creator && author.is_none() {
                    author = Some(text);
                }
            }
            Event::End(e) => match e.name().as_ref() {
                b"dc:title" => in_title = false,
                b"dc:creator" => in_creator = false,
                _ => {}
            },
            Event::Empty(e) => match e.name().as_ref() {
                b"item" => {
                    let mut id = String::new();
                    let mut href = String::new();
                    for attr in e.attributes().flatten() {
                        if attr.key.as_ref() == b"id" {
                            id = String::from_utf8_lossy(&attr.value).to_string();
                        } else if attr.key.as_ref() == b"href" {
                            href = String::from_utf8_lossy(&attr.value).to_string();
                        }
                    }
                    if !id.is_empty() && !href.is_empty() {
                        let full_path = if opf_dir.is_empty() {
                            href
                        } else {
                            format!("{}/{}", opf_dir.trim_end_matches('/'), href.trim_start_matches('/'))
                        };
                        manifest.insert(id, full_path);
                    }
                }
                b"itemref" => {
                    for attr in e.attributes().flatten() {
                        if attr.key.as_ref() == b"idref" {
                            spine_ids.push(String::from_utf8_lossy(&attr.value).to_string());
                        }
                    }
                }
                _ => {}
            },
            Event::Eof => break,
            _ => {}
        }
        buf.clear();
    }

    let mut spine_paths = Vec::new();
    for id in spine_ids {
        if let Some(path) = manifest.get(&id) {
            spine_paths.push(path.clone());
        }
    }

    Ok((title, author, spine_paths, HashMap::new()))
}
