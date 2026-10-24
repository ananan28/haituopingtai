// 工作台静态数据：账号、页签、右栏功能、标题栏工具、渠道目录。
// 后续接真实渠道时，只有此文件需要扩展。

window.HAITUO_ACCOUNTS = [
  {
    id: 'wa-lea',
    name: 'Léa · 法国批发',
    channel: 'whatsapp',
    avatar: 'W',
    account: '+33 6 12 34 56 78',
    status: 'online',
    unread: 2,
    partition: 'persist:wa-7f3a',
    loggedIn: true,
    demo: true,
    ui: { font: 'md', density: 3 }
  },
  {
    id: 'tg-chen',
    name: '陈伟 · 样品单',
    channel: 'telegram',
    avatar: 'T',
    account: '@chen_wei_b2b',
    status: 'online',
    unread: 0,
    partition: 'persist:tg-2b91',
    loggedIn: true,
    demo: true,
    ui: { font: 'md', density: 3 }
  },
  {
    id: 'wa-group',
    name: '法国批发群',
    channel: 'whatsapp',
    avatar: 'W',
    account: '群组 · 36 人',
    status: 'online',
    unread: 5,
    partition: 'persist:wa-91ce',
    loggedIn: true,
    demo: true,
    ui: { font: 'md', density: 3 }
  },
  {
    id: 'sg-sophie',
    name: 'Sophie Bernard',
    channel: 'signal',
    avatar: 'S',
    account: '+33 7 88 20 14 09',
    status: 'sleep',
    unread: 0,
    partition: 'persist:sg-43d0',
    loggedIn: true,
    demo: true,
    ui: { font: 'md', density: 3 }
  }
];

window.HAITUO_PAGE_TABS = [
  { id: 'recharge', name: '充值中心' },
  { id: 'tg', name: 'TG频道', badge: 2 },
  { id: 'system', name: '系统消息' },
  { id: 'accounts', name: '账号管理' }
];

// 右侧功能栏：顺序即展示顺序，hidden 只控制默认显隐。
window.HAITUO_FEATURES = [
  { id: 'quick-reply', name: '快捷回复', kicker: '消息效率', desc: '原文 / 译文快捷发送，支持分类管理' },
  { id: 'basic-translate', name: '基础翻译设置', kicker: '翻译', desc: '目标语言、自动翻译与历史补翻' },
  { id: 'advanced-translate', name: '高级翻译设置', kicker: '翻译', desc: '对话记忆、TTS 与译文样式' },
  { id: 'customer', name: '客户画像', kicker: '客户', desc: '资料、标签与跟进记录' },
  { id: 'broadcast', name: '群发消息', kicker: '触达', desc: '分组群发、间隔与任务状态' },
  { id: 'proxy', name: '代理设置', kicker: '网络', desc: '协议、账密与出口 IP 检测' },
  { id: 'fingerprint', name: '指纹设置', kicker: '环境', desc: '浏览器级指纹与设备伪装' },
  { id: 'translate', name: '翻译', kicker: '翻译', desc: '多服务商可切换的独立翻译台' },
  { id: 'writing', name: '创意写作', kicker: 'AI', desc: '撰写与回复，多格式多语气' },
  { id: 'fans', name: '粉丝统计', kicker: '数据', desc: '粉丝增长、活跃与渠道分布' },
  { id: 'other', name: '其他设置', kicker: '系统', desc: '兼容模式、自动已读与导出' },
  { id: 'reminder', name: '提醒事项', kicker: '效率', desc: '定时提醒与跟进待办' },
  { id: 'trade', name: '环球交易', kicker: '行情', desc: '金融快讯与汇率速览' },
  { id: 'screenshot', name: '截屏翻译', kicker: '工具', desc: '选区 OCR 后直接翻译，Alt+Shift+S' }
];

window.HAITUO_TITLE_TOOLS = [
  { id: 'edit', name: '编辑' },
  { id: 'add', name: '添加' },
  { id: 'search', name: '搜索' },
  { id: 'home', name: '主页' },
  { id: 'settings', name: '设置' },
  { id: 'tasks', name: '任务' },
  { id: 'stats', name: '统计' },
  { id: 'bell', name: '通知' },
  { id: 'support', name: '客服' },
  { id: 'moon', name: '夜间' },
  { id: 'language', name: '语言' },
  { id: 'lock', name: '锁定' }
];

// 渠道目录：4 列网格，20+ 渠道。
window.HAITUO_CHANNEL_CATALOG = [
  { id: 'telegram-k', name: 'Telegram K', icon: 'TK', tag: 'K 版' },
  { id: 'telegram-a', name: 'Telegram A', icon: 'TA', tag: 'A 版' },
  { id: 'whatsapp-pure', name: 'WhatsApp 纯净版', icon: 'W', tag: '纯净版' },
  { id: 'whatsapp-bulk', name: 'WhatsApp 群发版', icon: 'W+', tag: '群发' },
  { id: 'line', name: 'LINE', icon: 'L', tag: '常用' },
  { id: 'line-works', name: 'LINE WORKS', icon: 'LW', tag: '商务' },
  { id: 'signal', name: 'Signal', icon: 'S', tag: '加密' },
  { id: 'facebook', name: 'Facebook', icon: 'f', tag: '社媒' },
  { id: 'messenger', name: 'Messenger', icon: 'M', tag: '社媒' },
  { id: 'twitter', name: 'X / Twitter', icon: 'X', tag: '社媒' },
  { id: 'threads', name: 'Threads', icon: '@', tag: '社媒' },
  { id: 'xchat', name: 'Xchat', icon: 'Xc', tag: '新版' },
  { id: 'instagram', name: 'Instagram', icon: 'IG', tag: '社媒' },
  { id: 'google-voice', name: 'Google Voice', icon: 'GV', tag: '语音' },
  { id: 'skype', name: 'Skype', icon: 'Sk', tag: '通话' },
  { id: 'teams', name: 'Microsoft Teams', icon: 'T', tag: '商务' },
  { id: 'tiktok', name: 'TikTok', icon: 'TT', tag: '短视频' },
  { id: 'discord', name: 'Discord', icon: 'D', tag: '社群' },
  { id: 'zalo', name: 'Zalo', icon: 'Z', tag: '越南' },
  { id: 'viber', name: 'Viber', icon: 'V', tag: '东欧' },
  { id: 'kakao', name: 'KakaoTalk', icon: 'K', tag: '韩国' },
  { id: 'wechat', name: '微信', icon: '微', tag: '国内' },
  { id: 'qq', name: 'QQ', icon: 'Q', tag: '国内' },
  { id: 'xiaohongshu', name: '小红书', icon: '红', tag: '国内' }
];
