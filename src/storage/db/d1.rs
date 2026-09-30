use crate::error::error::AppError;
use reqwest::Client;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::time::Duration;

#[derive(Clone)]
pub struct D1Client {
    account_id: String,
    api_token: String,
    database_id: String,
    http: Client,
}

#[derive(Debug, Serialize)]
struct D1QueryRequest<'a> {
    sql: &'a str,
    params: &'a [Value],
}

#[derive(Debug, Deserialize)]
struct D1QueryResult {
    results: Option<Vec<Value>>,
    success: bool,
    meta: Option<D1Meta>,
}

#[derive(Debug, Deserialize)]
struct D1Meta {
    changes: Option<u64>,
}

#[derive(Debug, Deserialize)]
struct D1ApiResponse {
    result: Option<Vec<D1QueryResult>>,
    success: bool,
    errors: Option<Vec<D1Error>>,
}

#[derive(Debug, Deserialize)]
struct D1Error {
    message: String,
}

impl D1Client {
    pub fn new(account_id: String, api_token: String, database_id: String) -> Self {
        let http = Client::builder()
            .timeout(Duration::from_secs(15))
            .build()
            .unwrap_or_default();
        Self {
            account_id,
            api_token,
            database_id,
            http,
        }
    }

    fn endpoint(&self) -> String {
        format!(
            "https://api.cloudflare.com/client/v4/accounts/{}/d1/database/{}/query",
            self.account_id, self.database_id
        )
    }

    pub async fn query_all(
        &self,
        sql: &str,
        params: &[Value],
    ) -> Result<Vec<Value>, AppError> {
        let payload = D1QueryRequest { sql, params };
        let resp = self
            .http
            .post(self.endpoint())
            .header("Authorization", format!("Bearer {}", self.api_token))
            .header("Content-Type", "application/json")
            .json(&payload)
            .send()
            .await
            .map_err(|e| AppError::Internal(anyhow::anyhow!("D1 network error: {}", e)))?;

        let status = resp.status();
        let body: D1ApiResponse = resp
            .json()
            .await
            .map_err(|e| AppError::Internal(anyhow::anyhow!("D1 json parse error: {}", e)))?;

        if !status.is_success() || !body.success {
            let err_msg = body
                .errors
                .and_then(|errs| errs.into_iter().next())
                .map(|e| e.message)
                .unwrap_or_else(|| format!("HTTP status {}", status));
            return Err(AppError::Internal(anyhow::anyhow!("D1 query failed: {}", err_msg)));
        }

        let rows = body
            .result
            .and_then(|mut r| r.pop())
            .and_then(|res| res.results)
            .unwrap_or_default();

        Ok(rows)
    }

    pub async fn query_optional(
        &self,
        sql: &str,
        params: &[Value],
    ) -> Result<Option<Value>, AppError> {
        let rows = self.query_all(sql, params).await?;
        Ok(rows.into_iter().next())
    }

    pub async fn execute(
        &self,
        sql: &str,
        params: &[Value],
    ) -> Result<u64, AppError> {
        let payload = D1QueryRequest { sql, params };
        let resp = self
            .http
            .post(self.endpoint())
            .header("Authorization", format!("Bearer {}", self.api_token))
            .header("Content-Type", "application/json")
            .json(&payload)
            .send()
            .await
            .map_err(|e| AppError::Internal(anyhow::anyhow!("D1 network error: {}", e)))?;

        let status = resp.status();
        let body: D1ApiResponse = resp
            .json()
            .await
            .map_err(|e| AppError::Internal(anyhow::anyhow!("D1 json parse error: {}", e)))?;

        if !status.is_success() || !body.success {
            let err_msg = body
                .errors
                .and_then(|errs| errs.into_iter().next())
                .map(|e| e.message)
                .unwrap_or_else(|| format!("HTTP status {}", status));
            return Err(AppError::Internal(anyhow::anyhow!("D1 execute failed: {}", err_msg)));
        }

        let changes = body
            .result
            .and_then(|mut r| r.pop())
            .and_then(|res| res.meta)
            .and_then(|m| m.changes)
            .unwrap_or(0);

        Ok(changes)
    }
}
