<template>
  <div class="search-results">
    <div class="search-header">
      <h2>
        搜索 "{{ searchKey }}"
        <span v-if="isSearching" class="searching-indicator">
          <span class="dot-pulse"></span>
          搜索中... (已搜 {{ searchedCount }}/{{ totalSourceCount }} 源 · {{ displayResults.length }} 结果)
        </span>
        <span v-else class="result-count">({{ displayResults.length }} 个结果)</span>
      </h2>
      <div class="header-actions">
        <button v-if="isSearching" class="stop-btn" @click="stopSearch">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14">
            <rect x="6" y="6" width="12" height="12" rx="2" />
          </svg>
          停止搜索
        </button>
        <button class="back-btn" @click="$emit('back')">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18">
            <path d="M18 6 6 18M6 6l12 12" />
          </svg>
          返回书架
        </button>
      </div>
    </div>

    <div class="search-filters">
      <div class="filter-tabs" role="tablist" aria-label="搜索范围">
        <button
          type="button"
          class="filter-tab"
          :class="{ active: searchScope === 'all' }"
          @click="searchScope = 'all'"
        >
          全部书源
        </button>
        <button
          type="button"
          class="filter-tab"
          :class="{ active: searchScope === 'group' }"
          @click="searchScope = 'group'"
        >
          按分组
        </button>
        <button
          type="button"
          class="filter-tab"
          :class="{ active: searchScope === 'source' }"
          @click="searchScope = 'source'"
        >
          单个书源
        </button>
      </div>

      <div v-if="searchScope === 'group'" class="filter-select-wrap">
        <select v-model="selectedGroup" class="filter-select">
          <option v-for="group in sourceGroups" :key="group" :value="group">
            {{ group }}
          </option>
        </select>
      </div>

      <div v-else-if="searchScope === 'source'" class="filter-select-wrap">
        <select v-model="selectedSourceUrl" class="filter-select">
          <option v-for="source in sourceOptions" :key="source.bookSourceUrl" :value="source.bookSourceUrl">
            {{ source.bookSourceName }}
          </option>
        </select>
      </div>

      <label class="strict-mode-toggle" title="选中时书名必须与搜索词完全一致，未选中则模糊匹配">
        <input v-model="strictMode" type="checkbox" />
        <span class="strict-label">严格模式（书名完全一致）</span>
      </label>
    </div>

    <BookGrid
      :books="displayResults"
      :is-search="true"
      :loading="isSearching && displayResults.length === 0"
      empty-text="未找到相关书籍"
      @click="handleBookClick"
      @info="handleBookInfo"
      @addToShelf="handleAddToShelf"
    />

    <BookDetailModal
      v-model="showBookDetail"
      :book="selectedBook"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useBookshelfStore } from '../stores/bookshelf'
import { useReaderStore } from '../stores/reader'
import { useAppStore } from '../stores/app'
import { useSourceStore } from '../stores/source'
import { searchBookMulti } from '../api/search'
import { saveBook } from '../api/bookshelf'
import BookGrid from './BookGrid.vue'
import BookDetailModal from './BookDetailModal.vue'
import type { Book, SearchBook } from '../types'

import { storeToRefs } from 'pinia'

const router = useRouter()
const shelfStore = useBookshelfStore()
const readerStore = useReaderStore()
const appStore = useAppStore()
const sourceStore = useSourceStore()

const {
  searchKey,
  searchResults: results,
  isSearching,
  searchScope,
  searchGroup: selectedGroup,
  searchSourceUrl: selectedSourceUrl,
} = storeToRefs(shelfStore)

const searchedCount = ref(0)
const totalSourceCount = ref(0)
let currentAbortController: AbortController | null = null

const showBookDetail = ref(false)
const selectedBook = ref<Book | SearchBook | null>(null)

const sourceByUrl = computed(() => {
  return new Map(sourceStore.sources.map((source) => [source.bookSourceUrl, source]))
})

