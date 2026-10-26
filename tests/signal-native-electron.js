'use strict';
const { app, safeStorage } = require('electron');
const { nativeChecks } = require('./signal-native-checks');
app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  if (!safeStorage.isEncryptionAvailable()) throw new Error('OS key encryption is unavailable; native profile verification cannot pass');
  await nativeChecks(safeStorage);
  console.log('PASS Signal native checks in Electron ' + process.versions.electron + ' with OS safeStorage.');
}).then(() => app.exit(0), error => { console.error(error); app.exit(1); });
