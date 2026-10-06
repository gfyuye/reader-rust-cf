export interface ExploreCategory {
  title: string
  url: string
}

export function parseExploreCategories(rule?: string | null): ExploreCategory[] {
  const trimmedRule = rule?.trim()
  if (!trimmedRule) return []

  if (trimmedRule.startsWith('@js:')) {
    try {
      let code = trimmedRule.substring(4).trim()
      code = code.replace(/(\.map\s*\()\s*(\[[^\]]+\])\s*=>/g, '$1($2) =>')
      const fn = new Function('source', 'baseUrl', `
        let sort = [];
        let result = '';
        ${code}
        if (typeof sort !== 'undefined' && Array.isArray(sort) && sort.length > 0) {
          if (typeof sort[0] === 'string') {
            return "[" + sort.toString() + "]";
          }
          return JSON.stringify(sort);
        }
        return typeof result !== 'undefined' ? result : '';
      `)
      const evaluated = fn({ getKey: () => '' }, '')
      if (typeof evaluated === 'string' && evaluated.trim().startsWith('[')) {
        return parseExploreCategories(evaluated)
      }
    } catch {
      // Fall through
    }

    // Regex extraction fallback for push(title, url) in @js: rules
    const pushRegex = /push\(\s*["'`]([^"'`]+)["'`]\s*,\s*(?:["'`]([^"'`]+)["'`]|([^,)]+))/g
    let match
    const categories: ExploreCategory[] = []
    while ((match = pushRegex.exec(trimmedRule)) !== null) {
      const title = match[1].trim()
      const rawUrl = (match[2] || match[3] || '').trim()
      if (title && rawUrl && rawUrl !== 'null' && rawUrl !== 'undefined') {
        const cleanUrl = rawUrl.replace(/^["'`]|["'`]$/g, '').trim()
        if (cleanUrl.startsWith('http') || cleanUrl.startsWith('/')) {
          categories.push({ title, url: cleanUrl })
        }
      }
    }
    if (categories.length > 0) return categories
  }

  try {
    if (trimmedRule.startsWith('[')) {
      const parsed = JSON.parse(normalizeRelaxedExploreJson(trimmedRule))
      if (Array.isArray(parsed)) {
        return parsed
          .map((item) => ({
            title: String(item?.title || '').trim(),
            url: String(item?.url || '').trim(),
          }))
          .filter((item) => item.title)
      }
    }
  } catch {
    // Fall back to the plain text parser below.
  }

  return trimmedRule
    .split(/\n|<br>/i)
    .map((line) => line.trim())
    .filter(Boolean)
    .flatMap((line) => {
      if (!line.includes('::')) return []
      const [title, url] = line.split('::').map((part) => part.trim())
      return title ? [{ title, url: url || '' }] : []
    })
}

function normalizeRelaxedExploreJson(rule: string) {
  let normalized = ''
  let inString = false
  let quote = ''
  let escaped = false

  for (const char of rule) {
    if (inString) {
      normalized += char
      if (escaped) {
        escaped = false
      } else if (char === '\\') {
        escaped = true
      } else if (char === quote) {
        inString = false
      }
      continue
    }

    if (char === '"' || char === "'") {
      inString = true
      quote = char
      normalized += char
    } else if (char === '<') {
      normalized += '{'
    } else if (char === '>') {
      normalized += '}'
    } else {
      normalized += char
    }
  }

  return normalized
}

export function isExploreCategorySection(category: ExploreCategory) {
  return !category.url.trim()
}

export function getInitialExploreCategoryUrl(categories: ExploreCategory[]) {
  return categories.find((category) => !isExploreCategorySection(category))?.url || ''
}

export function getExploreCategoryKey(category: ExploreCategory, index: number) {
  return `${category.url || 'section'}:${index}:${category.title}`
}
