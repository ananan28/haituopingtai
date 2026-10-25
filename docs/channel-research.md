# 官方渠道资料库（首批/次批）

> 用途：渠道镶嵌实现参考。信息来自官方来源（WebSearch/WebFetch 检索），来源链接随文附注。
> 标注「待核验」表示暂未找到官方一手出处，或第三方来源之间存在冲突，落地前需人工确认。
> 整理日期：2026-10-25

---

## 1. WhatsApp

| 项目 | 结论 |
|---|---|
| 官方网页版 | **有**。https://web.whatsapp.com/ （另有链接缩短域名 https://wa.me/） |
| 登录方式 | **扫码（二维码）**。用手机 WhatsApp 的「关联设备 / Link a Device」扫描网页二维码 |
| 开源情况 | 客户端**闭源**，无公开源码 |
| 已知限制 | 个人版无官方自动化 API；非官方客户端/自动化有封号风险；官方商业接入须走 WhatsApp Business Platform / Cloud API |
| 结论 | **网页版内嵌可行，但自动化必须走官方 Cloud API** |

**登录方式**：网页端仅支持扫码登录，需先在手机上登录 WhatsApp 后扫描网页二维码完成设备关联（[web.whatsapp.com](https://web.whatsapp.com/)）。

**官方商业接口**：企业级消息收发走 Meta 的 **WhatsApp Business Platform / Cloud API**，通过 Business 号码注册并认证后调用（[平台概览](https://developers.facebook.com/documentation/business-messaging/whatsapp/overview)、[Cloud API 快速入门](https://developers.facebook.com/documentation/business-messaging/whatsapp/get-started)）。

**限制与风险**：
- 个人账号通过模拟网页端做自动化收发，属于非官方路径，**封号风险高**（官方无个人自动化 API，未见官方豁免条款）。
- 多账号：网页版一个浏览器 profile 对应一个账号，官方不提供网页端多账号切换；手机 App 支持双账号（**具体上限待核验**）。
- 是否需指纹伪装/代理：官方无此要求；使用反指纹/代理属于规避风控的手段，会进一步抬高封号风险。

**结论**：官方网页版可做「内嵌 WebView」承载，但**消息自动化应优先走 Cloud API**（官方、有授权模型）；若必须用网页端模拟收发，风险自负且不建议规模化。

---

## 2. Telegram（K / A 两版网页客户端）

| 项目 | 结论 |
|---|---|
| 官方网页版 | **有，两个官方版本**：Web K 与 Web A |
| 地址 | Web K：https://web.telegram.org/k/ ；Web A：https://web.telegram.org/a/ （入口 https://web.telegram.org/ ） |
| 登录方式 | **手机号**（+ 短信验证码）；已登录设备可**扫码**快速登录 |
| 开源情况 | **客户端开源**：Web K 与 Web A 均为 **GPL v3** |
| 已知限制 | 官方 App 最多 3 个账号（Premium 4 个，待核验）；网页端每实例 1 账号；有反垃圾限流 |
| 结论 | **网页版内嵌最适合**，开源可二次开发/自托管 |

**两个官方网页版**（[Telegram 官方 Apps 页](https://telegram.org/apps)）：
- **Telegram Web K**：官方团队开发，Kotlin/JS 实现，源码 https://github.com/TelegramOrg/Telegram-web-k ，许可证 **GPL v3**。
- **Telegram Web A**：由第三方（Ajaxy）开发、获 Telegram 轻量客户端竞赛冠军后收编为官方客户端，源码 https://github.com/Ajaxy/telegram-tt ，许可证 **GPL v3**。

**登录方式**：主路径为手机号 + 验证码；也可通过已登录的 Telegram App 扫描网页二维码登录（官方 API 文档 [QR Login](https://core.telegram.org/api/qr-login)）。

**限制与风险**：
- 多账号：官方 App 单个安装最多 **3 个账号**（Premium 为 4 个）——该数字来自第三方资料（[heytg](https://heytg.com/blog/how-many-telegram-accounts-can-you-actually-run-at-once-2026-limits-explained)），**官方 FAQ 原文待核验**；网页版通常每实例登录 1 个账号。
- 有反垃圾/限流机制（陌生号群发、异常频率会被限制），但官方提供开放的 **MTProto API 与 Bot API**，正常自动化路径合法。
- 是否需指纹/代理：官方无要求；多账号规模化场景需独立会话隔离（本地多 profile 即可，无需强制反指纹）。

**结论**：两个网页客户端均可直接内嵌；GPL v3 允许商用但修改后分发需开源（若仅内嵌官方构建、不改源码则不触发）。**本渠道最适合「网页版内嵌」**，也是唯一客户端完全开源的渠道。

---

## 3. Signal

| 项目 | 结论 |
|---|---|
| 官方网页版 | **无**（官方不提供浏览器网页版） |
| 桌面客户端 | Signal Desktop（Windows/macOS/Linux，Electron），下载页 https://signal.org/download/ |
| 登录方式 | **手机号**；桌面端作为「关联设备」需手机已安装 Signal 后扫码/配对 |
| 开源情况 | **客户端与服务端均开源**，许可证 **AGPL v3** |
| 已知限制 | 1 手机号 = 1 主设备 + 若干关联桌面；无多账号；无官方网页 |
| 结论 | **客户端内嵌（打包 Electron Desktop）**；注意 AGPL 义务 |

**无网页版**：Signal 官方只有移动端 + 桌面端，桌面端必须先安装手机 App（[Signal 下载页](https://signal.org/download/)：「To use the Signal desktop app, Signal must first be installed on your phone」）。

**许可证（重点）**：Signal Desktop 采用 **GNU AGPLv3**（源码 https://github.com/signalapp/Signal-Desktop ，[LICENSE](https://github.com/signalapp/Signal-Desktop/blob/main/LICENSE)）；Signal 官方亦称其协议库开源（[License update 公告](https://signal.org/blog/license-update/)）。**AGPL 的网络条款**：若你基于其代码提供服务（含修改后自建服务），需向用户公开对应源码，商用前必须做合规评估。

**限制与风险**：
- 无官方自动化/消息 API；无官方网页，无法走「网页内嵌」。
- 关联设备需每台独立配对，多账号/多实例管理受限。
- 第三方 libsignal 封装存在，但非官方，稳定性与合规性自担。

**结论**：**「客户端内嵌」**——Signal Desktop 本身是 Electron，理论上可打包内嵌（需遵守 AGPL v3 开源义务）。**不推荐**「网页版内嵌」（官方无网页）。若为获客/群发场景，Signal 对陌生号限制严格，规模化价值低。

---

## 4. Facebook Messenger

| 项目 | 结论 |
|---|---|
| 官方网页版 | **有**。https://www.messenger.com/ （亦经 facebook.com/messages） |
| 登录方式 | **邮箱/手机号 + 密码**（Facebook 账号体系） |
| 开源情况 | 客户端**闭源** |
| 已知限制 | 个人账号自动化反爬严、封号风险高；官方企业接入走 Messenger Platform（需 App 审核） |
| 结论 | **网页版内嵌可行；自动化走官方 Messenger Platform** |

**登录方式**：使用 Facebook 账号登录，支持邮箱或手机号 + 密码（[Messenger 帮助中心](https://www.facebook.com/help/messenger-app/185285184853471)）。

**官方企业接口**：面向企业/客服场景有 **Messenger Platform**（[Meta for Developers](https://developers.facebook.com/products/facebook-login/login-connect-with-messenger/)），经 App Review 授权后收发消息。

**限制与风险**：
- 个人账号网页端模拟自动化风险高，Meta 反爬与账号风控严格。
- 多账号：网页端 1 浏览器 profile 1 账号，官方无多账号豁免。

**结论**：网页版可内嵌 WebView，但**消息自动化应走官方 Messenger Platform**；直接用个人账号批量收发风险高。

---

## 5. Discord

| 项目 | 结论 |
|---|---|
| 官方网页版 | **有**。https://discord.com/app （登录页 https://discord.com/login ） |
| 登录方式 | **邮箱 + 密码**；也可用手机 App **扫码**登录 |
| 开源情况 | 客户端**闭源** |
| 已知限制 | 官方 **Bot API（OAuth2/bot）**允许自动化；自动化普通用户账号（self-bot）**违反 ToS，会封号** |
| 结论 | **网页版内嵌可行；自动化用官方 Bot API** |

**登录方式**：邮箱 + 密码，或手机 App 扫码（[Discord 官方登录文档](https://support.discord.com/hc/en-us/articles/360057027354-How-to-Log-In-to-your-Discord-Account)）。

**自动化边界（官方明确）**：官方支持通过 **OAuth2/Bot API** 创建机器人自动化；但「在 Bot API 之外自动化普通用户账号（self-bot）被禁止，可导致账号封禁」（[Automated User Accounts (Self-Bots)](https://support.discord.com/hc/en-us/articles/115002192352-Automated-User-Accounts-Self-Bots)）。

**限制与风险**：多账号自动化（self-bot）为违规行为，不建议；合规路径是注册官方机器人（Bot）。

**结论**：网页版可内嵌；**消息自动化应使用官方 Bot API**，不要用普通账号跑 self-bot。

---

## 6. Instagram

| 项目 | 结论 |
|---|---|
| 官方网页版 | **有**。https://www.instagram.com/ （登录 https://www.instagram.com/accounts/login/ ） |
| 登录方式 | **用户名/邮箱/手机号 + 密码**；或「继续使用 Facebook」 |
| 开源情况 | 客户端**闭源** |
| 已知限制 | 自动化反爬极严，第三方工具封号风险高；官方接口走 Instagram Graph API（需 App Review） |
| 结论 | **网页版内嵌可行，但 DM 自动化走官方 Graph API，否则不建议** |

**登录方式**：用户名/邮箱/手机号 + 密码（[Instagram 帮助](https://help.instagram.com/164895810321211/)），或经 Facebook 账号登录。

**官方接口**：Meta 的 **Instagram Graph API**（[平台概览](https://developers.facebook.com/documentation/instagram-platform/overview)）供合规自动化，DM 等能力需通过 App Review 授权。

**限制与风险**：
- 个人账号网页模拟/第三方工具自动化**封号风险高**（Meta 风控严格）。
- 多账号：网页端 1 profile 1 账号，无官方豁免。

**结论**：网页版可内嵌 WebView；**批量自动化必须走 Instagram Graph API**（经审核），直接用网页模拟操作不建议。

---

## 7. LINE

| 项目 | 结论 |
|---|---|
| 官方网页版 | **无**（官方不提供浏览器网页版；历史上曾有 Chrome 扩展，现状**待核验**） |
| 桌面客户端 | LINE for PC / Mac（官网 https://www.line.me/ ） |
| 登录方式 | **二维码（主）**、邮箱 + 密码、生物识别（[官方 PC 登录说明](https://help.line.me/line/mac/?contentId=50001182&lang=en)） |
| 开源情况 | 客户端**闭源** |
| 已知限制 | 官方企业接入走 LINE Official Account / Messaging API；无网页嵌入 |
| 结论 | **客户端内嵌（桌面 App）或走 Messaging API**；网页版内嵌不可行 |

**无网页版**：LINE 官方 PC 登录说明列出「二维码 / 生物识别 / 邮箱密码」三种方式，且无官方浏览器网页版（官方只提供桌面客户端；Chrome 扩展的历史状态**待核验**，第三方资料称其已停服）。

**官方企业接口**：**LINE Official Account / Messaging API**（[LINE Developers](https://developers.line.biz/)、[LINE Business ID](https://manager.line.biz/)）为合规的自动消息通道。

**结论**：无网页可内嵌；**推荐「客户端内嵌（打包桌面 App）」或直接对接 Messaging API**。纯网页镶嵌方案不可行。

---

## 汇总结论

| 渠道 | 官方网页版 | 登录 | 开源 | 建议 |
|---|---|---|---|---|
| WhatsApp | 有（web.whatsapp.com） | 扫码 | 闭源 | 网页版内嵌 + Cloud API（自动化） |
| Telegram K/A | 有（web.telegram.org/k/ 与 /a/） | 手机号/扫码 | **GPL v3** | **网页版内嵌（最优）** |
| Signal | 无 | 手机号 + 桌面配对 | **AGPL v3** | 客户端内嵌（Electron），注意 AGPL |
| Facebook Messenger | 有（messenger.com） | 邮箱/手机号+密码 | 闭源 | 网页版内嵌 + Messenger Platform |
| Discord | 有（discord.com/app） | 邮箱+密码/扫码 | 闭源 | 网页版内嵌 + Bot API |
| Instagram | 有（instagram.com） | 用户名/邮箱/手机号+密码 | 闭源 | 网页版内嵌 + Graph API |
| LINE | 无 | 扫码/邮箱/生物识别 | 闭源 | 客户端内嵌 或 Messaging API |

**一句话原则**：有官方网页版且允许的（Telegram、Discord、WhatsApp、Messenger、Instagram）走「网页版内嵌 + 官方 API 自动化」；无网页版的（Signal、LINE）走「客户端内嵌」，其中 Signal 受 AGPL v3 约束、LINE 建议对接 Messaging API。
