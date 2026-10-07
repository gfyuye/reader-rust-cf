/**
 * Legado (阅读 3.0) Book Source Engine for Cloudflare Workers
 * Native TypeScript implementation running on Cloudflare Workers V8
 * Zero WASM, zero C++ binaries, zero cold-start latency.
 */

// ==========================================
// 1. Cryptographic and Encoding Utilities
// ==========================================

export function md5Hex(str: string): string {
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

  const utf8 = new TextEncoder().encode(str);
  const nWords = (((utf8.length + 8) >> 6) + 1) * 16;
  const words = new Int32Array(nWords);
  for (let i = 0; i < utf8.length; i++) {
    words[i >> 2] |= utf8[i] << ((i % 4) * 8);
  }
  words[utf8.length >> 2] |= 0x80 << ((utf8.length % 4) * 8);
  words[nWords - 2] = utf8.length * 8;

  let a = 1732584193;
  let b = -271733879;
  let c = -1732584194;
  let d = 271733878;

  for (let i = 0; i < nWords; i += 16) {
    const aa = a, bb = b, cc = c, dd = d;
    a = FF(a, b, c, d, words[i + 0], 7, -680876936);
    d = FF(d, a, b, c, words[i + 1], 12, -389564586);
    c = FF(c, d, a, b, words[i + 2], 17, 606105819);
    b = FF(b, c, d, a, words[i + 3], 22, -1044525330);
    a = FF(a, b, c, d, words[i + 4], 7, -176418897);
    d = FF(d, a, b, c, words[i + 5], 12, 1200080426);
    c = FF(c, d, a, b, words[i + 6], 17, -1473231341);
    b = FF(b, c, d, a, words[i + 7], 22, -45705983);
    a = FF(a, b, c, d, words[i + 8], 7, 1770035416);
    d = FF(d, a, b, c, words[i + 9], 12, -1958414417);
    c = FF(c, d, a, b, words[i + 10], 17, -42063);
    b = FF(b, c, d, a, words[i + 11], 22, -1990404162);
    a = FF(a, b, c, d, words[i + 12], 7, 1804603682);
    d = FF(d, a, b, c, words[i + 13], 12, -40341101);
    c = FF(c, d, a, b, words[i + 14], 17, -1502002290);
    b = FF(b, c, d, a, words[i + 15], 22, 1236535329);

    a = GG(a, b, c, d, words[i + 1], 5, -165796510);
    d = GG(d, a, b, c, words[i + 6], 9, -1069501632);
    c = GG(c, d, a, b, words[i + 11], 14, 643717713);
    b = GG(b, c, d, a, words[i + 0], 20, -373897302);
    a = GG(a, b, c, d, words[i + 5], 5, -701558691);
    d = GG(d, a, b, c, words[i + 10], 9, 38016083);
    c = GG(c, d, a, b, words[i + 15], 14, -660478335);
    b = GG(b, c, d, a, words[i + 4], 20, -405537848);
    a = GG(a, b, c, d, words[i + 9], 5, 568446438);
    d = GG(d, a, b, c, words[i + 14], 9, -1019803690);
    c = GG(c, d, a, b, words[i + 3], 14, -187363961);
    b = GG(b, c, d, a, words[i + 8], 20, 1163531501);
    a = GG(a, b, c, d, words[i + 13], 5, -1444681467);
    d = GG(d, a, b, c, words[i + 2], 9, -51403784);
    c = GG(c, d, a, b, words[i + 7], 14, 1735328473);
    b = GG(b, c, d, a, words[i + 12], 20, -1926607734);

    a = HH(a, b, c, d, words[i + 5], 4, -378558);
    d = HH(d, a, b, c, words[i + 8], 11, -2022574463);
    c = HH(c, d, a, b, words[i + 11], 16, 1839030562);
    b = HH(b, c, d, a, words[i + 14], 23, -35309556);
    a = HH(a, b, c, d, words[i + 1], 4, -1530992060);
    d = HH(d, a, b, c, words[i + 4], 11, 1272893353);
    c = HH(c, d, a, b, words[i + 7], 16, -155497632);
    b = HH(b, c, d, a, words[i + 10], 23, -1094730640);
    a = HH(a, b, c, d, words[i + 13], 4, 681279174);
    d = HH(d, a, b, c, words[i + 0], 11, -358537222);
    c = HH(c, d, a, b, words[i + 3], 16, -722521979);
    b = HH(b, c, d, a, words[i + 6], 23, 76029189);
    a = HH(a, b, c, d, words[i + 9], 4, -640364487);
    d = HH(d, a, b, c, words[i + 12], 11, -421815835);
    c = HH(c, d, a, b, words[i + 15], 16, 530742520);
    b = HH(b, c, d, a, words[i + 2], 23, -995338651);

    a = II(a, b, c, d, words[i + 0], 6, -198630844);
    d = II(d, a, b, c, words[i + 7], 10, 1126891415);
    c = II(c, d, a, b, words[i + 14], 15, -1416354905);
    b = II(b, c, d, a, words[i + 5], 21, -57434055);
    a = II(a, b, c, d, words[i + 12], 6, 1700485571);
    d = II(d, a, b, c, words[i + 3], 10, -1894986606);
    c = II(c, d, a, b, words[i + 10], 15, -1051523);
    b = II(b, c, d, a, words[i + 1], 21, -2054922799);
    a = II(a, b, c, d, words[i + 8], 6, 1873313359);
    d = II(d, a, b, c, words[i + 15], 10, -30611744);
    c = II(c, d, a, b, words[i + 6], 15, -1560198380);
    b = II(b, c, d, a, words[i + 13], 21, 1309151649);
    a = II(a, b, c, d, words[i + 4], 6, -145523070);
    d = II(d, a, b, c, words[i + 11], 10, -1120210379);
    c = II(c, d, a, b, words[i + 2], 15, 718787259);
    b = II(b, c, d, a, words[i + 9], 21, -343485551);

    a = addUnsigned(a, aa);
    b = addUnsigned(b, bb);
    c = addUnsigned(c, cc);
    d = addUnsigned(d, dd);
  }

  function wordToHex(value: number) {
    let hex = "";
    for (let i = 0; i < 4; i++) {
      const byte = (value >>> (i * 8)) & 0xff;
      hex += (byte < 16 ? "0" : "") + byte.toString(16);
    }
    return hex;
  }
  return (wordToHex(a) + wordToHex(b) + wordToHex(c) + wordToHex(d)).toLowerCase();
}

