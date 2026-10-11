use crate::util::hash::md5_hex;
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use tokio::fs;

#[derive(Clone)]
pub struct FileCache {
    root: PathBuf,
}

impl FileCache {
    pub fn new(root: impl AsRef<Path>) -> Self {
        Self {
            root: root.as_ref().to_path_buf(),
        }
    }

    /// Get cached content for a specific book
    pub async fn get(
        &self,
        user_ns: &str,
        book_key: &str,
        chapter_key: &str,
    ) -> anyhow::Result<Option<String>> {
        let path = self.chapter_path(user_ns, book_key, chapter_key);
        if !path.exists() {
            return Ok(None);
        }
        let data = fs::read_to_string(path).await?;
        Ok(Some(data))
    }

    /// Put cached content for a specific book
    pub async fn put(
        &self,
        user_ns: &str,
        book_key: &str,
        chapter_key: &str,
        value: &str,
    ) -> anyhow::Result<()> {
        let path = self.chapter_path(user_ns, book_key, chapter_key);
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).await?;
        }
        fs::write(path, value).await?;
        Ok(())
    }

    /// Remove a single chapter cache
    pub async fn remove(
        &self,
        user_ns: &str,
        book_key: &str,
        chapter_key: &str,
    ) -> anyhow::Result<()> {
        let path = self.chapter_path(user_ns, book_key, chapter_key);
        if path.exists() {
            fs::remove_file(path).await?;
        }
        Ok(())
    }

    /// Check if a chapter cache exists
    pub async fn exists(&self, user_ns: &str, book_key: &str, chapter_key: &str) -> bool {
        let path = self.chapter_path(user_ns, book_key, chapter_key);
        path.exists()
    }

    /// Batch-exists check for multiple chapter keys under the same book.
    /// Reads the book's cache directory once and checks membership, avoiding
    /// one stat call per chapter key (eliminates N+1 pattern).
    pub async fn exists_batch(
        &self,
        user_ns: &str,
        book_key: &str,
        chapter_keys: &[String],
    ) -> Vec<String> {
        let book_dir = self.book_path(user_ns, book_key);
        if !book_dir.exists() {
            return Vec::new();
        }
        let mut present: HashSet<String> = HashSet::new();
        let mut read_dir = match fs::read_dir(&book_dir).await {
            Ok(rd) => rd,
            Err(_) => return Vec::new(),
        };
        while let Ok(Some(entry)) = read_dir.next_entry().await {
            if let Ok(file_name) = entry.file_name().into_string() {
                present.insert(file_name);
            }
        }
        chapter_keys
            .iter()
            .filter(|k| {
                let name = md5_hex(k) + ".txt";
                present.contains(name.as_str())
            })
            .cloned()
            .collect()
    }

    /// Remove all cache for a book (delete the book's cache directory)
    pub async fn remove_book(&self, user_ns: &str, book_key: &str) -> anyhow::Result<bool> {
        let path = self.book_path(user_ns, book_key);
        if path.exists() {
            fs::remove_dir_all(&path).await?;
            Ok(true)
        } else {
            Ok(false)
        }
    }

    /// Get the directory path for a book's cache
    fn book_path(&self, user_ns: &str, book_key: &str) -> PathBuf {
        self.root.join(user_ns).join(book_key)
    }

    /// Get the file path for a specific chapter
    fn chapter_path(&self, user_ns: &str, book_key: &str, chapter_key: &str) -> PathBuf {
        let name = md5_hex(chapter_key);
        self.book_path(user_ns, book_key)
            .join(name)
            .with_extension("txt")
    }
}