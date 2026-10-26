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
  channel: { create: (channel,name) => ipcRenderer.invoke('channel:create',channel,name) },
  messages: {
    list: (value) => ipcRenderer.invoke('messages:list', value),
    put: (value) => ipcRenderer.invoke('messages:put', value),
    translate: (value) => ipcRenderer.invoke('messages:translate', value)
  },
  system: { fonts: () => ipcRenderer.invoke('system:fonts') },
  auth: {
    status: () => ipcRenderer.invoke('auth:status'),
    signUp: (email, password) => ipcRenderer.invoke('auth:signup', email, password),
    signIn: (email, password) => ipcRenderer.invoke('auth:signin', email, password),
    signOut: () => ipcRenderer.invoke('auth:signout'),
    enterDemo: (role) => ipcRenderer.invoke('auth:demo', role),
    enterLocal: () => ipcRenderer.invoke('auth:local'),
    getSession: () => ipcRenderer.invoke('auth:session'),
    onAuthStateChange: (cb) => {
      const listener = (_e, payload) => cb(payload);
      ipcRenderer.on('auth:state', listener);
      return () => ipcRenderer.removeListener('auth:state', listener);
    }
  },
  staff: {
    list: () => ipcRenderer.invoke('staff:list'),
    create: (params) => ipcRenderer.invoke('staff:create', params),
    suspend: (staffId) => ipcRenderer.invoke('staff:suspend', staffId),
    remove: (staffId) => ipcRenderer.invoke('staff:delete', staffId),
    assignChannel: (staffId, channels) => ipcRenderer.invoke('staff:assignChannel', staffId, channels),
    allocateChars: (staffId, chars) => ipcRenderer.invoke('staff:allocateChars', staffId, chars),
    resetPassword: (targetId, password) => ipcRenderer.invoke('password:reset', targetId, password),
    audit: () => ipcRenderer.invoke('audit:list')
  },
  clipboard: {
    write: (text) => ipcRenderer.invoke('clipboard:write', text),
    writeImage: (dataUrl) => ipcRenderer.invoke('clipboard:writeImage', dataUrl)
  },
  ocr: {
    recognize: (dataUrl) => ipcRenderer.invoke('ocr:recognize', dataUrl)
  },
  realtimeConfig: {
    subscribe: () => ipcRenderer.invoke('realtime-config:subscribe'),
    snapshot: () => ipcRenderer.invoke('realtime-config:snapshot'),
    set: (key, value, scope) => ipcRenderer.invoke('realtime-config:set', key, value, scope),
    unsubscribe: () => ipcRenderer.invoke('realtime-config:unsubscribe'),
    onEvent: (cb) => {
      const listener = (_e, payload) => cb(payload);
      ipcRenderer.on('realtime-config:event', listener);
      return () => ipcRenderer.removeListener('realtime-config:event', listener);
    }
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
  webchannels: {
    open: (accountId, channel) => ipcRenderer.invoke('webchannels:open', accountId, channel),
    setBounds: (accountId, rect) => ipcRenderer.invoke('webchannels:setBounds', accountId, rect),
    setVisible: (accountId, visible) => ipcRenderer.invoke('webchannels:setVisible', accountId, visible),
    sleep: (accountId) => ipcRenderer.invoke('webchannels:sleep', accountId),
    refresh: (accountId) => ipcRenderer.invoke('webchannels:refresh', accountId),
    destroyAll: () => ipcRenderer.invoke('webchannels:destroyAll'),
    onEvent: (cb) => {
      const listener = (_e, payload) => cb(payload);
      ipcRenderer.on('webchannels:event', listener);
      return () => ipcRenderer.removeListener('webchannels:event', listener);
    }
  },
  signal: {
    open: (accountId) => ipcRenderer.invoke('signal:open', accountId),
    setBounds: (accountId, rect) => ipcRenderer.invoke('signal:setBounds', accountId, rect),
    setVisible: (accountId, visible) => ipcRenderer.invoke('signal:setVisible', accountId, visible),
    sleep: (accountId) => ipcRenderer.invoke('signal:sleep', accountId),
    refresh: (accountId) => ipcRenderer.invoke('signal:refresh', accountId),
    destroyAll: () => ipcRenderer.invoke('signal:destroyAll')
  },
  windowControls: {
    minimize: () => ipcRenderer.invoke('window:minimize'),
    toggleMaximize: () => ipcRenderer.invoke('window:toggleMaximize'),
    close: () => ipcRenderer.invoke('window:close')
  },
  appSettings: {
    get: () => ipcRenderer.invoke('app-settings:get'),
    set: (partial) => ipcRenderer.invoke('app-settings:set', partial),
    checkUpdate: () => ipcRenderer.invoke('app-settings:checkUpdate'),
    onTheme: (cb) => {
      const listener = (_e, payload) => cb(payload);
      ipcRenderer.on('app-settings:theme', listener);
      return () => ipcRenderer.removeListener('app-settings:theme', listener);
    },
    onUpdateState: (cb) => {
      const listener = (_e, payload) => cb(payload);
      ipcRenderer.on('app-settings:update-state', listener);
      return () => ipcRenderer.removeListener('app-settings:update-state', listener);
    }
  }
});
