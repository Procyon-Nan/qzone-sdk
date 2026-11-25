# qzone-sdk

通用的 TypeScript QQ 空间 SDK。

## 项目定位

`qzone-sdk` 为上层应用提供 QQ 空间登录态管理、数据读取与交互能力，
并隐藏底层 HTTP 协议和数据解析细节。

项目保持框架无关：

- 不依赖 Koishi 或 ChatLuna；
- 不包含 LLM、人格或内容生成逻辑；
- 可以被 AI Agent 框架或普通 TypeScript 应用复用。

## 第一阶段范围

- 管理 QQ 登录态、Cookie 和 Token；
- 读取动态列表和动态详情；
- 发布正文、图片及 MP4 视频动态；
- 发表评论；
- 回复评论；
- 点赞和取消点赞；
- 删除当前登录账号发布的动态；
- 提供稳定、统一的 TypeScript 数据模型。

动态列表同时覆盖当前登录账号、指定用户和好友动态流，并通过明确的
`scope` 类型区分。SDK 管理内存中的登录态并提供可序列化快照；持久化由
调用方通过 `onSessionChange` 回调负责。

登录获取、浏览器运行时、持久化实现、框架适配器、WebUI、命令、LLM 与
自动化业务不属于 SDK 职责；访客系统和相册管理也不属于第一阶段
范围。

## 安装

运行环境需要 Node.js `^20.19.0 || >=22.12.0`。包同时提供 ESM、CommonJS
和 TypeScript 类型声明：

```powershell
npm install qzone-sdk
```

```ts
import { QzoneClient } from 'qzone-sdk'
```

```js
const { QzoneClient } = require('qzone-sdk')
```

## Session 与客户端

SDK 不负责登录。调用方需要提供已经取得的 QQ 空间 Cookie；既可以传入
Cookie Header 文本，也可以传入名值对象。`accountId` 可省略，此时 SDK 会从
`uin`、`p_uin` 等 Cookie 字段识别账号：

```ts
import { QzoneClient } from 'qzone-sdk'

const client = new QzoneClient({
    session: {
        cookies: 'uin=o10001; p_skey=...'
    },
    onSessionChange: async (session) => {
        await sessionStore.save(session)
    }
})
```

一个客户端实例永久绑定一个账号。声明的 `accountId` 与 Cookie 中识别出的
账号不一致时，构造或更新会抛出 `QzoneValidationError`。QQ 响应带回新 Cookie
或 SDK 更新 Token 时会调用 `onSessionChange`；回调由调用方负责以原子写入等
方式可靠持久化。

```ts
const info = client.getSessionInfo() // 不包含 Cookie 或 Token
const snapshot = client.exportSession() // 包含完整凭据

await client.updateSession({
    accountId: snapshot.accountId,
    cookies: refreshedCookies,
    tokens: snapshot.tokens
})
```

`exportSession()` 返回独立快照，可作为下一次构造的 `session`。若持久化回调
失败，内存状态不会回滚，当前调用抛出 `QzoneRequestError`，并且
`getSessionInfo().persistencePending` 为 `true`；后续持久化成功后自动清除。

### 会话凭据要求

`getSessionInfo().gtkSource` 表示 SDK 当前选中的 g_tk 凭据来源，优先级依次为
`p_skey`、`skey`、`skey2`、有效的 `g_tk` 数字值；缺少可用来源时为 `none`。
凭据的服务端有效性由接口响应确认。

传统说说列表、详情接口返回业务码 `-3000` 且当前会话缺少 `p_skey` 时，
`QzoneAuthError` 会在保留服务端消息的基础上补充提示，并通过 `context.hint`
建议重新获取包含 `p_skey` 的 QQ 空间 Cookie。

## 读取动态

`QzoneClient` 通过判别联合明确区分当前账号、指定用户和好友动态流：

