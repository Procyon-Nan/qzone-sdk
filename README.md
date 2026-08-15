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

## 开发

项目要求 Node.js 20.19 或更高的兼容版本，并使用 Yarn Classic 管理依赖。

```powershell
yarn install
yarn typecheck
yarn lint
yarn test
yarn build
```

构建产物输出至 `dist`，同时提供 ESM、CommonJS 和 TypeScript 类型声明。

## 读取动态

`QzoneClient` 通过判别联合明确区分当前账号、指定用户和好友动态流：

```ts
import { QzoneClient } from 'qzone-sdk'

const client = new QzoneClient({
    session: {
        cookies: 'uin=o10001; p_skey=...'
    }
})

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

await client.like({ post })
await client.unlike({ post })
```

互动内容不能为空，最终写请求不会自动重试。点赞前会读取当前状态；若已经是
目标状态，返回 `already-applied`。写入后 SDK 会进行有限次数的只读验证，
显示同步尚未完成时返回 `accepted`，请求发送后无法确认时返回 `unknown`。

`deleteOwnPost()` 只允许删除当前 Session 账号发布的动态。SDK 必须先从可信
缓存或详情读取确认归属和真实创建时间；任一信息无法确认都会在删除请求发出
前拒绝操作。删除后的 `verified` 表示详情端点已明确返回目标不存在：

```ts
await client.deleteOwnPost({ post })
```

对于任何 `unknown` 结果，调用方都应先重新读取状态，不得直接重复写入。

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

`onSessionChange` 持久化回调失败时，Session 更新仍保留在内存中，调用会抛出
`QzoneRequestError`，且 `getSessionInfo().persistencePending` 为 `true`；后续
持久化成功后该标记自动清除。

`clearSession()` 是同步操作，仅能在当前实例没有正在执行或排队的请求时调用；
否则会抛出 `QzoneValidationError`，避免旧请求在清理后重新写入 Session 或缓存。

## 许可证

[MIT](./LICENSE)