export async function aesDecryptCbc(
  base64Cipher: string,
  keyBytes: Uint8Array,
  ivBytes: Uint8Array
): Promise<Uint8Array> {
  const binaryString = atob(base64Cipher.replace(/\s+/g, ""));
  const len = binaryString.length;
  const cipherBytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) cipherBytes[i] = binaryString.charCodeAt(i);

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

// ==========================================
// 2. Legado JavaScript Sandbox (Rhino/QuickJS Compatibility)
// ==========================================

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
      const bStr = atob(String(str));
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
        let pad = b64.trim().replace(/-/g, "+").replace(/_/g, "/");
        while (pad.length % 4 !== 0) pad += "=";
        const key = new TextEncoder().encode(keyStr);
        const iv = new TextEncoder().encode(ivStr);
        const dec = await aesDecryptCbc(pad, key, iv);
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

  // Strip leading @js: or <js>...</js>
  if (cleanCode.startsWith("@js:")) cleanCode = cleanCode.substring(4).trim();
  cleanCode = cleanCode.replace(/^<js>\s*/i, "").replace(/\s*<\/js>$/i, "");

  // Fix relaxed parameter syntax: .map([a,b]=> -> .map(([a,b])=>
  cleanCode = cleanCode.replace(/(\.map\s*\()\s*(\[[^\]]+\])\s*=>/g, "$1($2) =>");

  // Construct sandbox execution scope
  const argNames = Object.keys(env);
  const argValues = Object.values(env);

  try {
    const fn = new Function(
      ...argNames,
      `
      let result = typeof result !== 'undefined' ? result : '';
      try {
        ${cleanCode}
      } catch (e) {
        // Return result if already modified
      }
      return typeof result !== 'undefined' ? result : '';
    `
    );
    const res = fn(...argValues);
    return res instanceof Promise ? await res : res;
  } catch (err: any) {
    console.warn("Legado JS execution error:", err.message);
    return context.result;
  }
}

