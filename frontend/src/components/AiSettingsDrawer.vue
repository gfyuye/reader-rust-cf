<template>
  <Teleport to="body">
    <Transition name="fade">
      <div v-if="modelValue" class="drawer-overlay" @click="close"></div>
    </Transition>
    <Transition name="slide">
      <aside v-if="modelValue" class="settings-drawer open">
        <header class="drawer-header">
          <div class="header-content">
            <div class="header-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="22" height="22">
                <path d="M12 2a8 8 0 0 0-8 8c0 3.36 2.07 6.24 5 7.42V19a2 2 0 0 0 2 2h2a2 2 0 0 0 2-2v-1.58c2.93-1.18 5-4.06 5-7.42a8 8 0 0 0-8-8z" />
                <path d="M9 13l2 2 4-4" />
              </svg>
            </div>
            <div>
              <h2>AI 伴读设置</h2>
              <small>配置 AI 大模型以启用自动剧情梳理、人物图谱与世界观绘图</small>
            </div>
          </div>
          <button class="close-btn" @click="close">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="20" height="20">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </header>

        <div class="drawer-body">
          <section class="drawer-section">
            <div class="toggle-row">
              <div class="toggle-info">
                <span class="toggle-title">启用 AI 伴读功能</span>
                <small class="toggle-desc">开启后阅读小说时将自动记录人物关系与剧情提炼</small>
              </div>
              <label class="switch">
                <input v-model="aiEnabled" type="checkbox" />
                <span class="slider"></span>
              </label>
            </div>
          </section>

          <section v-if="aiEnabled" class="drawer-section">
            <h3 class="section-title">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18">
                <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
                <line x1="8" y1="21" x2="16" y2="21" />
                <line x1="12" y1="17" x2="12" y2="21" />
              </svg>
              模型服务来源
            </h3>
            <div class="source-options">
              <label class="radio-card" :class="{ active: config.modelSource === 'server' }">
                <input v-model="config.modelSource" type="radio" value="server" />
                <div class="radio-content">
                  <div class="radio-title">
                    <strong>Cloudflare Workers AI</strong>
                    <span class="badge free">平台免费</span>
                  </div>
                  <small>使用 Cloudflare 边缘托管的 Qwen 1.5 与 Flux 绘图模型，无需自备 API Key，0 费用使用。</small>
                </div>
              </label>

              <label class="radio-card" :class="{ active: config.modelSource === 'browser' }">
                <input v-model="config.modelSource" type="radio" value="browser" />
                <div class="radio-content">
                  <div class="radio-title">
                    <strong>外部自定义 AI API</strong>
                    <span class="badge custom">高度自定义</span>
                  </div>
                  <small>接入你自己的 DeepSeek、OpenAI、Kimi、阿里通义或 Ollama 兼容接口。</small>
                </div>
              </label>
            </div>
          </section>

          <section v-if="aiEnabled && config.modelSource === 'browser'" class="drawer-section">
            <h3 class="section-title">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18">
                <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
                <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
              </svg>
              外部大语言模型 (LLM) 配置
            </h3>

            <div class="form-field">
              <label for="text-base-url">API 基础地址 (Base URL)</label>
              <input
                id="text-base-url"
                v-model="config.textBaseUrl"
                type="url"
                placeholder="例如: https://api.deepseek.com/v1"
                autocomplete="off"
              />
              <small class="hint">填写兼容 OpenAI 格式的 API 根路径，无需追加 /chat/completions</small>
            </div>

            <div class="form-field">
              <label for="text-api-key">API 密钥 (API Key)</label>
              <input
                id="text-api-key"
                v-model="config.textApiKey"
                type="password"
                placeholder="sk-..."
                autocomplete="off"
              />
            </div>

            <div class="form-field">
              <label for="text-model">模型名称 (Model)</label>
              <input
                id="text-model"
                v-model="config.textModel"
                type="text"
                placeholder="例如: deepseek-chat 或 gpt-4o-mini"
                autocomplete="off"
              />
            </div>

            <div class="form-field">
              <label for="image-model">图像插画模型 (可选)</label>
              <input
                id="image-model"
                v-model="config.imageModel"
                type="text"
                placeholder="例如: dall-e-3 (留空则默认使用内置绘图)"
                autocomplete="off"
              />
            </div>

            <label class="checkbox-row">
              <input v-model="config.useBackendProxy" type="checkbox" />
              <span>通过边缘中继代理请求（解决浏览器跨域限制与保护网络安全）</span>
            </label>
          </section>

          <div class="drawer-actions">
            <button
              v-if="aiEnabled && config.modelSource === 'browser'"
              type="button"
              class="action-btn"
              :disabled="testing || !config.textBaseUrl"
              @click="handleTestConnection"
            >
              {{ testing ? '正在连接...' : '测试连接' }}
            </button>
            <button
              type="button"
              class="action-btn primary"
              @click="handleSave"
            >
              保存 AI 配置
            </button>
          </div>
        </div>
      </aside>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import { useAppStore } from '../stores/app'
