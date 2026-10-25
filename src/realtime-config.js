// 远程配置同步（渲染层消费者）：通过 preload 桥订阅主进程转发的 postgres_changes，
// 收到变更后局部刷新（更新内存快照 + 派发 haituo:config-change 事件 + 声明式 data-config 绑定），
// 不整页重载。写操作（owner/admin）走 window.haituo.realtimeConfig.set → 受控 RPC。
//
// 依赖：window.haituo.realtimeConfig（preload）、window.HaituoAccess（access.js）。
// 本文件为独立新文件，不修改 renderer.js/platform.js/shot-studio.js 的既有逻辑。

(() => {
  'use strict';

  const bridge = window.haituo && window.haituo.realtimeConfig;
  const Access = window.HaituoAccess;
  if (!bridge || !Access) return; // 旧 preload / 无权限层：静默降级

  let started = false;
  let cache = { public: {}, admin: {} };
  const consumers = new Map(); // key -> Set<fn(detail, cache)>
  const wildcard = new Set();   // 任意变更都触发的回调

  // 局部刷新 DOM：声明式绑定。页面元素可加 data-config-text="<key>"（取 value.text）
  // 或 data-config-json="<key>"（取 JSON 字符串）来接收对应配置的实时更新。
  function refreshDom(change) {
    if (typeof document === 'undefined') return;
    const json = (v) => (v === null || v === undefined ? '' : JSON.stringify(v));
    document.querySelectorAll('[data-config-text], [data-config-json]').forEach((el) => {
      if (el.getAttribute('data-config-text') === change.key) {
        const v = change.value;
        el.textContent = v && typeof v === 'object' ? String(v.text ?? '') : String(v ?? '');
      } else if (el.getAttribute('data-config-json') === change.key) {
        el.textContent = json(change.value);
      }
    });
  }

  // 应用一次变更：内存快照 + DOM 绑定 + 事件 + 注册的刷新回调
  function applyChange(change) {
    if (!change || typeof change.key !== 'string') return;
    const bucket = change.scope === 'admin' ? 'admin' : 'public';
    if (change.type === 'delete') delete cache[bucket][change.key];
    else cache[bucket][change.key] = change.value;
    const detail = Object.freeze({ ...change });
    refreshDom(detail);
    if (typeof window !== 'undefined' && window.dispatchEvent) {
      try { window.dispatchEvent(new CustomEvent('haituo:config-change', { detail })); } catch { /* ignore */ }
    }
    (consumers.get(change.key) || []).forEach((fn) => { try { fn(detail, cache); } catch { /* ignore */ } });
    wildcard.forEach((fn) => { try { fn(detail, cache); } catch { /* ignore */ } });
  }

  async function start() {
    if (started) return { ok: true, config: cache };
    const res = await bridge.subscribe();
    if (res && res.ok) {
      cache = {
        public: { ...(res.config && res.config.public) },
        admin: { ...(res.config && res.config.admin) }
      };
      started = true;
    }
    return { ok: Boolean(res && res.ok), config: cache, error: res && res.error };
  }

  function stop() {
    started = false;
    cache = { public: {}, admin: {} };
    try { bridge.unsubscribe(); } catch { /* ignore */ }
  }

  function getSnapshot() {
    return { public: { ...cache.public }, admin: { ...cache.admin } };
  }

  // onChange(key, fn)：某配置键变更时回调；onChange(fn)：任意变更回调。返回取消函数。
  function onChange(keyOrFn, fn) {
    if (typeof keyOrFn === 'function') { wildcard.add(keyOrFn); return () => wildcard.delete(keyOrFn); }
    let set = consumers.get(keyOrFn);
    if (!set) { set = new Set(); consumers.set(keyOrFn, set); }
    set.add(fn);
    return () => set.delete(fn);
  }

  function setConfig(key, value, scope) {
    return bridge.set(key, value, scope);
  }

  // 常驻事件监听：主进程推送即局部刷新（即使未显式 start，事件也会更新快照）
  const offEvent = bridge.onEvent(applyChange);

  // 自动接线：服务器会话建立后订阅，登出后停止；演示模式不订阅
  if (window.haituo.auth && window.haituo.auth.onAuthStateChange) {
    window.haituo.auth.onAuthStateChange((payload) => {
      const demo = Boolean(Access.get() && Access.get().demo);
      if (demo) return;
      if (payload && (payload.event === 'SIGNED_IN' || payload.event === 'INITIAL_SESSION' || payload.event === 'TOKEN_REFRESHED')) {
        start().catch(() => {});
      } else if (payload && payload.event === 'SIGNED_OUT') {
        stop();
      }
    });
  }
  // 已登录（如窗口重载）时立即尝试订阅
  if (Access.get() && !Access.get().demo) start().catch(() => {});

  Object.defineProperty(window, 'HaituoRealtimeConfig', {
    value: Object.freeze({ start, stop, getSnapshot, onChange, setConfig, applyChange, off: () => { try { offEvent(); } catch { /* ignore */ } } }),
    writable: false,
    configurable: false
  });
})();
