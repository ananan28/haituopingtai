'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
const asar = require('@electron/asar');
const pkg = require('../package.json');

function verify(archive) {
  const entries = new Set(asar.listPackage(archive).map(name => name.replace(/\\/g, '/').replace(/^\/+/, '')));
  const required = [
    'main.js', 'preload.js', 'src/index.html', 'src/channel-identity.js',
    'signal/index.js', 'signal/channel.js', 'signal/profiles.js',
    'signal/background.html', 'signal/bundles/main.js',
    'signal/bundles/preload/wrapper.js', 'signal/bundles/workers/sql.js',
    ...[
      '@signalapp/libsignal-client/dist/index.js',
      '@signalapp/libsignal-client/dist/Minidump.js',
      '@signalapp/ringrtc/dist/index.js', '@signalapp/sqlcipher/dist/index.cjs',
      '@signalapp/windows-ucv/dist/index.js',
      '@indutny/simple-windows-notifications/dist/index.js',
      'google-libphonenumber/dist/libphonenumber.js'
    ].map(name => 'signal/node_modules/' + name)
  ];
  for (const name of required) assert.ok(entries.has(name), 'Missing packaged resource: ' + name);
  for (const name of entries) {
    assert.ok(!/(^|\/)\.env(?:$|\.)|\.tmp\.js$|(^|\/)\.git(?:\/|$)/.test(name), 'Private/development file packaged: ' + name);
  }
  const bundled = JSON.parse(asar.extractFile(archive, 'package.json').toString('utf8'));
  assert.equal(bundled.version, pkg.version);
  assert.equal(bundled.name, 'haituo-platform');
  for (const name of [
    'signal/bundles/workers/sql.js',
    'signal/node_modules/@signalapp/sqlcipher/prebuilds/win32-x64/@signalapp+sqlcipher.node',
    'signal/node_modules/@signalapp/libsignal-client/prebuilds/win32-x64/@signalapp+libsignal-client.node'
  ]) {
    assert.ok(asar.statFile(archive, name).unpacked, 'Native/worker resource must be unpacked: ' + name);
  }
  console.log('PASS package contents: version ' + pkg.version + ', Signal resources and unpacked native files present; environment/git/test files excluded.');
  console.log('This checks archive contents, not native ABI compatibility or real Signal account login.');
}

if (require.main === module) verify(path.resolve(process.argv[2] || 'dist/win-unpacked/resources/app.asar'));
module.exports = { verify };
