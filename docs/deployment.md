# 部署步骤

## 1. CloudBase 环境

本人登录 [CloudBase 控制台](https://tcb.cloud.tencent.com/dev)，创建可用的免费环境或选择已有环境，使用文档数据库。先查看控制台当前免费额度和到期时间；不要默认长期免费。收费前由本人决定。[官方计费](https://tcb.cloud.tencent.com/pricing)

创建三个集合：`sales`、`products`、`batches`。每个集合设置“所有用户不可读写”，高级规则为 `{"read":false,"write":false}`（分别应用，`database.rules.json` 是集合规则清单）。仅云函数服务端 SDK 使用管理权限读写。不要开放数据库 HTTP 接口或客户端写权限。

## 2. GitHub 身份源

在环境的身份认证中配置 GitHub OAuth。按控制台显示的实际 callback URL 创建 GitHub OAuth App；Homepage 使用 `https://jasonchou0202.github.io/JasonAI/`。OAuth Client Secret 只填 CloudBase 控制台，不能填前端、Actions 变量或提交源码。不申请 repo/repository 或组织管理权限。

安全来源配置 `https://jasonchou0202.github.io`；允许重定向至 `https://jasonchou0202.github.io/JasonAI/`。如测试 localhost，另加 `http://127.0.0.1:5173`，上线后可以移除。

生成 **Publishable Key**，核对类型；前端只可用该公开 Key。SDK 初始化和 OAuth 说明参见 [官方文档](https://docs.cloudbase.net/api-reference/webv3/authentication)。

## 3. 固定本人 UID 和部署云函数

在 CloudBase 用户管理中明确找到绑定本人 GitHub 身份的用户，并复制其 CloudBase UID。也可先在浏览器进行一次 OAuth 登录后从用户列表查找。此时账本接口依然拒绝访问，直到部署者配置本人 UID；不会把第一个登录者设为管理员。

```sh
npm run build:server
```

将 `cloudfunctions/sales/` 目录部署为 `sales` 云函数。入口 `index.main`，Node.js 18.15 或环境支持的更新 Node.js 运行时，建议 256 MB、60 秒超时。打包已包含依赖，不需要在云端重新 npm install。

在云函数环境变量配置 `OWNER_UID=<已核对的本人 CloudBase UID>`。使用云函数 SDK 调用，不创建公开 HTTP 触发器。函数中的 UID 仅取 CloudBase `getAuthContext(context)`，不信任前端 payload/header 中的 UID。

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
