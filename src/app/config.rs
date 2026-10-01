use serde::Deserialize;

#[derive(Debug, Clone, Deserialize)]
pub struct AppConfig {
    pub server_host: String,
    pub server_port: u16,
    pub database_url: String,
    pub storage_dir: String,
    pub web_root: String,
    pub assets_dir: String,
    pub log_level: String,
    pub request_timeout_secs: u64,
    pub secure: bool,
    pub secure_key: String,
    pub invite_code: String,
    pub user_limit: u32,
    pub user_book_limit: u32,
    pub user_local_book_limit: u32,
    #[serde(default)]
    pub cf_account_id: Option<String>,
    #[serde(default)]
    pub cf_api_token: Option<String>,
    #[serde(default)]
    pub cf_kitesurf_endpoint: Option<String>,
    #[serde(default = "default_true")]
    pub cf_kitesurf_enabled: bool,
    #[serde(default)]
    pub r2_bucket_name: Option<String>,
    #[serde(default)]
    pub remote_webview_api: Option<String>,
    #[serde(default)]
    pub remote_webview_api_key: Option<String>,
}

fn default_true() -> bool {
    true
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            server_host: "0.0.0.0".to_string(),
            server_port: 8080,
            database_url: "sqlite:storage/reader.db?mode=rwc".to_string(),
            storage_dir: "storage".to_string(),
            web_root: "frontend/dist".to_string(),
            assets_dir: "storage/assets".to_string(),
            log_level: "info".to_string(),
            request_timeout_secs: 15,
            secure: false,
            secure_key: "".to_string(),
            invite_code: "".to_string(),
            user_limit: 50,
            user_book_limit: 2000,
            user_local_book_limit: 0,
            cf_account_id: None,
            cf_api_token: None,
            cf_kitesurf_endpoint: None,
            cf_kitesurf_enabled: true,
            r2_bucket_name: None,
            remote_webview_api: None,
            remote_webview_api_key: None,
        }
    }
}

pub fn load() -> anyhow::Result<AppConfig> {
    dotenvy::dotenv().ok();
    let defaults = AppConfig::default();
    let cfg = config::Config::builder()
        .set_default("server_host", defaults.server_host)?
        .set_default("server_port", defaults.server_port as i64)?
        .set_default("database_url", defaults.database_url)?
        .set_default("storage_dir", defaults.storage_dir)?
        .set_default("web_root", defaults.web_root)?
        .set_default("assets_dir", defaults.assets_dir)?
        .set_default("log_level", defaults.log_level)?
        .set_default("request_timeout_secs", defaults.request_timeout_secs as i64)?
        .set_default("secure", defaults.secure)?
        .set_default("secure_key", defaults.secure_key)?
        .set_default("invite_code", defaults.invite_code)?
        .set_default("user_limit", defaults.user_limit as i64)?
        .set_default("user_book_limit", defaults.user_book_limit as i64)?
        .set_default(
            "user_local_book_limit",
            defaults.user_local_book_limit as i64,
        )?
        .set_default("cf_account_id", None::<String>)?
        .set_default("cf_api_token", None::<String>)?
        .set_default("cf_kitesurf_endpoint", None::<String>)?
        .set_default("cf_kitesurf_enabled", true)?
        .set_default("d1_database_id", None::<String>)?
        .set_default("r2_bucket_name", None::<String>)?
        .set_default("remote_webview_api", None::<String>)?
        .set_default("remote_webview_api_key", None::<String>)?
        .add_source(config::Environment::default().try_parsing(true))
        .build()?;
    Ok(cfg.try_deserialize()?)
}
