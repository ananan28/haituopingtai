const { contextBridge, ipcRenderer } = require('electron');

function bootArg(prefix) {
  const arg = process.argv.find((a) => a.startsWith(prefix));
  return arg ? decodeURIComponent(arg.slice(prefix.length)) : '';
}

const brand = {
  name: bootArg('--haituo-brand=') || '海拓商业版',
  version: bootArg('--haituo-version=') || ''
};

contextBridge.exposeInMainWorld('haituo', {
  brand,
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
  },
  distribution: {
    listProfiles: () => ipcRenderer.invoke('distribution:listProfiles'),
    promoteToAgent: (email, rate) => ipcRenderer.invoke('distribution:promoteToAgent', email, rate),
    demoteAgent: (userId) => ipcRenderer.invoke('distribution:demoteAgent', userId),
    assignAgent: (userEmail, agentEmail) => ipcRenderer.invoke('distribution:assignAgent', userEmail, agentEmail),
    listMyUsers: () => ipcRenderer.invoke('distribution:listMyUsers')
  },
  clipboard: {
    write: (text) => ipcRenderer.invoke('clipboard:write', text),
    writeImage: (dataUrl) => ipcRenderer.invoke('clipboard:writeImage', dataUrl)
  },
  ocr: {
    recognize: (dataUrl) => ipcRenderer.invoke('ocr:recognize', dataUrl)
  },
  screenshot: {
    start: (mode) => ipcRenderer.invoke('screenshot:start', mode),
    setDefault: (mode) => ipcRenderer.invoke('screenshot:setDefault', mode),
    status: () => ipcRenderer.invoke('screenshot:status'),
    onResult: (cb) => {
      const listener = (_e, payload) => cb(payload);
      ipcRenderer.on('screenshot:result', listener);
      return () => ipcRenderer.removeListener('screenshot:result', listener);
    }
  },
  windowControls: {
    minimize: () => ipcRenderer.invoke('window:minimize'),
    toggleMaximize: () => ipcRenderer.invoke('window:toggleMaximize'),
    close: () => ipcRenderer.invoke('window:close')
  }
});
