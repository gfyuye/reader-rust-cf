use crate::error::error::AppError;
use crate::storage::db::d1::D1Client;
use crate::storage::r2::R2Client;
use crate::util::time::now_ts;
use regex::Regex;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TxtBookInfo {
    pub book_id: String,
    pub user_ns: String,
    pub file_name: String,
    pub r2_key: String,
    pub file_size: u64,
    pub total_chapters: i32,
    pub title: String,
    pub author: String,
    pub status: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TxtChapterItem {
    pub book_id: String,
    pub chapter_index: i32,
    pub title: String,
    pub byte_offset: u64,
    pub byte_length: u64,
}

pub struct TxtStreamService {
    d1: D1Client,
    r2: R2Client,
}

impl TxtStreamService {
    pub fn new(d1: D1Client, r2: R2Client) -> Self {
        Self { d1, r2 }
    }

    /// Upload & Index Phase: Parses headings, stores UTF-8 text in R2, saves chapter slice indices to D1.
    pub async fn init_uploaded_txt(
        &self,
        user_ns: &str,
        book_id: &str,
        file_name: &str,
        utf8_text: &str,
        r2_key: &str,
    ) -> Result<TxtBookInfo, AppError> {
        let utf8_bytes = utf8_text.as_bytes();
        let file_size = utf8_bytes.len() as u64;

        // 1. Upload clean UTF-8 bytes to R2
        self.r2
            .put_object(r2_key, utf8_bytes.to_vec(), Some("text/plain; charset=utf-8"))
            .await?;

        // 2. Scan chapter headings and calculate byte offsets
        let chapters = scan_txt_chapter_offsets(utf8_text);
        let total_chapters = chapters.len() as i32;

        let title = file_name
            .trim_end_matches(".txt")
            .trim_end_matches(".TXT")
            .to_string();

        let now = now_ts();

        // 3. Save book record in D1
        self.d1
            .execute(
                "INSERT INTO txt_books (book_id, user_ns, file_name, r2_key, file_size, total_chapters, title, author, status, created_at, updated_at) \
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, '本地导入', 'ready', ?8, ?9) \
                 ON CONFLICT(book_id) DO UPDATE SET file_size=excluded.file_size, total_chapters=excluded.total_chapters, title=excluded.title, updated_at=excluded.updated_at",
                &[
                    json!(book_id),
                    json!(user_ns),
                    json!(file_name),
                    json!(r2_key),
                    json!(file_size as i64),
                    json!(total_chapters),
                    json!(title.clone()),
                    json!(now),
                    json!(now),
                ],
            )
            .await?;

        // 4. Batch insert chapter byte slices into D1
        for (idx, (ch_title, offset, len)) in chapters.iter().enumerate() {
            self.d1
                .execute(
                    "INSERT INTO txt_chapters (book_id, chapter_index, title, byte_offset, byte_length, created_at) \
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6) \
                     ON CONFLICT(book_id, chapter_index) DO UPDATE SET byte_offset=excluded.byte_offset, byte_length=excluded.byte_length",
                    &[
                        json!(book_id),
                        json!(idx as i32),
                        json!(ch_title),
                        json!(*offset as i64),
                        json!(*len as i64),
                        json!(now),
                    ],
                )
                .await?;
        }

        Ok(TxtBookInfo {
            book_id: book_id.to_string(),
            user_ns: user_ns.to_string(),
            file_name: file_name.to_string(),
            r2_key: r2_key.to_string(),
            file_size,
            total_chapters,
            title,
            author: "本地导入".to_string(),
            status: "ready".to_string(),
        })
    }

    /// Read Phase (Zero-Memory Range Stream): User requests chapter N.
    /// Pulls ONLY the 2KB~16KB byte slice from R2 without loading the full text into RAM.
    pub async fn read_chapter_text(
        &self,
        book_id: &str,
        chapter_index: i32,
    ) -> Result<String, AppError> {
        let row = self
            .d1
            .query_optional(
                "SELECT c.byte_offset, c.byte_length, b.r2_key \
                 FROM txt_chapters c \
                 JOIN txt_books b ON c.book_id = b.book_id \
                 WHERE c.book_id = ?1 AND c.chapter_index = ?2",
                &[json!(book_id), json!(chapter_index)],
            )
            .await?
            .ok_or_else(|| AppError::BadRequest("未找到该 TXT 章节".to_string()))?;

        let r2_key = row.get("r2_key").and_then(Value::as_str).unwrap_or("");
        let offset = row.get("byte_offset").and_then(Value::as_i64).unwrap_or(0) as u64;
        let length = row.get("byte_length").and_then(Value::as_i64).unwrap_or(0) as u64;

        let payload = self
            .r2
            .get_object_range(r2_key, offset, length)
            .await?
            .ok_or_else(|| AppError::Internal(anyhow::anyhow!("读取 R2 TXT 切片失败")))?;

        Ok(String::from_utf8_lossy(&payload).to_string())
    }

    pub async fn get_txt_info(&self, book_id: &str) -> Result<TxtBookInfo, AppError> {
        let row = self
            .d1
            .query_optional(
                "SELECT book_id, user_ns, file_name, r2_key, file_size, total_chapters, title, author, status FROM txt_books WHERE book_id = ?1",
                &[json!(book_id)],
            )
            .await?
            .ok_or_else(|| AppError::BadRequest("未找到该 TXT 书籍".to_string()))?;

        Ok(TxtBookInfo {
            book_id: row.get("book_id").and_then(Value::as_str).unwrap_or_default().to_string(),
            user_ns: row.get("user_ns").and_then(Value::as_str).unwrap_or_default().to_string(),
            file_name: row.get("file_name").and_then(Value::as_str).unwrap_or_default().to_string(),
            r2_key: row.get("r2_key").and_then(Value::as_str).unwrap_or_default().to_string(),
            file_size: row.get("file_size").and_then(Value::as_i64).unwrap_or(0) as u64,
            total_chapters: row.get("total_chapters").and_then(Value::as_i64).unwrap_or(0) as i32,
            title: row.get("title").and_then(Value::as_str).unwrap_or_default().to_string(),
            author: row.get("author").and_then(Value::as_str).unwrap_or_default().to_string(),
            status: row.get("status").and_then(Value::as_str).unwrap_or("ready").to_string(),
        })
    }

    pub async fn get_chapter_list(&self, book_id: &str) -> Result<Vec<TxtChapterItem>, AppError> {
        let rows = self
            .d1
            .query_all(
                "SELECT book_id, chapter_index, title, byte_offset, byte_length FROM txt_chapters WHERE book_id = ?1 ORDER BY chapter_index ASC",
                &[json!(book_id)],
            )
            .await?;

        let list = rows
            .into_iter()
            .map(|r| TxtChapterItem {
                book_id: r.get("book_id").and_then(Value::as_str).unwrap_or_default().to_string(),
                chapter_index: r.get("chapter_index").and_then(Value::as_i64).unwrap_or(0) as i32,
                title: r.get("title").and_then(Value::as_str).unwrap_or_default().to_string(),
                byte_offset: r.get("byte_offset").and_then(Value::as_i64).unwrap_or(0) as u64,
                byte_length: r.get("byte_length").and_then(Value::as_i64).unwrap_or(0) as u64,
            })
            .collect();

        Ok(list)
    }
}

// === TXT Chapter Heading Offset Scanner ===

pub fn scan_txt_chapter_offsets(text: &str) -> Vec<(String, usize, usize)> {
    let re = Regex::new(
        r"(?m)^\s*(第[0-9一二三四五六七八九十百千万零两]+[章回节卷集幕篇部话段]|Chapter\s+\d+|序章|引子|楔子|尾声|番外)[^\r\n]*$",
    )
    .unwrap();

    let mut matches: Vec<(usize, String)> = Vec::new();
    for cap in re.captures_iter(text) {
        if let Some(m) = cap.get(0) {
            let title = m.as_str().trim().to_string();
            matches.push((m.start(), title));
        }
    }

    if matches.is_empty() {
        // Fallback: Single chapter for entire text
        return vec![("全本".to_string(), 0, text.len())];
    }

    let mut chapters = Vec::new();
    let first_start = matches[0].0;
    if first_start > 0 && !text[..first_start].trim().is_empty() {
        chapters.push(("序章".to_string(), 0, first_start));
    }

    for (i, (start, title)) in matches.iter().enumerate() {
        let next_start = if i + 1 < matches.len() {
            matches[i + 1].0
        } else {
            text.len()
        };
        let len = next_start.saturating_sub(*start);
        if len > 0 {
            chapters.push((title.clone(), *start, len));
        }
    }

    chapters
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_scan_txt_chapter_offsets() {
        let text = "这是前言介绍。\n\n第一章 风起\n天下大乱。\n\n第二章 云涌\n群雄逐鹿。";
        let chapters = scan_txt_chapter_offsets(text);
        assert_eq!(chapters.len(), 3);
        assert_eq!(chapters[0].0, "序章");
        assert_eq!(chapters[1].0, "第一章 风起");
        assert_eq!(chapters[2].0, "第二章 云涌");

        let ch1 = &text[chapters[1].1..chapters[1].1 + chapters[1].2];
        assert!(ch1.contains("第一章 风起"));
        assert!(ch1.contains("天下大乱"));
    }
}