// ==========================================
// 3. JSONPath & Rule Evaluation
// ==========================================

export function evaluateJsonPath(obj: any, path: string): any {
  if (!obj || !path) return null;
  const cleanPath = path.trim();

  if (cleanPath === "$" || cleanPath === "@") return obj;

  // Split multiple alternatives: $.a || $.b
  if (cleanPath.includes("||")) {
    const parts = cleanPath.split("||");
    for (const part of parts) {
      const val = evaluateJsonPath(obj, part.trim());
      if (val !== null && val !== undefined && (!Array.isArray(val) || val.length > 0)) {
        return val;
      }
    }
    return null;
  }

  // Handle recursive descent: $..content
  if (cleanPath.startsWith("$..")) {
    const key = cleanPath.substring(3).trim();
    const results: any[] = [];
    const traverse = (o: any) => {
      if (!o || typeof o !== "object") return;
      if (Array.isArray(o)) {
        for (const item of o) traverse(item);
      } else {
        for (const [k, v] of Object.entries(o)) {
          if (k.toLowerCase() === key.toLowerCase()) {
            results.push(v);
          } else {
            traverse(v);
          }
        }
      }
    };
    traverse(obj);
    return results.length === 1 ? results[0] : results.length > 1 ? results : null;
  }

  // Handle standard dot path: $.data.list[*] or data.list
  const normalized = cleanPath.replace(/^\$\.?/, "").replace(/\[\*\]/g, "");
  const segments = normalized.split(".").filter(Boolean);

  let current = obj;
  for (const seg of segments) {
    if (current == null) return null;
    if (Array.isArray(current)) {
      current = current.map((item) => (item && typeof item === "object" ? item[seg] : null)).filter(Boolean);
    } else if (typeof current === "object") {
      current = current[seg];
    } else {
      return null;
    }
  }

  return current;
}

// ==========================================
// 4. Legado Template Evaluator: {{ ... }}
// ==========================================

export async function evaluateLegadoTemplate(
  template: string,
  data: any,
  context: LegadoContext = {}
): Promise<string> {
  if (!template || !template.includes("{{")) return template;

  const regex = /\{\{([\s\S]*?)\}\}/g;
  let result = template;
  let match;

  while ((match = regex.exec(template)) !== null) {
    const fullMatch = match[0];
    const expr = match[1].trim();

    let val = "";
    if (expr.startsWith("$.") || expr.startsWith("$..") || expr === "$") {
      val = String(evaluateJsonPath(data, expr) ?? "");
    } else if (expr.includes("source.getKey()") || expr.includes("java.")) {
      const jsRes = await executeLegadoJs(expr, { ...context, result: data });
      val = String(jsRes ?? "");
    } else {
      const fieldVal = data?.[expr] ?? evaluateJsonPath(data, expr);
      val = String(fieldVal ?? "");
    }

    result = result.replace(fullMatch, val);
  }

  return result;
}

// ==========================================
// 5. High-Level Engine Operations
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

/**
 * Parses search result responses into normalized books using book source rules
 */
