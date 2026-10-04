<template>
  <Teleport to="body">
    <Transition name="fade">
      <div v-if="modelValue" class="modal-overlay" @click="close"></div>
    </Transition>
    <Transition name="scale">
      <div v-if="modelValue" class="modal-container" @click.self="close">
        <section class="webdav-modal">
          <header class="modal-header">
            <div>
              <h2>WebDAV 文件管理</h2>
              <p class="subtitle">管理云端存储与备份文件，支持直接将 TXT、EPUB、PDF、MOBI 导入至书架</p>
            </div>
            <button class="icon-btn" @click="close" aria-label="关闭">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M18 6 6 18M6 6l12 12" />
              </svg>
            </button>
          </header>

          <div v-if="!webdavAvailable" class="notice warning">
            <strong>{{ unavailableTitle }}</strong>
            <span>{{ unavailableMessage }}</span>
          </div>

          <template v-else>
            <div class="toolbar">
              <div class="toolbar-left">
                <button class="action-btn primary" :disabled="working" @click="createBackup">
                  备份当前数据
                </button>
                <button class="action-btn" :disabled="working || loading" @click="loadFiles(currentPath)">
                  刷新列表
                </button>
                <button class="action-btn" :disabled="working" @click="triggerUpload">
                  上传文件
                </button>
                <input
                  ref="fileInputRef"
                  type="file"
                  multiple
                  class="hidden-input"
                  @change="handleUpload"
                />
                <button class="action-btn" :disabled="working" @click="triggerRestoreLocalBackup">
                  导入本地备份
                </button>
                <input
                  ref="backupFileInputRef"
                  type="file"
                  accept=".zip,.json"
                  class="hidden-input"
                  @change="handleLocalBackupFileChange"
                />
              </div>
              <button
                class="action-btn danger"
                :disabled="working || selectedPaths.length === 0"
                @click="removeSelected"
              >
                删除选中项
              </button>
            </div>

            <div v-if="uploadProgress !== null" class="upload-progress-card">
              <div class="progress-info">
                <span>正在上传文件...</span>
                <strong>{{ uploadProgress }}%</strong>
              </div>
              <div class="progress-track">
                <div class="progress-fill" :style="{ width: uploadProgress + '%' }"></div>
              </div>
            </div>

            <div class="path-bar">
              <span class="path-label">当前目录</span>
              <code>{{ currentPath }}</code>
            </div>

            <div v-if="errorMessage" class="notice error">
              <strong>加载失败</strong>
              <span>{{ errorMessage }}</span>
            </div>

            <div class="file-list">
              <div v-if="loading" class="empty-state">正在加载文件列表...</div>
              <div v-else-if="entries.length === 0" class="empty-state">当前目录为空</div>
              <div v-else v-for="entry in entries" :key="entry.path" class="file-row">
                <label class="file-check" v-if="!entry.toParent">
                  <input
                    type="checkbox"
                    :checked="selectedPaths.includes(entry.path)"
                    @change="toggleSelection(entry.path)"
                  />
                </label>
                <span v-else class="file-check placeholder"></span>

                <button
                  class="file-main"
                  :class="{ directory: entry.isDirectory }"
                  @click="openEntry(entry)"
                >
                  <span class="file-icon">{{ entry.isDirectory ? '📁' : isBookFile(entry.name) ? '📖' : isZipFile(entry.name) ? '📦' : '📄' }}</span>
                  <span class="file-name">{{ entry.name }}</span>
                </button>

                <span class="file-meta">{{ entry.isDirectory ? '目录' : formatSize(entry.size) }}</span>
                <span class="file-meta">{{ formatDate(entry.lastModified) }}</span>

                <div class="file-actions">
                  <button
                    v-if="!entry.isDirectory && isBookFile(entry.name)"
                    class="mini-btn success"
                    :disabled="working"
                    @click="importToShelf(entry)"
                  >
                    导入至书架
                  </button>
                  <button
                    v-if="!entry.isDirectory && isBackupFile(entry.name)"
                    class="mini-btn primary"
                    :disabled="working"
                    @click="restoreBackup(entry)"
                  >
                    恢复备份
                  </button>
                  <button
                    v-if="!entry.isDirectory"
                    class="mini-btn"
                    :disabled="working"
                    @click="downloadEntry(entry)"
                  >
                    下载
                  </button>
                  <button
                    v-if="!entry.toParent"
                    class="mini-btn danger"
                    :disabled="working"
                    @click="removeEntry(entry)"
                  >
                    删除
                  </button>
                </div>
              </div>
            </div>
          </template>
        </section>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useAppStore } from '../stores/app'
