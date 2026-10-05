import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import {
  getBookshelfWithCacheInfo,
  getBookGroups,
  deleteBook as apiDeleteBook,
  deleteBooks as apiDeleteBooks,
  saveBookGroupId as apiSaveBookGroupId,
  saveBookGroup as apiSaveBookGroup,
  deleteBookGroup as apiDeleteBookGroup,
  saveBooks as apiSaveBooks,
} from '../api/bookshelf'
import type { Book, BookGroup, SearchBook } from '../types'
import { deleteBrowserBookCache, listBrowserCacheSummary } from '../utils/browserCache'
import { isLocalBook } from '../utils/localBook'
import { clearRecentReadBooks, getRecentReadBookKey, loadRecentReadBooks, removeRecentReadBook } from '../utils/recentBooks'

export function sortBooksByLatestReadAndName(list: Book[]): Book[] {
  if (list.length <= 1) return list.slice()

  let latestIndex = -1
  let latestTime = 0

  for (let i = 0; i < list.length; i++) {
    const t = list[i].durChapterTime || 0
    if (t > latestTime) {
      latestTime = t
      latestIndex = i
    }
  }

  let latestBook: Book | null = null
  let others: Book[] = []

  if (latestIndex >= 0 && latestTime > 0) {
    latestBook = list[latestIndex]
    others = list.filter((_, idx) => idx !== latestIndex)
  } else {
    others = list.slice()
  }

  others.sort((a, b) =>
    (a.name || '').localeCompare(b.name || '', 'zh-Hans-CN', { numeric: true, sensitivity: 'base' })
  )

  return latestBook ? [latestBook, ...others] : others
}

