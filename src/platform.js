(() => {
  'use strict';
  const access = window.HaituoAccess;
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const defaults = Object.freeze({ font: 'system-ui', size: 14, incoming: '#1a1d24', outgoing: '#7050df', text: '#eef0f5', translation: '#d7c9ff' });
  let fonts = ['system-ui'];
  let fontRequest;

  function read(name, fallback, accountId = '') {
    const key = access.key(name, accountId);
    if (!key || (accountId && !access.account(accountId))) return fallback;
    try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
  }
  function write(name, value, accountId = '') {
    const key = access.key(name, accountId);
    if (!key || (accountId && !access.account(accountId))) return false;
    try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch { return false; }
  }
  function card(title, body) { return `<section class="platform-card"><h2>${esc(title)}</h2>${body}</section>`; }
  function note(text) { return `<p class="platform-notice">${esc(text)}</p>`; }
  function node(title, subtitle, html) {
    const root = document.createElement('div');
    root.className = 'platform-page';
    root.innerHTML = `<header class="platform-head"><div><span class="platform-eyebrow">HAITUO WORKSPACE</span><h1>${esc(title)}</h1><p>${esc(subtitle)}</p></div><span class="demo-badge">${access.get()?.demo ? '离线演示 · 不连接业务服务器' : '服务器身份 · 服务接入待部署'}</span></header>${html}`;
    return root;
  }
  function denied() { return node('无法访问', '当前身份未获此项授权', note('隐藏入口同样受权限校验；请返回首页。')); }
  function go(id, label) { return access.can(id) ? `<button class="hp-ghost" type="button" data-platform-page="${esc(id)}">${esc(label)}</button>` : ''; }
  function amount(kind) {
    if (!access.get()?.demo) return '未连接';
    if (kind === 'used') return access.get().role === 'staff' ? '3,200' : '32,400';
    return access.get().role === 'staff' ? '46,800' : '1,284,600';
  }

  const ROLE_LABELS = Object.freeze({ owner: '所有者', admin: '管理员', user: '商户 / 代理', staff: '员工子账号' });

  // 角色 × 权限点矩阵：静态镜像 runtime-access.js 的 RULES（本轮只读展示，不从主进程读取）。
  const PERMISSION_MATRIX = Object.freeze({
    groups: Object.freeze([
      { name: '基础', perms: Object.freeze(['home', 'account', 'accounts', 'usage', 'appearance', 'other', 'about', 'logout']) },
      { name: '翻译', perms: Object.freeze(['translate', 'basic-translate', 'advanced-translate', 'screenshot']) },
      { name: '消费', perms: Object.freeze(['recharge']) },
      { name: '渠道与内容', perms: Object.freeze(['catalog', 'account-edit', 'account-delete', 'writing', 'proxy', 'fingerprint', 'tg', 'system', 'announcements']) },
      { name: '平台配置', perms: Object.freeze(['providers', 'pricing', 'role:manage']) },
      { name: '子账号', perms: Object.freeze(['staff:manage', 'quota:allocate', 'account:suspend', 'password:reset']) },
      { name: '审计与订单', perms: Object.freeze(['audit:read', 'order:view']) }
    ]),
    roles: Object.freeze({
      owner: Object.freeze(['home', 'account', 'accounts', 'usage', 'appearance', 'other', 'about', 'logout', 'translate', 'basic-translate', 'advanced-translate', 'screenshot', 'recharge', 'system', 'tg', 'catalog', 'account-edit', 'account-delete', 'providers', 'announcements', 'writing', 'proxy', 'fingerprint', 'staff:manage', 'quota:allocate', 'account:suspend', 'password:reset', 'audit:read', 'order:view', 'role:manage', 'pricing']),
      admin: Object.freeze(['home', 'account', 'accounts', 'usage', 'appearance', 'other', 'about', 'logout', 'translate', 'basic-translate', 'advanced-translate', 'screenshot', 'system', 'announcements', 'providers', 'pricing', 'catalog', 'account-edit', 'staff:manage', 'quota:allocate', 'account:suspend', 'password:reset', 'audit:read', 'order:view']),
      user: Object.freeze(['home', 'account', 'accounts', 'usage', 'appearance', 'other', 'about', 'logout', 'translate', 'basic-translate', 'advanced-translate', 'screenshot', 'recharge', 'catalog', 'account-edit', 'account-delete', 'staff:manage', 'quota:allocate', 'password:reset', 'order:view']),
      staff: Object.freeze(['home', 'account', 'accounts', 'usage', 'appearance', 'other', 'about', 'logout', 'translate', 'basic-translate', 'password:reset'])
    })
  });

  function home(accounts) {
    if (!access.can('home')) return denied();
    const user = access.get();
    const role = user.role;
    if (user.local) return node('本机渠道工作区', '连接本机聊天渠道；未登录服务器，没有资金或后台管理权限。',
      card('选择渠道', accounts.map(a => `<button class="platform-account hp-ghost" type="button" data-platform-account="${esc(a.id)}"><strong>${esc(a.name)}</strong><small>独立登录态与本地资料</small></button>`).join('')) +
      card('当前范围', '<p>WhatsApp、Telegram 使用官方网页；Signal 使用平台内部的独立账号视图。请在渠道内完成扫码登录。</p><p>真实 AI 翻译与字符计费尚未接入，本工作区不展示虚构余额。</p>') + go('appearance', '外观设置'));
    const descriptions = {
      owner: '平台管理与配置预览；运营管理和个人消费分开。',
      admin: '公告、定价与子账号管理；不含角色管理与财务提现。',
      user: '专注聊天、翻译、自己的账号与余额，并可管理自己名下的子账号。',
      staff: '仅使用分配给你的渠道账号、字符额度与翻译功能。'
    };
    const totalLabel = role === 'staff' ? '分配的剩余额度（示例）' : '自身字符余额（示例）';
    const staffLink = access.can('staff:manage') ? `<button class="hp-ghost" type="button" data-platform-page="staff">员工子账号</button>` : '';
    const links = go('accounts', role === 'staff' ? '分配的账号' : '我的渠道账号') + go('recharge', '套餐与充值') + go('usage', '用量与额度') + go('appearance', '外观设置') + staffLink + go('providers', '模型配置预览') + go('announcements', '公告草稿');
    const accountsHtml = accounts.map((a) => `<button class="platform-account hp-ghost" type="button" data-platform-account="${esc(a.id)}"><strong>${esc(a.name)}</strong><small>${esc(a.channel)} · 海拓演示会话</small></button>`).join('');
    return node('欢迎回来，' + user.label, descriptions[role],
      `<div class="platform-metrics"><section><span>${role === 'staff' ? '分配的账号' : '可见渠道账号'}</span><strong>${accounts.length}</strong><small>${user.demo ? '本地样例' : '真实渠道尚未接入'}</small></section><section><span>${totalLabel}</span><strong>${amount('remaining')}</strong><small>不会产生真实扣费</small></section><section><span>本月用量（示例）</span><strong>${amount('used')}</strong><small>正式用量待服务端核验</small></section></div>` +
      `<div class="platform-columns">${card('常用入口', `<div class="platform-links">${links}</div>`)}${card('继续会话', accountsHtml || '<p>暂无已接入渠道。正式账号不会加载他人的演示会话。</p>')}</div>` +
      (user.demo ? card('本机渠道测试', '<p>打开独立本机工作区，连接 WhatsApp、Telegram 与 Signal。不会获得服务器管理或资金权限。</p><button class="hp-primary" type="button" data-local-workspace>进入本机渠道工作区</button>') : '') +
      card('平台状态', '<ul class="platform-status"><li>聊天：当前是海拓自制演示，非官方聊天页面。</li><li>翻译与模型：本地预览，不调用真实模型，不扣真实余额。</li><li>支付、正式员工管理、配置同步：待后端部署与验收。</li><li>官方网页版渠道后续保留原生操作；Signal 桌面模块需完成 AGPL 合规核查。</li></ul>') +
      note('切换首页不会清空当前账号草稿。演示资料与服务器身份分区保存，不迁移或覆盖旧版未归属的本地存档。'));
  }

  function recharge() {
    if (!access.can('recharge')) return denied();
    const user = access.get();
    return node('我的套餐与充值', '这是当前主账号的消费区，不是平台资金或代理佣金账户。',
      `<div class="platform-metrics"><section><span>字符余额（示例）</span><strong>${amount('remaining')}</strong><small>不代表真实可消费余额</small></section><section><span>当前套餐</span><strong>${user.demo ? '团队套餐样例' : '待查询'}</strong><small>正式套餐与币种待确认</small></section><section><span>本月用量（示例）</span><strong>${amount('used')}</strong><small>未发生真实扣费</small></section></div>` +
      card('套餐预览 · 未开通支付', '<div class="platform-packages">' + ['体验套餐', '标准套餐', '团队套餐'].map((name) => `<article><h3>${name}</h3><strong>价格待定</strong><p>币种、额度和有效期尚未正式发布</p><button class="hp-primary" type="button" disabled>支付未开通</button></article>`).join('') + '</div>') +
      card('我的订单', '<p>暂无真实订单。付款、到账与退款均未开放，不展示虚构的成功订单。</p>') +
      note('真实金额必须由服务端生成订单，并由支付平台验签回调确认到账；客户端不能通过修改价格、角色或余额改账。' + (user.role === 'owner' ? ' 平台定价请前往模型配置预览，保存不会发布给商户。' : '')));
  }

  function usage() {
    if (!access.can('usage')) return denied();
    const staff = access.get().role === 'staff';
    return node(staff ? '我的分配额度' : '我的用量', '示例数据仅供界面验收，不与真实钱包共用。',
      `<div class="platform-metrics"><section><span>${staff ? '商户分配上限（示例）' : '剩余字符（示例）'}</span><strong>${staff && access.get().demo ? '50,000' : amount('remaining')}</strong></section><section><span>已用（示例）</span><strong>${amount('used')}</strong></section><section><span>剩余（示例）</span><strong>${amount('remaining')}</strong></section></div>` +
      card(staff ? '申请增加额度' : '用量明细', staff ? '<p>请联系所属商户。申请后端未部署，本页不会虚构提交记录。</p><button class="hp-primary" type="button" disabled>额度申请未开通</button>' : '<p>真实调用明细、失败重试与并发扣费待服务端验收；当前翻译仅记录会话内模拟用量，不写入钱包。</p>'));
  }

  function staffPage() {
    if (!access.can('staff:manage')) return denied();
    const revision = access.get().revision;
    const demo = access.get().demo;
    const selfId = access.get().id;
    const accountIds = Array.isArray(access.get().accountIds) ? access.get().accountIds.slice() : [];
    let currentStaff = [];
    const fmtNum = (v) => { const n = Number(v); return Number.isFinite(n) ? n.toLocaleString('en-US') : '0'; };

    const root = node('员工子账号', '商户后台：创建子账号、分配渠道账号与字符额度、停用与删除',
      card('创建子账号',
        `<form class="staff-form" data-staff-create>
          <div class="platform-form-grid">
            <label class="fx-field"><span>邮箱</span><input class="fx-input" type="email" name="email" required placeholder="staff@example.com" autocomplete="off" /></label>
            <label class="fx-field"><span>初始密码（至少 6 位）</span><input class="fx-input" type="password" name="password" minlength="6" required autocomplete="new-password" /></label>
            <label class="fx-field"><span>字符额度（可选）</span><input class="fx-input" type="number" name="quota" min="0" step="1" placeholder="0" /></label>
            <label class="fx-field"><span>备注（可选）</span><input class="fx-input" type="text" name="note" maxlength="200" placeholder="例如：负责法国批发渠道" /></label>
          </div>
          <div class="fx-field"><span>分配渠道（可选）</span>
            <div class="staff-channels">${accountIds.length ? accountIds.map((id) => `<label><input type="checkbox" name="channel" value="${esc(id)}" /> ${esc(id)}</label>`).join('') : '<small>当前身份没有可分配的渠道账号</small>'}</div>
          </div>
          <div class="platform-links"><button class="hp-primary" type="submit">创建子账号</button></div>
          <p class="staff-msg" data-staff-create-msg role="status"></p>
        </form>`) +
      card('子账号列表', '<p class="staff-msg" data-staff-list-msg role="status"></p><div class="staff-list" data-staff-list><p class="staff-empty">加载中…</p></div>') +
      note('owner / admin 可见全部子账号，商户仅可见自己名下（服务端强制）。停用后暂不支持重新启用，本轮仅提供停用与删除。' + (demo ? ' 离线演示无法访问真实子账号接口。' : '')));

    const listEl = root.querySelector('[data-staff-list]');
    const listMsg = root.querySelector('[data-staff-list-msg]');
    const createForm = root.querySelector('[data-staff-create]');
    const createMsg = root.querySelector('[data-staff-create-msg]');

    function rowHtml(s) {
      const id = s.id;
      const suspended = s.status === 'suspended';
      const channels = Array.isArray(s.channel_allowlist) ? s.channel_allowlist : [];
      return `<div class="staff-row" data-staff-id="${esc(id)}">
        <div class="staff-main">
          <div class="staff-email">${esc(s.email || '')}<span class="staff-status ${suspended ? 'is-suspended' : 'is-active'}">${suspended ? '已停用' : '正常'}</span></div>
          <div class="staff-meta">渠道：${channels.length ? channels.map((c) => esc(c)).join('、') : '—'} · 额度 ${fmtNum(s.char_quota)} · 已用 ${fmtNum(s.char_used)}<span class="staff-note">${esc(s.note || '')}</span></div>
        </div>
        <div class="staff-actions">
          <button type="button" class="hp-ghost" data-staff-act="allocate" data-id="${esc(id)}">分配字符</button>
          <button type="button" class="hp-ghost" data-staff-act="channel" data-id="${esc(id)}">分配渠道</button>
          ${suspended ? '<span class="staff-disabled-hint">已停用 · 不可操作</span>' : `<button type="button" class="hp-ghost" data-staff-act="suspend" data-id="${esc(id)}">停用</button>`}
          <button type="button" class="hp-ghost is-danger" data-staff-act="delete" data-id="${esc(id)}">删除</button>
        </div>
        <div class="staff-editor" data-staff-editor="${esc(id)}" hidden></div>
      </div>`;
    }

    function editorHtml(staff, kind) {
      const id = staff.id;
      if (kind === 'allocate') {
        return `<form class="staff-editor-form" data-staff-form="allocate" data-id="${esc(id)}">
          <input class="fx-input" type="number" min="1" step="1" placeholder="要分配的字符数量" required />
          <button class="hp-primary" type="submit">确认分配</button>
          <button class="hp-ghost" type="button" data-staff-cancel>取消</button>
          <p class="staff-editor-msg" role="status"></p>
        </form>`;
      }
      const channels = Array.isArray(staff.channel_allowlist) ? staff.channel_allowlist : [];
      return `<form class="staff-editor-form" data-staff-form="channel" data-id="${esc(id)}">
        <div class="staff-channels">${accountIds.length ? accountIds.map((a) => `<label><input type="checkbox" value="${esc(a)}" ${channels.includes(a) ? 'checked' : ''} /> ${esc(a)}</label>`).join('') : '<small>当前身份没有可分配的渠道账号</small>'}</div>
        <button class="hp-primary" type="submit">保存渠道分配</button>
        <button class="hp-ghost" type="button" data-staff-cancel>取消</button>
        <p class="staff-editor-msg" role="status"></p>
      </form>`;
    }

    async function load() {
      listEl.innerHTML = '<p class="staff-empty">加载中…</p>';
      const res = await window.haituo.staff.list();
      if (access.get()?.revision !== revision) return;
      if (!res.ok) { listMsg.textContent = res.error || '加载失败'; listEl.innerHTML = ''; return; }
      listMsg.textContent = '';
      currentStaff = Array.isArray(res.staff) ? res.staff : [];
      listEl.innerHTML = currentStaff.length ? currentStaff.map(rowHtml).join('') : '<p class="staff-empty">暂无子账号</p>';
    }

    function closeEditor() {
      const open = listEl.querySelector('[data-staff-editor]:not([hidden])');
      if (open) open.hidden = true;
    }

    listEl.addEventListener('click', (e) => {
      const cancel = e.target.closest('[data-staff-cancel]');
      if (cancel) {
        const editor = cancel.closest('[data-staff-editor]');
        if (editor) editor.hidden = true;
        return;
      }
      const btn = e.target.closest('[data-staff-act]');
      if (!btn) return;
      const id = btn.dataset.id;
      const staff = currentStaff.find((s) => s.id === id);
      if (!staff) return;
      const act = btn.dataset.staffAct;
      const editor = listEl.querySelector(`[data-staff-editor="${id}"]`);
      if (act === 'allocate' || act === 'channel') {
        if (!editor) return;
        closeEditor();
        editor.innerHTML = editorHtml(staff, act);
        editor.hidden = false;
      } else if (act === 'suspend') {
        if (!window.confirm(`确定停用子账号「${staff.email}」？停用后暂不支持重新启用。`)) return;
        (async () => {
          const res = await window.haituo.staff.suspend(id);
          if (access.get()?.revision !== revision) return;
          if (res.ok) load();
          else listMsg.textContent = res.error || '停用失败';
        })();
      } else if (act === 'delete') {
        if (!window.confirm(`确定删除子账号「${staff.email}」？此操作不可撤销。`)) return;
        (async () => {
          const res = await window.haituo.staff.remove(id);
          if (access.get()?.revision !== revision) return;
          if (res.ok) load();
          else listMsg.textContent = res.error || '删除失败';
        })();
      }
    });

    listEl.addEventListener('submit', (e) => {
      const form = e.target.closest('[data-staff-form]');
      if (!form) return;
      e.preventDefault();
      const id = form.dataset.id;
      const staff = currentStaff.find((s) => s.id === id);
      if (!staff) return;
      const kind = form.dataset.staffForm;
      const msg = form.querySelector('.staff-editor-msg');
      if (kind === 'allocate') {
        const n = Number(form.querySelector('input').value);
        if (!Number.isSafeInteger(n) || n <= 0) { msg.textContent = '请输入大于 0 的整数'; return; }
        (async () => {
          const res = await window.haituo.staff.allocateChars(id, n);
          if (access.get()?.revision !== revision) return;
          if (res.ok) load();
          else msg.textContent = res.error || '分配失败';
        })();
      } else if (kind === 'channel') {
        const channels = Array.from(form.querySelectorAll('input[type="checkbox"]:checked')).map((i) => i.value);
        (async () => {
          const res = await window.haituo.staff.assignChannel(id, channels);
          if (access.get()?.revision !== revision) return;
          if (res.ok) load();
          else msg.textContent = res.error || '分配渠道失败';
        })();
      }
    });

    createForm.addEventListener('submit', (e) => {
      e.preventDefault();
      createMsg.textContent = '';
      const email = String(createForm.querySelector('input[name="email"]').value || '').trim();
      const password = String(createForm.querySelector('input[name="password"]').value || '');
      const quota = Number(createForm.querySelector('input[name="quota"]').value || 0);
      const note = String(createForm.querySelector('input[name="note"]').value || '').trim();
      const channels = Array.from(createForm.querySelectorAll('input[name="channel"]:checked')).map((i) => i.value);
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { createMsg.textContent = '邮箱格式无效'; return; }
      if (password.length < 6) { createMsg.textContent = '初始密码至少 6 位'; return; }
      if (!Number.isSafeInteger(quota) || quota < 0) { createMsg.textContent = '字符额度无效'; return; }
      (async () => {
        if (access.get()?.revision !== revision) return;
        const res = await window.haituo.staff.create({ p_owner: selfId, p_email: email, p_password: password, p_channels: channels, p_quota: quota, p_note: note });
        if (access.get()?.revision !== revision) return;
        if (res.ok) { createMsg.textContent = '已创建子账号（服务端确认）'; createForm.reset(); load(); }
        else createMsg.textContent = res.error || '创建失败';
      })();
    });

    load();
    return root;
  }

  function permissionCenter() {
    if (!access.can('role:manage')) return denied();
    const groups = PERMISSION_MATRIX.groups;
    const roles = PERMISSION_MATRIX.roles;
    const order = ['owner', 'admin', 'user', 'staff'];
    const groupHead = groups.map((g) => `<th colspan="${g.perms.length}">${esc(g.name)}</th>`).join('');
    const permHead = groups.map((g) => g.perms.map((p) => `<th title="${esc(p)}">${esc(p)}</th>`).join('')).join('');
    const body = order.map((r) => {
      const set = new Set(roles[r]);
      const cells = groups.map((g) => g.perms.map((p) => set.has(p) ? '<td class="perm-yes">✓</td>' : '<td class="perm-no">—</td>').join('')).join('');
      return `<tr><th class="perm-role">${esc(ROLE_LABELS[r])}<small>${esc(r)}</small></th>${cells}</tr>`;
    }).join('');
    return node('权限中心', '角色 × 权限点矩阵（本轮只读）',
      card('权限矩阵', `<div class="perm-scroll"><table class="perm-table"><thead><tr><th rowspan="2">角色</th>${groupHead}</tr><tr>${permHead}</tr></thead><tbody>${body}</tbody></table></div>`) +
      note('本轮仅只读展示，自定义角色后续开放。授权以服务端 RULES 为准，前端仅做展示与隐藏。'));
  }

  function personalCenter() {
    if (!access.can('home')) return denied();
    const user = access.get();
    const revision = user.revision;
    const demo = user.demo;
    const roleLabel = ROLE_LABELS[user.role] || user.role;
    const avatar = demo ? '演' : String(user.email || '?').charAt(0).toUpperCase();
    const displayName = demo ? '离线演示账号' : user.email;
    const entries = (access.can('staff:manage') ? '<button class="hp-ghost" type="button" data-platform-page="staff">子账号管理</button>' : '')
      + (access.can('role:manage') ? '<button class="hp-ghost" type="button" data-platform-page="permissions">权限中心</button>' : '')
      + '<button class="hp-ghost" type="button" data-user-action="about">关于海拓</button>';
    const root = node('个人中心', '聚合个人资料、资产、订单与安全设置',
      `<div class="platform-columns">
        ${card('个人资料', `<div class="personal-profile"><span class="personal-avatar">${esc(avatar)}</span><div><strong>${esc(displayName)}</strong><small>${esc(roleLabel)}${demo ? ' · 离线演示' : ''}</small></div></div>`)}
        ${card('资产', `<div class="personal-assets">
          <div><span>字符余额</span><strong>${demo ? amount('remaining') : '待查询'}</strong><small>${demo ? '本地样例，不代表真实余额' : '未连接真实钱包'}</small></div>
          <div><span>字符额度</span><strong>${demo ? amount('remaining') : '待查询'}</strong><small>额度上限</small></div>
          <div><span>套餐</span><strong>${demo ? '团队套餐样例' : '待查询'}</strong><small>正式套餐与币种待确认</small></div>
        </div>`)}
      </div>` +
      card('我的订单', '<p>暂无真实订单：支付未接入，不展示虚构订单。</p>') +
      card('管理入口', `<div class="platform-links">${entries}</div>`) +
      card('安全', `<form class="personal-pwd" data-personal-pwd>
          <label class="fx-field"><span>新密码（至少 6 位）</span><input class="fx-input" type="password" minlength="6" required autocomplete="new-password" /></label>
          <label class="fx-field"><span>再次输入新密码</span><input class="fx-input" type="password" minlength="6" required autocomplete="new-password" /></label>
          <div class="platform-links"><button class="hp-primary" type="submit">修改密码</button><button class="hp-ghost" type="button" data-user-action="logout">退出登录</button></div>
          <p class="personal-pwd-msg" role="status"></p>
        </form>`));
    const form = root.querySelector('[data-personal-pwd]');
    const msg = root.querySelector('.personal-pwd-msg');
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      if (access.get()?.revision !== revision) return;
      const inputs = form.querySelectorAll('input[type="password"]');
      const p1 = inputs[0].value;
      const p2 = inputs[1].value;
      if (p1.length < 6) { msg.textContent = '密码至少 6 位'; return; }
      if (p1 !== p2) { msg.textContent = '两次输入的密码不一致'; return; }
      (async () => {
        if (access.get()?.revision !== revision) return;
        const res = await window.haituo.staff.resetPassword(access.get().id, p1);
        if (access.get()?.revision !== revision) return;
        if (res.ok) { msg.textContent = '密码已修改（服务端确认）'; inputs.forEach((i) => { i.value = ''; }); }
        else msg.textContent = res.error || '修改失败';
      })();
    });
    return root;
  }

  function announcements() {
    if (!access.can('announcements')) return denied();
    const root = node('公告草稿', '仅当前身份本地预览 · 未发布 · 不同步到商户', card('编辑内容', '<label class="fx-field"><span>公告正文（最多 2000 字）</span><textarea class="fx-textarea" id="announcement-draft" maxlength="2000" rows="5"></textarea></label><div class="platform-links"><button class="hp-primary" type="button" id="announcement-save">保存本地草稿</button><button class="hp-ghost" disabled>发布未开通</button></div><p id="announcement-status" role="status"></p><pre id="announcement-preview" class="platform-preview"></pre>') + note('真实同步需认证接口、数据库权限和已部署迁移；不下发密钥，不执行远程 JavaScript，不把本地保存称为已发布。'));
    const revision = access.get().revision;
    const input = root.querySelector('#announcement-draft');
    input.value = String(read('announcement', '')).slice(0, 2000);
    root.querySelector('#announcement-preview').textContent = input.value;
    root.querySelector('#announcement-save').addEventListener('click', () => {
      if (!access.can('announcements') || access.get().revision !== revision) return;
      const value = input.value.slice(0, 2000);
      const saved = write('announcement', value);
      root.querySelector('#announcement-preview').textContent = value;
      root.querySelector('#announcement-status').textContent = saved ? '本地草稿已保存，未发布到商户。' : '本地保存失败，尚未发布。';
    });
    return root;
  }

  async function loadFonts() {
    if (!fontRequest) fontRequest = window.haituo.system.fonts().then((r) => {
      if (r.ok) fonts = ['system-ui', ...r.fonts.filter((f) => /^[\p{L}\p{N} _.-]{1,80}$/u.test(f))];
      else fontRequest = null;
      return fonts;
    }).catch(() => { fontRequest = null; return fonts; });
    return fontRequest;
  }
  function validAppearance(value) {
    const out = { ...defaults };
    if (!value || typeof value !== 'object') return out;
    if (fonts.includes(value.font)) out.font = value.font;
    if (Number.isInteger(value.size) && value.size >= 12 && value.size <= 24) out.size = value.size;
    for (const key of ['incoming', 'outgoing', 'text', 'translation']) if (typeof value[key] === 'string' && /^#[0-9a-f]{6}$/i.test(value[key])) out[key] = value[key].toLowerCase();
    return out;
  }
  function appearance(accountId) { return validAppearance(read('appearance', defaults, accountId)); }
  function applyAppearance(root, accountId) {
    const config = appearance(accountId);
    root.style.setProperty('--chat-font', config.font === 'system-ui' ? 'system-ui' : '"' + config.font + '"');
    root.style.setProperty('--chat-size', config.size + 'px');
    for (const key of ['incoming', 'outgoing', 'text', 'translation']) root.style.setProperty('--chat-' + key, config[key]);
  }
  function appearancePage(accounts, onChange) {
    if (!access.can('appearance')) return denied();
    const root = node('外观设置', '按当前身份与渠道账号独立保存；只影响海拓外壳和演示会话。', card('聊天样式', `<label class="fx-field"><span>应用到账号</span><select class="fx-select" id="appearance-account"><option value="">外壳默认</option>${accounts.filter((a) => access.account(a.id)).map((a) => `<option value="${esc(a.id)}">${esc(a.name)}</option>`).join('')}</select></label><div class="platform-form-grid"><label class="fx-field"><span>本机字体</span><select class="fx-select" id="appearance-font"><option value="system-ui">系统默认</option></select></label><label class="fx-field"><span>字号（12–24 px）</span><input class="fx-input" id="appearance-size" type="number" min="12" max="24" step="1" /></label>${[['incoming', '对方气泡'], ['outgoing', '自己气泡'], ['text', '正文颜色'], ['translation', '译文颜色']].map(([key, label]) => `<label class="fx-field"><span>${label}</span><input class="fx-input" id="appearance-${key}" maxlength="7" pattern="#[0-9a-fA-F]{6}" placeholder="#123456" /></label>`).join('')}</div><div class="platform-links"><button class="hp-primary" type="button" id="appearance-save">保存外观</button><button class="hp-ghost" type="button" id="appearance-reset">恢复默认</button></div><p id="appearance-status" role="status"></p><div class="em platform-chat-preview"><div class="em-msg"><div class="em-msg-main"><div class="em-bubble">对方：请确认报价。</div><div class="em-tr">Please confirm the quotation.</div></div></div><div class="em-msg is-out"><div class="em-msg-main"><div class="em-bubble">自己：收到，稍后回复。</div><div class="em-tr">Received, I will reply shortly.</div></div></div></div>`) + note('官方聊天未接入，此设置尚不作用于第三方官方网页。退出重进或重启仍保留；演示与真实身份使用不同存储分区。'));
    const revision = access.get().revision;
    const select = root.querySelector('#appearance-account');
    const status = root.querySelector('#appearance-status');
    const load = () => {
      const config = appearance(select.value);
      for (const [key, value] of Object.entries(config)) root.querySelector('#appearance-' + key).value = value;
      applyAppearance(root.querySelector('.platform-chat-preview'), select.value);
    };
    loadFonts().then((list) => {
      if (!root.isConnected) return;
      root.querySelector('#appearance-font').innerHTML = list.map((font) => `<option value="${esc(font)}">${esc(font === 'system-ui' ? '系统默认' : font)}</option>`).join('');
      load();
    });
    select.addEventListener('change', load);
    root.querySelector('#appearance-save').addEventListener('click', () => {
      if (!access.can('appearance') || access.get().revision !== revision || (select.value && !access.account(select.value))) return;
      const value = {};
      for (const key of Object.keys(defaults)) value[key] = root.querySelector('#appearance-' + key).value;
      value.size = Number(value.size);
      if (!fonts.includes(value.font) || !Number.isInteger(value.size) || value.size < 12 || value.size > 24 || ['incoming', 'outgoing', 'text', 'translation'].some((key) => !/^#[0-9a-f]{6}$/i.test(value[key]))) {
        status.textContent = '保存失败：请选择本机字体、12–24 整数字号和 #RRGGBB 颜色。';
        return;
      }
      const saved = write('appearance', validAppearance(value), select.value);
      status.textContent = saved ? '已保存到当前身份 / 当前账号。' : '本地存储不可用，保存失败。';
      load();
      onChange();
    });
    root.querySelector('#appearance-reset').addEventListener('click', () => {
      if (!access.can('appearance') || access.get().revision !== revision || (select.value && !access.account(select.value))) return;
      const saved = write('appearance', defaults, select.value);
      status.textContent = saved ? '当前账号已恢复默认外观。' : '本地保存失败。';
      load();
      onChange();
    });
    load();
    return root;
  }

  Object.defineProperty(window, 'HaituoPlatform', { value: Object.freeze({ home, recharge, usage, staffPage, permissionCenter, personalCenter, announcements, appearancePage, applyAppearance, loadFonts, read, write, denied }), writable: false });
})();
