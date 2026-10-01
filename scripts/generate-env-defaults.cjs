const fs = require('fs');
const path = require('path');

function generateEnvDefaults() {
  const envPath = path.join(__dirname, '..', '.env.example');
  const outputPath = path.join(__dirname, '..', 'worker', 'env-defaults.ts');

  if (!fs.existsSync(envPath)) return;

  const envContent = fs.readFileSync(envPath, 'utf8');
  const defaults = {};

  for (const line of envContent.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx !== -1) {
      const key = trimmed.substring(0, eqIdx).trim();
      const val = trimmed.substring(eqIdx + 1).trim();
      defaults[key] = val;
    }
  }

  // Ensure default storage backends are present
  if (!defaults.STORAGE_BACKEND) defaults.STORAGE_BACKEND = 'r2';
  if (!defaults.DATABASE_BACKEND) defaults.DATABASE_BACKEND = 'd1';
  if (!defaults.D1_DATABASE_ID) defaults.D1_DATABASE_ID = 'reader-db';

  const fileContent = `/**
 * AUTO-GENERATED AT BUILD TIME FROM .env.example
 * Injects default environment variables into the Cloudflare Worker bundle.
 * Runtime variables and Cloudflare Dashboard Secrets will automatically override these.
 */

export const ENV_DEFAULTS: Record<string, string> = ${JSON.stringify(defaults, null, 2)};
`;

  fs.writeFileSync(outputPath, fileContent, 'utf8');
  console.log(`[Build] 成功在构建阶段将 .env.example 的 ${Object.keys(defaults).length} 项默认参数注入至 worker/env-defaults.ts`);
}

generateEnvDefaults();
