import { QzoneValidationError } from './errors.js'
import { clientClosedError, WriteQueue } from './internal/write-queue.js'
import { FeedOperations } from './operations/feed.js'
import { MutationOperations } from './operations/mutation.js'
import { PostCache } from './operations/post-cache.js'
import { PostOperations } from './operations/post.js'
import {
    PublishOperations,
    snapshotPublishOptions
} from './operations/publish.js'
import { QzoneReadApi } from './operations/read.js'
import { QzoneWriteApi } from './operations/write.js'
import { SessionState } from './session/session.js'
import { FetchTransport } from './transport/fetch-transport.js'
import type {
    CommentMutationResult,
    CommentOptions,
    DeleteOwnPostOptions,
    FeedPage,
    GetPostOptions,
    LikeMutationResult,
    LikeOptions,
    ListFeedsOptions,
    PostMutationResult,
    PublishPostOptions,
    QzoneClientOptions,
    QzonePost,
    ReplyOptions,
    QzoneSession,
    QzoneSessionInput,
    SessionInfo,
    UnlikeOptions
} from './types.js'

/**
 * 单账号 QQ 空间客户端。
 *
 * 实例在构造时绑定 Session 中的账号，写操作按调用顺序串行执行。调用
 * {@link close} 后实例不可恢复，应创建新实例继续使用。
 */
export class QzoneClient {
    readonly #session: SessionState
    readonly #feeds: FeedOperations
    readonly #posts: PostOperations
    readonly #postCache: PostCache
    readonly #publish: PublishOperations
    readonly #mutations: MutationOperations
    readonly #writes = new WriteQueue()
    readonly #activeOperations = new Set<Promise<unknown>>()
    #closePromise: Promise<void> | null = null

