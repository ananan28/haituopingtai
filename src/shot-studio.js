/* =========================================================
   翻译服务商三级裁决 + 截屏翻译工作台（v1）
   - 服务商：客户单次手动 > 客户默认偏好 > 本地预览顺序逐级降级
   - 计费：翻译字符 × 服务商千字符单价（演示模拟额度）
   - 截屏：主窗内结果页，OCR 永远读取未标注原图
   ========================================================= */

(function () {
  'use strict';

  const PROVIDERS = window.HAITUO_TRANSLATE_PROVIDERS || [];
  const POLICY = window.HAITUO_PROVIDER_POLICY || {
    defaultChain: PROVIDERS.map((p) => p.id),
    customerPlan: 'team',
    billingUnit: '翻译字符',
    rules: []
  };
  const GLOSSARY = window.HAITUO_GLOSSARY || [];
  const SHOT = window.HAITUO_SCREENSHOT || {
    hotkey: 'Alt+Shift+S',
    defaultMode: 'translate',
    modes: [
      { id: 'copy', name: '复制图片', hint: '纯截图，不 OCR 不翻译' },
      { id: 'extract', name: '提取文字', hint: '只输出原文，可复制' },
      { id: 'translate', name: '翻译', hint: 'OCR + 翻译 + 术语库' },
      { id: 'edit', name: '编辑', hint: '先标注再翻译' }
    ],
    tools: [],
    palette: ['#ff5a67', '#ff8a3d', '#f6b73c', '#ffe066', '#b18cff', '#7c5cf0',
      '#4d9bff', '#45d0e6', '#ff6fb5', '#ffffff', '#aab2c0', '#111318'],
    defaults: { highlighter: '#ffe066', pen: '#ff5a67', text: '#ffffff' },
    mosaicGrain: [{ value: 6, name: '细' }, { value: 12, name: '中' }, { value: 24, name: '粗' }]
  };

  const STORAGE = {
    admin: 'haituo.providerAdmin.v1',
    customerDefault: 'haituo.customerDefaultProvider',
    defaultMode: 'haituo.screenshotDefaultMode',
    recentColors: 'haituo.shotRecentColors'
  };
  const PACKAGE_IDS = ['free', 'pro', 'team'];
  const PACKAGE_LABELS = { free: '免费', pro: '专业', team: '团队' };
  const MODE_NAMES = {};
  SHOT.modes.forEach((m) => { MODE_NAMES[m.id] = m.name; });
  const MODE_IDS = new Set(SHOT.modes.map((m) => m.id));

  function toast(text) {
    if (typeof window.showGlobalToast === 'function') window.showGlobalToast(text);
  }

  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, (c) => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
  }

  const access = window.HaituoAccess;
  let sessionRevision = 0;
  let operationRevision = 0;

  function permitted(permission) {
    if (access.can(permission)) return true;
    toast('当前身份没有此操作权限');
    return false;
  }

  function readStorage(key, fallback) {
    try {
      const scoped = access.key(key);
      const raw = scoped ? localStorage.getItem(scoped) : null;
      return raw == null ? fallback : raw;
    } catch {
      return fallback;
    }
  }

  function writeStorage(key, value) {
    try {
      const scoped = access.key(key);
      if (!scoped) return false;
      localStorage.setItem(scoped, value);
      return true;
    } catch { return false; }
  }

  function readJson(key, fallback) {
    try { return JSON.parse(readStorage(key, 'null')) ?? fallback; }
    catch { return fallback; }
  }

  function writeJson(key, value) {
    return writeStorage(key, JSON.stringify(value));
  }

  function deepCopy(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function round2(n) {
    return Math.round(n * 100) / 100;
  }

  function charCount(text) {
    return String(text == null ? '' : text).replace(/\s+/g, '').length;
  }

  /* ---------- 服务商状态 ---------- */

  function defaultAdmin() {
    const out = { order: [], enabled: {}, prices: {}, packages: {} };
    PROVIDERS.forEach((p) => {
      out.order.push(p.id);
      out.enabled[p.id] = p.enabled !== false;
      out.prices[p.id] = p.pricePerK;
      out.packages[p.id] = Array.isArray(p.packages) ? p.packages.slice() : PACKAGE_IDS.slice();
    });
    return out;
  }

  function loadAdmin() {
    const base = defaultAdmin();
    const saved = access.can('providers') ? readJson(STORAGE.admin, null) : null;
    if (!saved || typeof saved !== 'object') return base;
    const order = Array.isArray(saved.order)
      ? saved.order.filter((id) => Object.prototype.hasOwnProperty.call(base.enabled, id))
      : [];
    base.order.forEach((id) => { if (!order.includes(id)) order.push(id); });
    base.order = order;
    base.order.forEach((id) => {
      if (saved.enabled && typeof saved.enabled[id] === 'boolean') base.enabled[id] = saved.enabled[id];
      const price = Number(saved.prices && saved.prices[id]);
      if (Number.isFinite(price) && price > 0) base.prices[id] = round2(Math.min(999, Math.max(0.1, price)));
      if (saved.packages && Array.isArray(saved.packages[id])) {
        const kept = saved.packages[id].filter((x) => PACKAGE_IDS.includes(x));
        if (kept.length) base.packages[id] = kept;
      }
    });
    return base;
  }

  let admin = loadAdmin();

  function saveAdmin() {
    if (!permitted('providers')) return false;
    return writeJson(STORAGE.admin, admin);
  }

  function commitAdmin(message) {
    const saved = saveAdmin();
    if (!saved) admin = loadAdmin();
    renderProviderPanel();
    refreshBoundSelects();
    if (!saved) toast('本地预览保存失败，未发布任何配置');
    else if (message) toast(message + '（仅本地预览，未发布）');
    return saved;
  }

  function providerBase(id) {
    return PROVIDERS.find((p) => p.id === id) || null;
  }

  function providerInfo(id) {
    const base = providerBase(id);
    if (!base) return null;
    return {
      id: base.id,
      name: base.name,
      vendor: base.vendor,
      note: base.note,
      price: Number(admin.prices[id]) || base.pricePerK,
      enabled: Boolean(admin.enabled[id]),
      packages: Array.isArray(admin.packages[id]) ? admin.packages[id].slice() : []
    };
  }

  function providerName(id) {
    const p = providerBase(id);
    return p ? p.name : id;
  }

  function packageVisible(id) {
    const info = providerInfo(id);
    return Boolean(info && info.packages.includes(POLICY.customerPlan));
  }

  function isUsable(id) {
    return Boolean(providerBase(id)) && Boolean(admin.enabled[id]) && packageVisible(id);
  }

  function backendOrder() {
    return admin.order.filter((id) => Boolean(providerBase(id)));
  }

  function usableIds() {
    return backendOrder().filter(isUsable);
  }

  function resolveChain(manualId) {
    const usable = usableIds();
    if (!usable.length) return [];
    if (manualId && usable.includes(manualId)) {
      return [manualId, ...usable.filter((id) => id !== manualId)];
    }
    const preferred = getCustomerDefault();
    if (preferred) {
      return [preferred, ...usable.filter((id) => id !== preferred)];
    }
    return usable;
  }

  function activeProvider(manualId) {
    const chain = resolveChain(manualId);
    return chain.length ? providerInfo(chain[0]) : null;
  }

  function chainNames(chain) {
    return chain.map(providerName).join(' → ');
  }

  function providerChainLabel(manualId) {
    const chain = resolveChain(manualId);
    if (!chain.length) return '未启用任何服务商，自动翻译暂停';
    const prefix = manualId && chain[0] === manualId
      ? '本次手动：'
      : (getCustomerDefault() && chain[0] === getCustomerDefault() ? '客户偏好：' : '本地预览顺序：');
    return prefix + chainNames(chain);
  }

  function getCustomerDefault() {
    const id = readStorage(STORAGE.customerDefault, '');
    return id && isUsable(id) ? id : '';
  }

  function setCustomerDefault(id) {
    if (!permitted('translate')) return false;
    if (typeof id !== 'string' || (id && !isUsable(id))) return false;
    if (!writeStorage(STORAGE.customerDefault, id)) return false;
    refreshBoundSelects();
    return id;
  }

  function providerOptionsHtml(selected, autoText) {
    const usable = usableIds();
    const current = selected && usable.includes(selected) ? selected : '';
    const head = `<option value="">${esc(autoText || '自动（按本地预览顺序降级）')}</option>`;
    const list = usable.map((id) => {
      const p = providerInfo(id);
      return `<option value="${esc(id)}"${current === id ? ' selected' : ''}>${esc(p.name)} · ${esc(p.price)} 模拟额度/千字符</option>`;
    }).join('');
    return head + list;
  }

  function customerDefaultSelectHtml() {
    return `<label class="fx-field"><span>客户默认服务商</span>
      <select class="fx-select" id="fx-default-provider">${providerOptionsHtml(getCustomerDefault(), '自动（不指定客户偏好）')}</select>
      <small>单次手动选择始终优先；未指定时按本地预览顺序逐级降级。</small>
    </label>
    <p class="fx-note" id="fx-chain-label">当前链路：${esc(providerChainLabel())}</p>`;
  }

  function panelProviderSelectHtml() {
    return `<label class="fx-field"><span>本次翻译服务商</span>
      <select class="fx-select" id="fx-tr-provider">${providerOptionsHtml('', '自动（本地预览顺序 / 客户偏好）')}</select>
      <small id="fx-tr-chain">${esc(providerChainLabel())}</small>
    </label>`;
  }

  function refreshBoundSelects() {
    const defaultSelect = document.getElementById('fx-default-provider');
    if (defaultSelect) {
      const current = getCustomerDefault();
      defaultSelect.innerHTML = providerOptionsHtml(current, '自动（不指定客户偏好）');
    }
    const chainLabel = document.getElementById('fx-chain-label');
    if (chainLabel) chainLabel.textContent = '当前链路：' + providerChainLabel();
    const trSelect = document.getElementById('fx-tr-provider');
    if (trSelect) {
      const current = trSelect.value;
      trSelect.innerHTML = providerOptionsHtml(current, '自动（本地预览顺序 / 客户偏好）');
      if (current && !usableIds().includes(current)) trSelect.value = '';
    }
    const trChain = document.getElementById('fx-tr-chain');
    if (trChain) trChain.textContent = providerChainLabel();
  }

  /* ---------- 计费与演示翻译 ---------- */

  const usage = { chars: 0, cost: 0, calls: 0 };

  function applyGlossary(text) {
    let out = String(text);
    GLOSSARY.forEach((term) => {
      const safe = String(term.from).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      out = out.replace(new RegExp(safe, 'gi'), term.to);
    });
    return out;
  }

  const DEMO_TRANSLATIONS = [
    [/^please use passkey to sign in\.?$/i, '请使用通行密钥登录。'],
    [/^proforma invoice\s*[·\-]\s*fob shenzhen\.?$/i, '形式发票 · 离岸价深圳'],
    [/^order a-2048 shipped, arriving in lyon in 3 days\.?$/i, '订单 A-2048 已发货，预计 3 天后到达里昂。'],
    [/^merci, je confirme la réception\.?$/i, '谢谢，我确认已收到。'],
    [/^contact:\s*sophie bernard\s*·\s*\+33 7 88 20 14 09$/i, '联系人：Sophie Bernard · +33 7 88 20 14 09'],
    [/^bonjour, je souhaite commander 20 pièces\.?$/i, '您好，我想订购 20 件。能否提供一份正式报价？'],
    [/^bonjour, je souhaite connaître le prix pour 50 pièces\.?$/i, '您好，我想了解 50 件的价格。'],
    [/^bonjour, merci pour votre message\.\s*voici notre meilleur prix pour 20 pièces…?$/i, '您好，感谢来信。这是我们 20 件的最优价格…'],
    [/^votre colis est en transit\.\s*livraison prévue sous 48 heures\.?$/i, '您的包裹正在运输中，预计 48 小时内送达。']
  ];

  function translateLine(text) {
    const raw = String(text == null ? '' : text).trim();
    if (!raw) return '';
    for (const [pattern, output] of DEMO_TRANSLATIONS) {
      if (pattern.test(raw)) return applyGlossary(output);
    }
    return applyGlossary('（演示译文）' + raw);
  }

  function billTranslation(provider, chars) {
    const cost = round2((chars * provider.price) / 1000);
    usage.chars += chars;
    usage.cost = round2(usage.cost + cost);
    usage.calls += 1;
    updateUsageUI();
    return cost;
  }

  function updateUsageUI() {
    const session = '本地模拟：' + usage.chars + ' 字符 / ' + usage.cost.toFixed(2) + ' 模拟额度；未调用真实 API，不扣账户余额';
    const providerUsage = document.getElementById('provider-usage');
    if (providerUsage) providerUsage.textContent = session;
    const shotBilling = document.getElementById('shot-billing');
    if (shotBilling) shotBilling.textContent = '本地模拟（不扣账户余额）· ' + usage.chars + ' 字符 / ' + usage.cost.toFixed(2) + ' 模拟额度';
  }

  function runPanelTranslation(text, manualId) {
    if (!permitted('translate')) return { ok: false, error: '当前身份没有翻译权限' };
    const raw = String(text == null ? '' : text);
    if (raw.length > 10000) return { ok: false, error: '本地模拟最多支持 10000 字符' };
    const source = raw.trim();
    if (!source) return { ok: false, error: '请先输入原文' };
    if (manualId && !providerBase(manualId)) return { ok: false, error: '无效服务商' };
    const chain = resolveChain(manualId);
    if (!chain.length) return { ok: false, error: '未启用任何翻译服务商，请联系平台管理员' };
    const provider = providerInfo(chain[0]);
    const chars = charCount(source);
    const translation = source.split(/\r?\n/).map(translateLine).join('\n');
    const cost = billTranslation(provider, chars);
    return {
      ok: true,
      translation,
      provider,
      chain,
      chars,
      cost,
      demo: true,
      meta: provider.name + ' · 模拟 ' + chars + ' 字符 · 模拟成本 ' + cost.toFixed(2) + ' 模拟额度 · 本地预览链路 ' + chainNames(chain) + '（未发布，未调用真实 API，不扣账户余额）'
    };
  }

  /* ---------- 服务商运营面板 ---------- */

  function providerRowsHtml() {
    return backendOrder().map((id) => {
      const info = providerInfo(id);
      const packages = PACKAGE_IDS.map((pkg) => `<label><input type="checkbox" data-provider-pkg="${pkg}" data-provider="${esc(id)}"${info.packages.includes(pkg) ? ' checked' : ''} />${PACKAGE_LABELS[pkg]}</label>`).join('');
      return `<div class="provider-row" draggable="true" data-provider="${esc(id)}">
        <div class="provider-id">
          <span class="provider-handle" title="拖拽排序">⋮⋮</span>
          <span class="provider-mark">${esc(info.name.slice(0, 1))}</span>
          <div class="provider-copy">
            <strong>${esc(info.name)}</strong>
            <small>${esc(info.vendor)} · ${esc(info.note || '')}</small>
          </div>
        </div>
        <div class="provider-packages">${packages}</div>
        <div class="provider-price">
          <input type="number" min="0.1" max="999" step="0.1" value="${esc(info.price)}" data-provider-price data-provider="${esc(id)}" />
          <span>模拟额度 / 千字符</span>
        </div>
        <button class="provider-status${info.enabled ? ' is-on' : ''}" type="button" data-provider-toggle data-provider="${esc(id)}">${info.enabled ? '启用' : '停用'}</button>
      </div>`;
    }).join('');
  }

  function clearProviderPanel() {
    ['provider-rows', 'provider-chain'].forEach((id) => {
      const node = document.getElementById(id);
      if (node) node.replaceChildren();
    });
    const modal = document.getElementById('provider-modal');
    if (modal) modal.hidden = true;
    draggingProviderId = '';
  }

  function renderProviderPanel() {
    if (!access.can('providers')) { clearProviderPanel(); return false; }
    const chain = document.getElementById('provider-chain');
    if (chain) {
      chain.innerHTML = backendOrder().map((id) => {
        const info = providerInfo(id);
        const usable = isUsable(id);
        return `<span class="provider-pill${usable ? '' : ' is-off'}">${esc(info.name)}<em>${usable ? esc(info.price) + ' 模拟额度' : '停用 / 不可见'}</em></span>`;
      }).join('<span class="provider-arrow">→</span>') || '<span class="provider-pill is-off">暂无服务商</span>';
    }
    const rows = document.getElementById('provider-rows');
    if (rows) rows.innerHTML = providerRowsHtml();
    updateUsageUI();
  }

  function openProviderPanel() {
    if (!permitted('providers')) { clearProviderPanel(); return false; }
    renderProviderPanel();
    const modal = document.getElementById('provider-modal');
    if (modal) modal.hidden = false;
    return Boolean(modal);
  }

  let draggingProviderId = '';

  function bindProviderPanel() {
    const modal = document.getElementById('provider-modal');
    const rows = document.getElementById('provider-rows');
    if (!modal || !rows) return;

    const guard = (e) => {
      if (access.can('providers')) return true;
      e.preventDefault();
      e.stopImmediatePropagation();
      clearProviderPanel();
      return false;
    };
    ['click', 'change', 'input', 'dragstart', 'dragover', 'drop', 'dragend'].forEach((type) => {
      modal.addEventListener(type, guard, true);
    });

    modal.addEventListener('click', (e) => {
      if (!guard(e)) return;
      const toggle = e.target.closest('[data-provider-toggle]');
      if (toggle) {
        const id = toggle.dataset.provider;
        if (!providerBase(id)) return;
        admin.enabled[id] = !admin.enabled[id];
        commitAdmin(admin.enabled[id] ? '已启用 ' + providerName(id) : '已停用 ' + providerName(id));
        return;
      }
      if (e.target.closest('#provider-save')) commitAdmin('预览配置已保存');
    });

    modal.addEventListener('change', (e) => {
      if (!guard(e)) return;
      const pkg = e.target.closest('[data-provider-pkg]');
      if (pkg) {
        const id = pkg.dataset.provider;
        const name = pkg.dataset.providerPkg;
        if (!providerBase(id) || !PACKAGE_IDS.includes(name)) return;
        let list = (admin.packages[id] || []).slice();
        if (pkg.checked && !list.includes(name)) list.push(name);
        if (!pkg.checked) list = list.filter((x) => x !== name);
        if (!list.length) {
          toast('至少要保留一个可见套餐');
          pkg.checked = true;
          return;
        }
        admin.packages[id] = list;
        commitAdmin();
        return;
      }
      const price = e.target.closest('[data-provider-price]');
      if (price) {
        const id = price.dataset.provider;
        if (!providerBase(id)) return;
        let value = Number(price.value);
        if (!Number.isFinite(value) || value <= 0) value = providerInfo(id).price;
        value = round2(Math.min(999, Math.max(0.1, value)));
        admin.prices[id] = value;
        price.value = String(value);
        commitAdmin();
      }
    });

    rows.addEventListener('dragstart', (e) => {
      if (!guard(e)) return;
      const row = e.target.closest('.provider-row');
      if (!row || !providerBase(row.dataset.provider)) { e.preventDefault(); return; }
      draggingProviderId = row.dataset.provider;
      row.classList.add('is-dragging');
      if (e.dataTransfer) {
        e.dataTransfer.effectAllowed = 'move';
        try { e.dataTransfer.setData('text/plain', draggingProviderId); } catch { /* ignore */ }
      }
    });

    rows.addEventListener('dragover', (e) => {
      if (!guard(e) || !providerBase(draggingProviderId)) return;
      e.preventDefault();
      const row = e.target.closest('.provider-row');
      rows.querySelectorAll('.provider-row').forEach((r) => {
        r.classList.toggle('is-drop-target', Boolean(row) && r === row && r.dataset.provider !== draggingProviderId);
      });
    });

    rows.addEventListener('drop', (e) => {
      if (!guard(e) || !providerBase(draggingProviderId)) return;
      e.preventDefault();
      const row = e.target.closest('.provider-row');
      const targetId = row && row.dataset.provider;
      const moving = draggingProviderId;
      draggingProviderId = '';
      rows.querySelectorAll('.provider-row').forEach((r) => r.classList.remove('is-drop-target', 'is-dragging'));
      if (!providerBase(targetId) || targetId === moving) return;
      const order = admin.order.slice();
      const from = order.indexOf(moving);
      const targetIndex = order.indexOf(targetId);
      if (from < 0) return;
      order.splice(from, 1);
      const to = order.indexOf(targetId);
      const insertAt = to < 0 ? order.length : (from < targetIndex ? to + 1 : to);
      order.splice(insertAt, 0, moving);
      admin.order = order;
      commitAdmin('已调整预览降级顺序');
    });

    rows.addEventListener('dragend', (e) => {
      if (!guard(e)) return;
      draggingProviderId = '';
      rows.querySelectorAll('.provider-row').forEach((r) => r.classList.remove('is-drop-target', 'is-dragging'));
    });
  }

  /* ---------- 截屏工作台：图标与静态结构 ---------- */

  const svg = (body) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;

  const TOOL_ICONS = {
    pen: svg('<path d="m4 20 4.6-1L20 7.5 16.5 4 5 15.4 4 20Z"/><path d="m14.5 6 3.5 3.5"/>'),
    highlighter: svg('<path d="m8 15 7-9 4 3-7 9"/><path d="m8 15-3 1 1 4 4-1"/><path d="M4 21h7"/>'),
    arrow: svg('<path d="M4 20 20 4"/><path d="M12 4h8v8"/>'),
    rect: svg('<rect x="4" y="5" width="16" height="14" rx="1"/>'),
    rounded: svg('<rect x="4" y="5" width="16" height="14" rx="4"/>'),
    ellipse: svg('<ellipse cx="12" cy="12" rx="8" ry="6"/>'),
    mosaic: svg('<rect x="4" y="4" width="4.5" height="4.5"/><rect x="15.5" y="4" width="4.5" height="4.5"/><rect x="9.8" y="9.8" width="4.5" height="4.5"/><rect x="4" y="15.5" width="4.5" height="4.5"/><rect x="15.5" y="15.5" width="4.5" height="4.5"/>'),
    text: svg('<path d="M5 5h14"/><path d="M12 5v14"/><path d="M8 19h8"/>'),
    number: svg('<circle cx="12" cy="12" r="8.5"/><path d="M10.4 9.6 12 8.4V16"/>'),
    eraser: svg('<path d="m5 15 8-8a2 2 0 0 1 3 0l3 3a2 2 0 0 1 0 3l-6 6H7l-2-2a2 2 0 0 1 0-2Z"/><path d="m11 9 6 6"/><path d="M9 20h11"/>'),
    pointer: svg('<path d="m7 4 11 7.2-4.8 1.2 2.6 5.2-2.5 1.2-2.6-5.2L7 16.2Z"/>'),
    history: svg('<path d="M4 12a8 8 0 1 0 2.4-5.7"/><path d="M4 4v4.5h4.5"/><path d="M12 8v4.5l3 1.8"/>'),
    undo: svg('<path d="M9 7 4 12l5 5"/><path d="M4 12h9a5.5 5.5 0 0 1 0 11"/>'),
    redo: svg('<path d="m15 7 5 5-5 5"/><path d="M20 12h-9a5.5 5.5 0 0 0 0 11"/>'),
    eyedrop: svg('<path d="m4 20 1-4 9-9 3 3-9 9-4 1Z"/><path d="m12.5 6.5 3-3a2.1 2.1 0 0 1 3 3l-3 3"/>')
  };

  /* ---------- 截屏工作台：状态 ---------- */

  const DEMO_LINES = [
    'Please use Passkey to sign in.',
    'Proforma Invoice · FOB Shenzhen',
    'Order A-2048 shipped, arriving in Lyon in 3 days.',
    'Merci, je confirme la réception.',
    'Contact: Sophie Bernard · +33 7 88 20 14 09'
  ];

  const TOOL_SIZE_OPTIONS = {
    pen: [2, 4, 6, 8],
    highlighter: [10, 16, 22, 30],
    eraser: [12, 20, 30, 40],
    text: [14, 18, 24, 32],
    number: [18, 24, 32],
    pointer: [18, 24, 32]
  };

  const studio = {
    open: false,
    demo: false,
    mode: SHOT.defaultMode,
    sourceImage: '',
    image: null,
    tool: 'pen',
    color: SHOT.defaults.pen,
    toolColors: {
      pen: SHOT.defaults.pen,
      highlighter: SHOT.defaults.highlighter,
      text: SHOT.defaults.text
    },
    toolSizes: { pen: 4, highlighter: 18, eraser: 20, text: 18, number: 24, pointer: 24 },
    mosaicMode: 'brush',
    grain: (SHOT.mosaicGrain[1] && SHOT.mosaicGrain[1].value) || 12,
    textStroke: true,
    strokes: [],
    snapshots: [],
    snapIndex: -1,
    current: null,
    drawing: false,
    erasing: false,
    erased: false,
    numbers: 0,
    pick: false,
    textPoint: null,
    ocr: null,
    translation: null,
    loading: '',
    error: '',
    manualEngine: '',
    copied: false,
    shots: [],
    activeShotId: '',
    recentColors: (() => {
      const saved = readJson(STORAGE.recentColors, []);
      return Array.isArray(saved) ? saved.filter((x) => /^#[0-9a-f]{6}$/i.test(x)).slice(0, 6) : [];
    })()
  };

  const els = {};
  const baseCanvas = document.createElement('canvas');
  const baseCtx = baseCanvas.getContext('2d', { willReadFrequently: true });
  const mosaicTmp = document.createElement('canvas');
  const MAX_PNG_URL = 24 * 1024 * 1024;

  function safeImageSize(width, height) {
    return width > 0 && height > 0 && width <= 16384 && height <= 16384
      && width * height <= 32 * 1024 * 1024;
  }

  function validPng(dataUrl) {
    if (typeof dataUrl !== 'string' || dataUrl.length > MAX_PNG_URL
      || !dataUrl.startsWith('data:image/png;base64,')) return false;
    const encoded = dataUrl.slice(22);
    if (encoded.length < 44 || encoded.length % 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) return false;
    try {
      const header = atob(encoded.slice(0, 44));
      if (header.slice(0, 8) !== '\x89PNG\r\n\x1a\n' || header.slice(12, 16) !== 'IHDR') return false;
      const view = new DataView(Uint8Array.from(header, (c) => c.charCodeAt(0)).buffer);
      return view.getUint32(8) === 13 && safeImageSize(view.getUint32(16), view.getUint32(20));
    } catch { return false; }
  }

  function sessionGuard(permission = 'screenshot') {
    const session = sessionRevision;
    const identity = access.get();
    const scope = identity && identity.scope;
    const revision = identity && identity.revision;
    return () => {
      const current = access.get();
      return Boolean(identity && current && access.can(permission) && session === sessionRevision
        && current.scope === scope && current.revision === revision);
    };
  }

  function operationGuard() {
    const validSession = sessionGuard();
    const operation = operationRevision;
    const shotId = studio.activeShotId;
    return () => validSession() && operation === operationRevision
      && Boolean(shotId) && shotId === studio.activeShotId && studio.open;
  }

  function cacheStudioEls() {
    els.root = document.getElementById('shot-studio');
    if (!els.root) return;
    els.sub = document.getElementById('shot-sub');
    els.modes = document.getElementById('shot-modes');
    els.hotkey = document.getElementById('shot-hotkey');
    els.close = document.getElementById('shot-close');
    els.stage = document.getElementById('shot-stage');
    els.canvas = document.getElementById('shot-canvas');
    els.ctx = els.canvas ? els.canvas.getContext('2d', { willReadFrequently: true }) : null;
    els.textInput = document.getElementById('shot-text-input');
    els.toolbar = document.getElementById('shot-toolbar');
    els.palette = document.getElementById('shot-palette');
    els.sideKicker = document.getElementById('shot-side-kicker');
    els.sideTitle = document.getElementById('shot-side-title');
    els.sideBadge = document.getElementById('shot-side-badge');
    els.sideBody = document.getElementById('shot-side-body');
    els.engineWrap = els.root.querySelector('.shot-engine');
    els.engine = document.getElementById('shot-engine');
    els.engineNote = document.getElementById('shot-engine-note');
    els.copy = document.getElementById('shot-copy');
    els.insert = document.getElementById('shot-insert');
    els.again = document.getElementById('shot-again');
    els.recent = document.getElementById('shot-recent');
    els.billing = document.getElementById('shot-billing');
  }

  /* ---------- 截屏工作台：渲染 ---------- */

  function updateHotkeyUI() {
    if (els.hotkey) els.hotkey.textContent = String(SHOT.hotkey || 'Alt+Shift+S').replace(/\+/g, ' + ');
  }

  function renderModes() {
    if (!els.modes) return;
    const icons = { copy: '图', extract: '字', translate: '译', edit: '编' };
    els.modes.innerHTML = SHOT.modes.map((m) => `<button class="shot-mode${studio.mode === m.id ? ' is-active' : ''}" type="button" role="tab" aria-selected="${studio.mode === m.id}" data-shot-mode="${esc(m.id)}" title="${esc(m.hint)}">
      <b class="shot-mode-icon">${esc(icons[m.id] || '·')}</b><span>${esc(m.name)}</span>
    </button>`).join('');
  }

  function historyButtonsHtml() {
    const canUndo = studio.snapIndex > 0;
    const canRedo = studio.snapIndex >= 0 && studio.snapIndex < studio.snapshots.length - 1;
    return `<div class="shot-tool-history" title="撤销 / 重做">
      <button type="button" data-undo title="撤销"${canUndo ? '' : ' disabled'}>${TOOL_ICONS.undo}</button>
      <button type="button" data-redo title="重做"${canRedo ? '' : ' disabled'}>${TOOL_ICONS.redo}</button>
    </div>`;
  }

  function toolSelectHtml(options, value, attr) {
    return `<select class="shot-tool-option" ${attr}>${options.map((n) => `<option value="${n}"${Number(value) === Number(n) ? ' selected' : ''}>${n}</option>`).join('')}</select>`;
  }

  function toolOptionsHtml() {
    const tool = studio.tool;
    if (tool === 'pen' || tool === 'highlighter' || tool === 'eraser') {
      return `<span class="shot-tool-sep"></span><span class="shot-tool-label">粗细</span>${toolSelectHtml(TOOL_SIZE_OPTIONS[tool], studio.toolSizes[tool], 'data-shot-size')}`;
    }
    if (tool === 'mosaic') {
      const grains = (SHOT.mosaicGrain || []).map((g) => `<option value="${g.value}"${Number(studio.grain) === Number(g.value) ? ' selected' : ''}>${esc(g.name)}</option>`).join('');
      return `<span class="shot-tool-sep"></span><span class="shot-tool-label">方式</span>
        <button class="shot-tool-option${studio.mosaicMode === 'brush' ? ' is-on' : ''}" type="button" data-mosaic-mode="brush">涂抹</button>
        <button class="shot-tool-option${studio.mosaicMode === 'region' ? ' is-on' : ''}" type="button" data-mosaic-mode="region">一键区域</button>
        <span class="shot-tool-label">颗粒</span><select class="shot-tool-option" data-shot-grain>${grains}</select>`;
    }
    if (tool === 'text') {
      return `<span class="shot-tool-sep"></span><span class="shot-tool-label">字号</span>${toolSelectHtml(TOOL_SIZE_OPTIONS.text, studio.toolSizes.text, 'data-shot-text-size')}
        <label class="shot-tool-label"><input type="checkbox" data-shot-text-stroke${studio.textStroke ? ' checked' : ''} /> 描边</label>`;
    }
    if (tool === 'number' || tool === 'pointer') {
      return `<span class="shot-tool-sep"></span><span class="shot-tool-label">大小</span>${toolSelectHtml(TOOL_SIZE_OPTIONS[tool], studio.toolSizes[tool], 'data-shot-mark-size')}`;
    }
    return '';
  }

  function renderToolbar() {
    if (!els.toolbar) return;
    const tools = (SHOT.tools && SHOT.tools.length ? SHOT.tools : [
      { id: 'pen', name: '画笔' }, { id: 'highlighter', name: '荧光笔' }, { id: 'arrow', name: '箭头' },
      { id: 'rect', name: '方框' }, { id: 'rounded', name: '圆角框' }, { id: 'ellipse', name: '椭圆' },
      { id: 'mosaic', name: '马赛克' }, { id: 'text', name: '文字' }, { id: 'number', name: '序号标记' },
      { id: 'eraser', name: '橡皮擦' }, { id: 'history', name: '撤销重做' }, { id: 'pointer', name: '指针标记' }
    ]);
    els.toolbar.innerHTML = tools.map((tool) => {
      if (tool.id === 'history') return historyButtonsHtml();
      return `<button class="shot-tool${studio.tool === tool.id ? ' is-active' : ''}" type="button" data-shot-tool="${esc(tool.id)}" title="${esc(tool.name)}">${TOOL_ICONS[tool.id] || TOOL_ICONS.pen}</button>`;
    }).join('') + toolOptionsHtml();
    updateHistoryButtons();
  }

  function updateHistoryButtons() {
    if (!els.toolbar) return;
    const undo = els.toolbar.querySelector('[data-undo]');
    const redo = els.toolbar.querySelector('[data-redo]');
    if (undo) undo.disabled = studio.snapIndex <= 0;
    if (redo) redo.disabled = studio.snapIndex < 0 || studio.snapIndex >= studio.snapshots.length - 1;
  }

  function paintPaletteColors() {
    if (!els.palette) return;
    els.palette.querySelectorAll('[data-color]').forEach((btn) => {
      btn.style.background = btn.dataset.color;
      btn.classList.toggle('is-active', String(btn.dataset.color).toLowerCase() === String(studio.color).toLowerCase() && studio.tool !== 'mosaic');
    });
    const current = els.palette.querySelector('[data-current-color]');
    if (current) current.style.background = studio.tool === 'mosaic' ? '#9aa1b1' : studio.color;
    const text = els.palette.querySelector('[data-color-text]');
    if (text) text.textContent = studio.tool === 'mosaic' ? '纯灰' : studio.color.toUpperCase();
  }

  function renderPalette() {
    if (!els.palette) return;
    const swatches = (SHOT.palette || []).map((color) => `<button class="shot-swatch" type="button" data-color="${esc(color)}" title="${esc(color)}" aria-label="${esc(color)}"></button>`).join('');
    const recents = [];
    for (let i = 0; i < 6; i += 1) {
      const color = studio.recentColors[i];
      if (color) recents.push(`<button class="shot-recent-item" type="button" data-color="${esc(color)}" title="最近使用 ${esc(color)}"></button>`);
      else recents.push('<span class="shot-recent-item is-empty" title="暂无最近颜色"></span>');
    }
    const note = studio.tool === 'mosaic'
      ? '马赛克固定纯灰，颗粒 ' + esc(studio.grain) + '·' + esc(studio.mosaicMode === 'region' ? '区域' : '涂抹')
      : (studio.tool === 'highlighter' ? '荧光笔半透明叠加' : '文字默认白字黑描边');
    els.palette.innerHTML = `<span class="shot-tool-label">快捷色</span>
      <div class="shot-swatches${studio.tool === 'mosaic' ? ' is-muted' : ''}">${swatches}</div>
      <span class="shot-palette-sep"></span>
      <span class="shot-tool-label">最近</span>
      <div class="shot-recents">${recents.join('')}</div>
      <span class="shot-palette-sep"></span>
      <button class="shot-eyedrop${studio.pick ? ' is-active' : ''}" type="button" data-eyedrop title="从图片取色">${TOOL_ICONS.eyedrop}<span>取色</span></button>
      <span class="shot-palette-sep"></span>
      <span class="shot-color-chip"><i data-current-color></i><span data-color-text></span></span>
      <span class="shot-palette-note">${note}</span>`;
    paintPaletteColors();
  }

  function renderEngine() {
    if (!els.engine || !els.engineNote) return;
    if (!['translate', 'edit'].includes(studio.mode)) {
      if (els.engineWrap) els.engineWrap.hidden = true;
      return;
    }
    if (els.engineWrap) els.engineWrap.hidden = false;
    els.engine.innerHTML = providerOptionsHtml(studio.manualEngine, '自动（按本地预览顺序降级）');
    els.engine.value = studio.manualEngine && usableIds().includes(studio.manualEngine) ? studio.manualEngine : '';
    const chain = resolveChain(studio.manualEngine);
    if (!chain.length) {
      els.engineNote.textContent = '未启用任何服务商，翻译暂停；请联系平台管理员。';
      return;
    }
    const provider = providerInfo(chain[0]);
    els.engineNote.textContent = providerChainLabel(studio.manualEngine) + '；本次使用 ' + provider.name + '（' + provider.price + ' 模拟额度/千字符，演示）';
  }

  function currentText() {
    if (studio.mode === 'copy') return '';
    if (studio.mode === 'extract') {
      return studio.ocr && studio.ocr.lines ? studio.ocr.lines.join('\n') : '';
    }
    if (studio.translation && studio.translation.pairs) {
      return studio.translation.pairs.map((pair) => pair.to).join('\n');
    }
    return '';
  }

  function linesHtml(pairs, withTranslation) {
    return `<div class="shot-lines">${pairs.map((pair, index) => `<div class="shot-line">
      <span class="shot-line-no">${String(index + 1).padStart(2, '0')}</span>
      <div class="shot-line-copy">
        <div class="shot-line-text">${esc(pair.from)}</div>
        ${withTranslation ? `<div class="shot-line-tr">${esc(pair.to)}</div>` : ''}
      </div>
    </div>`).join('')}</div>`;
  }

  function setSideHead(kicker, title, badge) {
    if (els.sideKicker) els.sideKicker.textContent = kicker;
    if (els.sideTitle) els.sideTitle.textContent = title;
    if (els.sideBadge) els.sideBadge.textContent = badge;
  }

  function renderSide() {
    if (!els.sideBody) return;
    const mode = studio.mode;
    if (els.copy) els.copy.textContent = mode === 'copy' ? '复制图片' : '复制全文';
    if (els.insert) els.insert.hidden = mode === 'copy';
    if (els.again) els.again.hidden = mode === 'copy';
    if (els.copy) els.copy.disabled = !studio.image || !access.can('screenshot');
    if (els.insert) els.insert.disabled = !studio.image || !access.can('screenshot');
    if (els.again) els.again.disabled = !studio.image || !access.can('screenshot');
    if (!studio.sourceImage || !access.can('screenshot')) {
      setSideHead('SCREENSHOT', '截屏工作台', '本地预览');
      els.sideBody.innerHTML = '<div class="shot-empty">暂无截图。仅有截屏权限的身份可以开始。</div>';
      return;
    }

    if (studio.loading) {
      setSideHead(mode === 'extract' ? 'OCR' : 'OCR + TRANSLATE', mode === 'extract' ? '识别文字' : '识别并翻译', '原图识别');
      els.sideBody.innerHTML = `<div class="shot-loading"><span class="shot-spinner"></span><span>${esc(studio.loading === 'translate' ? '正在按服务商链路翻译…' : '正在读取未标注原图…')}</span></div>`;
      return;
    }

    if (mode === 'copy') {
      setSideHead('SCREENSHOT', '纯截图', studio.copied ? '已复制' : '未复制');
      els.sideBody.innerHTML = `<div class="shot-empty">${studio.copied ? '截图已复制到剪贴板。' : '纯截图模式：不执行 OCR、不调用翻译。'}<br/>仍可使用下方工具标注，再点「复制图片」导出带标注版本。</div>`;
      return;
    }

    if (!studio.ocr) {
      setSideHead(mode === 'extract' ? 'OCR' : 'OCR + TRANSLATE', mode === 'extract' ? '识别文字' : '识别与译文', '原图');
      if (studio.error) {
        els.sideBody.innerHTML = `<div class="shot-error">${esc(studio.error)}</div>
          <button class="hp-ghost" type="button" data-shot-retry>重新识别</button>`;
      } else {
        els.sideBody.innerHTML = '<div class="shot-empty">等待识别结果…</div>';
      }
      return;
    }

    const lang = studio.ocr.lang || 'OCR';
    if (mode === 'extract') {
      setSideHead('OCR', '识别文字', '原图 · 不受涂鸦影响');
      const pairs = studio.ocr.lines.map((line) => ({ from: line, to: '' }));
      els.sideBody.innerHTML = `<div class="shot-result-meta">
          <span class="shot-meta-pill is-accent">${esc(lang)}</span>
          <span class="shot-meta-pill">${pairs.length} 行 · ${charCount(studio.ocr.lines.join(''))} 字符</span>
          <span class="shot-meta-pill">未执行翻译</span>
        </div>${linesHtml(pairs, false)}`;
      return;
    }

    setSideHead('OCR + TRANSLATE', '识别与译文', '原图 · 演示引擎');
    if (!studio.translation) {
      els.sideBody.innerHTML = '<div class="shot-empty">等待翻译结果…</div>';
      return;
    }
    if (studio.translation.error) {
      els.sideBody.innerHTML = `<div class="shot-error">${esc(studio.translation.error)}</div>
        ${linesHtml(studio.ocr.lines.map((line) => ({ from: line, to: '' })), false)}
        <button class="hp-ghost" type="button" data-shot-retry>重试翻译</button>`;
      return;
    }
    const tr = studio.translation;
    els.sideBody.innerHTML = `<div class="shot-result-meta">
        <span class="shot-meta-pill is-accent">${esc(tr.provider.name)} · 演示</span>
        <span class="shot-meta-pill">${tr.pairs.length} 行</span>
        <span class="shot-meta-pill">${tr.chars} 字符 · ${tr.cost.toFixed(2)} 模拟额度</span>
        <span class="shot-meta-pill">${esc(tr.chain.map(providerName).join(' → '))}</span>
      </div>
      ${linesHtml(tr.pairs, true)}
      <p class="fx-note">本地未发布预览：未调用真实服务商 API，不扣账户余额；术语库已注入，OCR 读取未标注原图。</p>`;
  }

  function updateBillingUI() {
    if (!els.billing) return;
    els.billing.textContent = '本地模拟（不扣账户余额）· ' + usage.chars + ' 字符 / ' + usage.cost.toFixed(2) + ' 模拟额度';
  }

  function formatTime(time) {
    const date = time instanceof Date ? time : new Date(time);
    if (Number.isNaN(date.getTime())) return '--:--';
    return String(date.getHours()).padStart(2, '0') + ':' + String(date.getMinutes()).padStart(2, '0');
  }

  function updateRecentStrip() {
    if (!els.recent) return;
    if (!studio.shots.length) {
      els.recent.innerHTML = '<span class="shot-thumb-empty">完成一次选区后会显示在这里</span>';
      return;
    }
    els.recent.innerHTML = studio.shots.map((shot) => `<button class="shot-thumb${shot.id === studio.activeShotId ? ' is-active' : ''}" type="button" data-shot-id="${esc(shot.id)}" title="继续编辑最近截图">
      ${shot.thumb ? `<img src="${esc(shot.thumb)}" alt="" draggable="false" />` : ''}
      <span>${esc(MODE_NAMES[shot.mode] || shot.mode)} · ${esc(formatTime(shot.time))}</span>
    </button>`).join('');
  }

  function renderAll() {
    renderModes();
    renderToolbar();
    renderPalette();
    renderEngine();
    renderSide();
    updateRecentStrip();
    updateBillingUI();
  }

  /* ---------- 截屏工作台：画布与工具 ---------- */

  function canvasScale() {
    if (!els.canvas) return 1;
    const rect = els.canvas.getBoundingClientRect();
    if (!rect.width) return 1;
    return els.canvas.width / rect.width;
  }

  function pointFromEvent(e) {
    const rect = els.canvas.getBoundingClientRect();
    if (!(rect.width > 0 && rect.height > 0 && els.canvas.width > 0 && els.canvas.height > 0)
      || !Number.isFinite(e.clientX) || !Number.isFinite(e.clientY)) return null;
    return {
      x: Math.max(0, Math.min(els.canvas.width - 1, (e.clientX - rect.left) * (els.canvas.width / rect.width))),
      y: Math.max(0, Math.min(els.canvas.height - 1, (e.clientY - rect.top) * (els.canvas.height / rect.height)))
    };
  }

  function circledNumber(n) {
    const glyphs = '①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳';
    return n >= 1 && n <= 20 ? glyphs[n - 1] : String(n);
  }

  function renderCanvas() {
    if (!els.ctx || !baseCanvas.width) return;
    const ctx = els.ctx;
    ctx.clearRect(0, 0, els.canvas.width, els.canvas.height);
    ctx.drawImage(baseCanvas, 0, 0);
    studio.strokes.forEach((stroke) => drawStroke(ctx, stroke));
    if (studio.current) drawStroke(ctx, studio.current);
  }

  function drawStroke(ctx, stroke) {
    if (!stroke) return;
    const width = stroke.width || 4;
    ctx.save();
    if (stroke.type === 'pen' || stroke.type === 'highlighter') {
      if (!stroke.points || !stroke.points.length) { ctx.restore(); return; }
      ctx.globalAlpha = stroke.type === 'highlighter' ? 0.35 : 1;
      ctx.strokeStyle = stroke.color;
      ctx.lineWidth = width;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      ctx.moveTo(stroke.points[0].x, stroke.points[0].y);
      for (let i = 1; i < stroke.points.length; i += 1) {
        ctx.lineTo(stroke.points[i].x, stroke.points[i].y);
      }
      ctx.stroke();
    } else if (stroke.type === 'arrow') {
      const from = stroke.from;
      const to = stroke.to;
      const angle = Math.atan2(to.y - from.y, to.x - from.x);
      const head = Math.max(10, width * 3.4);
      ctx.strokeStyle = stroke.color;
      ctx.fillStyle = stroke.color;
      ctx.lineWidth = width;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(from.x, from.y);
      ctx.lineTo(to.x, to.y);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(to.x, to.y);
      ctx.lineTo(to.x - head * Math.cos(angle - Math.PI / 7), to.y - head * Math.sin(angle - Math.PI / 7));
      ctx.lineTo(to.x - head * Math.cos(angle + Math.PI / 7), to.y - head * Math.sin(angle + Math.PI / 7));
      ctx.closePath();
      ctx.fill();
    } else if (stroke.type === 'rect' || stroke.type === 'rounded' || stroke.type === 'ellipse') {
      const x = Math.min(stroke.from.x, stroke.to.x);
      const y = Math.min(stroke.from.y, stroke.to.y);
      const w = Math.abs(stroke.to.x - stroke.from.x);
      const h = Math.abs(stroke.to.y - stroke.from.y);
      ctx.strokeStyle = stroke.color;
      ctx.lineWidth = width;
      ctx.beginPath();
      if (stroke.type === 'rect') ctx.rect(x, y, w, h);
      else if (stroke.type === 'rounded') ctx.roundRect(x, y, w, h, Math.min(18, Math.max(6, width * 2.4)));
      else ctx.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
      ctx.stroke();
    } else if (stroke.type === 'mosaic') {
      if (stroke.mode === 'region') {
        const x = Math.min(stroke.from.x, stroke.to.x);
        const y = Math.min(stroke.from.y, stroke.to.y);
        mosaicPatch(ctx, x, y, Math.abs(stroke.to.x - stroke.from.x), Math.abs(stroke.to.y - stroke.from.y), stroke.grain);
      } else if (stroke.points) {
        const radius = Math.max(stroke.grain * 2, 8);
        stroke.points.forEach((point) => {
          mosaicPatch(ctx, point.x - radius, point.y - radius, radius * 2, radius * 2, stroke.grain);
        });
      }
    } else if (stroke.type === 'text') {
      ctx.font = '600 ' + stroke.size + 'px "Segoe UI", "Microsoft YaHei", sans-serif';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'alphabetic';
      if (stroke.stroke) {
        ctx.lineWidth = Math.max(2, stroke.size / 8);
        ctx.strokeStyle = 'rgba(0, 0, 0, 0.72)';
        ctx.lineJoin = 'round';
        ctx.strokeText(stroke.text, stroke.x, stroke.y);
      }
      ctx.fillStyle = stroke.color;
      ctx.fillText(stroke.text, stroke.x, stroke.y);
    } else if (stroke.type === 'number') {
      const glyph = circledNumber(stroke.n);
      ctx.font = '600 ' + stroke.size + 'px "Segoe UI Symbol", "Segoe UI", sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.lineWidth = Math.max(2, stroke.size / 9);
      ctx.strokeStyle = 'rgba(0, 0, 0, 0.6)';
      ctx.strokeText(glyph, stroke.x, stroke.y);
      ctx.fillStyle = stroke.color;
      ctx.fillText(glyph, stroke.x, stroke.y);
    } else if (stroke.type === 'pointer') {
      const k = stroke.size / 24;
      ctx.translate(stroke.x, stroke.y);
      ctx.scale(k, k);
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(0, 17);
      ctx.lineTo(4.4, 13.2);
      ctx.lineTo(7.4, 20.2);
      ctx.lineTo(10.6, 18.8);
      ctx.lineTo(7.6, 11.9);
      ctx.lineTo(13, 11.8);
      ctx.closePath();
      ctx.fillStyle = stroke.color;
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
      ctx.lineWidth = 1.4;
      ctx.fill();
      ctx.stroke();
    }
    ctx.restore();
  }

  function mosaicPatch(ctx, x, y, w, h, grain) {
    const sx = Math.max(0, Math.floor(x));
    const sy = Math.max(0, Math.floor(y));
    const sw = Math.min(baseCanvas.width - sx, Math.ceil(w));
    const sh = Math.min(baseCanvas.height - sy, Math.ceil(h));
    if (sw < 1 || sh < 1) return;
    const block = Math.max(3, Math.round(grain || 12));
    const tw = Math.max(1, Math.ceil(sw / block));
    const th = Math.max(1, Math.ceil(sh / block));
    mosaicTmp.width = tw;
    mosaicTmp.height = th;
    const tctx = mosaicTmp.getContext('2d', { willReadFrequently: true });
    tctx.clearRect(0, 0, tw, th);
    tctx.drawImage(baseCanvas, sx, sy, sw, sh, 0, 0, tw, th);
    const image = tctx.getImageData(0, 0, tw, th);
    const data = image.data;
    for (let i = 0; i < data.length; i += 4) {
      const gray = Math.round(data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114);
      data[i] = gray;
      data[i + 1] = gray;
      data[i + 2] = gray;
      data[i + 3] = 255;
    }
    tctx.putImageData(image, 0, 0);
    ctx.save();
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(mosaicTmp, 0, 0, tw, th, sx, sy, sw, sh);
    ctx.restore();
  }

  function strokeHit(stroke, point, radius) {
    const pad = radius + (stroke.width || 0) / 2;
    if (stroke.points) {
      return stroke.points.some((pt) => Math.hypot(pt.x - point.x, pt.y - point.y) <= pad);
    }
    if (stroke.type === 'mosaic' && stroke.mode === 'region') {
      const x = Math.min(stroke.from.x, stroke.to.x);
      const y = Math.min(stroke.from.y, stroke.to.y);
      return point.x >= x - pad && point.x <= x + Math.abs(stroke.to.x - stroke.from.x) + pad
        && point.y >= y - pad && point.y <= y + Math.abs(stroke.to.y - stroke.from.y) + pad;
    }
    if (stroke.from && stroke.to) {
      const box = {
        x: Math.min(stroke.from.x, stroke.to.x) - pad,
        y: Math.min(stroke.from.y, stroke.to.y) - pad,
        w: Math.abs(stroke.to.x - stroke.from.x) + pad * 2,
        h: Math.abs(stroke.to.y - stroke.from.y) + pad * 2
      };
      return point.x >= box.x && point.x <= box.x + box.w && point.y >= box.y && point.y <= box.y + box.h;
    }
    if (stroke.type === 'text') {
      const w = String(stroke.text || '').length * stroke.size * 0.62;
      return point.x >= stroke.x - pad && point.x <= stroke.x + w + pad
        && point.y >= stroke.y - stroke.size - pad && point.y <= stroke.y + pad;
    }
    if (stroke.type === 'number' || stroke.type === 'pointer') {
      return Math.hypot(stroke.x - point.x, stroke.y - point.y) <= stroke.size + radius;
    }
    return false;
  }

  function eraseAt(point) {
    const before = studio.strokes.length;
    studio.strokes = studio.strokes.filter((stroke) => !strokeHit(stroke, point, studio.toolSizes.eraser * canvasScale() * 0.6));
    if (studio.strokes.length !== before) studio.erased = true;
  }

  function resetHistory() {
    studio.snapshots = [deepCopy(studio.strokes)];
    studio.snapIndex = 0;
    updateHistoryButtons();
  }

  function commitHistory() {
    const snapshot = deepCopy(studio.strokes);
    studio.snapshots = studio.snapshots.slice(0, studio.snapIndex + 1);
    studio.snapshots.push(snapshot);
    if (studio.snapshots.length > 60) studio.snapshots.shift();
    studio.snapIndex = studio.snapshots.length - 1;
    updateHistoryButtons();
  }

  function undo() {
    if (studio.snapIndex <= 0) return;
    studio.snapIndex -= 1;
    studio.strokes = deepCopy(studio.snapshots[studio.snapIndex]);
    studio.numbers = maxNumber(studio.strokes);
    renderCanvas();
    updateHistoryButtons();
  }

  function redo() {
    if (studio.snapIndex < 0 || studio.snapIndex >= studio.snapshots.length - 1) return;
    studio.snapIndex += 1;
    studio.strokes = deepCopy(studio.snapshots[studio.snapIndex]);
    studio.numbers = maxNumber(studio.strokes);
    renderCanvas();
    updateHistoryButtons();
  }

  function maxNumber(strokes) {
    return strokes.reduce((max, stroke) => (stroke.type === 'number' ? Math.max(max, stroke.n || 0) : max), 0);
  }

  function pushRecentColor(color) {
    const hex = String(color).toLowerCase();
    if (!/^#[0-9a-f]{6}$/.test(hex)) return;
    studio.recentColors = [hex, ...studio.recentColors.filter((x) => x !== hex)].slice(0, 6);
    writeJson(STORAGE.recentColors, studio.recentColors);
  }

  function setColor(color) {
    studio.color = color;
    if (studio.tool === 'pen' || studio.tool === 'highlighter' || studio.tool === 'text') {
      studio.toolColors[studio.tool] = color;
    }
    pushRecentColor(color);
    renderPalette();
  }

  function selectTool(tool) {
    if (!tool) return;
    studio.tool = tool;
    studio.pick = false;
    if (tool === 'pen') studio.color = studio.toolColors.pen;
    if (tool === 'highlighter') studio.color = studio.toolColors.highlighter;
    if (tool === 'text') studio.color = studio.toolColors.text;
    if (els.canvas) els.canvas.style.cursor = tool === 'text' ? 'text' : (tool === 'pointer' ? 'pointer' : 'crosshair');
    renderToolbar();
    renderPalette();
  }

  function pickColor(e) {
    const point = pointFromEvent(e);
    if (!point) return;
    const x = Math.max(0, Math.min(els.canvas.width - 1, Math.floor(point.x)));
    const y = Math.max(0, Math.min(els.canvas.height - 1, Math.floor(point.y)));
    const data = els.ctx.getImageData(x, y, 1, 1).data;
    const hex = '#' + [data[0], data[1], data[2]].map((v) => v.toString(16).padStart(2, '0')).join('');
    studio.pick = false;
    setColor(hex);
    toast('已取色 ' + hex.toUpperCase());
  }

  function openTextInput(point) {
    const rect = els.canvas.getBoundingClientRect();
    const stageRect = els.stage.getBoundingClientRect();
    const scale = rect.width / els.canvas.width;
    const left = (point.x * scale) + (rect.left - stageRect.left);
    const top = (point.y * scale) + (rect.top - stageRect.top);
    studio.textPoint = point;
    els.textInput.value = '';
    els.textInput.hidden = false;
    els.textInput.style.left = Math.max(4, Math.min(left, stageRect.width - 160)) + 'px';
    els.textInput.style.top = Math.max(4, top - 30) + 'px';
    els.textInput.style.fontSize = Math.max(11, Math.min(20, studio.toolSizes.text * scale)) + 'px';
    const valid = operationGuard();
    setTimeout(() => { if (valid() && studio.textPoint === point) els.textInput.focus(); }, 0);
  }

  function hideTextInput() {
    studio.textPoint = null;
    if (els.textInput) {
      els.textInput.hidden = true;
      els.textInput.value = '';
    }
  }

  function commitTextInput() {
    if (!access.can('screenshot') || !studio.open || !studio.image || !studio.textPoint || !els.textInput) return;
    const text = els.textInput.value.trim();
    const point = studio.textPoint;
    if (text) {
      studio.strokes.push({
        type: 'text',
        x: point.x,
        y: point.y,
        text,
        color: studio.color,
        size: studio.toolSizes.text * canvasScale(),
        stroke: studio.textStroke
      });
      commitHistory();
      renderCanvas();
    }
    hideTextInput();
  }

  function addNumber(point) {
    studio.numbers += 1;
    studio.strokes.push({
      type: 'number',
      x: point.x,
      y: point.y,
      n: studio.numbers,
      color: studio.color,
      size: studio.toolSizes.number * canvasScale()
    });
    commitHistory();
    renderCanvas();
  }

  function addPointer(point) {
    studio.strokes.push({
      type: 'pointer',
      x: point.x,
      y: point.y,
      color: studio.color,
      size: studio.toolSizes.pointer * canvasScale()
    });
    commitHistory();
    renderCanvas();
  }

  function onCanvasDown(e) {
    if (!access.can('screenshot') || !studio.image || e.button !== 0 || !studio.open) return;
    if (studio.pick) {
      pickColor(e);
      return;
    }
    const point = pointFromEvent(e);
    if (!point) return;
    if (studio.tool === 'text') {
      commitTextInput();
      openTextInput(point);
      return;
    }
    if (studio.tool === 'number') {
      addNumber(point);
      return;
    }
    if (studio.tool === 'pointer') {
      addPointer(point);
      return;
    }
    if (studio.tool === 'eraser') {
      studio.erasing = true;
      studio.erased = false;
      eraseAt(point);
      renderCanvas();
      try { els.canvas.setPointerCapture(e.pointerId); } catch { /* ignore */ }
      return;
    }
    const scale = canvasScale();
    const grain = Math.max(4, studio.grain * scale);
    if (studio.tool === 'mosaic') {
      studio.current = studio.mosaicMode === 'region'
        ? { type: 'mosaic', mode: 'region', grain, from: point, to: point }
        : { type: 'mosaic', mode: 'brush', grain, points: [point] };
    } else if (studio.tool === 'pen' || studio.tool === 'highlighter') {
      studio.current = {
        type: studio.tool,
        color: studio.color,
        width: studio.toolSizes[studio.tool] * scale,
        points: [point]
      };
    } else {
      studio.current = {
        type: studio.tool,
        color: studio.color,
        width: studio.toolSizes[studio.tool] * scale || 4 * scale,
        from: point,
        to: point
      };
    }
    studio.drawing = true;
    try { els.canvas.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    renderCanvas();
  }

  function onCanvasMove(e) {
    if (!access.can('screenshot') || !studio.image || !studio.open) return;
    const point = pointFromEvent(e);
    if (!point) return;
    if (studio.erasing) {
      eraseAt(point);
      renderCanvas();
      return;
    }
    if (!studio.drawing || !studio.current) return;
    const current = studio.current;
    if (current.points) {
      const last = current.points[current.points.length - 1];
      if (!last || Math.hypot(point.x - last.x, point.y - last.y) >= 1.2) current.points.push(point);
    } else {
      current.to = point;
    }
    renderCanvas();
  }

  function onCanvasUp() {
    if (!access.can('screenshot') || !studio.image || !studio.open) return;
    if (studio.erasing) {
      studio.erasing = false;
      if (studio.erased) commitHistory();
      return;
    }
    if (!studio.drawing || !studio.current) return;
    studio.drawing = false;
    const current = studio.current;
    studio.current = null;
    let valid = true;
    if (current.points) {
      valid = current.points.length > 1;
    } else if (current.type === 'mosaic' && current.mode === 'region') {
      valid = Math.abs(current.to.x - current.from.x) > 5 && Math.abs(current.to.y - current.from.y) > 5;
    } else {
      valid = Math.hypot(current.to.x - current.from.x, current.to.y - current.from.y) > 4;
    }
    if (valid) {
      studio.strokes.push(current);
      commitHistory();
    }
    renderCanvas();
  }

  /* ---------- 截屏工作台：OCR / 翻译 / 剪贴板 ---------- */

  function demoImage() {
    const canvas = document.createElement('canvas');
    canvas.width = 1360;
    canvas.height = 860;
    const ctx = canvas.getContext('2d');
    const grad = ctx.createLinearGradient(0, 0, 1360, 860);
    grad.addColorStop(0, '#191c23');
    grad.addColorStop(1, '#0e1015');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 1360, 860);

    ctx.fillStyle = '#1a1d24';
    ctx.beginPath();
    ctx.roundRect(80, 64, 1200, 732, 16);
    ctx.fill();
    ctx.fillStyle = '#242833';
    ctx.beginPath();
    ctx.roundRect(80, 64, 1200, 52, [16, 16, 0, 0]);
    ctx.fill();
    ctx.fillStyle = '#2b3040';
    ctx.fillRect(80, 116, 300, 680);
    ctx.fillStyle = '#1e222b';
    ctx.fillRect(380, 116, 900, 680);
    ctx.fillStyle = '#8f96a8';
    ctx.font = '600 18px "Segoe UI", sans-serif';
    ctx.fillText('Haitup Workbench · WhatsApp 会话', 110, 98);
    ctx.fillStyle = '#eef0f6';
    ctx.font = '600 21px "Segoe UI", sans-serif';
    ctx.fillText('Léa Martin · +33 6 12 34 56 78', 420, 160);
    ctx.fillStyle = '#767e90';
    ctx.font = '14px "Segoe UI", sans-serif';
    ctx.fillText('法国 · 里昂 · 在线', 420, 185);

    function bubble(text, x, y, color, fg) {
      ctx.font = '18px "Segoe UI", "Microsoft YaHei", sans-serif';
      const width = Math.min(700, ctx.measureText(text).width + 48);
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.roundRect(x, y, width, 54, 13);
      ctx.fill();
      ctx.fillStyle = fg;
      ctx.fillText(text, x + 22, y + 34);
    }

    bubble('Please use Passkey to sign in.', 430, 240, '#2a2e39', '#eef0f6');
    bubble('Proforma Invoice · FOB Shenzhen', 680, 330, '#4a3b86', '#f0ecff');
    bubble('Order A-2048 shipped, arriving in Lyon in 3 days.', 430, 430, '#2a2e39', '#eef0f6');
    bubble('Merci, je confirme la réception.', 680, 520, '#4a3b86', '#f0ecff');
    bubble('Contact: Sophie Bernard · +33 7 88 20 14 09', 430, 620, '#2a2e39', '#c8cede');

    ctx.fillStyle = '#242833';
    ctx.beginPath();
    ctx.roundRect(410, 700, 840, 62, 12);
    ctx.fill();
    ctx.fillStyle = '#7f8798';
    ctx.font = '15px "Segoe UI", sans-serif';
    ctx.fillText('输入消息，Enter 发送 · Shift + Enter 换行', 434, 737);

    return canvas.toDataURL('image/png');
  }

  function recognizeImage() {
    if (!access.can('screenshot') || !validPng(studio.sourceImage)) {
      return Promise.resolve({ ok: false, error: '截屏权限或 PNG 图片无效' });
    }
    if (studio.demo) {
      return Promise.resolve({ ok: true, lines: DEMO_LINES.slice(), lang: 'zh-Hans-CN', demo: true });
    }
    const api = window.haituo && window.haituo.ocr;
    if (!api || !api.recognize) {
      return Promise.resolve({ ok: false, error: '当前环境不支持 OCR（仅桌面端可用）' });
    }
    return Promise.resolve(api.recognize(studio.sourceImage))
      .then((res) => {
        if (!res || !res.ok) return { ok: false, error: (res && res.error) || 'OCR 识别失败' };
        const lines = (res.lines || []).map((line) => String(line || '').trim()).filter(Boolean);
        if (!lines.length) return { ok: false, error: '未识别到文字，请框选更清晰的区域' };
        return { ok: true, lines, lang: res.lang || 'OCR' };
      })
      .catch((err) => ({ ok: false, error: err.message || 'OCR 识别失败' }));
  }

  async function ensureOcr(force, valid = operationGuard()) {
    if (!valid() || !studio.image) return false;
    if (studio.ocr && !force) return true;
    studio.loading = 'ocr';
    studio.error = '';
    studio.translation = null;
    renderSide();
    let result;
    try { result = await recognizeImage(); }
    catch (err) { result = { ok: false, error: err.message || 'OCR 识别失败' }; }
    if (!valid()) return false;
    studio.loading = '';
    if (!result.ok) {
      studio.ocr = null;
      studio.error = result.error;
      return false;
    }
    studio.ocr = { lines: result.lines, lang: result.lang || 'OCR', demo: Boolean(result.demo) };
    const record = currentRecord();
    if (record) record.ocr = studio.ocr;
    return true;
  }

  async function ensureTranslation(force, valid = operationGuard()) {
    if (!valid() || !permitted('translate') || !studio.ocr) return false;
    if (studio.translation && !force) return true;
    studio.loading = 'translate';
    renderSide();
    const chain = resolveChain(studio.manualEngine);
    if (!chain.length) {
      studio.loading = '';
      studio.translation = { error: '未启用任何翻译服务商，请联系平台管理员' };
      renderEngine();
      return false;
    }
    const provider = providerInfo(chain[0]);
    const source = studio.ocr.lines.join('\n');
    const chars = charCount(source);
    const cost = billTranslation(provider, chars);
    studio.translation = {
      provider,
      chain,
      pairs: studio.ocr.lines.map((line) => ({ from: line, to: translateLine(line) })),
      chars,
      cost
    };
    studio.loading = '';
    renderEngine();
    return true;
  }

  async function runMode(mode, options) {
    if (!permitted('screenshot') || !studio.open || !studio.image) return false;
    const chosen = MODE_IDS.has(mode) ? mode : getDefaultMode();
    if (['translate', 'edit'].includes(chosen) && !permitted('translate')) return false;
    operationRevision += 1;
    const valid = operationGuard();
    const opts = options || {};
    studio.mode = chosen;
    studio.error = '';
    studio.loading = '';
    renderModes();
    renderEngine();
    renderSide();
    if (studio.mode === 'copy') {
      if (!studio.copied || opts.force) await copyImage(valid);
      if (!valid()) return false;
      renderSide();
      return true;
    }
    const hasOcr = await ensureOcr(Boolean(opts.force), valid);
    if (!valid()) return false;
    if (hasOcr && chosen !== 'extract') await ensureTranslation(Boolean(opts.force), valid);
    if (!valid()) return false;
    renderSide();
    updateBillingUI();
    return hasOcr;
  }

  function dataUrlToBlob(dataUrl) {
    const parts = String(dataUrl).split(',');
    const mime = (parts[0].match(/data:([^;]+)/) || [])[1] || 'image/png';
    const binary = atob(parts[1] || '');
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return new Blob([bytes], { type: mime });
  }

  async function copyImage(valid = operationGuard()) {
    if (!permitted('screenshot') || !valid() || !studio.image) return false;
    const dataUrl = els.canvas && els.canvas.width ? els.canvas.toDataURL('image/png') : '';
    if (!validPng(dataUrl)) return false;
    let ok = false;
    try {
      const api = window.haituo && window.haituo.clipboard;
      if (api && api.writeImage) {
        const res = await api.writeImage(dataUrl);
        ok = Boolean(res && res.ok === true);
      } else if (navigator.clipboard && window.ClipboardItem) {
        await navigator.clipboard.write([new window.ClipboardItem({ 'image/png': dataUrlToBlob(dataUrl) })]);
        ok = true;
      }
    } catch {
      ok = false;
    }
    if (!valid()) return false;
    studio.copied = ok;
    toast(ok ? '已复制图片到剪贴板' : '当前环境无法写入图片剪贴板');
    return ok;
  }

  async function copyText(text) {
    if (!permitted('screenshot')) return false;
    const valid = operationGuard();
    if (!valid()) return false;
    if (!text) {
      toast('暂无可复制的文字');
      return;
    }
    let ok = false;
    try {
      const api = window.haituo && window.haituo.clipboard;
      if (api && api.write) {
        const res = await api.write(text);
        ok = Boolean(res && res.ok === true);
      } else if (navigator.clipboard) {
        await navigator.clipboard.writeText(text);
        ok = true;
      }
    } catch {
      ok = false;
    }
    if (!valid()) return false;
    toast(ok ? '已复制全文' : '复制失败，请手动选择文字');
    return ok;
  }

  function insertToComposer(text) {
    if (!permitted('screenshot') || !studio.open) return false;
    if (!text) {
      toast('暂无可插入的文字');
      return;
    }
    const input = document.getElementById('em-input');
    if (!input) {
      toast('请先在会话页打开聊天输入框');
      return;
    }
    input.value = text;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.focus();
    closeStudio();
    toast('已插入当前聊天输入框');
  }

  /* ---------- 截屏工作台：载图与最近截图 ---------- */

  let loadToken = 0;

  function loadImage(dataUrl, valid = operationGuard()) {
    if (!valid() || !validPng(dataUrl)) return Promise.resolve(false);
    return new Promise((resolve) => {
      const token = ++loadToken;
      const image = new Image();
      image.onload = () => {
        if (token !== loadToken || !valid()) { resolve(false); return; }
        if (!safeImageSize(image.naturalWidth, image.naturalHeight)) { resolve(false); return; }
        try {
          const maxSide = 2400;
          const scale = Math.min(1, maxSide / Math.max(image.naturalWidth, image.naturalHeight));
          const width = Math.max(1, Math.round(image.naturalWidth * scale));
          const height = Math.max(1, Math.round(image.naturalHeight * scale));
          els.canvas.width = width;
          els.canvas.height = height;
          baseCanvas.width = width;
          baseCanvas.height = height;
          baseCtx.clearRect(0, 0, width, height);
          baseCtx.drawImage(image, 0, 0, width, height);
          studio.image = image;
          renderCanvas();
          resolve(true);
        } catch { resolve(false); }
      };
      image.onerror = () => resolve(false);
      image.src = dataUrl;
    });
  }

  function makeThumb(dataUrl, valid = operationGuard()) {
    if (!valid() || !validPng(dataUrl)) return Promise.resolve('');
    const token = loadToken;
    return new Promise((resolve) => {
      const image = new Image();
      image.onload = () => {
        if (!valid() || token !== loadToken || !safeImageSize(image.naturalWidth, image.naturalHeight)) {
          resolve('');
          return;
        }
        try {
          const canvas = document.createElement('canvas');
          canvas.width = 108;
          canvas.height = 64;
          const ctx = canvas.getContext('2d');
          ctx.fillStyle = '#101216';
          ctx.fillRect(0, 0, 108, 64);
          const scale = Math.max(108 / image.naturalWidth, 64 / image.naturalHeight);
          const w = image.naturalWidth * scale;
          const h = image.naturalHeight * scale;
          ctx.drawImage(image, (108 - w) / 2, (64 - h) / 2, w, h);
          resolve(canvas.toDataURL('image/jpeg', 0.78));
        } catch {
          resolve('');
        }
      };
      image.onerror = () => resolve('');
      image.src = dataUrl;
    });
  }

  function currentRecord() {
    return studio.shots.find((shot) => shot.id === studio.activeShotId) || null;
  }

  function saveActiveRecord() {
    if (!access.can('screenshot') || !studio.image) return;
    const valid = operationGuard();
    const record = currentRecord();
    if (!record || !valid()) return;
    record.strokes = deepCopy(studio.strokes);
    record.ocr = studio.ocr;
    record.mode = studio.mode;
    record.demo = studio.demo;
    if (els.canvas && els.canvas.width) {
      try {
        const snapshot = els.canvas.toDataURL('image/png');
        makeThumb(snapshot, valid).then((thumb) => {
          if (thumb && valid() && currentRecord() === record) {
            record.thumb = thumb;
            updateRecentStrip();
          }
        });
      } catch {
        /* 缩略图失败不影响编辑 */
      }
    }
  }

  async function activateShot(record, demo) {
    if (!permitted('screenshot') || !els.root || !record || !studio.shots.includes(record)
      || !validPng(record.image)) return false;
    operationRevision += 1;
    studio.activeShotId = record.id;
    studio.demo = Boolean(demo);
    studio.sourceImage = record.image;
    studio.image = null;
    clearCanvases();
    studio.mode = MODE_IDS.has(record.mode) ? record.mode : getDefaultMode();
    studio.ocr = record.ocr || null;
    studio.translation = null;
    studio.error = '';
    studio.loading = '';
    studio.manualEngine = '';
    studio.copied = false;
    studio.strokes = deepCopy(record.strokes || []);
    studio.snapshots = [];
    studio.snapIndex = -1;
    studio.current = null;
    studio.drawing = false;
    studio.erasing = false;
    studio.erased = false;
    studio.pick = false;
    studio.numbers = maxNumber(studio.strokes);
    hideTextInput();
    if (typeof window.closePanel === 'function') window.closePanel();
    els.root.hidden = false;
    studio.open = true;
    const valid = operationGuard();
    renderAll();
    const loaded = await loadImage(record.image, valid);
    if (!valid()) return false;
    if (!loaded) {
      studio.error = '截图图片加载失败或超出安全范围';
      renderSide();
      return false;
    }
    resetHistory();
    renderAll();
    updateHotkeyUI();
    const thumb = await makeThumb(record.image, valid);
    if (!valid()) return false;
    record.thumb = thumb;
    updateRecentStrip();
    // runMode owns the next operation revision; it checks its own results after awaits.
    return runMode(studio.mode, { force: !studio.ocr });
  }

  function openStudio(payload, options) {
    if (!permitted('screenshot') || !payload || !validPng(payload.image)) return false;
    saveActiveRecord();
    const mode = MODE_IDS.has(payload.mode) ? payload.mode : getDefaultMode();
    const record = {
      id: 'shot-' + Date.now() + '-' + Math.random().toString(16).slice(2, 6),
      image: payload.image,
      mode,
      time: new Date(),
      strokes: [],
      ocr: null,
      thumb: '',
      demo: Boolean(options && options.demo)
    };
    studio.shots.unshift(record);
    if (studio.shots.length > 8) studio.shots.pop();
    const pending = activateShot(record, record.demo);
    const valid = operationGuard();
    return pending.catch((err) => {
      if (valid()) toast('打开截屏工作台失败：' + (err.message || err));
      return false;
    });
  }

  function reopenShot(id) {
    if (!permitted('screenshot')) return false;
    const record = studio.shots.find((shot) => shot.id === id);
    if (!record || (record.id === studio.activeShotId && studio.open)) return false;
    saveActiveRecord();
    const pending = activateShot(record, record.demo);
    const valid = operationGuard();
    return pending.catch((err) => {
      if (valid()) toast('重新打开截图失败：' + (err.message || err));
      return false;
    });
  }

  function openDemoStudio(mode) {
    if (!permitted('screenshot')) return false;
    return openStudio({
      ok: true,
      mode: MODE_IDS.has(mode) ? mode : getDefaultMode(),
      image: demoImage(),
      copied: false
    }, { demo: true });
  }

  function closeStudio() {
    if (studio.open) saveActiveRecord();
    operationRevision += 1;
    loadToken += 1;
    studio.open = false;
    studio.loading = '';
    studio.current = null;
    studio.drawing = false;
    studio.erasing = false;
    if (els.root) els.root.hidden = true;
    hideTextInput();
  }

  function clearCanvases() {
    [els.canvas, baseCanvas, mosaicTmp].forEach((canvas) => {
      if (canvas) { canvas.width = 0; canvas.height = 0; }
    });
  }

  function resetSession() {
    sessionRevision += 1;
    operationRevision += 1;
    loadToken += 1;
    // Never persist the departing identity's state while resetting for the next identity.
    Object.assign(studio, {
      open: false, demo: false, mode: getDefaultMode(), sourceImage: '', image: null,
      shots: [], activeShotId: '', ocr: null, translation: null,
      strokes: [], snapshots: [], snapIndex: -1, current: null,
      drawing: false, erasing: false, erased: false, numbers: 0, pick: false,
      textPoint: null, loading: '', error: '', manualEngine: '', copied: false,
      tool: 'pen', color: SHOT.defaults.pen,
      toolColors: { pen: SHOT.defaults.pen, highlighter: SHOT.defaults.highlighter, text: SHOT.defaults.text },
      toolSizes: { pen: 4, highlighter: 18, eraser: 20, text: 18, number: 24, pointer: 24 },
      mosaicMode: 'brush', grain: (SHOT.mosaicGrain[1] && SHOT.mosaicGrain[1].value) || 12,
      textStroke: true
    });
    const colors = readJson(STORAGE.recentColors, []);
    studio.recentColors = Array.isArray(colors)
      ? colors.filter((color) => typeof color === 'string' && /^#[0-9a-f]{6}$/i.test(color)).slice(0, 6) : [];
    usage.chars = 0;
    usage.cost = 0;
    usage.calls = 0;
    admin = loadAdmin();
    hideTextInput();
    clearCanvases();
    clearProviderPanel();
    if (els.root) els.root.hidden = true;
    if (els.canvas) els.canvas.style.cursor = 'crosshair';
    renderAll();
    refreshBoundSelects();
    updateUsageUI();
    if (access.can('screenshot')) {
      const api = window.haituo && window.haituo.screenshot;
      if (api && api.setDefault) {
        try { Promise.resolve(api.setDefault(studio.mode)).catch(() => {}); } catch { /* unavailable */ }
      }
    }
  }

  function getDefaultMode() {
    const saved = readStorage(STORAGE.defaultMode, SHOT.defaultMode);
    return MODE_IDS.has(saved) ? saved : SHOT.defaultMode;
  }

  function setDefaultMode(mode) {
    if (!permitted('screenshot') || !MODE_IDS.has(mode)) return false;
    if (!writeStorage(STORAGE.defaultMode, mode)) return false;
    const api = window.haituo && window.haituo.screenshot;
    if (api && api.setDefault) {
      try { Promise.resolve(api.setDefault(mode)).catch(() => {}); } catch { /* unavailable */ }
    }
    return mode;
  }

  function screenshotSettingsHtml() {
    if (!access.can('screenshot')) return '<p class="fx-note">当前身份没有截屏权限。</p>';
    const current = getDefaultMode();
    const modes = SHOT.modes.map((m) => `<option value="${esc(m.id)}"${current === m.id ? ' selected' : ''}>${esc(m.name)} · ${esc(m.hint)}</option>`).join('');
    return `<div class="fx-block">
        <div class="fx-block-title">截屏翻译</div>
        <label class="fx-field"><span>默认模式</span>
          <select class="fx-select" id="ss-default-mode">${modes}</select>
          <small>双击选区直接执行默认模式；单次可在选区工具条内切换。</small>
        </label>
        <div class="fx-hotkey"><span>全局快捷键</span><kbd>Alt</kbd><kbd>Shift</kbd><kbd>S</kbd></div>
        <button class="hp-primary" type="button" data-screenshot-open>开始截屏</button>
        <p class="fx-note">结果留在主窗口内；OCR 始终读取未标注原图，涂鸦与马赛克不会遮挡识别。</p>
      </div>
      <div class="fx-block">
        <div class="fx-block-title">截图工具箱</div>
        <p class="fx-note">12 项标注：画笔 / 荧光笔 / 箭头 / 方框 / 圆角框 / 椭圆 / 马赛克 / 文字 / 序号 / 橡皮擦 / 撤销重做 / 指针。</p>
        <p class="fx-note">12 快捷色 + 最近 6 色 + 取色器；马赛克纯灰三档颗粒，文字支持白字黑描边。</p>
      </div>`;
  }

  async function startCapture(mode) {
    if (!permitted('screenshot')) return false;
    operationRevision += 1;
    loadToken += 1;
    studio.loading = '';
    const validSession = sessionGuard();
    const operation = operationRevision;
    const valid = () => validSession() && operation === operationRevision;
    const chosen = MODE_IDS.has(mode) ? mode : getDefaultMode();
    const api = window.haituo && window.haituo.screenshot;
    if (!api || !api.start) {
      toast('预览环境：打开演示截屏');
      return openDemoStudio(chosen);
    }
    try {
      const res = await api.start(chosen);
      if (!valid()) return false;
      if (!res || res.ok !== true) {
        toast((res && res.error) || '截屏启动失败');
        return false;
      }
      toast('拖动选区，双击执行「' + (MODE_NAMES[chosen] || chosen) + '」');
      return true;
    } catch (err) {
      if (valid()) toast('截屏启动失败：' + (err.message || err));
      return false;
    }
  }

  /* ---------- 截屏工作台：事件 ---------- */

  function bindStudioChrome() {
    if (!els.root) return;
    ['click', 'dblclick', 'change', 'input', 'beforeinput', 'keydown', 'keyup', 'blur',
      'pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'mousedown', 'mousemove',
      'mouseup', 'touchstart', 'touchmove', 'touchend', 'paste', 'drop', 'dragstart'].forEach((type) => {
      els.root.addEventListener(type, (event) => {
        if (access.can('screenshot') && studio.open) return;
        event.preventDefault();
        event.stopImmediatePropagation();
      }, true);
    });
    els.close.addEventListener('click', closeStudio);
    els.modes.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-shot-mode]');
      if (btn) runMode(btn.dataset.shotMode);
    });
    els.toolbar.addEventListener('click', (e) => {
      const tool = e.target.closest('[data-shot-tool]');
      if (tool) { selectTool(tool.dataset.shotTool); return; }
      if (e.target.closest('[data-undo]')) { undo(); return; }
      if (e.target.closest('[data-redo]')) { redo(); return; }
      const mosaic = e.target.closest('[data-mosaic-mode]');
      if (mosaic) {
        studio.mosaicMode = mosaic.dataset.mosaicMode;
        renderToolbar();
        renderPalette();
      }
    });
    els.toolbar.addEventListener('change', (e) => {
      if (e.target.matches('[data-shot-size]')) {
        studio.toolSizes[studio.tool] = Number(e.target.value);
      } else if (e.target.matches('[data-shot-grain]')) {
        studio.grain = Number(e.target.value);
        renderPalette();
      } else if (e.target.matches('[data-shot-text-size]')) {
        studio.toolSizes.text = Number(e.target.value);
      } else if (e.target.matches('[data-shot-mark-size]')) {
        studio.toolSizes[studio.tool] = Number(e.target.value);
      } else if (e.target.matches('[data-shot-text-stroke]')) {
        studio.textStroke = e.target.checked;
      }
    });
    els.palette.addEventListener('click', (e) => {
      const color = e.target.closest('[data-color]');
      if (color) {
        if (studio.tool === 'mosaic') {
          toast('马赛克固定纯灰，不跟随快捷色');
          return;
        }
        setColor(color.dataset.color);
        return;
      }
      if (e.target.closest('[data-eyedrop]')) {
        studio.pick = !studio.pick;
        renderPalette();
        toast(studio.pick ? '点击图片任意位置取色' : '已退出取色');
      }
    });
    els.copy.addEventListener('click', () => {
      if (studio.mode === 'copy') copyImage();
      else copyText(currentText());
    });
    els.insert.addEventListener('click', () => insertToComposer(currentText()));
    els.again.addEventListener('click', () => runMode(studio.mode, { force: true }));
    els.recent.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-shot-id]');
      if (btn) reopenShot(btn.dataset.shotId);
    });
    els.sideBody.addEventListener('click', (e) => {
      if (e.target.closest('[data-shot-retry]')) runMode(studio.mode, { force: true });
    });
    els.engine.addEventListener('change', () => {
      if (!permitted('screenshot') || !permitted('translate')) return;
      const id = els.engine.value;
      if (id && !isUsable(id)) return;
      studio.manualEngine = id;
      studio.translation = null;
      if (['translate', 'edit'].includes(studio.mode)) runMode(studio.mode);
      else renderEngine();
    });
    els.canvas.addEventListener('pointerdown', onCanvasDown);
    els.canvas.addEventListener('pointermove', onCanvasMove);
    els.canvas.addEventListener('pointerup', onCanvasUp);
    els.canvas.addEventListener('pointercancel', onCanvasUp);
    els.textInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        e.stopPropagation();
        commitTextInput();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        hideTextInput();
      }
    });
    els.textInput.addEventListener('blur', () => {
      if (studio.textPoint) commitTextInput();
    });

    document.addEventListener('keydown', (e) => {
      if (!access.can('screenshot') || !studio.open || e.key !== 'Escape') return;
      if (studio.textPoint) {
        hideTextInput();
      } else {
        closeStudio();
      }
      e.preventDefault();
      e.stopPropagation();
    }, true);

    document.addEventListener('click', (e) => {
      if (e.target.closest('[data-screenshot-open]')) startCapture(getDefaultMode());
    });

    document.addEventListener('change', (e) => {
      if (e.target.id === 'ss-default-mode') {
        const mode = setDefaultMode(e.target.value);
        if (mode !== false) toast('默认截屏模式：' + MODE_NAMES[mode]);
        return;
      }
      if (e.target.id === 'fx-default-provider') {
        const id = setCustomerDefault(e.target.value);
        if (id !== false) toast(id ? '客户默认服务商：' + providerName(id) : '已改为自动：按本地预览顺序降级');
        return;
      }
      if (e.target.id === 'fx-tr-provider') {
        if (!permitted('translate') || (e.target.value && !isUsable(e.target.value))) return;
        const label = document.getElementById('fx-tr-chain');
        if (label) label.textContent = providerChainLabel(e.target.value);
      }
    });
  }

  function init() {
    cacheStudioEls();
    bindProviderPanel();
    if (els.root) {
      bindStudioChrome();
      updateHotkeyUI();
      renderAll();
      studio.open = false;
      els.root.hidden = true;
      const api = window.haituo && window.haituo.screenshot;
      if (api && api.onResult) {
        api.onResult((payload) => {
          const identity = access.get();
          if (!identity || !access.can('screenshot') || !payload || payload.ok !== true
            || !Number.isSafeInteger(payload.revision) || payload.revision !== identity.revision
            || typeof payload.scope !== 'string' || payload.scope !== identity.scope) return;
          openStudio(payload);
        });
      }
    }
    updateUsageUI();
  }

  window.HaituoStudio = Object.freeze({
    resetSession,
    openProviderPanel,
    openStudio,
    openDemoStudio,
    startCapture,
    closeStudio,
    getDefaultMode,
    setDefaultMode,
    screenshotSettingsHtml,
    customerDefaultSelectHtml,
    panelProviderSelectHtml,
    providerChainLabel,
    setCustomerDefault,
    runPanelTranslation,
    resolveChain,
    getUsage: () => ({ chars: usage.chars, cost: usage.cost, calls: usage.calls }),
    isOpen: () => studio.open,
    getState: () => ({
      open: studio.open,
      mode: studio.mode,
      tool: studio.tool,
      shots: studio.shots.length,
      strokes: studio.strokes.length,
      types: studio.strokes.map((stroke) => stroke.type),
      numbers: studio.numbers,
      color: studio.color,
      chars: usage.chars,
      cost: usage.cost
    })
  });

  init();
})();
