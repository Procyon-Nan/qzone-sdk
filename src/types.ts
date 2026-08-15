/** QQ 账号、动态或评论标识，始终以字符串表示。 */
export type QzoneId = string

/** UTC ISO 8601 时间字符串。 */
export type QzoneTimestamp = string

/** QQ 空间用户的稳定公共模型。 */
export interface QzoneUser {
    readonly id: QzoneId
    readonly nickname: string
    readonly avatarUrl?: string
}

interface QzoneMediaBase {
    readonly url: string
    readonly name?: string
    readonly mimeType?: string
    readonly size?: number
}

/** 动态中的图片媒体。 */
export interface QzoneImageMedia extends QzoneMediaBase {
    readonly kind: 'image'
    readonly width?: number
    readonly height?: number
}

/** 动态中的视频媒体。第一阶段只支持读取，不支持发布。 */
export interface QzoneVideoMedia extends QzoneMediaBase {
    readonly kind: 'video'
    readonly previewUrl?: string
    readonly durationMs?: number
}

/** 动态中的音频媒体。 */
export interface QzoneAudioMedia extends QzoneMediaBase {
    readonly kind: 'audio'
    readonly durationMs?: number
}

/** 动态中的文件媒体。 */
export interface QzoneFileMedia extends QzoneMediaBase {
    readonly kind: 'file'
}

/** 动态中可读取的媒体判别联合。 */
export type QzoneMedia =
    QzoneImageMedia | QzoneVideoMedia | QzoneAudioMedia | QzoneFileMedia

/** 已归一化的评论或嵌套回复。 */
export interface QzoneComment {
    readonly id: QzoneId
    readonly author: QzoneUser
    readonly content: string
    readonly createdAt: QzoneTimestamp | null
    readonly parentId: QzoneId | null
}

/** 不包含 QQ 内部动作参数的动态引用。 */
export interface PostReference {
    readonly id: QzoneId
    readonly authorId: QzoneId
}

/** 已归一化的 QQ 空间动态。 */
export interface QzonePost extends PostReference {
    readonly author: QzoneUser
    readonly content: string
    readonly createdAt: QzoneTimestamp | null
    readonly likeCount: number
    readonly commentCount: number
    readonly liked: boolean
    readonly media: readonly QzoneMedia[]
    readonly comments: readonly QzoneComment[]
}

/** 动态流范围：当前账号、指定用户或好友动态。 */
export type FeedScope = 'self' | 'profile' | 'friends'

interface ListFeedsOptionsBase {
    /** 返回动态数量，默认为 10，有效范围为 1–20。 */
    readonly limit?: number
    /** 上一页返回的不透明游标，只能在原客户端及原读取上下文中使用。 */
    readonly cursor?: string
    /** 取消当前读取的信号。 */
    readonly signal?: AbortSignal
}

/** 读取当前 Session 账号动态的参数。 */
export interface ListSelfFeedsOptions extends ListFeedsOptionsBase {
    readonly scope: 'self'
    readonly userId?: never
}

/** 读取指定用户公开动态的参数。 */
export interface ListProfileFeedsOptions extends ListFeedsOptionsBase {
    readonly scope: 'profile'
    readonly userId: QzoneId
}

/** 读取当前 Session 账号好友动态流的参数。 */
export interface ListFriendsFeedsOptions extends ListFeedsOptionsBase {
    readonly scope: 'friends'
    readonly userId?: never
}

/** 三类动态流读取参数的判别联合。 */
export type ListFeedsOptions =
    ListSelfFeedsOptions | ListProfileFeedsOptions | ListFriendsFeedsOptions

/** 一页动态及同一客户端实例绑定的不透明续页游标。 */
export interface FeedPage {
    /** 当前页中已去重的动态。 */
    readonly items: readonly QzonePost[]
    /** 下一页游标；没有可继续读取的页面时为 `null`。 */
    readonly nextCursor: string | null
}

/** 写操作和详情读取可接受的动态目标。 */
export type PostTarget = PostReference | QzonePost

/** 动态详情读取参数。 */
export interface GetPostOptions {
    /** SDK 返回的动态或只包含公共标识的引用。 */
    readonly post: PostTarget
    /** 取消当前读取的信号。 */
    readonly signal?: AbortSignal
}

/** 发布图片的内存输入；SDK 会在操作入队前复制二进制内容。 */
export interface PublishImageInput {
    /** 图片二进制；支持 Uint8Array、ArrayBuffer 和 Blob。 */
    readonly data: Uint8Array | ArrayBuffer | Blob
    /** 用于上传的文件名。 */
    readonly name: string
    /** 可选 MIME；真实格式仍以文件签名校验结果为准。 */
    readonly mimeType?: string
}

/** 文字、图片或图文动态发布参数。 */
export interface PublishPostOptions {
    /** 原样发送的动态正文。 */
    readonly content?: string
    /** 最多九张经过复制和真实格式校验的内存图片。 */
    readonly images?: readonly PublishImageInput[]
    /** 取消信号；请求发出后的取消仍会执行有限只读验证。 */
    readonly signal?: AbortSignal
}

interface PostMutationOptions {
    /** SDK 返回的动态或只包含公共标识的引用。 */
    readonly post: PostTarget
    /** 取消信号；请求发出后的取消仍会执行有限只读验证。 */
    readonly signal?: AbortSignal
}

/** 发表评论参数。 */
export interface CommentOptions extends PostMutationOptions {
    /** 非空评论正文。 */
    readonly content: string
}

