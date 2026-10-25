'use strict';
const { ipcRenderer } = require('electron');
window.addEventListener('unhandledrejection', event => {
  const error = event.reason;
  ipcRenderer.send('signal:renderer-error', String(error?.stack || error || 'Unknown Signal renderer error').slice(0, 12000));
});
require('./bundles/preload/wrapper.js');
