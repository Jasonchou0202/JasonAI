# WebPush 提醒部署与安全验收

本文对应 `server/reminder-cloud.ts` 的独立 `main(event, context)`。将提醒部署为 `reminders` 事件云函数，入口 `index.main`；前端的 `push.*` 仍经 `sales` 云函数鉴权和分发。

## 本次 CloudBase 部署使用秘密定时器名称

**本次 CloudBase 控制台只支持 `name` / `type` / `config`，使用秘密名称，不配置 Message，也不借用 SCF default 命名空间。** 后台 `REMINDER_TRIGGER_TOKEN` 必须是密码学随机生成的 64 位小写十六进制字符串。名称在后台构造为 `customer-reminders-` + token 的前 32 位，共 51 字符；随机后缀提供 128 bit 秘密。真实名称与 token 仅保存在后台环境变量和控制台，不进入源码、日志、截图、Git 或备份。

所有路径先要求 `event.Type === 'Timer'`，名称严格匹配 `customer-reminders` 或 `customer-reminders-[a-f0-9]{32}`；然后拒绝非本人及匿名身份，再验证来源。SDK 或 context 解析失败仍拒绝执行。秘密后缀用恒定时间比较，格式正确不等于验证通过。

| 本次调用的实际情况                                                                                                       | 当前实现是否要求 Message token | 结果                                                     |
| ------------------------------------------------------------------------------------------------------------------------ | ------------------------------ | -------------------------------------------------------- |
| `cloudbase.parseContext(context)` 返回的 `environment` 或 `environ` 中，`TRIGGER_SRC` 严格等于小写 `timer`；身份检查通过 | 不要求                         | 允许扫描                                                 |
| 没有可信 `TRIGGER_SRC`；身份检查通过，名称后缀与 token 前 32 位恒定时间比较匹配 | 不要求 Message | 允许扫描，健康来源为 `timer` |
| 没有可信 `TRIGGER_SRC`；旧精确名称及正确 Message，身份检查通过 | 兼容 Message | 允许扫描，健康来源为 `manual` |
| SDK UID 或本次 context 的 `TCB_UUID` 非空且不是 `OWNER_UID`                                                              | 即使携带正确 token 也不允许    | 拒绝                                                     |
| `loginType` 表示匿名，或本次 context 标记 `TCB_ISANONYMOUS_USER` 为 `true` / `'true'` / `'1'`                            | 即使携带正确 token 也不允许    | 拒绝                                                     |
| 无 UID 的普通调用，只伪造 Timer payload，没有可信来源、秘密后缀或正确 Message | 未满足来源验证 | 拒绝 |
| 非本人或匿名调用，携带正确秘密名称 | 不因持有秘密而放宽身份 | 拒绝，不扫描、不写健康记录 |

这里的 `context` 只指云平台传给入口函数的**第二个参数**。`event.context`、`event.uid`、`event.TRIGGER_SRC`、请求头中自报的 UID 均不能替代它。代码也不会使用 `process.env.TRIGGER_SRC` 判定本次调用来源。

可信平台 context 的 timer 来源仍可直接验证；没有此字段时使用秘密名称。手动伪造一个公开名称不能证明 timer 来源。控制台手动调用若使用正确秘密名称，也按本机制标为 `timer`，因此名称验证本身不能证明分钟触发器已经实际自动运行；自动运行仍需等待实际分钟触发并核对健康记录更新。

**不要自行设置 `TRIGGER_SRC=timer`、`TCB_UUID`、`LOGINTYPE`、`TCB_ISANONYMOUS_USER` 或 `TCB_CONTEXT_KEYS` 等平台动态字段为函数环境变量。** `parseContext` 的结果也可能包含自定义环境变量；把来源标记静态设为 timer 会破坏来源判断。反向代理或包装入口也不得把客户端提供的对象传作第二个参数。

## 环境变量、大小写和密钥

以下名称大小写敏感，必须按表填写。

