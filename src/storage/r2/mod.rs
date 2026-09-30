use crate::error::error::AppError;
use reqwest::Client;
use serde::Deserialize;
use std::time::Duration;

#[derive(Clone)]
pub struct R2Client {
    account_id: String,
    api_token: String,
    bucket_name: String,
    http: Client,
}

#[derive(Debug, Deserialize)]
struct R2ListResponse {
    result: Option<R2ListResult>,
    success: bool,
}

#[derive(Debug, Deserialize)]
struct R2ListResult {
    objects: Option<Vec<R2Object>>,
}

#[derive(Debug, Deserialize)]
struct R2Object {
    key: String,
}

impl R2Client {
    pub fn new(account_id: String, api_token: String, bucket_name: String) -> Self {
        let http = Client::builder()
            .timeout(Duration::from_secs(30))
            .build()
            .unwrap_or_default();
        Self {
            account_id,
            api_token,
            bucket_name,
            http,
        }
    }

    fn object_url(&self, key: &str) -> String {
        let clean_key = key.trim_start_matches('/');
        format!(
            "https://api.cloudflare.com/client/v4/accounts/{}/r2/buckets/{}/objects/{}",
            self.account_id, self.bucket_name, clean_key
        )
    }

    /// Upload an object to R2 bucket
    pub async fn put_object(
        &self,
        key: &str,
        data: Vec<u8>,
        content_type: Option<&str>,
    ) -> Result<(), AppError> {
        let mut req = self
            .http
            .put(self.object_url(key))
            .header("Authorization", format!("Bearer {}", self.api_token))
            .body(data);

        if let Some(ct) = content_type {
            req = req.header("Content-Type", ct);
        }

        let resp = req
            .send()
            .await
            .map_err(|e| AppError::Internal(anyhow::anyhow!("R2 put network error: {}", e)))?;

        if !resp.status().is_success() {
            let status = resp.status();
            let err_text = resp.text().await.unwrap_or_default();
            return Err(AppError::Internal(anyhow::anyhow!(
                "R2 put failed ({status}): {err_text}"
            )));
        }

        Ok(())
    }

    /// Retrieve an object from R2 bucket. Returns None if 404 Not Found.
    pub async fn get_object(&self, key: &str) -> Result<Option<Vec<u8>>, AppError> {
        let resp = self
            .http
            .get(self.object_url(key))
            .header("Authorization", format!("Bearer {}", self.api_token))
            .send()
            .await
            .map_err(|e| AppError::Internal(anyhow::anyhow!("R2 get network error: {}", e)))?;

        if resp.status() == reqwest::StatusCode::NOT_FOUND {
            return Ok(None);
        }

        if !resp.status().is_success() {
            let status = resp.status();
            let err_text = resp.text().await.unwrap_or_default();
            return Err(AppError::Internal(anyhow::anyhow!(
                "R2 get failed ({status}): {err_text}"
            )));
        }

        let bytes = resp
            .bytes()
            .await
            .map_err(|e| AppError::Internal(anyhow::anyhow!("R2 read body error: {}", e)))?;

        Ok(Some(bytes.to_vec()))
    }

    /// Retrieve a specific byte range from an R2 object using HTTP Range header.
    pub async fn get_object_range(
        &self,
        key: &str,
        offset: u64,
        length: u64,
    ) -> Result<Option<Vec<u8>>, AppError> {
        if length == 0 {
            return Ok(Some(Vec::new()));
        }
        let range_header = format!("bytes={}-{}", offset, offset + length - 1);
        let resp = self
            .http
            .get(self.object_url(key))
            .header("Authorization", format!("Bearer {}", self.api_token))
            .header("Range", range_header)
            .send()
            .await
            .map_err(|e| AppError::Internal(anyhow::anyhow!("R2 range get network error: {}", e)))?;

        if resp.status() == reqwest::StatusCode::NOT_FOUND {
            return Ok(None);
        }

        // 206 Partial Content or 200 OK
        if resp.status() != reqwest::StatusCode::PARTIAL_CONTENT && !resp.status().is_success() {
            let status = resp.status();
            let err_text = resp.text().await.unwrap_or_default();
            return Err(AppError::Internal(anyhow::anyhow!(
                "R2 range get failed ({status}): {err_text}"
            )));
        }

        let bytes = resp
            .bytes()
            .await
            .map_err(|e| AppError::Internal(anyhow::anyhow!("R2 read body error: {}", e)))?;

        Ok(Some(bytes.to_vec()))
    }

