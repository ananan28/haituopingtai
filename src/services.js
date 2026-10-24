// 服务注册表：以后新增服务，只需在下面数组加一项，侧边栏导航和占位页会自动生成。
window.HAITUO_SERVICES = [
  { id: 'translate', name: '翻译', icon: '译', desc: '多语言翻译引擎，占位待接入。' },
  { id: 'channel-whatsapp', name: '渠道 · WhatsApp', icon: 'W', desc: 'WhatsApp 渠道接入，占位待开发。' },
  { id: 'channel-telegram', name: '渠道 · Telegram', icon: 'T', desc: 'Telegram 渠道接入，占位待开发。' },
  { id: 'channel-signal', name: '渠道 · Signal', icon: 'S', desc: 'Signal 渠道接入，占位待开发。' },
  { id: 'more-services', name: '更多服务', icon: '·', desc: '其他可扩展服务的预留位。' }
];

// 管理入口（按角色显示）：roles 指定哪些角色可见，新增入口只需加一项。
window.HAITUO_MANAGEMENT = [
  { id: 'agent-manage', name: '代理管理', icon: '代', desc: '创建与管理分销代理（里程碑3 实现）。', roles: ['owner'] },
  { id: 'my-users', name: '我的用户', icon: '客', desc: '查看名下用户与分成（里程碑3 实现）。', roles: ['agent'] }
];
