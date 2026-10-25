'use strict';
const path = require('node:path');
const { MessageStore } = require('./message-store');

function init({ app, ipcMain, access, store = new MessageStore(path.join(app.getPath('userData'), 'messages')) }) {
  async function context(event, value, translate) {
    if (!access.trusted(event)) throw new Error('Untrusted sender');
    let identity = access.current();
    if (!identity) throw new Error('No identity');
    const revision = access.revision();
    if (!identity.demo && !identity.local) {
      const verdict = await access.authorize(translate ? 'translate' : 'account');
      if (!verdict.ok || revision !== access.revision()) throw new Error('Identity changed');
      identity = access.current();
    }
    if (!identity || !access.can(translate ? 'translate' : 'account')
      || !identity.accountIds.includes(value?.accountId)) throw new Error('Account denied');
    return { identity, revision };
  }
  for (const [method, translate] of [['put', false], ['list', false], ['translate', true]]) {
    ipcMain.handle('messages:' + method, async (event, value) => {
      try {
        const { identity, revision } = await context(event, value, translate);
        if (revision !== access.revision() || access.current()?.scope !== identity.scope) throw new Error('Identity changed');
        // Do not allow demo labels to be forged in a real identity.
        if (translate && Boolean(value.demo) !== Boolean(identity.demo)) throw new Error('Translation origin mismatch');
        const result = store[method](identity.scope, value);
        return { ok: true, records: method === 'list' ? result : undefined, record: method !== 'list' ? result : undefined };
      } catch { return { ok: false, error: '消息保存或读取失败，请检查权限或原消息是否已变更' }; }
    });
  }
  access.onChange(() => store.close());
  app.on('before-quit', () => store.close());
  return store;
}
module.exports = { init };
