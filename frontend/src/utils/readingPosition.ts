export interface SavedReadingPosition {
  chapterIndex: number
  progress: number
  updatedAt: number
  paragraphIndex?: number
  paragraphProgress?: number
}

export const READER_POSITION_PREFIX = 'reader-position:'

export function getPositionStorageKey(bookUrl?: string): string {
  return bookUrl ? `${READER_POSITION_PREFIX}${bookUrl}` : ''
}

export function getSavedReadingPosition(bookUrl?: string): SavedReadingPosition | null {
  const key = getPositionStorageKey(bookUrl)
  if (!key) return null
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return null
    const parsed = JSON.parse(raw) as SavedReadingPosition
    if (typeof parsed?.chapterIndex === 'number') {
      return parsed
    }
    return null
  } catch {
    return null
  }
}

export function saveReadingPositionToStorage(bookUrl: string, position: SavedReadingPosition): void {
  const key = getPositionStorageKey(bookUrl)
  if (!key) return
  try {
    localStorage.setItem(key, JSON.stringify(position))
  } catch {}
}
