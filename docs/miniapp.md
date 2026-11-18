# 小程序云函数 miniapp（第 1 批）

方案全文不在仓库里（含账号和流程细节），这里只记代码相关的约定。

## 入口和身份
- 入口 `server/miniapp-cloud.ts`，`npm run build:server` 产出 `cloudfunctions/miniapp/`（index.js 不进仓库）和 `artifacts/customer-miniapp-function.zip`。
- 小程序用 `wx.cloud.callFunction({ name: "miniapp" })`。openid/appid **只取本次调用的** `parseContext(context).environment`，不读 `process.env.WX_OPENID`、`event.userInfo` 或 payload 里的身份字段。
- 网页来源（js-sdk）的 uid 和 `sales` 一样取 `getAuthContext(context)`。环境已关联小程序时，网页调用也可能带上 `WX_APPID`：只有 openid 合法才认作小程序来源；只有 appid、没有合法 openid 时按网页来源处理。有 openid 但格式非法的仍然拒绝。网页只能调 `miniapp.owner.code / apply.* / bind.list / bind.revoke / flags`，而且只给 OWNER_UID。
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

## 网页入口（第 1 批）
- 「账本设置 → 绑定小程序」：生成绑定码、查看/撤销绑定、两边开关一致核对条（只显示开或关）。
- 「成员管理 → 小程序申请 / 已拉黑」：批准（新成员或关联已有成员）、拒绝、拉黑、解除拉黑；成员列表给小程序成员加「小程序」标签。
- 只给管理员看。`miniapp` 函数不存在或 `MINIAPP_ENABLED` 关着时，以上全部不显示。
- 网页走独立的 `miniapp` 函数（`src/lib/miniapp-api.ts`），**不改 sales**。
- 本地预览：`/JasonAI/?miniapp-preview=1#/settings`（示例数据）。