import { useBookshelfStore } from '../stores/bookshelf'
import {
  deleteWebdavFile,
  deleteWebdavFileList,
  getWebdavFileBlob,
  getWebdavFileList,
  type WebdavFileEntry,
  uploadFilesToWebdav,
  importWebdavBook,
} from '../api/webdav'
import {
  createLegadoBackupZip,
  restoreBackupFromBytes,
} from '../utils/webdavBackup'
import { buildAuthHeaderValues } from '../utils/secureAccess'

type EntryRow = WebdavFileEntry & { toParent?: boolean }

const props = defineProps<{
  modelValue: boolean
}>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
}>()

const appStore = useAppStore()
const fileInputRef = ref<HTMLInputElement | null>(null)
const backupFileInputRef = ref<HTMLInputElement | null>(null)
const currentPath = ref('/')
const entries = ref<EntryRow[]>([])
const selectedPaths = ref<string[]>([])
const loading = ref(false)
const working = ref(false)
const errorMessage = ref('')

const webdavAvailable = computed(() => {
  if (!appStore.isSecureMode) return true
  return appStore.isLoggedIn && !!appStore.userInfo?.enableWebdav
})

const unavailableTitle = computed(() => {
  if (!appStore.isSecureMode) return ''
  return appStore.isLoggedIn ? '当前账号尚未开启服务器备份' : '需要先登录后才能使用服务器备份'
})

const unavailableMessage = computed(() => {
  if (!appStore.isSecureMode) return ''
  return appStore.isLoggedIn
    ? '请在用户管理中为当前账号开启服务器备份权限后再使用备份与恢复功能。'
    : '登录后如果账号具备备份权限，就可以把数据备份到服务器并执行恢复。'
})

watch(
  () => props.modelValue,
  (visible) => {
    if (visible && webdavAvailable.value) {
      void loadFiles(currentPath.value)
    }
    if (!visible) {
      errorMessage.value = ''
      selectedPaths.value = []
    }
  },
)

function close() {
  emit('update:modelValue', false)
}

const shelfStore = useBookshelfStore()

function isZipFile(name: string) {
  return name.toLowerCase().endsWith('.zip')
}

function isBackupFile(name: string) {
  const lower = name.toLowerCase()
  return lower.endsWith('.zip') || lower.endsWith('.json')
}

function isBookFile(name: string) {
  const lower = name.toLowerCase()
  return (
    lower.endsWith('.txt') ||
    lower.endsWith('.epub') ||
    lower.endsWith('.pdf') ||
    lower.endsWith('.mobi') ||
    lower.endsWith('.prc')
  )
}

function formatSize(size: number) {
  if (!size) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  let value = size
  let unitIndex = 0
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024
    unitIndex += 1
  }
  return `${value >= 10 || unitIndex === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[unitIndex]}`
}

function formatDate(timestamp: number) {
  if (!timestamp) return '-'
  return new Date(timestamp).toLocaleString()
}

function toParentPath(path: string) {
  if (path === '/' || !path) return '/'
  const parts = path.split('/').filter(Boolean)
  parts.pop()
  return parts.length ? `/${parts.join('/')}` : '/'
}

function toggleSelection(path: string) {
  if (selectedPaths.value.includes(path)) {
    selectedPaths.value = selectedPaths.value.filter((item) => item !== path)
  } else {
    selectedPaths.value = selectedPaths.value.concat(path)
  }
}

async function loadFiles(path = '/') {
  loading.value = true
  errorMessage.value = ''
  try {
    const list = await getWebdavFileList(path)
    currentPath.value = path
    selectedPaths.value = []
    const rows: EntryRow[] = path !== '/'
      ? [{
          name: '..',
          size: 0,
          path: toParentPath(path),
          lastModified: 0,
          isDirectory: true,
          toParent: true,
        }]
      : []
    rows.push(...list.sort((a, b) => {
      if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1
      return a.name.localeCompare(b.name)
    }))
    entries.value = rows
  } catch (error) {
    errorMessage.value = (error as Error).message || '无法读取服务器备份文件列表'
    entries.value = []
  } finally {
    loading.value = false
  }
}

