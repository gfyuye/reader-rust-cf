<template>
  <Teleport to="body">
    <Transition name="fade">
      <div v-if="modelValue" class="modal-overlay" @click="$emit('update:modelValue', false)"></div>
    </Transition>
    <Transition name="scale">
      <div v-if="modelValue" class="modal-container" @click.self="$emit('update:modelValue', false)">
        <div class="modal-card">
          <div class="modal-header">
            <h3>分组管理</h3>
            <button class="close-btn" @click="$emit('update:modelValue', false)">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6 6 18M6 6l12 12" /></svg>
            </button>
          </div>

          <div class="modal-body">
            <div class="create-row">
              <input v-model.trim="newGroupName" class="group-input" placeholder="新建分组名称" @keyup.enter="createGroup" />
              <button class="primary-btn" :disabled="!newGroupName" @click="createGroup">新建</button>
            </div>

            <div class="group-list">
              <div
                v-for="(group, idx) in shelfStore.groups"
                :key="group.groupId"
                class="group-item"
                :class="{ 'is-dragging': draggedIndex === idx, 'drag-over': dragOverIndex === idx }"
                draggable="true"
                @dragstart="handleDragStart(idx, $event)"
                @dragover.prevent="handleDragOver(idx)"
                @dragleave="handleDragLeave(idx)"
                @drop="handleDrop(idx)"
                @dragend="handleDragEnd"
              >
                <div class="drag-handle" title="按住拖拽调整分组顺序">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14">
                    <circle cx="9" cy="5" r="1.5" fill="currentColor" />
                    <circle cx="9" cy="12" r="1.5" fill="currentColor" />
                    <circle cx="9" cy="19" r="1.5" fill="currentColor" />
                    <circle cx="15" cy="5" r="1.5" fill="currentColor" />
                    <circle cx="15" cy="12" r="1.5" fill="currentColor" />
                    <circle cx="15" cy="19" r="1.5" fill="currentColor" />
                  </svg>
                </div>
                <input
                  v-model.trim="editingNames[group.groupId]"
                  class="group-input"
                  :disabled="group.groupId === -1 || group.groupId === -2 || group.groupId === -4 || group.groupId === 0"
                />
                <span v-if="group.groupId === -1 || group.groupId === -2 || group.groupId === -4 || group.groupId === 0" class="system-tag">默认</span>
                <div class="group-actions">
                  <button
                    class="mini-btn"
                    :class="{ active: !group.hidden }"
                    :title="group.hidden ? '当前已隐藏，点击在书架显示' : '当前已显示，点击在书架隐藏'"
                    @click="shelfStore.toggleGroupVisibility(group.groupId)"
                  >
                    {{ group.hidden ? '已隐藏' : '显示中' }}
                  </button>
                  <button
                    v-if="group.groupId !== -1 && group.groupId !== -2 && group.groupId !== -4 && group.groupId !== 0"
                    class="mini-btn"
                    @click="renameGroup(group.groupId)"
                  >
                    保存
                  </button>
                  <button
                    v-if="group.groupId !== -1 && group.groupId !== -2 && group.groupId !== -4 && group.groupId !== 0"
                    class="mini-btn danger"
                    @click="deleteGroup(group.groupId, group.groupName)"
                  >
                    删除
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import { reactive, ref, watch } from 'vue'
import { useBookshelfStore } from '../../stores/bookshelf'
import { useAppStore } from '../../stores/app'

defineProps<{
  modelValue: boolean
}>()

defineEmits<{
  'update:modelValue': [value: boolean]
}>()

const shelfStore = useBookshelfStore()
const appStore = useAppStore()
const newGroupName = ref('')
const editingNames = reactive<Record<number, string>>({})

watch(() => shelfStore.groups, (groups) => {
  groups.forEach((group) => {
    editingNames[group.groupId] = group.groupName
  })
}, { immediate: true, deep: true })

async function createGroup() {
  if (!newGroupName.value) return
  try {
    await shelfStore.saveGroup(newGroupName.value)
    newGroupName.value = ''
    appStore.showToast('分组已创建', 'success')
  } catch (e: unknown) {
    appStore.showToast((e as Error).message || '创建分组失败', 'error')
  }
}

