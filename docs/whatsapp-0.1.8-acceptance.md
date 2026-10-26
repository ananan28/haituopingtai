# 海拓商业版 0.1.8 — WhatsApp 译文常驻交付与本机诊断

分支：`codex/whatsapp-persistent-bubbles`。基于商业版 0.1.7；Signal 文件、Signal 数据结构、Supabase 迁移及平台界面均不改动。没有读取真实密钥，没有复用或写入任何线上项目。

## 改动清单

- `src/translation-store.js`：Electron 自带 node:sqlite；本机 `userData/translation-cache.db`；WAL、3000ms busy_timeout、外键、幂等 schema_migrations；translation_cache / port_translation / sent_input_source；只读导入 0.1.6/0.1.7 旧端口缓存。
- 缓存键为身份隔离的 account + platform + chat + lang + SHA256(NFKC/空白归一化原文)。messageId 只辅助平台请求，不是本机缓存键；重复文本在同一聊天复用，跨账号/聊天/语言隔离。
- `src/wa-memory.js`：端口内存 LRU，最多 1000 条、8MB；命中/最近使用/年龄淘汰，可见消息钉住。容量之外冷记录经缓存检查后恢复，不冒充已通过任意真实历史跳转验收。
- `src/wa-preload.js`：document-start 专用 preload，隔离世界 DOM 钩子及主世界注入；同步 bootstrap 预热；unknown/empty/hit/stale；气泡 SVG 转圈、成功 replaceChildren、失败 2 秒重试、三次失败显示显式重试入口；发送来源读取及 copy 捕获排除译文。
- `src/wa-dom-hook.js`：插入方法、Fragment、Range、文本 setter、HTML setter 和属性变更；先 attach(1.3) → Page.enable → addScriptToEvaluateOnNewDocument(runImmediately:true)，再由调用方导航。已有加载先 stop。未就绪 target 使用 1500ms 有界等待，专用 preload 继续工作，CDP 原链在 target 就绪后补强；不通过 about:blank 导航等待来卡住视图。
- `src/wa-ipc.js`、`ipc.js`：translation:cache:* / translation:sent:* / translation:request / translation:flush；主进程 webContents.id 映射绑定身份、渠道和端口；拒绝渲染层传入 accountId/platform/scope/portId；只放行已绑定 WhatsApp 主框架的精确 HTTPS 来源。
- 新消息恢复调用 **0.1.7 platform-translate**。内容只存本机约束本次缓存持久化；不禁止新消息按既有平台服务翻译。缓存命中不调用服务，服务成功后本机提交。没有在本次改动中部署或改写服务端。
- `src/webchannels.js`：WhatsApp 专用 preload，contextIsolation:true/nodeIntegration:false/sandbox:false；双路径钩子、导航前安装及销毁/刷新 flush。Telegram 保持原偏好。
- `main.js`：本机 store 初始化、隐藏/退出 flush。
- `tests/translation-store.test.js`、`wa-ipc.test.js`、`wa-preload.test.js`、`wa-dom-hook.test.js`、`wa-before-paint-electron.js`：本机 SQLite、IPC、内容键、杀进程事务、DOM 时序与证据；原安全/渠道 harness 只调整依赖与 WhatsApp 偏好。
- `package.json` / lock、CI、打包校验：版本 0.1.8，Windows 构建和独立诊断 Artifact。后端代码不进入桌面包；诊断图片只含明确标识的本地夹具。

## 测试与证据

命令：

```text
npm ci
npm run test:whatsapp:store
npm run test:whatsapp:frames
npm run test:vm
npm run test:channels
```

Linux 无桌面容器的 Electron 命令额外使用 `--no-sandbox --ozone-platform=headless`；Windows CI 使用正常 Electron 命令。

本地新测试已验证：

