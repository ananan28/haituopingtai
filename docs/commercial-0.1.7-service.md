# 海拓商业版 0.1.7 — 平台服务与渠道融合

## 本次范围

商业版由平台服务掌握身份、端口归属、模型配置和字符额度。WhatsApp / Signal / Telegram 是渠道，不运行旧普通版主程序。0.1.7 从只有本机渠道与缓存的预览，推进到可部署的服务代码；尚未部署线上，不能宣称服务已启用。

当前代码链路：服务器身份 → channel_ports 端口 → WhatsApp 消息识别 → 宿主平台函数调用 → Edge 身份核验 → SQL 额度预占 → 服务端模型链 → 成功结算/失败退款 → 端口 SQLite → 同步缓存渲染。

## 改动文件

- `supabase/migrations/20261026023000_platform_translation_service.sql`：端口归属/RLS、创建端口 RPC、服务端专用预占/结算/过期释放 RPC、幂等任务与尝试 lease；修复创建子账号直接发放未扣款额度的问题，初始额度与钱包划拨在同一数据库事务内完成。
- `supabase/functions/platform-translate/core.mjs`、`index.ts`：只接受用户 JWT；用户身份来自 Auth，字符数从原文计算；模型 URL/模型/key 只来自服务端配置；支持多个 OpenAI 兼容服务逐个失败切换；禁止客户端指定成本、其他用户或 API 地址；结果先持久结算再返回。
- `platform-translation.js`、`src/webchannels.js`：桌面端调用单一平台函数，绑定已授权账号/作用域；稳定请求 ID 防止响应丢失后的重复扣费；身份切换后丢弃旧结果。
- `auth.js`、`runtime-access.js`：真实身份端口从服务端 RLS 查询，不借用本机/演示账号；移除分配时关闭旧视图。
- `ipc.js`、`preload.js`、`src/renderer.js`、`src/platform.js`：真正创建服务端端口并恢复到账号列表；演示/本机不写线上端口。真实账号支持的渠道使用平台端口，不再只保存配置草稿。真实身份界面明确告知翻译按服务端字符结算，不沿用“不会扣费”的演示说明。
- `tests/platform-service.test.js`、`tests/platform-service-db.test.js`、`runtime-security.tmp.js`、`tests/channel-isolation.test.js`：身份、租户、额度、重放、失败恢复及原回归。
- `package.json`、`package-lock.json`、`.github/workflows/ci.yml`、`scripts/verify-package.js`、`.gitignore`：0.1.7、CI、自测入口、打包排除后端内容及 CLI 临时目录。

## 本地验证

- `npm run test:service`：13/13（含一个父测试及 12 个业务测试），使用真实 PGlite 和端口 SQLite；完整本地集成覆盖“桌面适配器 → Edge 请求处理 → 实际 SQL 预占/结算 → SQLite 保存 → 冷重开”，重放只调用一次模型、只扣一次额度。Auth 和模型使用明确的本地夹具，不冒充真实提供商。
- `npx deno check supabase/functions/platform-translate/index.ts`：通过。
- `npm run test:vm`：338/338；`npm run test:channels`：12/12；界面回归：86/86。
- Windows 完整回归与打包看 PR 最新 Actions；不在本机运行 electron-builder。

PGlite 是单连接验证，不能证明线上 PostgreSQL 多连接并发、真实 Auth、实际模型成本或真实账号收发。数据库使用钱包/子账号行锁、请求 advisory 锁与 lease 保护，但仍需隔离测试项目的并发验收。

## 线上启用所需的明确配置

1. 指定商业版专用 Supabase 项目；不能擅自复用普通版翻译控制或临时邮箱项目。现有项目中不假定任何一个就是商业版。
2. 本项目要求“不直连线上 Supabase 做写入操作”；因此迁移与函数当前只准备和本地验证。线上部署须用户对明确目标项目授权。
3. 在该项目的服务端 Secrets 配置 `HAITUO_TRANSLATION_PROVIDERS`：JSON 数组，每个元素为 `id` / `url` / `model` / `key`。只接受 HTTPS OpenAI 兼容接口，首版最多五个，单个 30 秒超时；如豆包、通义或 GPT 兼容端点。Google 原生和 DeepL 原生协议未实现，不能只改名称就声称已支持。
4. Edge 使用平台提供的 `SUPABASE_URL`、`SUPABASE_SECRET_KEYS`（default）或兼容的 `SUPABASE_SERVICE_ROLE_KEY`。这些只在服务器，绝不放入桌面包。桌面使用对应项目的公开 URL/发布密钥及用户登录会话，当前配置入口仍沿用 auth 初始化配置。
5. 初始化/迁移后，创建首个 owner，再以真实用户登录、创建端口、分配子账号额度；完成“真实模型成功扣一次、失败不扣、重试不重复扣”的验收后才能启用收费。

过期预占会在后续翻译请求前回收，数据库也提供受限的过期释放 RPC。当前未配置持续运行的定时清理；无流量时过期占用会延迟释放。结果丢失时必须重试相同请求 ID，不能人为改 ID 来绕过幂等。

## 尚未完成的融合

- Signal 原生消息的真实译文读写与发送/接收适配，Telegram 翻译适配，真实账号手机配对及双向收发验收。
- 翻译台、截图、语音、创意写作尚未接到此服务；它们仍须保持演示标识/关闭真实调用，不算本次已接通。
- 模型偏好/价格倍率后台、Google/DeepL 原生适配、真实个人额度/用量显示、线上支付与套餐。当前服务按成功翻译的原文 Unicode 字符数 1:1 扣字符，预占暂时减少可用额度，成功才记录用量；不声称已实现差异定价或支付。
- 新版“只有 owner/admin 管理重置密码”与当前旧 RPC 权限差异仍待专项修正，需把本人改密与管理重置分开；不得因这一服务代码已实现而宣称全套权限验收通过。

本阶段没有读取真实密钥或 .env，没有对任何线上项目写库或部署。
