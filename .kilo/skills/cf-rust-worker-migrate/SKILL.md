---
name: cf-rust-worker-migrate
description: Guide and workflows for migrating reader-rust Axum/Tokio backend to Cloudflare Workers (workers-rs / wasm32), replacing C dependencies (rquickjs, sqlx, std::fs) with D1, R2, and V8 runtime.
---

# Skill: Migrating reader-rust Backend to Cloudflare Workers

This skill provides step-by-step engineering workflows and patterns to migrate the `reader-rust` backend from native Linux/x86 (Axum + Tokio + SQLite + rquickjs) into Cloudflare Workers Serverless runtime (`workers-rs` / `wasm32-unknown-unknown`).

## 1. Core Architectural Shift

| Native Component (`reader-rust`) | Cloudflare Worker Replacement | Migration Action |
| :--- | :--- | :--- |
| `axum::Router` + `tokio::net::TcpListener` | `worker::Router` or `worker::event` | Replace TCP listener with Worker fetch event handler |
| `sqlx::SqlitePool` (C libsqlite3) | `worker::d1::D1Database` (or D1 HTTP API) | Abstract repository traits to query Cloudflare D1 |
| `std::fs` / `tokio::fs` | `worker::r2::Bucket` (or R2 REST API) | Replace disk paths with R2 keys and Range requests |
| `rquickjs` (C QuickJS engine) | Native V8 via `js-sys` or Worker JS bridge | Eliminate C-compiler dependency; execute JS directly in V8 |
| `reqwest` (native socket client) | `worker::Fetch` | Route outbound requests via Cloudflare subrequests |
| Thread pools (`tokio::spawn`) | Single-threaded WASM async | Use single-threaded cooperative futures; offload batch jobs to Queues |

---

## 2. Eliminating Incompatible C Dependencies

### A. Replacing `rquickjs` with Native V8 Execution
In a Cloudflare Worker, the runtime is ALREADY V8! Running QuickJS (C code) inside WASM is redundant and causes link-time failures.
- **Pattern**: Expose a JS function or use `js-sys::eval` / `wasm-bindgen` to evaluate book source rules:
  ```rust
  // In wasm32 Cloudflare Worker:
  use wasm_bindgen::prelude::*;
  
  pub fn eval_js_rule(script: &str, context_json: &str) -> Result<String, JsValue> {
      let code = format!("((context) => {{ {} }})({})", script, context_json);
      let res = js_sys::eval(&code)?;
      Ok(res.as_string().unwrap_or_default())
  }
  ```

### B. Decoupling Database Access from `sqlx`
Instead of hardcoding `sqlx::SqlitePool` into services, define a `DatabaseDriver` trait:
```rust
#[async_trait::async_trait(?Send)]
pub trait DatabaseDriver {
    async fn query_all(&self, sql: &str, params: &[serde_json::Value]) -> anyhow::Result<Vec<serde_json::Value>>;
    async fn execute(&self, sql: &str, params: &[serde_json::Value]) -> anyhow::Result<u64>;
}

// 1. Native / Local implementation: sqlx::SqlitePool
// 2. Cloudflare Worker implementation: worker::d1::D1Database
// 3. Remote HTTP implementation: crate::storage::db::d1::D1Client
```

### C. Replacing File I/O with R2 Streaming
Never call `std::fs` or `tokio::fs`. For any file storage (EPUB, PDF, MOBI, uploaded assets):
1. Store file in R2 with key format: `{type}/{user_ns}/{book_id}.{ext}`.
2. For reading: issue HTTP `Range` requests to read only the needed chunk (64KB for index, 2~4KB for chapter).
3. For serving to client: return `206 Partial Content` with `Accept-Ranges: bytes` and `Content-Range`.

---

## 3. Handling Cloudflare Free Tier Constraints

1. **10ms CPU Execution Limit**:
   - Avoid batch-searching 100+ book sources in a single HTTP turn.
   - Restrict multi-source search to 10~20 sources per batch or drive search iteratively from the frontend.
   - For heavy background processing (like EPUB unzipping), use Cloudflare Queues with a 15-second time budget checkpointing pattern.
2. **50 Subrequests Limit per Request**:
   - Limit concurrent outgoing `fetch` calls in `search_book_multi` using a Semaphore.
3. **Kitesurf Dynamic Rendering**:
   - Use Kitesurf for JavaScript-heavy book sources.
   - Monitor for HTTP 429 (`Browser time limit exceeded for today`).
   - On 429, immediately trigger a cooldown until next UTC midnight and fallback to `REMOTE_WEBVIEW_API`.

---

## 4. Compilation & Deployment Checklist

1. Configure `Cargo.toml`:
   ```toml
   [lib]
   crate-type = ["cdylib", "rlib"]
   ```
2. Build command:
   ```bash
   worker-build --release # Or wrangler deploy
   ```
3. Initialize D1 schema:
   ```bash
   npx wrangler d1 execute reader-db --file=migrations/d1_schema.sql
   ```
4. Set worker secrets:
   ```bash
   npx wrangler secret put CF_ACCOUNT_ID
   npx wrangler secret put CF_API_TOKEN
   npx wrangler secret put SECURE_KEY
   ```