```ts
const first = await client.listFeeds({ scope: 'self', limit: 10 })
const next = first.nextCursor
    ? await client.listFeeds({
          scope: 'self',
          limit: 10,
          cursor: first.nextCursor
      })
    : null

const profile = await client.listFeeds({
    scope: 'profile',
    userId: '10002',
    limit: 10
})
const friends = await client.listFeeds({ scope: 'friends', limit: 10 })
const post = profile.items[0]
const detail = post ? await client.getPost({ post }) : null
```

`limit` 的有效范围为 1–20。`nextCursor` 是客户端实例及账号上下文绑定的
不透明值，只能在同一 `QzoneClient`、同一账号、同一 scope 和同一目标账号
中继续使用。动态详情会优先复用同一实例中的列表缓存补全缺失字段，但公共
结果不会暴露 QQ 空间内部动作参数。

移动端返回的外链分享卡片通过可选字段 `post.share` 读取：

```ts
if (post?.share) {
    const { title, summary, url, previewUrl } = post.share
    console.log(post.content, title, summary, url, previewUrl)
}
```

`content` 保留发布者配文，未配文时为空字符串。`share.title`、`share.summary`
是被分享内容的标题和摘要，缺失时为空字符串；`url`、`previewUrl` 分别是可选的
HTTP(S) 跳转地址和封面地址。分享页面链接按网页返回，封面只放在 `share` 中，
独立上传的媒体继续放在 `media` 中。普通动态省略 `share`。

当前支持已验证的 `appid=202` 移动列表 `cell_left_thumb` 与详情 `cell_original`
结构，复用现有请求和分页。桌面 `feeds_html_module` 专属分享流尚未接入。
同一实例读取详情时会合并列表中已有的卡片字段；也可将完整的分享对象交给另一个
客户端的 `getPost({ post })`，继续按分享类型读取详情。

`getPost()` 仅在动态详情协议通过 HTTP 404 或 QQ 业务码 `-8` 明确报告目标
不存在时抛出 `QzoneNotFoundError`。该错误不推断动态由谁删除或为何不可访问；
成功响应中缺少目标动态仍属于 `QzoneParseError`。

## 发布动态

`publishPost()` 接受正文、独立图片和 MP4 视频。媒体输入接受内存中的
`Uint8Array`、`ArrayBuffer` 或 `Blob`，SDK 在入队前复制可变字节。图片按文件签名和尺寸校验，
支持 JPEG、PNG、GIF、BMP 和 WebP，单次最多九张：

```ts
import { readFile } from 'node:fs/promises'

const imageBytes = await readFile('result.png')
const result = await client.publishPost({
    content: '今天完成了新的功能',
    images: [
        {
            data: imageBytes,
            name: 'result.png',
            mimeType: 'image/png'
        }
    ]
})
```

视频使用可选的 `videos` 数组，每项提供文件名和原始字节。SDK 当前上传原视频，时长传 `0`，未上传封面：

```ts
const result = await client.publishPost({
    content: '今天的风景',
    images: [{ name: 'park.jpg', data: await readFile('park.jpg') }],
    videos: [{ name: 'walk.mp4', data: await readFile('walk.mp4') }]
})
```

每次调用最多提交一条说说。图片在同一媒体组中按输入顺序排列，每段视频单独占一组。含视频时，详情读回的动态 ID、作者、正文、独立图片数量和全部视频标识按顺序与请求一致，就返回 `verified`。核验直接使用详情中的素材记录，视频尚无媒体直链时也可确认发布成功；缺项或 ID 错配时保留 `accepted`，不重复发布。

发布核验不请求视频索引或下载视频。发布结果中的 `post.media` 沿用公共读取格式，只包含具备媒体地址的条目；需要读取视频时，调用 `getPost()` 按作者和视频 ID 查询直链。播放器 ID 与记录 ID 冲突的条目不返回，列表读取不为视频额外请求。

2026-11-24 的真实账号测试中，按视频分组后，两个详情接口均返回同一条动态的两张独立图片和两个正确对应的视频 ID，修复了原先多视频合并、ID 与播放器错配的问题，满足上述素材完整送达标准。该次读回的封面为默认占位图，视频直链读取与播放单独作为读取能力核查。

