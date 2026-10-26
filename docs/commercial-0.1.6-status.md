# 海拓商业版 0.1.6 — WhatsApp 译文缓存链路

依据《海拓商业版关键词与提示词(2).md》第八节 B，新增 WhatsApp 渠道的本地缓存和虚拟列表重挂链路。只在商业版独立仓库修改。

## 已实现

- `src/translation-cache.js`：身份、渠道、端口分别建 SQLite；`translateCache` 的语言/原文唯一索引与会话/消息绑定分离，重复原文不会把两个消息 ID 合成一条消息。批量加载整个会话，不只加载首屏。
- `src/whatsapp-cache-preload.js`：沙箱隔离世界 preload；以 `data-id` 为主键，无 ID 时使用元数据与原文的 SHA-256；只识别含可译文本的消息。
- 打开会话一次性加载内存 Map；MutationObserver 回调内同步命中并重挂，滚动重建时不走磁盘/网络，不创建 loading 节点。
- 缓存命中标记 `translationCacheHit`；会话具有 `translationCacheLoading` / `translationCacheReady` 状态；内部支持原文/双显模式。尚未增加面向用户的语言/模式设置控件。
- 原文编辑移除旧译文；目标语言/会话切换清空当前内存；迟到的其他会话响应被丢弃；译文用 textContent 渲染。
- 端口 IPC 仅接受该 WebContents 的主框架及精确 `https://web.whatsapp.com` 来源。作用域、渠道和账号由宿主映射，不接受网页指定其他身份。没有对网页开放任意译文写入接口。
- 新消息请求入口预留宿主收费服务注入；只有授权通过且宿主返回结果才保存。本机模式只能读已有缓存，不绕过平台额度使用旧免费服务或客户端 API。

## 已运行验证

- `npm run test:whatsapp`：18 项，SQLite 冷重开、220 条整会话读取、五维隔离、编辑/重复消息、身份切换、越权、Unicode SHA-256、DOM 重建、迟到结果、纯图片/数字/表情排除。
- `npm run test:channels`：12 项，包括实际来源解析器拒绝子框架、伪造 sender、HTTP 和相似恶意域名。
- `electron tests/whatsapp-cache-electron.js`：真实 Electron 44/Chromium preload + SQLite 冷重开 + MutationObserver 微任务重挂。测试会话拦截 HTTPS 返回固定消息夹具；未连接 WhatsApp 服务或使用真实聊天。
- 回归：runtime security 338/338、local workspace 5/5、PGlite 23/23、messages 14/14、OCR 107/107。Windows 完整测试和安装包由 GitHub Actions 执行，以对应运行结果为准。
- 本地 Linux 无桌面环境，Electron 验证命令附加 `--no-sandbox --ozone-platform=headless`；Windows CI 不使用这两个参数。

## 仍未完成

该版本完成缓存与重挂链路，不能宣称真实账号自动翻译已可用。当前未注入真实平台 AI/字符扣费服务，实际运行不会生成新收费译文；测试译文只存在临时测试数据库，不会种入用户端口。后续必须接通宿主收费服务，再用真实账号验证 WhatsApp 当前 DOM、历史/离线表现和实际模型结果。

Signal P4 的真实手机配对、双账号收发和完整协议服务仍需验收；Signal 原生消息持久译文适配不能用演示消息库替代。另发现新版第三节的“仅 owner/admin 重置账号密码”与现有 user/staff 的 reset_password 授权有差异，需在个人中心/权限阶段拆分本人改密与管理重置，并同步本地迁移、RPC 和界面测试。

未读取真实 .env/密钥，未写入线上 Supabase，未本机执行 electron-builder。PR 保持开发预览状态。
