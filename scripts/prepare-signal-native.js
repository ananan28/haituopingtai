'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const https = require('node:https');
const { createHash } = require('node:crypto');
const { HttpsProxyAgent } = require('https-proxy-agent');
const tar = require('tar');

// Official RingRTC artifact and checksum pinned by its npm package.
const URL = 'https://build-artifacts.signal.org/libraries/ringrtc-desktop-build-v2.71.0.tar.gz';
const SHA256 = '0b5b0560d00e090070ecac783e7869bd49412786ce8a3aac01b87ae88ea8d66f';
const FILE_HASHES = {
  "build/win32/libringrtc-arm64.node": "4675dbf733cac6068eb23274309a7abedd737e08014d5634720cdb2be7fb179f",
  "build/win32/libringrtc-x64.node": "24947601a594a3a867a1907a9a36fc540b32902bc88db97f4ae7466eb1d48f18",
  "build/darwin/libringrtc-arm64.node": "c87e1a5fd7b5561eeca9634e8a451e2a7ec5f93a61555c358483e68099a72db2",
  "build/darwin/libringrtc-x64.node": "cb81b844419c9b17316fdc16521dd33167ed2c98cf40d8a57bda707a5b7e2839",
  "build/linux/libringrtc-arm64.node": "40c20d69b3b6ce027a838ee6fa486ed4eda3f92a7ee0bba7c703974d9468e45a",
  "build/linux/libringrtc-x64.node": "550cf1fd40e0c4a5a096e73684f27f8b51608d53ef858981572dfca2230d5162"
};
const targets = [...new Set(['build/win32/libringrtc-x64.node', `build/${process.platform}/libringrtc-${process.arch}.node`])];
const destination = path.resolve(__dirname, '../signal/node_modules/@signalapp/ringrtc');
function download() {
  const proxy = process.env.HTTPS_PROXY || process.env.https_proxy;
  return new Promise((resolve, reject) => {
    const request = https.get(URL, { agent: proxy ? new HttpsProxyAgent(proxy) : undefined }, response => {
      if (response.statusCode !== 200) { response.resume(); reject(new Error('RingRTC download failed: ' + response.statusCode)); return; }
      const chunks = []; let size = 0;
      response.on('data', chunk => {
        size += chunk.length;
        if (size > 100 * 1024 * 1024) response.destroy(new Error('Native archive exceeds limit'));
        else chunks.push(chunk);
      });
      response.on('error', reject);
      response.on('end', () => resolve(Buffer.concat(chunks)));
    });
    request.setTimeout(60000, () => request.destroy(new Error('RingRTC download timeout')));
    request.on('error', reject);
  });
}
async function prepare() {
  const valid = await Promise.all(targets.map(async target => {
    try { return createHash('sha256').update(await fs.readFile(path.join(destination, target))).digest('hex') === FILE_HASHES[target]; }
    catch { return false; }
  }));
  if (valid.every(Boolean)) { console.log('PASS existing RingRTC native files match pinned hashes.'); return; }
  const bytes = process.argv[2] ? await fs.readFile(process.argv[2]) : await download();
  if (createHash('sha256').update(bytes).digest('hex') !== SHA256) throw new Error('RingRTC archive checksum mismatch');
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'haituo-ringrtc-'));
  const archive = path.join(temporary, 'native.tar.gz');
  try {
    await fs.writeFile(archive, bytes);
    // Extract into a fresh writable directory; only known build paths are accepted.
    await tar.x({ file: archive, cwd: temporary, strict: true, noChmod: true, preserveOwner: false,
      filter: name => /^build\/(?:$|(?:win32|linux|darwin)\/(?:$|libringrtc-(?:x64|arm64)\.node$))/.test(name) });
    for (const target of targets) {
      const from = path.join(temporary, target);
      const to = path.join(destination, target);
      await fs.mkdir(path.dirname(to), { recursive: true });
      await fs.copyFile(from, to);
    }
    console.log('PASS RingRTC 2.71.0 native resources restored; official SHA-256 verified.');
  } finally { await fs.rm(temporary, { recursive: true, force: true }); }
}
prepare().catch(error => { console.error(error.message); process.exitCode = 1; });
