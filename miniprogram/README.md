# 生意手账 · 微信小程序（第 1 批骨架）

- 后端：云函数 `miniapp`（入口 `server/miniapp-cloud.ts`，`npm run build:server` 产出 `cloudfunctions/miniapp/`）。
- 调用：`wx.cloud.callFunction({ name: "miniapp" })`，openid 由微信平台注入，**不需要 AppSecret，也不用配合法域名**。
- 本机配置（不进仓库）：
  1. 复制 `config.example.js` 为 `config.js`，填生意手账的环境 ID（环境 ID 不是密钥，但仍只放本机）。
  2. 用微信开发者工具「导入项目」选本目录，AppID 填小程序自己的 AppID（工具会生成 `project.private.config.json`，已被 gitignore）。
  3. 「后端服务」选「不使用云服务」（方案第 2 节：否则工具会自动新建腾讯云账号）。
- 第 1 批已有：入口分流（gate）、成员申请、管理员绑定码、无权限页、隐私授权弹窗、首页占位。
- 第 1 批还没做：首页看板、记一笔、销售明细、客户日程、铃铛（下一步，计算逻辑复用 `src/domain`）。
- 环境转换、部署 `miniapp`、上传体验版都要 Jason 本人说「上」。
