use crate::error::error::AppError;
use crate::storage::db::d1::D1Client;
use crate::storage::r2::R2Client;
use crate::util::time::now_ts;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MobiBookInfo {
    pub book_id: String,
    pub user_ns: String,
    pub file_name: String,
    pub r2_key: String,
    pub file_size: u64,
    pub total_chapters: i32,
    pub title: Option<String>,
    pub author: Option<String>,
    pub compression: i32,
    pub status: String,
}

pub struct MobiStreamService {
    d1: D1Client,
    r2: R2Client,
}

impl MobiStreamService {
    pub fn new(d1: D1Client, r2: R2Client) -> Self {
        Self { d1, r2 }
    }

    /// Upload & Index Phase: User uploads MOBI -> R2.
    /// Reads first 16KB via Range request, parses PDB Record Offsets & Record 0 PalmDOC/MOBI header,
    /// and writes chapter slices into D1.
    pub async fn init_uploaded_mobi(
        &self,
        user_ns: &str,
        book_id: &str,
        file_name: &str,
        file_size: u64,
        r2_key: &str,
    ) -> Result<MobiBookInfo, AppError> {
        // 1. Fetch first 16KB from R2 via Range request
        let head_len = 16384.min(file_size);
        let head_bytes = self
            .r2
            .get_object_range(r2_key, 0, head_len)
            .await?
            .ok_or_else(|| AppError::BadRequest("无法读取 MOBI 头部数据".to_string()))?;

        // 2. Parse PDB Header and Record Offsets
        let (num_records, record_offsets) = parse_pdb_records(&head_bytes, file_size)?;
        if record_offsets.is_empty() {
            return Err(AppError::BadRequest("非法 MOBI: 缺少数据 Record".to_string()));
        }

        let rec0_offset = record_offsets[0];
        let rec0_len = if record_offsets.len() > 1 {
            record_offsets[1].saturating_sub(rec0_offset)
        } else {
            file_size.saturating_sub(rec0_offset)
        };

        // If Record 0 extends beyond the initial 16KB, fetch full Record 0
        let rec0_bytes = if (rec0_offset + rec0_len) <= head_bytes.len() as u64 {
            head_bytes[rec0_offset as usize..(rec0_offset + rec0_len) as usize].to_vec()
        } else {
            self.r2
                .get_object_range(r2_key, rec0_offset, rec0_len)
                .await?
                .ok_or_else(|| AppError::BadRequest("无法读取 MOBI Record 0 描述符".to_string()))?
        };

        // 3. Parse PalmDOC & MOBI Metadata
        let (compression, text_record_count, parsed_title) = parse_mobi_header(&rec0_bytes)?;

        let title = parsed_title.unwrap_or_else(|| {
            file_name
                .trim_end_matches(".mobi")
                .trim_end_matches(".MOBI")
                .trim_end_matches(".prc")
                .to_string()
        });

        let total_chapters = text_record_count.min(num_records.saturating_sub(1)) as i32;
        let now = now_ts();

        // 4. Save book info in D1 as 'ready'
        self.d1
            .execute(
                "INSERT INTO mobi_books (book_id, user_ns, file_name, r2_key, file_size, total_chapters, title, author, compression, status, created_at, updated_at) \
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, '未知作者', ?8, 'ready', ?9, ?10) \
                 ON CONFLICT(book_id) DO UPDATE SET file_size=excluded.file_size, total_chapters=excluded.total_chapters, title=excluded.title, updated_at=excluded.updated_at",
                &[
                    json!(book_id),
                    json!(user_ns),
                    json!(file_name),
                    json!(r2_key),
                    json!(file_size as i64),
                    json!(total_chapters),
                    json!(title.clone()),
                    json!(compression),
                    json!(now),
                    json!(now),
                ],
            )
            .await?;

        // 5. Index every text chapter record into D1
        // Each text record i is at offset record_offsets[i] with length record_offsets[i+1] - record_offsets[i]
        for i in 1..=total_chapters as usize {
            if i >= record_offsets.len() {
                break;
            }
            let byte_offset = record_offsets[i];
            let byte_length = if i + 1 < record_offsets.len() {
                record_offsets[i + 1].saturating_sub(byte_offset)
            } else {
                file_size.saturating_sub(byte_offset)
            };

            let chapter_idx = (i - 1) as i32;
            let chapter_title = format!("第 {} 节", i);

            self.d1
                .execute(
                    "INSERT INTO mobi_chapters (book_id, chapter_index, title, byte_offset, byte_length, compression, created_at) \
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7) \
                     ON CONFLICT(book_id, chapter_index) DO UPDATE SET byte_offset=excluded.byte_offset, byte_length=excluded.byte_length",
                    &[
                        json!(book_id),
                        json!(chapter_idx),
                        json!(chapter_title),
                        json!(byte_offset as i64),
                        json!(byte_length as i64),
                        json!(compression),
                        json!(now),
                    ],
                )
                .await?;
        }

        Ok(MobiBookInfo {
            book_id: book_id.to_string(),
            user_ns: user_ns.to_string(),
            file_name: file_name.to_string(),
            r2_key: r2_key.to_string(),
            file_size,
            total_chapters,
            title: Some(title),
            author: Some("未知作者".to_string()),
            compression,
            status: "ready".to_string(),
        })
    }

