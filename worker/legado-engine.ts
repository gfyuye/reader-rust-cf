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

export function md5Hex(string: string): string {
  function rotateLeft(lValue: number, iShiftBits: number) {
    return (lValue << iShiftBits) | (lValue >>> (32 - iShiftBits));
  }
  function addUnsigned(lX: number, lY: number) {
    const lX8 = lX & 0x80000000;
    const lY8 = lY & 0x80000000;
    const lX4 = lX & 0x40000000;
    const lY4 = lY & 0x40000000;
    const lResult = (lX & 0x3fffffff) + (lY & 0x3fffffff);
    if (lX4 & lY4) return lResult ^ 0x80000000 ^ lX8 ^ lY8;
    if (lX4 | lY4) {
      if (lResult & 0x40000000) return lResult ^ 0xc0000000 ^ lX8 ^ lY8;
      else return lResult ^ 0x40000000 ^ lX8 ^ lY8;
    } else {
      return lResult ^ lX8 ^ lY8;
    }
  }
  function F(x: number, y: number, z: number) { return (x & y) | (~x & z); }
  function G(x: number, y: number, z: number) { return (x & z) | (y & ~z); }
  function H(x: number, y: number, z: number) { return x ^ y ^ z; }
  function I(x: number, y: number, z: number) { return y ^ (x | ~z); }
  function FF(a: number, b: number, c: number, d: number, x: number, s: number, ac: number) {
    a = addUnsigned(a, addUnsigned(addUnsigned(F(b, c, d), x), ac));
    return addUnsigned(rotateLeft(a, s), b);
  }
  function GG(a: number, b: number, c: number, d: number, x: number, s: number, ac: number) {
    a = addUnsigned(a, addUnsigned(addUnsigned(G(b, c, d), x), ac));
    return addUnsigned(rotateLeft(a, s), b);
  }
  function HH(a: number, b: number, c: number, d: number, x: number, s: number, ac: number) {
    a = addUnsigned(a, addUnsigned(addUnsigned(H(b, c, d), x), ac));
    return addUnsigned(rotateLeft(a, s), b);
  }
  function II(a: number, b: number, c: number, d: number, x: number, s: number, ac: number) {
    a = addUnsigned(a, addUnsigned(addUnsigned(I(b, c, d), x), ac));
    return addUnsigned(rotateLeft(a, s), b);
  }
  function convertToWordArray(str: string) {
    let lWordCount;
    const lMessageLength = str.length;
    const lNumberOfWordsTempOne = lMessageLength + 8;
    const lNumberOfWordsTempTwo = (lNumberOfWordsTempOne - (lNumberOfWordsTempOne % 64)) / 64;
    const lNumberOfWords = (lNumberOfWordsTempTwo + 1) * 16;
    const lWordArray = Array(lNumberOfWords - 1);
    let lBytePosition = 0;
    let lByteCount = 0;
    while (lByteCount < lMessageLength) {
      lWordCount = (lByteCount - (lByteCount % 4)) / 4;
      lBytePosition = (lByteCount % 4) * 8;
      lWordArray[lWordCount] = lWordArray[lWordCount] | (str.charCodeAt(lByteCount) << lBytePosition);
      lByteCount++;
    }
    lWordCount = (lByteCount - (lByteCount % 4)) / 4;
    lBytePosition = (lByteCount % 4) * 8;
    lWordArray[lWordCount] = lWordArray[lWordCount] | (0x80 << lBytePosition);
    lWordArray[lNumberOfWords - 2] = lMessageLength << 3;
    lWordArray[lNumberOfWords - 1] = lMessageLength >>> 29;
    return lWordArray;
  }
  function wordToHex(lValue: number) {
    let WordToHexValue = "", WordToHexValueTemp = "", lByte, lCount;
    for (lCount = 0; lCount <= 3; lCount++) {
      lByte = (lValue >>> (lCount * 8)) & 255;
      WordToHexValueTemp = "0" + lByte.toString(16);
      WordToHexValue = WordToHexValue + WordToHexValueTemp.substr(WordToHexValueTemp.length - 2, 2);
    }
    return WordToHexValue;
  }

  const x = convertToWordArray(String(string));
  let a = 0x67452301, b = 0xefcdab89, c = 0x98badcfe, d = 0x10325476;
  const S11 = 7, S12 = 12, S13 = 17, S14 = 22;
  const S21 = 5, S22 = 9, S23 = 14, S24 = 20;
  const S31 = 4, S32 = 11, S33 = 16, S34 = 23;
  const S41 = 6, S42 = 10, S43 = 15, S44 = 21;

  for (let k = 0; k < x.length; k += 16) {
    const AA = a, BB = b, CC = c, DD = d;
    a = FF(a, b, c, d, x[k], S11, 0xd76aa478);
    d = FF(d, a, b, c, x[k + 1], S12, 0xe8c7b756);
    c = FF(c, d, a, b, x[k + 2], S13, 0x242070db);
    b = FF(b, c, d, a, x[k + 3], S14, 0xc1bdceee);
    a = FF(a, b, c, d, x[k + 4], S11, 0xf57c0faf);
    d = FF(d, a, b, c, x[k + 5], S12, 0x4787c62a);
    c = FF(c, d, a, b, x[k + 6], S13, 0xa8304613);
    b = FF(b, c, d, a, x[k + 7], S14, 0xfd469501);
    a = FF(a, b, c, d, x[k + 8], S11, 0x698098d8);
    d = FF(d, a, b, c, x[k + 9], S12, 0x8b44f7af);
    c = FF(c, d, a, b, x[k + 10], S13, 0xffff5bb1);
    b = FF(b, c, d, a, x[k + 11], S14, 0x895cd7be);
    a = FF(a, b, c, d, x[k + 12], S11, 0x6b901122);
    d = FF(d, a, b, c, x[k + 13], S12, 0xfd987193);
    c = FF(c, d, a, b, x[k + 14], S13, 0x8b44f7af);
    b = FF(b, c, d, a, x[k + 15], S14, 0xffff5bb1);
    a = GG(a, b, c, d, x[k + 1], S21, 0xf61e2562);
    d = GG(d, a, b, c, x[k + 6], S22, 0xc040b340);
    c = GG(c, d, a, b, x[k + 11], S23, 0x265e5a51);
    b = GG(b, c, d, a, x[k], S24, 0xe9b6c7aa);
    a = GG(a, b, c, d, x[k + 5], S21, 0xd62f105d);
    d = GG(d, a, b, c, x[k + 10], S22, 0x2441453);
    c = GG(c, d, a, b, x[k + 15], S23, 0xd8a1e681);
    b = GG(b, c, d, a, x[k + 4], S24, 0xe7d3fbc8);
    a = GG(a, b, c, d, x[k + 9], S21, 0x21e1cde6);
    d = GG(d, a, b, c, x[k + 14], S22, 0xc33707d6);
    c = GG(c, d, a, b, x[k + 3], S23, 0xf4d50d87);
    b = GG(b, c, d, a, x[k + 8], S24, 0x455a14ed);
    a = GG(a, b, c, d, x[k + 13], S21, 0xa9e3e905);
    d = GG(d, a, b, c, x[k + 2], S22, 0xfcefa3f8);
    c = GG(c, d, a, b, x[k + 7], S23, 0x676f02d9);
    b = GG(b, c, d, a, x[k + 12], S24, 0x8d2a4c8a);
    a = HH(a, b, c, d, x[k + 5], S31, 0xfffa3942);
    d = HH(d, a, b, c, x[k + 8], S32, 0x8771f681);
    c = HH(c, d, a, b, x[k + 11], S33, 0x6d9d6122);
    b = HH(b, c, d, a, x[k + 14], S34, 0xfde5380c);
    a = HH(a, b, c, d, x[k + 1], S31, 0xa4beea44);
    d = HH(d, a, b, c, x[k + 4], S32, 0x4bdecfa9);
    c = HH(c, d, a, b, x[k + 7], S33, 0xf6bb4b60);
    b = HH(b, c, d, a, x[k + 10], S34, 0xbebfbc70);
    a = HH(a, b, c, d, x[k + 13], S31, 0x289b7ec6);
    d = HH(d, a, b, c, x[k], S32, 0xeaa127fa);
    c = HH(c, d, a, b, x[k + 3], S33, 0xd4ef3085);
    b = HH(b, c, d, a, x[k + 6], S34, 0x4881d05);
    a = HH(a, b, c, d, x[k + 9], S31, 0xd9d4d039);
    d = HH(d, a, b, c, x[k + 12], S32, 0xe6db99e5);
    c = HH(c, d, a, b, x[k + 15], S33, 0x1fa27cf8);
    b = HH(b, c, d, a, x[k + 2], S34, 0xc4ac5665);
    a = II(a, b, c, d, x[k], S41, 0xf4292244);
    d = II(d, a, b, c, x[k + 7], S42, 0x432aff97);
    c = II(c, d, a, b, x[k + 14], S43, 0xab9423a7);
    b = II(b, c, d, a, x[k + 5], S44, 0xfc93a039);
    a = II(a, b, c, d, x[k + 12], S41, 0x655b59c3);
    d = II(d, a, b, c, x[k + 3], S42, 0x8f0ccc92);
    c = II(c, d, a, b, x[k + 10], S43, 0xffeff47d);
    b = II(b, c, d, a, x[k + 1], S44, 0x85845dd1);
    a = II(a, b, c, d, x[k + 8], S41, 0x6fa87e4f);
    d = II(d, a, b, c, x[k + 15], S42, 0xfe2ce6e0);
    c = II(c, d, a, b, x[k + 6], S43, 0xa3014314);
    b = II(b, c, d, a, x[k + 13], S44, 0x4e0811a1);
    a = II(a, b, c, d, x[k + 4], S41, 0xf7537e82);
    d = II(d, a, b, c, x[k + 11], S42, 0xbd3af235);
    c = II(c, d, a, b, x[k + 2], S43, 0x2ad7d2bb);
    b = II(b, c, d, a, x[k + 9], S44, 0xeb86d391);
    a = addUnsigned(a, AA);
    b = addUnsigned(b, BB);
    c = addUnsigned(c, CC);
    d = addUnsigned(d, DD);
  }
  return (wordToHex(a) + wordToHex(b) + wordToHex(c) + wordToHex(d)).toLowerCase();
}

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

