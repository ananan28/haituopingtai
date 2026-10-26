# 海拓商业版 0.1.4 开发记录

本分支以 ananan28/haituopingtai 的 ab65ed3 为基线，保持商业版独立身份。

## 已修改

- 渠道授权只接受服务器明确分配的完整账号 ID，拒绝后缀匹配与演示模式外部渠道请求。
- 网页持久分区包含身份 scope、渠道和原始账号 ID 的 SHA-256，避免标点清洗碰撞及跨身份复用 Cookie。
- 身份切换时主进程销毁所有网页/Signal 视图，Signal sender 映射同步清理。
- Signal 全量视图销毁与真正 reload IPC 接入前端；重复初始化不重复注册 IPC。
- Signal profile ID 改为身份隔离且长度受控的稳定标识。这是存储注册表基础，不代表完整多账号已实现。
- Signal 运行资源加入安装清单，原生依赖与 SQL worker 解包。
- 恢复被全局 dist/ 忽略规则漏掉的六个依赖包运行入口，并保留精确版本及来源记录。
- PGlite 固定为项目开发依赖，移除原电脑绝对路径；CI 使用 Node 24。
- 界面回归同步当前离线 owner 启动与 demo: 账号命名；截图必须具备实际窗口尺寸。
- 截图画布不可见/零尺寸时拒绝坐标运算，防止无效坐标进入标注与取色。

## 尚未完成的 Signal 运行时阻塞

1. channel.js 仍调用 rendererPreferences('signal-main')；不同 profile 的 SQL 客户端尚无独立初始化/密钥生命周期。
2. bundles/main.js 的 ready 监听在用户点开渠道后才挂载，Electron ready 已经过期，不能据此声称实际 Signal 已启动。
3. bundle 仍携带普通版主窗口、应用生命周期与全局配置代码；需拆出纯 Signal 服务，不可直接把整套普通版当后端。
4. libsignal/websocket 身份分流和多个真实账号收发尚未完成。
5. RingRTC 等原生模块的完整运行依赖及 Electron 44 ABI 仍需 Windows 实机验证；解析入口存在不等于原生加载成功。

支付、线上 Supabase、真实模型计费均未接入。当前分支不能作为正式商业发行版。
