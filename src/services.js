// 顶部导航页签：roles 省略表示所有角色可见，新增页签只需加一项。
window.HAITUO_TABS = [
  { id: 'chat', name: '聊天', icon: '聊', desc: '多渠道消息聚合与实时翻译。' },
  { id: 'translate', name: '翻译', icon: '译', desc: '180+ 语言互译、文档翻译、实时语音合成。' },
  { id: 'recharge', name: '充值中心', icon: '充', desc: '按字符计费，购买翻译额度。' },
  { id: 'agent-manage', name: '代理管理', icon: '代', desc: '创建与管理分销代理。', roles: ['owner'] },
  { id: 'my-users', name: '我的用户', icon: '客', desc: '查看名下用户与分成。', roles: ['agent'] },
  { id: 'about', name: '关于', icon: '关', desc: '产品信息与版本说明。' }
];

// 聊天页渠道：以后接入真实渠道，只需在数组里加一项。
window.HAITUO_CHANNELS = [
  { id: 'whatsapp', name: 'WhatsApp', icon: 'W', desc: '已接入演示会话' },
  { id: 'telegram', name: 'Telegram', icon: 'T', desc: '渠道待接入' },
  { id: 'signal', name: 'Signal', icon: 'S', desc: '渠道待接入' },
  { id: 'more', name: '更多', icon: '+', desc: '扩展新渠道' }
];