// Global variable store shared across Legado rule executions
export const sessionVariableStore = new Map<string, any>();
export function getSessionVariable(key: string): any {
  return sessionVariableStore.get(key) || "";
}
export function setSessionVariable(key: string, val: any): any {
  sessionVariableStore.set(key, val);
  return val;
}

// Pure synchronous AES-128-CBC / ECB decryption
const AES_SBOX = new Uint8Array([
  0x63, 0x7c, 0x77, 0x7b, 0xf2, 0x6b, 0x6f, 0xc5, 0x30, 0x01, 0x67, 0x2b, 0xfe, 0xd7, 0xab, 0x76,
  0xca, 0x82, 0xc9, 0x7d, 0xfa, 0x59, 0x47, 0xf0, 0xad, 0xd4, 0xa2, 0xaf, 0x9c, 0xa4, 0x72, 0xc0,
  0xb7, 0xfd, 0x93, 0x26, 0x36, 0x3f, 0xf7, 0xcc, 0x34, 0xa5, 0xe5, 0xf1, 0x71, 0xd8, 0x31, 0x15,
  0x04, 0xc7, 0x23, 0xc3, 0x18, 0x96, 0x05, 0x9a, 0x07, 0x12, 0x80, 0xe2, 0xeb, 0x27, 0xb2, 0x75,
  0x09, 0x83, 0x2c, 0x1a, 0x1b, 0x6e, 0x5a, 0xa0, 0x52, 0x3b, 0xd6, 0xb3, 0x29, 0xe3, 0x2f, 0x84,
  0x53, 0xd1, 0x00, 0xed, 0x20, 0xfc, 0xb1, 0x5b, 0x6a, 0xcb, 0xbe, 0x39, 0x4a, 0x4c, 0x58, 0xcf,
  0xd0, 0xef, 0xaa, 0xfb, 0x43, 0x4d, 0x33, 0x85, 0x45, 0xf9, 0x02, 0x7f, 0x50, 0x3c, 0x9f, 0xa8,
  0x51, 0xa3, 0x40, 0x8f, 0x92, 0x9d, 0x38, 0xf5, 0xbc, 0xb6, 0xda, 0x21, 0x10, 0xff, 0xf3, 0xd2,
  0xcd, 0x0c, 0x13, 0xec, 0x5f, 0x97, 0x44, 0x17, 0xc4, 0xa7, 0x7e, 0x3d, 0x64, 0x5d, 0x19, 0x73,
  0x60, 0x81, 0x4f, 0xdc, 0x22, 0x2a, 0x90, 0x88, 0x46, 0xee, 0xb8, 0x14, 0xde, 0x5e, 0x0b, 0xdb,
  0xe0, 0x32, 0x3a, 0x0a, 0x49, 0x06, 0x24, 0x5c, 0xc2, 0xd3, 0xac, 0x62, 0x91, 0x95, 0xe4, 0x79,
  0xe7, 0xc8, 0x37, 0x6d, 0x8d, 0xd5, 0x4e, 0xa9, 0x6c, 0x56, 0xf4, 0xea, 0x65, 0x7a, 0xae, 0x08,
  0xba, 0x78, 0x25, 0x2e, 0x1c, 0xa6, 0xb4, 0xc6, 0xe8, 0xdd, 0x74, 0x1f, 0x4b, 0xbd, 0x8b, 0x8a,
  0x70, 0x3e, 0xb5, 0x66, 0x48, 0x03, 0xf6, 0x0e, 0x61, 0x35, 0x57, 0xb9, 0x86, 0xc1, 0x1d, 0x9e,
  0xe1, 0xf8, 0x98, 0x11, 0x69, 0xd9, 0x8e, 0x94, 0x9b, 0x1e, 0x87, 0xe9, 0xce, 0x55, 0x28, 0xdf,
  0x8c, 0xa1, 0x89, 0x0d, 0xbf, 0xe6, 0x42, 0x68, 0x41, 0x99, 0x2d, 0x0f, 0xb0, 0x54, 0xbb, 0x16,
]);
const AES_INV_SBOX = new Uint8Array(256);
for (let i = 0; i < 256; i++) AES_INV_SBOX[AES_SBOX[i]] = i;
const AES_RCON = new Uint32Array([0x00, 0x01, 0x02, 0x04, 0x08, 0x10, 0x20, 0x40, 0x80, 0x1b, 0x36]);

