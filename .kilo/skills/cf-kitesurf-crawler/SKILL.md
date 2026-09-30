---
name: cf-kitesurf-crawler
description: Best practices for implementing book source crawling, rate limiting, and dynamic webView rendering on Cloudflare Workers using Kitesurf and Remote WebView fallback.
---

# Skill: Cloudflare Kitesurf & Crawler Adaptation

This skill provides patterns for executing book source crawling, rule evaluations, and dynamic browser rendering within Cloudflare Workers edge constraints.

## 1. Cloudflare Free Limits for Crawlers

- **Subrequest Limit**: A single Worker request can make at most **50 subrequests** (`fetch()` calls).
- **CPU Time Limit**: 10 milliseconds of active CPU execution. Waiting on `fetch()` network I/O does NOT consume this CPU budget.
- **Concurrent Execution**: Multi-source searches must be bounded by a concurrency semaphore (`Semaphore::new(10)`) or driven iteratively from the client to prevent hitting subrequest limits.

## 2. Kitesurf Dynamic Rendering Protocol

Cloudflare Kitesurf is a lightweight, stateless browser designed for HTML extraction:

### Endpoint Specification
- **Method**: `POST`
- **URL**: `https://api.cloudflare.com/client/v4/accounts/<ACCOUNT_ID>/browser-run/content?browser=kitesurf`
- **Headers**:
  - `Authorization: Bearer <API_TOKEN>` (token requires `Browser Rendering - Edit` permission)
  - `Content-Type: application/json`
- **Body**:
  ```json
  {
    "url": "https://example.com/chapter.html",
    "rejectResourceTypes": ["image", "media", "font"],
    "gotoOptions": {
      "waitUntil": "networkidle2"
    }
  }
  ```

## 3. Cooldown & Failover Strategy

When Kitesurf returns `429 Too Many Requests` or `Browser time limit exceeded for today`:
1. Do not retry Kitesurf immediately.
2. Mark Kitesurf as cooled down until the next UTC day (`00:00:00 UTC`), when Cloudflare resets daily limits.
3. Automatically route the current failed request and all subsequent requests during the cooldown period to `REMOTE_WEBVIEW_API` (self-hosted Puppeteer / VPS node).
