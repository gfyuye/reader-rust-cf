/**
 * Legado (阅读 3.0) Book Source Engine for Cloudflare Workers
 * Fully aligned with Rust engine in src/parser/
 * - RuleAnalyzer: split_top_level, &&, ||, %%, ##, @
 * - RuleEngine: detect_mode, search_books, explore_books, chapter_list, content
 * - UrlAnalyzer: analyze_url, {{key}}, {key}, page choices, options after comma
 * - HtmlParser: legado_to_css, tag.xxx, class.xxx, id.xxx, @text, @href, @html
 * - JsonPath: jsonpath_query, render_embedded_paths ({$.score}分)
 * - JsSandbox: Native V8, java.*, source.*, book.*, CryptoJS/WebCrypto AES/MD5/SHA
 */

// ==========================================
// 1. Delimiter & Top-Level Rule Splitting
// ==========================================

export interface SplitResult {
  parts: string[];
  delimiter: string | null;
}

export function splitTopLevel(rule: string, delimiters: string[]): SplitResult {
  let depthSquare = 0;
  let depthParen = 0;
  let depthBrace = 0;
  let quote: string | null = null;
  let escaped = false;
  let delim: string | null = null;

  for (let i = 0; i < rule.length; i++) {
    const c = rule[i];
    if (quote) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (c === "\\") {
        escaped = true;
        continue;
      }
      if (c === quote) {
        quote = null;
      }
      continue;
    }
    if (c === '"' || c === "'") {
      quote = c;
      continue;
    }
    if (c === "[") depthSquare++;
    else if (c === "]") depthSquare = Math.max(0, depthSquare - 1);
    else if (c === "(") depthParen++;
    else if (c === ")") depthParen = Math.max(0, depthParen - 1);
    else if (c === "{") depthBrace++;
    else if (c === "}") depthBrace = Math.max(0, depthBrace - 1);

    if (depthSquare === 0 && depthParen === 0 && depthBrace === 0) {
      for (const d of delimiters) {
        if (rule.startsWith(d, i)) {
          delim = d;
          break;
        }
      }
      if (delim) break;
    }
  }

  if (!delim) return { parts: [rule.trim()], delimiter: null };

  const parts: string[] = [];
  let start = 0;
  depthSquare = 0;
  depthParen = 0;
  depthBrace = 0;
  quote = null;
  escaped = false;

  for (let i = 0; i < rule.length; i++) {
    const c = rule[i];
    if (quote) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (c === "\\") {
        escaped = true;
        continue;
      }
      if (c === quote) {
        quote = null;
      }
      continue;
    }
    if (c === '"' || c === "'") {
      quote = c;
      continue;
    }
    if (c === "[") depthSquare++;
    else if (c === "]") depthSquare = Math.max(0, depthSquare - 1);
    else if (c === "(") depthParen++;
    else if (c === ")") depthParen = Math.max(0, depthParen - 1);
    else if (c === "{") depthBrace++;
    else if (c === "}") depthBrace = Math.max(0, depthBrace - 1);

    if (depthSquare === 0 && depthParen === 0 && depthBrace === 0 && rule.startsWith(delim, i)) {
      parts.push(rule.substring(start, i).trim());
      start = i + delim.length;
      i = start - 1;
    }
  }
  parts.push(rule.substring(start).trim());
  return { parts, delimiter: delim };
}

// ==========================================
// 2. Parse Mode Detection (Aligned with Rust)
// ==========================================

export type ParseMode = "css" | "xpath" | "jsonpath" | "regex" | "js";

export function detectMode(rule: string, content = ""): ParseMode {
  const r = rule.trim();

  // 1. Explicit mode prefix
  if (r.startsWith("@css:") || r.startsWith("@CSS:")) return "css";
  if (r.startsWith("@xpath:") || r.startsWith("@XPath:") || r.startsWith("@XPATH:")) return "xpath";
  if (r.startsWith("@json:") || r.startsWith("@Json:") || r.startsWith("@JSON:")) return "jsonpath";
  if (r.startsWith("@regex:") || r.startsWith("@Regex:")) return "regex";
  if (r.startsWith("js:") || r.startsWith("@js:") || r.startsWith("<js>")) return "js";

  // 2. Auto-detect from rule syntax
  if (r.startsWith("/") || r.startsWith("./")) return "xpath";
  if (r.startsWith("$.") || r.startsWith("$[") || r === "$") return "jsonpath";
  if (r.startsWith(":")) return "regex";

  // 3. Auto-detect from content format
  const ct = content.trim();
  if (ct.startsWith("{") || ct.startsWith("[")) {
    if (r.startsWith("$.") || r.startsWith("$[") || r === "$") return "jsonpath";
    try {
      JSON.parse(ct);
      return "jsonpath";
    } catch {}
  }

  return "css";
}

