# 小程序云函数 miniapp（第 1 批）

方案全文不在仓库里（含账号和流程细节），这里只记代码相关的约定。

## 入口和身份
- 入口 `server/miniapp-cloud.ts`，`npm run build:server` 产出 `cloudfunctions/miniapp/`（index.js 不进仓库）和 `artifacts/customer-miniapp-function.zip`。
- 小程序用 `wx.cloud.callFunction({ name: "miniapp" })`。openid/appid **只取本次调用的** `parseContext(context).environment`，不读 `process.env.WX_OPENID`、`event.userInfo` 或 payload 里的身份字段。
- 网页来源（js-sdk）的 uid 和 `sales` 一样取 `getAuthContext(context)`；网页只能调 `miniapp.owner.code / apply.* / bind.list / bind.revoke / flags`，而且只给 OWNER_UID。
- HTTP 形态的请求一律拒绝；**不要给 miniapp 开 HTTP 路由**。
- 业务调用原样交给 `server/handler.ts` 的 `handle()`，权限、数据归属、日志和网页一致。`sales` 函数一行不改（`scripts/verify-sales-bundles.mjs` 核对逐字节一致）。

## 环境变量（只列名称）
- `MINIAPP_ENABLED`：缺省关；关着时除 `miniapp.ping` 外一律 `MINIAPP_OFF`。
- `MINIAPP_APPID`：可选，只认这个小程序。
- `OWNER_UID` 和 `sales` 相同的各功能开关（MEMBERS_ENABLED、AUDIT_ENABLED、SCHEDULE_OWNER_ENABLED、AVATARS_ENABLED、SALES_ACTOR_FIELDS_ENABLED、EXPENSES_ENABLED、SALES_PAYER_ENABLED、EXPENSE_RECEIPTS_ENABLED、EXPENSE_RENEW_ENABLED、INVOICE_ENABLED），值要和 `sales` 一致（`miniapp.flags` 可核对）。
- **不需要** AppSecret、TASK_SYNC_KEY、VAPID。

## 新集合（规则全关，见 database.rules.json）
`miniapp_bindings`、`miniapp_bind_codes`、`miniapp_applications`、`miniapp_attempts`、`miniapp_subs`（第 3 批）。批准小程序成员时会往 `members` 新增 `wx_…` 成员（`inviteId: "miniapp"`），不改旧记录。

## 上线
部署、建集合、开开关、环境转换都要 Jason 本人说「上」；转换前一天先做完整备份。
