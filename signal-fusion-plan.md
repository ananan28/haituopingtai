# Signal 源码级融合迁移计划（skeleton）

目标：把旧海拓（Signal Desktop 分支，Electron 44.1.0）的 **Signal 消息渠道**（渲染会话界面 + 消息管线）以**源码级**迁入商业版平台，Signal 只作为平台一个渠道（等同 WA/TG），**不搬旧海拓壳/标题栏/账号体系**。商业版仍是主程序，Signal 会话用 `WebContentsView` 承载在主窗口内容区。

本文是"骨架"交付物：只做迁移面映射 + 精确文件/行号引用，不含实现。

---

## 0. 双方基座

| | 商业版平台 | 旧海拓 (Signal 分支) |
|---|---|---|
| 路径 | `C:\Users\AQ28n\Documents\Qoder\2026-10-24\e0790209\` | `C:\Users\AQ28n\AppData\Local\Temp\haituo-signal-probe\` |
| Electron | **44.1.0（本次已升级，见 §6）** | 44.1.0 |
| 主进程入口 | `main.js` | `src/app/bundles/main.js`（1.3MB webpack 产物，`package.json` `"main": "bundles/main.js"`） |
| 渲染入口 | `src/index.html`（平台壳） | `src/app/background.html` |
| 进程模型 | 单窗口 + 每渠道 `WebContentsView` | 单实例 `signal-main` + 每账号独立进程 `--caisheng-profile` |

---

## 1. 必须迁入的旧海拓主进程模块（消息管线 / DB / libsignal / websocket / IPC）

旧海拓主进程是**单个 webpack bundle**（`bundles/main.js`），内部"模块"不可单独拆分，必须整段迁入后裁剪。关键锚点（行号对应该 bundle）：

| 子系统 | 位置 | 说明 |
|---|---|---|
| libsignal 密码学 | `bundles/main.js:23,29` | `require('@signalapp/libsignal-client')` + `dist/Minidump.js`、`dist/incremental_mac.js`（原生 .node） |
| 其它原生依赖 | `bundles/main.js:51` | `node:worker_threads`、`@signalapp/windows-ucv`、`@indutny/simple-windows-notifications` |
| SQL 通道 (IPC↔worker) | `bundles/main.js:27249` | `sql-channel:read` / `sql-channel:write` / `sql-channel:remove-db` / `pause-sql-writes` |
| SQL 调用协议 | `bundles/main.js:27057-27112` | `sqlCall:read` / `sqlCall:write`（渲染层通过 IPC 发 SQL，主进程转 worker） |
| SQL 执行 worker | `bundles/workers/sql.js`（334KB，L1） | `require('@signalapp/sqlcipher')` + `require('@signalapp/ringrtc')` + `node:worker_threads`；sqlcipher 为 WASM 内嵌 |
| 媒体 worker | `bundles/workers/heic.js`(1.3MB)、`mp3Encoder.js`(253KB) | 附件/语音编码 |
| websocket / 服务连接 | `node:http`/`node:https`/`node:tls`（bundle 头部 require） | Signal 服务长连接与代理 |
| IPC 注册总量 | `bundles/main.js` | `ipcMain.handle` ×79、`ipcMain.on` ×58、`removeHandler` ×20 |
| 特权 scheme | `bundles/main.js:30390` | `registerSchemesAsPrivileged`：`asset`(corsEnabled)、`attachment`(standard+fetch+stream) |
| 主窗口 webPreferences | `bundles/main.js:28881-28887` | `nodeIntegration:false`、`sandbox:false`、`contextIsolation:!a.S(a.y())`、preload=`bundles/preload/wrapper.js` |
| 主窗口加载 | `bundles/main.js:29155` | `tv(Z, ... background.html)`（测试态 `test/index.html`） |
| WA/TG webview 注入 | `bundles/main.js:29030` | `js/caisheng-webview-preload.js`（sandbox+contextIsolation 的网页翻译注入） |

**关键原生依赖（必须随迁，位于构建产物 asar.unpacked，源树 `src/app/node_modules` 里没有预编译 .node）**：

```
windows/out/win-unpacked/resources/app.asar.unpacked/node_modules/
  @signalapp/libsignal-client/prebuilds/win32-x64/@signalapp+libsignal-client.node
  @signalapp/sqlcipher/prebuilds/win32-x64/@signalapp+sqlcipher.node
  @signalapp/ringrtc/build/win32/libringrtc-x64.node
  @indutny/simple-windows-notifications/prebuilds/win32-x64/...node
  @signalapp/windows-ucv/...（窗口/剪贴板原生）