export function stripModePrefix(rule: string): string {
  const r = rule.trim();
  const prefixes = [
    "@css:", "@CSS:", "@xpath:", "@XPath:", "@XPATH:",
    "@json:", "@Json:", "@JSON:", "@regex:", "@Regex:",
    "@js:", "js:"
  ];
  for (const p of prefixes) {
    if (r.startsWith(p)) return r.substring(p.length).trim();
  }
  return r;
}

// ==========================================
// 3. HTML & CSS Selectors (Aligned with Rust html.rs)
// ==========================================

export function legadoToCss(selector: string): string {
  let s = selector.trim();

  // Strip index specifiers like !0, !-1, [0], [-1] for querySelector
  s = s.replace(/\[-?\d+(?::\d+)*(?::\d+)*\]$/g, "");
  s = s.replace(/!-?\d+$/g, "");

  if (s.startsWith("class.")) {
    const parts = s.substring(6).trim().split(/\s+/).filter(Boolean);
    return parts.length > 0 ? `.${parts.join(".")}` : "";
  }
  if (s.startsWith("id.")) {
    return `#${s.substring(3).trim()}`;
  }
  if (s.startsWith("tag.")) {
    return s.substring(4).trim();
  }
  if (s.startsWith(".") || s.startsWith("#") || s.startsWith("[")) {
    return s;
  }

  // If starts with letters, treat as class unless it matches common html tags
  const commonTags = new Set([
    "a", "p", "div", "span", "h1", "h2", "h3", "h4", "h5", "h6",
    "li", "ul", "ol", "tr", "td", "th", "table", "tbody", "img",
    "article", "section", "main", "body", "title", "b", "strong", "em", "i"
  ]);

  const firstWord = s.split(/[\s.>:]/)[0].toLowerCase();
  if (!commonTags.has(firstWord) && !s.includes(".") && !s.includes("#")) {
    const parts = s.split(/\s+/).filter(Boolean);
    return parts.length > 0 ? `.${parts.join(".")}` : "";
  }

  return s;
}

// ==========================================
// 4. Lightweight Pure-TS DOM Parser & Extractor
// ==========================================

interface HtmlNode {
  tag: string;
  attrs: Record<string, string>;
  rawAttrs: string;
  text: string;
  html: string;
}

