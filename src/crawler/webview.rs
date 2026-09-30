use crate::crawler::fetcher::{FetchResponse, HttpMethod, RequestSpec};
use chrono::{Datelike, Timelike, Utc};
use serde_json::json;
use std::collections::HashMap;
use std::sync::{Arc, RwLock};
use std::time::{Duration, Instant};

#[derive(Debug, Clone, Default)]
pub struct WebViewConfig {
    pub cf_account_id: Option<String>,
    pub cf_api_token: Option<String>,
    pub cf_kitesurf_endpoint: Option<String>,
    pub cf_kitesurf_enabled: bool,
    pub remote_webview_api: Option<String>,
    pub remote_webview_api_key: Option<String>,
}

impl WebViewConfig {
    pub fn has_kitesurf(&self) -> bool {
        if !self.cf_kitesurf_enabled {
            return false;
        }
        if self
            .cf_kitesurf_endpoint
            .as_deref()
            .map(|s| !s.trim().is_empty())
            .unwrap_or(false)
        {
            return true;
        }
        let has_account = self
            .cf_account_id
            .as_deref()
            .map(|s| !s.trim().is_empty())
            .unwrap_or(false);
        let has_token = self
            .cf_api_token
            .as_deref()
            .map(|s| !s.trim().is_empty())
            .unwrap_or(false);
        has_account && has_token
    }

    pub fn has_remote_webview(&self) -> bool {
        self.remote_webview_api
            .as_deref()
            .map(|s| !s.trim().is_empty())
            .unwrap_or(false)
    }
}

pub struct KitesurfCooldownTracker {
    cooldown_until: RwLock<Option<Instant>>,
    cooldown_utc_day: RwLock<Option<u32>>,
}

impl KitesurfCooldownTracker {
    pub fn new() -> Self {
        Self {
            cooldown_until: RwLock::new(None),
            cooldown_utc_day: RwLock::new(None),
        }
    }

    /// Check if Kitesurf is currently in a cooldown period
    pub fn is_in_cooldown(&self) -> bool {
        let current_day = Utc::now().day();
        // If the UTC date has advanced past the day cooldown was triggered,
        // Cloudflare's daily browser limit has reset -> clear cooldown automatically
        if let Ok(day_guard) = self.cooldown_utc_day.read() {
            if let Some(recorded_day) = *day_guard {
                if current_day != recorded_day {
                    drop(day_guard);
                    if let Ok(mut day_mut) = self.cooldown_utc_day.write() {
                        *day_mut = None;
                    }
                    if let Ok(mut until_mut) = self.cooldown_until.write() {
                        *until_mut = None;
                    }
                    return false;
                }
            }
        }

        if let Ok(guard) = self.cooldown_until.read() {
            if let Some(until) = *guard {
                if Instant::now() < until {
                    return true;
                }
            }
        }

        false
    }

    /// When Kitesurf responds with 429 Too Many Requests / Browser time limit exceeded,
    /// immediately enters cooldown until the next UTC day (when Cloudflare resets limits).
    pub fn trigger_cooldown(&self, custom_duration: Option<Duration>) {
        let now_utc = Utc::now();
        let duration = custom_duration.unwrap_or_else(|| {
            // Cloudflare resets Browser Run daily limits at UTC 00:00:00
            let seconds_left_today = 86400 - (now_utc.num_seconds_from_midnight() as u64);
            Duration::from_secs(seconds_left_today.max(300))
        });

        if let Ok(mut until_lock) = self.cooldown_until.write() {
            *until_lock = Some(Instant::now() + duration);
        }
        if let Ok(mut day_lock) = self.cooldown_utc_day.write() {
            *day_lock = Some(now_utc.day());
        }
    }

    pub fn clear_cooldown(&self) {
        if let Ok(mut until_lock) = self.cooldown_until.write() {
            *until_lock = None;
        }
        if let Ok(mut day_lock) = self.cooldown_utc_day.write() {
            *day_lock = None;
        }
    }
}

#[derive(Clone)]
pub struct WebViewDispatcher {
    config: WebViewConfig,
    tracker: Arc<KitesurfCooldownTracker>,
}

impl WebViewDispatcher {
    pub fn new(config: WebViewConfig) -> Self {
        Self {
            config,
            tracker: Arc::new(KitesurfCooldownTracker::new()),
        }
    }

    pub fn tracker(&self) -> &KitesurfCooldownTracker {
        &self.tracker
    }

    pub async fn render_webview(
        &self,
        client: &reqwest::Client,
        req: &RequestSpec,
    ) -> anyhow::Result<FetchResponse> {
        // Step 1: If Kitesurf is enabled and not in cooldown, invoke Kitesurf
        if self.config.has_kitesurf() && !self.tracker.is_in_cooldown() {
            match self.fetch_via_kitesurf(client, req).await {
                Ok(res) => {
                    return Ok(res);
                }
                Err(e) => {
                    let err_str = e.to_string();
                    if err_str.contains("429") || err_str.contains("Browser time limit") {
                        tracing::warn!(
                            "Kitesurf 免费时长用尽 (429)，直接进入冷却时间直至次日 UTC 重置，请求转入远方 API: {}",
                            e
                        );
                        self.tracker.trigger_cooldown(None);
                    } else {
                        tracing::warn!("Kitesurf 调用异常，尝试转入远方 API: {}", e);
                    }
                    // Current request immediately falls through to Step 2 (remote_webview_api)
                }
            }
        } else if self.config.has_kitesurf() {
            tracing::debug!("Kitesurf 正处于限流冷却期中，请求直接转发至远方 API: {}", req.url);
        }

        // Step 2: In cooldown or after Kitesurf failure, request goes directly to remote WebView API
        if self.config.has_remote_webview() {
            match self.fetch_via_remote_webview(client, req).await {
                Ok(res) => {
                    return Ok(res);
                }
                Err(e) => {
                    tracing::warn!("远方 Remote WebView API 渲染失败: {}", e);
                }
            }
        }

        anyhow::bail!("所有 WebView 渲染通道均不可用或调用失败")
    }

