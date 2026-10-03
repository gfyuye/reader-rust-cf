import { getBookmarks, deleteBookmarks, saveBookmarks } from '../api/bookmark'
import {
  deleteBookGroup,
  deleteBooks,
  getBookGroups,
  getBookshelf,
  saveBooks,
  saveBookGroup,
} from '../api/bookshelf'
import { getReplaceRules, deleteReplaceRules, saveReplaceRules } from '../api/replaceRule'
import { getRssSources, deleteRssSource, saveRssSources } from '../api/rss'
import {
  deleteAllBookSources,
  getBookSources,
  saveBookSources,
} from '../api/source'
import type { Book, BookGroup, Bookmark, BookSource, ReplaceRule, RssSource } from '../types'
import { createZipArchive, unzipArchive } from './zip'

const BACKUP_VERSION = 1
const LOCAL_STORAGE_KEYS = [
  'theme',
  'reader-stats',
  'readConfig',
  'reader-themeIndex',
  'reader-isNight',
  'reader-speechConfig',
  'reader-last-session',
  'reader-currentIndex',
  'reader-source-subscriptions',
]

export interface WebdavBackupPayload {
  version: number
  createdAt: string
  app: string
  bookshelf: {
    books: Book[]
    groups: BookGroup[]
  }
  bookSources: BookSource[]
  rssSources: RssSource[]
  bookmarks: Bookmark[]
  replaceRules: ReplaceRule[]
  localState: Record<string, string>
}

function captureLocalState() {
  return LOCAL_STORAGE_KEYS.reduce<Record<string, string>>((acc, key) => {
    const value = localStorage.getItem(key)
    if (value != null) {
      acc[key] = value
    }
    return acc
  }, {})
}

function applyLocalState(localState: Record<string, string> = {}) {
  LOCAL_STORAGE_KEYS.forEach((key) => {
    const value = localState[key]
    if (value == null) {
      localStorage.removeItem(key)
    } else {
      localStorage.setItem(key, value)
    }
  })
}

/**
 * Creates standard Legado (阅读 3.0) ZIP backup archive containing individual JSON files:
 * - bookshelf.json
 * - bookGroup.json
 * - bookSource.json
 * - rssSource.json
 * - bookmark.json
 * - replaceRule.json
 * - readConfig.json
 */
export async function createLegadoBackupZip(): Promise<Uint8Array> {
  const [books, groups, bookSources, rssSources, bookmarks, replaceRules] = await Promise.all([
    getBookshelf().catch(() => []),
    getBookGroups().catch(() => []),
    getBookSources().catch(() => []),
    getRssSources().catch(() => []),
    getBookmarks().catch(() => []),
    getReplaceRules().catch(() => []),
  ])

  const files: Record<string, string> = {
    'bookshelf.json': JSON.stringify(books, null, 2),
    'bookGroup.json': JSON.stringify(groups, null, 2),
    'bookSource.json': JSON.stringify(bookSources, null, 2),
    'rssSource.json': JSON.stringify(rssSources, null, 2),
    'bookmark.json': JSON.stringify(bookmarks, null, 2),
    'replaceRule.json': JSON.stringify(replaceRules, null, 2),
    'readConfig.json': JSON.stringify(captureLocalState(), null, 2),
  }

  return createZipArchive(files)
}

/**
 * Restores backup from either standard Legado ZIP archive or legacy single JSON file.
 * Auto-detects format from magic bytes (PK\x03\x04 vs JSON text).
 */
