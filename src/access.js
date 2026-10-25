(() => {
  'use strict';
  let identity = null;
  let revision = 0;

  function resetTransientState() {
    try {
      if (window.HaituoStudio && typeof window.HaituoStudio.resetSession === 'function') {
        window.HaituoStudio.resetSession();
      }
    } catch { /* 界面清理失败不得阻断身份切换 */ }
    try {
      if (typeof window.__haituoResetTransient === 'function') window.__haituoResetTransient();
    } catch { /* 同上 */ }
  }

  async function transition(operation) {
    const stamp = ++revision;
    identity = null;
    // 公开切换入口（enterDemo/signIn/signOut）必须与按钮路径一致地清空旧身份界面、截图与编辑预览，
    // 不能让任何渲染层代码绕过清理直接操作上一身份的残留状态。
    resetTransientState();
    let result;
    try { result = await operation(); }
    catch { result = { ok: false, error: '身份服务暂不可用，请重试' }; }
    if (stamp !== revision) return { ok: false, error: '身份已切换' };
    if (result.ok && result.user) {
      const user = result.user;
      identity = Object.freeze({ ...user, permissions: Object.freeze(user.permissions.slice()), accountIds: Object.freeze(user.accountIds.slice()) });
    }
    return result;
  }

  const api = Object.freeze({
    get: () => identity,
    clear: () => { revision += 1; identity = null; },
    can: (permission) => Boolean(identity && identity.permissions.includes(permission)),
    account: (id) => Boolean(identity && identity.accountIds.includes(id)),
    key: (name, accountId = '') => identity ? 'haituo.v2.' + identity.scope + '.' + encodeURIComponent(accountId) + '.' + name : null,
    refresh: () => transition(() => window.haituo.auth.getSession()),
    enterDemo: (role) => transition(() => window.haituo.auth.enterDemo(role)),
    signIn: (email, password) => transition(() => window.haituo.auth.signIn(email, password)),
    signOut: () => transition(() => window.haituo.auth.signOut())
  });
  Object.defineProperty(window, 'HaituoAccess', { value: api, writable: false, configurable: false });
})();
