---
name: cf-d1-r2-adapter
description: Best practices and code patterns for integrating Cloudflare D1 (Serverless SQLite) and Cloudflare R2 (Object Storage) into Rust and TypeScript services, with emphasis on Range streaming and batch optimization.
---

# Skill: Cloudflare D1 & R2 Adaptation

This skill provides operational patterns, SQL schema guidelines, and streaming implementations for Cloudflare D1 and Cloudflare R2 in `reader-rust`.

## 1. Cloudflare D1 (Serverless SQLite) Guide

### Key D1 Constraints & Characteristics
- **Engine**: SQLite 3.x compatible.
- **Transactions**: Limited support for interactive multi-statement transactions over REST; prefer batch statements using `db.batch([stmt1, stmt2, ...])`.
- **Parameter Placeholders**: Use positional placeholders `?1`, `?2`, etc.
- **Timezone**: Dates should always be stored as integer Unix timestamps (`now_ts()` in seconds or milliseconds).

### Schema Management
- Schema file is at `migrations/d1_schema.sql`.
- Apply migrations:
  ```bash
  npx wrangler d1 execute <DATABASE_NAME> --file=migrations/d1_schema.sql
  ```
- Use `INSERT ... ON CONFLICT(...) DO UPDATE SET ...` for atomic upserts without read-before-write latency.

---

## 2. Cloudflare R2 (Object Storage & Range Streaming) Guide

### Naming Conventions in R2
- Uploaded assets: `assets/{user_ns}/{file_type}/{file_name}`
- EPUB archives: `epubs/{user_ns}/{book_id}.epub`
- PDF documents: `pdfs/{user_ns}/{book_id}.pdf`
- MOBI books: `mobis/{user_ns}/{book_id}.mobi`
- Chapter text cache: `cache/{user_ns}/{book_url_hash}/{chapter_url_hash}`

### HTTP Range Streaming (206 Partial Content) Protocol
When streaming PDF pages or EPUB/MOBI slices to browser clients, the endpoint MUST implement the standard HTTP 206 protocol:

1. **Parse Incoming Range Header**:
   ```typescript
   const rangeHeader = request.headers.get("Range"); // e.g. "bytes=0-65535" or "bytes=1000-"
   ```
2. **Execute R2 Range Fetch**:
   ```typescript
   const object = await env.BUCKET.get(key, { range: { offset, length } });
   ```
3. **Return Required 206 Headers**:
   ```typescript
   const headers = new Headers();
   headers.set("Content-Type", contentType);
   headers.set("Accept-Ranges", "bytes");
   headers.set("Content-Range", `bytes ${offset}-${offset + length - 1}/${fileSize}`);
   headers.set("Content-Length", length.toString());
   
   // Crucial for cross-origin PDF.js and Canvas rendering:
   headers.set("Access-Control-Allow-Origin", "*");
   headers.set("Access-Control-Expose-Headers", "Accept-Ranges, Content-Range, Content-Length");
   
   return new Response(object.body, { status: 206, headers });
   ```

---

## 3. Format-Specific Streaming Recipes

### EPUB (Zero-Download Central Directory)
- Read last 64KB (`Range: bytes=-65536`) to locate ZIP EOCD and Central Directory records.
- Index each chapter's `byte_offset`, `byte_length`, and `compression_method` into D1 `epub_chapters`.
- User reads Chapter N: fetch only `[byte_offset, byte_offset + byte_length - 1]` from R2.

### PDF (Mozilla PDF.js Range-On-Demand)
- Index `/Count` total pages and trailer into D1 `pdf_books`.
- Provide `/reader3/pdf/stream?bookId={id}` supporting standard 206 Range requests.
- Front-end PDF.js with `disableAutoFetch: true` automatically issues Range requests per page viewport.

### MOBI (PalmDOC Micro-Record Slices)
- Read first 16KB (`Range: bytes=0-16383`) to locate PDB Record Offset Table and PalmDOC header.
- Index each Record offset into D1 `mobi_chapters`.
- User reads Chapter N: fetch single 2KB~4KB record slice, execute lightweight PalmDOC LZ77 decompression in ~0.1ms, return HTML.