import { getAiBookConfig, saveAiBookConfig } from '../utils/aiBookConfig'
import type { AiBookConfig } from '../types'
import http from '../api/http'

const props = defineProps<{
  modelValue: boolean
}>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
}>()

const appStore = useAppStore()
const aiEnabled = ref(true)
const testing = ref(false)
const config = ref<AiBookConfig>(getAiBookConfig(appStore.userInfo?.username))

watch(
  () => props.modelValue,
  (isOpen) => {
    if (isOpen) {
      config.value = getAiBookConfig(appStore.userInfo?.username)
      aiEnabled.value = localStorage.getItem('reader-ai-enabled') !== 'false'
    }
  }
)

function close() {
  emit('update:modelValue', false)
}

async function handleTestConnection() {
  if (!config.value.textBaseUrl) {
    appStore.showToast('请先输入 API 基础地址', 'warning')
    return
  }

  testing.value = true
  try {
    const res = await http.post('/aiProxy', {
      baseUrl: config.value.textBaseUrl,
      apiKey: config.value.textApiKey,
      path: '/v1/chat/completions',
      body: {
        model: config.value.textModel || 'gpt-4o-mini',
        messages: [{ role: 'user', content: '测试连接' }],
        max_tokens: 10,
      },
    })

    if (res.status === 200) {
      appStore.showToast('AI 模型连接成功！', 'success')
    } else {
      appStore.showToast('连接失败，状态码: ' + res.status, 'error')
    }
  } catch (error: any) {
    appStore.showToast(error.message || '连接失败，请检查 BaseURL 与 Key', 'error')
  } finally {
    testing.value = false
  }
}

function handleSave() {
  localStorage.setItem('reader-ai-enabled', aiEnabled.value ? 'true' : 'false')
  saveAiBookConfig(appStore.userInfo?.username, config.value)
  appStore.showToast('AI 伴读配置已保存', 'success')
  close()
}
</script>

<style scoped>
.drawer-overlay {
  position: fixed;
  inset: 0;
  background: rgba(15, 23, 42, 0.45);
  backdrop-filter: blur(4px);
  z-index: calc(var(--z-drawer) - 1);
}

.settings-drawer {
  position: fixed;
  top: 0;
  right: 0;
  bottom: 0;
  width: min(100%, 420px);
  background: var(--color-bg-elevated);
  border-left: 1px solid var(--color-border);
  box-shadow: var(--shadow-xl);
  z-index: var(--z-drawer);
  display: flex;
  flex-direction: column;
}

.drawer-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--space-4) var(--space-5);
  border-bottom: 1px solid var(--color-border);
  background: var(--color-bg);
}

.header-content {
  display: flex;
  align-items: center;
  gap: var(--space-3);
}