```

**Signal 渲染器（会话界面）入口链**：

```
background.html:128  window.startApp()                 ← 页面内联脚本（CSP 限 sha256）
bundles/preload/wrapper.js (1KB)                       ← 用 vm.Script 编译并运行下面这个
bundles/preload/main.js (10.9MB)                       ← 定义 window.startApp = ...，7 处 startApp
   └ 动态 import('modules/${e}') / import('themes/${t.theme}') 加载 React 会话界面
bundles/chunks/*、bundles/dom/*、stylesheets/*、images/*、fonts/*、_locales/*
```

---

## 2. 必须接上的商业版模块

| 商业版模块 | 关键接口 | 融合后职责 |
|---|---|---|
| `runtime-access.js` | `trusted(event)`、`restore()`、`authorize(permission)`、`can(permission)`、`isDemo()`、`current()`、`revision()`、`bindWindow(contents)`、`onChange()`（L148-153） | Signal 渠道的 4 角色权限门禁（谁能开哪个 Signal 账号） |
| `auth.js` | `init(sessionFile, safeStorage)`、`isConfigured()`、`onAuthStateChange()` | Supabase 会话注入 Signal 主进程（用户身份） |
| `distribution.js` | `assignChannel(staffId, channels)`、`allocateChars(...)` | 把 Signal 账号当作可分配渠道接入计费/分销 |
| `ipc.js` | `registerIpc()`（L11） | 与 Signal 主进程的 `sql-channel`/`caisheng:*` 通道**命名空间隔离**，防冲突 |
| `src/webchannels.js` | `WebContentsView` + 每账号 persist 分区（L119） | **复用其承载模式**：Signal 会话也走 WebContentsView + 独立分区 |
| `main.js` | `createWindow`(L19)、`registerIpc`(L61)、`webchannels.init`(L73)、`signalHost.init/launch`(L76-77) | 挂载 Signal 后端；当前 `signal-host.js`（独立进程跟随）作为过渡保留、融合后退役 |
| `preload.js` | `contextBridge.exposeInMainWorld('haituo', ...)` | 平台壳的桥；Signal 桥走旧海拓 preload（见 §3） |

---

## 3. 融合架构（WebContentsView + preload 桥，参考 TranGPT）

```
平台主窗口 (main.js createWindow, src/index.html)
 ├─ TitleBar / 左导航 / 内容区（平台壳渲染器，preload.js 桥 window.haituo）
 └─ WebContentsView: Signal 会话（每账号一个，独立 persist 分区）
       ├─ 加载 background.html（旧海拓渲染入口）
       ├─ preload = 旧海拓 bundles/preload/wrapper.js → main.js（定义 window.startApp）
       └─ IPC 桥：渲染器 sqlCall → 平台内 Signal 主进程模块 → workers/sql.js (sqlcipher)
                                  → libsignal-client（消息加解密）
                                  → websocket（Signal 服务）
```

要点：
1. 把旧海拓 `bundles/main.js` 的 Signal 内核改造成一个**可被平台 main.js require 的模块**（`signal/` 新目录），只保留：消息管线、sqlcipher DB、libsignal、websocket、IPC handler、background.html 渲染供给。删除：旧壳窗口、旧账号/托盘、`caisheng:*` 多进程账号管理（改由平台 `distribution.js` + `webchannels` 模式接管）。
2. `ipcMain.handle` 命名空间：旧海拓通道与商业版 `ipc.js` 通道（`auth:*`/`staff:*`/`realtime-config:*`/`clipboard:*`/`ocr:*`）无重名，但 `get-config`/`show-window`/`shutdown`/`restart` 等需改名或按 webContents 分区，避免平台壳与 Signal 会话抢 handler。
3. 权限：Signal 会话 `sqlCall` 到达时，用 `runtime-access.trusted(event)` 校验发送者 + `authorize(permission)` 校验角色，未授权拒绝写通道。
4. 会话隔离：沿用 `src/webchannels.js` 的"每账号 UUID 独立 persist 分区"（`WebContentsView({ partition: ... })`），Signal DB 文件也按账号 UUID 隔离目录。

---

## 4. 实测结论（renderer-hosting PoC，已跑通验证，不虚构）

用 Electron 44.1.0 新建窗口加载 `background.html` + `bundles/preload/wrapper.js`（`signal-renderer-poc.tmp.js`），结果：

1. **裸源树**（`src/app/node_modules` 无原生 .node）：preload 加载失败
   `No native build was found for ... electron=44.1.0 ... @signalapp/libsignal-client` → `window.startApp is not a function` → 空白 loading 屏。
   根因：原生预编译 `.node` 只在 `app.asar.unpacked/node_modules/...`，源树 node_modules 只有 JS 包装。
2. **补上原生 prebuilds 后**：preload 成功加载，渲染器 boot 到
   `ipcRenderer.sendSync('get-config')` —— **同步 IPC 无监听者 → 渲染进程永久阻塞**（GPU 进程也退出）。
   根因：Signal 渲染器 boot 依赖主进程的 `get-config` / `sql-channel` 等 handler；**没有 Signal 主进程后端，渲染器无法独立运行**。

结论：Signal 渲染器**不能**脱离其主进程单独承载；唯一可行路径是 §3 的"主进程后端 + preload 桥 + WebContentsView"。

---

## 5. 分阶段实施（顺序 + 估时）

| 阶段 | 内容 | 估时 |
|---|---|---|
| P0 | 从 `app.asar.unpacked` 提取原生 .node 到平台 `node_modules`/`signal/native/`，`bundles/main.js` 裁剪为可 require 模块，平台 main.js 挂载 | 3-4 工日 |
| P1 | `sql-channel`/`sqlCall` + `workers/sql.js` 迁入并跑通 DB（建库/读会话） | 3 工日 |
| P2 | libsignal + websocket 迁入，消息收发闭环（发送/接收一条真实消息） | 3-4 工日 |
| P3 | background.html + preload 桥 + WebContentsView 承载、每账号分区隔离 | 2-3 工日 |
| P4 | `runtime-access`/`distribution` 权限与计费接入 + 多账号会话隔离打磨 | 2 工日 |
| 合计 | Windows 最小可测 ≈ **14 工日**（macOS 后置） | |

---

## 6. Electron 33→44 升级状态（本次已完成）

- `package.json` devDependencies `electron` → **`44.1.0`**（精确锁定，非 `^`，理由见下）；`package-lock.json` 同步 44.1.0。
- `node_modules/electron/dist/electron.exe` = v44.1.0（从 `%LOCALAPPDATA%\electron\Cache\electron-v44.1.0-win32-x64.zip` 解包，本机无外网，`@electron/get` 拉 44.9.3 会 `fetch failed`）。
- `preview-smoke.tmp.js`：**6/6 PASS**（`RESULT 6/6`）。
- 全模块 boot harness（`boot44.tmp.js`，测试后已删）：`BOOT44 OK`，auth/app-settings/screenshot/webchannels/ipc/runtime-access 全部在 Electron 44 下正常初始化；唯一非致命告警 = `Alt+Shift+S` 全局快捷键注册失败（环境占用，非 API 破坏）。
- 真实 `electron .` 启动：Supabase 配置加载、signal-host 正常拉起旧海拓子进程并发现窗口句柄（随后已清理本窗口产生的进程）。

**为何锁 `44.1.0` 而非 `^44.1.0`**：`^44.1.0` 会被 npm 解析到 44.9.3，其 zip 不在本机缓存且本机无外网，`npm install` 的 electron postinstall 会 `fetch failed` 导致 dist 缺失；锁 44.1.0 正好命中已缓存 zip。若后续需要 44.x 更高版，需先联网下载对应 zip 再放开版本。

---

## 7. 风险清单（技术原因，明确）

1. **原生 ABI**：`@signalapp/libsignal-client` / `sqlcipher` / `ringrtc` 是**按 Electron ABI 预编译**的（本机现为 abi=149/Electron 44.1.0）。若日后升 Electron 45+，需重新获取对应 prebuild，否则 `node-gyp-build` 报 "No native build found"。
2. **同步 IPC 阻塞**：Signal boot 用 `sendSync('get-config')`，若平台与 Signal 的 handler 未就绪/命名冲突，渲染进程永久冻结（PoC 已复现）。
3. **单 bundle 耦合**：`bundles/main.js` 是 1.3MB 打包产物，主进程"模块"无法按文件拆分，裁剪必须在该 bundle 内部做 tree-shake/入口改造，成本与风险高。
4. **channel 命名冲突**：`get-config`/`show-window`/`shutdown`/`restart`/`setZoomFactor` 等通用名可能与平台 `ipc.js` 或未来其它渠道撞名。
5. **多账号会话隔离**：旧海拓多账号 = 多进程 `--caisheng-profile`；融合后要改为单进程 + 每账号 WebContentsView/分区/独立 DB 目录，是最大不确定点（估时已含打磨，仍有翻车风险）。
6. **AGPL 法律**：Signal 代码 AGPL-3.0，闭源内嵌有合规风险（用户已拍板自担，本项目不再以合规为由暂停，仅此处记录）。
7. **`window.startApp` 依赖 preload 上下文**：旧海拓主窗口 `contextIsolation:false`（`bundles/main.js:28885`）才能让 preload 直写 `window.startApp` 给页面；若平台为安全要求 `contextIsolation:true`，需改用 `contextBridge`（preload 内已含 contextBridge×5 分支，需确认该分支可用）。
