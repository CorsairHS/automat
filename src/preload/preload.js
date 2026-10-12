const { contextBridge, ipcRenderer } = require('electron');

/**
 * Renderer nigdy nie widzi odszyfrowanych hasel - accounts:list zwraca je zamaskowane
 * (tylko informacja "czy jest ustawione"). Pelny odczyt dziala tylko w procesie main,
 * tam gdzie docelowo uruchamia sie Playwright.
 */
contextBridge.exposeInMainWorld('api', {
  getPlatformsConfig: () => ipcRenderer.invoke('platforms:config'),
  listAccounts: (platformId, group) => ipcRenderer.invoke('accounts:list', platformId, group),
  saveAccount: (platformId, account) => ipcRenderer.invoke('accounts:save', platformId, account),
  deleteAccount: (platformId, accountId) => ipcRenderer.invoke('accounts:delete', platformId, accountId),
  getReportOrder: (group) => ipcRenderer.invoke('accounts:reportOrder', group),
  setPeriodModeForAll: (periodMode, group) => ipcRenderer.invoke('accounts:setPeriodModeAll', periodMode, group),
  duplicateToGuarantor: (platformId, accountId) => ipcRenderer.invoke('accounts:duplicateToGuarantor', platformId, accountId),
  runSync: (platformId, accountId) => ipcRenderer.invoke('sync:run', platformId, accountId),
  onSyncStatus: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('sync:status', listener);
    return () => ipcRenderer.removeListener('sync:status', listener);
  },
  runUpload: (options) => ipcRenderer.invoke('upload:run', options),
  abortSync: (platformId, accountId) => ipcRenderer.invoke('sync:abort', platformId, accountId),
  attachManualFile: (platformId, accountId, options) => ipcRenderer.invoke('downloads:attachManual', platformId, accountId, options),
  showDownloadedFile: (filePath) => ipcRenderer.invoke('downloads:showFile', filePath),
  onUploadConfirm: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('upload:confirm', listener);
    return () => ipcRenderer.removeListener('upload:confirm', listener);
  },
  replyUploadConfirm: (decision) => ipcRenderer.invoke('upload:confirmReply', decision),
  stopUpload: () => ipcRenderer.invoke('upload:stop'),
  getDownloadsStatus: () => ipcRenderer.invoke('downloads:status'),
  getGwarantDownloadsStatus: () => ipcRenderer.invoke('downloads:statusGwarant'),
  showDownloadsFolder: () => ipcRenderer.invoke('downloads:showFolder'),
  exportDownloadsZip: () => ipcRenderer.invoke('downloads:exportZip'),
  onUploadStatus: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('upload:status', listener);
    return () => ipcRenderer.removeListener('upload:status', listener);
  },
  exportAllSessions: () => ipcRenderer.invoke('sessions:exportAll'),
  importAllSessions: () => ipcRenderer.invoke('sessions:importAll'),
  runDeleteReports: () => ipcRenderer.invoke('reports:delete'),
  onDeleteStatus: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('delete:status', listener);
    return () => ipcRenderer.removeListener('delete:status', listener);
  },
  getAppVersion: () => ipcRenderer.invoke('app:version'),
  checkForUpdate: () => ipcRenderer.invoke('update:check'),
  installUpdate: () => ipcRenderer.invoke('update:install'),
  onUpdateStatus: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('update:status', listener);
    return () => ipcRenderer.removeListener('update:status', listener);
  },
});