    async fn fetch_via_kitesurf(
        &self,
        client: &reqwest::Client,
        req: &RequestSpec,
    ) -> anyhow::Result<FetchResponse> {
        let endpoint = if let Some(ref ep) = self.config.cf_kitesurf_endpoint {
            ep.clone()
        } else if let Some(ref account_id) = self.config.cf_account_id {
            format!(
                "https://api.cloudflare.com/client/v4/accounts/{}/browser-run/content?browser=kitesurf",
                account_id.trim()
            )
        } else {
            anyhow::bail!("缺少 Cloudflare Account ID，无法调用 Kitesurf API");
        };

        let body = json!({
            "url": req.url,
            "rejectResourceTypes": ["image", "media", "font"],
            "gotoOptions": {
                "waitUntil": "networkidle2"
            }
        });

        let mut builder = client
            .post(&endpoint)
            .header("Content-Type", "application/json");

        // When running under the same account's worker binding, token is not needed.
        // If provided, attach Bearer token.
        if let Some(ref api_token) = self.config.cf_api_token {
            if !api_token.trim().is_empty() {
                builder = builder.header("Authorization", format!("Bearer {}", api_token.trim()));
            }
        }

        let resp = builder.json(&body).send().await?;

        let status = resp.status().as_u16();
        if !resp.status().is_success() {
            let err_text = resp.text().await.unwrap_or_default();
            anyhow::bail!("Kitesurf HTTP error {}: {}", status, err_text);
        }

        let html = resp.text().await?;
        Ok(FetchResponse {
            url: req.url.clone(),
            status: 200,
            body: html,
            content_type: Some("text/html; charset=utf-8".to_string()),
            headers: vec![("content-type".to_string(), "text/html".to_string())],
            is_successful: true,
        })
    }

    async fn fetch_via_remote_webview(
        &self,
        client: &reqwest::Client,
        req: &RequestSpec,
    ) -> anyhow::Result<FetchResponse> {
        let base_api = self
            .config
            .remote_webview_api
            .as_deref()
            .unwrap_or_default()
            .trim_end_matches('/');

        let endpoint = if base_api.ends_with(".html") || base_api.ends_with("/render") {
            base_api.to_string()
        } else {
            format!("{}/render.html", base_api)
        };

        let mut header_map = HashMap::new();
        for (k, v) in &req.headers {
            header_map.insert(k.clone(), v.clone());
        }

        let payload = json!({
            "url": req.url,
            "html": serde_json::Value::Null,
            "headers": header_map,
            "js_source": req.web_js,
            "proxy": req.proxy,
            "http_method": if matches!(req.method, HttpMethod::POST) { "POST" } else { "GET" },
            "body": req.body,
            "encode": req.charset,
            "tag": serde_json::Value::Null,
            "sourceRegex": serde_json::Value::Null
        });

        let mut builder = client
            .post(&endpoint)
            .header("Content-Type", "application/json");

        if let Some(ref key) = self.config.remote_webview_api_key {
            if !key.trim().is_empty() {
                builder = builder.header("Authorization", format!("Bearer {}", key.trim()));
            }
        }

        let resp = builder.json(&payload).send().await?;
        let status = resp.status().as_u16();
        if !resp.status().is_success() {
            let err_text = resp.text().await.unwrap_or_default();
            anyhow::bail!("Remote WebView HTTP error {}: {}", status, err_text);
        }

        let headers = resp
            .headers()
            .iter()
            .filter_map(|(name, value)| {
                value
                    .to_str()
                    .ok()
                    .map(|v| (name.to_string(), v.to_string()))
            })
            .collect::<Vec<_>>();

        let body = resp.text().await?;
        Ok(FetchResponse {
            url: req.url.clone(),
            status,
            body,
            content_type: Some("text/html; charset=utf-8".to_string()),
            headers,
            is_successful: true,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_webview_config_checks() {
        // Missing account_id or api_token
        let incomplete_cfg = WebViewConfig {
            cf_kitesurf_enabled: true,
            ..Default::default()
        };
        assert!(!incomplete_cfg.has_kitesurf());

        let valid_cfg = WebViewConfig {
            cf_account_id: Some("acc123".to_string()),
            cf_api_token: Some("tok456".to_string()),
            cf_kitesurf_enabled: true,
            ..Default::default()
        };
        assert!(valid_cfg.has_kitesurf());

        // Custom endpoint (e.g. internal proxy)
        let endpoint_cfg = WebViewConfig {
            cf_kitesurf_endpoint: Some("http://localhost:8787/browser-run".to_string()),
            cf_kitesurf_enabled: true,
            ..Default::default()
        };
        assert!(endpoint_cfg.has_kitesurf());

        let disabled_cfg = WebViewConfig {
            cf_kitesurf_enabled: false,
            ..valid_cfg.clone()
        };
        assert!(!disabled_cfg.has_kitesurf());
    }

    #[test]
    fn test_cooldown_tracker() {
        let tracker = KitesurfCooldownTracker::new();
        assert!(!tracker.is_in_cooldown());

        // Trigger cooldown
        tracker.trigger_cooldown(Some(Duration::from_secs(300)));
        assert!(tracker.is_in_cooldown());

        // Clear cooldown
        tracker.clear_cooldown();
        assert!(!tracker.is_in_cooldown());
    }
}