正文会原样发送，不会由 SDK 清洗或截断。图片最短边须至少为 16 像素，
多图上传的并发数最多为五。最终发布请求不会自动重试。

发布结果的 `outcome` 用于区分可证明的状态：`verified` 表示已读回目标动态，
`accepted` 表示服务端明确接受但尚未完成读回核验，`unknown` 表示请求发送后无法确认
是否成功。调用方不得把 `unknown` 当作失败后直接重试，否则可能产生重复动态。

## 评论、点赞与删除

评论、回复、点赞、取消点赞和删除均接收 SDK 返回的动态对象或
`{ id, authorId }` 引用。QQ 空间内部的 `appid`、`curkey`、`unikey` 和
`busi_param` 由同一客户端实例的缓存及详情读取负责补全，不会暴露给调用方：

```ts
const comment = await client.comment({
    post,
    content: '写得很好'
})

if (comment.comment) {
    await client.reply({
        post,
        comment: comment.comment,
        content: '谢谢'
    })
}

const liked = await client.like({ post })
const unliked = await client.unlike({ post })
```

`getPost()` 只执行一次动态详情读取，不提供评论分页。`commentsComplete` 仅在该次
详情响应同时满足一级评论总数以及每条一级评论的回复数时为 `true`；Feed 评论预览、
计数缺失或任一回复计数不符时均为 `false`。`commentCount` 只表示一级评论数，
`comments` 则按响应顺序同时包含一级评论和嵌套回复。

每个 `QzoneComment` 都可直接传给 `reply()`。`kind` 区分一级评论与回复；
`threadRoot` 使用 `{ id, authorId }` 标识回复所属的一级评论；`parentId` 仅保留协议
或容器提供的结构父节点。`replyTo` 只在协议能够明确给出实际目标的完整引用时设置，
不能仅凭位于某个 `replyList` / `list_3` 容器中推断。因此当前 legacy 详情中的回复
通常为 `replyTo: null`。`replyToUser` 独立表示协议正文明确报告的页面显示级目标用户，
不代表具体评论节点，也不会用于补造 `replyTo`。公共 `content` 会移除 SDK 已识别的
开头回复控制标记，只保留页面可见正文。

回复二级评论时，SDK 使用该回复的 `threadRoot` 作为 QQ 空间写入锚点，并在内部协议
正文中指定目标作者；调用方不需要解析或拼接 QQ 空间控制标记。QQ 空间会真实复用
一级评论与回复的相同 `id + authorId`。完整 `QzoneComment` 会结合 `kind` 和
`threadRoot` 精确定位；只有 `{ id, authorId }` 的引用同时匹配多个层级时，`reply()`
会在写请求发出前抛出 `QzoneValidationError`。调用方不能把 `parentId` 当作精确目标
的协议依据。

互动内容不能为空，最终写请求不会自动重试。点赞前会读取当前状态；若已经是
目标状态，返回 `already-applied`。写入后 SDK 会进行有限次数的只读验证，
显示同步尚未完成时返回 `accepted`，请求发送后无法确认时返回 `unknown`。

`deleteOwnPost()` 只允许删除当前 Session 账号发布的动态。SDK 必须先从可信
缓存或详情读取确认归属和真实创建时间；任一信息无法确认都会在删除请求发出
前拒绝操作。删除后的 `verified` 表示详情端点已明确返回目标不存在：

```ts
const deleted = await client.deleteOwnPost({ post })
```

### 处理写操作结果

所有写操作都返回 `outcome`，调用方必须按可证明程度处理：

| `outcome`         | 含义                               | 调用方处理                   |
| ----------------- | ---------------------------------- | ---------------------------- |
| `verified`        | 已通过只读请求确认最终状态         | 可按成功继续                 |
| `accepted`        | 服务端明确接受，但尚未读回最终状态 | 稍后读取确认，不要立即重写   |
| `unknown`         | 请求发出后无法确认是否生效         | 必须先读取状态，不要直接重试 |
| `already-applied` | 写入前已经处于目标状态             | 无需再次写入                 |

