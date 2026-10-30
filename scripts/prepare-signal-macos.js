'use strict';
// Restore only the native binaries from the exact vendored package versions.
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { execFileSync } = require('node:child_process');
const tar = require('tar');
async function main() {
  if (process.platform !== 'darwin' || process.arch !== 'arm64') throw new Error('Run on an Apple Silicon macOS builder');
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'haituo-mac-native-'));
  try {
    for (const name of ['@signalapp/sqlcipher', '@signalapp/libsignal-client']) {
      const destination = path.resolve('signal/node_modules', name);
      const pkg = JSON.parse(await fs.readFile(path.join(destination, 'package.json'), 'utf8'));
      const packed = JSON.parse(execFileSync('npm', ['pack', `${name}@${pkg.version}`, '--json', '--ignore-scripts', '--pack-destination', temp], { encoding: 'utf8' }))[0];
      const relative = `prebuilds/darwin-arm64/${name.replace('/', '+')}.node`;
      const unpack = await fs.mkdtemp(path.join(temp, 'unpack-'));
      await tar.x({ file: path.join(temp, packed.filename), cwd: unpack, strict: true, filter: n => n === 'package/' + relative });
      const source = path.join(unpack, 'package', relative);
      const bytes = await fs.readFile(source);
      if (bytes.length < 1000) throw new Error('Invalid native resource ' + relative);
      await fs.mkdir(path.dirname(path.join(destination, relative)), { recursive: true });
      await fs.copyFile(source, path.join(destination, relative));
      console.log(`Restored ${name}@${pkg.version}: ${relative}; npm integrity ${packed.integrity}`);
    }
  } finally { await fs.rm(temp, { recursive: true, force: true }); }
}
main().catch(e => { console.error(e); process.exitCode = 1; });
