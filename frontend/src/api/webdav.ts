import http from './http'
import { uploadFileChunked } from '../utils/chunkedUpload'

const LARGE_FILE_THRESHOLD = 10 * 1024 * 1024 // 10MB

export interface WebdavFileEntry {
  name: string
  size: number
  path: string
  lastModified: number
  isDirectory: boolean
}

export function getWebdavFileList(path = '/') {
  return http.get<WebdavFileEntry[]>('/getWebdavFileList', {
    params: { path },
  }).then((r) => r.data)
}

export function getWebdavFileText(path: string) {
  return http.get<string>('/getWebdavFile', {
    params: { path },
    responseType: 'text',
    transformResponse: [(value) => value],
  }).then((r) => r.data as unknown as string)
}

export function getWebdavFileBlob(path: string) {
  return http.get<Blob>('/getWebdavFile', {
    params: { path },
    responseType: 'blob',
  }).then((r) => r.data)
}

export async function uploadFilesToWebdav(
  files: Array<{ file: Blob; name: string }>,
  path = '/',
  onProgress?: (percent: number) => void
) {
  const hasLargeFile = files.some((f) => f.file.size > LARGE_FILE_THRESHOLD)
  if (hasLargeFile) {
    const totalCount = files.length
    for (let idx = 0; idx < totalCount; idx++) {
      const item = files[idx]
      if (item.file.size > LARGE_FILE_THRESHOLD) {
        await uploadFileChunked({
          file: item.file,
          fileName: item.name,
          target: 'webdav',
          path,
          onProgress: (p) => {
            if (onProgress) {
              const overall = Math.round(((idx + p / 100) / totalCount) * 100)
              onProgress(Math.min(99, overall))
            }
          },
        })
      } else {
        const formData = new FormData()
        formData.append('path', path)
        formData.append('file0', item.file, item.name)
        await http.post<WebdavFileEntry[]>('/uploadFileToWebdav', formData, {
          headers: { 'Content-Type': 'multipart/form-data' },
        })
      }
    }
    if (onProgress) onProgress(100)
    return []
  }

  const formData = new FormData()
  formData.append('path', path)
  files.forEach((item, index) => {
    formData.append(`file${index}`, item.file, item.name)
  })
  return http.post<WebdavFileEntry[]>('/uploadFileToWebdav', formData, {
    headers: {
      'Content-Type': 'multipart/form-data',
    },
    onUploadProgress: (progressEvent) => {
      if (onProgress && progressEvent.total) {
        const percent = Math.round((progressEvent.loaded * 100) / progressEvent.total)
        onProgress(percent)
      }
    },
  }).then((r) => r.data)
}

export function importWebdavBook(path: string, name: string) {
  return http.post<any>('/importWebdavBook', { path, name }).then((r) => r.data)
}

export function uploadTextToWebdav(content: string, filename: string, path = '/') {
  const blob = new Blob([content], { type: 'application/json;charset=utf-8' })
  return uploadFilesToWebdav([{ file: blob, name: filename }], path)
}

export function deleteWebdavFile(path: string) {
  return http.post<string>('/deleteWebdavFile', { path }).then((r) => r.data)
}

export function deleteWebdavFileList(paths: string[]) {
  return http.post<string>('/deleteWebdavFileList', { path: paths }).then((r) => r.data)
}