function openEntry(entry: EntryRow) {
  if (entry.isDirectory) {
    void loadFiles(entry.path)
  }
}

function triggerUpload() {
  fileInputRef.value?.click()
}

const uploadProgress = ref<number | null>(null)

async function handleUpload(event: Event) {
  const input = event.target as HTMLInputElement
  const files = Array.from(input.files || [])
  if (!files.length) return

  // Check if any file already exists in current WebDAV directory
  const existingNames = new Set(entries.value.filter((e) => !e.isDirectory).map((e) => e.name.toLowerCase()))
  const duplicates = files.filter((f) => existingNames.has(f.name.toLowerCase()))
  if (duplicates.length > 0) {
    const dupText = duplicates.map((f) => `《${f.name}》`).join('、')
    appStore.showToast(`文件已存在：${dupText}`, 'warning')
    input.value = ''
    return
  }

  working.value = true
  uploadProgress.value = 0
  try {
    await uploadFilesToWebdav(
      files.map((file) => ({ file, name: file.name })),
      currentPath.value,
      (percent) => {
        uploadProgress.value = percent
      }
    )
    appStore.showToast('文件已上传到服务器', 'success')
    await loadFiles(currentPath.value)
  } catch (error) {
    appStore.showToast((error as Error).message || '上传失败', 'error')
  } finally {
    working.value = false
    uploadProgress.value = null
    input.value = ''
  }
}

function buildBackupFilename() {
  const now = new Date()
  const pad = (value: number) => String(value).padStart(2, '0')
  return `backup-${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}-${pad(now.getHours())}-${pad(now.getMinutes())}.zip`
}

async function createBackup() {
  working.value = true
  try {
    const zipBytes = await createLegadoBackupZip()
    const blob = new Blob([zipBytes.buffer as ArrayBuffer], { type: 'application/zip' })
    const filename = buildBackupFilename()
    await uploadFilesToWebdav(
      [{ file: blob, name: filename }],
      '/backups',
    )
    appStore.showToast(`标准 ZIP 备份已保存: ${filename}`, 'success')
    await loadFiles('/backups')
  } catch (error) {
    appStore.showToast((error as Error).message || '备份失败', 'error')
  } finally {
    working.value = false
  }
}

function triggerRestoreLocalBackup() {
  backupFileInputRef.value?.click()
}

async function handleLocalBackupFileChange(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  if (!confirm(`确定导入并恢复备份《${file.name}》吗？这会覆盖当前书架、书源、RSS、书签和相关本地配置。`)) {
    input.value = ''
    return
  }
  working.value = true
  try {
    const arrayBuffer = await file.arrayBuffer()
    await restoreBackupFromBytes(new Uint8Array(arrayBuffer))
    appStore.showToast('恢复完成，正在刷新页面', 'success')
    window.setTimeout(() => {
      window.location.reload()
    }, 800)
  } catch (error) {
    appStore.showToast((error as Error).message || '恢复失败', 'error')
    working.value = false
  } finally {
    input.value = ''
  }
}

async function downloadEntry(entry: EntryRow) {
  working.value = true
  try {
    const blob = await getWebdavFileBlob(entry.path)
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = entry.name
    document.body.appendChild(link)
    link.click()
    window.setTimeout(() => {
      link.remove()
      URL.revokeObjectURL(url)
    }, 2000)
    appStore.showToast(`开始下载《${entry.name}》`, 'success')
  } catch {
    try {
      const { accessToken, secureKey } = buildAuthHeaderValues(localStorage)
      const q = new URLSearchParams({ path: entry.path })
      if (accessToken) q.set('token', accessToken)
      if (secureKey) q.set('key', secureKey)
      window.open(`/reader3/getWebdavFile?${q.toString()}`, '_blank')
    } catch (e: any) {
      appStore.showToast(e.message || '下载失败', 'error')
    }
  } finally {
    working.value = false
  }
}