| 云函数环境变量           | 对应配置字段 / 用途                                                                           | 配置位置                                      |
| ------------------------ | --------------------------------------------------------------------------------------------- | --------------------------------------------- |
| `OWNER_UID`              | `PushConfig.ownerUid`；已核对的本人 CloudBase UID，严格比较，不是 GitHub 用户名               | `sales`、`reminders`                          |
| `VAPID_PUBLIC_KEY`       | `PushConfig.publicKey`；无填充 base64url，65 字节 / 87 字符                                   | `sales`、`reminders`                          |
| `VAPID_PRIVATE_KEY`      | `PushConfig.privateKey`；同一对 VAPID 私钥，无填充 base64url，32 字节 / 43 字符               | 仅两套后端云函数的环境变量                    |
| `VAPID_SUBJECT`          | `PushConfig.subject`；可填 `https://jasonchou0202.github.io/JasonAI/`，也支持有效 mailto 地址 | `sales`、`reminders`                          |
| `REMINDER_TRIGGER_TOKEN` | 64 位随机小写 hex；其前 32 位用于秘密定时器后缀，不是 VAPID 私钥 | 仅 `reminders` 环境变量及后台触发器名称 |

所有者变量是 **`OWNER_UID`**。`PushConfig` 的字段是小写开头的 `publicKey`、`privateKey`、`subject`、`ownerUid`；不能把环境变量的全大写名称直接当成配置对象字段。`push.config` 的返回字段是 `{publicKey, configured}`。

本地生成一次 VAPID 密钥对，再分别填入两套后端函数；不要每次部署重新生成。已有设备订阅使用同一个公钥。

```sh
node -e "console.log(require('web-push').generateVAPIDKeys())"
```

trigger token 使用 32 个密码学随机字节编码成 64 位小写 hex；本次已有 token，不重新生成或输出它。秘密名称机制要求完整 token 匹配 `[a-f0-9]{64}`。旧 Message 校验仍兼容 32–256 字符的 `A-Z a-z 0-9 _ -`，仅供私密控制台手动诊断。这是恒定时间比较的共享密钥机制，不是含时间戳的 HMAC 签名。泄露时同时轮换环境变量与触发器名称；不记录完整 event/context、私钥、Message 或秘密名称，不写入前端 `VITE_*`。

浏览器订阅的 `keys.p256dh`、`keys.auth` 与 VAPID 密钥不是同一组密钥。它们只由当前设备的订阅 JSON 提交，分别校验 65 字节 / 87 字符与 16 字节 / 22 字符的无填充 base64url，`p256dh` 还需是有效 P-256 公钥点。

## 独立函数与定时触发器

1. 执行 `npm run build:server`，使用输出的 `cloudfunctions/reminders/` 部署 `reminders`，不要把定时入口配置成 `sales`。
2. 选择事件函数，入口 `index.main`；提醒包以 Node 20 为目标，使用平台支持的 Node.js 20 或更新版本，建议 256 MB、60 秒超时。当前套餐必须允许这一超时；3 秒执行额度无法保证 WebPush 网络请求完成。
3. 配置上表中的 `OWNER_UID`、三个 `VAPID_*` 和 `REMINDER_TRIGGER_TOKEN`。
4. 仅添加后台计算的秘密名称、类型 `timer`、`config` 为 `0 * * * * * *` 的分钟触发器。控制台 JSON 只用以下三个字段；占位符必须在私密后台替换，真实值不保存到项目：

   ```json
   { "name": "customer-reminders-REPLACE_WITH_TOKEN_FIRST_32_HEX", "type": "timer", "config": "0 * * * * * *" }
   ```
5. 不配置公开 HTTP、网关、路由或 URL 触发器。检查已有环境中的客户端函数调用权限，避免把 `reminders` 加入业务客户端可调用入口；代码仍按上述规则检查调用身份和来源。
6. 确保已有 `batches`、`customers`、`tasks`，并创建 `subscriptions`、`deliveries` 集合。集合都设置客户端不可读写，规则为 `{"read":false,"write":false}`；数据库由后端管理 SDK 操作。

