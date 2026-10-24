# 部署步骤

## 1. CloudBase 环境

本人登录 [CloudBase 控制台](https://tcb.cloud.tencent.com/dev)，创建可用的免费环境或选择已有环境，使用文档数据库。先查看控制台当前免费额度和到期时间；不要默认长期免费。收费前由本人决定。[官方计费](https://tcb.cloud.tencent.com/pricing)

当前免费体验版控制台限制普通云函数执行时间为 3 秒，且添加外部 Web 安全域名要求升级套餐。GitHub Pages 的云端登录因此不能直接假定免费可用。可先验证环境已允许的默认静态托管域名，使用预构建的 `dist/` 上传，部署路径为 `/JasonAI`，安装和构建命令留空；若环境不支持该方案，应由本人决定是否升级，不自动购买。上线前必须实测全部接口和导入耗时。

默认静态托管域名仅用于虚构数据验收，不作为正式记账入口。[官方限制说明](https://docs.cloudbase.net/service/alias)要求正式浏览器网站使用自定义域名。本项目正式入口仍使用 GitHub Pages；需要套餐允许添加 Pages 的安全域名，购买前核对本人预算、实际总价和自动续费选项。

创建三个集合：`sales`、`products`、`batches`（其余集合见 `database.rules.json`，如同步日志 `taskSyncLog`）。每个集合设置“所有用户不可读写”，高级规则为 `{"read":false,"write":false}`（分别应用，`database.rules.json` 是集合规则清单）。仅云函数服务端 SDK 使用管理权限读写。不要开放数据库 HTTP 接口或客户端写权限。

## 2. GitHub 身份源

在环境的身份认证中配置 GitHub OAuth。此项目使用 SDK V3 `signInWithOAuth` 和 `detectSessionInUrl`，GitHub OAuth App 的 Redirect URI 必须与前端传入的 `redirectTo` 一致，即实际网站的 `https://<网站域名>/JasonAI/`；不要把其他登录流程使用的 `/__auth/` 当作本项目回调。Homepage 使用实际入口网址。OAuth Client Secret 只填 CloudBase 控制台，不能填前端、Actions 变量或提交源码。不申请 repo/repository 或组织管理权限。

安全来源配置 `https://jasonchou0202.github.io`；允许重定向至 `https://jasonchou0202.github.io/JasonAI/`。如测试 localhost，另加 `http://127.0.0.1:5173`，上线后可以移除。

生成 **Publishable Key**，核对类型；前端只可用该公开 Key。SDK 初始化和 OAuth 说明参见 [官方文档](https://docs.cloudbase.net/api-reference/webv3/authentication)。

## 3. 固定本人 UID 和部署云函数

在 CloudBase 用户管理中明确找到绑定本人 GitHub 身份的用户，并复制其 CloudBase UID。也可先在浏览器进行一次 OAuth 登录后从用户列表查找。此时账本接口依然拒绝访问，直到部署者配置本人 UID；不会把第一个登录者设为管理员。

```sh
npm run build:server
```

将 `cloudfunctions/sales/` 目录部署为 `sales` 云函数。入口 `index.main`，Node.js 18.15 或环境支持的更新 Node.js 运行时，建议 256 MB、60 秒超时。打包已包含依赖，不需要在云端重新 npm install。

在云函数环境变量配置 `OWNER_UID=<已核对的本人 CloudBase UID>`。网页端使用云函数 SDK 调用；除下面的 `/task-sync` 外，不为 `sales` 创建任何公开 HTTP 路径。函数中的 UID 仅取 CloudBase `getAuthContext(context)`，不信任前端 payload/header 中的 UID。

### iPhone 提醒事项同步（可选，`tasks.sync.list` / `tasks.sync.complete`）

1. **建集合**：新建 `taskSyncLog`（只追加的同步日志），权限设为“所有用户不可读写”，高级规则 `{"read":false,"write":false}`（已写入 `database.rules.json`），只由云函数服务端读写。
2. **同步密钥**：在 `sales` 的环境变量配置 `TASK_SYNC_KEY`，必须是**至少 32 字节的随机值**（例如 `openssl rand -base64 48` 生成）。未设置或少于 32 字节时，两个同步接口全部拒绝。密钥只保存在控制台和同步端，不要写进仓库或聊天。删掉该变量即关闭同步。
3. **HTTP 访问**：在 HTTP 访问服务里**只给 `sales` 开 `/task-sync` 这一个路径**，不要开其他路径。经 HTTP 进来的请求只会分派到这两个同步接口，调不到账本的其他操作。
4. **限流（上线前提）**：必须先在控制台为 `/task-sync` 配好限流（建议每分钟不超过 60 次），没配好不上线。**真正的防线是 32 字节随机密钥和控制台限流**；函数内的内存限流只是兜底：只统计密钥校验失败的请求（单实例每分钟 60 次），超限后这一分钟内所有请求（包括正确密钥）都直接拒绝，同步任务下一轮重试。
5. **调用方式**：`POST /task-sync`，头 `Authorization: Bearer <TASK_SYNC_KEY>`，正文 `{"action":"tasks.sync.list"}` 或 `{"action":"tasks.sync.complete","payload":{"id":"…","revision":4,"completedAt":"2026-10-24T11:30:00+08:00","requestId":"…"}}`。`completedAt` 为 `null` 表示重新打开；不能晚于当前时间 5 分钟以上；`requestId` 用于幂等重试。
6. **定期清理（待办，本次未实现）**：每次 `complete` 会在 `batches` 集合留一条 `mutation_*` 幂等回执，并在 `taskSyncLog` 追加一条日志，两者都只增不减，以后需要定期清理（例如只保留最近 90 天）。
7. **去金额**：返回给 iPhone 的客户名、title、feedback、nextAction 中，凡命中金额写法（费用、报价、收款、转账、¥/￥/$/€/RMB/CNY/USD、万/千/k/w、元/块、/月 /年、中文/大写/全角数字、不带单位的“两千八”、千分位空格、/人 /次、大小写不敏感等）的整段片段都会替换为「（含金额，已隐藏）」。

若使用 CloudBase CLI，在官方来源安装 CLI、由本人登录，复制 `cloudbase.example.json` 为被 Git 忽略的 `cloudbaserc.json`，填环境 ID 和本人 UID，再按当前 CLI 的函数部署说明部署。模板不会自动创建权限或执行部署。

## 4. GitHub Pages

仓库 Settings → Pages → Source 选择 **GitHub Actions**。仓库 Settings → Secrets and variables → Actions → Variables 添加：

| 变量                             | 内容                             |
| -------------------------------- | -------------------------------- |
| `VITE_CLOUDBASE_ENV_ID`          | 环境 ID                          |
| `VITE_CLOUDBASE_REGION`          | 环境地域，例如 ap-shanghai       |
| `VITE_CLOUDBASE_PUBLISHABLE_KEY` | Publishable Key，禁止 Secret Key |

推送 main 或手动运行 `Verify and publish sales system`。流水线测试并构建，通过后发布 Pages，并提供云函数包下载。Pages 只发布 `dist/`，不发布后台代码包或本机数据。

没有这些变量时，Pages 可预览虚构演示，但不能用于真实记账。配置好之后重新运行工作流，让前端构建获取配置。

## 5. 上线验证

本人登录成功后新增一笔实际核准的订单，在两台设备确认。退出后、使用另一个账号后，确认无法查询、修改、导入、导出；数据库直接访问必须拒绝。检查 Pages 子路径刷新、OAuth 回跳、手机网络、导入总数及逐月利润，再切换日常记账。
