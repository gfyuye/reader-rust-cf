import http from './http'

export interface RemoteWebdavConfig {
  enabled: boolean
  serverUrl: string
  webdavUser: string
  webdavPassword?: string
  hasPassword?: boolean
  syncOnChange: boolean
  syncIntervalMins: number
  lastSyncAt?: number
  lastSyncStatus?: string
  lastSyncError?: string | null
}

export function getRemoteWebdavConfig() {
  return http.get<RemoteWebdavConfig>('/user/remoteWebdav').then((r) => r.data)
}

export function saveRemoteWebdavConfig(config: RemoteWebdavConfig) {
  return http.post<string>('/user/remoteWebdav', config).then((r) => r.data)
}

export function testRemoteWebdavConnection(config: {
  serverUrl: string
  webdavUser: string
  webdavPassword?: string
}) {
  return http.post<string>('/user/remoteWebdav/test', config).then((r) => r.data)
}

export function syncRemoteWebdavNow() {
  return http.post<string>('/user/remoteWebdav/syncNow').then((r) => r.data)
}
