# 内容获客数据上云（content 云函数）

章鱼哥每晚在生意手账「内容生产板块 → 今日获客录入」（`#/content-entry`）录入当天的数字：

- 当天新增微信好友数；
- 按 抖音 / 视频号 / 公众号 / 小红书 拆分的人数，**四项合计必须正好等于新增数**，否则前端和云函数都会拒绝保存。

数据存在和销售账本同一个 CloudBase 环境里，但完全分开：

| | 内容 | 销售（不动） |
|---|---|---|
| 云函数 | `content`（入口 `server/content-cloud.ts`） | `sales`、`reminders` |
| 集合 | `content_daily`、`content_audit`、`content_receipts` | `sales`、`products`、`batches`、`customers`、`tasks`、`subscriptions`、`deliveries` |
| 打包 | `cloudfunctions/content/`、`artifacts/customer-content-function.zip` | 原样不变，`npm run check` 会逐字节核对 |

## 隔离靠什么

云函数在平台上以管理员身份访问数据库，数据库安全规则管不住它，CAM 也只能细到环境。所以隔离在代码里做，并由测试锁住：

1. **集合白名单** `contentOnly()`（`server/content/guard.ts`）：只放行上面 3 个集合，其他名字（包括全部销售集合）直接抛错。
2. **源码扫描**（`tests/content-isolation.test.ts`）：用 esbuild 的依赖清单确认 content 函数打包进来的源码只有 `server/content/*`、`server/content-cloud.ts`、`src/domain/content.ts`；内容相关文件里不许出现销售集合名，也不许引用销售代码。
3. **销售函数包逐字节一致**：`tests/fixtures/sales-bundles.sha256.json` 存的是改动前 `origin/main` 的 sales / reminders 包哈希；`npm run check` 最后一步 `node scripts/verify-sales-bundles.mjs` 会核对。基线只能这样更新：
   - **只有**改动的是销售代码（sales / reminders），**并且**第二大脑已经审查通过、**并且**章鱼哥本人已经确认，才可以运行 `node scripts/verify-sales-bundles.mjs --update`；
   - 更新后的 `tests/fixtures/sales-bundles.sha256.json` 要和那次销售改动放在同一个 PR 里；
   - 内容函数、看板或其他改动导致核对失败时，**不许**用 `--update` 让它通过，要先查清为什么销售包变了。
4. **规则清单**：`database.rules.json` 只在末尾追加 3 条 `content_*`，测试锁住原来的 7 条。

## 身份

和 sales 一样：`getAuthContext(context)` 取 uid，必须等于云函数环境变量 `OWNER_UID`。没设置 `OWNER_UID` 时一律拒绝。

## 接口动作（全部要求本人）

| 动作 | 说明 |
|---|---|
| `session` | 核对登录 |
| `content.daily.list {from,to,deleted?}` | 最多 400 天 |
| `content.daily.get {date}` | 读一天（含已删除的） |
| `content.daily.save {requestId,date,wechat_adds,leads,note,revision?}` | 新建不带 `revision`；修改必须带当前版本号，不一致就拒绝 |
| `content.daily.delete` / `content.daily.restore {requestId,date,revision}` | 软删除和恢复 |
| `content.export.publishable {from,to}` | 可发布汇总：只有日期、人数、4 个来源，没有备注 |
| `content.backup` | 导出全部内容数据和审计记录 |

每次修改都写一条 `content_audit`（前后数字对照），同一个 `requestId` 重试只生效一次（`content_receipts`）。

## 公开看板怎么拿到数字

看板的源码和数据（`content-board-src/` 下的 validate.py、build.py、cockpit.py、pipeline.py、`data/`，以及 `public/board-*`）归第二大脑维护，这个功能不改它们。只新增了导入脚本 `content-board-src/import_content_export.py`，它按 main 上看板的格式写 `acquisition.daily`（date / count / sources / note / reported_at / reported_by）。

不开公开接口。录入页点「生成可发布汇总」→ 章鱼哥确认 → 下载文件交给第二大脑：

```sh
cd content-board-src
python3 import_content_export.py 内容获客汇总-2026-10-13至2026-10-19.json         # 预览
python3 import_content_export.py 内容获客汇总-2026-10-13至2026-10-19.json --write # 写入 dashboard.json
python3 validate.py && python3 build.py   # 照常校验、生成，再走审核和 PR
```

导入脚本会用汇总覆盖这段日期（云端删掉的那天会移除），合并后跑完 validate.py 的全部检查，不通过就不写。

## 部署步骤

👤 = 只能由章鱼哥本人做。机器人不登录控制台，不经手任何密钥。

1. 👤 审查通过后，章鱼哥本人确认再推送分支、开 PR、合并。合并后 Pages 自动发布前端；**云函数不会自动部署**，`npm run deploy:functions` 也只部署 sales 和 reminders，不会碰 content。
2. 本机或 Actions 产物里取 `artifacts/customer-content-function.zip`（`npm run build:server` 生成）。
3. 👤 云开发控制台 → 文档型数据库 → 新建 3 个集合 `content_daily`、`content_audit`、`content_receipts`，每个都把权限设为自定义规则 `{"read":false,"write":false}`（逐个集合设置，不碰已有集合）。建完逐个打开确认。
4. 👤 云开发控制台 → 云函数 → 新建函数 `content`：Node.js 18 或更新、入口 `index.main`、内存 128MB、超时 10 秒，上传上一步的 zip。不创建 HTTP 访问路径。
5. 👤 `content` 函数的环境变量填 `OWNER_UID`，值和 `sales` 函数的 `OWNER_UID` 一样。
6. 👤 云开发控制台 → 云函数 → 权限控制：**先把当前配置整页截图保存**，然后**只新增** `content` 这一项：`"content": { "invoke": "auth.loginType != 'ANONYMOUS' && auth != null" }`。`*`、`sales`、`reminders` 等已有条目一个字都不改。保存后马上只读验证销售照常：打开生意手账的概览和销售明细，确认都能正常加载；不记一笔、不写任何测试数据。
7. 👤 登录生意手账 → 今日获客录入：存一条测试数字，看「最近 14 天」出现后删除，再在「最近删除」里确认能恢复（测试完可以再删掉）。
8. 👤 打开销售各页确认照常；在云开发控制台确认销售 7 个集合的权限仍是 `{"read":false,"write":false}`。

## 回滚（从轻到重，都不影响销售）

1. 权限控制里把 `content` 改成 `false`：前端立刻调不到。
2. 删除 `content` 云函数。
3. 👤 先在录入页底部点「下载内容数据备份」，再在控制台删除 3 个 `content_*` 集合。
4. 前端：revert 对应 PR。
