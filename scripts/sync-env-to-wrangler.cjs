const fs = require('fs');
const path = require('path');

function syncEnvToWrangler() {
  const envPath = path.join(__dirname, '..', '.env.example');
  const wranglerPath = path.join(__dirname, '..', 'wrangler.toml');

  if (!fs.existsSync(envPath) || !fs.existsSync(wranglerPath)) return;

  const envContent = fs.readFileSync(envPath, 'utf8');
  let wranglerContent = fs.readFileSync(wranglerPath, 'utf8');

  const vars = [];
  for (const line of envContent.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx !== -1) {
      const key = trimmed.substring(0, eqIdx).trim();
      const val = trimmed.substring(eqIdx + 1).trim();
      vars.push(`${key} = "${val}"`);
    }
  }

  // Ensure default storage and database backends are included
  if (!vars.some((v) => v.startsWith('STORAGE_BACKEND'))) {
    vars.push('STORAGE_BACKEND = "r2"');
  }
  if (!vars.some((v) => v.startsWith('DATABASE_BACKEND'))) {
    vars.push('DATABASE_BACKEND = "d1"');
  }

  const varsHeader = '# 环境变量字典 (自动从 .env.example 同步)\n[vars]\n';
  const varsSection = varsHeader + vars.join('\n') + '\n';

  if (wranglerContent.includes('[vars]')) {
    const parts = wranglerContent.split(/#.*环境变量[\s\S]*|\[vars\][\s\S]*/);
    wranglerContent = parts[0].trimEnd() + '\n\n' + varsSection;
  } else {
    wranglerContent = wranglerContent.trimEnd() + '\n\n' + varsSection;
  }

  fs.writeFileSync(wranglerPath, wranglerContent, 'utf8');
  console.log(`[Wrangler] 成功将 .env.example 的 ${vars.length} 项环境变量同步至 wrangler.toml [vars]`);
}

syncEnvToWrangler();