`PostMutationResult`、`CommentMutationResult` 和 `LikeMutationResult` 中的动态、
评论或引用只在协议响应及验证能够提供时存在。调用方不得仅凭可选字段是否存在
来代替 `outcome` 判断。

## 错误与取消

所有公共错误都继承 `QzoneError`，并带有稳定的 `code`。可以按具体错误类或
错误码处理，`context` 只包含有限诊断字段：

| 错误类                 | `code`             | 含义                                   |
| ---------------------- | ------------------ | -------------------------------------- |
| `QzoneValidationError` | `QZONE_VALIDATION` | 参数、本地数据或操作前置条件无效       |
| `QzoneAuthError`       | `QZONE_AUTH`       | Session 缺失、失效或被登录流程拒绝     |
| `QzoneRequestError`    | `QZONE_REQUEST`    | 网络、HTTP 或 Session 持久化链路失败   |
| `QzoneNotFoundError`   | `QZONE_NOT_FOUND`  | 动态详情协议明确报告目标不存在         |
| `QzoneRateLimitError`  | `QZONE_RATE_LIMIT` | QQ 空间服务端触发频率限制              |
| `QzonePermissionError` | `QZONE_PERMISSION` | 当前账号无权读取或操作目标             |
| `QzoneParseError`      | `QZONE_PARSE`      | 响应不符合 SDK 支持的协议格式          |
| `QzoneCancelledError`  | `QZONE_CANCELLED`  | 读取被取消，或写操作在请求发送前被取消 |

```ts
import {
    QzoneAuthError,
    QzoneCancelledError,
    QzoneError,
    QzoneNotFoundError,
    QzoneRateLimitError
} from 'qzone-sdk'

try {
    await client.getPost({ post })
} catch (error) {
    if (error instanceof QzoneNotFoundError) {
        // 停止监控该动态；无需读取底层 HTTP 状态或 QQ 业务码。
    } else if (error instanceof QzoneAuthError) {
        // 重新取得 Session 后创建新客户端或更新同账号 Session。
    } else if (error instanceof QzoneRateLimitError) {
        // 按业务策略延后读取，不要立即循环重试。
    } else if (error instanceof QzoneCancelledError) {
        // 操作在允许取消的阶段停止。
    } else if (error instanceof QzoneError) {
        console.error(error.code, error.context)
    }
}
```

动态读取及所有写操作都可通过 options 中的 `signal` 取消。排队写操作若在
开始前取消，会抛出 `QzoneCancelledError`；写请求已经发送后再取消，SDK 仍执行
有限只读验证，并根据可观察状态返回结果。

## 并发、取消与关闭

同一 `QzoneClient` 实例中的发布、评论、回复、点赞、取消点赞和删除操作按
调用顺序进入 FIFO 写队列，避免多个写操作并发修改同一账号状态。动态列表
和详情读取不进入写队列，可以与正在执行的写操作并发。

写操作在开始前收到 `AbortSignal` 取消时会抛出 `QzoneCancelledError`。请求
已经发送后再取消时，SDK 仍会完成有限的只读验证；无法确认最终状态时返回
`unknown`，调用方不得直接重试。

不再使用客户端时应等待 `close()`：

```ts
await client.close()
```

`close()` 可重复调用。它会立即拒绝新请求、取消尚未开始的排队写操作，等待
已发出的读取、正在执行的写操作及其有限验证结束，然后清除 Session、Token、
动态引用缓存和分页游标。关闭后的客户端不可恢复，应创建新实例继续使用。

`clearSession()` 是同步操作，仅能在当前实例没有正在执行或排队的请求时调用；
否则会抛出 `QzoneValidationError`，避免旧请求在清理后重新写入 Session 或缓存。

## 安全边界

- Cookie、Token 和 `exportSession()` 的结果是完整登录凭据。SDK 不会主动记录
  这些值；调用方也不应把它们写入日志、错误消息或版本控制。
