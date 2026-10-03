import http from '../api/http'

export interface ChunkUploadOptions {
  file: File | Blob
  fileName: string
  target: 'bookshelf' | 'webdav'
  path?: string
  chunkSize?: number
  onProgress?: (percent: number) => void
}

export async function uploadFileChunked(options: ChunkUploadOptions): Promise<any> {
  const {
    file,
    fileName,
    target,
    path = '/',
    chunkSize = 10 * 1024 * 1024, // 10MB per slice
    onProgress,
  } = options

  const fileSize = file.size
  const totalChunks = Math.max(1, Math.ceil(fileSize / chunkSize))

  // 1. Initialize upload session
  const initRes = await http.post<{
    uploadId: string
    key: string
    chunkSize: number
  }>('/upload/init', {
    fileName,
    fileSize,
    target,
    path,
  }).then((r) => r.data)

  const { uploadId, key } = initRes
  const uploadedParts: Array<{ partNumber: number; etag: string }> = []

  // 2. Upload slices sequentially with progress tracking
  for (let i = 0; i < totalChunks; i++) {
    const start = i * chunkSize
    const end = Math.min(fileSize, start + chunkSize)
    const chunk = file.slice(start, end)
    const partNumber = i + 1

    const chunkFormData = new FormData()
    chunkFormData.append('chunk', chunk, `${fileName}.part${partNumber}`)

    const partRes = await http.post<{
      partNumber: number
      etag: string
    }>(
      `/upload/part?uploadId=${encodeURIComponent(uploadId)}&key=${encodeURIComponent(key)}&partNumber=${partNumber}`,
      chunkFormData,
      {
        headers: { 'Content-Type': 'multipart/form-data' },
        onUploadProgress: (e) => {
          if (onProgress && e.total) {
            const chunkPercent = e.loaded / e.total
            const totalPercent = Math.min(99, Math.round(((i + chunkPercent) / totalChunks) * 100))
            onProgress(totalPercent)
          }
        },
      }
    ).then((r) => r.data)

    uploadedParts.push(partRes)

    if (onProgress) {
      onProgress(Math.min(99, Math.round(((i + 1) / totalChunks) * 100)))
    }
  }

  // 3. Complete multipart upload
  const completeRes = await http.post('/upload/complete', {
    uploadId,
    key,
    parts: uploadedParts,
    fileName,
    fileSize,
    target,
    path,
  }).then((r) => r.data)

  if (onProgress) {
    onProgress(100)
  }

  return completeRes
}
