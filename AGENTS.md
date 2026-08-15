# qzone-sdk 开发规范

## 项目定位

`qzone-sdk` 是一个框架无关的 TypeScript 基础设施项目，负责封装 QQ
空间的底层协议、数据解析和操作接口。项目不承载 Koishi、ChatLuna、
LLM、人格或内容决策等上层业务逻辑。

## 参考项目

QQ 空间协议及现有实现的参考项目仓库固定为：

```text
C:\Users\31899\dev\astrbot_plugin_qzone_ultra
```

实现 QQ 空间能力前，应优先核对该仓库中的实际协议、请求参数、响应解析
和媒体处理逻辑，不得凭经验猜测第三方接口行为。只复用与 QQ 空间能力
有关的设计，不引入 AstrBot 的命令、权限、事件或 Tool 等框架特定逻辑。

## 代码文件结构

以下结构仅列出需要维护的源码和工程文件；`node_modules/`、`dist/`、
`coverage/`、`tmp/` 等依赖、产物或本地临时目录不属于代码结构。

```text
qzone-sdk/
├── .github/
│   └── workflows/
│       └── ci.yml          # 持续集成：格式、静态检查、测试与构建
├── src/
│   ├── protocol/
│   │   ├── comment.ts      # 评论与嵌套回复归一化
│   │   ├── feed.ts         # Feed 容器、列表和分页元数据解析
│   │   ├── html.ts         # HTML 文本、属性和脚本安全提取
│   │   ├── media-url.ts    # 媒体 URL、类型和图片身份辅助
│   │   ├── media.ts        # 图片、视频、音频和文件归一化
│   │   ├── post-fields.ts  # 动态标识、作者和正文字段提取
│   │   ├── post.ts         # 内部动态解析与详情合并
│   │   ├── time.ts         # QQ 时间字段与 ISO 时间归一化
│   │   ├── token.ts        # qzonetoken 安全提取
│   │   ├── types.ts        # 内部协议动态与动作元数据契约
│   │   └── value.ts        # unknown 值和 JSON 对象安全读取
│   ├── transport/
│   │   ├── abort.ts        # 请求超时、取消与可中断退避
│   │   ├── fetch-transport.ts # Fetch 请求、重试、状态与错误编排
│   │   ├── redirect.ts     # QQ 域重定向解析与安全策略
│   │   ├── request.ts      # URL、Header、Query 与 Form 构造
│   │   ├── response.ts     # JSON、JSONP 与响应诊断解析
│   │   ├── set-cookie.ts   # Set-Cookie 提取与过期识别
│   │   ├── types.ts        # 内部端点和请求响应类型
│   │   └── url-policy.ts   # QQ URL 与 HTTP 主机安全策略
│   ├── session/
│   │   ├── cookies.ts      # Cookie 解析、别名规范化与账号识别
│   │   ├── gtk.ts          # hash33 与 g_tk 计算
│   │   └── session.ts      # Session 状态、快照与持久化通知
│   ├── client.ts           # SDK 公共客户端门面
│   ├── errors.ts           # SDK 公共错误类型与稳定错误码
│   ├── index.ts            # SDK 公共导出入口
│   └── types.ts            # SDK 公共模型、操作参数与结果类型
├── tests/
│   ├── protocol/
│   │   ├── comment.spec.ts # 评论与嵌套回复解析测试
│   │   ├── feed.spec.ts    # Feed、动态和公共映射测试
│   │   ├── html.spec.ts    # HTML 与 qzonetoken 解析测试
│   │   ├── media.spec.ts   # 媒体识别、去重与归属测试
│   │   └── time.spec.ts    # 时间字段和范围测试
│   ├── transport/
│   │   └── response.spec.ts # JSON、JSONP 与错误响应测试
│   ├── session/
│   │   ├── cookies.spec.ts # Cookie 解析与账号识别测试
│   │   └── gtk.spec.ts     # hash33 与 g_tk 固定向量测试
│   ├── support/
│   │   ├── fake-fetch.spec.ts # Fetch 测试工具回归测试
│   │   ├── fake-fetch.ts   # 可注入、可记录的顺序 Fetch 测试工具
│   │   └── fixtures.ts     # 测试响应构造工具
│   ├── errors.spec.ts      # 公共错误体系测试
│   ├── session.spec.ts     # Session 状态与公共客户端测试
│   ├── transport.spec.ts   # Fetch Transport 请求与故障语义测试
│   └── types.spec.ts       # 公共类型契约测试
├── .editorconfig           # 编辑器通用格式与 LF 换行约束
├── .gitattributes          # Git 文本文件 LF 换行约束
├── .gitignore              # Git 忽略规则
├── .prettierignore         # Prettier 忽略规则
├── .prettierrc.json        # Prettier 格式配置
├── AGENTS.md               # 项目结构与开发规范
├── eslint.config.mjs       # ESLint 静态检查配置
├── LICENSE                 # MIT 许可证
├── package.json            # 包元数据、依赖及工程脚本
├── README.md               # 项目说明与使用文档
├── tsconfig.json           # TypeScript 编译配置
├── tsup.config.ts          # SDK 构建配置
├── vitest.config.ts        # 测试配置
└── yarn.lock               # Yarn 依赖锁文件
```

任何新增、删除、移动或重命名代码文件、源码目录、测试目录、脚本目录或
工程配置文件的变更，都必须在同一次变更中同步更新本节。不得提交与实际
仓库状态不一致的代码结构说明。

## 工程原则

1. 本项目只提供稳定、明确、可复用的底层操作接口。协议传输、响应解析、
   领域模型和公共 API 之间应保持清晰边界。
2. 优先采用 TypeScript 和 Node.js 生态中成熟、通行的工程范式；引入依赖、
   抽象或自定义机制前，应确认现有语言能力和项目模块不能直接满足需求。
3. 代码必须简洁、干净且意图明确。命名应表达职责，控制流应易于跟踪，
   避免不必要的层级、重复逻辑、过度抽象和无业务价值的兼容代码。
4. 公共接口应保持小而稳定，使用明确的输入输出类型，不泄漏内部协议细节，
   不使用 `any` 或模糊的数据结构绕过建模。
5. I/O、认证、解析和领域逻辑应便于独立测试。外部请求不得硬编码为无法
   替换的全局依赖。
6. 错误处理应一致且包含足够上下文。不得静默吞掉异常，也不得将第三方
   原始错误不加区分地暴露为公共 API 契约。
7. 变更应保持最小范围，并同步补充或更新相关测试、公共导出和文档。
8. 所有文本文件统一使用 LF 换行，并通过现有格式化、静态检查、类型检查、
   测试和构建脚本验证。
