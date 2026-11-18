# 生意手账 · 微信小程序（第 1 批骨架）

- 后端：云函数 `miniapp`（入口 `server/miniapp-cloud.ts`，`npm run build:server` 产出 `cloudfunctions/miniapp/`）。
- 调用：`wx.cloud.callFunction({ name: "miniapp" })`，openid 由微信平台注入，**不需要 AppSecret，也不用配合法域名**。
- 本机配置（不进仓库）：
  1. 复制 `config.example.js` 为 `config.js`，填生意手账的环境 ID（环境 ID 不是密钥，但仍只放本机）。
  2. 用微信开发者工具「导入项目」选本目录，AppID 填小程序自己的 AppID（工具会生成 `project.private.config.json`，已被 gitignore）。
  3. 「后端服务」选「不使用云服务」（方案第 2 节：否则工具会自动新建腾讯云账号）。
- 第 1 批已有：入口分流（gate）、成员申请、管理员绑定码、无权限页、隐私授权弹窗；
  底部 4 个标签页「看板 / 明细 / 日程 / 我的」：首页看板（本月汇总、利润走势 Canvas 图、本月商品贡献 Canvas 图、客户排行前 5、铃铛角标）、
  记一笔（含顺手建日程、谁付的进货）、销售明细（筛选/搜索/分页/编辑/删除/恢复）、客户日程（月历、今日/明日/逾期、已删除、新建/编辑/完成/重开/删除/恢复）、
  铃铛（今日待办）、我的（成员申请入口、退出绑定）、成员申请审批页。
- **计算复用 domain**：`lib/domain.js` 由 `npm run build:miniapp` 从 `src/miniapp`（再引 `src/domain`）编译而来，**不要手改**；
  `tests/miniapp-pages.test.ts` 会核对它和源码同步。图表坐标和网页同一套 `profitTarget` / `finance` 计算。
- 本机草稿只存在 `utils/draft.js`（记一笔草稿）；账本数据一律不落盘。数据页打开时开启截屏遮盖。
- 本地预览（只用示例数据，不连云端）：`npx vite --port 5180` 后打开
  `http://127.0.0.1:5180/JasonAI/tools/miniapp-preview/index.html?page=pages/home/index`；
  `node scripts/miniapp-preview-shots.mjs` 出 iPhone 宽度预览图（默认到 /workspace/review/miniapp-batch1）。真机效果以体验版为准。
- 环境转换、部署 `miniapp`、上传体验版都要 Jason 本人说「上」。
- 下一版上传版本号准备为 1.0.1（报销合账改为授权成员可看全量；待确认审核仍只管理员）。
