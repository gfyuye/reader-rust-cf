<template>
  <Teleport to="body">
    <Transition name="fade">
      <div v-if="modelValue" class="modal-overlay" @click="close"></div>
    </Transition>
    <Transition name="scale">
      <div v-if="modelValue" class="modal-container">
        <div class="sync-modal">
          <button class="modal-close" @click="close">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>

          <div class="modal-header">
            <div class="modal-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="28" height="28">
                <path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z" />
                <path d="m12 12 3-3 3 3" />
                <path d="M15 9v7" />
              </svg>
            </div>
            <h2>远端 WebDAV 异地同步</h2>
            <p class="modal-desc">
              自动将书架、书源、书签及进度实时镜像到坚果云、Nextcloud 或群晖等第三方 WebDAV 云盘。
            </p>
          </div>

          <div v-if="loading" class="loading-state">
            正在读取远端同步配置...
          </div>

          <form v-else class="sync-form" @submit.prevent="handleSave">
            <div class="toggle-row">
              <div class="toggle-info">
                <span class="toggle-title">启用远端 WebDAV 同步</span>
                <small class="toggle-desc">开启后将激活变动自动同步与 5 分钟定时同步</small>
              </div>
              <label class="switch">
                <input v-model="form.enabled" type="checkbox" />
                <span class="slider"></span>
              </label>
            </div>

            <div class="form-field">
              <label for="remote-url">WebDAV 服务地址 (URL)</label>
              <input
                id="remote-url"
                v-model="form.serverUrl"
                type="url"
                placeholder="例如: https://dav.jianguoyun.com/dav/reader-backups/"
                :required="form.enabled"
                autocomplete="off"
              />
              <small class="hint">建议单独创建一个用于存放备份的子目录路径，末尾保留斜杠</small>
            </div>

            <div class="form-grid-2">
              <div class="form-field">
                <label for="remote-user">WebDAV 账号 / 邮箱</label>
                <input
                  id="remote-user"
                  v-model="form.webdavUser"
                  type="text"
                  placeholder="例如: user@example.com"
                  :required="form.enabled"
                  autocomplete="username"
                />
              </div>

              <div class="form-field">
                <label for="remote-pass">
                  应用密码
                  <span v-if="form.hasPassword" class="saved-tag">(已保存)</span>
                </label>
                <input
                  id="remote-pass"
                  v-model="form.webdavPassword"
                  type="password"
                  placeholder="留空则保持现有密码"
                  autocomplete="current-password"
                />
              </div>
            </div>

            <div class="section-divider"></div>

            <div class="sync-options-group">
              <span class="group-title">自动同步触发方式</span>
              
              <label class="checkbox-label">
                <input v-model="form.syncOnChange" type="checkbox" />
                <div class="checkbox-text">
                  <strong>用户数据变动时同步</strong>
                  <span>添加/删除书籍、更新阅读进度、导入书源或修改规则时，后台自动触发镜像</span>
                </div>
              </label>

              <label class="checkbox-label">
                <input v-model="enablePeriodic" type="checkbox" />
                <div class="checkbox-text">
                  <strong>定时自动同步</strong>
                  <span>每隔 5 分钟由 Cloudflare 边缘定时器（Cron）自动检查并同步最新备份</span>
                </div>
              </label>
            </div>

            <div v-if="form.lastSyncAt || form.lastSyncStatus" class="sync-status-card" :class="form.lastSyncStatus">
              <div class="status-row">
                <span>最近同步状态：</span>
                <strong :class="form.lastSyncStatus === 'success' ? 'text-success' : 'text-danger'">
                  {{ form.lastSyncStatus === 'success' ? '同步成功' : form.lastSyncStatus === 'failed' ? '同步失败' : '进行中' }}
                </strong>
              </div>
              <div class="status-row">
                <span>最近同步时间：</span>
                <span>{{ formatDate(form.lastSyncAt) }}</span>
              </div>
              <div v-if="form.lastSyncError" class="status-error">
                <strong>错误信息：</strong>
                <span>{{ form.lastSyncError }}</span>
              </div>
            </div>

            <div class="modal-actions">
              <button
                type="button"
                class="btn outline"
                :disabled="testing || syncing || !form.serverUrl || !form.webdavUser"
                @click="handleTest"
              >
                {{ testing ? '正在连接...' : '测试连接' }}
              </button>

              <button
                type="button"
                class="btn outline accent"
                :disabled="testing || syncing || !form.enabled"
                @click="handleSyncNow"
              >
                {{ syncing ? '正在同步...' : '立即同步一次' }}
              </button>

              <button type="submit" class="btn primary" :disabled="saving">
                {{ saving ? '正在保存...' : '保存配置' }}
              </button>
            </div>
          </form>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import { useAppStore } from '../stores/app'
