import http from './http'
import type { RssArticle, RssSource } from '../types'

export function getRssSources() {
  return http.get<RssSource[]>('/getRssSources').then((r) => r.data)
}

export function saveRssSource(source: RssSource) {
  return http.post<string>('/saveRssSource', source).then((r) => r.data)
}

export function saveRssSources(sources: RssSource[]) {
  return http.post<string>('/saveRssSources', sources).then((r) => r.data)
}

export function deleteRssSource(source: Pick<RssSource, 'sourceUrl' | 'sourceName'>) {
  return http.post<string>('/deleteRssSource', source).then((r) => r.data)
}

export function deleteRssSources(sources: Pick<RssSource, 'sourceUrl' | 'sourceName'>[]) {
  return http.post<{ deleted: number }>('/deleteRssSources', sources).then((r) => r.data)
}

export function getRssArticles(params: {
  sourceUrl: string
  sortName?: string
  sortUrl?: string
  page?: number
}) {
  return http.post<{ first: RssArticle[]; second: null }>('/getRssArticles', params).then((r) => r.data)
}

export function getRssContent(params: {
  sourceUrl: string
  link: string
  origin: string
}) {
  return http.post<string>('/getRssContent', params).then((r) => r.data)
}

export async function readRemoteRssSourceFile(url: string) {
  try {
    const resp = await fetch(url)
    const text = await resp.text()
    return [text]
  } catch {
    return http.post<string[]>('/readRemoteRssSourceFile', { url }).then((r) => r.data)
  }
}

export async function readRssSourceFile(file: File): Promise<RssSource[]> {
  try {
    const text = await file.text()
    const parsed = JSON.parse(text)
    if (Array.isArray(parsed)) return parsed as RssSource[]
    if (parsed && Array.isArray(parsed.rssSources)) return parsed.rssSources as RssSource[]
    return []
  } catch {
    const formData = new FormData()
    formData.append('file', file)
    return http.post<RssSource[]>('/readRssSourceFile', formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
    }).then((r) => r.data)
  }
}
