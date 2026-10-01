/**
 * AUTO-GENERATED AT BUILD TIME FROM .env.example
 * Injects default environment variables into the Cloudflare Worker bundle.
 * Runtime variables and Cloudflare Dashboard Secrets will automatically override these.
 */

export const ENV_DEFAULTS: Record<string, string> = {
  "SERVER_HOST": "0.0.0.0",
  "SERVER_PORT": "8080",
  "DATABASE_URL": "sqlite:storage/reader.db?mode=rwc",
  "STORAGE_DIR": "storage",
  "ASSETS_DIR": "storage/assets",
  "WEB_ROOT": "frontend/dist",
  "LOG_LEVEL": "info",
  "REQUEST_TIMEOUT_SECS": "15",
  "SECURE": "true",
  "SECURE_KEY": "",
  "INVITE_CODE": "",
  "USER_LIMIT": "50",
  "USER_BOOK_LIMIT": "2000",
  "USER_LOCAL_BOOK_LIMIT": "0",
  "CF_ACCOUNT_ID": "",
  "CF_API_TOKEN": "",
  "CF_KITESURF_ENDPOINT": "",
  "CF_KITESURF_ENABLED": "true",
  "REMOTE_WEBVIEW_API": "",
  "REMOTE_WEBVIEW_API_KEY": "",
  "R2_BUCKET_NAME": "reader-storage",
  "STORAGE_BACKEND": "r2",
  "DATABASE_BACKEND": "d1"
};