import {
  getRemoteWebdavConfig,
  saveRemoteWebdavConfig,
  testRemoteWebdavConnection,
  syncRemoteWebdavNow,
  type RemoteWebdavConfig,
} from '../api/remoteWebdav'

const props = defineProps<{
  modelValue: boolean
}>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
}>()

const appStore = useAppStore()
const loading = ref(false)
const saving = ref(false)
const testing = ref(false)
const syncing = ref(false)

const form = ref<RemoteWebdavConfig>({
  enabled: false,
  serverUrl: '',
  webdavUser: '',
  webdavPassword: '',
  hasPassword: false,
  syncOnChange: true,
  syncIntervalMins: 5,
  lastSyncAt: 0,
  lastSyncStatus: '',
  lastSyncError: null,
})

const enablePeriodic = ref(true)

watch(
  () => props.modelValue,
  async (isOpen) => {
    if (isOpen) {
      await loadConfig()
    }
  }
)

function close() {
  emit('update:modelValue', false)
}

function formatDate(ts?: number) {
  if (!ts) return '-'
  return new Date(ts * 1000).toLocaleString()
}

async function loadConfig() {
  loading.value = true
  try {
    const res = await getRemoteWebdavConfig()
    if (res) {
      form.value = {
        ...res,
        webdavPassword: res.hasPassword ? '******' : '',
      }
      enablePeriodic.value = res.syncIntervalMins > 0
    }
  } catch (error: any) {
    appStore.showToast(error.message || '读取配置失败', 'error')
  } finally {
    loading.value = false
  }
}

async function handleTest() {
  testing.value = true
  try {
    const res = await testRemoteWebdavConnection({
      serverUrl: form.value.serverUrl,
      webdavUser: form.value.webdavUser,
      webdavPassword: form.value.webdavPassword || (form.value.hasPassword ? '******' : ''),
    })
    appStore.showToast((res as any) || '连接成功！远端 WebDAV 服务正常响应', 'success')
  } catch (error: any) {
    appStore.showToast(error.message || '连接失败，请检查账号密码与网络', 'error')
  } finally {
    testing.value = false
  }
}

async function handleSyncNow() {
  syncing.value = true
  try {
    await syncRemoteWebdavNow()
    appStore.showToast('异地同步已触发并成功完成！', 'success')
    await loadConfig()
  } catch (error: any) {
    appStore.showToast(error.message || '同步失败', 'error')
  } finally {
    syncing.value = false
  }
}

async function handleSave() {
  saving.value = true
  try {
    form.value.syncIntervalMins = enablePeriodic.value ? 5 : 0
    await saveRemoteWebdavConfig(form.value)
    appStore.showToast('远端 WebDAV 同步配置已保存', 'success')
    close()
  } catch (error: any) {
    appStore.showToast(error.message || '保存失败', 'error')
  } finally {
    saving.value = false
  }
}
</script>

<style scoped>
.modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(15, 23, 42, 0.48);
  backdrop-filter: blur(8px);
  z-index: var(--z-overlay);
}

.modal-container {
  position: fixed;
  inset: 0;
  z-index: var(--z-modal);
  display: grid;
  place-items: center;
  padding: var(--space-4);
  pointer-events: none;
}

.sync-modal {
  width: min(100%, 580px);
  max-height: 90vh;
  overflow-y: auto;
  background: var(--color-bg-elevated);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-xl);
  box-shadow: var(--shadow-lg);
  padding: var(--space-6);
  pointer-events: auto;
  position: relative;
  display: flex;
  flex-direction: column;
  gap: var(--space-5);
}

.modal-close {
  position: absolute;
  top: var(--space-4);
  right: var(--space-4);
  width: 36px;
  height: 36px;
  display: grid;
  place-items: center;
  border-radius: var(--radius-md);
  border: none;
  background: transparent;
  color: var(--color-text-tertiary);
  cursor: pointer;
  transition: all 0.2s;
}

.modal-close:hover {
  background: var(--color-bg-sunken);
  color: var(--color-text);
}

.modal-close svg {
  width: 20px;
  height: 20px;
}

.modal-header {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.modal-icon {
  width: 48px;
  height: 48px;
  border-radius: var(--radius-lg);
  background: rgba(var(--color-primary-rgb, 14, 165, 233), 0.12);
  color: var(--color-primary);
  display: grid;
  place-items: center;
  margin-bottom: var(--space-1);
}

.modal-header h2 {
  font-size: var(--text-xl);
  font-weight: 700;
  color: var(--color-text);
  margin: 0;
}

.modal-desc {
  font-size: var(--text-sm);
  color: var(--color-text-secondary);
  line-height: 1.5;
  margin: 0;
}

.sync-form {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}

.toggle-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: var(--space-3) var(--space-4);
  background: var(--color-bg-sunken);
  border-radius: var(--radius-lg);
  border: 1px solid var(--color-border-subtle);
}