SCF 事件结构包含 Message 不代表本次 CloudBase 控制台提供该配置。实际部署仅用秘密名称。旧精确名称加 Message 的手动诊断路径仍保留，可在私密控制台临时替换以下占位符；返回来源为 `manual`，不算分钟触发器证据：

```json
{
  "Type": "Timer",
  "TriggerName": "customer-reminders",
  "Message": "REPLACE_IN_CONSOLE_WITH_THE_SAME_RANDOM_TRIGGER_TOKEN"
}
```

客户端只调用 `sales` 的 `push.config`、`push.subscribe`、`push.status`、`push.unsubscribe`、`push.test`。`push.test` 限当前设备，每次至少间隔 30 秒；`accepted:true` 只表示推送服务接受请求，不证明手机已展示通知。

## getAuthContext 的安全边界与官方依据

[CloudBase 官方上下文文档](https://docs.cloudbase.net/api-reference/webv3/functions#parsecontext) 明确提醒实例复用可能残留动态环境信息，并要求：

> 请统一通过 `parseContext(context)` 从 `context` 中解析。

[官方 Node SDK 的 getAuthContext 源码](https://github.com/TencentCloudBase/node-sdk/blob/master/src/auth/index.ts) 中，身份读取调用及返回字段为：

```ts
CloudBase.getCloudbaseContext(context)
uid: TCB_UUID,
loginType: LOGINTYPE
```

本地已查验安装版本 `@cloudbase/node-sdk@3.18.3` 的 `src/auth/index.ts` 和 `src/utils/tcbcontext.ts`：`getAuthContext(context)` 解析并返回身份字段，`getCloudbaseContext` 会合并本次 context 与进程环境。它不根据 `event.Type` 签发“定时器证明”，也不替应用比较 `OWNER_UID`。这里引用的是官方公开源码及当前安装源码的核对结果。

平台负责提供真实 context；应用把它原样传给 SDK，拒绝非本人或匿名身份，再验证本次来源、秘密后缀或旧 Message。`parseContext(context)` 返回嵌套 `environment` 或 `environ`；`getAuthContext(context)` 仍合并进程环境，不能靠不传 context 修复身份问题。SDK 未定义 `test_UID` 系统身份豁免；其作为非本人 UID 出现时继续拒绝，不能将它改为所有者或忽略它。

验证失败不写健康记录；只有正确 Message 可取得安全 `{ok:false,error:'REMINDER_AUTH_FAILED',stage}`，无该凭据仍抛出通用拒绝。通过身份与来源验证后，扫描/健康写入失败返回 `{ok:false,error:'REMINDER_EXECUTION_FAILED',stage}`，尽力在 `_reminder_health` 写入同一个通用错误码；数据库故障时健康记录可能无法更新。固定 stage 仅区分初始化、身份解析、扫描和健康写入，不返回 SDK 异常、event 或 context。设置页不会把失败记录显示为成功扫描。

## 安全 review 结论与线上验收

本地 review 已确认：伪造 Timer payload、本次身份为其他用户或匿名、没有来源证明的无身份调用均有拒绝测试；密钥 Message 的允许路径与非本人携带正确 Message 的拒绝路径也有测试。发送仅允许 HTTPS 443 下的 `*.push.apple.com`、`fcm.googleapis.com`、`updates.push.services.mozilla.com`、`*.notify.windows.com`，使用 `web-push` 的原生 HTTPS 请求且不跟随重定向。API 不返回 endpoint 或私钥，SDK 的响应正文和认证头不进入公开错误。最新代码验证记录为 52 项提醒测试、全项目 90 项测试、TypeScript 检查、前端及两套后端打包通过；这不是线上触发器或设备收取验收结果。

上线时逐项确认以下实际结果。无需输出完整 event/context 来诊断；只记录字段是否存在、拒绝结果和计数。

| 线上验证                                                          | 预期                                                                       |
| ----------------------------------------------------------------- | -------------------------------------------------------------------------- |
| 使用普通客户端 SDK、其他账号调用 reminders，提交伪造 Timer event  | 拒绝，不扫描、不发送                                                       |
| 使用匿名账号或无身份调用，提交同样 event 且不带正确 token         | 拒绝；event 内的伪造 context / source / UID 无效                           |
| 控制台测试 event 带正确 Message，但没有本次平台 timer 来源字段    | 允许；确认返回计数和数据库记录，不把 accepted 记作“手机收到”               |
| 控制台测试 Message 错误，且本次平台来源不是 timer                 | 拒绝；如果实际平台 context 本身标记 timer，按当前实现会走无需 token 的路径 |
| 无可信平台来源，正确秘密后缀的实际分钟触发 | 允许扫描，健康来源为 `timer`；错后缀或相似前缀拒绝 |
| 非本人/匿名携带正确秘密后缀 | 拒绝，不扫描、不写健康记录 |
| 已接受的同 generation 日程重复 tick，或只修改 feedback / revision | 不再次发送该 delivery                                                      |
| 日程完成、删除、关闭提醒，订阅关闭或过期，账本正在恢复            | 发送前复核阻止无效提醒；restoreId 非空时暂停                               |

执行限制为每 tick 最多 20 次发送、网络并发最多 4，每次网络超时 10 秒、TTL 600 秒，并在预算不足时停止领取；未领取的工作留给下一 tick。提醒为提前 15 分钟与到期两种时点，每个时点只有 10 分钟有效窗口，不补发早于或等于 reminderStartAt 的提醒；临时故障最多尝试 3 次、间隔 2 分钟。事务租约和稳定 tag 提供幂等与客户端去重；外部请求已接受但写回前进程中断时，无法承诺端到端恰好一次展示。

安全结论限于当前源码和上述部署边界。仍需部署方执行线上身份拒绝验证；没有线上日志证据时，不宣称 CloudBase 实际 context 已提供 timer 来源，也不宣称通知已到达设备。
# 本地部署与升级

电脑端使用独立的 Edge、Chrome 或 Firefox，点击设置中的“开启此设备提醒”并允许通知。每个浏览器与 iPhone 分别登记，不会因手机已开启而自动启用电脑。Edge 的微软 WNS 通道仅允许 HTTPS 443、合法子域名的 `*.notify.windows.com`（[微软的域名校验说明](https://learn.microsoft.com/en-us/windows/apps/develop/notifications/push-notifications/wns-overview)），与苹果、Google、Mozilla 通道同时发送；不放开任意外部地址，不跟随重定向。

设置显示通知权限、浏览器订阅与云端登记三个状态；失去订阅后可再次开启。“本机通知自检”只验证本机 Service Worker 的通知显示，不经过云端、不改变设备登记。若本机也看不到，检查 Windows 通知中心、浏览器的系统通知开关和勿扰模式；若本机能显示但云端测试失败，查看页面错误。Chrome 还需能连通 Google 推送服务。云端 accepted 仅表示服务接收；仍需实际确认电脑通知及点击日程跳转。关闭电脑、断网或系统限制会影响送达。

将 `docs/deploy-env.example.json` 复制到 Git 忽略的 `private-data/deploy-env.json`，填写现有环境 ID、本人 ID、VAPID 配置和提醒触发 token。不要更换既有 VAPID 密钥，以免现有设备订阅失效。执行 `tcb login` 后运行 `npm run deploy:functions`，也可先用 `node scripts/deploy-functions.mjs --check` 只检查配置。

脚本构建并部署 sales / reminders 的代码与环境变量，保留每分钟 cron `0 * * * * * *` 和 token 前 32 位组成的受保护触发器名称；未找到已登录的官方 CLI 时提供控制台步骤，不购买服务。密钥配置及生成的部署文件仅留在被忽略的 private-data 中。部署后检查最新定时扫描时间、测试通知和通知跳转；页面静态缓存不会缓存登录信息、业务数据或云接口。
