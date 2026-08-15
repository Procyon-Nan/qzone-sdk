import { FeedOperations } from './operations/feed.js'
import { PostCache } from './operations/post-cache.js'
import { PostOperations } from './operations/post.js'
import { PublishOperations } from './operations/publish.js'
import { QzoneReadApi } from './operations/read.js'
import { QzoneWriteApi } from './operations/write.js'
import { SessionState } from './session/session.js'
import { FetchTransport } from './transport/fetch-transport.js'
import type {
    FeedPage,
    GetPostOptions,
    ListFeedsOptions,
    PostMutationResult,
    PublishPostOptions,
    QzoneClientOptions,
    QzonePost,
    QzoneSession,
    QzoneSessionInput,
    SessionInfo
} from './types.js'

export class QzoneClient {
    readonly #session: SessionState
    readonly #feeds: FeedOperations
    readonly #posts: PostOperations
    readonly #postCache: PostCache
    readonly #publish: PublishOperations

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
    }

    listFeeds(options: ListFeedsOptions): Promise<FeedPage> {
        return this.#feeds.listFeeds(options)
    }

    getPost(options: GetPostOptions): Promise<QzonePost> {
        return this.#posts.getPost(options)
    }

    publishPost(options: PublishPostOptions): Promise<PostMutationResult> {
        return this.#publish.publishPost(options)
    }

    getSessionInfo(): SessionInfo {
        return this.#session.getInfo()
    }

    exportSession(): QzoneSession {
        return this.#session.export()
    }

    updateSession(session: QzoneSessionInput): Promise<void> {
        return this.#session.update(session)
    }

    clearSession(): void {
        this.#session.clear()
        this.#feeds.clear()
        this.#postCache.clear()
    }
}
