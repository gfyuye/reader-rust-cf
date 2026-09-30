# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

### Cloudflare Serverless Deployment
```bash
npm run deploy               # Automated resource creation and deployment
npm --prefix frontend run build  # Build frontend static assets to frontend/dist/
npx wrangler dev             # Local Cloudflare Worker & D1 simulation
```

### Rust Backend
```bash
cargo run                    # Dev mode
cargo build --release        # Release build
cargo test                   # All tests
```

### Web Frontend (Vue 3)
```bash
cd frontend
npm install                  # Install dependencies
npm run dev                  # Development server
npm run build                # Production build to frontend/dist/
```

## Architecture

Cloudflare Pages & Workers Serverless implementation of "阅读3.0" (Legado) reading service, with dual native Rust runtime support.

- `functions/[[path]].ts` — Cloudflare Pages Functions gateway
- `worker/index.ts` — Serverless edge API, D1 database queries, R2 range streaming, Queues consumer
- `migrations/d1_schema.sql` — Canonical Cloudflare D1 schema (17 tables)
- `wrangler.toml` — Cloudflare bindings (D1, R2, Queues, Workers AI, Crons)
- `frontend/` — Vue 3 + Vite + TypeScript frontend
- `src/` — Native Rust backend