async function removeEntry(entry: EntryRow) {
  if (!confirm(`确定删除 ${entry.name} 吗？`)) return
  working.value = true
  try {
    await deleteWebdavFile(entry.path)
    appStore.showToast('文件已删除', 'success')
    await loadFiles(currentPath.value)
  } catch (error) {
    appStore.showToast((error as Error).message || '删除失败', 'error')
  } finally {
    working.value = false
  }
}

async function removeSelected() {
  if (!selectedPaths.value.length) return
  if (!confirm(`确定删除选中的 ${selectedPaths.value.length} 个项目吗？`)) return
  working.value = true
  try {
    await deleteWebdavFileList(selectedPaths.value)
    appStore.showToast('选中文件已删除', 'success')
    await loadFiles(currentPath.value)
  } catch (error) {
    appStore.showToast((error as Error).message || '批量删除失败', 'error')
  } finally {
    working.value = false
  }
}

async function restoreBackup(entry: EntryRow) {
  if (!confirm(`确定从 ${entry.name} 恢复备份吗？这会覆盖当前书架、书源、RSS、书签和相关本地配置。`)) {
    return
  }

  working.value = true
  appStore.showToast(`正在读取备份《${entry.name}》...`)
  try {
    const blob = await getWebdavFileBlob(entry.path)
    appStore.showToast('正在解析并恢复备份数据...')
    const arrayBuffer = await blob.arrayBuffer()
    await restoreBackupFromBytes(new Uint8Array(arrayBuffer))
    appStore.showToast('恢复完成，正在刷新页面', 'success')
    window.setTimeout(() => {
      window.location.reload()
    }, 800)
  } catch (error) {
    console.error('restoreBackup error:', error)
    appStore.showToast((error as Error).message || '恢复失败', 'error')
    working.value = false
  }
}

async function importToShelf(entry: EntryRow) {
  const cleanName = entry.name.trim()
  const nameWithoutExt = cleanName.replace(/\.[^/.]+$/, '').trim()
  const isDuplicate = shelfStore.books.some((b) => {
    const bName = (b.name || '').trim()
    return bName === cleanName || bName === nameWithoutExt
  })

  if (isDuplicate) {
    appStore.showToast(`文件已存在，该书籍已在书架中：《${cleanName}》`, 'warning')
    return
  }

  working.value = true
  try {
    const res = await importWebdavBook(entry.path, entry.name)
    const msg = res?.moved
      ? `已将《${entry.name}》移动至 /book 目录并成功加入书架`
      : `已成功将《${entry.name}》导入至书架`
    appStore.showToast(msg, 'success')
    await Promise.all([
      shelfStore.fetchBooks().catch(() => undefined),
      loadFiles(currentPath.value).catch(() => undefined),
    ])
  } catch (error: any) {
    appStore.showToast(error.message || '导入书架失败', 'error')
  } finally {
    working.value = false
  }
}
</script>

<style scoped>
.modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(15, 23, 42, 0.45);
  backdrop-filter: blur(6px);
  z-index: var(--z-overlay);
}

.modal-container {
  position: fixed;
  inset: 0;
  z-index: var(--z-modal);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: var(--space-6);
}

.webdav-modal {
  width: min(980px, 100%);
  max-height: min(88vh, 920px);
  background: var(--color-bg-elevated);
  border: 1px solid var(--color-border-light);
  border-radius: var(--radius-xl);
  box-shadow: var(--shadow-xl);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.modal-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--space-4);
  padding: var(--space-5) var(--space-6);
  border-bottom: 1px solid var(--color-divider);
}

.modal-header h2 {
  font-size: var(--text-xl);
  font-weight: 700;
}

.subtitle {
  margin-top: var(--space-1);
  color: var(--color-text-secondary);
  font-size: var(--text-sm);
}

.icon-btn,
.action-btn,
.mini-btn,
.file-main {
  border: none;
  background: none;
  font: inherit;
}

.icon-btn {
  width: 38px;
  height: 38px;
  border-radius: var(--radius-md);
  color: var(--color-text-secondary);
  display: flex;
  align-items: center;
  justify-content: center;
}

.icon-btn:hover {
  background: var(--color-bg-hover);
}

.icon-btn svg {
  width: 18px;
  height: 18px;
}

.toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  padding: var(--space-4) var(--space-6);
  border-bottom: 1px solid var(--color-divider);
}

