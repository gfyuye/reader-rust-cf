use crate::error::error::AppError;
use crate::model::book_source::BookSource;
use crate::util::time::now_ts;
use sqlx::{Row, SqlitePool};

#[derive(Clone)]
pub struct BookSourceRepo {
    pool: SqlitePool,
}

impl BookSourceRepo {
    pub fn new(pool: SqlitePool) -> Self {
        Self { pool }
    }

    pub async fn upsert(
        &self,
        user_ns: &str,
        source: &BookSource,
        json: &str,
    ) -> Result<(), AppError> {
        sqlx::query(
            "INSERT INTO book_sources (user_ns, book_source_url, book_source_name, json, updated_at) VALUES (?1, ?2, ?3, ?4, ?5) \
             ON CONFLICT(user_ns, book_source_url) DO UPDATE SET book_source_name=excluded.book_source_name, json=excluded.json, updated_at=excluded.updated_at"
        )
        .bind(user_ns)
        .bind(&source.book_source_url)
        .bind(&source.book_source_name)
        .bind(json)
        .bind(now_ts())
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    pub async fn delete(&self, user_ns: &str, book_source_url: &str) -> Result<(), AppError> {
        sqlx::query("DELETE FROM book_sources WHERE user_ns=?1 AND book_source_url=?2")
            .bind(user_ns)
            .bind(book_source_url)
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    pub async fn delete_all(&self, user_ns: &str) -> Result<(), AppError> {
        sqlx::query("DELETE FROM book_sources WHERE user_ns=?1")
            .bind(user_ns)
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    pub async fn get(
        &self,
        user_ns: &str,
        book_source_url: &str,
    ) -> Result<Option<String>, AppError> {
        let row =
            sqlx::query("SELECT json FROM book_sources WHERE user_ns=?1 AND book_source_url=?2")
                .bind(user_ns)
                .bind(book_source_url)
                .fetch_optional(&self.pool)
                .await?;
        Ok(row.map(|r| r.get::<String, _>("json")))
    }

    pub async fn list(&self, user_ns: &str) -> Result<Vec<String>, AppError> {
        let rows =
            sqlx::query("SELECT json FROM book_sources WHERE user_ns=?1 ORDER BY updated_at DESC")
                .bind(user_ns)
                .fetch_all(&self.pool)
                .await?;
        Ok(rows
            .into_iter()
            .map(|r| r.get::<String, _>("json"))
            .collect())
    }

    /// Batch fetch: get JSON for multiple book_source_urls in a single query.
    /// Eliminates N+1 when looking up sources by URL.
    pub async fn get_by_urls(
        &self,
        user_ns: &str,
        book_source_urls: &[String],
    ) -> Result<std::collections::HashMap<String, String>, AppError> {
        if book_source_urls.is_empty() {
            return Ok(std::collections::HashMap::new());
        }
        // Build a single query with IN clause
        let placeholders: Vec<String> = book_source_urls
            .iter()
            .enumerate()
            .map(|(i, _)| format("?{}", i + 2))
            .collect();
        let sql = format!(
            "SELECT book_source_url, json FROM book_sources WHERE user_ns=?1 AND book_source_url IN ({})",
            placeholders.join(",")
        );
        let mut query = sqlx::query(&sql).bind(user_ns);
        for url in book_source_urls {
            query = query.bind(url);
        }
        let rows = query.fetch_all(&self.pool).await?;
        Ok(rows
            .into_iter()
            .map(|r| (r.get::<String, _>("book_source_url"), r.get::<String, _>("json")))
            .collect())
    }

    pub async fn copy_to(&self, from_ns: &str, to_ns: &str) -> Result<i64, AppError> {
        let rows = sqlx::query("SELECT book_source_url, book_source_name, json, updated_at FROM book_sources WHERE user_ns=?1")
            .bind(from_ns)
            .fetch_all(&self.pool)
            .await?;
        let count = rows.len() as i64;
        for row in rows {
            let url: String = row.get("book_source_url");
            let name: String = row.get("book_source_name");
            let json: String = row.get("json");
            let updated_at: i64 = row.get("updated_at");
            sqlx::query(
                "INSERT INTO book_sources (user_ns, book_source_url, book_source_name, json, updated_at) VALUES (?1, ?2, ?3, ?4, ?5) \
                 ON CONFLICT(user_ns, book_source_url) DO UPDATE SET book_source_name=excluded.book_source_name, json=excluded.json, updated_at=excluded.updated_at"
            )
            .bind(to_ns)
            .bind(&url)
            .bind(&name)
            .bind(&json)
            .bind(updated_at)
            .execute(&self.pool)
            .await?;
        }
        Ok(count)
    }
}