- 本机表/迁移/归一化键、按身份/端口/聊天/语言隔离、空译文、旧缓存导入、发送来源重开匹配、LRU 限制。
- 强杀正在写入的子进程：旧值完整，SQLite integrity_check=ok，无半条写入。
- 默认适配器实际路由到 platform-translate（无真实网络的接口夹具）；宿主绑定参数、成功本机 flush、缓存零调用、身份切换拒绝迟到结果。
- 真实 Electron44 fixture：117 项插入即时检查，遍历 1000 个内容键；独立 rAF 样本与同步断言分别记录，所有已缓存采样无裸帧/重复 slot，缓存翻译调用 0。
- 新消息气泡内转圈→译文、两个账号同 chat/message ID 隔离、源码文本不变、原生 ClipboardEvent 复制不含译文、SQLite 冷重开不重翻、已有发送来源不重翻。
- 原 runtime security 338/338；Signal 只跑原回归。完整 Windows 结果以本次 Actions 为准。

诊断 Artifact `haituo-whatsapp-diagnostics` 包含：

- `frame-evidence.json`：同步检查、rAF 样本、裸帧/重复计数、请求计数、Electron 版本与 UNTESTED 标记。
- `before-paint-trace.json`：Chromium tracing，可本机打开检查；不是虚构的 60fps 录像。
- `cached-bubbles.png` / `inline-spinner.png` / `first-translation.png`：本地夹具运行截图。
- 本文：真实账号待验收项目、限制与回填方案。

## 两项限制

### 1. 成功译文立即事务提交

付费成功结果采用“写内存 → SQLite 原子事务提交 → 回应 preload”。成功译文**不等 2 秒防抖**，避免收到成功后立刻退出而丢失。代价是每次新翻译成功都产生一次主进程本机提交；缓存命中渲染不写盘。hits 等非关键元数据仍 2 秒合并，并在 pagehide/后台/窗口隐藏/退出时 flush。

### 2. 空白新会话首条发送的 chatId 缺口

当前 sent_input_source 接口要求有效 chatId。空白新会话尚无消息 data-id、会话头也没有稳定 ID 时，首条“原文→发出译文”的来源确认仍存在缺口；本次不伪造 chatId、不借用上一会话，也不宣称真实自动发送链路已验收。

回填方案（待实际发送适配器接入，不能当作本次已完成的自动流程）：

1. 优先在会话头读取稳定 chat ID；若没有，发送后监听新发出消息的 data-id，从 `true/false_<chatId>_<messageId>` 提取，核验当前端口和发出文本后回填 sent_input_source。
2. 发送前仍无 chatId 时，先在本机按 **verified account + platform + port + norm(sourceText)** 暂存 pending_sent_source，同时保存归一化 sentText、发送时间、尝试标识；不挂到其他聊天。
3. 本端口出现匹配的新发出消息后，用 data-id/稳定会话头确认 chatId，在同一 SQLite 事务中写入正式 sent_input_source 并删除 pending；相同请求可重放，不能重复登记。
4. 端口切换/超时/多个候选消息时保持 pending 并标待确认，禁止按联系人显示名猜聊天；pending 不跨账号迁移。

## 真实账号验收状态

| 项目 | 状态 |
|---|---|
| 真实 WhatsApp 账号登录及当前 DOM 兼容性 | UNTESTED |
| 真实模型调用、字符结算、断网历史重开 | UNTESTED |
| 实机 1000 条滚动无裸帧与录屏 | UNTESTED（夹具已有 tracing/rAF） |
| WhatsApp 原生转发、引用、搜索不污染 | UNTESTED（夹具已验证 source/copy） |
| 空白新会话首条发送来源自动回填 | UNTESTED / 自动流程待实现 |
| Signal 原生账号双向收发 | UNTESTED（仅现有回归，不修改 Signal） |

不等待上述真实账号项目才生成 Windows 开发预览构建。没有商业版专用 Supabase ref 和明确授权前，不复用现有项目，也不部署线上服务。
