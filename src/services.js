// 工作台静态数据：账号、页签、右栏功能、标题栏工具、渠道目录。
// 后续接真实渠道时，只有此文件需要扩展。

window.HAITUO_ACCOUNTS = [
  {
    id: 'demo:wa-lea',
    name: 'Léa · 法国批发',
    channel: 'whatsapp',
    avatar: '',
    account: '+33 6 12 34 56 78',
    status: 'online',
    unread: 2,
    partition: 'persist:wa-7f3a',
    loggedIn: true,
    demo: true,
    ui: { font: 'md', density: 3 }
  },
  {
    id: 'demo:tg-chen',
    name: '陈伟 · 样品单',
    channel: 'telegram',
    avatar: '',
    account: '@chen_wei_b2b',
    status: 'online',
    unread: 0,
    partition: 'persist:tg-2b91',
    loggedIn: true,
    demo: true,
    ui: { font: 'md', density: 3 }
  },
  {
    id: 'demo:wa-group',
    name: '法国批发群',
    channel: 'whatsapp',
    avatar: '',
    account: '群组 · 36 人',
    status: 'online',
    unread: 5,
    partition: 'persist:wa-91ce',
    loggedIn: true,
    demo: true,
    ui: { font: 'md', density: 3 }
  },
  {
    id: 'demo:sg-sophie',
    name: 'Sophie Bernard',
    channel: 'signal',
    avatar: '',
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
  { id: 'home', name: '首页' },
  { id: 'accounts', name: '账号' },
  { id: 'recharge', name: '充值' },
  { id: 'usage', name: '用量' },
  { id: 'appearance', name: '外观' }
];

// 右侧功能栏：顺序即展示顺序，hidden 只控制默认显隐。
// status: 'deferred' 的功能只保留插件位，不渲染空壳面板。
window.HAITUO_FEATURES = [
  { id: 'quick-reply', name: '快捷回复', kicker: '消息效率', desc: '原文 / 译文快捷发送，支持分类管理', status: 'deferred', slot: 'quick-reply' },
  { id: 'basic-translate', name: '基础翻译设置', kicker: '翻译', desc: '目标语言、自动翻译与历史补翻' },
  { id: 'advanced-translate', name: '高级翻译设置', kicker: '翻译', desc: '对话记忆与译文样式' },
  { id: 'customer', name: '客户画像', kicker: '客户', desc: '资料、标签与跟进记录', status: 'deferred', slot: 'crm' },
  { id: 'broadcast', name: '群发消息', kicker: '触达', desc: '分组群发、间隔与任务状态', status: 'deferred', slot: 'broadcast' },
  { id: 'proxy', name: '代理设置', kicker: '网络', desc: '协议、账密与出口 IP 检测' },
  { id: 'fingerprint', name: '指纹设置', kicker: '环境', desc: '浏览器级指纹与设备伪装' },
  { id: 'translate', name: '翻译', kicker: '翻译', desc: '多服务商可切换的独立翻译台' },
  { id: 'writing', name: '创意写作', kicker: 'AI', desc: '撰写与回复，多格式多语气' },
  { id: 'fans', name: '粉丝统计', kicker: '数据', desc: '粉丝增长、活跃与渠道分布', status: 'deferred', slot: 'analytics' },
  { id: 'other', name: '其他设置', kicker: '系统', desc: '兼容模式、自动已读与截屏偏好' },
  { id: 'reminder', name: '提醒事项', kicker: '效率', desc: '定时提醒与跟进待办' },
  { id: 'trade', name: '环球交易', kicker: '行情', desc: '金融快讯与汇率速览' },
  { id: 'screenshot', name: '截屏翻译', kicker: '工具', desc: '选区 OCR 后直接翻译，Alt+Shift+S' }
];

// 翻译服务商 v1：固定列表，由后台托管与配置，客户侧不可见 API / Key。
// pricePerK = 每 1000 翻译字符扣除的额度；DeepL 成本高压底且单价最高。
window.HAITUO_TRANSLATE_PROVIDERS = [
  { id: 'doubao', name: '豆包', vendor: '字节跳动', enabled: true, pricePerK: 6, packages: ['free', 'pro', 'team'], note: '后台默认第 1 位' },
  { id: 'qwen', name: '通义千问', vendor: '阿里云', enabled: true, pricePerK: 8, packages: ['free', 'pro', 'team'], note: '默认第 2 位' },
  { id: 'google', name: 'Google', vendor: 'Google Cloud', enabled: true, pricePerK: 12, packages: ['pro', 'team'], note: '默认第 3 位' },
  { id: 'gpt', name: 'GPT', vendor: 'OpenAI', enabled: true, pricePerK: 20, packages: ['pro', 'team'], note: '默认第 4 位' },
  { id: 'deepl', name: 'DeepL', vendor: 'DeepL SE', enabled: true, pricePerK: 36, packages: ['team'], note: '成本最高，默认压底' }
];

window.HAITUO_PROVIDER_POLICY = {
  defaultChain: ['doubao', 'qwen', 'google', 'gpt', 'deepl'],
  customerPlan: 'team',
  billingUnit: '翻译字符',
  rules: ['客户单次手动选择', '客户默认偏好', '后台默认顺序（逐级降级）']
};

// 平台术语库：机翻结果注入修正，v1 演示三条。
window.HAITUO_GLOSSARY = [
  { from: 'Passkey', to: '通行密钥', note: '不得译为“密码”' },
  { from: 'Proforma Invoice', to: '形式发票', note: '外贸单据固定译法' },
  { from: 'FOB', to: '离岸价', note: '贸易术语' }
];

// 截屏翻译 v1：4 模式 + 12 工具 + 12 快捷色（马赛克为纯灰）。
window.HAITUO_SCREENSHOT = {
  hotkey: 'Alt+Shift+S',
  defaultMode: 'translate',
  modes: [
    { id: 'copy', name: '复制图片', hint: '纯截图，不 OCR 不翻译' },
    { id: 'extract', name: '提取文字', hint: '只输出原文，可复制' },
    { id: 'translate', name: '翻译', hint: 'OCR + 翻译 + 术语库' },
    { id: 'edit', name: '编辑', hint: '先标注再翻译' }
  ],
  tools: [
    { id: 'pen', name: '画笔' },
    { id: 'highlighter', name: '荧光笔' },
    { id: 'arrow', name: '箭头' },
    { id: 'rect', name: '方框' },
    { id: 'rounded', name: '圆角框' },
    { id: 'ellipse', name: '椭圆' },
    { id: 'mosaic', name: '马赛克' },
    { id: 'text', name: '文字' },
    { id: 'number', name: '序号标记' },
    { id: 'eraser', name: '橡皮擦' },
    { id: 'history', name: '撤销重做' },
    { id: 'pointer', name: '指针标记' }
  ],
  palette: [
    '#ff5a67', '#ff8a3d', '#f6b73c', '#ffe066', '#b18cff', '#7c5cf0',
    '#4d9bff', '#45d0e6', '#ff6fb5', '#ffffff', '#aab2c0', '#111318'
  ],
  defaults: { highlighter: '#ffe066', pen: '#ff5a67', text: '#ffffff' },
  mosaicGrain: [
    { value: 6, name: '细' },
    { value: 12, name: '中' },
    { value: 24, name: '粗' }
  ]
};

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

// 渠道目录：37 个预置渠道 + 自定义服务；v1 只做配置预览，全部标记“即将上线”。
window.HAITUO_CHANNEL_CATALOG = [
  { id: 'whatsapp-pure', name: 'WhatsApp', icon: 'W', tag: '即时通讯', coming: true },
  { id: 'whatsapp-business', name: 'WhatsApp Business', icon: 'WB', tag: '商务', coming: true },
  { id: 'telegram-k', name: 'Telegram K', icon: 'TK', tag: 'K 版', coming: true },
  { id: 'telegram-a', name: 'Telegram A', icon: 'TA', tag: 'A 版', coming: true },
  { id: 'signal', name: 'Signal', icon: 'S', tag: '加密', coming: true },
  { id: 'line', name: 'LINE', icon: 'L', tag: '亚洲', coming: true },
  { id: 'line-works', name: 'LINE WORKS', icon: 'LW', tag: '商务', coming: true },
  { id: 'line-biz', name: 'LINE Biz', icon: 'LB', tag: '商务', coming: true },
  { id: 'facebook', name: 'Facebook', icon: 'f', tag: '社媒', coming: true },
  { id: 'messenger', name: 'Messenger', icon: 'M', tag: '社媒', coming: true },
  { id: 'twitter', name: 'Twitter / X', icon: 'X', tag: '社媒', coming: true },
  { id: 'threads', name: 'Threads', icon: '@', tag: '社媒', coming: true },
  { id: 'xchat', name: 'Xchat', icon: 'Xc', tag: '新版', coming: true },
  { id: 'instagram', name: 'Instagram', icon: 'IG', tag: '社媒', coming: true },
  { id: 'google-voice', name: 'Google Voice', icon: 'GV', tag: '语音', coming: true },
  { id: 'google-voice-biz', name: 'Google Voice 商务', icon: 'GB', tag: '语音', coming: true },
  { id: 'skype', name: 'Skype', icon: 'Sk', tag: '通话', coming: true },
  { id: 'teams', name: 'Microsoft Teams', icon: 'T', tag: '商务', coming: true },
  { id: 'tiktok', name: 'TikTok', icon: 'TT', tag: '短视频', coming: true },
  { id: 'discord', name: 'Discord', icon: 'D', tag: '社群', coming: true },
  { id: 'zalo', name: 'Zalo', icon: 'Z', tag: '越南', coming: true },
  { id: 'pingme', name: 'PingMe', icon: 'PM', tag: '短信', coming: true },
  { id: 'textr-team', name: 'Textr Team', icon: 'TR', tag: '短信', coming: true },
  { id: 'livechat', name: 'LiveChat', icon: 'LC', tag: '客服', coming: true },
  { id: 'chats007', name: '007Chats', icon: '07', tag: '客服', coming: true },
  { id: 'zaobianhua', name: '灶边话', icon: '灶', tag: '私域', coming: true },
  { id: 'cocezd', name: 'Cocezd', icon: 'CZ', tag: '私域', coming: true },
  { id: 'salesmartly', name: 'SaleSmartly', icon: 'SS', tag: '客服', coming: true },
  { id: 'tigergpt', name: 'TigerGPT', icon: 'TG', tag: 'AI 客服', coming: true },
  { id: 'meiqia', name: '美洽', icon: '美', tag: '客服', coming: true },
  { id: 'getindex', name: 'GetIndex', icon: 'GI', tag: '客服', coming: true },
  { id: 'textfree', name: 'TextFree', icon: 'TF', tag: '短信', coming: true },
  { id: 'textnow', name: 'TextNow', icon: 'TN', tag: '短信', coming: true },
  { id: 'meta-business', name: 'Meta Business', icon: 'MB', tag: '商务', coming: true },
  { id: 'zoom', name: 'Zoom', icon: 'ZM', tag: '会议', coming: true },
  { id: 'snapchat', name: 'Snapchat', icon: 'SC', tag: '社媒', coming: true },
  { id: 'band', name: 'Band', icon: 'B', tag: '社媒', coming: true },
  { id: 'custom', name: '自定义服务', icon: '+', tag: 'URL 内嵌', coming: true, custom: true, url: true }
];
