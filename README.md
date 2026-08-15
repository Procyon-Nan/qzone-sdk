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
- 发布文字及图片动态；
- 发表评论；
- 回复评论；
- 点赞和取消点赞；
- 删除当前登录账号发布的动态；
- 提供稳定、统一的 TypeScript 数据模型。

动态列表同时覆盖当前登录账号、指定用户和好友动态流，并通过明确的
`scope` 类型区分。SDK 管理内存中的登录态并提供可序列化快照；持久化由
调用方负责，后续可通过可注入的存储适配器接入。

视频发布、访客系统和相册管理暂不属于第一阶段范围。

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

## 发布动态

`publishPost()` 支持纯文字、纯图片或图文动态。图片输入只接受内存中的
`Uint8Array`、`ArrayBuffer` 或 `Blob`，SDK 会复制输入并校验真实文件签名
和尺寸；支持 JPEG、PNG、GIF、BMP 和 WebP，单次最多九张：

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

正文会原样发送，不会由 SDK 清洗或截断。图片最短边须至少为 16 像素，
多图上传的并发数最多为五。最终发布请求不会自动重试。

发布结果的 `outcome` 用于区分可证明的状态：`verified` 表示已读回目标动态，
`accepted` 表示服务端明确接受但尚未读回，`unknown` 表示请求发送后无法确认
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

```ts
import {
    QzoneAuthError,
    QzoneCancelledError,
    QzoneError,
    QzoneRateLimitError
} from 'qzone-sdk'

try {
    await client.listFeeds({ scope: 'self' })
} catch (error) {
    if (error instanceof QzoneAuthError) {
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
  字段，不包含请求正文、响应正文或凭据。
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

## 许可证

[MIT](./LICENSE)
