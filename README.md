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
- 点赞和取消点赞；
- 提供稳定、统一的 TypeScript 数据模型。

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

## 许可证

[MIT](./LICENSE)