async function renameGroup(groupId: number) {
  const name = editingNames[groupId]?.trim()
  if (!name) return
  try {
    await shelfStore.saveGroup(name, groupId)
    appStore.showToast('分组已更新', 'success')
  } catch (e: unknown) {
    appStore.showToast((e as Error).message || '更新分组失败', 'error')
  }
}

async function deleteGroup(groupId: number, groupName: string) {
  if (!confirm(`确定删除分组“${groupName}”？`)) return
  try {
    await shelfStore.removeGroup(groupId)
    appStore.showToast('分组已删除', 'success')
  } catch (e: unknown) {
    appStore.showToast((e as Error).message || '删除分组失败', 'error')
  }
}

const draggedIndex = ref<number | null>(null)
const dragOverIndex = ref<number | null>(null)

function handleDragStart(index: number, event: DragEvent) {
  draggedIndex.value = index
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', String(index))
  }
}

function handleDragOver(index: number) {
  if (draggedIndex.value === null || draggedIndex.value === index) return
  dragOverIndex.value = index
}

function handleDragLeave(index: number) {
  if (dragOverIndex.value === index) {
    dragOverIndex.value = null
  }
}

async function handleDrop(targetIndex: number) {
  if (draggedIndex.value === null || draggedIndex.value === targetIndex) return
  const fromIndex = draggedIndex.value
  draggedIndex.value = null
  dragOverIndex.value = null

  await shelfStore.reorderGroups(fromIndex, targetIndex)
  appStore.showToast('分组顺序已更新', 'success')
}

function handleDragEnd() {
  draggedIndex.value = null
  dragOverIndex.value = null
}
</script>

<style scoped>
.modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.4);
  backdrop-filter: blur(4px);
  z-index: 1000;
}

.modal-container {
  position: fixed;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  padding:
    calc(24px + var(--safe-area-top))
    calc(24px + var(--safe-area-right))
    calc(24px + var(--safe-area-bottom))
    calc(24px + var(--safe-area-left));
  z-index: 1001;
}

.modal-card {
  width: min(560px, 100%);
  background: var(--color-bg-elevated);
  border-radius: 24px;
  box-shadow: var(--shadow-xl);
  overflow: hidden;
  max-height: calc(var(--app-height, 100dvh) - var(--safe-area-top) - var(--safe-area-bottom) - 32px);
  display: flex;
  flex-direction: column;
}

.modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 18px 20px;
  border-bottom: 1px solid var(--color-border-light);
}

.modal-header h3 {
  margin: 0;
  font-size: 18px;
}

.close-btn {
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 10px;
}

.close-btn svg {
  width: 18px;
  height: 18px;
}

.modal-body {
  padding: 20px;
  display: flex;
  flex-direction: column;
  gap: 16px;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
}

.create-row,
.group-item {
  display: flex;
  gap: 10px;
  align-items: center;
}

.drag-handle {
  cursor: grab;
  color: var(--color-text-tertiary);
  display: flex;
  align-items: center;
  padding: 0 4px;
  user-select: none;
}

.drag-handle:active {
  cursor: grabbing;
}

.group-item.is-dragging {
  opacity: 0.4;
}

.group-item.drag-over {
  border-top: 2px solid var(--color-primary);
}

.group-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.group-input {
  flex: 1;
  border: 1px solid var(--color-border);
  border-radius: 12px;
  padding: 10px 12px;
  background: var(--color-bg);
}

.system-tag {
  font-size: 11px;
  color: var(--color-text-tertiary);
  background: var(--color-bg-subtle, rgba(0, 0, 0, 0.05));
  padding: 2px 6px;
  border-radius: 6px;
  white-space: nowrap;
}

.group-actions {
  display: flex;
  gap: 8px;
}

.primary-btn,
.mini-btn {
  border-radius: 12px;
  border: 1px solid var(--color-border);
  padding: 10px 14px;
  cursor: pointer;
}

.primary-btn {
  background: var(--color-primary);
  border-color: var(--color-primary);
  color: #fff;
}

.mini-btn.danger {
  color: var(--color-danger);
  border-color: rgba(245, 34, 45, 0.2);
}
</style>