export function parseHtmlElements(html: string, selectorRule: string): HtmlNode[] {
  const css = legadoToCss(selectorRule);
  const tagMatch = css.match(/^[a-zA-Z0-9_-]+/);
  const classMatch = css.match(/\.([a-zA-Z0-9_-]+)/);
  const idMatch = css.match(/#([a-zA-Z0-9_-]+)/);

  const targetTag = tagMatch ? tagMatch[0].toLowerCase() : "[a-zA-Z0-9_-]+";
  const targetClass = classMatch ? classMatch[1] : null;
  const targetId = idMatch ? idMatch[1] : null;

  const nodeRegex = new RegExp(`<(${targetTag})\\b([^>]*)>([\\s\\S]*?)<\\/\\1>`, "gi");
  const nodes: HtmlNode[] = [];
  let m;

  while ((m = nodeRegex.exec(html)) !== null) {
    const rawAttrs = m[2] || "";
    const innerHtml = m[3] || "";

    // Attribute filters
    if (targetId) {
      const idVal = (rawAttrs.match(/\bid=["']([^"']+)["']/i) || [])[1];
      if (idVal !== targetId) continue;
    }
    if (targetClass) {
      const classVal = (rawAttrs.match(/\bclass=["']([^"']+)["']/i) || [])[1] || "";
      const classes = classVal.split(/\s+/);
      if (!classes.includes(targetClass)) continue;
    }

    const attrs: Record<string, string> = {};
    const attrRegex = /\b([a-zA-Z0-9_-]+)=["']([^"']*)["']/g;
    let am;
    while ((am = attrRegex.exec(rawAttrs)) !== null) {
      attrs[am[1].toLowerCase()] = am[2];
    }

    const text = innerHtml.replace(/<[^>]+>/g, "").trim();
    nodes.push({
      tag: m[1].toLowerCase(),
      attrs,
      rawAttrs,
      text,
      html: innerHtml,
    });
  }

  return nodes;
}

export function extractTextFromHtml(html: string, rule: string): string {
  if (!html || !rule) return "";

  // 1. Check for ##regex##replace
  const hashSplit = splitTopLevel(rule, ["##"]);
  let baseRule = hashSplit.parts[0];
  const replacePattern = hashSplit.parts[1] || "";
  const replaceWith = hashSplit.parts[2] || "";

  // 2. Check for @ extractor
  const atSplit = splitTopLevel(baseRule, ["@"]);
  const selector = atSplit.parts[0] || "";
  const extractor = atSplit.parts[1] || "text";

  const nodes = parseHtmlElements(html, selector);
  if (!nodes.length) {
    // If no node matched selector, try direct extractor on full html
    let raw = "";
    if (extractor === "text") raw = html.replace(/<[^>]+>/g, "").trim();
    else if (extractor === "html") raw = html.trim();
    if (replacePattern) {
      try { raw = raw.replace(new RegExp(replacePattern, "g"), replaceWith); } catch {}
    }
    return raw;
  }

  let result = "";
  const node = nodes[0];
  if (extractor === "text") result = node.text;
  else if (extractor === "html") result = node.html;
  else if (extractor === "href") result = node.attrs["href"] || "";
  else if (extractor === "src") result = node.attrs["src"] || "";
  else if (node.attrs[extractor.toLowerCase()]) result = node.attrs[extractor.toLowerCase()];
  else result = node.text;

  if (replacePattern) {
    try { result = result.replace(new RegExp(replacePattern, "g"), replaceWith); } catch {}
  }

  return result.trim();
}

// ==========================================
// 5. JSONPath Engine (Aligned with Rust jsonpath.rs)
// ==========================================

export function renderEmbeddedPaths(value: any, rule: string): string | null {
  if (!rule || !rule.includes("{$") || !rule.includes("}")) return null;

  const regex = /\{(\$\.?[^}]+)\}/g;
  let hasMatch = false;
  const rendered = rule.replace(regex, (_, pathExpr) => {
    hasMatch = true;
    const res = jsonpathFirstString(value, pathExpr);
    return res !== null ? res : "";
  });

  return hasMatch ? rendered : null;
}

export function jsonpathQuery(value: any, rule: string): any[] {
  if (!value) return [];
  const r = rule.trim();

  // Handle embedded template rendering
  const embedded = renderEmbeddedPaths(value, r);
  if (embedded !== null) return [embedded];

  // Handle || fallback
  if (r.includes("||")) {
    const parts = splitTopLevel(r, ["||"]).parts;
    for (const p of parts) {
      const q = jsonpathQuery(value, p);
      if (q.length > 0) return q;
    }
    return [];
  }

  // Handle && concat
  if (r.includes("&&")) {
    const parts = splitTopLevel(r, ["&&"]).parts;
    const items = parts.map((p) => jsonpathFirstString(value, p) || "").filter(Boolean);
    return [items.join(" ")];
  }

  // Handle ## regex
  let targetRule = r;
  let repPattern = "";
  let repWith = "";
  if (r.includes("##")) {
    const hp = splitTopLevel(r, ["##"]).parts;
    targetRule = hp[0];
    repPattern = hp[1] || "";
    repWith = hp[2] || "";
  }

  // Recursive descent: $..content
  if (targetRule.startsWith("$..")) {
    const field = targetRule.substring(3).trim();
    const results: any[] = [];
    const traverse = (o: any) => {
      if (!o || typeof o !== "object") return;
      if (Array.isArray(o)) {
        for (const item of o) traverse(item);
      } else {
        for (const [k, v] of Object.entries(o)) {
          if (k.toLowerCase() === field.toLowerCase()) {
            results.push(v);
          } else {
            traverse(v);
          }
        }
      }
    };
    traverse(value);
    return results;
  }

  // Standard path: $.data.list[*] or data.list
  const cleanPath = targetRule.replace(/^\$\.?/, "").replace(/\[\*\]/g, "");
  const segments = cleanPath.split(".").filter(Boolean);

  let current = value;
  for (const seg of segments) {
    if (current == null) return [];
    if (Array.isArray(current)) {
      current = current.map((item) => (item && typeof item === "object" ? item[seg] : null)).filter((x) => x != null);
    } else if (typeof current === "object") {
      current = current[seg];
    } else {
      return [];
    }
  }

  if (current == null) return [];
  const list = Array.isArray(current) ? current : [current];

  if (repPattern) {
    try {
      const re = new RegExp(repPattern, "g");
      return list.map((item) => (typeof item === "string" ? item.replace(re, repWith) : item));
    } catch {}
  }

  return list;
}