.header-icon {
  width: 40px;
  height: 40px;
  border-radius: var(--radius-lg);
  background: rgba(var(--color-primary-rgb, 14, 165, 233), 0.12);
  color: var(--color-primary);
  display: grid;
  place-items: center;
}

.header-content h2 {
  font-size: var(--text-lg);
  font-weight: 700;
  color: var(--color-text);
  margin: 0;
}

.header-content small {
  font-size: var(--text-xs);
  color: var(--color-text-tertiary);
  display: block;
}

.close-btn {
  width: 32px;
  height: 32px;
  border-radius: var(--radius-md);
  border: none;
  background: transparent;
  color: var(--color-text-tertiary);
  display: grid;
  place-items: center;
  cursor: pointer;
  transition: all 0.2s;
}

.close-btn:hover {
  background: var(--color-bg-sunken);
  color: var(--color-text);
}

.drawer-body {
  flex: 1;
  overflow-y: auto;
  padding: var(--space-5);
  display: flex;
  flex-direction: column;
  gap: var(--space-5);
}

.drawer-section {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.section-title {
  font-size: var(--text-sm);
  font-weight: 700;
  color: var(--color-text);
  display: flex;
  align-items: center;
  gap: var(--space-2);
  margin: 0;
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
  width: 44px;
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
  transform: translateX(20px);
}

.source-options {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.radio-card {
  display: flex;
  align-items: flex-start;
  gap: var(--space-3);
  padding: var(--space-3) var(--space-4);
  border-radius: var(--radius-lg);
  border: 1px solid var(--color-border);
  background: var(--color-bg-sunken);
  cursor: pointer;
  transition: all 0.2s;
}

.radio-card:hover {
  border-color: var(--color-primary);
}

.radio-card.active {
  border-color: var(--color-primary);
  background: rgba(var(--color-primary-rgb, 14, 165, 233), 0.05);
}

.radio-card input {
  margin-top: 4px;
  accent-color: var(--color-primary);
}

.radio-content {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.radio-title {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}

.radio-title strong {
  font-size: var(--text-sm);
  color: var(--color-text);
}

.radio-content small {
  font-size: var(--text-xs);
  color: var(--color-text-secondary);
  line-height: 1.4;
}

.badge {
  font-size: 10px;
  font-weight: 700;
  padding: 1px 6px;
  border-radius: 10px;
}

.badge.free {
  background: rgba(34, 197, 94, 0.15);
  color: #16a34a;
}

.badge.custom {
  background: rgba(14, 165, 233, 0.15);
  color: var(--color-primary);
}

.form-field {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}

.form-field label {
  font-size: var(--text-xs);
  font-weight: 600;
  color: var(--color-text-secondary);
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
  font-size: 11px;
  color: var(--color-text-tertiary);
}

.checkbox-row {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  font-size: var(--text-xs);
  color: var(--color-text-secondary);
  cursor: pointer;
  margin-top: var(--space-1);
}

.checkbox-row input {
  accent-color: var(--color-primary);
}

.drawer-actions {
  display: flex;
  gap: var(--space-3);
  margin-top: auto;
  padding-top: var(--space-4);
  border-top: 1px solid var(--color-border);
}

.action-btn {
  flex: 1;
  padding: var(--space-2) var(--space-4);
  border-radius: var(--radius-md);
  font-size: var(--text-sm);
  font-weight: 600;
  cursor: pointer;
  border: 1px solid var(--color-border);
  background: var(--color-bg-sunken);
  color: var(--color-text);
  transition: all 0.2s;
}

.action-btn:hover:not(:disabled) {
  background: var(--color-bg);
}

.action-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.action-btn.primary {
  background: var(--color-primary);
  border-color: var(--color-primary);
  color: white;
}

/* Animations */
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.25s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}

.slide-enter-active,
.slide-leave-active {
  transition: transform 0.25s cubic-bezier(0.16, 1, 0.3, 1);
}

.slide-enter-from,
.slide-leave-to {
  transform: translateX(100%);
}
</style>
