const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('captureOverlay', {
  ready: () => ipcRenderer.invoke('screenshot:overlay:ready'),
  complete: (payload) => ipcRenderer.invoke('screenshot:overlay:complete', payload),
  cancel: () => ipcRenderer.invoke('screenshot:overlay:cancel')
});