    /// Read Phase: Zero-parse Range Query - User requests chapter / page N
    pub async fn read_chapter_html(
        &self,
        book_id: &str,
        chapter_index: i32,
    ) -> Result<String, AppError> {
        // 1. Look up chapter byte offset and length in D1
        let row = self
            .d1
            .query_optional(
                "SELECT c.byte_offset, c.byte_length, c.compression, b.r2_key \
                 FROM mobi_chapters c \
                 JOIN mobi_books b ON c.book_id = b.book_id \
                 WHERE c.book_id = ?1 AND c.chapter_index = ?2",
                &[json!(book_id), json!(chapter_index)],
            )
            .await?
            .ok_or_else(|| AppError::BadRequest("未找到该 MOBI 章节记录".to_string()))?;

        let r2_key = row.get("r2_key").and_then(Value::as_str).unwrap_or("");
        let offset = row.get("byte_offset").and_then(Value::as_i64).unwrap_or(0) as u64;
        let length = row.get("byte_length").and_then(Value::as_i64).unwrap_or(0) as u64;
        let compression = row.get("compression").and_then(Value::as_i64).unwrap_or(1) as i32;

        // 2. Fetch only that 2~4KB record slice from R2 via HTTP Range
        let payload = self
            .r2
            .get_object_range(r2_key, offset, length)
            .await?
            .ok_or_else(|| AppError::Internal(anyhow::anyhow!("读取 R2 切片失败")))?;

        // 3. Decompress PalmDOC if needed (takes ~0.1ms)
        let decompressed = if compression == 2 {
            decompress_palmdoc(&payload)
        } else {
            payload
        };

        let content = String::from_utf8_lossy(&decompressed).to_string();
        Ok(content)
    }

    /// Read book metadata from D1
    pub async fn get_mobi_info(&self, book_id: &str) -> Result<MobiBookInfo, AppError> {
        let row = self
            .d1
            .query_optional(
                "SELECT book_id, user_ns, file_name, r2_key, file_size, total_chapters, title, author, compression, status FROM mobi_books WHERE book_id = ?1",
                &[json!(book_id)],
            )
            .await?
            .ok_or_else(|| AppError::BadRequest("未找到该 MOBI 书籍".to_string()))?;

        Ok(MobiBookInfo {
            book_id: row.get("book_id").and_then(Value::as_str).unwrap_or_default().to_string(),
            user_ns: row.get("user_ns").and_then(Value::as_str).unwrap_or_default().to_string(),
            file_name: row.get("file_name").and_then(Value::as_str).unwrap_or_default().to_string(),
            r2_key: row.get("r2_key").and_then(Value::as_str).unwrap_or_default().to_string(),
            file_size: row.get("file_size").and_then(Value::as_i64).unwrap_or(0) as u64,
            total_chapters: row.get("total_chapters").and_then(Value::as_i64).unwrap_or(0) as i32,
            title: row.get("title").and_then(Value::as_str).map(str::to_string),
            author: row.get("author").and_then(Value::as_str).map(str::to_string),
            compression: row.get("compression").and_then(Value::as_i64).unwrap_or(1) as i32,
            status: row.get("status").and_then(Value::as_str).unwrap_or("ready").to_string(),
        })
    }
}

// === PalmDOC / MOBI Parsing Utilities ===