    /// Retrieve the last N bytes of an object (e.g. for ZIP End-of-Central-Directory reading).
    pub async fn get_object_tail(
        &self,
        key: &str,
        tail_bytes: u64,
    ) -> Result<Option<Vec<u8>>, AppError> {
        if tail_bytes == 0 {
            return Ok(Some(Vec::new()));
        }
        let range_header = format!("bytes=-{}", tail_bytes);
        let resp = self
            .http
            .get(self.object_url(key))
            .header("Authorization", format!("Bearer {}", self.api_token))
            .header("Range", range_header)
            .send()
            .await
            .map_err(|e| AppError::Internal(anyhow::anyhow!("R2 tail get network error: {}", e)))?;

        if resp.status() == reqwest::StatusCode::NOT_FOUND {
            return Ok(None);
        }

        if resp.status() != reqwest::StatusCode::PARTIAL_CONTENT && !resp.status().is_success() {
            let status = resp.status();
            let err_text = resp.text().await.unwrap_or_default();
            return Err(AppError::Internal(anyhow::anyhow!(
                "R2 tail get failed ({status}): {err_text}"
            )));
        }

        let bytes = resp
            .bytes()
            .await
            .map_err(|e| AppError::Internal(anyhow::anyhow!("R2 read body error: {}", e)))?;

        Ok(Some(bytes.to_vec()))
    }

    /// Delete an object from R2 bucket
    pub async fn delete_object(&self, key: &str) -> Result<(), AppError> {
        let resp = self
            .http
            .delete(self.object_url(key))
            .header("Authorization", format!("Bearer {}", self.api_token))
            .send()
            .await
            .map_err(|e| AppError::Internal(anyhow::anyhow!("R2 delete network error: {}", e)))?;

        if !resp.status().is_success() && resp.status() != reqwest::StatusCode::NOT_FOUND {
            let status = resp.status();
            let err_text = resp.text().await.unwrap_or_default();
            return Err(AppError::Internal(anyhow::anyhow!(
                "R2 delete failed ({status}): {err_text}"
            )));
        }

        Ok(())
    }

    /// List object keys with a specific prefix in R2 bucket
    pub async fn list_objects(&self, prefix: &str) -> Result<Vec<String>, AppError> {
        let clean_prefix = prefix.trim_start_matches('/');
        let url = format!(
            "https://api.cloudflare.com/client/v4/accounts/{}/r2/buckets/{}/objects?prefix={}",
            self.account_id, self.bucket_name, clean_prefix
        );

        let resp = self
            .http
            .get(&url)
            .header("Authorization", format!("Bearer {}", self.api_token))
            .send()
            .await
            .map_err(|e| AppError::Internal(anyhow::anyhow!("R2 list network error: {}", e)))?;

        if !resp.status().is_success() {
            let status = resp.status();
            let err_text = resp.text().await.unwrap_or_default();
            return Err(AppError::Internal(anyhow::anyhow!(
                "R2 list failed ({status}): {err_text}"
            )));
        }

        let list_resp: R2ListResponse = resp
            .json()
            .await
            .map_err(|e| AppError::Internal(anyhow::anyhow!("R2 list json parse error: {}", e)))?;

        let keys = list_resp
            .result
            .and_then(|r| r.objects)
            .unwrap_or_default()
            .into_iter()
            .map(|obj| obj.key)
            .collect();

        Ok(keys)
    }
}