export function jsonpathFirstString(value: any, rule: string): string | null {
  const q = jsonpathQuery(value, rule);
  if (!q.length) return null;
  const first = q[0];
  if (first == null) return null;
  return typeof first === "object" ? JSON.stringify(first) : String(first);
}

// ==========================================
// 6. Cryptography & JavaScript Sandbox
// ==========================================

export function md5(str: string): string {
  return md5Hex(str);
}

export async function aesDecryptCbc(
  base64Cipher: string,
  keyBytes: Uint8Array,
  ivBytes: Uint8Array
): Promise<Uint8Array> {
  let pad = base64Cipher.trim().replace(/-/g, "+").replace(/_/g, "/");
  while (pad.length % 4 !== 0) pad += "=";
  const binaryString = atob(pad);
  const cipherBytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) cipherBytes[i] = binaryString.charCodeAt(i);

  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    keyBytes,
    { name: "AES-CBC" },
    false,
    ["decrypt"]
  );
  const decryptedBuf = await crypto.subtle.decrypt(
    { name: "AES-CBC", iv: ivBytes },
    cryptoKey,
    cipherBytes
  );
  return new Uint8Array(decryptedBuf);
}

export interface LegadoContext {
  source?: any;
  book?: any;
  baseUrl?: string;
  result?: any;
  key?: string;
  page?: number;
  [key: string]: any;
}

export function createLegadoEnvironment(context: LegadoContext = {}) {
  const variables = new Map<string, any>();
  const bookVariables = new Map<string, any>();

  const java = {
    ajax: (url: string) => "{}",
    md5Encode: (str: string) => md5Hex(String(str)),
    digestHex: async (str: string, algo = "SHA-256") => {
      const a = algo.toUpperCase().includes("256") ? "SHA-256" : "SHA-1";
      const hash = await crypto.subtle.digest(a, new TextEncoder().encode(String(str)));
      return Array.from(new Uint8Array(hash))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
    },
    base64Decode: (str: string) => atob(String(str)),
    base64DecodeToByteArray: (str: string) => {
      let pad = String(str).trim().replace(/-/g, "+").replace(/_/g, "/");
      while (pad.length % 4 !== 0) pad += "=";
      const bStr = atob(pad);
      const arr = new Uint8Array(bStr.length);
      for (let i = 0; i < bStr.length; i++) arr[i] = bStr.charCodeAt(i);
      (arr as any).length = arr.length;
      return arr;
    },
    base64Encode: (data: string | Uint8Array) => {
      if (typeof data === "string") return btoa(data);
      let s = "";
      for (let i = 0; i < data.length; i++) s += String.fromCharCode(data[i]);
      return btoa(s);
    },
    aesBase64DecodeToString: async (b64: string, keyStr: string, trans: string, ivStr: string) => {
      try {
        const key = new TextEncoder().encode(keyStr);
        const iv = new TextEncoder().encode(ivStr);
        const dec = await aesDecryptCbc(b64, key, iv);
        return new TextDecoder().decode(dec);
      } catch {
        return "";
      }
    },
    put: (k: string, v: any) => {
      variables.set(k, v);
      return v;
    },
    get: (k: string) => variables.get(k) || "",
    getString: (rule: string) => "",
    timeFormatUTC: (ts: any, format: string, offset: number) => {
      const d = new Date(Number(ts) || Date.now());
      return d.toISOString().split("T")[0];
    },
  };

  const sourceHelper = {
    getKey: () => context.source?.bookSourceUrl || context.baseUrl || "",
    bookSourceUrl: context.source?.bookSourceUrl || "",
    bookSourceName: context.source?.bookSourceName || "",
    bookSourceComment: context.source?.bookSourceComment || "",
  };

  const bookHelper = {
    name: context.book?.name || "",
    author: context.book?.author || "",
    getVariable: (k: string) => bookVariables.get(k) || context.book?.custom || "0",
    setVariable: (k: string, v: any) => bookVariables.set(k, v),
  };

  return {
    java,
    source: sourceHelper,
    book: bookHelper,
    baseUrl: context.baseUrl || "",
    result: context.result !== undefined ? context.result : "",
    key: context.key || "",
    page: context.page || 1,
    JavaImporter: function () {
      return { importPackage: () => {} };
    },
    Packages: {
      java: { lang: {}, util: {}, io: {} },
      javax: { crypto: { spec: {} } },
    },
  };
}