function aesKeyExpansion(keyBytes: Uint8Array) {
  const Nk = Math.floor(keyBytes.length / 4);
  const Nr = Nk + 6;
  const w = new Uint32Array(4 * (Nr + 1));
  for (let i = 0; i < Nk; i++) {
    w[i] = (keyBytes[4 * i] << 24) | (keyBytes[4 * i + 1] << 16) | (keyBytes[4 * i + 2] << 8) | keyBytes[4 * i + 3];
  }
  for (let i = Nk; i < 4 * (Nr + 1); i++) {
    let temp = w[i - 1];
    if (i % Nk === 0) {
      temp = ((AES_SBOX[(temp >>> 16) & 0xff] << 24) | (AES_SBOX[(temp >>> 8) & 0xff] << 16) | (AES_SBOX[temp & 0xff] << 8) | AES_SBOX[temp >>> 24]) ^ (AES_RCON[Math.floor(i / Nk)] << 24);
    } else if (Nk > 6 && i % Nk === 4) {
      temp = (AES_SBOX[temp >>> 24] << 24) | (AES_SBOX[(temp >>> 16) & 0xff] << 16) | (AES_SBOX[(temp >>> 8) & 0xff] << 8) | AES_SBOX[temp & 0xff];
    }
    w[i] = w[i - Nk] ^ temp;
  }
  return { w, Nr };
}

function aesGmul(a: number, b: number) {
  let p = 0;
  for (let i = 0; i < 8; i++) {
    if (b & 1) p ^= a;
    const hi = a & 0x80;
    a = (a << 1) & 0xff;
    if (hi) a ^= 0x1b;
    b >>>= 1;
  }
  return p;
}