const sourceGroups = computed(() => {
  const groups = new Set<string>()
  for (const source of sourceStore.sources) {
    const parts = (source.bookSourceGroup || '')
      .split(/[;,，；、|/]/)
      .map((item) => item.trim())
      .filter(Boolean)
    for (const group of parts) {
      groups.add(group)
    }
  }
  return Array.from(groups).sort((a, b) => a.localeCompare(b, 'zh-Hans-CN'))
})

const sourceOptions = computed(() => {
  return [...sourceStore.sources]
    .filter((source) => source.enabled !== false)
    .sort((a, b) => {
      const orderDiff = (a.customOrder ?? 0) - (b.customOrder ?? 0)
      if (orderDiff !== 0) return orderDiff
      return a.bookSourceName.localeCompare(b.bookSourceName, 'zh-Hans-CN')
    })
})

const strictMode = ref(false)

const localLibraryMatches = computed<SearchBook[]>(() => {
  const key = (searchKey.value || '').trim().toLowerCase()
  if (!key) return []
  return shelfStore.books
    .filter((b) => {
      const bName = (b.name || '').trim().toLowerCase()
      const bAuthor = (b.author || '').trim().toLowerCase()
      if (strictMode.value) {
        return bName === key
      }
      return bName.includes(key) || bAuthor.includes(key)
    })
    .map((b) => ({
      name: b.name,
      author: b.author || '未知作者',
      bookUrl: b.bookUrl,
      origin: b.origin,
      originName: '书架已有 · ' + (b.originName || (b.origin?.startsWith('local-') ? '本地书' : b.origin)),
      coverUrl: b.coverUrl,
      intro: b.intro || (b.durChapterTitle ? `上次读到：${b.durChapterTitle}` : '已在书架中'),
      kind: b.kind || (b.origin?.startsWith('local-') ? '本地书籍' : '书架藏书'),
      latestChapterTitle: b.latestChapterTitle || b.durChapterTitle,
      wordCount: b.wordCount,
    }))
})

const displayResults = computed<SearchBook[]>(() => {
  const key = (searchKey.value || '').trim().toLowerCase()
  const mapped = results.value
    .filter((book) => {
      if (!strictMode.value) return true
      const bName = (book.name || '').trim().toLowerCase()
      return bName === key
    })
    .map((book) => {
      const source = sourceByUrl.value.get(book.origin)
      return {
        ...book,
        originName: book.originName || source?.bookSourceName || book.origin,
        originGroup: book.originGroup || source?.bookSourceGroup,
      }
    })

  const shelfUrls = new Set(localLibraryMatches.value.map((b) => b.bookUrl))
  const uniqueNetwork = mapped.filter((b) => !shelfUrls.has(b.bookUrl))
  return [...localLibraryMatches.value, ...uniqueNetwork]
})

function ensureSearchSelection() {
  if (searchScope.value === 'group') {
    const selectedGroupStillValid = selectedGroup.value && sourceGroups.value.includes(selectedGroup.value)
    if (!selectedGroupStillValid && sourceGroups.value.length > 0) {
      selectedGroup.value = sourceGroups.value[0]
    }
  }
  if (searchScope.value === 'source') {
    const selectedSourceStillValid = sourceOptions.value.some((source) => source.bookSourceUrl === selectedSourceUrl.value)
    if (!selectedSourceStillValid && sourceOptions.value.length > 0) {
      selectedSourceUrl.value = sourceOptions.value[0].bookSourceUrl
    }
  }
}

function stopSearch() {
  if (currentAbortController) {
    currentAbortController.abort()
    currentAbortController = null
  }
  shelfStore.isSearching = false
}

