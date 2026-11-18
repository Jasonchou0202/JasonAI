# 小程序第 3 批 · 说明（本地分支 feat/20261118-miniapp-batch3，未推送、未部署）

范围对应方案第 8 节第 3 批：账本设置（导入 Excel、备份、恢复）、头像、内容生产（录入 + 看板只读版）、订阅消息提醒、示例数据、全量对照验收（清单和脚本已写好，等三批合并后再跑）。

## 改了什么

### 新增文件（不和第 1、2 批冲突）
| 文件 | 作用 |
|---|---|
| `server/miniapp/batch3.ts` | 第 3 批云端调用：`miniapp.import.preview/commit`、`miniapp.backup.export/restore`、`miniapp.content.board`、`miniapp.subscribe.config/record`、`content.daily.*`（只开放录入相关的 5 个） |
| `server/miniapp/board.ts` | 内容看板只读摘要：读随包的 `content-board-src/data/dashboard.json`，回包约 15KB |
| `server/miniapp/notify.ts` | 服务通知发送逻辑：到点规则和网页推送一样；先扣次数，再发 |
| `server/reminder-cloud-miniapp.ts` | reminders 的小程序版入口：先原样跑原来的 `main`，只有开关打开时才接着发服务通知 |
| `scripts/build-miniapp-b3.mjs` | 构建 `cloudfunctions/reminders-miniapp/` 和两个小程序分包库 |
| `src/miniapp-b3/*` | 小程序分包库源码：纯 JS SHA-256 和 UTF-8 编解码、读 Excel、备份压缩、示例数据环境补丁 |
| `miniprogram/pkg-settings/*`、`pkg-content/*`、`pkg-demo/*` | 8 个页面 |
| `miniprogram/utils/b3.js`、`miniprogram/styles/b3.wxss` | 第 3 批共用的工具函数和样式 |
| `scripts/miniapp-acceptance.mjs`、`docs/miniapp-acceptance.md` | 全量对照验收：自动核对加真机清单 |
| `scripts/miniapp-preview-b3.mjs` | iPhone 宽度预览图（只用示例数据） |
| `tests/miniapp-batch3.test.ts`、`miniapp-notify.test.ts`、`miniapp-b3-libs.test.ts` | 新增 30 个测试 |

### 改动的已有文件（合并时可能冲突，改动都很小）
| 文件 | 改动 |
|---|---|
| `miniprogram/app.json` | 在末尾加了 `subpackages`，含 3 个分包 |
| `server/miniapp/gate.ts` | 加 1 行 import；`MiniappDeps` 加可选字段 `batch3`；在 `if (who.role === "none") throw NO_ACCESS();` 后面挂了 5 行。不配 `batch3` 时，行为和第 1 批完全一样 |
| `server/miniapp-cloud.ts` | 加 import，加 `batch3: {...}` 依赖 |
| `scripts/build-server.mjs` | 末尾追加 2 行，调用 `build-miniapp-b3.mjs` |

### 完全没动
- `sales`、`content`、`sales-stats`：代码没改，`verify-sales-bundles` 核对三个包都和基线逐字节一致。
- `cloudfunctions/reminders/index.js`：原来的 reminders 包也逐字节不变。小程序版是另一个产物 `cloudfunctions/reminders-miniapp/`。
- 数据库规则、存储规则、CloudBase 登录配置都没动。用到的集合 `miniapp_subs` 第 1 批已经建好，规则全关。

## 要 Jason 填的值（这里只列名字，不写值）

