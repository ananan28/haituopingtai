'use strict';
const { ipcRenderer } = require('electron');
const policy = require('./translation-policy');
try {
  const saved = JSON.parse(localStorage.getItem('caisheng.translation.settings.v1') || '{}');
  const appearance = Object.fromEntries(['nativeTheme', 'darkTheme', 'chatFontSize', 'chatTextColor', 'outgoingBubbleColor', 'incomingBubbleColor'].filter(key => Object.hasOwn(saved, key)).map(key => [key, saved[key]]));
  localStorage.setItem('caisheng.translation.settings.v1', JSON.stringify({ ...appearance, ...policy }));
} catch { /* A fresh profile still receives the host policy before chat initialization. */ }
window.addEventListener('unhandledrejection', event => {
  const error = event.reason;
  ipcRenderer.send('signal:renderer-error', String(error?.stack || error || 'Unknown Signal renderer error').slice(0, 12000));
});
require('./bundles/preload/wrapper.js');
