use crate::error::error::AppError;
use crate::storage::db::d1::D1Client;
use crate::storage::r2::R2Client;
use crate::util::time::now_ts;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PdfBookInfo {
    pub book_id: String,
    pub user_ns: String,
    pub file_name: String,
    pub r2_key: String,
    pub file_size: u64,
    pub total_pages: i32,
    pub title: Option<String>,
    pub author: Option<String>,
    pub status: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PdfOutlineItem {
    pub id: i64,
    pub book_id: String,
    pub title: String,
    pub dest_page: i32,
    pub level: i32,
}

pub struct PdfStreamService {
    d1: D1Client,
    r2: R2Client,
}

impl PdfStreamService {
    pub fn new(d1: D1Client, r2: R2Client) -> Self {
        Self { d1, r2 }
    }

    /// Upload & Index Phase: User uploads PDF -> R2.
    /// Reads tail 64KB via R2 Range request, extracts page count & metadata, writes index to D1.
    pub async fn init_uploaded_pdf(
        &self,
        user_ns: &str,
        book_id: &str,
        file_name: &str,
        file_size: u64,
        r2_key: &str,
    ) -> Result<PdfBookInfo, AppError> {
        // 1. Fetch only the last 64KB to locate trailer, startxref, and /Pages /Count
        let tail_len = 65536.min(file_size);
        let tail_bytes = self
            .r2
            .get_object_tail(r2_key, tail_len)
            .await?
            .ok_or_else(|| AppError::BadRequest("无法读取 PDF 尾部数据".to_string()))?;

        let tail_text = String::from_utf8_lossy(&tail_bytes);

        // 2. Extract total pages from /Pages tree (/Count N)
        let total_pages = parse_pdf_page_count(&tail_text).unwrap_or(1);

        // 3. Extract title and author if available in trailer /Info
        let parsed_title = parse_pdf_info_field(&tail_text, "Title");
        let parsed_author = parse_pdf_info_field(&tail_text, "Author");

        let title = parsed_title.unwrap_or_else(|| {
            file_name
                .trim_end_matches(".pdf")
                .trim_end_matches(".PDF")
                .to_string()
        });

        let now = now_ts();

        // 4. Save metadata into D1
        self.d1
            .execute(
                "INSERT INTO pdf_books (book_id, user_ns, file_name, r2_key, file_size, total_pages, title, author, status, created_at, updated_at) \
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 'ready', ?9, ?10) \
                 ON CONFLICT(book_id) DO UPDATE SET file_size=excluded.file_size, total_pages=excluded.total_pages, title=excluded.title, author=excluded.author, updated_at=excluded.updated_at",
                &[
                    json!(book_id),
                    json!(user_ns),
                    json!(file_name),
                    json!(r2_key),
                    json!(file_size as i64),
                    json!(total_pages),
                    json!(title.clone()),
                    json!(parsed_author.clone()),
                    json!(now),
                    json!(now),
                ],
            )
            .await?;

        Ok(PdfBookInfo {
            book_id: book_id.to_string(),
            user_ns: user_ns.to_string(),
            file_name: file_name.to_string(),
            r2_key: r2_key.to_string(),
            file_size,
            total_pages,
            title: Some(title),
            author: parsed_author,
            status: "ready".to_string(),
        })
    }

    /// Read Phase: Query D1 for metadata
    pub async fn get_pdf_info(&self, book_id: &str) -> Result<PdfBookInfo, AppError> {
        let row = self
            .d1
            .query_optional(
                "SELECT book_id, user_ns, file_name, r2_key, file_size, total_pages, title, author, status FROM pdf_books WHERE book_id = ?1",
                &[json!(book_id)],
            )
            .await?
            .ok_or_else(|| AppError::BadRequest("未找到该 PDF 书籍".to_string()))?;

        Ok(PdfBookInfo {
            book_id: row.get("book_id").and_then(Value::as_str).unwrap_or_default().to_string(),
            user_ns: row.get("user_ns").and_then(Value::as_str).unwrap_or_default().to_string(),
            file_name: row.get("file_name").and_then(Value::as_str).unwrap_or_default().to_string(),
            r2_key: row.get("r2_key").and_then(Value::as_str).unwrap_or_default().to_string(),
            file_size: row.get("file_size").and_then(Value::as_i64).unwrap_or(0) as u64,
            total_pages: row.get("total_pages").and_then(Value::as_i64).unwrap_or(1) as i32,
            title: row.get("title").and_then(Value::as_str).map(str::to_string),
            author: row.get("author").and_then(Value::as_str).map(str::to_string),
            status: row.get("status").and_then(Value::as_str).unwrap_or("ready").to_string(),
        })
    }

    /// Read Phase: Query D1 for Outline / TOC
    pub async fn get_pdf_outlines(&self, book_id: &str) -> Result<Vec<PdfOutlineItem>, AppError> {
        let rows = self
            .d1
            .query_all(
                "SELECT id, book_id, title, dest_page, level FROM pdf_outlines WHERE book_id = ?1 ORDER BY dest_page ASC",
                &[json!(book_id)],
            )
            .await?;

        let mut outlines = Vec::new();
        for r in rows {
            outlines.push(PdfOutlineItem {
                id: r.get("id").and_then(Value::as_i64).unwrap_or(0),
                book_id: r.get("book_id").and_then(Value::as_str).unwrap_or_default().to_string(),
                title: r.get("title").and_then(Value::as_str).unwrap_or_default().to_string(),
                dest_page: r.get("dest_page").and_then(Value::as_i64).unwrap_or(1) as i32,
                level: r.get("level").and_then(Value::as_i64).unwrap_or(1) as i32,
            });
        }
        Ok(outlines)
    }

    /// Streaming Phase: Fetch exact byte range for Range request
    pub async fn stream_range(
        &self,
        book_id: &str,
        offset: u64,
        length: u64,
    ) -> Result<(Vec<u8>, u64), AppError> {
        let info = self.get_pdf_info(book_id).await?;
        let payload = self
            .r2
            .get_object_range(&info.r2_key, offset, length)
            .await?
            .unwrap_or_default();
        Ok((payload, info.file_size))
    }
}

// === Lightweight PDF Header / Trailer Parsing ===

fn parse_pdf_page_count(tail: &str) -> Option<i32> {
    // In PDF, the root /Pages object contains /Count <integer>
    // Search backward for /Count <num>
    let re = regex::Regex::new(r"/Count\s+(\d+)").ok()?;
    let mut last_count = None;
    for cap in re.captures_iter(tail) {
        if let Some(m) = cap.get(1) {
            if let Ok(c) = m.as_str().parse::<i32>() {
                if c > 0 {
                    last_count = Some(c);
                }
            }
        }
    }
    last_count
}

fn parse_pdf_info_field(tail: &str, field_name: &str) -> Option<String> {
    let pattern = format!(r"/{field_name}\s*\(([^)]+)\)");
    let re = regex::Regex::new(&pattern).ok()?;
    if let Some(cap) = re.captures(tail) {
        if let Some(m) = cap.get(1) {
            let raw = m.as_str().trim();
            if !raw.is_empty() {
                return Some(raw.to_string());
            }
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_pdf_page_count() {
        let sample = "trailer << /Size 22 /Root 1 0 R /Info 2 0 R >> \
                      3 0 obj << /Type /Pages /Count 365 /Kids [4 0 R] >> endobj \
                      startxref 123456 %%EOF";
        assert_eq!(parse_pdf_page_count(sample), Some(365));

        let empty = "no count here";
        assert_eq!(parse_pdf_page_count(empty), None);
    }

    #[test]
    fn test_parse_pdf_info_fields() {
        let sample = "trailer << /Info << /Title (Rust Programming Language) /Author (Steve Klabnik) >> >>";
        assert_eq!(
            parse_pdf_info_field(sample, "Title"),
            Some("Rust Programming Language".to_string())
        );
        assert_eq!(
            parse_pdf_info_field(sample, "Author"),
            Some("Steve Klabnik".to_string())
        );
        assert_eq!(parse_pdf_info_field(sample, "Subject"), None);
    }
}