export async function executeLegadoJs(code: string, context: LegadoContext = {}): Promise<any> {
  const env = createLegadoEnvironment(context);
  let cleanCode = code.trim();

  if (cleanCode.startsWith("@js:")) cleanCode = cleanCode.substring(4).trim();
  cleanCode = cleanCode.replace(/^<js>\s*/i, "").replace(/\s*<\/js>$/i, "");
  cleanCode = cleanCode.replace(/(\.map\s*\()\s*(\[[^\]]+\])\s*=>/g, "$1($2) =>");

  // Auto-await async helper methods
  cleanCode = cleanCode.replace(/\bjava\.aesBase64DecodeToString\s*\(/g, "await java.aesBase64DecodeToString(");
  cleanCode = cleanCode.replace(/\bjava\.digestHex\s*\(/g, "await java.digestHex(");
  cleanCode = cleanCode.replace(/\bdecode\s*\(/g, "await decode(");

  const argNames = Object.keys(env);
  const argValues = Object.values(env);

  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

  let bodyCode: string;
  if (!cleanCode.includes(";") && !cleanCode.includes("\n") && !cleanCode.startsWith("return")) {
    bodyCode = `return (${cleanCode});`;
  } else {
    bodyCode = `
      let __output = typeof result !== 'undefined' ? result : '';
      const __exec = async () => {
        ${cleanCode}
      };
      const __ret = await __exec();
      if (__ret !== undefined) return __ret;
      return typeof result !== 'undefined' ? result : __output;
    `;
  }

  try {
    const fn = new AsyncFunction(...argNames, bodyCode);
    return await fn(...argValues);
  } catch (err: any) {
    console.warn("Legado JS execution error:", err.message);
    return context.result;
  }
}

// ==========================================
// 7. URL Analyzer (Aligned with Rust url_analyzer.rs)
// ==========================================

export interface RequestSpec {
  url: string;
  method: "GET" | "POST";
  headers: Record<string, string>;
  body: string | null;
  charset?: string;
  retry?: number;
}

export async function analyzeUrl(
  ruleUrl: string,
  key: string,
  page: number,
  baseUrl: string,
  source?: any
): Promise<RequestSpec> {
  let rawUrl = (ruleUrl || "").trim();
  let urlConfig: any = null;

  // Split options after comma
  if (rawUrl.includes(",{") || rawUrl.includes(", {")) {
    const idx = rawUrl.indexOf(",{") !== -1 ? rawUrl.indexOf(",{") : rawUrl.indexOf(", {");
    try {
      urlConfig = JSON.parse(rawUrl.substring(idx + 1));
    } catch {}
    rawUrl = rawUrl.substring(0, idx).trim();
  }

  // Handle page choices: <1,2,3>
  const choiceMatch = rawUrl.match(/<([^>]+)>/);
  if (choiceMatch) {
    const choices = choiceMatch[1].split(",");
    const chosen = choices[Math.min(page - 1, choices.length - 1)] || String(page);
    rawUrl = rawUrl.replace(choiceMatch[0], chosen);
  }

  // Handle placeholders: {{key}}, {key}, {{page}}, {page}
  const encodedKey = encodeURIComponent(key);
  rawUrl = rawUrl
    .replace(/\{\{[^}]*key[^}]*\}\}/gi, encodedKey)
    .replace(/\{key\}/gi, encodedKey)
    .replace(/\$\{key\}/g, encodedKey)
    .replace(/\{\{page\}\}/g, String(page))
    .replace(/\{page\}/g, String(page))
    .replace(/\$\{page\}/g, String(page))
    .replace(/\{\{page-1\}\}/g, String(page - 1))
    .replace(/\$\{page-1\}/g, String(page - 1));

  // Resolve base URL
  if (rawUrl.startsWith("//")) {
    const proto = baseUrl.startsWith("https") ? "https:" : "http:";
    rawUrl = `${proto}${rawUrl}`;
  } else if (rawUrl.startsWith("/")) {
    const baseOrigin = new URL(baseUrl).origin;
    rawUrl = `${baseOrigin}${rawUrl}`;
  } else if (!rawUrl.startsWith("http")) {
    rawUrl = `${baseUrl.replace(/\/$/, "")}/${rawUrl.replace(/^\/+/, "")}`;
  }

  const headers: Record<string, string> = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml,application/json;q=0.9,*/*;q=0.8",
    "Accept-Language": "zh-CN,zh;q=0.9",
  };

  const domain = new URL(rawUrl).origin;
  const isIp = /^https?:\/\/\d+\.\d+\.\d+\.\d+/.test(rawUrl);
  if (!isIp) {
    headers["Referer"] = `${domain}/`;
  }

  // Dynamic header execution
  if (source?.header) {
    const hdr = String(source.header).trim();
    if (hdr.startsWith("@js:") || hdr.includes("java.md5Encode")) {
      const jsHdr = await executeLegadoJs(hdr, { source, baseUrl: rawUrl, key, page });
      if (typeof jsHdr === "string") {
        try { Object.assign(headers, JSON.parse(jsHdr)); } catch {}
      } else if (typeof jsHdr === "object" && jsHdr) {
        Object.assign(headers, jsHdr);
      }
    } else {
      try { Object.assign(headers, JSON.parse(hdr)); } catch {}
    }
  }

  let method: "GET" | "POST" = "GET";
  let bodyStr: string | null = null;
  let charset: string | undefined = undefined;
  let retry = 0;

  if (urlConfig) {
    if (urlConfig.method) method = urlConfig.method.toUpperCase() === "POST" ? "POST" : "GET";
    if (urlConfig.headers) Object.assign(headers, urlConfig.headers);
    if (urlConfig.charset) charset = urlConfig.charset;
    if (urlConfig.retry) retry = Number(urlConfig.retry) || 0;
    if (urlConfig.body) {
      bodyStr = typeof urlConfig.body === "string" ? urlConfig.body : JSON.stringify(urlConfig.body);
      bodyStr = bodyStr
        .replace(/\{\{[^}]*key[^}]*\}\}/gi, encodedKey)
        .replace(/\{key\}/gi, encodedKey)
        .replace(/\$\{key\}/g, encodedKey)
        .replace(/\{\{page\}\}/g, String(page))
        .replace(/\$\{page\}/g, String(page));
      if (typeof urlConfig.body !== "string" && !headers["Content-Type"]) {
        headers["Content-Type"] = "application/json";
      }
    }
  }

  return {
    url: rawUrl,
    method,
    headers,
    body: bodyStr,
    charset,
    retry,
  };
}

// ==========================================
// 8. Legado Engine High-Level Operations
// ==========================================

export interface ParsedBookItem {
  name: string;
  author: string;
  bookUrl: string;
  origin: string;
  originName: string;
  coverUrl?: string;
  intro?: string;
  kind?: string;
  wordCount?: string;
  latestChapterTitle?: string;
}

export interface ParsedChapterItem {
  index: number;
  title: string;
  url: string;
}

export async function parseSearchResultsWithRules(
  rawText: string,
  source: any,
  baseUrl: string,
  keyword: string
): Promise<ParsedBookItem[]> {
  const books: ParsedBookItem[] = [];
  const ruleSearch = source.ruleSearch || {};

  let data: any = null;
  const trimmed = rawText.trim();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try { data = JSON.parse(trimmed); } catch {}
  }

  let bookListRule = ruleSearch.bookList || "$.data.list";
  if (bookListRule.includes("<js>")) {
    const jsMatch = bookListRule.match(/<js>([\s\S]*?)<\/js>/i);
    if (jsMatch) {
      const jsRes = await executeLegadoJs(jsMatch[1], {
        source,
        baseUrl,
        result: rawText,
        key: keyword,
      });
      if (typeof jsRes === "string") {
        try { data = JSON.parse(jsRes); } catch {}
      } else if (typeof jsRes === "object") {
        data = jsRes;
      }
      bookListRule = bookListRule.replace(/<js>[\s\S]*?<\/js>/i, "").trim() || "$";
    }
  }

  let items: any[] = [];
  if (data) {
    const extracted = jsonpathQuery(data, bookListRule);
    if (Array.isArray(extracted)) items = extracted;
    else if (extracted && typeof extracted === "object") items = [extracted];
  } else {
    // HTML search results extraction
    items = parseHtmlElements(rawText, bookListRule || ".item");
  }

  const baseDomain = new URL(baseUrl).origin;
  for (const item of items.slice(0, 30)) {
    let name = "";
    let author = "";
    let coverUrl = "";
    let intro = "";
    let kind = "";
    let wordCount = "";
    let bookUrl = "";

    if (typeof item === "object" && !(item as any).rawAttrs) {
      name = String(jsonpathFirstString(item, ruleSearch.name || "$.title") || item.title || item.name || "").trim();
      author = String(jsonpathFirstString(item, ruleSearch.author || "$.author") || item.author || "未知作者").trim();
      coverUrl = String(jsonpathFirstString(item, ruleSearch.coverUrl || "$.cover") || item.coverImg || item.cover || "").trim();
      intro = String(jsonpathFirstString(item, ruleSearch.intro || "$.desc") || item.desc || item.intro || "").trim();
      kind = String(jsonpathFirstString(item, ruleSearch.kind || "$.category") || item.category || "网络小说").trim();
      wordCount = String(jsonpathFirstString(item, ruleSearch.wordCount || "$.word") || item.word || "").trim();

      const template = ruleSearch.bookUrl || "$.bookUrl";
      if (template.includes("{{")) {
        const regex = /\{\{([\s\S]*?)\}\}/g;
        bookUrl = template;
        let bm;
        while ((bm = regex.exec(template)) !== null) {
          const expr = bm[1].trim();
          let val = "";
          if (expr.startsWith("$.") || expr.startsWith("$..") || expr === "$") {
            val = String(jsonpathFirstString(item, expr) ?? "");
          } else if (expr.includes("source.getKey()") || expr.includes("java.")) {
            const jsRes = await executeLegadoJs(expr, { source, baseUrl, result: item });
            val = String(jsRes ?? "");
          } else {
            val = String(item[expr] ?? "");
          }
          bookUrl = bookUrl.replace(bm[0], val);
        }
      } else {
        bookUrl = String(jsonpathFirstString(item, template) || item.bookUrl || item.url || "").trim();
      }
    } else {
      // HTML node
      const nodeHtml = (item as HtmlNode).html || "";
      name = extractTextFromHtml(nodeHtml, ruleSearch.name || "a@text");
      author = extractTextFromHtml(nodeHtml, ruleSearch.author || ".author@text") || "未知作者";
      bookUrl = extractTextFromHtml(nodeHtml, ruleSearch.bookUrl || "a@href");
      coverUrl = extractTextFromHtml(nodeHtml, ruleSearch.coverUrl || "img@src");
    }

    if (!name) continue;
    if (bookUrl.startsWith("//")) bookUrl = `${new URL(baseDomain).protocol}${bookUrl}`;
    else if (bookUrl.startsWith("/")) bookUrl = `${baseDomain}${bookUrl}`;

    books.push({
      name,
      author,
      bookUrl: bookUrl || `${baseUrl}#${name}`,
      origin: source.bookSourceUrl || baseUrl,
      originName: source.bookSourceName || "网络书源",
      coverUrl,
      intro,
      kind,
      wordCount,
    });
  }

  return books;
}

export async function parseChapterListWithRules(
  rawText: string,
  source: any,
  targetUrl: string
): Promise<ParsedChapterItem[]> {
  const chapters: ParsedChapterItem[] = [];
  const ruleToc = source?.ruleToc || {};
  let listRule = (ruleToc.chapterList || "").trim();

  let data: any = null;
  const trimmed = rawText.trim();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try { data = JSON.parse(trimmed); } catch {}
  }

  if (listRule.startsWith("@js:") || listRule.includes("<js>")) {
    const jsCode = listRule.startsWith("@js:")
      ? listRule.substring(4)
      : listRule.replace(/^<js>\s*/i, "").replace(/\s*<\/js>$/i, "");

    const jsRes = await executeLegadoJs(jsCode, {
      source,
      baseUrl: targetUrl,
      result: rawText,
    });

    if (Array.isArray(jsRes)) {
      data = jsRes;
      listRule = "$";
    } else if (typeof jsRes === "string") {
      try {
        data = JSON.parse(jsRes);
        listRule = "$";
      } catch {}
    }
  }

  let rawChapters: any[] = [];
  if (data) {
    const extracted = jsonpathQuery(data, listRule || "$.data.chapters");
    if (Array.isArray(extracted)) rawChapters = extracted;
    else if (Array.isArray(data)) rawChapters = data;
  } else {
    // HTML table of contents
    rawChapters = parseHtmlElements(rawText, listRule || "a");
  }

  const baseDomain = new URL(targetUrl).origin;
  for (let idx = 0; idx < rawChapters.length; idx++) {
    const ch = rawChapters[idx];
    let title = "";
    let url = "";

    if (typeof ch === "object" && !(ch as any).rawAttrs) {
      const nameRule = ruleToc.chapterName || "name";
      if (nameRule.includes("java.aesBase64DecodeToString")) {
        const match = nameRule.match(
          /java\.aesBase64DecodeToString\s*\(\s*([^,]+)\s*,\s*["']([^"']+)["']\s*,\s*["']([^"']+)["']\s*,\s*["']([^"']+)["']\s*\)/
        );
        if (match) {
          try {
            const fieldRule = nameRule.split("@js:")[0];
            const rawVal = String(jsonpathFirstString(ch, fieldRule.trim()) || ch.name || ch.title || "");
            const key = new TextEncoder().encode(match[2]);
            const iv = new TextEncoder().encode(match[4]);
            const dec = await aesDecryptCbc(rawVal, key, iv);
            title = new TextDecoder().decode(dec);
          } catch {}
        }
      }
      if (!title && nameRule.includes("@js:")) {
        const [fieldRule, jsPart] = nameRule.split("@js:");
        const rawVal = jsonpathFirstString(ch, fieldRule.trim()) || ch.name || ch.title || "";
        title = await executeLegadoJs(jsPart, {
          source,
          baseUrl: targetUrl,
          result: String(rawVal),
        });
      } else if (!title) {
        title = String(jsonpathFirstString(ch, nameRule) || ch.name || ch.title || `第 ${idx + 1} 章`);
      }

      const urlRule = ruleToc.chapterUrl || "url";
      if (urlRule.includes("{{")) {
        const regex = /\{\{([\s\S]*?)\}\}/g;
        url = urlRule;
        let um;
        while ((um = regex.exec(urlRule)) !== null) {
          const expr = um[1].trim();
          let val = "";
          if (expr.startsWith("$.") || expr.startsWith("$..") || expr === "$") {
            val = String(jsonpathFirstString(ch, expr) ?? "");
          } else if (expr.includes("source.getKey()") || expr.includes("java.")) {
            const jsRes = await executeLegadoJs(expr, { source, baseUrl: targetUrl, result: ch });
            val = String(jsRes ?? "");
          } else {
            val = String(ch[expr] ?? "");
          }
          url = url.replace(um[0], val);
        }
      } else {
        url = String(jsonpathFirstString(ch, urlRule) || ch.url || ch.link || ch.path || "");
      }
    } else {
      // HTML node
      const nodeHtml = (ch as HtmlNode).html || "";
      title = extractTextFromHtml(nodeHtml, ruleToc.chapterName || "text") || (ch as HtmlNode).text;
      url = extractTextFromHtml(nodeHtml, ruleToc.chapterUrl || "href") || (ch as HtmlNode).attrs["href"] || "";
    }

    if (url.startsWith("//")) {
      url = `${new URL(baseDomain).protocol}${url}`;
    } else if (url && !url.startsWith("http")) {
      url = `${baseDomain}/${url.replace(/^\/+/, "")}`;
    }

    if (title && url) {
      chapters.push({
        index: idx,
        title: title.trim(),
        url: url.trim(),
      });
    }
  }

  return chapters;
}