.toggle-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.toggle-title {
  font-size: var(--text-sm);
  font-weight: 600;
  color: var(--color-text);
}

.toggle-desc {
  font-size: var(--text-xs);
  color: var(--color-text-secondary);
}

/* Switch Styles */
.switch {
  position: relative;
  display: inline-block;
  width: 46px;
  height: 24px;
}

.switch input {
  opacity: 0;
  width: 0;
  height: 0;
}

.slider {
  position: absolute;
  cursor: pointer;
  inset: 0;
  background-color: var(--color-border);
  transition: 0.25s;
  border-radius: 24px;
}

.slider:before {
  position: absolute;
  content: "";
  height: 18px;
  width: 18px;
  left: 3px;
  bottom: 3px;
  background-color: white;
  transition: 0.25s;
  border-radius: 50%;
}

input:checked + .slider {
  background-color: var(--color-primary);
}

input:checked + .slider:before {
  transform: translateX(22px);
}

.form-field {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.form-field label {
  font-size: var(--text-sm);
  font-weight: 600;
  color: var(--color-text);
}

.form-field input {
  padding: var(--space-2) var(--space-3);
  border-radius: var(--radius-md);
  border: 1px solid var(--color-border);
  background: var(--color-bg);
  color: var(--color-text);
  font-size: var(--text-sm);
  outline: none;
  transition: border-color 0.2s;
}

.form-field input:focus {
  border-color: var(--color-primary);
}

.form-field .hint {
  font-size: var(--text-xs);
  color: var(--color-text-tertiary);
}

.form-grid-2 {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--space-3);
}

@media (max-width: 600px) {
  .form-grid-2 {
    grid-template-columns: 1fr;
  }
}

.saved-tag {
  font-size: var(--text-xs);
  color: var(--color-primary);
  font-weight: 400;
  margin-left: 4px;
}

.section-divider {
  height: 1px;
  background: var(--color-border-subtle);
  margin: var(--space-1) 0;
}

.sync-options-group {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  padding: var(--space-3);
  background: var(--color-bg-sunken);
  border-radius: var(--radius-md);
}

.group-title {
  font-size: var(--text-xs);
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: var(--color-text-tertiary);
}

.checkbox-label {
  display: flex;
  align-items: flex-start;
  gap: var(--space-3);
  cursor: pointer;
  user-select: none;
}

.checkbox-label input[type="checkbox"] {
  margin-top: 3px;
  accent-color: var(--color-primary);
  width: 16px;
  height: 16px;
}

.checkbox-text {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.checkbox-text strong {
  font-size: var(--text-sm);
  color: var(--color-text);
}

.checkbox-text span {
  font-size: var(--text-xs);
  color: var(--color-text-secondary);
  line-height: 1.4;
}

.sync-status-card {
  padding: var(--space-3) var(--space-4);
  border-radius: var(--radius-md);
  background: var(--color-bg-sunken);
  border: 1px solid var(--color-border);
  font-size: var(--text-xs);
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.sync-status-card.success {
  border-color: rgba(34, 197, 94, 0.3);
  background: rgba(34, 197, 94, 0.05);
}

.sync-status-card.failed {
  border-color: rgba(239, 68, 68, 0.3);
  background: rgba(239, 68, 68, 0.05);
}

.status-row {
  display: flex;
  justify-content: space-between;
  color: var(--color-text-secondary);
}

.text-success {
  color: #16a34a;
  font-weight: 600;
}

.text-danger {
  color: #dc2626;
  font-weight: 600;
}

.status-error {
  margin-top: 4px;
  padding-top: 4px;
  border-top: 1px dashed var(--color-border);
  color: #dc2626;
  line-height: 1.4;
}

.modal-actions {
  display: flex;
  justify-content: flex-end;
  gap: var(--space-3);
  margin-top: var(--space-2);
}

.btn {
  padding: var(--space-2) var(--space-4);
  border-radius: var(--radius-md);
  font-size: var(--text-sm);
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s;
  border: 1px solid transparent;
}

.btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.btn.primary {
  background: var(--color-primary);
  color: white;
}

.btn.outline {
  background: transparent;
  border-color: var(--color-border);
  color: var(--color-text);
}

.btn.outline:hover:not(:disabled) {
  background: var(--color-bg-sunken);
}

.btn.outline.accent {
  border-color: var(--color-primary);
  color: var(--color-primary);
}

.btn.outline.accent:hover:not(:disabled) {
  background: rgba(var(--color-primary-rgb, 14, 165, 233), 0.1);
}

.loading-state {
  padding: var(--space-8);
  text-align: center;
  color: var(--color-text-secondary);
  font-size: var(--text-sm);
}
</style>