function aesInvBlock(input: Uint8Array, out: Uint8Array, offset: number, w: Uint32Array, Nr: number) {
  const s = new Uint8Array(16);
  for (let i = 0; i < 16; i++) s[i] = input[i];

  for (let c = 0; c < 4; c++) {
    const k = w[Nr * 4 + c];
    s[c * 4] ^= (k >>> 24) & 0xff;
    s[c * 4 + 1] ^= (k >>> 16) & 0xff;
    s[c * 4 + 2] ^= (k >>> 8) & 0xff;
    s[c * 4 + 3] ^= k & 0xff;
  }

  for (let r = Nr - 1; r >= 1; r--) {
    const t1 = s[13]; s[13] = s[9]; s[9] = s[5]; s[5] = s[1]; s[1] = t1;
    const t2 = s[2]; s[2] = s[10]; s[10] = t2; const t2b = s[6]; s[6] = s[14]; s[14] = t2b;
    const t3 = s[3]; s[3] = s[7]; s[7] = s[11]; s[11] = s[15]; s[15] = t3;

    for (let i = 0; i < 16; i++) s[i] = AES_INV_SBOX[s[i]];

    for (let c = 0; c < 4; c++) {
      const k = w[r * 4 + c];
      s[c * 4] ^= (k >>> 24) & 0xff;
      s[c * 4 + 1] ^= (k >>> 16) & 0xff;
      s[c * 4 + 2] ^= (k >>> 8) & 0xff;
      s[c * 4 + 3] ^= k & 0xff;
    }

    for (let c = 0; c < 4; c++) {
      const idx = c * 4;
      const s0 = s[idx], s1 = s[idx + 1], s2 = s[idx + 2], s3 = s[idx + 3];
      s[idx] = aesGmul(s0, 0x0e) ^ aesGmul(s1, 0x0b) ^ aesGmul(s2, 0x0d) ^ aesGmul(s3, 0x09);
      s[idx + 1] = aesGmul(s0, 0x09) ^ aesGmul(s1, 0x0e) ^ aesGmul(s2, 0x0b) ^ aesGmul(s3, 0x0d);
      s[idx + 2] = aesGmul(s0, 0x0d) ^ aesGmul(s1, 0x09) ^ aesGmul(s2, 0x0e) ^ aesGmul(s3, 0x0b);
      s[idx + 3] = aesGmul(s0, 0x0b) ^ aesGmul(s1, 0x0d) ^ aesGmul(s2, 0x09) ^ aesGmul(s3, 0x0e);
    }
  }

  const t1 = s[13]; s[13] = s[9]; s[9] = s[5]; s[5] = s[1]; s[1] = t1;
  const t2 = s[2]; s[2] = s[10]; s[10] = t2; const t2b = s[6]; s[6] = s[14]; s[14] = t2b;
  const t3 = s[3]; s[3] = s[7]; s[7] = s[11]; s[11] = s[15]; s[15] = t3;

  for (let i = 0; i < 16; i++) s[i] = AES_INV_SBOX[s[i]];

  for (let c = 0; c < 4; c++) {
    const k = w[c];
    s[c * 4] ^= (k >>> 24) & 0xff;
    s[c * 4 + 1] ^= (k >>> 16) & 0xff;
    s[c * 4 + 2] ^= (k >>> 8) & 0xff;
    s[c * 4 + 3] ^= k & 0xff;
  }

  for (let i = 0; i < 16; i++) out[offset + i] = s[i];
}

export function aesDecryptCbcSync(ciphertext: Uint8Array, keyBytes: Uint8Array, ivBytes?: Uint8Array): Uint8Array {
  const { w, Nr } = aesKeyExpansion(keyBytes);
  const out = new Uint8Array(ciphertext.length);
  let prev = ivBytes ? new Uint8Array(ivBytes) : new Uint8Array(16);

  for (let i = 0; i < ciphertext.length; i += 16) {
    const block = ciphertext.subarray(i, i + 16);
    aesInvBlock(block, out, i, w, Nr);
    if (ivBytes) {
      for (let j = 0; j < 16; j++) out[i + j] ^= prev[j];
      prev = block;
    }
  }

  const padLen = out[out.length - 1];
  if (padLen > 0 && padLen <= 16) {
    let valid = true;
    for (let i = out.length - padLen; i < out.length; i++) {
      if (out[i] !== padLen) { valid = false; break; }
    }
    if (valid) return out.subarray(0, out.length - padLen);
  }
  return out;
}

export function createLegadoEnvironment(context: LegadoContext = {}) {
  const variables = new Map<string, any>();
  const bookVariables = new Map<string, any>();

  const java = {
    ajax: async (url: string) => {
      try {
        const spec = await analyzeUrl(url, "", 1, context.baseUrl || "", context.source);
        const resp = await fetch(spec.url, {
          method: spec.method,
          headers: spec.headers,
          body: spec.body,
          signal: AbortSignal.timeout(10000),
        });
        if (!resp.ok) return "{}";
        return await resp.text();
      } catch {
        return "{}";
      }
    },
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
    aesBase64DecodeToString: (b64: string, keyStr: string, trans: string, ivStr: string) => {
      try {
        const key = new TextEncoder().encode(keyStr);
        const iv = new TextEncoder().encode(ivStr);
        const rawBytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
        const dec = aesDecryptCbcSync(rawBytes, key, iv);
        return new TextDecoder().decode(dec);
      } catch {
        return "";
      }
    },
    put: (k: string, v: any) => {
      variables.set(k, v);
      setSessionVariable(k, v);
      return typeof v === "string" ? v : JSON.stringify(v);
    },
    get: (k: string) => {
      const v = variables.get(k) ?? getSessionVariable(k);
      return v !== undefined && v !== null ? v : "";
    },
    getString: (rule: string) => "",
    timeFormat: (ts: any) => {
      const d = new Date(Number(ts) || Date.now());
      return d.toLocaleDateString("zh-CN");
    },
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
    getVariable: (k: string) => bookVariables.get(k) || getSessionVariable(k) || context.book?.custom || "0",
    setVariable: (k: string, v: any) => {
      bookVariables.set(k, v);
      setSessionVariable(k, v);
    },
  };

  const Base64 = {
    getDecoder: () => ({
      decode: (str: string) => {
        let pad = String(str).trim().replace(/-/g, "+").replace(/_/g, "/");
        while (pad.length % 4 !== 0) pad += "=";
        const bStr = atob(pad);
        const arr = new Uint8Array(bStr.length);
        for (let i = 0; i < bStr.length; i++) arr[i] = bStr.charCodeAt(i);
        return arr;
      },
    }),
    getEncoder: () => ({
      encodeToString: (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)),
    }),
  };

  const Arrays = {
    copyOfRange: (arr: any, from: number, to: number) => {
      return arr.subarray ? arr.subarray(from, to) : arr.slice(from, to);
    },
  };

  const SecretKeySpec = function (keyInput: any, alg: string) {
    const bytes = typeof keyInput === "string" ? new TextEncoder().encode(keyInput) : keyInput;
    return { bytes, alg };
  };

  const IvParameterSpec = function (ivInput: any) {
    const iv = typeof ivInput === "string" ? new TextEncoder().encode(ivInput) : ivInput;
    return { iv };
  };

  const Cipher = {
    getInstance: (trans: string) => {
      let mode = 1;
      let keyObj: any = null;
      let ivObj: any = null;
      return {
        init: (m: number, k: any, iv: any) => {
          mode = m;
          keyObj = k;
          ivObj = iv;
        },
        doFinal: (data: any) => {
          const kBytes = keyObj?.bytes || keyObj;
          const iBytes = ivObj?.iv || ivObj;
          const inBytes = data instanceof Uint8Array ? data : new Uint8Array(data);
          const decrypted = aesDecryptCbcSync(inBytes, kBytes, iBytes);
          return new TextDecoder().decode(decrypted);
        },
      };
    },
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
    Base64,
    Arrays,
    SecretKeySpec,
    IvParameterSpec,
    Cipher,
    encodeURIComponent,
    decodeURIComponent,
    Object,
    Array,
    String,
    Number,
    JSON,
  };
}