fn parse_pdb_records(data: &[u8], total_file_size: u64) -> Result<(usize, Vec<u64>), AppError> {
    if data.len() < 78 {
        return Err(AppError::BadRequest("文件太小，不是有效 PDB/MOBI".to_string()));
    }
    let num_records = u16::from_be_bytes(data[76..78].try_into().unwrap()) as usize;
    let mut offsets = Vec::with_capacity(num_records);

    let mut pos = 78;
    for _ in 0..num_records {
        if pos + 8 > data.len() {
            break;
        }
        let offset = u32::from_be_bytes(data[pos..pos + 4].try_into().unwrap()) as u64;
        if offset < total_file_size {
            offsets.push(offset);
        }
        pos += 8;
    }

    Ok((num_records, offsets))
}

fn parse_mobi_header(rec0: &[u8]) -> Result<(i32, usize, Option<String>), AppError> {
    if rec0.len() < 16 {
        return Err(AppError::BadRequest("MOBI Record 0 数据损坏".to_string()));
    }

    // Compression: 1 = None, 2 = PalmDOC
    let compression = u16::from_be_bytes(rec0[0..2].try_into().unwrap()) as i32;
    let text_record_count = u16::from_be_bytes(rec0[8..10].try_into().unwrap()) as usize;

    let mut title = None;
    // Check if MOBI header is present at offset 16
    if rec0.len() >= 92 && &rec0[16..20] == b"MOBI" {
        let name_offset = u32::from_be_bytes(rec0[84..88].try_into().unwrap()) as usize;
        let name_length = u32::from_be_bytes(rec0[88..92].try_into().unwrap()) as usize;

        if name_offset + name_length <= rec0.len() {
            let raw_name = &rec0[name_offset..name_offset + name_length];
            let name_str = String::from_utf8_lossy(raw_name).trim().to_string();
            if !name_str.is_empty() {
                title = Some(name_str);
            }
        }
    }

    Ok((compression, text_record_count, title))
}

/// PalmDOC LZ77 decompressor. Runs in microseconds with zero allocations beyond the buffer.
pub fn decompress_palmdoc(data: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(data.len() * 2);
    let mut i = 0;
    while i < data.len() {
        let b = data[i];
        i += 1;
        if b == 0x00 {
            out.push(0);
        } else if b <= 0x08 {
            // Literal copy of the next b bytes
            let count = b as usize;
            let end = (i + count).min(data.len());
            out.extend_from_slice(&data[i..end]);
            i = end;
        } else if b <= 0x7f {
            out.push(b);
        } else if b <= 0xbf {
            // Two byte sequence: back-reference
            if i < data.len() {
                let next = data[i];
                i += 1;
                let distance = (((b as usize) & 0x3f) << 3) | ((next as usize) >> 5);
                let length = ((next as usize) & 0x07) + 3;
                if distance > 0 && distance <= out.len() {
                    let start = out.len() - distance;
                    for k in 0..length {
                        let byte = out[start + (k % distance)];
                        out.push(byte);
                    }
                }
            }
        } else {
            // 0xc0..=0xff: Space + ASCII character (b ^ 0x80)
            out.push(b' ');
            out.push(b ^ 0x80);
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_palmdoc_decompression_literals() {
        // Test literal ascii
        let data = b"Hello World";
        assert_eq!(decompress_palmdoc(data), b"Hello World");

        // Test space + char (0x80 ^ 'A')
        let data = vec![0xc0 | b'A' & 0x7f];
        assert_eq!(decompress_palmdoc(&data), b" A");
    }

    #[test]
    fn test_palmdoc_decompression_repeat() {
        // "abc" followed by back-reference distance=3, length=3 -> "abcabc"
        // distance=3: ((b & 0x3f) << 3) | (next >> 5) = 3
        // b = 0x80 | 0, next = (3 << 5) | (3 - 3) = 0x60
        let data = vec![b'a', b'b', b'c', 0x80, 0x60];
        assert_eq!(decompress_palmdoc(&data), b"abcabc");
    }

    #[test]
    fn test_parse_pdb_records() {
        let mut header = vec![0u8; 78 + 8 * 2];
        // num_records = 2
        header[76] = 0;
        header[77] = 2;
        // record 0 offset = 94
        header[78..82].copy_from_slice(&94u32.to_be_bytes());
        // record 1 offset = 200
        header[86..90].copy_from_slice(&200u32.to_be_bytes());

        let (count, offsets) = parse_pdb_records(&header, 500).unwrap();
        assert_eq!(count, 2);
        assert_eq!(offsets, vec![94, 200]);
    }
}
