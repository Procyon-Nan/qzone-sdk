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

## 许可证

[MIT](./LICENSE)