/** 不包含 QQ 内部动作参数的评论引用。 */
export interface CommentReference {
    readonly id: QzoneId
    readonly authorId: QzoneId
}

/** 回复评论参数。 */
export interface ReplyOptions extends PostMutationOptions {
    /** SDK 返回的评论或只包含公共标识的引用。 */
    readonly comment: CommentReference | QzoneComment
    /** 非空回复正文。 */
    readonly content: string
}

/** 点赞参数。 */
export type LikeOptions = PostMutationOptions

/** 取消点赞参数。 */
export type UnlikeOptions = PostMutationOptions

/** 删除当前 Session 账号所发动态的参数。 */
export type DeleteOwnPostOptions = PostMutationOptions

/**
 * 写操作的可证明结果。
 *
 * - `verified`：已通过只读请求确认最终状态；
 * - `accepted`：服务端已接受，但有限验证尚未观察到最终状态；
 * - `unknown`：请求发出后无法确认是否生效，不得直接重试；
 * - `already-applied`：调用前已经处于目标状态，没有重复写入。
 */
export type MutationOutcome =
    'verified' | 'accepted' | 'unknown' | 'already-applied'

interface MutationResultBase {
    readonly outcome: MutationOutcome
    readonly message?: string
}

/** 发布或删除动态的结果。 */
export interface PostMutationResult extends MutationResultBase {
    readonly post?: QzonePost
    readonly reference?: PostReference
}

/** 评论或回复的结果。 */
export interface CommentMutationResult extends MutationResultBase {
    readonly comment?: QzoneComment
    readonly reference?: CommentReference
}

/** 点赞或取消点赞的结果。 */
export interface LikeMutationResult extends MutationResultBase {
    readonly liked: boolean
    readonly post?: QzonePost
}

/** Cookie Header 文本或 Cookie 名值对象。 */
export type QzoneCookieInput = string | Readonly<Record<string, string>>

/**
 * 构造或更新客户端所需的 QQ 登录态。
 *
 * Cookie 和 Token 属于敏感凭据。SDK 只在内存中使用它们，不负责登录、刷新
 * 或持久化。`accountId` 与 Cookie 中识别出的账号必须一致。
 */
export interface QzoneSessionInput {
    /** 可选账号；提供时必须与 Cookie 中识别出的账号一致。 */
    readonly accountId?: QzoneId
    /** QQ 空间 Cookie Header 文本或名值对象。 */
    readonly cookies: QzoneCookieInput
    /** 按目标 QQ 账号保存的 qzonetoken。 */
    readonly tokens?: Readonly<Record<QzoneId, string>>
    /** 快照更新时间；省略时使用当前时间并归一化为 UTC ISO 8601。 */
    readonly updatedAt?: QzoneTimestamp
}

/**
 * 可持久化的 Session 快照。
 *
 * 该对象包含 Cookie 和 Token，必须由调用方存放在访问受控的位置，禁止记录
 * 到日志或提交到版本控制。
 */
export interface QzoneSession {
    readonly accountId: QzoneId
    readonly cookies: Readonly<Record<string, string>>
    readonly tokens: Readonly<Record<QzoneId, string>>
    readonly updatedAt: QzoneTimestamp
}

/** 不包含 Cookie 和 Token 的 Session 状态。 */
export interface SessionInfo {
    /** 当前账号；Session 已清除时为 `null`。 */
    readonly accountId: QzoneId | null
    /** 是否存在可识别账号且 g_tk 非零。 */
    readonly authenticated: boolean
    /** 最近一次 Session 更新时间。 */
    readonly updatedAt: QzoneTimestamp | null
    /** 最新内存 Session 是否尚未成功通过回调持久化。 */
    readonly persistencePending: boolean
}

/**
 * Session 变更持久化回调。
 *
 * 回调按变更顺序串行执行。失败会使当前调用抛错，但内存中的新 Session 不会
 * 回滚，并通过 `persistencePending` 提示尚未成功落盘。
 */
export type SessionChangeHandler = (
    session: QzoneSession
) => void | Promise<void>

/** 结构化日志级别。 */
export type QzoneLogLevel = 'debug' | 'info' | 'warn' | 'error'

/** 不包含 Cookie、Token、请求正文或响应正文的结构化诊断事件。 */
export interface QzoneLogEvent {
    readonly level: QzoneLogLevel
    readonly phase: string
    readonly endpoint?: string
    readonly durationMs?: number
    readonly retryCount?: number
    readonly statusCode?: number
    readonly errorCode?: string
}

/** 结构化日志接收函数。 */
export type QzoneLogger = (event: QzoneLogEvent) => void

/** 创建 {@link QzoneClient} 的配置。 */
export interface QzoneClientOptions {
    /** 初始 QQ 登录态；实例在构造时永久绑定其中的账号。 */
    readonly session: QzoneSessionInput
    /** 可替换的 Fetch 实现，主要用于代理、测试或受控运行环境。 */
    readonly fetch?: typeof globalThis.fetch
    /** 仅接收白名单诊断字段的结构化日志函数。 */
    readonly logger?: QzoneLogger
    /** Session 每次变更后按 FIFO 顺序调用的持久化函数。 */
    readonly onSessionChange?: SessionChangeHandler
    /** 单次 HTTP 请求超时毫秒数，默认为 15000，必须是正整数。 */
    readonly requestTimeoutMs?: number
}
