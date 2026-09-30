# AGENTS.md

This file provides guidance to AI coding agents when working with code in this repository.

## Commands

### Cloudflare Deployment
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
cargo test --lib <test_name> # Single test
```

### Frontend
```bash
cd frontend && npm install && npm run dev    # Dev server
cd frontend && npm run build                 # Builds to frontend/dist/
```

## Architecture

Cloudflare Pages & Workers Serverless implementation of "阅读3.0" (Legado) reading service, with dual native Rust runtime support.

### Cloudflare Serverless Module Structure
- `functions/[[path]].ts` — Cloudflare Pages Functions gateway
- `worker/index.ts` — Edge API handlers, D1 database queries, R2 range streaming, Queues consumer
- `migrations/d1_schema.sql` — Canonical Cloudflare D1 schema (17 tables)
- `wrangler.toml` — Cloudflare resources, D1, R2, Queues, Workers AI, and Crons binding
- `frontend/` — Vue 3 + Vite + TypeScript frontend (dist goes to Pages static hosting)

### Native Rust Module Structure
- `src/api/` — HTTP handlers & routing (axum), routes under `/reader3/*`
- `src/service/` — Business logic (book search, sources, users, streaming services)
- `src/crawler/` — HTTP fetching via reqwest & Kitesurf browser rendering
- `src/parser/` — Content extraction engine with rule-based parsing
- `src/storage/` — SQLite/D1 client, R2 client, and caching
- `src/model/` — Data structures (BookSource, Book, SearchBook, Rule)