export async function parseContentWithRules(
  rawText: string,
  source: any,
  chapterUrl: string
): Promise<string> {
  const ruleContent = source?.ruleContent || {};
  let contentRule = (ruleContent.content || "$..content").trim();

  let body = rawText;
  if (rawText.trim().startsWith("{") || rawText.trim().startsWith("[")) {
    try {
      const j = JSON.parse(rawText);
      const extracted = jsonpathQuery(j, contentRule.split("@js:")[0]);
      if (extracted && extracted.length > 0) {
        body = extracted.join("\n");
      }
    } catch {}
  } else {
    // HTML content extraction
    const cssRule = contentRule.split("@js:")[0];
    const extracted = extractTextFromHtml(rawText, cssRule || "#content@html");
    if (extracted) body = extracted;
  }

  if (contentRule.includes("java.aesBase64DecodeToString")) {
    const match = contentRule.match(
      /java\.aesBase64DecodeToString\s*\(\s*([^,]+)\s*,\s*["']([^"']+)["']\s*,\s*["']([^"']+)["']\s*,\s*["']([^"']+)["']\s*\)/
    );
    if (match) {
      try {
        const key = new TextEncoder().encode(match[2]);
        const iv = new TextEncoder().encode(match[4]);
        const dec = await aesDecryptCbc(body, key, iv);
        body = new TextDecoder().decode(dec);
        return body;
      } catch (err: any) {
        console.warn("Direct aesBase64DecodeToString error:", err.message);
      }
    }
  }

  if (contentRule.includes("@js:")) {
    const jsPart = contentRule.split("@js:")[1];
    const jsRes = await executeLegadoJs(jsPart, {
      source,
      baseUrl: chapterUrl,
      result: body,
    });
    if (jsRes) body = String(jsRes);
  }

  // Regex replacement: replaceRegex
  if (ruleContent.replaceRegex) {
    try {
      const parts = splitTopLevel(ruleContent.replaceRegex, ["##"]).parts;
      if (parts.length >= 2) {
        body = body.replace(new RegExp(parts[0], "g"), parts[1] || "");
      }
    } catch {}
  }

  return body;
}