.upload-progress-card {
  margin: var(--space-2) var(--space-6);
  padding: var(--space-2) var(--space-3);
  background: rgba(var(--color-primary-rgb, 14, 165, 233), 0.08);
  border: 1px solid rgba(var(--color-primary-rgb, 14, 165, 233), 0.3);
  border-radius: var(--radius-md);
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}

.progress-info {
  display: flex;
  justify-content: space-between;
  font-size: var(--text-xs);
  color: var(--color-primary);
}

.progress-track {
  height: 6px;
  background: var(--color-bg-sunken);
  border-radius: 3px;
  overflow: hidden;
}

.progress-fill {
  height: 100%;
  background: var(--color-primary);
  transition: width 0.15s ease-out;
}

.toolbar-left {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
}

.action-btn,
.mini-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--radius-md);
  border: 1px solid var(--color-border-light);
  background: var(--color-bg-sunken);
  color: var(--color-text);
  transition: all var(--duration-fast);
}

.action-btn {
  min-height: 38px;
  padding: 0 var(--space-4);
  font-size: var(--text-sm);
  font-weight: 600;
}

.mini-btn {
  min-height: 30px;
  padding: 0 var(--space-3);
  font-size: var(--text-xs);
  font-weight: 600;
}

.action-btn.primary,
.mini-btn.primary {
  background: var(--color-primary);
  border-color: var(--color-primary);
  color: #fff;
}

.mini-btn.success {
  background: rgba(34, 197, 94, 0.12);
  border-color: #16a34a;
  color: #16a34a;
}

.mini-btn.success:hover:not(:disabled) {
  background: #16a34a;
  color: #fff;
}

.action-btn.danger,
.mini-btn.danger {
  color: var(--color-danger);
}

.action-btn:disabled,
.mini-btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.path-bar,
.notice {
  margin: var(--space-4) var(--space-6) 0;
}

.path-bar {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  color: var(--color-text-secondary);
  font-size: var(--text-sm);
}

.path-bar code {
  padding: var(--space-1) var(--space-2);
  border-radius: var(--radius-sm);
  background: var(--color-bg-sunken);
  color: var(--color-text);
}

.notice {
  display: grid;
  gap: 4px;
  padding: var(--space-3) var(--space-4);
  border-radius: var(--radius-md);
  font-size: var(--text-sm);
}

.notice.warning {
  background: rgba(201, 127, 58, 0.12);
  border: 1px solid rgba(201, 127, 58, 0.18);
}

.notice.error {
  background: rgba(245, 34, 45, 0.08);
  border: 1px solid rgba(245, 34, 45, 0.14);
}

.file-list {
  flex: 1;
  overflow: auto;
  padding: var(--space-4) var(--space-6) var(--space-6);
}

.file-row {
  display: grid;
  grid-template-columns: 28px minmax(0, 1fr) 90px 180px auto;
  align-items: center;
  gap: var(--space-3);
  min-height: 56px;
  padding: 0 var(--space-3);
  border-bottom: 1px solid var(--color-divider);
}

.file-row:last-child {
  border-bottom: none;
}

.file-check {
  display: flex;
  align-items: center;
  justify-content: center;
}

.file-check.placeholder {
  width: 20px;
}

.file-main {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  min-width: 0;
  padding: 0;
  text-align: left;
  color: var(--color-text);
}

.file-main.directory .file-name {
  color: var(--color-primary);
}

.file-icon {
  font-size: 18px;
}

.file-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.file-meta {
  font-size: var(--text-xs);
  color: var(--color-text-tertiary);
}

.file-actions {
  display: flex;
  justify-content: flex-end;
  gap: var(--space-2);
}

.empty-state {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 220px;
  color: var(--color-text-tertiary);
  font-size: var(--text-sm);
}

.hidden-input {
  display: none;
}

@media (max-width: 768px) {
  .modal-container {
    padding: var(--space-3);
  }

  .webdav-modal {
    max-height: 92vh;
  }

  .toolbar {
    flex-direction: column;
    align-items: stretch;
  }

  .toolbar-left {
    width: 100%;
  }

  .file-row {
    grid-template-columns: 28px minmax(0, 1fr);
    padding: var(--space-3);
  }

  .file-meta {
    display: none;
  }

  .file-actions {
    grid-column: 2;
    justify-content: flex-start;
    flex-wrap: wrap;
  }
}
</style>
