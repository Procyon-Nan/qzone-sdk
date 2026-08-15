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
        this.#feeds = new FeedOperations(this.#session, read, this.#postCache)
        this.#posts = new PostOperations(read, this.#postCache)
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

    listFeeds(options: ListFeedsOptions): Promise<FeedPage> {
        return this.#runOpen(() => this.#feeds.listFeeds(options))
    }

    getPost(options: GetPostOptions): Promise<QzonePost> {
        return this.#runOpen(() => this.#posts.getPost(options))
    }

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

    comment(options: CommentOptions): Promise<CommentMutationResult> {
        return this.#writes.run(operationSignal(options), () =>
            this.#mutations.comment(options)
        )
    }

    reply(options: ReplyOptions): Promise<CommentMutationResult> {
        return this.#writes.run(operationSignal(options), () =>
            this.#mutations.reply(options)
        )
    }

    like(options: LikeOptions): Promise<LikeMutationResult> {
        return this.#writes.run(operationSignal(options), () =>
            this.#mutations.like(options)
        )
    }

    unlike(options: UnlikeOptions): Promise<LikeMutationResult> {
        return this.#writes.run(operationSignal(options), () =>
            this.#mutations.unlike(options)
        )
    }

    deleteOwnPost(options: DeleteOwnPostOptions): Promise<PostMutationResult> {
        return this.#writes.run(operationSignal(options), () =>
            this.#mutations.deleteOwnPost(options)
        )
    }

    getSessionInfo(): SessionInfo {
        return this.#session.getInfo()
    }

    exportSession(): QzoneSession {
        return this.#session.export()
    }

    updateSession(session: QzoneSessionInput): Promise<void> {
        return this.#runOpen(() => this.#session.update(session))
    }

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