async function doSearch(key: string) {
  stopSearch()

  if (searchScope.value === 'group' && !selectedGroup.value) {
    shelfStore.searchResults = []
    shelfStore.isSearching = false
    return
  }

  if (searchScope.value === 'source' && !selectedSourceUrl.value) {
    shelfStore.searchResults = []
    shelfStore.isSearching = false
    return
  }

  // 1. Determine target source list
  let targetSources: string[] = []
  if (searchScope.value === 'source') {
    if (selectedSourceUrl.value) targetSources = [selectedSourceUrl.value]
  } else if (searchScope.value === 'group') {
    targetSources = sourceOptions.value
      .filter((s) => s.bookSourceGroup?.includes(selectedGroup.value))
      .map((s) => s.bookSourceUrl)
  } else {
    targetSources = sourceOptions.value.map((s) => s.bookSourceUrl)
  }

  if (targetSources.length === 0) {
    shelfStore.searchResults = []
    shelfStore.isSearching = false
    return
  }

  shelfStore.searchResults = []
  shelfStore.isSearching = true
  searchedCount.value = 0
  totalSourceCount.value = targetSources.length

  const abortController = new AbortController()
  currentAbortController = abortController

  // 2. Client-Driven Chunking (方案 1)
  // Divide sources into bounded chunks of 15 sources (strictly complying with CF 50 subrequests limit)
  const CHUNK_SIZE = 15
  const chunks: string[][] = []
  for (let i = 0; i < targetSources.length; i += CHUNK_SIZE) {
    chunks.push(targetSources.slice(i, i + CHUNK_SIZE))
  }

  // 3. Worker queue pool: up to 3 parallel chunk requests running across Cloudflare edge
  const MAX_PARALLEL = 3
  let chunkIndex = 0

  async function worker() {
    while (chunkIndex < chunks.length && !abortController.signal.aborted) {
      const currentChunkIdx = chunkIndex++
      const chunk = chunks[currentChunkIdx]

      try {
        const books = await searchBookMulti({
          key,
          bookSourceUrls: chunk,
          signal: abortController.signal,
        })

        if (!abortController.signal.aborted && Array.isArray(books)) {
          const existing = new Set(shelfStore.searchResults.map((r) => `${r.origin}::${r.bookUrl}`))
          const newBooks = books.filter((b: SearchBook) => !existing.has(`${b.origin}::${b.bookUrl}`))
          shelfStore.searchResults = [...shelfStore.searchResults, ...newBooks]
        }
      } catch (err: any) {
        if (err.name === 'AbortError') return
      } finally {
        if (!abortController.signal.aborted) {
          searchedCount.value = Math.min(totalSourceCount.value, searchedCount.value + chunk.length)
        }
      }
    }
  }

  try {
    const workers = Array.from({ length: Math.min(MAX_PARALLEL, chunks.length) }, () => worker())
    await Promise.all(workers)
  } finally {
    if (currentAbortController === abortController) {
      shelfStore.isSearching = false
      currentAbortController = null
    }
  }
}

watch(
  [() => shelfStore.searchKey, searchScope, selectedGroup, selectedSourceUrl],
  ([key]) => {
    ensureSearchSelection()
    if (key) {
      doSearch(key)
    } else {
      stopSearch()
      shelfStore.searchResults = []
    }
  },
  { immediate: true }
)

watch([searchScope, sourceGroups, sourceOptions], () => {
  ensureSearchSelection()
}, { immediate: true })

onMounted(async () => {
  if (sourceStore.sources.length === 0) {
    await sourceStore.fetchSources().catch(() => undefined)
  }
  ensureSearchSelection()
})

onUnmounted(() => {
  stopSearch()
})

async function handleBookClick(book: Book | SearchBook) {
  const existing = shelfStore.books.find((b) => b.bookUrl === book.bookUrl)
  if (existing) {
    const loadBookTask = readerStore.loadBook(existing)
    await router.push('/reader')
    await loadBookTask
    await readerStore.loadChapter(existing.durChapterIndex || 0)
    return
  }

  const b = book as Book
  if (b.origin && b.bookUrl) {
    const loadBookTask = readerStore.loadBook(b)
    await router.push('/reader')
    await loadBookTask
    await readerStore.loadChapter(b.durChapterIndex || 0)
  }
}

function handleBookInfo(book: Book | SearchBook) {
  selectedBook.value = book
  showBookDetail.value = true
}

async function handleAddToShelf(book: Book | SearchBook) {
  try {
    await saveBook({
      name: book.name,
      author: book.author,
      bookUrl: book.bookUrl,
      origin: book.origin,
      coverUrl: book.coverUrl,
    })
    appStore.showToast(`"${book.name}" 已加入书架`, 'success')
    shelfStore.fetchBooks()
  } catch (e: unknown) {
    appStore.showToast((e as Error).message, 'error')
  }
}

