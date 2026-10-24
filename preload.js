const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('haituo', {
  auth: {
    status: () => ipcRenderer.invoke('auth:status'),
    signUp: (email, password) => ipcRenderer.invoke('auth:signup', email, password),
    signIn: (email, password) => ipcRenderer.invoke('auth:signin', email, password),
    signOut: () => ipcRenderer.invoke('auth:signout'),
    getSession: () => ipcRenderer.invoke('auth:session'),
    onAuthStateChange: (cb) => {
      const listener = (_e, payload) => cb(payload);
      ipcRenderer.on('auth:state', listener);
      return () => ipcRenderer.removeListener('auth:state', listener);
    }
  }
});
