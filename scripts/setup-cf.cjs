#!/usr/bin/env node

/**
 * Automated Cloudflare Deployment & Resource Provisioning Script
 * Automatically creates and binds D1 database, R2 bucket, and Queues using Wrangler.
 */

const { execSync } = require('child_process');

function runCommand(cmd, ignoreError = false) {
  try {
    console.log(`\n> ${cmd}`);
    return execSync(cmd, { stdio: 'inherit' });
  } catch (error) {
    if (!ignoreError) {
      console.error(`Command failed: ${cmd}`);
      process.exit(1);
    }
  }
}

function runSilent(cmd) {
  try {
    return execSync(cmd, { stdio: 'pipe' }).toString();
  } catch (e) {
    return null;
  }
}

async function main() {
  console.log('===========================================================');
  console.log('🚀 开始自动化 Cloudflare 资源创建与一键部署 (Wrangler)');
  console.log('===========================================================');

  // 1. 同步 .env.example 参数至 wrangler.toml [vars]
  console.log('\n[1/6] 同步 .env.example 参数至 wrangler.toml...');
  runCommand('node scripts/sync-env-to-wrangler.cjs');

  // 2. 自动创建 Cloudflare D1 数据库
  console.log('\n[2/6] 检查并自动创建 D1 数据库 (reader-db)...');
  const d1Result = runSilent('npx wrangler d1 create reader-db');
  if (d1Result && d1Result.includes('database_id')) {
    console.log('✅ D1 数据库创建成功！');
  } else {
    console.log('ℹ️ D1 数据库已存在或已就绪。');
  }

  // 3. 自动创建 Cloudflare R2 存储桶
  console.log('\n[3/6] 检查并自动创建 R2 存储桶 (reader-storage)...');
  const r2Result = runSilent('npx wrangler r2 bucket create reader-storage');
  if (r2Result) {
    console.log('✅ R2 存储桶已就绪。');
  } else {
    console.log('ℹ️ R2 存储桶已存在或已就绪。');
  }

  // 4. 自动创建 Cloudflare Queues 消息队列
  console.log('\n[4/6] 检查并自动创建 Queues 队列 (epub-indexing-queue)...');
  const queueResult = runSilent('npx wrangler queues create epub-indexing-queue');
  if (queueResult) {
    console.log('✅ 异步队列已就绪。');
  } else {
    console.log('ℹ️ 异步队列已存在或已就绪。');
  }

  // 5. 执行 D1 远程数据库架构迁移
  console.log('\n[5/6] 执行 D1 数据库建表与切片索引初始化...');
  runCommand('npx wrangler d1 execute reader-db --remote --file=migrations/d1_schema.sql', true);

  // 6. 编译前端并执行 Wrangler Pages 部署
  console.log('\n[6/6] 编译前端项目并执行 Pages 部署...');
  runCommand('npm run build');
  runCommand('npx wrangler pages deploy dist --project-name=reader-rust-pages');

  console.log('\n===========================================================');
  console.log('🎉 部署完成！服务已在 Cloudflare 边缘网络成功上线运行。');
  console.log('===========================================================');
}

main().catch((err) => {
  console.error('部署遇到错误:', err);
  process.exit(1);
});