| 名字 | 配在哪 | 说明 |
|---|---|---|
| `MINIAPP_NOTIFY_ENABLED` | `miniapp` 和 `reminders` 两个函数 | 缺省关。设成 `1` 才开服务通知 |
| `MINIAPP_TPL_TASK` | 两个函数都要配 | 「日程提醒/待办提醒」模板 ID。在 mp 后台「订阅消息 → 公共模板库」选用后拿到，不是密钥 |
| `MINIAPP_TPL_APPLY` | 两个函数都要配 | 「申请提醒」模板 ID |
| `MINIAPP_TPL_TASK_KEYS` | 只配 `reminders` | 模板里的字段名，按「事项, 时间, 备注」的顺序，例如 `thing1,time2,thing3`，以选用后模板详情页显示的为准 |
| `MINIAPP_TPL_APPLY_KEYS` | 只配 `reminders` | 同上，顺序是「事项, 时间, 说明」 |
| `MINIAPP_STATE` | 只配 `reminders`，可不填 | 不填就是体验版 `trial`；正式发布后改成 `formal` |

另外，mp 后台的「用户隐私保护指引」要补声明这几项：选择文件（`chooseMessageFile`，用来导入 Excel 和恢复备份）、相册和相机（`chooseMedia`，用来换头像）、剪贴板（`setClipboardData`，用来复制看板链接）。

## 上线步骤（每一步都要 Jason 单独说「上」）
1. **代码合并**：第 1、2、3 批的分支合并到一起，跑 `npm run check` 和 `node scripts/miniapp-acceptance.mjs`，再推送、开 PR、合并。
2. **重新部署 `miniapp` 函数**：用的是合并后的包，第 3 批的调用会跟着生效。`MINIAPP_ENABLED` 不动；第 3 批没有新增集合。
3. **替换 `reminders` 函数代码**：换成 `artifacts/customer-reminders-miniapp-function.zip`。开关关着时，行为和现在完全一样。这一步会改变线上 reminders 的代码，`tests/fixtures/sales-bundles.sha256.json` 的基线要先经第二大脑审查、Jason 确认后再用 `--update` 更新。
4. **在 mp 后台选用两个订阅消息模板**，把模板 ID 和字段名填进上表的环境变量。只填值，开关先关着。
5. **打开 `MINIAPP_NOTIFY_ENABLED`**（两个函数一起开），然后在真机上实测：定时器里能不能用云调用发订阅消息。这是方案附录 D 留下的唯一一项。
6. **上传小程序代码，设成体验版**：先跑 `npm run build:server` 生成分包库，再在开发者工具里上传。

## 需要 Jason 决定的事
1. **reminders 怎么上**：A. 把线上 reminders 换成小程序版入口（推荐。开关关着时行为不变，但基线要更新一次）；B. 先不换，服务通知等以后再说。
2. **内容看板只读版的数据新旧**：现在看板数据随 `miniapp` 函数打包，仓库里的快照是 10-30 的。要跟上网页看板，可以选：A. 每次第二大脑更新看板以后，重新部署一次 `miniapp`；B. 以后改成从 GitHub Pages 读最新数据，这要云函数能访问外网，需要另外评估。
3. **大文件中转**：表格或备份超过 90KB 时，走微信官方的 `wx.cloud.CDN`，由云函数下载。云函数只接受 https 地址，限 10MB/20MB，15 秒超时，不跟随跳转。CDN 的具体域名要真机实测后才知道，是否加域名白名单由 Jason 决定。
4. **备份太大**：压缩后超过约 900KB（小程序回包上限是 1MB），小程序会提示「请在网页上下载」。要不要以后改成分块下载，由 Jason 决定。

## 和第 1、2 批的衔接（合并时要做）
- 第 1 批「我的」页加一个入口，跳到 `/pkg-settings/index/index`（设置与更多）。
- 示例模式：进入以后，`getApp().globalData.demo = { role }`，所有 `wx.cloud.callFunction` 都由本机示例账本回答。第 1、2 批的页面可以读这个标记，在顶部显示「示例数据」，这一项可选。
- 第 2 批如果也加了 `subpackages`，合并 `app.json` 时把两边的分包列表并到一起。
- `gate.ts`：第 2 批如果也在 `who.role === "none"` 附近加了分发逻辑，只要保证第 3 批的挂钩在业务转发 `deps.business` 之前就行。