// ==========================================
// Lightweight AST Interpreter for Legado JS Rules
// (Bypasses Cloudflare Workers dynamic code generation restrictions)
// ==========================================

export async function interpretLegadoJs(code: string, globalScope: Record<string, any>): Promise<any> {
  const tokens: Array<{ type: string; value: any }> = [];
  let i = 0;
  while (i < code.length) {
    const c = code[i];
    if (/\s/.test(c)) { i++; continue; }
    if (c === "/" && code[i + 1] === "/") {
      while (i < code.length && code[i] !== "\n") i++;
      continue;
    }
    if (c === "/" && code[i + 1] === "*") {
      i += 2;
      while (i < code.length && !(code[i] === "*" && code[i + 1] === "/")) i++;
      i += 2;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      const quote = c;
      i++;
      let s = "";
      while (i < code.length && code[i] !== quote) {
        if (code[i] === "\\" && i + 1 < code.length) {
          const next = code[i + 1];
          if (next === "n") s += "\n";
          else if (next === "t") s += "\t";
          else if (next === "r") s += "\r";
          else s += next;
          i += 2;
        } else {
          s += code[i++];
        }
      }
      i++;
      tokens.push({ type: "string", value: s });
      continue;
    }
    if (/\d/.test(c)) {
      let num = "";
      while (i < code.length && /[\d.]/.test(code[i])) num += code[i++];
      tokens.push({ type: "number", value: Number(num) });
      continue;
    }
    if (/[a-zA-Z_$]/.test(c)) {
      let id = "";
      while (i < code.length && /[a-zA-Z0-9_$]/.test(code[i])) id += code[i++];
      tokens.push({ type: "ident", value: id });
      continue;
    }
    if (code.slice(i, i + 3) === "===" || code.slice(i, i + 3) === "!==") {
      tokens.push({ type: "op", value: code.slice(i, i + 3) });
      i += 3;
      continue;
    }
    const two = code.slice(i, i + 2);
    if (
      two === "==" || two === "!=" || two === "<=" || two === ">=" ||
      two === "&&" || two === "||" || two === "+=" || two === "-=" ||
      two === "=>"
    ) {
      tokens.push({ type: "op", value: two });
      i += 2;
      continue;
    }
    tokens.push({ type: "punc", value: c });
    i++;
  }

  let pos = 0;
  function peek() { return tokens[pos]; }
  function next() { return tokens[pos++]; }
  function match(type: string, val?: any) {
    const t = peek();
    if (!t) return false;
    if (type && t.type !== type) return false;
    if (val !== undefined && t.value !== val) return false;
    pos++;
    return true;
  }
  function expect(val: any) {
    const t = next();
    if (!t || t.value !== val) throw new Error("Expected " + val + ", got " + (t ? t.value : "EOF"));
    return t;
  }

  class Scope {
    vars: Record<string, any>;
    parent: Scope | null;
    isWith = false;
    constructor(parent: Scope | null) {
      this.vars = Object.create(parent ? parent.vars : null);
      this.parent = parent;
    }
    get(name: string): any {
      if (name in this.vars) return this.vars[name];
      if (this.parent) return this.parent.get(name);
      return undefined;
    }
    set(name: string, val: any) {
      if (this.parent && this.parent.has(name)) {
        this.parent.set(name, val);
      } else {
        this.vars[name] = val;
      }
    }
    has(name: string): boolean {
      return (name in this.vars) || Boolean(this.parent && this.parent.has(name));
    }
  }

  const rootScope = new Scope(null);
  for (const k in globalScope) {
    rootScope.vars[k] = globalScope[k];
  }

  function parseExpression(): any { return parseAssignment(); }

  function parseAssignment(): any {
    const left = parseTernary();
    const t = peek();
    if (t && (t.value === "=" || t.value === "+=" || t.value === "-=")) {
      next();
      const right = parseAssignment();
      return { type: "Assign", op: t.value, left, right };
    }
    return left;
  }

  function parseTernary(): any {
    const expr = parseLogicalOr();
    if (match("punc", "?")) {
      const cons = parseExpression();
      expect(":");
      const alt = parseExpression();
      return { type: "Ternary", test: expr, cons, alt };
    }
    return expr;
  }

  function parseLogicalOr(): any {
    let left = parseLogicalAnd();
    while (match("op", "||")) {
      const right = parseLogicalAnd();
      left = { type: "Binary", op: "||", left, right };
    }
    return left;
  }

  function parseLogicalAnd(): any {
    let left = parseEquality();
    while (match("op", "&&")) {
      const right = parseEquality();
      left = { type: "Binary", op: "&&", left, right };
    }
    return left;
  }

  function parseEquality(): any {
    let left = parseRelational();
    while (peek() && (peek().value === "==" || peek().value === "===" || peek().value === "!=" || peek().value === "!==")) {
      const op = next().value;
      const right = parseRelational();
      left = { type: "Binary", op, left, right };
    }
    return left;
  }

  function parseRelational(): any {
    let left = parseAdditive();
    while (
      peek() &&
      (peek().value === "<" || peek().value === "<=" || peek().value === ">" || peek().value === ">=" ||
       (peek().type === "ident" && peek().value === "instanceof"))
    ) {
      const op = next().value;
      const right = parseAdditive();
      left = { type: "Binary", op, left, right };
    }
    return left;
  }

  function parseAdditive(): any {
    let left = parseMultiplicative();
    while (peek() && (peek().value === "+" || peek().value === "-")) {
      const op = next().value;
      const right = parseMultiplicative();
      left = { type: "Binary", op, left, right };
    }
    return left;
  }

  function parseMultiplicative(): any {
    let left = parseUnary();
    while (peek() && (peek().value === "*" || peek().value === "/" || peek().value === "%")) {
      const op = next().value;
      const right = parseUnary();
      left = { type: "Binary", op, left, right };
    }
    return left;
  }

  function parseUnary(): any {
    if (match("ident", "new")) {
      const expr = parsePostfix();
      return { type: "New", expr };
    }
    const t = peek();
    if (t && (t.value === "!" || t.value === "-" || (t.type === "ident" && t.value === "typeof"))) {
      next();
      const expr = parseUnary();
      return { type: "Unary", op: t.value, expr };
    }
    return parsePostfix();
  }

  function parsePostfix(): any {
    let expr = parsePrimary();
    while (true) {
      if (match("punc", ".")) {
        const prop = next();
        expr = { type: "Member", object: expr, property: prop.value, computed: false };
      } else if (match("punc", "[")) {
        const prop = parseExpression();
        expect("]");
        expr = { type: "Member", object: expr, property: prop, computed: true };
      } else if (match("punc", "(")) {
        const args: any[] = [];
        if (!match("punc", ")")) {
          while (true) {
            args.push(parseExpression());
            if (match("punc", ",")) continue;
            expect(")");
            break;
          }
        }
        expr = { type: "Call", callee: expr, args };
      } else {
        break;
      }
    }
    return expr;
  }

  function parsePrimary(): any {
    const t = peek();
    if (!t) throw new Error("Unexpected EOF");
    if (t.type === "number" || t.type === "string") {
      next();
      return { type: "Literal", value: t.value };
    }
    if (t.type === "ident") {
      if (t.value === "true") { next(); return { type: "Literal", value: true }; }
      if (t.value === "false") { next(); return { type: "Literal", value: false }; }
      if (t.value === "null") { next(); return { type: "Literal", value: null }; }
      if (t.value === "undefined") { next(); return { type: "Literal", value: undefined }; }
      if (t.value === "function") {
        next();
        let name = null;
        if (peek() && peek().type === "ident") name = next().value;
        expect("(");
        const params: string[] = [];
        if (!match("punc", ")")) {
          while (true) {
            params.push(next().value);
            if (match("punc", ",")) continue;
            expect(")");
            break;
          }
        }
        const body = parseBlock();
        return { type: "FunctionExpr", name, params, body };
      }
      next();
      return { type: "Identifier", name: t.value };
    }
    if (match("punc", "(")) {
      const savedPos = pos;
      const idList: string[] = [];
      let isParamList = true;
      if (!match("punc", ")")) {
        while (true) {
          const pt = peek();
          if (pt && pt.type === "ident") {
            idList.push(next().value);
            if (match("punc", ",")) continue;
            if (match("punc", ")")) break;
            isParamList = false; break;
          } else {
            isParamList = false; break;
          }
        }
      }
      if (isParamList && peek() && peek().value === "=>") {
        next();
        const body = peek() && peek().value === "{" ? parseBlock() : parseExpression();
        return { type: "ArrowFunction", params: idList, body };
      }
      pos = savedPos;
      const expr = parseExpression();
      expect(")");
      if (peek() && peek().value === "=>") {
        next();
        const body = peek() && peek().value === "{" ? parseBlock() : parseExpression();
        const params = expr.type === "Identifier" ? [expr.name] : [];
        return { type: "ArrowFunction", params, body };
      }
      return expr;
    }
    if (match("punc", "[")) {
      const elements: any[] = [];
      if (!match("punc", "]")) {
        while (true) {
          elements.push(parseExpression());
          if (match("punc", ",")) continue;
          expect("]");
          break;
        }
      }
      return { type: "ArrayLiteral", elements };
    }
    if (match("punc", "{")) {
      const properties: Array<{ key: string; val: any }> = [];
      if (!match("punc", "}")) {
        while (true) {
          const keyTok = next();
          const key = keyTok.value;
          expect(":");
          const val = parseExpression();
          properties.push({ key, val });
          if (match("punc", ",")) continue;
          expect("}");
          break;
        }
      }
      return { type: "ObjectLiteral", properties };
    }
    throw new Error("Unexpected token: " + JSON.stringify(t));
  }

  function parseBlock(): any {
    expect("{");
    const stmts: any[] = [];
    while (!match("punc", "}")) {
      if (pos >= tokens.length) break;
      stmts.push(parseStatement());
    }
    return { type: "Block", stmts };
  }

  function parseStatement(): any {
    const t = peek();
    if (!t) return { type: "Empty" };
    if (t.type === "ident" && (t.value === "var" || t.value === "let" || t.value === "const")) {
      next();
      const decls: Array<{ id: string; init: any }> = [];
      while (true) {
        const id = next().value;
        let init = null;
        if (match("punc", "=") || (peek() && peek().value === "=")) {
          if (peek() && peek().value === "=") next();
          init = parseExpression();
        }
        decls.push({ id, init });
        if (match("punc", ",")) continue;
        break;
      }
      match("punc", ";");
      return { type: "VarDecl", decls };
    }
    if (t.type === "ident" && t.value === "return") {
      next();
      let expr = null;
      if (!match("punc", ";") && peek() && peek().value !== "}") {
        expr = parseExpression();
        match("punc", ";");
      }
      return { type: "Return", expr };
    }
    if (t.type === "ident" && t.value === "if") {
      next();
      expect("(");
      const test = parseExpression();
      expect(")");
      const cons = parseStatement();
      let alt = null;
      if (match("ident", "else")) alt = parseStatement();
      return { type: "If", test, cons, alt };
    }
    if (t.type === "ident" && t.value === "for") {
      next();
      expect("(");
      if (peek() && (peek().value === "var" || peek().value === "let")) next();
      const id = next().value;
      if (match("ident", "in")) {
        const obj = parseExpression();
        expect(")");
        const body = parseStatement();
        return { type: "ForIn", id, obj, body };
      }
      throw new Error("Only for-in loop supported currently");
    }
    if (t.type === "ident" && t.value === "with") {
      next();
      expect("(");
      const withObj = parseExpression();
      expect(")");
      const body = parseStatement();
      return { type: "With", withObj, body };
    }
    if (t.type === "ident" && t.value === "function") {
      next();
      const name = next().value;
      expect("(");
      const params: string[] = [];
      if (!match("punc", ")")) {
        while (true) {
          params.push(next().value);
          if (match("punc", ",")) continue;
          expect(")");
          break;
        }
      }
      const body = parseBlock();
      return { type: "FunctionDecl", name, params, body };
    }
    if (t.value === "{") return parseBlock();
    if (match("punc", ";")) return { type: "Empty" };

    const expr = parseExpression();
    match("punc", ";");
    return { type: "ExprStmt", expr };
  }

  const program: any[] = [];
  while (pos < tokens.length) {
    program.push(parseStatement());
  }

  async function evalNode(node: any, scope: Scope): Promise<any> {
    if (!node) return undefined;
    switch (node.type) {
      case "Empty": return undefined;
      case "Literal": return node.value;
      case "Identifier": return scope.get(node.name);
      case "ArrayLiteral": {
        const arr: any[] = [];
        for (const e of node.elements) arr.push(await evalNode(e, scope));
        return arr;
      }
      case "ObjectLiteral": {
        const obj: Record<string, any> = {};
        for (const p of node.properties) {
          obj[p.key] = await evalNode(p.val, scope);
        }
        return obj;
      }
      case "Member": {
        const obj = await evalNode(node.object, scope);
        if (obj == null) return undefined;
        const prop = node.computed ? await evalNode(node.property, scope) : node.property;
        return obj[prop];
      }
      case "New": {
        const callee = node.expr.type === "Call" ? await evalNode(node.expr.callee, scope) : await evalNode(node.expr, scope);
        const args: any[] = [];
        if (node.expr.type === "Call") {
          for (const a of node.expr.args) args.push(await evalNode(a, scope));
        }
        if (typeof callee === "function") {
          return new callee(...args);
        }
        return {};
      }
      case "Call": {
        let fn: any, thisArg: any = null;
        if (node.callee.type === "Member") {
          thisArg = await evalNode(node.callee.object, scope);
          const prop = node.callee.computed ? await evalNode(node.callee.property, scope) : node.callee.property;
          fn = thisArg != null ? thisArg[prop] : undefined;
        } else {
          fn = await evalNode(node.callee, scope);
        }
        if (typeof fn !== "function") {
          throw new Error("Callee is not a function: " + (node.callee.name || JSON.stringify(node.callee)));
        }
        const args: any[] = [];
        for (const a of node.args) {
          if (a.type === "ArrowFunction" || a.type === "FunctionExpr") {
            args.push((...argVals: any[]) => {
              const fnScope = new Scope(scope);
              a.params.forEach((p: string, idx: number) => { fnScope.vars[p] = argVals[idx]; });
              return (async () => {
                if (a.body.type === "Block") {
                  const res = await evalBlock(a.body, fnScope);
                  return res && res.__isReturn ? res.value : res;
                }
                return await evalNode(a.body, fnScope);
              })();
            });
          } else {
            args.push(await evalNode(a, scope));
          }
        }
        const ret = fn.apply(thisArg, args);
        return ret instanceof Promise ? await ret : ret;
      }
      case "Binary": {
        const left = await evalNode(node.left, scope);
        if (node.op === "&&") return left && (await evalNode(node.right, scope));
        if (node.op === "||") return left || (await evalNode(node.right, scope));
        const right = await evalNode(node.right, scope);
        if (node.op === "+") return left + right;
        if (node.op === "-") return left - right;
        if (node.op === "*") return left * right;
        if (node.op === "/") return left / right;
        if (node.op === "%") return left % right;
        if (node.op === "==") return left == right;
        if (node.op === "===") return left === right;
        if (node.op === "!=") return left != right;
        if (node.op === "!==") return left !== right;
        if (node.op === "<") return left < right;
        if (node.op === "<=") return left <= right;
        if (node.op === ">") return left > right;
        if (node.op === ">=") return left >= right;
        if (node.op === "instanceof") return left instanceof right;
        return undefined;
      }
      case "Unary": {
        if (node.op === "typeof") {
          try {
            const v = await evalNode(node.expr, scope);
            return typeof v;
          } catch { return "undefined"; }
        }
        const val = await evalNode(node.expr, scope);
        if (node.op === "!") return !val;
        if (node.op === "-") return -val;
        return undefined;
      }
      case "Ternary": {
        const test = await evalNode(node.test, scope);
        return test ? await evalNode(node.cons, scope) : await evalNode(node.alt, scope);
      }
      case "Assign": {
        const right = await evalNode(node.right, scope);
        if (node.left.type === "Identifier") {
          let finalVal = right;
          const cur = scope.get(node.left.name);
          if (node.op === "+=") finalVal = (cur !== undefined ? cur : (typeof right === "number" ? 0 : "")) + right;
          if (node.op === "-=") finalVal = (cur !== undefined ? cur : 0) - right;
          scope.set(node.left.name, finalVal);
          return finalVal;
        }
        if (node.left.type === "Member") {
          const obj = await evalNode(node.left.object, scope);
          const prop = node.left.computed ? await evalNode(node.left.property, scope) : node.left.property;
          let finalVal = right;
          const cur = obj != null ? obj[prop] : undefined;
          if (node.op === "+=") finalVal = (cur !== undefined ? cur : (typeof right === "number" ? 0 : "")) + right;
          if (node.op === "-=") finalVal = (cur !== undefined ? cur : 0) - right;
          if (obj != null) obj[prop] = finalVal;
          return finalVal;
        }
        return right;
      }
      case "VarDecl": {
        for (const d of node.decls) {
          const val = d.init ? await evalNode(d.init, scope) : undefined;
          scope.vars[d.id] = val;
        }
        return undefined;
      }
      case "FunctionDecl":
      case "FunctionExpr": {
        const fn = function (...argVals: any[]) {
          const fnScope = new Scope(scope);
          node.params.forEach((p: string, idx: number) => { fnScope.vars[p] = argVals[idx]; });
          return (async () => {
            const res = await evalBlock(node.body, fnScope);
            return res && res.__isReturn ? res.value : res;
          })();
        };
        if (node.name) {
          if (scope.isWith && scope.parent) scope.parent.set(node.name, fn);
          else scope.set(node.name, fn);
        }
        return fn;
      }
      case "Return": {
        const val = node.expr ? await evalNode(node.expr, scope) : undefined;
        return { __isReturn: true, value: val };
      }
      case "If": {
        const test = await evalNode(node.test, scope);
        if (test) return await evalNode(node.cons, scope);
        else if (node.alt) return await evalNode(node.alt, scope);
        return undefined;
      }
      case "ForIn": {
        const obj = await evalNode(node.obj, scope);
        if (obj) {
          for (const k in obj) {
            scope.set(node.id, k);
            const res = await evalNode(node.body, scope);
            if (res && res.__isReturn) return res;
          }
        }
        return undefined;
      }
      case "With": {
        const withObj = await evalNode(node.withObj, scope);
        const withScope = new Scope(scope);
        withScope.isWith = true;
        if (withObj && typeof withObj === "object") {
          for (const k in withObj) withScope.vars[k] = withObj[k];
        }
        return await evalNode(node.body, withScope);
      }
      case "Block": return await evalBlock(node, scope);
      case "ExprStmt": return await evalNode(node.expr, scope);
    }
  }

  async function evalBlock(blockNode: any, scope: Scope): Promise<any> {
    let lastVal = undefined;
    for (const stmt of blockNode.stmts) {
      const res = await evalNode(stmt, scope);
      if (res && res.__isReturn) return res;
      lastVal = res;
    }
    return lastVal;
  }

  let finalResult: any = undefined;
  for (const stmt of program) {
    const res = await evalNode(stmt, rootScope);
    if (res && res.__isReturn) {
      finalResult = res.value;
      break;
    }
    if (res !== undefined) {
      finalResult = res;
    }
  }
  return finalResult;
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

  // Try AsyncFunction first if permitted by environment
  try {
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
    const fn = new AsyncFunction(...argNames, bodyCode);
    return await fn(...argValues);
  } catch (err: any) {
    // If dynamic code generation is disabled (Cloudflare Workers) or syntax error:
    // Fall back to pure AST interpreter
    try {
      return await interpretLegadoJs(cleanCode, env);
    } catch (interpErr: any) {
      console.warn("Legado JS execution error:", interpErr.message);
      return context.result;
    }
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

  // If ruleUrl starts with @js: or contains <js>, evaluate dynamic JavaScript first
  if (rawUrl.startsWith("@js:") || rawUrl.includes("<js>")) {
    try {
      const jsRes = await executeLegadoJs(rawUrl, {
        source,
        baseUrl,
        key,
        page,
      });
      if (typeof jsRes === "string") {
        rawUrl = jsRes.trim();
      }
    } catch (err: any) {
      console.warn("analyzeUrl dynamic JS execution error:", err.message);
    }
  }

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

      let template = ruleSearch.bookUrl || "$.bookUrl";
      if (template.includes("{{")) {
        const regex = /\{\{([\s\S]*?)\}\}/g;
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
          template = template.replace(bm[0], val);
        }
      }

      if (template.startsWith("@js:") || template.includes("<js>")) {
        const jsRes = await executeLegadoJs(template, { source, baseUrl, result: item });
        if (typeof jsRes === "string") {
          bookUrl = jsRes.trim();
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
    if (bookUrl.includes(",{") || bookUrl.includes(", {")) {
      const idx = bookUrl.indexOf(",{") !== -1 ? bookUrl.indexOf(",{") : bookUrl.indexOf(", {");
      bookUrl = bookUrl.substring(0, idx).trim();
    }
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
    let extracted = jsonpathQuery(data, listRule || "$.data.chapters");
    if (!extracted || extracted.length === 0) {
      if (data.data?.chapter_lists) extracted = data.data.chapter_lists;
      else if (data.chapter_lists) extracted = data.chapter_lists;
    }
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
        url = String(jsonpathFirstString(ch, urlRule) || ch.url || ch.link || ch.path || ch.id || "");
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

  if (contentRule.includes("@js:") || contentRule.includes("<js>")) {
    const jsPart = contentRule.includes("@js:") ? contentRule.split("@js:")[1] : contentRule;
    const jsRes = await executeLegadoJs(jsPart, {
      source,
      baseUrl: chapterUrl,
      result: body,
    });
    if (jsRes && typeof jsRes === "string" && jsRes.trim().length > 0) {
      body = jsRes;
    }
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

  // Check for SecretKeySpec AES decryption (e.g. Qimao / Legado JavaImporter AES)
  const keyMatch = contentRule.match(/SecretKeySpec\s*\(\s*(?:String\s*\(\s*)?["']([^"']+)["']/i);
  if (keyMatch) {
    try {
      const keyStr = keyMatch[1];
      let b64 = body.trim();
      if (b64.startsWith("{") || b64.startsWith("[")) {
        try {
          const j = JSON.parse(b64);
          b64 = j.data?.content || j.content || b64;
        } catch {}
      }
      const rawBytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const iv = rawBytes.subarray(0, 16);
      const encData = rawBytes.subarray(16);
      const keyBytes = new TextEncoder().encode(keyStr);
      const cryptoKey = await crypto.subtle.importKey("raw", keyBytes, { name: "AES-CBC" }, false, ["decrypt"]);
      const decryptedBuf = await crypto.subtle.decrypt({ name: "AES-CBC", iv }, cryptoKey, encData);
      body = new TextDecoder().decode(decryptedBuf);
      return body;
    } catch (err: any) {
      console.warn("Direct SecretKeySpec AES decryption error:", err.message);
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