    /** 使用已有 QQ 登录态创建客户端。SDK 不负责登录或刷新凭据。 */
    constructor(options: QzoneClientOptions) {
        this.#session = new SessionState(options.session, {
            onSessionChange: options.onSessionChange
        })
        const transport = new FetchTransport({
            session: this.#session,
            fetch: options.fetch,
            logger: options.logger,
            timeoutMs: options.requestTimeoutMs
        })
        const read = new QzoneReadApi(this.#session, transport)
        this.#postCache = new PostCache()
        this.#feeds = new FeedOperations(
            this.#session,
            read,
            this.#postCache,
            options.logger
        )
        this.#posts = new PostOperations(read, this.#postCache, options.logger)
        const write = new QzoneWriteApi(this.#session, transport)
        this.#publish = new PublishOperations(
            this.#session,
            write,
            this.#feeds,
            this.#posts
        )
        this.#mutations = new MutationOperations(
            this.#session,
            write,
            this.#posts,
            this.#feeds
        )
    }

    /** 读取当前账号、指定用户或好友动态流。 */
    listFeeds(options: ListFeedsOptions): Promise<FeedPage> {
        return this.#runOpen(() => this.#feeds.listFeeds(options))
    }

    /** 读取动态详情，并使用同一实例中的缓存补全协议元数据。 */
    getPost(options: GetPostOptions): Promise<QzonePost> {
        return this.#runOpen(() => this.#posts.getPost(options))
    }

    /**
     * 发布文字、图片或图文动态。
     *
     * 返回 `unknown` 表示请求发出后无法确认最终状态，调用方不得直接重试。
     */
    publishPost(options: PublishPostOptions): Promise<PostMutationResult> {
        const signal = operationSignal(options)
        if (this.#writes.closed || signal?.aborted) {
            return this.#writes.run(signal, () =>
                this.#publish.publishPost(options)
            )
        }
        try {
            const snapshot = snapshotPublishOptions(options)
            return this.#writes.run(signal, () =>
                this.#publish.publishPost(snapshot)
            )
        } catch (error) {
            return Promise.reject(error)
        }
    }

    /** 发表评论；返回 `unknown` 时不得直接重复提交。 */
    comment(options: CommentOptions): Promise<CommentMutationResult> {
        return this.#writes.run(operationSignal(options), () =>
            this.#mutations.comment(options)
        )
    }

    /** 回复评论；返回 `unknown` 时不得直接重复提交。 */
    reply(options: ReplyOptions): Promise<CommentMutationResult> {
        return this.#writes.run(operationSignal(options), () =>
            this.#mutations.reply(options)
        )
    }

    /** 点赞动态；目标已经处于点赞状态时返回 `already-applied`。 */
    like(options: LikeOptions): Promise<LikeMutationResult> {
        return this.#writes.run(operationSignal(options), () =>
            this.#mutations.like(options)
        )
    }

    /** 取消点赞；目标已经处于未点赞状态时返回 `already-applied`。 */
    unlike(options: UnlikeOptions): Promise<LikeMutationResult> {
        return this.#writes.run(operationSignal(options), () =>
            this.#mutations.unlike(options)
        )
    }

    /**
     * 删除当前 Session 账号发布的动态。
     *
     * SDK 在发送删除请求前必须确认动态归属和真实创建时间，无法确认时拒绝
     * 操作。返回 `unknown` 时应先重新读取动态状态，不得直接再次删除。
     */
    deleteOwnPost(options: DeleteOwnPostOptions): Promise<PostMutationResult> {
        return this.#writes.run(operationSignal(options), () =>
            this.#mutations.deleteOwnPost(options)
        )
    }

    /** 返回不包含 Cookie 和 Token 的 Session 状态。 */
    getSessionInfo(): SessionInfo {
        return this.#session.getInfo()
    }

    /**
     * 导出当前 Session 的独立只读快照。
     *
     * 返回值包含 Cookie 和 Token，调用方必须按凭据安全存储。
     */
    exportSession(): QzoneSession {
        return this.#session.export()
    }

    /**
     * 更新当前账号的 Session。
     *
     * 不允许将实例切换到其他账号；持久化回调失败时新状态仍保留在内存中。
     */
    updateSession(session: QzoneSessionInput): Promise<void> {
        return this.#runOpen(() => this.#session.update(session))
    }

    /**
     * 清除内存中的 Session、Token 和实例缓存。
     *
     * 存在活动或排队操作时拒绝清除。需要等待活动请求时应调用 {@link close}。
     */
    clearSession(): void {
        this.#assertOpen()
        if (this.#writes.busy || this.#activeOperations.size > 0) {
            throw new QzoneValidationError(
                '存在正在执行的操作，无法清除 Session',
                { context: { operation: 'session.clear' } }
            )
        }
        this.#session.clear()
        this.#feeds.clear()
        this.#postCache.clear()
    }

    /**
     * 原子关闭客户端，等待已开始的操作后清除凭据和缓存。
     *
     * 该方法可重复调用；调用开始后所有新操作都会被拒绝。
     */
    close(): Promise<void> {
        if (!this.#closePromise) {
            const activeWrites = this.#writes.close()
            const activeOperations = Array.from(this.#activeOperations, settle)
            this.#closePromise = Promise.all([
                activeWrites,
                ...activeOperations
            ]).then(() => {
                this.#session.close()
                this.#feeds.clear()
                this.#postCache.clear()
            })
        }
        return this.#closePromise
    }

    #runOpen<T>(run: () => Promise<T>): Promise<T> {
        if (this.#writes.closed) {
            return Promise.reject(clientClosedError())
        }
        let operation: Promise<T>
        try {
            operation = run()
        } catch (error) {
            return Promise.reject(error)
        }
        this.#activeOperations.add(operation)
        void operation.then(
            () => this.#activeOperations.delete(operation),
            () => this.#activeOperations.delete(operation)
        )
        return operation
    }

    #assertOpen(): void {
        if (this.#writes.closed) {
            throw clientClosedError()
        }
    }
}

function operationSignal(options: unknown): AbortSignal | undefined {
    if (!options || typeof options !== 'object' || !('signal' in options)) {
        return undefined
    }
    return (options as { readonly signal?: AbortSignal }).signal
}

function settle(operation: Promise<unknown>): Promise<void> {
    return operation.then(
        () => undefined,
        () => undefined
    )
}