defineEmits<{
  back: []
}>()
</script>

<style scoped>
.search-results {
  height: 100%;
  min-height: 0;
  overflow: auto;
  padding: 0 var(--space-6);
}

.search-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--space-4) 0;
  gap: var(--space-4);
}

.search-header h2 {
  font-size: var(--text-xl);
  font-weight: 700;
  display: flex;
  align-items: center;
  gap: var(--space-3);
}

.result-count {
  font-size: var(--text-sm);
  font-weight: 400;
  color: var(--color-text-tertiary);
}

.searching-indicator {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  font-size: var(--text-sm);
  font-weight: 400;
  color: var(--color-primary);
}

.dot-pulse {
  display: inline-block;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--color-primary);
  animation: pulse 1.2s infinite ease-in-out;
}

@keyframes pulse {
  0%, 80%, 100% {
    transform: scale(0.6);
    opacity: 0.5;
  }
  40% {
    transform: scale(1);
    opacity: 1;
  }
}

.back-btn {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-2) var(--space-4);
  border-radius: var(--radius-md);
  font-size: var(--text-sm);
  font-weight: 500;
  color: var(--color-text-secondary);
  border: 1px solid var(--color-border);
  transition: all var(--duration-fast);
}

.back-btn:hover {
  background: var(--color-bg-hover);
  color: var(--color-text);
}

.search-filters {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-3);
  margin-bottom: var(--space-5);
}

.filter-tabs {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  padding: 4px;
  border-radius: var(--radius-full);
  background: var(--color-bg-elevated);
  border: 1px solid var(--color-border-light);
}

.filter-tab {
  min-height: 34px;
  padding: 0 var(--space-4);
  border-radius: var(--radius-full);
  font-size: var(--text-sm);
  font-weight: 500;
  color: var(--color-text-secondary);
  transition: all var(--duration-fast);
}

.filter-tab:hover {
  color: var(--color-text);
  background: var(--color-bg-hover);
}

.filter-tab.active {
  color: white;
  background: var(--color-primary);
}

.filter-select-wrap {
  min-width: min(100%, 280px);
}

.filter-select {
  width: 100%;
  min-height: 40px;
  padding: 0 var(--space-4);
  border-radius: var(--radius-lg);
  border: 1px solid var(--color-border);
  background: var(--color-bg-elevated);
  color: var(--color-text);
  font-size: var(--text-sm);
}

.strict-mode-toggle {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  margin-left: auto;
  cursor: pointer;
  font-size: var(--text-sm);
  color: var(--color-text-secondary);
  user-select: none;
  padding: var(--space-2) var(--space-3);
  border-radius: var(--radius-md);
  border: 1px solid var(--color-border);
  background: var(--color-bg-elevated);
}

.strict-mode-toggle input[type="checkbox"] {
  cursor: pointer;
  accent-color: var(--color-primary);
}

.strict-label {
  font-weight: 500;
}

@media (max-width: 720px) {
  .search-results {
    padding: 0 var(--space-4);
  }

  .search-header {
    flex-direction: column;
    align-items: stretch;
  }

  .search-header h2 {
    flex-wrap: wrap;
  }

.header-actions {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}

.stop-btn {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  padding: var(--space-2) var(--space-3);
  border-radius: var(--radius-md);
  font-size: var(--text-sm);
  font-weight: 500;
  color: var(--color-danger);
  border: 1px solid rgba(239, 68, 68, 0.3);
  background: rgba(239, 68, 68, 0.08);
  cursor: pointer;
  transition: all var(--duration-fast);
}

.stop-btn:hover {
  background: var(--color-danger);
  color: #fff;
}

.back-btn {
    justify-content: center;
  }

  .filter-tabs {
    width: 100%;
    justify-content: space-between;
  }

  .filter-tab {
    flex: 1;
    padding: 0 var(--space-2);
  }

  .filter-select-wrap {
    width: 100%;
    min-width: 0;
  }
}
</style>