export const useBookshelfStore = defineStore('bookshelf', () => {
  // ─── Bookshelf ───
  const books = ref<Book[]>([])
  const recentBooks = ref<Book[]>([])
  const loading = ref(false)
  const refreshing = ref(false)
  const sorting = ref(false)

  async function refreshRecentBooks() {
    const browserSummaries = await listBrowserCacheSummary().catch(() => [])
    const browserMap = new Map(browserSummaries.map((item) => [item.bookUrl, item.cachedChapterCount]))
    const shelfMap = new Map(books.value.map((book) => [getRecentReadBookKey(book), book]))
    recentBooks.value = loadRecentReadBooks().map((entry) => {
      const shelfBook = shelfMap.get(getRecentReadBookKey(entry))
      const merged = shelfBook
        ? {
            ...entry,
            ...shelfBook,
            recentReadAt: entry.recentReadAt,
            durChapterTime: entry.recentReadAt,
          }
        : entry
      return {
        ...merged,
        browserCachedChapterCount: isLocalBook(merged) ? 0 : browserMap.get(merged.bookUrl) || merged.browserCachedChapterCount || 0,
      }
    })
  }

  async function removeRecentBook(book: Pick<Book, 'bookUrl' | 'origin'>) {
    removeRecentReadBook(book)
    await refreshRecentBooks()
  }

  async function clearAllRecentBooks() {
    clearRecentReadBooks()
    await refreshRecentBooks()
  }

  async function fetchBooks() {
    loading.value = true
    try {
      const [serverBooks, browserSummaries] = await Promise.all([
        getBookshelfWithCacheInfo(),
        listBrowserCacheSummary().catch(() => []),
      ])
      const browserMap = new Map(browserSummaries.map((item) => [item.bookUrl, item.cachedChapterCount]))
      const rawMapped = serverBooks.map((book) => ({
        ...book,
        browserCachedChapterCount: isLocalBook(book) ? 0 : browserMap.get(book.bookUrl) || 0,
      }))
      books.value = sortBooksByLatestReadAndName(rawMapped)
      await refreshRecentBooks()
    } finally {
      loading.value = false
    }
  }

  async function refreshBooks() {
    refreshing.value = true
    try {
      const [serverBooks, browserSummaries] = await Promise.all([
        getBookshelfWithCacheInfo(),
        listBrowserCacheSummary().catch(() => []),
      ])
      const browserMap = new Map(browserSummaries.map((item) => [item.bookUrl, item.cachedChapterCount]))
      const rawMapped = serverBooks.map((book) => ({
        ...book,
        browserCachedChapterCount: isLocalBook(book) ? 0 : browserMap.get(book.bookUrl) || 0,
      }))
      books.value = sortBooksByLatestReadAndName(rawMapped)
      await refreshRecentBooks()
    } finally {
      refreshing.value = false
    }
  }

  async function removeBook(book: Book) {
    await apiDeleteBook(book)
    await deleteBrowserBookCache(book.bookUrl).catch(() => undefined)
    books.value = books.value.filter((b) => b.bookUrl !== book.bookUrl)
    await refreshRecentBooks()
  }

  // ─── Groups ───
  const groups = ref<BookGroup[]>([])
  const activeGroupId = ref<number>(-1) // -1 = all

  function ensureSystemGroups(raw: BookGroup[]): BookGroup[] {
    const list: BookGroup[] = []
    const seenIds = new Set<number>()
    const seenNames = new Set<string>()

    // Standardize orderNo / order property and deduplicate
    for (const g of raw || []) {
      if (!g) continue
      const gId = Number(g.groupId ?? 0)
      const gName = (g.groupName || '').trim()
      const order = Number(g.orderNo ?? (g as any).order ?? 0)

      // Normalize "全部"
      if (gId === -1 || gName === '全部') {
        if (!seenNames.has('全部')) {
          seenNames.add('全部')
          seenIds.add(-1)
          list.push({ ...g, groupId: -1, groupName: '全部', orderNo: order || -100, show: true, hidden: false })
        }
        continue
      }

      // Normalize "未分组"
      if (gId === -4 || gId === 0 || gName === '未分组') {
        if (!seenNames.has('未分组')) {
          seenNames.add('未分组')
          seenIds.add(-4)
          list.push({ ...g, groupId: -4, groupName: '未分组', orderNo: order || 900 })
        }
        continue
      }

      if (!seenIds.has(gId) && !seenNames.has(gName)) {
        seenIds.add(gId)
        seenNames.add(gName)
        list.push({ ...g, groupId: gId, groupName: gName, orderNo: order })
      }
    }

    // Ensure "全部" exists
    if (!seenNames.has('全部')) {
      list.unshift({ groupId: -1, groupName: '全部', orderNo: -100, show: true, hidden: false })
    }

    // Ensure "未分组" exists
    if (!seenNames.has('未分组')) {
      list.push({ groupId: -4, groupName: '未分组', orderNo: 900 })
    }

    list.sort((a, b) => (a.orderNo ?? 0) - (b.orderNo ?? 0))
    return list
  }

  const displayGroups = computed(() => {
    return groups.value.filter((g) => {
      if (g.groupId === -1) return !g.hidden
      return !g.hidden && g.show !== false
    })
  })

  const filteredBooks = computed(() => {
    if (activeGroupId.value === -1) return books.value
    if (activeGroupId.value === -4 || activeGroupId.value === 0) {
      return books.value.filter((b) => !b.group || b.group === 0 || b.group === -4 || b.group === -5)
    }
    if (activeGroupId.value === -2) {
      return books.value.filter(
        (b) =>
          b.origin?.startsWith('local') ||
          b.originName?.includes('本地') ||
          b.kind?.includes('本地') ||
          (b.group && (b.group === -2 || (b.group & -2) !== 0))
      )
    }
    return books.value.filter(
      (b) => b.group && (b.group === activeGroupId.value || (b.group & activeGroupId.value) !== 0)
    )
  })

  async function fetchGroups() {
    try {
      const raw = await getBookGroups()
      groups.value = ensureSystemGroups(raw || [])
    } catch {
      groups.value = ensureSystemGroups([])
    }
  }

  async function saveGroup(groupName: string, groupId = 0) {
    if (groupId === -1 || groupId === -4 || groupId === 0) return groupId
    let existingGroup = groups.value.find((g) => g.groupId === groupId)
    if (groupId <= 0) {
      const existingIds = groups.value.map((g) => g.groupId).filter((id) => id > 0)
      let nextId = 1
      while (existingIds.includes(nextId)) {
        nextId = nextId < (1 << 30) ? nextId * 2 : nextId + 1
      }
      groupId = nextId
    }
    await apiSaveBookGroup({
      groupId,
      groupName,
      orderNo: existingGroup?.orderNo ?? groups.value.length,
      hidden: existingGroup?.hidden,
      show: existingGroup?.show,
    })
    await fetchGroups()
    return groups.value.find((group) => group.groupId === groupId)?.groupId || groupId
  }

  async function toggleGroupVisibility(groupId: number) {
    const target = groups.value.find((g) => g.groupId === groupId)
    if (!target) return
    target.hidden = !target.hidden
    if (target.hidden) target.show = false
    else target.show = true
    await apiSaveBookGroup(target)
  }

  async function removeGroup(groupId: number) {
    if (groupId === -1 || groupId === -4 || groupId === 0) return
    await apiDeleteBookGroup(groupId)
    groups.value = groups.value.filter((group) => group.groupId !== groupId)
    books.value = books.value.map((book) => {
      if (book.group && (book.group & groupId) !== 0) {
        return { ...book, group: book.group & ~groupId }
      }
      return book
    })
  }

  async function reorderGroups(fromIndex: number, toIndex: number) {
    if (fromIndex < 0 || fromIndex >= groups.value.length || toIndex < 0 || toIndex >= groups.value.length) return
    const list = groups.value.slice()
    const [moved] = list.splice(fromIndex, 1)
    list.splice(toIndex, 0, moved)

    list.forEach((g, index) => {
      g.orderNo = index
    })
    groups.value = list

    for (const g of list) {
      await apiSaveBookGroup(g).catch(() => undefined)
    }
  }

  // ─── Search ───
  const searchResults = ref<SearchBook[]>([])
  const isSearching = ref(false)
  const searchKey = ref('')
  const searchScope = ref<'all' | 'group' | 'source'>('source')
  const searchGroup = ref('')
  const searchSourceUrl = ref('')

  function startSearch(key: string, options: {
    scope?: 'all' | 'group' | 'source'
    group?: string
    sourceUrl?: string
  } = {}) {
    const nextKey = key.trim()
    if (!nextKey) {
      clearSearch()
      return
    }

    searchScope.value = options.scope || 'source'
    searchGroup.value = options.group || ''
    searchSourceUrl.value = options.sourceUrl || ''
    searchKey.value = nextKey
  }

  function clearSearch() {
    searchResults.value = []
    searchKey.value = ''
    isSearching.value = false
    searchScope.value = 'source'
    searchGroup.value = ''
    searchSourceUrl.value = ''
  }

  const isSearchMode = computed(() => searchKey.value.length > 0)

  // ─── Edit mode and Selection ───
  const editMode = ref(false)
  const selectedBookUrls = ref<Set<string>>(new Set())

  function toggleSelection(url: string) {
    if (selectedBookUrls.value.has(url)) {
      selectedBookUrls.value.delete(url)
    } else {
      selectedBookUrls.value.add(url)
    }
  }

  function selectAll() {
    filteredBooks.value.forEach(b => selectedBookUrls.value.add(b.bookUrl))
  }

  function clearSelection() {
    selectedBookUrls.value.clear()
  }

  async function bulkDelete() {
    const toDelete = books.value
      .filter(b => selectedBookUrls.value.has(b.bookUrl))
      .map(b => ({ bookUrl: b.bookUrl, origin: b.origin }))
    
    if (toDelete.length === 0) return
    await apiDeleteBooks(toDelete as Book[])
    await Promise.all(toDelete.map((book) => deleteBrowserBookCache(book.bookUrl).catch(() => undefined)))
    books.value = books.value.filter(b => !selectedBookUrls.value.has(b.bookUrl))
    clearSelection()
  }

  async function bulkSetGroup(groupId: number) {
    const urls = Array.from(selectedBookUrls.value)
    for (const url of urls) {
      await apiSaveBookGroupId(url, groupId)
    }
    // Refresh to get updated groups
    await fetchBooks()
    clearSelection()
  }

  async function reorderBooks(draggedUrl: string, targetUrl: string) {
    if (!draggedUrl || !targetUrl || draggedUrl === targetUrl) return

    const snapshot = books.value.slice()
    const fromIndex = snapshot.findIndex((book) => book.bookUrl === draggedUrl)
    const toIndex = snapshot.findIndex((book) => book.bookUrl === targetUrl)
    if (fromIndex === -1 || toIndex === -1 || fromIndex === toIndex) return

    const next = snapshot.slice()
    const [moved] = next.splice(fromIndex, 1)
    next.splice(toIndex, 0, moved)

    books.value = next
    sorting.value = true
    try {
      await apiSaveBooks(next)
    } catch (error) {
      books.value = snapshot
      throw error
    } finally {
      sorting.value = false
    }
  }

  async function moveBookToFront(bookUrl: string) {
    if (!bookUrl || books.value.length === 0) return

    const snapshot = books.value.slice()
    const target = snapshot.find((b) => b.bookUrl === bookUrl)
    if (target) {
      target.durChapterTime = Date.now()
    }
    const next = sortBooksByLatestReadAndName(snapshot)

    books.value = next
    sorting.value = true
    try {
      await apiSaveBooks(next)
    } catch (error) {
      books.value = snapshot
      throw error
    } finally {
      sorting.value = false
    }
  }

  return {
    books, recentBooks, loading, refreshing, sorting,
    fetchBooks, refreshBooks, removeBook,
    refreshRecentBooks, removeRecentBook, clearAllRecentBooks,
    groups, activeGroupId, displayGroups, filteredBooks,
    fetchGroups, saveGroup, removeGroup, toggleGroupVisibility, reorderGroups,
    searchResults, isSearching, searchKey,
    searchScope, searchGroup, searchSourceUrl, startSearch, clearSearch, isSearchMode,
    editMode,
    selectedBookUrls, toggleSelection, selectAll, clearSelection,
    bulkDelete, bulkSetGroup, reorderBooks, moveBookToFront,
  }
})