- `logger` 只接收阶段、端点名、耗时、重试次数、HTTP 状态和错误码等白名单
  字段，不包含请求正文、响应正文或凭据。`request.error` 表示请求失败未被读取
  回退机制消费，或最终备用端点失败；`read.fallback` 表示 SDK 正在切换到兼容
  读取端点，不代表登录态失效，也不要求调用方重试。`fallbackEndpoint` 仅为 SDK
  内部端点标识，不包含 URL 或账号信息。
- SDK 只允许 QQ 官方域名的 HTTP(S) 请求和受控重定向，不接受调用方传入任意
  请求 URL。
- 动态正文和评论内容由调用方决定，SDK 不执行内容生成、审核或业务权限判断。
- 删除只面向当前 Session 账号自己的动态；无法确认归属或创建时间时拒绝请求。
- 客户端及其游标、缓存和写队列不应跨账号复用。

## 开发

本仓库使用 Yarn Classic。完整本地验收命令为：

```powershell
yarn install --frozen-lockfile
yarn format:check
yarn lint
yarn typecheck
yarn test
yarn build
yarn smoke:package
```

构建输出位于 `dist`。包冒烟测试会核对发布文件清单、构建产物中的本机路径，
并分别从 ESM 与 CommonJS 消费端验证公共运行时 API 和类型声明。

## 自动发布

在 npm 的 `qzone-sdk` 包设置中添加 Trusted Publisher，选择 GitHub Actions：

- Organization or user：`Procyon-Nan`
- Repository：`qzone-sdk`
- Workflow filename：`release.yml`
- Environment name：留空
- Allowed actions：允许直接 `npm publish`

工作流通过 OIDC 获取发布凭据，无需配置 `NPM_TOKEN` Secret。
配置方式参见 [npm 可信发布文档](https://docs.npmjs.com/trusted-publishers/)。

更新 `package.json` 版本和 CHANGELOG 后，将提交推送到 `main` 即可。
Release 工作流对尚无版本标签的包运行完整 CI，从 CHANGELOG 提取说明，发布 npm，
并在本次推送的提交上创建 `v<版本号>` 标签和 GitHub Release。
仅更新发布工作流时也会检查当前版本，已有版本标签的普通分支推送会跳过发布。
仍可手动推送与包版本一致的 `v*` 标签触发同一流程。
`npm publish` 会执行已有的 `prepublishOnly`，完成类型检查、构建和打包预检。
正式版本使用 npm 的 `latest` 标签；预发布版本使用 `next`，并标记 GitHub
Release 为 Pre-release。版本不一致、变更记录缺失或检查失败时，工作流停止。

## 真实 E2E

真实 E2E 默认跳过，必须显式启用读写并提供专用测试账号 Session。测试会按
顺序读取三类动态和详情，发布文字及图片动态，执行评论、回复、点赞、取消点赞
和删除，最后只清理带有本次唯一运行标记的动态：

```powershell
$env:QZONE_E2E_ENABLED = '1'
$env:QZONE_E2E_ALLOW_WRITES = '1'
$env:QZONE_E2E_SESSION_FILE = 'tmp\qzone-session.json'
$env:QZONE_E2E_EXPECTED_ACCOUNT_ID = '10001'
$env:QZONE_E2E_PROFILE_USER_ID = '10002'
yarn test:e2e
```

也可以使用 `QZONE_E2E_SESSION_JSON` 直接提供 Session JSON；设置后优先于
`QZONE_E2E_SESSION_FILE`。真实写操作必须提供预期账号，用于阻止误用其他
登录态；指定用户 ID 可省略，此时测试优先从好友动态中选择其他用户，找不到时
读取当前账号的 profile。

每次运行的步骤、SDK 日志、脱敏请求摘要、脱敏 Session 摘要和清理结果保存在
`tmp/e2e/<run-id>/`。该目录被 Git 忽略，产物不包含 Cookie、Token、QQ 账号、
完整请求 URL 或请求与响应正文；原始 Session 文件仍须由执行者自行安全保管。
写请求返回 `unknown` 或删除结果未经确认时，测试不会直接重复写入，而会停止并在
证据中记录需要人工处理的目标。

## 许可证

[MIT](./LICENSE)