export async function restoreBackupFromBytes(bytes: Uint8Array): Promise<void> {
  // Check ZIP signature (0x50, 0x4b, 0x03, 0x04)
  const isZip =
    bytes.length >= 4 &&
    bytes[0] === 0x50 &&
    bytes[1] === 0x4b &&
    bytes[2] === 0x03 &&
    bytes[3] === 0x04

  if (isZip) {
    const files = await unzipArchive(bytes)
    const decoder = new TextDecoder()

    // Normalize file map to index by both original path and base file name
    const normalizedFiles: Record<string, Uint8Array> = {}
    for (const [pathKey, fileData] of Object.entries(files)) {
      normalizedFiles[pathKey] = fileData
      const cleanKey = pathKey.replace(/\\/g, '/')
      const baseName = cleanKey.split('/').pop() || cleanKey
      normalizedFiles[baseName.toLowerCase()] = fileData
      normalizedFiles[baseName] = fileData
    }

    const knownKeys = [
      'bookshelf.json',
      'booksource.json',
      'bookgroup.json',
      'bookmark.json',
      'replacerule.json',
      'rsssource.json',
      'readconfig.json',
      'txttocrule.json',
      'httptts.json',
      'backup.json',
      'legado.json',
    ]

    // 1. Check if the ZIP contains an all-in-one backup file (e.g. backup.json or legado.json)
    const singleBackupData =
      normalizedFiles['backup.json'] ||
      normalizedFiles['legado.json'] ||
      normalizedFiles['my_backup.json'] ||
      Object.entries(normalizedFiles).find(([k]) => k.endsWith('.json') && !knownKeys.includes(k))?.[1]

    if (singleBackupData && !normalizedFiles['bookshelf.json']) {
      try {
        const singleText = decoder.decode(singleBackupData)
        const payload = parseWebdavBackup(singleText)
        await restoreWebdavBackup(payload)
        return
      } catch {
        // Fall through to multi-file parsing
      }
    }

    const hasAnyBackupFile = knownKeys.some((k) => k in normalizedFiles)
    if (!hasAnyBackupFile) {
      throw new Error('该 ZIP 压缩包不包含有效的阅读备份文件 (未找到 bookshelf.json / backup.json 等)')
    }

    const parseJson = <T>(name: string, fallback: T): T => {
      const data = normalizedFiles[name.toLowerCase()] || normalizedFiles[name]
      if (!data) return fallback
      try {
        return JSON.parse(decoder.decode(data)) as T
      } catch {
        return fallback
      }
    }

    const payload: WebdavBackupPayload = {
      version: BACKUP_VERSION,
      createdAt: new Date().toISOString(),
      app: 'legado-zip-backup',
      bookshelf: {
        books: parseJson<Book[]>('bookshelf.json', []),
        groups: parseJson<BookGroup[]>('bookGroup.json', []),
      },
      bookSources: parseJson<BookSource[]>('bookSource.json', []),
      rssSources: parseJson<RssSource[]>('rssSource.json', []),
      bookmarks: parseJson<Bookmark[]>('bookmark.json', []),
      replaceRules: parseJson<ReplaceRule[]>('replaceRule.json', []),
      localState: parseJson<Record<string, string>>('readConfig.json', {}),
    }

    await restoreWebdavBackup(payload)
    return
  }

  // Fallback: Legacy single JSON backup
  const text = new TextDecoder().decode(bytes)
  const payload = parseWebdavBackup(text)
  await restoreWebdavBackup(payload)
}

export function parseWebdavBackup(raw: string): WebdavBackupPayload {
  const payload = JSON.parse(raw) as Partial<WebdavBackupPayload>
  if (!payload || typeof payload !== 'object') {
    throw new Error('备份文件格式无效')
  }
  return {
    version: payload.version || BACKUP_VERSION,
    createdAt: payload.createdAt || new Date().toISOString(),
    app: payload.app || 'reader-rust-frontend',
    bookshelf: {
      books: payload.bookshelf?.books || [],
      groups: payload.bookshelf?.groups || [],
    },
    bookSources: payload.bookSources || [],
    rssSources: payload.rssSources || [],
    bookmarks: payload.bookmarks || [],
    replaceRules: payload.replaceRules || [],
    localState: payload.localState || {},
  }
}

export async function restoreWebdavBackup(payload: WebdavBackupPayload) {
  const currentGroups = await getBookGroups().catch(() => [])
  const currentBooks = await getBookshelf().catch(() => [])
  const currentBookmarks = await getBookmarks().catch(() => [])
  const currentReplaceRules = await getReplaceRules().catch(() => [])
  const currentRssSources = await getRssSources().catch(() => [])

  try {
    await Promise.allSettled([
      currentGroups.length
        ? Promise.all(currentGroups.map((group) => deleteBookGroup(group.groupId).catch(() => undefined)))
        : Promise.resolve(),
      currentBooks.length
        ? deleteBooks(currentBooks.map((book) => ({ bookUrl: book.bookUrl, origin: book.origin })) as Book[]).catch(() => undefined)
        : Promise.resolve(),
      currentBookmarks.length ? deleteBookmarks(currentBookmarks).catch(() => undefined) : Promise.resolve(),
      currentReplaceRules.length ? deleteReplaceRules(currentReplaceRules).catch(() => undefined) : Promise.resolve(),
      currentRssSources.length
        ? Promise.all(currentRssSources.map((source) => deleteRssSource({
            sourceUrl: source.sourceUrl,
            sourceName: source.sourceName,
          }).catch(() => undefined)))
        : Promise.resolve(),
      deleteAllBookSources().catch(() => undefined),
    ])
  } catch {
    // Continue restoring payload even if clearing old records had partial errors
  }

  if (payload.bookSources.length) {
    await saveBookSources(payload.bookSources)
  }
  if (payload.rssSources.length) {
    await saveRssSources(payload.rssSources)
  }
  for (const group of payload.bookshelf.groups) {
    await saveBookGroup(group)
  }
  if (payload.bookshelf.books.length) {
    await saveBooks(payload.bookshelf.books)
  }
  if (payload.bookmarks.length) {
    await saveBookmarks(payload.bookmarks)
  }
  if (payload.replaceRules.length) {
    await saveReplaceRules(payload.replaceRules)
  }

  applyLocalState(payload.localState)
}