export async function parseSearchResultsWithRules(
  rawText: string,
  source: any,
  baseUrl: string,
  keyword: string
): Promise<ParsedBookItem[]> {
  const books: ParsedBookItem[] = [];
  const ruleSearch = source.ruleSearch || {};

  // 1. Check if response is JSON or JS-executable
  let data: any = null;
  const trimmed = rawText.trim();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      data = JSON.parse(trimmed);
    } catch {}
  }

  // 2. If ruleSearch.bookList has <js>...</js>, execute it
  let bookListRule = ruleSearch.bookList || "$.data.list";
  if (bookListRule.includes("<js>")) {
    const jsMatch = bookListRule.match(/<js>([\s\S]*?)<\/js>/i);
    if (jsMatch) {
      const jsCode = jsMatch[1];
      const jsRes = await executeLegadoJs(jsCode, {
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

  // 3. Extract items array
  let items: any[] = [];
  if (data) {
    const extracted = evaluateJsonPath(data, bookListRule);
    if (Array.isArray(extracted)) {
      items = extracted;
    } else if (extracted && typeof extracted === "object") {
      items = [extracted];
    }
  }

  // 4. Map each book item
  const baseDomain = new URL(baseUrl).origin;
  for (const item of items.slice(0, 30)) {
    let name = String(evaluateJsonPath(item, ruleSearch.name || "$.title") || item.title || item.name || "").trim();
    if (!name) continue;

    let author = String(evaluateJsonPath(item, ruleSearch.author || "$.author") || item.author || "未知作者").trim();
    let coverUrl = String(evaluateJsonPath(item, ruleSearch.coverUrl || "$.cover") || item.coverImg || item.cover || "").trim();
    let intro = String(evaluateJsonPath(item, ruleSearch.intro || "$.desc") || item.desc || item.intro || "").trim();
    let kind = String(evaluateJsonPath(item, ruleSearch.kind || "$.category") || item.category || "网络小说").trim();
    let wordCount = String(evaluateJsonPath(item, ruleSearch.wordCount || "$.word") || item.word || "").trim();

    // Evaluate bookUrl template (e.g. {{source.getKey().replace(...)}}/{{$.book_id}}.html)
    let bookUrlTemplate = ruleSearch.bookUrl || "$.bookUrl";
    let bookUrl = "";
    if (bookUrlTemplate.includes("{{")) {
      bookUrl = await evaluateLegadoTemplate(bookUrlTemplate, item, { source, baseUrl, result: item });
    } else {
      bookUrl = String(evaluateJsonPath(item, bookUrlTemplate) || item.bookUrl || item.url || "").trim();
    }

    if (bookUrl.startsWith("/")) bookUrl = `${baseDomain}${bookUrl}`;

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

/**
 * Parses chapter list responses into normalized chapters using ruleToc
 */
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

  // 1. If ruleToc.chapterList has @js: or <js>, execute it
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

  // 2. Extract chapters array
  let rawChapters: any[] = [];
  if (data) {
    const extracted = evaluateJsonPath(data, listRule || "$.data.chapters");
    if (Array.isArray(extracted)) {
      rawChapters = extracted;
    } else if (Array.isArray(data)) {
      rawChapters = data;
    }
  }

  // 3. Process each chapter
  const baseDomain = new URL(targetUrl).origin;
  for (let idx = 0; idx < rawChapters.length; idx++) {
    const ch = rawChapters[idx];

    // Chapter Name rule with potential @js pipe
    let nameRule = ruleToc.chapterName || "name";
    let title = "";
    if (nameRule.includes("@js:")) {
      const [fieldRule, jsPart] = nameRule.split("@js:");
      const rawVal = evaluateJsonPath(ch, fieldRule.trim()) || ch.name || ch.title || "";
      title = await executeLegadoJs(jsPart, {
        source,
        baseUrl: targetUrl,
        result: String(rawVal),
      });
    } else {
      title = String(evaluateJsonPath(ch, nameRule) || ch.name || ch.title || `第 ${idx + 1} 章`);
    }

    // Chapter URL rule
    let urlRule = ruleToc.chapterUrl || "url";
    let url = "";
    if (urlRule.includes("{{")) {
      url = await evaluateLegadoTemplate(urlRule, ch, { source, baseUrl: targetUrl, result: ch });
    } else {
      url = String(evaluateJsonPath(ch, urlRule) || ch.url || ch.link || ch.path || "");
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

/**
 * Extracts clean chapter text using ruleContent
 */
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
      const extracted = evaluateJsonPath(j, contentRule.split("@js:")[0]);
      if (extracted) {
        body = Array.isArray(extracted) ? extracted.join("\n") : String(extracted);
      }
    } catch {}
  }

  // If rule has @js: pipe
  if (contentRule.includes("@js:")) {
    const jsPart = contentRule.split("@js:")[1];
    const jsRes = await executeLegadoJs(jsPart, {
      source,
      baseUrl: chapterUrl,
      result: body,
    });
    if (jsRes) body = String(jsRes);
  }

  return body;
}
